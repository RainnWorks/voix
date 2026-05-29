"""voix mode select entities — one per discovered device.

Each Voice PE that opens our WS endpoint and sends a hello message gets a
`select.voix_mode_<device_id>` entity. Its options are the IDs of every
mode defined in the integration's options (entry.options["modes"]).

When the user adds/edits/deletes modes via the options flow, every
device's select picks up the new list (we listen for entry option updates).

State is the currently active mode_id. Cycling advances to the next
mode_id in catalog order — wrapping at the end.
"""
from __future__ import annotations

import logging

from homeassistant.components.select import SelectEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.dispatcher import async_dispatcher_connect
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.restore_state import RestoreEntity

from .const import (
    CONF_DEFAULT_MODE,
    CONF_DEFAULT_VOICE,
    DEFAULT_ASSIST_WAKE_WORD,
    DEFAULT_REALTIME_VOICE,
    DEFAULT_VOIX_WAKE_WORD,
    DOMAIN,
    EVENT_MODE_CHANGED,
    KNOWN_WAKE_WORDS,
    REALTIME_VOICES,
)
from .voices import get_default_voice_id, get_voice, get_voices
from .util import device_slug, gateway_device_info

_LOGGER = logging.getLogger(__name__)


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    from . import CONF_DISCOVERED_DEVICES, SIGNAL_DEVICE_DISCOVERED

    # Bucket key kept as "mode_select" to match the slot __init__.py
    # looks up under hass.data — renaming both atomically is the
    # cleaner refactor but raises the surface area of this rename.
    # The user-visible thing is the entity_id; this is internal.
    bucket = hass.data.setdefault(DOMAIN, {}).setdefault("mode_select", {})

    def _add_for(device_id: str, friendly_name: str | None) -> None:
        if device_id in bucket:
            return
        ent = VoixDeviceVoiceSelect(entry, device_id, friendly_name or device_id)
        bucket[device_id] = ent
        async_add_entities([ent])

    for dev_id, info in (entry.options.get(CONF_DISCOVERED_DEVICES) or {}).items():
        _add_for(dev_id, (info or {}).get("friendly_name"))

    @callback
    def _on_signal(entry_id: str, device_id: str, friendly_name: str | None):
        if entry_id != entry.entry_id:
            return
        _add_for(device_id, friendly_name)

    entry.async_on_unload(
        async_dispatcher_connect(hass, SIGNAL_DEVICE_DISCOVERED, _on_signal)
    )

    # Gateway-level globals: voice catalog + default mode. These live on
    # the virtual "voix gateway" device rather than any Voice PE.
    # Idle timeout is its own number sibling.
    gateway_entities = [
        VoixVoiceSelect(entry),
        VoixDefaultVoiceSelect(entry),
    ]
    async_add_entities(gateway_entities)

    # Per-device wake-word selects. Each Voice PE gets its OWN pair
    # (voix slot + assist slot). State stored per-device under
    # entry.options['discovered_devices'][device_id]. Setting them
    # pushes only to that device's wake_word / wake_word_2 selects.
    ww_bucket: dict[str, list] = (
        hass.data.setdefault(DOMAIN, {}).setdefault("wake_word_selects", {})
    )

    def _add_ww_for(device_id: str, friendly_name: str | None) -> None:
        if device_id in ww_bucket:
            return
        ents = [
            VoixDeviceWakeWordSelect(entry, device_id, friendly_name or device_id),
            VoixDeviceAssistWakeWordSelect(entry, device_id, friendly_name or device_id),
        ]
        ww_bucket[device_id] = ents
        async_add_entities(ents)

    for dev_id, info in (entry.options.get(CONF_DISCOVERED_DEVICES) or {}).items():
        _add_ww_for(dev_id, (info or {}).get("friendly_name"))

    @callback
    def _on_ww_discovered(entry_id: str, device_id: str, friendly_name: str | None):
        if entry_id != entry.entry_id:
            return
        _add_ww_for(device_id, friendly_name)

    entry.async_on_unload(
        async_dispatcher_connect(hass, SIGNAL_DEVICE_DISCOVERED, _on_ww_discovered)
    )
    # Stash for later refresh (when mode catalog changes).
    hass.data.setdefault(DOMAIN, {})["gateway_entities"] = gateway_entities

    # When the user edits modes (add/delete/rename), the options change.
    # Every device's select needs to refresh its options list.
    # `add_update_listener` requires an async callable.
    async def _on_options_update(
        _hass: HomeAssistant, updated_entry: ConfigEntry
    ) -> None:
        if updated_entry.entry_id != entry.entry_id:
            return
        for ent in bucket.values():
            ent.refresh_options()
        for ent in gateway_entities:
            if hasattr(ent, "refresh_options"):
                ent.refresh_options()

    entry.async_on_unload(entry.add_update_listener(_on_options_update))


