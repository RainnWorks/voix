# voix · Current State (2026-05-29)

## Latest status (read this first)

- **M01 merged** on main (`30d1768`). -2,425 LOC of pre-pivot HA
  bridge code gone. **Deploy still pending** — homelab `192.168.96.15`
  unreachable from current dev network; daemon-side path unaffected.
- **M02 merged** on main (`e3e80af`). Mode → Voice rename across
  daemon + UI. File moves + symbol renames + persistence migrations
  (modes.json → voices.json, devices.json modeId → voiceId,
  recordings meta.json legacy field fallback). 4 unit tests, biome +
  typecheck clean, UI builds. Daemon dev_mode auto-pull picks this up
  in ~30s.
- **M03 in progress**: Voice schema two-phase prompts (talkingPrompt
  + donePrompt). Schema migration; daemon realtime path consumes new
  field when present.
- **Workflow doc** (`docs/build-workflow.md`) codifies: merge to
  main per milestone without asking; test coverage required per
  milestone; UI/UX audit agents (with personalities) spun up before
  any UI merge. Five-persona starting cast: Marina, Sven, Priya,
  Wren, Caleb.
- **Active tasks**: M03 (in_progress), M04-M05 (queued). M01-M02 closed.

## Pre-M01 snapshot follows

A self-contained snapshot meant to survive context compaction. Read top
to bottom and you should be able to pick up the work without prior
context. See `docs/architecture.md` for the deeper rationale and
roadmap; this doc is "where exactly are we right now".

## Hosts and access

- **HA host (HAOS)**: `root@192.168.96.15`. SSH already authorised; no password.
- **Voice PE puck**: `home-assistant-voice-095e4e` at `192.168.120.218` (DHCP).
  Different subnet from Mac (`.99.x`) but reachable from HA (`.96.x`).
- **Mac**: `192.168.99.86`. Tom's dev machine.
- **Add-on slug**: `b29b9c61_voix-backend`. Supervisor URL inside add-on:
  `http://supervisor`. Service token in env as `SUPERVISOR_TOKEN`.
- **GitHub repo**: https://github.com/RainnWorks/voix. Branch: `main`.
  HA Add-on Store repository URL: `https://github.com/RainnWorks/voix`.
- **`.env` on Mac** (`/Users/tom/Projects/voix/.env`): has `HA_TOKEN` for HA REST API.

## Repo layout (top of tree)

