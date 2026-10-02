// ABOUTME: ExportButton tests — format picker, the cover preview, and the export review handoff.
// ABOUTME: A finished render saves itself, or on a touch device that can share files, offers Share.
import {
  render,
  screen,
  fireEvent,
  cleanup,
  waitFor,
  act,
} from "@testing-library/react";
import { StrictMode } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const exportMocks = vi.hoisted(() => ({
  exportSong: vi.fn(),
}));

vi.mock("tone", () => ({
  start: vi.fn().mockResolvedValue(undefined),
  getTransport: vi.fn(() => ({
    start: vi.fn(),
    stop: vi.fn(),
    bpm: { value: 90 },
  })),
  getDestination: vi.fn(() => ({ connect: vi.fn(), disconnect: vi.fn() })),
  getContext: vi.fn(() => ({ rawContext: {}, lookAhead: 0.1 })),
}));

vi.mock("../lib/posterFrame", () => ({ captureFirstFrame: vi.fn() }));

vi.mock("../lib/export", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/export")>();
  return {
    ...actual,
    exportSong: exportMocks.exportSong,
  };
});

import { ExportButton } from "./ExportButton";
import { exportSong } from "../lib/export";
import { useAppStore } from "../store/useAppStore";
import { setActiveCanvas } from "../lib/videoEngine";
import { captureFirstFrame } from "../lib/posterFrame";
import { __resetShareCardForTesting } from "../lib/shareCard";
import { COVER_PALETTES, pickCoverPalettes } from "../lib/coverArt";
import { fakeBitmap, installRecordingCanvas, type CanvasCall } from "../test-utils/canvasRecorder";
import type { Clip } from "../types";

const STORAGE_KEY = "ha:exportMimeType";
const WEBM_MIME = "video/webm; codecs=vp9,opus";
const MP4_MIME = "video/mp4; codecs=avc1.42E01E,mp4a.40.2";
const FILENAME_RE = /^hyperactive-amateur-\d{8}-\d{4}\.webm$/;
const MP4_FILENAME_RE = /^hyperactive-amateur-\d{8}-\d{4}\.mp4$/;

function stubMediaRecorder(supported: string[]): typeof MediaRecorder | undefined {
  const original = (globalThis as { MediaRecorder?: typeof MediaRecorder })
    .MediaRecorder;
  const set = new Set(supported);
  (globalThis as { MediaRecorder?: unknown }).MediaRecorder = {
    isTypeSupported: vi.fn((m: string) => set.has(m)),
  };
  return original;
}

function stubNavigatorShare({
  canShare,
  share = vi.fn().mockResolvedValue(undefined),
}: {
  canShare: boolean;
  share?: ReturnType<typeof vi.fn>;
}) {
  const canShareMock = vi.fn(() => canShare);
  Object.defineProperty(navigator, "canShare", {
    configurable: true,
    value: canShareMock,
  });
  Object.defineProperty(navigator, "share", {
    configurable: true,
    value: share,
  });
  return { canShare: canShareMock, share };
}

function clearNavigatorShare(): void {
  delete (navigator as Partial<Navigator & { canShare: unknown }>).canShare;
  delete (navigator as Partial<Navigator & { share: unknown }>).share;
}

async function renderCompletedExport(
  blob = new Blob(["movie"], { type: "video/webm" }),
  filenamePattern = FILENAME_RE,
) {
  vi.mocked(exportSong).mockResolvedValueOnce(blob);
  const { unmount } = render(<ExportButton />);
  fireEvent.click(screen.getByRole("button", { name: /^export$/i }));
  fireEvent.click(screen.getByRole("button", { name: /^render$/i }));
  const filenameNode = await screen.findByText(filenamePattern);
  return { blob, filename: filenameNode.textContent ?? "", unmount };
}

