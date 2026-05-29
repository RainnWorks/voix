/**
 * Pipeline orchestrator (M13).
 *
 * Decides which `Pipeline` impl runs for a given (intent, voice)
 * combination, wires the provider dependencies, and hands the
 * connection a uniform `Pipeline` to drive.
 *
 * Selection matrix today:
 *
 *   intent  | voice.sttProvider     | impl
 *   --------|-----------------------|----------------------------
 *   dictate | "deepgram"            | TraditionalDictatePipeline
 *   dictate | "openai-realtime" (∅) | RealtimePipeline
 *   discuss | * (any)               | RealtimePipeline
 *
 * M14 adds the traditional discuss path keyed on a new
 * `voice.discussEngine` field. M15 reshapes RealtimePipeline behind
 * a RealtimeProvider interface so the dial is symmetric.
 *
 * Provider construction is deferred to factory functions injected at
 * boot — letting tests substitute stubs without going near the
 * network and letting the production wiring lazy-import providers
 * that pull large deps (`ws` for Deepgram).
 */

import { config } from "../env.ts";
import { log } from "../log.ts";
import { TraditionalDictatePipeline } from "./dictate_traditional.ts";
import { createDeepgramProvider } from "./providers/stt/deepgram.ts";
import type { SttProvider } from "./providers/stt/types.ts";
import { RealtimePipeline } from "./realtime.ts";
import type { Pipeline, PipelineFactory, PipelineStart } from "./types.ts";

/** Factory bundle the orchestrator uses to construct provider
 *  instances. Each factory is async because Deepgram/Aura factories
 *  lazy-import `ws`. */
export type OrchestratorProviders = {
  /** Resolve an SttProvider by name. Throws on missing provider or
   *  missing credentials. */
  stt(name: string): Promise<SttProvider>;
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
    // Wrap in a thin async-start adapter so we don't return a
    // Pipeline whose start() throws synchronously when provider
    // construction fails. The Pipeline contract says start()
    // resolves once upstream is ready; that's the same contract
    // we satisfy here even when STT construction is the source of
    // the await.
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
  /** Buffer mic frames received between hello and inner.start
   *  resolving. Small window (~hundreds of ms); bounded to 5 s of
   *  16 kHz mono PCM16. */
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
      // close() raced ahead while providers were resolving.
      void inner.close();
      return;
    }
    this.inner = inner;
    await inner.start();
    // Drain any frames that arrived during construction. Order
    // preserved.
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
    if (intent === "dictate" && voice.sttProvider === "deepgram") {
      const sttProvider = await this.providers.stt("deepgram");
      log.info(
        `orchestrator: device=${this.start_.deviceId} intent=dictate → ` +
          `TraditionalDictatePipeline(stt=${sttProvider.name})`,
      );
      return new TraditionalDictatePipeline(this.start_, { sttProvider });
    }
    log.info(
      `orchestrator: device=${this.start_.deviceId} intent=${intent} ` +
        `sttProvider=${voice.sttProvider} → RealtimePipeline`,
    );
    return new RealtimePipeline(this.start_);
  }
}
