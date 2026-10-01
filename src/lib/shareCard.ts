// ABOUTME: shareCard — loads a cover tile per clip (action frame, poster, or flat) and composes the share card.
// ABOUTME: Loading is the only async step; composing is synchronous, so a label change never decodes.
import roundelUrl from "../assets/ha-roundel.png";
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
  tileOrigin,
  type CoverLabel,
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
const SIGNED_FONT_PX = 15;
const SIGNED_STROKE_PX = 3;
const SIGNED_INSET_PX = 24;
const ROUNDEL_RADIUS_PX = 52;
const ROUNDEL_RING_PX = 6;
// The roundel art's own cream ring sits inside its square; drawn this much
// larger than the clip, the ring meets the clip edge.
const ROUNDEL_DRAW_SCALE = 1.12;

// Keyed on the clip's blob: the store replaces Clip objects around the same
// blob (a poster attach, an audio repair), so an object key would miss right
// after recording. A hit also needs the same action-frame time, so a trim
// change decodes again. Only decoded action frames are kept.
let tileCache = new WeakMap<Blob, { sec: number; tile: HTMLCanvasElement }>();
// One video decode at a time across overlapping loads (a reopen mid-load, a
// poster attach re-running the panel's load); iOS caps concurrent decoders.
let frameQueue: Promise<unknown> = Promise.resolve();
let roundel: Promise<ImageBitmap | null> | null = null;

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

function isFlatTile(tile: HTMLCanvasElement): boolean {
  const pixels = tilePixels(tile);
  return !pixels || dominantPlateShare(platesFor(pixels.data, TILE_SIZE)) > FLAT_PLATE_SHARE;
}

async function loadTileNow(clip: Clip): Promise<HTMLCanvasElement | null> {
  if (typeof createImageBitmap !== "function") return null;
  const sec = actionFrameSec(clip);
  const cached = tileCache.get(clip.blob);
  if (cached?.sec === sec) return cached.tile;
  if (canDecodeCoverFrames()) {
    const frame = await captureFirstFrame(clip.blob, sec, COVER_FRAME_TIMEOUT_MS);
    const tile = await decodeTile(frame);
    if (tile && !isFlatTile(tile)) {
      tileCache.set(clip.blob, { sec, tile });
      return tile;
    }
    logger.warn(LOG_EVENTS.COVER_FAILED, { stage: "frame", sec });
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

// The "ha" roundel, bundled so the service worker precaches it. A failed
// load resolves null and is retried next time.
export function loadRoundel(): Promise<ImageBitmap | null> {
  if (roundel) return roundel;
  if (typeof createImageBitmap !== "function" || typeof fetch !== "function") {
    return Promise.resolve(null);
  }
  const loading = fetch(roundelUrl)
    .then((response) => (response.ok ? response.blob() : Promise.reject(new Error("roundel"))))
    .then((blob) => createImageBitmap(blob))
    .catch(() => {
      roundel = null;
      return null;
    });
  roundel = loading;
  return loading;
}

function printTile(card: CanvasRenderingContext2D, tile: HTMLCanvasElement | null, slot: number): void {
  const { x, y } = tileOrigin(slot);
  const palette = COVER_PALETTES[slot];
  const pixels = tile ? tilePixels(tile) : null;
  if (!pixels) {
    card.fillStyle = palette.field;
    card.fillRect(x, y, TILE_SIZE, TILE_SIZE);
    return;
  }
  paintPlates(platesFor(pixels.data, TILE_SIZE), TILE_SIZE, palette, pixels.data);
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

function drawSigned(card: CanvasRenderingContext2D): void {
  const corner = CARD_SIZE - SIGNED_INSET_PX;
  card.font = `900 ${SIGNED_FONT_PX}px ${LABEL_FONT}`;
  card.textAlign = "right";
  card.textBaseline = "alphabetic";
  card.lineJoin = "round";
  card.lineWidth = SIGNED_STROKE_PX;
  card.strokeStyle = INK;
  card.strokeText("hyperactive amateur", corner, corner);
  card.fillStyle = PAPER;
  card.fillText("hyperactive amateur", corner, corner);
}

// The roundel's source has black corners, so it is clipped to its circle,
// on a cream disc that rings it.
function drawRoundel(card: CanvasRenderingContext2D, art: CanvasImageSource): void {
  const centre = CARD_SIZE / 2;
  const size = ROUNDEL_RADIUS_PX * 2 * ROUNDEL_DRAW_SCALE;
  card.fillStyle = PAPER;
  card.beginPath();
  card.arc(centre, centre, ROUNDEL_RADIUS_PX + ROUNDEL_RING_PX, 0, Math.PI * 2);
  card.fill();
  card.save();
  card.beginPath();
  card.arc(centre, centre, ROUNDEL_RADIUS_PX, 0, Math.PI * 2);
  card.clip();
  card.drawImage(art, centre - size / 2, centre - size / 2, size, size);
  card.restore();
}

// The 480 px share card: paper, four printed tiles (clips repeat AAAA,
// AB/BA, AB/CA), then the label. Throws only on a bug.
export function composeShareCard(
  tiles: CoverTiles,
  label: Exclude<CoverLabel, "off">,
  roundelArt: CanvasImageSource | null,
): HTMLCanvasElement {
  const card = makeCanvas(CARD_SIZE);
  const ctx = card.getContext("2d");
  if (!ctx) return card;
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, CARD_SIZE, CARD_SIZE);
  coverSlots(tiles.length).forEach((tileIndex, slot) => printTile(ctx, tiles[tileIndex] ?? null, slot));
  if (label === "name") drawName(ctx);
  if (label === "signed") drawSigned(ctx);
  if (label === "logo") {
    if (roundelArt) {
      drawRoundel(ctx, roundelArt);
    } else {
      logger.warn(LOG_EVENTS.COVER_FAILED, { stage: "roundel" });
      drawName(ctx);
    }
  }
  return card;
}

export function __resetShareCardForTesting(): void {
  tileCache = new WeakMap();
  frameQueue = Promise.resolve();
  roundel = null;
}
