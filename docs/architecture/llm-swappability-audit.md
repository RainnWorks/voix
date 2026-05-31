# LLM swappability audit — Arvid
Date: 2026-05-31

## Receipts

Files read (mtime / size / path):

```
1780072916  4781  voix-backend/src/pipeline/providers/llm/chat_completions.ts
1780067362  2712  voix-backend/src/pipeline/providers/llm/index.ts
1780067362   463  voix-backend/src/pipeline/providers/llm/openai.ts
1780067362   733  voix-backend/src/pipeline/providers/llm/openrouter.ts
1780072916  2516  voix-backend/src/pipeline/providers/llm/types.ts
1780073270  3480  voix-backend/src/pipeline/providers/realtime/types.ts
1780067515  7417  voix-backend/src/pipeline/providers/tts/aura.ts
1780067515  3387  voix-backend/src/pipeline/providers/tts/types.ts
1780067170  8245  voix-backend/src/pipeline/providers/stt/deepgram.ts
1780067170  3805  voix-backend/src/pipeline/providers/stt/types.ts
1780174001  7926  voix-backend/src/pipeline/orchestrator.ts
1780174001  5570  voix-backend/src/pipeline/types.ts
1780174001 18065  voix-backend/src/pipeline/realtime.ts
1780067802 10686  voix-backend/src/pipeline/dictate_traditional.ts
1780174001 19825  voix-backend/src/pipeline/discuss_traditional.ts
1779959779  4076  voix-backend/src/context/registry.ts
1779959759  3830  voix-backend/src/context/types.ts
1779969310  8340  voix-backend/src/context/sources/ha.ts
1779968079  4156  voix-backend/src/context/sources/voix.ts
1780250509  6433  voix-backend/src/voices/types.ts
1780226222  9648  voix-backend/src/audio_io/protocol.ts
1780174001 14607  voix-backend/src/audio_io/connection.ts
1780057498  1853  voix-backend/src/history/types.ts
1779970051  8193  voix-backend/src/realtime/openai.ts
1780067170  3955  voix-backend/src/env.ts
1780129498  3787  voix-backend/src/index.ts
1780253301 31486  packages/ui/src/voices/VoiceEditor.tsx
1780226228  9652  packages/protocol/src/audio-io.ts
1780174001 14853  voix-backend/tests/pipeline/discuss_traditional.test.ts
1780174001       voix-backend/tests/pipeline/orchestrator.test.ts
1780174001       voix-backend/tests/pipeline/providers/llm/chat_completions.test.ts
1780174001       voix-backend/tests/pipeline/providers/stt/deepgram.test.ts
1780174001       voix-backend/tests/pipeline/providers/tts/aura.test.ts
```

Total lines audited: **7,067** (sum of `wc -l` across the above).

Dependency graph (concrete imports across the LLM surface):

```
audio_io/route ─► audio_io/connection ─► pipeline/types (interface only)
                                       │
                                       └► PipelineFactory  ─► orchestrator
                                                              │
                                                              ├► createOpenAiProvider (concrete)
                                                              ├► createOpenRouterProvider (concrete)
                                                              ├► createDeepgramProvider (concrete)
                                                              ├► createAuraProvider (concrete)
                                                              ├► TraditionalDictatePipeline (concrete)
                                                              ├► TraditionalDiscussPipeline (concrete)
                                                              └► RealtimePipeline (concrete) ─► OpenAIRealtimeClient (concrete)
                                                                                                │
                                                                                                └► openai SDK + openai/resources/realtime
context/registry ─► HAContextSource + VoixContextSource (concrete, OK — singletons)
pipeline/realtime.ts ─► postProcess facade ─► (openai|openrouter) factory
pipeline/{dictate,discuss}_traditional ─► postProcess facade
pipeline/providers/realtime/types.ts ─► openai/resources/realtime (TYPE LEAK)
```

## Executive verdict

