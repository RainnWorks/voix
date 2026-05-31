/**
 * @voix/ui — shared React UI for voix surfaces.
 *
 * Re-exports the bits consumers compose: the `App` root, design tokens
 * (theme), low-level brand glyphs, and the API client. Web (Vite via
 * react-native-web) and RN-CLI shells (M20) consume the same source —
 * `.native.ts` companion files (Step 4 of M19) handle platform splits.
 *
 * Stable surface:
 *   - `App`                        — full app shell + router
 *   - design tokens (colors, fontFamily, spacing, radius, modePalette,
 *     paletteOrder, nearestSwatch)
 *   - `Puck`, `Wordmark`           — brand glyphs
 *   - `AppShell`                   — sidebar + main shell + `Section`
 *   - section trees                — VoiceList, VoiceEditor,
 *                                    ConversationList, ConversationDetail,
 *                                    TalkButton, SurfaceList
 *   - apis                         — daemon HTTP client (voicesApi,
 *                                    devicesApi, surfacesApi,
 *                                    historyApi)
 *   - `BrowserAudioIoClient` + status/event types (M21 will split this
 *     into a platform shim; for M19 it's a direct re-export so the
 *     web target keeps working)
 *
 * What's deliberately NOT re-exported: internal helpers and styles.
 * Consumers go through the named components above.
 */

export { App } from "./App";
export * from "./lib/theme";
export * from "./lib/api";
export { Puck } from "./components/Puck";
export { Wordmark } from "./components/Wordmark";
export { AppShell, type Section } from "./components/AppShell";
export { VoiceList } from "./voices/VoiceList";
export { VoiceEditor } from "./voices/VoiceEditor";
export { ConversationList } from "./conversations/ConversationList";
export { ConversationDetail } from "./conversations/ConversationDetail";
export { TalkButton } from "./conversations/TalkButton";
export { InlineAudioPlayer } from "./conversations/InlineAudioPlayer";
export { SurfaceList } from "./surfaces/SurfaceList";
export {
  BrowserAudioIoClient,
  type BrowserClientEvent,
  type BrowserClientStatus,
  type BrowserClientOpts,
} from "./audio_io/client";
