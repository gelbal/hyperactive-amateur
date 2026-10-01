// ABOUTME: shareCard tests — loading cover tiles (decode gate, one decoder at a time, blob-keyed cache)
// ABOUTME: and composing the 480 px card with its labels, on recording canvases and stubbed decoders.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./posterFrame", () => ({ captureFirstFrame: vi.fn() }));

import { captureFirstFrame } from "./posterFrame";
import {
  COVER_FRAME_TIMEOUT_MS,
  __resetShareCardForTesting,
  composeShareCard,
  loadCoverTiles,
} from "./shareCard";
import { COVER_PALETTES, PAPER, TILE_SIZE, tileOrigin } from "./coverArt";
import { LOG_EVENTS, logger } from "./logger";
import { useAppStore } from "../store/useAppStore";
import { fakeBitmap, installRecordingCanvas, type CanvasCall } from "../test-utils/canvasRecorder";
import type { Clip } from "../types";

const capture = vi.mocked(captureFirstFrame);

// A face under dark hair on a mid-grey ground: prints three plates.
function faceRgba(): Uint8ClampedArray {
  const size = TILE_SIZE;
  const rgba = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const dx = x + 0.5 - size / 2;
      const dy = y + 0.5 - size / 2;
      const inFace = (dx / 38) ** 2 + ((dy - 8) / 48) ** 2 <= 1;
      const inHair = (dx / 48) ** 2 + (dy / 62) ** 2 <= 1;
      const value = inFace ? 200 : inHair ? 30 : 120;
      rgba.set([value, value, value, 255], (y * size + x) * 4);
    }
  }
  return rgba;
}

function flatRgba(value = 0): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(TILE_SIZE * TILE_SIZE * 4).fill(value);
  for (let i = 3; i < rgba.length; i += 4) rgba[i] = 255;
  return rgba;
}

// Each fake JPEG decodes to the pixels registered for it.
const decoded = new Map<Blob, Uint8ClampedArray>();
const bitmaps: ReturnType<typeof fakeBitmap>[] = [];

function jpegOf(rgba: Uint8ClampedArray): Blob {
  const jpeg = new Blob([new Uint8Array([decoded.size])], { type: "image/jpeg" });
  decoded.set(jpeg, rgba);
  return jpeg;
}

function makeClip(id: number, poster: Blob | null = null): Clip {
  return {
    blob: new Blob([new Uint8Array([id])], { type: "video/webm" }),
    url: `blob:test/${id}`,
    audioBuffer: { duration: 1, sampleRate: 48000 } as AudioBuffer,
    audioStatus: "ok",
    trimStartMs: 300,
    trimEndMs: 1400,
    durationMs: 1500,
    posterBlob: poster,
    posterUrl: poster ? `blob:test/poster-${id}` : null,
  };
}

interface Deferred {
  resolve: (jpeg: Blob | null) => void;
}

// captureFirstFrame calls stay pending until resolved, one deferred each.
function deferCaptures(): { pending: Deferred[]; maxInFlight: () => number } {
  const pending: Deferred[] = [];
  let inFlight = 0;
  let max = 0;
  capture.mockImplementation(
    () =>
      new Promise<Blob | null>((resolve) => {
        inFlight += 1;
        max = Math.max(max, inFlight);
        pending.push({
          resolve: (jpeg) => {
            inFlight -= 1;
            resolve(jpeg);
          },
        });
      }),
  );
  return { pending, maxInFlight: () => max };
}

let callsOf: (canvas: HTMLCanvasElement) => CanvasCall[];

function opsOf(canvas: HTMLCanvasElement): string[] {
  return callsOf(canvas).map((call) => call.op);
}

