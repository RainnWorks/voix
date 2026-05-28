/**
 * OpenAI Realtime client — thin adapter over the official SDK.
 *
 * Was hand-rolled when the daemon first landed because HA Core pinned
 * an old `openai` Python that lacked GA Realtime. The daemon has no
 * such pin, so we use `openai/realtime/ws` directly. The SDK gives us
 * typed server events for every message type, automatic auth, and
 * URL building — we just translate its events into the internal
 * `RealtimeEvent` union the rest of the daemon already consumes.
 *
 * GA schema (post May 2026):
 *   { type: "realtime", output_modalities: ["audio"|"text"],
 *     audio: { input: { format, transcription, turn_detection,
 *                       noise_reduction },
 *              output: { format, voice } },
 *     instructions, tools }
 *
 * (The deprecated beta shape — flat `modalities` / `input_audio_format`
 * keys at the top level — is rejected with `beta_api_shape_disabled`.
 * The SDK's typed `session.update` accepts both shapes; we send GA.)
 */

import { OpenAI } from "openai";
import { OpenAIRealtimeWS } from "openai/realtime/ws";
import type {
  RealtimeAudioConfig,
  RealtimeFunctionTool,
  RealtimeSessionCreateRequest,
} from "openai/resources/realtime/realtime";
import { log } from "../log.ts";

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
  /** Inner transcription model. Always set in practice — we want user
   *  transcripts on every session, even the audio ones. */
  transcribeModel?: string;
  /** Voice for `output_modalities: ["audio"]`. Ignored for text-only. */
  voice?: string;
  /** semantic_vad eagerness. Higher = the model stops listening sooner
   *  after a pause. "high" works for short dictation; "low" is more
   *  patient for ramble-y inputs. */
  vadEagerness?: "low" | "medium" | "high";
  /** Tool specs to register up front. Empty array = no tools. Populated
   *  by the context registry once MCP sources are wired. The shape is
   *  the SDK's `RealtimeFunctionTool`; MCP tools belong in a separate
   *  array which we don't expose here yet. */
  tools?: RealtimeFunctionTool[];
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
       *  tool-call handler) routes to the right context source via
       *  the registry, then replies with `sendToolResult(callId, …)`. */
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
  private rt: OpenAIRealtimeWS | null = null;
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
    const client = new OpenAI({ apiKey: this.apiKey });
    const rt = new OpenAIRealtimeWS({ model: this.cfg.model }, client);
    this.rt = rt;

    // Wire SDK events to our internal RealtimeEvent stream BEFORE
    // waiting for the socket to open — buffered events fire as soon as
    // the open handshake completes, and we don't want to miss
    // session.created.
    this.wireEvents(rt);

    // The SDK's emitter resolves "session.created" when the server
    // accepts us. Wait for that (or an early error/close) before
    // returning so callers can issue session.update straight away.
    await new Promise<void>((resolve, reject) => {
      const off = () => {
        rt.off("session.created", onCreated);
        rt.off("error", onError);
        rt.socket.removeEventListener("close", onClose);
      };
      const onCreated = (): void => {
        off();
        resolve();
      };
      const onError = (err: unknown): void => {
        off();
        reject(err instanceof Error ? err : new Error(String(err)));
      };
      const onClose = (ev: { code: number; reason: string }): void => {
        off();
        reject(new Error(`WS closed during connect: ${ev.code} ${ev.reason}`));
      };
      rt.on("session.created", onCreated);
      rt.on("error", onError);
      rt.socket.addEventListener("close", onClose);
    });

    // Initial session.update — sets instructions/voice/tools/VAD per
    // the mode. The caller may follow with a second updateSession()
    // once context gathering completes (see PuckSession.start).
    rt.send({ type: "session.update", session: this.buildSessionBody() });
  }

  private wireEvents(rt: OpenAIRealtimeWS): void {
    rt.on("session.created", (event) => this.emit({ type: "session.created", raw: event }));
    rt.on("session.updated", (event) => this.emit({ type: "session.updated", raw: event }));

    rt.on("input_audio_buffer.speech_started", (event) =>
      this.emit({ type: "speech.started", raw: event }),
    );
    rt.on("input_audio_buffer.speech_stopped", (event) =>
      this.emit({ type: "speech.stopped", raw: event }),
    );

    rt.on("response.output_audio.delta", (event) => {
      // SDK gives us the base64 string in `delta`; we want bytes.
      if (typeof event.delta === "string" && event.delta.length > 0) {
        this.emit({
          type: "audio.delta",
          pcm24kBytes: Buffer.from(event.delta, "base64"),
        });
      }
    });

    rt.on("conversation.item.input_audio_transcription.delta", (event) => {
      const delta = typeof event.delta === "string" ? event.delta : "";
      if (delta) this.emit({ type: "transcript.delta", role: "user", delta });
    });
    rt.on("conversation.item.input_audio_transcription.completed", (event) => {
      const text = typeof event.transcript === "string" ? event.transcript : "";
      this.emit({ type: "transcript.completed", role: "user", text });
    });

    rt.on("response.output_audio_transcript.delta", (event) => {
      const delta = typeof event.delta === "string" ? event.delta : "";
      if (delta) this.emit({ type: "transcript.delta", role: "assistant", delta });
    });
    rt.on("response.output_audio_transcript.done", (event) => {
      const text = typeof event.transcript === "string" ? event.transcript : "";
      this.emit({ type: "transcript.completed", role: "assistant", text });
    });

    rt.on("response.function_call_arguments.done", (event) => {
      // SDK types call_id, name, arguments as strings on this event.
      const callId = typeof event.call_id === "string" ? event.call_id : "";
      const name = typeof event.name === "string" ? event.name : "";
      const argumentsJson = typeof event.arguments === "string" ? event.arguments : "{}";
      if (!callId || !name) {
        log.warn("realtime: malformed function_call_arguments.done", event);
        return;
      }
      this.emit({ type: "function_call.requested", callId, name, argumentsJson });
    });

    rt.on("response.done", (event) => this.emit({ type: "response.completed", raw: event }));

    rt.on("error", (err) => {
      this.emit({
        type: "error",
        message: err.message ?? String(err),
        raw: err,
      });
    });

    rt.socket.addEventListener("close", (ev) => {
      this.closed = true;
      this.emit({ type: "closed", code: ev.code, reason: ev.reason ?? "" });
    });
  }

  private buildSessionBody(): RealtimeSessionCreateRequest {
    const audio: RealtimeAudioConfig = {
      input: {
        format: { type: "audio/pcm", rate: 24000 },
        noise_reduction: { type: "near_field" },
        ...(this.cfg.transcribeModel && {
          transcription: { model: this.cfg.transcribeModel, language: "en" },
        }),
        turn_detection: {
          type: "semantic_vad",
          eagerness: this.cfg.vadEagerness ?? "medium",
        },
      },
    };
    if (this.cfg.outputModalities[0] === "audio") {
      audio.output = {
        format: { type: "audio/pcm", rate: 24000 },
        voice: this.cfg.voice ?? "alloy",
      };
    }
    return {
      type: "realtime",
      output_modalities: this.cfg.outputModalities,
      audio,
      ...(this.cfg.instructions && { instructions: this.cfg.instructions }),
      ...(this.cfg.tools && this.cfg.tools.length > 0 && { tools: this.cfg.tools }),
    };
  }

  /**
   * Send a chunk of 24 kHz PCM16 audio to OpenAI. Caller is responsible
   * for upsampling from the device's native 16 kHz before calling.
   */
  sendAudio(pcm24kBytes: Buffer): void {
    if (!this.rt || this.closed) return;
    if (pcm24kBytes.length === 0) return;
    this.safeSend({
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
    if (!this.rt || this.closed) return;
    this.safeSend({ type: "input_audio_buffer.commit" });
    this.safeSend({ type: "response.create" });
  }

  /**
   * Send the result of a tool call back to OpenAI. The model paused
   * its response while waiting for this; once it lands the model
   * resumes and incorporates the result into its reply.
   */
  sendToolResult(callId: string, output: string): void {
    if (!this.rt || this.closed) return;
    this.safeSend({
      type: "conversation.item.create",
      item: {
        type: "function_call_output",
        call_id: callId,
        output,
      },
    });
    this.safeSend({ type: "response.create" });
  }

  /**
   * Replace the session's tools + (optionally) refresh instructions.
   * Used after context-gather completes — the daemon registers tools
   * at session.update#1 with placeholder instructions, then issues a
   * second session.update once context has been gathered.
   */
  updateSession(patch: { instructions?: string; tools?: RealtimeFunctionTool[] }): void {
    if (!this.rt || this.closed) return;
    const session: RealtimeSessionCreateRequest = {
      type: "realtime",
      ...(patch.instructions !== undefined && { instructions: patch.instructions }),
      ...(patch.tools !== undefined && { tools: patch.tools }),
    };
    this.safeSend({ type: "session.update", session });
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    try {
      this.rt?.close({ code: 1000, reason: "client close" });
    } catch (e) {
      log.debug("realtime: close threw", e);
    }
  }

  /** Wrap `rt.send` so any underlying WS-state hiccup is logged and
   *  swallowed. `ws` package validates readyState internally; in
   *  practice this is belt-and-braces for the close race. */
  private safeSend(event: Parameters<OpenAIRealtimeWS["send"]>[0]): void {
    if (!this.rt || this.closed) return;
    try {
      this.rt.send(event);
    } catch (e) {
      log.debug("realtime: send swallowed", e);
    }
  }
}
