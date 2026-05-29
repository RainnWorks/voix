"""Per-voice 'preset' light entities.

For every voice in entry.options["modes"] (storage key kept for
back-compat), a `light.voix_voice_<id>` entity appears on the voix
gateway device. The light's color/brightness/effect ARE the voice's
stored preset — editing the light writes back to the catalog.

This gives HA's native color-picker UI for tuning per-voice lighting
without diving into the options flow. The actual outer-LED-ring colour
push on devices still goes through `light.<device>_led_ring` when the
voice changes; this entity is the editable source of truth.

`is_on` is always True — the entity represents a preset, not a runtime
state. Turning it off is a no-op. (HA's UI requires it to be turn-on-able
to show the color picker.)

M02c rename: entity_ids are now `light.voix_voice_*`. unique_ids stay
on the legacy `voix-mode-light-*` prefix so HA's registry keeps
tracking the same entity — they're invisible to the user, and the
M02c migration in `__init__.py` renames the entity_id on existing
installs to match.
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
from .voices import get_voices
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
    bucket: dict[str, "VoixVoiceLight"] = (
        hass.data.setdefault(DOMAIN, {}).setdefault("voice_light", {})
    )

    def _add_for(voice_id: str) -> None:
        if voice_id in bucket:
            return
        ent = VoixVoiceLight(entry, voice_id)
        bucket[voice_id] = ent
        async_add_entities([ent])

    def _orphan_unique_ids(live_ids: set[str]) -> list[str]:
        """Find voice-light unique_ids registered against this entry that
        don't correspond to a current voice. Returns entity_id strings."""
        # unique_id prefix kept as legacy "voix-mode-light-" so HA's
        # registry continues to track existing entities. Renaming
        # unique_ids would orphan every installed light.
        prefix = f"{entry.entry_id}-voix-mode-light-"
        registry = er.async_get(hass)
        orphans: list[str] = []
        for reg_entry in er.async_entries_for_config_entry(
            registry, entry.entry_id
        ):
            uid = reg_entry.unique_id or ""
            if not uid.startswith(prefix):
                continue
            voice_id = uid[len(prefix):]
            if voice_id not in live_ids:
                orphans.append(reg_entry.entity_id)
        return orphans

    def _purge_orphans(live_ids: set[str]) -> None:
        registry = er.async_get(hass)
        for entity_id in _orphan_unique_ids(live_ids):
            _LOGGER.info("voix: removing stale voice-light entity %s", entity_id)
            registry.async_remove(entity_id)

    live = set(get_voices(entry).keys())
    _purge_orphans(live)  # one-shot startup sweep
    for vid in live:
        _add_for(vid)

    # When the user adds/renames/deletes voices, refresh the light set.
    async def _on_options_update(
        _hass: HomeAssistant, updated_entry: ConfigEntry
    ) -> None:
        if updated_entry.entry_id != entry.entry_id:
            return
        live_ids = set(get_voices(updated_entry).keys())
        # Add lights for new voices.
        for vid in live_ids - bucket.keys():
            _add_for(vid)
        # Drop in-memory tracking for deleted voices and unregister their
        # entities so they stop showing in the HA UI.
        for vid in list(bucket.keys() - live_ids):
            bucket.pop(vid, None)
        _purge_orphans(live_ids)
        # Push state for existing ones (color may have changed via options
        # flow Voices form, which we still allow as an alternative path).
        for vid, ent in list(bucket.items()):
            if vid in live_ids:
                ent.async_write_ha_state()

    entry.async_on_unload(entry.add_update_listener(_on_options_update))


class VoixVoiceLight(LightEntity):
    """The colour preset for one voice, expressed as a HA light."""

    _attr_has_entity_name = False
    _attr_should_poll = False
    _attr_color_mode = ColorMode.RGB
    _attr_supported_color_modes = {ColorMode.RGB}
    _attr_effect_list = KNOWN_EFFECTS
    _attr_icon = "mdi:palette"

    def __init__(self, entry: ConfigEntry, voice_id: str) -> None:
        self._entry = entry
        self._voice_id = voice_id
        # Slug the voice id for entity_id stability (user-defined names
        # might contain spaces). entity_id stays predictable.
        slug = voice_id.replace("-", "_").replace(" ", "_").lower()
        self._attr_name = f"voix voice {voice_id}"
        self.entity_id = f"light.voix_voice_{slug}"
        # unique_id keeps the legacy "voix-mode-light-" prefix so HA's
        # registry continues to track the existing entity through the
        # M02c rename. It's an internal id; users never see it.
        self._attr_unique_id = f"{entry.entry_id}-voix-mode-light-{voice_id}"
        self._attr_device_info = gateway_device_info(DOMAIN)

    @property
    def _voice_def(self) -> dict:
        return (self._entry.options.get(CONF_MODES) or {}).get(self._voice_id) or {}

    @property
    def is_on(self) -> bool:
        # Always "on" — this is a preset, not a runtime light.
        return True

    @property
    def rgb_color(self) -> tuple[int, int, int]:
        c = self._voice_def.get("color") or [255, 255, 255]
        return (int(c[0]), int(c[1]), int(c[2]))

    @property
    def brightness(self) -> int:
        # Voice stores 0.0-1.0; HA expects 0-255.
        return int((float(self._voice_def.get("brightness") or 0.4)) * 255)

    @property
    def effect(self) -> str | None:
        return self._voice_def.get("effect") or "None"

    async def async_turn_on(self, **kwargs) -> None:
        voices = dict(get_voices(self._entry))
        if self._voice_id not in voices:
            return
        voice_def = dict(voices[self._voice_id])
        if ATTR_RGB_COLOR in kwargs:
            voice_def["color"] = list(kwargs[ATTR_RGB_COLOR])
        if ATTR_BRIGHTNESS in kwargs:
            voice_def["brightness"] = max(0.0, min(1.0, kwargs[ATTR_BRIGHTNESS] / 255))
        if ATTR_EFFECT in kwargs:
            voice_def["effect"] = kwargs[ATTR_EFFECT] or "None"
        voices[self._voice_id] = voice_def
        new_opts = {**self._entry.options, CONF_MODES: voices}
        self.hass.config_entries.async_update_entry(self._entry, options=new_opts)
        self.async_write_ha_state()
        _LOGGER.info(
            "voix voice '%s' lighting updated: color=%s brightness=%s effect=%s",
            self._voice_id, voice_def["color"], voice_def["brightness"], voice_def["effect"],
        )

    @callback
    def async_turn_off(self, **kwargs) -> None:
        # No-op: presets are always 'on' for editing purposes.
        return
