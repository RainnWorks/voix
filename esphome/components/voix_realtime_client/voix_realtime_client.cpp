#include "voix_realtime_client.h"

#include <cstring>

#include "esphome/components/audio/audio.h"
#include "esphome/components/microphone/microphone.h"
#include "esphome/components/speaker/speaker.h"
#include "esphome/core/application.h"
#include "esphome/core/log.h"

#include "esp_event.h"
#include "esp_heap_caps.h"
#include "esp_websocket_client.h"
#include "nvs.h"
#include "nvs_flash.h"

namespace esphome {
namespace voix_realtime_client {

static const char *const TAG = "voix_realtime_client";

// Crash-survivable teardown breadcrumb. Written to NVS before each
// teardown, read + logged at boot. Lets us see WHY a session ended even
// if the device panicked and rebooted before the network logger could
// flush. ESPHome's "Reset Reason: Reboot request from esphome.ota" is
// a misleading stale NVS value carried over from prior OTAs — this is
// the actual signal.
static constexpr const char *NVS_NS = "voix";
static constexpr const char *NVS_KEY_REASON = "td_reason";
static constexpr const char *NVS_KEY_HEAP_FREE = "td_heap_free";
static constexpr const char *NVS_KEY_HEAP_LARGEST = "td_heap_largest";
static constexpr const char *NVS_KEY_PHASE = "td_phase";
// Adoption-pushed config (URL + token from HA via voix_set_server). NVS
// so the device survives a reboot without needing HA to re-push.
static constexpr const char *NVS_KEY_SERVER_URL = "server_url";
static constexpr const char *NVS_KEY_WS_TOKEN = "ws_token";

static void persist_string(const char *key, const std::string &value) {
  nvs_handle_t h;
  if (nvs_open(NVS_NS, NVS_READWRITE, &h) != ESP_OK) return;
  nvs_set_str(h, key, value.c_str());
  nvs_commit(h);
  nvs_close(h);
}

static std::string load_string(const char *key) {
  nvs_handle_t h;
  if (nvs_open(NVS_NS, NVS_READWRITE, &h) != ESP_OK) return "";
  size_t len = 0;
  if (nvs_get_str(h, key, nullptr, &len) != ESP_OK || len == 0) {
    nvs_close(h);
    return "";
  }
  std::string out(len, '\0');
  nvs_get_str(h, key, out.data(), &len);
  if (!out.empty() && out.back() == '\0') out.pop_back();
  nvs_close(h);
  return out;
}

static void persist_teardown_breadcrumb(const char *reason, const char *phase,
                                        size_t heap_free, size_t heap_largest) {
  nvs_handle_t h;
  esp_err_t err = nvs_open(NVS_NS, NVS_READWRITE, &h);
  if (err != ESP_OK) return;
  nvs_set_str(h, NVS_KEY_REASON, reason ? reason : "?");
  nvs_set_str(h, NVS_KEY_PHASE, phase ? phase : "?");
  nvs_set_u32(h, NVS_KEY_HEAP_FREE, static_cast<uint32_t>(heap_free));
  nvs_set_u32(h, NVS_KEY_HEAP_LARGEST, static_cast<uint32_t>(heap_largest));
  nvs_commit(h);
  nvs_close(h);
}

static void log_and_clear_teardown_breadcrumb() {
  nvs_handle_t h;
  if (nvs_open(NVS_NS, NVS_READWRITE, &h) != ESP_OK) return;
  char reason[40] = {0};
  char phase[24] = {0};
  size_t rlen = sizeof(reason);
  size_t plen = sizeof(phase);
  uint32_t heap_free = 0, heap_largest = 0;
  if (nvs_get_str(h, NVS_KEY_REASON, reason, &rlen) == ESP_OK) {
    nvs_get_str(h, NVS_KEY_PHASE, phase, &plen);
    nvs_get_u32(h, NVS_KEY_HEAP_FREE, &heap_free);
    nvs_get_u32(h, NVS_KEY_HEAP_LARGEST, &heap_largest);
    ESP_LOGW(TAG,
             "PREV-TEARDOWN reason=%s phase=%s heap_free=%uB largest=%uB "
             "(survived reboot — this is the actual cause of the last "
             "session ending)",
             reason, phase, (unsigned) heap_free, (unsigned) heap_largest);
    // Clear so we don't keep showing it after a clean boot.
    nvs_erase_key(h, NVS_KEY_REASON);
    nvs_erase_key(h, NVS_KEY_PHASE);
    nvs_erase_key(h, NVS_KEY_HEAP_FREE);
    nvs_erase_key(h, NVS_KEY_HEAP_LARGEST);
    nvs_commit(h);
  }
  nvs_close(h);
}

// ─── WS event handler ────────────────────────────────────────────────────────
// Runs on the WS task thread. We DO NOT touch ESPHome state here. Every
// transition is communicated to the main loop via the atomic flags on the
// VoixRealtimeClient instance. Drained in loop().
static void s_ws_event_handler(void *ctx, esp_event_base_t base, int32_t event_id,
                               void *event_data) {
  auto *self = static_cast<VoixRealtimeClient *>(ctx);
  auto *event = static_cast<esp_websocket_event_data_t *>(event_data);
  switch (event_id) {
    case WEBSOCKET_EVENT_CONNECTED:
      ESP_LOGI(TAG, "ws CONNECTED");
      self->on_ws_connected_from_isr();
      break;
    case WEBSOCKET_EVENT_DISCONNECTED:
      ESP_LOGI(TAG, "ws DISCONNECTED (event)");
      self->teardown_reason_ = "ws_disconnected_event";
      self->on_ws_disconnected_from_isr();
      break;
    case WEBSOCKET_EVENT_DATA: {
      // op_code 0x01 = text, 0x02 = binary, 0x00 = continuation,
      // 0x08 = close. ESP-IDF delivers messages larger than the recv
      // buffer (cfg.buffer_size, 4 KB) as multiple events, each with
      // a slice of the payload. We re-assemble in PSRAM and only
      // hand a complete message to the on_ws_{text,binary} handlers.
      if (event->op_code == 0x08) {
        ESP_LOGI(TAG, "ws CLOSE frame received (op_code=0x08) → treating as disconnect");
        self->teardown_reason_ = "ws_close_frame";
        self->on_ws_disconnected_from_isr();
        break;
      }
      // Ignore control frames (ping/pong) and any zero-payload events.
      if (event->data_len == 0 && event->payload_len == 0) {
        break;
      }
      const size_t off = event->payload_offset;
      const size_t total = event->payload_len;
      const size_t len = event->data_len;

      if (off == 0) {
        // Start of a new message.
        self->reasm_op_code_ = event->op_code;
        self->reasm_total_ = total;
        self->reasm_offset_ = 0;
        if (len == total) {
          // Single-event complete frame — handle inline, no reasm
          // buffer needed.
          if (event->op_code == 0x01) {
            self->on_ws_text_from_isr(
                reinterpret_cast<const char *>(event->data_ptr), len);
          } else if (event->op_code == 0x02) {
            self->on_ws_binary_from_isr(
                reinterpret_cast<const uint8_t *>(event->data_ptr), len);
          }
          self->reasm_total_ = 0;
          break;
        }
        // Multi-event frame begins. Ensure the reasm buffer is big
        // enough — pre-allocated at setup, grown on demand only for
        // outsized frames.
        if (self->reasm_buf_ == nullptr || self->reasm_capacity_ < total) {
          if (self->reasm_buf_ != nullptr) heap_caps_free(self->reasm_buf_);
          size_t cap = total > VoixRealtimeClient::REASM_INITIAL_CAPACITY
                           ? total
                           : VoixRealtimeClient::REASM_INITIAL_CAPACITY;
          self->reasm_buf_ = static_cast<uint8_t *>(heap_caps_malloc(
              cap, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT));
          if (self->reasm_buf_ == nullptr) {
            ESP_LOGE(TAG, "reasm PSRAM alloc failed (size=%u)",
                     static_cast<unsigned>(cap));
            self->reasm_capacity_ = 0;
            self->reasm_total_ = 0;
            break;
          }
          self->reasm_capacity_ = cap;
        }
        memcpy(self->reasm_buf_, event->data_ptr, len);
        self->reasm_offset_ = len;
      } else {
        // Continuation of an in-flight frame.
        if (self->reasm_buf_ == nullptr || off + len > self->reasm_total_) {
          ESP_LOGE(TAG,
                   "reasm continuation invalid (off=%u len=%u total=%u buf=%p)",
                   static_cast<unsigned>(off), static_cast<unsigned>(len),
                   static_cast<unsigned>(self->reasm_total_),
                   self->reasm_buf_);
          break;
        }
        memcpy(self->reasm_buf_ + off, event->data_ptr, len);
        self->reasm_offset_ = off + len;
      }

      // Frame complete? Fan out. Buffer stays allocated for the next
      // frame to reuse — avoids the per-frame malloc/free pair that
      // was starving the WS task and causing EAGAIN on mic sends.
      if (self->reasm_buf_ != nullptr && self->reasm_offset_ == self->reasm_total_) {
        if (self->reasm_op_code_ == 0x01) {
          self->on_ws_text_from_isr(
              reinterpret_cast<const char *>(self->reasm_buf_),
              self->reasm_total_);
        } else if (self->reasm_op_code_ == 0x02) {
          self->on_ws_binary_from_isr(self->reasm_buf_, self->reasm_total_);
        }
        self->reasm_total_ = 0;
        self->reasm_offset_ = 0;
      }
      break;
    }
      break;
    case WEBSOCKET_EVENT_ERROR:
      ESP_LOGW(TAG, "ws ERROR event");
      self->on_ws_error_from_isr();
      break;
#ifdef WEBSOCKET_EVENT_CLOSED
    case WEBSOCKET_EVENT_CLOSED:
      ESP_LOGI(TAG, "ws CLOSED");
      self->on_ws_disconnected_from_isr();
      break;
#endif
    default:
      ESP_LOGD(TAG, "ws event %d (ignored)", (int) event_id);
      break;
  }
}

// ─── Component lifecycle ─────────────────────────────────────────────────────

float VoixRealtimeClient::get_setup_priority() const {
  // After network is up — we'll be opening WebSockets.
  return setup_priority::AFTER_WIFI;
}

void VoixRealtimeClient::set_server_url(const std::string &url) {
  if (this->server_url_ == url) return;
  this->server_url_ = url;
  persist_string(NVS_KEY_SERVER_URL, url);
  ESP_LOGI(TAG, "server_url set + persisted (%s)", url.c_str());
}

void VoixRealtimeClient::set_ws_token(const std::string &tok) {
  if (this->ws_token_ == tok) return;
  this->ws_token_ = tok;
  persist_string(NVS_KEY_WS_TOKEN, tok);
  ESP_LOGI(TAG, "ws_token set + persisted (%d chars)",
           static_cast<int>(tok.size()));
}

void VoixRealtimeClient::setup() {
  // Load adoption-pushed config from NVS so the device can reconnect
  // after a reboot without HA needing to re-push. YAML-time defaults
  // (if any) win only when NVS is empty.
  std::string nvs_url = load_string(NVS_KEY_SERVER_URL);
  std::string nvs_tok = load_string(NVS_KEY_WS_TOKEN);
  if (!nvs_url.empty()) this->server_url_ = nvs_url;
  if (!nvs_tok.empty()) this->ws_token_ = nvs_tok;

  ESP_LOGCONFIG(TAG, "voix_realtime_client setup (server=%s, token=%d chars)",
                this->server_url_.c_str(),
                static_cast<int>(this->ws_token_.size()));

  // First thing on setup: surface the crash breadcrumb from the previous
  // teardown (if any). Survives reboots — so even when the device dies
  // before our TEARDOWN log line can flush over the network, we still see
  // the cause on the next boot.
  log_and_clear_teardown_breadcrumb();

  // Pre-allocate the WS client at boot, when heap is fresh and the
  // largest contiguous block is biggest. esp_websocket_client_init
  // needs a sizeable contiguous internal-SRAM region for its recv
  // buffer + task stack + control structures; doing this at
  // wake-word time fails with "Memory exhausted" because the chime
  // ring buffer + voice_assistant transient state + mWW model
  // tensors have fragmented the heap by then. Init once, reuse
  // across sessions via set_uri + start.
  this->init_ws_client_();

  // Pre-allocate the WS message re-assembly buffer in PSRAM at boot.
  // Reused across every frame to avoid the per-frame malloc/free that
  // starved the WS task and caused EAGAIN on outbound sends.
  this->reasm_buf_ = static_cast<uint8_t *>(heap_caps_malloc(
      REASM_INITIAL_CAPACITY, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT));
  if (this->reasm_buf_ != nullptr) {
    this->reasm_capacity_ = REASM_INITIAL_CAPACITY;
    ESP_LOGI(TAG, "reasm buffer pre-allocated (%u bytes PSRAM)",
             static_cast<unsigned>(REASM_INITIAL_CAPACITY));
  } else {
    ESP_LOGW(TAG, "reasm buffer pre-alloc failed; will retry per-frame");
  }
  // Reserve mic batch capacity once so we don't realloc per callback.
  this->mic_batch_.reserve(MIC_BATCH_TARGET_BYTES + 256);

  // Subscribe to the mic via MicrophoneSource — the same helper class that
  // upstream's voice_assistant uses. It converts the raw 32-bit stereo I2S
  // stream from i2s_mics into 16-bit mono using channel 0 (the voice_kit
  // AEC-processed mic). passive=true means we receive data whenever the
  // mic is already running (mWW keeps it running for wake-word detection)
  // without claiming ownership.
  if (this->microphone_ != nullptr && !this->mic_callback_registered_) {
    this->mic_source_ = std::make_unique<microphone::MicrophoneSource>(
        this->microphone_,
        /*bits_per_sample=*/16,
        /*gain_factor=*/1,
        /*passive=*/true);
    this->mic_source_->add_channel(0);
    this->mic_source_->add_data_callback(
        [this](const std::vector<uint8_t> &data) { this->on_mic_data_(data); });
    this->mic_source_->start();  // marks the source as enabled
    this->mic_callback_registered_ = true;
    ESP_LOGCONFIG(TAG, "  mic source registered (16-bit mono ch0, passive)");
  }
}

void VoixRealtimeClient::loop() {
  if (this->pending_connected_.exchange(false)) {
    this->set_state_(State::RUNNING);
    // Greet the server with our identity + shared-secret token. The HA
    // integration uses the device_id to auto-register entities; the token
    // is the WS auth gate. Without a matching token the server closes us
    // before any OpenAI session opens.
    std::string hello = R"({"type":"hello","device_id":")";
    hello += App.get_name();
    hello += R"(","friendly_name":")";
    hello += App.get_friendly_name();
    hello += R"(","token":")";
    hello += this->ws_token_;
    hello += R"("})";
    this->send_text_(hello);
    this->connected_trigger_.trigger();
  }
  if (this->pending_error_.exchange(false)) {
    this->error_trigger_.trigger();
  }
  if (this->pending_audio_start_.exchange(false)) {
    this->speaking_.store(true);
    // Re-arm 24 kHz force for THIS response. Between responses the
    // shared `announcement_resampling_speaker` chain transitions through
    // IDLE and the rate config drifts back to 48 kHz default; without
    // this we'd play turn 2+ at 2× speed.
    this->speaker_rate_pending_ = true;
    this->logged_first_chunk_ = false;  // get fresh diagnostic per response
    this->audio_out_start_trigger_.trigger();
  }
  if (this->pending_audio_end_.exchange(false)) {
    this->speaking_.store(false);
    this->audio_out_end_trigger_.trigger();
  }
  if (this->pending_user_speech_start_.exchange(false)) {
    this->user_speech_start_trigger_.trigger();
  }
  if (this->pending_user_speech_end_.exchange(false)) {
    this->user_speech_end_trigger_.trigger();
  }
  // Disconnect fires LAST so its LED-to-idle transition always wins over
  // any in-flight speech/audio events that arrived in the same tick. Without
  // this, a server that closes immediately after sending user_speech_end
  // leaves the LED stuck in the "thinking" spin (phase 4): the disconnect
  // trigger fires first → phase 1, then user_speech_end overwrites → phase 4.
  if (this->pending_disconnected_.exchange(false)) {
    this->teardown_reason_ = "ws_disconnected_event";
    this->teardown_();
    this->disconnected_trigger_.trigger();
  }

  // NOTE: the previous "is_connected() polling safety net" was removed.
  // It was a guess at why some sessions ended without a DISCONNECTED
  // event, but `esp_websocket_client_is_connected` can transiently return
  // false under heavy traffic (the internal mutex is contested with the
  // WS task), and that was a strong candidate for false-positive teardowns
  // mid-response. We now rely on the WS event handler — including the
  // CLOSE-frame branch we added — to drive the disconnect, and on the
  // heap-low circuit breaker below for genuine OOM avoidance.

  // Heap-low circuit breaker. Only path now: PSRAM allocation failure
  // for an inbound audio chunk. Mic-side precheck removed earlier
  // because mic chunks are 1 KB and shouldn't trip on transient WiFi
  // allocator pressure that we don't control.
  if (this->heap_low_.exchange(false) && this->state_ == State::RUNNING) {
    this->teardown_reason_ = "heap_low";
    this->teardown_();
    this->disconnected_trigger_.trigger();
  }

  // Audio pumps. Cheap when queues are empty.
  this->pump_outbound_();
  this->pump_inbound_();

  // Periodic stats so we can see audio flow without setting verbose logs.
  // Include free heap + largest-free-block so we can tell heap fragmentation
  // (largest block shrinks while free total stays high) apart from a real
  // leak (both shrink together).
  uint32_t now = millis();
  if (this->state_ == State::RUNNING && now - this->last_stats_log_ms_ > 2000) {
    this->last_stats_log_ms_ = now;
    size_t free_internal = heap_caps_get_free_size(MALLOC_CAP_INTERNAL);
    size_t largest_internal =
        heap_caps_get_largest_free_block(MALLOC_CAP_INTERNAL);
    size_t inbound_sz, outbound_sz;
    {
      std::lock_guard<std::mutex> lk(this->inbound_mutex_);
      inbound_sz = this->inbound_.size();
    }
    {
      std::lock_guard<std::mutex> lk(this->outbound_mutex_);
      outbound_sz = this->outbound_.size();
    }
    ESP_LOGI(TAG,
             "stats: mic=%u/%uB ws_rx=%uB spk=%uB | q_in=%u q_out=%u | "
             "heap_free=%uB largest=%uB",
             this->mic_chunks_seen_, this->mic_bytes_sent_,
             this->ws_bytes_received_, this->speaker_bytes_played_,
             (unsigned) inbound_sz, (unsigned) outbound_sz,
             (unsigned) free_internal, (unsigned) largest_internal);
  }
}

