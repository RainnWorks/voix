/**
 * Conversation detail (M17).
 *
 * Shows everything voix knows about one session. Four blocks in
 * order, top to bottom:
 *
 *   1. Header — voice + when + duration + (optional) shaped tag.
 *   2. Produced entry — the donePrompt artifact when one exists.
 *      For pure-realtime sessions with no donePrompt this section
 *      is hidden; the transcript IS the entry.
 *   3. Transcript — raw STT output. Always shown.
 *   4. Context receipt — every ContextEntry captured at session
 *      start, rendered as a key/value tree. The brief's §6 calls
 *      this out specifically: making voix's intelligence legible
 *      is what builds trust.
 *   5. Audio — two inline `<audio>` players (via React Native Web's
 *      DOM forward) for mic.wav + speaker.wav. The recordings live
 *      under /recordings/<sessionId>/ — same route the M01-era
 *      diagnostic browser uses.
 */

import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import {
  type HistoryContextEntry,
  type HistoryEntry,
  historyApi,
} from "../lib/api";
import { colors, fontFamily, radius, spacing } from "../lib/theme";

type Props = {
  entryId: string;
  onClose: () => void;
};

export function ConversationDetail({ entryId, onClose }: Props) {
  const [entry, setEntry] = useState<HistoryEntry | null>(null);
  const [transcript, setTranscript] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setEntry(null);
    setTranscript(null);
    setError(null);
    Promise.all([historyApi.get(entryId), historyApi.transcript(entryId)])
      .then(([e, t]) => {
        if (cancelled) return;
        setEntry(e);
        setTranscript(t.content);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [entryId]);

  if (error) {
    return (
      <View style={styles.errorBox}>
        <Text style={styles.errorTitle}>Couldn't open this conversation</Text>
        <Text style={styles.errorMsg}>{error}</Text>
        <Pressable onPress={onClose}>
          <Text style={styles.backLink}>Back to conversations</Text>
        </Pressable>
      </View>
    );
  }
  if (!entry) {
    return (
      <View style={styles.loadingBox}>
        <ActivityIndicator color={colors.sysAccent} />
      </View>
    );
  }

  const whenAbs = new Date(entry.createdAt).toLocaleString();
  const recordingsBase = `recordings/${encodeURIComponent(entry.sessionId)}`;

  return (
    <ScrollView contentContainerStyle={styles.scroll}>
      <View style={styles.topBar}>
        <Pressable onPress={onClose}>
          <Text style={styles.backLink}>Back to conversations</Text>
        </Pressable>
      </View>

      <View style={styles.header}>
        <Text style={styles.headerVoice}>{entry.voiceName || entry.voiceId}</Text>
        <Text style={styles.headerMeta}>
          {whenAbs} · {formatDuration(entry.durationMs)} · {entry.modeType}
        </Text>
      </View>

      {/* Wren (audit): the transcript leads — that's the utterance,
          the user's memory cue. The "entry" comes second as "what
          voix made of it". Context + audio tail. This order serves
          rememberers first, auditors second. */}
      <Section label="Transcript" hint="What was said.">
        <Text style={styles.body}>{transcript ?? entry.rawText}</Text>
      </Section>

      {entry.processedText && (
        <Section label="Entry" hint="What voix made of it — the polished artifact.">
          <Text style={styles.body}>{entry.processedText}</Text>
          {entry.postProcessProvider && (
            <Text style={styles.bodyMeta}>
              via {entry.postProcessProvider}
              {entry.postProcessModel ? ` · ${entry.postProcessModel}` : ""}
            </Text>
          )}
        </Section>
      )}

      <Section
        label="What voix knew"
        hint="The context voix gathered before the conversation started. Trust grows from making the intelligence legible."
      >
        <ContextReceipt entries={entry.contextSnapshot} />
      </Section>

      <Section label="Listen back" hint="Mic is your voice. Speaker is what voix said.">
        <AudioPlayer src={`${recordingsBase}/mic.wav`} label="What I said" />
        <AudioPlayer src={`${recordingsBase}/speaker.wav`} label="What voix said" />
      </Section>
    </ScrollView>
  );
}

function Section({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionLabel}>{label}</Text>
      {hint && <Text style={styles.sectionHint}>{hint}</Text>}
      <View style={styles.sectionBody}>{children}</View>
    </View>
  );
}

/** Map raw context source ids to human-readable section names.
 *  Wren (audit) flagged that "HA" and "voix" read as namespaces;
 *  the receipt's job is to make the intelligence legible, so the
 *  source heading is where personality lands. */
