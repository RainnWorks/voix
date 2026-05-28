/**
 * HTTP API: /api/devices/*
 *
 * Per-device active-mode read/write.
 *   GET  /api/devices            → list of known devices with
 *                                   current mode_id
 *   PUT  /api/devices/:id/mode   → set the active mode. Persists
 *                                   daemon-side; pushes to HA via
 *                                   ha_sync if HA is configured so
 *                                   the puck's NVS picks up the new
 *                                   mode without waiting for a wake.
 */

import { Elysia, t } from "elysia";
import { listDevices, setDeviceMode } from "../devices/store.ts";
import { haSync } from "./ha_sync.ts";

export function devicesRoute() {
  return new Elysia({ name: "voix.api.devices" })
    .get("/api/devices", () => listDevices())
    .put(
      "/api/devices/:deviceId/mode",
      async ({ params, body }) => {
        const next = await setDeviceMode(params.deviceId, body.modeId);
        haSync.setDeviceMode(params.deviceId, body.modeId);
        return next;
      },
      { body: t.Object({ modeId: t.String() }) },
    );
}