void VoixRealtimeClient::dump_config() {
  ESP_LOGCONFIG(TAG, "voix_realtime_client:");
  ESP_LOGCONFIG(TAG, "  Server URL: %s", this->server_url_.c_str());
  ESP_LOGCONFIG(TAG, "  Microphone: %s", this->microphone_ != nullptr ? "configured" : "MISSING");
  ESP_LOGCONFIG(TAG, "  Speaker:    %s", this->speaker_ != nullptr ? "configured" : "MISSING");
}

// ─── Actions ─────────────────────────────────────────────────────────────────

void VoixRealtimeClient::start() {
  if (this->state_ != State::IDLE) {
    ESP_LOGW(TAG, "start() called in state=%d; ignoring", static_cast<int>(this->state_));
    return;
  }
  if (this->server_url_.empty()) {
    ESP_LOGE(TAG, "start() with empty server_url");
    return;
  }
  ESP_LOGI(TAG, "start: connecting to %s", this->server_url_.c_str());

  // Mark that the speaker needs reconfiguring to 24 kHz on the first play.
  // We CAN'T set this right now and trust it to stick: between here (start)
  // and our first play() (~2-3 s later, after WS handshake + OpenAI's first
  // audio.delta), upstream components like speaker_source_media_player
  // transition through ANNOUNCING/IDLE and reset the speaker's stream info
  // back to its default 48 kHz. So we defer the set to pump_inbound_'s
  // first call when we actually have data, right before play() captures it.
  this->speaker_rate_pending_ = true;

  // Reset stats so each session reports its own throughput.
  this->mic_bytes_sent_ = 0;
  this->ws_bytes_received_ = 0;
  this->speaker_bytes_played_ = 0;

  // Pre-allocated ws_ (created in setup()). Just point it at the current
  // URI and start. Avoids the at-wake-word "Memory exhausted" failure
  // where esp_websocket_client_init needs a contiguous block of internal
  // SRAM that doesn't exist after the chime + voice_assistant + mWW have
  // fragmented the heap.
  if (this->ws_ == nullptr) {
    // setup() couldn't allocate — try once more here as a fallback.
    if (!this->init_ws_client_()) {
      ESP_LOGE(TAG, "ws client not available — start aborted");
      return;
    }
  }
  esp_err_t uerr = esp_websocket_client_set_uri(this->ws_, this->server_url_.c_str());
  if (uerr != ESP_OK) {
    ESP_LOGE(TAG, "esp_websocket_client_set_uri failed: %d", uerr);
    return;
  }
  esp_err_t err = esp_websocket_client_start(this->ws_);
  if (err != ESP_OK) {
    ESP_LOGE(TAG, "esp_websocket_client_start failed: %d", err);
    this->teardown_reason_ = "ws_start_failed";
    this->teardown_();
    return;
  }
  this->set_state_(State::CONNECTING);
}

