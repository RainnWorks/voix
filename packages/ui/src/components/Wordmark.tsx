import { StyleSheet, Text, View } from "react-native";
import { colors, fontFamily } from "../lib/theme";
import { Puck } from "./Puck";

/**
 * The wordmark: glyph + name + pronunciation. Per the marketing brand
 * guide the three are always together — `Voix /vwa/` with the puck
 * glyph. In the desktop chrome we render it small (14px glyph, 13px
 * wordmark) in the title bar / top nav.
 *
 * Typography note: the marketing brand uses Instrument Serif for the
 * wordmark. The desktop guide overrides this to the system UI font —
 * the app brand is sober, the website is the loud one. We follow the
 * desktop guide.
 */
type Props = {
  /** Glyph size in pixels. Default 14 (titlebar use). */
  size?: number;
  /** Show the pronunciation tag (/vwa/). Default true. */
  showPronunciation?: boolean;
};

export function Wordmark({ size = 14, showPronunciation = true }: Props) {
  return (
    <View style={styles.row}>
      <Puck size={size} />
      <Text style={[styles.name, { fontSize: size - 1 }]}>Voix</Text>
      {showPronunciation && <Text style={styles.pron}>/vwa/</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  name: {
    fontFamily: fontFamily.ui,
    fontWeight: "500",
    color: colors.ink,
    letterSpacing: -0.2,
  },
  pron: {
    fontFamily: fontFamily.mono,
    fontSize: 11,
    color: colors.textMuted,
  },
});
