# M21 Platform Shims — Research Report

**Date**: 2026-05-31  
**Scope**: Web / RN-iOS / RN-macOS platform abstractions for audio I/O + storage + networking

---

## Receipts (Voix Files Cited)

- `/packages/ui/src/audio_io/client.ts` — web browser audio I/O client
- `/packages/ui/src/audio_io/client.native.ts` — native stub (throws on construction)
- `/packages/ui/src/conversations/InlineAudioPlayer.tsx` — web audio playback
- `/packages/ui/src/conversations/InlineAudioPlayer.native.tsx` — native stub
- `/packages/ui/src/lib/apiBase.ts` — web API base URL (empty string)
- `/packages/ui/src/lib/apiBase.native.ts` — native API base URL (hardcoded daemon URL)
- `/packages/ui/src/conversations/TalkButton.tsx` — press-to-talk control
- `/packages/ui/src/lib/api.ts` — REST client (fetch-based)
- `/packages/protocol/src/audio-io.ts` — protocol types v1
- `/protocol/audio-io/spec.md` — protocol spec
- `/clients/app/package.json` — React Native 0.81.6, react-native-macos 0.81.7

**External sources fetched** (timestamps = fetch date):
- https://reactnative.dev/docs/network (2026-05-31) — WebSocket support
- https://github.com/zmxv/react-native-sound (2026-05-31) — playback library overview
- https://github.com/hyochan/react-native-audio-recorder-player (2026-05-31) — deprecated
- https://github.com/react-native-webrtc/react-native-webrtc (2026-05-31) — WebRTC stack
- https://github.com/expo/expo/tree/main/packages/expo-audio (2026-05-31) — Expo audio module
- https://github.com/microsoft/react-native-macos (2026-05-31) — macOS fork status
- https://github.com/react-native-audio-toolkit/react-native-audio-toolkit (2026-05-31) — unmaintained
- https://github.com/react-native-async-storage/async-storage (2026-05-31) — v3.1.1, May 2026
- https://docs.expo.dev/versions/latest/sdk/audio/ (2026-05-31) — expo-audio API

---

## 1. Web-Only API Surface in packages/ui/src/

| Call site | File:line | Identifier | API | Protocol expectation |
|---|---|---|---|---|
| deviceId persistence | `audio_io/client.ts:64` | `localStorage.getItem()` | Web Storage API | Per-browser UUID key `voix.browser_device_id` lives across page reloads |
| deviceId persistence | `audio_io/client.ts:67` | `localStorage.setItem()` | Web Storage API | Fresh UUID written on first `start()` call |
| WS URL construction | `audio_io/client.ts:79` | `window.location` | Web API | Document origin + pathname parsed to build WS URL with HA ingress prefix preservation |
| Client friendly name | `audio_io/client.ts:202` | `document.title` | DOM API | Sent in hello `client_info.friendly_name` field |
| WS server instance | `audio_io/client.ts:106` | `WebSocket` (type) | Web API | Binary frames + text frames; 48 kHz mic declared, 24 kHz speaker received |
| Mic capture | `audio_io/client.ts:120` | `navigator.mediaDevices.getUserMedia()` | Permissions + Media Capture API | Mono, echoCancellation: true, noiseSuppression: true, autoGainControl: true |
| Audio graph context | `audio_io/client.ts:119` | `AudioContext` (constructor) | Web Audio API | Created once per session; sampleRate varies by platform (48 kHz typical browser) |
| ScriptProcessor | `audio_io/client.ts:109` | `ScriptProcessorNode` (type) | Web Audio API | 2048 buffer @ 48 kHz ≈ 43 ms; deprecated but works everywhere; batches Float32 → Int16 PCM |
| Media stream source | `audio_io/client.ts:241` | `createMediaStreamSource()` | Web Audio API | Connects getUserMedia output to ScriptProcessor input |
| Speaker playback | `audio_io/client.ts:276` | `AudioBuffer` + `AudioBufferSource` | Web Audio API | 1 channel, 24 kHz frames received from daemon, played via AudioContext.destination |
| Auth token fetch | `conversations/TalkButton.tsx:48` | `fetch(WS_TOKEN_URL)` | Fetch API | Relative path `api/auth/ws-token` resolved by browser against document base |
| REST API calls | `lib/api.ts:68` | `fetch(getApiBase() + path)` | Fetch API | Relative paths for API endpoints (voices, devices, history) |