class VoixDeviceVoiceSelect(SelectEntity, RestoreEntity):
    """Per-device voice select. Options come from the global voice catalog."""

    _attr_has_entity_name = False
    _attr_should_poll = False

    def __init__(self, entry: ConfigEntry, device_id: str, friendly_name: str) -> None:
        self._entry = entry
        self._device_id = device_id
        slug = device_slug(device_id)
        # unique_id keeps the legacy "voix-mode" suffix so HA's registry
        # continues to track existing entities. M02c migrates the
        # entity_id to the new "voix_voice_" prefix; unique_id is
        # internal-only and never visible to the user.
        self._attr_unique_id = f"{entry.entry_id}-{slug}-voix-mode"
        self._attr_name = f"voix voice {slug}"
        self.entity_id = f"select.voix_voice_{slug}"
        self._attr_options = list(get_voices(entry).keys())
        self._attr_current_option = get_default_voice_id(entry)
        self._attr_device_info = {
            "identifiers": {(DOMAIN, device_id)},
            "name": friendly_name,
            "manufacturer": "Nabu Casa",
            "model": "Voice PE",
        }

    @property
    def device_id(self) -> str:
        return self._device_id

    @property
    def extra_state_attributes(self) -> dict:
        """Expose the active mode's behavior type as an attribute.

        Firmware's `homeassistant.text_sensor` subscribes to this attribute
        (`attribute: behavior`) to decide whether to intercept the wake word.
        State values are user-defined mode_ids; behavior is always one of
        assist / dictation / realtime.
        """
        voice_def = get_voice(self._entry, self._attr_current_option)
        return {"behavior": voice_def.get("type", "assist")}

    async def async_added_to_hass(self) -> None:
        await super().async_added_to_hass()
        last_state = await self.async_get_last_state()
        if last_state and last_state.state in self._attr_options:
            self._attr_current_option = last_state.state

    async def async_select_option(self, option: str) -> None:
        if option not in self._attr_options:
            _LOGGER.warning("voix voice: rejected unknown option %r", option)
            return
        if option == self._attr_current_option:
            return
        prev = self._attr_current_option
        self._attr_current_option = option
        self.async_write_ha_state()
        _LOGGER.info("voix voice (%s): %s → %s", self._device_id, prev, option)
        self.hass.bus.async_fire(
            EVENT_MODE_CHANGED,
            {
                "entry_id": self._entry.entry_id,
                "device_id": self._device_id,
                "from": prev,
                "to": option,
            },
        )

    def cycle(self) -> str:
        opts = self._attr_options
        if not opts:
            return self._attr_current_option
        idx = opts.index(self._attr_current_option) if self._attr_current_option in opts else 0
        return opts[(idx + 1) % len(opts)]

    @callback
    def refresh_options(self) -> None:
        """Re-read the global mode catalog after the user added/removed a mode."""
        new_opts = list(get_voices(self._entry).keys())
        if new_opts == self._attr_options:
            return
        self._attr_options = new_opts
        # If the current selection vanished, fall back to the default.
        if self._attr_current_option not in new_opts:
            new_current = get_default_voice_id(self._entry) if new_opts else None
            if new_current and new_current in new_opts:
                self._attr_current_option = new_current
        self.async_write_ha_state()


# ─── Gateway-level globals ───────────────────────────────────────────────────


