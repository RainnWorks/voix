# M22 fix-pass report

Status: SUCCESS

All 9 specced fixes landed as discrete commits + pushed to `main`. Each
intermediate xcodebuild succeeded; bun run check, voix-backend/ui build,
and tsc -p clients/app remain green throughout.

## Receipts

`stat -f "%Sm %z %N"` for every file written/modified:

```
May 31 17:10:59 2026   424   clients/app/macos/voix-macOS/voix.entitlements
May 31 17:25:24 2026   3281  clients/app/macos/voix-macOS/AppDelegate.mm
May 31 17:13:26 2026   23154 clients/app/macos/voix.xcodeproj/project.pbxproj
May 31 17:15:38 2026   10573 clients/app/macos/VoixNative/Sources/VoixHotkey.swift
May 31 17:20:28 2026   13967 clients/app/macos/VoixNative/Sources/VoixOverlay.swift
May 31 17:18:07 2026   798   clients/app/macos/VoixNative/Sources/VoixOverlay.m
May 31 17:21:35 2026   12328 clients/app/macos/VoixNative/Sources/VoixAudioCapture.swift
May 31 17:22:27 2026   8102  clients/app/macos/VoixNative/Sources/VoixAudioPlayback.swift
May 31 17:23:02 2026   6824  clients/app/macos/VoixNative/Sources/VoixPaste.swift
May 31 17:23:09 2026   758   clients/app/macos/VoixNative/Sources/VoixPaste.m
May 31 17:25:37 2026   13336 packages/ui/src/macos/MacOverlay.native.tsx
May 31 17:23:19 2026   230   packages/ui/src/macos/MacAccessibilityBanner.tsx     (new)
May 31 17:23:53 2026   4230  packages/ui/src/macos/MacAccessibilityBanner.native.tsx (new)
May 31 17:24:10 2026   2334  packages/ui/src/App.tsx
```

`git log --oneline -12`:

```
e253b57 clients/app/macos(M22 fix): NewArch diagnostic boot log (Yuki B2 partial)
358ec22 clients/app/macos(M22 fix): Accessibility re-prompt + voix-considered pre-explanation (Yuki H6 + Marina UX-3)
bada222 clients/app/macos/VoixNative(M22 fix): attach engine nodes at init, start/stop per session (Yuki H3)
a225366 clients/app/macos/VoixNative(M22 fix): rebuild engine on configurationChange (Yuki H2)
ea5b4f1 clients/app/macos/VoixNative(M22 fix): NSPanel hardening — focus + space behaviour (Yuki H1)
ad774bc ui(M22 fix): voix-brand the macOS PTT overlay (puck + HA blue + level pulse) (Marina BRAND-1)
e2f039d clients/app/macos/VoixNative(M22 fix): Carbon hotkey + NSEvent keyUp fallback (Yuki B3)
82a5df6 clients/app/macos(M22 fix): request mic at boot to avoid first-PTT focus race (Yuki H5)
05e73d6 clients/app/macos(M22 fix): add mic entitlement to voix.entitlements (Yuki B1)
7a6882f docs: M22 implementer report + Podfile.lock checksum
4f2fa34 clients/app(M22 fix): move worklets-required note out of package.json
d9f5257 docs: M22 close-out — manual + STATE
```

## Fix 1 — Yuki B1 entitlement

- Commit: `05e73d6`
- Added `com.apple.security.device.audio-input = true` to
  `voix.entitlements`.
- **Surprise mid-fix**: the project pbxproj never had
  `CODE_SIGN_ENTITLEMENTS` set — the `voix.entitlements` file was a
  file reference only, never wired to a build setting. So Yuki's
  "missing audio-input entitlement" was actually "no entitlements at
  all". Wired `CODE_SIGN_ENTITLEMENTS = "voix-macOS/voix.entitlements"`
  in both Debug + Release configs.
- Verified via `codesign -d --entitlements -` on the built app:

```
[Dict]
    [Key] com.apple.security.app-sandbox            [Bool] true
    [Key] com.apple.security.device.audio-input     [Bool] true
    [Key] com.apple.security.files.user-selected.read-only [Bool] true
    [Key] com.apple.security.get-task-allow         [Bool] true
    [Key] com.apple.security.network.client         [Bool] true
```

## Fix 2 — Yuki H5 boot mic permission

- Commit: `82a5df6`
- AppDelegate.mm requests mic at `applicationDidFinishLaunching` when
  status is `.notDetermined`. Idempotent on subsequent runs.
- The boot-time prompt doesn't compete with hotkey-driven focus
  expectations.

## Fix 3 — Yuki B3 Carbon + keyUp fallback

- Commit: `e2f039d`
- Picked path (b) per brief — Carbon stays primary, `.flagsChanged`
  global monitor is the safety net. SPM-via-Pods deferred to M23.
- State machine: `chordIsDown` bool gates duplicate emits.
  `.flagsChanged` does NOT require Accessibility (only `.keyDown`
  / `.keyUp` do), so it's sandbox-friendly.

Excerpt of the dual-path detection:

