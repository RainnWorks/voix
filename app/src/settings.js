// SPA entry point. Owns: view routing, settings load/save, conversation
// state, modes list + editor, sessions persistence, sidebar wiring.

import { tauri } from "./tauri-shim.js";
import { listDevices, listModes } from "./ha.js";

const $ = (id) => document.getElementById(id);

let settings = null;
let modeCache = [];     // list of {mode_id, name, type, color}
let deviceCache = [];   // list of {device_id, friendly_name}
let activeModeIdByDevice = {}; // device_id → mode_id from select state
let editingModeId = null;
let modeSaveTimer = null;

// Twelve-colour mode palette (the desktop guide's exception to "three
// colours"). Names match HA's catalog convention; the rgb tuples are
// stored back to entry.options.modes[*].color.
const PALETTE = [
  { key: "ha-blue",  name: "HA blue",  rgb: [3, 169, 244]   },
  { key: "amber",    name: "Amber",    rgb: [245, 158, 11]  },
  { key: "violet",   name: "Violet",   rgb: [139, 92, 246]  },
  { key: "green",    name: "Green",    rgb: [16, 185, 129]  },
  { key: "coral",    name: "Coral",    rgb: [249, 115, 22]  },
  { key: "magenta",  name: "Magenta",  rgb: [236, 72, 153]  },
  { key: "sky",      name: "Sky",      rgb: [125, 211, 252] },
  { key: "lemon",    name: "Lemon",    rgb: [253, 224, 71]  },
  { key: "lavender", name: "Lavender", rgb: [196, 181, 253] },
  { key: "mint",     name: "Mint",     rgb: [110, 231, 183] },
  { key: "peach",    name: "Peach",    rgb: [253, 186, 116] },
  { key: "slate",    name: "Slate",    rgb: [148, 163, 184] },
];

function nearestSwatch(rgb) {
  if (!rgb || rgb.length !== 3) return PALETTE[0];
  let best = PALETTE[0];
  let bestD = Infinity;
  for (const p of PALETTE) {
    const dr = p.rgb[0] - rgb[0];
    const dg = p.rgb[1] - rgb[1];
    const db = p.rgb[2] - rgb[2];
    const d = dr * dr + dg * dg + db * db;
    if (d < bestD) { bestD = d; best = p; }
  }
  return best;
}

// ─── View routing ───────────────────────────────────────────────────────

const ROUTES = ["conversation", "modes", "mode-editor", "devices"];
function route(name) {
  for (const r of ROUTES) {
    $(`view-${r}`).classList.toggle("active", r === name);
  }
  for (const el of document.querySelectorAll(".sb-flat-item")) {
    el.classList.toggle("sel", el.dataset.route === name);
  }
}

// ─── Init ───────────────────────────────────────────────────────────────

