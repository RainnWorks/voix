/**
 * Permissions — RN impl.
 *
 * Wraps `AudioManager.requestRecordingPermissions()` (ships with
 * `react-native-audio-api`, see Decision 10 — saves us pulling
 * `react-native-permissions`). Returns a typed result so the
 * TalkButton can render a recovery hint on deny instead of staying
 * stuck on "Connecting…" (Decision 13 risk 2).
 *
 * On iOS, the first call fires the `NSMicrophoneUsageDescription`
 * dialog and resolves with the user's choice. Subsequent calls
 * resolve immediately with the cached status — iOS will NOT re-prompt
 * after a denial (system behaviour). The orchestrator surfaces this
 * via PermissionResult.reason = "denied" so the UI can guide the
 * user to Settings → voix → Microphone.
 *
 * macOS: the audio-api module installs on macOS but AVAudioSession
 * APIs differ; we no-op (return ok) so the UI doesn't render a
 * spurious permission denial before the M22 macOS audio bridge
 * lands. Real macOS prompts arrive with M22.
 */

import { Platform } from "react-native";
import { AudioManager } from "react-native-audio-api";
import type { Permissions } from "./types";

export const permissions: Permissions = {
  async requestMicrophone() {
    if (Platform.OS === "macos") {
      return { ok: true };
    }
    try {
      const status = await AudioManager.requestRecordingPermissions();
      if (status === "Granted") return { ok: true };
      if (status === "Denied") return { ok: false, reason: "denied" };
      // 'Undetermined' — the user dismissed the dialog without
      // choosing. Treat as denied for the session; next start() will
      // re-prompt.
      return { ok: false, reason: "unknown", detail: status };
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      return { ok: false, reason: "unknown", detail };
    }
  },
};
