/**
 * @voix/protocol — wire types shared between daemon and clients.
 *
 * This package is types-only (no runtime native deps). Both bun and
 * Metro transpile from source; no build step. Consumers import like:
 *
 *   import { type AudioIoHello, parseHello } from "@voix/protocol";
 *
 * The single source-of-truth for the v1 audio I/O wire shapes; the
 * daemon's `voix-backend/src/audio_io/protocol.ts` is now a one-line
 * re-export of this module for backwards compatibility with the
 * existing relative imports inside the daemon.
 */
export * from "./audio-io.ts";
