# Build workflow

How we move from the inventory + build plan to shipped code. This is
the operational rhythm; the strategic targets are in
`voix-build-plan.md` and the inventory map is in
`inventory-vs-architecture.md`.

Keep this short. If a section grows past a screen, the workflow has
drifted from the plan.

---

## Operating rules

1. **One milestone = one PR.** Branch off `main`, ship merged.
   Milestones are sized so each is reviewable in one sitting (target:
   < 800 LOC diff, hard cap: 1,500). If a milestone won't fit, split
   it into M-Na / M-Nb.
2. **Strict sequence within a phase.** Phases run sequentially. Within
   a phase, milestones can sometimes parallelise, noted explicitly per
   phase below.
3. **Each milestone has a written acceptance check.** "What command /
   what UI / what test proves this milestone landed?" If you can't
   write it before you start, the milestone is under-specified.
4. **Don't merge across two phases.** If you're in Phase 4 work and
   realise Phase 3 is wrong, stop, fix Phase 3, then resume. No
   half-fixed layers.
5. **Auto-mode for tracking.** The task tracker holds the live
   milestones (this phase + next). This doc holds the full roadmap.
   Tasks get closed; the doc gets edited. They don't duplicate.
6. **Dead code dies the same PR.** When a milestone replaces an old
   path, delete the old path in that PR. No "we'll clean it up later."
7. **Deploy after each milestone.** The HA Add-on `dev_mode` auto-pull
   means a merged PR is live on the homelab daemon within ~30s. Use
   it. Smoke-test the puck after every merge that touches the puck
   path.
8. **STATE.md is the session handoff.** When a milestone lands, update
   `docs/STATE.md` so the next Claude session can pick up cold.

---

## Branch + commit hygiene

- Branches: `phase-N/m-XX-short-name`, e.g. `phase-1/m-01-ha-deletes`.
- Commit messages: existing style (`area: summary`, body explains
  *why*, ends with the Co-Authored-By line). See recent commits for
  the shape.
- One milestone = one merge commit on `main`. Squash if you have to,
  but PR commits are fine as long as the history reads cleanly.
- Tag `main` at each phase boundary: `v0.phase-1`, `v0.phase-2`, etc.
  Cheap to do, makes rollback obvious.

---

## The phase map

Each row is a milestone. **Blocks** = the milestone numbers that
cannot start until this one merges. Phases run top-to-bottom.

### Phase 1 — Cleanup (no behaviour change)

Ship-able today. Pure deletes + renames. No new code paths.

| # | Milestone | Deliverable | Acceptance |
|---|---|---|---|
| M01 | Delete dead HA Python | ~4,500 LOC out of `ha-integration/custom_components/voix/` per inventory §2.5: `ws_view.py`, `stt/`, `post_process.py`, `modes.py`; trim `__init__.py`, `const.py`, `config_flow.py`. | `ha core restart` clean, `ha core check` passes, puck wake-word still works end-to-end (daemon was already serving that path). |
| M02 | `Mode` → `Voice` rename (daemon + UI) | Pure mechanical rename across `voix-backend/src/modes/` → `src/voices/`, `ui/src/modes/` → `ui/src/voices/`. Persistence file renamed with one-shot migration on boot. API routes renamed (`/api/modes` → `/api/voices`). | `bun run typecheck` clean, web UI loads, the six built-in voices show in the list with names intact. |

M01 and M02 are parallelisable; either order is fine. Both can land
this week.

### Phase 2 — Voice schema (the killer-flow shape)

Schema migration to the design-brief §3 shape. Keeps the product
working at every step.

| # | Milestone | Deliverable | Acceptance | Blocks |
|---|---|---|---|---|
| M03 | Voice schema: two-phase prompts | Add `talkingPrompt: string` + `donePrompt: string` to `Voice`. Keep `prompt` + `postProcessPrompt` as deprecated fields that migrate to the new ones on read. Update built-ins to fill in the canonical six per brand guides. | Existing voices.json (modes.json) migrates without data loss; daemon's existing realtime path uses `talkingPrompt` when present. | M04 |
| M04 | Voice editor: two prompt panels | Mode editor UI rewrites to show "When we're talking" and "When I'm done" panels (either can be empty). Drop the `mode.type === "realtime"` conditional branching. | Saving a voice with both panels filled persists both fields; the brand-correct visual language unchanged. | M05 |
| M05 | Intent moves off the voice, onto the capture call | Wire-protocol change: hello now sends `intent: "dictate" \| "discuss"` (separately from voice_id). Daemon's session lookup is `(intent, voice_id)`. Old `mode: "realtime" \| "dictation"` field accepted for one version then dropped. | Puck wake-word still works; intent comes from the puck's NVS-stored choice, voice comes from voice_id. | M06 |

