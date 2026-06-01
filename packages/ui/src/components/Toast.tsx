/**
 * Toast — a non-modal, auto-dismissing iOS-style notice (B1).
 *
 * A dark translucent pill pinned to the bottom of its container. Unlike
 * the inline danger banner it doesn't shove layout around or block
 * interaction — it floats over the content and fades itself out, the way
 * iOS surfaces a transient "couldn't do that" message. Tap to dismiss
 * early; otherwise it clears after `duration` ms via `onDismiss`.
 *
 * The parent owns the message state and clears it from the `onDismiss`
 * callback, so the toast is fully controlled — re-rendering with a fresh
 * message restarts the timer (the keyed remount in the caller, or a new
 * message string, resets `useEffect`).
 *
 * Render this as the last child of a `flex: 1` container (it positions
 * absolutely against the nearest positioned ancestor). It uses
 * `pointerEvents="box-none"` on the wrapper so taps outside the pill
 * still reach the content beneath.
 */

import { useEffect } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { fontFamily, radius, spacing } from "../lib/theme";

type Props = {
  message: string;
  /** Fired on tap or after `duration` ms — the parent clears its state. */
  onDismiss: () => void;
  /** ms before the toast auto-dismisses. Default 4000. */
  duration?: number;
};

export function Toast({ message, onDismiss, duration = 4000 }: Props) {
  useEffect(() => {
    const t = setTimeout(onDismiss, duration);
    return () => clearTimeout(t);
  }, [onDismiss, duration]);

  return (
    <View style={styles.wrap} pointerEvents="box-none">
      <Pressable
        onPress={onDismiss}
        style={styles.toast}
        accessibilityRole="alert"
        accessibilityLiveRegion="assertive"
        accessibilityLabel={message}
        accessibilityHint="Dismiss this notice."
      >
        <Text style={styles.text}>{message}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: spacing.xl,
    alignItems: "center",
    paddingHorizontal: spacing.lg,
  },
  toast: {
    maxWidth: 360,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radius.xl,
    // iOS transient-notice idiom: a dark translucent pill, not the light
    // red danger surface. A save retry isn't a destructive error.
    backgroundColor: "rgba(30,30,32,0.92)",
  },
  text: {
    fontFamily: fontFamily.ui,
    fontSize: 13,
    fontWeight: "500",
    color: "#fff",
    textAlign: "center",
  },
});
