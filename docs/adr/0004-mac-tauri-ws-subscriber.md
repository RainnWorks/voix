# 0004 — Mac app is a Tauri menu-bar WebSocket subscriber

## Status
Accepted.

## Context

Mode C needs a Mac component that reacts to transcript updates and writes them to the clipboard. Constraints:

- Always-on, low idle footprint (it's a tray app, not a foreground tool).
- Single-platform — macOS only.
- One small UI surface: status indicator, last few transcripts, click to re-copy. No window, no preferences pane in v1.
- Must hold a long-lived secret (HA access token) securely.
- Must respond within a couple of seconds of a sensor update.

## Decision

- **Tauri** menu-bar app. Rust backend for the WebSocket client and clipboard writes; web frontend (Svelte or React, picked at Phase 2 kickoff) for the menu UI.
- **Transport:** persistent WebSocket connection to HA's `/api/websocket`. Subscribe to `state_changed` events filtered to the dictation entity client-side.
- **Auth:** HA long-lived access token, scoped to a dedicated `voix-mac` user. Stored in the macOS Keychain via Tauri's `tauri-plugin-stronghold` (or `tauri-plugin-store` with OS keychain backing — TBD at implementation).
- **Clipboard:** Rust `arboard` crate or Tauri's clipboard plugin.
- **Notifications:** Tauri's notification plugin (native `NSUserNotification` / `UNUserNotificationCenter`).

## Consequences

- ~5–15 MB binary, low idle memory — appropriate for always-on.
- Rust binding for WebSocket + clipboard keeps the audio-free critical path tight and offline-resilient.
- No auto-paste, no global hotkey in v1. (Both are possible later; both require Accessibility permissions and are deferred.)
- We commit to the Tauri ecosystem — upgrades require following its release cadence.
- The Mac app has only one HA dependency (`input_text.dictation_buffer`); changing the upstream entity name is a one-file edit.

## Alternatives considered

- **Electron menu-bar app.** Rejected — 10× larger binary, much higher idle memory for the same surface area.
- **Swift native app.** Reasonable for the long run, but slower to ship for a developer comfortable in web tech. Reconsider once the app shape stabilises.
- **Python CLI + LaunchAgent.** Cheapest to build, no UI. Rejected because the menu-bar history list is a stated requirement; CLI is a poor fit.
- **Mac polls HA REST API.** Rejected — laggy, wasteful, and ugly under network blips.
- **HA pushes via webhook to a local Mac HTTP server.** Rejected — Mac would need a stable port reachable from HA, and HA needs to know the Mac's address. WebSocket-out from the Mac is simpler.
