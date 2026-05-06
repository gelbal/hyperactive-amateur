// ABOUTME: detectSupport unit tests — returns missing APIs when stubbed out.
import { describe, it, expect, afterEach } from "vitest";
import { detectSupport } from "./CompatibilityBanner";

describe("detectSupport", () => {
  const original = {
    MediaRecorder: (globalThis as { MediaRecorder?: typeof MediaRecorder }).MediaRecorder,
  };

  afterEach(() => {
    (globalThis as { MediaRecorder?: unknown }).MediaRecorder = original.MediaRecorder;
  });

  it("flags missing MediaRecorder", () => {
    (globalThis as { MediaRecorder?: unknown }).MediaRecorder = undefined;
    const report = detectSupport();
    expect(report.ok).toBe(false);
    expect(report.missing).toContain("MediaRecorder");
  });
});
