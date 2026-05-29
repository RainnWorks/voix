#pragma once

#include <atomic>
#include <cstdint>
#include <cstring>
#include <deque>
#include <memory>
#include <mutex>
#include <string>
#include <vector>

#include "esp_heap_caps.h"

#include "esphome/components/microphone/microphone_source.h"
#include "esphome/core/automation.h"
#include "esphome/core/component.h"
#include "esphome/core/helpers.h"

// Forward-declared so we don't drag esp_websocket_client.h into every includer.
typedef struct esp_websocket_client *esp_websocket_client_handle_t;

namespace esphome {

namespace microphone {
class Microphone;
}
namespace speaker {
class Speaker;
}

namespace voix_realtime_client {

// Owns an audio chunk allocated from internal DMA-capable RAM. We use
// `MALLOC_CAP_INTERNAL | MALLOC_CAP_DMA` (rather than std::vector's default
// allocator) so that:
//   1. We can opt to move to PSRAM-via-DMA in the future via a build flag,
//      without re-plumbing the type.
//   2. The audio buffer is guaranteed DMA-readable — the I2S speaker
//      chain reads via DMA, and PSRAM-only buffers caused the speaker
//      to play uninitialised garbage at deafening volume (the puck
//      literally screamed at us). DMA-capable internal RAM is the safe
//      default on ESP32-S3.
//
// The heap-low circuit-breaker (see voix_realtime_client.cpp) catches
// the real failure mode the original `std::vector` version had — alloc
// failure under fragmentation crashing the device — by tripping a flag
// the main loop uses to tear the session down gracefully.
//
// Move-only; `data()` is null + `size()` is 0 if the alloc failed.
class PsramChunk {
 public:
  PsramChunk() = default;
  PsramChunk(const uint8_t *src, size_t len) {
    if (len == 0) return;
    // MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT: byte-aligned PSRAM. The
    // SPIRAM-only flag alone fails for sub-32-bit allocations on most
    // ESP-IDF configurations even with 8 MB of PSRAM free — exactly the
    // bug we hit (TEARDOWN reason=heap_low with PSRAM untouched). Adding
    // 8BIT matches upstream ESPHome's `RAMAllocator` default for PSRAM
    // and unblocks any size of allocation.
    //
    // We fall back to internal-DMA RAM if PSRAM is somehow unavailable
    // (e.g. a Voice PE variant without PSRAM, or PSRAM exhausted).
    constexpr uint32_t psram_caps = MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT;
    constexpr uint32_t internal_caps = MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT;
    data_ = static_cast<uint8_t *>(heap_caps_malloc_prefer(
        len, 2, psram_caps, internal_caps));
    if (data_ != nullptr) {
      std::memcpy(data_, src, len);
      size_ = len;
    }
    // If both alloc paths failed, leave data_=nullptr/size_=0 — caller
    // checks ok() and trips heap_low_.
  }
  ~PsramChunk() {
    if (data_ != nullptr) heap_caps_free(data_);
  }
  PsramChunk(const PsramChunk &) = delete;
  PsramChunk &operator=(const PsramChunk &) = delete;
  PsramChunk(PsramChunk &&o) noexcept : data_(o.data_), size_(o.size_) {
    o.data_ = nullptr;
    o.size_ = 0;
  }
  PsramChunk &operator=(PsramChunk &&o) noexcept {
    if (this != &o) {
      if (data_ != nullptr) heap_caps_free(data_);
      data_ = o.data_;
      size_ = o.size_;
      o.data_ = nullptr;
      o.size_ = 0;
    }
    return *this;
  }
  const uint8_t *data() const { return data_; }
  size_t size() const { return size_; }
  bool ok() const { return data_ != nullptr; }

 private:
  uint8_t *data_{nullptr};
  size_t size_{0};
};

// Top-level state of the Realtime session. Set from the main loop only —
// the WS event handler thread defers state transitions through flags.
enum class State : uint8_t {
  IDLE = 0,        // No session. Not connected to server.
  CONNECTING,      // WS client started; handshake in progress.
  RUNNING,         // WS open. (Mic streaming + speaker playback come later.)
  STOPPING,        // Tearing down on demand.
};

class VoixRealtimeClient : public Component {
 public:
  // Component lifecycle
  void setup() override;
  void loop() override;
  void dump_config() override;
  float get_setup_priority() const override;

