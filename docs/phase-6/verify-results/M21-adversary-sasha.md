# Sasha's adversarial review of M21

The audio code is shipped but unrun. Every audio bug class is latent —
fair game for a code review that assumes the worst. I confirmed two of
the six seeded suspicions (sample-rate decl mismatch, one weaker
finding around iOS recorder fallback paths), refuted three (the
`floatToPcm16` port, the AVAudioSession category, the hoist ghost),
verified the pin-bounds asserter actually works, and surfaced three
new things the brief didn't ask me to look at. The Tom-day prediction
is at the bottom — it's falsifiable and I'd bet on it.

## Receipts

Read (post-implementer-commit, HEAD = `076fdb3`):

- `packages/ui/src/platform/audioCapture.native.ts` (148 L) +
  `audioPlayback.native.ts` (89 L) + `permissions.native.ts` (45 L) +
  `appInfo.native.ts` (74 L) + `inlineAudio.native.tsx` (135 L) +
  `storage.native.ts` (40 L)
- `packages/ui/src/platform/audioCapture.ts` (102 L) + `audioPlayback.ts` +
  `appInfo.ts` + `permissions.ts` + `storage.ts` (web siblings, for the
  byte-diff)
- `packages/ui/src/audio_io/client.ts` (M21 orchestrator, 256 L)
- `packages/ui/src/conversations/TalkButton.tsx`
- `clients/app/ios/voix/Info.plist` (59 L) + `clients/app/package.json`
  + root `package.json` + relevant lines of `bun.lock`
- `clients/app/node_modules/react-native-audio-api/src/core/AudioRecorder.ts`
  (228 L) + `src/core/AudioContext.ts` + `src/core/BaseAudioContext.ts` +
  `src/system/AudioManager.ts` + `src/system/types.ts` +
  `src/events/types.ts` + `src/types.ts` (AudioRecorderCallbackOptions)
- `clients/app/node_modules/react-native-worklets/RNWorklets.podspec` +
  `compatibility.json` + `scripts/worklets_utils.rb`
- `voix-backend/src/audio_io/connection.ts` (hello + resample path) +
  `voix-backend/src/api/auth.ts` (ws-token route)
- `docs/phase-6/verify-briefs/M21-adversary-sasha.md` (brief),
  `docs/phase-6/verify-results/M21-implementer-report.md`,
  `docs/phase-6/architecture-m21.md`, `docs/phase-6/m21-manual.md`

Ran:

- `bash scripts/check-pin-bounds.sh` after editing
  `clients/app/package.json` to `"react-native-worklets": "0.9.0"` →
  exit **1** with the right message:
  `check-pin-bounds: /Users/tom/Projects/voix/clients/app/package.json
  pins react-native-worklets at 0.9.0; expected 0.8.x`. Restored to
  `0.8.3` immediately. Asserter does what it claims.
- `ls -la clients/app/node_modules/react-native-{audio-api,worklets,device-info}`
  + same on root `node_modules/` — all symlink into bun's `.bun/` store
  at the expected versions (`audio-api@0.12.2`, `worklets@0.8.3`,
  `device-info@15.0.2`). No hoist ghost; both leaves AND root resolve.

Delta C independently verified:

- `compatibility.json` says `"0.9.x": { "react-native": ["0.83", "0.84",
  "0.85", "0.86"] }`. The repo is on `react-native@0.81.6`. 0.9.x would
  fail the asserter.
- `RNWorklets.podspec` line 7 calls
  `worklets_assert_minimal_react_native_version($worklets_config)`,
  which in `scripts/worklets_utils.rb:55-62` invokes
  `validate-react-native-version.js` and **raises** with `[Worklets]
  Your installed version of React Native is not compatible with
  installed version of Worklets.` on mismatch. So 0.9.0 + RN 0.81.6
  would fail `pod install` exactly as the Implementer's report claims.
  Delta C is real and well-reasoned; the brief's original 0.9.0 pin was
  wrong, the implementer's 0.8.3 is right.

`bun.lock` resolves `react-native-worklets@0.8.3` with
`peerDependencies: { "react-native": "0.81 - 0.85" }` — RN 0.81.6 is in
range. Exact-pin string (`"0.8.3"`, no caret) survives the asserter's
caret-disallowed check.

## Findings, by severity

### Blockers

None I can prove off-keyboard. The two High items below would block if
they materialise on Tom-day, but they're suspicions not proofs.

