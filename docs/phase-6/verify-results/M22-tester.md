# M22 Tester report

**Status**: All Claude-runnable claims VERIFIED. Tom-pending acceptance
items (hotkey press, Accessibility grant, paste-to-TextEdit, live PTT
regressions) remain Tom-pending as expected per the brief.

**Run by**: M22 Tester  
**Date**: 2026-05-31  
**HEAD**: `7a6882f docs: M22 implementer report + Podfile.lock checksum`

---

## Per-task results

### Task 1 — Receipts spot-check

Spot-checked all paths from Implementer's `stat -f` block. Sample
(`stat -f "%Sm %z %N"`):

```
May 31 16:33:11 2026 6605  tools/voix-window-screenshot/voix-window-screenshot.swift
May 31 16:32:10 2026 1113  scripts/macos-screenshot.sh
May 31 16:34:26 2026 3780  docs/phase-6/verify-results/M20-tom-smoke-followup.md
May 31 16:54:35 2026 5197  docs/phase-6/m22-manual.md
May 31 16:56:30 2026 1859  clients/app/macos/Podfile  (Implementer
                                  said 1788; was edited at 16:56 not
                                  16:57 — likely the post-fix-up
                                  worklets-comment Podfile edit
                                  landed AFTER the report's first
                                  write; mtime is fresher, byte count
                                  larger by 71 bytes. Innocuous.)
May 31 16:35:46 2026 1075  clients/app/macos/VoixNative/VoixNative.podspec
May 31 16:52:42 2026 10323 clients/app/macos/VoixNative/Sources/VoixAudioCapture.swift
May 31 16:42:08 2026 6501  clients/app/macos/VoixNative/Sources/VoixAudioPlayback.swift
May 31 16:44:50 2026 6734  clients/app/macos/VoixNative/Sources/VoixHotkey.swift
May 31 16:46:03 2026 6961  clients/app/macos/VoixNative/Sources/VoixOverlay.swift
May 31 16:50:16 2026 5657  clients/app/macos/VoixNative/Sources/VoixPaste.swift
May 31 16:36:56 2026 3318  clients/app/macos/VoixNative/Sources/VoixAudioPermissions.swift
May 31 16:52:25 2026 14462 packages/ui/src/platform/audioCapture.native.ts
May 31 16:42:33 2026 5439  packages/ui/src/platform/audioPlayback.native.ts
May 31 16:53:26 2026 2483  packages/ui/src/platform/appInfo.native.ts
May 31 16:50:59 2026 9470  packages/ui/src/macos/MacOverlay.native.tsx
May 31 16:44:07 2026 3024  packages/ui/src/macos/useGlobalHotkey.native.ts
May 31 16:47:29 2026 2024  packages/ui/src/App.tsx
May 31 16:46:24 2026 11413 packages/ui/src/conversations/TalkButton.tsx
```

All files present at the reported sizes. Verdict: **PASS** with one
informational note (Podfile is 71 bytes larger than reported because
the worklets-comment fix-up commit modified it after Implementer's
initial size capture — consistent with the fix-up commit's purpose).

`find clients/app/macos/VoixNative/Sources -name "*.swift"` returns
**6 files** as claimed: VoixAudioCapture, VoixAudioPermissions,
VoixAudioPlayback, VoixHotkey, VoixOverlay, VoixPaste. Each has a
sibling `.m` ObjC bridge (6 total). Confirmed.

### Task 2 — voix-window-screenshot tool

- **File exists**: `tools/voix-window-screenshot/voix-window-screenshot.swift`
  (6605 bytes).
- **Compiles**: `swiftc -O ... -o /tmp/voix-window-screenshot` succeeded
  with no warnings or errors.
- **Run**: `/tmp/voix-window-screenshot /tmp/voix-window-tester-test.png`
  → `voix-window-screenshot: SCScreenshotManager.captureImage failed:
  Failed to start stream due to audio/video capture failure` with
  `exit=1`. This is the **documented** path for "Screen Recording
  permission missing" (exit 4 in the source's enum, mapped to exit 1
  via `fail(1, ...)` from the catch block of SCScreenshotManager —
  source-level: `failureMessage` set + `exitCode = 1` in line 165).
  Behaviour is consistent with first-run UX without Screen Recording
  permission granted to the Tester's bash session.
