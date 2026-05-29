/**
 * HTTP API: /api/devices/*
 *
 * Per-device active-voice read/write.
 *   GET  /api/devices            → list of known devices with current
 *                                   voice id
 *   PUT  /api/devices/:id/voice  → set the active voice. Persists
 *                                   daemon-side; pushes to HA via
 *                                   ha_sync if HA is configured so
 *                                   the puck's NVS picks up the new
 *                                   voice without waiting for a wake.
 */

import { Elysia, t } from "elysia";
import { listDevices, setDeviceVoice } from "../devices/store.ts";
import { haSync } from "./ha_sync.ts";

export function devicesRoute() {
  return new Elysia({ name: "voix.api.devices" })
    .get("/api/devices", () => listDevices())
    .put(
      "/api/devices/:deviceId/voice",
      async ({ params, body }) => {
        const next = await setDeviceVoice(params.deviceId, body.voiceId);
        haSync.setDeviceVoice(params.deviceId, body.voiceId);
        return next;
      },
      { body: t.Object({ voiceId: t.String() }) },
    );
}
