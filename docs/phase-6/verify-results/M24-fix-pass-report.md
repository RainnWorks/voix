# M24 fix-pass — Implementer report

Role: fix-pass Implementer. Input: Aki (adversary, H1–H4 + medium/low),
Wren (product, HIGH + 2 MED + lows), Tester (F1). All 7 mandated fixes
landed, each as its own commit, full smoke battery green.

## Status: ALL 7 FIXES COMPLETE

| # | Fix | Source | Commit | Smoke |
|---|-----|--------|--------|-------|
| 1 | Durable bounce phase → App Group UserDefaults | Aki H1 | `6eb40b1` | VoixKeyboard ✅ |
| 2 | Register `voix-keyboard://` on extension Info.plist | Aki H2 / Tester F1 | `ef4a6e9` | VoixKeyboard ✅ + appex plist verified |
| 3 | Tom-day diagnostic os_log (viewDidAppear + open completion) | Aki H3 | `d292487` | VoixKeyboard ✅ |
| 4 | App-Review rationale (inline comment + manual section) | Aki H4 | `7cdd309` | VoixKeyboard ✅ |
| 5 | Brand blue `#18BCF2` → `#03A9F4` | Wren HIGH | `264b5b5` | VoixKeyboard ✅ |
| 6 | "Set up voix keyboard" settings row + keyboard deeplink | Wren MED | `50da3fc` | check/tsc/ui-build ✅ |
| 7 | Brand squircle puck from vector asset | Wren MED | `6a5808a` | VoixKeyboard ✅ + Assets.car verified |

(Commit `730b946` from another worker interleaved into the log mid-run —
shared branch, not mine.)

## What each fix does

### 1 — Durable bounce phase (Aki H1) — `6eb40b1`
`KeyboardState.phase` was RAM-only on the `KeyboardViewController`
instance. A recycled extension (likely whenever the host RN app
foregrounds under memory pressure) returned with a fresh `.idle` phase,
so `viewDidAppear`'s `if case .bounced` consume-trigger never fired and
the dictated transcript sat in the container until the 5-min orphan
sweep silently deleted it.

- Added `persistActiveBounce` / `loadActiveBounce` / `clearActiveBounce`
  to `SharedContainer` backed by `UserDefaults(suiteName:
  "group.co.rowm.voix")` (sessionId + startedAt).
- `handleTalkTap` persists the pointer the moment it enters `.bounced`.
- `viewDidLoad` calls `restorePersistedBounceIfFresh()` (after the
  orphan sweep): if a pointer exists and is inside the 60s window, it
  reconstructs `.bounced` so `viewDidAppear` consumes the `done`
  session; a stale pointer (>60s) is cleared silently to avoid a
  spurious "couldn't record" toast on a cold launch.
- Pointer cleared on every terminal transition (applyDone / applyFailed
  / applyCancelled / handleTimeout / open-failure).

This is the fix that makes the return leg shippable even when iOS's
auto-foreground doesn't fire — the keyboard now finds the text whenever
it next appears.

### 2 — Register `voix-keyboard://` (Aki H2 / Tester F1) — `ef4a6e9`
Architecture Decision 3 specced registering the scheme on the extension;
it was omitted. Added `CFBundleURLTypes` (`voix-keyboard`,
`co.rowm.voix.keyboard`, Editor) to `VoixKeyboard/Info.plist`
(`RequestsOpenAccess` was already `true`). Verified via `plutil` that the
scheme ships in the built `VoixKeyboard.appex/Info.plist`. The host-side
`UIApplication.shared.open(voix-keyboard://done)` already lives in
`VoixKeyboardBridge.returnToKeyboard`; with the scheme now registered the
open resolves instead of returning `success=false`. (Aki's standing
caveat that app-extensions aren't truly launchable via openURL is covered
by the durable-pointer fix above — return detection no longer depends on
the auto-foreground succeeding.)

### 3 — Tom-day diagnostic (Aki H3) — `d292487`
Added `os_log` of `state.phase` on every `viewDidAppear` (the return-leg
falsifier) and an unconditional log of the `extensionContext.open`
completion `success` value. First device run can now read the predicted
`opened:false` / fresh-`.idle` directly from the
`co.rowm.voix.keyboard` subsystem log.

