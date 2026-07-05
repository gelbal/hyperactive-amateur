import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import geminiRoute, {
  __resetGeminiProxyForTesting,
  __setGeminiRateLimitStoreForTesting,
  GEMINI_TOKEN_HEADER,
  handleGeminiRequest,
  handleGeminiTokenRequest,
  MAX_BODY_BYTES,
  withCrashBoundary,
  type GeminiRateLimitStore,
} from "./gemini";
import geminiTokenRoute from "./gemini-token";

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

function request(body: unknown, headers: Record<string, string> = {}): Request {
  const payload = typeof body === "string" ? body : JSON.stringify(body);
  return new Request(`${ALLOWED_ORIGIN}/api/gemini`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: ALLOWED_ORIGIN,
      "x-forwarded-for": "203.0.113.10",
      ...headers,
    },
    body: payload,
  });
}

async function responseJson(res: Response): Promise<{ error?: string; [key: string]: unknown }> {
  return (await res.json()) as { error?: string; [key: string]: unknown };
}

async function signedRequest(body: unknown, headers: Record<string, string> = {}): Promise<Request> {
  const tokenRes = await handleGeminiTokenRequest(
    new Request(`${ALLOWED_ORIGIN}/api/gemini-token`, {
      method: "POST",
      headers: {
        origin: ALLOWED_ORIGIN,
        "x-forwarded-for": "203.0.113.10",
        ...SAME_ORIGIN_FETCH_HEADERS,
        ...headers,
      },
    }),
  );
  expect(tokenRes.status).toBe(200);
  const tokenBody = await responseJson(tokenRes);
  expect(typeof tokenBody.token).toBe("string");
  return request(body, {
    ...SAME_ORIGIN_FETCH_HEADERS,
    ...headers,
    [GEMINI_TOKEN_HEADER]: String(tokenBody.token),
  });
}

function patternSchema(stepCount = 16) {
  return {
    type: "OBJECT",
    properties: {
      tracks: {
        type: "ARRAY",
        items: {
          type: "ARRAY",
          items: { type: "BOOLEAN" },
          minItems: stepCount,
          maxItems: stepCount,
        },
        minItems: 8,
        maxItems: 8,
      },
    },
    required: ["tracks"],
  };
}

function autoTagSchema() {
  return {
    type: "OBJECT",
    properties: {
      tag: { type: "STRING", enum: ["kick", "snare", "hat", "vocal", "fx"] },
      confidence: { type: "NUMBER" },
      reasoning: { type: "STRING" },
    },
    required: ["tag", "confidence"],
  };
}

function batchSchema(count = 2) {
  return {
    type: "ARRAY",
    items: {
      type: "OBJECT",
      properties: {
        index: { type: "INTEGER" },
        tag: { type: "STRING", enum: ["kick", "snare", "hat", "vocal", "fx"] },
        confidence: { type: "NUMBER" },
        reasoning: { type: "STRING" },
      },
      required: ["index", "tag", "confidence"],
    },
    minItems: count,
    maxItems: count,
  };
}

function nestedSchema(depth: number): unknown {
  let schema: unknown = { type: "STRING" };
  for (let i = 0; i < depth; i += 1) {
    schema = { type: "ARRAY", items: schema };
  }
  return schema;
}

function expectedUpstreamBody(body: { contents: unknown; config?: Record<string, unknown> }) {
  const { systemInstruction, ...generationConfig } = body.config ?? {};
  const out: Record<string, unknown> = {
    contents: body.contents,
    generationConfig,
  };
  if (typeof systemInstruction === "string") {
    out.systemInstruction = { parts: [{ text: systemInstruction }] };
  } else if (systemInstruction !== undefined) {
    out.systemInstruction = systemInstruction;
  }
  return out;
}

function oversizedBody() {
  return JSON.stringify({
    ...suggestBody(),
    contents: [{ role: "user", parts: [{ text: "x".repeat(MAX_BODY_BYTES) }] }],
  });
}

