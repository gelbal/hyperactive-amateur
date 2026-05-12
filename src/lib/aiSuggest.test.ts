// ABOUTME: aiSuggest tests — schema validation, model + thinking + vibe wiring, variation enumeration, key-missing.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ThinkingLevel } from "./aiSchemaConstants";
import {
  suggestPattern,
  varyPattern,
  validatePattern,
  ValidationError,
  MissingApiKeyError,
  type GeminiPatternClient,
} from "./aiSuggest";
import { clearLogs, getLogs } from "./logger";

function pattern8x16(): boolean[][] {
  return Array.from({ length: 8 }, () => Array.from({ length: 16 }, () => false));
}

describe("validatePattern", () => {
  it("accepts an 8 x N grid and rejects shape mismatches", () => {
    expect(validatePattern({ tracks: pattern8x16() }, 16)).toEqual(pattern8x16());
    expect(() => validatePattern({ tracks: pattern8x16() }, 20)).toThrow(ValidationError);
    expect(() => validatePattern({ tracks: pattern8x16().slice(0, 7) }, 16)).toThrow(ValidationError);
    const bad = pattern8x16() as unknown[][];
    bad[0][0] = "true";
    expect(() => validatePattern({ tracks: bad }, 16)).toThrow(ValidationError);
  });
});

