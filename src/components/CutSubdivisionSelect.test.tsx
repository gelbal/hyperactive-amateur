// ABOUTME: CutSubdivisionSelect tests — pin the cut-rate select's touch target contract.
// ABOUTME: Coarse-pointer users get a 44px control without changing the fine-pointer layout.
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { CutSubdivisionSelect } from "./CutSubdivisionSelect";
import { useAppStore } from "../store/useAppStore";

describe("CutSubdivisionSelect", () => {
  afterEach(() => {
    cleanup();
    useAppStore.getState().actions.setIsExporting(false);
  });

  it("sizes the select to 44px on coarse pointers", () => {
    render(<CutSubdivisionSelect />);

    expect(screen.getByLabelText("cut rate")).toHaveClass(
      "pointer-coarse:min-h-11",
    );
  });

  it("enables the select when no export is running", () => {
    render(<CutSubdivisionSelect />);

    expect(screen.getByLabelText("cut rate")).toBeEnabled();
  });

  it("renders the select disabled while exporting", () => {
    useAppStore.getState().actions.setIsExporting(true);
    render(<CutSubdivisionSelect />);

    expect(screen.getByLabelText("cut rate")).toBeDisabled();
  });
});
