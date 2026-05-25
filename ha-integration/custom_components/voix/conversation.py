"""voix dictation conversation agent.

A HA conversation agent that captures the user's spoken text into an
input_text helper, flashes the satellite's LED ring as visible
confirmation, and returns an empty speech response so the pipeline's
TTS stage produces no audible reply.

To use:
  1. Add this integration via the voix config flow.
  2. In Settings → Voice assistants, edit the `voix-dictation` pipeline.
  3. Change `Conversation agent` to "Voix Dictation".

The pipeline then runs: wake word → STT → this agent → empty TTS.
"""
from __future__ import annotations

import asyncio
import logging

from homeassistant.components.conversation import (
    ConversationEntity,
    ConversationInput,
    ConversationResult,
)
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers import intent
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .const import (
    CONF_DICTATION_HELPER,
    CONF_LED_RING_ENTITY,
    DEFAULT_DICTATION_HELPER,
    DEFAULT_LED_RING_ENTITY,
    DOMAIN,
    EVENT_DICTATION_CAPTURED,
)

_LOGGER = logging.getLogger(__name__)

# LED flash duration after dictation capture. Long enough to register
# visually, short enough not to feel laggy.
LED_FLASH_DURATION_S = 0.8


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Register the dictation conversation entity for this config entry."""
    async_add_entities([VoixDictationAgent(entry)])


class VoixDictationAgent(ConversationEntity):
    """Captures dictation transcripts; produces no spoken reply."""

    _attr_has_entity_name = True
    _attr_name = "Dictation"
    _attr_should_poll = False
    _attr_supported_features = 0

    def __init__(self, entry: ConfigEntry) -> None:
        self._entry = entry
        self._attr_unique_id = f"{entry.entry_id}-dictation"

    @property
    def supported_languages(self) -> list[str]:
        # Mirror the OpenAI STT supported languages so the pipeline accepts
        # this agent regardless of which language the satellite uses.
        return ["en", "en-US"]

    async def async_process(self, user_input: ConversationInput) -> ConversationResult:
        text = (user_input.text or "").strip()
        _LOGGER.info("voix dictation captured: %r", text)

        helper_id = self._entry.data.get(
            CONF_DICTATION_HELPER, DEFAULT_DICTATION_HELPER
        )
        led_id = self._entry.data.get(CONF_LED_RING_ENTITY, DEFAULT_LED_RING_ENTITY)

        if text:
            await self._capture(text, helper_id, led_id)

        # Empty speech so the pipeline's TTS stage produces no audible output.
        # We still return a valid IntentResponse so the pipeline completes
        # cleanly (rather than erroring, which the satellite would flash red).
        response = intent.IntentResponse(language=user_input.language)
        response.async_set_speech("")
        return ConversationResult(
            response=response,
            conversation_id=user_input.conversation_id,
        )

    async def _capture(self, text: str, helper_id: str, led_id: str | None) -> None:
        """Write the helper, flash the LED, fire the event."""
        # 1. Write the transcript to the helper.
        try:
            await self.hass.services.async_call(
                "input_text",
                "set_value",
                {"entity_id": helper_id, "value": text},
                blocking=False,
            )
        except Exception:  # noqa: BLE001
            _LOGGER.exception("voix: failed to write %s", helper_id)

        # 2. Fire an event so users can build their own automations on top.
        self.hass.bus.async_fire(
            EVENT_DICTATION_CAPTURED, {"text": text, "helper": helper_id}
        )

        # 3. Flash the LED ring (fire-and-forget; don't block the agent).
        if led_id:
            self.hass.async_create_task(self._flash_led(led_id))

    async def _flash_led(self, led_id: str) -> None:
        """Brief green flash on the satellite's outer LED ring."""
        try:
            await self.hass.services.async_call(
                "light",
                "turn_on",
                {
                    "entity_id": led_id,
                    "brightness": 180,
                    "rgb_color": [0, 255, 80],
                },
                blocking=False,
            )
            await asyncio.sleep(LED_FLASH_DURATION_S)
            await self.hass.services.async_call(
                "light",
                "turn_off",
                {"entity_id": led_id},
                blocking=False,
            )
        except Exception:  # noqa: BLE001
            _LOGGER.exception("voix: LED flash failed for %s", led_id)
