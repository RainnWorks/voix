# Persona 02 — Smart Home Enthusiast

You run HA Core in a container, you have a few automations, you read YAML
for fun, you don't write Python. You set up the `voix` integration
yourself via the UI. You care that entities show up where you'd expect,
that services are scriptable, that automations can trigger off mode
changes, and that nothing about the integration is mysterious.

For all scenarios below the Voice PE under test is
`home-assistant-voice-095e4e`. Substitute your own ESPHome name if
different — all entity IDs derive from it via slug rules
(`[^a-z0-9]+ → _`).

Key entity IDs for this device:

| Purpose            | entity_id                                                  |
| ------------------ | ---------------------------------------------------------- |
| Mode select        | `select.voix_mode_home_assistant_voice_095e4e`             |
| Dictation buffer   | `text.voix_dictation_home_assistant_voice_095e4e`          |
| LED outer ring     | `light.home_assistant_voice_095e4e_led_ring`               |
| Center button      | `event.home_assistant_voice_095e4e_button_press`           |

Services: `voix.cycle_mode`, `voix.set_mode`. Bus events:
`voix_mode_changed`, `voix_dictation_captured`,
`voix_realtime_session_started`, `voix_realtime_session_ended`.

---

## Scenario 1: Fresh install via the UI

**Given** voix is installed as a custom component and HA has been
restarted, and no `voix` config entry exists yet.
**When** you go to Settings → Devices & Services → Add Integration → "voix"
and submit the form.
**Then** the only fields you should be asked for are an OpenAI API key
(optional), a dictation helper entity (with a sensible default), and an
LED ring entity (with a sensible default). No device-specific config —
discovery happens later when the Voice PE connects.

Verify:
- [ ] The integration appears under Settings → Devices & Services with
      one config entry titled "voix".
- [ ] An `Options` button is present and opens a menu with three items:
      `Defaults`, `Modes`, `Prompt context`.
- [ ] The HTTP endpoint `/api/voix/realtime` is registered (in Developer
      Tools → Services, calling `voix.set_mode` without `device_id` must
      not 404; if it warns about no select, that proves the service is
      registered but no device has connected yet).
- [ ] No `select.voix_mode_*` or `text.voix_dictation_*` entities exist
      yet — devices haven't connected.

---

## Scenario 2: First-boot mode catalog has all three built-ins

**Given** a freshly installed voix entry (no manual edits to options).
**When** you open Options → Modes.
**Then** the picker offers exactly three pre-populated modes plus an
"Add new mode" option.

Verify:
- [ ] Modes listed: `Assist`, `Dictation`, `Realtime` (ids
      `default-assist`, `default-dictation`, `default-realtime`).
- [ ] Options → Defaults shows `default-assist` selected as the default
      mode.
- [ ] In Developer Tools → States, the integration's config entry has
      `options.modes` populated with three keys even though you never
      explicitly added them (built-ins seeded by `ensure_builtin_modes`).

---

## Scenario 3: Device auto-discovers on first WS hello

**Given** the integration is installed but the Voice PE has never
connected (no `select.voix_mode_*` for this device yet), and an OpenAI
key is configured.
**When** the Voice PE boots up and connects to
`ws://<ha>:8123/api/voix/realtime` (firmware logs show
`voix_rt: connected`).
**Then** the integration registers the device and creates per-device
entities without any user action.

Verify:
- [ ] `select.voix_mode_home_assistant_voice_095e4e` appears in
      Developer Tools → States and shows `default-assist`.
- [ ] `text.voix_dictation_home_assistant_voice_095e4e` appears with an
      empty value.
- [ ] Settings → Devices & Services → voix → Devices shows the new
      device (manufacturer `Nabu Casa`, model `Voice PE`).
- [ ] After a full HA restart, both entities are still present (device
      survived via persisted `entry.options.discovered_devices`).

---

## Scenario 4: Editing the Realtime mode prompt to use Jinja

**Given** the integration is installed and the Voice PE is online.
**When** you go to Options → Modes → `default-realtime`, replace the
prompt with `It is currently {{ now().strftime('%H:%M') }} and the
kitchen light is {{ states('light.kitchen') }}.`, and save.
**Then** the next Realtime session uses the rendered prompt; the model
can answer "what time is it?" correctly without you wiring up a tool.

Verify:
- [ ] In Options → Modes → `default-realtime`, the prompt field
      round-trips the Jinja text exactly (no escaping/HTML mangling).
- [ ] Switch the device's select to `default-realtime`, say
      "Hey Jarvis, what time is it?" — answer matches HA's current time
      within a minute.
- [ ] Try the Jinja templating standalone in Developer Tools → Template
      with the same expression and confirm it renders.

---

## Scenario 5: Adding a custom "Work" mode with a green LED

**Given** the integration is installed and the Voice PE is online.
**When** you go to Options → Modes → "➕ Add new mode", fill in
name=`Work`, type=`realtime`, prompt=`You are a brisk focused
assistant. No filler words.`, color_hex=`#00cc66`, brightness=`0.5`,
and save.
**Then** every voix device's select gains a new `work` option and the
mode catalog grows by one.

