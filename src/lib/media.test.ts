// ABOUTME: media tests — status transitions on grant + denial + idempotent in-flight requests.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { requestMedia, stopMedia, tryAutoGrantMedia, __resetMediaForTesting } from "./media";
import { useAppStore } from "../store/useAppStore";

function makeFakeStream() {
  const tracks = [{ stop: vi.fn() }, { stop: vi.fn() }];
  return {
    getTracks: () => tracks,
    _tracks: tracks,
  } as unknown as MediaStream & { _tracks: { stop: ReturnType<typeof vi.fn> }[] };
}

describe("media", () => {
  let originalMediaDevices: MediaDevices | undefined;

  beforeEach(() => {
    __resetMediaForTesting();
    useAppStore.getState().actions.reset();
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

  it("transitions status idle → requesting → granted on success", async () => {
    const fake = makeFakeStream();
    stubGetUserMedia(async () => fake);
    expect(useAppStore.getState().media.status).toBe("idle");
    const promise = requestMedia();
    expect(useAppStore.getState().media.status).toBe("requesting");
    await promise;
    expect(useAppStore.getState().media.status).toBe("granted");
    expect(useAppStore.getState().media.stream).toBe(fake);
  });

  it("transitions to denied with the error message on rejection", async () => {
    stubGetUserMedia(async () => {
      throw new DOMException("user blocked it", "NotAllowedError");
    });
    await requestMedia();
    expect(useAppStore.getState().media.status).toBe("denied");
    expect(useAppStore.getState().media.error).toMatch(/blocked/);
  });

  it("is idempotent — concurrent requests share one getUserMedia call", async () => {
    let calls = 0;
    stubGetUserMedia(async () => {
      calls += 1;
      return makeFakeStream();
    });
    await Promise.all([requestMedia(), requestMedia(), requestMedia()]);
    expect(calls).toBe(1);
  });

  it("returns immediately if a stream is already granted", async () => {
    const fake = makeFakeStream();
    stubGetUserMedia(async () => fake);
    await requestMedia();
    let calls = 0;
    stubGetUserMedia(async () => {
      calls += 1;
      return makeFakeStream();
    });
    await requestMedia();
    expect(calls).toBe(0);
  });

  describe("tryAutoGrantMedia", () => {
    let originalPermissions: Permissions | undefined;

    afterEach(() => {
      Object.defineProperty(navigator, "permissions", {
        configurable: true,
        value: originalPermissions,
      });
    });

    function stubPermissions(states: Record<string, PermissionState>) {
      originalPermissions = (navigator as Navigator & { permissions?: Permissions })
        .permissions;
      Object.defineProperty(navigator, "permissions", {
        configurable: true,
        value: {
          query: vi.fn(async ({ name }: { name: string }) => ({
            state: states[name] ?? "prompt",
          })),
        },
      });
    }

    it("calls requestMedia when both camera and mic are already granted", async () => {
      const fake = makeFakeStream();
      stubGetUserMedia(async () => fake);
      stubPermissions({ camera: "granted", microphone: "granted" });
      await tryAutoGrantMedia();
      expect(useAppStore.getState().media.status).toBe("granted");
      expect(useAppStore.getState().media.stream).toBe(fake);
    });

    it("does NOT call requestMedia when one is in 'prompt'", async () => {
      const getUserMedia = vi.fn();
      Object.defineProperty(navigator, "mediaDevices", {
        configurable: true,
        value: { getUserMedia },
      });
      stubPermissions({ camera: "granted", microphone: "prompt" });
      await tryAutoGrantMedia();
      expect(getUserMedia).not.toHaveBeenCalled();
      expect(useAppStore.getState().media.status).toBe("idle");
    });

    it("does NOT call requestMedia when one is denied", async () => {
      const getUserMedia = vi.fn();
      Object.defineProperty(navigator, "mediaDevices", {
        configurable: true,
        value: { getUserMedia },
      });
      stubPermissions({ camera: "denied", microphone: "granted" });
      await tryAutoGrantMedia();
      expect(getUserMedia).not.toHaveBeenCalled();
    });

    it("silently no-ops when permissions API is missing", async () => {
      Object.defineProperty(navigator, "permissions", {
        configurable: true,
        value: undefined,
      });
      await expect(tryAutoGrantMedia()).resolves.toBeUndefined();
      expect(useAppStore.getState().media.status).toBe("idle");
    });

    it("swallows errors thrown by query() (e.g. unsupported names)", async () => {
      Object.defineProperty(navigator, "permissions", {
        configurable: true,
        value: {
          query: vi.fn(async () => {
            throw new TypeError("name not supported");
          }),
        },
      });
      await expect(tryAutoGrantMedia()).resolves.toBeUndefined();
      expect(useAppStore.getState().media.status).toBe("idle");
    });
  });

  it("stopMedia stops all tracks and resets state", async () => {
    const fake = makeFakeStream();
    stubGetUserMedia(async () => fake);
    await requestMedia();
    stopMedia();
    for (const track of fake._tracks) {
      expect(track.stop).toHaveBeenCalled();
    }
    expect(useAppStore.getState().media.status).toBe("idle");
    expect(useAppStore.getState().media.stream).toBeNull();
  });
});
