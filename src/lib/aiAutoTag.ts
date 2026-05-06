// ABOUTME: aiAutoTag — classify a recorded clip via Gemini 3 Flash Preview.
// ABOUTME: Returns null on any failure (network, schema, missing key) so callers can fail open.
import { GoogleGenAI, Type } from "@google/genai";
import type { Tag } from "../types";
import { audioBufferToWav } from "./wavEncoder";

export const AUTO_TAG_MODEL = "gemini-3-flash-preview";

const TAG_VALUES: Tag[] = ["kick", "snare", "hat", "vocal", "fx"];

const CLASSIFICATION_PROMPT =
  "Classify this short audio sample for a hip-hop step sequencer. Listen to the sound and pick exactly one tag:\n" +
  "- kick: low-frequency thump or boom (mouth, chest hit, sub bass)\n" +
  "- snare: mid-frequency crack or slap (claps, tongue pops, table hits with brightness)\n" +
  "- hat: high-frequency tick or hiss (ts, sh, finger snaps)\n" +
  "- vocal: any voiced sound, word, syllable, or extended tone (yeah, uh, hm, sung note)\n" +
  "- fx: anything else or ambiguous (whooshes, weird noises, breaths)\n\n" +
  "Return your best guess with a confidence score 0-1 reflecting how clearly the audio matches that category.";

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

export function readGeminiApiKey(): string | undefined {
  return (import.meta.env.VITE_GEMINI_API_KEY as string | undefined) || undefined;
}

async function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error ?? new Error("FileReader failed"));
    reader.readAsDataURL(blob);
  });
}

function isTag(v: unknown): v is Tag {
  return typeof v === "string" && (TAG_VALUES as string[]).includes(v);
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
  // Test seam — bypasses SDK construction so unit tests don't need a key.
  client?: GeminiClient,
): Promise<AutoTagResult | null> {
  try {
    const apiKey = client ? "test-key" : readGeminiApiKey();
    if (!client && !apiKey) return null;

    const wav = audioBufferToWav(audioBuffer);
    const base64 = await blobToBase64(wav);

    const sdk: GeminiClient =
      client ??
      (new GoogleGenAI({ apiKey: apiKey! }) as unknown as GeminiClient);

    const response = await sdk.models.generateContent({
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
          type: Type.OBJECT,
          properties: {
            tag: {
              type: Type.STRING,
              enum: TAG_VALUES as unknown as string[],
            },
            confidence: { type: Type.NUMBER },
            reasoning: { type: Type.STRING },
          },
          required: ["tag", "confidence"],
        },
      },
    });

    const text = response.text;
    if (typeof text !== "string" || text.length === 0) return null;
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return null;
    }
    return validateAutoTag(parsed);
  } catch {
    return null;
  }
}
