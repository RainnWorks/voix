"""voix — Mode C (dictation conversation agent) + Mode B (Realtime bridge).

Adds two features on top of a stock Voice PE running upstream firmware:

* A **conversation entity** (`conversation.voix_dictation`) used by the
  voix-dictation pipeline: writes the transcript to an input_text helper,
  flashes the satellite's LED ring, and returns empty speech so HA doesn't
  speak a fake reply. See `conversation.py`.

* A **Realtime bridge** (Mode B) activated by a wake word on the satellite
  (default: "Hey Mycroft"). The firmware fires `voix.realtime_requested`;
  we claim the voice_assistant subscription via aioesphomeapi, bridge
  audio to OpenAI Realtime, and release on session end. See `realtime.py`.

See ../../docs/architecture.md.
"""
from __future__ import annotations

import logging

from homeassistant.config_entries import ConfigEntry
from homeassistant.const import Platform
from homeassistant.core import Event, HomeAssistant, callback

from .const import (
    CONF_NOISE_PSK,
    CONF_OPENAI_API_KEY,
    CONF_SATELLITE_HOST,
    DOMAIN,
    EVENT_REALTIME_REQUESTED,
    EVENT_REALTIME_STOP_REQUESTED,
)
from .realtime import RealtimeBridge

_LOGGER = logging.getLogger(__name__)

PLATFORMS: list[Platform] = [Platform.CONVERSATION]


def _realtime_configured(entry: ConfigEntry) -> bool:
    """True if the entry has the fields needed for the Realtime bridge."""
    return all(
        entry.data.get(k)
        for k in (CONF_SATELLITE_HOST, CONF_NOISE_PSK, CONF_OPENAI_API_KEY)
    )


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Set up voix from a config entry."""
    # Mode C: register the dictation conversation entity. Always on; the
    # entity is harmless if no pipeline points at it.
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)

    # Mode B: spin up the Realtime bridge only if fully configured.
    if not _realtime_configured(entry):
        _LOGGER.info(
            "voix Mode C (conversation agent) ready; Realtime bridge disabled "
            "(no satellite_host/noise_psk/openai_api_key configured)"
        )
        hass.data.setdefault(DOMAIN, {})[entry.entry_id] = None
        return True

    bridge = RealtimeBridge(hass, entry)
    await bridge.async_start()
    hass.data.setdefault(DOMAIN, {})[entry.entry_id] = bridge

    @callback
    def _on_request(event: Event) -> None:
        hass.async_create_task(bridge.async_start_session(event.data))

    @callback
    def _on_stop(event: Event) -> None:
        hass.async_create_task(bridge.async_stop_session(event.data))

    entry.async_on_unload(
        hass.bus.async_listen(EVENT_REALTIME_REQUESTED, _on_request)
    )
    entry.async_on_unload(
        hass.bus.async_listen(EVENT_REALTIME_STOP_REQUESTED, _on_stop)
    )
    entry.async_on_unload(bridge.async_stop)

    _LOGGER.info("voix ready (satellite=%s)", bridge.satellite_host)
    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Unload a voix config entry."""
    unloaded = await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
    bridge: RealtimeBridge | None = hass.data.get(DOMAIN, {}).pop(entry.entry_id, None)
    if bridge is not None:
        await bridge.async_stop()
    return unloaded
