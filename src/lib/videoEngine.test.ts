// ABOUTME: videoEngine tests — the pure decision helpers plus one integration check.
// ABOUTME: Tone is mocked deterministically; the canvas-draw path isn't exercised (jsdom can't render video frames).
import { describe, it, expect, vi, beforeEach } from "vitest";

// `Tone.Draw.schedule` is the audio-aligned playback scheduler. Inside
// the videoEngine each trigger lands two scheduled callbacks (seek, play)
// which we run immediately so the integration tests still observe the
// post-trigger displayed state deterministically.
const drawSchedule = vi.fn((cb: () => void, _time: number) => {
  cb();
  return 1;
});
vi.mock("tone", () => ({
  now: vi.fn(() => 0),
  getTransport: vi.fn(() => ({
    clear: vi.fn(),
    scheduleRepeat: vi.fn(() => 1),
  })),
  getDraw: vi.fn(() => ({ schedule: drawSchedule })),
}));

import {
  setClipForTrack,
  trigger,
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
import type { Clip } from "../types";

function makeClip(seed: number): Clip {
  return {
    blob: new Blob([new Uint8Array([seed])], { type: "video/webm" }),
    url: `blob:test/${seed}`,
    audioBuffer: { duration: 1, sampleRate: 48000 } as AudioBuffer,
    trimStartMs: 0,
    trimEndMs: 800,
    durationMs: 1000,
  };
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
    drawSchedule.mockClear();
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
    drawSchedule.mockClear();
    // Far-future: seek at 0.92, play at 1.0.
    trigger(4, 1.0);
    const farTimes = drawSchedule.mock.calls.map((c) => c[1] as number).sort((a, b) => a - b);
    expect(farTimes.length).toBe(2);
    expect(farTimes[0]).toBeCloseTo(0.92, 6);
    expect(farTimes[1]).toBeCloseTo(1.0, 6);
    // Near-now: single combined task at when.
    setClipForTrack(5, makeClip(5));
    __markMetadataReadyForTesting(5);
    drawSchedule.mockClear();
    trigger(5, 0.05);
    expect(drawSchedule.mock.calls.length).toBe(1);
    expect(drawSchedule.mock.calls[0][1]).toBeCloseTo(0.05, 6);
  });
});
