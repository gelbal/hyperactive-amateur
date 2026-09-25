// ABOUTME: RecordingStatusBar tests pin the shared recording-mode status language and progress display.
// ABOUTME: Covers all four states, receipt flashes, muted-loop guidance, and control callbacks.
import { fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";
import { RecordingStatusBar } from "./RecordingStatusBar";

const baseProps: ComponentProps<typeof RecordingStatusBar> = {
  identity: "T3",
  state: "preparing",
  beatSeconds: 1,
  countdownEndsAt: null,
  captureEndsAt: null,
  nowSeconds: () => 10,
};

function renderBar(overrides: Partial<ComponentProps<typeof RecordingStatusBar>> = {}) {
  return render(<RecordingStatusBar {...baseProps} {...overrides} />);
}

describe("RecordingStatusBar", () => {
  it("announces preparing without timing numerals", () => {
    const { container } = renderBar();

    expect(container.firstElementChild).toHaveTextContent("● REC T3");
    expect(screen.getByText("getting ready")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("preparing");
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });

  it("uses the word count-in and wires the countdown cancel action", () => {
    const onCancel = vi.fn();
    const { container } = renderBar({
      state: "countdown",
      beatSeconds: 0.5,
      countdownEndsAt: 11.5,
      onCancel,
    });

    expect(container.firstElementChild).toHaveTextContent("● REC T3 · count-in");
    expect(screen.getByRole("status")).toHaveTextContent("count-in");
    expect(screen.getByRole("status")).not.toHaveTextContent(/\b[1-3]\b/);

    fireEvent.click(screen.getByRole("button", { name: "Cancel take" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("shows clamped recording progress, elapsed time, muted-loop guidance, and stop wiring", () => {
    const onStop = vi.fn();
    renderBar({
      state: "recording",
      countdownEndsAt: 10,
      captureEndsAt: 12,
      nowSeconds: () => 13,
      loopsMuted: true,
      guidance: "tap when the hit lands",
      onStop,
      stopLabel: "finish take",
    });

    const progress = screen.getByRole("progressbar", { name: "Recording progress" });
    expect(progress).toHaveAttribute("aria-valuemin", "0");
    expect(progress).toHaveAttribute("aria-valuemax", "2");
    expect(progress).toHaveAttribute("aria-valuenow", "2");
    expect(progress.firstElementChild).toHaveStyle({ width: "100%" });
    expect(screen.getByText("2.0s")).toHaveClass("font-mono", "tabular-nums");
    expect(screen.getByText("loops muted · no headphones")).toBeInTheDocument();
    expect(screen.getByText("tap when the hit lands")).toBeInTheDocument();
    expect(screen.getByText("finish take")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Stop take now" }));
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it("keeps the ticking timer outside the transition-only live region", () => {
    const { container, rerender } = renderBar({
      state: "recording",
      countdownEndsAt: 10,
      captureEndsAt: 12,
      nowSeconds: () => 11.2,
    });

    const root = container.firstElementChild;
    const liveRegion = screen.getByRole("status");
    expect(root).toHaveClass("flex-1", "min-w-0");
    expect(root).not.toHaveClass("w-full");
    expect(root).not.toHaveAttribute("aria-live");
    expect(root).not.toHaveAttribute("aria-atomic");
    expect(liveRegion).toHaveClass("sr-only");
    expect(liveRegion).toHaveAttribute("aria-live", "polite");
    expect(liveRegion).toHaveAttribute("aria-atomic", "true");
    expect(liveRegion).toHaveTextContent("recording");
    expect(liveRegion).not.toHaveTextContent("1.2s");
    expect(root).toHaveTextContent("1.2s");

    rerender(
      <RecordingStatusBar
        {...baseProps}
        state="finishing"
        countdownEndsAt={10}
        captureEndsAt={12}
        nowSeconds={() => 12}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("saving");
  });

  it("shows an indeterminate finishing state", () => {
    renderBar({
      state: "finishing",
      countdownEndsAt: 10,
      captureEndsAt: 12,
      nowSeconds: () => 12,
    });

    expect(screen.getByText("saving…")).toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("renders kept and too-short receipt flashes with an optional dismiss action", () => {
    const onDismissReceipt = vi.fn();
    const { rerender } = renderBar({
      state: "finishing",
      receipt: { kind: "kept", seconds: 2.4, multiple: 2 },
      onDismissReceipt,
    });

    expect(screen.getByText("kept 2.4s · ×2")).toHaveClass("text-orange-500");
    expect(screen.getByRole("status")).toHaveTextContent("take kept");
    const dismiss = screen.getByRole("button", { name: "dismiss take note" });
    expect(dismiss).toHaveTextContent("×");
    expect(dismiss).toHaveClass("pointer-coarse:min-h-11", "pointer-coarse:min-w-11");
    fireEvent.click(dismiss);
    expect(onDismissReceipt).toHaveBeenCalledTimes(1);

    rerender(
      <RecordingStatusBar
        {...baseProps}
        state="finishing"
        receipt={{ kind: "too-short" }}
        onDismissReceipt={onDismissReceipt}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("take too short, try again");
  });
});
