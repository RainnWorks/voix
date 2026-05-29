/**
 * M12 TTS provider tests.
 *
 * Same two-layer shape as the Deepgram STT tests: pure parser layer
 * over JSON + binary envelopes, plus session-level behaviour driven
 * against a stub WS.
 */

import { beforeEach, describe, expect, test } from "bun:test";
import {
  type AuraWSFactory,
  type AuraWSLike,
  AuraProvider,
  parseAuraMessage,
} from "../../../../src/pipeline/providers/tts/aura.ts";
import type { TtsEvent } from "../../../../src/pipeline/providers/tts/types.ts";

describe("parseAuraMessage", () => {
  test("binary frame → audio event with the PCM buffer", () => {
    const pcm = Buffer.from([1, 2, 3, 4]);
    const events = parseAuraMessage(pcm);
    expect(events).toEqual([{ type: "audio", pcm }]);
  });

  test("empty binary frame → no event", () => {
    expect(parseAuraMessage(Buffer.alloc(0))).toEqual([]);
  });

  test("Flushed envelope → utterance_end event", () => {
    expect(parseAuraMessage(JSON.stringify({ type: "Flushed" }))).toEqual([
      { type: "utterance_end" },
    ]);
  });

  test("Metadata + Warning envelopes are silently ignored", () => {
    expect(parseAuraMessage(JSON.stringify({ type: "Metadata", model: "aura-asteria-en" }))).toEqual(
      [],
    );
    expect(parseAuraMessage(JSON.stringify({ type: "Warning", description: "slow" }))).toEqual([]);
  });

  test("error envelope → error event", () => {
    expect(parseAuraMessage(JSON.stringify({ error: "invalid token" }))).toEqual([
      { type: "error", message: "invalid token" },
    ]);
  });

  test("malformed JSON → error event (not a throw)", () => {
    const events = parseAuraMessage("{ not json");
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe("error");
  });
});

// ─── Session-level tests ──────────────────────────────────────────────

type Listener<T = unknown> = (arg: T) => void;

class StubWs implements AuraWSLike {
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
    }
  }
  fireOpen(): void {
    this.readyState = 1;
    this.emit("open");
  }
  fireMessage(data: string | Buffer): void {
    this.emit("message", data);
  }
}

function stubFactory(holder: { ws?: StubWs }): AuraWSFactory {
  return () => {
    const ws = new StubWs();
    holder.ws = ws;
    return ws;
  };
}

describe("AuraProvider", () => {
  let captured: { ws?: StubWs };
  beforeEach(() => {
    captured = {};
  });

  test("missing apiKey → open() throws", async () => {
    const p = new AuraProvider("", stubFactory(captured));
    await expect(p.open({ sampleRateHz: 24000 })).rejects.toThrow(/missing apiKey/i);
  });

  test("audio binary from upstream forwards to subscribers as audio events", async () => {
    const p = new AuraProvider("k", stubFactory(captured));
    const session = await p.open({ sampleRateHz: 24000 });
    const events: TtsEvent[] = [];
    session.on((ev) => events.push(ev));
    captured.ws!.fireOpen();
    captured.ws!.fireMessage(Buffer.from([0xff, 0x00, 0xff, 0x00]));
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe("audio");
    if (events[0]?.type === "audio") {
      expect(events[0].pcm.length).toBe(4);
    }
  });

  test("speak() before open is queued and replayed on open", async () => {
    const p = new AuraProvider("k", stubFactory(captured));
    const session = await p.open({ sampleRateHz: 24000 });
    session.speak("hi");
    session.speak("there");
    expect(captured.ws!.sent).toEqual([]);
    captured.ws!.fireOpen();
    expect(captured.ws!.sent).toHaveLength(2);
    expect(JSON.parse(String(captured.ws!.sent[0]))).toEqual({ type: "Speak", text: "hi" });
    expect(JSON.parse(String(captured.ws!.sent[1]))).toEqual({ type: "Speak", text: "there" });
  });

  test("speak() after open goes straight through", async () => {
    const p = new AuraProvider("k", stubFactory(captured));
    const session = await p.open({ sampleRateHz: 24000 });
    captured.ws!.fireOpen();
    session.speak("ok");
    expect(captured.ws!.sent).toHaveLength(1);
    expect(JSON.parse(String(captured.ws!.sent[0]))).toEqual({ type: "Speak", text: "ok" });
  });

  test("flush() sends the Aura Flush envelope", async () => {
    const p = new AuraProvider("k", stubFactory(captured));
    const session = await p.open({ sampleRateHz: 24000 });
    captured.ws!.fireOpen();
    session.flush();
    expect(JSON.parse(String(captured.ws!.sent.at(-1)))).toEqual({ type: "Flush" });
  });

  test("Flushed envelope from upstream → utterance_end event", async () => {
    const p = new AuraProvider("k", stubFactory(captured));
    const session = await p.open({ sampleRateHz: 24000 });
    const events: TtsEvent[] = [];
    session.on((ev) => events.push(ev));
    captured.ws!.fireOpen();
    captured.ws!.fireMessage(JSON.stringify({ type: "Flushed" }));
    expect(events).toEqual([{ type: "utterance_end" }]);
  });

  test("finish() sends Close envelope + awaits closed event", async () => {
    const p = new AuraProvider("k", stubFactory(captured));
    const session = await p.open({ sampleRateHz: 24000 });
    captured.ws!.fireOpen();
    const finishPromise = session.finish();
    expect(JSON.parse(String(captured.ws!.sent.at(-1)))).toEqual({ type: "Close" });
    captured.ws!.close(1000);
    await finishPromise;
  });

  test("close() is idempotent and closes the WS once", async () => {
    const p = new AuraProvider("k", stubFactory(captured));
    const session = await p.open({ sampleRateHz: 24000 });
    captured.ws!.fireOpen();
    session.close();
    session.close();
    expect(captured.ws!.closedWith).not.toBeNull();
  });

  test("close event emits a closed TtsEvent", async () => {
    const p = new AuraProvider("k", stubFactory(captured));
    const session = await p.open({ sampleRateHz: 24000 });
    const events: TtsEvent[] = [];
    session.on((ev) => events.push(ev));
    captured.ws!.fireOpen();
    captured.ws!.close(1000);
    expect(events.find((e) => e.type === "closed")).toBeDefined();
  });
});
