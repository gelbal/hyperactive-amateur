// ABOUTME: coverArt tests — which clips the share card shows, where its tiles sit, and the print plates.
// ABOUTME: Pure functions on plain tracks and typed arrays; real pixels are proven in the browser smoke.
import { describe, it, expect } from "vitest";
import {
  COVER_PALETTES,
  INK,
  PLATE,
  TILE_SIZE,
  actionFrameSec,
  coverSlots,
  cropSquare,
  dominantPlateShare,
  paintPlates,
  pickCoverClips,
  pickCoverPalettes,
  showPhotoThrough,
  platesFor,
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

  it("shows no clip the video never shows: none when every clip is audio-only, muted or unsequenced", () => {
    const offScreen = makeTracks([
      { steps: [2], showVideo: false },
      { steps: [4], muted: true },
      { steps: [], tag: "vocal" },
    ]);
    expect(pickCoverClips(offScreen)).toEqual([]);
  });

  it("counts only the steps the render plays", () => {
    const tracks = makeTracks([{ tag: "vocal", steps: [] }, { tag: "kick", steps: [3] }]).map((track) => ({
      ...track,
      steps: [...track.steps, ...Array.from({ length: 16 }, (_, step) => track.id === 0 && step === 4)],
    }));
    // Track 0 plays only at step 20 of a 32-step pattern.
    expect(pickedTrackIds(tracks)).toEqual([1, 0]);
    expect(pickCoverClips(tracks, 16).map((clip) => tracks.findIndex((t) => t.clip === clip))).toEqual([1]);
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

const BEAT: TrackSpec[] = [
  { tag: "kick", steps: [0, 8] },
  { tag: "snare", steps: [4, 12] },
  { tag: "hat", steps: [0, 2, 4, 6, 8, 10, 12, 14] },
  { tag: "vocal", steps: [6] },
];

describe("pickCoverPalettes", () => {
  it("keeps a project's colourways through mix changes and draws new ones for a new take", () => {
    const first = pickCoverPalettes(makeTracks(BEAT));
    const remixed = makeTracks(BEAT).map((track) => ({
      ...track,
      volume: 0.3,
      muted: track.id === 1,
      showVideo: track.id !== 2,
      tag: null,
    }));
    const newTake = makeTracks(BEAT).map((track) =>
      track.id === 3 && track.clip
        ? { ...track, clip: { ...track.clip, blob: new Blob([new Uint8Array(2048)], { type: "video/webm" }) } }
        : track,
    );

    expect(pickCoverPalettes(makeTracks(BEAT))).toEqual(first);
    expect(pickCoverPalettes(remixed)).toEqual(first);
    expect(pickCoverPalettes(newTake)).not.toEqual(first);
  });

  it("draws four different colourways, each of the ten evenly often in every slot as the steps change", () => {
    // A thousand beats that differ only in track 0's sixteen steps.
    const counts = Array.from({ length: 4 }, () => new Map<string, number>());
    let repeats = 0;
    for (let beat = 0; beat < 1000; beat += 1) {
      const steps = Array.from({ length: 16 }, (_, step) => step).filter((step) => (beat >> step) & 1);
      const palettes = pickCoverPalettes(makeTracks([{ tag: "kick", steps }, ...BEAT.slice(1)]));
      if (new Set(palettes).size !== 4) repeats += 1;
      palettes.forEach((palette, slot) => {
        counts[slot].set(palette.field, (counts[slot].get(palette.field) ?? 0) + 1);
      });
    }

    expect(repeats).toBe(0);
    // 100 expected per colourway per slot; the bounds are four deviations.
    for (const slot of counts) {
      expect(slot.size).toBe(10);
      for (const count of slot.values()) {
        expect(count).toBeGreaterThanOrEqual(60);
        expect(count).toBeLessThanOrEqual(140);
      }
    }
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

// A grey tile: `lumAt(dx, dy)` gets the offset from the tile centre.
function greyTile(lumAt: (dx: number, dy: number) => number, size = TILE_SIZE): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const value = lumAt(x + 0.5 - size / 2, y + 0.5 - size / 2);
      const i = (y * size + x) * 4;
      rgba[i] = value;
      rgba[i + 1] = value;
      rgba[i + 2] = value;
      rgba[i + 3] = 255;
    }
  }
  return rgba;
}

function inEllipse(dx: number, dy: number, cx: number, cy: number, rx: number, ry: number): boolean {
  return ((dx - cx) / rx) ** 2 + ((dy - cy) / ry) ** 2 <= 1;
}

// A face under a dark hair cap, with darker eyes and mouth, on `ground`.
function faceTile(ground: (dx: number, dy: number) => number, face = 200): Uint8ClampedArray {
  return greyTile((dx, dy) => {
    if (inEllipse(dx, dy, 0, 22, 12, 5)) return face - 60;
    if (inEllipse(dx, dy, -14, -8, 5, 5) || inEllipse(dx, dy, 14, -8, 5, 5)) return face - 60;
    if (inEllipse(dx, dy, 0, 8, 38, 48)) return face;
    if (inEllipse(dx, dy, 0, 0, 48, 62)) return 30;
    return ground(dx, dy);
  });
}

function plateAt(plates: Uint8Array, dx: number, dy: number, size = TILE_SIZE): number {
  return plates[(size / 2 + dy) * size + size / 2 + dx];
}

function edgeRingInkShare(plates: Uint8Array, size = TILE_SIZE): number {
  let ring = 0;
  let ink = 0;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (x >= 8 && y >= 8 && x < size - 8 && y < size - 8) continue;
      ring += 1;
      if (plates[y * size + x] === PLATE.ink) ink += 1;
    }
  }
  return ink / ring;
}

describe("platesFor", () => {
  it("keeps a dim face's dark eyes as ink and does not print it as one plate", () => {
    const dimFace = greyTile((dx, dy) => {
      if (inEllipse(dx, dy, -14, -8, 5, 5) || inEllipse(dx, dy, 14, -8, 5, 5)) return 60;
      if (inEllipse(dx, dy, 0, 22, 12, 5)) return 55;
      if (inEllipse(dx, dy, 0, 8, 38, 48)) return 95;
      return 45;
    });
    const plates = platesFor(dimFace, TILE_SIZE);

    expect(plateAt(plates, -14, -8)).toBe(PLATE.ink);
    expect(plateAt(plates, 14, -8)).toBe(PLATE.ink);
    expect(plateAt(plates, -24, 20)).toBe(PLATE.face);
    expect(plateAt(plates, -100, -100)).toBe(PLATE.field);
    expect(dominantPlateShare(plates)).toBeLessThan(0.95);
  });

  it("inks only the darkest shadows away from the face: a textured ground keeps its edge ring ≤ 20 % ink", () => {
    // Mid-grey 128 ± 48 in an 8 px checker: local contrast everywhere would
    // ink the core of every dark square (about a quarter of the ground).
    const checker = (dx: number, dy: number) =>
      (Math.floor((dx + 108) / 8) + Math.floor((dy + 108) / 8)) % 2 === 0 ? 80 : 176;
    const plates = platesFor(faceTile(checker), TILE_SIZE);

    expect(edgeRingInkShare(plates)).toBeLessThanOrEqual(0.2);
  });

  it("prints the face colour only around the face: a light ground away from it prints field", () => {
    const plates = platesFor(faceTile(() => 230, 150), TILE_SIZE);

    expect(plateAt(plates, -20, 20)).toBe(PLATE.face);
    expect(plateAt(plates, -100, -100)).toBe(PLATE.field);
    expect(plateAt(plates, 100, 100)).toBe(PLATE.field);
  });

  it("prints a blown-out highlight away from the face as field, not face", () => {
    const plates = platesFor(faceTile(() => 255, 150), TILE_SIZE);

    expect(plateAt(plates, -100, -100)).toBe(PLATE.field);
    expect(plateAt(plates, 100, 100)).toBe(PLATE.field);
  });

  it("prints a flat tile as one flat plate", () => {
    for (const value of [0, 128, 255]) {
      const plates = platesFor(greyTile(() => value), TILE_SIZE);
      expect(dominantPlateShare(plates)).toBe(1);
    }
  });
});

describe("paintPlates", () => {
  it("prints the field and face plates, then the ink plate offset by (+3, +2)", () => {
    const size = 16;
    const plates = new Uint8Array(size * size).fill(PLATE.field);
    plates[2 * size + 2] = PLATE.ink;
    plates[10 * size + 10] = PLATE.face;
    const out = new Uint8ClampedArray(size * size * 4);

    paintPlates(plates, size, COVER_PALETTES[0], out);

    const rgbAt = (x: number, y: number) => {
      const i = (y * size + x) * 4;
      return `#${[out[i], out[i + 1], out[i + 2]].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
    };
    expect(rgbAt(5, 4)).toBe(INK);
    expect(rgbAt(2, 2)).toBe(COVER_PALETTES[0].field);
    expect(rgbAt(10, 10)).toBe(COVER_PALETTES[0].face);
    expect(rgbAt(0, 0)).toBe(COVER_PALETTES[0].field);
    expect(out[3]).toBe(255);
  });
});

describe("showPhotoThrough", () => {
  it("lets 30 % of the photo's grey show through the print", () => {
    // A cyan field over a mid-grey photo, and black ink over a light one.
    const print = new Uint8ClampedArray([0x22, 0xd3, 0xee, 255, 0x09, 0x09, 0x0b, 255]);
    const photo = new Uint8ClampedArray([128, 128, 128, 255, 250, 200, 150, 255]);

    showPhotoThrough(print, photo);

    expect(Array.from(print)).toEqual([62, 186, 205, 255, 69, 69, 70, 255]);
  });
});