**STT and TTS are genuinely swappable; LLM (chat) is swappable with one
day of work; Realtime is not swappable at all.** The provider
interfaces under `pipeline/providers/{stt,tts,llm}` are clean, well
factored, and have substitutable tests — for those three a new
provider can be added by writing one file plus three lines in
`orchestrator.ts::defaultProviders`. The realtime path, by contrast,
is OpenAI-shaped end-to-end: `pipeline/realtime.ts:151` constructs
`OpenAIRealtimeClient` directly, the "provider interface" at
`pipeline/providers/realtime/types.ts:26` imports OpenAI SDK types in
its signatures, and the pipeline reaches into `client.rt.on(...)` with
provider-specific event names at `pipeline/realtime.ts:309-378`. The
done-phase LLM is also locked to a 2-value closed union
(`postProcessProvider: "openai" | "openrouter"` at
`voices/types.ts:109`) which is wrong shape for a registry but right
shape for an OpenAI-compatible HTTP class.

## Score matrix

Scoring 1–5 per dimension. Higher is better (more swappable / more
provider-agnostic). One-word evidence in brackets.

| Surface  | 1 Interface min | 2 Dep direction | 3 Config coupling | 4 Cross-cut | 5 Data shape | 6 Streaming | 7 Errors | 8 Tools port | 9 Test sub | 10 30-min rule |
|----------|-----------------|-----------------|-------------------|-------------|--------------|-------------|----------|--------------|------------|----------------|
| LLM (chat) | 5 (tiny) | 4 (orchestrator concrete factories) | 2 (5 sites) | 3 (per-impl timeout) | 5 (neutral) | 1 (none) | 4 (Error throw) | n/a (no tools) | 5 (stub) | 4 (3h) |
| STT      | 5 (clear)       | 5 (interface)   | 3 (4 sites)       | 3 (per-impl) | 5 (neutral)  | 5 (event union) | 5 (typed)    | n/a          | 5 (stubFactory) | 4 (4h) |
| TTS      | 5 (clear)       | 5 (interface)   | 3 (4 sites)       | 3 (per-impl) | 5 (neutral)  | 5 (event union) | 5 (typed)    | n/a          | 5 (stubFactory) | 4 (4h) |
| Realtime | 1 (SDK leak)    | 1 (concrete)    | 1 (>10 sites)     | 1 (in-pipe)  | 1 (RealtimeFunctionTool) | 1 (rt.on) | 2 (raw)  | 1 (OAI tool shape) | 1 (no test) | 1 (3d+) |
| Context  | 4 (good)        | 5 (registry)    | 2 (boot wiring)   | 4 (per-source timeout) | 3 (ToolSpec=OAI) | n/a | 4 (ToolResult) | 2 (OAI shape) | 4 (impl-trivial) | 3 (1d) |

Notes on the matrix:

- **Cross-cutting (col 4)**: timeouts live inside each LLM impl
  (`chat_completions.ts:19` hardcoded `TIMEOUT_MS=20_000`). STT has
  `CONNECT_TIMEOUT_MS` inside `ha.ts:43`, none in deepgram.ts. Aura has
  none. There is no shared retry / rate-limit / observability layer.
- **Streaming (col 6)**: the LLM interface at
  `pipeline/providers/llm/types.ts:55-62` is one-shot only — no
  `stream()` method. This will hurt when the Anthropic / Gemini swap
  happens because those providers shine when streaming.
- **Tools (col 8)**: `context/types.ts:40-48` `ToolSpec` literally is
  the OpenAI function-call shape. A non-OpenAI realtime provider
  cannot accept this without translation. See refactor #4.

## The strongest seams (where swap-out IS clean)

- **`SttProvider` + `SttSession` (`pipeline/providers/stt/types.ts:62-84`)**.
  Open → push PCM → subscribe to a 4-variant `SttEvent` union → close.
  Deepgram-specific shape (`is_final`, `speech_final`) is mapped to
  `{ type: "final", isEndpoint: boolean }` inside `parseDeepgramMessage`
  (`stt/deepgram.ts:81-113`) — no leak across the boundary.
