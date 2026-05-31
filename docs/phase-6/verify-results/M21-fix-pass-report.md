# M21 fix-pass report
Status: SUCCESS

## Receipts

Five commits land on `main` (`076fdb3..224df0e`):

```
224df0e platform(M21 fix): deactivate iOS audio session on stop (Sasha medium)
6dbb844 ui(M21 fix): humanize macOS deferral strings (Wren FINDING-2)
6693fcc ui(M21 fix): actionable permission denial UX + Undetermined cleanup (Wren FINDING-1)
708ebd4 platform(M21 fix): event-driven recorder start; surface native errors (Sasha H2)
18ac561 platform(M21 fix): pin iOS recorder sample rate so hello + actual frames agree (Sasha H1)
```

Final smoke after the fifth commit:

```
$ bun run check
check-native-siblings: OK
check-protocol-sync: OK
check-pin-bounds: OK (react-native-worklets pinned at 0.8.3)

$ cd voix-backend/ui && bun run build
334 modules transformed.
dist/index.html                  0.70 kB │ gzip:   0.42 kB
dist/assets/index-ncoMi9ku.js  339.92 kB │ gzip: 105.24 kB
✓ built in 557ms

$ bunx tsc -p clients/app/tsconfig.json --noEmit
(exit 0, no output)
```

All three asserters green; vite build clean; both TypeScript projects
clean (root + leaf).

## Fix 1 — sample rate declaration

- Commit: `18ac561`
- audio-api doc citation: `AudioManager.getDevicePreferredSampleRate()`
  per https://docs.swmansion.com/react-native-audio-api/docs/system/audio-manager
  — "Returns the optimal sample rate for the current audio device …
  Query hardware capabilities to configure audio processing pipelines
  that match device specifications."

Before:

```ts
this.audioContext = new AudioContext({ sampleRate: opts.sampleRateHz });
this.negotiatedSampleRate = this.audioContext.sampleRate;
// …
this.recorder.onAudioReady(
  { sampleRate: opts.sampleRateHz, … },
  …
);
```

After:

```ts
const deviceRate = AudioManager.getDevicePreferredSampleRate();
this.audioContext = new AudioContext({ sampleRate: deviceRate });
this.negotiatedSampleRate = deviceRate;
// …
this.recorder.onAudioReady(
  { sampleRate: deviceRate, … },
  …
);
```

Both the AudioContext and the recorder now run at the exact rate the
AVAudioSession is routed to — Bluetooth HFP at 16 kHz, sim coreaudio at
48 kHz, headphones at 44.1 kHz — and the hello's `mic.sample_rate_hz`
(which reads from `capture.sampleRate`) declares that same rate to the
daemon. No more chipmunked STT on a route mismatch.

- Smoke: `capabilities.mic.sample_rate_hz` resolves to the literal
  number returned by `getDevicePreferredSampleRate()` (read via the
  `negotiatedSampleRate` field that the orchestrator already pipes
  into hello via `this.capture.sampleRate`). Daemon's first session
  log will print `mic=<deviceRate>` matching the actual frame rate.

## Fix 2 — event-driven recorder start

- Commit: `708ebd4`
- audio-api API used:
  - `AudioRecorder.onError(callback)` — subscription for
    `OnRecorderErrorEventType { message: string }`, per
    https://github.com/software-mansion/react-native-audio-api/blob/main/packages/react-native-audio-api/src/core/AudioRecorder.ts
    (lines 201-216 of the bundled file).
  - `AudioRecorder.isRecording(): boolean` — polled at 50 ms ticks up
    to 2 s as the substitute for the missing "onStart" event.
  - `AudioRecorder.clearOnError()` — wired into `stop()` so the
    subscription doesn't leak across PTT cycles.
- Surface: added optional `onError?: (err: Error) => void` to
  `AudioCaptureStartOpts` (types.ts). The orchestrator's
  `BrowserAudioIoClient.start()` now passes a handler that emits a
  typed error event (`kind: "audio"`) and calls `stop()`.
- The dead `result.status === "error"` branch is gone; in
  callback-only mode `recorder.start()` always returns
  `{status:"success"}` per the library source, so it was unreachable.

Smoke:
```
$ bun run check && cd voix-backend/ui && bun run build && bunx tsc -p clients/app/tsconfig.json --noEmit
all exit 0
```

## Fix 3 — permission UX

- Commit: `6693fcc`
- Diff surface:
  - `permissions.native.ts`: `Undetermined` → `reason: "undetermined"`
    (was `"unknown"` with the raw system string in `detail`).
  - `platform/types.ts`: `PermissionResult.reason` gains
    `"undetermined"`.
  - `audio_io/client.ts`: introduces `BrowserClientErrorKind` —
    `"permission-denied" | "permission-undetermined" |
    "permission-unknown" | "audio" | "network" | "decline" |
    "unknown"`. Every error-emit site sets `kind` and optionally
    `detail`.
  - `conversations/TalkButton.tsx`: new `RecoveryState` sub-component
    + `copyFor(error)` switch that renders kind-specific copy. Old
    red monospace `error` pill removed.

New TalkButton error rendering snippet:

