/**
 * useResponsive — form-factor detection for the shared UI.
 *
 * The same component tree renders on a 393pt iPhone, an iPad, a macOS
 * window, and a wide HA-ingress browser tab. A two-column master-detail
 * split (fixed sidebar + content pane) is correct for the wide canvases
 * but wrong on a phone, where it squeezes the content pane to ~60% and
 * clips copy mid-word (M-MobileFit; soul §3 precondition 1: phone,
 * tablet and desktop are distinct canvases, not one layout scaled).
 *
 * `isPhone` is the single switch every layout consults: below the
 * breakpoint we collapse to a single column with a bottom tab bar;
 * at or above it we keep the master-detail split. Driven by
 * `useWindowDimensions` so it re-evaluates on rotation / window resize
 * (an iPad split-view or a dragged macOS window can cross the line at
 * runtime).
 */

import { useWindowDimensions } from "react-native";

/**
 * Phone/tablet breakpoint in points. 768 is the iPad portrait width and
 * the conventional tablet floor (Material's medium-width window, Apple's
 * regular size class boundary) — below it we're on a phone-class canvas.
 */
export const PHONE_BREAKPOINT = 768;

export type Responsive = {
  width: number;
  height: number;
  /** True on a phone-class canvas: render single column + bottom tabs. */
  isPhone: boolean;
};

export function useResponsive(): Responsive {
  const { width, height } = useWindowDimensions();
  return { width, height, isPhone: width < PHONE_BREAKPOINT };
}
