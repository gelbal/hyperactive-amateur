// ABOUTME: coverArt — the pure half of the export's share card: which clips it shows, tile geometry, print plates.
// ABOUTME: Works on plain tracks and typed arrays only, so every rule is testable without a canvas.
import type { Clip, Track } from "../types";
import { tagTier } from "./tagPriority";

export const CARD_SIZE = 480;
export const CARD_MARGIN = 16;
export const CARD_GUTTER = 16;
export const TILE_SIZE = (CARD_SIZE - 2 * CARD_MARGIN - CARD_GUTTER) / 2;

// Cream paper frames the card on dark chat backgrounds, where zinc-950
// vanished; zinc-950 ink is the app's own dark.
export const PAPER = "#f8f6f3";
export const INK = "#09090b";

export interface CoverPalette {
  field: string;
  face: string;
}

// The silkscreen colourways a cover draws its four tiles from, Tailwind
// swatches. The fields step around the colour wheel, so any four drawn
// together stay distinct at thumbnail size; each face is a lighter colour
// that stands apart from its own field.
export const COVER_PALETTES: readonly CoverPalette[] = [
  { field: "#ef4444", face: "#7dd3fc" }, // red-500 / sky-300
  { field: "#f97316", face: "#fef08a" }, // orange-500 (brand) / yellow-200
  { field: "#fbbf24", face: "#c4b5fd" }, // amber-400 / violet-300
  { field: "#a3e635", face: "#fb7185" }, // lime-400 / rose-400
  { field: "#10b981", face: "#f0abfc" }, // emerald-500 / fuchsia-300
  { field: "#22d3ee", face: "#f9a8d4" }, // cyan-400 / pink-300
  { field: "#3b82f6", face: "#fdba74" }, // blue-500 / orange-300
  { field: "#a78bfa", face: "#d9f99d" }, // violet-400 / lime-200
  { field: "#d946ef", face: "#a7f3d0" }, // fuchsia-500 / emerald-200
  { field: "#f472b6", face: "#a5f3fc" }, // pink-400 / cyan-200
];

export const PLATE = { ink: 0, field: 1, face: 2 } as const;

// A decoded frame whose most common plate covers more than this share has
// no picture in it (a black warm-up frame, a covered lens).
export const FLAT_PLATE_SHARE = 0.95;

// The face zone: full strength inside 0.30 of the tile size from the
// centre, fading out by 0.46, so plate edges follow hair and shoulders
// instead of printing a circle.
export const FACE_ZONE: readonly [number, number] = [0.3, 0.46];
// Ink is the darkest fifth of the metered centre; the face plate starts at
// its 55th percentile, which keeps a dim or dark-skinned face in its colour
// instead of in ink. Metering the centre half reads the face, not the room.
export const INK_PERCENTILE = 0.2;
export const FACE_PERCENTILE = 0.55;
// Inside the face zone a pixel also inks when it is this much darker than
// its neighbourhood, which keeps eyes and mouths on dim faces.
const LOCAL_INK_RATIO = 0.85;
const LOCAL_MEAN_RADIUS = 12;
const DENOISE_RADIUS = 2;
const METER_SHARE = 0.5;
// A tile whose metered spread is below this many levels has nothing to
// print (a black warm-up frame, a covered lens): it prints one flat plate.
const MIN_PLATE_SPREAD = 8;
// Pixel offset of the ink plate: the silkscreen misregistration.
const INK_OFFSET = { x: 3, y: 2 };
// The print is laid over the photo's grey at this share, so the photograph's
// shading stays readable through the flat plates and faces are easy to see.
const PHOTO_SHOW_THROUGH = 0.3;

const COVER_TILE_COUNT = 4;
// The action frame sits this long after the trim start (autoTrim starts
// 50 ms before the onset), when the mouth is open on the sound.
const ACTION_FRAME_OFFSET_MS = 120;
// Webcam framing leaves room around the face; a tighter crop reads as a
// head shot at thumbnail size.
const CROP_ZOOM = 1.25;

function activeStepCount(track: Track, renderedSteps: number): number {
  return track.steps.slice(0, renderedSteps).filter(Boolean).length;
}

function firstActiveStep(track: Track, renderedSteps: number): number {
  const step = track.steps.slice(0, renderedSteps).indexOf(true);
  return step === -1 ? Number.POSITIVE_INFINITY : step;
}

