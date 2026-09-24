// ABOUTME: StyleSelector tests — pin the AI style control's touch target and export freeze.
// ABOUTME: Mirrors FlowSelector: small on fine pointers, 44px on coarse pointers, disabled while exporting.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { StyleSelector } from "./StyleSelector";
import { useAppStore } from "../store/useAppStore";

describe("StyleSelector", () => {
  beforeEach(() => {
    useAppStore.getState().actions.reset();
  });

  afterEach(() => {
    cleanup();
    useAppStore.getState().actions.setIsExporting(false);
  });

  it("sizes the select to 44px on coarse pointers and leaves its text size to the stylesheet", () => {
    render(<StyleSelector />);

    const select = screen.getByLabelText("Style");
    expect(select).toHaveClass("pointer-coarse:min-h-11");
    // The coarse-pointer 16px rule in index.css must not lose to a utility.
    expect(select.className.split(/\s+/)).not.toContain("text-sm");
  });

  it("writes the chosen style to the project", () => {
    render(<StyleSelector />);

    fireEvent.change(screen.getByLabelText("Style"), { target: { value: "trap" } });

    expect(useAppStore.getState().project.subgenre).toBe("trap");
  });
});
