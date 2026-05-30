/**
 * Pipeline orchestrator (M13 + M14).
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
 * Provider construction is deferred to factory functions injected at
 * boot — letting tests substitute stubs without going near the
 * network and letting the production wiring lazy-import providers
 * that pull large deps (`ws` for Deepgram + Aura).
 */

import { config } from "../env.ts";
import { log } from "../log.ts";
import { TraditionalDictatePipeline } from "./dictate_traditional.ts";
import { TraditionalDiscussPipeline } from "./discuss_traditional.ts";
import { createOpenAiProvider } from "./providers/llm/openai.ts";
import { createOpenRouterProvider } from "./providers/llm/openrouter.ts";
import type { LlmProvider } from "./providers/llm/types.ts";
import { createDeepgramProvider } from "./providers/stt/deepgram.ts";
import type { SttProvider } from "./providers/stt/types.ts";
import { createAuraProvider } from "./providers/tts/aura.ts";
import type { TtsProvider } from "./providers/tts/types.ts";
import { RealtimePipeline } from "./realtime.ts";
import type { Pipeline, PipelineFactory, PipelineStart } from "./types.ts";

/** Factory bundle the orchestrator uses to construct provider
 *  instances. Each factory is async because Deepgram/Aura factories
 *  lazy-import `ws`. */
export type OrchestratorProviders = {
  stt(name: string): Promise<SttProvider>;
  llm(name: string): Promise<LlmProvider>;
  tts(name: string): Promise<TtsProvider>;
};

/**
 * Default provider bundle wired against the real env credentials.
 * Tests substitute a stub bundle.
 */
export function defaultProviders(): OrchestratorProviders {
  return {
    async stt(name) {
      if (name === "deepgram") {
        if (!config.deepgramApiKey) {
          throw new Error("orchestrator: deepgram selected but DEEPGRAM_API_KEY missing");
        }
        return createDeepgramProvider(config.deepgramApiKey);
      }
      throw new Error(`orchestrator: unknown STT provider ${name}`);
    },
    async llm(name) {
      if (name === "openai") {
        if (!config.openaiApiKey) {
          throw new Error("orchestrator: openai LLM selected but OPENAI_API_KEY missing");
        }
        return createOpenAiProvider(config.openaiApiKey);
      }
      if (name === "openrouter") {
        if (!config.openrouterApiKey) {
          throw new Error("orchestrator: openrouter selected but OPENROUTER_API_KEY missing");
        }
        return createOpenRouterProvider(config.openrouterApiKey);
      }
      throw new Error(`orchestrator: unknown LLM provider ${name}`);
    },
    async tts(name) {
      if (name === "aura") {
        // Aura uses the Deepgram API key.
        if (!config.deepgramApiKey) {
          throw new Error("orchestrator: aura selected but DEEPGRAM_API_KEY missing");
        }
        return createAuraProvider(config.deepgramApiKey);
      }
      throw new Error(`orchestrator: unknown TTS provider ${name}`);
    },
  };
}

/**
 * Build the orchestrator's PipelineFactory. The factory is what the
 * audio-io route hands to its connection — one call per capture.
 */
export function createOrchestrator(
  providers: OrchestratorProviders = defaultProviders(),
): PipelineFactory {
  return (start: PipelineStart): Pipeline => {
    return new OrchestratedPipeline(start, providers);
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
    private readonly providers: OrchestratorProviders,
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
        const sttProvider = await this.providers.stt("deepgram");
        log.info(
          `orchestrator: device=${this.start_.deviceId} intent=dictate → ` +
            `TraditionalDictatePipeline(stt=${sttProvider.name})`,
        );
        return new TraditionalDictatePipeline(this.start_, { sttProvider });
      }
      log.info(
        `orchestrator: device=${this.start_.deviceId} intent=dictate ` +
          `sttProvider=${voice.sttProvider} → RealtimePipeline`,
      );
      return new RealtimePipeline(this.start_);
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
        this.providers.stt(sttName),
        this.providers.llm(llmName),
        this.providers.tts(ttsName),
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
    return new RealtimePipeline(this.start_);
  }
}
