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

// One silkscreen colourway per tile, Tailwind swatches: cyan-400/pink-300,
// orange-500 (brand)/yellow-200, red-500/sky-300, lime-400/rose-400.
export const COVER_PALETTES: readonly CoverPalette[] = [
  { field: "#22d3ee", face: "#f9a8d4" },
  { field: "#f97316", face: "#fef08a" },
  { field: "#ef4444", face: "#7dd3fc" },
  { field: "#a3e635", face: "#fb7185" },
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

function activeStepCount(track: Track): number {
  return track.steps.filter(Boolean).length;
}

function firstActiveStep(track: Track): number {
  const step = track.steps.indexOf(true);
  return step === -1 ? Number.POSITIVE_INFINITY : step;
}

// Highest visual tier first (the clips that win cuts), then the busiest,
// then track order.
function byScreenTime(a: Track, b: Track): number {
  return (
    tagTier(b.tag) - tagTier(a.tag) ||
    activeStepCount(b) - activeStepCount(a) ||
    a.id - b.id
  );
}

function byFirstAppearance(a: Track, b: Track): number {
  return firstActiveStep(a) - firstActiveStep(b) || a.id - b.id;
}

// Up to four clips the exported video shows, in grid order (order of first
// appearance in the pattern). Falls back to sequenced clips, then to any
// clip, when no clip would appear on screen.
export function pickCoverClips(tracks: readonly Track[]): Clip[] {
  const withClip = tracks.filter((track) => track.clip);
  const sequenced = withClip.filter((track) => activeStepCount(track) > 0);
  const onScreen = sequenced.filter((track) => track.showVideo && !track.muted);
  const pool = [onScreen, sequenced, withClip].find((candidates) => candidates.length > 0) ?? [];
  return [...pool]
    .sort(byScreenTime)
    .slice(0, COVER_TILE_COUNT)
    .sort(byFirstAppearance)
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
      } else if (value >= metered.face + away * (255 - metered.face)) {
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
