// ABOUTME: The one Gemini model id the client asks for; every AI feature (suggest, variations, auto-tag) reads it here.
// ABOUTME: The proxy allowlist in api/gemini.ts must list this id (api/ never imports from src/ — Vercel bundles it alone).

// gemini-3.5-flash-lite is Google's named replacement for gemini-3.1-flash-lite
// (GA 2026-07-21; the 3.1 id shuts down 2027-05-07). Same low-latency tier and
// the same thinkingConfig.thinkingLevel shape; audio input is no longer
// surcharged. Change the id here and in the proxy allowlist together.
export const GEMINI_MODEL = "gemini-3.5-flash-lite";
