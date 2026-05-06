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

// JSDOM doesn't implement HTMLCanvasElement.getContext. Stub it with a minimal
// 2D context so our Viewport render loop runs cleanly in tests. The mock is
// intentionally tiny — it returns no-op functions for the methods we call.
if (typeof HTMLCanvasElement !== "undefined") {
  const proto = HTMLCanvasElement.prototype as unknown as {
    getContext: (id: string) => unknown;
  };
  const original = proto.getContext;
  proto.getContext = function (contextId: string) {
    if (contextId === "2d") {
      return {
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
      };
    }
    return original.call(this, contextId);
  };
}

// requestAnimationFrame — JSDOM has it but installing a no-op stop gives us
// deterministic teardown. Leave the original alone otherwise.
if (typeof window !== "undefined" && typeof window.requestAnimationFrame !== "function") {
  window.requestAnimationFrame = (cb) => setTimeout(() => cb(performance.now()), 16) as unknown as number;
  window.cancelAnimationFrame = (id) => clearTimeout(id);
}
