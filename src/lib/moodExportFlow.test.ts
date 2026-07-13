// ABOUTME: moodExportFlow tests — pins the one-take performance-export contract.
// ABOUTME: Covers gating, boundary-aligned prepare, finish semantics, and survival rules.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const exportMocks = vi.hoisted(() => ({
  exportSong: vi.fn(),
}));

const audioMocks = vi.hoisted(() => {
  const audioContext: { currentTime: number } = { currentTime: 0 };
  return {
    audioContext,
    getAudioContext: vi.fn(() => audioContext as unknown as AudioContext),
  };
});

const videoEngineMocks = vi.hoisted(() => ({
  getActiveCanvas: vi.fn<() => HTMLCanvasElement | null>(() => null),
}));

const moodTransportMocks = vi.hoisted(() => ({
  startMoodPerformanceForExportFlow: vi.fn(),
  stopMoodPerformance: vi.fn(),
}));

const toneMocks = vi.hoisted(() => ({
  now: vi.fn(() => 0),
}));

vi.mock("./export", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./export")>();
  return {
    ...actual,
    exportSong: exportMocks.exportSong,
  };
});

vi.mock("./audio", () => ({
  getAudioContext: audioMocks.getAudioContext,
}));

vi.mock("./videoEngine", () => ({
  getActiveCanvas: videoEngineMocks.getActiveCanvas,
}));

vi.mock("./moodTransport", () => ({
  startMoodPerformanceForExportFlow: moodTransportMocks.startMoodPerformanceForExportFlow,
  stopMoodPerformance: moodTransportMocks.stopMoodPerformance,
}));

vi.mock("tone", () => ({
  now: toneMocks.now,
}));

import { MOOD_EXPORT_MAX_MS, type ExportOptions } from "./export";
import { startMoodExport } from "./moodExportFlow";
import { useAppStore } from "../store/useAppStore";
import type { MoodTake } from "../types";

function makeCanvas(): HTMLCanvasElement {
  return {} as HTMLCanvasElement;
}

function makeMoodTake(overrides: Partial<MoodTake> = {}): MoodTake {
  const id = overrides.id ?? "the-one";
  const durationSeconds = overrides.durationSeconds ?? 2;
  return {
    id,
    videoBlob: new Blob([new Uint8Array([1])], { type: "video/webm" }),
    audioBlob: null,
    posterBlob: null,
    url: `blob:test/${id}`,
    audioBuffer: { duration: durationSeconds, sampleRate: 48000 } as AudioBuffer,
    audioStatus: "ok",
    posterUrl: null,
    trimStartMs: 0,
    trimEndMs: durationSeconds * 1000,
    durationSeconds,
    cycleMultiple: 1,
    syncOffsetMs: 0,
    part: null,
    partSource: null,
    recordedAt: 1,
    ...overrides,
  };
}