async function init() {
  if (!tauri.available) {
    bannerErr("Tauri runtime not detected — open via `npm run dev`.");
    return;
  }

  // Apply system theme as a body attribute. wry's prefers-color-scheme on
  // macOS isn't trustworthy (it can report dark while the OS is in light
  // mode), so we read the real Appearance via the Rust side and listen
  // for ThemeChanged events to keep it in sync.
  try {
    const t = await tauri.invoke("get_theme");
    document.body.setAttribute("data-theme", t);
  } catch {
    document.body.setAttribute("data-theme", "light");
  }
  await tauri.listen("voix://theme-changed", (e) => {
    document.body.setAttribute("data-theme", e.payload || "light");
  });

  // Window dragging is handled by the native NSWindow because the
  // titlebar has `pointer-events: none` (see style.css). No JS needed.

  settings = await tauri.invoke("get_settings");

  // Sidebar route clicks
  document.querySelectorAll(".sb-flat-item[data-route]").forEach((el) => {
    el.addEventListener("click", () => {
      const r = el.dataset.route;
      route(r);
      if (r === "modes") renderModes();
    });
  });

  // "New conversation" — there's no remote start signal yet (the device
  // initiates), so this just clears the transcript and parks the user
  // on the conversation view ready for the next "Hey Mycroft".
  $("sb-new").addEventListener("click", newConversation);
  await tauri.listen("voix://menu/new-conversation", newConversation);

  // Mode editor: ← Modes link
  $("mode-back").addEventListener("click", (e) => {
    e.preventDefault();
    route("modes");
    renderModes();
  });

  // New mode button (enable now — Wave 2 wires it)
  $("mode-new").disabled = false;
  $("mode-new").style.opacity = "";
  $("mode-new").addEventListener("click", action(createMode));

  // Settings form bindings (Devices view).
  $("ha-url").value = settings.ha_url || "";
  $("ha-token").value = settings.ha_token || "";
  bindToggle("def-dict-copy", settings.default_behavior?.copy ?? true, (v) => {
    settings.default_behavior = { ...settings.default_behavior, copy: v };
    pushSettings();
  });
  bindToggle("def-dict-paste", settings.default_behavior?.paste ?? false, (v) => {
    settings.default_behavior = { ...settings.default_behavior, paste: v };
    pushSettings();
  });
  bindToggle("def-rt-copy", settings.realtime_copy_default ?? false, (v) => {
    settings.realtime_copy_default = v;
    pushSettings();
  });
  bindToggle("def-rt-paste", settings.realtime_paste_default ?? false, (v) => {
    settings.realtime_paste_default = v;
    pushSettings();
  });

  $("save-connection").addEventListener("click", action(async () => {
    settings.ha_url = $("ha-url").value.trim();
    settings.ha_token = $("ha-token").value.trim();
    if (!settings.ha_url || !settings.ha_token) {
      throw new Error("Both URL and token are required.");
    }
    await tauri.invoke("update_settings", { newSettings: settings });
    await tauri.invoke("restart_ha_connection");
    bannerOk("Saved & reconnecting…");
  }));

  $("refresh-devices").addEventListener("click", action(refreshDevices));
  $("test-paste").addEventListener("click", action(() => tauri.invoke("test_paste")));

  // Status pill in the titlebar
  const initial = await tauri.invoke("get_status");
  applyStatus(initial);
  await tauri.listen("voix://status", (e) => applyStatus(e.payload));

  // Conversation streaming
  await tauri.listen("voix://transcript-stream", (e) => streamUpdate(e.payload));
  await tauri.listen("voix://transcript", (e) => {
    // Dictation captures arrive here (no streaming). Show as a single line.
    if (e.payload.source !== "dictation") return;
    appendCompleted(e.payload);
  });
  await tauri.listen("voix://session", (e) => onSession(e.payload));

  // Initial refresh of HA data — non-blocking.
  refreshDevices().catch(() => {});
  refreshModes().catch(() => {});
}

function action(fn) {
  return async () => {
    try {
      $("status-error").textContent = "";
      await fn();
    } catch (e) {
      bannerErr(e?.message ?? String(e));
    }
  };
}

function pushSettings() {
  tauri.invoke("update_settings", { newSettings: settings }).catch((e) => {
    bannerErr(e?.message ?? String(e));
  });
}

function bindToggle(id, initial, onChange) {
  const el = $(id);
  if (!el) return;
  el.classList.toggle("on", !!initial);
  el.addEventListener("click", () => {
    const next = !el.classList.contains("on");
    el.classList.toggle("on", next);
    onChange(next);
  });
}

// ─── Status + session lifecycle ─────────────────────────────────────────

function applyStatus(payload) {
  const { connected, last_error } = payload || {};
  const el = $("titlebar-status");
  el.textContent = connected ? "Connected" : "Disconnected";
  el.classList.toggle("live", false);  // pill goes blue only on session-live
  if (!connected && last_error) bannerErr(last_error);
}

let currentSession = null; // { session_id, device_id }
let lastTurnPerRole = { user: null, assistant: null }; // session_id::role → DOM node

function onSession(payload) {
  const { kind, session_id, device_id } = payload;
  if (kind === "started") {
    currentSession = { session_id, device_id };
    $("titlebar-status").textContent = "Live";
    $("titlebar-status").classList.add("live");
    $("conv-title").textContent = friendlyDevice(device_id) || "Live";
    $("conv-tag").style.display = "";
    $("conv-tag").textContent = "Conversation";
    $("conv-status").textContent = "Now hearing";
    $("conv-status").classList.add("live");
    $("conv-rings").classList.add("hot");
    clearTranscript();
    route("conversation");
  } else if (kind === "ended" && session_id === currentSession?.session_id) {
    $("titlebar-status").textContent = "Idle";
    $("titlebar-status").classList.remove("live");
    $("conv-status").textContent = "Ended";
    $("conv-status").classList.remove("live");
    $("conv-rings").classList.remove("hot");
    lastTurnPerRole = { user: null, assistant: null };
    currentSession = null;
  }
}

