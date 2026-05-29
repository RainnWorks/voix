"""Per-device session-state binary sensors.

`binary_sensor.voix_session_<device_slug>` — `on` while a voix WS session
is open to that Voice PE, `off` otherwise. Tracks the same `active_ws`
dict the supersede logic uses; updates via SIGNAL_SESSION_STATE_CHANGED.

Listening to this entity lets HA automations react to "a conversation is
happening right now" (e.g., dim the room lights, pause music).
"""
from __future__ import annotations

import logging

from homeassistant.components.binary_sensor import BinarySensorEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.dispatcher import async_dispatcher_connect
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .const import DOMAIN
from .util import device_slug

_LOGGER = logging.getLogger(__name__)


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    from . import CONF_DISCOVERED_DEVICES, SIGNAL_DEVICE_DISCOVERED

    bucket: dict[str, "VoixSessionBinarySensor"] = (
        hass.data.setdefault(DOMAIN, {}).setdefault("session_binary", {})
    )

    def _add_for(device_id: str, friendly_name: str | None) -> None:
        if device_id in bucket:
            return
        ent = VoixSessionBinarySensor(entry, device_id, friendly_name or device_id)
        bucket[device_id] = ent
        async_add_entities([ent])

    for dev_id, info in (entry.options.get(CONF_DISCOVERED_DEVICES) or {}).items():
        _add_for(dev_id, (info or {}).get("friendly_name"))

    @callback
    def _on_discovered(entry_id: str, device_id: str, friendly_name: str | None):
        if entry_id != entry.entry_id:
            return
        _add_for(device_id, friendly_name)

    entry.async_on_unload(
        async_dispatcher_connect(hass, SIGNAL_DEVICE_DISCOVERED, _on_discovered)
    )


class VoixSessionBinarySensor(BinarySensorEntity):
    """on = an OpenAI Realtime session is currently bridged for this device."""

    _attr_has_entity_name = False
    _attr_should_poll = False
    _attr_icon = "mdi:transit-connection-variant"

    def __init__(self, entry: ConfigEntry, device_id: str, friendly_name: str) -> None:
        self._entry = entry
        self._device_id = device_id
        slug = device_slug(device_id)
        self._attr_name = f"voix session {slug}"
        self.entity_id = f"binary_sensor.voix_session_{slug}"
        self._attr_unique_id = f"{entry.entry_id}-{slug}-voix-session"
        self._attr_device_info = {
            "identifiers": {(DOMAIN, device_id)},
            "name": friendly_name,
            "manufacturer": "Nabu Casa",
            "model": "Voice PE",
        }
        self._is_on = False

    @property
    def is_on(self) -> bool:
        return self._is_on

    async def async_added_to_hass(self) -> None:
        from . import SIGNAL_SESSION_STATE_CHANGED

        @callback
        def _on_state(device_id: str, active: bool) -> None:
            if device_id != self._device_id:
                return
            self._is_on = active
            self.async_write_ha_state()

        self.async_on_remove(
            async_dispatcher_connect(self.hass, SIGNAL_SESSION_STATE_CHANGED, _on_state)
        )
