/**
 * OpenRouter Chat Completions provider. Same OpenAI-compatible shape
 * over `openrouter.ai`. The `HTTP-Referer` + `X-Title` headers are
 * OpenRouter's dashboard-grouping conventions — optional but make
 * cost-debugging far easier.
 */

import { ChatCompletionsProvider } from "./chat_completions.ts";

export function createOpenRouterProvider(apiKey: string, fetchImpl?: typeof fetch) {
  return new ChatCompletionsProvider({
    name: "openrouter",
    baseUrl: "https://openrouter.ai/api/v1/chat/completions",
    apiKey,
    extraHeaders: {
      "HTTP-Referer": "https://github.com/thenairn/voix",
      "X-Title": "voix dictation post-processing",
    },
    defaultModel: "openai/gpt-4o-mini",
    fetchImpl,
  });
}
