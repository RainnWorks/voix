/**
 * Pipeline orchestrator (M13 + M14 + M-Arch Wave A #2).
 *
 * Decides which `Pipeline` impl runs for a given (intent, voice)
 * combination, wires the provider dependencies, and hands the
 * connection a uniform `Pipeline` to drive.
 *
 * Selection matrix:
 *
 *   intent  | voice.discussEngine | voice.sttProvider     | impl
 *   --------|---------------------|-----------------------|----------------------------
 *   dictate | (n/a)               | "deepgram"            | TraditionalDictatePipeline
 *   dictate | (n/a)               | "openai-realtime" (∅) | RealtimePipeline
 *   discuss | "traditional"       | (any)                 | TraditionalDiscussPipeline
 *   discuss | "realtime" (∅)      | (any)                 | RealtimePipeline
 *
 * M15 reshapes RealtimePipeline behind a `RealtimeProvider` interface
 * so the dial is symmetric (a Realtime impl per provider, same as
 * STT/LLM/TTS today).
 *
 * Provider construction is deferred to factory functions registered at
 * boot — letting tests substitute stubs without going near the network
 * and letting the production wiring lazy-import providers that pull
 * large deps (`ws` for Deepgram + Aura).
 *
 * Wave A #2 swaps the closed-string `OrchestratorProviders` factory
 * bundle for a `ProviderRegistry`. Adding a provider is now boot-time
 * registration (`registry.register("llm", "anthropic", () => …)`); no
 * type-level edits to the orchestrator. The closed `"openai" |
 * "openrouter"` enum on `voice.postProcessProvider` is now `string` —
 * unknown names throw a typed `UnknownProviderError` at session-start
 * (or boot-time, if the registry is built strict).
 */

import { config } from "../env.ts";
import { log } from "../log.ts";
import { OpenAIRealtimeClient } from "../realtime/openai.ts";
import { TraditionalDictatePipeline } from "./dictate_traditional.ts";
import { TraditionalDiscussPipeline } from "./discuss_traditional.ts";
import type { PostProcessKeys } from "./providers/llm/index.ts";
import { createOpenAiProvider } from "./providers/llm/openai.ts";
import { createOpenRouterProvider } from "./providers/llm/openrouter.ts";
import type { LlmProvider } from "./providers/llm/types.ts";
import { createDeepgramProvider } from "./providers/stt/deepgram.ts";
import type { SttProvider } from "./providers/stt/types.ts";
import { createAuraProvider } from "./providers/tts/aura.ts";
import type { TtsProvider } from "./providers/tts/types.ts";
import { RealtimePipeline, type RealtimePipelineDeps } from "./realtime.ts";
import type { Pipeline, PipelineFactory, PipelineStart } from "./types.ts";

/** Kinds of providers the registry knows about today. Realtime is
 *  Wave B (the seam isn't load-bearing yet); for now any "realtime"
 *  decision is hard-coded onto `RealtimePipeline` + `OpenAIRealtimeClient`. */
export type ProviderKind = "stt" | "llm" | "tts";

/** Provider instance shape per kind. Used by the registry's typed
 *  `get`/`register` so callers don't have to cast. */
export type ProviderFor<K extends ProviderKind> = K extends "stt"
  ? SttProvider
  : K extends "llm"
    ? LlmProvider
    : K extends "tts"
      ? TtsProvider
      : never;

export type ProviderFactory<K extends ProviderKind> = () => Promise<ProviderFor<K>>;

/** Thrown when something asks the registry for a name no factory was
 *  registered under. Distinct from a network/auth error so the caller
 *  can decide whether to fall back or surface a "wrong config" warning. */
export class UnknownProviderError extends Error {
  constructor(
    readonly kind: ProviderKind,
    readonly providerName: string,
  ) {
    super(`orchestrator: unknown ${kind} provider ${providerName}`);
    this.name = "UnknownProviderError";
  }
}

/** Boot-time registry of provider factories, keyed by (kind, name).
 *  Factories run lazily on first lookup so a configured-but-unused
 *  provider doesn't pay the cost of dialling its dep until something
 *  actually calls it. */
export interface ProviderRegistry {
  register<K extends ProviderKind>(kind: K, name: string, factory: ProviderFactory<K>): void;
  get<K extends ProviderKind>(kind: K, name: string): ProviderFactory<K> | undefined;
  list(kind: ProviderKind): string[];
}

/** Concrete in-memory ProviderRegistry. */
class InMemoryRegistry implements ProviderRegistry {
  private maps: Record<ProviderKind, Map<string, ProviderFactory<ProviderKind>>> = {
    stt: new Map(),
    llm: new Map(),
    tts: new Map(),
  };

