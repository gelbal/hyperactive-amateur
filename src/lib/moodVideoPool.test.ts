// ABOUTME: moodVideoPool tests — pins hidden live-take video lifecycle and pre-seek timing.
// ABOUTME: Uses JSDOM video stubs plus the shared Tone harness to verify decoder readiness guards.
import { beforeEach, describe, expect, it, vi } from "vitest";

const { toneHarness } = await vi.hoisted(async () => {
  const { createToneHarness } = await import("../test-utils/toneTestHarness");
  return { toneHarness: createToneHarness() };
});
vi.mock("tone", () => toneHarness.createToneModule());

import {
  __resetMoodVideoPoolForTesting,
  isVideoReadyForDraw,
  prepareUpcoming,
  syncPool,
  videoForTake,
} from "./moodVideoPool";
import { VIDEO_SEEK_LEAD_SECONDS } from "./videoTiming";

function setVideoFrameState(
  video: HTMLVideoElement,
  state: { readyState?: number; seeking?: boolean; width?: number; height?: number },
): void {
  Object.defineProperty(video, "readyState", {
    configurable: true,
    value: state.readyState ?? 2,
  });
  Object.defineProperty(video, "seeking", {
    configurable: true,
    value: state.seeking ?? false,
  });
  Object.defineProperty(video, "videoWidth", {
    configurable: true,
    value: state.width ?? 640,
  });
  Object.defineProperty(video, "videoHeight", {
    configurable: true,
    value: state.height ?? 480,
  });
}

function spyVideoPlayback(video: HTMLVideoElement) {
  let currentTime = 0;
  const seek = vi.fn<(value: number) => void>((value) => {
    currentTime = value;
  });
  Object.defineProperty(video, "currentTime", {
    configurable: true,
    get: () => currentTime,
    set: seek,
  });

  return {
    seek,
    play: vi.spyOn(video, "play"),
    pause: vi.spyOn(video, "pause"),
    load: vi.spyOn(video, "load"),
  };
}

describe("moodVideoPool", () => {
  beforeEach(() => {
    __resetMoodVideoPoolForTesting();
    toneHarness.setImmediate(0);
    toneHarness.setLookahead(0);
    toneHarness.draw.reset();
  });

  it("diffs by takeId: creates new videos, keeps existing ones, and tears down removed ones", () => {
    syncPool([{ takeId: "take-a", url: "blob:test/a", loopStart: 0, loopEnd: 1 }]);
    const first = videoForTake("take-a");
    expect(first).toBeInstanceOf(HTMLVideoElement);
    expect(first?.isConnected).toBe(true);

    syncPool([
      { takeId: "take-a", url: "blob:test/a", loopStart: 0, loopEnd: 1 },
      { takeId: "take-b", url: "blob:test/b", loopStart: 0.25, loopEnd: 1.25 },
    ]);
    expect(videoForTake("take-a")).toBe(first);
    expect(videoForTake("take-b")).toBeInstanceOf(HTMLVideoElement);

    const removedPlayback = spyVideoPlayback(first as HTMLVideoElement);
    syncPool([{ takeId: "take-b", url: "blob:test/b", loopStart: 0.25, loopEnd: 1.25 }]);

    expect(removedPlayback.pause).toHaveBeenCalledTimes(1);
    expect(removedPlayback.load).toHaveBeenCalledTimes(1);
    expect(first?.getAttribute("src")).toBeNull();
    expect(first?.isConnected).toBe(false);
    expect(videoForTake("take-a")).toBeNull();
    expect(videoForTake("take-b")).toBeInstanceOf(HTMLVideoElement);
  });

  it("pins hidden playback attributes for mobile Safari", () => {
    syncPool([{ takeId: "take-a", url: "blob:test/a", loopStart: 0, loopEnd: 1 }]);
    const video = videoForTake("take-a");

    expect(video?.muted).toBe(true);
    expect(video?.playsInline).toBe(true);
    expect(video?.loop).toBe(true);
    expect(video?.preload).toBe("auto");
    expect(video?.getAttribute("src")).toBe("blob:test/a");
  });

  it("pre-seeks to loopStart at the shared video lead before the boundary", () => {
    syncPool([{ takeId: "take-a", url: "blob:test/a", loopStart: 0.125, loopEnd: 1.125 }]);
    const video = videoForTake("take-a");
    if (!video) throw new Error("Expected pooled video");
    const playback = spyVideoPlayback(video);

    prepareUpcoming("take-a", 12);

    expect(toneHarness.draw.pendingTimes()).toEqual([12 - VIDEO_SEEK_LEAD_SECONDS]);
    expect(playback.seek).not.toHaveBeenCalled();

    toneHarness.draw.advanceTo(12 - VIDEO_SEEK_LEAD_SECONDS);

    expect(playback.seek).toHaveBeenCalledWith(0.125);
    expect(playback.play).toHaveBeenCalledTimes(1);
  });

  it("guards readiness with current data, seek state, and decoded dimensions", () => {
    const video = document.createElement("video");

    setVideoFrameState(video, { readyState: 2, seeking: false, width: 640, height: 480 });
    expect(isVideoReadyForDraw(video)).toBe(true);

    setVideoFrameState(video, { readyState: 1, seeking: false, width: 640, height: 480 });
    expect(isVideoReadyForDraw(video)).toBe(false);

    setVideoFrameState(video, { readyState: 2, seeking: true, width: 640, height: 480 });
    expect(isVideoReadyForDraw(video)).toBe(false);

    setVideoFrameState(video, { readyState: 2, seeking: false, width: 0, height: 480 });
    expect(isVideoReadyForDraw(video)).toBe(false);

    setVideoFrameState(video, { readyState: 2, seeking: false, width: 640, height: 0 });
    expect(isVideoReadyForDraw(video)).toBe(false);
  });
});
