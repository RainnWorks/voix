# M22 Tester brief

M22 is the biggest single milestone in Phase 6 — Swift TurboModules for
audio + paste + hotkey + an NSPanel overlay. Re-run every smoke the
Implementer claimed; distinguish tested (build/typecheck OK) from
verified (real macOS behaviour observed).

## Read

- `docs/phase-6/architecture-m22.md` — acceptance criteria.
- `docs/phase-6/verify-results/M22-implementer-report.md` — claims.
- `git log --oneline -15`.

## Tasks

1. **Receipts spot-check** — 3 file paths, re-stat.

2. **Step 1 — voix-window-screenshot tool**:
   - File `tools/voix-window-screenshot.swift` exists, compiles
     (`swift build` or whatever the brief specified).
   - Run it: if no voix window is running, expect a clear "not found"
     message + non-zero exit. If voix is running unlocked, expect a
     PNG saved.
   - **Critical**: ensure it does NOT capture a login window when
     screen is locked. Run with screen-lock state if possible
     (`pmset displaysleepnow` then immediately try — or read
     `CGSessionCopyCurrentDictionary` directly).

3. **Step 2 — M20 macOS followup screenshot**:
   - If `/tmp/voix-smoke-screenshots/m20-followup-macos.png` exists,
     read it. Describe what you see.
   - If Implementer reported "Tom-pending — locked", note it.

4. **macOS audio TurboModule**:
   - `clients/app/macos/voix-macOS/VoixAudio/` (or wherever brief
     specified) exists with Swift sources.
   - `clients/app/macos/Podfile.lock` mentions VoixAudio pod or
     autolink entry.
   - `bundle exec pod install` in macos/ succeeds.
   - macOS app builds: `bunx react-native run-macos --scheme voix-macOS`
     (use generous timeout, 600000ms).

5. **JS interface integrity**:
   - `packages/ui/src/platform/audioCapture.native.ts` now ROUTES
     between iOS (audio-api) and macOS (VoixAudio TurboModule) based
     on `Platform.OS`.
   - The interface (function signatures, event shapes) is byte-
     identical for both platforms — TalkButton consumes both
     identically.
   - macOS no longer throws "coming soon" for audio.

6. **Paste TurboModule**:
   - VoixPaste.swift exists with `copyToClipboard` and `paste`.
   - `copyToClipboard` is always callable (no Accessibility gate).
   - `paste` uses `AXIsProcessTrustedWithOptions(prompt: false)` — if
     not trusted, returns a typed error, not a crash.

7. **Hotkey integration**:
   - KeyboardShortcuts SPM dependency added (Podfile or Package.swift
     per Architect Decision 2).
   - Default chord configured per brief (⌃⌥Space).
   - Cannot test actual key-press here — mark Tom-pending.

8. **NSPanel overlay**:
   - Cannot test focus behaviour without driving a key press. Mark
     Tom-pending.
   - Read the NSPanel init code; confirm `canBecomeKey = false`
     (load-bearing per Architect's Decision 4 — if it could take
     focus, CGEventPost would paste into voix).

9. **Sasha interruption handler**:
   - iOS side: AVAudioSession.interruptionNotification observed in
     audio-api setup or a sibling subscription.
   - macOS side: equivalent on the new VoixAudio module.
   - Verify both impl files contain the subscription pattern.

10. **Carry-forward smoke**:
   - `bun run check` exits 0 (4 asserters now: native-siblings,
     protocol-sync, pin-bounds + whatever M22 added).
   - `cd voix-backend/ui && bun run build` still works.
   - `cd voix-backend && timeout 5 bun src/index.ts` reaches
     "listening on :8765".
   - `bunx tsc -p clients/app/tsconfig.json --noEmit` exit 0.

## Output

`docs/phase-6/verify-results/M22-tester.md` with VERDICT:

```
## VERDICT
- Receipts integrity: PASS | FAIL
- Acceptance criteria: N/M
- macOS audio loads without red-box: VERIFIED | UNVERIFIED
- Hotkey + overlay + paste: ALL TOM-PENDING (expected)
- Web + iOS regressions: NONE | <list>
- Recommendation: ship-as-is | fix-and-reship | rework
```
