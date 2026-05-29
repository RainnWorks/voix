/**
 * Generic Chat Completions provider — drives OpenAI's `/v1/chat/
 * completions` endpoint OR any drop-in-compatible service (OpenRouter,
 * Groq, Together, vLLM, Ollama-with-compat-mode, local llama.cpp, …).
 *
 * One class with constructor injection rather than a base + two
 * subclasses. The OpenAI and OpenRouter wrappers in sibling files
 * are 5-line factories that choose the base URL + extra headers.
 *
 * The `fetch` implementation is injected so tests substitute without
 * monkey-patching globalThis.
 */

import type { LlmProvider, LlmRequest, LlmResponse } from "./types.ts";

/** 20s ceiling on every call. Most done-phase rewrites finish in
 *  1-3 s; beyond 20 s the model is stuck and we'd rather throw than
 *  block a session forever. Callers decide whether to fall back. */
const TIMEOUT_MS = 20_000;

export type ChatCompletionsConfig = {
  /** Stable display name (logs + UI picker). */
  name: string;
  /** Full URL of the chat completions endpoint, e.g.
   *  https://api.openai.com/v1/chat/completions */
  baseUrl: string;
  /** API key — passed as `Authorization: Bearer <key>`. */
  apiKey: string;
  /** Extra headers (e.g. OpenRouter's HTTP-Referer + X-Title for
   *  dashboard grouping). */
  extraHeaders?: Record<string, string>;
  /** Default model used when `LlmRequest.model` is empty. */
  defaultModel: string;
  /** Injectable for tests. Defaults to `fetch`. */
  fetchImpl?: typeof fetch;
};

export class ChatCompletionsProvider implements LlmProvider {
  readonly name: string;
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly extraHeaders: Record<string, string>;
  private readonly defaultModel: string;
  private readonly fetchImpl: typeof fetch;

  constructor(cfg: ChatCompletionsConfig) {
    this.name = cfg.name;
    this.baseUrl = cfg.baseUrl;
    this.apiKey = cfg.apiKey;
    this.extraHeaders = cfg.extraHeaders ?? {};
    this.defaultModel = cfg.defaultModel;
    this.fetchImpl = cfg.fetchImpl ?? fetch;
  }

  async complete(req: LlmRequest): Promise<LlmResponse> {
    if (!this.apiKey) {
      throw new Error(`${this.name}: missing apiKey`);
    }
    const system = (req.systemPrompt ?? "").trim();
    if (!system) {
      throw new Error(`${this.name}: empty systemPrompt`);
    }

    // Two input shapes:
    //   • single-shot (done phase): `userText` → one user message
    //   • multi-turn (discuss):     `messages` → full history
    // When both are passed, messages wins. Either way the system
    // prompt prepends, and a non-empty contextBlock attaches to the
    // FIRST user message (so the model sees context before any
    // history).
    const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
      { role: "system", content: system },
    ];
    const ctx = req.contextBlock?.trim();
    const attachCtx = (s: string) => (ctx ? `${ctx}\n\n---\n\n${s}` : s);

    if (req.messages && req.messages.length > 0) {
      let firstUserApplied = false;
      for (const m of req.messages) {
        if (!firstUserApplied && m.role === "user") {
          messages.push({ role: "user", content: attachCtx(m.content) });
          firstUserApplied = true;
        } else {
          messages.push({ role: m.role, content: m.content });
        }
      }
      if (messages.length === 1) {
        throw new Error(`${this.name}: empty messages list`);
      }
    } else {
      const userText = (req.userText ?? "").trim();
      if (!userText) {
        throw new Error(`${this.name}: empty userText`);
      }
      messages.push({ role: "user", content: attachCtx(userText) });
    }

    const body = {
      model: req.model || this.defaultModel,
      messages,
      temperature: req.temperature ?? 0.2,
    };

    const resp = await this.fetchImpl(this.baseUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
        ...this.extraHeaders,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(`${this.name}: HTTP ${resp.status}${text ? ` — ${text.slice(0, 400)}` : ""}`);
    }

    const data = (await resp.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };

    const text = (data.choices?.[0]?.message?.content ?? "").trim();
    if (!text) {
      throw new Error(`${this.name}: empty completion`);
    }
    return {
      text,
      usage: {
        promptTokens: data.usage?.prompt_tokens,
        completionTokens: data.usage?.completion_tokens,
      },
    };
  }
}
