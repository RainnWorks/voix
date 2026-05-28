import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { type Mode, type ModeUpdate, modesApi } from "../lib/api";

type Props = {
  modeId: string;
  onClose: () => void;
};

export function ModeEditor({ modeId, onClose }: Props) {
  const [mode, setMode] = useState<Mode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    modesApi
      .get(modeId)
      .then((m) => {
        if (!cancelled) setMode(m);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [modeId]);

  const save = async (patch: ModeUpdate) => {
    if (!mode) return;
    setSaving(true);
    try {
      const next = await modesApi.update(mode.id, patch);
      setMode(next);
      setSavedAt(Date.now());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  if (error) {
    return (
      <View style={styles.errorBox}>
        <Text style={styles.errorTitle}>Error</Text>
        <Text style={styles.errorMsg}>{error}</Text>
        <Pressable onPress={onClose} style={styles.backBtn}>
          <Text style={styles.backBtnText}>‹ Back</Text>
        </Pressable>
      </View>
    );
  }
  if (!mode) {
    return (
      <View style={styles.loadingBox}>
        <ActivityIndicator />
      </View>
    );
  }

  const postProcEnabled = mode.postProcessPrompt.trim().length > 0;

  return (
    <View style={styles.root}>
      <View style={styles.headerRow}>
        <Pressable onPress={onClose} style={styles.backBtn}>
          <Text style={styles.backBtnText}>‹ Modes</Text>
        </Pressable>
        <Text style={styles.savedText}>
          {saving ? "Saving…" : savedAt ? `Saved ${secondsAgo(savedAt)}s ago` : ""}
        </Text>
      </View>

      <Field label="Name">
        <TextInput
          style={styles.input}
          value={mode.name}
          onChangeText={(t) => setMode({ ...mode, name: t })}
          onBlur={() => save({ name: mode.name })}
        />
      </Field>

      <Field label="Type">
        <Text style={styles.readonly}>{mode.type}</Text>
      </Field>

      <Field label={mode.type === "realtime" ? "System prompt" : "Pre-transcription prompt"}>
        <TextInput
          style={styles.textarea}
          multiline
          numberOfLines={10}
          value={mode.prompt}
          onChangeText={(t) => setMode({ ...mode, prompt: t })}
          onBlur={() => save({ prompt: mode.prompt })}
          placeholder={mode.type === "realtime" ? "You are voix…" : "(leave empty for raw)"}
        />
      </Field>

      {mode.type === "realtime" && (
        <>
          <Field label="Voice">
            <TextInput
              style={styles.input}
              value={mode.voice}
              onChangeText={(t) => setMode({ ...mode, voice: t })}
              onBlur={() => save({ voice: mode.voice })}
              placeholder="alloy / ash / ballad / coral / echo / marin / cedar"
            />
          </Field>
          <Field label="Model">
            <TextInput
              style={styles.input}
              value={mode.model}
              onChangeText={(t) => setMode({ ...mode, model: t })}
              onBlur={() => save({ model: mode.model })}
              placeholder="gpt-realtime-2"
            />
          </Field>
        </>
      )}

      {mode.type === "dictation" && (
        <>
          <View style={styles.row}>
            <Text style={styles.label}>Post-process with LLM</Text>
            <Switch
              value={postProcEnabled}
              onValueChange={(on) => {
                if (on && !mode.postProcessPrompt) {
                  // Restore a sensible default if turned back on after clearing.
                  const seed = mode.routingHint || "Polish the transcript for clarity.";
                  setMode({ ...mode, postProcessPrompt: seed });
                  void save({ postProcessPrompt: seed });
                } else if (!on) {
                  setMode({ ...mode, postProcessPrompt: "" });
                  void save({ postProcessPrompt: "" });
                }
              }}
            />
          </View>
          {postProcEnabled && (
            <>
              <Field label="Post-process system prompt">
                <TextInput
                  style={styles.textarea}
                  multiline
                  numberOfLines={8}
                  value={mode.postProcessPrompt}
                  onChangeText={(t) => setMode({ ...mode, postProcessPrompt: t })}
                  onBlur={() => save({ postProcessPrompt: mode.postProcessPrompt })}
                />
              </Field>
              <Field label="Provider">
                <TextInput
                  style={styles.input}
                  value={mode.postProcessProvider}
                  onChangeText={(t) =>
                    setMode({
                      ...mode,
                      postProcessProvider: t === "openrouter" ? "openrouter" : "openai",
                    })
                  }
                  onBlur={() => save({ postProcessProvider: mode.postProcessProvider })}
                  placeholder="openai or openrouter"
                />
              </Field>
              <Field label="Model">
                <TextInput
                  style={styles.input}
                  value={mode.postProcessModel}
                  onChangeText={(t) => setMode({ ...mode, postProcessModel: t })}
                  onBlur={() => save({ postProcessModel: mode.postProcessModel })}
                  placeholder="gpt-4o-mini"
                />
              </Field>
            </>
          )}
        </>
      )}

      <Field label="Routing hint (for auto-pick)">
        <TextInput
          style={styles.input}
          value={mode.routingHint}
          onChangeText={(t) => setMode({ ...mode, routingHint: t })}
          onBlur={() => save({ routingHint: mode.routingHint })}
          placeholder="Format speech as a casual chat message."
        />
      </Field>
    </View>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      {children}
    </View>
  );
}

function secondsAgo(t: number): number {
  return Math.max(0, Math.round((Date.now() - t) / 1000));
}

const styles = StyleSheet.create({
  root: { gap: 4 },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  backBtn: { padding: 8 },
  backBtnText: { color: "#1976d2", fontSize: 14 },
  savedText: { fontSize: 12, color: "#888" },
  field: {
    backgroundColor: "#fff",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#eee",
    padding: 12,
    marginBottom: 10,
    gap: 6,
  },
  label: { fontSize: 12, color: "#666", textTransform: "uppercase", letterSpacing: 0.4 },
  input: {
    fontSize: 14,
    padding: 8,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "#e0e0e0",
    backgroundColor: "#fafafa",
    color: "#111",
  },
  textarea: {
    fontSize: 13,
    padding: 10,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "#e0e0e0",
    backgroundColor: "#fafafa",
    color: "#111",
    minHeight: 120,
    textAlignVertical: "top",
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  },
  readonly: {
    fontSize: 14,
    color: "#666",
    paddingVertical: 4,
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: "#fff",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#eee",
    padding: 14,
    marginBottom: 10,
  },
  loadingBox: { padding: 40, alignItems: "center" },
  errorBox: {
    padding: 16,
    backgroundColor: "#fff3f0",
    borderColor: "#f5c6c0",
    borderWidth: 1,
    borderRadius: 8,
  },
  errorTitle: { fontWeight: "600", color: "#a02d20", marginBottom: 4 },
  errorMsg: { fontSize: 12, color: "#a02d20", fontFamily: "monospace" },
});
