/**
 * M11 LLM provider tests.
 *
 * Three layers:
 *
 * 1. ChatCompletionsProvider — drives a stub fetch through the OpenAI-
 *    shaped request/response surface. Covers happy path, auth header
 *    + extraHeaders, contextBlock merging, HTTP error → throw,
 *    empty completion → throw, missing prompt/userText → throw,
 *    usage parsing.
 *
 * 2. Factories (openai + openrouter) — verify the URLs + default
 *    models + OpenRouter dashboard headers.
 *
 * 3. postProcess facade — verify the fallback rule: any provider
 *    error returns raw text instead of throwing. Successful run
 *    returns the polished text. No-key path returns raw.
 */

import { describe, expect, test } from "bun:test";
import { ChatCompletionsProvider } from "../../../../src/pipeline/providers/llm/chat_completions.ts";
import { postProcess } from "../../../../src/pipeline/providers/llm/index.ts";
import { createOpenAiProvider } from "../../../../src/pipeline/providers/llm/openai.ts";
import { createOpenRouterProvider } from "../../../../src/pipeline/providers/llm/openrouter.ts";
import type { LlmProvider } from "../../../../src/pipeline/providers/llm/types.ts";

function stubFetch(response: {
  status?: number;
  body?: unknown;
  capture?: { url?: string; init?: RequestInit };
}): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (response.capture) {
      response.capture.url = typeof input === "string" ? input : input.toString();
      response.capture.init = init;
    }
    const status = response.status ?? 200;
    return new Response(JSON.stringify(response.body ?? {}), {
      status,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
}

describe("ChatCompletionsProvider", () => {
  test("happy path: posts the right URL + headers + body, returns trimmed text", async () => {
    const capture: { url?: string; init?: RequestInit } = {};
    const provider = new ChatCompletionsProvider({
      name: "openai",
      baseUrl: "https://api.openai.com/v1/chat/completions",
      apiKey: "key-x",
      defaultModel: "gpt-4o-mini",
      fetchImpl: stubFetch({
        capture,
        body: {
          choices: [{ message: { content: "  polished  " } }],
          usage: { prompt_tokens: 42, completion_tokens: 7 },
        },
      }),
    });
    const resp = await provider.complete({
      systemPrompt: "system",
      userText: "raw",
      model: "",
    });
    expect(resp.text).toBe("polished");
    expect(resp.usage?.promptTokens).toBe(42);
    expect(resp.usage?.completionTokens).toBe(7);

    expect(capture.url).toBe("https://api.openai.com/v1/chat/completions");
    const headers = (capture.init?.headers ?? {}) as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer key-x");
    const body = JSON.parse(String(capture.init?.body));
    expect(body.model).toBe("gpt-4o-mini"); // default applied when req.model is empty
    expect(body.temperature).toBeCloseTo(0.2);
    expect(body.messages[0]).toEqual({ role: "system", content: "system" });
    expect(body.messages[1]).toEqual({ role: "user", content: "raw" });
  });

  test("contextBlock is merged into the user message with a separator", async () => {
    const capture: { url?: string; init?: RequestInit } = {};
    const provider = new ChatCompletionsProvider({
      name: "openai",
      baseUrl: "x",
      apiKey: "k",
      defaultModel: "m",
      fetchImpl: stubFetch({
        capture,
        body: { choices: [{ message: { content: "ok" } }] },
      }),
    });
    await provider.complete({
      systemPrompt: "s",
      userText: "u",
      model: "m",
      contextBlock: "[Context]\nfoo: bar",
    });
    const body = JSON.parse(String(capture.init?.body));
    expect(body.messages[1].content).toBe("[Context]\nfoo: bar\n\n---\n\nu");
  });

  test("extraHeaders are forwarded", async () => {
    const capture: { url?: string; init?: RequestInit } = {};
    const provider = new ChatCompletionsProvider({
      name: "openrouter",
      baseUrl: "https://openrouter.ai/x",
      apiKey: "k",
      extraHeaders: { "X-Title": "voix" },
      defaultModel: "m",
      fetchImpl: stubFetch({
        capture,
        body: { choices: [{ message: { content: "ok" } }] },
      }),
    });
    await provider.complete({ systemPrompt: "s", userText: "u", model: "m" });
    const headers = (capture.init?.headers ?? {}) as Record<string, string>;
    expect(headers["X-Title"]).toBe("voix");
  });

  test("missing apiKey throws", async () => {
    const provider = new ChatCompletionsProvider({
      name: "openai",
      baseUrl: "x",
      apiKey: "",
      defaultModel: "m",
      fetchImpl: stubFetch({ body: {} }),
    });
    await expect(provider.complete({ systemPrompt: "s", userText: "u", model: "m" })).rejects.toThrow(
      /missing apiKey/i,
    );
  });

  test("empty systemPrompt throws", async () => {
    const provider = new ChatCompletionsProvider({
      name: "openai",
      baseUrl: "x",
      apiKey: "k",
      defaultModel: "m",
      fetchImpl: stubFetch({ body: {} }),
    });
    await expect(provider.complete({ systemPrompt: "  ", userText: "u", model: "m" })).rejects.toThrow(
      /empty systemPrompt/i,
    );
  });

  test("empty userText throws", async () => {
    const provider = new ChatCompletionsProvider({
      name: "openai",
      baseUrl: "x",
      apiKey: "k",
      defaultModel: "m",
      fetchImpl: stubFetch({ body: {} }),
    });
    await expect(provider.complete({ systemPrompt: "s", userText: "", model: "m" })).rejects.toThrow(
      /empty userText/i,
    );
  });

  test("HTTP error throws with status in the message", async () => {
    const provider = new ChatCompletionsProvider({
      name: "openai",
      baseUrl: "x",
      apiKey: "k",
      defaultModel: "m",
      fetchImpl: stubFetch({ status: 429, body: { error: "rate limited" } }),
    });
    await expect(provider.complete({ systemPrompt: "s", userText: "u", model: "m" })).rejects.toThrow(
      /HTTP 429/,
    );
  });

  test("empty completion throws", async () => {
    const provider = new ChatCompletionsProvider({
      name: "openai",
      baseUrl: "x",
      apiKey: "k",
      defaultModel: "m",
      fetchImpl: stubFetch({ body: { choices: [{ message: { content: "" } }] } }),
    });
    await expect(provider.complete({ systemPrompt: "s", userText: "u", model: "m" })).rejects.toThrow(
      /empty completion/i,
    );
  });
});

describe("factories", () => {
  test("createOpenAiProvider sets the expected URL + default model", async () => {
    const capture: { url?: string; init?: RequestInit } = {};
    const provider = createOpenAiProvider(
      "k",
      stubFetch({ capture, body: { choices: [{ message: { content: "ok" } }] } }),
    );
    expect(provider.name).toBe("openai");
    await provider.complete({ systemPrompt: "s", userText: "u", model: "" });
    expect(capture.url).toBe("https://api.openai.com/v1/chat/completions");
    const body = JSON.parse(String(capture.init?.body));
    expect(body.model).toBe("gpt-4o-mini");
  });

  test("createOpenRouterProvider sets the OpenRouter URL + dashboard headers", async () => {
    const capture: { url?: string; init?: RequestInit } = {};
    const provider = createOpenRouterProvider(
      "k",
      stubFetch({ capture, body: { choices: [{ message: { content: "ok" } }] } }),
    );
    expect(provider.name).toBe("openrouter");
    await provider.complete({ systemPrompt: "s", userText: "u", model: "" });
    expect(capture.url).toBe("https://openrouter.ai/api/v1/chat/completions");
    const headers = (capture.init?.headers ?? {}) as Record<string, string>;
    expect(headers["HTTP-Referer"]).toBeDefined();
    expect(headers["X-Title"]).toBeDefined();
  });
});

describe("postProcess facade", () => {
  function stubProvider(behaviour: { text?: string; throws?: string }): LlmProvider {
    return {
      name: "stub",
      async complete() {
        if (behaviour.throws) throw new Error(behaviour.throws);
        return { text: behaviour.text ?? "polished" };
      },
    };
  }

  test("no key for the chosen provider → returns raw text", async () => {
    const result = await postProcess({
      rawText: "hello world",
      systemPrompt: "rewrite as email",
      provider: "openai",
      model: "gpt-4o-mini",
      keys: {}, // no openai
    });
    expect(result).toBe("hello world");
  });

  test("empty rawText → returns it as-is (no work to do)", async () => {
    const result = await postProcess({
      rawText: "   ",
      systemPrompt: "rewrite",
      provider: "openai",
      model: "x",
      keys: { openai: "k" },
      factory: () => stubProvider({ text: "should not be called" }),
    });
    expect(result).toBe("");
  });

  test("empty systemPrompt → returns rawText (no rewrite to apply)", async () => {
    const result = await postProcess({
      rawText: "hello",
      systemPrompt: "",
      provider: "openai",
      model: "x",
      keys: { openai: "k" },
      factory: () => stubProvider({ text: "should not be called" }),
    });
    expect(result).toBe("hello");
  });

  test("provider throws → returns raw text (graceful fallback)", async () => {
    const result = await postProcess({
      rawText: "hello world",
      systemPrompt: "rewrite",
      provider: "openai",
      model: "x",
      keys: { openai: "k" },
      factory: () => stubProvider({ throws: "boom" }),
    });
    expect(result).toBe("hello world");
  });

  test("provider succeeds → returns polished text", async () => {
    const result = await postProcess({
      rawText: "hello",
      systemPrompt: "rewrite",
      provider: "openai",
      model: "x",
      keys: { openai: "k" },
      factory: () => stubProvider({ text: "Hello, world." }),
    });
    expect(result).toBe("Hello, world.");
  });
});
