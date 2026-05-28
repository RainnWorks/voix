/**
 * Per-device active-mode tracker.
 *
 * Today the puck reads its mode_id from NVS (set via HA's
 * `voix_set_state` api.action). Persisting on the puck means cold
 * boots come up in the last mode. The daemon also wants to know the
 * current mode for each device for two reasons:
 *
 *   1. UI shows the active mode in the mode list.
 *   2. UI "Activate" button changes the current mode without waiting
 *      for an HA round-trip (the daemon updates its map, the next
 *      wake-word session reads it).
 *
 * Persisted at `/data/voix/devices.json`. Mutated in-process from the
 * /api/devices routes; refreshed when pucks send hellos.
 */

import { readFile } from "node:fs/promises";
import { log } from "../log.ts";
import { DEFAULT_MODE_ID } from "../modes/builtins.ts";
import { atomicWrite } from "../storage/atomic.ts";
import { dataPath } from "../storage/paths.ts";

export type DeviceRecord = {
  /** Stable puck identifier (the ESPHome device name, e.g.
   *  `home-assistant-voice-095e4e`). */
  deviceId: string;
  /** Optional human label for the puck. */
  friendlyName?: string;
  /** Current mode_id. Resolves to DEFAULT_MODE_ID when unset. */
  modeId: string;
  /** Date.now() of the last connection we saw — refreshed on hello. */
  lastSeenMs: number;
};

const FILE = dataPath("devices.json");

const cache = new Map<string, DeviceRecord>();
let loaded = false;

export async function loadDevices(): Promise<void> {
  if (loaded) return;
  try {
    const raw = await readFile(FILE, "utf8");
    const parsed = JSON.parse(raw) as DeviceRecord[];
    if (Array.isArray(parsed)) {
      for (const d of parsed) {
        if (d && typeof d.deviceId === "string") cache.set(d.deviceId, d);
      }
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      log.warn("devices: failed to read devices.json:", err);
    }
  }
  loaded = true;
  log.info(`devices: loaded ${cache.size} device records`);
}

async function persist(): Promise<void> {
  const arr = Array.from(cache.values());
  await atomicWrite(FILE, JSON.stringify(arr, null, 2));
}

/** Called from PuckSession at hello time so we have an up-to-date
 *  "lastSeen". Records the mode_id from the hello if present. */
export async function recordSeen(
  deviceId: string,
  hint: { friendlyName?: string; modeId?: string },
): Promise<void> {
  const prev = cache.get(deviceId);
  const next: DeviceRecord = {
    deviceId,
    friendlyName: hint.friendlyName ?? prev?.friendlyName,
    modeId: hint.modeId || prev?.modeId || DEFAULT_MODE_ID,
    lastSeenMs: Date.now(),
  };
  cache.set(deviceId, next);
  await persist();
}

export function listDevices(): DeviceRecord[] {
  return Array.from(cache.values()).sort((a, b) => b.lastSeenMs - a.lastSeenMs);
}

export function getDevice(deviceId: string): DeviceRecord | undefined {
  return cache.get(deviceId);
}

/** Set a new mode for a device. Persists immediately. If you want the
 *  change to propagate to the puck before its next wake-word
 *  (re-pushing via HA's voix_set_state), do that at the call site —
 *  this function is just the daemon-side record-keeper. */
export async function setDeviceMode(deviceId: string, modeId: string): Promise<DeviceRecord> {
  const prev = cache.get(deviceId);
  const next: DeviceRecord = {
    deviceId,
    friendlyName: prev?.friendlyName,
    modeId,
    lastSeenMs: prev?.lastSeenMs ?? Date.now(),
  };
  cache.set(deviceId, next);
  await persist();
  return next;
}
