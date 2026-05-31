/**
 * Inline audio player — native stub.
 *
 * Companion to `InlineAudioPlayer.tsx` (web). Metro picks this file
 * on iOS + macOS targets; Vite's `ignoreNativeSuffixes` plugin
 * filters it out of the web build.
 *
 * Real native audio playback lands in M22 alongside the audio capture
 * bridge (AVAudioEngine + AVPlayer on iOS, AVAudioPlayer on macOS).
 * For now we render a visible placeholder so the layout reads
 * "playback exists, just not yet" rather than a silent gap.
 */

import { StyleSheet, Text } from "react-native";

type Props = {
  src: string;
};

export function InlineAudioPlayer({ src: _src }: Props) {
  return <Text style={styles.placeholder}>Playback: implement in M22</Text>;
}

const styles = StyleSheet.create({
  placeholder: {
    fontSize: 13,
    fontStyle: "italic",
    color: "#8b8b90",
  },
});
