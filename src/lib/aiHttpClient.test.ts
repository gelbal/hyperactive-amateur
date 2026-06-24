// ABOUTME: aiHttpClient tests — token handshake, request shape, response extraction, status → typed error mapping.
// ABOUTME: Mocks global fetch; doesn't hit the real /api/gemini proxy.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetGeminiHttpClientForTesting, createHttpGeminiClient } from "./aiHttpClient";
import {
  GeminiHttpError,
  MissingApiKeyError,
  TransientGeminiError,
  UpstreamTimeoutError,
} from "./aiErrors";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function textResponse(body: string, status: number): Response {
  return new Response(body, {
    status,
    headers: { "content-type": "text/plain" },
  });
}

function tokenResponse(token = "signed-token", expiresAt = Date.now() + 60_000): Response {
  return jsonResponse({ token, expiresAt });
}

function geminiResponse(text = "ok"): Response {
  return jsonResponse({
    candidates: [{ content: { parts: [{ text }] } }],
  });
}

describe("createHttpGeminiClient", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    __resetGeminiHttpClientForTesting();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    __resetGeminiHttpClientForTesting();
  });

  it("fetches a request token, then POSTs params as JSON to /api/gemini", async () => {
    fetchSpy.mockResolvedValueOnce(tokenResponse("signed-token")).mockResolvedValueOnce(geminiResponse());

    const client = createHttpGeminiClient();
    await client.models.generateContent({ model: "gemini-3.1-flash-lite", contents: [] });

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    const [tokenUrl, tokenInit] = fetchSpy.mock.calls[0];
    expect(tokenUrl).toBe("/api/gemini-token");
    expect(tokenInit.method).toBe("POST");
    expect(tokenInit.headers).toMatchObject({ "content-type": "application/json" });
    expect(tokenInit.signal).toBeInstanceOf(AbortSignal);

    const [url, init] = fetchSpy.mock.calls[1];
    expect(url).toBe("/api/gemini");
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({
      "content-type": "application/json",
      "x-ha-gemini-token": "signed-token",
    });
    expect(JSON.parse(init.body)).toEqual({
      model: "gemini-3.1-flash-lite",
      contents: [],
    });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("caches a valid token across calls", async () => {
    fetchSpy
      .mockResolvedValueOnce(tokenResponse("cached-token"))
      .mockResolvedValueOnce(geminiResponse())
      .mockResolvedValueOnce(geminiResponse());

    const client = createHttpGeminiClient();
    await client.models.generateContent({ one: true });
    await client.models.generateContent({ two: true });

    expect(fetchSpy).toHaveBeenCalledTimes(3);
    expect(fetchSpy.mock.calls[0][0]).toBe("/api/gemini-token");
    expect(fetchSpy.mock.calls[1][1].headers).toMatchObject({ "x-ha-gemini-token": "cached-token" });
    expect(fetchSpy.mock.calls[2][1].headers).toMatchObject({ "x-ha-gemini-token": "cached-token" });
  });

  it("refreshes a token close to expiry", async () => {
    fetchSpy
      .mockResolvedValueOnce(tokenResponse("stale-soon", Date.now() + 5_000))
      .mockResolvedValueOnce(geminiResponse())
      .mockResolvedValueOnce(tokenResponse("fresh-token", Date.now() + 60_000))
      .mockResolvedValueOnce(geminiResponse());

    const client = createHttpGeminiClient();
    await client.models.generateContent({ one: true });
    await client.models.generateContent({ two: true });

    expect(fetchSpy).toHaveBeenCalledTimes(4);
    expect(fetchSpy.mock.calls[1][1].headers).toMatchObject({ "x-ha-gemini-token": "stale-soon" });
    expect(fetchSpy.mock.calls[3][1].headers).toMatchObject({ "x-ha-gemini-token": "fresh-token" });
  });

  it("clears a rejected cached token, fetches a fresh token, and retries once", async () => {
    fetchSpy
      .mockResolvedValueOnce(tokenResponse("stale-token"))
      .mockResolvedValueOnce(textResponse('{"error":"invalid-request-token"}', 401))
      .mockResolvedValueOnce(tokenResponse("fresh-token"))
      .mockResolvedValueOnce(geminiResponse("retried"));

    const client = createHttpGeminiClient();
    const result = await client.models.generateContent({ prompt: "hi" });

    expect(result).toEqual({ text: "retried" });
    expect(fetchSpy).toHaveBeenCalledTimes(4);
    expect(fetchSpy.mock.calls[1][1].headers).toMatchObject({ "x-ha-gemini-token": "stale-token" });
    expect(fetchSpy.mock.calls[3][1].headers).toMatchObject({ "x-ha-gemini-token": "fresh-token" });
  });

  it("extracts candidates[0].content.parts[0].text and returns { text }", async () => {
    fetchSpy.mockResolvedValueOnce(tokenResponse()).mockResolvedValueOnce(geminiResponse("hello"));
    const client = createHttpGeminiClient();
    const result = await client.models.generateContent({});
    expect(result).toEqual({ text: "hello" });
  });

  it("returns text undefined when the upstream payload has no parts", async () => {
    fetchSpy.mockResolvedValueOnce(tokenResponse()).mockResolvedValueOnce(jsonResponse({ candidates: [] }));
    const client = createHttpGeminiClient();
    const result = await client.models.generateContent({});
    expect(result.text).toBeUndefined();
  });

  it("maps token 503 + 'no-key' body to MissingApiKeyError", async () => {
    fetchSpy.mockResolvedValue(textResponse('{"error":"no-key"}', 503));
    const client = createHttpGeminiClient();
    await expect(client.models.generateContent({})).rejects.toBeInstanceOf(MissingApiKeyError);
  });

  it("maps permanent proxy configuration 503s to non-transient GeminiHttpError", async () => {
    fetchSpy
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(textResponse('{"error":"limiter-unconfigured"}', 503));
    const client = createHttpGeminiClient();

    try {
      await client.models.generateContent({});
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(GeminiHttpError);
      expect((err as GeminiHttpError).status).toBe(503);
      expect((err as { transient?: boolean }).transient).toBeUndefined();
    }
  });

  it("maps 504 and 408 to UpstreamTimeoutError", async () => {
    fetchSpy.mockResolvedValueOnce(tokenResponse()).mockResolvedValueOnce(textResponse("gateway timeout", 504));
    const client = createHttpGeminiClient();
    await expect(client.models.generateContent({})).rejects.toBeInstanceOf(UpstreamTimeoutError);

    __resetGeminiHttpClientForTesting();
    fetchSpy.mockResolvedValueOnce(tokenResponse()).mockResolvedValueOnce(textResponse("request timeout", 408));
    await expect(client.models.generateContent({})).rejects.toBeInstanceOf(UpstreamTimeoutError);
  });

  it("maps 429 and 5xx to TransientGeminiError with transient=true and status code", async () => {
    fetchSpy.mockResolvedValueOnce(tokenResponse()).mockResolvedValueOnce(textResponse("too many requests", 429));
    const client = createHttpGeminiClient();
    try {
      await client.models.generateContent({});
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(TransientGeminiError);
      expect((err as TransientGeminiError).transient).toBe(true);
      expect((err as TransientGeminiError).status).toBe(429);
    }

    __resetGeminiHttpClientForTesting();
    fetchSpy.mockResolvedValueOnce(tokenResponse()).mockResolvedValueOnce(textResponse("server explosion", 502));
    try {
      await client.models.generateContent({});
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(TransientGeminiError);
      expect((err as TransientGeminiError).status).toBe(502);
    }
  });

  it("maps non-timeout 4xx to non-retriable GeminiHttpError", async () => {
    fetchSpy.mockResolvedValueOnce(tokenResponse()).mockResolvedValueOnce(textResponse("bad request", 400));
    const client = createHttpGeminiClient();
    try {
      await client.models.generateContent({});
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(GeminiHttpError);
      expect((err as GeminiHttpError).status).toBe(400);
      expect((err as { transient?: boolean }).transient).toBeUndefined();
    }
  });

  it("translates AbortSignal.timeout firing during token fetch into UpstreamTimeoutError", async () => {
    fetchSpy.mockRejectedValue(new DOMException("the timeout", "TimeoutError"));
    const client = createHttpGeminiClient();
    await expect(client.models.generateContent({})).rejects.toBeInstanceOf(UpstreamTimeoutError);
  });
});
