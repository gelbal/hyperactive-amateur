// ABOUTME: moodSyncAssist tests — pins Gemini proxy request shape and fail-open sync refinement.
// ABOUTME: Covers clamp, confidence threshold, payload guard, and quiet AI error handling.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GeminiOfflineError, MissingApiKeyError } from "./aiErrors";
import { clearLogs, getLogs } from "./logger";
import {
  MOOD_SYNC_CONFIDENCE_THRESHOLD,
  MOOD_SYNC_INLINE_BYTES_MAX,
  MOOD_SYNC_MODEL,
  syncAssist,
  validateMoodSyncAssist,
  type GeminiClient,
} from "./moodSyncAssist";
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

function makeBuffer(durationSeconds = 1, sampleRate = 1000): AudioBuffer {
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
    id: "take-sync",
    videoBlob: new Blob([new Uint8Array([1])], { type: "video/webm" }),
    audioBlob: new Blob([new Uint8Array([2])], { type: "audio/wav" }),
    posterBlob: null,
    url: "blob:test/take-sync",
    audioBuffer,
    audioStatus: "ok",
    posterUrl: null,
    trimStartMs: 250,
    trimEndMs: 1750,
    durationSeconds: 1.5,
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

describe("validateMoodSyncAssist", () => {
  it("accepts valid response shapes and rejects schema mismatches", () => {
    expect(validateMoodSyncAssist({ offsetMs: -12.5, confidence: 0.75 })).toEqual({
      offsetMs: -12.5,
      confidence: 0.75,
    });
    expect(validateMoodSyncAssist({ startOffsetMs: 20, confidence: 0.8 })).toBeNull();
    expect(validateMoodSyncAssist({ offsetMs: 20, confidence: 1.2 })).toBeNull();
    expect(validateMoodSyncAssist(null)).toBeNull();
  });
});

describe("syncAssist", () => {
  beforeEach(() => {
    clearLogs();
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    audioMocks.context.createBuffer.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    clearLogs();
  });

  it("sends two inline wavs through the proxy-safe schema and clamps high-confidence offsets", async () => {
    type Captured = {
      model?: string;
      contents?: Array<{ role?: string; parts?: Array<Record<string, unknown>> }>;
      config?: Record<string, unknown>;
    };
    let captured: Captured = {};
    const client = makeClient(async (params) => {
      captured = params as Captured;
      return { text: JSON.stringify({ offsetMs: 400, confidence: 0.91 }) };
    });

    const result = await syncAssist(makeTake(), makeBuffer(1), 1, client);

    expect(result).toEqual({ offsetMs: 250, confidence: 0.91 });
    expect(MOOD_SYNC_MODEL).toBe("gemini-3.1-flash-lite");
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
        offsetMs: { type: "NUMBER" },
        confidence: { type: "NUMBER" },
      },
      required: ["offsetMs", "confidence"],
    });

    const parts = captured.contents?.[0]?.parts ?? [];
    expect(captured.contents?.[0]?.role).toBe("user");
    expect(parts.filter((part) => "inlineData" in part)).toHaveLength(2);
    expect(
      parts
        .filter((part) => "inlineData" in part)
        .map((part) => (part.inlineData as { mimeType?: string; data?: string }).mimeType),
    ).toEqual(["audio/wav", "audio/wav"]);
    expect(
      parts
        .filter((part) => "inlineData" in part)
        .every((part) => typeof (part.inlineData as { data?: unknown }).data === "string"),
    ).toBe(true);
    expect(parts.some((part) => typeof part.text === "string" && part.text.includes("One"))).toBe(
      true,
    );
  });

  it("drops below-threshold responses without applying an offset", async () => {
    expect(MOOD_SYNC_CONFIDENCE_THRESHOLD).toBe(0.6);

    const result = await syncAssist(
      makeTake(),
      makeBuffer(1),
      1,
      makeClient(async () => ({ text: JSON.stringify({ offsetMs: 80, confidence: 0.59 }) })),
    );

    expect(result).toBeNull();
    const log = getLogs().find((entry) => entry.event === "mood-sync.below-threshold");
    expect((log?.payload as { confidence?: number })?.confidence).toBe(0.59);
  });

  it("fails open before transport when either inline wav would exceed the proxy budget", async () => {
    expect(MOOD_SYNC_INLINE_BYTES_MAX).toBeLessThanOrEqual(3 * 1024 * 1024);
    const generateContent = vi.fn(async () => ({ text: JSON.stringify({ offsetMs: 0, confidence: 1 }) }));

    const result = await syncAssist(
      makeTake({ audioBuffer: makeBuffer(30, 48_000), trimStartMs: 0, trimEndMs: 30_000 }),
      makeBuffer(1),
      30,
      { models: { generateContent } },
    );

    expect(result).toBeNull();
    expect(generateContent).not.toHaveBeenCalled();
    const log = getLogs().find((entry) => entry.event === "mood-sync.miss");
    expect((log?.payload as { reason?: string })?.reason).toBe("payload-too-large");
  });

  it("fails open quietly for malformed responses, missing keys, and network loss", async () => {
    expect(
      await syncAssist(
        makeTake(),
        makeBuffer(1),
        1,
        makeClient(async () => ({ text: "not json {{" })),
      ),
    ).toBeNull();
    expect(getLogs()).toHaveLength(1);
    expect(getLogs()[0]?.event).toBe("mood-sync.miss");

    clearLogs();
    expect(
      await syncAssist(
        makeTake(),
        makeBuffer(1),
        1,
        makeClient(async () => {
          throw new MissingApiKeyError();
        }),
      ),
    ).toBeNull();
    expect(getLogs()).toHaveLength(1);
    expect((getLogs()[0]?.payload as { reason?: string })?.reason).toBe("no-key");

    clearLogs();
    expect(
      await syncAssist(
        makeTake(),
        makeBuffer(1),
        1,
        makeClient(async () => {
          throw new GeminiOfflineError();
        }),
      ),
    ).toBeNull();
    expect(getLogs()).toHaveLength(1);
    expect((getLogs()[0]?.payload as { reason?: string })?.reason).toBe("offline");
    expect(console.error).not.toHaveBeenCalled();
  });
});
