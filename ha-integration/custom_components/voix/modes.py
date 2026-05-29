"""Global mode catalog — user-defined presets.

A mode is a named preset that bundles:

    {
      "name":       "Work",                # human label
      "type":       "realtime",            # behavior: assist / dictation / realtime
      "prompt":     "You are ...",         # Jinja-templated system prompt
      "voice":      "echo",                # OpenAI voice (realtime only)
      "model":      "gpt-realtime",        # OpenAI model (realtime only)
      "color":      [r, g, b],             # idle LED color
      "brightness": 0.4,                   # 0.0-1.0
      "effect":     "None",                # light effect string
    }

Modes are stored in entry.options["modes"] as {mode_id: mode_def}. Each
device picks one mode_id at a time via its select.voix_mode_<device>
entity. The select's options are derived from the global mode catalog.

This module is the single source of truth for "what mode is mode_id?".
"""
from __future__ import annotations

from typing import Any

from homeassistant.config_entries import ConfigEntry

from .const import (
    CONF_DEFAULT_MODE,
    CONF_MODES,
    CONF_PROMPT_EXTRAS,
    DEFAULT_MODE_IDS,
    DEFAULT_MODES,
    MODE_TYPES,
)


def get_modes(entry: ConfigEntry) -> dict[str, dict]:
    """Return the active mode catalog. Falls back to builtins if empty."""
    modes = entry.options.get(CONF_MODES) or {}
    if not modes:
        return dict(DEFAULT_MODES)
    return modes


def get_mode(entry: ConfigEntry, mode_id: str | None) -> dict:
    """Return one mode by id, or the default mode if unknown."""
    modes = get_modes(entry)
    if mode_id and mode_id in modes:
        return modes[mode_id]
    return modes.get(get_default_mode_id(entry)) or next(iter(DEFAULT_MODES.values()))


def get_default_mode_id(entry: ConfigEntry) -> str:
    """Return the entry-wide default mode_id used for new devices."""
    explicit = entry.options.get(CONF_DEFAULT_MODE)
    if explicit and explicit in get_modes(entry):
        return explicit
    return DEFAULT_MODE_IDS[0]  # "default-assist"


def ensure_builtin_modes(opts: dict[str, Any]) -> dict[str, Any]:
    """Return options with the built-in modes merged in (no clobber).

    Also migrates older mode definitions: backfills `stt_provider` and
    `stt_model` for dictation-capable modes so existing setups pick up
    the default streaming-capable backend (openai-realtime) without
    breaking. No-op when fields are already present.
    """
    # Lazy import to dodge cycle: stt module pulls in HA helpers via the
    # backends, which can re-enter modes during integration setup.
    from .stt import DEFAULT_STT_PROVIDER, STT_PROVIDERS

    out = dict(opts)
    existing = dict(out.get(CONF_MODES) or {})
    for mid, mdef in DEFAULT_MODES.items():
        if mid not in existing:
            existing[mid] = dict(mdef)
    # Backfill STT defaults on every mode (cheap; only writes missing keys).
    for mid, mdef in list(existing.items()):
        if "stt_provider" not in mdef:
            mdef["stt_provider"] = DEFAULT_STT_PROVIDER
        if "stt_model" not in mdef:
            mdef["stt_model"] = STT_PROVIDERS.get(mdef["stt_provider"], ("", ""))[1]
    # One-shot migration: prompt-context fields used to live under a
    # global `prompt_extras` options key. Per-mode is the new model.
    # Copy global values into every mode that doesn't have them set yet,
    # then drop the global key. Runs on every setup but is a no-op after
    # the first time (since the global key is gone).
    legacy_extras = out.get(CONF_PROMPT_EXTRAS) or {}
    legacy_entities = list(legacy_extras.get("include_entities") or [])
    legacy_persons = list(legacy_extras.get("include_persons") or [])
    legacy_addendum = (legacy_extras.get("addendum") or "").strip()
    for mid, mdef in list(existing.items()):
        if "include_entities" not in mdef:
            mdef["include_entities"] = list(legacy_entities)
        if "include_persons" not in mdef:
            mdef["include_persons"] = list(legacy_persons)
        if "addendum" not in mdef:
            mdef["addendum"] = legacy_addendum
    if CONF_PROMPT_EXTRAS in out:
        out.pop(CONF_PROMPT_EXTRAS, None)

    # Backfill post-processing + routing fields on every mode. These are
    # the Supershout-style "after STT, run raw through an LLM with this
    # system prompt" knobs. Empty / null means "no post-processing"; the
    # bridge skips the LLM round-trip in that case.
    for mid, mdef in list(existing.items()):
        if "post_process_prompt" not in mdef:
            mdef["post_process_prompt"] = ""
        if "post_process_provider" not in mdef:
            mdef["post_process_provider"] = "openai"
        if "post_process_model" not in mdef:
            mdef["post_process_model"] = "gpt-4o-mini"
        if "routing_hint" not in mdef:
            mdef["routing_hint"] = ""
    out[CONF_MODES] = existing
    if not out.get(CONF_DEFAULT_MODE):
        out[CONF_DEFAULT_MODE] = DEFAULT_MODE_IDS[0]
    return out


def validate_mode_def(mode_def: dict) -> tuple[bool, str | None]:
    """Sanity-check a mode definition. Returns (ok, error_str)."""
    name = (mode_def.get("name") or "").strip()
    if not name:
        return False, "name required"
    mtype = mode_def.get("type")
    if mtype not in MODE_TYPES:
        return False, f"type must be one of {MODE_TYPES}"
    color = mode_def.get("color")
    if not (isinstance(color, list) and len(color) == 3 and all(
        isinstance(c, int) and 0 <= c <= 255 for c in color
    )):
        return False, "color must be [r,g,b] with 0-255 ints"
    bright = mode_def.get("brightness")
    if not (isinstance(bright, (int, float)) and 0.0 <= bright <= 1.0):
        return False, "brightness must be 0.0-1.0"
    return True, None


def slugify_mode_id(name: str) -> str:
    """Convert a user-facing mode name to a stable id slug."""
    import re
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-") or "mode"
