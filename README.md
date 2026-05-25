# voix

Voice toolkit built on a Home Assistant Voice PE satellite, orchestrated through Home Assistant, with three distinct activation modes and a tiny Mac listener for the dictation path.

## Modes

| Mode | Activation | Path | Mac involved? |
|---|---|---|---|
| **A — HA Assist** | Wake word: `Okay Nabu` | Voice PE → HA Assist pipeline (stock) | No |
| **B — Realtime conversation** | Hardware button on Voice PE | Voice PE → custom HA integration ↔ OpenAI Realtime API; audio plays back through satellite | No |
| **C — Dictation → clipboard** | Wake word: `Hey Jarvis` | Voice PE → second HA Assist pipeline (OpenAI `gpt-4o-mini-transcribe`) → `input_text` entity → Mac Tauri menu-bar app → clipboard | Yes |

The Voice PE never knows the Mac exists. The Mac is a passive WebSocket subscriber to one HA entity.

## Status

Phase 0 — repository scaffold. No working code yet. See [docs/architecture.md](docs/architecture.md) for the full plan and [docs/adr/](docs/adr/) for decision records.

## Repo layout

```
voix/
├── README.md
├── docs/                 # architecture, setup guides, ADRs
├── esphome/              # Voice PE satellite config (thin wrapper)
├── ha/                   # HA-side helpers, automations, packaging
└── (mac-app/)            # Tauri menu-bar app — created in Phase 2
└── (ha-integration/)     # custom_components/voix — created in Phase 3
```

## Quickstart

1. Read [docs/architecture.md](docs/architecture.md).
2. Phase 1 setup: [docs/setup-voice-pe.md](docs/setup-voice-pe.md) then [docs/setup-ha-assist.md](docs/setup-ha-assist.md).
3. Phase 2 (dictation): [docs/setup-dictation.md](docs/setup-dictation.md).
4. Phase 3 (Realtime): [docs/setup-realtime.md](docs/setup-realtime.md) — placeholder, not yet implemented.

## License

TBD.