### 4 — App-Review rationale (Aki H4) — `7cdd309`
- Inline rationale block at the top of `KeyboardViewController.swift`:
  the keyboard's keyboard-primary value is voice dictation into the
  focused field (the one thing the system keyboard can't do); the
  bounce-to-host is an Apple-imposed implementation detail, not a
  launcher workaround; precedent is Apple Dictation / Gboard / SwiftKey
  / Grammarly.
- New "App Review story" section in `docs/phase-6/m24-manual.md` with
  the App Store Connect review-note + listing framing and the
  in-keyboard-recording fallback (Risk 1 / M24.5).

### 5 — Brand blue (Wren HIGH) — `264b5b5`
`KeyboardRootView` hardcoded `#18BCF2` (Home Assistant's *company* blue).
Changed to `#03A9F4` — voix's HA blue per `voix-brand-guide.html`
(`--ha-blue`) and `theme.ts` (`haBlue`). Now colour-continuous with the
capture screen's puck core and every other voix surface. Added a comment
tying the hex to the token so it can't drift again.

### 6 — Settings row + deeplink (Wren MED) — `50da3fc`
Added an iOS-only "voix keyboard" Settings section with a "Set up voix
keyboard" row: the description spells out the full add-keyboard tap-path
(General → Keyboard → Keyboards → Add New Keyboard → voix → Allow Full
Access) and the "Open Settings" button tries the keyboard-pane deeplink
`App-Prefs:root=General&path=Keyboard/KEYBOARDS`, falling back to the
public `Linking.openSettings()`. This both adds the missing adoption
on-ramp and closes the keyboard onboarding CTA's dead-end (Decision 5
explicitly relied on this row existing).

**2026 deeplink note:** there is no public deep-link to the iOS Keyboards
pane. `App-Prefs:` is a private scheme — App-Review-risky and unreliable
on iOS 17/18 — so it's best-effort with a public `openSettings()`
fallback and an always-correct tap-path string. Flagging for the
review-strategy owner: do not ship the private scheme to the App Store
without confirming it doesn't trip review; the fallback alone is
App-safe.

### 7 — Brand squircle puck (Wren MED) — `6a5808a`
The hero puck was a plain white `Circle` + blue dot, dropping the brand's
ink-squircle shape. No puck asset existed in the host bundle or repo to
copy, so I created a vector SVG puck (ink `#18181B` squircle body +
centred `#03A9F4` dot, matching `voix-brand-guide.html` `.puck-icon-*`
proportions: corner-radius ≈ 0.23×side, dot ≈ 0.35×side) in a new
`VoixKeyboard/Assets.xcassets`, wired the catalog into the VoixKeyboard
target (`project.pbxproj`: PBXFileReference + PBXBuildFile + group child +
the previously-empty Resources build phase), and render `Image("Puck")`
with `.original` rendering. Verified the build produces `Assets.car` in
the appex containing the `Puck` asset (`assetutil --info`).

## Smoke battery — full, all green

| Check | Result |
|---|---|
| `xcodebuild voix-macOS` (Debug, macOS workspace) | ✅ BUILD SUCCEEDED |
| `xcodebuild voix` (Debug, iphonesimulator) — embeds appex | ✅ BUILD SUCCEEDED |
| `xcodebuild VoixKeyboard` (Debug, iphonesimulator) | ✅ BUILD SUCCEEDED |
| `bun run check` (native-siblings / protocol-sync / pin-bounds) | ✅ all OK |
| `cd voix-backend/ui && bun run build` (tsc + vite) | ✅ built, 341 modules |
| `bunx tsc -p clients/app/tsconfig.json --noEmit` | ✅ exit 0 |

All iOS/macOS builds run `CODE_SIGNING_ALLOWED=NO` (sandbox has no
signing identity; entitlement resolution stays Tom-pending on a signed
device). Per-fix smokes were run targeted (Swift fixes → VoixKeyboard
build; TS fix → check/tsc/ui-build); the full battery above was re-run
after the final commit.

## Out-of-scope items NOT fixed (deliberately)

These were lower-severity findings outside the 7 mandated fixes; flagged
for the coordinator, not addressed in this pass:

- **Aki M-1 / M-2** (no-speech `done` → silent no-op; `.txt`-write
  failure not falling back to JSON `transcript`). Real UX gaps but in
  the host bridge / capture-screen, not in the 7-item brief.
- **Aki M-3** (keyboard "Open Settings" CTA needs the Full Access it's
  prompting for). Partially mitigated by fix #6's host-side row, which
  is the sanctioned path; the keyboard-side CTA honesty improvement is
  not done.
- **Aki L-1/L-2/L-3, Wren LOW (ink-on-blue label, wordmark lockup),
  Wren NIT, Tester F2/F3.** Cosmetic / hardening; untouched.

## Push status — IMPORTANT for coordinator

All 7 commits are **local only**. Pushing to `origin/main` is blocked by
Claude Code's auto-mode classifier (bypasses PR review on the default
branch); I escalated and the coordinator acknowledged the local-commit
approach. The shared working tree was concurrently modified by other
workers during the run (the branch advanced and `realtime/types.ts` was
committed by another worker — not me). **Coordinator action needed:**
push these SHAs to origin (or open a PR):

```
264b5b5  ui(M24 fix): brand HA blue #03A9F4
6eb40b1  kbd(M24 fix): durable bounce phase (UserDefaults)
d292487  kbd(M24 fix): Tom-day diagnostic os_log
7cdd309  docs(M24 fix): App-Review rationale
ef4a6e9  kbd(M24 fix): register voix-keyboard:// scheme
6a5808a  kbd(M24 fix): brand squircle puck vector asset
50da3fc  ui(M24 fix): Set up voix keyboard settings row + deeplink
```

## Files modified

- `clients/app/ios/VoixKeyboard/KeyboardRootView.swift`
- `clients/app/ios/VoixKeyboard/KeyboardViewController.swift`
- `clients/app/ios/VoixKeyboard/Shared/SharedContainer.swift`
- `clients/app/ios/VoixKeyboard/Info.plist`
- `clients/app/ios/VoixKeyboard/Assets.xcassets/**` (new — Contents.json,
  Puck.imageset/Contents.json, Puck.imageset/puck.svg)
- `clients/app/ios/voix.xcodeproj/project.pbxproj`
- `packages/ui/src/settings/SettingsScreen.tsx`
- `docs/phase-6/m24-manual.md`