Verify:
- [ ] `select.voix_mode_home_assistant_voice_095e4e` options now
      include `work` (Developer Tools → States, attribute `options`).
- [ ] Select `work` from the dropdown; the LED ring turns green at ~50%
      brightness within ~1s.
- [ ] `light.home_assistant_voice_095e4e_led_ring` state attributes
      show `rgb_color: [0, 204, 102]` and `brightness ≈ 127`.
- [ ] In Options → Defaults, the `default_mode` dropdown also lists
      `Work` now.

---

## Scenario 6: Prompt extras inject extra entity state

**Given** the integration is installed, an OpenAI key is set, and the
device is on a Realtime mode (e.g. `default-realtime`).
**When** you go to Options → Prompt context, set
`include_entities` = `light.kitchen, sensor.outdoor_temperature`,
addendum = `Always respond in metric units.`, save, and then say
"Hey Jarvis, what's the kitchen light doing right now?".
**Then** the model answers using the live state of `light.kitchen`
without you mentioning it in the mode prompt.

Verify:
- [ ] Toggle `light.kitchen` off, ask again — answer flips to off.
- [ ] Toggle it on, ask again — answer flips to on.
- [ ] Ask "what's the temperature outside?" — model replies in degrees
      C (because of the addendum), with a number consistent with
      `sensor.outdoor_temperature`.
- [ ] Removing `light.kitchen` from `include_entities` and saving:
      asking again, the model no longer volunteers the kitchen light
      state (it may guess or ask).

---

## Scenario 7: Deleting a mode that the device is currently using

**Given** you created a `work` mode (Scenario 5) and the device's
select is currently set to `work`.
**When** you go to Options → Modes → `work` and check the `delete`
checkbox, then save.
**Then** the mode disappears from the catalog and the device's select
falls back to the default mode (not a crash, not a hung "unknown"
state).

Verify:
- [ ] `select.voix_mode_home_assistant_voice_095e4e` options no longer
      include `work`.
- [ ] The select's current state is now `default-assist` (or whatever
      `Options → Defaults → default_mode` points at).
- [ ] LED ring color matches the new mode's color (blue-ish for assist).
- [ ] Deleting the last remaining mode is refused (the options flow
      aborts with `cannot_delete_last` — try it as a sanity check by
      deleting everything down to one and trying that last one).

---

## Scenario 8: Center button cycles the mode, LED follows

**Given** the device is online, the catalog contains the three
built-ins plus `work`, and the current mode is `default-assist`.
**When** you single-press the Voice PE's center button.
**Then** the select advances one slot in catalog order, the
`voix_mode_changed` event fires on the bus, and the LED ring repaints
to the new mode's color within ~1s.

Verify:
- [ ] Developer Tools → Events → listen to `voix_mode_changed`. Press
      the button once. An event arrives with `device_id`,
      `from=default-assist`, `to=default-dictation`.
- [ ] `select.voix_mode_home_assistant_voice_095e4e` state is now
      `default-dictation`.
- [ ] LED ring color matches the dictation color (orange/amber).
- [ ] Continue pressing: the select cycles dictation → realtime → work
      → assist → … wrapping at the end.
- [ ] `event.home_assistant_voice_095e4e_button_press` state's
      `event_type` shows `single_press` each press.

---

## Scenario 9: Cycling via the `voix.cycle_mode` service

**Given** the device is online and the select is on `default-assist`.
**When** in Developer Tools → Services you call `voix.cycle_mode` with
no fields (single-device install — `device_id` is optional).
**Then** the select advances exactly as if you'd pressed the button.

Verify:
- [ ] Service call succeeds (no error in Developer Tools).
- [ ] Select moves to `default-dictation`.
- [ ] Calling again with `device_id: home-assistant-voice-095e4e`
      explicitly works identically.
