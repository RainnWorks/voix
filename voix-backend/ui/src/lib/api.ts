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

export type Voice = {
  id: string;
  name: string;
  type: "realtime" | "dictation";
  /** Canonical from M03: what the model is told during the
   *  conversation. Mirrored from / to `prompt` on the daemon side. */
  talkingPrompt: string;
  /** Canonical from M03: what the model is told when producing the
   *  artifact. Mirrored from / to `postProcessPrompt`. */
  donePrompt: string;
  /** @deprecated kept in sync with `talkingPrompt` until the M04
   *  editor rewrite drops it client-side. */
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
  /** @deprecated kept in sync with `donePrompt`. */
  postProcessPrompt: string;
  postProcessProvider: "openai" | "openrouter";
  postProcessModel: string;
  routingHint: string;
  isBuiltin: boolean;
};

export type VoiceUpdate = Partial<Omit<Voice, "id" | "isBuiltin">>;

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

export const voicesApi = {
  list: () => api<Voice[]>("/api/voices"),
  get: (id: string) => api<Voice>(`/api/voices/${encodeURIComponent(id)}`),
  update: (id: string, patch: VoiceUpdate) =>
    api<Voice>(`/api/voices/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),
};

export type Device = {
  deviceId: string;
  friendlyName?: string;
  voiceId: string;
  lastSeenMs: number;
};

export const devicesApi = {
  list: () => api<Device[]>("/api/devices"),
  setVoice: (deviceId: string, voiceId: string) =>
    api<Device>(`/api/devices/${encodeURIComponent(deviceId)}/voice`, {
      method: "PUT",
      body: JSON.stringify({ voiceId }),
    }),
};
