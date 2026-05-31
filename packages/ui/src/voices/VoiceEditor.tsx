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
import { Puck } from "../components/Puck.tsx";
import { type Voice, type VoiceUpdate, voicesApi } from "../lib/api.ts";
import {
  colors,
  fontFamily,
  modePalette,
  nearestSwatch,
  paletteOrder,
  radius,
  spacing,
} from "../lib/theme.ts";

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
  const isRealtime = voice.type === "realtime";
  const isDictation = voice.type === "dictation";
  const donePromptFilled = voice.donePrompt.trim().length > 0;

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

      {/* Voice type — the primary axis. Realtime is conversational
          and can optionally produce an output by tool-call; Dictation
          is plain mic-to-LLM. Surfacing this as the first decision
          stops the rest of the editor from looking like four equally
          valid prompt combinations. */}
      <SectionLabel>Voice type</SectionLabel>
      <View style={styles.typeRow}>
        <TypeOption
          selected={isRealtime}
          title="Realtime"
          subtitle="Back-and-forth voice chat. The model speaks back."
          onPress={() => {
            if (!isRealtime) {
              setVoice({ ...voice, type: "realtime" });
              void save({ type: "realtime" });
            }
          }}
        />
        <TypeOption
          selected={isDictation}
          title="Dictation"
          subtitle="One-shot. You talk, the model writes it down."
          onPress={() => {
            if (!isDictation) {
              setVoice({ ...voice, type: "dictation" });
              void save({ type: "dictation" });
            }
          }}
        />
      </View>

      {/* ─── Realtime layout: talking required, done optional ───────── */}
      {isRealtime && (
        <>
          <PhaseBlock
            number={1}
            label="When we're talking"
            requiredTag="Needed"
            hint="How the model behaves during the conversation — its persona, its rules, its register."
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
            requiredTag="If you want one"
            hint="If the conversation reaches a point where you want a written result, the model writes it using this prompt. Otherwise it's just a chat."
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
        </>
      )}

      {/* ─── Dictation layout: a single LLM-polish phase ─────────────── */}
      {isDictation && (
        <SimplePhase
          label="What the model does with your dictation"
          requiredTag="Needed"
          hint="You speak. We transcribe. The model shapes the result with this prompt. Leave empty for raw transcription, no rewrite."
        >
          <TextInput
            value={voice.donePrompt}
            onChangeText={(t) => setVoice({ ...voice, donePrompt: t })}
            onBlur={() => save({ donePrompt: voice.donePrompt })}
            multiline
            placeholder="Rewrite the transcript as a polished email…"
            placeholderTextColor={colors.textQuiet}
            style={styles.textarea}
          />
        </SimplePhase>
      )}

      <Pressable onPress={() => setAdvancedOpen((v) => !v)} style={styles.advancedToggle}>
        <Text style={styles.advancedToggleText}>
          {advancedOpen ? "Hide advanced" : "Show advanced"}
        </Text>
      </Pressable>

      {advancedOpen && isRealtime && (
        <>
          {/* Engine is the FIRST decision inside Advanced because it
              reframes everything below — Wren (audit) called this
              out: picking the engine changes how the voice sounds
              and paces replies, so the user needs to make this
              choice before they look at any plumbing. */}
          <SectionLabel>Conversation feel</SectionLabel>
          <SettingRow
            label="Pacing"
            desc="Live keeps the conversation flowing. Turn-based waits for you to finish, then answers. Changes how this voice sounds and paces replies."
            control={
              <Segmented
                value={voice.discussEngine ?? "realtime"}
                options={[
                  { value: "realtime", label: "Live" },
                  { value: "traditional", label: "Turn-based" },
                ]}
                onChange={(v) => {
                  const next = v as NonNullable<Voice["discussEngine"]>;
                  setVoice({ ...voice, discussEngine: next });
                  void save({ discussEngine: next });
                }}
              />
            }
          />

          {(voice.discussEngine ?? "realtime") === "realtime" && (
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
            </>
          )}

          {(voice.discussEngine ?? "realtime") === "traditional" && (
            <>
              <SectionLabel>Talking phase plumbing</SectionLabel>
              <SettingRow
                label="STT provider"
                desc="Where mic audio gets transcribed."
                control={
                  <Segmented
                    value={voice.sttProvider}
                    options={[
                      { value: "openai-realtime", label: "OpenAI" },
                      { value: "deepgram", label: "Deepgram" },
                    ]}
                    onChange={(v) => {
                      setVoice({ ...voice, sttProvider: v });
                      void save({ sttProvider: v });
                    }}
                  />
                }
              />
              <SettingRow
                label="STT model"
                desc="Provider-specific model. Empty = provider default."
                control={
                  <TextInput
                    value={voice.sttModel}
                    onChangeText={(t) => setVoice({ ...voice, sttModel: t })}
                    onBlur={() => save({ sttModel: voice.sttModel })}
                    placeholder="nova-3"
                    placeholderTextColor={colors.textQuiet}
                    style={styles.input}
                  />
                }
              />
              <SettingRow
                label="Chat model"
                desc="Per-turn chat model. Same provider as the output phase below."
                control={
                  <TextInput
                    value={voice.model}
                    onChangeText={(t) => setVoice({ ...voice, model: t })}
                    onBlur={() => save({ model: voice.model })}
                    placeholder="gpt-4o-mini"
                    placeholderTextColor={colors.textQuiet}
                    style={styles.input}
                  />
                }
              />
              {/* TTS provider + voice are deliberately hidden until
                  there's a real second choice (Wren audit). Today
                  Aura is the only impl; surfacing a text input
                  fishing for a string the user can't know is
                  worse than a sensible default. */}
            </>
          )}

          <SectionLabel>Output phase plumbing</SectionLabel>
          {!donePromptFilled && (
            <Text style={styles.sectionHint}>
              Disabled — this voice has no "When I'm done" prompt, so
              the model never produces a written result. Add one above
              to enable the output provider + model.
            </Text>
          )}
          <View style={!donePromptFilled && styles.disabled}>
            <OutputProviderRows voice={voice} setVoice={setVoice} save={save} />
          </View>
        </>
      )}

      {advancedOpen && isDictation && (
        <>
          <SectionLabel>STT pipeline</SectionLabel>
          <SettingRow
            label="STT provider"
            desc="Where mic audio gets transcribed."
            control={
              <Segmented
                value={voice.sttProvider}
                options={[
                  { value: "openai-realtime", label: "OpenAI" },
                  { value: "deepgram", label: "Deepgram" },
                ]}
                onChange={(v) => {
                  setVoice({ ...voice, sttProvider: v });
                  void save({ sttProvider: v });
                }}
              />
            }
          />
          <SettingRow
            label="STT model"
            desc="Provider-specific model name. Empty = provider default."
            control={
              <TextInput
                value={voice.sttModel}
                onChangeText={(t) => setVoice({ ...voice, sttModel: t })}
                onBlur={() => save({ sttModel: voice.sttModel })}
                placeholder="gpt-4o-mini-transcribe"
                placeholderTextColor={colors.textQuiet}
                style={styles.input}
              />
            }
          />

          <SectionLabel>Output phase plumbing</SectionLabel>
          <OutputProviderRows voice={voice} setVoice={setVoice} save={save} />
        </>
      )}
    </ScrollView>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <Text style={styles.sectionLabel}>{children}</Text>;
}

