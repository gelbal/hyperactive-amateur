// ABOUTME: Vitest setup file — jest-dom matchers + small JSDOM polyfills for browser APIs.
// ABOUTME: Referenced by vite.config.ts under test.setupFiles.
import "@testing-library/jest-dom/vitest";

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

// URL.createObjectURL / revokeObjectURL — JSDOM omits them by default.
if (typeof URL.createObjectURL !== "function") {
  let counter = 0;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (URL as any).createObjectURL = () => `blob:test/${counter++}`;
}
if (typeof URL.revokeObjectURL !== "function") {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (URL as any).revokeObjectURL = () => undefined;
}

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
  proto.getContext = function (this: HTMLCanvasElement, contextId: string) {
    if (contextId === "2d") {
      return {
        canvas: this,
        fillStyle: "",
        font: "",
        textAlign: "",
        textBaseline: "",
        fillRect: () => undefined,
        clearRect: () => undefined,
        fillText: () => undefined,
        drawImage: () => undefined,
        save: () => undefined,
        restore: () => undefined,
        scale: () => undefined,
        translate: () => undefined,
        getImageData: () => ({ data: new Uint8ClampedArray(4) }),
        putImageData: () => undefined,
      };
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
