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
disconnects, OpenAI WS is closed. This view owns the per-connection state.

Auth: shared-secret token validated at hello time. requires_auth=False on
the aiohttp view itself (no HA cookie/bearer for the device); the token
in the WS hello payload is the actual gate.
"""
from __future__ import annotations

import asyncio
import base64
import json
import logging
import ssl
import time
from collections import deque
from pathlib import Path

from aiohttp import WSMsgType, web
from homeassistant.components.http import HomeAssistantView
from homeassistant.core import Context, HomeAssistant
from homeassistant.helpers import llm
from homeassistant.helpers.template import Template

# voluptuous_openapi ships with Home Assistant core (the llm helper imports
# it at module level), so no manifest declaration needed.
from voluptuous_openapi import convert as _voluptuous_to_openapi

from homeassistant.helpers.dispatcher import async_dispatcher_send

from .const import (
    AUDIO_FORMAT_BYTES_PER_SAMPLE,
    CONF_DEFAULT_MODEL,
    CONF_DEFAULT_VOICE,
    CONF_IDLE_TIMEOUT_S,
    CONF_OPENAI_API_KEY,
    CONF_WS_TOKEN,
    DEFAULT_IDLE_TIMEOUT_S,
    DEFAULT_REALTIME_INSTRUCTIONS,
    DEFAULT_REALTIME_MODEL,
    DEFAULT_REALTIME_VOICE,
    DOMAIN,
    EVENT_DICTATION_CAPTURED,
    EVENT_REALTIME_ASSISTANT_TRANSCRIPT,
    EVENT_REALTIME_SESSION_ENDED,
    EVENT_REALTIME_SESSION_STARTED,
    EVENT_REALTIME_USER_TRANSCRIPT,
    EVENT_TRANSCRIPT_DELTA,
    MODE_TYPE_ASSIST,
    MODE_TYPE_DICTATION,
    MODE_TYPE_REALTIME,
    REALTIME_SAMPLE_RATE,
    REALTIME_VOICES,
    REALTIME_WS_URL,
    SATELLITE_SAMPLE_RATE,
    SIGNAL_TRANSCRIPT_UPDATED,
    TRANSCRIPTS_DIRNAME,
)
from .modes import get_default_mode_id, get_mode
from .util import device_slug

# Cost safeguards: OpenAI Realtime is billed per audio-minute.
#
# Idle timeout (entry-configurable, see CONF_IDLE_TIMEOUT_S) is the primary
# cost guard: N seconds without any OpenAI engagement (no speech detection,
# no response, no audio.delta) and the session closes. A live response
# keeps audio.delta flowing, so a multi-minute response won't trip this.
#
# SESSION_HARD_MAX_S is a belt-and-suspenders ceiling for runaway sessions.
# 10 min comfortably covers any reasonable single response; raise if you
# need long-form generation.
SESSION_HARD_MAX_S = 600.0       # absolute ceiling for one session

# ─── voix-builtin tools ──────────────────────────────────────────────────────
# These are exposed to OpenAI Realtime alongside HA's LLM API tools. They
# control the voix session itself rather than HA state. The model decides
# when to call them based on the prompt hint below.

VOIX_TOOL_END_SESSION = "voix_end_session"

VOIX_BUILTIN_TOOL_SPECS: list[dict] = [
    {
        "type": "function",
        "name": VOIX_TOOL_END_SESSION,
        "description": (
            "End the current voice session. ONLY call this when the user "
            "has EXPLICITLY signalled they're done with words like: "
            "'goodbye', 'bye', 'thanks bye', 'that's all', 'I'm done', "
            "'dismiss', 'stop', 'never mind', 'cancel', 'end session'. "
            "Do NOT call this just because there's a pause or the user "
            "didn't immediately follow up — silence will time out on its "
            "own and that's fine. Do NOT call this after answering a "
            "question unless the user explicitly closed the conversation. "
            "When you DO call it: speak your short goodbye line first, "
            "then call the tool — never call it before the goodbye audio."
        ),
        "parameters": {"type": "object", "properties": {}, "required": []},
    },
]

VOIX_TOOL_PROMPT_HINT = (
    "Session control: voix_end_session() ends the conversation. ONLY call "
    "it when the user has EXPLICITLY said goodbye/bye/that's all/I'm done/"
    "stop/dismiss. Never call it on pauses, mid-conversation lulls, or "
    "just because you finished answering — let silence time out instead. "
    "When you do call it, speak the goodbye line first, then call the tool."
)

_LOGGER = logging.getLogger(__name__)


class VoixRealtimeView(HomeAssistantView):
    """aiohttp view that proxies a satellite ↔ OpenAI Realtime audio bridge."""

    url = "/api/voix/realtime"
    name = "voix:realtime"
    # No HA-cookie auth; the firmware can't carry one. Auth happens in
    # _read_hello via the WS-token shared secret.
    requires_auth = False

    def __init__(self, hass: HomeAssistant, entry_data: dict, entry_id: str) -> None:
        self._hass = hass
        self._entry_data = entry_data
        self._entry_id = entry_id

    def _entry(self):
        return self._hass.config_entries.async_get_entry(self._entry_id)

    def _openai_key(self) -> str | None:
        """OpenAI key is entry-wide (single billing)."""
        entry = self._entry()
        if entry is not None:
            key = entry.options.get(CONF_OPENAI_API_KEY) or entry.data.get(CONF_OPENAI_API_KEY)
            if key:
                return key
        return self._entry_data.get(CONF_OPENAI_API_KEY)

    def _openrouter_key(self) -> str | None:
        """OpenRouter key — optional, only used by post-processing."""
        from .const import CONF_OPENROUTER_API_KEY
        entry = self._entry()
        if entry is not None:
            key = (
                entry.options.get(CONF_OPENROUTER_API_KEY)
                or entry.data.get(CONF_OPENROUTER_API_KEY)
            )
            if key:
                return key
        return self._entry_data.get(CONF_OPENROUTER_API_KEY)

    def _current_mode_id_for(self, device_id: str | None) -> str:
        """Look up a device's currently selected mode_id from its select entity."""
        selects = self._hass.data.get(DOMAIN, {}).get("mode_select", {})
        entity = None
        if device_id:
            entity = selects.get(device_id)
        if entity is None and len(selects) == 1:
            entity = next(iter(selects.values()))
        mode_id = getattr(entity, "current_option", None)
        if mode_id:
            return mode_id
        entry = self._entry()
        return get_default_mode_id(entry) if entry else "default-assist"

    async def _read_hello(
        self, ws: web.WebSocketResponse
    ) -> tuple[str | None, str | None, str | None]:
        """Read the first text message; expect {type:hello, device_id, token, ...}.

        Returns (device_id, friendly_name, token) or all-None on timeout /
        malformed. The waited time is short because we close the WS without
        the hello — old firmware that doesn't send one is no longer supported
        once token auth is required.
        """
        try:
            msg = await asyncio.wait_for(ws.receive(), timeout=1.5)
        except asyncio.TimeoutError:
            return None, None, None
        if msg.type != WSMsgType.TEXT:
            return None, None, None
        try:
            data = json.loads(msg.data)
        except json.JSONDecodeError:
            return None, None, None
        if data.get("type") != "hello":
            return None, None, None
        return data.get("device_id"), data.get("friendly_name"), data.get("token")

    def _expected_ws_token(self) -> str | None:
        """Return the entry's WS token, or None if not yet generated."""
        entry = self._entry()
        if entry is not None:
            tok = entry.data.get(CONF_WS_TOKEN)
            if tok:
                return tok
        return self._entry_data.get(CONF_WS_TOKEN)

    async def _supersede_prior_session(self, device_id: str) -> None:
        """Close any previously-open WS for the same device_id.

        Prevents the parallel-billing window on firmware crash + reconnect.
        Tracked in hass.data[DOMAIN]["active_ws"][device_id] = aiohttp WS.
        """
        active = self._hass.data.setdefault(DOMAIN, {}).setdefault("active_ws", {})
        prev = active.get(device_id)
        if prev is not None and not prev.closed:
            _LOGGER.info(
                "voix WS: closing prior session for device %s before starting new one",
                device_id,
            )
            try:
                await prev.close()
            except Exception:  # noqa: BLE001
                pass

    async def get(self, request):
        ws = web.WebSocketResponse(heartbeat=15.0)
        await ws.prepare(request)
        device_id, friendly_name, presented_token = await self._read_hello(ws)

        # Auth: the WS endpoint has no HA-auth (LAN convenience), but every
        # hello must carry the shared-secret token generated at integration
        # setup. Mismatched/missing token → close before opening any OpenAI
        # session. Prevents a LAN attacker from burning the OpenAI key.
        expected = self._expected_ws_token()
        if expected and presented_token != expected:
            _LOGGER.warning(
                "voix WS: rejecting %s — invalid/missing token (device=%s)",
                request.remote, device_id,
            )
            await ws.close()
            return ws

        if device_id:
            _LOGGER.info(
                "voix WS: device %s (%s) connected from %s",
                device_id, friendly_name or "?", request.remote,
            )
            # Close any prior session for this device_id BEFORE we register
            # this one — avoids parallel OpenAI billing on firmware reboot.
            await self._supersede_prior_session(device_id)
            # Track this WS so a future hello can supersede us.
            self._hass.data.setdefault(DOMAIN, {}).setdefault("active_ws", {})[device_id] = ws
            # Tell session-state entities (per-device binary_sensor) we're up.
            from . import SIGNAL_SESSION_STATE_CHANGED
            async_dispatcher_send(self._hass, SIGNAL_SESSION_STATE_CHANGED, device_id, True)
            # Register the device with the integration so per-device entities
            # get added if they don't exist yet.
            register_cb = self._hass.data.get(DOMAIN, {}).get("register_device")
            if register_cb is not None:
                register_cb(device_id, friendly_name or device_id)
        else:
            _LOGGER.warning(
                "voix WS: rejecting %s — no device_id in hello",
                request.remote,
            )
            await ws.close()
            return ws

        mode_id = self._current_mode_id_for(device_id)
        entry = self._entry()
        mode_def = get_mode(entry, mode_id) if entry else {}
        behavior = mode_def.get("type", MODE_TYPE_ASSIST)
        openai_key = self._openai_key()
        if not openai_key and behavior in (MODE_TYPE_REALTIME, MODE_TYPE_DICTATION):
            await ws.close()
            _LOGGER.warning(
                "voix WS: declining mode=%r (type=%s) — no OpenAI key configured",
                mode_id, behavior,
            )
            return ws
        _LOGGER.info(
            "voix WS: dispatching mode_id=%s (type=%s) for device=%s",
            mode_id, behavior, device_id,
        )
        try:
            if behavior == MODE_TYPE_REALTIME:
                # Voice + model resolution: mode-specific → entry-wide
                # default (gateway entity) → constant. Keeps modes lean —
                # most users only set voice/model in one place.
                gateway_voice = (entry.options.get(CONF_DEFAULT_VOICE) if entry else None)
                voice = (
                    mode_def.get("voice")
                    or (gateway_voice if gateway_voice in REALTIME_VOICES else None)
                    or DEFAULT_REALTIME_VOICE
                )
                gateway_model = (entry.options.get(CONF_DEFAULT_MODEL) if entry else None)
                model = (
                    mode_def.get("model")
                    or gateway_model
                    or DEFAULT_REALTIME_MODEL
                )
                bridge = _RealtimeBridge(
                    hass=self._hass,
                    device_ws=ws,
                    openai_key=openai_key,
                    model=model,
                    voice=voice,
                    instructions=mode_def.get("prompt") or DEFAULT_REALTIME_INSTRUCTIONS,
                    prompt_include_entities=list(mode_def.get("include_entities") or []),
                    prompt_include_persons=list(mode_def.get("include_persons") or []),
                    prompt_addendum=(mode_def.get("addendum") or "").strip(),
                    device_id=device_id,
                    entry_id=self._entry_id,
                )
                await bridge.run()
            elif behavior == MODE_TYPE_DICTATION:
                # Resolve STT provider + model for this mode. Per-mode picker;
                # falls back to the default (OpenAI realtime-session) so
                # existing modes get streaming partials without any user
                # action — see `stt/__init__.py`.
                from .stt import (
                    DEFAULT_STT_PROVIDER,
                    STT_PROVIDERS,
                    make_backend as _make_stt_backend,
                )
                stt_provider = (
                    mode_def.get("stt_provider") or DEFAULT_STT_PROVIDER
                )
                stt_model = (
                    mode_def.get("stt_model")
                    or STT_PROVIDERS.get(stt_provider, ("", ""))[1]
                )
                api_keys = {"openai-realtime": openai_key}
                try:
                    backend = _make_stt_backend(
                        stt_provider, model=stt_model, api_keys=api_keys,
                    )
                except ValueError as e:
                    _LOGGER.warning(
                        "voix dictation: backend init failed (provider=%s): %s",
                        stt_provider, e,
                    )
                    await ws.send_json({"type": "error", "message": str(e)})
                    return ws
                bridge = _DictationBridge(
                    hass=self._hass,
                    device_ws=ws,
                    backend=backend,
                    device_id=device_id,
                    entry_id=self._entry_id,
                    post_process_prompt=(
                        mode_def.get("post_process_prompt") or ""
                    ),
                    post_process_provider=(
                        mode_def.get("post_process_provider") or "openai"
                    ),
                    post_process_model=(
                        mode_def.get("post_process_model") or "gpt-4o-mini"
                    ),
                    openai_key=openai_key,
                    openrouter_key=self._openrouter_key(),
                )
                await bridge.run()
            else:  # assist
                # Mode of type "assist" is owned by upstream's voice_assistant;
                # our WS bridge has no role. Politely decline so the device
                # knows to fall back to upstream's pipeline.
                await ws.send_json({"type": "decline", "reason": "mode is assist"})
        except Exception:  # noqa: BLE001
            _LOGGER.exception(
                "voix WS: bridge crashed (mode_id=%s, type=%s)", mode_id, behavior
            )
        finally:
            # Clear the active_ws slot + dispatch session-off BEFORE awaiting
            # ws.close(): when the device crashes mid-session the underlying
            # socket can leave the close handshake hanging indefinitely, and
            # we don't want that to also pin the binary_sensor's "on" state
            # (which is exactly the bug Tom hit after the audio-playback
            # crash — bridge logged "session closed" but the sensor stayed
            # on for 26 minutes because finally never got past `await close()`).
            active = self._hass.data.get(DOMAIN, {}).get("active_ws") or {}
            was_ours = active.get(device_id) is ws
            if was_ours:
                active.pop(device_id, None)
                from . import SIGNAL_SESSION_STATE_CHANGED
                async_dispatcher_send(
                    self._hass, SIGNAL_SESSION_STATE_CHANGED, device_id, False
                )
            try:
                await asyncio.wait_for(ws.close(), timeout=2.0)
            except (asyncio.TimeoutError, Exception):  # noqa: BLE001
                # Best-effort close — the FD will get reaped by aiohttp's
                # connection pool eventually. We don't block the dispatch.
                _LOGGER.debug("voix WS: ws.close() timed out / raised", exc_info=True)
            _LOGGER.info(
                "voix WS: device disconnected (device=%s, mode_id=%s, type=%s)",
                device_id, mode_id, behavior,
            )
        return ws


