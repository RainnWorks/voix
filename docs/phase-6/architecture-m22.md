# Phase 6 / M22 — macOS shell: hotkey + paste + native audio

Owner: Architect. Status: ready for Implementer.

Scope: macOS becomes a first-class client. Global hotkey opens a PTT
overlay; mic capture via a hand-rolled AVAudioEngine bridge; playback
via the same bridge; produced text lands in the clipboard and (with
Accessibility) pastes via CGEventPost into the focused app. iOS path
unchanged on the wire — same `AudioCapture`/`AudioPlayback`/`AppInfo`
contracts.

## Receipts

Files read (`stat -f "%Sm %z %N"`):

```
May 31 15:20:55 2026 23903 docs/phase-6/architecture-m21.md
May 31 16:07:29 2026 21345 docs/phase-6/verify-results/M21-adversary-sasha.md
May 31 15:04:07 2026 12598 docs/phase-6/verify-results/M20-tom-smoke.md
May 31 14:35:02 2026 19247 docs/build-workflow.md
May 31 15:51    2026  7200 packages/ui/src/platform/audioCapture.native.ts
May 31 15:51    2026  3000 packages/ui/src/platform/audioPlayback.native.ts
May 31 15:51    2026  4900 packages/ui/src/platform/inlineAudio.native.tsx
May 31 15:51    2026  2500 packages/ui/src/platform/appInfo.native.ts
May 31 15:51    2026  6900 packages/ui/src/platform/types.ts
May 31 15:51    2026 12500 packages/ui/src/conversations/TalkButton.tsx
                     1100 clients/app/package.json
                      700 clients/app/macos/voix-macOS/Info.plist
                      400 clients/app/macos/voix-macOS/voix.entitlements
                     1200 clients/app/macos/Podfile
```

`docs/phase-6/research-m22.md` does NOT exist at write time — the
Researcher is running in parallel. Decisions below are based on M21
ground truth + M20 smoke gaps + Sasha's M21 review. If the Researcher
contradicts a core call (e.g. demonstrates a maintained
`react-native-global-shortcut`), Coordinator escalates rather than
absorbs — these calls are load-bearing.

Protocol receipt: `packages/protocol/src/audio-io.ts:46` —
`ClientKind = "puck" | "phone-sat" | "laptop-mic" | "browser-tab" |
"external"`. M22 lights up `"laptop-mic"`.

---

## TL;DR

1. Hand-rolled Swift TurboModule for audio (AVAudioEngine). Same JS
   surface as iOS — no consumer changes.
