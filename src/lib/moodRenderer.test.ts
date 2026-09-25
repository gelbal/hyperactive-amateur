// ABOUTME: moodRenderer tests — proves Mood paint-path commits and Wall drawing.
// ABOUTME: Mirrors VideoEngine boundary regressions while pinning poster/off/black tile states.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type RepeatCallback = (time: number) => void;

const toneMocks = vi.hoisted(() => {
  const transport = {
    start: vi.fn(),
    stop: vi.fn(),
    clear: vi.fn(),
    scheduleRepeat: vi.fn<(callback: RepeatCallback, interval: number) => number>(() => 301),
    position: 0 as number | string,
  };
  const draw = {
    schedule: vi.fn((callback: () => void) => {
      callback();
      return 401;
    }),
  };
  return {
    draw,
    now: vi.fn(() => 0),
    transport,
  };
});

const audioLifecycleMocks = vi.hoisted(() => ({
  ensureAudioRunning: vi.fn(),
}));

const moodPlayersMocks = vi.hoisted(() => ({
  stopAllMoodPlayers: vi.fn(),
  syncMoodPlayers: vi.fn(),
}));

vi.mock("tone", () => ({
  getDraw: vi.fn(() => toneMocks.draw),
  getTransport: vi.fn(() => toneMocks.transport),
  now: toneMocks.now,
}));

vi.mock("./audioLifecycle", () => ({
  ensureAudioRunning: audioLifecycleMocks.ensureAudioRunning,
}));

vi.mock("./moodPlayers", () => ({
  stopAllMoodPlayers: moodPlayersMocks.stopAllMoodPlayers,
  syncMoodPlayers: moodPlayersMocks.syncMoodPlayers,
}));

import {
  __resetMoodRendererForTesting,
  drawMoodFrame,
  initMoodRenderer,
} from "./moodRenderer";
import {
  __resetMoodVideoPoolForTesting,
  syncPool,
  videoForTake,
} from "./moodVideoPool";
import {
  __resetMoodTransportForTesting,
  armMoodSelectionCommit,
  startMoodPerformance,
  stopMoodPerformance,
} from "./moodTransport";
import { __resetPendingAudibleClaimForTesting } from "./audibleActionGate";
import { STAGE_DESCRIPTORS, createEmptyMoodPiece } from "./moodStages";
import { useAppStore } from "../store/useAppStore";
import type { MoodPerformanceState, MoodPiece, MoodTake } from "../types";

type CanvasCall = {
  method: string;
  args: unknown[];
  fillStyle: string;
  globalAlpha: number;
};

const originalImage = globalThis.Image;
const originalWindowImage = window.Image;