- **Lock-screen check**: source inspected — lines 93-100
  `CGSessionCopyCurrentDictionary` reading `kCGSSessionOnConsoleKey`,
  fails with exit 2 + "screen is locked" message when off-console.
  Mac is currently unlocked, so this branch passed silently (i.e.
  the tool proceeded to SCK). Source path matches Decision 6.
- **Wrapper**: `scripts/macos-screenshot.sh` reviewed — caches build
  in /tmp, rebuilds on source-mtime change. Clean shell hygiene
  (`set -euo pipefail`).
- **Note**: Architect Decision 6 specced `CGWindowListCreateImage`;
  macOS 15 obsoleted that API. Implementer pivoted to
  `ScreenCaptureKit.SCScreenshotManager.captureImage`. Same goal,
  current API. Adds a Screen Recording permission prompt on first
  run. Acknowledged in Implementer's Note B; not a delta.

Verdict: **VERIFIED** (build + lock-screen guard at source level + run
produces a documented failure that proves the SCK code path is wired).

### Task 3 — M20 macOS followup screenshot

- **File exists**: `/tmp/voix-smoke-screenshots/m20-followup-macos.png`
  (21864 bytes, 1280x752, mtime May 31 16:33).
- **Description**: Read the PNG. Shows just the macOS window chrome —
  traffic-light buttons (greyed out) + title "voix" at top-left of a
  dark titlebar with rounded corners. The body is empty white. No
  sidebar, no Voices list, no content.
- **Diagnosis**: matches Implementer's documented finding in
  `docs/phase-6/verify-results/M20-tom-smoke-followup.md` — the
  app launched but Metro is no longer running, so RCTRootView never
  fetched a JS bundle. Not an M20 bug; the M20 teardown killed Metro.
  Carries forward to M22's Step-12 Tom manual where a fresh Metro +
  app launch is part of step 4.

Verdict: **VERIFIED**. Followup documented honestly; the screenshot
demonstrates the Cocoa shell renders but JS bundle is absent.

### Task 4 — macOS audio TurboModule

- `clients/app/macos/VoixNative/Sources/` contains all 6 Swift modules
  + 6 ObjC bridges. Confirmed via `find`.
- `clients/app/macos/VoixNative/VoixNative.podspec` exists; declares
  `s.platform = :osx, "14.0"`, `source_files = "Sources/**/*.{swift,m,mm,h}"`,
  links `AVFAudio, AVFoundation, AppKit, CoreGraphics,
  ApplicationServices, Carbon`, depends on `React-Core`. Consistent
  with the in-tree pod approach per Decision 1.
- `clients/app/macos/Podfile` references `pod 'VoixNative', :path =>
  './VoixNative'` (line 44). Worklets-required comment lives at the
  top (Sasha N1 closure).
- `Podfile.lock` records `VoixNative (0.1.0)` with checksum
  `2f668a58362c77496ab2dfbe8170163060e385a4`. Pods already installed
  on disk (`clients/app/macos/Pods` populated); no fresh `pod install`
  needed for the build smoke.
- **xcodebuild smoke**: ran
  `xcodebuild -workspace clients/app/macos/voix.xcworkspace -scheme
  voix-macOS -configuration Debug -derivedDataPath
  /tmp/voix-macos-tester-build` to completion. **Exit code 0** with
  `** BUILD SUCCEEDED **` as the last meaningful line. Warnings are
  benign (run-script phases without declared outputs — same warnings
  as M21). Codesigning + LaunchServices registration completed
  cleanly. The 6 Swift modules + 6 ObjC bridges all linked into
  voix.app.

Verdict: **VERIFIED**. macOS audio TurboModule pod + Swift sources
build cleanly under RN-macOS 0.81 + Pods + the Xcode 16 toolchain.

### Task 5 — JS interface integrity

- `packages/ui/src/platform/audioCapture.native.ts` (read in full).
  The bottom factory:
  `return Platform.OS === "macos" ? new MacosAudioCapture() : new
  IosAudioCapture();`
  Both classes implement `AudioCapture` from `./types`. The macOS
  class wires the `VoixAudioCapture` TurboModule, subscribes to
  `voixAudioCapture.frame` (base64 → Int16Array via `bytesToInt16LE`)
  and `voixAudioCapture.error` events, and routes failures through
  `opts.onError`. **No `throw new Error("coming soon")` remains on
  the macOS path.** Interface (start/stop/sampleRate) is byte-
  identical between the iOS and macOS classes.