### Phase 3 — Audio I/O port (BYO falls out)

| # | Milestone | Deliverable | Acceptance | Blocks |
|---|---|---|---|---|
| M06 | Spec the Audio I/O port protocol | New file `protocol/audio-io/spec.md` + `voix-backend/src/audio_io/protocol.ts` with the capability-handshake hello, versioned (`protocol_version: 1`), framing, reconnection. Inventory §3.1 has the type sketch. | Doc reviewable in isolation. Types compile. | M07 |
| M07 | Daemon: split `puck/session.ts` into `audio_io/` + `pipeline/` | The 628-LOC session.ts splits. `audio_io/` is the port (recv frames, send frames, hello, decline). `pipeline/` is realtime orchestration (the OpenAI realtime client, watchdog, ready_for_input). | Wake-word session works identically. New file boundaries are clean (no cross-module reach-through). | M08 |
| M08 | Firmware: send capability handshake | Tiny ESPHome component change: extend the hello JSON with `protocol_version`, `capabilities.*`, `client_info.kind = "puck"`. | Puck reports half-duplex-on-chip, mic 16 kHz, speaker 24 kHz; daemon logs the capabilities. | — |

M07 and M08 can land in either order but M08 should follow within a
day so the daemon doesn't carry both code paths long.

### Phase 4 — Pipeline + providers (build-plan items 1+2)

This is where the riskiest unsolved bit lives: VAD. Per the build
plan it goes first, alone, before any UI work compounds on it.

| # | Milestone | Deliverable | Acceptance | Blocks |
|---|---|---|---|---|
| M09 | VAD / auto-stop tuning bench | Standalone test: stream mic audio from a paused recording, run the VAD, log start/stop decisions with timing. No UI, no integration. Goal: find the silence-threshold + min-silence-duration that feels present without clipping. | A demo session: speak a sentence, stop talking; the bench logs auto-stop within 300-600 ms of true end-of-speech, never within speech, across at least 20 test utterances. |  |
| M10 | STT provider abstraction + Deepgram impl | `pipeline/providers/stt/types.ts` interface; `pipeline/providers/stt/deepgram.ts` streaming impl. | A dictate call with Deepgram returns a transcript within latency budget. | M12 |
| M11 | LLM provider abstraction + OpenAI/OpenRouter impls | Promote `post_process/index.ts` into `pipeline/providers/llm/`. Existing call-shape stays. | A `donePrompt`-only voice produces a polished entry from a raw transcript. | M12 |
| M12 | TTS provider abstraction + Aura impl | `pipeline/providers/tts/types.ts` + `aura.ts`. | A traditional discuss turn speaks a reply. | M13 |
| M13 | Pipeline orchestrator: dictate end-to-end | `pipeline/orchestrator.ts`. Given `(intent: "dictate", voice)`, pick STT + (optional) LLM, produce an entry. Wire to the audio-io port. | Puck dictation produces an entry via traditional pipeline; round-trip works without OpenAI Realtime. | M14 |
| M14 | Discuss via traditional pipeline | Orchestrator gains the discuss path: STT → LLM (talkingPrompt) → TTS, loop until VAD-driven end-of-discussion, then call donePrompt LLM to produce the entry. | Discuss session works on traditional providers; feels turn-based but lands the entry. | M15 |
| M15 | Realtime provider behind the orchestrator | Reshape existing `realtime/openai.ts` to satisfy a `RealtimeProvider` interface. Quality dial: a voice setting `discussEngine: "traditional" \| "realtime"` picks which the orchestrator uses. | Discuss session works in both modes; voice editor exposes the dial. | — |

M10-M12 parallelise. M13 needs all three to be ready.

### Phase 5 — UI catches up to the new model

