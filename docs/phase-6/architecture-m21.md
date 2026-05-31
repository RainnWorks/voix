# Phase 6 / M21 — Platform shims (web / RN-iOS / RN-macOS)

Owner: Architect. Status: ready for Implementer.

Scope: every web-only API leaking through `packages/ui/` moves behind
`packages/ui/src/platform/` with three impls — web (lifted), RN-iOS
(new), RN-macOS (new). Ship a working PTT loop on iOS sim end-to-end.
macOS audio is deferred to M22.

## Receipts

Files read (`stat -f "%m %z %N"`):

```
1780245452 24493 docs/phase-6/architecture-m19.md
1780252502 25064 docs/phase-6/architecture-m20.md
1780253047 12028 docs/phase-6/verify-results/M20-tom-smoke.md
1780222139 14772 docs/agent-team-workflow.md
1780226367 18694 docs/build-workflow.md
1780253480 21533 docs/phase-6/research-m21.md
1780127432  9408 packages/protocol/src/audio-io.ts
1780148800  9912 packages/ui/src/audio_io/client.ts
1780148800  2210 packages/ui/src/audio_io/client.native.ts
1780148800   464 packages/ui/src/lib/apiBase.ts
1780148800   848 packages/ui/src/lib/apiBase.native.ts
1780148800  5384 packages/ui/src/lib/api.ts
1780148800  5408 packages/ui/src/conversations/TalkButton.tsx
```

Direct registry probes (2026-05-31):

- `@react-native-async-storage/async-storage@3.1.1` — peers `*`/`*`,
  macOS via SQLite from RN-macOS 0.78+.
- `react-native-audio-api@0.13.0` — peer `react-native-worklets >= 0.6.0`.
  Podspec `s.platforms = { :ios => '14.0' }` only; files list has `ios/`
  + `android/`, **no `macos/`**. iOS-only.
- `react-native-worklets@0.9.0` peer = RN `0.81 - 0.85` (OK for our
  0.81.6 pin); `0.9.1` jumps to `0.83 - 0.86` — lock to **0.9.0**.
- `react-native-audio-record` — archived 2023, skip.
- `@react-native-voice/voice` — STT, wrong layer.

WebFetched (2026-05-31):

- <https://github.com/software-mansion/react-native-audio-api>
- <https://docs.swmansion.com/react-native-audio-api/docs/fundamentals/introduction>
- <https://docs.swmansion.com/react-native-audio-api/docs/system/audio-manager>
- <https://github.com/react-native-async-storage/async-storage>
- <https://developer.apple.com/documentation/avfaudio/avaudiosession/category-swift.struct/playandrecord>
- <https://github.com/microsoft/react-native-macos> (issues search confirms RN-macOS audio is write-it-yourself)
- raw `react-native-audio-api/main/.../package.json` + podspec

Researcher's report is solid on AsyncStorage / WebSocket / leak
inventory but recommends "shims + stubs only, no real audio in M21". The
build-workflow Phase 6 row for M21 says "Shim coverage: … audio capture,
audio playback." This brief picks the ambitious path — iOS audio ships
in M21, macOS audio defers to M22. Rationale below.

---

## Decision 1 — Platform layout: file-per-primitive + barrel

```
packages/ui/src/platform/
├── index.ts                # barrel
├── types.ts                # shared interfaces, no impl
├── audioCapture.ts         # web getUserMedia + AudioContext mic
├── audioCapture.native.ts  # iOS real, macOS throws
├── audioPlayback.ts        # web AudioBufferSource
├── audioPlayback.native.ts # iOS real, macOS throws
├── storage.ts              # web localStorage (Promise-wrapped)
├── storage.native.ts       # AsyncStorage
├── websocket.ts            # 3-line re-export
├── websocket.native.ts     # same
├── appInfo.ts              # web: document.title + window.location
├── appInfo.native.ts       # RN: DeviceInfo + persisted apiBase
├── permissions.ts          # web no-op
├── permissions.native.ts   # RN PermissionsIOS wrapper
├── inlineAudio.ts          # web <audio src>
└── inlineAudio.native.ts   # native: fetch+decode (iOS) / throw (macOS)
```

Consumers: `import { createAudioCapture, storage, getApiBase } from "../platform"`.

Rationale:

- **File-per-primitive** keeps the M19-Decision-6 `.native.ts` split
  per-file granular — Metro/Vite both honour it cleanly. Monolithic
  `platform.ts` would force every web build to parse RN imports
  (or vice-versa), defeating the suffix split.
- **Barrel re-export** keeps consumer imports stable. The barrel has no
  `.native` twin — it imports siblings that handle the split.
  Tree-shaking works because both Vite and Metro shake named exports.
- **Rejected**: (a) `Platform.audio.capture(...)` namespace object —
  doesn't tree-shake. (b) Three separate packages — forces a build step
  per package, breaks M19 Decision 8 ("shared TS, no build").

`types.ts` is the only impl-free file; it defines the contracts both
impls satisfy.

## Decision 2 — Audio capture: react-native-audio-api (iOS) + macOS stub

**iOS**: `react-native-audio-api@^0.13.0` (Software Mansion) with
`react-native-worklets@0.9.0`.

- It's a faithful Web Audio API impl in RN. The web client at
  `client.ts` is already a Web Audio program — porting is mostly
  swapping the import source. Same `AudioContext`,
  `createMediaStreamSource`, `ScriptProcessorNode`, gapless scheduling.
- MIT, Software Mansion (Reanimated / Gesture Handler authors), latest
  release within days of brief date.
- New Architecture / TurboModule first-class.
- 16/24/48 kHz sample rates all valid; 1024-sample buffer @ 16 kHz =
  64 ms, comfortably sub-100 ms.

**Rejected**:

- *expo-audio*: file-shaped Recording API, not streaming PCM. Achievable
  with buffering hackery but invents a layer we'd then debug. Pulls
  `install-expo-modules` — M19 Decision 3 explicitly rejected Expo for
  keyboard-extension + macOS reasons.
- *react-native-webrtc*: full WebRTC stack for one mic + one speaker.
  +30 MB binary, +5 s cold start. Researcher's "over-engineered" is
  right; keep as M22 fallback only.
- *Hand-rolled AVAudioEngine TurboModule*: M22 work. M21's deliverable
  is the *abstraction*; the bridge is the *implementation*. Both at
  once risks M21 not landing. Keep this option warm if audio-api proves
  inadequate — we swap one platform file, nothing else changes.

**macOS**: stub that throws "implement in M22".

- react-native-audio-api podspec is iOS-only; PR'ing macOS support is
  days and shouldn't gate M21.
- M22 = "macOS shell: global hotkey + paste." That shell needs audio
  capture to be useful at all. M22 lands an AVAudioEngine macOS bridge
  alongside the hotkey work — one Swift target's worth, one milestone.
- The platform interface is identical on both targets; M22's diff fills
  one file.

## Decision 3 — Audio playback: same library, same split

iOS speaker side: same `react-native-audio-api` —
`AudioContext.createBuffer(1, len, 24000)` + `AudioBufferSource`, exact
path `client.ts:276` uses today. Gapless-queue trick at
`client.ts:286-289` ports verbatim.

macOS: stub-throws; M22 owns it.

Capture and playback share one `AudioContext` per session — separating
into two libs would mean two iOS audio sessions fighting each other.

`inlineAudio` (the `<audio src=url>` players in `ConversationDetail`):

- web: lifts current `<audio>` body.
- iOS: `fetch()` WAV → `decodeAudioData()` → `AudioBufferSource`. ~200 ms
  tap-to-play; fine for a UI control.
- macOS: throws.

## Decision 4 — AVAudioSession + background audio mode

iOS host app needs:

`clients/app/ios/voix/Info.plist`:

```xml
<key>NSMicrophoneUsageDescription</key>
<string>voix listens when you talk to it.</string>
<key>UIBackgroundModes</key>
<array><string>audio</string></array>
```

`audio` background mode is required so that when M24's keyboard hands
off to the host app and the user switches back to (e.g.) Notes
mid-session, the WS survives long enough to drop the produced text via
the App Group. Without it, iOS suspends within seconds of
backgrounding.

`audioCapture.native.ts` calls once per session-start:

```ts
import { AudioManager } from "react-native-audio-api";
AudioManager.setAudioSessionOptions({
  iosCategory: "playAndRecord",
  iosMode: "default",
  iosOptions: ["defaultToSpeaker", "allowBluetooth"],
});
AudioManager.setAudioSessionActivity(true);
```

Order: permission first (Decision 10), session category second, mic
start third.

