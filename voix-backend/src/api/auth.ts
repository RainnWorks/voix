/**
 * HTTP API: /api/auth/*
 *
 * Minimal auth surface for the daemon's own UI (M18 needs the WS
 * token client-side to open the audio-io WS as a browser endpoint).
 *
 *   GET  /api/auth/ws-token  → { token } — the shared WS auth secret
 *
 * Threat model: the daemon's UI is served behind HA Add-on ingress,
 * which puts HA's auth in front of every request. Anyone reaching
 * /api/* has already authenticated to HA. In local dev (vite at
 * :5173 → daemon at :8765), the daemon is on localhost — no
 * authentication, but also no remote attack surface.
 *
 * If voix ever runs the daemon's UI publicly (without HA ingress),
 * this endpoint needs proper auth in front of it. For now: HA's
 * auth IS the auth.
 */

import { Elysia } from "elysia";
import { config } from "../env.ts";

export function authRoute() {
  return new Elysia({ name: "voix.api.auth" }).get("/api/auth/ws-token", () => ({
    token: config.wsToken,
  }));
}
