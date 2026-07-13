// ABOUTME: moodPartTag — asks Gemini to classify Mood takes into vocal part roles.
// ABOUTME: Sends one trimmed inline WAV and fails open with quiet logger events.
import type { MoodPart, MoodTake } from "../types";
import { GeminiOfflineError, MissingApiKeyError } from "./aiErrors";
import { blobToBase64, errMessage, isAbortError, runWithSignal } from "./aiClient";
import { createHttpGeminiClient } from "./aiHttpClient";
import { SchemaType } from "./aiSchemaConstants";
import { sliceAudioBuffer } from "./audioBufferSlice";
import { logger, LOG_EVENTS } from "./logger";
import { audioBufferToWav } from "./wavEncoder";

const MOOD_PARTS = ["lead", "harmony", "bass", "beatbox", "adlib"] as const satisfies readonly MoodPart[];

export const MOOD_PART_MODEL = "gemini-3.1-flash-lite";
export const MOOD_PART_CONFIDENCE_THRESHOLD = 0.6;
export const MOOD_PART_INLINE_BYTES_MAX = 3 * 1024 * 1024;

const BASE64_INFLATION = 4 / 3;

const PART_PROMPT =
  "You are Part Tags for a browser music video looper. " +
  "Classify the take as exactly one vocal part: lead, harmony, bass, beatbox, or adlib. " +
  "Use lead for the main sung or spoken hook, harmony for supporting pitched vocals, bass for low vocal bass, " +
  "beatbox for mouth percussion, and adlib for short hype, texture, or non-main vocal sounds. " +
  "Return JSON only with part and confidence. Use confidence 0..1 for how clearly the take fits the chosen part.";

export interface MoodPartTagResult {
  part: MoodPart;
  confidence: number;
}

export interface GeminiClient {
  models: {
    generateContent: (params: object) => Promise<{ text?: string }>;
  };
}

function isMoodPart(value: unknown): value is MoodPart {
  return typeof value === "string" && (MOOD_PARTS as readonly string[]).includes(value);
}

export function validateMoodPartTag(value: unknown): MoodPartTagResult | null {
  if (!value || typeof value !== "object") return null;
  const v = value as { part?: unknown; confidence?: unknown };
  if (!isMoodPart(v.part)) return null;
  if (
    typeof v.confidence !== "number" ||
    !Number.isFinite(v.confidence) ||
    v.confidence < 0 ||
    v.confidence > 1
  ) {
    return null;
  }
  return { part: v.part, confidence: v.confidence };
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
              { text: PART_PROMPT },
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
            },
            required: ["part", "confidence"],
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

    const validated = validateMoodPartTag(parsed);
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
