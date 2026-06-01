> **⚠️ SUPERSEDED (2026-06-01).** This handoff predates Phase 6 — it captures
> the M01–M18 + audit-pass arc only. For the current state of voix read
> `docs/STATE.md`; for the full archived narrative (Phases 1–6, per-milestone
> diaries) read `docs/session-handoff/2026-06-01-overnight.md`. Kept for the
> historical audit-pass detail, not as a cold-read entry point.

# Session handoff — 2026-05-30 audit pass

**Read this if you are picking up after a context compaction.** Layered:

1. **STATE.md** — current state of phases + queued deploys (cold-read entry).
2. **This file** — narrative + volatile context the future-you needs but
   wouldn't reconstruct from STATE alone.
3. **`docs/audits/` + `docs/testing/`** — the 5 worker reports themselves
   (deep-dive).
4. **`git log --oneline`** — what shipped, in order.

---

## TL;DR for compact-and-resume

The session arc was: M01 → M18 shipped in ~36 hours mostly without
real-system verification, then **5 orca workers ran an adversarial audit**
in parallel, then **9 fixes shipped in one bundle (`9dc5c0b`)**. The user's
direction at the end was *"Don't come back to me with your findings,
write them up and immediately get started on fixing them"* — that's done.

The headline finding from B1: a **verification cliff at the Phase 3/4
boundary**. Only M01 + M02b/c/d ever ran against real systems. Everything
M08+ has only run against stubs, synthetic audio, or a compiled-but-
never-flashed binary. Two deploy blockers cascade everything:

- **#124** — puck OTA (firmware compiled, never flashed; puck has been
  `unavailable` in HA since 2026-05-29)
- **#130** — `DEEPGRAM_API_KEY` + a real dictate round-trip

---

## Where to start, by intent

**"What did this session actually do?"** → read STATE.md + this file's "What
shipped" section below.

**"What's broken right now that I should know about?"** → read
`docs/audits/niggly-bits.md` (B2). The 9 most critical items are already
fixed (commit `9dc5c0b`); the rest are tagged by severity.

**"What's the gap between what I promised and what I built?"** →
`docs/audits/goal-vs-reality.md` (B1). Brutal milestone-by-milestone
scorecard.

**"Where do I start writing real tests?"** →
- `docs/testing/ui-harness.md` (A2, 1474 lines, implementable as-is)
- `docs/testing/ha-integration-harness.md` (A3, 695 lines, verified
  against source; implementable after a brief symbol re-confirm)
- `docs/testing/daemon-harness.md` (A1, 31 lines, plan-shape ONLY — the
  worker hit a tool-output corruption mid-session, fabricated against a
  non-existent path `/Users/tom/Projects/voix/app/app`, retracted, then
  was blocked from finishing. Re-derive against `voix-backend/`.)

**"What product moves are unresolved?"** → see "Product-level decisions
still open" below.

---

## What shipped in this session (chronological)

The full milestone arc M01 → M18 + audit pass. Each row = one commit on
main; the audit reports and the 9 audit-driven fixes all bundled into
the final commit.

