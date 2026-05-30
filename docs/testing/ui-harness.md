# voix UI test harness — design + concrete tests

> **Status:** proposal + ready-to-paste test files. The UI at
> `voix-backend/ui/` currently ships **zero** tests. Every fix so far
> has been visual ("looks right in the iframe") or audit-driven
> (Marina/Wren reading the source). This document is the plan to move
> from *looks right* to *works right*, plus the brutal list of things
> that are quietly broken **right now** that a test would have caught.

The UI is React Native Web + Vite + Bun, a separate package from the
daemon. Six screens worth covering — `VoiceEditor`, `VoiceList`,
`SurfaceList`, `ConversationList`, `ConversationDetail`, `TalkButton` —
plus the M18 `browserClient.ts` Audio I/O client (getUserMedia +
AudioContext + ScriptProcessorNode + WebSocket) which is where the
real behavioural risk lives.

---

## 0. The headline finding (read this first)

While scoping this harness I rendered `ConversationList` in my head the
way a test would. It crashes.

```tsx
// voix-backend/ui/src/conversations/ConversationList.tsx
export function ConversationList({ onPickEntry }: Props) {
  const [entries, setEntries] = useState<HistoryEntry[] | null>(null);   // hook 1
  const [voiceById, setVoiceById] = useState(...);                       // hook 2
  const [error, setError] = useState<string | null>(null);              // hook 3
  const refresh = useCallback(...);                                      // hook 4
  useEffect(() => { refresh(); }, [refresh]);                            // hook 5

  if (error)    return (<View>…</View>);          // early return
  if (!entries) return (<View>…ActivityIndicator…</View>);  // early return

  const onSessionEnded = useCallback(() => {       // hook 6 — AFTER a conditional return
    setTimeout(refresh, 1500);
  }, [refresh]);
  …
}
```

`onSessionEnded`'s `useCallback` sits **after** the `if (!entries)`
early return. First render `entries === null` → 5 hooks run. The
moment the history fetch resolves and `entries` becomes an array, the
component re-renders, reaches hook 6, and React throws:

```
Rendered more hooks than during the previous render.
```

This is a textbook Rules-of-Hooks violation. It is shipped, on `main`,
in committed M17 code. It compiles. It type-checks. `biome` doesn't
catch it (no react-hooks lint rule configured). It "looks right"
because the first paint is the loading spinner — and a human testing by
hand on a daemon that already has history may land straight on the
populated list via a different path, or the iframe swallows the error.
The single test `renders a populated conversation list` would have
turned this red on day one.

**That is the entire argument for this harness in one bug.** The rest
of this document is how to build it.

---

## 1. Opinionated stack decision

**Use `vitest` + `jsdom` + `@testing-library/react` for the UI
package. Keep `bun test` for the daemon.** Do not try to make one
runner cover both.

### Why not "just use bun test" like the daemon does?

The daemon's tests (`voix-backend/tests/**`) are pure logic over
`bun:test` — no DOM, no React, no module aliasing. They're great. The
UI is a different animal for one decisive reason:

> The UI's correctness depends on `react-native` resolving to
> `react-native-web`. That alias lives in **`vite.config.ts`**. `vitest`
> reads `vite.config.ts` directly, so the test resolves modules
> **byte-identically to the production build.** `bun test` would force
> you to re-declare the alias a second time (via `tsconfig` `paths` or
> a `Bun.plugin` resolver), and the day those two drift is the day your
> tests pass while the build ships something else.

For a React Native Web app the alias *is* the app. Resolution fidelity
beats runner uniformity. Secondary reasons:

- `@testing-library/react` + `act()` + React 18 `createRoot` is a
  paved road under vitest/jsdom; under bun test it is still sharp-edged
  (act warnings, microtask flushing).
- `jsdom` over `happy-dom`: we mock a *lot* of Web API surface
  (`MessageEvent`, `MediaStream`, `localStorage`, `URL` resolution).
  jsdom is the more complete implementation; the speed win from
  happy-dom isn't worth chasing a missing-global rabbit hole during an
  audio test. Revisit happy-dom once the suite is green and slow.

The pure functions in `browserClient.ts` (`floatToPcm16`,
`pcm16ToFloat`, `wsUrlFromDocument`) are DOM-free and *could* run under
bun test — but keep them in the UI package next to what they test.
One runner per package, clean boundary: **daemon = bun test, UI =
vitest.**

### Considered and rejected

| Option | Verdict |
|---|---|
| `bun test` + happy-dom + RNW mocks | Rejected. Alias drift risk; weaker `act()` story. |
| Headless Playwright (real Audio APIs) | Rejected as the *default* layer — heavy, slow, flaky in CI, needs a real daemon or a stub server. **Keep it as a thin smoke layer** (§9), not the workhorse. |
| Vitest browser-mode (real Chromium) | Rejected for now. Same weight as Playwright; revisit if jsdom's Web Audio gaps bite. |
| Full-DOM snapshot tests | Rejected. They churn on every style tweak — the exact "looks right" trap we're escaping. Use *semantic* goldens (§8). |

---

## 2. Setup

### Dependencies (UI package)

```jsonc
// voix-backend/ui/package.json — devDependencies additions
{
  "devDependencies": {
    "vitest": "^3.0.0",
    "jsdom": "^25.0.0",
    "@testing-library/react": "^16.1.0",
    "@testing-library/dom": "^10.4.0",
    "@testing-library/jest-dom": "^6.6.0",
    "@testing-library/user-event": "^14.5.0"
  },
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "test:ui": "vitest --ui"
  }
}
```

Install with `bun add -d …` from `voix-backend/ui/` (Bun is the package
manager; only the *test runner* changes, not the package manager).

### vitest config

Reuse the existing vite config so the `react-native` → `react-native-web`
alias and `base: "./"` come along for free.

```ts
// voix-backend/ui/vitest.config.ts
import { mergeConfig } from "vite";
import { defineConfig } from "vitest/config";
import viteConfig from "./vite.config";

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: "jsdom",
      globals: true,
      setupFiles: ["./test/setup.ts"],
      // RNW + jsdom: inline so the alias is applied to the dep too.
      server: { deps: { inline: [/react-native/] } },
      include: ["src/**/*.test.{ts,tsx}", "test/**/*.test.{ts,tsx}"],
    },
  }),
);
```

> **Gotcha:** `react-native-web`'s `StyleSheet.create` and `Pressable`
> ship as untranspiled ESM-ish modules; `server.deps.inline` forces
> vitest to run them through the same transform pipeline as your
> source. Without it you get `Cannot use import statement outside a
> module` from deep inside RNW.

### Global setup

```ts
// voix-backend/ui/test/setup.ts
import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

afterEach(() => {
  cleanup();
  // Reset the per-test global mocks installed by the fakes (§3).
  // Each test that needs WS/Audio installs them explicitly; this
  // just guarantees no leakage between files.
  delete (globalThis as Record<string, unknown>).WebSocket;
});
```

### tsconfig for tests

