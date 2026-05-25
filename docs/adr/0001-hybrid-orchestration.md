# 0001 — Hybrid orchestration: HA owns most of it

## Status
Accepted.

## Context

The project supports three voice-activated modes. Two architectural extremes were on the table:

- **HA-as-orchestrator everywhere.** Every mode runs through HA's Assist pipeline.
- **Custom-service-as-orchestrator everywhere.** A separate service consumes raw audio from the Voice PE and handles all routing itself, bypassing HA.

Neither extreme fits. HA's Assist pipeline is request/response and half-duplex, which is wrong for OpenAI Realtime's full-duplex stream. But writing custom orchestration for the stock assistant or for dictation duplicates infrastructure that HA already ships.

## Decision

Three-way split:

- **Mode A (HA Assist)** — stock Assist pipeline, no custom code.
- **Mode C (Dictation)** — a second stock Assist pipeline using the HA OpenAI Conversation integration's STT subentry (`gpt-4o-mini-transcribe` by default); ESPHome captures the transcript on `on_stt_end` and writes it to an `input_text` helper. No custom HA integration.
- **Mode B (OpenAI Realtime)** — a custom HA integration (`custom_components/voix`) takes over the Voice PE's audio subscription via `aioesphomeapi` and bridges to the OpenAI Realtime WebSocket. Audio plays back through the satellite's existing speaker pipeline. Custom code lives only here.

The Voice PE never knows the Mac exists. The Mac is a passive WebSocket subscriber to one HA entity.

## Consequences

- One custom integration to maintain instead of an integration plus a glue service.
- Modes A and C cost effectively zero Python code.
- Mode B has to coordinate with HA's core ESPHome integration over the `voice_assistant` subscription — only one client at a time can hold it. This is the project's biggest technical risk; see [architecture.md](../architecture.md) §Open risks.
- HA is the single point of secret storage (OpenAI API key, ESPHome noise PSK).
- If we ever want to run on hardware other than a HA-integrated satellite, this design doesn't help us.

## Alternatives considered

- **All-custom service.** Rejected. Reproduces wake-word routing, Assist intents, TTS, and device management for no gain.
- **Custom integration for all three modes.** Rejected. ~700 lines of Python to replace functionality HA already exposes.
- **HA add-on (Docker) instead of `custom_components/`.** Rejected for now. The integration is small enough that a Python custom component is simpler to install and ship via HACS later.
