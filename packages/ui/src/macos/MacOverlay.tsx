/**
 * MacOverlay — web sibling. No-op on web; the macOS hotkey overlay is
 * a macOS-only concept. Exported to satisfy `check-native-siblings.ts`.
 */

export function MacOverlay(): null {
  return null;
}