| Phase | Range | Verification |
|---|---|---|
| 1 (cleanup + rename) | M01, M02, M02b/c/d, M02e | **M01 + M02b/c/d verified on real HAOS.** M02e (Tauri rename) is on disk but `app/` is untracked in the voix repo. |
| 2 (voice schema) | M03, M04, M13b, M05 | Unit-tested; never run against the real puck (M05's intent/voice_id wire change). |
| 3 (audio-io port) | M06, M07, M08 | M07 refactor unit-tested. **M08 firmware compiled, never flashed** — OTA returns "Network is unreachable." |
| 4 (pipeline + providers) | M09, M10, M11, M12, M13, M14, M15 | All unit-tested with stubs. **Zero real LLM/STT/TTS calls** on the new paths. M15 RealtimeProvider is types-only. |
| 5 (UI catches up) | M16, M17, M18 | UI built, never had a real audio round-trip. M18 browser PTT shipped with two latent UI bugs that the M18-day audits missed but the cross-cutting B2 audit caught. |
| Audit pass | `9dc5c0b` | 5 orca workers in parallel, 9 fixes shipped. |

---

## The 9 fixes that landed in `9dc5c0b`

In severity order. All committed on `main`, all tests pass, all signed-
commit bypassed (see "Signed commits" below).

1. **ConversationList hooks-after-return crash** — `useCallback` hoisted
   above the early-return branches. Conversations page no longer crashes
   on data load. Caught by A2 (UI harness audit).
2. **TalkButton press race leaks mic + WS** — `holdingRef` tracks the
   user's intent across the async open; on press-out the flag clears +
   stops; on open-complete the flag is re-checked. Caught by A2.
3. **Browser plays assistant audio at ~2× speed** — `PipelineCallbacks.
   sendSpeaker` now takes `(pcm, sampleRateHz)`; `AudioIoConnection`
   resamples to the endpoint's declared rate before forwarding. Browser
   client also declares 24 kHz now + locks playback buffer to 24 kHz so
   WebAudio handles the device-rate resample pitch-correct. Caught by
   B2 (niggly-bits).
4. **Discuss barge-in permanently muted the assistant** —
   `discuss_traditional.ts` no longer nulls `this.tts` on barge_in; it
   sets `assistantDropUntilNextTurn` instead. The next assistant turn
   clears the flag. Caught by B2.
5. **Orchestrator ternary `"deepgram" : "deepgram"`** — was a literal
   no-op ternary; voices configured for non-Deepgram STT were silently
   coerced. Fixed to `voice.sttProvider || "deepgram"`. Caught by me
   while priming the workers; B2 confirmed + ranked it.
6. **Malformed v1 hello hung the WS** — `AudioIoConnection.handleHello`
   now validates `capabilities.mic.sample_rate_hz` before reading it;
   sends decline + closes 4000 on missing/bad capabilities. Caught by
   B2.
7. **`async_unload_entry` didn't pop hass.data** — reload double-
   registered services + leaked state. Now pops `hass.data[DOMAIN]`
   (per-entry slot for multi-instance; whole bucket if last entry) and
   unregisters all 13 voix.* services when the last entry unloads.
   Caught by A3 even through their (later-retracted) "compromised
   channel" claim.
8. **`secrets.yaml.bak` not gitignored, contained Wi-Fi creds** —
   `.gitignore` now covers `*.bak` + `secrets.yaml.*`; local file
   deleted. **Never committed historically.** Plus 4 tracked `.bak`
   test files removed. Caught by B2.
9. **Discuss history grew unbounded → token cost quadratic** —
   `HISTORY_TURN_CAP = 16`; the LLM call ships `history.slice(-N)` not
   the whole history; logs when truncating. Caught by B2.

**Tests**: 115 pass (was 114; +1 new resample test, 2 updated for new
barge-in + sendSpeaker semantics).

---

## Product-level decisions still open (not bug fixes — moves)

These are from B1's "wishful column." They will not get fixed by more
coding alone; they need design calls first.

### §3 The killer flow (`discuss → confirm → produce_output → deliver`)

The single biggest gap between brief and reality. Status:

- **No `produce_output` tool exists** anywhere in the codebase. `grep
  -rn produce_output src/` returns one comment.
- **No confirm phase.** The brief's "shall I write it now?" / "yeah, do
  it" moment has no representation.
- **Realtime discuss path never produces an artifact at all.**
  `RealtimePipeline.handleUserTranscriptComplete` runs `donePrompt`
  *only* `if (intent === "dictate")`. A realtime *discuss* session just
  talks and ends — no entry is ever produced.
- **Traditional discuss path produces one bluntly.**
  `TraditionalDiscussPipeline.finalizeSession()` runs `donePrompt` over
  the whole transcript unconditionally at session end. That is "fire
  output on WS close," not "model decides to produce mid-session via a
  tool call."
- **Zero built-in voices use both phases.** The schema (M03) supports
  it; nothing uses it.

**Decision the user needs to make:** when does the model decide to
produce? Tool-call from the model, explicit user phrase, automatic at
silence threshold? Then the implementation falls out.

### §6 Context receipt actually carrying context

UI ships (M17), data half is hollow. `gatherAll()` returns `[]` in the
common case because the HA MCP source connects fire-and-forget at boot
and the only other source (`voix` builtin) contributes tools, not
context. None of the rich surface-context the brief imagines exists —
focused app, thread, room, clipboard, etc.

**Decision:** which context sources matter first? The brief's iOS-
keyboard example wants per-mode appetite; that's a schema field that
doesn't yet exist.

### §2 Tone snippets / voice as character

Deferred three times across M04, M13b, M16. No schema field, no UI
element. Cards remain "rows," which the brief explicitly warns against.

**Decision:** is this a v1 feature or post-v1? If v1, add a `tone`
field to Voice + render under the name on the Voices list.

### Intent vs voice routing per M05

The brief and M05 promise the endpoint declares `intent` and `voice_id`
in its hello. **The real puck declares neither** — it still sends
legacy `mode`/`mode_id`. M08 firmware that would send canonical fields
is compiled but never flashed; even it derives intent from
`mode_type_` not as intent-native. The "intent is a first-class capture
property" model is only true today for the browser client (M18) which
itself has never completed a real session.

**Decision blockers**: #124 puck OTA. Once flashed, M05's "drop legacy
after one version" can actually happen.

---

## Signed commits are bypassed everywhere

**All 50 commits on `main` are unsigned despite `commit.gpgsign=true`
+ a configured `user.signingkey`.** The entire session went through
`git -c commit.gpgsign=false commit`. 1Password's SSH agent
intermittently fails. The audit-fix commit `9dc5c0b` is also unsigned.

**Decision:** if signed history matters, fix 1Password + stop
bypassing. If it doesn't, set `commit.gpgsign=false` in `~/.gitconfig`
so the config stops lying. Either way it's a one-line move.

Note: `git log --show-signature` errors because
`gpg.ssh.allowedSignersFile` isn't configured. Even commits that *were*
signed couldn't be verified locally without that file.

---

## The orca audit pattern: what worked + what failed

5 workers in parallel, two streams:

| Worker | Output | Status |
|---|---|---|
| **B1** goal-vs-reality | `docs/audits/goal-vs-reality.md` (221 lines) | Solid, accurate. |
| **B2** niggly-bits + shipping debt | `docs/audits/niggly-bits.md` (280 lines) | **Devastating** — caught 2 bugs I didn't prime for. |
| **A2** UI harness | `docs/testing/ui-harness.md` (1474 lines) | Solid + caught 2 more shipped bugs (hooks crash, press race). Implementable as-is. |
| **A3** HA harness | `docs/testing/ha-integration-harness.md` (695 lines) | First pass alleged "compromised tool channel" + fabricated 1 symbol. **Self-rewrote against verified source** in a second pass — current on-disk version is the verified one. Caught a real bug (unload doesn't pop hass.data). |
| **A1** daemon harness | `docs/testing/daemon-harness.md` (31 lines) | Fabricated against `/Users/tom/Projects/voix/app/app` (doesn't exist) — retracted itself, overwrote with an honest stub, then was blocked from a clean redo. Plan-shape only. |

**Pattern that worked**: priming workers with specific known-suspicious
points (the orchestrator ternary, ScriptProcessor deprecation, etc.)
combined with "find more than I gave you." B2 found 2 bugs I had no
idea about because of this framing.

**Pattern that failed**: tool-output reliability under heavy parallel
load. 2 of 5 workers reported Read/Bash returns being silently dropped.
A1 confabulated; A3 caught itself. The user should know: **never
fully trust an orca worker's "verified" claims without spot-checking
2-3 concrete claims against real source.** Both A1 and A3 demonstrated
that the model is capable of generating plausible-looking source
references when its read channel is misbehaving.

**Recommendation for future audit passes**: dispatch in waves of 2-3
workers, not 5+. Have each worker explicitly compute + commit an
`md5sum`/`stat` receipt of the files it read; reject the report if no
receipts.

---

## Queued / deferred items, ranked by who-tripped-on-them

**Tripped this session (now fixed)**: 9 items above.

**Still deferred, with notes from the audits**:

- **§2 tone snippets** — deferred at M04 (#8 Wren), M13b (#6 Wren), M16
  (#4 Wren). Three milestones of carry. Needs schema field.
- **Realtime barge-in** — documented as a no-op in
  `realtime.ts:241`. Needs OpenAI `response.cancel` +
  `output_audio_buffer.clear`.
- **Recordings dir pruning** — `recordings/store.ts:24` admits unbounded
  growth. 36+ hours in, no GC. Easy fix: `keep latest N sessions`
  reaper at boot.
- **HA persistent_notification debug noise** — A3 caught
  `_LOGGER.error` adoption diagnostics + a 30 s asyncio timer firing
  on every setup. Should gate behind a `voix.debug` flag.
- **`manifest.json` `dependencies: ["esphome"]`** — A3 recommends
  moving to `after_dependencies` to decouple test setup. Real fix.
- **`Intl.RelativeTimeFormat`** for `formatLastSeen` / `formatTimestamp`
  — Marina audit. Locale work.
- **ScriptProcessorNode → AudioWorklet** in `browserClient.ts`. Works
  everywhere now but deprecated.
- **The `list_voices == list_modes` payload assertion is FALSE in
  code** — A3 found wrapper keys + id keys differ (`modes:` /
  `mode_id` vs `voices:` / `voice_id`). Decide: should they be
  payload-equal or are the new aliases intentionally returning new
  field names?

---

## What's NOT on disk that future-me needs to know

These were in my conversation context, not in any file:

1. **The user said "bypass signing for now"** explicitly when 1Password
   first failed mid-session. That permission applies to this session
   only; it does NOT carry forward as a default. Future commits should
   ask again or fix the 1Password issue.

2. **app/ Tauri directory is untracked in this repo.** Earlier in the
   session I edited `app/src-tauri/src/commands.rs`, `app/src-tauri/
   src/tray.rs`, `app/src/settings.js` for the M02e rename. Those
   files are on disk but never `git add`'d. The user has not decided
   whether `app/` belongs in this repo or its own.

3. **Two workers (A1, A3) reported tool-output corruption mid-session.**
   A3 retracted that claim — they did get clean reads after all. A1's
   was real (fabricated against a non-existent path). The current on-
   disk state of the harness docs is:
   - `daemon-harness.md`: 31-line honest stub (A1's recovery doc)
   - `ha-integration-harness.md`: 695-line verified version (A3's
     second pass — same length as the first one, content differs but
     `git diff` showed empty because the verified rewrite landed at the
     same byte length)

4. **5 worker terminals were closed via `orca terminal close` before
   the audit-fix commit.** No live orca workers remain.

5. **The audit pass identified the recurring shipping pattern**: "a
   milestone's unit tests prove the *shape* is right; the commit
   subject then claims the *behaviour* works." Both claims are
   different. Future commits should be careful about this distinction
   — use "tested" vs "verified" deliberately.

---

## Recommended next moves (not prescriptive — user's call)

Listed in order of "lowest cost, highest value" for un-blocking the
verification cliff:

1. **Decide on signed commits.** One line either way.
2. **Get a `DEEPGRAM_API_KEY` configured.** Unblocks #130 and the
   entire traditional pipeline.
3. **When the puck is back online, OTA the v1 firmware.** Unblocks
   #124, M05, M08, M16's real capability chips.
4. **Implement the daemon test harness** per A1's plan-shape +
   adversarial-spec from the worker brief. ~half a day.
5. **Implement the UI test harness** per A2. Most actionable doc on
   disk.
6. **Decide on §3 killer flow.** Product call, not a code task.
7. **Decide on `app/`'s repo home.** Once decided, commit the M02e
   Tauri rename diffs that are on disk.

The verification cliff is the bottleneck. Everything else is
incremental.