```tsx
{error && <RecoveryState error={error} onRetry={handleRetry} />}
// …
function copyFor(error: ErrorState): { … } {
  switch (error.kind) {
    case "permission-denied":
      return {
        title: "Microphone access denied",
        body: "Open Settings → voix → Microphone, turn it on, then try again.",
        retryLabel: "Try again",
        showRetry: true,
        showDetail: false,
      };
    case "permission-undetermined":
      return {
        title: "Microphone access needed",
        body: "Tap the button to allow voix to hear you.",
        …
      };
    // …network, decline, audio, unknown all handled
  }
}
```

Visual treatment: soft `bgSubtle` background + `rule` border (matches
`ConversationList`'s `errorBox` shape), 13pt UI font for title, 12pt
body, HA-blue `Try again` button using the same `haBlueBg` /
`haBlue` token pair the active-button state uses. The red monospace
pill is gone — failures now read as product nudges, not console blobs.

Smoke:
```
$ grep -n "Microphone access denied\|Settings → voix → Microphone\|Try again\|Tap the button to allow" \
    packages/ui/src/conversations/TalkButton.tsx
191:        title: "Microphone access denied",
192:        body: "Open Settings → voix → Microphone, turn it on, then try again.",
193:        retryLabel: "Try again",
201:        title: "Microphone access needed",
202:        body: "Tap the button to allow voix to hear you.",
…
```

Decision 13 risk 2 copy is now visible verbatim in the source.

## Fix 4 — macOS jargon

- Commit: `6dbb844`
- Three sites updated:
  - `audioCapture.native.ts:137` — was `"audio capture: macOS audio
    lands in M22 (alongside global hotkey + paste)"`; now
    `"voix's microphone on macOS is coming soon."`.
  - `audioPlayback.native.ts:72` — same source string; same
    replacement (the brief specified one unified mic-capture string
    for both capture + playback throws).
  - `inlineAudio.native.tsx:98` — was `"Playback: macOS audio lands in
    M22"`; now `"Audio playback on macOS is coming soon."`.

No internal milestone numbers (M22, M23) remain in user-facing
strings.

## Fix 5 — audio session deactivate

- Commit: `224df0e`
- audio-api API reference:
  `AudioManager.setAudioSessionActivity(false)` per
  https://docs.swmansion.com/react-native-audio-api/docs/system/audio-manager
  — "This iOS-exclusive method manages the activation state of
  AVAudioSession … While the documentation doesn't explicitly provide
  a dedicated 'deactivate' method, `setAudioSessionActivity(false)`
  serves this purpose on iOS."
- Wired into `IosAudioCapture.stop()` after recorder + AudioContext
  teardown. Fire-and-forget with a `.catch(() => {})` so the sync
  `AudioCapture.stop()` signature isn't broken. Note: the
  `notifyOthersOnDeactivation` option defaults to `true` in
  `setAudioSessionOptions`, so other apps' audio routing will be
  notified to resume on session deactivation.

## Issues surfaced beyond brief

Noting only — not fixed in this pass, per "don't go beyond the brief":

- **Sasha N1 (audio-api worklets peer not optional in practice)** —
  audio-api 0.12.2 declares
  `peerDependenciesMeta.react-native-worklets.optional: true`, but
  the podspec raises a `Pathname.relative_path_from "different
  prefix"` if worklets is absent. A future contributor who drops
  worklets thinking it's optional will break `pod install`. A comment
  in `clients/app/package.json` (or the manifest's pin assertion)
  would catch them.
- **Sasha "interruption handling" (orchestrator gap)** — no
  `AudioManager.observeAudioInterruptions(...)` wiring. iOS phone
  call / Siri / route-change events flow through, mic stops emitting,
  WS stays open, TalkButton sits on "Listening." M22-or-later
  territory; the architectural pushback in Sasha's report calls this
  out.
- **Wren "iOS intent hardcoded to discuss"
  (`TalkButton.tsx:57`)** — `intent: "discuss"` is baked in; no UI
  surface to switch to `dictate`. Means a "make me a shopping list"
  utterance gets a voice reply, not a transcribed list. Wren's note
  flagged this as M23/M24 work (keyboard extension is the natural
  home for dictate); left as-is.
- **Sasha M4 (press-in/release race flicker)** — fast tap → release
  before `client.start()` resolves → brief "Listening" flash. Cosmetic,
  not correctness.
- **Wren "every failure mode looks the same"** — the Fix 3
  RecoveryState scaffolding is in place and tagged with every kind
  the orchestrator currently emits, so when M22 / M23 surface new
  error shapes (macOS not ready, dictate-unavailable, etc.) they slot
  into the same `copyFor` switch instead of needing more shape.

## Re-verify recommendation

ready-to-close

Reasoning: the three blocking findings (Sasha H1, H2, Wren FINDING-1)
all have direct fixes with the typed plumbing they needed; FINDING-2
is a copy swap; Sasha's medium audio-session-deactivate finding has a
documented audio-api API and is wired in. Tom-day verification of the
iOS PTT round-trip still belongs to Tom (sandbox can't drive sim
taps), but the three failure-mode surfaces Sasha called out — sample
rate mismatch, silent recorder-start failure, permission-denial UX —
are mechanically corrected and the remaining variance is whether Tom's
sim's preferred sample rate routes cleanly through the recorder, which
the implementation now reads as the single source of truth.
