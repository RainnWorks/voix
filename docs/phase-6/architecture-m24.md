# Phase 6 / M24 — iOS keyboard extension: bounce-to-host capture

Owner: Architect. Status: ready for Implementer.

Scope: ship a system-wide voix keyboard. User taps in any text field,
switches to voix keyboard, taps "Talk to voix" — the keyboard bounces
to the host app (Apple's hard constraint: keyboard extensions can't
record audio reliably), host records ~5s, returns to the keyboard
via URL scheme + App Group container, keyboard inserts the polished
transcript into the original text field. Keyboard intent is locked
to `dictate` (M23 Decision 3). Final milestone of Phase 6.

## Receipts

Files read (`stat -f "%Sm %z %N"`):

```
May 31 17:41 2026 23440 docs/phase-6/architecture-m23.md
May 31 14:35 2026 19247 docs/build-workflow.md
May 31 15:36 2026  1728 clients/app/ios/voix/Info.plist
May 31 15:44 2026 18281 clients/app/ios/voix.xcodeproj/project.pbxproj
```

`docs/phase-6/research-m24.md` does NOT exist at write time —
Researcher is parallel. Load-bearing calls subject to Researcher
findings:
- **Decision 2** (App Group name + container layout) — if Apple's
  data-protection class restricts container reads from extension while
  device is locked, the polling-read-on-resume model breaks.
- **Decision 3** (URL-scheme bounce) — if `extensionContext?.open(_:
  completionHandler:)` is rejected by App Review for keyboard
  extensions, we fall back to UIPasteboard handoff (worse UX) and
  flag in Risk 1.
- **Decision 5** (Full Access requirement) — if recent iOS allows
  URL-scheme open without Full Access, prompt UX simplifies.

Coordinator escalates if research contradicts Decisions 2/3/5.

Current state:
- Host bundle ID: `org.reactjs.native.example.voix` (RN default,
  `project.pbxproj`). **Action**: implementer renames during M24 to
  `co.rowm.voix` to match Tom's email/org (`thomas@rowm.co` per
  user memory) — RN scaffolding bundle IDs are inappropriate for
  TestFlight signing.
- Info.plist has no `CFBundleURLTypes`. M24 adds the host URL scheme.
- `voix.xcodeproj` has the single `voix` target + scheme. M24 adds a
  second target (`VoixKeyboard`) + Pods integration.
- M23 made TalkButton `intent` required and voice-driven. The
  keyboard does NOT pick a voice — it always opens an in-app
  "Keyboard capture" surface that uses the user's default
  Dictation voice (Settings → Default voice, or built-in
  `default-dictation`).

---

## TL;DR

1. New Xcode target `VoixKeyboard` (Custom Keyboard Extension,
   pure Swift/SwiftUI, NO RN). Bundle ID
   `co.rowm.voix.keyboard`. Lives at
   `clients/app/ios/VoixKeyboard/`.
2. App Group `group.co.rowm.voix` shared between host + extension.
   Shared container holds `keyboard-sessions/<session_id>.json`
   (state) + `keyboard-sessions/<session_id>.txt` (final text).
3. URL scheme `voix://` (host) + `voix-keyboard://` (extension).
   Keyboard opens `voix://capture?session_id=<uuid>`; host returns
   via `voix-keyboard://done?session_id=<uuid>`.
4. Keyboard UI: voix wordmark top, single big "Talk to voix" pill,
   soft hint "or use any other keyboard ⌄", state row below pill
   for capture progress. No standard letter rows — voix is a
   single-purpose keyboard.
5. Full Access required and explained inline. First-launch
   "Allow Full Access" coachmark walks the user to Settings.
6. Return detection: extension polls shared container in
   `viewDidAppear` + on `NSNotification.NSExtensionHostDidBecomeActive`,
   with a 60s hard timeout for the capture itself.
7. Migration: 8 commits. Critical path is steps 1-3 (target +
   entitlement + URL scheme) — none of the later steps work
   without all three landing first.
8. **First real-device milestone.** Tom needs an Apple Developer
   Program seat (paid) for App Groups + keyboard extension on
   physical iPhone. Free provisioning won't grant the App Group
   entitlement. Pre-warn in Tom's manual.

---

## Decision 1 — Keyboard target shape

Pin: **Custom Keyboard Extension, pure Swift + SwiftUI, NO React
Native runtime**. SwiftUI for the UI; UIKit
(`UIInputViewController`) as the host. Memory budget for keyboard
extensions is ~48 MB; RN's JS runtime + bridge would consume most of
that before voix code runs.

