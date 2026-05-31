/**
 * Haptics shim — web / macOS no-op (A1 iOS nativeness).
 *
 * Taptic feedback is an iOS-only affordance. The web build (react-native-web)
 * and the macOS shell have no Taptic Engine, so this sibling is a no-op. The
 * `.native.ts` companion drives `react-native-haptic-feedback` and guards on
 * `Platform.OS === "ios"` so importing it on macOS never touches the
 * (unlinked) native module.
 *
 * Keeping the native dependency out of THIS file is deliberate: web (Vite /
 * react-native-web) resolves `./haptics` to this sibling, so the haptics pod
 * never enters the web bundle.
 */

export const haptics = {
  /** Button physically depressed — a medium impact, the "you grabbed it" cue. */
  talkPressIn(): void {},
  /** Session reached the floor (mic live) — a success notification thunk. */
  talkSessionOpen(): void {},
};
