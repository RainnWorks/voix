# M-Arch Wave A implementer report
Status: SUCCESS

Wall-clock: ~85 min. Five commits, all green on `bun test` + `bun run check` + UI build + clients/app typecheck + daemon boot smoke.

## Receipts

### Files modified (stat: mtime  size  path)
```
1780255751   1887  voix-backend/src/api/providers.ts                    [new]
1780255759   3865  voix-backend/src/index.ts
1780255698   6886  voix-backend/src/voices/types.ts
1780256015   5420  voix-backend/src/pipeline/types.ts
1780256225  13868  voix-backend/src/pipeline/orchestrator.ts
1780256306  18762  voix-backend/src/pipeline/realtime.ts
1780256115  10947  voix-backend/src/pipeline/dictate_traditional.ts
1780256134  19930  voix-backend/src/pipeline/discuss_traditional.ts
1780255724   4160  voix-backend/src/pipeline/providers/llm/index.ts
1780255888   5084  voix-backend/src/context/types.ts
1780255896   4275  voix-backend/src/context/sources/voix.ts
1780255906   8476  voix-backend/src/context/sources/ha.ts
1780255918   8772  voix-backend/src/realtime/openai.ts
1780256163  14649  voix-backend/src/audio_io/connection.ts
1780256171   3552  voix-backend/src/audio_io/route.ts
1780256235   9940  voix-backend/tests/pipeline/orchestrator.test.ts
1780256260  14830  voix-backend/tests/pipeline/discuss_traditional.test.ts
1780256251  11240  voix-backend/tests/audio_io/connection.test.ts
1780256595   8889  voix-backend/tests/voices/migration.test.ts
1780256383   6798  packages/ui/src/lib/api.ts
1780256403   3058  packages/ui/src/lib/useProviders.ts             [new]
1780256457  33065  packages/ui/src/voices/VoiceEditor.tsx
```

### git log --oneline -10
```
dfb1bd6 voices(M-Arch #15): migration pass-through test for refactored types (Arvid audit)
1986201 ui(M-Arch #13): voice editor queries /api/providers (Arvid audit)
88d2fe5 pipeline(M-Arch #5): drop PipelineStart.openaiApiKey vendor leak (Arvid audit)
8c1ac1b docs(M24): m24-manual.md + STATE close-out + implementer report  [M24 parallel]
d23c51c context(M-Arch #4): neutral ToolSpec; OpenAiRealtimeToolSpec is the legacy shape (Arvid audit)
f24ea11 pipeline(M-Arch #2): provider registry + GET /api/providers; drop closed enums (Arvid audit)
f96b5de clients/app(M24): return polling + timeout + insertText + cleanup  [M24 parallel]
0560024 clients/app+ui(M24): KeyboardCaptureScreen + auto-capture + return bridge  [M24 parallel]
2bf29f9 docs(architecture): Arvid LLM swappability audit + M-Arch dispatched
2ca214d clients/app(M24): keyboard UI — pill + onboarding + Full Access gate  [M24 parallel]
```

The three M24 commits were the parallel implementer — no overlap with the M-Arch files.

## Per-step

### Step 1 — Refactor #2 (provider registry + open enums)

Commit `f24ea11`. Tests after: **129 pass, 0 fail** (was 126; +3 = `unknown STT provider → typed UnknownProviderError`, `register/list round-trip`, `get returns factory / unknown name → undefined`).

Smoke output:
- `bun test`: 129 / 0
- `bun run check`: clean
- UI build: 583 ms
- Boot: `orchestrator: registered llm provider "openai"` → `listening on :8765`
- `curl /api/providers` → `{"stt":[],"llm":["openai"],"tts":[]}`
- `curl /api/providers?kind=zzz` → 400 `{"error":"unknown provider kind \"zzz\""}`

Key changes:
- New `ProviderRegistry` interface with typed `register<K>`/`get<K>`/`list`.
- `defaultRegistry()` registers only providers whose API key is present at boot — missing-key errors fire at boot, not session-start.
- `UnknownProviderError` class — typed, callers can `instanceof`-check.
- `voice.postProcessProvider` opens from `"openai" | "openrouter"` to `string`.
- `pipeline/providers/llm/index.ts`: `ProviderName = string`; `PostProcessKeys` is open-shaped with legacy slots preserved.
- New `GET /api/providers[?kind=stt|tts|llm]` endpoint.

