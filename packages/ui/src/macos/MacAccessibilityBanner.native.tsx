/**
 * MacAccessibilityBanner — voix-considered pre-explanation for
 * the macOS Accessibility ask (Yuki H6 + Marina UX-3).
 *
 * Background: voix uses the non-prompting variant of
 * AXIsProcessTrustedWithOptions for the boot-time check (the prompting
 * variant demands a quit + relaunch — hostile UX if fired unprompted).
 * So when Tom dictates for the first time, the system "I haven't asked
 * for Accessibility" wall lands without any voix-side prior signal.
 *
 * Marina's UX-3: "voix offers a user-friendly explanation BEFORE the
 * system prompt fires." Yuki H6: "there's no user-triggered prompting
 * code path." This banner closes both.
 *
 * Behaviour:
 *   - Rendered above the main app content on macOS only.
 *   - Visible only when Accessibility is NOT currently trusted.
 *   - "Grant access" button calls VoixPaste.requestAccessibility — the
 *     PROMPTING variant — which fires the official Apple modal that
 *     also flushes stale trust on debug rebuilds.
 *   - Polls trust state on focus + after the button press so the
 *     banner disappears the moment Tom grants the permission.
 *
 * No analogue on web / iOS — Accessibility is a macOS-only concept
 * here; the sibling .tsx returns null.
 */

import { useCallback, useEffect, useState } from "react";
import {
  NativeModules,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { colors } from "../lib/theme";

type VoixPasteModule = {
  isAccessibilityTrusted(): Promise<boolean>;
  requestAccessibility(): Promise<boolean>;
};

export function MacAccessibilityBanner(): React.ReactElement | null {
  const [trusted, setTrusted] = useState<boolean | null>(null);

  const refresh = useCallback(() => {
    if (Platform.OS !== "macos") return;
    const paste = NativeModules.VoixPaste as VoixPasteModule | undefined;
    if (!paste) return;
    void paste
      .isAccessibilityTrusted()
      .then((t) => setTrusted(t))
      .catch(() => setTrusted(null));
  }, []);

  useEffect(() => {
    refresh();
    // Re-check periodically — when Tom toggles in System Settings,
    // there's no notification back into the app. 4s is comfortable.
    const id = setInterval(refresh, 4000);
    return () => clearInterval(id);
  }, [refresh]);

  const onGrant = useCallback(() => {
    const paste = NativeModules.VoixPaste as VoixPasteModule | undefined;
    if (!paste) return;
    void paste
      .requestAccessibility()
      .then((nowTrusted) => setTrusted(nowTrusted))
      .catch(() => {
        // System prompt may not appear on every macOS version if the
        // trust has been previously declined — refresh state and let
        // the user retry from System Settings.
        refresh();
      });
  }, [refresh]);

  if (Platform.OS !== "macos") return null;
  if (trusted !== false) return null;

  return (
    <View style={styles.banner}>
      <View style={styles.dot} />
      <View style={styles.copy}>
        <Text style={styles.title}>voix can paste directly into your apps</Text>
        <Text style={styles.body}>
          macOS asks for Accessibility access — voix only uses it to send ⌘V
          when you release the hotkey. Until granted, dictation copies to
          the clipboard.
        </Text>
      </View>
      <Pressable style={styles.button} onPress={onGrant}>
        <Text style={styles.buttonText}>Grant access</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.haBlueBg,
    borderBottomColor: colors.rule,
    borderBottomWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 12,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.haBlue,
  },
  copy: {
    flex: 1,
  },
  title: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.ink,
    marginBottom: 2,
  },
  body: {
    fontSize: 12,
    color: colors.textBody,
    lineHeight: 16,
  },
  button: {
    backgroundColor: colors.ink,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 6,
  },
  buttonText: {
    color: "#ffffff",
    fontSize: 12,
    fontWeight: "600",
  },
});
