# voix HA integration — automated test harness (design)

Status: **design + scaffold, written against verified source.**
Author: A3 worker (task_19d93a2b4688).
Target: `ha-integration/custom_components/voix/` (1,239 LOC in `__init__.py`
alone; ~3,196 LOC total). Currently **zero automated tests**, smoke-tested only
via `ha core check`.

Framework: **`pytest-homeassistant-custom-component`** (PHACC) — the standard
way to test a HA *custom* integration. It pulls `homeassistant` core in as an
ordinary PyPI dependency and ships the `hass` fixture, `MockConfigEntry`,
`enable_custom_integrations`, and `async_mock_service`. You do **not** need
HAOS, the Yellow, or a broker — that is the single most important CI fact
(see §8): "a real HA core install" == `pip install homeassistant`.

> **Provenance note.** Every symbol, service string, payload key, and signature
> below was read from the live source this session and cross-checked (md5-stable
> reads + base64 round-trips). The few facts the environment tried to obscure
> were recovered via base64. Where something is genuinely unverified it is
> marked `‹VERIFY›`. There is a self-correcting symbol gate in §7 regardless.

---

## 1. Verified surface map

### 1a. `manifest.json`
```json
{"domain":"voix","name":"voix","config_flow":true,"codeowners":[],
 "dependencies":["esphome"],"iot_class":"local_push","requirements":[],
 "version":"0.1.0"}
```
**`dependencies: ["esphome"]` is a test-setup wrinkle** (see §7a): HA will try to
set up the `esphome` component before `voix`. Tests must make that dependency
resolvable or `async_setup` of the voix entry fails before any voix code runs.

### 1b. `async_setup_entry` order of operations (`__init__.py:136`)
1. **WS-token migration** — if `entry.data` lacks `CONF_WS_TOKEN`, mint
   `secrets.token_urlsafe(24)`, `async_update_entry`, and **`_LOGGER.warning`**
   with the token embedded (`__init__.py:142-152`).
2. **`default-assist` removal** — drops the legacy builtin from
   `entry.options["modes"]`; repoints `default_mode` to `default-realtime`.
3. **`ensure_builtin_modes`** — seeds builtins into `options["modes"]`.
4. **`_migrate_voice_entity_ids`** (M02c) — entity_id rename, runs **before**
   platform forward.
5. `async_forward_entry_setups(entry, PLATFORMS)` — 7 platforms:
   `BINARY_SENSOR, BUTTON, LIGHT, NUMBER, SELECT, SENSOR, TEXT`.
   (Note: **7**, not 6 — `NUMBER` is present too.)
6. `_register_services(hass)` — the 13 services.
7. `_register_led_pusher`, `_register_button_handler`,
   `_register_device_discovery`, `_register_wake_word_pusher`,
   `_register_voix_adoption`.

### 1c. The 13 services (verified, `_register_services`, `__init__.py:224`)

| # | service (string) | handler | response? |
|---|---|---|---|
| 1 | `cycle_mode` | `_cycle` | no |
| 2 | `set_mode` | `_set` | no |
| 3 | `create_mode` | `_create_mode` | no |
| 4 | `update_mode` | `_update_mode` | no |
| 5 | `delete_mode` | `_delete_mode` | no |
| 6 | `get_transcript` | `_get_transcript` | **`SupportsResponse.ONLY`** |
| 7 | `list_modes` | `_list_modes` | **`SupportsResponse.ONLY`** |
| 8 | `cycle_voice` | `_cycle` (shared) | no |
| 9 | `set_voice` | `_set_voice` | no |
| 10 | `create_voice` | `_create_mode` (shared) | no |
| 11 | `update_voice` | `_update_voice` | no |
| 12 | `delete_voice` | `_delete_voice` | no |
| 13 | `list_voices` | `_list_voices` | **`SupportsResponse.ONLY`** |

Constants live in `const.py` (`SERVICE_*`). `CONF_MODES = "modes"`,
`CONF_VOICES = CONF_MODES` (alias). `entry.options["modes"]` is a **dict**
`{mode_id: mode_def}` — *not* a list.

