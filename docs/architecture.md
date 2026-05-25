# Architecture

## Goals

- Hands-free dictation that lands directly on the Mac clipboard.
- Stock HA Assist for everyday voice control (lights, scenes, intents).
- Back-and-forth conversations with an LLM agent via OpenAI Realtime, audio in and out through the Voice PE speaker.
- Minimum custom code. Lean on stock HA, stock ESPHome firmware, and the official OpenAI Conversation integration wherever possible.

## High-level flow

```
                                ┌─────────────────────────────────────┐
                                │             Home Assistant          │
                                │                                     │
   ┌──────────────────┐ WW1 ┌──▶│  Assist pipeline (default)          │  Mode A
   │   Voice PE       │     │   │  STT + intents + TTS (stock)        │
   │  (stock firmware)│─────┤   ├─────────────────────────────────────┤
   │                  │     │   │  Assist pipeline (dictation)        │  Mode C
   │  - 2 wake words  │ WW2 └──▶│  STT = openai_conversation           │
   │  - HW button     │         │  (gpt-4o-mini-transcribe)            │
   │                  │         │  on_stt_end ─▶ input_text helper     │
   │  - speaker       │ button  ├─────────────────────────────────────┤
   │  - LED ring      │─────┬──▶│  custom_components/voix              │  Mode B
   │                  │     │   │  aioesphomeapi takeover              │
   │                  │     │   │  ↕ OpenAI Realtime WebSocket         │
   │  ◀─PCM playback──┼─────┘   │  audio back to satellite speaker     │
   └──────────────────┘         └──────────────────┬──────────────────┘
                                                   │ state_changed
                                                   │ (Mode C only)
                                                   ▼
                                     ┌──────────────────────────┐
                                     │   Mac — Tauri menu bar    │
                                     │   HA WebSocket subscriber │
                                     │   Copy to NSPasteboard    │
                                     │   Notification + history  │
                                     └──────────────────────────┘
```

## Mode walkthroughs

### Mode A — HA Assist (stock)

1. User says `Okay Nabu`.
2. Voice PE detects the wake word via on-device microWakeWord.
3. Audio streams to HA over the encrypted ESPHome native API.
4. HA's default Assist pipeline runs: STT → intent recognition → response → TTS.
5. TTS plays back through the satellite speaker. LEDs reflect pipeline state.

No custom code. No Mac involvement.

### Mode B — Realtime conversation

1. User presses the Voice PE's hardware button (briefly to start, again to stop, or hold-to-talk — TBD).
2. The custom `voix` HA integration claims the `voice_assistant` subscription on the Voice PE via `aioesphomeapi`, displacing the core integration's Assist subscription for the duration.
3. PCM audio (16 kHz, 16-bit) flows from the satellite to our integration.
4. The integration opens a WebSocket to `wss://api.openai.com/v1/realtime` (model selected at session-init; confirm the current GA model name at Phase 3 implementation), forwards mic audio (resampled to 24 kHz PCM16 as Realtime expects), and receives audio + transcript events.
5. Realtime's audio response is sent back to the satellite via `send_voice_assistant_audio`. The Voice PE speaker pipeline plays it.
6. On session end, the integration releases the subscription; the core integration resumes ownership for Mode A/C.

This is the only mode that requires custom Python.

### Mode C — Dictation → clipboard

1. User says `Hey Jarvis`.
2. Voice PE detects the second wake word, routes to a separate HA Assist pipeline (`Dictation`).
3. The Dictation pipeline uses the OpenAI Conversation integration's STT engine. HA 2026.3+ exposes `gpt-4o-transcribe` and `gpt-4o-mini-transcribe` as model choices (no `whisper-1`). Default and recommended for short dictation: `gpt-4o-mini-transcribe`. STT is non-streaming — HA buffers the whole utterance before calling the API, adding 1–3 s to perceived latency. Intent and TTS stages are disabled in this pipeline — STT only.
4. ESPHome's `on_stt_end` trigger fires with the transcript as variable `x`. The Voice PE YAML calls `homeassistant.service: input_text.set_value` against `input_text.dictation_buffer` with the transcript.
5. The Mac Tauri app, subscribed to `state_changed` events on `input_text.dictation_buffer`, receives the update, writes to `NSPasteboard`, posts a macOS notification, and prepends the entry to the in-app history list.

