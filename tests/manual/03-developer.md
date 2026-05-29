# Persona 03 — Developer / HA contributor

You read integrations for breakfast. You care about: entity naming hygiene,
options-flow patterns, config-entry lifecycle, signal dispatch correctness,
and reload/unload safety. You will not ship a regression because you ran a
single happy-path smoke test.

Work through each scenario on a real HA + Voice PE. Tick the boxes as you
verify. Anything that fails goes to the issue tracker.

---

## 1. Entities pass the entity-registry validation

- [ ] **Given** the integration is freshly installed and a Voice PE has
      connected at least once
- [ ] **When** you inspect Developer Tools → States and the entity registry
      for `select.voix_mode_<slug>` and `text.voix_dictation_<slug>`
- [ ] **Then** each entity has:
  - a stable `unique_id` of the form `<entry_id>-<slug>-voix-mode` (or
    `-dictation`) — restarting HA does not change it
  - `device_info.identifiers` of `{("voix", "<device_id>")}` — both
    entities for the same Voice PE share one device row
  - manufacturer = `Nabu Casa`, model = `Voice PE`
  - the `entity_id` slug matches the device id with non-alphanumerics
    folded to `_` (e.g. `home_assistant_voice_095e4e`)

---

## 2. Config flow refuses a duplicate setup

- [ ] **Given** the voix integration is already configured (unique_id
      `voix`)
- [ ] **When** you go to Settings → Devices & Services → Add Integration
      → voix and try to add a second instance
- [ ] **Then** HA aborts with `already_configured` (the `unique_id` check
      in `async_step_user` fires before the entry is created)

---

## 3. Options flow lets you CRUD modes without losing the others

- [ ] **Given** the default 3 builtin modes are present plus a user mode
      "Work"
- [ ] **When** you open the Options menu → Modes → "Work" → set
      `delete=true` and submit
- [ ] **Then** only "Work" disappears; the 3 builtins remain; the
      `default_mode` is still resolvable (the select doesn't lose its
      current option unless that mode was deleted)

- [ ] **And When** you Modes → "➕ Add new mode" → submit with name "Focus"
- [ ] **Then** a mode_id `focus` (or `focus-2` if a collision) is created;
      every existing `select.voix_mode_*` entity's option list grows to
      include it without an HA restart

- [ ] **And When** you try to delete the last remaining mode
- [ ] **Then** the flow aborts with reason `cannot_delete_last`

---

## 4. Invalid mode form input shows an error, not a crash

- [ ] **Given** the Modes form is open in add mode
- [ ] **When** you submit with `name=""`, OR `color_hex` not 6 hex chars,
      OR `brightness=2.0`
- [ ] **Then** the same form re-renders with an `errors["base"]`
      message — no entry update is written, no traceback in the logs

---

## 5. unload_entry releases every resource

- [ ] **Given** the integration is set up and a Realtime session has run
      at least once (RealtimeManager initialised)
- [ ] **When** you remove the config entry (or toggle reload)
- [ ] **Then** all of:
  - every platform's `async_unload_entry` returns `True`
  - `hass.data[DOMAIN][entry_id]` is gone
  - the `voix.cycle_mode` / `voix.set_mode` services are still
    registered IFF another voix entry exists; otherwise gone or
    no-op (services are domain-wide, not per-entry — verify intent)
  - the bus listeners and dispatcher subscribers created in
    `_register_led_pusher` / `_register_button_handler` /
    `_register_device_discovery` are torn down (they're registered via
    `entry.async_on_unload`)
  - the `RealtimeManager.close()` callback ran

---

## 6. HA restart preserves discovered devices and selected mode

- [ ] **Given** at least one Voice PE has been discovered and you've
      cycled it to `default-realtime`
- [ ] **When** you restart Home Assistant
- [ ] **Then** after startup:
  - the `select.voix_mode_<slug>` entity comes back with state
    `default-realtime` (RestoreEntity → `async_get_last_state`)
  - the entity's options list matches `entry.options["modes"].keys()`
  - `entry.options["discovered_devices"]` still has the device
  - no new "device discovered" log line fires until the firmware
    actually reconnects and sends `{type: "hello"}`

