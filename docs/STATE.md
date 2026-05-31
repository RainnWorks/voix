# voix · Current State (2026-05-31, M21 closed)

## Read this first

**Where to start, by intent:**

- **Resuming after context compaction?** Read
  `docs/session-handoff/2026-05-30-audit-pass.md` for the prior
  audit pass context, then **`docs/phase-6/architecture-m19.md` +
  `docs/phase-6/verify-results/M19-*.md` + the new
  `docs/agent-team-workflow.md`** for the Phase 6 RN-end-to-end
  setup. This file is the cold-read entry.
- **What's the team-of-agents workflow?**
  `docs/agent-team-workflow.md` — adopted Anthropic Agent Teams as
  the mechanism, Osmani/Shankar vocabulary, NabaOS-style receipts.
  Applies to all projects under `/Users/tom/Projects/` unless
  overridden.
- **Want to know what's broken?** `docs/audits/niggly-bits.md` (B2,
  280 lines). The 9 most critical items shipped fixes in `9dc5c0b`.
- **Want the brutal what-vs-what?** `docs/audits/goal-vs-reality.md`
  (B1, 221 lines). Milestone-by-milestone scorecard.
- **Want to start real automated tests?**
  `docs/testing/ui-harness.md` (1474 lines, ready to implement),
  `docs/testing/ha-integration-harness.md` (695 lines, verified
  source).

---

## Status — Phase 6 (M21 closed); platform shims + iOS audio-api stack

**M21 closed (2026-05-31)** — platform shim layer + iOS audio capture
and playback via `react-native-audio-api`. Seven commits on main per
Decision 8 of `docs/phase-6/architecture-m21.md`:

- Step 1 (`48fa361`): interface skeleton — `packages/ui/src/platform/
  types.ts` + barrel re-exporting types only.
- Step 2 (`0ba9b60`): web impls of non-audio primitives
  (`storage.ts`/`appInfo.ts`/`websocket.ts`/`permissions.ts`/
  `inlineAudio.tsx`).
- Step 3 (`c0d45cc`): native impls of non-audio primitives +
  AsyncStorage + DeviceInfo pods. iOS gets 75 pods; macOS gets 74
  (DeviceInfo iOS-only). 5 s pod install both targets.
- Step 4 (`c3cde4e`): web audio capture + playback split into
  `platform/audioCapture.ts` + `audioPlayback.ts`; `audio_io/client.ts`
  becomes a thin orchestrator; `audio_io/client.native.ts` (M19 stub)
  deleted.
- Step 5 (`e08c1ba`): iOS audio capture + playback via
  `react-native-audio-api@0.12.2` + `react-native-worklets@0.8.3`
  (Delta C: brief originally pinned 0.9.0 but worklets 0.9.x asserts
  RN 0.83+ at the pod level; 0.8.x supports our RN 0.81.6).
  NSMicrophoneUsageDescription + UIBackgroundModes ["audio"] in iOS
  Info.plist; NSMicrophoneUsageDescription in macOS for M22.
  77 iOS pods; 75 macOS pods.
- Step 6 (`f16babe`): wire consumers — `lib/api.ts` and TalkButton
  switch to `appInfo.getApiBase()` (async); ConversationDetail's
  inline audio uses `platform/inlineAudio`; `lib/apiBase.{ts,native.ts}`
  + `conversations/InlineAudioPlayer.{tsx,native.tsx}` DELETED;
  `@voix/ui.__dev__.setApiBase()` exposed for Tom's manual step 2 (b).
- Step 7 (this commit): docs — `docs/phase-6/m21-manual.md` written +
  this STATE update + `scripts/check-pin-bounds.sh` wired into
  `bun run check`.

**M21 smoke (every step, all green)**:
```
bun install                                       # workspace OK
cd voix-backend/ui && bun run build               # web UI OK (334 modules)
bun run check                                     # protocol + siblings + pin-bounds
cd voix-backend && timeout 5 bun src/index.ts     # "listening on :8765"
bunx tsc -p clients/app/tsconfig.json --noEmit    # exit 0
bunx tsc -p packages/ui/tsconfig.json --noEmit    # exit 0
```

