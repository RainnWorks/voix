"""Constants for the voix integration."""
from __future__ import annotations

DOMAIN = "voix"

# ─── Config-entry keys ───────────────────────────────────────────────────────
# Mode C (dictation conversation agent)
CONF_DICTATION_HELPER = "dictation_helper"
CONF_LED_RING_ENTITY = "led_ring_entity"
# Mode B (Realtime via STT/TTS engines through the HA pipeline)
CONF_OPENAI_API_KEY = "openai_api_key"
# OpenRouter is an optional second LLM provider, used by per-mode
# post-processing (set the mode's `post_process_provider` to "openrouter").
# OpenAI remains the only choice for STT + realtime sessions; OpenRouter
# is text-completion-only on the voix side.
CONF_OPENROUTER_API_KEY = "openrouter_api_key"

# Daemon URL — when set, the integration switches puck adoption to point
# at the voix-backend daemon (HA Add-on or external) instead of the
# legacy in-HA WS bridge.
#
# Example values:
#   • `ws://homeassistant.local:8765/ws` — daemon running as the HA
#     Add-on on the default port; pucks reach it via the host
#     forwarder.
#   • `ws://192.168.1.42:8765/ws` — daemon running on a separate Docker
#     host or development machine.
#
# Required: the integration no longer ships an in-HA audio bridge. When
# unset, voix adoption skips the puck push and logs a warning telling
# the user where to set it.
CONF_DAEMON_URL = "daemon_url"
CONF_REALTIME_MODEL = "realtime_model"
CONF_REALTIME_VOICE = "realtime_voice"
CONF_REALTIME_INSTRUCTIONS = "realtime_instructions"

# Shared-secret token required in the device's WS hello message. Generated
# at first setup and stored in entry.data so it survives restarts. The
# firmware sends it in the hello payload; mismatched/missing token → server
# refuses the session (cost-leak prevention on shared LANs).
CONF_WS_TOKEN = "ws_token"

# Idle close timeout (seconds without OpenAI activity → session closes).
# Configurable in the integration's Options → Defaults form. Defaults to
# 5 s: short enough that the assistant doesn't keep monologuing at the user
# after they've finished, but long enough to span a natural conversational
# pause. Hard ceiling (SESSION_HARD_MAX_S) is separate.
CONF_IDLE_TIMEOUT_S = "idle_timeout_s"
DEFAULT_IDLE_TIMEOUT_S = 5.0

# Catalog of OpenAI Realtime voices (per OpenAI 2026-05 release):
# - marin / cedar are the new highest-quality voices (Realtime-exclusive)
# - the rest were updated to benefit from the same improvements
REALTIME_VOICES: list[str] = [
    "alloy", "ash", "ballad", "coral", "echo",
    "sage", "shimmer", "verse", "marin", "cedar",
]

# Entry-wide default voice used by modes that leave `voice` unset.
# Tied to select.voix_voice on the voix gateway device.
CONF_DEFAULT_VOICE = "default_voice"

# Entry-wide default OpenAI model used by modes that leave `model` unset.
# Tied to text.voix_realtime_model on the voix gateway device. Free-text
# (model names change frequently and there's no fixed enum).
CONF_DEFAULT_MODEL = "default_model"

# Wake-word management. voix owns the device's two wake-word slots:
#   slot 2 (`<device>_wake_word_2`) → the voix wake word (intercept)
#   slot 1 (`<device>_wake_word`)   → the Assist wake word (passthrough)
# Gateway entities `select.voix_wake_word` + `select.voix_assist_wake_word`
# let the user pick once; on device discovery (and on user change) we
# push the values to every Voice PE's slot selects via select.select_option.
KNOWN_WAKE_WORDS = [
    "Okay Nabu",
    "Hey Jarvis",
    "Hey Mycroft",
    "Stop",
]
CONF_VOIX_WAKE_WORD = "voix_wake_word"
CONF_ASSIST_WAKE_WORD = "assist_wake_word"
DEFAULT_VOIX_WAKE_WORD = "Hey Mycroft"
DEFAULT_ASSIST_WAKE_WORD = "Okay Nabu"

