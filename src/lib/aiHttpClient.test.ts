// ABOUTME: aiHttpClient tests — request shape, response extraction, status → typed error mapping.
// ABOUTME: Mocks global fetch; doesn't hit the real /api/gemini proxy.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createHttpGeminiClient } from "./aiHttpClient";
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

describe("createHttpGeminiClient", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("POSTs the params as JSON to /api/gemini and forwards an abort signal on the fetch", async () => {
    fetchSpy.mockResolvedValue(
      jsonResponse({
        candidates: [{ content: { parts: [{ text: "ok" }] } }],
      }),
    );

    const client = createHttpGeminiClient();
    await client.models.generateContent({ model: "gemini-3.1-flash-lite", contents: [] });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("/api/gemini");
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({ "content-type": "application/json" });
    expect(JSON.parse(init.body)).toEqual({
      model: "gemini-3.1-flash-lite",
      contents: [],
    });
    // AbortSignal.timeout returns a real AbortSignal — confirm one is wired up.
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("extracts candidates[0].content.parts[0].text and returns { text }", async () => {
    fetchSpy.mockResolvedValue(
      jsonResponse({
        candidates: [{ content: { parts: [{ text: "hello" }] } }],
      }),
    );
    const client = createHttpGeminiClient();
    const result = await client.models.generateContent({});
    expect(result).toEqual({ text: "hello" });
  });

  it("returns text undefined when the upstream payload has no parts", async () => {
    fetchSpy.mockResolvedValue(jsonResponse({ candidates: [] }));
    const client = createHttpGeminiClient();
    const result = await client.models.generateContent({});
    expect(result.text).toBeUndefined();
  });

  it("maps 503 + 'no-key' body to MissingApiKeyError", async () => {
    fetchSpy.mockResolvedValue(textResponse('{"error":"no-key"}', 503));
    const client = createHttpGeminiClient();
    await expect(client.models.generateContent({})).rejects.toBeInstanceOf(MissingApiKeyError);
  });

  it("maps 504 and 408 to UpstreamTimeoutError", async () => {
    fetchSpy.mockResolvedValue(textResponse("gateway timeout", 504));
    const client = createHttpGeminiClient();
    await expect(client.models.generateContent({})).rejects.toBeInstanceOf(UpstreamTimeoutError);

    fetchSpy.mockResolvedValue(textResponse("request timeout", 408));
    await expect(client.models.generateContent({})).rejects.toBeInstanceOf(UpstreamTimeoutError);
  });

  it("maps 429 and 5xx to TransientGeminiError with transient=true and status code", async () => {
    fetchSpy.mockResolvedValue(textResponse("too many requests", 429));
    const client = createHttpGeminiClient();
    try {
      await client.models.generateContent({});
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(TransientGeminiError);
      expect((err as TransientGeminiError).transient).toBe(true);
      expect((err as TransientGeminiError).status).toBe(429);
    }

    fetchSpy.mockResolvedValue(textResponse("server explosion", 502));
    try {
      await client.models.generateContent({});
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(TransientGeminiError);
      expect((err as TransientGeminiError).status).toBe(502);
    }
  });

  it("maps non-timeout 4xx to non-retriable GeminiHttpError", async () => {
    fetchSpy.mockResolvedValue(textResponse("bad request", 400));
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

  it("translates the AbortSignal.timeout firing into UpstreamTimeoutError", async () => {
    fetchSpy.mockRejectedValue(new DOMException("the timeout", "TimeoutError"));
    const client = createHttpGeminiClient();
    await expect(client.models.generateContent({})).rejects.toBeInstanceOf(UpstreamTimeoutError);
  });
});
