/**
 * Per-puck session: marries one puck WS to one OpenAI Realtime WS and
 * relays audio + transcripts both ways.
 *
 * Lifecycle (realtime mode):
 *   1. Puck WS opens, sends hello with auth token + mode_id.
 *   2. Daemon validates token, resolves mode from the catalog.
 *   3. (later) Context sources gather in parallel — areas/persons
 *      from HA, focused window from Mac. The collected context is
 *      injected into the realtime session.instructions.
 *   4. OpenAI Realtime WS opens with the mode's voice/model/prompt
 *      plus the gathered context.
 *   5. Mic bytes flow puck → upsample 16→24 → OpenAI.
 *   6. audio.delta + transcript events flow OpenAI → puck.
 *   7. Either side closes → tear down the other.
 *
 * Lifecycle (dictation mode):
 *   Same up to step 4, but `output_modalities: ["text"]` — no voice
 *   response. After `transcript.completed` lands, if the mode has a
 *   `postProcessPrompt`, raw transcript runs through the post-proc
 *   LLM (OpenAI or OpenRouter). Polished text goes to the puck and
 *   to history. Raw is preserved in a `.raw.txt` sidecar.
 *
 * Cost guards:
 *   • Idle close: if no speech is detected within IDLE_TIMEOUT_S, drop
 *     the session. Catches "user walked away" without us holding an
 *     OpenAI session open at billing rate.
 *   • Hard ceiling: SESSION_HARD_MAX_S. Defensive — a runaway session
 *     can't accidentally bill multi-minute audio.
 */

import { randomBytes } from "node:crypto";
import { EchoGate } from "../audio/echo_gate.ts";
import { createResampler, resampleChunk } from "../audio/resample.ts";
import { callTool, gatherAll, listAllTools } from "../context/registry.ts";
import { voixSource } from "../context/sources/voix.ts";
import type { ContextEntry, ToolSpec } from "../context/types.ts";
import { config } from "../env.ts";
import { appendHistory } from "../history/store.ts";
import { log } from "../log.ts";
import { getMode } from "../modes/store.ts";
import type { Mode } from "../modes/types.ts";
import { postProcess } from "../post_process/index.ts";
import {
  OpenAIRealtimeClient,
  type RealtimeEvent,
  type RealtimeSessionConfig,
} from "../realtime/openai.ts";
import {
  forget as forgetTranscript,
  writeComplete as writeCompleteTranscript,
  writePartial as writePartialTranscript,
  writeRawSidecar,
} from "../transcripts/store.ts";
import type { DaemonToPuck, PuckHello } from "./protocol.ts";

/**
 * Minimal interface PuckSession needs from the underlying WebSocket.
 * Defined here (instead of pulling Bun's full `ServerWebSocket<T>`) so
 * the session is decoupled from Elysia's internal generic chain — any
 * structurally-compatible socket works.
 */
export type WSLike = {
  send(data: string): unknown;
  sendBinary(data: ArrayBufferView | ArrayBuffer): unknown;
  close(code?: number, reason?: string): unknown;
};

const PUCK_INPUT_RATE = 16000; // Voice PE mic
const OPENAI_RATE = 24000; // Required minimum for Realtime input
const IDLE_TIMEOUT_S = 5.0;
const SESSION_HARD_MAX_S = 180.0;

/** Render context entries into the `[Context] …` block we inject into
 *  realtime instructions and post-processing prompts. Source-agnostic
 *  — each entry's `data` is rendered as key/value lines under a
 *  per-source header.
 *
 *  Module-level so both the per-instance renderer (post-proc) and
 *  `composeRealtimeInstructions` use the same format. Empty input →
 *  empty string so callers can `if (block)` to decide whether to emit
 *  a separator. */
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

/** Drop the `__source` field before sending tool specs to OpenAI —
 *  that field is internal routing metadata, OpenAI rejects unknown
 *  keys in the tools array. */
