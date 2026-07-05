// ABOUTME: Regression test that the real Tailwind config emits pointer-coarse /
// ABOUTME: any-pointer-coarse media queries; without them all mobile touch CSS is silently inert.
import { describe, expect, it } from "vitest";
import postcss from "postcss";
import tailwindcss from "tailwindcss";

// Builds utilities through the actual tailwind.config.js (config passed by
// path so this test exercises the same file the production build uses,
// including its content globs over src/).
async function builtCss(): Promise<string> {
  const result = await postcss([tailwindcss("./tailwind.config.js")]).process(
    "@tailwind utilities;",
    { from: undefined },
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
    expect(css).toMatch(/any-pointer-coarse\\:flex/);
  }, 20_000);
});
