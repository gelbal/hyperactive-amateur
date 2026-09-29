// ABOUTME: Central fixed palettes and tuning constants for Mood full-frame vibes.
// ABOUTME: Pulls from Tailwind defaults so vibe colors stay aligned with app swatches.
import colors from "tailwindcss/colors";
import type { MoodVibeId } from "../types";

// Hand-picked fallbacks pending the real-footage tuning session (spec §18.4).
export const MIXTAPE = {
  shadow: colors.zinc[950],
  highlight: colors.orange[500],
} as const;

// Hand-picked fallbacks pending the real-footage tuning session (spec §18.4).
export const CAMCORDER = {
  scanlineAlpha: 0.22,
  chromaAlpha: 0.22,
  chromaOffsetPx: 2,
  chromaLeft: colors.cyan[400],
  chromaRight: colors.red[500],
  noiseAlpha: 0.08,
  noiseTileSize: 64,
} as const;

export const CAMCORDER_NOISE_TILE_COUNT = 4;
export const CAMCORDER_NOISE_HOLD_SECONDS = 1 / 15;

export const GHOST = {
  echoAlphas: [0.22, 0.14, 0.08],
  feedbackAlpha: 0.72,
} as const;

export const SOLAR = {
  pale: colors.white,
  orange: colors.orange[500],
  zinc: colors.zinc[950],
  orangeAlpha: 0.8,
  zincAlpha: 0.45,
} as const;

export const WEAVE = {
  wash: colors.amber[200],
  gate: colors.stone[950],
  scratch: colors.stone[200],
  washAlpha: 0.12,
  scratchAlpha: 0.28,
  swayXPx: 2.5,
  swayYPx: 1.25,
  spliceBumpPx: 7,
  scratchTileSize: 96,
} as const;

export const WEAVE_SCRATCH_TILE_COUNT = 4;

export const CROSSROLL = {
  bar: colors.zinc[950],
  sprocket: colors.white,
  seamHeightPx: 24,
  sprocketRadiusPx: 3,
  sprocketGapPx: 24,
} as const;

// Hand-picked fallbacks pending the real-footage tuning session (spec §18.4).
export const PRINT = {
  paper: colors.stone[100],
  ink: colors.stone[900],
} as const;

export const DROP_FLASH_ACCENTS = {
  clean: colors.zinc[100],
  print: PRINT.paper,
  mixtape: MIXTAPE.highlight,
  blocks: colors.orange[500],
  camcorder: CAMCORDER.chromaLeft,
  kaleido: colors.violet[400],
  weave: WEAVE.wash,
  crossroll: colors.white,
  ghost: colors.teal[300],
  solar: SOLAR.orange,
} as const satisfies Record<MoodVibeId, string>;

export const DROP_FLASH_WHITEWARD = colors.stone[50];
