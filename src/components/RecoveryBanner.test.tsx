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

    fireEvent.click(screen.getByLabelText("Dismiss chop recovery notice"));

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

  it("renders scoped Mood warnings through the existing recovery notice", () => {
    useAppStore
      .getState()
      .actions.setRecoveryWarningsForScope(
        "mood",
        ["Mood take take-1 in mic-0 audio unavailable — re-record to restore sound."],
        true,
      );

    render(<RecoveryBanner />);

    expect(screen.getByText("Recovered saved mood")).toBeInTheDocument();
    expect(
      screen.getByText("Mood take take-1 in mic-0 audio unavailable — re-record to restore sound."),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("Dismiss mood recovery notice"));

    expect(useAppStore.getState().ui.recoveryWarnings).toEqual([]);
    expect(useAppStore.getState().ui.degradedRecoveryScopes).toEqual([]);
  });

  it("dismisses only Mood warnings when both scopes are degraded", () => {
    useAppStore
      .getState()
      .actions.setRecoveryWarningsForScope(
        "chop",
        ["Track 1 audio unavailable — re-record to restore sound."],
        true,
      );
    useAppStore
      .getState()
      .actions.setRecoveryWarningsForScope(
        "mood",
        ["Mood take take-1 in mic-0 audio unavailable — re-record to restore sound."],
        true,
      );

    render(<RecoveryBanner />);

    fireEvent.click(screen.getByLabelText("Dismiss mood recovery notice"));

    expect(useAppStore.getState().ui.recoveryWarnings).toEqual([
      "Track 1 audio unavailable — re-record to restore sound.",
    ]);
    expect(useAppStore.getState().ui.recoveryWarningScopes).toEqual(["chop"]);
    expect(useAppStore.getState().ui.degradedRecoveryScopes).toEqual(["chop"]);
    expect(screen.getByText("Track 1 audio unavailable — re-record to restore sound.")).toBeInTheDocument();
    expect(
      screen.queryByText("Mood take take-1 in mic-0 audio unavailable — re-record to restore sound."),
    ).not.toBeInTheDocument();
  });

  it("dismisses only Chop warnings when both scopes are degraded", () => {
    useAppStore
      .getState()
      .actions.setRecoveryWarningsForScope(
        "chop",
        ["Track 1 audio unavailable — re-record to restore sound."],
        true,
      );
    useAppStore
      .getState()
      .actions.setRecoveryWarningsForScope(
        "mood",
        ["Mood take take-1 in mic-0 audio unavailable — re-record to restore sound."],
        true,
      );

    render(<RecoveryBanner />);

    fireEvent.click(screen.getByLabelText("Dismiss chop recovery notice"));

    expect(useAppStore.getState().ui.recoveryWarnings).toEqual([
      "Mood take take-1 in mic-0 audio unavailable — re-record to restore sound.",
    ]);
    expect(useAppStore.getState().ui.recoveryWarningScopes).toEqual(["mood"]);
    expect(useAppStore.getState().ui.degradedRecoveryScopes).toEqual(["mood"]);
    expect(
      screen.queryByText("Track 1 audio unavailable — re-record to restore sound."),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText("Mood take take-1 in mic-0 audio unavailable — re-record to restore sound."),
    ).toBeInTheDocument();
  });
});