describe("ExportButton format picker", () => {
  let originalRecorder: typeof MediaRecorder | undefined;

  beforeEach(() => {
    window.localStorage.clear();
    useAppStore.getState().actions.reset();
    setActiveCanvas(document.createElement("canvas"));
    vi.mocked(exportSong).mockReset();
    // A finished render saves itself; jsdom cannot follow a download link.
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
  });

  afterEach(() => {
    (globalThis as { MediaRecorder?: unknown }).MediaRecorder = originalRecorder;
    setActiveCanvas(null);
    clearNavigatorShare();
    cleanup();
    vi.restoreAllMocks();
  });

  it("sizes the export trigger to 44px on coarse pointers and fills its share of the phone row", () => {
    render(<ExportButton />);

    const button = screen.getByRole("button", { name: /export/i });
    expect(button).toHaveClass("pointer-coarse:min-h-11", "w-full", "lg:w-auto", "justify-center", "px-2", "lg:px-3", "gap-1.5", "lg:gap-2");
    expect(button.parentElement).toHaveClass("grow", "lg:grow-0");
  });

  it("anchors the popover under the sticky header below lg and right-aligned under the button at lg", () => {
    originalRecorder = stubMediaRecorder([WEBM_MIME]);
    render(<ExportButton />);
    fireEvent.click(screen.getByRole("button", { name: /export/i }));

    const popover = screen.getByRole("dialog", { name: "Export song" });
    expect(popover.parentElement).toHaveClass("static", "lg:relative");
    expect(popover).toHaveClass(
      "absolute",
      "inset-x-3",
      "top-full",
      "mt-2",
      // Above the Play button's silent-switch hint (z-20), which hangs at
      // the same spot under the header.
      "z-30",
      "w-auto",
      "max-w-[24rem]",
      "mx-auto",
      "max-h-[calc(100dvh_-_100%_-_1rem_-_env(safe-area-inset-top)_-_env(safe-area-inset-bottom))]",
      "overflow-y-auto",
      "lg:inset-x-auto",
      "lg:right-0",
      "lg:min-w-[18rem]",
      "lg:max-w-none",
      "lg:mx-0",
      "lg:max-h-none",
      "lg:overflow-visible",
    );
    const classes = popover.className.split(/\s+/);
    expect(classes).not.toContain("fixed");
    expect(classes).not.toContain("min-w-[18rem]");
  });

  it("hides the picker when only one format is supported", () => {
    originalRecorder = stubMediaRecorder([WEBM_MIME]);
    render(<ExportButton />);
    fireEvent.click(screen.getByRole("button", { name: /export/i }));
    expect(screen.queryByText(/^format$/i)).not.toBeInTheDocument();
  });

  it("renders both formats when two are supported and persists a switch to localStorage", () => {
    originalRecorder = stubMediaRecorder([MP4_MIME, WEBM_MIME]);
    render(<ExportButton />);
    fireEvent.click(screen.getByRole("button", { name: /export/i }));
    expect(screen.getByText(/^format$/i)).toBeInTheDocument();
    // WebM is the first-use default when Chromium-style support is present.
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe(WEBM_MIME);
    // Switch to MP4.
    fireEvent.click(screen.getByLabelText(/mp4/i));
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe(MP4_MIME);
  });

  it("sizes export format labels to 44px on coarse pointers", () => {
    originalRecorder = stubMediaRecorder([MP4_MIME, WEBM_MIME]);
    render(<ExportButton />);
    fireEvent.click(screen.getByRole("button", { name: /export/i }));

    expect(screen.getByLabelText(/webm/i).closest("label")).toHaveClass(
      "pointer-coarse:min-h-11",
    );
    expect(screen.getByLabelText(/mp4/i).closest("label")).toHaveClass(
      "pointer-coarse:min-h-11",
    );
  });

  it("restores the persisted choice on remount", () => {
    originalRecorder = stubMediaRecorder([MP4_MIME, WEBM_MIME]);
    window.localStorage.setItem(STORAGE_KEY, WEBM_MIME);
    render(<ExportButton />);
    fireEvent.click(screen.getByRole("button", { name: /export/i }));
    const webm = screen.getByLabelText(/webm/i) as HTMLInputElement;
    expect(webm.checked).toBe(true);
  });

  it("shows rounded render-duration guidance before rendering", () => {
    originalRecorder = stubMediaRecorder([WEBM_MIME]);
    useAppStore.getState().actions.setBpm(120);
    render(<ExportButton />);
    fireEvent.click(screen.getByRole("button", { name: /export/i }));

    expect(
      screen.getByText("Keep this screen open — rendering takes about 8 s."),
    ).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("bars"), { target: { value: "8" } });

    expect(
      screen.getByText("Keep this screen open — rendering takes about 16 s."),
    ).toBeInTheDocument();
  });

  it("keeps the popover open when the export trigger is clicked during rendering", async () => {
    originalRecorder = stubMediaRecorder([WEBM_MIME]);
    let resolveExport: (blob: Blob) => void = () => undefined;
    vi.mocked(exportSong).mockImplementationOnce(
      () =>
        new Promise<Blob>((resolve) => {
          resolveExport = resolve;
        }),
    );
    render(<ExportButton />);

    fireEvent.click(screen.getByRole("button", { name: /^export$/i }));
    fireEvent.click(screen.getByRole("button", { name: /^render$/i }));
    expect(screen.getByRole("progressbar")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /^export$/i }));

    expect(screen.getByRole("dialog", { name: /^export song$/i })).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toBeInTheDocument();

    await act(async () => {
      resolveExport(new Blob(["movie"], { type: "video/webm" }));
      await Promise.resolve();
    });
  });

  it("shows a review row after rendering and hides Share when file sharing is unsupported", async () => {
    originalRecorder = stubMediaRecorder([WEBM_MIME]);
    stubNavigatorShare({ canShare: false });
    const createObjectURL = vi
      .spyOn(URL, "createObjectURL")
      .mockReturnValue("blob:test/review-save");
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);

    const { blob, filename } = await renderCompletedExport();

    expect(exportSong).toHaveBeenCalledTimes(1);
    expect(filename).toMatch(FILENAME_RE);
    expect(screen.queryByRole("button", { name: /^share$/i })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    expect(createObjectURL).toHaveBeenCalledWith(blob);
    fireEvent.click(screen.getByRole("button", { name: /^done$/i }));
    expect(screen.queryByText(filename)).not.toBeInTheDocument();
  });

  it("saves the render as soon as it finishes, keeping Share, Save and Done", async () => {
    originalRecorder = stubMediaRecorder([WEBM_MIME]);
    stubNavigatorShare({ canShare: true });
    const createObjectURL = vi.spyOn(URL, "createObjectURL");
    const click = vi.mocked(HTMLAnchorElement.prototype.click);

    const { blob, filename } = await renderCompletedExport();

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(createObjectURL).toHaveBeenCalledWith(blob);
    expect(click).toHaveBeenCalledTimes(1);
    expect(screen.getByText(filename)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^share$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^save$/i })).toBeInTheDocument();
    // The video is already saved, so closing the review discards nothing.
    expect(screen.getByRole("button", { name: /^done$/i })).toBeInTheDocument();
  });

  it("on a touch device that can share files, offers Share instead of downloading", async () => {
    originalRecorder = stubMediaRecorder([WEBM_MIME]);
    stubNavigatorShare({ canShare: true });
    const originalMatchMedia = window.matchMedia;
    window.matchMedia = vi.fn((query: string) => ({
      matches: query === "(pointer: coarse)",
      media: query,
    })) as unknown as typeof window.matchMedia;
    const createObjectURL = vi.spyOn(URL, "createObjectURL");

    try {
      await renderCompletedExport();

      expect(createObjectURL).not.toHaveBeenCalled();
      expect(HTMLAnchorElement.prototype.click).not.toHaveBeenCalled();
      expect(screen.getByRole("button", { name: /^share$/i })).toHaveClass("bg-orange-500");
      expect(screen.getByRole("button", { name: /^discard$/i })).toBeInTheDocument();
    } finally {
      window.matchMedia = originalMatchMedia;
    }
  });

  it("saves nothing when the render fails", async () => {
    originalRecorder = stubMediaRecorder([WEBM_MIME]);
    const createObjectURL = vi.spyOn(URL, "createObjectURL");
    vi.mocked(exportSong).mockRejectedValueOnce(new Error("encoder failed"));
    render(<ExportButton />);

    fireEvent.click(screen.getByRole("button", { name: /^export$/i }));
    fireEvent.click(screen.getByRole("button", { name: /^render$/i }));
    await screen.findByText("encoder failed");

    expect(createObjectURL).not.toHaveBeenCalled();
    expect(HTMLAnchorElement.prototype.click).not.toHaveBeenCalled();
  });

  it("renders Share only when navigator.canShare accepts the export file", async () => {
    originalRecorder = stubMediaRecorder([WEBM_MIME]);
    const { canShare } = stubNavigatorShare({ canShare: true });

    const { filename } = await renderCompletedExport();

    expect(screen.getByRole("button", { name: /^share$/i })).toBeInTheDocument();
    expect(canShare).toHaveBeenCalledWith({
      files: [expect.objectContaining({ name: filename, type: "video/webm" })],
    });
  });

  it("keeps the review blob when the popover closes and reopens", async () => {
    originalRecorder = stubMediaRecorder([WEBM_MIME]);
    stubNavigatorShare({ canShare: false });
    const { filename } = await renderCompletedExport();

    fireEvent.click(screen.getByRole("button", { name: /^export$/i }));
    expect(screen.queryByText(filename)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /^export$/i }));
    expect(screen.getByText(filename)).toBeInTheDocument();
  });

  it("shares a File with the export filename and type", async () => {
    originalRecorder = stubMediaRecorder([WEBM_MIME]);
    const share = vi.fn().mockResolvedValue(undefined);
    stubNavigatorShare({ canShare: true, share });
    const { blob, filename } = await renderCompletedExport();

    fireEvent.click(screen.getByRole("button", { name: /^share$/i }));

    await waitFor(() => expect(share).toHaveBeenCalledTimes(1));
    const file = share.mock.calls[0][0].files[0] as File;
    expect(file).toBeInstanceOf(File);
    expect(file.name).toBe(filename);
    expect(file.type).toBe(blob.type);
  });

  it("names the review and shared File from the actual exported blob type", async () => {
    originalRecorder = stubMediaRecorder([MP4_MIME, WEBM_MIME]);
    const share = vi.fn().mockResolvedValue(undefined);
    stubNavigatorShare({ canShare: true, share });
    const mp4Blob = new Blob(["movie"], { type: "video/mp4" });

    const { filename } = await renderCompletedExport(mp4Blob, MP4_FILENAME_RE);

    expect(vi.mocked(exportSong).mock.calls[0]?.[2]).toEqual(
      expect.objectContaining({ mimeType: WEBM_MIME }),
    );
    expect(filename).toMatch(MP4_FILENAME_RE);

    fireEvent.click(screen.getByRole("button", { name: /^share$/i }));

    await waitFor(() => expect(share).toHaveBeenCalledTimes(1));
    const file = share.mock.calls[0][0].files[0] as File;
    expect(file.name).toBe(filename);
    expect(file.name.endsWith(".mp4")).toBe(true);
    expect(file.type).toBe("video/mp4");
  });

  it("keeps the share failure message working after a StrictMode double-mount", async () => {
    originalRecorder = stubMediaRecorder([WEBM_MIME]);
    const share = vi.fn().mockRejectedValue(new Error("share failed"));
    stubNavigatorShare({ canShare: true, share });
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:test/strict-mode");
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);
    vi.mocked(exportSong).mockResolvedValueOnce(
      new Blob(["movie"], { type: "video/webm" }),
    );

    render(
      <StrictMode>
        <ExportButton />
      </StrictMode>,
    );
    fireEvent.click(screen.getByRole("button", { name: /^export$/i }));
    fireEvent.click(screen.getByRole("button", { name: /^render$/i }));
    await screen.findByText(FILENAME_RE);
    click.mockClear();

    fireEvent.click(screen.getByRole("button", { name: /^share$/i }));

    await waitFor(() =>
      expect(
        screen.getByText("Sharing failed — use Save to download the video."),
      ).toBeInTheDocument(),
    );
    expect(click).not.toHaveBeenCalled();
    // sharePending must reset so the Share button is usable again.
    expect(screen.getByRole("button", { name: /^share$/i })).toBeEnabled();
  });

  it("keeps the review row when sharing is canceled", async () => {
    originalRecorder = stubMediaRecorder([WEBM_MIME]);
    const share = vi
      .fn()
      .mockRejectedValue(new DOMException("Share canceled", "AbortError"));
    stubNavigatorShare({ canShare: true, share });
    const createObjectURL = vi.spyOn(URL, "createObjectURL");
    const { filename } = await renderCompletedExport();
    createObjectURL.mockClear();

    fireEvent.click(screen.getByRole("button", { name: /^share$/i }));

    await waitFor(() => expect(share).toHaveBeenCalledTimes(1));
    expect(screen.getByText(filename)).toBeInTheDocument();
    expect(
      screen.queryByText("Sharing failed — use Save to download the video."),
    ).not.toBeInTheDocument();
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  it("points to Save when sharing fails, without downloading again", async () => {
    originalRecorder = stubMediaRecorder([WEBM_MIME]);
    const share = vi.fn().mockRejectedValue(new Error("share failed"));
    stubNavigatorShare({ canShare: true, share });
    const createObjectURL = vi
      .spyOn(URL, "createObjectURL")
      .mockReturnValue("blob:test/share-fallback");
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);
    const { blob } = await renderCompletedExport();
    createObjectURL.mockClear();
    click.mockClear();

    fireEvent.click(screen.getByRole("button", { name: /^share$/i }));

    await waitFor(() =>
      expect(
        screen.getByText("Sharing failed — use Save to download the video."),
      ).toBeInTheDocument(),
    );
    expect(createObjectURL).not.toHaveBeenCalled();
    expect(click).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /^save$/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    expect(createObjectURL).toHaveBeenCalledWith(blob);
  });

  it("ignores a delayed share failure after the review is discarded", async () => {
    originalRecorder = stubMediaRecorder([WEBM_MIME]);
    let rejectShare: (reason: unknown) => void = () => undefined;
    const share = vi.fn(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectShare = reject;
        }),
    );
    stubNavigatorShare({ canShare: true, share });
    const createObjectURL = vi.spyOn(URL, "createObjectURL");
    const revokeObjectURL = vi.spyOn(URL, "revokeObjectURL");
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);
    const { filename } = await renderCompletedExport();

    fireEvent.click(screen.getByRole("button", { name: /^share$/i }));
    expect(screen.getByRole("button", { name: /^share$/i })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: /^done$/i }));
    expect(screen.queryByText(filename)).not.toBeInTheDocument();
    createObjectURL.mockClear();
    revokeObjectURL.mockClear();
    click.mockClear();

    await act(async () => {
      rejectShare(new Error("late share failed"));
      await Promise.resolve();
    });

    expect(createObjectURL).not.toHaveBeenCalled();
    expect(revokeObjectURL).not.toHaveBeenCalled();
    expect(click).not.toHaveBeenCalled();
    expect(
      screen.queryByText("Sharing failed — use Save to download the video."),
    ).not.toBeInTheDocument();
  });

  it("ignores a delayed share failure after the component unmounts", async () => {
    originalRecorder = stubMediaRecorder([WEBM_MIME]);
    let rejectShare: (reason: unknown) => void = () => undefined;
    const share = vi.fn(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectShare = reject;
        }),
    );
    stubNavigatorShare({ canShare: true, share });
    const createObjectURL = vi.spyOn(URL, "createObjectURL");
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);
    const { unmount } = await renderCompletedExport();
    createObjectURL.mockClear();
    click.mockClear();

    fireEvent.click(screen.getByRole("button", { name: /^share$/i }));
    unmount();

    await act(async () => {
      rejectShare(new Error("late share failed after unmount"));
      await Promise.resolve();
    });

    expect(createObjectURL).not.toHaveBeenCalled();
    expect(click).not.toHaveBeenCalled();
  });

  it("ignores a delayed share failure after a new review replaces the old one", async () => {
    originalRecorder = stubMediaRecorder([WEBM_MIME]);
    let rejectShare: (reason: unknown) => void = () => undefined;
    const share = vi.fn(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectShare = reject;
        }),
    );
    stubNavigatorShare({ canShare: true, share });
    const createObjectURL = vi.spyOn(URL, "createObjectURL");
    const revokeObjectURL = vi.spyOn(URL, "revokeObjectURL");
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);
    await renderCompletedExport(new Blob(["old"], { type: "video/webm" }));
    vi.mocked(exportSong).mockResolvedValueOnce(
      new Blob(["new"], { type: "video/webm" }),
    );

    fireEvent.click(screen.getByRole("button", { name: /^share$/i }));
    fireEvent.click(screen.getByRole("button", { name: /^render again$/i }));
    await screen.findByText(FILENAME_RE);
    createObjectURL.mockClear();
    revokeObjectURL.mockClear();
    click.mockClear();

    await act(async () => {
      rejectShare(new Error("late share failed"));
      await Promise.resolve();
    });

    expect(exportSong).toHaveBeenCalledTimes(2);
    expect(createObjectURL).not.toHaveBeenCalled();
    expect(revokeObjectURL).not.toHaveBeenCalled();
    expect(click).not.toHaveBeenCalled();
    expect(
      screen.queryByText("Sharing failed — use Save to download the video."),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^share$/i })).toBeInTheDocument();
  });

  it("revokes a saved object URL exactly once when the review is discarded", async () => {
    originalRecorder = stubMediaRecorder([WEBM_MIME]);
    stubNavigatorShare({ canShare: false });
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:test/save");
    const revokeObjectURL = vi.spyOn(URL, "revokeObjectURL");
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);
    await renderCompletedExport();

    expect(click).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /^done$/i }));
    expect(revokeObjectURL).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:test/save");
  });

  it("revokes the previous saved URL when starting a new render from review", async () => {
    originalRecorder = stubMediaRecorder([WEBM_MIME]);
    stubNavigatorShare({ canShare: false });
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:test/previous");
    const revokeObjectURL = vi.spyOn(URL, "revokeObjectURL");
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    await renderCompletedExport();
    vi.mocked(exportSong).mockResolvedValueOnce(new Blob(["next"], { type: "video/webm" }));

    fireEvent.click(screen.getByRole("button", { name: /^render again$/i }));

    await screen.findByText(FILENAME_RE);
    expect(exportSong).toHaveBeenCalledTimes(2);
    expect(revokeObjectURL).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:test/previous");
  });

  it("revokes a saved URL when the export button unmounts", async () => {
    originalRecorder = stubMediaRecorder([WEBM_MIME]);
    stubNavigatorShare({ canShare: false });
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:test/unmount");
    const revokeObjectURL = vi.spyOn(URL, "revokeObjectURL");
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    const { unmount } = render(<ExportButton />);
    vi.mocked(exportSong).mockResolvedValueOnce(new Blob(["movie"], { type: "video/webm" }));
    fireEvent.click(screen.getByRole("button", { name: /^export$/i }));
    fireEvent.click(screen.getByRole("button", { name: /^render$/i }));
    await screen.findByText(FILENAME_RE);

    unmount();

    expect(revokeObjectURL).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:test/unmount");
  });
});

