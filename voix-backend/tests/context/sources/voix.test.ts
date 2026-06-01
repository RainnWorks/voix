/**
 * VoixContextSource tests (B11 — coverage backfill).
 *
 * `src/context/sources/voix.ts` was at ~13% line coverage. It's the
 * builtin "the model can manage its own session" source — today one
 * tool, `end_session`, which has to reach back into daemon-internal
 * session state via a per-device close callback. That callback relay
 * is the load-bearing bit: a regression here means either sessions
 * never auto-close (model monologues until the watchdog fires) or the
 * wrong session gets torn down. Pure in-process, no network/disk.
 *
 * Branches exercised:
 *   • listTools advertises end_session with the nullary schema
 *   • callTool on an unknown name → isError
 *   • callTool with no bound session → ok + "no active session" note
 *   • callTool with one bound session → close fires with a reason
 *   • callTool with multiple bound sessions → all close (multi-puck)
 *   • a close callback that throws is caught (one bad puck can't wedge
 *     the others)
 *   • unbindSession removes the closer so it no longer fires
 */

import { describe, expect, test } from "bun:test";
import { VoixContextSource } from "../../../src/context/sources/voix.ts";

describe("VoixContextSource", () => {
  test("listTools advertises end_session with a nullary schema", async () => {
    const src = new VoixContextSource();
    const tools = await src.listTools();
    expect(tools).toHaveLength(1);
    const tool = tools[0];
    expect(tool?.name).toBe("end_session");
    expect(tool?.inputSchemaJson).toEqual({
      type: "object",
      properties: {},
      additionalProperties: false,
    });
  });

  test("callTool with an unknown name returns an error result", async () => {
    const src = new VoixContextSource();
    const result = await src.callTool("not_a_tool", {});
    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content)).toEqual({ error: "unknown voix tool: not_a_tool" });
  });

  test("end_session with no bound session is a no-op success", async () => {
    const src = new VoixContextSource();
    const result = await src.callTool("end_session", {});
    expect(result.isError).toBeUndefined();
    expect(JSON.parse(result.content)).toEqual({ ok: true, note: "no active session to close" });
  });

  test("end_session fires the bound close callback with a reason", async () => {
    const src = new VoixContextSource();
    const reasons: string[] = [];
    src.bindSession("puck-a", (reason) => reasons.push(reason));
    const result = await src.callTool("end_session", {});
    expect(JSON.parse(result.content)).toEqual({ ok: true });
    expect(reasons).toEqual(["model called end_session"]);
  });

  test("end_session closes every bound session (multi-puck fallback)", async () => {
    const src = new VoixContextSource();
    const closed: string[] = [];
    src.bindSession("puck-a", () => closed.push("a"));
    src.bindSession("puck-b", () => closed.push("b"));
    const result = await src.callTool("end_session", {});
    expect(JSON.parse(result.content)).toEqual({ ok: true });
    expect(closed.sort()).toEqual(["a", "b"]);
  });

  test("a close callback that throws does not block the other sessions", async () => {
    const src = new VoixContextSource();
    const closed: string[] = [];
    src.bindSession("puck-bad", () => {
      throw new Error("close boom");
    });
    src.bindSession("puck-good", () => closed.push("good"));
    // The throw is caught internally; the call still resolves ok and
    // the healthy puck still closed.
    const result = await src.callTool("end_session", {});
    expect(JSON.parse(result.content)).toEqual({ ok: true });
    expect(closed).toEqual(["good"]);
  });

  test("unbindSession removes the closer so end_session no longer fires it", async () => {
    const src = new VoixContextSource();
    let fired = false;
    src.bindSession("puck-a", () => {
      fired = true;
    });
    src.unbindSession("puck-a");
    const result = await src.callTool("end_session", {});
    // Back to the no-session branch.
    expect(JSON.parse(result.content)).toEqual({ ok: true, note: "no active session to close" });
    expect(fired).toBe(false);
  });

  test("gatherContext yields nothing (action-only source)", async () => {
    const src = new VoixContextSource();
    await src.connect();
    expect(await src.gatherContext({ deviceId: "puck-a" })).toEqual([]);
  });
});
