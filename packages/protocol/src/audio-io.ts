// SYNC NOTE: this file's wire-protocol types must stay byte-identical
// to voix-backend/src/audio_io/protocol.ts. If you edit one, edit the
// other. Production HA Add-on Dockerfile can't see packages/, so the
// daemon ships its own copy. `scripts/check-protocol-sync.sh` flags
// drift.

/**
 * Audio I/O port — wire protocol (v1).
 *
 * Canonical TypeScript shapes for the protocol specified in
 * `protocol/audio-io/spec.md`. Everything that delivers mic audio to
 * (and accepts speaker audio from) the daemon speaks this — pucks,
 * phones, browser tabs, third-party endpoints.
 *
 * **This file is the M06 deliverable.** Today's puck WS still uses
 * the older shapes in `src/puck/protocol.ts`. M07 rewires
 * `puck/session.ts` to consume *this* protocol and treats the puck
 * as one endpoint among many. M08 ships the firmware change that
 * sends the new hello fields. Until M07 lands the daemon keeps
 * accepting both shapes via the legacy mapping in
 * `puck/protocol.ts::resolveCapture`.
 *
 * See the spec doc for narrative + examples; this file is just the
 * types.
 */

// ─── Public constants ───────────────────────────────────────────────

/** Bump on every breaking change to envelopes, capabilities, or
 *  framing. Adding optional capability fields or daemon→endpoint
 *  event types is NOT a bump (clients are required to ignore unknown
 *  text-frame types). */
export const PROTOCOL_VERSION = 1 as const;
export type ProtocolVersion = typeof PROTOCOL_VERSION;

// ─── Core enums ─────────────────────────────────────────────────────

/** Why this capture is happening. See spec §4. */
export type Intent = "dictate" | "discuss";

/** Hint to the daemon about what kind of endpoint just connected.
 *  Used for logging, UI grouping, and the per-endpoint capability
 *  defaults the daemon applies. New values are additive and don't
 *  bump the protocol version — endpoints whose `kind` the daemon
 *  doesn't recognise are still served (capabilities still authoritative). */
export type ClientKind = "puck" | "phone-sat" | "laptop-mic" | "browser-tab" | "external";

/** Reasons a daemon may refuse a hello. */
export type DeclineReason =
  | "auth"
  | "unknown_voice"
  | "unsupported_protocol_version"
  | "capacity"
  | "rate_limit"
  | "internal";

// ─── Capability declarations ────────────────────────────────────────

/** Audio codec on the wire. PCM16 little-endian is the default and
 *  the only thing pucks speak; Opus is a future browser concession. */
export type AudioCodec = "pcm16" | "opus";

export type MicCapability = {
  sample_rate_hz: number;
  channels: 1 | 2;
  /** Defaults to "pcm16" when omitted. */
  codec?: AudioCodec;
};

export type SpeakerCapability = {
  sample_rate_hz: number;
  /** PCM16 is the only outbound codec today — small endpoints can't
   *  decode anything else on chip. */
  codec?: "pcm16";
};

export type Capabilities = {
  mic: MicCapability;
  /** Optional. Pure-input endpoints (a CLI, a keyboard extension)
   *  omit this; daemon won't try to play audio back. */
  speaker?: SpeakerCapability;
  /** When true the endpoint does its own AEC + gating (e.g. the puck's
   *  XMOS chip, or browser getUserMedia with echoCancellation: true).
   *  Daemon's energy gate is skipped. */
  half_duplex_on_chip?: boolean;
  /** Wake-word slots this endpoint claims. Used for routing in
   *  multi-endpoint households so the same wake word doesn't fire
   *  two sessions at once. */
  wake_words?: string[];
  /** Reserved for future screen-streaming endpoints. Not implemented
   *  in v1; the flag exists so an endpoint can declare it without
   *  forcing a protocol bump. */
  screen?: boolean;
};

export type ClientInfo = {
  kind: ClientKind;
  version?: string;
  friendly_name?: string;
};

// ─── Hello + ready/decline ──────────────────────────────────────────

/**
 * The first text frame on every connection. Endpoints SHOULD NOT
 * send any binary frames before the hello. The daemon's response is
 * exactly one of `ready` or `decline` (followed by close 4000).
 */
export type AudioIoHello = {
  type: "hello";
  protocol_version: ProtocolVersion;
  token: string;
  device_id: string;
  intent: Intent;
  voice_id?: string;
  capabilities: Capabilities;
  client_info?: ClientInfo;
};

export type Ready = {
  type: "ready";
  intent: Intent;
  session_id: string;
  voice_id: string;
};

export type Decline = {
  type: "decline";
  reason: DeclineReason;
  detail?: string;
};

