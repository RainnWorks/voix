/**
 * useGlobalHotkey — subscribes to the macOS ⌃⌥Space hotkey via the
 * VoixHotkey native module, dispatches onDown / onUp to the caller.
 *
 * Registered chord: ⌃⌥Space (default — Decision 2 of architecture-m22).
 * If another app owns the chord, register() resolves with ok:false; the
 * hook returns the same value so the consumer can render a hint
 * (M22 risk #2).
 *
 * The hotkey emits press AND release as separate events; this hook
 * relays both untransformed so the consumer can implement hold-to-talk
 * (overlay show / TalkButton.handlePressIn on down, hide / handlePressOut
 * on up).
 */

import { useEffect, useRef, useState } from "react";
import { NativeEventEmitter, NativeModules, Platform } from "react-native";

type VoixHotkeyModule = {
  register(): Promise<{ ok: boolean; chord: string; errorCode?: number }>;
  unregister(): Promise<void>;
};

export type HotkeyRegistration = {
  /** True if the chord was successfully bound; false if another app owns it. */
  ok: boolean;
  /** Human-readable chord string ("ctrl+opt+space"). */
  chord: string;
};

export function useGlobalHotkey(handlers: {
  onDown?: () => void;
  onUp?: () => void;
}): HotkeyRegistration | null {
  // Latch the handlers so re-renders don't re-subscribe.
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  const [registration, setRegistration] = useState<HotkeyRegistration | null>(null);

  useEffect(() => {
    if (Platform.OS !== "macos") return;
    const mod = NativeModules.VoixHotkey as VoixHotkeyModule | undefined;
    if (!mod) {
      // eslint-disable-next-line no-console
      console.warn(
        "useGlobalHotkey: VoixHotkey native module unavailable — rebuild macOS app",
      );
      return;
    }

    const emitter = new NativeEventEmitter(
      NativeModules.VoixHotkey as unknown as Parameters<typeof NativeEventEmitter>[0],
    );
    const downSub = emitter.addListener("voixHotkey.down", () => {
      handlersRef.current.onDown?.();
    });
    const upSub = emitter.addListener("voixHotkey.up", () => {
      handlersRef.current.onUp?.();
    });

    let cancelled = false;
    void mod
      .register()
      .then((result) => {
        if (cancelled) {
          void mod.unregister().catch(() => {});
          return;
        }
        setRegistration({ ok: result.ok, chord: result.chord });
        // eslint-disable-next-line no-console
        console.log(
          `voix hotkey: ${result.chord} (${result.ok ? "registered" : "conflict — chord owned by another app; rebind in Settings (M23)"})`,
        );
      })
      .catch((err) => {
        if (cancelled) return;
        // eslint-disable-next-line no-console
        console.warn("useGlobalHotkey: register failed", err);
        setRegistration({ ok: false, chord: "ctrl+opt+space" });
      });

    return () => {
      cancelled = true;
      downSub.remove();
      upSub.remove();
      void mod.unregister().catch(() => {});
    };
  }, []);

  return registration;
}