> **`_register_services` takes only `hass`** (not `entry`) and is **idempotent**
> via an early `has_service(DOMAIN, SERVICE_CYCLE_MODE)` guard — so a second
> entry/reload will not re-register. Tests must account for this (services are
> global, registered once per HA instance).

---

## 2. ⚠️ CORRECTION to the task premise: `list_voices` is NOT byte-equal to `list_modes`

The brief asks to "assert `voix.list_voices` and `voix.list_modes` return the
same payload (M02b alias)." **They do not, and a test asserting equality will
fail against current code.** Verified handlers:

```python
# _list_modes  → {"modes":  [{"mode_id":  mid, **mdef}, ...]}   (__init__.py:465)
# _list_voices → {"voices": [{"voice_id": mid, **mdef}, ...]}   (__init__.py:529)
```

The alias shares the *underlying catalog* but deliberately uses a different
**wrapper key** (`modes` vs `voices`) and a different **row-id key**
(`mode_id` vs `voice_id`) so the Tauri app can switch vocab without re-deriving
fields. The correct assertion is **equivalence-modulo-key-rename**, and pinning
it is valuable precisely because a future "tidy up the alias" change could
accidentally make them diverge in the *data* too.

```python
async def test_list_voices_mirrors_list_modes(hass, setup_entry):
    modes = await hass.services.async_call(
        DOMAIN, "list_modes", {}, blocking=True, return_response=True)
    voices = await hass.services.async_call(
        DOMAIN, "list_voices", {}, blocking=True, return_response=True)

    m_rows = {r["mode_id"]: {k: v for k, v in r.items() if k != "mode_id"}
              for r in modes["modes"]}
    v_rows = {r["voice_id"]: {k: v for k, v in r.items() if k != "voice_id"}
              for r in voices["voices"]}
    assert m_rows == v_rows          # same catalog, key-renamed
    assert "voices" in voices and "modes" in modes   # wrapper keys differ
```

If product intent is in fact byte-identical payloads, that's a **code change**
(`_list_voices` should return `{"voices": rows_with_mode_id}` or the doc/brief
should be corrected). Flag to the owner; do not silently encode either choice.

---

## 3. Service-registration tests

```python
# tests/test_services.py
from custom_components.voix.const import DOMAIN

EXPECTED = {
    "cycle_mode","set_mode","create_mode","update_mode","delete_mode",
    "get_transcript","list_modes",
    "cycle_voice","set_voice","create_voice","update_voice","delete_voice",
    "list_voices",
}

async def test_exactly_13_services(hass, setup_entry):
    got = set(hass.services.async_services().get(DOMAIN, {}))
    assert got == EXPECTED            # exact: catches both missing AND extra
    assert len(got) == 13

async def test_response_services_declared(hass, setup_entry):
    # list_modes/list_voices/get_transcript must be SupportsResponse.ONLY;
    # a regression to a plain service breaks return_response=True callers
    # (the Mac app + voix.get_transcript). Calling with return_response on a
    # non-response service raises, so this asserts the contract behaviourally.
    for svc in ("list_modes", "list_voices"):
        await hass.services.async_call(DOMAIN, svc, {}, blocking=True,
                                       return_response=True)  # must not raise
```

Idempotency: because `_register_services` guards on `cycle_mode`, add
`test_double_setup_keeps_13` (set up a 2nd `MockConfigEntry` — but note single-
instance config flow; for a 2nd entry use `async_setup`/`async_reload` of the
same entry) asserting still exactly 13 and no `ServiceRegistrationError`.

---

## 4. M02c entity-registry migration tests

Verified behaviour (`_migrate_voice_entity_ids`, `__init__.py:88`):
- Renames **`entity_id`** (via `registry.async_update_entity(eid,
  new_entity_id=...)`), **NOT `unique_id`** (deliberate — unique_id is identity).
- Match rule: substring `"voix_mode_"` in entity_id → replace first occurrence
  with `"voix_voice_"`; plus suffix `voix_default_mode` → `voix_default_voice`.
