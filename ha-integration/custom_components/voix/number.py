"""Global voix-gateway number entities — backed by entry.options.

Currently exposes:

  - `number.voix_idle_timeout` — seconds without OpenAI activity before
    the bridge auto-closes a session. Configurable per integration; lives
    on the "voix gateway" virtual device for grouping.

The entity is backed by entry.options[CONF_IDLE_TIMEOUT_S]: reads it on
state lookup, writes it back via async_update_entry on user change. So
the options-flow form and this entity are always coherent.
"""
from __future__ import annotations

import logging

from homeassistant.components.number import NumberEntity, NumberMode
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .const import (
    CONF_IDLE_TIMEOUT_S,
    DEFAULT_IDLE_TIMEOUT_S,
    DOMAIN,
)
from .util import gateway_device_info

_LOGGER = logging.getLogger(__name__)


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    async_add_entities([VoixIdleTimeoutNumber(entry)])


class VoixIdleTimeoutNumber(NumberEntity):
    """Seconds of OpenAI silence before the bridge auto-closes."""

    _attr_has_entity_name = False
    _attr_should_poll = False
    _attr_native_min_value = 1.0
    _attr_native_max_value = 120.0
    _attr_native_step = 1.0
    _attr_native_unit_of_measurement = "s"
    _attr_mode = NumberMode.BOX
    _attr_icon = "mdi:timer-sand"

    def __init__(self, entry: ConfigEntry) -> None:
        self._entry = entry
        self._attr_name = "voix idle timeout"
        self.entity_id = "number.voix_idle_timeout"
        self._attr_unique_id = f"{entry.entry_id}-voix-idle-timeout"
        self._attr_device_info = gateway_device_info(DOMAIN)

    @property
    def native_value(self) -> float:
        val = self._entry.options.get(CONF_IDLE_TIMEOUT_S, DEFAULT_IDLE_TIMEOUT_S)
        try:
            return float(val)
        except (TypeError, ValueError):
            return DEFAULT_IDLE_TIMEOUT_S

    async def async_set_native_value(self, value: float) -> None:
        clamped = max(1.0, min(120.0, float(value)))
        new_opts = {**self._entry.options, CONF_IDLE_TIMEOUT_S: clamped}
        self.hass.config_entries.async_update_entry(self._entry, options=new_opts)
        self.async_write_ha_state()
        _LOGGER.info("voix: idle timeout → %.1fs", clamped)
