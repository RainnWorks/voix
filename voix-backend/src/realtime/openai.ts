/**
 * OpenAI Realtime WS client.
 *
 * One instance = one realtime session. Opens a WS to
 * `wss://api.openai.com/v1/realtime?model=…`, sends the GA-schema
 * session.update, and exposes a typed event stream consumers can
 * subscribe to.
 *
 * GA schema (post May 2026) — what OpenAI accepts now and what the
 * deprecated beta shape was for context:
 *
 *   GA (this code):
 *     { type: "realtime",
 *       output_modalities: ["audio"] | ["text"],
 *       audio: { input: { format, noise_reduction, transcription,
 *                          turn_detection },
 *                output: { format, voice } } }
 *
 *   Beta (rejected with `beta_api_shape_disabled`):
 *     { modalities, input_audio_format, input_audio_transcription, … }
 *
 * The hand-rolled WS exists because HA Core pins openai==2.21.0 which
 * predates the GA SDK. Here in the daemon we're free to add the
 * official `openai` JS SDK later — for v1 the surface is small enough
 * (session.update, input_audio_buffer.append, parsing 6 event types)
 * that the SDK doesn't pay rent yet.
 */

import { log } from "../log.ts";

const OPENAI_WS_URL = "wss://api.openai.com/v1/realtime";

export type RealtimeMode = "realtime" | "transcription";

export type RealtimeSessionConfig = {
  /** Model ID. e.g. `gpt-realtime-2` for full bidir, `gpt-4o-mini-transcribe`
   *  for transcription-only sessions. */
  model: string;
  /** "audio" for full bidirectional voice, "text" for transcription-only
   *  (dictation). */
  outputModalities: ["audio"] | ["text"];
  /** System prompt sent in session.update. Empty string = let OpenAI use
   *  its default. */
  instructions: string;
  /** Inner transcription model. Optional — only set for sessions that
   *  also need user-side transcripts (which is basically all of them). */
  transcribeModel?: string;
  /** Voice for `output_modalities: ["audio"]`. Ignored for text-only. */
  voice?: string;
  /** semantic_vad eagerness. Higher = the model stops listening sooner
   *  after a pause. We've found "high" works for short dictation; "low"
   *  is more patient for ramble-y inputs. */
  vadEagerness?: "low" | "medium" | "high";
  /** Tool specs to register up front. Empty array = no tools. We'll
   *  populate this from MCP server enumerations once the MCP layer
   *  lands; for v1 it stays empty. */
  tools?: unknown[];
};

export type RealtimeEvent =
  | { type: "session.created"; raw: unknown }
  | { type: "session.updated"; raw: unknown }
  | { type: "speech.started"; raw: unknown }
  | { type: "speech.stopped"; raw: unknown }
  | { type: "audio.delta"; pcm24kBytes: Buffer }
  | {
      type: "transcript.delta";
      role: "user" | "assistant";
      delta: string;
    }
  | {
      type: "transcript.completed";
      role: "user" | "assistant";
      text: string;
    }
  | {
      /** The model wants to call a tool. The relay (PuckSession's
       *  tool-call handler) routes to the right context source via the
       *  registry, then replies with `sendToolResult(callId, …)`. */
      type: "function_call.requested";
      callId: string;
      name: string;
      argumentsJson: string;
    }
  | { type: "response.completed"; raw: unknown }
  | { type: "error"; message: string; raw?: unknown }
  | { type: "closed"; code: number; reason: string };

type Listener = (e: RealtimeEvent) => void;

export class OpenAIRealtimeClient {
  private ws: WebSocket | null = null;
  private listeners = new Set<Listener>();
  private closed = false;

  constructor(
    private readonly apiKey: string,
    private readonly cfg: RealtimeSessionConfig,
  ) {}

