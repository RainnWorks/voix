/**
 * Permissions — RN impl.
 *
 * Wraps `AudioManager.requestRecordingPermissions()` (ships with
 * `react-native-audio-api`, see Decision 10 — saves us pulling
 * `react-native-permissions`). Returns a typed result so the
 * TalkButton can render a recovery hint on deny instead of staying
 * stuck on "Connecting…" (Decision 13 risk 2).
 *
 * Step 3 ships a thin wrapper that returns ok=true unconditionally.
 * Step 5 lands the audio-api dep + the real `AudioManager` call.
 * Until then the iOS sim's TalkButton would never reach mic capture
 * anyway (the audio impls throw); the no-op posture matches.
 *
 * macOS: same no-op; M22 lands the AVAudioSession bridge that
 * actually prompts for `NSMicrophoneUsageDescription`.
 */

import type { Permissions } from "./types";

export const permissions: Permissions = {
  async requestMicrophone() {
    // Step 5 will swap this for the real `AudioManager.requestRecordingPermissions()`
    // call once `react-native-audio-api` is in clients/app deps.
    return { ok: true };
  },
};