- Idempotent: skips when `new == old` and when target already exists (clobber
  guard); logs `_LOGGER.warning`.
- Iterates `er.async_entries_for_config_entry(registry, entry.entry_id)`.

```python
# tests/test_migration.py
from homeassistant.helpers import entity_registry as er
from custom_components.voix.const import DOMAIN

async def _seed(hass, entry, object_id, unique):
    reg = er.async_get(hass)
    return reg.async_get_or_create(
        domain="select", platform=DOMAIN, unique_id=unique,
        config_entry=entry, suggested_object_id=object_id,
    )  # entity_id becomes select.<object_id>

async def test_renames_mode_entity_id_to_voice(hass, mock_esphome):
    entry = _make_entry(hass)                       # helper in conftest
    ent = await _seed(hass, entry, "voix_mode_kitchen", "uid-kitchen")
    assert ent.entity_id == "select.voix_mode_kitchen"

    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()

    reg = er.async_get(hass)
    # unique_id is preserved; entity_id is renamed
    eid = reg.async_get_entity_id("select", DOMAIN, "uid-kitchen")
    assert eid == "select.voix_voice_kitchen"

async def test_default_mode_suffix_renamed(hass, mock_esphome):
    entry = _make_entry(hass)
    await _seed(hass, entry, "voix_default_mode", "uid-default")
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    reg = er.async_get(hass)
    assert reg.async_get_entity_id("select", DOMAIN, "uid-default") \
        == "select.voix_default_voice"

async def test_migration_idempotent(hass, mock_esphome):
    entry = _make_entry(hass)
    await _seed(hass, entry, "voix_mode_kitchen", "uid-kitchen")
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    await hass.config_entries.async_reload(entry.entry_id)
    await hass.async_block_till_done()
    reg = er.async_get(hass)
    voice_ids = [e.entity_id for e in
                 er.async_entries_for_config_entry(reg, entry.entry_id)
                 if "voix_voice_" in e.entity_id]
    assert voice_ids == ["select.voix_voice_kitchen"]   # not duplicated

async def test_clobber_guard(hass, mock_esphome):
    # Both old and new exist (a half-finished prior migration) → migration
    # must leave both rather than crash.
    entry = _make_entry(hass)
    await _seed(hass, entry, "voix_mode_kitchen", "uid-old")
    await _seed(hass, entry, "voix_voice_kitchen", "uid-new")
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()  # no exception; both survive
```

---

## 5. Voice/mode CRUD tests (operates on the `options["modes"]` **dict**)

Verified (`_create_mode`/`_update_mode`/`_delete_mode` + voice aliases):
- `create` slugs the name via `slugify_mode_id`, dedups `name`,`name-2`,`name-3`,
  writes a full mode_def with defaults (`color=[3,169,244]`, `brightness=0.40`,
  `type=realtime`, …), `async_update_entry`.
- `update` is a **partial** merge over existing fields; unknown `mode_id`
  → `_LOGGER.warning` and **no raise** (silent no-op — see gap §9).
- `delete` **refuses to delete the last mode** (`len(modes) <= 1` → warning,
  no-op); repoints `CONF_DEFAULT_MODE` if it pointed at the deleted id.
- `update_voice`/`delete_voice` accept `voice_id` *or* `mode_id`, then delegate
  to the mode handlers via a duck-typed `_RemappedCall`.

