// ABOUTME: RecordCountdown tests — overlay only when state === countdown; counts down each second.
import { render, screen, act } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { RecordCountdown } from "./RecordCountdown";
import { useAppStore } from "../store/useAppStore";

describe("RecordCountdown", () => {
  beforeEach(() => {
    useAppStore.getState().actions.reset();
    vi.useRealTimers();
  });

  it("renders nothing while idle", () => {
    render(<RecordCountdown />);
    expect(screen.queryByLabelText("recording countdown")).not.toBeInTheDocument();
  });

  it("renders the overlay starting at 3 when state is countdown", () => {
    useAppStore.getState().actions.setRecordingState("countdown", 0);
    render(<RecordCountdown />);
    expect(screen.getByLabelText("recording countdown")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("counts down across seconds", () => {
    vi.useFakeTimers();
    useAppStore.getState().actions.setRecordingState("countdown", 0);
    render(<RecordCountdown />);
    expect(screen.getByText("3")).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.getByText("2")).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.getByText("1")).toBeInTheDocument();
  });

  it("disappears when state goes back to idle", () => {
    useAppStore.getState().actions.setRecordingState("countdown", 0);
    const { rerender } = render(<RecordCountdown />);
    expect(screen.getByLabelText("recording countdown")).toBeInTheDocument();
    act(() => {
      useAppStore.getState().actions.setRecordingState("idle", null);
    });
    rerender(<RecordCountdown />);
    expect(screen.queryByLabelText("recording countdown")).not.toBeInTheDocument();
  });
});
