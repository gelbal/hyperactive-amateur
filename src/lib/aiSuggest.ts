// ABOUTME: aiSuggest — call Claude Haiku 4.5 via tool-use to fill the 8x16 step grid.
// ABOUTME: Client-direct in dev (env var); migrate to a server proxy before any public deploy.
import Anthropic from "@anthropic-ai/sdk";
import type { Tag } from "../types";

export type Subgenre = "boom-bap" | "trap" | "lo-fi" | "phonk";

export const SUBGENRES: readonly Subgenre[] = ["boom-bap", "trap", "lo-fi", "phonk"] as const;

export interface SuggestPatternInput {
  bpm: number;
  subgenre: Subgenre;
  tracks: Array<{ id: number; tag: Tag | null }>;
}

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

export class MissingApiKeyError extends Error {
  constructor() {
    super(
      "VITE_ANTHROPIC_API_KEY is not set. Add it to .env.local — see .env.example.",
    );
    this.name = "MissingApiKeyError";
  }
}

const SYSTEM_PROMPT =
  "You are a hip-hop beat producer. Given track labels, tempo, and a target subgenre, return a 16-step pattern across 8 tracks as strict JSON. Patterns should feel musical, with kick on 1 and 9 by default for boom-bap, snare on 5 and 13, and varying hat density. Use vocal/fx tracks sparingly for accents.";

const TOOL_NAME = "set_pattern";
const TOOL_SCHEMA = {
  type: "object" as const,
  properties: {
    tracks: {
      type: "array" as const,
      items: {
        type: "array" as const,
        items: { type: "boolean" as const },
        minItems: 16,
        maxItems: 16,
      },
      minItems: 8,
      maxItems: 8,
    },
  },
  required: ["tracks"] as const,
};

function buildUserMessage(input: SuggestPatternInput): string {
  const labels = input.tracks
    .map((t) => `${t.id}=${t.tag ?? "untagged"}`)
    .join(", ");
  return `Tempo: ${input.bpm} BPM. Subgenre: ${input.subgenre}. Tracks: ${labels}. Generate a pattern.`;
}

export function validatePattern(value: unknown): boolean[][] {
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
    if (!Array.isArray(row) || row.length !== 16) {
      throw new ValidationError(`Track ${i} is not a 16-element array`);
    }
    const cleaned: boolean[] = [];
    for (let j = 0; j < 16; j++) {
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
  // Indirection lets tests stub the environment without touching import.meta.env.
  return (import.meta.env.VITE_ANTHROPIC_API_KEY as string | undefined) || undefined;
}

export async function suggestPattern(
  input: SuggestPatternInput,
  // Test seam: pass a custom client to bypass the SDK construction.
  client?: { messages: { create: (params: object) => Promise<unknown> } },
): Promise<boolean[][]> {
  const apiKey = client ? "test-key" : readApiKey();
  if (!client && !apiKey) throw new MissingApiKeyError();

  const anthropic =
    client ?? new Anthropic({ apiKey: apiKey!, dangerouslyAllowBrowser: true });

  const response = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 512,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: buildUserMessage(input) }],
    tools: [
      {
        name: TOOL_NAME,
        description: "Set the 8x16 step pattern for the sequencer.",
        input_schema: TOOL_SCHEMA,
      },
    ],
    tool_choice: { type: "tool", name: TOOL_NAME },
  });

  return extractToolPattern(response);
}

export type Variation = "busier" | "fill" | "halftime" | "strip";

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

export interface VaryPatternInput extends SuggestPatternInput {
  currentPattern: boolean[][];
  variation: Variation;
}

function buildVaryUserMessage(input: VaryPatternInput): string {
  const labels = input.tracks.map((t) => `${t.id}=${t.tag ?? "untagged"}`).join(", ");
  return (
    `Tempo: ${input.bpm} BPM. Subgenre: ${input.subgenre}. Tracks: ${labels}.\n` +
    `Current pattern (8x16):\n${JSON.stringify(input.currentPattern)}\n` +
    `Apply the ${input.variation} variation.`
  );
}

export async function varyPattern(
  input: VaryPatternInput,
  client?: { messages: { create: (params: object) => Promise<unknown> } },
): Promise<boolean[][]> {
  const apiKey = client ? "test-key" : readApiKey();
  if (!client && !apiKey) throw new MissingApiKeyError();

  const anthropic =
    client ?? new Anthropic({ apiKey: apiKey!, dangerouslyAllowBrowser: true });

  const response = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 512,
    system: VARIATION_PROMPTS[input.variation],
    messages: [{ role: "user", content: buildVaryUserMessage(input) }],
    tools: [
      {
        name: TOOL_NAME,
        description: "Set the 8x16 step pattern for the sequencer.",
        input_schema: TOOL_SCHEMA,
      },
    ],
    tool_choice: { type: "tool", name: TOOL_NAME },
  });

  return extractToolPattern(response);
}

function extractToolPattern(response: unknown): boolean[][] {
  const content = (response as { content?: unknown }).content;
  if (!Array.isArray(content)) {
    throw new ValidationError("Response has no content array");
  }
  const toolUse = content.find(
    (block: { type?: string; name?: string }) =>
      block.type === "tool_use" && block.name === TOOL_NAME,
  );
  if (!toolUse) {
    throw new ValidationError(`No '${TOOL_NAME}' tool_use in response`);
  }
  return validatePattern((toolUse as { input?: unknown }).input);
}
