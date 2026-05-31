/**
 * Safe-area shim — native impl (iOS + macOS).
 *
 * Re-exports the real `react-native-safe-area-context` (pod 5.8.0,
 * installed for both the iOS and macOS workspaces). On iOS this is what
 * keeps the voix wordmark below the status bar / Dynamic Island and the
 * bottom tab bar above the home indicator (M-MobileFit, soul §3
 * precondition 2). On macOS the insets resolve to zero — there's no
 * notch — so the same component is a harmless passthrough.
 *
 * The web sibling (`safeArea.tsx`) supplies zero-inset stand-ins so the
 * browser bundle never imports the native module.
 */

export {
  SafeAreaProvider,
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";

export type Edge = "top" | "right" | "bottom" | "left";
