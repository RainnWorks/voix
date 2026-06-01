/**
 * Per-device active-voice tracker.
 *
 * Today the puck reads its voice id from NVS (set via HA's
 * `voix_set_state` api.action — payload still uses the legacy
 * `mode_id` key until the protocol overhaul). Persisting on the puck
 * means cold boots come up in the last voice. The daemon also wants
 * to know the current voice for each device for two reasons:
 *
 *   1. UI shows the active voice in the voice list.
 *   2. UI "Activate" button changes the current voice without waiting
 *      for an HA round-trip (the daemon updates its map, the next
 *      wake-word session reads it).
 *
 * Persisted at `/data/voix/devices.json`. Mutated in-process from the
 * /api/devices routes; refreshed when pucks send hellos.
 *
 * Persistence migration (M02): older records used `modeId` as the
 * field name. The loader accepts either and persists as `voiceId`.
 */

import { readFile } from "node:fs/promises";
import type { Capabilities } from "../audio_io/protocol.ts";
import { log } from "../log.ts";
import { atomicWrite } from "../storage/atomic.ts";
import { dataPath } from "../storage/paths.ts";
import { DEFAULT_VOICE_ID } from "../voices/builtins.ts";

export type DeviceRecord = {
  /** Stable puck identifier (the ESPHome device name, e.g.
   *  `home-assistant-voice-095e4e`). */
  deviceId: string;
  /** Optional human label for the puck. */
  friendlyName?: string;
  /** Current voice id. Resolves to DEFAULT_VOICE_ID when unset. */
  voiceId: string;
  /** Date.now() of the last connection we saw — refreshed on hello. */
  lastSeenMs: number;
  /** M16: capabilities snapshot from the most recent hello. Lets the
   *  Surfaces UI render what each endpoint can physically do without
   *  the WS being live. Optional — pre-M16 records won't have it,
   *  and endpoints that send the legacy puck shape get the daemon's
   *  inferred defaults stamped here so the UI still has something
   *  to show. */
  protocolVersion?: number;
  clientKind?: string;
  capabilities?: Capabilities;
};

/** Shape on disk in pre-M02 records — accepted on read for migration. */
type LegacyDeviceRecord = Omit<DeviceRecord, "voiceId"> & { modeId?: string };

const FILE = dataPath("devices.json");

const cache = new Map<string, DeviceRecord>();
let loaded = false;

function normalise(d: DeviceRecord | LegacyDeviceRecord): DeviceRecord {
  const voiceId =
    "voiceId" in d && d.voiceId ? d.voiceId : (d as LegacyDeviceRecord).modeId || DEFAULT_VOICE_ID;
  const rec: DeviceRecord = {
    deviceId: d.deviceId,
    friendlyName: d.friendlyName,
    voiceId,
    lastSeenMs: d.lastSeenMs,
  };
  // Carry forward the M16 capability fields when present on disk.
  if ("protocolVersion" in d && typeof d.protocolVersion === "number") {
    rec.protocolVersion = d.protocolVersion;
  }
  if ("clientKind" in d && typeof d.clientKind === "string") {
    rec.clientKind = d.clientKind;
  }
  if ("capabilities" in d && d.capabilities) {
    rec.capabilities = d.capabilities;
  }
  return rec;
}

export async function loadDevices(): Promise<void> {
  if (loaded) return;
  try {
    const raw = await readFile(FILE, "utf8");
    const parsed = JSON.parse(raw) as Array<DeviceRecord | LegacyDeviceRecord>;
    if (Array.isArray(parsed)) {
      for (const d of parsed) {
        if (d && typeof d.deviceId === "string") cache.set(d.deviceId, normalise(d));
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

/** Called from the audio-io connection at hello time so we have an
 *  up-to-date "lastSeen". Records the voice id + capability snapshot
 *  from the hello so the Surfaces screen can render what each
 *  endpoint can do without the WS being live. */
export async function recordSeen(
  deviceId: string,
  hint: {
    friendlyName?: string;
    voiceId?: string;
    protocolVersion?: number;
    clientKind?: string;
    capabilities?: Capabilities;
  },
): Promise<void> {
  const prev = cache.get(deviceId);
  const next: DeviceRecord = {
    deviceId,
    friendlyName: hint.friendlyName ?? prev?.friendlyName,
    voiceId: hint.voiceId || prev?.voiceId || DEFAULT_VOICE_ID,
    lastSeenMs: Date.now(),
    protocolVersion: hint.protocolVersion ?? prev?.protocolVersion,
    clientKind: hint.clientKind ?? prev?.clientKind,
    capabilities: hint.capabilities ?? prev?.capabilities,
  };
  cache.set(deviceId, next);
  await persist();
}

export function listDevices(): DeviceRecord[] {
  return Array.from(cache.values()).sort((a, b) => b.lastSeenMs - a.lastSeenMs);
}

/** Set a new voice for a device. Persists immediately. If you want the
 *  change to propagate to the puck before its next wake-word
 *  (re-pushing via HA's voix_set_state), do that at the call site —
 *  this function is just the daemon-side record-keeper. */
export async function setDeviceVoice(deviceId: string, voiceId: string): Promise<DeviceRecord> {
  const prev = cache.get(deviceId);
  const next: DeviceRecord = {
    deviceId,
    friendlyName: prev?.friendlyName,
    voiceId,
    lastSeenMs: prev?.lastSeenMs ?? Date.now(),
    protocolVersion: prev?.protocolVersion,
    clientKind: prev?.clientKind,
    capabilities: prev?.capabilities,
  };
  cache.set(deviceId, next);
  await persist();
  return next;
}
