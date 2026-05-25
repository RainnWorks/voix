# Setup — HA Assist (Mode A)

Phase 1. Stock Home Assistant configuration. No custom code. Validates that the Voice PE works end-to-end before we add anything project-specific.

## Goal

Saying `Okay Nabu, turn off the office light` should turn off the office light and play a TTS confirmation through the Voice PE speaker.

## Steps

### 1. Pick or create a pipeline

**Settings → Voice assistants → Assistants.**

If HA has set up a default pipeline already (HA Cloud subscribers usually do), it's fine to use. Otherwise create one with:

- **Conversation agent:** Home Assistant default (no LLM needed for Mode A).
- **Speech-to-text:** any available — HA Cloud, faster-whisper, or your STT engine of choice.
- **Text-to-speech:** any available — HA Cloud, Piper, or similar.
- **Wake word:** leave to default; wake-word handling lives on the Voice PE in Mode A.

### 2. Assign the pipeline to the Voice PE

**Settings → Devices & services → ESPHome → Voice PE → Voice assistant section.** Set the **Preferred pipeline** to the one you just chose.

### 3. (Optional) Expose entities to Assist

If the Voice PE has never been used with Assist before, expose at least one entity you can test against. **Settings → Voice assistants → Expose → Add entities.**

### 4. Test

Speak `Okay Nabu, turn off the office light`.

Expected:

- LED ring shows the listening state.
- After you stop talking, the ring shows processing, then completes.
- The entity changes state.
- TTS confirmation plays through the satellite speaker.

If any of that fails, fix it before moving on. Phase 2 and 3 inherit this plumbing.

## Acceptance criteria for Phase 1

- [ ] Voice PE is online and discoverable in HA.
- [ ] Pipeline assigned.
- [ ] One full round-trip — wake word, command, state change, TTS — works.
- [ ] LED ring behaviour matches pipeline state.

## Next

→ [setup-dictation.md](setup-dictation.md) (Phase 2 — Mode C).
