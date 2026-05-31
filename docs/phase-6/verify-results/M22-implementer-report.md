# M22 Implementer report

**Status**: SUCCESS

Twelve commits + one fix-up landed per architecture-m22.md Decision 7.
All build smokes green; full Tom-day verification is pending the
hands-required steps (hotkey press, Accessibility grant, paste-to-
TextEdit).

## Receipts

`stat -f "%Sm %z %N"` for every file written/modified:

```
May 31 16:33:11 2026  6605  tools/voix-window-screenshot/voix-window-screenshot.swift
May 31 16:32:10 2026  1113  scripts/macos-screenshot.sh
May 31 16:34:26 2026  3780  docs/phase-6/verify-results/M20-tom-smoke-followup.md
May 31 16:54:35 2026  5197  docs/phase-6/m22-manual.md
May 31 16:55:28 2026  51515 docs/STATE.md
May 31 16:57:18 2026  1788  clients/app/macos/Podfile
May 31 16:57:18 2026  609   clients/app/ios/Podfile  (worklets comment header)
May 31 16:35:46 2026  1075  clients/app/macos/VoixNative/VoixNative.podspec
May 31 16:52:42 2026  10323 clients/app/macos/VoixNative/Sources/VoixAudioCapture.swift
May 31 16:36:21 2026  936   clients/app/macos/VoixNative/Sources/VoixAudioCapture.m
May 31 16:42:08 2026  6501  clients/app/macos/VoixNative/Sources/VoixAudioPlayback.swift
May 31 16:36:38 2026  638   clients/app/macos/VoixNative/Sources/VoixAudioPlayback.m
May 31 16:36:56 2026  3318  clients/app/macos/VoixNative/Sources/VoixAudioPermissions.swift
May 31 16:37:02 2026  708   clients/app/macos/VoixNative/Sources/VoixAudioPermissions.m
May 31 16:44:50 2026  6734  clients/app/macos/VoixNative/Sources/VoixHotkey.swift
May 31 16:43:47 2026  434   clients/app/macos/VoixNative/Sources/VoixHotkey.m
May 31 16:46:03 2026  6961  clients/app/macos/VoixNative/Sources/VoixOverlay.swift
May 31 16:46:08 2026  627   clients/app/macos/VoixNative/Sources/VoixOverlay.m
May 31 16:50:16 2026  5657  clients/app/macos/VoixNative/Sources/VoixPaste.swift
May 31 16:50:22 2026  628   clients/app/macos/VoixNative/Sources/VoixPaste.m
May 31 16:52:25 2026  14462 packages/ui/src/platform/audioCapture.native.ts
May 31 16:42:33 2026  5439  packages/ui/src/platform/audioPlayback.native.ts
May 31 16:53:26 2026  2483  packages/ui/src/platform/appInfo.native.ts
May 31 16:50:59 2026  9470  packages/ui/src/macos/MacOverlay.native.tsx
May 31 16:47:02 2026  209   packages/ui/src/macos/MacOverlay.tsx
May 31 16:44:07 2026  3024  packages/ui/src/macos/useGlobalHotkey.native.ts
May 31 16:44:14 2026  590   packages/ui/src/macos/useGlobalHotkey.ts
May 31 16:47:29 2026  2024  packages/ui/src/App.tsx
May 31 16:46:24 2026  11413 packages/ui/src/conversations/TalkButton.tsx
May 31 16:57:18 2026  1316  clients/app/package.json
```

### `git log --oneline -16`

