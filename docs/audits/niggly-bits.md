# Niggly bits — adversarial audit

**Date:** 2026-05-30
**Scope:** `voix-backend/src/`, `voix-backend/ui/src/`, `ha-integration/`, `esphome/`
**Premise:** ~36 hours of fast shipping, often without homelab verification. Hostile read.

Severity legend:
- **bug** — broken now, will bite a real user on the next session.
- **latent** — correct-looking today; bites under a condition that *will* occur (cost, config, scale).
- **future risk** — fine now, fragile to drift (HA upgrade, v2 client, disk).
- **cleanup** — debt / hygiene; won't crash but should not have shipped.

---

## Ranked summary

| # | Sev | One-liner | Location |
|---|-----|-----------|----------|
| B1 | **bug** | Browser (M18) plays assistant audio at ~2× speed / chipmunk — speaker never resampled to the endpoint's declared rate | `connection.ts:279`, `browserClient.ts:260`, contract `types.ts:49` |
| B2 | **bug** | One barge-in permanently mutes the assistant for the rest of a discuss session | `discuss_traditional.ts:247,387` |
| B3 | **bug** | Orchestrator ternary returns `"deepgram"` on both branches → wrong STT silently forced; unhandled crash if no Deepgram key | `orchestrator.ts:187` |
| B4 | **bug** | Malformed v1 hello (`capabilities` missing `mic`) throws an unhandled rejection; WS hangs with no decline | `connection.ts:190,206` |
| L1 | latent | `TraditionalDiscussPipeline` history grows unbounded → token bill scales with turn count | `discuss_traditional.ts:117,354,419` |
| L2 | latent | Realtime `bargeIn()` is a documented no-op; puck/realtime barge-in does nothing | `realtime.ts:241` |
| L3 | latent | Realtime context block / snapshot never size-bounded → long sessions can blow the prompt budget | `realtime.ts:111,272,407` |
| L4 | latent | `AudioContext.close()` not awaited; rapid stop→start races a half-closed context | `browserClient.ts:149` |
| F1 | future | `_RemappedCall` duck-types `ServiceCall` with zero test coverage — silent break on HA drift | `ha-integration/__init__.py:501` |
| F2 | future | Recordings dir grows unbounded — still no pruning after 36h | `recordings/store.ts:24` |
| F3 | future | Protocol version is decline-only, no negotiation; a v2 client is simply refused | `connection.ts:180` |
| C1 | cleanup | **All 50 commits on `main` are unsigned** despite `commit.gpgsign=true` — signing bypassed | git history |
| C2 | cleanup | `esphome/secrets.yaml.bak` is **not gitignored** (secret-leak risk) + 4 tracked `*.bak` test files | tree |
| C3 | cleanup | Pile of deferred items the next session will trip over | docs |

---

## Bugs (broken now)

### B1 — Browser assistant audio plays at ~2× speed (M18 shipped unverified) — **bug, high**

**Files:** `voix-backend/src/audio_io/connection.ts:279`, `voix-backend/src/pipeline/types.ts:49-51`, `voix-backend/ui/src/audio_io/browserClient.ts:260-277`

The `PipelineCallbacks.sendSpeaker` contract is explicit (`types.ts:49`):

> *"Send a binary speaker frame. PCM16 LE, mono, at the pipeline's [native] rate. **The connection resamples to the endpoint's declared `speaker.sample_rate_hz`.**"*

That resample **does not exist.** `connection.ts:279 sendBinaryToEndpoint()` forwards the buffer raw:

```ts
private sendBinaryToEndpoint(pcm: Buffer): void {
  if (this.closed) return;
  this.ws.sendBinary(pcm);   // no resample — declared speaker rate is never read
}
```

