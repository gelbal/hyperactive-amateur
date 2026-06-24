// ABOUTME: HTTP transport that satisfies the GeminiClient seam by POSTing to /api/gemini.
// ABOUTME: Maps HTTP statuses to typed errors so call sites can decide retry vs fail-open vs surface.

import {
  GeminiHttpError,
  MissingApiKeyError,
  TransientGeminiError,
  UpstreamTimeoutError,
} from "./aiErrors";

const PROXY_URL = "/api/gemini";
const TOKEN_URL = "/api/gemini-token";
const TOKEN_HEADER = "x-ha-gemini-token";

// Stay below Vercel Hobby's 60s function ceiling so we fail with a clean
// AbortError before the platform serves a 504 HTML page. The buffer also
// keeps thinkingLevel=HIGH responses (typical 15-30s, occasional 40s+) safe.
const CLIENT_TIMEOUT_MS = 55_000;

interface GeminiTextResponse {
  text?: string;
}

interface GeminiRestResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string }>;
    };
  }>;
}

interface GeminiTokenResponse {
  token?: string;
  expiresAt?: number;
}

let cachedToken: { token: string; expiresAt: number } | null = null;

// Extract the assistant text from Gemini's REST response shape. Mirrors the
// SDK's `.text` getter: it grabs candidates[0].content.parts[0].text.
function extractText(payload: GeminiRestResponse): string | undefined {
  const part = payload.candidates?.[0]?.content?.parts?.[0]?.text;
  return typeof part === "string" ? part : undefined;
}

function mapErrorStatus(status: number, body: string): Error {
  if (status === 408 || status === 504) {
    return new UpstreamTimeoutError();
  }
  if (status === 503 && isPermanentProxyConfigError(body)) {
    return new GeminiHttpError(status, `Gemini proxy ${status}: ${body || "proxy misconfigured"}`);
  }
  if (status === 429 || (status >= 500 && status < 600)) {
    return new TransientGeminiError(status, `Gemini proxy ${status}: ${body || "transient error"}`);
  }
  return new GeminiHttpError(status, `Gemini proxy ${status}: ${body || "request failed"}`);
}

function isPermanentProxyConfigError(body: string): boolean {
  return (
    body.includes("limiter-unconfigured") ||
    body.includes("origin-not-configured") ||
    body.includes("token-secret-unconfigured")
  );
}

function isRequestTokenRejection(status: number, body: string): boolean {
  return (
    status === 401 &&
    (body.includes("invalid-request-token") || body.includes("request-token-required"))
  );
}

async function fetchRequestToken(signal: AbortSignal): Promise<string> {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt - now > 10_000) return cachedToken.token;

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    signal,
  });

  if (res.status === 503) {
    const detail = await res.text().catch(() => "");
    if (detail.includes("no-key")) throw new MissingApiKeyError();
    throw mapErrorStatus(503, detail);
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw mapErrorStatus(res.status, detail);
  }

  const payload = (await res.json()) as GeminiTokenResponse;
  if (typeof payload.token !== "string" || typeof payload.expiresAt !== "number") {
    throw new GeminiHttpError(502, "Gemini proxy token response was invalid");
  }
  cachedToken = { token: payload.token, expiresAt: payload.expiresAt };
  return payload.token;
}

async function postGeminiProxy(params: object, signal: AbortSignal): Promise<Response> {
  const token = await fetchRequestToken(signal);
  return fetch(PROXY_URL, {
    method: "POST",
    headers: { "content-type": "application/json", [TOKEN_HEADER]: token },
    body: JSON.stringify(params),
    signal,
  });
}

export function createHttpGeminiClient(): {
  models: {
    generateContent: (params: object) => Promise<GeminiTextResponse>;
  };
} {
  return {
    models: {
      generateContent: async (params: object): Promise<GeminiTextResponse> => {
        let res: Response;
        try {
          const signal = AbortSignal.timeout(CLIENT_TIMEOUT_MS);
          res = await postGeminiProxy(params, signal);

          if (res.status === 401) {
            const detail = await res.text().catch(() => "");
            if (!isRequestTokenRejection(res.status, detail)) throw mapErrorStatus(res.status, detail);

            cachedToken = null;
            res = await postGeminiProxy(params, signal);
          }
        } catch (err) {
          // AbortSignal.timeout fires a TimeoutError DOMException. The SDK
          // seam treats this as "the request took too long" — distinct from
          // a user-triggered abort, which the surrounding runWithSignal
          // wrapper translates into its own AbortError before this layer.
          if (err instanceof DOMException && err.name === "TimeoutError") {
            throw new UpstreamTimeoutError();
          }
          throw err;
        }

        if (res.status === 503) {
          const detail = await res.text().catch(() => "");
          if (detail.includes("no-key")) {
            throw new MissingApiKeyError();
          }
          throw mapErrorStatus(503, detail);
        }

        if (!res.ok) {
          const detail = await res.text().catch(() => "");
          throw mapErrorStatus(res.status, detail);
        }

        const payload = (await res.json()) as GeminiRestResponse;
        return { text: extractText(payload) };
      },
    },
  };
}

export function __resetGeminiHttpClientForTesting(): void {
  cachedToken = null;
}
