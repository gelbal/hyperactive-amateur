// ABOUTME: Vitest setup file — jest-dom matchers + small JSDOM polyfills for browser APIs.
// ABOUTME: Referenced by vite.config.ts under test.setupFiles.
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, vi } from "vitest";

const originalConsoleError = console.error.bind(console);
const originalConsoleWarn = console.warn.bind(console);
let unexpectedConsoleMessages: string[] = [];

function formatConsoleArg(arg: unknown): string {
  if (typeof arg === "string") return arg;
  if (arg instanceof Error) return arg.stack ?? arg.message;
  try {
    return JSON.stringify(arg);
  } catch {
    return String(arg);
  }
}

function formatConsoleMessage(args: unknown[]): string {
  return args.map(formatConsoleArg).join(" ");
}

function isActWarning(message: string): boolean {
  return message.includes("not wrapped in act") || message.includes("wrap-tests-with-act");
}

console.error = ((...args: unknown[]) => {
  const message = formatConsoleMessage(args);
  if (isActWarning(message) || !message.startsWith("[HA] ")) {
    unexpectedConsoleMessages.push(`console.error: ${message}`);
  }
  originalConsoleError(...args);
}) as typeof console.error;

console.warn = ((...args: unknown[]) => {
  const message = formatConsoleMessage(args);
  if (isActWarning(message)) {
    unexpectedConsoleMessages.push(`console.warn: ${message}`);
  }
  originalConsoleWarn(...args);
}) as typeof console.warn;

beforeEach(() => {
  unexpectedConsoleMessages = [];
});

afterEach(() => {
  if (unexpectedConsoleMessages.length === 0) return;
  throw new Error(
    [
      "Unexpected console output during test.",
      "Wrap React updates in act() or allow intentional app logger output with the [HA] prefix.",
      ...unexpectedConsoleMessages,
    ].join("\n\n"),
  );
});

// JSDOM's Blob lacks arrayBuffer in some environments — polyfill it.
if (typeof Blob !== "undefined" && typeof Blob.prototype.arrayBuffer !== "function") {
  Blob.prototype.arrayBuffer = function arrayBuffer(): Promise<ArrayBuffer> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as ArrayBuffer);
      reader.onerror = () => reject(reader.error ?? new Error("FileReader failed"));
      reader.readAsArrayBuffer(this);
    });
  };
}

// URL.createObjectURL / revokeObjectURL — keep these browser-like and
// deterministic in JSDOM even when the Node runtime exposes stricter versions.
let objectUrlCounter = 0;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(URL as any).createObjectURL = () => `blob:test/${objectUrlCounter++}`;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(URL as any).revokeObjectURL = () => undefined;

function createMemoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key: string) => values.get(String(key)) ?? null,
    key: (index: number) => Array.from(values.keys())[index] ?? null,
    removeItem: (key: string) => values.delete(String(key)),
    setItem: (key: string, value: string) => values.set(String(key), String(value)),
  } as Storage;
}

if (typeof window !== "undefined") {
  let storage: Storage | null = null;
  try {
    storage = window.localStorage;
    const probe = "__ha_storage_probe__";
    storage.setItem(probe, "1");
    storage.removeItem(probe);
  } catch {
    storage = createMemoryStorage();
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: storage,
    });
  }
  if (typeof globalThis.localStorage === "undefined" && storage) {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: storage,
    });
  }
}

