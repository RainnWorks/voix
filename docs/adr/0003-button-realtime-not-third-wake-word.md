# 0003 — Realtime mode uses the hardware button, not a third wake word

## Status
Accepted.

## Context

The original brief contemplated three wake words on a single Voice PE — one per mode. Two pieces of evidence pushed against this:

1. **microWakeWord scales poorly past two models.** RAM and CPU on the ESP32-S3 are tight; each loaded model degrades wake-word accuracy for the others. The official guidance and community reports both converge on two models as the practical ceiling.
2. **Realtime is a conversation, not a one-shot.** A wake word is the wrong activation pattern for back-and-forth — you'd say it on every turn. Toggle or hold-to-talk fits the interaction model.

The Voice PE has a physical button. It's currently bound to nothing project-specific.

## Decision

- **Wake word 1** (`Okay Nabu`) → Mode A (HA Assist).
- **Wake word 2** (`Hey Jarvis`) → Mode C (Dictation).
- **Hardware button** → Mode B (Realtime). Exact press semantics (tap-to-start/tap-to-stop vs. press-and-hold) deferred to Phase 3 implementation; will be picked after a brief usability test.

## Consequences

- Wake-word load on the Voice PE stays at two models — within accepted limits.
- Realtime gets an activation that matches its conversational nature.
- A physical button isn't accessible across the room. For now, accept it; if it becomes a problem, add a "start Realtime" intent reachable from Mode A's wake word as a backup.
- The button has a single responsibility, which keeps the firmware mental model simple.

## Alternatives considered

- **Three wake words, accept degraded accuracy.** Rejected — accuracy directly affects perceived quality.
- **One wake word, voice-prefix routing** (`Hey Jarvis, dictate…` vs `Hey Jarvis, chat…`). Rejected — adds an intent-parsing step in the critical path and is fragile to phrasing.
- **Button cycles between Realtime and a second secondary mode.** Rejected as needless complexity at this stage. The button does one thing.
- **Companion-app button on a phone instead of the satellite.** Rejected — depends on a phone being out, which negates the always-on appliance premise.
