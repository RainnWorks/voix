/**
 * lazyScreens — native sibling (iOS / macOS).
 *
 * Native ships a single Hermes bytecode bundle, so code-splitting buys
 * nothing here and `React.lazy` would only add a Suspense round-trip
 * (and a fallback flash) for zero benefit. The native sibling therefore
 * re-exports the route-gated screens *directly* — they resolve
 * synchronously, the `<Suspense>` boundary in `App.tsx` never trips, and
 * the native UX is byte-for-byte unchanged.
 *
 * The web sibling (`lazyScreens.ts`) wraps the same four screens in
 * `React.lazy` so Vite emits them as separate async chunks, trimming the
 * initial web payload (B10 swap #3). Keep the export surface identical
 * across both files so `App.tsx` imports the same names regardless of
 * target.
 */

export { ConversationDetail } from "./conversations/ConversationDetail";
export { Onboarding, isOnboardingComplete } from "./onboarding/Onboarding";
export { SettingsScreen } from "./settings/SettingsScreen";
export { VoiceEditor } from "./voices/VoiceEditor";
