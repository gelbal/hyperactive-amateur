// ABOUTME: Vercel serverless function that proxies Gemini requests so the API key stays server-side.
// ABOUTME: Validates the app's narrow Gemini contract and fails closed without production rate limiting.
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

export const GEMINI_MODEL_ALLOWLIST = ["gemini-3.1-flash-lite"] as const;
export const MAX_BODY_BYTES = 4 * 1024 * 1024;
export const GEMINI_TOKEN_HEADER = "x-ha-gemini-token";

const DEFAULT_RATE_LIMIT_MAX = 60;
const DEFAULT_RATE_LIMIT_WINDOW_SECONDS = 10 * 60;
const DEFAULT_TOKEN_TTL_SECONDS = 120;
const MAX_TEXT_CHARS = 100_000;
const MAX_SYSTEM_INSTRUCTION_CHARS = 20_000;
const MAX_CONTENTS = 4;
const MAX_PARTS_PER_CONTENT = 16;
const MAX_SCHEMA_DEPTH = 8;
const SCHEMA_TYPES = new Set(["OBJECT", "ARRAY", "STRING", "NUMBER", "INTEGER", "BOOLEAN"]);
const CONFIG_KEYS = new Set(["systemInstruction", "responseMimeType", "responseSchema", "thinkingConfig"]);
const SCHEMA_KEYS = new Set([
  "type",
  "properties",
  "items",
  "enum",
  "required",
  "minItems",
  "maxItems",
]);

interface ProxyRequestBody {
  model?: unknown;
  contents?: unknown;
  config?: unknown;
}

interface ValidatedProxyRequest {
  model: string;
  upstreamBody: Record<string, unknown>;
}

interface RateLimitResult {
  count: number;
  resetAt?: number;
}

interface SignedRequestTokenPayload {
  exp: number;
  origin: string;
  identity: string;
  nonce: string;
}

export interface GeminiRateLimitStore {
  increment: (key: string, windowSeconds: number) => Promise<RateLimitResult>;
}

let testRateLimitStore: GeminiRateLimitStore | null | undefined;
let devMemoryStore: GeminiRateLimitStore | null = null;

function jsonResponse(body: unknown, status: number, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
      ...headers,
    },
  });
}

function validationError(error: string, status = 400): { ok: false; error: string; status: number } {
  return { ok: false, error, status };
}

function isProduction(): boolean {
  return process.env.VERCEL_ENV === "production" || process.env.NODE_ENV === "production";
}

function readEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value || undefined;
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function getRateLimitMax(): number {
  return parsePositiveInt(readEnv("GEMINI_RATE_LIMIT_MAX"), DEFAULT_RATE_LIMIT_MAX);
}

function getRateLimitWindowSeconds(): number {
  return parsePositiveInt(
    readEnv("GEMINI_RATE_LIMIT_WINDOW_SECONDS"),
    DEFAULT_RATE_LIMIT_WINDOW_SECONDS,
  );
}

function getTokenTtlSeconds(): number {
  return parsePositiveInt(readEnv("GEMINI_REQUEST_TOKEN_TTL_SECONDS"), DEFAULT_TOKEN_TTL_SECONDS);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: Set<string>): boolean {
  return Object.keys(value).every((key) => allowed.has(key));
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
  );
}

function isSafeText(value: unknown, maxChars = MAX_TEXT_CHARS): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maxChars;
}

function isBase64(value: string): boolean {
  if (value.length === 0 || value.length % 4 !== 0) return false;
  return /^[A-Za-z0-9+/]+={0,2}$/.test(value);
}

function validateInlineData(value: unknown): boolean {
  if (!isPlainObject(value) || !hasOnlyKeys(value, new Set(["mimeType", "data"]))) return false;
  if (value.mimeType !== "audio/wav") return false;
  return typeof value.data === "string" && isBase64(value.data);
}

function validatePart(value: unknown): boolean {
  if (!isPlainObject(value)) return false;
  const keys = Object.keys(value);
  if (keys.length !== 1) return false;
  if ("text" in value) return isSafeText(value.text);
  if ("inlineData" in value) return validateInlineData(value.inlineData);
  return false;
}

