/**
 * Minimal level-gated logger. Bun's `console` already does what we need;
 * this just adds level filtering + a stable prefix so log lines are
 * grep-friendly (`voix-backend: …`).
 *
 * Levels — trace < debug < info < warn < error. Anything below the
 * configured level is dropped at the call site.
 *
 * Deliberately no framework dep. Adding pino/winston now would obscure
 * what's happening in a service that's mostly WS plumbing. We can swap
 * the impl behind this surface later if we need structured output.
 */

import { config } from "./env.ts";

const LEVELS = { trace: 0, debug: 1, info: 2, warn: 3, error: 4 } as const;
type Level = keyof typeof LEVELS;

const threshold = LEVELS[config.logLevel] ?? LEVELS.info;

function emit(level: Level, ...args: unknown[]): void {
  if (LEVELS[level] < threshold) return;
  const ts = new Date().toISOString().slice(11, 23); // HH:MM:SS.sss
  const fn = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
  fn(`${ts} ${level.toUpperCase().padEnd(5)} voix-backend:`, ...args);
}

export const log = {
  trace: (...args: unknown[]): void => emit("trace", ...args),
  debug: (...args: unknown[]): void => emit("debug", ...args),
  info: (...args: unknown[]): void => emit("info", ...args),
  warn: (...args: unknown[]): void => emit("warn", ...args),
  error: (...args: unknown[]): void => emit("error", ...args),
};
