# Build workflow

> **Phase 6 closed 2026-06-01.** M19–M24 + M-Arch Wave A/B + M-MobileFit all
> shipped end-to-end (RN foundation → macOS shell → iOS app → iOS keyboard).
> The Phase 6 table below is retained for the record; `v0.phase-6` tags
> pending Tom physical-device acceptance. Next milestone: **M20a** (HA Add-on
> Docker context shift), then **Phase 7 / M25**. See `docs/STATE.md`.

How we move from the inventory + build plan to shipped code. This is
the operational rhythm; the strategic targets are in
`voix-build-plan.md` and the inventory map is in
`inventory-vs-architecture.md`.

Keep this short. If a section grows past a screen, the workflow has
drifted from the plan.

---

## Operating rules

1. **One milestone = one PR.** Branch off `main`, ship merged. Target
   < 800 LOC diff, hard cap 1,500 (excluding pure deletes — those have
   no cap). If a milestone won't fit, split into M-Na / M-Nb.
2. **Merge to main per milestone without asking.** Solo work, no PR
   review machinery. The branch is for "I want to see the diff before
   it lands"; the merge is the default close. Same for pushing main.
3. **Deploy after each merge.** The HA Add-on `dev_mode` auto-pull
   makes daemon-side merges live in ~30s. HA-integration merges need
   an explicit `rsync` + `ha core restart` (the daemon path doesn't
   pull from `main` for `ha-integration/`). If the homelab isn't
   reachable from the dev machine, queue the deploy and proceed —
   blocking on it stalls the workflow for nothing.
4. **Strict sequence within a phase.** Phases run sequentially. Within
   a phase, some milestones parallelise (called out explicitly).
5. **Each milestone has a written acceptance check** before it starts.
   "What command / what UI / what test proves this milestone landed?"
   If you can't write it, the milestone is under-specified.
6. **Don't merge across two phases.** If Phase 4 work reveals Phase 3
   is wrong, stop, fix Phase 3, then resume. No half-fixed layers.
7. **Tracker + doc don't duplicate.** Task tracker holds the live
   milestones (this phase + next). This doc holds the full roadmap.
   Tasks get closed; the doc gets edited.
8. **Dead code dies in the same PR.** When a milestone replaces an old
   path, delete the old path in that PR. No "we'll clean it up later."
9. **STATE.md is the session handoff.** Update it at every milestone
   merge so the next Claude session can pick up cold.
10. **Don't edit one `protocol.ts` without the other.** M19 fix-pass
    left the daemon shipping its own copy of the wire-protocol types
    (`voix-backend/src/audio_io/protocol.ts`) parallel to the
    canonical `packages/protocol/src/audio-io.ts` so the HA Add-on
    Docker build can install from the `voix-backend/` context alone.
    The two files must stay byte-identical below the SYNC NOTE
    headers. Run `scripts/check-protocol-sync.sh` before pushing any
    change touching either; it flags drift.

## Test coverage rule

Every milestone ships with **one** of:

- **Daemon-side change** → at least one unit/integration test under
  `voix-backend/tests/` (or whatever testbed exists) covering the new
  behaviour. Pure-delete milestones are exempt — there's nothing left
  to test.
- **Firmware change** → a manual test recipe in the PR body: how to
  trigger it, what to look for in `/tmp/voix-device.log`.
- **HA integration change** → a unit test under
  `ha-integration/tests/unit/` for any logic added, plus a
  manual-acceptance recipe for the entity behaviour.
- **UI change** → see the UI/UX audit rule below — agents replace
  most of what would otherwise be Storybook / VRT for now.

"Decent test coverage" means: if the milestone introduces logic with
non-trivial branches, there's a test exercising each branch. We're
not chasing % coverage; we're chasing "the next refactor doesn't
silently break this."

## UI/UX audit rule (any milestone touching the UI)

Before merging a milestone that touches UI/UX, spin up **at least
two audit agents** via the `Agent` tool. Each agent gets:

- A **small, targeted brief** — not the full project context. A
  paragraph or two describing the screen / interaction being
  audited, the brand rules they need to honour (system fonts only,
  HA blue for voix moments only, puck glyph proportions locked,
  12-colour palette), and what acceptance looks like.
- A **personality**. Give each agent a character: a name, a point
  of view, an axe to grind. The lens shapes what they notice. A
  generic "audit this" gets generic feedback; a "Marina the OS-X
  HIG zealot who hates rounded corners that aren't system-rounded"
  finds the specific thing.
- **No license to redesign** — just to critique. Their job is to
  surface issues, not propose alternatives unless the brief asks.

Recommended starting cast (mix and match per audit):

- **Marina** — macOS HIG zealot. Hates anything that breaks SF Pro
  rhythm, system focus rings, native menu-bar conventions. Cares
  about font weight choices, line-height inheritance, the exact
  16-pixel spacing grid.
- **Sven** — Scandinavian typographer. Cares about hierarchy,
  tracking, the difference between 11px and 12px text. Will flag
  any whitespace that doesn't earn its place.
- **Priya** — accessibility-first engineer. Catches focus order,
  contrast under 4.5:1, screen-reader labels, keyboard traps, missing
  ARIA. Has zero patience for "I'll add it later."
- **Wren** — voice-first product designer. Knows the user's primary
  modality is voice, so screen affordances are secondary cues, not
  primary controls. Will flag any "press this to talk" that buries
  the actual capture flow.
- **Caleb** — power-user developer. Wants keyboard shortcuts,
  bulk operations, copy-able state, mono labels on technical things.
  Will flag any settings page that's just toggles when it should be
  a config file.

Each audit returns a punch list. Resolve the substantive ones in the
milestone; defer or close-as-wontfix the rest with a one-line note.
Save the briefs as `docs/agents/<milestone>-<persona>.md` so future
milestones can reference them.

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

