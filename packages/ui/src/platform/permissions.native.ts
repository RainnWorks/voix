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

import { Linking, NativeModules, Platform } from "react-native";
import { AudioManager } from "react-native-audio-api";
import type { Permissions, PermissionResult } from "./types";

type VoixAudioPermissionsModule = {
  /** Read-only status getter; returns "granted" / "denied" / "restricted"
   *  / "undetermined". macOS-only. */
  getMicrophoneStatus(): Promise<string>;
  requestMicrophone(): Promise<string>;
  openAccessibilitySettings(): Promise<void>;
  /** M23 — opens Privacy → Microphone. Optional; older builds may
   *  not expose it (Settings shows a "not available" fallback). */
  openMicrophoneSettings?(): Promise<void>;
};

function audioPermsModule(): VoixAudioPermissionsModule | undefined {
  return (NativeModules as Record<string, unknown>)["VoixAudioPermissions"] as
    | VoixAudioPermissionsModule
    | undefined;
}

/** Translate the platform's verbatim status string into the shared
 *  `PermissionResult` shape. iOS audio-api + macOS Swift both produce
 *  the same vocabulary ("Granted" / "Denied" / "Restricted" /
 *  "Undetermined") modulo case — normalise to lower-case before
 *  branching. */
function resultFromStatus(status: string): PermissionResult {
  const norm = status.toLowerCase();
  if (norm === "granted") return { ok: true };
  if (norm === "denied") return { ok: false, reason: "denied" };
  if (norm === "restricted") return { ok: false, reason: "restricted" };
  if (norm === "undetermined") return { ok: false, reason: "undetermined", detail: status };
  return { ok: false, reason: "unknown", detail: status };
}

export const permissions: Permissions = {
  async requestMicrophone() {
    if (Platform.OS === "macos") {
      // macOS: use the Swift VoixAudioPermissions bridge if present
      // (M22 added it). Falls back to ok:true on builds that predate
      // the bridge so the M21 quick-path still works.
      const mod = audioPermsModule();
      if (mod) {
        try {
          const status = await mod.requestMicrophone();
          return resultFromStatus(status);
        } catch (err) {
          return {
            ok: false,
            reason: "unknown",
            detail: err instanceof Error ? err.message : String(err),
          };
        }
      }
      return { ok: true };
    }
    try {
      const status = await AudioManager.requestRecordingPermissions();
      if (status === "Granted") return { ok: true };
      if (status === "Denied") return { ok: false, reason: "denied" };
      // 'Undetermined' — pre-prompt on first call, or the user
      // dismissed the dialog without choosing. The TalkButton renders
      // a different "tap to allow" copy for this branch instead of
      // leaking the verbatim status (Wren FINDING-1).
      return { ok: false, reason: "undetermined", detail: status };
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      return { ok: false, reason: "unknown", detail };
    }
  },

  async getMicrophoneStatus(): Promise<PermissionResult> {
    if (Platform.OS === "macos") {
      const mod = audioPermsModule();
      if (!mod) return { ok: true };
      try {
        const status = await mod.getMicrophoneStatus();
        return resultFromStatus(status);
      } catch (err) {
        return {
          ok: false,
          reason: "unknown",
          detail: err instanceof Error ? err.message : String(err),
        };
      }
    }
    // iOS: AudioManager doesn't expose a non-prompting status. We use
    // requestRecordingPermissions which is idempotent — on second-
    // and-later calls iOS returns the cached status without showing
    // a dialog (Apple system behaviour). On a first cold launch this
    // WILL show the prompt; the Settings screen avoids calling it
    // during render and waits for the user's explicit "Re-prompt"
    // tap (architecture brief Decision 2).
    try {
      const status = await AudioManager.requestRecordingPermissions();
      if (status === "Granted") return { ok: true };
      if (status === "Denied") return { ok: false, reason: "denied" };
      return { ok: false, reason: "undetermined", detail: status };
    } catch (err) {
      return {
        ok: false,
        reason: "unknown",
        detail: err instanceof Error ? err.message : String(err),
      };
    }
  },

  async openMicrophoneSettings(): Promise<boolean> {
    if (Platform.OS === "macos") {
      const mod = audioPermsModule();
      if (!mod?.openMicrophoneSettings) return false;
      try {
        await mod.openMicrophoneSettings();
        return true;
      } catch {
        return false;
      }
    }
    // iOS: `app-settings:` deep-links into Settings → voix.
    try {
      await Linking.openURL("app-settings:");
      return true;
    } catch {
      return false;
    }
  },
};
