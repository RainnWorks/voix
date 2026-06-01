/**
 * Daemon-unreachable banner (B1 — empty + error states).
 *
 * After M-MobileFit the iPhone is the primary entry point, and a phone
 * pointed at a daemon that isn't running (asleep Mac, wrong URL, dropped
 * Wi-Fi) used to render a blank content pane — the individual screens
 * each show their own "Couldn't load …" box, but nothing said the
 * *daemon itself* is unreachable. This is that one soft, app-wide signal.
 *
 * It probes `GET /api/voices` once on mount. A **network** failure (the
 * fetch rejects — daemon down / wrong host) drops the banner; an HTTP
 * status error (4xx/5xx — daemon is up but unhappy) does NOT, because
 * that's the per-screen error box's job and double-surfacing it would be
 * noise. Tap re-probes.
 *
 * Brand: this is a "voix moment" (the app speaking about its own
 * liveness), so it takes the reserved HA-blue tint + `haBlueText`
 * foreground per the desktop guide — not the red danger surface. A
 * daemon being asleep isn't an error the user did; it's a nudge.
 */

import { useCallback, useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { voicesApi } from "../lib/api";
import { appInfo } from "../platform";
import { colors, fontFamily, radius, spacing } from "../lib/theme";

/** Our HTTP errors are thrown as `"<status> <statusText>: <body>"`
 *  (see lib/api.ts `api()`). Anything that doesn't match that shape is
 *  a fetch-layer reject — i.e. we never reached the daemon. */
function isNetworkError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return !/^\d{3}\s/.test(msg);
}

export function DaemonBanner() {
  const [unreachable, setUnreachable] = useState(false);
  const [base, setBase] = useState("");
  const [checking, setChecking] = useState(false);

  const probe = useCallback(() => {
    setChecking(true);
    voicesApi
      .list()
      .then(() => setUnreachable(false))
      .catch((e) => setUnreachable(isNetworkError(e)))
      .finally(() => setChecking(false));
  }, []);

  useEffect(() => {
    void appInfo.getApiBase().then(setBase);
    probe();
  }, [probe]);

  if (!unreachable) return null;

  // Web's getApiBase() returns "" (relative) — fold the trailing "at …"
  // away rather than print "running at .".
  const where = base ? ` at ${base}` : "";

  return (
    <Pressable
      onPress={probe}
      style={styles.banner}
      accessibilityRole="button"
      accessibilityLabel="voix can't reach the daemon. Tap to retry."
      accessibilityHint="Retry connecting to the daemon."
    >
      <View style={styles.dot} />
      <Text style={styles.text}>
        voix can't reach the daemon. Check it's running{where}.
      </Text>
      <Text style={styles.retry}>{checking ? "Retrying…" : "Retry"}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.haBlueBg,
    borderRadius: radius.md,
    borderWidth: 0.5,
    borderColor: "rgba(3,169,244,0.25)",
  },
  // A voix-blue status dot — the same "● LIVE"-family glyph, here in
  // its "not live" reading.
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.haBlue,
  },
  text: {
    flex: 1,
    fontFamily: fontFamily.ui,
    fontSize: 12,
    lineHeight: 16,
    color: colors.haBlueText,
  },
  retry: {
    fontFamily: fontFamily.ui,
    fontSize: 12,
    fontWeight: "600",
    color: colors.haBlueText,
  },
});
