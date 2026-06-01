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
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import type { Intent } from "@voix/protocol";
import { Puck } from "../components/Puck";
import { SwipeableRow } from "../components/SwipeableRow";
import {
  type Device,
  type HistoryEntry,
  type Voice,
  devicesApi,
  historyApi,
  voicesApi,
} from "../lib/api";
import { colors, fontFamily, nearestSwatch, radius, spacing } from "../lib/theme";
import { TalkButton } from "./TalkButton";

type Props = {
  onPickEntry: (entryId: string) => void;
};

export function ConversationList({ onPickEntry }: Props) {
  const [entries, setEntries] = useState<HistoryEntry[] | null>(null);
  const [voiceById, setVoiceById] = useState<Record<string, Voice>>({});
  // M23 Decision 3 — active voice drives TalkButton.intent. We read
  // the first device (single-puck household for now) + voices and
  // compute intent from the active voice's type. Refreshed on the
  // same heartbeat as entries so swapping the active voice on the
  // Voices screen propagates back when the user returns here.
  const [activeVoice, setActiveVoice] = useState<Voice | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Pull-to-refresh state (A1 iOS nativeness). Drives the native
  // UIRefreshControl spinner when the user tugs the list down.
  const [refreshing, setRefreshing] = useState(false);

  const refresh = useCallback(() => {
    return Promise.all([
      historyApi.list({ limit: 200 }),
      voicesApi.list(),
      devicesApi.list(),
    ])
      .then(([h, v, d]: [HistoryEntry[], Voice[], Device[]]) => {
        setEntries(h);
        const idx: Record<string, Voice> = {};
        for (const voice of v) idx[voice.id] = voice;
        setVoiceById(idx);
        const first = d[0];
        setActiveVoice(first ? (idx[first.voiceId] ?? null) : null);
      })
      .catch((e) => {
        setError(e instanceof Error ? e.message : String(e));
      });
  }, []);

  // Pull-to-refresh handler — re-runs the same fetch and parks the
  // native spinner until it settles (A1 iOS nativeness). `refresh`
  // swallows its own errors into the error box, so the finally is
  // safe without a catch here.
  const onRefresh = useCallback(() => {
    setRefreshing(true);
    void refresh().finally(() => setRefreshing(false));
  }, [refresh]);

  // Swipe-to-delete (A1 iOS nativeness). Optimistically drops the row so
  // the list closes the gap immediately, then issues the DELETE. On
  // failure we re-fetch to restore truth rather than trying to splice the
  // entry back at its old index — `refresh` is the canonical source and
  // avoids guessing ordering after a concurrent puck session may have
  // appended.
  const onDeleteEntry = useCallback(
    (id: string) => {
      setEntries((prev) => (prev ? prev.filter((e) => e.id !== id) : prev));
      void historyApi.delete(id).catch((e) => {
        setError(e instanceof Error ? e.message : String(e));
        void refresh();
      });
    },
    [refresh],
  );

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Auto-refresh ~1.5 s after a session ends so the new entry shows up
  // without a manual reload. The TalkButton fires `onSessionEnded`
  // when the browser client tears down. NOTE: this hook MUST come
  // before the early-return branches below — placing it after them
  // changes the hook-call count between renders (returns early on
  // first render, doesn't on second) and React throws "Rendered more
  // hooks than during the previous render". The audit caught this
  // crash before any user did.
  const onSessionEnded = useCallback(() => {
    setTimeout(refresh, 1500);
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

  // M23 Decision 3 — derive intent from active voice. Realtime → discuss,
  // Dictation → dictate. No active voice (no device yet) falls back to
  // discuss; the TalkButton hint will still read "Hold to talk to voix."
  // until the first session lands a device record.
  const intent: Intent = activeVoice?.type === "dictation" ? "dictate" : "discuss";

  // Shared native pull-to-refresh control — same instance shape on the
  // empty + populated branches so the gesture works even before the
  // first conversation lands (the empty state is exactly when a user
  // reaches to refresh). System accent tint, not HA blue — the spinner
  // is chrome, not a voix moment.
  const refreshControl = (
    <RefreshControl
      refreshing={refreshing}
      onRefresh={onRefresh}
      tintColor={colors.sysAccent}
    />
  );

  if (entries.length === 0) {
    return (
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={refreshControl}
      >
        <TalkButton intent={intent} onSessionEnded={onSessionEnded} />
        <View style={styles.emptyBox}>
          {/* Puck hero — the one sanctioned custom glyph — anchors the
              empty state so a fresh install reads as intentional, not
              blank (B1). */}
          <Puck size={48} />
          <Text style={styles.emptyTitle}>No conversations yet.</Text>
          <Text style={styles.emptyHint}>Press the button above to start.</Text>
        </View>
      </ScrollView>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.scroll} refreshControl={refreshControl}>
      <TalkButton intent={intent} onSessionEnded={onSessionEnded} />
      {entries.map((entry) => (
        <SwipeableRow
          key={entry.id}
          onDelete={() => onDeleteEntry(entry.id)}
          deleteAccessibilityLabel={`Delete conversation from ${entry.voiceName || entry.voiceId}`}
        >
          <Row
            entry={entry}
            voice={voiceById[entry.voiceId]}
            onPress={() => onPickEntry(entry.id)}
          />
        </SwipeableRow>
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
        {/* M23 — italic HA-blue tone snippet under the voice name,
            same treatment as VoiceList + SurfaceList. */}
        {voice?.tone && (
          <Text style={styles.rowTone} numberOfLines={1}>
            {voice.tone}
          </Text>
        )}
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
  // M23 — italic HA-blue tone snippet under the voice name. Matches
  // VoiceList.cardTone + SurfaceList.rowTone so the same voice reads
  // the same wherever it appears. Uses `haBlueText` for WCAG AA
  // contrast (Priya B1 — M23 fix-pass).
  rowTone: {
    fontFamily: fontFamily.ui,
    fontSize: 11,
    fontStyle: "italic",
    color: colors.haBlueText,
    lineHeight: 14,
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
