/**
 * HTTP API: /api/history/*
 *
 * Read access over the daemon's history store (M17). Used by the
 * Conversations screen + entry detail view.
 *
 *   GET  /api/history            → list of HistoryEntry, newest-first.
 *                                   Supports ?limit, ?voiceId,
 *                                   ?deviceId.
 *   GET  /api/history/:id        → one entry. 404 if unknown.
 *
 * Audio playback for an entry uses the existing /recordings/<sessionId>/
 * routes (mic.wav + speaker.wav) — the entry's sessionId is the key.
 * Transcript file content is exposed under /api/history/:id/transcript
 * when the entry has a non-null transcriptPath.
 */

import { readFile } from "node:fs/promises";
import { Elysia, t } from "elysia";
import { getHistoryEntry, listHistory } from "../history/store.ts";
import { log } from "../log.ts";

export function historyRoute() {
  return new Elysia({ name: "voix.api.history" })
    .get(
      "/api/history",
      ({ query }) => {
        return listHistory({
          voiceId: query.voiceId,
          deviceId: query.deviceId,
          limit: query.limit ? Number(query.limit) : undefined,
        });
      },
      {
        query: t.Object({
          voiceId: t.Optional(t.String()),
          deviceId: t.Optional(t.String()),
          limit: t.Optional(t.String()),
        }),
      },
    )
    .get("/api/history/:id", ({ params, set }) => {
      const entry = getHistoryEntry(params.id);
      if (!entry) {
        set.status = 404;
        return { error: `unknown history entry: ${params.id}` };
      }
      return entry;
    })
    .get("/api/history/:id/transcript", async ({ params, set }) => {
      const entry = getHistoryEntry(params.id);
      if (!entry) {
        set.status = 404;
        return { error: `unknown history entry: ${params.id}` };
      }
      if (!entry.transcriptPath) {
        return { content: entry.rawText, source: "rawText" };
      }
      try {
        const content = await readFile(entry.transcriptPath, "utf8");
        return { content, source: "file" };
      } catch (err) {
        log.warn(`history.transcript: read failed for ${entry.transcriptPath}:`, err);
        return { content: entry.rawText, source: "rawText-fallback" };
      }
    });
}
