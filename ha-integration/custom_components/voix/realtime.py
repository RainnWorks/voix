"""OpenAI Realtime session manager.

Architecture: hardware-agnostic.

The integration registers STT (`voix.stt`) and TTS (`voix.tts`) entities
that any HA Assist pipeline can use. When a pipeline points at our STT,
HA streams the satellite's mic audio to us. We forward it to a single
OpenAI Realtime WebSocket session, await the response, return the
transcript to the pipeline, and stash the response audio for our TTS
engine to play back on the same satellite.

Multi-turn: the conversation agent (`conversation.realtime`) returns
`continue_conversation=true`, so HA re-listens after each TTS playback
without needing a fresh wake word. The Realtime WS stays open across
turns; OpenAI sees one continuous conversation context.

Session lifecycle:

    create        Opened lazily on first STT call after no active session.
    run_turn      Per pipeline run: stream audio in, collect response, return.
    idle          Between turns: WS held open, audio stashed for TTS.
    close         On idle timeout or explicit stop. Re-create on next call.

There's exactly one active session at a time (singleton on hass.data).
Multi-satellite is fine as long as users aren't talking simultaneously.
"""
from __future__ import annotations

import asyncio
import base64
import io
import json
import logging
import time
import wave
from typing import Any

from homeassistant.core import HomeAssistant

from .const import (
    AUDIO_FORMAT_BYTES_PER_SAMPLE,
    CONF_LED_RING_ENTITY,
    CONF_OPENAI_API_KEY,
    CONF_REALTIME_INSTRUCTIONS,
    CONF_REALTIME_MODEL,
    CONF_REALTIME_VOICE,
    DEFAULT_LED_RING_ENTITY,
    DEFAULT_REALTIME_INSTRUCTIONS,
    DEFAULT_REALTIME_MODEL,
    DEFAULT_REALTIME_VOICE,
    EVENT_REALTIME_SESSION_ENDED,
    EVENT_REALTIME_SESSION_STARTED,
    EVENT_REALTIME_TURN_END,
    REALTIME_IDLE_TIMEOUT_S,
    REALTIME_SAMPLE_RATE,
    REALTIME_WS_URL,
    SATELLITE_SAMPLE_RATE,
)

_LOGGER = logging.getLogger(__name__)

_LED_LISTENING = (220, 60, 240)   # bright magenta - mic open / waiting
_LED_THINKING = (180, 40, 220)    # magenta-violet - model processing
_LED_SPEAKING = (255, 140, 60)    # warm amber - model responding (set when audio.delta arrives)


