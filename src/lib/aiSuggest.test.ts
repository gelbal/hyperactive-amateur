// ABOUTME: aiSuggest tests — Gemini structured-output happy path, validation, missing key, variations.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  suggestPattern,
  varyPattern,
  validatePattern,
  ValidationError,
  MissingApiKeyError,
  type GeminiPatternClient,
  type Variation,
} from "./aiSuggest";

function makeFakeClient(text: string): GeminiPatternClient {
  return {
    models: {
      generateContent: vi.fn(async () => ({ text })),
    },
  };
}

function pattern8x16(value = false): boolean[][] {
  return Array.from({ length: 8 }, (_, i) =>
    Array.from({ length: 16 }, (_, j) => value || (i === 0 && j === 0)),
  );
}

function patternJSON(): string {
  return JSON.stringify({ tracks: pattern8x16() });
}

describe("validatePattern", () => {
  it("accepts a valid 8x16 boolean grid", () => {
    expect(validatePattern({ tracks: pattern8x16() })).toEqual(pattern8x16());
  });

  it("rejects 7x16", () => {
    expect(() => validatePattern({ tracks: pattern8x16().slice(0, 7) })).toThrow(ValidationError);
  });

  it("rejects strings as steps", () => {
    const grid = pattern8x16() as unknown[][];
    grid[0][0] = "true";
    expect(() => validatePattern({ tracks: grid })).toThrow(ValidationError);
  });

  it("rejects missing tracks key", () => {
    expect(() => validatePattern({})).toThrow(ValidationError);
  });
});

describe("suggestPattern", () => {
  beforeEach(() => {
    vi.stubEnv("GEMINI_API_KEY", "test-key");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns the validated grid on a valid response", async () => {
    const client = makeFakeClient(patternJSON());
    const grid = await suggestPattern(
      { bpm: 90, subgenre: "boom-bap", tracks: [] },
      client,
    );
    expect(grid).toEqual(pattern8x16());
  });

  it("sends the user message + system instruction in the right shape", async () => {
    let captured: object | null = null;
    const client: GeminiPatternClient = {
      models: {
        generateContent: vi.fn(async (params: object) => {
          captured = params;
          return { text: patternJSON() };
        }),
      },
    };
    await suggestPattern(
      {
        bpm: 90,
        subgenre: "boom-bap",
        tracks: [
          { id: 0, tag: "kick" },
          { id: 1, tag: null },
        ],
      },
      client,
    );
    const params = captured as unknown as {
      model: string;
      contents: Array<{ parts: Array<{ text: string }> }>;
      config: { systemInstruction: string; responseMimeType: string };
    };
    expect(params.model).toBe("gemini-3-flash-preview");
    expect(params.config.systemInstruction).toMatch(/hip-hop beat producer/);
    expect(params.config.responseMimeType).toBe("application/json");
    const userText = params.contents[0]?.parts[0]?.text ?? "";
    expect(userText).toContain("90 BPM");
    expect(userText).toContain("boom-bap");
    expect(userText).toContain("0=kick");
    expect(userText).toContain("1=untagged");
  });

  it("throws ValidationError on shape mismatch", async () => {
    const bad = JSON.stringify({ tracks: pattern8x16().slice(0, 5) });
    const client = makeFakeClient(bad);
    await expect(
      suggestPattern({ bpm: 90, subgenre: "boom-bap", tracks: [] }, client),
    ).rejects.toThrow(ValidationError);
  });

  it("throws ValidationError on malformed JSON", async () => {
    const client = makeFakeClient("not json {{");
    await expect(
      suggestPattern({ bpm: 90, subgenre: "boom-bap", tracks: [] }, client),
    ).rejects.toThrow(ValidationError);
  });

  it("throws ValidationError on empty text", async () => {
    const client = makeFakeClient("");
    await expect(
      suggestPattern({ bpm: 90, subgenre: "boom-bap", tracks: [] }, client),
    ).rejects.toThrow(ValidationError);
  });
});

describe("varyPattern", () => {
  const variations: Variation[] = ["busier", "fill", "halftime", "strip"];
  const baseInput = {
    bpm: 90,
    subgenre: "boom-bap" as const,
    tracks: [],
    currentPattern: pattern8x16(),
  };

  beforeEach(() => {
    vi.stubEnv("GEMINI_API_KEY", "test-key");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each(variations)("returns the validated grid for variation %s", async (variation) => {
    const client = makeFakeClient(patternJSON());
    const grid = await varyPattern({ ...baseInput, variation }, client);
    expect(grid).toEqual(pattern8x16());
  });

  it("uses a different system instruction per variation", async () => {
    const seen = new Set<string>();
    for (const variation of variations) {
      const client: GeminiPatternClient = {
        models: {
          generateContent: vi.fn(async (params: object) => {
            const p = params as { config: { systemInstruction: string } };
            seen.add(p.config.systemInstruction);
            return { text: patternJSON() };
          }),
        },
      };
      await varyPattern({ ...baseInput, variation }, client);
    }
    expect(seen.size).toBe(variations.length);
  });

  it("throws ValidationError on shape mismatch", async () => {
    const bad = JSON.stringify({ tracks: pattern8x16().slice(0, 5) });
    const client = makeFakeClient(bad);
    await expect(
      varyPattern({ ...baseInput, variation: "busier" }, client),
    ).rejects.toThrow(ValidationError);
  });
});

describe("missing key", () => {
  beforeEach(() => {
    vi.stubEnv("GEMINI_API_KEY", "");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("suggestPattern throws MissingApiKeyError when no key is set and no client is passed", async () => {
    await expect(
      suggestPattern({ bpm: 90, subgenre: "boom-bap", tracks: [] }),
    ).rejects.toThrow(MissingApiKeyError);
  });

  it("varyPattern throws MissingApiKeyError when no key is set and no client is passed", async () => {
    await expect(
      varyPattern({
        bpm: 90,
        subgenre: "boom-bap",
        tracks: [],
        currentPattern: pattern8x16(),
        variation: "busier",
      }),
    ).rejects.toThrow(MissingApiKeyError);
  });
});
