// ABOUTME: moodSyncAssist — asks Gemini to refine Mood take alignment against the One.
// ABOUTME: Slices inline WAV windows and fails open with quiet logger events on any AI issue.
import type { MoodTake } from "../types";
import { GeminiOfflineError, MissingApiKeyError } from "./aiErrors";
import { SchemaType } from "./aiSchemaConstants";
import {
  blobToBase64,
  errMessage,
  isAbortError,
  runWithSignal,
} from "./aiClient";
import { createHttpGeminiClient } from "./aiHttpClient";
import { sliceAudioBuffer } from "./audioBufferSlice";
import { logger, LOG_EVENTS } from "./logger";
import { audioBufferToWav } from "./wavEncoder";

export const MOOD_SYNC_MODEL = "gemini-3.1-flash-lite";
export const MOOD_SYNC_CONFIDENCE_THRESHOLD = 0.6;
export const MOOD_SYNC_OFFSET_LIMIT_MS = 250;
export const MOOD_SYNC_INLINE_BYTES_MAX = 3 * 1024 * 1024;
// The proxy hard-caps the WHOLE request body (api/gemini.ts MAX_BODY_BYTES,
// 4 MiB); the two inline WAVs share it, so their combined base64 stays under
// it with headroom for JSON framing and the prompt. The relationship is
// pinned by the proxy contract test.
export const MOOD_SYNC_TOTAL_BYTES_MAX = 3.5 * 1024 * 1024;

const BASE64_INFLATION = 4 / 3;

const SYNC_PROMPT =
  "You are Sync Assist for a browser music video looper. " +
  "The first audio file is a newly recorded take. The second audio file is the One reference for the same cycle. " +
  "Estimate how many milliseconds the new take should be nudged so its musical start lands with the One. " +
  "Return JSON only with offsetMs and confidence. Positive offsetMs means start the take later; negative means earlier. " +
  "Use confidence 0..1 for how clearly the transient, groove, or vocal entry aligns.";

export interface MoodSyncAssistResult {
  offsetMs: number;
  confidence: number;
}

export interface GeminiClient {
  models: {
    generateContent: (params: object) => Promise<{ text?: string }>;
  };
}

export function validateMoodSyncAssist(value: unknown): MoodSyncAssistResult | null {
  if (!value || typeof value !== "object") return null;
  const v = value as { offsetMs?: unknown; confidence?: unknown };
  if (typeof v.offsetMs !== "number" || !Number.isFinite(v.offsetMs)) return null;
  if (
    typeof v.confidence !== "number" ||
    !Number.isFinite(v.confidence) ||
    v.confidence < 0 ||
    v.confidence > 1
  ) {
    return null;
  }
  return { offsetMs: v.offsetMs, confidence: v.confidence };
}

function clampOffsetMs(offsetMs: number): number {
  return Math.max(-MOOD_SYNC_OFFSET_LIMIT_MS, Math.min(MOOD_SYNC_OFFSET_LIMIT_MS, offsetMs));
}

function estimatedBase64Bytes(buffer: AudioBuffer): number {
  return Math.ceil((buffer.length * 2 + 44) * BASE64_INFLATION);
}

function logMiss(reason: string, payload: Record<string, unknown> = {}): void {
  logger.warn(LOG_EVENTS.MOOD_SYNC_MISS, { reason, model: MOOD_SYNC_MODEL, ...payload });
}

function cycleWindowForTake(take: MoodTake, cycleSeconds: number): AudioBuffer | null {
  if (take.audioStatus !== "ok" || !take.audioBuffer) return null;
  const cycleMs = Math.max(0, cycleSeconds * 1000);
  if (!Number.isFinite(cycleMs) || cycleMs <= 0) return null;
  const startMs = Math.max(0, take.trimStartMs);
  const endMs = Math.max(startMs, Math.min(take.trimEndMs, startMs + cycleMs));
  return sliceAudioBuffer(take.audioBuffer, startMs, endMs);
}