- [ ] Calling with a bogus `device_id: nope` logs a warning ("no mode
      select entity") but does not raise.

---

## Scenario 10: `voix.set_mode` jumps directly to a mode type

**Given** the device is online and the select is on `default-assist`.
**When** in Developer Tools → Services you call
`voix.set_mode` with `mode: realtime` and `device_id:
home-assistant-voice-095e4e`.
**Then** the device's select moves to a mode whose type is `realtime`.

Verify:
- [ ] Select state changes to a realtime-typed mode.
- [ ] LED color updates accordingly.
- [ ] `voix_mode_changed` event on the bus has `to` set to the realtime
      mode's id.
- [ ] Note: `set_mode`'s `mode` argument is constrained to
      `assist|dictation|realtime` (the three behavior types). If you
      need to jump to a specific named mode (e.g. `work`), call the
      `select.select_option` service on
      `select.voix_mode_home_assistant_voice_095e4e` instead.

---

## Scenario 11: Automation — sun sets → switch to "Sleep" mode

**Given** you added a Realtime mode named `Sleep` (prompt: `Whisper
short, calm answers. No more than one sentence.`, color `#220066`,
brightness `0.15`) and saved it. Mode id is `sleep`.
**When** you create an automation: trigger `Sun → Sunset`, action
`Call service → voix.set_mode` … or alternatively a `select.select_option`
on `select.voix_mode_home_assistant_voice_095e4e` with `option: sleep`.
**Then** at sunset the device flips to `sleep`, the ring goes deep
purple at low brightness, and Realtime responses are noticeably quieter
in tone.

Verify:
- [ ] Manually run the automation (three-dot menu → Run). Select state
      changes to `sleep`.
- [ ] LED ring dims and turns deep purple.
- [ ] Trigger a session with "Hey Jarvis, what's on tomorrow?" — answer
      is short and calm-toned.
- [ ] An automation triggered off `voix_mode_changed` (e.g. send a
      notification when `to == 'sleep'`) fires once per transition.

---

## Scenario 12: Multiple Voice PEs each have their own select

**Given** two Voice PEs are online — `home-assistant-voice-095e4e` and
e.g. `home-assistant-voice-aabbcc` — both having connected to the WS
endpoint at least once.
**When** you open Developer Tools → States and filter by `select.voix_mode_`.
**Then** there are exactly two selects, one per device, each with the
same options list (the global catalog) but independent current values.

Verify:
- [ ] `select.voix_mode_home_assistant_voice_095e4e` and
      `select.voix_mode_home_assistant_voice_aabbcc` both exist.
- [ ] Setting one to `default-dictation` does not move the other.
- [ ] Calling `voix.set_mode` without `device_id` logs a warning
      (ambiguous) and changes nothing.
- [ ] Calling `voix.set_mode` with `device_id:
      home-assistant-voice-aabbcc` and `mode: realtime` only moves
      that device.
- [ ] Pressing the button on one device only cycles that device.

---

## Scenario 13: Dictation text entity captures transcripts

**Given** the device is online, the select is on `default-dictation`,
and `text.voix_dictation_home_assistant_voice_095e4e` is currently
empty.
**When** you say "Hey Mycroft, milk eggs and bread".
**Then** the LED flashes briefly, no TTS plays back, and the text
entity updates to the transcript.

Verify:
- [ ] `text.voix_dictation_home_assistant_voice_095e4e` state becomes
      something like `milk eggs and bread`.
- [ ] Developer Tools → Events → listen for `voix_dictation_captured`:
      one event fires with `device_id` and `text`.
- [ ] An automation triggered on state change of
      `text.voix_dictation_home_assistant_voice_095e4e` (e.g.
      "append to shopping list") fires.
- [ ] Switching the select back to `default-assist` and using the
      device normally does NOT clear the text entity (last transcript
      sticks).

---

## Scenario 14: "Turn on the kitchen lights" through Realtime

**Given** the device is online, an OpenAI key is configured, mode is
`default-realtime`, `light.kitchen` is exposed to Assist
(Settings → Voice assistants → Expose → `light.kitchen` toggled on),
and the light is currently off.
**When** you say "Hey Jarvis, turn on the kitchen lights".
**Then** the model acknowledges and `light.kitchen` turns on (HA tools
were wired into the Realtime session via the AssistAPI LLM helper).

Verify:
- [ ] `light.kitchen` state flips to `on` within a couple of seconds.
- [ ] Saying "turn off the kitchen lights" turns it back off.
- [ ] Un-exposing `light.kitchen` from Assist and trying again — the
      model now refuses or claims it can't (proving only Assist-exposed
      entities are available to it).
- [ ] Developer Tools → Events → listening for
      `voix_realtime_session_started` / `…_ended` should show one of
      each per interaction.

---

## Scenario 15: Renaming `default-realtime` to "Helper"

**Given** the device's current selection is `default-realtime`.
**When** you go to Options → Modes → `default-realtime`, change the
name to `Helper` (leave everything else), save.
**Then** the display label updates everywhere but the device's
selection persists (mode id is still `default-realtime` — renaming
doesn't re-slug).

Verify:
- [ ] In Options → Modes the entry now reads `Helper`.
- [ ] Options → Defaults dropdown shows `Helper` (not `Realtime`) for
      the same id.
- [ ] `select.voix_mode_home_assistant_voice_095e4e` state is still
      `default-realtime` (the underlying id), not `helper`.
- [ ] LED color and prompt are unchanged (you only renamed).

---

## Scenario 16: Reload integration → modes & devices survive

**Given** you have one user-added mode (`work`), one renamed mode
(`Helper` for `default-realtime`), one discovered Voice PE, and the
device's select is on `work`.
**When** you reload the integration from Settings → Devices & Services
→ voix → three-dot menu → Reload.
**Then** everything comes back exactly as before.

Verify:
- [ ] After reload, `select.voix_mode_home_assistant_voice_095e4e`
      still exists and is still set to `work`.
- [ ] Options → Modes still lists `work` and the renamed `Helper`.
- [ ] `text.voix_dictation_home_assistant_voice_095e4e` is restored
      (value may be empty after reload — RestoreState isn't required
      here, but the entity must exist).
- [ ] No duplicate select/text entities appear (no `_2` suffix).
- [ ] After a full HA restart the same is true.
