/**
 * M07 split test: the audio-io connection state machine. Drives an
 * `AudioIoConnection` against stub WS + stub Pipeline and asserts that
 * inbound text/binary frames are routed correctly + the legacy hello
 * still works.
 *
 * The boundary in M07 is "what is mine to do?":
 *   • Connection: parse hello, validate auth, build the pipeline,
 *     forward binary frames + lifecycle events.
 *   • Pipeline: everything model-side (OpenAI, watchdog, transcripts).
 *
 * If the connection ever reaches into the pipeline's internals (or
 * vice versa), the test below should catch it — the stub Pipeline
 * counts call sites and the stub WS records every outbound frame.
 */

import { beforeEach, describe, expect, test } from "bun:test";
import { AudioIoConnection, type WSLike } from "../../src/audio_io/connection.ts";
import {
  type Capabilities,
  PROTOCOL_VERSION,
} from "../../src/audio_io/protocol.ts";
import type { Pipeline, PipelineStart } from "../../src/pipeline/types.ts";

function stubWs() {
  const sent: string[] = [];
  const binSent: number[] = [];
  let closeArgs: { code?: number; reason?: string } | null = null;
  const ws: WSLike = {
    send(data) {
      sent.push(String(data));
      return 0;
    },
    sendBinary(data) {
      const view =
        data instanceof ArrayBuffer
          ? new Uint8Array(data)
          : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
      binSent.push(view.length);
      return 0;
    },
    close(code, reason) {
      closeArgs = { code, reason };
      return 0;
    },
  };
  return { ws, sent, binSent, getClose: () => closeArgs };
}

type Calls = {
  startCount: number;
  pushedFrames: number[]; // byte sizes
  readyCount: number;
  bargeCount: number;
  closeCount: number;
  last?: PipelineStart;
};

function stubPipelineFactory(calls: Calls) {
  return (start: PipelineStart): Pipeline => {
    calls.last = start;
    return {
      async start() {
        calls.startCount++;
      },
      pushMic(pcm) {
        calls.pushedFrames.push(pcm.length);
      },
      readyForInput() {
        calls.readyCount++;
      },
      bargeIn() {
        calls.bargeCount++;
      },
      close() {
        calls.closeCount++;
      },
    };
  };
}

const validToken = "shared-secret";

