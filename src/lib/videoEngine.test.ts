// ABOUTME: videoEngine tests — the pure decision helpers plus integration checks.
// ABOUTME: Tone is mocked through a controllable audio clock and Draw scheduler.
import { describe, it, expect, vi, beforeEach } from "vitest";

const { toneHarness } = await vi.hoisted(async () => {
  const { createToneHarness } = await import("../test-utils/toneTestHarness");
  return { toneHarness: createToneHarness() };
});
vi.mock("tone", () => toneHarness.createToneModule());

import {
  drawCurrentFrame,
  initVideoEngine,
  setClipForTrack,
  trigger,
  prepareUpcoming,
  pickActiveEvent,
  pickWithDucking,
  quantizeToBoundary,
  __getCurrentlyDisplayedForTesting,
  __getPendingTriggerCountForTesting,
  __markMetadataReadyForTesting,
  __resetVideoEngineForTesting,
  type TrackContext,
  type TriggerEvent,
} from "./videoEngine";
import { useAppStore } from "../store/useAppStore";
import { LOG_EVENTS, logger } from "./logger";
import type { Clip } from "../types";

function makeClip(seed: number): Clip {
  return {
    blob: new Blob([new Uint8Array([seed])], { type: "video/webm" }),
    url: `blob:test/${seed}`,
    audioBuffer: { duration: 1, sampleRate: 48000 } as AudioBuffer,
    trimStartMs: 0,
    trimEndMs: 800,
    durationMs: 1000,
    posterBlob: null,
    posterUrl: null,  };
}

function makeTrimmedClip(): Clip {
  return {
    ...makeClip(9),
    trimStartMs: 100,
    trimEndMs: 300,
    durationMs: 1000,
  };
}

