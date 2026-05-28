/**
 * Mode = a user-configurable preset that bundles every parameter
 * relevant to a single turn: which transcription provider, what voice
 * for realtime, which post-processing prompt for dictation, etc.
 *
 * One catalog is shared across all pucks + the Mac app. Each input
 * source (puck, Mac hotkey, …) sends a `mode_id` in its hello and the
 * daemon looks up the mode here.
 *
 * Schema mirrors the Python version that lived under
 * `ha-integration/custom_components/voix/const.py` — the names are kept
 * stable so existing built-in IDs (default-realtime, default-message,
 * default-email, default-note, default-code, default-dictation)
 * survive the move.
 *
 * Two flavours of mode:
 *
 *   • `realtime` — full OpenAI Realtime audio session. `voice`, `model`,
 *     `prompt` (system instructions), `includeEntities/Persons`,
 *     `addendum` apply. Post-processing fields ignored — the model
 *     IS the model. Tool calls come from registered MCP servers.
 *
 *   • `dictation` — STT only, no model voice response. `sttProvider`,
 *     `sttModel` apply. After STT completes, if
 *     `postProcessPrompt` is non-empty, raw transcript flows through
 *     the post-processing LLM with `postProcessProvider/Model`.
 *     `prompt` / `voice` ignored.
 *
 * `assist` (HA's built-in pipeline, used by the second wake word) is
 * NOT a voix mode — that wake word bypasses voix entirely on the
 * device side. Leaving it out of the type to avoid resurrecting the
 * deleted `default-assist` from the Python era.
 */

export type ModeType = "realtime" | "dictation";

export type Mode = {
  id: string;
  name: string;
  type: ModeType;

  /** Realtime: system prompt sent in session.update. Dictation: ignored. */
  prompt: string;

  /** Realtime voice (alloy, ash, ballad, …). Empty = inherit default. */
  voice: string;

  /** Realtime model id. Empty = inherit default. */
  model: string;

  /** Idle LED colour. Pushed to the puck via the HA integration. */
  color: [number, number, number];
  brightness: number;
  effect: string;

  /** STT provider key. Dictation modes use this; realtime modes use the
   *  inner transcription embedded in the realtime session. */
  sttProvider: string;
  sttModel: string;

  /** Per-mode entity-state context the user always wants the model to
   *  know about. Names, not entity_ids — daemon resolves via the HA
   *  MCP server's state read. */
  includeEntities: string[];
  includePersons: string[];

  /** Free-form addendum appended to the system prompt. */
  addendum: string;

  /** Dictation: when non-empty, raw transcript runs through an LLM
   *  with this as the system prompt. Empty = no post-processing. */
  postProcessPrompt: string;
  postProcessProvider: "openai" | "openrouter";
  postProcessModel: string;

  /** One-line description for auto-routing. The router shows these to
   *  a small LLM ("which mode is best for this context?") so the more
   *  distinctive the routing_hint, the better the routing accuracy. */
  routingHint: string;

  /** Built-in modes are seeded on first boot. The flag lets us
   *  distinguish "user created" from "shipped with the daemon" — the
   *  UI may surface this as a reset button, and migrations only
   *  touch the built-ins. */
  isBuiltin: boolean;
};

/** Subset of `Mode` accepted by mode-update endpoints. All fields
 *  optional so the client can send sparse updates without round-tripping
 *  the whole mode definition. */
export type ModeUpdate = Partial<Omit<Mode, "id" | "isBuiltin">>;