function stripInternalSourceField(spec: ToolSpec): Omit<ToolSpec, "__source"> {
  const { __source: _, ...rest } = spec;
  return rest;
}

export type SessionDeps = {
  openaiApiKey: string;
  hello: PuckHello;
};

/** A single puck ↔ OpenAI session. Owns both WS clients. */
export class PuckSession {
  private openai: OpenAIRealtimeClient | null = null;
  private upsample = createResampler(PUCK_INPUT_RATE, OPENAI_RATE);
  /** Echo gate — drops mic chunks that look like the model's own
   *  speech bleeding back through the puck's mic. Only used for
   *  realtime mode (dictation has no model output, no echo to gate). */
  private echoGate = new EchoGate();
  private startedAt = Date.now();
  private lastSpeechActivity = Date.now();
  private watchdogTimer: ReturnType<typeof setInterval> | null = null;
  private userSpeaking = false;
  private closed = false;
  /** Periodic gate-stats logger counter. */
  private echoLogCounter = 0;

  private readonly sessionId = randomBytes(8).toString("hex");
  private mode: Mode;
  /** Accumulated user transcript across delta events. */
  private userPartial = "";
  /** Set to the first error message we hand off to history so the entry
   *  is still recorded — silent failures are awful to debug. */
  private lastError: string | null = null;
  /** Snapshot the daemon would have prepended to session.instructions
   *  (and to the post-proc prompt). For now it's empty — the context
   *  layer fills it in once the MCP client lands. */
  private contextSnapshot: ContextEntry[] = [];

  constructor(
    private readonly ws: WSLike,
    private readonly deps: SessionDeps,
  ) {
    // Resolve once at construction. The mode catalog is a stable
    // in-memory map — no async I/O here.
    this.mode = getMode(this.deps.hello.mode_id);
  }

  async start(): Promise<void> {
    // Kick off context gather + tool enumeration BEFORE awaiting the
    // OpenAI WS connect. Both finish in parallel with the realtime
    // handshake (~100ms each), so by the time session.update lands we
    // have everything we need to inject context + tools in a single
    // shot. Race conditions: if gather is slow, we send session.update
    // with empty context but full tools — the model can call tools
    // mid-conversation to fill in what it needs.
    const gatherPromise = gatherAll({ deviceId: this.deps.hello.device_id });
    const toolsPromise = listAllTools();

    const mode = this.mode;
    const cfg = this.buildRealtimeConfig(mode);

    this.openai = new OpenAIRealtimeClient(this.deps.openaiApiKey, cfg);
    this.openai.on((event) => void this.handleOpenAIEvent(event));

    try {
      await this.openai.connect();
    } catch (err) {
      log.warn("session: failed to connect OpenAI:", err);
      this.sendToPuck({ type: "error", message: "openai connect failed" });
      this.close();
      return;
    }

    // Wait for context + tools (or their per-source timeouts). For
    // dictation modes we skip the tool registration — text-only
    // sessions don't function-call.
    const [contextEntries, tools] = await Promise.all([
      gatherPromise,
      mode.type === "realtime" ? toolsPromise : Promise.resolve<ToolSpec[]>([]),
    ]);
    this.contextSnapshot = contextEntries;

    // Re-send session.update now that we have context + tools. The
    // initial connect() emitted a session.update with the mode's
    // static instructions; this one layers in the gathered context.
    if (mode.type === "realtime") {
      this.openai.updateSession({
        instructions: this.composeRealtimeInstructions(mode, contextEntries),
        tools: tools.map(stripInternalSourceField),
      });
      log.info(
        `session: ${this.deps.hello.device_id} context_entries=${contextEntries.length} tools=${tools.length}`,
      );
    }

    // Let the voix builtin source close us when the model invokes
    // voix__end_session. Bound late so the tool call routes only after
    // the session is fully spun up.
    if (mode.type === "realtime") {
      voixSource.bindSession(this.deps.hello.device_id, (reason) => {
        log.info(`session: ${this.deps.hello.device_id} voix.end_session — ${reason}`);
        this.close();
      });
    }

    this.sendToPuck({ type: "ready", mode: mode.type });
    log.info(
      `session: started device=${this.deps.hello.device_id} mode=${mode.type} ` +
        `mode_id=${mode.id} sess=${this.sessionId}`,
    );

    // Watchdog runs every second — cheaper than resetting a timer on
    // every audio chunk, and one second is well below our idle
    // threshold.
    this.watchdogTimer = setInterval(() => this.watchdogTick(), 1000);
  }