function suggestBody() {
  return {
    model: "gemini-3.1-flash-lite",
    contents: [{ role: "user", parts: [{ text: "Tempo: 90 BPM. Generate 8x16." }] }],
    config: {
      systemInstruction: "You are a hip-hop beat producer.",
      responseMimeType: "application/json",
      responseSchema: patternSchema(),
      thinkingConfig: { thinkingLevel: "high" },
    },
  };
}

function variationBody() {
  return {
    model: "gemini-3.1-flash-lite",
    contents: [
      {
        role: "user",
        parts: [{ text: "Current pattern (8x16): [[false]]. Apply the fill variation." }],
      },
    ],
    config: {
      systemInstruction: "You are a hip-hop beat producer. Return the modified 8xN pattern.",
      responseMimeType: "application/json",
      responseSchema: patternSchema(),
      thinkingConfig: { thinkingLevel: "high" },
    },
  };
}

function autoTagBody() {
  return {
    model: "gemini-3.1-flash-lite",
    contents: [
      {
        role: "user",
        parts: [
          { inlineData: { mimeType: "audio/wav", data: "AAAA" } },
          { text: "Classify this short audio sample." },
        ],
      },
    ],
    config: {
      responseMimeType: "application/json",
      responseSchema: autoTagSchema(),
    },
  };
}

function batchAutoTagBody() {
  return {
    model: "gemini-3.1-flash-lite",
    contents: [
      {
        role: "user",
        parts: [
          { inlineData: { mimeType: "audio/wav", data: "AAAA" } },
          { inlineData: { mimeType: "audio/wav", data: "BBBB" } },
          { text: "Tag two short audio samples." },
        ],
      },
    ],
    config: {
      responseMimeType: "application/json",
      responseSchema: batchSchema(2),
      thinkingConfig: { thinkingLevel: "high" },
    },
  };
}

