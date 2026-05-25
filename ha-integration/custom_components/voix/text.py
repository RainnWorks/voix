"""voix-owned text entities.

* `text.voix_dictation` — the most recent dictation transcript.
  Updated by the conversation agent (legacy path) AND by the WS bridge
  (new firmware path) whenever a dictation transcript arrives. Reading
  this entity in HA (or via the WebSocket API) is the canonical way to
  consume dictation output — replaces the user-created
  `input_text.voix_dictation_buffer` helper.

TODO (per-device): when a device opens our WS endpoint, it identifies
itself in its hello message. The WS view dispatches a "device discovered"
signal; this platform's setup_entry listens and calls async_add_entities
for that device's text entity (text.voix_dictation_<name>). Plus we
register a device_registry entry so HA's Devices page shows it. Until
that's implemented, all devices share the single global text entity
below.

Why a `text.*` entity and not `sensor.*`:
  - text state can be up to 255 chars (sensors get truncated at ~255 too,
    but `text` is semantically right for "this is some text we own")
  - exposed for reading + manual edits if the user wants
"""
from __future__ import annotations

import logging
from typing import Any

from homeassistant.components.text import TextEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .const import DOMAIN, EVENT_DICTATION_CAPTURED

_LOGGER = logging.getLogger(__name__)


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    async_add_entities([VoixDictationText(entry)])


class VoixDictationText(TextEntity):
    """Holds the most recent dictation transcript."""

    _attr_has_entity_name = True
    _attr_name = "Dictation"
    _attr_should_poll = False
    _attr_native_max = 1000
    _attr_native_min = 0
    _attr_mode = "text"

    def __init__(self, entry: ConfigEntry) -> None:
        self._entry = entry
        self._attr_unique_id = f"{entry.entry_id}-dictation-text"
        self._attr_native_value = ""
        self._unsub = None

    async def async_added_to_hass(self) -> None:
        # Receive transcript updates from both the legacy conversation-agent
        # path and the new WS-bridge path; both fire EVENT_DICTATION_CAPTURED.
        @callback
        def _on_captured(event):
            text = (event.data or {}).get("text") or ""
            self._attr_native_value = text[: self._attr_native_max]
            self.async_write_ha_state()

        self._unsub = self.hass.bus.async_listen(EVENT_DICTATION_CAPTURED, _on_captured)

    async def async_will_remove_from_hass(self) -> None:
        if self._unsub is not None:
            self._unsub()
            self._unsub = None

    async def async_set_value(self, value: str) -> None:
        """Allow manual edits from the UI."""
        self._attr_native_value = value
        self.async_write_ha_state()
