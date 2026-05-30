/**
 * Conversations list (M17).
 *
 * One row per HistoryEntry, newest-first. Click a row to open the
 * detail view — transcript, produced entry (the donePrompt
 * artifact when present), context receipt, and inline audio
 * playback of the mic + speaker WAVs from /recordings/<sessionId>/.
 *
 * Flat row layout matches the Surfaces screen (M16): hairline rules
 * between rows, no nested cards, kind-aware glyph (the same one
 * Surfaces uses, tinted with the voice's colour).
 */

import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Puck } from "../components/Puck";
import { historyApi, type HistoryEntry, type Voice, voicesApi } from "../lib/api";
import { colors, fontFamily, nearestSwatch, radius, spacing } from "../lib/theme";
import { TalkButton } from "./TalkButton";

type Props = {
  onPickEntry: (entryId: string) => void;
};

export function ConversationList({ onPickEntry }: Props) {
  const [entries, setEntries] = useState<HistoryEntry[] | null>(null);
  const [voiceById, setVoiceById] = useState<Record<string, Voice>>({});
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    Promise.all([historyApi.list({ limit: 200 }), voicesApi.list()])
      .then(([h, v]) => {
        setEntries(h);
        const idx: Record<string, Voice> = {};
        for (const voice of v) idx[voice.id] = voice;
        setVoiceById(idx);
      })
      .catch((e) => {
        setError(e instanceof Error ? e.message : String(e));
      });
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  if (error) {
    return (
      <View style={styles.errorBox}>
        <Text style={styles.errorTitle}>Couldn't load conversations</Text>
        <Text style={styles.errorMsg}>{error}</Text>
      </View>
    );
  }
  if (!entries) {
    return (
      <View style={styles.loadingBox}>
        <ActivityIndicator color={colors.sysAccent} />
      </View>
    );
  }
  // Auto-refresh ~2 s after a session ends so the new entry shows up
  // without a manual reload. The TalkButton fires `onSessionEnded`
  // when the browser client tears down.
  const onSessionEnded = useCallback(() => {
    // Small delay because history.append is on the daemon side after
    // the WS closes; we want the eventual-consistency to land.
    setTimeout(refresh, 1500);
  }, [refresh]);

  if (entries.length === 0) {
    return (
      <View style={styles.scroll}>
        <TalkButton onSessionEnded={onSessionEnded} />
        <View style={styles.emptyBox}>
          <Text style={styles.emptyTitle}>No conversations yet</Text>
          <Text style={styles.emptyHint}>
            Hold the button above and say something. Or talk to your puck.
          </Text>
        </View>
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.scroll}>
      <TalkButton onSessionEnded={onSessionEnded} />
      {entries.map((entry) => (
        <Row
          key={entry.id}
          entry={entry}
          voice={voiceById[entry.voiceId]}
          onPress={() => onPickEntry(entry.id)}
        />
      ))}
    </ScrollView>
  );
}

function Row({
  entry,
  voice,
  onPress,
}: {
  entry: HistoryEntry;
  voice?: Voice;
  onPress: () => void;
}) {
  const swatch = voice ? nearestSwatch(voice.color) : { hex: colors.textMuted };
  // Wren (audit): preview the raw transcript — the words the USER
  // said. Processed text is the model's polish; the row's job is
  // to be a memory cue for the user's own utterance, with the
  // "shaped" tag flagging "there's a polished version inside".
  const preview = entry.rawText.replace(/\s+/g, " ").slice(0, 200);
  const when = formatTimestamp(entry.createdAt);
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
    >
      <View style={styles.rowIcon}>
        <Puck size={28} color={swatch.hex} />
      </View>
      <View style={styles.rowBody}>
        <View style={styles.rowHeaderLine1}>
          <Text style={styles.rowVoice}>{voice?.name ?? entry.voiceId}</Text>
          {entry.processedText && <Text style={styles.processedTag}>shaped</Text>}
        </View>
        <Text style={styles.rowMeta}>
          {when} · {formatDuration(entry.durationMs)}
        </Text>
        <Text style={styles.rowPreview} numberOfLines={2}>
          {preview || "(empty)"}
        </Text>
      </View>
    </Pressable>
  );
}

function formatTimestamp(iso: string): string {
  const now = Date.now();
  const t = new Date(iso).getTime();
  const elapsed = now - t;
  if (elapsed < 60_000) return "just now";
  if (elapsed < 60 * 60_000) return `${Math.floor(elapsed / 60_000)} min ago`;
  if (elapsed < 24 * 60 * 60_000) return `${Math.floor(elapsed / (60 * 60_000))} h ago`;
  if (elapsed < 48 * 60 * 60_000) return "yesterday";
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)} s`;
  return `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`;
}

const styles = StyleSheet.create({
  scroll: { padding: spacing.xl, maxWidth: 720, alignSelf: "center" },

  row: {
    flexDirection: "row",
    paddingVertical: spacing.md,
    gap: spacing.md,
    borderBottomWidth: 0.5,
    borderBottomColor: colors.ruleSoft,
    minHeight: 44, // a11y floor for tap targets
  },
  rowPressed: { backgroundColor: colors.bgHover },
  rowIcon: { paddingTop: 2 },
  rowBody: { flex: 1, gap: spacing.xs },
  rowHeaderLine1: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  rowVoice: {
    fontFamily: fontFamily.ui,
    fontSize: 13,
    fontWeight: "600",
    color: colors.ink,
  },
  rowMeta: {
    fontFamily: fontFamily.ui,
    fontSize: 12,
    color: colors.textMuted,
  },
  processedTag: {
    fontFamily: fontFamily.ui,
    fontSize: 10,
    color: colors.textBody,
    backgroundColor: colors.bgSubtle,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: radius.sm,
  },
  rowPreview: {
    fontFamily: fontFamily.ui,
    fontSize: 13,
    color: colors.textBody,
    lineHeight: 19,
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