describe("loadCoverTiles", () => {
  beforeEach(() => {
    ({ callsOf } = installRecordingCanvas());
    decoded.clear();
    bitmaps.length = 0;
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(async (blob: Blob) => {
        const bitmap = fakeBitmap(decoded.get(blob) ?? flatRgba());
        bitmaps.push(bitmap);
        return bitmap;
      }),
    );
    capture.mockReset();
    __resetShareCardForTesting();
    useAppStore.getState().actions.setIsExporting(false);
    useAppStore.getState().actions.reset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("decodes the action frame 120 ms after the trim start, with the cover timeout", async () => {
    capture.mockResolvedValue(jpegOf(faceRgba()));
    const clip = makeClip(1);

    const [tile] = await loadCoverTiles([clip]);

    expect(capture).toHaveBeenCalledWith(clip.blob, 0.42, COVER_FRAME_TIMEOUT_MS, expect.any(AbortSignal));
    expect(tile?.width).toBe(TILE_SIZE);
    expect(tile?.height).toBe(TILE_SIZE);
  });

  it("decodes one tile at a time across overlapping loads", async () => {
    const { pending, maxInFlight } = deferCaptures();
    const clips = [makeClip(1), makeClip(2)];

    const first = loadCoverTiles(clips);
    const second = loadCoverTiles(clips);
    for (let turn = 0; turn < 2; turn += 1) {
      await vi.waitFor(() => expect(pending).toHaveLength(turn + 1));
      pending[turn].resolve(jpegOf(faceRgba()));
    }
    const [a, b] = await Promise.all([first, second]);

    expect(maxInFlight()).toBe(1);
    expect(capture).toHaveBeenCalledTimes(2);
    expect(b).toEqual(a);
  });

  it("keeps decoding through the cover wait and stops once the transport starts, filling the rest from posters", async () => {
    const { pending } = deferCaptures();
    const clips = [1, 2, 3].map((id) => makeClip(id, jpegOf(faceRgba())));
    useAppStore.getState().actions.setIsExporting(true);

    const loading = loadCoverTiles(clips);
    await vi.waitFor(() => expect(pending).toHaveLength(1));
    useAppStore.getState().actions.setIsPlaying(true);
    pending[0].resolve(jpegOf(faceRgba()));
    const tiles = await loading;

    expect(capture).toHaveBeenCalledTimes(1);
    expect(tiles.every((tile) => tile !== null)).toBe(true);
  });

  it("stops a decode in flight when the transport starts, and uses the poster without a warning", async () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => undefined);
    const { pending } = deferCaptures();
    const loading = loadCoverTiles([makeClip(1, jpegOf(faceRgba()))]);
    await vi.waitFor(() => expect(pending).toHaveLength(1));
    const signal = capture.mock.calls[0][3] as AbortSignal;
    expect(signal.aborted).toBe(false);

    useAppStore.getState().actions.setIsPlaying(true);
    expect(signal.aborted).toBe(true);
    pending[0].resolve(null);
    const [tile] = await loading;

    expect(tile).not.toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });

  it("stops a decode in flight when a pad or key plays a clip", async () => {
    const { pending } = deferCaptures();
    const loading = loadCoverTiles([makeClip(1, jpegOf(faceRgba()))]);
    await vi.waitFor(() => expect(pending).toHaveLength(1));
    const signal = capture.mock.calls[0][3] as AbortSignal;

    useAppStore.getState().actions.markTriggered(2);
    expect(signal.aborted).toBe(true);
    pending[0].resolve(null);

    await expect(loading).resolves.toHaveLength(1);
  });

  it("prints a tile that fails to draw as flat, warning, without rejecting the load", async () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => undefined);
    capture.mockResolvedValue(jpegOf(faceRgba()));
    vi.mocked(createImageBitmap).mockImplementation((async () => {
      const broken = fakeBitmap(faceRgba());
      Object.defineProperty(broken, "rgba", {
        get: () => {
          throw new DOMException("detached", "InvalidStateError");
        },
      });
      return broken;
    }) as unknown as typeof createImageBitmap);

    await expect(loadCoverTiles([makeClip(1, jpegOf(faceRgba()))])).resolves.toEqual([null]);
    expect(warn).toHaveBeenCalledWith(LOG_EVENTS.COVER_FAILED, { stage: "frame", sec: 0.42 });
  });

  it("falls back from the action frame to the poster, then to a flat tile, warning each miss", async () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => undefined);
    capture.mockResolvedValue(null);
    const withPoster = makeClip(1, jpegOf(faceRgba()));
    const withoutPoster = makeClip(2);

    const [posterTile, flatTile] = await loadCoverTiles([withPoster, withoutPoster]);

    expect(posterTile).not.toBeNull();
    expect(flatTile).toBeNull();
    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledWith(LOG_EVENTS.COVER_FAILED, { stage: "frame", sec: 0.42 });
  });

  it("treats a flat action frame as a failed decode and uses the poster", async () => {
    vi.spyOn(logger, "warn").mockImplementation(() => undefined);
    capture.mockResolvedValue(jpegOf(flatRgba(0)));
    const poster = jpegOf(faceRgba());

    await loadCoverTiles([makeClip(1, poster)]);

    expect(vi.mocked(createImageBitmap)).toHaveBeenLastCalledWith(poster);
  });

  it("caches the 216 px crop by blob, closes the source bitmap, and decodes again after a trim change", async () => {
    capture.mockImplementation(async () => jpegOf(faceRgba()));
    const clip = makeClip(1);

    const [first] = await loadCoverTiles([clip]);
    expect(bitmaps).toHaveLength(1);
    expect(bitmaps[0].close).toHaveBeenCalledTimes(1);
    expect(opsOf(first as HTMLCanvasElement)).toContain("drawImage");

    const [again] = await loadCoverTiles([clip]);
    expect(again).toBe(first);
    expect(capture).toHaveBeenCalledTimes(1);

    await loadCoverTiles([{ ...clip, trimStartMs: 100 }]);
    expect(capture).toHaveBeenCalledTimes(2);
  });

  it("a poster attached after the first load keeps the cached tile", async () => {
    capture.mockImplementation(async () => jpegOf(faceRgba()));
    const actions = useAppStore.getState().actions;
    actions.setTrackClip(0, makeClip(1));
    const recorded = useAppStore.getState().project.tracks[0].clip as Clip;

    const [first] = await loadCoverTiles([recorded]);
    actions.setTrackPoster(0, jpegOf(faceRgba()), recorded);
    const withPoster = useAppStore.getState().project.tracks[0].clip as Clip;
    const [second] = await loadCoverTiles([withPoster]);

    expect(withPoster).not.toBe(recorded);
    expect(second).toBe(first);
    expect(capture).toHaveBeenCalledTimes(1);
  });

  it("does not cache a timed-out or fallback frame", async () => {
    vi.spyOn(logger, "warn").mockImplementation(() => undefined);
    capture.mockResolvedValue(null);
    const clip = makeClip(1, jpegOf(faceRgba()));

    await loadCoverTiles([clip]);
    await loadCoverTiles([clip]);

    expect(capture).toHaveBeenCalledTimes(2);
  });

  it("prints flat tiles without createImageBitmap, decoding nothing", async () => {
    vi.stubGlobal("createImageBitmap", undefined);

    const tiles = await loadCoverTiles([makeClip(1, jpegOf(faceRgba()))]);

    expect(tiles).toEqual([null]);
    expect(capture).not.toHaveBeenCalled();
  });
});

