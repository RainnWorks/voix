#include "voix_realtime_client.h"

#include "esphome/core/log.h"

#include "esp_event.h"
#include "esp_websocket_client.h"

namespace esphome {
namespace voix_realtime_client {

static const char *const TAG = "voix_realtime_client";

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
      ESP_LOGD(TAG, "ws CONNECTED");
      self->on_ws_connected_from_isr();
      break;
    case WEBSOCKET_EVENT_DISCONNECTED:
      ESP_LOGD(TAG, "ws DISCONNECTED");
      self->on_ws_disconnected_from_isr();
      break;
    case WEBSOCKET_EVENT_DATA:
      // op_code 0x01 = text frame, 0x02 = binary frame, 0x08 = close
      if (event->op_code == 0x01 && event->data_len > 0) {
        self->on_ws_text_from_isr(reinterpret_cast<const char *>(event->data_ptr),
                                  event->data_len);
      } else if (event->op_code == 0x02 && event->data_len > 0) {
        self->on_ws_binary_from_isr(reinterpret_cast<const uint8_t *>(event->data_ptr),
                                    event->data_len);
      }
      break;
    case WEBSOCKET_EVENT_ERROR:
      ESP_LOGW(TAG, "ws ERROR");
      self->on_ws_error_from_isr();
      break;
    default:
      break;
  }
}

// ─── Component lifecycle ─────────────────────────────────────────────────────

float VoixRealtimeClient::get_setup_priority() const {
  // After network is up — we'll be opening WebSockets.
  return setup_priority::AFTER_WIFI;
}

void VoixRealtimeClient::setup() {
  ESP_LOGCONFIG(TAG, "voix_realtime_client setup (server=%s)", this->server_url_.c_str());
}

void VoixRealtimeClient::loop() {
  if (this->pending_connected_.exchange(false)) {
    this->set_state_(State::RUNNING);
    // Greet the server so it knows who connected.
    // TODO: include a real device id + mode hint once the action takes args.
    this->send_text_(R"({"type":"hello"})");
    this->connected_trigger_.trigger();
  }
  if (this->pending_disconnected_.exchange(false)) {
    this->teardown_();
    this->disconnected_trigger_.trigger();
  }
  if (this->pending_error_.exchange(false)) {
    this->error_trigger_.trigger();
  }
  if (this->pending_audio_start_.exchange(false)) {
    this->speaking_.store(true);
    this->audio_out_start_trigger_.trigger();
  }
  if (this->pending_audio_end_.exchange(false)) {
    this->speaking_.store(false);
    this->audio_out_end_trigger_.trigger();
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

  esp_websocket_client_config_t cfg = {};
  cfg.uri = this->server_url_.c_str();
  cfg.reconnect_timeout_ms = 5000;
  cfg.network_timeout_ms = 10000;
  cfg.keep_alive_enable = true;
  cfg.keep_alive_idle = 10;
  cfg.keep_alive_interval = 5;
  cfg.keep_alive_count = 3;
  cfg.disable_pingpong_discon = false;
  cfg.buffer_size = 4096;

  this->ws_ = esp_websocket_client_init(&cfg);
  if (this->ws_ == nullptr) {
    ESP_LOGE(TAG, "esp_websocket_client_init failed");
    return;
  }
  esp_websocket_register_events(this->ws_, WEBSOCKET_EVENT_ANY, &s_ws_event_handler, this);
  esp_err_t err = esp_websocket_client_start(this->ws_);
  if (err != ESP_OK) {
    ESP_LOGE(TAG, "esp_websocket_client_start failed: %d", err);
    this->teardown_();
    return;
  }
  this->set_state_(State::CONNECTING);
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
  if (this->ws_ != nullptr) {
    esp_websocket_client_stop(this->ws_);
    esp_websocket_client_destroy(this->ws_);
    this->ws_ = nullptr;
  }
  this->speaking_.store(false);
  this->set_state_(State::IDLE);
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
  // Quick discriminator: peek at "audio_start" / "audio_end" markers without
  // parsing JSON in the ISR-ish path. Anything else, just log (later we'll
  // dispatch through a thread-safe queue).
  if (len < 4) {
    return;
  }
  // VERY lazy substring sniff. Server's JSON is well-known shape.
  // Robust JSON parsing happens later.
  if (memmem(data, len, "audio_start", 11) != nullptr) {
    this->pending_audio_start_.store(true);
  } else if (memmem(data, len, "audio_end", 9) != nullptr) {
    this->pending_audio_end_.store(true);
  }
}

void VoixRealtimeClient::on_ws_binary_from_isr(const uint8_t *data, size_t len) {
  // TODO: route to speaker. Push to a ring buffer that main loop drains and
  // calls speaker->play(). For v1, just count bytes via a debug log.
  ESP_LOGV(TAG, "ws BIN %u bytes", static_cast<unsigned>(len));
}

}  // namespace voix_realtime_client
}  // namespace esphome