bool VoixRealtimeClient::init_ws_client_() {
  if (this->ws_ != nullptr) return true;  // already initialised

  esp_websocket_client_config_t cfg = {};
  // Placeholder URI — required for init, replaced via set_uri before
  // each start. Using a localhost URI so accidental connects are
  // harmless.
  static const char *kPlaceholderUri = "ws://127.0.0.1:1";
  cfg.uri = kPlaceholderUri;
  // CRITICAL: do NOT auto-reconnect. We control session lifecycle via
  // the wake-word + explicit start/stop. Auto-reconnect caused a cost
  // leak: when the server closed the WS, esp_websocket_client
  // immediately reconnected, the server saw a new session, the LED
  // bounced back to magenta, and OpenAI kept billing us.
  cfg.disable_auto_reconnect = true;
  cfg.reconnect_timeout_ms = 0;
  cfg.network_timeout_ms = 10000;
  cfg.keep_alive_enable = true;
  cfg.keep_alive_idle = 10;
  cfg.keep_alive_interval = 5;
  cfg.keep_alive_count = 3;
  cfg.disable_pingpong_discon = false;
  // 4 KB recv buffer. Frames larger than this are delivered as
  // multiple WEBSOCKET_EVENT_DATA events; the event handler above
  // re-assembles them in PSRAM. Keeping internal SRAM small is
  // essential — esp_websocket_client_init wanted a contiguous block
  // bigger than the ~31 KB largest available after upstream's
  // Voice PE features (BLE, mWW tensors, Sendspin, etc.) had used
  // their share of internal SRAM at boot.
  cfg.buffer_size = 4096;

  size_t before_free = heap_caps_get_free_size(MALLOC_CAP_INTERNAL);
  size_t before_largest = heap_caps_get_largest_free_block(MALLOC_CAP_INTERNAL);
  this->ws_ = esp_websocket_client_init(&cfg);
  if (this->ws_ == nullptr) {
    ESP_LOGE(TAG,
             "esp_websocket_client_init failed (heap_free=%uB largest=%uB)",
             (unsigned) before_free, (unsigned) before_largest);
    return false;
  }
  esp_websocket_register_events(this->ws_, WEBSOCKET_EVENT_ANY,
                                &s_ws_event_handler, this);
  ESP_LOGI(TAG, "ws client pre-allocated (heap_free was %uB largest %uB)",
           (unsigned) before_free, (unsigned) before_largest);
  return true;
}

