/**
 * Wire protocol between voix pucks (Voice PE firmware) and the daemon.
 *
 * Direction:
 *   • Puck → daemon: hello (auth + intent + voice), then continuous mic frames.
 *   • Daemon → puck: ready / decline / typed events / outbound audio.
 *
 * Frames:
 *   • Text frames are JSON envelopes — typed by the `type` field.
 *   • Binary frames are raw mic PCM16 little-endian @ 16 kHz from puck
 *     to daemon, and raw speaker PCM16 little-endian @ 24 kHz from
 *     daemon to puck. (Voice PE plays 24 kHz natively; we don't
 *     downsample.)
 *
 * M05 protocol shift (vocabulary alignment):
 *   The canonical fields a puck sends are `intent` (dictate / discuss)
 *   + `voice_id`. The legacy `mode` ("realtime" / "dictation") +
 *   `mode_id` fields are still accepted on the wire so old firmware
 *   keeps working; the daemon maps them in. realtime → discuss,
 *   dictation → dictate.
 *
 *   New surfaces (Mac hotkey, iOS keyboard, browser) should use the
 *   new fields directly. The firmware change to send the new fields
 *   is queued for the next deploy window — daemon backward-compat
 *   means we are not blocked on it.
 */

/** A capture's intent. Maps to one of the pipeline shapes:
 *  - `dictate` — one-shot capture → STT → optional output transform
 *  - `discuss` — full back-and-forth, may end with the produce_output
 *                handoff (design-brief §3) */
export type Intent = "dictate" | "discuss";

/** Old wire vocabulary. Kept for back-compat. */
type LegacyMode = "realtime" | "dictation";

export type PuckHello = {
  type: "hello";
  /** Shared secret from VOIX_WS_TOKEN (HA Add-on option or env var).
   *  Mismatched → daemon closes the WS. */
  token: string;
  /** Stable device identifier, used for logging + session correlation.
   *  Today this is the ESPHome device name; future pucks may pass a
   *  derived MAC or random UUID. */
  device_id: string;
  /** Canonical (M05+): the intent for this capture. */
  intent?: Intent;
  /** Canonical (M05+): which voice to apply. */
  voice_id?: string;
  /** @deprecated Use `intent`. Old firmware still sends this; daemon
   *  maps `realtime → discuss`, `dictation → dictate`. */
  mode?: LegacyMode;
  /** @deprecated Use `voice_id`. */
  mode_id?: string;
  /** Optional firmware version banner for log noise reduction. */
  fw_version?: string;
};

/**
 * Map a hello onto its canonical intent + voice id, falling back to
 * legacy fields when the new ones are absent. Exported for the unit
 * test under `tests/puck/`.
 */
export function resolveCapture(hello: PuckHello): { intent: Intent; voiceId?: string } {
  const intent: Intent = hello.intent ?? (hello.mode === "dictation" ? "dictate" : "discuss");
  const voiceId = hello.voice_id ?? hello.mode_id;
  return { intent, voiceId };
}

export type DaemonToPuck =
  | { type: "ready"; mode: LegacyMode }
  | { type: "decline"; reason: string }
  | { type: "error"; message: string }
  | { type: "user_speech_start" }
  | { type: "user_speech_end" }
  | { type: "transcript_delta"; text: string }
  | { type: "transcript"; text: string }
  /** Marker that the model started a turn. The puck doesn't *need*
   *  this for echo gating — it inspects its own speaker state for
   *  that — but kept as a signal for LED phasing on the firmware
   *  side. */
  | { type: "audio_start" }
  | { type: "audio_end" };
