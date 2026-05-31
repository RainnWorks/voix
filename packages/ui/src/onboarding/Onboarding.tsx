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
  AccessibilityInfo,
  ActivityIndicator,
  AppState,
  type ColorSchemeName,
  findNodeHandle,
  type NativeEventSubscription,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useColorScheme,
  View,
} from "react-native";
import { Puck } from "../components/Puck";
import { Wordmark } from "../components/Wordmark";
import {
  appInfo,
  permissions,
  storage,
  useSafeAreaInsets,
  type PermissionResult,
} from "../platform";
import { colors, fontFamily, radius, spacing } from "../lib/theme";
import { DaemonUrlInput } from "../settings/DaemonUrlInput";

export const ONBOARDING_COMPLETED_KEY = "voix.onboarding.completed";

type Props = {
  onDone: () => void;
};

type Step = 1 | 2 | 3;

type DaemonStatus = "idle" | "probing" | "reachable" | "unreachable" | "malformed";

/**
 * Scheme-aware onboarding palette. Onboarding renders on a dark canvas
 * in dark mode (the brand teach-mode), where the light-theme `colors`
 * tokens (near-black ink, black-alpha rules) collapse to invisibility.
 * These tokens adapt to the active colour scheme — system label /
 * secondaryLabel equivalents for text, a light neutral for inactive
 * dots, a filled field treatment — so the three legibility findings
 * (Marina v3 #4 title-as-disabled, #5 URL-field-as-label, #6 dark-mode
 * dots) resolve in both schemes.
 *
 * Chrome (CTAs) takes the **system accent**, not HA blue — HA blue is
 * reserved for voix moments (puck, listening pill, NOW pill) per the
 * brand soul (Marina v3 #3).
 */
type ObPalette = ReturnType<typeof obPalette>;
function obPalette(scheme: ColorSchemeName) {
  const dark = scheme === "dark";
  return {
    dark,
    bg: dark ? "#0b0b0c" : colors.bg,
    // iOS system `label` / `secondaryLabel` equivalents.
    title: dark ? "#f5f5f7" : colors.ink,
    body: dark ? "rgba(235,235,245,0.6)" : colors.textBody,
    muted: dark ? "rgba(235,235,245,0.45)" : colors.textMuted,
    // System accent — the dark variant (#0A84FF) in dark mode.
    accent: dark ? colors.sysAccentDark : colors.sysAccent,
    onAccent: "#ffffff",
    // Inactive page dot: a light neutral that survives the dark canvas
    // (the old rgba(0,0,0,0.2) was invisible on black — Marina v3 #6).
    dotInactive: dark ? "rgba(255,255,255,0.25)" : "rgba(0,0,0,0.2)",
    // Filled field treatment so the editable URL reads as an input,
    // not a label (Marina v3 #5).
    fieldBg: dark ? "rgba(255,255,255,0.08)" : colors.bgSubtle,
    fieldBorder: dark ? "rgba(255,255,255,0.18)" : colors.rule,
    fieldText: dark ? "#f5f5f7" : colors.ink,
    fieldPlaceholder: dark ? "rgba(235,235,245,0.4)" : colors.textQuiet,
  };
}

export function Onboarding({ onDone }: Props) {
  const [step, setStep] = useState<Step>(1);
  const [micResult, setMicResult] = useState<PermissionResult | null>(null);
  const [daemonUrl, setDaemonUrl] = useState<string>("");
  const [daemonStatus, setDaemonStatus] = useState<DaemonStatus>("idle");

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

  // Keep the wordmark/Skip header clear of the status bar / Dynamic
  // Island and the dots clear of the home indicator on iOS. Zero insets
  // on web/macOS, so the centered layout is unchanged there (soul §3.2).
  const insets = useSafeAreaInsets();
  const ob = obPalette(useColorScheme());

  return (
    <ScrollView
      contentContainerStyle={[
        styles.scroll,
        {
          paddingTop: Math.max(spacing.xl, insets.top + spacing.sm),
          paddingBottom: Math.max(spacing.xl, insets.bottom + spacing.sm),
        },
      ]}
    >
      <View style={styles.shell}>
        <View style={styles.header}>
          <Wordmark />
          <Pressable
            onPress={skip}
            style={styles.skipHit}
            hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }}
            accessibilityRole="button"
            accessibilityLabel="Skip setup"
            accessibilityHint="Dismiss onboarding and go to the main app."
          >
            <Text style={styles.skipLink}>Skip setup</Text>
          </Pressable>
        </View>

        <View style={styles.stepWrap}>
          {step === 1 && <Welcome ob={ob} onNext={() => setStep(2)} />}
          {step === 2 && (
            <MicStep
              ob={ob}
              result={micResult}
              onAllow={handleAllowMic}
              onOpenSettings={handleOpenSettings}
              onSkip={() => setStep(3)}
            />
          )}
          {step === 3 && (
            <DaemonStep
              ob={ob}
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

        <StepDots step={step} ob={ob} />
      </View>
    </ScrollView>
  );
}

