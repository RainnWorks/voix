/**
 * HTTP API: /api/modes/*
 *
 * Thin JSON wrapper over the in-process mode store. Lets the UI (and
 * any other client — Mac app, iOS later) drive the same source of
 * truth the daemon's own session bridge uses.
 *
 * Returns the canonical Mode shape from modes/types — no UI-shaped
 * DTOs, no field renames. If we later add Treaty for end-to-end
 * typing, this is the surface it auto-derives from.
 */

import { Elysia } from "elysia";
import { getMode, listModes, updateMode, upsertMode } from "../modes/store.ts";
import type { ModeUpdate } from "../modes/types.ts";
import { haSync } from "./ha_sync.ts";

export function modesRoute() {
  return (
    new Elysia({ name: "voix.api.modes" })
      .get("/api/modes", () => listModes())
      .get("/api/modes/:id", ({ params, set }) => {
        // listModes returns the in-memory cache; getMode never throws
        // but returns the default fallback when the id is unknown. We
        // want "404 if you ask for a specific id that doesn't exist",
        // so check against the list rather than calling getMode().
        const m = listModes().find((x) => x.id === params.id);
        if (!m) {
          set.status = 404;
          return { error: `unknown mode: ${params.id}` };
        }
        return m;
      })
      .patch("/api/modes/:id", async ({ params, body, set }) => {
        const m = listModes().find((x) => x.id === params.id);
        if (!m) {
          set.status = 404;
          return { error: `unknown mode: ${params.id}` };
        }
        try {
          const next = await updateMode(params.id, body as ModeUpdate);
          // Fire-and-forget HA sync. If HA isn't configured this is a
          // no-op; if it fails the daemon record stays authoritative.
          haSync.updateMode(params.id, body as Record<string, unknown>);
          return next;
        } catch (err) {
          set.status = 400;
          return { error: err instanceof Error ? err.message : String(err) };
        }
      })
      .post("/api/modes", async ({ body, set }) => {
        const mode = body as Parameters<typeof upsertMode>[0];
        if (!mode?.id) {
          set.status = 400;
          return { error: "mode.id is required" };
        }
        const next = await upsertMode(mode);
        return next;
      })
      // Diagnostic helper — quick way to verify the daemon's seen modes
      // catalog from the UI without parsing the full list.
      .get("/api/modes_count", () => ({ count: listModes().length }))
      // Echo route for the dev panel: tells the UI which mode_id the
      // default would resolve to. Saves a separate "fetch the entry's
      // CONF_DEFAULT_MODE" call.
      .get("/api/modes/default/resolved", () => getMode(null))
  );
}
