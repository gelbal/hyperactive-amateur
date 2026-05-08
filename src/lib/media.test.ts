// ABOUTME: media tests — permission-only requestMedia + on-demand stream acquisition for recording.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  requestMedia,
  stopMedia,
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

  describe("requestMedia (permission only — releases the stream after grant)", () => {
    it("transitions idle → requesting → granted on success and releases tracks", async () => {
      const fake = makeFakeStream();
      stubGetUserMedia(async () => fake);
      expect(useAppStore.getState().media.status).toBe("idle");
      const promise = requestMedia();
      expect(useAppStore.getState().media.status).toBe("requesting");
      await promise;
      expect(useAppStore.getState().media.status).toBe("granted");
      // Stream is NOT held — it was released right after grant confirmation.
      expect(useAppStore.getState().media.stream).toBeNull();
      for (const track of fake._tracks) {
        expect(track.stop).toHaveBeenCalled();
      }
    });

    it("transitions to denied with the error message on rejection", async () => {
      stubGetUserMedia(async () => {
        throw new DOMException("user blocked it", "NotAllowedError");
      });
      await requestMedia();
      expect(useAppStore.getState().media.status).toBe("denied");
      expect(useAppStore.getState().media.error).toMatch(/blocked/);
    });

    it("is idempotent — concurrent calls share one getUserMedia call", async () => {
      let calls = 0;
      stubGetUserMedia(async () => {
        calls += 1;
        return makeFakeStream();
      });
      await Promise.all([requestMedia(), requestMedia(), requestMedia()]);
      expect(calls).toBe(1);
    });

    it("returns immediately if permission is already granted", async () => {
      stubGetUserMedia(async () => makeFakeStream());
      await requestMedia();
      let calls = 0;
      stubGetUserMedia(async () => {
        calls += 1;
        return makeFakeStream();
      });
      await requestMedia();
      expect(calls).toBe(0);
    });
  });

  describe("acquireRecordingStream / releaseRecordingStream", () => {
    it("acquires a stream and stores it on the media slice", async () => {
      const fake = makeFakeStream();
      stubGetUserMedia(async () => fake);
      const stream = await acquireRecordingStream();
      expect(stream).toBe(fake);
      expect(useAppStore.getState().media.stream).toBe(fake);
      expect(useAppStore.getState().media.status).toBe("granted");
    });

    it("releaseRecordingStream stops the tracks and clears the slice", async () => {
      const fake = makeFakeStream();
      stubGetUserMedia(async () => fake);
      const stream = await acquireRecordingStream();
      releaseRecordingStream(stream);
      for (const track of fake._tracks) {
        expect(track.stop).toHaveBeenCalled();
      }
      expect(useAppStore.getState().media.stream).toBeNull();
      // Status stays granted — the user has already approved permission.
      expect(useAppStore.getState().media.status).toBe("granted");
    });

    it("releaseRecordingStream leaves the slice alone if a different stream is now held", async () => {
      const oldStream = makeFakeStream();
      stubGetUserMedia(async () => oldStream);
      await acquireRecordingStream();
      const newStream = makeFakeStream();
      stubGetUserMedia(async () => newStream);
      const acquired = await acquireRecordingStream();
      releaseRecordingStream(oldStream);
      // The newer stream is still in the slice.
      expect(useAppStore.getState().media.stream).toBe(acquired);
    });
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

    it("flips status to granted WITHOUT acquiring a stream when both perms are granted", async () => {
      const getUserMedia = vi.fn();
      Object.defineProperty(navigator, "mediaDevices", {
        configurable: true,
        value: { getUserMedia },
      });
      stubPermissions({ camera: "granted", microphone: "granted" });
      await tryAutoGrantMedia();
      expect(useAppStore.getState().media.status).toBe("granted");
      expect(useAppStore.getState().media.stream).toBeNull();
      // No camera light flicker on page load — getUserMedia is NOT called.
      expect(getUserMedia).not.toHaveBeenCalled();
    });

    it("does nothing when one permission is in 'prompt'", async () => {
      stubPermissions({ camera: "granted", microphone: "prompt" });
      await tryAutoGrantMedia();
      expect(useAppStore.getState().media.status).toBe("idle");
    });

    it("does nothing when one permission is denied", async () => {
      stubPermissions({ camera: "denied", microphone: "granted" });
      await tryAutoGrantMedia();
      expect(useAppStore.getState().media.status).toBe("idle");
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

  it("stopMedia stops any held stream and resets state", async () => {
    const fake = makeFakeStream();
    stubGetUserMedia(async () => fake);
    await acquireRecordingStream();
    stopMedia();
    for (const track of fake._tracks) {
      expect(track.stop).toHaveBeenCalled();
    }
    expect(useAppStore.getState().media.status).toBe("idle");
    expect(useAppStore.getState().media.stream).toBeNull();
  });
});
