// ABOUTME: FeelDisclosure test — Scratch is a destructive action; it must take a second click to confirm.
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, beforeEach } from "vitest";
import { FeelDisclosure } from "./FeelDisclosure";
import { useAppStore } from "../store/useAppStore";

describe("FeelDisclosure", () => {
  beforeEach(() => useAppStore.getState().actions.reset());

  it("sizes the trigger to 44px on coarse pointers", () => {
    render(<FeelDisclosure />);

    expect(screen.getByLabelText("Feel: cut rate, swing, hold")).toHaveClass(
      "pointer-coarse:min-h-11",
    );
  });

  it("anchors the popover under the sticky header on phones and under the button at sm", () => {
    render(<FeelDisclosure />);
    fireEvent.click(screen.getByLabelText("Feel: cut rate, swing, hold"));

    const popover = screen.getByRole("dialog", { name: "Feel controls" });
    // Below sm the wrapper is not positioned, so the sticky header is the
    // containing block: the panel sits under the header at any scroll offset
    // and is capped to the space below it, scrolling inside.
    expect(popover.parentElement).toHaveClass("static", "sm:relative");
    expect(popover).toHaveClass(
      "absolute",
      "inset-x-3",
      "top-full",
      "mt-2",
      "w-auto",
      "max-w-[24rem]",
      "mx-auto",
      "max-h-[calc(100dvh_-_100%_-_1rem_-_env(safe-area-inset-top))]",
      "overflow-y-auto",
      "sm:inset-x-auto",
      "sm:left-0",
      "sm:min-w-[18rem]",
      "sm:max-w-none",
      "sm:mx-0",
      "sm:max-h-none",
      "sm:overflow-visible",
    );
    const classes = popover.className.split(/\s+/);
    expect(classes).not.toContain("fixed");
    expect(classes).not.toContain("min-w-[18rem]");
  });

  it("Scratch needs a second click to confirm; Cancel keeps state", () => {
    useAppStore.getState().actions.setBpm(140);
    render(<FeelDisclosure />);
    fireEvent.click(screen.getByLabelText("Feel: cut rate, swing, hold"));
    fireEvent.click(screen.getByLabelText("Scratch: start fresh"));
    fireEvent.click(screen.getByLabelText("Cancel scratch"));
    expect(useAppStore.getState().project.bpm).toBe(140);
    fireEvent.click(screen.getByLabelText("Scratch: start fresh"));
    fireEvent.click(screen.getByLabelText("Confirm scratch"));
    expect(useAppStore.getState().project.bpm).toBe(90);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