2. Carbon `RegisterEventHotKey` via Sindre Sorhus's
   [`KeyboardShortcuts`](https://github.com/sindresorhus/KeyboardShortcuts)
   SPM package. Sandbox-OK, no Accessibility prereq.
3. Paste = CGEventPost of Cmd+V *after* clipboard write, gated by
   `AXIsProcessTrustedWithOptions`. Graceful copy-only fallback.
4. PTT overlay = borderless non-activating NSPanel at top-center,
   hosting an RCTRootView. Independent of main window.
5. **Step 1 of M22 ships a macOS window-screenshot tool** (M20's
   `screencapture -x` caught the login window). Without this, every
   verify is Tom-blocked.
6. macOS PTT semantics = `intent: "dictate"`. Hotkey-PTT is universal
   "speak to type"; "discuss" comes in M23+ via menu-bar item.

---

## Decision 1 — macOS audio: hand-rolled Swift TurboModule

Pin: AVAudioEngine TurboModule under
`clients/app/macos/voix-macOS/VoixAudio/`. Registered via RN-macOS
New Architecture codegen.

Files:

```
VoixAudio/
├── VoixAudioCapture.swift     // engine.installTap → PCM16 events
├── VoixAudioPlayback.swift    // AVAudioPlayerNode gapless queue
├── VoixAudioPermissions.swift // AVCaptureDevice.requestAccess(.audio)
└── VoixAudio.h                // ObjC bridging header
```

JS side: `audioCapture.native.ts` and `audioPlayback.native.ts` get a
`Platform.OS === "macos"` branch returning a Mac class that calls
`NativeModules.VoixAudio*`. The iOS classes stay; shared code is just
the inlined `floatToPcm16` helper (per-file per M21 Decision 1).

Rationale:

- `react-native-audio-api` is iOS-only (M21 Decision 2 receipts);
  PR'ing macOS is weeks. Hand-roll is days.
- The `AudioCapture` / `AudioPlayback` interfaces are frozen
  (`packages/ui/src/platform/types.ts:50-92`). M22 fills in two stub
  classes; orchestrator + TalkButton + daemon protocol untouched.
- AVAudioEngine is the right primitive: streaming PCM via
  `installTap(onBus:bufferSize:format:)` on `inputNode`; gapless out
  via `AVAudioPlayerNode.scheduleBuffer(...)`.

Format pins:

- **Mic**: PCM16LE mono. Sample rate = `inputNode.outputFormat(forBus:
  0).sampleRate` read post-`engine.start()` and surfaced as
  `MacosAudioCapture.sampleRate`. Hello declares THAT, not a guess
  (Sasha H1 carry-forward).
- **Speaker**: PCM16LE mono @ 24 kHz (daemon's native rate). Player
  node's `AVAudioFormat(commonFormat: .pcmFormatInt16, sampleRate:
  24000, channels: 1, interleaved: true)`. Engine resamples to the
  device output rate.
- **Buffer**: 1024 frames ≈ 64 ms — matches iOS budget.

Stereo→mono via `AVAudioConverter` (equal-gain downmix). Endianness:
native LE. `installTap` fires on the render thread — copy into a
`DispatchQueue.global(qos: .userInteractive)` for conversion + RCT
emit (must not block render).

Rejected: `react-native-audio-api` macOS PR (out of band);
`expo-audio` (file-shaped, not streaming); `react-native-webrtc`
(heavyweight, would fight our session).

---

## Decision 2 — Global hotkey: `KeyboardShortcuts` SPM package

Pin: Sindre Sorhus's `KeyboardShortcuts` SPM package
(<https://github.com/sindresorhus/KeyboardShortcuts>) wrapped in
`VoixHotkey.swift`. Default chord **⌃⌥Space** (Ctrl-Option-Space).

| Option | Verdict |
|---|---|
| (a) `react-native-global-shortcut` | Reject — unmaintained since 2021, no RN-macOS 0.81 New Arch support. |
| (b) Carbon `RegisterEventHotKey` direct | Risky — boilerplate-heavy, C-only signature, KeyboardShortcuts wraps this already. |
| (c) `KeyboardShortcuts` SPM | **Pin** — same Carbon API under the hood; ships a recorder UI (free M23 settings UI); maintained 2026; MIT; no Accessibility needed; sandbox-OK. |
| (d) `NSEvent.addGlobalMonitorForEvents` | Reject — needs Accessibility AND fires *after* the focused app receives the key, so Cmd+V can't be intercepted. |

Sandbox: Carbon hotkeys work inside app-sandbox with no extra
entitlements (current `voix.entitlements` is sufficient). Confirmed by
KeyboardShortcuts docs + sandboxed apps using it in production (Bear,
Things, Raycast-alts).

Press/release: `onKeyDown` / `onKeyUp` give hold-to-talk semantics
naturally. The bridge emits `voixHotkeyDown` / `voixHotkeyUp`; a JS
hook in `@voix/ui/src/macos/useGlobalHotkey.ts` drives `handlePressIn`
/ `handlePressOut` — TalkButton's existing surface.

Conflict handling: if the chord is owned, KeyboardShortcuts silently
no-ops. M22 logs the chord at boot + falls back hint in docs (⌃⌥V).
M23 ships the recorder UI for in-app rebind.

Default chord chosen because: ⌘Space = Spotlight; Fn-Fn = Apple
Dictation; ⌃Space = input source switch; ⌥Space = nbsp. ⌃⌥Space is
unowned by macOS defaults.

---

## Decision 3 — Paste: CGEventPost with Accessibility gate

Pin: `VoixPaste.swift` TurboModule:

```swift
@objc func copyToClipboard(_ text: String)
@objc func paste(_ text: String, resolver, rejecter)
// 1. NSPasteboard.general write (always)
// 2. AXIsProcessTrustedWithOptions(prompt:false)
//    → false → resolve({ pasted:false, copied:true })
// 3. CGEventPost Cmd+V down+up at .cgSessionEventTap
// 4. resolve({ pasted:true, copied:true })
```

The CGEventPost incantation (Tauri's archived `paste.rs` is the
reference):

```swift
let src = CGEventSource(stateID: .combinedSessionState)
let down = CGEvent(keyboardEventSource: src, virtualKey: 0x09, keyDown: true)
let up   = CGEvent(keyboardEventSource: src, virtualKey: 0x09, keyDown: false)
down?.flags = .maskCommand
up?.flags   = .maskCommand
down?.post(tap: .cgSessionEventTap)
up?.post(tap: .cgSessionEventTap)
```

`0x09` = virtual keycode for V. `.cgSessionEventTap` is the right
layer — posts into the session as if from a real keyboard, lands in
the focused app's first responder even when that app is sandboxed.
`.cghidEventTap` can lose to keyboards plugged in after voix started.

Accessibility detection — `AXIsProcessTrustedWithOptions([
kAXTrustedCheckOptionPrompt: false])` returns state without prompting.
On `not trusted`, JS-side overlay shows: *"Copied. Grant Accessibility
to auto-paste."* + button that opens System Settings via
`NSWorkspace.open("x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility")`.
We do NOT call the prompting variant — the system modal demands quit
+ relaunch and the user may deliberately want manual paste. Explicit
CTA is honest.

Focus race avoided by Decision 4 (overlay is non-activating panel).

---

## Decision 4 — PTT overlay: non-activating NSPanel HUD

Pin: borderless non-activating `NSPanel` at top-center of `.main`
screen, owned by `VoixOverlayWindowController.swift`, hosting a
`RCTRootView` rendering `@voix/ui/src/macos/MacOverlay.tsx`.

| Option | Verdict |
|---|---|
| (a) Second RCTRootView in separate undecorated NSWindow | **Pin** — but as NSPanel (non-activating subclass), not vanilla NSWindow. |
| (b) Modal sheet on main window | Reject — requires main window open; hotkey flow must not depend on that. |
| (c) Borderless floating HUD | Visual description of (a); same impl. |

Window config (the load-bearing flags):

```swift
class VoixOverlayPanel: NSPanel {
  // styleMask: [.borderless, .nonactivatingPanel]
  // level = .floating; isFloatingPanel = true
  // hidesOnDeactivate = false; isReleasedWhenClosed = false
  // collectionBehavior = [.canJoinAllSpaces, .stationary,
  //                       .ignoresCycle, .fullScreenAuxiliary]
  override var canBecomeKey: Bool { false }   // CRITICAL — Decision 3
  override var canBecomeMain: Bool { false }  // CRITICAL — Decision 3
}
```

`.nonactivatingPanel` + `canBecomeKey = false` is the load-bearing
pair: the panel renders but never steals first-responder, so
CGEventPost lands in the user's editor.

Geometry: 360×96 pt, top-center of `NSScreen.main`, 24 pt below the
menu bar. Re-positions on
`didChangeScreenParametersNotification`. `.canJoinAllSpaces` +
`.fullScreenAuxiliary` so it works over fullscreen apps and across
space changes.

Window-management edges: main window closed/minimised/hidden → overlay
independent. App hidden (⌘H) → overlay stays (intentional). No screens
attached → panel created off-screen, harmless; re-press recenters on
the new `.main` after reconnect.

`MacOverlay.tsx` is a thin wrapper around the existing `TalkButton`
with macOS-specific styling (⌃⌥Space hint, "Copied"/"Pasted" toast on
session end). Passes `intent="dictate"` per Decision 10.

---

## Decision 5 — Carry-forward from M21 verify

| Sasha finding | M22 disposition | Action |
|---|---|---|
| N1 worklets "optional" but required | Defer (doc only) | One-line comment in `clients/app/package.json` |
| Interruption observer | **Ship both platforms** | Add subscribe blocks to both `audioCapture.native.ts` paths (step 10) |
| M4 press-race flicker | Defer to M23 | None |
| H1 sample-rate fix | Already shipped in M21 | None — extended to macOS via Decision 1's rate-readback |
| H2 recorder-start fix | Already shipped in M21 | None |

Interruption spec: iOS subscribes to
`AudioManager.observe("interruption", ...)`; macOS subscribes to
`AVAudioSession.interruptionNotification` (yes, macOS has it via
AVFAudio). Both route through `opts.onError(new Error("audio
interrupted"))` → orchestrator's typed `kind: "audio"` event →
TalkButton's recovery copy. Closes Sasha's architectural pushback #1.
Free addition to iOS while we're in the file; load-bearing on macOS
where USB headset hot-swap is common.

Why M4 defers: cosmetic only, present on web + iOS today, and the
hotkey-press semantics (Carbon key-down → key-up) have a different
debounce profile than touch (OS-quantized, can't be sub-30ms).
1-frame delta same as iOS.

---

## Decision 6 — macOS visual smoke: window-specific capture tool

Pin: M22's **first commit** ships
`tools/voix-window-screenshot/voix-window-screenshot.swift` (~80 LOC,
no external deps, `swiftc` built) + `scripts/macos-screenshot.sh`
wrapper.

The constraint: M20 caught the login window because the Mac was
locked. There is no real fix for "Mac is locked" — Apple blocks GUI
access from a locked screen by design. Even XPC services that run
out-of-session can't render windows. The pragmatic moves:

The tool's behaviour:

1. Iterate `CGWindowListCopyWindowInfo`.
2. Filter `kCGWindowOwnerName == "voix"`.
3. `CGWindowListCreateImage(...)` for that window, write PNG.
4. **Before all this**: check `CGSessionCopyCurrentDictionary` for
   `kCGSSessionOnConsoleKey`. If not on console (i.e. locked), exit
   2 with `"screen is locked — cannot screenshot"`. Tom (or Claude)
   gets a real error, not a login-window PNG.

This works when the screen is **on** AND **unlocked**, even if voix
is in the background — captures the voix window specifically, not
whatever the foreground app is. Fails cleanly otherwise.

Tom's manual states the lock-screen constraint explicitly: "Screenshot
capture requires your Mac to be unlocked. Unlock first via Touch ID,
password, or Watch unlock." Set expectation; no magic available.

`caffeinate -u -t 5` (waking sleep) is documented as a hint when the
screen is just asleep but the session is unlocked.

---

## Decision 7 — Migration order

Web-build + iOS-PTT invariants from M21 carry forward. Every step
preserves both.

| # | Commit | What | Smoke |
|---|---|---|---|
| 1 | `tools: voix-window-screenshot for macOS verify` | Swift CLI + wrapper script. No app changes. | Claude runs it; locked→exit 2; unlocked→PNG of voix window. No Tom required. |
| 2 | `verify: M20 macOS visual baseline` | Claude runs M20's smoke with the new tool. Saves PNG to `docs/phase-6/verify-results/M20-tom-smoke-followup.md`. No code changes. | M20 closed for real. |
| 3 | `clients/app(M22): macOS audio module skeleton` | `VoixAudio/` files w/ empty methods; TurboModule registration in `AppDelegate.mm`; codegen clean. No JS changes. | iOS PTT works; macOS build succeeds; macOS TalkButton still shows the M21 "audio coming soon". |
| 4 | `clients/app(M22): macOS AVAudioEngine capture` | Fill `VoixAudioCapture.swift`. JS `audioCapture.native.ts` gains macOS branch returning `MacosAudioCapture`. | iOS PTT unchanged; macOS TalkButton (main window) opens mic + ships frames to daemon. Playback still stubbed — half-duplex test. |
| 5 | `clients/app(M22): macOS AVAudioPlayerNode playback` | Fill `VoixAudioPlayback.swift`. JS `audioPlayback.native.ts` macOS branch. | iOS unchanged; macOS full PTT round-trip in main window. |
| 6 | `clients/app(M22): KeyboardShortcuts SPM + bridge` | Add SPM dep to `voix-macOS.xcodeproj`. `VoixHotkey.swift` registers ⌃⌥Space; emits down/up. JS `useGlobalHotkey()` hook. | Press ⌃⌥Space anywhere; voix logs the event. Overlay not yet shown. |
| 7 | `clients/app(M22): NSPanel overlay + MacOverlay` | `VoixOverlayWindowController.swift` + `MacOverlay.tsx`. Hotkey down shows; up hides. TalkButton inside. | ⌃⌥Space → overlay top-center → mic opens → "hello voix" → reply plays → release → overlay hides. |
| 8 | `clients/app(M22): VoixPaste + clipboard write` | `VoixPaste.swift` with `copyToClipboard` only. MacOverlay writes transcript on session end + shows "Copied" toast. | End-to-end except paste: hotkey + speak + release → clipboard has transcript. Manual Cmd+V works anywhere. |
| 9 | `clients/app(M22): CGEventPost + Accessibility detection` | Add `paste()`. MacOverlay calls it. "Grant Accessibility" CTA when `pasted:false`. | First run: copy-only (Accessibility unset); click CTA → Settings opens → grant → next session pastes. |
| 10 | `clients/app(M22): interruption observer (both platforms)` | Subscribe + route to `opts.onError`. | iOS phone-call mid-PTT → typed error; macOS USB unplug mid-PTT → typed error. |
| 11 | `clients/app(M22): clientKind + worklets comment` | macOS branch → `"laptop-mic"` (Sasha M2). package.json comment (Sasha N1). | Daemon Surfaces shows macOS as `laptop-mic`. |
| 12 | `docs: M22 close-out` | `m22-manual.md`, STATE.md, risk register. | Tom runs the manual; all green. |

Why this order: step 1 is unblocking (verify tool). Step 2 closes the
M20 gap as a side effect, before M22 touches the macOS app — so
visual bugs from M21 surface here, not buried inside M22's audio
work. Steps 3-5 = audio bridge in three increments (skeleton/capture/
playback). Steps 6-7 = shell (hotkey then overlay) — hotkey first
because headless-testable. Steps 8-9 = paste in two halves so copy-only
is functional after step 8. Step 10 = Sasha's interruption ask,
isolated near the end.

Step 1 ships without depending on Tom-confirmation. Step 2's verify is
also Claude-runnable.

---

## Decision 8 — Risk register

| # | Risk | Detect | Mitigate |
|---|---|---|---|
| 1 | **AVAudioEngine sample-rate surprise.** Built-in mic at 44.1 kHz; we declare 16 kHz; daemon resamples wrong → garbled transcript. (Sasha H1 on macOS.) | First Tom-day macOS dictate produces nonsense while iOS works. | Read `inputNode.outputFormat(forBus:0).sampleRate` post-engine-start. Surface as `capture.sampleRate`. Hello declares THAT. Daemon resamples from hello (M21 receipts). |
| 2 | **Hotkey chord conflict.** ⌃⌥Space owned by Alfred, Raycast, or a third-party HUD. KeyboardShortcuts silently no-ops. | Tom presses; nothing; no error. | Log "voix hotkey: ⌃⌥Space (rebind in Settings — M23)" at boot. Document fallback ⌃⌥V. M23 ships KeyboardShortcuts recorder UI for in-app rebind. |
| 3 | **Accessibility denial UX stuck.** User grants Accessibility, but macOS caches trust per-binary; debug-build binary signature changes invalidate trust → "I granted it and it still doesn't paste". | Tom grants; next session still "Copied (not pasted)". | At app launch, log `AXIsProcessTrustedWithOptions(prompt:false)` result; overlay shows trust status under toast. Tom's manual notes: "after granting, fully quit + relaunch; debug builds may need re-grant on rebuild." |
| 4 | **Overlay steals focus → CGEventPost pastes into overlay.** Load-bearing on `canBecomeKey = false`. Future change loses this → silent paste misfire. | Tom hits hotkey, dictates, releases — clipboard correct but paste invisible (overlay has no text input). | Comment in `VoixOverlayPanel.swift`: "DO NOT change `canBecomeKey`/`canBecomeMain` — load-bearing for paste flow." Step 9 smoke: paste lands in Notes, not nothing. |
| 5 | **React-19 + RN-macOS-0.81 Swift TurboModule codegen.** Rough edges on Swift modules; `@objc(RCT...)` drift between Swift impl and codegen binding silently fails at link, or builds but `NativeModules.VoixAudio*` is `undefined` at runtime. | Step 3 fails to build, OR macOS TalkButton crashes with "cannot read property start of undefined" instead of M21 placeholder. | Codegen on every build via `react_native_pods.rb` post_install (current Podfile). Step 3 smoke: TalkButton on macOS still shows the M21 placeholder, NOT an undefined error. Diagnostic: log `VoixAudioCapture available: <bool>` from JS at app boot. |

Bonus (not top 5): TestFlight signing for Accessibility prompt UX
(M23 concern). For Tom's dev box, current signing is fine.

---

## Decision 9 — Tom's M22 manual

Saved verbatim as `docs/phase-6/m22-manual.md` (step 12). Load-bearing
step is **5** (hotkey + overlay + paste end-to-end). Everything before
step 4 is Claude-runnable.

**0. Pre-flight.**

```bash
cd /Users/tom/Projects/voix && git status && git log -1 --oneline
```

**1. Workspace refresh + pods (macOS only — iOS unchanged).**

```bash
cd /Users/tom/Projects/voix && bun install
cd clients/app/macos && bundle exec pod install
```

Recovery: pods fail on `cli-platform-apple not found` → M20-surprise-1
manual symlink.

**2. Confirm M20 baseline.**

```bash
bash scripts/macos-screenshot.sh    # screen must be unlocked
```

Expected: PNG at `/tmp/voix-macos-window.png` showing sidebar +
Voices. If locked → script exits 2 with a clear message; unlock and
re-run.

**3. Start daemon + Metro.**

```bash
cd voix-backend && bun src/index.ts &
cd clients/app  && bun run start &
```

**4. Run macOS app.**

```bash
cd clients/app && bun run macos
```

Expected (first build 2-4 min):

- voix-macOS window appears with sidebar + Voices.
- Press **⌃⌥Space** anywhere — even with another app focused.
- Overlay panel slides in top-center: "Listening".
- Speak: "voix, are you there?"
- Release ⌃⌥Space. Overlay shows "Copied" or "Pasted".

Recovery: nothing on press → check console for "voix hotkey:
⌃⌥Space"; if absent, restart voix. If present but chord is owned →
try ⌃⌥V.

**5. Accessibility grant + paste (load-bearing).**

Open TextEdit. Press ⌃⌥Space, say "hello from voix on macOS",
release.

- Accessibility already granted → text appears via CGEventPost.
- Not granted → overlay: "Copied. Grant Accessibility to auto-paste."
  Click "Open Settings". Toggle voix on. **Fully quit voix (⌘Q),
  re-launch from step 4.** Re-test: text appears.

Recovery: text lands but is previous clipboard → CGEventPost ran
before pasteboard write completed. Bug; file as follow-up.

**6. Interruption smoke (optional).**

Plug a USB mic mid-session; release should fire typed `kind: "audio"`
error in recovery copy. Skip if no USB mic.

**7. iOS regression.**

```bash
cd clients/app && bunx react-native run-ios --simulator="iPhone 16 Pro"
```

PTT works end-to-end same as M21.

**8. Web regression.**

```bash
cd voix-backend/ui && bun run build
```

Open HA add-on UI; web PTT works.

**9. Acceptance reporting.** Done message: macOS hotkey + dictate +
paste working; iOS PTT still works; web PTT still works.

---

## Decision 10 — macOS PTT intent: dictate by default

Pin: macOS hotkey-PTT uses `intent: "dictate"`. The current TalkButton
hardcodes `"discuss"` (line 67 of `TalkButton.tsx`) — that's correct
for the in-app big-button (user focused on voix, wants a chat). The
hotkey gesture has different semantics.

| | Hotkey-PTT (macOS overlay) | In-app big-button PTT |
|---|---|---|
| User context | Focused on another app | Focused on voix |
| Expected output | Text in focused app's cursor | Spoken reply |
| Latency budget | Sub-second (typing) | Conversational |
| Wrong-mode failure | "I asked it to type and it talked" — jarring | "I expected chat, got transcript" — recoverable |

Hotkey gesture's natural metaphor is "speak to type" — Apple's own
Dictation uses the same shape (Fn-Fn). Users hit ⌃⌥Space because
they want voice into the cursor.

Shipping shape: extend TalkButton with an optional `intent` prop
(default `"discuss"` — preserves web/iOS). MacOverlay passes
`intent="dictate"`. One-line API addition.

```tsx
// packages/ui/src/conversations/TalkButton.tsx
export function TalkButton({
  onSessionEnded,
  intent = "discuss",       // default keeps web + iOS unchanged
}: {
  onSessionEnded?: () => void;
  intent?: "dictate" | "discuss";
}) { /* uses intent in BrowserAudioIoClient at line 67 */ }

// packages/ui/src/macos/MacOverlay.tsx
<TalkButton intent="dictate" onSessionEnded={onSessionEnded} />
```

The voice the orchestrator picks is whatever the per-device "default
dictate voice" is — daemon already does `(intent, voice_id)` lookup
from M05.

Discuss-via-hotkey is M23 work: a menu-bar item toggles intent, or a
separate `discussHotkey` binding ships in the M23 settings screen.
M22 doesn't ship the toggle because discuss-via-overlay has UX
ambiguity (where does the spoken reply come from? Overlay? System
speaker? Audio loop if user isn't wearing headphones?). Dictate is
the universal case; discuss is power-user.

---

## Acceptance criteria

M22-complete when all hold (Tom-verifiable in one session):

1. `bash scripts/macos-screenshot.sh` captures the voix-macOS window
   when unlocked; exits 2 with a clear message when locked.
2. `cd clients/app && bun run macos` builds + launches; main window
   renders sidebar + Voices.
3. Pressing ⌃⌥Space with another app focused brings up overlay
   top-center, regardless of voix's main-window state.
4. Releasing the hotkey closes the overlay and ends the session.
5. Speaking during the press produces a transcript that:
   - Always lands in the clipboard.
   - Pastes into the focused app IF Accessibility is granted.
   - Shows a "Grant Accessibility" CTA otherwise.
6. Granting Accessibility via the CTA + relaunching activates paste
   on the next session.
7. The overlay does NOT take key window — CGEventPost lands in the
   previously focused app, not in voix.
8. macOS sessions in the daemon's Surfaces table appear as
   `kind: "laptop-mic"`.
9. iOS PTT still works end-to-end (M21 regression).
10. Web PTT still works (M21 regression).
11. Interruption events (iOS phone call / macOS route change) surface
    the typed `kind: "audio"` error in TalkButton recovery copy.
12. `docs/STATE.md` marks M22 closed; `docs/phase-6/m22-manual.md`
    exists.

Out of scope: discuss-via-hotkey (M23), settings screen for hotkey
rebind (M23), TestFlight signing UX (M23), iOS keyboard extension
(M24), worklets-optional docs cleanup (M23 deps pass), TalkButton
press-race flicker (M23).

---

## Coordinator deltas slot

(Empty at write time. Verify trio fills in if material gaps surface
pre-merge. Default per §7 of agent-team-workflow: each delta adds an
action item to the relevant Decision + one acceptance criterion. Hard
ceiling: 3 deltas before re-planning.

Researcher's report lands in parallel at
`docs/phase-6/research-m22.md`. If it contradicts Decisions 2 or 3
(load-bearing), Coordinator escalates rather than absorbs.)
