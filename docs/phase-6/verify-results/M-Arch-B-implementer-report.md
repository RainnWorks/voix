# M-Arch Wave B implementer report
Status: SUCCESS

Wall-clock: ~55 min. Two commits, both green on `bun test` + `bun run check` + backend `tsc` + clients/app typecheck + daemon boot smoke. Wave B ships the last two refactors from Arvid's audit (#1 load-bearing realtime seam, #14 stub-backed pipeline test).

## Commits

```
fc1854b pipeline(M-Arch #14): RealtimePipeline tests via StubRealtimeProvider (Arvid audit)
730b946 pipeline(M-Arch #1): load-bearing Realtime provider seam (Arvid audit)
```

(An interleaved `50da3fc ui(M24 fix)` from the parallel M24 worker landed between my two pushes — no file overlap, no rebase needed.)

## Files modified

```
voix-backend/src/pipeline/providers/realtime/types.ts   [Step 1 — rewrite: neutral seam]
voix-backend/src/realtime/openai.ts                      [Step 1 — rewrite: adapter]
voix-backend/src/pipeline/realtime.ts                    [Step 1 — neutral event switch]
voix-backend/src/pipeline/orchestrator.ts                [Step 1 — realtime registry kind]
voix-backend/src/api/providers.ts                        [Step 1 — kind=realtime]
voix-backend/tests/pipeline/realtime.test.ts             [Step 2 — new, StubRealtimeProvider]
```

## Step 1 — Refactor #1: load-bearing realtime seam

Commit `730b946`. Tests after: 134 / 0 (no new tests this step; pure refactor preserving behaviour).

### a. `pipeline/providers/realtime/types.ts` — neutral contract

