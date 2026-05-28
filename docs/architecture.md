# voix Architecture

This is the post-pivot architecture (May 2026). The earlier "everything
inside a HA custom integration" design is gone; see `docs/adr/` for that
history.

## TL;DR

voix is a **multi-input voice assistant whose brain is a standalone
Bun daemon**. The daemon owns the OpenAI Realtime session, mode
catalog, post-processing, history, and tool-call relay to an MCP
context layer. Inputs (Voice PE puck today, Mac mic tomorrow, iOS
keyboard later) all speak the same WS protocol to the daemon. Outputs
(puck speaker, paste-to-active-app, HA service calls) are pluggable.

The Home Assistant custom integration is now a thin discovery +
onboarding layer. It finds Voice PE pucks via ESPHome's mDNS, pushes
the daemon's URL + auth token to the firmware, and otherwise stays
out of the audio path.

## Why we moved off Home Assistant

The original design ran the WS bridge, STT pipeline, mode dispatch,
and OpenAI Realtime session inside a HA custom component. Every
significant friction we hit traced back to that decision:

| Symptom                                            | Root cause                                                                  |
|----------------------------------------------------|-----------------------------------------------------------------------------|
| Hand-rolled WS client; couldn't use GA Realtime SDK | HA Core pins `openai==2.21.0` (via `openai_conversation`), pre-GA           |
| `_LOGGER.info(...)` invisible                      | HA default log level is WARN                                                |
| Diagnostic context lost                             | `ha core logs` ring buffer is 100 lines                                     |
| Session died on HA restart                          | Custom integrations re-init when HA does; the WS got torn down              |
| Service-registry slugification surprises           | `home-assistant-voice-095e4e` → `home_assistant_voice_095e4e` mid-event     |
| Adoption races                                      | ESPHome service registration order vs voix setup order                      |
| Service tokens awful                                | HA's auth surface treats add-ons and integrations differently               |
| Restart cycle 10–30 s                              | Iterating on bridge code meant restarting the whole HA process              |

Most of these were workarounds that bought a few hours each. The
underlying mismatch — HA is a state-machine orchestrator, not a
realtime audio service — couldn't be papered over. So the brain moved
out. Iteration cycle is now `bun --watch` (sub-second) plus an
auto-pulling `dev_mode` in the HA Add-on (git commit → live in ~5
seconds).

## System diagram

```
┌─ INPUTS ────────────────────┐    ┌─ DAEMON  voix-backend ────────────┐    ┌─ OUTPUTS ─────┐
│                             │    │                                   │    │               │
│ Voice PE puck               │    │ Elysia HTTP/WS  :8765              │    │ Puck speaker  │
│ - wake word                 │ →  │   /ws       puck audio bridge      │ →  │ HA events     │
│ - ESPHome firmware          │    │   /recordings/ playback browser    │    │ Paste target  │
│ - voix_realtime_client      │    │   /healthz                         │    │  (Mac, future) │
│                             │    │                                   │    │ Notify        │
│ Mac mic        (planned)    │    │ Per-puck PuckSession               │    │  (Mac, future) │
│ - global hotkey             │    │   - OpenAI Realtime WS             │    │               │
│ - same WS protocol          │ →  │   - audio resample 16↔24 kHz       │ ←  │ History       │
│                             │    │   - echo gate (residual safety)    │    │  (queryable)   │
│ iOS keyboard   (future)     │    │   - mode-driven session.update     │    └───────────────┘
│ - replaces system kbd       │ →  │   - tool-call relay → context      │
│ - dictation hotkey          │    │                                   │
│                             │    │ Mode catalog        modes.json     │
└─────────────────────────────┘    │ Post-processing     OpenAI/OpenRouter
                                   │ History             history.jsonl   │ ← Context sources ───┐
                                   │ Recordings          /data/voix/...  │                       │
                                   │                                   │   HA MCP        :/api/mcp
                                   │ Context registry                  │   Mac context  (planned)
                                   │   - voix.end_session (built-in)   │   Calendar MCP (future)
                                   │   - ha context source (Streamable │
                                   │     HTTP via Supervisor proxy)    │
                                   └───────────────────────────────────┘

┌─ HA INTEGRATION (thin)──────────────────┐    ┌─ Home Assistant ────────────┐
│ custom_components/voix                  │    │                             │
│ • Discovers Voice PE pucks via ESPHome  │ ←→ │  ESPHome integration         │
│ • Pushes daemon URL + token to firmware │    │  (stock — adopts pucks)      │
│   via api.actions (voix_set_server)      │    │                             │
│ • Mode select / LED color entities      │    │  mcp_server integration      │
│   (state mirror, not orchestration)     │    │  (HA Core 2025.2+)           │
│ • EVENT_MODE_CHANGED → push to puck     │    │                             │
└─────────────────────────────────────────┘    └─────────────────────────────┘

┌─ DESKTOP CLIENT (current: Tauri; direction: React app served by daemon) ─┐
│ Mode editor / history viewer / recordings browser                        │
│ Future: + Mac mic capture + paste-to-active-app + context relay          │
└──────────────────────────────────────────────────────────────────────────┘
```

