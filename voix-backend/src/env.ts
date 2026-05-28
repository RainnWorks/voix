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
  // HA MCP connection. Default URL points at the Supervisor's HA-core
  // proxy when running as an add-on; the user can override for dev or
  // unusual networking. Token resolves in order:
  //   1. Explicit add-on option (rare — only if the user wants to use
  //      a long-lived token from a specific HA user).
  //   2. Explicit env var (dev mode).
  //   3. SUPERVISOR_TOKEN — auto-injected by HA Supervisor when the
  //      add-on declares `homeassistant_api: true`. This is the happy
  //      path: the user installs the add-on and gets HA tools wired
  //      with zero config.
  haUrl: addon?.ha_url || env["HA_URL"] || "http://supervisor/core",
  haToken: addon?.ha_token || env["HA_TOKEN"] || env["SUPERVISOR_TOKEN"] || undefined,
  logLevel: (addon?.log_level || env["VOIX_LOG_LEVEL"] || "info") as
    | "trace"
    | "debug"
    | "info"
    | "warn"
    | "error",
} as const;
