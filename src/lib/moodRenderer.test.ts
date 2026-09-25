// ABOUTME: moodRenderer tests — proves Mood paint-path commits and Wall drawing.
// ABOUTME: Mirrors VideoEngine boundary regressions while pinning poster/off/black tile states.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { toneHarness } = await vi.hoisted(async () => {
  const { createToneHarness } = await import("../test-utils/toneTestHarness");
  return { toneHarness: createToneHarness() };
});

const audioLifecycleMocks = vi.hoisted(() => ({
  ensureAudioRunning: vi.fn(),
}));

const moodPlayersMocks = vi.hoisted(() => ({
  stopAllMoodPlayers: vi.fn(),
  syncMoodPlayers: vi.fn(),
}));

const moodFxVisualMocks = vi.hoisted(() => ({
  brakeLevel: 0,
  echoLevel: 0,
  gateActive: false,
  harmonyLevel: 0,
  initializeMoodFxForPerformance: vi.fn(),
  resetMoodDropFilter: vi.fn(),
  scheduleMoodDropFilter: vi.fn(),
}));

vi.mock("tone", () => toneHarness.createToneModule());

vi.mock("./audioLifecycle", () => ({
  ensureAudioRunning: audioLifecycleMocks.ensureAudioRunning,
}));

vi.mock("./moodPlayers", () => ({
  scheduleMoodPlayerSwap: vi.fn(),
  stopAllMoodPlayers: moodPlayersMocks.stopAllMoodPlayers,
  syncMoodPlayers: moodPlayersMocks.syncMoodPlayers,
}));

vi.mock("./moodFx", () => ({
  brakeVisualLevel: () => moodFxVisualMocks.brakeLevel,
  echoVisualLevel: () => moodFxVisualMocks.echoLevel,
  gateVisualActive: () => moodFxVisualMocks.gateActive,
  harmonizeVisualLevel: () => moodFxVisualMocks.harmonyLevel,
  initializeMoodFxForPerformance: moodFxVisualMocks.initializeMoodFxForPerformance,
  resetMoodDropFilter: moodFxVisualMocks.resetMoodDropFilter,
  scheduleMoodDropFilter: moodFxVisualMocks.scheduleMoodDropFilter,
}));

import {
  __getMoodPosterCacheSizeForTesting,
  __resetMoodRendererForTesting,
  __getMoodRendererPreviewVideoForTesting,
  deriveMoodMetronomeMicId,
  disposeMoodRenderer,
  drawDesaturated,
  drawMoodFrame,
  initMoodRenderer,
  moodDropFlashAlpha,
  PRINT_FRAME_BUDGET_MS,
  PRINT_WATCHDOG_WINDOW_FRAMES,
} from "./moodRenderer";
import { getPrintDensity, setPrintDensity } from "./moodVibes";
import { clearLogs, getLogs, LOG_EVENTS, logger } from "./logger";
import { setMoodRecordingPreviewStream } from "./moodCapture";
import {
  __resetMoodVideoPoolForTesting,
  syncPool,
  videoForTake,
} from "./moodVideoPool";
import {
  __resetMoodTransportForTesting,
  armMoodDropCommit,
  armMoodLensCommit,
  armMoodSelectionCommit,
  startMoodPerformance,
  stopMoodPerformance,
} from "./moodTransport";
import { DROP_FLASH_ACCENTS, DROP_FLASH_WHITEWARD } from "./moodVibePalettes";
import { __resetPendingAudibleClaimForTesting } from "./audibleActionGate";
import { STAGE_DESCRIPTORS, createEmptyMoodPiece } from "./moodStages";
import { useAppStore } from "../store/useAppStore";
import type { MoodPerformanceState, MoodPiece } from "../types";
import { makeMoodTake } from "../test-utils/moodFixtures";

type CanvasCall = {
  method: string;
  args: unknown[];
  fillStyle: string;
  globalAlpha: number;
  globalCompositeOperation: string;
};