  on(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(event: RealtimeEvent): void {
    for (const l of this.listeners) {
      try {
        l(event);
      } catch (err) {
        log.warn("realtime listener threw:", err);
      }
    }
  }

  async connect(): Promise<void> {
    const url = `${OPENAI_WS_URL}?model=${encodeURIComponent(this.cfg.model)}`;
    // Bun's WebSocket supports custom headers via the second arg's
    // `headers` field — Node's stock WebSocket doesn't. Locking to
    // Bun is fine; the whole daemon assumes Bun runtime.
    this.ws = new WebSocket(url, {
      headers: { Authorization: `Bearer ${this.apiKey}` },
    } as unknown as string[]);

    this.ws.binaryType = "arraybuffer";

    await new Promise<void>((resolve, reject) => {
      const onOpen = (): void => {
        this.ws?.removeEventListener("open", onOpen);
        this.ws?.removeEventListener("error", onError);
        resolve();
      };
      const onError = (ev: Event): void => {
        this.ws?.removeEventListener("open", onOpen);
        this.ws?.removeEventListener("error", onError);
        reject(new Error(`OpenAI WS connect failed: ${(ev as ErrorEvent).message ?? ev.type}`));
      };
      this.ws?.addEventListener("open", onOpen);
      this.ws?.addEventListener("error", onError);
    });

    this.ws.addEventListener("message", (ev) => this.handleMessage(ev.data));
    this.ws.addEventListener("close", (ev) => {
      this.closed = true;
      this.emit({ type: "closed", code: ev.code, reason: ev.reason });
    });
    this.ws.addEventListener("error", (ev) => {
      this.emit({
        type: "error",
        message: `WS error: ${(ev as ErrorEvent).message ?? ev.type}`,
      });
    });

    // Configure the session immediately. OpenAI accepts session.update
    // before any audio has been sent, and the configuration applies to
    // the upcoming turn.
    this.sendJSON({
      type: "session.update",
      session: this.buildSessionBody(),
    });
  }

  private buildSessionBody(): Record<string, unknown> {
    const audio: Record<string, unknown> = {
      input: {
        format: { type: "audio/pcm", rate: 24000 },
        noise_reduction: { type: "near_field" },
        ...(this.cfg.transcribeModel
          ? {
              transcription: {
                model: this.cfg.transcribeModel,
                language: "en",
              },
            }
          : {}),
        turn_detection: {
          type: "semantic_vad",
          eagerness: this.cfg.vadEagerness ?? "medium",
        },
      },
    };
    if (this.cfg.outputModalities[0] === "audio") {
      audio["output"] = {
        format: { type: "audio/pcm", rate: 24000 },
        voice: this.cfg.voice ?? "alloy",
      };
    }
    return {
      type: "realtime",
      output_modalities: this.cfg.outputModalities,
      audio,
      ...(this.cfg.instructions ? { instructions: this.cfg.instructions } : {}),
      ...(this.cfg.tools && this.cfg.tools.length > 0 ? { tools: this.cfg.tools } : {}),
    };
  }

  /**
   * Send a chunk of 24 kHz PCM16 audio to OpenAI. Caller is responsible
   * for upsampling from the device's native 16 kHz before calling.
   */
  sendAudio(pcm24kBytes: Buffer): void {
    if (!this.ws || this.closed) return;
    if (pcm24kBytes.length === 0) return;
    // base64-in-JSON is what the GA API accepts. Binary frames are
    // reserved for future use per OpenAI docs.
    this.sendJSON({
      type: "input_audio_buffer.append",
      audio: pcm24kBytes.toString("base64"),
    });
  }

  /**
   * Tell OpenAI to commit the current input audio buffer and produce
   * a response. Most useful for explicit end-of-turn signalling when
   * semantic VAD isn't doing the right thing — for normal sessions
   * we leave VAD to handle it.
   */
  commitAndRespond(): void {
    if (!this.ws || this.closed) return;
    this.sendJSON({ type: "input_audio_buffer.commit" });
    this.sendJSON({ type: "response.create" });
  }

  /**
   * Send the result of a tool call back to OpenAI. The model paused
   * its response while waiting for this; once it lands the model
   * resumes and incorporates the result into its reply.
   *
   * Per OpenAI Realtime docs: a `conversation.item.create` of type
   * `function_call_output` with the matching `call_id`, then a
   * `response.create` to nudge the model to continue. (Async tool
   * calls in `gpt-realtime-2` GA don't strictly require the second
   * step — the model continues speaking while tools resolve — but
   * sending it is harmless and makes behaviour consistent across
   * older models.)
   */
  sendToolResult(callId: string, output: string): void {
    if (!this.ws || this.closed) return;
    this.sendJSON({
      type: "conversation.item.create",
      item: {
        type: "function_call_output",
        call_id: callId,
        output,
      },
    });
    this.sendJSON({ type: "response.create" });
  }

  /**
   * Replace the session's tools + (optionally) refresh instructions.
   * Used after context-gather completes — the daemon registers tools
   * at session.update#1 with placeholder instructions, then issues a
   * second session.update once context has been gathered.
   */
  updateSession(patch: { instructions?: string; tools?: unknown[] }): void {
    if (!this.ws || this.closed) return;
    const session: Record<string, unknown> = { type: "realtime" };
    if (patch.instructions !== undefined) session["instructions"] = patch.instructions;
    if (patch.tools !== undefined) session["tools"] = patch.tools;
    this.sendJSON({ type: "session.update", session });
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    try {
      this.ws?.close(1000, "client close");
    } catch (e) {
      log.debug("realtime: close threw", e);
    }
  }

  private sendJSON(payload: unknown): void {
    if (!this.ws || this.closed) return;
    try {
      this.ws.send(JSON.stringify(payload));
    } catch (e) {
      log.warn("realtime: send failed", e);
    }
  }

  private handleMessage(data: string | ArrayBuffer | Blob): void {
    if (typeof data !== "string") {
      // Spec is JSON-only; binary frames not used today.
      log.debug("realtime: ignoring non-text frame");
      return;
    }
    let msg: { type?: string; [key: string]: unknown };
    try {
      msg = JSON.parse(data);
    } catch {
      log.warn("realtime: non-JSON frame:", data.slice(0, 200));
      return;
    }
    const t = msg.type ?? "";

    switch (t) {
      case "session.created":
        this.emit({ type: "session.created", raw: msg });
        return;
      case "session.updated":
        this.emit({ type: "session.updated", raw: msg });
        return;
      case "input_audio_buffer.speech_started":
        this.emit({ type: "speech.started", raw: msg });
        return;
      case "input_audio_buffer.speech_stopped":
        this.emit({ type: "speech.stopped", raw: msg });
        return;
      case "response.output_audio.delta": {
        const audioB64 = msg["delta"] as string | undefined;
        if (audioB64) {
          this.emit({
            type: "audio.delta",
            pcm24kBytes: Buffer.from(audioB64, "base64"),
          });
        }
        return;
      }
      case "conversation.item.input_audio_transcription.delta": {
        const delta = (msg["delta"] as string) ?? "";
        if (delta) {
          this.emit({ type: "transcript.delta", role: "user", delta });
        }
        return;
      }
      case "conversation.item.input_audio_transcription.completed": {
        const text = (msg["transcript"] as string) ?? "";
        this.emit({ type: "transcript.completed", role: "user", text });
        return;
      }
      case "response.output_audio_transcript.delta": {
        const delta = (msg["delta"] as string) ?? "";
        if (delta) {
          this.emit({ type: "transcript.delta", role: "assistant", delta });
        }
        return;
      }
      case "response.output_audio_transcript.done": {
        const text = (msg["transcript"] as string) ?? "";
        this.emit({ type: "transcript.completed", role: "assistant", text });
        return;
      }
      case "response.function_call_arguments.done": {
        // Model has finished assembling the JSON arguments for a tool
        // call. The relay (PuckSession) routes to the right source.
        const callId = (msg["call_id"] as string) ?? "";
        const name = (msg["name"] as string) ?? "";
        const argumentsJson = (msg["arguments"] as string) ?? "{}";
        if (!callId || !name) {
          log.warn("realtime: malformed function_call_arguments.done", msg);
          return;
        }
        this.emit({
          type: "function_call.requested",
          callId,
          name,
          argumentsJson,
        });
        return;
      }
      case "response.done":
        this.emit({ type: "response.completed", raw: msg });
        return;
      case "error": {
        const err = (msg["error"] ?? {}) as { message?: string };
        this.emit({
          type: "error",
          message: err.message ?? JSON.stringify(msg),
          raw: msg,
        });
        return;
      }
      default:
        log.trace("realtime: unhandled event type", t);
    }
  }
}