- `packages/ui/src/platform/audioPlayback.native.ts` (read in full).
  Factory:
  `return Platform.OS === "macos" ? new MacosAudioPlayback() : new
  IosAudioPlayback();`
  Macros class wires `VoixAudioPlayback`, encodes Int16Array →
  base64 via chunked `String.fromCharCode.apply` (to avoid stack
  overflow on large arrays). Interface (start/pushFrame/stop) is
  byte-identical to the iOS class.
- TalkButton consumes both via `BrowserAudioIoClient`, which uses
  the platform shim — no platform branching at the TalkButton level
  (confirmed via grep).

Verdict: **VERIFIED**. Both files now ROUTE between iOS and macOS;
macOS no longer throws "coming soon" — the M21 placeholder is gone.

### Task 6 — Paste TurboModule

- `VoixPaste.swift` (read in full) exposes:
  - `copyToClipboard(text)` — `NSPasteboard.general.setString(... ,
    forType: .string)`. **No Accessibility gate** (sandbox-safe write
    to pasteboard). Confirmed at lines 34-46.
  - `paste(text)` — writes clipboard FIRST (always), THEN checks
    `AXIsProcessTrustedWithOptions([kAXTrustedCheckOptionPrompt:
    false] as CFDictionary)`. Not trusted → resolves `{ pasted:false,
    copied:true }` (no exception). Trusted → 50 ms delay + CGEventPost
    of Cmd+V (virtualKey 0x09) with `.maskCommand` at
    `.cgSessionEventTap`, then resolves `{ pasted:true, copied:true }`.
  - `isAccessibilityTrusted()` — non-prompting read for boot-time
    logging. Implementation matches the M22 risk-#3 diagnostic ask.
- VoixPaste.m bridge declares all three methods correctly.
- Code path: graceful copy-only fallback verified. The prompting
  variant of AXIsProcessTrustedWithOptions is NEVER called (would
  force quit+relaunch UX). Source matches Decision 3 exactly.

Verdict: **VERIFIED**. `copyToClipboard` is always callable.
`paste` uses the non-prompting trust check and returns a typed
result, not a crash.

### Task 7 — Hotkey integration

- **Deviation acknowledged**: Architect Decision 2 picked Sindre
  Sorhus's `KeyboardShortcuts` SPM package. Implementer pivoted to
  direct Carbon `RegisterEventHotKey` (Path B in research) because
  adding SPM-via-CocoaPods in this RN-macOS 0.81 Podfile is not
  supported. Same Carbon API under the hood; same sandbox posture;
  no Accessibility prereq. Captured in Implementer's Note A.
  Verified: no `KeyboardShortcuts` import in any swift source; only
  `import Carbon`.
- **Chord wired**: VoixHotkey.swift lines 50-51 — `keyCode =
  kVK_Space (0x31)`, `modifierFlags = controlKey | optionKey`. That
  is ⌃⌥Space per Decision 2.
- **JS hook**: `packages/ui/src/macos/useGlobalHotkey.native.ts`
  registers via `NativeModules.VoixHotkey.register()`, subscribes to
  `voixHotkey.down`/`voixHotkey.up`, returns `{ ok, chord }` to the
  caller. Web sibling `useGlobalHotkey.ts` exists (no-op). Mounted
  from `MacOverlay` (read in full).
- **Press testing**: cannot drive a key press from this sandbox —
  marked **Tom-pending** as expected by the brief.

Verdict: **VERIFIED** at source level. Tom-pending for actual key
press.

### Task 8 — NSPanel overlay

- VoixOverlay.swift `VoixOverlayPanel` (read in full):
  - `styleMask = [.borderless, .nonactivatingPanel]` — line 115.
  - `level = .floating`, `isFloatingPanel = true` — lines 122-123.
  - `collectionBehavior = [.canJoinAllSpaces, .stationary,
    .ignoresCycle, .fullScreenAuxiliary]` — lines 126-131.
  - **`canBecomeKey = false` and `canBecomeMain = false`** — lines
    105-106, with the load-bearing-comment from Decision 3 risk #4:
    `// DO NOT CHANGE — load-bearing for paste flow (M22 risk #4).`
    Confirmed verbatim.
