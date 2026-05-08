// ABOUTME: media tests — permission flow + on-demand stream acquire/release.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  requestMedia,
  tryAutoGrantMedia,
  acquireRecordingStream,
  releaseRecordingStream,
  __resetMediaForTesting,
} from "./media";
import { useAppStore } from "../store/useAppStore";

function makeFakeStream() {
  const tracks = [{ stop: vi.fn() }, { stop: vi.fn() }];
  return {
    getTracks: () => tracks,
    _tracks: tracks,
  } as unknown as MediaStream & { _tracks: { stop: ReturnType<typeof vi.fn> }[] };
}

function stubGetUserMedia(impl: () => Promise<MediaStream>) {
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia: vi.fn(impl) },
  });
}

describe("media", () => {
  let originalMediaDevices: MediaDevices | undefined;
  let originalPermissions: Permissions | undefined;

  beforeEach(() => {
    __resetMediaForTesting();
    useAppStore.getState().actions.reset();
    originalMediaDevices = (navigator as Navigator & { mediaDevices?: MediaDevices }).mediaDevices;
    originalPermissions = (navigator as Navigator & { permissions?: Permissions }).permissions;
  });

  afterEach(() => {
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: originalMediaDevices,
    });
    Object.defineProperty(navigator, "permissions", {
      configurable: true,
      value: originalPermissions,
    });
  });

  it("requestMedia confirms permission, releases tracks, leaves no stream held", async () => {
    const fake = makeFakeStream();
    stubGetUserMedia(async () => fake);
    await requestMedia();
    expect(useAppStore.getState().media.status).toBe("granted");
    expect(useAppStore.getState().media.stream).toBeNull();
    for (const track of fake._tracks) expect(track.stop).toHaveBeenCalled();
  });

  it("requestMedia transitions to denied with the error message on rejection", async () => {
    stubGetUserMedia(async () => {
      throw new DOMException("user blocked it", "NotAllowedError");
    });
    await requestMedia();
    expect(useAppStore.getState().media.status).toBe("denied");
    expect(useAppStore.getState().media.error).toMatch(/blocked/);
  });

  it("acquireRecordingStream + releaseRecordingStream round-trip", async () => {
    const fake = makeFakeStream();
    stubGetUserMedia(async () => fake);
    const stream = await acquireRecordingStream();
    expect(useAppStore.getState().media.stream).toBe(stream);
    releaseRecordingStream(stream);
    for (const track of fake._tracks) expect(track.stop).toHaveBeenCalled();
    expect(useAppStore.getState().media.stream).toBeNull();
    // Permission state stays granted — user already approved.
    expect(useAppStore.getState().media.status).toBe("granted");
  });

  it("tryAutoGrantMedia flips status to granted WITHOUT touching getUserMedia (no camera-light flicker on page load)", async () => {
    const getUserMedia = vi.fn();
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia },
    });
    Object.defineProperty(navigator, "permissions", {
      configurable: true,
      value: {
        query: vi.fn(async ({ name }: { name: string }) => ({
          state: name === "camera" || name === "microphone" ? "granted" : "prompt",
        })),
      },
    });
    await tryAutoGrantMedia();
    expect(useAppStore.getState().media.status).toBe("granted");
    expect(getUserMedia).not.toHaveBeenCalled();
  });
});
