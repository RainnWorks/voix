"""HTTP/WebSocket endpoint that the satellite's voix_realtime_client connects to.

Audio path:

    satellite (16 kHz PCM, mono) → WS binary → THIS → upsample → OpenAI Realtime
    satellite ← WS binary ← THIS ← downsample ← OpenAI Realtime

Control path (text JSON):
    device → server  {"type": "hello",     "device": "<name>"}
    device → server  {"type": "interrupt"}
    device → server  {"type": "stop"}
    server → device  {"type": "ready"}
    server → device  {"type": "audio_start"}
    server → device  {"type": "audio_end"}
    server → device  {"type": "error", "message": "..."}

Lifecycle: one OpenAI Realtime WS per device connection. When device
disconnects, OpenAI WS is closed. The HA integration's RealtimeManager
isn't involved — this view owns the per-connection state.

Auth: TODO. For now requires_auth=False; intended for local LAN only.
"""
from __future__ import annotations

import asyncio
import base64
import json
import logging
import ssl
import time

from aiohttp import WSMsgType, web
from homeassistant.components.http import HomeAssistantView
from homeassistant.core import HomeAssistant

# Cost safeguards: OpenAI Realtime is billed per audio-minute. These caps
# keep a forgotten session from quietly burning money.
SESSION_HARD_MAX_S = 120.0       # absolute ceiling for one session
IDLE_TIMEOUT_S = 30.0            # close if no device→server audio for this long

from .const import (
    AUDIO_FORMAT_BYTES_PER_SAMPLE,
    CONF_OPENAI_API_KEY,
    CONF_REALTIME_INSTRUCTIONS,
    CONF_REALTIME_MODEL,
    CONF_REALTIME_VOICE,
    DEFAULT_REALTIME_INSTRUCTIONS,
    DEFAULT_REALTIME_MODEL,
    DEFAULT_REALTIME_VOICE,
    REALTIME_SAMPLE_RATE,
    REALTIME_WS_URL,
    SATELLITE_SAMPLE_RATE,
)

_LOGGER = logging.getLogger(__name__)


class VoixRealtimeView(HomeAssistantView):
    """aiohttp view that proxies a satellite ↔ OpenAI Realtime audio bridge."""

    url = "/api/voix/realtime"
    name = "voix:realtime"
    requires_auth = False  # TODO: token auth before exposing this beyond LAN.

    def __init__(self, hass: HomeAssistant, entry_data: dict) -> None:
        self._hass = hass
        self._entry_data = entry_data

    @property
    def _openai_key(self) -> str | None:
        return self._entry_data.get(CONF_OPENAI_API_KEY)

    @property
    def _model(self) -> str:
        return self._entry_data.get(CONF_REALTIME_MODEL, DEFAULT_REALTIME_MODEL)

    @property
    def _voice(self) -> str:
        return self._entry_data.get(CONF_REALTIME_VOICE, DEFAULT_REALTIME_VOICE)

    @property
    def _instructions(self) -> str:
        return self._entry_data.get(
            CONF_REALTIME_INSTRUCTIONS, DEFAULT_REALTIME_INSTRUCTIONS
        )

    async def get(self, request):
        if not self._openai_key:
            return web.Response(status=503, text="voix Realtime not configured")
        ws = web.WebSocketResponse(heartbeat=15.0)
        await ws.prepare(request)
        _LOGGER.info("voix WS: device connected from %s", request.remote)
        bridge = _Bridge(
            hass=self._hass,
            device_ws=ws,
            openai_key=self._openai_key,
            model=self._model,
            voice=self._voice,
            instructions=self._instructions,
        )
        try:
            await bridge.run()
        except Exception:  # noqa: BLE001
            _LOGGER.exception("voix WS: bridge crashed")
        finally:
            await ws.close()
            _LOGGER.info("voix WS: device disconnected")
        return ws


