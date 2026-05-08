// ABOUTME: VariationButtons tests — disabled gating, click → varyPattern with current subgenre.
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
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
  };
}

describe("VariationButtons", () => {
  beforeEach(() => {
    varyPattern.mockReset();
    useAppStore.getState().actions.reset();
  });

  it("disabled until 4+ clips AND a non-empty pattern exist", () => {
    render(<VariationButtons />);
    // No clips, no pattern → disabled.
    expect(screen.getByLabelText("Busier")).toBeDisabled();

    const actions = useAppStore.getState().actions;
    for (let i = 0; i < 4; i++) actions.setTrackClip(i, makeClip());
    actions.toggleStep(0, 0);
    // 4 clips + a step → enabled.
    render(<VariationButtons />);
    expect(screen.getAllByLabelText("Busier")[1]).not.toBeDisabled();
  });

  it("clicking a variation calls varyPattern with the current subgenre + variation arg", async () => {
    const grid = Array.from({ length: 8 }, () => Array.from({ length: 16 }, () => true));
    varyPattern.mockResolvedValue(grid);
    const actions = useAppStore.getState().actions;
    for (let i = 0; i < 4; i++) actions.setTrackClip(i, makeClip());
    actions.toggleStep(0, 0);
    actions.setSubgenre("lo-fi");

    render(<VariationButtons />);
    fireEvent.click(screen.getByLabelText("Half-time"));
    await waitFor(() => expect(varyPattern).toHaveBeenCalled());
    const arg = varyPattern.mock.calls[0]?.[0] as { variation: string; subgenre: string };
    expect(arg.variation).toBe("halftime");
    expect(arg.subgenre).toBe("lo-fi");
  });
});
