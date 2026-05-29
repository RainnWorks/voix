/**
 * Voice = a user-configurable preset that bundles every parameter
 * relevant to a single turn: which transcription provider, what TTS
 * voice for realtime, which post-processing prompt for dictation, etc.
 *
 * Renamed from `Mode` in M02 (vocabulary alignment with the brand
 * guides + architecture doc). The wire field a puck sends is still
 * `mode_id` until M05 reshapes the protocol; locally the daemon talks
 * about voices.
 *
 * One catalog is shared across all input sources (puck, Mac hotkey,
 * iOS keyboard, …). Each hello carries a voice identifier and the
 * daemon looks up the voice here.
 *
 * Schema mirrors the Python version that lived under
 * `ha-integration/custom_components/voix/const.py` — the names are kept
 * stable so existing built-in IDs (default-realtime, default-message,
 * default-email, default-note, default-code, default-dictation)
 * survive the move.
 *
 * Two flavours of voice (still keyed off `type` in M02; M03 reshapes
 * this into the killer-flow conversation/output phases):
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
 * NOT a voix voice — that wake word bypasses voix entirely on the
 * device side.
 */

export type VoiceType = "realtime" | "dictation";

export type Voice = {
  id: string;
  name: string;
  type: VoiceType;

  /**
   * **The talking phase prompt** (M03+ canonical). What the model is
   * told *during* the conversation — its persona, its rules, its
   * register. Empty when this voice has no talking phase (pure
   * dictation: capture, transform, deliver).
   *
   * The legacy `prompt` field is kept in sync with this on read +
   * write so old clients can still set/read it; the daemon's
   * realtime path reads this field directly.
   */
  talkingPrompt: string;

  /**
   * **The done phase prompt** (M03+ canonical). What the model is
   * told *when the user signals they're ready to produce the
   * artifact* — the design-brief §3 killer-flow handoff. For pure
   * dictation voices this is the post-process prompt (rewrite the
   * raw transcript into the right register). For pure realtime
   * voices this is empty.
   *
   * The legacy `postProcessPrompt` field is kept in sync with this.
   */
  donePrompt: string;

  /**
   * @deprecated Use `talkingPrompt`. Kept in sync on read + write so
   * existing UI editors that target this field still work; will be
   * dropped once the M04 voice-editor rewrite lands.
   */
  prompt: string;

  /** Realtime TTS voice (alloy, ash, ballad, …). Empty = inherit default. */
  voice: string;

  /** Realtime model id. Empty = inherit default. */
  model: string;

  /** Idle LED colour. Pushed to the puck via the HA integration. */
  color: [number, number, number];
  brightness: number;
  effect: string;

  /** STT provider key. Dictation voices use this; realtime voices use
   *  the inner transcription embedded in the realtime session. */
  sttProvider: string;
  sttModel: string;

  /** Per-voice entity-state context the user always wants the model to
   *  know about. Names, not entity_ids — daemon resolves via the HA
   *  MCP server's state read. */
  includeEntities: string[];
  includePersons: string[];

  /** Free-form addendum appended to the system prompt. */
  addendum: string;

  /**
   * @deprecated Use `donePrompt`. Kept in sync on read + write so
   * existing UI editors that target this field still work; will be
   * dropped once the M04 voice-editor rewrite lands.
   */
  postProcessPrompt: string;
  postProcessProvider: "openai" | "openrouter";
  postProcessModel: string;

  /** One-line description for auto-routing. The router shows these to
   *  a small LLM ("which voice is best for this context?") so the more
   *  distinctive the routing hint, the better the routing accuracy. */
  routingHint: string;

  /** Built-in voices are seeded on first boot. The flag lets us
   *  distinguish "user created" from "shipped with the daemon" — the
   *  UI may surface this as a reset button, and migrations only
   *  touch the built-ins. */
  isBuiltin: boolean;
};

/** Subset of `Voice` accepted by voice-update endpoints. All fields
 *  optional so the client can send sparse updates without round-tripping
 *  the whole voice definition. */
export type VoiceUpdate = Partial<Omit<Voice, "id" | "isBuiltin">>;
