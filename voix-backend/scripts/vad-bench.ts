#!/usr/bin/env bun
/**
 * VAD tuning bench (M09 deliverable).
 *
 * Reads a mono PCM16 WAV (typically a `mic.wav` from
 * `voix-backend/<dataRoot>/voix/recordings/<sessionId>/`) and replays
 * it frame-by-frame through the energy VAD, logging every state
 * transition with its timing and the RMS values that triggered it.
 *
 * Usage:
 *   bun scripts/vad-bench.ts <path/to/mic.wav> [--frame-ms=20]
 *                                              [--start-threshold=800]
 *                                              [--end-threshold=400]
 *                                              [--min-silence-ms=400]
 *                                              [--smooth-ms=50]
 *                                              [--start-frames=2]
 *                                              [--verbose]
 *
 * Output (default):
 *
 *   audio: /path/to/mic.wav 16000 Hz, 27.3 s
 *   config: startThreshold=800 endThreshold=400 minSilenceMs=400 ...
 *   transitions:
 *     [  0.420s] speech_start  rms=2148 smoothed=1612
 *     [  2.860s] speech_end    rms=  98 smoothed=  72 (silent=420ms)
 *     [  4.120s] speech_start  rms=1801 smoothed=1290
 *     [  6.770s] speech_end    rms= 145 smoothed=  99 (silent=410ms)
 *   summary:
 *     total speech: 5.09 s
 *     total silence: 22.21 s
 *     utterances: 2
 *
 * With --verbose, every frame is printed (a sea of "continue" rows
 * surrounding the rare transition rows) so you can see what the
 * smoothed RMS looks like around the decision boundary.
 *
 * **Acceptance verification recipe**: capture a session via the puck,
 * download `mic.wav` from the daemon's `/recordings/<sessionId>/`
 * route, run this bench with default config. Inspect the transition
 * log. If `speech_end` lands within 300-600 ms of the human-perceived
 * end of speech and there are zero `speech_end` events inside a
 * single utterance, the config is shipped. If not, walk the thresholds
 * + minSilenceMs and re-run; once a setting holds across ≥20
 * recordings, commit it as the new default in
 * `DEFAULT_ENERGY_VAD_CONFIG`.
 */

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { readWav } from "../src/recordings/wav_read.ts";
import {
  DEFAULT_ENERGY_VAD_CONFIG,
  type EnergyVadConfig,
  EnergyVad,
} from "../src/vad/energy.ts";

type CliArgs = {
  path: string;
  frameMs: number;
  verbose: boolean;
  config: EnergyVadConfig;
};

function parseArgs(argv: readonly string[]): CliArgs {
  let path: string | null = null;
  let frameMs = 20;
  let verbose = false;
  const overrides: Partial<EnergyVadConfig> = {};

  for (const arg of argv) {
    if (arg.startsWith("--")) {
      const [key, value] = arg.slice(2).split("=");
      switch (key) {
        case "frame-ms":
          frameMs = Number(value);
          break;
        case "start-threshold":
          overrides.startThreshold = Number(value);
          break;
        case "end-threshold":
          overrides.endThreshold = Number(value);
          break;
        case "min-silence-ms":
          overrides.minSilenceMs = Number(value);
          break;
        case "smooth-ms":
          overrides.smoothMs = Number(value);
          break;
        case "start-frames":
          overrides.startFrames = Number(value);
          break;
        case "verbose":
          verbose = true;
          break;
        case "help":
          printUsageAndExit(0);
          break;
        default:
          console.error(`unknown flag: --${key}`);
          printUsageAndExit(2);
      }
    } else if (!path) {
      path = arg;
    } else {
      console.error(`extra positional arg: ${arg}`);
      printUsageAndExit(2);
    }
  }

  if (!path) {
    console.error("missing required argument: path to WAV file");
    printUsageAndExit(2);
  }
  return {
    path: resolve(path as string),
    frameMs,
    verbose,
    config: { ...DEFAULT_ENERGY_VAD_CONFIG, ...overrides },
  };
}