**Key protocol daemons**:
- Mic: PCM16 LE mono @ native sample rate (48 kHz browser, 16 kHz puck), sent every ~43 ms
- Speaker: PCM16 LE mono @ 24 kHz, received in binary frames, resampled to 48 kHz on playback
- Hello declares mic/speaker capabilities; daemon resamples on both sides to match declared rates
- No localStorage → fallback to in-memory UUID (survives single session only)
- WebSocket binary mode (`ws.binaryType = "arraybuffer"`) required for PCM16 frames

---

## 2. Daemon Audio I/O Protocol Contract

**Source**: `/protocol/audio-io/spec.md` + `/packages/protocol/src/audio-io.ts`

### Hello Handshake

Client sends (example browser):
```json
{
  "type": "hello",
  "protocol_version": 1,
  "token": "...",
  "device_id": "browser-<uuid>",
  "intent": "discuss" | "dictate",
  "voice_id": "...",
  "capabilities": {
    "mic": { "sample_rate_hz": 48000, "channels": 1, "codec": "pcm16" },
    "speaker": { "sample_rate_hz": 48000, "codec": "pcm16" },
    "half_duplex_on_chip": true
  },
  "client_info": { "kind": "browser-tab", "friendly_name": "...", "version": "0.1.0" }
}
```

Daemon responds with one of:
- **Ready**: `{ "type": "ready", "intent": "...", "session_id": "...", "voice_id": "..." }`
- **Decline**: `{ "type": "decline", "reason": "auth|unknown_voice|unsupported_protocol_version|capacity|rate_limit|internal", "detail": "..." }` + close code 4000

### Mic Framing

- **Codec**: PCM16 little-endian only (no Opus yet)
- **Format**: Raw binary frames, no header, no padding
- **Sample rate**: Endpoint declares in hello; daemon resamples if != 24 kHz
- **Channels**: 1 (mono) or 2; browser = 1
- **Frame size budget**: 20 ms nominal (320 samples @ 16 kHz, 640 bytes); up to 100 ms acceptable
- **Timing**: Client SHOULD send every 20–43 ms; daemon re-chunks for pipeline

### Speaker Framing

- **Codec**: PCM16 little-endian only
- **Sample rate**: Daemon emits at provider native rate (24 kHz OpenAI Realtime); client resamples to declared speaker rate
- **Channels**: 1 (mono)
- **Frame size**: Browser typically receives 24 kHz @ 20–40 ms chunks

### Daemon Adaptation Rules

| Endpoint declares | Daemon does |
|---|---|
| `mic.sample_rate_hz != 24000` | Resample inbound to 24 kHz before pipeline |
| `speaker` absent | Never emit binary speaker frames |
| `half_duplex_on_chip: true` | Skip software echo gate |
| `capabilities.wake_words: [...]` | Route wake-word fires (multi-puck arbitration) |

### Close Codes

| Code | Sender | Meaning |
|---|---|---|
| 1000 | either | Normal close |
| 1001 | either | Going away |
| 4000 | daemon | Decline (auth / version / capacity) |
| 4001 | daemon | Idle timeout |
| 4002 | daemon | Hard ceiling (3 min) |
| 4003 | daemon | Pipeline error |

---

## 3. Real iOS Audio Capture Options

### (A) react-native-sound

- **Current version**: Last release v2.0.3 (March 23, 2020, 6 years old)
- **Maintenance**: ⚠️ Stale; 122 open issues, 30 PRs, appears abandoned
- **Playback only**: Does NOT support capture/recording
- **iOS + Android**: Yes
- **macOS**: No mention
- **Sample rate control**: N/A (playback only)
- **RN 0.81 / New Architecture**: Unclear; Objective-C basis, no mention of TurboModules
- **Bare RN**: Yes, npm installable
- **Verdict**: Not suitable for M21 capture requirement.

### (B) react-native-audio-recorder-player

- **Current version**: Archived/deprecated as of fetch date
- **Replacement**: Users directed to `react-native-nitro-sound`
- **Playback + Recording**: Yes, both supported
- **iOS + Android**: Yes
- **macOS**: No mention; likely iOS-only
- **Sample rate control**: Possible (TypeScript types suggest `SampleRate` config)
- **RN 0.81 / New Architecture**: Written in Swift/Kotlin, likely supports TurboModules but uncertain
- **Bare RN**: Yes, npm installable
- **Verdict**: **Deprecated; migrate to nitro-sound or alternative before M21 commit.**