```
4f2fa34 clients/app(M22 fix): move worklets-required note out of package.json
d9f5257 docs: M22 close-out — manual + STATE
1994c59 clients/app(M22): clientKind laptop-mic + worklets-required comment
f5628f5 clients/app(M22): interruption observer (both platforms)
4e3ee9b clients/app(M22): CGEventPost + Accessibility detection
9837d6a clients/app(M22): VoixPaste + clipboard write
c344fbb clients/app(M22): NSPanel overlay + MacOverlay
7e0079a clients/app(M22): KeyboardShortcuts bridge + global hotkey
96fc0c9 clients/app(M22): macOS AVAudioPlayerNode playback
d5e706e clients/app(M22): macOS AVAudioEngine capture
3bfd38a clients/app(M22): macOS audio module skeleton
4cde983 verify: M20 macOS visual baseline followup
b9af44f tools: voix-window-screenshot for macOS verify
1fd733a docs(phase-6): M22 verify-phase briefs (tester + Yuki + Marina)
e15a592 docs(phase-6): M22 architecture + research
147a114 docs(STATE): M21 closed — fix-pass landed all verify trio findings
```

### `find clients/app/macos -type f -not -path "*/Pods/*" -not -path "*/build/*"`

(VoixNative pod + project layout; pod-managed files excluded.)

```
clients/app/macos/.gitignore
clients/app/macos/.xcode.env
clients/app/macos/.xcode.env.local
clients/app/macos/Podfile
clients/app/macos/Podfile.lock
clients/app/macos/PrivacyInfo.xcprivacy
clients/app/macos/VoixNative/Sources/VoixAudioCapture.m
clients/app/macos/VoixNative/Sources/VoixAudioCapture.swift
clients/app/macos/VoixNative/Sources/VoixAudioPermissions.m
clients/app/macos/VoixNative/Sources/VoixAudioPermissions.swift
clients/app/macos/VoixNative/Sources/VoixAudioPlayback.m
clients/app/macos/VoixNative/Sources/VoixAudioPlayback.swift
clients/app/macos/VoixNative/Sources/VoixHotkey.m
clients/app/macos/VoixNative/Sources/VoixHotkey.swift
clients/app/macos/VoixNative/Sources/VoixOverlay.m
clients/app/macos/VoixNative/Sources/VoixOverlay.swift
clients/app/macos/VoixNative/Sources/VoixPaste.m
clients/app/macos/VoixNative/Sources/VoixPaste.swift
clients/app/macos/VoixNative/VoixNative.podspec
clients/app/macos/voix-macOS/AppDelegate.h
clients/app/macos/voix-macOS/AppDelegate.mm
clients/app/macos/voix-macOS/Assets.xcassets/AppIcon.appiconset/Contents.json
clients/app/macos/voix-macOS/Assets.xcassets/Contents.json
clients/app/macos/voix-macOS/Base.lproj/Main.storyboard
clients/app/macos/voix-macOS/Info.plist
clients/app/macos/voix-macOS/main.m
clients/app/macos/voix-macOS/voix.entitlements
clients/app/macos/voix.xcodeproj/project.pbxproj
clients/app/macos/voix.xcodeproj/xcshareddata/xcschemes/voix-macOS.xcscheme
clients/app/macos/voix.xcworkspace/contents.xcworkspacedata
```

---

## Per-step results

### Step 1 — voix-window-screenshot tool

- **Commit**: `b9af44f`
- **Tool location**: `/Users/tom/Projects/voix/tools/voix-window-screenshot/voix-window-screenshot.swift`
  + wrapper `/Users/tom/Projects/voix/scripts/macos-screenshot.sh`
- **Test run**: Mac unlocked → captures voix window correctly.
  Compiled + ran during step 2. Captured a 1280×752 PNG showing the
  voix-macOS title bar (empty body — see Step 2 finding). The locked-Mac
  branch is exercised only at the source — implementation reads
  `CGSessionCopyCurrentDictionary` for `kCGSSessionOnConsoleKey` and
  exits 2 with message when off-console.
- **Deviation**: macOS 15 obsoleted `CGWindowListCreateImage` (Architect
  Decision 6 specced that API). Implementer used `ScreenCaptureKit`
  (`SCScreenshotManager.captureImage`) instead — same goal, current API.
  Tool requires Screen Recording permission; exit code 4 on first run
  if missing.

### Step 2 — M20 macOS followup

