// ABOUTME: StackSheet tests — pins Mood take sheet layout, dismissal, and row arming.
// ABOUTME: Covers the coarse-pointer bottom sheet contract and disabled recording affordance.
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StackSheet } from "./StackSheet";
import { useAppStore } from "../../store/useAppStore";
import * as moodPerformance from "../../lib/moodPerformance";
import { MAX_TAKES_PER_MIC } from "../../lib/moodStages";
import type { MoodMic, MoodTake } from "../../types";

const moodRecordingMocks = vi.hoisted(() => ({
  recordMoodTake: vi.fn(),
}));

vi.mock("../../lib/moodPerformance", () => ({
  armSelection: vi.fn(),
}));

vi.mock("../../lib/moodRecordingFlow", () => ({
  recordMoodTake: moodRecordingMocks.recordMoodTake,
}));

function makeBlob(bytes: number[], type: string): Blob {
  return new Blob([new Uint8Array(bytes)], { type });
}

function makeTake(id: string, overrides: Partial<MoodTake> = {}): MoodTake {
  return {
    id,
    videoBlob: makeBlob([1, 2, 3], "video/webm"),
    audioBlob: makeBlob([4, 5, 6], "audio/wav"),
    posterBlob: makeBlob([7, 8, 9], "image/jpeg"),
    url: `blob:test/${id}`,
    audioBuffer: { duration: 1.5, sampleRate: 48000 } as AudioBuffer,
    audioStatus: "ok",
    posterUrl: `blob:test/${id}-poster`,
    trimStartMs: 0,
    trimEndMs: 1500,
    durationSeconds: 1.5,
    cycleMultiple: 1,
    syncOffsetMs: 0,
    part: null,
    partSource: null,
    recordedAt: 1,
    ...overrides,
  };
}

function setupMood(): MoodMic {
  useAppStore.getState().actions.reset();
  useAppStore.getState().actions.setAppMode("mood");
  useAppStore.getState().actions.createMoodPiece("corners", "pocket");
  useAppStore.getState().actions.setMoodTake("mic-0", makeTake("take-a"));
  useAppStore.getState().actions.setMoodTake(
    "mic-0",
    makeTake("take-b", {
      durationSeconds: 2,
      trimEndMs: 2000,
      cycleMultiple: 2,
      posterUrl: null,
      part: "lead",
      partSource: "ai",
    }),
  );
  return useAppStore.getState().mood.piece!.mics[0];
}

function setupMoodBeforeTheOne(): MoodMic {
  useAppStore.getState().actions.reset();
  useAppStore.getState().actions.setAppMode("mood");
  useAppStore.getState().actions.createMoodPiece("corners", "pocket");
  return useAppStore.getState().mood.piece!.mics[0];
}