function makeMoodTake(overrides: Partial<MoodTake> = {}): MoodTake {
  const id = overrides.id ?? "take-1";
  const durationSeconds = overrides.durationSeconds ?? 2;
  return {
    id,
    videoBlob: new Blob([new Uint8Array([1])], { type: "video/webm" }),
    audioBlob: null,
    posterBlob: null,
    url: `blob:test/${id}`,
    audioBuffer: { duration: durationSeconds, sampleRate: 48000 } as AudioBuffer,
    audioStatus: "ok",
    posterUrl: `blob:test/${id}-poster`,
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

function installInstantImages(): void {
  class InstantImage {
    onload: ((event: Event) => void) | null = null;
    onerror: ((event: Event) => void) | null = null;
    complete = false;
    naturalWidth = 0;
    naturalHeight = 0;
    width = 0;
    height = 0;
    private value = "";

    set src(next: string) {
      this.value = next;
      this.complete = true;
      this.naturalWidth = 640;
      this.naturalHeight = 480;
      this.width = 640;
      this.height = 480;
      this.onload?.(new Event("load"));
    }

    get src(): string {
      return this.value;
    }
  }

  Object.defineProperty(globalThis, "Image", {
    configurable: true,
    value: InstantImage,
  });
  Object.defineProperty(window, "Image", {
    configurable: true,
    value: InstantImage,
  });
}

function restoreImages(): void {
  Object.defineProperty(globalThis, "Image", {
    configurable: true,
    value: originalImage,
  });
  Object.defineProperty(window, "Image", {
    configurable: true,
    value: originalWindowImage,
  });
}

function createRenderer(stage: MoodPiece["stage"] = "corners"): CanvasRenderingContext2D & {
  __haCanvasCalls: CanvasCall[];
} {
  const canvas = document.createElement("canvas");
  const descriptor = STAGE_DESCRIPTORS[stage];
  canvas.width = descriptor.canvasSize.w;
  canvas.height = descriptor.canvasSize.h;
  initMoodRenderer(canvas, stage);
  return canvas.getContext("2d") as CanvasRenderingContext2D & {
    __haCanvasCalls: CanvasCall[];
  };
}

function createMoodWithCycle(cycleSeconds = 2): void {
  const actions = useAppStore.getState().actions;
  actions.createMoodPiece("row", "pocket");
  actions.setMoodTake(
    "mic-0",
    makeMoodTake({ id: "the-one", durationSeconds: cycleSeconds }),
  );
  actions.setMoodTake("mic-1", makeMoodTake({ id: "take-b" }));
  actions.setAppMode("mood");
}

function currentRenderState(): { piece: MoodPiece; performance: MoodPerformanceState } {
  const state = useAppStore.getState().mood;
  if (!state.piece) throw new Error("Expected a Mood piece");
  return { piece: state.piece, performance: state.performance };
}

function setVideoFrameState(
  video: HTMLVideoElement,
  state: { readyState?: number; seeking?: boolean; width?: number; height?: number },
): void {
  Object.defineProperty(video, "readyState", {
    configurable: true,
    value: state.readyState ?? 2,
  });
  Object.defineProperty(video, "seeking", {
    configurable: true,
    value: state.seeking ?? false,
  });
  Object.defineProperty(video, "videoWidth", {
    configurable: true,
    value: state.width ?? 640,
  });
  Object.defineProperty(video, "videoHeight", {
    configurable: true,
    value: state.height ?? 480,
  });
}

describe("moodRenderer", () => {
  beforeEach(() => {
    window.localStorage.clear();
    useAppStore.getState().actions.setIsExporting(false);
    useAppStore.getState().actions.reset();
    __resetPendingAudibleClaimForTesting();
    __resetMoodTransportForTesting();
    __resetMoodRendererForTesting();
    __resetMoodVideoPoolForTesting();
    audioLifecycleMocks.ensureAudioRunning.mockReset();
    audioLifecycleMocks.ensureAudioRunning.mockResolvedValue(undefined);
    toneMocks.now.mockReset();
    toneMocks.now.mockReturnValue(0);
    toneMocks.transport.start.mockClear();
    toneMocks.transport.stop.mockClear();
    toneMocks.transport.clear.mockClear();
    toneMocks.transport.scheduleRepeat.mockClear();
    toneMocks.transport.position = 0;
    toneMocks.draw.schedule.mockClear();
    moodPlayersMocks.stopAllMoodPlayers.mockReset();
    moodPlayersMocks.syncMoodPlayers.mockReset();
    installInstantImages();
  });

  afterEach(() => {
    stopMoodPerformance();
    __resetMoodTransportForTesting();
    __resetMoodRendererForTesting();
    __resetMoodVideoPoolForTesting();
    __resetPendingAudibleClaimForTesting();
    restoreImages();
    vi.restoreAllMocks();
  });

  it("promotes a due Mood selection commit exactly once from the paint loop", async () => {
    createMoodWithCycle(2);
    const ctx = createRenderer("row");
    const commitSelections = vi.spyOn(
      useAppStore.getState().actions,
      "commitMoodSelections",
    );
    toneMocks.now.mockReturnValueOnce(10);
    await startMoodPerformance();
    armMoodSelectionCommit({ micId: "mic-0", entry: "take-b" }, 12);

    const boundaryCallback = toneMocks.transport.scheduleRepeat.mock.calls[0]?.[0];
    boundaryCallback?.(12);

    drawMoodFrame(11.99, currentRenderState());
    expect(useAppStore.getState().mood.performance.selections["mic-0"]).toBe("off");

    drawMoodFrame(12, currentRenderState());
    expect(useAppStore.getState().mood.performance.selections["mic-0"]).toBe("take-b");
    expect(commitSelections).toHaveBeenCalledTimes(1);
    expect(commitSelections).toHaveBeenCalledWith([
      { micId: "mic-0", entry: "take-b" },
    ]);

    drawMoodFrame(99, currentRenderState());
    expect(commitSelections).toHaveBeenCalledTimes(1);
    expect(ctx.__haCanvasCalls.length).toBeGreaterThan(0);
  });

  it("lets a stalled paint catch up to the latest due boundary", async () => {
    createMoodWithCycle(2);
    createRenderer("row");
    toneMocks.now.mockReturnValueOnce(10);
    await startMoodPerformance();
    armMoodSelectionCommit({ micId: "mic-0", entry: "the-one" }, 12);

    const boundaryCallback = toneMocks.transport.scheduleRepeat.mock.calls[0]?.[0];
    boundaryCallback?.(12);
    armMoodSelectionCommit({ micId: "mic-0", entry: "take-b" }, 14);
    boundaryCallback?.(14);

    drawMoodFrame(14, currentRenderState());

    expect(useAppStore.getState().mood.performance.selections["mic-0"]).toBe("take-b");
    expect(useAppStore.getState().mood.performance.armed["mic-0"]).toBeNull();
  });

  it("draws Wall live posters, Off dim posters, and empty mics as near-black tiles", () => {
    const piece = createEmptyMoodPiece("corners", "pocket");
    const liveTake = makeMoodTake({ id: "live", posterUrl: "blob:test/live-poster" });
    const offTake = makeMoodTake({ id: "off-last", posterUrl: "blob:test/off-poster" });
    const renderPiece: MoodPiece = {
      ...piece,
      mics: piece.mics.map((mic, index) => {
        if (index === 0) return { ...mic, takes: [liveTake] };
        if (index === 1) return { ...mic, takes: [offTake] };
        return mic;
      }),
    };
    const performance: MoodPerformanceState = {
      isPerforming: false,
      epoch: null,
      selections: {
        "mic-0": "live",
        "mic-1": "off",
        "mic-2": "off",
        "mic-3": "off",
      },
      armed: {
        "mic-0": null,
        "mic-1": null,
        "mic-2": null,
        "mic-3": null,
      },
      dropActive: false,
      hotMicId: null,
      cycleCount: 0,
    };
    const ctx = createRenderer("corners");

    drawMoodFrame(1, { piece: renderPiece, performance });

    const fillCalls = ctx.__haCanvasCalls.filter((call) => call.method === "fillRect");
    const imageCalls = ctx.__haCanvasCalls.filter((call) => call.method === "drawImage");

    expect(fillCalls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ args: [0, 0, 480, 480], fillStyle: "#050505" }),
        expect.objectContaining({ args: [0, 0, 240, 240], fillStyle: "#050505" }),
        expect.objectContaining({ args: [240, 0, 240, 240], fillStyle: "#050505" }),
        expect.objectContaining({ args: [0, 240, 240, 240], fillStyle: "#050505" }),
      ]),
    );
    expect(imageCalls).toHaveLength(2);
    expect(imageCalls[0].globalAlpha).toBe(1);
    expect(imageCalls[1].globalAlpha).toBeCloseTo(0.28);
  });

  it("falls back to the live poster until the pooled take video is drawable", () => {
    const piece = createEmptyMoodPiece("corners", "pocket");
    const liveTake = makeMoodTake({
      id: "live",
      posterUrl: "blob:test/live-poster",
      trimStartMs: 250,
      trimEndMs: 1250,
    });
    const dormantTake = makeMoodTake({ id: "dormant", posterUrl: "blob:test/dormant-poster" });
    const renderPiece: MoodPiece = {
      ...piece,
      mics: piece.mics.map((mic, index) =>
        index === 0 ? { ...mic, takes: [liveTake, dormantTake] } : mic,
      ),
    };
    const performance: MoodPerformanceState = {
      isPerforming: false,
      epoch: null,
      selections: {
        "mic-0": "live",
        "mic-1": "off",
        "mic-2": "off",
        "mic-3": "off",
      },
      armed: {
        "mic-0": null,
        "mic-1": null,
        "mic-2": null,
        "mic-3": null,
      },
      dropActive: false,
      hotMicId: null,
      cycleCount: 0,
    };
    const ctx = createRenderer("corners");
    syncPool([{ takeId: "live", url: "blob:test/live", loopStart: 0.25, loopEnd: 1.25 }]);

    drawMoodFrame(1, { piece: renderPiece, performance });

    const video = videoForTake("live");
    expect(video).toBeInstanceOf(HTMLVideoElement);
    expect(videoForTake("dormant")).toBeNull();
    let imageCalls = ctx.__haCanvasCalls.filter((call) => call.method === "drawImage");
    expect(imageCalls).toHaveLength(1);
    expect(imageCalls[0].args[0]).not.toBe(video);

    ctx.__haCanvasCalls.length = 0;
    setVideoFrameState(video as HTMLVideoElement, {
      readyState: 2,
      seeking: false,
      width: 640,
      height: 480,
    });
    drawMoodFrame(1.1, { piece: renderPiece, performance });

    imageCalls = ctx.__haCanvasCalls.filter((call) => call.method === "drawImage");
    expect(imageCalls).toHaveLength(1);
    expect(imageCalls[0].args[0]).toBe(video);
  });
});