| Option | Verdict |
|---|---|
| (a) Bare Swift + UIKit views | Reject — SwiftUI is materially less code for this surface. iOS 16+ supports SwiftUI in input VCs. |
| (b) **Swift + SwiftUI hosted in UIInputViewController** | **Pin** — tiny memory footprint, modern API, no RN bridge. |
| (c) RN-driven extension (react-native-keyboard-extension or similar) | Reject — community packages aren't maintained; memory pressure; ships JS engine. |
| (d) Shared RN target with host | Reject — Apple rejects keyboards that ship full JS engines. |

### Directory layout

```
clients/app/ios/VoixKeyboard/
  Info.plist
  VoixKeyboard.entitlements
  KeyboardViewController.swift         # UIInputViewController host
  KeyboardRootView.swift               # SwiftUI root (button + state)
  KeyboardState.swift                  # ObservableObject: lifecycle
  SharedContainer.swift                # App Group read/write helpers
  CaptureSession.swift                 # session_id + URL builders
  FullAccessGate.swift                 # Full Access detect + onboarding
  Assets.xcassets                      # voix wordmark + puck glyph
```

Bundle ID convention: `co.rowm.voix.keyboard` (extension is a
sub-bundle of the host `co.rowm.voix`). Apple convention is
`<host>.<extension-purpose>`.

### Info.plist (extension)

Minimum keys:

```xml
<key>NSExtension</key>
<dict>
  <key>NSExtensionAttributes</key>
  <dict>
    <key>IsASCIICapable</key><false/>
    <key>PrefersRightToLeft</key><false/>
    <key>PrimaryLanguage</key><string>en-US</string>
    <key>RequestsOpenAccess</key><true/>     <!-- Full Access -->
  </dict>
  <key>NSExtensionPointIdentifier</key>
  <string>com.apple.keyboard-service</string>
  <key>NSExtensionPrincipalClass</key>
  <string>$(PRODUCT_MODULE_NAME).KeyboardViewController</string>
</dict>
<key>CFBundleDisplayName</key><string>voix</string>
```

`RequestsOpenAccess = true` flips the Settings toggle on; the user
still has to flip it.

### Entitlements

`VoixKeyboard.entitlements`:

```xml
<key>com.apple.security.application-groups</key>
<array>
  <string>group.co.rowm.voix</string>
</array>
```

