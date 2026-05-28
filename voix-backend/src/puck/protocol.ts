/**
 * Wire protocol between voix pucks (Voice PE firmware) and the daemon.
 *
 * Direction:
 *   • Puck → daemon: hello (auth + mode), then continuous mic frames.
 *   • Daemon → puck: ready / decline / typed events / outbound audio.
 *
 * Frames:
 *   • Text frames are JSON envelopes — typed by the `type` field.
 *   • Binary frames are raw mic PCM16 little-endian @ 16 kHz from puck
 *     to daemon, and raw speaker PCM16 little-endian @ 24 kHz from
 *     daemon to puck. (Voice PE plays 24 kHz natively; we don't
 *     downsample.)
 *
 * The firmware-side equivalents lived in voix_realtime_client.cpp +
 * voix_realtime_client.h. The wire shape is identical to what the
 * HA-side bridge used — pucks don't need a firmware update for the
 * server move, just a new `server_url`.
 */

export type PuckHello = {
  type: "hello";
  /** Shared secret from VOIX_WS_TOKEN (HA Add-on option or env var).
   *  Mismatched → daemon closes the WS. */
  token: string;
  /** Stable device identifier, used for logging + session correlation.
   *  Today this is the ESPHome device name; future pucks may pass a
   *  derived MAC or random UUID. */
  device_id: string;
  /** What kind of turn the user is initiating. */
  mode: "realtime" | "dictation";
  /** Optional — only meaningful for realtime sessions. Determines
   *  voice + LLM model + system prompt. */
  mode_id?: string;
  /** Optional firmware version banner for log noise reduction. */
  fw_version?: string;
};

export type DaemonToPuck =
  | { type: "ready"; mode: "realtime" | "dictation" }
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