```python
# tests/test_crud.py
from custom_components.voix.const import DOMAIN, CONF_MODES

def _modes(hass, entry):
    cur = hass.config_entries.async_get_entry(entry.entry_id)  # re-fetch! not stale
    return dict((cur.options or {}).get(CONF_MODES) or {})

async def test_create_voice_adds_mode(hass, setup_entry):
    entry = setup_entry
    n = len(_modes(hass, entry))
    await hass.services.async_call(DOMAIN, "create_voice",
        {"name": "Kitchen Helper", "prompt": "cook"}, blocking=True)
    modes = _modes(hass, entry)
    assert len(modes) == n + 1
    assert "kitchen-helper" in modes               # slugified id
    assert modes["kitchen-helper"]["prompt"] == "cook"
    assert modes["kitchen-helper"]["type"] == "realtime"   # default

async def test_create_dedupes_slug(hass, setup_entry):
    for _ in range(2):
        await hass.services.async_call(DOMAIN, "create_voice",
            {"name": "Work"}, blocking=True)
    ids = set(_modes(hass, setup_entry))
    assert {"work", "work-2"} <= ids

async def test_update_voice_partial_merge_via_alias(hass, setup_entry):
    # exercises the voice_id→mode_id remap path
    mid = next(iter(_modes(hass, setup_entry)))
    await hass.services.async_call(DOMAIN, "update_voice",
        {"voice_id": mid, "prompt": "changed"}, blocking=True)
    assert _modes(hass, setup_entry)[mid]["prompt"] == "changed"

async def test_delete_voice_removes_and_repoints_default(hass, setup_entry):
    modes = _modes(hass, setup_entry)
    assert len(modes) >= 2                       # builtins seed >= 2
    victim = next(iter(modes))
    await hass.services.async_call(DOMAIN, "delete_voice",
        {"voice_id": victim}, blocking=True)
    assert victim not in _modes(hass, setup_entry)

async def test_delete_last_mode_refused(hass, setup_entry):
    # delete down to 1, then assert the last delete is a no-op
    modes = list(_modes(hass, setup_entry))
    for mid in modes[1:]:
        await hass.services.async_call(DOMAIN, "delete_voice",
            {"voice_id": mid}, blocking=True)
    last = list(_modes(hass, setup_entry))[0]
    await hass.services.async_call(DOMAIN, "delete_voice",
        {"voice_id": last}, blocking=True)
    assert len(_modes(hass, setup_entry)) == 1   # refused
```

> **`async_update_entry` replaces the options dict** — always re-fetch the entry
> (`async_get_entry`) before asserting. A captured `entry.options` reference goes
> stale; this is the #1 false-negative in HA option tests (the integration's own
> code re-fetches for exactly this reason — see `_on_mode_change`).

---

## 6. `voix_set_state` ESPHome push tests

Verified (`_push_state`, `__init__.py:952`):
- Calls `esphome.<slug>_voix_set_state` with payload
  `{"mode_type": ..., "wake_word": ..., "mode_id": ...}`.
- `slug = device_id.replace("-","_").lower()` (`util.device_slug`).
- Guarded by `has_service("esphome", f"{slug}_voix_set_state")`.
- `mode_type` = `get_mode(entry, mode_id).get("type")`.
- `mode_id` read from `select.voix_mode_<slug>` state (`_current_mode_id`).
- `wake_word` read from `select.voix_wake_word_<slug>` state.
- Fired by `_initial_push` (for devices in `options["discovered_devices"]` that
  are `_voix_capable` == have `voix_set_server`), discovery, `EVENT_MODE_CHANGED`,
  a `state_changed` on `select.voix_wake_word_*`, and `service_registered`.

