/**
 * Context source — the abstraction that lets the daemon ask "what's
 * going on right now?" without knowing which thing is answering.
 *
 * Today there are two source types we'll implement:
 *
 *   • **HAContextSource** — MCP client connected to Home Assistant's
 *     built-in `mcp_server` (HA Core 2025.2+). Exposes areas, persons,
 *     exposed-entity states, and the Assist tool surface (HassTurnOn,
 *     HassLightSet, etc.) as MCP tools.
 *
 *   • **MacContextSource** (later) — long-lived WS from the voix
 *     desktop app. Surface: focused app, window title, file extension,
 *     selected text, clipboard. Not strictly MCP — the Mac talks
 *     custom JSON over the same WS the desktop client already
 *     maintains for state.
 *
 * Both speak this interface. Adding a third source ("Notion notes",
 * "Apple Calendar", whatever) means writing another implementation
 * and registering it. Sessions don't change.
 *
 * Why not "every source MUST be MCP": MCP is the right protocol for
 * tools the LLM should be able to invoke. But for "always-on context"
 * — areas, focused app — we want pull semantics with zero round-trip
 * latency at session start, and that's cheaper as a direct call than
 * as an MCP tool call. The interface accommodates both.
 */

/** A single fact gathered from a source at session start. Goes into the
 *  `[Context]` block prepended to the realtime instructions and to the
 *  post-processing user message. */
export type ContextEntry = {
  source: string;
  data: Record<string, unknown>;
};

/** Neutral tool spec (M-Arch Wave A #4) — provider-agnostic shape every
 *  context source produces. Each context source can publish zero or
 *  more of these; the daemon registers them all up front.
 *
 *  Provider adapters (OpenAI Realtime today, Anthropic / Gemini Live
 *  tomorrow) translate to their native function-call shape at the
 *  provider boundary — see `toOpenAiTool` in `src/realtime/openai.ts`.
 *  Keeping the neutral shape inside the daemon means the context
 *  sources don't need to know which provider will consume their tools.
 *
 *  - OpenAI Realtime: `{ type: "function", name, description, parameters }`.
 *  - Anthropic: `{ name, description, input_schema }`.
 *  - Gemini: `{ name, description, parameters }` with a different schema dialect.
 *
 *  `inputSchemaJson` is whatever JSON-Schema-shaped object the source
 *  publishes. HA's MCP server already ships JSON Schema, so it
 *  round-trips through unchanged.
 */
export type ToolSpec = {
  name: string;
  description?: string;
  inputSchemaJson: Record<string, unknown>;
  /** Internal: which source owns this tool. Not part of any provider
   *  wire shape — the registry uses it for routing, then strips it
   *  before any provider sees the tool. */
  __source?: string;
};

export type ToolResult = {
  /** JSON-serialised result string. OpenAI Realtime's
   *  function_call_output is a single string content field; structured
   *  data needs JSON.stringify here. */
  content: string;
  /** True if the call failed and the daemon should surface an error to
   *  the model. */
  isError?: boolean;
};

export type GatherArgs = {
  /** Which puck this gather is for — sources like the Mac context
   *  might key off "is this puck near the desktop the user's on?"
   *  Today most sources will ignore it. */
  deviceId: string;
};

/** What a context source must implement. */
export type ContextSource = {
  /** Stable short name. Used in tool prefix (`ha__HassTurnOn`) and as
   *  `__source` on tool specs so the daemon can route calls back. */
  readonly name: string;

  /** One-shot connect at boot. Throws → daemon logs and continues
   *  without this source. */
  connect(): Promise<void>;

  /** Currently-running fast-path facts to inject into session
   *  instructions. Called at session start. Each source has its own
   *  timeout (typically 1–2s); if the source can't answer in time
   *  the daemon proceeds without those entries. */
  gatherContext(args: GatherArgs): Promise<ContextEntry[]>;

  /** Tools to register with OpenAI Realtime. Called once at boot
   *  (after `connect()`) and refreshed if the source signals a
   *  schema change. */
  listTools(): Promise<ToolSpec[]>;

  /** Invoke a tool the model selected. The daemon validates the name
   *  prefix and strips it before calling — `source.callTool` receives
   *  the bare tool name as the source published it. */
  callTool(name: string, args: Record<string, unknown>): Promise<ToolResult>;

  /** Optional clean shutdown on daemon SIGTERM. */
  close?(): Promise<void>;
};
