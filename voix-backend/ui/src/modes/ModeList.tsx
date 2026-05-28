import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { type Mode, modesApi } from "../lib/api";

type Props = {
  onPickMode: (modeId: string) => void;
};

export function ModeList({ onPickMode }: Props) {
  const [modes, setModes] = useState<Mode[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    modesApi
      .list()
      .then((m) => {
        if (!cancelled) setModes(m);
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
        <Text style={styles.errorTitle}>Couldn’t load modes</Text>
        <Text style={styles.errorMsg}>{error}</Text>
      </View>
    );
  }
  if (!modes) {
    return (
      <View style={styles.loadingBox}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <View>
      {modes.map((m) => (
        <Pressable
          key={m.id}
          onPress={() => onPickMode(m.id)}
          style={(state) => {
            // react-native-web extends PressableStateCallbackType with
            // `hovered` for mouse-pointer environments. The native RN
            // type doesn't know about it; cast at the boundary.
            const s = state as { pressed: boolean; hovered?: boolean };
            return [
              styles.row,
              s.hovered && styles.rowHover,
              s.pressed && styles.rowPressed,
            ];
          }}
        >
          <View style={[styles.swatch, { backgroundColor: rgb(m.color) }]} />
          <View style={styles.body}>
            <View style={styles.titleRow}>
              <Text style={styles.name}>{m.name}</Text>
              {m.isBuiltin && <Text style={styles.builtinTag}>built-in</Text>}
            </View>
            <Text style={styles.meta}>
              {m.type}
              {m.postProcessPrompt ? ` · post-processed (${m.postProcessProvider})` : ""}
            </Text>
            {m.routingHint ? (
              <Text style={styles.hint} numberOfLines={1}>
                {m.routingHint}
              </Text>
            ) : null}
          </View>
          <Text style={styles.chev}>›</Text>
        </Pressable>
      ))}
    </View>
  );
}

function rgb([r, g, b]: [number, number, number]): string {
  return `rgb(${r},${g},${b})`;
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#fff",
    borderRadius: 10,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: "#eee",
    gap: 12,
  },
  rowHover: { borderColor: "#d0d0d0", backgroundColor: "#fafafa" },
  rowPressed: { backgroundColor: "#f0f0f0" },
  swatch: { width: 28, height: 28, borderRadius: 14, borderWidth: 1, borderColor: "#0001" },
  body: { flex: 1, gap: 2 },
  titleRow: { flexDirection: "row", alignItems: "baseline", gap: 8 },
  name: { fontSize: 15, fontWeight: "500", color: "#111" },
  builtinTag: {
    fontSize: 10,
    color: "#666",
    backgroundColor: "#f3f3f3",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 3,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  meta: { fontSize: 12, color: "#666" },
  hint: { fontSize: 12, color: "#999", fontStyle: "italic" },
  chev: { fontSize: 20, color: "#aaa", paddingHorizontal: 4 },
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
