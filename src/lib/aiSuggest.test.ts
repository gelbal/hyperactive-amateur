// ABOUTME: aiSuggest tests — schema validation + happy paths via the GeminiPatternClient seam.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  suggestPattern,
  varyPattern,
  validatePattern,
  ValidationError,
  MissingApiKeyError,
  type GeminiPatternClient,
} from "./aiSuggest";

function pattern8x16(): boolean[][] {
  return Array.from({ length: 8 }, () => Array.from({ length: 16 }, () => false));
}

function makeFakeClient(text: string): GeminiPatternClient {
  return { models: { generateContent: vi.fn(async () => ({ text })) } };
}

describe("validatePattern", () => {
  it("accepts a valid 8 x N grid and rejects shape mismatches", () => {
    expect(validatePattern({ tracks: pattern8x16() }, 16)).toEqual(pattern8x16());
    // Wrong row length.
    expect(() => validatePattern({ tracks: pattern8x16() }, 20)).toThrow(ValidationError);
    // Wrong row count.
    expect(() => validatePattern({ tracks: pattern8x16().slice(0, 7) }, 16)).toThrow(
      ValidationError,
    );
    // Non-boolean step.
    const bad = pattern8x16() as unknown[][];
    bad[0][0] = "true";
    expect(() => validatePattern({ tracks: bad }, 16)).toThrow(ValidationError);
  });
});

describe("suggestPattern + varyPattern", () => {
  beforeEach(() => {
    vi.stubEnv("GEMINI_API_KEY", "test-key");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("suggestPattern returns the validated grid and sends the right model + system instruction", async () => {
    type Captured = { model: string; config: { systemInstruction: string } };
    let captured: Captured | null = null;
    const client: GeminiPatternClient = {
      models: {
        generateContent: vi.fn(async (params: object) => {
          captured = params as Captured;
          return { text: JSON.stringify({ tracks: pattern8x16() }) };
        }),
      },
    };
    const grid = await suggestPattern(
      { bpm: 90, subgenre: "boom-bap", stepCount: 16, tracks: [] },
      client,
    );
    expect(grid).toEqual(pattern8x16());
    const c = captured as Captured | null;
    expect(c?.model).toBe("gemini-3.1-flash-lite-preview");
    expect(c?.config.systemInstruction).toMatch(/hip-hop beat producer/);
  });

  it("varyPattern uses a different system prompt per variation", async () => {
    const seen = new Set<string>();
    for (const variation of ["busier", "fill", "halftime", "strip"] as const) {
      const client: GeminiPatternClient = {
        models: {
          generateContent: vi.fn(async (params: object) => {
            const p = params as { config: { systemInstruction: string } };
            seen.add(p.config.systemInstruction);
            return { text: JSON.stringify({ tracks: pattern8x16() }) };
          }),
        },
      };
      await varyPattern(
        {
          bpm: 90,
          subgenre: "boom-bap",
          stepCount: 16,
          tracks: [],
          currentPattern: pattern8x16(),
          variation,
        },
        client,
      );
    }
    expect(seen.size).toBe(4);
  });

  it("both helpers reject malformed JSON / missing tracks", async () => {
    const garbage = makeFakeClient("not json {{");
    await expect(
      suggestPattern({ bpm: 90, subgenre: "boom-bap", stepCount: 16, tracks: [] }, garbage),
    ).rejects.toThrow(ValidationError);
  });
});

describe("missing key", () => {
  it("throws MissingApiKeyError when GEMINI_API_KEY is empty and no client is supplied", async () => {
    vi.stubEnv("GEMINI_API_KEY", "");
    await expect(
      suggestPattern({ bpm: 90, subgenre: "boom-bap", stepCount: 16, tracks: [] }),
    ).rejects.toThrow(MissingApiKeyError);
    vi.unstubAllEnvs();
  });
});
