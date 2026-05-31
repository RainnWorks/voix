/**
 * RealtimePipeline tests against a StubRealtimeProvider (M-Arch Wave B /
 * refactor #14).
 *
 * Before Wave B there was no `tests/pipeline/realtime.test.ts` — every
 * other test noted "can't instantiate RealtimePipeline against real
 * OpenAI". Wave B's load-bearing seam (refactor #1) closes that gap: a
 * `StubRealtimeProvider` implements the neutral `RealtimeProvider`
 * interface, emits canned `RealtimeEvent`s, and drives the whole
 * pipeline WITHOUT loading the openai SDK. This file imports nothing
 * from `src/realtime/openai.ts` — the proof the seam is real.
 *
 * Coverage:
 *   • open + immediate close (lifecycle)
 *   • user_transcript_complete → history append
 *   • function_call → the right context tool runs + result returned
 *   • assistant_audio → buffer reaches the speaker callback
 *   • error event → teardown (cb.close)
 *   • user_speech_start/stop → connection events
 */

import { describe, expect, test } from "bun:test";
import { registerSource } from "../../src/context/registry.ts";
import type { ContextSource, ToolResult } from "../../src/context/types.ts";
import { listHistory } from "../../src/history/store.ts";
import { RealtimePipeline } from "../../src/pipeline/realtime.ts";
import type {
  RealtimeEvent,
  RealtimeEventHandler,
  RealtimeProvider,
  RealtimeProviderSessionConfig,
  RealtimeSession,
} from "../../src/pipeline/providers/realtime/types.ts";
import type { PipelineCallbacks, PipelineStart } from "../../src/pipeline/types.ts";
import type { Voice } from "../../src/voices/types.ts";

// ─── Stub realtime provider (the point of the whole refactor) ──────────

class StubRealtimeSession implements RealtimeSession {
  readonly handlers: RealtimeEventHandler[] = [];
  closed = false;
  config: RealtimeProviderSessionConfig | null = null;
  readonly micPushes: Buffer[] = [];
  committed = 0;
  assistantStarts = 0;
  readonly functionResults: { callId: string; output: string }[] = [];
  readonly updates: { instructions?: string; tools?: unknown }[] = [];

  subscribe(handler: RealtimeEventHandler): void {
    this.handlers.push(handler);
  }
  updateSession(patch: { instructions?: string; tools?: unknown }): void {
    this.updates.push(patch);
  }
  pushMicPcm(pcm: Buffer): void {
    this.micPushes.push(pcm);
  }
  commitInput(): void {
    this.committed++;
  }
  sendAssistantStart(): void {
    this.assistantStarts++;
  }
  sendFunctionResult(callId: string, output: string): void {
    this.functionResults.push({ callId, output });
  }
  async close(): Promise<void> {
    this.closed = true;
  }

  /** Test-only: drive a canned neutral event into the pipeline. */
  emit(event: RealtimeEvent): void {
    for (const h of this.handlers) h(event);
  }
}

class StubRealtimeProvider implements RealtimeProvider {
  readonly name = "stub";
  readonly sessions: StubRealtimeSession[] = [];
  openCount = 0;

  async open(config: RealtimeProviderSessionConfig): Promise<RealtimeSession> {
    this.openCount++;
    const s = new StubRealtimeSession();
    s.config = config;
    this.sessions.push(s);
    return s;
  }

  /** The single session this provider opened (asserts there's exactly one). */
  get session(): StubRealtimeSession {
    if (this.sessions.length !== 1) {
      throw new Error(`expected exactly 1 session, got ${this.sessions.length}`);
    }
    return this.sessions[0] as StubRealtimeSession;
  }
}

// ─── Context source stub (for the function_call routing test) ──────────

class StubToolSource implements ContextSource {
  readonly name: string;
  readonly calls: { name: string; args: Record<string, unknown> }[] = [];

  constructor(name: string) {
    this.name = name;
  }
  async connect(): Promise<void> {}
  async gatherContext(): Promise<[]> {
    return [];
  }
  async listTools() {
    return [{ name: "echo", description: "echo args back", inputSchemaJson: {} }];
  }
  async callTool(name: string, args: Record<string, unknown>): Promise<ToolResult> {
    this.calls.push({ name, args });
    return { content: JSON.stringify({ echoed: args }) };
  }
}

// ─── Fixtures ──────────────────────────────────────────────────────────

function fakeVoice(overrides: Partial<Voice> = {}): Voice {
  return {
    id: "rt-voice",
    name: "RT",
    type: "conversation",
    talkingPrompt: "be helpful",
    donePrompt: "",
    prompt: "",
    voice: "alloy",
    model: "gpt-realtime-2",
    color: [0, 0, 0],
    brightness: 0.5,
    effect: "None",
    sttProvider: "openai-realtime",
    sttModel: "",
    includeEntities: [],
    includePersons: [],
    addendum: "",
    postProcessPrompt: "",
    postProcessProvider: "openai",
    postProcessModel: "gpt-4o-mini",
    routingHint: "",
    isBuiltin: false,
    tone: null,
    ...overrides,
  };
}

type SpyCallbacks = PipelineCallbacks & {
  events: { type: string; [k: string]: unknown }[];
  speakers: { pcm: Buffer; rate: number }[];
  closeCount: number;
};

function spyCallbacks(): SpyCallbacks {
  const events: SpyCallbacks["events"] = [];
  const speakers: SpyCallbacks["speakers"] = [];
  const cb: SpyCallbacks = {
    events,
    speakers,
    closeCount: 0,
    sendEvent: (e) => {
      events.push(e as { type: string });
    },
    sendSpeaker: (pcm, rate) => {
      speakers.push({ pcm, rate });
    },
    close: () => {
      cb.closeCount++;
    },
  };
  return cb;
}

