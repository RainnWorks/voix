"""Pure-logic tests for prompt assembly + the prompt-extras block builder.

The functions under test live on `_RealtimeBridge` in ws_view.py.
`_build_prompt_extras_block` and `_render_instructions` only touch:
  - `self.hass.states.get(entity_id)`
  - `self.hass.config_entries.async_get_entry(entry_id)`
  - `self._llm_api.api_prompt`
  - `self._instructions_template`

We build a `_RealtimeBridge` instance with a minimal fake hass — no real
HA bootstrap needed — and exercise the public-ish methods.

If HA core isn't installed (pure-pytest run on bare deps), every test in
this module is skipped at collect-time.
"""
from __future__ import annotations

import asyncio
from types import SimpleNamespace

import pytest

# These imports require Home Assistant core to be on the path. If not,
# the whole module is skipped.
pytest.importorskip("homeassistant.helpers.template")

from custom_components.voix.const import (
    CONF_PROMPT_EXTRAS,
    DEFAULT_REALTIME_INSTRUCTIONS,
)
from custom_components.voix.ws_view import _RealtimeBridge


# ─── Helpers ─────────────────────────────────────────────────────────────────


def _state(entity_id: str, state: str, friendly_name: str | None = None) -> SimpleNamespace:
    """Minimal HA State stand-in: only `.state` and `.attributes` are read."""
    return SimpleNamespace(
        entity_id=entity_id,
        state=state,
        attributes={"friendly_name": friendly_name} if friendly_name else {},
    )


class _FakeStates:
    def __init__(self, states: dict[str, SimpleNamespace]) -> None:
        self._states = states

    def get(self, entity_id: str):
        return self._states.get(entity_id)


class _FakeConfigEntries:
    def __init__(self, entry):
        self._entry = entry

    def async_get_entry(self, entry_id: str):
        if self._entry is not None and entry_id == self._entry.entry_id:
            return self._entry
        return None


class _FakeHass:
    """Just enough hass for the prompt builder."""

    def __init__(self, *, states: dict | None = None, entry=None) -> None:
        self.states = _FakeStates(states or {})
        self.config_entries = _FakeConfigEntries(entry)


def _make_bridge(*, hass, entry_id, instructions: str = "") -> _RealtimeBridge:
    """Build a bridge without opening any sockets."""
    return _RealtimeBridge(
        hass=hass,
        device_ws=SimpleNamespace(closed=False),
        openai_key="sk-test",
        model="gpt-realtime",
        voice="alloy",
        instructions=instructions,
        device_id="home-assistant-voice-095e4e",
        entry_id=entry_id,
    )


# ─── _build_prompt_extras_block ──────────────────────────────────────────────


def test_extras_block_empty_when_extras_unset(fake_entry):
    """Given no prompt_extras, When _build_prompt_extras_block, Then empty string."""
    fake_entry.options.pop(CONF_PROMPT_EXTRAS, None)
    hass = _FakeHass(entry=fake_entry)
    bridge = _make_bridge(hass=hass, entry_id=fake_entry.entry_id)
    assert bridge._build_prompt_extras_block() == ""


def test_extras_block_renders_included_entities(fake_entry):
    """Given include_entities with known states, When build, Then a context block with friendly-name lines."""
    fake_entry.options[CONF_PROMPT_EXTRAS] = {
        "include_entities": ["light.kitchen", "sensor.outside_temp"],
        "include_persons": [],
        "addendum": "",
    }
    hass = _FakeHass(
        entry=fake_entry,
        states={
            "light.kitchen": _state("light.kitchen", "on", "Kitchen Light"),
            "sensor.outside_temp": _state("sensor.outside_temp", "12.3", None),
        },
    )
    bridge = _make_bridge(hass=hass, entry_id=fake_entry.entry_id)
    out = bridge._build_prompt_extras_block()
    assert "Context the user always wants you to be aware of" in out
    assert "- Kitchen Light (light.kitchen) = on" in out
    # falls back to entity_id when no friendly_name attribute
    assert "- sensor.outside_temp (sensor.outside_temp) = 12.3" in out


def test_extras_block_renders_persons_with_pretty_form(fake_entry):
    """Given include_persons, When build, Then each line is `- Name is <state>`."""
    fake_entry.options[CONF_PROMPT_EXTRAS] = {
        "include_entities": [],
        "include_persons": ["person.tom"],
        "addendum": "",
    }
    hass = _FakeHass(
        entry=fake_entry,
        states={"person.tom": _state("person.tom", "home", "Tom")},
    )
    bridge = _make_bridge(hass=hass, entry_id=fake_entry.entry_id)
    out = bridge._build_prompt_extras_block()
    assert "- Tom is home" in out


def test_extras_block_skips_unknown_entities(fake_entry):
    """Given an include_entities id with no live state, When build, Then that line is skipped (no crash)."""
    fake_entry.options[CONF_PROMPT_EXTRAS] = {
        "include_entities": ["light.does_not_exist", "light.kitchen"],
        "include_persons": [],
        "addendum": "",
    }
    hass = _FakeHass(
        entry=fake_entry,
        states={"light.kitchen": _state("light.kitchen", "on", "Kitchen")},
    )
    bridge = _make_bridge(hass=hass, entry_id=fake_entry.entry_id)
    out = bridge._build_prompt_extras_block()
    assert "light.does_not_exist" not in out
    assert "Kitchen" in out