---

## 7. Services are idempotent and safe with/without device_id

- [ ] **Given** a single Voice PE is discovered
- [ ] **When** you call `voix.cycle_mode` with no `device_id`
- [ ] **Then** the only known device's select advances by one option

- [ ] **And When** two devices are discovered and you call
      `voix.cycle_mode` with no `device_id`
- [ ] **Then** the call is a no-op with a warning log
      ("multiple devices present") — no entity changes

- [ ] **And When** you call `voix.set_mode mode=default-realtime
      device_id=<unknown>`
- [ ] **Then** logs a warning, makes no change, does not raise

- [ ] **And When** you call `voix.set_mode mode=default-realtime` twice in
      a row
- [ ] **Then** the second call is a no-op (current==target short-circuits
      in `async_select_option`); `voix_mode_changed` only fires once

---

## 8. Mode change fires exactly one EVENT_MODE_CHANGED with full payload

- [ ] **Given** a device's mode is `default-assist`
- [ ] **When** you call `voix.set_mode mode=default-realtime device_id=…`
      while listening to the bus for `voix_mode_changed`
- [ ] **Then** exactly one event fires with payload
      `{entry_id, device_id, from: "default-assist", to: "default-realtime"}`
      — and the LED pusher's `light.turn_on` service call is made on the
      correct `light.<slug>_led_ring`

---

## 9. WS hello registers a device exactly once

- [ ] **Given** an empty `entry.options["discovered_devices"]`
- [ ] **When** a firmware client opens `/api/voix/realtime` and sends
      `{"type":"hello","device_id":"home-assistant-voice-test","friendly_name":"X"}`
- [ ] **Then**:
  - `entry.options["discovered_devices"]["home-assistant-voice-test"]`
    is persisted with `friendly_name="X"`
  - `SIGNAL_DEVICE_DISCOVERED` fires once
  - the `select` + `text` platforms each create their entity
  - reconnecting with the same `device_id` does **not** duplicate-write
    options (the dict already has the key) and does not re-dispatch the
    signal

---

## 10. Prompt assembly layers are independently testable

- [ ] **Given** `entry.options["prompt_extras"] = {include_entities:
      ["light.kitchen"], include_persons: ["person.tom"], addendum: "Be
      terse."}` and the active mode's prompt is
      `"Hi {{ states('input_text.foo') }}"`
- [ ] **When** the Realtime bridge renders instructions before sending
      `session.update`
- [ ] **Then** the final string contains, in order:
  1. The HA Assist API tool prompt
  2. "Context the user always wants you to be aware of:" with both
     entities rendered
  3. "Be terse."
  4. The Jinja-rendered mode prompt
- [ ] If the Jinja template errors, the raw template text is used (no
      traceback escapes); the rest of the layers still appear

---

## 11. Service schema rejects bad input at the HA level

- [ ] **Given** the services are registered
- [ ] **When** you call `voix.set_mode mode=banana` from the dev-tools
      services panel
- [ ] **Then** HA rejects the call with a voluptuous error before our
      handler runs (the schema is `vol.In(MODE_OPTIONS)`).
- [ ] **Note** — the schema currently uses `MODE_OPTIONS` (the three
      behavior types), not the live mode-id catalog. Calling with a
      user-defined mode_id like `work` will be **rejected** even though
      the select would accept it. Decide whether to relax the schema or
      keep validation tight.

---

## 12. Options-update listener refreshes every device's select

- [ ] **Given** two devices, both with options including modes A, B
- [ ] **When** you add mode C via the options flow
- [ ] **Then** both `select.voix_mode_*` entities now show three options
      without an HA restart; if either device's current_option vanished
      (mode was deleted), it falls back to `get_default_mode_id(entry)`
      and writes state
