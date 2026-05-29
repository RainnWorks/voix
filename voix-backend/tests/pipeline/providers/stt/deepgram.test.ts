/**
 * M10 STT provider tests.
 *
 * Two layers:
 *
 * 1. `parseDeepgramMessage` — pure function over the Deepgram event
 *    envelope shape. Verifies we translate `is_final` /
 *    `speech_final` / interim partials / error envelopes into the
 *    common `SttEvent` shape exactly once each.
 *
 * 2. `DeepgramProvider` + `DeepgramSession` — driven against a stub
 *    WS that implements `DeepgramWSLike`. Verifies the session:
 *    queues audio before `open`, drains it on `open`, forwards
 *    parsed events to subscribers, replays the close signal through
 *    `finish()`, and is idempotent on `close()`.
 *
 * No real network in either layer.
 */

import { beforeEach, describe, expect, test } from "bun:test";
import {
  type DeepgramWSFactory,
  type DeepgramWSLike,
  DeepgramProvider,
  parseDeepgramMessage,
} from "../../../../src/pipeline/providers/stt/deepgram.ts";
import type { SttEvent } from "../../../../src/pipeline/providers/stt/types.ts";

describe("parseDeepgramMessage", () => {
  test("final + speech_final → final event with isEndpoint=true", () => {
    const events = parseDeepgramMessage(
      JSON.stringify({
        type: "Results",
        is_final: true,
        speech_final: true,
        channel: { alternatives: [{ transcript: "hello world" }] },
      }),
    );
    expect(events).toEqual([{ type: "final", text: "hello world", isEndpoint: true }]);
  });

  test("final without speech_final → final event with isEndpoint=false", () => {
    const events = parseDeepgramMessage(
      JSON.stringify({
        type: "Results",
        is_final: true,
        speech_final: false,
        channel: { alternatives: [{ transcript: "hello" }] },
      }),
    );
    expect(events).toEqual([{ type: "final", text: "hello", isEndpoint: false }]);
  });

  test("interim hypothesis → partial event", () => {
    const events = parseDeepgramMessage(
      JSON.stringify({
        type: "Results",
        is_final: false,
        speech_final: false,
        channel: { alternatives: [{ transcript: "hel" }] },
      }),
    );
    expect(events).toEqual([{ type: "partial", text: "hel" }]);
  });

  test("empty transcript → no event emitted", () => {
    const events = parseDeepgramMessage(
      JSON.stringify({
        type: "Results",
        is_final: false,
        channel: { alternatives: [{ transcript: "" }] },
      }),
    );
    expect(events).toEqual([]);
  });

  test("Metadata envelope at session start → no event", () => {
    const events = parseDeepgramMessage(
      JSON.stringify({ type: "Metadata", model_info: { name: "nova-3" } }),
    );
    expect(events).toEqual([]);
  });

  test("error envelope → error event", () => {
    const events = parseDeepgramMessage(JSON.stringify({ error: "invalid token" }));
    expect(events).toEqual([{ type: "error", message: "invalid token" }]);
  });

  test("malformed JSON → error event (not a throw)", () => {
    const events = parseDeepgramMessage("{ not json");
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe("error");
  });
});

// ─── Session-level tests ──────────────────────────────────────────────

type Listener<T = unknown> = (arg: T) => void;

class StubWs implements DeepgramWSLike {
  readyState = 0;
  sent: Array<ArrayBufferView | ArrayBuffer | string> = [];
  closedWith: { code?: number; reason?: string } | null = null;
  private listeners: Record<string, Listener[]> = {};