# Gateway device identifier — a virtual device that hosts global voix
# entities (voice select, idle timeout, default mode). Each Voice PE is a
# separate device; the gateway groups integration-wide settings under one
# user-visible device entry.
GATEWAY_DEVICE_ID = "voix_gateway"

# ─── Defaults ────────────────────────────────────────────────────────────────
DEFAULT_DICTATION_HELPER = "input_text.voix_dictation_buffer"
DEFAULT_LED_RING_ENTITY = "light.home_assistant_voice_095e4e_led_ring"
DEFAULT_REALTIME_MODEL = "gpt-realtime-2"
DEFAULT_REALTIME_VOICE = "alloy"
DEFAULT_REALTIME_INSTRUCTIONS = (
    "You are voix — a concise, friendly voice assistant running on a "
    "Home Assistant Voice PE puck in this household. The current speaker "
    "is one of the people listed in the context above; greet them by name "
    "if you can identify them from what they say.\n\n"
    "Style:\n"
    "- Keep responses to one or two short sentences unless the user "
    "asks for detail. Voice is high-bandwidth for you, low-bandwidth "
    "for them.\n"
    "- Speak naturally. No bullet lists, no markdown, no \"as an AI\".\n"
    "- If the user gives a command (turn on, set, play) act on it "
    "immediately and confirm tersely (\"on\", \"done\", \"got it\"). "
    "Don't ask permission for things they already asked for.\n"
    "- If a device or area name is ambiguous, ask one clarifying "
    "question instead of guessing. Multiple lights named \"lamp\" "
    "is the usual case — name the area to disambiguate.\n"
    "- When you finish a conversational thread and there's no obvious "
    "follow-up, call the voix_end_session tool to close the mic. "
    "Don't drag a session out with \"is there anything else\".\n"
    "- Never repeat the user's question back to them before answering. "
    "Just answer."
)

# ─── Audio ───────────────────────────────────────────────────────────────────
# Voice PE / standard HA Assist STT pipeline metadata.
SATELLITE_SAMPLE_RATE = 16000
REALTIME_SAMPLE_RATE = 24000
AUDIO_FORMAT_BYTES_PER_SAMPLE = 2  # PCM16

# Idle timeout before we close the Realtime WS after the last activity.
# Multi-turn keeps the WS open across `continue_conversation` re-listens;
# this catches "user walked away" so we don't leak the OpenAI session.
REALTIME_IDLE_TIMEOUT_S = 45.0

# ─── Modes ───────────────────────────────────────────────────────────────────
# A "mode" is a user-defined preset bundling: a behavior type (assist /
# dictation / realtime), a prompt, voice/model, and LED idle colour. Modes
# are GLOBAL to the integration. Each device picks one mode at a time.
#
# MODE_TYPES are the only three actual behaviors the device can do. Users
# can create as many modes as they like, but each must be of one of these
# types (e.g. mode "Work" of type "realtime" with prompt "You're a focused...";
# mode "Home" of type "realtime" with prompt "You're a casual...").

MODE_TYPE_ASSIST = "assist"
MODE_TYPE_DICTATION = "dictation"
MODE_TYPE_REALTIME = "realtime"
# MODE_TYPE_ASSIST is intentionally NOT in MODE_TYPES — the split-wake-word
# model means "Okay Nabu" goes straight to upstream HA Assist (we don't
# intercept it). A voix-mode of type=assist on the voix wake word makes
# no sense: the firmware already stops voice_assistant on detection and
# we'd decline the bridge, leaving the wake word a silent no-op. The
# constant is kept for the migration path that removes legacy
# `default-assist` modes from existing config entries.
MODE_TYPES = [MODE_TYPE_DICTATION, MODE_TYPE_REALTIME]

# entry.options["modes"] = {mode_id: mode_def}
CONF_MODES = "modes"
# entry.options["default_mode"] = mode_id used for new devices on first sight
CONF_DEFAULT_MODE = "default_mode"

