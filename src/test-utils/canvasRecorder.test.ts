// ABOUTME: Tests for the recording canvas: draw calls and setters are kept in order, pixels round-trip.
// ABOUTME: The share-card tests lean on it, so its own behaviour is pinned here.
import { afterEach, describe, expect, it, vi } from "vitest";
import { fakeBitmap, installRecordingCanvas } from "./canvasRecorder";

function canvasOf(size: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  return canvas;
}

describe("canvasRecorder", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns drawn pixels from getImageData as a copy", () => {
    installRecordingCanvas();
    const canvas = canvasOf(2);
    const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
    const rgba = new Uint8ClampedArray(16).fill(7);

    ctx.drawImage(fakeBitmap(rgba, 2) as unknown as ImageBitmap, 0, 0);
    const first = ctx.getImageData(0, 0, 2, 2);
    first.data[0] = 99;

    expect(Array.from(ctx.getImageData(0, 0, 2, 2).data)).toEqual(Array.from(rgba));
  });

  it("copies pixels from one recording canvas into another", () => {
    installRecordingCanvas();
    const source = canvasOf(2);
    (source.getContext("2d") as CanvasRenderingContext2D).drawImage(
      fakeBitmap(new Uint8ClampedArray(16).fill(3), 2) as unknown as ImageBitmap,
      0,
      0,
    );
    const target = canvasOf(2);
    const ctx = target.getContext("2d") as CanvasRenderingContext2D;

    ctx.drawImage(source, 0, 0);

    expect(ctx.getImageData(0, 0, 2, 2).data[5]).toBe(3);
  });

  it("records calls and setters in order, per canvas", () => {
    const { callsOf } = installRecordingCanvas();
    const canvas = canvasOf(4);
    const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;

    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, 4, 4);
    ctx.beginPath();
    ctx.arc(2, 2, 1, 0, Math.PI * 2);
    ctx.clip();

    expect(callsOf(canvas).map((call) => call.op)).toEqual([
      "set fillStyle",
      "fillRect",
      "beginPath",
      "arc",
      "clip",
    ]);
    expect(canvas.getContext("2d")).toBe(ctx);
    expect(callsOf(canvasOf(4))).toEqual([]);
  });
});