### High

**H1. Hello declares the AudioContext's sample rate, not the recorder's —
the seeded sample-rate mismatch is real and unverifiable until Tom runs.**

`audioCapture.native.ts:89-90`:

```ts
this.audioContext = new AudioContext({ sampleRate: opts.sampleRateHz });
this.negotiatedSampleRate = this.audioContext.sampleRate;
```

The hello (`client.ts:179-183`) reads
`this.capture.sampleRate ?? 48000` and ships that in
`capabilities.mic.sample_rate_hz`. **But the recorder isn't connected to
this AudioContext.** `AudioRecorder` is constructed at line 95 with no
context arg:

```ts
this.recorder = new AudioRecorder();
this.recorder.onAudioReady(
  { sampleRate: opts.sampleRateHz, bufferLength: opts.bufferSize, channelCount: 1 },
  ...
);
```

The recorder takes `sampleRate` as a *preferred* config, per
`AudioRecorder.ts:144` docs ("These parameters... guide how audio data
is chunked and delivered, **though the exact values may vary depending
on device capabilities**"). The callback fires with
`OnAudioReadyEventType = { buffer, numFrames, when }` — no
`sampleRate` field. There is no read-back of the recorder's actual
delivered rate.

Meanwhile, the daemon at
`voix-backend/src/audio_io/connection.ts:268` trusts the hello's
`mic.sample_rate_hz` and feeds it to the upstream STT resampler. So if
the recorder delivers at, say, 44.1 kHz (sim default on a Mac, or a
Bluetooth-route fallback) but the hello says 48 kHz, every speech token
upstream is fed PCM that's ~9% slower than it should be — chipmunked
in the STT, and the user gets "transcript: chrkchrcrkchrk" not "hello".

How likely is it in production? Concretely:

- On an iPhone 16 Pro sim, the default `getDevicePreferredSampleRate()`
  is usually 48000. Tom-day would probably pass.
- On a *real* iPhone routed to Bluetooth HFP (which the impl
  intentionally allows via `iosOptions: ["allowBluetoothHFP"]`), the
  AVAudioSession sample rate often forces down to 16 kHz for the HFP
  uplink. The recorder will deliver at 16 kHz. AudioContext was created
  with 48000 → recorder delivers 16000 → hello declares 48000 →
  chipmunked at the daemon.
- Same risk on a route change mid-session (sim plug-in headphones,
  Bluetooth disconnect) — recorder switches rates but `sampleRate`
  has no setter; the hello stays at the original value forever.

**Fix the right way**: stop trusting `audioContext.sampleRate` as a
proxy. Either (a) use the first `event.numFrames / event.when` delta to
back-compute the actual recorder rate and re-send the hello, or (b)
defer the hello until after first `onAudioReady` and read… well, the
event has no sampleRate. Then it's (c): explicitly call
`AudioManager.getDevicePreferredSampleRate()` BEFORE creating the
recorder, pass THAT as both the recorder's `sampleRate` and the AC's
`sampleRate`, and *believe* that the recorder honoured it (which is at
least documented behaviour, even if not guaranteed).

The Implementer's notes for me even point at this region: "The
audioCapture.native.ts onAudioReady → onFrame conversion — the channel
data is read from event.buffer.getChannelData(0) and converted to
Int16; clipping + endianness sanity required." They flagged the
clipping/endianness — those are fine (see L1 below). The thing they
*didn't* flag is the missing fact-checked rate.

**H2. `recorder.start()` result check is dead code; recorder-start
failures are silent.**

`audioCapture.native.ts:108-112`:

```ts
const result = this.recorder.start();
if (result.status === "error") {
  this.stop();
  throw new Error(`AudioRecorder start failed: ${result.message}`);
}
```

But `AudioRecorder.ts:74-81`:

```ts
start(options?: AudioRecorderStartOptions): Result<{}> {
  if (!this.isFileOutputEnabled) {
    this.recorder.start();
    return { status: 'success' };
  }
  return this.recorder.start(options?.fileNameOverride);
}
```

We never call `enableFileOutput()` — we're using the recorder in
callback-only mode. So `start()` calls the native start (which returns
**void**, not a Result, see `IAudioRecorder.start` signature implied by
the lack of return-value handling) and unconditionally returns
`{ status: 'success' }`. The `result.status === "error"` branch is
unreachable. Any native-side recorder-start failure (AVAudioSession
not active, hardware busy, permission revoked mid-session) surfaces as
**no audio frames** — the orchestrator transitions to "listening", the
TalkButton shows "Listening", the daemon stays open with zero PCM, and
eventually the daemon's idle timeout fires.

The error path needs an alternative: either subscribe to
`recorder.onError(...)` (the lib exposes it at AudioRecorder.ts:201)
and route those errors back through the orchestrator's error event, or
poll `recorder.isRecording()` shortly after start and surface a
synthetic error if false. Today, the only signal is "no transcript
appears."

### Medium

**M1. Permission denial flow surfaces an error event but the
TalkButton doesn't render it differently from "audio error" — it'll
look like a network/WS failure to Tom.**

`client.ts:107-115`:
```ts
const perm = await permissions.requestMicrophone();
if (!perm.ok) {
  this.opts.onEvent({
    type: "error",
    message: `microphone permission ${perm.reason}${perm.detail ? `: ${perm.detail}` : ""}`,
  });
  this.stop();
  return;
}
```

`TalkButton.tsx` catches `ev.type === "error"` and sets the error
string. So a deny produces "microphone permission denied" in the error
ribbon — that's surfaced. **BUT**: there's no recovery hint that
matches Decision 13 risk 2's spec ("Microphone access denied. Settings
→ voix → Microphone."). The UI shows a raw error string. The
*architecture* says "Acceptance includes that string visible after a
deny." It is not. The Implementer's iOS smoke pre-granted permission
via `simctl privacy grant`, so they didn't see this gap. Tom won't
either unless he resets permission. Mild surface issue, fixable in
TalkButton with a `reason === "denied"` branch.

**M2. macOS RN advertises `client_info.kind = "phone-sat"` to the
daemon — wrong taxonomy.**

`appInfo.native.ts:71`: `clientKind: "phone-sat"` — no Platform.OS
branch. On macOS RN (Tom's step 5), the daemon receives `kind =
"phone-sat"` from a Mac. M22 says it will switch to `"laptop-mic"` when
audio lands; for now, every macOS connection writes a wrong-kind entry
into the daemon's Surfaces table. It will only be visible once macOS
actually opens a WS, which is "audio capture: macOS audio lands in M22"
— never, on M21. So this is **inert today** but a known foot-gun for
M22.

**M3. `playbackTime` watermark only grows; long stalls extend
end-of-session latency.**

`audioPlayback.native.ts:60` / `audioPlayback.ts:60`:
`this.playbackTime = startAt + buf.duration;`

If the model produces a 4-second burst, the watermark is set 4s into
the future. If a network blip then drops a single frame and the next
chunk arrives 2s late, the watermark already covers the gap (good,
gapless). But on a slow model start where the *first* chunk arrives
1s after `audio_start`, `startAt = max(now, 0) = now`, and the
watermark grows from there normally. So far OK.

The actual concern is **session-end**: when user releases TalkButton,
`stop()` is called and `audioContext?.close()` is invoked. Any
scheduled chunks past `now` are dropped on the floor — fine on web
(AudioContext.close() returns a Promise and disconnects), **but on
audio-api the docs don't guarantee that scheduled BufferSourceNodes
are revoked atomically on close()**. Could result in a tail of audio
playing after the user releases. Untested.

**M4. The TalkButton press-in/press-out race: client.start() resolves
*after* press-out, the post-await check stops it — but the WS may have
already received `ready`/`audio_start` events that flip the status
state machine to "listening", then immediately to "closing" → "idle".
Visible flicker; not a correctness bug, just ugly.**

`TalkButton.tsx:65-69`:
```ts
await client.start();
if (!holdingRef.current) client.stop();
```

`client.start()` opens the WS and waits for `ready`. On a fast
local-LAN daemon (Tom's setup), this is 30-80 ms. If Tom taps faster
than that, the start path resolves AFTER his release. The orchestrator
will pass through "ready" → "listening" before the post-await stop
fires. Fine, but I'd put money on the user seeing a brief "Listening"
flash on a quick tap.

### Low

**L1. `floatToPcm16` is byte-for-byte identical between web and native.**

Diffed `packages/ui/src/platform/audioCapture.ts:30-37` and
`packages/ui/src/platform/audioCapture.native.ts:50-57`:

```ts
function floatToPcm16(input: Float32Array): Int16Array {
  const out = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i] ?? 0));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}