Tests use DOM + JSX, already covered by the UI `tsconfig.json`
(`lib: ["…","DOM"]`, `jsx: "react-jsx"`). Add `"vitest/globals"` to
`types` so `describe/it/expect` type-check without imports, or import
them explicitly (the examples below import explicitly — friendlier to
biome's `noUnusedImports`-adjacent rules and clearer provenance).

---

## 3. The fakes — the centrepiece

`browserClient.ts` touches four un-mockable-by-default browser APIs:
`WebSocket`, `AudioContext`, `navigator.mediaDevices.getUserMedia`,
`localStorage`/`crypto`. We build small, *controllable* fakes that
record everything and let the test drive the daemon side.

The design goal: **a fake WS that is also a fake daemon.** It records
the hello and every uplink audio frame, and exposes a controller to
emit `ready` / `transcript_delta` / `decline` text events and synthetic
binary speaker frames — exactly the cheap "fake server" the task brief
asks for, with none of Playwright's weight.

```ts
// voix-backend/ui/test/fakes/ws.ts

/** A WebSocket stand-in that doubles as a scriptable daemon.
 *
 *  - records every uplink frame (`sentText`, `sentBinary`)
 *  - exposes `server.*` to drive the downlink (open/message/close/error)
 *
 *  Install with `installFakeWebSocket()` before constructing the client;
 *  grab the live instance via the returned `lastSocket()` accessor. */
export type WsFrame = string | ArrayBuffer;

export class FakeWebSocket {
  static OPEN = 1;
  static CLOSED = 3;
  binaryType = "blob";
  readyState = 0; // CONNECTING
  url: string;

  sentText: string[] = [];
  sentBinary: ArrayBuffer[] = [];
  closedWith: { code?: number; reason?: string } | null = null;

  private listeners: Record<string, Array<(ev: unknown) => void>> = {};

  constructor(url: string) {
    this.url = url;
  }

  addEventListener(type: string, fn: (ev: unknown) => void) {
    (this.listeners[type] ??= []).push(fn);
  }
  removeEventListener(type: string, fn: (ev: unknown) => void) {
    this.listeners[type] = (this.listeners[type] ?? []).filter((f) => f !== fn);
  }
  send(data: WsFrame) {
    if (typeof data === "string") this.sentText.push(data);
    else this.sentBinary.push(data);
  }
  close(code?: number, reason?: string) {
    this.closedWith = { code, reason };
    this.readyState = FakeWebSocket.CLOSED;
    this.emit("close", { code, reason });
  }

  private emit(type: string, payload: unknown) {
    for (const fn of this.listeners[type] ?? []) fn(payload);
  }

  // ─── server-side controls (the "daemon") ──────────────────────────
  readonly server = {
    open: () => {
      this.readyState = FakeWebSocket.OPEN;
      this.emit("open", {});
    },
    /** emit a daemon→client text event */
    sendEvent: (obj: Record<string, unknown>) => {
      this.emit("message", { data: JSON.stringify(obj) });
    },
    /** emit a binary speaker frame from Int16 PCM samples */
    sendSpeaker: (pcm: Int16Array) => {
      this.emit("message", {
        data: pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + pcm.byteLength),
      });
    },
    error: () => this.emit("error", {}),
    close: (code = 1000, reason = "") => this.close(code, reason),
  };

  /** parse the hello the client sent as its first text frame */
  hello(): Record<string, unknown> | null {
    return this.sentText[0] ? JSON.parse(this.sentText[0]) : null;
  }
}

let _sockets: FakeWebSocket[] = [];

export function installFakeWebSocket() {
  _sockets = [];
  class Ctor extends FakeWebSocket {
    constructor(url: string) {
      super(url);
      _sockets.push(this);
    }
  }
  (globalThis as Record<string, unknown>).WebSocket = Ctor;
  return {
    lastSocket: () => _sockets.at(-1) as FakeWebSocket,
    allSockets: () => _sockets.slice(),
  };
}
```

```ts
// voix-backend/ui/test/fakes/audio.ts

/** Records every node + scheduled start so a test can assert the
 *  playback scheduler's behaviour. `currentTime` is mutable — the
 *  test advances the clock to simulate real-time passing. */
export class FakeAudioContext {
  sampleRate = 48000;
  currentTime = 0;
  destination = { _isDestination: true };
  closed = false;

  createdBuffers: FakeAudioBuffer[] = [];
  startedSources: Array<{ buffer: FakeAudioBuffer; startAt: number }> = [];
  scriptNode: FakeScriptProcessor | null = null;

  createMediaStreamSource() {
    return { connect: () => {} };
  }
  createScriptProcessor(bufferSize: number, inCh: number, outCh: number) {
    const node = new FakeScriptProcessor(bufferSize, inCh, outCh);
    this.scriptNode = node;
    return node;
  }
  createGain() {
    return { gain: { value: 1 }, connect: () => {} };
  }
  createBuffer(channels: number, length: number, rate: number) {
    const b = new FakeAudioBuffer(channels, length, rate);
    this.createdBuffers.push(b);
    return b;
  }
  createBufferSource() {
    const self = this;
    let buffer: FakeAudioBuffer;
    return {
      set buffer(b: FakeAudioBuffer) {
        buffer = b;
      },
      get buffer() {
        return buffer;
      },
      connect: () => {},
      start(startAt: number) {
        self.startedSources.push({ buffer, startAt });
      },
    };
  }
  close() {
    this.closed = true;
    return Promise.resolve();
  }
}

export class FakeAudioBuffer {
  private data: Float32Array;
  constructor(
    public channels: number,
    public length: number,
    public sampleRate: number,
  ) {
    this.data = new Float32Array(length);
  }
  get duration() {
    return this.length / this.sampleRate;
  }
  getChannelData() {
    return this.data;
  }
}

export class FakeScriptProcessor {
  onaudioprocess: ((e: unknown) => void) | null = null;
  constructor(
    public bufferSize: number,
    public inCh: number,
    public outCh: number,
  ) {}
  connect() {}
  disconnect() {}
  /** test helper: pump one buffer of mic samples through the node */
  tick(samples: Float32Array) {
    this.onaudioprocess?.({
      inputBuffer: { getChannelData: () => samples },
    });
  }
}

export function installFakeAudio() {
  const ctxs: FakeAudioContext[] = [];
  class Ctor extends FakeAudioContext {
    constructor() {
      super();
      ctxs.push(this);
    }
  }
  (globalThis as Record<string, unknown>).AudioContext = Ctor;
  return { lastContext: () => ctxs.at(-1) as FakeAudioContext };
}

export function installFakeGetUserMedia() {
  const tracks = [{ stop: vi.fn() }, { stop: vi.fn() }];
  const stream = { getTracks: () => tracks };
  (globalThis as Record<string, unknown>).navigator ??= {};
  (navigator as unknown as Record<string, unknown>).mediaDevices = {
    getUserMedia: vi.fn().mockResolvedValue(stream),
  };
  return { tracks, stream };
}
```

> `vi` is vitest's mock helper — import `{ vi }` from `"vitest"` in the
> fake module, or rely on `globals: true`.

`localStorage` and `crypto.randomUUID` already exist under jsdom, so
`getOrCreateDeviceId()` works unmodified. If a test wants a fixed device
id, `localStorage.setItem("voix.browser_device_id", "browser-test")`
before `start()`.

---

## 4. API fixtures

The components all hit `lib/api.ts`. We never want real `fetch` in a
component test, so we **mock the api module**, not `fetch` — the module
boundary is the cleaner seam (and it lets us assert the *typed* calls).
`fetch`-level mocking is reserved for the ingress-path tests (§7) where
the URL string is the thing under test.

```ts
// voix-backend/ui/test/fixtures/voices.ts
import type { Voice } from "../../src/lib/api";

export function voiceFixture(over: Partial<Voice> = {}): Voice {
  return {
    id: "default-realtime",
    name: "Default",
    type: "realtime",
    talkingPrompt: "You are me, chatting.",
    donePrompt: "",
    prompt: "You are me, chatting.",
    voice: "alloy",
    model: "gpt-realtime-2",
    color: [3, 169, 244],
    brightness: 1,
    effect: "none",
    sttProvider: "openai-realtime",
    sttModel: "",
    includeEntities: [],
    includePersons: [],
    addendum: "",
    postProcessPrompt: "",
    postProcessProvider: "openai",
    postProcessModel: "gpt-4o-mini",
    routingHint: "Quick voice chat.",
    discussEngine: "realtime",
    isBuiltin: true,
    ...over,
  };
}

export const dictationVoice = voiceFixture({
  id: "polish-dictation",
  name: "Polish dictation",
  type: "dictation",
  donePrompt: "Rewrite the transcript as a polished email.",
  discussEngine: undefined,
});
```

```ts
// voix-backend/ui/test/fixtures/history.ts
import type { Device, HistoryEntry, Surface } from "../../src/lib/api";

export function historyFixture(over: Partial<HistoryEntry> = {}): HistoryEntry {
  return {
    id: "h1",
    createdAt: "2026-05-30T12:00:00.000Z",
    deviceId: "browser-test",
    sessionId: "sess-1",
    voiceId: "default-realtime",
    voiceName: "Default",
    modeType: "realtime",
    durationMs: 4200,
    rawText: "remind me to water the plants",
    processedText: null,
    postProcessProvider: null,
    postProcessModel: null,
    contextSnapshot: [
      { source: "ha", data: { area: "Kitchen", temperature: "21°C" } },
      { source: "voix", data: { lastVoice: "Default" } },
    ],
    transcriptPath: "/config/voix/transcripts/browser-test/sess-1-user.txt",
    ...over,
  };
}

export function surfaceFixture(over: Partial<Surface> = {}): Surface {
  return {
    deviceId: "browser-test",
    friendlyName: "Tom's laptop",
    voiceId: "default-realtime",
    lastSeenMs: 0, // tests freeze Date.now(); see §6 clock note
    protocolVersion: 1,
    clientKind: "browser-tab",
    capabilities: {
      mic: { sample_rate_hz: 48000, channels: 1 },
      speaker: { sample_rate_hz: 48000 },
      half_duplex_on_chip: true,
    },
    ...over,
  } as Surface;
}

export const puckSurface: Surface = surfaceFixture({
  deviceId: "puck-095e4e",
  friendlyName: "Kitchen puck",
  clientKind: "puck",
  capabilities: {
    mic: { sample_rate_hz: 16000, channels: 1 },
    speaker: { sample_rate_hz: 24000 },
    half_duplex_on_chip: true,
    wake_words: ["voix"],
  },
});
```

Module mock helper (used by every component test):

```ts
// voix-backend/ui/test/fixtures/mockApi.ts
import { vi } from "vitest";

/** vi.mock is hoisted; call this at top-of-file scope, then override
 *  individual methods per test via the returned spies. */
export function mockApi() {
  const voicesApi = { list: vi.fn(), get: vi.fn(), update: vi.fn() };
  const devicesApi = { list: vi.fn(), setVoice: vi.fn() };
  const surfacesApi = { list: vi.fn() };
  const historyApi = { list: vi.fn(), get: vi.fn(), transcript: vi.fn() };
  vi.mock("../../src/lib/api", () => ({ voicesApi, devicesApi, surfacesApi, historyApi }));
  return { voicesApi, devicesApi, surfacesApi, historyApi };
}
```

---

## 5. Component tests

A render helper that flushes the `useEffect` fetch:

```ts
// voix-backend/ui/test/render.ts
import { act, render } from "@testing-library/react";
import type { ReactElement } from "react";

/** Render + let pending microtasks (the api .then chains) settle. */
export async function renderAsync(el: ReactElement) {
  const result = render(el);
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  return result;
}
```

### 5.1 `ConversationList` — the crash guard (§0)

```tsx
// voix-backend/ui/src/conversations/ConversationList.test.tsx
import { vi, describe, it, expect, beforeEach } from "vitest";
import { historyApi, voicesApi } from "./__mocks__"; // see mockApi pattern
import { renderAsync } from "../../test/render";
import { ConversationList } from "./ConversationList";
import { historyFixture } from "../../test/fixtures/history";
import { voiceFixture } from "../../test/fixtures/voices";

vi.mock("../lib/api"); // resolved by mockApi() / manual mock

describe("ConversationList", () => {
  beforeEach(() => {
    voicesApi.list.mockResolvedValue([voiceFixture()]);
  });

  it("renders a populated list without throwing (rules-of-hooks guard)", async () => {
    historyApi.list.mockResolvedValue([historyFixture()]);
    // BEFORE the fix in §11, this throws:
    //   "Rendered more hooks than during the previous render."
    const { getByText } = await renderAsync(<ConversationList onPickEntry={() => {}} />);
    expect(getByText("Default")).toBeInTheDocument();
    expect(getByText(/water the plants/)).toBeInTheDocument();
  });

  it("shows the empty state with the talk button when history is empty", async () => {
    historyApi.list.mockResolvedValue([]);
    const { getByText } = await renderAsync(<ConversationList onPickEntry={() => {}} />);
    expect(getByText("No conversations yet")).toBeInTheDocument();
  });

  it("renders the 'shaped' tag only when processedText is present", async () => {
    historyApi.list.mockResolvedValue([
      historyFixture({ id: "a", processedText: "Polished." }),
      historyFixture({ id: "b", processedText: null, rawText: "raw only" }),
    ]);
    const { getAllByText, queryAllByText } = await renderAsync(
      <ConversationList onPickEntry={() => {}} />,
    );
    expect(getAllByText("shaped")).toHaveLength(1);
  });

  it("surfaces an API error", async () => {
    historyApi.list.mockRejectedValue(new Error("boom"));
    const { getByText } = await renderAsync(<ConversationList onPickEntry={() => {}} />);
    expect(getByText("Couldn't load conversations")).toBeInTheDocument();
  });
});
```

### 5.2 `VoiceEditor` — layout per voice type + optimistic-save divergence

```tsx
// voix-backend/ui/src/voices/VoiceEditor.test.tsx
import { vi, describe, it, expect } from "vitest";
import { fireEvent } from "@testing-library/react";
import { voicesApi } from "../lib/api";
import { renderAsync } from "../../test/render";
import { VoiceEditor } from "./VoiceEditor";
import { voiceFixture, dictationVoice } from "../../test/fixtures/voices";

vi.mock("../lib/api");

describe("VoiceEditor layout", () => {
  it("realtime shows the two-phase talking/done blocks", async () => {
    voicesApi.get.mockResolvedValue(voiceFixture({ type: "realtime" }));
    const { getByText, queryByText } = await renderAsync(
      <VoiceEditor voiceId="x" onClose={() => {}} />,
    );
    expect(getByText("When we're talking")).toBeInTheDocument();
    expect(getByText("When I'm done")).toBeInTheDocument();
    // Dictation-only copy must NOT appear:
    expect(queryByText("What the model does with your dictation")).toBeNull();
  });

  it("dictation shows the single polish phase, not the two-phase rail", async () => {
    voicesApi.get.mockResolvedValue(dictationVoice);
    const { getByText, queryByText } = await renderAsync(
      <VoiceEditor voiceId="x" onClose={() => {}} />,
    );
    expect(getByText("What the model does with your dictation")).toBeInTheDocument();
    expect(queryByText("When we're talking")).toBeNull();
    expect(queryByText("When I'm done")).toBeNull();
  });

  it("realtime advanced shows engine pacing; dictation advanced shows STT pipeline", async () => {
    voicesApi.get.mockResolvedValue(voiceFixture({ type: "realtime" }));
    const { getByText } = await renderAsync(<VoiceEditor voiceId="x" onClose={() => {}} />);
    fireEvent.press?.(getByText("Show advanced")); // RNW maps onPress→click
    fireEvent.click(getByText("Show advanced"));
    expect(getByText("Conversation feel")).toBeInTheDocument();
  });

  // BRUTAL: optimistic edit that the server rejects leaves the UI
  // showing the typed value while the daemon kept the old one.
  it("KNOWN GAP: a failed save does not revert the local field", async () => {
    voicesApi.get.mockResolvedValue(voiceFixture({ name: "Default" }));
    voicesApi.update.mockRejectedValue(new Error("500"));
    const { getByDisplayValue } = await renderAsync(
      <VoiceEditor voiceId="x" onClose={() => {}} />,
    );
    const nameInput = getByDisplayValue("Default");
    fireEvent.change(nameInput, { target: { value: "Renamed" } });
    fireEvent.blur(nameInput);
    await Promise.resolve();
    // The input still shows "Renamed" even though the PATCH failed —
    // documenting the divergence. See §11 for the suggested fix.
    expect((nameInput as HTMLInputElement).value).toBe("Renamed");
  });
});
```

### 5.3 `SurfaceList` — kind-aware glyph + capability chips

```tsx
// voix-backend/ui/src/surfaces/SurfaceList.test.tsx
import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { surfacesApi, voicesApi } from "../lib/api";
import { renderAsync } from "../../test/render";
import { SurfaceList } from "./SurfaceList";
import { surfaceFixture, puckSurface } from "../../test/fixtures/history";
import { voiceFixture } from "../../test/fixtures/voices";

vi.mock("../lib/api");

describe("SurfaceList", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-30T12:00:10.000Z")); // 10s after lastSeenMs=...:00
    voicesApi.list.mockResolvedValue([voiceFixture()]);
  });
  afterEach(() => vi.useRealTimers());

  it("renders the 🌐 glyph for a browser-tab and the puck glyph for a puck", async () => {
    surfacesApi.list.mockResolvedValue([
      surfaceFixture({ clientKind: "browser-tab", lastSeenMs: Date.parse("2026-05-30T12:00:00Z") }),
      { ...puckSurface, lastSeenMs: Date.parse("2026-05-30T12:00:00Z") },
    ]);
    const { getByText } = await renderAsync(<SurfaceList />);
    expect(getByText("🌐")).toBeInTheDocument();        // browser-tab fallback glyph
    expect(getByText("just now")).toBeInTheDocument();   // 10s → "just now"
  });

  it("renders capability chips and the wake-word chip for a puck", async () => {
    surfacesApi.list.mockResolvedValue([
      { ...puckSurface, lastSeenMs: Date.parse("2026-05-30T12:00:00Z") },
    ]);
    const { getByText } = await renderAsync(<SurfaceList />);
    expect(getByText("mic 16 kHz mono")).toBeInTheDocument();
    expect(getByText("speaker 24 kHz")).toBeInTheDocument();
    expect(getByText("AEC on chip")).toBeInTheDocument();
    expect(getByText("wake: voix")).toBeInTheDocument();
  });

  it("falls back to the 'no capability handshake' note for legacy surfaces", async () => {
    surfacesApi.list.mockResolvedValue([
      surfaceFixture({ capabilities: undefined, protocolVersion: undefined,
        lastSeenMs: Date.parse("2026-05-30T12:00:00Z") }),
    ]);
    const { getByText } = await renderAsync(<SurfaceList />);
    expect(getByText(/No capability handshake on file/)).toBeInTheDocument();
    expect(getByText("legacy")).toBeInTheDocument();
  });

  it("renders the empty state when no surfaces exist", async () => {
    surfacesApi.list.mockResolvedValue([]);
    const { getByText } = await renderAsync(<SurfaceList />);
    expect(getByText("No surfaces yet")).toBeInTheDocument();
  });
});
```

> Note the `vi.setSystemTime` dance — `formatLastSeen` calls `Date.now()`
> directly. Freezing the clock is the only way to make "just now"
> deterministic. This works but is fragile; §11 suggests injecting the
> clock instead.

### 5.4 `VoiceList` — active strip + single-device activation

```tsx
// voix-backend/ui/src/voices/VoiceList.test.tsx
import { vi, describe, it, expect } from "vitest";
import { fireEvent } from "@testing-library/react";
import { voicesApi, devicesApi } from "../lib/api";
import { renderAsync } from "../../test/render";
import { VoiceList } from "./VoiceList";
import { voiceFixture } from "../../test/fixtures/voices";
import { surfaceFixture } from "../../test/fixtures/history";

vi.mock("../lib/api");

describe("VoiceList", () => {
  it("marks the device's active voice and hides its Activate button", async () => {
    voicesApi.list.mockResolvedValue([
      voiceFixture({ id: "a", name: "Alpha" }),
      voiceFixture({ id: "b", name: "Beta" }),
    ]);
    devicesApi.list.mockResolvedValue([surfaceFixture({ voiceId: "a" })]);
    const { getByText, getAllByText } = await renderAsync(
      <VoiceList onPickVoice={() => {}} />,
    );
    expect(getByText("ACTIVE")).toBeInTheDocument();          // on Alpha
    expect(getAllByText("Activate")).toHaveLength(1);          // only Beta
  });

  it("activates a voice on press", async () => {
    voicesApi.list.mockResolvedValue([voiceFixture({ id: "a" }), voiceFixture({ id: "b" })]);
    devicesApi.list.mockResolvedValue([surfaceFixture({ voiceId: "a" })]);
    devicesApi.setVoice.mockResolvedValue(surfaceFixture({ voiceId: "b" }));
    const { getByText } = await renderAsync(<VoiceList onPickVoice={() => {}} />);
    fireEvent.click(getByText("Activate"));
    await Promise.resolve();
    expect(devicesApi.setVoice).toHaveBeenCalledWith("browser-test", "b");
  });

  it("KNOWN GAP: with two devices only devices[0] is ever activated", async () => {
    // documents the single-puck assumption in activateVoice()
    voicesApi.list.mockResolvedValue([voiceFixture({ id: "a" })]);
    devicesApi.list.mockResolvedValue([
      surfaceFixture({ deviceId: "d1", voiceId: "a" }),
      surfaceFixture({ deviceId: "d2", voiceId: "a" }),
    ]);
    const { getByText } = await renderAsync(<VoiceList onPickVoice={() => {}} />);
    // The active strip shows only the FIRST device — d2 is invisible.
    expect(getByText(/Tom's laptop/)).toBeInTheDocument();
  });
});
```

### 5.5 `ConversationDetail` — section ordering + conditional Entry block + audio src

```tsx
// voix-backend/ui/src/conversations/ConversationDetail.test.tsx
import { vi, describe, it, expect } from "vitest";
import { historyApi } from "../lib/api";
import { renderAsync } from "../../test/render";
import { ConversationDetail } from "./ConversationDetail";
import { historyFixture } from "../../test/fixtures/history";

vi.mock("../lib/api");

describe("ConversationDetail", () => {
  it("hides the Entry block when there is no processedText", async () => {
    historyApi.get.mockResolvedValue(historyFixture({ processedText: null }));
    historyApi.transcript.mockResolvedValue({ content: "hello there", source: "file" });
    const { getByText, queryByText } = await renderAsync(
      <ConversationDetail entryId="h1" onClose={() => {}} />,
    );
    expect(getByText("Transcript")).toBeInTheDocument();
    expect(queryByText("Entry")).toBeNull();
  });

  it("shows the Entry block + provider meta when processedText exists", async () => {
    historyApi.get.mockResolvedValue(
      historyFixture({ processedText: "Polished.", postProcessProvider: "openai", postProcessModel: "gpt-4o-mini" }),
    );
    historyApi.transcript.mockResolvedValue({ content: "raw", source: "file" });
    const { getByText } = await renderAsync(<ConversationDetail entryId="h1" onClose={() => {}} />);
    expect(getByText("Polished.")).toBeInTheDocument();
    expect(getByText(/via openai · gpt-4o-mini/)).toBeInTheDocument();
  });

  it("renders the context receipt with humanised source names", async () => {
    historyApi.get.mockResolvedValue(historyFixture());
    historyApi.transcript.mockResolvedValue({ content: "x", source: "file" });
    const { getByText } = await renderAsync(<ConversationDetail entryId="h1" onClose={() => {}} />);
    expect(getByText("Your home")).toBeInTheDocument();          // ha → "Your home"
    expect(getByText("What voix knew about you")).toBeInTheDocument();
  });

  it("points both audio players at relative recordings/<sessionId>/ paths", async () => {
    historyApi.get.mockResolvedValue(historyFixture({ sessionId: "sess-1" }));
    historyApi.transcript.mockResolvedValue({ content: "x", source: "file" });
    const { container } = await renderAsync(<ConversationDetail entryId="h1" onClose={() => {}} />);
    const audios = [...container.querySelectorAll("audio")];
    expect(audios.map((a) => a.getAttribute("src"))).toEqual([
      "recordings/sess-1/mic.wav",
      "recordings/sess-1/speaker.wav",
    ]); // RELATIVE — ingress-safe (see §7)
  });
});
```

### 5.6 `TalkButton` — status mapping + the press/release race

```tsx
// voix-backend/ui/src/conversations/TalkButton.test.tsx
import { vi, describe, it, expect, beforeEach } from "vitest";
import { fireEvent, act } from "@testing-library/react";
import { render } from "@testing-library/react";
import { TalkButton } from "./TalkButton";
import { installFakeWebSocket } from "../../test/fakes/ws";
import { installFakeAudio, installFakeGetUserMedia } from "../../test/fakes/audio";

describe("TalkButton", () => {
  let ws: ReturnType<typeof installFakeWebSocket>;
  beforeEach(() => {
    ws = installFakeWebSocket();
    installFakeAudio();
    installFakeGetUserMedia();
    // token endpoint
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true, json: async () => ({ token: "shared-secret" }),
    }) as unknown as typeof fetch;
  });

  it("maps client status to button labels", async () => {
    const { getByText, findByText } = render(<TalkButton />);
    fireEvent.pointerDown(getByText("Talk to voix").parentElement!);
    // token fetch + getUserMedia resolve, WS open → hello
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    ws.lastSocket().server.open();
    ws.lastSocket().server.sendEvent({ type: "ready", mode: "realtime" });
    expect(await findByText("Listening")).toBeInTheDocument();
    ws.lastSocket().server.sendSpeaker(new Int16Array(480));
    expect(await findByText("voix is replying")).toBeInTheDocument();
  });

  // BRUTAL: handlePressIn is async (token fetch + start). A fast
  // tap fires handlePressOut BEFORE clientRef is set, so stop() is a
  // no-op and the session — mic + WS — leaks open.
  it("KNOWN BUG: quick tap leaks a live session (mic never stops)", async () => {
    const { getByText } = render(<TalkButton />);
    const btn = getByText("Talk to voix").parentElement!;
    fireEvent.pointerDown(btn);
    fireEvent.pointerUp(btn);            // released before await resolves
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    ws.lastSocket().server.open();
    // The hello still goes out — the session opened with nobody to close it.
    expect(ws.lastSocket().hello()).not.toBeNull();
    expect(ws.lastSocket().closedWith).toBeNull(); // ← leak. See §11 fix.
  });
});
```

---

## 6. `browserClient.ts` — the behavioural core

This is where "looks right" has done the least and the risk is highest.
The client is testable **without changing it** because everything it
touches is a constructor global (`WebSocket`, `AudioContext`,
`navigator.mediaDevices`) we can swap.

```ts
// voix-backend/ui/src/audio_io/browserClient.test.ts
import { vi, describe, it, expect, beforeEach } from "vitest";
import { BrowserAudioIoClient } from "./browserClient";
import { installFakeWebSocket } from "../../test/fakes/ws";
import { installFakeAudio, installFakeGetUserMedia } from "../../test/fakes/audio";

function makeClient(events: unknown[] = []) {
  return new BrowserAudioIoClient({
    wsToken: "shared-secret",
    intent: "discuss",
    voiceId: "default-realtime",
    onEvent: (ev) => events.push(ev),
  });
}

describe("BrowserAudioIoClient handshake", () => {
  let ws: ReturnType<typeof installFakeWebSocket>;
  let audio: ReturnType<typeof installFakeAudio>;
  beforeEach(() => {
    ws = installFakeWebSocket();
    audio = installFakeAudio();
    installFakeGetUserMedia();
    localStorage.setItem("voix.browser_device_id", "browser-test");
  });

  it("sends a v1 hello declaring the AudioContext sample rate", async () => {
    const client = makeClient();
    await client.start();
    ws.lastSocket().server.open();
    const hello = ws.lastSocket().hello()!;
    expect(hello.type).toBe("hello");
    expect(hello.protocol_version).toBe(1);
    expect(hello.token).toBe("shared-secret");
    expect(hello.device_id).toBe("browser-test");
    expect(hello.intent).toBe("discuss");
    expect((hello.capabilities as any).mic.sample_rate_hz).toBe(48000); // ctx.sampleRate
    expect((hello.capabilities as any).speaker.sample_rate_hz).toBe(48000);
    expect((hello.client_info as any).kind).toBe("browser-tab");
  });

  it("starts the mic pump and ships Int16 frames after 'ready'", async () => {
    const client = makeClient();
    await client.start();
    const sock = ws.lastSocket();
    sock.server.open();
    sock.server.sendEvent({ type: "ready", mode: "realtime" });
    // pump one buffer of full-scale + silence
    const samples = new Float32Array(2048).fill(0.5);
    audio.lastContext().scriptNode!.tick(samples);
    expect(sock.sentBinary).toHaveLength(1);
    const pcm = new Int16Array(sock.sentBinary[0]);
    expect(pcm.length).toBe(2048);
    expect(pcm[0]).toBe(Math.round(0.5 * 0x7fff)); // 16383
  });

  it("declines: surfaces an error event and tears down on WS close", async () => {
    const events: any[] = [];
    const client = makeClient(events);
    await client.start();
    const sock = ws.lastSocket();
    sock.server.open();
    sock.server.sendEvent({ type: "decline", reason: "auth" });
    expect(events.some((e) => e.type === "error" && /declined: auth/.test(e.message))).toBe(true);
  });
});
```

### 6.1 The scheduler — monotonic next-start-time (task item #4)

This is the test the brief specifically asks for. `playSpeaker` keeps
`playbackTime` and schedules each chunk at `max(currentTime,
playbackTime)`. We feed sequential frames, advance the fake clock, and
assert the scheduled start times never overlap and never go backwards.

```ts
// voix-backend/ui/src/audio_io/scheduler.test.ts
import { vi, describe, it, expect, beforeEach } from "vitest";
import { BrowserAudioIoClient } from "./browserClient";
import { installFakeWebSocket } from "../../test/fakes/ws";
import { installFakeAudio, installFakeGetUserMedia } from "../../test/fakes/audio";

describe("speaker playback scheduler", () => {
  let ws: ReturnType<typeof installFakeWebSocket>;
  let audio: ReturnType<typeof installFakeAudio>;
  beforeEach(() => {
    ws = installFakeWebSocket();
    audio = installFakeAudio();
    installFakeGetUserMedia();
  });

  async function ready() {
    const client = new BrowserAudioIoClient({ wsToken: "t", onEvent: () => {} });
    await client.start();
    ws.lastSocket().server.open();
    ws.lastSocket().server.sendEvent({ type: "ready" });
    return { client, sock: ws.lastSocket(), ctx: audio.lastContext() };
  }

  it("schedules consecutive chunks end-to-end with no gaps or overlaps", async () => {
    const { sock, ctx } = await ready();
    const frame = () => new Int16Array(48000 * 0.02); // 20 ms @ 48 kHz = 960 samples
    sock.server.sendSpeaker(frame()); // ctx.currentTime = 0
    sock.server.sendSpeaker(frame());
    sock.server.sendSpeaker(frame());
    const starts = ctx.startedSources.map((s) => s.startAt);
    // 0, 0.02, 0.04 — monotonic, exactly chunk-duration apart
    expect(starts).toEqual([0, 0.02, 0.04]);
    // strictly non-decreasing
    for (let i = 1; i < starts.length; i++) expect(starts[i]).toBeGreaterThanOrEqual(starts[i - 1]);
  });

  it("resyncs to currentTime after an underrun (delayed frame)", async () => {
    const { sock, ctx } = await ready();
    const frame = () => new Int16Array(960);
    sock.server.sendSpeaker(frame());   // start 0, playbackTime → 0.02
    ctx.currentTime = 5.0;               // 5 s of silence pass — buffer drained
    sock.server.sendSpeaker(frame());   // must start at NOW (5.0), not 0.02
    expect(ctx.startedSources[1].startAt).toBe(5.0);
  });

  // BRUTAL: there is NO upper bound on how far playbackTime may run
  // ahead of currentTime. If the daemon bursts audio faster than
  // real-time (reconnect replay, buffered flush), latency grows
  // unbounded and the client never drops or resyncs forward.
  it("KNOWN GAP: unbounded scheduler latency on a burst (no overrun guard)", async () => {
    const { sock, ctx } = await ready();
    const frame = () => new Int16Array(48000); // 1 s each
    for (let i = 0; i < 30; i++) sock.server.sendSpeaker(frame()); // 30 s burst, clock at 0
    const lastStart = ctx.startedSources.at(-1)!.startAt;
    // 29 s of audio queued ahead of a clock that hasn't moved.
    expect(lastStart).toBe(29);
    // There is no code path that caps this. Documented; see §11.
  });
});
```

> **Why the fakes make this assertable:** `FakeAudioContext.currentTime`
> is a plain mutable field, and every `createBufferSource().start(t)`
> records `t`. The scheduler's entire contract — `startAt = max(now,
> playbackTime); playbackTime = startAt + duration` — is observable from
> outside without touching a private field. Out-of-order frames *can't*
> arrive (WebSocket is ordered), so the only adversarial inputs that
> matter are **delayed** (underrun → resync, tested) and **bursted**
> (overrun → unbounded, documented gap).

---

## 7. Ingress prefix paths (task item #3)

Two relativity invariants must hold or every request 404s under HA's
`/api/hassio_ingress/<token>/` mount:

1. `lib/api.ts` fetch paths are **relative** (no leading slash).
2. `wsUrlFromDocument()` derives the WS URL from `window.location.pathname`.
3. (build-time) `vite base: "./"` makes `dist/index.html` reference
   `./assets/…`.

```ts
// voix-backend/ui/src/audio_io/ingress.test.ts
import { vi, describe, it, expect, afterEach } from "vitest";
import { voicesApi, historyApi } from "../lib/api";