- Deleted the `import type { RealtimeFunctionTool } from "openai/resources/realtime"` line. No OpenAI type crosses this seam anymore.
- New **neutral `RealtimeEvent` union** (exactly the brief's shape): `user_speech_start` / `user_speech_stop` / `user_transcript_delta` / `user_transcript_complete` / `assistant_audio{pcm}` / `assistant_transcript_delta` / `assistant_done` / `function_call{callId,name,argsJson}` / `error{message}`. Plus a `RealtimeEventHandler` alias.
- `RealtimeProviderSessionConfig.tools` is now `ToolSpec[]` (the neutral shape Wave A added) instead of `RealtimeFunctionTool[]`.
- `RealtimeSession` interface: `subscribe(handler)`, `updateSession(patch)`, `pushMicPcm(buf)`, `commitInput()`, `sendAssistantStart()`, `sendFunctionResult(callId, output)`, `close()`. `RealtimeProvider.open(cfg)` now returns a **connected** session.
- Kept `updateSession` on the session (brief listed the neutral additions; `updateSession` is the existing lifecycle method that pushes composed instructions + tools after context gather — keeping it preserves the gather/handshake overlap the pipeline's `start()` deliberately races).

### b. `realtime/openai.ts` — the adapter

- `OpenAIRealtimeClient` → `OpenAIRealtimeProvider` (impl of `RealtimeProvider`) + an internal `OpenAIRealtimeSession` (impl of `RealtimeSession`). Added `createOpenAiRealtimeProvider(apiKey)` matching the registry's `() => Promise<RealtimeProvider>` shape.
- **Inbound translation** lives here now: the `rt.on("response.output_audio.delta", …)` subscriptions that used to be in `pipeline/realtime.ts` became the SDK→neutral translation inside `wireTranslation()`. Assistant transcript switched from the single `.done` event to `.delta` accumulation (the pipeline flushes on `assistant_done`).
- **Outbound translation**: `cfg.tools` and `updateSession({tools})` map neutral `ToolSpec[]` → `RealtimeFunctionTool[]` via `toOpenAiTool` (Wave A's adapter, now used internally). `toOpenAiTool` stays exported (no other caller, but it's the documented provider-boundary translation).
- Bad function-call JSON is handled in the adapter (replies `{"error":"could not parse arguments"}` and does **not** emit `function_call`), preserving the old pipeline-side behaviour.
- Unexpected upstream socket close → emits a neutral `error` event (a close WE initiated sets `closed` first and is suppressed). This is how teardown-on-close reaches the pipeline without exposing the socket.

### c. `pipeline/realtime.ts` — neutral event switch

- `wireRealtimeEvents()` is now `this.session.subscribe(ev => switch (ev.type) {…})`. **No OpenAI event name appears in this file.**
- `error` event now triggers teardown (`cb.close()`) in addition to surfacing — the brief's intended new behaviour ("error event surfaces to teardown"). Previously only socket-close tore down; the adapter now folds socket-close into the `error` event so the single switch arm covers both.
- `handleFunctionCall` takes the pre-parsed `argsJson: Record<string,unknown>` (parsing moved to the adapter). Mic/tool-result/close routes go through `this.session.pushMicPcm` / `sendFunctionResult` / `close`.
- Assistant transcript accumulated across `assistant_transcript_delta`, flushed to recorder + log on `assistant_done` (same per-turn granularity + recorder push the old `.done` handler produced).

### d. orchestrator + boot

- `ProviderKind` opened to `"stt" | "llm" | "tts" | "realtime"`; `ProviderFor<"realtime"> = RealtimeProvider`; registry's backing `Record` gained a `realtime` map.
- `defaultRegistry()` registers `realtime`/`openai` when `config.openaiApiKey` is set (matching Wave A's stt/llm/tts pattern — registration stays in `defaultRegistry`, which boots lazily on first `createOrchestrator`/`/api/providers` access; refactor #9's "move to index.ts" remains deferred). This is where boot logs `orchestrator: registered realtime provider "openai"`.
- `OrchestratorOptions.realtimeClientFactory` → `realtimeProviderFactory?: () => Promise<RealtimeProvider>`; default resolves `"openai"` from the registry. `RealtimePipelineDeps.realtimeClientFactory` → `realtimeProvider: RealtimeProvider`. The orchestrator resolves the provider in `pick()` and hands the instance to `RealtimePipeline` — same shape as STT/LLM/TTS.
- `GET /api/providers` now lists `realtime` (Wave A explicitly deferred `kind=realtime` to Wave B). No-kind response is now `{stt, llm, tts, realtime}`.

## Step 2 — Refactor #14: stub-backed pipeline test

Commit `fc1854b`. Tests after: **140 / 0** (+6 new).

New `tests/pipeline/realtime.test.ts`. A `StubRealtimeProvider` implements the neutral `RealtimeProvider`, emits canned `RealtimeEvent`s, and drives the pipeline. **The file imports nothing from `src/realtime/openai.ts`** — the proof the seam is real and the openai SDK never loads. Cases:

1. **open + immediate close** — provider opens exactly one session; discuss path pushes one `updateSession` (instructions + tools); `close()` tears the session down and is idempotent.
2. **user_transcript_complete → history append** — dictate intent, empty donePrompt; asserts `listHistory({deviceId})` gets the entry with `rawText="hello world"`, `processedText=null`, and the connection sees the `transcript` event.
3. **function_call → right tool** — registers a `StubToolSource("fnstub")`; emits `function_call{name:"fnstub__echo"}`; asserts the prefix-stripped call reached `echo` with the args AND the result returned over the seam keyed to `call_1`.
4. **assistant_audio → speaker** — the exact `Buffer` reaches `cb.sendSpeaker` at 24 kHz.
5. **error → teardown** — error is forwarded to the connection AND `cb.close()` fires once.
6. **user_speech_start/stop → connection events** (bonus) — maps to `user_speech_start` / `user_speech_end`.

## Smoke (final, after Step 2)

- `bun test`: **140 / 0** (was 134; +6).
- `bun run check` (biome over `src tests`): clean.
- `bunx tsc --noEmit -p tsconfig.json`: clean (the pre-existing `bun-types` TS2688 from Wave A is unchanged and out of scope).
- `bunx tsc -p clients/app/tsconfig.json --noEmit`: exit 0.
- Daemon boot (`bun src/index.ts`): logs `orchestrator: registered realtime provider "openai"` and `listening on :8765`. `GET /api/providers` → `{"stt":[],"llm":["openai"],"tts":[],"realtime":["openai"]}`; `?kind=realtime` → `{"kind":"realtime","providers":["openai"]}`.
- UI: Step 1/2 touched zero UI files. `packages/ui` typecheck has pre-existing `.native.tsx` `NativeEventEmitter` TS2344 errors unrelated to this work (present before Wave B).

## Notes / deltas

1. **`updateSession` retained on the session interface** despite not being in the brief's explicit method list — it's the pre-existing lifecycle hook that pushes composed instructions + tools after context gather, and dropping it would have forced gather to run before `open()` (losing the handshake/gather overlap `start()` is built around). Documented in `types.ts`.
2. **`error` now tears down.** Old code only tore down on socket close; the neutral seam has no socket, so the adapter maps unexpected close → `error`, and the pipeline's `error` arm tears down. Net effect matches the brief ("error event surfaces to teardown") and preserves close-driven teardown.
3. **Assistant transcript** moved from `.done` (full string) to `.delta` accumulation + flush on `assistant_done`. The SDK does emit `response.output_audio_transcript.delta` (verified in `node_modules/openai`); recorder push + log are unchanged in effect.
4. **`commitInput()` / `sendAssistantStart()`** are implemented in the adapter (`input_audio_buffer.commit` / `response.create`) but unused by the pipeline today — OpenAI drives turns via semantic_vad. They're part of the contract so a turn-based provider can be driven through the same seam.
5. **Registration stays in `defaultRegistry()`** (orchestrator), not `index.ts`. That's Wave A's pattern; moving all registration to `index.ts` is refactor #9, still deferred. Boot still logs the registration because `createOrchestrator()` (and thus `getDefaultRegistry()`) runs at module load via `audio_io/route.ts`.
6. **Test disk writes**: the history/transcript/recorder writes in the new test land in the local dev data dir (`~/.local/share/voix-backend/voix/`), same as the daemon in dev. History assertions read the in-memory store (filtered by a per-test random `deviceId`), so they don't depend on disk.

## Cost summary
- Wall-clock: ~55 min (well under the 150 min budget).
- Commits: 2 (one per step, in order, pushed after each).
- Files modified: 6 (1 new: `tests/pipeline/realtime.test.ts`).
- Tests: 134 → 140 (+6 new). No existing tests changed (the refactor preserved every public behaviour the orchestrator/discuss/connection tests assert).