```

Same impl, same constants, same asymmetric scaling (s < 0 ? *0x8000 :
*0x7fff — the right Web-Audio idiom for symmetric -1..1 → -32768..32767
encoding). The `pcm16ToFloat` reverse path is also identical (both
divide by 0x8000, not 0x7fff — a 1-LSB asymmetry on positive samples,
which is the standard trade-off). The seeded "floatToPcm16 correctness"
suspicion is **refuted**. The port is faithful.

**L2. AVAudioSession category is right.**

`audioCapture.native.ts:78-82`:
```ts
AudioManager.setAudioSessionOptions({
  iosCategory: "playAndRecord",
  iosMode: "voiceChat",
  iosOptions: ["defaultToSpeaker", "allowBluetoothHFP"],
});
```

All four enum values exist in `react-native-audio-api/src/system/types.ts`
(verified). `playAndRecord` is the right category for full-duplex PTT
(the suspicion's `.record` / `.playback` / `.soloAmbient` failure modes
don't apply). `voiceChat` mode is *better* than the brief's
recommended `"default"` — it activates iOS's hardware AEC + the
voice-tuned EQ, which matters because the daemon doesn't run
software AEC on phone-sat (the hello declares
`half_duplex_on_chip: true`). `defaultToSpeaker` is correct for
loud-speaker output without headphones; `allowBluetoothHFP` covers
AirPods etc. (with the H1 sample-rate caveat).

The brief's suspicion #3 is **refuted**. The category config is
deliberate and right.

**L3. Pin-bounds asserter works.**

Edited `clients/app/package.json` to `"react-native-worklets": "0.9.0"`,
ran `bash scripts/check-pin-bounds.sh`, exit 1, message:

```
check-pin-bounds: /Users/tom/Projects/voix/clients/app/package.json
pins react-native-worklets at 0.9.0; expected 0.8.x
  M21 Decision 13 risk 6: 0.9.x requires RN 0.83+, we're on RN 0.81.6.
