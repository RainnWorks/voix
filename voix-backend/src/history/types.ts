/**
 * History entry — one row per completed dictation or realtime turn.
 *
 * Shape ported from Supershout's `HistoryEntry`, minus the audio-path
 * field (we don't keep WAVs server-side yet) and plus a few voix-
 * specific fields (puck `deviceId`, mode type).
 *
 * Persisted as JSON-lines: one `{ … }` per file line. Append-only.
 * The whole file loads into memory on first read; for now we trust
 * that a year of dictation entries fits comfortably (~100k rows ≈
 * 30 MB, well within Bun heap for a single-user daemon). If that ever
 * stops being true we move to SQLite.
 */

export type ContextEntry = {
  /** Which context source produced this entry — for debugging /
   *  display, not for routing logic. e.g. "ha", "mac", "calendar". */
  source: string;
  /** Free-form key/value pairs. Source-specific. */
  data: Record<string, unknown>;
};

export type HistoryEntry = {
  id: string;
  createdAt: string;
  deviceId: string;
  sessionId: string;
  modeId: string;
  modeName: string;
  modeType: "realtime" | "dictation";
  durationMs: number;

  /** Raw transcript as STT produced it. Always set. */
  rawText: string;

  /** Post-processed text if the mode had a post_process_prompt. Null
   *  for raw dictation modes and for realtime sessions (which don't
   *  post-process). */
  processedText: string | null;

  /** Which provider+model produced `processedText`. Useful for cost
   *  attribution + reproducing the output later. */
  postProcessProvider: string | null;
  postProcessModel: string | null;

  /** Snapshot of the context that was gathered at session start. */
  contextSnapshot: ContextEntry[];

  /** Path on disk to the raw transcript file (mirrors what's in
   *  rawText, but useful when the file content has additional
   *  whitespace / multi-turn structure). */
  transcriptPath: string | null;
};