class _PacedAudioSender:
    """Leaky-bucket pacer for forwarding PCM to the device at ~realtime rate.

    Background: OpenAI Realtime streams audio.delta events faster than the
    audio's wall-clock duration (the model pre-generates ahead). If we
    forward each delta to the device the moment it arrives, the device's
    fixed-size inbound queue overflows and the speaker plays out-of-order
    chunks — that's the "crazy audio" symptom.

    This sender holds the audio on the HA side (RPi has gigs of RAM) and
    releases each chunk only when the device would have less than
    `lookahead_s` of audio buffered ahead of wall-clock playback. First
    chunks rip through with no delay so audio starts immediately; after
    we're `lookahead_s` ahead, each send waits long enough to stay one
    lookahead ahead of realtime.

    Reset between responses by calling `reset()` (we do this on every
    fresh `audio_start`); each response starts its own pacing window.
    """

    def __init__(self, *, sample_rate: int, bytes_per_sample: int, lookahead_s: float) -> None:
        self._bytes_per_sec: float = float(sample_rate * bytes_per_sample)
        self._lookahead_s: float = lookahead_s
        self._started_at: float | None = None
        self._bytes_sent: int = 0

    def reset(self) -> None:
        """Call at the start of each fresh response (first audio.delta)."""
        self._started_at = time.monotonic()
        self._bytes_sent = 0

    async def send(self, ws, payload: bytes) -> None:
        """Sleep just enough to stay one lookahead ahead of realtime, then send."""
        if self._started_at is not None:
            elapsed = time.monotonic() - self._started_at
            sent_seconds = self._bytes_sent / self._bytes_per_sec
            buffered = sent_seconds - elapsed
            if buffered > self._lookahead_s:
                await asyncio.sleep(buffered - self._lookahead_s)
        self._bytes_sent += len(payload)
        await ws.send_bytes(payload)


