// ABOUTME: VariationButtons tests — disabled gating until 4+ clips & a pattern, click → varyPattern with vibe + variation.
import { act, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

const varyPattern = vi.fn();
vi.mock("../lib/aiSuggest", () => ({
  varyPattern: (...args: unknown[]) => varyPattern(...args),
  AI_UNLOCK_CLIPS: 4,
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

describe("VariationButtons", () => {
  beforeEach(() => {
    varyPattern.mockReset();
    useAppStore.getState().actions.reset();
  });

  it("disabled until 4+ clips AND a non-empty pattern; clicking Break fires varyPattern with subgenre + vibe", async () => {
    render(<VariationButtons />);
    expect(screen.getByLabelText("Break")).toBeDisabled();

    const grid = Array.from({ length: 8 }, () => Array.from({ length: 16 }, () => true));
    varyPattern.mockResolvedValue(grid);
    const actions = useAppStore.getState().actions;
    act(() => {
      for (let i = 0; i < 4; i++) actions.setTrackClip(i, makeClip());
      actions.toggleStep(0, 0);
      actions.setSubgenre("lo-fi");
      actions.setVibe("varied");
    });

    render(<VariationButtons />);
    await act(async () => {
      fireEvent.click(screen.getAllByLabelText("Break")[1]);
      await Promise.resolve();
    });
    await waitFor(() => expect(varyPattern).toHaveBeenCalled());
    const arg = varyPattern.mock.calls[0]?.[0] as { variation: string; subgenre: string; vibe: string };
    expect(arg.variation).toBe("break");
    expect(arg.subgenre).toBe("lo-fi");
    expect(arg.vibe).toBe("varied");
  });

  it("does not overwrite when the grid changes before the variation response resolves", async () => {
    const actions = useAppStore.getState().actions;
    for (let i = 0; i < 4; i++) actions.setTrackClip(i, makeClip());
    actions.toggleStep(0, 0);
    const pending = deferredGrid();
    varyPattern.mockReturnValue(pending.promise);
    render(<VariationButtons />);

    fireEvent.click(screen.getByLabelText("Break"));
    await waitFor(() => expect(varyPattern).toHaveBeenCalled());

    await act(async () => {
      actions.extendSteps();
      pending.resolve(Array.from({ length: 8 }, () => Array.from({ length: 16 }, () => true)));
      await pending.promise;
    });

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Beat changed while Gemini was thinking. Try again.",
      ),
    );
    expect(useAppStore.getState().project.stepCount).toBe(20);
    expect(useAppStore.getState().project.tracks[0].steps.every(Boolean)).toBe(false);
  });
});