function streamUpdate(payload) {
  const { role, text, status, session_id } = payload;
  // First delta of this role+session → new line; subsequent deltas update.
  const key = `${session_id || "no-session"}::${role}`;
  let node = lastTurnPerRole[role];
  if (!node || node.dataset.key !== key) {
    node = ensureLine(role, key);
    lastTurnPerRole[role] = node;
  }
  node.querySelector(".body").textContent = text;
  node.classList.toggle("streaming", status === "streaming");
  if (status === "complete") {
    lastTurnPerRole[role] = null;
    // The "rings emanate when audio is hot" principle: a complete turn
    // means the model finished speaking → rings cool until the next
    // user-speech delta brings them back.
    if (role === "assistant") $("conv-rings").classList.remove("hot");
  } else {
    $("conv-rings").classList.add("hot");
  }
  $("conv-empty").style.display = "none";
  scrollTranscriptToEnd();
}

function appendCompleted(payload) {
  // Dictation captures — a single user line, no streaming.
  const key = `${payload.session_id || crypto.randomUUID()}::dict::${Date.now()}`;
  const node = ensureLine("dictation", key);
  node.querySelector(".body").textContent = payload.text;
  node.classList.remove("streaming");
  $("conv-empty").style.display = "none";
  scrollTranscriptToEnd();
}

function ensureLine(role, key) {
  const root = $("conv-transcript");
  const line = document.createElement("div");
  line.className = `conv-line ${role}`;
  line.dataset.key = key;
  const who = document.createElement("span");
  who.className = "who mono";
  who.textContent =
    role === "assistant" ? "VOIX" :
    role === "user"      ? new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) :
                           "DICT";
  line.appendChild(who);
  const body = document.createElement("span");
  body.className = "body";
  line.appendChild(body);
  root.appendChild(line);
  return line;
}

function scrollTranscriptToEnd() {
  const root = $("conv-transcript");
  root.scrollTop = root.scrollHeight;
}

function clearTranscript() {
  const root = $("conv-transcript");
  root.innerHTML = `
    <div class="conv-empty" id="conv-empty">
      <p>Listening — turns will appear here as they stream.</p>
    </div>`;
}

function friendlyDevice(device_id) {
  if (!device_id) return null;
  const m = deviceCache.find((d) => d.device_id === device_id);
  return m?.friendly_name ?? device_id;
}

// ─── HA data refresh ────────────────────────────────────────────────────

async function refreshDevices() {
  if (!settings.ha_url || !settings.ha_token) {
    $("devices-group").innerHTML =
      '<div class="row"><div class="label" style="color: var(--text-quiet);">Set HA URL + token first.</div></div>';
    return;
  }
  deviceCache = await listDevices(settings.ha_url, settings.ha_token);
  const root = $("devices-group");
  root.innerHTML = "";
  if (deviceCache.length === 0) {
    root.innerHTML =
      '<div class="row"><div class="label" style="color: var(--text-quiet);">No voix devices found.</div></div>';
    return;
  }
  for (const d of deviceCache) {
    const row = document.createElement("div");
    row.className = "row";
    row.innerHTML = `
      <div style="display: flex; align-items: center; gap: 12px;">
        <div class="puck-app size-28" aria-hidden="true"></div>
        <div>
          <div class="label">${escape(d.friendly_name)}</div>
          <div class="desc mono">${escape(d.device_id)}</div>
        </div>
      </div>
      <div class="ctl"><span class="main-status">Idle</span></div>`;
    root.appendChild(row);
  }
}

async function refreshModes() {
  if (!settings.ha_url || !settings.ha_token) return;
  modeCache = await listModes(settings.ha_url, settings.ha_token);
  $("modes-count").textContent = String(modeCache.length);
}

function escape(s) {
  return String(s ?? "").replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
}

function bannerErr(msg) {
  const el = $("status-error");
  el.textContent = msg;
  el.classList.remove("ok");
}
function bannerOk(msg) {
  const el = $("status-error");
  el.textContent = msg;
  el.classList.add("ok");
  setTimeout(() => { if (el.textContent === msg) el.textContent = ""; }, 2500);
}

// ─── Sessions (local persistence) ───────────────────────────────────────
//
// One "session" = one realtime conversation (or one dictation capture).
// We persist {id, name, mode_id, device_id, started_at, ended_at, turns[]}
// in localStorage; the sidebar groups them by day. Sessions are created
// when the HA bridge fires session_started; the name auto-fills from the
// first user transcript (or "Dictation" for one-shot captures).
//
// localStorage is bounded enough for thousands of turns; if it ever gets
// big we'll move to IndexedDB.

const SESSIONS_KEY = "voix.sessions.v1";
let sessions = loadSessions();

function loadSessions() {
  try {
    const raw = localStorage.getItem(SESSIONS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}
function saveSessions() {
  try {
    localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions));
  } catch (e) {
    console.warn("voix: session persist failed:", e);
  }
}

