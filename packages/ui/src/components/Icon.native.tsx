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

export type IconName =
  | "mic"
  | "conversations"
  | "surfaces"
  | "settings"
  | "phone"
  | "browser"
  | "laptop"
  | "unknown";

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
  // iphone — rounded device body with the speaker notch line. Replaces
  // the 📱 emoji on phone-sat surfaces (Marina B13 #2 BLOCKER).
  phone:
    "M16 1H8C6.34 1 5 2.34 5 4v16c0 1.66 1.34 3 3 3h8c1.66 0 3-1.34 3-3V4c0-1.66-1.34-3-3-3zm-2 20h-4v-1h4v1zm3.25-3H6.75V4h10.5v14z",
  // globe — meridians + parallels. Replaces the 🌐 emoji on browser-tab.
  browser:
    "M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zm6.93 6h-2.95c-.32-1.25-.78-2.45-1.38-3.56 1.84.63 3.37 1.91 4.33 3.56zM12 4.04c.83 1.2 1.48 2.53 1.91 3.96h-3.82c.43-1.43 1.08-2.76 1.91-3.96zM4.26 14C4.1 13.36 4 12.69 4 12s.1-1.36.26-2h3.38c-.08.66-.14 1.32-.14 2 0 .68.06 1.34.14 2H4.26zm.82 2h2.95c.32 1.25.78 2.45 1.38 3.56-1.84-.63-3.37-1.9-4.33-3.56zm2.95-8H5.08c.96-1.66 2.49-2.93 4.33-3.56C8.81 5.55 8.35 6.75 8.03 8zM12 19.96c-.83-1.2-1.48-2.53-1.91-3.96h3.82c-.43 1.43-1.08 2.76-1.91 3.96zM14.34 14H9.66c-.09-.66-.16-1.32-.16-2 0-.68.07-1.35.16-2h4.68c.09.65.16 1.32.16 2 0 .68-.07 1.34-.16 2zm.25 5.56c.6-1.11 1.06-2.31 1.38-3.56h2.95c-.96 1.65-2.49 2.93-4.33 3.56zM16.36 14c.08-.66.14-1.32.14-2 0-.68-.06-1.34-.14-2h3.38c.16.64.26 1.31.26 2s-.1 1.36-.26 2h-3.38z",
  // laptopcomputer — screen over a base lip. Replaces the 💻 emoji on
  // laptop-mic surfaces.
  laptop:
    "M20 18c1.1 0 1.99-.9 1.99-2L22 6c0-1.1-.9-2-2-2H4c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2H0v2h24v-2h-4zM4 6h16v10H4V6z",
  // questionmark.circle — unrecognised kind. Replaces the bare typed "?"
  // (Marina B13 #2: an unknown kind should still resolve to a symbol).
  unknown:
    "M11 18h2v-2h-2v2zm1-16C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm0-14c-2.21 0-4 1.79-4 4h2c0-1.1.9-2 2-2s2 .9 2 2c0 2-3 1.75-3 5h2c0-2.25 3-2.5 3-5 0-2.21-1.79-4-4-4z",
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
