import { Children, useEffect, useState } from "react";
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
import { Toast } from "../components/Toast";
import { type ProviderKind, type Voice, type VoiceUpdate, voicesApi } from "../lib/api";
import {
  colors,
  fontFamily,
  modePalette,
  nearestSwatch,
  paletteOrder,
  radius,
  spacing,
} from "../lib/theme";
import { useProviders } from "../lib/useProviders";
import { useResponsive } from "../lib/useResponsive";

/** Human-readable label for a registered provider name. Falls back to
 *  the name verbatim so an as-yet-unknown provider still renders
 *  something sensible in the segmented control. */
const PROVIDER_LABELS: Record<string, string> = {
  openai: "OpenAI",
  openrouter: "OpenRouter",
  deepgram: "Deepgram",
  aura: "Aura",
  "openai-realtime": "OpenAI",
};

function providerLabel(name: string): string {
  return PROVIDER_LABELS[name] ?? name;
}

type Props = {
  voiceId: string;
  onClose: () => void;
};

export function VoiceEditor({ voiceId, onClose }: Props) {
  const { isPhone } = useResponsive();
  const [voice, setVoice] = useState<Voice | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Save failures surface as a transient bottom toast (B1) — distinct
  // from `error`, which is the load-failure path that replaces the
  // whole editor with an error box.
  const [saveError, setSaveError] = useState<string | null>(null);
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
      setSaveError(null);
      setSaved(true);
    } catch (e) {
      // A network drop mid-save (the common case on a phone) gets a
      // friendly, actionable toast; a real HTTP error keeps its detail
      // so a misconfigured field is still debuggable (B1).
      const msg = e instanceof Error ? e.message : String(e);
      setSaveError(
        /^\d{3}\s/.test(msg)
          ? `Couldn't save. ${msg}`
          : "Couldn't save. Check your connection.",
      );
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
    <View style={styles.editorRoot}>
      {/* On a phone this editor is a pushed detail screen, so it carries
          its own iOS-style nav bar: a back affordance on the left, the
          screen title centred, and a "Done" button on the right (B15).
          Edits auto-save on blur — the iOS Settings pattern — so "Done"
          and the back chevron both just dismiss; there's no dirty draft
          to discard. The live "Saving…" status sits under the title so
          the user still gets save feedback without an inline status row.
          On wide canvases the desktop shell already draws a title bar,
          so we keep the lightweight inline back link there. */}
      {isPhone ? (
        <NavBar title="Edit voice" saving={!saved} onClose={onClose} />
      ) : null}
    <ScrollView contentContainerStyle={styles.scroll}>
      {!isPhone && (
        <View style={styles.topBar}>
          <Pressable onPress={onClose}>
            <Text style={styles.backLink}>Back to voices</Text>
          </Pressable>
          <Text style={styles.savedText}>{saved ? "Saved" : "Saving…"}</Text>
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
          {/* M23 — tone is the italic personality one-liner shown
              under the voice's name on every card. Sits between name
              and routingHint because tone is the *user-facing*
              identity copy; routingHint is the auto-router cue (M14)
              and reads as a different kind of metadata. 80-char cap
              keeps cards from wrapping (Marina line-height rule).
              Wren F2 (M23 fix-pass): visible char counter so the
              user knows when they're close to the cap — silent
              truncation at maxLength feels broken. */}
          <View style={styles.toneRow}>
            <TextInput
              value={voice.tone ?? ""}
              placeholder="A one-line personality snippet."
              placeholderTextColor={colors.textQuiet}
              maxLength={80}
              onChangeText={(t) => setVoice({ ...voice, tone: t })}
              onBlur={() =>
                save({ tone: (voice.tone ?? "").trim() || null })
              }
              style={[styles.toneInput, styles.toneInputFlex]}
              accessibilityLabel="Voice tone"
              accessibilityHint="A one-line personality snippet shown under the voice name on every card. Max 80 characters."
            />
            <Text style={styles.toneCounter}>
              {(voice.tone ?? "").length}/80
            </Text>
          </View>
          <TextInput
            value={voice.routingHint}
            placeholder="A one-line routing cue for auto-pick."
            placeholderTextColor={colors.textQuiet}
            onChangeText={(t) => setVoice({ ...voice, routingHint: t })}
            onBlur={() => save({ routingHint: voice.routingHint })}
            style={styles.descInput}
          />
        </View>
      </View>

      {/* Inline 12-swatch picker (E1 — reverts the B15 formSheet back to
          the original M04 design). A 1-tap action shouldn't cost a sheet
          open/pick/close round-trip: the palette sits right below the
          name field as a horizontal row of circles. Tapping a swatch
          autosaves immediately (same path as every other field) — no
          dirty state, the puck preview updates on the next render.
          The active swatch gets a coloured border on a wrapper View
          (NOT outline/boxShadow — Tom's "outlineStyle none banned"
          constraint). */}
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
              accessibilityRole="button"
              accessibilityLabel={entry.name}
              accessibilityState={{ selected }}
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
            hint="How the model behaves during the conversation. Its persona, its rules, its register."
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

      {/* Advanced disclosure (B15) — a full-width inset-grouped row with
          a chevron, the iOS grouped-table idiom, instead of a small
          link. Default view shows only Name / Tone / Type + the prompts;
          providers, models and the engine choice live behind this. 44pt
          tall, with an accessibility expanded state. */}
      <View style={styles.advancedGroup}>
        <Pressable
          onPress={() => setAdvancedOpen((v) => !v)}
          accessibilityRole="button"
          accessibilityState={{ expanded: advancedOpen }}
          accessibilityLabel="Advanced"
          accessibilityHint="Providers, models and pacing for this voice."
          style={({ pressed }) => [styles.advancedRow, pressed && styles.advancedRowPressed]}
        >
          <Text style={styles.advancedRowLabel}>Advanced</Text>
          <Text style={styles.advancedChevron}>{advancedOpen ? "⌄" : "›"}</Text>
        </Pressable>
      </View>

      {advancedOpen && isRealtime && (
        <>
          {/* Engine is the FIRST decision inside Advanced because it
              reframes everything below — Wren (audit) called this
              out: picking the engine changes how the voice sounds
              and paces replies, so the user needs to make this
              choice before they look at any plumbing. */}
          <GroupSection title="Conversation feel">
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
          </GroupSection>

          {(voice.discussEngine ?? "realtime") === "realtime" && (
            <GroupSection title="Talking phase plumbing">
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
            </GroupSection>
          )}

          {(voice.discussEngine ?? "realtime") === "traditional" && (
            <GroupSection title="Talking phase plumbing">
              <SettingRow
                label="STT provider"
                desc="Where mic audio gets transcribed."
                control={
                  <ProviderSegmented
                    kind="stt"
                    value={voice.sttProvider}
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
            </GroupSection>
          )}

          <GroupSection
            title="Output phase plumbing"
            hint={
              !donePromptFilled
                ? 'Disabled. This voice has no "When I\'m done" prompt, so the model never produces a written result. Add one above to enable the output provider + model.'
                : undefined
            }
            dimmed={!donePromptFilled}
          >
            <OutputProviderRows voice={voice} setVoice={setVoice} save={save} />
          </GroupSection>
        </>
      )}

      {advancedOpen && isDictation && (
        <>
          <GroupSection title="STT pipeline">
            <SettingRow
              label="STT provider"
              desc="Where mic audio gets transcribed."
              control={
                <ProviderSegmented
                  kind="stt"
                  value={voice.sttProvider}
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
          </GroupSection>

          <GroupSection title="Output phase plumbing">
            <OutputProviderRows voice={voice} setVoice={setVoice} save={save} />
          </GroupSection>
        </>
      )}
    </ScrollView>
      {/* Non-modal save-failure toast (B1) — floats over the form,
          auto-dismisses, doesn't shove the layout. */}
      {saveError && (
        <Toast message={saveError} onDismiss={() => setSaveError(null)} />
      )}
    </View>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <Text style={styles.sectionLabel}>{children}</Text>;
}

/** Inset-grouped settings section (B15) — the iOS UITableView grouped
 *  idiom that the Voices list already uses (Marina H2): an uppercase
 *  section header, then one rounded card holding the rows with hairline
 *  separators injected between them. Replaces the flat
 *  SectionLabel-then-bare-rows layout in Advanced. `hint` renders a
 *  caption under the header (e.g. the disabled-output explanation) and
 *  `dimmed` greys the card when the section is inactive. */
function GroupSection({
  title,
  hint,
  dimmed,
  children,
}: {
  title: string;
  hint?: string;
  dimmed?: boolean;
  children: React.ReactNode;
}) {
  const rows = Children.toArray(children).filter(Boolean);
  return (
    <View style={styles.groupSection}>
      <Text style={styles.groupHeader}>{title}</Text>
      {hint && <Text style={styles.groupHint}>{hint}</Text>}
      <View style={[styles.group, dimmed && styles.disabled]}>
        {rows.map((row, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: rows are static, order-stable
          <View key={i}>
            {i > 0 && <View style={styles.groupSeparator} />}
            {row}
          </View>
        ))}
      </View>
    </View>
  );
}

/** Phone-only iOS-style nav bar (B15). Left = back chevron + "Voices"
 *  (the standard pushed-screen back affordance), centre = title with a
 *  live "Saving…" subtitle, right = "Done". Both the back chevron and
 *  Done dismiss the editor — edits auto-save on blur, so there is no
 *  separate commit step. Hit targets are a full 44pt tall per HIG. */
function NavBar({
  title,
  saving,
  onClose,
}: {
  title: string;
  saving: boolean;
  onClose: () => void;
}) {
  return (
    <View style={styles.navBar}>
      <Pressable
        onPress={onClose}
        hitSlop={{ top: 8, bottom: 8, right: 12 }}
        accessibilityRole="button"
        accessibilityLabel="Back to voices"
        style={({ pressed }) => [styles.navSide, styles.navLeft, pressed && styles.navPressed]}
      >
        <Text style={styles.navChevron}>‹</Text>
        <Text style={styles.navBackText}>Voices</Text>
      </Pressable>

      <View style={styles.navTitleWrap} pointerEvents="none">
        <Text style={styles.navTitle} numberOfLines={1}>
          {title}
        </Text>
        {saving && <Text style={styles.navSubtitle}>Saving…</Text>}
      </View>

      <Pressable
        onPress={onClose}
        hitSlop={{ top: 8, bottom: 8, left: 12 }}
        accessibilityRole="button"
        accessibilityLabel="Done"
        style={({ pressed }) => [styles.navSide, styles.navRight, pressed && styles.navPressed]}
      >
        <Text style={styles.navDoneText}>Done</Text>
      </Pressable>
    </View>
  );
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
  const { isPhone } = useResponsive();
  // B15: on a phone a label + a 200pt-min control side-by-side leaves
  // ~150pt for the control on a 393pt screen — text inputs clip and
  // segmented controls cramp. Stack vertically so the control gets the
  // full width, the iOS grouped-form idiom. Wide canvases keep the
  // two-column row the desktop guide specifies.
  return (
    <View style={[styles.settingRow, isPhone && styles.settingRowPhone]}>
      <View style={[styles.settingLeft, isPhone && styles.settingLeftPhone]}>
        <Text style={styles.settingLabel}>{label}</Text>
        <Text style={styles.settingDesc}>{desc}</Text>
      </View>
      <View style={[styles.settingRight, isPhone && styles.settingRightPhone]}>{control}</View>
    </View>
  );
}

/** Segmented control whose options come from the daemon's provider
 *  registry (`GET /api/providers?kind=…`). Wave A #13 — replaces the
 *  hardcoded `[{value:"openai",label:"OpenAI"},{value:"openrouter",...}]`
 *  arrays in the editor. Shows a loading spinner while the registry
 *  query is in flight and a no-providers hint when the kind has no
 *  registered factories (typically missing API key in add-on options). */
function ProviderSegmented({
  kind,
  value,
  onChange,
}: {
  kind: ProviderKind;
  value: string;
  onChange: (next: string) => void;
}) {
  const { providers, loading, error } = useProviders(kind);

  if (loading) {
    return (
      <View style={styles.segmented}>
        <ActivityIndicator size="small" />
      </View>
    );
  }
  if (error) {
    return <Text style={styles.sectionHint}>Failed to load providers: {error}</Text>;
  }
  if (providers.length === 0) {
    return (
      <Text style={styles.sectionHint}>
        No {kind.toUpperCase()} providers configured. Add an API key in Add-on options.
      </Text>
    );
  }
  // Render the current value even if it isn't in the registry (e.g.
  // user typed it manually previously, or the relevant API key was
  // removed). Otherwise the editor would silently lose the selection.
  const options = providers.includes(value) ? providers : [value, ...providers];
  return (
    <Segmented
      value={value}
      options={options.map((p) => ({ value: p, label: providerLabel(p) }))}
      onChange={onChange}
    />
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
            accessibilityRole="button"
            accessibilityState={{ selected }}
            accessibilityLabel={opt.label}
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
          <ProviderSegmented
            kind="llm"
            value={voice.postProcessProvider}
            onChange={(v) => {
              setVoice({ ...voice, postProcessProvider: v });
              void save({ postProcessProvider: v });
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

  // ─── Phone nav bar (B15) ─────────────────────────────────────────
  navBar: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.sm,
    borderBottomWidth: 0.5,
    borderBottomColor: colors.ruleSoft,
    backgroundColor: colors.bgElevated,
  },
  navSide: {
    minHeight: 44,
    minWidth: 64,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.sm,
    borderRadius: radius.sm,
  },
  navLeft: { justifyContent: "flex-start" },
  navRight: { justifyContent: "flex-end" },
  navPressed: { opacity: 0.4 },
  navChevron: {
    fontFamily: fontFamily.ui,
    fontSize: 26,
    lineHeight: 28,
    color: colors.sysAccent,
    marginRight: 1,
  },
  navBackText: {
    fontFamily: fontFamily.ui,
    fontSize: 17,
    color: colors.sysAccent,
  },
  navDoneText: {
    fontFamily: fontFamily.ui,
    fontSize: 17,
    fontWeight: "600",
    color: colors.sysAccent,
  },
  navTitleWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  navTitle: {
    fontFamily: fontFamily.ui,
    fontSize: 16,
    fontWeight: "600",
    color: colors.ink,
  },
  navSubtitle: {
    fontFamily: fontFamily.mono,
    fontSize: 10,
    color: colors.textMuted,
  },

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
  // M23 — tone input. Italic 11pt HA-blue-text mirrors the consumer
  // styling on VoiceList / SurfaceList / ConversationList cards so
  // the user sees what their snippet will look like as they type.
  // Uses `haBlueText` for WCAG AA contrast (Priya B1 — M23 fix-pass).
  toneInput: {
    fontFamily: fontFamily.ui,
    fontSize: 11,
    fontStyle: "italic",
    color: colors.haBlueText,
    borderBottomWidth: 0.5,
    borderBottomColor: colors.ruleSoft,
    paddingVertical: spacing.xs,
    backgroundColor: "transparent",
  },
  // Wren F2 (M23 fix-pass): inline counter sits at the trailing edge
  // of the tone field. Same small-metadata gray + 11pt as the existing
  // textMuted rows.
  toneRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  toneInputFlex: { flex: 1 },
  toneCounter: {
    fontFamily: fontFamily.mono,
    fontSize: 11,
    color: colors.textMuted,
    minWidth: 36,
    textAlign: "right",
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

  swatchHitPressed: { opacity: 0.7 },

  // ─── Inline 12-swatch picker (E1 — reverted from B15 formSheet) ──
  // Horizontal wrapping row of circles below the name field. Gap is
  // the small-spacing token (≈ the 4–6pt the M04 design called for on
  // phone); it grows naturally on wider canvases as the row flows.
  // The active swatch shows a coloured BORDER on the wrapper ring —
  // not outline/boxShadow (Tom's "outlineStyle none banned" rule).
  swatchRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  swatchHit: { padding: spacing.xs / 2 },
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
    color: colors.haBlueText,
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

  // ─── Advanced disclosure + inset-grouped sections (B15) ──────────
  advancedGroup: {
    marginTop: spacing.lg,
    backgroundColor: colors.bgElevated,
    borderRadius: radius.lg,
    borderWidth: 0.5,
    borderColor: colors.rule,
    overflow: "hidden",
  },
  advancedRow: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  advancedRowPressed: { backgroundColor: colors.bgHover },
  advancedRowLabel: {
    fontFamily: fontFamily.ui,
    fontSize: 15,
    color: colors.ink,
  },
  advancedChevron: {
    fontSize: 20,
    color: colors.textQuiet,
    fontWeight: "400",
  },
  groupSection: { marginTop: spacing.lg },
  groupHeader: {
    fontFamily: fontFamily.mono,
    fontSize: 11,
    color: colors.textMuted,
    textTransform: "uppercase",
    marginBottom: spacing.sm,
    marginLeft: spacing.xs,
  },
  groupHint: {
    fontFamily: fontFamily.ui,
    fontSize: 12,
    color: colors.textMuted,
    lineHeight: 18,
    marginBottom: spacing.sm,
    marginLeft: spacing.xs,
  },
  group: {
    backgroundColor: colors.bgElevated,
    borderRadius: radius.lg,
    borderWidth: 0.5,
    borderColor: colors.rule,
    overflow: "hidden",
  },
  groupSeparator: {
    height: 0.5,
    backgroundColor: colors.ruleSoft,
    marginLeft: spacing.md,
  },

  settingRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    // B15: separators are now drawn by the enclosing GroupSection card,
    // so the row no longer carries its own bottom hairline.
    gap: spacing.lg,
  },
  settingRowPhone: {
    flexDirection: "column",
    alignItems: "stretch",
    gap: spacing.sm,
  },
  settingLeft: { flex: 1, gap: 2 },
  settingLeftPhone: { flex: 0 },
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
  settingRightPhone: { minWidth: 0, maxWidth: undefined, width: "100%" },

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
    // B15: cap the auto-grow height. A long prompt was letting a single
    // multiline TextInput balloon to ~580pt on a phone — one field
    // eating 1.5 screens and burying everything below it. The field
    // now tops out and scrolls internally, native-textarea style.
    maxHeight: 220,
    textAlignVertical: "top",
  },

  // ─── Segmented control (B15) ─────────────────────────────────────
  // Styled to read as a native iOS UISegmentedControl: a tinted track
  // (the iOS system tertiary-fill grey) with a white selected pill that
  // carries a soft shadow and sits inside a 2pt inset. Comfortable 40pt
  // height so each segment is an easy phone target.
  segmented: {
    flexDirection: "row",
    width: "100%",
    borderRadius: 9,
    backgroundColor: "rgba(118,118,128,0.12)",
    padding: 2,
  },
  segmentedItem: {
    flex: 1,
    minHeight: 36,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xs,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 7,
  },
  segmentedItemSelected: {
    backgroundColor: colors.bgElevated,
    shadowColor: "#000",
    shadowOpacity: 0.12,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  segmentedText: {
    fontFamily: fontFamily.ui,
    fontSize: 13,
    color: colors.textBody,
  },
  segmentedTextSelected: { color: colors.ink, fontWeight: "600" },

  // flex:1 wrapper so the save-failure Toast can position absolutely
  // against the editor's full content pane (B1).
  editorRoot: { flex: 1 },
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
