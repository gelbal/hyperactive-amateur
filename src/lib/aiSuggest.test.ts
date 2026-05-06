// ABOUTME: aiSuggest tests — happy path, validation failures, missing-key, variations.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  suggestPattern,
  varyPattern,
  validatePattern,
  ValidationError,
  MissingApiKeyError,
  type Variation,
} from "./aiSuggest";

function makeFakeClient(content: unknown) {
  return {
    messages: {
      create: vi.fn(async () => ({ content })),
    },
  };
}

function pattern8x16(): boolean[][] {
  return Array.from({ length: 8 }, (_, i) => Array.from({ length: 16 }, (_, j) => i === 0 && j === 0));
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
  it("returns the validated grid on a valid tool_use response", async () => {
    const client = makeFakeClient([
      { type: "tool_use", name: "set_pattern", input: { tracks: pattern8x16() } },
    ]);
    const grid = await suggestPattern(
      { bpm: 90, subgenre: "boom-bap", tracks: [] },
      client,
    );
    expect(grid).toEqual(pattern8x16());
    expect(client.messages.create).toHaveBeenCalled();
  });

  it("throws ValidationError when the tool_use is missing", async () => {
    const client = makeFakeClient([{ type: "text", text: "hello" }]);
    await expect(
      suggestPattern({ bpm: 90, subgenre: "boom-bap", tracks: [] }, client),
    ).rejects.toThrow(ValidationError);
  });

  it("throws ValidationError on shape mismatch", async () => {
    const client = makeFakeClient([
      { type: "tool_use", name: "set_pattern", input: { tracks: pattern8x16().slice(0, 6) } },
    ]);
    await expect(
      suggestPattern({ bpm: 90, subgenre: "boom-bap", tracks: [] }, client),
    ).rejects.toThrow(ValidationError);
  });

  describe("varyPattern", () => {
    const variations: Variation[] = ["busier", "fill", "halftime", "strip"];
    const baseInput = {
      bpm: 90,
      subgenre: "boom-bap" as const,
      tracks: [],
      currentPattern: pattern8x16(),
    };

    it.each(variations)("returns the validated grid for variation %s", async (variation) => {
      const client = makeFakeClient([
        { type: "tool_use", name: "set_pattern", input: { tracks: pattern8x16() } },
      ]);
      const grid = await varyPattern({ ...baseInput, variation }, client);
      expect(grid).toEqual(pattern8x16());
    });

    it("uses a different system prompt per variation", async () => {
      const seenPrompts = new Set<string>();
      for (const variation of variations) {
        const client = {
          messages: {
            create: vi.fn(async (params: object) => {
              const p = params as { system: string };
              seenPrompts.add(p.system);
              return {
                content: [
                  { type: "tool_use", name: "set_pattern", input: { tracks: pattern8x16() } },
                ],
              };
            }),
          },
        };
        await varyPattern({ ...baseInput, variation }, client);
      }
      expect(seenPrompts.size).toBe(variations.length);
    });

    it("throws ValidationError on shape mismatch", async () => {
      const client = makeFakeClient([
        { type: "tool_use", name: "set_pattern", input: { tracks: pattern8x16().slice(0, 5) } },
      ]);
      await expect(
        varyPattern({ ...baseInput, variation: "busier" }, client),
      ).rejects.toThrow(ValidationError);
    });
  });

  describe("missing key", () => {
    beforeEach(() => {
      vi.stubEnv("VITE_ANTHROPIC_API_KEY", "");
    });
    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it("throws MissingApiKeyError when no key is set and no client is passed", async () => {
      await expect(
        suggestPattern({ bpm: 90, subgenre: "boom-bap", tracks: [] }),
      ).rejects.toThrow(MissingApiKeyError);
    });
  });
});
