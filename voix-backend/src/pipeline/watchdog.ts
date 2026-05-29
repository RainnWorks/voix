/**
 * Pipeline-side session watchdog.
 *
 * Two cost guards, ticked every second:
 *   • Idle timeout — close if no speech activity within IDLE_TIMEOUT_S.
 *     "User walked away" should not bill OpenAI Realtime indefinitely.
 *   • Hard ceiling — close after SESSION_HARD_MAX_S regardless.
 *     Defensive cap against runaway sessions.
 *
 * Speech activity is updated by callers when they see a meaningful
 * speech event (user VAD start/stop, model audio delta, endpoint
 * ready_for_input). The watchdog never inspects audio itself — it
 * just counts seconds since the last `bump()`.
 */

import { log } from "../log.ts";

export type WatchdogConfig = {
  idleTimeoutS: number;
  hardMaxS: number;
  /** Tag prepended to log lines so multi-session logs stay readable. */
  label: string;
};

export class SessionWatchdog {
  private startedAt = Date.now();
  private lastActivity = Date.now();
  private speakingFlags: { user: boolean; assistant: boolean } = {
    user: false,
    assistant: false,
  };
  private timer: ReturnType<typeof setInterval> | null = null;
  private closed = false;

  constructor(
    private readonly cfg: WatchdogConfig,
    private readonly onExpire: (reason: "idle" | "hard_ceiling") => void,
  ) {}

  /** Start ticking. Idempotent — calling twice does nothing. */
  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), 1000);
  }

  /** Mark "something happened" — resets the idle counter. */
  bump(): void {
    this.lastActivity = Date.now();
  }

  /** Track who is mid-utterance. The watchdog ignores idle while
   *  either side is speaking — otherwise we'd close mid-response
   *  whenever the model went silent for two seconds between words. */
  setUserSpeaking(v: boolean): void {
    this.speakingFlags.user = v;
    if (v) this.bump();
  }
  setAssistantSpeaking(v: boolean): void {
    this.speakingFlags.assistant = v;
    if (v) this.bump();
  }

  stop(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private tick(): void {
    if (this.closed) return;
    const now = Date.now();
    const totalS = (now - this.startedAt) / 1000;
    const idleS = (now - this.lastActivity) / 1000;

    if (totalS > this.cfg.hardMaxS) {
      log.warn(`${this.cfg.label}: hard ceiling ${this.cfg.hardMaxS}s hit — closing`);
      this.stop();
      this.onExpire("hard_ceiling");
      return;
    }
    if (
      !this.speakingFlags.user &&
      !this.speakingFlags.assistant &&
      idleS > this.cfg.idleTimeoutS
    ) {
      log.info(
        `${this.cfg.label}: idle ${idleS.toFixed(1)}s > ${this.cfg.idleTimeoutS}s — closing`,
      );
      this.stop();
      this.onExpire("idle");
    }
  }
}