const SOURCE_LABELS: Record<string, string> = {
  ha: "Your home",
  voix: "What voix knew about you",
};

function humaniseSource(source: string): string {
  return SOURCE_LABELS[source.toLowerCase()] ?? source;
}

function ContextReceipt({ entries }: { entries: HistoryContextEntry[] }) {
  if (entries.length === 0) {
    return <Text style={styles.muted}>No context recorded for this session.</Text>;
  }
  return (
    <View style={{ gap: spacing.md }}>
      {entries.map((entry, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: source can repeat; the snapshot's order is its stable id
        <View key={i} style={styles.contextSource}>
          <Text style={styles.contextSourceName}>{humaniseSource(entry.source)}</Text>
          <View style={styles.contextKvList}>
            {Object.entries(entry.data).map(([k, v]) => (
              <View key={k} style={styles.contextKvRow}>
                <Text style={styles.contextKey}>{k}</Text>
                <Text style={styles.contextValue}>
                  {typeof v === "string" ? v : JSON.stringify(v)}
                </Text>
              </View>
            ))}
          </View>
        </View>
      ))}
    </View>
  );
}

/** React Native Web forwards unknown components to DOM. `<audio>` from
 *  the audio element renders natively in the browser. For a future
 *  native Tauri/iOS shell we'd swap this for a native player. */
function AudioPlayer({ src, label }: { src: string; label: string }) {
  // React Native Web forwards unknown JSX children to DOM, so a bare
  // <audio> tag renders the native HTML5 element in the browser.
  return (
    <View style={styles.audioRow}>
      <Text style={styles.audioLabel}>{label}</Text>
      <audio controls preload="metadata" src={src} style={audioStyle} />
    </View>
  );
}

const audioStyle = {
  width: "100%",
  maxWidth: 480,
};

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)} s`;
  return `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`;
}

const styles = StyleSheet.create({
  scroll: { padding: spacing.xl, maxWidth: 720, alignSelf: "center", gap: spacing.lg },
  topBar: { marginBottom: spacing.sm },
  backLink: { fontFamily: fontFamily.ui, fontSize: 13, color: colors.sysAccent },

  header: {
    gap: spacing.xs,
    paddingBottom: spacing.lg,
    borderBottomWidth: 0.5,
    borderBottomColor: colors.ruleSoft,
  },
  headerVoice: {
    fontFamily: fontFamily.ui,
    fontSize: 17,
    fontWeight: "600",
    color: colors.ink,
  },
  headerMeta: {
    fontFamily: fontFamily.ui,
    fontSize: 12,
    color: colors.textMuted,
  },

  section: { gap: spacing.sm, paddingVertical: spacing.lg },
  sectionLabel: {
    fontFamily: fontFamily.mono,
    fontSize: 11,
    color: colors.textMuted,
    textTransform: "uppercase",
  },
  sectionHint: {
    fontFamily: fontFamily.ui,
    fontSize: 12,
    color: colors.textMuted,
    lineHeight: 18,
  },
  sectionBody: { marginTop: spacing.sm, gap: spacing.md },

  body: {
    fontFamily: fontFamily.ui,
    fontSize: 13,
    color: colors.ink,
    lineHeight: 20,
  },
  bodyMeta: {
    fontFamily: fontFamily.mono,
    fontSize: 11,
    color: colors.textMuted,
  },
  muted: {
    fontFamily: fontFamily.ui,
    fontSize: 12,
    color: colors.textMuted,
    fontStyle: "italic",
  },

  contextSource: {
    gap: spacing.xs,
    paddingVertical: spacing.sm,
    borderTopWidth: 0.5,
    borderTopColor: colors.ruleSoft,
  },
  // Source name carries the personality moment — sentence-case UI
  // font, not mono uppercase namespace.
  contextSourceName: {
    fontFamily: fontFamily.ui,
    fontSize: 13,
    fontWeight: "600",
    color: colors.ink,
  },
  contextKvList: { gap: spacing.xs / 2 },
  contextKvRow: { flexDirection: "row", gap: spacing.sm, flexWrap: "wrap" },
  contextKey: {
    fontFamily: fontFamily.mono,
    fontSize: 12,
    color: colors.textMuted,
    flexBasis: 140,
    flexShrink: 0,
  },
  contextValue: {
    fontFamily: fontFamily.mono,
    fontSize: 12,
    color: colors.ink,
    flex: 1,
  },

  audioRow: { gap: spacing.xs },
  audioLabel: {
    fontFamily: fontFamily.ui,
    fontSize: 13,
    fontWeight: "500",
    color: colors.ink,
  },

  loadingBox: { padding: spacing.xxl, alignItems: "center" },
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
