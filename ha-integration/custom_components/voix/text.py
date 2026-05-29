"""voix gateway-level text entities.

The per-device `text.voix_dictation_<slug>` entity used to live here as a
1000-char-capped store of the last dictation text. Long transcripts blew
past that cap. Transcripts are now stored as files under
`<config>/voix/transcripts/` and surfaced via the per-device transcript
sensors plus the `voix.get_transcript` service. The dictation text entity
was redundant in the file-storage model and has been removed.
"""
from __future__ import annotations

import logging

from homeassistant.components.text import TextEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .const import (
    CONF_DEFAULT_MODEL,
    CONF_OPENAI_API_KEY,
    DEFAULT_REALTIME_MODEL,
    DOMAIN,
)
from .util import gateway_device_info

_LOGGER = logging.getLogger(__name__)


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    # Gateway-level text entities: writable strings for the global config
    # values that are too free-form for a select. They read/write to
    # entry.data (api key) or entry.options (the rest).
    #
    # include_entities / include_persons are NOT here — those need a
    # real entity picker UI which only exists in the options flow via
    # selector.EntitySelector. See config_flow.py's prompt_extras step.
    async_add_entities([
        VoixOpenAIKeyText(entry),
        VoixRealtimeModelText(entry),
    ])


# ─── Gateway-level globals (writable text entities) ──────────────────────────


class _GatewayText(TextEntity):
    """Base for entry-backed gateway text entities."""

    _attr_has_entity_name = False
    _attr_should_poll = False
    _attr_native_max = 4000
    _attr_native_min = 0
    _attr_mode = "text"

    def __init__(self, entry: ConfigEntry) -> None:
        self._entry = entry
        self._attr_device_info = gateway_device_info(DOMAIN)


class VoixOpenAIKeyText(_GatewayText):
    """The OpenAI API key. Stored in entry.data (sensitive). Mode=password."""

    _attr_mode = "password"
    _attr_icon = "mdi:key-chain-variant"

    def __init__(self, entry: ConfigEntry) -> None:
        super().__init__(entry)
        self._attr_name = "voix OpenAI API key"
        self.entity_id = "text.voix_openai_api_key"
        self._attr_unique_id = f"{entry.entry_id}-voix-openai-key"

    @property
    def native_value(self) -> str:
        return self._entry.data.get(CONF_OPENAI_API_KEY, "") or ""

    async def async_set_value(self, value: str) -> None:
        new_data = {**self._entry.data, CONF_OPENAI_API_KEY: value}
        self.hass.config_entries.async_update_entry(self._entry, data=new_data)
        self.async_write_ha_state()
        _LOGGER.info("voix: OpenAI API key updated via entity")


class VoixRealtimeModelText(_GatewayText):
    """The OpenAI Realtime model identifier (e.g. gpt-realtime, gpt-realtime-mini)."""

    _attr_icon = "mdi:robot"

    def __init__(self, entry: ConfigEntry) -> None:
        super().__init__(entry)
        self._attr_name = "voix realtime model"
        self.entity_id = "text.voix_realtime_model"
        self._attr_unique_id = f"{entry.entry_id}-voix-realtime-model"

    @property
    def native_value(self) -> str:
        return self._entry.options.get(CONF_DEFAULT_MODEL) or DEFAULT_REALTIME_MODEL

    async def async_set_value(self, value: str) -> None:
        new_opts = {**self._entry.options, CONF_DEFAULT_MODEL: value.strip()}
        self.hass.config_entries.async_update_entry(self._entry, options=new_opts)
        self.async_write_ha_state()
        _LOGGER.info("voix realtime model → %s", value)


# VoixPromptAddendumText removed when prompt context moved per-mode —
# each mode now carries its own addendum string in mode_def["addendum"],
# edited via the options-flow mode_form (selector.TextSelector multiline)
# or the desktop app's mode editor. Its global counterpart is gone.

