/**
 * Done-phase post-processing facade.
 *
 * Picks an LLM provider (`openai` / `openrouter`) per voice config and
 * runs the raw transcript through its `donePrompt`. Replaces the
 * stand-alone `post_process/index.ts` module from before M11. The
 * underlying provider classes (`ChatCompletionsProvider` +
 * factories) are still useful in isolation for M14's traditional
 * discuss turns, which need an LLM call that's not "done phase."
 *
 * Fallback rule retained from the pre-M11 module: any failure (no
 * key, HTTP error, timeout, empty content) → return raw text. A
 * dictation is never lost because the polisher flaked; we'd rather
 * paste raw than leave the user with silence.
 */

import { log } from "../../../log.ts";
import { createOpenAiProvider } from "./openai.ts";
import { createOpenRouterProvider } from "./openrouter.ts";
import type { LlmProvider } from "./types.ts";

/** Open string after M-Arch Wave A #2 — consumers (voice editor,
 *  orchestrator) query the provider registry; this facade still
 *  accepts a name + key for tests + the dictate-done call site that
 *  hasn't migrated to the registry yet (see TraditionalDictatePipeline
 *  and RealtimePipeline). The legacy `"openai" | "openrouter"` union
 *  is gone; built-in factories cover those two names. */
export type ProviderName = string;

/** Per-provider API keys for the dictate done-phase. The orchestrator
 *  carries this struct so the post-process facade can fall back to
 *  raw text if the configured provider has no key. Open shape — Wave A
 *  intentionally keeps the two existing entries; future providers
 *  add their own key slot. */
export type PostProcessKeys = {
  openai?: string;
  openrouter?: string;
  [providerName: string]: string | undefined;
};

export type PostProcessArgs = {
  rawText: string;
  systemPrompt: string;
  provider: ProviderName;
  model: string;
  /** Optional context block (rendered by the context layer). */
  contextBlock?: string;
  keys: PostProcessKeys;
  /** Injectable for tests; defaults to the real factories. Lets the
   *  test suite swap in a stub provider without going through
   *  globalThis.fetch. */
  factory?: (provider: ProviderName, key: string) => LlmProvider;
};

function defaultFactory(provider: ProviderName, key: string): LlmProvider {
  if (provider === "openrouter") return createOpenRouterProvider(key);
  if (provider === "openai") return createOpenAiProvider(key);
  // Unknown provider name: log + fall back to OpenAI-compatible shape so
  // the caller still gets *something*. The post-process facade's
  // raw-text fallback handles the case where this then fails on bad
  // auth — see comments at the top of this file.
  log.warn(`post_process: unknown provider name "${provider}", using OpenAI factory`);
  return createOpenAiProvider(key);
}

export async function postProcess(args: PostProcessArgs): Promise<string> {
  const rawText = (args.rawText ?? "").trim();
  if (!rawText) return rawText;
  const system = (args.systemPrompt ?? "").trim();
  if (!system) return rawText;

  // Wave A #2: keys is open-shaped — look up by provider name first,
  // then fall back to the legacy "openai"/"openrouter" slots so
  // existing call sites that pass `keys: { openai, openrouter }`
  // continue to work for those two names.
  const key =
    args.keys[args.provider] ??
    (args.provider === "openrouter" ? args.keys.openrouter : args.keys.openai);
  if (!key) {
    log.warn(`post_process: no API key for provider ${args.provider} — returning raw`);
    return rawText;
  }

  const factory = args.factory ?? defaultFactory;
  const provider = factory(args.provider, key);

  try {
    const resp = await provider.complete({
      systemPrompt: system,
      contextBlock: args.contextBlock,
      userText: rawText,
      model: args.model,
    });
    log.info(
      `post_process: ${provider.name}/${args.model || "(default)"} ok — ` +
        `raw=${rawText.length} → polished=${resp.text.length}`,
    );
    return resp.text;
  } catch (err) {
    log.warn(`post_process: ${provider.name} failed — falling back to raw:`, err);
    return rawText;
  }
}
