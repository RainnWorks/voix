# M24 Tester report

Role: Tester. Milestone: M24 — iOS keyboard extension (bounce-to-host
capture). Final Phase 6 milestone.

## Receipts (files read / commands run)

`stat -f "%Sm %z %N"` — 3 spot-checks against implementer's claimed sizes:

```
May 31 21:29:04 2026 13147 clients/app/ios/VoixKeyboard/KeyboardViewController.swift   (claim 13147 ✓)
May 31 21:07:54 2026   295 clients/app/ios/VoixKeyboard/VoixKeyboard.entitlements      (claim 295   ✓)
May 31 21:08:37 2026  1039 scripts/check-app-group.sh                                  (claim 1039  ✓)
```

Source read: KeyboardViewController.swift, KeyboardRootView.swift,
KeyboardState.swift, CaptureSession.swift, Shared/KeyboardSessionState.swift,
Shared/SharedContainer.swift, VoixIOSNative/Sources/VoixKeyboardBridge.{swift,m},
VoixKeyboard/Info.plist, voix/Info.plist, voix/AppDelegate.swift,
both .entitlements, packages/ui/src/{App.tsx,conversations/KeyboardCaptureScreen.tsx},
project.pbxproj, podspec.

Build/runtime evidence: three xcodebuild runs + sim install + openurl
+ plutil/codesign inspection of the built products (see below).

## Smoke battery — all green

| Check | Result |
|---|---|
| `bun run check` | ✅ native-siblings / protocol-sync / pin-bounds all OK |
| Web build (`bun run build:ui`) | ✅ vite built, exit 0 |
| `tsc -p clients/app/tsconfig.json --noEmit` | ✅ exit 0 |
| tone tests (`voix-backend/tests/voices/tone.test.ts`) | ✅ 11 pass / 0 fail |
| Daemon boot (`bun src/index.ts`) | ✅ "listening on :8765", process stayed alive |
| iOS sim build — `voix` scheme (Debug) | ✅ **BUILD SUCCEEDED**, exit 0 |
| iOS sim build — `VoixKeyboard` scheme (Debug) | ✅ **BUILD SUCCEEDED**, exit 0 |
| macOS build — `voix-macOS` scheme (Debug) | ✅ **BUILD SUCCEEDED**, exit 0 (M22 not regressed) |

All builds run with `CODE_SIGNING_ALLOWED=NO` (sandbox has no signing
identity; entitlement resolution is Tom-pending on a signed device).

## Brief tasks 1–9

1. **Receipts** — 3/3 spot-checks match claimed sizes. ✅
2. **Bundle-id rename** — `grep -r org.reactjs.native.example.voix clients/app/ios` → **0 hits**. `co.rowm.voix` in both Debug+Release host configs; `co.rowm.voix.keyboard` in both keyboard configs. ✅
3. **Keyboard target** — `VoixKeyboard/` dir present; `KeyboardViewController.swift` present; Info.plist `NSExtensionPointIdentifier = com.apple.keyboard-service` + `RequestsOpenAccess = true` + principal class `$(PRODUCT_MODULE_NAME).KeyboardViewController`; bundle id `co.rowm.voix.keyboard`. pbxproj has `com.apple.product-type.app-extension` + `Embed Foundation Extensions` copy phase (`dstSubfolderSpec = 13` = PlugIns). ✅
4. **App Group entitlement** — both `voix/voix.entitlements` (host) and `VoixKeyboard/VoixKeyboard.entitlements` declare `group.co.rowm.voix`; `CODE_SIGN_ENTITLEMENTS` wired on all four configs; `scripts/check-app-group.sh` exit 0. ✅
5. **URL scheme** — host Info.plist `CFBundleURLTypes` registers scheme `voix` (name `co.rowm.voix.host`, role Editor); AppDelegate has `application(_:open:options:)` forwarding to `RCTLinkingManager`. ✅
6. **iOS builds** — both `voix` and `VoixKeyboard` schemes BUILD SUCCEEDED. ✅
7. **Sim grant + boot** — `xcrun simctl privacy booted grant microphone co.rowm.voix` → exit 0. Built `voix.app` installed to booted iPhone 16 Pro (exit 0); `xcrun simctl openurl booted "voix://capture?session_id=test123&return=…"` → exit 0 (iOS accepted + routed the scheme). Full `bunx react-native run-ios` launch not driven headlessly, but the equivalent build+install+openurl chain is green. ✅ (build/install/route)
8. **Carry-forward smokes** — all green (table above). ✅
9. **Tom-pending acceptance** — marked, not faked (see below). ✅

