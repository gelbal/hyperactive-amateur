// ABOUTME: aiAutoTag tests — schema validation + happy path + fail-open behavior.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { autoTag, validateAutoTag, type GeminiClient } from "./aiAutoTag";

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
  it("accepts a valid result and rejects bad shapes", () => {
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
    vi.stubEnv("GEMINI_API_KEY", "test-key");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns the parsed result on a valid response", async () => {
    const client = makeClient(async () => ({
      text: JSON.stringify({ tag: "kick", confidence: 0.9, reasoning: "low thump" }),
    }));
    const result = await autoTag(fakeBuffer(), client);
    expect(result).toEqual({ tag: "kick", confidence: 0.9, reasoning: "low thump" });
  });

  it("fails open: returns null on SDK throw, malformed JSON, missing key", async () => {
    expect(await autoTag(fakeBuffer(), makeClient(async () => ({ text: "not json {{" })))).toBeNull();
    expect(
      await autoTag(
        fakeBuffer(),
        makeClient(async () => {
          throw new Error("network down");
        }),
      ),
    ).toBeNull();

    vi.stubEnv("GEMINI_API_KEY", "");
    expect(await autoTag(fakeBuffer())).toBeNull();
  });
});
