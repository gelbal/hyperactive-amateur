// ABOUTME: Vercel function that issues short-lived signed tokens for the Gemini proxy.
// ABOUTME: Keeps the production proxy from accepting bare Origin-spoofed POSTs.
// The .js extension is load-bearing: this package is `"type": "module"`, and
// Vercel's Node runtime executes the compiled function as real ESM, where an
// extensionless relative specifier fails at module load (ERR_MODULE_NOT_FOUND
// -> FUNCTION_INVOCATION_FAILED on every request, before any handler runs).
import { handleGeminiTokenRequest, withCrashBoundary } from "./gemini.js";

export default {
  fetch: withCrashBoundary(handleGeminiTokenRequest, "gemini-token"),
};
