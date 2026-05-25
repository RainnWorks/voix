"""Config flow for voix.

A single config entry per satellite. User provides:
  - Satellite hostname or IP (defaults to mDNS-discovered Voice PE)
  - Noise PSK (the ESPHome native-API encryption key)
  - OpenAI API key
  - (Optional) Trigger wake word + Realtime model
"""
from __future__ import annotations

from typing import Any

import voluptuous as vol
from homeassistant import config_entries
from homeassistant.const import CONF_HOST, CONF_PORT
from homeassistant.data_entry_flow import FlowResult

from .const import (
    CONF_NOISE_PSK,
    CONF_OPENAI_API_KEY,
    CONF_REALTIME_MODEL,
    CONF_SATELLITE_HOST,
    CONF_SATELLITE_PORT,
    CONF_TRIGGER_WAKE_WORD,
    DEFAULT_REALTIME_MODEL,
    DEFAULT_SATELLITE_PORT,
    DEFAULT_TRIGGER_WAKE_WORD,
    DOMAIN,
)


class VoixConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    """Single-step manual config."""

    VERSION = 1

    async def async_step_user(self, user_input: dict[str, Any] | None = None) -> FlowResult:
        errors: dict[str, str] = {}
        if user_input is not None:
            await self.async_set_unique_id(user_input[CONF_SATELLITE_HOST])
            self._abort_if_unique_id_configured()
            return self.async_create_entry(
                title=f"voix ({user_input[CONF_SATELLITE_HOST]})",
                data={
                    CONF_SATELLITE_HOST: user_input[CONF_SATELLITE_HOST],
                    CONF_SATELLITE_PORT: user_input.get(
                        CONF_SATELLITE_PORT, DEFAULT_SATELLITE_PORT
                    ),
                    CONF_NOISE_PSK: user_input[CONF_NOISE_PSK],
                    CONF_OPENAI_API_KEY: user_input[CONF_OPENAI_API_KEY],
                    CONF_REALTIME_MODEL: user_input.get(
                        CONF_REALTIME_MODEL, DEFAULT_REALTIME_MODEL
                    ),
                    CONF_TRIGGER_WAKE_WORD: user_input.get(
                        CONF_TRIGGER_WAKE_WORD, DEFAULT_TRIGGER_WAKE_WORD
                    ),
                },
            )

        schema = vol.Schema(
            {
                vol.Required(CONF_SATELLITE_HOST): str,
                vol.Optional(CONF_SATELLITE_PORT, default=DEFAULT_SATELLITE_PORT): int,
                vol.Required(CONF_NOISE_PSK): str,
                vol.Required(CONF_OPENAI_API_KEY): str,
                vol.Optional(CONF_TRIGGER_WAKE_WORD, default=DEFAULT_TRIGGER_WAKE_WORD): str,
                vol.Optional(CONF_REALTIME_MODEL, default=DEFAULT_REALTIME_MODEL): str,
            }
        )
        return self.async_show_form(step_id="user", data_schema=schema, errors=errors)
