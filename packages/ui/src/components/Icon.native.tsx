/**
 * Icon — iOS / macOS sibling.
 *
 * Renders monochrome, system-tinted vector glyphs that read as SF
 * Symbols instead of colour emoji. iOS native bars use SF Symbols; the
 * TalkButton carried a 🎙 emoji and the tab bar carried ⚙ / ◇ emoji —
 * the loudest "this is an RN app, not an iOS app" tell, on the product's
 * front door (Marina v3 #1). The Voices tab keeps the brand puck (the
 * one sanctioned custom glyph).
 *
 * Backed by react-native-svg (Fabric / new-arch) rather than a SF-Symbol
 * native module: bare RN 0.81 on the New Architecture has no clean
 * off-the-shelf SF Symbols component (react-native-sf-symbols doesn't
 * exist; expo-symbols/sweet-sfsymbols need the expo runtime;
 * react-native-sfsymbols is old-arch Paper and renders blank under
 * bridgeless). These paths are the SF-Symbol equivalents (mic.fill,
 * bubble.left.and.bubble.right → chat, dot.radiowaves.left.and.right →
 * sensors, gearshape → gear), tinted to match state.
 */

import Svg, { Path } from "react-native-svg";
import { colors } from "../lib/theme";

export type IconName = "mic" | "conversations" | "surfaces" | "settings";

// 24×24 viewBox path data. SF-Symbol-equivalent monochrome glyphs.
const PATHS: Record<IconName, string> = {
  // mic.fill — capsule body + cradle arc + stand.
  mic: "M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5-3c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z",
  // bubble.left.and.bubble.right → a rounded speech bubble with a tail.
  conversations:
    "M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z",
  // dot.radiowaves.left.and.right → centre dot with waves either side.
  surfaces:
    "M7.76 16.24l1.41-1.41C8.45 14.11 8 13.11 8 12s.45-2.11 1.17-2.83L7.76 7.76A6 6 0 0 0 6 12c0 1.66.67 3.16 1.76 4.24zm8.48 0A6 6 0 0 0 18 12a6 6 0 0 0-1.76-4.24l-1.41 1.41C15.55 9.89 16 10.89 16 12s-.45 2.11-1.17 2.83l1.41 1.41zM12 10c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zM4.93 19.07l1.41-1.41A8 8 0 0 1 4 12a8 8 0 0 1 2.34-5.66L4.93 4.93A10 10 0 0 0 2 12c0 2.76 1.12 5.26 2.93 7.07zm14.14 0A10 10 0 0 0 22 12a10 10 0 0 0-2.93-7.07l-1.41 1.41A8 8 0 0 1 20 12a8 8 0 0 1-2.34 5.66l1.41 1.41z",
  // gearshape — hub + eight teeth.
  settings:
    "M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.49.49 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.48.48 0 0 0-.48-.41h-3.84a.48.48 0 0 0-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96a.49.49 0 0 0-.59.22L2.74 8.87a.49.49 0 0 0 .12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32a.49.49 0 0 0-.12-.61l-2.01-1.58zM12 15.6a3.6 3.6 0 1 1 0-7.2 3.6 3.6 0 0 1 0 7.2z",
};

export function Icon({
  name,
  size = 20,
  color = colors.ink,
}: {
  name: IconName;
  size?: number;
  color?: string;
}) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d={PATHS[name]} fill={color} />
    </Svg>
  );
}
