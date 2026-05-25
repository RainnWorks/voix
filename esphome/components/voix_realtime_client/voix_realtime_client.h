#pragma once

#include <atomic>
#include <cstdint>
#include <string>

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

  // YAML setters (called from generated code)
  void set_server_url(const std::string &url) { this->server_url_ = url; }
  void set_microphone(microphone::Microphone *mic) { this->microphone_ = mic; }
  void set_speaker(speaker::Speaker *spk) { this->speaker_ = spk; }

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

  std::string server_url_;
  microphone::Microphone *microphone_{nullptr};
  speaker::Speaker *speaker_{nullptr};

  esp_websocket_client_handle_t ws_{nullptr};
  State state_{State::IDLE};
  std::atomic<bool> speaking_{false};

  // Deferred-event flags. Written from WS event handler thread,
  // drained on the main loop.
  std::atomic<bool> pending_connected_{false};
  std::atomic<bool> pending_disconnected_{false};
  std::atomic<bool> pending_error_{false};
  std::atomic<bool> pending_audio_start_{false};
  std::atomic<bool> pending_audio_end_{false};

  Trigger<> connected_trigger_{};
  Trigger<> disconnected_trigger_{};
  Trigger<> audio_out_start_trigger_{};
  Trigger<> audio_out_end_trigger_{};
  Trigger<> error_trigger_{};
};

// ─── Actions ─────────────────────────────────────────────────────────────────

template<typename... Ts>
class StartAction : public Action<Ts...>, public Parented<VoixRealtimeClient> {
 public:
  void play(Ts... x) override { this->parent_->start(); }
};

template<typename... Ts>
class StopAction : public Action<Ts...>, public Parented<VoixRealtimeClient> {
 public:
  void play(Ts... x) override { this->parent_->stop(); }
};

template<typename... Ts>
class InterruptAction : public Action<Ts...>, public Parented<VoixRealtimeClient> {
 public:
  void play(Ts... x) override { this->parent_->interrupt(); }
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
