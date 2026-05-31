/**
 * MacOverlay — hotkey-driven PTT for macOS.
 *
 * Wired to:
 *   - useGlobalHotkey() — receives ⌃⌥Space down/up events from
 *     VoixHotkey native module.
 *   - NativeModules.VoixOverlay — the borderless NSPanel HUD (shown on
 *     down, hidden on up). The HUD now carries the voix brand: puck
 *     glyph + HA-blue + audio-level pulse (Marina BRAND-1). Audio
 *     session runs through the JS BrowserAudioIoClient like any other
 *     surface, with intent: "dictate" per Decision 10.
 *   - BrowserAudioIoClient — opens the WS + mic via the same audio
 *     primitives as the in-app TalkButton, but with `intent: "dictate"`
 *     so the daemon returns transcript output instead of spoken reply.
 *   - VoixPaste (step 8+) — receives the transcript on session end,
 *     writes to clipboard + (if Accessibility granted) CGEventPost's
 *     Cmd+V into the previously focused app.
 *   - VoixAudioCapture.frame event — subscribed to here for RMS
 *     metering only. The audio data still flows through the io_client
 *     as usual; we sample the frames passively for the brand pulse.
 *
 * Lives at the app root so the hotkey is registered for the lifetime
 * of the macOS process, regardless of which screen the user is on.
 *
 * This file is .native.tsx; the .tsx sibling is a no-op for web.
 */

import { useCallback, useEffect, useRef } from "react";
import { NativeEventEmitter, NativeModules } from "react-native";
import { BrowserAudioIoClient } from "../audio_io/client";
import { appInfo } from "../platform";
import { useGlobalHotkey } from "./useGlobalHotkey";

const WS_TOKEN_PATH = "api/auth/ws-token";

type VoixOverlayModule = {
  showOverlay(payload: { label?: string }): Promise<void>;
  hideOverlay(): Promise<void>;
  updateStatus(status: string): Promise<void>;
  /** Drives the brand pulse ring around the puck. 0..1; called as the
   *  mic streams in. Best-effort — older builds may not expose this. */
  setLevel?(level: number): Promise<void>;
};

type VoixPasteModule = {
  copyToClipboard(text: string): Promise<void>;
  paste(text: string): Promise<{ pasted: boolean; copied: boolean }>;
  isAccessibilityTrusted(): Promise<boolean>;
};

type VoixAudioPermissionsModule = {
  openAccessibilitySettings(): Promise<void>;
};