App Groups land in M24 (keyboard ↔ host). M21: no extra entitlements.

macOS Info.plist also gets `NSMicrophoneUsageDescription` so when M22's
audio bridge lands the dialog has a sentence to show.

## Decision 5 — AsyncStorage: `@react-native-async-storage/async-storage@^3.1.1`

Researcher confirms macOS via SQLite, RN-macOS 0.78+ (we're on 0.81.7),
iOS unchanged, New Arch supported.

`storage.native.ts` wraps AsyncStorage in a Promise-returning interface.
`storage.ts` (web) wraps `localStorage` in the same Promise shape
(`Promise.resolve(localStorage.getItem(k))`) so consumer code is identical
across targets. The device-id flow in `client.ts:62-72` becomes async —
one call site, one `await`.

## Decision 6 — WebSocket: RN built-in, no polyfill

Researcher-confirmed:

- Binary frames (`ws.binaryType = "arraybuffer"`) work on RN 0.81.
- Sub-protocols via constructor's second arg (we don't use; keep
  optional).
- No self-signed TLS handling needed for M21 — dev daemon is plain
  `ws://`. HA `wss://` ingress comes with M23.

Quirk to preserve: closing WS during connect phase can hang on some iOS
versions. The existing `client.ts:138-141` `try/catch` around `.close()`
stays.

`websocket.ts` and `.native.ts` are 3 lines each — exist so the
TypeScript types resolve correctly per target (RN's WebSocket TS types
are a strict subset of DOM's, important for type-checking TalkButton on
both).

## Decision 7 — friendly_name + apiBase: `appInfo` primitive

Lift the web-only sources at `client.ts:79` (`window.location` → WS URL)
and `client.ts:202` (`document.title` → friendly name) into `appInfo`.

`appInfo.ts` (web): `getFriendlyName()` returns `document.title`;
`getApiBase()` returns `""`; `getWsUrl()` builds from `window.location`.

`appInfo.native.ts`:

```ts
import { Platform } from "react-native";
import DeviceInfo from "react-native-device-info";
import { storage } from "./storage";

const API_BASE_KEY = "voix.api_base";
const DEFAULT_DEV = "http://192.168.99.86:8765/";
let cache: string | null = null;

export async function getFriendlyName() {
  const name = await DeviceInfo.getDeviceName().catch(() => Platform.OS);
  return `${name} (${Platform.OS})`;
}

export async function getApiBase() {
  if (cache !== null) return cache;
  cache = (await storage.getItem(API_BASE_KEY)) ?? DEFAULT_DEV;
  return cache;
}

export async function setApiBase(url: string) {
  cache = url;
  await storage.setItem(API_BASE_KEY, url);
}

export function getWsUrl(base: string) {
  return base.replace(/\/$/, "").replace(/^http/, "ws") + "/ws";
}
```

`getApiBase()` becomes async on both targets (web wraps sync return in
Promise). Consumer at `lib/api.ts:67-80` is already async. Native impl
caches after first read — steady-state cost is one in-process lookup.

Settings UI for `setApiBase()` is **M23** (full iOS shell). M21 ships
the cell wired + a dev-only `__dev__.setApiBase()` export Tom can call
from Metro's dev console.

Replaces `lib/apiBase.{ts,native.ts}` (M20 scaffold) — Implementer
deletes them in the same commit.

## Decision 8 — Migration order; every step a commit

Web-build invariant: `cd voix-backend/ui && bun run build` must pass at
every commit (M19/M20 rule, M21 keeps it). iOS-sim Voices list must
keep rendering at every commit after step 3.

