/**
 * OpenAI Realtime client — thin lifecycle wrapper over the official SDK.
 *
 * Owns:
 *   • Session config building (GA `type: "realtime"` shape).
 *   • Connect handshake (await `session.created` before returning).
 *   • A few compound actions that map to >1 SDK send (e.g.
 *     `sendToolResult` = `conversation.item.create` + `response.create`).
 *
 * Does NOT translate the SDK's events into our own union — that was
 * dead weight. Subscribers reach the typed emitter via `client.rt.on(
 * "response.output_audio.delta", e => …)` and get the SDK's exact
 * event type back. Adding a layer here would just duplicate the SDK's
 * type surface.
 *
 * GA session schema (post May 2026):
 *   { type: "realtime", output_modalities: ["audio"|"text"],
 *     audio: { input: {format, transcription, turn_detection,
 *                      noise_reduction },
 *              output: {format, voice} },
 *     instructions, tools }
 *
 * The deprecated beta shape (flat `modalities` / `input_audio_format`)
 * is rejected with `beta_api_shape_disabled`.
 */

import { OpenAI } from "openai";
import { OpenAIRealtimeWS } from "openai/realtime/ws";
import type {
  RealtimeAudioConfig,
  RealtimeFunctionTool,
  RealtimeSessionCreateRequest,
} from "openai/resources/realtime/realtime";
import { log } from "../log.ts";

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
   *  by the context registry once MCP sources are wired. */
  tools?: RealtimeFunctionTool[];
};

export class OpenAIRealtimeClient {
  /** The SDK instance. Public so callers can subscribe to typed events
   *  directly (`client.rt.on("response.output_audio.delta", e => …)`).
   *  Null until `connect()` resolves. */
  rt: OpenAIRealtimeWS | null = null;
  private closed = false;

  constructor(
    private readonly apiKey: string,
    private readonly cfg: RealtimeSessionConfig,
  ) {}

  /**
   * Open the WS, wait for `session.created`, then send the initial
   * `session.update` with our mode config. Caller can subscribe to
   * `this.rt.on(...)` either before or after this resolves — the SDK
   * buffers handlers across the handshake.
   */
  async connect(): Promise<void> {
    const client = new OpenAI({ apiKey: this.apiKey });
    const rt = new OpenAIRealtimeWS({ model: this.cfg.model }, client);
    this.rt = rt;

    await new Promise<void>((resolve, reject) => {
      const off = (): void => {
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

    rt.send({ type: "session.update", session: this.buildSessionBody() });
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
   * Send a chunk of 24 kHz PCM16 audio. Caller is responsible for
   * upsampling from the device's native 16 kHz before calling.
   */
  sendAudio(pcm24kBytes: Buffer): void {
    if (!this.rt || this.closed || pcm24kBytes.length === 0) return;
    this.safeSend({
      type: "input_audio_buffer.append",
      audio: pcm24kBytes.toString("base64"),
    });
  }

  /**
   * Tell OpenAI to commit the current input audio buffer and produce
   * a response. Most useful for explicit end-of-turn signalling when
   * semantic VAD isn't doing the right thing.
   */
  commitAndRespond(): void {
    if (!this.rt || this.closed) return;
    this.safeSend({ type: "input_audio_buffer.commit" });
    this.safeSend({ type: "response.create" });
  }

  /**
   * Send the result of a tool call back to OpenAI.
   *
   * Just the `function_call_output` — NO `response.create` follow-up.
   * `gpt-realtime-2` GA does async tool calls natively: the model is
   * already running its response when it issued the tool call, the
   * result lands and is incorporated into the in-flight response.
   * Sending `response.create` after every tool result causes
   * "Conversation already has an active response in progress" errors
   * when the model parallel-calls multiple tools — the first call's
   * `response.create` starts the response, then the second tool result
   * tries to start ANOTHER response while the first is still streaming.
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

  isClosed(): boolean {
    return this.closed;
  }

  /** Belt-and-braces around `rt.send` — swallow + log any throw from
   *  the underlying socket race. `ws` validates readyState internally;
   *  this is here for the close-race edge cases. */
  private safeSend(event: Parameters<OpenAIRealtimeWS["send"]>[0]): void {
    if (!this.rt || this.closed) return;
    try {
      this.rt.send(event);
    } catch (e) {
      log.debug("realtime: send swallowed", e);
    }
  }
}
