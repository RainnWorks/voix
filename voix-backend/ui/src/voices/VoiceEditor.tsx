import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
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
  const [advancedOpen, setAdvancedOpen] = useState(false);

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
      setError(null);
      setSaved(true);
    } catch (e) {
      // Wren (audit): a save failure used to nuke the whole editor.
      // Surface as a banner above the editor, keep typing live.
      setError(e instanceof Error ? e.message : String(e));
      setSaved(true);
    }
  };

  if (!voice && !error) {
    return (
      <View style={styles.loadingBox}>
        <ActivityIndicator color={colors.sysAccent} />
      </View>
    );
  }
  // Hard error before any voice loaded — give the user something to do.
  if (!voice) {
    return (
      <View style={styles.errorBox}>
        <Text style={styles.errorTitle}>Couldn't load this voice</Text>
        <Text style={styles.errorMsg}>{error}</Text>
        <Pressable onPress={onClose}>
          <Text style={styles.backLink}>Back to voices</Text>
        </Pressable>
      </View>
    );
  }

  const swatch = nearestSwatch(voice.color);
  const talkingEmpty = voice.talkingPrompt.trim().length === 0;
  const doneEmpty = voice.donePrompt.trim().length === 0;

  return (
    <ScrollView contentContainerStyle={styles.scroll}>
      <View style={styles.topBar}>
        <Pressable onPress={onClose}>
          <Text style={styles.backLink}>Back to voices</Text>
        </Pressable>
        <Text style={styles.savedText}>{saved ? "Saved" : "Saving…"}</Text>
      </View>

      {error && (
        <View style={styles.errorToast}>
          <Text style={styles.errorMsg}>Couldn't save: {error}</Text>
        </View>
      )}

      <View style={styles.identityRow}>
        <Puck size={48} color={swatch.hex} />
        <View style={styles.identityCol}>
          <TextInput
            value={voice.name}
            onChangeText={(t) => setVoice({ ...voice, name: t })}
            onBlur={() => save({ name: voice.name })}
            style={styles.nameInput}
          />
          <TextInput
            value={voice.routingHint}
            placeholder="A one-line introduction to this voice."
            placeholderTextColor={colors.textQuiet}
            onChangeText={(t) => setVoice({ ...voice, routingHint: t })}
            onBlur={() => save({ routingHint: voice.routingHint })}
            style={styles.descInput}
          />
        </View>
      </View>

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
              style={({ pressed }) => [styles.swatchHit, pressed && styles.swatchHitPressed]}
            >
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

      {/* Sequential two-phase block. The numbered HA-blue pips read
          as a flow, the connector line between them ties them
          together — Wren (audit) flagged that the editor needs to
          *show* the discuss→output arc, not just label it. */}
      <PhaseBlock
        number={1}
        label="When we're talking"
        hint="What the model is told during the conversation. Leave empty to skip straight to the output."
        empty={talkingEmpty}
        connector="below"
      >
        <TextInput
          value={voice.talkingPrompt}
          onChangeText={(t) => setVoice({ ...voice, talkingPrompt: t })}
          onBlur={() => save({ talkingPrompt: voice.talkingPrompt })}
          multiline
          placeholder="You are me, having a quick voice chat about what to write."
          placeholderTextColor={colors.textQuiet}
          style={styles.textarea}
        />
      </PhaseBlock>

      <PhaseBlock
        number={2}
        label="When I'm done"
        hint="What the model is told when producing the polished output. Leave empty to skip the output, just have a conversation."
        empty={doneEmpty}
        connector="above"
      >
        <TextInput
          value={voice.donePrompt}
          onChangeText={(t) => setVoice({ ...voice, donePrompt: t })}
          onBlur={() => save({ donePrompt: voice.donePrompt })}
          multiline
          placeholder="Write this as me emailing a vendor I'm annoyed with but still want to work with."
          placeholderTextColor={colors.textQuiet}
          style={styles.textarea}
        />
      </PhaseBlock>

      <Pressable onPress={() => setAdvancedOpen((v) => !v)} style={styles.advancedToggle}>
        <Text style={styles.advancedToggleText}>
          {advancedOpen ? "Hide advanced" : "Show advanced"}
        </Text>
      </Pressable>

      {advancedOpen && (
        <>
          <SectionLabel>Talking phase plumbing</SectionLabel>
          <SettingRow
            label="Speaker"
            desc="The TTS voice the realtime model speaks back in."
            control={
              <TextInput
                value={voice.voice}
                onChangeText={(t) => setVoice({ ...voice, voice: t })}
                onBlur={() => save({ voice: voice.voice })}
                placeholder="alloy"
                placeholderTextColor={colors.textQuiet}
                style={styles.input}
              />
            }
          />
          <SettingRow
            label="Realtime model"
            desc="The model used during the talking phase."
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

          <SectionLabel>Output phase plumbing</SectionLabel>
          <SettingRow
            label="Provider"
            desc="Where the output-phase model runs."
            control={
              <Segmented
                value={voice.postProcessProvider}
                options={[
                  { value: "openai", label: "OpenAI" },
                  { value: "openrouter", label: "OpenRouter" },
                ]}
                onChange={(v) => {
                  const next = v as Voice["postProcessProvider"];
                  setVoice({ ...voice, postProcessProvider: next });
                  void save({ postProcessProvider: next });
                }}
              />
            }
          />
          <SettingRow
            label="Output model"
            desc="The model used when producing the artifact."
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
    </ScrollView>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <Text style={styles.sectionLabel}>{children}</Text>;
}

/** A numbered phase block — the numbered HA-blue pip + the rule
 *  through the page is what makes the two phases read as one flow
 *  rather than two independent sections. When the phase is empty,
 *  we show a small "Skipped" tag in mono next to the label so the
 *  user can tell at a glance whether a phase is "off" vs
 *  "not-filled-in-yet" (Wren caught this). */
function PhaseBlock({
  number,
  label,
  hint,
  empty,
  connector,
  children,
}: {
  number: number;
  label: string;
  hint: string;
  empty: boolean;
  /** Which side of the pip the vertical rule extends to, tying this
   *  phase to its neighbour. */
  connector: "above" | "below" | "both";
  children: React.ReactNode;
}) {
  return (
    <View style={styles.phaseBlock}>
      <View style={styles.phaseHeaderRow}>
        <View style={styles.phaseRail}>
          {(connector === "above" || connector === "both") && (
            <View style={styles.phaseRailLineTop} />
          )}
          <View style={styles.phasePip}>
            <Text style={styles.phasePipText}>{number}</Text>
          </View>
          {(connector === "below" || connector === "both") && (
            <View style={styles.phaseRailLineBottom} />
          )}
        </View>
        <View style={styles.phaseHeaderText}>
          <View style={styles.phaseLabelRow}>
            <Text style={styles.sectionLabel}>{label}</Text>
            {empty && <Text style={styles.skippedTag}>Skipped</Text>}
          </View>
          <Text style={styles.phaseHint}>{hint}</Text>
        </View>
      </View>
      <View style={styles.phaseBody}>{children}</View>
    </View>
  );
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

/** Two-button segmented control. Replaces a free-text TextInput that
 *  was silently coercing unknown values to a default (Wren caught
 *  this; the editor shouldn't be the place a typo turns into a
 *  shrug). */
function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (next: T) => void;
}) {
  return (
    <View style={styles.segmented}>
      {options.map((opt, i) => {
        const selected = opt.value === value;
        const first = i === 0;
        const last = i === options.length - 1;
        return (
          <Pressable
            key={opt.value}
            onPress={() => onChange(opt.value)}
            style={[
              styles.segmentedItem,
              selected && styles.segmentedItemSelected,
              first && styles.segmentedItemFirst,
              last && styles.segmentedItemLast,
            ]}
          >
            <Text
              style={[styles.segmentedText, selected && styles.segmentedTextSelected]}
            >
              {opt.label}
            </Text>
          </Pressable>
        );
      })}
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
    fontSize: 11,
    color: colors.textMuted,
  },

  identityRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.lg,
    marginBottom: spacing.sm,
  },
  identityCol: { flex: 1, gap: spacing.xs },
  // System-input pattern: a 0.5px bottom rule that thickens to the
  // system accent on focus. Same affordance as Apple's "borderless"
  // inputs that still feel like inputs.
  nameInput: {
    fontFamily: fontFamily.ui,
    fontSize: 17,
    fontWeight: "600",
    color: colors.ink,
    borderBottomWidth: 0.5,
    borderBottomColor: colors.ruleSoft,
    paddingVertical: spacing.xs,
    backgroundColor: "transparent",
  },
  descInput: {
    fontFamily: fontFamily.ui,
    fontSize: 12,
    color: colors.textMuted,
    borderBottomWidth: 0.5,
    borderBottomColor: colors.ruleSoft,
    paddingVertical: spacing.xs,
    backgroundColor: "transparent",
  },

  sectionLabel: {
    fontFamily: fontFamily.mono,
    fontSize: 11,
    color: colors.textMuted,
    textTransform: "uppercase",
    marginTop: spacing.lg,
  },

  swatchRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  swatchHit: { padding: spacing.xs / 2 },
  swatchHitPressed: { opacity: 0.7 },
  swatchRing: {
    padding: spacing.xs / 2,
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: "transparent",
  },
  swatch: { width: 22, height: 22, borderRadius: 11 },

  // ─── Phase blocks ────────────────────────────────────────────────
  phaseBlock: {
    flexDirection: "column",
    marginTop: spacing.lg,
  },
  phaseHeaderRow: {
    flexDirection: "row",
    alignItems: "stretch",
    gap: spacing.md,
  },
  phaseRail: {
    width: 24,
    alignItems: "center",
  },
  phaseRailLineTop: {
    position: "absolute",
    top: 0,
    bottom: 24,
    width: 1,
    backgroundColor: colors.ruleSoft,
  },
  phaseRailLineBottom: {
    position: "absolute",
    top: 24,
    bottom: -spacing.lg,
    width: 1,
    backgroundColor: colors.ruleSoft,
  },
  phasePip: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.haBlueBg,
    alignItems: "center",
    justifyContent: "center",
  },
  phasePipText: {
    fontFamily: fontFamily.mono,
    fontSize: 11,
    fontWeight: "600",
    color: colors.haBlue,
  },
  phaseHeaderText: {
    flex: 1,
    gap: spacing.xs,
  },
  phaseLabelRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  skippedTag: {
    fontFamily: fontFamily.mono,
    fontSize: 11,
    color: colors.textMuted,
    backgroundColor: colors.bgSubtle,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.sm,
  },
  phaseHint: {
    fontFamily: fontFamily.ui,
    fontSize: 12,
    color: colors.textMuted,
    lineHeight: 18,
  },
  phaseBody: {
    paddingLeft: 24 + spacing.md, // align with the header text column
    gap: spacing.md,
    marginTop: spacing.sm,
  },

  advancedToggle: {
    alignSelf: "flex-start",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginTop: spacing.lg,
  },
  advancedToggleText: {
    fontFamily: fontFamily.ui,
    fontSize: 13,
    color: colors.sysAccent,
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
    fontSize: 12,
    color: colors.textMuted,
  },
  settingRight: { minWidth: 200, maxWidth: 320, alignItems: "stretch" },

  input: {
    width: "100%",
    fontFamily: fontFamily.ui,
    fontSize: 13,
    color: colors.ink,
    padding: spacing.sm,
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
    borderRadius: radius.sm,
    backgroundColor: colors.bgSubtle,
    borderWidth: 0.5,
    borderColor: colors.rule,
    minHeight: 120,
    textAlignVertical: "top",
  },

  segmented: {
    flexDirection: "row",
    width: "100%",
    borderRadius: radius.sm,
    backgroundColor: colors.bgSubtle,
    padding: 2,
  },
  segmentedItem: {
    flex: 1,
    paddingVertical: spacing.sm,
    alignItems: "center",
    borderRadius: radius.sm - 2,
  },
  segmentedItemFirst: {},
  segmentedItemLast: {},
  segmentedItemSelected: {
    backgroundColor: colors.bgElevated,
  },
  segmentedText: {
    fontFamily: fontFamily.ui,
    fontSize: 12,
    color: colors.textMuted,
  },
  segmentedTextSelected: {
    color: colors.ink,
    fontWeight: "500",
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
  errorToast: {
    padding: spacing.md,
    backgroundColor: colors.dangerBg,
    borderColor: colors.dangerBorder,
    borderWidth: 1,
    borderRadius: radius.sm,
  },
  errorTitle: {
    fontFamily: fontFamily.ui,
    fontSize: 13,
    fontWeight: "600",
    color: colors.danger,
  },
  errorMsg: {
    fontFamily: fontFamily.mono,
    fontSize: 12,
    color: colors.danger,
  },
});