function newConversation() {
  // No-op for now — the device drives session start. We just clear the
  // transcript surface so the user sees a fresh canvas.
  clearTranscript();
  route("conversation");
}

function recordSessionStart(session_id, device_id) {
  if (!session_id) return;
  if (sessions.find((s) => s.id === session_id)) return;
  sessions.unshift({
    id: session_id,
    name: null,
    device_id,
    mode_id: activeModeIdByDevice[device_id] || null,
    started_at: Date.now(),
    ended_at: null,
    turns: [],
  });
  saveSessions();
  renderSidebarSessions();
}

function recordSessionEnd(session_id) {
  const s = sessions.find((s) => s.id === session_id);
  if (!s) return;
  s.ended_at = Date.now();
  saveSessions();
  renderSidebarSessions();
}

function recordTurn(session_id, role, text, source) {
  if (!session_id) return;
  const s = sessions.find((s) => s.id === session_id);
  if (!s) return;
  // Either upsert the last turn (streaming) or append a new completed one.
  const last = s.turns[s.turns.length - 1];
  if (last && last.role === role && last.complete === false) {
    last.text = text;
  } else {
    s.turns.push({ role, text, source, at: Date.now(), complete: false });
  }
  // Auto-name from the first user turn.
  if (!s.name && role === "user" && text) {
    s.name = text.split(/[.!?\n]/)[0].slice(0, 60).trim();
    renderSidebarSessions();
  }
  saveSessions();
}

function markTurnComplete(session_id, role) {
  const s = sessions.find((s) => s.id === session_id);
  if (!s) return;
  const last = s.turns[s.turns.length - 1];
  if (last && last.role === role) last.complete = true;
  saveSessions();
}

function renderSidebarSessions() {
  const root = $("sessions-today");
  if (sessions.length === 0) {
    root.innerHTML = `
      <div class="sb-item" data-nothing>
        <span class="name" style="color: var(--text-quiet); font-weight: 400;">No sessions yet.</span>
        <span class="meta">Say <span class="mono">Hey Mycroft</span> to start one.</span>
      </div>`;
    return;
  }
  // Group sessions by day. For now: Today / Yesterday / (older fall in).
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const yest = today - 24 * 3600 * 1000;
  const groups = { Today: [], Yesterday: [], Older: [] };
  for (const s of sessions) {
    if (s.started_at >= today) groups.Today.push(s);
    else if (s.started_at >= yest) groups.Yesterday.push(s);
    else groups.Older.push(s);
  }

  const scroll = $("sessions-scroll");
  scroll.innerHTML = "";
  for (const [label, list] of Object.entries(groups)) {
    if (list.length === 0) continue;
    const head = document.createElement("div");
    head.className = "sb-section";
    head.textContent = label;
    scroll.appendChild(head);
    const items = document.createElement("div");
    items.className = "sb-items";
    for (const s of list) {
      const item = document.createElement("div");
      item.className = "sb-item";
      if (s.id === currentSession?.session_id) item.classList.add("sel");
      const t = new Date(s.started_at);
      const time = t.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      const modeName = (modeCache.find((m) => m.mode_id === s.mode_id)?.name) || "Conversation";
      item.innerHTML = `
        <span class="name">${escape(s.name || "Untitled")}</span>
        <span class="meta">${time} · ${escape(modeName)}</span>`;
      item.addEventListener("click", () => openSession(s.id));
      items.appendChild(item);
    }
    scroll.appendChild(items);
  }
}

function openSession(session_id) {
  const s = sessions.find((x) => x.id === session_id);
  if (!s) return;
  route("conversation");
  $("conv-title").textContent = s.name || "Session";
  $("conv-tag").style.display = "";
  $("conv-tag").textContent = (modeCache.find((m) => m.mode_id === s.mode_id)?.name) || "Conversation";
  $("conv-status").textContent = s.ended_at ? "Ended" : "Live";
  $("conv-status").classList.toggle("live", !s.ended_at);
  clearTranscript();
  for (const t of s.turns) {
    const node = ensureLine(t.role, `${s.id}::${t.role}::${t.at}`);
    node.querySelector(".body").textContent = t.text;
  }
  // Mark sidebar selection.
  renderSidebarSessions();
}

// ─── Modes list + editor ────────────────────────────────────────────────

