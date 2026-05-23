// ABOUTME: exportFormats tests — detectSupportedFormats against a stubbed MediaRecorder.isTypeSupported.
// ABOUTME: Output is deduped to one entry per container (mp4, webm) in preference order (MP4 first).
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { detectSupportedFormats } from "./exportFormats";

describe("detectSupportedFormats", () => {
  let originalRecorder: typeof MediaRecorder | undefined;

  beforeEach(() => {
    originalRecorder = (globalThis as { MediaRecorder?: typeof MediaRecorder }).MediaRecorder;
  });

  afterEach(() => {
    (globalThis as { MediaRecorder?: unknown }).MediaRecorder = originalRecorder;
  });

  function stub(supported: string[]): void {
    const set = new Set(supported);
    (globalThis as { MediaRecorder?: unknown }).MediaRecorder = {
      isTypeSupported: vi.fn((m: string) => set.has(m)),
    };
  }

  it("returns [] when MediaRecorder is unavailable", () => {
    (globalThis as { MediaRecorder?: unknown }).MediaRecorder = undefined;
    expect(detectSupportedFormats()).toEqual([]);
  });

  it("returns the single WebM (VP9) entry when only that MIME is supported", () => {
    stub(["video/webm; codecs=vp9,opus"]);
    const out = detectSupportedFormats();
    expect(out).toHaveLength(1);
    expect(out[0].extension).toBe("webm");
    expect(out[0].label).toBe("WebM (VP9)");
  });

  it("returns MP4 first then WebM when both containers are supported", () => {
    stub(["video/mp4; codecs=avc1.42E01E,mp4a.40.2", "video/webm; codecs=vp9,opus"]);
    const out = detectSupportedFormats();
    expect(out.map((f) => f.extension)).toEqual(["mp4", "webm"]);
  });

  it("dedupes to one MP4 + one WebM even when every preference MIME is supported", () => {
    stub([
      "video/mp4; codecs=avc1.42E01E,mp4a.40.2",
      "video/mp4",
      "video/webm; codecs=vp9,opus",
      "video/webm; codecs=vp8,opus",
      "video/webm",
    ]);
    const out = detectSupportedFormats();
    expect(out).toHaveLength(2);
    expect(out[0].extension).toBe("mp4");
    expect(out[0].label).toBe("MP4 (H.264)"); // first preference wins per container
    expect(out[1].extension).toBe("webm");
    expect(out[1].label).toBe("WebM (VP9)");
  });
});
