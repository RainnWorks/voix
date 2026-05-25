"""Constants for the voix integration."""
from __future__ import annotations

DOMAIN = "voix"

# ─── Config-entry keys ───────────────────────────────────────────────────────
# Mode C (dictation conversation agent)
CONF_DICTATION_HELPER = "dictation_helper"
CONF_LED_RING_ENTITY = "led_ring_entity"
# Mode B (Realtime via STT/TTS engines through the HA pipeline)
CONF_OPENAI_API_KEY = "openai_api_key"
CONF_REALTIME_MODEL = "realtime_model"
CONF_REALTIME_VOICE = "realtime_voice"
CONF_REALTIME_INSTRUCTIONS = "realtime_instructions"

# ─── Defaults ────────────────────────────────────────────────────────────────
DEFAULT_DICTATION_HELPER = "input_text.voix_dictation_buffer"
DEFAULT_LED_RING_ENTITY = "light.home_assistant_voice_095e4e_led_ring"
DEFAULT_REALTIME_MODEL = "gpt-realtime"
DEFAULT_REALTIME_VOICE = "alloy"
DEFAULT_REALTIME_INSTRUCTIONS = (
    "You are a concise, friendly voice assistant. Keep responses brief — "
    "one or two short sentences — unless the user asks for detail."
)

# ─── Audio ───────────────────────────────────────────────────────────────────
# Voice PE / standard HA Assist STT pipeline metadata.
SATELLITE_SAMPLE_RATE = 16000
REALTIME_SAMPLE_RATE = 24000
AUDIO_FORMAT_BYTES_PER_SAMPLE = 2  # PCM16

# Idle timeout before we close the Realtime WS after the last activity.
# Multi-turn keeps the WS open across `continue_conversation` re-listens;
# this catches "user walked away" so we don't leak the OpenAI session.
REALTIME_IDLE_TIMEOUT_S = 45.0

# ─── HA bus events ───────────────────────────────────────────────────────────
EVENT_DICTATION_CAPTURED = "voix_dictation_captured"
EVENT_REALTIME_SESSION_STARTED = "voix_realtime_session_started"
EVENT_REALTIME_SESSION_ENDED = "voix_realtime_session_ended"
EVENT_REALTIME_TURN_END = "voix_realtime_turn_end"

# ─── OpenAI ──────────────────────────────────────────────────────────────────
REALTIME_WS_URL = "wss://api.openai.com/v1/realtime"

# OpenAI Realtime WebSocket
REALTIME_WS_URL = "wss://api.openai.com/v1/realtime"
