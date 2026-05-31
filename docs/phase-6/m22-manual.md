# M22 manual — macOS hotkey + paste + native audio

Run end-to-end after the implementer's 12 commits land. Step 5 is the
load-bearing one (hotkey + overlay + paste). Steps 0-4 are
Claude-runnable + already verified at implementer time.

---

## 0. Pre-flight

```bash
cd /Users/tom/Projects/voix && git status && git log -1 --oneline
```

Expect the HEAD to point at the M22 close-out commit.

---

## 1. Workspace refresh + pods (macOS only — iOS unchanged)

```bash
cd /Users/tom/Projects/voix && bun install
cd clients/app/macos && bundle exec pod install
```

Expect: ~6-8 s pod install, "77 dependencies … 76 total pods installed."
(76 = the M21 count of 73 plus VoixNative + transitive React-Core
wiring.)

**Recovery** — `cli-platform-apple not found` → see M20-tom-smoke.md
surprise #1; symlink workaround:

```bash
ln -s /Users/tom/Projects/voix/node_modules/.bun/@react-native-community+cli-platform-apple@20.0.0/node_modules/@react-native-community/cli-platform-apple \
      /Users/tom/Projects/voix/clients/app/node_modules/@react-native-community/cli-platform-apple
```

---

## 2. Confirm M20 baseline (Claude-runnable)

```bash
bash scripts/macos-screenshot.sh /tmp/voix-macos-pre.png
```

Expect: 1280×752 PNG of the voix-macOS window (the prior M20 run +
fresh restart will paint sidebar + Voices). If the screen is locked,
script exits 2 with a clear message; unlock and re-run.

---

## 3. Start daemon + Metro

```bash
cd voix-backend && bun src/index.ts &
cd clients/app  && bun run start &
```

Expect: daemon `listening on :8765`; Metro `Welcome to Metro v0.83.7`.

(Note from M20 smoke surprise #4: macOS uses `bun run start` on port
8081 by default. If a separate Metro instance is desired for macOS,
`bun run start:macos` runs on 8082, but this isn't required for the
basic flow.)

---

## 4. Run macOS app

```bash
cd clients/app && bun run macos
```

Expect (first build 2-4 min):

- voix-macOS window appears with sidebar + Voices list (matches the
  iOS smoke screenshot).
- macOS dev console (Xcode → Window → Devices and Simulators →
  voix-macOS) shows two log lines at boot:
  - `voix hotkey: ctrl+opt+space (registered)` — or `(conflict — …)`
    if another app owns the chord.
  - `voix accessibility: trusted — paste will auto-fire` or
    `not trusted — paste will copy-only; grant in System Settings`.

Recovery: nothing on press → check the hotkey log; if `conflict`,
quit the owning app or document the conflict for the M23 rebind
sprint.

---

## 5. Hotkey → overlay → paste (load-bearing)

Open TextEdit (or any app with a text field). Click into the document
so the cursor is in the editor.

Press and hold **⌃⌥Space**. Expect:

1. Borderless rounded HUD slides in top-center: "Listening…" + hint
   "Hold ⌃⌥Space — release to send".
2. Status updates to "Receiving transcript…" as the daemon streams
   the dictation result.

Speak: "hello from voix on macOS."

Release ⌃⌥Space. Expect:

- **If Accessibility is granted**: HUD shows "Pasted"; the text
  appears in TextEdit at the cursor.
- **If Accessibility is NOT granted**: HUD shows "Copied — grant
  Accessibility to auto-paste."; System Settings → Privacy &
  Security → Accessibility opens automatically (once per session).
  Toggle voix on. **Fully quit voix (⌘Q), re-launch from step 4.**
  Re-test: text appears.

Recovery — text lands but is the previous clipboard → CGEventPost ran
before pasteboard write completed (50 ms delay should prevent this;
file a follow-up if it surfaces).

---

## 6. Interruption smoke (optional)

Plug a USB mic mid-session — the macOS AVAudioEngineConfigurationChange
fires; the HUD should show "Error: audio route changed …" briefly.
Skip if no USB mic at hand.

---

## 7. iOS regression

```bash
cd clients/app && bunx react-native run-ios --simulator="iPhone 16 Pro"
```

PTT (the in-app TalkButton) works end-to-end same as M21.
The new `intent` prop defaults to `"discuss"` so behaviour is identical.

---

## 8. Web regression

```bash
cd voix-backend/ui && bun run build
```

Open HA add-on UI; web PTT works.

---

## 9. Acceptance reporting

Done message:
- macOS hotkey + dictate + paste working
- iOS PTT still works
- web PTT still works

---

## Known limits (Tom-pending pre-merge)

1. **Hotkey press automation** — Claude cannot programmatically press
   the hotkey chord. Step 5 requires human input. The screenshot tool
   verifies the overlay window appears, but can only capture once a
   live session is in flight via a human press.
2. **Accessibility grant** — first run shows the System Settings deep
   link; user must toggle voix on and relaunch. Debug builds may need
   re-grant on every rebuild (macOS caches Accessibility trust per
   binary signature; debug signatures change on each compile — risk
   register #3).
3. **Paste-to-TextEdit** — verified at the architecture level
   (.cgSessionEventTap lands in focused-app first-responder), but
   end-to-end smoke needs Tom (focused-app interaction).
4. **Auto-paste reliability** — 50 ms delay between clipboard write +
   Cmd+V post should be enough for the AppKit focus pipeline; flag
   if not.
