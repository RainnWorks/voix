import { useState } from "react";
import { Text, View } from "react-native";
import { AppShell, type Section } from "./components/AppShell";
import { colors, fontFamily, spacing } from "./lib/theme";
import { SurfaceList } from "./surfaces/SurfaceList";
import { VoiceEditor } from "./voices/VoiceEditor";
import { VoiceList } from "./voices/VoiceList";

export function App() {
  const [section, setSection] = useState<Section>("voices");
  const [editingVoiceId, setEditingVoiceId] = useState<string | null>(null);

  let title: string;
  let toolbarRight: React.ReactNode = null;
  let content: React.ReactNode;

  if (section === "voices") {
    if (editingVoiceId === null) {
      title = "Voices";
      content = <VoiceList onPickVoice={setEditingVoiceId} />;
    } else {
      title = "Edit voice";
      content = <VoiceEditor voiceId={editingVoiceId} onClose={() => setEditingVoiceId(null)} />;
    }
  } else if (section === "conversations") {
    title = "Conversations";
    content = <Placeholder text="Conversation history view coming soon." />;
  } else {
    title = "Surfaces";
    content = <SurfaceList />;
  }

  return (
    <AppShell
      section={section}
      onPickSection={(s) => {
        setSection(s);
        setEditingVoiceId(null);
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
