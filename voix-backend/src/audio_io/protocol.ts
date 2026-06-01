// Wire-protocol types for the audio-io port.
//
// The canonical definitions live in `@voix/protocol`
// (packages/protocol/src/audio-io.ts). This module re-exports them so
// the daemon's existing relative imports (`../audio_io/protocol.ts`)
// keep resolving without churn.
//
// M20a: the Docker build context is now the repo root, so the daemon
// resolves the `@voix/protocol` workspace package directly inside the
// image. The old parallel byte-for-byte copy + scripts/check-protocol-sync.sh
// guard are gone — there is one source of truth again.

export * from "@voix/protocol";