describe("StackSheet", () => {
  beforeEach(() => {
    useAppStore.getState().actions.reset();
    vi.mocked(moodPerformance.armSelection).mockReset();
    vi.mocked(moodPerformance.armSelection).mockImplementation((micId, entry) => {
      useAppStore.getState().actions.commitMoodSelections([{ micId, entry }]);
    });
    moodRecordingMocks.recordMoodTake.mockReset();
    moodRecordingMocks.recordMoodTake.mockResolvedValue(true);
  });

  afterEach(() => {
    act(() => {
      useAppStore.getState().actions.setIsExporting(false);
    });
  });

  it("renders take rows, Off, and an enabled overdub row in the clamped sheet", () => {
    const mic = setupMood();
    render(<StackSheet mic={mic} micNumber={1} open onClose={vi.fn()} />);

    const sheet = screen.getByRole("dialog", { name: "Mic 1 stack" });
    // Fine pointers anchor UPWARD (bottom-full) so the mic strip's coarse-only
    // scroll clip and the fixed-height panel can never swallow the popover.
    expect(sheet).toHaveClass(
      "absolute",
      "left-0",
      "bottom-full",
      "mb-2",
      "pointer-coarse:mb-0",
      "pointer-coarse:fixed",
      "pointer-coarse:inset-x-3",
      "pointer-coarse:bottom-3",
      "w-[min(24rem,calc(100vw-1.5rem))]",
      "max-h-[min(60vh,28rem)]",
      "overflow-x-hidden",
      "overflow-y-auto",
      "pointer-coarse:max-h-[min(70dvh,32rem)]",
    );

    const takeRow = screen.getByRole("button", { name: /^Take 1 1\.5s$/i });
    expect(takeRow).toHaveClass(
      "min-h-11",
      "pointer-coarse:min-h-12",
      "focus-visible:ring-2",
      "focus-visible:ring-orange-500",
    );
    expect(screen.getByRole("button", { name: /^Take 2 2\.0s$/i })).toBeInTheDocument();
    expect(screen.queryByText("Lead")).not.toBeInTheDocument();
    expect(screen.queryByText("No part yet")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "part for take 1: none — change" })).toHaveClass(
      "pointer-coarse:min-h-11",
    );
    expect(screen.getByRole("button", {
      name: "part for take 2: lead, AI suggestion",
    })).toHaveClass("pointer-coarse:min-h-11");
    expect(screen.getByRole("button", {
      name: "part for take 2: lead, AI suggestion",
    })).toHaveTextContent("AI");
    expect(screen.queryByRole("button", { name: "part lead for take 1" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove take 1" })).toHaveClass(
      "pointer-coarse:h-11",
      "pointer-coarse:w-11",
    );
    expect(screen.getByRole("button", { name: /^Off/i })).toHaveClass(
      "min-h-11",
      "pointer-coarse:min-h-12",
    );

    const newTake = screen.getByRole("button", {
      name: "new take starts at the top of the loop",
    });
    expect(newTake).not.toBeDisabled();
    expect(newTake).toHaveClass("min-h-11", "pointer-coarse:min-h-12");
    expect(screen.getByText("new take")).toBeInTheDocument();
  });

  it("shows checking only while a take classification is in flight", () => {
    const mic = setupMood();
    act(() => {
      useAppStore.getState().actions.setMoodPartChecking("take-a", true);
    });
    const { rerender } = render(
      <StackSheet mic={mic} micNumber={1} open onClose={vi.fn()} />,
    );

    expect(screen.getByRole("button", {
      name: "part for take 1: none, checking",
    })).toHaveTextContent("part? · checking");

    act(() => {
      useAppStore.getState().actions.setMoodPartChecking("take-a", false);
    });
    rerender(<StackSheet mic={mic} micNumber={1} open onClose={vi.fn()} />);
    expect(screen.getByRole("button", { name: "part for take 1: none — change" }))
      .toHaveTextContent("part?");
  });

  it("hides the default cycle multiple and shows non-default multiples", () => {
    const mic = setupMood();
    render(<StackSheet mic={mic} micNumber={1} open onClose={vi.fn()} />);

    expect(screen.queryByText("×1")).not.toBeInTheDocument();
    expect(screen.getByText("×2")).toHaveClass("font-mono", "text-zinc-500");
  });

  it("opens one row part picker, then closes and updates its compact chip after a pick", () => {
    const mic = setupMood();
    render(<StackSheet mic={mic} micNumber={1} open onClose={vi.fn()} />);

    const closedChip = screen.getByRole("button", { name: "part for take 1: none — change" });
    expect(closedChip).toHaveTextContent("part?");
    expect(closedChip).toHaveAttribute("aria-expanded", "false");
    const optionGroupId = closedChip.getAttribute("aria-controls");
    expect(optionGroupId).toBeTruthy();

    fireEvent.click(closedChip);

    expect(closedChip).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("group", { name: "parts for take 1" })).toHaveAttribute(
      "id",
      optionGroupId,
    );
    const optionGroup = screen.getByRole("group", { name: "parts for take 1" });
    const takeEntry = closedChip.closest("[data-take-entry]");
    const takeRow = takeEntry?.querySelector("[data-take-row]");
    expect(takeEntry).not.toBeNull();
    expect(takeRow).not.toBeNull();
    expect(optionGroup.parentElement).toBe(takeEntry);
    expect(optionGroup.previousElementSibling).toBe(takeRow);
    expect(takeRow).not.toContainElement(optionGroup);
    expect(optionGroup).toHaveClass("w-full", "flex", "flex-wrap");
    for (const part of ["lead", "harmony", "bass", "beatbox", "adlib", "none"]) {
      expect(screen.getByRole("button", { name: `part ${part} for take 1` })).toHaveClass(
        "pointer-coarse:min-h-11",
      );
    }
    expect(screen.getByRole("button", { name: "part lead for take 1" })).toHaveFocus();

    const harmonyOption = screen.getByRole("button", { name: "part harmony for take 1" });
    fireEvent.mouseDown(harmonyOption);
    fireEvent.click(harmonyOption);

    let take = useAppStore.getState().mood.piece?.mics[0].takes[0];
    expect(take?.part).toBe("harmony");
    expect(take?.partSource).toBe("user");
    const harmonyChip = screen.getByRole("button", {
      name: "part for take 1: harmony — change",
    });
    expect(harmonyChip).toHaveTextContent("harm");
    expect(harmonyChip).toHaveAttribute("aria-expanded", "false");
    expect(harmonyChip).toHaveFocus();
    expect(screen.queryByRole("button", { name: "part harmony for take 1" })).not.toBeInTheDocument();

    fireEvent.click(harmonyChip);
    fireEvent.click(screen.getByRole("button", { name: "part none for take 1" }));

    take = useAppStore.getState().mood.piece?.mics[0].takes[0];
    expect(take?.part).toBeNull();
    expect(take?.partSource).toBe("user");
    expect(screen.getByRole("button", { name: "part for take 1: none — change" })).toHaveTextContent(
      "part?",
    );
  });

  it("closes an open part picker when tapping elsewhere in the sheet", () => {
    const mic = setupMood();
    render(<StackSheet mic={mic} micNumber={1} open onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "part for take 1: none — change" }));
    expect(screen.getByRole("button", { name: "part lead for take 1" })).toBeInTheDocument();

    fireEvent.mouseDown(screen.getByText("MIC 1"));

    expect(screen.queryByRole("button", { name: "part lead for take 1" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "part for take 1: none — change" })).toHaveFocus();
  });

  it("uses only the mic identity in the sheet header", () => {
    const mic = setupMood();
    render(<StackSheet mic={mic} micNumber={1} open onClose={vi.fn()} />);

    expect(screen.getByText("MIC 1")).toBeInTheDocument();
    expect(screen.queryByText("Stack")).not.toBeInTheDocument();
  });

  it("disables the new take row with a stack full reason when the mic stack is full", () => {
    const mic = setupMood();
    for (let i = mic.takes.length; i < MAX_TAKES_PER_MIC; i += 1) {
      useAppStore.getState().actions.setMoodTake("mic-0", makeTake(`take-${i}`));
    }
    const fullMic = useAppStore.getState().mood.piece!.mics[0];
    render(<StackSheet mic={fullMic} micNumber={1} open onClose={vi.fn()} />);

    const newTake = screen.getByRole("button", {
      name: "new take stack full",
    });
    expect(newTake).toBeDisabled();
    expect(screen.getByText("stack full")).toBeInTheDocument();
  });

  it("disables the new take row with an active recording reason", () => {
    const mic = setupMood();
    useAppStore.getState().actions.setRecordingState("countdown", null);
    render(<StackSheet mic={mic} micNumber={1} open onClose={vi.fn()} />);

    const newTake = screen.getByRole("button", {
      name: "new take another recording active",
    });
    expect(newTake).toBeDisabled();
    expect(screen.getByText("another recording active")).toBeInTheDocument();
  });

  it("disables the new take row with an exporting reason", () => {
    const mic = setupMood();
    render(<StackSheet mic={mic} micNumber={1} open onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "part for take 1: none — change" }));
    act(() => {
      useAppStore.getState().actions.setIsExporting(true);
    });

    const newTake = screen.getByRole("button", {
      name: "new take exporting",
    });
    expect(newTake).toBeDisabled();
    expect(newTake).toHaveAttribute("title", "frozen during export");
    const partChip = screen.getByRole("button", { name: "part for take 1: none — change" });
    expect(partChip).toBeDisabled();
    expect(partChip).toHaveAttribute("title", "frozen during export");
    for (const option of within(
      screen.getByRole("group", { name: "parts for take 1" }),
    ).getAllByRole("button")) {
      expect(option).toBeDisabled();
      expect(option).toHaveAttribute("title", "frozen during export");
    }
    expect(screen.getAllByText("exporting").length).toBeGreaterThan(0);
  });

  it("keeps the no-cycle disabled row on record the One copy", () => {
    const mic = setupMoodBeforeTheOne();
    useAppStore.getState().actions.setRecordingState("countdown", null);
    render(<StackSheet mic={mic} micNumber={1} open onClose={vi.fn()} />);

    const recordOne = screen.getByRole("button", {
      name: "record the One another recording active",
    });
    expect(recordOne).toBeDisabled();
    expect(screen.queryByText("new take")).not.toBeInTheDocument();
  });

  it("enables the add row to record the One before the piece has a cycle", () => {
    const mic = setupMoodBeforeTheOne();
    const onClose = vi.fn();
    render(<StackSheet mic={mic} micNumber={1} open onClose={onClose} />);

    const recordOne = screen.getByRole("button", {
      name: "record the One your first loop sets the length",
    });
    expect(recordOne).not.toBeDisabled();

    fireEvent.click(recordOne);

    expect(moodRecordingMocks.recordMoodTake).toHaveBeenCalledWith("mic-0", {
      onError: expect.any(Function),
    });
    act(() => {
      const options = moodRecordingMocks.recordMoodTake.mock.calls[0]?.[1];
      options?.onError("camera permission denied");
    });
    expect(useAppStore.getState().recording.error).toBe("camera permission denied");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not render the headphone monitoring preference in the sheet", () => {
    const mic = setupMoodBeforeTheOne();
    render(<StackSheet mic={mic} micNumber={1} open onClose={vi.fn()} />);

    expect(screen.queryByLabelText("I've got headphones on")).not.toBeInTheDocument();
    expect(
      screen.queryByText("no headphones: loops go silent while you record"),
    ).not.toBeInTheDocument();
  });

  it("dismisses through outside mousedown and Escape using the shared hook", () => {
    const mic = setupMood();
    const onClose = vi.fn();
    const { rerender } = render(<StackSheet mic={mic} micNumber={1} open onClose={onClose} />);

    fireEvent.mouseDown(document.body);
    expect(onClose).toHaveBeenCalledTimes(1);

    onClose.mockClear();
    rerender(<StackSheet mic={mic} micNumber={1} open onClose={onClose} />);
    fireEvent.keyDown(document, { key: "Escape" });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("arms selected rows through moodPerformance and closes the sheet", () => {
    const mic = setupMood();
    const onClose = vi.fn();
    const { rerender } = render(<StackSheet mic={mic} micNumber={1} open onClose={onClose} />);

    fireEvent.click(screen.getByRole("button", { name: /^Take 1 1\.5s$/i }));

    expect(moodPerformance.armSelection).toHaveBeenCalledWith("mic-0", "take-a");
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(useAppStore.getState().mood.performance.selections["mic-0"]).toBe("take-a");

    onClose.mockClear();
    rerender(<StackSheet mic={mic} micNumber={1} open onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: /^Off/i }));

    expect(moodPerformance.armSelection).toHaveBeenCalledWith("mic-0", "off");
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(useAppStore.getState().mood.performance.selections["mic-0"]).toBe("off");
  });

  it("deletes a take through a two-step inline confirmation", () => {
    const mic = setupMood();
    const deleteMoodTake = vi.spyOn(useAppStore.getState().actions, "deleteMoodTake");
    render(<StackSheet mic={mic} micNumber={1} open onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Remove take 1" }));

    expect(screen.queryByRole("dialog", { name: /remove take/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirm remove take 1" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Confirm remove take 1" }));

    expect(deleteMoodTake).toHaveBeenCalledWith("mic-0", "take-a");
    deleteMoodTake.mockRestore();
  });

  it("allows deleting while performing except for the currently-live take", () => {
    setupMood();
    useAppStore.getState().actions.setMoodPerforming(true, 1);
    useAppStore.getState().actions.commitMoodSelections([{ micId: "mic-0", entry: "take-a" }]);
    const liveMic = useAppStore.getState().mood.piece!.mics[0];
    const deleteMoodTake = vi.spyOn(useAppStore.getState().actions, "deleteMoodTake");
    render(<StackSheet mic={liveMic} micNumber={1} open onClose={vi.fn()} />);

    const liveRemove = screen.getByRole("button", {
      name: "Remove take 1 disabled, live take",
    });
    expect(liveRemove).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Remove take 2" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm remove take 2" }));

    expect(deleteMoodTake).toHaveBeenCalledWith("mic-0", "take-b");
    deleteMoodTake.mockRestore();
  });

  it("disables delete affordances with recording reason while recording is active", () => {
    const mic = setupMood();
    useAppStore.getState().actions.setRecordingState("countdown", null);
    const deleteMoodTake = vi.spyOn(useAppStore.getState().actions, "deleteMoodTake");
    render(<StackSheet mic={mic} micNumber={1} open onClose={vi.fn()} />);

    const removeTakeOne = screen.getByRole("button", {
      name: "Remove take 1 disabled, recording",
    });
    const removeTakeTwo = screen.getByRole("button", {
      name: "Remove take 2 disabled, recording",
    });

    expect(removeTakeOne).toBeDisabled();
    expect(removeTakeTwo).toBeDisabled();
    expect(screen.getAllByText("recording")).toHaveLength(2);

    fireEvent.click(removeTakeOne);

    expect(screen.queryByRole("button", { name: "Confirm remove take 1" })).not.toBeInTheDocument();
    expect(deleteMoodTake).not.toHaveBeenCalled();
    deleteMoodTake.mockRestore();
  });

  it("resets inline delete confirmation after the sheet closes", () => {
    const mic = setupMood();
    const { rerender } = render(<StackSheet mic={mic} micNumber={1} open onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Remove take 1" }));
    expect(screen.getByRole("button", { name: "Confirm remove take 1" })).toBeInTheDocument();

    rerender(<StackSheet mic={mic} micNumber={1} open={false} onClose={vi.fn()} />);
    rerender(<StackSheet mic={mic} micNumber={1} open onClose={vi.fn()} />);

    expect(screen.queryByRole("button", { name: "Confirm remove take 1" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove take 1" })).toBeInTheDocument();
  });
});