class _EchoGate:
    """Energy-based echo detection. Drops mic chunks that look like the
    model's own speech bleeding back through the speaker.

    Not a true AEC — no signal subtraction, no clock-domain alignment.
    Just compares mic RMS against a predicted echo level derived from
    recently-sent speaker output. Imperfect: when echo and real speech
    overlap closely, may drop or pass either way. But it never produces
    "fake user turns" from the model's own voice, which is the actual
    failure mode that derails OpenAI Realtime sessions.

    Why this works:
      - Voice PE's XMOS DSP already does hardware AEC (~25 dB residual).
      - Echo at the mic is therefore ~-25 dB below speaker output level.
      - User speech into the mic at conversational distance is much
        louder than the residual echo (typically 20–30 dB above).
      - So an energy threshold cleanly separates "just echo" from
        "user is talking over the model".

    The reference window covers the worst-case mic→speaker delay
    (paced sender lookahead + device inbound queue + speaker latency).
    Peak RMS in that window predicts the current echo level at the mic.

    Tuning constants are chosen conservatively to start; expect to
    tighten ECHO_PATH_GAIN once we see real residuals on this hardware.
    """

    # Post-AEC residual gain. -16 dB starting point (0.15). XMOS gives
    # ~25 dB AEC but real-world residual varies with room + volume.
    # Lower → more echo treated as below threshold (less mic gating);
    # higher → more conservative gating (more dropped mic chunks).
    ECHO_PATH_GAIN = 0.15

    # Real-speech threshold: mic RMS must exceed predicted echo by this
    # factor to be forwarded. 4× ≈ 12 dB headroom — well within the
    # 20–30 dB delta between actual user speech and post-AEC echo.
    INTERRUPT_THRESHOLD = 4.0

    # How far back to look in our sent-speaker history. Must cover:
    #   paced-sender lookahead (~2.0 s) + device queue (<0.7 s) +
    #   speaker DMA latency (~0.1 s) ≈ 2.8 s. Use 3 s with margin.
    WINDOW_S = 3.0

    def __init__(self) -> None:
        # (sent_at_monotonic, rms) for each speaker chunk we recently sent.
        self._refs: deque[tuple[float, int]] = deque()
        self._forwarded = 0
        self._dropped = 0

    def observe_speaker(self, pcm_bytes: bytes) -> None:
        """Record RMS of a chunk we just queued for the device speaker."""
        if not pcm_bytes:
            return
        import audioop

        rms = audioop.rms(pcm_bytes, 2)
        now = time.monotonic()
        self._refs.append((now, rms))
        cutoff = now - self.WINDOW_S
        while self._refs and self._refs[0][0] < cutoff:
            self._refs.popleft()

    def should_forward(self, mic_bytes: bytes) -> tuple[bool, int, int]:
        """Return (forward, mic_rms, peak_ref_rms) for the given mic chunk."""
        if not mic_bytes:
            return True, 0, 0
        import audioop

        mic_rms = audioop.rms(mic_bytes, 2)
        now = time.monotonic()
        cutoff = now - self.WINDOW_S
        while self._refs and self._refs[0][0] < cutoff:
            self._refs.popleft()
        if not self._refs:
            # No recent model speech → mic can't be echo. Forward.
            self._forwarded += 1
            return True, mic_rms, 0
        peak_ref_rms = max(rms for _, rms in self._refs)
        predicted_echo = peak_ref_rms * self.ECHO_PATH_GAIN
        threshold = predicted_echo * self.INTERRUPT_THRESHOLD
        if mic_rms > threshold:
            self._forwarded += 1
            return True, mic_rms, peak_ref_rms
        self._dropped += 1
        return False, mic_rms, peak_ref_rms

    def stats(self) -> str:
        total = self._forwarded + self._dropped
        if total == 0:
            return "echo_gate: idle"
        pct = 100.0 * self._dropped / total
        return (
            f"echo_gate: forwarded={self._forwarded} dropped={self._dropped} "
            f"({pct:.1f}% dropped)"
        )


class _TranscriptStore:
    """Per-session, per-role transcript file store.

    HA's entity-state cap (255 chars on `state`, ~16 KB total for state +
    attributes when serialized) makes long dictations and multi-turn
    realtime conversations unusable in attributes. Storage moves to plain
    files under `<config>/voix/transcripts/<device_slug>/`. Sensors expose
    the filepath; the `voix.get_transcript` service returns content.

    Layout:
        <config>/voix/transcripts/<device_slug>/<session_id>-<role>.txt

    Content: cumulative across all turns in the session. Turns are joined
    with a blank line. The current in-progress turn is appended after the
    completed ones; on completion it moves into the completed list and the
    file is rewritten cleanly.

    Writes go through the executor (Path.write_text is sync) and use a
    temp-then-rename for atomicity — the Tauri app polling the file via
    `voix.get_transcript` never sees a half-written state.
    """

    def __init__(self, hass: HomeAssistant) -> None:
        self._hass = hass
        # (device_id, session_id, role) → list of completed turn texts
        self._history: dict[tuple[str, str, str], list[str]] = {}
        # (device_id, session_id, role) → current in-progress partial text
        self._partial: dict[tuple[str, str, str], str] = {}

    def base_dir(self) -> Path:
        return Path(self._hass.config.path(TRANSCRIPTS_DIRNAME))

    def file_path(self, device_id: str, session_id: str, role: str) -> Path:
        return self.base_dir() / device_slug(device_id) / f"{session_id}-{role}.txt"

    async def write_partial(
        self,
        device_id: str,
        session_id: str,
        role: str,
        current_turn_text: str,
    ) -> tuple[Path, int]:
        """Record/replace the in-progress turn's text and rewrite the file."""
        key = (device_id, session_id, role)
        self._partial[key] = current_turn_text
        return await self._rewrite(device_id, session_id, role)

    async def write_complete(
        self,
        device_id: str,
        session_id: str,
        role: str,
        final_turn_text: str,
    ) -> tuple[Path, int]:
        """Promote the current turn to history and rewrite the file."""
        key = (device_id, session_id, role)
        if final_turn_text:
            self._history.setdefault(key, []).append(final_turn_text)
        self._partial.pop(key, None)
        return await self._rewrite(device_id, session_id, role)

    async def write_raw_sidecar(
        self,
        device_id: str,
        session_id: str,
        role: str,
        raw_text: str,
    ) -> Path:
        """Save the pre-post-processing transcript next to the polished one.

        Written as `<session_id>-<role>.raw.txt`. Helps debug a bad
        post_process_prompt without re-recording — diff the .txt vs the
        .raw.txt to see what the LLM actually changed.
        """
        main = self.file_path(device_id, session_id, role)
        sidecar = main.with_suffix(".raw.txt")
        await self._hass.async_add_executor_job(
            self._sync_write, sidecar, raw_text or "",
        )
        return sidecar

    async def _rewrite(
        self, device_id: str, session_id: str, role: str
    ) -> tuple[Path, int]:
        key = (device_id, session_id, role)
        parts: list[str] = list(self._history.get(key, []))
        partial = self._partial.get(key)
        if partial:
            parts.append(partial)
        content = "\n\n".join(parts)
        path = self.file_path(device_id, session_id, role)
        await self._hass.async_add_executor_job(self._sync_write, path, content)
        return path, len(content)

    @staticmethod
    def _sync_write(path: Path, content: str) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(path.suffix + ".tmp")
        tmp.write_text(content, encoding="utf-8")
        tmp.replace(path)

    def forget_session(self, device_id: str, session_id: str) -> None:
        """Free in-memory state for a session when it ends. File stays."""
        for role in ("user", "assistant"):
            key = (device_id, session_id, role)
            self._history.pop(key, None)
            self._partial.pop(key, None)


