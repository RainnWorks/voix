/**
 * Traditional discuss pipeline — STT → LLM → TTS turn loop.
 *
 * The second non-Realtime pipeline shape after M13's dictate path.
 * Drives a back-and-forth conversation using the M10-M12 providers:
 *
 *   1. Mic in → Deepgram STT (interim + final partials).
 *   2. M09 energy VAD detects end-of-user-turn → finalize the user's
 *      STT segment.
 *   3. Push (system=talkingPrompt + history-of-turns) at the LLM →
 *      get assistant text.
 *   4. Pipe assistant text into Aura TTS → binary audio frames out
 *      to the endpoint.
 *   5. When TTS emits `utterance_end` (Aura's Flushed envelope), the
 *      turn closes. Loop back to step 1.
 *
 * On session close (idle watchdog, hard ceiling, endpoint hangup, or
 * the model deciding it's done), if the voice has a `donePrompt` the
 * full conversation history runs through the done-phase LLM and the
 * resulting artifact is emitted as a final transcript event +
 * appended to history. Otherwise the conversation is logged as-is.
 *
 * Why VAD here and not in the dictate path: Deepgram's `speech_final`
 * is the dictate path's end-of-turn signal because dictate is one
 * utterance. In discuss we need to detect turn boundaries explicitly
 * (silence > minSilenceMs after the user finished speaking) so we
 * can hand off to the LLM at the right moment — the STT's own
 * endpointing fires too often (every sentence) for a smooth
 * turn-taking feel.
 */

import { gatherAll } from "../context/registry.ts";
import type { ContextEntry } from "../context/types.ts";
import { appendHistory } from "../history/store.ts";
import { log } from "../log.ts";
import { SessionRecorder } from "../recordings/store.ts";
import { writeComplete as writeCompleteTranscript, writeRawSidecar } from "../transcripts/store.ts";
import { EnergyVad, type EnergyVadConfig } from "../vad/energy.ts";
import type { Voice } from "../voices/types.ts";
import type { LlmMessage, LlmProvider } from "./providers/llm/types.ts";
import type { SttProvider, SttSession } from "./providers/stt/types.ts";
import type { TtsProvider, TtsSession } from "./providers/tts/types.ts";
import type { Pipeline, PipelineCallbacks, PipelineStart } from "./types.ts";
import { SessionWatchdog } from "./watchdog.ts";

const DISCUSS_HARD_MAX_S = 300;
const DISCUSS_IDLE_TIMEOUT_S = 12;
const TTS_SPEAKER_RATE_HZ = 24000;
/** Sliding window of conversation turns sent to the LLM each round.
 *  Each LLM call ships system + last N turns; older turns drop off so
 *  the prompt token count grows linearly with N, not with session
 *  length. 16 messages ≈ 8 user/assistant pairs is enough context for
 *  a normal conversation without the cost-quadratic problem the
 *  niggly-bits audit flagged (L1). */
const HISTORY_TURN_CAP = 16;

/** Same `[Context] …` block as the realtime + dictate paths so the
 *  same prompt always sees the same rendered context. */
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

export type TraditionalDiscussDeps = {
  sttProvider: SttProvider;
  /** Provider for the *talking-phase* LLM (per-turn). Same chat-
   *  completions surface the done-phase uses, just under a different
   *  system prompt + with the conversation history attached. */
  llmProvider: LlmProvider;
  ttsProvider: TtsProvider;
  /** Optional VAD config override; defaults bake the M09-tuned values. */
  vadConfig?: Partial<EnergyVadConfig>;
};

type ConversationTurn = LlmMessage;

/** Internal lifecycle states. Drives mic gating + decisions about
 *  what to do with VAD/STT events as they arrive. */
type DiscussState =
  | "waiting_for_user" // listening, no in-flight LLM/TTS work
  | "user_speaking" // VAD speech_start fired, accumulating partials
  | "thinking" // user turn ended, LLM call in flight
  | "assistant_speaking"; // TTS streaming audio back to the endpoint

export class TraditionalDiscussPipeline implements Pipeline {
  private stt: SttSession | null = null;
  private tts: TtsSession | null = null;
  private vad: EnergyVad;
  private startedAt = Date.now();
  private watchdog: SessionWatchdog;
  private closed = false;
  private finalizing = false;

  private readonly sessionId: string;
  private readonly deviceId: string;
  private readonly voice: Voice;
  private readonly cb: PipelineCallbacks;
  private readonly recorder: SessionRecorder;

  private state: DiscussState = "waiting_for_user";
  /** Microsecond-style timer the VAD uses — cumulative audio time
   *  forwarded, in milliseconds. Independent of wall clock so the
   *  VAD's minSilenceMs comparison works even under bursty WS
   *  delivery. */
  private micCumulativeMs = 0;
  /** Microseconds-per-sample factor cached at start. */
  private msPerSample = 0;

