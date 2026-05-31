/**
 * Realtime pipeline implementation.
 *
 * One instance per capture. Owns a neutral `RealtimeSession` (resolved
 * from a `RealtimeProvider` — Wave B / refactor #1), the 16→24 kHz
 * resample state, the (optional) software echo gate, the watchdog, tool
 * routing, and the dictation post-process handoff. It reacts only to
 * neutral `RealtimeEvent`s — no provider (OpenAI) event name appears in
 * this file; the adapter in `src/realtime/openai.ts` translates them.
 *
 * Talks to the endpoint only through `PipelineCallbacks` — no WS, no
 * Elysia, no audio-io protocol shapes. M07 carved this out of the old
 * 641-LOC `puck/session.ts`; the WS-side bits live in
 * `audio_io/connection.ts`.
 *
 * Pipeline shape today:
 *   • intent=discuss → realtime audio in + out, tools enabled
 *   • intent=dictate → realtime model in text-only mode (STT only),
 *     then voice.donePrompt over the raw transcript on completion
 */

import { EchoGate } from "../audio/echo_gate.ts";
import { createResampler, resampleChunk } from "../audio/resample.ts";
import type { Intent } from "../audio_io/protocol.ts";
import { callTool, gatherAll, listAllTools } from "../context/registry.ts";
import { voixSource } from "../context/sources/voix.ts";
import type { ContextEntry, ToolSpec } from "../context/types.ts";
import { appendHistory } from "../history/store.ts";
import { log } from "../log.ts";
import { SessionRecorder } from "../recordings/store.ts";
import {
  forget as forgetTranscript,
  writeComplete as writeCompleteTranscript,
  writePartial as writePartialTranscript,
  writeRawSidecar,
} from "../transcripts/store.ts";
import type { Voice } from "../voices/types.ts";
import { type PostProcessKeys, postProcess } from "./providers/llm/index.ts";
import type {
  RealtimeProvider,
  RealtimeProviderSessionConfig,
  RealtimeSession,
} from "./providers/realtime/types.ts";
import type { Pipeline, PipelineCallbacks, PipelineStart } from "./types.ts";
import { SessionWatchdog } from "./watchdog.ts";

const OPENAI_RATE = 24000; // Realtime API's required minimum input rate.
const IDLE_TIMEOUT_S = 5.0;
const SESSION_HARD_MAX_S = 180.0;

/** Render context entries into the `[Context] …` block we inject into
 *  realtime instructions and post-processing prompts. Source-agnostic
 *  — each entry's `data` is rendered as key/value lines under a
 *  per-source header. Empty input → empty string. */
function renderContextBlock(entries: readonly ContextEntry[]): string {
  if (entries.length === 0) return "";
  const lines: string[] = ["[Context]"];
  for (const entry of entries) {
    lines.push(`${entry.source}:`);
    for (const [k, v] of Object.entries(entry.data)) {
      lines.push(`  ${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`);
    }
  }
  return lines.join("\n");
}

/** RMS of a mono PCM16 LE buffer. Diagnostic only — logged
 *  periodically so we can see what audio is actually arriving from
 *  the endpoint. Speech sits in the low thousands; silence is near 0. */
function computeRms(pcm16: Buffer): number {
  if (pcm16.length < 2) return 0;
  const n = Math.floor(pcm16.length / 2);
  let sumSq = 0;
  for (let i = 0; i < n; i++) {
    const s = pcm16.readInt16LE(i * 2);
    sumSq += s * s;
  }
  return Math.sqrt(sumSq / n);
}

/** Dependencies the orchestrator (or a test) injects into a
 *  RealtimePipeline at construction. Wave A #5 removes the
 *  vendor-named `openaiApiKey` from `PipelineStart`; instead, the
 *  orchestrator resolves a `RealtimeProvider` (Wave B) + supplies any
 *  keys needed for done-phase post-process.
 *
 *  Wave B (refactor #1) makes the seam load-bearing: the pipeline holds
 *  a neutral `RealtimeProvider` resolved from the registry and never
 *  names OpenAI. The provider's `open()` returns a connected session;
 *  every event the pipeline reacts to is a neutral `RealtimeEvent`. */
export type RealtimePipelineDeps = {
  /** Neutral realtime provider. The orchestrator resolves this from the
   *  registry ("openai" today); tests inject a `StubRealtimeProvider`. */
  realtimeProvider: RealtimeProvider;
  /** Keys for the dictate done-phase LLM call. Open-shaped — keyed by
   *  provider name; the post-process facade looks up the key matching
   *  `voice.postProcessProvider`. */
  postProcessKeys: PostProcessKeys;
};