function validateContents(value: unknown): boolean {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_CONTENTS) return false;
  for (const content of value) {
    if (!isPlainObject(content) || !hasOnlyKeys(content, new Set(["role", "parts"]))) return false;
    if (content.role !== undefined && content.role !== "user") return false;
    if (!Array.isArray(content.parts) || content.parts.length === 0) return false;
    if (content.parts.length > MAX_PARTS_PER_CONTENT) return false;
    if (!content.parts.every(validatePart)) return false;
  }
  return true;
}

function validateSchema(value: unknown, depth = 0): boolean {
  if (!isPlainObject(value) || depth > MAX_SCHEMA_DEPTH || !hasOnlyKeys(value, SCHEMA_KEYS)) {
    return false;
  }

  if (!SCHEMA_TYPES.has(String(value.type))) return false;

  if (value.enum !== undefined) {
    if (!Array.isArray(value.enum) || value.enum.length > 50) return false;
    if (!value.enum.every((item) => typeof item === "string" && item.length <= 100)) return false;
  }

  if (value.required !== undefined) {
    if (!Array.isArray(value.required) || value.required.length > 50) return false;
    if (!value.required.every((item) => typeof item === "string" && item.length <= 100)) return false;
  }

  for (const key of ["minItems", "maxItems"] as const) {
    const numeric = value[key];
    if (numeric !== undefined) {
      if (typeof numeric !== "number" || !Number.isInteger(numeric) || numeric < 0 || numeric > 128) {
        return false;
      }
    }
  }

  if (value.properties !== undefined) {
    if (!isPlainObject(value.properties)) return false;
    const propertyEntries = Object.entries(value.properties);
    if (propertyEntries.length > 50) return false;
    for (const [key, schema] of propertyEntries) {
      if (!/^[A-Za-z0-9_-]{1,64}$/.test(key)) return false;
      if (!validateSchema(schema, depth + 1)) return false;
    }
  }

  if (value.items !== undefined && !validateSchema(value.items, depth + 1)) return false;

  return true;
}

function normalizeSystemInstruction(value: unknown): unknown {
  if (value === undefined) return undefined;
  if (typeof value === "string") {
    if (value.length === 0 || value.length > MAX_SYSTEM_INSTRUCTION_CHARS) return null;
    return { parts: [{ text: value }] };
  }
  if (!isPlainObject(value) || !hasOnlyKeys(value, new Set(["parts"]))) return null;
  if (!Array.isArray(value.parts) || value.parts.length === 0 || value.parts.length > 4) return null;
  let totalChars = 0;
  for (const part of value.parts) {
    if (!isPlainObject(part) || !hasOnlyKeys(part, new Set(["text"]))) return null;
    if (typeof part.text !== "string" || part.text.length === 0) return null;
    totalChars += part.text.length;
    if (totalChars > MAX_SYSTEM_INSTRUCTION_CHARS) return null;
  }
  return value;
}

function validateConfig(value: unknown): { ok: true; value: Record<string, unknown> } | ReturnType<typeof validationError> {
  if (value === undefined) return { ok: true, value: {} };
  if (!isPlainObject(value) || !hasOnlyKeys(value, CONFIG_KEYS)) {
    return validationError("invalid-config");
  }

  const out: Record<string, unknown> = {};
  if (value.responseMimeType !== undefined) {
    if (value.responseMimeType !== "application/json") return validationError("invalid-config");
    out.responseMimeType = value.responseMimeType;
  }

  if (value.responseSchema !== undefined) {
    if (!validateSchema(value.responseSchema)) return validationError("invalid-config");
    out.responseSchema = value.responseSchema;
  }

  if (value.thinkingConfig !== undefined) {
    if (
      !isPlainObject(value.thinkingConfig) ||
      !hasOnlyKeys(value.thinkingConfig, new Set(["thinkingLevel"])) ||
      value.thinkingConfig.thinkingLevel !== "high"
    ) {
      return validationError("invalid-config");
    }
    out.thinkingConfig = value.thinkingConfig;
  }

  const systemInstruction = normalizeSystemInstruction(value.systemInstruction);
  if (systemInstruction === null) return validationError("invalid-config");
  if (systemInstruction !== undefined) out.systemInstruction = systemInstruction;

  return { ok: true, value: out };
}

