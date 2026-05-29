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

export type ProviderName = "openai" | "openrouter";

export type PostProcessKeys = {
  openai?: string;
  openrouter?: string;
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
  return provider === "openrouter" ? createOpenRouterProvider(key) : createOpenAiProvider(key);
}

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
