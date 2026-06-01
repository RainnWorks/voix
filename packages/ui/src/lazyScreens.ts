/**
 * lazyScreens — web sibling (Vite / react-native-web).
 *
 * B10 swap #3. The web build was a single 386 KB chunk with no
 * code-splitting; the heaviest source files are route-gated screens that
 * are *not* on the landing path (VoiceEditor — the single biggest file,
 * SettingsScreen, ConversationDetail) plus Onboarding (which web never
 * even renders — `App.tsx` forces `onboardingDone = true` on web). Wrap
 * each in `React.lazy` so Vite emits them as separate async chunks; they
 * download only when the user navigates to them, shrinking the initial
 * payload. `App.tsx` wraps the screen-switch in a `<Suspense>` boundary
 * to satisfy the lazy contract.
 *
 * The native sibling (`lazyScreens.native.ts`) re-exports these directly
 * — native is one Hermes bundle, so lazy would only add a fallback flash
 * for no size win. Keep the two export surfaces identical.
 */

import { lazy } from "react";

export const VoiceEditor = lazy(() =>
  import("./voices/VoiceEditor").then((m) => ({ default: m.VoiceEditor })),
);

export const SettingsScreen = lazy(() =>
  import("./settings/SettingsScreen").then((m) => ({ default: m.SettingsScreen })),
);

export const ConversationDetail = lazy(() =>
  import("./conversations/ConversationDetail").then((m) => ({
    default: m.ConversationDetail,
  })),
);

export const Onboarding = lazy(() =>
  import("./onboarding/Onboarding").then((m) => ({ default: m.Onboarding })),
);

/**
 * Web never gates on onboarding (the daemon serves the document and the
 * browser owns the mic prompt), so `App.tsx` resolves `onboardingDone`
 * to `true` synchronously and never calls this. We provide a trivial
 * stub here purely so the import surface matches the native sibling —
 * importing the real implementation would drag `Onboarding.tsx` back
 * into the initial chunk and undo the split.
 */
export async function isOnboardingComplete(): Promise<boolean> {
  return true;
}