class RealtimeSession:
    """One OpenAI Realtime conversation, held open across pipeline turns."""

    def __init__(
        self,
        hass: HomeAssistant,
        *,
        openai_key: str,
        model: str,
        voice: str,
        instructions: str,
        led_ring_entity: str | None,
    ) -> None:
        self.hass = hass
        self._openai_key = openai_key
        self._model = model
        self._voice = voice
        self._instructions = instructions
        self._led_ring_entity = led_ring_entity

        self._ws: Any = None
        self._lock = asyncio.Lock()
        self._closed = False
        self._last_activity = time.monotonic()
        self._idle_task: asyncio.Task | None = None

        # Per-turn state, reset at the start of each run_turn().
        self._turn_done: asyncio.Event = asyncio.Event()
        self._turn_audio_chunks: list[bytes] = []
        self._turn_transcript_parts: list[str] = []
        self._turn_error: str | None = None

    # ─── Public API ──────────────────────────────────────────────────────────

    async def run_turn(self, audio_stream) -> str:
        """Stream user audio to Realtime, return the response transcript.

        Response audio is stashed; call `take_audio()` from the TTS path.
        Safe to call repeatedly — keeps the same WS open between turns.
        """
        async with self._lock:
            await self._ensure_connected()
            self._reset_turn()
            await self._set_led(_LED_LISTENING)

            # 1. Stream audio chunks in. The pipeline closes the stream when
            #    the satellite stops speaking (its VAD calls end-of-utterance).
            chunk_count = 0
            async for chunk in audio_stream:
                if not chunk:
                    continue
                await self._send_audio_chunk(chunk)
                chunk_count += 1
            _LOGGER.debug("voix realtime: sent %d audio chunks", chunk_count)

            # 2. Commit + request response. response.create with no params:
            # the production API rejects the legacy `modalities` field, and
            # defaults already produce both audio and a transcript.
            await self._ws.send(json.dumps({"type": "input_audio_buffer.commit"}))
            await self._ws.send(json.dumps({"type": "response.create"}))
            await self._set_led(_LED_THINKING)

            # 3. Wait for response.done.
            try:
                await asyncio.wait_for(self._turn_done.wait(), timeout=30.0)
            except asyncio.TimeoutError:
                _LOGGER.warning("voix realtime: response timeout")
                self._turn_error = "timeout"

            # If Realtime errored, don't leave the WS sitting open waiting for
            # the idle timer — close immediately so the next turn opens fresh.
            if self._turn_error:
                _LOGGER.info("voix realtime: closing after turn error: %s", self._turn_error)
                asyncio.create_task(self.close(reason=f"turn_error:{self._turn_error}"))
                return ""

            # Back to dim magenta listening colour for the next turn.
            await self._set_led(_LED_LISTENING, brightness=120)

            self._last_activity = time.monotonic()
            self._reset_idle_timer()

            self.hass.bus.async_fire(
                EVENT_REALTIME_TURN_END,
                {
                    "transcript": "".join(self._turn_transcript_parts),
                    "audio_bytes": sum(len(c) for c in self._turn_audio_chunks),
                    "error": self._turn_error,
                },
            )

            return "".join(self._turn_transcript_parts).strip()

    def take_audio_wav(self) -> bytes | None:
        """Pop the response audio collected in the most recent turn, as WAV bytes.

        Returns None if no audio was collected (e.g. text-only response, or
        Realtime hung up). Caller is responsible for not calling twice.
        """
        if not self._turn_audio_chunks:
            return None
        raw_pcm = b"".join(self._turn_audio_chunks)
        self._turn_audio_chunks = []
        return _pcm_to_wav(raw_pcm, sample_rate=REALTIME_SAMPLE_RATE)

    async def close(self, reason: str = "explicit") -> None:
        """Tear down WS and idle timer. Idempotent."""
        if self._closed:
            return
        self._closed = True
        _LOGGER.info("voix realtime: closing session (%s)", reason)

        if self._idle_task is not None:
            self._idle_task.cancel()
            self._idle_task = None

        if self._ws is not None:
            try:
                await self._ws.close()
            except Exception:  # noqa: BLE001
                _LOGGER.debug("voix realtime: WS close error", exc_info=True)
            self._ws = None

        await self._clear_led()
        self.hass.bus.async_fire(EVENT_REALTIME_SESSION_ENDED, {"reason": reason})

    # ─── Internals ───────────────────────────────────────────────────────────

    async def _ensure_connected(self) -> None:
        if self._ws is not None:
            return
        import ssl
        import websockets

        # Build the SSL context in an executor so the event loop doesn't
        # block while CA certs load (HA detects this and complains otherwise).
        ssl_ctx = await self.hass.async_add_executor_job(ssl.create_default_context)

        url = f"{REALTIME_WS_URL}?model={self._model}"
        # OpenAI Realtime moved out of beta — no `OpenAI-Beta` header. Just auth.
        headers = {"Authorization": f"Bearer {self._openai_key}"}
        try:
            self._ws = await websockets.connect(
                url, additional_headers=headers, ssl=ssl_ctx
            )
        except TypeError:
            # Older websockets versions used `extra_headers`.
            self._ws = await websockets.connect(
                url, extra_headers=headers, ssl=ssl_ctx
            )
        _LOGGER.info("voix realtime: WS connected (model=%s)", self._model)

        # Production Realtime session.update shape: nest audio format under
        # session.audio.{input,output}.format, voice under session.audio.output.
        # `turn_detection: null` here means we'll commit input_audio_buffer
        # explicitly when the satellite VAD ends the utterance.
        await self._ws.send(
            json.dumps(
                {
                    "type": "session.update",
                    "session": {
                        "type": "realtime",
                        "model": self._model,
                        "instructions": self._instructions,
                        "audio": {
                            "input": {
                                "format": {"type": "audio/pcm", "rate": REALTIME_SAMPLE_RATE},
                                "turn_detection": None,
                            },
                            "output": {
                                "format": {"type": "audio/pcm", "rate": REALTIME_SAMPLE_RATE},
                                "voice": self._voice,
                            },
                        },
                    },
                }
            )
        )

        asyncio.create_task(self._read_loop(), name="voix-rt-reader")
        self._reset_idle_timer()
        self.hass.bus.async_fire(EVENT_REALTIME_SESSION_STARTED, {})

    async def _send_audio_chunk(self, pcm16k: bytes) -> None:
        """Upsample 16k mono PCM to 24k mono PCM and send base64 to Realtime."""
        import audioop

        pcm24k, _ = audioop.ratecv(
            pcm16k,
            AUDIO_FORMAT_BYTES_PER_SAMPLE,
            1,
            SATELLITE_SAMPLE_RATE,
            REALTIME_SAMPLE_RATE,
            None,
        )
        await self._ws.send(
            json.dumps(
                {
                    "type": "input_audio_buffer.append",
                    "audio": base64.b64encode(pcm24k).decode("ascii"),
                }
            )
        )

    async def _read_loop(self) -> None:
        """Consume events from the WS, accumulate audio + transcript per turn."""
        try:
            async for raw in self._ws:
                try:
                    msg = json.loads(raw)
                except json.JSONDecodeError:
                    continue

                t = msg.get("type", "")
                if t.endswith("audio.delta"):
                    b64 = msg.get("delta") or msg.get("audio") or ""
                    if b64:
                        self._turn_audio_chunks.append(base64.b64decode(b64))
                elif t.endswith("audio_transcript.delta"):
                    self._turn_transcript_parts.append(msg.get("delta") or "")
                elif t in ("response.text.delta", "response.output_text.delta"):
                    # Some Realtime variants send a separate text channel; keep
                    # the transcript merged.
                    self._turn_transcript_parts.append(msg.get("delta") or "")
                elif t == "response.done":
                    self._turn_done.set()
                elif t == "error":
                    self._turn_error = (
                        msg.get("error", {}).get("message") if isinstance(msg.get("error"), dict)
                        else str(msg.get("error"))
                    )
                    _LOGGER.warning("voix realtime: error %s", self._turn_error)
                    self._turn_done.set()
        except Exception:  # noqa: BLE001
            _LOGGER.exception("voix realtime: WS read loop failed")
        finally:
            # WS closed for any reason — invalidate the session so the next
            # STT call opens a fresh one.
            self._turn_done.set()
            await self.close(reason="ws_closed")

    def _reset_turn(self) -> None:
        self._turn_done = asyncio.Event()
        self._turn_audio_chunks = []
        self._turn_transcript_parts = []
        self._turn_error = None

    def _reset_idle_timer(self) -> None:
        if self._idle_task is not None:
            self._idle_task.cancel()
        self._idle_task = asyncio.create_task(
            self._idle_watcher(), name="voix-rt-idle"
        )

    async def _idle_watcher(self) -> None:
        try:
            await asyncio.sleep(REALTIME_IDLE_TIMEOUT_S)
        except asyncio.CancelledError:
            return
        await self.close(reason="idle_timeout")

    async def _set_led(
        self, rgb: tuple[int, int, int], brightness: int = 180
    ) -> None:
        if not self._led_ring_entity:
            return
        try:
            await self.hass.services.async_call(
                "light",
                "turn_on",
                {
                    "entity_id": self._led_ring_entity,
                    "brightness": brightness,
                    "rgb_color": list(rgb),
                },
                blocking=False,
            )
        except Exception:  # noqa: BLE001
            _LOGGER.debug("voix: LED set failed", exc_info=True)

    async def _clear_led(self) -> None:
        if not self._led_ring_entity:
            return
        try:
            await self.hass.services.async_call(
                "light",
                "turn_off",
                {"entity_id": self._led_ring_entity},
                blocking=False,
            )
        except Exception:  # noqa: BLE001
            _LOGGER.debug("voix: LED clear failed", exc_info=True)


