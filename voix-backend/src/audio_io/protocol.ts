/**
 * Audio I/O port — wire protocol (v1).
 *
 * Re-export shim. The canonical types live at `@voix/protocol`
 * (packages/protocol/src/audio-io.ts) as of M19; this file stays so
 * the daemon's existing relative imports (`../audio_io/protocol.ts`)
 * keep working. New code in any consumer — daemon, web UI, or RN
 * clients — should import from `@voix/protocol` directly.
 */
export * from "@voix/protocol";
