/**
 * Daemon API client.
 *
 * Hand-typed today. When we plug Treaty in on the daemon side (Elysia's
 * end-to-end typed RPC) the same client surface becomes auto-typed
 * from the server's route definitions — but that's a follow-up; this
 * file ships value today.
 *
 * Base URL handling: in HA Add-on ingress mode the path prefix that
 * HA's Supervisor adds gets surfaced to us via the `X-Ingress-Path`
 * header on the initial document request. The init HTML can stamp
 * window.__VOIX_BASE__ from a server-rendered template if we ever
 * need it; for now relative paths Just Work because every API call
 * shares the same base as the document.
 */

export type Mode = {
  id: string;
  name: string;
  type: "realtime" | "dictation";
  prompt: string;
  voice: string;
  model: string;
  color: [number, number, number];
  brightness: number;
  effect: string;
  sttProvider: string;
  sttModel: string;
  includeEntities: string[];
  includePersons: string[];
  addendum: string;
  postProcessPrompt: string;
  postProcessProvider: "openai" | "openrouter";
  postProcessModel: string;
  routingHint: string;
  isBuiltin: boolean;
};

export type ModeUpdate = Partial<Omit<Mode, "id" | "isBuiltin">>;

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(path, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!r.ok) {
    const body = await r.text().catch(() => "");
    throw new Error(`${r.status} ${r.statusText}: ${body}`);
  }
  return (await r.json()) as T;
}

export const modesApi = {
  list: () => api<Mode[]>("/api/modes"),
  get: (id: string) => api<Mode>(`/api/modes/${encodeURIComponent(id)}`),
  update: (id: string, patch: ModeUpdate) =>
    api<Mode>(`/api/modes/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),
};

export type Device = {
  deviceId: string;
  friendlyName?: string;
  modeId: string;
  lastSeenMs: number;
};

export const devicesApi = {
  list: () => api<Device[]>("/api/devices"),
  setMode: (deviceId: string, modeId: string) =>
    api<Device>(`/api/devices/${encodeURIComponent(deviceId)}/mode`, {
      method: "PUT",
      body: JSON.stringify({ modeId }),
    }),
};
