/**
 * Traditional dictate pipeline — streaming STT + optional LLM
 * post-process. The first non-OpenAI-Realtime pipeline shape, built
 * on the M10-M12 provider abstractions.
 *
 * Lifecycle:
 *
 *   1. start():
 *      - Open STT session (Deepgram today; whatever
 *        `voice.sttProvider` resolves to).
 *      - Wire STT events → handler.
 *
 *   2. pushMic(pcm):
 *      - Forward to recorder (for the per-session WAV).
 *      - Forward to STT.
 *
 *   3. STT emits `partial`:
 *      - Forward as `transcript_delta` event so live captions render
 *        on the endpoint side.
 *
 *   4. STT emits `final` with `isEndpoint`:
 *      - Treat as end-of-utterance. Run the done-phase LLM if the
 *        voice has a `donePrompt`. Emit `transcript` event with the
 *        final text. Append history. Call `cb.close()`.
 *
 *   5. Watchdog enforces a hard ceiling — runaway dictations can't
 *      bill multi-minute STT.
 *
 * Why we don't run our own VAD here: Deepgram's server-side
 * endpointing IS our end-of-speech signal. The M09 energy VAD comes
 * into its own on M14's discuss path where we need to detect end-of-
 * user-turn explicitly to hand off to the LLM. Layering it under
 * Deepgram for dictate would just give us two endpoint signals
 * disagreeing with each other.
 */

import type { Intent } from "../audio_io/protocol.ts";
import { gatherAll } from "../context/registry.ts";
import type { ContextEntry } from "../context/types.ts";
import { config } from "../env.ts";
import { appendHistory } from "../history/store.ts";
import { log } from "../log.ts";
import { SessionRecorder } from "../recordings/store.ts";
import { writeComplete as writeCompleteTranscript, writeRawSidecar } from "../transcripts/store.ts";
import type { Voice } from "../voices/types.ts";
import { postProcess } from "./providers/llm/index.ts";
import type { SttProvider, SttSession } from "./providers/stt/types.ts";
import type { Pipeline, PipelineCallbacks, PipelineStart } from "./types.ts";
import { SessionWatchdog } from "./watchdog.ts";

const DICTATE_HARD_MAX_S = 180;
const DICTATE_IDLE_TIMEOUT_S = 8;

/** Render context entries into the `[Context] …` block — same shape
 *  the realtime pipeline uses, so the done-phase prompt sees the same
 *  rendered context whether it ran behind realtime or behind this
 *  traditional path. */
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

export type TraditionalDictateDeps = {
  /** Resolved STT provider for this voice. Caller (orchestrator) maps
   *  `voice.sttProvider` to an instance + handles missing-key errors
   *  before we get here. */
  sttProvider: SttProvider;
};

export class TraditionalDictatePipeline implements Pipeline {
  private stt: SttSession | null = null;
  private startedAt = Date.now();
  private watchdog: SessionWatchdog;
  private closed = false;
  private finalizing = false;

  private readonly sessionId: string;
  private readonly deviceId: string;
  private readonly voice: Voice;
  private readonly intent: Intent;
  private readonly cb: PipelineCallbacks;
  private readonly recorder: SessionRecorder;

  /** Accumulated final-segments. Concatenated for the canonical
   *  transcript that goes to the done-phase LLM. */
  private finals: string[] = [];
  private contextSnapshot: ContextEntry[] = [];
  private lastError: string | null = null;

  constructor(
    private readonly s: PipelineStart,
    private readonly deps: TraditionalDictateDeps,
  ) {
    this.sessionId = s.sessionId;
    this.deviceId = s.deviceId;
    this.voice = s.voice;
    this.intent = s.intent;
    this.cb = s.callbacks;
    this.recorder = new SessionRecorder({
      deviceId: s.deviceId,
      sessionId: s.sessionId,
      voiceId: s.voice.id,
      voiceName: s.voice.name,
    });
    this.watchdog = new SessionWatchdog(
      {
        idleTimeoutS: DICTATE_IDLE_TIMEOUT_S,
        hardMaxS: DICTATE_HARD_MAX_S,
        label: `dictate ${s.deviceId}`,
      },
      (reason) => {
        log.info(`dictate ${this.deviceId}: watchdog ${reason} — finalizing`);
        // Force-finalize whatever STT has emitted so far. The
        // hard-ceiling path may catch sessions where the endpoint
        // signal never fires; the idle path covers "user walked
        // away mid-dictation". Either way, we ship what we have.
        void this.finalizeDictation();
      },
    );
  }

