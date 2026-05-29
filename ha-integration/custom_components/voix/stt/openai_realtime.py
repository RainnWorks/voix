"""OpenAI realtime-session STT backend (hand-rolled WS, GA schema).

Tried the official `openai` SDK first — its `client.beta.realtime`
namespace uses the deprecated beta schema (OpenAI disabled it
2026-05-12), and the GA `client.realtime` namespace only exists in
`openai>=2.36.0`. HA Core pins `openai==2.21.0` (its
openai_conversation integration), so we can't upgrade. Hand-rolling
the WS is the only path until HA updates its pin.

The GA session schema (which we validated by getting through to
`session.updated` + `input_audio_buffer.speech_started` events):

    {
      "type": "realtime",
      "output_modalities": ["text"],
      "audio": {
        "input": {
          "format": {"type": "audio/pcm", "rate": 24000},
          "noise_reduction": {"type": "near_field"},
          "transcription": {"model": "gpt-4o-mini-transcribe", "language": "en"},
          "turn_detection": {"type": "semantic_vad", "eagerness": "low"},
        },
      },
    }

NOT the beta flat shape with `modalities` / `input_audio_format` keys
at the top level — OpenAI rejects that with `beta_api_shape_disabled`.

Audio: device sends 16 kHz mono PCM16. OpenAI requires ≥ 24 kHz, so
we upsample 16 → 24 with audioop.ratecv. State threaded across
send_audio calls for waveform continuity.
"""
from __future__ import annotations

import asyncio
import base64
import json
import logging
import ssl
from typing import AsyncIterator

import websockets

from . import STTComplete, STTDelta, STTError, STTEvent

_LOGGER = logging.getLogger(__name__)

REALTIME_WS_URL = "wss://api.openai.com/v1/realtime"
DEVICE_SAMPLE_RATE = 16000
OPENAI_SAMPLE_RATE = 24000


