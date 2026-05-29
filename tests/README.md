# voix tests

Two test surfaces:

## Manual / behavior-driven scenarios (`tests/manual/`)

Markdown checklists organized by **persona**. Each scenario is in
Given / When / Then form. They describe what the user does and what
should happen — they don't reference code structure or internal entity
ids.

Pick a persona, work through their scenarios with a real Voice PE + HA.
Tick off each step as you verify. Anything that fails goes back to the
issue tracker.

Personas:
  - `01-family.md` — Someone who got the Voice PE as a gift. Knows nothing
    about HA internals.
  - `02-smart-home-enthusiast.md` — Confident HA user. Reads YAML, builds
    automations, doesn't write code.
  - `03-developer.md` — HA integration contributor. Cares about entity
    naming, options-flow patterns, config-entry hygiene, unload-safety.
  - `04-privacy-safety.md` — Verifies cost guards, idle timeouts, what data
    leaves the home, what happens when OpenAI is down.

## Python tests (`ha-integration/tests/`)

Pytest tests grouped as:

  - `tests/unit/` — pure-logic tests for `modes.py`, prompt assembly,
    slug helpers, validators. Run with plain `pytest`, no HA install.
  - `tests/integration/` — uses `pytest-homeassistant-custom-component`
    for fixtures + `hass`; exercises config flow, entities, services,
    dispatch.

Install:

    cd ha-integration
    pip install -r tests/requirements-test.txt

Run all:

    cd ha-integration && pytest tests/

Run just pure-logic (no HA needed):

    cd ha-integration && pytest tests/unit/

Run just HA-integration:

    cd ha-integration && pytest tests/integration/
