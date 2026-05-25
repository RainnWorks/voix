"""Config flow for voix.

A single config entry per satellite. Two feature sets:

* **Mode C (dictation conversation agent)** — needs only the helper entity
  to write transcripts to and (optionally) the LED ring entity for visual
  feedback. Defaults are fine for the reference setup.

* **Mode B (Realtime bridge)** — needs satellite host + noise PSK +
  OpenAI API key. Skipped at runtime if any are missing.

Everything is optional in the flow; you can install for Mode C only and
add Realtime later via Reconfigure.
"""
from __future__ import annotations

from typing import Any

import voluptuous as vol
from homeassistant import config_entries
from homeassistant.data_entry_flow import FlowResult

from .const import (
    CONF_DICTATION_HELPER,
    CONF_LED_RING_ENTITY,
    CONF_NOISE_PSK,
    CONF_OPENAI_API_KEY,
    CONF_REALTIME_MODEL,
    CONF_SATELLITE_HOST,
    CONF_SATELLITE_PORT,
    CONF_TRIGGER_WAKE_WORD,
    DEFAULT_DICTATION_HELPER,
    DEFAULT_LED_RING_ENTITY,
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
            unique_id = (
                user_input.get(CONF_SATELLITE_HOST)
                or user_input.get(CONF_DICTATION_HELPER)
                or "voix"
            )
            await self.async_set_unique_id(unique_id)
            self._abort_if_unique_id_configured()

            data: dict[str, Any] = {
                CONF_DICTATION_HELPER: user_input.get(
                    CONF_DICTATION_HELPER, DEFAULT_DICTATION_HELPER
                ),
                CONF_LED_RING_ENTITY: user_input.get(
                    CONF_LED_RING_ENTITY, DEFAULT_LED_RING_ENTITY
                ),
            }
            # Realtime is opt-in: only set if the user gave host + PSK + key.
            if (
                user_input.get(CONF_SATELLITE_HOST)
                and user_input.get(CONF_NOISE_PSK)
                and user_input.get(CONF_OPENAI_API_KEY)
            ):
                data.update(
                    {
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
                    }
                )

            title = (
                f"voix ({user_input[CONF_SATELLITE_HOST]})"
                if user_input.get(CONF_SATELLITE_HOST)
                else "voix"
            )
            return self.async_create_entry(title=title, data=data)

        schema = vol.Schema(
            {
                # Mode C (always available; sensible defaults)
                vol.Optional(
                    CONF_DICTATION_HELPER, default=DEFAULT_DICTATION_HELPER
                ): str,
                vol.Optional(
                    CONF_LED_RING_ENTITY, default=DEFAULT_LED_RING_ENTITY
                ): str,
                # Mode B (Realtime — leave blank to skip)
                vol.Optional(CONF_SATELLITE_HOST): str,
                vol.Optional(CONF_SATELLITE_PORT, default=DEFAULT_SATELLITE_PORT): int,
                vol.Optional(CONF_NOISE_PSK): str,
                vol.Optional(CONF_OPENAI_API_KEY): str,
                vol.Optional(
                    CONF_TRIGGER_WAKE_WORD, default=DEFAULT_TRIGGER_WAKE_WORD
                ): str,
                vol.Optional(
                    CONF_REALTIME_MODEL, default=DEFAULT_REALTIME_MODEL
                ): str,
            }
        )
        return self.async_show_form(step_id="user", data_schema=schema, errors=errors)