export function MacOverlay(): null {
  const clientRef = useRef<BrowserAudioIoClient | null>(null);
  const transcriptRef = useRef<string>("");
  const holdingRef = useRef<boolean>(false);
  const levelSubRef = useRef<{ remove: () => void } | null>(null);

  const handleDown = useCallback(() => {
    if (clientRef.current) return;
    holdingRef.current = true;
    transcriptRef.current = "";

    const overlay = NativeModules.VoixOverlay as VoixOverlayModule | undefined;
    void overlay?.showOverlay({ label: "Listening…" }).catch(() => {});

    // Marina BRAND-1: subscribe to mic frames to drive the puck pulse.
    // We tap the NATIVE event stream non-destructively (the io_client
    // gets its own listener), compute a quick RMS, smooth it, and push
    // to the overlay panel. Cheap — ~1024 samples per chunk.
    const audioMod = NativeModules.VoixAudioCapture as
      | { addListener?: unknown }
      | undefined;
    if (audioMod && overlay?.setLevel) {
      let smoothed = 0;
      const emitter = new NativeEventEmitter(
        NativeModules.VoixAudioCapture as unknown as Parameters<
          typeof NativeEventEmitter
        >[0],
      );
      levelSubRef.current = emitter.addListener(
        "voixAudioCapture.frame",
        (event: { base64: string }) => {
          const rms = rmsFromBase64Pcm16(event.base64);
          // Single-pole low-pass — the eye sees breathing, not jitter.
          smoothed = smoothed * 0.7 + rms * 0.3;
          // Map RMS to a visible 0..1 range. Voice typically lands
          // 0.02–0.15 RMS for normal speech; scale x4 and clamp.
          const level = Math.max(0, Math.min(1, smoothed * 4));
          void overlay.setLevel?.(level).catch(() => {});
        },
      );
    }

    void (async () => {
      try {
        const base = await appInfo.getApiBase();
        const tokenResp = await fetch(base + WS_TOKEN_PATH);
        if (!tokenResp.ok) throw new Error(`auth fetch ${tokenResp.status}`);
        const { token } = (await tokenResp.json()) as { token: string };
        if (!holdingRef.current) return;
        const client = new BrowserAudioIoClient({
          wsToken: token,
          intent: "dictate",
          onEvent: (ev) => {
            if (ev.type === "status") {
              const label = labelFor(ev.status);
              if (label) {
                void overlay?.updateStatus(label).catch(() => {});
              }
              if (ev.status === "idle" && clientRef.current) {
                // Session ended — produce the paste flow then hide.
                void onSessionEnded(transcriptRef.current);
                clientRef.current = null;
              }
            } else if (ev.type === "daemon") {
              // Daemon emits `transcript` events with the final
              // (canonical) transcript per role on the dictation path
              // (voix-backend/src/audio_io/protocol.ts:164). Accumulate
              // assistant + user transcripts (dictation only emits user
              // — assistant side stays empty, but be permissive in
              // case the daemon ever changes).
              const daemonEv = ev.event as {
                type?: string;
                role?: string;
                text?: string;
              };
              if (
                daemonEv?.type === "transcript" &&
                typeof daemonEv.text === "string" &&
                daemonEv.text.length > 0
              ) {
                // Append for multi-utterance sessions; user releases
                // ⌃⌥Space when they're done speaking.
                transcriptRef.current = transcriptRef.current
                  ? `${transcriptRef.current} ${daemonEv.text}`
                  : daemonEv.text;
              }
            } else if (ev.type === "error") {
              void overlay
                ?.updateStatus(`Error: ${(ev as { message?: string }).message ?? "unknown"}`)
                .catch(() => {});
            }
          },
        });
        clientRef.current = client;
        await client.start();
        if (!holdingRef.current) client.stop();
      } catch (err) {
        const overlay = NativeModules.VoixOverlay as VoixOverlayModule | undefined;
        void overlay?.updateStatus(
          `Error: ${err instanceof Error ? err.message : String(err)}`,
        ).catch(() => {});
        // Auto-hide after a beat so the user isn't stuck looking at a
        // dead overlay.
        setTimeout(() => {
          void overlay?.hideOverlay().catch(() => {});
        }, 2000);
        holdingRef.current = false;
      }
    })();
  }, []);

  const handleUp = useCallback(() => {
    holdingRef.current = false;
    // Drop the level subscription — the panel ring will fall to rest
    // size as soon as no more setLevel calls land.
    levelSubRef.current?.remove();
    levelSubRef.current = null;
    const overlay = NativeModules.VoixOverlay as VoixOverlayModule | undefined;
    void overlay?.setLevel?.(0).catch(() => {});
    const client = clientRef.current;
    if (client) {
      client.stop();
    } else {
      // Press-too-fast: no client yet, just hide the overlay.
      void overlay?.hideOverlay().catch(() => {});
    }
  }, []);

  const registration = useGlobalHotkey({
    onDown: handleDown,
    onUp: handleUp,
  });

  useEffect(() => {
    if (registration && !registration.ok) {
      // eslint-disable-next-line no-console
      console.warn(
        `voix overlay: hotkey ${registration.chord} is owned by another app; voix won't open on press.`,
      );
    }
  }, [registration]);

  // Log Accessibility trust state at boot (M22 risk #3 mitigation —
  // helps diagnose "I granted it and it still doesn't paste" by
  // recording the pre-paste state in the dev console).
  useEffect(() => {
    const paste = NativeModules.VoixPaste as VoixPasteModule | undefined;
    if (!paste) return;
    void paste
      .isAccessibilityTrusted()
      .then((trusted) => {
        // eslint-disable-next-line no-console
        console.log(
          `voix accessibility: ${
            trusted
              ? "trusted — paste will auto-fire"
              : "not trusted — paste will copy-only; grant in System Settings"
          }`,
        );
      })
      .catch(() => {});
  }, []);

  // M22 fix (Yuki B2 partial): NativeModules.Voix* boot diagnostic.
  // RCTNewArchEnabled=true in Info.plist while the bridges ship as
  // legacy RCT_EXTERN_MODULE — works today via 0.81's bridge-compat
  // shim but is a time bomb. Logging the available Voix* modules at
  // boot makes "JS thinks the native module is undefined" a one-line
  // diagnosis instead of a multi-hour goose chase. Paired with the
  // [voix] NewArch=... NSLog from AppDelegate.
  useEffect(() => {
    const voixModules = Object.keys(NativeModules).filter((k) =>
      k.startsWith("Voix"),
    );
    // eslint-disable-next-line no-console
    console.log(
      `voix native modules available: [${voixModules.join(", ")}]`,
    );
  }, []);

  // Tear down on unmount.
  useEffect(() => {
    return () => {
      clientRef.current?.stop();
      levelSubRef.current?.remove();
      levelSubRef.current = null;
      const overlay = NativeModules.VoixOverlay as VoixOverlayModule | undefined;
      void overlay?.hideOverlay().catch(() => {});
    };
  }, []);

  return null;
}

