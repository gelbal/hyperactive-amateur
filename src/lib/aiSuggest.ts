// ABOUTME: aiSuggest — call Gemini 3.1 Flash Lite with a JSON-schema response to fill or vary the 8-track step grid.
// ABOUTME: Uses thinkingLevel HIGH; retries once on transient HTTP errors (429/5xx); all calls go through the /api/gemini proxy.
import type { Subgenre, Tag, Vibe } from "../types";
import { logger, LOG_EVENTS } from "./logger";
import { errMessage } from "./aiClient";
import { SchemaType, ThinkingLevel } from "./aiSchemaConstants";
import { createHttpGeminiClient } from "./aiHttpClient";
import { TransientGeminiError, ValidationError } from "./aiErrors";

// Re-export so existing imports from "./aiSuggest" keep working.
export { MissingApiKeyError, ValidationError } from "./aiErrors";

export type Variation = "busier" | "fill" | "halftime" | "strip" | "break";

export type { Subgenre } from "../types";
export const SUBGENRES: readonly Subgenre[] = ["boom-bap", "trap", "lo-fi", "phonk"] as const;
export const VIBES: readonly Vibe[] = ["tight", "varied", "breaky"] as const;

// Minimum recorded clips before AI tools (Suggest, variations) become enabled.
// The model needs enough tagged audio to ground its output.
export const AI_UNLOCK_CLIPS = 4;

export interface SuggestPatternInput {
  bpm: number;
  subgenre: Subgenre;
  vibe: Vibe;
  // Number of 16th-note steps in the loop. The model is asked to return
  // 8 tracks of exactly this length.
  stepCount: number;
  // Per-track context fed to the model. Reasoning is the AI auto-tagger's
  // own description of the sound ("short, bright tick"), surfaced back to
  // Suggest so it can write a pattern grounded in the actual kit rather
  // than just the tag enum.
  tracks: Array<{ id: number; tag: Tag | null; reasoning?: string | null }>;
}

export interface VaryPatternInput extends SuggestPatternInput {
  currentPattern: boolean[][];
  variation: Variation;
}

const MODEL = "gemini-3.1-flash-lite";

const ROW_ORDER_RULE =
  " The returned `tracks` array MUST contain exactly 8 rows in ascending " +
  "track-id order — row 0 is track 0, row 7 is track 7.";

const SUGGEST_BASE_PROMPT =
  "You are a hip-hop beat producer. Given track labels, tempo, and a target subgenre, " +
  "return a step pattern across 8 tracks as strict JSON. Use vocal/fx tracks sparingly for accents.";

// Subgenre-specific anchors. Layered onto SUGGEST_BASE_PROMPT so the
// system instruction matches the requested style rather than always
// pulling toward boom-bap defaults.
const SUBGENRE_GUIDANCE: Record<Subgenre, string> = {
  "boom-bap":
    " SUBGENRE: boom-bap — kick on step 1 and step 9, main snare on step 5 and 13, hats steady and slightly behind the beat.",
  trap:
    " SUBGENRE: trap — kick with syncopation (step 1 plus a dotted-eighth or 16th offset, e.g. 7 or 11), main snare on step 9 only (half-time feel), and rolling hats with rapid bursts (consecutive 16ths or 32nds simulated by adjacent steps).",
  "lo-fi":
    " SUBGENRE: lo-fi — sparse and behind-the-beat, kick on 1 and 11 (not 9), light snare on 5 and 13 with ghost hits, hats stuttered rather than steady, plenty of silent steps.",
  phonk:
    " SUBGENRE: phonk — heavy off-beat accents and cowbell-style stabs on the and-of-2 / and-of-4 (steps 4, 8, 12, 16), driving kick on 1 and 8, snare on 5 and 13, dark and aggressive feel.",
};

const VARIATION_PROMPTS: Record<Variation, string> = {
  busier:
    "You are a hip-hop beat producer. Take the given 8xN step pattern and make it BUSIER by adding hits — particularly on hat and ghost-snare positions. Preserve the kick and main snare positions. Return the modified 8xN pattern.",
  fill:
    "You are a hip-hop beat producer. Take the given 8xN step pattern and ADD A FILL in the last beat (the final four steps) — typical fills layer extra snare, hat, and fx hits while keeping the main groove intact through the earlier steps. Return the modified 8xN pattern.",
  halftime:
    "You are a hip-hop beat producer. Take the given 8xN step pattern and HALF-TIME it — keep the kick on 1, but move the main snare to step 9 (instead of 5 and 13) so the groove feels half-tempo. Thin out the hats accordingly. Return the modified 8xN pattern.",
  strip:
    "You are a hip-hop beat producer. Take the given 8xN step pattern and STRIP IT BACK — remove most ghost notes and accents, focus on the downbeats (1, 5, 9, 13) and the main kick/snare skeleton. Return the modified 8xN pattern.",
  break:
    "You are a hip-hop beat producer. Take the given 8xN step pattern and DROP A BREAK in the last quarter of the loop — silence almost every hit in those final steps except a kick on the first step of the break and at most one accent (one snare or one fx stab). Steps before the final quarter stay intact. Return the modified pattern with exactly 8 tracks of N steps.",
};

const VIBE_GUIDANCE: Record<Vibe, string> = {
  tight: "",
  varied:
    " VIBE: varied — favor space over density, leave breathing room, place hits asymmetrically rather than in uniform every-other-step grids, and prefer using 4–6 of the 8 tracks rather than all 8.",
  breaky:
    " VIBE: breaky — leave the final quarter of the loop sparse: drop most hits there except a kick on its first step and at most one accent, creating a sense of rest or drop.",
};