- **`TtsProvider` + `TtsSession` (`pipeline/providers/tts/types.ts:55-80`)**.
  Same shape, same hygiene: `speak / flush / finish / close`, a 4-variant
  event union, parse Aura envelopes inside the impl
  (`tts/aura.ts:68-95`).
- **Injectable WS factory pattern** (`stt/deepgram.ts:213-241`,
  `tts/aura.ts:207-234`). Tests construct providers with stub WS
  factories — no monkey-patching globals. This is the strongest
  test-substitutability of any surface.
- **`OrchestratorProviders` factory bundle**
  (`pipeline/orchestrator.ts:44-91`) decouples provider construction
  from orchestrator logic. Tests pass `{ stt: async () => stub }` and
  exercise the picker without touching credentials.
- **`Pipeline` interface (`pipeline/types.ts:110-124`)**. Clean — no
  provider-shaped concepts leak; just `start / pushMic /
  readyForInput / bargeIn / close`. Both `TraditionalDictatePipeline`
  and `RealtimePipeline` satisfy it.

## The weakest seams (where swap-out leaks)

- **`RealtimePipeline` directly constructs `OpenAIRealtimeClient`** at
  `pipeline/realtime.ts:151`. The "Realtime provider interface" at
  `pipeline/providers/realtime/types.ts:71-77` is documentation, not a
  load-bearing seam — nothing depends on it. Comments
  (`pipeline/providers/realtime/types.ts:7-9`) even admit this: "today
  the only impl is `src/realtime/openai.ts`; this file is the shape
  we'd target if/when a second realtime provider lands."
- **`RealtimeProviderSessionConfig.tools` is typed as
  `RealtimeFunctionTool[]`** (`pipeline/providers/realtime/types.ts:47`),
  imported from `openai/resources/realtime/realtime`. The "abstraction"
  imports the SDK's type. A Gemini-Live impl would have to translate
  this on its side — which is the exact "abstraction theatre"
  failure mode this audit was commissioned to find.
- **`RealtimePipeline.wireRealtimeEvents` (`pipeline/realtime.ts:305-381`)**
  subscribes to OpenAI-specific event names directly: `rt.on(
  "input_audio_buffer.speech_started", …)`, `rt.on(
  "conversation.item.input_audio_transcription.delta", …)`,
  `rt.on("response.output_audio.delta", …)`. The provider-types file
  (`pipeline/providers/realtime/types.ts:14-19`) defends this:
  "subscribers reach the typed emitter via `client.rt.on(...)` and get
  the SDK's exact event type back." That's a euphemism for "no
  translation layer exists." When the second realtime provider lands,
  THIS code needs to fork.
- **`Voice.postProcessProvider: "openai" | "openrouter"`**
  (`voices/types.ts:109`). Closed union. Adding a third provider
  requires editing the type and every place that reads it. The
  `ProviderName` mirror at `pipeline/providers/llm/index.ts:22` makes
  the same closed-union assumption.
- **`PipelineStart.openaiApiKey`** at `pipeline/types.ts:93`. A
  *pipeline interface field* named for a specific vendor. Cross-cutting
  data named "openaiApiKey" travels through `connection.ts:267`,
  `realtime.ts:151`, `dictate_traditional.ts:260` and
  `discuss_traditional.ts`. It's not even renamed inside the pipelines
  ("`this.s.openaiApiKey`" in `realtime.ts:151`).
- **Done-phase keys threaded by field name**
  (`pipeline/realtime.ts:410`, `dictate_traditional.ts:260`):
  `keys: { openai: this.s.openaiApiKey, openrouter: config.openrouterApiKey }`.
  Adding Anthropic for done-phase = touch this struct in three places.
- **`context/types.ts:40` `ToolSpec.type === "function"`** is the
  OpenAI shape — `{ type, name, description, parameters }`. The HA MCP
  source ships its native JSON Schema through unchanged
  (`context/sources/ha.ts:108-118`); good. The voix builtin source
  (`context/sources/voix.ts:51-71`) writes the OpenAI shape directly.
  Anthropic uses `{ name, description, input_schema }`, Gemini uses
  `{ name, description, parameters }` with a different schema dialect.
  A non-OpenAI realtime provider would have to translate ToolSpec
  inside its impl.