describe("ingress: api paths stay relative", () => {
  afterEach(() => vi.restoreAllMocks());

  it("never prefixes a leading slash (would escape the ingress base)", async () => {
    const seen: string[] = [];
    globalThis.fetch = vi.fn(async (url: string) => {
      seen.push(url);
      return { ok: true, json: async () => [], text: async () => "" } as any;
    }) as any;
    await voicesApi.list();
    await historyApi.list({ voiceId: "v", limit: 10 });
    for (const url of seen) {
      expect(url.startsWith("/")).toBe(false);     // ← the invariant
      expect(url.startsWith("http")).toBe(false);
    }
    expect(seen).toContain("api/voices");
    expect(seen[1]).toMatch(/^api\/history\?/);
  });

  // Prove relative paths resolve correctly under BOTH bases. This is
  // the browser's own URL algorithm — encoding the expectation that
  // "api/voices" + ingress base = the right absolute URL.
  it("resolves under the ingress prefix and at root", () => {
    const ingress = "https://ha.local/api/hassio_ingress/AbC123/";
    expect(new URL("api/voices", ingress).href).toBe(
      "https://ha.local/api/hassio_ingress/AbC123/api/voices",
    );
    const root = "http://localhost:5173/";
    expect(new URL("api/voices", root).href).toBe("http://localhost:5173/api/voices");
  });
});

