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
import { BrowserAudioIoClient, type BrowserClientStatus } from "../audio_io/browserClient";
import { colors, fontFamily, radius, spacing } from "../lib/theme";

const WS_TOKEN_URL = "api/auth/ws-token";

export function TalkButton({ onSessionEnded }: { onSessionEnded?: () => void }) {
  const [status, setStatus] = useState<BrowserClientStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const clientRef = useRef<BrowserAudioIoClient | null>(null);

  useEffect(() => {
    return () => {
      clientRef.current?.stop();
    };
  }, []);

  const handlePressIn = async () => {
    if (clientRef.current) return;
    setError(null);
    try {
      const tokenResp = await fetch(WS_TOKEN_URL);
      if (!tokenResp.ok) throw new Error(`auth fetch ${tokenResp.status}`);
      const { token } = (await tokenResp.json()) as { token: string };
      const client = new BrowserAudioIoClient({
        wsToken: token,
        intent: "discuss",
        onEvent: (ev) => {
          if (ev.type === "status") {
            setStatus(ev.status);
            if (ev.status === "idle" && clientRef.current) {
              clientRef.current = null;
              onSessionEnded?.();
            }
          } else if (ev.type === "error") {
            setError(ev.message);
          }
        },
      });
      clientRef.current = client;
      await client.start();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handlePressOut = () => {
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
      {/* Error below the hint so a failure doesn't shove the button
          down on display (Marina audit). */}
      {error && <Text style={styles.error}>{error}</Text>}
    </View>
  );
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
  error: {
    fontFamily: fontFamily.mono,
    fontSize: 11,
    color: colors.danger,
    backgroundColor: colors.dangerBg,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.sm,
  },
});