describe("ExportButton cover", () => {
  let originalRecorder: typeof MediaRecorder | undefined;
  let callsOf: (canvas: HTMLCanvasElement) => CanvasCall[];
  const capture = vi.mocked(captureFirstFrame);

  // A light face under dark hair on a mid-grey ground: a printable tile.
  function faceRgba(): Uint8ClampedArray {
    const rgba = new Uint8ClampedArray(216 * 216 * 4);
    for (let i = 0; i < rgba.length; i += 4) {
      const dx = ((i / 4) % 216) + 0.5 - 108;
      const dy = Math.floor(i / 4 / 216) + 0.5 - 108;
      const inFace = (dx / 38) ** 2 + ((dy - 8) / 48) ** 2 <= 1;
      const inHair = (dx / 48) ** 2 + (dy / 62) ** 2 <= 1;
      const value = inFace ? 200 : inHair ? 30 : 120;
      rgba.set([value, value, value, 255], i);
    }
    return rgba;
  }

  function makeClip(id: number): Clip {
    return {
      blob: new Blob([new Uint8Array([id])], { type: "video/webm" }),
      url: `blob:test/${id}`,
      audioBuffer: null,
      audioStatus: "ok",
      trimStartMs: 300,
      trimEndMs: 1400,
      durationMs: 1500,
      posterBlob: new Blob([new Uint8Array([100 + id])], { type: "image/jpeg" }),
      posterUrl: `blob:test/poster-${id}`,
    };
  }

  function seedClips(count: number): void {
    const actions = useAppStore.getState().actions;
    for (let id = 0; id < count; id += 1) {
      actions.setTrackClip(id, makeClip(id));
      actions.toggleStep(id, id * 4);
    }
  }

  function openPanel(): void {
    fireEvent.click(screen.getByRole("button", { name: /^export$/i }));
  }

  function previewDraws(): number {
    const preview = screen.getByRole("img", { name: /cover preview/i }) as HTMLCanvasElement;
    return callsOf(preview).filter((call) => call.op === "drawImage").length;
  }

  function exportOptions(): Parameters<typeof exportSong>[2] {
    return vi.mocked(exportSong).mock.calls.at(-1)?.[2] as Parameters<typeof exportSong>[2];
  }

  beforeEach(() => {
    originalRecorder = stubMediaRecorder([WEBM_MIME]);
    window.localStorage.clear();
    useAppStore.getState().actions.setIsExporting(false);
    useAppStore.getState().actions.reset();
    useAppStore.getState().actions.setBpm(120);
    setActiveCanvas(document.createElement("canvas"));
    vi.mocked(exportSong).mockReset();
    vi.mocked(exportSong).mockImplementation(() => new Promise<Blob>(() => undefined));
    capture.mockReset();
    capture.mockImplementation(async () => new Blob([new Uint8Array([1])], { type: "image/jpeg" }));
    __resetShareCardForTesting();
    ({ callsOf } = installRecordingCanvas());
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(async () => fakeBitmap(faceRgba())),
    );
  });

  afterEach(() => {
    (globalThis as { MediaRecorder?: unknown }).MediaRecorder = originalRecorder;
    setActiveCanvas(null);
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("passes the loading cover and a flat fallback to exportSong without awaiting either", async () => {
    const frames: Array<(jpeg: Blob) => void> = [];
    capture.mockImplementation(() => new Promise<Blob | null>((resolve) => frames.push(resolve)));
    seedClips(2);
    render(<ExportButton />);
    openPanel();

    fireEvent.click(screen.getByRole("button", { name: /^render$/i }));
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
    const options = exportOptions();
    expect(options.cover).toBeInstanceOf(Promise);
    expect(options.coverFallback?.width).toBe(480);

    for (let turn = 0; turn < 2; turn += 1) {
      await waitFor(() => expect(frames).toHaveLength(turn + 1));
      await act(async () => {
        frames[turn](new Blob([new Uint8Array([turn])], { type: "image/jpeg" }));
      });
    }
    const card = await act(async () => options.cover);
    expect(card?.width).toBe(480);
    expect(capture).toHaveBeenCalledTimes(2);
  });

  it("composes the fallback from flat fields in the project's colourways under the name", async () => {
    seedClips(1);
    render(<ExportButton />);
    openPanel();

    fireEvent.click(screen.getByRole("button", { name: /^render$/i }));

    const fallback = exportOptions().coverFallback as HTMLCanvasElement;
    const calls = callsOf(fallback);
    expect(calls.some((call) => call.op === "putImageData")).toBe(false);
    const flatFills = calls
      .filter((call) => call.op === "fillRect" && call.args[2] === 216)
      .map((call) => calls[calls.indexOf(call) - 1].args[0]);
    expect(flatFills).toEqual(
      pickCoverPalettes(useAppStore.getState().project.tracks).map((palette) => palette.field),
    );
    expect(calls.filter((call) => call.op === "fillText").map((call) => call.args[0])).toEqual([
      "HYPERACTIVE",
      "AMATEUR",
    ]);
    await act(async () => {
      await exportOptions().cover;
    });
  });

  // A colour printed 70 % over a grey photo, rounded like a pixel buffer.
  function overGrey(hex: string, grey: number): string {
    const mixed = new Uint8ClampedArray(
      [1, 3, 5].map((at) => 0.7 * parseInt(hex.slice(at, at + 2), 16) + 0.3 * grey),
    );
    return `#${Array.from(mixed, (v) => v.toString(16).padStart(2, "0")).join("")}`;
  }

  // The top-left pixel of each printed tile on a composed card.
  function tileCorners(card: HTMLCanvasElement): string[] {
    return callsOf(card)
      .filter((call) => call.op === "putImageData")
      .map((call) => {
        const data = call.args[0] as Uint8ClampedArray;
        return `#${[data[0], data[1], data[2]].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
      });
  }

  it("prints the preview and the exported cover in the project's drawn colourways", async () => {
    seedClips(1);
    const drawn = pickCoverPalettes(useAppStore.getState().project.tracks);
    // The draw is not the catalogue's first four, so the test tells them apart.
    expect(drawn).not.toEqual(COVER_PALETTES.slice(0, 4));
    render(<ExportButton />);
    openPanel();
    await waitFor(() => expect(previewDraws()).toBe(1));
    const preview = screen.getByRole("img", { name: /cover preview/i }) as HTMLCanvasElement;
    const previewCard = callsOf(preview).find((call) => call.op === "drawImage")?.args[0] as HTMLCanvasElement;

    fireEvent.click(screen.getByRole("button", { name: /^render$/i }));
    const cover = (await act(async () => exportOptions().cover)) as HTMLCanvasElement;

    // Every tile's corner is the face tile's mid-grey (120) ground.
    const fields = drawn.map((palette) => overGrey(palette.field, 120));
    expect(tileCorners(previewCard)).toEqual(fields);
    expect(tileCorners(cover)).toEqual(fields);
  });

  it("shows the cover without offering label or on/off choices", async () => {
    seedClips(1);
    render(<ExportButton />);
    openPanel();

    expect(screen.getByRole("img", { name: /cover preview/i })).toBeInTheDocument();
    expect(screen.queryByRole("radio", { name: /name|logo|signed|plain|off/i })).not.toBeInTheDocument();
    await waitFor(() => expect(previewDraws()).toBe(1));
  });

  it("opens on a flat card when no clip ever appears on screen", async () => {
    seedClips(1);
    act(() => useAppStore.getState().actions.setTrackShowVideo(0, false));
    render(<ExportButton />);
    openPanel();
    await waitFor(() => expect(previewDraws()).toBe(1));

    fireEvent.click(screen.getByRole("button", { name: /^render$/i }));

    expect(exportOptions().cover).toBeInstanceOf(Promise);
    expect(exportOptions().coverFallback?.width).toBe(480);
    expect(capture).not.toHaveBeenCalled();
  });

  it("clears the old preview while the changed clips load", async () => {
    seedClips(1);
    render(<ExportButton />);
    openPanel();
    await waitFor(() => expect(previewDraws()).toBe(1));
    const preview = screen.getByRole("img", { name: /cover preview/i }) as HTMLCanvasElement;
    const before = callsOf(preview).length;

    act(() => useAppStore.getState().actions.setTrackClip(1, makeClip(1)));
    act(() => useAppStore.getState().actions.toggleStep(1, 2));

    expect(callsOf(preview).slice(before).map((call) => call.op)).toContain("clearRect");
    await waitFor(() => expect(previewDraws()).toBe(2));
  });

  it("never shows the previous clips' card on a reopened panel", async () => {
    seedClips(1);
    render(<ExportButton />);
    openPanel();
    await waitFor(() => expect(previewDraws()).toBe(1));
    fireEvent.click(screen.getByRole("button", { name: /^export$/i }));

    const frames: Array<(jpeg: Blob) => void> = [];
    capture.mockImplementation(() => new Promise<Blob | null>((resolve) => frames.push(resolve)));
    act(() => useAppStore.getState().actions.setTrackClip(0, makeClip(5)));
    openPanel();

    expect(previewDraws()).toBe(0);
    await waitFor(() => expect(frames).toHaveLength(1));
    await act(async () => {
      frames[0](new Blob([new Uint8Array([5])], { type: "image/jpeg" }));
    });
    await waitFor(() => expect(previewDraws()).toBe(1));
  });

  it("draws no preview while a render runs", async () => {
    const frames: Array<(jpeg: Blob) => void> = [];
    capture.mockImplementation(() => new Promise<Blob | null>((resolve) => frames.push(resolve)));
    seedClips(1);
    render(<ExportButton />);
    openPanel();
    fireEvent.click(screen.getByRole("button", { name: /^render$/i }));

    await waitFor(() => expect(frames).toHaveLength(1));
    await act(async () => {
      frames[0](new Blob([new Uint8Array([1])], { type: "image/jpeg" }));
      await exportOptions().cover;
    });

    expect(previewDraws()).toBe(0);
  });

  it("composes no cover once the render has started recording", async () => {
    const frames: Array<(jpeg: Blob) => void> = [];
    capture.mockImplementation(() => new Promise<Blob | null>((resolve) => frames.push(resolve)));
    seedClips(1);
    render(<ExportButton />);
    openPanel();
    fireEvent.click(screen.getByRole("button", { name: /^render$/i }));
    const cover = exportOptions().cover as Promise<HTMLCanvasElement | null>;
    await waitFor(() => expect(frames).toHaveLength(1));

    // The export stopped waiting and started its transport; then the tile lands.
    act(() => useAppStore.getState().actions.setIsPlaying(true));
    await act(async () => {
      frames[0](new Blob([new Uint8Array([1])], { type: "image/jpeg" }));
    });

    await expect(cover).resolves.toBeNull();
  });

  it("moving the length slider does not reload a one-bar pattern's cover", async () => {
    seedClips(1);
    render(<ExportButton />);
    openPanel();
    await waitFor(() => expect(previewDraws()).toBe(1));
    const preview = screen.getByRole("img", { name: /cover preview/i }) as HTMLCanvasElement;
    const before = callsOf(preview).length;

    fireEvent.change(screen.getByLabelText("bars"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("bars"), { target: { value: "8" } });

    expect(capture).toHaveBeenCalledTimes(1);
    expect(callsOf(preview).slice(before).map((call) => call.op)).not.toContain("clearRect");
  });

  it("puts only clips the render plays on the cover", async () => {
    const actions = useAppStore.getState().actions;
    while (useAppStore.getState().project.stepCount < 24) actions.extendSteps();
    actions.setTrackClip(0, makeClip(0));
    actions.toggleStep(0, 20);
    render(<ExportButton />);
    openPanel();
    // Four bars play step 20, so the clip is on the cover.
    await waitFor(() => expect(previewDraws()).toBe(1));
    expect(capture).toHaveBeenCalledTimes(1);

    // One bar never reaches it: the card has no clip tiles.
    fireEvent.change(screen.getByLabelText("bars"), { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: /^render$/i }));
    const card = await act(async () => exportOptions().cover);

    expect(callsOf(card as HTMLCanvasElement).filter((call) => call.op === "putImageData")).toEqual([]);
  });

  it("hides Cover and renders without a cover when there are no clips", () => {
    render(<ExportButton />);
    openPanel();

    expect(screen.queryByText(/^cover$/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^render$/i }));

    expect(exportOptions().cover).toBeUndefined();
    expect(capture).not.toHaveBeenCalled();
  });

  it("shows the cover without a caption and adds its hold to the render estimate", async () => {
    seedClips(1);
    render(<ExportButton />);
    openPanel();

    expect(screen.queryByText(/opens on this cover/i)).not.toBeInTheDocument();
    expect(
      screen.getByText("Keep this screen open — rendering takes about 9 s."),
    ).toBeInTheDocument();
    await waitFor(() => expect(previewDraws()).toBe(1));
  });

  it("starts no load while the app cannot start audio, and loads once it can", async () => {
    seedClips(1);
    render(<ExportButton />);
    openPanel();
    await waitFor(() => expect(previewDraws()).toBe(1));
    expect(capture).toHaveBeenCalledTimes(1);

    act(() => useAppStore.getState().actions.setIsPlaying(true));
    act(() => useAppStore.getState().actions.setTrackClip(1, makeClip(1)));
    act(() => useAppStore.getState().actions.toggleStep(1, 2));
    expect(capture).toHaveBeenCalledTimes(1);

    act(() => useAppStore.getState().actions.setIsPlaying(false));
    await waitFor(() => expect(capture).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(previewDraws()).toBe(2));
  });
});