function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("moodExportFlow", () => {
  beforeEach(() => {
    useAppStore.getState().actions.reset();
    exportMocks.exportSong.mockReset();
    exportMocks.exportSong.mockResolvedValue(new Blob([new Uint8Array([1])]));
    videoEngineMocks.getActiveCanvas.mockReturnValue(makeCanvas());
    audioMocks.audioContext.currentTime = 0;
    toneMocks.now.mockReturnValue(0);
    moodTransportMocks.startMoodPerformanceForExportFlow.mockReset();
    moodTransportMocks.stopMoodPerformance.mockReset();
    moodTransportMocks.startMoodPerformanceForExportFlow.mockImplementation(async () => {
      useAppStore.getState().actions.setMoodPerforming(true, 10);
      return true;
    });
  });

  afterEach(() => {
    useAppStore.getState().actions.reset();
  });

  function createPieceWithCycle(): void {
    const actions = useAppStore.getState().actions;
    actions.createMoodPiece("corners", "pocket");
    actions.setMoodTake("mic-0", makeMoodTake());
  }

  it("refuses without a piece or an established cycle", () => {
    expect(() => startMoodExport({ mimeType: "video/webm" })).toThrow(/record the One/i);

    useAppStore.getState().actions.createMoodPiece("corners", "pocket");
    expect(() => startMoodExport({ mimeType: "video/webm" })).toThrow(/record the One/i);
    expect(exportMocks.exportSong).not.toHaveBeenCalled();
  });

  it("refuses when the Mood stage canvas is not registered", () => {
    createPieceWithCycle();
    videoEngineMocks.getActiveCanvas.mockReturnValue(null);

    expect(() => startMoodExport({ mimeType: "video/webm" })).toThrow(/canvas/i);
    expect(exportMocks.exportSong).not.toHaveBeenCalled();
  });

  it("hands exportSong the stop-signal mode with the 3:00 ceiling and mood drive", () => {
    createPieceWithCycle();
    const onProgress = vi.fn();

    startMoodExport({ mimeType: "video/webm", onProgress });

    expect(exportMocks.exportSong).toHaveBeenCalledTimes(1);
    const options = exportMocks.exportSong.mock.calls[0][2] as ExportOptions;
    expect(options.mimeType).toBe("video/webm");
    expect(options.onProgress).toBe(onProgress);
    expect("stopSignal" in options && options.stopSignal).toBeTruthy();
    expect("maxDurationMs" in options && options.maxDurationMs).toBe(MOOD_EXPORT_MAX_MS);
    expect(options.drive?.prepare).toBeTypeOf("function");
    expect(options.drive?.cleanup).toBeTypeOf("function");
  });

  it("prepare starts the performance and holds until the next cycle boundary", async () => {
    createPieceWithCycle();
    startMoodExport({ mimeType: "video/webm" });
    const options = exportMocks.exportSong.mock.calls[0][2] as ExportOptions;

    // Performance epoch lands at 10 (mock); boundary math sees now=10.2 →
    // next boundary 12. The audio clock sits before it, so prepare pends.
    toneMocks.now.mockReturnValue(10.2);
    audioMocks.audioContext.currentTime = 10.2;
    let prepared = false;
    const prepare = Promise.resolve(options.drive?.prepare?.()).then(() => {
      prepared = true;
    });
    await flushMicrotasks();
    expect(moodTransportMocks.startMoodPerformanceForExportFlow).toHaveBeenCalledTimes(1);
    expect(prepared).toBe(false);

    audioMocks.audioContext.currentTime = 12;
    await prepare;
    expect(prepared).toBe(true);
  });

  it("prepare waits only to the audible epoch on a fresh start", async () => {
    createPieceWithCycle();
    startMoodExport({ mimeType: "video/webm" });
    const options = exportMocks.exportSong.mock.calls[0][2] as ExportOptions;

    // Fresh start: epoch was captured from the lookahead clock, so by
    // prepare time Tone.now() is STRICTLY past it while the audible clock
    // still trails. The recorder must start at the audible epoch — not a
    // full cycle later.
    toneMocks.now.mockReturnValue(10.05);
    audioMocks.audioContext.currentTime = 9.9;
    let prepared = false;
    const prepare = Promise.resolve(options.drive?.prepare?.()).then(() => {
      prepared = true;
    });
    await flushMicrotasks();
    expect(prepared).toBe(false);

    audioMocks.audioContext.currentTime = 10;
    await prepare;
    expect(prepared).toBe(true);
  });

  it("stops the performance when the export rejects after starting it", async () => {
    createPieceWithCycle();
    audioMocks.audioContext.currentTime = 10.1;
    toneMocks.now.mockReturnValue(10.1);
    exportMocks.exportSong.mockImplementation(async (_canvas, _ctx, options) => {
      // Mirror exportSong: prepare runs (starting the performance), then
      // the render aborts mid-flight.
      audioMocks.audioContext.currentTime = 12;
      await (options as ExportOptions).drive?.prepare?.();
      throw new Error("page hidden");
    });

    const handle = startMoodExport({ mimeType: "video/webm" });

    await expect(handle.result).rejects.toThrow(/page hidden/);
    expect(moodTransportMocks.stopMoodPerformance).toHaveBeenCalledTimes(1);
  });

  it("does not stop a performance it never started when the export is refused", async () => {
    createPieceWithCycle();
    // Rejection at exportSong's pre-session gate: prepare never ran, so the
    // refusing state (someone else's run) must not be stopped.
    exportMocks.exportSong.mockRejectedValue(
      new Error("Cannot export while recording or another export is active."),
    );

    const handle = startMoodExport({ mimeType: "video/webm" });

    await expect(handle.result).rejects.toThrow(/another export/i);
    expect(moodTransportMocks.stopMoodPerformance).not.toHaveBeenCalled();
  });

  it("exposes recordingStarted resolving when prepare completes", async () => {
    createPieceWithCycle();
    const handle = startMoodExport({ mimeType: "video/webm" });
    const options = exportMocks.exportSong.mock.calls[0][2] as ExportOptions;

    let started = false;
    void handle.recordingStarted.then(() => {
      started = true;
    });
    await flushMicrotasks();
    expect(started).toBe(false);

    toneMocks.now.mockReturnValue(10.05);
    audioMocks.audioContext.currentTime = 10;
    await Promise.resolve(options.drive?.prepare?.());
    await flushMicrotasks();
    expect(started).toBe(true);
  });

  it("prepare rejects when the performance cannot start", async () => {
    createPieceWithCycle();
    moodTransportMocks.startMoodPerformanceForExportFlow.mockResolvedValue(false);
    startMoodExport({ mimeType: "video/webm" });
    const options = exportMocks.exportSong.mock.calls[0][2] as ExportOptions;

    await expect(Promise.resolve(options.drive?.prepare?.())).rejects.toThrow(
      /could not start/i,
    );
  });

  it("finish resolves the stop signal; cleanup leaves the performance running", async () => {
    createPieceWithCycle();
    const handle = startMoodExport({ mimeType: "video/webm" });
    const options = exportMocks.exportSong.mock.calls[0][2] as ExportOptions;
    if (!("stopSignal" in options) || !options.stopSignal) throw new Error("expected stop mode");

    let stopped = false;
    void Promise.resolve(options.stopSignal).then(() => {
      stopped = true;
    });
    await flushMicrotasks();
    expect(stopped).toBe(false);

    handle.finish();
    await flushMicrotasks();
    expect(stopped).toBe(true);

    // The render stopped watching; the performance itself keeps running.
    useAppStore.getState().actions.setMoodPerforming(true, 10);
    await Promise.resolve(options.drive?.cleanup?.());
    expect(useAppStore.getState().mood.performance.isPerforming).toBe(true);
  });
});