// JSDOM doesn't implement HTMLCanvasElement.getContext. Stub it with a minimal
// 2D context so our Viewport render loop runs cleanly in tests. The mock is
// intentionally tiny — it returns no-op functions for the methods we call.
if (typeof HTMLCanvasElement !== "undefined") {
  const proto = HTMLCanvasElement.prototype as unknown as {
    getContext: (id: string) => unknown;
  };
  const original = proto.getContext;
  const contexts = new WeakMap<HTMLCanvasElement, Record<string, unknown>>();
  proto.getContext = function (this: HTMLCanvasElement, contextId: string) {
    if (contextId === "2d") {
      const existing = contexts.get(this);
      if (existing) return existing;

      const stateStack: Array<{
        fillStyle: unknown;
        globalAlpha: number;
        globalCompositeOperation: string;
      }> = [];
      const calls: Array<{
        method: string;
        args: unknown[];
        fillStyle: unknown;
        globalAlpha: number;
        globalCompositeOperation: string;
      }> = [];
      const recordCall = (method: string, args: unknown[]) => {
        calls.push({
          method,
          args,
          fillStyle: context.fillStyle,
          globalAlpha: context.globalAlpha as number,
          globalCompositeOperation: context.globalCompositeOperation as string,
        });
      };
      const context: Record<string, unknown> = {
        canvas: this,
        fillStyle: "",
        globalAlpha: 1,
        globalCompositeOperation: "source-over",
        imageSmoothingEnabled: true,
        font: "",
        textAlign: "",
        textBaseline: "",
        __haCanvasCalls: calls,
        fillRect: vi.fn((...args: unknown[]) => {
          recordCall("fillRect", args);
        }),
        clearRect: vi.fn((...args: unknown[]) => {
          recordCall("clearRect", args);
        }),
        fillText: vi.fn((...args: unknown[]) => {
          recordCall("fillText", args);
        }),
        drawImage: vi.fn((...args: unknown[]) => {
          recordCall("drawImage", args);
        }),
        createPattern: vi.fn((...args: unknown[]) => {
          recordCall("createPattern", args);
          return {
            __haCanvasPattern: true,
            source: args[0],
            repetition: args[1],
          };
        }),
        beginPath: vi.fn((...args: unknown[]) => {
          recordCall("beginPath", args);
        }),
        rect: vi.fn((...args: unknown[]) => {
          recordCall("rect", args);
        }),
        clip: vi.fn((...args: unknown[]) => {
          recordCall("clip", args);
        }),
        save: vi.fn(() => {
          stateStack.push({
            fillStyle: context.fillStyle,
            globalAlpha: context.globalAlpha as number,
            globalCompositeOperation: context.globalCompositeOperation as string,
          });
        }),
        restore: vi.fn(() => {
          const state = stateStack.pop();
          if (!state) return;
          context.fillStyle = state.fillStyle;
          context.globalAlpha = state.globalAlpha;
          context.globalCompositeOperation = state.globalCompositeOperation;
        }),
        scale: vi.fn(),
        translate: vi.fn(),
        getImageData: () => ({ data: new Uint8ClampedArray(4) }),
        putImageData: () => undefined,
      };
      contexts.set(this, context);
      return context;
    }
    return original.call(this, contextId);
  };
}

// HTMLMediaElement.play / load — JSDOM emits "not implemented" warnings for
// these. Stub them so video-element tests run quietly.
if (typeof HTMLMediaElement !== "undefined") {
  HTMLMediaElement.prototype.play = function play() {
    return Promise.resolve();
  };
  HTMLMediaElement.prototype.pause = function pause() {
    return undefined;
  };
  HTMLMediaElement.prototype.load = function load() {
    return undefined;
  };
}

// MediaStream — JSDOM has no implementation. Tiny polyfill that wraps a tracks array.
if (typeof globalThis.MediaStream === "undefined") {
  class FakeMediaStream {
    private _tracks: MediaStreamTrack[];
    constructor(tracks: MediaStreamTrack[] = []) {
      this._tracks = [...tracks];
    }
    getTracks() {
      return this._tracks;
    }
    getVideoTracks() {
      return this._tracks.filter((t) => t.kind === "video" || t.kind === undefined);
    }
    getAudioTracks() {
      return this._tracks.filter((t) => t.kind === "audio");
    }
    addTrack(track: MediaStreamTrack) {
      this._tracks.push(track);
    }
    removeTrack(track: MediaStreamTrack) {
      this._tracks = this._tracks.filter((t) => t !== track);
    }
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).MediaStream = FakeMediaStream;
}

// requestAnimationFrame — JSDOM has it but installing a no-op stop gives us
// deterministic teardown. Leave the original alone otherwise.
if (typeof window !== "undefined" && typeof window.requestAnimationFrame !== "function") {
  window.requestAnimationFrame = (cb) => setTimeout(() => cb(performance.now()), 16) as unknown as number;
  window.cancelAnimationFrame = (id) => clearTimeout(id);
}
