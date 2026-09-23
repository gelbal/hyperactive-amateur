// ABOUTME: Pins the first-party analytics wiring: inlined GoatCounter script, same-origin beacon, Vercel rewrite.
// ABOUTME: Guards against the third-party host creeping back into index.html or the rewrite disappearing.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const indexHtml = readFileSync(resolve(process.cwd(), "index.html"), "utf8");
const vercelJson = JSON.parse(readFileSync(resolve(process.cwd(), "vercel.json"), "utf8")) as {
  rewrites?: { source: string; destination: string }[];
};
const serviceWorker = readFileSync(resolve(process.cwd(), "public/sw.js"), "utf8");

describe("first-party analytics", () => {
  it("loads no script from the GoatCounter hosts", () => {
    const scriptSources = Array.from(indexHtml.matchAll(/<script[^>]*\ssrc="([^"]+)"/g), (m) => m[1]);
    expect(scriptSources.some((src) => /gc\.zgo\.at|goatcounter\.com/.test(src))).toBe(false);
  });

  it("inlines count.js with its license header and a same-origin endpoint", () => {
    expect(indexHtml).toContain("This file is released under the ISC license");
    expect(indexHtml).toContain('window.goatcounter = { endpoint: "/api/f" };');
    expect(indexHtml).not.toContain('data-goatcounter="https://');
  });

  it("rewrites the beacon path to the GoatCounter endpoint", () => {
    expect(vercelJson.rewrites).toEqual([
      { source: "/api/f", destination: "https://hyperactive-amateur.goatcounter.com/count" },
    ]);
  });

  it("keeps the beacon path out of the service worker cache", () => {
    // /api/ requests are network-only; the beacon must never be served stale.
    expect(serviceWorker).toContain('url.pathname.startsWith("/api/")');
  });
});
