"""The Realtime bridge.

Lifecycle:
    async_start()          — held open; idle until a session is requested
    async_start_session()  — triggered by voix.realtime_requested event
    async_stop_session()   — triggered by event, silence timeout, or response.done
    async_stop()           — final teardown on unload / HA shutdown

Subscription contention:
    The Voice PE's voice_assistant channel allows ONE subscriber at a time.
    During a session, our APIClient holds it. When the session ends we close
    our connection; HA's core ESPHome integration then auto-reconnects and
    re-claims the subscription, restoring Mode A and Mode C.

This module is intentionally a skeleton at first commit. Audio resampling,
OpenAI Realtime protocol handling, and tear-down details are TODO and will
be filled in iteratively.
"""
from __future__ import annotations

import asyncio
import base64
import json
import logging
from typing import Any

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant

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
    EVENT_REALTIME_SESSION_ENDED,
    EVENT_REALTIME_SESSION_STARTED,
    REALTIME_SAMPLE_RATE,
    REALTIME_WS_URL,
    SATELLITE_SAMPLE_RATE,
)

_LOGGER = logging.getLogger(__name__)


class RealtimeBridge:
    """One-satellite Realtime bridge."""

    def __init__(self, hass: HomeAssistant, entry: ConfigEntry) -> None:
        self.hass = hass
        self.entry = entry
        self.satellite_host: str = entry.data[CONF_SATELLITE_HOST]
        self.satellite_port: int = entry.data.get(CONF_SATELLITE_PORT, DEFAULT_SATELLITE_PORT)
        self._noise_psk: str = entry.data[CONF_NOISE_PSK]
        self._openai_key: str = entry.data[CONF_OPENAI_API_KEY]
        self._model: str = entry.data.get(CONF_REALTIME_MODEL, DEFAULT_REALTIME_MODEL)
        self._trigger_wake_word: str = entry.data.get(
            CONF_TRIGGER_WAKE_WORD, DEFAULT_TRIGGER_WAKE_WORD
        )

        self._session_lock = asyncio.Lock()
        self._session: _RealtimeSession | None = None

    @property
    def trigger_wake_word(self) -> str:
        return self._trigger_wake_word

    async def async_start(self) -> None:
        """Idle setup. Nothing to do until a session is requested."""
        _LOGGER.debug("voix bridge initialised for %s", self.satellite_host)

    async def async_start_session(self, event_data: dict[str, Any]) -> None:
        """Begin a Realtime session in response to a wake-word event."""
        # Only act on our configured wake word, in case multiple bridges exist.
        wake_word = (event_data or {}).get("wake_word")
        if wake_word and wake_word != self._trigger_wake_word:
            return

        async with self._session_lock:
            if self._session is not None:
                _LOGGER.info("voix realtime session already active; ignoring start")
                return
            self._session = _RealtimeSession(
                hass=self.hass,
                satellite_host=self.satellite_host,
                satellite_port=self.satellite_port,
                noise_psk=self._noise_psk,
                openai_key=self._openai_key,
                model=self._model,
                on_close=self._on_session_close,
            )
            try:
                await self._session.start()
            except Exception:  # noqa: BLE001
                _LOGGER.exception("voix realtime session failed to start")
                self._session = None
                return

        self.hass.bus.async_fire(
            EVENT_REALTIME_SESSION_STARTED,
            {"satellite": self.satellite_host},
        )

    async def async_stop_session(self, event_data: dict[str, Any] | None = None) -> None:
        async with self._session_lock:
            session = self._session
            self._session = None
        if session is not None:
            await session.stop()

    async def _on_session_close(self) -> None:
        """Called by the session when it ends from its own side."""
        async with self._session_lock:
            self._session = None
        self.hass.bus.async_fire(
            EVENT_REALTIME_SESSION_ENDED,
            {"satellite": self.satellite_host},
        )

    async def async_stop(self) -> None:
        await self.async_stop_session()