```

Restored. The asserter also catches range pins (caret/tilde) and
root↔leaf disagreement. Good defensive coverage. Decision 13 risk 6
is **mitigated by code, not just docs**. Refutes suspicion #6.

**L4. UIBackgroundModes is set.**

`clients/app/ios/voix/Info.plist:40-43` contains
`<key>UIBackgroundModes</key><array><string>audio</string></array>`.
M24's keyboard ext WS-survival prerequisite is met. Adversarial task
item refuted.

**L5. AsyncStorage cold-launch fallback is fine.**

`appInfo.native.ts:55-58`: `apiBaseCache = stored ??
DEFAULT_DEV_DAEMON_URL`. If the deleted `apiBase.native.ts` left no
trace in AsyncStorage (which it wouldn't — the key now lives under
`voix.api_base`), cold-launch falls back to
`"http://192.168.99.86:8765/"`. No crash, no prompt, no flicker. The
old key never existed; there's no migration to do. Adversarial task
item refuted.

**L6. inlineAudio.native.tsx leaks an old BufferSource on rapid
re-tap.**

`inlineAudio.native.tsx:62-75`: handlePlay sets `nodeRef.current = node;
node.start();` then a `setTimeout` clears nodeRef after
`buf.duration * 1000 + 50` ms. If the user taps Play, then taps the
button again before the timeout fires, the early-return at line 51
(`if (phase === "loading" || phase === "playing") return;`) catches
it — OK. But if they tap a *different* InlineAudioPlayer (a different
conversation entry), the AudioContext from the first one stays open
until unmount. Not a leak per se (each player has its own
useEffect-cleanup), but on conversation detail with 5 audio entries
the AudioContexts pile up. Minor.

## New findings not in the seed

**N1. `inlineAudio.native.tsx` blocks the playback on the iOS audio
session being in `playAndRecord` from a prior PTT session.**

If the user PTTs (which sets category to `playAndRecord` + activates
the session), releases, and then navigates to a conversation and taps
an InlineAudioPlayer — the `audioCapture.native.ts:128` `stop()` calls
`AudioManager.setAudioSessionActivity(true)` (in `start()`) but never
de-activates on `stop()`. The session stays active with
`playAndRecord` until something else changes it. Inline playback
inherits that, which is fine for output but the session is now stuck
half-open. Not a Tom-day issue, but a real audio-session hygiene gap.

**N2. The orchestrator's `permission denied` event is fired before
`playback.start()` runs, but `stop()` is then called immediately —
`stop()` calls `playback?.stop()` on a null playback, which is a
no-op. So far OK. But the orchestrator sets `status = "closing"` →
"idle" while the WS hasn't been opened. State machine is consistent.
Not a bug, just worth noting for the puck-side half-duplex M22 work.

**N3. `peerDependenciesMeta.react-native-worklets.optional: true` on
audio-api 0.12.2 — but the audio-api podspec is documented in the
implementer report as raising `Pathname.relative_path_from "different
prefix"` if worklets is absent.**

