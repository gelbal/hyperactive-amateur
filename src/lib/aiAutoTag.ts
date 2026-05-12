// ABOUTME: aiAutoTag — classify a single recorded clip via Gemini 3.1 Flash Lite (default thinking level — batch path uses HIGH).
// ABOUTME: Returns null on any failure (network, schema, missing key, abort) so callers can fail open; observability via logger.
import { TAGS, type Tag } from "../types";
import { audioBufferToWav } from "./wavEncoder";
import { logger, LOG_EVENTS } from "./logger";
import { SchemaType } from "./aiSchemaConstants";
import { createHttpGeminiClient } from "./aiHttpClient";
import { MissingApiKeyError } from "./aiErrors";
import {
  blobToBase64,
  errMessage,
  isAbortError,
  runWithSignal,
  TAG_DEFINITIONS_BLOCK,
} from "./aiClient";

export const AUTO_TAG_MODEL = "gemini-3.1-flash-lite";

// Minimum confidence required before an auto-tag result is written to a track.
// Below this, the result is logged but discarded — both the per-record flow
// and the holistic re-tag flow honor this same threshold.
export const AUTO_TAG_CONFIDENCE_THRESHOLD = 0.6;

const CLASSIFICATION_PROMPT =
  "Classify this short audio sample for a hip-hop step sequencer. Listen to the sound and pick exactly one tag:\n" +
  TAG_DEFINITIONS_BLOCK +
  "\n\nReturn your best guess with a confidence score 0-1 reflecting how clearly the audio matches that category.";

export interface AutoTagResult {
  tag: Tag;
  confidence: number;
  reasoning?: string;
}

export interface GeminiClient {
  models: {
    generateContent: (params: object) => Promise<{ text?: string }>;
  };
}

function isTag(v: unknown): v is Tag {
  return typeof v === "string" && (TAGS as readonly string[]).includes(v);
}

export function validateAutoTag(value: unknown): AutoTagResult | null {
  if (!value || typeof value !== "object") return null;
  const v = value as { tag?: unknown; confidence?: unknown; reasoning?: unknown };
  if (!isTag(v.tag)) return null;
  if (typeof v.confidence !== "number" || v.confidence < 0 || v.confidence > 1) return null;
  return {
    tag: v.tag,
    confidence: v.confidence,
    reasoning: typeof v.reasoning === "string" ? v.reasoning : undefined,
  };
}

export async function autoTag(
  audioBuffer: AudioBuffer,
  // Test seam — bypasses the real HTTP transport so unit tests don't hit /api/gemini.
  client?: GeminiClient,
  // Optional cancellation. The proxy forwards req.signal to the upstream Gemini
  // call, so abort propagates end-to-end — but runWithSignal stays as the
  // promise-level cancellation glue, since fetch+signal doesn't reject the
  // already-returned promise once the response has begun streaming.
  signal?: AbortSignal,
): Promise<AutoTagResult | null> {
  const audioMs = Math.round(audioBuffer.duration * 1000);
  try {
    if (signal?.aborted) return null;

    const wav = audioBufferToWav(audioBuffer);
    const base64 = await blobToBase64(wav);

    const sdk: GeminiClient = client ?? createHttpGeminiClient();

    logger.info(LOG_EVENTS.AUTOTAG_START, { model: AUTO_TAG_MODEL, audioMs });
    const startedAt = Date.now();

    const response = await runWithSignal(
      sdk.models.generateContent({
        model: AUTO_TAG_MODEL,
        contents: [
          {
            role: "user",
            parts: [
              { inlineData: { mimeType: "audio/wav", data: base64 } },
              { text: CLASSIFICATION_PROMPT },
            ],
          },
        ],
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: SchemaType.OBJECT,
            properties: {
              tag: {
                type: SchemaType.STRING,
                enum: [...TAGS],
              },
              confidence: { type: SchemaType.NUMBER },
              reasoning: { type: SchemaType.STRING },
            },
            required: ["tag", "confidence"],
          },
          // Per-clip classification is a 5-way choice over one short sample —
          // the model doesn't need extended thinking for that. The holistic
          // batch path keeps ThinkingLevel.HIGH because it balances roles
          // across the whole kit at once.
        },
      }),
      signal,
    );

    const latencyMs = Date.now() - startedAt;
    const text = response.text;
    if (typeof text !== "string" || text.length === 0) {
      logger.warn(LOG_EVENTS.AUTOTAG_MISS, { reason: "empty-text", model: AUTO_TAG_MODEL, latencyMs });
      return null;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      logger.warn(LOG_EVENTS.AUTOTAG_MISS, { reason: "invalid-json", model: AUTO_TAG_MODEL, latencyMs, text });
      return null;
    }
    const validated = validateAutoTag(parsed);
    if (!validated) {
      logger.warn(LOG_EVENTS.AUTOTAG_MISS, { reason: "schema", model: AUTO_TAG_MODEL, latencyMs, parsed });
      return null;
    }
    logger.info(LOG_EVENTS.AUTOTAG_RESULT, {
      model: AUTO_TAG_MODEL,
      tag: validated.tag,
      confidence: validated.confidence,
      reasoning: validated.reasoning,
      latencyMs,
    });
    return validated;
  } catch (err) {
    if (isAbortError(err)) return null;
    if (err instanceof MissingApiKeyError) {
      logger.warn(LOG_EVENTS.AUTOTAG_MISS, { reason: "no-key", model: AUTO_TAG_MODEL });
      return null;
    }
    logger.error(LOG_EVENTS.AUTOTAG_ERROR, { model: AUTO_TAG_MODEL, message: errMessage(err) });
    return null;
  }
}
