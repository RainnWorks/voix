#include "voix_realtime_client.h"

#include "esphome/core/log.h"

namespace esphome {
namespace voix_realtime_client {

static const char *const TAG = "voix_realtime_client";

float VoixRealtimeClient::get_setup_priority() const {
  // Run after network is up so we have WS connectivity by the time someone
  // fires .start(). Same priority as other network-dependent components.
  return setup_priority::AFTER_WIFI;
}

void VoixRealtimeClient::setup() {
  ESP_LOGCONFIG(TAG, "voix_realtime_client setup (server=%s)", this->server_url_.c_str());
  this->set_state_(State::IDLE);
}

void VoixRealtimeClient::loop() {
  // TODO: WS pump + mic source drain.
  // Skeleton: nothing to do.
}

void VoixRealtimeClient::dump_config() {
  ESP_LOGCONFIG(TAG, "voix_realtime_client:");
  ESP_LOGCONFIG(TAG, "  Server URL: %s", this->server_url_.c_str());
  ESP_LOGCONFIG(TAG, "  Microphone: %s", this->microphone_ != nullptr ? "configured" : "MISSING");
  ESP_LOGCONFIG(TAG, "  Speaker:    %s", this->speaker_ != nullptr ? "configured" : "MISSING");
}

void VoixRealtimeClient::start() {
  if (this->state_ != State::IDLE) {
    ESP_LOGW(TAG, "start() called in state=%d; ignoring", (int) this->state_);
    return;
  }
  ESP_LOGI(TAG, "start: opening session");
  this->set_state_(State::CONNECTING);
  // TODO: open WebSocket, begin mic streaming.
  // For now, jump straight to RUNNING so triggers fire and we can wire LEDs.
  this->set_state_(State::RUNNING);
  this->connected_trigger_.trigger();
}

void VoixRealtimeClient::stop() {
  if (this->state_ == State::IDLE) {
    return;
  }
  ESP_LOGI(TAG, "stop: tearing down session");
  this->set_state_(State::STOPPING);
  // TODO: close WS, stop mic streaming.
  this->set_state_(State::IDLE);
  this->disconnected_trigger_.trigger();
}

void VoixRealtimeClient::interrupt() {
  if (!this->is_running()) {
    return;
  }
  ESP_LOGI(TAG, "interrupt: signalling server");
  // TODO: send interrupt message over WS.
}

void VoixRealtimeClient::set_state_(State new_state) {
  if (new_state == this->state_) {
    return;
  }
  ESP_LOGD(TAG, "state %d -> %d", (int) this->state_, (int) new_state);
  this->state_ = new_state;
}

}  // namespace voix_realtime_client
}  // namespace esphome
