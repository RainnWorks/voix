"""Pluggable speech-to-text backends for the voix dictation pipeline.

Why pluggable: OpenAI's standalone transcription session (used for our
dictation bridge) does NOT emit text in `*.delta` events — only the
final transcript on `*.completed`. That gave the "giant blob at the end"
UX. Real streaming transcription requires either OpenAI's *realtime*
session (more expensive, but already part of our stack) or a dedicated
streaming-STT provider like Deepgram or AssemblyAI.

Backends implement the `STTBackend` async-iterator interface: feed PCM
audio chunks in, get `STTEvent`s out. The `_DictationBridge` consumes
events and drives the per-device transcript file + sensors + bus events
exactly as before — the backend swap is transparent to consumers.

Currently registered:
  - "openai-realtime": OpenAI realtime session with output_modalities=[],
    transcription-only. Streams partials via input_audio_transcription.delta
    that DO carry text (unlike the bare transcription-session variant).

Other providers (Deepgram, AssemblyAI, OpenRouter batch) are easy adds
when the streaming-vs-batch trade-off justifies the extra surface area:
streaming-WS providers each need their own direct connection (OpenRouter
proxies HTTP completions only, not voice streams), and batch providers
need our own end-of-speech detection on the HA side. For now we ship the
single backend that gives the best streaming UX with the OpenAI key the
integration already has.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import AsyncIterator, Protocol

# ─── Event types yielded by every backend ────────────────────────────────────


@dataclass
class STTDelta:
    """An incremental piece of transcript. `accumulated` is the full
    current-turn text including this delta — backends that emit absolute
    text on each frame populate it directly; backends that emit only the
    new piece accumulate locally and fill it.
    """
    delta: str
    accumulated: str


@dataclass
class STTComplete:
    """Turn finalised. `text` is the canonical/cleaned final transcript
    (may differ slightly from the accumulated deltas — providers often
    re-format punctuation and casing on completion)."""
    text: str


@dataclass
class STTError:
    """Recoverable or fatal error from the backend. The dictation bridge
    decides whether to tear down based on context."""
    message: str
    fatal: bool = True


STTEvent = STTDelta | STTComplete | STTError


# ─── Backend interface ───────────────────────────────────────────────────────


class STTBackend(Protocol):
    """Streaming speech-to-text backend interface.

    Lifecycle:
        b = make_backend(...)
        await b.connect()
        async for event in b.events():
            ...
        # Concurrently:
        await b.send_audio(pcm_bytes)
        # On end:
        await b.close()

    Audio format is fixed: 16-bit PCM, mono, 16 kHz — matches what the
    Voice PE firmware sends over the WS and what every supported
    provider accepts (with resampling if needed).
    """

    async def connect(self) -> None: ...

    async def send_audio(self, pcm16_bytes: bytes) -> None: ...

    async def close(self) -> None: ...

    def events(self) -> AsyncIterator[STTEvent]: ...


# ─── Provider registry + factory ─────────────────────────────────────────────

# Imports kept lazy inside `make_backend` to avoid circular-import risk
# during integration setup — backends pull in heavy WS libraries.

STT_PROVIDER_OPENAI_REALTIME = "openai-realtime"

# Catalog used by the config-flow mode_form to render the picker. Each
# entry: provider_id → (display_name, default_model).
STT_PROVIDERS: dict[str, tuple[str, str]] = {
    STT_PROVIDER_OPENAI_REALTIME: ("OpenAI Realtime", "gpt-4o-mini-transcribe"),
}

DEFAULT_STT_PROVIDER = STT_PROVIDER_OPENAI_REALTIME

# Models exposed for the openai-realtime backend in the model picker.
# Free-text input on the form so users can also type any other valid
# OpenAI transcription model name not listed here.
OPENAI_TRANSCRIBE_MODELS = [
    "gpt-4o-mini-transcribe",  # cheapest, fast, good streaming UX
    "gpt-4o-transcribe",        # higher accuracy, slightly slower
    "whisper-1",                # legacy fallback
]


def make_backend(
    provider: str,
    *,
    model: str,
    api_keys: dict[str, str],
) -> STTBackend:
    """Construct a backend instance for the given provider id.

    `api_keys` is a dict keyed by provider_id; each backend pulls the
    one it needs. Caller is the integration setup, which sources keys
    from entry.options.
    """
    if provider == STT_PROVIDER_OPENAI_REALTIME:
        from .openai_realtime import OpenAIRealtimeSTT

        key = api_keys.get(STT_PROVIDER_OPENAI_REALTIME) or api_keys.get("openai")
        if not key:
            raise ValueError("OpenAI API key is not configured")
        return OpenAIRealtimeSTT(api_key=key, model=model)
    raise ValueError(f"unknown STT provider: {provider}")
