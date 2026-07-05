// ABOUTME: SuggestButton tests — disabled gating + click → applyPattern + Undo.
import { act, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const suggestPattern = vi.fn();
vi.mock("../lib/aiSuggest", () => ({
  suggestPattern: (...args: unknown[]) => suggestPattern(...args),
  SUBGENRES: ["boom-bap", "trap", "lo-fi", "phonk"] as const,
  AI_UNLOCK_CLIPS: 4,
}));

import { SuggestButton } from "./SuggestButton";
import { useAppStore } from "../store/useAppStore";
import { GeminiOfflineError } from "../lib/aiErrors";
import type { Clip } from "../types";

const OFFLINE_COPY = "AI needs an internet connection.";

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

function unlockAi(): void {
  const actions = useAppStore.getState().actions;
  act(() => {
    for (let i = 0; i < 4; i++) actions.setTrackClip(i, makeClip());
  });
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

  afterEach(() => {
    Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
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

  it("renders pinned offline copy when the suggestion transport is unavailable", async () => {
    unlockAi();
    suggestPattern.mockRejectedValue(new GeminiOfflineError());
    render(<SuggestButton />);

    await act(async () => {
      fireEvent.click(screen.getByLabelText("Suggest a beat"));
      await Promise.resolve();
    });

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(OFFLINE_COPY));
  });

  it("keeps non-offline suggestion errors unchanged", async () => {
    unlockAi();
    suggestPattern.mockRejectedValue(new Error("Gemini proxy 500: server error"));
    render(<SuggestButton />);

    await act(async () => {
      fireEvent.click(screen.getByLabelText("Suggest a beat"));
      await Promise.resolve();
    });

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("Gemini proxy 500: server error"),
    );
  });

  it("hints when offline and stays clickable", async () => {
    unlockAi();
    Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
    suggestPattern.mockResolvedValue(
      Array.from({ length: 8 }, () => Array.from({ length: 16 }, () => false)),
    );
    render(<SuggestButton />);

    const button = screen.getByLabelText("Suggest a beat");
    expect(button).toHaveAttribute("title", OFFLINE_COPY);
    expect(button).not.toBeDisabled();

    await act(async () => {
      fireEvent.click(button);
      await Promise.resolve();
    });
    await waitFor(() => expect(suggestPattern).toHaveBeenCalled());
  });

  it("keeps the normal title when navigator.onLine is unavailable", () => {
    unlockAi();
    Object.defineProperty(navigator, "onLine", { configurable: true, value: undefined });
    render(<SuggestButton />);

    expect(screen.getByLabelText("Suggest a beat")).toHaveAttribute(
      "title",
      "Ask Gemini to fill the grid",
    );
  });
});
