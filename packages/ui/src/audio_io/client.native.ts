/**
 * Audio I/O client — native stub.
 *
 * Platform companion for `client.ts`. Metro picks this file on iOS +
 * macOS targets; Vite's `ignoreNativeSuffixes` plugin filters it out
 * of the web build. Re-exports the type surface verbatim so consumers
 * (TalkButton etc.) typecheck identically across targets — only the
 * runtime instance throws.
 *
 * Real native audio I/O lands in M22 when AVAudioEngine (iOS) and
 * RemoteIO (macOS) bridges go in. Until then any RN target that
 * instantiates `BrowserAudioIoClient` gets a loud, immediate failure
 * pointing at the milestone that owns the fix.
 */

// Type surface — kept type-only so RN's TS layer doesn't pull in web
// DOM types (MediaStream, AudioContext, WebSocket) through this module.

export type BrowserClientStatus =
  | "idle"
  | "connecting"
  | "ready"
  | "speaking"
  | "listening"
  | "closing";

export type BrowserClientEvent =
  | { type: "status"; status: BrowserClientStatus }
  | { type: "daemon"; event: Record<string, unknown> }
  | { type: "error"; message: string };

export type BrowserClientOpts = {
  voiceId?: string;
  intent?: "dictate" | "discuss";
  wsToken: string;
  onEvent: (ev: BrowserClientEvent) => void;
};

/**
 * Native target stub. Throws on construction so the failure surfaces
 * at the call site rather than at the first .start(). The error
 * message names the milestone that owns the bridge — M22.
 */
export class BrowserAudioIoClient {
  constructor(_opts: BrowserClientOpts) {
    throw new Error(
      "audio capture: implement in M22 (native AudioContext / getUserMedia bridge)",
    );
  }

  async start(): Promise<void> {
    throw new Error("audio capture: implement in M22");
  }

  stop(): void {
    throw new Error("audio capture: implement in M22");
  }
}
