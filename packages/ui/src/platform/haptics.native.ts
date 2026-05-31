/**
 * Haptics shim — RN impl (A1 iOS nativeness).
 *
 * Drives `react-native-haptic-feedback`'s Taptic Engine bridge. The pod is
 * iOS-only (`s.platform = :ios`), so react-native-macos autolinking skips it
 * — but the macOS shell still resolves THIS `.native.ts` sibling (no `.macos`
 * variant exists). We therefore hard-gate every call on `Platform.OS === "ios"`
 * so macOS never reaches into the unlinked native module.
 *
 * `ignoreAndroidSystemSettings: false` is the default and the right call — if
 * the user has turned system haptics off, we honour that rather than forcing a
 * buzz.
 */

import { Platform } from "react-native";
import { trigger } from "react-native-haptic-feedback";

const OPTS = { enableVibrateFallback: false, ignoreAndroidSystemSettings: false };

export const haptics = {
  /** Button physically depressed — a medium impact, the "you grabbed it" cue. */
  talkPressIn(): void {
    if (Platform.OS !== "ios") return;
    trigger("impactMedium", OPTS);
  },
  /** Session reached the floor (mic live) — a success notification thunk. */
  talkSessionOpen(): void {
    if (Platform.OS !== "ios") return;
    trigger("notificationSuccess", OPTS);
  },
};
