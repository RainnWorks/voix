/**
 * Audio I/O connection — the WS-facing slice of a capture session.
 *
 * One instance per open WS. Owns: the WS handle, hello validation,
 * legacy-vs-v1 protocol translation, the per-device "last seen"
 * write, the binary frame plumbing in both directions. The actual
 * model-side orchestration sits behind a `Pipeline` instance
 * (`src/pipeline/`); this class only ever talks to it through the
 * `PipelineCallbacks` interface.
 *
 * Why a separate class from the route file: route files are about WS
 * lifecycle (open/message/close), and a single message can mean
 * "start a session" or "continue one" or "interrupt one." Pushing
 * that state machine into a class keeps the route lean and gives
 * tests something to instantiate without an Elysia app.
 *
 * M07 deliverable. Replaces the WS-side responsibilities of the old
 * 641-LOC `puck/session.ts`.
 */

import { randomBytes } from "node:crypto";
import { createResampler, resampleChunk } from "../audio/resample.ts";
import { recordSeen } from "../devices/store.ts";
import { log } from "../log.ts";
import type { Pipeline, PipelineCallbacks, PipelineFactory } from "../pipeline/types.ts";
import type { PuckHello } from "../puck/protocol.ts";
import { resolveCapture } from "../puck/protocol.ts";
import { getVoice } from "../voices/store.ts";
import {
  type Capabilities,
  CLOSE_CODES,
  type Intent,
  needsDaemonEchoGate,
  PROTOCOL_VERSION,
} from "./protocol.ts";

/**
 * Minimal interface AudioIoConnection needs from the underlying WS.
 * Defined here (not pulling Bun's full `ServerWebSocket<T>`) so the
 * connection is decoupled from Elysia's generic chain — any
 * structurally-compatible socket works.
 */
export type WSLike = {
  send(data: string): unknown;
  sendBinary(data: ArrayBufferView | ArrayBuffer): unknown;
  close(code?: number, reason?: string): unknown;
};

export type ConnectionDeps = {
  /** Shared secret. Every hello's `token` must match. */
  wsToken: string;
  /** How to build the pipeline once we have a hello. Injected so
   *  tests can substitute a stub. Wave A #5 dropped the
   *  openaiApiKey field here — provider construction (including key
   *  binding) is the orchestrator's job, not the connection's. */
  pipelineFactory: PipelineFactory;
};

/** Capabilities the daemon assumes for a connection whose hello
 *  uses the legacy puck shape (no `capabilities` field). The puck
 *  IS the only such endpoint today; these match what its hardware
 *  does. Updated by M08 once the firmware sends the real fields. */
const LEGACY_PUCK_DEFAULT_CAPS: Capabilities = {
  mic: { sample_rate_hz: 16000, channels: 1 },
  speaker: { sample_rate_hz: 24000 },
  half_duplex_on_chip: true,
  wake_words: ["voix"],
};

export class AudioIoConnection {
  private pipeline: Pipeline | null = null;
  private deviceId = "?";
  private intent: Intent = "discuss";
  private closed = false;
  private readonly sessionId = randomBytes(8).toString("hex");
  /** Endpoint's declared speaker rate from the M16 capability
   *  handshake. The pipeline sends speaker PCM at the upstream
   *  provider's native rate (24 kHz for both Realtime + Aura); we
   *  resample here before forwarding so the endpoint hears the
   *  audio at the right pitch. The browser declares 48 kHz and was
   *  hearing 24 kHz audio at 2× speed before this resample landed
   *  (B1 from the niggly-bits audit). */
  private speakerSampleRateHz = 0;
  /** Resampler state from upstream (currently 24 kHz) → endpoint
   *  rate. Created lazily on first speaker frame when the rates
   *  differ; null if no resample is needed (rates match). */
  private speakerResampleState: ReturnType<typeof createResampler> | null = null;

  constructor(
    private readonly ws: WSLike,
    private readonly deps: ConnectionDeps,
  ) {}

  /**
   * Process an inbound text frame. Returns true if handled (caller
   * doesn't need to do anything), false if not (caller may warn).
   * The first hello starts a pipeline; subsequent text frames are
   * routed to the live pipeline if there is one.
   */
  async handleText(parsed: unknown): Promise<boolean> {
    if (this.closed) return false;
    if (!parsed || typeof parsed !== "object") return false;
    const env = parsed as { type?: string };

    switch (env.type) {
      case "hello":
        await this.handleHello(parsed);
        return true;
      case "ready_for_input":
        // Legacy puck event — same semantics as v1 `ready_for_input`
        // (puck speaker just drained). Forward to the pipeline so its
        // idle watchdog resets.
        this.pipeline?.readyForInput();
        return true;
      case "done":
        // v1 dictate end-of-capture. Pipeline-side handler not wired
        // yet (today we let VAD close the input); placeholder so we
        // ack the frame instead of warning.
        return true;
      case "barge_in":
        this.pipeline?.bargeIn();
        return true;
      default:
        return false;
    }
  }

