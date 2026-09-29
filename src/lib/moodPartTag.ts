// ABOUTME: moodPartTag — asks Gemini to classify Mood takes into vocal part roles.
// ABOUTME: Sends one trimmed inline WAV and fails open with quiet logger events.
import { GEMINI_MODEL } from "./aiModel";
import {
  MOOD_CREDIT_PALETTE_IDS,
  MOOD_FX_PRESET_IDS,
  MOOD_KEY_IDS,
  type MoodArtDirection,
  type MoodKeyEstimate,
  type MoodKeyMode,
  type MoodPart,
  type MoodTake,
} from "../types";
import { GeminiOfflineError, MissingApiKeyError } from "./aiErrors";
import { blobToBase64, errMessage, isAbortError, runWithSignal } from "./aiClient";
import { createHttpGeminiClient } from "./aiHttpClient";
import { SchemaType } from "./aiSchemaConstants";
import { sliceAudioBuffer } from "./audioBufferSlice";
import { logger, LOG_EVENTS } from "./logger";
import { audioBufferToWav } from "./wavEncoder";

const MOOD_PARTS = ["lead", "harmony", "bass", "beatbox", "adlib"] as const satisfies readonly MoodPart[];

export const MOOD_PART_MODEL = GEMINI_MODEL;
export const MOOD_PART_CONFIDENCE_THRESHOLD = 0.6;
export const MOOD_KEY_CONFIDENCE_THRESHOLD = 0.6;
export const MOOD_PART_INLINE_BYTES_MAX = 3 * 1024 * 1024;

const BASE64_INFLATION = 4 / 3;

const PART_PROMPT =
  "You are Part Tags for a browser music video looper. " +
  "Classify the take as exactly one vocal part: lead, harmony, bass, beatbox, or adlib. " +
  "Use lead for the main sung or spoken hook, harmony for supporting pitched vocals, bass for low vocal bass, " +
  "beatbox for mouth percussion, and adlib for short hype, texture, or non-main vocal sounds. " +
  "Return JSON only with part and confidence. Use confidence 0..1 for how clearly the take fits the chosen part.";

const ONE_DIRECTION_PROMPT =
  " This is the piece-setting first loop, the One. Also return fxPreset, creditPalette, key, mode, and keyConfidence. Choose neutral, sweep, or wash for fxPreset: neutral keeps the current balance, sweep closes the Drop deeper with modest Echo feedback, and wash keeps the Drop lighter with more Echo trail. " +
  "Choose signal, print, or heat for creditPalette: signal is the current orange/red contrast, print is paper and ink, and heat is warm ember color. " +
  "Estimate key as one chromatic note name, mode as major or minor, and keyConfidence from 0..1.";

interface MoodPartTagResult {
  part: MoodPart;
  confidence: number;
  artDirection?: MoodArtDirection;
  keyEstimate?: MoodKeyEstimate;
}

export interface GeminiClient {
  models: {
    generateContent: (params: object) => Promise<{ text?: string }>;
  };
}

function isMoodPart(value: unknown): value is MoodPart {
  return typeof value === "string" && (MOOD_PARTS as readonly string[]).includes(value);
}

function isEnumValue<T extends string>(value: unknown, allowed: readonly T[]): value is T {
  return typeof value === "string" && allowed.includes(value as T);
}

function isConfidence(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

export function validateMoodPartTag(
  value: unknown,
  isOne = false,
): MoodPartTagResult | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (!isMoodPart(v.part)) return null;
  if (!isConfidence(v.confidence)) return null;

  const result: MoodPartTagResult = { part: v.part, confidence: v.confidence };
  if (!isOne) return result;

  if (
    isEnumValue(v.fxPreset, MOOD_FX_PRESET_IDS) &&
    isEnumValue(v.creditPalette, MOOD_CREDIT_PALETTE_IDS)
  ) {
    result.artDirection = {
      fxPreset: v.fxPreset,
      creditPalette: v.creditPalette,
      source: "ai",
    };
  }
  if (
    isEnumValue(v.key, MOOD_KEY_IDS) &&
    isEnumValue(v.mode, ["major", "minor"] as const satisfies readonly MoodKeyMode[]) &&
    isConfidence(v.keyConfidence) &&
    v.keyConfidence >= MOOD_KEY_CONFIDENCE_THRESHOLD
  ) {
    result.keyEstimate = {
      key: v.key,
      mode: v.mode,
      confidence: v.keyConfidence,
    };
  }
  return result;
}

function estimatedBase64Bytes(buffer: AudioBuffer): number {
  return Math.ceil((buffer.length * 2 + 44) * BASE64_INFLATION);
}

function logMiss(reason: string, payload: Record<string, unknown> = {}): void {
  logger.warn(LOG_EVENTS.MOOD_PART_MISS, { reason, model: MOOD_PART_MODEL, ...payload });
}

function trimmedWindowForTake(take: MoodTake): AudioBuffer | null {
  if (take.audioStatus !== "ok" || !take.audioBuffer) return null;
  const startMs = Math.max(0, take.trimStartMs);
  const endMs = Math.max(startMs, take.trimEndMs);
  return sliceAudioBuffer(take.audioBuffer, startMs, endMs);
}

