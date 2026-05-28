/**
 * voix-backend entrypoint.
 *
 * Boots a single Elysia app that hosts:
 *   • /ws         — puck WebSocket endpoint (mic in, audio + transcripts out)
 *   • /healthz    — liveness probe for HA Add-on supervisor
 *
 * The HTTP surface stays minimal on purpose: the daemon is a WS service.
 * Anything else (settings, history, mode editor) belongs in the desktop
 * client, not here.
 */

import { Elysia } from "elysia";
import { registerSource } from "./context/registry.ts";
import { HAContextSource } from "./context/sources/ha.ts";
import { voixSource } from "./context/sources/voix.ts";
import { config } from "./env.ts";
import { loadHistory } from "./history/store.ts";
import { log } from "./log.ts";
import { loadModes } from "./modes/store.ts";
import { puckRoute } from "./puck/route.ts";

// Async boot: load disk state before the WS endpoint accepts pucks.
// If either fails we don't want to refuse pucks silently — log and
// continue with empty in-memory state. Built-in modes will be re-seeded
// on next clean save.
await loadModes().catch((e) => log.warn("boot: loadModes failed", e));
await loadHistory().catch((e) => log.warn("boot: loadHistory failed", e));

// voix-builtin source — always registered. Exposes `end_session` so
// the model can close conversations cleanly when they wrap (the
// realtime system prompt instructs it to call this).
registerSource(voixSource);
void voixSource.connect();

// Register context sources. Each `connect()` is independent — a slow
// or unreachable source must NOT block the daemon from accepting pucks.
// We fire-and-forget the connects after registration; sessions check
// `connected` at gather time and skip a source that's not ready yet.
if (config.haUrl && config.haToken) {
  const ha = new HAContextSource({ baseUrl: config.haUrl, token: config.haToken });
  registerSource(ha);
  void ha.connect();
} else {
  log.info(
    "boot: HA MCP source not configured (ha_url + ha_token missing) — " +
      "realtime sessions will run without HA tools/state.",
  );
}

const app = new Elysia()
  .get("/healthz", () => ({ ok: true, version: "0.1.0" }))
  .use(puckRoute())
  .listen(config.port);

log.info(`listening on :${config.port} (log_level=${config.logLevel})`);

// Surface unexpected errors loud — the Add-on supervisor restarts us
// on non-zero exit, and silently swallowing a crash is worse than a
// reboot loop the user can see in the HA logs.
process.on("uncaughtException", (err) => {
  log.error("uncaughtException:", err);
  process.exit(1);
});
process.on("unhandledRejection", (reason) => {
  log.error("unhandledRejection:", reason);
  process.exit(1);
});

export type App = typeof app;
