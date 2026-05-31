/**
 * Realtime provider seam (M-Arch Wave B / refactor #1).
 *
 * This file owns the NEUTRAL contract every realtime impl satisfies —
 * the same hexagonal-port shape STT/LLM/TTS already use. Wave A left
 * this seam as "abstraction theatre": the session interface re-exported
 * OpenAI's `RealtimeFunctionTool` and told consumers to subscribe to
 * the SDK's typed emitter directly (`client.rt.on(...)`), which meant
 * `RealtimePipeline` was wired to OpenAI event names and a second
 * provider could never slot in behind the interface.
 *
 * Wave B makes the seam load-bearing:
 *   • A neutral `RealtimeEvent` union — provider-agnostic event names.
 *     Each impl translates its native event stream INTO this union
 *     inside its own file (see `src/realtime/openai.ts`).
 *   • `RealtimeProviderSessionConfig.tools` is the neutral `ToolSpec[]`
 *     Wave A introduced — no OpenAI tool shape leaks across the seam.
 *   • `RealtimeSession` exposes lifecycle + a `subscribe(handler)`
 *     channel; consumers (`RealtimePipeline`) switch on the neutral
 *     union and never name an OpenAI event.
 *
 * The payoff is `tests/pipeline/realtime.test.ts`: a `StubRealtimeProvider`
 * can emit canned neutral events and drive the whole pipeline without
 * loading the openai SDK (refactor #14).
 */

import type { ToolSpec } from "../../../context/types.ts";

/**
 * Neutral realtime event union. Every realtime provider translates its
 * native event stream into these; `RealtimePipeline` is the only
 * consumer and switches on `type`. Adding a provider means writing one
 * translation function, not teaching the pipeline new event names.
 */
export type RealtimeEvent =
  /** VAD detected the user started speaking. */
  | { type: "user_speech_start" }
  /** VAD detected the user stopped speaking. */
  | { type: "user_speech_stop" }
  /** Incremental user transcription text. Concatenate in order. */
  | { type: "user_transcript_delta"; text: string }
  /** Final user transcript for the turn. */
  | { type: "user_transcript_complete"; text: string }
  /** A chunk of assistant audio — PCM16 LE mono at the provider's
   *  output rate (24 kHz for OpenAI Realtime). */
  | { type: "assistant_audio"; pcm: Buffer }
  /** Incremental assistant transcript text (the spoken response, as
   *  text). Concatenate in order. */
  | { type: "assistant_transcript_delta"; text: string }
  /** The assistant finished its current response turn. */
  | { type: "assistant_done" }
  /** The model wants to invoke a tool. `argsJson` is already parsed
   *  (the provider adapter owns JSON parsing + bad-arg handling). */
  | { type: "function_call"; callId: string; name: string; argsJson: Record<string, unknown> }
  /** Terminal/recoverable error. The pipeline treats this as fatal and
   *  tears the session down. */
  | { type: "error"; message: string };

export type RealtimeEventHandler = (event: RealtimeEvent) => void;

/** Session config the orchestrator hands to a provider's `open()`. The
 *  field names are provider-neutral; each impl maps them onto its own
 *  session schema. */
export type RealtimeProviderSessionConfig = {
  /** Provider-specific model id. e.g. "gpt-realtime-2" for OpenAI. */
  model: string;
  /** "audio" for bidir voice; "text" for transcription-only (dictation). */
  outputModalities: ["audio"] | ["text"];
  /** System prompt; empty for provider default. */
  instructions: string;
  /** Optional inner-transcription model for audio sessions. */
  transcribeModel?: string;
  /** Optional output voice for audio sessions. */
  voice?: string;
  /** VAD eagerness — "low" patient, "high" eager. */
  vadEagerness?: "low" | "medium" | "high";
  /** Neutral tool specs to register at session start (Wave A #4). The
   *  provider adapter translates these into its native tool shape. */
  tools?: ToolSpec[];
};

/**
 * A live realtime session. Lifecycle:
 *
 *   1. provider.open(config)            → returns a CONNECTED session
 *   2. session.subscribe(handler)       → receive neutral events
 *   3. session.updateSession(patch)     → may be called repeatedly
 *      (e.g. push composed instructions + tools after context gather)
 *   4. session.pushMicPcm(pcm)          → push mic frames (24 kHz PCM16 LE)
 *   5. session.sendFunctionResult(...)  → reply to a function_call event
 *   6. session.close()                  → tear down
 *
 * `commitInput()` + `sendAssistantStart()` are the explicit end-of-turn
 * hooks for providers/voices that don't rely on server-side VAD; the
 * OpenAI impl drives turns via semantic_vad so the pipeline doesn't
 * call them today, but they're part of the contract so a turn-based
 * provider can be driven through the same seam.
 */
export interface RealtimeSession {
  /** Subscribe to neutral realtime events. Multiple subscribers ok. */
  subscribe(handler: RealtimeEventHandler): void;
  /** Replace instructions and/or registered tools mid-session. Tools
   *  are the neutral shape; the adapter translates them. */
  updateSession(patch: { instructions?: string; tools?: ToolSpec[] }): void;
  /** Push a mic frame — PCM16 LE mono at the rate the provider's
   *  config declared (the pipeline resamples before calling). */
  pushMicPcm(pcm: Buffer): void;
  /** Explicitly commit the pending input buffer (manual end-of-turn). */
  commitInput(): void;
  /** Explicitly ask the assistant to begin a response. */
  sendAssistantStart(): void;
  /** Reply to a `function_call` event with the tool's output. */
  sendFunctionResult(callId: string, output: string): void;
  /** Tear down. Idempotent. */
  close(): Promise<void>;
}

export interface RealtimeProvider {
  /** Stable provider name for logs + UI labels. */
  readonly name: string;
  /** Open a streaming realtime session (connected on resolve). Throws
   *  on auth or handshake failure. */
  open(config: RealtimeProviderSessionConfig): Promise<RealtimeSession>;
}
