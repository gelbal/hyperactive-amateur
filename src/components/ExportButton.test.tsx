// ABOUTME: ExportButton tests — format picker rendering rules plus export review handoff.
// ABOUTME: Render completion holds the blob for Share, Save, or Discard instead of auto-downloading.
import {
  render,
  screen,
  fireEvent,
  cleanup,
  waitFor,
  act,
} from "@testing-library/react";
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
  getContext: vi.fn(() => ({ rawContext: {} })),
}));

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
  render(<ExportButton />);
  fireEvent.click(screen.getByRole("button", { name: /^export$/i }));
  fireEvent.click(screen.getByRole("button", { name: /^render$/i }));
  const filenameNode = await screen.findByText(filenamePattern);
  return { blob, filename: filenameNode.textContent ?? "" };
}

describe("ExportButton format picker", () => {
  let originalRecorder: typeof MediaRecorder | undefined;

  beforeEach(() => {
    window.localStorage.clear();
    useAppStore.getState().actions.reset();
    setActiveCanvas(document.createElement("canvas"));
    vi.mocked(exportSong).mockReset();
  });

  afterEach(() => {
    (globalThis as { MediaRecorder?: unknown }).MediaRecorder = originalRecorder;
    setActiveCanvas(null);
    clearNavigatorShare();
    cleanup();
    vi.restoreAllMocks();
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
    fireEvent.click(screen.getByRole("button", { name: /^discard$/i }));
    expect(screen.queryByText(filename)).not.toBeInTheDocument();
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

  it("keeps the review row when sharing is canceled", async () => {
    originalRecorder = stubMediaRecorder([WEBM_MIME]);
    const share = vi
      .fn()
      .mockRejectedValue(new DOMException("Share canceled", "AbortError"));
    stubNavigatorShare({ canShare: true, share });
    const createObjectURL = vi.spyOn(URL, "createObjectURL");
    const { filename } = await renderCompletedExport();

    fireEvent.click(screen.getByRole("button", { name: /^share$/i }));

    await waitFor(() => expect(share).toHaveBeenCalledTimes(1));
    expect(screen.getByText(filename)).toBeInTheDocument();
    expect(
      screen.queryByText("Sharing failed — saved as a download instead."),
    ).not.toBeInTheDocument();
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  it("falls back to Save when sharing fails for a non-cancel reason", async () => {
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

    fireEvent.click(screen.getByRole("button", { name: /^share$/i }));

    await waitFor(() =>
      expect(
        screen.getByText("Sharing failed — saved as a download instead."),
      ).toBeInTheDocument(),
    );
    expect(createObjectURL).toHaveBeenCalledWith(blob);
    expect(click).toHaveBeenCalledTimes(1);
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
    fireEvent.click(screen.getByRole("button", { name: /^discard$/i }));
    expect(screen.queryByText(filename)).not.toBeInTheDocument();

    await act(async () => {
      rejectShare(new Error("late share failed"));
      await Promise.resolve();
    });

    expect(createObjectURL).not.toHaveBeenCalled();
    expect(revokeObjectURL).not.toHaveBeenCalled();
    expect(click).not.toHaveBeenCalled();
    expect(
      screen.queryByText("Sharing failed — saved as a download instead."),
    ).not.toBeInTheDocument();
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

    await act(async () => {
      rejectShare(new Error("late share failed"));
      await Promise.resolve();
    });

    expect(exportSong).toHaveBeenCalledTimes(2);
    expect(createObjectURL).not.toHaveBeenCalled();
    expect(revokeObjectURL).not.toHaveBeenCalled();
    expect(click).not.toHaveBeenCalled();
    expect(
      screen.queryByText("Sharing failed — saved as a download instead."),
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

    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    expect(click).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /^discard$/i }));
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

    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
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

    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    unmount();

    expect(revokeObjectURL).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:test/unmount");
  });
});
