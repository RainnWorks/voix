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
// VoiceEditor + ConversationDetail are re-exported through `lazyScreens`
// (not their direct module paths) so the web build can code-split them
// (B10 swap #3). A direct static re-export here would pin them into the
// initial chunk and defeat the `React.lazy` split in App.tsx. The
// `.native` sibling re-exports them directly, so native is unchanged.
export { ConversationList } from "./conversations/ConversationList";
export { ConversationDetail, VoiceEditor } from "./lazyScreens";
export { TalkButton } from "./conversations/TalkButton";
export { InlineAudioPlayer } from "./platform";
export { SurfaceList } from "./surfaces/SurfaceList";
export {
  BrowserAudioIoClient,
  type BrowserClientEvent,
  type BrowserClientStatus,
  type BrowserClientOpts,
} from "./audio_io/client";

/**
 * Dev-only API surface (M21 step 6). Tom uses this from Metro's dev
 * console to set the daemon URL on a fresh device:
 *
 *   require("@voix/ui").__dev__.setApiBase("http://192.168.99.86:8765/")
 *
 * Persists via the platform's storage adapter (AsyncStorage on
 * native, localStorage on web). M23 ships a proper settings screen
 * and this surface can come back out.
 */
import { appInfo } from "./platform";
export const __dev__ = {
  setApiBase: (url: string) => appInfo.setApiBase(url),
  getApiBase: () => appInfo.getApiBase(),
};
