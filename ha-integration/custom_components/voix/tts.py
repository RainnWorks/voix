"""voix Realtime TTS entity.

We don't synthesise speech here — OpenAI Realtime already produced the
response audio in the STT step. This engine just hands back the bytes
stashed on the session, wrapped in a WAV container the satellite's
media_player can play.
"""
from __future__ import annotations

import logging

from homeassistant.components.tts import TextToSpeechEntity, TtsAudioType
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
    async_add_entities([VoixRealtimeTTS(entry)])


class VoixRealtimeTTS(TextToSpeechEntity):
    """Returns the Realtime response audio cached on the session."""

    _attr_has_entity_name = True
    _attr_name = "Realtime"
    _attr_should_poll = False

    def __init__(self, entry: ConfigEntry) -> None:
        self._entry = entry
        self._attr_unique_id = f"{entry.entry_id}-realtime-tts"

    @property
    def default_language(self) -> str:
        return "en-US"

    @property
    def supported_languages(self) -> list[str]:
        return ["en-US", "en"]

    async def async_get_tts_audio(
        self, message: str, language: str, options: dict | None = None
    ) -> TtsAudioType:
        manager = self.hass.data.get(DOMAIN, {}).get(self._entry.entry_id)
        if manager is None:
            return ("wav", b"")

        session = await manager.get_or_create_session()
        wav = session.take_audio_wav()
        if not wav:
            # Nothing buffered — pipeline asked us for speech but Realtime
            # didn't produce audio (e.g. text-only response, or error).
            # Return silent WAV to keep the pipeline happy without playing
            # anything noisy.
            return ("wav", _SILENT_WAV)
        return ("wav", wav)


# 50ms of silence at 24 kHz PCM16 mono, wrapped in a minimal WAV header.
# Used when the Realtime response had no audio so the pipeline doesn't fail
# the tts stage. Pre-built once at import.
def _make_silent_wav() -> bytes:
    import io
    import wave

    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(24000)
        w.writeframes(b"\x00" * (24000 // 20 * 2))  # 50ms of silence
    return buf.getvalue()


_SILENT_WAV = _make_silent_wav()
