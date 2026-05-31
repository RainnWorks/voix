# M21 — Tom's manual smoke (after the Implementer commits land)

Verbatim from `docs/phase-6/architecture-m21.md` Decision 12 (with
the Delta-C amendment to worklets pinning surfaced during M21
implementation). Run from `/Users/tom/Projects/voix/`.

**0. Pre-flight** — clean status, HEAD = M21 close-out:
```bash
cd /Users/tom/Projects/voix && git status && git log -1 --oneline
```

**1. Refresh workspace + pods** — expect `bun install` to surface
the new audio-api stack (`react-native-audio-api@0.12.2`,
`react-native-worklets@0.8.3`, `@react-native-async-storage/async-storage@^3.1.1`,
`react-native-device-info@^15.0.0`):
```bash
cd /Users/tom/Projects/voix
rm -rf node_modules clients/app/node_modules \
       voix-backend/node_modules voix-backend/ui/node_modules
bun install
cd clients/app/ios   && bundle exec pod install
cd ../macos          && bundle exec pod install
```
Recovery:
- `react-native-audio-api not found` → already in root deps
  (Decision 11), re-`bun install`.
- `cli-platform-apple not found` → M20 surprise 1 fix already in
  `clients/app/package.json` devDeps; re-`bun install`.
- `[Worklets] not compatible with React Native` → see Delta C
  (M21 architecture) — `react-native-worklets` is pinned at
  **0.8.3** in M21 because `0.9.x` requires RN 0.83+; the brief's
  original `0.9.0` pin was incompatible with our RN 0.81.6.
- `pod install` "different prefix" error on the audio-api podspec
  → worklets is missing or wrong version. `bun install` again and
  confirm `clients/app/node_modules/react-native-worklets` exists.

**2. Set dev daemon URL** (one-time per LAN). Either:

(a) Edit `packages/ui/src/platform/appInfo.native.ts`'s
`DEFAULT_DEV_DAEMON_URL`, OR (b) after first launch, from Metro's
dev console (cmd-d in the sim → "Open JS Debugger" → console):

```js
require("@voix/ui").__dev__.setApiBase("http://192.168.99.86:8765/")
```

Replace IP with `ifconfig en0 | grep "inet "`. The persisted value
lives in AsyncStorage under `voix.api_base`; uninstall+reinstall
the app to reset.

**3. Start daemon + Metro.**
```bash
cd voix-backend && bun src/index.ts &
cd clients/app  && bun run start &
```
Wait for `Welcome to Metro` then `Dev server ready` (~2 s).

**4. iOS run + verify PTT.**
```bash
cd clients/app && bunx react-native run-ios --simulator="iPhone 16 Pro"
```

Expected (first build 2-5 min; smoke confirmed ≈ 90-120 s):
- Sim opens; Voices list renders (M20-confirmed; M21 step 5
  re-confirmed).
- Tap **"Kitchen quick chat"** in the sidebar — that navigates to
  the Conversations tab where the **TalkButton** lives. (The
  Conversations view doesn't have a dedicated bottom nav entry in
  the current AppShell — the "Today" sidebar row is the entry.)
- Hold TalkButton.
- **First time only**: mic permission dialog → accept.
- Status pill: Connecting → Listening → "voix is replying."
- Daemon log shows hello with `client_info.kind = "phone-sat"`.
- Tap-release stops cleanly; session in Conversations.

Recovery:
- permission denied → Settings → voix → Microphone → on, re-launch.
- No daemon connection → check apiBase IP is on the same LAN.
- Stuck on "Connecting…" after deny → that's Decision 13 risk 2;
  permissions.native.ts surfaces `{ ok: false, reason: "denied" }`
  to the UI; the TalkButton should render an error string with
  "microphone permission denied" rather than spin forever.

**5. macOS run + verify non-audio.**
```bash
cd clients/app && bunx react-native run-macos --scheme voix-macOS
```

Expected: sidebar + Voices populated; Surfaces / Conversations
navigable. TalkButton tap surfaces a friendly error message
("audio capture: macOS audio lands in M22 (alongside global hotkey
+ paste)") — **NOT a crash**. The InlineAudioPlayer in conversation
detail shows "Playback: macOS audio lands in M22".

**6. Web build sanity.**
```bash
cd voix-backend/ui && bun run build
```
Open HA add-on URL in a browser; PTT in the web client still works
end-to-end. Conversation detail's inline audio players still render
HTML5 `<audio>` controls.

**7. Acceptance reporting.** Tom's done message:
- iOS PTT end-to-end (or failure screenshot).
- macOS Voices renders + TalkButton shows the M22 message cleanly.
- Web PTT still works; ConversationDetail inline audio still plays.
