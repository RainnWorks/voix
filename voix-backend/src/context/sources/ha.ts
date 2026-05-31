/**
 * Home Assistant context source — MCP client connected to HA's
 * built-in `mcp_server` integration (HA Core 2025.2+).
 *
 * Surface exposed by HA's MCP server (per their docs and source under
 * `homeassistant/components/mcp_server/`):
 *
 *   • Tools — the Assist LLM API, filtered to entities the user has
 *     **exposed to Assist**. Names like `HassTurnOn`, `HassLightSet`,
 *     `HassMediaPause`, `GetLiveContext`, etc. We register every
 *     advertised tool with OpenAI Realtime (prefixed `ha__…` by the
 *     registry) so the model can act on the user's home.
 *
 *   • Resources — `homeassistant://assist/context-snapshot` when
 *     GetLiveContext is in the api scope. We read this at session
 *     start to populate the `[Context]` block with the current state
 *     of exposed entities.
 *
 * Transport: Streamable HTTP at `/api/mcp` — chosen specifically
 * because it lives under `/api/*`, which is what the HA Supervisor's
 * HA-core proxy at `http://supervisor/core/api/*` forwards. The
 * legacy SSE endpoint at `/mcp_server/sse` is OUTSIDE that proxy and
 * returns 404 when accessed through it. Streamable HTTP also accepts
 * the auto-injected SUPERVISOR_TOKEN (via `homeassistant_api: true`)
 * so users get HA tools wired with zero token paperwork.
 *
 * Failure modes:
 *   • No `haToken` configured → `connect()` resolves without
 *     registering anything. Pucks still work; realtime sessions just
 *     don't see HA tools. Logged once at boot.
 *   • Connection fails / drops mid-session → `gatherContext` returns
 *     empty, `callTool` returns isError=true. Sessions degrade
 *     gracefully rather than refusing to start.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { log } from "../../log.ts";
import type { ContextEntry, ContextSource, GatherArgs, ToolResult, ToolSpec } from "../types.ts";

const CLIENT_NAME = "voix-backend";
const CLIENT_VERSION = "0.1.0";
const CONNECT_TIMEOUT_MS = 5000;

export type HASourceOptions = {
  baseUrl: string;
  token: string;
};

export class HAContextSource implements ContextSource {
  readonly name = "ha";

  private client: Client | null = null;
  private connected = false;
  /** Tools as HA advertises them — without the `ha__` prefix the
   *  registry adds. Cached so listTools is synchronous-ish after the
   *  initial fetch. */
  private toolsCache: ToolSpec[] | null = null;

  constructor(private readonly opts: HASourceOptions) {}

  async connect(): Promise<void> {
    // HA's Streamable HTTP endpoint at `<base>/api/mcp`. String concat
    // (not `new URL("/api/mcp", base)`) so path prefixes like `/core`
    // on the supervisor proxy aren't dropped — both work:
    //   • `http://supervisor/core` → `http://supervisor/core/api/mcp`
    //   • `http://192.168.1.2:8123` → `http://192.168.1.2:8123/api/mcp`
    const url = new URL(`${this.opts.baseUrl.replace(/\/$/, "")}/api/mcp`);

    const transport = new StreamableHTTPClientTransport(url, {
      // Streamable HTTP transport takes a `requestInit` whose headers
      // get attached to every JSON-RPC POST. The Authorization header
      // is HA's standard bearer auth — SUPERVISOR_TOKEN works here
      // because /api/* goes through the proxy that injects supervisor
      // identity for HA core.
      requestInit: {
        headers: { Authorization: `Bearer ${this.opts.token}` },
      },
    });

    const client = new Client({ name: CLIENT_NAME, version: CLIENT_VERSION });

    try {
      await Promise.race([
        client.connect(transport),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error(`MCP connect timeout (${CONNECT_TIMEOUT_MS}ms)`)),
            CONNECT_TIMEOUT_MS,
          ),
        ),
      ]);
      this.client = client;
      this.connected = true;
      log.info(`ha context: connected to ${url.toString()}`);
    } catch (err) {
      log.warn(`ha context: connect failed (${url.toString()}): ${stringifyErr(err)}`);
      // Leave `connected` false. Sessions proceed without HA tools.
    }
  }

  async listTools(): Promise<ToolSpec[]> {
    if (!this.client || !this.connected) return [];
    if (this.toolsCache) return this.toolsCache;

    try {
      const resp = await this.client.listTools();
      // Wave A #4: neutral ToolSpec — HA's MCP server already ships
      // JSON Schema for the tool args; we round-trip it verbatim
      // through `inputSchemaJson`. The OpenAI adapter (or any future
      // provider adapter) translates to the provider's native shape
      // at the boundary; this source stays provider-agnostic.
      const specs: ToolSpec[] = resp.tools.map((t) => ({
        name: t.name,
        description: t.description ?? "",
        // Strip the `$schema` field if present — OpenAI doesn't want
        // it, and other providers don't care.
        inputSchemaJson: stripJsonSchemaMeta(t.inputSchema ?? {}),
      }));
      this.toolsCache = specs;
      log.info(`ha context: ${specs.length} tools loaded`);
      return specs;
    } catch (err) {
      log.warn(`ha context: listTools failed: ${stringifyErr(err)}`);
      return [];
    }
  }

  async gatherContext(_args: GatherArgs): Promise<ContextEntry[]> {
    if (!this.client || !this.connected) return [];

    // Read the live-context resource if HA's exposed it (depends on
    // whether the user's MCP api scope includes GetLiveContext).
    try {
      const result = await this.client.readResource({
        uri: "homeassistant://assist/context-snapshot",
      });
      const lines: string[] = [];
      for (const content of result.contents) {
        // ResourceContents is a discriminated union of `{ uri, text }`
        // and `{ uri, blob }`. We only want the text variant — blob
        // resources (binary attachments) aren't useful in the prompt.
        if ("text" in content && typeof content.text === "string") {
          lines.push(content.text);
        }
      }
      if (lines.length === 0) return [];
      return [
        {
          source: "ha",
          data: { snapshot: lines.join("\n\n") },
        },
      ];
    } catch (err) {
      // Resource may not exist if GetLiveContext isn't in scope.
      // That's not a problem — the model can call tools on demand.
      log.debug(`ha context: resource read failed: ${stringifyErr(err)}`);
      return [];
    }
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<ToolResult> {
    if (!this.client || !this.connected) {
      return {
        content: JSON.stringify({ error: "ha mcp not connected" }),
        isError: true,
      };
    }
    try {
      const result = await this.client.callTool({ name, arguments: args });
      // MCP `callTool` returns `{ content: ContentBlock[], isError? }`.
      // The SDK types `content` as `unknown` in some versions; we coerce
      // and skip anything that isn't a recognisable text/object block.
      const parts: string[] = [];
      const content = Array.isArray(result.content) ? result.content : [];
      for (const blockUnknown of content) {
        const block = blockUnknown as { type?: string; text?: string };
        if (block.type === "text" && typeof block.text === "string") {
          parts.push(block.text);
        } else {
          parts.push(JSON.stringify(block));
        }
      }
      return {
        content: parts.join("\n") || "ok",
        isError: result.isError === true,
      };
    } catch (err) {
      return {
        content: JSON.stringify({ error: stringifyErr(err) }),
        isError: true,
      };
    }
  }

  async close(): Promise<void> {
    try {
      await this.client?.close();
    } catch (err) {
      log.debug(`ha context: close threw: ${stringifyErr(err)}`);
    }
    this.client = null;
    this.connected = false;
  }
}

function stringifyErr(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

function stripJsonSchemaMeta(schema: unknown): Record<string, unknown> {
  if (typeof schema !== "object" || schema === null) return {};
  const obj = schema as Record<string, unknown>;
  const clean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (k.startsWith("$") || k === "additionalProperties") continue;
    clean[k] = v;
  }
  return clean;
}