### Step 2 — Refactor #4 (neutral ToolSpec)

Commit `d23c51c`. Tests after: 129 / 0 (unchanged — refactor is pure rename + adapter).

Key changes:
- `context/types.ts`: `ToolSpec` becomes `{name, description?, inputSchemaJson, __source?}`; the legacy OpenAI shape moves to `OpenAiRealtimeToolSpec`.
- `realtime/openai.ts`: new `toOpenAiTool(spec: ToolSpec): RealtimeFunctionTool` adapter (also drops `__source`).
- `pipeline/realtime.ts`: drops `stripInternalSourceField`; calls `tools.map(toOpenAiTool)` at the provider boundary.
- `context/sources/voix.ts` + `context/sources/ha.ts`: emit the neutral shape directly. HA's MCP `inputSchema` round-trips verbatim through `inputSchemaJson`.

Per the brief: Wave A intentionally STOPS at translating tool shape; the realtime event seam (refactor #1) is Wave B.

### Step 3 — Refactor #5 (drop PipelineStart.openaiApiKey)

Commit `88d2fe5`. Tests after: 129 / 0.

Key changes:
- `pipeline/types.ts`: `PipelineStart.openaiApiKey` dropped.
- `pipeline/realtime.ts`: new `RealtimePipelineDeps {realtimeClientFactory, postProcessKeys}`; constructor takes deps; client built via factory (not `new OpenAIRealtimeClient(this.s.openaiApiKey, …)`).
- `pipeline/dictate_traditional.ts`: `TraditionalDictateDeps.postProcessKeys`; done-phase reads from `deps.postProcessKeys`.
- `pipeline/discuss_traditional.ts`: drops unused `config` import + `void config` stub (the talking-phase `llmProvider` is the only LLM dep needed; key binding is the orchestrator's job).
- `pipeline/orchestrator.ts`: new `OrchestratorOptions {realtimeClientFactory, postProcessKeys}` with defaults reading from `config` at boot; `createOrchestrator(registry, options)`.
- `audio_io/connection.ts` + `audio_io/route.ts`: drop `ConnectionDeps.openaiApiKey`.
- Tests: drop `openaiApiKey: "k"` from every `PipelineStart` construction (orchestrator, discuss_traditional, connection).

Picked design (a) from the brief: closure injected via deps (matches stt/tts/llm pattern). Wave B will collapse the realtime closure into a registry lookup.

### Step 4 — Refactor #13 (voice editor queries /api/providers)

Commit `1986201`. Tests after: 129 / 0 (UI). UI build clean: 672 ms.

Key changes:
- `packages/ui/src/lib/api.ts`: `ProviderKind` + `providersApi.list(kind)`; `Voice.postProcessProvider` opens to `string`.
- `packages/ui/src/lib/useProviders.ts` (new): module-cached hook with `{providers, loading, error}` return.
- `packages/ui/src/voices/VoiceEditor.tsx`: new `ProviderSegmented<kind>` helper replaces the hardcoded options at lines 343-352, 415-423, 639-650.
- Empty-registry case rendered as a "No providers configured — add an API key in Add-on options" hint; loading shows ActivityIndicator; error surfaces inline. If the voice's current value isn't in the registry it's still rendered as the first option (so users don't silently lose state when an API key gets removed).
- `PROVIDER_LABELS` map preserves the friendly labels ("OpenAI", "Deepgram", …) the old hardcoded arrays carried; unknown names fall back to the raw name string.

### Step 5 — Refactor #15 (voices.json migration test)

Commit `dfb1bd6`. Tests after: **134 pass, 0 fail** (+5 new).

Key changes:
- `voix-backend/tests/voices/migration.test.ts`: new describe block `M-Arch Wave A #15 — pre-Wave-A voices.json pass-through` covering:
  1. `postProcessProvider="openai"` round-trips through `normalisePhasePrompts`.
  2. `postProcessProvider="openrouter"` round-trips.
  3. New open-shape names (`"anthropic"`) round-trip — load-bearing for "new provider = boot-time registration, not type edit".
  4. End-to-end disk → `loadVoices()` → `listVoices()` → persisted disk file preserves all three provider names.
  5. Edge cases: no-tone-field record + empty-string `sttProvider` (both legal pre-Wave-A) pass through `normalisePhasePrompts` unchanged.

The brief said "(new)" but `migration.test.ts` already existed (M02 file-rename test). I added a new describe block rather than create a duplicate file — keeps the M02 migration coverage adjacent to the Wave A pass-through coverage.

## Tests added
1. `tests/pipeline/orchestrator.test.ts`:
   - `unknown STT provider name → UnknownProviderError (typed)`
   - `provider registry: register + list reflects registered providers`
   - `provider registry: get returns the registered factory; unknown name returns undefined`
2. `tests/voices/migration.test.ts` (M-Arch Wave A #15 block, 5 tests):
   - `postProcessProvider='openai' round-trips through normalisePhasePrompts`
   - `postProcessProvider='openrouter' round-trips through normalisePhasePrompts`
   - `post-Wave-A open shape: arbitrary provider name (e.g. 'anthropic') round-trips`
   - `disk → load → disk: file contents on the way back out match the input record`
   - `normaliseTone / normalisePhasePrompts don't reject pre-Wave-A nulls/empties`

Total: +8 new test cases. 126 → 134 pass.

## Tests changed
1. `tests/pipeline/orchestrator.test.ts`: rewritten to use `createProviderRegistry()` + `register("stt", "deepgram", …)` instead of the old `{stt: async () => stub}` bundle. Selection / lifecycle / early-mic-cap assertions unchanged.
2. `tests/pipeline/discuss_traditional.test.ts`: dropped `openaiApiKey: "k"` from the `PipelineStart` literal (one line).
3. `tests/audio_io/connection.test.ts`: dropped 14 instances of `openaiApiKey: "k",` from `ConnectionDeps` literals (mechanical).

All other behaviour assertions preserved.

## Deltas surfaced (issues not anticipated by brief)

1. **`bun run typecheck` is broken pre-Wave-A** — `error TS2688: Cannot find type definition file for 'bun-types'`. Reproduced on `main` before my changes (verified via `git stash`); `voix-backend/tsconfig.json` declares `"types": ["bun-types"]` but the installed package is `@types/bun`. Not in scope; flagged for follow-up. All other smoke commands (`bun test`, `bun run check`, UI build, clients/app typecheck, daemon boot) pass.
2. **`voix-backend/test-debug.ts`** present as an untracked file — not from this work; left alone.
3. **M24 implementer is committing in parallel** (3 commits interleaved). No file overlap; no rebase needed.
4. **`realtimePipelineFactory()` was dead code** at the bottom of `pipeline/realtime.ts` — orphan from a pre-orchestrator design. Removed during step 3 since adapting it for the new deps shape would be cruft.
5. **`useProviders` cache is process-global** by design; included `_resetProvidersCache()` as a test-only escape hatch but no test currently uses it (the cache pattern survives the editor's lifetime as the brief described). Left in for future test usage.
6. **Default registry boots LLM 'openai' but NOT 'openrouter'** in the dev `.env` shown by `bun src/index.ts` — `openrouterApiKey` is `undefined` in that env, so the factory is correctly never registered. The post-process facade still falls back to raw text if a voice picks 'openrouter' with no key, matching the pre-existing graceful-failure design.

## Wave B prerequisites met
- Registry exposes realtime kind? **N** — by design. Realtime stays out of the registry until Wave B's load-bearing seam lands. The `ProviderKind` union is `"stt" | "llm" | "tts"`; `/api/providers` returns 400 for any other kind. Comment in `orchestrator.ts` line 51-52 calls this out: `// Realtime is Wave B (the seam isn't load-bearing yet)`.
- ToolSpec is neutral? **Y** — `context/types.ts:ToolSpec = {name, description?, inputSchemaJson}`. Adapters live in `realtime/openai.ts:toOpenAiTool`. Wave B's neutral RealtimeProvider can consume these directly.
- PipelineStart no longer carries openaiApiKey? **Y** — `pipeline/types.ts:PipelineStart` is vendor-neutral. The OpenAI key lives in `OrchestratorOptions.realtimeClientFactory`'s closure; Wave B will swap that closure for a registry lookup.

## Cost summary
- Wall-clock: ~85 min (well under the 150 min budget).
- Commits: 5 (one per step, in order).
- Files modified: 22 (2 new: `voix-backend/src/api/providers.ts`, `packages/ui/src/lib/useProviders.ts`).
- Tests: 126 → 134 (+8 new; 17 existing tests touched for the deps-shape change, all preserved behaviour).
