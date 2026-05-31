/**
 * SwipeableRow — RN impl (A1 iOS nativeness).
 *
 * Wraps a row in `react-native-swipe-list-view`'s standalone `SwipeRow`
 * so a left-swipe reveals a single red iOS-destructive "Delete" action.
 * Pure-JS library (Animated + PanResponder, no native module), so it adds
 * no pod and builds the same on iOS + macOS — but the swipe affordance is
 * really only meaningful under touch.
 *
 * Behaviour mirrors UITableView swipe-to-delete: only a right-to-left
 * swipe is enabled (`disableRightSwipe`), it opens to a fixed 80pt action
 * column, and tapping Delete fires `onDelete` immediately (no secondary
 * confirm — the swipe itself is the deliberate gesture, matching iOS).
 */

import { Pressable, StyleSheet, Text, View } from "react-native";
import type { ReactNode } from "react";
import { SwipeRow } from "react-native-swipe-list-view";
import { colors, fontFamily } from "../lib/theme";

// iOS systemRed (#FF3B30) — the canonical destructive-action colour for a
// swipe Delete. Deliberately NOT the theme's `danger` token (#a02d20, an
// error-*text* red tuned for contrast on light error surfaces); a swipe
// action wants the bright system destructive fill, not the muted text red.
const SYSTEM_RED = "#FF3B30";
const ACTION_WIDTH = 80;

export function SwipeableRow({
  onDelete,
  deleteAccessibilityLabel = "Delete",
  children,
}: {
  onDelete: () => void;
  deleteAccessibilityLabel?: string;
  children: ReactNode;
}) {
  return (
    <SwipeRow
      disableRightSwipe
      rightOpenValue={-ACTION_WIDTH}
      stopRightSwipe={-ACTION_WIDTH}
      friction={9}
      tension={40}
    >
      {/* Hidden layer — revealed as the row slides left. */}
      <View style={styles.hidden}>
        <Pressable
          onPress={onDelete}
          accessibilityRole="button"
          accessibilityLabel={deleteAccessibilityLabel}
          style={({ pressed }) => [styles.deleteAction, pressed && styles.deletePressed]}
        >
          <Text style={styles.deleteLabel}>Delete</Text>
        </Pressable>
      </View>
      {/* Visible layer — the row itself. Opaque background so the hidden
          action only shows where the row has slid away from. */}
      <View style={styles.front}>{children}</View>
    </SwipeRow>
  );
}

const styles = StyleSheet.create({
  hidden: {
    flex: 1,
    flexDirection: "row",
    justifyContent: "flex-end",
    alignItems: "stretch",
  },
  deleteAction: {
    width: ACTION_WIDTH,
    backgroundColor: SYSTEM_RED,
    alignItems: "center",
    justifyContent: "center",
  },
  deletePressed: { opacity: 0.8 },
  deleteLabel: {
    fontFamily: fontFamily.ui,
    fontSize: 14,
    fontWeight: "600",
    color: "#ffffff",
  },
  // Opaque front so the row fully covers the destructive layer at rest.
  // Matches the Conversations surface (colors.bg) so the front is
  // invisible until the user swipes.
  front: { backgroundColor: colors.bg },
});
