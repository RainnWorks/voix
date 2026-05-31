/**
 * Single-shot capture flow invoked by the voix keyboard extension.
 *
 * Route shape: keyboard opens `voix://capture?session_id=<uuid>&return=
 * voix-keyboard%3A%2F%2Fdone%3Fsession_id%3D<uuid>` and the host's
 * Linking handler mounts this screen with the parsed params. This
 * screen:
 *
 *   1. Marks the session capturing in the App Group container.
 *   2. Auto-starts a dictate-intent BrowserAudioIoClient against the
 *      daemon (same WS path TalkButton uses).
 *   3. Listens for the canonical `transcript` event from the daemon
 *      for role: "user". That text IS the polished output for a
 *      dictation session.
 *   4. Writes `status: done` + transcript back to the shared
 *      container.
 *   5. Calls VoixKeyboardBridge.returnToKeyboard(returnUrl) which
 *      asks iOS to open the voix-keyboard:// URL — iOS bounces the
 *      user back to whatever app hosted the keyboard (Notes, Mail,
 *      Safari address bar…). The keyboard's viewDidAppear reads the
 *      shared container and inserts the text.
 *
 * Failure handling:
 *   - error event from BrowserAudioIoClient → write `status: failed`
 *     + error string + still return so the keyboard can show its
 *     toast.
 *   - 30s hard cap on capture (Architect Decision 3) — if the user
 *     hasn't stopped speaking by then, force the WS shut and use
 *     whatever transcript we already collected (most recent
 *     transcript_delta as fallback).
 *
 * The screen is intentionally chrome-free: no AppShell, no nav. It
 * does one thing and dismisses itself.
 */

import { useEffect, useRef, useState } from "react";
import { NativeModules, Platform, StyleSheet, Text, View } from "react-native";
import { BrowserAudioIoClient } from "../audio_io/client";
import { appInfo } from "../platform";
import { colors, fontFamily, spacing } from "../lib/theme";

const WS_TOKEN_PATH = "api/auth/ws-token";
const CAPTURE_CAP_MS = 30_000;

type VoixKeyboardBridge = {
  writeSession: (
    sessionId: string,
    status: "capturing" | "done" | "failed" | "cancelled",
    transcript: string | null,
    error: string | null,
  ) => Promise<void>;
  readSession: (sessionId: string) => Promise<Record<string, unknown> | null>;
  returnToKeyboard: (returnUrl: string) => Promise<{ opened: boolean }>;
};

function getBridge(): VoixKeyboardBridge | null {
  if (Platform.OS !== "ios") return null;
  const mod = (NativeModules as { VoixKeyboardBridge?: VoixKeyboardBridge })
    .VoixKeyboardBridge;
  return mod ?? null;
}

type Stage = "starting" | "listening" | "wrapping" | "done" | "failed";