void VoixRealtimeClient::stop() {
  if (this->state_ == State::IDLE) {
    return;
  }
  ESP_LOGI(TAG, "stop: tearing down session");
  this->set_state_(State::STOPPING);
  if (this->ws_ != nullptr && esp_websocket_client_is_connected(this->ws_)) {
    this->send_text_(R"({"type":"stop"})");
  }
  this->teardown_reason_ = "external_stop";
  this->teardown_();
  // teardown_ doesn't fire triggers — let the WS DISCONNECTED event handle that
  // if it arrives; otherwise we're already idle.
}

void VoixRealtimeClient::interrupt() {
  if (this->ws_ == nullptr || !esp_websocket_client_is_connected(this->ws_)) {
    return;
  }
  ESP_LOGI(TAG, "interrupt: signalling server");
  this->send_text_(R"({"type":"interrupt"})");
}

// ─── Internals ───────────────────────────────────────────────────────────────

void VoixRealtimeClient::set_state_(State new_state) {
  if (new_state == this->state_) {
    return;
  }
  ESP_LOGD(TAG, "state %d -> %d", static_cast<int>(this->state_),
           static_cast<int>(new_state));
  this->state_ = new_state;
}

void VoixRealtimeClient::teardown_() {
  // First thing: tell us EXACTLY why we're tearing down, with full vitals.
  // The reason is stamped by each caller before invoking. This is the line
  // we look for in logs to diagnose mid-session disconnects.
  size_t free_internal = heap_caps_get_free_size(MALLOC_CAP_INTERNAL);
  size_t largest_internal = heap_caps_get_largest_free_block(MALLOC_CAP_INTERNAL);
  size_t inbound_sz = 0, outbound_sz = 0;
  {
    std::lock_guard<std::mutex> lk(this->inbound_mutex_);
    inbound_sz = this->inbound_.size();
  }
  {
    std::lock_guard<std::mutex> lk(this->outbound_mutex_);
    outbound_sz = this->outbound_.size();
  }
  ESP_LOGW(TAG,
           "TEARDOWN reason=%s state=%d ws_conn=%d "
           "stats: mic=%u/%uB ws_rx=%uB spk=%uB | q_in=%u q_out=%u | "
           "heap_free=%uB largest=%uB",
           this->teardown_reason_,
           static_cast<int>(this->state_),
           (this->ws_ != nullptr && esp_websocket_client_is_connected(this->ws_)) ? 1 : 0,
           this->mic_chunks_seen_, this->mic_bytes_sent_,
           this->ws_bytes_received_, this->speaker_bytes_played_,
           (unsigned) inbound_sz, (unsigned) outbound_sz,
           (unsigned) free_internal, (unsigned) largest_internal);

  // Persist to NVS so the next boot can show us what happened even if
  // the network log didn't make it out (which is exactly what we've been
  // seeing — the device dies before the WARNING line flushes).
  persist_teardown_breadcrumb(this->teardown_reason_, "teardown",
                              free_internal, largest_internal);

  if (this->ws_ != nullptr) {
    // Stop but DON'T destroy — keep the handle (and its internal
    // buffers) alive between sessions. Re-allocating at wake-word
    // time hit "Memory exhausted" because heap is fragmented by then,
    // even when total free is high. The buffer is allocated once at
    // setup() and re-used. Next session resets the URI via
    // esp_websocket_client_set_uri + _start.
    esp_websocket_client_stop(this->ws_);
  }
  // Reset reasm state so the next session starts with no in-flight
  // frame leftover. The reasm BUFFER stays allocated for reuse (the
  // whole point of pre-allocation — see setup()). Same for the mic
  // batch buffer: empty it but keep the capacity.
  this->reasm_total_ = 0;
  this->reasm_offset_ = 0;
  this->mic_batch_.clear();
  this->speaking_.store(false);
  // Drop any queued audio so the next session starts clean.
  {
    std::lock_guard<std::mutex> lk(this->inbound_mutex_);
    this->inbound_.clear();
    this->inbound_front_offset_ = 0;
  }
  {
    std::lock_guard<std::mutex> lk(this->outbound_mutex_);
    this->outbound_.clear();
  }
  this->set_state_(State::IDLE);
  this->teardown_reason_ = "unknown";  // reset for next session
}

