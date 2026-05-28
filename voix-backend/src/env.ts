/**
 * Runtime config. Read once at boot. Validated at the boundary so the
 * rest of the codebase can `import { config }` and trust the shape.
 *
 * Two sources of values:
 *   1. Environment variables (dev — Bun reads .env automatically).
 *   2. HA Add-on options.json mounted at /data/options.json (production
 *      when running as a Home Assistant Add-on).
 *
 * Add-on options win when present; envs are the local-dev fallback.
 */

import { readFileSync } from "node:fs";

type RawAddonOptions = {
  openai_api_key?: string;
  openrouter_api_key?: string;
  ws_token?: string;
  port?: number;
  log_level?: string;
  /** Home Assistant base URL the daemon connects back to for its MCP
   *  client. When running as an HA Add-on this defaults to the
   *  Supervisor API ("http://supervisor/core") — set explicitly only
   *  when overriding (e.g. dev pointing at a separate HA install). */
  ha_url?: string;
  /** HA long-lived access token for MCP client. Required if the user
   *  wants the realtime model to see HA tools/state. */
  ha_token?: string;
};

function readAddonOptions(): RawAddonOptions | null {
  try {
    const raw = readFileSync("/data/options.json", "utf8");
    return JSON.parse(raw) as RawAddonOptions;
  } catch {
    return null;
  }
}

const addon = readAddonOptions();

function required(value: string | undefined, name: string): string {
  if (!value) {
    throw new Error(
      `voix-backend: required config ${name} is missing. Set it in the HA ` +
        `Add-on options (production) or .env (dev).`,
    );
  }
  return value;
}

// process.env is index-signed under strict noPropertyAccessFromIndexSignature
// — explicit bracket access keeps the type checker happy and makes it easier
// to grep for env names from a CLI.
const env = process.env;

export const config = {
  openaiApiKey: required(addon?.openai_api_key || env["OPENAI_API_KEY"], "OPENAI_API_KEY"),
  // OpenRouter is OPTIONAL — only modes that explicitly select it for
  // post-processing need a key. Returning undefined when missing is
  // fine; the post-proc layer falls back to raw text if a mode wants
  // OpenRouter but no key was configured.
  openrouterApiKey: addon?.openrouter_api_key || env["OPENROUTER_API_KEY"] || undefined,
  wsToken: required(addon?.ws_token || env["VOIX_WS_TOKEN"], "VOIX_WS_TOKEN"),
  port: Number(addon?.port ?? env["VOIX_PORT"] ?? 8765),
  // HA MCP connection.
  //
  // URL: defaults to `http://homeassistant:8123` — the Docker network
  // hostname for HA core when running as an add-on. We tried the
  // Supervisor's `/core/*` proxy first, but it only forwards `/api/*`
  // paths; `/mcp_server/sse` returns 404. Direct-to-HA is the right
  // path for non-/api/ endpoints.
  //
  // Token: resolves in order:
  //   1. Explicit add-on option (`ha_token`) — what users will normally
  //      set, a long-lived access token from their HA user.
  //   2. Explicit env var (dev mode).
  //   3. SUPERVISOR_TOKEN — auto-injected by HA Supervisor when the
  //      add-on declares `homeassistant_api: true`. Accepted by HA's
  //      REST `/api/*` endpoints but REJECTED by mcp_server (which
  //      requires a real-user token). Set anyway as a fallback so the
  //      daemon can still call `/api/services/...` etc; mcp_server
  //      will surface a 403 in the logs if no real token is set.
  haUrl: addon?.ha_url || env["HA_URL"] || "http://homeassistant:8123",
  haToken: addon?.ha_token || env["HA_TOKEN"] || env["SUPERVISOR_TOKEN"] || undefined,
  logLevel: (addon?.log_level || env["VOIX_LOG_LEVEL"] || "info") as
    | "trace"
    | "debug"
    | "info"
    | "warn"
    | "error",
} as const;
