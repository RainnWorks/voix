/**
 * Context source registry — keeps the daemon's list of context
 * gatherers and orchestrates session-start fan-out.
 *
 * Sources register themselves at boot; sessions ask for everything at
 * once via `gatherAll`. Per-source timeouts mean a slow source can't
 * stall the realtime session.update — the session goes ahead with
 * partial context plus the slow source's tools still registered for
 * on-demand calls.
 *
 * Tool routing: tool names from sources are prefixed with the source
 * name (e.g. `ha__HassTurnOn`, `mac__get_focused_app`). When OpenAI
 * Realtime fires `function_call_arguments.done` with that name, the
 * relay strips the prefix and dispatches to the right source.
 *
 * Idempotency: `register` can be called multiple times for the same
 * source (re-connects); we replace, don't duplicate.
 */

import { log } from "../log.ts";
import type { ContextEntry, ContextSource, GatherArgs, ToolResult, ToolSpec } from "./types.ts";

const TOOL_PREFIX_SEP = "__";

/** Wall-clock budget for one source's `gatherContext`. Anything slower
 *  is skipped for that session — its tools remain available so the
 *  model can call them mid-conversation. */
const GATHER_TIMEOUT_MS = 2000;

const sources = new Map<string, ContextSource>();

export function registerSource(source: ContextSource): void {
  sources.set(source.name, source);
  log.info(`context: registered source ${source.name}`);
}

export async function gatherAll(args: GatherArgs): Promise<ContextEntry[]> {
  if (sources.size === 0) return [];

  const tasks = Array.from(sources.values()).map(async (src) => {
    try {
      const timeout = new Promise<ContextEntry[]>((_, reject) =>
        setTimeout(
          () => reject(new Error(`gatherContext timeout (${GATHER_TIMEOUT_MS}ms)`)),
          GATHER_TIMEOUT_MS,
        ),
      );
      return await Promise.race([src.gatherContext(args), timeout]);
    } catch (err) {
      log.warn(`context: ${src.name} gatherContext failed:`, err);
      return [];
    }
  });

  const settled = await Promise.all(tasks);
  return settled.flat();
}

/** Collect tools from all sources, prefixing names so the relay can
 *  route function calls back to the right source. */
export async function listAllTools(): Promise<ToolSpec[]> {
  const out: ToolSpec[] = [];
  for (const src of sources.values()) {
    try {
      const tools = await src.listTools();
      for (const t of tools) {
        out.push({
          ...t,
          name: `${src.name}${TOOL_PREFIX_SEP}${t.name}`,
          __source: src.name,
        });
      }
    } catch (err) {
      log.warn(`context: ${src.name} listTools failed:`, err);
    }
  }
  return out;
}

/** Route a tool call from OpenAI back to the source that owns it.
 *  Returns an error result if the prefix doesn't match any source. */
export async function callTool(
  prefixedName: string,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const sepIdx = prefixedName.indexOf(TOOL_PREFIX_SEP);
  if (sepIdx <= 0) {
    return {
      content: JSON.stringify({ error: `bad tool name (no source prefix): ${prefixedName}` }),
      isError: true,
    };
  }
  const sourceName = prefixedName.slice(0, sepIdx);
  const toolName = prefixedName.slice(sepIdx + TOOL_PREFIX_SEP.length);
  const src = sources.get(sourceName);
  if (!src) {
    return {
      content: JSON.stringify({ error: `unknown context source: ${sourceName}` }),
      isError: true,
    };
  }
  try {
    return await src.callTool(toolName, args);
  } catch (err) {
    log.warn(`context: ${sourceName}.${toolName} threw:`, err);
    return {
      content: JSON.stringify({
        error: err instanceof Error ? err.message : String(err),
      }),
      isError: true,
    };
  }
}

export async function shutdownAll(): Promise<void> {
  for (const src of sources.values()) {
    try {
      await src.close?.();
    } catch (err) {
      log.warn(`context: ${src.name} close failed:`, err);
    }
  }
  sources.clear();
}
