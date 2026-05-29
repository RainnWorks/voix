"""Per-device 'stop session' buttons.

`button.voix_stop_<device_slug>` — pressing it force-closes the active
WS session for that Voice PE, if one is open. No-op if no session.

Useful as a kill switch in the UI when the model goes off the rails, and
as something HA automations can press (e.g. shut everything down at
bedtime).
"""
from __future__ import annotations

import logging

from homeassistant.components.button import ButtonEntity
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

    bucket: dict[str, "VoixStopButton"] = (
        hass.data.setdefault(DOMAIN, {}).setdefault("stop_button", {})
    )

    def _add_for(device_id: str, friendly_name: str | None) -> None:
        if device_id in bucket:
            return
        ent = VoixStopButton(entry, device_id, friendly_name or device_id)
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


class VoixStopButton(ButtonEntity):
    """Press → force-close the active voix WS for this device."""

    _attr_has_entity_name = False
    _attr_should_poll = False
    _attr_icon = "mdi:close-circle-outline"

    def __init__(self, entry: ConfigEntry, device_id: str, friendly_name: str) -> None:
        self._entry = entry
        self._device_id = device_id
        slug = device_slug(device_id)
        self._attr_name = f"voix stop {slug}"
        self.entity_id = f"button.voix_stop_{slug}"
        self._attr_unique_id = f"{entry.entry_id}-{slug}-voix-stop"
        self._attr_device_info = {
            "identifiers": {(DOMAIN, device_id)},
            "name": friendly_name,
            "manufacturer": "Nabu Casa",
            "model": "Voice PE",
        }

    async def async_press(self) -> None:
        from homeassistant.helpers.dispatcher import async_dispatcher_send

        from . import SIGNAL_SESSION_STATE_CHANGED

        active = self.hass.data.get(DOMAIN, {}).get("active_ws") or {}
        ws = active.get(self._device_id)
        # Always dispatch session-off, even if there's no live WS — the
        # sensor can stick `on` if a prior session leaked (device crashed
        # mid-stream, ws.close() hung in finally). Pressing stop is the
        # user's way to say "this is over now."
        active.pop(self._device_id, None)
        async_dispatcher_send(
            self.hass, SIGNAL_SESSION_STATE_CHANGED, self._device_id, False
        )
        if ws is None or ws.closed:
            _LOGGER.info("voix stop: no active session for %s", self._device_id)
            return
        _LOGGER.info("voix stop: closing session for %s by button", self._device_id)
        try:
            import asyncio
            await asyncio.wait_for(ws.close(), timeout=2.0)
        except Exception:  # noqa: BLE001
            _LOGGER.debug("voix stop: ws.close() timed out / raised", exc_info=True)