function renderModes() {
  const root = $("modes-grid");
  root.innerHTML = "";

  if (modeCache.length === 0) {
    root.innerHTML =
      '<p style="color: var(--text-quiet); font-size: 13px;">No modes yet. Click <strong>＋ New mode</strong> to add one.</p>';
    return;
  }

  const grid = document.createElement("div");
  grid.style.display = "grid";
  grid.style.gridTemplateColumns = "repeat(2, 1fr)";
  grid.style.gap = "12px";

  // Pick the first device's current mode as "ACTIVE" since the desktop
  // app is a personal companion — multi-puck installs are rare.
  const activeId = Object.values(activeModeIdByDevice)[0];

  for (const m of modeCache) {
    const card = document.createElement("div");
    const isActive = m.mode_id === activeId;
    card.className = "mode-card";
    card.style.cssText = `
      display: flex; gap: 12px; align-items: flex-start;
      padding: 14px; border-radius: 10px;
      background: var(--card-bg);
      border: ${isActive ? "2px solid var(--ha-blue)" : "0.5px solid var(--rule)"};
      cursor: default;
    `;
    const swatch = nearestSwatch(m.color);
    const puck = document.createElement("div");
    puck.className = `puck-app size-44 ${swatch.key === "ha-blue" ? "" : swatch.key.replace("ha-", "")}`;
    card.appendChild(puck);
    const body = document.createElement("div");
    body.style.flex = "1";
    body.style.minWidth = "0";
    body.innerHTML = `
      <div style="font-size: 13px; font-weight: 500; color: var(--text); margin-bottom: 2px;">${escape(m.name)}</div>
      <div style="font-size: 11px; color: var(--text-quiet); text-transform: lowercase; letter-spacing: 0.3px;">${escape(m.type)}</div>
      ${isActive ? '<span style="display: inline-block; margin-top: 6px; font-family: \'JetBrains Mono\', monospace; font-size: 9px; color: var(--ha-blue); background: rgba(3,169,244,0.08); padding: 2px 6px; border-radius: 3px; letter-spacing: 0.5px;">ACTIVE</span>' : ""}
    `;
    card.appendChild(body);
    card.addEventListener("click", () => openModeEditor(m.mode_id));
    grid.appendChild(card);
  }
  root.appendChild(grid);
}

