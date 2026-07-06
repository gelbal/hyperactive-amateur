// ABOUTME: FlowSelector tests — pin the compact AI flow control's touch target contract.
// ABOUTME: The select stays visually small on fine pointers but reaches 44px on coarse pointers.
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { FlowSelector } from "./FlowSelector";
import { useAppStore } from "../store/useAppStore";

describe("FlowSelector", () => {
  afterEach(() => {
    cleanup();
    useAppStore.getState().actions.setIsExporting(false);
  });

  it("sizes the select to 44px on coarse pointers", () => {
    render(<FlowSelector />);

    expect(screen.getByLabelText("Flow")).toHaveClass("pointer-coarse:min-h-11");
  });

  it("enables the select when no export is running", () => {
    render(<FlowSelector />);

    expect(screen.getByLabelText("Flow")).toBeEnabled();
  });

  it("renders the select disabled while exporting", () => {
    useAppStore.getState().actions.setIsExporting(true);
    render(<FlowSelector />);

    expect(screen.getByLabelText("Flow")).toBeDisabled();
  });
});
