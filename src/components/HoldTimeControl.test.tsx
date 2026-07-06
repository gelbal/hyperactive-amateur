// ABOUTME: HoldTimeControl tests — the hold-time range control freezes while an export render runs.
// ABOUTME: Export owns the Transport; timing controls must look disabled, not just no-op.
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { HoldTimeControl } from "./HoldTimeControl";
import { useAppStore } from "../store/useAppStore";

describe("HoldTimeControl", () => {
  afterEach(() => {
    cleanup();
    useAppStore.getState().actions.setIsExporting(false);
  });

  it("enables the slider when no export is running", () => {
    render(<HoldTimeControl />);

    expect(screen.getByLabelText("hold time")).toBeEnabled();
  });

  it("renders the slider disabled while exporting", () => {
    useAppStore.getState().actions.setIsExporting(true);
    render(<HoldTimeControl />);

    expect(screen.getByLabelText("hold time")).toBeDisabled();
  });
});