function validateProxyRequest(body: ProxyRequestBody): { ok: true; value: ValidatedProxyRequest } | ReturnType<typeof validationError> {
  const model = typeof body.model === "string" ? body.model : "";
  if (!GEMINI_MODEL_ALLOWLIST.includes(model as (typeof GEMINI_MODEL_ALLOWLIST)[number])) {
    return validationError("invalid-model");
  }

  if (!validateContents(body.contents)) return validationError("invalid-contents");

  const config = validateConfig(body.config);
  if (!config.ok) return config;

  const { systemInstruction, ...generationConfig } = config.value;
  const upstreamBody: Record<string, unknown> = {
    contents: body.contents,
    generationConfig,
  };
  if (systemInstruction !== undefined) upstreamBody.systemInstruction = systemInstruction;

  return { ok: true, value: { model, upstreamBody } };
}

async function readBodyWithLimit(request: Request): Promise<string | { error: string; status: number }> {
  const contentLength = request.headers.get("content-length");
  if (contentLength !== null) {
    const parsed = Number(contentLength);
    if (!Number.isFinite(parsed) || parsed < 0) return { error: "invalid-content-length", status: 400 };
    if (parsed > MAX_BODY_BYTES) return { error: "body-too-large", status: 413 };
  }

  const reader = request.body?.getReader();
  if (!reader) return "";

  const decoder = new TextDecoder();
  let received = 0;
  let text = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    received += value.byteLength;
    if (received > MAX_BODY_BYTES) {
      await reader.cancel().catch(() => undefined);
      return { error: "body-too-large", status: 413 };
    }
    text += decoder.decode(value, { stream: true });
  }

  text += decoder.decode();
  return text;
}

function originFromRequest(request: Request): string | null {
  const origin = request.headers.get("origin");
  if (origin) return origin;
  const referer = request.headers.get("referer");
  if (!referer) return null;
  try {
    return new URL(referer).origin;
  } catch {
    return null;
  }
}

function configuredAllowedOrigins(): Set<string> {
  const values = new Set<string>();
  const addOrigin = (value: string | undefined) => {
    const trimmed = value?.trim();
    if (!trimmed) return;
    const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    try {
      values.add(new URL(withScheme).origin);
    } catch {
      // Invalid origins should not accidentally open the allowlist.
    }
  };

  const configured = readEnv("GEMINI_ALLOWED_ORIGINS");
  if (configured) {
    for (const part of configured.split(",")) {
      addOrigin(part);
    }
  }
  addOrigin(readEnv("VERCEL_PROJECT_PRODUCTION_URL"));
  addOrigin(readEnv("VERCEL_BRANCH_URL"));
  addOrigin(readEnv("VERCEL_URL"));
  return values;
}

function isLocalDevOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      (url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "::1")
    );
  } catch {
    return false;
  }
}

function validateOrigin(request: Request): { ok: true } | ReturnType<typeof validationError> {
  const origin = originFromRequest(request);
  if (!origin) {
    return isProduction() ? validationError("origin-required", 403) : { ok: true };
  }

  const allowed = configuredAllowedOrigins();
  if (allowed.has(origin)) return { ok: true };
  if (!isProduction() && isLocalDevOrigin(origin)) return { ok: true };
  if (allowed.size === 0 && isProduction()) return validationError("origin-not-configured", 503);
  return validationError("disallowed-origin", 403);
}

function validateBrowserFetchMetadata(request: Request): { ok: true } | ReturnType<typeof validationError> {
  if (!isProduction()) return { ok: true };

  const site = request.headers.get("sec-fetch-site");
  const mode = request.headers.get("sec-fetch-mode");
  const dest = request.headers.get("sec-fetch-dest");

  if (site !== "same-origin") return validationError("browser-fetch-required", 403);
  if (mode !== null && mode !== "cors" && mode !== "same-origin") {
    return validationError("browser-fetch-required", 403);
  }
  if (dest !== null && dest !== "empty") return validationError("browser-fetch-required", 403);

  return { ok: true };
}

function sanitizeRateLimitPart(value: string): string {
  return value.replace(/[^A-Za-z0-9:._-]/g, "_").slice(0, 128) || "unknown";
}