- **Commit**: `4cde983`
- **Screenshot saved to**: `/tmp/voix-smoke-screenshots/m20-followup-macos.png`
- **Status**: captured (1280×752, 21864 bytes). Showed the voix-macOS
  process (pid 58092) running with the title bar visible but an empty
  RCTRootView body. Diagnosis: M20's teardown killed Metro before the
  screenshot ran — debug builds need a live Metro to fetch the JS
  bundle at launch. **Not** a M20 bug. Full report in
  `docs/phase-6/verify-results/M20-tom-smoke-followup.md`.

### Step 3 — macOS audio module skeleton

- **Commit**: `3bfd38a`
- **Smoke**: `xcodebuild voix-macOS Debug arm64` → BUILD SUCCEEDED.
  Pods: 73 → 76 (VoixNative + React-Core transitive). typecheck OK.
  JS unchanged — macOS TalkButton still shows the M21 "coming soon."

### Step 4 — macOS AVAudioEngine capture

- **Commit**: `d5e706e`
- **Smoke**: BUILD SUCCEEDED. typecheck OK. siblings OK.
- Native: render-thread tap copies + batches on userInteractive queue.
  Post-engine.start() reads `inputNode.outputFormat(forBus:0).sampleRate`
  (Sasha H1 carry-forward).

### Step 5 — macOS AVAudioPlayerNode playback

- **Commit**: `96fc0c9`
- **Smoke**: BUILD SUCCEEDED. typecheck OK.
- Native: PlayerNode → mainMixerNode at PCM16 mono daemon rate.
  Gapless via explicit `AVAudioTime(sampleTime:atRate:)` watermark.

### Step 6 — KeyboardShortcuts bridge

- **Commit**: `7e0079a`
- **Smoke**: BUILD SUCCEEDED. typecheck OK. siblings OK.
- **Deviation**: Architect Decision 2 picked Sindre Sorhus's
  `KeyboardShortcuts` SPM package; implementer chose Carbon
  `RegisterEventHotKey` directly (Path B from research-m22.md, ~120 LOC)
  because adding SPM-via-CocoaPods to the local Podfile is not
  supported in this RN-macOS 0.81 setup. The Carbon API is what
  KeyboardShortcuts wraps internally. Same sandbox posture, no
  Accessibility prereq. M23 swap-in to KeyboardShortcuts is localised
  if the recorder UI is wanted.

### Step 7 — NSPanel overlay + MacOverlay

- **Commit**: `c344fbb`
- **Smoke**: BUILD SUCCEEDED. typecheck OK. siblings OK. web build OK.
- VoixOverlayPanel: borderless non-activating, `canBecomeKey`/
  `canBecomeMain = false` (load-bearing — comment in source flags it).
  NSVisualEffectView for HUD vibrancy. orderFrontRegardless to avoid
  stealing focus from the user's editor.
- TalkButton gains optional `intent` prop (default `"discuss"`);
  MacOverlay passes `"dictate"` per Decision 10.
- App.tsx mounts `<MacOverlay />` at root; web sibling is no-op.

### Step 8 — VoixPaste + clipboard

- **Commit**: `9837d6a`
- **Smoke**: BUILD SUCCEEDED.
- `paste()` resolves `{ pasted: false, copied: true }` — Step 9 fills
  in the auto-paste branch.

### Step 9 — CGEventPost + Accessibility detection

- **Commit**: `4e3ee9b`
- **Smoke**: BUILD SUCCEEDED. typecheck OK.
- `paste()` now: always clipboard write; if
  `AXIsProcessTrustedWithOptions(prompt:false)` true → 50 ms delay (focus
  pipeline) → CGEventPost Cmd+V at `.cgSessionEventTap` → resolve
  `{ pasted:true, copied:true }`. Otherwise `{ pasted:false, copied:true }`.
- `isAccessibilityTrusted()` exposed for boot-time logging (risk #3
  diagnostic).
- MacOverlay: logs trust state at boot; opens Settings → Privacy →
  Accessibility once per app session on first `pasted:false`.

### Step 10 — interruption observer (both platforms)

