/**
 * Elysia route for the audio-io WS endpoint.
 *
 * URL stays `/ws` until the firmware adopts the v1 audio-io path —
 * the puck reads its WS URL from `voix_set_server` so changing it
 * here forces a coordinated firmware + HA push (M08+). Keeping the
 * path stable means the WS endpoint is a no-touch zone in M07.
 *
 * One open WS = one in-flight session. Per-connection state lives
 * on an `AudioIoConnection` instance keyed by the underlying Bun
 * socket. WeakMap means closed sockets GC automatically.
 *
 * Auth model: first text frame MUST be a hello with the shared
 * token. Until then, binary frames are dropped. Mismatched token →
 * decline + close 4000.
 */

import { Elysia } from "elysia";
import { config } from "../env.ts";
import { log } from "../log.ts";
import { realtimePipelineFactory } from "../pipeline/realtime.ts";
import { AudioIoConnection, type WSLike } from "./connection.ts";

// Keyed by the underlying Bun socket reference — same object across
// all Elysia hooks for a connection. Key type is `object` because
// Elysia parameterises its raw ServerWebSocket with an internal
// shape we don't want to leak.
const connections = new WeakMap<object, AudioIoConnection>();

function getConn(ws: { raw: object }): AudioIoConnection {
  const existing = connections.get(ws.raw);
  if (existing) return existing;
  const fresh = new AudioIoConnection(ws.raw as unknown as WSLike, {
    wsToken: config.wsToken,
    openaiApiKey: config.openaiApiKey,
    pipelineFactory: realtimePipelineFactory,
  });
  connections.set(ws.raw, fresh);
  return fresh;
}

// Note: return type intentionally inferred. Elysia's generic chain
// is specific enough that annotating `: Elysia` narrows it
// incorrectly (Elysia v1.4).
export function audioIoRoute() {
  return new Elysia({ name: "voix.audio_io" }).ws("/ws", {
    open(ws) {
      // Allocate the conn eagerly so the first message lookup
      // doesn't allocate on the hot path.
      getConn(ws);
      log.debug("audio_io: ws open");
    },

    async message(ws, raw) {
      const conn = getConn(ws);

      // Binary frame = mic PCM.
      if (raw instanceof Uint8Array || raw instanceof ArrayBuffer) {
        const buf =
          raw instanceof Uint8Array
            ? Buffer.from(raw.buffer, raw.byteOffset, raw.byteLength)
            : Buffer.from(raw);
        conn.handleBinary(buf);
        return;
      }

      // Text frame → JSON envelope.
      let parsed: unknown;
      try {
        if (typeof raw === "string") {
          parsed = JSON.parse(raw);
        } else if (raw && typeof (raw as { type?: string }).type === "string") {
          // Elysia may have already parsed JSON for us — accept it.
          parsed = raw;
        } else {
          log.warn("audio_io: unknown text frame shape");
          return;
        }
      } catch {
        log.warn("audio_io: dropping non-JSON text frame");
        return;
      }

      const handled = await conn.handleText(parsed);
      if (!handled) {
        const t = (parsed as { type?: string }).type ?? "?";
        log.warn(`audio_io: unexpected text frame type=${t}`);
      }
    },

    close(ws, code, reason) {
      const conn = getConn(ws);
      log.debug(`audio_io: ws close code=${code} reason=${reason ?? ""}`);
      conn.handleClose();
    },

    error({ error }) {
      log.warn("audio_io: ws error", error);
    },
  });
}