## Binary-level verification (stronger than source grep)

Inspected the *built* products on the sim, not just source:

- Host `voix.app/Info.plist`: `CFBundleIdentifier = co.rowm.voix`; `CFBundleURLSchemes = [voix]`.
- Embedded `voix.app/PlugIns/VoixKeyboard.appex/Info.plist`: `CFBundleIdentifier = co.rowm.voix.keyboard`, `NSExtensionPointIdentifier = com.apple.keyboard-service`, `NSExtensionPrincipalClass = VoixKeyboard.KeyboardViewController`, `RequestsOpenAccess = true`.
- **`RCTNewArchEnabled` is absent from the embedded appex Info.plist** — confirms the implementer's claimed post-`pod install` strip actually landed in the shipped artifact (a non-RN keyboard must not carry it).
- App Group entitlement could not be read via `codesign -d --entitlements`
  because the build is unsigned; source entitlements + `check-app-group.sh`
  cover it. Full entitlement resolution is signed-device (Tom-pending).

## Cross-boundary serialization (round-trip sanity)

Verified host↔keyboard `KeyboardSessionState` compatibility by reading
both encoders/decoders:

- Keyboard `SharedContainer` uses `JSONEncoder/Decoder` with
  `.dateEncodingStrategy/.dateDecodingStrategy = .iso8601`; `createdAt` is a `Date`.
- Host `VoixKeyboardBridge` mirrors the schema with `createdAt` as a
  **String** seeded via `ISO8601DateFormatter().string(from:)`.
- Both produce/consume non-fractional ISO-8601 (`…Z`), which Swift's
  `.iso8601` strategy expects → round-trips cleanly in both directions.
- `status` enum raw values (`pending|capturing|done|failed|cancelled`)
  match on both sides. **No serialization mismatch.** ✅

## Findings (non-blocking)

**F1 — notable (UX, Tom-pending runtime):** Architecture Decision 3
explicitly specs registering `voix-keyboard://` in `VoixKeyboard/Info.plist`
("Same shape … with scheme voix-keyboard"). The implementer did **not**
register it (no `CFBundleURLTypes` in the extension Info.plist). The
host's `returnToKeyboard` calls `UIApplication.shared.open("voix-keyboard://done?…")`;
if no installed app handles that scheme, the open returns `success=false`
and iOS may not auto-foreground the previous (host) app — degrading the
auto-bounce-back leg. Risk 3's two-channel design (shared file is the real
data source; keyboard reads on `viewDidAppear`) means this is **not data
loss** — it degrades to "user manually switches back to Notes, keyboard
reads the file." Worth the Adversary/Architect deciding whether to register
the scheme; runtime impact is physical-device/Tom-pending regardless.

**F2 — minor (cosmetic spec drift):** Decision 1's directory layout lists
`FullAccessGate.swift` and `Assets.xcassets`. Neither exists — the Full
Access gate is folded into `KeyboardRootView.onboardingStack`, and the
wordmark/puck are code-drawn SwiftUI (SF text + `Circle`) rather than
imported PDF vectors. Functionally complete and *lower* memory (helps
Risk 2). No action needed beyond noting.