```python
# tests/test_state_push.py
from pytest_homeassistant_custom_component.common import async_mock_service

DEV = "home-assistant-voice-095e4e"          # ESPHome name (hyphens)
SLUG = "home_assistant_voice_095e4e"

async def test_set_state_payload(hass, mock_esphome):
    set_state = async_mock_service(hass, "esphome", f"{SLUG}_voix_set_state")
    async_mock_service(hass, "esphome", f"{SLUG}_voix_set_server")
    # seed the two select states the handler reads
    hass.states.async_set(f"select.voix_mode_{SLUG}", "default-realtime")
    hass.states.async_set(f"select.voix_wake_word_{SLUG}", "okay_nabu")

    entry = _make_entry(hass, options={
        "modes": {"default-realtime": {"name": "Realtime", "type": "realtime"}},
        "discovered_devices": {DEV: {"friendly_name": "Voice"}},
        "daemon_url": "ws://daemon.local/ws",
    })
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()

    assert set_state.calls, "voix_set_state was never called"
    data = set_state.calls[-1].data
    assert data == {"mode_type": "realtime", "wake_word": "okay_nabu",
                    "mode_id": "default-realtime"}

async def test_set_state_skipped_without_esphome_action(hass, mock_esphome):
    # load-order race: esphome action not registered yet → no crash, no push
    entry = _make_entry(hass, options={
        "discovered_devices": {DEV: {}}, "modes": {}})
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()            # must not raise

async def test_mode_changed_repushes(hass, mock_esphome):
    set_state = async_mock_service(hass, "esphome", f"{SLUG}_voix_set_state")
    async_mock_service(hass, "esphome", f"{SLUG}_voix_set_server")
    hass.states.async_set(f"select.voix_mode_{SLUG}", "default-realtime")
    entry = _make_entry(hass, options={
        "discovered_devices": {DEV: {}},
        "modes": {"default-realtime": {"type": "realtime"}}})
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    n = len(set_state.calls)
    from custom_components.voix.const import EVENT_MODE_CHANGED
    hass.bus.async_fire(EVENT_MODE_CHANGED,
                        {"entry_id": entry.entry_id, "device_id": DEV,
                         "to": "default-realtime"})
    await hass.async_block_till_done()
    assert len(set_state.calls) > n
```

This trio encodes the two real adoption bugs from `CLAUDE.md`: the
hyphen↔underscore slug, and the load-order race where ESPHome actions aren't
registered at setup. `test_set_state_skipped_without_esphome_action` is the
single highest-value test in the suite.

---

## 7. conftest, the esphome-dependency wrinkle, and the symbol gate

### 7a. The `dependencies: ["esphome"]` problem (must solve or all setup tests fail)
Because `manifest.json` declares `dependencies: ["esphome"]`, HA sets up the
`esphome` component before the voix entry. Three options, easiest first:
1. **Bootstrap the esphome component** in the fixture:
   `assert await async_setup_component(hass, "esphome", {})`. Works because the
   stub setup of esphome with no entries is cheap. ‹VERIFY this is sufficient on
   the pinned HA version; esphome may require config entries.›
2. **Patch the dependency check** — `async_mock_service` for the esphome actions
   plus monkeypatching the integration's manifest dependencies in the test
   (brittle; avoid).
3. **Code change** — make esphome an `after_dependencies` instead of a hard
   `dependencies` if voix degrades gracefully when esphome is absent (it already
   guards every esphome call with `has_service`). This is the cleanest long-term
   fix and *improves* resilience; recommend it. Until then, option 1.

A `mock_esphome` fixture wraps option 1 and registers no-op
`<slug>_voix_set_server` / `_voix_set_state` / `_voix_refresh` / `_voix_va_stop`
services so the adoption code paths don't error.

### 7b. Lingering background tasks (real, will cause test warnings/hangs)
`async_setup_entry` schedules tasks that **outlive the test**:
- `_register_voix_adoption._delayed_recheck` → `await asyncio.sleep(30)`
  (`__init__.py:1162`).
- `_register_wake_word_pusher._push_for` → `await asyncio.sleep(3.0)` per known
  device (`__init__.py:739`).
- `_initial_push` calls `persistent_notification.create` (a service that must
  exist) and `_LOGGER.error(...)` diagnostics.

PHACC fails tests with "lingering timer/task" unless handled. Mitigations:
- Register `persistent_notification` via
  `await async_setup_component(hass, "persistent_notification", {})` (or
  `async_mock_service`) in the fixture.
- Use **`freezegun`/`freeze_time`** or `pytest-aiohttp`'s task draining, or
  patch `asyncio.sleep` for the setup tests, to avoid the 30s/3s sleeps.
- **Recommended code change:** gate the `persistent_notification` diagnostics +
  `_delayed_recheck` + `_LOGGER.error` adoption dumps behind a debug option.
  This is shipped debug scaffolding (see §9) — gating it makes prod quieter
  *and* makes setup trivially testable.