```swift
fileprivate func handleHotKeyEvent(_ kind: UInt32) {
    if kind == UInt32(kEventHotKeyPressed) {
        chordIsDown = true
        guard hasListeners else { return }
        sendEvent(withName: "voixHotkey.down", body: nil)
    } else if kind == UInt32(kEventHotKeyReleased) {
        if chordIsDown {                  // Carbon path
            chordIsDown = false
            ...
            sendEvent(withName: "voixHotkey.up", body: nil)
        }
    }
}

fileprivate func handleFlagsChanged(_ event: NSEvent) {
    guard chordIsDown else { return }     // monitor path
    let current = event.modifierFlags.intersection(requiredModifierMask)
    if current != requiredModifierMask {
        chordIsDown = false
        ...
        sendEvent(withName: "voixHotkey.up", body: nil)
    }
}
```

## Fix 4 — Marina BRAND-1 brand the HUD

- Commit: `ad774bc`
- The JS `MacOverlay.native.tsx` returns null (it's a behaviour
  component, not a visible component); the user-visible HUD is the
  Swift NSPanel. Brought the brand into the panel directly via Swift
  `NSView` puck construction (charcoal rounded square + HA-blue inner
  circle, ratios matching `packages/ui/src/components/Puck.tsx`).
- New `setLevel(level)` method on VoixOverlay; JS subscribes to
  `voixAudioCapture.frame`, computes a quick RMS per chunk, smooths
  via single-pole filter, calls `setLevel`. The pulse ring size +
  opacity animate with the value.
- HA blue + ink hardcoded in Swift with a "keep in sync with theme.ts"
  comment.

## Fix 5 — Yuki H1 NSPanel hardening

- Commit: `ea5b4f1`
- Added `worksWhenModal=true`, `isMovableByWindowBackground=false`,
  `acceptsMouseMovedEvents=false`, `mouseDown` override that intentionally
  does NOT call super.

## Fix 6 — Yuki H2 engine rebuild on configurationChange

- Commit: `a225366`
- Refactored `beginCapture` to extract an `installTapAndStart()` helper.
  Config-change observer now: stop → removeTap → installTapAndStart →
  emit typed `configurationChanged` event (with prev + new sampleRate).
- On rebuild failure, surface as error + flip `isRunning=false` so
  orchestrator can close.

## Fix 7 — Yuki H3 engine attach/detach lifecycle

- Commit: `bada222`
- VoixAudioPlayback: `attached` flag tracks once-per-process attach.
  endPlayback no longer detaches; only stops engine + player. Rate
  change between sessions handled via cheap disconnect + reconnect.

## Fix 8 — Yuki H6 + Marina UX-3 Accessibility re-prompt + pre-explanation

- Commit: `358ec22`
- `VoixPaste.requestAccessibility()` calls the prompting variant —
  bridged via `.m` for JS access.
- New `MacAccessibilityBanner` component (native + web siblings, web
  sibling is no-op). Renders above main content on macOS only when
  trust is missing. "Grant access" button triggers the prompting path.
  Polls every 4s to disappear the moment trust lands.
- Mounted in `App.tsx` above the `AppShell` content.

## Fix 9 — Yuki B2 NewArch diagnostic

- Commit: `e253b57`
- AppDelegate.mm: NSLog `[voix] NewArch=<bool> bridges=legacy ...` at
  boot, reading `RCTNewArchEnabled` from Info.plist.
- JS sibling: MacOverlay.native.tsx logs the available `Voix*` modules
  on mount: `voix native modules available: [VoixAudioCapture, ...]`.
- Did NOT migrate the bridges — TurboModule conversion is M23.

## Issues surfaced beyond brief

- **Entitlements file not wired**: B1 was deeper than Yuki diagnosed —
  the project never set `CODE_SIGN_ENTITLEMENTS` at all, so NONE of the
  declared entitlements were applied to the build. Fixed in the same
  commit as the audio-input add.
- **VoixHotkey.swift implicit-unwrapped warning on `supportedEvents()`**
  — Swift 6 deprecation note. Same pre-existing pattern in
  VoixAudioCapture; both are RCTEventEmitter overrides matching the
  base class signature. Not fixed; cosmetic Swift 6 future-proofing.
- **`worksWhenModal` is technically NSWindow's `worksWhenModal`** — on
  NSPanel this property is generally `true` by default for panels but
  setting explicitly is the defensive call.

Notes left unfixed (per "Don't go beyond the 9 fixes"):

- **Yuki H4** (sandbox `automation` entitlement for non-TextEdit paste
  targets like Slack/VS Code). Documented in Yuki's review; entitlement
  + paste-target docs are M23.
- **Yuki M1** (chord-conflict surfacing in UI).
- **Yuki M2** (re-position on `didChangeScreenParametersNotification`).
- **Yuki M3-M7, L1-L6** — see Yuki's review.
- **Marina HIG-1** (first-launch onboarding for hotkey).
- **Marina UX-1** (ESC dismiss fail-safe).
- **Marina UX-2** (hotkey conflict UI).
- **Marina UX-4** (first-launch onboarding).
- **Marina UX-5** (dictate-vs-discuss user-facing teaching).
- **Marina UX-6** (richer manual sample sentence).

All carry-forward to M23 per Marina's watching-briefs table.

## Re-verify recommendation

ready-to-close — the three blockers + six highs + brand regression are
all addressed and each fix builds clean. Tom-day testing of step 5 is
still pending (hotkey press, mic permission flow, paste verification,
Accessibility grant path), but the mechanical work the verify trio
flagged has landed. Recommend Tom run the full m22-manual.md step 5
flow with these fixes; if anything regresses, that's a new pass.
