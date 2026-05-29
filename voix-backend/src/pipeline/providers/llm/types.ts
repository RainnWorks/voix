/**
 * LLM provider abstraction.
 *
 * One of three provider interfaces under `pipeline/providers/`. Used
 * by the dictation done-phase post-processor today (Email / Note /
 * Code / Message voices rewrite raw STT through this), and by Phase 4
 * traditional-discuss turns (talking-phase model call when the
 * discuss engine is `traditional`).
 *
 * Surface is deliberately tiny: a single one-shot `complete(req)` →
 * `text`. No streaming, no tools, no images. The done-phase doesn't
 * need them; if a future intent does, add a separate richer interface
 * rather than fattening this one.
 */

export type LlmRequest = {
  /** System role message — the voice's `talkingPrompt` or `donePrompt`. */
  systemPrompt: string;
  /** Optional context block (rendered by the context layer). When
   *  non-empty, the facade prepends it to the user message with a
   *  `---` separator. */
  contextBlock?: string;
  /** User role message body. For the done phase: the raw transcript. */
  userText: string;
  /** Provider-specific model name, e.g. "gpt-4o-mini",
   *  "anthropic/claude-haiku-4". */
  model: string;
  /** 0-1. Defaults to 0.2 — these prompts are transforms, not
   *  creative writing. Override for voices that want more flair. */
  temperature?: number;
};

export type LlmResponse = {
  /** The model's reply text. Trimmed by the impl. */
  text: string;
  /** Provider-reported token counts when available. Used for cost
   *  dashboards; optional in the contract. */
  usage?: { promptTokens?: number; completionTokens?: number };
};

export interface LlmProvider {
  /** Stable provider name. Used in logs + voice editor picker. */
  readonly name: string;
  /** One-shot completion. Throws on auth, transport, or empty
   *  response; callers (e.g. the post-process facade) decide
   *  whether to fall back to raw text or surface to the user. */
  complete(req: LlmRequest): Promise<LlmResponse>;
}