describe("suggestPattern", () => {
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

  it("happy path: sends gemini-3.1-flash-lite + thinkingLevel HIGH and returns the validated grid (tight vibe = no extra prompt)", async () => {
    type Captured = {
      model: string;
      config: { systemInstruction: string; thinkingConfig?: { thinkingLevel?: unknown } };
    };
    let captured: Captured = { model: "", config: { systemInstruction: "" } };
    const client: GeminiPatternClient = {
      models: {
        generateContent: vi.fn(async (params: object) => {
          captured = params as Captured;
          return { text: JSON.stringify({ tracks: pattern8x16() }) };
        }),
      },
    };
    const grid = await suggestPattern(
      { bpm: 90, subgenre: "boom-bap", vibe: "tight", stepCount: 16, tracks: [] },
      client,
    );
    expect(grid).toEqual(pattern8x16());
    expect(captured.model).toBe("gemini-3.1-flash-lite");
    expect(captured.config.systemInstruction).toMatch(/hip-hop beat producer/);
    expect(captured.config.thinkingConfig?.thinkingLevel).toBe(ThinkingLevel.HIGH);
    // Tight is the baseline — no vibe-specific tail injected.
    expect(captured.config.systemInstruction).not.toMatch(/breathing room|final quarter/i);
  });

  it("varied and breaky vibes inject distinct guidance into the system instruction", async () => {
    async function captureSystemInstructionForVibe(vibe: "varied" | "breaky"): Promise<string> {
      let captured = "";
      const client: GeminiPatternClient = {
        models: {
          generateContent: vi.fn(async (params: object) => {
            captured = (params as { config: { systemInstruction: string } }).config.systemInstruction;
            return { text: JSON.stringify({ tracks: pattern8x16() }) };
          }),
        },
      };
      await suggestPattern(
        { bpm: 90, subgenre: "boom-bap", vibe, stepCount: 16, tracks: [] },
        client,
      );
      return captured;
    }
    expect(await captureSystemInstructionForVibe("varied")).toMatch(/space|breathing room|asymmetric/i);
    expect(await captureSystemInstructionForVibe("breaky")).toMatch(/final quarter|drop|rest/i);
  });

  it("each subgenre injects distinct guidance into the system instruction (no boom-bap leak); row-order rule is always present", async () => {
    async function captureForSubgenre(
      subgenre: "boom-bap" | "trap" | "lo-fi" | "phonk",
    ): Promise<string> {
      let captured = "";
      const client: GeminiPatternClient = {
        models: {
          generateContent: vi.fn(async (params: object) => {
            captured = (params as { config: { systemInstruction: string } }).config.systemInstruction;
            return { text: JSON.stringify({ tracks: pattern8x16() }) };
          }),
        },
      };
      await suggestPattern(
        { bpm: 90, subgenre, vibe: "tight", stepCount: 16, tracks: [] },
        client,
      );
      return captured;
    }
    const boomBap = await captureForSubgenre("boom-bap");
    const trap = await captureForSubgenre("trap");
    const lofi = await captureForSubgenre("lo-fi");
    const phonk = await captureForSubgenre("phonk");
    // Each subgenre produces a distinct system prompt.
    expect(new Set([boomBap, trap, lofi, phonk]).size).toBe(4);
    // Trap doesn't inherit the boom-bap "step 5 and 13" anchor.
    expect(trap).not.toMatch(/snare on step 5/i);
    expect(trap).toMatch(/syncopation|rolling hats|half-time/i);
    expect(phonk).toMatch(/off-beat|cowbell/i);
    expect(lofi).toMatch(/sparse|stuttered/i);
    // Row-order rule rides every instruction.
    expect(boomBap).toMatch(/row 0 is track 0/i);
  });

  it("kit notes line is included in the user message when track reasoning is present", async () => {
    let captured = "";
    const client: GeminiPatternClient = {
      models: {
        generateContent: vi.fn(async (params: object) => {
          const parts = (params as { contents: Array<{ parts: Array<{ text: string }> }> })
            .contents[0].parts;
          captured = parts[0].text;
          return { text: JSON.stringify({ tracks: pattern8x16() }) };
        }),
      },
    };
    await suggestPattern(
      {
        bpm: 90,
        subgenre: "boom-bap",
        vibe: "tight",
        stepCount: 16,
        tracks: [
          { id: 0, tag: "kick", reasoning: "short low thump" },
          { id: 1, tag: "hat", reasoning: null }, // no reasoning — omitted
          { id: 2, tag: null }, // no tag at all — omitted
        ],
      },
      client,
    );
    expect(captured).toMatch(/Kit notes:/);
    expect(captured).toMatch(/track 0 \(kick\): short low thump/);
    expect(captured).not.toMatch(/track 1/);
    expect(captured).not.toMatch(/track 2/);
  });

  it("a transient SDK throw is retried exactly once; second failure surfaces the error", async () => {
    let calls = 0;
    const client: GeminiPatternClient = {
      models: {
        generateContent: vi.fn(async () => {
          calls++;
          if (calls === 1) throw new Error("transient network blip");
          return { text: JSON.stringify({ tracks: pattern8x16() }) };
        }),
      },
    };
    const grid = await suggestPattern(
      { bpm: 90, subgenre: "boom-bap", vibe: "tight", stepCount: 16, tracks: [] },
      client,
    );
    expect(grid).toEqual(pattern8x16());
    expect(calls).toBe(2);
    expect(getLogs().some((l) => l.event === "suggest.retry")).toBe(true);

    // Second-throw path: surfaces the error after retry.
    const stubborn: GeminiPatternClient = {
      models: { generateContent: vi.fn(async () => { throw new Error("still down"); }) },
    };
    await expect(
      suggestPattern(
        { bpm: 90, subgenre: "boom-bap", vibe: "tight", stepCount: 16, tracks: [] },
        stubborn,
      ),
    ).rejects.toThrow(/still down/);
    expect(stubborn.models.generateContent).toHaveBeenCalledTimes(2);
  });

  it("transport surfaces MissingApiKeyError; malformed JSON throws ValidationError", async () => {
    const noKey: GeminiPatternClient = {
      models: { generateContent: vi.fn(async () => { throw new MissingApiKeyError(); }) },
    };
    await expect(
      suggestPattern(
        { bpm: 90, subgenre: "boom-bap", vibe: "tight", stepCount: 16, tracks: [] },
        noKey,
      ),
    ).rejects.toThrow(MissingApiKeyError);

    const garbage: GeminiPatternClient = {
      models: { generateContent: vi.fn(async () => ({ text: "not json {{" })) },
    };
    await expect(
      suggestPattern(
        { bpm: 90, subgenre: "boom-bap", vibe: "tight", stepCount: 16, tracks: [] },
        garbage,
      ),
    ).rejects.toThrow(ValidationError);
  });
});

describe("varyPattern", () => {
  beforeEach(() => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("each variation sends a distinct system prompt; break specifically asks for a final-quarter drop", async () => {
    const captures = new Map<string, string>();
    for (const variation of ["busier", "fill", "halftime", "strip", "break"] as const) {
      const client: GeminiPatternClient = {
        models: {
          generateContent: vi.fn(async (params: object) => {
            captures.set(
              variation,
              (params as { config: { systemInstruction: string } }).config.systemInstruction,
            );
            return { text: JSON.stringify({ tracks: pattern8x16() }) };
          }),
        },
      };
      await varyPattern(
        {
          bpm: 90,
          subgenre: "boom-bap",
          vibe: "tight",
          stepCount: 16,
          tracks: [],
          currentPattern: pattern8x16(),
          variation,
        },
        client,
      );
    }
    // Five distinct system prompts.
    expect(new Set(captures.values()).size).toBe(5);
    expect(captures.get("break")).toMatch(/break|drop/i);
    expect(captures.get("break")).toMatch(/last quarter|final quarter/i);
  });
});
