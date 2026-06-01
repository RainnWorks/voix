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
  const [activating, setActivating] = useState<string | null>(null);
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

  const activateVoice = async (voiceId: string) => {
    const device = devices[0]; // single-puck household for now
    if (!device) return;
    setActivating(voiceId);
    try {
      const next = await devicesApi.setVoice(device.deviceId, voiceId);
      setDevices([next, ...devices.slice(1)]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setActivating(null);
    }
  };

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
            activating={activating === m.id}
            last={i === voices.length - 1}
            onEdit={() => onPickVoice(m.id)}
            onActivate={() => activateVoice(m.id)}
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
 * One grouped-list row. Tapping the row body **activates** the voice
 * (the picker's primary action — checkmark moves to it); the trailing
 * chevron drills into the editor. This replaces the card's split
 * "tap-to-edit + Activate-link" model with the native picker shape
 * Marina v3 #2 asked for.
 */
function VoiceRow({
  voice,
  active,
  activating,
  last,
  onEdit,
  onActivate,
}: {
  voice: Voice;
  active: boolean;
  activating: boolean;
  last: boolean;
  onEdit: () => void;
  onActivate: () => void;
}) {
  const swatch = nearestSwatch(voice.color);
  return (
    <View style={[styles.row, !last && styles.rowSeparator]}>
      <Pressable
        onPress={active ? undefined : onActivate}
        disabled={activating}
        accessibilityRole="radio"
        accessibilityState={{ selected: active }}
        accessibilityLabel={
          active ? `${voice.name}, active voice` : `Activate ${voice.name}`
        }
        style={({ pressed }) => [styles.rowMain, pressed && !active && styles.rowPressed]}
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
        {/* Trailing checkmark on the active row — replaces the "ACTIVE"
            badge + "Activate" link (Marina v3 #2). System accent = a
            chrome selection mark, not a voix moment. */}
        {activating ? (
          <ActivityIndicator size="small" color={colors.sysAccent} />
        ) : active ? (
          <Text style={styles.checkmark}>✓</Text>
        ) : null}
      </Pressable>
      {/* Detail-disclosure chevron — drills into the voice editor. */}
      <Pressable
        onPress={onEdit}
        hitSlop={{ top: 12, bottom: 12, left: 8, right: 12 }}
        accessibilityRole="button"
        accessibilityLabel={`Edit ${voice.name}`}
        style={({ pressed }) => [styles.chevronHit, pressed && styles.rowPressed]}
      >
        <Text style={styles.chevron}>›</Text>
      </Pressable>
    </View>
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
  rowMain: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingLeft: spacing.lg,
    paddingRight: spacing.sm,
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
  // Native-style detail-disclosure chevron.
  chevronHit: {
    minHeight: 56,
    paddingHorizontal: spacing.md,
    alignItems: "center",
    justifyContent: "center",
  },
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
