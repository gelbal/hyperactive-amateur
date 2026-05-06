// ABOUTME: SuggestButton tests — disabled until 4 clips, click → applyPattern, undo restores prior.
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

const suggestPattern = vi.fn();
vi.mock("../lib/aiSuggest", () => ({
  suggestPattern: (...args: unknown[]) => suggestPattern(...args),
  SUBGENRES: ["boom-bap", "trap", "lo-fi", "phonk"] as const,
}));

import { SuggestButton } from "./SuggestButton";
import { useAppStore } from "../store/useAppStore";
import type { Clip } from "../types";

function makeClip(): Clip {
  return {
    blob: new Blob([new Uint8Array([1])], { type: "video/webm" }),
    url: "blob:test/x",
    audioBuffer: { duration: 1, sampleRate: 48000 } as AudioBuffer,
    trimStartMs: 0,
    trimEndMs: 800,
    durationMs: 1000,
  };
}

function fillClips(count: number) {
  const actions = useAppStore.getState().actions;
  for (let i = 0; i < count; i++) actions.setTrackClip(i, makeClip());
}

function pattern8x16(value = false): boolean[][] {
  return Array.from({ length: 8 }, () => Array.from({ length: 16 }, () => value));
}

describe("SuggestButton", () => {
  beforeEach(() => {
    suggestPattern.mockReset();
    useAppStore.getState().actions.reset();
  });

  it("is disabled until at least 4 tracks have clips", () => {
    fillClips(3);
    render(<SuggestButton />);
    const button = screen.getByLabelText("Suggest a beat");
    expect(button).toBeDisabled();
  });

  it("clicking calls suggestPattern and applies the grid", async () => {
    const grid = pattern8x16(true);
    suggestPattern.mockResolvedValue(grid);
    fillClips(4);
    render(<SuggestButton />);
    fireEvent.click(screen.getByLabelText("Suggest a beat"));
    await waitFor(() => expect(suggestPattern).toHaveBeenCalled());
    await waitFor(() =>
      expect(useAppStore.getState().project.tracks[0].steps.every((s) => s)).toBe(true),
    );
  });

  it("displays an undo affordance after applying that restores the prior pattern", async () => {
    suggestPattern.mockResolvedValue(pattern8x16(true));
    fillClips(4);
    useAppStore.getState().actions.toggleStep(0, 7);
    render(<SuggestButton />);
    fireEvent.click(screen.getByLabelText("Suggest a beat"));
    await waitFor(() => expect(screen.getByText(/AI suggested a pattern/)).toBeInTheDocument());
    fireEvent.click(screen.getByText(/Undo/));
    const after = useAppStore.getState().project.tracks[0].steps;
    // Original prior state had only step 7 toggled.
    expect(after[7]).toBe(true);
    expect(after[0]).toBe(false);
  });

  it("shows an error message when the API call fails", async () => {
    suggestPattern.mockRejectedValue(new Error("network down"));
    fillClips(4);
    render(<SuggestButton />);
    fireEvent.click(screen.getByLabelText("Suggest a beat"));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("network down"));
  });
});
