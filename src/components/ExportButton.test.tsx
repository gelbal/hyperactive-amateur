// ABOUTME: ExportButton tests — format picker rendering rules + localStorage persistence.
// ABOUTME: Picker only renders when ≥2 formats are supported; choice persists across mounts.
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("tone", () => ({
  start: vi.fn().mockResolvedValue(undefined),
  getTransport: vi.fn(() => ({
    start: vi.fn(),
    stop: vi.fn(),
    bpm: { value: 90 },
  })),
  getDestination: vi.fn(() => ({ connect: vi.fn(), disconnect: vi.fn() })),
  getContext: vi.fn(() => ({ rawContext: {} })),
}));

import { ExportButton } from "./ExportButton";

const STORAGE_KEY = "ha:exportMimeType";

function stubMediaRecorder(supported: string[]): typeof MediaRecorder | undefined {
  const original = (globalThis as { MediaRecorder?: typeof MediaRecorder })
    .MediaRecorder;
  const set = new Set(supported);
  (globalThis as { MediaRecorder?: unknown }).MediaRecorder = {
    isTypeSupported: vi.fn((m: string) => set.has(m)),
  };
  return original;
}

describe("ExportButton format picker", () => {
  let originalRecorder: typeof MediaRecorder | undefined;

  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    (globalThis as { MediaRecorder?: unknown }).MediaRecorder = originalRecorder;
    cleanup();
  });

  it("hides the picker when only one format is supported", () => {
    originalRecorder = stubMediaRecorder(["video/webm; codecs=vp9,opus"]);
    render(<ExportButton />);
    fireEvent.click(screen.getByRole("button", { name: /export/i }));
    expect(screen.queryByText(/^format$/i)).not.toBeInTheDocument();
  });

  it("renders both formats when two are supported and persists a switch to localStorage", () => {
    originalRecorder = stubMediaRecorder([
      "video/mp4; codecs=avc1.42E01E,mp4a.40.2",
      "video/webm; codecs=vp9,opus",
    ]);
    render(<ExportButton />);
    fireEvent.click(screen.getByRole("button", { name: /export/i }));
    expect(screen.getByText(/^format$/i)).toBeInTheDocument();
    // WebM is the first-use default when Chromium-style support is present.
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe(
      "video/webm; codecs=vp9,opus",
    );
    // Switch to MP4.
    fireEvent.click(screen.getByLabelText(/mp4/i));
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe(
      "video/mp4; codecs=avc1.42E01E,mp4a.40.2",
    );
  });

  it("restores the persisted choice on remount", () => {
    originalRecorder = stubMediaRecorder([
      "video/mp4; codecs=avc1.42E01E,mp4a.40.2",
      "video/webm; codecs=vp9,opus",
    ]);
    window.localStorage.setItem(STORAGE_KEY, "video/webm; codecs=vp9,opus");
    render(<ExportButton />);
    fireEvent.click(screen.getByRole("button", { name: /export/i }));
    const webm = screen.getByLabelText(/webm/i) as HTMLInputElement;
    expect(webm.checked).toBe(true);
  });
});
