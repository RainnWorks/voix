# Yuki's adversarial review of M22

I read the implementer report, architecture doc, the diff
(`git diff 1fd733a..HEAD`), every Swift file under
`clients/app/macos/VoixNative/Sources/`, both .m bridge layers, the
ObjC AppDelegate, both Info.plist + voix.entitlements,
`MacOverlay.native.tsx`, `useGlobalHotkey.native.ts`,
`audioCapture.native.ts`, `audioPlayback.native.ts`,
`appInfo.native.ts`, the `voix-window-screenshot.swift` tool, and
the Podfile + podspec. Twelve commits, ~3 k LOC, hand-rolled Swift
bridges. The empty Blockers + High in the implementer's deltas
section ("None that qualify") is exactly the smell I was sent here
to investigate. It does not survive contact.

## Receipts

`stat -f "%Sm %z %N"`:

```
May 31 16:52:42 2026  10323  clients/app/macos/VoixNative/Sources/VoixAudioCapture.swift
May 31 16:42:08 2026   6501  clients/app/macos/VoixNative/Sources/VoixAudioPlayback.swift
May 31 16:37:02 2026   3318  clients/app/macos/VoixNative/Sources/VoixAudioPermissions.swift
May 31 16:44:50 2026   6734  clients/app/macos/VoixNative/Sources/VoixHotkey.swift
May 31 16:46:03 2026   6961  clients/app/macos/VoixNative/Sources/VoixOverlay.swift
May 31 16:50:16 2026   5657  clients/app/macos/VoixNative/Sources/VoixPaste.swift
May 31 16:50:59 2026   9470  packages/ui/src/macos/MacOverlay.native.tsx
May 31 16:44:07 2026   3024  packages/ui/src/macos/useGlobalHotkey.native.ts
                       1023  clients/app/macos/voix-macOS/voix.entitlements
                        700  clients/app/macos/voix-macOS/Info.plist
```

Diff range: `1fd733a..HEAD` — 31 files changed, +2868 / −41.
`grep` confirmations cited inline below.

---

## Findings, by severity

### Blockers

#### B1 — Sandboxed app, NSMicrophoneUsageDescription set, but `com.apple.security.device.audio-input` entitlement is missing

`clients/app/macos/voix-macOS/voix.entitlements` declares:

```
com.apple.security.app-sandbox            = true
com.apple.security.files.user-selected.read-only = true
com.apple.security.network.client         = true
```

That's it. No `com.apple.security.device.audio-input`. Apple's
sandbox rules (App Sandbox Design Guide → Hardware Access) are
explicit: **a sandboxed macOS app MUST declare
`com.apple.security.device.audio-input` to use the microphone**.
`NSMicrophoneUsageDescription` alone (which Info.plist does set,
line 40-41) is necessary but not sufficient inside the sandbox —
without the entitlement, `AVCaptureDevice.requestAccess(for: .audio)`
returns denied, and `AVAudioEngine.inputNode.outputFormat(forBus:0)`
reports zero channels.

Reading the implementer's guard in
`VoixAudioCapture.swift:140-147`:

```swift
guard sampleRate > 0, channelCount > 0 else {
    throw NSError(... "input node reports zero channels — no mic device available")
}
```

This is the EXACT error Tom will hit. Cause looks like "no mic
device available", but the underlying reason is the missing
entitlement. Multi-hour misdiagnosis material.

**Why this wasn't caught at smoke time**: the implementer ran
`xcodebuild` to BUILD SUCCEEDED but never ran the app + pressed
the hotkey + opened the mic. Build success ≠ runtime success.
"Smoke = build" is a pattern I see a lot in hand-rolled bridges
and it doesn't catch sandbox + entitlement bugs.

**Fix**: add to entitlements:

```xml
<key>com.apple.security.device.audio-input</key>
<true/>
```

**Falsification**: at step 5 of the manual, Tom presses ⌃⌥Space →
overlay opens → no audio frames → daemon stays at `connecting` or
times out. The fix above flips this to working.

#### B2 — `RCT_EXTERN_MODULE` with `RCTNewArchEnabled=true` in Info.plist — bridge / codegen mismatch

