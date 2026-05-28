/**
 * Best-effort sync of daemon mutations into Home Assistant.
 *
 * The daemon is the source of truth — `modes.json` and `devices.json`
 * persist locally and survive HA restarts. But when the HA
 * integration is also installed, users expect entities to mirror the
 * state: the mode select on each device should reflect the active
 * mode, the LED ring should pick up colour changes, etc.
 *
 * We push by calling HA's REST API with the `haToken` from env. If
 * the token isn't set the calls become no-ops and nothing breaks —
 * the daemon's data is still authoritative.
 *
 * Wired into:
 *   • /api/modes PATCH    → voix.update_mode (so HA's mode catalog
 *                            matches; also surfaces to the puck's LED
 *                            on next refresh)
 *   • /api/modes POST     → voix.create_mode
 *   • /api/devices/:id/mode PUT → voix.set_mode (HA pushes to puck NVS)
 */

import { config } from "../env.ts";
import { log } from "../log.ts";

async function call(domain: string, action: string, data: unknown): Promise<void> {
  if (!config.haUrl || !config.haToken) return;
  const url = `${config.haUrl.replace(/\/$/, "")}/api/services/${domain}/${action}`;
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.haToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(data),
    });
    if (!r.ok) {
      const body = await r.text().catch(() => "");
      log.debug(`ha-sync: ${domain}.${action} → ${r.status}: ${body.slice(0, 200)}`);
    }
  } catch (err) {
    log.debug(`ha-sync: ${domain}.${action} threw:`, err);
  }
}

export const haSync = {
  /** Best-effort: HA service `voix.update_mode` takes mode_id + any of
   *  the mode fields. Field names map between daemon (camelCase) and
   *  HA (snake_case) — the latter is what voix.update_mode expects. */
  updateMode: (modeId: string, patch: Record<string, unknown>) => {
    const haPatch: Record<string, unknown> = { mode_id: modeId };
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) continue;
      // camelCase → snake_case for the small set of mode fields HA's
      // service accepts. Anything not in this map is forwarded as-is.
      const map: Record<string, string> = {
        postProcessPrompt: "post_process_prompt",
        postProcessProvider: "post_process_provider",
        postProcessModel: "post_process_model",
        sttProvider: "stt_provider",
        sttModel: "stt_model",
        includeEntities: "include_entities",
        includePersons: "include_persons",
        routingHint: "routing_hint",
      };
      haPatch[map[k] ?? k] = v;
    }
    void call("voix", "update_mode", haPatch);
  },

  /** Set the active mode for a specific puck via HA. HA's
   *  voix.set_mode pushes the mode_id to the puck via the
   *  voix_set_state api.action; the puck writes its NVS so cold
   *  boots come up in the new mode. */
  setDeviceMode: (deviceId: string, modeId: string) =>
    call("voix", "set_mode", { device_id: deviceId, mode_id: modeId }),
};
