// ABOUTME: Regression test that the real Tailwind config emits pointer-coarse /
// ABOUTME: any-pointer-coarse media queries; without them all mobile touch CSS is silently inert.
/// <reference types="node" />
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import postcss from "postcss";
import tailwindcss from "tailwindcss";

// Builds the real CSS entry through the actual tailwind.config.js (config passed
// by path so this test exercises the same file the production build uses,
// including its content globs over src/).
async function builtCss(): Promise<string> {
  const result = await postcss([tailwindcss("./tailwind.config.js")]).process(
    readFileSync("src/index.css", "utf8"),
    { from: "src/index.css" },
  );
  return result.css;
}

describe("tailwind pointer-coarse variants", () => {
  it("emits the coarse-pointer media queries used by the mobile touch pass", async () => {
    const css = await builtCss();
    expect(css).toContain("@media (pointer: coarse)");
    expect(css).toContain("@media (any-pointer: coarse)");
  }, 20_000);

  it("emits concrete rules for classes the components rely on", async () => {
    const css = await builtCss();
    // 44px step cells (StepGrid) and the camera Flip button (RecordingStation).
    expect(css).toMatch(/pointer-coarse\\:h-11/);
    expect(css).toMatch(/\.pointer-coarse\\:min-h-11\s*{\s*min-height: 2\.75rem;/);
    // Mood stack sheet rows/chips grow past 44px on coarse pointers.
    expect(css).toMatch(/\.pointer-coarse\\:min-h-12\s*{\s*min-height: 3rem;/);
    expect(css).toMatch(/any-pointer-coarse\\:flex/);
    // Subtle always-visible block-remove affordance (StepGrid).
    expect(css).toMatch(/any-pointer-coarse\\:opacity-60/);
    expect(css).toMatch(/any-pointer-coarse\\:pointer-events-auto/);
  }, 20_000);

  it("emits concrete bottom-sheet rules for the Mood stack sheet", async () => {
    const css = await builtCss();
    expect(css).toMatch(/\.pointer-coarse\\:fixed\s*{\s*position: fixed;/);
    expect(css).toMatch(/\.pointer-coarse\\:inset-x-3\s*{\s*left: 0\.75rem;\s*right: 0\.75rem;/);
    expect(css).toMatch(/\.pointer-coarse\\:bottom-3\s*{\s*bottom: 0\.75rem;/);
    expect(css).toMatch(
      /\.pointer-coarse\\:max-h-\\\[min\\\(70dvh\\2c 32rem\\\)\\\]\s*{\s*max-height: min\(70dvh, 32rem\);/,
    );
  }, 20_000);

  it("emits 24px range thumbs for coarse pointers", async () => {
    const css = await builtCss();
    expect(css).toMatch(
      /@media \(pointer: coarse\)[\s\S]*input\[type="range"\]::-webkit-slider-thumb\s*{[^}]*width:\s*1\.5rem;[^}]*height:\s*1\.5rem;/,
    );
    expect(css).toMatch(
      /@media \(pointer: coarse\)[\s\S]*input\[type="range"\]::-moz-range-thumb\s*{[^}]*width:\s*1\.5rem;[^}]*height:\s*1\.5rem;/,
    );
  }, 20_000);

  it("emits dynamic viewport sizing and the shared dark page background", async () => {
    const css = await builtCss();
    expect(css).toContain("min-height: 100dvh");
    expect(css).toMatch(
      /html,\s*body,\s*#root\s*{[^}]*background-color:\s*#09090b/i,
    );
  }, 20_000);
});