class VoixVoiceSelect(SelectEntity):
    """Global OpenAI Realtime voice — used by any mode that leaves `voice` blank.

    Options come from the fixed OpenAI Realtime voice catalog (10 voices as of
    2026-05). The 'marin' and 'cedar' voices are the newest / highest-quality.
    """

    _attr_has_entity_name = False
    _attr_should_poll = False
    _attr_options = REALTIME_VOICES
    _attr_icon = "mdi:account-voice"

    def __init__(self, entry: ConfigEntry) -> None:
        self._entry = entry
        self._attr_name = "voix voice"
        self.entity_id = "select.voix_voice"
        self._attr_unique_id = f"{entry.entry_id}-voix-voice"
        self._attr_device_info = gateway_device_info(DOMAIN)

    @property
    def current_option(self) -> str:
        v = self._entry.options.get(CONF_DEFAULT_VOICE) or self._entry.data.get(
            CONF_DEFAULT_VOICE, DEFAULT_REALTIME_VOICE
        )
        return v if v in REALTIME_VOICES else DEFAULT_REALTIME_VOICE

    async def async_select_option(self, option: str) -> None:
        if option not in REALTIME_VOICES:
            _LOGGER.warning("voix voice: rejected unknown voice %r", option)
            return
        new_opts = {**self._entry.options, CONF_DEFAULT_VOICE: option}
        self.hass.config_entries.async_update_entry(self._entry, options=new_opts)
        self.async_write_ha_state()
        _LOGGER.info("voix voice → %s", option)


class VoixDefaultVoiceSelect(SelectEntity):
    """Default mode_id for new devices on first sight + as a fallback target."""

    _attr_has_entity_name = False
    _attr_should_poll = False
    _attr_icon = "mdi:tune"

    def __init__(self, entry: ConfigEntry) -> None:
        self._entry = entry
        self._attr_name = "voix default voice"
        self.entity_id = "select.voix_default_voice"
        # unique_id stays legacy "voix-default-mode" for registry stability.
        self._attr_unique_id = f"{entry.entry_id}-voix-default-mode"
        self._attr_options = list(get_voices(entry).keys())
        self._attr_device_info = gateway_device_info(DOMAIN)

    @property
    def current_option(self) -> str:
        return get_default_voice_id(self._entry)

    async def async_select_option(self, option: str) -> None:
        if option not in self._attr_options:
            _LOGGER.warning("voix default_voice: rejected unknown voice_id %r", option)
            return
        new_opts = {**self._entry.options, CONF_DEFAULT_MODE: option}
        self.hass.config_entries.async_update_entry(self._entry, options=new_opts)
        self.async_write_ha_state()
        _LOGGER.info("voix default_voice → %s", option)

    @callback
    def refresh_options(self) -> None:
        """Re-read the global mode catalog when the user adds/removes a mode."""
        new_opts = list(get_voices(self._entry).keys())
        if new_opts != self._attr_options:
            self._attr_options = new_opts
            self.async_write_ha_state()


# ─── Wake-word slot management ───────────────────────────────────────────────
# voix owns the two wake-word slots on every discovered Voice PE. The
# gateway entities below are the user-facing controls; on change we push
# the value to each device's slot1 / slot2 wake_word select via the HA
# select.select_option service. On discovery we push the current values
# to that new device.


async def _push_pipeline_to_device(
    hass: HomeAssistant, device_id: str, slot: str, pipeline: str
) -> None:
    """Set one slot's HA Assist pipeline via select.select_option.

    `slot` is the entity suffix: "assistant" (slot 1) or "assistant_2" (slot 2).
    Used by the integration to point both slots at HA's default "preferred"
    pipeline so legacy voix-* pipelines don't intercept Okay Nabu.
    """
    target = f"select.{device_slug(device_id)}_{slot}"
    state = hass.states.get(target)
    if state is None:
        return
    options = (state.attributes or {}).get("options") or []
    if pipeline not in options:
        _LOGGER.debug("voix: %s doesn't have pipeline %r; skipping", target, pipeline)
        return
    if state.state == pipeline:
        return
    try:
        await hass.services.async_call(
            "select", "select_option",
            {"entity_id": target, "option": pipeline},
            blocking=False,
        )
        _LOGGER.info("voix: set %s pipeline → %r", target, pipeline)
    except Exception:  # noqa: BLE001
        _LOGGER.warning("voix: failed to set %s → %r", target, pipeline, exc_info=True)


