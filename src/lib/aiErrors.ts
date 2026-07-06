// ABOUTME: Typed errors thrown by the Gemini HTTP transport and consumed by AI call sites.
// ABOUTME: Lets callers (autotag/suggest) decide on retry vs fail-open vs surface-to-toast.

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

// The server proxy returned 503 with `{ error: "no-key" }`. Means
// GEMINI_API_KEY is not configured on the server (or .env.local in dev).
// User-facing message intentionally mentions .env.local first since that's
// the only case a developer can fix locally.
export class MissingApiKeyError extends Error {
  constructor() {
    super("GEMINI_API_KEY is not set. Add it to .env.local — see .env.example.");
    this.name = "MissingApiKeyError";
  }
}

// 408 / 504 / client-side AbortSignal.timeout: the upstream took too long.
// Non-retriable on its own — retrying just burns another 60s budget.
export class UpstreamTimeoutError extends Error {
  constructor(message = "The model took too long to respond. Try a tighter request.") {
    super(message);
    this.name = "UpstreamTimeoutError";
  }
}

// Browser fetch rejects with TypeError when the network is unavailable or the
// request cannot be made at all. Keep that distinct from HTTP statuses so UI
// can say what happened instead of surfacing "Failed to fetch".
export class GeminiOfflineError extends Error {
  constructor(message = "AI needs an internet connection.") {
    super(message);
    this.name = "GeminiOfflineError";
  }
}

// 429 + non-timeout 5xx: worth one retry. The .transient marker is what
// the retry wrapper in aiSuggest reads to decide whether to back off and
// try again.
export class TransientGeminiError extends Error {
  readonly transient = true as const;
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "TransientGeminiError";
    this.status = status;
  }
}

// Any other non-2xx response. Includes 4xx (bad request, auth, etc.).
// Not retriable.
export class GeminiHttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "GeminiHttpError";
    this.status = status;
  }
}