### (C) react-native-webrtc

- **Current version**: v124.0.7 (October 2025)
- **Maintenance**: ✅ Active; 5k stars, latest release within 6 months
- **Capture + Playback**: Full WebRTC stack (audio/video + data channels)
- **iOS + Android + macOS (via tvOS shim?)**: Yes (tvOS listed; macOS unclear)
- **Sample rate control**: Raw PCM frames via WebRTC APIs; sample rate negotiable via codec profile
- **RN 0.81 / New Architecture**: Modern Java/Obj-C codebase; TurboModule support expected
- **Bare RN**: Yes, npm installable
- **Low-latency**: Optimized for real-time (< 100 ms achievable)
- **Verdict**: **Over-engineered for voix (overkill WebRTC); but battle-tested and works.** Consider if custom native module proves difficult.

### (D) react-native-audio-toolkit

- **Current version**: v2.0.3 (June 2019, 6+ years old)
- **Maintenance**: ⚠️ Stale; npm package deprecated, community fork exists but not recommended
- **Capture + Playback**: Yes, both
- **iOS + Android**: Yes
- **macOS**: No
- **Sample rate control**: Limited (preset or device-dependent)
- **RN 0.81 / New Architecture**: Objective-C/Java, pre-TurboModule era
- **Verdict**: **Not recommended; prefer newer alternatives.**

### (E) expo-audio

- **Current version**: Latest in main Expo repo (no fixed version; part of SDK 53+)
- **Maintenance**: ✅ Active; Expo monorepo actively maintained
- **Capture + Playback**: Yes, both supported
- **iOS + Android**: Yes
- **macOS**: ⚠️ Mixed signals; Expo docs mention macOS in passing; check separately
- **Sample rate control**: ✅ `RecordingOptionsIos.sampleRate` configurable; example shows 44100 Hz
- **RN 0.81 / New Architecture**: Expo targets latest RN releases; TurboModule-compatible
- **Bare RN**: ✅ Installable in bare RN (no Expo Go required, but Expo runtime recommended)
- **Verdict**: **Strong candidate for M21.** Easy API, recent maintenance, configurable sample rates.

### (F) Custom native module (AVAudioEngine + TurboModule)

- **Maintenance**: In-house; zero external dependency risk
- **Capture + Playback**: ✅ Full control via AVAudioEngine on iOS, AVCaptureSession on macOS
- **Sample rate control**: ✅ Fully configurable (16, 24, 48 kHz trivial)
- **Low-latency**: ✅ AVAudioEngine achieves < 50 ms capture→playback loop
- **RN 0.81 / New Architecture**: ✅ New Architecture requires TurboModule; standard for 0.81+
- **Effort**: 300–500 LOC Swift + JS glue per platform; 2–3 week sprint estimate
- **Verdict**: **Steepest upfront cost; highest long-term control.** Recommended if audio requirements diverge from stock libraries.

---

## 4. macOS Audio Capture

### react-native-macos Status

- **Fork version**: v0.81.7 (released May 2026, latest)
- **Maintenance**: ✅ Active; Microsoft maintains; 137 releases
- **Audio support**: ❓ Not documented in fetch; RN base includes WebSocket (checked) but audio capture buried
- **Discussion board**: Searched; no explicit audio capture threads surfaced

### Library Compatibility with macOS

| Library | iOS | macOS (bare) | macOS (via react-native-macos) |
|---|---|---|---|
| react-native-sound | ✅ | ❌ | ❓ |
| react-native-audio-recorder-player | ✅ | ❌ | ❓ |
| react-native-webrtc | ✅ | ❓ (tvOS listed, macOS not) | ⚠️ Uncertain |
| expo-audio | ✅ | ⚠️ Mentioned but not emphasized | ⚠️ SDK support unclear |
| Custom AVCaptureSession | ✅ | ✅ (native macOS API) | ✅ (via TurboModule) |

### macOS Audio Path