export class RealtimePipeline implements Pipeline {
  private session: RealtimeSession | null = null;
  private upsample: ReturnType<typeof createResampler>;
  private echoGate: EchoGate | null;
  private startedAt = Date.now();
  private watchdog: SessionWatchdog;
  private closed = false;
  /** Periodic stats counters — gate + mic RMS diagnostics. */
  private echoLogCounter = 0;
  private micRmsLogCounter = 0;

  private readonly sessionId: string;
  private readonly deviceId: string;
  private readonly voice: Voice;
  private readonly intent: Intent;
  private readonly cb: PipelineCallbacks;
  private readonly recorder: SessionRecorder;

  /** Accumulated user transcript across delta events. */
  private userPartial = "";
  /** Accumulated assistant transcript for the current response turn;
   *  flushed to the recorder + log on `assistant_done`, then reset. */
  private assistantPartial = "";
  /** First error message we observed — included in history so silent
   *  upstream failures aren't invisible. */
  private lastError: string | null = null;
  /** Context snapshot used at session.update; reused for the post-
   *  process prompt so both phases see the same context. */
  private contextSnapshot: ContextEntry[] = [];

  constructor(
    s: PipelineStart,
    private readonly deps: RealtimePipelineDeps,
  ) {
    this.sessionId = s.sessionId;
    this.deviceId = s.deviceId;
    this.voice = s.voice;
    this.intent = s.intent;
    this.cb = s.callbacks;
    this.upsample = createResampler(s.micSampleRateHz, OPENAI_RATE);
    this.echoGate = s.halfDuplexOnChip ? null : new EchoGate();
    this.recorder = new SessionRecorder({
      deviceId: s.deviceId,
      sessionId: s.sessionId,
      voiceId: s.voice.id,
      voiceName: s.voice.name,
    });
    this.watchdog = new SessionWatchdog(
      {
        idleTimeoutS: IDLE_TIMEOUT_S,
        hardMaxS: SESSION_HARD_MAX_S,
        label: `session ${s.deviceId}`,
      },
      () => {
        // Watchdog tells us we're done — surface to the connection.
        this.cb.close();
      },
    );
  }

  async start(): Promise<void> {
    // Context gather + tool enumeration run in parallel with the
    // OpenAI handshake. By the time session.update lands we have
    // everything we need to inject context + tools in one shot. A
    // slow gather still races safely — we just send an empty context
    // block; the model can call tools mid-conversation to fill in
    // what it needs.
    const gatherPromise = gatherAll({ deviceId: this.deviceId });
    const toolsPromise = listAllTools();

    const cfg = this.buildRealtimeConfig(this.voice);

    try {
      this.session = await this.deps.realtimeProvider.open(cfg);
    } catch (err) {
      log.warn(`pipeline ${this.deviceId}: realtime connect failed`, err);
      this.cb.sendEvent({ type: "error", message: "realtime connect failed" });
      this.cb.close();
      return;
    }

    this.wireRealtimeEvents();

    const [contextEntries, tools] = await Promise.all([
      gatherPromise,
      this.intent === "discuss" ? toolsPromise : Promise.resolve<ToolSpec[]>([]),
    ]);
    this.contextSnapshot = contextEntries;

    if (this.intent === "discuss") {
      // Push composed instructions + the neutral ToolSpecs across the
      // seam. The provider adapter (Wave B) translates tools into its
      // native shape; the pipeline never sees an OpenAI tool type.
      this.session.updateSession({
        instructions: this.composeRealtimeInstructions(this.voice, contextEntries),
        tools,
      });
      log.info(
        `pipeline ${this.deviceId}: ctx_entries=${contextEntries.length} tools=${tools.length}`,
      );

      // The voix builtin source can close us when the model invokes
      // voix__end_session — wire that AFTER session.update so the
      // tool only routes once the realtime path is fully primed.
      voixSource.bindSession(this.deviceId, (reason) => {
        log.info(`pipeline ${this.deviceId}: voix.end_session — ${reason}`);
        this.cb.close();
      });
    }

    this.watchdog.start();
    log.info(
      `pipeline started device=${this.deviceId} intent=${this.intent} ` +
        `voice_id=${this.voice.id} sess=${this.sessionId}`,
    );
  }

