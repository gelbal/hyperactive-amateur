// ABOUTME: Mood credit engine tests pin deterministic pass scheduling and frozen text entries.
// ABOUTME: Keeps cadence, modes, audio-clock phases, aborts, and display recipes deterministic.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  MoodPerformanceState,
  MoodPiece,
  MoodSelectionEntry,
  RecordingState,
} from "../types";
import { makeMoodTake } from "../test-utils/moodFixtures";
import { clearLogs, getLogs, LOG_EVENTS } from "./logger";
import { createEmptyMoodPiece } from "./moodStages";
import { fontSizeFor, trackInFontSizeFor } from "./moodCreditStyles";
import {
  CREDITS_PASS_GAP_SECONDS,
  CREDIT_STYLES,
  CREDIT_WINDOW_BEATS,
  CREDIT_WINDOW_MIN_SECONDS,
  MIN_CREDIT_FONT_PX,
  MOOD_CREDIT_PALETTES,
  clampCreditStyleIndex,
  creditPhase,
  creditWindowSeconds,
  drawMoodCredits,
  easeInCubic,
  easeOutCubic,
  featuredMoodCreditMicId,
  initMoodCreditResources,
  prepareMoodCredits,
} from "./moodCredits";

type CreditFrame = {
  piece: MoodPiece;
  performance: MoodPerformanceState;
  rects: Array<{ micId: string; x: number; y: number; w: number; h: number }>;
};

function schedulerFrame(
  liveMicIds: readonly string[],
  namedMicIds: readonly string[] = ["mic-0", "mic-1"],
  epoch = 0,
  rectMicIds: readonly string[] = liveMicIds,
  cycleSeconds = 8,
): CreditFrame {
  const base = createEmptyMoodPiece("corners", "pocket");
  const takes = new Map(
    base.mics.map((mic) => [mic.id, makeMoodTake({ id: `take-${mic.id}` })]),
  );
  const selections = Object.fromEntries(
    base.mics.map((mic) => [
      mic.id,
      liveMicIds.includes(mic.id) ? takes.get(mic.id)!.id : "off",
    ]),
  ) as Record<string, MoodSelectionEntry>;

  return {
    piece: {
      ...base,
      cycleSeconds,
      credits: {
        enabled: true,
        names: Object.fromEntries(namedMicIds.map((micId) => [micId, micId])),
        styleIndex: 0,
      },
      mics: base.mics.map((mic) => ({ ...mic, takes: [takes.get(mic.id)!] })),
    },
    performance: {
      isPerforming: true,
      epoch,
      selections,
      armed: Object.fromEntries(base.mics.map((mic) => [mic.id, null])),
      armedLens: null,
      armedDropActive: null,
      dropActive: true,
      hotMicId: null,
      cycleCount: 0,
    },
    rects: rectMicIds.map((micId, index) => ({
      micId,
      x: index * 120,
      y: 0,
      w: 120,
      h: 120,
    })),
  };
}

function prepareFrame(
  resources: ReturnType<typeof initMoodCreditResources>,
  frame: CreditFrame,
  audioTime: number,
  recordingState: RecordingState = "idle",
): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = 480;
  canvas.height = 480;
  prepareMoodCredits(
    canvas,
    frame.piece,
    frame.performance,
    frame.rects,
    audioTime,
    recordingState,
    resources,
  );
  return canvas;
}

function windowLogs() {
  return getLogs().filter((entry) => entry.event === LOG_EVENTS.MOOD_CREDIT_WINDOW);
}

function skipLogs(reason?: string) {
  return getLogs().filter(
    (entry) =>
      entry.event === LOG_EVENTS.MOOD_CREDIT_SKIP &&
      (reason === undefined || (entry.payload as { reason?: string }).reason === reason),
  );
}

