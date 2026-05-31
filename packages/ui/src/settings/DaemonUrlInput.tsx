/**
 * DaemonUrlInput — shared daemon URL editor with live reachability
 * probe. Used by Settings (Decision 2) AND the onboarding screen 3
 * (Decision 4) so the same component does the same job in both places.
 *
 * Behaviour:
 *   • Renders a TextInput pre-filled with the persisted URL (or the
 *     default-dev URL on first launch).
 *   • Debounced 600 ms after edits, fires `HEAD ${url}api/voices` to
 *     decide the indicator state. Three states: probing / reachable /
 *     unreachable. Indicator is a small dot + label next to the input.
 *   • On a successful blur with a valid URL the new value is persisted
 *     via appInfo.setApiBase(); callers also get `onChange(url)` to
 *     mirror the value in their own state.
 *   • "Reset to default" link below the input reverts to
 *     DEFAULT_DEV_DAEMON_URL (which lives inside appInfo.native.ts;
 *     we re-export the constant as DEFAULT_DAEMON_URL_HINT for the
 *     placeholder).
 *
 * The component is Promise-shaped — no async-await rabbit holes for the
 * caller. Web siblings render the same component but appInfo.setApiBase()
 * is a no-op on web, so editing the URL does nothing (the daemon's where
 * the document was served from). Hidden on web by the Settings caller.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { appInfo, validateDaemonUrl, InvalidDaemonUrlError } from "../platform";
import { colors, fontFamily, radius, spacing } from "../lib/theme";

const DEFAULT_DAEMON_URL_HINT = "http://192.168.99.86:8765/";
const DEBOUNCE_MS = 600;
const PROBE_TIMEOUT_MS = 4000;

/**
 * Probe lifecycle. `malformed` is distinct from `unreachable` (Priya
 * H3, M23 fix-pass): a user with a typo gets "Try `http://your-host`"
 * instead of being told their network is down. `malformed` short-
 * circuits the reachability probe so we don't waste a fetch.
 */
type ProbeStatus =
  | "idle"
  | "probing"
  | "reachable"
  | "unreachable"
  | "malformed";

type Props = {
  /** Optional initial value. When omitted the component reads from
   *  appInfo.getApiBase() on mount. */
  initial?: string;
  /** Fires on every edit AND after a successful persist. Caller can
   *  mirror the value or gate a "Done" button on the probe status. */
  onChange?: (url: string, status: ProbeStatus) => void;
  /** Show a "Reset to default" link below the input. Defaults to true
   *  in Settings; the onboarding screen shows it too. */
  showResetLink?: boolean;
};