async function openModeEditor(mode_id) {
  editingModeId = mode_id;
  const m = modeCache.find((x) => x.mode_id === mode_id);
  if (!m) return;
  route("mode-editor");
  $("mode-editor-title").textContent = "";
  $("mode-saved-state").textContent = "Saved";

  // Seed the color tracker from the existing mode so a save before the
  // user touches the swatch picker still carries the current color (and
  // doesn't fall back to the integration default).
  const swatch = nearestSwatch(m.color);
  editingModeColor = swatch.rgb.slice();
  $("mode-editor-body").innerHTML = `
    <div style="display: flex; align-items: center; gap: 16px; margin-bottom: 20px;">
      <div class="puck-app size-44 ${swatch.key === "ha-blue" ? "" : swatch.key.replace("ha-", "")}" id="me-puck"></div>
      <div style="flex: 1;">
        <input type="text" id="me-name" value="${escape(m.name)}" style="font-size: 17px; font-weight: 500; background: transparent; border: none; outline: none; padding: 2px 0; width: 100%; color: var(--text);" />
        <input type="text" id="me-desc" placeholder="One line of description (optional)" style="font-size: 12px; color: var(--text-quiet); background: transparent; border: none; outline: none; padding: 2px 0; width: 100%;" />
      </div>
    </div>

    <div class="section-label" style="margin-top: 8px;">Puck colour</div>
    <div id="me-swatches" style="display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 18px;"></div>

    <div class="section-label">Behaviour</div>
    <div class="group">
      <div class="row">
        <div>
          <div class="label">Mode type</div>
          <div class="desc">How the puck handles a turn in this mode.</div>
        </div>
        <div class="ctl">
          <select id="me-type">
            <option value="realtime">realtime</option>
            <option value="dictation">dictation</option>
          </select>
        </div>
      </div>
      <div class="row">
        <div>
          <div class="label">Voice</div>
          <div class="desc">OpenAI Realtime voice (realtime only).</div>
        </div>
        <div class="ctl">
          <select id="me-voice">
            <option value="">— default —</option>
            <option>alloy</option><option>ash</option><option>ballad</option>
            <option>coral</option><option>echo</option><option>sage</option>
            <option>shimmer</option><option>verse</option>
            <option>marin</option><option>cedar</option>
          </select>
        </div>
      </div>
      <div class="row">
        <div>
          <div class="label">Model</div>
          <div class="desc">OpenAI Realtime model.</div>
        </div>
        <div class="ctl">
          <input id="me-model" type="text" placeholder="gpt-realtime" style="width: 200px;" />
        </div>
      </div>
    </div>

    <div class="section-label">System prompt</div>
    <textarea id="me-prompt" rows="10" style="width: 100%; font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 11.5px; line-height: 1.5; padding: 10px; min-height: 180px; resize: vertical;" placeholder="You are a concise, friendly assistant. Keep responses brief..."></textarea>

    <div class="section-label" style="margin-top: 16px;">Post-processing
      <span style="font-weight: 400; color: var(--text-quiet); font-size: 11px; margin-left: 6px;">dictation only — rewrites raw transcript via an LLM</span>
    </div>
    <div class="group">
      <div class="row">
        <div>
          <div class="label">Enable post-processing</div>
          <div class="desc">After STT finishes, run the raw transcript through an LLM using the prompt below.</div>
        </div>
        <div class="ctl"><input type="checkbox" id="me-pp-enabled" /></div>
      </div>
      <div class="row" id="me-pp-provider-row">
        <div>
          <div class="label">Provider</div>
          <div class="desc">OpenAI uses the same key as STT. OpenRouter uses the separate key in Defaults.</div>
        </div>
        <div class="ctl">
          <select id="me-pp-provider">
            <option value="openai">OpenAI</option>
            <option value="openrouter">OpenRouter</option>
          </select>
        </div>
      </div>
      <div class="row" id="me-pp-model-row">
        <div>
          <div class="label">Model</div>
          <div class="desc">Any chat-completions model the provider exposes. Cheap/fast models work well here.</div>
        </div>
        <div class="ctl">
          <input id="me-pp-model" type="text" placeholder="gpt-4o-mini" style="width: 240px;" />
        </div>
      </div>
    </div>
    <textarea id="me-pp-prompt" rows="8" style="width: 100%; margin-top: 6px; font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 11.5px; line-height: 1.5; padding: 10px; min-height: 140px; resize: vertical;" placeholder="System prompt for the post-processing LLM. The raw transcript is sent as the user message."></textarea>
    <div class="row" style="margin-top: 6px;">
      <div>
        <div class="label">Routing hint</div>
        <div class="desc">One-line description for auto-mode routing (later) — when should this mode be picked?</div>
      </div>
      <div class="ctl">
        <input id="me-routing-hint" type="text" placeholder="Format as professional email…" style="width: 280px;" />
      </div>
    </div>

    <div class="section-label" style="margin-top: 16px;">On transcript complete</div>
    <div class="group">
      <div class="row">
        <div>
          <div class="label">Copy to clipboard</div>
          <div class="desc">Put the final transcript on the macOS clipboard.</div>
        </div>
        <div class="ctl"><input type="checkbox" id="me-copy" /></div>
      </div>
      <div class="row">
        <div>
          <div class="label">Auto-paste</div>
          <div class="desc">Simulate ⌘V into the frontmost app. Requires Accessibility permission.</div>
        </div>
        <div class="ctl"><input type="checkbox" id="me-paste" /></div>
      </div>
      <div class="row">
        <div>
          <div class="label">Notify</div>
          <div class="desc">Show a macOS notification with a preview of the transcript.</div>
        </div>
        <div class="ctl"><input type="checkbox" id="me-notify" /></div>
      </div>
    </div>

    <div style="margin-top: 18px; display: flex; gap: 10px;">
      <button id="me-delete" style="color: #c4302b; border-color: rgba(196,48,43,0.3);">Delete mode</button>
    </div>
  `;

  // Render the 12 swatches
  const sroot = $("me-swatches");
  for (const p of PALETTE) {
    const s = document.createElement("div");
    s.style.cssText = `
      width: 24px; height: 24px; border-radius: 50%;
      background: rgb(${p.rgb.join(",")});
      cursor: default;
    `;
    s.title = p.name;
    s.dataset.key = p.key;
    if (p.key === swatch.key) {
      s.style.boxShadow = `0 0 0 2px var(--main-bg), 0 0 0 4px rgb(${p.rgb.join(",")})`;
    }
    s.addEventListener("click", () => onPickSwatch(p));
    sroot.appendChild(s);
  }

  // Live edit hooks — debounced auto-save.
  [
    "me-name", "me-desc", "me-type", "me-voice", "me-model", "me-prompt",
    "me-pp-enabled", "me-pp-provider", "me-pp-model", "me-pp-prompt",
    "me-routing-hint",
  ].forEach((id) => {
    $(id).addEventListener("input", queueModeSave);
    $(id).addEventListener("change", queueModeSave);
  });
  // Show/hide post-process detail rows based on the enable toggle. The
  // checkbox stays visible; the prompt + provider + model are noise when
  // post-processing is off.
  const ppToggle = $("me-pp-enabled");
  const ppRows = () => [
    $("me-pp-provider-row"), $("me-pp-model-row"),
    $("me-pp-prompt"),
  ];
  const applyPPVisibility = () => {
    const on = ppToggle.checked;
    for (const el of ppRows()) {
      if (el) el.style.display = on ? "" : "none";
    }
  };
  ppToggle.addEventListener("change", applyPPVisibility);
  // Per-mode behavior toggles live in the desktop app's settings, not HA.
  // They drive what happens on transcript-complete (clipboard / paste /
  // notify). Save immediately on click — no debounce needed.
  ["me-copy", "me-paste", "me-notify"].forEach((id) => {
    $(id).addEventListener("change", action(saveBehaviorToggles));
  });
  $("me-delete").addEventListener("click", action(deleteEditingMode));

  // Populate prompt/voice/model + behavior toggles. The light-entity cache
  // only carries name/color, so fetch the full mode catalog via the
  // voix.list_modes service.
  populateModeEditorFields(m).catch((e) => {
    console.warn("populateModeEditorFields failed", e);
  });
}