/**
 * Quick RMS over a base64-encoded PCM16 mono chunk. Used for the
 * brand pulse only — accuracy isn't critical, but allocations should
 * be minimised (this runs many times per second per session).
 *
 * The native side base64-encodes ~1024 Int16 samples per chunk. We
 * decode once, square + sum, divide by sample count, then sqrt and
 * scale to a 0..1 range (Int16 max = 32768 → divide).
 */
function rmsFromBase64Pcm16(b64: string): number {
  const atobFn = (
    globalThis as { atob?: (s: string) => string }
  ).atob;
  if (!atobFn) return 0;
  let bin: string;
  try {
    bin = atobFn(b64);
  } catch {
    return 0;
  }
  // Each Int16 = 2 bytes; loop over byte pairs.
  let sum = 0;
  let count = 0;
  for (let i = 0; i + 1 < bin.length; i += 2) {
    const lo = bin.charCodeAt(i);
    const hi = bin.charCodeAt(i + 1);
    let sample = (hi << 8) | lo;
    if (sample & 0x8000) sample = sample - 0x10000; // sign extend
    sum += sample * sample;
    count += 1;
  }
  if (count === 0) return 0;
  return Math.sqrt(sum / count) / 32768;
}

/**
 * Tracks whether we've already opened System Settings for the
 * Accessibility CTA this session. Avoids re-opening on every press
 * if Tom denies grant and keeps using the hotkey.
 */
let hasOpenedAccessibilitySettings = false;

/**
 * Steps 8-9: paste flow. Always copies to clipboard; auto-pastes via
 * CGEventPost iff Accessibility is trusted. When not trusted, opens
 * System Settings → Privacy → Accessibility (once per app session) so
 * the user can grant + relaunch.
 */
async function onSessionEnded(transcript: string): Promise<void> {
  const overlay = NativeModules.VoixOverlay as VoixOverlayModule | undefined;
  const paste = NativeModules.VoixPaste as VoixPasteModule | undefined;
  const perms = NativeModules.VoixAudioPermissions as
    | VoixAudioPermissionsModule
    | undefined;

  if (!transcript || transcript.trim() === "") {
    void overlay?.updateStatus("No transcript captured.").catch(() => {});
    setTimeout(() => void overlay?.hideOverlay().catch(() => {}), 1200);
    return;
  }

  if (!paste) {
    void overlay?.updateStatus("Captured").catch(() => {});
    setTimeout(() => void overlay?.hideOverlay().catch(() => {}), 1200);
    return;
  }

  try {
    const result = await paste.paste(transcript);
    if (result.pasted) {
      void overlay?.updateStatus("Pasted").catch(() => {});
    } else if (result.copied) {
      void overlay
        ?.updateStatus("Copied — grant Accessibility to auto-paste.")
        .catch(() => {});
      // Open Settings ONCE per app session — onward presses don't
      // re-open it, so Tom can keep using the copy-only flow.
      if (!hasOpenedAccessibilitySettings && perms) {
        hasOpenedAccessibilitySettings = true;
        // Slight delay so the overlay toast is visible before the
        // Settings window steals focus.
        setTimeout(() => {
          void perms.openAccessibilitySettings().catch(() => {});
        }, 800);
      }
    } else {
      void overlay?.updateStatus("Captured").catch(() => {});
    }
  } catch (err) {
    void overlay
      ?.updateStatus(
        `Error: ${err instanceof Error ? err.message : String(err)}`,
      )
      .catch(() => {});
  }
  setTimeout(() => void overlay?.hideOverlay().catch(() => {}), 1400);
}

function labelFor(status: string): string | null {
  switch (status) {
    case "connecting":
      return "Connecting…";
    case "ready":
    case "listening":
      return "Listening…";
    case "speaking":
      return "Receiving transcript…";
    case "closing":
      return "Wrapping up…";
    default:
      return null;
  }
}
