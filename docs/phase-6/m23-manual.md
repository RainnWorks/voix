# M23 manual — iOS shippable app + macOS polish

Tom's hands-on smoke for M23. Code-side shipped + verified clean
across all 10 steps (architecture-m23.md Decision 7); this manual
covers the things that need physical eyes.

Load-bearing step: **5 — tone + intent + PTT on a fresh iOS sim.**

---

## 0. Pre-flight

```bash
cd /Users/tom/Projects/voix
git status      # working tree clean
git log -1 --oneline   # latest commit per below
```

Expected: M23 close-out commit at HEAD.

---

## 1. Daemon + Metro

```bash
cd voix-backend && bun src/index.ts &
cd clients/app && bun run start &
```

Expected: daemon listens on :8765 with "voices: loaded 6 modes" (built-in
seeds remain stable); Metro on :8081 with no errors.

---

## 2. Clean iOS AsyncStorage

```bash
xcrun simctl uninstall booted org.reactjs.native.example.voix
```

Wipes AsyncStorage so onboarding fires + persists fresh.

---

## 3. Run iOS

```bash
cd clients/app && bunx react-native run-ios --simulator="iPhone 16 Pro"
```

First build is 1–3 min. App lands on **Onboarding screen 1** (welcome).

---

## 4. Walk onboarding

- **Screen 1** — voix wordmark + puck glyph + "voix listens when you
  talk to it." paragraph. Tap **Get started**.
- **Screen 2** — "voix needs your microphone." Tap **Allow microphone**.
  iOS shows the system dialog. Tap Allow → auto-advances to step 3.
  - On deny: copy switches to "Won't work without microphone access"
    with **Open settings** + **Skip for now**. Toggling on in Settings
    and returning to voix auto-advances (Risk 4 AppState observer).
- **Screen 3** — daemon URL pre-filled with
  `http://192.168.99.86:8765/`. Status indicator probes; "Connected"
  in HA-blue when daemon is reachable, "Unreachable" red otherwise.
  Tap **Done** to land on the main app (Voices section).

`voix.onboarding.completed` is persisted in AsyncStorage; the next
launch goes straight to AppShell.

---

## 5. Tone + intent + PTT (load-bearing)

### 5a. Voices list