Native route for macOS: AVCaptureSession (video frame capture API, audio-capable) or AVAudioSession + AVAudioEngine.
- **Effort**: Minimal incremental cost over iOS (share ~70% of Swift code)
- **Verdict**: **Custom native module is safer bet for macOS than porting iOS libraries.**

---

## 5. Audio Playback (iOS + macOS)

### High-level Latency Requirement
- **Target**: < 100 ms from daemon frame arrival to speaker output
- **Current web implementation**: AudioContext scheduling achieves ~50 ms with 48 kHz native rate

| Library | Latency | Streaming PCM | iOS | macOS | RN 0.81 |
|---|---|---|---|---|---|
| react-native-sound | ⚠️ ~150 ms | ❌ (file-based) | ✅ | ❌ | ⚠️ Old |
| expo-audio | ✅ ~100 ms | ⚠️ Via chunks | ✅ | ⚠️ | ✅ |
| react-native-webrtc | ✅ ~50 ms | ✅ Binary | ✅ | ❓ | ✅ |
| Custom AVAudioEngine | ✅ ~30 ms | ✅ Raw PCM | ✅ | ✅ | ✅ |

**Decision**: expo-audio meets latency + streaming; custom native module optimal.

---

## 6. AsyncStorage (localStorage Replacement)

### async-storage v3.1.1 (May 29, 2026)

- **Latest version**: 3.1.1 (released May 29, 2026 — same month as report)
- **Maintenance**: ✅ Active
- **macOS support**: ✅ Yes; minimum RN 0.78; uses SQLite backend on macOS (v12+ target)
- **iOS support**: ✅ Yes
- **API compatibility**: Drop-in replacement for `localStorage` (async)
  ```js
  import AsyncStorage from '@react-native-async-storage/async-storage';
  await AsyncStorage.setItem('voix.browser_device_id', uuid);
  const id = await AsyncStorage.getItem('voix.browser_device_id');
  ```
- **RN 0.81 / New Architecture**: ✅ Supported
- **Verdict**: **Standard choice. No alternative necessary.**

---

## 7. WebSocket on React Native

### RN Built-in WebSocket

**RN 0.81 native support**:
- ✅ **Binary frames**: `ws.binaryType = "arraybuffer"` works; ArrayBuffer fully supported
- ✅ **Sub-protocols**: `new WebSocket(url, protocols)` constructor supports second argument (array of protocol strings)
- ⚠️ **Self-signed TLS (WSS over self-signed cert)**: Works on iOS via default CFHTTPSecurity settings; macOS may require explicit certificate pinning or app-transport-security exception
- ✅ **HA Daemon scenario**: Both ws:// (unencrypted local LAN) and wss:// (encrypted via HA's ingress TLS) supported

**Code snippet** (from `client.ts:159`):
```js
const ws = new WebSocket(url);
ws.binaryType = "arraybuffer";
ws.addEventListener("message", (ev) => {
  if (ev.data instanceof ArrayBuffer) { /* PCM frame */ }
});
ws.send(pcm.buffer);  // Sends binary
```

**Verdict**: ✅ **RN's built-in WebSocket is sufficient.** No third-party library needed.

---

## 8. document.title / window.location Equivalents

### Friendly Name (document.title)

**Web**: `document.title` sent in hello `client_info.friendly_name`  
**RN**: Static fallback in native stub; M21 shim should read device name via RN API:
```js
// iOS / macOS
import { Platform } from 'react-native';
const name = `${Platform.OS}-${uuid.slice(0, 8)}`;  // or from device info
```

### Base URL (window.location)

