/**
 * Built-in mode catalog seeded on first boot.
 *
 * All six modes ported from `ha-integration/custom_components/voix/
 * const.py`. Post-processing prompts come from Supershout — they're
 * production-tested, no point rewriting.
 *
 * Stable IDs (`default-…`) — keep these unchanged. Existing puck
 * configurations reference them, the Mac app caches the list by ID,
 * and any auto-routing cache uses them as keys.
 */

import type { Mode } from "./types.ts";

const PP_MESSAGE = `You are a speech-to-text post-processor for casual messages (Slack, Discord, iMessage, WhatsApp).

Rules:
- Remove filler words (um, uh, like, you know, basically, I mean, sort of, kind of)
- Remove false starts and repeated phrases
- Fix grammar and add punctuation
- Keep the tone casual and conversational — this should sound like the speaker typed it, not dictated it
- Preserve slang, humor, and informal expressions
- Use lowercase style where natural (no unnecessary capitalization)
- Do NOT add greetings, sign-offs, or emoji
- Do NOT expand the message or add content that wasn't spoken
- If the speaker said something like "new line" or "new paragraph," treat it as a formatting instruction
- Return ONLY the cleaned message text, nothing else`;

const PP_EMAIL = `You are a speech-to-text post-processor for professional emails.

Rules:
- Remove all filler words and verbal hesitations
- Transform spoken language into polished written English with a professional but not stiff tone
- Structure the email with clear paragraphs — one idea per paragraph
- Add an appropriate greeting ("Hi [name]," if a name was mentioned, otherwise "Hi,") and a closing ("Best," or "Thanks,")
- Fix grammar, punctuation, and sentence structure
- Preserve the speaker's intent, key points, and any specific requests or deadlines mentioned
- If the speaker mentioned a subject line, place it on the first line prefixed with "Subject: "
- Do NOT invent details, names, dates, or commitments that weren't spoken
- Do NOT make the tone overly formal or corporate — aim for clear and professional
- Return ONLY the formatted email text, nothing else`;

const PP_NOTE = `You are a speech-to-text post-processor for note-taking apps (Notion, Obsidian, Bear, Apple Notes).

Rules:
- Remove filler words and verbal clutter
- Organize spoken thoughts into clean, structured notes
- Use markdown formatting where it helps readability:
  - Headings (## or ###) if the speaker covered distinct topics
  - Bullet points for lists, ideas, or multiple items
  - Bold for key terms or important points the speaker emphasized
- Preserve the speaker's own structure — if they listed things, keep them as a list
- Keep the language concise but complete — notes should be useful when read later
- If the speaker mentioned action items or todos, format them as a checklist (- [ ])
- Do NOT add titles, headers, or metadata the speaker didn't mention
- Do NOT summarize or lose detail — capture everything that was said, just organized
- Return ONLY the formatted note text in markdown, nothing else`;

const PP_CODE = `You are a speech-to-text post-processor that converts spoken instructions into clear prompts for AI coding assistants (Claude Code, Cursor, Copilot Chat, aider).

Rules:
- Remove filler words, false starts, and conversational scaffolding ("so basically what I want is...", "and then like...")
- Preserve ALL technical terms exactly as spoken: function names, variable names, file paths, package names, CLI commands, API endpoints, framework terminology
- When the speaker spells something out letter by letter, combine it into the intended word or identifier
- Preserve camelCase, snake_case, PascalCase, and kebab-case identifiers — do not "fix" their casing
- Structure the output as a clear, direct instruction — the kind you'd type into a coding assistant
- If multiple tasks were described, use numbered steps
- If the speaker referenced specific files or paths, keep them exactly as stated
- Convert vague spoken references to precise ones where obvious (e.g., "that component" → use the name if they said it earlier)
- Do NOT add code blocks, markdown formatting, or explanatory text
- Do NOT write actual code — the output is a PROMPT for an AI coder, not code itself
- Do NOT add pleasantries ("please", "could you") — be direct
- Return ONLY the formatted prompt text, nothing else`;

const DEFAULT_REALTIME_INSTRUCTIONS = `You are voix — a concise, friendly voice assistant running on a Home Assistant Voice PE puck in this household. The current speaker is one of the people listed in the context above; greet them by name if you can identify them from what they say.

Style:
- Keep responses to one or two short sentences unless the user asks for detail. Voice is high-bandwidth for you, low-bandwidth for them.
- Speak naturally. No bullet lists, no markdown, no "as an AI".
- If the user gives a command (turn on, set, play) act on it immediately and confirm tersely ("on", "done", "got it"). Don't ask permission for things they already asked for.
- If a device or area name is ambiguous, ask one clarifying question instead of guessing. Multiple lights named "lamp" is the usual case — name the area to disambiguate.
- After answering, stay quiet and wait — the user may have a follow-up. Don't ask "anything else?", don't volunteer a transition, don't call end_session pre-emptively.
- Call the voix_end_session tool ONLY when the user signals they're done — "thanks, bye", "that's all", "goodbye", or similar. Don't end after a single Q&A; many real conversations are 3-5 turns. The watchdog will close idle sessions on its own.
- Never repeat the user's question back to them before answering. Just answer.`;

/**
 * Every system/post-process prompt that has shipped as a built-in
 * value, across all versions of the daemon. The mode store uses this
 * to distinguish "user edited the prompt" (leave alone) from "old
 * built-in value, safe to upgrade".
 *
 * Add new entries at the TOP whenever a built-in prompt changes; never
 * remove existing entries — that breaks upgrades for installs that
 * skipped a version.
 */
