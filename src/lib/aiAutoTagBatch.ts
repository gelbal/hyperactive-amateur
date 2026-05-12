// ABOUTME: aiAutoTagBatch — classify multiple recorded clips holistically in a single Gemini call.
// ABOUTME: Returns null on any failure so callers (retagAll) can fall back to per-clip auto-tag.
import { TAGS, type Tag } from "../types";
import { audioBufferToWav } from "./wavEncoder";
import { logger, LOG_EVENTS } from "./logger";
import { SchemaType, ThinkingLevel } from "./aiSchemaConstants";
import { createHttpGeminiClient } from "./aiHttpClient";
import { MissingApiKeyError } from "./aiErrors";
import {
  blobToBase64,
  errMessage,
  isAbortError,
  runWithSignal,
  TAG_DEFINITIONS_BLOCK,
} from "./aiClient";

export const BATCH_TAG_MODEL = "gemini-3.1-flash-lite";

// Soft cap on the total base64-encoded inline payload. The Gemini inline limit
// is ~20 MB; we leave a wide margin for the JSON-schema overhead and headers.
const BATCH_INLINE_BYTES_MAX = 12 * 1024 * 1024;

// base64 inflates raw bytes by ~4/3. Used for the pre-encode size check.
const BASE64_INFLATION = 4 / 3;

const HOLISTIC_PROMPT =
  "You are tagging the sounds in a hip-hop step sequencer. " +
  "There are {{count}} short audio samples below, indexed 0..{{count}}-1 in the order provided. " +
  "Listen to all of them as a kit and assign each one to exactly one tag from " +
  "{kick, snare, hat, vocal, fx}. Use the sounds' relative pitch, brightness, " +
  "length, and attack — not absolute thresholds. Distribute roles sensibly " +
  "(a typical kit has at least one kick and one hat, and bright ticks become hats). " +
  "Tag definitions:\n" +
  TAG_DEFINITIONS_BLOCK +
  "\n\nReturn a JSON array of {index, tag, confidence (0..1), reasoning} with one entry per input.";

export interface BatchAutoTagInput {
  trackId: number;
  audioBuffer: AudioBuffer;
}

export interface BatchAutoTagItem {
  trackId: number;
  tag: Tag;
  confidence: number;
  reasoning?: string;
}

export interface GeminiClient {
  models: {
    generateContent: (params: object) => Promise<{ text?: string }>;
  };
}

interface RawBatchEntry {
  index: number;
  tag: Tag;
  confidence: number;
  reasoning: string | undefined;
}

function isTag(v: unknown): v is Tag {
  return typeof v === "string" && (TAGS as readonly string[]).includes(v);
}

export function validateBatchAutoTag(value: unknown, expectedCount: number): RawBatchEntry[] | null {
  if (!Array.isArray(value)) return null;
  if (value.length !== expectedCount) return null;
  const seenIndex = new Set<number>();
  const out: RawBatchEntry[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") return null;
    const v = item as { index?: unknown; tag?: unknown; confidence?: unknown; reasoning?: unknown };
    if (typeof v.index !== "number" || !Number.isInteger(v.index)) return null;
    if (v.index < 0 || v.index >= expectedCount) return null;
    if (seenIndex.has(v.index)) return null;
    seenIndex.add(v.index);
    if (!isTag(v.tag)) return null;
    if (typeof v.confidence !== "number" || v.confidence < 0 || v.confidence > 1) return null;
    out.push({
      index: v.index,
      tag: v.tag,
      confidence: v.confidence,
      reasoning: typeof v.reasoning === "string" ? v.reasoning : undefined,
    });
  }
  return out;
}

function estimateBase64Bytes(items: BatchAutoTagInput[]): number {
  // 16-bit PCM mono WAV: samples × 2 + ~44 byte header. Then base64 inflates ~4/3.
  let raw = 0;
  for (const it of items) raw += it.audioBuffer.length * 2 + 44;
  return Math.ceil(raw * BASE64_INFLATION);
}