  /** Accumulating final-segments for the current user turn. STT may
   *  emit multiple `final` events before VAD's speech_end declares
   *  the turn over. */
  private currentTurnFinals: string[] = [];

  /** Conversation history across the whole session — fed into every
   *  talking-phase LLM call and (optionally) the done-phase call.
   *  Bounded by HISTORY_TURN_CAP below before going on the wire. */
  private history: ConversationTurn[] = [];
  private contextSnapshot: ContextEntry[] = [];
  private lastError: string | null = null;
  /** Set by bargeIn(); cleared at the start of the next assistant turn.
   *  When true, incoming TTS audio frames are dropped without being
   *  forwarded to the endpoint. The TTS session itself stays alive so
   *  the next turn can speak (B2 from the niggly-bits audit: nulling
   *  the session permanently muted the assistant for the rest of the
   *  conversation). */
  private assistantDropUntilNextTurn = false;

  constructor(
    private readonly s: PipelineStart,
    private readonly deps: TraditionalDiscussDeps,
  ) {
    this.sessionId = s.sessionId;
    this.deviceId = s.deviceId;
    this.voice = s.voice;
    this.cb = s.callbacks;
    this.recorder = new SessionRecorder({
      deviceId: s.deviceId,
      sessionId: s.sessionId,
      voiceId: s.voice.id,
      voiceName: s.voice.name,
    });
    this.vad = new EnergyVad({
      sampleRateHz: s.micSampleRateHz,
      startThreshold: 800,
      endThreshold: 400,
      smoothMs: 50,
      startFrames: 2,
      minSilenceMs: 400,
      ...deps.vadConfig,
    });
    this.msPerSample = 1000 / s.micSampleRateHz;
    this.watchdog = new SessionWatchdog(
      {
        idleTimeoutS: DISCUSS_IDLE_TIMEOUT_S,
        hardMaxS: DISCUSS_HARD_MAX_S,
        label: `discuss ${s.deviceId}`,
      },
      (reason) => {
        log.info(`discuss ${this.deviceId}: watchdog ${reason} — finalizing`);
        void this.finalizeSession();
      },
    );
  }

  async start(): Promise<void> {
    const gatherPromise = gatherAll({ deviceId: this.deviceId });

    try {
      this.stt = await this.deps.sttProvider.open({
        sampleRateHz: this.s.micSampleRateHz,
        interim: true,
        model: this.voice.sttModel || undefined,
      });
    } catch (err) {
      log.warn(`discuss ${this.deviceId}: STT open failed`, err);
      this.cb.sendEvent({ type: "error", message: "STT open failed" });
      this.cb.close();
      return;
    }
    this.stt.on((ev) => this.handleSttEvent(ev));

    try {
      this.tts = await this.deps.ttsProvider.open({
        sampleRateHz: TTS_SPEAKER_RATE_HZ,
        voice: this.voice.ttsVoice || undefined,
      });
    } catch (err) {
      log.warn(`discuss ${this.deviceId}: TTS open failed`, err);
      this.cb.sendEvent({ type: "error", message: "TTS open failed" });
      this.cb.close();
      return;
    }
    this.tts.on((ev) => this.handleTtsEvent(ev));

    this.contextSnapshot = await gatherPromise;
    this.watchdog.start();
    log.info(
      `discuss started device=${this.deviceId} voice_id=${this.voice.id} ` +
        `stt=${this.deps.sttProvider.name} llm=${this.deps.llmProvider.name} ` +
        `tts=${this.deps.ttsProvider.name} sess=${this.sessionId}`,
    );
  }

  pushMic(pcm: Buffer): void {
    if (this.closed || this.finalizing || pcm.length === 0) return;
    if (!this.stt) return;

    this.recorder.pushMic(pcm);

    // Always forward to STT — server endpointing is a backup signal
    // even when our VAD is driving turn boundaries.
    this.stt.sendAudio(pcm);

    // Gate the VAD when the assistant is speaking: any mic energy
    // during model audio is most likely the model's own voice bleeding
    // back through the endpoint's mic, NOT the user trying to barge in.
    // We let explicit barge_in events handle real interruptions.
    if (this.state === "assistant_speaking") return;

    // VAD runs on every mic chunk. msPerSample × sample count tracks
    // a monotonic timestamp independent of wall clock.
    const samples = Math.floor(pcm.length / 2);
    this.micCumulativeMs += samples * this.msPerSample;
    const ev = this.vad.push(pcm, this.micCumulativeMs);
    if (ev.kind === "speech_start") {
      this.state = "user_speaking";
      this.watchdog.setUserSpeaking(true);
      this.cb.sendEvent({ type: "user_speech_start" });
    } else if (ev.kind === "speech_end" && this.state === "user_speaking") {
      this.state = "thinking";
      this.watchdog.setUserSpeaking(false);
      this.cb.sendEvent({ type: "user_speech_end" });
      // Kick off the LLM turn. Don't await — the next user_speech_start
      // can still happen if the user starts talking again before the
      // LLM finishes; the turn handler is reentrant-safe.
      void this.runAssistantTurn();
    }
  }