void VoixRealtimeClient::send_text_(const std::string &payload) {
  if (this->ws_ == nullptr) {
    return;
  }
  if (!esp_websocket_client_is_connected(this->ws_)) {
    ESP_LOGW(TAG, "send_text: WS not connected, dropping: %s", payload.c_str());
    return;
  }
  esp_websocket_client_send_text(this->ws_, payload.c_str(),
                                 static_cast<int>(payload.size()), portMAX_DELAY);
}

// ─── WS event handler shims (called from WS task thread) ─────────────────────

void VoixRealtimeClient::on_ws_connected_from_isr() {
  this->pending_connected_.store(true);
}

void VoixRealtimeClient::on_ws_disconnected_from_isr() {
  this->pending_disconnected_.store(true);
}

void VoixRealtimeClient::on_ws_error_from_isr() {
  this->pending_error_.store(true);
}

void VoixRealtimeClient::on_ws_text_from_isr(const char *data, size_t len) {
  // Quick discriminator: substring-sniff the well-known server message
  // shapes. Robust JSON parsing happens on the main thread once we promote
  // this. Order matters — "user_speech_start" contains "speech_start" but
  // not "audio_start", so the audio checks below are safe alongside it.
  if (len < 4) {
    return;
  }
  if (memmem(data, len, "user_speech_start", 17) != nullptr) {
    this->pending_user_speech_start_.store(true);
  } else if (memmem(data, len, "user_speech_end", 15) != nullptr) {
    this->pending_user_speech_end_.store(true);
  } else if (memmem(data, len, "audio_start", 11) != nullptr) {
    this->pending_audio_start_.store(true);
  } else if (memmem(data, len, "audio_end", 9) != nullptr) {
    this->pending_audio_end_.store(true);
  }
}

