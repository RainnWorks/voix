"""voix — OpenAI Realtime bridge for Home Assistant Voice PE satellites.

Activated by a wake word (default: "Hey Mycroft") detected on the satellite.
The satellite's ESPHome firmware fires the `voix.realtime_requested` event;
we claim the voice_assistant subscription via aioesphomeapi, bridge audio to
OpenAI Realtime, and release on session end.

See ../../docs/architecture.md and ../../docs/adr/0001-hybrid-orchestration.md.
"""
from __future__ import annotations

import logging

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import Event, HomeAssistant, callback

from .const import (
    DOMAIN,
    EVENT_REALTIME_REQUESTED,
    EVENT_REALTIME_STOP_REQUESTED,
)
from .realtime import RealtimeBridge

_LOGGER = logging.getLogger(__name__)


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Set up voix from a config entry."""
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

    _LOGGER.info("voix realtime bridge ready (satellite=%s)", bridge.satellite_host)
    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Unload a voix config entry."""
    bridge: RealtimeBridge | None = hass.data.get(DOMAIN, {}).pop(entry.entry_id, None)
    if bridge is not None:
        await bridge.async_stop()
    return True
