#pragma once

#include "esphome/core/automation.h"
#include "esphome/core/component.h"
#include "esphome/core/helpers.h"

namespace esphome {

namespace microphone {
class Microphone;
}
namespace speaker {
class Speaker;
}

namespace voix_realtime_client {

// Top-level state of the Realtime session.
enum class State : uint8_t {
  IDLE = 0,        // No session. Not connected to server.
  CONNECTING,      // WS handshake in progress.
  RUNNING,         // WS open. Streaming mic to server.
  SPEAKING,        // Server is sending audio for us to play.
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
  bool is_running() const { return this->state_ == State::RUNNING || this->state_ == State::SPEAKING; }
  bool is_speaking() const { return this->state_ == State::SPEAKING; }

  // Triggers (returned to the YAML automation system in __init__.py)
  Trigger<> *get_connected_trigger() { return &this->connected_trigger_; }
  Trigger<> *get_disconnected_trigger() { return &this->disconnected_trigger_; }
  Trigger<> *get_audio_out_start_trigger() { return &this->audio_out_start_trigger_; }
  Trigger<> *get_audio_out_end_trigger() { return &this->audio_out_end_trigger_; }
  Trigger<> *get_error_trigger() { return &this->error_trigger_; }

 protected:
  void set_state_(State new_state);

  std::string server_url_;
  microphone::Microphone *microphone_{nullptr};
  speaker::Speaker *speaker_{nullptr};

  State state_{State::IDLE};

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