void VoixRealtimeClient::on_ws_binary_from_isr(const uint8_t *data, size_t len) {
  if (len == 0 || this->speaker_ == nullptr) {
    return;
  }
  this->ws_bytes_received_ += static_cast<uint32_t>(len);

  // Allocate the chunk's buffer from PSRAM via PsramChunk. This is the
  // fix for the bad_alloc panics — internal SRAM was fragmenting under
  // per-chunk std::vector allocs, and the ESP32-S3's 8 MB of PSRAM was
  // sitting unused. PSRAM is plenty fast for 24 kHz mono PCM and doesn't
  // contend with WiFi/BT/mWW for internal SRAM.
  PsramChunk chunk(data, len);
  if (!chunk.ok()) {
    // PSRAM alloc failed (extremely unlikely with multi-MB free, but
    // covers the case where SPIRAM is fragmented or disabled). Trip the
    // heap-low flag so the main loop tears the session down before we
    // keep churning failed allocs.
    this->heap_low_.store(true);
    return;
  }

  std::lock_guard<std::mutex> lk(this->inbound_mutex_);
  if (this->inbound_.size() >= MAX_INBOUND_CHUNKS) {
    // Drop oldest. Better than blocking the WS task or filling unbounded.
    this->inbound_.pop_front();
  }
  this->inbound_.emplace_back(std::move(chunk));
}

