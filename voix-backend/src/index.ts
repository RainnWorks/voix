/**
 * voix-backend entrypoint.
 *
 * Boots a single Elysia app that hosts:
 *   • /ws            — Audio I/O WS endpoint (mic in, audio + transcripts out)
 *   • /healthz       — liveness probe for HA Add-on supervisor
 *   • /api/modes/*   — JSON API the UI (and any other client) drives modes through
 *   • /recordings/*  — per-session WAV playback browser
 *   • /              — React+RN-Web UI for mode editing / history / playback
 */

import { Elysia } from "elysia";
import { devicesRoute } from "./api/devices.ts";
import { voicesRoute } from "./api/voices.ts";
import { audioIoRoute } from "./audio_io/route.ts";
import { registerSource } from "./context/registry.ts";
import { HAContextSource } from "./context/sources/ha.ts";
import { voixSource } from "./context/sources/voix.ts";
import { loadDevices } from "./devices/store.ts";
import { config } from "./env.ts";
import { loadHistory } from "./history/store.ts";
import { log } from "./log.ts";
import { recordingsRoute } from "./recordings/route.ts";
import { uiRoute } from "./ui/route.ts";
import { loadVoices } from "./voices/store.ts";

// Async boot: load disk state before the WS endpoint accepts pucks.
// If either fails we don't want to refuse pucks silently — log and
// continue with empty in-memory state. Built-in modes will be re-seeded
// on next clean save.
await loadVoices().catch((e) => log.warn("boot: loadVoices failed", e));
await loadHistory().catch((e) => log.warn("boot: loadHistory failed", e));
await loadDevices().catch((e) => log.warn("boot: loadDevices failed", e));

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

// Order matters — Elysia matches first, fall-through SPA route is last.
const app = new Elysia()
  .get("/healthz", () => ({ ok: true, version: "0.1.0" }))
  .use(audioIoRoute())
  .use(voicesRoute())
  .use(devicesRoute())
  .use(recordingsRoute())
  .use(uiRoute())
  .listen(config.port);

log.info(`listening on :${config.port} (log_level=${config.logLevel})`);

// Surface unexpected errors loudly but DON'T tear the process down —
// an isolated promise rejection on (say) a transcript file write is
// not worth killing an active puck session over. The HA Add-on
// supervisor will still see logs in `ha addons logs` either way.
//
// uncaughtException is still fatal: by definition the JS engine
// reached a state where it can't continue safely. unhandledRejection
// is recoverable in practice — most are missing `.catch()`s on
// fire-and-forget calls, where the only damage is whatever that
// specific call was trying to do.
process.on("uncaughtException", (err) => {
  log.error("uncaughtException — exiting:", err);
  process.exit(1);
});
process.on("unhandledRejection", (reason) => {
  log.error("unhandledRejection (kept alive):", reason);
});

export type App = typeof app;