/** The primary Realtime / Dictation chooser. Wider than a segmented
 *  control because it also carries a subtitle that explains the
 *  trade. */
function TypeOption({
  selected,
  title,
  subtitle,
  onPress,
}: {
  selected: boolean;
  title: string;
  subtitle: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.typeOption,
        selected && styles.typeOptionSelected,
        pressed && !selected && styles.typeOptionPressed,
      ]}
    >
      <Text style={[styles.typeOptionTitle, selected && styles.typeOptionTitleSelected]}>
        {title}
      </Text>
      <Text style={styles.typeOptionSubtitle}>{subtitle}</Text>
    </Pressable>
  );
}

/** Numbered phase block — used for the two-phase Realtime layout.
 *  The HA-blue pip + the rail line tie phase 1 and phase 2 into one
 *  visual flow. `requiredTag` surfaces whether the phase is required
 *  ("Required") or optional ("Optional"). Empty-state is no longer
 *  shown — the type-driven layout already conveys what applies. */
function PhaseBlock({
  number,
  label,
  hint,
  requiredTag,
  connector,
  children,
}: {
  number: number;
  label: string;
  hint: string;
  requiredTag: "Needed" | "If you want one";
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
            <Text
              style={[
                styles.requiredTag,
                requiredTag === "If you want one" && styles.requiredTagOptional,
              ]}
            >
              {requiredTag}
            </Text>
          </View>
          <Text style={styles.phaseHint}>{hint}</Text>
        </View>
      </View>
      <View style={styles.phaseBody}>{children}</View>
    </View>
  );
}

/** Single-phase variant for Dictation. No pip + no rail because
 *  there's nothing to connect to. Same header shape as PhaseBlock
 *  for visual consistency. */