// ─── Audio pumps (main loop) ────────────────────────────────────────────────

void VoixRealtimeClient::on_mic_data_(const std::vector<uint8_t> &data) {
  this->mic_chunks_seen_++;  // counts EVERY callback even when idle, so we can
                              // tell whether the mic is producing at all
  // Fast path: drop if we're not in an active session. The mic source fires
  // continuously while the mic is running (shared with voice_assistant / mWW).
  //
  // ALSO drop while the speaker is actively running — full half-duplex on
  // device. The Voice PE's hardware AEC residual still bleeds the model's
  // own voice into the mic; if we forward that to the daemon → OpenAI,
  // semantic_vad fires on it as a fake user turn and the model cancels its
  // own response mid-sentence. Gating on the speaker's own running state
  // (rather than a daemon-sent flag) means the puck decides locally —
  // mic stays muted exactly as long as the speaker queue is draining,
  // no protocol round-trip required. Loses barge-in. Worth it.
  if (this->state_ != State::RUNNING || data.empty()) {
    return;
  }
  if (this->speaker_ != nullptr && this->speaker_->is_running()) {
    return;
  }

  // Data arrives from MicrophoneSource already converted to 16-bit mono
  // PCM at the mic's native sample rate (16 kHz) — chunks are ~1 KB. No
  // heap precheck here: mic chunks are too small to be the thing that
  // OOMs us, and tripping heap_low_ from this path was prematurely
  // closing sessions whenever internal SRAM fragmented (the WS library
  // / speaker chain / mWW also allocate from internal — none of which
  // we control), even though our own allocations were fine.
  // Batch small mic callbacks into chunks of ~MIC_BATCH_TARGET_BYTES
  // before queueing for send. The microphone fires ~800 callbacks/sec
  // with ~100 B each; sending each as its own WS frame keeps the WS
  // task too busy to drain inbound and triggers EAGAIN on send. With
  // ~2 KB batches we send ~40 frames/sec instead.
  this->mic_batch_.insert(this->mic_batch_.end(), data.begin(), data.end());
  if (this->mic_batch_.size() < MIC_BATCH_TARGET_BYTES) {
    return;
  }

  std::lock_guard<std::mutex> lk(this->outbound_mutex_);
  if (this->outbound_.size() >= MAX_OUTBOUND_CHUNKS) {
    // WS slower than mic. Drop oldest.
    this->outbound_.pop_front();
  }
  // PsramChunk allocates the payload from PSRAM — keeps the mic
  // payloads out of the tight internal SRAM that the WS client buffer
  // and other upstream components all share.
  PsramChunk chunk(this->mic_batch_.data(), this->mic_batch_.size());
  this->mic_batch_.clear();
  if (!chunk.ok()) {
    // PSRAM alloc failed (extremely unlikely with 8 MB available); just
    // drop this batch rather than blocking the audio thread.
    return;
  }
  this->outbound_.emplace_back(std::move(chunk));
}

void VoixRealtimeClient::pump_outbound_() {
  if (this->ws_ == nullptr) {
    return;
  }
  if (!esp_websocket_client_is_connected(this->ws_)) {
    // Drop any queued audio while disconnected.
    std::lock_guard<std::mutex> lk(this->outbound_mutex_);
    this->outbound_.clear();
    return;
  }
  // Drain a few chunks per loop tick; don't block the loop for long.
  for (int i = 0; i < 4; ++i) {
    PsramChunk chunk;
    {
      std::lock_guard<std::mutex> lk(this->outbound_mutex_);
      if (this->outbound_.empty()) {
        return;
      }
      chunk = std::move(this->outbound_.front());
      this->outbound_.pop_front();
    }
    int sent = esp_websocket_client_send_bin(
        this->ws_, reinterpret_cast<const char *>(chunk.data()),
        static_cast<int>(chunk.size()), 0);  // 0 = non-blocking
    if (sent < 0) {
      ESP_LOGW(TAG, "send_bin failed; dropping %u byte chunk",
               static_cast<unsigned>(chunk.size()));
    } else {
      this->mic_bytes_sent_ += static_cast<uint32_t>(sent);
    }
  }
}

