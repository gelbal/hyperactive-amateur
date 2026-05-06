// ABOUTME: VariationButtons tests — disabled gating, click → varyPattern → applyPattern → undo.
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

const varyPattern = vi.fn();
vi.mock("../lib/aiSuggest", () => ({
  varyPattern: (...args: unknown[]) => varyPattern(...args),
}));

import { VariationButtons } from "./VariationButtons";
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

function setupPattern() {
  // Toggle one step so hasPattern is true.
  useAppStore.getState().actions.toggleStep(0, 0);
}

describe("VariationButtons", () => {
  beforeEach(() => {
    varyPattern.mockReset();
    useAppStore.getState().actions.reset();
  });

  it("renders all four variation buttons", () => {
    render(<VariationButtons />);
    expect(screen.getByLabelText("Busier")).toBeInTheDocument();
    expect(screen.getByLabelText("Fill")).toBeInTheDocument();
    expect(screen.getByLabelText("Half-time")).toBeInTheDocument();
    expect(screen.getByLabelText("Strip")).toBeInTheDocument();
  });

  it("disabled until 4 clips and a pattern exist", () => {
    fillClips(3);
    render(<VariationButtons />);
    expect(screen.getByLabelText("Busier")).toBeDisabled();
  });

  it("disabled when no steps are toggled even with 4+ clips", () => {
    fillClips(4);
    render(<VariationButtons />);
    expect(screen.getByLabelText("Busier")).toBeDisabled();
  });

  it("clicking a variation calls varyPattern with the right variation arg", async () => {
    const grid = pattern8x16(true);
    varyPattern.mockResolvedValue(grid);
    fillClips(4);
    setupPattern();
    render(<VariationButtons />);
    fireEvent.click(screen.getByLabelText("Half-time"));
    await waitFor(() => expect(varyPattern).toHaveBeenCalled());
    const arg = varyPattern.mock.calls[0]?.[0] as { variation: string };
    expect(arg.variation).toBe("halftime");
  });

  it("variations honor the store subgenre instead of hardcoding boom-bap", async () => {
    varyPattern.mockResolvedValue(pattern8x16(true));
    fillClips(4);
    setupPattern();
    useAppStore.getState().actions.setSubgenre("lo-fi");
    render(<VariationButtons />);
    fireEvent.click(screen.getByLabelText("Busier"));
    await waitFor(() => expect(varyPattern).toHaveBeenCalled());
    const arg = varyPattern.mock.calls[0]?.[0] as { subgenre: string };
    expect(arg.subgenre).toBe("lo-fi");
  });

  it("after applying, undo restores the prior pattern", async () => {
    varyPattern.mockResolvedValue(pattern8x16(true));
    fillClips(4);
    setupPattern();
    render(<VariationButtons />);
    fireEvent.click(screen.getByLabelText("Strip"));
    await waitFor(() => expect(screen.getByText(/Strip applied/)).toBeInTheDocument());
    fireEvent.click(screen.getByText(/Undo/));
    const after = useAppStore.getState().project.tracks[0].steps;
    // Original prior state: only step 0 was toggled.
    expect(after[0]).toBe(true);
    expect(after[1]).toBe(false);
  });

  it("shows an error message when the API fails", async () => {
    varyPattern.mockRejectedValue(new Error("nope"));
    fillClips(4);
    setupPattern();
    render(<VariationButtons />);
    fireEvent.click(screen.getByLabelText("Busier"));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("nope"));
  });
});
