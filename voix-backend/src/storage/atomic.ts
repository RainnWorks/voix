/**
 * Atomic file writes — write to a temp file in the same dir, fsync,
 * then rename over the target.
 *
 * The rename is atomic on POSIX (and on the tmpfs HA Add-ons use for
 * /data on HAOS). Loaders never see a half-written file even if the
 * daemon crashes mid-write.
 *
 * Same pattern as the HA-side `_TranscriptStore._sync_write`. Lifting
 * it here means the storage layer stays portable — no dependency on
 * HA's executor model.
 */

import { randomBytes } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export async function atomicWrite(path: string, contents: string | Uint8Array): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  // Random suffix is mandatory: two concurrent atomicWrite calls within
  // the same millisecond otherwise generate the same tmp name and
  // race. ENOENT on rename in production was call B's writeFile
  // overwriting call A's tmp, then A's rename succeeding, then B's
  // rename firing on a path that no longer exists. Bun resolves
  // multiple writePartialTranscript() calls within a single ms easily.
  const tmp = `${path}.${process.pid}.${Date.now()}.${randomBytes(4).toString("hex")}.tmp`;
  await writeFile(tmp, contents);
  await rename(tmp, path);
}