- **`history/types.ts:30` `modeType: "realtime" | "dictation"`** —
  another closed union baking the current implementation choice into
  the persistent format.
- **`pipeline/realtime.ts:282-303` `buildRealtimeConfig`** hard-codes
  OpenAI model names (`"gpt-realtime-2"`,
  `"gpt-4o-mini-transcribe"`) as defaults inside the pipeline. The
  voice's `model` field is the user-overridable knob, but the fallback
  is OpenAI-shaped. This is fine while OpenAI Realtime is the only
  realtime; it becomes a bug at the moment a second realtime provider
  is added without changing this file.
- **Orchestrator closed enum at `pipeline/orchestrator.ts:170`**:
  `if (voice.sttProvider === "deepgram")` is the discriminator for
  "use TraditionalDictatePipeline vs RealtimePipeline." This is the
  wrong axis — the right axis is "is this STT provider streaming-only
  (use traditional) or bundled with a realtime model (use realtime)."
  When ElevenLabs streaming STT lands tomorrow, the test
  `=== "deepgram"` fails open into the OpenAI realtime path. This will
  silently bill the wrong vendor.
- **No real Realtime provider interface in use anywhere**: grep proves
  it. `RealtimeProvider` (type) appears only in the types file itself;
  no `import type { RealtimeProvider }` in the codebase. Dead
  documentation.

## Concrete refactors, in priority order

1. **Make the Realtime provider seam load-bearing.** ~6h.
   - File: rewrite `pipeline/providers/realtime/types.ts` so it owns a
     **neutral** event union (e.g. `RealtimeEvent =
     { type: "user_speech_start" } | { type: "user_transcript_delta", text: string }
     | { type: "assistant_audio", pcm: Buffer } | { type: "function_call", callId, name, argsJson }
     | { type: "error", message: string }`).
   - Delete the `import type { RealtimeFunctionTool }` line at
     `pipeline/providers/realtime/types.ts:26`.
     `RealtimeProviderSessionConfig.tools` becomes
     `tools?: NeutralToolSpec[]` (a flat `{ name, description, jsonSchema }`).
   - `OpenAIRealtimeClient` in `realtime/openai.ts` adapts to a
     `RealtimeProvider` impl: translate inbound SDK events → neutral
     events; translate outbound neutral tool specs → `RealtimeFunctionTool`.
   - `RealtimePipeline.wireRealtimeEvents` (`pipeline/realtime.ts:305-381`)
     becomes a switch on the neutral event union; the OpenAI-specific
     names disappear from the pipeline file.
   - Test: write a `StubRealtimeProvider` that emits canned neutral
     events; cover transcript-complete + function-call + barge-in
     branches. Should not need the openai SDK loaded.

2. **Reshape provider selection so it's not a closed enum.** ~3h.
   - File: `pipeline/orchestrator.ts:44-91`. Replace
     `OrchestratorProviders.stt(name: string)` with a registry pattern:
     `register(kind: "stt", name: string, factory: () => Promise<SttProvider>)`.
     Boot in `index.ts` calls `register("stt", "deepgram", ...)`,
     `register("llm", "openai", ...)`, etc.
   - `voices/types.ts:109` `postProcessProvider: "openai" | "openrouter"`
     becomes `postProcessProvider: string`. The voice editor's
     `Segmented` control at `VoiceEditor.tsx:639-644` queries the
     registry for available providers via a new
     `GET /api/providers?kind=llm` endpoint.
   - Boot-time registration is the only place a new provider name
     touches.
   - Test: orchestrator picks the right factory; unknown names throw a
     typed error not a string-includes test.