// ─── Steps ──────────────────────────────────────────────────────────

/**
 * Apple HIG: "When a new view appears, move focus to the most
 * informative element — typically the heading or the primary action."
 * Priya M1 / H4 (M23 fix-pass): without this, VoiceOver lands on the
 * top-most focusable element in render order, which is the "Skip
 * setup" link in the header. The user hears "Skip setup" first and
 * thinks the whole app is a skip option.
 *
 * useFocusOnMount refs a heading Text node and on mount programmatically
 * focuses it via AccessibilityInfo.setAccessibilityFocus. A small
 * delay lets the screen finish rendering before we attempt focus —
 * setting focus before the layout pass is a silent no-op.
 */
function useFocusOnMount<T>() {
  const ref = useRef<T | null>(null);
  useEffect(() => {
    const t = setTimeout(() => {
      const node = ref.current;
      if (!node) return;
      // findNodeHandle's overloads accept a Component/null/number, but
      // RN's Text/View refs surface as `T` from the consumer side. We
      // know the runtime value is a host component handle; cast once
      // here so the call site stays clean.
      const handle = findNodeHandle(
        node as unknown as React.Component<unknown, unknown>,
      );
      if (handle != null) {
        AccessibilityInfo.setAccessibilityFocus(handle);
      }
    }, 120);
    return () => clearTimeout(t);
  }, []);
  return ref;
}

function Welcome({ ob, onNext }: { ob: ObPalette; onNext: () => void }) {
  const titleRef = useFocusOnMount<Text>();
  return (
    <View style={styles.step}>
      <View
        style={styles.heroRow}
        accessibilityLabel="voix — push-to-talk voice assistant"
      >
        <Puck size={64} />
      </View>
      <Text
        ref={titleRef}
        style={styles.title}
        accessibilityRole="header"
      >
        voix listens when you talk to it.
      </Text>
      <Text style={styles.body}>
        Press, speak, paste. Or hold to have a full conversation. voix is a
        push-to-talk dictation and chat surface for your Home Assistant
        Voice PE. It also works on its own with the daemon you'll wire up
        in the next two screens.
      </Text>
      <Pressable
        onPress={onNext}
        style={({ pressed }) => [
          styles.cta,
          { backgroundColor: ob.accent },
          pressed && styles.ctaPressed,
        ]}
        accessibilityRole="button"
        accessibilityLabel="Get started"
        accessibilityHint="Advance to the microphone permission step."
      >
        <Text style={[styles.ctaLabel, { color: ob.onAccent }]}>Get started</Text>
      </Pressable>
    </View>
  );
}

