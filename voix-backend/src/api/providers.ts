/**
 * HTTP API: /api/providers — M-Arch Wave A #2.
 *
 * Exposes which providers are registered for a given kind ("stt",
 * "tts", "llm") so the voice editor can render a dynamic segmented
 * control instead of hardcoding ["openai", "openrouter"] in the UI.
 *
 *   GET /api/providers?kind=stt → { kind: "stt", providers: ["deepgram"] }
 *   GET /api/providers?kind=llm → { kind: "llm", providers: ["openai", "openrouter"] }
 *   GET /api/providers?kind=tts → { kind: "tts", providers: ["aura"] }
 *   GET /api/providers          → { stt: [...], llm: [...], tts: [...] }
 *
 * Returns 400 for an unrecognised `kind`. Empty arrays are normal —
 * they mean "no provider of this kind is configured" (no API key set
 * for any impl of that kind). The UI surfaces that as "add an API key
 * in Add-on options" rather than an error.
 *
 * Wave B will add `kind=realtime` once the realtime seam is
 * load-bearing.
 */

import { Elysia } from "elysia";
import { getDefaultRegistry, type ProviderKind } from "../pipeline/orchestrator.ts";

const KNOWN_KINDS: ProviderKind[] = ["stt", "llm", "tts"];

function isKind(s: string): s is ProviderKind {
  return (KNOWN_KINDS as string[]).includes(s);
}

export function providersRoute() {
  return new Elysia({ name: "voix.api.providers" }).get("/api/providers", ({ query, set }) => {
    const registry = getDefaultRegistry();
    const kindParam = (query as { kind?: string }).kind;
    if (!kindParam) {
      const out: Record<ProviderKind, string[]> = { stt: [], llm: [], tts: [] };
      for (const k of KNOWN_KINDS) out[k] = registry.list(k);
      return out;
    }
    if (!isKind(kindParam)) {
      set.status = 400;
      return {
        error: `unknown provider kind "${kindParam}" — expected one of ${KNOWN_KINDS.join(", ")}`,
      };
    }
    return { kind: kindParam, providers: registry.list(kindParam) };
  });
}
