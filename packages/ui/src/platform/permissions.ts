/**
 * Permissions — web impl (no-op).
 *
 * Web microphone access is gated by `navigator.mediaDevices.getUserMedia`
 * itself, which raises its own browser-chrome prompt. There's nothing
 * to do before that call, so the request just returns ok.
 *
 * Native sibling (`permissions.native.ts`) wraps
 * `AudioManager.requestRecordingPermissions()` (ships with
 * react-native-audio-api) so a denied permission surfaces to the UI
 * with a friendly recovery hint instead of leaving the TalkButton
 * stuck on "Connecting…" forever (Decision 13 risk 2).
 */

import type { Permissions } from "./types";

export const permissions: Permissions = {
  async requestMicrophone() {
    return { ok: true };
  },
  async getMicrophoneStatus() {
    // Web has no pre-prompt status; the browser-chrome dialog
    // handles permission inside getUserMedia. Settings UI shows
    // this row as "Browser-managed" via the consumer-side check.
    return { ok: true };
  },
  async openMicrophoneSettings() {
    // No platform handle to point the user at on web — the browser
    // owns the dialog.
    return false;
  },
};
