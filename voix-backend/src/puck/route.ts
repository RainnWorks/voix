/**
 * Elysia route definition for the puck WS endpoint.
 *
 * One open WS = one in-flight session. Session lifecycle is owned by
 * `PuckSession` (./session.ts); this file is just the WS glue (open /
 * message / close / error).
 *
 * Per-connection state is held in a `WeakMap` keyed by the underlying
 * Bun `ServerWebSocket`. Elysia's `ws.data` is the request Context
 * (not freely writable per-connection state), so the canonical pattern
 * is to use the underlying socket as a map key. WeakMap means closed
 * sockets are garbage-collected automatically — no manual cleanup.
 *
 * Auth model: the first text frame MUST be a hello message containing
 * the shared token. Until that's received, the connection is in
 * "pending hello" state and any binary frame is dropped. Mismatched
 * token → close(1008 Policy Violation). Pucks tolerate this politely;
 * the firmware re-establishes after a short backoff.
 */

import { Elysia } from "elysia";
import { config } from "../env.ts";
import { log } from "../log.ts";
import type { PuckHello } from "./protocol.ts";
import { PuckSession, type WSLike } from "./session.ts";

type ConnState = {
  session: PuckSession | null;
  deviceId: string;
};

// Keyed by the underlying Bun socket reference — same object across
// all Elysia hooks for a connection. WeakMap so we don't pin closed
// sockets. Key type is `object` because Elysia parameterises its raw
// ServerWebSocket with an internal `{id, validator}` shape we don't
// want to leak into the rest of the code.
const connState = new WeakMap<object, ConnState>();

function getState(ws: { raw: object }): ConnState {
  const existing = connState.get(ws.raw);
  if (existing) return existing;
  const fresh: ConnState = { session: null, deviceId: "?" };
  connState.set(ws.raw, fresh);
  return fresh;
}

// Note: return type intentionally inferred. Elysia's generic chain is
// extremely specific, and annotating `: Elysia` narrows it incorrectly
// (Elysia v1.4 type chain). Let TS infer.
export function puckRoute() {
  return new Elysia({ name: "voix.puck" }).ws("/ws", {
    open(ws) {
      // Initialise state slot eagerly so the first message lookup
      // doesn't allocate during the hot path.
      getState(ws);
      log.debug("puck: ws open");
    },

    async message(ws, raw) {
      const state = getState(ws);

      // Binary frame = mic PCM16 chunk from puck. Forward to the
      // session if one's established; drop otherwise.
      if (raw instanceof Uint8Array || raw instanceof ArrayBuffer) {
        if (!state.session) {
          log.debug("puck: dropping binary frame before hello");
          return;
        }
        const buf =
          raw instanceof Uint8Array
            ? Buffer.from(raw.buffer, raw.byteOffset, raw.byteLength)
            : Buffer.from(raw);
        state.session.handlePuckAudio(buf);
        return;
      }

      // Text frame → JSON envelope. Only `hello` is meaningful right
      // now; further control messages can be added later as the
      // protocol evolves.
      let parsed: unknown;
      try {
        if (typeof raw === "string") {
          parsed = JSON.parse(raw);
        } else if (raw && typeof (raw as { type?: string }).type === "string") {
          // Elysia may have already parsed JSON for us — accept it.
          parsed = raw;
        } else {
          log.warn("puck: unknown text frame shape");
          return;
        }
      } catch {
        log.warn("puck: dropping non-JSON text frame");
        return;
      }

      const env = parsed as { type?: string };

      // Post-hello control messages from the puck. Today: ready_for_input
      // (puck speaker just drained — user can speak again). Routed to
      // the session so its idle watchdog can reset.
      if (env.type === "ready_for_input") {
        state.session?.handlePuckReadyForInput();
        return;
      }

      if (env.type !== "hello") {
        log.warn(`puck: unexpected text frame type=${env.type ?? "?"}`);
        return;
      }

      const hello = parsed as PuckHello;
      if (!hello.token || hello.token !== config.wsToken) {
        log.warn(`puck: hello with bad/missing token (device=${hello.device_id ?? "?"})`);
        try {
          ws.send({ type: "decline", reason: "auth" });
        } catch {
          // Best-effort.
        }
        ws.close(1008, "auth");
        return;
      }

      if (state.session) {
        log.warn("puck: ignoring repeat hello — session already established");
        return;
      }

      state.deviceId = hello.device_id;
      // PuckSession works against a minimal `WSLike` interface so it
      // doesn't have to know about Elysia's internal data shape. The
      // raw Bun socket satisfies it structurally.
      const session = new PuckSession(ws.raw as unknown as WSLike, {
        openaiApiKey: config.openaiApiKey,
        hello,
      });
      state.session = session;
      await session.start();
    },

    close(ws, code, reason) {
      const state = getState(ws);
      log.debug(`puck: ws close device=${state.deviceId} code=${code} reason=${reason ?? ""}`);
      state.session?.close();
      // Note: WeakMap entry will GC once `ws.raw` becomes unreachable.
    },

    error({ error }) {
      log.warn("puck: ws error", error);
    },
  });
}