function SimplePhase({
  label,
  hint,
  requiredTag,
  children,
}: {
  label: string;
  hint: string;
  requiredTag: "Needed" | "If you want one";
  children: React.ReactNode;
}) {
  return (
    <View style={styles.phaseBlock}>
      <View style={styles.simplePhaseHeader}>
        <View style={styles.phaseLabelRow}>
          <Text style={styles.sectionLabel}>{label}</Text>
          <Text
            style={[
              styles.requiredTag,
              requiredTag === "If you want one" && styles.requiredTagOptional,
            ]}
          >
            {requiredTag}
          </Text>
        </View>
        <Text style={styles.phaseHint}>{hint}</Text>
      </View>
      <View style={styles.simplePhaseBody}>{children}</View>
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
      {options.map((opt) => {
        const selected = opt.value === value;
        return (
          <Pressable
            key={opt.value}
            onPress={() => onChange(opt.value)}
            style={[styles.segmentedItem, selected && styles.segmentedItemSelected]}
          >
            <Text style={[styles.segmentedText, selected && styles.segmentedTextSelected]}>
              {opt.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** The provider + model rows for the output-phase LLM call. Used by
 *  both Realtime (when donePrompt is non-empty) and Dictation (always)
 *  so factored out. */
function OutputProviderRows({
  voice,
  setVoice,
  save,
}: {
  voice: Voice;
  setVoice: (v: Voice) => void;
  save: (patch: VoiceUpdate) => Promise<void>;
}) {
  return (
    <>
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
  sectionHint: {
    fontFamily: fontFamily.ui,
    fontSize: 12,
    color: colors.textMuted,
    lineHeight: 18,
    marginTop: spacing.xs,
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

  // ─── Voice type chooser ──────────────────────────────────────────
  // Note on colour: Marina (audit) flagged that HA blue is the puck's
  // brand colour and should be reserved for "voix moments" — the puck
  // glyph, ACTIVE pills, the speaker tag. The type chooser is chrome,
  // so it lives on the system accent. The selected-state background
  // is a very soft tint of sysAccent (built inline below since the
  // theme doesn't carry a sysAccent-with-alpha token yet).
  typeRow: {
    flexDirection: "row",
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  typeOption: {
    flex: 1,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.bgSubtle,
    borderWidth: 0.5,
    borderColor: colors.rule,
    gap: spacing.sm,
  },
  typeOptionPressed: { opacity: 0.7 },
  typeOptionSelected: {
    // Soft sysAccent tint — matches the macOS pattern of selection
    // surfaces (NSTableView selection, control accent backgrounds).
    backgroundColor: "rgba(0,122,255,0.08)",
    borderColor: colors.sysAccent,
  },
  typeOptionTitle: {
    fontFamily: fontFamily.ui,
    fontSize: 15,
    fontWeight: "600",
    color: colors.ink,
  },
  typeOptionTitleSelected: {
    color: colors.sysAccent,
  },
  typeOptionSubtitle: {
    fontFamily: fontFamily.ui,
    fontSize: 12,
    color: colors.textMuted,
    lineHeight: 18,
  },

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
  // Tag sits next to the section label. Smaller + sentence-case so
  // it reads as metadata about the heading, not as a twin to it
  // (Marina + Wren both flagged the competing mono-uppercase).
  requiredTag: {
    fontFamily: fontFamily.ui,
    fontSize: 10,
    color: colors.sysAccent,
    backgroundColor: "rgba(0,122,255,0.08)",
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: radius.sm,
  },
  requiredTagOptional: {
    color: colors.textMuted,
    backgroundColor: colors.bgSubtle,
  },
  phaseHint: {
    fontFamily: fontFamily.ui,
    fontSize: 12,
    color: colors.textMuted,
    lineHeight: 18,
  },
  phaseBody: {
    paddingLeft: 24 + spacing.md,
    gap: spacing.md,
    marginTop: spacing.sm,
  },
  // SimplePhase keeps the same left gutter as PhaseBlock so the
  // textarea column doesn't jump 36 px when toggling Realtime ↔
  // Dictation. The header text aligns where the rail-anchored
  // PhaseBlock header text would.
  simplePhaseHeader: {
    paddingLeft: 24 + spacing.md,
    gap: spacing.xs,
  },
  simplePhaseBody: {
    paddingLeft: 24 + spacing.md,
    gap: spacing.md,
    marginTop: spacing.sm,
  },

  disabled: {
    opacity: 0.4,
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
  segmentedItemSelected: { backgroundColor: colors.bgElevated },
  segmentedText: {
    fontFamily: fontFamily.ui,
    fontSize: 12,
    color: colors.textMuted,
  },
  segmentedTextSelected: { color: colors.ink, fontWeight: "500" },

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
