# Test plan — PTT mid-session interruption (B14)

**Status:** manual / device-only. Tom-day item.
**Build under test:** M24 iOS app on a physical iPhone.
**Origin:** Sasha (M21 adversary) flagged the AVAudioSession interruption
path as the critical gap for the "phone call lands mid-PTT" case. M22
shipped the iOS-side observer
(`packages/ui/src/platform/audioCapture.native.ts:148`). This plan is the
manual verification of that observer's behaviour on real hardware.

---

## 1. What we're testing

`AVAudioSession` interruption handling **during an active voix push-to-talk
session**. When the OS yanks the audio session out from under voix — an
incoming/outgoing phone call, Siri, an alarm, or another app grabbing the
mic — the M22 observer must:

- detect the interruption (`"interruption"` system event, `type: "began"`),
- route it through `opts.onError` as a typed `kind: "audio"` error,
- tear the session down **cleanly** (no crash, partial transcript flushed),
- **not** auto-resume when the interruption ends — the user re-presses PTT.

The implementation under test:

- **iOS side** — `audioCapture.native.ts:148-172`. Subscribes to
  `AudioManager` `"interruption"` events. On `type === "began"` it calls
  `opts.onError(...)`. It deliberately ignores `"ended"` (no auto-restart;
  comment at `:168`).
- **UI side** — `packages/ui/src/conversations/TalkButton.tsx:147`. The
  `onError` surfaces as an `ev.type === "error"` event with `kind: "audio"`;
  `hadErrorRef` is set and the recovery surface renders. Because
  `hadErrorRef` is set, the "done / heard-nothing" terminal cue is
  suppressed (`TalkButton.tsx:140`) — the user sees the audio-error recovery
  copy, not a silent decay back to idle.
- **Daemon side** — `voix-backend/src/audio_io/connection.ts`. The client
  WS drop triggers the pipeline `close()`
  (`voix-backend/src/pipeline/realtime.ts:281`), which flushes the recorder
  (partial transcript) and logs `pipeline closed …`.

### State machine the UI shows on session end

`BrowserClientStatus` (`packages/ui/src/audio_io/client.ts:74`):
`idle → connecting → ready → listening ⇄ speaking → closing`.

On interruption the path is **not** a clean `→ idle`. The `kind:"audio"`
error short-circuits into the recovery state. The thing we are most
guarding against is a **stuck `connecting`** — "Connecting…" that never
resolves (the Wren v3 H1/F2 regression). Every test below has "never stuck
on Connecting…" as a hard pass criterion.

---

## 2. Pre-flight

1. **Physical iPhone** with the voix app installed from the **M24 build**
   (the simulator cannot exercise any of this — see §8).
2. **voix daemon reachable on the LAN** — same network as the phone, daemon
   answering on its WS port. Confirm the app reaches it by starting one
   normal PTT session and seeing a transcript before you begin.
3. **Daemon log tail open on the Mac:**

   ```bash
   tail -f /tmp/voix-daemon.log \
     | grep --line-buffered -E '(interruption|TEARDOWN|hello|session|pipeline (started|closed)|last_error)'
   ```

   > **Note on what the daemon actually prints.** "interruption" and
   > "TEARDOWN" are **iOS-side** concepts — the daemon never logs those
   > literal strings. What the daemon *does* print, and what proves the
   > session opened and closed cleanly, is the **`hello` → `pipeline
   > started` → `pipeline closed`** triple. The grep above keeps
   > `interruption|TEARDOWN` in the alternation only so the same one-liner
   > works if future builds add those markers; today they won't fire.
   > Daemon `pipeline started/closed` lines are `log.info` — make sure the
   > daemon's log level is at INFO or lower or they won't appear.

