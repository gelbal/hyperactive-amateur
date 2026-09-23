// ABOUTME: FeelDisclosure test — Scratch is a destructive action; it must take a second click to confirm.
import { act, cleanup, render, screen, fireEvent } from "@testing-library/react";
import { afterEach, describe, it, expect, beforeEach } from "vitest";
import { FeelDisclosure } from "./FeelDisclosure";
import { useAppStore } from "../store/useAppStore";
import type { Clip } from "../types";

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
    posterUrl: null,
  };
}

describe("FeelDisclosure", () => {
  beforeEach(() => useAppStore.getState().actions.reset());

  afterEach(() => {
    // Unmount before the store write (React warns about updates outside act);
    // reset() itself no-ops while exporting, so the flag is cleared here.
    cleanup();
    useAppStore.getState().actions.setIsExporting(false);
  });

  it("offers Style and Flow once four clips exist, frozen while exporting", () => {
    act(() => {
      for (let i = 0; i < 4; i++) useAppStore.getState().actions.setTrackClip(i, makeClip());
    });
    render(<FeelDisclosure />);
    fireEvent.click(screen.getByLabelText("Feel: cut rate, swing, hold, style, flow"));

    expect(screen.getByLabelText("Style")).toBeEnabled();
    expect(screen.getByLabelText("Flow")).toBeEnabled();

    act(() => useAppStore.getState().actions.setIsExporting(true));

    expect(screen.getByLabelText("Style")).toBeDisabled();
    expect(screen.getByLabelText("Flow")).toBeDisabled();
  });

  it("keeps Style and Flow out of the panel below four clips", () => {
    render(<FeelDisclosure />);
    fireEvent.click(screen.getByLabelText("Feel: cut rate, swing, hold, style, flow"));

    expect(screen.queryByLabelText("Style")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Flow")).not.toBeInTheDocument();
  });

  it("sizes the trigger to 44px on coarse pointers", () => {
    render(<FeelDisclosure />);

    expect(screen.getByLabelText("Feel: cut rate, swing, hold, style, flow")).toHaveClass(
      "pointer-coarse:min-h-11",
    );
  });

  it("keeps the phone button narrow: the cut · swing · hold summary shows only from lg", () => {
    render(<FeelDisclosure />);

    const button = screen.getByLabelText("Feel: cut rate, swing, hold, style, flow");
    expect(button).toHaveTextContent("Feel");
    const summary = screen.getByText(/1\/8 · 0% · 400ms/);
    expect(summary).toHaveClass("hidden", "lg:inline");
  });

  it("anchors the popover under the sticky header below lg (phones in both orientations) and under the button at lg", () => {
    render(<FeelDisclosure />);
    fireEvent.click(screen.getByLabelText("Feel: cut rate, swing, hold, style, flow"));

    const popover = screen.getByRole("dialog", { name: "Feel controls" });
    // Below sm the wrapper is not positioned, so the sticky header is the
    // containing block: the panel sits under the header at any scroll offset
    // and is capped to the space below it, scrolling inside.
    expect(popover.parentElement).toHaveClass("static", "lg:relative");
    expect(popover).toHaveClass(
      "absolute",
      "inset-x-3",
      "top-full",
      "mt-2",
      "w-auto",
      "max-w-[24rem]",
      "mx-auto",
      "max-h-[calc(100dvh_-_100%_-_1rem_-_env(safe-area-inset-top)_-_env(safe-area-inset-bottom))]",
      "overflow-y-auto",
      "lg:inset-x-auto",
      "lg:left-0",
      "lg:min-w-[18rem]",
      "lg:max-w-none",
      "lg:mx-0",
      "lg:max-h-none",
      "lg:overflow-visible",
    );
    const classes = popover.className.split(/\s+/);
    expect(classes).not.toContain("fixed");
    expect(classes).not.toContain("min-w-[18rem]");
  });

  it("Scratch needs a second click to confirm; Cancel keeps state", () => {
    useAppStore.getState().actions.setBpm(140);
    render(<FeelDisclosure />);
    fireEvent.click(screen.getByLabelText("Feel: cut rate, swing, hold, style, flow"));
    fireEvent.click(screen.getByLabelText("Scratch: start fresh"));
    fireEvent.click(screen.getByLabelText("Cancel scratch"));
    expect(useAppStore.getState().project.bpm).toBe(140);
    fireEvent.click(screen.getByLabelText("Scratch: start fresh"));
    fireEvent.click(screen.getByLabelText("Confirm scratch"));
    expect(useAppStore.getState().project.bpm).toBe(90);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