# Global "always-included" prompt context that's prepended to every mode's
# prompt (after HA's auto-generated tool prompt). Lets users pin specific
# entities/people they always want the model to know about, plus a freeform
# addendum (rules, preferences).
#
# entry.options["prompt_extras"] = {
#   "include_entities": ["person.tom", "light.kitchen", ...],
#   "include_persons":  ["person.tom"],   # surfaces "Tom is home" style lines
#   "addendum":         "Free-form text appended to the base prompt.",
# }
CONF_PROMPT_EXTRAS = "prompt_extras"
DEFAULT_PROMPT_EXTRAS: dict = {
    "include_entities": [],
    "include_persons": [],
    "addendum": "",
}

# Built-in mode IDs. Created automatically on first integration setup so
# the system is usable out-of-the-box. User can rename/edit/delete via
# the options flow.
#
# Note: there's NO `default-assist` mode any more. In the split model
# the "Okay Nabu" wake word goes straight to upstream HA Assist —
# bypassing voix entirely — and the voix wake word ("Hey Mycroft" or
# whatever the user picks for slot 2) drives the catalog below. So
# Assist is always available, just not through this catalog.
# Post-processing prompts for the built-in dictation modes. Ported from
# Supershout (github.com/thenairn/supershout) — they're already well-tuned
# and tested. Each is a system prompt for a small LLM (gpt-4o-mini default)
# that runs over the raw transcription and returns polished text.
#
# Common rules in every prompt: don't invent details, return ONLY the
# requested output, preserve the speaker's intent.
_PP_MESSAGE = (
    "You are a speech-to-text post-processor for casual messages "
    "(Slack, Discord, iMessage, WhatsApp).\n\n"
    "Rules:\n"
    "- Remove filler words (um, uh, like, you know, basically, I mean, "
    "sort of, kind of)\n"
    "- Remove false starts and repeated phrases\n"
    "- Fix grammar and add punctuation\n"
    "- Keep the tone casual and conversational — this should sound like "
    "the speaker typed it, not dictated it\n"
    "- Preserve slang, humor, and informal expressions\n"
    "- Use lowercase style where natural (no unnecessary capitalization)\n"
    "- Do NOT add greetings, sign-offs, or emoji\n"
    "- Do NOT expand the message or add content that wasn't spoken\n"
    "- If the speaker said something like \"new line\" or \"new paragraph,\" "
    "treat it as a formatting instruction\n"
    "- Return ONLY the cleaned message text, nothing else"
)

_PP_EMAIL = (
    "You are a speech-to-text post-processor for professional emails.\n\n"
    "Rules:\n"
    "- Remove all filler words and verbal hesitations\n"
    "- Transform spoken language into polished written English with a "
    "professional but not stiff tone\n"
    "- Structure the email with clear paragraphs — one idea per paragraph\n"
    "- Add an appropriate greeting (\"Hi [name],\" if a name was mentioned, "
    "otherwise \"Hi,\") and a closing (\"Best,\" or \"Thanks,\")\n"
    "- Fix grammar, punctuation, and sentence structure\n"
    "- Preserve the speaker's intent, key points, and any specific requests "
    "or deadlines mentioned\n"
    "- If the speaker mentioned a subject line, place it on the first line "
    "prefixed with \"Subject: \"\n"
    "- Do NOT invent details, names, dates, or commitments that weren't spoken\n"
    "- Do NOT make the tone overly formal or corporate — aim for clear and "
    "professional\n"
    "- Return ONLY the formatted email text, nothing else"
)

_PP_NOTE = (
    "You are a speech-to-text post-processor for note-taking apps "
    "(Notion, Obsidian, Bear, Apple Notes).\n\n"
    "Rules:\n"
    "- Remove filler words and verbal clutter\n"
    "- Organize spoken thoughts into clean, structured notes\n"
    "- Use markdown formatting where it helps readability:\n"
    "  - Headings (## or ###) if the speaker covered distinct topics\n"
    "  - Bullet points for lists, ideas, or multiple items\n"
    "  - Bold for key terms or important points the speaker emphasized\n"
    "- Preserve the speaker's own structure — if they listed things, "
    "keep them as a list\n"
    "- Keep the language concise but complete — notes should be useful "
    "when read later\n"
    "- If the speaker mentioned action items or todos, format them as a "
    "checklist (- [ ])\n"
    "- Do NOT add titles, headers, or metadata the speaker didn't mention\n"
    "- Do NOT summarize or lose detail — capture everything that was said, "
    "just organized\n"
    "- Return ONLY the formatted note text in markdown, nothing else"
)

