// ABOUTME: useMediaStream tests — status transitions, denied path, idempotency, cleanup.
// ABOUTME: navigator.mediaDevices.getUserMedia is stubbed for each scenario.
import { render, act, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useMediaStream, type UseMediaStreamResult } from "./useMediaStream";

let lastResult: UseMediaStreamResult | null = null;

function Probe() {
  lastResult = useMediaStream();
  return null;
}

function makeFakeStream() {
  const tracks = [{ stop: vi.fn() }, { stop: vi.fn() }];
  return {
    getTracks: () => tracks,
    _tracks: tracks,
  } as unknown as MediaStream & { _tracks: { stop: ReturnType<typeof vi.fn> }[] };
}

describe("useMediaStream", () => {
  let originalMediaDevices: MediaDevices | undefined;

  beforeEach(() => {
    lastResult = null;
    originalMediaDevices = (navigator as Navigator & { mediaDevices?: MediaDevices })
      .mediaDevices;
  });

  afterEach(() => {
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: originalMediaDevices,
    });
  });

  function stubGetUserMedia(impl: () => Promise<MediaStream>) {
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: vi.fn(impl) },
    });
  }

  it("starts in 'idle' status", () => {
    stubGetUserMedia(async () => makeFakeStream());
    render(<Probe />);
    expect(lastResult?.status).toBe("idle");
    expect(lastResult?.stream).toBeNull();
  });

  it("transitions to 'granted' on success", async () => {
    const fake = makeFakeStream();
    stubGetUserMedia(async () => fake);
    render(<Probe />);
    await act(async () => {
      await lastResult?.request();
    });
    expect(lastResult?.status).toBe("granted");
    expect(lastResult?.stream).toBe(fake);
  });

  it("transitions to 'denied' on rejection", async () => {
    stubGetUserMedia(async () => {
      throw new DOMException("denied", "NotAllowedError");
    });
    render(<Probe />);
    await act(async () => {
      await lastResult?.request();
    });
    expect(lastResult?.status).toBe("denied");
    expect(lastResult?.error).toBeInstanceOf(Error);
  });

  it("is idempotent — calling request twice does not request twice", async () => {
    const fake = makeFakeStream();
    let calls = 0;
    stubGetUserMedia(async () => {
      calls += 1;
      return fake;
    });
    render(<Probe />);
    await act(async () => {
      await lastResult?.request();
    });
    await act(async () => {
      await lastResult?.request();
    });
    expect(calls).toBe(1);
  });

  it("stops all tracks on unmount", async () => {
    const fake = makeFakeStream();
    stubGetUserMedia(async () => fake);
    const { unmount } = render(<Probe />);
    await act(async () => {
      await lastResult?.request();
    });
    await waitFor(() => expect(lastResult?.status).toBe("granted"));
    unmount();
    for (const track of fake._tracks) {
      expect(track.stop).toHaveBeenCalled();
    }
  });
});