No custom HA integration. ~6 lines of ESPHome YAML on top of the stock Voice PE config.

## Components & responsibilities

### Voice PE (stock firmware + thin override)

- Wake-word detection (microWakeWord, two models).
- Hardware button: bound to a custom event consumed by the `voix` HA integration.
- Audio capture and playback (existing `speaker:` pipeline).
- One thin override: `on_stt_end` automation calling `input_text.set_value` for Mode C.

### Home Assistant

- Owns the OpenAI API key (in `secrets.yaml`).
- Runs both Assist pipelines.
- Hosts the `voix` custom integration (Mode B only).
- Exposes `input_text.dictation_buffer` for Mode C.
- Issues a long-lived access token for the Mac.

### Custom integration (`custom_components/voix/`) — Phase 3

- Subscribes to Voice PE's `voice_assistant` channel via `aioesphomeapi`.
- Bridges audio bidirectionally with OpenAI Realtime.
- Coordinates handoff with the core ESPHome integration so Modes A/C still work when Mode B is idle.
- Exposes a `switch.voix_realtime_active` for observability.

### Mac Tauri app — Phase 2

- Holds a persistent WebSocket connection to HA (`/api/websocket`).
- Authenticates with a long-lived access token stored in the macOS Keychain.
- Subscribes to `state_changed` events for `input_text.dictation_buffer`.
- On update: writes to clipboard, posts a notification, prepends to in-app history.
- Menu-bar UI: connection status, last ~10 transcripts, click to re-copy.

## Trust boundaries and secrets

| Secret | Lives in | Never leaves |
|---|---|---|
| OpenAI API key | HA `secrets.yaml` | HA host |
| HA long-lived access token (for Mac) | macOS Keychain (via Tauri secure storage) | Mac |
| ESPHome native-API noise PSK | HA, Voice PE | Local network |
| Transcripts | HA `input_text` entity → Mac clipboard | Per HA's normal handling; not engineered for privacy |

The Mac never has the OpenAI key. The Voice PE never has the HA token. The OpenAI API is the only network destination outside the LAN.

## Open risks

1. **Mode B subscription contention.** Only one HA API client can hold the `voice_assistant` subscription on a given ESPHome device at a time. The core ESPHome integration grabs it on connect. Our integration must coordinate a handoff. Without an upstream toggle, this races on reconnect. Phase 3 work item.
2. **OpenAI Realtime cost.** Per-minute pricing is non-trivial. We should add soft caps before Mode B sees regular use.
3. **HA version drift.** Mode C requires two HA features at different version floors:
    - **HA 2026.3+** for the OpenAI Conversation STT subentry.
    - **HA 2025.10+** for binding two wake words to two pipelines on a single Assist satellite.
    The current Voice PE upstream YAML pins `min_version: 2026.5.0`, which transitively requires a recent HA. If we need to support older HA installations, the fallback is `wyoming-openai` as a container (covers both STT and TTS over the Wyoming protocol).
4. **Non-streaming STT.** HA's OpenAI STT implementation accumulates the full audio buffer before calling OpenAI's transcription API. For multi-sentence dictation this adds a perceptible delay (1–3 s typical, longer for paragraph-length input). If this becomes a UX blocker, switch the STT engine to a streaming alternative; the rest of the architecture is unaffected.
5. **Audio format conversion.** Voice PE outputs 16 kHz PCM16. OpenAI's STT accepts WAV/OGG at 8–48 kHz — fits. OpenAI Realtime expects 24 kHz PCM16 base64 — Mode B's integration will resample.
6. **Button-vs-wake-word UX for Realtime.** Decided: button. To revisit if the button proves awkward (e.g. for hands-busy use). ADR-0003.

## Phasing

| Phase | Deliverable | Custom code? |
|---|---|---|
| 0 | Repo scaffold, ADRs, ESPHome wrapper | None |
| 1 | Voice PE + HA Assist working (Mode A) | None |
| 2 | Dictation → clipboard end-to-end (Mode C): pipeline + helper + ESPHome override + Tauri Mac app | ESPHome ~6 lines, Mac app |
| 3 | OpenAI Realtime conversation (Mode B): `custom_components/voix` integration | Python (~250 LoC) |
| 4 | Polish: history search, hotkeys, HACS publication, observability | Light |