async function encodeInlineWav(buffer: AudioBuffer): Promise<string | null> {
  const estimatedBytes = estimatedBase64Bytes(buffer);
  if (estimatedBytes > MOOD_SYNC_INLINE_BYTES_MAX) {
    logMiss("payload-too-large", { estimatedBytes, limit: MOOD_SYNC_INLINE_BYTES_MAX });
    return null;
  }
  const base64 = await blobToBase64(audioBufferToWav(buffer));
  if (base64.length > MOOD_SYNC_INLINE_BYTES_MAX) {
    logMiss("payload-too-large", { estimatedBytes: base64.length, limit: MOOD_SYNC_INLINE_BYTES_MAX });
    return null;
  }
  return base64;
}

export async function syncAssist(
  take: MoodTake,
  oneSlice: AudioBuffer,
  cycleSeconds: number,
  // Test seam — bypasses the real HTTP transport so unit tests don't hit /api/gemini.
  client?: GeminiClient,
  signal?: AbortSignal,
): Promise<MoodSyncAssistResult | null> {
  try {
    if (signal?.aborted) return null;

    const takeSlice = cycleWindowForTake(take, cycleSeconds);
    if (!takeSlice) {
      logMiss("missing-audio", { takeId: take.id });
      return null;
    }
    const cycleMs = Math.max(0, cycleSeconds * 1000);
    if (!Number.isFinite(cycleMs) || cycleMs <= 0) {
      logMiss("invalid-cycle", { cycleSeconds });
      return null;
    }
    const referenceSlice = sliceAudioBuffer(oneSlice, 0, cycleMs);
    const combinedEstimated =
      estimatedBase64Bytes(takeSlice) + estimatedBase64Bytes(referenceSlice);
    if (combinedEstimated > MOOD_SYNC_TOTAL_BYTES_MAX) {
      logMiss("payload-too-large", {
        estimatedBytes: combinedEstimated,
        limit: MOOD_SYNC_TOTAL_BYTES_MAX,
      });
      return null;
    }
    const takeBase64 = await encodeInlineWav(takeSlice);
    if (!takeBase64) return null;
    const oneBase64 = await encodeInlineWav(referenceSlice);
    if (!oneBase64) return null;

    const sdk: GeminiClient = client ?? createHttpGeminiClient();
    const startedAt = Date.now();
    const response = await runWithSignal(
      sdk.models.generateContent({
        model: MOOD_SYNC_MODEL,
        contents: [
          {
            role: "user",
            parts: [
              { inlineData: { mimeType: "audio/wav", data: takeBase64 } },
              { inlineData: { mimeType: "audio/wav", data: oneBase64 } },
              { text: SYNC_PROMPT },
            ],
          },
        ],
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: SchemaType.OBJECT,
            properties: {
              offsetMs: { type: SchemaType.NUMBER },
              confidence: { type: SchemaType.NUMBER },
            },
            required: ["offsetMs", "confidence"],
          },
        },
      }),
      signal,
    );

    const latencyMs = Date.now() - startedAt;
    const text = response.text;
    if (typeof text !== "string" || text.length === 0) {
      logMiss("empty-text", { latencyMs });
      return null;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      logMiss("invalid-json", { latencyMs, text });
      return null;
    }

    const validated = validateMoodSyncAssist(parsed);
    if (!validated) {
      logMiss("schema", { latencyMs, parsed });
      return null;
    }
    if (validated.confidence < MOOD_SYNC_CONFIDENCE_THRESHOLD) {
      logger.warn(LOG_EVENTS.MOOD_SYNC_BELOW_THRESHOLD, {
        model: MOOD_SYNC_MODEL,
        confidence: validated.confidence,
        threshold: MOOD_SYNC_CONFIDENCE_THRESHOLD,
        latencyMs,
      });
      return null;
    }

    const result = { ...validated, offsetMs: clampOffsetMs(validated.offsetMs) };
    logger.info(LOG_EVENTS.MOOD_SYNC_RESULT, {
      model: MOOD_SYNC_MODEL,
      offsetMs: result.offsetMs,
      confidence: result.confidence,
      latencyMs,
    });
    return result;
  } catch (err) {
    if (isAbortError(err)) return null;
    if (err instanceof MissingApiKeyError) {
      logMiss("no-key");
      return null;
    }
    if (err instanceof GeminiOfflineError) {
      logMiss("offline");
      return null;
    }
    logMiss("error", { message: errMessage(err) });
    return null;
  }
}
