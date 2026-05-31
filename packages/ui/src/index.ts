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

export { App } from "./App.tsx";
export * from "./lib/theme.ts";
export * from "./lib/api.ts";
export { Puck } from "./components/Puck.tsx";
export { Wordmark } from "./components/Wordmark.tsx";
export { AppShell, type Section } from "./components/AppShell.tsx";
export { VoiceList } from "./voices/VoiceList.tsx";
export { VoiceEditor } from "./voices/VoiceEditor.tsx";
export { ConversationList } from "./conversations/ConversationList.tsx";
export { ConversationDetail } from "./conversations/ConversationDetail.tsx";
export { TalkButton } from "./conversations/TalkButton.tsx";
export { InlineAudioPlayer } from "./conversations/InlineAudioPlayer.tsx";
export { SurfaceList } from "./surfaces/SurfaceList.tsx";
export {
  BrowserAudioIoClient,
  type BrowserClientEvent,
  type BrowserClientStatus,
  type BrowserClientOpts,
} from "./audio_io/client.ts";