3. **Pull cross-cutting concerns into a wrapper layer.** ~4h.
   - File: new `pipeline/providers/common/with_telemetry.ts`. Wrap any
     `LlmProvider` / `SttProvider` / `TtsProvider` in a decorator that
     enforces the timeout, counts retries, logs latency, and emits
     OpenTelemetry-shaped spans.
   - Move the `TIMEOUT_MS = 20_000` from
     `chat_completions.ts:19` and the `CONNECT_TIMEOUT_MS = 5000` from
     `context/sources/ha.ts:43` into config + the decorator.
   - The four current impls drop ~20 LOC each because they no longer
     need to think about timeouts / structured logging.
   - Test: decorator throws on timeout, emits exactly one telemetry
     line per call regardless of provider.

4. **Translate `ToolSpec` to a neutral shape.** ~3h.
   - File: `context/types.ts:40-48`. Rename current `ToolSpec` to
     `OpenAiRealtimeToolSpec`; introduce `ToolSpec = { name, description,
     inputSchemaJson: Record<string, unknown> }`.
   - `RealtimePipeline` (or its replacement) translates to the
     provider's native tool shape inside the provider boundary.
   - `pipeline/realtime.ts:81-84` `stripInternalSourceField` becomes
     unnecessary; the OpenAI adapter does the translation.
   - Test: HA's JSON Schema round-trips through; an Anthropic adapter
     can build `input_schema` from `inputSchemaJson`.

5. **Rename `PipelineStart.openaiApiKey` → drop it entirely.** ~1h.
   - File: `pipeline/types.ts:93`. The pipeline shouldn't know about
     OpenAI specifically. Provider construction is already centralised
     in the orchestrator; that's where API keys belong.
   - `pipeline/realtime.ts:151` constructs `OpenAIRealtimeClient(this.s.openaiApiKey, ...)`
     directly today — this becomes "construct via the realtime provider
     factory" once refactor #1 lands.
   - The done-phase keys struct at `pipeline/realtime.ts:410` and
     `dictate_traditional.ts:260` becomes a `keys` registry the
     orchestrator owns.
   - Test: pipelines instantiate without `openaiApiKey` on `PipelineStart`.

6. **Stream the LLM.** ~6h.
   - File: `pipeline/providers/llm/types.ts:55-62`. Add a sibling
     interface:
     ```ts
     export interface StreamingLlmProvider extends LlmProvider {
       completeStream(req: LlmRequest): AsyncIterable<{ delta: string }>;
     }
     ```
     and a TypeScript guard `isStreamingLlmProvider(p: LlmProvider)`.
   - `discuss_traditional.ts:runAssistantTurn` (`383-430`) becomes
     "push deltas to TTS as soon as they arrive" when the provider
     supports it. Today it `await`s the full text then `tts.speak()` —
     that's a wasted half-second of latency every turn.
   - Test: stubbed streaming provider yields three deltas; TTS sees
     three `speak` calls before LLM resolves.

7. **Unify the done-phase + talking-phase LLM calls.** ~2h.
   - `discuss_traditional.ts:460-466` calls `llmProvider.complete({...})`
     with the talking-phase provider for the done-phase. That's a
     coincidental coupling — the done-phase deserves its own provider
     pick because a user might want cheap chat (Llama 3.1 via OpenRouter)
     for talking but premium (Claude Sonnet) for done-phase artifact
     production.
   - File: introduce `voice.donePhaseProvider` + `voice.donePhaseModel`
     in `voices/types.ts`. Today the done-phase reuses
     `postProcessProvider/postProcessModel` because they're the same
     field used by the dictate done-phase. Either reshape the voice
     schema so it has explicit `talking` / `done` provider+model pairs,
     or be honest about reusing them and document it.
   - Test: setting different providers for talking vs done routes the
     calls correctly.

8. **Fix the orchestrator's provider-selection discriminator.**
   ~2h. `pipeline/orchestrator.ts:170` checks
   `voice.sttProvider === "deepgram"` to decide between dictate
   pipelines. The correct axis is a property of the STT provider, not
   its name. Add `SttProvider.kind: "streaming-cheap" | "bundled-realtime"`
   (or similar) and switch on that. As-is, adding an ElevenLabs streaming
   STT impl falls through to `RealtimePipeline` because the literal
   `=== "deepgram"` doesn't match.

