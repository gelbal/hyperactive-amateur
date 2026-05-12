// ABOUTME: HTTP transport that satisfies the GeminiClient seam by POSTing to /api/gemini.
// ABOUTME: Maps HTTP statuses to typed errors so call sites can decide retry vs fail-open vs surface.

import {
  GeminiHttpError,
  MissingApiKeyError,
  TransientGeminiError,
  UpstreamTimeoutError,
} from "./aiErrors";

const PROXY_URL = "/api/gemini";

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
  if (status === 429 || (status >= 500 && status < 600)) {
    return new TransientGeminiError(status, `Gemini proxy ${status}: ${body || "transient error"}`);
  }
  return new GeminiHttpError(status, `Gemini proxy ${status}: ${body || "request failed"}`);
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
          res = await fetch(PROXY_URL, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(params),
            signal: AbortSignal.timeout(CLIENT_TIMEOUT_MS),
          });
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