  pushMic(pcm: Buffer): void {
    if (this.closed || !this.session || pcm.length === 0) return;
    // Note: we do NOT bump the watchdog on raw mic chunks. Pucks
    // stream mic bytes continuously while connected, so using
    // arrival-as-activity means the idle gate never fires when
    // upstream can't transcribe the audio. VAD events from OpenAI
    // are the right activity signal; they bump elsewhere.

    // Capture raw mic BEFORE resample + echo gate — recordings show
    // what the endpoint actually delivered.
    this.recorder.pushMic(pcm);

    // Periodic mic RMS log so we can confirm the puck is delivering
    // recognisable audio. Useful for diagnosing XMOS pipeline stages
    // when the model fails to transcribe.
    this.micRmsLogCounter++;
    if (this.micRmsLogCounter % 50 === 0) {
      log.info(
        `pipeline ${this.deviceId}: mic_rms=${Math.round(computeRms(pcm))} ` +
          `(chunks=${this.micRmsLogCounter})`,
      );
    }

    if (this.intent === "discuss" && this.echoGate) {
      const { forward } = this.echoGate.shouldForward(pcm);
      this.echoLogCounter++;
      if (this.echoLogCounter % 50 === 0) {
        log.info(`pipeline ${this.deviceId}: ${this.echoGate.stats()}`);
      }
      if (!forward) return;
    }

    const pcm24k = resampleChunk(pcm, this.upsample);
    this.session.pushMicPcm(pcm24k);
  }

  readyForInput(): void {
    if (this.closed) return;
    // The endpoint's speaker just drained, so the mic is live again
    // on its side. Reset the idle counter from NOW — otherwise the
    // user gets a shortened thinking-then-speaking window if upstream
    // stopped streaming audio bytes a couple of seconds ago.
    this.watchdog.bump();
    log.debug(`pipeline ${this.deviceId}: ready_for_input — idle reset`);
  }

  bargeIn(): void {
    if (this.closed || !this.session) return;
    // Realtime API supports response cancellation; this is the hook
    // for the upcoming barge-in event in the v1 audio-io spec.
    // (No-op today — the OpenAI client doesn't expose cancel yet;
    // wire it through here when it does.)
    log.debug(`pipeline ${this.deviceId}: barge_in (no-op pending realtime cancel)`);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.watchdog.stop();
    void this.session?.close();
    voixSource.unbindSession(this.deviceId);
    forgetTranscript(this.deviceId, this.sessionId);
    // Best-effort flush of mic + speaker captures to disk. Fire and
    // forget so the close path returns promptly.
    this.recorder.finalize().catch((err) => {
      log.warn(`pipeline ${this.deviceId}: recorder.finalize failed:`, err);
    });
    const duration = (Date.now() - this.startedAt) / 1000;
    log.info(
      `pipeline closed device=${this.deviceId} sess=${this.sessionId} ` +
        `duration=${duration.toFixed(1)}s` +
        (this.lastError ? ` (last_error=${this.lastError})` : ""),
    );
  }

  // ─── Internals ────────────────────────────────────────────────────

  private composeRealtimeInstructions(voice: Voice, entries: ContextEntry[]): string {
    const parts: string[] = [];
    const ctx = renderContextBlock(entries);
    if (ctx) parts.push(ctx);
    if (voice.addendum.trim()) parts.push(voice.addendum.trim());
    if (voice.talkingPrompt.trim()) parts.push(voice.talkingPrompt.trim());
    return parts.join("\n\n");
  }

  private buildRealtimeConfig(voice: Voice): RealtimeProviderSessionConfig {
    if (this.intent === "dictate") {
      return {
        // gpt-realtime-2 is the cheapest SKU; transcription model
        // produces the actual text we care about.
        model: "gpt-realtime-2",
        outputModalities: ["text"],
        instructions: "",
        transcribeModel: voice.sttModel || "gpt-4o-mini-transcribe",
        // High VAD = stop quickly after a pause; tuneable per voice
        // once we see real usage.
        vadEagerness: "high",
      };
    }
    return {
      model: voice.model || "gpt-realtime-2",
      outputModalities: ["audio"],
      instructions: voice.talkingPrompt,
      transcribeModel: voice.sttModel || "gpt-4o-mini-transcribe",
      voice: voice.voice || "alloy",
      vadEagerness: "medium",
    };
  }

