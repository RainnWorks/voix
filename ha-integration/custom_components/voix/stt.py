"""voix Realtime STT entity.

The HA Assist pipeline calls our STT engine with the satellite's mic audio
stream. We forward it to the active OpenAI Realtime session and return the
transcript. The Realtime response audio is held in the session for our TTS
engine to pick up on the same pipeline run.
"""
from __future__ import annotations

import logging

from homeassistant.components.stt import (
    AudioBitRates,
    AudioChannels,
    AudioCodecs,
    AudioFormats,
    AudioSampleRates,
    SpeechMetadata,
    SpeechResult,
    SpeechResultState,
    SpeechToTextEntity,
)
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .const import DOMAIN

_LOGGER = logging.getLogger(__name__)


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    async_add_entities([VoixRealtimeSTT(entry)])


class VoixRealtimeSTT(SpeechToTextEntity):
    """Streams pipeline audio to the OpenAI Realtime session, returns transcript."""

    _attr_has_entity_name = True
    _attr_name = "Realtime"
    _attr_should_poll = False

    def __init__(self, entry: ConfigEntry) -> None:
        self._entry = entry
        self._attr_unique_id = f"{entry.entry_id}-realtime-stt"

    @property
    def supported_languages(self) -> list[str]:
        return ["en-US", "en"]

    @property
    def supported_formats(self) -> list[AudioFormats]:
        return [AudioFormats.WAV]

    @property
    def supported_codecs(self) -> list[AudioCodecs]:
        return [AudioCodecs.PCM]

    @property
    def supported_bit_rates(self) -> list[AudioBitRates]:
        return [AudioBitRates.BITRATE_16]

    @property
    def supported_sample_rates(self) -> list[AudioSampleRates]:
        return [AudioSampleRates.SAMPLERATE_16000]

    @property
    def supported_channels(self) -> list[AudioChannels]:
        return [AudioChannels.CHANNEL_MONO]

    async def async_process_audio_stream(
        self, metadata: SpeechMetadata, stream
    ) -> SpeechResult:
        manager = self.hass.data.get(DOMAIN, {}).get(self._entry.entry_id)
        if manager is None or not manager.configured:
            _LOGGER.warning(
                "voix STT called but Realtime is not configured (missing OpenAI key)"
            )
            return SpeechResult(text="", result=SpeechResultState.ERROR)

        try:
            session = await manager.get_or_create_session()
            transcript = await session.run_turn(stream)
        except Exception:  # noqa: BLE001
            _LOGGER.exception("voix STT: Realtime turn failed")
            return SpeechResult(text="", result=SpeechResultState.ERROR)

        if not transcript:
            # Realtime returned audio-only or text was empty; pipeline still
            # needs a non-empty transcript or it skips the conversation stage.
            # A space keeps the pipeline alive; our conversation agent ignores
            # it and continues the conversation.
            transcript = " "

        return SpeechResult(text=transcript, result=SpeechResultState.SUCCESS)