function fakeStart(cb: PipelineCallbacks, overrides: Partial<PipelineStart> = {}): PipelineStart {
  return {
    deviceId: `dev-${Math.random().toString(36).slice(2)}`,
    sessionId: `sess-${Math.random().toString(36).slice(2)}`,
    voice: fakeVoice(),
    intent: "discuss",
    micSampleRateHz: 16000,
    halfDuplexOnChip: true,
    callbacks: cb,
    ...overrides,
  };
}

function buildPipeline(
  provider: StubRealtimeProvider,
  cb: PipelineCallbacks,
  startOverrides: Partial<PipelineStart> = {},
): RealtimePipeline {
  return new RealtimePipeline(fakeStart(cb, startOverrides), {
    realtimeProvider: provider,
    postProcessKeys: {},
  });
}

async function waitFor(pred: () => boolean, timeoutMs = 1000): Promise<void> {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitFor timed out");
    await new Promise((r) => setTimeout(r, 5));
  }
}

// ─── Tests ─────────────────────────────────────────────────────────────

describe("RealtimePipeline against StubRealtimeProvider", () => {
  test("open + immediate close: provider opens one session, close tears it down", async () => {
    const provider = new StubRealtimeProvider();
    const cb = spyCallbacks();
    const pipeline = buildPipeline(provider, cb);

    await pipeline.start();
    expect(provider.openCount).toBe(1);
    expect(provider.session.closed).toBe(false);
    // discuss path pushes composed instructions + tools after gather.
    expect(provider.session.updates.length).toBe(1);

    pipeline.close();
    await waitFor(() => provider.session.closed);
    expect(provider.session.closed).toBe(true);

    // close() is idempotent.
    pipeline.close();
    expect(provider.session.closed).toBe(true);
  });

  test("user_transcript_complete (dictate) drives a history append", async () => {
    const provider = new StubRealtimeProvider();
    const cb = spyCallbacks();
    const start = fakeStart(cb, {
      intent: "dictate",
      voice: fakeVoice({ type: "dictation", donePrompt: "" }),
    });
    const pipeline = new RealtimePipeline(start, {
      realtimeProvider: provider,
      postProcessKeys: {},
    });

    await pipeline.start();
    provider.session.emit({ type: "user_transcript_complete", text: "hello world" });

    await waitFor(() => listHistory({ deviceId: start.deviceId }).length === 1);
    const [entry] = listHistory({ deviceId: start.deviceId });
    expect(entry?.rawText).toBe("hello world");
    // donePrompt empty → no post-process → no processed text / provider.
    expect(entry?.processedText).toBeNull();
    expect(entry?.postProcessProvider).toBeNull();

    // The completed transcript is also surfaced to the connection.
    expect(cb.events).toContainEqual({ type: "transcript", role: "user", text: "hello world" });

    pipeline.close();
  });

  test("function_call invokes the right context tool and returns its result", async () => {
    const source = new StubToolSource("fnstub");
    registerSource(source);

    const provider = new StubRealtimeProvider();
    const cb = spyCallbacks();
    const pipeline = buildPipeline(provider, cb); // intent=discuss → tools enabled

    await pipeline.start();
    provider.session.emit({
      type: "function_call",
      callId: "call_1",
      name: "fnstub__echo",
      argsJson: { msg: "hi" },
    });

    await waitFor(() => provider.session.functionResults.length === 1);

    // The prefix-stripped call reached the right source + tool.
    expect(source.calls).toEqual([{ name: "echo", args: { msg: "hi" } }]);
    // The result was sent back over the seam, keyed to the call id.
    const result = provider.session.functionResults[0];
    expect(result?.callId).toBe("call_1");
    expect(JSON.parse(result?.output ?? "{}")).toEqual({ echoed: { msg: "hi" } });

    pipeline.close();
  });

  test("assistant_audio buffer reaches the speaker callback at 24 kHz", async () => {
    const provider = new StubRealtimeProvider();
    const cb = spyCallbacks();
    const pipeline = buildPipeline(provider, cb);

    await pipeline.start();
    const pcm = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]);
    provider.session.emit({ type: "assistant_audio", pcm });

    expect(cb.speakers).toHaveLength(1);
    expect(cb.speakers[0]?.pcm).toBe(pcm);
    expect(cb.speakers[0]?.rate).toBe(24000);

    pipeline.close();
  });

  test("error event surfaces to the connection AND tears the session down", async () => {
    const provider = new StubRealtimeProvider();
    const cb = spyCallbacks();
    const pipeline = buildPipeline(provider, cb);

    await pipeline.start();
    expect(cb.closeCount).toBe(0);

    provider.session.emit({ type: "error", message: "boom" });

    // Error is forwarded...
    expect(cb.events).toContainEqual({ type: "error", message: "boom" });
    // ...and triggers teardown (cb.close → connection tears down the WS).
    expect(cb.closeCount).toBe(1);

    pipeline.close();
  });

  test("user_speech_start/stop map to connection speech events", async () => {
    const provider = new StubRealtimeProvider();
    const cb = spyCallbacks();
    const pipeline = buildPipeline(provider, cb);

    await pipeline.start();
    provider.session.emit({ type: "user_speech_start" });
    provider.session.emit({ type: "user_speech_stop" });

    expect(cb.events).toContainEqual({ type: "user_speech_start" });
    expect(cb.events).toContainEqual({ type: "user_speech_end" });

    pipeline.close();
  });
});
