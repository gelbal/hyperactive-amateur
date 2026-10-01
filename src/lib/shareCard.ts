// ABOUTME: shareCard — loads a cover tile per clip (action frame, poster, or flat) and composes the share card.
// ABOUTME: Loading is the only async step; composing is synchronous, so a redraw never decodes.
import { useAppStore } from "../store/useAppStore";
import type { Clip } from "../types";
import {
  CARD_SIZE,
  COVER_PALETTES,
  FLAT_PLATE_SHARE,
  INK,
  PAPER,
  TILE_SIZE,
  actionFrameSec,
  coverSlots,
  cropSquare,
  dominantPlateShare,
  paintPlates,
  platesFor,
  showPhotoThrough,
  tileOrigin,
} from "./coverArt";
import { LOG_EVENTS, logger } from "./logger";
import { captureFirstFrame } from "./posterFrame";

export const COVER_FRAME_TIMEOUT_MS = 700;

// One tile per clip in grid order; null prints as a flat field.
export type CoverTiles = (HTMLCanvasElement | null)[];

const LABEL_FONT = 'ui-sans-serif, system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif';
const NAME_FONT_PX = 30;
const NAME_LINE_PX = 32;
const NAME_PADDING_PX = 10;

// Keyed on the clip's blob: the store replaces Clip objects around the same
// blob (a poster attach, an audio repair), so an object key would miss right
// after recording. A hit also needs the same action-frame time, so a trim
// change decodes again. Only decoded action frames are kept.
let tileCache = new WeakMap<Blob, { sec: number; tile: HTMLCanvasElement }>();
// One video decode at a time across overlapping loads (a reopen mid-load, a
// poster attach re-running the panel's load); iOS caps concurrent decoders.
let frameQueue: Promise<unknown> = Promise.resolve();

// Action frames decode only while nothing plays or records: an export's
// claim leaves this open through its cover wait, and starting the transport
// closes it before the recorder starts.
function canDecodeCoverFrames(): boolean {
  const { playback, recording } = useAppStore.getState();
  return !playback.isPlaying && recording.state === "idle";
}

function makeCanvas(size: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  return canvas;
}

// Decodes an image and keeps only its zoomed centre square at tile size.
async function decodeTile(image: Blob | null): Promise<HTMLCanvasElement | null> {
  if (!image) return null;
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(image);
  } catch {
    return null;
  }
  try {
    const tile = makeCanvas(TILE_SIZE);
    const ctx = tile.getContext("2d");
    if (!ctx) return null;
    const { sx, sy, side } = cropSquare(bitmap.width, bitmap.height);
    ctx.drawImage(bitmap, sx, sy, side, side, 0, 0, TILE_SIZE, TILE_SIZE);
    return tile;
  } finally {
    bitmap.close();
  }
}

function tilePixels(tile: HTMLCanvasElement): ImageData | null {
  return tile.getContext("2d")?.getImageData(0, 0, TILE_SIZE, TILE_SIZE) ?? null;
}

// A tile's plates, separated once: tiles are never drawn into after they are
// made, and every compose (the preview, the export, each repeated slot)
// prints the same plates.
const tilePlates = new WeakMap<HTMLCanvasElement, Uint8Array>();

function platesOf(tile: HTMLCanvasElement, pixels: ImageData): Uint8Array {
  let plates = tilePlates.get(tile);
  if (!plates) {
    plates = platesFor(pixels.data, TILE_SIZE);
    tilePlates.set(tile, plates);
  }
  return plates;
}

function isFlatTile(tile: HTMLCanvasElement): boolean {
  const pixels = tilePixels(tile);
  return !pixels || dominantPlateShare(platesOf(tile, pixels)) > FLAT_PLATE_SHARE;
}