## Component responsibilities

### `voix-backend/` — the daemon (Bun + Elysia + TypeScript)

- WebSocket server (`/ws`) for puck connections
- Per-session lifecycle (`PuckSession`)
- OpenAI Realtime WS client (official `openai/realtime/ws` SDK)
- Audio resampling (16 ↔ 24 kHz, state-threaded)
- Echo gate (belt-and-braces; the puck does the real half-duplex now)
- Mode catalog: type, prompt, voice, model, post-process spec, routing hint
- Post-processing pipeline (OpenAI + OpenRouter chat completions)
- History store (JSONL)
- Session recorder (per-session mic.wav + speaker.wav + transcripts)
- Recordings playback HTTP browser (`/recordings/`)
- Context source registry:
  - `voix` source: builtin `end_session` tool
  - `ha` source: MCP client over Streamable HTTP at HA's `/api/mcp`
- Tool-call relay (OpenAI function calls → context source → output)
- HA Add-on packaging with `dev_mode` (git auto-pull on commit)

Persistent state lives under `/data/voix/` inside the add-on:

```
modes.json              Mode catalog
history.jsonl           One entry per completed dictation/realtime turn
transcripts/<slug>/...  Plain-text transcripts (cumulative per session)
recordings/<sess>/      mic.wav + speaker.wav + meta.json
voix-dev/               Dev-mode git checkout (when dev_mode=true)
```

### `esphome/components/voix_realtime_client/` — Voice PE firmware

ESPHome external component that:
- Connects to the daemon's WS with `device_id` + shared `ws_token`
- Streams 16 kHz mic PCM in 2 KB batches
- Plays incoming speaker audio at 24 kHz
- **Gates the mic at the source when `speaker_->is_running()` is true** —
  this is the load-bearing fix that prevents the model's own voice
  echoing back through the mic and triggering OpenAI's VAD as fake user
  turns. The Voice PE's XMOS hardware AEC residual at conversational
  volumes is too loud to leave to the daemon's energy gate.
- Edge-detects speaker drain → sends `{"type":"ready_for_input"}` so
  the daemon's idle watchdog resets from the moment the user can
  actually speak again
- Pre-allocates the WS client at boot to dodge the
  "memory exhausted at wake-word" failure caused by SRAM fragmentation
- Persists `server_url` + `ws_token` to NVS so cold boots Just Work

### `ha-integration/custom_components/voix/` — HA discovery + adoption

The shrunk version. Job is:
- Watch for ESPHome services named `<slug>_voix_set_server` to register
- When one appears, call it with `daemon_url` + `ws_token`
- Watch for HA mode-select changes → push to the puck so its LED ring
  matches
- Surface the puck under an HA device entry so users see it in the UI

Adoption flow: the user adds the Voice PE puck via HA's normal ESPHome
discovery + Adopt button. voix piggybacks on that — no second
"connect to voix" step.

### `app/` — Tauri desktop client (transitional)

Mode editor + history viewer + future paste target. **Slated for
significant reshape** — see Roadmap §A below.

## Half-duplex echo handling (lessons learned)

The Voice PE has XMOS hardware AEC in spec, but residual at real
conversational speaker volumes is much louder than the published
~25 dB. Echo at the mic was triggering OpenAI's `semantic_vad` as
"new user turn" → model cancels its own response mid-sentence.

What we tried, in order:

1. **Daemon-side energy gate** (RMS threshold). Worked for some
   volumes, broke at others. Volume-calibrated thresholds don't
   generalise.
