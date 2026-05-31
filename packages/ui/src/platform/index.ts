/**
 * Platform shim — barrel (M21 Decision 1).
 *
 * One import path for every consumer:
 *
 *     import { storage, appInfo, permissions, InlineAudioPlayer }
 *       from "../platform";
 *
 * Re-exports the per-primitive `.ts` files. Each of those has a
 * `.native.ts` sibling — Metro / Vite each pick the right one. This
 * barrel itself has NO `.native.ts` twin; both bundlers shake named
 * exports through it.
 *
 * Step 2 (this commit) wires the non-audio web impls (storage,
 * appInfo, permissions, inlineAudio, websocket). Audio capture +
 * playback land in step 4; native impls in steps 3 + 5.
 *
 * Why barrel + per-primitive split: keeps the surface stable while
 * letting Metro/Vite resolve each primitive's platform variant
 * independently. A monolithic platform.ts would force every web build
 * to parse RN imports (or vice-versa), defeating the suffix split.
 */

export type {
  AudioCapture,
  AudioCaptureFrameHandler,
  AudioCaptureStartOpts,
  AudioPlayback,
  AudioPlaybackStartOpts,
  StorageAdapter,
  AppInfo,
  Permissions,
  PermissionResult,
  HelloCapabilities,
  HelloClientInfo,
} from "./types";

export { storage } from "./storage";
export { appInfo } from "./appInfo";
export { permissions } from "./permissions";
export { InlineAudioPlayer } from "./inlineAudio";
export { PlatformWebSocket, type PlatformWebSocketInstance } from "./websocket";
export { createAudioCapture } from "./audioCapture";
export { createAudioPlayback } from "./audioPlayback";
