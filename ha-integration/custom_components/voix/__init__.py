"""voix integration entry point.

Registers three HA Assist-pipeline platforms on top of a stock Voice PE
(or any HA Assist satellite). All hardware-agnostic; no per-device config.

  - conversation.dictation  — Mode C: captures STT result to an input_text
                              helper, flashes the LED, returns empty speech.
  - conversation.realtime   — Mode B: signals continue_conversation=true so
                              the satellite re-listens after each TTS playback
                              (multi-turn Realtime).
  - stt.realtime            — Mode B: streams the pipeline's audio to OpenAI
                              Realtime, returns transcript, stashes response
                              audio on the session.
  - tts.realtime            — Mode B: hands back the response audio captured
                              by the STT step.

Mode A (HA Assist) is unchanged — still uses HA's default conversation +
whichever STT/TTS the user picks per pipeline.

The Realtime session is owned by `RealtimeManager`, one per config entry.
See realtime.py for the WS lifecycle.
"""
from __future__ import annotations

import logging

from homeassistant.config_entries import ConfigEntry
from homeassistant.const import Platform
from homeassistant.core import HomeAssistant

from .const import DOMAIN
from .realtime import RealtimeManager
from .ws_view import VoixRealtimeView

_LOGGER = logging.getLogger(__name__)

PLATFORMS: list[Platform] = [
    Platform.CONVERSATION,
    Platform.STT,
    Platform.TEXT,
    Platform.TTS,
]


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Set up voix from a config entry."""
    manager = RealtimeManager(hass, entry.data)
    hass.data.setdefault(DOMAIN, {})[entry.entry_id] = manager

    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)

    # Register the WebSocket endpoint the firmware's voix_realtime_client
    # connects to. Always registered; refuses connections with a 503 if no
    # OpenAI key is configured.
    hass.http.register_view(VoixRealtimeView(hass, dict(entry.data)))

    if not manager.configured:
        _LOGGER.info(
            "voix: Mode C (dictation) ready. Mode B (Realtime) disabled — "
            "add an OpenAI API key via Reconfigure to enable."
        )
    else:
        _LOGGER.info(
            "voix: Mode C + Mode B ready. Firmware WS endpoint at "
            "/api/voix/realtime"
        )

    entry.async_on_unload(manager.close)
    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    unloaded = await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
    manager: RealtimeManager | None = hass.data.get(DOMAIN, {}).pop(entry.entry_id, None)
    if manager is not None:
        await manager.close()
    return unloaded
