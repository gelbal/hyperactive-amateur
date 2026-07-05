// ABOUTME: posterFrame tests — deterministic first-frame extraction paths for jsdom.
// ABOUTME: Simulates video decode events and canvas encoding without relying on real media decode.
import { describe, it, expect, vi, afterEach } from "vitest";
import { captureFirstFrame } from "./posterFrame";

function installFrameHarness(options: {
  width?: number;
  height?: number;
  requestVideoFrameCallback?: HTMLVideoElement["requestVideoFrameCallback"];
  cancelVideoFrameCallback?: HTMLVideoElement["cancelVideoFrameCallback"];
} = {}) {
  const {
    width = 160,
    height = 90,
    requestVideoFrameCallback,
    cancelVideoFrameCallback,
  } = options;
  const originalCreateElement = document.createElement.bind(document);
  const poster = new Blob([new Uint8Array([9])], { type: "image/jpeg" });
  const video = originalCreateElement("video") as HTMLVideoElement;
  const drawImage = vi.fn();
  const toBlob = vi.fn((callback: BlobCallback) => callback(poster));

  Object.defineProperty(video, "videoWidth", { configurable: true, get: () => width });
  Object.defineProperty(video, "videoHeight", { configurable: true, get: () => height });
  Object.defineProperty(video, "load", { configurable: true, value: vi.fn() });
  if (requestVideoFrameCallback) {
    Object.defineProperty(video, "requestVideoFrameCallback", {
      configurable: true,
      value: requestVideoFrameCallback,
    });
  }
  if (cancelVideoFrameCallback) {
    Object.defineProperty(video, "cancelVideoFrameCallback", {
      configurable: true,
      value: cancelVideoFrameCallback,
    });
  }

  const canvas = {
    width: 0,
    height: 0,
    getContext: vi.fn(() => ({ drawImage })),
    toBlob,
  } as unknown as HTMLCanvasElement;

  vi.spyOn(document, "createElement").mockImplementation(
    ((tagName: string, options?: ElementCreationOptions) => {
      if (tagName.toLowerCase() === "video") return video;
      if (tagName.toLowerCase() === "canvas") return canvas;
      return originalCreateElement(tagName, options);
    }) as typeof document.createElement,
  );
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:test/source");
  const revokeObjectURL = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);

  return { video, poster, drawImage, toBlob, revokeObjectURL };
}

describe("captureFirstFrame", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("produces a poster when the video only fires loadedmetadata", async () => {
    vi.useFakeTimers();
    const { video, poster, revokeObjectURL } = installFrameHarness();
    const blob = new Blob([new Uint8Array([1])], { type: "video/webm" });

    const promise = captureFirstFrame(blob, 0.05, 1000);
    video.dispatchEvent(new Event("loadedmetadata"));
    expect(video.currentTime).toBe(0.05);
    video.dispatchEvent(new Event("seeked"));
    await vi.advanceTimersByTimeAsync(1000);

    await expect(promise).resolves.toBe(poster);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:test/source");
  });

  it("uses requestVideoFrameCallback when available", async () => {
    vi.useFakeTimers();
    let frameCallback: VideoFrameRequestCallback | undefined;
    const requestVideoFrameCallback = vi.fn((callback: VideoFrameRequestCallback) => {
      frameCallback = callback;
      return 1;
    });
    const { poster, revokeObjectURL } = installFrameHarness({ requestVideoFrameCallback });
    const blob = new Blob([new Uint8Array([1])], { type: "video/webm" });

    const promise = captureFirstFrame(blob, 0.05, 1000);
    expect(requestVideoFrameCallback).toHaveBeenCalledTimes(1);
    expect(frameCallback).toBeDefined();
    (frameCallback as VideoFrameRequestCallback)(0, {} as VideoFrameCallbackMetadata);
    await vi.advanceTimersByTimeAsync(1000);

    await expect(promise).resolves.toBe(poster);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:test/source");
  });

  it("cancels a pending requestVideoFrameCallback when loadedmetadata wins", async () => {
    vi.useFakeTimers();
    let frameCallback: VideoFrameRequestCallback | undefined;
    const requestVideoFrameCallback = vi.fn((callback: VideoFrameRequestCallback) => {
      frameCallback = callback;
      return 42;
    });
    const cancelVideoFrameCallback = vi.fn();
    const { video, poster } = installFrameHarness({
      requestVideoFrameCallback,
      cancelVideoFrameCallback,
    });
    const blob = new Blob([new Uint8Array([1])], { type: "video/webm" });

    const promise = captureFirstFrame(blob, 0.05, 1000);
    video.dispatchEvent(new Event("loadedmetadata"));
    video.dispatchEvent(new Event("seeked"));
    await vi.advanceTimersByTimeAsync(1000);

    await expect(promise).resolves.toBe(poster);
    expect(frameCallback).toBeDefined();
    expect(cancelVideoFrameCallback).toHaveBeenCalledWith(42);
    expect(cancelVideoFrameCallback).toHaveBeenCalledTimes(1);
  });

  it("cancels a pending requestVideoFrameCallback on timeout", async () => {
    vi.useFakeTimers();
    const requestVideoFrameCallback = vi.fn(() => 7);
    const cancelVideoFrameCallback = vi.fn();
    const { revokeObjectURL } = installFrameHarness({
      requestVideoFrameCallback,
      cancelVideoFrameCallback,
    });
    const blob = new Blob([new Uint8Array([1])], { type: "video/webm" });

    const promise = captureFirstFrame(blob, 0.05, 50);
    await vi.advanceTimersByTimeAsync(100);

    await expect(promise).resolves.toBeNull();
    expect(cancelVideoFrameCallback).toHaveBeenCalledWith(7);
    expect(cancelVideoFrameCallback).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:test/source");
  });

  it("keeps the loadeddata path working", async () => {
    vi.useFakeTimers();
    const { video, poster, revokeObjectURL } = installFrameHarness();
    const blob = new Blob([new Uint8Array([1])], { type: "video/webm" });

    const promise = captureFirstFrame(blob, 0.05, 1000);
    video.dispatchEvent(new Event("loadeddata"));
    video.dispatchEvent(new Event("seeked"));
    await vi.advanceTimersByTimeAsync(1000);

    await expect(promise).resolves.toBe(poster);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:test/source");
  });

  it("returns null and revokes the object URL when the video has no dimensions", async () => {
    vi.useFakeTimers();
    const { video, revokeObjectURL } = installFrameHarness({ width: 0, height: 0 });
    const blob = new Blob([new Uint8Array([1])], { type: "video/webm" });

    const promise = captureFirstFrame(blob, 0.05, 1000);
    video.dispatchEvent(new Event("loadeddata"));
    video.dispatchEvent(new Event("seeked"));
    await vi.advanceTimersByTimeAsync(1000);

    await expect(promise).resolves.toBeNull();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:test/source");
  });

  it("resolves to null (does not throw) when the blob can't be decoded", async () => {
    // jsdom's HTMLVideoElement won't fire loadeddata for a junk blob — the
    // timeout path is what we're really exercising here.
    vi.useFakeTimers();
    const { revokeObjectURL } = installFrameHarness();
    const blob = new Blob([new Uint8Array([0, 1, 2])], { type: "video/webm" });
    const promise = captureFirstFrame(blob, 0.05, 50);
    await vi.advanceTimersByTimeAsync(100);
    const result = await promise;
    expect(result).toBeNull();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:test/source");
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