  // YAML setters (called from generated code). For URL + token we also
  // accept runtime updates from HA via the `voix_set_server` API action
  // — the integration pushes the WS endpoint + shared secret once HA's
  // ESPHome adoption is complete, so no compile-time secret is needed.
  // Setting either at runtime persists to NVS so the device survives a
  // reboot without needing HA to re-push.
  void set_server_url(const std::string &url);
  void set_ws_token(const std::string &tok);
  void set_microphone(microphone::Microphone *mic) { this->microphone_ = mic; }
  void set_speaker(speaker::Speaker *spk) { this->speaker_ = spk; }

  // M08: capability handshake state. HA pushes the user's active voice
  // + mode-type via voix_set_state; we stamp them here so the next
  // session's hello carries them. Both can be empty until HA pushes,
  // in which case the daemon falls back to the default voice +
  // discuss intent. We don't persist these to NVS — HA re-pushes
  // on every adoption, so a reboot picking up "" is fine and avoids
  // the flash-write cost on every mode cycle.
  void set_voice_id(const std::string &id) { this->voice_id_ = id; }
  void set_mode_type(const std::string &t) { this->mode_type_ = t; }

  // Actions
  void start();
  void stop();
  void interrupt();

  // Conditions
  bool is_running() const { return this->state_ == State::RUNNING; }
  bool is_speaking() const { return this->speaking_.load(); }

  // Triggers (returned to the YAML automation system in __init__.py)
  Trigger<> *get_connected_trigger() { return &this->connected_trigger_; }
  Trigger<> *get_disconnected_trigger() { return &this->disconnected_trigger_; }
  Trigger<> *get_user_speech_start_trigger() { return &this->user_speech_start_trigger_; }
  Trigger<> *get_user_speech_end_trigger() { return &this->user_speech_end_trigger_; }
  Trigger<> *get_audio_out_start_trigger() { return &this->audio_out_start_trigger_; }
  Trigger<> *get_audio_out_end_trigger() { return &this->audio_out_end_trigger_; }
  Trigger<> *get_error_trigger() { return &this->error_trigger_; }

  // Internal — invoked by the static WS event handler. Don't touch ESPHome
  // state from these; just queue flags / buffers that `loop()` will drain.
  void on_ws_connected_from_isr();
  void on_ws_disconnected_from_isr();
  void on_ws_error_from_isr();
  void on_ws_text_from_isr(const char *data, size_t len);
  void on_ws_binary_from_isr(const uint8_t *data, size_t len);

 protected:
  void set_state_(State new_state);
  void teardown_();
  void send_text_(const std::string &payload);
  void on_mic_data_(const std::vector<uint8_t> &data);
  void pump_outbound_();
  void pump_inbound_();
  // Pre-allocates the ws_ handle + its 16 KB recv buffer at boot, when
  // heap is fresh. Re-used across sessions via esp_websocket_client_set_uri
  // + _start / _stop. Returns true on success (or if already allocated).
  bool init_ws_client_();

  std::string server_url_;
  std::string ws_token_;
  // M08 capability-handshake state. See set_voice_id / set_mode_type.
  std::string voice_id_;
  std::string mode_type_;
  microphone::Microphone *microphone_{nullptr};
  // Helper that converts the raw 32-bit stereo i2s_mics stream to 16-bit
  // mono using channel 0 (the voice_kit AEC-processed mic). passive=true
  // means we listen alongside other consumers (voice_assistant, mWW)
  // without trying to own the mic lifecycle.
  std::unique_ptr<microphone::MicrophoneSource> mic_source_;
  speaker::Speaker *speaker_{nullptr};

  esp_websocket_client_handle_t ws_{nullptr};
  State state_{State::IDLE};
  std::atomic<bool> speaking_{false};
  bool mic_callback_registered_{false};

