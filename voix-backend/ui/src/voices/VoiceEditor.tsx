import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { Puck } from "../components/Puck";
import { type Voice, type VoiceUpdate, voicesApi } from "../lib/api";
import {
  colors,
  fontFamily,
  modePalette,
  nearestSwatch,
  paletteOrder,
  radius,
  spacing,
} from "../lib/theme";

type Props = {
  voiceId: string;
  onClose: () => void;
};

export function VoiceEditor({ voiceId, onClose }: Props) {
  const [voice, setVoice] = useState<Voice | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(true);

  useEffect(() => {
    let cancelled = false;
    voicesApi
      .get(voiceId)
      .then((m) => {
        if (!cancelled) setVoice(m);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [voiceId]);

  const save = async (patch: VoiceUpdate) => {
    if (!voice) return;
    setSaved(false);
    try {
      const next = await voicesApi.update(voice.id, patch);
      setVoice(next);
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  if (error) {
    return (
      <View style={styles.errorBox}>
        <Text style={styles.errorTitle}>Error</Text>
        <Text style={styles.errorMsg}>{error}</Text>
        <Pressable onPress={onClose}>
          <Text style={styles.backLink}>← Back</Text>
        </Pressable>
      </View>
    );
  }
  if (!voice) {
    return (
      <View style={styles.loadingBox}>
        <ActivityIndicator color={colors.haBlue} />
      </View>
    );
  }

  const swatch = nearestSwatch(voice.color);
  const postProcEnabled = voice.postProcessPrompt.trim().length > 0;

  return (
    <ScrollView contentContainerStyle={styles.scroll}>
      <View style={styles.topBar}>
        <Pressable onPress={onClose}>
          <Text style={styles.backLink}>← Voices</Text>
        </Pressable>
        <Text style={styles.savedText}>{saved ? "Saved" : "Saving…"}</Text>
      </View>

      <View style={styles.identityRow}>
        <Puck size={56} color={swatch.hex} />
        <View style={styles.identityCol}>
          <TextInput
            value={voice.name}
            onChangeText={(t) => setVoice({ ...voice, name: t })}
            onBlur={() => save({ name: voice.name })}
            style={styles.nameInput}
          />
          <TextInput
            value={voice.routingHint}
            placeholder="One-line description of when to use this voice."
            placeholderTextColor={colors.textQuiet}
            onChangeText={(t) => setVoice({ ...voice, routingHint: t })}
            onBlur={() => save({ routingHint: voice.routingHint })}
            style={styles.descInput}
          />
        </View>
      </View>

      {/* 12-swatch picker */}
      <SectionLabel>Puck colour</SectionLabel>
      <View style={styles.swatchRow}>
        {paletteOrder.map((key) => {
          const entry = modePalette[key];
          const selected = key === swatch.key;
          return (
            <Pressable
              key={key}
              onPress={() => {
                const color = [...entry.rgb] as [number, number, number];
                setVoice({ ...voice, color });
                void save({ color });
              }}
              style={({ pressed }) => [
                styles.swatchHit,
                pressed && styles.swatchHitPressed,
              ]}
            >
              {/* Outer ring is a wrapper View with a 2px transparent
                  gap to the inner swatch — selected state draws a
                  1.5px border in the swatch's own colour. Same visual
                  as boxShadow, no web-only CSS in the style sheet. */}
              <View
                style={[
                  styles.swatchRing,
                  selected && { borderColor: entry.hex, borderWidth: 1.5 },
                ]}
              >
                <View style={[styles.swatch, { backgroundColor: entry.hex }]} />
              </View>
            </Pressable>
          );
        })}
      </View>

      {voice.type === "realtime" && (
        <>
          <SettingRow
            label="Voice"
            desc="The voice this voice speaks back in."
            control={
              <TextInput
                value={voice.voice}
                onChangeText={(t) => setVoice({ ...voice, voice: t })}
                onBlur={() => save({ voice: voice.voice })}
                placeholder="alloy / ash / ballad / coral / echo / marin / cedar"
                placeholderTextColor={colors.textQuiet}
                style={styles.input}
              />
            }
          />
          <SettingRow
            label="Model"
            desc="The realtime model."
            control={
              <TextInput
                value={voice.model}
                onChangeText={(t) => setVoice({ ...voice, model: t })}
                onBlur={() => save({ model: voice.model })}
                placeholder="gpt-realtime-2"
                placeholderTextColor={colors.textQuiet}
                style={styles.input}
              />
            }
          />
        </>
      )}

      <SectionLabel>System prompt</SectionLabel>
      <TextInput
        value={voice.prompt}
        onChangeText={(t) => setVoice({ ...voice, prompt: t })}
        onBlur={() => save({ prompt: voice.prompt })}
        multiline
        placeholder={
          voice.type === "realtime" ? "You are voix…" : "(leave empty for raw transcription)"
        }
        placeholderTextColor={colors.textQuiet}
        style={styles.textarea}
      />

      {voice.type === "dictation" && (
        <>
          <SettingRow
            label="Post-process with LLM"
            desc="After STT, rewrite the transcript through an LLM."
            control={
              <Switch
                value={postProcEnabled}
                onValueChange={(on) => {
                  if (on && !voice.postProcessPrompt) {
                    const seed = voice.routingHint || "Polish the transcript for clarity.";
                    setVoice({ ...voice, postProcessPrompt: seed });
                    void save({ postProcessPrompt: seed });
                  } else if (!on) {
                    setVoice({ ...voice, postProcessPrompt: "" });
                    void save({ postProcessPrompt: "" });
                  }
                }}
              />
            }
          />
          {postProcEnabled && (
            <>
              <SectionLabel>Post-process prompt</SectionLabel>
              <TextInput
                value={voice.postProcessPrompt}
                onChangeText={(t) => setVoice({ ...voice, postProcessPrompt: t })}
                onBlur={() => save({ postProcessPrompt: voice.postProcessPrompt })}
                multiline
                style={styles.textarea}
              />
              <SettingRow
                label="Provider"
                desc="OpenAI or OpenRouter."
                control={
                  <TextInput
                    value={voice.postProcessProvider}
                    onChangeText={(t) =>
                      setVoice({
                        ...voice,
                        postProcessProvider: t === "openrouter" ? "openrouter" : "openai",
                      })
                    }
                    onBlur={() => save({ postProcessProvider: voice.postProcessProvider })}
                    style={styles.input}
                  />
                }
              />
              <SettingRow
                label="Model"
                desc="Chat-completions model."
                control={
                  <TextInput
                    value={voice.postProcessModel}
                    onChangeText={(t) => setVoice({ ...voice, postProcessModel: t })}
                    onBlur={() => save({ postProcessModel: voice.postProcessModel })}
                    placeholder="gpt-4o-mini"
                    placeholderTextColor={colors.textQuiet}
                    style={styles.input}
                  />
                }
              />
            </>
          )}
        </>
      )}
    </ScrollView>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <Text style={styles.sectionLabel}>{children}</Text>;
}

function SettingRow({
  label,
  desc,
  control,
}: {
  label: string;
  desc: string;
  control: React.ReactNode;
}) {
  return (
    <View style={styles.settingRow}>
      <View style={styles.settingLeft}>
        <Text style={styles.settingLabel}>{label}</Text>
        <Text style={styles.settingDesc}>{desc}</Text>
      </View>
      <View style={styles.settingRight}>{control}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: { padding: spacing.xl, maxWidth: 720, alignSelf: "center", gap: spacing.lg },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.sm,
  },
  backLink: {
    fontFamily: fontFamily.ui,
    fontSize: 13,
    color: colors.sysAccent,
  },
  savedText: {
    fontFamily: fontFamily.mono,
    fontSize: 10,
    color: colors.textMuted,
    letterSpacing: 1,
  },

  identityRow: { flexDirection: "row", alignItems: "center", gap: spacing.lg, marginBottom: 8 },
  identityCol: { flex: 1, gap: 4 },
  nameInput: {
    fontFamily: fontFamily.ui,
    fontSize: 18,
    fontWeight: "500",
    color: colors.ink,
    borderWidth: 0,
    padding: 0,
    backgroundColor: "transparent",
  },
  descInput: {
    fontFamily: fontFamily.ui,
    fontSize: 12,
    color: colors.textMuted,
    borderWidth: 0,
    padding: 0,
    backgroundColor: "transparent",
  },

  sectionLabel: {
    fontFamily: fontFamily.mono,
    fontSize: 10,
    color: colors.textMuted,
    letterSpacing: 1.5,
    marginTop: spacing.lg,
  },

  swatchRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    marginTop: spacing.xs,
  },
  swatchHit: { padding: 2 },
  swatchHitPressed: { opacity: 0.7 },
  swatchRing: {
    padding: 2.5,
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: "transparent",
  },
  swatch: {
    width: 22,
    height: 22,
    borderRadius: 11,
  },

  settingRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    paddingVertical: spacing.md,
    borderBottomWidth: 0.5,
    borderBottomColor: colors.ruleSoft,
    gap: spacing.lg,
  },
  settingLeft: { flex: 1, gap: 2 },
  settingLabel: {
    fontFamily: fontFamily.ui,
    fontSize: 13,
    color: colors.ink,
  },
  settingDesc: {
    fontFamily: fontFamily.ui,
    fontSize: 11,
    color: colors.textMuted,
  },
  settingRight: { minWidth: 200, maxWidth: 320, alignItems: "flex-end" },

  input: {
    width: "100%",
    fontFamily: fontFamily.ui,
    fontSize: 13,
    color: colors.ink,
    padding: 6,
    borderRadius: radius.sm,
    backgroundColor: colors.bgSubtle,
    borderWidth: 0.5,
    borderColor: colors.rule,
  },
  textarea: {
    fontFamily: fontFamily.mono,
    fontSize: 12,
    lineHeight: 18,
    color: colors.ink,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.bgSubtle,
    borderWidth: 0.5,
    borderColor: colors.rule,
    minHeight: 120,
    textAlignVertical: "top",
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
  errorMsg: { fontSize: 12, color: "#a02d20", fontFamily: fontFamily.mono },
});
