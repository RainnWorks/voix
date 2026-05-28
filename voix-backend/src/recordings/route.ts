/**
 * HTTP routes for browsing + playing per-session recordings.
 *
 * Routes mounted at /recordings/*:
 *   GET /recordings/                  → HTML index page (one block per
 *                                       session with mic + speaker
 *                                       players and the transcripts)
 *   GET /recordings/:sessionId/mic.wav        → raw WAV
 *   GET /recordings/:sessionId/speaker.wav    → raw WAV
 *   GET /recordings/:sessionId/meta.json      → raw JSON
 *
 * The HTML is intentionally minimal — one stylesheet inline, no
 * framework, no JS framework. Open it in a browser, click play,
 * compare what XMOS sent us vs what the model said. That's the whole
 * tool. Diagnostic, not pretty.
 */

import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { Elysia } from "elysia";
import { log } from "../log.ts";
import { paths } from "../storage/paths.ts";
import type { RecorderMeta } from "./store.ts";

type SessionSummary = {
  sessionId: string;
  meta: RecorderMeta | null;
  hasMic: boolean;
  hasSpeaker: boolean;
  bytesMic: number;
  bytesSpeaker: number;
};

async function listSessions(): Promise<SessionSummary[]> {
  let entries: string[];
  try {
    entries = await readdir(paths.recordingsDir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    log.warn("recordings: readdir failed:", err);
    return [];
  }

  const summaries: SessionSummary[] = [];
  await Promise.all(
    entries.map(async (sessionId) => {
      const dir = paths.recordingDir(sessionId);
      const [metaText, micStat, speakerStat] = await Promise.all([
        readFile(join(dir, "meta.json"), "utf8").catch(() => ""),
        stat(join(dir, "mic.wav")).catch(() => null),
        stat(join(dir, "speaker.wav")).catch(() => null),
      ]);
      let meta: RecorderMeta | null = null;
      if (metaText) {
        try {
          meta = JSON.parse(metaText) as RecorderMeta;
        } catch {
          // Corrupt JSON — leave meta null, the row still renders.
        }
      }
      summaries.push({
        sessionId,
        meta,
        hasMic: micStat !== null,
        hasSpeaker: speakerStat !== null,
        bytesMic: micStat?.size ?? 0,
        bytesSpeaker: speakerStat?.size ?? 0,
      });
    }),
  );

  // Newest first by startedAt; fall back to sessionId reverse so a
  // missing meta doesn't disappear into the middle.
  summaries.sort((a, b) => {
    const av = a.meta?.startedAt ?? "";
    const bv = b.meta?.startedAt ?? "";
    if (av && bv) return bv.localeCompare(av);
    return b.sessionId.localeCompare(a.sessionId);
  });
  return summaries;
}

function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c,
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)} s`;
  return `${Math.floor(s / 60)}m ${(s % 60).toFixed(0)}s`;
}

function renderIndex(sessions: SessionSummary[]): string {
  const rows = sessions
    .map((s) => {
      const m = s.meta;
      const ts = (m?.transcripts ?? [])
        .map(
          (t) =>
            `<div class="t"><span class="${t.role}">[${t.role}]</span> ${escapeHtml(t.text)}</div>`,
        )
        .join("");
      const player = (file: "mic" | "speaker", bytes: number): string =>
        `<div class="player">
            <div class="label">${file} (${formatBytes(bytes)})</div>
            <audio controls preload="metadata" src="/recordings/${s.sessionId}/${file}.wav"></audio>
          </div>`;
      return `
        <section>
          <h2>${m?.startedAt ?? "?"} — ${escapeHtml(m?.modeName ?? "?")}</h2>
          <div class="meta">
            <code>${s.sessionId}</code> · device <code>${escapeHtml(m?.deviceId ?? "?")}</code>
            · ${m ? formatDuration(m.durationMs) : "?"}
            · mode_id <code>${escapeHtml(m?.modeId ?? "?")}</code>
          </div>
          ${s.hasMic ? player("mic", s.bytesMic) : '<div class="player empty">no mic.wav</div>'}
          ${s.hasSpeaker ? player("speaker", s.bytesSpeaker) : '<div class="player empty">no speaker.wav</div>'}
          ${ts ? `<div class="transcripts">${ts}</div>` : ""}
        </section>`;
    })
    .join("\n");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>voix recordings (${sessions.length})</title>
<style>
  body { font: 14px/1.4 -apple-system, system-ui, sans-serif; max-width: 880px; margin: 24px auto; padding: 0 16px; color: #222; background: #fafafa; }
  h1 { font-weight: 600; margin: 0 0 12px; }
  h2 { font-weight: 500; margin: 0 0 6px; font-size: 15px; color: #111; }
  section { background: #fff; border: 1px solid #e6e6e6; border-radius: 8px; padding: 14px 16px; margin: 12px 0; }
  code { background: #f3f3f3; padding: 1px 5px; border-radius: 3px; font-size: 12px; }
  .meta { color: #666; font-size: 12px; margin-bottom: 10px; }
  .player { display: flex; align-items: center; gap: 10px; margin: 4px 0; }
  .player.empty { color: #999; font-size: 12px; font-style: italic; }
  .label { width: 100px; font-size: 12px; color: #555; }
  audio { flex: 1; height: 32px; }
  .transcripts { margin-top: 10px; padding-top: 10px; border-top: 1px solid #f0f0f0; font-size: 13px; }
  .t { margin: 3px 0; }
  .t .user { color: #1976d2; font-weight: 500; }
  .t .assistant { color: #388e3c; font-weight: 500; }
  .empty-state { color: #999; text-align: center; padding: 40px; font-style: italic; }
</style>
</head>
<body>
<h1>voix recordings</h1>
<div class="meta">${sessions.length} session${sessions.length === 1 ? "" : "s"}, newest first. Captured at the raw level the puck delivered (mic) and the level OpenAI sent us (speaker).</div>
${sessions.length === 0 ? '<div class="empty-state">No recordings yet — wake-word your puck to make one.</div>' : rows}
</body>
</html>`;
}

export function recordingsRoute() {
  return (
    new Elysia({ name: "voix.recordings" })
      .get("/recordings/", async ({ set }) => {
        const sessions = await listSessions();
        set.headers["content-type"] = "text/html; charset=utf-8";
        return renderIndex(sessions);
      })
      // Without trailing slash too — courtesy for terminals.
      .get("/recordings", ({ set }) => {
        set.redirect = "/recordings/";
      })
      .get("/recordings/:sessionId/:file", async ({ params, set }) => {
        const allowed = ["mic.wav", "speaker.wav", "meta.json"] as const;
        if (!allowed.includes(params.file as (typeof allowed)[number])) {
          set.status = 404;
          return "not found";
        }
        // Block path traversal — sessionId is a hex token, no slashes.
        if (!/^[a-zA-Z0-9_-]+$/.test(params.sessionId)) {
          set.status = 400;
          return "bad sessionId";
        }
        const path = join(paths.recordingDir(params.sessionId), params.file);
        try {
          const data = await readFile(path);
          set.headers["content-type"] = params.file.endsWith(".wav")
            ? "audio/wav"
            : "application/json";
          return data;
        } catch {
          set.status = 404;
          return "not found";
        }
      })
  );
}
