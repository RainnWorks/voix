/**
 * Per-session audio recorder.
 *
 * Buffers raw mic and speaker PCM16 in memory, then writes WAV files
 * + a JSON metadata sidecar to disk when the session closes. One
 * folder per session under `<dataRoot>/voix/recordings/<sessionId>/`.
 *
 * Layout on disk:
 *   recordings/
 *     <sessionId>/
 *       mic.wav         16 kHz mono PCM16 — what the puck sent us
 *       speaker.wav     24 kHz mono PCM16 — what we sent to the puck
 *       meta.json       deviceId, voiceId, startedAt, durationMs,
 *                       transcripts captured during the session
 *
 * Use case: diagnose XMOS pipeline-stage choices, verify the echo
 * gate is doing the right thing, debug "model said X but the user
 * said Y" mis-transcriptions. The HTML browser route under
 * `/recordings/` makes them playable in any browser.
 *
 * Memory cost: a typical 30s conversation buffers ~960 KB mic (16 kHz)
 * + 1.4 MB speaker (24 kHz). Fine. A 3-minute session is ~14 MB —
 * still fine. Sessions are reaped to disk + freed at close.
 *
 * NOT included: pruning. Disk grows unbounded for now. We'll add a
 * "keep latest N sessions" job once we have field data on session
 * frequency and size.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

// (path helpers imported below)

import { log } from "../log.ts";
import { paths } from "../storage/paths.ts";
import { encodeWav } from "./wav.ts";

const MIC_RATE_HZ = 16000;
const SPEAKER_RATE_HZ = 24000;

export type RecorderMeta = {
  deviceId: string;
  sessionId: string;
  voiceId: string;
  voiceName: string;
  startedAt: string;
  durationMs: number;
  /** Captured during the session, newest-last. Each entry carries
   *  the role (user transcripts come from STT; assistant transcripts
   *  come from realtime model output_audio_transcript events). */
  transcripts: Array<{ role: "user" | "assistant"; text: string; atMs: number }>;
};

export class SessionRecorder {
  private micChunks: Buffer[] = [];
  private speakerChunks: Buffer[] = [];
  private transcripts: RecorderMeta["transcripts"] = [];
  private readonly startedAtMs = Date.now();

  constructor(
    private readonly deps: {
      deviceId: string;
      sessionId: string;
      voiceId: string;
      voiceName: string;
    },
  ) {}

  pushMic(pcm16: Buffer): void {
    if (pcm16.length === 0) return;
    // Copy because the caller's buffer may be reused by Bun's WS layer.
    // Cheap for our sizes — typical chunk is 320–2048 bytes.
    this.micChunks.push(Buffer.from(pcm16));
  }

  pushSpeaker(pcm24k: Buffer): void {
    if (pcm24k.length === 0) return;
    this.speakerChunks.push(Buffer.from(pcm24k));
  }

  pushTranscript(role: "user" | "assistant", text: string): void {
    const trimmed = text.trim();
    if (!trimmed) return;
    this.transcripts.push({ role, text: trimmed, atMs: Date.now() - this.startedAtMs });
  }

  /** Write WAVs + metadata to disk. Best-effort — logged + swallowed
   *  on error so a recording-storage failure can't kill a session. */
  async finalize(): Promise<void> {
    const dir = paths.recordingDir(this.deps.sessionId);
    try {
      await mkdir(dir, { recursive: true });
      const tasks: Promise<unknown>[] = [];
      if (this.micChunks.length > 0) {
        tasks.push(writeFile(join(dir, "mic.wav"), encodeWav(this.micChunks, MIC_RATE_HZ)));
      }
      if (this.speakerChunks.length > 0) {
        tasks.push(
          writeFile(join(dir, "speaker.wav"), encodeWav(this.speakerChunks, SPEAKER_RATE_HZ)),
        );
      }
      const meta: RecorderMeta = {
        deviceId: this.deps.deviceId,
        sessionId: this.deps.sessionId,
        voiceId: this.deps.voiceId,
        voiceName: this.deps.voiceName,
        startedAt: new Date(this.startedAtMs).toISOString(),
        durationMs: Date.now() - this.startedAtMs,
        transcripts: this.transcripts,
      };
      tasks.push(writeFile(join(dir, "meta.json"), JSON.stringify(meta, null, 2)));
      await Promise.all(tasks);
      log.info(
        `recordings: wrote ${this.deps.sessionId} ` +
          `(mic=${this.micChunks.length}chunks speaker=${this.speakerChunks.length}chunks)`,
      );
    } catch (err) {
      log.warn(`recordings: failed to write ${this.deps.sessionId}:`, err);
    } finally {
      this.micChunks = [];
      this.speakerChunks = [];
      this.transcripts = [];
    }
  }
}
