/**
 * M06 protocol test: `parseHello` accepts well-formed hellos and
 * returns sensible decline reasons for the malformed ones.
 *
 * The hello is the auth + capability gate every endpoint passes
 * through, so this test is the de-facto contract check for the
 * Audio I/O port v1 protocol.
 */

import { describe, expect, test } from "bun:test";
import {
  type AudioIoHello,
  type Capabilities,
  needsDaemonEchoGate,
  parseHello,
  PROTOCOL_VERSION,
} from "../../src/audio_io/protocol.ts";

const baseCaps: Capabilities = {
  mic: { sample_rate_hz: 16000, channels: 1 },
};

function helloFixture(overrides: Partial<AudioIoHello> = {}): AudioIoHello {
  return {
    type: "hello",
    protocol_version: PROTOCOL_VERSION,
    token: "shared-secret",
    device_id: "puck-x",
    intent: "discuss",
    capabilities: baseCaps,
    ...overrides,
  };
}

describe("parseHello", () => {
  test("a complete hello is accepted unchanged", () => {
    const fixture = helloFixture({
      voice_id: "default-realtime",
      client_info: { kind: "puck", version: "2026.5.0" },
      capabilities: {
        mic: { sample_rate_hz: 16000, channels: 1 },
        speaker: { sample_rate_hz: 24000 },
        half_duplex_on_chip: true,
        wake_words: ["voix"],
      },
    });
    const result = parseHello(fixture);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.hello).toEqual(fixture);
    }
  });

  test("non-object input is declined as internal", () => {
    const r = parseHello("hello there");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("internal");
  });

  test("wrong type field is declined", () => {
    const r = parseHello({ type: "metrics" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("internal");
  });

  test("wrong protocol_version is declined with version code", () => {
    const r = parseHello({ ...helloFixture(), protocol_version: 99 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("unsupported_protocol_version");
  });

  test("missing token is declined as auth (never as internal)", () => {
    const fixture = helloFixture();
    const broken = { ...fixture, token: undefined } as unknown;
    const r = parseHello(broken);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("auth");
  });

  test("empty token is declined as auth", () => {
    const r = parseHello(helloFixture({ token: "" }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("auth");
  });

  test("missing device_id is declined", () => {
    const fixture = helloFixture();
    const broken = { ...fixture, device_id: undefined } as unknown;
    const r = parseHello(broken);
    expect(r.ok).toBe(false);
  });

  test("invalid intent is declined", () => {
    const r = parseHello({ ...helloFixture(), intent: "ambient" });
    expect(r.ok).toBe(false);
  });

  test("missing capabilities is declined", () => {
    const fixture = helloFixture();
    const broken = { ...fixture, capabilities: undefined } as unknown;
    const r = parseHello(broken);
    expect(r.ok).toBe(false);
  });

  test("missing capabilities.mic is declined", () => {
    const r = parseHello({
      ...helloFixture(),
      capabilities: {} as Capabilities,
    });
    expect(r.ok).toBe(false);
  });

  test("unknown capability fields are preserved (forward-compat)", () => {
    // The daemon shouldn't be the bottleneck on a new capability
    // shipping ahead of first-class support — endpoints can declare
    // extra fields and a future daemon picks them up.
    const fixture = helloFixture({
      capabilities: {
        ...baseCaps,
        // @ts-expect-error -- intentional future field
        future_capability: true,
      },
    });
    const r = parseHello(fixture);
    expect(r.ok).toBe(true);
    if (r.ok) {
      const caps = r.hello.capabilities as Record<string, unknown>;
      expect(caps["future_capability"]).toBe(true);
    }
  });
});

describe("needsDaemonEchoGate", () => {
  test("returns false when the endpoint says it does AEC on chip", () => {
    expect(
      needsDaemonEchoGate({
        mic: { sample_rate_hz: 16000, channels: 1 },
        half_duplex_on_chip: true,
      }),
    ).toBe(false);
  });

  test("returns true when the endpoint omits the flag (conservative default)", () => {
    expect(needsDaemonEchoGate({ mic: { sample_rate_hz: 16000, channels: 1 } })).toBe(true);
  });

  test("returns true when explicitly false", () => {
    expect(
      needsDaemonEchoGate({
        mic: { sample_rate_hz: 16000, channels: 1 },
        half_duplex_on_chip: false,
      }),
    ).toBe(true);
  });
});
