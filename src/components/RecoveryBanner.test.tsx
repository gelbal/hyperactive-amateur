// ABOUTME: RecoveryBanner tests — degraded rehydrate warnings are visible and dismissible.
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, beforeEach } from "vitest";
import { RecoveryBanner } from "./RecoveryBanner";
import { useAppStore } from "../store/useAppStore";

describe("RecoveryBanner", () => {
  beforeEach(() => {
    useAppStore.getState().actions.reset();
    useAppStore.getState().actions.setRecoveryWarnings([]);
  });

  it("renders recovery warnings and dismisses them through the store", () => {
    useAppStore
      .getState()
      .actions.setRecoveryWarnings(["bpm was clamped", "Track 1 steps were resized"]);

    render(<RecoveryBanner />);

    expect(screen.getByLabelText("Project recovery notice")).toBeInTheDocument();
    expect(screen.getByText("bpm was clamped")).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("Dismiss recovery notice"));

    expect(useAppStore.getState().ui.recoveryWarnings).toEqual([]);
    expect(screen.queryByLabelText("Project recovery notice")).toBeNull();
  });

  it("summarizes additional warnings after the first three", () => {
    useAppStore
      .getState()
      .actions.setRecoveryWarnings(["one", "two", "three", "four", "five"]);

    render(<RecoveryBanner />);

    expect(screen.getByText("2 more recovery fixes were applied.")).toBeInTheDocument();
  });

  it("summarizes tracks repaired with unavailable audio", () => {
    useAppStore.getState().actions.setRecoveryWarnings([
      "Track 1 audio unavailable — re-record to restore sound.",
      "Track 3 audio unavailable — re-record to restore sound.",
      "bpm was clamped",
    ]);

    render(<RecoveryBanner />);

    expect(
      screen.getByText("2 tracks have audio unavailable and need re-recording."),
    ).toBeInTheDocument();
  });
});
