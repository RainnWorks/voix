/**
 * Inline audio player — RN impl (step 3 stub; step 5 fleshes out).
 *
 * Step 3 ships the same placeholder text the legacy
 * `conversations/InlineAudioPlayer.native.tsx` shipped under M19, so
 * existing surfaces don't regress. Step 5 wires the iOS fetch +
 * decodeAudioData → AudioBufferSource path via `react-native-audio-api`
 * once the dep lands; macOS keeps the placeholder until M22.
 *
 * Component name + props match the web impl so consumers can render
 * `<InlineAudioPlayer src={url} />` against either target.
 */

import { Platform, StyleSheet, Text } from "react-native";

type Props = {
  src: string;
};

export function InlineAudioPlayer({ src: _src }: Props) {
  const message =
    Platform.OS === "macos"
      ? "Playback: macOS audio lands in M22"
      : "Playback: iOS lands in M21 step 5";
  return <Text style={styles.placeholder}>{message}</Text>;
}

const styles = StyleSheet.create({
  placeholder: {
    fontSize: 13,
    fontStyle: "italic",
    color: "#8b8b90",
  },
});