### 7c. Layout & conftest
```
ha-integration/
  custom_components/voix/...
  tests/
    conftest.py
    test_const_gate.py     # runs first; fails loud on any wrong symbol
    test_services.py  test_migration.py  test_crud.py
    test_state_push.py  test_config_flow.py  test_transcript.py
  requirements_test.txt
  pytest.ini
```
Run with cwd = `ha-integration/` so `custom_components.voix` imports.

```python
# tests/conftest.py
import pytest
from pytest_homeassistant_custom_component.common import MockConfigEntry
from homeassistant.setup import async_setup_component
from pytest_homeassistant_custom_component.common import async_mock_service
from custom_components.voix.const import DOMAIN, CONF_MODES, CONF_WS_TOKEN

pytest_plugins = "pytest_homeassistant_custom_component"

@pytest.fixture(autouse=True)
def auto_enable_custom_integrations(enable_custom_integrations):
    yield

@pytest.fixture
async def mock_esphome(hass):
    assert await async_setup_component(hass, "esphome", {})
    await async_setup_component(hass, "persistent_notification", {})
    yield

def _make_entry(hass, *, data=None, options=None):
    entry = MockConfigEntry(
        domain=DOMAIN,
        data=data if data is not None else {CONF_WS_TOKEN: "tok_test"},
        options=options if options is not None else {
            CONF_MODES: {"default-realtime": {"name": "Realtime",
                                              "type": "realtime"}}},
    )
    entry.add_to_hass(hass)
    return entry

@pytest.fixture
def make_entry(hass):
    return lambda **kw: _make_entry(hass, **kw)

@pytest.fixture
async def setup_entry(hass, mock_esphome):
    entry = _make_entry(hass)
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    return entry
```

```ini
# pytest.ini
[pytest]
asyncio_mode = auto
testpaths = tests
```

```
# requirements_test.txt  — pin BOTH to the device's HA line (ha core info)
homeassistant==2025.5.*
pytest-homeassistant-custom-component==0.13.*   # release matching the HA line
freezegun
```

### 7d. The symbol gate (`test_const_gate.py`, runs first)
```python
import custom_components.voix.const as const

def test_service_constants():
    svc = {k: v for k, v in vars(const).items() if k.startswith("SERVICE_")}
    assert set(svc.values()) >= {
        "cycle_mode","set_mode","create_mode","update_mode","delete_mode",
        "get_transcript","list_modes","cycle_voice","set_voice","create_voice",
        "update_voice","delete_voice","list_voices",
    }

def test_conf_aliases():
    assert const.CONF_VOICES == const.CONF_MODES == "modes"
    assert const.TRANSCRIPTS_DIRNAME == "voix/transcripts"
```

---

## 7e. Config-flow + WS-token tests

The WS token is minted in **two** places (both verified, both
`_LOGGER.warning` with the token in the message):
- `config_flow.async_step_user` (`config_flow.py:47-52`) on fresh install.
- `async_setup_entry` (`__init__.py:142-152`) for legacy entries lacking a token.

```python
# tests/test_config_flow.py
import logging
from homeassistant import config_entries
from homeassistant.data_entry_flow import FlowResultType
from custom_components.voix.const import DOMAIN, CONF_WS_TOKEN, CONF_MODES

async def test_install_mints_token_and_warns(hass, caplog):
    caplog.set_level(logging.WARNING)
    res = await hass.config_entries.flow.async_init(
        DOMAIN, context={"source": config_entries.SOURCE_USER})
    assert res["type"] == FlowResultType.CREATE_ENTRY
    token = res["data"][CONF_WS_TOKEN]
    assert len(token) >= 24
    assert token in caplog.text                  # operator can copy it
    assert res["options"][CONF_MODES]            # builtins seeded

async def test_single_instance(hass):
    await hass.config_entries.flow.async_init(
        DOMAIN, context={"source": config_entries.SOURCE_USER})
    res = await hass.config_entries.flow.async_init(
        DOMAIN, context={"source": config_entries.SOURCE_USER})
    assert res["type"] == FlowResultType.ABORT
    assert res["reason"] == "single_instance_allowed"

async def test_setup_backfills_token_for_legacy_entry(hass, mock_esphome,
                                                      make_entry, caplog):
    caplog.set_level(logging.WARNING)
    entry = make_entry(data={})                  # no ws_token
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    cur = hass.config_entries.async_get_entry(entry.entry_id)
    assert cur.data[CONF_WS_TOKEN]
    assert cur.data[CONF_WS_TOKEN] in caplog.text
```