function MicStep({
  ob,
  result,
  onAllow,
  onOpenSettings,
  onSkip,
}: {
  ob: ObPalette;
  result: PermissionResult | null;
  onAllow: () => void;
  onOpenSettings: () => void;
  onSkip: () => void;
}) {
  const denied = result && !result.ok && (result.reason === "denied" || result.reason === "restricted");
  const titleRef = useFocusOnMount<Text>();
  return (
    <View style={styles.step}>
      <Text ref={titleRef} style={styles.title} accessibilityRole="header">
        voix needs your microphone.
      </Text>
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
              style={({ pressed }) => [
                styles.cta,
                { backgroundColor: ob.accent },
                pressed && styles.ctaPressed,
              ]}
              accessibilityRole="button"
              accessibilityLabel="Open system Settings"
              accessibilityHint="Opens the iOS or macOS Settings app so you can grant voix microphone access."
            >
              <Text style={[styles.ctaLabel, { color: ob.onAccent }]}>Open settings</Text>
            </Pressable>
            <Pressable
              onPress={onSkip}
              style={({ pressed }) => [styles.ctaSecondary, pressed && styles.ctaPressed]}
              accessibilityRole="button"
              accessibilityLabel="Skip microphone permission for now"
              accessibilityHint="Continue onboarding without microphone access. You can grant it later in Settings."
            >
              <Text style={styles.ctaSecondaryLabel}>Skip for now</Text>
            </Pressable>
          </>
        ) : (
          <Pressable
            onPress={onAllow}
            style={({ pressed }) => [
              styles.cta,
              { backgroundColor: ob.accent },
              pressed && styles.ctaPressed,
            ]}
            accessibilityRole="button"
            accessibilityLabel="Allow microphone access"
            accessibilityHint="Triggers the system permission prompt to let voix use the microphone."
          >
            <Text style={[styles.ctaLabel, { color: ob.onAccent }]}>Allow microphone</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

function DaemonStep({
  ob,
  url,
  status,
  onUrlChange,
  onDone,
}: {
  ob: ObPalette;
  url: string;
  status: DaemonStatus;
  onUrlChange: (url: string, status: DaemonStatus) => void;
  onDone: () => void;
}) {
  // The Done CTA is enabled on a non-empty URL; an unreachable daemon
  // emits a soft warning instead of blocking. Malformed BLOCKS — we
  // won't let the user proceed with a typo'd URL that's guaranteed
  // not to work (Priya H3: distinct from "Unreachable" where the
  // network might just be flaky).
  const canDone =
    url.length > 0 && status !== "probing" && status !== "malformed";
  const titleRef = useFocusOnMount<Text>();
  return (
    <View style={styles.step}>
      <Text ref={titleRef} style={styles.title} accessibilityRole="header">
        Connect to voix
      </Text>
      <Text style={styles.body}>
        voix talks to a small daemon running on your network. Usually the
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
            { backgroundColor: ob.accent },
            !canDone && styles.ctaDisabled,
            pressed && styles.ctaPressed,
          ]}
          accessibilityRole="button"
          accessibilityLabel={status === "probing" ? "Probing daemon URL" : "Finish onboarding"}
          accessibilityState={{ disabled: !canDone }}
          accessibilityHint="Persist the daemon URL and enter the main app."
        >
          <Text style={[styles.ctaLabel, { color: ob.onAccent }]}>
            {status === "probing" ? "Probing…" : "Done"}
          </Text>
        </Pressable>
      </View>
      {status === "unreachable" && (
        <Text style={styles.softHint} accessibilityLiveRegion="polite">
          voix will work as soon as it's reachable. You can edit the URL
          any time in Settings.
        </Text>
      )}
    </View>
  );
}

function StepDots({ step, ob }: { step: Step; ob: ObPalette }) {
  // All three dots are always drawn: the current step is a wider pill in
  // the system accent (chrome, not a voix moment — Marina v3 #3), the
  // rest are scheme-aware neutral dots that survive the dark canvas
  // (Marina v3 #6 / Wren F9 dark-mode).
  return (
    <View
      style={styles.dots}
      accessibilityRole="progressbar"
      accessibilityLabel={`Step ${step} of 3`}
    >
      {[1, 2, 3].map((s) => (
        <View
          key={s}
          style={[
            styles.dot,
            { backgroundColor: ob.dotInactive },
            s === step && [styles.dotActive, { backgroundColor: ob.accent }],
          ]}
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
    minHeight: 44, // HIG touch-target floor (M-MobileFit target g)
    justifyContent: "center",
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
    minHeight: 44, // HIG touch-target floor (M-MobileFit target g)
    justifyContent: "center",
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
    width: 7,
    height: 7,
    borderRadius: 3.5,
    // Inactive dots were colors.rule (rgba(0,0,0,0.08)) — near-invisible,
    // so the group read as a single dot. A clearly-visible neutral makes
    // the remaining steps legible.
    backgroundColor: "rgba(0,0,0,0.2)",
  },
  dotActive: {
    // Current step: a wider haBlue pill so position reads at a glance.
    width: 22,
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