async function populateModeEditorFields(m) {
  // voix.list_voices (M02b rename of voix.list_modes). Falls back to
  // empty fields if HA doesn't expose it (older integration version).
  let full = null;
  try {
    const resp = await tauri.invoke("call_ha_service_with_response", {
      domain: "voix",
      service: "list_voices",
      data: {},
    });
    // HA returns {service_response: {voices: [...]}, changed_states: []}.
    // Row id key is `voice_id`. The locally-cached row still uses
    // `mode_id` since the JS hasn't been renamed end-to-end; we match
    // against either as we transition.
    const rows = resp?.service_response?.voices || [];
    const wantedId = m.mode_id || m.voice_id;
    full = rows.find((r) => r.voice_id === wantedId) || null;
  } catch (e) {
    console.warn("voix.list_voices not available", e);
  }

  $("me-prompt").value = full?.prompt || "";
  $("me-voice").value = full?.voice || "";
  $("me-model").value = full?.model || "";
  $("me-type").value = full?.type || m.type || "realtime";

  // Post-processing fields. Empty post_process_prompt = disabled, so
  // derive the toggle from prompt presence and let users clear it via
  // unchecking the toggle (queueModeSave sends empty string on save).
  const ppPrompt = full?.post_process_prompt || "";
  const ppToggle = $("me-pp-enabled");
  ppToggle.checked = !!ppPrompt;
  $("me-pp-provider").value = full?.post_process_provider || "openai";
  $("me-pp-model").value = full?.post_process_model || "gpt-4o-mini";
  $("me-pp-prompt").value = ppPrompt;
  $("me-routing-hint").value = full?.routing_hint || "";
  // Apply visibility now that values are populated.
  for (const el of [
    $("me-pp-provider-row"), $("me-pp-model-row"), $("me-pp-prompt"),
  ]) {
    if (el) el.style.display = ppToggle.checked ? "" : "none";
  }

  // Behavior toggles — read from desktop-app settings (the per-mode
  // override map, falling back to defaults).
  const behavior = behaviorForMode(m.mode_id, (full?.type || m.type) === "realtime");
  $("me-copy").checked = !!behavior.copy;
  $("me-paste").checked = !!behavior.paste;
  $("me-notify").checked = !!behavior.notify;
}

function behaviorForMode(mode_id, isRealtime) {
  const s = settings || {};
  const map = s.modes || {};
  if (map[mode_id]) return map[mode_id];
  if (isRealtime) {
    return {
      copy: s.realtime_copy_default ?? true,
      paste: s.realtime_paste_default ?? false,
      notify: s.default_behavior?.notify ?? false,
    };
  }
  return s.default_behavior || { copy: true, paste: false, notify: false };
}

async function saveBehaviorToggles() {
  if (!editingModeId) return;
  const s = await tauri.invoke("get_settings");
  s.modes = s.modes || {};
  s.modes[editingModeId] = {
    copy: $("me-copy").checked,
    paste: $("me-paste").checked,
    notify: $("me-notify").checked,
  };
  await tauri.invoke("update_settings", { newSettings: s });
  settings = s;
}

// The currently-selected color in the mode editor. Updated when a swatch
// is clicked (or when the editor opens with an existing mode). Read on
// every save so debounced typing-in-other-fields doesn't drop the color
// from the payload — previously `saveEditingMode` only included `color`
// when the save was triggered by a swatch click, racing with input
// events.
let editingModeColor = null;

