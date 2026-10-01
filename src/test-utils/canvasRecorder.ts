// ABOUTME: Recording 2D canvas contexts for tests: every canvas records its draw calls and keeps pixels.
// ABOUTME: jsdom has no 2D context or image decode; this stands in so canvas code is testable.
import { vi } from "vitest";

export interface CanvasCall {
  op: string;
  args: unknown[];
}

// A decoded image as the code under test sees one: dimensions, its RGBA
// pixels (which a drawImage copies into the target canvas) and close().
export interface FakeBitmap {
  width: number;
  height: number;
  rgba: Uint8ClampedArray;
  close: ReturnType<typeof vi.fn>;
}

export function fakeBitmap(rgba: Uint8ClampedArray, size = 216): FakeBitmap {
  return { width: size, height: size, rgba, close: vi.fn() };
}

const RECORDED_SETTERS = ["font", "fillStyle", "strokeStyle", "lineWidth", "lineJoin"] as const;

interface RecordingState {
  calls: CanvasCall[];
  pixels: Uint8ClampedArray | null;
}

function createRecordingContext(canvas: HTMLCanvasElement, state: RecordingState): unknown {
  const record =
    (op: string) =>
    (...args: unknown[]) => {
      state.calls.push({ op, args });
    };
  const context: Record<string, unknown> = {
    canvas,
    textAlign: "start",
    textBaseline: "alphabetic",
    beginPath: record("beginPath"),
    arc: record("arc"),
    clip: record("clip"),
    fill: record("fill"),
    save: record("save"),
    restore: record("restore"),
    fillRect: record("fillRect"),
    clearRect: record("clearRect"),
    fillText: record("fillText"),
    strokeText: record("strokeText"),
    measureText: (text: string) => ({ width: text.length * 18 }),
    drawImage: (source: unknown, ...rest: unknown[]) => {
      state.calls.push({ op: "drawImage", args: [source, ...rest] });
      const pixels = (source as Partial<FakeBitmap>).rgba ?? pixelsOf(source);
      if (pixels) state.pixels = new Uint8ClampedArray(pixels);
    },
    getImageData: (_x: number, _y: number, width: number, height: number) => {
      state.calls.push({ op: "getImageData", args: [_x, _y, width, height] });
      const data = new Uint8ClampedArray(width * height * 4);
      if (state.pixels) data.set(state.pixels.subarray(0, data.length));
      return { data, width, height };
    },
    putImageData: (image: { data: Uint8ClampedArray }, x: number, y: number) => {
      state.calls.push({ op: "putImageData", args: [new Uint8ClampedArray(image.data), x, y] });
    },
  };
  for (const name of RECORDED_SETTERS) {
    let value: unknown = "";
    Object.defineProperty(context, name, {
      get: () => value,
      set: (next: unknown) => {
        value = next;
        state.calls.push({ op: `set ${name}`, args: [next] });
      },
    });
  }
  return context;
}

const states = new WeakMap<object, RecordingState>();

function pixelsOf(source: unknown): Uint8ClampedArray | null {
  if (!source || typeof source !== "object") return null;
  return states.get(source)?.pixels ?? null;
}

// Gives every canvas a recording 2D context until vi.restoreAllMocks().
export function installRecordingCanvas(): { callsOf: (canvas: HTMLCanvasElement) => CanvasCall[] } {
  const contexts = new WeakMap<HTMLCanvasElement, unknown>();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function (
    this: HTMLCanvasElement,
    contextId: string,
  ) {
    if (contextId !== "2d") return null;
    if (!contexts.has(this)) {
      const state: RecordingState = { calls: [], pixels: null };
      states.set(this, state);
      contexts.set(this, createRecordingContext(this, state));
    }
    return contexts.get(this) as RenderingContext;
  } as HTMLCanvasElement["getContext"]);
  return { callsOf: (canvas) => states.get(canvas)?.calls ?? [] };
}