| # | Commit | What |
|---|---|---|
| 1 | `platform: interface skeleton` | `packages/ui/src/platform/types.ts` with `AudioCapture`/`AudioPlayback`/`StorageAdapter`/`AppInfo`/`Permissions` interfaces; `index.ts` barrel re-exporting types only. Smoke: typecheck all workspaces. |
| 2 | `platform: web impls of non-audio primitives` | `storage.ts`/`appInfo.ts`/`websocket.ts`/`permissions.ts`/`inlineAudio.ts`. Lift body from `lib/apiBase.ts` + `client.ts` + `InlineAudioPlayer.tsx`. Delete `lib/apiBase.ts`. Smoke: web build + dev. iOS sim doesn't work yet — step 3. |
| 3 | `platform: native impls of non-audio primitives` | `storage.native.ts`/`appInfo.native.ts`/`websocket.native.ts`/`permissions.native.ts`/`inlineAudio.native.ts`. Add `@react-native-async-storage/async-storage@^3.1.1` + `react-native-device-info@^15.0.0` to `clients/app/package.json` + root pkg.json (hoist hint, M20 lesson). Smoke: web build still passes AND iOS sim Voices list still renders. Tom: `pod install` both platforms. |
| 4 | `platform: web audio capture + playback` | Split `client.ts` into `platform/audioCapture.ts` + `audioPlayback.ts` + thin orchestrator in `audio_io/client.ts`. Delete `audio_io/client.native.ts` (M19 stub). Smoke: M18 PTT in web UI still works end-to-end. iOS sim still crashes TalkButton press — step 5. |
| 5 | `platform: iOS audio capture + playback (audio-api)` | `audioCapture.native.ts` + `audioPlayback.native.ts` via react-native-audio-api. Add `react-native-audio-api@^0.13.0` + `react-native-worklets@0.9.0` (exact). Plist additions (Decision 4). Tom: `pod install ios/`. Smoke: iOS sim — press TalkButton, accept permission, say "hello voix," confirm reply plays. Daemon log shows hello with `client_info.kind = "phone-sat"`. |
| 6 | `platform: wire consumers` | Replace `client.ts`'s direct DOM API refs with `platform/*` calls. Replace `api.ts`'s `getApiBase` import. Delete `lib/apiBase.{ts,native.ts}`. Mostly find-replace; no behavior change. Smoke: all three targets work. |
| 7 | `docs: M21 close-out` | STATE.md M21 closed; `docs/phase-6/m21-manual.md` written; `bun run check` gains the pin-bounds asserter (Decision 13 risk 6). |

Step rationale: 1-3 reversible (no native deps until 3). Step 4 is file
mechanics. Step 5 is where it gets real — isolated so the debug surface
is small. 6 cleans up. 7 documents.

## Decision 9 — M21 scope vs deferred

**Must ship (M21 closes only when these work):**

- All seven `platform/*` primitives with web + iOS impls.
- iOS PTT smoke: cold-launch on iPhone 16 Pro sim → TalkButton →
  mic permission prompt → accept → speak "hello voix" → daemon
  session opens → reply plays back → session in Conversations.
- Web UI build works; daemon serves it; M18 PTT in web still works.

**Should ship (best-effort):**

- macOS non-audio (Voices/Conversations/Surfaces render; AsyncStorage
  works; apiBase persisted). TalkButton on macOS shows a friendly
  "macOS audio lands in M22" error — NOT a crash.

**Deferred:**

- macOS audio (M22 alongside hotkey + paste).
- iOS settings screen for `setApiBase()` (M23).
- WebRTC fallback if audio-api inadequate.
- AudioWorklet upgrade for web `ScriptProcessorNode` debt (known,
  not blocking).
- Client-side VAD (post-MVP).