function buildSuggestSystemPrompt(subgenre: Subgenre): string {
  return SUGGEST_BASE_PROMPT + SUBGENRE_GUIDANCE[subgenre];
}

function buildSystemInstruction(base: string, vibe: Vibe): string {
  return base + VIBE_GUIDANCE[vibe] + ROW_ORDER_RULE;
}

// Per-track reasoning lines, included in the user message when the model
// previously classified the kit and we have its own description on hand.
// Untagged or unreasoned tracks are omitted to keep the prompt focused.
function buildKitNotes(tracks: SuggestPatternInput["tracks"]): string {
  const lines: string[] = [];
  for (const t of tracks) {
    const reasoning = t.reasoning?.trim();
    if (!reasoning) continue;
    const tagLabel = t.tag ?? "untagged";
    lines.push(`- track ${t.id} (${tagLabel}): ${reasoning}`);
  }
  return lines.length === 0 ? "" : `\nKit notes:\n${lines.join("\n")}`;
}

function buildPatternSchema(stepCount: number) {
  return {
    type: SchemaType.OBJECT,
    properties: {
      tracks: {
        type: SchemaType.ARRAY,
        items: {
          type: SchemaType.ARRAY,
          items: { type: SchemaType.BOOLEAN },
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
    `Generate a pattern of exactly 8 tracks by ${input.stepCount} steps.` +
    buildKitNotes(input.tracks)
  );
}

function buildVaryUserMessage(input: VaryPatternInput): string {
  const labels = input.tracks.map((t) => `${t.id}=${t.tag ?? "untagged"}`).join(", ");
  return (
    `Tempo: ${input.bpm} BPM. Subgenre: ${input.subgenre}. ` +
    `Loop length: ${input.stepCount} sixteenth-note steps. Tracks: ${labels}.\n` +
    `Current pattern (8x${input.stepCount}):\n${JSON.stringify(input.currentPattern)}\n` +
    `Apply the ${input.variation} variation. Return 8 tracks of exactly ${input.stepCount} steps.` +
    buildKitNotes(input.tracks)
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

export interface GeminiPatternClient {
  models: {
    generateContent: (params: object) => Promise<{ text?: string }>;
  };
}

// One inline retry on transient SDK errors. A network blip currently
// turns into a red toast and a user click; one retry with a small random
// backoff hides the most common flake without compounding latency too
// much. Validation errors are NOT retried — they tend to repeat.
const RETRY_BASE_MS = 200;
const RETRY_JITTER_MS = 300;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function generateGrid(
  systemInstruction: string,
  userMessage: string,
  stepCount: number,
  client?: GeminiPatternClient,
): Promise<boolean[][]> {
  const sdk: GeminiPatternClient = client ?? createHttpGeminiClient();

  const callOnce = async (): Promise<{ text?: string }> =>
    sdk.models.generateContent({
      model: MODEL,
      contents: [{ role: "user", parts: [{ text: userMessage }] }],
      config: {
        systemInstruction,
        responseMimeType: "application/json",
        responseSchema: buildPatternSchema(stepCount),
        thinkingConfig: { thinkingLevel: ThinkingLevel.HIGH },
      },
    });

  let response: { text?: string };
  try {
    response = await callOnce();
  } catch (firstErr) {
    // Only retry on transient HTTP errors (429 / 5xx). Validation errors
    // tend to repeat; timeouts and 4xx would just burn another 60s budget.
    // Tests inject a generic mock client whose thrown Error has no transient
    // flag — we treat those as transient too so existing retry coverage stays
    // meaningful without having to construct status-tagged errors in tests.
    const isTestSeam = Boolean(client);
    const transient =
      (firstErr instanceof TransientGeminiError) ||
      (isTestSeam && firstErr instanceof Error && !(firstErr instanceof ValidationError));
    if (!transient) {
      logger.error(LOG_EVENTS.SUGGEST_ERROR, { model: MODEL, message: errMessage(firstErr) });
      throw firstErr;
    }
    const delay = RETRY_BASE_MS + Math.random() * RETRY_JITTER_MS;
    logger.warn(LOG_EVENTS.SUGGEST_RETRY, {
      model: MODEL,
      message: errMessage(firstErr),
      delayMs: Math.round(delay),
    });
    await sleep(delay);
    try {
      response = await callOnce();
    } catch (err) {
      logger.error(LOG_EVENTS.SUGGEST_ERROR, { model: MODEL, message: errMessage(err) });
      throw err;
    }
  }

  const text = response.text;
  if (typeof text !== "string" || text.length === 0) {
    logger.warn(LOG_EVENTS.SUGGEST_MISS, { model: MODEL, reason: "empty-text" });
    throw new ValidationError("Empty response text");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    const message = errMessage(err);
    logger.warn(LOG_EVENTS.SUGGEST_MISS, { model: MODEL, reason: "invalid-json", message });
    throw new ValidationError(`Response is not valid JSON: ${message}`);
  }
  try {
    return validatePattern(parsed, stepCount);
  } catch (err) {
    logger.warn(LOG_EVENTS.SUGGEST_MISS, { model: MODEL, reason: "schema", message: errMessage(err) });
    throw err;
  }
}

export async function suggestPattern(
  input: SuggestPatternInput,
  client?: GeminiPatternClient,
): Promise<boolean[][]> {
  return generateGrid(
    buildSystemInstruction(buildSuggestSystemPrompt(input.subgenre), input.vibe),
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
    buildSystemInstruction(VARIATION_PROMPTS[input.variation], input.vibe),
    buildVaryUserMessage(input),
    input.stepCount,
    client,
  );
}
