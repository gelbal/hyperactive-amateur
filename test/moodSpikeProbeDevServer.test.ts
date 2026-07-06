// ABOUTME: Mood spike probe tests keep the disposable probe page dev-only.
// ABOUTME: They exercise the Vite middleware without placing files in public/.
import { describe, expect, it, vi } from "vitest";
import { moodSpikeProbeDevServer } from "../vite.config";

interface MiddlewareEntry {
  route: string;
  handler: (
    req: { method?: string; url?: string },
    res: {
      statusCode: number;
      headers: Record<string, string>;
      body: string;
      setHeader: (name: string, value: string) => void;
      end: (chunk?: string | Buffer) => void;
    },
    next: () => void,
  ) => void;
}

function mountProbeMiddleware(): MiddlewareEntry {
  const entries: MiddlewareEntry[] = [];
  const plugin = moodSpikeProbeDevServer();
  plugin.configureServer?.({
    middlewares: {
      use(route: string, handler: MiddlewareEntry["handler"]) {
        entries.push({ route, handler });
      },
    },
  } as never);
  expect(entries).toHaveLength(1);
  return entries[0];
}

function makeResponse() {
  return {
    statusCode: 0,
    headers: {} as Record<string, string>,
    body: "",
    setHeader(name: string, value: string) {
      this.headers[name.toLowerCase()] = value;
    },
    end(chunk?: string | Buffer) {
      this.body = chunk?.toString() ?? "";
    },
  };
}

describe("Mood spike probe Vite middleware", () => {
  it("serves the probe page only from the dev spikes route", () => {
    const entry = mountProbeMiddleware();
    expect(entry.route).toBe("/spikes/mood-probe.html");

    const res = makeResponse();
    const next = vi.fn();
    entry.handler({ method: "GET", url: "/" }, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("text/html; charset=utf-8");
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.body).toContain("Mood spike probe");
    expect(res.body).toContain("S1");
    expect(res.body).toContain("S6");
  });

  it("passes through nested route suffixes", () => {
    const entry = mountProbeMiddleware();
    const res = makeResponse();
    const next = vi.fn();

    entry.handler({ method: "GET", url: "/extra" }, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.body).toBe("");
  });
});