function onPickSwatch(p) {
  editingModeColor = p.rgb.slice();
  for (const s of $("me-swatches").children) {
    if (s.dataset.key === p.key) {
      s.style.boxShadow = `0 0 0 2px var(--main-bg), 0 0 0 4px rgb(${p.rgb.join(",")})`;
    } else {
      s.style.boxShadow = "none";
    }
  }
  // Update the preview puck. The CSS class drives `::after` color; the
  // outer puck (`background: var(--text)`) stays ink-coloured. Wipe the
  // class list before adding the new colour class so we don't accumulate.
  const puck = $("me-puck");
  puck.className = "puck-app size-44";
  if (p.key !== "ha-blue") puck.classList.add(p.key.replace("ha-", ""));
  queueModeSave();
}

function queueModeSave() {
  $("mode-saved-state").textContent = "Saving…";
  clearTimeout(modeSaveTimer);
  modeSaveTimer = setTimeout(() => saveEditingMode().catch((e) => {
    $("mode-saved-state").textContent = "Error";
    bannerErr(e?.message ?? String(e));
  }), 250);
}

async function saveEditingMode() {
  if (!editingModeId) return;
  // When the toggle is off, send an empty post_process_prompt — that's
  // the bridge's "skip post-processing" signal. Keep the provider/model
  // round-tripped so re-enabling preserves the user's selection.
  const ppEnabled = $("me-pp-enabled")?.checked;
  // M02b rename: voix.update_voice with voice_id field. Internal JS
  // var `editingModeId` is unchanged for scope (it's not on the wire).
  const data = {
    voice_id: editingModeId,
    name: $("me-name").value.trim(),
    type: $("me-type").value,
    voice: $("me-voice").value,
    model: $("me-model").value.trim(),
    prompt: $("me-prompt").value,
    post_process_prompt: ppEnabled ? $("me-pp-prompt").value : "",
    post_process_provider: $("me-pp-provider")?.value || "openai",
    post_process_model: $("me-pp-model")?.value.trim() || "gpt-4o-mini",
    routing_hint: $("me-routing-hint")?.value.trim() || "",
  };
  if (editingModeColor) data.color = editingModeColor;
  await tauri.invoke("call_ha_service", {
    domain: "voix",
    service: "update_voice",
    data,
  });
  $("mode-saved-state").textContent = "Saved";
  // Refresh the cached mode list (name / colour may have changed).
  refreshModes().catch(() => {});
}

async function createMode() {
  await tauri.invoke("call_ha_service", {
    domain: "voix",
    service: "create_voice",
    data: { name: "Untitled voice", type: "realtime", color: [3, 169, 244] },
  });
  await refreshModes();
  // Pop the editor on the newest voice.
  const newest = modeCache[modeCache.length - 1];
  if (newest) openModeEditor(newest.mode_id);
}

async function deleteEditingMode() {
  if (!editingModeId) return;
  if (!confirm("Delete this voice?")) return;
  await tauri.invoke("call_ha_service", {
    domain: "voix",
    service: "delete_voice",
    data: { voice_id: editingModeId },
  });
  editingModeId = null;
  await refreshModes();
  route("modes");
  renderModes();
}

// ─── Wire conversation streaming into session storage ───────────────────

// Wrap the existing streamUpdate / appendCompleted / onSession to also
// thread updates into the sessions store. We attached them earlier; here
// we re-export thin wrappers via re-assignment.

const _streamUpdate = streamUpdate;
const _onSession = onSession;
const _appendCompleted = appendCompleted;

streamUpdate = function (payload) {
  recordTurn(payload.session_id, payload.role, payload.text, "realtime");
  if (payload.status === "complete") markTurnComplete(payload.session_id, payload.role);
  _streamUpdate(payload);
};
onSession = function (payload) {
  if (payload.kind === "started") recordSessionStart(payload.session_id, payload.device_id);
  if (payload.kind === "ended") recordSessionEnd(payload.session_id);
  _onSession(payload);
};
appendCompleted = function (payload) {
  // Dictation captures get a single-turn session each.
  const sid = payload.session_id || `dict-${Date.now()}`;
  recordSessionStart(sid, payload.device_id);
  recordTurn(sid, "user", payload.text, "dictation");
  markTurnComplete(sid, "user");
  recordSessionEnd(sid);
  _appendCompleted(payload);
};

// Initial paint of the sidebar with any persisted sessions.
renderSidebarSessions();

init().catch((e) => bannerErr(e?.message ?? String(e)));
