"""Config flow for voix.

Two feature sets, both hardware-agnostic:

* Mode C (dictation) — always available. Configure which input_text helper
  to write transcripts to, and which light entity to flash on capture.
  Defaults match the project's reference setup.

* Mode B (Realtime) — opt-in. Requires an OpenAI API key. When enabled,
  the integration's STT and TTS engines route the configured pipeline's
  audio through OpenAI Realtime, with multi-turn via continue_conversation.
"""
from __future__ import annotations

from typing import Any

import voluptuous as vol
from homeassistant import config_entries
from homeassistant.data_entry_flow import FlowResult

from .const import (
    CONF_DICTATION_HELPER,
    CONF_LED_RING_ENTITY,
    CONF_OPENAI_API_KEY,
    CONF_REALTIME_INSTRUCTIONS,
    CONF_REALTIME_MODEL,
    CONF_REALTIME_VOICE,
    DEFAULT_DICTATION_HELPER,
    DEFAULT_LED_RING_ENTITY,
    DEFAULT_REALTIME_INSTRUCTIONS,
    DEFAULT_REALTIME_MODEL,
    DEFAULT_REALTIME_VOICE,
    DOMAIN,
)


class VoixConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    """Single-step setup."""

    VERSION = 1

    async def async_step_user(self, user_input: dict[str, Any] | None = None) -> FlowResult:
        errors: dict[str, str] = {}
        if user_input is not None:
            await self.async_set_unique_id(DOMAIN)
            self._abort_if_unique_id_configured()
            return self.async_create_entry(title="voix", data=user_input)

        schema = vol.Schema(
            {
                # Mode C
                vol.Optional(
                    CONF_DICTATION_HELPER, default=DEFAULT_DICTATION_HELPER
                ): str,
                vol.Optional(
                    CONF_LED_RING_ENTITY, default=DEFAULT_LED_RING_ENTITY
                ): str,
                # Mode B (leave blank to disable)
                vol.Optional(CONF_OPENAI_API_KEY): str,
                vol.Optional(
                    CONF_REALTIME_MODEL, default=DEFAULT_REALTIME_MODEL
                ): str,
                vol.Optional(
                    CONF_REALTIME_VOICE, default=DEFAULT_REALTIME_VOICE
                ): str,
                vol.Optional(
                    CONF_REALTIME_INSTRUCTIONS, default=DEFAULT_REALTIME_INSTRUCTIONS
                ): str,
            }
        )
        return self.async_show_form(step_id="user", data_schema=schema, errors=errors)
