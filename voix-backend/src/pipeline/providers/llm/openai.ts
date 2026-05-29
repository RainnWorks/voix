/**
 * OpenAI Chat Completions provider. Drop-in `LlmProvider` over the
 * v1/chat/completions endpoint at `api.openai.com`.
 */

import { ChatCompletionsProvider } from "./chat_completions.ts";

export function createOpenAiProvider(apiKey: string, fetchImpl?: typeof fetch) {
  return new ChatCompletionsProvider({
    name: "openai",
    baseUrl: "https://api.openai.com/v1/chat/completions",
    apiKey,
    defaultModel: "gpt-4o-mini",
    fetchImpl,
  });
}
