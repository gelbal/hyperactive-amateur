// ABOUTME: media tests — permission flow + on-demand stream acquire/release.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  requestMedia,
  acquireRecordingStream,
  releaseRecordingStream,
  isAcquireInFlight,
  buildConstraints,
  __resetMediaForTesting,
} from "./media";
import { useAppStore } from "../store/useAppStore";

function makeFakeStream() {
  // Tracks need addEventListener / removeEventListener for streamLifecycle's
  // track.onended wiring — extend EventTarget rather than build the bare
  // minimum, so we don't have to keep up with new event sources.
  const tracks = [makeFakeTrack(), makeFakeTrack()];
  return {
    getTracks: () => tracks,
    _tracks: tracks,
  } as unknown as MediaStream & {
    _tracks: ReturnType<typeof makeFakeTrack>[];
  };
}

function makeFakeTrack() {
  const target = new EventTarget();
  return Object.assign(target, {
    stop: vi.fn(),
    readyState: "live" as "live" | "ended",
  });
}

function stubGetUserMedia(impl: () => Promise<MediaStream>) {
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia: vi.fn(impl) },
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("media", () => {
  let originalMediaDevices: MediaDevices | undefined;
  let originalPermissions: Permissions | undefined;

  beforeEach(() => {
    __resetMediaForTesting();
    useAppStore.getState().actions.reset();
    useAppStore.getState().actions.setPreferredDevices({ video: null, audio: null });
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

  it("requestMedia clears stale saved device IDs and retries with defaults", async () => {
    useAppStore.getState().actions.setPreferredDevices({
      video: "missing-camera",
      audio: "missing-mic",
    });
    const fake = makeFakeStream();
    const getUserMedia = vi
      .fn()
      .mockRejectedValueOnce(new DOMException("device disappeared", "NotFoundError"))
      .mockResolvedValueOnce(fake);
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia },
    });

    await requestMedia();

    expect(getUserMedia).toHaveBeenCalledTimes(2);
    expect(useAppStore.getState().media.videoDeviceId).toBeNull();
    expect(useAppStore.getState().media.audioDeviceId).toBeNull();
    expect(useAppStore.getState().media.status).toBe("granted");
    for (const track of fake._tracks) expect(track.stop).toHaveBeenCalled();
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

  it("acquireRecordingStream releases a previously held stream before replacing it", async () => {
    const first = makeFakeStream();
    const second = makeFakeStream();
    const getUserMedia = vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia },
    });

    await acquireRecordingStream();
    await acquireRecordingStream();

    for (const track of first._tracks) expect(track.stop).toHaveBeenCalled();
    for (const track of second._tracks) expect(track.stop).not.toHaveBeenCalled();
    expect(useAppStore.getState().media.stream).toBe(second);
  });

  it("keeps the newer acquire installed when an older acquire resolves last", async () => {
    const older = deferred<MediaStream>();
    const newer = deferred<MediaStream>();
    const olderStream = makeFakeStream();
    const newerStream = makeFakeStream();
    const getUserMedia = vi
      .fn()
      .mockReturnValueOnce(older.promise)
      .mockReturnValueOnce(newer.promise);
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia },
    });

    const olderAcquire = acquireRecordingStream();
    const newerAcquire = acquireRecordingStream();
    expect(isAcquireInFlight()).toBe(true);

    newer.resolve(newerStream);
    await expect(newerAcquire).resolves.toBe(newerStream);
    expect(useAppStore.getState().media.stream).toBe(newerStream);
    expect(useAppStore.getState().media.status).toBe("granted");

    older.resolve(olderStream);
    await olderAcquire.catch(() => undefined);

    expect(useAppStore.getState().media.stream).toBe(newerStream);
    expect(useAppStore.getState().media.status).toBe("granted");
    for (const track of olderStream._tracks) expect(track.stop).toHaveBeenCalled();
    for (const track of newerStream._tracks) expect(track.stop).not.toHaveBeenCalled();
    expect(isAcquireInFlight()).toBe(false);
  });

  it("ignores an older acquire failure after a newer acquire has succeeded", async () => {
    const older = deferred<MediaStream>();
    const newer = deferred<MediaStream>();
    const newerStream = makeFakeStream();
    const getUserMedia = vi
      .fn()
      .mockReturnValueOnce(older.promise)
      .mockReturnValueOnce(newer.promise);
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia },
    });

    const olderAcquire = acquireRecordingStream();
    const newerAcquire = acquireRecordingStream();

    newer.resolve(newerStream);
    await expect(newerAcquire).resolves.toBe(newerStream);

    older.reject(new DOMException("revoked", "NotAllowedError"));
    await olderAcquire.catch(() => undefined);

    expect(useAppStore.getState().media.stream).toBe(newerStream);
    expect(useAppStore.getState().media.status).toBe("granted");
    expect(useAppStore.getState().media.error).toBeNull();
    for (const track of newerStream._tracks) expect(track.stop).not.toHaveBeenCalled();
  });

  it("does not install an acquire that resolves after the held stream was released", async () => {
    const currentStream = makeFakeStream();
    const lateStream = makeFakeStream();
    const lateAcquire = deferred<MediaStream>();
    const getUserMedia = vi
      .fn()
      .mockResolvedValueOnce(currentStream)
      .mockReturnValueOnce(lateAcquire.promise);
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia },
    });

    await acquireRecordingStream();
    expect(useAppStore.getState().media.stream).toBe(currentStream);

    const acquire = acquireRecordingStream();
    releaseRecordingStream(currentStream);
    expect(useAppStore.getState().media.stream).toBeNull();

    lateAcquire.resolve(lateStream);
    await acquire.catch(() => undefined);

    expect(useAppStore.getState().media.stream).toBeNull();
    expect(useAppStore.getState().media.status).toBe("granted");
    for (const track of lateStream._tracks) expect(track.stop).toHaveBeenCalled();
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

  it("buildConstraints: with no videoDeviceId, video.facingMode reflects the store; toggle flips user ↔ environment", () => {
    // Default: user-facing, no device pinned.
    const a = buildConstraints();
    const videoA = a.video as MediaTrackConstraints;
    expect(videoA.facingMode).toBe("user");
    expect(videoA.deviceId).toBeUndefined();

    useAppStore.getState().actions.toggleVideoFacingMode();
    expect(useAppStore.getState().media.videoFacingMode).toBe("environment");
    const b = buildConstraints();
    const videoB = b.video as MediaTrackConstraints;
    expect(videoB.facingMode).toBe("environment");

    useAppStore.getState().actions.toggleVideoFacingMode();
    expect(useAppStore.getState().media.videoFacingMode).toBe("user");
  });

  it("buildConstraints: an explicit videoDeviceId wins over facingMode (Sources picker > flip hint)", () => {
    useAppStore.getState().actions.setVideoFacingMode("environment");
    useAppStore.getState().actions.setPreferredDevices({ video: "cam-id-123" });
    const c = buildConstraints();
    const video = c.video as MediaTrackConstraints;
    expect(video.deviceId).toEqual({ exact: "cam-id-123" });
    expect(video.facingMode).toBeUndefined();
  });

  it("buildConstraints: after toggleVideoFacingMode, video derives from facingMode with no deviceId", () => {
    useAppStore.getState().actions.setPreferredDevices({ video: "cam-id-123" });

    useAppStore.getState().actions.toggleVideoFacingMode();

    const c = buildConstraints();
    const video = c.video as MediaTrackConstraints;
    expect(useAppStore.getState().media.videoDeviceId).toBeNull();
    expect(video.deviceId).toBeUndefined();
    expect(video.facingMode).toBe("environment");
  });
});