class RealtimeManager:
    """Owns the single active RealtimeSession for this integration entry."""

    def __init__(self, hass: HomeAssistant, entry_data: dict) -> None:
        self.hass = hass
        self._openai_key = entry_data.get(CONF_OPENAI_API_KEY)
        self._model = entry_data.get(CONF_REALTIME_MODEL, DEFAULT_REALTIME_MODEL)
        self._voice = entry_data.get(CONF_REALTIME_VOICE, DEFAULT_REALTIME_VOICE)
        self._instructions = entry_data.get(
            CONF_REALTIME_INSTRUCTIONS, DEFAULT_REALTIME_INSTRUCTIONS
        )
        self._led_ring_entity = entry_data.get(
            CONF_LED_RING_ENTITY, DEFAULT_LED_RING_ENTITY
        )
        self._session: RealtimeSession | None = None
        self._lock = asyncio.Lock()

    @property
    def configured(self) -> bool:
        return bool(self._openai_key)

    async def get_or_create_session(self) -> RealtimeSession:
        """Return the active session, creating a new one if needed."""
        async with self._lock:
            if self._session is None or self._session._closed:  # noqa: SLF001
                self._session = RealtimeSession(
                    self.hass,
                    openai_key=self._openai_key,
                    model=self._model,
                    voice=self._voice,
                    instructions=self._instructions,
                    led_ring_entity=self._led_ring_entity,
                )
            return self._session

    async def close(self) -> None:
        async with self._lock:
            if self._session is not None:
                await self._session.close(reason="manager_close")
                self._session = None


def _pcm_to_wav(pcm: bytes, *, sample_rate: int) -> bytes:
    """Wrap raw PCM16 mono bytes in a WAV container so HA media_player plays them."""
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(AUDIO_FORMAT_BYTES_PER_SAMPLE)
        wav.setframerate(sample_rate)
        wav.writeframes(pcm)
    return buf.getvalue()
