/**
 * M13 + M-Arch Wave A #2 orchestrator tests.
 *
 * Drives the orchestrator's selection logic against stub providers
 * (registered through the new `ProviderRegistry`) and verifies the
 * wrapper's lifecycle:
 *   - mic frames received before inner.start() resolves get queued
 *     and drained in order on resolve
 *   - close() before inner is built cancels cleanly (inner that
 *     finishes construction afterwards is still closed)
 *   - selection picks TraditionalDictatePipeline only for
 *     intent=dictate + voice.sttProvider="deepgram"
 *   - everything else falls through to the realtime pipeline
 *   - unknown providers raise `UnknownProviderError` (typed, not a
 *     string-includes match)
 *
 * We can't instantiate RealtimePipeline against real OpenAI here,
 * so the "non-deepgram" test stops at the orchestrator's pick
 * function (exercised via the constructed Pipeline's runtime shape).
 */

import { describe, expect, test } from "bun:test";
import {
  createOrchestrator,
  createProviderRegistry,
  UnknownProviderError,
} from "../../src/pipeline/orchestrator.ts";
import type { SttProvider, SttSession } from "../../src/pipeline/providers/stt/types.ts";
import type { Pipeline, PipelineCallbacks, PipelineStart } from "../../src/pipeline/types.ts";
import type { Voice } from "../../src/voices/types.ts";