Info.plist line 48:

```xml
<key>RCTNewArchEnabled</key>
<true/>
```

Every `.m` file in `VoixNative/Sources/` uses the **legacy bridge**
macros:

```objc
@interface RCT_EXTERN_MODULE(VoixAudioCapture, RCTEventEmitter)
RCT_EXTERN_METHOD(...)
@end
```

`RCT_EXTERN_MODULE` is the legacy bridge primitive (old arch). The
new architecture wants a codegen'd TurboModule spec (CXX
interop, `RCTTurboModule` protocol, `@TurboModule` annotation in a
codegen spec, registered via `RCTAppDependencyProvider`). The
architecture doc explicitly says "Registered via RN-macOS New
Architecture codegen" (Decision 1).

What happens at runtime in mixed mode (NewArch on, legacy
RCT_EXTERN_MODULE present): RN-macOS 0.81's bridge-compat shim
typically still loads legacy bridge modules — so this might "work"
— but you also lose the codegen-generated type-safe spec, the
synchronous-method dispatch, and you risk `NativeModules.VoixAudio*`
being `undefined` at JS load time because `RCTAppDependencyProvider`
(referenced in `AppDelegate.mm` line 14) only registers TurboModules
it has codegen specs for.

This is risk #5 in the architecture doc verbatim, with the
diagnostic the architect specced ("`NativeModules.VoixAudio*` is
undefined at runtime") — and the implementer has not added the
boot-time log the architect specced ("`VoixAudioCapture available:
<bool>` from JS at app boot"). So if it does silently fall off,
Tom won't know why.

**This may not blow at build time and may not even blow on first
JS load — but it's load-bearing on bridge-compat working in mixed
mode, with no diagnostic + no fallback.** That's a blocker for
trust.

**Mitigations** (pick one):
1. Set `RCTNewArchEnabled=false` in Info.plist for M22, document
   the deferred TurboModule migration to M23.
2. Add the `console.log("VoixAudioCapture available:",
   !!NativeModules.VoixAudioCapture)` boot log so Tom can diagnose.
3. Convert the .m files to proper TurboModule specs (significant
   refactor — pushes M22 beyond the 240 min ceiling).

I'd pick (1) for M22 + (2) for cheap insurance.

**Falsification**: Tom runs the app. Open the JS console. If
`NativeModules.VoixHotkey` is `undefined`, hotkey doesn't register,
hold-to-talk is dead. If it works, the implementer got lucky with
bridge-compat. Either way, the diagnostic log should ship.

#### B3 — `kEventHotKeyReleased` is not reliably delivered by Carbon on macOS 14+; release-on-key-up may never fire when voix isn't focused

`VoixHotkey.swift:104-108`:

```swift
var eventTypes: [EventTypeSpec] = [
    EventTypeSpec(eventClass: OSType(kEventClassKeyboard),
                  eventKind: UInt32(kEventHotKeyPressed)),
    EventTypeSpec(eventClass: OSType(kEventClassKeyboard),
                  eventKind: UInt32(kEventHotKeyReleased)),
]
```

The implementer registered both. The architecture doc claims
"Press/release: `onKeyDown` / `onKeyUp` give hold-to-talk semantics
naturally" (Decision 2).

Reality I've eaten three weekends over: **Carbon emits
`kEventHotKeyReleased` only when all modifiers + the chord key go
up, and only when the application receiving the event is the
target of the keyboard focus chain.** For voix's case — user is
focused on TextEdit, presses ⌃⌥Space — Carbon's hotkey dispatch
delivers `kEventHotKeyPressed` to voix's event handler (good,
that's what RegisterEventHotKey is for). On release, Carbon
typically delivers `kEventHotKeyReleased` to voix as well, but
this is the path with **documented inconsistency on
macOS 13/14/15** depending on input source (US vs non-US),
modifier order, and whether another app is doing
`addLocalMonitorForEvents`.

KeyboardShortcuts (the SPM package the architect picked and the
implementer skipped per Note A) gets around this by using a
**state machine**: it tracks the chord state with
`NSEvent.addGlobalMonitorForEvents(matching: .flagsChanged)` to
detect when modifiers are released, **without depending on
`kEventHotKeyReleased`**. The implementer's reimplementation of
"Path B" did not port this state machine — it just trusts Carbon's
release event.

`RegisterEventHotKey` with `inOptions = 0`
(`VoixHotkey.swift:132`) — that's `kEventHotKeyNoOptions`, not
`kEventHotKeyExclusive`. Without `kEventHotKeyExclusive`, the
release event is even MORE flaky because the hot key isn't
"owned" by the registered handler.

**Symptoms**: Tom presses ⌃⌥Space, overlay shows, he speaks, he
releases — overlay never hides, mic never closes, daemon WS hangs
until the idle timeout. **Or**: the release fires inconsistently
— sometimes overlay closes, sometimes it stays open until next
press. Either flavour is the "intermittent native bug" that
chewed up my career.

**Mitigations**:
1. Add a backup `flagsChanged` global monitor that fires `onUp`
   when EITHER Ctrl or Option goes up while the panel is shown.
   `addGlobalMonitorForEvents(matching: .flagsChanged)` works
   WITHOUT Accessibility (only `.keyDown` / `.keyUp` need it).
2. Swap to the architect's original pick (KeyboardShortcuts SPM)
   — Note A's deferral was the wrong call.
3. Add `kEventHotKeyExclusive` (`inOptions = UInt32(1)`) — partial
   fix at best.

**Falsification**: Tom presses + holds + releases. Watch the
console log for `voixHotkey.up`. On first run, especially with a
non-US keyboard layout or any input-method tool active (Alfred,
Karabiner), the up event will be missing or late by seconds.

---

### High

#### H1 — Overlay panel config is missing several load-bearing flags; the comment in source claims they're set but the code doesn't set them

`VoixOverlay.swift:111-134` shows the constructor:

```swift
panel.level = .floating
panel.isFloatingPanel = true
panel.hidesOnDeactivate = false
panel.isReleasedWhenClosed = false
panel.collectionBehavior = [.canJoinAllSpaces, .stationary,
                            .ignoresCycle, .fullScreenAuxiliary]
```

What's missing vs my brief's "necessary but not sufficient" list:

1. **No `becomesKeyOnlyIfNeeded` set.** NSPanel default is `false`
   on the `becomesKeyOnlyIfNeeded` property. The `canBecomeKey`
   override returns `false` unconditionally — good — but a mouse
   click inside the panel content view still triggers AppKit's
   "make-key-on-click" pathway via `mouseDown`. The implementer
   did NOT override `mouseDown` to drop the event. Today the panel
   has only static text labels so there's no clickable target —
   but the moment someone adds a button inside the HUD (M23
   recorder UI for hotkey rebind, the architect's own roadmap),
   the click activates voix, focus moves, and the next paste
   misfires.
2. **`isMovableByWindowBackground` not set.** NSPanel default is
   `false`, but borderless panels often get this set true by RN's
   RCTRootView container (depends on RN-macOS version). Should
   explicitly set `false`.
3. **`worksWhenModal = true`** is NOT set. If the user has a
   modal open in voix (Settings sheet in M23+), the overlay
   stops responding because non-modal panels are blocked.
4. **No `mouseDown` override** that no-ops the focus-change path.
   This is paired with #1 above.
5. **`acceptsMouseMovedEvents = false`** not set explicitly.
   Defaults vary. Not load-bearing today but a future hover
   handler would steal focus.

The implementer commented `// CRITICAL — Decision 3 paste flow`
on the `canBecomeKey` override (good!) but didn't carry the same
discipline to the other load-bearing flags. This is the textbook
"works in the smoke, fails in the wild" pattern.

**Falsification**: today, with no clickable content in the panel,
the missing flags are latent. The blocker is whether a future M23
change will silently break paste. **Add the flags + the
`mouseDown` override now**, because the next person editing this
file won't remember the constraint.

#### H2 — AVAudioEngine config-change observer fires the error but doesn't tear down or rebuild the engine; mid-session it leaks the bad engine state

`VoixAudioCapture.swift:172-186`:

```swift
configChangeObserver = NotificationCenter.default.addObserver(
    forName: .AVAudioEngineConfigurationChange,
    object: engine,
    queue: .main
) { [weak self] _ in
    guard let self = self, self.isRunning else { return }
    if self.hasListeners {
        self.sendEvent("voixAudioCapture.error", [
            "message": "audio route changed mid-session ...",
        ])
    }
}
```

Comment in source says: *"Don't tear down ourselves — that would
leak the stop responsibility."*

Wrong call, for two reasons:

1. **`AVAudioEngineConfigurationChange` invalidates the engine's
   internal node graph.** Apple's docs: "*you must stop the
   engine, reconfigure it if needed, and restart it*". The
   implementer emits an error event and lets the engine continue
   running. The engine's `inputNode.outputFormat(forBus:0)` is
   now stale; subsequent taps may deliver wrong-rate frames, or
   the tap closure may simply stop firing without an error. The
   JS-side orchestrator will see neither frames nor an explicit
   shutdown — just silence.
2. **The negotiatedSampleRate is not re-read.** If a USB mic
   gets unplugged and the built-in mic takes over at a different
   rate, the daemon still believes hello-time rate. Garbled
   transcript (Sasha H1 risk that the architect explicitly cited
   in Decision 8 row 1 — defeated by this code).

**Fix**: in the observer, do `try? engine.stop()`, re-read
`inputNode.outputFormat(forBus:0)`, re-install the tap, restart.
If any of that fails, THEN emit the error.

**Also missing**: the observer is added inside `beginCapture()`
AFTER `engine.start()` (line 188). The comment says "BEFORE
start() so we catch races" — but the code adds it after, AND adds
it before start. Wait, re-reading: the observer is added at 172,
`try engine.start()` at 188. Yes added before start. Good. But
the bigger issue (no rebuild) stands.

#### H3 — VoixAudioPlayback `attach/detach` the player node on every start/stop; AVAudioEngine state machine doesn't like this

`VoixAudioPlayback.swift:169-184`:

```swift
private func beginPlayback() throws {
    ...
    engine.attach(player)
    engine.connect(player, to: engine.mainMixerNode, format: fmt)
    try engine.start()
}

private func endPlayback() {
    player.stop()
    engine.stop()
    engine.disconnectNodeOutput(player)
    engine.detach(player)
    ...
}
```

The architect's adversarial task explicitly flagged this: "Audio
graph rebuild on every start/stop. AVAudioEngine is expensive to
construct. Spec: engine constructed once at module init,
started/stopped per session."

The implementer kept `engine` and `player` as class instance vars
constructed once (good!) — but the **attach/connect/detach/disconnect
cycle re-runs every PTT session**. This is roughly the same cost as
rebuilding the graph: `attach` performs node validation,
`connect` triggers mainMixerNode initialization (which queries
output device format), and `engine.start()` after `detach`
sometimes throws on later sessions in my experience.

There's also a subtler bug: the `nextPlayerSampleTime` watermark
resets to 0 on `endPlayback` but the player node's internal frame
position carries across sessions because `engine.detach(player)`
followed by `engine.attach(player)` may or may not reset the
player's clock depending on macOS version. The gapless scheduling
is therefore session-1-correct but session-N-uncertain.

**Fix**: attach + connect ONCE at module init; on stop, just
`player.stop()` + `engine.stop()`. On start, just `engine.start()`
+ first `pushFrame` triggers `player.play()`.

Risk: low-medium for first-session correctness; high for "I just
used voix three times in a row and the third time was silent."

#### H4 — Sandbox `automation` entitlement absent → CGEventPost may be blocked into some target apps

macOS 14+ (Sonoma) added a new layer: even with Accessibility
granted, sandboxed apps that synthesize keystrokes into another
app may need `com.apple.security.automation.apple-events` for
certain targets. **TextEdit will accept the synthesized Cmd+V**,
which is why "test in TextEdit" is the architect's smoke. But
Notes, Mail, Safari (textareas), Slack, VS Code each have stricter
filters. VS Code in particular has rejected CGEventPost-synthesized
events in the past depending on the build (Electron + sandboxing
quirks).

The architect's manual step 5 specifies TextEdit explicitly,
which is the "easy mode" target. Real Tom-use is paste into
Slack / Notes / Mail / VS Code. Decision 3 mentioned this as a
known risk but didn't add the entitlement.

**Falsification**: Tom hits ⌃⌥Space focused in Slack, dictates,
releases. Clipboard gets the text (always) but Cmd+V is silently
dropped or pastes nothing. The "It worked in TextEdit" suspicion
incarnate.

**Mitigation**: I'd document that M22 ships TextEdit-grade paste
and that broader target support is M23 (deeper entitlements +
maybe Login Items helper).

#### H5 — The paste sequence does NOT hide the overlay before CGEventPost; relies on `nonactivatingPanel` invariant

Reading `MacOverlay.native.tsx:202-249` (`onSessionEnded`):

```ts
const result = await paste.paste(transcript);
if (result.pasted) {
  void overlay?.updateStatus("Pasted").catch(() => {});
}
...
setTimeout(() => void overlay?.hideOverlay().catch(() => {}), 1400);
```

The overlay stays VISIBLE during CGEventPost (the 50ms delay
inside `paste()` + the 1400ms `updateStatus → hideOverlay` cycle).
The non-activating panel + `canBecomeKey=false` + the fact that
voix.app was never activated should mean the keystroke lands in
the previously focused app. **But there is one path the
implementer missed:**

When `BrowserAudioIoClient` opens the mic, on **first launch**
the system shows the mic permission dialog. **That dialog steals
focus to voix.** After the user clicks Allow, voix is now the
front app. The very first ⌃⌥Space session after a fresh install
will paste into voix's own window (no text field, so the
keystroke is dropped to nothing visible — looks like "paste
failed" to Tom). Subsequent sessions are fine because the
permission is already cached.

Architecture didn't anticipate the dialog-steals-focus race. The
implementer didn't either.

**Mitigation**: gate the first-launch flow on the JS side by
calling `VoixAudioPermissions.requestMicrophone()` at app boot
(outside the hotkey path), so the dialog fires when voix is
already focused and dictation is not yet expected.

**Falsification**: Tom resets mic permission via `tccutil reset
Microphone <bundle-id>`, then runs the full step 5. First press
won't paste; second press will. If the second press works, this
is the cause.

#### H6 — Accessibility cache-per-binary on debug rebuilds: documented but unhandled

Architecture risk register #3 said: "Tom's manual notes: 'after
granting, fully quit + relaunch; debug builds may need re-grant
on rebuild'." The implementer documented this in the manual (step
5) but didn't:

1. Detect "trust was granted yesterday but lost today" — the boot
   log at MacOverlay.native.tsx:159-175 logs the CURRENT trust
   state but doesn't compare to a persisted last-known-state. So
   the user gets the same log line whether they freshly granted
   or this is the 47th run after re-trust was silently invalidated.
2. Add a "re-grant Accessibility" CTA path that uses the
   PROMPTING variant of `AXIsProcessTrustedWithOptions`. The
   implementer chose non-prompting (good default!) but **left no
   user-triggered prompting path**. From the brief: "is there a
   separate prompting code path the user triggers explicitly
   ('Grant Accessibility'), and does that one actually prompt?"
   **No, there isn't.** The CTA at
   MacOverlay.native.tsx:236 calls
   `perms.openAccessibilitySettings()` — which opens Settings,
   but never invokes the prompting variant. So on a fresh debug
   rebuild, the user is stuck: tccutil shows voix still in the
   list (with a checkmark!), voix.app is still in the
   Accessibility list, the read-only check returns false because
   the binary signature changed, but there's no way to retrigger
   trust without manually removing + re-adding voix in System
   Settings.

**Fix**: add a `requestAccessibility()` Swift method that calls
the prompting variant `AXIsProcessTrustedWithOptions([key: true])`.
Wire to a "Grant Accessibility" button in the overlay. When that
button is pressed (which requires the user to actually click —
overlay isn't key, so make this a separate window or main app
button), the system shows the official Apple prompt that DOES
flush stale trust.

**Falsification**: Tom grants Accessibility, paste works, Claude
runs `bun run macos` again (rebuild), Tom presses ⌃⌥Space, paste
fails with "Copied, grant Accessibility" — Tom opens Settings,
toggle is ON, toggling off + on doesn't help, only "remove + re-add"
fixes it. The implementer's flow has no recovery for this.

---

### Medium

#### M1 — Chord conflict detection returns `ok:false` to JS but JS only `console.warn`s; no surfaced UI

`VoixHotkey.swift:139-141` resolves `{ok: false, chord:
"ctrl+opt+space", errorCode: <OSStatus>}` on conflict.
`useGlobalHotkey.native.ts:73` logs the result. `MacOverlay.native.tsx:147-154`
console.warns when `!registration.ok`. **There's no surfaced
UI for conflict** — Tom presses ⌃⌥Space, nothing happens,
overlay never shows, and the only signal is in the dev console.

The architect speccd this in Decision 8 risk #2: "Log 'voix
hotkey: ⌃⌥Space (rebind in Settings — M23)' at boot. Document
fallback ⌃⌥V."

`useGlobalHotkey.native.ts` line 73 has the log. But there's no
fallback to ⌃⌥V — that was specced as a documented alternative
but the implementer didn't implement an alternate chord. If
Tom has Alfred bound to ⌃⌥Space, he gets nothing.

**Mitigation cheap**: try ⌃⌥Space first; on `ok:false`, try
⌃⌥V; log which one bound. Brief asks for "user-friendly 'this
chord is taken' error" — at minimum, log the chord, and surface
a notification.

#### M2 — `VoixOverlay.repositionAtTopCenter` doesn't observe `didChangeScreenParametersNotification`

Architecture Decision 4: "Re-positions on
`didChangeScreenParametersNotification`."

`VoixOverlay.swift:177-186` — `repositionAtTopCenter` is called
on every `showOverlay`, but the panel is never notified about
screen changes between shows. Hot-plug a monitor while the panel
is shown → panel stays on the disconnected screen. Architect's
spec was correct; implementer skipped it.

#### M3 — `VoixOverlayPanel` allocates a fresh visual-effect view + label every time `make()` is called, but `make()` is only called once (on first show). On a screen size change, layout doesn't update

The contentView's `bounds` is set at construction time. The
visual-effect subview is `[.width, .height]` autoresizing so it
follows the panel frame. The label is auto-layout pinned to the
effect view. Fine for static panel size — but if M23 ever changes
the panel size, the rounded-corners radius (`16`) is wrong for
the new size. Latent.

#### M4 — `subscription?.remove()` then `subscription = null` race on rapid press

If Tom mashes ⌃⌥Space twice in 200ms (overlay shows, audio start
in flight, overlay press-out, audio stop in flight, overlay
press-in again): `MacosAudioCapture.stop()` removes the
subscription; the in-flight `mod.start()` Promise may resolve
after the next start's listeners are attached, calling
`opts.onFrame` on the stale closure with frames that now belong
to the next session.

The implementer's iOS sibling (`IosAudioCapture`) has the
`audio-api` library's lifecycle guards. The macOS sibling
hand-rolls it and has no in-flight `start()` cancellation.

#### M5 — `int16ToBase64` in audioPlayback.native.ts uses `String.fromCharCode.apply(null, Array.from(...))` per chunk

`packages/ui/src/platform/audioPlayback.native.ts:97-101`:

```ts
for (let i = 0; i < bytes.length; i += CHUNK) {
  bin += String.fromCharCode.apply(
    null,
    Array.from(bytes.subarray(i, i + CHUNK)),
  );
}
```

Each chunk allocates a new Array AND a new spread-apply call.
`Array.from(Uint8Array)` is O(n); doing it per CHUNK is O(n)
per chunk = O(n) total = fine. But this happens on every
pushFrame, ~50 times per second of audio. At 24kHz/16-bit/mono =
48kB/sec. Each pushFrame is ~960 bytes; well under the CHUNK
boundary. Not a perf blocker but the code is also wrong: should
use `String.fromCharCode(...bytes.subarray(...))` directly (the
spread operator on a Uint8Array works in Hermes).

Latent perf concern only.

#### M6 — Screenshot tool exits 2 on lock, but the manual step 2 says "If locked → script exits 2 with a clear message"; the actual tool checks `kCGSSessionOnConsoleKey as? Bool`

`voix-window-screenshot.swift:93-100` — the key is a string
"kCGSSessionOnConsoleKey", but the actual CGSession key is a CFString
constant — looking up the dict with a String key may return nil
even when on-console. Tested? The implementer ran it at step 2
(captured 1280×752) so it worked once for on-console. The locked
branch is "source-code-only" per implementer. Tom should verify
the locked exit code with `pmset displaysleepnow` if he wants to
trust the docs.

#### M7 — ScreenCaptureKit screenshot tool: filters by `applicationName == "voix"` but won't include the overlay panel (chooses largest area window)

`voix-window-screenshot.swift:130-137` — `area($0) < area($1)`
picks the largest window. Main window dwarfs the 360×96 overlay
panel. So even when the overlay is showing, the screenshot
captures the main window only. The implementer can never visually
verify the overlay is correctly displayed via this tool. Not
fatal — Tom verifies via eyes — but contradicts the M22 plan's
implicit promise of "visual smoke is screenshot-driven."

---

### Low

#### L1 — `requiresMainQueueSetup` returns `true` on VoixHotkey and VoixOverlay, but `false` on VoixAudioCapture, VoixAudioPlayback, VoixAudioPermissions, VoixPaste — Carbon event handlers AND NSPanel construction DO require main queue, but the dispatch-to-main in start()/showOverlay() compensates. Fine but inconsistent. Document the rule.

#### L2 — `voix.entitlements` is missing `com.apple.security.cs.allow-jit` — Hermes uses JIT; on hardened-runtime + sandboxed apps this can crash at runtime. Not enabled in the current xcode build settings (no `ENABLE_HARDENED_RUNTIME` flag in pbxproj) so latent.

#### L3 — `VoixPaste.swift:84-86` reads `kAXTrustedCheckOptionPrompt` via `.takeUnretainedValue() as String`. This is correct but fragile — the CFString constant could be retained-vs-unretained changed by SDK; using `kAXTrustedCheckOptionPrompt as String` directly via toll-free bridging is the more conventional pattern.

#### L4 — Worklets-comment-in-Podfile (Surprise C in implementer report) is fine but the Podfile comment is in two places; if M23 adds another Podfile for tvOS/etc., the comment will go stale and bun's parsing won't catch it. Minor doc drift risk.

#### L5 — `MacOverlay.native.tsx` accumulates transcripts with a literal space separator (`${transcriptRef.current} ${daemonEv.text}`). The daemon's `transcript` events are PER-ROLE — for dictation, role is always "user". If the daemon sends two transcript events (chunked utterance), the join with " " may insert an extra space mid-sentence. Daemon side is supposed to deduplicate, but cross-boundary spacing depends on STT provider. Cosmetic.

#### L6 — `AppDelegate.mm` does not register any custom native modules. RN-macOS 0.81 with `RCT_EXTERN_MODULE` discovers modules via runtime introspection of Objective-C runtime classes. This works because the .m files are linked into the binary. Not a bug, but worth documenting since codegen + RCTNewArch=true raises legitimate questions about whether discovery still works (see B2).

---

## The Tom-day prediction

**ONE thing that will fail at step 5 of m22-manual.md, falsifiable
by literally running it**:

When Tom presses ⌃⌥Space focused in TextEdit for the FIRST time
after a fresh build, **the microphone permission dialog will pop
in front of voix**, stealing focus to voix. Tom clicks "Allow"
— now voix is the front app, NOT TextEdit. Mic opens, dictation
records, transcript arrives, paste fires. Cmd+V is posted to the
session event tap, but the focused app is voix (no text field).
**Nothing pastes**. Tom sees "Copied" or "Pasted" in the HUD but
TextEdit is empty.

Second press: voix already has mic permission, dialog doesn't
appear, focus stays on TextEdit, paste works.

The implementer's manual will read as "intermittent paste —
sometimes works, sometimes doesn't" and the fix is two lines in
MacOverlay (call `requestMicrophone()` at boot, not at first
press).

If Mic permission is somehow already cached (e.g. Tom ran a prior
voix build), THEN the second-most-likely failure is **B1 (mic
input fails because of the missing audio-input entitlement)** —
overlay opens, says "Listening", but no audio frames flow, daemon
times out at the WS layer. Tom sees the HUD spin forever or close
without a transcript.

**Falsification recipe**:
```
sudo tccutil reset Microphone <bundle-id-of-voix-macos>
cd clients/app && bun run macos
# wait for build, app launches
# focus TextEdit
# press ⌃⌥Space, say "hello", release
# observe: dialog pops, voix activates, paste targets voix, TextEdit stays empty
```

If this happens — H5 is real. If the dialog never appears (mic
already granted) but no audio comes through — B1 is real. If
audio works but release event never fires — B3 is real. If
everything works on the first session but session 3 plays no
audio out — H3 is real.

Any ONE of these failing falsifies the implementer's "all green
post-build" claim.

---

## Architectural pushback

1. **The "smoke = build succeeded" pattern is misleading.** The
   implementer's report says "BUILD SUCCEEDED" 11 times under
   "Per-step results" and reports no runtime failures because no
   runtime tests were run. The "deltas" section says "None that
   qualify." That's the empty-blockers smell the brief warned
   about. For native bridges, smoke MUST include "launch the app
   + open the JS console + log `Object.keys(NativeModules).filter(k
   => k.startsWith('Voix'))` + check it has all six modules". The
   implementer did not do this. Tom should not trust this
   landed-and-merged until the diagnostic boot logs are added
   (B2 mitigation #2 is essentially free).

2. **The architect's KeyboardShortcuts SPM pick was the
   right call.** The implementer's Note A defers to "Carbon
   direct, same API under the hood" — but the hard part
   KeyboardShortcuts solves is the release-event state machine
   (B3), not the registration boilerplate. Reimplementing
   KeyboardShortcuts is a full-time job that someone at Sindre has
   already done across 5 years. Skipping the SPM dependency to
   save Podfile complexity inverts the cost: SPM-via-pods is a
   2-hour engineering problem, getting release events reliable
   across all macOS versions is a 6-week problem. M23 swap-in is
   load-bearing, not nice-to-have.

3. **The entitlements file should be owned by a "hardware access"
   review checkpoint** — adding microphone or paste-injection
   capabilities to a sandboxed app is exactly the kind of change
   that needs a non-skip checklist: usage description, entitlement,
   prompt flow, denial flow. The implementer's process treated
   this as "implementer judgment". B1 is the cost.

4. **Hand-rolling a TurboModule against `RCT_EXTERN_MODULE` is
   either NewArch OR LegacyBridge — not both.** B2 is a
   half-migration. The architect specced NewArch + codegen; the
   implementer shipped LegacyBridge inside a NewArch-enabled
   binary. The interop works in 0.81 because of bridge-compat,
   but RN-macOS 0.82+ removes bridge-compat. M22 is shipping with
   a 6-month staleness fuse.

5. **The 100% Tom-pending acceptance list (#3-#11 of "Acceptance
   criteria check") is too long.** Of 12 criteria, 9 are
   "Tom-pending physical press". That means almost nothing is
   verified. Architecture said load-bearing step is step 5;
   implementer pushed steps 3, 4, 5, 6, 7, 8, 9, 10, 11 all into
   Tom's lap. Reasonable in some places (hotkey press automation
   isn't possible) but not for "Web PTT still works"
   (criterion 10 is JS-only, no Tom needed — implementer could
   run a `bun run build` + node-puppeteer smoke). Treat
   "Tom-pending" as a budget, not a free escape hatch.

Net assessment: M22 ships a meaningful chunk of code, but the
"all green" framing is unearned. Two of my blockers (B1 sandbox
mic entitlement; B2 codegen mismatch + no diagnostic) will hit
Tom within his first 30 minutes of step 5. B3 (release event)
may or may not — depends on input source + macOS version. H5
(mic-dialog-steals-focus on first run) is essentially certain on
a clean install. Document or fix all of these before declaring
M22 closed.