  register<K extends ProviderKind>(kind: K, name: string, factory: ProviderFactory<K>): void {
    this.maps[kind].set(name, factory as ProviderFactory<ProviderKind>);
    log.info(`orchestrator: registered ${kind} provider "${name}"`);
  }

  get<K extends ProviderKind>(kind: K, name: string): ProviderFactory<K> | undefined {
    return this.maps[kind].get(name) as ProviderFactory<K> | undefined;
  }

  list(kind: ProviderKind): string[] {
    return Array.from(this.maps[kind].keys());
  }
}

/** Build an empty registry. Callers (boot wiring in tests / index.ts)
 *  call `.register(...)` for each available provider. */
export function createProviderRegistry(): ProviderRegistry {
  return new InMemoryRegistry();
}

/**
 * Default provider registry wired against the real env credentials.
 * Each `register` only fires if the relevant key is present — missing
 * keys at boot mean the provider is simply absent from the registry,
 * which surfaces as `UnknownProviderError` if a voice tries to use it
 * (clear "configure this in add-on options" UX) rather than as a
 * silent fallback or a mid-session crash.
 *
 * Wave A #9 (deferred): move provider registration entirely to
 * `index.ts` so the orchestrator stops touching `config`. Doing it
 * here for now preserves the "drop-in replacement for defaultProviders"
 * call site in `audio_io/route.ts`.
 */
export function defaultRegistry(): ProviderRegistry {
  const reg = createProviderRegistry();

  // STT
  if (config.deepgramApiKey) {
    const key = config.deepgramApiKey;
    reg.register("stt", "deepgram", () => createDeepgramProvider(key));
  }

  // LLM
  if (config.openaiApiKey) {
    const key = config.openaiApiKey;
    reg.register("llm", "openai", async () => createOpenAiProvider(key));
  }
  if (config.openrouterApiKey) {
    const key = config.openrouterApiKey;
    reg.register("llm", "openrouter", async () => createOpenRouterProvider(key));
  }

  // TTS (Aura reuses the Deepgram key)
  if (config.deepgramApiKey) {
    const key = config.deepgramApiKey;
    reg.register("tts", "aura", () => createAuraProvider(key));
  }

  return reg;
}

/** Resolve a provider through the registry, raising a typed error if
 *  the name isn't registered. Centralised so every call site gets the
 *  same error message + the same exception type. */
async function resolveProvider<K extends ProviderKind>(
  registry: ProviderRegistry,
  kind: K,
  name: string,
): Promise<ProviderFor<K>> {
  const factory = registry.get(kind, name);
  if (!factory) throw new UnknownProviderError(kind, name);
  return factory();
}

/** Process-global default registry. Lazily built on first access so
 *  tests that don't go through `createOrchestrator()` don't pay the
 *  env-read cost, and so a stray `defaultRegistry()` call in test code
 *  doesn't trample a registry the suite already populated. The
 *  `/api/providers` route reads this. */
let _defaultRegistrySingleton: ProviderRegistry | null = null;
export function getDefaultRegistry(): ProviderRegistry {
  if (!_defaultRegistrySingleton) {
    _defaultRegistrySingleton = defaultRegistry();
  }
  return _defaultRegistrySingleton;
}

/** Extra wiring the orchestrator threads into pipelines beyond the
 *  registry-resolved STT/LLM/TTS providers. Wave A #5 carved these
 *  off `PipelineStart.openaiApiKey` so the pipeline interface stays
 *  vendor-neutral; the orchestrator owns the env→deps mapping.
 *
 *  Wave B (refactor #1) makes the realtime seam load-bearing — at
 *  that point `realtimeClientFactory` becomes a registry lookup like
 *  STT/LLM/TTS. */
export type OrchestratorOptions = {
  /** Build an OpenAI Realtime client for a given session config. The
   *  default uses `config.openaiApiKey` bound at boot. */
  realtimeClientFactory?: RealtimePipelineDeps["realtimeClientFactory"];
  /** Open-shaped key map for the done-phase post-process facade. The
   *  default seeds the two known providers (openai, openrouter) from
   *  env. */
  postProcessKeys?: PostProcessKeys;
};

function defaultOrchestratorOptions(): Required<OrchestratorOptions> {
  return {
    realtimeClientFactory: (cfg) => new OpenAIRealtimeClient(config.openaiApiKey, cfg),
    postProcessKeys: {
      openai: config.openaiApiKey,
      openrouter: config.openrouterApiKey,
    },
  };
}

/**
 * Build the orchestrator's PipelineFactory. The factory is what the
 * audio-io route hands to its connection — one call per capture.
 *
 * Tests pass a pre-populated registry with stub factories; production
 * gets the env-driven `defaultRegistry()` (via `getDefaultRegistry`).
 */
