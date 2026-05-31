import { View } from "react-native";
import { colors } from "../lib/theme.ts";

/**
 * The Voix puck icon. Two concentric shapes:
 *   • Body — ink-coloured rounded square. 22% radius of the side.
 *   • Voice — HA-blue (or mode colour) circle, 35% of body width,
 *     centered.
 *
 * Per voix-brand-guide.html: never separate the two parts, never
 * rotate, never add a face. The proportions are locked.
 *
 * The `color` prop overrides the inner circle for mode-coloured
 * pucks (the modes list / mode editor swatches). Default is HA blue.
 */
type Props = {
  /** Side length in pixels. Body is `size × size`, inner circle is
   *  35% of that. Radius is 22% of `size`. */
  size: number;
  /** Inner-circle colour. Defaults to HA blue. */
  color?: string;
  /** Body colour. Defaults to ink (dark). Override to white-ish for
   *  use on dark surfaces. */
  bodyColor?: string;
};

export function Puck({ size, color = colors.haBlue, bodyColor = colors.ink }: Props) {
  const inner = Math.round(size * 0.35);
  const radius = Math.round(size * 0.22);
  return (
    <View
      style={{
        width: size,
        height: size,
        backgroundColor: bodyColor,
        borderRadius: radius,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <View
        style={{
          width: inner,
          height: inner,
          borderRadius: inner / 2,
          backgroundColor: color,
        }}
      />
    </View>
  );
}