void VoixRealtimeClient::pump_inbound_() {
  if (this->speaker_ == nullptr) {
    return;
  }
  // Do NOT call speaker_->start() here. The shared announcement_resampling_speaker
  // chain (resampler → mixer → i2s_audio_speaker) is owned by upstream; calling
  // start() on it tries to re-init the I2S driver, returns "Parent bus is busy",
  // and leaves the chain in an error state. play() is safe to call on a stopped
  // speaker — it accumulates into the ring buffer and plays when the chain comes
  // back up.

  // Right before the first play of a session, force the speaker's stream
  // info to 24 kHz. Doing this earlier (in start()) doesn't stick — other
  // upstream components reset the speaker's stream info while we wait for
  // OpenAI's first audio.delta. Doing it here, immediately before play(),
  // means the ResamplerSpeaker captures our rate when it auto-starts.
  if (this->speaker_rate_pending_) {
    bool has_data = false;
    {
      std::lock_guard<std::mutex> lk(this->inbound_mutex_);
      has_data = !this->inbound_.empty();
    }
    if (!has_data) {
      return;  // nothing to play yet; wait for first chunk
    }
    // If the chain is running (e.g. wake-word ack chime just played),
    // `set_audio_stream_info` is ignored — the resampler is mid-flight
    // and keeps its current input rate. Our `stop()` is async, so by the
    // time it propagates ~20 ms later, we've already pumped a chunk into
    // a 48 kHz-configured chain and the 24 kHz data plays at 2× speed.
    //
    // Robust pattern: ask for stop, return early, retry next tick. Once
    // is_running() is false, set_audio_stream_info sticks and the
    // resampler auto-starts with our config on the next play(). Don't
    // block the main loop with sleeps — pump_inbound_ is called every
    // loop tick (~16 ms), so the retry cadence is fast enough.
    if (this->speaker_->is_running()) {
      this->speaker_->stop();
      ESP_LOGD(TAG, "speaker still running on rate-pending; stop requested, retry next tick");
      return;
    }
    auto before = this->speaker_->get_audio_stream_info();
    this->speaker_->set_audio_stream_info(
        audio::AudioStreamInfo(/*bits_per_sample=*/16, /*channels=*/1, /*sample_rate=*/24000));
    ESP_LOGI(TAG, "speaker forced 24 kHz (was %u Hz, was stopped)",
             before.get_sample_rate());
    this->speaker_rate_pending_ = false;
    // Fall through to play loop below — the resampler will capture our
    // config on the first play() call.
  }

  // Drain a few chunks per tick. The speaker has its own buffer; play()
  // returns the count it accepted. We hold the mutex across the play()
  // call (with ticks_to_wait=0 so it never blocks) — this is essential:
  // the WS receive task can pop_front() when the queue overflows, which
  // would destroy the chunk we're holding a pointer into and feed garbage
  // to the speaker (the literal "puck screaming" symptom). Locking around
  // play() makes pop_front wait until we're done.
  for (int i = 0; i < 4; ++i) {
    std::unique_lock<std::mutex> lk(this->inbound_mutex_);
    if (this->inbound_.empty()) {
      return;
    }
    auto &front = this->inbound_.front();
    const uint8_t *data_ptr = front.data() + this->inbound_front_offset_;
    size_t data_len = front.size() - this->inbound_front_offset_;

    if (!this->logged_first_chunk_ && data_len > 0) {
      auto info = this->speaker_->get_audio_stream_info();
      ESP_LOGI(TAG, "first play: chunk=%u bytes, speaker info=%u Hz / %u bit / %u ch / running=%d",
               static_cast<unsigned>(data_len),
               info.get_sample_rate(), info.get_bits_per_sample(),
               info.get_channels(), this->speaker_->is_running() ? 1 : 0);
      char hex[64];
      size_t hn = data_len < 16 ? data_len : 16;
      for (size_t k = 0; k < hn; ++k) {
        snprintf(hex + k * 3, 4, "%02x ", data_ptr[k]);
      }
      ESP_LOGI(TAG, "first play head: %s", hex);
      this->logged_first_chunk_ = true;
    }

    // ticks_to_wait=0 — non-blocking. Returns however many bytes the
    // ring buffer could accept immediately. Safe to call under mutex.
    size_t accepted = this->speaker_->play(data_ptr, data_len, 0);
    this->speaker_bytes_played_ += accepted;
    if (accepted == 0) {
      // Hard back-pressure — speaker can't take anything right now. Stop
      // pumping this tick; try again next tick.
      return;
    }
    if (accepted < data_len) {
      // Partial — advance offset into front chunk. Next iteration / tick
      // resumes from where we left off, NO allocation.
      this->inbound_front_offset_ += accepted;
      return;
    }
    // Full accept — drop the chunk, reset offset, continue draining.
    this->inbound_.pop_front();
    this->inbound_front_offset_ = 0;
  }
}

}  // namespace voix_realtime_client
}  // namespace esphome
