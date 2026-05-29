import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
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

  useEffect(() => {
    let cancelled = false;
    Promise.all([voicesApi.list(), devicesApi.list()])
      .then(([m, d]) => {
        if (cancelled) return;
        setVoices(m);
        setDevices(d);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, []);

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
        <ActivityIndicator color={colors.haBlue} />
      </View>
    );
  }

  const activeVoiceId = devices[0]?.voiceId;

  return (
    <View style={styles.outer}>
      {devices[0] && (
        <View style={styles.activeStrip}>
          <Text style={styles.activeStripLabel}>NOW</Text>
          <Text style={styles.activeStripDevice}>
            {devices[0].friendlyName ?? devices[0].deviceId}
          </Text>
          <Text style={styles.activeStripDot}>·</Text>
          <Text style={styles.activeStripMode}>
            {voices.find((m) => m.id === activeVoiceId)?.name ?? "—"}
          </Text>
        </View>
      )}

      <View style={styles.grid}>
        {voices.map((m) => (
          <VoiceCard
            key={m.id}
            voice={m}
            active={m.id === activeVoiceId}
            activating={activating === m.id}
            onEdit={() => onPickVoice(m.id)}
            onActivate={() => activateVoice(m.id)}
          />
        ))}
      </View>
    </View>
  );
}

function VoiceCard({
  voice,
  active,
  activating,
  onEdit,
  onActivate,
}: {
  voice: Voice;
  active: boolean;
  activating: boolean;
  onEdit: () => void;
  onActivate: () => void;
}) {
  const swatch = nearestSwatch(voice.color);
  return (
    <View style={[styles.card, active && styles.cardActive]}>
      <Pressable
        onPress={onEdit}
        style={({ pressed }) => [styles.cardClickable, pressed && styles.cardPressed]}
      >
        <Puck size={44} color={swatch.hex} />
        <View style={styles.cardBody}>
          <View style={styles.cardTitleRow}>
            <Text style={styles.cardName}>{voice.name}</Text>
            {active && <Text style={styles.activeTag}>ACTIVE</Text>}
          </View>
          <Text style={styles.cardDesc} numberOfLines={2}>
            {voice.routingHint ||
              (voice.type === "realtime"
                ? "Real-time back and forth. Streams transcript live."
                : "Press, speak, paste.")}
          </Text>
        </View>
      </Pressable>
      {!active && (
        <Pressable
          onPress={onActivate}
          disabled={activating}
          style={({ pressed }) => [
            styles.activateBtn,
            pressed && styles.activateBtnPressed,
            activating && styles.activateBtnDisabled,
          ]}
        >
          <Text style={styles.activateBtnText}>{activating ? "…" : "Activate"}</Text>
        </Pressable>
      )}
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
    color: colors.haBlue,
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

  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.md,
  },
  card: {
    flexGrow: 1,
    minWidth: 280,
    flexBasis: "48%",
    backgroundColor: colors.bgElevated,
    borderRadius: radius.lg,
    borderWidth: 0.5,
    borderColor: colors.rule,
    padding: spacing.md,
    gap: spacing.sm,
  },
  cardActive: {
    borderColor: colors.haBlue,
    borderWidth: 2,
    padding: spacing.md - 1.5,
  },
  cardClickable: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.md,
  },
  cardPressed: { opacity: 0.7 },
  cardBody: { flex: 1, minWidth: 0, gap: 4 },
  cardTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  cardName: {
    fontFamily: fontFamily.ui,
    fontSize: 14,
    fontWeight: "500",
    color: colors.ink,
  },
  activeTag: {
    fontFamily: fontFamily.mono,
    fontSize: 9,
    color: colors.haBlue,
    backgroundColor: colors.haBlueBg,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 3,
    letterSpacing: 0.5,
  },
  cardDesc: {
    fontFamily: fontFamily.ui,
    fontSize: 12,
    color: colors.textMuted,
    lineHeight: 16,
  },
  activateBtn: {
    alignSelf: "flex-start",
    marginLeft: 44 + spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 4,
    backgroundColor: colors.bgSubtle,
    borderRadius: radius.sm,
  },
  activateBtnPressed: { backgroundColor: colors.bgHover },
  activateBtnDisabled: { opacity: 0.5 },
  activateBtnText: {
    fontFamily: fontFamily.ui,
    fontSize: 12,
    color: colors.sysAccent,
    fontWeight: "500",
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
