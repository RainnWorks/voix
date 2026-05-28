/**
 * Dictation post-processing — raw transcript → polished text via an
 * LLM, using the mode's `postProcessPrompt` as the system message.
 *
 * Two providers:
 *   • **openai**     /v1/chat/completions
 *   • **openrouter** /v1/chat/completions (drop-in-compatible)
 *
 * The provider abstraction is intentionally tiny. No streaming, no
 * tools, no temperature tuning. Just "system + user → assistant".
 * Adding LiteLLM or Vercel `ai` SDK would be premature — we don't need
 * the surface area they bring.
 *
 * Fallback rule: any failure (no key, HTTP error, model refuses,
 * empty response) → return raw text. A dictation is never lost
 * because a post-processor flaked; we'd rather paste the raw text
 * than silence.
 *
 * Context block: when callers pass a `contextBlock` (rendered by the
 * context layer — Mac app's focused window, HA areas, etc.), it gets
 * prepended to the user message with a separator. Supershout uses the
 * same `[Context]…\n\n---\n\n<raw>` shape, and it works well with the
 * mode prompts unchanged.
 */

import { log } from "../log.ts";

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

// 20s ceiling — most post-proc calls finish in 1–3s. Beyond 20s the
// model is stuck and we'd rather paste raw than make the user wait.
const TIMEOUT_MS = 20_000;

export type Provider = "openai" | "openrouter";

export type PostProcessKeys = {
  openai?: string;
  openrouter?: string;
};

export type PostProcessArgs = {
  rawText: string;
  systemPrompt: string;
  provider: Provider;
  model: string;
  /** Optional context block (formatted by the context layer). When
   *  non-empty, prepended to the user message with a `---` separator. */
  contextBlock?: string;
  keys: PostProcessKeys;
};

export async function postProcess(args: PostProcessArgs): Promise<string> {
  const rawText = (args.rawText ?? "").trim();
  if (!rawText) return rawText;
  const system = (args.systemPrompt ?? "").trim();
  if (!system) return rawText;

  const key = args.provider === "openrouter" ? args.keys.openrouter : args.keys.openai;
  if (!key) {
    log.warn(`post_process: no API key for provider ${args.provider} — returning raw`);
    return rawText;
  }

  const url = args.provider === "openrouter" ? OPENROUTER_URL : OPENAI_URL;
  const userContent = args.contextBlock?.trim()
    ? `${args.contextBlock.trim()}\n\n---\n\n${rawText}`
    : rawText;

  const body = {
    model: args.model || "gpt-4o-mini",
    messages: [
      { role: "system", content: system },
      { role: "user", content: userContent },
    ],
    // Low temperature — these prompts are transforms, not creative
    // writing. Matches what Supershout uses implicitly.
    temperature: 0.2,
  };

  const headers: Record<string, string> = {
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
  };
  if (args.provider === "openrouter") {
    // OpenRouter's dashboard groups requests by these. Optional but
    // makes cost-debugging much easier.
    headers["HTTP-Referer"] = "https://github.com/thenairn/voix";
    headers["X-Title"] = "voix dictation post-processing";
  }

  let resp: Response;
  try {
    resp = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    log.warn(`post_process: ${args.provider} HTTP failure:`, err);
    return rawText;
  }

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    log.warn(`post_process: ${args.provider} returned ${resp.status}: ${text.slice(0, 400)}`);
    return rawText;
  }

  let data: { choices?: Array<{ message?: { content?: string } }> };
  try {
    data = (await resp.json()) as typeof data;
  } catch (err) {
    log.warn(`post_process: ${args.provider} returned non-JSON:`, err);
    return rawText;
  }

  const polished = (data.choices?.[0]?.message?.content ?? "").trim();
  if (!polished) {
    log.warn(`post_process: ${args.provider} returned empty content — using raw`);
    return rawText;
  }

  log.info(
    `post_process: ${args.provider}/${args.model} ok — raw=${rawText.length} → polished=${polished.length}`,
  );
  return polished;
}