describe("AudioIoConnection", () => {
  let calls: Calls;
  beforeEach(() => {
    calls = {
      startCount: 0,
      pushedFrames: [],
      readyCount: 0,
      bargeCount: 0,
      closeCount: 0,
    };
  });

  test("accepts a legacy puck hello (no protocol_version) and starts a pipeline", async () => {
    const { ws, sent } = stubWs();
    const conn = new AudioIoConnection(ws, {
      wsToken: validToken,
      openaiApiKey: "k",
      pipelineFactory: stubPipelineFactory(calls),
    });
    await conn.handleText({
      type: "hello",
      token: validToken,
      device_id: "puck-1",
      mode: "realtime", // legacy field
    });
    expect(calls.startCount).toBe(1);
    expect(calls.last?.intent).toBe("discuss"); // realtime → discuss
    expect(calls.last?.deviceId).toBe("puck-1");
    expect(calls.last?.micSampleRateHz).toBe(16000); // legacy defaults
    expect(calls.last?.halfDuplexOnChip).toBe(true);
    // Last sent frame is the ready event.
    expect(sent.at(-1)).toContain('"type":"ready"');
    expect(sent.at(-1)).toContain('"mode":"realtime"');
  });

  test("accepts a v1 hello with explicit capabilities", async () => {
    const { ws } = stubWs();
    const conn = new AudioIoConnection(ws, {
      wsToken: validToken,
      openaiApiKey: "k",
      pipelineFactory: stubPipelineFactory(calls),
    });
    const caps: Capabilities = {
      mic: { sample_rate_hz: 48000, channels: 1 },
      speaker: { sample_rate_hz: 24000 },
      half_duplex_on_chip: false,
    };
    await conn.handleText({
      type: "hello",
      protocol_version: PROTOCOL_VERSION,
      token: validToken,
      device_id: "phone-1",
      intent: "dictate",
      capabilities: caps,
    });
    expect(calls.startCount).toBe(1);
    expect(calls.last?.intent).toBe("dictate");
    expect(calls.last?.micSampleRateHz).toBe(48000);
    expect(calls.last?.halfDuplexOnChip).toBe(false);
  });

  test("rejects a bad token: decline + WS close, no pipeline built", async () => {
    const { ws, sent, getClose } = stubWs();
    const conn = new AudioIoConnection(ws, {
      wsToken: validToken,
      openaiApiKey: "k",
      pipelineFactory: stubPipelineFactory(calls),
    });
    await conn.handleText({
      type: "hello",
      token: "wrong",
      device_id: "puck-1",
      mode: "realtime",
    });
    expect(calls.startCount).toBe(0);
    expect(sent[0]).toContain('"type":"decline"');
    expect(sent[0]).toContain('"reason":"auth"');
    expect(getClose()?.code).toBe(4000);
  });

  test("rejects an unsupported protocol version", async () => {
    const { ws, sent, getClose } = stubWs();
    const conn = new AudioIoConnection(ws, {
      wsToken: validToken,
      openaiApiKey: "k",
      pipelineFactory: stubPipelineFactory(calls),
    });
    await conn.handleText({
      type: "hello",
      protocol_version: 99,
      token: validToken,
      device_id: "future-thing",
      intent: "discuss",
      capabilities: { mic: { sample_rate_hz: 16000, channels: 1 } },
    });
    expect(calls.startCount).toBe(0);
    expect(sent[0]).toContain('"reason":"unsupported_protocol_version"');
    expect(getClose()?.code).toBe(4000);
  });

  test("routes a binary frame to pipeline.pushMic after hello", async () => {
    const { ws } = stubWs();
    const conn = new AudioIoConnection(ws, {
      wsToken: validToken,
      openaiApiKey: "k",
      pipelineFactory: stubPipelineFactory(calls),
    });
    await conn.handleText({
      type: "hello",
      token: validToken,
      device_id: "puck-1",
      mode: "realtime",
    });
    conn.handleBinary(Buffer.alloc(640)); // 20ms @ 16kHz
    expect(calls.pushedFrames).toEqual([640]);
  });

  test("drops a binary frame received before the hello", async () => {
    const { ws } = stubWs();
    const conn = new AudioIoConnection(ws, {
      wsToken: validToken,
      openaiApiKey: "k",
      pipelineFactory: stubPipelineFactory(calls),
    });
    conn.handleBinary(Buffer.alloc(640));
    expect(calls.pushedFrames).toEqual([]);
  });

  test("routes ready_for_input to the pipeline", async () => {
    const { ws } = stubWs();
    const conn = new AudioIoConnection(ws, {
      wsToken: validToken,
      openaiApiKey: "k",
      pipelineFactory: stubPipelineFactory(calls),
    });
    await conn.handleText({
      type: "hello",
      token: validToken,
      device_id: "puck-1",
      mode: "realtime",
    });
    await conn.handleText({ type: "ready_for_input" });
    expect(calls.readyCount).toBe(1);
  });

  test("routes barge_in to the pipeline", async () => {
    const { ws } = stubWs();
    const conn = new AudioIoConnection(ws, {
      wsToken: validToken,
      openaiApiKey: "k",
      pipelineFactory: stubPipelineFactory(calls),
    });
    await conn.handleText({
      type: "hello",
      token: validToken,
      device_id: "puck-1",
      mode: "realtime",
    });
    await conn.handleText({ type: "barge_in" });
    expect(calls.bargeCount).toBe(1);
  });

  test("handleClose tears down the pipeline once", async () => {
    const { ws } = stubWs();
    const conn = new AudioIoConnection(ws, {
      wsToken: validToken,
      openaiApiKey: "k",
      pipelineFactory: stubPipelineFactory(calls),
    });
    await conn.handleText({
      type: "hello",
      token: validToken,
      device_id: "puck-1",
      mode: "realtime",
    });
    conn.handleClose();
    conn.handleClose();
    expect(calls.closeCount).toBe(1);
  });

  test("ignores a repeated hello on the same connection", async () => {
    const { ws } = stubWs();
    const conn = new AudioIoConnection(ws, {
      wsToken: validToken,
      openaiApiKey: "k",
      pipelineFactory: stubPipelineFactory(calls),
    });
    const hello = {
      type: "hello",
      token: validToken,
      device_id: "puck-1",
      mode: "realtime",
    };
    await conn.handleText(hello);
    await conn.handleText(hello);
    expect(calls.startCount).toBe(1);
  });

  test("pipeline-initiated close (via callbacks) tears down the WS", async () => {
    const { ws, getClose } = stubWs();
    const conn = new AudioIoConnection(ws, {
      wsToken: validToken,
      openaiApiKey: "k",
      pipelineFactory: stubPipelineFactory(calls),
    });
    await conn.handleText({
      type: "hello",
      token: validToken,
      device_id: "puck-1",
      mode: "realtime",
    });
    // Simulate pipeline calling its `close` callback.
    calls.last?.callbacks.close();
    expect(getClose()?.code).toBe(1000);
  });

  test("pipeline sends a typed event → WS sees the wire shape", async () => {
    const { ws, sent } = stubWs();
    const conn = new AudioIoConnection(ws, {
      wsToken: validToken,
      openaiApiKey: "k",
      pipelineFactory: stubPipelineFactory(calls),
    });
    await conn.handleText({
      type: "hello",
      token: validToken,
      device_id: "puck-1",
      mode: "realtime",
    });
    calls.last?.callbacks.sendEvent({ type: "transcript", role: "user", text: "hello" });
    // Legacy wire shape: { type: "transcript", text } — role stripped.
    const last = sent.at(-1) ?? "";
    expect(last).toContain('"type":"transcript"');
    expect(last).toContain('"text":"hello"');
    expect(last).not.toContain('"role"');
  });

  test("pipeline sends a speaker frame → WS sees it as binary", async () => {
    const { ws, binSent } = stubWs();
    const conn = new AudioIoConnection(ws, {
      wsToken: validToken,
      openaiApiKey: "k",
      pipelineFactory: stubPipelineFactory(calls),
    });
    await conn.handleText({
      type: "hello",
      token: validToken,
      device_id: "puck-1",
      mode: "realtime",
    });
    calls.last?.callbacks.sendSpeaker(Buffer.alloc(960)); // 20ms @ 24kHz
    expect(binSent).toEqual([960]);
  });
});