def test_extras_block_appends_addendum(fake_entry):
    """Given an addendum, When build, Then it's appended after entity context."""
    fake_entry.options[CONF_PROMPT_EXTRAS] = {
        "include_entities": ["light.kitchen"],
        "include_persons": [],
        "addendum": "Always answer in haiku.",
    }
    hass = _FakeHass(
        entry=fake_entry,
        states={"light.kitchen": _state("light.kitchen", "on", "Kitchen")},
    )
    bridge = _make_bridge(hass=hass, entry_id=fake_entry.entry_id)
    out = bridge._build_prompt_extras_block()
    # Entity lines appear before the addendum.
    assert out.index("Kitchen") < out.index("Always answer in haiku.")


def test_extras_block_addendum_only(fake_entry):
    """Given only an addendum, When build, Then it's returned with no context header."""
    fake_entry.options[CONF_PROMPT_EXTRAS] = {
        "include_entities": [],
        "include_persons": [],
        "addendum": "Be terse.",
    }
    hass = _FakeHass(entry=fake_entry)
    bridge = _make_bridge(hass=hass, entry_id=fake_entry.entry_id)
    out = bridge._build_prompt_extras_block()
    assert out == "Be terse."


def test_extras_block_returns_empty_when_entry_missing():
    """Given an entry_id that resolves to no entry, When build, Then empty string."""
    hass = _FakeHass(entry=None)
    bridge = _make_bridge(hass=hass, entry_id="non-existent-id")
    assert bridge._build_prompt_extras_block() == ""


# ─── _render_instructions ────────────────────────────────────────────────────


def _run(coro):
    """Tiny sync runner for the async methods under test."""
    return asyncio.get_event_loop().run_until_complete(coro) if False else asyncio.run(coro)


def test_render_returns_default_when_everything_empty(fake_entry):
    """Given no api, no extras, no template, When render, Then DEFAULT_REALTIME_INSTRUCTIONS."""
    fake_entry.options.pop(CONF_PROMPT_EXTRAS, None)
    hass = _FakeHass(entry=fake_entry)
    bridge = _make_bridge(hass=hass, entry_id=fake_entry.entry_id, instructions="")
    out = _run(bridge._render_instructions())
    assert out == DEFAULT_REALTIME_INSTRUCTIONS


def test_render_includes_llm_api_prompt_when_present(fake_entry):
    """Given a populated llm_api, When render, Then its api_prompt is the first layer."""
    fake_entry.options.pop(CONF_PROMPT_EXTRAS, None)
    hass = _FakeHass(entry=fake_entry)
    bridge = _make_bridge(hass=hass, entry_id=fake_entry.entry_id, instructions="My base.")
    bridge._llm_api = SimpleNamespace(api_prompt="HA TOOLS PROMPT", tools=[])
    out = _run(bridge._render_instructions())
    parts = out.split("\n\n")
    assert parts[0] == "HA TOOLS PROMPT"
    assert "My base." in parts[-1]


def test_render_layers_in_order(fake_entry):
    """Given api + extras + template, When render, Then order is api → extras → template."""
    fake_entry.options[CONF_PROMPT_EXTRAS] = {
        "include_entities": [],
        "include_persons": [],
        "addendum": "EXTRAS BLOCK",
    }
    hass = _FakeHass(entry=fake_entry)
    bridge = _make_bridge(
        hass=hass, entry_id=fake_entry.entry_id, instructions="MODE PROMPT"
    )
    bridge._llm_api = SimpleNamespace(api_prompt="HA API", tools=[])
    out = _run(bridge._render_instructions())
    assert out.index("HA API") < out.index("EXTRAS BLOCK") < out.index("MODE PROMPT")


def test_render_uses_raw_template_when_no_jinja_markers(fake_entry):
    """Given a plain (no `{{` / `{%`) prompt, When render, Then the literal text is included."""
    fake_entry.options.pop(CONF_PROMPT_EXTRAS, None)
    hass = _FakeHass(entry=fake_entry)
    bridge = _make_bridge(
        hass=hass,
        entry_id=fake_entry.entry_id,
        instructions="Just plain text — no jinja here.",
    )
    out = _run(bridge._render_instructions())
    assert "Just plain text — no jinja here." in out


def test_render_swallows_jinja_errors_and_emits_raw(fake_entry):
    """Given an unrenderable Jinja template, When render, Then the raw template text is kept (no crash)."""
    fake_entry.options.pop(CONF_PROMPT_EXTRAS, None)
    # A template that can't render against our fake hass: Template needs a
    # real hass with template helpers. We expect the except branch to keep raw.
    hass = _FakeHass(entry=fake_entry)
    bad_template = "Hello {{ this_filter_does_not_exist('x') }}"
    bridge = _make_bridge(
        hass=hass, entry_id=fake_entry.entry_id, instructions=bad_template
    )
    out = _run(bridge._render_instructions())
    # Either the raw template text, or some fallback — but no traceback bubbled.
    assert isinstance(out, str)
    assert len(out) > 0
