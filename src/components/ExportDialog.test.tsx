// ABOUTME: ExportDialog tests — opens with default bars, slider updates value, render calls exportSong.
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

const exportSong = vi.fn<(canvas: HTMLCanvasElement, ctx: AudioContext, opts: { bars: number; bpm: number; onProgress?: (n: number) => void }) => Promise<Blob>>(
  async () => new Blob([new Uint8Array([1])], { type: "video/webm" }),
);
const downloadBlob = vi.fn<(blob: Blob, filename: string) => void>();

vi.mock("../lib/export", () => ({
  exportSong: (canvas: HTMLCanvasElement, ctx: AudioContext, opts: { bars: number; bpm: number; onProgress?: (n: number) => void }) =>
    exportSong(canvas, ctx, opts),
  downloadBlob: (blob: Blob, filename: string) => downloadBlob(blob, filename),
  defaultExportFilename: () => "hyperactive-amateur-test.webm",
}));

vi.mock("../lib/audio", () => ({
  getAudioContext: () => ({}) as unknown as AudioContext,
}));

const fakeCanvas = document.createElement("canvas");
vi.mock("../lib/videoEngine", () => ({
  getActiveCanvas: () => fakeCanvas,
}));

import { ExportDialog } from "./ExportDialog";

describe("ExportDialog", () => {
  beforeEach(() => {
    exportSong.mockClear();
    downloadBlob.mockClear();
  });

  it("renders nothing when closed", () => {
    render(<ExportDialog open={false} onClose={() => undefined} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("renders the bars slider with the default value", () => {
    render(<ExportDialog open={true} onClose={() => undefined} />);
    const slider = screen.getByLabelText("bars") as HTMLInputElement;
    expect(slider.value).toBe("4");
    expect(screen.getByText(/^4$/)).toBeInTheDocument();
  });

  it("changing the slider updates the displayed bar count", () => {
    render(<ExportDialog open={true} onClose={() => undefined} />);
    const slider = screen.getByLabelText("bars");
    fireEvent.change(slider, { target: { value: "2" } });
    expect((slider as HTMLInputElement).value).toBe("2");
  });

  it("clicking Render calls exportSong with the selected bars and triggers a download", async () => {
    const onClose = vi.fn();
    render(<ExportDialog open={true} onClose={onClose} />);
    fireEvent.change(screen.getByLabelText("bars"), { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: /render/i }));
    await waitFor(() => expect(exportSong).toHaveBeenCalled());
    const opts = exportSong.mock.calls[0]?.[2];
    expect(opts?.bars).toBe(3);
    await waitFor(() => expect(downloadBlob).toHaveBeenCalled());
    expect(onClose).toHaveBeenCalled();
  });
});
