"""Shared pytest fixtures for voix integration tests.

Two tiers:

  * pure logic — tests in `unit/` exercise functions without HA. These
    fixtures (config_entry_data, mock_entry_options) build the data
    shapes the integration uses without needing pytest-homeassistant-custom-component.

  * HA integration — tests in `integration/` use the `hass` fixture from
    pytest-homeassistant-custom-component and a `MockConfigEntry` to drive
    the real integration through async_setup_entry / unload.

Run all:
    cd ha-integration && pytest tests/

Run just pure tests (no HA needed):
    cd ha-integration && pytest tests/unit/

Run integration tests:
    cd ha-integration && pytest tests/integration/
"""
from __future__ import annotations

import sys
from pathlib import Path
from typing import Any

import pytest

# Make `custom_components.voix` importable as a top-level package.
_INTEGRATION_ROOT = Path(__file__).resolve().parent.parent
if str(_INTEGRATION_ROOT) not in sys.path:
    sys.path.insert(0, str(_INTEGRATION_ROOT))


# ─── Pure-logic fixtures (no HA needed) ──────────────────────────────────────


@pytest.fixture
def fake_entry_options() -> dict[str, Any]:
    """A representative entry.options dict with built-in modes seeded.

    Matches the shape produced by `modes.ensure_builtin_modes({})` plus
    a couple of user-defined modes for tests that need more than the
    builtins.
    """
    from custom_components.voix.const import (
        CONF_DEFAULT_MODE,
        CONF_MODES,
        CONF_PROMPT_EXTRAS,
        DEFAULT_MODES,
    )

    modes = dict(DEFAULT_MODES)
    modes["work"] = {
        "name": "Work",
        "type": "realtime",
        "prompt": "You are a focused work assistant. {{ now() }}.",
        "voice": "echo",
        "model": "gpt-realtime",
        "color": [50, 100, 255],
        "brightness": 0.5,
        "effect": "None",
    }
    modes["home"] = {
        "name": "Home",
        "type": "realtime",
        "prompt": "You are a friendly home companion.",
        "voice": "alloy",
        "model": "gpt-realtime",
        "color": [0, 200, 80],
        "brightness": 0.4,
        "effect": "None",
    }

    return {
        CONF_MODES: modes,
        CONF_DEFAULT_MODE: "default-realtime",
        CONF_PROMPT_EXTRAS: {
            "include_entities": [],
            "include_persons": [],
            "addendum": "",
        },
        "discovered_devices": {
            "home-assistant-voice-095e4e": {"friendly_name": "Kitchen"},
        },
    }


@pytest.fixture
def fake_entry(fake_entry_options):
    """Minimal stand-in for ConfigEntry — only what the integration reads.

    Use this in pure-logic tests where you don't need a full HA setup.
    """

    class _Entry:
        entry_id = "test-entry"
        data: dict = {}
        options = fake_entry_options

    return _Entry()


# ─── HA integration fixtures (pytest-homeassistant-custom-component) ─────────
#
# These are only effective when pytest-homeassistant-custom-component is
# installed. Pure unit tests don't import them.


@pytest.fixture
def mock_config_entry():
    """Pre-built MockConfigEntry for the voix integration. Lazy-imported."""
    try:
        from pytest_homeassistant_custom_component.common import MockConfigEntry
    except ImportError:
        pytest.skip("pytest-homeassistant-custom-component not installed")

    from custom_components.voix.const import (
        CONF_DEFAULT_MODE,
        CONF_MODES,
        DEFAULT_MODES,
        DOMAIN,
    )

    return MockConfigEntry(
        domain=DOMAIN,
        title="voix",
        data={"openai_api_key": "test-key"},
        options={
            CONF_MODES: dict(DEFAULT_MODES),
            CONF_DEFAULT_MODE: "default-realtime",
        },
        unique_id=DOMAIN,
    )


@pytest.fixture
def hass_config_dir() -> str:
    """Point HA's test loader at our project's custom_components/.

    pytest-homeassistant-custom-component's default `hass_config_dir`
    is its own internal `testing_config/`, which won't contain `voix`.
    Overriding it here makes HA's loader scan `ha-integration/custom_components/`
    where `voix/manifest.json` actually lives.
    """
    return str(_INTEGRATION_ROOT)


@pytest.fixture
def enable_custom_integrations(hass):
    """Clear HA's custom-component cache so it re-scans for `voix`."""
    from homeassistant.loader import DATA_CUSTOM_COMPONENTS
    hass.data.pop(DATA_CUSTOM_COMPONENTS, None)
    yield


@pytest.fixture(autouse=True)
def _activate_enable_custom_integrations_marker(request):
    """Trigger `enable_custom_integrations` for tests that carry the marker.

    Tests decorated with `@pytest.mark.enable_custom_integrations` (or whose
    module sets `pytestmark = pytest.mark.enable_custom_integrations`) need
    the fixture to actually run. Marker alone is inert — this autouse fixture
    requests the underlying fixture for them.
    """
    if request.node.get_closest_marker("enable_custom_integrations") is not None:
        request.getfixturevalue("enable_custom_integrations")
        # `_prime_exposed_entities_data` is async; pytest-asyncio will await
        # it when we resolve the fixture this way.
        request.getfixturevalue("_prime_exposed_entities_data")


@pytest.fixture
async def _prime_exposed_entities_data(hass):
    """Initialize the `homeassistant.exposed_entities` data bucket.

    Loading voix triggers loading the conversation platform, whose
    `async_hass_started` callback walks `homeassistant.exposed_entities`.
    The full `homeassistant` integration isn't auto-set-up in tests, so we
    fully construct + load an ExposedEntities instance so its lookups work
    instead of raising `AttributeError: '_assistants'`.
    """
    try:
        from homeassistant.components.homeassistant.exposed_entities import (
            DATA_EXPOSED_ENTITIES,
            ExposedEntities,
        )
    except ImportError:
        return
    if DATA_EXPOSED_ENTITIES not in hass.data:
        instance = ExposedEntities(hass)
        # The public init does websocket-api registration we can't run in
        # tests; just populate the `_assistants` attribute that callers
        # actually depend on via the internal data loader.
        await instance._async_load_data()  # noqa: SLF001
        if not hasattr(instance, "_assistants"):
            instance._assistants = {}  # type: ignore[attr-defined]  # noqa: SLF001
        hass.data[DATA_EXPOSED_ENTITIES] = instance