9. **Move provider construction out of `index.ts`-implicit `defaultProviders()`.** ~2h.
   - File: `pipeline/orchestrator.ts:54-91`. `defaultProviders` is one
     giant switch on string. Each branch reads `config.xxxApiKey` and
     throws if missing.
   - Replace with explicit registration at boot
     (`voix-backend/src/index.ts`): the daemon decides "Deepgram is
     registered if `config.deepgramApiKey` is set," not the orchestrator.
   - Once registered, the orchestrator just queries the registry by
     name. Missing-key errors fire at boot (clear user surface), not
     at session-start (mid-conversation surprise).

10. **Type `Voice.discussEngine` to use the registry too.** ~1h.
    - `voices/types.ts:125` `discussEngine?: "realtime" | "traditional"`.
      This conflates two things: (a) what engine SHAPE does this voice
      use, and (b) which provider runs it. Today they happen to be
      isomorphic. Tomorrow Tom has Anthropic Realtime AND Gemini Live —
      both fit "realtime" shape but are different providers. Split into
      `discussShape: "streaming-llm" | "turn-based"` (the pipeline
      decision) + `realtimeProvider: string` (the provider pick under
      the realtime shape).

11. **Make `history/types.ts:30` `modeType` open.** ~30m.
    Closed union `"realtime" | "dictation"`. Open it to `string` (or a
    richer struct) so historical entries from yet-unimagined modes
    don't fail-to-parse.

12. **Document the realtime event lifecycle outside `realtime.ts`.**
    ~1h. After refactor #1 lands, write `pipeline/providers/realtime/EVENTS.md`
    listing the neutral events any impl must emit, in what order, and
    what the pipeline does with each. Without this, the next impl
    author reads `pipeline/realtime.ts:305-381` and re-invents an
    OpenAI-shaped event stream by accident.

