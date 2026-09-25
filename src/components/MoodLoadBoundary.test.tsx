// ABOUTME: MoodLoadBoundary tests — a rejected lazy Mood import renders one reload line and logs why.
// ABOUTME: React's caught-error console report and dev-mode window rethrow are captured, not printed.
import { Suspense, lazy } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MoodLoadBoundary } from "./MoodLoadBoundary";
import { clearLogs, getLogs, LOG_EVENTS } from "../lib/logger";

describe("MoodLoadBoundary", () => {
  afterEach(() => {
    cleanup();
  });

  it("shows one reload line and logs when the lazy Mood chunk fails to load", async () => {
    clearLogs();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const swallowWindowError = (event: ErrorEvent) => event.preventDefault();
    window.addEventListener("error", swallowWindowError);
    // What a deploy does to an open app: the old chunk's URL now 404s.
    const MissingMood = lazy(() =>
      Promise.reject(
        new TypeError("Failed to fetch dynamically imported module: /assets/MoodMode-old.js"),
      ),
    );

    try {
      render(
        <MoodLoadBoundary>
          <Suspense fallback={<div>Loading mood...</div>}>
            <MissingMood />
          </Suspense>
        </MoodLoadBoundary>,
      );

      expect(
        await screen.findByText("Couldn't open Mood — reload to try again."),
      ).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Reload" })).toBeInTheDocument();
      const failed = getLogs().find((entry) => entry.event === LOG_EVENTS.MOOD_LOAD_FAILED);
      expect(failed?.payload).toMatchObject({
        message: expect.stringContaining("dynamically imported module"),
      });
      expect(consoleError).toHaveBeenCalled();
    } finally {
      window.removeEventListener("error", swallowWindowError);
      consoleError.mockRestore();
    }
  });

  it("renders its children while nothing fails", () => {
    render(
      <MoodLoadBoundary>
        <div>Mood stage</div>
      </MoodLoadBoundary>,
    );

    expect(screen.getByText("Mood stage")).toBeInTheDocument();
  });
});