  /** Combine the mode's static system prompt with the dynamic context
   *  block. The block goes BEFORE the mode prompt so the model reads
   *  "what's going on" before "what's my role". */
  private composeRealtimeInstructions(mode: Mode, entries: ContextEntry[]): string {
    const parts: string[] = [];
    const ctx = renderContextBlock(entries);
    if (ctx) parts.push(ctx);
    if (mode.addendum.trim()) parts.push(mode.addendum.trim());
    if (mode.prompt.trim()) parts.push(mode.prompt.trim());
    return parts.join("\n\n");
  }

  private buildRealtimeConfig(mode: Mode): RealtimeSessionConfig {
    if (mode.type === "dictation") {
      return {
        // The realtime model is required even for transcription-only
        // sessions — the inner transcription_model is what actually
        // produces text. gpt-realtime-2 is the cheapest realtime SKU.
        model: "gpt-realtime-2",
        outputModalities: ["text"],
        instructions: "",
        transcribeModel: mode.sttModel || "gpt-4o-mini-transcribe",
        // Dictation: VAD high means "stop listening quickly after a
        // pause". For ramble-y dictation it's too eager; we'll make
        // this per-mode tunable once we see real usage.
        vadEagerness: "high",
      };
    }
    return {
      model: mode.model || "gpt-realtime-2",
      outputModalities: ["audio"],
      instructions: mode.prompt,
      transcribeModel: mode.sttModel || "gpt-4o-mini-transcribe",
      voice: mode.voice || "alloy",
      vadEagerness: "medium",
    };
  }

  /**
   * Called by the WS server when a binary frame lands. Pucks send raw
   * PCM16 @ 16 kHz; we upsample to 24 kHz and forward to OpenAI —
   * except realtime sessions go through the echo gate first to drop
   * chunks that look like the model's own voice bleeding back through
   * the mic (without this, sessions loop forever on the model's own
   * "Sounds good" → semantic_vad → reply → repeat).
   */
  handlePuckAudio(pcm16k: Buffer): void {
    if (this.closed || !this.openai) return;
    if (pcm16k.length === 0) return;
    this.lastSpeechActivity = Date.now();

    if (this.mode.type === "realtime") {
      const { forward, micRms, peakRefRms } = this.echoGate.shouldForward(pcm16k);
      // Log every ~50 chunks (~3s of 16 kHz mic) so we can see how the
      // gate is performing without flooding logs.
      this.echoLogCounter++;
      if (this.echoLogCounter % 50 === 0) {
        log.debug(
          `session: mic gate ${forward ? "forward" : "drop"} ` +
            `mic_rms=${Math.round(micRms)} ref=${Math.round(peakRefRms)} ` +
            `(${this.echoGate.stats()})`,
        );
      }
      if (!forward) return;
    }

    const pcm24k = resampleChunk(pcm16k, this.upsample);
    this.openai.sendAudio(pcm24k);
  }

