/**
 * Platform shim — barrel (M21 Decision 1).
 *
 * One import path for every consumer:
 *
 *     import { createAudioCapture, storage, appInfo, permissions }
 *       from "../platform";
 *
 * Re-exports the per-primitive `.ts` files. Each of those has a
 * `.native.ts` sibling — Metro / Vite each pick the right one. This
 * barrel itself has NO `.native.ts` twin; both bundlers shake named
 * exports through it.
 *
 * Step 1 (this commit) only re-exports the TYPES — value re-exports
 * (createAudioCapture, storage, etc.) land alongside their impls in
 * steps 2-4. Keeping the type-only barrel in step 1 means typecheck
 * passes everywhere from commit 1 onward.
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
