"""Per-mode 'preset' light entities.

For every mode in entry.options["modes"], a `light.voix_mode_<id>` entity
appears on the voix gateway device. The light's color/brightness/effect
ARE the mode's stored preset — editing the light writes back to the
catalog.

This gives HA's native color-picker UI for tuning per-mode lighting
without diving into the options flow. The actual outer-LED-ring colour
push on devices still goes through `light.<device>_led_ring` when the
mode changes; this entity is the editable source of truth.

`is_on` is always True — the entity represents a preset, not a runtime
state. Turning it off is a no-op. (HA's UI requires it to be turn-on-able
to show the color picker.)
"""
from __future__ import annotations

import logging

from homeassistant.components.light import (
    ATTR_BRIGHTNESS,
    ATTR_EFFECT,
    ATTR_RGB_COLOR,
    ColorMode,
    LightEntity,
)
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .const import CONF_MODES, DOMAIN
from .modes import get_modes
from .util import gateway_device_info

_LOGGER = logging.getLogger(__name__)

# Known effects shipped by upstream Voice PE's addressable LED setup.
# Users can free-type anything; if a custom effect isn't installed, the
# device just falls back to no-effect.
KNOWN_EFFECTS: list[str] = [
    "None",
    "Twinkle",
    "Listening For Command",
    "Replying",
]


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    bucket: dict[str, "VoixModeLight"] = (
        hass.data.setdefault(DOMAIN, {}).setdefault("mode_light", {})
    )

    def _add_for(mode_id: str) -> None:
        if mode_id in bucket:
            return
        ent = VoixModeLight(entry, mode_id)
        bucket[mode_id] = ent
        async_add_entities([ent])

    def _orphan_unique_ids(live_ids: set[str]) -> list[str]:
        """Find mode-light unique_ids registered against this entry that
        don't correspond to a current mode. Returns unique_id strings."""
        prefix = f"{entry.entry_id}-voix-mode-light-"
        registry = er.async_get(hass)
        orphans: list[str] = []
        for reg_entry in er.async_entries_for_config_entry(
            registry, entry.entry_id
        ):
            uid = reg_entry.unique_id or ""
            if not uid.startswith(prefix):
                continue
            mode_id = uid[len(prefix):]
            if mode_id not in live_ids:
                orphans.append(reg_entry.entity_id)
        return orphans

    def _purge_orphans(live_ids: set[str]) -> None:
        registry = er.async_get(hass)
        for entity_id in _orphan_unique_ids(live_ids):
            _LOGGER.info("voix: removing stale mode-light entity %s", entity_id)
            registry.async_remove(entity_id)

    live = set(get_modes(entry).keys())
    _purge_orphans(live)  # one-shot startup sweep
    for mid in live:
        _add_for(mid)

    # When the user adds/renames/deletes modes, refresh the light set.
    async def _on_options_update(
        _hass: HomeAssistant, updated_entry: ConfigEntry
    ) -> None:
        if updated_entry.entry_id != entry.entry_id:
            return
        live_ids = set(get_modes(updated_entry).keys())
        # Add lights for new modes.
        for mid in live_ids - bucket.keys():
            _add_for(mid)
        # Drop in-memory tracking for deleted modes and unregister their
        # entities so they stop showing in the HA UI.
        for mid in list(bucket.keys() - live_ids):
            bucket.pop(mid, None)
        _purge_orphans(live_ids)
        # Push state for existing ones (color may have changed via options
        # flow Modes form, which we still allow as an alternative path).
        for mid, ent in list(bucket.items()):
            if mid in live_ids:
                ent.async_write_ha_state()

    entry.async_on_unload(entry.add_update_listener(_on_options_update))


class VoixModeLight(LightEntity):
    """The colour preset for one mode, expressed as a HA light."""

    _attr_has_entity_name = False
    _attr_should_poll = False
    _attr_color_mode = ColorMode.RGB
    _attr_supported_color_modes = {ColorMode.RGB}
    _attr_effect_list = KNOWN_EFFECTS
    _attr_icon = "mdi:palette"

    def __init__(self, entry: ConfigEntry, mode_id: str) -> None:
        self._entry = entry
        self._mode_id = mode_id
        # Slug the mode id for entity_id stability (user-defined names
        # might contain spaces). entity_id stays predictable.
        slug = mode_id.replace("-", "_").replace(" ", "_").lower()
        self._attr_name = f"voix mode {mode_id}"
        self.entity_id = f"light.voix_mode_{slug}"
        self._attr_unique_id = f"{entry.entry_id}-voix-mode-light-{mode_id}"
        self._attr_device_info = gateway_device_info(DOMAIN)

    @property
    def _mode_def(self) -> dict:
        return (self._entry.options.get(CONF_MODES) or {}).get(self._mode_id) or {}

    @property
    def is_on(self) -> bool:
        # Always "on" — this is a preset, not a runtime light.
        return True

    @property
    def rgb_color(self) -> tuple[int, int, int]:
        c = self._mode_def.get("color") or [255, 255, 255]
        return (int(c[0]), int(c[1]), int(c[2]))

    @property
    def brightness(self) -> int:
        # Mode stores 0.0-1.0; HA expects 0-255.
        return int((float(self._mode_def.get("brightness") or 0.4)) * 255)

    @property
    def effect(self) -> str | None:
        return self._mode_def.get("effect") or "None"

    async def async_turn_on(self, **kwargs) -> None:
        modes = dict(get_modes(self._entry))
        if self._mode_id not in modes:
            return
        mode_def = dict(modes[self._mode_id])
        if ATTR_RGB_COLOR in kwargs:
            mode_def["color"] = list(kwargs[ATTR_RGB_COLOR])
        if ATTR_BRIGHTNESS in kwargs:
            mode_def["brightness"] = max(0.0, min(1.0, kwargs[ATTR_BRIGHTNESS] / 255))
        if ATTR_EFFECT in kwargs:
            mode_def["effect"] = kwargs[ATTR_EFFECT] or "None"
        modes[self._mode_id] = mode_def
        new_opts = {**self._entry.options, CONF_MODES: modes}
        self.hass.config_entries.async_update_entry(self._entry, options=new_opts)
        self.async_write_ha_state()
        _LOGGER.info(
            "voix mode '%s' lighting updated: color=%s brightness=%s effect=%s",
            self._mode_id, mode_def["color"], mode_def["brightness"], mode_def["effect"],
        )

    @callback
    def async_turn_off(self, **kwargs) -> None:
        # No-op: presets are always 'on' for editing purposes.
        return
