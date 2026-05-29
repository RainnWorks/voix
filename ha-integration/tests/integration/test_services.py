"""Integration tests for voix.cycle_mode and voix.set_mode services.

Both services route through the per-device select entity:
  - cycle_mode → select.cycle() → async_select_option(next)
  - set_mode   → async_select_option(requested mode_id)

device_id resolution:
  - explicit device_id → looked up by key
  - omitted + exactly one device → single-device fallback
  - omitted + multiple devices → no-op + warning
  - unknown device_id → no-op + warning

set_mode's `mode` field accepts any string — the live mode-id catalog
is user-defined, so the handler validates against the catalog at call
time (silent no-op + warning if unknown).
"""
from __future__ import annotations

from typing import Any

import pytest

from custom_components.voix.const import (
    CONF_MODES,
    DEFAULT_MODES,
    DOMAIN,
    EVENT_MODE_CHANGED,
    SERVICE_CYCLE_MODE,
    SERVICE_SET_MODE,
)

pytestmark = pytest.mark.enable_custom_integrations

DEVICE_A = "home-assistant-voice-aaaaaa"
DEVICE_B = "home-assistant-voice-bbbbbb"


async def _setup_with_devices(hass: Any, mock_config_entry, devices: list[str]) -> None:
    mock_config_entry.add_to_hass(hass)
    hass.config_entries.async_update_entry(
        mock_config_entry,
        options={
            **mock_config_entry.options,
            "discovered_devices": {d: {"friendly_name": d} for d in devices},
        },
    )
    assert await hass.config_entries.async_setup(mock_config_entry.entry_id)
    await hass.async_block_till_done()


# ─── cycle_mode ──────────────────────────────────────────────────────────────


async def test_cycle_mode_advances_with_explicit_device_id(
    hass: Any, mock_config_entry
) -> None:
    """Given two devices, When cycle_mode targets one by id, Then only that select advances."""
    await _setup_with_devices(hass, mock_config_entry, [DEVICE_A, DEVICE_B])
    sel_a = hass.data[DOMAIN]["mode_select"][DEVICE_A]
    sel_b = hass.data[DOMAIN]["mode_select"][DEVICE_B]
    a_before, b_before = sel_a.current_option, sel_b.current_option

    await hass.services.async_call(
        DOMAIN, SERVICE_CYCLE_MODE, {"device_id": DEVICE_A}, blocking=True
    )
    await hass.async_block_till_done()

    assert sel_a.current_option != a_before
    assert sel_b.current_option == b_before


async def test_cycle_mode_without_device_id_single_device_install(
    hass: Any, mock_config_entry
) -> None:
    """Given one device + no device_id arg, When cycle_mode, Then the only select advances."""
    await _setup_with_devices(hass, mock_config_entry, [DEVICE_A])
    sel = hass.data[DOMAIN]["mode_select"][DEVICE_A]
    before = sel.current_option

    await hass.services.async_call(DOMAIN, SERVICE_CYCLE_MODE, {}, blocking=True)
    await hass.async_block_till_done()
    assert sel.current_option != before


async def test_cycle_mode_with_multiple_devices_and_no_id_is_noop(
    hass: Any, mock_config_entry
) -> None:
    """Given multiple devices + no device_id arg, When cycle_mode, Then nothing changes."""
    await _setup_with_devices(hass, mock_config_entry, [DEVICE_A, DEVICE_B])
    sel_a = hass.data[DOMAIN]["mode_select"][DEVICE_A]
    sel_b = hass.data[DOMAIN]["mode_select"][DEVICE_B]
    before = (sel_a.current_option, sel_b.current_option)

    await hass.services.async_call(DOMAIN, SERVICE_CYCLE_MODE, {}, blocking=True)
    await hass.async_block_till_done()
    assert (sel_a.current_option, sel_b.current_option) == before


async def test_cycle_mode_with_unknown_device_id_is_noop(
    hass: Any, mock_config_entry
) -> None:
    """Given an unknown device_id, When cycle_mode, Then no select changes, no exception."""
    await _setup_with_devices(hass, mock_config_entry, [DEVICE_A])
    sel = hass.data[DOMAIN]["mode_select"][DEVICE_A]
    before = sel.current_option
    await hass.services.async_call(
        DOMAIN, SERVICE_CYCLE_MODE, {"device_id": "nonsense"}, blocking=True
    )
    await hass.async_block_till_done()
    assert sel.current_option == before


async def test_cycle_mode_eventually_wraps(hass: Any, mock_config_entry) -> None:
    """Given N options, When cycle_mode runs N times, Then the select returns to its starting option."""
    await _setup_with_devices(hass, mock_config_entry, [DEVICE_A])
    sel = hass.data[DOMAIN]["mode_select"][DEVICE_A]
    start = sel.current_option
    n = len(sel._attr_options)
    for _ in range(n):
        await hass.services.async_call(
            DOMAIN, SERVICE_CYCLE_MODE, {"device_id": DEVICE_A}, blocking=True
        )
        await hass.async_block_till_done()
    assert sel.current_option == start


