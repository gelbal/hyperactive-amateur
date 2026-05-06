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
