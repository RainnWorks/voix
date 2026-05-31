# Wren's M21 product review

The premise for M21: voix's first real encounter with a user as a voice
product. Web was the rehearsal; iPhone is the stage. The screen should
disappear; the voice should land. Reviewing through that lens.

## Receipts

Files read (`stat -f "%m %z %N"`):

```
1780235543 6157 packages/ui/src/conversations/TalkButton.tsx
1780234341 8771 packages/ui/src/audio_io/client.ts
1780234520 1849 packages/ui/src/platform/permissions.native.ts
1780235033 5169 packages/ui/src/platform/audioCapture.native.ts
1780234508 3172 packages/ui/src/platform/audioPlayback.native.ts
1780234538 3662 packages/ui/src/platform/inlineAudio.native.tsx
1780234563 1728 clients/app/ios/voix/Info.plist
1780234550 1462 clients/app/macos/voix-macOS/Info.plist
1780148800 5408 packages/ui/src/lib/theme.ts
        ?  ?    voix-brand-guide.html (re HA blue, wordmark, surface)
        ?  ?    voix-desktop-guide.html
        ?  ?    /tmp/voix-smoke-screenshots/m21-step5.png
```

Diff against M20 close-out:

```
$ git diff --stat 5536fb9..HEAD -- packages/ui/src/components/ packages/ui/src/lib/theme.ts
(empty — no changes)
```

`git diff --stat 5536fb9..HEAD -- packages/ui/src/` shows the M21
boundary cleanly: 7 deletions in `audio_io/client.native.ts` +
`lib/apiBase.{ts,native.ts}` + `conversations/InlineAudioPlayer.{tsx,native.tsx}`;
14 additions in `platform/*`; one trim in `audio_io/client.ts`
(monolith → orchestrator); 6-line edit in `TalkButton.tsx` (apiBase
import only); 2-line edit in `ConversationDetail.tsx` + `index.ts`
(import source for InlineAudioPlayer). **Brand layer is unchanged.**

## Brand continuity through native audio

### Task 1 — components + theme diff
- `git diff 5536fb9..HEAD -- packages/ui/src/components/` is empty.
  `AppShell.tsx`, `Puck.tsx`, `Wordmark.tsx` all untouched.
- `git diff 5536fb9..HEAD -- packages/ui/src/lib/theme.ts` is empty.
  `colors.haBlue = "#03A9F4"` matches `voix-brand-guide.html`'s
  `--ha-blue: #03A9F4` exactly (line 16 of the guide).
- TalkButton's only edit is at `TalkButton.tsx:21,23,49` — swapping
  `getApiBase` import to `appInfo`, and the WS_TOKEN_URL becoming
  a relative path concatenated to `base`. Zero visual edits.
- **Verdict: brand layer survives cleanly.** The platform shim layer
  is genuinely orthogonal to the visual layer — exactly the M19
  Decision-6 promise made good on.

### Task 2 — TalkButton state model on iOS sim
The iOS sim screenshot at `/tmp/voix-smoke-screenshots/m21-step5.png`
shows the Voices list, **not** the TalkButton screen — the Conversations
tab wasn't navigated to. So I'm verifying the state model from the
code, not from pixels.