  /** Process an inbound binary frame (mic PCM from the endpoint). */
  handleBinary(pcm: Buffer): void {
    if (this.closed) return;
    if (!this.pipeline) {
      log.debug(`audio_io ${this.deviceId}: dropping binary frame before hello`);
      return;
    }
    if (pcm.length === 0) return;
    this.pipeline.pushMic(pcm);
  }

  /** Endpoint or our side closed the WS. */
  handleClose(): void {
    if (this.closed) return;
    this.closed = true;
    this.pipeline?.close();
    this.pipeline = null;
  }

  // ─── Internals ────────────────────────────────────────────────────

  private async handleHello(raw: unknown): Promise<void> {
    if (this.pipeline) {
      log.warn(`audio_io ${this.deviceId}: ignoring repeat hello`);
      return;
    }

    // Accept either the v1 audio-io shape or the legacy puck shape.
    // After M08 the puck sends v1; until then resolveCapture handles
    // the translation from mode/mode_id → intent/voice_id.
    const r = raw as Record<string, unknown>;
    const token = typeof r["token"] === "string" ? (r["token"] as string) : "";
    const deviceId = typeof r["device_id"] === "string" ? (r["device_id"] as string) : "";

    if (!token || token !== this.deps.wsToken) {
      log.warn(`audio_io: bad/missing token (device=${deviceId || "?"})`);
      this.sendDecline("auth", "bad or missing token");
      this.ws.close(CLOSE_CODES.DECLINE, "auth");
      return;
    }
    if (!deviceId) {
      log.warn("audio_io: hello missing device_id");
      this.sendDecline("internal", "missing device_id");
      this.ws.close(CLOSE_CODES.DECLINE, "device_id");
      return;
    }

    this.deviceId = deviceId;

    // v1 hellos carry `protocol_version` + `capabilities`. Legacy
    // hellos don't — they get the puck defaults so the pipeline can
    // run unchanged.
    const isV1 = typeof r["protocol_version"] === "number";
    const intent: Intent = isV1 ? (r["intent"] as Intent) : resolveCapture(raw as PuckHello).intent;
    const voiceId = isV1
      ? (r["voice_id"] as string | undefined)
      : resolveCapture(raw as PuckHello).voiceId;

    if (intent !== "dictate" && intent !== "discuss") {
      log.warn(`audio_io ${deviceId}: invalid intent ${String(intent)}`);
      this.sendDecline("internal", `invalid intent ${String(intent)}`);
      this.ws.close(CLOSE_CODES.DECLINE, "intent");
      return;
    }

    if (isV1 && r["protocol_version"] !== PROTOCOL_VERSION) {
      log.warn(
        `audio_io ${deviceId}: unsupported protocol_version ` +
          `(daemon v${PROTOCOL_VERSION}, client v${String(r["protocol_version"])})`,
      );
      this.sendDecline("unsupported_protocol_version", `daemon speaks v${PROTOCOL_VERSION}`);
      this.ws.close(CLOSE_CODES.DECLINE, "protocol_version");
      return;
    }

    // Validate capabilities before touching them. The original
    // unchecked cast at this site let a malformed v1 hello — empty
    // capabilities, or capabilities with no `mic` — throw a
    // TypeError out of handleHello, leaving the WS hung with neither
    // ready nor decline (niggly-bits B4).
    let capabilities: Capabilities;
    if (isV1) {
      const raw = r["capabilities"] as Record<string, unknown> | undefined;
      const mic = (raw?.["mic"] ?? null) as { sample_rate_hz?: unknown } | null;
      if (!raw || !mic || typeof mic.sample_rate_hz !== "number" || mic.sample_rate_hz <= 0) {
        log.warn(`audio_io ${deviceId}: v1 hello with bad/missing capabilities.mic`);
        this.sendDecline("internal", "capabilities.mic.sample_rate_hz required");
        this.ws.close(CLOSE_CODES.DECLINE, "capabilities");
        return;
      }
      capabilities = raw as unknown as Capabilities;
    } else {
      capabilities = LEGACY_PUCK_DEFAULT_CAPS;
    }

    const voice = getVoice(voiceId);
    this.intent = intent;

    // M08 acceptance: surface the capabilities on hello so we can see
    // what each endpoint declared without enabling debug logging. The
    // format is compact (one line) so multi-puck households don't
    // drown in capability noise on every wake-word session.
    const clientKind =
      (r["client_info"] as { kind?: string } | undefined)?.kind ?? (isV1 ? "?" : "puck-legacy");
    log.warn(
      `audio_io ${deviceId}: hello v${isV1 ? PROTOCOL_VERSION : "legacy"} ` +
        `kind=${clientKind} intent=${intent} voice_id=${voice.id} ` +
        `mic=${capabilities.mic.sample_rate_hz}/${capabilities.mic.channels} ` +
        `speaker=${capabilities.speaker?.sample_rate_hz ?? "none"} ` +
        `half_duplex_on_chip=${capabilities.half_duplex_on_chip === true} ` +
        `wake_words=[${(capabilities.wake_words ?? []).join(",")}]`,
    );

    // Best-effort device "last seen" — write failure logged but
    // doesn't gate the session. M16: capabilities snapshot lets the
    // Surfaces UI render device cards from persisted state when the
    // WS is closed.
    void recordSeen(deviceId, {
      voiceId: voice.id,
      protocolVersion: isV1 ? PROTOCOL_VERSION : undefined,
      clientKind,
      capabilities,
    }).catch((err) => log.debug(`audio_io ${deviceId}: recordSeen failed`, err));

    // Stash the endpoint's declared speaker rate so the sendSpeaker
    // callback can resample upstream PCM to it.
    this.speakerSampleRateHz = capabilities.speaker?.sample_rate_hz ?? 0;

    // Build the pipeline with a callback bridge back to us.
    const callbacks: PipelineCallbacks = {
      sendEvent: (event) => this.sendDaemonEvent(event),
      sendSpeaker: (pcm, rate) => this.sendSpeakerFrame(pcm, rate),
      close: () => this.close(),
    };
    const pipeline = this.deps.pipelineFactory({
      deviceId,
      sessionId: this.sessionId,
      voice,
      intent,
      micSampleRateHz: capabilities.mic.sample_rate_hz,
      speakerSampleRateHz: this.speakerSampleRateHz || undefined,
      halfDuplexOnChip: !needsDaemonEchoGate(capabilities),
      callbacks,
    });
    this.pipeline = pipeline;
    await pipeline.start();

    // Tell the endpoint we're ready. We always emit the legacy
    // shape (mode: "realtime" | "dictation") on the wire today —
    // the puck firmware reads it. Switching to the v1 ready shape
    // is part of M08's firmware update.
    const legacyMode = intent === "discuss" ? "realtime" : "dictation";
    try {
      this.ws.send(JSON.stringify({ type: "ready", mode: legacyMode }));
    } catch (e) {
      log.debug(`audio_io ${deviceId}: ready send failed`, e);
    }
  }