  private async handleOpenAIEvent(event: RealtimeEvent): Promise<void> {
    switch (event.type) {
      case "speech.started":
        this.userSpeaking = true;
        this.lastSpeechActivity = Date.now();
        this.sendToPuck({ type: "user_speech_start" });
        break;

      case "speech.stopped":
        this.userSpeaking = false;
        this.lastSpeechActivity = Date.now();
        this.sendToPuck({ type: "user_speech_end" });
        break;

      case "transcript.delta":
        if (event.role === "user") {
          this.userPartial += event.delta;
          this.sendToPuck({ type: "transcript_delta", text: event.delta });
          // Best-effort partial write so the Mac app can read live
          // progress without holding state itself.
          await writePartialTranscript(
            this.deps.hello.device_id,
            this.sessionId,
            "user",
            this.userPartial,
          ).catch((e) => log.debug("session: partial write failed", e));
        }
        break;

      case "transcript.completed":
        if (event.role === "user") {
          await this.handleUserTranscriptComplete(event.text);
        } else if (event.text.trim()) {
          // Assistant transcripts (realtime sessions): log + emit to
          // the puck for the Mac app's live caption view. No post-
          // processing — the model already shaped the text the way
          // the user heard it.
          const t = event.text.trim();
          log.info(
            `session: ${this.deps.hello.device_id} assistant said ` +
              `(${t.length} chars): ${t.slice(0, 100)}${t.length > 100 ? "…" : ""}`,
          );
        }
        break;

      case "audio.delta":
        // Forward OpenAI's 24 kHz speaker audio straight to the puck —
        // the firmware plays at 24 kHz natively, no further resampling
        // needed. Also record it with the echo gate so subsequent mic
        // chunks know how much echo to expect.
        this.echoGate.observeSpeaker(event.pcm24kBytes);
        this.sendBinaryToPuck(event.pcm24kBytes);
        break;

      case "function_call.requested":
        await this.handleFunctionCall(event.callId, event.name, event.argumentsJson);
        break;

      case "error":
        log.warn("session: openai error", event.message);
        this.lastError = event.message;
        this.sendToPuck({ type: "error", message: event.message });
        break;

      case "closed":
        log.info(`session: openai closed code=${event.code} reason=${event.reason}`);
        this.close();
        break;

      default:
        // session.created / session.updated / response.completed —
        // currently no puck-side action.
        break;
    }
  }

  /**
   * The terminal step for a dictation turn: STT finished, we have raw
   * text. Either ship it as-is (raw dictation) or send through post-
   * processing (Message / Email / Note / Code / future user-defined
   * modes). Append to history regardless so the Mac app's history UI
   * sees every turn.
   */
  private async handleUserTranscriptComplete(rawText: string): Promise<void> {
    const trimmed = rawText.trim();
    if (!trimmed) {
      log.info(`session: empty transcript (device=${this.deps.hello.device_id})`);
      return;
    }

    log.info(
      `session: ${this.deps.hello.device_id} raw transcript ` +
        `(${trimmed.length} chars): ${trimmed.slice(0, 80)}${trimmed.length > 80 ? "…" : ""}`,
    );

    let finalText = trimmed;
    let processedText: string | null = null;

    if (this.mode.type === "dictation" && this.mode.postProcessPrompt.trim()) {
      processedText = await postProcess({
        rawText: trimmed,
        systemPrompt: this.mode.postProcessPrompt,
        provider: this.mode.postProcessProvider,
        model: this.mode.postProcessModel,
        contextBlock: this.renderContextBlock(),
        keys: { openai: this.deps.openaiApiKey, openrouter: config.openrouterApiKey },
      });
      if (processedText && processedText !== trimmed) {
        finalText = processedText;
        // Preserve raw text alongside the polished version on disk.
        await writeRawSidecar(this.deps.hello.device_id, this.sessionId, "user", trimmed).catch(
          (e) => log.debug("session: raw sidecar write failed", e),
        );
      } else {
        // Post-processor returned the same text (or fell back to
        // raw on error). No sidecar needed.
        processedText = null;
      }
    }

    const completed = await writeCompleteTranscript(
      this.deps.hello.device_id,
      this.sessionId,
      "user",
      finalText,
    );

    this.sendToPuck({ type: "transcript", text: finalText });

    await appendHistory({
      deviceId: this.deps.hello.device_id,
      sessionId: this.sessionId,
      modeId: this.mode.id,
      modeName: this.mode.name,
      modeType: this.mode.type,
      durationMs: Date.now() - this.startedAt,
      rawText: trimmed,
      processedText,
      postProcessProvider: processedText ? this.mode.postProcessProvider : null,
      postProcessModel: processedText ? this.mode.postProcessModel : null,
      contextSnapshot: this.contextSnapshot,
      transcriptPath: completed.path,
    });
  }

