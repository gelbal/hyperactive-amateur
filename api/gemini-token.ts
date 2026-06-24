// ABOUTME: Vercel function that issues short-lived signed tokens for the Gemini proxy.
// ABOUTME: Keeps the production proxy from accepting bare Origin-spoofed POSTs.
import { handleGeminiTokenRequest } from "./gemini";

export default {
  fetch: handleGeminiTokenRequest,
};