# ─── set_mode ────────────────────────────────────────────────────────────────


async def test_set_mode_sets_the_target_option(hass: Any, mock_config_entry) -> None:
    """Given a known mode_id, When set_mode is called, Then current_option becomes that id."""
    await _setup_with_devices(hass, mock_config_entry, [DEVICE_A])
    sel = hass.data[DOMAIN]["mode_select"][DEVICE_A]

    await hass.services.async_call(
        DOMAIN,
        SERVICE_SET_MODE,
        {"mode": "default-realtime", "device_id": DEVICE_A},
        blocking=True,
    )
    await hass.async_block_till_done()
    assert sel.current_option == "default-realtime"


async def test_set_mode_accepts_user_defined_mode_id(
    hass: Any, mock_config_entry
) -> None:
    """Given a user-defined mode_id in the catalog, When set_mode called, Then select advances to it."""
    modes = dict(DEFAULT_MODES)
    modes["work"] = {
        "name": "Work",
        "type": "realtime",
        "prompt": "be focused",
        "voice": "alloy",
        "model": "gpt-realtime",
        "color": [1, 2, 3],
        "brightness": 0.5,
        "effect": "None",
    }
    mock_config_entry.add_to_hass(hass)
    hass.config_entries.async_update_entry(
        mock_config_entry,
        options={
            **mock_config_entry.options,
            CONF_MODES: modes,
            "discovered_devices": {DEVICE_A: {"friendly_name": DEVICE_A}},
        },
    )
    assert await hass.config_entries.async_setup(mock_config_entry.entry_id)
    await hass.async_block_till_done()

    sel = hass.data[DOMAIN]["mode_select"][DEVICE_A]
    await hass.services.async_call(
        DOMAIN,
        SERVICE_SET_MODE,
        {"mode": "work", "device_id": DEVICE_A},
        blocking=True,
    )
    await hass.async_block_till_done()
    assert sel.current_option == "work"


async def test_set_mode_with_unknown_mode_id_is_noop(
    hass: Any, mock_config_entry
) -> None:
    """Given an unknown mode_id (not in catalog), When set_mode called, Then select unchanged + no exception."""
    await _setup_with_devices(hass, mock_config_entry, [DEVICE_A])
    sel = hass.data[DOMAIN]["mode_select"][DEVICE_A]
    before = sel.current_option
    await hass.services.async_call(
        DOMAIN,
        SERVICE_SET_MODE,
        {"mode": "nonexistent-mode", "device_id": DEVICE_A},
        blocking=True,
    )
    await hass.async_block_till_done()
    assert sel.current_option == before


async def test_set_mode_without_device_id_single_device(
    hass: Any, mock_config_entry
) -> None:
    """Given one device + no device_id, When set_mode, Then the only select is targeted."""
    await _setup_with_devices(hass, mock_config_entry, [DEVICE_A])
    sel = hass.data[DOMAIN]["mode_select"][DEVICE_A]
    await hass.services.async_call(
        DOMAIN, SERVICE_SET_MODE, {"mode": "default-dictation"}, blocking=True
    )
    await hass.async_block_till_done()
    assert sel.current_option == "default-dictation"


async def test_set_mode_with_multiple_devices_and_no_id_is_noop(
    hass: Any, mock_config_entry
) -> None:
    """Given multiple devices + no device_id, When set_mode, Then no select is updated."""
    await _setup_with_devices(hass, mock_config_entry, [DEVICE_A, DEVICE_B])
    sel_a = hass.data[DOMAIN]["mode_select"][DEVICE_A]
    sel_b = hass.data[DOMAIN]["mode_select"][DEVICE_B]
    before = (sel_a.current_option, sel_b.current_option)
    await hass.services.async_call(
        DOMAIN, SERVICE_SET_MODE, {"mode": "default-realtime"}, blocking=True
    )
    await hass.async_block_till_done()
    assert (sel_a.current_option, sel_b.current_option) == before


async def test_services_registered_on_setup(hass: Any, mock_config_entry) -> None:
    """Given a fresh setup, When inspecting services, Then voix.cycle_mode and voix.set_mode are registered."""
    await _setup_with_devices(hass, mock_config_entry, [DEVICE_A])
    assert hass.services.has_service(DOMAIN, SERVICE_CYCLE_MODE)
    assert hass.services.has_service(DOMAIN, SERVICE_SET_MODE)


async def test_event_mode_changed_fires_on_set(hass: Any, mock_config_entry) -> None:
    """Given a select, When async_select_option is called via the entity directly, Then EVENT_MODE_CHANGED fires once."""
    await _setup_with_devices(hass, mock_config_entry, [DEVICE_A])
    sel = hass.data[DOMAIN]["mode_select"][DEVICE_A]
    events: list = []
    hass.bus.async_listen(EVENT_MODE_CHANGED, lambda e: events.append(e))

    # Pick something different from current_option.
    new = next(opt for opt in sel._attr_options if opt != sel.current_option)
    await sel.async_select_option(new)
    await hass.async_block_till_done()
    assert len(events) == 1
    assert events[0].data["to"] == new