describe("composeShareCard", () => {
  beforeEach(() => {
    ({ callsOf } = installRecordingCanvas());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function tileOf(rgba: Uint8ClampedArray): HTMLCanvasElement {
    const tile = document.createElement("canvas");
    tile.width = TILE_SIZE;
    tile.height = TILE_SIZE;
    (tile.getContext("2d") as CanvasRenderingContext2D).drawImage(
      fakeBitmap(rgba) as unknown as ImageBitmap,
      0,
      0,
    );
    return tile;
  }

  function cornerHex(data: Uint8ClampedArray): string {
    return `#${[data[0], data[1], data[2]].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
  }

  // A palette colour printed 70 % over a grey photo.
  function overGrey(hex: string, grey: number): string {
    // Rounded the way a pixel buffer rounds (ties to even).
    const mixed = new Uint8ClampedArray(
      [1, 3, 5].map((at) => 0.7 * parseInt(hex.slice(at, at + 2), 16) + 0.3 * grey),
    );
    return `#${Array.from(mixed, (v) => v.toString(16).padStart(2, "0")).join("")}`;
  }

  it("lays paper first, then four tiles at their origins in their slot colours", () => {
    const card = composeShareCard([tileOf(faceRgba())]);
    const calls = callsOf(card);

    expect(card.width).toBe(480);
    expect(card.height).toBe(480);
    expect(calls[0]).toEqual({ op: "set fillStyle", args: [PAPER] });
    expect(calls[1]).toEqual({ op: "fillRect", args: [0, 0, 480, 480] });
    const tiles = calls.filter((call) => call.op === "putImageData");
    expect(tiles.map((call) => call.args.slice(1))).toEqual(
      [0, 1, 2, 3].map((slot) => [tileOrigin(slot).x, tileOrigin(slot).y]),
    );
    // The tile's corner is its mid-grey (120) ground: field colour over it.
    expect(tiles.map((call) => cornerHex(call.args[0] as Uint8ClampedArray))).toEqual(
      COVER_PALETTES.map((palette) => overGrey(palette.field, 120)),
    );
  });

  it("repeats two clips as AB/BA and prints a missing tile as its flat field", () => {
    const card = composeShareCard([tileOf(faceRgba()), null]);
    const calls = callsOf(card);

    const printed = calls.filter((call) => call.op === "putImageData").map((call) => call.args.slice(1));
    expect(printed).toEqual([
      [tileOrigin(0).x, tileOrigin(0).y],
      [tileOrigin(3).x, tileOrigin(3).y],
    ]);
    const flat = calls.filter((call) => call.op === "fillRect" && call.args[2] === TILE_SIZE);
    expect(flat.map((call) => call.args)).toEqual([
      [tileOrigin(1).x, tileOrigin(1).y, TILE_SIZE, TILE_SIZE],
      [tileOrigin(2).x, tileOrigin(2).y, TILE_SIZE, TILE_SIZE],
    ]);
  });

  it("labels the card HYPERACTIVE over AMATEUR, cream on a centred zinc-950 block", () => {
    const calls = callsOf(composeShareCard([null]));

    const texts = calls.filter((call) => call.op === "fillText").map((call) => call.args[0]);
    expect(texts).toEqual(["HYPERACTIVE", "AMATEUR"]);
    const block = calls.filter((call) => call.op === "fillRect").at(-1)?.args as number[];
    expect(block[0] + block[2] / 2).toBe(240);
    expect(block[1] + block[3] / 2).toBe(240);
  });
});
