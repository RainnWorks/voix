# Setup — OpenAI Realtime conversation (Mode B)

Phase 3 — **not yet implemented.** This page is a placeholder so the path is clear.

## Goal

Pressing the Voice PE's hardware button opens a Realtime conversation. The user speaks, the satellite plays the assistant's response audio through its speaker, and the conversation continues until the user ends it.

## Approach

A custom HA integration (`custom_components/voix`) will:

1. Connect to the Voice PE via `aioesphomeapi` using the noise PSK already configured for the core ESPHome integration.
2. On button press (delivered as a Voice PE event), call `subscribe_voice_assistant` to claim the audio subscription. The core ESPHome integration will lose its claim for the duration of the session.
3. Open a WebSocket to `wss://api.openai.com/v1/realtime`. Stream mic audio one way; receive audio + transcript events the other.
4. Resample audio between the Voice PE's 16 kHz PCM16 and Realtime's 24 kHz PCM16 base64 format.
5. Send the Realtime response audio back to the satellite via `send_voice_assistant_audio`. The stock speaker pipeline plays it.
6. On session end, release the subscription so HA Assist (Mode A) and Dictation (Mode C) resume working.

See [adr/0001-hybrid-orchestration.md](adr/0001-hybrid-orchestration.md) and [adr/0003-button-realtime-not-third-wake-word.md](adr/0003-button-realtime-not-third-wake-word.md) for the architectural commitments.

## Open work items

- Implementation of `custom_components/voix`.
- Resolve subscription-contention handoff with the core ESPHome integration (see [architecture.md](architecture.md) §Open risks).
- Decide on button semantics: tap-on / tap-off, or hold-to-talk.
- Add a budget guardrail (per-day cost cap) before regular use.
- Surface a `switch.voix_realtime_active` for observability.

## LED ring animations

The Voice PE's LED ring already animates on the seven standard voice_assistant phases (idle / waiting / listening / thinking / replying / not-ready / error). Realtime doesn't run through that pipeline, so during a Realtime session the ring sits idle unless we drive it.

Design — firmware owns the animations, the integration nudges the phase:

| Realtime event | Phase id (proposed) | LED behaviour |
|---|---|---|
| `session.created` | 20 | Ring fades up, dim cyan |
| `input_audio_buffer.speech_started` | 20 | Cyan pulse — user speaking |
| `input_audio_buffer.speech_stopped` | 21 | Cyan spinner — model thinking |
| `response.audio.delta` (first frame) | 22 | Warm amber pulse — assistant speaking |
| `response.done` | 23 | Brief white flash, then phase 20 (turn end, awaiting next) |
| WS close / session end | 1 | Fade to idle |

Firmware delta: extend the existing `control_leds` script with cases for phase 20–23, expose a user-defined ESPHome service (`voix_set_realtime_phase`) that writes the `voice_assistant_phase` global.

Integration delta: call the service via `aioesphomeapi.execute_service` on each Realtime event listed above.

Defer until the audio bridge is working end-to-end. Lump the firmware delta in with the wake-word event firing so we don't pay an extra 18-minute compile.

## Reference implementations

Both for study only. Neither is a dependency.

- [`hiddenswitch/homeassistant-realtime-voice-component`](https://github.com/hiddenswitch/homeassistant-realtime-voice-component) — Realtime exposed as STT+TTS providers, so stock Voice PE firmware works unchanged. **Not the path we're taking** (we want the lower-latency `aioesphomeapi` takeover, not the half-duplex Assist-pipeline facade), but the facade pattern is a useful fallback if subscription contention proves intractable. Repo health is weak: 0 stars, solo maintainer, v0.1.0, not HACS-friendly. Study, don't depend.
- [`fjfricke/ha-openai-realtime`](https://github.com/fjfricke/ha-openai-realtime) — Realtime as an HA add-on plus a forked Voice PE firmware with a custom WebSocket transport. Useful for the Pipecat / `RawAudioSerializer` patterns; firmware fork is heavier than we want.

## Implementation notes for the eventual integration

- `aioesphomeapi.APIClient.subscribe_voice_assistant` requires async coroutine callbacks (`handle_start`, `handle_stop`, `handle_audio`, optional `handle_announcement_finished`). Returns an unsubscribe callable.
- `send_voice_assistant_audio(data: bytes)` is the playback path; the Voice PE's stock speaker pipeline renders inbound audio without additional config.
- The Voice PE has `api.encryption:` enabled by default. Our integration must hold the noise PSK; reuse the one already configured for the core ESPHome integration.
- Only one HA-side client at a time can hold the `voice_assistant` subscription. The handoff with the core ESPHome integration is the implementation's hardest problem; see [architecture.md](architecture.md) §Open risks.