- Sidebar → Voices.
- Each built-in card shows italic HA-blue tone under the name
  (e.g. Realtime "A calm conversational partner.", Message "Crisp
  messages. No fluff.").
- Cards still show routingHint below tone, muted-grey.

### 5b. Voice editor

- Tap a voice card → editor opens.
- Tone field sits directly under the name input — italic 11pt
  HA-blue placeholder reads "A one-line personality snippet."
- Edit the tone, blur out — should show "Saved" momentarily; tone
  on the Voices list updates when you go back.

### 5c. Intent dial on TalkButton (closes Wren M21 gap)

- Activate `default-dictation`. Conversations section: hint reads
  **"Hold to dictate."** Hold the button, say "test entry one",
  release.
  - During hold, label reads "Listening"; after release,
    transition says "Transcribing…" (NOT "voix is replying").
- Switch active voice to `default-realtime`. Hint reads **"Hold to
  talk to voix."** Hold, say "test entry two", release.
  - During reply, label reads "voix is replying" (NOT
    "Transcribing…").

### 5d. New entries

Conversations list shows both entries with the corresponding voice
tone snippet under the voice name.

---

## 6. Background-audio smoke (Decision 6)

1. Pick a realtime voice.
2. Hold TalkButton. Reach `listening`.
3. Swipe up to background while holding.
4. Continue speaking for 30+ s.
5. Re-open voix.

Pass: session still alive OR cleanly ended with captured transcript.

Fail modes to log in this section after the run:
- WS closes immediately on background.
- Audio frames stop.
- iOS kills app.
- Session continues but daemon sees no audio.

If anything in fail-mode lands, M23.5 follow-up: explicit
`AVAudioSession.setCategory(.playAndRecord, mode: .voiceChat,
options: [.allowBluetooth, .duckOthers])` at PTT start (see
architecture-m23.md Decision 6).

---

## 7. Settings smoke

- Sidebar → ⚙ Settings.
- **Daemon connection** row: edit URL to something invalid (e.g.
  `http://10.99.99.99:9999/`). Status reads "Unreachable" within
  ~600ms.
- Go to Conversations and hold the TalkButton — should fail with the
  "voix is unreachable" recovery state.
- Back in Settings, tap **Reset to default** → status flips back to
  "Connected". PTT recovers.
- **Default voice** row: pick a different voice from the chips; the
  first device is updated; persisted to
  `voix.settings.default_voice_id`.
- **Microphone** row: status reads "Allowed". Re-prompt button still
  appears for explicit re-check.
- **About** row: app version + Platform `ios` + Protocol v1 +
  Daemon version (if `api/version` is implemented, otherwise hidden).

---

## 8. macOS regression

```bash
cd clients/app && bun run macos
```

Expected:
- First-launch: onboarding shows (same three screens), then lands on
  the main app. **Status item appears in the menu bar** (just to the
  left of system tray icons): reads "voix".
- Click the status item → menu opens with:
  - "Talk to voix"
  - "Hotkey: ⌃⌥Space" (greyed if no conflict; clickable
    "(conflict — open Settings)" amend if another app owns ⌃⌥Space)
  - "Quit voix"
- Press ⌃⌥Space → HUD panel appears top-centre with the puck glyph
  + HA-blue pulse ring + "Listening…" status + hint line reading
  "Hold ⌃⌥Space — release to send". Status item title changes to
  "voix •" while overlay is up.
- Release ⌃⌥Space → HUD hides, status item drops the bullet.
- Tap "Talk to voix" in the menu → behaves like one ⌃⌥Space press
  (overlay appears, auto-releases after 8 s if you don't manually
  intervene).

---

## 9. Web regression

```bash
cd voix-backend/ui && bun run build
```

Open the HA add-on UI (or local `dist/` via `bun src/index.ts`'s
served UI).

Expected:
- Sidebar has a fourth ⚙ **Settings** entry.
- Tone snippets render under each voice name on Voices, Surfaces,
  and Conversations.
- Settings → Daemon URL row is hidden on web (served from daemon).
- Settings → Microphone row is hidden on web.
- TalkButton hint switches with active voice's type (Realtime →
  "Hold to talk to voix.", Dictation → "Hold to dictate.").

---

## 10. Acceptance reporting

| # | Criterion | Status |
|---|-----------|--------|
| 1 | `Voice.tone` end-to-end (daemon + UI) | ☐ |
| 2 | VoiceEditor tone field below name, 80-char max, italic | ☐ |
| 3 | VoiceList + SurfaceList + ConversationList show tone | ☐ |
| 4 | Built-in voices ship with seeded tone strings | ☐ |
| 5 | Sidebar has fourth Section "settings" with gear icon | ☐ |
| 6 | Settings → Daemon URL edits + persists via AsyncStorage | ☐ |
| 7 | Settings → Microphone shows status + "Open settings" | ☐ |
| 8 | TalkButton intent resolved from active voice; prop required | ☐ |
| 9 | TalkButton hint copy reflects intent | ☐ |
| 10 | First-launch onboarding renders on iOS + macOS | ☐ |
| 11 | macOS: status item with "Talk to voix" + Quit; conflict surfaces | ☐ |
| 12 | macOS overlay HUD shows puck + pulses | ☐ |
| 13 | Background-audio smoke run + documented | ☐ |
| 14 | Web regression clean: tone, gear, PTT + intent dial | ☐ |
| 15 | docs/STATE.md marks M23 closed; m23-manual.md exists | ☐ |

Out of scope: KeyboardShortcuts SPM swap (M23.5), hotkey rebind UI
(M23.5), sandbox automation entitlement (M23.5 — Yuki H4), iOS
keyboard extension (M24), Bonjour daemon auto-detect, per-session
intent override.
