// ABOUTME: aiSuggest — call Gemini Flash with a JSON-schema response to fill or vary the 8x16 grid.
// ABOUTME: Client-direct in dev (env var); migrate to a server proxy before any public deploy.
import { GoogleGenAI, Type } from "@google/genai";
import type { Subgenre, Tag } from "../types";

export type Variation = "busier" | "fill" | "halftime" | "strip";

export type { Subgenre } from "../types";
export const SUBGENRES: readonly Subgenre[] = ["boom-bap", "trap", "lo-fi", "phonk"] as const;

// Minimum recorded clips before AI tools (Suggest, variations) become enabled.
// The model needs enough tagged audio to ground its output.
export const AI_UNLOCK_CLIPS = 4;

export interface SuggestPatternInput {
  bpm: number;
  subgenre: Subgenre;
  // Number of 16th-note steps in the loop. The model is asked to return
  // 8 tracks of exactly this length.
  stepCount: number;
  tracks: Array<{ id: number; tag: Tag | null }>;
}

export interface VaryPatternInput extends SuggestPatternInput {
  currentPattern: boolean[][];
  variation: Variation;
}

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

export class MissingApiKeyError extends Error {
  constructor() {
    super("GEMINI_API_KEY is not set. Add it to .env.local — see .env.example.");
    this.name = "MissingApiKeyError";
  }
}

const MODEL = "gemini-3.1-flash-lite-preview";

const SUGGEST_SYSTEM_PROMPT =
  "You are a hip-hop beat producer. Given track labels, tempo, and a target subgenre, return a 16-step pattern across 8 tracks as strict JSON. Patterns should feel musical, with kick on 1 and 9 by default for boom-bap, snare on 5 and 13, and varying hat density. Use vocal/fx tracks sparingly for accents.";

const VARIATION_PROMPTS: Record<Variation, string> = {
  busier:
    "You are a hip-hop beat producer. Take the given 8x16 step pattern and make it BUSIER by adding hits — particularly on hat and ghost-snare positions. Preserve the kick and main snare positions. Return the modified 8x16 pattern.",
  fill:
    "You are a hip-hop beat producer. Take the given 8x16 step pattern and ADD A FILL in the last beat (steps 13-16) — typical fills layer extra snare, hat, and fx hits while keeping the main groove intact through step 12. Return the modified 8x16 pattern.",
  halftime:
    "You are a hip-hop beat producer. Take the given 8x16 step pattern and HALF-TIME it — keep the kick on 1, but move the main snare to step 9 (instead of 5 and 13) so the groove feels half-tempo. Thin out the hats accordingly. Return the modified 8x16 pattern.",
  strip:
    "You are a hip-hop beat producer. Take the given 8x16 step pattern and STRIP IT BACK — remove most ghost notes and accents, focus on the downbeats (1, 5, 9, 13) and the main kick/snare skeleton. Return the modified 8x16 pattern.",
};

function buildPatternSchema(stepCount: number) {
  return {
    type: Type.OBJECT,
    properties: {
      tracks: {
        type: Type.ARRAY,
        items: {
          type: Type.ARRAY,
          items: { type: Type.BOOLEAN },
          minItems: stepCount,
          maxItems: stepCount,
        },
        minItems: 8,
        maxItems: 8,
      },
    },
    required: ["tracks"],
  };
}

function buildSuggestUserMessage(input: SuggestPatternInput): string {
  const labels = input.tracks.map((t) => `${t.id}=${t.tag ?? "untagged"}`).join(", ");
  return (
    `Tempo: ${input.bpm} BPM. Subgenre: ${input.subgenre}. ` +
    `Loop length: ${input.stepCount} sixteenth-note steps. Tracks: ${labels}. ` +
    `Generate a pattern of exactly 8 tracks by ${input.stepCount} steps.`
  );
}

function buildVaryUserMessage(input: VaryPatternInput): string {
  const labels = input.tracks.map((t) => `${t.id}=${t.tag ?? "untagged"}`).join(", ");
  return (
    `Tempo: ${input.bpm} BPM. Subgenre: ${input.subgenre}. ` +
    `Loop length: ${input.stepCount} sixteenth-note steps. Tracks: ${labels}.\n` +
    `Current pattern (8x${input.stepCount}):\n${JSON.stringify(input.currentPattern)}\n` +
    `Apply the ${input.variation} variation. Return 8 tracks of exactly ${input.stepCount} steps.`
  );
}

export function validatePattern(value: unknown, stepCount: number): boolean[][] {
  if (!value || typeof value !== "object") {
    throw new ValidationError("Response is not an object");
  }
  const obj = value as { tracks?: unknown };
  if (!Array.isArray(obj.tracks)) {
    throw new ValidationError("Response missing 'tracks' array");
  }
  if (obj.tracks.length !== 8) {
    throw new ValidationError(`Expected 8 tracks, got ${obj.tracks.length}`);
  }
  const grid: boolean[][] = [];
  for (let i = 0; i < 8; i++) {
    const row = obj.tracks[i];
    if (!Array.isArray(row) || row.length !== stepCount) {
      throw new ValidationError(`Track ${i} is not a ${stepCount}-element array`);
    }
    const cleaned: boolean[] = [];
    for (let j = 0; j < stepCount; j++) {
      if (typeof row[j] !== "boolean") {
        throw new ValidationError(`Track ${i} step ${j} is not a boolean`);
      }
      cleaned.push(row[j]);
    }
    grid.push(cleaned);
  }
  return grid;
}

export function readApiKey(): string | undefined {
  return (import.meta.env.GEMINI_API_KEY as string | undefined) || undefined;
}

export interface GeminiPatternClient {
  models: {
    generateContent: (params: object) => Promise<{ text?: string }>;
  };
}

async function generateGrid(
  systemInstruction: string,
  userMessage: string,
  stepCount: number,
  client?: GeminiPatternClient,
): Promise<boolean[][]> {
  const apiKey = client ? "test-key" : readApiKey();
  if (!client && !apiKey) throw new MissingApiKeyError();

  const sdk: GeminiPatternClient =
    client ?? (new GoogleGenAI({ apiKey: apiKey! }) as unknown as GeminiPatternClient);

  const response = await sdk.models.generateContent({
    model: MODEL,
    contents: [{ role: "user", parts: [{ text: userMessage }] }],
    config: {
      systemInstruction,
      responseMimeType: "application/json",
      responseSchema: buildPatternSchema(stepCount),
    },
  });

  const text = response.text;
  if (typeof text !== "string" || text.length === 0) {
    throw new ValidationError("Empty response text");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new ValidationError(
      `Response is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  return validatePattern(parsed, stepCount);
}

export async function suggestPattern(
  input: SuggestPatternInput,
  client?: GeminiPatternClient,
): Promise<boolean[][]> {
  return generateGrid(
    SUGGEST_SYSTEM_PROMPT,
    buildSuggestUserMessage(input),
    input.stepCount,
    client,
  );
}

export async function varyPattern(
  input: VaryPatternInput,
  client?: GeminiPatternClient,
): Promise<boolean[][]> {
  return generateGrid(
    VARIATION_PROMPTS[input.variation],
    buildVaryUserMessage(input),
    input.stepCount,
    client,
  );
}
