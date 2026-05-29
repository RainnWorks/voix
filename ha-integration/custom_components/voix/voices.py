"""Global voice catalog — user-defined presets.

A voice is a named preset that bundles: a type (realtime / dictation),
a system prompt, voice + model, an LED colour, and post-processing
hooks. The integration ships a small built-in catalog; users add or
edit theirs through the options flow or the desktop app.

This is the M02d-renamed surface. The previous module name was
``modes.py``; both names import the same functions so any external
caller (including the daemon's HA sync layer) keeps working. Storage
on disk is unchanged — entry.options still uses the ``modes`` key —
because forcing a config-entry storage migration buys nothing visible
to the user.
"""
from __future__ import annotations

from .modes import (
    ensure_builtin_modes,
    get_default_mode_id,
    get_mode,
    get_modes,
    slugify_mode_id,
    validate_mode_def,
)


# Canonical aliases — voice vocabulary, same behaviour.
get_voices = get_modes
get_voice = get_mode
get_default_voice_id = get_default_mode_id
ensure_builtin_voices = ensure_builtin_modes
validate_voice_def = validate_mode_def
slugify_voice_id = slugify_mode_id


__all__ = [
    # Canonical (M02d+)
    "get_voices",
    "get_voice",
    "get_default_voice_id",
    "ensure_builtin_voices",
    "validate_voice_def",
    "slugify_voice_id",
    # Deprecated aliases — same callables, kept for any legacy caller.
    "get_modes",
    "get_mode",
    "get_default_mode_id",
    "ensure_builtin_modes",
    "validate_mode_def",
    "slugify_mode_id",
]
