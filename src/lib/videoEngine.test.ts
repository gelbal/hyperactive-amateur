// ABOUTME: videoEngine tests — pure helpers (gc, find, pick) plus integration smoke tests.
// ABOUTME: Tone is mocked so tests can manipulate "now" deterministically.
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("tone", () => ({ now: vi.fn(() => 0) }));

import * as Tone from "tone";
import {
  setClipForTrack,
  trigger,
  drawCurrentFrame,
  initVideoEngine,
  gcEvents,
  findActiveEvents,
  pickActiveEvent,
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

describe("videoEngine pure helpers", () => {
  it("gcEvents drops events whose endTime is more than 0.5s in the past", () => {
    const events: TriggerEvent[] = [
      { trackId: 0, startTime: 0, endTime: 1 },
      { trackId: 1, startTime: 1, endTime: 2 },
    ];
    expect(gcEvents(events, 1.5)).toHaveLength(2);
    expect(gcEvents(events, 1.6)).toHaveLength(1);
    expect(gcEvents(events, 5)).toHaveLength(0);
  });

  it("findActiveEvents returns events whose window covers the audio time", () => {
    const events: TriggerEvent[] = [
      { trackId: 0, startTime: 0, endTime: 1 },
      { trackId: 1, startTime: 0.5, endTime: 1.5 },
      { trackId: 2, startTime: 2, endTime: 3 },
    ];
    expect(findActiveEvents(events, 0.7).map((e) => e.trackId)).toEqual([0, 1]);
    expect(findActiveEvents(events, 1.2).map((e) => e.trackId)).toEqual([1]);
    expect(findActiveEvents(events, 1.6).map((e) => e.trackId)).toEqual([]);
  });

  it("findActiveEvents skips muted tracks", () => {
    const events: TriggerEvent[] = [
      { trackId: 0, startTime: 0, endTime: 1 },
      { trackId: 1, startTime: 0, endTime: 1 },
    ];
    const contexts = new Map<number, TrackContext>([
      [0, { tag: "kick", muted: true }],
      [1, { tag: "snare", muted: false }],
    ]);
    const active = findActiveEvents(events, 0.5, contexts);
    expect(active.map((e) => e.trackId)).toEqual([1]);
  });

  it("pickActiveEvent without contexts falls back to most-recent startTime", () => {
    const events: TriggerEvent[] = [
      { trackId: 0, startTime: 0, endTime: 1 },
      { trackId: 5, startTime: 0.4, endTime: 1.4 },
    ];
    expect(pickActiveEvent(events)?.trackId).toBe(5);
    expect(pickActiveEvent([])).toBeNull();
  });

  it("pickActiveEvent prefers vocal over kick over hat", () => {
    const events: TriggerEvent[] = [
      { trackId: 0, startTime: 0, endTime: 1 }, // vocal
      { trackId: 1, startTime: 0, endTime: 1 }, // kick
      { trackId: 2, startTime: 0, endTime: 1 }, // hat
    ];
    const contexts = new Map<number, TrackContext>([
      [0, { tag: "vocal", muted: false }],
      [1, { tag: "kick", muted: false }],
      [2, { tag: "hat", muted: false }],
    ]);
    expect(pickActiveEvent(events, contexts)?.trackId).toBe(0);
  });

  it("pickActiveEvent ties on tag are broken by most-recent startTime", () => {
    const events: TriggerEvent[] = [
      { trackId: 0, startTime: 0, endTime: 1 },
      { trackId: 1, startTime: 0.3, endTime: 1.3 },
    ];
    const contexts = new Map<number, TrackContext>([
      [0, { tag: null, muted: false }],
      [1, { tag: null, muted: false }],
    ]);
    expect(pickActiveEvent(events, contexts)?.trackId).toBe(1);
  });
});

describe("videoEngine integration", () => {
  beforeEach(() => {
    __resetVideoEngineForTesting();
    useAppStore.getState().actions.reset();
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

  it("trigger pushes onto the queue and drawCurrentFrame is a no-op outside the window", () => {
    setClipForTrack(0, makeClip(1));
    trigger(0, 0);
    const ctx = getCtx();
    // 10s later — well past the trigger window — should clear and not draw.
    expect(() => drawCurrentFrame(ctx, 10)).not.toThrow();
  });

  it("multiple triggers leave the most-recent active during overlap", () => {
    setClipForTrack(0, makeClip(1));
    setClipForTrack(1, makeClip(2));
    trigger(0, 0);
    trigger(1, 0.1);
    const ctx = getCtx();
    drawCurrentFrame(ctx, 0.2);
    // Both windows overlap at 0.2s; pickActiveEvent should pick track 1.
    // We can't assert the actual draw in jsdom, but the call must not throw.
    expect(() => drawCurrentFrame(ctx, 0.2)).not.toThrow();
  });
});
