import { useEffect, useState } from "react";
import { Platform } from "react-native";
import { AppShell, type Section } from "./components/AppShell";
import { ConversationDetail } from "./conversations/ConversationDetail";
import { ConversationList } from "./conversations/ConversationList";
import { MacAccessibilityBanner } from "./macos/MacAccessibilityBanner";
import { MacOverlay } from "./macos/MacOverlay";
import { Onboarding, isOnboardingComplete } from "./onboarding/Onboarding";
import { SettingsScreen } from "./settings/SettingsScreen";
import { SurfaceList } from "./surfaces/SurfaceList";
import { VoiceEditor } from "./voices/VoiceEditor";
import { VoiceList } from "./voices/VoiceList";

export function App() {
  const [section, setSection] = useState<Section>("voices");
  const [editingVoiceId, setEditingVoiceId] = useState<string | null>(null);
  const [openEntryId, setOpenEntryId] = useState<string | null>(null);
  // M23 Decision 4 — onboarding gate. Web always skips (the daemon
  // serves the document + the browser handles mic prompts itself);
  // iOS + macOS gate on the AsyncStorage flag. `null` is the
  // unresolved state — we render nothing while we check storage so
  // the user doesn't see a flash of AppShell pre-onboarding.
  const [onboardingDone, setOnboardingDone] = useState<boolean | null>(
    Platform.OS === "web" ? true : null,
  );
  useEffect(() => {
    if (Platform.OS === "web") return;
    void isOnboardingComplete().then((done) => setOnboardingDone(done));
  }, []);

  if (onboardingDone === null) {
    // Brief pre-bootstrap moment; rendering nothing is preferable to
    // a flash of AppShell that then unmounts to show Onboarding.
    return null;
  }
  if (!onboardingDone) {
    return <Onboarding onDone={() => setOnboardingDone(true)} />;
  }

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
  } else if (section === "settings") {
    title = "Settings";
    // Priya H1 — Reset onboarding row in Settings clears the
    // AsyncStorage flag and we bounce back to Welcome by flipping
    // our `onboardingDone` state to false. Native-only path; on web
    // the prop is a no-op.
    content = (
      <SettingsScreen
        onResetOnboarding={() => setOnboardingDone(false)}
      />
    );
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