function makeCanvasContext(): CanvasRenderingContext2D {
  const canvas = document.createElement("canvas");
  canvas.width = 480;
  canvas.height = 480;
  return {
    canvas,
    fillStyle: "",
    fillRect: vi.fn(),
    drawImage: vi.fn(),
  } as unknown as CanvasRenderingContext2D;
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

describe("pickActiveEvent", () => {
  it("vocal beats kick beats hat beats untagged; ties broken by latest startTime", () => {
    const events: TriggerEvent[] = [
      { trackId: 0, startTime: 0 }, // vocal
      { trackId: 1, startTime: 0 }, // kick
      { trackId: 2, startTime: 0 }, // hat
    ];
    const contexts = new Map<number, TrackContext>([
      [0, { tag: "vocal", muted: false }],
      [1, { tag: "kick", muted: false }],
      [2, { tag: "hat", muted: false }],
    ]);
    expect(pickActiveEvent(events, contexts)?.trackId).toBe(0);
  });

  it("strips muted tracks before comparing", () => {
    const events: TriggerEvent[] = [
      { trackId: 0, startTime: 0 },
      { trackId: 1, startTime: 0 },
    ];
    const contexts = new Map<number, TrackContext>([
      [0, { tag: "vocal", muted: true }],
      [1, { tag: "kick", muted: false }],
    ]);
    expect(pickActiveEvent(events, contexts)?.trackId).toBe(1);
  });
});

describe("pickWithDucking", () => {
  const contexts = new Map<number, TrackContext>([
    [0, { tag: "vocal", muted: false }],
    [1, { tag: "vocal", muted: false }],
    [2, { tag: "kick", muted: false }],
  ]);

  it("holds same-tier within hold time, cuts past it, and lets higher tier through immediately", () => {
    const current: TriggerEvent = { trackId: 0, startTime: 1.0 };
    // Same tier within hold → keep current.
    expect(
      pickWithDucking([{ trackId: 1, startTime: 1.2 }], current, 1.2, 400, contexts)?.trackId,
    ).toBe(0);
    // Same tier past hold → cut.
    expect(
      pickWithDucking([{ trackId: 1, startTime: 1.5 }], current, 1.5, 400, contexts)?.trackId,
    ).toBe(1);
    // Higher tier vocal vs kick — vocal wins regardless.
    const kickCurrent: TriggerEvent = { trackId: 2, startTime: 1.0 };
    expect(
      pickWithDucking([{ trackId: 0, startTime: 1.05 }], kickCurrent, 1.05, 1000, contexts)
        ?.trackId,
    ).toBe(0);
  });

  it("lets a same-tier candidate cut once the current trim has expired", () => {
    const current = { trackId: 0, startTime: 1.0, trimDurationMs: 200 };

    expect(
      pickWithDucking([{ trackId: 1, startTime: 1.25 }], current, 1.25, 400, contexts)
        ?.trackId,
    ).toBe(1);
  });

  it("holds a same-tier candidate while the current trim is still visible", () => {
    const current = { trackId: 0, startTime: 1.0, trimDurationMs: 600 };

    expect(
      pickWithDucking([{ trackId: 1, startTime: 1.25 }], current, 1.25, 400, contexts)
        ?.trackId,
    ).toBe(0);
  });
});

describe("quantizeToBoundary", () => {
  const empty = new Map<number, TrackContext>();

  it("consumes triggers in (windowStart, windowEnd], picks the winner, keeps future ones", () => {
    const result = quantizeToBoundary(
      [
        { trackId: 0, startTime: 0.1 },
        { trackId: 1, startTime: 0.4 },
        { trackId: 3, startTime: 0.9 },
      ],
      0,
      0.5,
      empty,
    );
    expect(result.consumed.map((e) => e.trackId)).toEqual([0, 1]);
    expect(result.winner?.trackId).toBe(1); // most-recent startTime among same-tier
    expect(result.remaining.map((e) => e.trackId)).toEqual([3]);
  });
});

describe("videoEngine integration", () => {
  beforeEach(() => {
    __resetVideoEngineForTesting();
    useAppStore.getState().actions.reset();
    toneHarness.setNow(0);
    toneHarness.setLookahead(0);
    toneHarness.draw.reset();
    toneHarness.transport.reset();
  });

  it("live trigger while not playing immediately becomes the displayed event (so pad clicks show video)", () => {
    setClipForTrack(3, makeClip(2));
    expect(useAppStore.getState().playback.isPlaying).toBe(false);
    trigger(3, 0.5);
    expect(__getCurrentlyDisplayedForTesting()?.trackId).toBe(3);
  });

  it("does not leak pendingTriggers while the transport is stopped (regression)", () => {
    setClipForTrack(0, makeClip(0));
    setClipForTrack(1, makeClip(1));
    expect(useAppStore.getState().playback.isPlaying).toBe(false);
    for (let i = 0; i < 50; i++) {
      trigger(i % 2, 0.1 + i * 0.05);
    }
    // No transport ticks mean the boundary drain never runs; the queue
    // must therefore stay empty when nothing is playing.
    expect(__getPendingTriggerCountForTesting()).toBe(0);
  });

  it("far-future triggers split seek+play across the lookahead; near-now triggers collapse to one", () => {
    setClipForTrack(4, makeClip(4));
    __markMetadataReadyForTesting(4);
    toneHarness.draw.reset();
    // Far-future: seek at 0.92, play at 1.0.
    trigger(4, 1.0);
    const farTimes = toneHarness.draw.schedule.mock.calls
      .map((c) => c[1] as number)
      .sort((a, b) => a - b);
    expect(farTimes.length).toBe(2);
    expect(farTimes[0]).toBeCloseTo(0.92, 6);
    expect(farTimes[1]).toBeCloseTo(1.0, 6);
    // Near-now: single combined task at when.
    setClipForTrack(5, makeClip(5));
    __markMetadataReadyForTesting(5);
    toneHarness.draw.reset();
    trigger(5, 0.05);
    expect(toneHarness.draw.schedule.mock.calls.length).toBe(1);
    expect(toneHarness.draw.schedule.mock.calls[0][1]).toBeCloseTo(0.05, 6);
  });

  it("defers cut-boundary display changes until Draw reaches the audible boundary", () => {
    initVideoEngine();
    setClipForTrack(0, makeClip(0));
    setClipForTrack(1, makeClip(1));

    trigger(0, 0.5);
    expect(__getCurrentlyDisplayedForTesting()?.trackId).toBe(0);

    useAppStore.getState().actions.setIsPlaying(true);
    toneHarness.setLookahead(0.1);
    toneHarness.setImmediate(1.0);
    trigger(1, 1.0);
    toneHarness.draw.reset();

    toneHarness.transport.fireRepeat(0, 1.0);
    expect(__getCurrentlyDisplayedForTesting()?.trackId).toBe(0);

    toneHarness.draw.advanceTo(1.0);
    expect(__getCurrentlyDisplayedForTesting()?.trackId).toBe(1);
  });

  it("pre-seeks and plays the prepared boundary winner without changing the display", () => {
    setClipForTrack(0, makeClip(0));
    __markMetadataReadyForTesting(0);
    useAppStore.getState().actions.setIsPlaying(true);
    trigger(0, 1.0);
    toneHarness.draw.reset();

    const video = document.querySelector("video") as HTMLVideoElement;
    const playback = spyVideoPlayback(video);

    prepareUpcoming(1.0);

    expect(playback.seek).toHaveBeenCalledTimes(1);
    expect(playback.seek).toHaveBeenCalledWith(0);
    expect(playback.play).toHaveBeenCalledTimes(1);
    expect(__getCurrentlyDisplayedForTesting()).toBeNull();
  });

  it("commits a prepared winner at the boundary without seeking it twice", () => {
    initVideoEngine();
    setClipForTrack(0, makeClip(0));
    __markMetadataReadyForTesting(0);
    useAppStore.getState().actions.setIsPlaying(true);
    trigger(0, 1.0);
    toneHarness.draw.reset();

    const video = document.querySelector("video") as HTMLVideoElement;
    const playback = spyVideoPlayback(video);

    prepareUpcoming(1.0);
    toneHarness.transport.fireRepeat(0, 1.0);
    expect(__getCurrentlyDisplayedForTesting()).toBeNull();

    toneHarness.draw.advanceTo(1.0);

    expect(__getCurrentlyDisplayedForTesting()?.trackId).toBe(0);
    expect(playback.seek).toHaveBeenCalledTimes(1);
  });

  it("leaves no-candidate prepares alone and pauses a prepared loser", () => {
    setClipForTrack(0, makeClip(0));
    setClipForTrack(1, makeClip(1));
    __markMetadataReadyForTesting(0);
    __markMetadataReadyForTesting(1);
    useAppStore.getState().actions.setTrackTag(0, "hat");
    useAppStore.getState().actions.setTrackTag(1, "vocal");
    useAppStore.getState().actions.setIsPlaying(true);

    const [loserVideo, winnerVideo] = Array.from(
      document.querySelectorAll("video"),
    ) as HTMLVideoElement[];
    const loserPlayback = spyVideoPlayback(loserVideo);
    const winnerPlayback = spyVideoPlayback(winnerVideo);

    prepareUpcoming(1.0);
    expect(loserPlayback.seek).not.toHaveBeenCalled();
    expect(loserPlayback.play).not.toHaveBeenCalled();
    expect(winnerPlayback.seek).not.toHaveBeenCalled();
    expect(winnerPlayback.play).not.toHaveBeenCalled();

    trigger(0, 1.0);
    toneHarness.draw.reset();
    prepareUpcoming(1.0);
    expect(loserPlayback.play).toHaveBeenCalledTimes(1);

    initVideoEngine();
    trigger(1, 1.0);
    toneHarness.draw.reset();
    toneHarness.transport.fireRepeat(0, 1.0);
    toneHarness.draw.advanceTo(1.0);

    expect(__getCurrentlyDisplayedForTesting()?.trackId).toBe(1);
    expect(loserPlayback.pause).toHaveBeenCalled();
  });

  it("schedules next-boundary preparation and keeps same-boundary preparation idempotent", () => {
    useAppStore.getState().actions.setBpm(120);
    initVideoEngine();
    setClipForTrack(0, makeClip(0));
    __markMetadataReadyForTesting(0);
    useAppStore.getState().actions.setIsPlaying(true);
    trigger(0, 1.25);
    toneHarness.draw.reset();
    toneHarness.transport.scheduleOnce.mockClear();

    const video = document.querySelector("video") as HTMLVideoElement;
    const playback = spyVideoPlayback(video);

    toneHarness.transport.fireRepeat(0, 1.0);

    expect(toneHarness.transport.scheduleOnce).toHaveBeenCalledTimes(1);
    const [, prepareAt] = toneHarness.transport.scheduleOnce.mock.calls[0];
    expect(prepareAt).toBeCloseTo(1.17, 6);

    toneHarness.transport.fireOnce(0, prepareAt as number);
    prepareUpcoming(1.25);

    expect(playback.seek).toHaveBeenCalledTimes(1);
  });

  it("keeps the previous frame while video has only metadata", () => {
    setClipForTrack(0, makeClip(0));
    const video = document.querySelector("video") as HTMLVideoElement;
    setVideoFrameState(video, { readyState: 1 });

    trigger(0, 1.0);
    const ctx = makeCanvasContext();
    drawCurrentFrame(ctx, 1.1);

    expect(ctx.fillRect).not.toHaveBeenCalled();
    expect(ctx.drawImage).not.toHaveBeenCalled();
  });

  it("keeps the previous frame while video is seeking", () => {
    setClipForTrack(0, makeClip(0));
    const video = document.querySelector("video") as HTMLVideoElement;
    setVideoFrameState(video, { readyState: 2, seeking: true });

    trigger(0, 1.0);
    const ctx = makeCanvasContext();
    drawCurrentFrame(ctx, 1.1);

    expect(ctx.fillRect).not.toHaveBeenCalled();
    expect(ctx.drawImage).not.toHaveBeenCalled();
  });

  it("logs drawImage failures once and draws on a later ready frame", () => {
    setClipForTrack(0, makeClip(0));
    const video = document.querySelector("video") as HTMLVideoElement;
    setVideoFrameState(video, { readyState: 2 });
    const loggerSpy = vi.spyOn(logger, "warn").mockImplementation(() => undefined);

    trigger(0, 1.0);
    const throwingCtx = makeCanvasContext();
    vi.mocked(throwingCtx.drawImage).mockImplementation(() => {
      throw new DOMException("frame unavailable", "InvalidStateError");
    });

    expect(() => drawCurrentFrame(throwingCtx, 1.1)).not.toThrow();
    expect(() => drawCurrentFrame(throwingCtx, 1.1)).not.toThrow();
    expect(loggerSpy).toHaveBeenCalledTimes(1);
    expect(loggerSpy).toHaveBeenCalledWith(
      LOG_EVENTS.VIDEO_DRAW_ERROR,
      expect.objectContaining({ message: "frame unavailable", trackId: 0 }),
    );

    const readyCtx = makeCanvasContext();
    drawCurrentFrame(readyCtx, 1.1);
    expect(readyCtx.drawImage).toHaveBeenCalledTimes(1);
    loggerSpy.mockRestore();
  });

  it("clears instead of drawing video after the displayed clip reaches trim end", () => {
    setClipForTrack(0, makeTrimmedClip());
    const video = document.querySelector("video") as HTMLVideoElement;
    setVideoFrameState(video, { readyState: 2 });
    const pause = vi.spyOn(video, "pause");

    trigger(0, 1.0);
    const beforeEnd = makeCanvasContext();
    drawCurrentFrame(beforeEnd, 1.1);
    expect(beforeEnd.drawImage).toHaveBeenCalledTimes(1);

    const afterEnd = makeCanvasContext();
    drawCurrentFrame(afterEnd, 1.21);
    expect(afterEnd.drawImage).not.toHaveBeenCalled();
    expect(afterEnd.fillRect).toHaveBeenCalled();
    expect(pause).toHaveBeenCalled();
  });

  it("keeps the previous frame when the displayed event has not reached its start time", () => {
    setClipForTrack(0, makeClip(0));
    const video = document.querySelector("video") as HTMLVideoElement;
    Object.defineProperty(video, "videoWidth", { configurable: true, value: 640 });
    Object.defineProperty(video, "videoHeight", { configurable: true, value: 480 });

    trigger(0, 2.0);
    const ctx = makeCanvasContext();
    drawCurrentFrame(ctx, 1.99);

    expect(ctx.fillRect).not.toHaveBeenCalled();
    expect(ctx.drawImage).not.toHaveBeenCalled();
  });
});
