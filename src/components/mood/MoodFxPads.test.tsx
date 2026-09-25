// ABOUTME: MoodFxPads tests — pins W3 pad semantics, accessibility, and capture locks.
// ABOUTME: Exercises hold pointer edges plus module-local active state subscriptions.
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const fxMocks = vi.hoisted(() => {
  type Snapshot = {
    brakeActive: boolean;
    echoActive: boolean;
    gateActive: boolean;
    harmonizeActive: boolean;
  };
  let snapshot: Snapshot = {
    brakeActive: false,
    echoActive: false,
    gateActive: false,
    harmonizeActive: false,
  };
  const listeners = new Set<() => void>();
  return {
    getMoodFxPadState: () => snapshot,
    pressMoodBrake: vi.fn(() => true),
    pressMoodGate: vi.fn(() => true),
    pressMoodHarmonize: vi.fn(() => true),
    releaseMoodBrake: vi.fn(() => true),
    releaseMoodGate: vi.fn(() => true),
    releaseMoodHarmonize: vi.fn(() => true),
    setSnapshot(next: Snapshot) {
      snapshot = next;
      for (const listener of listeners) listener();
    },
    subscribeMoodFxPadState(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    triggerMoodEcho: vi.fn(() => true),
  };
});

vi.mock("../../lib/moodFx", () => ({
  getMoodFxPadState: fxMocks.getMoodFxPadState,
  pressMoodBrake: fxMocks.pressMoodBrake,
  pressMoodGate: fxMocks.pressMoodGate,
  pressMoodHarmonize: fxMocks.pressMoodHarmonize,
  releaseMoodBrake: fxMocks.releaseMoodBrake,
  releaseMoodGate: fxMocks.releaseMoodGate,
  releaseMoodHarmonize: fxMocks.releaseMoodHarmonize,
  subscribeMoodFxPadState: fxMocks.subscribeMoodFxPadState,
  triggerMoodEcho: fxMocks.triggerMoodEcho,
}));

import { MoodFxPads } from "./MoodFxPads";
import { useAppStore } from "../../store/useAppStore";
import { makeMoodTake } from "../../test-utils/moodFixtures";

function makeHarmonizeReady(): void {
  const actions = useAppStore.getState().actions;
  actions.setMoodTake("mic-0", makeMoodTake({ id: "the-one" }));
  actions.applyMoodKeyEstimateIfCurrent(
    "the-one",
    { key: "A", mode: "minor", confidence: 0.9 },
    useAppStore.getState().session.moodSessionId,
  );
}

describe("MoodFxPads", () => {
  beforeEach(() => {
    window.localStorage.clear();
    useAppStore.getState().actions.setIsExporting(false);
    useAppStore.getState().actions.reset();
    fxMocks.pressMoodBrake.mockClear();
    fxMocks.pressMoodGate.mockClear();
    fxMocks.pressMoodHarmonize.mockClear();
    fxMocks.releaseMoodBrake.mockClear();
    fxMocks.releaseMoodGate.mockClear();
    fxMocks.releaseMoodHarmonize.mockClear();
    fxMocks.triggerMoodEcho.mockClear();
    fxMocks.setSnapshot({
      brakeActive: false,
      echoActive: false,
      gateActive: false,
      harmonizeActive: false,
    });
  });

  it("renders four compact chunky FX pads with exact labels, keys, and coarse floors", () => {
    useAppStore.getState().actions.createMoodPiece("row", "pocket");
    makeHarmonizeReady();
    useAppStore.getState().actions.setMoodPerforming(true, 4);

    render(<MoodFxPads />);

    const gate = screen.getByRole("button", { name: "Gate the loop (hold)" });
    const echo = screen.getByRole("button", { name: "Echo throw" });
    const brake = screen.getByRole("button", { name: "Brake the loop (hold)" });
    const harmonize = screen.getByRole("button", { name: "Harmonize the loop (hold)" });
    for (const pad of [gate, echo, brake, harmonize]) {
      expect(pad).toHaveClass(
        "h-14",
        "min-w-16",
        "rounded",
        "border-2",
        "pointer-coarse:min-h-11",
      );
      expect(pad).not.toBeDisabled();
      expect(pad).toHaveAttribute("aria-pressed", "false");
    }
    expect(gate).toHaveTextContent("GATE");
    expect(gate).toHaveTextContent("hold · G");
    expect(echo).toHaveTextContent("ECHO");
    expect(echo).toHaveTextContent("tap · E");
    expect(brake).toHaveTextContent("BRAKE");
    expect(brake).toHaveTextContent("hold · B");
    expect(harmonize).toHaveTextContent("HARMONIZE");
    expect(harmonize).toHaveTextContent("hold · H");
    expect(brake.compareDocumentPosition(harmonize) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(harmonize).toHaveAttribute(
      "title",
      "layers your loop at AI-picked thirds and fifths (A minor)",
    );
  });

  it("uses pointer down/up for holds and a tap for Echo", () => {
    useAppStore.getState().actions.createMoodPiece("row", "pocket");
    makeHarmonizeReady();
    useAppStore.getState().actions.setMoodPerforming(true, 4);
    render(<MoodFxPads />);

    const gate = screen.getByRole("button", { name: "Gate the loop (hold)" });
    const echo = screen.getByRole("button", { name: "Echo throw" });
    const brake = screen.getByRole("button", { name: "Brake the loop (hold)" });
    const harmonize = screen.getByRole("button", { name: "Harmonize the loop (hold)" });
    fireEvent.pointerDown(gate, { button: 0, pointerId: 1 });
    fireEvent.pointerUp(gate, { button: 0, pointerId: 1 });
    fireEvent.click(echo);
    fireEvent.pointerDown(brake, { button: 0, pointerId: 2 });
    fireEvent.pointerCancel(brake, { pointerId: 2 });
    fireEvent.pointerDown(harmonize, { button: 0, pointerId: 3 });
    fireEvent.pointerUp(harmonize, { button: 0, pointerId: 3 });

    expect(fxMocks.pressMoodGate).toHaveBeenCalledTimes(1);
    expect(fxMocks.releaseMoodGate).toHaveBeenCalledTimes(1);
    expect(fxMocks.triggerMoodEcho).toHaveBeenCalledTimes(1);
    expect(fxMocks.pressMoodBrake).toHaveBeenCalledTimes(1);
    expect(fxMocks.releaseMoodBrake).toHaveBeenCalledTimes(1);
    expect(fxMocks.pressMoodHarmonize).toHaveBeenCalledTimes(1);
    expect(fxMocks.releaseMoodHarmonize).toHaveBeenCalledTimes(1);
  });

  it("reflects module-local active state through aria-pressed", () => {
    useAppStore.getState().actions.createMoodPiece("row", "pocket");
    makeHarmonizeReady();
    useAppStore.getState().actions.setMoodPerforming(true, 4);
    render(<MoodFxPads />);

    act(() => {
      fxMocks.setSnapshot({
        brakeActive: true,
        echoActive: true,
        gateActive: true,
        harmonizeActive: true,
      });
    });

    for (const name of [
      "Gate the loop (hold)",
      "Echo throw",
      "Brake the loop (hold)",
      "Harmonize the loop (hold)",
    ]) {
      expect(screen.getByRole("button", { name })).toHaveAttribute("aria-pressed", "true");
      expect(screen.getByRole("button", { name })).toHaveClass(
        "border-orange-500",
        "bg-orange-500",
        "text-zinc-950",
      );
    }
  });

  it("gives Harmonize a truthful key-estimate disabled reason with capture precedence", () => {
    useAppStore.getState().actions.createMoodPiece("row", "pocket");
    useAppStore.getState().actions.setMoodTake(
      "mic-0",
      makeMoodTake({ id: "the-one" }),
    );
    useAppStore.getState().actions.setMoodPerforming(true, 4);
    const { rerender } = render(<MoodFxPads />);
    const harmonize = screen.getByRole("button", { name: "Harmonize the loop (hold)" });
    expect(harmonize).toBeDisabled();
    expect(harmonize).toHaveTextContent("no key yet");
    expect(harmonize).toHaveAttribute("title", "Harmonize needs a key estimate from the One");

    act(() => {
      useAppStore.getState().actions.setMoodPartChecking("the-one", true);
    });
    expect(harmonize).toHaveTextContent("finding key…");

    act(() => {
      useAppStore.getState().actions.setRecordingState("recording", 0);
    });
    rerender(<MoodFxPads />);
    expect(harmonize).toHaveAttribute("title", "Harmonize is locked during capture");
  });

  it("disables with reason-bearing titles while stopped or capturing", () => {
    useAppStore.getState().actions.createMoodPiece("row", "pocket");
    const { rerender } = render(<MoodFxPads />);

    for (const name of [
      "Gate the loop (hold)",
      "Echo throw",
      "Brake the loop (hold)",
      "Harmonize the loop (hold)",
    ]) {
      expect(screen.getByRole("button", { name })).toHaveTextContent("press Play");
    }

    expect(screen.getByRole("button", { name: "Gate the loop (hold)" })).toHaveAttribute(
      "title",
      "Start performance to use Gate",
    );
    expect(screen.getByRole("button", { name: "Echo throw" })).toHaveAttribute(
      "title",
      "Start performance to use Echo",
    );
    expect(screen.getByRole("button", { name: "Brake the loop (hold)" })).toHaveAttribute(
      "title",
      "Start performance to use Brake",
    );

    act(() => {
      useAppStore.getState().actions.setRecordingState("recording", 0);
    });
    rerender(<MoodFxPads />);

    for (const [name, label] of [
      ["Gate the loop (hold)", "Gate"],
      ["Echo throw", "Echo"],
      ["Brake the loop (hold)", "Brake"],
    ]) {
      const pad = screen.getByRole("button", { name });
      expect(pad).toBeDisabled();
      expect(pad).toHaveAttribute("title", `${label} is locked during capture`);
    }
  });
});