function firstForwardedValue(value: string | null): string | null {
  const first = value?.split(",")[0]?.trim();
  return first || null;
}

function rateLimitIdentity(request: Request): string {
  const vercelForwardedFor = firstForwardedValue(request.headers.get("x-vercel-forwarded-for"));
  if (vercelForwardedFor) return vercelForwardedFor;

  if (!isProduction()) {
    return (
      firstForwardedValue(request.headers.get("x-forwarded-for")) ??
      request.headers.get("x-real-ip")?.trim() ??
      "unknown"
    );
  }

  return "shared";
}

function rateLimitKey(request: Request, scope: string): string {
  const origin = originFromRequest(request) ?? "no-origin";
  return `${sanitizeRateLimitPart(scope)}:${sanitizeRateLimitPart(origin)}:${sanitizeRateLimitPart(rateLimitIdentity(request))}`;
}

function requestTokenSecret(): string | null {
  return readEnv("GEMINI_REQUEST_TOKEN_SECRET") ?? readEnv("GEMINI_API_KEY") ?? null;
}

function base64UrlEncode(value: string | Buffer): string {
  const buffer = typeof value === "string" ? Buffer.from(value, "utf8") : value;
  return buffer.toString("base64url");
}

function base64UrlDecode(value: string): string | null {
  try {
    return Buffer.from(value, "base64url").toString("utf8");
  } catch {
    return null;
  }
}

function signTokenPayload(encodedPayload: string, secret: string): string {
  return createHmac("sha256", secret).update(encodedPayload).digest("base64url");
}

function constantTimeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function tokenBinding(request: Request): Pick<SignedRequestTokenPayload, "origin" | "identity"> {
  return {
    origin: originFromRequest(request) ?? "no-origin",
    identity: rateLimitIdentity(request),
  };
}

function createSignedRequestToken(
  request: Request,
): { token: string; expiresAt: number } | ReturnType<typeof validationError> {
  const secret = requestTokenSecret();
  if (!secret) return validationError("token-secret-unconfigured", 503);
  const expiresAt = Date.now() + getTokenTtlSeconds() * 1000;
  const payload: SignedRequestTokenPayload = {
    ...tokenBinding(request),
    exp: expiresAt,
    nonce: randomBytes(16).toString("base64url"),
  };
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signature = signTokenPayload(encodedPayload, secret);
  return { token: `${encodedPayload}.${signature}`, expiresAt };
}

function validateSignedRequestToken(request: Request): { ok: true } | ReturnType<typeof validationError> {
  if (!isProduction()) return { ok: true };
  const secret = requestTokenSecret();
  if (!secret) return validationError("token-secret-unconfigured", 503);

  const token = request.headers.get(GEMINI_TOKEN_HEADER);
  if (!token) return validationError("request-token-required", 401);

  const [encodedPayload, signature, ...extra] = token.split(".");
  if (!encodedPayload || !signature || extra.length > 0) return validationError("invalid-request-token", 401);

  const expectedSignature = signTokenPayload(encodedPayload, secret);
  if (!constantTimeEqual(signature, expectedSignature)) return validationError("invalid-request-token", 401);

  const decoded = base64UrlDecode(encodedPayload);
  if (!decoded) return validationError("invalid-request-token", 401);

  let payload: SignedRequestTokenPayload;
  try {
    payload = JSON.parse(decoded) as SignedRequestTokenPayload;
  } catch {
    return validationError("invalid-request-token", 401);
  }

  const binding = tokenBinding(request);
  if (
    typeof payload.exp !== "number" ||
    payload.exp < Date.now() ||
    payload.origin !== binding.origin ||
    payload.identity !== binding.identity ||
    typeof payload.nonce !== "string" ||
    payload.nonce.length < 16
  ) {
    return validationError("invalid-request-token", 401);
  }

  return { ok: true };
}

class MemoryRateLimitStore implements GeminiRateLimitStore {
  private hits = new Map<string, { count: number; resetAt: number }>();

  async increment(key: string, windowSeconds: number): Promise<RateLimitResult> {
    const now = Date.now();
    const existing = this.hits.get(key);
    if (!existing || existing.resetAt <= now) {
      const resetAt = now + windowSeconds * 1000;
      this.hits.set(key, { count: 1, resetAt });
      return { count: 1, resetAt };
    }
    existing.count += 1;
    return { count: existing.count, resetAt: existing.resetAt };
  }
}

