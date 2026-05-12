// ABOUTME: aiAutoTag tests — schema validation, request shape, and fail-open behavior across error branches.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { autoTag, validateAutoTag, AUTO_TAG_MODEL, type GeminiClient } from "./aiAutoTag";
import { clearLogs, getLogs } from "./logger";

function fakeBuffer(): AudioBuffer {
  return {
    sampleRate: 48000,
    length: 100,
    duration: 100 / 48000,
    numberOfChannels: 1,
    getChannelData: () => new Float32Array(100),
    copyFromChannel: () => undefined,
    copyToChannel: () => undefined,
  } as unknown as AudioBuffer;
}

function makeClient(behavior: (params: object) => Promise<{ text?: string }>): GeminiClient {
  return { models: { generateContent: vi.fn(behavior) } };
}

describe("validateAutoTag", () => {
  it("accepts valid shapes and rejects bad tag enum / out-of-range confidence / null", () => {
    expect(validateAutoTag({ tag: "kick", confidence: 0.85 })).toEqual({
      tag: "kick",
      confidence: 0.85,
      reasoning: undefined,
    });
    expect(validateAutoTag({ tag: "drums", confidence: 0.9 })).toBeNull();
    expect(validateAutoTag({ tag: "snare", confidence: 1.5 })).toBeNull();
    expect(validateAutoTag(null)).toBeNull();
  });
});

describe("autoTag", () => {
  beforeEach(() => {
    clearLogs();
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    clearLogs();
  });

  it("happy path: sends gemini-3.1-flash-lite without extended thinking and returns the parsed result", async () => {
    type Captured = { model?: string; config?: { thinkingConfig?: unknown } };
    let captured: Captured = {};
    const client: GeminiClient = {
      models: {
        generateContent: vi.fn(async (params: object) => {
          captured = params as Captured;
          return { text: JSON.stringify({ tag: "kick", confidence: 0.9, reasoning: "low thump" }) };
        }),
      },
    };
    const result = await autoTag(fakeBuffer(), client);
    expect(result).toEqual({ tag: "kick", confidence: 0.9, reasoning: "low thump" });
    expect(AUTO_TAG_MODEL).toBe("gemini-3.1-flash-lite");
    expect(captured.model).toBe("gemini-3.1-flash-lite");
    // Per-clip path intentionally omits thinkingConfig — the batch path
    // keeps HIGH for kit-balance reasoning, the single-clip path doesn't
    // need it for a 5-way classification.
    expect(captured.config?.thinkingConfig).toBeUndefined();
  });

  it("fails open across error branches: SDK throw, malformed JSON, MissingApiKeyError from transport", async () => {
    // 1. SDK throw → autotag.error.
    expect(
      await autoTag(
        fakeBuffer(),
        makeClient(async () => {
          throw new Error("network down");
        }),
      ),
    ).toBeNull();
    expect(getLogs().some((l) => l.event === "autotag.error")).toBe(true);

    clearLogs();
    // 2. Malformed JSON → autotag.miss with reason invalid-json.
    expect(
      await autoTag(fakeBuffer(), makeClient(async () => ({ text: "not json {{" }))),
    ).toBeNull();
    expect(getLogs().some((l) => l.event === "autotag.miss")).toBe(true);

    clearLogs();
    // 3. Transport surfaces MissingApiKeyError → autotag.miss with reason no-key.
    const { MissingApiKeyError } = await import("./aiErrors");
    expect(
      await autoTag(
        fakeBuffer(),
        makeClient(async () => {
          throw new MissingApiKeyError();
        }),
      ),
    ).toBeNull();
    const noKey = getLogs().find((l) => l.event === "autotag.miss");
    expect((noKey?.payload as { reason?: string })?.reason).toBe("no-key");
  });
});
