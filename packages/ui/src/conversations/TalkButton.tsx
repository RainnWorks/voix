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
import type { Intent } from "@voix/protocol";
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
 * `intent` is **required** (M23 Decision 3). Callers compute it from
 * the active voice's `type` — Realtime → `"discuss"`, Dictation →
 * `"dictate"` — so switching voices switches intent without a
 * separate UI axis. ConversationList (web + iOS) computes from
 * `devicesApi.list()[0].voiceId` + `voicesApi.list()`; MacOverlay
 * passes `"dictate"` because the hotkey metaphor is "speak to type."
 * Removing the default forces every caller to be explicit; a missing
 * `intent` is a TS error rather than a silent regression to discuss.
 */
export function TalkButton({
  onSessionEnded,
  intent,
}: {
  onSessionEnded?: () => void;
  intent: Intent;
}) {
  const [status, setStatus] = useState<BrowserClientStatus>("idle");
  const [error, setError] = useState<ErrorState | null>(null);
  // Terminal cue shown briefly after a session closes so "Connecting…"
  // never decays silently to idle (Wren v3 H1/F2). "done" = a real
  // exchange happened; "heard-nothing" = the session opened but closed
  // with nothing exchanged ("0-chunk close").
  const [terminal, setTerminal] = useState<"done" | "heard-nothing" | null>(null);
  const clientRef = useRef<BrowserAudioIoClient | null>(null);
  // Session bookkeeping for the terminal cue. `opened` flips once the WS
  // reaches ready/listening; `exchanged` flips once voix produces output
  // (speaking) — the proxy for "audio actually flowed." `hadError`
  // suppresses the terminal cue when the RecoveryState already explains
  // the close.
  const openedRef = useRef(false);
  const exchangedRef = useRef(false);
  const hadErrorRef = useRef(false);
  const terminalTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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
      if (terminalTimerRef.current) clearTimeout(terminalTimerRef.current);
    };
  }, []);

  const handlePressIn = async () => {
    if (clientRef.current) return;
    holdingRef.current = true;
    setError(null);
    // Reset the session bookkeeping + clear any lingering terminal cue
    // from the previous session.
    setTerminal(null);
    openedRef.current = false;
    exchangedRef.current = false;
    hadErrorRef.current = false;
    if (terminalTimerRef.current) clearTimeout(terminalTimerRef.current);
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
            // Track session lifecycle for the terminal cue.
            if (ev.status === "ready" || ev.status === "listening") {
              openedRef.current = true;
            }
            if (ev.status === "speaking") exchangedRef.current = true;
            if (ev.status === "idle" && clientRef.current) {
              clientRef.current = null;
              // Surface an explicit terminal state instead of letting the
              // button snap silently back to idle (Wren v3 H1/F2). Only
              // for sessions that actually opened, and only when no error
              // already explains the close.
              if (openedRef.current && !hadErrorRef.current) {
                setTerminal(exchangedRef.current ? "done" : "heard-nothing");
                if (terminalTimerRef.current) clearTimeout(terminalTimerRef.current);
                terminalTimerRef.current = setTimeout(() => setTerminal(null), 6000);
              }
              onSessionEnded?.();
            }
          } else if (ev.type === "error") {
            hadErrorRef.current = true;
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
  // Distinct LISTENING state — the session is open and the mic is live.
  // Drives the "I'm listening" copy + a live indicator dot so the user
  // can tell listening apart from connecting (Wren v3 H1/F2).
  const listening = status === "listening" || status === "ready";

  // M23 Decision 3 — hint + speaking label both derive from intent.
  // Picking a Dictation voice surfaces "Hold to dictate." + the
  // "transcribing…" mid-session state; picking a Realtime voice gets
  // the discuss-flavoured copy.
  const hintCopy =
    intent === "dictate" ? "Hold to dictate." : "Hold to talk to voix.";

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
        accessibilityRole="button"
        accessibilityLabel={
          intent === "dictate" ? "Hold to dictate" : "Hold to talk to voix"
        }
        accessibilityHint={hintCopy}
        accessibilityState={{ busy: active }}
      >
        <Text style={styles.glyph}>🎙</Text>
        {/* Mic-live indicator — a filled voix-blue dot while listening so
            "I'm listening" is unmistakable from "Connecting…". */}
        {listening && <View style={styles.liveDot} />}
        <Text style={[styles.label, active && styles.labelActive, speaking && styles.labelSpeaking]}>
          {labelFor(status, intent)}
        </Text>
      </Pressable>
      <Text style={styles.hint} accessibilityLiveRegion="polite">
        {hintCopy}
      </Text>
      {/* Explicit terminal cue so the button never decays silently from
          "Connecting…" back to idle (Wren v3 H1/F2). */}
      {terminal && !error && (
        <Text
          style={[styles.terminal, terminal === "heard-nothing" && styles.terminalAttn]}
          accessibilityLiveRegion="polite"
        >
          {terminal === "heard-nothing"
            ? "Heard nothing — hold and speak again"
            : "Done"}
        </Text>
      )}
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
    <View
      style={styles.recovery}
      accessibilityRole="alert"
      accessibilityLiveRegion="assertive"
    >
      <Text style={styles.recoveryTitle} accessibilityRole="header">
        {copy.title}
      </Text>
      <Text style={styles.recoveryBody}>{copy.body}</Text>
      {copy.showRetry && (
        <Pressable
          onPress={onRetry}
          style={({ pressed }) => [
            styles.retryButton,
            pressed && styles.retryButtonPressed,
          ]}
          accessibilityRole="button"
          accessibilityLabel={copy.retryLabel}
          accessibilityHint="Retry the voix session."
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

function labelFor(status: BrowserClientStatus, intent: Intent): string {
  switch (status) {
    case "idle":
      return intent === "dictate" ? "Hold to dictate" : "Talk to voix";
    case "connecting":
      return "Connecting…";
    // Fold "ready" into "listening" — once the WS is ready the mic is
    // already pumping, so there's no separate "go ahead" state worth
    // announcing (Wren audit).
    case "ready":
    case "listening":
      return "I'm listening";
    case "speaking":
      // M23: dictation doesn't have an assistant audio reply — the
      // "speaking" status fires when the daemon is producing the
      // transcript. Surface as "transcribing…" so the user isn't
      // told voix is "replying" when they pressed for dictation.
      return intent === "dictate" ? "Transcribing…" : "voix is replying";
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
  // Mic-live indicator dot — voix blue (a sanctioned voix moment: the
  // listening state). Sits between the glyph and the "I'm listening"
  // label while the session is open.
  liveDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.haBlue,
  },
  label: {
    fontFamily: fontFamily.ui,
    fontSize: 13,
    fontWeight: "600",
    color: colors.ink,
  },
  labelActive: { color: colors.haBlueText },
  labelSpeaking: { color: colors.bgElevated },
  hint: {
    fontFamily: fontFamily.ui,
    fontSize: 11,
    color: colors.textMuted,
  },
  // Terminal cue after a session closes. "Done" reads quiet (a normal
  // end); "heard-nothing" reads a touch louder (an actionable nudge to
  // try again) but stays a text cue, not an error pill.
  terminal: {
    fontFamily: fontFamily.ui,
    fontSize: 12,
    fontWeight: "500",
    color: colors.textBody,
  },
  terminalAttn: {
    color: colors.ink,
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
    // "Try again" is a chrome recovery action, not a voix moment —
    // system accent, not HA blue (Marina v3 #3).
    backgroundColor: colors.sysAccentBg,
    borderColor: colors.sysAccent,
    borderWidth: 0.5,
  },
  retryButtonPressed: { opacity: 0.85 },
  retryLabel: {
    fontFamily: fontFamily.ui,
    fontSize: 12,
    fontWeight: "600",
    color: colors.sysAccent,
  },
});