class UpstashRateLimitStore implements GeminiRateLimitStore {
  constructor(
    private readonly url: string,
    private readonly token: string,
  ) {}

  async increment(key: string, windowSeconds: number): Promise<RateLimitResult> {
    const nowSeconds = Math.floor(Date.now() / 1000);
    const windowId = Math.floor(nowSeconds / windowSeconds);
    const redisKey = `ha:gemini:${windowId}:${key}`;
    const resetAt = (windowId + 1) * windowSeconds * 1000;
    const res = await fetch(`${this.url}/pipeline`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify([
        ["INCR", redisKey],
        ["EXPIRE", redisKey, String(windowSeconds + 30)],
      ]),
    });
    if (!res.ok) throw new Error("rate limit backend rejected request");
    const payload = (await res.json()) as Array<{ result?: unknown; error?: string }>;
    const count = Number(payload[0]?.result);
    if (!Number.isInteger(count) || count < 1 || payload.some((item) => item.error)) {
      throw new Error("rate limit backend returned invalid response");
    }
    return { count, resetAt };
  }
}

function normalizedLimiterUrl(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (isProduction() && url.protocol !== "https:") return null;
    url.hash = "";
    url.search = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

function configuredRateLimitStore(): GeminiRateLimitStore | null {
  if (testRateLimitStore !== undefined) return testRateLimitStore;

  const upstashUrl = normalizedLimiterUrl(readEnv("UPSTASH_REDIS_REST_URL"));
  const upstashToken = readEnv("UPSTASH_REDIS_REST_TOKEN");
  if (upstashUrl && upstashToken) return new UpstashRateLimitStore(upstashUrl, upstashToken);

  const kvUrl = normalizedLimiterUrl(readEnv("KV_REST_API_URL"));
  const kvToken = readEnv("KV_REST_API_TOKEN");
  if (kvUrl && kvToken) return new UpstashRateLimitStore(kvUrl, kvToken);

  if (isProduction()) return null;
  if (!devMemoryStore) devMemoryStore = new MemoryRateLimitStore();
  return devMemoryStore;
}

async function enforceRateLimit(
  request: Request,
  scope = "generate",
): Promise<{ ok: true } | (ReturnType<typeof validationError> & { headers?: Record<string, string> })> {
  const store = configuredRateLimitStore();
  if (!store) return validationError("limiter-unconfigured", 503);

  const max = getRateLimitMax();
  const windowSeconds = getRateLimitWindowSeconds();
  let result: RateLimitResult;
  try {
    result = await store.increment(rateLimitKey(request, scope), windowSeconds);
  } catch {
    return validationError("rate-limit-unavailable", 503);
  }
  if (result.count > max) {
    const headers: Record<string, string> = {};
    if (result.resetAt) headers["retry-after"] = String(Math.max(1, Math.ceil((result.resetAt - Date.now()) / 1000)));
    return { ok: false, error: "rate-limit-exceeded", status: 429, headers } as ReturnType<typeof validationError> & {
      headers: Record<string, string>;
    };
  }
  return { ok: true };
}

function upstreamErrorResponse(status: number): Response {
  if (status === 408 || status === 504) return jsonResponse({ error: "upstream-timeout" }, 504);
  if (status === 429) return jsonResponse({ error: "upstream-rate-limited" }, 429);
  if (status >= 500) return jsonResponse({ error: "upstream-unavailable" }, 502);
  return jsonResponse({ error: "upstream-rejected" }, 502);
}

export async function handleGeminiRequest(request: Request): Promise<Response> {
  if (request.method !== "POST") {
    return jsonResponse({ error: "method-not-allowed" }, 405);
  }

  const origin = validateOrigin(request);
  if (!origin.ok) return jsonResponse({ error: origin.error }, origin.status);

  const apiKey = readEnv("GEMINI_API_KEY");
  if (!apiKey) {
    return jsonResponse({ error: "no-key" }, 503);
  }

  const fetchMetadata = validateBrowserFetchMetadata(request);
  if (!fetchMetadata.ok) return jsonResponse({ error: fetchMetadata.error }, fetchMetadata.status);

  const rateLimit = await enforceRateLimit(request);
  if (!rateLimit.ok) {
    return jsonResponse(
      { error: rateLimit.error },
      rateLimit.status,
      "headers" in rateLimit ? rateLimit.headers : {},
    );
  }

  const requestToken = validateSignedRequestToken(request);
  if (!requestToken.ok) return jsonResponse({ error: requestToken.error }, requestToken.status);

  const bodyText = await readBodyWithLimit(request);
  if (typeof bodyText !== "string") {
    return jsonResponse({ error: bodyText.error }, bodyText.status);
  }

  let body: ProxyRequestBody;
  try {
    const parsed = JSON.parse(bodyText) as unknown;
    if (!isPlainObject(parsed)) {
      return jsonResponse({ error: "invalid-body" }, 400);
    }
    body = parsed as ProxyRequestBody;
  } catch {
    return jsonResponse({ error: "invalid-json" }, 400);
  }

  const validated = validateProxyRequest(body);
  if (!validated.ok) return jsonResponse({ error: validated.error }, validated.status);

  const url = `${GEMINI_API_BASE}/${encodeURIComponent(validated.value.model)}:generateContent`;

  let upstreamResponse: Response;
  try {
    upstreamResponse = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify(validated.value.upstreamBody),
      signal: request.signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      return jsonResponse({ error: "aborted" }, 499);
    }
    return jsonResponse({ error: "upstream-fetch-failed" }, 502);
  }

  if (!upstreamResponse.ok) return upstreamErrorResponse(upstreamResponse.status);

  return new Response(upstreamResponse.body, {
    status: upstreamResponse.status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
    },
  });
}

