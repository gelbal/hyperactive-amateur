// ABOUTME: aiAutoTag tests — request shape, validation, error / missing-key fall-through.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  autoTag,
  validateAutoTag,
  AUTO_TAG_MODEL,
  type GeminiClient,
} from "./aiAutoTag";

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
  it("accepts a valid result", () => {
    expect(validateAutoTag({ tag: "kick", confidence: 0.85 })).toEqual({
      tag: "kick",
      confidence: 0.85,
      reasoning: undefined,
    });
  });

  it("rejects an unknown tag value", () => {
    expect(validateAutoTag({ tag: "drums", confidence: 0.9 })).toBeNull();
  });

  it("rejects a confidence outside 0..1", () => {
    expect(validateAutoTag({ tag: "snare", confidence: 1.5 })).toBeNull();
    expect(validateAutoTag({ tag: "snare", confidence: -0.1 })).toBeNull();
  });

  it("rejects null/non-object", () => {
    expect(validateAutoTag(null)).toBeNull();
    expect(validateAutoTag("hello")).toBeNull();
  });
});

describe("autoTag", () => {
  beforeEach(() => {
    vi.stubEnv("VITE_GEMINI_API_KEY", "test-key");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("sends the audio as inlineData with audio/wav and returns the parsed result", async () => {
    let captured: { params?: object } = {};
    const client = makeClient(async (params) => {
      captured.params = params;
      return { text: JSON.stringify({ tag: "kick", confidence: 0.9, reasoning: "low thump" }) };
    });
    const result = await autoTag(fakeBuffer(), client);
    expect(result).toEqual({ tag: "kick", confidence: 0.9, reasoning: "low thump" });

    const params = captured.params as {
      model: string;
      contents: Array<{ parts: Array<{ inlineData?: { mimeType: string }; text?: string }> }>;
      config: { responseMimeType: string; responseSchema: { properties: Record<string, unknown> } };
    };
    expect(params.model).toBe(AUTO_TAG_MODEL);
    const parts = params.contents[0].parts;
    expect(parts.some((p) => p.inlineData?.mimeType === "audio/wav")).toBe(true);
    expect(parts.some((p) => typeof p.text === "string")).toBe(true);
    expect(params.config.responseMimeType).toBe("application/json");
    expect(params.config.responseSchema.properties.tag).toBeDefined();
  });

  it("returns null on an unknown tag value", async () => {
    const client = makeClient(async () => ({
      text: JSON.stringify({ tag: "drums", confidence: 0.9 }),
    }));
    expect(await autoTag(fakeBuffer(), client)).toBeNull();
  });

  it("returns null on malformed JSON", async () => {
    const client = makeClient(async () => ({ text: "not json {{" }));
    expect(await autoTag(fakeBuffer(), client)).toBeNull();
  });

  it("returns null when the SDK throws", async () => {
    const client = makeClient(async () => {
      throw new Error("network down");
    });
    expect(await autoTag(fakeBuffer(), client)).toBeNull();
  });

  it("returns null without making a call when the API key is missing", async () => {
    vi.stubEnv("VITE_GEMINI_API_KEY", "");
    // No client passed → function reads import.meta.env; the empty key value
    // should short-circuit before the SDK constructor runs.
    const result = await autoTag(fakeBuffer());
    expect(result).toBeNull();
  });
});
