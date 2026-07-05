// ABOUTME: Vercel function that issues short-lived signed tokens for the Gemini proxy.
// ABOUTME: Keeps the production proxy from accepting bare Origin-spoofed POSTs.
import { handleGeminiTokenRequest, withCrashBoundary } from "./gemini";

export default {
  fetch: withCrashBoundary(handleGeminiTokenRequest, "gemini-token"),
};