2. **Switch XMOS channel from AGC to NS** to avoid AGC re-amplifying
   AEC residual. Worked in theory — confirmed via in-daemon mic RMS
   logging — but NS-stage output is so quiet (mic_rms 55–99 vs
   AGC's 1000s) that OpenAI's STT made constant word-confusion
   errors ("I'm shouting at you" → "ChatGPT, I will show at you").
3. **Daemon-side half-duplex gate** (refs-based time gating). Still
   leaked enough to trigger VAD occasionally.
4. **Puck-side half-duplex on `speaker_->is_running()`** ← winner.
   Mic data is dropped at the firmware's `on_mic_data_` callback
   for as long as the speaker queue is draining. Zero mic chunks
   reach the daemon during model speech. No echo can confuse VAD.

Trade-off: **no barge-in**. Saying "stop" mid-response won't
interrupt. Same trade-off Alexa, Google Home, and HA's own stock
voice assistant make on this hardware class. Worth it.

## Status of major systems

| System                          | State        | Notes                                                        |
|---------------------------------|--------------|--------------------------------------------------------------|
| Daemon scaffold (Bun/Elysia)    | ✓ done       | Listening on :8765, HA Add-on packaged, dev_mode pull works  |
| Puck WS protocol                | ✓ done       | hello + binary mic + control + ready_for_input               |
| OpenAI Realtime via SDK         | ✓ done       | Official `openai/realtime/ws`, GA schema, typed events       |
| Mode catalog                    | ✓ done       | 6 built-ins (Realtime/Dictation/Message/Email/Note/Code)     |
| Post-processing (dictation)     | ✓ done       | OpenAI + OpenRouter providers, falls back to raw on error    |
| History (JSONL)                 | ✓ done       | Append-only, queryable by mode/device                        |
| Recordings (mic/speaker WAV)    | ✓ done       | Browser at `/recordings/`                                    |
| HA MCP context source           | ✓ done       | Streamable HTTP at `/api/mcp`, SUPERVISOR_TOKEN auth         |
| `voix.end_session` builtin tool | ✓ done       | Model can close session cleanly when conversation wraps      |
| Echo handling (puck half-duplex)| ✓ done       | `speaker_->is_running()` gating in firmware                  |
| `ready_for_input` ping          | ✓ done       | Resets daemon idle timer when puck speaker drains            |
| HA Add-on (dev_mode)            | ✓ done       | `https://github.com/RainnWorks/voix` → install via Add-on Store |
| HA integration trim             | ✗ deferred   | Still has all old bridge code as dead weight (~3000 LOC)     |
| Mac context source              | ✗ not started| Focused-app + selected text → relayed to daemon              |
| Mac mic as input source         | ✗ not started| Hotkey + local mic, same WS protocol as puck                 |
| Desktop UI on backend           | ✗ not started| React app served by daemon, see §A                           |
| Auto-routing (dictation modes)  | ✗ not started| Context + mode `routing_hint` → small LLM picks mode         |
| Cost tracking                   | ✗ not started| Per-model `costPerMinute`, aggregated per mode               |
| Multi-puck tool-call routing    | ✗ TODO       | `voix.end_session` closes ALL bound sessions today           |

## Roadmap

### A. Desktop / UI strategy — Tom's main concern

Today the mode editor and history viewer live in a Tauri app
(`app/`). That works but means:

- Two UIs to maintain (Tauri's JS + any future iOS UI)
- Settings only editable on a Mac
- UI strongly coupled to Tauri-specific shims

**Direction**: move every UI concern into a React app served by the
daemon at `/ui/` (or `/`). One codebase. Wrap it in shells per
platform:

```
                         ┌──────────────────────────────┐
                         │  React UI (in voix-backend/) │
                         │  - Modes editor              │
                         │  - History browser           │
                         │  - Recordings playback       │
                         │  - Per-device controls       │
                         │  - Cost view                 │
                         └──────────────┬───────────────┘
                                        │ same bundle, different wrappers
        ┌───────────────────────────────┼───────────────────────────────┐
        ▼                               ▼                               ▼
┌──────────────────┐         ┌──────────────────┐         ┌──────────────────┐
│ Plain web        │         │ Tauri / Electron │         │ iOS app          │
│ http://daemon/ui │         │ + global hotkey  │         │ + keyboard ext.  │
│ (HA Sidebar      │         │ + Mac mic        │         │ + system mic     │
│  iframe, browser │         │ + paste-to-app   │         │ + clipboard      │
│  tab on phone)   │         │ + context (focus │         │   handoff        │
│                  │         │   window, sel.   │         │                  │
│                  │         │   text)          │         │                  │
└──────────────────┘         └──────────────────┘         └──────────────────┘
```

The native shells contribute the things the OS exclusively can: hotkey
registration, local mic capture, paste, focused-app context. They
DON'T duplicate any UI.

**Implementation plan**:

1. Create `voix-backend/ui/` with Vite + React + Treaty (Elysia's
   type-safe RPC) → fully-typed API client without writing OpenAPI
2. Move mode editor screens from `app/src/settings.js` to React
   components
3. Serve the built bundle from Elysia (`Bun.file` or `staticPlugin`)
4. Wrap in Tauri as a thin window pointing at `http://localhost:8765/ui/`
5. Add the Tauri-side modules for hotkey, paste, mic capture, context
6. Decide on the Mac mic source's protocol — most likely the same WS
   `/ws` endpoint with a different `device_id`, so it's just another
   input device from the daemon's perspective

### B. Mac as a mic source

Once the React-on-backend split exists, the Mac native shell can host
a Bun runtime alongside (or `tauri-plugin-bun` etc.) that:

- Registers a global macOS hotkey (Cmd-Space-mod or user-chosen)
- On hotkey: starts local mic capture, sends to the daemon via the
  same `/ws` endpoint, gets transcript back, pastes into the active
  app

This makes the Mac a peer input device alongside the puck. Same mode
catalog, same post-processing, same history. Users get to dictate
from anywhere, not just at the puck.

### C. iOS keyboard replacement (longer-term)

The endgame: an iOS app that replaces the system keyboard, with a mic
button that starts dictation. The Bun daemon either runs:
- on a Mac the iPhone trusts (paired over Bonjour), or
- as a hosted instance the user points at

iOS specifics:
- Keyboard extensions are sandboxed (no network in classic extensions)
- iOS 17+: `RequestsOpenAccess` keyboards can do network
- Same React UI in a "settings within keyboard" sheet

This is the most ambitious bit and a long way off. The architectural
preparation is making sure the daemon's protocol is portable (no
Mac-specific assumptions on the wire) and the UI is shell-agnostic.

### D. Context relay (Supershout pattern)

Currently the daemon sees no client-side context. Once the Mac shell
exists, it should send focused-app metadata + selected text + clipboard
when starting a dictation (per the Supershout `SessionContext` shape).
Daemon weaves this into the post-processing prompt — same way
Supershout already does.

### E. Auto-routing for dictation

With context relay in place, a single hotkey can drive multiple modes
intelligently:
- Press hotkey from Slack → auto-pick `Message` mode
- Press hotkey from Cursor → auto-pick `Code` mode
- Press hotkey from Mail.app → auto-pick `Email` mode

Each mode already has a `routing_hint` field. A small/cheap LLM call
("here's the focused app + selected text — pick a mode") covers the
long tail; for known apps we cache `bundleId → mode_id` so it's free.

### F. Trim the HA integration

The HA custom integration still has all the old bridge code (~3000
LOC). Now that the daemon is the proven path, the integration should
shrink to just:

- ESPHome puck discovery
- Daemon URL + token push via `voix_set_server`
- Mode-changed → push to puck for LED feedback
- Maybe a sensor mirroring last transcript (optional)

Probably ~300 LOC. Should happen once we've confirmed nothing else
relies on the old bridge endpoints.

### G. Cost tracking

Per Supershout: each `ModelInfo` carries `costPerMinute` for voice
models and a token-price estimate for chat models. Aggregate per mode
in history. Surface a "this month's spend by mode" view in the UI.

### H. Multi-puck routing for `voix.end_session`

Currently `VoixContextSource.callTool("end_session")` closes EVERY
bound session. Single-puck households (the common case today) are
fine; multi-puck installs need device-aware dispatch. The OpenAI
Realtime tool-call event doesn't carry caller device context, so we'll
have to thread it through the daemon's tool-call relay.

### I. Stage tuning (firmware AEC)

The XMOS pipeline pieces (`AEC → IC → NS → AGC`) are individually
configurable. We've stuck with AGC channel-0 (upstream default) after
NS-stage produced too-quiet output. Worth a future test: NS at
channel 0 + `gain_factor` boost in the ESPHome microphone source. The
livekit-on-vpe project showed AEC alone produces RMS=4 on a sine-wave
echo test, so there's real signal there if we can get the gain
balanced.

## Iteration loop

For day-to-day work:

```
voix-backend/    edit + push to main             → ~30s to running
                 (dev_mode polls git every 30s; bun --watch picks up changes)

esphome/         scripts/build-local.sh upload   → ~45s compile + OTA
                 (mtime-guarded; cached re-uploads are guarded out)

ha-integration/  scp + ha core restart           → ~60s
                 (HA's `ha core logs` is 100 lines — grep aggressively)
```

For diagnosing audio issues: `http://192.168.96.15:8765/recordings/`
gives mic + speaker WAVs + transcripts side-by-side per session. That
beats reading RMS numbers in logs every time.

## See also

- `docs/STATE.md` — current installation status / what's deployed where
- `docs/setup-*.md` — per-mode setup guides
- `docs/adr/` — architecture decisions (pre-pivot history lives here)
- `CLAUDE.md` — operational notes for AI agents iterating on this code
