// ABOUTME: moodPartTag tests — pins Gemini request shape for Mood vocal part classification.
// ABOUTME: Covers confidence gating, fail-open behavior, and real-store manual override doctrine.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MissingApiKeyError } from "./aiErrors";
import { clearLogs, getLogs } from "./logger";
import {
  classifyPart,
  MOOD_PART_CONFIDENCE_THRESHOLD,
  MOOD_PART_MODEL,
  validateMoodPartTag,
  type GeminiClient,
} from "./moodPartTag";
import { useAppStore } from "../store/useAppStore";
import type { MoodTake } from "../types";

const audioMocks = vi.hoisted(() => ({
  context: {
    createBuffer: vi.fn((channels: number, length: number, sampleRate: number) => {
      const data = Array.from({ length: channels }, () => new Float32Array(length));
      return {
        duration: length / sampleRate,
        length,
        numberOfChannels: channels,
        sampleRate,
        getChannelData: (channel: number) => data[channel],
      } as unknown as AudioBuffer;
    }),
  },
}));

vi.mock("./audio", () => ({
  getAudioContext: () => audioMocks.context,
}));

function makeBuffer(durationSeconds = 2, sampleRate = 1000): AudioBuffer {
  const length = Math.max(1, Math.round(durationSeconds * sampleRate));
  const data = new Float32Array(length);
  for (let i = 0; i < length; i += 1) data[i] = Math.sin(i / 10) * 0.25;
  return {
    duration: length / sampleRate,
    length,
    numberOfChannels: 1,
    sampleRate,
    getChannelData: () => data,
  } as unknown as AudioBuffer;
}

function makeTake(overrides: Partial<MoodTake> = {}): MoodTake {
  const audioBuffer = overrides.audioBuffer ?? makeBuffer(2);
  return {
    id: "take-part",
    videoBlob: new Blob([new Uint8Array([1])], { type: "video/webm" }),
    audioBlob: new Blob([new Uint8Array([2])], { type: "audio/wav" }),
    posterBlob: null,
    url: "blob:test/take-part",
    audioBuffer,
    audioStatus: "ok",
    posterUrl: null,
    trimStartMs: 500,
    trimEndMs: 1500,
    durationSeconds: 1,
    cycleMultiple: 1,
    syncOffsetMs: 0,
    part: null,
    partSource: null,
    recordedAt: 1,
    ...overrides,
  };
}

function makeClient(behavior: (params: object) => Promise<{ text?: string }>): GeminiClient {
  return { models: { generateContent: vi.fn(behavior) } };
}

describe("validateMoodPartTag", () => {
  it("accepts valid response shapes and rejects bad parts or confidence", () => {
    expect(validateMoodPartTag({ part: "beatbox", confidence: 0.82 })).toEqual({
      part: "beatbox",
      confidence: 0.82,
    });
    expect(validateMoodPartTag({ part: "drums", confidence: 0.82 })).toBeNull();
    expect(validateMoodPartTag({ part: "lead", confidence: 1.2 })).toBeNull();
    expect(validateMoodPartTag(null)).toBeNull();
  });
});

describe("classifyPart", () => {
  beforeEach(() => {
    clearLogs();
    useAppStore.getState().actions.reset();
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    audioMocks.context.createBuffer.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    clearLogs();
    useAppStore.getState().actions.reset();
  });

  it("sends one trimmed inline wav through the proxy-safe enum schema", async () => {
    type Captured = {
      model?: string;
      contents?: Array<{ role?: string; parts?: Array<Record<string, unknown>> }>;
      config?: Record<string, unknown>;
    };
    let captured: Captured = {};
    const client = makeClient(async (params) => {
      captured = params as Captured;
      return { text: JSON.stringify({ part: "beatbox", confidence: 0.86 }) };
    });

    const result = await classifyPart(makeTake(), client);

    expect(result).toEqual({ part: "beatbox", confidence: 0.86 });
    expect(MOOD_PART_MODEL).toBe("gemini-3.1-flash-lite");
    expect(captured.model).toBe("gemini-3.1-flash-lite");
    expect(Object.keys(captured.config ?? {}).sort()).toEqual([
      "responseMimeType",
      "responseSchema",
    ]);
    expect(captured.config?.responseMimeType).toBe("application/json");
    expect(captured.config).not.toHaveProperty("thinkingConfig");
    expect(captured.config?.responseSchema).toMatchObject({
      type: "OBJECT",
      properties: {
        part: {
          type: "STRING",
          enum: ["lead", "harmony", "bass", "beatbox", "adlib"],
        },
        confidence: { type: "NUMBER" },
      },
      required: ["part", "confidence"],
    });

    const parts = captured.contents?.[0]?.parts ?? [];
    expect(captured.contents?.[0]?.role).toBe("user");
    expect(parts.filter((part) => "inlineData" in part)).toHaveLength(1);
    expect((parts[0].inlineData as { mimeType?: string; data?: string }).mimeType).toBe(
      "audio/wav",
    );
    expect(typeof (parts[0].inlineData as { data?: unknown }).data).toBe("string");
    expect(parts.some((part) => typeof part.text === "string" && part.text.includes("lead"))).toBe(
      true,
    );
    expect(audioMocks.context.createBuffer).toHaveBeenCalledWith(1, 1000, 1000);
  });

  it("drops below-threshold responses without applying a part", async () => {
    expect(MOOD_PART_CONFIDENCE_THRESHOLD).toBe(0.6);

    const result = await classifyPart(
      makeTake(),
      makeClient(async () => ({ text: JSON.stringify({ part: "lead", confidence: 0.59 }) })),
    );

    expect(result).toBeNull();
    const log = getLogs().find((entry) => entry.event === "mood-part.below-threshold");
    expect((log?.payload as { confidence?: number })?.confidence).toBe(0.59);
  });

  it("fails open quietly for malformed responses, missing audio, and no key", async () => {
    const malformed = await classifyPart(
      makeTake(),
      makeClient(async () => ({ text: JSON.stringify({ part: "lead" }) })),
    );
    const missingAudio = await classifyPart(makeTake({ audioStatus: "unavailable", audioBuffer: null }));
    const noKey = await classifyPart(
      makeTake(),
      makeClient(async () => {
        throw new MissingApiKeyError();
      }),
    );

    expect(malformed).toBeNull();
    expect(missingAudio).toBeNull();
    expect(noKey).toBeNull();
    expect(getLogs().some((entry) => entry.event === "mood-part.miss")).toBe(true);
  });

  it("keeps manual part picks when an ai result arrives later through the real store", () => {
    useAppStore.getState().actions.createMoodPiece("corners", "pocket");
    useAppStore.getState().actions.setMoodTake("mic-0", makeTake());
    const expectedRevision = useAppStore.getState().session.moodRevision;

    expect(
      useAppStore
        .getState()
        .actions.applyMoodPartIfCurrent("mic-0", "take-part", "harmony", "user", expectedRevision),
    ).toBe(true);
    expect(
      useAppStore
        .getState()
        .actions.applyMoodPartIfCurrent("mic-0", "take-part", "lead", "ai", expectedRevision),
    ).toBe(false);

    const take = useAppStore.getState().mood.piece?.mics[0].takes[0];
    expect(take?.part).toBe("harmony");
    expect(take?.partSource).toBe("user");
  });
});
