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
 * Transport: HA exposes BOTH legacy SSE and newer Streamable HTTP.
 * We use SSE — it works against every HA install >= 2025.2 and is
 * what HA's docs still officially document. Streamable HTTP is an
 * optimisation we can swap to later (same MCP SDK surface, different
 * transport class).
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
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
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
    // HA's MCP SSE endpoint. Some installs mount it under `/mcp_server/
    // sse`, others (newer add-on packaging) under `/api/mcp`. Default
    // to `/mcp_server/sse` since that's what HA's docs reference; the
    // user can override with the trailing path on `ha_url` if needed.
    const url = new URL("/mcp_server/sse", this.opts.baseUrl);

    const transport = new SSEClientTransport(url, {
      // SSE transport in the MCP SDK supports custom request init for
      // the initial GET that opens the event stream. We pass the HA
      // bearer token here.
      requestInit: {
        headers: { Authorization: `Bearer ${this.opts.token}` },
      },
      eventSourceInit: {
        // Use fetch under the hood so we can attach the bearer token.
        // EventSource as bundled in Bun doesn't support custom headers,
        // hence the explicit fetch override.
        fetch: (input, init) =>
          fetch(input, {
            ...init,
            headers: { ...init?.headers, Authorization: `Bearer ${this.opts.token}` },
          }),
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
      const specs: ToolSpec[] = resp.tools.map((t) => ({
        type: "function" as const,
        name: t.name,
        description: t.description ?? "",
        // HA's MCP tools use JSON Schema for parameters. OpenAI
        // Realtime's function_call accepts the same JSON Schema
        // dialect under `parameters`, so the schema round-trips
        // verbatim. Strip the `$schema` field if present — OpenAI
        // doesn't want it.
        parameters: stripJsonSchemaMeta(t.inputSchema ?? {}),
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
