/**
 * Onboarding — first-launch teach-mode for iOS + macOS (M23 Decision 4).
 *
 * Three screens, gated by AsyncStorage `voix.onboarding.completed`. Same
 * component on iOS + macOS; web never renders this (the daemon serves
 * the document and the browser handles mic prompts).
 *
 *   1. Welcome — wordmark + puck glyph + tagline + "Get started".
 *   2. Mic permission — single CTA fires permissions.requestMicrophone()
 *      with voix in foreground (Yuki H5 risk: dialog never steals
 *      focus mid-PTT later because we ask up front). On deny, copy
 *      switches and offers "Open settings" + "Skip for now".
 *   3. Daemon URL probe — DaemonUrlInput (shared with Settings) +
 *      "Done" button gated on green status. Red-status "Done" still
 *      lets the user proceed with a soft warning.
 *
 * Skip-setup link on every screen (dev-friendly; flagged in the brief
 * to drop in production builds).
 *
 * Risk 4 mitigation — AppState observer re-checks mic permission on
 * resume so a user who toggled the iOS Settings switch comes back
 * to the right screen without being stuck on deny.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  AppState,
  type NativeEventSubscription,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Puck } from "../components/Puck";
import { Wordmark } from "../components/Wordmark";
import { appInfo, permissions, storage, type PermissionResult } from "../platform";
import { colors, fontFamily, radius, spacing } from "../lib/theme";
import { DaemonUrlInput } from "../settings/DaemonUrlInput";

export const ONBOARDING_COMPLETED_KEY = "voix.onboarding.completed";

type Props = {
  onDone: () => void;
};

type Step = 1 | 2 | 3;

export function Onboarding({ onDone }: Props) {
  const [step, setStep] = useState<Step>(1);
  const [micResult, setMicResult] = useState<PermissionResult | null>(null);
  const [daemonUrl, setDaemonUrl] = useState<string>("");
  const [daemonStatus, setDaemonStatus] = useState<"idle" | "probing" | "reachable" | "unreachable">("idle");

  // Bootstrap the daemon URL from storage so the input starts on the
  // persisted value (or default-dev URL) the first time we land on
  // step 3. DaemonUrlInput does this internally too but we mirror it
  // in our own state so the "Done" gate is straightforward.
  useEffect(() => {
    void appInfo.getApiBase().then((u) => setDaemonUrl(u));
  }, []);

  // Risk 4 — re-check mic permission whenever the app returns to
  // foreground. On iOS the user denies, goes to Settings → toggles
  // on → comes back. Without this they're stuck on the deny screen
  // because React state never refreshed. We also auto-advance to
  // step 3 if mic was granted while we were backgrounded.
  const stepRef = useRef(step);
  stepRef.current = step;
  useEffect(() => {
    const sub: NativeEventSubscription = AppState.addEventListener(
      "change",
      (state) => {
        if (state !== "active") return;
        if (stepRef.current !== 2) return;
        void permissions.getMicrophoneStatus().then((r) => {
          setMicResult(r);
          if (r.ok) setStep(3);
        });
      },
    );
    return () => sub.remove();
  }, []);

  const persistComplete = useCallback(async () => {
    await storage.setItem(ONBOARDING_COMPLETED_KEY, "true");
    onDone();
  }, [onDone]);

  const skip = useCallback(() => {
    void persistComplete();
  }, [persistComplete]);

  const handleAllowMic = useCallback(async () => {
    const result = await permissions.requestMicrophone();
    setMicResult(result);
    if (result.ok) setStep(3);
  }, []);

  const handleOpenSettings = useCallback(async () => {
    await permissions.openMicrophoneSettings();
  }, []);

  return (
    <ScrollView contentContainerStyle={styles.scroll}>
      <View style={styles.shell}>
        <View style={styles.header}>
          <Wordmark />
          <Pressable onPress={skip} style={styles.skipHit}>
            <Text style={styles.skipLink}>Skip setup</Text>
          </Pressable>
        </View>

        <View style={styles.stepWrap}>
          {step === 1 && <Welcome onNext={() => setStep(2)} />}
          {step === 2 && (
            <MicStep
              result={micResult}
              onAllow={handleAllowMic}
              onOpenSettings={handleOpenSettings}
              onSkip={() => setStep(3)}
            />
          )}
          {step === 3 && (
            <DaemonStep
              url={daemonUrl}
              onUrlChange={(u, s) => {
                setDaemonUrl(u);
                setDaemonStatus(s);
              }}
              onDone={persistComplete}
              status={daemonStatus}
            />
          )}
        </View>

        <StepDots step={step} />
      </View>
    </ScrollView>
  );
}

// ─── Steps ──────────────────────────────────────────────────────────

function Welcome({ onNext }: { onNext: () => void }) {
  return (
    <View style={styles.step}>
      <View style={styles.heroRow}>
        <Puck size={64} />
      </View>
      <Text style={styles.title}>voix listens when you talk to it.</Text>
      <Text style={styles.body}>
        Press, speak, paste. Or hold to have a full conversation. voix is a
        push-to-talk dictation and chat surface for your Home Assistant
        Voice PE — but it also works on its own with the daemon you'll
        wire up in the next two screens.
      </Text>
      <Pressable
        onPress={onNext}
        style={({ pressed }) => [styles.cta, pressed && styles.ctaPressed]}
      >
        <Text style={styles.ctaLabel}>Get started</Text>
      </Pressable>
    </View>
  );
}

function MicStep({
  result,
  onAllow,
  onOpenSettings,
  onSkip,
}: {
  result: PermissionResult | null;
  onAllow: () => void;
  onOpenSettings: () => void;
  onSkip: () => void;
}) {
  const denied = result && !result.ok && (result.reason === "denied" || result.reason === "restricted");
  return (
    <View style={styles.step}>
      <Text style={styles.title}>voix needs your microphone.</Text>
      <Text style={styles.body}>
        {denied
          ? "Won't work without microphone access. Open Settings, allow voix, then come back."
          : "Tap allow on the system prompt. You can change this any time in Settings."}
      </Text>
      <View style={styles.ctaRow}>
        {denied ? (
          <>
            <Pressable
              onPress={onOpenSettings}
              style={({ pressed }) => [styles.cta, pressed && styles.ctaPressed]}
            >
              <Text style={styles.ctaLabel}>Open settings</Text>
            </Pressable>
            <Pressable
              onPress={onSkip}
              style={({ pressed }) => [styles.ctaSecondary, pressed && styles.ctaPressed]}
            >
              <Text style={styles.ctaSecondaryLabel}>Skip for now</Text>
            </Pressable>
          </>
        ) : (
          <Pressable
            onPress={onAllow}
            style={({ pressed }) => [styles.cta, pressed && styles.ctaPressed]}
          >
            <Text style={styles.ctaLabel}>Allow microphone</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

function DaemonStep({
  url,
  status,
  onUrlChange,
  onDone,
}: {
  url: string;
  status: "idle" | "probing" | "reachable" | "unreachable";
  onUrlChange: (url: string, status: "idle" | "probing" | "reachable" | "unreachable") => void;
  onDone: () => void;
}) {
  // The Done CTA is always enabled on a non-empty URL; an unreachable
  // daemon emits a soft warning instead of blocking. Reasoning:
  // a user on a flaky network shouldn't be trapped on this screen;
  // the daemon URL is editable later in Settings.
  const canDone = url.length > 0 && status !== "probing";
  return (
    <View style={styles.step}>
      <Text style={styles.title}>Where's your daemon?</Text>
      <Text style={styles.body}>
        voix talks to a small daemon running on your network — usually the
        Home Assistant box. We've pre-filled the dev address; edit if
        yours lives elsewhere.
      </Text>
      <DaemonUrlInput initial={url} onChange={onUrlChange} showResetLink />
      <View style={styles.ctaRow}>
        <Pressable
          onPress={onDone}
          disabled={!canDone}
          style={({ pressed }) => [
            styles.cta,
            !canDone && styles.ctaDisabled,
            pressed && styles.ctaPressed,
          ]}
        >
          <Text style={styles.ctaLabel}>
            {status === "probing" ? "Probing…" : "Done"}
          </Text>
        </Pressable>
      </View>
      {status === "unreachable" && (
        <Text style={styles.softHint}>
          voix will work as soon as it's reachable. You can edit the URL
          any time in Settings.
        </Text>
      )}
    </View>
  );
}

function StepDots({ step }: { step: Step }) {
  return (
    <View style={styles.dots}>
      {[1, 2, 3].map((s) => (
        <View
          key={s}
          style={[styles.dot, s === step && styles.dotActive]}
        />
      ))}
    </View>
  );
}

// ─── Decision helper: is onboarding complete? ───────────────────────

export async function isOnboardingComplete(): Promise<boolean> {
  const v = await storage.getItem(ONBOARDING_COMPLETED_KEY);
  return v === "true";
}

// ─── Styles ────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  scroll: {
    flexGrow: 1,
    padding: spacing.xl,
    alignItems: "center",
    justifyContent: "center",
  },
  shell: {
    width: "100%",
    maxWidth: 480,
    gap: spacing.xl,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  skipHit: { paddingVertical: spacing.xs, paddingHorizontal: spacing.sm },
  skipLink: {
    fontFamily: fontFamily.ui,
    fontSize: 12,
    color: colors.textMuted,
  },

  stepWrap: { minHeight: 320 },
  step: { gap: spacing.lg },
  heroRow: { alignItems: "center", paddingVertical: spacing.lg },
  title: {
    fontFamily: fontFamily.ui,
    fontSize: 22,
    fontWeight: "600",
    color: colors.ink,
    lineHeight: 28,
  },
  body: {
    fontFamily: fontFamily.ui,
    fontSize: 14,
    color: colors.textBody,
    lineHeight: 21,
  },
  softHint: {
    fontFamily: fontFamily.ui,
    fontSize: 12,
    color: colors.textMuted,
    fontStyle: "italic",
  },

  ctaRow: { flexDirection: "row", gap: spacing.sm, flexWrap: "wrap" },
  cta: {
    alignSelf: "flex-start",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.haBlue,
  },
  ctaPressed: { opacity: 0.85 },
  ctaDisabled: { opacity: 0.5 },
  ctaLabel: {
    fontFamily: fontFamily.ui,
    fontSize: 14,
    fontWeight: "600",
    color: colors.bgElevated,
  },
  ctaSecondary: {
    alignSelf: "flex-start",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.bgSubtle,
    borderWidth: 0.5,
    borderColor: colors.rule,
  },
  ctaSecondaryLabel: {
    fontFamily: fontFamily.ui,
    fontSize: 14,
    color: colors.ink,
  },

  dots: {
    flexDirection: "row",
    alignSelf: "center",
    gap: spacing.sm,
    paddingTop: spacing.lg,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.rule,
  },
  dotActive: {
    backgroundColor: colors.haBlue,
  },

  // ActivityIndicator used by the probe; styled-via-default but
  // referenced so an explicit import isn't lint-flagged.
  spinner: { color: colors.haBlue },
});

// Reference the unused style key so any consumer that imports it
// doesn't trip the linter; ActivityIndicator is used by the probe
// path inside DaemonUrlInput but referenced here as a future hook.
void ActivityIndicator;