4. **A second phone** (or access to dial Tom's number), for Test 1.
5. Quiet room, charged phone, mic permission already granted to voix.

---

## 3. Test 1 — Phone call mid-PTT (the canonical case)

This is the case Sasha flagged. Run it first.

**Setup the call without committing it:**
1. Open the **Phone** app, type a number on the keypad (or 611 — your
   carrier's free test/info line — as the safe outgoing target). **Do not
   hit the green call button yet.**
2. Switch back to voix (don't kill Phone — leave it dialled).

**Run:**
3. In voix, press and hold to **start a PTT session**. Say a sentence or
   two so there's transcript content to flush.
4. **Trigger the interruption**, either:
   - have the second phone **call Tom's number** (incoming call), **or**
   - swipe back to Phone and **hit call on 611** (outgoing call).
5. Observe voix at the moment the call connects.

**Expected:**
- voix **pauses cleanly** — the session tears down the instant the call
  audio session activates. No frozen UI.
- If any speech was transcribed before the call, a **partial transcript**
  is written (recorder flush on `close()`).
- **No crash.** The app stays alive; backgrounded behind the call UI is
  fine.
- The talk button shows the **audio-error recovery surface**
  ("audio interrupted — the system took over the mic…"), **not** a stuck
  "Connecting…" and **not** a silent snap to idle.

**After the call ends:**
- voix **does NOT auto-resume.** The observer ignores the `"ended"` event
  by design (`audioCapture.native.ts:168`). The session stays ended; the
  user must explicitly **re-press** PTT to start a fresh session.

**Fail signatures:** app crash; spinner stuck on "Connecting…"; voix mic
silently keeps streaming under the call (you'd hear/echo call audio in a
later transcript); voix auto-restarts a session the user didn't ask for.

---

## 4. Test 2 — Siri activation mid-PTT

**Run:**
1. Press and hold PTT; start talking.
2. While still holding, **invoke Siri** (hold the side button, or "Hey
   Siri" if enabled).

**Expected:**
- The voix session **pauses** — same `type:"began"` interruption path as
  the phone call.
- **Siri's audio does not bleed into voix's mic stream.** When you later
  inspect the flushed transcript, it must not contain Siri's chime or
  Siri's spoken response.
- Recovery surface shown; no auto-resume after Siri dismisses.

**Fail signatures:** Siri's prompt or response text appears in the voix
transcript; both Siri and voix appear to listen simultaneously; stuck
"Connecting…".

---

## 5. Test 3 — Music app start mid-PTT

This one tests audio-focus *category* behaviour, and the expected result is
**conditional** on the AVAudioSession category voix activates.

**Run:**
1. Press and hold PTT; start talking.
2. From **Control Center**, start music playback (or hit play in Music).

**Expected — one of two acceptable outcomes:**
- **(a)** voix **yields audio focus cleanly** — treats the music start as
  an interruption, tears down via the same path, shows recovery. Acceptable.
- **(b)** voix **keeps the session** and the music is ducked/blocked — this
  is what `playAndRecord` + `.duckOthers` produces, where voix wins the mic
  and the music app is the one that yields. Also acceptable.

The **unacceptable** outcome is anything in between: voix's mic stays live
*and* music audio leaks into the transcript, or the UI half-tears-down into
a stuck state.

> Record which of (a)/(b) you observe — it tells us the effective
> AVAudioSession category at runtime, which informs whether the
> interruption observer or the category's own ducking is doing the work.

**Fail signatures:** music audio in the voix transcript while voix still
shows "listening"; stuck "Connecting…"; crash.

---

## 6. Test 4 — Background → foreground recovery

**Run:**
1. Press and hold PTT; start a session.
2. **Background voix** (swipe up / press home) while the session is open.
3. Wait **5 seconds.**
4. **Foreground voix** again.

**Expected — one of two clean outcomes:**
- The session **resumed live** and is still usable, **or**
- The UI shows a clean **"session ended"** terminal state (the "done" /
  "heard-nothing" cue from `TalkButton.tsx:140`, or the recovery surface).

The session must land in **exactly one** definite state. It must **never**
sit on a stuck **"Connecting…"** — that's the specific Wren v3 H1/F2
regression this test exists to catch.

**Fail signatures:** "Connecting…" that never resolves after foregrounding;
button unresponsive to the next press; crash on resume.

---

## 7. Expected daemon log shape per test

Tail running from §2. Across all four tests the daemon-side story is the
same shape — a session opens, then closes when the iOS client drops the WS.
The interruption itself is invisible to the daemon; what proves
clean teardown is the **paired open/close**.

**On session start (all tests):**

```
grep -E 'audio_io .*: hello v.* intent=(dictate|discuss)' /tmp/voix-daemon.log
grep -E 'pipeline started device=.* sess=' /tmp/voix-daemon.log
```

Expect one `hello v1 kind=… intent=… voice_id=…` line
(`connection.ts:232`, emitted at `log.warn` so it survives any log level)
immediately followed by `pipeline started device=… sess=…`.

**On interruption teardown (all tests):**

```
grep -E 'pipeline closed device=.* sess=.* duration=' /tmp/voix-daemon.log
```

Expect a `pipeline closed device=… sess=… duration=Xs` line within a second
or two of the interruption. **Pass** = a matched close line whose `sess=`
equals the `sess=` from the matching `pipeline started`. A clean
interruption close has **no** `last_error=` suffix; a `last_error=…` suffix
means the daemon saw the WS drop as an error rather than a clean close —
note it but it's not necessarily a failure (an abrupt iOS-side socket close
can read as a non-1000 code).

**Per-test grep cheat sheet:**

| Test | Open marker | Close marker | Red flag |
|------|-------------|--------------|----------|
| 1 phone call | `hello .* intent=` then `pipeline started` | `pipeline closed .* duration=` | a *second* `hello`/`pipeline started` with no user press = unwanted auto-resume |
| 2 Siri | same | same | session that never closes (`pipeline closed` missing) = mic still held |
| 3 music | same | `pipeline closed` **(outcome a)** or **no close at all (outcome b)** | mic open *and* late `mic_rms=` lines climbing = music leaking into mic |
| 4 bg→fg | same | `pipeline closed` OR a continuing live session | repeated connect attempts (multiple `pipeline started`, no `closed`) = stuck Connecting churn |

> The mic RMS line (`pipeline … mic_rms=…`, `realtime.ts:235`, every ~50
> chunks) is a useful liveness probe: after a clean interruption teardown it
> should **stop**. If `mic_rms=` keeps printing after the call/Siri/music
> started, voix is still streaming the mic when it shouldn't be — that's the
> echo/leak failure.

---

## 8. Known limitations

- **The simulator cannot test any of this.** It has no real microphone, and
  the iOS Simulator does not deliver real `AVAudioSession` interruptions —
  there is no phone-call, Siri, or hardware-route interruption source. The
  interruption observer's `"began"` event will simply never fire under the
  sim, so a green sim run proves nothing here. **All four tests are
  physical-device only.**
- **Carrier-dependent:** the 611 outgoing-call trick depends on the carrier
  offering a free info number. If unavailable, use a second phone for an
  incoming call instead.
- **Outcome (b) in Test 3 is category-dependent** and may change if the
  AVAudioSession category/options are retuned in a later milestone. Re-run
  Test 3 after any audio-session config change.
- **No automated assertion.** This is observational: the daemon log proves
  the session opened and closed, but "no crash" and "no audio leak in the
  transcript" require a human watching the device and reading the flushed
  transcript afterward.

---

## Cross-references

- iOS interruption observer: `packages/ui/src/platform/audioCapture.native.ts:148`
- UI error/recovery state: `packages/ui/src/conversations/TalkButton.tsx:147`
- UI status enum: `packages/ui/src/audio_io/client.ts:74`
- Daemon hello / capabilities log: `voix-backend/src/audio_io/connection.ts:232`
- Daemon pipeline start/close + transcript flush: `voix-backend/src/pipeline/realtime.ts:211,281`
- WS-close event the realtime session emits: `voix-backend/src/realtime/openai.ts:211`
  (self-initiated close is silent; an unexpected upstream close emits a
  `type:"error"` event — `openai.ts:215`)