  // Deferred-event flags. Written from WS event handler thread,
  // drained on the main loop.
  std::atomic<bool> pending_connected_{false};
  std::atomic<bool> pending_disconnected_{false};
  std::atomic<bool> pending_error_{false};
  std::atomic<bool> pending_audio_start_{false};
  std::atomic<bool> pending_audio_end_{false};
  std::atomic<bool> pending_user_speech_start_{false};
  std::atomic<bool> pending_user_speech_end_{false};
  // Set when an allocation fails or the heap drops below the safety
  // margin. Main loop checks this and tears down the session gracefully
  // before the next allocation panics the device.
  std::atomic<bool> heap_low_{false};

 public:
  // Last reason we called teardown_(), for diagnostics. Stamped by every
  // code path that initiates a teardown before invoking it; the teardown
  // function dumps it alongside heap + stats. Use short ASCII keys so
  // log filtering is easy ("ws_disconnect_event", "ws_close_frame",
  // "ws_start_failed", "heap_low", "external_stop").
  //
  // Public so the static `s_ws_event_handler` (which is a free function,
  // not a class member) can stamp it from the WS task before raising the
  // disconnect pending flag. The field is a `const char *` to a static
  // string — assignment is atomic enough on ESP32 for diagnostic use.
  const char *teardown_reason_{"unknown"};

  // Re-assembly state for fragmented WS messages. ESP-IDF's
  // esp_websocket_client delivers messages larger than `buffer_size`
  // as multiple WEBSOCKET_EVENT_DATA events, each with a slice
  // (payload_offset, data_len) of the full payload (payload_len).
  // We accumulate the slices into a PSRAM buffer until complete, then
  // fan out to the on_ws_{text,binary}_from_isr handlers as a single
  // logical message — so the rest of the code doesn't see fragments.
  //
  // Pre-allocated ONCE and reused across frames. We initially malloc'd
  // per frame, which kept the WS task busy enough that concurrent mic
  // sends started returning EAGAIN — fatal to esp_websocket_client.
  // Pre-allocating eliminates the per-frame malloc/free pair entirely.
  // Capacity grows on demand for unusually large frames.
  uint8_t *reasm_buf_{nullptr};
  size_t reasm_capacity_{0};
  size_t reasm_total_{0};
  size_t reasm_offset_{0};
  uint8_t reasm_op_code_{0};
  static constexpr size_t REASM_INITIAL_CAPACITY = 65536;

  // Mic batching. The MicrophoneSource fires callbacks ~800/sec with
  // ~100 B per callback — sending each as its own WS frame keeps the
  // WS task busy enough that recv events get delayed. Combine into
  // larger batches (~2 KB ≈ 64 ms at 16 kHz mono PCM16) before
  // queueing for send. Cuts WS-frame rate by ~20×.
  std::vector<uint8_t> mic_batch_;
  static constexpr size_t MIC_BATCH_TARGET_BYTES = 2048;

 protected:

  // Mic → WS queue. Audio callback fires on a separate task; main loop
  // drains and ships chunks out the WebSocket. Cap with MAX_OUTBOUND
  // and drop on overflow rather than blocking the audio thread.
  //
  // PsramChunk (not std::vector) so the ~1 KB mic payloads land in
  // PSRAM rather than the much tighter internal SRAM. At 32 chunks
  // that's ~32 KB of internal SRAM we free up for the WS client
  // buffer, the chime, and the brief overlap with voice_assistant
  // teardown at wake-word time — the heap-exhaustion path that broke
  // `esp_websocket_client_init` after the wake-word chime.
  static constexpr size_t MAX_OUTBOUND_CHUNKS = 32;
  std::deque<PsramChunk> outbound_;
  std::mutex outbound_mutex_;