Why ship iOS audio in M21 (rejecting researcher's shims-only):

- The build-workflow row literally lists "audio capture, audio playback"
  in M21's shim coverage. Shimming without proving the abstraction is
  the M19 trap (we shipped a thrown-error native stub and only proved
  the build, not the shape).
- If M22 inherits "shims-impl AND macOS shell AND hotkey AND clipboard
  AND Accessibility AND paste," that's four subsystems in one
  milestone. Splitting "iOS audio in M21, macOS audio in M22" validates
  one platform fully per milestone.
- M20's smoke proved apiBase via "Voices list renders." M21's smoke is
  "talk to voix from RN" — proves audioCapture + audioPlayback +
  permissions + AVAudioSession + storage end-to-end at once.

## Decision 10 — iOS permission prompts

`NSMicrophoneUsageDescription` in `clients/app/ios/voix/Info.plist` —
required (Decision 4). Same key in
`clients/app/macos/voix-macOS/Info.plist` — so M22 has a sentence
ready.

No other prompts needed for M21:

- Network: ATS allows `ws://` to LAN IPs since iOS 14; plain
  `http://192.168.x.y:8765/` is fine. HA `wss://` in M23+ also fine
  (no ATS exception).
- Local Network (`NSLocalNetworkUsageDescription` + Bonjour): voix uses
  explicit IPs not mDNS, so the iOS 14 local-network prompt is NOT
  triggered. If we add discovery later, add then.

`permissions.native.ts` uses
`AudioManager.requestRecordingPermissions()` (ships with audio-api) —
simpler than pulling `react-native-permissions`. If a different
permission appears later (e.g. local network), pull the permissions
lib then.

## Decision 11 — Native dep pin matrix

`clients/app/package.json` dependencies:

| Package | Pin | Why |
|---|---|---|
| `@react-native-async-storage/async-storage` | `^3.1.1` | latest stable; RN-macOS 0.78+ via SQLite |
| `react-native-audio-api` | `^0.12.2` | iOS Web Audio API; New Arch ready (note: brief originally said `0.13.0`; coordinator verified npm registry latest is `0.12.2` on 2026-05-31) |
| `react-native-worklets` | `0.9.0` | EXACT; 0.9.1 needs RN 0.83+, breaks our 0.81.6 pin |
| `react-native-device-info` | `^15.0.0` | friendly_name source |

Add the same four to root `package.json` dependencies (M20 hoist
lesson) so `pod install` finds them without symlink surprise.

If `pod install` still surprises: M20 escalation — explicit
`extraNodeModules` Proxy entries in `clients/app/metro.config.js`.

## Decision 12 — Tom's M21 manual

Copied verbatim into `docs/phase-6/m21-manual.md` (step 7).

**0. Pre-flight.**

```bash
cd /Users/tom/Projects/voix && git status && git log -1 --oneline
```

**1. Refresh workspace + pods.**

```bash
cd /Users/tom/Projects/voix
rm -rf node_modules clients/app/node_modules \
       voix-backend/node_modules voix-backend/ui/node_modules
bun install
cd clients/app/ios   && bundle exec pod install
cd ../macos          && bundle exec pod install
```

Recovery: `react-native-audio-api not found` → already in root deps
(Decision 11), re-`bun install`. `cli-platform-apple not found` → M20
surprise 1 fix (manual symlink or M20a follow-up).

**2. Set dev daemon URL** (one-time per LAN). Either:

(a) Edit `packages/ui/src/platform/appInfo.native.ts`'s `DEFAULT_DEV`,
OR (b) after first launch, from Metro dev console:

```js
require("@voix/ui").__dev__.setApiBase("http://192.168.99.86:8765/")
```

(Implementer wires `__dev__` as a tiny dev-only export.) Replace IP
with `ifconfig en0 | grep "inet "`.

**3. Start daemon + Metro.**

```bash
cd voix-backend && bun src/index.ts &
cd clients/app  && bun run start &
```

**4. iOS run + verify PTT.**

```bash
cd clients/app && bunx react-native run-ios --simulator="iPhone 16 Pro"
```

Expected (first build 2-5 min):

- Sim opens; Voices list renders (M20-confirmed).
- Tap TalkButton.
- **First time only**: mic permission dialog → accept.
- Status pill: Connecting → Listening → "voix is replying."
- Daemon log shows hello with `client_info.kind = "phone-sat"`.
- Tap-release stops cleanly; session in Conversations.

Recovery: permission denied → Settings → voix → Microphone → on,
re-launch. No daemon connection → check apiBase IP is on the same LAN.

**5. macOS run + verify non-audio.**

```bash
cd clients/app && bunx react-native run-macos --scheme voix-macOS
```

Expected: sidebar + Voices populated; Surfaces / Conversations
navigable. TalkButton tap shows "macOS audio lands in M22" — NOT a
crash. If it crashes, file as a fix.

**6. Web build sanity.**

```bash
cd voix-backend/ui && bun run build
```

Open HA add-on URL in a browser; PTT in the web client still works.

**7. Acceptance reporting.** Tom's done message:

- iOS PTT end-to-end (or failure screenshot).
- macOS Voices renders + TalkButton shows M22 message cleanly.
- Web PTT still works.

---

## Decision 13 — Risk register

| # | Risk | Detect | Mitigate |
|---|---|---|---|
| 1 | **Library hoist ghost (M20 echo).** Bun hoists `react-native-audio-api` or `react-native-worklets` above `clients/app/node_modules/`; `pod install` fails. | Tom step 1: pod install exits "not found". | Pre-empt via root-level pins (Decision 11). If still fails, `extraNodeModules` Proxy in `clients/app/metro.config.js`. Worst case: M20-style manual symlink in Tom's manual. |
| 2 | **Mic permission denial flow.** User taps deny; subsequent taps don't re-prompt (iOS suppresses); UI looks broken. | TalkButton stays "Connecting" after deny. | `permissions.native.ts` catches deny, returns `{ ok: false, reason: "permission-denied" }`. TalkButton renders: "Microphone access denied. Settings → voix → Microphone." Acceptance includes that string visible after a deny. |
| 3 | **Audio format mismatch silent failure.** Float32 in some buffer format → wrong Int16 conversion; frames look valid but are silent/garbage. | Daemon receives mic frames but transcript is gibberish/empty. | Smoke includes "speak a known word, see `transcript_delta` with that word in daemon log." Reuse `floatToPcm16` helper (client.ts:87) — same spec. On mismatch, log first 16 samples (clip ±1.0 expected). |
| 4 | **Sample-rate confusion 16k/24k/48k.** iOS native AudioContext is 48 kHz but we declare 24 kHz speaker; audio-api may not resample on output. | Speech sounds chipmunked or sloth-y, or playback silent. | Daemon RESAMPLES based on hello-declared rates (research §2). Declare what we'll send/want; daemon adapts. First cut: 48 kHz mic + 24 kHz speaker (match web client). Mismatches are tuning, not correctness — daemon resampler is the safety net. |
| 5 | **M20-leftover macOS audio dead end.** UI is wired but speaker is silent. | Tom step 5: TalkButton doesn't throw but no audio. | Decision 9 explicitly DEFERS macOS audio to M22. macOS path throws friendly error when `Platform.OS === "macos"`. STATE.md and Tom's manual say "expected." |
| 6 | **react-native-worklets version drift.** Contributor bumps to 0.9.1 thinking safe; silently breaks RN 0.81. | `bun install` peer warning; iOS launch red-box "TurboModule registry missing react-native-worklets". | Exact pin `0.9.0` (no caret). New `scripts/check-pin-bounds.sh` asserting exact match; wired into root `bun run check`. |
| 7 | **AsyncStorage SQLite pod overhead on macOS.** First `pod install` stalls during macOS SQLite resolution. | Tom step 1: `pod install` in macos/ takes > 60 s. | Document ~30-40 s expected in Tom's manual; if > 2 min, `--repo-update`. |

---

## Acceptance criteria

A commit on `main` is M21-complete when all hold (verifiable in one
terminal session):

1. `bun install` at repo root succeeds; no unmet peer warnings for the
   four new deps.
2. `cd voix-backend/ui && bun run build` produces `dist/index.html`.
3. `cd voix-backend && bun src/index.ts &` reaches `listening on :8765`.
4. `bun run check` from root passes (protocol-sync + native-sibling +
   pin-bounds — new in M21).
5. `clients/app/ios` and `clients/app/macos` each have successful
   `bundle exec pod install`.
6. `bunx tsc -p clients/app/tsconfig.json --noEmit` passes.
7. `packages/ui/src/platform/` has seven `.ts` + seven `.native.ts`
   files + `types.ts` + `index.ts`.
8. Every `.native.ts` has a non-`.native.ts` sibling
   (`scripts/check-native-siblings.ts`).
9. `packages/ui/src/lib/apiBase.{ts,native.ts}` DELETED — superseded
   by `platform/appInfo.*`.
10. `packages/ui/src/audio_io/client.native.ts` (M19 stub) DELETED —
    superseded by `platform/audioCapture.native.ts`.
11. Web PTT in the HA add-on UI still works end-to-end (Implementer
    manual spot-check).
12. iOS PTT works end-to-end (Tom's manual step 4 returns "session in
    Conversations").
13. macOS Voices/Surfaces/Conversations render; TalkButton on macOS
    throws a friendly error, NOT a crash.
14. `docs/STATE.md` marks M21 closed; `docs/phase-6/m21-manual.md`
    exists.

Out of scope: macOS audio (M22), iOS settings screen (M23), keyboard
extension (M24), Android (Phase 8), client-side VAD (post-MVP). Daemon
behaviour, ESPHome, HA integration untouched.

---

## Coordinator deltas slot

(Empty at write time. Verify trio fills in if they spot anything
material before merge. Default expectation per §7 of
agent-team-workflow: each delta adds an action item to the relevant
Decision and an extra acceptance criterion. Hard ceiling: 3 deltas
before re-planning.)