_PP_CODE = (
    "You are a speech-to-text post-processor that converts spoken "
    "instructions into clear prompts for AI coding assistants (Claude "
    "Code, Cursor, Copilot Chat, aider).\n\n"
    "Rules:\n"
    "- Remove filler words, false starts, and conversational scaffolding "
    "(\"so basically what I want is...\", \"and then like...\")\n"
    "- Preserve ALL technical terms exactly as spoken: function names, "
    "variable names, file paths, package names, CLI commands, API "
    "endpoints, framework terminology\n"
    "- When the speaker spells something out letter by letter, combine it "
    "into the intended word or identifier\n"
    "- Preserve camelCase, snake_case, PascalCase, and kebab-case "
    "identifiers — do not \"fix\" their casing\n"
    "- Structure the output as a clear, direct instruction — the kind "
    "you'd type into a coding assistant\n"
    "- If multiple tasks were described, use numbered steps\n"
    "- If the speaker referenced specific files or paths, keep them "
    "exactly as stated\n"
    "- Convert vague spoken references to precise ones where obvious "
    "(e.g., \"that component\" → use the name if they said it earlier)\n"
    "- Do NOT add code blocks, markdown formatting, or explanatory text\n"
    "- Do NOT write actual code — the output is a PROMPT for an AI coder, "
    "not code itself\n"
    "- Do NOT add pleasantries (\"please\", \"could you\") — be direct\n"
    "- Return ONLY the formatted prompt text, nothing else"
)


DEFAULT_MODE_IDS = (
    "default-realtime",
    "default-dictation",
    "default-message",
    "default-email",
    "default-note",
    "default-code",
)

DEFAULT_MODES: dict[str, dict] = {
    "default-realtime": {
        "name": "Realtime",
        "type": MODE_TYPE_REALTIME,
        "prompt": DEFAULT_REALTIME_INSTRUCTIONS,
        "voice": DEFAULT_REALTIME_VOICE,
        "model": DEFAULT_REALTIME_MODEL,
        "color": [255, 51, 204],
        "brightness": 0.40,
        "effect": "None",
    },
    "default-dictation": {
        "name": "Dictation",
        "type": MODE_TYPE_DICTATION,
        "prompt": "",
        "voice": "",
        "model": "",
        "color": [255, 178, 0],
        "brightness": 0.40,
        "effect": "None",
        "routing_hint": "Raw transcription with no processing. "
                        "Use when exact words matter.",
    },
    "default-message": {
        "name": "Message",
        "type": MODE_TYPE_DICTATION,
        "prompt": "",
        "voice": "",
        "model": "",
        "color": [76, 175, 80],   # green — casual
        "brightness": 0.40,
        "effect": "None",
        "post_process_prompt": _PP_MESSAGE,
        "post_process_provider": "openai",
        "post_process_model": "gpt-4o-mini",
        "routing_hint": "Clean up casual messages. Use for chat apps like "
                        "Slack, Discord, iMessage, WhatsApp.",
    },
    "default-email": {
        "name": "Email",
        "type": MODE_TYPE_DICTATION,
        "prompt": "",
        "voice": "",
        "model": "",
        "color": [33, 150, 243],  # blue — professional
        "brightness": 0.40,
        "effect": "None",
        "post_process_prompt": _PP_EMAIL,
        "post_process_provider": "openai",
        "post_process_model": "gpt-4o-mini",
        "routing_hint": "Format as professional email. Use for mail apps "
                        "and email compose.",
    },
    "default-note": {
        "name": "Note",
        "type": MODE_TYPE_DICTATION,
        "prompt": "",
        "voice": "",
        "model": "",
        "color": [156, 39, 176],  # purple — structured thought
        "brightness": 0.40,
        "effect": "None",
        "post_process_prompt": _PP_NOTE,
        "post_process_provider": "openai",
        "post_process_model": "gpt-4o-mini",
        "routing_hint": "Format as structured notes with markdown. Use for "
                        "note-taking apps like Notion, Obsidian, Bear.",
    },
    "default-code": {
        "name": "Code",
        "type": MODE_TYPE_DICTATION,
        "prompt": "",
        "voice": "",
        "model": "",
        "color": [0, 188, 212],   # cyan — engineering
        "brightness": 0.40,
        "effect": "None",
        "post_process_prompt": _PP_CODE,
        "post_process_provider": "openai",
        "post_process_model": "gpt-4o-mini",
        "routing_hint": "Format speech as prompts for AI coding assistants. "
                        "Use in terminals, IDEs, and coding tools.",
    },
}

