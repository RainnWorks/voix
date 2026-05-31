import { useState } from "react";
import { AppShell, type Section } from "./components/AppShell";
import { ConversationDetail } from "./conversations/ConversationDetail";
import { ConversationList } from "./conversations/ConversationList";
import { MacAccessibilityBanner } from "./macos/MacAccessibilityBanner";
import { MacOverlay } from "./macos/MacOverlay";
import { SurfaceList } from "./surfaces/SurfaceList";
import { VoiceEditor } from "./voices/VoiceEditor";
import { VoiceList } from "./voices/VoiceList";

export function App() {
  const [section, setSection] = useState<Section>("voices");
  const [editingVoiceId, setEditingVoiceId] = useState<string | null>(null);
  const [openEntryId, setOpenEntryId] = useState<string | null>(null);

  let title: string;
  const toolbarRight: React.ReactNode = null;
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
    if (openEntryId === null) {
      title = "Conversations";
      content = <ConversationList onPickEntry={setOpenEntryId} />;
    } else {
      title = "Conversation";
      content = <ConversationDetail entryId={openEntryId} onClose={() => setOpenEntryId(null)} />;
    }
  } else {
    title = "Surfaces";
    content = <SurfaceList />;
  }

  return (
    <>
      {/* macOS hotkey overlay — no-op on web + iOS via the platform
          sibling pattern; on macOS it renders a borderless NSPanel HUD
          on ⌃⌥Space and dictates into the focused app. M22 Decision 4. */}
      <MacOverlay />
      <AppShell
        section={section}
        onPickSection={(s) => {
          setSection(s);
          setEditingVoiceId(null);
          setOpenEntryId(null);
        }}
        title={title}
        toolbarRight={toolbarRight}
      >
        {/* voix-considered pre-explanation for the macOS Accessibility
            ask. Renders only on macOS when trust is missing; no-op
            elsewhere. M22 fix — Yuki H6 + Marina UX-3. */}
        <MacAccessibilityBanner />
        {content}
      </AppShell>
    </>
  );
}