  private renderContextBlock(): string {
    return renderContextBlock(this.contextSnapshot);
  }

  /** Model invoked a tool. Route to the registry (which dispatches by
   *  source prefix), then ship the result back to OpenAI. Errors get
   *  serialised into the result so the model can react to them rather
   *  than waiting forever — silent tool failures are awful for
   *  voice-mode UX. */
  private async handleFunctionCall(
    callId: string,
    name: string,
    argumentsJson: string,
  ): Promise<void> {
    let parsedArgs: Record<string, unknown> = {};
    try {
      const parsed = JSON.parse(argumentsJson);
      if (parsed && typeof parsed === "object") {
        parsedArgs = parsed as Record<string, unknown>;
      }
    } catch (err) {
      log.warn(`session: tool ${name} bad JSON args: ${argumentsJson.slice(0, 200)}`, err);
      this.openai?.sendToolResult(callId, JSON.stringify({ error: "could not parse arguments" }));
      return;
    }

    const startedAt = Date.now();
    const result = await callTool(name, parsedArgs);
    const elapsedMs = Date.now() - startedAt;
    log.info(
      `session: tool ${name} ${result.isError ? "ERR" : "ok"} in ${elapsedMs}ms ` +
        `(out=${result.content.length} chars)`,
    );
    this.openai?.sendToolResult(callId, result.content);
  }

  private watchdogTick(): void {
    if (this.closed) return;
    const now = Date.now();
    const idleS = (now - this.lastSpeechActivity) / 1000;
    const totalS = (now - this.startedAt) / 1000;

    if (totalS > SESSION_HARD_MAX_S) {
      log.warn(
        `session: hard ceiling ${SESSION_HARD_MAX_S}s hit ` +
          `(device=${this.deps.hello.device_id}) — closing`,
      );
      this.close();
      return;
    }
    if (!this.userSpeaking && idleS > IDLE_TIMEOUT_S) {
      log.info(
        `session: idle ${idleS.toFixed(1)}s > ${IDLE_TIMEOUT_S}s ` +
          `(device=${this.deps.hello.device_id}) — closing`,
      );
      this.close();
    }
  }

  private sendToPuck(msg: DaemonToPuck): void {
    if (this.closed) return;
    try {
      this.ws.send(JSON.stringify(msg));
    } catch (e) {
      log.debug("session: send-text to puck failed", e);
    }
  }

  private sendBinaryToPuck(bytes: Buffer): void {
    if (this.closed) return;
    try {
      this.ws.sendBinary(bytes);
    } catch (e) {
      log.debug("session: send-binary to puck failed", e);
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.watchdogTimer) {
      clearInterval(this.watchdogTimer);
      this.watchdogTimer = null;
    }
    void this.openai?.close();
    try {
      this.ws.close(1000, "session closed");
    } catch (e) {
      log.debug("session: ws.close threw", e);
    }
    voixSource.unbindSession(this.deps.hello.device_id);
    forgetTranscript(this.deps.hello.device_id, this.sessionId);
    const duration = (Date.now() - this.startedAt) / 1000;
    log.info(
      `session: closed device=${this.deps.hello.device_id} ` +
        `sess=${this.sessionId} duration=${duration.toFixed(1)}s` +
        (this.lastError ? ` (last_error=${this.lastError})` : ""),
    );
  }
}
