/**
 * MacOverlay — hotkey-driven PTT for macOS.
 *
 * Wired to:
 *   - useGlobalHotkey() — receives ⌃⌥Space down/up events from
 *     VoixHotkey native module.
 *   - NativeModules.VoixOverlay — the borderless NSPanel HUD (shown on
 *     down, hidden on up). The HUD is purely visual; the audio session
 *     runs through the JS BrowserAudioIoClient like any other surface,
 *     with intent: "dictate" per Decision 10.
 *   - BrowserAudioIoClient — opens the WS + mic via the same audio
 *     primitives as the in-app TalkButton, but with `intent: "dictate"`
 *     so the daemon returns transcript output instead of spoken reply.
 *   - VoixPaste (step 8+) — receives the transcript on session end,
 *     writes to clipboard + (if Accessibility granted) CGEventPost's
 *     Cmd+V into the previously focused app.
 *
 * Lives at the app root so the hotkey is registered for the lifetime
 * of the macOS process, regardless of which screen the user is on.
 *
 * This file is .native.tsx; the .tsx sibling is a no-op for web.
 */

import { useCallback, useEffect, useRef } from "react";
import { NativeModules } from "react-native";
import { BrowserAudioIoClient } from "../audio_io/client";
import { appInfo } from "../platform";
import { useGlobalHotkey } from "./useGlobalHotkey";

const WS_TOKEN_PATH = "api/auth/ws-token";

type VoixOverlayModule = {
  showOverlay(payload: { label?: string }): Promise<void>;
  hideOverlay(): Promise<void>;
  updateStatus(status: string): Promise<void>;
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

  const handleDown = useCallback(() => {
    if (clientRef.current) return;
    holdingRef.current = true;
    transcriptRef.current = "";

    const overlay = NativeModules.VoixOverlay as VoixOverlayModule | undefined;
    void overlay?.showOverlay({ label: "Listening…" }).catch(() => {});

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
    const client = clientRef.current;
    if (client) {
      client.stop();
    } else {
      // Press-too-fast: no client yet, just hide the overlay.
      const overlay = NativeModules.VoixOverlay as VoixOverlayModule | undefined;
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

  // Tear down on unmount.
  useEffect(() => {
    return () => {
      clientRef.current?.stop();
      const overlay = NativeModules.VoixOverlay as VoixOverlayModule | undefined;
      void overlay?.hideOverlay().catch(() => {});
    };
  }, []);

  return null;
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