async def _push_wake_word_to_device(
    hass: HomeAssistant, device_id: str, slot: str, wake_word: str
) -> None:
    """Set one device's wake-word slot to `wake_word` via select.select_option.

    `slot` is the upstream entity_id suffix: "wake_word" (slot 1) or
    "wake_word_2" (slot 2).
    """
    target = f"select.{device_slug(device_id)}_{slot}"
    # Sanity: the device must actually have this option available.
    state = hass.states.get(target)
    if state is None:
        _LOGGER.debug("voix: %s not present yet; skipping push", target)
        return
    options = (state.attributes or {}).get("options") or []
    if wake_word not in options:
        _LOGGER.warning(
            "voix: %s doesn't list %r as an option (has %s); skipping",
            target, wake_word, options,
        )
        return
    if state.state == wake_word:
        return  # already set
    try:
        await hass.services.async_call(
            "select",
            "select_option",
            {"entity_id": target, "option": wake_word},
            blocking=False,
        )
        _LOGGER.info("voix: set %s → %r", target, wake_word)
    except Exception:  # noqa: BLE001
        _LOGGER.warning("voix: failed to set %s → %r", target, wake_word, exc_info=True)


class _DeviceWakeWordSelect(SelectEntity):
    """Base for the per-device wake-word selects.

    Each Voice PE gets its own pair (voix-slot + assist-slot). State is
    stored under `entry.options['discovered_devices'][device_id][key]`
    so it survives reboots and stays per-device. On user change we push
    the value to the device's upstream wake_word / wake_word_2 select.
    """

    _attr_has_entity_name = False
    _attr_should_poll = False
    _attr_options = KNOWN_WAKE_WORDS
    _attr_icon = "mdi:microphone-message"
    _option_key: str       # key in per-device options blob
    _default_value: str
    _device_slot: str      # "wake_word" or "wake_word_2"
    _entity_prefix: str    # "voix_wake_word" or "voix_assist_wake_word"
    _display: str          # "voix wake word" or "voix assist wake word"

    def __init__(self, entry: ConfigEntry, device_id: str, friendly_name: str) -> None:
        self._entry = entry
        self._device_id = device_id
        slug = device_slug(device_id)
        self._attr_name = f"{self._display} {slug}"
        self.entity_id = f"select.{self._entity_prefix}_{slug}"
        self._attr_unique_id = f"{entry.entry_id}-{slug}-{self._entity_prefix}"
        self._attr_device_info = {
            "identifiers": {(DOMAIN, device_id)},
            "name": friendly_name,
            "manufacturer": "Nabu Casa",
            "model": "Voice PE",
        }

    def _stored(self) -> str:
        from . import CONF_DISCOVERED_DEVICES
        per_dev = (self._entry.options.get(CONF_DISCOVERED_DEVICES) or {}).get(
            self._device_id
        ) or {}
        return per_dev.get(self._option_key) or self._default_value

    @property
    def current_option(self) -> str:
        v = self._stored()
        return v if v in KNOWN_WAKE_WORDS else self._default_value

    async def async_select_option(self, option: str) -> None:
        if option not in KNOWN_WAKE_WORDS:
            _LOGGER.warning("voix wake-word: rejected %r", option)
            return
        from . import CONF_DISCOVERED_DEVICES
        known = dict(self._entry.options.get(CONF_DISCOVERED_DEVICES) or {})
        info = dict(known.get(self._device_id) or {})
        info[self._option_key] = option
        known[self._device_id] = info
        self.hass.config_entries.async_update_entry(
            self._entry,
            options={**self._entry.options, CONF_DISCOVERED_DEVICES: known},
        )
        self.async_write_ha_state()
        # Push to THIS device's upstream wake-word slot.
        await _push_wake_word_to_device(
            self.hass, self._device_id, self._device_slot, option
        )


class VoixDeviceWakeWordSelect(_DeviceWakeWordSelect):
    """Per-device voix wake word (mirrored to upstream slot 2)."""

    _option_key = "voix_wake_word"
    _default_value = DEFAULT_VOIX_WAKE_WORD
    _device_slot = "wake_word_2"
    _entity_prefix = "voix_wake_word"
    _display = "voix wake word"


class VoixDeviceAssistWakeWordSelect(_DeviceWakeWordSelect):
    """Per-device Assist passthrough wake word (mirrored to upstream slot 1)."""

    _option_key = "assist_wake_word"
    _default_value = DEFAULT_ASSIST_WAKE_WORD
    _device_slot = "wake_word"
    _entity_prefix = "voix_assist_wake_word"
    _display = "voix assist wake word"
