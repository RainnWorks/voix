# Architecture Decision Records

Each ADR captures a single significant decision: the context that forced it, the choice taken, and what we accepted in return.

| ID | Title | Status |
|---|---|---|
| [0001](0001-hybrid-orchestration.md) | Hybrid orchestration — HA owns most of it | Accepted |
| [0002](0002-no-custom-integration-for-dictation.md) | No custom integration for dictation | Accepted |
| [0003](0003-button-realtime-not-third-wake-word.md) | Realtime mode uses the hardware button, not a third wake word | Accepted |
| [0004](0004-mac-tauri-ws-subscriber.md) | Mac app is a Tauri menu-bar WebSocket subscriber | Accepted |

## Format

```
# NNNN — Short title

## Status
Accepted | Proposed | Superseded by NNNN

## Context
Why this decision needed to be made now.

## Decision
What we're doing.

## Consequences
What we get and what we give up.

## Alternatives considered
Other options and why they lost.
```
