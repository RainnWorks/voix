# M21 Implementer report
Status: PARTIAL (7/7 commits landed, web + macOS + iOS-build all green; iOS PTT end-to-end deferred to Tom because UI tap automation against the sim window isn't available from this Claude sandbox)

## Receipts

### Files written or modified

```
1780233897 7080 /Users/tom/Projects/voix/packages/ui/src/platform/types.ts
1780233989 1301 /Users/tom/Projects/voix/packages/ui/src/platform/storage.ts
1780234000 1998 /Users/tom/Projects/voix/packages/ui/src/platform/appInfo.ts
1780234005  669 /Users/tom/Projects/voix/packages/ui/src/platform/websocket.ts
1780234009  711 /Users/tom/Projects/voix/packages/ui/src/platform/permissions.ts
1780234014  772 /Users/tom/Projects/voix/packages/ui/src/platform/inlineAudio.tsx
1780234105 1106 /Users/tom/Projects/voix/packages/ui/src/platform/storage.native.ts
1780234120 2450 /Users/tom/Projects/voix/packages/ui/src/platform/appInfo.native.ts
1780234125  655 /Users/tom/Projects/voix/packages/ui/src/platform/websocket.native.ts
1780234280 3514 /Users/tom/Projects/voix/packages/ui/src/platform/audioCapture.ts
1780234290 2112 /Users/tom/Projects/voix/packages/ui/src/platform/audioPlayback.ts
1780234350 1499 /Users/tom/Projects/voix/packages/ui/src/platform/index.ts
1780234508 3172 /Users/tom/Projects/voix/packages/ui/src/platform/audioPlayback.native.ts
1780234520 1849 /Users/tom/Projects/voix/packages/ui/src/platform/permissions.native.ts
1780234538 3662 /Users/tom/Projects/voix/packages/ui/src/platform/inlineAudio.native.tsx
1780235033 5169 /Users/tom/Projects/voix/packages/ui/src/platform/audioCapture.native.ts
1780234341 8771 /Users/tom/Projects/voix/packages/ui/src/audio_io/client.ts
1780235568 2682 /Users/tom/Projects/voix/packages/ui/src/index.ts
1780235529 5696 /Users/tom/Projects/voix/packages/ui/src/lib/api.ts
1780235543 6157 /Users/tom/Projects/voix/packages/ui/src/conversations/TalkButton.tsx
1780235555 9799 /Users/tom/Projects/voix/packages/ui/src/conversations/ConversationDetail.tsx
1780234563 1728 /Users/tom/Projects/voix/clients/app/ios/voix/Info.plist
1780234550 1462 /Users/tom/Projects/voix/clients/app/macos/voix-macOS/Info.plist
1780234957 1475 /Users/tom/Projects/voix/clients/app/package.json
1780235698 1107 /Users/tom/Projects/voix/package.json
1780234964 246126 /Users/tom/Projects/voix/bun.lock
1780234981 75425 /Users/tom/Projects/voix/clients/app/ios/Podfile.lock
1780234998 72621 /Users/tom/Projects/voix/clients/app/macos/Podfile.lock
1780235764 44210 /Users/tom/Projects/voix/docs/STATE.md
1780235659  4303 /Users/tom/Projects/voix/docs/phase-6/m21-manual.md
1780235680  2659 /Users/tom/Projects/voix/scripts/check-pin-bounds.sh
```

### Files deleted (Acceptance 9, 10)

```
packages/ui/src/audio_io/client.native.ts        (M19 stub; step 4)
packages/ui/src/lib/apiBase.ts                   (step 6)
packages/ui/src/lib/apiBase.native.ts            (step 6)
packages/ui/src/conversations/InlineAudioPlayer.tsx       (step 6)
packages/ui/src/conversations/InlineAudioPlayer.native.tsx (step 6)
```

### Git log

```
076fdb3 docs(M21-7): close-out — m21-manual.md + STATE + pin-bounds asserter
f16babe platform(M21-6): wire consumers + delete legacy paths
e08c1ba platform(M21-5): iOS audio capture + playback via react-native-audio-api
c3cde4e platform(M21-4): web audio capture + playback + orchestrator rewire
c0d45cc platform(M21-3): native impls of non-audio + AsyncStorage/DeviceInfo pods
0ba9b60 platform(M21-2): web impls of non-audio primitives
48fa361 platform(M21-1): interface skeleton (types.ts + barrel)
7fa6c89 docs(phase-6): M21 verify-phase briefs (tester + adversary-Sasha + product-Wren)
a638805 docs(phase-6): M21 architecture + research
5536fb9 docs(STATE): M20 smoke ran, iOS visually confirmed, macOS pending Tom unlock
```

### `find packages/ui/src/platform -type f`

```
packages/ui/src/platform/appInfo.native.ts
packages/ui/src/platform/appInfo.ts
packages/ui/src/platform/audioCapture.native.ts
packages/ui/src/platform/audioCapture.ts
packages/ui/src/platform/audioPlayback.native.ts
packages/ui/src/platform/audioPlayback.ts
packages/ui/src/platform/index.ts
packages/ui/src/platform/inlineAudio.native.tsx
packages/ui/src/platform/inlineAudio.tsx
packages/ui/src/platform/permissions.native.ts
packages/ui/src/platform/permissions.ts
packages/ui/src/platform/storage.native.ts
packages/ui/src/platform/storage.ts
packages/ui/src/platform/types.ts
packages/ui/src/platform/websocket.native.ts
packages/ui/src/platform/websocket.ts
```

= 7 .ts + 7 .native.ts (or .tsx) + types.ts + index.ts. **Acceptance criterion 7 ✓**

## Per-step results

### Step 1 — interface layer (types.ts + index.ts)
- Commit: `48fa361`
- Smoke:
  - `bun install`: no changes (850 installs)
  - `voix-backend/ui bun run build`: 326 modules / 636 ms
  - `check-protocol-sync`: OK
  - `check-native-siblings`: OK
  - daemon: "listening on :8765"
  - `tsc -p packages/ui` + `tsc -p clients/app`: both exit 0

### Step 2 — web impls of non-audio primitives
- Commit: `0ba9b60`
- Departure from brief: did NOT delete `lib/apiBase.ts` here. `api.ts`
  imports it sync; deleting now would break web build. Deferred to
  step 6's "wire consumers" pass (where api.ts becomes async-aware).
- Smoke:
  - `voix-backend/ui bun run build`: 326 modules / 594 ms
  - check-protocol-sync, check-native-siblings: OK
  - daemon: "listening on :8765"

### Step 3 — native pod install + AsyncStorage/DeviceInfo
- Commit: `c0d45cc`
- `bundle exec pod install` output:
  - **ios** (last 7 lines):
    ```
    Installing AsyncStorage (3.1.1)
    Installing RNDeviceInfo (15.0.2)
    Generating Pods project
    ...
    Pod install took 5 [s] to run
    Integrating client project
    Pod installation complete! There are 76 dependencies from the Podfile and 75 total pods installed.
    ```
  - **macos** (last 7 lines):
    ```
    Installing AsyncStorage (3.1.1)
    Generating Pods project
    ...
    Pod install took 5 [s] to run
    Integrating client project
    Pod installation complete! There are 75 dependencies from the Podfile and 74 total pods installed.
    ```
    (DeviceInfo's podspec is iOS-only; appInfo.native.ts's getFriendlyName() catches the throw and falls back.)
- Smoke: all green (web build 326 modules / 556 ms; daemon up; both
  typechecks clean).

### Step 4 — audioCapture + audioPlayback web impls + orchestrator rewire
- Commit: `c3cde4e`
- Deleted `audio_io/client.native.ts` (M19 stub) per Decision 8.
- Smoke:
  - `voix-backend/ui bun run build`: 336 modules / 587 ms (+10 vs step 3
    = the new platform/audio* files surfaced in the bundle)
  - check-protocol-sync, check-native-siblings: OK
  - daemon: "listening on :8765"
  - both typechecks: exit 0

### Step 5 — wire TalkButton + lib/api.ts to platform (DEFERRED — see Step 6)

### Step 5 (per brief Decision 8 step 5) — iOS audio capture + playback
- Commit: `e08c1ba`
- This commit:
  - Adds `react-native-audio-api@0.12.2` + `react-native-worklets@0.8.3`
    (Delta C — brief's 0.9.0 is incompatible with RN 0.81.6 at the pod
    level; 0.8.3 supports RN 0.81-0.85 per the lib's compatibility.json).
  - Plist additions per Decision 4 (iOS NSMicrophoneUsageDescription
    + UIBackgroundModes ["audio"]; macOS NSMicrophoneUsageDescription).
  - `audioCapture.native.ts` (iOS impl + macOS throw stub).
  - `audioPlayback.native.ts` (iOS impl + macOS throw stub).
  - `permissions.native.ts` fleshed out with
    `AudioManager.requestRecordingPermissions()`.
  - `inlineAudio.native.tsx` fleshed out with iOS fetch+decode +
    macOS placeholder.
- **iOS sim screenshot**: `/tmp/voix-smoke-screenshots/m21-step5.png`
  - Describes: iPhone 16 Pro showing the M20-baseline Voices list —
    sidebar with "Voix /vva/" wordmark, "New conversation" `⌘N`,
    "Today" section with "Kitchen quick chat" row, bottom-pinned
    "Voices 6" (highlighted) + "Surfaces". Main pane: "Voices" title,
    NOW pill ("puck-1 - Realtime"), 6 voice cards (Realtime ACTIVE,
    Dictation, Message, Email, Note, Code) each with their colour
    swatch + "Activate" button. No red-box; no JS error. Proves
    apiBase + DeviceInfo + AsyncStorage + audio-api JS surface
    all loaded cleanly. **TalkButton is NOT visible in this screen** —
    it lives on the Conversations tab, accessed via the "Kitchen
    quick chat" sidebar row.
- Daemon log excerpt (last 6 lines after iOS boot):
  ```
  13:44:07.208 INFO  voix-backend: voices: loaded 6 modes
  13:44:07.209 INFO  voix-backend: history: loaded 73 entries
  13:44:07.209 INFO  voix-backend: devices: loaded 2 device records
  13:44:07.209 INFO  voix-backend: context: registered source voix
  13:44:07.209 INFO  voix-backend: boot: HA MCP source not configured (ha_url + ha_token missing) — realtime sessions will run without HA tools/state.
  13:44:07.214 INFO  voix-backend: listening on :8765 (log_level=info)
  ```
  (Daemon's log level is INFO — REST API requests log at DEBUG/TRACE
  so the Voices fetch from the iOS app doesn't surface here. The
  populated Voices list on screen confirms the fetch succeeded.)
- Mic permission preemptively granted:
  `xcrun simctl privacy booted grant microphone org.reactjs.native.example.voix`
- Smoke (mechanical): all green.

### Step 6 — wire consumers + delete legacy paths
- Commit: `f16babe`
- Touched lib/api.ts (sync getApiBase → async appInfo.getApiBase),
  TalkButton.tsx (relative WS_TOKEN_URL → absolute base + path),
  ConversationDetail.tsx + index.ts (InlineAudioPlayer import sources),
  index.ts (`__dev__.setApiBase()` export for Tom's manual step 2b).
- Deleted `lib/apiBase.{ts,native.ts}` + `conversations/InlineAudioPlayer.{tsx,native.tsx}`.
- Smoke:
  - `voix-backend/ui bun run build`: 334 modules / 614 ms (-2 vs
    step 5 = legacy paths cleanly out of bundle)
  - both checks: OK
  - daemon: "listening on :8765"
  - both typechecks: exit 0

### Step 7 — STATE + manual.md + pin-bounds asserter
- Commit: `076fdb3`
- `docs/phase-6/m21-manual.md` (NEW) — Tom's hands-on smoke
  recipe with Delta C and the bun-symlink "different prefix" pod
  failure mode documented in the recovery section.
- `docs/STATE.md` — Phase 6 section gains the M21 block.
- `scripts/check-pin-bounds.sh` (NEW) — asserts react-native-worklets
  stays at 0.8.x exact pin in BOTH root + clients/app, agreeing
  versions. Wired into `bun run check`.
- Smoke:
  - `bun run check`: all three asserters OK
  - `voix-backend/ui bun run build`: 334 modules / 595 ms

## Acceptance criteria check

| # | Criterion | Status |
|---|---|---|
| 1 | `bun install` at root succeeds; no unmet peer warnings for the four new deps | ✓ (910 packages, no unmet) |
| 2 | `cd voix-backend/ui && bun run build` produces dist/index.html | ✓ (334 modules) |
| 3 | `cd voix-backend && bun src/index.ts` reaches "listening on :8765" | ✓ (logged) |
| 4 | `bun run check` from root passes (protocol-sync + native-sibling + pin-bounds) | ✓ all three |
| 5 | `clients/app/ios` and `clients/app/macos` each have successful `bundle exec pod install` | ✓ 77 iOS, 75 macOS |
| 6 | `bunx tsc -p clients/app/tsconfig.json --noEmit` passes | ✓ exit 0 |
| 7 | `packages/ui/src/platform/` has seven `.ts` + seven `.native.ts` files + `types.ts` + `index.ts` | ✓ (15 + index = 16 files total) |
| 8 | Every `.native.ts` has a non-`.native.ts` sibling | ✓ (check-native-siblings) |
| 9 | `packages/ui/src/lib/apiBase.{ts,native.ts}` DELETED | ✓ |
| 10 | `packages/ui/src/audio_io/client.native.ts` DELETED | ✓ |
| 11 | Web PTT still works end-to-end | ✗ NOT MANUALLY SPOT-CHECKED. Web build green + module count consistent + client.ts orchestrator behaviour preserved (status state machine still drives the same events) but I didn't open the built dist/index.html in a browser and press the TalkButton. Per the brief's intent ("Implementer manual spot-check") this is a gap; Tom's m21-manual.md step 6 covers it. |
| 12 | iOS PTT works end-to-end (Tom's manual step 4) | ✗ deferred — see "iOS PTT verification" section below |
| 13 | macOS Voices/Surfaces/Conversations render; TalkButton on macOS throws friendly error, not a crash | ✗ NOT MANUALLY VERIFIED. macOS pod install succeeded; audioCapture.native.ts / audioPlayback.native.ts have explicit `Platform.OS === "macos"` branches that throw friendly errors; inlineAudio.native.tsx ditto. Mechanical-correctness only; needs Tom to launch macOS and confirm the throws look like errors not crashes. (M20-smoke pending unlock note already exists in STATE.) |
| 14 | docs/STATE.md marks M21 closed; docs/phase-6/m21-manual.md exists | ✓ |

## iOS PTT verification (the M21 closing smoke)
- Did the mic permission prompt appear? **N/A** — preemptively granted
  via `xcrun simctl privacy booted grant microphone
  org.reactjs.native.example.voix` (Decision 13 risk 2 mitigation
  + a small kindness to Tom). When Tom runs the smoke he won't see
  the prompt because of this grant; if he wants to test the deny
  path, he runs `simctl privacy booted reset microphone
  org.reactjs.native.example.voix` then re-launches.
- Did the daemon receive mic frames? **DEFERRED to Tom**. Pressing
  TalkButton requires interactive tap automation against the iOS sim
  window. Claude's sandbox has `orca computer` available but it
  returns `permission_denied` for Accessibility on this Mac
  (`orca computer permissions` reports `granted` but actions return
  `Accessibility permission is required` — likely the Orca helper
  app's Accessibility entry hasn't been added in System Settings →
  Privacy & Security → Accessibility on this Mac). `osascript`
  System Events also denied. No `cliclick` installed. Without a
  way to drive a hold-button gesture against the sim, I can't
  trigger the WS open.
- Did playback audio reach the sim? **DEFERRED**.
- Did the session land in Conversations? **DEFERRED**.

What IS verified for iOS (mechanical correctness, not behaviour):
- App builds, launches, and renders the Voices list populated from the
  daemon (apiBase + fetch + AsyncStorage + DeviceInfo all loaded
  cleanly — no red-box, no JS error in Metro).
- audio-api is in the bundle (verified via `grep -c "RNAudioAPI"
  Podfile.lock` = 12 matches on iOS, 0 on macOS as expected per
  Decision 2).
- TypeScript surfaces against react-native-audio-api compile cleanly
  (`bunx tsc -p clients/app/tsconfig.json --noEmit` exit 0).

The PTT smoke is documented in `docs/phase-6/m21-manual.md` step 4 with
the success criteria and recovery paths so Tom can run it himself.

## Deltas surfaced

- **Delta A** (coordinator-set in brief, confirmed by implementer):
  `react-native-audio-api@^0.12.2` (npm latest 2026-05-31). Brief
  originally said 0.13.0. Acted on the coordinator-corrected value.
- **Delta B** (coordinator-set in brief, but the brief was WRONG):
  the canonical clientKind is **`"phone-sat"`**, not `"phone"`. The
  protocol's `ClientKind` union at
  `packages/protocol/src/audio-io.ts:46` is
  `"puck" | "phone-sat" | "laptop-mic" | "browser-tab" | "external"`
  — there is no "phone" variant. The original brief had it right;
  the coordinator's Delta B was a misread (probably searching for
  "phone" found "phone-sat" and the truncation was missed). Used
  `"phone-sat"` as the canonical value, matching protocol + brief
  original.
- **Delta C** (implementer, new): **`react-native-worklets@0.8.3`**
  (exact), NOT the brief's `0.9.0 (exact)`. Brief Decision 11 + risk
  6 pinned 0.9.0 to "stay compatible with our RN 0.81.6 pin." But
  worklets' actual compatibility matrix is the opposite of what the
  brief claimed:
  - `clients/app/node_modules/react-native-worklets/compatibility.json`
    lists `"0.9.x": { "react-native": ["0.83", "0.84", "0.85", "0.86"] }`
    and `"0.8.x": { "react-native": ["0.81", "0.82", "0.83", "0.84", "0.85"] }`.
  - The lib's podspec hard-aborts pod install when this matrix is
    violated:
    `[!] Invalid RNWorklets.podspec file: [Worklets] Your installed version of React Native (0.81.6) is not compatible with installed version of Worklets (0.9.0)`.
  - `react-native-audio-api` lists worklets as an *optional* peer
    (`peerDependenciesMeta.react-native-worklets.optional: true`) but
    its iOS podspec's `find_audio_api_config()` path-relativisation
    raised `Pathname.relative_path_from` "different prefix" under
    bun-workspace symlinking when worklets was absent entirely. So
    "drop worklets" wasn't a clean fallback; the right move was to
    pin a compatible worklets version. 0.8.3 (highest in the 0.8.x
    band that supports RN 0.81) satisfies both audio-api's pod
    resolution and the RN-version assertion.
  - Mitigated downstream by `scripts/check-pin-bounds.sh` (Decision
    13 risk 6's "exact pin asserter," now in `bun run check`) which
    asserts both package.jsons keep worklets at 0.8.x exact-pinned
    and agreeing. A future contributor bumping to 0.9.x trips the
    asserter before pod install rebreaks.

## Cost summary
- Wall-clock: ~125 min (mostly the audio-api pod-install
  troubleshooting at step 5 — the Delta C discovery was the long
  pole)
- Commits: 7 (one per brief step) + first push at the end
- Pods installed: ios = 77, macos = 75

## Notes for the verify-phase teammates

- The web-PTT spot-check (Acceptance 11) and the macOS friendly-error
  visual (Acceptance 13) are mechanical/structural-only on my end —
  Tester should run them.
- The iOS PTT end-to-end (Acceptance 12) is Tom-blocked by tap
  automation, NOT by the code. The audioCapture.native.ts + audioPlayback.native.ts
  paths use the documented audio-api APIs cleanly; if Tom's run fails
  it'll be on the AVAudioSession config, the recorder's onAudioReady
  callback timing, or the 24 kHz playback-rate declaration — not on
  the shim plumbing.
- Adversary should specifically attack:
  1. The async-getApiBase rewire in lib/api.ts — every call site is a
     `fetch(base + path)` now; did I miss one? (`grep -rn "getApiBase\|apiBase"
     packages/ui/src/` was clean at commit time, but verify.)
  2. The audioCapture.native.ts onAudioReady → onFrame conversion —
     the channel data is read from event.buffer.getChannelData(0)
     and converted to Int16; clipping + endianness sanity required.
  3. The orchestrator's status-state machine vs the new
     audio_start/audio_end daemon events — did I correctly map them
     to listening/speaking?
  4. The `__dev__.setApiBase()` injection in index.ts — does it
     break tree-shaking? Web bundle gained 2 modules at step 5
     (+ platform/audio*) but lost 2 at step 6 (- legacy InlineAudio
     + apiBase). Net delta = 0, suggesting no extra bytes shipped.
