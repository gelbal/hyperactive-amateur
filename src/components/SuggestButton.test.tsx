// ABOUTME: SuggestButton tests — disabled gating + click → applyPattern + Undo.
import { act, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

const suggestPattern = vi.fn();
vi.mock("../lib/aiSuggest", () => ({
  suggestPattern: (...args: unknown[]) => suggestPattern(...args),
  SUBGENRES: ["boom-bap", "trap", "lo-fi", "phonk"] as const,
  AI_UNLOCK_CLIPS: 4,
}));

import { SuggestButton } from "./SuggestButton";
import { useAppStore } from "../store/useAppStore";
import type { Clip } from "../types";

function makeClip(): Clip {
  return {
    blob: new Blob([new Uint8Array([1])], { type: "video/webm" }),
    url: "blob:test/x",
    audioBuffer: { duration: 1, sampleRate: 48000 } as AudioBuffer,
    audioStatus: "ok",
    trimStartMs: 0,
    trimEndMs: 800,
    durationMs: 1000,
    posterBlob: null,
    posterUrl: null,  };
}

function deferredGrid() {
  let resolve!: (grid: boolean[][]) => void;
  const promise = new Promise<boolean[][]>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe("SuggestButton", () => {
  beforeEach(() => {
    suggestPattern.mockReset();
    useAppStore.getState().actions.reset();
  });

  it("disabled with <4 clips; click after 4 calls suggestPattern and applies the result; Undo restores", async () => {
    render(<SuggestButton />);
    expect(screen.getByLabelText("Suggest a beat")).toBeDisabled();

    const actions = useAppStore.getState().actions;
    act(() => {
      for (let i = 0; i < 4; i++) actions.setTrackClip(i, makeClip());
      actions.toggleStep(0, 7);
    });
    const before = useAppStore.getState().project.tracks[0].steps.slice();

    const grid = Array.from({ length: 8 }, () => Array.from({ length: 16 }, () => true));
    suggestPattern.mockResolvedValue(grid);

    render(<SuggestButton />);
    await act(async () => {
      fireEvent.click(screen.getAllByLabelText("Suggest a beat")[1]);
      await Promise.resolve();
    });
    await waitFor(() => expect(suggestPattern).toHaveBeenCalled());
    await waitFor(() =>
      expect(useAppStore.getState().project.tracks[0].steps.every((s) => s)).toBe(true),
    );
    act(() => {
      fireEvent.click(screen.getByText(/Undo/));
    });
    expect(useAppStore.getState().project.tracks[0].steps).toEqual(before);
  });

  it("does not overwrite user edits made while the suggestion request is pending", async () => {
    const actions = useAppStore.getState().actions;
    for (let i = 0; i < 4; i++) actions.setTrackClip(i, makeClip());
    const pending = deferredGrid();
    suggestPattern.mockReturnValue(pending.promise);
    render(<SuggestButton />);

    fireEvent.click(screen.getByLabelText("Suggest a beat"));
    await waitFor(() => expect(suggestPattern).toHaveBeenCalled());

    await act(async () => {
      actions.toggleStep(0, 1);
      pending.resolve(Array.from({ length: 8 }, () => Array.from({ length: 16 }, () => true)));
      await pending.promise;
    });

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Beat changed while Gemini was thinking. Try again.",
      ),
    );
    const steps = useAppStore.getState().project.tracks[0].steps;
    expect(steps[1]).toBe(true);
    expect(steps.every(Boolean)).toBe(false);
  });
});