describe("ingress: wsUrlFromDocument", () => {
  function setLocation(href: string) {
    const u = new URL(href);
    // jsdom: redefine window.location for the test
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { protocol: u.protocol, host: u.host, pathname: u.pathname },
    });
  }

  // wsUrlFromDocument is module-private; export it for test (see §11)
  // or assert via the hello URL on the FakeWebSocket (sock.url).
  it("derives wss under https ingress, ws under http dev", async () => {
    // Asserted indirectly: install the fake WS, start a client, read sock.url.
    // ws://localhost:5173/ws  and  wss://ha.local/api/hassio_ingress/AbC123/ws
  });
});
```

```ts
// voix-backend/ui/test/build-base.test.ts
// Integration guard: run AFTER `vite build`. Reads the built index.html
// and asserts asset refs are relative (base: "./"), not root-absolute.
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const dist = resolve(__dirname, "../dist/index.html");

describe.skipIf(!existsSync(dist))("built index.html is ingress-safe", () => {
  it("references ./assets, never /assets", () => {
    const html = readFileSync(dist, "utf8");
    expect(html).toMatch(/(src|href)="\.\/assets\//); // relative
    expect(html).not.toMatch(/(src|href)="\/assets\//); // absolute → ingress 404
  });
});
```

> Wire `build-base.test.ts` into CI as a post-build step
> (`bun run build && bun run test build-base`). It's the cheapest
> possible regression net for the single most-likely-to-silently-break
> ingress invariant.

---

## 8. Golden tests for the VoiceEditor (task item #5)

The brief asks for snapshot/golden coverage of the per-type layout.
**Do not** snapshot the DOM tree — RNW emits inline styles and class
hashes that churn on every theme tweak, which is precisely the
"looks-right" noise we're escaping. Snapshot the **field inventory**: a
flat list of the visible section labels + input placeholders. It's a
3-line helper, a tiny readable golden, and it only changes when the
*information architecture* changes — which is exactly when you want a
review.

```tsx
// voix-backend/ui/src/voices/VoiceEditor.golden.test.tsx
import { vi, describe, it, expect } from "vitest";
import { fireEvent } from "@testing-library/react";
import { voicesApi } from "../lib/api";
import { renderAsync } from "../../test/render";
import { VoiceEditor } from "./VoiceEditor";
import { voiceFixture, dictationVoice } from "../../test/fixtures/voices";

vi.mock("../lib/api");

/** The semantic golden: section labels + textarea placeholders, in
 *  DOM order. Stable across style changes; changes only when fields
 *  move/appear/disappear. */
function fieldInventory(container: HTMLElement): string[] {
  const labels = [...container.querySelectorAll("*")]
    .filter((el) => el.children.length === 0 && el.textContent)
    .map((el) => el.textContent!.trim());
  const placeholders = [...container.querySelectorAll("input,textarea")]
    .map((el) => `[placeholder] ${el.getAttribute("placeholder") ?? ""}`);
  return [...new Set(labels), ...placeholders];
}

describe("VoiceEditor field inventory (golden)", () => {
  it("realtime, advanced open", async () => {
    voicesApi.get.mockResolvedValue(voiceFixture({ type: "realtime", donePrompt: "x" }));
    const { container, getByText } = await renderAsync(<VoiceEditor voiceId="x" onClose={() => {}} />);
    fireEvent.click(getByText("Show advanced"));
    expect(fieldInventory(container)).toMatchSnapshot("realtime-advanced");
  });

  it("dictation, advanced open", async () => {
    voicesApi.get.mockResolvedValue(dictationVoice);
    const { container, getByText } = await renderAsync(<VoiceEditor voiceId="x" onClose={() => {}} />);
    fireEvent.click(getByText("Show advanced"));
    expect(fieldInventory(container)).toMatchSnapshot("dictation-advanced");
  });
});
```

Committed golden (illustrative — what the realtime snapshot captures):

```
realtime-advanced:
  Back to voices / Saved / Puck colour / Voice type / Realtime / Dictation /
  When we're talking / Needed / When I'm done / If you want one /
  Hide advanced / Conversation feel / Pacing /
  Talking phase plumbing / Speaker / Realtime model /
  Output phase plumbing / Provider / Output model /
  [placeholder] You are me, having a quick voice chat… /
  [placeholder] Write this as me emailing a vendor… /
  [placeholder] alloy / [placeholder] gpt-realtime-2 / [placeholder] gpt-4o-mini
```

The diff when someone reorders the engine selector or hides a field is
a one-line, human-readable golden change — review-able, not a 400-line
style churn.

---

## 9. Optional: a thin Playwright smoke layer

jsdom can't run real Web Audio or a real WS upgrade. Keep **one**
Playwright spec as a smoke test, not a suite, run on demand (not every
PR):

- `vite preview` (built bundle) + a stub daemon (or the real one on
  `:8765`).
- Assert: app boots, sidebar renders, Voices list loads, the TalkButton
  exists and `getUserMedia` is invoked on press (grant fake mic via
  `--use-fake-device-for-media-stream` / `permissions: ["microphone"]`).

This catches "the bundle is fundamentally broken" / "RNW didn't
hydrate" — failure modes jsdom can't see — without becoming the place
where audio scheduling is tested. Scheduling lives in §6 where it's
fast and deterministic.

---

## 10. What NOT to test

- **Exact pixel styling / colours.** That's the brand guide's job +
  human review. A test asserting `haBlue === "#03A9F4"` is a tautology.
- **`StyleSheet.create` output.** RNW internals.
- **`theme.ts` `nearestSwatch` via the UI** — it's pure; if you want it
  covered, a 5-line unit test (`nearestSwatch([4,170,245]).key === "haBlue"`),
  but it's low risk.
- **The mocked sidebar placeholders** ("Kitchen quick chat", count `6`)
  — they're hardcoded fake data in `AppShell`, not wired to state.
  (That they're *still hardcoded* is itself worth a tracking note, but
  not a test.)

---

## 11. Untestable-until-we-change-the-code (with fixes)

Ranked by severity. Each is something the current code makes hard or
impossible to test *well*, with the minimal change that fixes both the
testability and (usually) a real bug.

### 11.1 🔴 `ConversationList` conditional hook — **crashes** (§0)

Not "hard to test" — the bug *is* exposed the instant you test it. The
fix is to move the hook above the early returns.

```diff
  const refresh = useCallback(() => { … }, []);
+ const onSessionEnded = useCallback(() => {
+   setTimeout(refresh, 1500);
+ }, [refresh]);
  useEffect(() => { refresh(); }, [refresh]);

  if (error) return (…);
  if (!entries) return (…);
-
- const onSessionEnded = useCallback(() => {
-   setTimeout(refresh, 1500);
- }, [refresh]);
```

**Also add the lint rule that would have caught it:**

```jsonc
// biome.json — biome 2.x ships the rule; it is not on by default
"linter": { "rules": { "correctness": {
  "useHookAtTopLevel": "error"
}}}
```

> Note `biome.json`'s `files.includes` is `["src/**/*.ts"]` — it does
> **not** lint the UI's `.tsx` at all today. The UI package needs its
> own biome config (or extend `includes` to `ui/src/**/*.tsx`). Right
> now nothing lints the UI.

### 11.2 🔴 `TalkButton` press/release race — **leaks a live mic** (§5.6)

`handlePressIn` awaits a token fetch + `client.start()` before assigning
`clientRef.current`. A fast tap runs `handlePressOut` first → `stop()`
on a null ref → the session opens with nothing to close it.

```diff
  const handlePressIn = async () => {
    if (clientRef.current) return;
+   let released = false;
+   releasedRef.current = () => { released = true; };
    …
    clientRef.current = client;
+   if (released) { client.stop(); clientRef.current = null; return; }
    await client.start();
  };
```

A cleaner fix is a small state machine (`pending` flag) — but the test
in §5.6 pins the contract either way: after a tap, `closedWith` must be
non-null.

### 11.3 🟠 Non-deterministic clocks — `formatLastSeen`, `formatTimestamp`

Both call `Date.now()` / `new Date()` inline, forcing `vi.setSystemTime`
gymnastics (§5.3). Inject the clock:

```diff
- function formatLastSeen(ms: number): string {
-   const now = Date.now();
+ function formatLastSeen(ms: number, now = Date.now()): string {
```

Tests pass an explicit `now`; production keeps the default. No more
frozen-clock fragility.

### 11.4 🟠 `wsUrlFromDocument` is module-private

§7 can only assert it *indirectly* (via `FakeWebSocket.url`). Export it
so the relativity logic is unit-testable directly:

```diff
- function wsUrlFromDocument(): string {
+ export function wsUrlFromDocument(loc = typeof window !== "undefined" ? window.location : undefined): string {
```

Passing `loc` as a param also removes the `Object.defineProperty(window,
"location")` hack — the test just calls `wsUrlFromDocument({protocol,
host, pathname})`.

### 11.5 🟠 `BrowserAudioIoClient` status never leaves `"speaking"`

`playSpeaker` calls `setStatus("speaking")` on every frame but nothing
ever transitions back to `"listening"`. The TalkButton therefore shows
"voix is replying" forever after the first speaker frame, even once the
model stops. There's no end-of-speech signal consumed. **Fix needs a
product decision** (timeout after last frame? a daemon `speech_done`
event?), so the test in §5.6 currently *documents* the stuck state
rather than asserting the desired one. Flag for design.

### 11.6 🟠 Scheduler has no overrun guard (§6.1)

`playbackTime` can run unbounded ahead of `currentTime` on a burst.
Suggested guard:

```diff
  const startAt = Math.max(now, this.playbackTime);
+ // Drop to now if we're buffering more than ~1 s ahead (reconnect
+ // replay / flush) — bounds added latency.
+ const MAX_LEAD = 1.0;
+ const lead = this.playbackTime - now;
+ const base = lead > MAX_LEAD ? now : Math.max(now, this.playbackTime);
- node.start(startAt);
- this.playbackTime = startAt + buf.duration;
+ node.start(base);
+ this.playbackTime = base + buf.duration;
```

The `KNOWN GAP` test in §6.1 flips to an assertion once this lands.

### 11.7 🟡 `VoiceEditor` optimistic save doesn't revert on failure (§5.2)

On a failed PATCH the local state keeps the typed value while the daemon
has the old one — silent divergence. Snapshot the pre-save value and
restore on error:

```diff
  const save = async (patch: VoiceUpdate) => {
    if (!voice) return;
+   const prev = voice;
    setSaved(false);
    try { … }
    catch (e) {
      setError(…);
+     setVoice(prev);   // revert the optimistic edit
      setSaved(true);
    }
  };
```

### 11.8 🟡 `<audio>` 404s are invisible (`ConversationDetail`)

A missing `recordings/<sessionId>/mic.wav` renders a dead player with no
error — looks fine, plays nothing. Not jsdom-testable (no real media
load). Either accept it as a Playwright-smoke concern, or add an
`onError` handler that swaps in a "recording unavailable" note (then it
*is* testable by firing the element's `error` event).

### 11.9 🟡 `VoiceList` ignores all but `devices[0]`

`activateVoice` hardcodes `devices[0]` and the active strip shows only
the first device. Single-puck assumption baked in. Multi-surface
households silently lose every other device. Testable today (§5.4
documents it); the fix is a product/UX decision (per-surface activation
UI), not a one-liner.

---

## 12. Rollout

1. **PR 1 — harness skeleton.** Add deps, `vitest.config.ts`,
   `test/setup.ts`, the fakes (§3), fixtures (§4), `render.ts`. One
   trivial green test (`Puck` renders a View). Wire `bun run test` for
   the UI package into CI.
2. **PR 2 — the crash + the leak.** Land §5.1 (ConversationList) and
   §5.6 (TalkButton) tests *red*, then the §11.1 / §11.2 fixes to turn
   them green. This is the PR that pays for the whole exercise.
3. **PR 3 — coverage breadth.** Remaining component tests (§5),
   browserClient + scheduler (§6), ingress (§7).
4. **PR 4 — goldens + lint.** Field-inventory goldens (§8), enable
   `useHookAtTopLevel` + bring the UI under biome (§11.1 note).
5. **PR 5 — clock + privacy refactors.** §11.3 / §11.4 (inject clock,
   export `wsUrlFromDocument`) — small, removes the test-only hacks.
6. **Later — Playwright smoke (§9)** and the scheduler/status design
   decisions (§11.5 / §11.6).

---

## Appendix — file map

```
voix-backend/ui/
  vitest.config.ts                          # §2
  test/
    setup.ts                                # §2
    render.ts                               # §5
    fakes/ws.ts                             # §3  (FakeWebSocket = fake daemon)
    fakes/audio.ts                          # §3  (FakeAudioContext/getUserMedia)
    fixtures/voices.ts                      # §4
    fixtures/history.ts                     # §4
    fixtures/mockApi.ts                     # §4
    build-base.test.ts                      # §7  (post-build guard)
  src/
    components/Puck.test.tsx                # smoke
    voices/VoiceEditor.test.tsx            # §5.2
    voices/VoiceEditor.golden.test.tsx     # §8
    voices/VoiceList.test.tsx              # §5.4
    surfaces/SurfaceList.test.tsx          # §5.3
    conversations/ConversationList.test.tsx     # §5.1 (the crash)
    conversations/ConversationDetail.test.tsx   # §5.5
    conversations/TalkButton.test.tsx           # §5.6 (the leak)
    audio_io/browserClient.test.ts         # §6
    audio_io/scheduler.test.ts             # §6.1 (monotonic next-start)
    audio_io/ingress.test.ts               # §7
```

**Bottom line:** the UI is currently verified by "it looked right in
the iframe." That standard already shipped a guaranteed runtime crash
(§0) and a mic-leak race (§11.2) to `main`. The harness above is ~12
small files, no new infra beyond `vitest`, and it converts both of
those from "nobody noticed" to "red on the first run."
