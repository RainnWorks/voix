/**
 * Safe-area shim — web impl (no insets).
 *
 * The web target renders inside an HA ingress iframe or a plain browser
 * tab — neither has a device status bar, Dynamic Island, or home
 * indicator to avoid, so every inset is zero and the provider is a
 * passthrough. The native sibling (`safeArea.native.tsx`) re-exports
 * the real `react-native-safe-area-context` so iOS keeps the wordmark
 * clear of the status bar / Island and the bottom nav clear of the
 * home indicator (M-MobileFit, soul §3 precondition 2).
 *
 * We re-export only the three primitives the UI consumes —
 * SafeAreaProvider, SafeAreaView, useSafeAreaInsets — so the web bundle
 * never pulls the native module. Same JSX compiles on both targets.
 */

import type { ReactNode } from "react";
import { View, type ViewProps } from "react-native";

export type Edge = "top" | "right" | "bottom" | "left";

export function SafeAreaProvider({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

export function SafeAreaView({
  edges,
  style,
  children,
  ...rest
}: ViewProps & { edges?: Edge[]; children?: ReactNode }) {
  // No device safe-area on web — `edges` is accepted for API parity
  // with the native SafeAreaView but contributes zero padding here.
  void edges;
  return (
    <View style={style} {...rest}>
      {children}
    </View>
  );
}

export function useSafeAreaInsets() {
  return { top: 0, right: 0, bottom: 0, left: 0 };
}
