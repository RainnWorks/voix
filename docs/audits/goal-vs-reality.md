# Goal vs reality — milestone audit (M01–M18)

**Date:** 2026-05-30 · **Audited at:** `main` @ `5c2202a` ·
**Auditor:** dispatched worker B1, reading the actual code and the
actual commits.

This is an honest accounting of what the design brief
(`design-brief-multi-surface.md`) and build plan
(`voix-build-plan.md` + `build-workflow.md`'s phase map) **promised**,
versus what is **merged on `main`**, versus what the shipping language
in `STATE.md` (and commit subjects) is **overstating**.

## The headline

The codebase is real, well-structured, and well-tested *at the unit
level*: 168 test cases, biome + typecheck clean, clean module
boundaries. But the shipping vocabulary ("merged", "complete on
source", "end-to-end") is doing heavy lifting. **There is a
verification cliff at the Phase 3/4 boundary.** Everything up to and
including the daemon refactor (M01–M07) and the HA-integration renames
(M02b/c/d) has touched real hardware or a real HA instance. Everything
from M08 onward — the entire traditional pipeline, the firmware v1
handshake, the new UI surfaces — has only ever run against **stubs,
synthetic audio, or a compiled-but-never-flashed binary.**

Three structural promises from the design brief are **not built at
all**, only scaffolded:

1. **The `produce_output` handoff (§3, the "killer flow").** The
   string `produce_output` appears only in *comments and doc prose*.
   No tool, no schema, no confirm phase. (`grep -rn produce_output
   src/` → only `puck/protocol.ts:30`, a comment.)
2. **Voice-as-character tone snippets (§2).** Deferred at M04, again at
   M13b, again at M16. Still no UI, no schema field.
3. **Context receipt actually carrying context (§6).** The receipt UI
   renders (M17), but the pipeline that fills `contextSnapshot` returns
   `[]` in the common case.

---

## Milestone-by-milestone scorecard

Legend for **Shipped-but-unverified**: what the "merged + verified"
framing claims that has *not* been exercised against real I/O.

| # | Promised (plan/brief) | Merged on `main` | Shipped-but-unverified | Notes |
|---|---|---|---|---|
| **M01** | Delete ~4,500 LOC dead HA Python; `ha core check` passes; puck still works | ✅ `30d1768`, −2,425 LOC | — | **Genuinely verified.** `deploy-ha-integration.sh` ran clean on the real HAOS; 26 voix entities loaded post-restart. The one milestone with no asterisk. |
| **M02** | `Mode`→`Voice` rename, daemon + UI, persistence migration | ✅ `e3e80af`, 4 tests | UI half of the rename | Daemon rename + migration tested. The **Tauri app (`app/`) rename is M02e, on disk but untracked** — `app/` is not in the repo, so "merged" is literally false for that slice. |
| **M02b** | HA `voix.*_voice` service aliases | ✅ `72c6b2f`, deployed | — | Verified live: 13 services in HA Developer Tools. |
| **M02c+d** | entity_id `voix_mode_*`→`voix_voice_*` migration | ✅ `bf802c2`, deployed | — | Verified live: 0 stale, 17 tracking entities. Storage key `options["modes"]` deliberately left as-is. |
| **M03** | Two-phase `talkingPrompt`/`donePrompt` schema + migration | ✅ `dd4e186`, 5 tests | "realtime path uses new fields" on real puck | Migration logic tested on every on-disk shape. The claim that the realtime path *consumes* it has only run in unit context. |
| **M04** | Voice editor: two prompt panels, drop `type` conditional | ✅ `c6203ff`, audited (Marina+Wren) | — | Solid UI work. **But Wren #8 flagged the missing §2 tone snippet here and it was deferred** ("M16+"). First appearance of a recurring punt. |
| **M05** | Intent moves onto the capture call; hello sends `intent`+`voice_id`; legacy mapped one version then dropped | ✅ `5323e71`, 7 tests | The entire wire change on a real puck | `resolveCapture()` maps legacy→canonical and is tested. **The real puck has never sent `intent`/`voice_id`** — it still sends `mode`/`mode_id`, and the daemon synthesises (`realtime→discuss`, `dictation→dictate`). The "drop legacy after one version" half has not happened and cannot until the puck is flashed. |
| **M06** | Audio I/O port v1 spec + TS types + `parseHello` | ✅ `9192174`, 14 tests | — | Honest: this milestone was *only* a doc + types, and that's exactly what landed. `parseHello`/`needsDaemonEchoGate` unit-tested. No overstatement. |
| **M07** | Split `puck/session.ts` into `audio_io/` + `pipeline/`; "wake-word session works identically" | ✅ `0399302`, 43 tests | "works identically" on real puck | Clean refactor, no cross-module reach-through, 43 connection tests. The behavioural-equivalence claim was **not** re-verified on hardware after the split. |
| **M08** | Firmware sends v1 capability handshake; "daemon logs the capabilities" | ⚠️ `fa58375` — **compiled, never flashed** | **The entire milestone's runtime behaviour** | The firmware source builds the correct v1 hello (`protocol_version:1`, `capabilities.*`, `client_info.kind="puck"`) and the binary contains the fields. **But OTA returned "Network is unreachable"; no real puck has ever spoken v1 to the daemon.** The daemon's acceptance is proven only by unit tests feeding it synthetic v1 hellos. Note the firmware *itself* still derives `intent` from `mode_type_`, so even once flashed it is not a clean intent-native client. |
| **M09** | Energy VAD + tuning bench; acceptance = auto-stop within 300–600 ms across ≥20 utterances | ✅ `78bf122`, 10 tests | **The acceptance check itself** | Code + bench shipped. Defaults (`startThreshold=800` etc.) are **un-tuned guesses** — STATE.md admits "needs 20-utterance human tuning sweep." The milestone's *own* acceptance criterion has never been run. |
| **M10** | STT provider interface + Deepgram streaming impl | ✅ `f7ba67d`, 14 tests | Any real transcription | Tests run "against a stub WS — no real network." Needs `DEEPGRAM_API_KEY`. No byte of real speech has been transcribed by this code. |
| **M11** | LLM provider interface + OpenAI/OpenRouter | ✅ `eb031bf`, 17 tests | The new `LlmProvider.complete` path | Nuance: the **`postProcess` facade** (used by the realtime dictate path) wraps real OpenAI and *did* work in earlier phases. But the **multi-turn `complete()` interface** that M14 discuss depends on has only run against stubs. |
| **M12** | TTS provider interface + Aura impl | ✅ `c8d5ce8`, 14 tests | Any real audio out | Stub-WS tests. Aura has never synthesised a real frame. |
| **M13** | Orchestrator + traditional dictate end-to-end; "round-trip works without OpenAI Realtime" | ✅ `c376d04`, 104 tests | **"end-to-end" / "round-trip"** | This is the most overstated subject line. The orchestrator's *selection logic* is tested; the dictate pipeline has **never produced an entry from real speech.** STATE.md itself lists "#130 dictate round-trip" as a pending deploy task. "End-to-end" means "the types connect," not "audio went in and an entry came out." |
| **M14** | Discuss via traditional STT→LLM→TTS; "feels turn-based but lands the entry" | ✅ `9126238`, 10 tests | **The entire conversational loop** | Tests drive **synthetic-amplitude VAD transitions** with stub providers. No real LLM/STT/TTS call has ever been made on this path. Also: the done-phase runs `donePrompt` **unconditionally at session end** (if the voice has one) — there is no model-initiated "produce it" handoff (see brief §3 below). |
| **M15** | Realtime provider behind the orchestrator + quality dial | ⚠️ `ed21f30` — **types only** | The "realtime provider" abstraction | STATE.md is candid here: "RealtimeProvider types-only interface (full refactor … is M16+ work)." So the dial exists in the editor and the orchestrator branches on it, but `RealtimePipeline` was **not** actually reshaped behind the `RealtimeProvider` interface. The promised refactor is deferred; only the type file landed. |
| **M16** | Surfaces screen listing endpoints with capabilities "from the M06 handshake" | ✅ `14cec52`, audited | Capability chips reflecting a *real* v1 handshake | UI is real and persists capabilities. But since no real puck sent v1 (M08), the puck's chips render from `LEGACY_PUCK_DEFAULT_CAPS` — **hard-coded defaults, not a live handshake.** Wren again flagged the tone snippet (#4) → deferred to "M17+." |
| **M17** | Conversations + entry detail + **context receipt** ("what the daemon knew at session start") | ✅ `f41835b`, audited | The receipt having content | The screen renders `entry.contextSnapshot` via `<ContextReceipt>`. **But that array is almost always empty** (see brief §6): the HA MCP source connects fire-and-forget at boot, `gatherContext` returns `[]` when not yet connected *or* when HA's `GetLiveContext` resource isn't in MCP scope. The receipt is a beautiful frame around a usually-empty picture. |
| **M18** | Press-to-talk in the web client; "have a discuss session; shows up in Conversations" | ✅ `f20ccdd` | **A real round-trip** | The browser client is real code: `getUserMedia`, `ScriptProcessorNode` Float32→Int16, WS v1 hello, WebAudio playback. **But it has never had a real `getUserMedia` → real provider → audio-back round-trip.** It defaults to `intent: "discuss"`, which for the default-realtime voice routes to `RealtimePipeline` (real OpenAI Realtime) — a path that needs a key and has not been exercised from the browser. |

---

## The verification ladder (what has *actually* run)

Ordered by how much real-world evidence exists:

1. **Verified against real systems:** M01 (HAOS restart + entity
   count), M02b/c/d (live HA service/entity inspection). These are the
   only milestones where "verified" is earned.
2. **Ran live in an *earlier* phase, carried forward untested:** the
   OpenAI Realtime discuss path and the `postProcess` dictation facade
   (pre-pivot, on the real puck). The M07 refactor moved this code; the
   move was not re-verified on hardware.
3. **Merged + unit-tested, never run against real I/O:** M03–M06,
   M09–M14, M16–M18. The bulk of the recent work. Stubs, synthetic
   audio, fake voices.
4. **Compiled / typed, never executed at all:** M08 firmware (built,
   not flashed), M15 RealtimeProvider (types only, no impl).

The recurring pattern: **a milestone's unit tests prove the *shape* is
right (the types connect, the selection logic branches correctly), and
the commit subject then claims the *behaviour* works.** Those are
different claims. "104 daemon tests passing" is true; "traditional
dictate end-to-end" is aspirational.

### Two deploy blockers gate almost everything

Both are tracked in STATE.md but worth stating plainly because they
cascade:

- **#124 — puck OTA.** Until the v1 firmware flashes, M05/M08 are
  unverified, M16's capability chips are fake, and no real puck speaks
  the new protocol. The puck has been `unavailable` in HA since
  2026-05-29; OTA fails with "Network is unreachable."
- **#130 — `DEEPGRAM_API_KEY` + a dictate round-trip.** Until a key is
  configured and one real dictation runs, the *entire* traditional
  pipeline (M10–M14) is unproven against real audio.

---

## Unresolved design-brief commitments (the wishful column)

These are promises the brief makes that the code does not yet keep.
They are not milestones that slipped; they are *product theses* that
remain unbuilt.

### §3 — The killer flow (`discuss → confirm → produce_output → deliver`)

**This is the single biggest gap between vision and reality.** The
brief calls it "the product. Everything else is plumbing in service to
this loop." The loop is not wired:

- **No `produce_output` tool exists.** Not in the realtime tool set
  (`listAllTools()` exposes only HA MCP tools + `voix.end_session`),
  not as a schema, not anywhere but comments.
- **No confirm phase.** There is no "shall I write it now?" / "yeah, do
  it" moment. The brief's phase model (Discuss → Confirm → Output →
  Deliver) has no representation in code.
- **The realtime discuss path never produces an artifact at all.**
  `RealtimePipeline.handleUserTranscriptComplete` runs `donePrompt`
  *only* `if (intent === "dictate")`. A realtime *discuss* session just
  talks and ends — no output entry is ever produced from the
  conversation.
- **The traditional discuss path produces one, but bluntly.**
  `TraditionalDiscussPipeline.finalizeSession()` runs `donePrompt` over
  the whole transcript **unconditionally at session end** (whenever the
  voice has a `donePrompt`). That is "run the output prompt when the WS
  closes," not "the model consensually decides to produce, mid-session,
  via a tool call."
- **No built-in voice even expresses the killer shape.** Every built-in
  is either realtime (`talkingPrompt` only) or dictation (`donePrompt`
  only). None has *both* phases filled — the `{conversation, output}`
  combination the brief calls "the interesting ones" ships in zero
  presets. The schema (M03) supports it; nothing uses it.

**Verdict:** the schema was reshaped for the killer flow; the flow
itself was not built.

### §2 — Voice as character (tone snippets)

The brief: "A mode card is not a settings tile. It is a small portrait
… a quote-styled snippet of the mode's tone." This has been **deferred
three times and never built:**

- M04 (Wren #8): "No tone snippet, no quoted example … Defer — needs
  more thought; M16+."
- M13b (Wren #6): "Tone snippet still missing. M04 #8 was deferred but
  the [carry continues]."
- M16 (Wren #4): "the *right* home for a tone snippet … M04 #8 deferred
  again … Defer — needs schema field, M17+."

There is no tone/quote/portrait field in the voice schema and no such
element in `VoiceList.tsx` / `VoiceEditor.tsx`. The cards remain
"rows," which is precisely what §2 warns against.

### §6 — Every surface is a context gatherer; the context receipt

The brief wants each session to show "what voix knew about you." The
**UI half shipped (M17) but the data half is hollow:**

- `gatherAll()` fans out to registered sources with a 2 s timeout.
- The HA source connects **fire-and-forget at boot** (`void
  ha.connect()`); `gatherContext` returns `[]` if not yet connected.
- Even when connected, it only returns content if HA exposes the
  `homeassistant://assist/context-snapshot` resource (i.e.
  `GetLiveContext` is in the user's MCP scope) — otherwise `[]`.
- Only **two** sources exist (`ha`, `voix`-builtin), and the builtin
  contributes tools, not context. None of the rich surface-context the
  brief imagines (focused app, thread, room, clipboard) exists.

So the typical `contextSnapshot` is empty, the receipt renders empty,
and the "context is the secret behind the magic" promise is unmet in
practice.

### §5 / M05 — Intent vs voice routing

The brief and M05 promise the endpoint declares `intent` and `voice_id`
in its hello. **The real puck declares neither.** It still sends legacy
`mode`/`mode_id`, and `resolveCapture()` synthesises intent on the
daemon side (`mode==="dictation" ? "dictate" : "discuss"`). The v1
firmware that *would* send the canonical fields is compiled but never
flashed (M08), and even it derives `intent` from `mode_type_` rather
than being intent-native. The "intent is a first-class capture
property the client owns" model is true only for the browser client
(M18), which itself has never completed a real session.

### Surfaces are peers, not "puck + stragglers" (§5, §12)

The IA shifted correctly (sidebar Surfaces, per-surface model,
capability chips) — but every non-puck surface is still a **placeholder
glyph** (📱/🌐/💻). The only surface that has ever connected is the
puck (legacy protocol), plus an unverified browser client. The
multi-surface story is architecturally present and operationally
unproven.

---

## What this means for tagging

`STATE.md` withholds the `v0.phase-3`, `-4`, `-5` tags "pending
real-puck verification" — that restraint is **correct and should
hold.** The honest status is:

- **Phases 1–2:** shipped and verified. Tag-worthy (and tagged).
- **Phase 3:** code complete, **runtime entirely unverified** (M08
  never flashed).
- **Phase 4:** code complete, **never run against a real provider.**
- **Phase 5:** UI complete, **renders from stub/legacy/empty data.**

"Complete on source" is an accurate phrase. "Complete," unqualified,
is not. The gap between them is two API keys and one successful OTA.
</content>
</invoke>