def get_transcript_store(hass: HomeAssistant) -> _TranscriptStore:
    """Lazily create and return the per-hass transcript store."""
    bucket = hass.data.setdefault(DOMAIN, {})
    store = bucket.get("transcript_store")
    if store is None:
        store = _TranscriptStore(hass)
        bucket["transcript_store"] = store
    return store


class _RealtimeBridge:
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
        prompt_include_entities: list[str] | None = None,
        prompt_include_persons: list[str] | None = None,
        prompt_addendum: str = "",
        device_id: str | None = None,
        entry_id: str | None = None,
    ) -> None:
        self.hass = hass
        self._device = device_ws
        self._openai_key = openai_key
        self._model = model
        self._voice = voice
        self._instructions_template = instructions
        self._prompt_include_entities = prompt_include_entities or []
        self._prompt_include_persons = prompt_include_persons or []
        self._prompt_addendum = prompt_addendum or ""
        self._device_id = device_id
        self._entry_id = entry_id

        self._openai: any = None
        # audioop.ratecv state, threaded for continuity across chunks.
        self._upsample_state = None
        self._downsample_state = None

        self._session_started = 0.0
        self._last_audio_in = 0.0
        self._last_speech_activity: float | None = None
        # True between OpenAI's speech_started and speech_stopped events —
        # i.e. while the user is mid-utterance. The idle-timeout watchdog
        # skips while this is set, so users can take as long as semantic
        # VAD allows to finish a sentence without our own bridge cutting
        # them off after 5 seconds.
        self._user_speaking = False
        self._bytes_in = 0
        self._bytes_out = 0
        # Realtime audio pacer for the device. OpenAI's audio.delta arrives
        # 5-10× faster than realtime (the model pre-generates); without
        # throttling we overflow the device's 32-chunk inbound queue and
        # the speaker plays out-of-order chunks → garbled audio. This is
        # the standard server-side leaky-bucket pattern for streaming to
        # constrained downstream clients.
        # 1.0s of lookahead is enough to mask normal WiFi jitter without
        # overfilling the device's inbound queue when OpenAI sends many
        # small chunks. We previously ran at 2.0s and the device queue
        # capped out (96-chunk MAX_INBOUND_CHUNKS) → eviction-on-overflow
        # dropped front-of-queue chunks just before playback → noise on
        # long responses. With device cap restored to 96 and lookahead at
        # 1.0s, both margins compound safely.
        self._audio_pacer = _PacedAudioSender(
            sample_rate=REALTIME_SAMPLE_RATE,
            bytes_per_sample=AUDIO_FORMAT_BYTES_PER_SAMPLE,
            lookahead_s=1.0,
        )
        # Echo gate: drop mic chunks that look like the model's own
        # speech bleeding back through the speaker. See _EchoGate. Fed
        # from audio.delta (speaker side), consulted in _device_to_openai
        # (mic side). Imperfect but cheap; preserves voice-based barge-in
        # which a hard half-duplex gate would lose.
        self._echo_gate = _EchoGate()
        # Counter for periodic stats logging.
        self._echo_log_counter = 0

        # Stable per-session ID surfaced on transcript bus events so the
        # Tauri app can group user+assistant turns belonging to the same
        # conversation. Generated locally; we don't wait for OpenAI's
        # session.created since the first user transcript could conceivably
        # arrive before our event handler reads the session.created field.
        import secrets as _secrets
        self._session_id = _secrets.token_hex(8)

        # Streaming-transcript accumulators. Each delta from OpenAI is
        # appended; reset on .completed/.done so the next turn starts at
        # empty. Full file written to disk via the transcript store.
        self._user_partial: str = ""
        self._asst_partial: str = ""
        self._transcript_store = get_transcript_store(self.hass)

        # HA LLM API + tool catalog (populated lazily from _ensure_llm_api).
        self._llm_api: llm.APIInstance | None = None
        self._tool_specs: list[dict] = []

    async def _on_transcript_delta(
        self, *, role: str, delta: str, current_turn: str
    ) -> None:
        """Write current turn to file + fire live delta event + dispatch sensor update."""
        path, char_count = await self._transcript_store.write_partial(
            self._device_id, self._session_id, role, current_turn,
        )
        # current_turn carries the in-progress turn's full text — what the
        # Tauri streaming display needs for the "replace body text" pattern.
        # char_count is the cumulative file size (includes earlier turns).
        self.hass.bus.async_fire(
            EVENT_TRANSCRIPT_DELTA,
            {
                "device_id": self._device_id,
                "role": role,
                "session_id": self._session_id,
                "delta": delta,
                "current_turn": current_turn,
                "char_count": char_count,
            },
        )
        async_dispatcher_send(
            self.hass,
            SIGNAL_TRANSCRIPT_UPDATED,
            self._device_id, role, str(path), "streaming",
            self._session_id, char_count,
        )

    async def _on_transcript_complete(self, *, role: str, final: str) -> None:
        """Promote in-progress turn to history + finalize file + dispatch."""
        path, char_count = await self._transcript_store.write_complete(
            self._device_id, self._session_id, role, final,
        )
        async_dispatcher_send(
            self.hass,
            SIGNAL_TRANSCRIPT_UPDATED,
            self._device_id, role, str(path), "complete",
            self._session_id, char_count,
        )

    async def run(self) -> None:
        # IMPORTANT: do NOT open OpenAI here. Wait until the device sends its
        # first audio chunk. If a device connects but never speaks, we never
        # touch OpenAI = zero cost. _device_to_openai opens lazily.
        await self._send_device({"type": "ready"})
        self._session_started = time.monotonic()
        self._last_audio_in = self._session_started
        self.hass.bus.async_fire(
            EVENT_REALTIME_SESSION_STARTED,
            {"device_id": self._device_id, "session_id": self._session_id},
        )

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
            self.hass.bus.async_fire(
                EVENT_REALTIME_SESSION_ENDED,
                {
                    "device_id": self._device_id,
                    "session_id": self._session_id,
                    "duration_s": duration,
                    "bytes_in": self._bytes_in,
                    "bytes_out": self._bytes_out,
                },
            )

    async def _watchdog(self) -> None:
        """Force-close on hard max or true idle (no OpenAI engagement).

        Cost safety: OpenAI Realtime bills per audio-minute. The watchdog must
        actually fire when the user stops talking, even though the device's
        always-on mic keeps streaming bytes to us. We use _last_speech_activity
        (updated only on OpenAI events like speech_started/stopped/done) as
        the idle metric, NOT _last_audio_in.
        """
        while True:
            await asyncio.sleep(1.0)
            now = time.monotonic()
            if now - self._session_started > SESSION_HARD_MAX_S:
                _LOGGER.warning(
                    "voix WS: hitting hard max %.0fs; closing", SESSION_HARD_MAX_S
                )
                return
            # While the user is mid-utterance (speech_started fired, no
            # speech_stopped yet), don't apply the idle timeout — semantic
            # VAD decides when they're done, not our clock. Otherwise a long
            # sentence past the 5 s threshold gets murdered mid-word.
            if self._user_speaking:
                continue
            idle_timeout = self._idle_timeout()
            # If we've seen real OpenAI engagement, close when it's gone quiet.
            if self._last_speech_activity is not None:
                quiet_for = now - self._last_speech_activity
                if quiet_for > idle_timeout:
                    _LOGGER.info(
                        "voix WS: no OpenAI activity for %.1fs > %.1fs; closing",
                        quiet_for, idle_timeout,
                    )
                    return
            else:
                # No speech detected yet at all. Give the user a window from
                # session_start to actually say something, then close.
                since_start = now - self._session_started
                if since_start > idle_timeout:
                    _LOGGER.info(
                        "voix WS: no speech in first %.1fs; closing", since_start
                    )
                    return

    def _idle_timeout(self) -> float:
        """Resolve the idle close timeout for this session, live from options."""
        entry = (
            self.hass.config_entries.async_get_entry(self._entry_id)
            if self._entry_id else None
        )
        if entry is not None:
            val = entry.options.get(CONF_IDLE_TIMEOUT_S)
            if val is not None:
                try:
                    return max(1.0, float(val))
                except (TypeError, ValueError):
                    pass
        return DEFAULT_IDLE_TIMEOUT_S

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
        # Render instructions through HA's Jinja so users can include things
        # like `{{ states('light.kitchen') }}` or `{{ now() }}` in the prompt.
        # Falls back to the raw string if rendering fails.
        rendered_instructions = await self._render_instructions()

        # Pull HA's exposed-tool catalog (Assist LLM API) and translate each
        # to OpenAI Realtime function-tool format. The voluptuous schema for
        # each tool's parameters becomes a JSON schema via voluptuous_openapi.
        await self._ensure_llm_api()

        # The model is also pinned via the WS query string; setting it on
        # the session body is the documented current form for the GA API.
        # `output_modalities` replaces the legacy `modalities` array — we
        # want audio out, transcript-only is handled by _DictationBridge.
        session_body = {
            "type": "realtime",
            "model": self._model,
            "output_modalities": ["audio"],
            "instructions": rendered_instructions,
            "audio": {
                "input": {
                    "format": {"type": "audio/pcm", "rate": REALTIME_SAMPLE_RATE},
                    # Semantic VAD waits for the model to decide the user
                    # has actually finished an utterance, instead of a fixed
                    # silence threshold. "low" eagerness gives the assistant
                    # more space to finish — important because the device's
                    # built-in AEC isn't perfect and residual speaker echo
                    # would otherwise trip the VAD mid-response.
                    # `interrupt_response: false` is the belt to the AEC's
                    # braces: even if VAD does fire on echo, we tell OpenAI
                    # not to cancel the in-flight response. Honest user
                    # interruptions still work — they just have to wait for
                    # the model to finish a sentence (acceptable tradeoff;
                    # without this, echo cuts the model off mid-word every
                    # single time).
                    "turn_detection": {
                        "type": "semantic_vad",
                        "eagerness": "low",
                        "interrupt_response": False,
                    },
                    # Run user audio through ASR alongside the realtime model
                    # so we get text transcripts of what the USER said. The
                    # Tauri companion app subscribes to the resulting bus
                    # events to keep a full-conversation transcript.
                    "transcription": {
                        "model": "gpt-4o-mini-transcribe",
                        "language": "en",
                    },
                },
                "output": {
                    "format": {"type": "audio/pcm", "rate": REALTIME_SAMPLE_RATE},
                    "voice": self._voice,
                },
            },
        }
        if self._tool_specs:
            session_body["tools"] = self._tool_specs
            session_body["tool_choice"] = "auto"

        await self._openai.send(
            json.dumps({"type": "session.update", "session": session_body})
        )
        _LOGGER.warning(
            "voix WS: OpenAI Realtime session opened (model=%s, %d tools) — session.update sent",
            self._model, len(self._tool_specs),
        )

    async def _render_instructions(self) -> str:
        """Assemble the final system prompt for OpenAI.

        Layers, in order:
          1. HA's auto-generated tool prompt (api.api_prompt) — describes
             every tool/entity the LLM has access to. Built by HA itself.
          2. The user's "always-include" context — selected entities'
             current states + a freeform addendum (from entry options).
          3. The mode's prompt (Jinja-rendered).

        Falls back gracefully at every layer: missing api → just user prompt;
        Jinja error → raw text; missing entities → skipped lines.
        """

        parts: list[str] = []

        # 1. HA tool prompt — describes available actions/entities.
        if self._llm_api is not None:
            api_prompt = getattr(self._llm_api, "api_prompt", None)
            if api_prompt:
                parts.append(str(api_prompt))

        # 2. voix tool-usage hint — tells the model when to call
        # voix_end_session. Only injected when our builtin tools are
        # actually exposed (i.e. there's a self._llm_api OR we set the
        # builtins unconditionally as we now do).
        if self._tool_specs:
            voix_names = {VOIX_TOOL_END_SESSION}
            if any(t.get("name") in voix_names for t in self._tool_specs):
                parts.append(VOIX_TOOL_PROMPT_HINT)

        # 3. Always-include user context (configured entities + addendum).
        extras_block = self._build_prompt_extras_block()
        if extras_block:
            parts.append(extras_block)

        # 4. Mode-specific prompt, optionally Jinja-rendered.
        raw = self._instructions_template or ""
        if raw.strip():
            if "{{" in raw or "{%" in raw:
                try:
                    raw = Template(raw, self.hass).async_render(parse_result=False)
                except Exception as e:  # noqa: BLE001
                    _LOGGER.warning("voix: prompt template render failed: %s", e)
            parts.append(raw)

        if not parts:
            return DEFAULT_REALTIME_INSTRUCTIONS
        return "\n\n".join(parts)

    def _build_prompt_extras_block(self) -> str:
        """Render always-on context for the realtime model.

        Three layers, always emitted (even with an empty mode catalog):
          1. Areas — every area registered in HA. So "turn on the
             kitchen lights" has a chance even before the model sees a
             single light entity, and the model can correlate "I'm in
             the office" with a place.
          2. People — every `person.*` entity with current home/away
             state. Lets the model speak to who's around.
          3. Per-mode include_entities (specific states the user pinned
             for this mode) + addendum (free-form mode-scoped rules).

        Auto-include happens regardless of mode config; the mode-scoped
        lists are *additive*, not opt-in for the area/person stuff.
        """
        sections: list[str] = []

        area_section = self._render_areas_section()
        if area_section:
            sections.append(area_section)

        people_section = self._render_people_section()
        if people_section:
            sections.append(people_section)

        # Per-mode extras: specific entity states the user pinned.
        mode_lines: list[str] = []
        for eid in self._prompt_include_entities:
            st = self.hass.states.get(eid)
            if st is None:
                continue
            friendly = st.attributes.get("friendly_name") or eid
            mode_lines.append(f"- {friendly} ({eid}) = {st.state}")
        # Honour explicit include_persons too (advanced users — order,
        # nicknames). Auto-people above already covers the common case.
        for eid in self._prompt_include_persons:
            st = self.hass.states.get(eid)
            if st is None:
                continue
            friendly = st.attributes.get("friendly_name") or eid.split(".", 1)[-1]
            mode_lines.append(f"- {friendly} is {st.state}")
        if mode_lines:
            sections.append(
                "Context the user always wants you to be aware of:\n"
                + "\n".join(mode_lines)
            )

        if self._prompt_addendum:
            sections.append(self._prompt_addendum)

        return "\n\n".join(sections)

    def _render_areas_section(self) -> str:
        """List every HA area name. Auto-included in every realtime prompt."""
        try:
            from homeassistant.helpers import area_registry as ar
            reg = ar.async_get(self.hass)
            names = sorted(a.name for a in reg.async_list_areas() if a.name)
        except Exception:  # noqa: BLE001
            return ""
        if not names:
            return ""
        return "Areas in this home: " + ", ".join(names) + "."

    def _render_people_section(self) -> str:
        """List every person.* entity with home/away state."""
        people = [
            st for st in self.hass.states.async_all("person")
            if st and st.state
        ]
        if not people:
            return ""
        lines = []
        for st in sorted(people, key=lambda s: s.entity_id):
            name = st.attributes.get("friendly_name") or st.entity_id.split(".", 1)[-1]
            lines.append(f"- {name} is {st.state}")
        return "People in this household:\n" + "\n".join(lines)

    async def _ensure_llm_api(self) -> None:
        """Fetch HA's Assist LLM API + translate its tools to OpenAI format.

        The `assist` LLM API exposes HA's exposed-entities/intents as tools
        — turn on lights, get state, run scripts, etc. — gated by what the
        user has 'exposed to Assist'. We also append voix's own builtin
        tools (e.g. end_session) so the model can manage its own session.
        """
        # Always expose voix-builtins, even if the HA LLM API lookup fails.
        self._tool_specs = list(VOIX_BUILTIN_TOOL_SPECS)
        try:
            llm_context = llm.LLMContext(
                platform=DOMAIN,
                context=Context(),
                language="en",
                assistant="conversation",
                device_id=self._device_id,
            )
            self._llm_api = await llm.async_get_api(self.hass, "assist", llm_context)
        except Exception as e:  # noqa: BLE001
            _LOGGER.warning("voix: could not get Assist LLM API: %s", e)
            return

        ha_specs: list[dict] = []
        for tool in self._llm_api.tools:
            try:
                params = _voluptuous_to_openapi(tool.parameters) or {"type": "object"}
            except Exception as e:  # noqa: BLE001
                _LOGGER.debug("voix: skipping tool %s (schema convert failed: %s)",
                              tool.name, e)
                continue
            ha_specs.append({
                "type": "function",
                "name": tool.name,
                "description": tool.description or "",
                "parameters": params,
            })
        # voix builtins + HA LLM tools.
        self._tool_specs = list(VOIX_BUILTIN_TOOL_SPECS) + ha_specs
        _LOGGER.info(
            "voix: %d tools exposed to OpenAI (%d voix-builtin + %d HA LLM)",
            len(self._tool_specs), len(VOIX_BUILTIN_TOOL_SPECS), len(ha_specs),
        )

    async def _handle_tool_call(self, name: str, call_id: str, args_json: str) -> None:
        """Dispatch a function call from OpenAI.

        voix-builtin tools (name prefix `voix_`) are handled inline — they
        control session lifecycle, not HA state. HA LLM tools route through
        the AssistAPI's async_call_tool.
        """
        # voix builtins ---------------------------------------------------
        if name == VOIX_TOOL_END_SESSION:
            _LOGGER.info("voix: model called end_session for device %s", self._device_id)
            # Acknowledge the call so OpenAI's conversation state is clean,
            # then close our side. The model already spoke its goodbye line
            # via audio.delta before deciding to call this; we don't issue
            # a follow-up response.create.
            try:
                await self._openai.send(json.dumps({
                    "type": "conversation.item.create",
                    "item": {
                        "type": "function_call_output",
                        "call_id": call_id,
                        "output": json.dumps({"status": "closing"}),
                    },
                }))
                await self._openai.close()
            except Exception:  # noqa: BLE001
                pass
            return

        # HA LLM tools ----------------------------------------------------
        if self._llm_api is None:
            return
        try:
            args = json.loads(args_json) if args_json else {}
        except json.JSONDecodeError:
            args = {}
        result_text: str
        try:
            tool_input = llm.ToolInput(tool_name=name, tool_args=args)
            result = await self._llm_api.async_call_tool(tool_input)
            result_text = json.dumps(result) if not isinstance(result, str) else result
        except Exception as e:  # noqa: BLE001
            _LOGGER.warning("voix: tool %s failed: %s", name, e)
            result_text = json.dumps({"error": str(e)})
        # Push the result back to OpenAI and ask it to continue.
        await self._openai.send(json.dumps({
            "type": "conversation.item.create",
            "item": {
                "type": "function_call_output",
                "call_id": call_id,
                "output": result_text,
            },
        }))
        await self._openai.send(json.dumps({"type": "response.create"}))

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
                # Echo gate: when the model is currently producing
                # speaker output, drop mic chunks whose energy is
                # consistent with the residual echo. See _EchoGate.
                forward, mic_rms, peak_ref_rms = self._echo_gate.should_forward(
                    pcm16k
                )
                self._echo_log_counter += 1
                # Log every ~50 chunks (~1 s at 20 ms chunks) so we can
                # tune ECHO_PATH_GAIN / INTERRUPT_THRESHOLD against real
                # acoustic behaviour without spamming.
                if self._echo_log_counter % 50 == 0:
                    _LOGGER.warning(
                        "voix WS: mic gate forward=%s mic_rms=%d peak_ref=%d threshold=%d (%s)",
                        forward,
                        mic_rms,
                        peak_ref_rms,
                        int(peak_ref_rms * _EchoGate.ECHO_PATH_GAIN * _EchoGate.INTERRUPT_THRESHOLD),
                        self._echo_gate.stats(),
                    )
                if not forward:
                    continue
                pcm24k, self._upsample_state = audioop.ratecv(
                    pcm16k,
                    AUDIO_FORMAT_BYTES_PER_SAMPLE,
                    1,
                    SATELLITE_SAMPLE_RATE,
                    REALTIME_SAMPLE_RATE,
                    self._upsample_state,
                )
                if not first_append_logged:
                    head_hex = " ".join(f"{b:02x}" for b in pcm16k[:32])
                    _LOGGER.warning(
                        "voix WS: forwarding first input_audio_buffer.append "
                        "(in=%d bytes 16k → out=%d bytes 24k, head=%s)",
                        len(pcm16k), len(pcm24k), head_hex,
                    )
                    first_append_logged = True
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

            # Mark the session as "engaged" whenever OpenAI tells us it heard
            # speech or is producing a response. Pure mic bytes flowing from
            # the device don't count — only real interaction does. This is
            # what _watchdog uses to detect idle.
            if t in (
                "input_audio_buffer.speech_started",
                "input_audio_buffer.speech_stopped",
                "input_audio_buffer.committed",
                "response.created",
                "response.done",
            ) or t.endswith("audio.delta"):
                self._last_speech_activity = time.monotonic()

            # Forward user-speech detection to the device so its LED can
            # show a "listening to user" animation. The firmware sniffs the
            # well-known message types in on_ws_text_from_isr and fires the
            # matching trigger.
            if t == "input_audio_buffer.speech_started":
                self._user_speaking = True
                await self._send_device({"type": "user_speech_start"})
            elif t == "input_audio_buffer.speech_stopped":
                self._user_speaking = False
                await self._send_device({"type": "user_speech_end"})

            # Surface anything we haven't seen before, plus error/session
            # events. audio.delta is high-frequency so we count instead.
            if not t.endswith("audio.delta") and not t.endswith("audio_transcript.delta"):
                # Trim large fields before logging.
                preview = {k: v for k, v in msg.items() if k not in ("audio", "delta")}
                _LOGGER.warning("voix WS: openai %s %s", t, json.dumps(preview)[:400])

            # Tool call: when the model decides to call a HA tool, OpenAI
            # emits response.output_item.done with item.type=function_call,
            # carrying name/call_id/arguments. Dispatch through HA's LLM
            # API and feed the result back as a function_call_output.
            if t == "response.output_item.done":
                item = msg.get("item") or {}
                if item.get("type") == "function_call":
                    name = item.get("name", "")
                    call_id = item.get("call_id", "")
                    args = item.get("arguments", "")
                    _LOGGER.info("voix: OpenAI tool call %s(%s)", name, args[:200])
                    await self._handle_tool_call(name, call_id, args)

            # Per-turn transcripts: stream deltas to per-device sensors so
            # HA (and the Tauri app, via state_changed) reflects in-progress
            # text the moment OpenAI produces it. The legacy "completed"
            # events still fire on turn end for back-compat / automations.
            if t == "conversation.item.input_audio_transcription.delta":
                delta = msg.get("delta") or ""
                if delta:
                    self._user_partial += delta
                    await self._on_transcript_delta(
                        role="user", delta=delta, current_turn=self._user_partial,
                    )
            elif t == "conversation.item.input_audio_transcription.completed":
                user_text = (msg.get("transcript") or "").strip()
                # Final transcript wins over accumulated deltas (OpenAI may
                # rewrite slightly between streaming and final).
                if user_text:
                    await self._on_transcript_complete(role="user", final=user_text)
                    self.hass.bus.async_fire(
                        EVENT_REALTIME_USER_TRANSCRIPT,
                        {
                            "text": user_text,
                            "device_id": self._device_id,
                            "role": "user",
                            "session_id": self._session_id,
                        },
                    )
                # Reset so the next user turn starts fresh.
                self._user_partial = ""
            elif t == "response.output_audio_transcript.delta":
                delta = msg.get("delta") or ""
                if delta:
                    self._asst_partial += delta
                    await self._on_transcript_delta(
                        role="assistant", delta=delta, current_turn=self._asst_partial,
                    )
            elif t == "response.output_audio_transcript.done":
                asst_text = (msg.get("transcript") or "").strip()
                if asst_text:
                    await self._on_transcript_complete(role="assistant", final=asst_text)
                    self.hass.bus.async_fire(
                        EVENT_REALTIME_ASSISTANT_TRANSCRIPT,
                        {
                            "text": asst_text,
                            "device_id": self._device_id,
                            "role": "assistant",
                            "session_id": self._session_id,
                        },
                    )
                self._asst_partial = ""

            if t.endswith("audio.delta"):
                b64 = msg.get("delta") or msg.get("audio") or ""
                if not b64:
                    continue
                if not speaking:
                    speaking = True
                    _LOGGER.warning("voix WS: first audio.delta — playback starting")
                    await self._send_device({"type": "audio_start"})
                    self._audio_pacer.reset()
                pcm24k = base64.b64decode(b64)
                if pcm24k:
                    # Record this chunk's RMS in the echo gate's window
                    # BEFORE pacing — observation time matters less than
                    # having a non-empty window during model speech.
                    self._echo_gate.observe_speaker(pcm24k)
                    # Paced send — see _PacedAudioSender. Without this, the
                    # device's 32-chunk inbound queue overflowed under
                    # OpenAI's burst-ahead delivery and the speaker played
                    # out-of-order chunks.
                    self._bytes_out += len(pcm24k)
                    await self._audio_pacer.send(self._device, pcm24k)
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