That means worklets is **not optional in practice**, despite the npm
metadata. If a future contributor tries to drop worklets to clean up
deps (reasoning: "it's optional"), pod install will mysteriously
break. The implementer's `m21-manual.md` recovery section calls this
out, but `package.json` doesn't — a comment in package.json (or a
README in `clients/app/`) would catch the next person.

## The Tom-day prediction

**Tom's manual step 4 will land him on "Listening" indefinitely on
the first attempt, with the daemon log showing the hello but no
subsequent `audio_io ... mic frames received` lines.**

Falsification: if Tom runs step 4 and within 5 seconds hears voix
reply, this prediction is wrong.

Why I'd bet on it:

- The iPhone 16 Pro sim's audio path is `coreaudio-simulator`, not
  real CoreAudio. Sample rate negotiations are different. The
  Implementer report explicitly cites this as a Sasha-attack-surface
  in their notes.
- `recorder.start()` failures are silent (H2). Anything that goes
  wrong in the AVAudioSession activation path (mic permission cache
  was reset by Tom mid-debug, audio route change on sim spin-up,
  session category collision with a prior background audio app)
  produces no frames with no error.
- The sim's `simctl privacy grant microphone` granted permission, but
  the **mic-input device** isn't necessarily routed by the sim if
  Tom's Mac has no actual mic plugged in or the sim's input device is
  set to "None" in Settings → Audio. Same silent-failure mode.
- The Implementer's smoke explicitly did not run PTT end-to-end —
  this is the first run, and "Listening with no audio" is the
  default failure mode for unrun iOS audio code.

If H2 fires and Tom has an `onError` to read, he'd at least see
"AudioRecorder start failed: ...". Today, he sees a button stuck on
"Listening" and a daemon log with `hello` then nothing.

The fix once he hits it: add `recorder.onError(...)` subscription in
`audioCapture.native.ts:start()` that forwards through `opts.onError`
(plumbed up through `AudioCaptureStartOpts`). 30-line patch, but
needed before the next round of audio debugging.

## Architectural pushback

Two things I'd push back on, not Tom-day-blocking:

1. **The orchestrator should not be one file across web + RN.**
   `audio_io/client.ts` reads `appInfo.clientKind` and assumes the
   capture is one-shot start/stop. On RN, when iOS interrupts the
   session (phone call, Siri, route change), the `AudioManager`
   `interruption` event needs to flow through to the orchestrator so
   it can pause-and-resume cleanly. Today there's no route for that
   event — the WS stays open, mic stops emitting, and we're back at
   "stuck on Listening." This is M22-or-later territory but worth a
   `// TODO(M22): observeAudioInterruptions` in
   audioCapture.native.ts.

2. **The brief said "iOS audio ships in M21, macOS defers to M22."
   What actually shipped is *iOS audio code* (unrun) + *macOS audio
   stub* (unrun). The Implementer reasonably can't run an iOS PTT loop
   from this sandbox. But "shipped" is doing a lot of work — the
   abstraction is proven by typecheck, not by a single mic frame.**
   The acceptance criterion 12 ("iOS PTT works end-to-end") is
   explicitly punted to Tom-day. That's fine for the milestone, but
   STATE.md should call out that the abstraction is *typecheck-proven,
   not behaviour-proven*, so the next milestone planner doesn't
   inherit "M21 worked" as ground truth.

3. **(bonus)** The `__dev__.setApiBase()` export pollutes the
   production bundle on web. Vite doesn't tree-shake `__dev__`-named
   exports by default; only the import side does. If `@voix/ui`'s
   barrel re-exports `__dev__` and consumers don't import it (they
   shouldn't), it still ships in the dist bundle. Net delta in module
   count is 0, per the Implementer's report, but the *bytes* delta may
   be nonzero. Worth a `if (process.env.NODE_ENV !== "production")`
   guard around the `__dev__` registration. M23-window cleanup.
