/**
 * Icon — web / default sibling.
 *
 * The native sibling (`Icon.native.tsx`) renders crisp monochrome,
 * SF-Symbol-equivalent vector glyphs via react-native-svg so the iOS
 * surface stops leaking colour-emoji where the system ships a symbol
 * (Marina v3 #1). On web the app already renders text glyphs and isn't
 * under the iOS native-glyph lens, so this fallback keeps the existing
 * lightweight rendering with no native dependency — Vite resolves THIS
 * file, never the react-native-svg one.
 */

import { StyleSheet, Text } from "react-native";
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

const GLYPH: Record<IconName, string> = {
  mic: "🎙",
  conversations: "▤",
  surfaces: "◇",
  settings: "⚙",
  phone: "▢",
  browser: "◍",
  laptop: "▭",
  unknown: "?",
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
    <Text style={[styles.glyph, { fontSize: size * 0.9, color }]}>{GLYPH[name]}</Text>
  );
}

const styles = StyleSheet.create({
  glyph: { textAlign: "center" },
});