```
voix/
├── voix-backend/                ← The daemon (Bun + Elysia + TS)
│   ├── src/
│   │   ├── index.ts             ← Entrypoint
│   │   ├── api/                 ← HTTP routes for the UI
│   │   │   ├── modes.ts         GET/PATCH /api/modes/*
│   │   │   ├── devices.ts       GET/PUT /api/devices/*
│   │   │   └── ha_sync.ts       ← Calls HA REST when haUrl+haToken set
│   │   ├── audio/               ← Resample + (vestigial) echo gate
│   │   ├── context/             ← MCP-based context sources
│   │   │   ├── registry.ts      ← Source registry + tool routing
│   │   │   ├── sources/ha.ts    ← HA MCP via /api/mcp Streamable HTTP
│   │   │   └── sources/voix.ts  ← Builtin (voix.end_session tool)
│   │   ├── devices/store.ts     ← Per-device active mode (devices.json)
│   │   ├── history/             ← Per-session history (jsonl)
│   │   ├── modes/               ← Mode catalog, built-ins, store
│   │   ├── post_process/        ← OpenAI+OpenRouter chat completions
│   │   ├── puck/                ← Puck WS endpoint + session lifecycle
│   │   ├── realtime/openai.ts   ← OpenAI Realtime client (official SDK)
│   │   ├── recordings/          ← Per-session WAV capture + /recordings/
│   │   ├── storage/             ← atomic writes + path resolution
│   │   ├── transcripts/         ← Plain-text transcript files
│   │   └── ui/route.ts          ← Serves ui/dist
│   ├── ui/                      ← React + react-native-web UI
│   │   ├── package.json
│   │   ├── vite.config.ts       ← Aliases react-native → react-native-web
│   │   ├── src/
│   │   │   ├── App.tsx          ← AppShell + section routing
│   │   │   ├── lib/
│   │   │   │   ├── api.ts       ← Daemon fetch wrappers
│   │   │   │   └── theme.ts     ← Tokens + 12-colour mode palette
│   │   │   ├── components/
│   │   │   │   ├── Puck.tsx     ← Brand glyph (ink squircle + circle)
│   │   │   │   ├── Wordmark.tsx ← Voix /vwa/ wordmark
│   │   │   │   └── AppShell.tsx ← Titlebar + sidebar + main pattern
│   │   │   └── modes/
│   │   │       ├── ModeList.tsx ← Card grid + active pill + activate btn
│   │   │       └── ModeEditor.tsx ← Inline name, 12-swatch picker, autosave
│   │   └── dist/                ← Built bundle (gitignored)
│   ├── config.yaml              ← HA Add-on manifest (ingress: true)
│   ├── Dockerfile               ← Bun Alpine, builds UI at image-build
│   ├── run.sh                   ← Entrypoint; dev_mode git-pull + UI rebuild
│   └── .env                     ← Local dev: OPENAI_API_KEY + VOIX_WS_TOKEN
├── esphome/
│   ├── components/voix_realtime_client/   ← Puck firmware
│   ├── voix-package.yaml        ← Imported by device YAML
│   └── home-assistant-voice-095e4e.yaml   ← Per-device YAML
├── ha-integration/custom_components/voix/ ← HA discovery + adoption push
├── docs/                        ← architecture.md, STATE.md (this), adr/
├── voix-brand-guide.html        ← Marketing brand (paper, Instrument Serif)
└── voix-desktop-guide.html      ← Desktop app brand (system fonts, sober)
```

## Status table

| System | State | Notes |
|---|---|---|
| Daemon scaffold (Bun/Elysia) | ✓ | HA Add-on at port 8765 with ingress |
| Puck WS protocol | ✓ | `hello` + binary mic + `audio_start`/`audio_end` + `ready_for_input` |
| OpenAI Realtime via SDK | ✓ | `openai/realtime/ws`, GA schema |
| Mode catalog | ✓ | 6 built-ins: Realtime/Dictation/Message/Email/Note/Code |
| Post-processing (dictation) | ✓ | OpenAI + OpenRouter; raw on error |
| History (JSONL) | ✓ | Per-turn raw + processed + context snapshot |
| Per-session recordings | ✓ | `/recordings/` browser with mic+speaker WAVs |
| HA MCP context source | ✓ | Streamable HTTP at `/api/mcp` via supervisor proxy |
| `voix.end_session` builtin tool | ✓ | Model invokes it when conversation wraps |
| Echo: puck-side half-duplex | ✓ | `speaker_->is_running()` gates mic at source |
| `ready_for_input` ping | ✓ | Edge-detect speaker drain; resets daemon idle timer |
| AGC channel | ✓ | Reverted from NS after measuring (NS was too quiet) |
| Watchdog (idle close) | ✓ | Tracks both userSpeaking + assistantSpeaking |
| atomicWrite collision fix | ✓ | crypto.randomBytes suffix prevents same-ms collision |
| Daemon survives ENOENT/etc | ✓ | unhandledRejection logged, NOT exit(1) |
| HA Add-on `dev_mode` pull | ✓ | Polls main every 30s; auto-rebuild UI on commits |
| `/api/modes/*` REST | ✓ | UI consumes via fetch |
| `/api/devices/*` REST | ✓ | List + PUT mode (auto-syncs to HA when haUrl+haToken) |
| `ha_sync` module | ✓ | Calls HA REST for `voix.update_mode` + `voix.set_mode` |
| React UI scaffold (RN-Web) | ✓ | Mode list + mode editor + 12-swatch picker + autosave |
| HA Add-on ingress | ✓ | `ingress: true, ingress_port: 8765` — UI in HA's chrome |
| HA integration trim | ✗ | Still has ~3000 LOC of old bridge code, harmless dead weight |
| Mac native shell (SwiftUI/Tauri) | ✗ | Not started. Roadmap A in architecture.md. |
| Mac mic as input source | ✗ | Not started; same WS protocol |
| iOS keyboard | ✗ | Future. Same React Native components, native shell |
| Auto-routing (dictation modes) | ✗ | Routing hint field exists, no router |
| Cost tracking | ✗ | per-model costPerMinute + aggregation |
| Multi-puck `end_session` routing | ✗ | Closes ALL bound sessions currently |
| Conversation history UI | ✗ | Placeholder screen |
| Devices & settings UI | ✗ | Placeholder screen |
| Mode creation/deletion UI | ✗ | Daemon POST exists; no UI button yet |