  // WS binary → speaker queue. WS event handler pushes received audio;
  // main loop pops and feeds the speaker.
  //
  // The HA bridge throttles audio.delta forwarding to ~realtime + 1 s
  // lookahead. We size for the WORST-case chunk distribution: when
  // OpenAI emits many small chunks (1–2 KB each) instead of large ones,
  // 1 second of audio at 24 kHz mono 16-bit (= 48 KB) packs into ~24–48
  // chunks. The previous 32-chunk cap caused the eviction-on-overflow
  // path to fire mid-response on long answers — front-of-queue chunks
  // got dropped just before the speaker reached them, producing the
  // "good for a while, then nasty noise" symptom.
  //
  // 96 gives 3× safety headroom for tiny-chunk responses. Each chunk
  // is small (≤ ~12 KB typically), allocated from PSRAM, so the worst
  // case is ~1 MB of PSRAM — trivial on the Voice PE's 8 MB PSRAM.
  static constexpr size_t MAX_INBOUND_CHUNKS = 96;
  std::deque<PsramChunk> inbound_;
  std::mutex inbound_mutex_;
  // Byte offset into inbound_.front() — tracks partial accepts from the
  // speaker without allocating a new vector for the tail on each tick.
  // The original re-queue-with-emplace_front path heap-fragmented under
  // back-pressure and crashed.
  size_t inbound_front_offset_{0};
  // Set true at session start AND on every new `audio_start` (each new
  // model response within a session). Cleared after we force the speaker
  // to 24 kHz on the next pump tick that has data. Necessary because
  // other upstream components reset the speaker's stream info between
  // our responses — `announcement_resampling_speaker` transitions through
  // IDLE between turns, dropping back to its 48 kHz default. Without
  // re-arming this, the second turn of a multi-turn session plays at
  // 2× speed (24 kHz audio fed into a 48 kHz-configured chain).
  bool speaker_rate_pending_{false};
  // Per-session diagnostic: ensure "first play" rate log fires on every
  // session, not just once per firmware boot.
  bool logged_first_chunk_{false};
  // Last observed value of `speaker_->is_running()`, used in loop() to
  // detect the trailing edge (speaker queue just drained → mic is back
  // live → tell the daemon so its idle watchdog resets from the moment
  // the user can ACTUALLY speak, not from when the model stopped
  // emitting bytes a couple seconds earlier).
  bool was_speaker_running_{false};

  // Diagnostic counters; periodically logged so we can see if audio is
  // actually flowing without enabling VERY_VERBOSE on the device.
  uint32_t mic_chunks_seen_{0};
  uint32_t mic_bytes_sent_{0};
  uint32_t ws_bytes_received_{0};
  uint32_t speaker_bytes_played_{0};
  uint32_t last_stats_log_ms_{0};

  Trigger<> connected_trigger_{};
  Trigger<> disconnected_trigger_{};
  Trigger<> user_speech_start_trigger_{};
  Trigger<> user_speech_end_trigger_{};
  Trigger<> audio_out_start_trigger_{};
  Trigger<> audio_out_end_trigger_{};
  Trigger<> error_trigger_{};
};

// ─── Actions ─────────────────────────────────────────────────────────────────

template<typename... Ts>
class StartAction : public Action<Ts...>, public Parented<VoixRealtimeClient> {
 public:
  void play(const Ts &... x) override { this->parent_->start(); }
};

template<typename... Ts>
class StopAction : public Action<Ts...>, public Parented<VoixRealtimeClient> {
 public:
  void play(const Ts &... x) override { this->parent_->stop(); }
};

template<typename... Ts>
class InterruptAction : public Action<Ts...>, public Parented<VoixRealtimeClient> {
 public:
  void play(const Ts &... x) override { this->parent_->interrupt(); }
};

// ─── Conditions ──────────────────────────────────────────────────────────────

template<typename... Ts>
class IsRunningCondition : public Condition<Ts...>, public Parented<VoixRealtimeClient> {
 public:
  bool check(Ts... x) override { return this->parent_->is_running(); }
};

template<typename... Ts>
class IsSpeakingCondition : public Condition<Ts...>, public Parented<VoixRealtimeClient> {
 public:
  bool check(Ts... x) override { return this->parent_->is_speaking(); }
};

}  // namespace voix_realtime_client
}  // namespace esphome