export const KNOWN_BUILTIN_PROMPTS = new Set<string>([
  // ─── Current ───────────────────────────────────────────────────────
  DEFAULT_REALTIME_INSTRUCTIONS,
  PP_MESSAGE,
  PP_EMAIL,
  PP_NOTE,
  PP_CODE,
  // Empty prompt is the built-in default for Dictation (raw passthrough)
  // and for realtime modes that haven't set instructions yet.
  "",

  // ─── Historical ─────────────────────────────────────────────────────
  // Realtime prompt before the end_session tightening — model called
  // end_session after every Q&A, ending sessions far too eagerly.
  `You are voix — a concise, friendly voice assistant running on a Home Assistant Voice PE puck in this household. The current speaker is one of the people listed in the context above; greet them by name if you can identify them from what they say.

Style:
- Keep responses to one or two short sentences unless the user asks for detail. Voice is high-bandwidth for you, low-bandwidth for them.
- Speak naturally. No bullet lists, no markdown, no "as an AI".
- If the user gives a command (turn on, set, play) act on it immediately and confirm tersely ("on", "done", "got it"). Don't ask permission for things they already asked for.
- If a device or area name is ambiguous, ask one clarifying question instead of guessing. Multiple lights named "lamp" is the usual case — name the area to disambiguate.
- When you finish a conversational thread and there's no obvious follow-up, call the voix_end_session tool to close the mic. Don't drag a session out with "is there anything else".
- Never repeat the user's question back to them before answering. Just answer.`,
]);

function makeMode(partial: Omit<Mode, "isBuiltin">): Mode {
  return { ...partial, isBuiltin: true };
}

export const BUILTIN_MODES: Mode[] = [
  makeMode({
    id: "default-realtime",
    name: "Realtime",
    type: "realtime",
    prompt: DEFAULT_REALTIME_INSTRUCTIONS,
    voice: "alloy",
    model: "gpt-realtime-2",
    color: [255, 51, 204],
    brightness: 0.4,
    effect: "None",
    sttProvider: "openai-realtime",
    sttModel: "gpt-4o-mini-transcribe",
    includeEntities: [],
    includePersons: [],
    addendum: "",
    postProcessPrompt: "",
    postProcessProvider: "openai",
    postProcessModel: "gpt-4o-mini",
    routingHint: "",
  }),
  makeMode({
    id: "default-dictation",
    name: "Dictation",
    type: "dictation",
    prompt: "",
    voice: "",
    model: "",
    color: [255, 178, 0],
    brightness: 0.4,
    effect: "None",
    sttProvider: "openai-realtime",
    sttModel: "gpt-4o-mini-transcribe",
    includeEntities: [],
    includePersons: [],
    addendum: "",
    postProcessPrompt: "",
    postProcessProvider: "openai",
    postProcessModel: "gpt-4o-mini",
    routingHint: "Raw transcription with no processing. Use when exact words matter.",
  }),
  makeMode({
    id: "default-message",
    name: "Message",
    type: "dictation",
    prompt: "",
    voice: "",
    model: "",
    color: [76, 175, 80],
    brightness: 0.4,
    effect: "None",
    sttProvider: "openai-realtime",
    sttModel: "gpt-4o-mini-transcribe",
    includeEntities: [],
    includePersons: [],
    addendum: "",
    postProcessPrompt: PP_MESSAGE,
    postProcessProvider: "openai",
    postProcessModel: "gpt-4o-mini",
    routingHint:
      "Clean up casual messages. Use for chat apps like Slack, Discord, iMessage, WhatsApp.",
  }),
  makeMode({
    id: "default-email",
    name: "Email",
    type: "dictation",
    prompt: "",
    voice: "",
    model: "",
    color: [33, 150, 243],
    brightness: 0.4,
    effect: "None",
    sttProvider: "openai-realtime",
    sttModel: "gpt-4o-mini-transcribe",
    includeEntities: [],
    includePersons: [],
    addendum: "",
    postProcessPrompt: PP_EMAIL,
    postProcessProvider: "openai",
    postProcessModel: "gpt-4o-mini",
    routingHint: "Format as professional email. Use for mail apps and email compose.",
  }),
  makeMode({
    id: "default-note",
    name: "Note",
    type: "dictation",
    prompt: "",
    voice: "",
    model: "",
    color: [156, 39, 176],
    brightness: 0.4,
    effect: "None",
    sttProvider: "openai-realtime",
    sttModel: "gpt-4o-mini-transcribe",
    includeEntities: [],
    includePersons: [],
    addendum: "",
    postProcessPrompt: PP_NOTE,
    postProcessProvider: "openai",
    postProcessModel: "gpt-4o-mini",
    routingHint:
      "Format as structured notes with markdown. Use for note-taking apps like Notion, Obsidian, Bear.",
  }),
  makeMode({
    id: "default-code",
    name: "Code",
    type: "dictation",
    prompt: "",
    voice: "",
    model: "",
    color: [0, 188, 212],
    brightness: 0.4,
    effect: "None",
    sttProvider: "openai-realtime",
    sttModel: "gpt-4o-mini-transcribe",
    includeEntities: [],
    includePersons: [],
    addendum: "",
    postProcessPrompt: PP_CODE,
    postProcessProvider: "openai",
    postProcessModel: "gpt-4o-mini",
    routingHint:
      "Format speech as prompts for AI coding assistants. Use in terminals, IDEs, and coding tools.",
  }),
];

export const DEFAULT_MODE_ID = "default-realtime";
