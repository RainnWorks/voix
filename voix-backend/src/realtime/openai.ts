/**
 * OpenAI Realtime adapter — the translation layer behind the neutral
 * `RealtimeProvider` seam (M-Arch Wave B / refactor #1).
 *
 * Owns:
 *   • Session config building (GA `type: "realtime"` shape).
 *   • Connect handshake (await `session.created` before `open()` resolves).
 *   • INBOUND translation: SDK events → neutral `RealtimeEvent` (the
 *     `rt.on(...)` subscriptions that used to live in
 *     `pipeline/realtime.ts:wireRealtimeEvents`).
 *   • OUTBOUND translation: neutral `ToolSpec` → `RealtimeFunctionTool`
 *     (`toOpenAiTool`); compound sends (e.g. `sendFunctionResult` =
 *     `conversation.item.create`).
 *
 * Wave A left this file deliberately un-translated ("subscribers reach
 * the typed emitter via `client.rt.on(...)`"). Wave B reverses that
 * call: the SDK's event names now stop HERE, so `RealtimePipeline` and
 * the orchestrator deal only in the neutral union and a second realtime
 * provider (Gemini Live, Azure Speech, …) can slot in behind the same
 * `RealtimeProvider` interface.
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
import type { ToolSpec } from "../context/types.ts";
import { log } from "../log.ts";
import type {
  RealtimeEvent,
  RealtimeEventHandler,
  RealtimeProvider,
  RealtimeProviderSessionConfig,
  RealtimeSession,
} from "../pipeline/providers/realtime/types.ts";

/** M-Arch Wave A #4: translate a neutral `ToolSpec` to the OpenAI
 *  Realtime function-tool shape. The translation lives here — the
 *  natural provider boundary — so the neutral tool shape is all that
 *  ever crosses the `RealtimeProvider` seam. Also drops the internal
 *  `__source` field (it isn't part of OpenAI's tool schema). */
export function toOpenAiTool(spec: ToolSpec): RealtimeFunctionTool {
  return {
    type: "function",
    name: spec.name,
    description: spec.description ?? "",
    parameters: spec.inputSchemaJson,
  };
}

/**
 * OpenAI realtime provider. Stateless beyond the bound API key — each
 * `open()` dials a fresh connected session.
 */
export class OpenAIRealtimeProvider implements RealtimeProvider {
  readonly name = "openai";

  constructor(private readonly apiKey: string) {}

  async open(config: RealtimeProviderSessionConfig): Promise<RealtimeSession> {
    const session = new OpenAIRealtimeSession(this.apiKey, config);
    await session.connect();
    return session;
  }
}

/** Factory matching the registry's `() => Promise<RealtimeProvider>`
 *  shape (orchestrator registers this under kind "realtime"). */
export function createOpenAiRealtimeProvider(apiKey: string): RealtimeProvider {
  return new OpenAIRealtimeProvider(apiKey);
}

/**
 * One connected OpenAI realtime session. Translates the SDK's typed
 * event stream into neutral `RealtimeEvent`s for subscribers.
 */
class OpenAIRealtimeSession implements RealtimeSession {
  private rt: OpenAIRealtimeWS | null = null;
  private closed = false;
  private readonly handlers: RealtimeEventHandler[] = [];

  constructor(
    private readonly apiKey: string,
    private readonly cfg: RealtimeProviderSessionConfig,
  ) {}

