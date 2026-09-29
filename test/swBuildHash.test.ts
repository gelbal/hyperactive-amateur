// ABOUTME: Pins the sw-build-hash Vite plugin: hash + precache injection into dist/sw.js,
// ABOUTME: and a loud build failure when the substitution markers have drifted.
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { swBuildHash, PRECACHE_DECLARATION } from "../vite.config";

const REAL_SW = readFileSync(resolve(process.cwd(), "public/sw.js"), "utf8");

function makeDist(swText: string | null): string {
  const dir = mkdtempSync(join(tmpdir(), "ha-sw-plugin-"));
  mkdirSync(join(dir, "assets"), { recursive: true });
  writeFileSync(join(dir, "assets", "index-abc123.js"), "js");
  writeFileSync(join(dir, "index.html"), "<html>built</html>");
  if (swText !== null) writeFileSync(join(dir, "sw.js"), swText);
  return dir;
}

function runPlugin(dir: string): void {
  const plugin = swBuildHash();
  const writeBundle = plugin.writeBundle as unknown as (
    this: { error: (message: string) => never },
    options: { dir: string },
  ) => void;
  writeBundle.call(
    {
      error(message: string): never {
        throw new Error(message);
      },
    },
    { dir },
  );
}

describe("swBuildHash plugin", () => {
  it("injects the build hash and the emitted asset list into sw.js", () => {
    const dir = makeDist(REAL_SW);

    runPlugin(dir);

    const out = readFileSync(join(dir, "sw.js"), "utf8");
    expect(out).not.toContain("%BUILD_HASH%");
    expect(out).not.toContain(PRECACHE_DECLARATION);
    expect(out).toContain('"/assets/index-abc123.js"');
    expect(out).toMatch(/const CACHE_NAME = "ha-shell-[0-9a-f]{8}"/);
  });

  it("fails the build when the precache declaration marker drifted", () => {
    const dir = makeDist(
      REAL_SW.replace(
        PRECACHE_DECLARATION,
        'const PRECACHE_URLS = ["/", "/index.html"];',
      ),
    );

    expect(() => runPlugin(dir)).toThrow(/precache declaration/);
  });

  it("fails the build when the %BUILD_HASH% marker is missing", () => {
    const dir = makeDist(REAL_SW.replaceAll("%BUILD_HASH%", "already-baked"));

    expect(() => runPlugin(dir)).toThrow(/%BUILD_HASH%/);
  });

  it("fails the build when sw.js is missing from the output", () => {
    const dir = makeDist(null);

    expect(() => runPlugin(dir)).toThrow(/sw\.js missing/);
  });
});