class OpenAIRealtimeSTT:
    def __init__(self, *, api_key: str, model: str) -> None:
        self._api_key = api_key
        # `model` is the STT model for the inner transcription
        # (e.g. gpt-4o-mini-transcribe). The realtime session URL takes
        # a separate model — fixed because we don't use the realtime
        # model's output.
        self._transcribe_model = model or "gpt-4o-mini-transcribe"
        self._realtime_model = "gpt-realtime-2"
        self._ws: websockets.WebSocketClientProtocol | None = None
        self._events: asyncio.Queue[STTEvent | None] = asyncio.Queue()
        self._partial: str = ""
        self._reader_task: asyncio.Task | None = None
        self._closed = False
        self._upsample_state = None

    async def connect(self) -> None:
        url = f"{REALTIME_WS_URL}?model={self._realtime_model}"
        headers = {"Authorization": f"Bearer {self._api_key}"}
        ssl_ctx = ssl.create_default_context()
        try:
            self._ws = await asyncio.wait_for(
                websockets.connect(url, additional_headers=headers, ssl=ssl_ctx),
                timeout=10.0,
            )
        except TypeError:
            self._ws = await asyncio.wait_for(
                websockets.connect(url, extra_headers=headers, ssl=ssl_ctx),
                timeout=10.0,
            )

        session_body = {
            "type": "realtime",
            "output_modalities": ["text"],
            "audio": {
                "input": {
                    "format": {"type": "audio/pcm", "rate": OPENAI_SAMPLE_RATE},
                    "noise_reduction": {"type": "near_field"},
                    "transcription": {
                        "model": self._transcribe_model,
                        "language": "en",
                    },
                    # eagerness=high so speech_stopped fires quickly
                    # after a pause — gives us a transcription.completed
                    # event we can verify in logs. semantic_vad with
                    # eagerness=low waits a long time before declaring
                    # the user "done", which delays transcription too.
                    # Once we've confirmed the pipeline works, we can
                    # tune this per-use-case.
                    "turn_detection": {
                        "type": "semantic_vad",
                        "eagerness": "high",
                    },
                },
            },
        }
        await self._ws.send(
            json.dumps({"type": "session.update", "session": session_body})
        )
        self._reader_task = asyncio.create_task(self._reader_loop())

    async def send_audio(self, pcm16_bytes: bytes) -> None:
        if self._ws is None or self._closed or not pcm16_bytes:
            return
        import audioop

        pcm24k, self._upsample_state = audioop.ratecv(
            pcm16_bytes, 2, 1,
            DEVICE_SAMPLE_RATE, OPENAI_SAMPLE_RATE,
            self._upsample_state,
        )
        await self._ws.send(
            json.dumps(
                {
                    "type": "input_audio_buffer.append",
                    "audio": base64.b64encode(pcm24k).decode("ascii"),
                }
            )
        )

    async def close(self) -> None:
        self._closed = True
        if self._reader_task is not None and not self._reader_task.done():
            self._reader_task.cancel()
        if self._ws is not None:
            try:
                await asyncio.wait_for(self._ws.close(), timeout=2.0)
            except (asyncio.TimeoutError, Exception):  # noqa: BLE001
                pass
        await self._events.put(None)

    async def events(self) -> AsyncIterator[STTEvent]:
        while True:
            item = await self._events.get()
            if item is None:
                return
            yield item

    async def _reader_loop(self) -> None:
        assert self._ws is not None
        event_counts: dict[str, int] = {}
        try:
            async for raw in self._ws:
                try:
                    msg = json.loads(raw)
                except json.JSONDecodeError:
                    continue
                t = msg.get("type", "")
                event_counts[t] = event_counts.get(t, 0) + 1
                # Lifecycle visibility at WARN — helps debug what
                # OpenAI actually accepts/sends without enabling
                # global DEBUG-level logging.
                if t in (
                    "session.created",
                    "session.updated",
                    "input_audio_buffer.speech_started",
                    "input_audio_buffer.speech_stopped",
                    "conversation.item.input_audio_transcription.completed",
                    "error",
                ):
                    payload = json.dumps(msg)
                    if t == "session.updated":
                        # Persist to disk too — the 100-line `ha core
                        # logs` buffer keeps rolling this away.
                        try:
                            from pathlib import Path

                            debug_path = Path("/config/voix-session-updated.json")
                            debug_path.write_text(payload, encoding="utf-8")
                        except Exception:  # noqa: BLE001
                            pass
                        _LOGGER.warning("openai-realtime STT event %s: %s", t, payload)
                    else:
                        _LOGGER.warning("openai-realtime STT event %s: %s",
                                         t, payload[:400])
                if t == "conversation.item.input_audio_transcription.delta":
                    delta = msg.get("delta") or ""
                    if delta:
                        self._partial += delta
                        await self._events.put(
                            STTDelta(delta=delta, accumulated=self._partial)
                        )
                    elif event_counts[t] <= 3:
                        # We hit this exact failure mode with the bare
                        # transcription session: deltas with only
                        # `obfuscation` and no text. If you see this
                        # log, the inner transcription model isn't
                        # actually producing text events.
                        _LOGGER.warning(
                            "openai-realtime STT: empty delta "
                            "(obfuscation only: %s)",
                            bool(msg.get("obfuscation")),
                        )
                elif t == "conversation.item.input_audio_transcription.completed":
                    final = (msg.get("transcript") or "").strip()
                    self._partial = ""
                    await self._events.put(STTComplete(text=final))
                elif t == "error":
                    err = msg.get("error", {})
                    await self._events.put(
                        STTError(message=err.get("message") or str(err))
                    )
        except asyncio.CancelledError:
            pass
        except Exception as e:  # noqa: BLE001
            _LOGGER.warning("openai-realtime STT reader: %s", e)
            await self._events.put(STTError(message=str(e)))
        finally:
            _LOGGER.warning(
                "openai-realtime STT reader exit. event_counts=%s", event_counts
            )
            await self._events.put(None)