| # | Milestone | Deliverable | Acceptance |
|---|---|---|---|
| M16 | Surfaces screen | Replace "Devices" with "Surfaces" in the sidebar; the screen lists every connected Audio I/O endpoint with its capabilities (from the M06 handshake). | Visiting `Surfaces` shows the puck + any browser-based capture clients with their capability strings rendered legibly. |
| M17 | Conversations screen + entry detail | List sessions (already in `history/`). Click into one to see transcript, the produced entry, AND the context receipt (what the daemon knew at session start). Audio plays inline (mic + speaker WAVs from `recordings/`). | Past sessions visible end-to-end; the receipt makes voix's intelligence legible per design-brief §6. |
| M18 | Press-to-talk in the web client itself | Browser-based Audio I/O implementation: browser mic + browser audio out, hello + capability handshake. The web client itself becomes an Audio I/O endpoint. | Click "Talk" in the web UI; have a discuss session; the session shows up in Conversations alongside puck sessions. |

These parallelise once M15 is in.

### Phase 6 — Desktop client (Mac, Path A)

| # | Milestone | Deliverable | Acceptance |
|---|---|---|---|
| M19 | Tauri shell embeds the daemon | `clients/desktop/` (was `app/`). Tauri app bundles the `bun` binary, child-processes the core on launch, talks to it on localhost. Existing menu/tray/paste Rust code stays. | Open the .app, see the same UI as HA ingress, talk to it; no separate daemon process needed. |
| M20 | Hotkey + paste flow | Global hotkey opens a press-to-talk overlay; talking phase + done phase; produced entry is pasted into the focused app. | End-to-end dictate flow on Mac, no puck needed. |

### Phase 7 — HA connector finishing

| # | Milestone | Deliverable | Acceptance |
|---|---|---|---|
| M21 | HA connector trim to spec | Final reduction of `ha-integration/custom_components/voix/` to ~600-800 LOC: discovery + adoption push + light/sensor/button/text entities + MCP tool exposure. | HA UI shows the right entities; the connector is the right shape for the architecture. |

### Phase 8 — Mobile (deferred until M19 lands)

| # | Milestone | Deliverable | Acceptance |
|---|---|---|---|
| M22 | iOS app: notebook + dictate | RN tree consuming `clients/shared/`. Browser-style capture client (mic + audio out + paste-to-app via share extension). | Press-to-talk works on iPhone; entries sync. |
| M23 | iOS keyboard launcher | Swift extension that bounces to the app for capture (Apple constraint), then back to the field with the produced text. | Tap the keyboard button → app opens → speak → text appears in the original field. |
| M24 | Android app + IME | RN tree for the app; native IME with in-keyboard capture (Android allows it). | Dictate + paste flow on Android. |

### Phase 9 — Power-user context (deferred)

| # | Milestone | Deliverable | Acceptance |
|---|---|---|---|
| M25 | Codebase index + retrieval tool | On-box index per `voix-build-plan.md` walk-and-talk section. Retrieval tool exposed to the LLM. | "What changed in module X" answered from index, not stuffed context. |
| M26 | Confidence layer for context routing | Cheap signals always; expensive sources gated by confidence. | Routing decisions logged + auditable per session. |

---

## Critical path

```
M01 ─┐                                         ┌─ M16 ─┐
     ├─ M03 ─ M04 ─ M05 ─ M06 ─ M07 ─ M08 ─┐   │       │
M02 ─┘                                     │   ├─ M17 ─┼─ M19 ─ M20 ─┐
                                           ├─→ │       │             ├─ M21
                                M09 ─┐     │   └─ M18 ─┘             │
                                M10 ─┼─ M13┘                         │
                                M11 ─┤                               ├─ M22 ─ M23
                                M12 ─┘     M14 ─ M15                 │
                                                                     └─ M24
                                                       M25, M26 (deferred)
```

The unforked critical path is **M03 → M04 → M05 → M06 → M07 → M09 →
M13 → M15 → M19**. That's the spine. Everything else hangs off it.

---

## How we track in-flight work

- **Task list**: active milestones (current phase + the next one)
  live as tasks. Closed when their PR merges.
- **This doc**: the full roadmap. Edit when milestones split, get
  re-ordered, or new work surfaces.
- **`docs/STATE.md`**: updated at every milestone merge so the next
  session can pick up cold.

When a milestone reveals new work that doesn't fit it, log it in
this doc (a new M-NN row) or as a follow-up task, don't try to
swell the in-flight PR.

---

## When the workflow itself is wrong

You'll know because PRs start landing with the wrong shape, or
milestones balloon past the LOC cap, or two phases get tangled. When
that happens: stop the current milestone, write down what you
learned, edit this doc, then resume. The workflow is a tool, not
the law.
