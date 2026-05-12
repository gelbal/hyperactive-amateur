// ABOUTME: SuggestButton tests — disabled gating + click → applyPattern + Undo.
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
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
    trimStartMs: 0,
    trimEndMs: 800,
    durationMs: 1000,
    posterBlob: null,
    posterUrl: null,  };
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
    for (let i = 0; i < 4; i++) actions.setTrackClip(i, makeClip());
    actions.toggleStep(0, 7);
    const before = useAppStore.getState().project.tracks[0].steps.slice();

    const grid = Array.from({ length: 8 }, () => Array.from({ length: 16 }, () => true));
    suggestPattern.mockResolvedValue(grid);

    render(<SuggestButton />);
    fireEvent.click(screen.getAllByLabelText("Suggest a beat")[1]);
    await waitFor(() => expect(suggestPattern).toHaveBeenCalled());
    await waitFor(() =>
      expect(useAppStore.getState().project.tracks[0].steps.every((s) => s)).toBe(true),
    );
    fireEvent.click(screen.getByText(/Undo/));
    expect(useAppStore.getState().project.tracks[0].steps).toEqual(before);
  });
});
