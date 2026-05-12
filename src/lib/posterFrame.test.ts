// ABOUTME: posterFrame tests — failure / timeout paths. jsdom can't decode video,
// ABOUTME: so the happy-path frame extraction is exercised by the manual / e2e smoke check.
import { describe, it, expect, vi, afterEach } from "vitest";
import { captureFirstFrame } from "./posterFrame";

describe("captureFirstFrame", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("resolves to null (does not throw) when the blob can't be decoded", async () => {
    // jsdom's HTMLVideoElement won't fire loadeddata for a junk blob — the
    // timeout path is what we're really exercising here.
    vi.useFakeTimers();
    const blob = new Blob([new Uint8Array([0, 1, 2])], { type: "video/webm" });
    const promise = captureFirstFrame(blob, 0.05, 50);
    await vi.advanceTimersByTimeAsync(100);
    const result = await promise;
    expect(result).toBeNull();
  });

  it("returns null when the input is an empty blob", async () => {
    vi.useFakeTimers();
    const blob = new Blob([], { type: "video/webm" });
    const promise = captureFirstFrame(blob, 0.05, 50);
    await vi.advanceTimersByTimeAsync(100);
    const result = await promise;
    expect(result).toBeNull();
  });
});