class _RealtimeSession:
    """One Realtime conversation, from subscription claim to release."""

    def __init__(
        self,
        *,
        hass: HomeAssistant,
        satellite_host: str,
        satellite_port: int,
        noise_psk: str,
        openai_key: str,
        model: str,
        on_close,
    ) -> None:
        self.hass = hass
        self.satellite_host = satellite_host
        self.satellite_port = satellite_port
        self._noise_psk = noise_psk
        self._openai_key = openai_key
        self._model = model
        self._on_close = on_close

        self._api_client = None  # aioesphomeapi.APIClient — populated in start()
        self._unsubscribe_va = None
        self._oai_ws = None
        self._tasks: list[asyncio.Task] = []
        self._closed = asyncio.Event()

        # audioop.ratecv state, threaded through successive calls for continuity.
        self._upsample_state: Any = None     # 16 kHz → 24 kHz (mic → Realtime)
        self._downsample_state: Any = None   # 24 kHz → 16 kHz (Realtime → speaker)

    async def start(self) -> None:
        """Claim the satellite voice subscription, open Realtime WS, wire pumps."""
        # Imports kept local so HA can load the integration even if the deps
        # haven't been installed yet (they're declared in manifest.json).
        from aioesphomeapi import APIClient
        import websockets

        # 1. Connect to the satellite via the ESPHome native API.
        self._api_client = APIClient(
            address=self.satellite_host,
            port=self.satellite_port,
            password=None,
            noise_psk=self._noise_psk,
        )
        await self._api_client.connect(login=True)
        _LOGGER.info("voix: connected to satellite at %s", self.satellite_host)

        # 2. Claim the voice_assistant subscription. Note: this displaces HA's
        #    core ESPHome integration. It will auto-reconnect on session end.
        self._unsubscribe_va = self._api_client.subscribe_voice_assistant(
            handle_start=self._on_va_start,
            handle_stop=self._on_va_stop,
            handle_audio=self._on_satellite_audio,
        )
        _LOGGER.info("voix: voice_assistant subscription claimed")

        # 3. Open the OpenAI Realtime WebSocket.
        #    Header name varies across websockets versions; pass through whichever
        #    kwarg the installed version accepts.
        headers = {
            "Authorization": f"Bearer {self._openai_key}",
            "OpenAI-Beta": "realtime=v1",
        }
        try:
            self._oai_ws = await websockets.connect(
                f"{REALTIME_WS_URL}?model={self._model}",
                additional_headers=headers,
            )
        except TypeError:
            # Older websockets versions used `extra_headers`
            self._oai_ws = await websockets.connect(
                f"{REALTIME_WS_URL}?model={self._model}",
                extra_headers=headers,
            )
        _LOGGER.info("voix: Realtime WS connected (model=%s)", self._model)

        # 4. Configure the session.
        await self._oai_ws.send(
            json.dumps(
                {
                    "type": "session.update",
                    "session": {
                        "modalities": ["text", "audio"],
                        "input_audio_format": "pcm16",
                        "output_audio_format": "pcm16",
                        "voice": "alloy",
                        "turn_detection": {
                            "type": "server_vad",
                            "threshold": 0.5,
                            "silence_duration_ms": 600,
                        },
                    },
                }
            )
        )

        # 5. Start pumping Realtime → satellite.
        self._tasks.append(
            asyncio.create_task(self._pump_realtime_to_satellite())
        )

    async def stop(self) -> None:
        """Release subscription and close WS. Idempotent."""
        if self._closed.is_set():
            return
        self._closed.set()

        for task in self._tasks:
            task.cancel()
        for task in self._tasks:
            try:
                await task
            except (asyncio.CancelledError, Exception):  # noqa: BLE001
                pass

        if self._unsubscribe_va is not None:
            try:
                self._unsubscribe_va()
            except Exception:  # noqa: BLE001
                _LOGGER.exception("error releasing voice_assistant subscription")
            self._unsubscribe_va = None

        if self._oai_ws is not None:
            try:
                await self._oai_ws.close()
            except Exception:  # noqa: BLE001
                _LOGGER.exception("error closing OpenAI Realtime WS")
            self._oai_ws = None

        if self._api_client is not None:
            try:
                await self._api_client.disconnect()
            except Exception:  # noqa: BLE001
                _LOGGER.exception("error disconnecting aioesphomeapi client")
            self._api_client = None

        if self._on_close is not None:
            await self._on_close()

    # ─── Callbacks: satellite → us ──────────────────────────────────────────

    async def _on_va_start(self, *args, **kwargs) -> None:
        _LOGGER.debug("satellite voice_assistant start: %r %r", args, kwargs)

    async def _on_va_stop(self, *args, **kwargs) -> None:
        _LOGGER.debug("satellite voice_assistant stop: %r %r", args, kwargs)
        # The satellite is telling us its turn is done. Let Realtime decide
        # whether to end the session or keep listening.

    async def _on_satellite_audio(self, data: bytes) -> None:
        """16 kHz PCM16 mono chunk from the satellite microphone."""
        if self._oai_ws is None:
            return
        import audioop  # provided by audioop-lts on Python 3.13+

        resampled, self._upsample_state = audioop.ratecv(
            data,
            AUDIO_FORMAT_BYTES_PER_SAMPLE,
            1,  # channels
            SATELLITE_SAMPLE_RATE,
            REALTIME_SAMPLE_RATE,
            self._upsample_state,
        )
        b64 = base64.b64encode(resampled).decode("ascii")
        try:
            await self._oai_ws.send(
                json.dumps({"type": "input_audio_buffer.append", "audio": b64})
            )
        except Exception:  # noqa: BLE001
            _LOGGER.exception("failed to forward audio to Realtime")

    # ─── Pumps: us → satellite ──────────────────────────────────────────────

    async def _pump_realtime_to_satellite(self) -> None:
        """Read Realtime WS messages; play audio deltas through the satellite."""
        import audioop

        assert self._oai_ws is not None
        async for raw in self._oai_ws:
            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                continue

            t = msg.get("type", "")
            # Realtime emits both legacy `response.audio.delta` and newer
            # `response.output_audio.delta` depending on version; accept both.
            if t.endswith("audio.delta"):
                b64 = msg.get("delta") or msg.get("audio") or ""
                if not b64:
                    continue
                pcm24 = base64.b64decode(b64)
                pcm16, self._downsample_state = audioop.ratecv(
                    pcm24,
                    AUDIO_FORMAT_BYTES_PER_SAMPLE,
                    1,
                    REALTIME_SAMPLE_RATE,
                    SATELLITE_SAMPLE_RATE,
                    self._downsample_state,
                )
                if self._api_client is not None and pcm16:
                    try:
                        await self._api_client.send_voice_assistant_audio(pcm16)
                    except Exception:  # noqa: BLE001
                        _LOGGER.exception("failed to forward audio to satellite")
                        break
            elif t == "response.done":
                # End-of-turn marker. server_vad keeps the session open for the
                # next user turn; we only tear down on explicit stop or error.
                _LOGGER.debug("realtime response.done")
            elif t == "session.created" or t == "session.updated":
                _LOGGER.debug("realtime %s", t)
            elif t == "error":
                _LOGGER.warning("realtime error: %s", msg.get("error") or msg)
                break

        # WS closed (server or client). Tear down the rest of the session.
        await self.stop()
