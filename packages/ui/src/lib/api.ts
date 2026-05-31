/**
 * Daemon API client.
 *
 * Hand-typed today. When we plug Treaty in on the daemon side (Elysia's
 * end-to-end typed RPC) the same client surface becomes auto-typed
 * from the server's route definitions — but that's a follow-up; this
 * file ships value today.
 *
 * Base URL handling: in HA Add-on ingress mode the document is
 * served from `/api/hassio_ingress/<token>/`, not the site root. The
 * fetch paths below are RELATIVE (no leading slash) so the browser
 * resolves them under whatever base the document was loaded from —
 * the ingress prefix in production, `/` in local dev, `tauri://` in
 * a future Tauri shell. (Vite's `base: "./"` covers the asset paths
 * in index.html; this file covers the API calls. Both have to be
 * relative, or HA's ingress prefix gets stripped on the way to the
 * daemon and every request lands as a 404 at the bare domain.)
 *
 * Native targets (iOS / macOS — M20+): RN's fetch can't resolve
 * relative URLs, so getApiBase() returns an absolute daemon URL
 * (see apiBase.native.ts). Web returns "" (this file's behaviour
 * is unchanged).
 */

import { getApiBase } from "./apiBase";

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
  /** M14 — which engine drives the discuss path. Optional; missing
   *  is normalised to "realtime" on the daemon side. */
  discussEngine?: "realtime" | "traditional";
  /** M14 — TTS provider for the traditional discuss path. */
  ttsProvider?: string;
  /** M14 — provider-specific voice id for the TTS. */
  ttsVoice?: string;
  isBuiltin: boolean;
};

export type VoiceUpdate = Partial<Omit<Voice, "id" | "isBuiltin">>;

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(getApiBase() + path, {
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
  list: () => api<Voice[]>("api/voices"),
  get: (id: string) => api<Voice>(`api/voices/${encodeURIComponent(id)}`),
  update: (id: string, patch: VoiceUpdate) =>
    api<Voice>(`api/voices/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),
};

/** Capability snapshot, mirroring `audio_io/protocol.ts` Capabilities. */
export type SurfaceCapabilities = {
  mic: { sample_rate_hz: number; channels: 1 | 2; codec?: "pcm16" | "opus" };
  speaker?: { sample_rate_hz: number; codec?: "pcm16" };
  half_duplex_on_chip?: boolean;
  wake_words?: string[];
  screen?: boolean;
};

export type Device = {
  deviceId: string;
  friendlyName?: string;
  voiceId: string;
  lastSeenMs: number;
  /** M16 capability snapshot from the most recent hello. */
  protocolVersion?: number;
  clientKind?: string;
  capabilities?: SurfaceCapabilities;
};

/** Devices and Surfaces are the same on the wire today — same
 *  DeviceRecord payload, two URL paths. The UI labels them as
 *  Surfaces; the daemon's internal naming is still Devices. */
export type Surface = Device;

export const devicesApi = {
  list: () => api<Device[]>("api/devices"),
  setVoice: (deviceId: string, voiceId: string) =>
    api<Device>(`api/devices/${encodeURIComponent(deviceId)}/voice`, {
      method: "PUT",
      body: JSON.stringify({ voiceId }),
    }),
};

export const surfacesApi = {
  list: () => api<Surface[]>("api/surfaces"),
};

/** M17 history types — mirror voix-backend/src/history/types.ts. */
export type HistoryContextEntry = {
  source: string;
  data: Record<string, unknown>;
};

export type HistoryEntry = {
  id: string;
  createdAt: string;
  deviceId: string;
  sessionId: string;
  voiceId: string;
  voiceName: string;
  modeType: "realtime" | "dictation";
  durationMs: number;
  rawText: string;
  processedText: string | null;
  postProcessProvider: string | null;
  postProcessModel: string | null;
  contextSnapshot: HistoryContextEntry[];
  transcriptPath: string | null;
};

export type TranscriptResponse = { content: string; source: string };

export const historyApi = {
  list: (opts?: { voiceId?: string; deviceId?: string; limit?: number }) => {
    const params = new URLSearchParams();
    if (opts?.voiceId) params.set("voiceId", opts.voiceId);
    if (opts?.deviceId) params.set("deviceId", opts.deviceId);
    if (opts?.limit) params.set("limit", String(opts.limit));
    const qs = params.toString();
    return api<HistoryEntry[]>(`api/history${qs ? `?${qs}` : ""}`);
  },
  get: (id: string) => api<HistoryEntry>(`api/history/${encodeURIComponent(id)}`),
  transcript: (id: string) =>
    api<TranscriptResponse>(`api/history/${encodeURIComponent(id)}/transcript`),
};
