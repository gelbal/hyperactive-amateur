// ABOUTME: canvasDraw tests pin shared cover-crop and DPR backing-store math.
// ABOUTME: The assertions protect Chop pixels while Mood reuses the helpers.
import { describe, expect, it, vi } from "vitest";
import {
  coverCropRect,
  drawCover,
  getDisplayBackingSize,
  sizeDisplayCanvas,
} from "./canvasDraw";

describe("coverCropRect", () => {
  it("center-crops a source wider than the target", () => {
    expect(coverCropRect(1280, 720, 480, 480)).toEqual({
      x: 280,
      y: 0,
      width: 720,
      height: 720,
    });
  });

  it("center-crops a source taller than the target", () => {
    expect(coverCropRect(720, 1280, 480, 480)).toEqual({
      x: 0,
      y: 280,
      width: 720,
      height: 720,
    });
  });

  it("keeps an equal-aspect source whole", () => {
    expect(coverCropRect(1920, 1080, 1280, 720)).toEqual({
      x: 0,
      y: 0,
      width: 1920,
      height: 1080,
    });
  });
});

describe("drawCover", () => {
  it("draws the computed source crop into the destination tile", () => {
    const source = document.createElement("canvas");
    source.width = 1280;
    source.height = 720;
    const drawImage = vi.fn();
    const ctx = { drawImage } as unknown as CanvasRenderingContext2D;

    drawCover(ctx, source, { x: 10, y: 20, width: 300, height: 300 });

    expect(drawImage).toHaveBeenCalledWith(
      source,
      280,
      0,
      720,
      720,
      10,
      20,
      300,
      300,
    );
  });
});

describe("getDisplayBackingSize", () => {
  it("caps DPR at 2 and rounds each CSS axis independently", () => {
    expect(getDisplayBackingSize(390, 1)).toBe(390);
    expect(getDisplayBackingSize(390, 3)).toBe(780);
    expect(getDisplayBackingSize(10.4, 1.5)).toBe(16);
  });
});

describe("sizeDisplayCanvas", () => {
  it("applies capped DPR sizing independently for non-square stages", () => {
    const canvas = document.createElement("canvas");

    sizeDisplayCanvas(canvas, 320, 180, 3);

    expect(canvas.width).toBe(640);
    expect(canvas.height).toBe(360);
  });
});
