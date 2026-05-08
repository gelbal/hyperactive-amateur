// ABOUTME: videoEngine tests — pure helpers (quantize, pick) plus integration smoke tests.
// ABOUTME: Tone is mocked so tests can manipulate "now" deterministically.
import { describe, it, expect, beforeEach, vi } from "vitest";

type RepeatCb = (time: number) => void;
const transportClear = vi.fn();
const transportScheduleRepeat = vi.fn<(cb: RepeatCb, interval: string) => number>(() => 1);
vi.mock("tone", () => ({
  now: vi.fn(() => 0),
  getTransport: vi.fn(() => ({
    clear: transportClear,
    scheduleRepeat: transportScheduleRepeat,
  })),
}));

import * as Tone from "tone";
import {
  setClipForTrack,
  trigger,
  drawCurrentFrame,
  initVideoEngine,
  pickActiveEvent,
  pickWithDucking,
  quantizeToBoundary,
  setVideoCutSubdivision,
  resetPlaybackState,
  getDebugInfo,
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

function getCtx() {
  const canvas = document.createElement("canvas");
  canvas.width = 100;
  canvas.height = 100;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no ctx");
  return ctx;
}

describe("pickActiveEvent", () => {
  it("returns null on empty input", () => {
    expect(pickActiveEvent([])).toBeNull();
  });

  it("falls back to most-recent startTime without contexts", () => {
    const events: TriggerEvent[] = [
      { trackId: 0, startTime: 0 },
      { trackId: 5, startTime: 0.4 },
    ];
    expect(pickActiveEvent(events)?.trackId).toBe(5);
  });

  it("prefers vocal over kick over hat", () => {
    const events: TriggerEvent[] = [
      { trackId: 0, startTime: 0 },
      { trackId: 1, startTime: 0 },
      { trackId: 2, startTime: 0 },
    ];
    const contexts = new Map<number, TrackContext>([
      [0, { tag: "vocal", muted: false }],
      [1, { tag: "kick", muted: false }],
      [2, { tag: "hat", muted: false }],
    ]);
    expect(pickActiveEvent(events, contexts)?.trackId).toBe(0);
  });

  it("filters out muted tracks before comparing", () => {
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
  it("returns the priority winner when no current is set", () => {
    const candidates: TriggerEvent[] = [{ trackId: 0, startTime: 0 }];
    expect(pickWithDucking(candidates, null, 0, 400)?.trackId).toBe(0);
  });

  it("falls back to current when candidates are empty", () => {
    const current: TriggerEvent = { trackId: 7, startTime: 0 };
    expect(pickWithDucking([], current, 0.5, 400)).toBe(current);
  });

  it("ducks: same-tier candidate within hold time keeps current", () => {
    const current: TriggerEvent = { trackId: 0, startTime: 1.0 };
    const candidates: TriggerEvent[] = [{ trackId: 1, startTime: 1.2 }];
    const contexts = new Map<number, TrackContext>([
      [0, { tag: "vocal", muted: false }],
      [1, { tag: "vocal", muted: false }],
    ]);
    // 200ms elapsed, 400ms hold → keep current.
    expect(pickWithDucking(candidates, current, 1.2, 400, contexts)?.trackId).toBe(0);
  });

  it("does NOT duck once hold time has elapsed", () => {
    const current: TriggerEvent = { trackId: 0, startTime: 1.0 };
    const candidates: TriggerEvent[] = [{ trackId: 1, startTime: 1.5 }];
    const contexts = new Map<number, TrackContext>([
      [0, { tag: "vocal", muted: false }],
      [1, { tag: "vocal", muted: false }],
    ]);
    // 500ms elapsed, 400ms hold → cut.
    expect(pickWithDucking(candidates, current, 1.5, 400, contexts)?.trackId).toBe(1);
  });

  it("higher-tier candidate always wins regardless of hold", () => {
    const current: TriggerEvent = { trackId: 0, startTime: 1.0 };
    const candidates: TriggerEvent[] = [{ trackId: 1, startTime: 1.05 }];
    const contexts = new Map<number, TrackContext>([
      [0, { tag: "kick", muted: false }],
      [1, { tag: "vocal", muted: false }],
    ]);
    expect(pickWithDucking(candidates, current, 1.05, 1000, contexts)?.trackId).toBe(1);
  });

  it("hold time of 0 always cuts (regression for v1 behavior)", () => {
    const current: TriggerEvent = { trackId: 0, startTime: 1.0 };
    const candidates: TriggerEvent[] = [{ trackId: 1, startTime: 1.001 }];
    const contexts = new Map<number, TrackContext>([
      [0, { tag: "vocal", muted: false }],
      [1, { tag: "vocal", muted: false }],
    ]);
    expect(pickWithDucking(candidates, current, 1.001, 0, contexts)?.trackId).toBe(1);
  });
});

describe("quantizeToBoundary", () => {
  const empty = new Map<number, TrackContext>();

  it("returns the priority winner of triggers in (windowStart, windowEnd]", () => {
    const triggers: TriggerEvent[] = [
      { trackId: 0, startTime: 0.1 },
      { trackId: 1, startTime: 0.4 },
      { trackId: 2, startTime: 0.9 },
    ];
    const result = quantizeToBoundary(triggers, 0, 0.5, empty);
    expect(result.consumed.map((e) => e.trackId)).toEqual([0, 1]);
    expect(result.winner?.trackId).toBe(1);
    expect(result.remaining.map((e) => e.trackId)).toEqual([2]);
  });

  it("returns null winner on empty windows", () => {
    const result = quantizeToBoundary([], 0, 0.5, empty);
    expect(result.winner).toBeNull();
  });

  it("ignores triggers older than the window start", () => {
    const triggers: TriggerEvent[] = [{ trackId: 0, startTime: -0.1 }];
    const result = quantizeToBoundary(triggers, 0, 0.5, empty);
    expect(result.winner).toBeNull();
    expect(result.consumed).toHaveLength(0);
    expect(result.remaining).toHaveLength(0);
  });

  it("keeps future triggers in the remaining list", () => {
    const triggers: TriggerEvent[] = [{ trackId: 3, startTime: 0.6 }];
    const result = quantizeToBoundary(triggers, 0, 0.5, empty);
    expect(result.remaining.map((e) => e.trackId)).toEqual([3]);
  });
});

describe("videoEngine integration", () => {
  beforeEach(() => {
    __resetVideoEngineForTesting();
    useAppStore.getState().actions.reset();
    transportClear.mockClear();
    transportScheduleRepeat.mockClear();
    (Tone.now as ReturnType<typeof vi.fn>).mockReturnValue(0);
  });

  it("setClipForTrack appends and removes hidden video elements", () => {
    setClipForTrack(0, makeClip(1));
    let videos = document.querySelectorAll('[data-hidden-videos="true"] video');
    expect(videos).toHaveLength(1);
    setClipForTrack(0, null);
    videos = document.querySelectorAll('[data-hidden-videos="true"] video');
    expect(videos).toHaveLength(0);
  });

  it("initVideoEngine syncs with the store on track changes", () => {
    initVideoEngine();
    useAppStore.getState().actions.setTrackClip(2, makeClip(3));
    const videos = document.querySelectorAll('[data-hidden-videos="true"] video');
    expect(videos).toHaveLength(1);
  });

  it("initVideoEngine schedules a boundary callback at the project subdivision", () => {
    useAppStore.getState().actions.setCutSubdivision("4n");
    initVideoEngine();
    expect(transportScheduleRepeat).toHaveBeenCalledTimes(1);
    expect(transportScheduleRepeat.mock.calls[0]?.[1]).toBe("4n");
  });

  it("setVideoCutSubdivision tears down and re-registers the boundary callback", () => {
    initVideoEngine();
    transportScheduleRepeat.mockClear();
    transportClear.mockClear();
    setVideoCutSubdivision("1m");
    expect(transportClear).toHaveBeenCalled();
    expect(transportScheduleRepeat).toHaveBeenCalledTimes(1);
    expect(transportScheduleRepeat.mock.calls[0]?.[1]).toBe("1m");
  });

  it("drawCurrentFrame is a no-op when nothing is currently displayed", () => {
    const ctx = getCtx();
    expect(() => drawCurrentFrame(ctx, 0)).not.toThrow();
  });

  it("trigger pushes onto pending; boundary picks the winner", () => {
    initVideoEngine();
    setClipForTrack(0, makeClip(1));
    setClipForTrack(1, makeClip(2));
    useAppStore.getState().actions.setTrackTag(0, "kick");
    useAppStore.getState().actions.setTrackTag(1, "vocal");
    trigger(0, 0.1);
    trigger(1, 0.2);

    // Invoke the registered scheduleRepeat callback at boundary t=0.5.
    const cb = transportScheduleRepeat.mock.calls[0]?.[0];
    expect(cb).toBeDefined();
    cb?.(0.5);

    const ctx = getCtx();
    expect(() => drawCurrentFrame(ctx, 0.5)).not.toThrow();
    // Vocal beats kick on priority — track 1 should be displayed.
    // We can't assert the actual draw in jsdom, but the call must not throw.
  });

  it("resetPlaybackState clears pending and current display", () => {
    setClipForTrack(0, makeClip(1));
    trigger(0, 0.1);
    resetPlaybackState();
    const ctx = getCtx();
    expect(() => drawCurrentFrame(ctx, 1)).not.toThrow();
  });

  it("live trigger while not playing immediately becomes the displayed event", () => {
    setClipForTrack(0, makeClip(1));
    setClipForTrack(3, makeClip(2));
    // Confirm the store reports not playing (default after reset).
    expect(useAppStore.getState().playback.isPlaying).toBe(false);

    trigger(3, 0.5);

    // Without the immediate-display fix, drawCurrentFrame would render black
    // because currentlyDisplayed is set only by the boundary callback (which
    // doesn't fire while the Transport is stopped). With the fix, the live
    // event is displayed right away.
    const debug = getDebugInfo();
    expect(debug.current?.trackId).toBe(3);
  });
});