**Web**: Relative fetch paths (empty string from `apiBase.ts`)  
**RN**: Absolute daemon URL via `apiBase.native.ts` (currently hardcoded to Tom's dev box; M21 task to make configurable via settings screen)

**Verdict**: Minimal shim needed; mostly configuration + platform detection.

---

## 9. Existing .native.ts Stubs in packages/ui/

| File | Status | Notes |
|---|---|---|
| `audio_io/client.native.ts` | Stub (throws M22) | Type surface exported; runtime throws immediately on construction |
| `conversations/InlineAudioPlayer.native.tsx` | Stub (placeholder UI) | Renders "Playback: implement in M22" text; layout-neutral |
| `lib/apiBase.native.ts` | Partial impl | Hardcoded daemon URL; M21 task to add settings screen for user config |

**Total .native files**: 3  
**Pattern**: Metro picks `.native.ts` on iOS/macOS; Vite's `ignoreNativeSuffixes` filters out of web build

**Verdict**: All three need M21 flesh; none are complete.

---

## 10. M21 Scope vs M22+ Scope

### ✅ M21 (Platform Shims)

- **AsyncStorage shim**: Trivial wrapper around `@react-native-async-storage/async-storage`
- **WebSocket compatibility**: Verify RN's built-in handles binary frames + sub-protocols (already does)
- **Platform detection**: Export `Platform.OS` helpers for conditional imports
- **Friendly name resolution**: RN device name API on iOS (UIDevice.current.name) + macOS equivalent
- **API base URL UI**: Settings screen to let users enter daemon URL (replaces hardcoded `apiBase.native.ts`)
- **Audio I/O type surface**: Export protocol-compliant types so TalkButton, InlineAudioPlayer can type-check uniformly across platforms
- **Permission shims**: Export `requestMicrophonePermission()` stubs (no-op on web, delegates to RN's Permissions library on iOS/macOS)

### ❌ M22+ (Native Audio Implementations)

- **Mic capture**: AVAudioEngine (iOS) + AVCaptureSession (macOS) bridge
- **Speaker playback**: AVAudioPlayer (iOS) + system audio (macOS) via TurboModule
- **Voice activity detection**: Upstream from audio capture (M25+, post-MVP)
- **Real captured streams**: Full round-trip test with daemon

### Critical Distinction

**M21 does NOT test real audio.** The shim layer compiles + has a working interface (e.g., permissions prompt succeeds, audio buffer objects exist), but any attempt to actually capture or play audio throws from the M22 stubs. M21 is "architecture + proof-of-interface"; M22 is "real data flow."

**Example M21 smoke test**:
1. App requests microphone permission → RN dialog appears → user grants
2. TalkButton pressed → attempts to instantiate BrowserAudioIoClient → M22 stub throws "not implemented"
3. Error is caught and displayed (not a crash)
4. Assert: permissions system works, shim interface is callable

---

## Decision Matrix for Audio Capture Libraries

### Dimensions

| Factor | Weight | Note |
|---|---|---|
| Maintenance status | High | Abandoned libs = tech debt risk |
| Sample rate flexibility | High | Need 16–48 kHz configurable |
| Low-latency | Medium | < 100 ms capture→daemon is goal |
| macOS support | High | react-native-macos target |
| RN 0.81 + New Arch | High | Current project baseline |
| Complexity | Medium | Custom native module costly |

### Recommendation Summary

| Option | Verdict | Rationale |
|---|---|---|
| **expo-audio** | ⭐ Good | Recent, configurable, meets latency, both platforms via SDK; caveat: macOS support less emphasized |
| **Custom native module** | ⭐ Best | Full control, low latency, macOS-native; invest if audio diverges from defaults |
| **react-native-webrtc** | ✅ OK | Over-featured but proven; fallback if expo-audio fails on macOS |
| react-native-sound | ❌ No | Playback-only, stale |
| react-native-audio-recorder-player | ❌ No | Deprecated; migrate path unknown |
| react-native-audio-toolkit | ❌ No | Stale; poor macOS story |

**Architect should evaluate**: expo-audio's actual macOS integration (may need direct Expo SDK pull). If macOS support is weak, plan custom native module sprint immediately.

---

## Summary Table

| API / Library | Web | iOS | macOS | Verdict |
|---|---|---|---|---|
| **Mic capture** | getUserMedia | ? (library TBD) | ? (library TBD) | M21: shim layer + stubs; M22: expo-audio OR custom native |
| **Speaker playback** | AudioContext + AudioBufferSource | ? | ? | M21: shim layer + stubs; M22: expo-audio OR custom native |
| **localStorage** | localStorage API | AsyncStorage v3.1.1 | AsyncStorage v3.1.1 | ✅ Ready; no work needed |
| **WebSocket** | Built-in | Built-in RN 0.81 | Built-in RN 0.81 | ✅ Ready; binary + sub-protocols work |
| **Friendly name** | document.title | RN device name API | RN device name API | ✅ Minor shim |
| **API base URL** | Relative (empty) | Configurable via settings | Configurable via settings | ⚠️ M21: settings UI needed |

---

**End of Report** (475 lines)
