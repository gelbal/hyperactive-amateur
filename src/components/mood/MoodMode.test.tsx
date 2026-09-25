// ABOUTME: MoodMode tests — verifies the first lazy Mood shell and stage picker.
// ABOUTME: Covers piece birth, stage display, mic strip, and Mood performance controls.
import "fake-indexeddb/auto";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const audioMocks = vi.hoisted(() => ({
  decodeAudioData: vi.fn(),
  currentTime: 10,
}));

const moodTransportMocks = vi.hoisted(() => ({
  armMoodLensCommit: vi.fn(),
  armMoodSelectionCommit: vi.fn(),
  consumeDueCommits: vi.fn(() => []),
  startMoodPerformance: vi.fn(),
  stopMoodPerformance: vi.fn(),
}));

const moodRecordingMocks = vi.hoisted(() => ({
  backfillMoodOneClassification: vi.fn(),
  countInBeatSeconds: vi.fn(() => 0.5),
  recordMoodTake: vi.fn(),
  registerMoodRecordingInterrupt: vi.fn(),
  stopMoodTakeEarly: vi.fn(),
  unregisterMoodRecordingInterrupt: vi.fn(),
}));

const recordingInterruptMocks = vi.hoisted(() => ({
  interruptActiveRecording: vi.fn(),
}));

vi.mock("../../lib/audio", () => ({
  getAudioContext: () => ({
    decodeAudioData: audioMocks.decodeAudioData,
    currentTime: audioMocks.currentTime,
  }),
}));

vi.mock("../../lib/moodTransport", () => ({
  armMoodLensCommit: moodTransportMocks.armMoodLensCommit,
  armMoodSelectionCommit: moodTransportMocks.armMoodSelectionCommit,
  consumeDueCommits: moodTransportMocks.consumeDueCommits,
  registerMoodPerformanceInterrupt: () => () => undefined,
  startMoodPerformance: moodTransportMocks.startMoodPerformance,
  stopMoodPerformance: moodTransportMocks.stopMoodPerformance,
}));

vi.mock("../../lib/moodRecordingFlow", () => ({
  backfillMoodOneClassification: moodRecordingMocks.backfillMoodOneClassification,
  countInBeatSeconds: moodRecordingMocks.countInBeatSeconds,
  recordMoodTake: moodRecordingMocks.recordMoodTake,
  registerMoodRecordingInterrupt: moodRecordingMocks.registerMoodRecordingInterrupt,
  stopMoodTakeEarly: moodRecordingMocks.stopMoodTakeEarly,
}));

vi.mock("../../lib/recordingInterrupt", () => ({
  interruptActiveRecording: recordingInterruptMocks.interruptActiveRecording,
}));

vi.mock("../../lib/useMoodKeys", () => ({
  useMoodKeys: vi.fn(),
}));

import { MoodMode } from "./MoodMode";
import { CREDIT_STYLES } from "../../lib/moodCredits";
import { createEmptyMoodPiece } from "../../lib/moodStages";
import { clearMoodPiece, saveMoodPiece } from "../../lib/moodPersistence";
import * as moodRehydrate from "../../lib/moodRehydrate";
import { useAppStore } from "../../store/useAppStore";
import { clearLogs, getLogs, LOG_EVENTS } from "../../lib/logger";
import type { MoodTake } from "../../types";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function makeBlob(bytes: number[], type: string): Blob {
  return new Blob([new Uint8Array(bytes)], { type });
}