// Decodes a clip's action frame, and stops the decode the moment playback,
// recording or an export's transport starts (the decode gate closes), so the
// off-screen video never overlaps them.
async function decodeActionFrame(blob: Blob, sec: number): Promise<{ frame: Blob | null; stopped: boolean }> {
  const controller = new AbortController();
  const unsubscribe = useAppStore.subscribe(() => {
    if (!canDecodeCoverFrames()) controller.abort();
  });
  try {
    const frame = await captureFirstFrame(blob, sec, COVER_FRAME_TIMEOUT_MS, controller.signal);
    return { frame, stopped: controller.signal.aborted };
  } finally {
    unsubscribe();
  }
}

async function loadTileNow(clip: Clip): Promise<HTMLCanvasElement | null> {
  if (typeof createImageBitmap !== "function") return null;
  const sec = actionFrameSec(clip);
  const cached = tileCache.get(clip.blob);
  if (cached?.sec === sec) return cached.tile;
  if (canDecodeCoverFrames()) {
    const { frame, stopped } = await decodeActionFrame(clip.blob, sec);
    if (!stopped) {
      const tile = await decodeTile(frame);
      if (tile && !isFlatTile(tile)) {
        tileCache.set(clip.blob, { sec, tile });
        return tile;
      }
      logger.warn(LOG_EVENTS.COVER_FAILED, { stage: "frame", sec });
    }
  }
  return decodeTile(clip.posterBlob);
}

// Tiles for the picked clips, in grid order. Never rejects; a clip whose
// action frame cannot decode uses its poster, then a flat tile.
export async function loadCoverTiles(clips: readonly Clip[]): Promise<CoverTiles> {
  const tiles: CoverTiles = [];
  for (const clip of clips) {
    const turn = frameQueue.then(() => loadTileNow(clip));
    frameQueue = turn.catch(() => undefined);
    tiles.push(await turn);
  }
  return tiles;
}

function printTile(card: CanvasRenderingContext2D, tile: HTMLCanvasElement | null, slot: number): void {
  const { x, y } = tileOrigin(slot);
  const palette = COVER_PALETTES[slot];
  const pixels = tile ? tilePixels(tile) : null;
  if (!tile || !pixels) {
    card.fillStyle = palette.field;
    card.fillRect(x, y, TILE_SIZE, TILE_SIZE);
    return;
  }
  const photo = new Uint8ClampedArray(pixels.data);
  paintPlates(platesOf(tile, pixels), TILE_SIZE, palette, pixels.data);
  showPhotoThrough(pixels.data, photo);
  card.putImageData(pixels, x, y);
}

function drawName(card: CanvasRenderingContext2D): void {
  const lines = ["HYPERACTIVE", "AMATEUR"];
  card.font = `900 ${NAME_FONT_PX}px ${LABEL_FONT}`;
  card.textAlign = "center";
  card.textBaseline = "middle";
  const width = Math.max(...lines.map((line) => card.measureText(line).width)) + 2 * NAME_PADDING_PX;
  const height = lines.length * NAME_LINE_PX + 2 * NAME_PADDING_PX;
  const centre = CARD_SIZE / 2;
  card.fillStyle = INK;
  card.fillRect(centre - width / 2, centre - height / 2, width, height);
  card.fillStyle = PAPER;
  lines.forEach((line, index) => {
    card.fillText(line, centre, centre + (index - (lines.length - 1) / 2) * NAME_LINE_PX);
  });
}

// The 480 px share card: paper, four printed tiles (clips repeat AAAA,
// AB/BA, AB/CA), then the name across the gutter crossing. Throws only on a
// bug.
export function composeShareCard(tiles: CoverTiles): HTMLCanvasElement {
  const card = makeCanvas(CARD_SIZE);
  const ctx = card.getContext("2d");
  if (!ctx) return card;
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, CARD_SIZE, CARD_SIZE);
  coverSlots(tiles.length).forEach((tileIndex, slot) => printTile(ctx, tiles[tileIndex] ?? null, slot));
  drawName(ctx);
  return card;
}

export function __resetShareCardForTesting(): void {
  tileCache = new WeakMap();
  frameQueue = Promise.resolve();
}