class _DictationBridge:
    """Mode C: stream device audio through a pluggable STT backend.

    Provider-agnostic transport: send 16 kHz PCM mic chunks into the
    backend, consume `STTDelta` / `STTComplete` / `STTError` events,
    relay transcript text + state to HA (transcript file + sensor +
    bus event) and to the device (typing-style feedback + LED phasing).

    The previous version was OpenAI-specific and used the standalone
    transcription session, which doesn't emit text in `*.delta` — only
    on `.completed` — producing a "giant blob at the end" UX. The
    backend abstraction (see `stt/`) routes us through OpenAI's
    realtime session (which DOES stream partials) by default, with
    Deepgram available as a per-mode option.

    Speech-start / speech-stop signals are derived from the event
    stream: first STTDelta of a session → user_speech_start; STTComplete
    → user_speech_end. Cross-backend, no provider-specific VAD events.

    Cost guards: SESSION_HARD_MAX_S as a ceiling, plus an idle close
    if no speech is detected within the entry's idle timeout.
    """

    def __init__(
        self,
        *,
        hass: HomeAssistant,
        device_ws: web.WebSocketResponse,
        backend,  # stt.STTBackend
        device_id: str | None,
        entry_id: str | None = None,
        post_process_prompt: str = "",
        post_process_provider: str = "openai",
        post_process_model: str = "gpt-4o-mini",
        openai_key: str | None = None,
        openrouter_key: str | None = None,
    ) -> None:
        self.hass = hass
        self._device = device_ws
        self._backend = backend
        self._device_id = device_id
        self._entry_id = entry_id

        self._post_process_prompt = (post_process_prompt or "").strip()
        self._post_process_provider = post_process_provider or "openai"
        self._post_process_model = post_process_model or "gpt-4o-mini"
        self._openai_key = openai_key
        self._openrouter_key = openrouter_key

        self._backend_connected = False

        self._session_started = 0.0
        self._last_speech_activity: float | None = None
        self._heard_speech = False
        self._got_transcript = False
        self._bytes_in = 0
        # True between first delta and completion — suppresses the idle
        # watchdog while the user is mid-utterance.
        self._user_speaking = False

        # Running cumulative transcript for the file write + delta event.
        self._partial: str = ""
        self._transcript_store = get_transcript_store(self.hass)
        # Stable per-session id for the Tauri app to correlate live
        # deltas with the EVENT_DICTATION_CAPTURED event at the end.
        import secrets as _secrets
        self._session_id = _secrets.token_hex(8)

    async def run(self) -> None:
        await self._send_device({"type": "ready", "mode": "dictation"})
        self._session_started = time.monotonic()

        device_task = asyncio.create_task(self._device_to_backend(), name="voix-dict-d2b")
        events_task = asyncio.create_task(self._backend_to_device(), name="voix-dict-b2d")
        watchdog_task = asyncio.create_task(self._watchdog(), name="voix-dict-watchdog")
        try:
            done, _ = await asyncio.wait(
                {device_task, events_task, watchdog_task},
                return_when=asyncio.FIRST_COMPLETED,
            )
            for t in done:
                if t.exception():
                    _LOGGER.warning("voix dictation: task ended with %s", t.exception())
        finally:
            for t in (device_task, events_task, watchdog_task):
                if not t.done():
                    t.cancel()
            try:
                await self._backend.close()
            except Exception:  # noqa: BLE001
                pass
            duration = time.monotonic() - self._session_started
            _LOGGER.warning(
                "voix dictation: session closed after %.1fs (in=%dB, heard_speech=%s, transcript=%s)",
                duration, self._bytes_in, self._heard_speech, self._got_transcript,
            )

    def _idle_timeout(self) -> float:
        entry = (
            self.hass.config_entries.async_get_entry(self._entry_id)
            if self._entry_id else None
        )
        if entry is not None:
            val = entry.options.get(CONF_IDLE_TIMEOUT_S)
            if val is not None:
                try:
                    return max(1.0, float(val))
                except (TypeError, ValueError):
                    pass
        return DEFAULT_IDLE_TIMEOUT_S

    async def _watchdog(self) -> None:
        """Idle/hard-max cost guard. Server VAD owns end-of-speech detection;
        this is just a safety net if the WS hangs or no speech ever arrives."""
        # How long to wait for the user to START speaking before declaring
        # the session abandoned. Distinct from idle_timeout (used between
        # turns once speech has been detected): semantic_vad with
        # eagerness: low can take several seconds to deliver the first
        # transcription delta after the user begins talking, and the
        # user themselves may take a beat after the wake word.
        INITIAL_SPEECH_WAIT_S = 20.0
        while True:
            await asyncio.sleep(1.0)
            now = time.monotonic()
            if now - self._session_started > SESSION_HARD_MAX_S:
                _LOGGER.warning(
                    "voix dictation: hard max %.0fs; closing", SESSION_HARD_MAX_S
                )
                return
            # Same rule as _RealtimeBridge: don't apply the idle timeout
            # while the user is mid-utterance. Semantic VAD with eagerness:
            # low decides when they're done; us cutting them off after 5s
            # is exactly the bug we're fixing.
            if self._user_speaking:
                continue
            if self._last_speech_activity is not None:
                # We've heard speech in this session; use the configured
                # idle timeout for between-turn quiet periods.
                idle_timeout = self._idle_timeout()
                quiet_for = now - self._last_speech_activity
                if quiet_for > idle_timeout:
                    _LOGGER.info(
                        "voix dictation: no OpenAI activity for %.1fs > %.1fs; closing",
                        quiet_for, idle_timeout,
                    )
                    return
            else:
                # No speech yet at all. Use the longer INITIAL_SPEECH_WAIT
                # so the user has time to gather thoughts after waking it.
                since_start = now - self._session_started
                if since_start > INITIAL_SPEECH_WAIT_S:
                    _LOGGER.info(
                        "voix dictation: no speech in first %.1fs; closing",
                        since_start,
                    )
                    return

    async def _ensure_backend(self) -> None:
        if self._backend_connected:
            return
        try:
            await self._backend.connect()
            self._backend_connected = True
        except Exception as e:  # noqa: BLE001
            _LOGGER.warning("voix dictation: backend connect failed: %s", e)
            await self._send_device(
                {"type": "error", "message": f"backend connect: {e}"}
            )
            raise

    async def _device_to_backend(self) -> None:
        """Pump mic audio from the device WS into the STT backend.

        Audio is sent as 16-bit PCM at 16 kHz (the firmware's native mic
        rate). All supported backends accept this format — no resampling.
        The backend is opened lazily on first audio chunk so failed
        connections never cost OpenAI/Deepgram quota when the device
        connects but never speaks.
        """
        async for msg in self._device:
            if msg.type == WSMsgType.BINARY:
                self._bytes_in += len(msg.data)
                if not self._backend_connected:
                    _LOGGER.warning(
                        "voix dictation: first audio chunk (%d bytes); opening backend",
                        len(msg.data),
                    )
                    await self._ensure_backend()
                await self._backend.send_audio(msg.data)
            elif msg.type == WSMsgType.TEXT:
                try:
                    data = json.loads(msg.data)
                except json.JSONDecodeError:
                    continue
                if data.get("type") == "stop":
                    # User force-stop: close the backend so any in-flight
                    # audio gets flushed and the final transcript event
                    # arrives before we tear down.
                    try:
                        await self._backend.close()
                    except Exception:  # noqa: BLE001
                        pass
                    return
            elif msg.type in (WSMsgType.CLOSE, WSMsgType.CLOSED, WSMsgType.ERROR):
                return

    async def _backend_to_device(self) -> None:
        """Consume STT events and route them to the device + HA + file.

        Speech-start / speech-end are derived: first STTDelta of a
        session → start, STTComplete → end. Avoids depending on
        backend-specific VAD events (OpenAI's `input_audio_buffer.*`,
        Deepgram's `SpeechStarted`, etc).
        """
        # Wait briefly for the backend to be connected by the device pump.
        for _ in range(50):
            if self._backend_connected:
                break
            await asyncio.sleep(0.1)
        if not self._backend_connected:
            return

        from .stt import STTComplete, STTDelta, STTError

        async for event in self._backend.events():
            self._last_speech_activity = time.monotonic()
            if isinstance(event, STTDelta):
                # First delta of the utterance — kick the LED into
                # "listening" phase on the device.
                if not self._user_speaking:
                    self._heard_speech = True
                    self._user_speaking = True
                    await self._send_device({"type": "user_speech_start"})
                self._partial = event.accumulated
                await self._send_device(
                    {"type": "transcript_delta", "text": event.delta}
                )
                path, char_count = await self._transcript_store.write_partial(
                    self._device_id, self._session_id, "user", self._partial,
                )
                self.hass.bus.async_fire(
                    EVENT_TRANSCRIPT_DELTA,
                    {
                        "device_id": self._device_id,
                        "role": "user",
                        "session_id": self._session_id,
                        "delta": event.delta,
                        "current_turn": self._partial,
                        "char_count": char_count,
                    },
                )
                async_dispatcher_send(
                    self.hass,
                    SIGNAL_TRANSCRIPT_UPDATED,
                    self._device_id, "user", str(path), "streaming",
                    self._session_id, char_count,
                )

            elif isinstance(event, STTComplete):
                # Flip LED to "thinking" (phase 4) while we finalize.
                if self._user_speaking:
                    self._user_speaking = False
                    await self._send_device({"type": "user_speech_end"})

                raw_transcript = (event.text or "").strip()
                self._got_transcript = True
                if raw_transcript:
                    _LOGGER.info(
                        "voix dictation (%s): captured %d chars",
                        self._device_id, len(raw_transcript),
                    )
                    _LOGGER.debug(
                        "voix dictation (%s): %r",
                        self._device_id, raw_transcript,
                    )

                    # If this mode wants post-processing, run the raw text
                    # through an LLM and use the polished result as the
                    # final transcript. Raw text is preserved on disk as
                    # a .raw.txt sidecar so a bad post-proc prompt can be
                    # debugged without re-recording.
                    transcript = raw_transcript
                    if self._post_process_prompt:
                        await self._send_device({"type": "post_processing"})
                        polished = await self._run_post_process(raw_transcript)
                        if polished and polished != raw_transcript:
                            transcript = polished
                            try:
                                await self._transcript_store.write_raw_sidecar(
                                    self._device_id, self._session_id,
                                    "user", raw_transcript,
                                )
                            except AttributeError:
                                # Older store without sidecar support —
                                # just skip. The polished text still ends
                                # up in the main transcript file below.
                                pass

                    path, char_count = await self._transcript_store.write_complete(
                        self._device_id, self._session_id, "user", transcript,
                    )
                    self.hass.bus.async_fire(
                        EVENT_DICTATION_CAPTURED,
                        {
                            "text": transcript,
                            "raw_text": raw_transcript,
                            "post_processed": (
                                bool(self._post_process_prompt)
                                and transcript != raw_transcript
                            ),
                            "source": "voix-ws",
                            "device_id": self._device_id,
                            "filepath": str(path),
                            "char_count": char_count,
                        },
                    )
                    async_dispatcher_send(
                        self.hass,
                        SIGNAL_TRANSCRIPT_UPDATED,
                        self._device_id, "user", str(path), "complete",
                        self._session_id, char_count,
                    )
                    await self._send_device({"type": "transcript", "text": transcript})
                else:
                    _LOGGER.info("voix dictation: empty transcript")
                # Single-shot: one transcript per wake-word activation.
                return

            elif isinstance(event, STTError):
                _LOGGER.warning("voix dictation: backend error: %s", event.message)
                await self._send_device({"type": "error", "message": event.message})
                if event.fatal:
                    return

    async def _send_device(self, payload: dict) -> None:
        if self._device.closed:
            return
        try:
            await self._device.send_json(payload)
        except Exception:  # noqa: BLE001
            _LOGGER.debug("voix dictation: send to device failed", exc_info=True)

    async def _run_post_process(self, raw_text: str) -> str:
        """Run raw transcript through the mode's post-process LLM.

        Returns polished text on success, raw text on any failure — the
        post_process module's own fallback means this always returns
        something usable. Uses HA's shared aiohttp session so we don't
        spawn a new connector per dictation.
        """
        try:
            from homeassistant.helpers.aiohttp_client import async_get_clientsession
            from .post_process import post_process
            session = async_get_clientsession(self.hass)
            return await post_process(
                raw_text,
                system_prompt=self._post_process_prompt,
                provider=self._post_process_provider,
                model=self._post_process_model,
                openai_key=self._openai_key,
                openrouter_key=self._openrouter_key,
                session=session,
            )
        except Exception as e:  # noqa: BLE001
            _LOGGER.warning(
                "voix dictation: post-process unexpected failure (%s) — "
                "falling back to raw", e,
            )
            return raw_text


def register(hass: HomeAssistant, entry_data: dict, entry_id: str) -> VoixRealtimeView:
    """Register and return the WS view for an entry."""
    view = VoixRealtimeView(hass, entry_data, entry_id)
    hass.http.register_view(view)
    return view