function makeTake(overrides: Partial<MoodTake> = {}): MoodTake {
  const id = overrides.id ?? "saved-take";
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

function renderMoodMode() {
  return render(
    <>
      <div data-mood-header-slot />
      <MoodMode />
    </>,
  );
}

function moodHeaderSlot(container: HTMLElement): HTMLElement {
  const slot = container.querySelector<HTMLElement>("[data-mood-header-slot]");
  if (!slot) throw new Error("Mood header slot did not render");
  return slot;
}

describe("MoodMode", () => {
  beforeEach(async () => {
    window.localStorage.clear();
    await clearMoodPiece();
    audioMocks.decodeAudioData.mockReset();
    audioMocks.decodeAudioData.mockResolvedValue({ duration: 1.5, sampleRate: 48000 } as AudioBuffer);
    audioMocks.currentTime = 10;
    moodTransportMocks.startMoodPerformance.mockReset();
    moodTransportMocks.startMoodPerformance.mockResolvedValue(undefined);
    moodTransportMocks.stopMoodPerformance.mockReset();
    moodTransportMocks.armMoodLensCommit.mockReset();
    moodTransportMocks.armMoodSelectionCommit.mockReset();
    moodTransportMocks.consumeDueCommits.mockReset();
    moodTransportMocks.consumeDueCommits.mockReturnValue([]);
    moodRecordingMocks.recordMoodTake.mockReset();
    moodRecordingMocks.recordMoodTake.mockResolvedValue(true);
    moodRecordingMocks.backfillMoodOneClassification.mockReset();
    moodRecordingMocks.countInBeatSeconds.mockReturnValue(0.5);
    moodRecordingMocks.registerMoodRecordingInterrupt.mockReset();
    moodRecordingMocks.stopMoodTakeEarly.mockReset();
    moodRecordingMocks.stopMoodTakeEarly.mockImplementation(() => {
      useAppStore.getState().actions.setCaptureEndsAt(audioMocks.currentTime);
      return true;
    });
    moodRecordingMocks.unregisterMoodRecordingInterrupt.mockReset();
    moodRecordingMocks.registerMoodRecordingInterrupt.mockReturnValue(
      moodRecordingMocks.unregisterMoodRecordingInterrupt,
    );
    recordingInterruptMocks.interruptActiveRecording.mockReset();
    useAppStore.getState().actions.setIsExporting(false);
    useAppStore.getState().actions.reset();
    useAppStore.getState().actions.setMoodHydration("ready");
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    act(() => {
      useAppStore.getState().actions.setIsExporting(false);
    });
  });

  it("registers the Mood recording interrupt handler for the mounted lifetime", () => {
    const { unmount } = renderMoodMode();

    expect(moodRecordingMocks.registerMoodRecordingInterrupt).toHaveBeenCalledTimes(1);

    unmount();
    expect(moodRecordingMocks.unregisterMoodRecordingInterrupt).toHaveBeenCalledTimes(1);
  });

  it("gives an existing piece a flex-shrinking desktop stage column", () => {
    useAppStore.getState().actions.createMoodPiece("stack", "pocket");
    renderMoodMode();

    const stage = screen.getByLabelText("Stack stage");
    const pieceSection = stage.closest("section");
    expect(pieceSection).toHaveClass(
      "flex",
      "min-h-0",
      "flex-1",
      "w-full",
      "flex-col",
      "items-center",
      "gap-5",
    );
    expect(stage).toHaveClass(
      "min-h-0",
      "max-h-full",
      "self-center",
      "sm:h-full",
      "sm:w-auto",
    );
  });

  it("hydrates lazily on the first cold Mood entry", async () => {
    const load = deferred<moodRehydrate.MoodRehydrateResult>();
    const rehydrate = vi
      .spyOn(moodRehydrate, "rehydrateMoodFromStorage")
      .mockReturnValue(load.promise);
    const decode = vi.spyOn(moodRehydrate, "decodeMoodTakes").mockResolvedValue({
      ok: true,
      degraded: false,
      piece: null,
      warnings: [],
    });
    useAppStore.getState().actions.setMoodHydration("cold");

    renderMoodMode();

    expect(rehydrate).toHaveBeenCalledTimes(1);
    expect(useAppStore.getState().mood.hydration).toBe("hydrating");
    expect(screen.getByText("Loading mood...")).toBeInTheDocument();

    await act(async () => {
      load.resolve({
        status: "empty",
        ok: false,
        degraded: false,
        piece: null,
        warnings: [],
      });
      await load.promise;
    });

    await waitFor(() => expect(useAppStore.getState().mood.hydration).toBe("ready"));
    expect(decode).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /Corners/i })).toBeInTheDocument();
  });

  it("shows one line and pauses Mood saving when the saved mood cannot be opened", async () => {
    clearLogs();
    vi.spyOn(moodRehydrate, "rehydrateMoodFromStorage").mockRejectedValue(
      new Error("Connection to Indexed Database server lost"),
    );
    useAppStore.getState().actions.setMoodHydration("cold");

    render(<MoodMode />);

    expect(
      await screen.findByText("Couldn't open your saved mood — takes won't be saved."),
    ).toBeInTheDocument();
    expect(useAppStore.getState().mood.hydration).toBe("failed");
    expect(screen.getByRole("button", { name: "Reload" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Corners/i })).toBeInTheDocument();
    const failed = getLogs().find((entry) => entry.event === LOG_EVENTS.RECOVERY_LOAD_FAILED);
    expect(failed?.payload).toMatchObject({
      scope: "mood",
      message: "Connection to Indexed Database server lost",
    });
  });

  it("starts with the stage picker and no notice after a quarantined load", async () => {
    vi.spyOn(moodRehydrate, "rehydrateMoodFromStorage").mockResolvedValue({
      status: "quarantined",
      ok: false,
      degraded: true,
      piece: null,
      warnings: ["ha:mood-meta was not valid schema-1 metadata and was moved to ha:mood-meta-quarantine"],
    });
    useAppStore.getState().actions.setMoodHydration("cold");

    render(<MoodMode />);

    await waitFor(() => expect(useAppStore.getState().mood.hydration).toBe("ready"));
    expect(screen.getByRole("button", { name: /Corners/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reload" })).not.toBeInTheDocument();
  });

  it("returns abandoned hydration to cold so re-entry can restart it", async () => {
    const load = deferred<moodRehydrate.MoodRehydrateResult>();
    vi.spyOn(moodRehydrate, "rehydrateMoodFromStorage").mockReturnValue(load.promise);
    useAppStore.getState().actions.setMoodHydration("cold");

    const { unmount } = renderMoodMode();
    expect(useAppStore.getState().mood.hydration).toBe("hydrating");

    // Mode switch mid-hydrate: the continuation must not strand the store
    // at "hydrating" (re-entry only starts from "cold").
    unmount();
    await act(async () => {
      load.resolve({
        status: "empty",
        ok: false,
        degraded: false,
        piece: null,
        warnings: [],
      });
      await load.promise;
    });

    expect(useAppStore.getState().mood.hydration).toBe("cold");
  });

  it("revokes every decoded take URL when hydration resolves after unmount", async () => {
    const load = deferred<moodRehydrate.MoodRehydrateResult>();
    const decode = deferred<moodRehydrate.MoodHydrateResult>();
    vi.spyOn(moodRehydrate, "rehydrateMoodFromStorage").mockReturnValue(load.promise);
    vi.spyOn(moodRehydrate, "decodeMoodTakes").mockReturnValue(decode.promise);
    const piece = createEmptyMoodPiece("corners", "pocket");
    const decodedPiece = {
      ...piece,
      mics: piece.mics.map((mic, index) =>
        index < 2
          ? {
              ...mic,
              takes: [
                makeTake({
                  id: `decoded-${index}`,
                  url: `blob:test/decoded-${index}`,
                  posterUrl: `blob:test/decoded-${index}-poster`,
                }),
              ],
            }
          : mic,
      ),
    };
    const revokeUrl = vi.spyOn(URL, "revokeObjectURL");
    useAppStore.getState().actions.setMoodHydration("cold");

    const { unmount } = renderMoodMode();
    await act(async () => {
      load.resolve({
        status: "ok",
        ok: true,
        degraded: false,
        piece: decodedPiece,
        warnings: [],
      });
      await load.promise;
    });
    await waitFor(() => expect(moodRehydrate.decodeMoodTakes).toHaveBeenCalledTimes(1));

    unmount();
    await act(async () => {
      decode.resolve({
        ok: true,
        degraded: false,
        piece: decodedPiece,
        warnings: [],
      });
      await decode.promise;
    });

    expect(revokeUrl.mock.calls.map(([url]) => url)).toEqual([
      "blob:test/decoded-0",
      "blob:test/decoded-0-poster",
      "blob:test/decoded-1",
      "blob:test/decoded-1-poster",
    ]);
    expect(useAppStore.getState().mood.piece).toBeNull();
    expect(useAppStore.getState().mood.hydration).toBe("cold");
  });

  it("leaves decoded take URLs owned by the store after normal hydration", async () => {
    const load = deferred<moodRehydrate.MoodRehydrateResult>();
    const decode = deferred<moodRehydrate.MoodHydrateResult>();
    vi.spyOn(moodRehydrate, "rehydrateMoodFromStorage").mockReturnValue(load.promise);
    vi.spyOn(moodRehydrate, "decodeMoodTakes").mockReturnValue(decode.promise);
    const piece = createEmptyMoodPiece("corners", "pocket");
    const decodedPiece = {
      ...piece,
      mics: piece.mics.map((mic, index) =>
        index === 0
          ? {
              ...mic,
              takes: [
                makeTake({
                  id: "decoded-normal",
                  url: "blob:test/decoded-normal",
                  posterUrl: "blob:test/decoded-normal-poster",
                }),
              ],
            }
          : mic,
      ),
    };
    const revokeUrl = vi.spyOn(URL, "revokeObjectURL");
    useAppStore.getState().actions.setMoodHydration("cold");

    renderMoodMode();
    await act(async () => {
      load.resolve({
        status: "ok",
        ok: true,
        degraded: false,
        piece: decodedPiece,
        warnings: [],
      });
      await load.promise;
    });
    await waitFor(() => expect(moodRehydrate.decodeMoodTakes).toHaveBeenCalledTimes(1));
    await act(async () => {
      decode.resolve({
        ok: true,
        degraded: false,
        piece: decodedPiece,
        warnings: [],
      });
      await decode.promise;
    });
    await waitFor(() => expect(useAppStore.getState().mood.hydration).toBe("ready"));

    expect(useAppStore.getState().mood.piece).toBe(decodedPiece);
    expect(revokeUrl).not.toHaveBeenCalled();
  });

  it("revokes regenerated poster URLs that fail to attach", async () => {
    const posterBlob = new Blob([new Uint8Array([7])], { type: "image/jpeg" });
    const poster = deferred<Blob | null>();
    const load = deferred<moodRehydrate.MoodRehydrateResult>();
    vi.spyOn(moodRehydrate, "rehydrateMoodFromStorage").mockReturnValue(load.promise);
    const piece = createEmptyMoodPiece("corners", "pocket");
    const decodedPiece = {
      ...piece,
      mics: piece.mics.map((mic, index) =>
        index === 0 ? { ...mic, takes: [makeTake({ id: "regen-take" })] } : mic,
      ),
    };
    vi.spyOn(moodRehydrate, "decodeMoodTakes").mockResolvedValue({
      ok: true,
      degraded: false,
      piece: decodedPiece,
      warnings: [],
      posterJobs: [
        { micId: "mic-0", takeId: "regen-take", posterPromise: poster.promise },
      ],
    });
    const createUrl = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:test/regen");
    const revokeUrl = vi.spyOn(URL, "revokeObjectURL");
    useAppStore.getState().actions.setMoodHydration("cold");

    renderMoodMode();
    await act(async () => {
      load.resolve({
        status: "ok",
        ok: true,
        degraded: false,
        piece: decodedPiece,
        warnings: [],
      });
      await load.promise;
    });
    await waitFor(() => expect(useAppStore.getState().mood.hydration).toBe("ready"));

    // The piece is scratched before the poster regenerates: the attach
    // no-ops, so the freshly minted URL must be revoked, not leaked.
    act(() => {
      useAppStore.getState().actions.scratchMoodPiece();
    });
    await act(async () => {
      poster.resolve(posterBlob);
      await poster.promise;
    });

    expect(createUrl).toHaveBeenCalledWith(posterBlob);
    expect(revokeUrl).toHaveBeenCalledWith("blob:test/regen");
  });

  it("restores a saved Mood piece from storage on first entry", async () => {
    const piece = createEmptyMoodPiece("row", "click", { bpm: 120, cycleBars: 2 });
    const take = makeTake({ id: "saved-take" });
    await saveMoodPiece({
      ...piece,
      cycleSeconds: 4,
      oneMicId: "mic-0",
      oneTakeId: "saved-take",
      mics: piece.mics.map((mic, index) =>
        index === 0 ? { ...mic, takes: [take] } : mic,
      ),
      updatedAt: 5000,
    });
    useAppStore.getState().actions.setMoodHydration("cold");

    renderMoodMode();

    expect(screen.getByText("Loading mood...")).toBeInTheDocument();
    expect(await screen.findByText("Row stage")).toBeInTheDocument();
    expect(useAppStore.getState().mood.piece).toMatchObject({
      stage: "row",
      timeFeel: "click",
      oneTakeId: "saved-take",
    });
    expect(useAppStore.getState().mood.piece?.mics[0].takes[0]).toMatchObject({
      id: "saved-take",
      audioStatus: "ok",
    });
    expect(
      screen.getByRole("button", { name: /mic 1 — live: take 1/ }),
    ).toBeInTheDocument();
    expect(moodRecordingMocks.backfillMoodOneClassification).toHaveBeenCalledTimes(1);
  });

  it("requests One enrichment once on every entry with a hydrated piece", () => {
    useAppStore.getState().actions.createMoodPiece("corners", "pocket");
    useAppStore.getState().actions.setMoodTake("mic-0", makeTake({ id: "saved-one" }));

    const firstEntry = renderMoodMode();
    expect(moodRecordingMocks.backfillMoodOneClassification).toHaveBeenCalledTimes(1);
    firstEntry.unmount();

    renderMoodMode();
    expect(moodRecordingMocks.backfillMoodOneClassification).toHaveBeenCalledTimes(2);
  });

  it("skips the entry backfill while exporting", () => {
    useAppStore.getState().actions.createMoodPiece("corners", "pocket");
    useAppStore.getState().actions.setMoodTake("mic-0", makeTake({ id: "saved-one" }));
    useAppStore.getState().actions.setIsExporting(true);

    renderMoodMode();

    expect(moodRecordingMocks.backfillMoodOneClassification).not.toHaveBeenCalled();
  });

  it("shows the stage and feel options while no mood exists", () => {
    renderMoodMode();

    expect(screen.getByText("pick your stage")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Corners 2×2 · square video" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Row side by side · widescreen video" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Stack stacked · vertical video" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Pocket/i })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByText("your first loop sets the length")).toBeInTheDocument();
    expect(screen.getByText("steady tempo you set")).toBeInTheDocument();
    expect(screen.queryByRole("slider", { name: "Tempo" })).not.toBeInTheDocument();
  });

  it("keeps mood controls enabled while idle", () => {
    renderMoodMode();

    expect(screen.getByRole("button", { name: /Corners/i })).not.toBeDisabled();
    expect(screen.getByRole("button", { name: /Row/i })).not.toBeDisabled();
    expect(screen.getByRole("button", { name: /Stack/i })).not.toBeDisabled();
    expect(screen.getByRole("button", { name: /Pocket/i })).not.toBeDisabled();
    expect(screen.getByRole("button", { name: /Click/i })).not.toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: /Click/i }));

    expect(screen.getByRole("slider", { name: "Tempo" })).not.toBeDisabled();
    expect(screen.getByRole("button", { name: "1 bar" })).not.toBeDisabled();
    expect(screen.getByRole("button", { name: "2 bars" })).not.toBeDisabled();
    expect(screen.getByRole("button", { name: "4 bars" })).not.toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: /Corners/i }));

    expect(screen.getByRole("group", { name: "Mood mics" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /mic 1 — off/i })).not.toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Mood options" }));
    expect(screen.getByRole("button", { name: "Scratch this mood" })).not.toBeDisabled();
  });

  it("disables stage picker controls while exporting", () => {
    const createMoodPiece = vi.spyOn(useAppStore.getState().actions, "createMoodPiece");
    renderMoodMode();
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: /Click/i }));
    });
    createMoodPiece.mockClear();

    act(() => {
      useAppStore.getState().actions.setIsExporting(true);
    });

    expect(screen.getByRole("button", { name: /Corners/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Row/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Stack/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Pocket/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Click/i })).toBeDisabled();
    expect(screen.getByRole("slider", { name: "Tempo" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "1 bar" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "2 bars" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "4 bars" })).toBeDisabled();
    for (const control of screen.getAllByRole("button")) {
      expect(control).toHaveAttribute("title", "frozen during export");
    }

    fireEvent.click(screen.getByRole("button", { name: /Corners/i }));

    expect(createMoodPiece).not.toHaveBeenCalled();
    createMoodPiece.mockRestore();
  });

  it("reveals local Click controls only after Click is selected", () => {
    renderMoodMode();

    expect(screen.queryByRole("slider", { name: "Tempo" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Click/i }));

    expect(screen.getByRole("button", { name: /Click/i })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("slider", { name: "Tempo" })).toHaveAttribute("aria-valuetext", "90 BPM");
    expect(screen.getByRole("button", { name: "1 bar" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "2 bars" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "4 bars" })).toBeInTheDocument();
  });

  it("portals the pre-One Mood transport cluster into the header slot", () => {
    const { container } = renderMoodMode();

    fireEvent.click(screen.getByRole("button", { name: /Row/i }));

    const piece = useAppStore.getState().mood.piece;
    expect(piece?.stage).toBe("row");
    expect(piece?.timeFeel).toBe("pocket");
    expect(piece?.bpm).toBeNull();
    expect(piece?.cycleBars).toBeNull();
    expect(piece?.cycleSeconds).toBeNull();
    expect(screen.getByText("Row stage")).toBeInTheDocument();
    expect(screen.getByText("2 mics")).toBeInTheDocument();
    const slot = moodHeaderSlot(container);
    const playButton = within(slot).getByRole("button", {
      name: /^(Start|Stop) mood performance$/,
    });
    expect(playButton).toBeDisabled();
    expect(playButton).toHaveAttribute("title", "record the One first");
    expect(within(slot).getByText("space")).toHaveClass("text-[10px]", "text-zinc-500");
    expect(within(slot).getByLabelText("Time feel")).toHaveTextContent(
      "Pocket · first loop sets the length",
    );
    expect(within(slot).getByRole("group", { name: "Time feel" })).toBeInTheDocument();
    expect(within(slot).queryByLabelText("Mood cycle count")).not.toBeInTheDocument();
    const optionsButton = within(slot).getByRole("button", { name: "Mood options" });
    expect(optionsButton).toHaveClass(
      "pointer-coarse:min-h-11",
      "pointer-coarse:min-w-11",
    );
    expect(slot.lastElementChild).toContainElement(optionsButton);

    const piecePanel = screen.getByRole("group", { name: "Mood mics" }).parentElement;
    expect(piecePanel).not.toBeNull();
    expect(within(piecePanel as HTMLElement).queryByLabelText("Time feel")).not.toBeInTheDocument();
    expect(
      within(piecePanel as HTMLElement).queryByLabelText("Mood cycle count"),
    ).not.toBeInTheDocument();
    expect(
      within(piecePanel as HTMLElement).queryByRole("button", {
        name: /^(Start|Stop) mood performance$/,
      }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Pocket/i })).not.toBeInTheDocument();
  });

  it("renders a single takeless invitation on the stage that records the One on mic 0", () => {
    renderMoodMode();

    fireEvent.click(screen.getByRole("button", { name: /Corners/i }));

    expect(screen.getByLabelText("Corners stage")).toBeInTheDocument();
    expect(screen.getByText("record the One")).toBeInTheDocument();
    expect(screen.getByText("your first loop sets the length")).toBeInTheDocument();
    const stage = screen.getByLabelText("Corners stage");
    expect(within(stage).getByLabelText("I've got headphones on")).not.toBeChecked();
    expect(screen.getAllByLabelText("I've got headphones on")).toHaveLength(1);
    const panel = screen.getByRole("group", { name: "Mood mics" }).parentElement;
    expect(within(panel as HTMLElement).queryByLabelText("I've got headphones on")).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "record the One" }));

    expect(moodRecordingMocks.recordMoodTake).toHaveBeenCalledWith("mic-0", {
      onError: expect.any(Function),
    });
    act(() => {
      const options = moodRecordingMocks.recordMoodTake.mock.calls[0]?.[1];
      options?.onError("camera permission denied");
    });
    expect(screen.getByRole("alert")).toHaveTextContent("camera permission denied");
  });

  it("removes the One invitation once any take exists", () => {
    useAppStore.getState().actions.createMoodPiece("corners", "pocket");
    useAppStore.getState().actions.setMoodTake("mic-0", makeTake({ id: "the-one" }));

    renderMoodMode();

    expect(screen.queryByRole("button", { name: "record the One" })).not.toBeInTheDocument();
    expect(screen.queryByText("your first loop sets the length")).not.toBeInTheDocument();
  });

  it("surfaces mood recording errors with the shared recording alert pattern", () => {
    useAppStore.getState().actions.createMoodPiece("corners", "pocket");
    useAppStore.getState().actions.setRecordingError("camera failed");

    renderMoodMode();

    expect(screen.getByRole("alert")).toHaveTextContent("camera failed");
  });

  it("uses the shared Escape cancellation host while mood recording is active", () => {
    useAppStore.getState().actions.createMoodPiece("corners", "pocket");
    useAppStore.getState().actions.setRecordingState("countdown", null);

    renderMoodMode();

    fireEvent.keyDown(window, { key: "Escape" });

    expect(recordingInterruptMocks.interruptActiveRecording).toHaveBeenCalledWith("user");
  });

  it("disables Mood play until the One sets a cycle", () => {
    useAppStore.getState().actions.createMoodPiece("corners", "pocket");
    renderMoodMode();

    const playButton = screen.getByRole("button", { name: /^(Start|Stop) mood performance$/ });
    expect(playButton).toBeDisabled();
    expect(playButton).toHaveAttribute("title", "record the One first");
    expect(screen.queryByText("record the One first")).not.toBeInTheDocument();

    fireEvent.click(playButton);

    expect(moodTransportMocks.startMoodPerformance).not.toHaveBeenCalled();
  });

  it("explains why established-cycle Play and Stop controls are disabled during export", () => {
    act(() => {
      const actions = useAppStore.getState().actions;
      actions.createMoodPiece("corners", "pocket");
      actions.setMoodTake("mic-0", makeTake({ id: "the-one" }));
    });
    renderMoodMode();

    const playButton = screen.getByRole("button", { name: "Start mood performance" });
    act(() => {
      useAppStore.getState().actions.setIsExporting(true);
    });
    expect(playButton).toBeDisabled();
    expect(playButton).toHaveAttribute("title", "frozen during export");

    act(() => {
      const actions = useAppStore.getState().actions;
      actions.setIsExporting(false);
      actions.setMoodPerforming(true, 4);
      actions.setIsExporting(true);
    });
    const stopButton = screen.getByRole("button", { name: "Stop mood performance" });
    expect(stopButton).toBeDisabled();
    expect(stopButton).toHaveAttribute("title", "frozen during export");
  });

  it("keeps exactly one Mood cluster or recording bar in the header slot", () => {
    audioMocks.currentTime = 9;
    act(() => {
      const actions = useAppStore.getState().actions;
      actions.setAppMode("mood");
      actions.createMoodPiece("row", "pocket");
      actions.setMoodTake(
        "mic-0",
        makeTake({ id: "the-one", durationSeconds: 4, trimEndMs: 4000 }),
      );
    });
    const { container } = renderMoodMode();
    const slot = moodHeaderSlot(container);

    expect(
      within(slot).getByRole("button", { name: /^(Start|Stop) mood performance$/ }),
    ).toBeInTheDocument();
    expect(within(slot).getByRole("group", { name: "Time feel" })).toBeInTheDocument();
    expect(within(slot).getByRole("group", { name: "Mood cycle count" })).toBeInTheDocument();
    expect(within(slot).getByRole("button", { name: "Mood options" })).toBeInTheDocument();
    expect(within(slot).queryByRole("status")).not.toBeInTheDocument();

    act(() => {
      const actions = useAppStore.getState().actions;
      actions.setMoodHotMic("mic-1");
      actions.setCountdownEndsAt(10);
      actions.setCaptureEndsAt(14);
      actions.setRecordingState("countdown", null);
    });

    expect(within(slot).getByRole("status")).toHaveTextContent(
      "count-in",
    );
    expect(
      within(slot).queryByRole("button", { name: /^(Start|Stop) mood performance$/ }),
    ).not.toBeInTheDocument();
    expect(within(slot).queryByLabelText("Time feel")).not.toBeInTheDocument();
    expect(within(slot).queryByLabelText("Mood cycle count")).not.toBeInTheDocument();
    expect(within(slot).queryByRole("button", { name: "Mood options" })).not.toBeInTheDocument();

    fireEvent.click(within(slot).getByRole("button", { name: "Cancel take" }));
    expect(recordingInterruptMocks.interruptActiveRecording).toHaveBeenCalledWith("user");

    act(() => {
      useAppStore.getState().actions.setRecordingState("recording", null);
    });

    expect(within(slot).getByText("loops muted · no headphones")).toBeInTheDocument();
    fireEvent.click(within(slot).getByRole("button", { name: "Stop take now" }));

    expect(moodRecordingMocks.stopMoodTakeEarly).toHaveBeenCalledTimes(1);
    expect(within(slot).getByText("saving…")).toBeInTheDocument();
  });

  it("leaves the One guidance on its stage tile and derives finishing from the deadline", () => {
    vi.useFakeTimers();
    audioMocks.currentTime = 10;
    act(() => {
      const actions = useAppStore.getState().actions;
      actions.createMoodPiece("corners", "pocket");
      actions.setMoodHotMic("mic-0");
      actions.setCountdownEndsAt(10);
      actions.setCaptureEndsAt(18);
      actions.setRecordingState("recording", null);
    });
    const { container } = renderMoodMode();
    const slot = moodHeaderSlot(container);

    expect(within(slot).queryByText(/2–8s feels best/)).not.toBeInTheDocument();
    expect(screen.getAllByText(/2–8s feels best/)).toHaveLength(1);
    expect(screen.getByText("tap to stop · 2–8s feels best")).toBeInTheDocument();
    expect(within(slot).queryByText("loops muted · no headphones")).not.toBeInTheDocument();

    audioMocks.currentTime = 18;
    act(() => {
      vi.advanceTimersByTime(100);
    });

    expect(within(slot).getByText("saving…")).toBeInTheDocument();
  });

  it("keeps receipts beside transport, auto-clears kept notes, and persists too-short notes", () => {
    vi.useFakeTimers();
    act(() => {
      const actions = useAppStore.getState().actions;
      actions.createMoodPiece("corners", "pocket");
      actions.setMoodHotMic("mic-0");
      actions.setRecordingState("preparing", null);
    });
    const { container } = renderMoodMode();
    const slot = moodHeaderSlot(container);

    act(() => {
      const actions = useAppStore.getState().actions;
      actions.setLastTakeReceipt({ kind: "kept", seconds: 2.4, multiple: 2 });
      actions.setRecordingState("idle", null);
      actions.setMoodHotMic(null);
    });

    expect(within(slot).getByText("kept 2.4s · ×2")).toHaveClass("text-orange-500");
    expect(
      within(slot).getByRole("button", { name: /^(Start|Stop) mood performance$/ }),
    ).toBeInTheDocument();
    expect(within(slot).getByLabelText("Time feel")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(1_499);
    });
    expect(useAppStore.getState().recording.lastTakeReceipt).not.toBeNull();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(useAppStore.getState().recording.lastTakeReceipt).toBeNull();
    expect(
      within(slot).getByRole("button", { name: /^(Start|Stop) mood performance$/ }),
    ).toBeInTheDocument();

    act(() => {
      useAppStore.getState().actions.setLastTakeReceipt({ kind: "too-short" });
      vi.advanceTimersByTime(5_000);
    });
    expect(within(slot).getByText("too short — try again")).toHaveClass("text-red-300");
    expect(
      within(slot).getByRole("button", { name: /^(Start|Stop) mood performance$/ }),
    ).toBeInTheDocument();

    const dismiss = within(slot).getByRole("button", { name: "dismiss take note" });
    expect(dismiss).toHaveTextContent("×");
    expect(dismiss).toHaveClass("pointer-coarse:min-h-11", "pointer-coarse:min-w-11");
    fireEvent.click(dismiss);

    expect(useAppStore.getState().recording.lastTakeReceipt).toBeNull();
  });

  it("clears a too-short receipt when Play is the next action", () => {
    act(() => {
      const actions = useAppStore.getState().actions;
      actions.createMoodPiece("corners", "pocket");
      actions.setMoodTake("mic-0", makeTake({ id: "the-one" }));
      actions.setLastTakeReceipt({ kind: "too-short" });
    });
    const { container } = renderMoodMode();
    const slot = moodHeaderSlot(container);

    expect(within(slot).getByText("too short — try again")).toBeInTheDocument();
    fireEvent.click(
      within(slot).getByRole("button", { name: /^(Start|Stop) mood performance$/ }),
    );

    expect(useAppStore.getState().recording.lastTakeReceipt).toBeNull();
    expect(moodTransportMocks.startMoodPerformance).toHaveBeenCalledTimes(1);
  });

  it("clears a lingering receipt when the piece is scratched", () => {
    act(() => {
      const actions = useAppStore.getState().actions;
      actions.createMoodPiece("corners", "pocket");
      actions.setLastTakeReceipt({ kind: "too-short" });
    });
    renderMoodMode();

    act(() => {
      useAppStore.getState().actions.scratchMoodPiece();
    });

    expect(useAppStore.getState().recording.lastTakeReceipt).toBeNull();
  });

  it("clears a kept receipt on unmount so it cannot ghost after a mode switch", () => {
    act(() => {
      const actions = useAppStore.getState().actions;
      actions.createMoodPiece("corners", "pocket");
      actions.setLastTakeReceipt({ kind: "kept", seconds: 2.4, multiple: 2 });
    });
    const { unmount } = renderMoodMode();

    unmount();

    expect(useAppStore.getState().recording.lastTakeReceipt).toBeNull();
  });

  it("shows the Mood performance controls with a ticking cycle count", () => {
    act(() => {
      useAppStore.getState().actions.setAppMode("mood");
      useAppStore.getState().actions.createMoodPiece("row", "pocket");
      useAppStore.getState().actions.setMoodTake(
        "mic-0",
        makeTake({ id: "the-one", durationSeconds: 4, trimEndMs: 4000 }),
      );
    });
    const { container } = renderMoodMode();

    const slot = moodHeaderSlot(container);
    expect(within(slot).getByLabelText("Time feel")).toHaveTextContent(
      "Pocket · 4.0s loop",
    );
    expect(within(slot).getByLabelText("Mood cycle count")).toHaveTextContent("loop 0");
    fireEvent.click(screen.getByRole("button", { name: /^(Start|Stop) mood performance$/ }));

    expect(moodTransportMocks.startMoodPerformance).toHaveBeenCalledTimes(1);

    act(() => {
      useAppStore.getState().actions.setMoodPerforming(true, 12);
      useAppStore.getState().actions.setMoodCycleCount(3);
    });

    expect(within(slot).getByLabelText("Mood cycle count")).toHaveTextContent("loop 3");
    fireEvent.click(screen.getByRole("button", { name: /^(Start|Stop) mood performance$/ }));

    expect(moodTransportMocks.stopMoodPerformance).toHaveBeenCalledTimes(1);
  });

  it("shows the Drop gesture hint once per session and never during capture", () => {
    vi.useFakeTimers();
    act(() => {
      const actions = useAppStore.getState().actions;
      actions.createMoodPiece("row", "pocket");
      actions.setMoodTake("mic-0", makeTake({ id: "the-one" }));
      actions.setMoodVibe("blocks");
    });
    renderMoodMode();

    act(() => {
      const actions = useAppStore.getState().actions;
      actions.setRecordingState("countdown", null);
      actions.setMoodPerforming(true, 1);
    });
    expect(screen.queryByText("punch the vibe — tap DROP or press D")).not.toBeInTheDocument();

    act(() => {
      const actions = useAppStore.getState().actions;
      actions.setMoodPerforming(false, 0);
      actions.setRecordingState("idle", null);
    });
    act(() => {
      useAppStore.getState().actions.setMoodPerforming(true, 2);
    });

    expect(screen.getByRole("status")).toHaveTextContent(
      "punch the vibe — tap DROP or press D",
    );

    act(() => {
      vi.advanceTimersByTime(4_000);
    });
    expect(screen.queryByText("punch the vibe — tap DROP or press D")).not.toBeInTheDocument();

    act(() => {
      const actions = useAppStore.getState().actions;
      actions.setMoodPerforming(false, 0);
      actions.setMoodPerforming(true, 3);
    });
    expect(screen.queryByText("punch the vibe — tap DROP or press D")).not.toBeInTheDocument();
  });

  it("shows the Harmonize hint once when its pad first becomes enabled while performing", () => {
    vi.useFakeTimers();
    act(() => {
      const actions = useAppStore.getState().actions;
      actions.createMoodPiece("row", "pocket");
      actions.setMoodTake("mic-0", makeTake({ id: "the-one" }));
    });
    renderMoodMode();

    act(() => {
      useAppStore.getState().actions.setMoodPerforming(true, 1);
    });
    expect(
      screen.queryByText(
        "Harmonize ready: hold H to layer AI-picked harmony from your own loop",
      ),
    ).not.toBeInTheDocument();

    act(() => {
      useAppStore.getState().actions.applyMoodKeyEstimateIfCurrent(
        "the-one",
        { key: "A", mode: "minor", confidence: 0.9 },
        useAppStore.getState().session.moodSessionId,
      );
    });

    expect(screen.getByRole("status")).toHaveTextContent(
      "Harmonize ready: hold H to layer AI-picked harmony from your own loop",
    );

    act(() => {
      vi.advanceTimersByTime(4_000);
    });
    expect(
      screen.queryByText(
        "Harmonize ready: hold H to layer AI-picked harmony from your own loop",
      ),
    ).not.toBeInTheDocument();

    act(() => {
      const actions = useAppStore.getState().actions;
      actions.setMoodPerforming(false, 0);
      actions.setMoodPerforming(true, 2);
    });
    expect(
      screen.queryByText(
        "Harmonize ready: hold H to layer AI-picked harmony from your own loop",
      ),
    ).not.toBeInTheDocument();
  });

  it("renders three explained lens chips and round-trips Solo while stopped", () => {
    act(() => {
      useAppStore.getState().actions.setAppMode("mood");
      useAppStore.getState().actions.createMoodPiece("corners", "pocket");
      useAppStore.getState().actions.setMoodTake("mic-0", makeTake({ id: "the-one" }));
    });
    renderMoodMode();

    const lensGroup = screen.getByRole("group", { name: "Lens" });
    expect(
      within(lensGroup)
        .getAllByRole("button")
        .map((button) => button.getAttribute("aria-label")),
    ).toEqual(["Wall lens", "Splits lens", "Solo lens"]);
    expect(screen.getByRole("button", { name: "Wall lens" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByText("everyone")).toBeInTheDocument();
    expect(screen.getByText("anchor + wings")).toBeInTheDocument();
    expect(screen.getByText("one mic per cycle")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Solo lens" }));

    expect(useAppStore.getState().mood.piece?.lens).toBe("solo");
    expect(screen.getByRole("button", { name: "Solo lens" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    fireEvent.click(screen.getByRole("button", { name: "Wall lens" }));
    expect(useAppStore.getState().mood.piece?.lens).toBe("wall");
    expect(screen.getByRole("button", { name: "Wall lens" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("sizes Lens and Vibe segmented controls to 44px on coarse pointers", () => {
    act(() => {
      useAppStore.getState().actions.setAppMode("mood");
      useAppStore.getState().actions.createMoodPiece("corners", "pocket");
      useAppStore.getState().actions.setMoodTake("mic-0", makeTake({ id: "the-one" }));
    });
    renderMoodMode();

    expect(screen.getByRole("group", { name: "Lens" })).toBeInTheDocument();
    for (const lens of ["Wall lens", "Splits lens", "Solo lens"]) {
      expect(screen.getByRole("button", { name: lens })).toHaveClass(
        "pointer-coarse:min-h-11",
      );
    }

    expect(screen.getByRole("group", { name: "Vibe" })).toBeInTheDocument();
    for (const vibe of [
      "Clean vibe",
      "Blocks vibe",
      "Mixtape vibe",
      "Camcorder vibe",
      "Print vibe",
      "Kaleido vibe",
      "Weave vibe",
      "Crossroll vibe",
      "Ghost vibe",
      "Solar vibe",
    ]) {
      expect(screen.getByRole("button", { name: vibe })).toHaveClass(
        "pointer-coarse:min-h-11",
      );
    }
  });

  it("orders the panel by use time and moves headphones plus Scratch into options", () => {
    act(() => {
      useAppStore.getState().actions.setAppMode("mood");
      useAppStore.getState().actions.createMoodPiece("corners", "pocket");
      useAppStore.getState().actions.setMoodTake("mic-0", makeTake({ id: "the-one" }));
    });
    renderMoodMode();

    const micStrip = screen.getByRole("group", { name: "Mood mics" });
    const panel = micStrip.parentElement as HTMLElement;
    const lensGroup = within(panel).getByRole("group", { name: "Lens" });
    const dropPad = within(panel).getByRole("button", { name: "Drop Clean" });
    const liveFxGroup = within(panel).getByRole("group", { name: "Live effects" });
    const vibeGroup = within(panel).getByRole("group", { name: "Vibe" });
    const lensLabel = within(panel).getByText("LENS");
    const dropLabel = within(panel).getByTestId("drop-group-label");
    const vibeLabel = within(panel).getByText("VIBE");

    expect(lensLabel).toHaveClass(
      "text-[10px]",
      "uppercase",
      "tracking-widest",
      "text-zinc-600",
    );
    expect(vibeLabel).toHaveClass(
      "text-[10px]",
      "uppercase",
      "tracking-widest",
      "text-zinc-600",
    );
    expect(dropLabel).toHaveClass(
      "text-[10px]",
      "uppercase",
      "tracking-widest",
      "text-zinc-600",
    );
    expect(within(panel).queryByText("MICS")).not.toBeInTheDocument();
    expect(lensGroup).toHaveClass("h-11");
    expect(vibeGroup).toHaveClass("h-11");
    expect(lensGroup.compareDocumentPosition(dropPad) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(liveFxGroup).getByRole("button", { name: "Gate the loop (hold)" })).toBeInTheDocument();
    expect(within(liveFxGroup).getByRole("button", { name: "Echo throw" })).toBeInTheDocument();
    expect(within(liveFxGroup).getByRole("button", { name: "Brake the loop (hold)" })).toBeInTheDocument();
    expect(liveFxGroup.compareDocumentPosition(vibeGroup) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    expect(within(panel).queryByLabelText("I've got headphones on")).not.toBeInTheDocument();
    expect(
      within(panel).queryByRole("button", { name: "Scratch this mood" }),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Mood options" }));
    const dialog = screen.getByRole("dialog", { name: "Mood options" });
    const headphones = within(dialog).getByLabelText("I've got headphones on");
    const headphonesCluster = headphones.closest("label") as HTMLElement;
    const creditsHeading = within(dialog).getByText("Credits");
    const scratch = within(dialog).getByRole("button", { name: "Scratch this mood" });
    expect(headphones).not.toBeChecked();
    expect(headphonesCluster).toHaveClass("min-h-11");
    expect(within(dialog).getByText("headphones")).toBeInTheDocument();
    expect(
      within(dialog).getByText("no headphones: loops mute while recording"),
    ).toHaveClass("text-[10px]", "text-zinc-500");
    expect(
      headphonesCluster.compareDocumentPosition(creditsHeading) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      creditsHeading.compareDocumentPosition(scratch) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    fireEvent.click(headphones);
    expect(useAppStore.getState().mood.monitorWithHeadphones).toBe(true);

    const controlsRow = lensGroup.parentElement?.parentElement;
    expect(controlsRow?.parentElement).toBe(panel);
  });

  it("enables Credits, persists mic names, and cycles the style in the options menu", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    act(() => {
      useAppStore.getState().actions.setAppMode("mood");
      useAppStore.getState().actions.createMoodPiece("corners", "pocket");
      useAppStore.getState().actions.setMoodTake("mic-0", makeTake({ id: "the-one" }));
    });
    renderMoodMode();

    fireEvent.click(screen.getByRole("button", { name: "Mood options" }));
    const dialog = screen.getByRole("dialog", { name: "Mood options" });
    expect(within(dialog).getByText("LAB")).toHaveClass("uppercase");
    const enabled = within(dialog).getByLabelText("Credits (lab)");
    expect(enabled).not.toBeChecked();

    fireEvent.click(enabled);

    const firstName = within(dialog).getByLabelText("credit name for mic 1");
    expect(firstName).toHaveAttribute("placeholder", "name mic 1");
    expect(firstName).toHaveAttribute("maxlength", "24");
    expect(within(dialog).getAllByPlaceholderText(/name mic \d/)).toHaveLength(4);

    fireEvent.change(firstName, { target: { value: "Bass" } });
    expect(useAppStore.getState().mood.piece?.credits?.names).toEqual({
      "mic-0": "Bass",
    });

    expect(CREDIT_STYLES).toHaveLength(5);
    expect(within(dialog).getByText("Cutout")).toHaveClass("font-mono");
    const styleButton = within(dialog).getByRole("button", { name: "cycle credit style" });
    for (let index = 1; index <= CREDIT_STYLES.length; index += 1) {
      fireEvent.click(styleButton);
      const expectedIndex = index % CREDIT_STYLES.length;
      expect(useAppStore.getState().mood.piece?.credits?.styleIndex).toBe(expectedIndex);
      expect(within(dialog).getByText(CREDIT_STYLES[expectedIndex].name)).toBeInTheDocument();
    }

    const paletteButton = within(dialog).getByRole("button", { name: "cycle credit palette" });
    expect(within(dialog).getByText("signal")).toHaveClass("font-mono");
    fireEvent.click(paletteButton);
    expect(useAppStore.getState().mood.piece?.artDirection).toEqual({
      fxPreset: "neutral",
      creditPalette: "print",
      source: "user",
    });
    expect(within(dialog).getByText("print")).toHaveClass("font-mono");

    const modeButton = within(dialog).getByRole("button", { name: "cycle credit mode" });
    expect(within(dialog).getByText("sequence")).toHaveClass("font-mono");
    fireEvent.click(modeButton);
    expect(useAppStore.getState().mood.piece?.credits?.mode).toBe("together");
    expect(within(dialog).getByText("together")).toHaveClass("font-mono");
  });

  it("explains disabled options during export and before the One", () => {
    act(() => {
      const actions = useAppStore.getState().actions;
      actions.createMoodPiece("corners", "pocket");
      actions.setMoodCredits({ enabled: true });
    });
    renderMoodMode();
    fireEvent.click(screen.getByRole("button", { name: "Mood options" }));

    expect(screen.getByRole("button", { name: "cycle credit palette" })).toHaveAttribute(
      "title",
      "record the One first",
    );

    act(() => {
      const actions = useAppStore.getState().actions;
      actions.setMoodTake("mic-0", makeTake({ id: "the-one" }));
      actions.setIsExporting(true);
    });

    const dialog = screen.getByRole("dialog", { name: "Mood options" });
    expect(within(dialog).getByLabelText("I've got headphones on")).toHaveAttribute(
      "title",
      "frozen during export",
    );
    expect(within(dialog).getByLabelText("Credits (lab)")).toHaveAttribute(
      "title",
      "frozen during export",
    );
    expect(within(dialog).getByLabelText("credit name for mic 1")).toHaveAttribute(
      "title",
      "frozen during export",
    );
    expect(within(dialog).getByRole("button", { name: "cycle credit style" })).toHaveAttribute(
      "title",
      "frozen during export",
    );
    expect(within(dialog).getByRole("button", { name: "cycle credit palette" })).toHaveAttribute(
      "title",
      "frozen during export",
    );
    expect(within(dialog).getByRole("button", { name: "cycle credit mode" })).toHaveAttribute(
      "title",
      "frozen during export",
    );
    expect(within(dialog).getByRole("button", { name: "Scratch this mood" })).toHaveAttribute(
      "title",
      "frozen during export",
    );
  });

  it("keeps Row-stage piece controls reachable in a 320px render", () => {
    act(() => {
      useAppStore.getState().actions.setAppMode("mood");
      useAppStore.getState().actions.createMoodPiece("row", "pocket");
      useAppStore.getState().actions.setMoodTake(
        "mic-0",
        makeTake({ id: "the-one", durationSeconds: 4, trimEndMs: 4000 }),
      );
    });
    const { container } = render(
      <>
        <div data-mood-header-slot />
        <div style={{ width: "320px" }}>
          <MoodMode />
        </div>
      </>,
    );

    const rowStage = screen.getByLabelText("Row stage");
    expect(rowStage).toHaveStyle({ maxWidth: "min(100%, 46rem)" });
    const lensGroup = screen.getByRole("group", { name: "Lens" });
    const lensColumn = lensGroup.parentElement;
    const controlsRow = lensColumn?.parentElement;
    expect(controlsRow).toHaveClass(
      "flex-wrap",
      "justify-center",
      "wide:flex-nowrap",
      "wide:justify-start",
    );
    expect(screen.getByRole("group", { name: "Live effects" })).toHaveClass(
      "max-w-[calc(100vw-1.5rem)]",
      "overflow-x-auto",
    );
    expect(screen.getByRole("button", { name: "Harmonize the loop (hold)" }))
      .toBeInTheDocument();
    expect(container).toHaveTextContent("loop 0");
  });

  it("arms Solo for the next cycle and lets Wall replace that intent", () => {
    act(() => {
      useAppStore.getState().actions.setAppMode("mood");
      useAppStore.getState().actions.createMoodPiece("corners", "pocket");
      useAppStore.getState().actions.setMoodTake("mic-0", makeTake({ id: "the-one" }));
      useAppStore.getState().actions.setMoodPerforming(true, 8);
    });
    renderMoodMode();

    fireEvent.click(screen.getByRole("button", { name: "Solo lens" }));

    expect(useAppStore.getState().mood.piece?.lens).toBe("wall");
    expect(useAppStore.getState().mood.performance.armedLens).toBe("solo");
    expect(moodTransportMocks.armMoodLensCommit).toHaveBeenCalledWith(
      "solo",
      expect.any(Number),
      expect.any(Number),
    );
    expect(screen.getByRole("button", { name: "Wall lens" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    const solo = screen.getByRole("button", { name: "Solo lens" });
    expect(solo).toHaveAttribute("aria-pressed", "false");
    expect(solo).toHaveAttribute("data-armed", "true");
    expect(solo).toHaveClass("animate-pulse");
    expect(solo).toHaveClass("ring-2");

    fireEvent.click(screen.getByRole("button", { name: "Wall lens" }));

    expect(useAppStore.getState().mood.performance.armedLens).toBeNull();
    expect(moodTransportMocks.armMoodLensCommit).toHaveBeenLastCalledWith(
      "wall",
      expect.any(Number),
      expect.any(Number),
    );
    expect(solo).not.toHaveAttribute("data-armed");
  });

  it("disables the Mood lens toggle while exporting", () => {
    act(() => {
      useAppStore.getState().actions.setAppMode("mood");
      useAppStore.getState().actions.createMoodPiece("corners", "pocket");
      useAppStore.getState().actions.setMoodTake("mic-0", makeTake({ id: "the-one" }));
    });
    renderMoodMode();

    act(() => {
      useAppStore.getState().actions.setIsExporting(true);
    });

    const wall = screen.getByRole("button", { name: "Wall lens" });
    const splits = screen.getByRole("button", { name: "Splits lens" });
    const solo = screen.getByRole("button", { name: "Solo lens" });
    expect(wall).toBeDisabled();
    expect(splits).toBeDisabled();
    expect(solo).toBeDisabled();

    fireEvent.click(splits);

    expect(useAppStore.getState().mood.piece?.lens).toBe("wall");
  });

  it("writes the wardrobe vibe while stopped", () => {
    act(() => {
      useAppStore.getState().actions.setAppMode("mood");
      useAppStore.getState().actions.createMoodPiece("corners", "pocket");
      useAppStore.getState().actions.setMoodTake("mic-0", makeTake({ id: "the-one" }));
    });
    renderMoodMode();

    const blocks = screen.getByRole("button", { name: "Blocks vibe" });
    expect(screen.getByRole("group", { name: "Vibe" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Clean vibe" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    fireEvent.click(blocks);

    expect(useAppStore.getState().mood.piece?.vibe).toBe("blocks");
    expect(blocks).toHaveAttribute("aria-pressed", "true");
  });

  it("keeps ten vibe chips within the panel budget by labeling only the selection", () => {
    act(() => {
      useAppStore.getState().actions.setAppMode("mood");
      useAppStore.getState().actions.createMoodPiece("corners", "pocket");
      useAppStore.getState().actions.setMoodTake("mic-0", makeTake({ id: "the-one" }));
    });
    renderMoodMode();

    const vibeGroup = screen.getByRole("group", { name: "Vibe" });
    const buttons = within(vibeGroup).getAllByRole("button");
    expect(buttons).toHaveLength(10);
    expect(within(vibeGroup).getByText("Clean")).toBeInTheDocument();
    for (const label of [
      "Print",
      "Mixtape",
      "Blocks",
      "Camcorder",
      "Kaleido",
      "Weave",
      "Crossroll",
      "Ghost",
      "Solar",
    ]) {
      expect(within(vibeGroup).queryByText(label)).not.toBeInTheDocument();
    }

    const swatches = [
      ["Clean vibe", "bg-zinc-500", "Clean vibe"],
      ["Print vibe", "bg-stone-300", "Print vibe"],
      ["Mixtape vibe", "bg-orange-800", "Mixtape vibe"],
      ["Blocks vibe", "bg-orange-500", "Blocks vibe"],
      ["Camcorder vibe", "bg-cyan-500", "Camcorder vibe"],
      ["Kaleido vibe", "bg-violet-400", "Kaleido: mirror funhouse on the beat"],
      ["Weave vibe", "bg-amber-200", "Weave: worn film swaying in the gate"],
      ["Crossroll vibe", "bg-white", "Crossroll: the picture rolls on the turnaround"],
      ["Ghost vibe", "bg-teal-300", "Ghost vibe"],
      ["Solar vibe", "bg-amber-400", "Solar vibe"],
    ] as const;
    for (const [name, swatchClass, title] of swatches) {
      const button = within(vibeGroup).getByRole("button", { name });
      expect(button).toHaveAttribute("title", title);
      expect(button.querySelector("[aria-hidden='true']")).toHaveClass(swatchClass);
    }

    fireEvent.click(within(vibeGroup).getByRole("button", { name: "Solar vibe" }));

    expect(within(vibeGroup).getByText("Solar")).toBeInTheDocument();
    expect(within(vibeGroup).queryByText("Clean")).not.toBeInTheDocument();
    expect(useAppStore.getState().mood.piece?.vibe).toBe("solar");
  });

  it("disables the wardrobe vibe picker while exporting", () => {
    act(() => {
      useAppStore.getState().actions.setAppMode("mood");
      useAppStore.getState().actions.createMoodPiece("corners", "pocket");
      useAppStore.getState().actions.setMoodTake("mic-0", makeTake({ id: "the-one" }));
    });
    renderMoodMode();

    act(() => {
      useAppStore.getState().actions.setIsExporting(true);
    });

    const blocks = screen.getByRole("button", { name: "Blocks vibe" });
    expect(blocks).toBeDisabled();
    expect(blocks).toHaveAttribute("title", "Blocks vibe frozen during export");

    fireEvent.click(blocks);

    expect(useAppStore.getState().mood.piece?.vibe).toBe("clean");
  });

  it("disables the wardrobe vibe picker while performing", () => {
    act(() => {
      useAppStore.getState().actions.setAppMode("mood");
      useAppStore.getState().actions.createMoodPiece("corners", "pocket");
      useAppStore.getState().actions.setMoodTake("mic-0", makeTake({ id: "the-one" }));
      useAppStore.getState().actions.setMoodPerforming(true, 4);
    });
    renderMoodMode();

    const blocks = screen.getByRole("button", { name: "Blocks vibe" });
    expect(blocks).toBeDisabled();
    expect(blocks).toHaveAttribute("title", "Blocks vibe locked during performance");
  });

  it.each(["preparing", "countdown", "recording", "reviewing"] as const)(
    "disables the wardrobe vibe picker while capture is %s",
    (recordingState) => {
      act(() => {
        useAppStore.getState().actions.setAppMode("mood");
        useAppStore.getState().actions.createMoodPiece("corners", "pocket");
        useAppStore.getState().actions.setMoodTake("mic-0", makeTake({ id: "the-one" }));
        useAppStore.getState().actions.setRecordingState(recordingState, 0);
      });
      renderMoodMode();

      const blocks = screen.getByRole("button", { name: "Blocks vibe" });
      expect(blocks).toBeDisabled();
      expect(blocks).toHaveAttribute("title", "Blocks vibe locked during capture");
    },
  );

  it.each(["preparing", "countdown", "recording", "reviewing"] as const)(
    "disables the Mood lens toggle while capture is %s",
    (recordingState) => {
      act(() => {
        useAppStore.getState().actions.setAppMode("mood");
        useAppStore.getState().actions.createMoodPiece("corners", "pocket");
        useAppStore.getState().actions.setMoodTake("mic-0", makeTake({ id: "the-one" }));
        useAppStore.getState().actions.setRecordingState(recordingState, 0);
      });
      renderMoodMode();

      expect(screen.getByRole("button", { name: "Wall lens" })).toBeDisabled();
      expect(screen.getByRole("button", { name: "Splits lens" })).toBeDisabled();
      expect(screen.getByRole("button", { name: "Solo lens" })).toBeDisabled();
    },
  );

  it("creates a Click mood piece with local bpm and bars", () => {
    renderMoodMode();

    fireEvent.click(screen.getByRole("button", { name: /Click/i }));
    fireEvent.keyDown(screen.getByRole("slider", { name: "Tempo" }), {
      key: "ArrowUp",
    });
    fireEvent.click(screen.getByRole("button", { name: "4 bars" }));

    expect(useAppStore.getState().project.bpm).toBe(90);

    fireEvent.click(screen.getByRole("button", { name: /Stack/i }));

    const piece = useAppStore.getState().mood.piece;
    expect(piece?.stage).toBe("stack");
    expect(piece?.timeFeel).toBe("click");
    expect(piece?.bpm).toBe(100);
    expect(piece?.cycleBars).toBe(4);
    expect(piece?.cycleSeconds).toBeNull();
    expect(screen.getByLabelText("Time feel")).toHaveTextContent("Click · 100 · 4 bars");
    expect(screen.queryByRole("button", { name: /Click/i })).not.toBeInTheDocument();
  });

  it("opens, cancels, and confirms Scratch through the header overflow", () => {
    useAppStore.getState().actions.createMoodPiece("corners", "pocket");
    renderMoodMode();

    const optionsButton = screen.getByRole("button", { name: "Mood options" });
    expect(optionsButton).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(optionsButton);

    expect(optionsButton).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("dialog", { name: "Mood options" })).toBeInTheDocument();
    const scratchButton = screen.getByRole("button", { name: "Scratch this mood" });
    expect(scratchButton).toHaveClass("pointer-coarse:min-h-11");

    fireEvent.click(scratchButton);

    expect(screen.getByText("Start over and clear this mood?")).toBeInTheDocument();
    const confirmButton = screen.getByRole("button", { name: "Yes, scratch it" });
    const cancelButton = screen.getByRole("button", { name: "Cancel" });
    expect(confirmButton).toHaveClass("pointer-coarse:min-h-11");
    expect(cancelButton).toHaveClass("pointer-coarse:min-h-11");

    fireEvent.click(cancelButton);

    expect(screen.queryByText("Start over and clear this mood?")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Scratch this mood" }));
    fireEvent.click(screen.getByRole("button", { name: "Yes, scratch it" }));

    expect(useAppStore.getState().mood.piece).toBeNull();
  });

  it("disables scratch while exporting and keeps disabled clicks inert", () => {
    useAppStore.getState().actions.createMoodPiece("corners", "pocket");
    const scratchMoodPiece = vi.spyOn(useAppStore.getState().actions, "scratchMoodPiece");
    renderMoodMode();

    fireEvent.click(screen.getByRole("button", { name: "Mood options" }));
    fireEvent.click(screen.getByRole("button", { name: "Scratch this mood" }));

    act(() => {
      useAppStore.getState().actions.setIsExporting(true);
    });

    const confirmButton = screen.getByRole("button", { name: "Yes, scratch it" });
    expect(confirmButton).toBeDisabled();
    expect(confirmButton).toHaveAttribute("title", "frozen during export");

    fireEvent.click(confirmButton);

    expect(scratchMoodPiece).not.toHaveBeenCalled();
    expect(useAppStore.getState().mood.piece).not.toBeNull();
    scratchMoodPiece.mockRestore();
  });

  it("disables scratch while performing", () => {
    useAppStore.getState().actions.createMoodPiece("corners", "pocket");
    useAppStore.getState().actions.setMoodPerforming(true, 1);
    renderMoodMode();

    expect(screen.getByRole("group", { name: "Mood mics" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Mood options" }));
    const scratchButton = screen.getByRole("button", { name: "Scratch this mood" });
    expect(scratchButton).toBeDisabled();
    expect(scratchButton).toHaveAttribute("title", "stop the performance first");
  });
});