// Up to four clips the exported video shows, in grid order (order of first
// appearance in the pattern). Only the first `renderedSteps` steps count:
// a short render of a long pattern never reaches the rest. A clip set to
// audio only, muted or not played never appears on the cover; with none
// left the card is flat.
export function pickCoverClips(
  tracks: readonly Track[],
  renderedSteps = Number.POSITIVE_INFINITY,
): Clip[] {
  const steps = (track: Track) => activeStepCount(track, renderedSteps);
  const first = (track: Track) => firstActiveStep(track, renderedSteps);
  return tracks
    .filter((track) => track.clip && track.showVideo && !track.muted && steps(track) > 0)
    // Highest visual tier first (the clips that win cuts), then the
    // busiest, then track order.
    .sort((a, b) => tagTier(b.tag) - tagTier(a.tag) || steps(b) - steps(a) || a.id - b.id)
    .slice(0, COVER_TILE_COUNT)
    .sort((a, b) => first(a) - first(b) || a.id - b.id)
    .map((track) => track.clip as Clip);
}

// Which clip each of the four tiles shows. Fewer clips repeat like a
// Warhol sheet: AAAA, AB/BA, AB/CA.
export function coverSlots(clipCount: number): number[] {
  switch (clipCount) {
    case 1:
      return [0, 0, 0, 0];
    case 2:
      return [0, 1, 1, 0];
    case 3:
      return [0, 1, 2, 0];
    default:
      return [0, 1, 2, 3];
  }
}

// What the user built, as text: every track's steps and the byte size of its
// clip, which differs from take to take. Mix settings (volume, mute, tag,
// video on/off) are left out, so they never recolour the cover.
function projectKey(tracks: readonly Track[]): string {
  return tracks
    .map((track) => `${track.steps.map((on) => (on ? "x" : ".")).join("")}:${track.clip?.blob.size ?? "-"}`)
    .join("|");
}

// FNV-1a: a stable 32-bit hash of a string's UTF-16 code units.
function hashString(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193);
  }
  return hash >>> 0;
}

// mulberry32: a small seeded generator of floats in [0, 1).
function seededRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Four different colourways for the four tiles, drawn from the ten by a
// generator seeded with the project: the same beat and takes always print
// the same cover, so the preview shows what the export prints, and a changed
// step or a new take draws other colours.
export function pickCoverPalettes(tracks: readonly Track[]): CoverPalette[] {
  const random = seededRandom(hashString(projectKey(tracks)));
  const pool = [...COVER_PALETTES];
  // The first steps of a Fisher-Yates shuffle.
  for (let i = 0; i < COVER_TILE_COUNT; i += 1) {
    const j = i + Math.floor(random() * (pool.length - i));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, COVER_TILE_COUNT);
}

export function tileOrigin(slot: number): { x: number; y: number } {
  const step = TILE_SIZE + CARD_GUTTER;
  return {
    x: CARD_MARGIN + (slot % 2) * step,
    y: CARD_MARGIN + Math.floor(slot / 2) * step,
  };
}

export function actionFrameSec(clip: Clip): number {
  const midpointMs = (clip.trimStartMs + clip.trimEndMs) / 2;
  return Math.min(clip.trimStartMs + ACTION_FRAME_OFFSET_MS, midpointMs) / 1000;
}

export function cropSquare(width: number, height: number): { sx: number; sy: number; side: number } {
  const side = Math.min(width, height) / CROP_ZOOM;
  return { sx: (width - side) / 2, sy: (height - side) / 2, side };
}

// Box mean of `values` (size × size) over a (2r + 1)² window clipped to the
// tile, through a summed-area table.
function boxMean(values: Float32Array, size: number, radius: number): Float32Array {
  const stride = size + 1;
  const sums = new Float64Array(stride * stride);
  for (let y = 0; y < size; y += 1) {
    let row = 0;
    for (let x = 0; x < size; x += 1) {
      row += values[y * size + x];
      sums[(y + 1) * stride + x + 1] = sums[y * stride + x + 1] + row;
    }
  }
  const means = new Float32Array(values.length);
  for (let y = 0; y < size; y += 1) {
    const y0 = Math.max(0, y - radius);
    const y1 = Math.min(size, y + radius + 1);
    for (let x = 0; x < size; x += 1) {
      const x0 = Math.max(0, x - radius);
      const x1 = Math.min(size, x + radius + 1);
      const sum =
        sums[y1 * stride + x1] - sums[y0 * stride + x1] - sums[y1 * stride + x0] + sums[y0 * stride + x0];
      means[y * size + x] = sum / ((x1 - x0) * (y1 - y0));
    }
  }
  return means;
}