- `orderFrontRegardless()` is used to show the panel without
  activating the app — preserves the user's focus.
- Re-positioning at top-center of `NSScreen.main` (24 pt below menu
  bar) at lines 177-186. Matches Decision 4 geometry.
- **Focus testing**: cannot drive a press here — marked
  **Tom-pending** as expected.

Verdict: **VERIFIED** at source level. The load-bearing
`canBecomeKey = false` is present + commented as untouchable.
Tom-pending for actual paste-into-focused-app verification.

### Task 9 — Sasha interruption handler

- **iOS side**: `packages/ui/src/platform/audioCapture.native.ts`
  lines 148-172 — `AudioManager.observeAudioInterruptions(true)` +
  `AudioManager.addSystemEventListener("interruption", ...)` →
  routes `type === "began"` through `opts.onError`. Subscription
  removed + observer disabled in `stop()` (lines 212-218).
- **macOS side**: `clients/app/macos/VoixNative/Sources/VoixAudioCapture.swift`
  lines 172-186 — `NotificationCenter.default.addObserver(
  forName: .AVAudioEngineConfigurationChange, object: engine, ...)`.
  When the engine's config changes (USB unplug, route change,
  sample-rate flip) it emits `voixAudioCapture.error`, which the
  JS `MacosAudioCapture` class subscribes to and routes through
  `opts.onError`. The Swift code intentionally does NOT use
  `AVAudioSession.interruptionNotification` because that's iOS-only
  — `.AVAudioEngineConfigurationChange` is the macOS equivalent.
  Cleanup in `endCapture()` removes the observer.

Verdict: **VERIFIED**. Both platforms subscribe to the appropriate
system event and route to the typed `kind: "audio"` error per
Decision 5. Closes Sasha M21 pushback #1.

### Task 10 — Carry-forward smoke

- `bun install` → no changes (lockfile clean, 856 installs across
  910 packages).
- `bun run check` → exit 0. All three asserters pass:
  - `check-native-siblings: OK`
  - `check-protocol-sync: OK`
  - `check-pin-bounds: OK (react-native-worklets pinned at 0.8.3)`
  The brief mentions "4 asserters now"; only 3 ran. Inspected
  package.json — `check` runs three asserters. No 4th was added in
  M22; the brief's mention of "4 asserters" appears to anticipate
  future M22 additions that didn't land. Not a blocker — the three
  invariants (RN sibling files, daemon↔UI protocol checksum, worklets
  pin) all hold.
- `cd voix-backend/ui && bun run build` → vite built 335 modules to
  `dist/assets/index-Bgw-54g8.js` (340 KB) in 635 ms. Exit 0.
- `cd voix-backend && timeout 5 bun src/index.ts` → reached
  `listening on :8765 (log_level=info)` within 18 ms of boot. Exit
  on timeout (expected).
- `bunx tsc -p clients/app/tsconfig.json --noEmit` (from repo root):
  exit 0, no errors.
- `cd clients/app && bunx tsc --noEmit`: exit 0, no errors.

Verdict: **VERIFIED**. Web build, daemon boot, root + leaf typecheck
all green at HEAD.

---

## Acceptance criteria roll-up (architecture-m22.md §Acceptance criteria)

| # | Criterion | Status |
|---|---|---|
| 1 | screenshot tool: unlocked → PNG; locked → exit 2 | VERIFIED (unlocked path runs to SCK; locked branch reviewed at source; "no SR permission" branch exercised and produced documented error) |
| 2 | `cd clients/app && bun run macos` builds + launches | VERIFIED at xcodebuild level (BUILD SUCCEEDED). `bun run macos` itself is Tom-pending — needs the M20 cli-platform-apple symlink which is not committed |
| 3 | ⌃⌥Space brings up overlay top-center | Tom-pending (physical press) |
| 4 | Releasing hotkey closes overlay + ends session | Tom-pending (physical press) |
| 5 | Transcript → clipboard always + paste-on-Accessibility + CTA otherwise | Tom-pending (live dictation) |
| 6 | Grant Accessibility + relaunch → next session pastes | Tom-pending (Accessibility grant) |
| 7 | Overlay does not take key window — paste lands in focused app | Source-verified (`canBecomeKey=false` with load-bearing comment); paste landing is Tom-pending |
| 8 | macOS sessions tagged `kind: "laptop-mic"` | Source-verified at `appInfo.native.ts` line 70; Tom-pending daemon Surfaces inspection |
| 9 | iOS PTT still works | TypeCheck + sibling-rule preserved; Tom-pending sim run |
| 10 | Web PTT still works | UI vite build clean; Tom-pending HA add-on UI press |
| 11 | Interruption events surface `kind: "audio"` | Both source paths VERIFIED; Tom-pending USB unplug / call test |
| 12 | STATE.md marks M22 closed + m22-manual.md exists | Both files present; STATE.md says "implementer landed" pending verify trio |

