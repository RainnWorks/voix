# Phase 6 — Tom's manual smoke (consolidated)

One manual for every hands-on Phase 6 surface. Replaces the per-milestone
`m20`/`m21`/`m22`/`m23`/`m24-manual.md` files (merged 2026-06-01, B5).
Organised by **surface**, not milestone. Run everything from
`/Users/tom/Projects/voix/`.

Load-bearing steps (the ones that can't be sim-faked): macOS hotkey→paste,
iOS PTT round-trip, iOS-device keyboard bounce loop.

---

## 0. Common setup (do once per session)

**Pre-flight** — clean tree, HEAD at the latest close-out:
```bash
cd /Users/tom/Projects/voix && git status && git log -1 --oneline
which watchman || brew install watchman
```
If you see `?? app/`, the pre-pivot Tauri tree wasn't cleaned — `rm -rf app/`
(snapshot lives on the `legacy/tauri-clipboard` branch).

**Workspace refresh + pods** — pre-empts stale-dir surprises:
```bash
cd /Users/tom/Projects/voix
rm -rf node_modules clients/app/node_modules \
       voix-backend/node_modules voix-backend/ui/node_modules
bun install
cd clients/app && bundle install            # Gemfile is at clients/app/, NOT ios/
cd ios   && bundle exec pod install         # iOS  ≈ 77 pods
cd ../macos && bundle exec pod install      # macOS ≈ 75–76 pods
```
Recovery one-liners:
- `hermes-engine` missing → `pod install --repo-update`.
- `react-native not found` → add `"react-native": "0.81.6"` to root
  `package.json` deps, `bun install`, retry.
- `cli-platform-apple not found` → `bun install` (the devDep is in
  `clients/app/package.json`); or symlink
  `node_modules/.bun/@react-native-community+cli-platform-apple@*/node_modules/@react-native-community/cli-platform-apple`
  into `clients/app/node_modules/@react-native-community/`.
- `[Worklets] not compatible with React Native` → `react-native-worklets` is
  pinned at **0.8.3** on purpose (0.9.x needs RN 0.83+; we're on 0.81.6).
  `bun install` again; confirm `clients/app/node_modules/react-native-worklets`
  exists.
- license → `sudo xcodebuild -license accept`; `SDK "iphoneos" cannot be
  located` → `sudo xcode-select -s /Applications/Xcode.app/Contents/Developer`.

**Set the dev daemon URL** (one-time per LAN) — `ifconfig en0 | grep "inet "`,
then either edit `packages/ui/src/platform/appInfo.native.ts`'s
`DEFAULT_DEV_DAEMON_URL`, or after launch from the JS console:
```js
require("@voix/ui").__dev__.setApiBase("http://192.168.99.86:8765/")
```
Persisted in AsyncStorage under `voix.api_base`; uninstall+reinstall to reset.

**Start daemon + Metro:**
```bash
cd voix-backend && bun src/index.ts &      # "listening on :8765"
cd clients/app  && bun run start &          # "Welcome to Metro v0.83.7" then ready
```
(macOS note: `bun run start` is port 8081. `start:macos` is port 8082 but the
macOS scheme's `RCT_METRO_PORT` isn't plumbed — macOS runs off its build-time
bundle and won't hot-reload. Not required for the basic flow.)

---

## 1. iOS sim

```bash
cd clients/app && bunx react-native run-ios --simulator="iPhone 16 Pro"
```
First build ≈ 90 s–5 min. Mic permission is pre-granted via
`xcrun simctl privacy booted grant microphone co.rowm.voix` (bundle id was
renamed from `org.reactjs.native.example.voix` in M24 — re-grant under the new
id if you wipe).

**Boot + Voices** — sidebar with six built-in voices renders, populated from
the live daemon, brand-correct swatches, HA blue only in voix moments.

**Onboarding** (wipe first: `xcrun simctl uninstall booted co.rowm.voix`):
- Screen 1 — wordmark + puck + "voix listens when you talk to it." → Get started.
- Screen 2 — "voix needs your microphone." → Allow → auto-advances. On deny:
  "Won't work without microphone access" + Open settings / Skip for now;
  toggling on in Settings and returning auto-advances (AppState observer).
- Screen 3 — daemon URL pre-filled; "Connected" (HA blue) / "Unreachable"
  (red). Done → main app. `voix.onboarding.completed` persists.

**Tone + intent + PTT** (load-bearing):
- Voices cards show italic HA-blue tone under the name; routingHint muted-grey
  below. Editor: tone field under the name input, italic 11pt, 80-char max,
  trims on blur, "Saved" flashes.
- Activate `default-dictation` → Conversations hint "Hold to dictate."; hold,
  speak, release → label "Listening" then "Transcribing…".
- Switch to `default-realtime` → hint "Hold to talk to voix."; during reply
  label reads "voix is replying".
- New entries appear in Conversations with the voice's tone snippet.

**Settings smoke:** edit daemon URL to something invalid → "Unreachable" within
~600 ms → PTT fails with the "voix is unreachable" recovery state → Reset to
default → "Connected", PTT recovers. Default-voice chips persist to
`voix.settings.default_voice_id`. Microphone row shows status + re-prompt.

Recovery: permission denied → Settings → voix → Microphone → on, relaunch;
voices empty + red overlay → check daemon is up + apiBase IP on the same LAN;
stuck on "Connecting…" after deny → the TalkButton should render the
permission-denied error string, not spin forever.

---

## 2. iOS device (physical iPhone)

Needed for anything entitlement-gated (App Group, background audio on real
hardware). **Requires Apple Developer Program enrolment** ($99/yr) — free-tier
provisioning rejects the `group.co.rowm.voix` capability. Check
`developer.apple.com/account` → Membership before starting.

```bash
# Xcode: select your iPhone as run destination → Product → Run (⌘R).
# First run: "Untrusted Developer" → on iPhone, Settings → General →
#   VPN & Device Management → trust your team.
```
Xcode → Signing & Capabilities for BOTH `voix` and `VoixKeyboard` targets:
Team set, "Automatically manage signing" checked, no red errors.

**Background-audio survival:** pick a realtime voice, hold PTT to `listening`,
swipe to background, speak 30+ s, re-open. Pass: session alive OR cleanly ended
with captured transcript. Fail modes to log: WS closes on background / audio
frames stop / iOS kills app / session continues but daemon sees no audio. On
fail → M23.5 sets `AVAudioSession.setCategory(.playAndRecord, mode: .voiceChat,
options: [.allowBluetooth, .duckOthers])` at PTT start.

---

## 3. macOS

```bash
cd clients/app && bun run macos          # first build 2–4 min
```
Recovery: no provisioning profile → Xcode → voix-macOS target → Signing &
Capabilities → "Sign to Run Locally"; **`macOS project folder not found`** →
`bun install` (the `cli-platform-apple` devDep surfaces it correctly under bun
workspaces).

**Boot:** voix-macOS window with sidebar + Voices list (matches the iOS shot).
Two boot log lines (Xcode → Devices and Simulators → voix-macOS):
- `voix hotkey: ctrl+opt+space (registered)` — or `(conflict — …)`.
- `voix accessibility: trusted — paste will auto-fire` / `not trusted — paste
  will copy-only; grant in System Settings`.

**Screenshot baseline** (Claude-runnable):
```bash
bash scripts/macos-screenshot.sh /tmp/voix-macos.png   # 1280×752 PNG
```
Exits 2 if the screen is locked (unlock + re-run). Uses ScreenCaptureKit;
needs Screen Recording permission on first run.

**Status item:** menu-bar item reads "voix" with "Talk to voix" /
"Hotkey: ⌃⌥Space" (greyed; clickable "(conflict — open Settings)" if owned) /
"Quit voix". Title shows "voix •" while the overlay is up.

**Hotkey → overlay → paste** (load-bearing): click into TextEdit. Press+hold
**⌃⌥Space** → borderless HUD slides in top-centre (puck glyph + HA-blue pulse
+ "Listening…" + hint "Hold ⌃⌥Space — release to send"). Speak "hello from
voix on macOS." Release:
- Accessibility granted → HUD "Pasted"; text appears at the cursor.
- Not granted → HUD "Copied — grant Accessibility to auto-paste."; System
  Settings → Privacy & Security → Accessibility opens (once per session).
  Toggle voix on, **fully quit (⌘Q) and relaunch**, re-test.

Recovery: nothing on press → check the hotkey log; if `conflict`, quit the
owning app. Text lands but is the previous clipboard → CGEventPost ran before
the pasteboard write (50 ms delay should prevent it; file a follow-up if seen).

---

## 4. iOS keyboard

The voix keyboard is a zero-key dictation keyboard that bounces to the host app
for capture and returns text via the App Group. Sim covers compile + URL
handler + UI; a **physical device** (section 2) is required to verify the App
Group entitlement and real cross-app insertion.

**Enable** (sim or device): Settings → General → Keyboard → Keyboards → Add New
Keyboard → voix → toggle **Allow Full Access** → confirm. If the pill is
replaced by "voix needs Full Access to record." copy, Full Access wasn't
granted. The "Open Settings" CTA deep-links to voix's host Settings (Apple
exposes no direct link to the keyboard pane).

**Pill:** open Notes → tap text field → tap globe → switch to voix. Expect: voix
wordmark top-left, "Talk to voix" pill centre, "or pick another keyboard ⌄"
hint, globe key bottom-right.

**Bounce loop** (load-bearing): tap "Talk to voix" → iOS "Open in voix?" → Open.
Host launches `KeyboardCaptureScreen` (puck + "Listening" + "Returning to
keyboard when you stop speaking"). Speak "test entry one — meeting with rowm at
three pm." On VAD end-of-speech (or 30 s host cap) the host writes the polished
transcript to the App Group container and calls `voix-keyboard://done?…`; iOS
bounces back, the pill flashes "Pasting…", and the text appears in the field.
Repeat in **Mail / Messages / Reminders / Safari** — confirm insertion in ≥4
host apps.

**Failure paths:** force-quit host mid-capture → "voix couldn't record" toast
after 60 s; mic denied (Settings → voix → Microphone → off) → "Mic permission
denied" within ~2 s; Full Access off → onboarding screen + working "Open
Settings" CTA. Debug the lifecycle with
`xcrun simctl spawn booted log stream --predicate 'subsystem == "co.rowm.voix.keyboard"'`.

**Memory:** keyboard RSS < 30 MB during idle pill state (Xcode → Debug
Navigator → Memory; the keyboard process specifically).

### App Review story (READ before TestFlight / App Store submit)

A zero-key keyboard whose visible action bounces to another app is the textbook
shape App Review challenges under Guideline 2.5.1 / 4.2 (minimum
functionality). Own the rationale in the submission, don't discover it at
rejection. Put this in the App Store Connect review notes + listing copy:
- **voix is a voice-dictation keyboard.** Its keyboard-primary value is typing
  text into the focused field by voice — the one thing the system keyboard
  can't do. Tap pill, speak, polished text lands via
  `textDocumentProxy.insertText`. Keyboard-native input, not a launcher.
- **The bounce is an Apple constraint, not a funnel.** Keyboard extensions are
  denied reliable mic / `AVAudioSession` access, so dictation-from-a-keyboard
  must capture in a host process and return text through the App Group. iOS
  returns the user automatically; the hop is invisible in intent.
- **Precedent:** Apple Dictation, Gboard, SwiftKey, Grammarly Keyboard all hand
  off to a host for non-typing surfaces.
- **Listing framing:** "voix — voice dictation keyboard," lead with the
  dictate-into-any-field value, mention Full Access is required to record and
  return text. Do **not** describe it as a shortcut to "open the voix app."

Fallback if Review still pushes back: in-keyboard recording (Full Access +
`AVAudioSession`; memory tight, quality may suffer) — tracked as M24.5 /
Architecture Risk 1. Inline rationale also lives at the top of
`clients/app/ios/VoixKeyboard/KeyboardViewController.swift`.

---

## Acceptance reporting

Done message should cover, per surface touched:
- **iOS sim** — PTT round-trip (or failure screenshot); onboarding lands; tone
  + intent dial switch correctly; Settings recovery loop works.
- **iOS device** — background-audio survival result.
- **macOS** — hotkey + dictate + paste working; status item behaves.
- **iOS keyboard** — pill visible; Full Access flow; bounce → capture → return
  → insert in ≥4 host apps; failure toasts; RSS < 30 MB.
- **Web regression** — `cd voix-backend/ui && bun run build`; PTT still works;
  tone snippets render; ConversationDetail inline audio still plays.