function meteredPercentiles(lum: Float32Array, size: number): { ink: number; face: number } {
  const start = Math.round((size * (1 - METER_SHARE)) / 2);
  const end = size - start;
  const metered = new Float32Array((end - start) * (end - start));
  let n = 0;
  for (let y = start; y < end; y += 1) {
    for (let x = start; x < end; x += 1) metered[n++] = lum[y * size + x];
  }
  metered.sort();
  const at = (share: number) => metered[Math.min(metered.length - 1, Math.floor(share * metered.length))];
  return { ink: at(INK_PERCENTILE), face: at(FACE_PERCENTILE) };
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

// Separates a square RGBA tile into silkscreen plates (PLATE values, one
// per pixel): a black ink key, a face plate around the face, and a flat
// field everywhere else.
export function platesFor(rgba: Uint8ClampedArray, size: number): Uint8Array {
  const raw = new Float32Array(size * size);
  for (let i = 0; i < raw.length; i += 1) {
    raw[i] = 0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2];
  }
  const lum = boxMean(raw, size, DENOISE_RADIUS);
  const plates = new Uint8Array(size * size).fill(PLATE.field);
  const metered = meteredPercentiles(lum, size);
  if (metered.face - metered.ink < MIN_PLATE_SPREAD) return plates;

  const local = boxMean(lum, size, LOCAL_MEAN_RADIUS);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const i = y * size + x;
      const r = Math.hypot(x + 0.5 - size / 2, y + 0.5 - size / 2) / size;
      const away = smoothstep(FACE_ZONE[0], FACE_ZONE[1], r);
      const value = lum[i];
      if (value < metered.ink || value < local[i] * LOCAL_INK_RATIO * (1 - away)) {
        plates[i] = PLATE.ink;
      } else if (away < 1 && value >= metered.face + away * (255 - metered.face)) {
        plates[i] = PLATE.face;
      }
    }
  }
  return plates;
}

// Share of the most common plate: near 1 means the tile has no picture.
export function dominantPlateShare(plates: Uint8Array): number {
  const counts = [0, 0, 0];
  for (const plate of plates) counts[plate] += 1;
  return Math.max(...counts) / plates.length;
}

function rgbOf(hex: string): [number, number, number] {
  return [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16)) as [number, number, number];
}

// Prints plates into `out` (RGBA, size × size): the field and face plates
// in register, then the ink plate offset like a hand-pulled screen.
export function paintPlates(
  plates: Uint8Array,
  size: number,
  palette: CoverPalette,
  out: Uint8ClampedArray,
): void {
  const ink = rgbOf(INK);
  const field = rgbOf(palette.field);
  const face = rgbOf(palette.face);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const i = y * size + x;
      const sx = x - INK_OFFSET.x;
      const sy = y - INK_OFFSET.y;
      const inked = sx >= 0 && sy >= 0 && plates[sy * size + sx] === PLATE.ink;
      const colour = inked ? ink : plates[i] === PLATE.face ? face : field;
      out[i * 4] = colour[0];
      out[i * 4 + 1] = colour[1];
      out[i * 4 + 2] = colour[2];
      out[i * 4 + 3] = 255;
    }
  }
}

// Lays the printed tile over the photo's grey: each channel keeps 70 % of
// the print and takes 30 % of the photo's luminance. `photo` is the tile
// before printing, same size as `print`.
export function showPhotoThrough(print: Uint8ClampedArray, photo: Uint8ClampedArray): void {
  for (let i = 0; i < print.length; i += 4) {
    const grey = 0.299 * photo[i] + 0.587 * photo[i + 1] + 0.114 * photo[i + 2];
    for (let channel = 0; channel < 3; channel += 1) {
      print[i + channel] = (1 - PHOTO_SHOW_THROUGH) * print[i + channel] + PHOTO_SHOW_THROUGH * grey;
    }
  }
}