13. **Voice editor surfaces a single provider field per kind.** ~2h.
    - `packages/ui/src/voices/VoiceEditor.tsx:343-352` hardcodes
      `[{ value: "openai-realtime", label: "OpenAI" }, { value: "deepgram", label: "Deepgram" }]`.
      Replace with a fetch to `GET /api/providers?kind=stt` (introduced
      in refactor #2). Same for the LLM provider segmented control at
      `VoiceEditor.tsx:639-650`.
    - This is the unit-of-change that turns "add provider" from a
      cross-package PR into a backend-only PR.

14. **Test that exercises a Voice through a stubbed Realtime provider.** ~2h.
    There is no `tests/pipeline/realtime.test.ts`. Every test
    explicitly notes "can't instantiate RealtimePipeline against real
    OpenAI" (`tests/pipeline/orchestrator.test.ts:111-121`). Until a
    realtime provider interface exists that admits a stub, this is the
    biggest test-coverage gap in the daemon. Refactor #1 unlocks this
    test; that test then prevents regressions to the seam.

15. **(Defer to #16 voices store) Audit the voices store for
    `postProcessProvider`-shaped persistence.** ~1h. The on-disk
    voices JSON keys provider literals; once refactor #2 opens the
    enum, a migration is needed to retain back-compat. Cheap because
    today's only values are "openai"/"openrouter" — write a
    pass-through migration test.

## What's done well

- **Three of the four provider surfaces (STT, TTS, LLM-chat) hit the
  textbook hexagonal-architecture mark.** Tiny interfaces, native
  event shapes translated INSIDE the impl, injectable factories for
  tests, no cross-cutting state leaking out. The `parseDeepgramMessage`
  (`stt/deepgram.ts:81`) and `parseAuraMessage` (`tts/aura.ts:68`)
  pure-function parsers are the cleanest version of "translate
  provider envelope to neutral event" I've seen in a TS codebase this
  size.
- **The fallback semantics for `postProcess` are explicit and
  defensible**: `pipeline/providers/llm/index.ts:47-78` returns raw
  text on any failure mode (missing key, HTTP error, empty completion).
  "Dictation never lost because the polisher flaked." This is
  production-grade error semantics and the right call.
- **Test stubs IMPLEMENT the interface only** — `StubSttProvider` /
  `StubLlmProvider` / `StubTtsProvider` in
  `tests/pipeline/discuss_traditional.test.ts:42-114` don't reach into
  any provider's internals. That's the test-substitutability bar; the
  STT / TTS / LLM surfaces actually clear it.

## The "yank test" results

- **Yank OpenAI → Anthropic in the dictate pipeline (chat
  done-phase)**.
  Touch:
  - `voices/types.ts:109` (extend or open the closed union)
  - `pipeline/providers/llm/anthropic.ts` (new — analog of `openai.ts`,
    ~30 LOC factory pointing at a `ChatCompletionsProvider` lookalike
    OR a separate impl because Anthropic's `/v1/messages` API isn't
    OpenAI-compatible — see caveat below)
  - `pipeline/providers/llm/index.ts:22,43-44` (add "anthropic" arm)
  - `pipeline/orchestrator.ts:65-79` (add factory branch)
  - `env.ts:60-67` (add `anthropicApiKey`)
  - `VoiceEditor.tsx:639-644` (add option)
  - `api.ts:52` (extend type)
  - `voices/builtins.ts` (potential default change)

  Caveat: Anthropic's API is `/v1/messages` not OpenAI-compatible
  `/v1/chat/completions`. `ChatCompletionsProvider` won't slot in
  — you write a fresh impl of `LlmProvider` that POSTs to
  `/v1/messages` and parses `content[0].text`. The interface itself
  (`LlmProvider.complete(LlmRequest): Promise<LlmResponse>`) holds
  up: `LlmRequest` has no OpenAI-isms, `LlmResponse` is just `{ text,
  usage? }`. Provider impl is ~80 LOC. Total: a day, mostly UI + type
  plumbing.

- **Yank Deepgram → Whisper for STT**. Touch:
  - `pipeline/providers/stt/whisper.ts` (new impl; OpenAI Whisper API is
    HTTP file-upload, not streaming — so the `SttSession` streaming
    contract doesn't fit and you'd buffer-then-send. Document this in
    the impl; the orchestrator's discriminator at `orchestrator.ts:170`
    needs to know this is not a streaming STT).
  - `pipeline/orchestrator.ts:55-64,170-176` (factory + selection)
  - `env.ts` (no change — already has `openaiApiKey`)
  - `VoiceEditor.tsx:344-353,415-423` (add option, two places)
  - `api.ts` (no change — `sttProvider: string` already)

  Caveat: Whisper isn't streaming; the existing pipelines assume
  streaming STT. Adding it requires either (a) a buffer-then-call
  adapter that emits a single final at the end, OR (b) admitting that
  the dictate pipeline shape doesn't fit. **Realistic effort: 4-6h
  for the buffered-Whisper case; 1-2 days if Tom wants
  ElevenLabs/Gladia/AssemblyAI streaming (cleaner — slots straight
  in).**

- **Yank Aura → ElevenLabs for TTS**. Touch:
  - `pipeline/providers/tts/elevenlabs.ts` (new, ~150 LOC mirroring
    `aura.ts`; ElevenLabs has WS streaming so the existing `TtsSession`
    fits)
  - `pipeline/orchestrator.ts:80-89` (factory branch)
  - `env.ts` (add `elevenLabsApiKey`)
  - `VoiceEditor.tsx` — note Tom comments at
    `VoiceEditor.tsx:383-388` "TTS provider + voice are deliberately
    hidden until there's a real second choice" — so the UI doesn't
    even show a TTS picker today. Add it.
  - `voices/types.ts:131-134` (`ttsProvider`, `ttsVoice` — already open
    strings, good)

  **Realistic effort: 4h.** Cleanest of the swaps. The TTS interface
  is the best part of the codebase.

- **Yank OpenAI Realtime → Gemini Live for the realtime pipeline**.
  Touch:
  - `pipeline/providers/realtime/types.ts` — REWRITE. The current
    "interface" imports `RealtimeFunctionTool` from `openai/resources/realtime`
    at line 26. The neutral-events-and-tools rewrite from refactor #1
    is a hard prerequisite.
  - `realtime/openai.ts` — rewrite as an adapter behind the new
    interface (translate SDK events → neutral events; translate
    neutral tool specs → SDK function tools).
  - `realtime/gemini.ts` — new; ~400 LOC because Gemini Live's WS
    protocol is structurally different (bidirectional `BidiGenerateContent`
    + native function-calling shape).
  - `pipeline/realtime.ts:151` — replace `new OpenAIRealtimeClient(...)`
    with `await providers.realtime(voice.realtimeProvider).open(cfg)`.
  - `pipeline/realtime.ts:305-381` — rewrite to consume neutral
    events. Every `rt.on("input_audio_buffer.speech_started", …)` etc.
    becomes a switch on a unified event union.
  - `voices/types.ts:82` (`model`) + `127` (`voice`) gain a
    `realtimeProvider` sibling field.
  - `audio_io/connection.ts:267` — drop the `openaiApiKey` plumbing
    (cf. refactor #5).
  - `pipeline/orchestrator.ts` — wire the new realtime factory.
  - `VoiceEditor.tsx:301-333` — add the realtime provider picker.

  **Realistic effort: 3+ days.** Most of which is refactor #1 paying
  itself back across two impls. If refactor #1 has landed first,
  the second realtime impl drops to ~1 day.

## Things to defer

- **A full Provider Registry with hot-reload + dynamic discovery.**
  voix has 2-3 impls per surface. A registry that supports plugin
  loading at runtime, hot-swap, version negotiation — premature.
  Refactor #2's registration-at-boot is sufficient. Revisit when
  there are ≥5 impls of any surface.

- **Streaming for the LLM done-phase.** The done-phase artifact
  rendering is rare (once per session) and short. Streaming pays
  off for the TALKING-phase LLM where every 100ms of latency
  shows; for done-phase, the JSON-mode strictness of OpenAI's
  `response_format: { type: "json_schema" }` matters more than
  the perceived latency. (Note: that's an OpenAI-ism — see
  comment under refactor #6.)

- **Provider-agnostic streaming chat with auto-fallback.** I've shipped
  this twice. It's the right architecture at high concurrency. For a
  single-user daemon serving one puck, the wrapper layer in refactor #3
  is enough. Don't write a "circuit breaker" for a daemon with one
  client.

- **Migrating `Voice.discussEngine` to a richer shape *before* the
  second realtime provider lands.** Refactor #10's payoff is at
  provider #2. Leaving it as the closed union until then is fine.

- **Replacing the hand-rolled chat-completions client with the OpenAI
  SDK.** The hand-rolled `ChatCompletionsProvider`
  (`chat_completions.ts`) is 137 LOC of clear code that handles
  OpenRouter and any compatible service by URL config. The SDK would
  add a 2 MB dep and lose the OpenRouter compatibility. Keep the
  hand-rolled.

- **Reshaping context/registry to support per-LLM-provider tool
  formats.** It's tempting after refactor #4 to push the tool
  translation into the registry. Don't — keep translation inside the
  realtime provider impl (the natural boundary). The registry stays
  neutral.

- **Killing the legacy puck protocol.** Not in scope; the audio-io
  protocol at `audio_io/protocol.ts` already cleanly fronts the legacy
  shape (`connection.ts:177-201`). It's the right kind of dual-shape
  support — explicit, documented, with a deprecation path.

## Bottom-line ranking

If Tom does ONE refactor: **#1 (make the Realtime provider seam
load-bearing)**. It unlocks the only currently-blocked swap, and it's
the only file where "abstraction theatre" is the accurate description.

If he does TWO: add **#2 (provider registration, drop closed enums)**.
That's where the "every new provider touches 5 files" pain comes from.

If he does FIVE: above plus **#4 (neutral ToolSpec)**, **#5 (drop
`openaiApiKey` from `PipelineStart`)**, and **#14 (realtime pipeline
test)**. After those five, voix's LLM surface is genuinely
provider-agnostic, and the next swap is a one-file PR.