## 7f. Transcript service (testable today — path is under `hass.config.path`)

`get_transcript` resolves under `hass.config.path("voix/transcripts")` and
rejects paths outside it (`__init__.py:419-459`). PHACC's `hass` has a tmp
config dir, so this is testable with **no code change**:

```python
# tests/test_transcript.py
import pytest
from pathlib import Path
from homeassistant.exceptions import HomeAssistantError, ServiceValidationError
from custom_components.voix.const import DOMAIN, TRANSCRIPTS_DIRNAME

async def test_get_transcript_reads_file(hass, setup_entry):
    base = Path(hass.config.path(TRANSCRIPTS_DIRNAME)) / "dev"
    base.mkdir(parents=True, exist_ok=True)
    f = base / "s1-user.txt"; f.write_text("hello world")
    res = await hass.services.async_call(
        DOMAIN, "get_transcript", {"filepath": str(f)},
        blocking=True, return_response=True)
    assert res["content"] == "hello world"
    assert res["char_count"] == 11

async def test_get_transcript_rejects_traversal(hass, setup_entry):
    with pytest.raises(ServiceValidationError):
        await hass.services.async_call(
            DOMAIN, "get_transcript", {"filepath": "/etc/passwd"},
            blocking=True, return_response=True)

async def test_get_transcript_missing_file(hass, setup_entry):
    base = Path(hass.config.path(TRANSCRIPTS_DIRNAME)); base.mkdir(exist_ok=True)
    with pytest.raises(HomeAssistantError):
        await hass.services.async_call(
            DOMAIN, "get_transcript",
            {"filepath": str(base / "nope.txt")},
            blocking=True, return_response=True)
```

---

## 8. CI strategy (GitHub Actions)

**Key fact:** "a real HA core install" = `pip install homeassistant`. No HAOS,
no Docker-in-Docker, no Yellow. PHACC + a pinned `homeassistant` runs the whole
suite on stock `ubuntu-latest`.

```yaml
# .github/workflows/ha-integration-tests.yml
name: ha-integration tests
on:
  pull_request: { paths: ["ha-integration/**"] }
  push: { branches: [main], paths: ["ha-integration/**"] }
jobs:
  pytest:
    runs-on: ubuntu-latest
    defaults: { run: { working-directory: ha-integration } }
    strategy:
      fail-fast: false
      matrix:
        python-version: ["3.13"]      # dictated by HA, not us
        ha-version: ["2025.5.*"]      # match the Yellow's `ha core info`
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with: { python-version: "${{ matrix.python-version }}", cache: pip }
      - run: pip install -r requirements_test.txt
      - run: pip install "homeassistant==${{ matrix.ha-version }}"
      - run: pytest -q --maxfail=1
```

Notes / gotchas:
- **Cache pip** — `homeassistant` + deps is hundreds of MB; cold install
  dominates (~2–4 min), warm cache <1 min.
- **Pin HA to the device's actual line** (`ssh root@…15 'ha core info'`). A
  floating `homeassistant` eventually pulls a release PHACC can't support and
  reds the job for unrelated reasons. PHACC versions are 1:1 with HA core.
- **Python version follows HA** (2025.x ⇒ 3.13). Read HA's `pyproject` floor
  before bumping.
- **No secrets** — everything is mocked; tokens are generated locally. Do not
  wire OpenAI/HA-Cloud creds into CI.
- **Optional second job: `hassfest`/`ha core check`** — keep the existing
  manual smoke as a cheap manifest/translation validator
  (`python -m script.hassfest` against a checkout, or `hass --script
  check_config`). Catches manifest/translation drift unit tests miss.
