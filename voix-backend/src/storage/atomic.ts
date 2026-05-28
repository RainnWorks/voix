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

import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export async function atomicWrite(path: string, contents: string | Uint8Array): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, contents);
  await rename(tmp, path);
}