class _Bridge:
    """One satellite WS ↔ one OpenAI Realtime WS."""

    def __init__(
        self,
        *,
        hass: HomeAssistant,
        device_ws: web.WebSocketResponse,
        openai_key: str,
        model: str,
        voice: str,
        instructions: str,
    ) -> None:
        self.hass = hass
        self._device = device_ws
        self._openai_key = openai_key
        self._model = model
        self._voice = voice
        self._instructions = instructions

        self._openai: any = None
        # audioop.ratecv state, threaded for continuity across chunks.
        self._upsample_state = None
        self._downsample_state = None

        self._session_started = 0.0
        self._last_audio_in = 0.0
        self._bytes_in = 0
        self._bytes_out = 0
        self._force_response_task: asyncio.Task | None = None

    async def run(self) -> None:
        # IMPORTANT: do NOT open OpenAI here. Wait until the device sends its
        # first audio chunk. If a device connects but never speaks, we never
        # touch OpenAI = zero cost. _device_to_openai opens lazily.
        await self._send_device({"type": "ready"})
        self._session_started = time.monotonic()
        self._last_audio_in = self._session_started

        device_task = asyncio.create_task(self._device_to_openai(), name="voix-d2o")
        openai_task = asyncio.create_task(self._openai_to_device(), name="voix-o2d")
        watchdog_task = asyncio.create_task(self._watchdog(), name="voix-watchdog")
        try:
            done, pending = await asyncio.wait(
                {device_task, openai_task, watchdog_task},
                return_when=asyncio.FIRST_COMPLETED,
            )
            for t in done:
                # Surface exceptions for visibility (timeout, openai error, …).
                if t.exception():
                    _LOGGER.warning("voix WS: task ended with %s", t.exception())
        finally:
            for t in (device_task, openai_task, watchdog_task):
                if not t.done():
                    t.cancel()
            if self._openai is not None:
                try:
                    await self._openai.close()
                except Exception:  # noqa: BLE001
                    pass
            duration = time.monotonic() - self._session_started
            _LOGGER.warning(
                "voix WS: session closed after %.1fs (in=%dB, out=%dB)",
                duration, self._bytes_in, self._bytes_out,
            )

    async def _force_response_after(self, delay_s: float) -> None:
        """Diagnostic: force commit + response.create after delay.

        Bypasses server_vad. Lets us tell whether the audio path works
        end-to-end vs whether server_vad just isn't firing on our audio.
        Remove once Mode B is working reliably.
        """
        try:
            await asyncio.sleep(delay_s)
            if self._openai is None:
                return
            _LOGGER.warning(
                "voix WS: forcing commit+response.create after %.1fs", delay_s
            )
            await self._openai.send(
                json.dumps({"type": "input_audio_buffer.commit"})
            )
            await self._openai.send(json.dumps({"type": "response.create"}))
        except asyncio.CancelledError:
            pass
        except Exception:  # noqa: BLE001
            _LOGGER.exception("voix WS: force_response failed")

    async def _watchdog(self) -> None:
        """Force-close on hard max or idle timeout."""
        while True:
            await asyncio.sleep(2.0)
            now = time.monotonic()
            if now - self._session_started > SESSION_HARD_MAX_S:
                _LOGGER.warning(
                    "voix WS: hitting hard max %.0fs; closing", SESSION_HARD_MAX_S
                )
                return
            if now - self._last_audio_in > IDLE_TIMEOUT_S:
                _LOGGER.warning(
                    "voix WS: idle %.1fs > %.0fs; closing",
                    now - self._last_audio_in, IDLE_TIMEOUT_S,
                )
                return

    async def _connect_openai(self) -> None:
        import websockets

        ssl_ctx = await self.hass.async_add_executor_job(ssl.create_default_context)
        url = f"{REALTIME_WS_URL}?model={self._model}"
        headers = {"Authorization": f"Bearer {self._openai_key}"}
        try:
            try:
                self._openai = await asyncio.wait_for(
                    websockets.connect(url, additional_headers=headers, ssl=ssl_ctx),
                    timeout=10.0,
                )
            except TypeError:
                self._openai = await asyncio.wait_for(
                    websockets.connect(url, extra_headers=headers, ssl=ssl_ctx),
                    timeout=10.0,
                )
        except asyncio.TimeoutError:
            _LOGGER.warning("voix WS: OpenAI Realtime connect timed out after 10s")
            raise
        except Exception as e:  # noqa: BLE001
            _LOGGER.warning("voix WS: OpenAI Realtime connect failed: %s", e)
            raise
        # session.type is REQUIRED in session.update — OpenAI returns
        # missing_required_parameter without it. Model is set by URL query
        # so we leave it out of the session body.
        session_update = {
            "type": "session.update",
            "session": {
                "type": "realtime",
                "instructions": self._instructions,
                "audio": {
                    "input": {
                        "format": {
                            "type": "audio/pcm",
                            "rate": REALTIME_SAMPLE_RATE,
                        },
                        "turn_detection": {
                            "type": "server_vad",
                            "threshold": 0.5,
                            "prefix_padding_ms": 300,
                            "silence_duration_ms": 500,
                        },
                    },
                    "output": {
                        "format": {
                            "type": "audio/pcm",
                            "rate": REALTIME_SAMPLE_RATE,
                        },
                        "voice": self._voice,
                    },
                },
            },
        }
        await self._openai.send(json.dumps(session_update))
        _LOGGER.warning(
            "voix WS: OpenAI Realtime session opened (model=%s) — session.update sent",
            self._model,
        )

    # ─── Device → OpenAI ─────────────────────────────────────────────────────

    async def _device_to_openai(self) -> None:
        """Read mic audio + control messages from the device, forward to OpenAI.

        Opens the OpenAI Realtime WS lazily on the first audio chunk — if the
        device never speaks, OpenAI is never billed.
        """
        import audioop

        first_append_logged = False
        async for msg in self._device:
            if msg.type == WSMsgType.BINARY:
                self._bytes_in += len(msg.data)
                self._last_audio_in = time.monotonic()
                if self._openai is None:
                    _LOGGER.warning(
                        "voix WS: first audio chunk (%d bytes); opening OpenAI Realtime",
                        len(msg.data),
                    )
                    await self._connect_openai()
                pcm16k = msg.data
                pcm24k, self._upsample_state = audioop.ratecv(
                    pcm16k,
                    AUDIO_FORMAT_BYTES_PER_SAMPLE,
                    1,
                    SATELLITE_SAMPLE_RATE,
                    REALTIME_SAMPLE_RATE,
                    self._upsample_state,
                )
                if not first_append_logged:
                    _LOGGER.warning(
                        "voix WS: forwarding first input_audio_buffer.append "
                        "(in=%d bytes 16k mono → out=%d bytes 24k base64)",
                        len(pcm16k), len(pcm24k),
                    )
                    first_append_logged = True
                    # Diagnostic: force a response 5 s in if server_vad
                    # never fires. Lets us prove OpenAI is alive even if
                    # our audio shape is wrong.
                    self._force_response_task = asyncio.create_task(
                        self._force_response_after(5.0)
                    )
                await self._openai.send(
                    json.dumps(
                        {
                            "type": "input_audio_buffer.append",
                            "audio": base64.b64encode(pcm24k).decode("ascii"),
                        }
                    )
                )
            elif msg.type == WSMsgType.TEXT:
                try:
                    data = json.loads(msg.data)
                except json.JSONDecodeError:
                    continue
                t = data.get("type")
                _LOGGER.warning("voix WS: device→server %s %s", t, json.dumps(data)[:200])
                if t == "interrupt":
                    if self._openai is not None:
                        await self._openai.send(
                            json.dumps({"type": "response.cancel"})
                        )
                elif t == "stop":
                    return
            elif msg.type in (WSMsgType.CLOSE, WSMsgType.CLOSED, WSMsgType.ERROR):
                return

    # ─── OpenAI → Device ─────────────────────────────────────────────────────

    async def _openai_to_device(self) -> None:
        """Read Realtime events, forward audio + control to device.

        We forward 24 kHz PCM16 to the device unchanged — the Voice PE's
        `announcement_resampling_speaker` already takes 24 kHz input and
        resamples to its 48 kHz I2S output. Doing the conversion on the
        ESP32 would just duplicate work.

        Logs every event type at WARNING so the HA system_log surfaces
        them; debug-only audio.delta frames are sniffed at INFO so we
        don't spam.
        """
        # Idle wait: device might not have triggered OpenAI yet. Spin briefly.
        for _ in range(50):
            if self._openai is not None:
                break
            await asyncio.sleep(0.1)
        if self._openai is None:
            return
        speaking = False
        event_counts: dict[str, int] = {}
        async for raw in self._openai:
            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                _LOGGER.warning("voix WS: OpenAI non-JSON frame: %r", raw[:200])
                continue
            t = msg.get("type", "")
            event_counts[t] = event_counts.get(t, 0) + 1

            # Surface anything we haven't seen before, plus error/session
            # events. audio.delta is high-frequency so we count instead.
            if not t.endswith("audio.delta") and not t.endswith("audio_transcript.delta"):
                # Trim large fields before logging.
                preview = {k: v for k, v in msg.items() if k not in ("audio", "delta")}
                _LOGGER.warning("voix WS: openai %s %s", t, json.dumps(preview)[:400])

            if t.endswith("audio.delta"):
                b64 = msg.get("delta") or msg.get("audio") or ""
                if not b64:
                    continue
                if not speaking:
                    speaking = True
                    _LOGGER.warning("voix WS: first audio.delta — playback starting")
                    await self._send_device({"type": "audio_start"})
                pcm24k = base64.b64decode(b64)
                if pcm24k:
                    self._bytes_out += len(pcm24k)
                    await self._device.send_bytes(pcm24k)
            elif t == "response.done":
                if speaking:
                    speaking = False
                    await self._send_device({"type": "audio_end"})
            elif t == "error":
                err = msg.get("error", {})
                _LOGGER.warning("voix WS: OpenAI error %s", err)
                await self._send_device(
                    {"type": "error", "message": err.get("message", str(err))}
                )

        # Pump exited (WS closed). Summary log so we can see what events arrived.
        _LOGGER.warning("voix WS: openai pump exited. counts=%s", event_counts)

    async def _send_device(self, payload: dict) -> None:
        if self._device.closed:
            return
        try:
            await self._device.send_json(payload)
        except Exception:  # noqa: BLE001
            _LOGGER.debug("voix WS: send to device failed", exc_info=True)


def register(hass: HomeAssistant, entry_data: dict) -> VoixRealtimeView:
    """Register and return the WS view for an entry."""
    view = VoixRealtimeView(hass, entry_data)
    hass.http.register_view(view)
    return view
