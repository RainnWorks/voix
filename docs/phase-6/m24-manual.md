# M24 — Tom's manual

The voix keyboard ships. After this manual the iOS app system-
keyboard-types-from-anywhere story is complete. Final milestone of
Phase 6.

## 0. Pre-flight (READ FIRST — could block M24 1–2 days)

- **Apple Developer Program enrolment** required for App Group
  entitlements on a physical iPhone. Check
  `https://developer.apple.com/account` → Membership. If "Not
  Enrolled," enrol now ($99/yr) and wait for activation before
  proceeding. Free Apple ID provisioning will not grant the
  `group.co.rowm.voix` capability.
- Have an iPhone running iOS 17+ paired to this Mac over USB.
- In Xcode → Settings → Accounts: Apple ID present with the team
  that owns `co.rowm.voix`.
- In Xcode → Signing & Capabilities for BOTH `voix` and `VoixKeyboard`
  targets: Team set, "Automatically manage signing" checked, no red
  errors.

## 1. Delta A — sim mic permission under the new bundle ID

M21 granted the simulator's mic permission to the old bundle
`org.reactjs.native.example.voix`. M24 step 1 renamed to
`co.rowm.voix`. Re-grant under the new ID:

```bash
xcrun simctl privacy booted grant microphone co.rowm.voix
```

(Already run during M24 implementer wave.)

## 2. Initial sim sanity

```bash
cd /Users/tom/Projects/voix/clients/app
bun run start &                    # Metro
bunx react-native run-ios --simulator="iPhone 16 Pro"
```

In sim:

1. Settings → General → Keyboard → Keyboards → Add New Keyboard →
   voix → toggle "Allow Full Access" → confirm.
2. Open Notes → tap text field → tap globe → switch to voix.
3. Expect: voix wordmark top-left, "Talk to voix" pill centre, "or
   pick another keyboard ⌄" hint, globe key bottom-right.

If the pill is replaced by "voix needs Full Access to record." copy,
Full Access wasn't granted in step 1 — go back. The "Open Settings"
CTA deep-links to voix's host Settings (Apple doesn't expose a
direct deep-link to the keyboard's pane).

## 3. Sim bounce loop (with Tom-touches)

Tap "Talk to voix" — iOS shows "Open in voix?" — tap Open. Host
launches into `KeyboardCaptureScreen` (puck + "Listening" copy +
"Returning to keyboard when you stop speaking" hint).

Speak: "this is a keyboard test."

Host should auto-finish on VAD end-of-speech, write the polished
transcript to `~/Library/Developer/CoreSimulator/.../Library/Group
Containers/group.co.rowm.voix/keyboard-sessions/<uuid>.txt`, then
call `voix-keyboard://done?...`. iOS bounces back to Notes. The voix
keyboard's pill briefly says "Pasting…" and the transcript appears
in the Notes field.

If the bounce stalls: check `xcrun simctl spawn booted log stream
--predicate 'subsystem == "co.rowm.voix.keyboard"'` for the
keyboard's lifecycle log (`viewDidAppear`, `consumeBouncedSession`,
shared-container read result).

## 4. Failure paths on sim

- **Force-quit host mid-capture** — kbd shows "voix couldn't record"
  toast after 60s.
- **Mic permission denied** (Settings → voix → Microphone → off) —
  kbd shows "Mic permission denied" within ~2s (host writes
  `status: failed`).
- **Full Access off** — pill replaced with onboarding screen; "Open
  Settings" CTA works.

## 5. Physical iPhone install (Delta B — Tom-only)

```bash
# In Xcode: select your iPhone as run destination.
# Product → Run (⌘R).
# First-run: "Untrusted Developer" — on iPhone go to
# Settings → General → VPN & Device Management → trust your team.
```

App Groups require a paid Apple Developer Program seat. The
implementer's sandbox can't enrol. Sim-coverable steps (1-7) shipped
green; steps 6 + 7 of this manual depend on the physical device.

