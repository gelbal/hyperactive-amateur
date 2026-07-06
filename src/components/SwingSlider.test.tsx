// ABOUTME: SwingSlider tests — the swing range control freezes while an export render runs.
// ABOUTME: Export owns the Transport; timing controls must look disabled, not just no-op.
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SwingSlider } from "./SwingSlider";
import { useAppStore } from "../store/useAppStore";

describe("SwingSlider", () => {
  afterEach(() => {
    cleanup();
    useAppStore.getState().actions.setIsExporting(false);
  });

  it("enables the slider when no export is running", () => {
    render(<SwingSlider />);

    expect(screen.getByLabelText("swing")).toBeEnabled();
  });

  it("renders the slider disabled while exporting", () => {
    useAppStore.getState().actions.setIsExporting(true);
    render(<SwingSlider />);

    expect(screen.getByLabelText("swing")).toBeDisabled();
  });
});
