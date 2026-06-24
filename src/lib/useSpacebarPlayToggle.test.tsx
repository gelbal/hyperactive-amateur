// ABOUTME: useSpacebarPlayToggle tests — start gating and editable-target suppression.
import { render } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

const togglePlayback = vi.fn();
vi.mock("./audio", () => ({
  togglePlayback: (...args: unknown[]) => togglePlayback(...args),
}));

import { useSpacebarPlayToggle } from "./useSpacebarPlayToggle";
import { useAppStore } from "../store/useAppStore";

function Harness({ withInput = false }: { withInput?: boolean }) {
  useSpacebarPlayToggle();
  return withInput ? <input data-testid="x" /> : null;
}

describe("useSpacebarPlayToggle", () => {
  beforeEach(() => {
    togglePlayback.mockClear();
    useAppStore.getState().actions.reset();
  });

  it("toggles on Space while idle and ignores editable targets", () => {
    const { getByTestId } = render(<Harness withInput />);

    document.body.dispatchEvent(new KeyboardEvent("keydown", { code: "Space", bubbles: true }));
    expect(togglePlayback).toHaveBeenCalledTimes(1);

    togglePlayback.mockClear();
    getByTestId("x").dispatchEvent(new KeyboardEvent("keydown", { code: "Space", bubbles: true }));
    expect(togglePlayback).not.toHaveBeenCalled();
  });

  it("does not start playback from Space while recording is active", () => {
    render(<Harness />);
    useAppStore.getState().actions.setRecordingState("recording", 0);

    document.body.dispatchEvent(new KeyboardEvent("keydown", { code: "Space", bubbles: true }));

    expect(togglePlayback).not.toHaveBeenCalled();
  });

  it("does not stop export-owned playback from Space while exporting", () => {
    render(<Harness />);
    useAppStore.getState().actions.setIsExporting(true);
    useAppStore.getState().actions.setIsPlaying(true);

    document.body.dispatchEvent(new KeyboardEvent("keydown", { code: "Space", bubbles: true }));

    expect(togglePlayback).not.toHaveBeenCalled();
  });
});
