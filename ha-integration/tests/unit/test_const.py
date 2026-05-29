"""Pure-logic invariants over `custom_components.voix.const`.

These are the contract tests for what the integration promises about its
defaults — change them deliberately, not accidentally.
"""
from __future__ import annotations

import pytest

from custom_components.voix import const
from custom_components.voix.const import (
    DEFAULT_MODE_IDS,
    DEFAULT_MODES,
    MODE_TYPE_ASSIST,
    MODE_TYPE_DICTATION,
    MODE_TYPE_REALTIME,
    MODE_TYPES,
)


# ─── Behavior types ──────────────────────────────────────────────────────────


def test_mode_types_are_exactly_the_three_behaviors():
    """Given MODE_TYPES, When inspected, Then it is exactly [assist, dictation, realtime]."""
    assert MODE_TYPES == [MODE_TYPE_ASSIST, MODE_TYPE_DICTATION, MODE_TYPE_REALTIME]
    assert len(MODE_TYPES) == 3
    assert len(set(MODE_TYPES)) == 3


def test_mode_type_strings_are_the_canonical_names():
    """Given the type constants, When inspected, Then they are the literal HA-pipeline names."""
    assert MODE_TYPE_ASSIST == "assist"
    assert MODE_TYPE_DICTATION == "dictation"
    assert MODE_TYPE_REALTIME == "realtime"


# ─── Builtin modes ───────────────────────────────────────────────────────────


def test_builtin_modes_are_dictation_and_realtime():
    """Given DEFAULT_MODES, When counted, Then exactly 2 builtins exist (split model).

    Assist is intentionally absent: in the split model "Okay Nabu" is the
    Assist wake-word and goes through stock HA without touching voix. The
    voix wake-word cycles through dictation and realtime only.
    """
    assert len(DEFAULT_MODES) == 2
    assert set(DEFAULT_MODES.keys()) == {
        "default-dictation",
        "default-realtime",
    }


def test_default_mode_ids_matches_defaults_dict():
    """Given DEFAULT_MODE_IDS, When compared to DEFAULT_MODES keys, Then they are the same set."""
    assert set(DEFAULT_MODE_IDS) == set(DEFAULT_MODES.keys())
    # default-realtime comes first — used as the fallback when no
    # explicit default_mode is set in entry.options.
    assert DEFAULT_MODE_IDS[0] == "default-realtime"


@pytest.mark.parametrize("mode_id", list(DEFAULT_MODES.keys()))
def test_each_builtin_has_all_required_keys(mode_id):
    """Given each builtin mode, When inspected, Then it carries every key the integration reads."""
    mdef = DEFAULT_MODES[mode_id]
    required = {"name", "type", "prompt", "voice", "model", "color", "brightness", "effect"}
    assert required.issubset(mdef.keys())


@pytest.mark.parametrize("mode_id", list(DEFAULT_MODES.keys()))
def test_each_builtin_type_is_canonical(mode_id):
    """Given each builtin, When type is checked, Then it is one of MODE_TYPES."""
    assert DEFAULT_MODES[mode_id]["type"] in MODE_TYPES


@pytest.mark.parametrize("mode_id", list(DEFAULT_MODES.keys()))
def test_each_builtin_color_is_well_formed(mode_id):
    """Given each builtin, When color inspected, Then it's [r,g,b] with 0-255 ints."""
    color = DEFAULT_MODES[mode_id]["color"]
    assert isinstance(color, list)
    assert len(color) == 3
    for c in color:
        assert isinstance(c, int)
        assert 0 <= c <= 255


@pytest.mark.parametrize("mode_id", list(DEFAULT_MODES.keys()))
def test_each_builtin_brightness_in_range(mode_id):
    """Given each builtin, When brightness inspected, Then 0.0 <= b <= 1.0."""
    b = DEFAULT_MODES[mode_id]["brightness"]
    assert isinstance(b, (int, float))
    assert 0.0 <= b <= 1.0


def test_builtin_colors_are_visually_distinct():
    """Given the 2 builtins, When their colors compared, Then they differ."""
    colors = [tuple(DEFAULT_MODES[m]["color"]) for m in DEFAULT_MODES]
    assert len(set(colors)) == len(DEFAULT_MODES)


def test_builtin_type_to_id_mapping_is_one_to_one():
    """Each builtin maps to a unique MODE_TYPE (no assist in catalog, split model)."""
    by_type: dict[str, list[str]] = {}
    for mid, mdef in DEFAULT_MODES.items():
        by_type.setdefault(mdef["type"], []).append(mid)
    # Assist is not in the catalog any more — it's owned by Okay Nabu.
    assert set(by_type.keys()) == {"dictation", "realtime"}
    for t, ids in by_type.items():
        assert len(ids) == 1, f"type {t} maps to multiple builtin ids: {ids}"


# ─── Events / services strings ───────────────────────────────────────────────


def test_event_names_are_namespaced():
    """Given the event constants, When inspected, Then each starts with `voix_`."""
    for name in (
        const.EVENT_DICTATION_CAPTURED,
        const.EVENT_REALTIME_SESSION_STARTED,
        const.EVENT_REALTIME_SESSION_ENDED,
        const.EVENT_REALTIME_TURN_END,
        const.EVENT_MODE_CHANGED,
    ):
        assert name.startswith("voix_"), name


def test_service_names_are_short_and_unique():
    """Given the service constants, When inspected, Then both exist and differ."""
    assert const.SERVICE_CYCLE_MODE == "cycle_mode"
    assert const.SERVICE_SET_MODE == "set_mode"
    assert const.SERVICE_CYCLE_MODE != const.SERVICE_SET_MODE


def test_domain_is_voix():
    """Given DOMAIN, When inspected, Then it is the literal `voix`."""
    assert const.DOMAIN == "voix"


# ─── Realtime audio invariants ───────────────────────────────────────────────


def test_sample_rates_are_documented_constants():
    """Given the sample-rate constants, When inspected, Then satellite=16k, realtime=24k."""
    assert const.SATELLITE_SAMPLE_RATE == 16000
    assert const.REALTIME_SAMPLE_RATE == 24000
    # PCM16 = 2 bytes per sample
    assert const.AUDIO_FORMAT_BYTES_PER_SAMPLE == 2


def test_realtime_ws_url_is_openai_realtime():
    """Given the WS URL constant, When inspected, Then it points at OpenAI Realtime."""
    assert const.REALTIME_WS_URL.startswith("wss://api.openai.com/")
    assert "realtime" in const.REALTIME_WS_URL
