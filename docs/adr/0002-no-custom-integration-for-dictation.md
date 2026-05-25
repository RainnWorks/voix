# 0002 — No custom integration for dictation

## Status
Accepted.

## Context

The original brief assumed dictation needed a custom HA integration: receive audio, call the OpenAI Whisper API, update a sensor. Roughly 300–400 lines of Python.

Research turned up three things that collapse this:

1. **HA's official OpenAI Conversation integration ships an STT subentry** (HA 2026.3+, merged in core PR #162931). It offers two models: `gpt-4o-transcribe` and `gpt-4o-mini-transcribe` (no `whisper-1`). Default is `gpt-4o-mini-transcribe`. Quality scale: bronze. Implementation is non-streaming — the full audio buffer is accumulated before the API call.
2. **HA 2025.10+ supports binding two wake words to two pipelines on a single Assist satellite.** The blog announcing this feature names "Assist satellite" generically; we expect Voice PE to qualify (it's the reference Assist satellite), but if the UI path isn't present we fall back to YAML routing.
3. **ESPHome's `voice_assistant` component fires `on_stt_end`** with the transcript exposed as variable `x`. The Voice PE upstream YAML (`min_version: 2026.5.0`) declares `voice_assistant:` at top level with `id: va` and does not currently set `on_stt_end` — so adding it via the package merge is additive, not destructive.

## Decision

Mode C is built from stock parts:

- A second Assist pipeline named `Dictation`, with STT set to the OpenAI Conversation STT entity. Intent and TTS stages disabled — STT only.
- A second wake word on the Voice PE bound to the `Dictation` pipeline via HA's UI.
- An `input_text.dictation_buffer` helper.
- An `on_stt_end` automation in the Voice PE YAML calling `input_text.set_value` with the transcript.
- The Mac Tauri app subscribes via HA WebSocket to `state_changed` for `input_text.dictation_buffer`.

Total new Python: zero. Total new ESPHome YAML: ~6 lines added via `!extend` on top of the stock Voice PE config.

## Consequences

- Mode C is in scope for Phase 2 with the Mac app being the only meaningful build.
- We inherit HA's release cadence for the STT plumbing. If the official integration regresses, we have no fallback layer.
- We depend on two HA version floors: **2025.10+** for two wake words per satellite, **2026.3+** for the OpenAI STT subentry. Today (2026-05-25) both are available.
- The HA OpenAI Conversation integration controls model choice and feature surface. If we ever need a model it doesn't expose (e.g. a future Whisper variant, or a streaming engine), we swap to `wyoming-openai` (containerised proxy) or write our own STT provider. The rest of the architecture is unchanged.
- Non-streaming STT means perceived latency is "stop talking → 1–3 s → text appears" for short utterances, longer for paragraph-length input. Acceptable for clipboard dictation; would be a problem for long-form writing.

## Alternatives considered

- **Custom HA integration calling Whisper directly.** Rejected — duplicates what HA now ships.
- **`wyoming-openai` proxy container.** Kept as a fallback if the native HA STT subentry is missing or too constrained. Same end shape, more moving parts (one extra container).
- **STT on the Mac (Apple Speech framework).** Rejected — would require shipping audio to the Mac, breaking the "satellite doesn't know about the Mac" property and complicating the trust model.
