/**
 * HTTP API: /api/voices/*
 *
 * Thin JSON wrapper over the in-process mode store. Lets the UI (and
 * any other client — Mac app, iOS later) drive the same source of
 * truth the daemon's own session bridge uses.
 *
 * Returns the canonical Voice shape from modes/types — no UI-shaped
 * DTOs, no field renames. If we later add Treaty for end-to-end
 * typing, this is the surface it auto-derives from.
 */

import { Elysia } from "elysia";
import { getVoice, listVoices, updateVoice, upsertVoice } from "../voices/store.ts";
import type { VoiceUpdate } from "../voices/types.ts";
import { haSync } from "./ha_sync.ts";

export function voicesRoute() {
  return (
    new Elysia({ name: "voix.api.modes" })
      .get("/api/voices", () => listVoices())
      .get("/api/voices/:id", ({ params, set }) => {
        // listVoices returns the in-memory cache; getVoice never throws
        // but returns the default fallback when the id is unknown. We
        // want "404 if you ask for a specific id that doesn't exist",
        // so check against the list rather than calling getVoice().
        const m = listVoices().find((x) => x.id === params.id);
        if (!m) {
          set.status = 404;
          return { error: `unknown mode: ${params.id}` };
        }
        return m;
      })
      .patch("/api/voices/:id", async ({ params, body, set }) => {
        const m = listVoices().find((x) => x.id === params.id);
        if (!m) {
          set.status = 404;
          return { error: `unknown mode: ${params.id}` };
        }
        try {
          const next = await updateVoice(params.id, body as VoiceUpdate);
          // Fire-and-forget HA sync. If HA isn't configured this is a
          // no-op; if it fails the daemon record stays authoritative.
          haSync.updateVoice(params.id, body as Record<string, unknown>);
          return next;
        } catch (err) {
          set.status = 400;
          return { error: err instanceof Error ? err.message : String(err) };
        }
      })
      .post("/api/voices", async ({ body, set }) => {
        const mode = body as Parameters<typeof upsertVoice>[0];
        if (!mode?.id) {
          set.status = 400;
          return { error: "mode.id is required" };
        }
        const next = await upsertVoice(mode);
        return next;
      })
      // Diagnostic helper — quick way to verify the daemon's seen modes
      // catalog from the UI without parsing the full list.
      .get("/api/voices_count", () => ({ count: listVoices().length }))
      // Echo route for the dev panel: tells the UI which mode_id the
      // default would resolve to. Saves a separate "fetch the entry's
      // CONF_DEFAULT_MODE" call.
      .get("/api/voices/default/resolved", () => getVoice(null))
  );
}