describe("handleGeminiRequest", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;
  let store: DurableTestStore;

  beforeEach(() => {
    fetchSpy = vi.fn().mockResolvedValue(
      jsonResponse({
        candidates: [{ content: { parts: [{ text: "{}" }] } }],
      }),
    );
    vi.stubGlobal("fetch", fetchSpy);
    vi.stubEnv("GEMINI_API_KEY", "test-api-key");
    vi.stubEnv("GEMINI_ALLOWED_ORIGINS", ALLOWED_ORIGIN);
    vi.stubEnv("GEMINI_RATE_LIMIT_MAX", "10");
    store = new DurableTestStore();
    __setGeminiRateLimitStoreForTesting(store);
  });

  afterEach(() => {
    __resetGeminiProxyForTesting();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("rejects non-POST requests with a stable code", async () => {
    const res = await handleGeminiRequest(
      new Request(`${ALLOWED_ORIGIN}/api/gemini`, {
        method: "GET",
        headers: { origin: ALLOWED_ORIGIN },
      }),
    );
    expect(res.status).toBe(405);
    expect(await responseJson(res)).toMatchObject({ error: "method-not-allowed" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects missing API key before calling upstream", async () => {
    vi.stubEnv("GEMINI_API_KEY", "");
    const res = await handleGeminiRequest(request(suggestBody()));
    expect(res.status).toBe(503);
    expect(await responseJson(res)).toMatchObject({ error: "no-key" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("issues a signed request token with a stable shape", async () => {
    const res = await handleGeminiTokenRequest(
      new Request(`${ALLOWED_ORIGIN}/api/gemini-token`, {
        method: "POST",
        headers: { origin: ALLOWED_ORIGIN },
      }),
    );
    expect(res.status).toBe(200);
    const body = await responseJson(res);
    expect(typeof body.token).toBe("string");
    expect(typeof body.expiresAt).toBe("number");
    expect(String(body.token).split(".")).toHaveLength(2);
  });

  it("rejects token requests when the API key is missing", async () => {
    vi.stubEnv("GEMINI_API_KEY", "");
    const res = await handleGeminiTokenRequest(
      new Request(`${ALLOWED_ORIGIN}/api/gemini-token`, {
        method: "POST",
        headers: { origin: ALLOWED_ORIGIN },
      }),
    );
    expect(res.status).toBe(503);
    expect(await responseJson(res)).toMatchObject({ error: "no-key" });
  });

  it("treats a blank request token secret as unset and falls back to the API key", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("GEMINI_REQUEST_TOKEN_SECRET", "   ");

    const res = await handleGeminiRequest(await signedRequest(suggestBody()));

    expect(res.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("rejects invalid JSON", async () => {
    const res = await handleGeminiRequest(request("{ nope"));
    expect(res.status).toBe(400);
    expect(await responseJson(res)).toMatchObject({ error: "invalid-json" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects non-object JSON bodies with a stable code", async () => {
    const res = await handleGeminiRequest(request("null"));
    expect(res.status).toBe(400);
    expect(await responseJson(res)).toMatchObject({ error: "invalid-body" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects models outside the app allowlist", async () => {
    const res = await handleGeminiRequest(
      request({ ...suggestBody(), model: "gemini-3.1-pro" }),
    );
    expect(res.status).toBe(400);
    expect(await responseJson(res)).toMatchObject({ error: "invalid-model" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects disallowed generation config keys and values", async () => {
    const res = await handleGeminiRequest(
      request({
        ...suggestBody(),
        config: { ...suggestBody().config, temperature: 2 },
      }),
    );
    expect(res.status).toBe(400);
    expect(await responseJson(res)).toMatchObject({ error: "invalid-config" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("enforces the serialized body cap even when Content-Length is understated", async () => {
    const res = await handleGeminiRequest(request(oversizedBody(), { "content-length": "1" }));
    expect(res.status).toBe(413);
    expect(await responseJson(res)).toMatchObject({ error: "body-too-large" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("keeps the proxy body cap below Vercel's production request limit", () => {
    expect(MAX_BODY_BYTES).toBeLessThanOrEqual(4 * 1024 * 1024);
  });

  it("rate-limits oversized body attempts before reading the full body", async () => {
    vi.stubEnv("GEMINI_RATE_LIMIT_MAX", "1");

    const first = await handleGeminiRequest(request(oversizedBody(), { "content-length": "1" }));
    expect(first.status).toBe(413);

    const second = await handleGeminiRequest(request(oversizedBody(), { "content-length": "1" }));
    expect(second.status).toBe(429);
    expect(await responseJson(second)).toMatchObject({ error: "rate-limit-exceeded" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("requires an Origin or Referer in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const res = await handleGeminiRequest(
      new Request(`${ALLOWED_ORIGIN}/api/gemini`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(suggestBody()),
      }),
    );
    expect(res.status).toBe(403);
    expect(await responseJson(res)).toMatchObject({ error: "origin-required" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("requires a signed request token in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const res = await handleGeminiRequest(request(suggestBody(), SAME_ORIGIN_FETCH_HEADERS));
    expect(res.status).toBe(401);
    expect(await responseJson(res)).toMatchObject({ error: "request-token-required" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rate-limits production request token issuance", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("GEMINI_RATE_LIMIT_MAX", "1");
    const tokenRequest = () =>
      new Request(`${ALLOWED_ORIGIN}/api/gemini-token`, {
        method: "POST",
        headers: {
          origin: ALLOWED_ORIGIN,
          "x-vercel-forwarded-for": "203.0.113.55",
          ...SAME_ORIGIN_FETCH_HEADERS,
        },
      });

    const first = await handleGeminiTokenRequest(tokenRequest());
    expect(first.status).toBe(200);

    const second = await handleGeminiTokenRequest(tokenRequest());
    expect(second.status).toBe(429);
    expect(await responseJson(second)).toMatchObject({ error: "rate-limit-exceeded" });
  });

  it("rate-limits repeated invalid production request tokens before upstream work", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("GEMINI_RATE_LIMIT_MAX", "1");
    const badHeaders = {
      ...SAME_ORIGIN_FETCH_HEADERS,
      "x-vercel-forwarded-for": "203.0.113.56",
      [GEMINI_TOKEN_HEADER]: "not.a.valid.token",
    };

    const first = await handleGeminiRequest(request(suggestBody(), badHeaders));
    expect(first.status).toBe(401);
    expect(await responseJson(first)).toMatchObject({ error: "invalid-request-token" });

    const second = await handleGeminiRequest(request(suggestBody(), badHeaders));
    expect(second.status).toBe(429);
    expect(await responseJson(second)).toMatchObject({ error: "rate-limit-exceeded" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("requires browser Fetch Metadata before issuing production request tokens", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const res = await handleGeminiTokenRequest(
      new Request(`${ALLOWED_ORIGIN}/api/gemini-token`, {
        method: "POST",
        headers: { origin: ALLOWED_ORIGIN },
      }),
    );
    expect(res.status).toBe(403);
    expect(await responseJson(res)).toMatchObject({ error: "browser-fetch-required" });
  });

  it("rejects a production request token bound to a different client identity", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const signed = await signedRequest(suggestBody(), { "x-vercel-forwarded-for": "198.51.100.1" });
    const res = await handleGeminiRequest(
      request(suggestBody(), {
        ...SAME_ORIGIN_FETCH_HEADERS,
        [GEMINI_TOKEN_HEADER]: signed.headers.get(GEMINI_TOKEN_HEADER) ?? "",
        "x-vercel-forwarded-for": "198.51.100.2",
      }),
    );
    expect(res.status).toBe(401);
    expect(await responseJson(res)).toMatchObject({ error: "invalid-request-token" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects disallowed origins in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const res = await handleGeminiRequest(request(suggestBody(), { origin: "https://evil.example" }));
    expect(res.status).toBe(403);
    expect(await responseJson(res)).toMatchObject({ error: "disallowed-origin" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("allows the Vercel production project URL without a manual origin entry", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("GEMINI_ALLOWED_ORIGINS", "");
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "hyperactive-amateur.fgelbal.com");
    const tokenRes = await handleGeminiTokenRequest(
      new Request("https://hyperactive-amateur.fgelbal.com/api/gemini-token", {
        method: "POST",
        headers: {
          origin: "https://hyperactive-amateur.fgelbal.com",
          "x-vercel-forwarded-for": "198.51.100.22",
          ...SAME_ORIGIN_FETCH_HEADERS,
        },
      }),
    );
    expect(tokenRes.status).toBe(200);
    const tokenBody = await responseJson(tokenRes);
    const res = await handleGeminiRequest(
      request(suggestBody(), {
        origin: "https://hyperactive-amateur.fgelbal.com",
        "x-vercel-forwarded-for": "198.51.100.22",
        ...SAME_ORIGIN_FETCH_HEADERS,
        [GEMINI_TOKEN_HEADER]: String(tokenBody.token),
      }),
    );
    expect(res.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("fails closed in production when only Origin is configured but no durable limiter exists", async () => {
    vi.stubEnv("NODE_ENV", "production");
    __setGeminiRateLimitStoreForTesting(null);
    const res = await handleGeminiRequest(request(suggestBody(), SAME_ORIGIN_FETCH_HEADERS));
    expect(res.status).toBe(503);
    expect(await responseJson(res)).toMatchObject({ error: "limiter-unconfigured" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects request bursts through the injected durable limiter across calls", async () => {
    vi.stubEnv("GEMINI_RATE_LIMIT_MAX", "1");
    const first = await handleGeminiRequest(request(suggestBody()));
    expect(first.status).toBe(200);

    const second = await handleGeminiRequest(request(suggestBody()));
    expect(second.status).toBe(429);
    expect(await responseJson(second)).toMatchObject({ error: "rate-limit-exceeded" });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("uses the Vercel client IP header instead of caller-supplied X-Forwarded-For in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("GEMINI_RATE_LIMIT_MAX", "1");
    const signed = await signedRequest(suggestBody(), {
      "x-forwarded-for": "198.51.100.1",
      "x-vercel-forwarded-for": "203.0.113.99",
    });
    const token = signed.headers.get(GEMINI_TOKEN_HEADER) ?? "";

    const first = await handleGeminiRequest(
      request(suggestBody(), {
        "x-forwarded-for": "198.51.100.1",
        "x-vercel-forwarded-for": "203.0.113.99",
        ...SAME_ORIGIN_FETCH_HEADERS,
        [GEMINI_TOKEN_HEADER]: token,
      }),
    );
    expect(first.status).toBe(200);

    const second = await handleGeminiRequest(
      request(suggestBody(), {
        "x-forwarded-for": "198.51.100.2",
        "x-vercel-forwarded-for": "203.0.113.99",
        ...SAME_ORIGIN_FETCH_HEADERS,
        [GEMINI_TOKEN_HEADER]: token,
      }),
    );
    expect(second.status).toBe(429);
    expect(await responseJson(second)).toMatchObject({ error: "rate-limit-exceeded" });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("uses the configured Upstash REST limiter in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://redis.example/");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "redis-token");
    __resetGeminiProxyForTesting();
    fetchSpy.mockReset();
    fetchSpy
      .mockResolvedValueOnce(jsonResponse([{ result: 1 }, { result: 1 }]))
      .mockResolvedValueOnce(jsonResponse([{ result: 1 }, { result: 1 }]))
      .mockResolvedValueOnce(
        jsonResponse({
          candidates: [{ content: { parts: [{ text: "{}" }] } }],
        }),
      );

    const res = await handleGeminiRequest(
      await signedRequest(suggestBody(), { "x-vercel-forwarded-for": "198.51.100.7" }),
    );

    expect(res.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(3);
    const [pipelineUrl, pipelineInit] = fetchSpy.mock.calls[1];
    expect(pipelineUrl).toBe("https://redis.example/pipeline");
    expect(pipelineInit.method).toBe("POST");
    expect(pipelineInit.headers).toMatchObject({
      authorization: "Bearer redis-token",
      "content-type": "application/json",
    });
    const commands = JSON.parse(pipelineInit.body);
    expect(commands[0][0]).toBe("INCR");
    expect(commands[0][1]).toContain("generate:https:__hyperactive.example:198.51.100.7");
    expect(commands[1]).toEqual(["EXPIRE", commands[0][1], "630"]);
  });

  it("rejects non-HTTPS production limiter URLs without sending the bearer token", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "http://redis.example/");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "redis-token");
    __resetGeminiProxyForTesting();
    fetchSpy.mockReset();

    const res = await handleGeminiRequest(request(suggestBody(), SAME_ORIGIN_FETCH_HEADERS));

    expect(res.status).toBe(503);
    expect(await responseJson(res)).toMatchObject({ error: "limiter-unconfigured" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("treats blank Upstash envs as unset and falls back to KV aliases", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "   ");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "");
    vi.stubEnv("KV_REST_API_URL", "https://kv.example/");
    vi.stubEnv("KV_REST_API_TOKEN", "kv-token");
    __resetGeminiProxyForTesting();
    fetchSpy.mockReset();
    fetchSpy
      .mockResolvedValueOnce(jsonResponse([{ result: 1 }, { result: 1 }]))
      .mockResolvedValueOnce(jsonResponse([{ result: 1 }, { result: 1 }]))
      .mockResolvedValueOnce(
        jsonResponse({
          candidates: [{ content: { parts: [{ text: "{}" }] } }],
        }),
      );

    const res = await handleGeminiRequest(
      await signedRequest(suggestBody(), { "x-vercel-forwarded-for": "198.51.100.8" }),
    );

    expect(res.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(3);
    const [pipelineUrl, pipelineInit] = fetchSpy.mock.calls[1];
    expect(pipelineUrl).toBe("https://kv.example/pipeline");
    expect(pipelineInit.headers).toMatchObject({
      authorization: "Bearer kv-token",
      "content-type": "application/json",
    });
  });

  it("does not mix a partial Upstash pair with KV credentials", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://redis.example/");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "");
    vi.stubEnv("KV_REST_API_URL", "https://kv.example/");
    vi.stubEnv("KV_REST_API_TOKEN", "kv-token");
    __resetGeminiProxyForTesting();
    fetchSpy.mockReset();
    fetchSpy
      .mockResolvedValueOnce(jsonResponse([{ result: 1 }, { result: 1 }]))
      .mockResolvedValueOnce(jsonResponse([{ result: 1 }, { result: 1 }]))
      .mockResolvedValueOnce(
        jsonResponse({
          candidates: [{ content: { parts: [{ text: "{}" }] } }],
        }),
      );

    const res = await handleGeminiRequest(
      await signedRequest(suggestBody(), { "x-vercel-forwarded-for": "198.51.100.9" }),
    );

    expect(res.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(3);
    const [pipelineUrl, pipelineInit] = fetchSpy.mock.calls[1];
    expect(pipelineUrl).toBe("https://kv.example/pipeline");
    expect(pipelineInit.headers).toMatchObject({
      authorization: "Bearer kv-token",
      "content-type": "application/json",
    });
  });

  it("returns a stable error when the configured Upstash limiter fails", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const tokenRes = await handleGeminiTokenRequest(
      new Request(`${ALLOWED_ORIGIN}/api/gemini-token`, {
        method: "POST",
        headers: {
          origin: ALLOWED_ORIGIN,
          "x-vercel-forwarded-for": "198.51.100.7",
          ...SAME_ORIGIN_FETCH_HEADERS,
        },
      }),
    );
    expect(tokenRes.status).toBe(200);
    const tokenBody = await responseJson(tokenRes);

    vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://redis.example");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "redis-token");
    __resetGeminiProxyForTesting();
    fetchSpy.mockReset();
    fetchSpy.mockResolvedValueOnce(jsonResponse([{ error: "backend failed" }]));

    const res = await handleGeminiRequest(
      request(suggestBody(), {
        "x-vercel-forwarded-for": "198.51.100.7",
        ...SAME_ORIGIN_FETCH_HEADERS,
        [GEMINI_TOKEN_HEADER]: String(tokenBody.token),
      }),
    );

    expect(res.status).toBe(503);
    expect(await responseJson(res)).toMatchObject({ error: "rate-limit-unavailable" });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it.each([
    [
      "too many content entries",
      () => ({
        ...suggestBody(),
        contents: Array.from({ length: 5 }, (_, index) => ({
          role: "user",
          parts: [{ text: `part ${index}` }],
        })),
      }),
      "invalid-contents",
    ],
    [
      "too many parts",
      () => ({
        ...suggestBody(),
        contents: [
          {
            role: "user",
            parts: Array.from({ length: 17 }, (_, index) => ({ text: `part ${index}` })),
          },
        ],
      }),
      "invalid-contents",
    ],
    [
      "a part with multiple payload keys",
      () => ({
        ...suggestBody(),
        contents: [
          {
            role: "user",
            parts: [{ text: "hello", inlineData: { mimeType: "audio/wav", data: "AAAA" } }],
          },
        ],
      }),
      "invalid-contents",
    ],
    [
      "non-user roles",
      () => ({
        ...suggestBody(),
        contents: [{ role: "model", parts: [{ text: "hello" }] }],
      }),
      "invalid-contents",
    ],
    [
      "non-WAV inline audio",
      () => ({
        ...autoTagBody(),
        contents: [
          {
            role: "user",
            parts: [
              { inlineData: { mimeType: "audio/mpeg", data: "AAAA" } },
              { text: "Classify this short audio sample." },
            ],
          },
        ],
      }),
      "invalid-contents",
    ],
    [
      "non-base64 inline audio",
      () => ({
        ...autoTagBody(),
        contents: [
          {
            role: "user",
            parts: [
              { inlineData: { mimeType: "audio/wav", data: "not-base64!" } },
              { text: "Classify this short audio sample." },
            ],
          },
        ],
      }),
      "invalid-contents",
    ],
    [
      "schema nesting beyond the proxy cap",
      () => ({
        ...suggestBody(),
        config: { ...suggestBody().config, responseSchema: nestedSchema(9) },
      }),
      "invalid-config",
    ],
    [
      "oversized system instructions",
      () => ({
        ...suggestBody(),
        config: { ...suggestBody().config, systemInstruction: "x".repeat(20_001) },
      }),
      "invalid-config",
    ],
  ])("rejects %s", async (_name, buildBody, error) => {
    const res = await handleGeminiRequest(request(buildBody()));
    expect(res.status).toBe(400);
    expect(await responseJson(res)).toMatchObject({ error });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it.each([
    ["Suggest", suggestBody],
    ["Variation", variationBody],
    ["per-clip auto-tag", autoTagBody],
    ["batch auto-tag", batchAutoTagBody],
  ])("accepts the current %s request shape", async (_name, buildBody) => {
    const body = buildBody();
    const res = await handleGeminiRequest(request(body));
    expect(res.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).toContain("/gemini-3.1-flash-lite:generateContent");
    expect(init.headers).toMatchObject({
      "content-type": "application/json",
      "x-goog-api-key": "test-api-key",
    });
    expect(JSON.parse(init.body)).not.toHaveProperty("model");
    expect(JSON.parse(init.body)).toEqual(expectedUpstreamBody(body));
  });

  it("maps upstream provider errors to stable codes without leaking provider details", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response("provider says test-api-key is invalid and stack=secret", { status: 400 }),
    );

    const res = await handleGeminiRequest(request(suggestBody()));
    expect(res.status).toBe(502);
    const body = await responseJson(res);
    expect(body).toMatchObject({ error: "upstream-rejected" });
    expect(JSON.stringify(body)).not.toContain("test-api-key");
    expect(JSON.stringify(body)).not.toContain("provider says");
  });
});

describe("route entry modules", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("exports the Vercel { fetch } wrapper from both entry modules", () => {
    expect(typeof geminiRoute.fetch).toBe("function");
    expect(typeof geminiTokenRoute.fetch).toBe("function");
  });

  it("reaches the method guard through both entry exports", async () => {
    const tokenRes = await geminiTokenRoute.fetch(
      new Request(`${ALLOWED_ORIGIN}/api/gemini-token`, { method: "GET" }),
    );
    expect(tokenRes.status).toBe(405);
    expect(await responseJson(tokenRes)).toMatchObject({ error: "method-not-allowed" });

    const geminiRes = await geminiRoute.fetch(
      new Request(`${ALLOWED_ORIGIN}/api/gemini`, { method: "GET" }),
    );
    expect(geminiRes.status).toBe(405);
    expect(await responseJson(geminiRes)).toMatchObject({ error: "method-not-allowed" });
  });

  it("converts unexpected handler crashes into stable JSON 503s", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const crashingRoute = withCrashBoundary(async () => {
      throw new Error("secret stack detail");
    }, "test-route");

    const res = await crashingRoute(
      new Request(`${ALLOWED_ORIGIN}/api/gemini`, { method: "POST" }),
    );
    expect(res.status).toBe(503);
    const body = await responseJson(res);
    expect(body).toMatchObject({ error: "proxy-internal-error" });
    expect(JSON.stringify(body)).not.toContain("secret stack detail");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(errorSpy).toHaveBeenCalledOnce();
  });

  it("keeps every api route registered in vercel.json", () => {
    const config = JSON.parse(
      readFileSync(resolve(process.cwd(), "vercel.json"), "utf8"),
    ) as { functions?: Record<string, unknown> };
    expect(Object.keys(config.functions ?? {})).toEqual(
      expect.arrayContaining(["api/gemini.ts", "api/gemini-token.ts"]),
    );
  });
});