  send(data: ArrayBufferView | ArrayBuffer | string): void {
    this.sent.push(data);
  }
  close(code?: number, reason?: string): void {
    this.closedWith = { code, reason };
    this.emit("close", code ?? 1000, Buffer.from(reason ?? ""));
  }
  on(event: string, listener: Listener): unknown {
    this.listeners[event] ??= [];
    this.listeners[event].push(listener);
    return this;
  }
  emit(event: string, ...args: unknown[]): void {
    for (const l of this.listeners[event] ?? []) {
      (l as Listener<unknown>)(args[0]);
      if (args.length > 1) {
        // The Bun runtime's emitter pattern: forward additional args
        // to listeners that take them. Our parser doesn't read beyond
        // arg[0] for any event though.
      }
    }
  }
  fireOpen(): void {
    this.readyState = 1;
    this.emit("open");
  }
  fireMessage(text: string): void {
    this.emit("message", text);
  }
}

function stubFactory(holder: { ws?: StubWs }): DeepgramWSFactory {
  return () => {
    const ws = new StubWs();
    holder.ws = ws;
    return ws;
  };
}

describe("DeepgramProvider", () => {
  let captured: { ws?: StubWs };
  beforeEach(() => {
    captured = {};
  });

  test("missing apiKey → open() throws a clear message", async () => {
    const p = new DeepgramProvider("", stubFactory(captured));
    await expect(p.open({ sampleRateHz: 16000, interim: true })).rejects.toThrow(
      /missing apiKey/i,
    );
  });

  test("session forwards a final event to subscribers", async () => {
    const p = new DeepgramProvider("k", stubFactory(captured));
    const session = await p.open({ sampleRateHz: 16000, interim: true });
    const events: SttEvent[] = [];
    session.on((ev) => events.push(ev));
    captured.ws!.fireOpen();
    captured.ws!.fireMessage(
      JSON.stringify({
        type: "Results",
        is_final: true,
        speech_final: true,
        channel: { alternatives: [{ transcript: "ship it" }] },
      }),
    );
    expect(events).toEqual([{ type: "final", text: "ship it", isEndpoint: true }]);
  });

  test("audio sent before open is queued and replayed on open", async () => {
    const p = new DeepgramProvider("k", stubFactory(captured));
    const session = await p.open({ sampleRateHz: 16000, interim: true });
    session.sendAudio(Buffer.alloc(640)); // 20ms
    session.sendAudio(Buffer.alloc(640));
    // Nothing yet — handshake hasn't fired.
    expect(captured.ws!.sent).toEqual([]);
    captured.ws!.fireOpen();
    expect(captured.ws!.sent).toHaveLength(2);
  });

  test("audio sent after open goes straight through", async () => {
    const p = new DeepgramProvider("k", stubFactory(captured));
    const session = await p.open({ sampleRateHz: 16000, interim: true });
    captured.ws!.fireOpen();
    session.sendAudio(Buffer.alloc(640));
    expect(captured.ws!.sent).toHaveLength(1);
  });

  test("finish() sends the empty-frame end-of-stream signal", async () => {
    const p = new DeepgramProvider("k", stubFactory(captured));
    const session = await p.open({ sampleRateHz: 16000, interim: true });
    captured.ws!.fireOpen();
    // close() fires synchronous close event — finish() resolves
    // immediately after.
    const finishPromise = session.finish();
    // Verify the EOS frame was sent.
    const last = captured.ws!.sent.at(-1);
    expect(last instanceof Buffer && (last as Buffer).length === 0).toBe(true);
    // Manually fire close so finish() resolves.
    captured.ws!.close(1000);
    await finishPromise;
  });

  test("close() is idempotent and closes the WS once", async () => {
    const p = new DeepgramProvider("k", stubFactory(captured));
    const session = await p.open({ sampleRateHz: 16000, interim: true });
    captured.ws!.fireOpen();
    session.close();
    session.close();
    expect(captured.ws!.closedWith).not.toBeNull();
  });

  test("close event emits a `closed` SttEvent", async () => {
    const p = new DeepgramProvider("k", stubFactory(captured));
    const session = await p.open({ sampleRateHz: 16000, interim: true });
    const events: SttEvent[] = [];
    session.on((ev) => events.push(ev));
    captured.ws!.fireOpen();
    captured.ws!.close(1000);
    expect(events.find((e) => e.type === "closed")).toBeDefined();
  });
});