async function encodeInlineWav(buffer: AudioBuffer): Promise<string | null> {
  const estimatedBytes = estimatedBase64Bytes(buffer);
  if (estimatedBytes > MOOD_PART_INLINE_BYTES_MAX) {
    logMiss("payload-too-large", { estimatedBytes, limit: MOOD_PART_INLINE_BYTES_MAX });
    return null;
  }
  const base64 = await blobToBase64(audioBufferToWav(buffer));
  if (base64.length > MOOD_PART_INLINE_BYTES_MAX) {
    logMiss("payload-too-large", { estimatedBytes: base64.length, limit: MOOD_PART_INLINE_BYTES_MAX });
    return null;
  }
  return base64;
}

export async function classifyPart(
  take: MoodTake,
  isOne = false,
  // Test seam — bypasses the real HTTP transport so unit tests don't hit /api/gemini.
  client?: GeminiClient,
  signal?: AbortSignal,
): Promise<MoodPartTagResult | null> {
  try {
    if (signal?.aborted) return null;

    const takeSlice = trimmedWindowForTake(take);
    if (!takeSlice) {
      logMiss("missing-audio", { takeId: take.id });
      return null;
    }
    const takeBase64 = await encodeInlineWav(takeSlice);
    if (!takeBase64) return null;

    const sdk: GeminiClient = client ?? createHttpGeminiClient();
    const startedAt = Date.now();
    const response = await runWithSignal(
      sdk.models.generateContent({
        model: MOOD_PART_MODEL,
        contents: [
          {
            role: "user",
            parts: [
              { inlineData: { mimeType: "audio/wav", data: takeBase64 } },
              { text: isOne ? PART_PROMPT + ONE_DIRECTION_PROMPT : PART_PROMPT },
            ],
          },
        ],
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: SchemaType.OBJECT,
            properties: {
              part: {
                type: SchemaType.STRING,
                enum: [...MOOD_PARTS],
              },
              confidence: { type: SchemaType.NUMBER },
              ...(isOne
                ? {
                    fxPreset: {
                      type: SchemaType.STRING,
                      enum: [...MOOD_FX_PRESET_IDS],
                    },
                    creditPalette: {
                      type: SchemaType.STRING,
                      enum: [...MOOD_CREDIT_PALETTE_IDS],
                    },
                    key: {
                      type: SchemaType.STRING,
                      enum: [...MOOD_KEY_IDS],
                    },
                    mode: {
                      type: SchemaType.STRING,
                      enum: ["major", "minor"],
                    },
                    keyConfidence: { type: SchemaType.NUMBER },
                  }
                : {}),
            },
            required: isOne
              ? [
                  "part",
                  "confidence",
                  "fxPreset",
                  "creditPalette",
                  "key",
                  "mode",
                  "keyConfidence",
                ]
              : ["part", "confidence"],
          },
        },
      }),
      signal,
    );

    const latencyMs = Date.now() - startedAt;
    const text = response.text;
    if (typeof text !== "string" || text.length === 0) {
      logMiss("empty-text", { takeId: take.id, latencyMs });
      return null;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      logMiss("invalid-json", { takeId: take.id, latencyMs, text });
      return null;
    }

    const validated = validateMoodPartTag(parsed, isOne);
    if (!validated) {
      logMiss("schema", { takeId: take.id, latencyMs, parsed });
      return null;
    }
    if (validated.confidence < MOOD_PART_CONFIDENCE_THRESHOLD) {
      logger.warn(LOG_EVENTS.MOOD_PART_BELOW_THRESHOLD, {
        model: MOOD_PART_MODEL,
        part: validated.part,
        confidence: validated.confidence,
        threshold: MOOD_PART_CONFIDENCE_THRESHOLD,
        latencyMs,
      });
      return null;
    }

    logger.info(LOG_EVENTS.MOOD_PART_RESULT, {
      model: MOOD_PART_MODEL,
      part: validated.part,
      confidence: validated.confidence,
      latencyMs,
    });
    if (validated.artDirection) {
      logger.info(LOG_EVENTS.MOOD_ART_RESULT, {
        model: MOOD_PART_MODEL,
        fxPreset: validated.artDirection.fxPreset,
        creditPalette: validated.artDirection.creditPalette,
        latencyMs,
      });
    }
    if (validated.keyEstimate) {
      logger.info(LOG_EVENTS.MOOD_KEY_RESULT, {
        model: MOOD_PART_MODEL,
        key: validated.keyEstimate.key,
        mode: validated.keyEstimate.mode,
        confidence: validated.keyEstimate.confidence,
        latencyMs,
      });
    }
    return validated;
  } catch (err) {
    if (isAbortError(err)) return null;
    if (err instanceof MissingApiKeyError) {
      logMiss("no-key", { takeId: take.id });
      return null;
    }
    if (err instanceof GeminiOfflineError) {
      logMiss("offline", { takeId: take.id });
      return null;
    }
    logMiss("error", { takeId: take.id, message: errMessage(err) });
    return null;
  }
}