`TalkButton.tsx:118-135` labels:
- `idle` → "Talk to voix" ✓
- `connecting` → "Connecting…" ✓
- `ready`/`listening` → "Listening" ✓ (the M18 "fold ready into
  listening" decision is preserved — good)
- `speaking` → "voix is replying" ✓
- `closing` → "Wrapping up…" ✓

Color states at `TalkButton.tsx:143-176`:
- Idle: `bgElevated` background, `rule` border, ink label — neutral
  pill. ✓
- Active (listening/connecting/ready): `haBlueBg` (8% blue tint),
  `haBlue` border, blue label. ✓
- Speaking: `haBlue` solid fill, `bgElevated` (cream/light) label. ✓
  **M18 inverted-pill survives the native render path.**

Thumb-target sizing: `paddingHorizontal: spacing.xl` (typically 24
in this theme) + `paddingVertical: spacing.md` (12) on a 13pt label
+ glyph. That's roughly 44pt tall on iOS — at Apple's 44×44pt
minimum tap target. Borderline on width when label is just "Listening"
but the pill is full-width via `flexDirection: "row"` so the parent
layout controls. Tom's smoke will tell if it reads thumb-sized in
real use; from the code, it's compliant but not generous.

**Verdict: state model survives. Tom should run the smoke and visually
confirm the speaking state inverts on a real session.** No code-level
regression found.

### Task 7 — Watching briefs carried forward
- **Inline audio iOS**: this watching brief is now PARTIALLY closed.
  `inlineAudio.native.tsx:29-95` ships a real iOS implementation
  (fetch → decodeAudioData → AudioBufferSource, ~200ms latency per
  Decision 3). The macOS branch still throws the M22 string. So
  Conversations playback works on iOS today; M22 picks up macOS, not
  iOS. The implementer's brief description in the report
  (`InlineAudioPlayer.native.tsx` deleted in step 6 → replaced by
  `platform/inlineAudio.native.tsx`) is accurate; the file moved,
  iOS impl shipped. Watching list: scratch iOS, keep macOS.
- **Tone gap**: six milestones in now, no marketing copy in app
  chrome. Still latent — M23 (full iOS shell) is the natural place.
- **Settings UI for `setApiBase`**: deferred to M23 per architect's
  Decision 7. Today: `__dev__.setApiBase()` from Metro console.
  Tom's manual step 2b documents it. Acceptable for M21, blocks
  any non-Tom from running the iOS build.

## Findings, by severity

### Voice-first regressions

**FINDING-1 (high) — Permission denial surfaces as a stack-trace blob,
not as guidance.** Decision 13 risk 2 spelled out the acceptance:
"TalkButton renders: 'Microphone access denied. Settings → voix →
Microphone.' Acceptance includes that string visible after a deny."

What actually ships:

- `permissions.native.ts:33-43` returns `{ ok: false, reason: "denied" }`
  on iOS deny. ✓ the typed result the brief specified.
- `client.ts:107-114` consumes it as:
  ```ts
  this.opts.onEvent({
    type: "error",
    message: `microphone permission ${perm.reason}${perm.detail ? `: ${perm.detail}` : ""}`,
  });
  ```
  → emits the string **"microphone permission denied"**.
- `TalkButton.tsx:113` renders it in `styles.error` — red, monospace,
  in `dangerBg`. Reads like a console error, not like product copy.

Three things the brief required and the code doesn't deliver:

1. The string itself: "microphone permission denied" not "Microphone
   access denied. Settings → voix → Microphone."
2. The recovery path: no in-UI hint about where to go in Settings. A
   first-time user denies, then has no idea what to do next.
3. The retry: no "Try again" button after the user fixes it in
   Settings. iOS won't re-prompt; the user has to know to fully kill
   the app or press the button again. Today's TalkButton resets to
   "Talk to voix" on next tap, which is OK — but until the user
   toggles in Settings, every subsequent tap shows the same red blob.

This is a voice-first regression because the *failure mode reads like
a bug, not like a product*. A user who taps deny by accident — entirely
plausible on first launch — sees red console-style text and assumes
voix is broken. The brief's wording would have read like a product
nudge.

Fix surface area: ~15 LOC. `client.ts` needs to pass `perm.reason`
through structurally (already does in `event.message`); TalkButton
needs to detect `reason === "denied"` and render a copy block instead
of the error pill — "Microphone is off for voix. Open Settings → voix
→ Microphone, then tap Try again." with an actual `<Pressable>` Try
again button that re-runs `handlePressIn`.

Also: subtle issue with the current logic — `permissions.native.ts:36-39`
treats "Undetermined" as `unknown`, not `denied`. iOS returns
"Undetermined" when the user dismisses the prompt by tapping outside
(rare on modern iOS, possible via accessibility). The message ends up
"microphone permission unknown: Undetermined" — even more jargony.
Worth folding into the deny branch with a different copy ("Microphone
prompt was dismissed — tap to try again.").

### UX drift

**FINDING-2 (medium) — macOS deferral string leaks "M22" to the user.**

Both `audioCapture.native.ts:137` and `audioPlayback.native.ts:72-73`
throw with:
```
"audio capture: macOS audio lands in M22 (alongside global hotkey + paste)"
"audio playback: macOS audio lands in M22 (alongside global hotkey + paste)"
```

And `inlineAudio.native.tsx:98` renders:
```
"Playback: macOS audio lands in M22"
```

These are technically the friendly-strings the brief required (NOT
crashes), but the strings themselves expose internal roadmap
vocabulary. "M22" is meaningless to a user — it's the team's own
milestone shorthand. Also "alongside global hotkey + paste" describes
*our internal scope*, not *the user's experience*.

Furthermore, the macOS TalkButton path doesn't even reach a thrown
string surfaced as product copy — the throw in `audioCapture.native.ts`
propagates up through `client.ts:130-134` and gets re-emitted as the
same red error pill as the iOS permission deny path. So on macOS, the
user sees "audio capture: macOS audio lands in M22 (alongside global
hotkey + paste)" in red monospace below the button. That's actively
embarrassing to ship.

Suggested copy:
- macOS TalkButton: "voix's microphone on macOS is coming soon. For
  now, use voix on your iPhone or in the browser."
- macOS InlineAudioPlayer: "Playback on macOS is coming soon."
- Code path: detect `Platform.OS === "macos"` *in TalkButton itself*
  and render a non-pressable hint card, not a Pressable that throws on
  press. Make the macOS shape distinct from the "something errored"
  shape.

Fix surface area: ~20 LOC (TalkButton platform branch + three string
edits). Could land in M21 close-out or roll into M22 — but the macOS
path being a red error pill is a worse first impression than a missing
button would be.

**FINDING-3 (low) — Permission iOS Info.plist string is good; macOS
Info.plist string is the same.** `clients/app/ios/voix/Info.plist:37`:
"voix listens when you talk to it." — voice-first, lowercase voix,
on-brand. ✓ `clients/app/macos/voix-macOS/Info.plist:41`: same string.
Per Decision 4 the macOS string is reserved for M22's prompt; reusing
the iOS line is fine. Not a finding, just confirmation.

### Watching briefs

- **Tone gap (six milestones now)**: still open. M23 will need a copy
  pass on settings screens, empty states, error messages. The fact
  that we're shipping "microphone permission denied" as user-visible
  text is the same gap re-surfacing in a new venue.
- **Inline audio iOS**: closed by M21 (real impl ships).
- **Inline audio macOS**: still open, M22.
- **Settings screen for `setApiBase`**: still open, M23.
- **TalkButton on macOS path looks like an error**: NEW — see FINDING-2.

## Task 3 — Permission denial UX (focused)

See FINDING-1 above. Short version:
- ✗ String is technical ("microphone permission denied"), not
  product ("Microphone is off for voix").
- ✗ No "Settings → voix → Microphone" guidance string.
- ✗ No "Try again" affordance.
- ✗ "Undetermined" state surfaces as "unknown: Undetermined" — worse
  copy than the deny path.
- ✓ Doesn't use lower-level jargon like "AVAudioSession" — small
  mercy; only the `unknown` `detail` field surfaces system strings.
- ✓ The structural plumbing is right — `PermissionResult.reason` is
  typed, and TalkButton has the data to render better copy. It just
  doesn't.

This is the single most important M21 finding because permission
denial is the FIRST recoverable failure a first-time user can hit. If
it reads as a bug they assume the app is broken; if it reads as a
nudge they fix the system setting and continue.

## Task 4 — macOS-defer messaging (focused)

See FINDING-2 above. Short version:
- ✗ "M22" is internal vocabulary the user shouldn't see.
- ✗ "(alongside global hotkey + paste)" is internal scope, not
  user-meaningful.
- ✗ The macOS TalkButton renders the throw as a red error pill — the
  shape of "error" not the shape of "not ready yet".
- ✓ Does NOT shame the user.
- ✓ Does NOT crash — Decision 9's "Should ship" criterion is mechanically met.

Suggested better wording (recap):
- "voix's microphone on macOS is coming soon. For now, use voix on
  your iPhone or in the browser." (TalkButton)
- "Playback on macOS is coming soon." (InlineAudioPlayer)

## Task 5 — Time-to-first-utterance estimate

Cold-launch to "mic is hot" sequence (read from `client.ts:99-129`):

1. User taps TalkButton → `handlePressIn` fires (sync).
2. `setStatus("connecting")` → pill shows "Connecting…". (~0 ms)
3. `await appInfo.getApiBase()` → AsyncStorage cache hit after first
   read (steady state), one I/O hop on first ever tap. (~5-20 ms)
4. `await fetch(base + WS_TOKEN_PATH)` → daemon round trip on LAN.
   (~10-30 ms)
5. `new BrowserAudioIoClient(...).start()` → `permissions.requestMicrophone()`:
   - **First time**: blocks on user accepting iOS modal. **Open-ended.**
   - Subsequent: returns from cache, sub-ms.
6. `playback.start()` → new AudioContext, very fast. (~5-50 ms)
7. `capture.start()` → AVAudioSession setActive(true), AudioRecorder
   start. (~50-150 ms, audio-api hardware path)
8. `openWs()` → new WebSocket(url). (~30-80 ms on LAN)
9. WS `open` → `sendHello()` (one more device-id storage read).
10. Daemon sends `ready` → `setStatus("listening")` → mic is hot.

**Steady-state estimate** (after first launch): ~150-400 ms tap-release
to "mic is hot." Within "tap and start talking" feel.

**Cold launch estimate** (sim boot to "mic is hot" first tap): app
launch 2-4s + first-tap path ~250-450 ms + permission modal (open).
The target ≤ 3s from sim-boot to mic-hot is ACHIEVABLE post-permission
but the modal dominates the first run.

**Should the WS prewarm?** Today, no — and I'd argue NOT prewarming
is right for voix:
- Prewarm adds a persistent daemon connection on every app open,
  burning battery and the daemon's resources for sessions that may
  never start.
- The latency it would save (~50-100 ms of WS handshake on first tap)
  isn't perceptible against the permission modal on first launch.
- For 2nd+ taps in same app session, the current path is already
  sub-300 ms — feels instant.

What WOULD help: **moving the permission request to "first app
launch" rather than "first TalkButton press."** Today the user only
discovers they need to grant permission when they're already trying
to talk. Prompting on cold launch (a la "voix needs your microphone
to hear you when you talk back" with a single "Allow" button) lets
the first real PTT be friction-free. That's M23 work (the iOS shell
proper) but worth flagging now.

## Task 6 — The "voice should land" test

User opens app for first time, taps TalkButton, says "make me a
shopping list," and: how long from finger-release to text on screen?

Critical observation: **today's TalkButton is hold-to-talk, not
tap-to-talk.** The user *can't* tap-release at the start of "make me
a shopping list" — they have to HOLD throughout the utterance, then
release at the end. So the timeline is:

1. Finger down → "Connecting…" (~0 ms).
2. **Cold-path one-time first run**: permission modal (open-ended).
3. WS open + hello + ready → "Listening" (~150-400 ms steady).
4. User says "make me a shopping list" (~2.5 s of speech).
5. Finger up → `handlePressOut` → `client.stop()` → WS close
   immediate.
6. **WAIT.** What text? The dictate pipeline is `intent: "dictate"`
   but TalkButton in M21 sends `intent: "discuss"` (TalkButton.tsx:57).
   So this is a *discuss* round-trip: STT → LLM → TTS, with
   conversation history written to the file-store. No text appears
   on screen directly — it lands in Conversations as the next
   session entry.

So "text on screen" interpretation:
- Conversations tab: the new entry appears within ~1-3 s of finger
  release (daemon writes the transcript file on session close;
  conversations list polls or refreshes when user navigates back).
  But the user has to navigate back to Conversations to see it.
- Live transcript during the session: NOT shown. M21 ships no
  in-session transcript UI on iOS.
- TTS audio reply: starts ~500ms-2s after the LLM begins responding,
  audible immediately.

For a "make me a shopping list" use case the user probably WANTED a
text deliverable, not a voice reply. That's the dictate intent, not
discuss. Today's iOS TalkButton has no way to choose between them
— it hardcodes `discuss` (TalkButton.tsx:57).

**Implication for "the voice should land":** voix on iOS today
*talks back to you*. It does not *type for you*. That's an
intentional M21 scope (Conversations + voice reply), but a first-time
user with a "list these things for me" use case will be confused
about where their text went. The intent dial is the missing surface
— probably M23/M24 work (keyboard extension is where dictate makes
most sense), but worth being explicit that iOS in M21 is
discuss-only.

## The one thing the brief should have anticipated but didn't

**That every error path on iOS in M21 looks like the same red console
blob.**

The brief's Decision 13 caught the permission-denial UX explicitly
(risk 2). But the macOS deferral path, the network failure path
("WebSocket error"), the daemon decline path, and the iOS audio-api
failure path ALL end up at the same `client.ts:131-134` catch that
emits `{ type: "error", message: <raw string> }`. TalkButton then
renders ALL of them as the same red `error` style at line 113. So:

- iOS deny → "microphone permission denied" in red
- iOS dismiss → "microphone permission unknown: Undetermined" in red
- macOS TalkButton press → "audio capture: macOS audio lands in M22
  (alongside global hotkey + paste)" in red
- WS network failure → "WebSocket error" in red
- Daemon decline → "declined: <reason>" in red
- Daemon mid-session disconnect → no error, just silent stop

Five different failure modes, one undifferentiated red blob. The
brief asked for ONE of them to be treated as a product surface
(permission denial). The deeper insight, only visible when looking at
all of them together, is that **the M21 audit should have asked
"every failure mode reads as product, not error" as a category**.

This is the voice-first regression hiding in plain sight — voix's
"first encounter as a real voice product" treats every recoverable
failure as a compiler error message. Designers know this pattern
well (Apple's HIG calls it out explicitly: "Errors should help users
recover, not blame them"). The shape of the fix is a small TalkButton
sub-component — `<RecoveryState />` — that switches on
`error.kind` (deny / permission-other / network / decline / macos-deferred /
unknown) and renders a tailored copy block with optional action button
for each. The structural data is mostly there; the rendering layer
isn't.

If M22 ships macOS audio and M23 ships the iOS shell, both of those
will benefit from this RecoveryState shape — they'll hit the same
failure surface and need the same treatment. Cheap to refactor now
when there's one consumer; expensive after three.

---

## Verdict

M21 mechanically lands the platform abstraction cleanly. The brand
layer survives the shim layer without drift. TalkButton's M18
inverted-pill speaking state is preserved. The architectural goal of
this milestone — "one file per primitive, three impls per file, web
unchanged, iOS audio real, macOS deferred" — is delivered.

What does NOT land is the *product-shaped error surface* that
Decision 13 risk 2 specified. The denial UX is structurally typed but
rendered as a console error. The macOS-deferred path leaks roadmap
vocabulary. Both are <40 LOC fixes and they're the difference between
voix-on-iPhone feeling like a real product on first launch versus
feeling like a debug build that escaped containment.

Recommend: land FINDING-1 and FINDING-2 fixes as M21.1 before
declaring M21 closed, OR queue them explicitly as M22's first work
item with a note in STATE so they don't slip past the M22 macOS push.