// ─── In-session events ──────────────────────────────────────────────

/** Endpoint → daemon text events sent after the hello. Binary frames
 *  (mic PCM) flow alongside on the same WS. */
export type EndpointEvent =
  | AudioIoHello
  /** Dictate only: end of capture. Endpoints with push-to-talk send
   *  on release; endpoints with VAD may send on detected silence. */
  | { type: "done" }
  /** Discuss only: user wants to interrupt the model. Daemon cancels
   *  the in-flight response. Endpoints with no barge-in affordance
   *  never send this. */
  | { type: "barge_in" }
  /** Optional telemetry from the endpoint. Daemon stores some, logs
   *  the rest; never required. */
  | { type: "metrics"; data: Record<string, number | string> };

/** Daemon → endpoint text events. Endpoints MUST ignore unknown
 *  `type` values — that's how the daemon adds new event types
 *  without bumping the protocol version. */
export type DaemonEvent =
  | Ready
  | Decline
  | { type: "error"; message: string }
  | { type: "user_speech_start" }
  | { type: "user_speech_end" }
  /** Streaming partial transcript. Render for live captions, do NOT
   *  treat as the canonical transcript — providers occasionally
   *  rewrite a partial. */
  | { type: "transcript_delta"; text: string }
  /** Final transcript line for one role. THIS is canonical. */
  | { type: "transcript"; role: "user" | "assistant"; text: string }
  | { type: "audio_start" }
  | { type: "audio_end" };

// ─── WebSocket close codes ──────────────────────────────────────────

/** voix-specific WS close codes. Standard 1xxx codes still apply. */
export const CLOSE_CODES = {
  DECLINE: 4000,
  IDLE_TIMEOUT: 4001,
  HARD_CEILING: 4002,
  PIPELINE_ERROR: 4003,
} as const;
export type VoixCloseCode = (typeof CLOSE_CODES)[keyof typeof CLOSE_CODES];

// ─── Helpers ────────────────────────────────────────────────────────

/**
 * Best-effort validation of an inbound hello envelope. Returns the
 * typed hello when it parses, or a `DeclineReason` describing why
 * it didn't. The daemon's WS handler turns the reason into a
 * `decline` frame.
 *
 * Permissive on optional fields; strict on the auth gate (token must
 * be a non-empty string) and the protocol version. Unknown
 * capability fields are preserved as-is so future endpoints can ship
 * earlier than the daemon adds first-class support.
 */
export function parseHello(
  raw: unknown,
): { ok: true; hello: AudioIoHello } | { ok: false; reason: DeclineReason; detail: string } {
  if (!raw || typeof raw !== "object") {
    return { ok: false, reason: "internal", detail: "hello is not an object" };
  }
  const r = raw as Record<string, unknown>;
  if (r["type"] !== "hello") {
    return { ok: false, reason: "internal", detail: "first text frame must be a hello" };
  }
  if (r["protocol_version"] !== PROTOCOL_VERSION) {
    return {
      ok: false,
      reason: "unsupported_protocol_version",
      detail: `daemon speaks v${PROTOCOL_VERSION}, endpoint sent v${String(r["protocol_version"])}`,
    };
  }
  if (typeof r["token"] !== "string" || r["token"].length === 0) {
    return { ok: false, reason: "auth", detail: "missing token" };
  }
  if (typeof r["device_id"] !== "string" || r["device_id"].length === 0) {
    return { ok: false, reason: "internal", detail: "missing device_id" };
  }
  const intent = r["intent"];
  if (intent !== "dictate" && intent !== "discuss") {
    return { ok: false, reason: "internal", detail: `invalid intent: ${String(intent)}` };
  }
  const caps = r["capabilities"];
  if (!caps || typeof caps !== "object") {
    return { ok: false, reason: "internal", detail: "missing capabilities" };
  }
  const mic = (caps as Record<string, unknown>)["mic"];
  if (!mic || typeof mic !== "object") {
    return { ok: false, reason: "internal", detail: "missing capabilities.mic" };
  }
  // Beyond the required fields above we trust the endpoint. The
  // daemon's adaptation logic (resampling etc.) handles the values.
  return { ok: true, hello: raw as AudioIoHello };
}

/**
 * Whether the daemon should run its own echo gate in front of the
 * pipeline for this endpoint. The rule is simply "the endpoint
 * didn't say it does it itself" — pucks declare half-duplex; browsers
 * using getUserMedia AEC should declare it; everything else gets the
 * software gate.
 */
export function needsDaemonEchoGate(caps: Capabilities): boolean {
  return caps.half_duplex_on_chip !== true;
}
