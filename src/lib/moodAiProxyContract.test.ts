// ABOUTME: Contract tests — the REAL Mood AI request bodies must be accepted
// ABOUTME: by the REAL /api/gemini handler, including the max-size case.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const audioMocks = vi.hoisted(() => ({
  context: {
    state: "running" as AudioContextState,
    currentTime: 0,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
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

import {
  __resetGeminiProxyForTesting,
  __setGeminiRateLimitStoreForTesting,
  GEMINI_TOKEN_HEADER,
  handleGeminiRequest,
  handleGeminiTokenRequest,
  MAX_BODY_BYTES,
  type GeminiRateLimitStore,
} from "../../api/gemini";
import { syncAssist, MOOD_SYNC_TOTAL_BYTES_MAX } from "./moodSyncAssist";
import { classifyPart } from "./moodPartTag";
import type { MoodTake } from "../types";

const ALLOWED_ORIGIN = "https://hyperactive.example";
const SAME_ORIGIN_FETCH_HEADERS = {
  "sec-fetch-site": "same-origin",
  "sec-fetch-mode": "cors",
  "sec-fetch-dest": "empty",
};

class DurableTestStore implements GeminiRateLimitStore {
  counts = new Map<string, number>();

  async increment(key: string): Promise<{ count: number; resetAt: number }> {
    const count = (this.counts.get(key) ?? 0) + 1;
    this.counts.set(key, count);
    return { count, resetAt: Date.now() + 60_000 };
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function signedRequest(body: string): Promise<Request> {
  const tokenRes = await handleGeminiTokenRequest(
    new Request(`${ALLOWED_ORIGIN}/api/gemini-token`, {
      method: "POST",
      headers: {
        origin: ALLOWED_ORIGIN,
        "x-forwarded-for": "203.0.113.10",
        ...SAME_ORIGIN_FETCH_HEADERS,
      },
    }),
  );
  expect(tokenRes.status).toBe(200);
  const tokenBody = (await tokenRes.json()) as { token?: string };
  return new Request(`${ALLOWED_ORIGIN}/api/gemini`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: ALLOWED_ORIGIN,
      "x-forwarded-for": "203.0.113.10",
      ...SAME_ORIGIN_FETCH_HEADERS,
      [GEMINI_TOKEN_HEADER]: String(tokenBody.token),
    },
    body,
  });
}

function makeBuffer(durationSeconds: number, sampleRate = 1000): AudioBuffer {
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
  const durationSeconds = 1.5;
  return {
    id: "take-contract",
    videoBlob: new Blob([new Uint8Array([1])], { type: "video/webm" }),
    audioBlob: null,
    posterBlob: null,
    url: "blob:test/take-contract",
    audioBuffer: makeBuffer(durationSeconds),
    audioStatus: "ok",
    posterUrl: null,
    trimStartMs: 0,
    trimEndMs: durationSeconds * 1000,
    durationSeconds,
    cycleMultiple: 1,
    syncOffsetMs: 0,
    part: null,
    partSource: null,
    recordedAt: 1,
    ...overrides,
  };
}

// Captures the params each helper actually builds — the wire body is
// JSON.stringify(params) (aiHttpClient.postGeminiProxy).
async function captureRealBody(run: (client: {
  models: { generateContent: (params: object) => Promise<{ text?: string }> };
}) => Promise<unknown>): Promise<string> {
  let captured: object | null = null;
  await run({
    models: {
      generateContent: async (params: object) => {
        captured = params;
        return { text: JSON.stringify({ offsetMs: 10, confidence: 1, part: "lead" }) };
      },
    },
  });
  if (!captured) throw new Error("helper never issued a request");
  return JSON.stringify(captured);
}

describe("mood AI proxy contract", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn().mockResolvedValue(
      jsonResponse({ candidates: [{ content: { parts: [{ text: "{}" }] } }] }),
    );
    vi.stubGlobal("fetch", fetchSpy);
    vi.stubEnv("GEMINI_API_KEY", "test-api-key");
    vi.stubEnv("GEMINI_ALLOWED_ORIGINS", ALLOWED_ORIGIN);
    vi.stubEnv("GEMINI_RATE_LIMIT_MAX", "10");
    __setGeminiRateLimitStoreForTesting(new DurableTestStore());
  });

  afterEach(() => {
    __resetGeminiProxyForTesting();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("accepts the real Sync Assist request body", async () => {
    const body = await captureRealBody((client) =>
      syncAssist(makeTake(), makeBuffer(1.5), 1.5, client),
    );

    const res = await handleGeminiRequest(await signedRequest(body));
    expect(res.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("accepts the real Part Tags request body", async () => {
    const body = await captureRealBody((client) => classifyPart(makeTake(), client));

    const res = await handleGeminiRequest(await signedRequest(body));
    expect(res.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("keeps the combined Sync Assist payload budget inside the proxy body cap", async () => {
    // The client-side combined guard plus framing headroom must stay under
    // the proxy's whole-body limit — this pins the cross-module contract.
    expect(MOOD_SYNC_TOTAL_BYTES_MAX + 128 * 1024).toBeLessThanOrEqual(MAX_BODY_BYTES);

    // A request AT the combined budget is accepted by the real handler.
    const half = Math.floor(MOOD_SYNC_TOTAL_BYTES_MAX / 2);
    const inline = "A".repeat(half - 1024);
    const body = JSON.stringify({
      model: "gemini-3.1-flash-lite",
      contents: [
        {
          role: "user",
          parts: [
            { inlineData: { mimeType: "audio/wav", data: inline } },
            { inlineData: { mimeType: "audio/wav", data: inline } },
            { text: "max-size contract case" },
          ],
        },
      ],
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: "OBJECT",
          properties: {
            offsetMs: { type: "NUMBER" },
            confidence: { type: "NUMBER" },
          },
          required: ["offsetMs", "confidence"],
        },
      },
    });
    expect(body.length).toBeLessThanOrEqual(MAX_BODY_BYTES);

    const res = await handleGeminiRequest(await signedRequest(body));
    expect(res.status).toBe(200);
  });
});