export function KeyboardCaptureScreen({
  sessionId,
  returnUrl,
}: {
  sessionId: string;
  returnUrl: string;
}) {
  const [stage, setStage] = useState<Stage>("starting");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const clientRef = useRef<BrowserAudioIoClient | null>(null);
  // Accumulate the latest transcript event so we can fall back on the
  // 30s timeout. transcript_delta gets overwritten as the model
  // refines; transcript (role user) is the canonical line and wins.
  const transcriptRef = useRef<string>("");
  const finalisedRef = useRef(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const bridge = getBridge();
    if (!bridge) {
      // Web or any non-iOS host won't have the bridge. Treat as a
      // protocol misconfiguration; surface but don't crash.
      setStage("failed");
      setErrorMsg("Keyboard bridge unavailable on this platform.");
      return;
    }

    let cancelled = false;

    const finalise = async (
      status: "done" | "failed" | "cancelled",
      transcript: string | null,
      err: string | null,
    ) => {
      if (finalisedRef.current) return;
      finalisedRef.current = true;
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      clientRef.current?.stop();
      try {
        await bridge.writeSession(sessionId, status, transcript, err);
      } catch (e) {
        // Worst case: shared container write failed. We still
        // return so the keyboard's 60s timeout fires rather than
        // hang the user.
      }
      try {
        await bridge.returnToKeyboard(returnUrl);
      } catch (e) {
        // The keyboard polls its own state regardless, so a return
        // open failure just means iOS may not auto-foreground the
        // previous app — user can press Home + re-select Notes.
      }
    };

    const start = async () => {
      try {
        await bridge.writeSession(sessionId, "capturing", null, null);
      } catch {
        // If we can't even mark capturing, surface the failure now —
        // the keyboard wrote pending, this confirms the writer side
        // of the App Group is broken.
        await finalise(
          "failed",
          null,
          "Couldn't access shared container.",
        );
        setStage("failed");
        setErrorMsg("Couldn't access shared container.");
        return;
      }

      try {
        const base = await appInfo.getApiBase();
        const tokenResp = await fetch(base + WS_TOKEN_PATH);
        if (!tokenResp.ok) {
          throw new Error(`auth fetch ${tokenResp.status}`);
        }
        const { token } = (await tokenResp.json()) as { token: string };
        if (cancelled) return;

        const client = new BrowserAudioIoClient({
          wsToken: token,
          intent: "dictate",
          onEvent: (ev) => {
            if (ev.type === "status") {
              if (ev.status === "listening") setStage("listening");
              if (ev.status === "closing") setStage("wrapping");
              if (ev.status === "idle" && !finalisedRef.current) {
                // The WS closed naturally (VAD end-of-speech or
                // daemon-side completion). Finalise with whatever
                // transcript we collected.
                void finalise(
                  "done",
                  transcriptRef.current || null,
                  transcriptRef.current ? null : "no_speech",
                );
                setStage("done");
              }
            } else if (ev.type === "daemon") {
              const dev = ev.event;
              if (
                dev.type === "transcript" &&
                dev.role === "user" &&
                typeof dev.text === "string"
              ) {
                transcriptRef.current = dev.text;
              } else if (
                dev.type === "transcript_delta" &&
                typeof dev.text === "string" &&
                !transcriptRef.current
              ) {
                // Hold deltas as a fallback only — the canonical
                // transcript replaces them once it lands.
                transcriptRef.current = dev.text;
              }
            } else if (ev.type === "error") {
              void finalise("failed", null, ev.message);
              setStage("failed");
              setErrorMsg(ev.message);
            }
          },
        });
        clientRef.current = client;
        await client.start();

        timeoutRef.current = setTimeout(() => {
          void finalise(
            "done",
            transcriptRef.current || null,
            transcriptRef.current ? null : "timeout",
          );
          setStage("done");
        }, CAPTURE_CAP_MS);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        void finalise("failed", null, msg);
        setStage("failed");
        setErrorMsg(msg);
      }
    };

    void start();

    return () => {
      cancelled = true;
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      clientRef.current?.stop();
      // If we never wrote a terminal status, mark cancelled — the
      // keyboard treats that as a clean cancel rather than a
      // failure.
      if (!finalisedRef.current) {
        finalisedRef.current = true;
        const bridge = getBridge();
        void bridge
          ?.writeSession(sessionId, "cancelled", null, null)
          .catch(() => {});
      }
    };
  }, [sessionId, returnUrl]);

  return (
    <View style={styles.container}>
      <Text style={styles.heading}>voix</Text>
      <View style={styles.puck}>
        <View
          style={[
            styles.puckCore,
            stage === "listening" && styles.puckCoreActive,
          ]}
        />
      </View>
      <Text style={styles.status}>{statusLabel(stage)}</Text>
      {stage === "failed" && errorMsg ? (
        <Text style={styles.errorMessage}>{errorMsg}</Text>
      ) : null}
      <Text style={styles.hint}>
        Returning to keyboard when you stop speaking. 30s max.
      </Text>
    </View>
  );
}

function statusLabel(stage: Stage): string {
  switch (stage) {
    case "starting":
      return "Connecting…";
    case "listening":
      return "Listening";
    case "wrapping":
      return "Wrapping up…";
    case "done":
      return "Sent to keyboard";
    case "failed":
      return "Couldn't record";
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: spacing.xl,
    backgroundColor: colors.bg,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.lg,
  },
  heading: {
    fontFamily: fontFamily.ui,
    fontSize: 22,
    fontWeight: "600",
    color: colors.ink,
  },
  puck: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: colors.bgElevated,
    borderWidth: 0.5,
    borderColor: colors.rule,
    alignItems: "center",
    justifyContent: "center",
  },
  puckCore: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.haBlue,
    opacity: 0.6,
  },
  puckCoreActive: {
    opacity: 1,
  },
  status: {
    fontFamily: fontFamily.ui,
    fontSize: 17,
    color: colors.ink,
  },
  errorMessage: {
    fontFamily: fontFamily.ui,
    fontSize: 12,
    color: colors.textMuted,
    textAlign: "center",
    paddingHorizontal: spacing.xl,
  },
  hint: {
    fontFamily: fontFamily.ui,
    fontSize: 11,
    color: colors.textQuiet,
    fontStyle: "italic",
  },
});