  /**
   * Map a pipeline-emitted event onto the wire format. Today every
   * connected endpoint speaks the legacy puck names (transcript_delta,
   * transcript, user_speech_start/end, audio_start/end, error); the
   * v1 audio-io shapes overlap so this is currently a 1:1 pass-through
   * except for the `transcript` envelope (legacy puck protocol carries
   * just text, no role; pipeline emits role + text).
   */
  private sendDaemonEvent(event: {
    type: string;
    text?: string;
    role?: "user" | "assistant";
    message?: string;
  }): void {
    if (this.closed) return;
    try {
      // Legacy puck protocol: transcript event has just { type, text }.
      const wire =
        event.type === "transcript" ? { type: "transcript", text: event.text ?? "" } : event;
      this.ws.send(JSON.stringify(wire));
    } catch (e) {
      log.debug(`audio_io ${this.deviceId}: sendText failed`, e);
    }
  }

  private sendBinaryToEndpoint(pcm: Buffer): void {
    if (this.closed) return;
    try {
      this.ws.sendBinary(pcm);
    } catch (e) {
      log.debug(`audio_io ${this.deviceId}: sendBinary failed`, e);
    }
  }

  /**
   * Resample upstream PCM to the endpoint's declared speaker rate
   * and forward. Created lazily on first frame.
   *
   * If the endpoint declared no speaker, drop the frame — the
   * pipeline shouldn't be sending audio to a speaker-less endpoint
   * anyway, but we don't want to forward 24 kHz raw if so. If the
   * pipeline's source rate matches the endpoint's rate (puck case)
   * forward without resampling.
   */
  private sendSpeakerFrame(pcm: Buffer, sourceRateHz: number): void {
    if (this.closed) return;
    if (this.speakerSampleRateHz === 0) {
      // Endpoint never declared a speaker; nothing to play through.
      return;
    }
    if (this.speakerSampleRateHz === sourceRateHz) {
      this.sendBinaryToEndpoint(pcm);
      return;
    }
    if (!this.speakerResampleState) {
      this.speakerResampleState = createResampler(sourceRateHz, this.speakerSampleRateHz);
      log.debug(
        `audio_io ${this.deviceId}: speaker resample ${sourceRateHz} → ${this.speakerSampleRateHz}`,
      );
    }
    const resampled = resampleChunk(pcm, this.speakerResampleState);
    this.sendBinaryToEndpoint(resampled);
  }

  private sendDecline(reason: string, detail: string): void {
    try {
      this.ws.send(JSON.stringify({ type: "decline", reason, detail }));
    } catch {
      // Best-effort.
    }
  }

  /** Tear down the WS (the pipeline already initiated, or we did). */
  private close(): void {
    if (this.closed) return;
    this.closed = true;
    try {
      this.ws.close(1000, "session closed");
    } catch (e) {
      log.debug(`audio_io ${this.deviceId}: ws.close threw`, e);
    }
    this.pipeline?.close();
    this.pipeline = null;
  }
}

/** Expose the unused-in-this-file but-test-relevant constant so the
 *  test file can assert on it without re-declaring. */
export const _LEGACY_PUCK_DEFAULT_CAPS = LEGACY_PUCK_DEFAULT_CAPS;