# DEFAULT_MODE is the mode_id used for new devices on first discovery
# (until the user picks something different). Realtime is the more
# interesting starting point for the voix wake word.
DEFAULT_MODE = "default-realtime"

# ─── HA bus events ───────────────────────────────────────────────────────────
EVENT_DICTATION_CAPTURED = "voix_dictation_captured"
EVENT_REALTIME_SESSION_STARTED = "voix_realtime_session_started"
EVENT_REALTIME_SESSION_ENDED = "voix_realtime_session_ended"
EVENT_REALTIME_TURN_END = "voix_realtime_turn_end"
# Per-turn transcript events fired by the realtime bridge. The Tauri
# companion app subscribes to these to reassemble a full conversation log
# across both speakers. Payload: {text, device_id, role, session_id}.
EVENT_REALTIME_USER_TRANSCRIPT = "voix_realtime_user_transcript"
EVENT_REALTIME_ASSISTANT_TRANSCRIPT = "voix_realtime_assistant_transcript"

# Live-stream delta event — fires on every transcript chunk the bridge
# receives from OpenAI, before turn completion. Used by the Tauri app
# for low-latency streaming display (alternative to polling the file).
# Payload: {device_id, role, session_id, delta, char_count}.
EVENT_TRANSCRIPT_DELTA = "voix_transcript_delta"

# Dispatcher signal: per-device, per-role transcript update.
# Args: (device_id, role, filepath, status, session_id, char_count).
# Sensors listen and put `filepath` in state, `status`/`char_count`/etc
# in attributes. Full text lives on disk — see _TranscriptStore in
# ws_view.py. Sensors no longer carry the text directly (HA's 255-char
# state limit + 16 KB total attribute cap made long dictations unusable).
SIGNAL_TRANSCRIPT_UPDATED = f"{DOMAIN}_transcript_updated"
EVENT_MODE_CHANGED = "voix_mode_changed"

# ─── Transcript file storage ─────────────────────────────────────────────────
# Transcripts are written to <config>/voix/transcripts/<device_slug>/...
# One plain-text file per session per role; cumulative across all turns in
# the session. Served via the `voix.get_transcript` service which takes a
# filepath and returns the content (response data, requires HA's
# supports_response API).
TRANSCRIPTS_DIRNAME = "voix/transcripts"

# ─── Services ────────────────────────────────────────────────────────────────
SERVICE_CYCLE_MODE = "cycle_mode"
SERVICE_SET_MODE = "set_mode"
# Mode CRUD from the desktop app. Same fields as the options flow form,
# just bypassing the UI so the Tauri app can write back instantly.
SERVICE_CREATE_MODE = "create_mode"
SERVICE_UPDATE_MODE = "update_mode"
SERVICE_DELETE_MODE = "delete_mode"
# Transcript fetch — pass filepath from a sensor's state, get file content.
SERVICE_GET_TRANSCRIPT = "get_transcript"
# List all modes with their full definitions (prompt, voice, model, color,
# brightness, effect). The HA UI / light entities only expose color +
# brightness + effect; the desktop app needs the rest to render a proper
# editor. Returns response data, no side effects.
SERVICE_LIST_MODES = "list_modes"

# ─── OpenAI ──────────────────────────────────────────────────────────────────
REALTIME_WS_URL = "wss://api.openai.com/v1/realtime"