## 6. Enable keyboard on iPhone

Settings → General → Keyboard → Keyboards → Add New Keyboard →
voix → toggle "Allow Full Access" → confirm the system prompt.

## 7. Acceptance loop (load-bearing)

- Open Notes. Tap into a note. Tap globe → cycle to voix.
- See the pill.
- Tap "Talk to voix" — host opens, capture starts within ~500 ms.
- Say "test entry one — meeting with rowm at three pm."
- Stop talking. After VAD auto-stop (or the 30 s host-side cap),
  host calls `voix-keyboard://done` → iOS bounces back.
- Voix keyboard shows "Pasting…" briefly.
- Polished text appears in Notes.

## 8. Cross-app verification

Repeat step 7 in: Mail (compose body), Messages, Reminders, Safari
address bar. Confirm text inserts in all four.

## 9. Background / re-entry

- Tap "Talk to voix"; while host is recording, swipe up to background
  voix.
- Wait 30 s. Re-open voix from app switcher (NOT via Notes).
- voix shows the normal home (Conversations). Orphan session sweeps
  on next keyboard open.

## 10. Acceptance reporting

All of:

- (a) pill visible in Notes
- (b) Full Access flow lands
- (c) bounce → capture → return → text inserts in ≥4 host apps
- (d) failure paths show the right toast
- (e) memory stays under 30 MB during normal operation (Xcode →
  Debug Navigator → Memory; voix keyboard process specifically)

If any of those fail, log in this file under "Outcomes" and queue
M24.5.

## App Review story (READ before submitting to TestFlight / App Store)

A zero-key custom keyboard whose only visible action bounces to another
app is the textbook shape App Review challenges under Guideline 2.5.1 /
4.2 (minimum functionality) — "keyboards that primarily launch another
app." voix can ship this surface, but the rationale has to be **owned in
the submission**, not discovered at rejection. Put this in the App Store
Connect review notes and the listing copy:

- **voix is a voice-dictation keyboard.** Its keyboard-primary value is
  typing text into the focused field by voice — the one thing the system
  keyboard cannot do, and the reason a user adds it. Tap the pill, speak,
  and polished text lands back in Notes / Mail / Safari via
  `textDocumentProxy.insertText`. The user never leaves the dictation
  task; this is keyboard-native input, not a launcher.
- **The bounce-to-host is an Apple constraint, not a traffic funnel.**
  Keyboard extensions are denied reliable microphone / `AVAudioSession`
  access, so the only way to dictate *from a keyboard surface* is to
  capture in a process that may record and hand the transcript back
  through the App Group container. iOS returns the user to the original
  app automatically; the hop is invisible in intent.
- **Precedent.** Apple's own Dictation, plus Gboard, SwiftKey, and
  Grammarly Keyboard, all hand off to a host process for non-typing
  surfaces. voix is a dictation-first keyboard in the same family.
- **Listing framing.** Describe it as "voix — voice dictation keyboard,"
  lead with the dictate-into-any-field value, and mention Full Access is
  required to record and to return the text. Do **not** describe it as a
  shortcut to "open the voix app."

If Review still pushes back, the fallback is **in-keyboard recording**
(Full Access + `AVAudioSession`; memory will be tight, quality may
suffer) — tracked as the M24.5 / Architecture Risk 1 mitigation. The
inline rationale also lives at the top of
`clients/app/ios/VoixKeyboard/KeyboardViewController.swift`.

## Outcomes (Tom fills in)

- [ ] Pill visible in Notes
- [ ] Full Access onboarding works + recovers
- [ ] Bounce + capture + return + insert in Notes
- [ ] Same in Mail
- [ ] Same in Messages
- [ ] Same in Reminders
- [ ] Same in Safari address bar
- [ ] Mic denied → right toast
- [ ] Host crash → 60 s timeout toast
- [ ] Keyboard RSS < 30 MB during idle pill state