  async start(): Promise<void> {
    // Context gather runs in parallel with STT open; the done-phase
    // prompt uses whatever we gathered.
    const gatherPromise = gatherAll({ deviceId: this.deviceId });

    try {
      this.stt = await this.deps.sttProvider.open({
        sampleRateHz: this.s.micSampleRateHz,
        interim: true,
        // Voice picks the STT model (Aura-Asteria-EN, Nova-3, etc.).
        // Empty string defers to the provider's default.
        model: this.voice.sttModel || undefined,
      });
    } catch (err) {
      log.warn(`dictate ${this.deviceId}: STT open failed`, err);
      this.cb.sendEvent({ type: "error", message: "STT open failed" });
      this.cb.close();
      return;
    }
    this.stt.on((ev) => this.handleSttEvent(ev));

    this.contextSnapshot = await gatherPromise;
    this.watchdog.start();
    this.watchdog.setUserSpeaking(true); // STT is open; mic is "live"
    log.info(
      `dictate started device=${this.deviceId} voice_id=${this.voice.id} ` +
        `stt=${this.deps.sttProvider.name} sess=${this.sessionId}`,
    );
  }

  pushMic(pcm: Buffer): void {
    if (this.closed || this.finalizing || !this.stt || pcm.length === 0) return;
    this.recorder.pushMic(pcm);
    this.stt.sendAudio(pcm);
    // Mic arrival counts as activity even though we never inspect the
    // bytes — the watchdog's idle timer would otherwise close us
    // before STT emits its first delta.
    this.watchdog.bump();
  }

  readyForInput(): void {
    if (this.closed) return;
    this.watchdog.bump();
  }

  bargeIn(): void {
    // Dictate has no model audio to interrupt; treat as a "user
    // changed their mind" cue and finalize whatever we have.
    if (this.closed || this.finalizing) return;
    void this.finalizeDictation();
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.watchdog.stop();
    void this.stt?.close();
    this.recorder.finalize().catch((err) => {
      log.warn(`dictate ${this.deviceId}: recorder.finalize failed:`, err);
    });
    const duration = (Date.now() - this.startedAt) / 1000;
    log.info(
      `dictate closed device=${this.deviceId} sess=${this.sessionId} ` +
        `duration=${duration.toFixed(1)}s` +
        (this.lastError ? ` (last_error=${this.lastError})` : ""),
    );
  }

  // ─── STT event handler ────────────────────────────────────────────

  private handleSttEvent(event: import("./providers/stt/types.ts").SttEvent): void {
    if (this.closed) return;
    if (event.type === "partial") {
      this.cb.sendEvent({ type: "transcript_delta", text: event.text });
      return;
    }
    if (event.type === "final") {
      if (event.text.trim()) this.finals.push(event.text.trim());
      this.recorder.pushTranscript("user", event.text);
      if (event.isEndpoint) {
        // End of utterance — kick the done-phase. Don't await; we
        // also want close to drain the watchdog timer.
        void this.finalizeDictation();
      }
      return;
    }
    if (event.type === "error") {
      this.lastError = event.message;
      this.cb.sendEvent({ type: "error", message: event.message });
      return;
    }
    if (event.type === "closed") {
      // STT closed before we got the endpoint. Treat whatever we have
      // as final and ship it.
      if (!this.finalizing) void this.finalizeDictation();
    }
  }

  /**
   * The terminal step. Idempotent — first caller wins; subsequent
   * calls no-op so multiple end-signals (STT endpoint + close, or
   * watchdog + endpoint) don't double-emit history.
   */
  private async finalizeDictation(): Promise<void> {
    if (this.finalizing || this.closed) return;
    this.finalizing = true;
    this.watchdog.setUserSpeaking(false);

    const rawText = this.finals.join(" ").trim();
    if (!rawText) {
      log.info(`dictate ${this.deviceId}: empty transcript — closing without history`);
      this.cb.close();
      return;
    }
    log.info(
      `dictate ${this.deviceId}: raw (${rawText.length} chars): ` +
        `${rawText.slice(0, 80)}${rawText.length > 80 ? "…" : ""}`,
    );

    // Done-phase LLM. The voice's `donePrompt` is the system prompt;
    // raw transcript is the user message. Errors fall back to raw
    // text (see postProcess facade).
    let finalText = rawText;
    let processedText: string | null = null;
    if (this.voice.donePrompt.trim()) {
      processedText = await postProcess({
        rawText,
        systemPrompt: this.voice.donePrompt,
        provider: this.voice.postProcessProvider,
        model: this.voice.postProcessModel,
        contextBlock: renderContextBlock(this.contextSnapshot),
        keys: { openai: this.s.openaiApiKey, openrouter: config.openrouterApiKey },
      });
      if (processedText && processedText !== rawText) {
        finalText = processedText;
        await writeRawSidecar(this.deviceId, this.sessionId, "user", rawText).catch((e) =>
          log.debug(`dictate ${this.deviceId}: raw sidecar write failed`, e),
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
      rawText,
      processedText,
      postProcessProvider: processedText ? this.voice.postProcessProvider : null,
      postProcessModel: processedText ? this.voice.postProcessModel : null,
      contextSnapshot: this.contextSnapshot,
      transcriptPath: completed.path,
    });

    this.cb.close();
  }
}