  /**
   * Open the WS, wait for `session.created`, send the initial
   * `session.update`, then wire the inbound event translation. Resolves
   * once the session is live; subscribers added afterwards still get
   * every subsequent event.
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
    this.wireTranslation(rt);
  }

  subscribe(handler: RealtimeEventHandler): void {
    this.handlers.push(handler);
  }

  private emit(event: RealtimeEvent): void {
    for (const h of this.handlers) h(event);
  }

  /** INBOUND translation: SDK events → neutral `RealtimeEvent`. This is
   *  the body that used to live in `RealtimePipeline.wireRealtimeEvents`
   *  as raw `rt.on("response.output_audio.delta", …)` subscriptions. */
  private wireTranslation(rt: OpenAIRealtimeWS): void {
    rt.on("input_audio_buffer.speech_started", () => {
      this.emit({ type: "user_speech_start" });
    });

    rt.on("input_audio_buffer.speech_stopped", () => {
      this.emit({ type: "user_speech_stop" });
    });

    rt.on("conversation.item.input_audio_transcription.delta", (event) => {
      const text = event.delta ?? "";
      if (!text) return;
      this.emit({ type: "user_transcript_delta", text });
    });

    rt.on("conversation.item.input_audio_transcription.completed", (event) => {
      this.emit({ type: "user_transcript_complete", text: event.transcript ?? "" });
    });

    rt.on("response.output_audio_transcript.delta", (event) => {
      const text = event.delta ?? "";
      if (!text) return;
      this.emit({ type: "assistant_transcript_delta", text });
    });

    rt.on("response.output_audio.delta", (event) => {
      if (!event.delta) return;
      // OpenAI Realtime emits 24 kHz PCM16 LE base64.
      this.emit({ type: "assistant_audio", pcm: Buffer.from(event.delta, "base64") });
    });

    rt.on("response.done", () => {
      this.emit({ type: "assistant_done" });
    });

    rt.on("response.function_call_arguments.done", (event) => {
      let argsJson: Record<string, unknown> = {};
      try {
        const parsed = JSON.parse(event.arguments);
        if (parsed && typeof parsed === "object") {
          argsJson = parsed as Record<string, unknown>;
        }
      } catch (err) {
        // Bad args: reply with an error result so the model isn't left
        // hanging, and DON'T surface a function_call (the tool never
        // runs with garbage args). Behaviour preserved from the old
        // pipeline-side parse.
        log.warn(`realtime(openai): tool ${event.name} bad JSON args`, err);
        this.sendFunctionResult(
          event.call_id,
          JSON.stringify({ error: "could not parse arguments" }),
        );
        return;
      }
      this.emit({ type: "function_call", callId: event.call_id, name: event.name, argsJson });
    });

    rt.on("error", (err) => {
      const message = err.error?.message ?? err.message ?? String(err);
      this.emit({ type: "error", message });
    });

    rt.socket.addEventListener("close", (ev) => {
      // A close WE initiated (watchdog / teardown) sets `closed` first —
      // don't surface that as an error. An unexpected upstream close is
      // an error the pipeline tears down on.
      if (this.closed) return;
      this.emit({
        type: "error",
        message: `realtime connection closed code=${ev.code} reason=${ev.reason ?? ""}`,
      });
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
      ...(this.cfg.tools &&
        this.cfg.tools.length > 0 && { tools: this.cfg.tools.map(toOpenAiTool) }),
    };
  }

  /**
   * Replace the session's tools + (optionally) refresh instructions.
   * Used after context-gather completes — the daemon registers tools
   * at session.update#1 with placeholder instructions, then issues a
   * second session.update once context has been gathered. Tools are the
   * neutral shape; translated here.
   */
  updateSession(patch: { instructions?: string; tools?: ToolSpec[] }): void {
    if (!this.rt || this.closed) return;
    const session: RealtimeSessionCreateRequest = {
      type: "realtime",
      ...(patch.instructions !== undefined && { instructions: patch.instructions }),
      ...(patch.tools !== undefined && { tools: patch.tools.map(toOpenAiTool) }),
    };
    this.safeSend({ type: "session.update", session });
  }

  /**
   * Push a chunk of 24 kHz PCM16 audio. Caller upsamples from the
   * device's native 16 kHz before calling.
   */
  pushMicPcm(pcm24kBytes: Buffer): void {
    if (!this.rt || this.closed || pcm24kBytes.length === 0) return;
    this.safeSend({
      type: "input_audio_buffer.append",
      audio: pcm24kBytes.toString("base64"),
    });
  }

  /** Commit the current input audio buffer (manual end-of-turn). Most
   *  useful when semantic VAD isn't doing the right thing. */
  commitInput(): void {
    if (!this.rt || this.closed) return;
    this.safeSend({ type: "input_audio_buffer.commit" });
  }

  /** Ask the model to begin a response. Paired with `commitInput()` for
   *  manual turn control. */
  sendAssistantStart(): void {
    if (!this.rt || this.closed) return;
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
   * when the model parallel-calls multiple tools.
   */
  sendFunctionResult(callId: string, output: string): void {
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

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    try {
      this.rt?.close({ code: 1000, reason: "client close" });
    } catch (e) {
      log.debug("realtime(openai): close threw", e);
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
      log.debug("realtime(openai): send swallowed", e);
    }
  }
}
