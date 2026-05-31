/**
 * Press-to-talk button for the web client (M18).
 *
 * Hold-to-talk model on first cut: pointer-down opens the WS + mic,
 * pointer-up closes it. The session lands in the conversations list
 * on close (the daemon handles history append from its end).
 *
 * Visual states map to BrowserClientStatus:
 *   idle        — neutral pill, "Talk to voix"
 *   connecting  — neutral, "Connecting…"
 *   ready       — HA blue, "Speak"
 *   listening   — HA blue + pulse halo, "Listening"
 *   speaking    — HA blue + assistant halo, "voix is speaking"
 *   closing     — neutral, "Wrapping up…"
 */

import { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import {
  BrowserAudioIoClient,
  type BrowserClientErrorKind,
  type BrowserClientStatus,
} from "../audio_io/client";
import { appInfo } from "../platform";
import { colors, fontFamily, radius, spacing } from "../lib/theme";

const WS_TOKEN_PATH = "api/auth/ws-token";

type ErrorState = {
  kind: BrowserClientErrorKind;
  message: string;
  detail?: string;
};

/**
 * TalkButton props.
 *
 * `intent` (default `"discuss"`) per M22 Decision 10. The in-app
 * big-button stays on "discuss" (preserves web + iOS behaviour); the
 * macOS hotkey overlay (MacOverlay.tsx) passes `"dictate"` because the
 * hotkey gesture's natural metaphor is "speak to type."
 */
export function TalkButton({
  onSessionEnded,
  intent = "discuss",
}: {
  onSessionEnded?: () => void;
  intent?: "discuss" | "dictate";
}) {
  const [status, setStatus] = useState<BrowserClientStatus>("idle");
  const [error, setError] = useState<ErrorState | null>(null);
  const clientRef = useRef<BrowserAudioIoClient | null>(null);
  // Track the user's *intent* to be holding the button. handlePressIn is
  // async (auth fetch + AudioContext open + getUserMedia + WS connect)
  // and on a fast tap the user releases before the client exists.
  // Without this flag the sync handlePressOut sees clientRef.current ===
  // null, no-ops, and the in-flight handlePressIn finishes opening a
  // live mic + WS that nothing ever closes. We mirror "holding" in a
  // ref and check it again after the async work completes.
  const holdingRef = useRef(false);

  useEffect(() => {
    return () => {
      clientRef.current?.stop();
    };
  }, []);

  const handlePressIn = async () => {
    if (clientRef.current) return;
    holdingRef.current = true;
    setError(null);
    try {
      const base = await appInfo.getApiBase();
      const tokenResp = await fetch(base + WS_TOKEN_PATH);
      if (!tokenResp.ok) throw new Error(`auth fetch ${tokenResp.status}`);
      const { token } = (await tokenResp.json()) as { token: string };
      // The user could have released by now — if so, don't even open.
      if (!holdingRef.current) return;
      const client = new BrowserAudioIoClient({
        wsToken: token,
        intent,
        onEvent: (ev) => {
          if (ev.type === "status") {
            setStatus(ev.status);
            if (ev.status === "idle" && clientRef.current) {
              clientRef.current = null;
              onSessionEnded?.();
            }
          } else if (ev.type === "error") {
            setError({
              kind: ev.kind,
              message: ev.message,
              detail: ev.detail,
            });
          }
        },
      });
      clientRef.current = client;
      await client.start();
      // Final check: a release that arrived while client.start() was
      // resolving needs to be honoured now that the client exists.
      if (!holdingRef.current) client.stop();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError({ kind: "unknown", message: msg });
      holdingRef.current = false;
    }
  };

  // "Try again" action for the recovery state — re-runs the same start
  // path. iOS won't re-prompt for permission after a hard deny (system
  // behaviour), but it WILL pick up a Settings-toggle live, so this is
  // the right affordance for the user who just toggled the switch.
  const handleRetry = () => {
    setError(null);
    void handlePressIn();
  };

  const handlePressOut = () => {
    holdingRef.current = false;
    clientRef.current?.stop();
  };

  const active =
    status === "listening" ||
    status === "speaking" ||
    status === "ready" ||
    status === "connecting";
  const speaking = status === "speaking";

  return (
    <View style={styles.wrap}>
      <Pressable
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        style={({ pressed }) => [
          styles.button,
          active && styles.buttonActive,
          speaking && styles.buttonSpeaking,
          pressed && styles.buttonPressed,
        ]}
      >
        <Text style={styles.glyph}>🎙</Text>
        <Text style={[styles.label, active && styles.labelActive, speaking && styles.labelSpeaking]}>
          {labelFor(status)}
        </Text>
      </Pressable>
      <Text style={styles.hint}>Hold to talk to voix.</Text>
      {/* Recovery state below the hint so a failure doesn't shove the
          button down on display (Marina audit). Wren FINDING-1: tailor
          copy per error.kind instead of one undifferentiated red blob. */}
      {error && <RecoveryState error={error} onRetry={handleRetry} />}
    </View>
  );
}

/**
 * Tailored recovery copy per error kind. Soft "info" surface (not the
 * red danger pill) for permission paths — these aren't bugs, they're
 * product nudges. Network / decline / audio / unknown all get a softer
 * "something went wrong" + a developer-detail disclosure (Wren
 * FINDING-1; the "every failure looks like a console blob" gap).
 */
function RecoveryState({
  error,
  onRetry,
}: {
  error: ErrorState;
  onRetry: () => void;
}) {
  const copy = copyFor(error);
  return (
    <View style={styles.recovery}>
      <Text style={styles.recoveryTitle}>{copy.title}</Text>
      <Text style={styles.recoveryBody}>{copy.body}</Text>
      {copy.showRetry && (
        <Pressable
          onPress={onRetry}
          style={({ pressed }) => [
            styles.retryButton,
            pressed && styles.retryButtonPressed,
          ]}
        >
          <Text style={styles.retryLabel}>{copy.retryLabel}</Text>
        </Pressable>
      )}
      {copy.showDetail && error.detail && (
        <Text style={styles.recoveryDetail}>{error.detail}</Text>
      )}
    </View>
  );
}

function copyFor(error: ErrorState): {
  title: string;
  body: string;
  retryLabel: string;
  showRetry: boolean;
  showDetail: boolean;
} {
  switch (error.kind) {
    case "permission-denied":
      // Decision 13 risk 2 spec: actionable recovery, not a stack trace.
      return {
        title: "Microphone access denied",
        body: "Open Settings → voix → Microphone, turn it on, then try again.",
        retryLabel: "Try again",
        showRetry: true,
        showDetail: false,
      };
    case "permission-undetermined":
      // iOS pre-prompt — the user hasn't been shown the system dialog
      // yet, or they dismissed it without choosing. A tap re-prompts.
      return {
        title: "Microphone access needed",
        body: "Tap the button to allow voix to hear you.",
        retryLabel: "Try again",
        showRetry: true,
        showDetail: false,
      };
    case "permission-unknown":
      return {
        title: "Microphone access blocked",
        body: "Check your device's microphone settings, then try again.",
        retryLabel: "Try again",
        showRetry: true,
        showDetail: true,
      };
    case "decline":
      // Daemon-side rejection (auth, voice not found, etc.). The
      // detail string carries the daemon's reason — surface it.
      return {
        title: "voix couldn't start this session",
        body: "voix declined the request. Check your voice and try again.",
        retryLabel: "Try again",
        showRetry: true,
        showDetail: true,
      };
    case "network":
      return {
        title: "voix is unreachable",
        body: "Couldn't connect to voix. Check your network and try again.",
        retryLabel: "Try again",
        showRetry: true,
        showDetail: false,
      };
    case "audio":
    case "unknown":
    default:
      return {
        title: "Something went wrong",
        body: "voix couldn't open the microphone. Try again — if it keeps happening, restart the app.",
        retryLabel: "Try again",
        showRetry: true,
        showDetail: true,
      };
  }
}

function labelFor(status: BrowserClientStatus): string {
  switch (status) {
    case "idle":
      return "Talk to voix";
    case "connecting":
      return "Connecting…";
    // Fold "ready" into "listening" — once the WS is ready the mic is
    // already pumping, so there's no separate "go ahead" state worth
    // announcing (Wren audit).
    case "ready":
    case "listening":
      return "Listening";
    case "speaking":
      return "voix is replying";
    case "closing":
      return "Wrapping up…";
  }
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: "center",
    gap: spacing.sm,
    padding: spacing.lg,
  },
  button: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderRadius: 999,
    backgroundColor: colors.bgElevated,
    borderWidth: 0.5,
    borderColor: colors.rule,
  },
  buttonActive: {
    backgroundColor: colors.haBlueBg,
    borderColor: colors.haBlue,
  },
  // Speaking inverts: the surface becomes the voix-blue fill so the
  // user can tell at a glance that the floor is taken (Marina audit
  // flagged listening + speaking looking identical).
  buttonSpeaking: {
    backgroundColor: colors.haBlue,
    borderColor: colors.haBlue,
  },
  buttonPressed: { opacity: 0.85 },
  glyph: {
    fontSize: 14,
  },
  label: {
    fontFamily: fontFamily.ui,
    fontSize: 13,
    fontWeight: "600",
    color: colors.ink,
  },
  labelActive: { color: colors.haBlue },
  labelSpeaking: { color: colors.bgElevated },
  hint: {
    fontFamily: fontFamily.ui,
    fontSize: 11,
    color: colors.textMuted,
  },
  // Recovery state — soft info surface, not the red danger pill. Mirrors
  // the ConversationList errorBox treatment (Wren FINDING-1).
  recovery: {
    marginTop: spacing.md,
    padding: spacing.md,
    backgroundColor: colors.bgSubtle,
    borderColor: colors.rule,
    borderWidth: 1,
    borderRadius: radius.md,
    gap: spacing.xs,
    maxWidth: 360,
  },
  recoveryTitle: {
    fontFamily: fontFamily.ui,
    fontSize: 13,
    fontWeight: "600",
    color: colors.ink,
  },
  recoveryBody: {
    fontFamily: fontFamily.ui,
    fontSize: 12,
    lineHeight: 17,
    color: colors.textBody,
  },
  recoveryDetail: {
    fontFamily: fontFamily.mono,
    fontSize: 10,
    color: colors.textMuted,
    marginTop: spacing.xs,
  },
  retryButton: {
    alignSelf: "flex-start",
    marginTop: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radius.sm,
    backgroundColor: colors.haBlueBg,
    borderColor: colors.haBlue,
    borderWidth: 0.5,
  },
  retryButtonPressed: { opacity: 0.85 },
  retryLabel: {
    fontFamily: fontFamily.ui,
    fontSize: 12,
    fontWeight: "600",
    color: colors.haBlue,
  },
});
