/**
 * Surfaces screen (M16).
 *
 * Replaces the M01-era "Devices & settings" placeholder. Lists every
 * Audio I/O endpoint the daemon has seen — one row per device record,
 * with the M08 capability snapshot rendered legibly underneath.
 *
 * Today's row is shaped around the puck: name + (optional) friendly
 * label + last-seen, then a chip strip of the things the endpoint can
 * physically do (mic rate, speaker rate, half-duplex on-chip, wake
 * words). Browser / phone endpoints will fall through this layout
 * naturally — they declare the same capability shape.
 *
 * Designed flat: no nested cards, hairline rules between rows, no
 * actions on the row itself (active-voice change happens on the
 * Voices screen). Marina + Wren can audit before M16's UI deploy.
 */

import { useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";
import { Puck } from "../components/Puck";
import {
  type Surface,
  type SurfaceCapabilities,
  type Voice,
  surfacesApi,
  voicesApi,
} from "../lib/api";
import { colors, fontFamily, nearestSwatch, radius, spacing } from "../lib/theme";

export function SurfaceList() {
  const [surfaces, setSurfaces] = useState<Surface[] | null>(null);
  const [voiceById, setVoiceById] = useState<Record<string, Voice>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([surfacesApi.list(), voicesApi.list()])
      .then(([s, v]) => {
        if (cancelled) return;
        setSurfaces(s);
        const idx: Record<string, Voice> = {};
        for (const voice of v) idx[voice.id] = voice;
        setVoiceById(idx);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) {
    return (
      <View style={styles.errorBox}>
        <Text style={styles.errorTitle}>Couldn't load surfaces</Text>
        <Text style={styles.errorMsg}>{error}</Text>
      </View>
    );
  }
  if (!surfaces) {
    return (
      <View style={styles.loadingBox}>
        <ActivityIndicator color={colors.sysAccent} />
      </View>
    );
  }
  if (surfaces.length === 0) {
    return (
      <View style={styles.emptyBox}>
        {/* Puck hero anchors the zero-surfaces state (B1) so it reads as
            intentional, not a blank pane. */}
        <Puck size={48} />
        <Text style={styles.emptyTitle}>No surfaces connected.</Text>
        <Text style={styles.emptyHint}>
          Your phone, browser, and puck appear here when they reach the
          daemon.
        </Text>
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.scroll}>
      {surfaces.map((surface) => (
        <SurfaceRow
          key={surface.deviceId}
          surface={surface}
          voice={voiceById[surface.voiceId]}
        />
      ))}
    </ScrollView>
  );
}

function SurfaceRow({ surface, voice }: { surface: Surface; voice?: Voice }) {
  const swatch = voice ? nearestSwatch(voice.color) : { hex: colors.textMuted };
  const label = surface.friendlyName || surface.deviceId;
  const meta = formatLastSeen(surface.lastSeenMs);
  const protocolLabel = surface.protocolVersion ? `v${surface.protocolVersion}` : "legacy";

  return (
    <View style={styles.row}>
      <View style={styles.rowIcon}>
        <SurfaceGlyph kind={surface.clientKind} color={swatch.hex} />
      </View>
      <View style={styles.rowBody}>
        <View style={styles.rowHeader}>
          <Text style={styles.rowName}>{label}</Text>
          {surface.clientKind && (
            <Text style={styles.clientKindTag}>{prettifyKind(surface.clientKind)}</Text>
          )}
          <Text style={styles.protocolTag}>{protocolLabel}</Text>
        </View>
        <Text style={styles.rowMeta}>{meta}</Text>
        <Text style={styles.rowVoice}>
          voice · {voice?.name ?? surface.voiceId}
        </Text>
        {/* M23 — italic HA-blue tone one-liner directly under the
            bound voice's name. Same treatment as VoiceList /
            ConversationList for visual consistency. */}
        {voice?.tone && (
          <Text style={styles.rowTone} numberOfLines={1}>
            {voice.tone}
          </Text>
        )}
        <CapabilityChips capabilities={surface.capabilities} />
      </View>
    </View>
  );
}

/** Kind-aware glyph. The puck gets the brand glyph; other kinds get
 *  a placeholder until we have a proper icon set. Wren (audit)
 *  called this out: visual distinction per `clientKind` is the
 *  thing that earns the "Surfaces" rename over "Devices". */
function SurfaceGlyph({ kind, color }: { kind?: string; color: string }) {
  if (!kind || kind === "puck" || kind === "puck-legacy") {
    return <Puck size={32} color={color} />;
  }
  const label =
    kind === "phone-sat" ? "📱" : kind === "browser-tab" ? "🌐" : kind === "laptop-mic" ? "💻" : "?";
  return (
    <View style={styles.glyphFallback}>
      <Text style={styles.glyphFallbackText}>{label}</Text>
    </View>
  );
}

/** Render a client kind for the inline tag. "puck-legacy" trims to
 *  "puck" — internal detail the user doesn't need. */
function prettifyKind(kind: string): string {
  if (kind === "puck-legacy") return "puck";
  return kind;
}

function CapabilityChips({ capabilities }: { capabilities?: SurfaceCapabilities }) {
  if (!capabilities) {
    return (
      <Text style={styles.noCaps}>
        No capability handshake on file (pre-M08 firmware or legacy
        hello). The daemon's defaults apply.
      </Text>
    );
  }
  const chips: string[] = [];
  chips.push(`mic ${capabilities.mic.sample_rate_hz / 1000} kHz mono`);
  if (capabilities.mic.codec && capabilities.mic.codec !== "pcm16") {
    chips.push(`codec ${capabilities.mic.codec}`);
  }
  if (capabilities.speaker) {
    chips.push(`speaker ${capabilities.speaker.sample_rate_hz / 1000} kHz`);
  }
  if (capabilities.half_duplex_on_chip) {
    chips.push("AEC on chip");
  }
  if (capabilities.wake_words && capabilities.wake_words.length > 0) {
    chips.push(`wake: ${capabilities.wake_words.join(", ")}`);
  }
  if (capabilities.screen) {
    chips.push("screen");
  }
  return (
    <View style={styles.chipRow}>
      {chips.map((c) => (
        <Text key={c} style={styles.chip}>
          {c}
        </Text>
      ))}
    </View>
  );
}

/** Compact relative time. "just now" / "5 min ago" / "2 h ago" /
 *  "yesterday" / "May 28". */
function formatLastSeen(ms: number): string {
  const now = Date.now();
  const elapsed = now - ms;
  if (elapsed < 60_000) return "just now";
  if (elapsed < 60 * 60_000) return `${Math.floor(elapsed / 60_000)} min ago`;
  if (elapsed < 24 * 60 * 60_000) return `${Math.floor(elapsed / (60 * 60_000))} h ago`;
  if (elapsed < 48 * 60 * 60_000) return "yesterday";
  const date = new Date(ms);
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

const styles = StyleSheet.create({
  // `width: "100%"` is load-bearing: without it `alignSelf: "center"`
  // overrides the ScrollView content container's default cross-axis
  // stretch and the whole list shrink-wraps to its widest child's
  // intrinsic width, collapsing every `flex: 1` rowBody to a ~16pt
  // min-content column (B13 BLOCKER). The list fills the viewport, then
  // the 720 cap + center keeps the desktop / iPad two-column layout.
  scroll: { padding: spacing.xl, width: "100%", maxWidth: 720, alignSelf: "center", gap: 0 },

  row: {
    flexDirection: "row",
    paddingVertical: spacing.lg,
    gap: spacing.lg,
    borderBottomWidth: 0.5,
    borderBottomColor: colors.ruleSoft,
  },
  rowIcon: { paddingTop: 2 },
  rowBody: { flex: 1, gap: spacing.sm },
  rowHeader: { flexDirection: "row", alignItems: "center", gap: spacing.sm, flexWrap: "wrap" },
  rowName: {
    fontFamily: fontFamily.ui,
    fontSize: 15,
    fontWeight: "600",
    color: colors.ink,
  },
  rowMeta: {
    fontFamily: fontFamily.ui,
    fontSize: 12,
    color: colors.textMuted,
  },
  rowVoice: {
    fontFamily: fontFamily.ui,
    fontSize: 12,
    color: colors.textBody,
  },
  // M23 — voice tone snippet under the bound voice. Brand-coloured
  // italic to match VoiceList / ConversationList tone rendering.
  // Uses `haBlueText` for WCAG AA contrast (Priya B1 — M23 fix-pass).
  rowTone: {
    fontFamily: fontFamily.ui,
    fontSize: 11,
    fontStyle: "italic",
    color: colors.haBlueText,
    lineHeight: 14,
  },
  glyphFallback: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.bgSubtle,
    alignItems: "center",
    justifyContent: "center",
  },
  glyphFallbackText: { fontSize: 16 },
  // Tags = sentence-case UI font; chips below use mono. Distinct
  // typography keeps "puck" + "v1" reading as metadata about the
  // row, not as the row's payload. Both surfaces use bgSubtle —
  // HA blue is reserved for "voix moments" (puck centre, ACTIVE
  // pill, speaker tag).
  clientKindTag: {
    fontFamily: fontFamily.ui,
    fontSize: 10,
    color: colors.textBody,
    backgroundColor: colors.bgSubtle,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: radius.sm,
  },
  protocolTag: {
    fontFamily: fontFamily.mono,
    fontSize: 10,
    color: colors.textMuted,
    backgroundColor: colors.bgSubtle,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: radius.sm,
  },

  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  chip: {
    fontFamily: fontFamily.mono,
    fontSize: 11,
    color: colors.textBody,
    backgroundColor: colors.bgSubtle,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.sm,
  },
  noCaps: {
    fontFamily: fontFamily.ui,
    fontSize: 12,
    color: colors.textMuted,
    fontStyle: "italic",
  },

  loadingBox: { padding: spacing.xxl, alignItems: "center" },
  emptyBox: {
    padding: spacing.xxl,
    alignItems: "center",
    gap: spacing.md,
    maxWidth: 480,
    alignSelf: "center",
  },
  emptyTitle: {
    fontFamily: fontFamily.ui,
    fontSize: 15,
    fontWeight: "600",
    color: colors.ink,
  },
  emptyHint: {
    fontFamily: fontFamily.ui,
    fontSize: 12,
    color: colors.textMuted,
    lineHeight: 18,
    textAlign: "center",
  },
  errorBox: {
    margin: spacing.lg,
    padding: spacing.lg,
    backgroundColor: colors.dangerBg,
    borderColor: colors.dangerBorder,
    borderWidth: 1,
    borderRadius: radius.md,
    gap: spacing.sm,
  },
  errorTitle: { fontFamily: fontFamily.ui, fontSize: 13, fontWeight: "600", color: colors.danger },
  errorMsg: { fontFamily: fontFamily.mono, fontSize: 12, color: colors.danger },
});
