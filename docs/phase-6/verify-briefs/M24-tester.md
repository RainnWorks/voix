# M24 Tester brief

Final Phase 6 milestone. Run all ACs from `docs/phase-6/architecture-m24.md`. iOS keyboard extension target adds Xcode + Info.plist + entitlements surface — verify each.

## Read

- `docs/phase-6/architecture-m24.md` — ACs.
- `docs/phase-6/verify-results/M24-implementer-report.md`.
- `git log --oneline -12`.

## Tasks

1. **Receipts** — 3 file spot-checks.

2. **Bundle ID rename took** — `org.reactjs.native.example.voix` → `co.rowm.voix`. Grep the iOS project for old ID; should be 0.

3. **Keyboard target exists**:
   - `clients/app/ios/VoixKeyboard/` directory.
   - `KeyboardViewController.swift` (or whatever architect named).
   - Info.plist with `NSExtension.NSExtensionPointIdentifier = com.apple.keyboard-service`.
   - Bundle ID `co.rowm.voix.keyboard`.

4. **App Group entitlement**:
   - Both `voix.entitlements` (host) and `VoixKeyboard.entitlements` declare `group.co.rowm.voix`.

5. **URL scheme**:
   - Host Info.plist has `CFBundleURLTypes` with `voix` scheme.
   - AppDelegate has `application(_:open:options:)` handler.

6. **iOS builds**:
   - `xcodebuild -workspace voix.xcworkspace -scheme voix -configuration Debug` succeeds.
   - `xcodebuild ... -scheme VoixKeyboard -configuration Debug` succeeds.

7. **Sim grant + boot**:
   - `xcrun simctl privacy booted grant microphone co.rowm.voix` runs without error.
   - `bunx react-native run-ios` builds + launches under the new bundle ID.

8. **Carry-forward smokes**:
   - `bun run check` exits 0.
   - Web build still works.
   - Daemon boots.
   - tsc clients/app exit 0.
   - tone tests still pass.
   - macOS xcodebuild succeeds (M22 work mustn't regress).

9. **Tom-pending acceptance** (mark, don't fake):
   - Settings → General → Keyboard → Add new → voix
   - Allow Full Access toggle
   - Tap globe in Notes/Mail → voix keyboard appears
   - "Talk to voix" → host app opens → record → text appears
   - Apple Developer Program enrollment for physical device

## Output

`docs/phase-6/verify-results/M24-tester.md` with VERDICT block.