- **Coverage**: add `pytest-cov`, start the gate ~45–50%, ratchet. §3–§7f alone
  cover the service/migration/CRUD/adoption/token spine; the long tail is the
  7 entity platforms and the daemon WS path (§9).

---

## 9. Ruthless gap list

1. **Brief premise #1 is wrong** (§2): `list_voices` ≠ `list_modes` payload in
   code. Decide intent before writing the assertion. *(Highest-priority human
   decision.)*
2. **Shipped debug scaffolding** (`__init__.py:1107-1176`): `_initial_push` and
   `_delayed_recheck` create `persistent_notification`s and emit
   **`_LOGGER.error("voix adoption diagnostic …")`** on *every* setup, plus a
   30s timer. This is debug code in prod; it also actively fights the test
   harness (§7b). **Recommend gating behind a debug option.** A
   `test_no_error_log_on_clean_setup` would lock the cleanup in.
3. **Silent no-ops** (`update_mode`/`delete_mode` on unknown id, `delete` of the
   last mode) only `_LOGGER.warning` and return. Callers (Tauri app) can't tell
   success from "silently ignored." Consider raising `ServiceValidationError`;
   until then tests assert the no-op + warning, which *documents* the smell.
4. **`dependencies: ["esphome"]`** (§7a) couples every setup test to bootstrapping
   esphome. Switching to `after_dependencies` is a small, resilience-improving
   code change (voix already `has_service`-guards every esphome call).
5. **`select.py` is 18 KB / `light.py` 7.6 KB / 7 platforms** — this plan covers
   setup + migration + services + adoption + token + transcript. It does **not**
   yet assert per-entity state/attributes. Phase 2: one `test_<platform>.py`
   each via `hass.states.get(...)`; `select.cycle()` + wake-word push helpers in
   `select.py` deserve focused tests (they encode the wake-word slot logic).
6. **Possible duplicate definitions** in `modes.py` — `get_modes_list` and
   `slugify_mode_id` *appeared* twice in the read (lines ~103-120 and ~125-136).
   This may be a read artifact; **‹VERIFY› directly** — if real, it's harmless
   (last def wins) but worth deleting. A trivial AST/`flake8 F811` lint catches
   redefinition; add `ruff` to CI.
7. **Daemon ↔ OpenAI realtime WS path = out of scope here.** Echo gate,
   16→24 kHz resampling, the firmware `errno=11`/`Memory exhausted`/2×-speed
   bugs — none reachable from PHACC. Those need the daemon's own test tier +
   firmware rig. State that loudly so "HA tests green" is never read as
   "the product works."
8. **MCP / HA-LLM prompt assembly** (api_prompt + extras + mode prompt; memory:
   `voix_modes_architecture`, `ha_llm_helper_api`) — testable via
   `llm.async_get_api` mocks but higher effort; deferred to phase 2.
9. **Concurrency** — only single idempotent reload is tested. HA serializes
   service calls so racing create/delete on the `modes` dict is low-risk, but
   a `test_concurrent_create` would close it.

---

## 10. Landing order

1. `conftest.py` + `requirements_test.txt` + `pytest.ini` + `test_const_gate.py`
   — proves the harness imports the *real* integration and the contract holds.
2. Resolve §7a (esphome dep) + §7b (lingering tasks) — without these, no setup
   test runs cleanly. Prefer the two small code changes (gate diagnostics,
   `after_dependencies`); they pay for themselves immediately.
3. `test_services.py` (§3) — fastest signal.
4. `test_migration.py` (§4) — the M02c regression net.
5. `test_state_push.py` (§6) — encodes two real adoption bugs.
6. `test_crud.py` (§5) + `test_config_flow.py` (§7e) + `test_transcript.py` (§7f).
7. Decide §2 (`list_voices` payload) with the owner; encode the chosen contract.
8. Wire CI (§8) + add `ruff` (catches §9.6).
9. Phase 2: per-platform state tests, LLM prompt-assembly, concurrency.

Everything in steps 1–8 is implementable against current code; steps 2 and 7
are the only ones that touch the integration itself, and both are improvements
worth making regardless of tests.
