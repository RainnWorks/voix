# Setup — Dictation to clipboard (Mode C)

Phase 2. Requires Phase 1 ([setup-ha-assist.md](setup-ha-assist.md)) complete.

## Goal

Saying `Hey Jarvis, this is a test` writes "this is a test" to the Mac's clipboard and shows a notification on the Mac.

## Prerequisites

- **Home Assistant 2026.3 or newer** — required for the OpenAI Conversation STT subentry.
- **Home Assistant 2025.10 or newer** — required for binding two wake words to two pipelines on an Assist satellite. (2026.3+ subsumes this.)
- **Voice PE firmware** built from upstream `home-assistant-voice.yaml` ≥ 2026.5.0 (the upstream `min_version`).
- An OpenAI API key.

Fallback if the native STT subentry isn't available on your HA install: deploy [`roryeckel/wyoming_openai`](https://github.com/roryeckel/wyoming_openai) as a container exposing OpenAI as a Wyoming STT engine, and select it as the Dictation pipeline's STT in step 2.

## Steps

### 1. Add the OpenAI STT engine to HA

**Settings → Devices & services → Add integration → OpenAI Conversation.**

If the integration is already installed, open it and add a new **STT** subentry.

- **Model:** the dropdown offers `gpt-4o-transcribe` and `gpt-4o-mini-transcribe`. `whisper-1` is not offered. Default: `gpt-4o-mini-transcribe` — recommended for short dictation (lower cost, fast enough). Upgrade to `gpt-4o-transcribe` if accuracy on long or specialised vocabulary matters.
- **API key:** from your OpenAI dashboard. Stored in HA's encrypted config.
- **Language:** `en` (or one of the ~57 supported BCP-47 codes; HA passes the two-letter prefix to OpenAI).

After saving, an STT entity (e.g. `stt.openai_transcription` — exact entity ID depends on the integration version) appears.

### 2. Create the Dictation pipeline

**Settings → Voice assistants → Add assistant.**

- Name: `Dictation`.
- **Conversation agent:** None / no-op (we don't want intent recognition or LLM follow-up).
- **Speech-to-text:** the OpenAI STT entity from step 1.
- **Text-to-speech:** None (we don't want spoken feedback).
- **Wake word:** leave to default; we'll bind on the device side.

### 3. Create the `input_text` helper

**Settings → Devices & services → Helpers → Create helper → Text.**

- Name: `Dictation buffer`.
- Entity ID: `input_text.dictation_buffer`.
- Min length: 0. Max length: 255 (raise if you expect long dictations — the helper has a hard cap; consider `input_text` or an alternative like a `template sensor` if 255 is too short).

### 4. Bind the second wake word to the Dictation pipeline

The expected UI lives under **Settings → Devices & services → ESPHome → Voice PE → Voice assistant section**, or **Settings → Voice assistants → device tab.** Exact label and location vary across HA versions.

- Add a second wake word (`Hey Jarvis` or one of the available microWakeWord models).
- Assign it to the **Dictation** pipeline.

If your HA version exposes the wake-word slot but not per-slot pipeline assignment, the alternative is to configure the wake words and pipeline binding via the ESPHome YAML override in [`esphome/voice-pe.yaml`](../esphome/voice-pe.yaml) — Voice PE accepts pipeline routing as ESPHome substitutions on recent firmware.

### 5. Apply the ESPHome `on_stt_end` override

Our [esphome/voice-pe.yaml](../esphome/voice-pe.yaml) extends the stock Voice PE config to write the transcript into `input_text.dictation_buffer`. Install it via the HA ESPHome dashboard (or by adopting the device into ESPHome and pointing it at this YAML).

### 6. Create a Mac access token

In HA, your user profile → **Security → Long-lived access tokens → Create token.**

- Name: `voix-mac`.
- Copy the token. You'll only see it once.

### 7. Build and run the Mac app

```bash
cd mac-app
pnpm install
pnpm tauri dev
```

On first launch, the app prompts for the HA URL (e.g. `http://homeassistant.local:8123`) and the long-lived access token. Both are stored in the macOS Keychain.

### 8. Test

Say `Hey Jarvis, the quick brown fox jumps over the lazy dog.`

Expected:

- LED ring shows pipeline state.
- The Mac receives a notification with the transcript.
- The Mac clipboard contains the transcript.
- The menu-bar app's history shows the entry.

## Acceptance criteria for Phase 2

- [ ] OpenAI STT entity exists in HA.
- [ ] Dictation pipeline runs end-to-end on `Hey Jarvis`.
- [ ] `input_text.dictation_buffer` updates when STT completes.
- [ ] Mac app receives `state_changed`, writes clipboard, notifies.

## Next

→ [setup-realtime.md](setup-realtime.md) (Phase 3 — Mode B).
