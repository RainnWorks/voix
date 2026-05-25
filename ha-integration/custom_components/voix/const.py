"""Constants for the voix integration."""
from __future__ import annotations

DOMAIN = "voix"

# Config-entry keys
CONF_SATELLITE_HOST = "satellite_host"
CONF_SATELLITE_PORT = "satellite_port"
CONF_NOISE_PSK = "noise_psk"
CONF_OPENAI_API_KEY = "openai_api_key"
CONF_REALTIME_MODEL = "realtime_model"
CONF_TRIGGER_WAKE_WORD = "trigger_wake_word"

# Defaults
DEFAULT_SATELLITE_PORT = 6053
DEFAULT_REALTIME_MODEL = "gpt-realtime"  # confirm exact GA name before shipping
DEFAULT_TRIGGER_WAKE_WORD = "Hey Mycroft"

# Audio
SATELLITE_SAMPLE_RATE = 16000   # Voice PE I2S mic & speaker
REALTIME_SAMPLE_RATE = 24000    # OpenAI Realtime PCM16 default
AUDIO_FORMAT_BYTES_PER_SAMPLE = 2  # PCM16

# Events fired by the satellite firmware
EVENT_REALTIME_REQUESTED = "voix.realtime_requested"
EVENT_REALTIME_STOP_REQUESTED = "voix.realtime_stop_requested"

# Internal events on HA bus
EVENT_REALTIME_SESSION_STARTED = "voix_realtime_session_started"
EVENT_REALTIME_SESSION_ENDED = "voix_realtime_session_ended"

# OpenAI Realtime WebSocket
REALTIME_WS_URL = "wss://api.openai.com/v1/realtime"
