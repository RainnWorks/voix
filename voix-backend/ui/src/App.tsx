import { useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { ModeEditor } from "./modes/ModeEditor";
import { ModeList } from "./modes/ModeList";

export function App() {
  const [editingModeId, setEditingModeId] = useState<string | null>(null);

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Text style={styles.title}>voix</Text>
        <Text style={styles.subtitle}>
          {editingModeId ? "edit mode" : "modes"}
        </Text>
      </View>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        {editingModeId === null ? (
          <ModeList onPickMode={setEditingModeId} />
        ) : (
          <ModeEditor modeId={editingModeId} onClose={() => setEditingModeId(null)} />
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#fafafa" },
  header: {
    paddingHorizontal: 20,
    paddingTop: 24,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
    backgroundColor: "#fff",
  },
  title: { fontSize: 22, fontWeight: "600", color: "#111" },
  subtitle: { fontSize: 13, color: "#666", marginTop: 2 },
  scroll: { flex: 1 },
  scrollContent: { padding: 16, maxWidth: 880, width: "100%", alignSelf: "center" },
});