export async function autoTagBatch(
  items: BatchAutoTagInput[],
  client?: GeminiClient,
  signal?: AbortSignal,
): Promise<BatchAutoTagItem[] | null> {
  if (items.length === 0) {
    logger.warn(LOG_EVENTS.BATCHTAG_MISS, { reason: "empty-input", model: BATCH_TAG_MODEL });
    return null;
  }
  try {
    if (signal?.aborted) return null;

    const sorted = items.slice().sort((a, b) => a.trackId - b.trackId);

    const estimatedBytes = estimateBase64Bytes(sorted);
    if (estimatedBytes > BATCH_INLINE_BYTES_MAX) {
      logger.warn(LOG_EVENTS.BATCHTAG_MISS, {
        reason: "payload-too-large",
        model: BATCH_TAG_MODEL,
        estimatedBytes,
        limit: BATCH_INLINE_BYTES_MAX,
      });
      return null;
    }

    const wavs = sorted.map((it) => audioBufferToWav(it.audioBuffer));
    const base64s = await Promise.all(wavs.map(blobToBase64));

    const sdk: GeminiClient = client ?? createHttpGeminiClient();

    const inlineParts = base64s.map((data) => ({
      inlineData: { mimeType: "audio/wav", data },
    }));
    const parts = [
      ...inlineParts,
      { text: HOLISTIC_PROMPT.replaceAll("{{count}}", String(sorted.length)) },
    ];

    logger.info(LOG_EVENTS.BATCHTAG_START, {
      model: BATCH_TAG_MODEL,
      count: sorted.length,
      estimatedBytes,
    });
    const startedAt = Date.now();

    const response = await runWithSignal(
      sdk.models.generateContent({
        model: BATCH_TAG_MODEL,
        contents: [{ role: "user", parts }],
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: SchemaType.ARRAY,
            items: {
              type: SchemaType.OBJECT,
              properties: {
                index: { type: SchemaType.INTEGER },
                tag: {
                  type: SchemaType.STRING,
                  enum: [...TAGS],
                },
                confidence: { type: SchemaType.NUMBER },
                reasoning: { type: SchemaType.STRING },
              },
              required: ["index", "tag", "confidence"],
            },
            minItems: sorted.length,
            maxItems: sorted.length,
          },
          thinkingConfig: { thinkingLevel: ThinkingLevel.HIGH },
        },
      }),
      signal,
    );

    const latencyMs = Date.now() - startedAt;
    const text = response.text;
    if (typeof text !== "string" || text.length === 0) {
      logger.warn(LOG_EVENTS.BATCHTAG_MISS, { reason: "empty-text", model: BATCH_TAG_MODEL, latencyMs });
      return null;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      logger.warn(LOG_EVENTS.BATCHTAG_MISS, { reason: "invalid-json", model: BATCH_TAG_MODEL, latencyMs, text });
      return null;
    }
    const validated = validateBatchAutoTag(parsed, sorted.length);
    if (!validated) {
      logger.warn(LOG_EVENTS.BATCHTAG_MISS, { reason: "schema", model: BATCH_TAG_MODEL, latencyMs, parsed });
      return null;
    }

    const out: BatchAutoTagItem[] = validated
      .slice()
      .sort((a, b) => a.index - b.index)
      .map((entry) => ({
        trackId: sorted[entry.index].trackId,
        tag: entry.tag,
        confidence: entry.confidence,
        reasoning: entry.reasoning,
      }));

    logger.info(LOG_EVENTS.BATCHTAG_RESULT, {
      model: BATCH_TAG_MODEL,
      latencyMs,
      items: out.map((o) => ({ trackId: o.trackId, tag: o.tag, confidence: o.confidence })),
    });
    return out;
  } catch (err) {
    if (isAbortError(err)) return null;
    if (err instanceof MissingApiKeyError) {
      logger.warn(LOG_EVENTS.BATCHTAG_MISS, { reason: "no-key", model: BATCH_TAG_MODEL });
      return null;
    }
    logger.error(LOG_EVENTS.BATCHTAG_ERROR, { model: BATCH_TAG_MODEL, message: errMessage(err) });
    return null;
  }
}
