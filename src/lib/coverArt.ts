// ABOUTME: coverArt — the pure half of the export's share card: which clips it shows, tile geometry, print plates.
// ABOUTME: Works on plain tracks and typed arrays only, so every rule is testable without a canvas.
import type { Clip, Track } from "../types";
import { tagTier } from "./tagPriority";

export const CARD_SIZE = 480;
export const CARD_MARGIN = 16;
export const CARD_GUTTER = 16;
export const TILE_SIZE = (CARD_SIZE - 2 * CARD_MARGIN - CARD_GUTTER) / 2;

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