Both pipelines always emit **24 kHz** PCM (`realtime.ts:352` ships OpenAI's 24 kHz delta; `discuss_traditional.ts:49` opens Aura at `TTS_SPEAKER_RATE_HZ = 24000`). The endpoint's declared `speaker.sample_rate_hz` is logged (`connection.ts:207`) and then ignored — it is never threaded into `PipelineStart` (only `micSampleRateHz` is, `connection.ts:235`).

- **Puck:** declares `speaker = 24000` (`LEGACY_PUCK_DEFAULT_CAPS`, `connection.ts:64`) → coincidentally matches → works. This is why nobody caught it.
- **Browser (M18):** declares `speaker.sample_rate_hz = audioContext.sampleRate` (`browserClient.ts:187`), which is the device-native rate — **typically 48 kHz**. It then receives 24 kHz audio and plays it back tagged at the context rate (`browserClient.ts:262`):

```ts
const buf = this.audioContext.createBuffer(1, pcm.length, this.audioContext.sampleRate); // 48000
```

24 kHz samples played as 48 kHz → **half duration, octave-up, chipmunk.** M18 ("browser press-to-talk") was shipped without homelab verification per the task brief; this is the headline casualty.

**Fix (pick one):**
- **Proper:** implement the documented contract — pass `capabilities.speaker.sample_rate_hz` into `PipelineStart`, resample the speaker stream in `connection.ts` (or the pipeline) before `sendBinary`, mirroring the mic-side `resampleChunk`.
- **Cheap (browser-local):** in `playSpeaker`, hardcode the daemon's 24 kHz when building the buffer: `createBuffer(1, pcm.length, 24000)` and declare `speaker.sample_rate_hz: 24000` in the hello. Less correct long-term but unbreaks M18 in one line.

---

### B2 — A single barge-in permanently mutes the assistant for the rest of a discuss session — **bug, high**

**File:** `voix-backend/src/pipeline/discuss_traditional.ts:244-248, 387-391`

`bargeIn()` closes **and nulls** the TTS session:

```ts
if (this.state === "assistant_speaking" && this.tts) {
  this.tts.close();
  this.tts = null;          // ← never reopened anywhere
  this.cb.sendEvent({ type: "audio_end" });
}
```

`this.tts` is only ever assigned in `start()`. The next turn reaches `runAssistantTurn()`:

```ts
if (!this.tts) {
  log.warn(`discuss ${this.deviceId}: TTS gone, dropping assistant audio`);
  this.state = "waiting_for_user";
  return;                   // ← every subsequent assistant turn is silently dropped
}
```

So after the **first** time a user interrupts the assistant, the rest of the conversation runs STT → LLM (still billing tokens) but **emits no audio at all** — the user is talking to a model that has gone mute. There is no re-open path in `bargeIn`, `runAssistantTurn`, `finalizeSession`, or `close`.

**Fix:** don't destroy the session on barge-in. Either (a) keep `this.tts` and call a `cancel()`/`flush`-drop on the provider to stop the current utterance, or (b) lazily re-open TTS at the top of `runAssistantTurn` when `this.tts === null && !this.closed`. (a) is preferable — re-opening a WS per interruption adds latency.

---

### B3 — Orchestrator ternary returns `"deepgram"` on both branches — **bug, med-high**

**File:** `voix-backend/src/pipeline/orchestrator.ts:187`

```ts
const sttName = voice.sttProvider === "deepgram" ? "deepgram" : "deepgram";
```

Both arms are identical. Effects:

1. A voice configured `discussEngine = "traditional"` with **any** `sttProvider` other than `deepgram` is **silently** forced onto Deepgram. No warning, no fallback — the user's configured choice is discarded.
2. `defaultProviders().stt` (`orchestrator.ts:56-64`) only knows `"deepgram"` and **throws** if `DEEPGRAM_API_KEY` is missing. The throw propagates: `pick()` rejects → `OrchestratedPipeline.start()` rejects → awaited at `connection.ts:240` inside `handleHello` → awaited at `route.ts:89` inside the async `message` handler with **no try/catch**. Result: an unhandled rejection, and the endpoint sits with no `ready` and no `decline` — it hangs until it times out client-side. (The daemon survives only because of the "stop killing the daemon on isolated promise rejection" guard from git history.)

This is latent today *only because* Deepgram is the sole traditional STT — but the dead ternary is a trap primed to fire the moment a second STT provider lands or a user sets `sttProvider` expecting it to matter.

**Fix:** make the branch real and fail loud:
```ts
const sttName = voice.sttProvider || "deepgram";
```
and wrap `pipeline.start()` in `connection.handleHello` so a provider-construction failure sends a `decline("internal", …)` + closes the WS instead of dangling.

---

### B4 — Malformed v1 hello crashes the hello handler with no decline — **bug, med**

**File:** `voix-backend/src/audio_io/connection.ts:190-191, 206`

`capabilities` is an unchecked cast:

```ts
const capabilities: Capabilities = isV1
  ? (r["capabilities"] as Capabilities)   // ← no shape validation
  : LEGACY_PUCK_DEFAULT_CAPS;
```

`isV1` is true whenever `protocol_version` is *any* number. A v1 hello with `protocol_version: 1` but a missing/empty `capabilities` (or `capabilities` without `mic`) reaches `connection.ts:206`:

```ts
`mic=${capabilities.mic.sample_rate_hz}/${capabilities.mic.channels} `   // TypeError: cannot read 'sample_rate_hz' of undefined
```

The `TypeError` throws out of `handleHello` → `handleText` → the un-guarded `await conn.handleText(parsed)` at `route.ts:89`. The WS gets neither `ready` nor `decline`; it hangs. A buggy or hostile client can wedge a connection (and spam unhandled rejections) trivially.

**Fix:** validate `capabilities` after the cast — require `capabilities?.mic?.sample_rate_hz` to be a positive number, else `sendDecline("internal", "bad capabilities")` + close. Same defensive treatment as the token/device_id/intent checks already above it.

---

## Latent (will bite under a condition that will occur)

### L1 — Discuss conversation history is unbounded → token bill scales with turn count — **latent, med**

**File:** `voix-backend/src/pipeline/discuss_traditional.ts:117, 342, 354, 419-421`

`this.history` accumulates every user + assistant turn for the whole session and is sent **in full** on every LLM call:

```ts
messages: [...this.history],   // line 354 — grows every turn
```

A 20-turn conversation pays ~20× the prompt tokens of turn 1; the cost is quadratic in turns across the session. `finalizeSession` then re-sends the *entire* transcript again to the done-phase LLM (`:419-431`). With a 300 s hard ceiling (`DISCUSS_HARD_MAX_S`) a chatty user can rack up a real bill. No truncation, no rolling window, no summarisation.

**Fix:** cap the history fed to the talking-phase LLM — e.g. last N turns or a token-budget trim — and/or summarise older turns. At minimum log a warning past some turn count so the cost is visible.

### L2 — Realtime `bargeIn()` is a no-op — **latent, med**

**File:** `voix-backend/src/pipeline/realtime.ts:241-248`

```ts
bargeIn(): void {
  ...
  log.debug(`pipeline ${this.deviceId}: barge_in (no-op pending realtime cancel)`);
}
```

`OpenAIRealtimeClient` exposes no `response.cancel`, so a `barge_in` frame on the realtime/puck path does nothing — the model keeps talking over the user. The wire path is live (`connection.ts:107 → pipeline.bargeIn()`), so the only thing missing is the implementation. Currently no UI sends `barge_in` (grep of `ui/src` finds none; `TalkButton` only `start()/stop()`), so it's latent — but it's advertised in the v1 audio-io spec and the puck firmware is expected to emit it.

**Fix:** add `response.cancel` + `output_audio_buffer.clear` to `OpenAIRealtimeClient` and call it from `bargeIn()`. Until then, change the doc comment from "wire it through here when it does" to a tracked TODO so it isn't mistaken for done.

### L3 — Realtime context block never size-bounded — **latent, low-med**

**File:** `voix-backend/src/pipeline/realtime.ts:111, 168, 272-279, 407`

`contextSnapshot` is gathered once and rendered verbatim into both the session instructions (`composeRealtimeInstructions`) and the dictation post-process prompt (`handleUserTranscriptComplete:407`). `renderContextBlock` does no truncation — a large HA/voix context (many entities, long attribute values) flows straight into the prompt. For a long-running session or a verbose context source this can push past model limits or just inflate cost. Same unbounded-`Object.entries` render in `discuss_traditional.ts:53`.

**Fix:** bound `renderContextBlock` output (cap per-source lines / total chars) and log when it truncates.

### L4 — `AudioContext.close()` not awaited; stop→start race — **latent, low**

**File:** `voix-backend/ui/src/audio_io/browserClient.ts:149`

```ts
void this.audioContext?.close();   // fire-and-forget
this.audioContext = null;
this.setStatus("idle");            // ← status flips to idle immediately
```

`stop()` flips status to `idle` synchronously while the old context is still closing. Because `start()` only guards on `status === "idle"`, a quick stop→start (double-tap of the Talk button) can call `new AudioContext()` while the previous one is mid-close, leaking contexts (browsers cap concurrent AudioContexts ~6, after which `new AudioContext()` throws). Also note `start()`'s catch calls `stop()`, and the WS `error` handler (`:171`) does **not** call `stop()` — it relies on a `close` event following, which is usual but not guaranteed.

**Fix:** make `stop()` await the close (or gate `start()` on a separate "tearing down" flag), and have the WS `error` handler tear down explicitly.

---

## Future risk (fragile to drift)

### F1 — `_RemappedCall` duck-types `ServiceCall`, untested — **future risk, med**

**File:** `ha-integration/custom_components/voix/__init__.py:497-527`

```ts
class _RemappedCall:
    def __init__(self, data: dict) -> None:
        self.data = data
```

The voice-vocabulary services (`update_voice`/`delete_voice`/`set_voice`) wrap their `ServiceCall` in this stand-in and pass it to the `_update_mode`/`_delete_mode`/`_set` handlers. It works **only because** those handlers happen to read nothing but `call.data` today. If any handler ever touches `call.context`, `call.hass`, `call.return_response`, `call.service`, etc. (all real `ServiceCall` attributes), it `AttributeError`s at runtime. `tests/integration/test_services.py` exercises the mode services but **never** the voice aliases or `_RemappedCall` (grep finds no `update_voice`/`set_voice`/`list_voices`/`RemappedCall`). The comment even admits the `ServiceCall` constructor "has drifted across HA versions" — i.e. this is a known-moving target with no guard.

**Fix:** add a `test_services.py` case that calls each `voix.*_voice` service end-to-end and asserts the translation. Cheaper still: use `dataclasses.replace` on a real `ServiceCall` or a typed `SimpleNamespace` with the full attribute set the HA version expects.

### F2 — Recordings directory grows unbounded — **future risk, med**

**File:** `voix-backend/src/recordings/store.ts:24-28`

> *"NOT included: pruning. Disk grows unbounded for now."*

Every session writes `mic.wav` + `speaker.wav` + `meta.json` (~2.4 MB / 30 s) and nothing reaps them. 36 hours in, still no "keep latest N" job. On the HA Yellow / HAOS this is a finite disk that other components share — silent fill is a when-not-if.

**Fix:** add the promised "keep latest N sessions" reaper (count- or age-based) at daemon boot, and log total recordings size periodically so it's visible before it's a problem.

### F3 — Protocol version is decline-only, no negotiation — **future risk, low**

**File:** `voix-backend/src/audio_io/connection.ts:180-188`

```ts
if (isV1 && r["protocol_version"] !== PROTOCOL_VERSION) {
  this.sendDecline("unsupported_protocol_version", …);
  this.ws.close(...);
}
```

A future v2 client (different `capabilities` shape, value `2`) is simply refused — fine as a safety valve, but there's no min/max-supported range, so every protocol bump is a hard flag-day between daemon and every endpoint. Acceptable for a single-household deployment; note it before the puck and browser version-skew.

---

## Cleanup / shipping debt

### C1 — Every commit on `main` is unsigned despite signing being configured — **cleanup**

Git is configured to sign (`commit.gpgsign=true`, `gpg.format=ssh`, `user.signingkey=ssh-ed25519 …`), yet **all 50** of the most recent `main` commits report `%G?` = `N` (no signature). This is the signed-commit bypass the brief flagged — commits were made with `-c commit.gpgsign=false` / `--no-gpg-sign`. It is **not** limited to M16/M17/M18; it's the entire visible history. Separately, `git log --show-signature` errors with `gpg.ssh.allowedSignersFile needs to be configured` — so even the commits that *were* signed couldn't be verified. If signed history matters to the user, both the bypass and the missing `allowedSignersFile` need fixing; if it doesn't, set `commit.gpgsign=false` so the config stops lying.

### C2 — `secrets.yaml.bak` not gitignored + tracked `*.bak` test files — **cleanup (one is a secret-leak risk)**

- `esphome/secrets.yaml.bak` is **untracked and NOT ignored** (`git check-ignore` returns non-zero). `.gitignore:40,48` cover `secrets.yaml` and `esphome/secrets.yaml` but not the `.bak` suffix. A `git add -A` would commit a backup of the device WiFi/API secrets. **Add `*.bak` (or `secrets.yaml*`) to `.gitignore` and delete the file.**
- Four `*.bak` files are **already committed**: `tests/conftest.py.bak`, `tests/integration/test_config_flow.py.bak`, `tests/integration/test_select.py.bak`, `tests/unit/test_modes.py.bak`. Editor backup cruft in version control — `git rm` them.

### C3 — Deferred items the next session will trip over — **cleanup**

Collected from `docs/` (grep `deferred|placeholder|not wired|unbounded`):

- **HA bridge trim** — `docs/architecture.md:199`: *"✗ deferred — Still has all old bridge code as dead weight (~3000 LOC)."* Largest single deferral.
- **Recordings pruning** — `recordings/store.ts:24` (see F2).
- **M04 #8 tone snippet** — deferred at M04, *still* deferred through M13b/M15/M16 (`docs/agents/m13b-wren.md:34`, `m16-wren.md:23`, `m15-marina.md:17`). Three milestones of carry-over.
- **M04 #14 (SF Symbols / icon set)** and **#16** — still deferred (`m15-marina.md:17`).
- **M18 pulse animation** — speaking indicator pulse deferred to a later pass (`m18-marina.md:25`).
- **Realtime barge-in (`response.cancel`)** — deferred in code (see L2).
- **Placeholder screens** — Conversation history UI + Devices/settings UI marked placeholder (`docs/STATE.md:322-323`); kind glyphs for non-puck surfaces are placeholders (`STATE.md:175`).
- **Auto-paste / global hotkey** — deferred to post-v1, needs Accessibility perms (`docs/adr/0004-…:28`).
- **Button press semantics** (tap vs hold) — deferred to Phase 3 (`docs/adr/0003-…:19`).
- **`setup-realtime.md`** — entire page is a placeholder ("Phase 3 — not yet implemented").

### C4 — `recorder.finalize()` fire-and-forget — **cleanup, informational**

`realtime.ts:259` and `discuss_traditional.ts:263` call `this.recorder.finalize().catch(...)` without awaiting, so `close()` returns before the WAVs hit disk. `finalize()` has a `try/finally` (`recordings/store.ts:90-125`) so it *does* always resolve and frees buffers even on write error — the brief's "what if it never resolves?" is mostly mitigated. The residual risk is only that a `writeFile` hang on a full disk would silently never complete (no timeout), and the close path has already returned success. Low priority; note if disk-full becomes a real condition (see F2).

---

## What I could NOT verify (no homelab access)

- B1/B2 are read-confirmed but not reproduced on hardware. B1's exact pitch shift depends on the browser's actual `AudioContext.sampleRate` (44.1 vs 48 kHz) — either way it's wrong, just by a different ratio.
- The unhandled-rejection behaviour in B3/B4 depends on the daemon's global `unhandledRejection` handler (referenced in git history but not re-read here) — the endpoint-hang conclusion holds regardless of whether the process survives.
