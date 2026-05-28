/**
 * voix builtin context source — exposes daemon-side tools the model
 * can call to manage its own session.
 *
 * Today it ships one tool: `end_session` (registered with OpenAI as
 * `voix__end_session` per the registry's prefix convention). The
 * realtime prompt instructs the model to call it when a conversation
 * naturally wraps. Without this the model would either monologue
 * forever waiting for follow-up, or use the watchdog idle-timeout as
 * the close — both wasteful.
 *
 * It's a context source so it goes through the same tool-call relay
 * as MCP-backed sources (no special-case code path in PuckSession).
 * The trick is that calling `end_session` needs to TELL THE SESSION
 * to close — which is daemon-internal state, not something a generic
 * MCP server could trigger. The source holds a per-session callback
 * the caller installs at session start (see `bindSession`).
 */

import { log } from "../../log.ts";
import type { ContextEntry, ContextSource, GatherArgs, ToolResult, ToolSpec } from "../types.ts";

export type CloseCallback = (reason: string) => void;

export class VoixContextSource implements ContextSource {
  readonly name = "voix";

  /** Per-deviceId close callback. The registry is process-global, but
   *  each puck has its own active session — we route by device. */
  private closers = new Map<string, CloseCallback>();

  async connect(): Promise<void> {
    // Nothing to dial; this source is fully in-process.
  }

  /** Called by PuckSession at start. The handler closes the session
   *  when the model invokes end_session. */
  bindSession(deviceId: string, close: CloseCallback): void {
    this.closers.set(deviceId, close);
  }

  unbindSession(deviceId: string): void {
    this.closers.delete(deviceId);
  }

  async gatherContext(_args: GatherArgs): Promise<ContextEntry[]> {
    // Nothing to inject — this source is action-only.
    return [];
  }

  async listTools(): Promise<ToolSpec[]> {
    return [
      {
        type: "function",
        name: "end_session",
        description:
          "Close the current voice session. Call this when the conversation has " +
          "naturally concluded and there's no obvious follow-up — don't drag the " +
          "turn out asking 'is there anything else'.",
        // OpenAI requires a parameters object even for nullary tools.
        // Empty `properties` + `additionalProperties: false` is the
        // canonical shape; without `additionalProperties` some models
        // happily invent random arguments.
        parameters: {
          type: "object",
          properties: {},
          additionalProperties: false,
        },
      },
    ];
  }

  async callTool(name: string, _args: Record<string, unknown>): Promise<ToolResult> {
    if (name !== "end_session") {
      return {
        content: JSON.stringify({ error: `unknown voix tool: ${name}` }),
        isError: true,
      };
    }
    // We don't have a per-call device handle from the registry yet — the
    // current relay routes tool calls without a deviceId. For v1 we
    // close every session bound to this source. With a single puck per
    // daemon (the normal home case) this is correct; for multi-puck
    // installs we'll need to thread deviceId through the tool-call
    // path. Logged so the issue is visible if it ever matters.
    const closers = Array.from(this.closers.values());
    if (closers.length === 0) {
      return {
        content: JSON.stringify({ ok: true, note: "no active session to close" }),
      };
    }
    if (closers.length > 1) {
      log.warn(
        `voix end_session: ${closers.length} sessions bound — closing all (multi-puck routing TODO)`,
      );
    }
    for (const close of closers) {
      try {
        close("model called end_session");
      } catch (err) {
        log.warn("voix end_session: close threw", err);
      }
    }
    return { content: JSON.stringify({ ok: true }) };
  }
}

/** Process-wide singleton — both the boot path (index.ts) and the
 *  session bridge (puck/session.ts) need to talk to the same instance. */
export const voixSource = new VoixContextSource();