const originalImage = globalThis.Image;
const originalWindowImage = window.Image;

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
    clearLogs();
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    window.localStorage.clear();
    useAppStore.getState().actions.setIsExporting(false);
    useAppStore.getState().actions.reset();
    __resetPendingAudibleClaimForTesting();
    __resetMoodTransportForTesting();
    __resetMoodRendererForTesting();
    __resetMoodVideoPoolForTesting();
    audioLifecycleMocks.ensureAudioRunning.mockReset();
    audioLifecycleMocks.ensureAudioRunning.mockResolvedValue(undefined);
    toneHarness.setImmediate(0);
    toneHarness.setLookahead(0);
    toneHarness.transport.reset();
    toneHarness.draw.reset();
    moodPlayersMocks.stopAllMoodPlayers.mockReset();
    moodPlayersMocks.syncMoodPlayers.mockReset();
    moodFxVisualMocks.brakeLevel = 0;
    moodFxVisualMocks.echoLevel = 0;
    moodFxVisualMocks.gateActive = false;
    moodFxVisualMocks.harmonyLevel = 0;
    moodFxVisualMocks.initializeMoodFxForPerformance.mockReset();
    moodFxVisualMocks.resetMoodDropFilter.mockReset();
    moodFxVisualMocks.scheduleMoodDropFilter.mockReset();
    installInstantImages();
  });

  afterEach(() => {
    setPrintDensity("normal");
    stopMoodPerformance();
    setMoodRecordingPreviewStream(null);
    __resetMoodTransportForTesting();
    __resetMoodRendererForTesting();
    __resetMoodVideoPoolForTesting();
    __resetPendingAudibleClaimForTesting();
    restoreImages();
    vi.restoreAllMocks();
  });

  it("promotes a due Mood selection commit exactly once from the paint loop", async () => {
    createMoodWithCycle(2);
    useAppStore.getState().actions.setMoodTake("mic-0", makeMoodTake({ id: "take-b" }));
    const ctx = createRenderer("row");
    const commitSelections = vi.spyOn(
      useAppStore.getState().actions,
      "commitMoodSelections",
    );
    toneHarness.setImmediate(10);
    await startMoodPerformance();
    armMoodSelectionCommit({ micId: "mic-0", entry: "take-b" }, 12, 10);

    const boundaryCallback = toneHarness.transport.scheduleRepeat.mock.calls[0]?.[0];
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
    useAppStore.getState().actions.setMoodTake("mic-0", makeMoodTake({ id: "take-b" }));
    createRenderer("row");
    toneHarness.setImmediate(10);
    await startMoodPerformance();
    armMoodSelectionCommit({ micId: "mic-0", entry: "the-one" }, 12, 10);

    const boundaryCallback = toneHarness.transport.scheduleRepeat.mock.calls[0]?.[0];
    boundaryCallback?.(12);
    armMoodSelectionCommit({ micId: "mic-0", entry: "take-b" }, 14, 10);
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
      armedLens: null,
      armedDropActive: null,
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

  it("evicts a deleted take poster from the decoded image cache", () => {
    const actions = useAppStore.getState().actions;
    actions.createMoodPiece("corners", "pocket");
    actions.setMoodTake(
      "mic-0",
      makeMoodTake({ id: "cached", posterUrl: "blob:test/cached-poster" }),
    );
    createRenderer("corners");
    drawMoodFrame(0, currentRenderState());

    expect(__getMoodPosterCacheSizeForTesting()).toBe(1);

    actions.deleteMoodTake("mic-0", "cached");

    expect(__getMoodPosterCacheSizeForTesting()).toBe(0);
  });

  it("drops renderer-owned resources on dispose and reinitializes cleanly", () => {
    const piece = createEmptyMoodPiece("corners", "pocket");
    const take = makeMoodTake({ id: "dispose", posterUrl: "blob:test/dispose-poster" });
    const renderPiece: MoodPiece = {
      ...piece,
      mics: piece.mics.map((mic, index) =>
        index === 0 ? { ...mic, takes: [take] } : mic,
      ),
    };
    const performance: MoodPerformanceState = {
      ...useAppStore.getState().mood.performance,
      selections: { "mic-0": "off", "mic-1": "off", "mic-2": "off", "mic-3": "off" },
      armed: { "mic-0": null, "mic-1": null, "mic-2": null, "mic-3": null },
    };
    const firstCtx = createRenderer("corners");
    drawMoodFrame(0, { piece: renderPiece, performance });
    expect(__getMoodPosterCacheSizeForTesting()).toBe(1);

    disposeMoodRenderer();
    firstCtx.__haCanvasCalls.length = 0;
    drawMoodFrame(1, { piece: renderPiece, performance });

    expect(firstCtx.__haCanvasCalls).toEqual([]);
    expect(__getMoodPosterCacheSizeForTesting()).toBe(0);

    const secondCtx = createRenderer("corners");
    drawMoodFrame(2, { piece: renderPiece, performance });

    expect(secondCtx.__haCanvasCalls.length).toBeGreaterThan(0);
    expect(__getMoodPosterCacheSizeForTesting()).toBe(1);
  });

  it("applies the wardrobe vibe on the render canvas after tile draws", () => {
    const piece = createEmptyMoodPiece("corners", "pocket");
    const liveTake = makeMoodTake({ id: "live", posterUrl: "blob:test/live-poster" });
    const renderPiece: MoodPiece = {
      ...piece,
      vibe: "blocks",
      mics: piece.mics.map((mic, index) =>
        index === 0 ? { ...mic, takes: [liveTake] } : mic,
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
      armedLens: null,
      armedDropActive: null,
      dropActive: false,
      hotMicId: null,
      cycleCount: 0,
    };
    const ctx = createRenderer("corners");

    drawMoodFrame(0, { piece: renderPiece, performance });

    const drawCalls = ctx.__haCanvasCalls.filter((call) => call.method === "drawImage");
    const tileDrawIndex = drawCalls.findIndex((call) => call.args[0] instanceof Image);
    const vibeDrawIndex = drawCalls.findIndex(
      (call) => call.args[0] instanceof HTMLCanvasElement,
    );
    expect(tileDrawIndex).toBeGreaterThanOrEqual(0);
    expect(vibeDrawIndex).toBeGreaterThan(tileDrawIndex);
  });

  it("uses the Drop while performing but still previews the wardrobe while stopped", () => {
    const piece: MoodPiece = { ...createEmptyMoodPiece("corners", "pocket"), vibe: "blocks" };
    const performance: MoodPerformanceState = {
      isPerforming: false,
      epoch: null,
      selections: {
        "mic-0": "off",
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
      armedLens: null,
      armedDropActive: null,
      dropActive: false,
      hotMicId: null,
      cycleCount: 0,
    };
    const ctx = createRenderer("corners");

    drawMoodFrame(0, { piece, performance });
    let vibeDraws = ctx.__haCanvasCalls.filter(
      (call) => call.method === "drawImage" && call.args[0] instanceof HTMLCanvasElement,
    );
    expect(vibeDraws).toHaveLength(1);

    ctx.__haCanvasCalls.length = 0;
    drawMoodFrame(0, {
      piece,
      performance: { ...performance, isPerforming: true, epoch: 0, dropActive: false },
    });
    vibeDraws = ctx.__haCanvasCalls.filter(
      (call) => call.method === "drawImage" && call.args[0] instanceof HTMLCanvasElement,
    );
    expect(vibeDraws).toHaveLength(0);

    ctx.__haCanvasCalls.length = 0;
    drawMoodFrame(0, {
      piece,
      performance: { ...performance, isPerforming: true, epoch: 0, dropActive: true },
    });
    vibeDraws = ctx.__haCanvasCalls.filter(
      (call) => call.method === "drawImage" && call.args[0] instanceof HTMLCanvasElement,
    );
    expect(vibeDraws).toHaveLength(1);
  });

  it("computes one-beat Drop flash alpha from audio time only", () => {
    expect(moodDropFlashAlpha(9.99, 10, 0.5)).toBe(0);
    expect(moodDropFlashAlpha(10, 10, 0.5)).toBe(0.35);
    expect(moodDropFlashAlpha(10.25, 10, 0.5)).toBeCloseTo(0.175);
    expect(moodDropFlashAlpha(10.5, 10, 0.5)).toBe(0);
    expect(moodDropFlashAlpha(11, 10, 0.5)).toBe(0);
    expect(moodDropFlashAlpha(10, 10, 0)).toBe(0);
  });

  it("flashes from the committed boundary and direction without allocating a canvas", async () => {
    createMoodWithCycle(4);
    useAppStore.getState().actions.setMoodVibe("blocks");
    const ctx = createRenderer("row");
    toneHarness.setImmediate(10);
    await startMoodPerformance();

    armMoodDropCommit(false, 10.5, 10.2);
    const canvasCountBefore = document.querySelectorAll("canvas").length;
    ctx.__haCanvasCalls.length = 0;
    drawMoodFrame(10.5, currentRenderState());

    expect(ctx.__haCanvasCalls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          method: "fillRect",
          args: [0, 0, 854, 480],
          fillStyle: DROP_FLASH_WHITEWARD,
          globalAlpha: 0.35,
        }),
      ]),
    );
    expect(document.querySelectorAll("canvas")).toHaveLength(canvasCountBefore);

    ctx.__haCanvasCalls.length = 0;
    drawMoodFrame(10.75, currentRenderState());
    expect(ctx.__haCanvasCalls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          method: "fillRect",
          fillStyle: DROP_FLASH_WHITEWARD,
          globalAlpha: expect.closeTo(0.175),
        }),
      ]),
    );

    armMoodDropCommit(true, 11, 10.8);
    ctx.__haCanvasCalls.length = 0;
    drawMoodFrame(11, currentRenderState());
    expect(ctx.__haCanvasCalls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          method: "fillRect",
          fillStyle: DROP_FLASH_ACCENTS.blocks,
          globalAlpha: 0.35,
        }),
      ]),
    );
  });

  it.each(["weave", "ghost"] as const)(
    "keeps the Drop impact flash above the %s vibe pass",
    async (vibe) => {
      createMoodWithCycle(4);
      useAppStore.getState().actions.setMoodVibe(vibe);
      const ctx = createRenderer("row");
      toneHarness.setImmediate(10);
      await startMoodPerformance();
      armMoodDropCommit(true, 10.5, 10.2);
      ctx.__haCanvasCalls.length = 0;

      drawMoodFrame(10.5, currentRenderState());

      const vibeDrawIndex = ctx.__haCanvasCalls.findIndex(
        (call) => call.method === "drawImage" && call.args[0] instanceof HTMLCanvasElement,
      );
      const flashIndex = ctx.__haCanvasCalls.findIndex(
        (call) =>
          call.method === "fillRect" &&
          call.fillStyle === DROP_FLASH_ACCENTS[vibe] &&
          call.globalAlpha === 0.35,
      );
      expect(vibeDrawIndex).toBeGreaterThanOrEqual(0);
      expect(flashIndex).toBeGreaterThan(vibeDrawIndex);
    },
  );

  it("keeps a due Drop flash out of the sacred capture window", async () => {
    createMoodWithCycle(4);
    useAppStore.getState().actions.setMoodVibe("blocks");
    const ctx = createRenderer("row");
    toneHarness.setImmediate(10);
    await startMoodPerformance();
    useAppStore.getState().actions.setMoodHotMic("mic-1");
    useAppStore.getState().actions.setRecordingState("recording", null);
    armMoodDropCommit(false, 10.5, 10.2);

    ctx.__haCanvasCalls.length = 0;
    drawMoodFrame(10.5, currentRenderState());

    expect(
      ctx.__haCanvasCalls.some(
        (call) =>
          call.method === "fillRect" &&
          (call.fillStyle === DROP_FLASH_WHITEWARD ||
            call.fillStyle === DROP_FLASH_ACCENTS.blocks),
      ),
    ).toBe(false);
  });

  it("draws Harmonize, Echo, and Brake from one prebuilt snapshot, then covers Gate-off phases", () => {
    createMoodWithCycle(4);
    useAppStore.getState().actions.setMoodPerforming(true, 10);
    const createElement = vi.spyOn(document, "createElement");
    const ctx = createRenderer("row");
    const canvasCreatesAtInit = createElement.mock.calls.filter(([tag]) => tag === "canvas").length;
    moodFxVisualMocks.echoLevel = 0.4;
    moodFxVisualMocks.brakeLevel = 0.6;
    moodFxVisualMocks.gateActive = true;
    moodFxVisualMocks.harmonyLevel = 0.5;
    ctx.__haCanvasCalls.length = 0;

    drawMoodFrame(10.25, currentRenderState());

    expect(createElement.mock.calls.filter(([tag]) => tag === "canvas")).toHaveLength(
      canvasCreatesAtInit,
    );
    const snapshotDraws = ctx.__haCanvasCalls.filter(
      (call) => call.method === "drawImage" && call.args[0] instanceof HTMLCanvasElement,
    );
    expect(snapshotDraws).toEqual([
      expect.objectContaining({
        args: [expect.any(HTMLCanvasElement), -2, 0],
        globalAlpha: 0.08,
      }),
      expect.objectContaining({
        args: [expect.any(HTMLCanvasElement), 2, 0],
        globalAlpha: 0.08,
      }),
      expect.objectContaining({
        args: [expect.any(HTMLCanvasElement), -4, 0],
        globalAlpha: 0.4,
      }),
      expect.objectContaining({
        args: [expect.any(HTMLCanvasElement), 0, 2],
        globalAlpha: expect.closeTo(0.3),
      }),
    ]);
    const effectDarkens = ctx.__haCanvasCalls.filter(
      (call) =>
        call.method === "fillRect" &&
        call.args.join(",") === "0,0,854,480" &&
        call.globalCompositeOperation === "source-over",
    );
    expect(effectDarkens).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ globalAlpha: expect.closeTo(0.3) }),
        expect.objectContaining({ globalAlpha: 1 }),
      ]),
    );
  });

  it("suppresses every live FX visual during the sacred capture window", () => {
    createMoodWithCycle(4);
    useAppStore.getState().actions.setMoodPerforming(true, 10);
    useAppStore.getState().actions.setMoodHotMic("mic-1");
    useAppStore.getState().actions.setRecordingState("recording", null);
    const ctx = createRenderer("row");
    moodFxVisualMocks.echoLevel = 0.5;
    moodFxVisualMocks.brakeLevel = 1;
    moodFxVisualMocks.gateActive = true;
    moodFxVisualMocks.harmonyLevel = 1;
    ctx.__haCanvasCalls.length = 0;

    drawMoodFrame(10.25, currentRenderState());

    expect(
      ctx.__haCanvasCalls.some(
        (call) => call.method === "drawImage" && call.args[0] instanceof HTMLCanvasElement,
      ),
    ).toBe(false);
    expect(
      ctx.__haCanvasCalls.some(
        (call) =>
          call.method === "fillRect" &&
          call.args.join(",") === "0,0,854,480" &&
          call.globalAlpha > 0 &&
          call.globalAlpha < 1,
      ),
    ).toBe(false);
  });

  function makeCreditFrame(styleIndex = 0): {
    piece: MoodPiece;
    performance: MoodPerformanceState;
  } {
    const base = createEmptyMoodPiece("corners", "pocket");
    const take = makeMoodTake({ id: "credit-live", posterUrl: "blob:test/credit-live" });
    const piece: MoodPiece = {
      ...base,
      cycleSeconds: 8,
      credits: {
        enabled: true,
        names: { "mic-0": "Bass" },
        styleIndex,
      },
      mics: base.mics.map((mic, index) =>
        index === 0 ? { ...mic, takes: [take] } : mic,
      ),
    };
    return {
      piece,
      performance: {
        isPerforming: true,
        epoch: 0,
        selections: {
          "mic-0": take.id,
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
        armedLens: null,
        armedDropActive: null,
        dropActive: true,
        hotMicId: null,
        cycleCount: 1,
      },
    };
  }

  it("freezes the credited tile from one init-time snapshot for the whole window", () => {
    const createElement = vi.spyOn(document, "createElement");
    const ctx = createRenderer("corners");
    const canvasCreatesAtInit = createElement.mock.calls.filter(([tag]) => tag === "canvas").length;
    const frame = makeCreditFrame();

    drawMoodFrame(8, frame);

    const firstFreeze = ctx.__haCanvasCalls.find(
      (call) =>
        call.method === "drawImage" &&
        call.args.length === 9 &&
        call.args[0] instanceof HTMLCanvasElement,
    );
    expect(firstFreeze).toBeTruthy();
    const snapshot = firstFreeze?.args[0] as HTMLCanvasElement;
    const snapshotCtx = snapshot.getContext("2d") as CanvasRenderingContext2D & {
      __haCanvasCalls: CanvasCall[];
    };
    expect(snapshotCtx.__haCanvasCalls.filter((call) => call.method === "drawImage")).toHaveLength(
      1,
    );
    expect(ctx.__haCanvasCalls.some((call) => call.method === "fillText")).toBe(true);

    ctx.__haCanvasCalls.length = 0;
    drawMoodFrame(8.5, frame);

    expect(createElement.mock.calls.filter(([tag]) => tag === "canvas")).toHaveLength(
      canvasCreatesAtInit,
    );
    expect(snapshotCtx.__haCanvasCalls.filter((call) => call.method === "drawImage")).toHaveLength(
      1,
    );
    expect(
      ctx.__haCanvasCalls.filter(
        (call) =>
          call.method === "drawImage" &&
          call.args.length === 9 &&
          call.args[0] === snapshot,
      ),
    ).toHaveLength(1);
  });

  it("fades the frozen snapshot during EXIT so the live tile wakes underneath", () => {
    const ctx = createRenderer("corners");
    const frame = makeCreditFrame();
    drawMoodFrame(8, frame);
    const snapshot = ctx.__haCanvasCalls.find(
      (call) =>
        call.method === "drawImage" &&
        call.args.length === 9 &&
        call.args[0] instanceof HTMLCanvasElement,
    )?.args[0];
    expect(snapshot).toBeInstanceOf(HTMLCanvasElement);

    ctx.__haCanvasCalls.length = 0;
    drawMoodFrame(11.5, frame);

    expect(
      ctx.__haCanvasCalls.find(
        (call) =>
          call.method === "drawImage" &&
          call.args.length === 9 &&
          call.args[0] === snapshot,
      )?.globalAlpha,
    ).toBeCloseTo(0.5);
  });

  it("aborts an active Credit window when a re-tile changes the mic rect", () => {
    const ctx = createRenderer("corners");
    const frame = makeCreditFrame();
    drawMoodFrame(8.25, frame);
    ctx.__haCanvasCalls.length = 0;

    drawMoodFrame(8.5, {
      piece: { ...frame.piece, lens: "splits" },
      performance: frame.performance,
    });

    expect(
      ctx.__haCanvasCalls.some(
        (call) => call.method === "fillText" || call.method === "strokeText",
      ),
    ).toBe(false);
    expect(
      ctx.__haCanvasCalls.some(
        (call) =>
          call.method === "drawImage" &&
          call.args.length === 9 &&
          call.args[0] instanceof HTMLCanvasElement,
      ),
    ).toBe(false);
    expect(getLogs()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: LOG_EVENTS.MOOD_CREDIT_SKIP,
          payload: expect.objectContaining({
            reason: "rect-changed",
            kind: "sequence",
            micId: "mic-0",
            lens: "splits",
            passIndex: 0,
            position: 0,
          }),
        }),
      ]),
    );
  });

  it("renders Cutout and Snipe with their pinned canvas text recipes", () => {
    const cutoutCtx = createRenderer("corners");
    drawMoodFrame(8.5, makeCreditFrame(0));
    expect(cutoutCtx.__haCanvasCalls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ method: "fillRect", fillStyle: "#f97316" }),
        expect.objectContaining({
          method: "fillText",
          args: ["BASS", 100, expect.closeTo(163.2), expect.closeTo(211.2)],
        }),
      ]),
    );
    __resetMoodRendererForTesting();
    const snipeCtx = createRenderer("corners");
    drawMoodFrame(8.25, makeCreditFrame(3));
    expect(snipeCtx.__haCanvasCalls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          method: "fillRect",
          args: [0, 0, 240, 240],
          fillStyle: "#f97316",
        }),
        expect.objectContaining({
          method: "fillText",
          args: ["BASS", 120, 120, expect.closeTo(211.2)],
        }),
      ]),
    );
    snipeCtx.__haCanvasCalls.length = 0;
    drawMoodFrame(9.5, makeCreditFrame(3));
    const snipeHoldText = snipeCtx.__haCanvasCalls.filter(
      (call) => call.method === "fillText" && call.args[0] === "BASS",
    );
    expect(snipeHoldText.filter((call) => call.fillStyle === "#09090b")).toHaveLength(4);
    expect(snipeHoldText.filter((call) => call.fillStyle === "#fafafa")).toHaveLength(1);

    snipeCtx.__haCanvasCalls.length = 0;
    drawMoodFrame(11, makeCreditFrame(3));
    expect(snipeCtx.__haCanvasCalls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          method: "fillRect",
          args: [0, 0, 240, 240],
          fillStyle: "#dc2626",
        }),
      ]),
    );
  });

  it.each([
    ["Cutout", 0],
    ["Scrawl", 1],
    ["Track-In", 2],
    ["Snipe", 3],
    ["Masthead", 4],
  ] as const)("keeps %s visible through enter, hold, and exit", (_name, styleIndex) => {
    for (const audioTime of [8.5, 9.5, styleIndex === 3 ? 11.01 : 11.5]) {
      __resetMoodRendererForTesting();
      const ctx = createRenderer("corners");
      drawMoodFrame(audioTime, makeCreditFrame(styleIndex));

      if (styleIndex === 0) {
        expect(
          ctx.__haCanvasCalls.some(
            (call) => call.method === "fillRect" && call.fillStyle === "#f97316",
          ),
        ).toBe(true);
      } else if (styleIndex === 1) {
        expect(
          ctx.__haCanvasCalls.filter((call) => call.method === "fillText"),
        ).toHaveLength(5);
      } else if (styleIndex === 2) {
        expect(
          ctx.__haCanvasCalls.some(
            (call) =>
              call.method === "fillRect" &&
              call.fillStyle === "#09090b" &&
              call.globalAlpha > 0 &&
              call.globalAlpha <= 0.4,
          ),
        ).toBe(true);
        expect(
          ctx.__haCanvasCalls.some((call) => {
            if (call.method !== "drawImage" || !(call.args[0] instanceof HTMLCanvasElement)) {
              return false;
            }
            const sourceCtx = call.args[0].getContext("2d") as CanvasRenderingContext2D & {
              __haCanvasCalls: CanvasCall[];
            };
            return sourceCtx.__haCanvasCalls.some(
              (sourceCall) => sourceCall.method === "fillText",
            );
          }),
        ).toBe(true);
      } else if (styleIndex === 3) {
        expect(
          ctx.__haCanvasCalls.some(
            (call) =>
              call.method === "fillText" ||
              (call.method === "fillRect" && call.fillStyle === "#dc2626"),
          ),
        ).toBe(true);
      } else {
        expect(
          ctx.__haCanvasCalls.some(
            (call) => call.method === "fillRect" && call.fillStyle === "#fafafa",
          ),
        ).toBe(true);
        expect(
          ctx.__haCanvasCalls.some(
            (call) => call.method === "fillText" && call.fillStyle === "#09090b",
          ),
        ).toBe(true);
      }
    }
  });

  it("draws Scrawl with full-name accretion and black/white contrast passes", () => {
    const ctx = createRenderer("corners");
    drawMoodFrame(8.5, makeCreditFrame(1));

    const enterText = ctx.__haCanvasCalls.filter(
      (call) => call.method === "fillText" && call.args[0] === "Ba",
    );
    expect(enterText.filter((call) => call.fillStyle === "#09090b")).toHaveLength(4);
    expect(enterText.filter((call) => call.fillStyle === "#fafafa")).toEqual([
      expect.objectContaining({
        args: ["Ba", 121, expect.closeTo(157.4), expect.closeTo(211.2)],
      }),
    ]);

    ctx.__haCanvasCalls.length = 0;
    drawMoodFrame(11.5, makeCreditFrame(1));
    expect(
      ctx.__haCanvasCalls.filter(
        (call) => call.method === "fillText" && call.args[0] === "Ba",
      ),
    ).toHaveLength(5);
  });

  it("accretes and strips Track-In slivers with a halo, wash, and fixed hold flash", () => {
    const ctx = createRenderer("corners");
    const frame = makeCreditFrame(2);

    drawMoodFrame(8.5, frame);

    const nameSlivers = ctx.__haCanvasCalls.filter((call) => {
      if (call.method !== "drawImage" || !(call.args[0] instanceof HTMLCanvasElement)) {
        return false;
      }
      const sourceCtx = call.args[0].getContext("2d") as CanvasRenderingContext2D & {
        __haCanvasCalls: CanvasCall[];
      };
      return sourceCtx.__haCanvasCalls.some((sourceCall) => sourceCall.method === "fillText");
    });
    expect(nameSlivers.length).toBeGreaterThan(1);
    expect(nameSlivers.every((call) => Number(call.args[3]) >= 2 && Number(call.args[3]) <= 4)).toBe(
      true,
    );
    const nameCtx = (nameSlivers[0].args[0] as HTMLCanvasElement).getContext("2d") as
      | (CanvasRenderingContext2D & { __haCanvasCalls: CanvasCall[] })
      | null;
    const nameDraws = nameCtx?.__haCanvasCalls.filter((call) => call.method === "fillText") ?? [];
    expect(nameDraws.filter((call) => call.fillStyle === "#09090b")).toHaveLength(16);
    expect(nameDraws.filter((call) => call.fillStyle === "#fafafa")).toHaveLength(4);
    expect(ctx.__haCanvasCalls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          method: "fillRect",
          args: [0, 0, 240, 240],
          fillStyle: "#09090b",
          globalAlpha: 0.4,
        }),
      ]),
    );

    ctx.__haCanvasCalls.length = 0;
    drawMoodFrame(9.12, frame);
    expect(ctx.__haCanvasCalls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          method: "fillRect",
          args: [0, 0, 240, 240],
          fillStyle: "#fafafa",
        }),
      ]),
    );

    ctx.__haCanvasCalls.length = 0;
    drawMoodFrame(9.13, frame);
    expect(
      ctx.__haCanvasCalls.some(
        (call) =>
          call.method === "fillRect" &&
          call.args.join(",") === "0,0,240,240" &&
          call.fillStyle === "#fafafa",
      ),
    ).toBe(false);

    ctx.__haCanvasCalls.length = 0;
    drawMoodFrame(11.5, frame);
    expect(
      ctx.__haCanvasCalls.some(
        (call) =>
          call.method === "fillRect" &&
          call.fillStyle === "#09090b" &&
          call.globalAlpha === 0.2,
      ),
    ).toBe(true);
    expect(
      ctx.__haCanvasCalls.filter((call) => call.method === "drawImage").length,
    ).toBeGreaterThan(1);
  });

  it("draws Masthead as a white top band with heavyweight type and a double rule", () => {
    // Masthead stays black-on-white under EVERY palette; heat proves it.
    const frame = makeCreditFrame(4);
    frame.piece.artDirection = {
      fxPreset: "neutral",
      creditPalette: "heat",
      source: "ai",
    };
    const ctx = createRenderer("corners");
    drawMoodFrame(9.5, frame);

    const mastheadFills = ctx.__haCanvasCalls.filter(
      (call) =>
        call.method === "fillRect" &&
        (call.fillStyle === "#fafafa" || call.fillStyle === "#09090b"),
    );
    expect(mastheadFills).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ fillStyle: "#fafafa", args: [0, 0, 240, 76] }),
        expect.objectContaining({ fillStyle: "#09090b", args: [0, 69, 240, 2] }),
        expect.objectContaining({ fillStyle: "#09090b", args: [0, 73, 240, 2] }),
      ]),
    );
    expect(ctx.__haCanvasCalls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          method: "fillText",
          args: ["BASS", 120, expect.any(Number), expect.closeTo(211.2)],
          fillStyle: "#09090b",
          font: expect.stringContaining("900 40px"),
        }),
      ]),
    );
  });

  it("draws Credits above the vibe, FX twins, and Drop flash", () => {
    createMoodWithCycle(4);
    const actions = useAppStore.getState().actions;
    actions.setMoodVibe("blocks");
    actions.setMoodCredits({ enabled: true });
    actions.setMoodCredits({ names: { "mic-0": "Bass" }, styleIndex: 0 });
    actions.commitMoodSelections([{ micId: "mic-0", entry: "the-one" }]);
    actions.setMoodPerforming(true, 10);
    armMoodDropCommit(true, 14, 13.5);
    moodFxVisualMocks.echoLevel = 0.4;
    const ctx = createRenderer("row");

    drawMoodFrame(14, currentRenderState());

    const fxIndex = ctx.__haCanvasCalls.findIndex(
      (call) => call.method === "drawImage" && call.args[1] === -4,
    );
    const flashIndex = ctx.__haCanvasCalls.findIndex(
      (call) =>
        call.method === "fillRect" &&
        call.fillStyle === DROP_FLASH_ACCENTS.blocks &&
        call.globalAlpha === 0.35,
    );
    const freezeIndex = ctx.__haCanvasCalls.findIndex(
      (call) => {
        if (
          call.method !== "drawImage" ||
          call.args.length !== 9 ||
          !(call.args[0] instanceof HTMLCanvasElement)
        ) {
          return false;
        }
        const sourceCtx = call.args[0].getContext("2d") as CanvasRenderingContext2D & {
          __haCanvasCalls: CanvasCall[];
        };
        if (
          call.args[0].width !== ctx.canvas.width ||
          call.args[0].height !== ctx.canvas.height
        ) {
          return false;
        }
        return sourceCtx.__haCanvasCalls.some(
          (sourceCall) =>
            sourceCall.method === "drawImage" &&
            sourceCall.args.length === 9 &&
            sourceCall.args[0] === ctx.canvas,
        );
      },
    );
    const nameIndex = ctx.__haCanvasCalls.findIndex((call) => call.method === "fillText");
    const snapshot = ctx.__haCanvasCalls[freezeIndex].args[0] as HTMLCanvasElement;
    const snapshotCtx = snapshot.getContext("2d") as CanvasRenderingContext2D;
    const snapshotOrder = vi.mocked(snapshotCtx.drawImage).mock.invocationCallOrder[0];
    const fxCallIndex = vi
      .mocked(ctx.drawImage)
      .mock.calls.findIndex((call) => call[1] === -4);
    const fxOrder = vi.mocked(ctx.drawImage).mock.invocationCallOrder[fxCallIndex];
    const freezeCallIndex = vi
      .mocked(ctx.drawImage)
      .mock.calls.findIndex((call) => call[0] === snapshot);
    const freezeOrder = vi.mocked(ctx.drawImage).mock.invocationCallOrder[freezeCallIndex];
    expect(fxIndex).toBeGreaterThanOrEqual(0);
    expect(flashIndex).toBeGreaterThan(fxIndex);
    expect(freezeIndex).toBeGreaterThan(flashIndex);
    expect(nameIndex).toBeGreaterThan(freezeIndex);
    expect(snapshotOrder).toBeLessThan(fxOrder);
    expect(fxOrder).toBeLessThan(freezeOrder);
  });

  it.each(["preparing", "countdown", "recording", "reviewing"] as const)(
    "never opens a Credit window while recording.state is %s",
    (recordingState) => {
      useAppStore.getState().actions.setRecordingState(recordingState, null);
      const ctx = createRenderer("corners");

      drawMoodFrame(8.5, makeCreditFrame());

      expect(
        ctx.__haCanvasCalls.some(
          (call) => call.method === "fillText" || call.method === "strokeText",
        ),
      ).toBe(false);
      expect(
        ctx.__haCanvasCalls.some(
          (call) =>
            call.method === "drawImage" &&
            call.args.length === 9 &&
            call.args[0] instanceof HTMLCanvasElement,
        ),
      ).toBe(false);
    },
  );

  function makePrintFrame(): { piece: MoodPiece; performanceState: MoodPerformanceState } {
    const piece: MoodPiece = { ...createEmptyMoodPiece("corners", "pocket"), vibe: "print" };
    const performanceState: MoodPerformanceState = {
      isPerforming: false,
      epoch: null,
      selections: {
        "mic-0": "off",
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
      armedLens: null,
      armedDropActive: null,
      dropActive: false,
      hotMicId: null,
      cycleCount: 0,
    };
    return { piece, performanceState };
  }

  it("degrades Print for the session after a window of over-budget frames", () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => undefined);
    let clock = 0;
    vi.spyOn(globalThis.performance, "now").mockImplementation(() => (clock += 13));
    const { piece, performanceState } = makePrintFrame();
    createRenderer("corners");

    for (let i = 0; i < PRINT_WATCHDOG_WINDOW_FRAMES; i++) {
      drawMoodFrame(0, { piece, performance: performanceState });
    }

    expect(getPrintDensity()).toBe("degraded");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      LOG_EVENTS.MOOD_PRINT_DEGRADED,
      expect.objectContaining({ budgetMs: PRINT_FRAME_BUDGET_MS }),
    );

    // Session-scoped: the tripped watchdog never re-measures or re-logs.
    for (let i = 0; i < PRINT_WATCHDOG_WINDOW_FRAMES; i++) {
      drawMoodFrame(0, { piece, performance: performanceState });
    }
    expect(warn).toHaveBeenCalledTimes(1);
    expect(getPrintDensity()).toBe("degraded");
  });

  it("keeps Print at normal density while frames fit the budget", () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => undefined);
    let clock = 0;
    vi.spyOn(globalThis.performance, "now").mockImplementation(() => (clock += 0.01));
    const { piece, performanceState } = makePrintFrame();
    createRenderer("corners");

    for (let i = 0; i < PRINT_WATCHDOG_WINDOW_FRAMES * 2; i++) {
      drawMoodFrame(0, { piece, performance: performanceState });
    }

    expect(getPrintDensity()).toBe("normal");
    expect(warn).not.toHaveBeenCalled();
    // 120 frames through the 128-cell lattice stub run close to the default
    // 5s budget under a loaded parallel suite.
  }, 15_000);

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
      armedLens: null,
      armedDropActive: null,
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

  describe("Splits lens", () => {
    function fillRectArgs(ctx: { __haCanvasCalls: CanvasCall[] }): unknown[][] {
      return ctx.__haCanvasCalls
        .filter((call) => call.method === "fillRect")
        .map((call) => call.args);
    }

    it("hard-cuts re-tiles only when the armed lens commit reaches the boundary", async () => {
      const actions = useAppStore.getState().actions;
      actions.createMoodPiece("corners", "pocket");
      actions.setMoodTake("mic-0", makeMoodTake({ id: "the-one", durationSeconds: 2 }));
      actions.setMoodTake("mic-1", makeMoodTake({ id: "take-b" }));
      actions.commitMoodSelections([{ micId: "mic-0", entry: "the-one" }]);
      actions.setAppMode("mood");
      const ctx = createRenderer("corners");
      toneHarness.setImmediate(10);
      await startMoodPerformance();
      armMoodLensCommit("splits", 12, 10);

      const boundaryCallback = toneHarness.transport.scheduleRepeat.mock.calls[0]?.[0];
      boundaryCallback?.(12);

      ctx.__haCanvasCalls.length = 0;
      drawMoodFrame(11.99, currentRenderState());
      expect(useAppStore.getState().mood.piece?.lens).toBe("wall");
      expect(fillRectArgs(ctx)).toEqual(
        expect.arrayContaining([
          [0, 0, 240, 240],
          [240, 0, 240, 240],
          [0, 240, 240, 240],
          [240, 240, 240, 240],
        ]),
      );

      ctx.__haCanvasCalls.length = 0;
      drawMoodFrame(12, currentRenderState());

      expect(useAppStore.getState().mood.piece?.lens).toBe("splits");
      expect(fillRectArgs(ctx)).toEqual(expect.arrayContaining([[0, 0, 480, 480]]));
      expect(fillRectArgs(ctx)).not.toEqual(
        expect.arrayContaining([
          [0, 0, 240, 240],
          [240, 0, 240, 240],
          [0, 240, 240, 240],
          [240, 240, 240, 240],
        ]),
      );
    });

    it("renders the Corners three-live asymmetric Splits layout", () => {
      const basePiece = createEmptyMoodPiece("corners", "pocket");
      const piece: MoodPiece = {
        ...basePiece,
        lens: "splits",
        mics: basePiece.mics.map((mic, index) =>
          index < 3 ? { ...mic, takes: [makeMoodTake({ id: `take-${index}` })] } : mic,
        ),
      };
      const performance: MoodPerformanceState = {
        isPerforming: false,
        epoch: null,
        selections: {
          "mic-0": "take-0",
          "mic-1": "take-1",
          "mic-2": "take-2",
          "mic-3": "off",
        },
        armed: {
          "mic-0": null,
          "mic-1": null,
          "mic-2": null,
          "mic-3": null,
        },
        armedLens: null,
        armedDropActive: null,
        dropActive: false,
        hotMicId: null,
        cycleCount: 0,
      };
      const ctx = createRenderer("corners");

      drawMoodFrame(1, { piece, performance });

      expect(fillRectArgs(ctx)).toEqual(
        expect.arrayContaining([
          [0, 0, 240, 480],
          [240, 0, 240, 240],
          [240, 240, 240, 240],
        ]),
      );
      expect(fillRectArgs(ctx)).not.toEqual(
        expect.arrayContaining([[0, 240, 240, 240]]),
      );
    });
  });

  describe("Solo lens", () => {
    function soloFrame(epoch: number | null): {
      piece: MoodPiece;
      performance: MoodPerformanceState;
    } {
      const basePiece = createEmptyMoodPiece("corners", "pocket");
      const piece: MoodPiece = {
        ...basePiece,
        cycleSeconds: 2,
        lens: "solo",
        mics: basePiece.mics.map((mic, index) =>
          index < 3
            ? {
                ...mic,
                takes: [
                  makeMoodTake({
                    id: `take-${index}`,
                    posterUrl: `blob:test/solo-${index}`,
                  }),
                ],
              }
            : mic,
        ),
      };
      return {
        piece,
        performance: {
          isPerforming: epoch !== null,
          epoch,
          selections: {
            "mic-0": "take-0",
            "mic-1": "take-1",
            "mic-2": "take-2",
            "mic-3": "off",
          },
          armed: {
            "mic-0": null,
            "mic-1": null,
            "mic-2": null,
            "mic-3": null,
          },
          armedLens: null,
          armedDropActive: null,
          dropActive: false,
          hotMicId: null,
          cycleCount: 999,
        },
      };
    }

    function renderedPosterSources(ctx: { __haCanvasCalls: CanvasCall[] }): unknown[] {
      return ctx.__haCanvasCalls
        .filter((call) => call.method === "drawImage")
        .map((call) => (call.args[0] as { src?: unknown }).src)
        .filter((source) => typeof source === "string");
    }

    it("rotates the featured live mic on the audio-clock cycle boundary", () => {
      const ctx = createRenderer("corners");
      const frame = soloFrame(10);

      drawMoodFrame(11.999, frame);
      expect(renderedPosterSources(ctx)).toEqual(["blob:test/solo-0"]);

      ctx.__haCanvasCalls.length = 0;
      drawMoodFrame(12, frame);
      expect(renderedPosterSources(ctx)).toEqual(["blob:test/solo-1"]);

      ctx.__haCanvasCalls.length = 0;
      drawMoodFrame(14, frame);
      expect(renderedPosterSources(ctx)).toEqual(["blob:test/solo-2"]);
    });

    it("pins credited Solo positions in mic order from each exact window start", () => {
      const ctx = createRenderer("corners");
      const frame = soloFrame(10);
      frame.piece.credits = {
        enabled: true,
        names: {
          "mic-0": "Bass",
          "mic-1": "Snare",
          "mic-2": "Voice",
        },
        styleIndex: 0,
      };

      drawMoodFrame(12, frame);
      expect(renderedPosterSources(ctx)).toEqual(["blob:test/solo-0"]);

      ctx.__haCanvasCalls.length = 0;
      drawMoodFrame(14, frame);
      expect(renderedPosterSources(ctx)).toEqual(["blob:test/solo-0"]);

      ctx.__haCanvasCalls.length = 0;
      drawMoodFrame(14.4, frame);
      expect(renderedPosterSources(ctx)).toEqual(["blob:test/solo-1"]);
    });

    it("falls back to the first live mic while stopped instead of store cycleCount", () => {
      const ctx = createRenderer("corners");

      drawMoodFrame(99, soloFrame(null));

      expect(renderedPosterSources(ctx)).toEqual(["blob:test/solo-0"]);
    });
  });

  describe("capture render state", () => {
    function capturePiece(): MoodPiece {
      const piece = createEmptyMoodPiece("corners", "pocket");
      const oneTake = makeMoodTake({
        id: "the-one",
        posterUrl: "blob:test/the-one-poster",
        recordedAt: 10,
      });
      const hotTake = makeMoodTake({
        id: "hot-live",
        posterUrl: "blob:test/hot-live-poster",
        recordedAt: 20,
      });
      const offTake = makeMoodTake({
        id: "off-last",
        posterUrl: "blob:test/off-last-poster",
        recordedAt: 30,
      });
      return {
        ...piece,
        cycleSeconds: 2,
        oneMicId: "mic-0",
        oneTakeId: "the-one",
        mics: piece.mics.map((mic, index) => {
          if (index === 0) return { ...mic, takes: [oneTake] };
          if (index === 1) return { ...mic, takes: [hotTake] };
          if (index === 2) return { ...mic, takes: [offTake] };
          return mic;
        }),
      };
    }

    function capturePerformance(): MoodPerformanceState {
      return {
        isPerforming: true,
        epoch: 0,
        selections: {
          "mic-0": "the-one",
          "mic-1": "hot-live",
          "mic-2": "off",
          "mic-3": "off",
        },
        armed: {
          "mic-0": null,
          "mic-1": null,
          "mic-2": null,
          "mic-3": null,
        },
        armedLens: null,
        armedDropActive: null,
        dropActive: false,
        hotMicId: "mic-1",
        cycleCount: 0,
      };
    }

    function primeCapturePreview(): HTMLVideoElement {
      const stream = new MediaStream();
      setMoodRecordingPreviewStream(stream);
      drawMoodFrame(1, {
        piece: capturePiece(),
        performance: capturePerformance(),
      });
      const preview = __getMoodRendererPreviewVideoForTesting();
      if (!preview) throw new Error("expected a capture preview video");
      setVideoFrameState(preview, {
        readyState: 2,
        seeking: false,
        width: 640,
        height: 480,
      });
      return preview;
    }

    it("replays an unchanged capture preview stream when its video is paused", () => {
      createRenderer("corners");
      useAppStore.getState().actions.setRecordingState("countdown", null);
      const preview = primeCapturePreview();
      const play = vi.spyOn(preview, "play").mockResolvedValue(undefined);
      Object.defineProperty(preview, "paused", { configurable: true, value: true });

      drawMoodFrame(1.1, {
        piece: capturePiece(),
        performance: capturePerformance(),
      });

      expect(play).toHaveBeenCalledTimes(1);
    });

    it("draws a five-mic Row capture preview into the exact hot mic-4 wall rect", () => {
      const ctx = createRenderer("row");
      const piece = createEmptyMoodPiece("row", "pocket");
      const oneTake = makeMoodTake({ id: "row-one", posterUrl: "blob:test/row-one" });
      const renderPiece: MoodPiece = {
        ...piece,
        cycleSeconds: 2,
        oneMicId: "mic-0",
        oneTakeId: oneTake.id,
        mics: Array.from({ length: 5 }, (_, index) => ({
          id: `mic-${index}`,
          takes: index === 0 ? [oneTake] : [],
        })),
      };
      const performance: MoodPerformanceState = {
        isPerforming: true,
        epoch: 0,
        selections: Object.fromEntries(
          renderPiece.mics.map((mic, index) => [mic.id, index === 0 ? oneTake.id : "off"]),
        ),
        armed: Object.fromEntries(renderPiece.mics.map((mic) => [mic.id, null])),
        armedLens: null,
        armedDropActive: null,
        dropActive: false,
        hotMicId: "mic-4",
        cycleCount: 0,
      };
      useAppStore.getState().actions.setRecordingState("countdown", null);
      setMoodRecordingPreviewStream(new MediaStream());
      drawMoodFrame(1, { piece: renderPiece, performance });
      const preview = __getMoodRendererPreviewVideoForTesting();
      if (!preview) throw new Error("expected row capture preview");
      setVideoFrameState(preview, {
        readyState: 2,
        seeking: false,
        width: 640,
        height: 480,
      });

      ctx.__haCanvasCalls.length = 0;
      drawMoodFrame(1.1, { piece: renderPiece, performance });

      const previewDraw = ctx.__haCanvasCalls.find(
        (call) => call.method === "drawImage" && call.args[0] === preview,
      );
      expect(previewDraw?.args.slice(-4)).toEqual([684, 0, 170, 480]);
    });

    it("draws hot preview, frozen posters, and the no-headphones B&W metronome", () => {
      const ctx = createRenderer("corners");
      const piece = capturePiece();
      const performance = capturePerformance();
      useAppStore.getState().actions.setRecordingState("countdown", null);
      const preview = primeCapturePreview();
      syncPool([
        { takeId: "the-one", url: "blob:test/the-one", loopStart: 0, loopEnd: 2 },
      ]);
      const metronomeVideo = videoForTake("the-one");
      if (!metronomeVideo) throw new Error("expected metronome video");
      setVideoFrameState(metronomeVideo, {
        readyState: 2,
        seeking: false,
        width: 640,
        height: 480,
      });

      ctx.__haCanvasCalls.length = 0;
      drawMoodFrame(1.1, { piece, performance });

      const imageCalls = ctx.__haCanvasCalls.filter((call) => call.method === "drawImage");
      expect(preview.muted).toBe(true);
      expect(preview.playsInline).toBe(true);
      expect(preview.autoplay).toBe(true);
      expect(imageCalls.some((call) => call.args[0] === preview)).toBe(true);
      expect(imageCalls.some((call) => call.args[0] === metronomeVideo)).toBe(true);
      expect(imageCalls.some((call) => call.args[0] === videoForTake("hot-live"))).toBe(false);

      const frozenPosterDraws = imageCalls.filter(
        (call) =>
          call.args[0] !== preview &&
          call.args[0] !== metronomeVideo &&
          call.globalAlpha > 0 &&
          call.globalAlpha < 0.28,
      );
      expect(frozenPosterDraws.length).toBeGreaterThan(0);

      expect(ctx.__haCanvasCalls).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            method: "rect",
            args: [0, 0, 240, 240],
          }),
          expect.objectContaining({
            method: "clip",
            args: [],
          }),
          expect.objectContaining({
            method: "fillRect",
            args: [0, 0, 240, 240],
            globalCompositeOperation: "saturation",
          }),
        ]),
      );
    });

    it("forces the Solo capture frame to feature the hot mic full-bleed", () => {
      const ctx = createRenderer("corners");
      const piece: MoodPiece = { ...capturePiece(), lens: "solo" };
      const performance = capturePerformance();
      useAppStore.getState().actions.setRecordingState("countdown", null);
      const preview = primeCapturePreview();

      ctx.__haCanvasCalls.length = 0;
      drawMoodFrame(1.1, { piece, performance });

      const previewDraw = ctx.__haCanvasCalls.find(
        (call) => call.method === "drawImage" && call.args[0] === preview,
      );
      expect(previewDraw?.args.slice(-4)).toEqual([0, 0, 480, 480]);
    });

    it.each(["blocks", "kaleido", "ghost"] as const)(
      "suspends the %s vibe pass while a capture is active",
      (vibe) => {
        const ctx = createRenderer("corners");
        const piece: MoodPiece = { ...capturePiece(), vibe };
        const performance: MoodPerformanceState = {
          ...capturePerformance(),
          dropActive: true,
        };
        useAppStore.getState().actions.setRecordingState("recording", null);
        primeCapturePreview();

        // Performing with the Drop on: the capture presentation (frozen band,
        // B&W metronome, hot preview) must stay vibe-free — §7's reserved
        // B&W grammar wins over the full-canvas pass during the take window.
        ctx.__haCanvasCalls.length = 0;
        drawMoodFrame(1.1, { piece, performance });
        const vibeDraws = ctx.__haCanvasCalls.filter(
          (call) =>
            call.method === "drawImage" && call.args[0] instanceof HTMLCanvasElement,
        );
        expect(vibeDraws).toHaveLength(0);

        // Recording the One while stopped (wardrobe would otherwise preview).
        const stoppedPerformance: MoodPerformanceState = {
          ...capturePerformance(),
          isPerforming: false,
          epoch: null,
          dropActive: false,
        };
        ctx.__haCanvasCalls.length = 0;
        drawMoodFrame(1.2, { piece, performance: stoppedPerformance });
        const stoppedVibeDraws = ctx.__haCanvasCalls.filter(
          (call) =>
            call.method === "drawImage" && call.args[0] instanceof HTMLCanvasElement,
        );
        expect(stoppedVibeDraws).toHaveLength(0);
      },
    );

    it("freezes every non-hot tile and skips the metronome when headphones are on", () => {
      const ctx = createRenderer("corners");
      const piece = capturePiece();
      const performance = capturePerformance();
      useAppStore.getState().actions.setMonitorWithHeadphones(true);
      useAppStore.getState().actions.setRecordingState("countdown", null);
      const preview = primeCapturePreview();
      syncPool([
        { takeId: "the-one", url: "blob:test/the-one", loopStart: 0, loopEnd: 2 },
      ]);
      const metronomeVideo = videoForTake("the-one");
      if (!metronomeVideo) throw new Error("expected metronome video");
      setVideoFrameState(metronomeVideo, {
        readyState: 2,
        seeking: false,
        width: 640,
        height: 480,
      });

      ctx.__haCanvasCalls.length = 0;
      drawMoodFrame(1.1, { piece, performance });

      const imageCalls = ctx.__haCanvasCalls.filter((call) => call.method === "drawImage");
      expect(imageCalls.some((call) => call.args[0] === preview)).toBe(true);
      expect(imageCalls.some((call) => call.args[0] === metronomeVideo)).toBe(false);
      expect(
        ctx.__haCanvasCalls.some(
          (call) => call.globalCompositeOperation === "saturation",
        ),
      ).toBe(false);
      expect(
        imageCalls.filter(
          (call) => call.args[0] !== preview && call.globalAlpha > 0 && call.globalAlpha < 0.28,
        ).length,
      ).toBeGreaterThanOrEqual(2);
    });

    it("derives the metronome mic from the One, then falls back to the earliest surviving take", () => {
      const piece = capturePiece();
      expect(deriveMoodMetronomeMicId(piece)).toBe("mic-0");

      const fallbackPiece: MoodPiece = {
        ...piece,
        oneMicId: null,
        oneTakeId: null,
        mics: piece.mics.map((mic) => {
          if (mic.id === "mic-0") return { ...mic, takes: [] };
          if (mic.id === "mic-1") {
            return {
              ...mic,
              takes: [makeMoodTake({ id: "oldest", recordedAt: 2 })],
            };
          }
          if (mic.id === "mic-2") {
            return {
              ...mic,
              takes: [makeMoodTake({ id: "newer", recordedAt: 5 })],
            };
          }
          return mic;
        }),
      };
      expect(deriveMoodMetronomeMicId(fallbackPiece)).toBe("mic-1");
    });

    it("clips drawDesaturated compositing to one tile without ctx.filter", () => {
      const ctx = createRenderer("corners");
      const image = new Image();
      ctx.__haCanvasCalls.length = 0;

      drawDesaturated(ctx, { micId: "mic-2", x: 11, y: 22, w: 33, h: 44 }, () => {
        ctx.drawImage(image, 11, 22, 33, 44);
      });

      expect(ctx.__haCanvasCalls).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ method: "beginPath", args: [] }),
          expect.objectContaining({ method: "rect", args: [11, 22, 33, 44] }),
          expect.objectContaining({ method: "clip", args: [] }),
          expect.objectContaining({
            method: "fillRect",
            args: [11, 22, 33, 44],
            globalCompositeOperation: "saturation",
          }),
        ]),
      );
      expect(ctx.__haCanvasCalls.map((call) => call.method)).not.toContain("filter");
    });
  });
});