  /**
   * Subscribe to the provider's neutral event stream and react. This is
   * the load-bearing seam (Wave B / refactor #1): a switch on the
   * provider-agnostic `RealtimeEvent` union. No OpenAI event name
   * appears here — the adapter translated them all away.
   */
  private wireRealtimeEvents(): void {
    if (!this.session) return;

    this.session.subscribe((event) => {
      switch (event.type) {
        case "user_speech_start":
          this.watchdog.setUserSpeaking(true);
          this.cb.sendEvent({ type: "user_speech_start" });
          break;

        case "user_speech_stop":
          this.watchdog.setUserSpeaking(false);
          this.cb.sendEvent({ type: "user_speech_end" });
          break;

        case "user_transcript_delta": {
          this.userPartial += event.text;
          this.cb.sendEvent({ type: "transcript_delta", text: event.text });
          void writePartialTranscript(
            this.deviceId,
            this.sessionId,
            "user",
            this.userPartial,
          ).catch((e) => log.debug(`pipeline ${this.deviceId}: partial write failed`, e));
          break;
        }

        case "user_transcript_complete": {
          this.recorder.pushTranscript("user", event.text);
          this.handleUserTranscriptComplete(event.text).catch((err) => {
            log.warn(`pipeline ${this.deviceId}: handleUserTranscriptComplete failed:`, err);
          });
          break;
        }

        case "assistant_transcript_delta":
          // Accumulate within the turn; flushed on assistant_done.
          this.assistantPartial += event.text;
          break;

        case "assistant_audio":
          this.echoGate?.observeSpeaker(event.pcm);
          this.recorder.pushSpeaker(event.pcm);
          // 24 kHz PCM16 LE; the connection layer resamples to the
          // endpoint's declared rate (M16 + B1 fix).
          this.cb.sendSpeaker(event.pcm, OPENAI_RATE);
          this.watchdog.setAssistantSpeaking(true);
          break;

        case "assistant_done": {
          this.watchdog.setAssistantSpeaking(false);
          const t = this.assistantPartial.trim();
          this.assistantPartial = "";
          if (t) {
            this.recorder.pushTranscript("assistant", t);
            log.info(
              `pipeline ${this.deviceId}: assistant said (${t.length} chars): ` +
                `${t.slice(0, 100)}${t.length > 100 ? "…" : ""}`,
            );
          }
          break;
        }

        case "function_call":
          this.handleFunctionCall(event.callId, event.name, event.argsJson).catch((err) => {
            log.warn(`pipeline ${this.deviceId}: handleFunctionCall failed:`, err);
          });
          break;

        case "error":
          // A realtime error (incl. unexpected upstream close, which the
          // adapter maps here) is fatal: surface it, then tear down.
          log.warn(`pipeline ${this.deviceId}: realtime error`, event.message);
          this.lastError = event.message;
          this.cb.sendEvent({ type: "error", message: event.message });
          this.cb.close();
          break;
      }
    });
  }

  /**
   * Terminal step for a dictation turn: raw STT text is in, either
   * ship it as-is or run it through `voice.donePrompt`. Always append
   * to history so the Mac app's history UI sees every turn.
   */
  private async handleUserTranscriptComplete(rawText: string): Promise<void> {
    const trimmed = rawText.trim();
    if (!trimmed) {
      log.info(`pipeline ${this.deviceId}: empty transcript`);
      return;
    }

    log.info(
      `pipeline ${this.deviceId}: raw transcript (${trimmed.length} chars): ` +
        `${trimmed.slice(0, 80)}${trimmed.length > 80 ? "…" : ""}`,
    );

    let finalText = trimmed;
    let processedText: string | null = null;

    if (this.intent === "dictate" && this.voice.donePrompt.trim()) {
      processedText = await postProcess({
        rawText: trimmed,
        systemPrompt: this.voice.donePrompt,
        provider: this.voice.postProcessProvider,
        model: this.voice.postProcessModel,
        contextBlock: renderContextBlock(this.contextSnapshot),
        keys: this.deps.postProcessKeys,
      });
      if (processedText && processedText !== trimmed) {
        finalText = processedText;
        await writeRawSidecar(this.deviceId, this.sessionId, "user", trimmed).catch((e) =>
          log.debug(`pipeline ${this.deviceId}: raw sidecar write failed`, e),
        );
      } else {
        processedText = null;
      }
    }

    const completed = await writeCompleteTranscript(
      this.deviceId,
      this.sessionId,
      "user",
      finalText,
    );

    this.cb.sendEvent({ type: "transcript", role: "user", text: finalText });

    await appendHistory({
      deviceId: this.deviceId,
      sessionId: this.sessionId,
      voiceId: this.voice.id,
      voiceName: this.voice.name,
      modeType: this.voice.type,
      durationMs: Date.now() - this.startedAt,
      rawText: trimmed,
      processedText,
      postProcessProvider: processedText ? this.voice.postProcessProvider : null,
      postProcessModel: processedText ? this.voice.postProcessModel : null,
      contextSnapshot: this.contextSnapshot,
      transcriptPath: completed.path,
    });
  }

  private async handleFunctionCall(
    callId: string,
    name: string,
    argsJson: Record<string, unknown>,
  ): Promise<void> {
    // Args arrive pre-parsed across the neutral seam — the provider
    // adapter owns JSON parsing + bad-arg replies (Wave B).
    const startedAt = Date.now();
    const result = await callTool(name, argsJson);
    const elapsedMs = Date.now() - startedAt;
    log.info(
      `pipeline ${this.deviceId}: tool ${name} ${result.isError ? "ERR" : "ok"} in ${elapsedMs}ms ` +
        `(out=${result.content.length} chars)`,
    );
    this.session?.sendFunctionResult(callId, result.content);
  }
}
