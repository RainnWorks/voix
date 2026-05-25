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

from aiohttp import WSMsgType, web
from homeassistant.components.http import HomeAssistantView
from homeassistant.core import HomeAssistant

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

    async def run(self) -> None:
        await self._connect_openai()
        await self._send_device({"type": "ready"})
        device_task = asyncio.create_task(self._device_to_openai(), name="voix-d2o")
        openai_task = asyncio.create_task(self._openai_to_device(), name="voix-o2d")
        try:
            done, pending = await asyncio.wait(
                {device_task, openai_task}, return_when=asyncio.FIRST_COMPLETED
            )
        finally:
            for t in (device_task, openai_task):
                if not t.done():
                    t.cancel()
            if self._openai is not None:
                try:
                    await self._openai.close()
                except Exception:  # noqa: BLE001
                    pass

    async def _connect_openai(self) -> None:
        import websockets

        ssl_ctx = await self.hass.async_add_executor_job(ssl.create_default_context)
        url = f"{REALTIME_WS_URL}?model={self._model}"
        headers = {"Authorization": f"Bearer {self._openai_key}"}
        try:
            self._openai = await websockets.connect(
                url, additional_headers=headers, ssl=ssl_ctx
            )
        except TypeError:
            self._openai = await websockets.connect(
                url, extra_headers=headers, ssl=ssl_ctx
            )
        await self._openai.send(
            json.dumps(
                {
                    "type": "session.update",
                    "session": {
                        "type": "realtime",
                        "model": self._model,
                        "instructions": self._instructions,
                        "audio": {
                            "input": {
                                "format": {
                                    "type": "audio/pcm",
                                    "rate": REALTIME_SAMPLE_RATE,
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
            )
        )
        _LOGGER.info("voix WS: OpenAI Realtime session opened")

    # ─── Device → OpenAI ─────────────────────────────────────────────────────

    async def _device_to_openai(self) -> None:
        """Read mic audio + control messages from the device, forward to OpenAI."""
        import audioop

        async for msg in self._device:
            if msg.type == WSMsgType.BINARY:
                pcm16k = msg.data
                pcm24k, self._upsample_state = audioop.ratecv(
                    pcm16k,
                    AUDIO_FORMAT_BYTES_PER_SAMPLE,
                    1,
                    SATELLITE_SAMPLE_RATE,
                    REALTIME_SAMPLE_RATE,
                    self._upsample_state,
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
                if t == "interrupt":
                    await self._openai.send(json.dumps({"type": "response.cancel"}))
                elif t == "stop":
                    return
                # hello / others — log and continue
                else:
                    _LOGGER.debug("voix WS device: %s", data)
            elif msg.type in (WSMsgType.CLOSE, WSMsgType.CLOSED, WSMsgType.ERROR):
                return

    # ─── OpenAI → Device ─────────────────────────────────────────────────────

    async def _openai_to_device(self) -> None:
        """Read Realtime events, forward audio + control to device."""
        import audioop

        speaking = False
        async for raw in self._openai:
            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                continue
            t = msg.get("type", "")
            if t.endswith("audio.delta"):
                b64 = msg.get("delta") or msg.get("audio") or ""
                if not b64:
                    continue
                if not speaking:
                    speaking = True
                    await self._send_device({"type": "audio_start"})
                pcm24k = base64.b64decode(b64)
                pcm16k, self._downsample_state = audioop.ratecv(
                    pcm24k,
                    AUDIO_FORMAT_BYTES_PER_SAMPLE,
                    1,
                    REALTIME_SAMPLE_RATE,
                    SATELLITE_SAMPLE_RATE,
                    self._downsample_state,
                )
                if pcm16k:
                    await self._device.send_bytes(pcm16k)
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
