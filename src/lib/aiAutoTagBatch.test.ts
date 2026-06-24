// ABOUTME: aiAutoTagBatch tests — multi-clip request shape, response validation, fail-open paths.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ThinkingLevel } from "./aiSchemaConstants";
import {
  autoTagBatch,
  validateBatchAutoTag,
  BATCH_TAG_MODEL,
  BATCH_INLINE_BYTES_MAX,
  type GeminiClient,
} from "./aiAutoTagBatch";
import { clearLogs, getLogs } from "./logger";

function fakeBuffer(durationSec = 2): AudioBuffer {
  const sampleRate = 48000;
  const length = Math.round(sampleRate * durationSec);
  return {
    sampleRate,
    length,
    duration: length / sampleRate,
    numberOfChannels: 1,
    getChannelData: () => new Float32Array(length),
    copyFromChannel: () => undefined,
    copyToChannel: () => undefined,
  } as unknown as AudioBuffer;
}

describe("validateBatchAutoTag", () => {
  it("accepts a well-formed array and rejects shape mismatches", () => {
    const ok = validateBatchAutoTag(
      [
        { index: 0, tag: "kick", confidence: 0.9 },
        { index: 1, tag: "hat", confidence: 0.7, reasoning: "bright" },
      ],
      2,
    );
    expect(ok).toEqual([
      { index: 0, tag: "kick", confidence: 0.9, reasoning: undefined },
      { index: 1, tag: "hat", confidence: 0.7, reasoning: "bright" },
    ]);

    expect(validateBatchAutoTag([{ index: 0, tag: "drums", confidence: 0.9 }], 1)).toBeNull();
    expect(validateBatchAutoTag([{ index: 0, tag: "kick", confidence: 1.5 }], 1)).toBeNull();
    expect(validateBatchAutoTag([{ index: 0, tag: "kick", confidence: 0.5 }], 2)).toBeNull();
    expect(validateBatchAutoTag(null, 0)).toBeNull();
  });
});

describe("autoTagBatch", () => {
  beforeEach(() => {
    clearLogs();
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    clearLogs();
  });

  it("happy path: sends one inlineData part per clip + thinkingLevel HIGH; sorts results by trackId", async () => {
    type Captured = {
      model?: string;
      contents?: Array<{ parts: Array<Record<string, unknown>> }>;
      config?: { thinkingConfig?: { thinkingLevel?: unknown } };
    };
    let captured: Captured = {};
    const client: GeminiClient = {
      models: {
        generateContent: vi.fn(async (params: object) => {
          captured = params as Captured;
          return {
            text: JSON.stringify([
              { index: 0, tag: "kick", confidence: 0.9 },
              { index: 1, tag: "hat", confidence: 0.7 },
            ]),
          };
        }),
      },
    };

    const result = await autoTagBatch(
      [
        { trackId: 5, audioBuffer: fakeBuffer() },
        { trackId: 2, audioBuffer: fakeBuffer() },
      ],
      client,
    );
    // Sorted ascending by trackId: index 0 → trackId 2, index 1 → trackId 5.
    expect(result).toEqual([
      { trackId: 2, tag: "kick", confidence: 0.9, reasoning: undefined },
      { trackId: 5, tag: "hat", confidence: 0.7, reasoning: undefined },
    ]);
    expect(BATCH_TAG_MODEL).toBe("gemini-3.1-flash-lite");
    expect(captured.model).toBe("gemini-3.1-flash-lite");
    expect(captured.config?.thinkingConfig?.thinkingLevel).toBe(ThinkingLevel.HIGH);
    const parts = (captured.contents ?? [])[0]?.parts ?? [];
    expect(parts.filter((p) => "inlineData" in p)).toHaveLength(2);
  });

  it("fails open before transport when the estimated inline payload exceeds the proxy cap", async () => {
    expect(BATCH_INLINE_BYTES_MAX).toBeLessThanOrEqual(3 * 1024 * 1024);
    const generateContent = vi.fn(async () => ({ text: "[]" }));

    const result = await autoTagBatch([{ trackId: 0, audioBuffer: fakeBuffer(30) }], {
      models: { generateContent },
    });

    expect(result).toBeNull();
    expect(generateContent).not.toHaveBeenCalled();
    const miss = getLogs().find((l) => l.event === "batchtag.miss");
    expect((miss?.payload as { reason?: string })?.reason).toBe("payload-too-large");
  });

  it("fails open across error branches: schema-invalid response, SDK throw, no key, empty input", async () => {
    // 1. Schema-invalid JSON.
    expect(
      await autoTagBatch([{ trackId: 0, audioBuffer: fakeBuffer() }], {
        models: {
          generateContent: vi.fn(async () => ({ text: JSON.stringify([{ index: 0, tag: "drums", confidence: 0.9 }]) })),
        },
      }),
    ).toBeNull();
    expect(getLogs().some((l) => l.event === "batchtag.miss")).toBe(true);

    clearLogs();
    // 2. SDK throw.
    expect(
      await autoTagBatch([{ trackId: 0, audioBuffer: fakeBuffer() }], {
        models: { generateContent: vi.fn(async () => { throw new Error("network down"); }) },
      }),
    ).toBeNull();
    expect(getLogs().some((l) => l.event === "batchtag.error")).toBe(true);

    clearLogs();
    // 3. Empty input bails before any work.
    expect(await autoTagBatch([])).toBeNull();

    clearLogs();
    // 4. Transport surfaces MissingApiKeyError → batchtag.miss with reason no-key.
    const { MissingApiKeyError } = await import("./aiErrors");
    expect(
      await autoTagBatch([{ trackId: 0, audioBuffer: fakeBuffer() }], {
        models: { generateContent: vi.fn(async () => { throw new MissingApiKeyError(); }) },
      }),
    ).toBeNull();
    const noKey = getLogs().find((l) => l.event === "batchtag.miss");
    expect((noKey?.payload as { reason?: string })?.reason).toBe("no-key");
  });
});
