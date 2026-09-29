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
  __getMoodVideoPoolStateForTesting,
  isVideoReadyForDraw,
  prepareUpcoming,
  restartVideosAtPeriodBoundary,
  setCaptureVideoPolicy,
  syncPool,
  type MoodVideoPoolTake,
  videoForTake,
} from "./moodVideoPool";
import { VIDEO_SEEK_LEAD_SECONDS } from "./videoTiming";

function poolTake(overrides: Partial<MoodVideoPoolTake> = {}): MoodVideoPoolTake {
  return {
    takeId: "take-a",
    url: "blob:test/a",
    loopStart: 0,
    loopEnd: 1,
    loopPeriod: 1,
    cycleMultiple: 1,
    epoch: 0,
    ...overrides,
  };
}

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
    setCaptureVideoPolicy(false);
    toneHarness.setImmediate(0);
    toneHarness.setLookahead(0);
    toneHarness.draw.reset();
  });

  it("diffs by takeId: creates new videos, keeps existing ones, and tears down removed ones", () => {
    syncPool([poolTake()]);
    const first = videoForTake("take-a");
    expect(first).toBeInstanceOf(HTMLVideoElement);
    expect(first?.isConnected).toBe(true);

    syncPool([
      poolTake(),
      poolTake({ takeId: "take-b", url: "blob:test/b", loopStart: 0.25, loopEnd: 1.25 }),
    ]);
    expect(videoForTake("take-a")).toBe(first);
    expect(videoForTake("take-b")).toBeInstanceOf(HTMLVideoElement);

    const removedPlayback = spyVideoPlayback(first as HTMLVideoElement);
    syncPool([
      poolTake({ takeId: "take-b", url: "blob:test/b", loopStart: 0.25, loopEnd: 1.25 }),
    ]);

    expect(removedPlayback.pause).toHaveBeenCalledTimes(1);
    expect(removedPlayback.load).toHaveBeenCalledTimes(1);
    expect(first?.getAttribute("src")).toBeNull();
    expect(first?.isConnected).toBe(false);
    expect(videoForTake("take-a")).toBeNull();
    expect(videoForTake("take-b")).toBeInstanceOf(HTMLVideoElement);
  });

  it("pins hidden playback attributes for mobile Safari", () => {
    syncPool([poolTake()]);
    const video = videoForTake("take-a");

    expect(video?.muted).toBe(true);
    expect(video?.playsInline).toBe(true);
    expect(video?.loop).toBe(false);
    expect(video?.preload).toBe("auto");
    expect(video?.getAttribute("src")).toBe("blob:test/a");
  });

  it("pre-seeks to loopStart at the shared video lead before the boundary", () => {
    syncPool([poolTake({ loopStart: 0.125, loopEnd: 1.125 })]);
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

  it("seeks and plays immediately when an upcoming boundary is inside the seek lead", () => {
    toneHarness.setImmediate(11.95);
    syncPool([poolTake({ loopStart: 0.25, loopEnd: 1.25 })]);
    const video = videoForTake("take-a");
    if (!video) throw new Error("Expected pooled video");
    const playback = spyVideoPlayback(video);

    prepareUpcoming("take-a", 12);

    expect(toneHarness.draw.pendingTimes()).toEqual([]);
    expect(playback.seek).toHaveBeenCalledWith(0.25);
    expect(playback.play).toHaveBeenCalledTimes(1);
  });

  it("holds the last content frame at content end and restarts only on the period boundary", () => {
    syncPool([poolTake({ loopStart: 0.125, loopEnd: 1.125, loopPeriod: 2 })]);
    const video = videoForTake("take-a");
    if (!video) throw new Error("Expected pooled video");
    const playback = spyVideoPlayback(video);

    video.currentTime = 1.2;
    video.dispatchEvent(new Event("timeupdate"));

    expect(playback.pause).toHaveBeenCalledTimes(1);
    expect(playback.seek).not.toHaveBeenCalledWith(0.125);

    // Period boundary for a 2s-period take at epoch 0 lands at audioTime 2.
    restartVideosAtPeriodBoundary(2, 0);

    expect(playback.seek).toHaveBeenLastCalledWith(0.125);
    expect(playback.play).toHaveBeenCalledTimes(1);
  });

  it("restarts a half-cycle (cycleMultiple 0.5) take on its half-cycle period boundaries", () => {
    // period = 0.5s: boundaries at epoch + 0, 0.5, 1.0, ...
    syncPool([poolTake({ loopStart: 0, loopEnd: 0.25, loopPeriod: 0.5, cycleMultiple: 0.5 })]);
    const video = videoForTake("take-a");
    if (!video) throw new Error("Expected pooled video");
    const playback = spyVideoPlayback(video);

    restartVideosAtPeriodBoundary(0.5, 0);
    expect(playback.seek).toHaveBeenLastCalledWith(0);
    const seeksAfterFirst = playback.seek.mock.calls.length;

    // Same period index → no double re-seek.
    restartVideosAtPeriodBoundary(0.5, 0);
    expect(playback.seek.mock.calls.length).toBe(seeksAfterFirst);

    // The next half-cycle boundary DOES re-seek (a full-cycle-only restart would miss this).
    restartVideosAtPeriodBoundary(1.0, 0);
    expect(playback.seek.mock.calls.length).toBe(seeksAfterFirst + 1);
    expect(playback.seek).toHaveBeenLastCalledWith(0);
  });

  it("re-seeks after an epoch reset even at the same period index", () => {
    syncPool([poolTake({ loopStart: 0, loopEnd: 0.5, loopPeriod: 1, cycleMultiple: 1 })]);
    const video = videoForTake("take-a");
    if (!video) throw new Error("Expected pooled video");
    const playback = spyVideoPlayback(video);

    restartVideosAtPeriodBoundary(1, 0);
    const seeksAfterFirst = playback.seek.mock.calls.length;
    expect(seeksAfterFirst).toBeGreaterThan(0);

    // A stop/restart gives a new epoch; period index resolves to 1 again but the
    // dedup must not swallow the new run's re-seek.
    restartVideosAtPeriodBoundary(11, 10);
    expect(playback.seek.mock.calls.length).toBe(seeksAfterFirst + 1);
    expect(playback.seek).toHaveBeenLastCalledWith(0);
  });

  it("wraps cleanly at content end when content fills the period", () => {
    syncPool([poolTake({ loopStart: 0.125, loopEnd: 1.125, loopPeriod: 1 })]);
    const video = videoForTake("take-a");
    if (!video) throw new Error("Expected pooled video");
    const playback = spyVideoPlayback(video);

    video.currentTime = 1.2;
    video.dispatchEvent(new Event("timeupdate"));

    expect(playback.seek).toHaveBeenLastCalledWith(0.125);
    expect(playback.play).toHaveBeenCalledTimes(1);
    expect(playback.pause).not.toHaveBeenCalled();
  });

  it("clamps loopEnd to metadata duration so untrimmed takes still wrap", () => {
    syncPool([poolTake({ loopStart: 0, loopEnd: 2, loopPeriod: 1 })]);
    const video = videoForTake("take-a");
    if (!video) throw new Error("Expected pooled video");
    Object.defineProperty(video, "duration", { configurable: true, value: 1 });
    video.dispatchEvent(new Event("loadedmetadata"));
    const playback = spyVideoPlayback(video);

    video.currentTime = 1.01;
    video.dispatchEvent(new Event("timeupdate"));

    expect(playback.seek).toHaveBeenLastCalledWith(0);
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

  it("pauses non-metronome videos during capture and resumes them after", () => {
    syncPool([
      poolTake({ takeId: "metronome", url: "blob:test/metronome" }),
      poolTake({ takeId: "band", url: "blob:test/band" }),
    ]);
    const metronome = videoForTake("metronome");
    const band = videoForTake("band");
    if (!metronome || !band) throw new Error("expected pooled videos");
    const metronomePlayback = spyVideoPlayback(metronome);
    const bandPlayback = spyVideoPlayback(band);

    setCaptureVideoPolicy(true, "metronome");

    expect(metronomePlayback.pause).not.toHaveBeenCalled();
    expect(bandPlayback.pause).toHaveBeenCalledTimes(1);
    expect(__getMoodVideoPoolStateForTesting()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ takeId: "metronome", playing: true, pausedForCapture: false }),
        expect.objectContaining({ takeId: "band", playing: false, pausedForCapture: true }),
      ]),
    );

    setCaptureVideoPolicy(false);

    expect(bandPlayback.play).toHaveBeenCalledTimes(1);
    expect(__getMoodVideoPoolStateForTesting()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ takeId: "metronome", playing: true, pausedForCapture: false }),
        expect.objectContaining({ takeId: "band", playing: true, pausedForCapture: false }),
      ]),
    );
  });

  it("does not let period-boundary restarts unpause paused-for-capture videos", () => {
    syncPool([
      poolTake({ takeId: "metronome", url: "blob:test/metronome", loopStart: 0.125 }),
      poolTake({ takeId: "band", url: "blob:test/band", loopStart: 0.25 }),
    ]);
    const metronome = videoForTake("metronome");
    const band = videoForTake("band");
    if (!metronome || !band) throw new Error("expected pooled videos");
    const metronomePlayback = spyVideoPlayback(metronome);
    const bandPlayback = spyVideoPlayback(band);

    setCaptureVideoPolicy(true, "metronome");
    metronomePlayback.play.mockClear();
    metronomePlayback.seek.mockClear();
    bandPlayback.play.mockClear();
    bandPlayback.pause.mockClear();
    bandPlayback.seek.mockClear();

    restartVideosAtPeriodBoundary(1, 0);

    expect(metronomePlayback.seek).toHaveBeenCalledWith(0.125);
    expect(metronomePlayback.play).toHaveBeenCalledTimes(1);
    expect(bandPlayback.seek).toHaveBeenCalledWith(0.25);
    expect(bandPlayback.play).not.toHaveBeenCalled();
    expect(bandPlayback.pause).not.toHaveBeenCalled();
    expect(__getMoodVideoPoolStateForTesting()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ takeId: "band", playing: false, pausedForCapture: true }),
      ]),
    );
  });

  it("puts videos added by a mid-capture syncPool call directly under capture pause policy", () => {
    syncPool([poolTake({ takeId: "metronome", url: "blob:test/metronome" })]);
    setCaptureVideoPolicy(true, "metronome");
    const prototypePlay = vi.spyOn(HTMLMediaElement.prototype, "play");
    prototypePlay.mockClear();

    try {
      syncPool([
        poolTake({ takeId: "metronome", url: "blob:test/metronome" }),
        poolTake({ takeId: "new-band", url: "blob:test/new-band" }),
      ]);

      expect(videoForTake("new-band")).toBeInstanceOf(HTMLVideoElement);
      expect(prototypePlay).not.toHaveBeenCalled();
      expect(__getMoodVideoPoolStateForTesting()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ takeId: "new-band", playing: false, pausedForCapture: true }),
        ]),
      );

      setCaptureVideoPolicy(false);

      expect(__getMoodVideoPoolStateForTesting()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ takeId: "new-band", playing: true, pausedForCapture: false }),
        ]),
      );
    } finally {
      prototypePlay.mockRestore();
    }
  });
});
