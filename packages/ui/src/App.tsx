import { Suspense, useEffect, useState } from "react";
import { Linking, Platform } from "react-native";
import { AppShell, type Section } from "./components/AppShell";
import { DaemonBanner } from "./components/DaemonBanner";
import { ConversationList } from "./conversations/ConversationList";
import { KeyboardCaptureScreen } from "./conversations/KeyboardCaptureScreen";
// Route-gated screens are pulled through the platform-split `lazyScreens`
// module (B10 swap #3): web wraps them in `React.lazy` so Vite emits
// separate async chunks; native re-exports them directly (no lazy, no
// fallback flash). Web vs native resolution is handled by the
// `.native.ts` sibling — see lazyScreens.ts / lazyScreens.native.ts.
import {
  ConversationDetail,
  Onboarding,
  SettingsScreen,
  VoiceEditor,
  isOnboardingComplete,
} from "./lazyScreens";
import { MacAccessibilityBanner } from "./macos/MacAccessibilityBanner";
import { MacOverlay } from "./macos/MacOverlay";
import { SafeAreaProvider } from "./platform";
import { SurfaceList } from "./surfaces/SurfaceList";
import { VoiceList } from "./voices/VoiceList";

// Parse `voix://capture?session_id=<uuid>&return=<encoded url>` into
// our keyboard-bounce route shape. Returns null on a malformed URL or a
// URL that isn't ours — callers should fall through to whatever
// default the rest of the app does.
type KeyboardCaptureRoute = { sessionId: string; returnUrl: string };

function parseKeyboardCaptureUrl(raw: string): KeyboardCaptureRoute | null {
  // Accept both `voix://capture?…` and the malformed-but-recoverable
  // `voix:capture?…` (some keyboards drop the slashes). Anything else
  // is foreign.
  if (!raw.startsWith("voix:")) return null;
  const qIdx = raw.indexOf("?");
  if (qIdx === -1) return null;
  const path = raw.slice(0, qIdx);
  if (!/capture$/.test(path)) return null;
  const params = new URLSearchParams(raw.slice(qIdx + 1));
  const sessionId = params.get("session_id");
  const returnUrl = params.get("return");
  if (!sessionId || !returnUrl) return null;
  return { sessionId, returnUrl };
}

export function App() {
  // SafeAreaProvider supplies the inset context the phone shell + the
  // onboarding header read (no-op zero insets on web/macOS). Must wrap
  // the whole tree — onboarding and keyboard-capture return early
  // before AppShell, and they inset too.
  return (
    <SafeAreaProvider>
      <AppInner />
    </SafeAreaProvider>
  );
}

function AppInner() {
  const [section, setSection] = useState<Section>("voices");
  const [editingVoiceId, setEditingVoiceId] = useState<string | null>(null);
  const [openEntryId, setOpenEntryId] = useState<string | null>(null);
  // M24 step 4 — keyboard-bounce route. Set when the host receives
  // `voix://capture?session_id=...&return=...` from the voix keyboard
  // extension; cleared when capture finishes (step 6+ wires the
  // close path).
  const [keyboardCapture, setKeyboardCapture] =
    useState<KeyboardCaptureRoute | null>(null);
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

  // M24 step 4 — subscribe to Linking URL events on iOS. Cold-launch
  // case: getInitialURL returns the URL that started the process.
  // Warm case: the `url` event fires while the app is already running.
  // RN's Linking module relies on AppDelegate.application(_:open:)
  // forwarding to RCTLinkingManager (wired in step 4's AppDelegate
  // change). Web + macOS skip this hook — there's no keyboard
  // extension on those platforms.
  useEffect(() => {
    if (Platform.OS !== "ios") return;
    const handleUrl = (url: string | null) => {
      if (!url) return;
      const parsed = parseKeyboardCaptureUrl(url);
      if (parsed) setKeyboardCapture(parsed);
    };
    void Linking.getInitialURL().then(handleUrl);
    const sub = Linking.addEventListener("url", (e) => handleUrl(e.url));
    return () => sub.remove();
  }, []);

  if (onboardingDone === null) {
    // Brief pre-bootstrap moment; rendering nothing is preferable to
    // a flash of AppShell that then unmounts to show Onboarding.
    return null;
  }
  // M24 step 4 — keyboard-capture route preempts everything else,
  // including onboarding. If the keyboard bounced the user here, the
  // host app is acting purely as a recording surface — the user
  // doesn't want to be asked to onboard mid-dictation. Onboarding
  // resumes the next time they open voix from the home screen.
  if (keyboardCapture) {
    return (
      <KeyboardCaptureScreen
        sessionId={keyboardCapture.sessionId}
        returnUrl={keyboardCapture.returnUrl}
      />
    );
  }
  if (!onboardingDone) {
    // Suspense here is a no-op on native (Onboarding resolves
    // synchronously); on web this branch never runs (onboardingDone is
    // forced true), so the lazy Onboarding chunk is never fetched.
    return (
      <Suspense fallback={null}>
        <Onboarding onDone={() => setOnboardingDone(true)} />
      </Suspense>
    );
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
        onNewConversation={() => {
          // Front door to the killer flow: land on the Conversations
          // surface with the talk button ready (Wren F1/F3). The list
          // view (openEntryId === null) renders the TalkButton at top.
          setSection("conversations");
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
        {/* App-wide "can't reach the daemon" nudge (B1). Renders null
            while the daemon answers; on a network reach failure it drops
            a soft HA-blue banner above whatever screen is showing. */}
        <DaemonBanner />
        {/* Suspense boundary for the lazy, route-gated screens on web
            (VoiceEditor / SettingsScreen / ConversationDetail). On native
            these resolve synchronously so the fallback never shows. */}
        <Suspense fallback={null}>{content}</Suspense>
      </AppShell>
    </>
  );
}
