// ABOUTME: Pins the Vercel function duration limits for both Gemini API routes.
// ABOUTME: Keeps the token-mint route short while preserving headroom for Gemini calls.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

interface VercelConfig {
  functions: Record<string, { maxDuration: number }>;
}

describe("vercel.json", () => {
  it("caps the token route at 10 seconds and keeps the Gemini route at 60 seconds", () => {
    const config = JSON.parse(
      readFileSync(resolve(process.cwd(), "vercel.json"), "utf8"),
    ) as VercelConfig;

    expect(config.functions["api/gemini-token.ts"].maxDuration).toBe(10);
    expect(config.functions["api/gemini.ts"].maxDuration).toBe(60);
  });
});
