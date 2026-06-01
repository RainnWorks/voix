import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Puck } from "../components/Puck";
import { type Device, type Voice, devicesApi, voicesApi } from "../lib/api";
import { colors, fontFamily, nearestSwatch, radius, spacing } from "../lib/theme";

type Props = {
  onPickVoice: (voiceId: string) => void;
};

export function VoiceList({ onPickVoice }: Props) {
  const [voices, setVoices] = useState<Voice[] | null>(null);
  const [devices, setDevices] = useState<Device[]>([]);
  const [error, setError] = useState<string | null>(null);
  // Pull-to-refresh state (A1 iOS nativeness). Drives the native
  // UIRefreshControl spinner when the user tugs the list down.
  const [refreshing, setRefreshing] = useState(false);

  // Single load path shared by the mount effect and pull-to-refresh.
  // Clears any prior error on success so a transient daemon blip that
  // the user resolves (then pulls to retry) doesn't leave the error
  // box stuck on screen.
  const load = useCallback(() => {
    return Promise.all([voicesApi.list(), devicesApi.list()])
      .then(([m, d]) => {
        setVoices(m);
        setDevices(d);
        setError(null);
      })
      .catch((e) => {
        setError(e instanceof Error ? e.message : String(e));
      });
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Pull-to-refresh handler — re-runs the load and parks the native
  // spinner until it settles (A1 iOS nativeness).
  const onRefresh = useCallback(() => {
    setRefreshing(true);
    void load().finally(() => setRefreshing(false));
  }, [load]);

  if (error) {
    return (
      <View style={styles.errorBox}>
        <Text style={styles.errorTitle}>Couldn't load voices</Text>
        <Text style={styles.errorMsg}>{error}</Text>
      </View>
    );
  }
  if (!voices) {
    return (
      <View style={styles.loadingBox}>
        {/* Large, system-tinted spinner (B1). The spinner is chrome,
            not a voix moment — system accent, not HA blue. */}
        <ActivityIndicator size="large" color={colors.sysAccent} />
      </View>
    );
  }

  const activeVoiceId = devices[0]?.voiceId;

  return (
    <ScrollView
      contentContainerStyle={styles.outer}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor={colors.sysAccent}
        />
      }
    >
      {/* The NOW strip is the section header for the grouped voices list
          — it stays a voix moment (HA blue), captioning the surface +
          active voice that the rows below choose between (Marina v3 #2). */}
      {devices[0] && (
        <View style={styles.activeStrip}>
          <Text style={styles.activeStripLabel}>NOW</Text>
          <Text style={styles.activeStripDevice}>
            {friendlyDeviceName(devices[0])}
          </Text>
          <Text style={styles.activeStripDot}>·</Text>
          <Text style={styles.activeStripMode}>
            {voices.find((m) => m.id === activeVoiceId)?.name ?? "—"}
          </Text>
        </View>
      )}

      {/* Inset-grouped list (iOS UITableView grouped style), not a stack
          of free-standing cards (Marina v3 #2): one rounded section,
          hairline row separators, the swatch as the leading accessory, a
          checkmark on the active row (no "ACTIVE" badge / "Activate"
          link), and a chevron to drill into the editor. */}
      <View style={styles.group}>
        {voices.map((m, i) => (
          <VoiceRow
            key={m.id}
            voice={m}
            active={m.id === activeVoiceId}
            last={i === voices.length - 1}
            onEdit={() => onPickVoice(m.id)}
          />
        ))}
      </View>
    </ScrollView>
  );
}

/**
 * Human surface name for the NOW strip. The daemon identifies a surface
 * by a generated id (`browser-p250im9u56fmpu8sdx8`); that's SRE plumbing,
 * not product language, and must never reach the UI (Wren v3 H2/F4).
 * Prefer the surface's own friendly name; otherwise fall back to a
 * kind-derived label ("This phone" / "This browser" / …) from
 * client_info.kind. The raw deviceId is never rendered.
 */
function friendlyDeviceName(device: Device): string {
  const named = device.friendlyName?.trim();
  if (named) return named;
  switch (device.clientKind) {
    case "phone-sat":
      return "This phone";
    case "browser-tab":
      return "This browser";
    case "laptop-mic":
      return "This Mac";
    case "puck":
    case "puck-legacy":
      return "Voice PE";
    default:
      return "This device";
  }
}

/**
 * One grouped-list row. The WHOLE row is a single tap target that drills
 * into the voice editor (E1) — on iOS-native inset-grouped lists the row
 * body is the hit area and the chevron is only a visual disclosure cue,
 * not a separate ~20pt target the user has to aim at (the desktop /
 * HA add-on pain point Tom flagged). The trailing checkmark stays as a
 * read-only indicator of the active voice; choosing the active voice
 * lives in Settings → Default voice (handleSetDefaultVoice), so making
 * the row edit-only loses no capability.
 *
 * On web, react-native-web renders the Pressable with `cursor: pointer`
 * automatically (it has an onPress), and `onHoverIn/Out` drive the soft
 * bgHover highlight (Marina v4 #6) — both no-ops on touch.
 */
function VoiceRow({
  voice,
  active,
  last,
  onEdit,
}: {
  voice: Voice;
  active: boolean;
  last: boolean;
  onEdit: () => void;
}) {
  const swatch = nearestSwatch(voice.color);
  const [hovered, setHovered] = useState(false);
  return (
    <Pressable
      onPress={onEdit}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      accessibilityRole="button"
      accessibilityLabel={active ? `${voice.name}, active voice` : voice.name}
      accessibilityHint="Opens the voice editor."
      style={({ pressed }) => [
        styles.row,
        !last && styles.rowSeparator,
        styles.rowMain,
        (pressed || hovered) && styles.rowPressed,
      ]}
    >
      {/* Leading accessory — the brand swatch (a sanctioned voix glyph). */}
      <Puck size={30} color={swatch.hex} />
      <View style={styles.rowBody}>
        <Text style={styles.rowName} numberOfLines={1}>
          {voice.name}
        </Text>
        {voice.tone ? (
          <Text style={styles.rowTone} numberOfLines={1}>
            {voice.tone}
          </Text>
        ) : (
          <Text style={styles.rowDesc} numberOfLines={1}>
            {voice.routingHint ||
              (voice.type === "realtime"
                ? "Real-time back and forth."
                : "Press, speak, paste.")}
          </Text>
        )}
      </View>
      {/* Trailing checkmark — read-only mark of the active voice. System
          accent = a chrome selection mark, not a voix moment. */}
      {active ? <Text style={styles.checkmark}>✓</Text> : null}
      {/* Detail-disclosure chevron — a visual cue only; the whole row is
          the hit target (E1). */}
      <Text style={styles.chevron}>›</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  outer: { padding: spacing.lg, gap: spacing.lg },
  activeStrip: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    backgroundColor: colors.haBlueBg,
    borderRadius: radius.lg,
    borderWidth: 0.5,
    borderColor: "rgba(3,169,244,0.25)",
  },
  activeStripLabel: {
    fontFamily: fontFamily.mono,
    fontSize: 10,
    color: colors.haBlueText,
    letterSpacing: 1.2,
  },
  activeStripDevice: {
    fontFamily: fontFamily.ui,
    fontSize: 12,
    color: colors.ink,
  },
  activeStripDot: { color: colors.textMuted },
  activeStripMode: {
    fontFamily: fontFamily.ui,
    fontSize: 12,
    color: colors.ink,
    fontWeight: "500",
  },

  // Inset-grouped section container (Marina v3 #2): one rounded card
  // that holds every row, hairline separators between them — the iOS
  // UITableView grouped idiom, not a stack of free-standing cards.
  group: {
    backgroundColor: colors.bgElevated,
    borderRadius: radius.lg,
    borderWidth: 0.5,
    borderColor: colors.rule,
    overflow: "hidden",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
  },
  rowSeparator: {
    borderBottomWidth: 0.5,
    borderBottomColor: colors.ruleSoft,
  },
  // The whole row is one tap target (E1): full-width padding, no flex:1
  // (it no longer shares a horizontal flex row with a separate chevron
  // Pressable). Trailing padding gives the chevron breathing room from
  // the card edge.
  rowMain: {
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingLeft: spacing.lg,
    paddingRight: spacing.lg,
    paddingVertical: spacing.md,
    minHeight: 56,
  },
  rowPressed: { backgroundColor: colors.bgHover },
  rowBody: { flex: 1, minWidth: 0, gap: 2 },
  rowName: {
    fontFamily: fontFamily.ui,
    fontSize: 15,
    fontWeight: "500",
    color: colors.ink,
  },
  // Active-row selection mark — system accent (chrome), not HA blue.
  checkmark: {
    fontSize: 17,
    fontWeight: "600",
    color: colors.sysAccent,
  },
  // Native-style detail-disclosure chevron — a visual cue only now.
  chevron: {
    fontSize: 20,
    color: colors.textQuiet,
    fontWeight: "400",
  },
  // M23 — tone snippet under the voice name. Per Marina §brand the
  // snippet is BODY copy describing how the voice sounds, NOT a voix
  // moment, so it routes to `textBody` (the secondaryLabel equivalent),
  // not the reserved HA blue. Accent-blue body copy read as tappable
  // link text in every row (Marina v4 colour-discipline) — the voice
  // identity already lives on the leading swatch Puck, so the snippet
  // stays neutral. Italic preserves the "voice character" feel.
  rowTone: {
    fontFamily: fontFamily.ui,
    fontSize: 12,
    fontStyle: "italic",
    color: colors.textBody,
    lineHeight: 15,
  },
  rowDesc: {
    fontFamily: fontFamily.ui,
    fontSize: 12,
    color: colors.textMuted,
    lineHeight: 15,
  },

  loadingBox: { padding: 40, alignItems: "center" },
  errorBox: {
    margin: spacing.lg,
    padding: spacing.lg,
    backgroundColor: "#fff3f0",
    borderColor: "#f5c6c0",
    borderWidth: 1,
    borderRadius: radius.lg,
  },
  errorTitle: { fontWeight: "500", color: "#a02d20", marginBottom: 4 },
  errorMsg: {
    fontSize: 12,
    color: "#a02d20",
    fontFamily: fontFamily.mono,
  },
});
