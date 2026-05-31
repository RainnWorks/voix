/**
 * Single-shot capture flow invoked by the voix keyboard extension.
 *
 * Route shape: keyboard opens `voix://capture?session_id=<uuid>&return=
 * voix-keyboard%3A%2F%2Fdone%3Fsession_id%3D<uuid>` and the host's
 * Linking handler mounts this screen with the parsed params. The host
 * picks up the pending session from the App Group shared container,
 * runs a single dictate-intent capture using the user's default
 * dictation voice, writes the polished transcript back to the shared
 * container, and finally calls UIApplication.shared.open(returnUrl)
 * so iOS re-foregrounds the previous app (Notes, Mail, etc.) where
 * the voix keyboard's viewDidAppear picks up the result.
 *
 * Step 4 (this commit) — placeholder screen only: it acknowledges the
 * route, shows session_id + return URL, and gives a manual "Done" /
 * "Cancel" pair so we can wire the URL handler smoke without yet
 * pulling in TalkButton's capture state. Step 6 lands the real
 * auto-capture flow.
 */

import { StyleSheet, Text, View } from "react-native";
import { colors, fontFamily, spacing } from "../lib/theme";

export function KeyboardCaptureScreen({
  sessionId,
  returnUrl,
}: {
  sessionId: string;
  returnUrl: string;
}) {
  return (
    <View style={styles.container}>
      <Text style={styles.heading}>Keyboard capture</Text>
      <Text style={styles.body}>session_id: {sessionId}</Text>
      <Text style={styles.body}>return: {returnUrl}</Text>
      <Text style={styles.hint}>
        Step 4 placeholder. Step 6 replaces this with an auto-starting
        dictate capture using the default dictation voice.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: spacing.xl,
    backgroundColor: colors.bg,
    justifyContent: "center",
    gap: spacing.md,
  },
  heading: {
    fontFamily: fontFamily.ui,
    fontSize: 24,
    color: colors.ink,
  },
  body: {
    fontFamily: fontFamily.mono,
    fontSize: 12,
    color: colors.textQuiet,
  },
  hint: {
    fontFamily: fontFamily.ui,
    fontSize: 11,
    color: colors.textQuiet,
    fontStyle: "italic",
    marginTop: spacing.md,
  },
});