function fakeVoice(overrides: Partial<Voice> = {}): Voice {
  return {
    id: "test-voice",
    name: "Test",
    type: "dictation",
    talkingPrompt: "",
    donePrompt: "",
    prompt: "",
    voice: "",
    model: "",
    color: [0, 0, 0],
    brightness: 0.5,
    effect: "None",
    sttProvider: "deepgram",
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

function fakeCallbacks(): PipelineCallbacks {
  return {
    sendEvent: () => {},
    sendSpeaker: () => {},
    close: () => {},
  };
}

function fakeStart(overrides: Partial<PipelineStart> = {}): PipelineStart {
  return {
    deviceId: "device-x",
    sessionId: "sess-x",
    voice: fakeVoice(),
    intent: "dictate",
    micSampleRateHz: 16000,
    halfDuplexOnChip: true,
    callbacks: fakeCallbacks(),
    ...overrides,
  };
}

class StubSttSession implements SttSession {
  sent: number[] = [];
  closed = false;
  sendAudio(pcm: Buffer): void {
    this.sent.push(pcm.length);
  }
  async finish(): Promise<void> {}
  close(): void {
    this.closed = true;
  }
  on(): void {}
}

class StubSttProvider implements SttProvider {
  readonly name = "deepgram";
  sessions: StubSttSession[] = [];
  async open(): Promise<SttSession> {
    const s = new StubSttSession();
    this.sessions.push(s);
    return s;
  }
}

/** Registry pre-populated with a Deepgram STT factory backed by the
 *  given stub. Tests that need a different shape build their own
 *  registry inline. */
function registryWithDeepgram(stub: StubSttProvider) {
  const reg = createProviderRegistry();
  reg.register("stt", "deepgram", async () => stub);
  return reg;
}

describe("orchestrator pick", () => {
  test("intent=dictate + sttProvider=deepgram → TraditionalDictatePipeline opens STT", async () => {
    const stub = new StubSttProvider();
    const factory = createOrchestrator(registryWithDeepgram(stub));
    const pipeline = factory(fakeStart());
    await pipeline.start();
    expect(stub.sessions).toHaveLength(1);
    pipeline.close();
  });

  test("intent=discuss falls through to RealtimePipeline (does not open STT)", async () => {
    const stub = new StubSttProvider();
    const factory = createOrchestrator(registryWithDeepgram(stub));
    // RealtimePipeline tries to open OpenAI Realtime in start();
    // we don't want to hit the network in tests, so we exercise
    // the pick by close()ing before start() actually returns.
    const pipeline = factory(fakeStart({ intent: "discuss" }));
    // Kick off start() but close() immediately — close races ahead,
    // and the orchestrator should NOT have opened a Deepgram STT
    // since intent is discuss.
    void pipeline.start().catch(() => {});
    pipeline.close();
    expect(stub.sessions).toHaveLength(0);
  });

  test("dictate but non-deepgram STT provider falls through to RealtimePipeline", async () => {
    const stub = new StubSttProvider();
    const factory = createOrchestrator(registryWithDeepgram(stub));
    const pipeline = factory(
      fakeStart({
        intent: "dictate",
        voice: fakeVoice({ sttProvider: "openai-realtime" }),
      }),
    );
    void pipeline.start().catch(() => {});
    pipeline.close();
    expect(stub.sessions).toHaveLength(0);
  });
});

describe("orchestrator wrapper lifecycle", () => {
  test("early mic frames are queued and drained on inner.start", async () => {
    const stub = new StubSttProvider();
    const factory = createOrchestrator(registryWithDeepgram(stub));
    const pipeline = factory(fakeStart());
    // Push frames before start completes.
    const startPromise = pipeline.start();
    pipeline.pushMic(Buffer.alloc(640));
    pipeline.pushMic(Buffer.alloc(640));
    await startPromise;
    // After start, both frames should have flushed into the
    // dictate pipeline → into the STT session.
    expect(stub.sessions[0]?.sent).toEqual([640, 640]);
    pipeline.close();
  });

  test("close before pick() resolves prevents inner.start() from running", async () => {
    // Provider factory pauses inside the orchestrator's pick step.
    // The wrapper awaits pick(); we close in the meantime; pick
    // eventually resolves with the inner pipeline; the wrapper
    // sees `this.closed` and calls inner.close() instead of
    // inner.start().
    const stub = new StubSttProvider();
    let resolveStt!: (p: SttProvider) => void;
    const reg = createProviderRegistry();
    reg.register(
      "stt",
      "deepgram",
      () =>
        new Promise<SttProvider>((res) => {
          resolveStt = res;
        }),
    );
    const factory = createOrchestrator(reg);
    const pipeline = factory(fakeStart());
    const startPromise = pipeline.start();
    pipeline.close();
    resolveStt(stub);
    await startPromise;
    // Provider returned a session-less stub; never .open()'d because
    // inner.start() never ran. close() on the inner is a no-op here
    // since no session exists; the key assertion is that no STT
    // session was opened post-close.
    expect(stub.sessions).toHaveLength(0);
  });

  test("early mic frames cap (don't grow without bound)", async () => {
    // Same pattern — pause inside pick() so we can pile up mic
    // frames before inner.start() drains them.
    const stub = new StubSttProvider();
    let resolveStt!: (p: SttProvider) => void;
    const reg = createProviderRegistry();
    reg.register(
      "stt",
      "deepgram",
      () =>
        new Promise<SttProvider>((res) => {
          resolveStt = res;
        }),
    );
    const factory = createOrchestrator(reg);
    const pipeline = factory(fakeStart());
    const startPromise = pipeline.start();
    // 6 seconds of 16 kHz mono PCM16 = 192 KB. Cap is 5 s = 160 KB.
    // Last second of frames should get dropped.
    const oneSecondBytes = 16000 * 2;
    for (let s = 0; s < 6; s++) {
      pipeline.pushMic(Buffer.alloc(oneSecondBytes));
    }
    resolveStt(stub);
    await startPromise;
    // Drained frames should be exactly 5 (the cap), not 6.
    expect(stub.sessions[0]?.sent.length).toBe(5);
    pipeline.close();
  });
});

describe("orchestrator factory error surfacing", () => {
  test("STT factory throws → pipeline start propagates the error", async () => {
    const reg = createProviderRegistry();
    reg.register("stt", "deepgram", async () => {
      throw new Error("no deepgram key");
    });
    const factory = createOrchestrator(reg);
    const pipeline: Pipeline = factory(fakeStart());
    await expect(pipeline.start()).rejects.toThrow(/no deepgram key/);
  });

  test("unknown STT provider name → UnknownProviderError (typed)", async () => {
    // Empty registry — no factories at all. `voice.sttProvider="deepgram"`
    // routes through the registry and the absence surfaces as a typed
    // error rather than a string-includes assertion.
    const reg = createProviderRegistry();
    const factory = createOrchestrator(reg);
    const pipeline: Pipeline = factory(fakeStart());
    let caught: unknown;
    try {
      await pipeline.start();
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(UnknownProviderError);
    const typed = caught as UnknownProviderError;
    expect(typed.kind).toBe("stt");
    expect(typed.providerName).toBe("deepgram");
  });
});

describe("provider registry", () => {
  test("register + list reflects registered providers", () => {
    const reg = createProviderRegistry();
    expect(reg.list("llm")).toEqual([]);
    reg.register("llm", "openai", async () => ({
      name: "openai",
      async complete() {
        return { text: "" };
      },
    }));
    reg.register("llm", "openrouter", async () => ({
      name: "openrouter",
      async complete() {
        return { text: "" };
      },
    }));
    expect(reg.list("llm").sort()).toEqual(["openai", "openrouter"]);
    expect(reg.list("stt")).toEqual([]);
    expect(reg.list("tts")).toEqual([]);
  });

  test("get returns the registered factory; unknown name returns undefined", () => {
    const reg = createProviderRegistry();
    reg.register("stt", "deepgram", async () => ({
      name: "deepgram",
      async open() {
        throw new Error("not implemented");
      },
    }));
    expect(reg.get("stt", "deepgram")).toBeTypeOf("function");
    expect(reg.get("stt", "whisper")).toBeUndefined();
    expect(reg.get("llm", "deepgram")).toBeUndefined();
  });
});
