/**
 * useGlobalHotkey — web sibling. No-op on web; the global hotkey is a
 * macOS-only concept (Decision 2 of architecture-m22.md). Exported for
 * the bundler's resolution layer (`check-native-siblings.ts` rule)
 * and to keep imports unconditional in consumers that target both web
 * and macOS from the same file (which today is nobody, but the rule
 * still applies).
 */

export type HotkeyRegistration = {
  ok: boolean;
  chord: string;
};

export function useGlobalHotkey(_handlers: {
  onDown?: () => void;
  onUp?: () => void;
}): HotkeyRegistration | null {
  return null;
}