**F3 — minor (dead write):** `KeyboardViewController.handleTimeout` writes
`status=cancelled` then immediately `deleteSession()` (removes both files),
so the cancelled marker is gone the instant it's written — negating the
stated "stop a slow host from writing done later" intent. Harmless in
practice (phase already left `.bounced`, so `consumeBouncedSession` no-ops;
any late host write is swept by `sweepOrphans`). Flag for Adversary.

## Acceptance criteria (architect's 13)

| # | Criterion | Verdict |
|---|---|---|
| 1 | VoixKeyboard builds, bundle id `co.rowm.voix.keyboard` | ✅ built + appex identity confirmed |
| 2 | Host renamed `co.rowm.voix`; PTT works on sim | ✅ rename confirmed in built plist; PTT path untouched + builds (runtime PTT Tom-pending) |
| 3 | Both targets entitled `group.co.rowm.voix`; check-app-group.sh | ✅ |
| 4 | `voix://capture?…` opens host + routes | ✅ openurl accepted on sim; scheme in built plist; Linking route handler in App.tsx |
| 5 | Keyboard UI = Decision 4 | ✅ wordmark + HA-blue pill + hint + globe (long-press switcher); see F2 |
| 6 | Full Access onboarding when off; recovers on grant | ✅ source (`viewWillAppear` re-render); runtime Tom-pending |
| 7 | Pill bounces; host single-shot dictate; writes transcript | ✅ source + builds; end-to-end runtime **Tom-pending** |
| 8 | Host returns `voix-keyboard://done`; kbd reads + insertText | ✅ source; runtime **Tom-pending**; see **F1** |
| 9 | 60s timeout; orphan sweep on launch | ✅ source (see F3 note) |
| 10 | Failure paths show 2s toast | ✅ failed/cancelled/timeout copy in applyFailed + showToast |
| 11 | Memory < 30 MB idle pill | ❓ **Tom-pending** (Xcode Memory Navigator, physical device) |
| 12 | Works in Notes/Mail/Messages/Reminders/Safari | ❓ **Tom-pending** (physical device) |
| 13 | STATE marks Phase 6 closed; tag `v0.phase-6` on main | ✅ tag at `8c1ac1b`, ancestor of HEAD on main; STATE close-out present |

## Tom-pending (physical-device acceptance — Apple Developer Program required)

Cannot be driven from this sandbox (signing + real iPhone). All documented
in `docs/phase-6/m24-manual.md`:

- Enable voix keyboard in Settings → General → Keyboard → voix → Allow Full Access.
- End-to-end bounce loop (tap pill → record → return → insert) in ≥4 host
  apps (Notes/Mail/Messages/Reminders/Safari).
- Memory profile < 30 MB during idle pill (AC 11).
- Background / re-entry + orphan sweep.
- **Plus F1**: confirm the auto-bounce-back fires given `voix-keyboard://`
  is unregistered on the extension; if it doesn't, register the scheme.

---

## VERDICT

```
VERDICT: PASS (sim-coverable scope)
SCOPE:   All 8 implementer steps + full smoke battery verified at source
         and build/binary level. 3/3 receipts match. Bundle-id rename,
         keyboard target, App Group entitlement, URL scheme, dual iOS
         builds, macOS build, sim mic-grant, sim install + openurl route
         — all green. Cross-boundary session serialization round-trips.
PENDING: Physical-device acceptance — ACs 11 (memory), 12 (4 host apps),
         and the runtime legs of ACs 6–10 — Tom-pending (Apple Developer
         Program + iPhone). Documented in m24-manual.md.
FINDINGS: F1 (notable, non-blocking) — Decision 3's `voix-keyboard://`
         scheme NOT registered on the extension; may break the auto-
         bounce-back UX leg (data integrity preserved via shared-file
         channel; confirm on device / consider registering). F2, F3
         minor. None block source-level acceptance.
SMOKES:  bun check ✅ · web build ✅ · tsc clients/app ✅ · tone 11/0 ✅ ·
         daemon boot ✅ · iOS voix ✅ · iOS VoixKeyboard ✅ · macOS ✅
```
