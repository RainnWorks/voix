/**
 * SwipeableRow — web / macOS sibling (A1 iOS nativeness).
 *
 * Swipe-to-delete is an iOS touch idiom; on the web (mouse/keyboard) and
 * the macOS shell it has no natural gesture, so this sibling is a plain
 * passthrough that just renders the row. The `.native.tsx` companion wraps
 * the row in `react-native-swipe-list-view`'s `SwipeRow` to reveal a red
 * destructive "Delete" action.
 *
 * Keeping the swipe dependency out of THIS file is deliberate: web (Vite /
 * react-native-web) resolves `./SwipeableRow` to this sibling, so the swipe
 * library never enters the web bundle.
 */

import type { ReactNode } from "react";

export function SwipeableRow({
  children,
}: {
  /** Fired when the revealed destructive action is tapped (native only). */
  onDelete: () => void;
  /** Accessibility label for the delete action (native only). */
  deleteAccessibilityLabel?: string;
  children: ReactNode;
}) {
  return <>{children}</>;
}
