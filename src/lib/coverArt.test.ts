// ABOUTME: coverArt tests — which clips the share card shows, where its tiles sit, and the print plates.
// ABOUTME: Pure functions on plain tracks and typed arrays; real pixels are proven in the browser smoke.
import { describe, it, expect } from "vitest";
import {
  actionFrameSec,
  coverSlots,
  cropSquare,
  pickCoverClips,
  tileOrigin,
} from "./coverArt";
import type { Clip, Tag, Track } from "../types";

function makeClip(id: number, trim: { start?: number; end?: number } = {}): Clip {
  return {
    blob: new Blob([new Uint8Array([id])], { type: "video/webm" }),
    url: `blob:test/${id}`,
    audioBuffer: { duration: 1, sampleRate: 48000 } as AudioBuffer,
    audioStatus: "ok",
    trimStartMs: trim.start ?? 0,
    trimEndMs: trim.end ?? 800,
    durationMs: 1000,
    posterBlob: null,
    posterUrl: null,
  };
}

interface TrackSpec {
  clip?: boolean;
  steps?: number[];
  tag?: Tag | null;
  muted?: boolean;
  showVideo?: boolean;
}

function makeTracks(specs: TrackSpec[]): Track[] {
  return specs.map((spec, id) => ({
    id,
    clip: spec.clip === false ? null : makeClip(id),
    steps: Array.from({ length: 16 }, (_, step) => (spec.steps ?? []).includes(step)),
    volume: 1,
    muted: spec.muted ?? false,
    tag: spec.tag ?? null,
    showVideo: spec.showVideo ?? true,
  }));
}

function pickedTrackIds(tracks: Track[]): number[] {
  const picked = pickCoverClips(tracks);
  return picked.map((clip) => tracks.findIndex((track) => track.clip === clip));
}

describe("pickCoverClips", () => {
  it("ranks by tier, then steps, then track id, and takes four", () => {
    const tracks = makeTracks([
      { tag: "hat", steps: [0, 2, 4, 6, 8, 10, 12, 14] },
      { tag: "kick", steps: [0, 8] },
      { tag: "vocal", steps: [6] },
      { tag: "kick", steps: [4, 12, 14] },
      { tag: "fx", steps: [10] },
      { tag: "snare", steps: [4] },
    ]);
    // Chosen: vocal(2), fx(4), snare(5), kick with more hits(3). Shown in
    // order of first appearance: 3 and 5 at step 4, then 2 at 6, 4 at 10.
    expect(pickedTrackIds(tracks)).toEqual([3, 5, 2, 4]);
  });

  it("skips muted, showVideo-off and stepless tracks", () => {
    const tracks = makeTracks([
      { tag: "vocal", steps: [0], muted: true },
      { tag: "vocal", steps: [0], showVideo: false },
      { tag: "vocal", steps: [] },
      { tag: "kick", steps: [3] },
      { clip: false, steps: [0] },
    ]);
    expect(pickedTrackIds(tracks)).toEqual([3]);
  });

  it("falls back to sequenced clips, then to any clip", () => {
    const sequencedOnly = makeTracks([
      { steps: [2], showVideo: false },
      { steps: [], tag: "vocal" },
    ]);
    expect(pickedTrackIds(sequencedOnly)).toEqual([0]);

    const unsequenced = makeTracks([{ clip: false }, { steps: [] }, { steps: [], muted: true }]);
    expect(pickedTrackIds(unsequenced)).toEqual([1, 2]);
  });

  it("returns no clips for a project without clips", () => {
    expect(pickCoverClips(makeTracks([{ clip: false, steps: [0] }]))).toEqual([]);
  });

  it("orders the grid by first appearance, ties by track id", () => {
    const tracks = makeTracks([
      { tag: "kick", steps: [8] },
      { tag: "kick", steps: [2] },
      { tag: "kick", steps: [2] },
    ]);
    expect(pickedTrackIds(tracks)).toEqual([1, 2, 0]);
  });
});

describe("coverSlots", () => {
  it("repeats fewer than four clips as AAAA, AB/BA and AB/CA", () => {
    expect(coverSlots(1)).toEqual([0, 0, 0, 0]);
    expect(coverSlots(2)).toEqual([0, 1, 1, 0]);
    expect(coverSlots(3)).toEqual([0, 1, 2, 0]);
    expect(coverSlots(4)).toEqual([0, 1, 2, 3]);
  });
});

describe("tileOrigin", () => {
  it("places four 216 px tiles inside a 16 px margin with a 16 px gutter", () => {
    expect([0, 1, 2, 3].map(tileOrigin)).toEqual([
      { x: 16, y: 16 },
      { x: 248, y: 16 },
      { x: 16, y: 248 },
      { x: 248, y: 248 },
    ]);
  });
});

describe("actionFrameSec", () => {
  it("is 120 ms after the trim start, clamped to the trim midpoint", () => {
    expect(actionFrameSec(makeClip(0, { start: 300, end: 1400 }))).toBeCloseTo(0.42);
    expect(actionFrameSec(makeClip(0, { start: 100, end: 260 }))).toBeCloseTo(0.18);
  });
});

describe("cropSquare", () => {
  it("zooms the centre square 1.25×", () => {
    expect(cropSquare(1280, 720)).toEqual({ sx: 352, sy: 72, side: 576 });
    expect(cropSquare(480, 640)).toEqual({ sx: 48, sy: 128, side: 384 });
  });
});
