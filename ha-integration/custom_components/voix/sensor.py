"""voix sensors.

  - `sensor.voix_ws_token` — read-only diagnostic, gateway-level. The shared
    secret the firmware must echo in its hello message.
  - `sensor.voix_user_transcript_<slug>` and
    `sensor.voix_assistant_transcript_<slug>` — per-device transcript state.
    State holds the *filepath* of the on-disk transcript file (or "idle").
    Attributes carry status / char_count / session_id. The full text lives
    on disk and is fetched via the `voix.get_transcript` service.

Why filepaths and not the text itself: HA's entity-state field caps at
255 chars and total state+attributes serialise to ~16 KB max. Long
dictations and multi-turn realtime conversations blow past both.

The transcript sensors are populated by `_RealtimeBridge` /
`_DictationBridge` dispatching the SIGNAL_TRANSCRIPT_UPDATED signal —
see `_TranscriptStore` in `ws_view.py`. Each per-device pair is created
on first device discovery (same path used by select / text entities) and
persists across restarts via `entry.options[discovered_devices]`.
"""
from __future__ import annotations

import logging
from typing import Any

from homeassistant.components.sensor import SensorEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import EntityCategory
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.dispatcher import async_dispatcher_connect
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .const import (
    CONF_WS_TOKEN,
    DOMAIN,
    SIGNAL_TRANSCRIPT_UPDATED,
)
from .util import device_slug, gateway_device_info

_LOGGER = logging.getLogger(__name__)


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    # Gateway-level diagnostic sensor.
    async_add_entities([VoixWSTokenSensor(entry)])

    # Per-device transcript sensors created on discovery (one user, one
    # assistant per device). Same pattern as text.py / select.py.
    from . import SIGNAL_DEVICE_DISCOVERED  # local import: avoids cycles

    bucket: dict[str, list[VoixTranscriptSensor]] = (
        hass.data.setdefault(DOMAIN, {})
        .setdefault("transcript_sensors", {})
    )

    @callback
    def _on_discovered(entry_id: str, device_id: str, friendly_name: str | None) -> None:
        if entry_id != entry.entry_id:
            return
        if device_id in bucket:
            return
        ents = [
            VoixTranscriptSensor(entry, device_id, friendly_name or device_id, "user"),
            VoixTranscriptSensor(entry, device_id, friendly_name or device_id, "assistant"),
        ]
        bucket[device_id] = ents
        async_add_entities(ents)

    # Seed already-discovered devices (covers HA restart + re-load).
    from .const import CONF_MODES  # noqa: F401  (re-exported for completeness)
    for device_id, info in (entry.options.get("discovered_devices") or {}).items():
        _on_discovered(entry.entry_id, device_id, (info or {}).get("friendly_name"))

    entry.async_on_unload(
        async_dispatcher_connect(hass, SIGNAL_DEVICE_DISCOVERED, _on_discovered)
    )


class VoixWSTokenSensor(SensorEntity):
    """Read-only WS token display for copy-paste into device secrets."""

    _attr_has_entity_name = False
    _attr_should_poll = False
    _attr_entity_category = EntityCategory.DIAGNOSTIC
    _attr_icon = "mdi:key-variant"

    def __init__(self, entry: ConfigEntry) -> None:
        self._entry = entry
        self._attr_name = "voix WS token"
        self.entity_id = "sensor.voix_ws_token"
        self._attr_unique_id = f"{entry.entry_id}-voix-ws-token"
        self._attr_device_info = gateway_device_info(DOMAIN)

    @property
    def native_value(self) -> str:
        return self._entry.data.get(CONF_WS_TOKEN, "")


# ─── Per-device transcript sensors ──────────────────────────────────────────


class VoixTranscriptSensor(SensorEntity):
    """Per-device, per-role transcript sensor — points at a file on disk.

    State: absolute filepath of the current session's transcript file, or
      "idle" if no session has produced text yet on this device+role.
    Attributes:
      - status: "idle" | "streaming" | "complete"
      - char_count: current size of the file in characters
      - session_id: the session that produced this file
      - role / device_id: identification
    """

    _attr_has_entity_name = False
    _attr_should_poll = False
    _attr_icon = "mdi:waveform"

    def __init__(
        self,
        entry: ConfigEntry,
        device_id: str,
        friendly_name: str,
        role: str,
    ) -> None:
        assert role in ("user", "assistant")
        self._entry = entry
        self._device_id = device_id
        self._friendly_name = friendly_name
        self._role = role
        slug = device_slug(device_id)
        self._attr_name = f"voix {role} transcript {friendly_name}"
        self.entity_id = f"sensor.voix_{role}_transcript_{slug}"
        self._attr_unique_id = f"{entry.entry_id}-{device_id}-{role}-transcript"
        self._attr_device_info = {
            "identifiers": {(DOMAIN, device_id)},
            "name": friendly_name,
        }
        self._filepath: str = ""
        self._status: str = "idle"
        self._session_id: str = ""
        self._char_count: int = 0
        self._unsub = None

    async def async_added_to_hass(self) -> None:
        self._unsub = async_dispatcher_connect(
            self.hass,
            SIGNAL_TRANSCRIPT_UPDATED,
            self._on_signal,
        )

    async def async_will_remove_from_hass(self) -> None:
        if self._unsub is not None:
            self._unsub()
            self._unsub = None

    @callback
    def _on_signal(
        self,
        device_id: str,
        role: str,
        filepath: str,
        status: str,
        session_id: str,
        char_count: int,
    ) -> None:
        if device_id != self._device_id or role != self._role:
            return
        self._filepath = filepath or ""
        self._status = status
        self._session_id = session_id or ""
        self._char_count = int(char_count or 0)
        self.async_write_ha_state()

    @property
    def native_value(self) -> str:
        return self._filepath or "idle"

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        return {
            "status": self._status,
            "char_count": self._char_count,
            "role": self._role,
            "device_id": self._device_id,
            "session_id": self._session_id,
        }