## The just-landed redesign

**Why**: the first UI I shipped was generic Material-ish, white background, no
puck iconography, no brand. Tom called it: "really need to redesign that. Like.
Really bad". The brand assets are:

- `voix-brand-guide.html` — **marketing** brand: cream paper (#FAF8F3),
  Instrument Serif display, Hanken Grotesk body, HA blue (#03A9F4) as rare
  accent. NEVER Inter/Geist/Manrope/Söhne. NEVER em dashes. NEVER nested cards.
- `voix-desktop-guide.html` — **desktop app** brand: *deliberately sober*.
  System fonts only (SF Pro Text on Mac, Segoe UI Variable on Windows).
  JetBrains Mono for technical labels only. System accent (#007AFF) for
  sidebar selection, focus rings, links. HA blue ONLY for "Voix moments"
  (puck centre, status pills, VOIX speaker tag, active-mode pill).
  **Never put HA blue in chrome.**

The 12-colour mode palette is the desktop brand's exception to "three colours
full stop": 6 saturated (HA blue, Amber, Violet, Green, Coral, Magenta), 6 soft
(Sky, Lemon, Lavender, Mint, Peach, Slate). Defined in
`voix-backend/ui/src/lib/theme.ts` as `modePalette` + `paletteOrder`. Existing
modes with arbitrary RGB get snapped to the nearest swatch via
`nearestSwatch()`.

**Puck iconography** is the brand's recurring element. `<Puck size={N} />`
component in `ui/src/components/Puck.tsx`. Ink-coloured rounded square (22%
border radius of the side), HA-blue (or mode-coloured) circle at 35% of the
side, centered. Used in:

- Wordmark (size 14)
- Sidebar Modes flat item (size 11)
- Mode list cards (size 44)
- Mode editor identity row (size 56)

**`outlineStyle: "none"` was used twice and got pulled both times** — Tom
hates type-system escape hatches. Browser focus rings respect the system
accent and the brand guide explicitly says to keep them. Selected-swatch
indication is now a wrapper `<View>` with a coloured border, NOT `boxShadow`.

## HA sync contract

**Rule**: whenever the daemon mutates state, if `haUrl` + `haToken` are
configured, fire a matching call into HA so entities mirror the change.
Source of truth stays on the daemon; HA is a mirror.

Wired today via `src/api/ha_sync.ts`:

| Daemon mutation | HA call | Effect |
|---|---|---|
| `PATCH /api/modes/:id` | `voix.update_mode` (snake_case fields) | HA catalog stays in sync |
| `PUT /api/devices/:id/mode` | `voix.set_mode` | HA pushes new mode_id to puck NVS |

Token resolution per `src/env.ts`:
1. Add-on option `ha_token` (rare, user override)
2. Env var `HA_TOKEN` (dev mode)
3. `SUPERVISOR_TOKEN` injected when `homeassistant_api: true` (production default)

`haUrl` default is `http://supervisor/core` (HA-core proxy). MCP client targets
`/api/mcp` (Streamable HTTP) since `/mcp_server/sse` is outside the proxy mount
and 404s.

**Not yet synced** (TODOs):
- Mode creation (`POST /api/modes`) doesn't yet call `voix.create_mode`
- Mode deletion isn't exposed via daemon yet
- Recording metadata / transcripts don't push to HA entities

## How dev iteration works

**Daemon source change**:
```
edit voix-backend/src/...
git add + commit + push
# wait ~30s — run.sh poller pulls + bun --watch reloads
```

**UI source change**:
```
edit voix-backend/ui/src/...
git add + commit + push
# same 30s — run.sh poller does `bun run build` after reset
```

**Firmware change**:
```
edit esphome/components/voix_realtime_client/*
pkill -f "esphome logs esphome/home-assistant-voice-095e4e"
scripts/build-local.sh upload 192.168.120.218
# ~45s compile + 12s OTA
nohup esphome logs ... > /tmp/voix-device.log &
```

**Add-on config change** (`config.yaml`, `Dockerfile`, `run.sh`):
```
push to main → does NOT auto-pick-up. Need rebuild:
ssh root@192.168.96.15 bash <<'EOF'
TOKEN=$SUPERVISOR_TOKEN
curl -s -X POST -H "Authorization: Bearer $TOKEN" http://supervisor/store/reload
curl -s -X POST -H "Authorization: Bearer $TOKEN" \
  http://supervisor/addons/b29b9c61_voix-backend/rebuild
EOF
# ~1-2 min for image build
```

**Add-on options change** (`openai_api_key`, `ha_token`, `dev_mode`, etc.):
```
ssh root@192.168.96.15 bash <<'EOF'
TOKEN=$SUPERVISOR_TOKEN
curl -s -X POST -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"options": {... ALL options here, partial not allowed ...}}' \
  http://supervisor/addons/b29b9c61_voix-backend/options
curl -s -X POST -H "Authorization: Bearer $TOKEN" \
  http://supervisor/addons/b29b9c61_voix-backend/restart
EOF
```

## Lessons learned (DO NOT REPEAT)

- **AGC channel is right for the XMOS pipeline**, NS is too quiet. Tried both;
  measured. NS output produced mic_rms 55-99 and STT word-confusion ("I'm
  shouting at you" → "ChatGPT, I will show at you"). AGC mic_rms 1000s, clean
  STT. Echo gating happens at the PUCK now, not the daemon, so AGC's
  amplification doesn't cause loops.
- **The puck must gate mic on `speaker_->is_running()`** at the firmware
  level. Daemon-side energy thresholds calibrated to volume, never worked
  across users. Half-duplex on the chip is what HA's stock voice assistant
  does for the same hardware reason.
- **`ready_for_input` ping from puck → daemon** resets idle timer correctly.
  Without it, the watchdog ticks during speaker drain and closes the session
  before the user has a chance to respond.
- **Watchdog must respect both `userSpeaking` and `assistantSpeaking`**. Either
  alone leaves the other side open to premature close.
- **`atomicWrite` MUST use crypto random in the tmp name**. `Date.now()`
  granularity is not enough — concurrent calls within 1ms generate the same
  path and race.
- **`unhandledRejection` MUST NOT `process.exit(1)`** in a long-running daemon.
  Log and continue. `uncaughtException` stays fatal (engine state is gone).
- **HA's MCP proxy is at `/api/mcp` (Streamable HTTP), not `/mcp_server/sse`**.
  The Supervisor's `/core/*` proxy only forwards `/api/*`.
- **SUPERVISOR_TOKEN works for HA's `mcp_server` integration via `/api/mcp`**.
  We thought it didn't (got 403 on /mcp_server/sse) but that was the URL,
  not the auth.
- **Do not scrape `.storage/auth` for HA tokens** — classifier-blocked + bad
  practice. Use a long-lived access token via Profile → Security.
- **`as never` / `outlineStyle: "none"`-style escape hatches are not OK in
  this codebase**. Tom hates them; he's caught it twice. Fix types properly
  or use a different visual pattern (e.g. wrapper View instead of `boxShadow`).
- **Marketing brand and desktop brand are different**. The website is loud
  (Instrument Serif, cream paper); the app is sober (system fonts, neutral
  surfaces). The puck is the only place character lives in the app.

## What's left

**Short-term** (next session likely):
1. **Conversation history UI** — list past sessions, click to view transcript +
   play mic/speaker WAVs inline. Hooks already exist (`/recordings/` and
   `history.jsonl`); just needs a React screen.
2. **Devices & settings UI** — show connected puck(s), firmware version, mode
   options, daemon config. `/api/devices` exists.
3. **Mode creation flow** — currently no `+ New mode` button. Daemon's
   `POST /api/modes` exists; needs UI + `voix.create_mode` HA sync.
4. **Mode deletion** — daemon needs DELETE endpoint + HA sync to
   `voix.delete_mode`.
5. **Better activate-mode signal** — clicking Activate works but if the puck
   is offline the change only lands on next adoption. Could show a "will apply
   next wake" hint when puck is idle.

**Medium-term**:
- Trim the HA integration to ~300 LOC. Currently ~3000 LOC of dead bridge
  code. Plan: delete `ws_view.py`, `post_process.py`, the mode catalog code,
  most of `__init__.py`. Keep ESPHome discovery, adoption push, mode select
  entity, LED color push.
- Mac native shell. SwiftUI menu bar app + hotkey + mic capture + paste.
  Embeds the React Native components for the settings sheets. Connects to
  daemon over WS using the same `device_id`-based protocol pucks use.
- Auto-routing for dictation modes. Each mode already has `routingHint`. Need
  a small/cheap LLM call: given context (focused app, file extension, window
  title), pick the best mode. Cache `bundleId → mode_id`.

**Longer-term**:
- iOS keyboard replacement. Same React Native components, wrapped in a Swift
  keyboard extension. Connects to a daemon (Mac or hosted).
- Cost tracking. Per-model `costPerMinute` metadata, aggregated per mode,
  surfaced in the UI.
- Stage-tuning revisit. `channel_0_stage=AEC` + `gain_factor` boost in the
  ESPHome microphone source. The livekit-on-vpe project measured AEC=4 on
  sine wave; if we can stay loud enough for STT, we'd get cleaner echo
  cancellation than half-duplex.

## Test plan for the very next iteration

After this push lands and the dev pull picks it up:

1. **UI loads in HA's Add-on tab**. Settings → Add-ons → voix backend → Open
   Web UI. Should see the new brand: sidebar with wordmark, "Modes" selected,
   grid of 6 cards each with a puck icon, ACTIVE pill on the current mode.
2. **Mode editor opens on card click**. Big puck preview top-left, inline name
   + description inputs, 12-swatch picker that visibly highlights the current
   color. Click a different swatch → puck updates, "Saved" appears in toolbar.
3. **Activate button**. Click a non-active card's Activate button → ACTIVE pill
   moves there. Check HA's mode select entity for the puck — should reflect
   the change (the `haSync.setDeviceMode` call should have fired).
4. **Sanity-check the puck path is still healthy**. Wake-word: should still
   work. Check `/recordings/` browser shows the new session's WAVs. Check the
   model didn't loop (puck-side half-duplex still active).

If any of those break, the recent changes to look at are:
- `ui/src/components/AppShell.tsx` (layout)
- `ui/src/modes/ModeList.tsx` (grid + activate)
- `ui/src/modes/ModeEditor.tsx` (12-swatch picker, autosave)
- `src/api/devices.ts` + `src/devices/store.ts` (active mode state)
- `src/api/ha_sync.ts` (HA mirror)

## See also

- `docs/architecture.md` — long-form why and roadmap
- `CLAUDE.md` — operational guide for AI agents (log streams, deployment
  patterns, HA gotchas)
- `voix-brand-guide.html` / `voix-desktop-guide.html` — the visual system
