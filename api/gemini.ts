// ABOUTME: Vercel serverless function that proxies Gemini requests so the API key stays server-side.
// ABOUTME: Pass-through to generativelanguage.googleapis.com with Origin allowlist + AbortSignal forwarding.

const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

// SDK-shaped request body the client sends — same shape as @google/genai
// generateContent params, since the client builds these directly. The
// handler renames `config` → `generationConfig` to match the REST schema.
interface ProxyRequestBody {
  model?: string;
  contents?: unknown;
  config?: {
    systemInstruction?: unknown;
    [key: string]: unknown;
  };
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

// Allow the dev origin, the current deployment's own origin, any Vercel
// preview alias, and (optionally) a comma-separated list of custom domains
// from ALLOWED_ORIGINS. Cuts out drive-by scrapers without pretending to be
// real auth — the daily Gemini quota cap is the actual backstop.
function isOriginAllowed(origin: string | null): boolean {
  if (!origin) return false;
  if (origin === "http://localhost:5173") return true;

  let host: string;
  try {
    host = new URL(origin).host;
  } catch {
    return false;
  }

  if (host.endsWith(".vercel.app")) return true;

  const vercelUrls = [
    process.env.VERCEL_URL,
    process.env.VERCEL_BRANCH_URL,
    process.env.VERCEL_PROJECT_PRODUCTION_URL,
  ].filter((v): v is string => typeof v === "string" && v.length > 0);
  if (vercelUrls.some((u) => host === u)) return true;

  const extras = (process.env.ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (extras.some((allowed) => host === allowed)) return true;

  return false;
}

export async function handleGeminiRequest(request: Request): Promise<Response> {
  if (request.method !== "POST") {
    return jsonResponse({ error: "method-not-allowed" }, 405);
  }

  if (!isOriginAllowed(request.headers.get("origin"))) {
    return jsonResponse({ error: "forbidden-origin" }, 403);
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return jsonResponse({ error: "no-key" }, 503);
  }

  let body: ProxyRequestBody;
  try {
    body = (await request.json()) as ProxyRequestBody;
  } catch {
    return jsonResponse({ error: "invalid-json" }, 400);
  }

  const model = typeof body.model === "string" ? body.model : null;
  if (!model || !/^[a-zA-Z0-9._-]+$/.test(model)) {
    return jsonResponse({ error: "invalid-model" }, 400);
  }

  // Map SDK shape → REST shape. The REST body wants:
  //   { contents, generationConfig, systemInstruction? }
  // The client sends { model, contents, config: { systemInstruction?, ... } }.
  // systemInstruction is top-level in REST, not inside generationConfig.
  const { systemInstruction, ...generationConfig } = body.config ?? {};
  const upstreamBody: Record<string, unknown> = {
    contents: body.contents,
    generationConfig,
  };
  if (systemInstruction !== undefined) {
    upstreamBody.systemInstruction =
      typeof systemInstruction === "string"
        ? { parts: [{ text: systemInstruction }] }
        : systemInstruction;
  }

  const url = `${GEMINI_API_BASE}/${encodeURIComponent(model)}:generateContent`;

  let upstreamResponse: Response;
  try {
    upstreamResponse = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify(upstreamBody),
      signal: request.signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      return jsonResponse({ error: "aborted" }, 499);
    }
    return jsonResponse(
      { error: "upstream-fetch-failed", message: err instanceof Error ? err.message : String(err) },
      502,
    );
  }

  // Stream the upstream body straight back; preserve the status so the
  // client can map 429/5xx to TransientGeminiError, etc.
  return new Response(upstreamResponse.body, {
    status: upstreamResponse.status,
    headers: { "content-type": "application/json" },
  });
}

// Vercel Node runtime expects the `{ fetch }` wrapper export, not a bare
// default-export function. Keep handleGeminiRequest as a named export so
// the Vite dev middleware in vite.config.ts can import it unchanged.
export default {
  fetch: handleGeminiRequest,
};
