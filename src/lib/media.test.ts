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

  it("requestMedia confirms then releases (granted, no stream held), and surfaces denied with error on rejection", async () => {
    // Granted path.
    const fake = makeFakeStream();
    stubGetUserMedia(async () => fake);
    await requestMedia();
    expect(useAppStore.getState().media.status).toBe("granted");
    expect(useAppStore.getState().media.stream).toBeNull();
    for (const track of fake._tracks) expect(track.stop).toHaveBeenCalled();

    // Denied path.
    __resetMediaForTesting();
    useAppStore.getState().actions.reset();
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

  it("acquireRecordingStream rolls media status back to 'denied' on failure so requestMedia can re-prompt (regression)", async () => {
    // First: grant permission so the store status is 'granted', stream null.
    const fake = makeFakeStream();
    stubGetUserMedia(async () => fake);
    await requestMedia();
    expect(useAppStore.getState().media.status).toBe("granted");

    // Now the camera is revoked — acquireRecordingStream throws.
    stubGetUserMedia(async () => {
      throw new DOMException("revoked", "NotAllowedError");
    });
    await expect(acquireRecordingStream()).rejects.toBeInstanceOf(DOMException);

    // Status must be 'denied' so requestMedia no longer short-circuits.
    expect(useAppStore.getState().media.status).toBe("denied");

    // Re-grant: requestMedia must be callable again and flip back to granted.
    const fake2 = makeFakeStream();
    stubGetUserMedia(async () => fake2);
    __resetMediaForTesting();
    await requestMedia();
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