  readyForInput(): void {
    if (this.closed) return;
    this.watchdog.bump();
  }

  bargeIn(): void {
    if (this.closed || this.finalizing) return;
    // Stop forwarding the in-flight TTS audio to the endpoint so the
    // user can take the floor. The TTS session itself stays alive —
    // closing + nulling it would permanently mute the assistant
    // because there is no re-open path; the next runAssistantTurn
    // would see `this.tts === null` and drop every reply (B2 in the
    // niggly-bits audit). Aura's wire protocol has no `cancel`, so
    // we drop incoming audio chunks until the next turn opens fresh.
    if (this.state === "assistant_speaking") {
      log.info(`discuss ${this.deviceId}: barge_in — dropping in-flight TTS audio`);
      this.assistantDropUntilNextTurn = true;
      this.cb.sendEvent({ type: "audio_end" });
    }
    this.state = "waiting_for_user";
    this.watchdog.setAssistantSpeaking(false);
  }

  close(): void {
    if (this.closed) return;
    // If we're closing without a clean finalize, run it now so history
    // gets the entry. Idempotent inside finalizeSession.
    if (!this.finalizing) void this.finalizeSession();
    this.closed = true;
    this.watchdog.stop();
    void this.stt?.close();
    void this.tts?.close();
    this.recorder.finalize().catch((err) => {
      log.warn(`discuss ${this.deviceId}: recorder.finalize failed:`, err);
    });
    const duration = (Date.now() - this.startedAt) / 1000;
    log.info(
      `discuss closed device=${this.deviceId} sess=${this.sessionId} ` +
        `duration=${duration.toFixed(1)}s turns=${this.history.length}` +
        (this.lastError ? ` (last_error=${this.lastError})` : ""),
    );
  }

  // ─── Event handlers ───────────────────────────────────────────────

  private handleSttEvent(event: import("./providers/stt/types.ts").SttEvent): void {
    if (this.closed) return;
    if (event.type === "partial") {
      this.cb.sendEvent({ type: "transcript_delta", text: event.text });
      return;
    }
    if (event.type === "final") {
      if (event.text.trim()) this.currentTurnFinals.push(event.text.trim());
      this.recorder.pushTranscript("user", event.text);
      return;
    }
    if (event.type === "error") {
      this.lastError = event.message;
      this.cb.sendEvent({ type: "error", message: event.message });
      return;
    }
    if (event.type === "closed") {
      // STT closed unexpectedly. Finalize whatever we have.
      if (!this.finalizing) void this.finalizeSession();
    }
  }

  private handleTtsEvent(event: import("./providers/tts/types.ts").TtsEvent): void {
    if (this.closed) return;
    if (event.type === "audio") {
      // The TTS session was opened at TTS_SPEAKER_RATE_HZ; pair the
      // frame with that so the connection can resample to the
      // endpoint's declared rate.
      if (this.assistantDropUntilNextTurn) return;
      this.recorder.pushSpeaker(event.pcm);
      this.cb.sendSpeaker(event.pcm, TTS_SPEAKER_RATE_HZ);
      this.watchdog.setAssistantSpeaking(true);
      return;
    }
    if (event.type === "utterance_end") {
      this.cb.sendEvent({ type: "audio_end" });
      this.state = "waiting_for_user";
      this.watchdog.setAssistantSpeaking(false);
      return;
    }
    if (event.type === "error") {
      this.lastError = event.message;
      this.cb.sendEvent({ type: "error", message: event.message });
      // Don't tear down — TTS errors are often transient, and the
      // user can try again in the next turn.
    }
  }

