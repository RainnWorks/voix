# Voix companion app (Tauri)

Receives transcripts from Home Assistant — dictation captures and realtime
turn transcripts from both speakers — pushes them onto the macOS clipboard,
and (optionally) simulates Cmd+V to paste them into the frontmost app.

A standard windowed app, not a tray. Two windows:

- **Main** — settings: HA URL/token, device picker, per-mode behavior, defaults.
- **Live Transcript** — auto-scrolling stream of every captured turn.

## First-time setup

```bash
# 1. Install Rust + Node tooling (Node is already present).
brew install rust

# 2. Install dev deps + run.
cd app
npm install
npm run dev
```

`npm run dev` runs `tauri dev` which compiles the Rust backend and launches
the windowed app. First compile is slow (~3–5 min cold cargo cache); subsequent
runs are seconds.

For a release build:

```bash
npm run build
# → src-tauri/target/release/bundle/macos/Voix.app
# → src-tauri/target/release/bundle/dmg/Voix_0.1.0_aarch64.dmg
```

## Initial configuration

1. Launch the app.
2. In **Home Assistant** section, paste:
   - URL: `http://192.168.96.15:8123` (or whatever your HA is)
   - Token: from HA → Profile → Security → "Create long-lived access token"
   - Click **Save & Reconnect**. The pill in the header should flip to *Connected*.
3. **Devices** — leave empty to listen to every voix device, or tick specific ones.
4. **Modes** — for each mode, decide whether the transcript should be copied
   to the clipboard and/or auto-pasted into the frontmost app.
5. **Defaults** — fallback used when a mode has no explicit override (or when
   a new mode hasn't been seen yet).
6. **Tools → Test paste** — verifies macOS Accessibility permission. If the
   button does nothing, grant the permission below.

## macOS Accessibility (required for auto-paste)

The first time the app posts a Cmd+V keystroke, macOS prompts for
Accessibility permission. If you missed the prompt:

> System Settings → Privacy & Security → Accessibility →
> add **Voix** and toggle on.

Until granted, copy works but paste silently no-ops.

## Adding new realtime modes

The voix HA integration owns the mode catalog. To add a mode:

> HA → Settings → Devices & Services → **voix** → Configure → Modes
>
> → "Create new" → set name, type=Realtime, prompt, voice, model, color.

Then in this app, click **Refresh from HA** under Modes — the new mode
appears in the table and you can flag its copy/paste behavior.

## How HA tells the app about transcripts

Voix fires these events on the HA bus; the app subscribes via the HA
WebSocket API:

| Event                                      | Payload                                                  |
| ------------------------------------------ | -------------------------------------------------------- |
| `voix_dictation_captured`                  | `{ text, device_id, source }`                            |
| `voix_realtime_user_transcript`            | `{ text, device_id, role: "user",      session_id }`     |
| `voix_realtime_assistant_transcript`       | `{ text, device_id, role: "assistant", session_id }`     |
| `voix_realtime_session_started` / `_ended` | `{ device_id, session_id }`                              |

The Rust client maps each to a `voix://transcript` Tauri event consumed by
the live window, after applying the per-mode copy/paste action.

## Where state lives

- Settings: `~/Library/Application Support/co.rowm.voix/voix-settings.json`
- Build artifacts: `app/src-tauri/target/`

Settings are JSON, hand-editable. If you wipe the file the app reverts to
defaults (no HA URL/token, copy=on, paste=off, listen to every device).

## Codebase tour

```
app/
├── package.json               npm scripts (tauri dev / tauri build)
├── src/                       static frontend (no build step)
│   ├── index.html             settings UI
│   ├── live.html              live transcript window
│   ├── style.css
│   ├── settings.js            invokes Rust commands, wires inputs
│   ├── live.js                subscribes to voix://transcript events
│   └── ha.js                  REST helpers (devices, modes)
└── src-tauri/
    ├── Cargo.toml
    ├── tauri.conf.json
    ├── capabilities/default.json
    └── src/
        ├── main.rs            shim → lib.rs::run()
        ├── lib.rs             Tauri setup, plugins, command registration
        ├── settings.rs        persisted settings struct + (de)serializer
        ├── menu.rs            native macOS menu bar
        ├── commands.rs        JS-callable commands
        ├── paste.rs           Cmd+V via enigo (CGEventPost on macOS)
        └── ha_client.rs       HA WebSocket subscriber + per-mode dispatch
```

## Limits / known gaps

- The Rust HA client doesn't yet look up *current mode* of the sending
  device, so per-mode behavior is applied via the user's defaults table
  unless they tick a row in the Modes table. (Picking-by-mode_id works,
  but the current run uses the dictation/realtime default for any device
  whose mode hasn't been pinned in the table.)
- Paste relies on the frontmost app accepting Cmd+V text-input. Apps with
  custom input handling (eg. some terminals in non-default modes) may
  silently swallow it.
- Icon set is placeholder transparent PNGs. Replace `src-tauri/icons/*` with
  real artwork before shipping a notarized build.