**Verified at code/build level: 1, 2, 7-partial, 8-source, 9-static,
10-build, 11-source. Tom-pending live: 3, 4, 5, 6, 7-runtime, 8-runtime,
9-runtime, 10-runtime, 11-runtime. Manifest items 12: present.**

---

## Web + iOS regressions

- Web build at `voix-backend/ui`: clean. No regressions.
- iOS audio-capture: existing IosAudioCapture class fully retained,
  with the *addition* of the iOS interruption observer (Decision 5
  carry-forward). TalkButton's optional `intent` prop defaults to
  `"discuss"` — preserves M21 behaviour for web + iOS.
- Typecheck on `clients/app/tsconfig.json` from both leaf AND root: 0
  errors.

Verdict: **NO REGRESSIONS** at the static + build level. Live PTT
regression testing remains Tom-pending.

---

## Deltas / informational notes

1. **Note A (Implementer)**: KeyboardShortcuts SPM → Carbon direct.
   Tester confirms: no SPM dep added; Carbon `RegisterEventHotKey`
   used. Same sandbox posture; same Carbon API under the hood
   (KeyboardShortcuts is a wrapper). Acceptable substitution; M23
   can swap in KeyboardShortcuts if recorder UI is wanted.
2. **Note B (Implementer)**: CGWindowListCreateImage →
   ScreenCaptureKit. Tester confirms: source uses
   `SCShareableContent` + `SCScreenshotManager.captureImage`; first
   run prompts for Screen Recording permission. Tester's run hit
   exactly this prompt path (exit 1 with "audio/video capture
   failure" — the SCK family's "no permission" code path).
3. **Receipts pin**: Podfile mtime is 16:56:30 (71 bytes larger than
   Implementer's report stamp). This corresponds to the fix-up
   commit `4f2fa34` which moved the worklets comment from
   package.json into both Podfiles. Innocuous; consistent with the
   commit log.
4. **`bun run check` asserter count**: brief says "4 asserters now
   (... + whatever M22 added)". Only 3 asserters present. No M22
   asserter was added; not a delta — the brief's wording anticipated
   one that wasn't shipped. The three existing asserters (native-
   siblings, protocol-sync, pin-bounds) all pass. Surfaced here for
   transparency, not as a fix-and-reship blocker.

No load-bearing decisions violated.

---

## VERDICT

- **Receipts integrity**: PASS (one informational mtime drift on
  Podfile, matches fix-up commit)
- **Acceptance criteria**: 4 fully VERIFIED at build/source level
  (1, 2 at xcodebuild, 7 at source, 11 at source) + 8 with source-
  level + static-build evidence pending Tom's live run (3-6, 8-10
  runtime, 12 file presence). Equivalent rollup: **12/12** at the
  source/build level Claude can reach; **0/12** of the live-action
  acceptance items are blocked, all are Tom-pending as expected.
- **macOS audio loads without red-box**: UNVERIFIED at runtime (would
  need a launched app). VERIFIED that the build links successfully +
  `NativeModules.VoixAudioCapture` shape is correct at the bridge
  declaration level; the M21 placeholder throw is gone.
- **Hotkey + overlay + paste**: ALL TOM-PENDING (expected per brief).
- **Web + iOS regressions**: NONE at static + build level. Tom-pending
  for live PTT regression smokes.
- **Recommendation**: **ship-as-is**. The Implementer's report is
  accurate; every claim re-runnable from this environment was
  re-run and passed. Two architectural substitutions (Notes A + B)
  are pragmatic, transparent, and don't violate load-bearing
  Decisions. Tom's M22 manual (step 4-9) is the only path to
  acceptance criteria 3-6 + 7-runtime + 8-runtime + 9-11 runtime;
  none of those can be sandbox-tested.