**Step 5 iOS visual verification**: build + launch + Voices list
rendering confirmed in `/tmp/voix-smoke-screenshots/m21-step5.png` on
iPhone 16 Pro sim. App imported `react-native-audio-api`,
`react-native-async-storage/async-storage`, and
`react-native-device-info` without red-box. Mic permission pre-granted
via `xcrun simctl privacy booted grant microphone
org.reactjs.native.example.voix` so Tom won't need to re-prompt on
the first hold-to-talk. Actual PTT end-to-end (hold-button +
"hello voix" + reply playback + new Conversations entry) requires
human-hands UI interaction against the sim window and is deferred to
Tom's `m21-manual.md` step 4 — Claude's sandbox can't drive sim taps
without Accessibility grants that aren't on this Mac.

**M21 deltas surfaced** (3 within Decision 13's hard ceiling):
- Delta A (coordinator-set in brief): `react-native-audio-api@^0.12.2`
  (npm registry latest 2026-05-31), brief originally said 0.13.0.
- Delta B (coordinator-set in brief): `client_info.kind = "phone-sat"`
  per `packages/protocol/src/audio-io.ts::ClientKind`; brief had
  "phone" somewhere.
- Delta C (M21 implementer): `react-native-worklets@0.8.3` (exact),
  not the brief's `0.9.0 (exact)`. Worklets 0.9.x asserts RN 0.83+
  in its podspec (`RNWorklets.podspec` line 6's
  `worklets_assert_minimal_react_native_version`); our RN 0.81.6 pin
  is incompatible. 0.8.3 (which supports RN 0.81-0.85 per the lib's
  `compatibility.json`) is the highest compatible release. `bun run
  check` gains `scripts/check-pin-bounds.sh` enforcing "stays in
  0.8.x" so a future drift to 0.9.x is caught.

**Phase 6 carry-forwards**:
- M20a (HA Add-on Docker context shift) — still queued.
- macOS audio (M22) — by design.
- iOS settings screen for setApiBase (M23) — by design.

---

## Status — earlier Phase 6 history (M20 closed; M19 closed)

**Phase 6 direction**: Drop the pre-pivot Tauri shell. The voix UI is
already RN-shaped (9 files import from `react-native`, rendered today
via `react-native-web`). Phase 6 lifts the component layer into a
shared `@voix/ui` package and grows three platform shells from it:
web (HA iframe, today), react-native-macos (M22), react-native-ios +
keyboard extension (M23-M24). Tauri would force a desktop/mobile
split for no gain. See `docs/build-workflow.md` Phase 6 + the
decision context in `docs/phase-6/architecture-m19.md`.

**M19 closed (2026-05-31)** — monorepo + shared UI package shipped
through the new team-of-agents workflow. Six commits + a three-fix
follow-pass landed end-to-end:

- `e1d71e0..a5547d5` — Implementer steps 1-4 + 6 (root workspace +
  React 19 bump, `@voix/protocol`, `@voix/ui` move, `.native.ts`
  suffix split + InlineAudioPlayer split, STATE update).
- `5127013` — Fix pass 1: pin `@sinclair/typebox: ^0.34.49` via root
  `overrides` (RN's `@jest/schemas` was hoisting 0.27.10, breaking
  Elysia's `Unsafe` import — daemon wouldn't boot).
- `09cebc3` — Fix pass 2: revert daemon's workspace dep on
  `@voix/protocol`. Wire-types parallel-copied at
  `voix-backend/src/audio_io/protocol.ts` and
  `packages/protocol/src/audio-io.ts`; `scripts/check-protocol-sync.sh`
  enforces drift. Unblocks the HA Add-on Docker build context.
- `5b95afd` — Fix pass 3: drop dead `paths` map + the `clients/*`
  glob until M20 re-adds it.

**M19 smoke tests (all green)**:
```
scripts/check-protocol-sync.sh         → OK
cd voix-backend && bun run typecheck   → exit 0
cd voix-backend && bun src/index.ts    → "listening on :8765"
cd voix-backend/ui && bun run build    → 325 modules / ~600ms
cd voix-backend/ui && bun run typecheck → exit 0
```

**Carry-forward issues from M19 verify** (filed for M20):
- HA Add-on UI install path still broken in production Docker
  (`voix-backend/ui/package.json` workspace:* deps escape build
  context). Dev path (HA Add-on `dev_mode` clones full repo) works.
  **Deferred to M20a** (explicit Docker context shift) — half-day's
  work; orthogonal to RN scaffold; doing both at once risks merging
  across phases.
- Internal package imports use explicit `.ts(x)` extensions —
  Metro's `.native.ts` resolution only fires on extensionless
  imports. **Shipped in M20 step 5** (44 imports across 11 files
  stripped via one-shot codemod).
- `.native` sibling-exists invariant has no enforcement — a missing
  web-side companion to a `.native.ts` would compile silently.
  **Shipped in M20 step 6** (`scripts/check-native-siblings.ts`
  wired into `bun run check`).

**M20 closed (2026-05-31)** — RN-CLI scaffold + Hiro carry-forwards
+ Tauri archive shipped through the team-of-agents workflow. Ten
commits on main, plus a one-time `legacy/tauri-clipboard` snapshot
branch on origin:

- Step 1 (`b426475`): re-add `clients/*` to workspaces glob.
- Step 2 (`f010cca`): RN-CLI 0.81.6 init at `clients/app/`.
- Step 3 (`b0e56c6`): Metro workspace config + `react-native-macos
  @0.81.7` root placeholder.
- Step 4 (`da76318`): macOS target via direct generate-macos.js call
  (the rn-macos-init wrapper trips ENOWORKSPACES inside bun
  workspaces). Podfile pins `platform :macos, '14.0'` (template
  default; brief expected 11.0 — operational; Tom's Mac is macOS
  26.3).
- Step 5 (`e58c1ca`): strip 44 explicit `.ts(x)` imports across 11
  files in `packages/ui/src/` (Hiro Delta D).
- Step 6 (`c3080cf`): `scripts/check-native-siblings.ts` + root `bun
  run check` aggregator (Hiro M2).
- Step 7 (`ec1126c`): `packages/ui/src/lib/apiBase.{ts,native.ts}` —
  web returns "", native returns LAN URL `http://192.168.99.86:8765/`
  (M21 swaps for user-config setting).
- Step 8 (`de38bd6`): `clients/app/index.js` registers `App` from
  `@voix/ui`. Required a one-line `pcm.buffer as ArrayBuffer` cast
  in `client.ts` to satisfy TS 5.x strict-DOM lib (no runtime change).
- Step 9a (`2ec5eac` on `legacy/tauri-clipboard`): snapshot the
  pre-pivot Tauri tree (35 source files; build artefacts gitignored).
  Pushed to origin. M02e voice rename diffs verified preserved.
- Step 9b (`49ad1ab` + `370bcaa` on main): add-then-rm Tauri `app/`
  so the deletion is in main's history.

**M20 smoke tests (every step, all green)**:
```
bun install                                       # workspace OK
cd voix-backend/ui && bun run build               # web UI OK (325 modules)
bun run check                                     # protocol-sync + native-siblings
cd voix-backend && timeout 5 bun src/index.ts     # "listening on :8765"
bunx tsc -p clients/app/tsconfig.json --noEmit    # exit 0
```

**M20 deferred to M20a (HA Add-on Docker context shift)**: see
`docs/build-workflow.md` Phase 6 table. Until M20a lands, the HA
Add-on **stable-channel** production build is broken; `dev_mode`
(which clones the repo inside the container) keeps working. Half
day's work; doing it inside M20 would have merged across phases.

**Tom's manual smoke for M20**: `docs/phase-6/m20-manual.md` —
watchman install, root re-install, `pod install` (iOS + macOS), set
LAN IP in `apiBase.native.ts`, Metro + run-ios + run-macos.

**Smoke RAN (2026-05-31) by claude on Tom's behalf** —
`docs/phase-6/verify-results/M20-tom-smoke.md`:

- **iOS: VISUALLY CONFIRMED** via `/tmp/voix-smoke-screenshots/ios-after-boot.png`.
  Sidebar with Voix /vva/ wordmark + history entry; Voices list
  populated from the live daemon (all 6 modes, brand-correct
  swatches); HA blue only in voix moments (active pill, NOW puck-1
  pill); system fonts; layout responsive to iPhone 16 Pro. Build
  time: 97s first run.
- **macOS: BUILD + LAUNCH CONFIRMED** via `ps aux` / `lsappinfo`
  (bundleID `org.reactjs.native.voix`). Build time: 71s. **Visual
  verification still pending Tom** — Mac was locked during smoke,
  screencapture only got login window.

**Tom's pending hands-on for M20**: unlock Mac, look at the
voix-macOS window currently running, confirm sidebar + Voices list
render same as iOS. If broken, screenshot + report; if working,
no action needed.

**Smoke surfaced 3 fixes shipped post-hoc** (commit `439fa6e`):
1. `clients/app` needed `@react-native-community/cli-platform-apple`
   devDep — without it `run-macos` errors with the misleading "macOS
   project folder not found".
2. Manual.md step 2 wrong path — `Gemfile` is at `clients/app/`, not
   `clients/app/ios/`.
3. Manual.md step 5 — Metro v0.83.7 prints "Welcome to Metro" not
   "Dev server ready".
4. M21-deferred: macOS hot-reload broken — `start:macos` script
   targets port 8082 but scheme's `RCT_METRO_PORT` isn't plumbed.

**Phases 1-5 (pre-M19) — complete on source.** Eighteen milestones
merged + an adversarial audit pass that shipped 9 fixes (`9dc5c0b`).
Tags: `v0.phase-1`, `v0.phase-2`. (`v0.phase-3`, `-4`, `-5` not
tagged — verification cliff at the Phase 3/4 boundary remains; see
audit B1.)

**The verification cliff** (B1's headline): only M01 + M02b/c/d ever
ran against real systems. Everything M08+ has only ever run against
stubs, synthetic audio, or a compiled-but-never-flashed binary. Two
deploy blockers cascade everything:

- **#124** puck OTA (firmware compiled `fa58375`, never flashed)
- **#130** `DEEPGRAM_API_KEY` + real dictate round-trip

Until either lands, the whole Phase 3/4/5 stack is "shape is right,"
not "behaviour is right."

**The audit pass (`9dc5c0b`) fixed 9 issues**, four of them shipped-
to-main bugs that would crash or silently misbehave for users:

1. ConversationList hooks-after-return — crashed Conversations page
2. TalkButton press race — leaked mic + WS on quick tap
3. Browser 2× speed audio — `sendSpeaker` missing the resample contract
4. Discuss barge-in permanently muted assistant
5. Orchestrator dead ternary `"deepgram":"deepgram"`
6. Malformed v1 hello hung the WS
7. `async_unload_entry` leaked hass.data / re-registered services
8. `secrets.yaml.bak` not gitignored (Wi-Fi creds)
9. Unbounded discuss history (quadratic token cost)

**Tests: 115 daemon tests pass, biome + typecheck clean, UI builds.**

**The Phase 4 wiring is hot but unverified end-to-end.** Daemon
side has:
  - Energy VAD + tuning bench (`scripts/vad-bench.ts`)
  - STT provider interface + Deepgram impl
  - LLM provider interface + OpenAI/OpenRouter impls (replacing the
    old `post_process/` module)
  - TTS provider interface + Aura impl
  - Pipeline orchestrator + TraditionalDictatePipeline
  - 104 unit tests pass; biome + typecheck clean.

To actually exercise the traditional dictate path on the puck:
  1. Land the queued puck OTA (#124) so the v1 hello arrives.
  2. Add `DEEPGRAM_API_KEY` to .env / HA Add-on options.
  3. Edit any built-in dictation voice (e.g. Email) and set its
     `sttProvider` to `deepgram` via the voices API.
  4. Dictate. Should log "orchestrator: ... → TraditionalDictate"
     and produce a polished history entry without OpenAI Realtime.

Phase 4 remaining work: **M14** (discuss-via-traditional turn loop:
STT → LLM(talkingPrompt) → TTS, plus VAD-driven end-of-user-turn
detection), then **M15** (realtime provider behind the orchestrator
interface + voice.discussEngine dial in the editor).

**Queued homelab deploy**: Puck firmware OTA — the v1 capability
handshake (M08) is compiled, in `esphome/.esphome/build/.../
firmware.bin`, and verified to contain the new fields. Puck has
been `unavailable` in HA since 14:44 UTC 2026-05-29 (predates the
M08 work) — `esphome upload` returns "Network is unreachable" both
from the dev Mac and from the HA host. Daemon already accepts the
new shape; on the puck's reconnect, run:

```
export PATH="$HOME/Library/Python/3.14/bin:$PATH"
esphome upload esphome/home-assistant-voice-095e4e.yaml --device <ip>
```

Resolve `<ip>` via `ssh root@192.168.96.15 'getent hosts
home-assistant-voice-095e4e.local'` once it's back.

Smoke-test acceptance is one line in the daemon log on next
wake-word session:
```
audio_io home-assistant-voice-095e4e: hello v1 kind=puck intent=discuss
  voice_id=default-realtime mic=16000/1 speaker=24000
  half_duplex_on_chip=true wake_words=[voix]
```

- **M01 deployed + verified** (commit `30d1768`). -2,425 LOC of
  pre-pivot HA bridge code gone. `scripts/deploy-ha-integration.sh`
  ran clean; `ha core check` passes; 26 voix entities loaded after
  restart. The earlier "homelab unreachable" reading was wrong — it
  was the `rsync` command missing on HAOS, not a network issue. The
  new script uses a tar pipe so no remote `rsync` is needed.
- **M02 merged** (`e3e80af`). Mode → Voice rename. File moves +
  symbol renames + persistence migrations (modes.json → voices.json,
  devices.json modeId → voiceId, recordings meta.json legacy field
  fallback). 4 unit tests.
- **M03 merged** (`dd4e186`). Voice schema two-phase prompts:
  `talkingPrompt` + `donePrompt` are canonical, legacy
  `prompt`/`postProcessPrompt` are kept in sync as deprecated aliases.
  `normalisePhasePrompts()` handles every on-disk shape on read; PATCH
  alias rules keep UI writes consistent. Daemon's realtime path reads
  the new fields directly. 5 unit tests.
- **M04 merged** (`c6203ff`). Voice editor rewritten to two-panel
  shape. Numbered HA-blue pips for phase 1 + 2 with a rail line
  connecting them visually. "Skipped" tags when a phase is empty.
  Provider/model knobs behind Advanced disclosure. Segmented control
  for the OpenAI/OpenRouter picker (no more silent coerce). Audit
  agents Marina + Wren spun up before merge per workflow rule,
  briefs at `docs/agents/m04-{marina,wren}.md`.
- **M05 merged** (`5323e71`). Protocol shift: hello has new
  canonical `intent` (dictate/discuss) + `voice_id` fields; legacy
  `mode` + `mode_id` accepted via `resolveCapture()` mapping
  (realtime→discuss, dictation→dictate). 7 unit tests.
- **M06 merged** (`9192174`). Audio I/O port v1 protocol spec.
  `protocol/audio-io/spec.md` (the doc) +
  `voix-backend/src/audio_io/protocol.ts` (the TS types +
  `parseHello` validator + `needsDaemonEchoGate` policy). 14 tests.
- **M07 merged** (`0399302`). Split `puck/session.ts` (641 LOC) into
  `audio_io/connection.ts` (WS-facing) and
  `pipeline/{realtime,watchdog,types}.ts` (provider-facing). They
  meet through the `Pipeline` + `PipelineCallbacks` interface — no
  cross-module reach-through. WS URL `/ws` unchanged so firmware
  isn't disturbed. 13 connection tests + 30 carried over → 43 total.
- **M08 merged** (`fa58375`). Firmware sends the v1 capability
  handshake. New hello shape from the puck:
  `protocol_version=1`, `intent`, `voice_id`, `capabilities.{mic,
  speaker, half_duplex_on_chip, wake_words}`, `client_info.kind=
  "puck"`. YAML gains a `voix_mode_id` global; HA's `voix_set_state`
  push extended with `mode_id`. Daemon's `audio_io/connection.ts`
  logs the capabilities on every hello at WARN. Compiles clean
  (ESP32-S3, RAM 23.2%, Flash 82.7%). **Puck OTA queued** — see
  "Queued homelab deploy" at the top.
- **UI ingress fix** (`b0715d1`). Daemon's UI bundle was 404ing
  for the HA-add-on user — `api.ts` used absolute `/api/voices`
  paths that bypassed the `/api/hassio_ingress/<token>/` prefix.
  Switched all API URLs to relative (no leading slash), same
  trick as the M04-era vite `base: "./"`.
- **M09 merged** (`78bf122`). Energy VAD (`src/vad/`) with
  hysteresis + hangover + start-frames guard, plus a tuning bench
  CLI (`scripts/vad-bench.ts`) that replays a WAV through the VAD
  and logs every transition with timing + RMS. 10 unit tests.
  Defaults: startThreshold=800, endThreshold=400, smoothMs=50,
  minSilenceMs=400, startFrames=2 — needs 20-utterance human
  tuning sweep per the acceptance check.
- **M10 merged** (`f7ba67d`). STT provider interface
  (`pipeline/providers/stt/types.ts`) + Deepgram streaming impl
  (`deepgram.ts`). 14 tests against a stub WS — no real network.
  Needs `DEEPGRAM_API_KEY` in env / add-on options to actually
  run.
- **M11 merged** (`eb031bf`). LLM provider interface +
  OpenAI/OpenRouter impls. Promotes `post_process/` into
  `pipeline/providers/llm/`. `ChatCompletionsProvider` shared by
  both impls; 5-line factory each. `postProcess` facade still
  guarantees "any failure → return raw text" so a dictation is
  never lost when the polisher flakes. 17 tests.
- **M12 merged** (`c8d5ce8`). TTS provider interface + Deepgram
  Aura streaming impl. Same shape as M10. 14 tests.
- **M13 merged** (`c376d04`). Pipeline orchestrator
  (`pipeline/orchestrator.ts`) + traditional dictate pipeline
  (`pipeline/dictate_traditional.ts`). Wires everything together;
  audio_io/route.ts now uses the orchestrator's factory. 7
  orchestrator tests on top of the inherited 97 → **104 daemon
  tests passing**.
- **M13b merged** (`a0b7648`). Voice editor rewrite: Realtime vs
  Dictation surfaced as the primary axis, with conditional layout
  per type and audit-fix pass (Marina + Wren). Briefs at
  `docs/agents/m13b-{marina,wren}.md`.
- **M02b merged + deployed** (`72c6b2f`). HA service-name aliases:
  voix.cycle_voice / set_voice / create_voice / update_voice /
  delete_voice / list_voices registered alongside the existing
  mode_* services. Old names labeled "(deprecated alias)" in the
  HA UI. 13 voix services visible in Developer Tools.
- **M02c+d merged + deployed** (`bf802c2`). Entity_id migration:
  voix_mode_* → voix_voice_* across light + select entities; new
  voices.py module with canonical function aliases; en.json
  translations for all new services. Verified live: 0 stale
  voix_mode_* entities, 17 voix_voice_* entities tracking
  correctly. Storage key entry.options["modes"] kept as-is for
  back-compat (no benefit to a forced storage migration).
- **M02e on disk, untracked**. Tauri rename diffs applied to
  app/src-tauri/src/{commands,tray}.rs + app/src/settings.js
  (voix.list_modes → voix.list_voices etc.). The entire app/
  tree is untracked in the voix repo so no commit landed; rename
  travels with the on-disk files until the user decides to
  commit app/. Once committed, the M02b deprecated mode_*
  service aliases can be removed.
- **M14 merged** (`9126238`). TraditionalDiscussPipeline + Voice
  schema fields `discussEngine` / `ttsProvider` / `ttsVoice` +
  multi-turn LlmRequest.messages + orchestrator routing on
  discussEngine. 10 discuss tests on synthetic-amplitude VAD
  transitions → 114 daemon tests passing.
- **M15 merged** (`ed21f30`). Voice editor exposes the dial as
  "Live" vs "Turn-based" (audit-driven naming — Wren caught that
  "Realtime/Traditional" collided with the voice type word).
  Engine row is the first thing inside Advanced for Realtime
  voices; engine-specific plumbing rows swap underneath. Audit
  briefs at `docs/agents/m15-{marina,wren}.md`. Daemon-side
  RealtimeProvider types-only interface (full refactor of
  RealtimePipeline behind it is M16+ work; not needed today since
  the discussEngine routing already lives in the orchestrator).
- **M16 merged** (`14cec52`). Phase 5 begins. Sidebar Modes →
  Voices, Devices → Surfaces. New Surfaces screen lists every
  Audio I/O endpoint with capability chips from the M06/M08
  handshake (mic rate, speaker rate, AEC on chip, wake words,
  codec). Kind-aware glyph (Puck for puck; 📱/🌐/💻 placeholders
  for other kinds). Audit briefs at
  `docs/agents/m16-{marina,wren}.md`.
- **M17 merged** (a Conversations screen + entry detail). Sessions
  list with kind-tinted Puck glyph + voice name + (optional)
  "shaped" tag + when + duration + 2-line raw transcript preview.
  Detail view: Transcript → Entry → What voix knew (humanised
  context receipt) → Listen back ("What I said" / "What voix said"
  inline audio players). Audit briefs at
  `docs/agents/m17-{marina,wren}.md`.
- **M18 merged**. Browser becomes an Audio I/O endpoint —
  press-to-talk button on Conversations opens a WS to /ws with v1
  capability handshake (client_info.kind="browser-tab"), streams
  getUserMedia PCM16 LE up, plays back PCM16 LE through WebAudio.
  Speaking state inverts the pill so the floor-taken state is
  unambiguous. Per-tab device_id in localStorage. Audit briefs at
  `docs/agents/m18-{marina,wren}.md`.

- **M19 merged** (Phase 6 / RN end-to-end foundation). Monorepo
  conversion. Repo root gets a bun-workspaces `package.json` plus
  `tsconfig.base.json` with path mappings for `@voix/protocol` and
  `@voix/ui`. Two new packages:
    - `packages/protocol/` — wire types (`audio-io.ts`); the daemon's
      old `voix-backend/src/audio_io/protocol.ts` is now a one-line
      re-export.
    - `packages/ui/` — every UI source file from `voix-backend/ui/src/`
      except `main.tsx`. Web target keeps Vite + react-native-web alias
      (with a tiny `ignoreNativeSuffixes` plugin so the build never
      picks up `.native.ts(x)` files). `vite-tsconfig-paths` resolves
      the workspace path mappings.
  Step 4 split the only web-only file (`audio_io/browserClient.ts` →
  `client.ts` + `client.native.ts` stub) plus Delta A's
  `InlineAudioPlayer.tsx` (web `<audio>`) + `.native.tsx` (M22
  placeholder). React 18 → 19.1.4 across the web UI per Decision 4
  (driven by `react-native-macos@0.81.7`'s exact peer pin on RN
  0.81.6). HA Add-on Dockerfile + run.sh drop `--frozen-lockfile`
  because the canonical bun.lock now lives at the repo root and isn't
  in the HA Add-on build context. M20+ (RN-CLI app, archive Tauri
  app/, RN audio bridges, keyboard extension) flow into the workspace
  shape this milestone established. Brief at
  `docs/phase-6/architecture-m19.md`; deps map at
  `docs/phase-6/research-ui-deps.md`.

**Phase 5 complete on source.** Phase 6 underway: M19 closed (this
commit), M20-M24 ahead. v0.phase-4 + v0.phase-5 tags pending
real-puck verification.

**Phase 4 complete on source** (M09-M15 + M13b). Waiting on
deploy-side acceptance (#124 puck OTA + #130 dictate round-trip,
plus a new discuss-engine sweep on both modes once the puck is
back) before tagging `v0.phase-4`.

Three queued homelab tasks: M01 deploy (rsync HA integration), M05b
firmware deploy. Both can land back-to-back next time the homelab is
reachable.

**Active tasks**: #120 M05b (queued, needs homelab). Phase 3
(M06-M08, Audio I/O port) not yet spun up as tasks — see
`docs/build-workflow.md` for the roadmap.

**Workflow doc** (`docs/build-workflow.md`) codifies: merge to main
per milestone without asking; test coverage required per milestone;
UI/UX audit agents (with personalities) spun up before any UI
merge. Five-persona starting cast: Marina, Sven, Priya, Wren, Caleb.

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

(As of M19 the repo is a bun workspace; the daemon and HA Add-on
build still live at `voix-backend/`, but UI source has lifted into
`packages/ui/`. The web UI's `voix-backend/ui/src/main.tsx` is the
only surviving file there — everything else is `@voix/ui` source.)

```
voix/
├── package.json                 ← bun workspace root (M19)
├── tsconfig.base.json           ← shared compiler options + @voix/* paths
├── bun.lock                     ← canonical lockfile (was per-workspace)
├── packages/
│   ├── protocol/                ← @voix/protocol — wire types
│   │   └── src/audio-io.ts      ← Hello + capability + events (v1)
│   └── ui/                      ← @voix/ui — shared React UI
│       └── src/
│           ├── App.tsx          ← Root section router
│           ├── components/      ← AppShell, Puck, Wordmark
│           ├── lib/             ← theme.ts, api.ts
│           ├── voices/          ← VoiceList, VoiceEditor
│           ├── conversations/   ← ConversationList, ConversationDetail,
│           │                      TalkButton, InlineAudioPlayer{,.native}
│           ├── surfaces/        ← SurfaceList
│           └── audio_io/        ← client.ts (web) + client.native.ts stub
├── clients/                     ← (created in M20: RN-CLI iOS + macOS)
├── voix-backend/                ← The daemon (Bun + Elysia + TS)
│   ├── src/
│   │   ├── index.ts             ← Entrypoint
│   │   ├── api/                 ← HTTP routes for the UI
│   │   │   ├── modes.ts         GET/PATCH /api/modes/*
│   │   │   ├── devices.ts       GET/PUT /api/devices/*
│   │   │   └── ha_sync.ts       ← Calls HA REST when haUrl+haToken set
│   │   ├── audio/               ← Resample + (vestigial) echo gate
│   │   ├── audio_io/protocol.ts ← One-line re-export of @voix/protocol
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
│   ├── ui/                      ← Thin Vite shell over @voix/ui (M19)
│   │   ├── package.json         ← depends on @voix/ui (workspace:*)
│   │   ├── vite.config.ts       ← Aliases react-native → react-native-web,
│   │   │                          + ignoreNativeSuffixes plugin,
│   │   │                          + vite-tsconfig-paths
│   │   ├── src/main.tsx         ← createRoot → <App/> from @voix/ui
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