export function createOrchestrator(
  registry: ProviderRegistry = getDefaultRegistry(),
  options: OrchestratorOptions = {},
): PipelineFactory {
  const defaults = defaultOrchestratorOptions();
  const realtimeClientFactory = options.realtimeClientFactory ?? defaults.realtimeClientFactory;
  const postProcessKeys = options.postProcessKeys ?? defaults.postProcessKeys;
  return (start: PipelineStart): Pipeline => {
    return new OrchestratedPipeline(start, registry, {
      realtimeClientFactory,
      postProcessKeys,
    });
  };
}

/**
 * Thin Pipeline wrapper that defers the inner-pipeline construction
 * until `start()` so async provider factories can fail in a place
 * the connection's start() chain already awaits. Forwards every
 * call to the inner once it resolves.
 */
class OrchestratedPipeline implements Pipeline {
  private inner: Pipeline | null = null;
  private closed = false;
  private earlyMic: Buffer[] = [];
  private earlyMicBytes = 0;
  private readonly EARLY_MIC_CAP = 5 * 16000 * 2;

  constructor(
    private readonly start_: PipelineStart,
    private readonly registry: ProviderRegistry,
    private readonly options: Required<OrchestratorOptions>,
  ) {}

  async start(): Promise<void> {
    const inner = await this.pick();
    if (this.closed) {
      void inner.close();
      return;
    }
    this.inner = inner;
    await inner.start();
    for (const buf of this.earlyMic) inner.pushMic(buf);
    this.earlyMic = [];
    this.earlyMicBytes = 0;
  }

  pushMic(pcm: Buffer): void {
    if (this.closed) return;
    if (this.inner) {
      this.inner.pushMic(pcm);
      return;
    }
    if (this.earlyMicBytes + pcm.length > this.EARLY_MIC_CAP) return;
    this.earlyMic.push(Buffer.from(pcm));
    this.earlyMicBytes += pcm.length;
  }

  readyForInput(): void {
    if (this.closed) return;
    this.inner?.readyForInput();
  }

  bargeIn(): void {
    if (this.closed) return;
    this.inner?.bargeIn();
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.inner?.close();
    this.inner = null;
    this.earlyMic = [];
  }

  // ─── Selection ────────────────────────────────────────────────────

  private async pick(): Promise<Pipeline> {
    const { intent, voice } = this.start_;
    if (intent === "dictate") {
      if (voice.sttProvider === "deepgram") {
        const sttProvider = await resolveProvider(this.registry, "stt", "deepgram");
        log.info(
          `orchestrator: device=${this.start_.deviceId} intent=dictate → ` +
            `TraditionalDictatePipeline(stt=${sttProvider.name})`,
        );
        return new TraditionalDictatePipeline(this.start_, {
          sttProvider,
          postProcessKeys: this.options.postProcessKeys,
        });
      }
      log.info(
        `orchestrator: device=${this.start_.deviceId} intent=dictate ` +
          `sttProvider=${voice.sttProvider} → RealtimePipeline`,
      );
      return new RealtimePipeline(this.start_, {
        realtimeClientFactory: this.options.realtimeClientFactory,
        postProcessKeys: this.options.postProcessKeys,
      });
    }
    // intent === "discuss"
    const engine = voice.discussEngine || "realtime";
    if (engine === "traditional") {
      // Dead-ternary fix (niggly-bits B3): the original
      // `voice.sttProvider === "deepgram" ? "deepgram" : "deepgram"`
      // silently forced Deepgram regardless of the voice's declared
      // STT and crashed with no decline if DEEPGRAM_API_KEY was
      // missing. Use the voice's choice; default to deepgram only
      // when unset.
      const sttName = voice.sttProvider || "deepgram";
      const llmName = voice.postProcessProvider || "openai";
      const ttsName = voice.ttsProvider || "aura";
      const [sttProvider, llmProvider, ttsProvider] = await Promise.all([
        resolveProvider(this.registry, "stt", sttName),
        resolveProvider(this.registry, "llm", llmName),
        resolveProvider(this.registry, "tts", ttsName),
      ]);
      log.info(
        `orchestrator: device=${this.start_.deviceId} intent=discuss engine=traditional → ` +
          `TraditionalDiscussPipeline(stt=${sttProvider.name} llm=${llmProvider.name} tts=${ttsProvider.name})`,
      );
      return new TraditionalDiscussPipeline(this.start_, {
        sttProvider,
        llmProvider,
        ttsProvider,
      });
    }
    log.info(
      `orchestrator: device=${this.start_.deviceId} intent=discuss engine=realtime → RealtimePipeline`,
    );
    return new RealtimePipeline(this.start_, {
      realtimeClientFactory: this.options.realtimeClientFactory,
      postProcessKeys: this.options.postProcessKeys,
    });
  }
}