Host `voix.entitlements` (new — host doesn't have one today):

```xml
<key>com.apple.security.application-groups</key>
<array>
  <string>group.co.rowm.voix</string>
</array>
```

### Memory budget enforcement

KeyboardViewController logs `MemoryLayout.size` of its state on
load; if total RSS > 30 MB before any capture, log via
`os_log` (`subsystem: "co.rowm.voix.keyboard"`). Document the
budget in the file header so future implementers don't import a
heavy SwiftUI lib without thinking.

---

## Decision 2 — App Group setup

Pin: **`group.co.rowm.voix`**. Both targets entitled. Single shared
container directory; subfolders per concern.

### Shared container layout

```
<container>/keyboard-sessions/
  <session_id>.json    # KeyboardSessionState (see schema below)
  <session_id>.txt     # final transcript (host writes, kbd reads + deletes)
```

The `.json` file is the authoritative session record; `.txt` is a
convenience for the keyboard's read-and-paste path.

### `KeyboardSessionState` schema

Shared Swift file `Shared/KeyboardSessionState.swift` (added to BOTH
targets):

```swift
struct KeyboardSessionState: Codable {
    let sessionId: String         // UUID
    let createdAt: Date
    var status: Status            // "pending" | "capturing" | "done" | "failed" | "cancelled"
    var transcript: String?       // populated on done
    var error: String?            // populated on failed
    enum Status: String, Codable {
        case pending, capturing, done, failed, cancelled
    }
}
```

### Read/write helpers

`SharedContainer.swift` (extension) + mirror in
`clients/app/ios/voix/SharedContainer.swift` (host, Swift bridge
called from RN via a tiny native module):

```swift
static let groupId = "group.co.rowm.voix"
static func containerURL() -> URL? {
    FileManager.default.containerURL(
        forSecurityApplicationGroupIdentifier: groupId)
}
static func sessionURL(_ id: String) -> URL?  // .json
static func transcriptURL(_ id: String) -> URL  // .txt
static func writeState(_ state: KeyboardSessionState) throws
static func readState(_ id: String) throws -> KeyboardSessionState?
static func deleteSession(_ id: String) throws  // both files
```

### Data-protection class

Files in the shared container default to
`NSFileProtectionCompleteUntilFirstUserAuthentication` — readable
once the device has been unlocked since boot. Voix sessions only
matter immediately after unlock + active use, so default is fine.
**Do not** use `.complete`; that would block the keyboard from
reading the result if the device locks during the bounce.

### Cleanup policy

Host writes on capture end. Keyboard reads + paste + deletes both
files. On keyboard launch, sweep any session > 5 minutes old —
those are orphans from a host crash. One scan per
`viewDidAppear`, not a timer.

---

## Decision 3 — URL scheme contract

Pin: two schemes. **`voix://`** on host. **`voix-keyboard://`** on
extension. Two-leg round-trip; session ID is the correlation token.

### Host registers `voix://`

`Info.plist` (host, append):

```xml
<key>CFBundleURLTypes</key>
<array>
  <dict>
    <key>CFBundleURLName</key><string>co.rowm.voix.host</string>
    <key>CFBundleURLSchemes</key><array><string>voix</string></array>
    <key>CFBundleTypeRole</key><string>Editor</string>
  </dict>
</array>
```

### Extension registers `voix-keyboard://`

Same shape in `VoixKeyboard/Info.plist` with scheme
`voix-keyboard`. Extension-owned URL schemes ARE supported when the
extension is installed (since iOS 14).

### URL contracts

**Keyboard → Host** (open via `extensionContext?.open(_:completionHandler:)`):

```
voix://capture?session_id=<uuid>&return=voix-keyboard%3A%2F%2Fdone%3Fsession_id%3D<uuid>
```

- `session_id`: UUID; matches the `<id>.json` already written to
  shared container with `status: pending`.
- `return`: encoded URL the host invokes when finished.

**Host → Keyboard** (open via `UIApplication.shared.open(_:)` from
RN bridge after capture ends):

```
voix-keyboard://done?session_id=<uuid>
voix-keyboard://cancelled?session_id=<uuid>
voix-keyboard://failed?session_id=<uuid>&error=<encoded>
```

The keyboard does NOT consume these URLs directly (a keyboard
extension can't receive open-URL callbacks). The URL is a hint to
re-foreground the previous app; the keyboard's actual data source
is the **shared container file**. The URL exists primarily because:

1. iOS auto-bounces the user back to the previous app when the
   host calls `UIApplication.shared.open` on a scheme that the
   "previous app" responds to. The previous app here is
   whatever was hosting the keyboard (Notes, Mail, etc.) — NOT
   the keyboard itself. The keyboard re-appears when iOS restores
   the textfield's first-responder, and its
   `viewWillAppear`/`viewDidAppear` fires.
2. The `return=` parameter is what makes the host call back at all.

### Host-side handling (RN)

RN side adds a native module `VoixKeyboardBounce.swift` exposing:

```
captureForKeyboard(sessionId: String, returnUrl: String) → Promise
```

JS handler in host app: on `Linking.addEventListener("url", …)`:
parse `voix://capture?…`, push a `KeyboardCaptureScreen` route
that:

1. Reads `KeyboardSessionState` from shared container; verifies
   `status == "pending"` and `session_id` matches.
2. Writes `status: "capturing"`.
3. Auto-starts a PTT-style capture using the user's default
   dictate voice. UI shows only the puck + "Listening…" + a
   countdown bar to a 30s hard cap. NO TalkButton, NO chrome — this
   is a single-shot capture flow.
4. On end-of-speech (VAD) or 30s cap: pipeline produces transcript;
   writes `status: "done"` + transcript to both `.json` and `.txt`.
5. Calls `UIApplication.shared.open(URL(string: returnUrl)!)`.
6. JS dismisses the KeyboardCaptureScreen route so a manual
   re-open of voix lands on the normal app, not this screen.

### Failure paths

- Mic permission denied: write `status: "failed"`,
  `error: "mic_denied"`, return.
- Daemon unreachable: same, `error: "daemon_unreachable"`.
- User cancels (host UI has tiny "✕"): `status: "cancelled"`,
  return.
- Host crashes mid-capture: keyboard's 60s timeout (Decision 6)
  fires.

---

## Decision 4 — Keyboard UI minimum viable

Pin: **single-purpose keyboard**. No letter rows. voix wordmark on
top, big rounded pill "Talk to voix" centered, soft hint "or pick
another keyboard ⌄" underneath. Puck glyph inside the pill. State
row appears below the pill when capture is in flight.

| Option | Verdict |
|---|---|
| (a) Full QWERTY + voix button | Reject — re-implementing iOS QWERTY is weeks of work and a worse keyboard than the system's. Brand-dilutive. |
| (b) **Single-purpose voix-only keyboard** | **Pin** — voix is one tap; the globe key (always present in any third-party keyboard) gets you back to the previous keyboard for typing. |
| (c) Empty / opaque | Reject — needs at least the hint copy or users don't know what to do. |

### Layout (vertical, top to bottom)

Keyboard frame at the standard iOS portrait keyboard height
(~291pt iPhone 14/15/16). Padding 16pt all sides.

```
┌────────────────────────────────────────────────┐
│  voix                                          │  16pt wordmark (top-left)
│                                                │
│    ╭─────────────────────────────────╮         │
│    │  ⬤  Talk to voix                │  ←  56pt pill, full-width minus 32pt
│    ╰─────────────────────────────────╯         │     puck 24pt left, label 16pt SF Pro
│                                                │
│         or pick another keyboard ⌄             │  11pt, textQuiet, italic
│                                                │
│                                  🌐            │  globe key (system) bottom-right
└────────────────────────────────────────────────┘
```

- Background: standard keyboard background (UIInputView's default
  `keyboardAppearance` — adapts light/dark + per-app).
- Pill: HA-blue fill, white "Talk to voix" label, puck glyph left
  inset. Tap = bounce. (HA-blue is the voix-moment color per brand
  guide; voix's primary capture surface earns it.)
- Globe key: required for compliance; positioned bottom-right at
  44pt tap target. Use `handleInputModeList(from:with:)` to show
  the switcher on long-press (Apple-standard behavior).

### Capture-in-flight state

When `KeyboardSessionState.status == "capturing"` (rare —
keyboard usually doesn't see this, host has focus; but possible on
re-entry):

```
    ╭─────────────────────────────────╮
    │  ⬤  voix is listening…          │  pill pulses HA-blue at 1Hz
    ╰─────────────────────────────────╯
```

### Done state (brief, while extension pastes)

```
    ╭─────────────────────────────────╮
    │  ✓  Pasting…                    │  ~200ms before the keyboard
    ╰─────────────────────────────────╯     auto-clears after insertion
```

### Wordmark + puck

`Assets.xcassets`: import wordmark SVG → PDF (vector) and puck
glyph PDF from `voix-brand-guide.html`. Sized at 16pt wordmark
height, 24pt puck inside pill, 18pt puck on capturing state.

### What's NOT in the keyboard

- No voice picker (intent locked to dictate, voice = user's
  default-dictation).
- No settings (live in host app).
- No history / transcript view (live in host app).
- No "type" mode (the system keyboard already does that — globe-
  switch).

---

## Decision 5 — "Allow Full Access" prompt UX

Pin: in-keyboard onboarding screen replaces the pill when Full
Access is OFF. Explains why, walks to Settings, then re-detects
on re-open.

### Why Full Access is required

- `extensionContext?.open(_:)` requires Full Access on iOS 13+
  for arbitrary URL schemes. Without it, our bounce-to-host fails
  silently.
- `UIPasteboard` access requires Full Access (Apple changed this
  in iOS 11). Our paste-final-text fallback path needs it.
- Networking from a keyboard extension requires Full Access.
  (We don't network from the keyboard — host does — but if we
  ever add a "daemon-status indicator" it'd need this.)

### Detection

`hasFullAccess` (UIInputViewController property) read on
`viewWillAppear`. SwiftUI binds to an `@Published` boolean on
`KeyboardState`.

### Onboarding screen (replaces pill when `!hasFullAccess`)

```
┌────────────────────────────────────────────────┐
│  voix                                          │
│                                                │
│   voix needs Full Access to record.            │  14pt SF Pro, textNormal, center
│                                                │
│   Settings → General → Keyboard →              │  11pt, textQuiet, mono section
│   Keyboards → voix → Allow Full Access         │
│                                                │
│    ╭─────────────────────────────────╮         │
│    │  Open Settings                  │         │  pill, HA-blue, opens
│    ╰─────────────────────────────────╯         │     UIApplication.openSettingsURLString
│                                                │
│   Your text stays on your devices.             │  10pt, textQuiet, italic
│                                  🌐            │
└────────────────────────────────────────────────┘
```

`UIApplication.openSettingsURLString` deep-links to voix's
host-app Settings page (not the keyboard's settings — there's no
URL for that), which is acceptable because the host app's
Settings → "Set up voix keyboard" row (added in step 6) walks the
user to the right pane.

**Important caveat (Researcher to confirm)**: from a keyboard
extension, opening Settings via the standard scheme may be
blocked. If so, fall back to copy-only with a tap-to-copy hint:
"Copy this path: Settings → General → Keyboard → Keyboards →
voix → Allow Full Access" with the entire string in a copy chip.

### Re-detection on grant

`UIApplication.willEnterForegroundNotification` doesn't fire in
extensions, but `viewWillAppear` does when the user dismisses the
Settings app and the textfield refocuses. On that path, re-read
`hasFullAccess`; transition to the pill state.

---

## Decision 6 — Re-entry / return flow timing

Pin: extension reads shared container on `viewDidAppear` AND on a
`Timer` that fires every 500ms during an in-flight session;
60-second hard timeout from bounce-out.

### State machine (extension side)

```
idle → bounced (kbd opened host) → resumed (host returned, viewDidAppear fired)
       └─ timeout (60s) → cancelled
resumed → reading → inserting → idle
                              → idle (if file missing → treat as cancelled)
```

### Tick details

- On "Talk to voix" tap: generate UUID, write
  `KeyboardSessionState{status: pending}` to shared container,
  call `extensionContext?.open(captureURL)`, set
  `state = .bounced`, start 60s timeout.
- On `viewDidAppear` while `state == .bounced`:
  1. Read `<session_id>.json`. If missing or > 60s old: treat as
     cancelled, return to idle.
  2. If `status == "done"`: read `<session_id>.txt`, call
     `textDocumentProxy.insertText(...)`, delete both files,
     return to idle.
  3. If `status == "failed"`: show 2s toast "voix couldn't
     record" in the state row, delete files, return to idle.
  4. If `status == "capturing"`: rare race; start 500ms poll
     timer until status changes or timeout.
- On 60s timeout while bounced: write
  `status: "cancelled"`, return to idle, brief toast.

### Why polling + viewDidAppear

A keyboard extension cannot receive URL-scheme callbacks
directly. The host calling `voix-keyboard://done?...` causes iOS
to switch back to the app that owned the text field (Notes, Mail).
voix keyboard re-appears as that app's input view —
`viewDidAppear` fires. This is the deterministic signal.

500ms polling exists ONLY for the edge case where the user
double-taps the host's "back" gesture before capture finishes,
re-foregrounding the text field while capture is still in flight.
In that case the keyboard sees `status: capturing` and waits.

### What if the host crashed mid-capture

The `<session_id>.json` file is left in `status: capturing`
state. Keyboard's 60s timeout fires. Keyboard writes
`status: cancelled` and clears. User sees the brief
"voix couldn't record" toast and the pill returns. The orphan
files get swept on the next keyboard launch (Decision 2 cleanup).

---

## Decision 7 — Build / install / sign

Pin: **CocoaPods integration for the extension target is minimal**
(extension has no RN/native deps), but the Xcode target add + dual
signing is non-trivial. Tom needs a paid Apple Developer Program
seat for App Groups on a physical iPhone.

### Xcode target add (implementer steps)

1. Open `voix.xcworkspace`.
2. File → New → Target → iOS → Custom Keyboard Extension. Name:
   `VoixKeyboard`. Bundle ID:
   `co.rowm.voix.keyboard`. Language: Swift. Embed in: voix
   (host).
3. Xcode auto-generates `KeyboardViewController.swift` + stub
   Info.plist. Replace with files per Decision 1.
4. Capabilities (host target): + App Groups → add
   `group.co.rowm.voix`. Xcode creates host entitlements file.
5. Capabilities (VoixKeyboard target): + App Groups → check
   `group.co.rowm.voix`.
6. Podfile: add `target 'VoixKeyboard' do` block with no pods
   (extension uses only Apple SDKs). Run `pod install`.

### Signing

- Both targets need provisioning profiles. App Group entitlement
  requires a paid Apple Developer Program seat (~$99/yr).
- For dev/sideload: enable "Automatically manage signing" in Xcode
  with Tom's Apple ID as the team. Xcode will create matching
  profiles if the team is enrolled.
- For TestFlight: an App Store Connect record for `co.rowm.voix`
  (host), AppID for keyboard extension as
  `co.rowm.voix.keyboard`, App Group certificate; the
  iOS distribution profile must include the App Group entitlement.

### Bundle ID rename

The host is currently `org.reactjs.native.example.voix` (RN
default). M24 renames to `co.rowm.voix` because:
1. App Groups require a unique bundle ID prefix you own.
2. TestFlight rejects RN scaffolding bundle IDs.
3. Cleaner for Tom long-term.

Add to the migration order as a discrete step (#1 below) so it can
be reverted independently if signing breaks.

### Pre-warn for Tom

Add to Tom's M24 manual a "before you start" section that lists:

- Confirm Apple Developer Program enrolment (`developer.apple.com`
  → Membership). If not enrolled, M24 is BLOCKED on that
  enrollment (1-2 day Apple delay).
- Have an iPhone running iOS 17+ on the same Apple ID.
- USB cable + "Trust this computer" already done.

---

## Decision 8 — Migration order

Web build never breaks; iOS host PTT preserved at every step;
macOS unaffected. Each step = one commit.

| # | Commit | What | Smoke |
|---|---|---|---|
| 1 | `clients/app(M24): rename iOS bundle id to co.rowm.voix` | Update `project.pbxproj` `PRODUCT_BUNDLE_IDENTIFIER` for the voix target. Update RN AppDelegate scheme references if any. | `bunx react-native run-ios` boots; PTT still works. |
| 2 | `clients/app(M24): add VoixKeyboard extension target` | Xcode target add per Decision 7. Stub `KeyboardViewController.swift` that shows an empty pill. Podfile target block added (no pods yet). | Build succeeds; the empty keyboard can be enabled on sim. |
| 3 | `clients/app(M24): App Group entitlement + SharedContainer.swift` | Add `group.co.rowm.voix` to both targets. Add shared `KeyboardSessionState.swift` + `SharedContainer.swift`. Test: write state from host on launch, read from keyboard. | Sim: launch host, switch to voix kbd, log shows state read OK. |
| 4 | `clients/app(M24): URL scheme on host + handler` | `CFBundleURLTypes` for `voix` scheme in host Info.plist. Native module `VoixKeyboardBounce.swift` exposing JS-callable open-URL listener. RN side: `Linking` handler routes `voix://capture?…` to a new `KeyboardCaptureScreen` (empty for now — TODO comment). | `xcrun simctl openurl booted "voix://capture?session_id=test"` opens the host + routes to screen. |
| 5 | `clients/app(M24): Keyboard UI (pill + onboarding + Full Access gate)` | KeyboardRootView.swift implements Decisions 4 + 5. Tap pill writes pending state + opens `voix://capture?…`. | Enable kbd, allow Full Access, tap pill → host opens with the routed screen. |
| 6 | `packages/ui(M24) + clients/app(M24): KeyboardCaptureScreen + auto-capture` | RN screen consumes the route; runs a single PTT-style capture with default-dictation voice; on end, writes `KeyboardSessionState{status: done, transcript}` + `.txt`, calls `UIApplication.shared.open(returnUrl)`. Implement on host side via `VoixKeyboardBounce.swift::returnToKeyboard`. | Full loop on sim: kbd → host → capture (use sim's hardware sim mic) → return to kbd → text inserts. |
| 7 | `clients/app(M24): return polling + timeout + cleanup sweep` | Decision 6: `viewDidAppear` read, 500ms poll for `capturing` race, 60s hard timeout, orphan sweep on launch. Toast UI for `failed` / `cancelled` / `timeout`. | Force host-side cancel mid-capture; kbd shows the right toast. Kill host mid-capture; kbd times out at 60s. |
| 8 | `docs(M24): m24-manual.md + STATE close-out + phase-6 tag` | Manual; STATE; risk register; tag `v0.phase-6`. | Tom runs manual on his iPhone end-to-end. |

Why this order: 1-3 are mechanical infra (rename, target, App
Group) — none of the product is visible yet but every later step
depends on them. 4 unblocks the bounce-in path. 5 makes the
keyboard visible. 6 closes the bounce-out path. 7 hardens. 8
ships.

**Split point if long**: step 6 boundary. M24a = 1-5 (kbd
visible, opens host); M24b = 6-8 (host capture + return).
M24a is technically usable as a "the keyboard exists but is a
no-op" — defensible to land on its own if step 6 balloons.

---

## Decision 9 — Risk register

| # | Risk | Detect | Mitigate |
|---|---|---|---|
| 1 | **Apple rejects the bounce-to-host as a keyboard workaround.** App Review historically dislikes keyboards that primarily launch other apps. They might require the keyboard to do work on its own. | TestFlight review feedback; check 2.5.x guidelines. | Frame the keyboard in the App Store description as a "voice dictation companion": its job IS to launch the recorder, like Apple's own Dictation flow. Cite precedents: Gboard, SwiftKey, Grammarly Keyboard all launch their host app for non-typing surfaces. If rejected, fallback path is recording in-keyboard (requires Full Access + AVAudioSession; memory will be tight; quality may suffer; M24.5 milestone). |
| 2 | **48 MB memory budget exceeded.** SwiftUI + voix Assets + the SharedContainer wrappers — measured but not yet bench-tested on a real device under low-memory pressure. iOS kills the keyboard process and the user sees the system keyboard reappear mid-flow. | Xcode memory gauge during dev; `os_log` RSS at viewDidLoad; user reports of "keyboard disappears." | Asset audit: keep wordmark + puck as PDF vectors (small) not PNG slices. No third-party SwiftUI libs. Avoid AsyncImage / heavy Combine chains. Profile on iPhone SE (lowest-memory supported device). Hard ceiling for the pill view: 8 MB RSS — log if exceeded. |
| 3 | **URL scheme return doesn't fire.** Host calls `UIApplication.shared.open(voix-keyboard://done?…)` but iOS doesn't switch back to the previous app, OR it does but the keyboard's `viewDidAppear` doesn't fire. | Manual test in step 7; check the polling timer; check the toast appears. | Two-channel design (URL nudges iOS back; shared file is the actual data source) means a URL-scheme misfire degrades to "keyboard shows pill again; user re-taps" rather than data loss. The shared file persists. Add explicit `extensionContext?.open(_:completionHandler:)` completion logging — at least we see whether iOS accepted the open. |
| 4 | **App Group entitlement mismatch.** Host and extension entitlements file lists drift apart (e.g. only host gets the group). `FileManager.containerURL(forSecurityApplicationGroupIdentifier:)` returns nil silently in the extension. Keyboard sees empty data. | Step 3 smoke: keyboard logs "container nil" if entitlement missing. CI: a script that greps both .entitlements files for the group string. | `scripts/check-app-group.sh` in M24 step 3 — fails if `group.co.rowm.voix` not present in both files. Run it before each commit. Ensure provisioning profile (both targets) lists the App Group capability — Xcode's "Provisioning Profile doesn't match the entitlements" error is the canonical signal. |
| 5 | **Provisioning surprises for Tom.** Free Apple ID can't grant App Group entitlement on physical device. Tom hits "Failed to register bundle identifier" on first run. M24 is BLOCKED on Apple Developer Program enrolment + AppID + Group cert. 1-2 day Apple delay typical. | Tom's manual step 0 (pre-flight check). | Pre-warn in Tom's manual top. Sim-first dev: every step 1-7 smoke runs on sim (App Group + URL scheme + keyboard extension all work in iOS Simulator without paid signing). Tom only needs the paid seat for the physical-device acceptance test in step 8. If enrolment delays, M24 can merge based on sim acceptance + tag M24-physical-pending. |

Other risks tracked but not in top 5:
- iOS version skew (App Group APIs stable since iOS 8, no concern).
- Background-audio entitlement on host conflicts with extension
  triggering (no — extension doesn't record, host has the
  entitlement already from M21).
- Pasteboard fallback: if Full Access ever flips off mid-session,
  `insertText` still works (it's a textDocumentProxy call, not
  pasteboard). Pasteboard is only the secondary fallback if we
  ever ship a "copy to clipboard" mode — not in M24.

---

## Decision 10 — Tom's M24 manual

Saved as `docs/phase-6/m24-manual.md` (step 8). Load-bearing
section is step 6 (the full bounce-and-return loop on physical
iPhone).

### 0. Pre-flight (READ THIS FIRST — could block M24 for 1-2 days)

- Confirm Apple Developer Program enrolment:
  `https://developer.apple.com/account` → Membership. If "Not
  Enrolled," enroll now ($99/yr) and wait for activation before
  proceeding.
- Have an iPhone running iOS 17+ paired to this Mac via USB. In
  Xcode → Settings → Accounts: your Apple ID should appear with
  the team that owns `co.rowm.voix`.
- In Xcode → Signing & Capabilities for both `voix` and
  `VoixKeyboard` targets: Team set, "Automatically manage
  signing" checked, no red errors.

### 1. Initial sim sanity (everything except physical device)

```bash
cd /Users/tom/Projects/voix/clients/app
bun run start &
bunx react-native run-ios --simulator="iPhone 16 Pro"
```

In sim Settings → General → Keyboard → Keyboards → Add New
Keyboard → voix → toggle "Allow Full Access" → confirm.

Open Notes → tap text field → tap globe → switch to voix kbd →
see the pill.

### 2. Bounce loop on sim

Tap "Talk to voix" → sim auto-grants permission to switch to
voix host app. The KeyboardCaptureScreen appears. Use sim's
"Hardware → Audio Input → Internal Microphone" (or pipe a test
WAV via `xcrun simctl io booted recordVideo`). Speak "this is a
keyboard test."

Host returns to Notes after ~3s. Voix keyboard shows "Pasting…"
then idle pill. Notes text field contains "This is a keyboard
test." (or whatever the dictate voice produced).

### 3. Failure paths on sim

- Force-quit host mid-capture: kbd shows "voix couldn't
  record" after 60s.
- Mic permission denied (Settings → voix → Microphone → off):
  kbd shows "voix couldn't record" within 2s.
- Full Access off: pill replaced with onboarding screen,
  "Open Settings" CTA works.

### 4. Physical iPhone install

```bash
# In Xcode: select your iPhone as run destination
# Product → Run (⌘R)
# First-run: "Untrusted Developer" — on iPhone go to
# Settings → General → VPN & Device Management → trust your team.
```

### 5. Enable keyboard on iPhone

Settings → General → Keyboard → Keyboards → Add New Keyboard
→ voix → toggle "Allow Full Access" → confirm prompt.

### 6. Acceptance loop (load-bearing)

- Open Notes. Tap into a note. Tap globe → cycle to voix.
- See the pill. Tap "Talk to voix".
- Host opens, capture starts within ~500ms.
- Say "test entry one — meeting with rowm at three pm."
- Stop talking. After auto-stop (or 30s cap), host bounces back.
- voix kbd shows "Pasting…" briefly.
- Text appears in Notes, polished by the default dictation voice.

### 7. Cross-app verification

Repeat step 6 in: Mail (compose body), Messages, Reminders, and
Safari address bar. Confirm text inserts in all four.

### 8. Background / re-entry

- Tap "Talk to voix"; while host is recording, swipe up to
  background voix host.
- Wait 30s. Re-open voix from app switcher (NOT via Notes).
- Voix shows the normal home (Conversations). The orphan
  session sweeps on next keyboard open.

### 9. Acceptance reporting

All of: (a) pill visible in Notes, (b) Full Access flow lands,
(c) bounce → capture → return → text inserts in ≥4 host apps,
(d) failure paths show the right toast, (e) memory stays under
30 MB during normal operation.

If any of those fail, log in `m24-manual.md` and queue M24.5.

---

## Acceptance criteria

M24-complete when all hold:

1. `VoixKeyboard` target builds with bundle ID `co.rowm.voix.keyboard`.
2. Host bundle ID renamed to `co.rowm.voix`; PTT still works on sim.
3. Both targets entitled with App Group `group.co.rowm.voix`;
   `scripts/check-app-group.sh` passes.
4. URL scheme `voix://capture?session_id=...` opens host and routes
   to `KeyboardCaptureScreen`.
5. Keyboard UI matches Decision 4 (wordmark + pill + hint + globe).
6. Full Access onboarding shows when `!hasFullAccess`; recovers to
   pill on re-enter after grant.
7. Tapping pill bounces to host; host runs single-shot dictate
   capture with default voice; writes transcript to shared
   container.
8. Host returns via `voix-keyboard://done?...`; keyboard's
   `viewDidAppear` reads shared container; inserts text via
   `textDocumentProxy.insertText`.
9. 60s hard timeout fires on host crash; orphan sweep runs on next
   keyboard open.
10. Failure paths (`failed`, `cancelled`, timeout) show 2s toast.
11. Memory under 30 MB on iPhone SE during idle pill state.
12. Works in: Notes, Mail, Messages, Reminders, Safari address bar
    (physical iPhone acceptance, step 7 of manual).
13. `docs/STATE.md` marks Phase 6 closed; tag `v0.phase-6` on main.

Out of scope (M24.5 or later):
- In-keyboard recording (Apple-rejection fallback).
- Voice picker in keyboard (always dictate, always default-dictation).
- Settings inside keyboard (host owns settings).
- History view in keyboard.
- Android IME (M26).
- iPad split keyboard / floating keyboard layout polish.
- iOS 16 / older — drop, require iOS 17+.

---

## Coordinator deltas slot

(Empty at write time. Verify trio fills in if material gaps
surface pre-merge. Per §7 of agent-team-workflow: each delta adds
an action item to the relevant Decision + one acceptance
criterion. Hard ceiling: 3 deltas before re-planning.

Researcher's report lands at `docs/phase-6/research-m24.md`. If
it contradicts Decision 2 — App Group container readability while
locked — re-spec Decision 6 (return flow) to avoid relying on
container reads. If it contradicts Decision 3 —
`extensionContext?.open(_:)` blocked by App Review for keyboard
extensions — escalate to Coordinator: M24 falls back to
in-keyboard recording (Risk 1 fallback path becomes primary). If
Decision 5 simplifies (Full Access no longer required), simplify
the onboarding gate but keep the explanation copy.)