function printUsageAndExit(code: number): never {
  console.error(
    [
      "Usage: bun scripts/vad-bench.ts <path/to/mic.wav> [flags]",
      "",
      "Flags:",
      "  --frame-ms=20             frame size to feed the VAD",
      "  --start-threshold=800     RMS at which a frame is loud enough to count toward speech_start",
      "  --end-threshold=400       RMS at which a frame is quiet enough to count toward speech_end",
      "  --min-silence-ms=400      continuous silence required to emit speech_end",
      "  --smooth-ms=50            EMA time constant for the smoothed RMS",
      "  --start-frames=2          consecutive frames above startThreshold required for speech_start",
      "  --verbose                 log every frame, not just transitions",
    ].join("\n"),
  );
  process.exit(code);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const wav = readWav(await readFile(args.path));
  const config: EnergyVadConfig = { ...args.config, sampleRateHz: wav.sampleRateHz };

  const totalSamples = wav.pcm.length / 2;
  const totalDurationMs = (totalSamples / wav.sampleRateHz) * 1000;
  const samplesPerFrame = Math.floor((args.frameMs / 1000) * wav.sampleRateHz);
  const bytesPerFrame = samplesPerFrame * 2;

  process.stdout.write(
    `audio: ${args.path} ${wav.sampleRateHz} Hz mono, ` +
      `${(totalDurationMs / 1000).toFixed(2)} s\n`,
  );
  process.stdout.write(
    `config: startThreshold=${config.startThreshold} endThreshold=${config.endThreshold} ` +
      `minSilenceMs=${config.minSilenceMs} smoothMs=${config.smoothMs} ` +
      `startFrames=${config.startFrames} frameMs=${args.frameMs}\n`,
  );
  process.stdout.write("transitions:\n");

  const vad = new EnergyVad(config);
  let utterances = 0;
  let speechMs = 0;
  let currentUtteranceStartMs: number | null = null;
  let lastFellBelowMs: number | null = null;

  for (let offset = 0; offset < wav.pcm.length; offset += bytesPerFrame) {
    const frame = wav.pcm.subarray(offset, Math.min(offset + bytesPerFrame, wav.pcm.length));
    if (frame.length < 2) break;
    const nowMs = (offset / 2 / wav.sampleRateHz) * 1000;
    const event = vad.push(frame, nowMs);
    const dbg = vad.debug();

    if (event.kind === "speech_start") {
      currentUtteranceStartMs = event.atMs;
      utterances++;
      process.stdout.write(
        `  [${fmtSecs(event.atMs)}] speech_start  rms=${pad(Math.round(dbg.rms), 5)} ` +
          `smoothed=${pad(Math.round(dbg.smoothed), 5)}\n`,
      );
    } else if (event.kind === "speech_end") {
      if (currentUtteranceStartMs !== null) {
        speechMs += event.atMs - currentUtteranceStartMs;
        currentUtteranceStartMs = null;
      }
      const silentForMs = lastFellBelowMs !== null ? event.atMs - lastFellBelowMs : 0;
      process.stdout.write(
        `  [${fmtSecs(event.atMs)}] speech_end    rms=${pad(Math.round(dbg.rms), 5)} ` +
          `smoothed=${pad(Math.round(dbg.smoothed), 5)} (silent=${Math.round(silentForMs)}ms)\n`,
      );
      lastFellBelowMs = null;
    } else if (args.verbose) {
      process.stdout.write(
        `  [${fmtSecs(nowMs)}] continue      rms=${pad(Math.round(dbg.rms), 5)} ` +
          `smoothed=${pad(Math.round(dbg.smoothed), 5)} ` +
          `${event.speaking ? "speaking" : "silent  "}\n`,
      );
    }

    // Stash "fell below endThreshold" time for the hangover read-out
    // in the next speech_end event.
    if (
      event.kind === "continue" &&
      event.speaking &&
      dbg.smoothed < dbg.endThreshold &&
      lastFellBelowMs === null
    ) {
      lastFellBelowMs = nowMs;
    } else if (event.kind === "continue" && event.speaking && dbg.smoothed >= dbg.endThreshold) {
      lastFellBelowMs = null;
    }
  }

  // Edge case: file ended mid-speech. Tally what we had so the
  // summary is honest.
  if (currentUtteranceStartMs !== null) {
    speechMs += totalDurationMs - currentUtteranceStartMs;
  }

  process.stdout.write("summary:\n");
  process.stdout.write(`  total speech: ${(speechMs / 1000).toFixed(2)} s\n`);
  process.stdout.write(`  total silence: ${((totalDurationMs - speechMs) / 1000).toFixed(2)} s\n`);
  process.stdout.write(`  utterances: ${utterances}\n`);
}

function fmtSecs(ms: number): string {
  const s = ms / 1000;
  return s.toFixed(3).padStart(7);
}

function pad(n: number, width: number): string {
  return String(n).padStart(width);
}

main().catch((err) => {
  console.error("vad-bench failed:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