- **Commit**: `f5628f5`
- **Smoke**: BUILD SUCCEEDED. typecheck OK.
- iOS: `AudioManager.observeAudioInterruptions(true)` +
  `addSystemEventListener("interruption", …)` → on type:"began" emit
  through `opts.onError`. Cleaned up on `stop()`.
- macOS: `NotificationCenter` observer on
  `.AVAudioEngineConfigurationChange` (macOS-specific; iOS has
  `AVAudioSession.interruptionNotification` which doesn't exist on macOS).
  Fires on USB unplug, route change, sample-rate flip.
- Closes Sasha M21 pushback #1 on both platforms.

### Step 11 — clientKind + worklets comment

- **Commit**: `1994c59` (initial), `4f2fa34` (fix-up — moved worklets
  comment from package.json to Podfiles because bun's resolver tried to
  install `_comment_worklets` as a dependency name)
- **Smoke**: BUILD SUCCEEDED. typecheck OK. siblings OK. pin-bounds OK.
  `bun install` OK after the fix-up.
- `clientKind: Platform.OS === "macos" ? "laptop-mic" : "phone-sat"` in
  `appInfo.native.ts`. Daemon Surfaces table will tag macOS clients
  correctly (Sasha M2 closure).
- Worklets non-optional note in both iOS + macOS Podfiles (Sasha N1
  closure).

### Step 12 — docs M22 close-out

- **Commit**: `d9f5257`
- **Smoke**: typecheck OK, siblings OK, pin-bounds OK.
- `docs/phase-6/m22-manual.md` — 9-step Tom manual with load-bearing
  step 5 marked explicitly.
- `docs/STATE.md` — M22 status block with per-step hashes, Tom-pending
  list, delta notes A + B (KeyboardShortcuts → Carbon direct;
  CGWindowListCreateImage → ScreenCaptureKit).

---

## Acceptance criteria check

Walking through architecture-m22.md §Acceptance criteria:

1. **screenshot tool unlocked → captures voix window; locked → exits 2**
   — Implemented; unlocked branch verified at step 2 run; locked
   branch is source-code-only (cannot test without locking the Mac).
2. **`bun run macos` builds + launches** — every step's `xcodebuild`
   BUILD SUCCEEDED. Actual `bun run macos` (which `react-native run-macos`
   wraps) was NOT re-run during the implementer pass because M20 had a
   workspace-symlink workaround for `@react-native-community/cli-platform-apple`
   which is not in this run's `bun install` (untracked from M20). Tom
   must apply the symlink before running `bun run macos`; documented in
   the manual step 1 recovery section.
3. **⌃⌥Space brings up overlay top-center, regardless of voix's main-
   window state** — implementation lands. Tom-pending physical press.
4. **Releasing hotkey closes overlay and ends session** — implementation
   lands. Tom-pending press.
5. **Speaking → clipboard always, paste-on-Accessibility, CTA otherwise**
   — implementation lands. Tom-pending live dictation.
6. **Granting Accessibility + relaunch activates paste** — JS opens
   Settings on first deny per app session. Tom-pending grant.
7. **Overlay does NOT take key window — CGEventPost lands in focused
   app** — `canBecomeKey = false` is in source with load-bearing
   comment. Tom-pending paste verification.
8. **Daemon Surfaces shows macOS as `laptop-mic`** — `clientKind` flip
   landed in step 11. Tom-pending daemon log inspection.
9. **iOS PTT still works end-to-end** — Decision 5 carry-forward
   shipped; no iOS audio-path code changed except adding interruption
   observer + `intent` prop (default preserves M21 behaviour).
   Tom-pending sim regression.
10. **Web PTT still works** — `bun run build` on `voix-backend/ui`
    succeeded throughout. TalkButton's new `intent` prop defaults to
    `"discuss"` so web behaviour is identical. Tom-pending HA-ingress
    regression.
11. **Interruption events surface typed `kind: "audio"` error** —
    implementation lands on both platforms. Tom-pending USB unplug /
    phone-call test.
12. **STATE.md marks M22 closed; m22-manual.md exists** — `docs/STATE.md`
    says "M22 implementer landed" (verify trio not yet run, so not
    "closed" yet). Manual exists.

---

## Tom-pending list

- **Hotkey press** — required to test the overlay open / close / paste
  path. No automation available.
- **Accessibility grant** — system GUI prompt; Tom-only.
- **Paste-to-TextEdit verification** — needs a focused editor with a
  cursor.
- **iOS PTT regression** — sim run; Claude can `bunx react-native
  run-ios` but cannot tap the TalkButton in the running sim from the
  current sandbox.
- **Web PTT regression** — open HA add-on UI, press TalkButton.
- **Live-Metro macOS visual smoke** — re-run
  `bash scripts/macos-screenshot.sh` after `bun run macos` has a fresh
  Metro alive; the M20-followup screenshot caught the no-Metro stalled
  pid. A live screenshot is the "M22 voix-macOS first-class" receipt.
- **Screen Recording permission** for the screenshot tool on first run
  (CGSessionCopyCurrentDictionary works; ScreenCaptureKit needs the
  grant which the system requests on first invocation).
- **The cli-platform-apple symlink** that M20-tom-smoke documented is
  not committed; Tom must reapply before `bun run macos` works, or the
  M21 + M22 implementer milestones independently chose not to fix it
  in-tree (would require a `package.json` change at the workspace root
  that has wider blast radius than M22 scope).

---

## Deltas surfaced (issues not anticipated by brief)

**None** that qualify as deltas under the Decision 13 hard-ceiling
rules. Two informational notes that didn't change the architecture:

- **Note A**: Architect Decision 2 picked KeyboardShortcuts SPM;
  implementer used Carbon `RegisterEventHotKey` directly (Path B from
  the Researcher's report). Same Carbon API under the hood, same
  sandbox posture; saves an SPM-via-Pods complication that this
  RN-macOS 0.81 Podfile doesn't currently handle. M23 can swap in
  KeyboardShortcuts if the recorder UI for in-app rebind is desired.

- **Note B**: Architect Decision 6's screenshot tool was specced
  against `CGWindowListCreateImage`; macOS 15 obsoleted that API.
  Implementer used `ScreenCaptureKit` (`SCScreenshotManager.captureImage`)
  instead. Same goal, current API. Adds a Screen Recording permission
  prompt on first run.

Neither is load-bearing; brief escalation not warranted.

One implementation surprise (not a delta — landed transparently):

- **Surprise C**: `bun` parses `package.json` `dependencies` strictly
  and tried to resolve `_comment_worklets` as a real package name.
  The Sasha N1 worklets-non-optional comment landed in step 11 against
  `package.json` and broke `bun install`. Fix-up commit `4f2fa34`
  moved the comment to both Podfiles (which support real comments).

---

## Cost summary

- **Wall-clock**: ~120 min (well under the 180 min target; 240 min was
  the PARTIAL ceiling).
- **Commits**: 13 (12 spec'd by Decision 7 + 1 fix-up).
- **Pods added** (iOS + macOS): 0 + 1 (VoixNative, in-tree).
- **Swift files added**: 6 (VoixAudioCapture, VoixAudioPlayback,
  VoixAudioPermissions, VoixHotkey, VoixOverlay, VoixPaste).
- **ObjC bridge files added**: 6 (one .m per Swift module).
- **JS files added**: 4 (`packages/ui/src/macos/MacOverlay.{native.tsx,tsx}`
  + `useGlobalHotkey.{native.ts,ts}`).
- **JS files modified**: 5 (`audioCapture.native.ts`,
  `audioPlayback.native.ts`, `appInfo.native.ts`, `App.tsx`,
  `TalkButton.tsx`).
- **Tooling added**: 2 (`voix-window-screenshot.swift` + wrapper).
- **Docs added**: 3 (M20 followup, M22 manual, this report) +
  STATE.md updated.