  /**
   * Take the just-finished user turn, call the talking-phase LLM,
   * pipe the reply into TTS. Reentrant-safe via the `state` guard at
   * the top.
   */
  private async runAssistantTurn(): Promise<void> {
    if (this.closed || this.finalizing) return;
    if (this.state !== "thinking") return;

    // A fresh turn opens audio forwarding again — bargeIn() may have
    // muted the previous reply mid-stream.
    this.assistantDropUntilNextTurn = false;

    const userText = this.currentTurnFinals.join(" ").trim();
    this.currentTurnFinals = [];

    if (!userText) {
      // Empty turn — nothing to do. Reset to listening.
      this.state = "waiting_for_user";
      return;
    }

    log.info(
      `discuss ${this.deviceId}: user turn (${userText.length} chars): ` +
        `${userText.slice(0, 80)}${userText.length > 80 ? "…" : ""}`,
    );
    this.history.push({ role: "user", content: userText });
    this.cb.sendEvent({ type: "transcript", role: "user", text: userText });

    // Send only the recent window — full history grows unbounded and
    // ramps token cost quadratically (niggly-bits L1). Older turns
    // drop off; if the conversation actually needs deeper context we
    // can move to a summary-of-older approach later.
    const messagesForCall = this.history.slice(-HISTORY_TURN_CAP);
    if (this.history.length > HISTORY_TURN_CAP) {
      log.debug(
        `discuss ${this.deviceId}: history sliced to last ${HISTORY_TURN_CAP} ` +
          `(full=${this.history.length})`,
      );
    }

    let assistantText: string;
    try {
      const resp = await this.deps.llmProvider.complete({
        systemPrompt: this.voice.talkingPrompt,
        contextBlock: renderContextBlock(this.contextSnapshot),
        messages: messagesForCall,
        model: this.voice.model || "",
        // Discuss turns lean on the warm end of the spectrum — a flat
        // 0.7 is the cheap-shot default until per-voice tuning lands.
        temperature: 0.7,
      });
      assistantText = resp.text.trim();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn(`discuss ${this.deviceId}: LLM failed`, err);
      this.lastError = msg;
      this.cb.sendEvent({ type: "error", message: msg });
      this.state = "waiting_for_user";
      return;
    }

    if (!assistantText) {
      // Model returned nothing — skip the TTS step.
      this.state = "waiting_for_user";
      return;
    }

    log.info(
      `discuss ${this.deviceId}: assistant turn (${assistantText.length} chars): ` +
        `${assistantText.slice(0, 80)}${assistantText.length > 80 ? "…" : ""}`,
    );
    this.history.push({ role: "assistant", content: assistantText });
    this.recorder.pushTranscript("assistant", assistantText);
    this.cb.sendEvent({ type: "transcript", role: "assistant", text: assistantText });

    // Bridge to TTS. The pipeline drives audio_start manually so the
    // endpoint can light its "speaking" LED at the right moment;
    // audio_end fires when Aura's Flushed envelope arrives.
    if (!this.tts) {
      log.warn(`discuss ${this.deviceId}: TTS gone, dropping assistant audio`);
      this.state = "waiting_for_user";
      return;
    }
    this.state = "assistant_speaking";
    this.watchdog.setAssistantSpeaking(true);
    this.cb.sendEvent({ type: "audio_start" });
    this.tts.speak(assistantText);
    this.tts.flush();
  }

  /**
   * Terminal step. Idempotent. Runs the done-phase LLM if the voice
   * has a `donePrompt`, emits a final transcript event with the
   * resulting artifact, appends history.
   */
  private async finalizeSession(): Promise<void> {
    if (this.finalizing || this.closed) return;
    this.finalizing = true;
    this.watchdog.setUserSpeaking(false);
    this.watchdog.setAssistantSpeaking(false);

    if (this.history.length === 0) {
      log.info(`discuss ${this.deviceId}: empty session — closing without history`);
      this.cb.close();
      return;
    }

    // Render the conversation as raw text for history + the done-phase
    // prompt. Plain "User: …\nAssistant: …\n" works for the LLM input
    // and is the simplest thing for history search/grep.
    const rawConversation = this.history
      .map((t) => `${t.role === "user" ? "User" : "Assistant"}: ${t.content}`)
      .join("\n\n");

    let finalText = rawConversation;
    let processedText: string | null = null;

    if (this.voice.donePrompt.trim()) {
      try {
        const resp = await this.deps.llmProvider.complete({
          systemPrompt: this.voice.donePrompt,
          contextBlock: renderContextBlock(this.contextSnapshot),
          userText: rawConversation,
          model: this.voice.postProcessModel || "",
          temperature: 0.2,
        });
        processedText = resp.text;
        if (processedText && processedText.trim() !== rawConversation.trim()) {
          finalText = processedText;
          await writeRawSidecar(this.deviceId, this.sessionId, "user", rawConversation).catch((e) =>
            log.debug(`discuss ${this.deviceId}: raw sidecar write failed`, e),
          );
        } else {
          processedText = null;
        }
      } catch (err) {
        log.warn(`discuss ${this.deviceId}: done-phase LLM failed, using raw`, err);
        // Warn-but-no-fail: discuss reuses the talking-phase llmProvider
        // (its key is bound at construction by the orchestrator), so
        // there's no per-call key to thread here. The session keeps
        // its raw conversation transcript on the failure path.
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
      rawText: rawConversation,
      processedText,
      postProcessProvider: processedText ? this.voice.postProcessProvider : null,
      postProcessModel: processedText ? this.voice.postProcessModel : null,
      contextSnapshot: this.contextSnapshot,
      transcriptPath: completed.path,
    });

    this.cb.close();
  }
}