export async function handleGeminiTokenRequest(request: Request): Promise<Response> {
  if (request.method !== "POST") {
    return jsonResponse({ error: "method-not-allowed" }, 405);
  }

  const origin = validateOrigin(request);
  if (!origin.ok) return jsonResponse({ error: origin.error }, origin.status);

  const fetchMetadata = validateBrowserFetchMetadata(request);
  if (!fetchMetadata.ok) return jsonResponse({ error: fetchMetadata.error }, fetchMetadata.status);

  if (!readEnv("GEMINI_API_KEY")) {
    return jsonResponse({ error: "no-key" }, 503);
  }

  const rateLimit = await enforceRateLimit(request, "token");
  if (!rateLimit.ok) {
    return jsonResponse(
      { error: rateLimit.error },
      rateLimit.status,
      "headers" in rateLimit ? rateLimit.headers : {},
    );
  }

  const signed = createSignedRequestToken(request);
  if ("error" in signed) return jsonResponse({ error: signed.error }, signed.status);

  return jsonResponse({ token: signed.token, expiresAt: signed.expiresAt }, 200);
}

export function __setGeminiRateLimitStoreForTesting(store: GeminiRateLimitStore | null): void {
  testRateLimitStore = store;
}

export function __resetGeminiProxyForTesting(): void {
  testRateLimitStore = undefined;
  devMemoryStore = null;
}

// Vercel surfaces any uncaught throw from a route module as a plain-text
// FUNCTION_INVOCATION_FAILED page (the 2026-07 /api/gemini-token incident;
// full root-cause record in the maintainer's audit notes). Exported routes get
// a last-resort boundary that keeps unexpected failures as stable JSON and
// logs a route label for the Vercel runtime logs, never provider secrets.
export function withCrashBoundary(
  handler: (request: Request) => Promise<Response>,
  routeLabel: string,
): (request: Request) => Promise<Response> {
  return async (request: Request): Promise<Response> => {
    try {
      return await handler(request);
    } catch (err) {
      console.error(`[gemini-proxy] ${routeLabel} crashed`, err);
      return jsonResponse({ error: "proxy-internal-error" }, 503);
    }
  };
}

// Vercel Node runtime expects the `{ fetch }` wrapper export, not a bare
// default-export function. Keep handleGeminiRequest as a named export so
// the Vite dev middleware in vite.config.ts can import it unchanged.
export default {
  fetch: withCrashBoundary(handleGeminiRequest, "gemini"),
};
