// ABOUTME: Central fixed palettes and tuning constants for Mood full-frame vibes.
// ABOUTME: Pulls from Tailwind defaults so vibe colors stay aligned with app swatches.
import colors from "tailwindcss/colors";

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

// Hand-picked fallbacks pending the real-footage tuning session (spec §18.4).
export const PRINT = {
  paper: colors.stone[100],
  ink: colors.stone[900],
} as const;
