/// <reference types="vitest" />
import { Readable } from "node:stream";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { handleGeminiRequest } from "./api/gemini";

// Mounts the same handler used by the Vercel function on /api/gemini in
// the local dev server. process.env.GEMINI_API_KEY comes from .env.local
// via loadEnv below — the key never reaches the client bundle.
function geminiDevProxy(env: Record<string, string>): Plugin {
  return {
    name: "gemini-dev-proxy",
    configureServer(server) {
      server.middlewares.use("/api/gemini", async (req, res, next) => {
        if (req.method === undefined) return next();
        if (req.url && req.url !== "/" && req.url !== "") {
          // Sub-paths under /api/gemini aren't handled here.
          return next();
        }
        // Ensure the handler sees the key whether Vite's loadEnv or the
        // shell's environment supplied it.
        if (env.GEMINI_API_KEY) process.env.GEMINI_API_KEY = env.GEMINI_API_KEY;
        try {
          const webRequest = await nodeRequestToWebRequest(req);
          const webResponse = await handleGeminiRequest(webRequest);
          await writeWebResponseToNodeResponse(webResponse, res);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          res.statusCode = 500;
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify({ error: "dev-proxy-failed", message }));
        }
      });
    },
  };
}

async function nodeRequestToWebRequest(req: IncomingMessage): Promise<Request> {
  const host = req.headers.host ?? "localhost";
  const url = `http://${host}${req.url ?? "/"}`;
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) value.forEach((v) => headers.append(name, v));
    else if (typeof value === "string") headers.set(name, value);
  }
  const method = req.method ?? "GET";
  const init: RequestInit & { duplex?: "half" } = { method, headers };
  if (method !== "GET" && method !== "HEAD") {
    init.body = Readable.toWeb(req) as unknown as RequestInit["body"];
    init.duplex = "half";
  }
  return new Request(url, init);
}

async function writeWebResponseToNodeResponse(
  webRes: Response,
  nodeRes: ServerResponse,
): Promise<void> {
  nodeRes.statusCode = webRes.status;
  webRes.headers.forEach((value, name) => nodeRes.setHeader(name, value));
  if (!webRes.body) {
    nodeRes.end();
    return;
  }
  const reader = webRes.body.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) nodeRes.write(value);
  }
  nodeRes.end();
}

// Substitute %BUILD_HASH% in dist/sw.js with a per-deploy token so the SW
// invalidates its caches when the bundle changes. Without this, a deployed
// SW serves stale assets and users see a "broken in a way you can't explain"
// state after a release.
//
// The hash input is dist/index.html, which Vite has already rewritten to
// embed the content-hashed JS/CSS asset filenames. Any code change → new
// asset name → new index.html → new SW cache key. Hashing sw.js itself
// would NOT work because that file is constant ("ha-shell-%BUILD_HASH%").
function swBuildHash(): Plugin {
  return {
    name: "ha-sw-build-hash",
    apply: "build",
    writeBundle(options) {
      const outDir = options.dir ?? resolvePath(process.cwd(), "dist");
      const swPath = resolvePath(outDir, "sw.js");
      const indexPath = resolvePath(outDir, "index.html");
      if (!existsSync(swPath) || !existsSync(indexPath)) return;
      const indexText = readFileSync(indexPath, "utf8");
      const hash = createHash("sha256")
        .update(indexText)
        .digest("hex")
        .slice(0, 8);
      const swText = readFileSync(swPath, "utf8");
      writeFileSync(swPath, swText.replace(/%BUILD_HASH%/g, hash));
    },
  };
}

export default defineConfig(({ mode }) => {
  // Loads .env.local (and friends) so GEMINI_API_KEY is available to the
  // dev middleware without being exposed to the client bundle.
  const env = loadEnv(mode, process.cwd(), "");
  return {
    plugins: [react(), geminiDevProxy(env), swBuildHash()],
    // GEMINI_API_KEY is intentionally NOT in envPrefix: the key only ever
    // lives in process.env on the dev/proxy server, not in import.meta.env.
    test: {
      environment: "jsdom",
      globals: true,
      setupFiles: ["./src/test-setup.ts"],
      css: false,
    },
  };
});