describe("moodCredits", () => {
  beforeEach(() => {
    clearLogs();
    vi.spyOn(console, "info").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("schedules one sequence pass in mic order with back-to-back windows at cycle 1", () => {
    const resources = initMoodCreditResources({ w: 480, h: 480 });
    const frame = schedulerFrame(
      ["mic-0", "mic-1", "mic-2"],
      ["mic-0", "mic-1", "mic-2"],
    );

    prepareFrame(resources, frame, 8);
    expect(resources.nextWindow).toMatchObject({
      kind: "sequence",
      micId: "mic-0",
      passIndex: 0,
      position: 0,
      castSize: 3,
      windowStart: 8,
    });
    expect(resources.activeWindow?.entries.map((entry) => entry.micId)).toEqual(["mic-0"]);

    prepareFrame(resources, frame, 12);
    expect(resources.nextWindow).toMatchObject({
      kind: "sequence",
      micId: "mic-1",
      passIndex: 0,
      position: 1,
      windowStart: 12,
    });

    prepareFrame(resources, frame, 16);
    expect(resources.nextWindow).toMatchObject({
      kind: "sequence",
      micId: "mic-2",
      passIndex: 0,
      position: 2,
      windowStart: 16,
    });

    expect(
      windowLogs().map((entry) => entry.payload),
    ).toEqual([
      expect.objectContaining({ kind: "sequence", micId: "mic-0", passIndex: 0, position: 0 }),
      expect.objectContaining({ kind: "sequence", micId: "mic-1", passIndex: 0, position: 1 }),
      expect.objectContaining({ kind: "sequence", micId: "mic-2", passIndex: 0, position: 2 }),
    ]);
  });

  it("starts the next pass at the first cycle boundary at least 18 seconds after pass end", () => {
    const resources = initMoodCreditResources({ w: 480, h: 480 });
    const frame = schedulerFrame(["mic-0", "mic-1"], ["mic-0", "mic-1"]);

    expect(CREDITS_PASS_GAP_SECONDS).toBe(18);
    prepareFrame(resources, frame, 8);
    prepareFrame(resources, frame, 12);
    prepareFrame(resources, frame, 16);
    expect(resources.lastPassEndTime).toBe(16);

    prepareFrame(resources, frame, 24);
    expect(resources.nextWindow).toBeNull();
    prepareFrame(resources, frame, 32);
    expect(resources.nextWindow).toBeNull();
    prepareFrame(resources, frame, 40);
    expect(resources.nextWindow).toMatchObject({
      kind: "sequence",
      passIndex: 1,
      position: 0,
      windowStart: 40,
    });
  });

  it("freezes and paints every together entry in one window", () => {
    const resources = initMoodCreditResources({ w: 480, h: 480 });
    const frame = schedulerFrame(
      ["mic-0", "mic-1", "mic-2"],
      ["mic-0", "mic-1", "mic-2"],
    );
    frame.piece.credits!.mode = "together";

    const canvas = prepareFrame(resources, frame, 8);

    expect(resources.nextWindow).toMatchObject({
      kind: "together",
      micIds: ["mic-0", "mic-1", "mic-2"],
      passIndex: 0,
      position: 0,
      castSize: 3,
      windowStart: 8,
    });
    expect(resources.activeWindow?.entries.map((entry) => entry.micId)).toEqual([
      "mic-0",
      "mic-1",
      "mic-2",
    ]);
    expect(resources.snapshotCtx?.drawImage).toHaveBeenCalledTimes(3);

    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("expected canvas context");
    vi.mocked(ctx.drawImage).mockClear();
    drawMoodCredits(ctx, 8.5, resources);
    expect(ctx.drawImage).toHaveBeenCalledTimes(3);
    expect(windowLogs()).toEqual([
      expect.objectContaining({
        payload: expect.objectContaining({
          kind: "together",
          micIds: ["mic-0", "mic-1", "mic-2"],
          passIndex: 0,
          position: 0,
          castSize: 3,
        }),
      }),
    ]);
  });

  it("degrades Together to sequence under Solo without changing the piece setting", () => {
    const resources = initMoodCreditResources({ w: 480, h: 480 });
    const frame = schedulerFrame(["mic-0", "mic-1"], ["mic-0", "mic-1"]);
    frame.piece.lens = "solo";
    frame.piece.credits!.mode = "together";

    prepareFrame(resources, frame, 8);

    expect(frame.piece.credits!.mode).toBe("together");
    expect(resources.nextWindow).toMatchObject({
      kind: "sequence",
      micId: "mic-0",
      position: 0,
    });
    expect(resources.activeWindow?.entries).toHaveLength(1);
  });

  it("aborts the whole pass once when capture vetoes a prepared window", () => {
    const resources = initMoodCreditResources({ w: 480, h: 480 });
    const frame = schedulerFrame(["mic-0", "mic-1"], ["mic-0", "mic-1"]);

    prepareFrame(resources, frame, 8);
    prepareFrame(resources, frame, 8.1, "recording");

    expect(resources.activePass).toBeNull();
    expect(resources.nextWindow).toBeNull();
    expect(resources.activeWindow).toBeNull();
    expect(resources.lastPassEndTime).toBe(8.1);
    expect(skipLogs("capture-veto")).toEqual([
      expect.objectContaining({
        payload: expect.objectContaining({
          kind: "sequence",
          micId: "mic-0",
          passIndex: 0,
          position: 0,
        }),
      }),
    ]);

    prepareFrame(resources, frame, 16, "recording");
    expect(resources.nextWindow).toBeNull();
    expect(skipLogs("capture-veto")).toHaveLength(1);
  });

  it("leaves an un-live pass position as a silent mic-not-live gap", () => {
    const resources = initMoodCreditResources({ w: 480, h: 480 });
    const frame = schedulerFrame(["mic-0", "mic-1"], ["mic-0", "mic-1"]);

    prepareFrame(resources, frame, 8);
    frame.performance.selections["mic-1"] = "off";
    prepareFrame(resources, frame, 12);

    expect(resources.nextWindow).toMatchObject({
      micId: "mic-1",
      position: 1,
      windowStart: 12,
    });
    expect(resources.activeWindow).toBeNull();
    expect(skipLogs("mic-not-live")).toEqual([
      expect.objectContaining({
        payload: expect.objectContaining({
          kind: "sequence",
          micId: "mic-1",
          passIndex: 0,
          position: 1,
        }),
      }),
    ]);

    prepareFrame(resources, frame, 13);
    expect(skipLogs("mic-not-live")).toHaveLength(1);
    prepareFrame(resources, frame, 16);
    expect(resources.lastPassEndTime).toBe(16);
  });

  it("pins each Solo pass position from its exact scheduled window start", () => {
    const resources = initMoodCreditResources({ w: 480, h: 480 });
    const frame = schedulerFrame(
      ["mic-0", "mic-1", "mic-2"],
      ["mic-0", "mic-1", "mic-2"],
    );
    frame.piece.lens = "solo";

    prepareFrame(resources, frame, 8);
    expect(featuredMoodCreditMicId(resources, 7.999)).toBeNull();
    expect(featuredMoodCreditMicId(resources, 8)).toBe("mic-0");
    expect(featuredMoodCreditMicId(resources, 11.999)).toBe("mic-0");

    prepareFrame(resources, frame, 12);
    expect(featuredMoodCreditMicId(resources, 12)).toBe("mic-1");
    expect(featuredMoodCreditMicId(resources, 15.999)).toBe("mic-1");

    prepareFrame(resources, frame, 16);
    expect(featuredMoodCreditMicId(resources, 16)).toBe("mic-2");
  });

  it("aborts only a rect-changed window and keeps the pass timeline marching", () => {
    const resources = initMoodCreditResources({ w: 480, h: 480 });
    const frame = schedulerFrame(["mic-0", "mic-1"], ["mic-0", "mic-1"]);
    prepareFrame(resources, frame, 8);

    frame.rects[0] = { ...frame.rects[0], w: 119 };
    prepareFrame(resources, frame, 8.5);
    expect(resources.activeWindow).toBeNull();
    expect(resources.activePass).not.toBeNull();
    expect(skipLogs("rect-changed")).toHaveLength(1);

    prepareFrame(resources, frame, 12);
    expect(resources.nextWindow).toMatchObject({ micId: "mic-1", position: 1 });
    expect(resources.activeWindow?.entries[0].micId).toBe("mic-1");
  });

  it("skips an empty eligible cast silently and retries at the next boundary", () => {
    const resources = initMoodCreditResources({ w: 480, h: 480 });
    const empty = schedulerFrame([], ["mic-0"]);

    prepareFrame(resources, empty, 8);
    expect(resources.nextWindow).toBeNull();
    expect(resources.lastPassEndTime).toBeNull();
    expect(getLogs()).toEqual([]);

    const live = schedulerFrame(["mic-0"], ["mic-0"]);
    prepareFrame(resources, live, 16);
    expect(resources.nextWindow).toMatchObject({ micId: "mic-0", windowStart: 16 });
  });

  it("holds one floor-length sequence window across short-loop boundaries", () => {
    const resources = initMoodCreditResources({ w: 480, h: 480 });
    const frame = schedulerFrame(
      ["mic-0", "mic-1"],
      ["mic-0", "mic-1"],
      0,
      ["mic-0", "mic-1"],
      1,
    );

    prepareFrame(resources, frame, 1);
    expect(resources.nextWindow).toMatchObject({ micId: "mic-0", windowStart: 1 });
    prepareFrame(resources, frame, 2);
    expect(resources.nextWindow).toMatchObject({ micId: "mic-0", windowStart: 1 });
    prepareFrame(resources, frame, 3.4);
    expect(resources.nextWindow).toMatchObject({ micId: "mic-1", windowStart: 3.4 });
  });

  it("truncates display text once per entry without changing persisted names", () => {
    const resources = initMoodCreditResources({ w: 480, h: 480 });
    const frame = schedulerFrame(["mic-0"], ["mic-0"]);
    const original = "abcdefghijklmnopqrstuvwx";
    frame.piece.credits!.names["mic-0"] = original;

    prepareFrame(resources, frame, 8);

    expect(MIN_CREDIT_FONT_PX).toBe(14);
    expect(resources.activeWindow?.entries[0]).toMatchObject({
      name: original,
      upperName: original.toUpperCase(),
      displayName: "abcdefghij…",
      displayUpper: "ABCDEFGHIJ…",
    });
    expect(frame.piece.credits!.names["mic-0"]).toBe(original);
  });

  it("pins cubic easing at the endpoints and midpoint", () => {
    expect(easeOutCubic(0)).toBe(0);
    expect(easeOutCubic(0.5)).toBe(0.875);
    expect(easeOutCubic(0.999)).toBeCloseTo(0.999999999, 9);
    expect(easeOutCubic(1)).toBe(1);
    expect(easeInCubic(0)).toBe(0);
    expect(easeInCubic(0.5)).toBe(0.125);
    expect(easeInCubic(0.999)).toBeCloseTo(0.997002999, 9);
    expect(easeInCubic(1)).toBe(1);
  });

  it("sizes Track-In against its real tracked character pitch", () => {
    const rect = { micId: "mic-0", x: 0, y: 0, w: 120, h: 120 };

    expect(fontSizeFor(rect, "LONGNAME", 0.16)).toBe(19);
    expect(trackInFontSizeFor(rect, "LONGNAME", 0.16)).toBe(14);
  });

  it("derives 1:2:1 phases from one shared seconds window with a floor", () => {
    expect(CREDIT_WINDOW_BEATS).toBe(4);
    expect(CREDIT_WINDOW_MIN_SECONDS).toBe(2.4);
    const shortWindow = creditWindowSeconds(1);
    expect(shortWindow).toBe(2.4);
    expect(creditPhase(9.99, 10, shortWindow)).toBeNull();
    expect(creditPhase(10, 10, shortWindow)).toEqual({ kind: "enter", progress: 0 });
    expect(creditPhase(10.3, 10, shortWindow)).toMatchObject({
      kind: "enter",
      progress: expect.closeTo(0.5),
    });
    expect(creditPhase(10.6, 10, shortWindow)).toEqual({ kind: "hold", progress: 0 });
    expect(creditPhase(11.2, 10, shortWindow)).toMatchObject({
      kind: "hold",
      progress: expect.closeTo(0.5),
    });
    expect(creditPhase(11.8, 10, shortWindow)).toEqual({ kind: "exit", progress: 0 });
    expect(creditPhase(12.4, 10, shortWindow)).toBeNull();

    const longWindow = creditWindowSeconds(8);
    expect(longWindow).toBe(4);
    expect(creditPhase(20, 20, longWindow)).toEqual({ kind: "enter", progress: 0 });
    expect(creditPhase(21, 20, longWindow)).toEqual({ kind: "hold", progress: 0 });
    expect(creditPhase(23, 20, longWindow)).toEqual({ kind: "exit", progress: 0 });
    expect(creditPhase(24, 20, longWindow)).toBeNull();
  });

  it("exports all five credit styles in wheel order and clamps Masthead", () => {
    expect(CREDIT_STYLES.map((style) => style.name)).toEqual([
      "Cutout",
      "Scrawl",
      "Track-In",
      "Snipe",
      "Masthead",
    ]);
    expect(clampCreditStyleIndex(4)).toBe(4);
    expect(clampCreditStyleIndex(99)).toBe(4);
  });

  it("resolves a palette once when a credit window activates", () => {
    const frame = schedulerFrame(["mic-0"]);
    frame.piece.artDirection = {
      fxPreset: "neutral",
      creditPalette: "heat",
      source: "ai",
    };
    const resources = initMoodCreditResources({ w: 480, h: 480 });

    prepareFrame(resources, frame, 8);
    expect(resources.activeWindow?.palette).toBe(MOOD_CREDIT_PALETTES.heat);

    frame.piece.artDirection = {
      fxPreset: "neutral",
      creditPalette: "print",
      source: "user",
    };
    prepareFrame(resources, frame, 8.5);
    expect(resources.activeWindow?.palette).toBe(MOOD_CREDIT_PALETTES.heat);
  });

  it("logs sequence windows with pass metadata", () => {
    const resources = initMoodCreditResources({ w: 480, h: 480 });
    const frame = schedulerFrame(["mic-0"], ["mic-0"]);
    frame.piece.credits!.styleIndex = 3;

    prepareFrame(resources, frame, 8);
    prepareFrame(resources, frame, 8.5);

    expect(windowLogs()).toEqual([
      expect.objectContaining({
        level: "info",
        payload: {
          kind: "sequence",
          micId: "mic-0",
          passIndex: 0,
          position: 0,
          castSize: 1,
          cycleIndex: 1,
          lens: "wall",
          windowSeconds: 4,
          styleIndex: 3,
        },
      }),
    ]);
  });

  it("logs an active pass window skipped because performance stopped", () => {
    const resources = initMoodCreditResources({ w: 480, h: 480 });
    const frame = schedulerFrame(["mic-0"], ["mic-0"]);
    prepareFrame(resources, frame, 8);
    clearLogs();

    frame.performance = { ...frame.performance, isPerforming: false, epoch: null };
    prepareFrame(resources, frame, 8.5);

    expect(getLogs()).toEqual([
      expect.objectContaining({
        level: "info",
        event: LOG_EVENTS.MOOD_CREDIT_SKIP,
        payload: {
          reason: "performance-stopped",
          kind: "sequence",
          micId: "mic-0",
          passIndex: 0,
          position: 0,
          castSize: 1,
          lens: "wall",
        },
      }),
    ]);
  });
});