### Phase 6 — RN end-to-end (the client foundation) — ✅ CLOSED 2026-06-01

**Status:** closed on source. M19–M24 + M-Arch Wave A/B + M-MobileFit shipped
+ verified; `v0.phase-6` tag pending Tom physical-device acceptance.

**Decision (2026-05-31):** Drop the Tauri shell. The pre-pivot
`app/` Tauri code is a relic. The voix UI is already
RN-shaped (9 files import from `react-native`, rendered today
via `react-native-web`). React Native covers all three real
targets — HA iframe (RN-web), macOS desktop (react-native-macos),
iOS app + keyboard (RN-iOS) — with one component layer. Tauri
would force a desktop/mobile split for no gain. See
`docs/agent-team-workflow.md` for how this phase is run.

| # | Milestone | Deliverable | Acceptance |
|---|---|---|---|
| M19 | Monorepo shape + shared UI package | `packages/ui/` holds every component currently in `voix-backend/ui/src/`. `voix-backend/ui/` becomes a thin web-target consumer of it. Existing daemon ingress UI renders identically. | `bun run build` in voix-backend/ui produces the same UI; HA add-on Open Web UI works unchanged. |
| M20 | RN app scaffold (`clients/app/`) | Replace the `app/` Tauri relic with an RN-CLI app. iOS + macOS targets enabled; metro bundler points at `packages/ui`. Pre-pivot Tauri code archived to `legacy/tauri-clipboard/` branch. | `npx react-native run-ios` boots; `npx react-native run-macos` boots; shared UI renders on both. |
| M20a | HA Add-on Docker context shift | Move `voix-backend/Dockerfile` build context to repo root so `bun install` can resolve `@voix/ui` and `@voix/protocol` workspace deps. Rewrite the `voix-backend/config.yaml` `dockerfile:` + `image:` paths to match. Verify by triggering an HAOS Add-on rebuild on the stable channel. Half-day's work; deferred from M20 to keep the RN-foundation commit clean. | HAOS Add-on stable-channel build succeeds; the bundled web UI loads in `Open Web UI`. Until this lands, only `dev_mode` (clones the full repo) works. |
| M21 | Platform shims | Abstract the web-only leaks (`window.location`, `document.title`, `AudioContext`, `getUserMedia`) behind a `packages/ui/platform/` interface. Web impl, RN-iOS impl, RN-macOS impl. | One source set; all three targets compile. Shim coverage: fetch, WebSocket, audio capture, audio playback, friendly name, base URL. |
| M22 | macOS shell: hotkey + paste | Global hotkey opens PTT overlay; produced entry hits clipboard + (with Accessibility) pastes into the focused app. | Cold-launch app, press hotkey, dictate, see paste. |
| M23 | iOS app shell | Full app: Conversations, Voices, Surfaces screens; press-to-talk works. Background audio mode for in-session continuity. | Cold-launch on iPhone, dictate a session, see it in Conversations. |
| M24 | iOS keyboard extension | Swift keyboard bounces to the host app for capture (Apple constraint), returns text to the original field via shared App Group + UIPasteboard. | Tap keyboard button in Notes → app opens → speak → text appears in Notes. |

M19 unblocks everything. M20-M21 run in tight sequence. M22-M24
parallelise once M21 is in.

### Phase 7 — HA connector finishing

| # | Milestone | Deliverable | Acceptance |
|---|---|---|---|
| M25 | HA connector trim to spec | Final reduction of `ha-integration/custom_components/voix/` to ~600-800 LOC: discovery + adoption push + light/sensor/button/text entities + MCP tool exposure. | HA UI shows the right entities; the connector is the right shape for the architecture. |

### Phase 8 — Android (deferred until iOS lands)

| # | Milestone | Deliverable | Acceptance |
|---|---|---|---|
| M26 | Android app + IME | RN target for Android; in-keyboard capture (Android allows it natively, unlike iOS). | Dictate + paste flow on Android. |

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

---

## CI

[![CI](https://github.com/RainnWorks/voix/actions/workflows/ci.yml/badge.svg)](https://github.com/RainnWorks/voix/actions/workflows/ci.yml)

GitHub Actions runs the JS/TS side of the monorepo on every push to
`main`, every pull request, and on-demand via **workflow_dispatch**.
Workflow: [`.github/workflows/ci.yml`](../.github/workflows/ci.yml).

It runs on `macos-latest` (the repo also hosts the iOS/macOS RN
clients) but **does not** run `xcodebuild` — that's too slow for CI and
needs Apple Dev signing. CI covers everything that can be checked
without a device or a signing identity:

| Step | Command | What it guards |
|---|---|---|
| Repo checks | `bun run check` | native-sibling pins, protocol sync, pin bounds |
| Backend tests | `bun test` (in `voix-backend`) | the 140+ daemon pipeline tests |
| Backend typecheck | `bun run typecheck` (in `voix-backend`) | `tsc --noEmit` over the daemon |
| UI build | `bun run build` (in `voix-backend/ui`) | `tsc --noEmit` + `vite build` of the web UI |
| App typecheck | `bunx tsc -p clients/app/tsconfig.json --noEmit` | the RN client's types |

Dependencies are cached on `~/.bun/install/cache` + the resolved
`node_modules` trees, keyed on `bun.lock`. To reproduce a CI run
locally, execute those five commands in order — each must exit 0.

> **Note:** `voix-backend/tsconfig.json` declares `"types":
> ["bun-types"]`, so `bun-types` is a direct devDependency of
> `voix-backend`. Bun's isolated linker only hoists *direct* deps, so
> without that entry the daemon typecheck fails to resolve `bun-types`
> on a clean install. Don't drop it.