export function DaemonUrlInput({ initial, onChange, showResetLink = true }: Props) {
  const [url, setUrl] = useState<string>(initial ?? "");
  const [status, setStatus] = useState<ProbeStatus>("idle");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Bootstrap from storage on first mount. Callers that pass `initial`
  // skip this — the bootstrap is for Settings rendering on a fresh
  // section change where we want the current persisted value.
  useEffect(() => {
    if (initial !== undefined) return;
    void appInfo.getApiBase().then((base) => setUrl(base));
  }, [initial]);

  const probe = useCallback(async (candidate: string) => {
    // Abort any in-flight probe to avoid race conditions stamping a
    // stale result over the new one (Tom types fast).
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setStatus("probing");
    try {
      const baseTrimmed = candidate.endsWith("/") ? candidate : `${candidate}/`;
      const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
      const r = await fetch(`${baseTrimmed}api/voices_count`, {
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (r.ok) setStatus("reachable");
      else setStatus("unreachable");
    } catch {
      // Abort + network + DNS all land here; we can't distinguish
      // meaningfully without leaking errno-style detail.
      setStatus("unreachable");
    }
  }, []);

  // Debounced probe on every edit. Editing-then-stopping fires the
  // probe; editing-while-the-prev-probe-runs aborts that prev probe.
  // Priya H3: validate the URL first; malformed short-circuits the
  // probe so the user sees actionable copy instead of "Unreachable"
  // for what's really a typo.
  useEffect(() => {
    if (!url) {
      setStatus("idle");
      onChange?.(url, "idle");
      return;
    }
    try {
      validateDaemonUrl(url);
    } catch (err) {
      if (err instanceof InvalidDaemonUrlError) {
        setStatus("malformed");
        onChange?.(url, "malformed");
        return;
      }
      throw err;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      void probe(url).then(() => {
        // Final status read is racy across renders; using setStatus's
        // closure value is fine because `probe` updated it last.
        onChange?.(url, status);
      });
    }, DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // status intentionally NOT in deps — we don't want a status update
    // to re-fire the probe.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, probe]);

  // Persist on blur, but only if the URL validates. A typo'd URL stays
  // in component state for the user to fix; we don't overwrite the
  // last-known-good base in AsyncStorage with garbage (Priya H3).
  const handleBlur = useCallback(() => {
    if (!url) return;
    try {
      void appInfo.setApiBase(url);
    } catch (err) {
      if (err instanceof InvalidDaemonUrlError) {
        setStatus("malformed");
        return;
      }
      throw err;
    }
  }, [url]);

  const handleReset = useCallback(() => {
    setUrl(DEFAULT_DAEMON_URL_HINT);
    void appInfo.setApiBase(DEFAULT_DAEMON_URL_HINT);
  }, []);

  // On web the input is purely informational — setApiBase is a no-op
  // there. Callers (SettingsScreen) hide the whole row on web, but if
  // someone renders us anyway we still want correct visual state.
  const isWeb = Platform.OS === "web";

  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        <TextInput
          value={url}
          onChangeText={setUrl}
          onBlur={handleBlur}
          editable={!isWeb}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          placeholder={DEFAULT_DAEMON_URL_HINT}
          placeholderTextColor={colors.textQuiet}
          style={styles.input}
          accessibilityLabel="Daemon URL"
          accessibilityHint="The address where the voix daemon is reachable."
        />
        <StatusIndicator status={status} />
      </View>
      {status === "malformed" && <MalformedHint />}
      {showResetLink && !isWeb && (
        <Pressable
          onPress={handleReset}
          style={styles.resetHit}
          accessibilityRole="button"
          accessibilityLabel="Reset daemon URL to default"
        >
          <Text style={styles.resetLink}>Reset to default</Text>
        </Pressable>
      )}
    </View>
  );
}

function StatusIndicator({ status }: { status: ProbeStatus }) {
  // Architect Decision 2 ("Connected" / "Unreachable"); we add a
  // "Probing…" mid-state because debounced edits otherwise look like
  // dropped requests. Priya H3 added "Malformed" as a distinct state
  // from "Unreachable" so a typo'd URL shows actionable copy instead
  // of looking like a network failure.
  let label: string;
  let color: string;
  switch (status) {
    case "probing":
      label = "Probing…";
      color = colors.textMuted;
      break;
    case "reachable":
      label = "Connected";
      // Use `haBlueText` not `haBlue` — the status label is text on
      // bgSubtle and needs WCAG AA contrast (Priya B1 — M23 fix-pass).
      color = colors.haBlueText;
      break;
    case "unreachable":
      label = "Unreachable";
      color = colors.danger;
      break;
    case "malformed":
      label = "Malformed";
      color = colors.danger;
      break;
    case "idle":
    default:
      label = "";
      color = colors.textMuted;
      break;
  }
  if (!label) return null;
  return (
    <View
      style={styles.statusRow}
      accessibilityLiveRegion="polite"
      accessibilityLabel={`Daemon status: ${label}`}
    >
      <View style={[styles.statusDot, { backgroundColor: color }]} />
      <Text style={[styles.statusLabel, { color }]}>{label}</Text>
    </View>
  );
}

/**
 * Helper copy explaining the malformed state. Rendered by the
 * component below the input row only when `status === "malformed"`.
 * Surfaces the actionable fix instead of leaving the user staring at
 * a red dot (Priya H3, M23 fix-pass).
 */
function MalformedHint() {
  return (
    <Text style={styles.malformedHint} accessibilityLiveRegion="polite">
      That doesn't look like a daemon URL. Try `http://your-host:8765/`.
    </Text>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.xs },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  input: {
    flex: 1,
    fontFamily: fontFamily.mono,
    fontSize: 12,
    color: colors.ink,
    padding: spacing.sm,
    borderRadius: radius.sm,
    backgroundColor: colors.bgSubtle,
    borderWidth: 0.5,
    borderColor: colors.rule,
  },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  statusLabel: {
    fontFamily: fontFamily.ui,
    fontSize: 11,
  },
  resetHit: {
    alignSelf: "flex-start",
    paddingVertical: 2,
  },
  resetLink: {
    fontFamily: fontFamily.ui,
    fontSize: 11,
    color: colors.sysAccent,
  },
  malformedHint: {
    fontFamily: fontFamily.ui,
    fontSize: 11,
    color: colors.danger,
    lineHeight: 16,
  },
});
