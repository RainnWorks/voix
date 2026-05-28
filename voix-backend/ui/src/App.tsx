import { useState } from "react";
import { Text, View } from "react-native";
import { AppShell, type Section } from "./components/AppShell";
import { ModeEditor } from "./modes/ModeEditor";
import { ModeList } from "./modes/ModeList";
import { colors, fontFamily, spacing } from "./lib/theme";

export function App() {
  const [section, setSection] = useState<Section>("modes");
  const [editingModeId, setEditingModeId] = useState<string | null>(null);

  let title: string;
  let toolbarRight: React.ReactNode = null;
  let content: React.ReactNode;

  if (section === "modes") {
    if (editingModeId === null) {
      title = "Modes";
      content = <ModeList onPickMode={setEditingModeId} />;
    } else {
      title = "Edit mode";
      content = <ModeEditor modeId={editingModeId} onClose={() => setEditingModeId(null)} />;
    }
  } else if (section === "conversations") {
    title = "Conversations";
    content = <Placeholder text="Conversation history view coming soon." />;
  } else {
    title = "Devices & settings";
    content = <Placeholder text="Device + settings view coming soon." />;
  }

  return (
    <AppShell
      section={section}
      onPickSection={(s) => {
        setSection(s);
        setEditingModeId(null);
      }}
      title={title}
      toolbarRight={toolbarRight}
    >
      {content}
    </AppShell>
  );
}

function Placeholder({ text }: { text: string }) {
  return (
    <View
      style={{
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
        padding: spacing.xl,
      }}
    >
      <Text
        style={{
          fontFamily: fontFamily.ui,
          fontSize: 13,
          color: colors.textMuted,
          fontStyle: "italic",
        }}
      >
        {text}
      </Text>
    </View>
  );
}
