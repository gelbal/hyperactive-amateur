// ABOUTME: Mood FX tests — pins the lazy master insert chain and Drop filter automation.
// ABOUTME: Uses the shared Tone harness so filter events stay on exact audio-clock seconds.
import { beforeEach, describe, expect, it, vi } from "vitest";

const { toneHarness } = await vi.hoisted(async () => {
  const { createToneHarness } = await import("../test-utils/toneTestHarness");
  return { toneHarness: createToneHarness() };
});

const toneMocks = vi.hoisted(() => {
  interface ParamMock {
    value: number;
    cancelScheduledValues: ReturnType<typeof vi.fn>;
    linearRampToValueAtTime: ReturnType<typeof vi.fn>;
    setValueAtTime: ReturnType<typeof vi.fn>;
  }

  interface NodeMock {
    connect: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
    dispose: ReturnType<typeof vi.fn>;
  }

  interface GainMock extends NodeMock {
    gain: ParamMock;
    toDestination: ReturnType<typeof vi.fn>;
  }

  interface FeedbackDelayMock extends NodeMock {
    options: Record<string, number>;
    delayTime: ParamMock;
    feedback: ParamMock;
    wet: ParamMock;
  }

  interface PitchShiftMock extends NodeMock {
    options: { pitch: number; windowSize: number };
    pitch: number;
  }

  interface FilterMock extends NodeMock {
    frequency: ParamMock;
    options: { frequency: number; type: string };
    toDestination: ReturnType<typeof vi.fn>;
  }

  const gains: GainMock[] = [];
  const echoes: FeedbackDelayMock[] = [];
  const filters: FilterMock[] = [];
  const pitches: PitchShiftMock[] = [];

  function makeParam(value: number): ParamMock {
    const param: ParamMock = {
      value,
      cancelScheduledValues: vi.fn(() => param),
      linearRampToValueAtTime: vi.fn(() => param),
      setValueAtTime: vi.fn(() => param),
    };
    return param;
  }

  function makeGain(initialGain: number): GainMock {
    const gain: GainMock = {
      gain: makeParam(initialGain),
      connect: vi.fn(() => gain),
      disconnect: vi.fn(() => gain),
      dispose: vi.fn(),
      toDestination: vi.fn(() => gain),
    };
    gains.push(gain);
    return gain;
  }

  function makeFeedbackDelay(options: Record<string, number>): FeedbackDelayMock {
    const echo: FeedbackDelayMock = {
      options,
      delayTime: makeParam(options.delayTime),
      feedback: makeParam(options.feedback),
      wet: makeParam(options.wet),
      connect: vi.fn(() => echo),
      disconnect: vi.fn(() => echo),
      dispose: vi.fn(),
    };
    echoes.push(echo);
    return echo;
  }

  function makeFilter(options: { frequency: number; type: string }): FilterMock {
    const filter: FilterMock = {
      options,
      frequency: makeParam(options.frequency),
      connect: vi.fn(() => filter),
      disconnect: vi.fn(() => filter),
      toDestination: vi.fn(() => filter),
      dispose: vi.fn(),
    };
    filters.push(filter);
    return filter;
  }

  function makePitchShift(options: { pitch: number; windowSize: number }): PitchShiftMock {
    const pitch: PitchShiftMock = {
      options,
      pitch: options.pitch,
      connect: vi.fn(() => pitch),
      disconnect: vi.fn(() => pitch),
      dispose: vi.fn(),
    };
    pitches.push(pitch);
    return pitch;
  }

  return { echoes, filters, gains, pitches, makeFeedbackDelay, makeFilter, makeGain, makePitchShift };
});

vi.mock("tone", () => ({
  ...toneHarness.createToneModule(),
  FeedbackDelay: vi.fn(function FeedbackDelay(options: Record<string, number>) {
    return toneMocks.makeFeedbackDelay(options);
  }),
  Filter: vi.fn(function Filter(options: { frequency: number; type: string }) {
    return toneMocks.makeFilter(options);
  }),
  Gain: vi.fn(function Gain(initialGain: number) {
    return toneMocks.makeGain(initialGain);
  }),
  PitchShift: vi.fn(function PitchShift(options: { pitch: number; windowSize: number }) {
    return toneMocks.makePitchShift(options);
  }),
}));

import {
  __resetMoodFxForTesting,
  brakeVisualLevel,
  echoVisualLevel,
  gateVisualActive,
  harmonizeVisualLevel,
  getMoodFxInput,
  initializeMoodFxForPerformance,
  MOOD_DROP_CLOSED_FREQUENCY_HZ,
  MOOD_BRAKE_GAIN,
  MOOD_BRAKE_FREQUENCY_HZ,
  MOOD_ECHO_WET,
  MOOD_FX_PRESETS,
  MOOD_FX_OPEN_FREQUENCY_HZ,
  MOOD_HARMONY_WET,
  pressMoodBrake,
  pressMoodGate,
  pressMoodHarmonize,
  getMoodFxPadState,
  releaseMoodBrake,
  releaseMoodGate,
  releaseMoodHarmonize,
  resetMoodDropFilter,
  scheduleMoodDropFilter,
  suspendMoodPadsForCapture,
  triggerMoodEcho,
} from "./moodFx";
import { useAppStore } from "../store/useAppStore";
import { makeMoodTake } from "../test-utils/moodFixtures";

function startPadPerformance(cycleSeconds = 4, dropActive = true): void {
  const actions = useAppStore.getState().actions;
  actions.createMoodPiece("row", "pocket");
  actions.setMoodTake(
    "mic-0",
    makeMoodTake({ id: "the-one", durationSeconds: cycleSeconds }),
  );
  actions.applyMoodKeyEstimateIfCurrent(
    "the-one",
    { key: "C", mode: "major", confidence: 0.9 },
    useAppStore.getState().session.moodSessionId,
  );
  actions.setAppMode("mood");
  if (dropActive) actions.setMoodVibe("blocks");
  actions.setMoodPerforming(true, 10);
  initializeMoodFxForPerformance(cycleSeconds);
}

describe("moodFx", () => {
  beforeEach(() => {
    __resetMoodFxForTesting();
    window.localStorage.clear();
    useAppStore.getState().actions.setIsExporting(false);
    useAppStore.getState().actions.reset();
    toneMocks.gains.length = 0;
    toneMocks.echoes.length = 0;
    toneMocks.filters.length = 0;
    toneMocks.pitches.length = 0;
    toneHarness.setImmediate(0);
    toneHarness.setLookahead(0);
  });

  it("lazily builds one neutral Mood-only chain ending at Destination", () => {
    expect(toneMocks.gains).toHaveLength(0);

    const input = getMoodFxInput();

    expect(getMoodFxInput()).toBe(input);
    expect(toneMocks.gains).toHaveLength(2);
    expect(toneMocks.echoes).toHaveLength(1);
    expect(toneMocks.filters).toHaveLength(1);
    expect(toneMocks.gains[0].gain.value).toBe(1);
    expect(toneMocks.echoes[0].wet.value).toBe(0);
    expect(toneMocks.filters[0].options).toMatchObject({
      frequency: MOOD_FX_OPEN_FREQUENCY_HZ,
      type: "lowpass",
    });
    expect(toneMocks.gains[0].connect).toHaveBeenCalledWith(toneMocks.echoes[0]);
    expect(toneMocks.echoes[0].connect).toHaveBeenCalledWith(toneMocks.filters[0]);
    expect(toneMocks.filters[0].connect).toHaveBeenCalledWith(toneMocks.gains[1]);
    expect(toneMocks.gains[1].toDestination).toHaveBeenCalledTimes(1);
  });

  it("sets the half-beat Echo delay when a performance starts", () => {
    toneHarness.setImmediate(10);

    initializeMoodFxForPerformance(4);

    expect(toneMocks.echoes[0].delayTime.cancelScheduledValues).toHaveBeenCalledWith(10);
    expect(toneMocks.echoes[0].delayTime.setValueAtTime).toHaveBeenCalledWith(0.25, 10);
    expect(toneMocks.echoes[0].options.feedback).toBe(0.35);
  });

  it("loads the One's FX preset into Echo and Drop automation", () => {
    const actions = useAppStore.getState().actions;
    actions.createMoodPiece("row", "pocket");
    actions.setMoodTake("mic-0", makeMoodTake({ id: "the-one", durationSeconds: 4 }));
    actions.applyMoodArtDirectionIfCurrent(
      "the-one",
      { fxPreset: "sweep", creditPalette: "print", source: "ai" },
      useAppStore.getState().session.moodSessionId,
    );
    toneHarness.setImmediate(10);

    initializeMoodFxForPerformance(4);
    scheduleMoodDropFilter(false, 12, 0.5);

    expect(MOOD_FX_PRESETS.neutral).toEqual({ dropClosedHz: 380, echoFeedback: 0.35 });
    expect(MOOD_FX_PRESETS.sweep.dropClosedHz).toBeLessThan(MOOD_FX_PRESETS.neutral.dropClosedHz);
    expect(MOOD_FX_PRESETS.wash.dropClosedHz).toBeGreaterThan(MOOD_FX_PRESETS.neutral.dropClosedHz);
    expect(toneMocks.echoes[0].feedback.setValueAtTime).toHaveBeenCalledWith(
      MOOD_FX_PRESETS.sweep.echoFeedback,
      10,
    );
    expect(toneMocks.filters[0].frequency.linearRampToValueAtTime).toHaveBeenCalledWith(
      MOOD_FX_PRESETS.sweep.dropClosedHz,
      12.5,
    );
  });

  it("lazily layers a keyed third and fifth, then disconnects after quantized release", () => {
    toneHarness.setImmediate(10);
    startPadPerformance();
    expect(toneMocks.pitches).toHaveLength(0);
    toneHarness.setImmediate(10.2);

    expect(pressMoodHarmonize()).toBe(true);

    expect(toneMocks.pitches).toHaveLength(2);
    expect(toneMocks.pitches.map((pitch) => pitch.options)).toEqual([
      { pitch: 4, windowSize: 0.04 },
      { pitch: 7, windowSize: 0.04 },
    ]);
    const gate = toneMocks.gains[0];
    const harmonyGain = toneMocks.gains[2];
    expect(gate.connect).toHaveBeenCalledWith(toneMocks.pitches[0]);
    expect(gate.connect).toHaveBeenCalledWith(toneMocks.pitches[1]);
    expect(toneMocks.pitches[0].connect).toHaveBeenCalledWith(harmonyGain);
    expect(toneMocks.pitches[1].connect).toHaveBeenCalledWith(harmonyGain);
    expect(harmonyGain.connect).toHaveBeenCalledWith(toneMocks.echoes[0]);
    expect(harmonyGain.gain.setValueAtTime).toHaveBeenCalledWith(0, 10.2);
    expect(harmonyGain.gain.linearRampToValueAtTime).toHaveBeenCalledWith(
      MOOD_HARMONY_WET,
      10.25,
    );
    expect(harmonizeVisualLevel(10.199)).toBe(0);
    expect(harmonizeVisualLevel(10.225)).toBeCloseTo(0.5);
    expect(harmonizeVisualLevel(10.25)).toBe(1);

    toneHarness.setImmediate(10.3);
    expect(releaseMoodHarmonize()).toBe(true);
    expect(harmonyGain.gain.setValueAtTime).toHaveBeenLastCalledWith(0, 10.5);
    expect(harmonizeVisualLevel(10.499)).toBe(1);
    expect(harmonizeVisualLevel(10.5)).toBe(0);
    expect(gate.disconnect).not.toHaveBeenCalled();

    toneHarness.draw.advanceTo(10.5);
    expect(gate.disconnect).toHaveBeenCalledWith(toneMocks.pitches[0]);
    expect(gate.disconnect).toHaveBeenCalledWith(toneMocks.pitches[1]);
  });

  it("re-reads the key mode on every Harmonize press", () => {
    toneHarness.setImmediate(10);
    startPadPerformance();
    toneHarness.setImmediate(10.2);
    pressMoodHarmonize();
    toneHarness.setImmediate(10.3);
    releaseMoodHarmonize();
    toneHarness.draw.advanceTo(10.5);

    useAppStore.getState().actions.applyMoodKeyEstimateIfCurrent(
      "the-one",
      { key: "A", mode: "minor", confidence: 0.95 },
      useAppStore.getState().session.moodSessionId,
    );
    toneHarness.setImmediate(10.6);
    expect(pressMoodHarmonize()).toBe(true);

    expect(toneMocks.pitches[0].pitch).toBe(3);
    expect(toneMocks.pitches[1].pitch).toBe(7);
  });

  it("refreshes existing harmony pitches when a performance initializes", () => {
    toneHarness.setImmediate(10);
    startPadPerformance();
    toneHarness.setImmediate(10.2);
    pressMoodHarmonize();
    useAppStore.getState().actions.applyMoodKeyEstimateIfCurrent(
      "the-one",
      { key: "E", mode: "minor", confidence: 0.93 },
      useAppStore.getState().session.moodSessionId,
    );
    toneHarness.setImmediate(11);

    initializeMoodFxForPerformance(4);

    expect(toneMocks.pitches[0].pitch).toBe(3);
    expect(toneMocks.pitches[1].pitch).toBe(7);
  });

  it("schedules Gate from the press for two beats, extends it, and closes on the next beat", () => {
    toneHarness.setImmediate(10);
    startPadPerformance();
    const gate = toneMocks.gains[0].gain;
    gate.cancelScheduledValues.mockClear();
    gate.setValueAtTime.mockClear();
    toneHarness.transport.seconds = 0.2;
    toneHarness.setImmediate(10.2);

    expect(pressMoodGate()).toBe(true);

    expect(gate.cancelScheduledValues).toHaveBeenCalledWith(10.2);
    expect(gate.setValueAtTime.mock.calls).toEqual([
      [0, 10.2],
      [1, 10.45],
      [0, 10.7],
      [1, 10.95],
      [0, 11.2],
    ]);
    expect(toneHarness.transport.scheduleRepeat).toHaveBeenCalledWith(
      expect.any(Function),
      0.5,
      0.7,
    );

    toneHarness.transport.fireRepeat(0, 10.7);
    expect(gate.setValueAtTime.mock.calls.slice(-2)).toEqual([
      [1, 11.45],
      [0, 11.7],
    ]);

    toneHarness.setImmediate(10.3);
    expect(releaseMoodGate()).toBe(true);
    expect(gate.cancelScheduledValues).toHaveBeenLastCalledWith(10.5);
    expect(gate.setValueAtTime).toHaveBeenLastCalledWith(1, 10.5);
    expect(toneHarness.transport.clear).toHaveBeenCalledTimes(1);
  });

  it("derives Gate flicker from the same half-beat ladder math", () => {
    toneHarness.setImmediate(10);
    startPadPerformance();
    toneHarness.setImmediate(10.2);
    pressMoodGate();

    expect(gateVisualActive(10.199)).toBe(false);
    expect(gateVisualActive(10.2)).toBe(true);
    expect(gateVisualActive(10.449)).toBe(true);
    expect(gateVisualActive(10.45)).toBe(false);
    expect(gateVisualActive(10.7)).toBe(true);

    toneHarness.setImmediate(10.3);
    releaseMoodGate();
    expect(gateVisualActive(10.499)).toBe(false);
    expect(gateVisualActive(10.5)).toBe(false);
  });

  it("re-triggers Echo as an exact one-beat wet envelope and exposes its visual twin", () => {
    toneHarness.setImmediate(10);
    startPadPerformance();
    const wet = toneMocks.echoes[0].wet;
    wet.cancelScheduledValues.mockClear();
    wet.setValueAtTime.mockClear();
    wet.linearRampToValueAtTime.mockClear();
    toneHarness.setImmediate(10.2);

    expect(triggerMoodEcho()).toBe(true);

    expect(wet.cancelScheduledValues).toHaveBeenCalledWith(10.2);
    expect(wet.setValueAtTime).toHaveBeenCalledWith(0, 10.2);
    expect(wet.linearRampToValueAtTime.mock.calls).toEqual([
      [MOOD_ECHO_WET, 10.45],
      [0, 10.7],
    ]);
    expect(echoVisualLevel(10.2)).toBe(0);
    expect(echoVisualLevel(10.325)).toBeCloseTo(MOOD_ECHO_WET / 2);
    expect(echoVisualLevel(10.45)).toBe(MOOD_ECHO_WET);
    expect(echoVisualLevel(10.575)).toBeCloseTo(MOOD_ECHO_WET / 2);
    expect(echoVisualLevel(10.7)).toBe(0);

    toneHarness.setImmediate(10.4);
    expect(triggerMoodEcho()).toBe(true);
    expect(wet.cancelScheduledValues).toHaveBeenLastCalledWith(10.4);
    expect(wet.linearRampToValueAtTime.mock.calls.slice(-2)).toEqual([
      [MOOD_ECHO_WET, 10.65],
      [0, 10.9],
    ]);
  });

  it("ramps Brake over one beat and snaps its open Drop base back on the next beat", () => {
    toneHarness.setImmediate(10);
    startPadPerformance();
    const frequency = toneMocks.filters[0].frequency;
    const brakeGain = toneMocks.gains[1].gain;
    frequency.cancelScheduledValues.mockClear();
    frequency.setValueAtTime.mockClear();
    frequency.linearRampToValueAtTime.mockClear();
    brakeGain.cancelScheduledValues.mockClear();
    brakeGain.setValueAtTime.mockClear();
    brakeGain.linearRampToValueAtTime.mockClear();
    toneHarness.setImmediate(10.2);

    expect(pressMoodBrake()).toBe(true);

    expect(frequency.cancelScheduledValues).toHaveBeenCalledWith(10.2);
    expect(frequency.setValueAtTime).toHaveBeenCalledWith(
      MOOD_FX_OPEN_FREQUENCY_HZ,
      10.2,
    );
    expect(frequency.linearRampToValueAtTime).toHaveBeenCalledWith(
      MOOD_BRAKE_FREQUENCY_HZ,
      10.7,
    );
    expect(brakeGain.setValueAtTime).toHaveBeenCalledWith(1, 10.2);
    expect(brakeGain.linearRampToValueAtTime).toHaveBeenCalledWith(
      MOOD_BRAKE_GAIN,
      10.7,
    );
    expect(brakeVisualLevel(10.2)).toBe(0);
    expect(brakeVisualLevel(10.45)).toBeCloseTo(0.5);
    expect(brakeVisualLevel(10.7)).toBe(1);

    toneHarness.setImmediate(10.3);
    expect(releaseMoodBrake()).toBe(true);
    expect(frequency.cancelScheduledValues).toHaveBeenLastCalledWith(10.5);
    expect(frequency.setValueAtTime).toHaveBeenLastCalledWith(
      MOOD_FX_OPEN_FREQUENCY_HZ,
      10.5,
    );
    expect(brakeGain.cancelScheduledValues).toHaveBeenLastCalledWith(10.5);
    expect(brakeGain.setValueAtTime).toHaveBeenLastCalledWith(1, 10.5);
    expect(brakeVisualLevel(10.499)).toBeCloseTo(0.598);
    expect(brakeVisualLevel(10.5)).toBe(0);
  });

  it("leaves the closed Drop filter alone while Brake only dips gain", () => {
    toneHarness.setImmediate(10);
    startPadPerformance(4, false);
    const frequency = toneMocks.filters[0].frequency;
    const brakeGain = toneMocks.gains[1].gain;
    frequency.cancelScheduledValues.mockClear();
    frequency.setValueAtTime.mockClear();
    frequency.linearRampToValueAtTime.mockClear();
    brakeGain.linearRampToValueAtTime.mockClear();
    toneHarness.setImmediate(10.2);

    pressMoodBrake();

    expect(frequency.cancelScheduledValues).not.toHaveBeenCalled();
    expect(frequency.setValueAtTime).not.toHaveBeenCalled();
    expect(frequency.linearRampToValueAtTime).not.toHaveBeenCalled();
    expect(brakeGain.linearRampToValueAtTime).toHaveBeenCalledWith(
      MOOD_BRAKE_GAIN,
      10.7,
    );
  });

  it("restores Brake to the active preset's closed Drop depth", () => {
    toneHarness.setImmediate(10);
    startPadPerformance();
    useAppStore.getState().actions.applyMoodArtDirectionIfCurrent(
      "the-one",
      { fxPreset: "sweep", creditPalette: "signal", source: "user" },
      useAppStore.getState().session.moodSessionId,
    );
    initializeMoodFxForPerformance(4);
    const frequency = toneMocks.filters[0].frequency;
    toneHarness.setImmediate(10.2);
    pressMoodBrake();
    scheduleMoodDropFilter(false, 10.5, 0.5);
    toneHarness.setImmediate(10.3);

    releaseMoodBrake();

    expect(frequency.setValueAtTime).toHaveBeenLastCalledWith(
      MOOD_FX_PRESETS.sweep.dropClosedHz,
      10.5,
    );
  });

  it("keeps every pad inert unless performing and while capture is non-idle", () => {
    toneHarness.setImmediate(10);
    initializeMoodFxForPerformance(4);
    const gate = toneMocks.gains[0].gain;
    const wet = toneMocks.echoes[0].wet;
    const brakeGain = toneMocks.gains[1].gain;
    gate.setValueAtTime.mockClear();
    wet.setValueAtTime.mockClear();
    brakeGain.setValueAtTime.mockClear();

    expect(pressMoodGate()).toBe(false);
    expect(triggerMoodEcho()).toBe(false);
    expect(pressMoodBrake()).toBe(false);
    expect(pressMoodHarmonize()).toBe(false);

    startPadPerformance();
    useAppStore.getState().actions.setRecordingState("recording", 0);
    gate.setValueAtTime.mockClear();
    wet.setValueAtTime.mockClear();
    brakeGain.setValueAtTime.mockClear();

    expect(pressMoodGate()).toBe(false);
    expect(triggerMoodEcho()).toBe(false);
    expect(pressMoodBrake()).toBe(false);
    expect(pressMoodHarmonize()).toBe(false);
    expect(gate.setValueAtTime).not.toHaveBeenCalled();
    expect(wet.setValueAtTime).not.toHaveBeenCalled();
    expect(brakeGain.setValueAtTime).not.toHaveBeenCalled();
  });

  it("suspends held pads at capture start without touching the Drop arrangement", () => {
    toneHarness.setImmediate(10);
    startPadPerformance();
    toneHarness.setImmediate(10.2);
    pressMoodGate();
    pressMoodHarmonize();
    const gate = toneMocks.gains[0].gain;
    const wet = toneMocks.echoes[0].wet;
    const brakeGain = toneMocks.gains[1].gain;
    const frequency = toneMocks.filters[0].frequency;
    const harmonyGain = toneMocks.gains[2].gain;
    const harmonyDisconnects = toneMocks.gains[0].disconnect.mock.calls.length;
    gate.setValueAtTime.mockClear();
    wet.setValueAtTime.mockClear();
    brakeGain.setValueAtTime.mockClear();
    frequency.setValueAtTime.mockClear();
    harmonyGain.setValueAtTime.mockClear();
    toneHarness.setImmediate(10.3);

    suspendMoodPadsForCapture();

    expect(gate.cancelScheduledValues).toHaveBeenCalledWith(10.3);
    expect(gate.setValueAtTime).toHaveBeenCalledWith(1, 10.3);
    expect(wet.setValueAtTime).toHaveBeenCalledWith(0, 10.3);
    expect(brakeGain.setValueAtTime).toHaveBeenCalledWith(1, 10.3);
    expect(harmonyGain.setValueAtTime).toHaveBeenCalledWith(0, 10.3);
    expect(toneMocks.gains[0].disconnect.mock.calls.length).toBeGreaterThan(
      harmonyDisconnects,
    );
    expect(frequency.setValueAtTime).not.toHaveBeenCalled();
    expect(getMoodFxPadState()).toEqual({
      gateActive: false,
      echoActive: false,
      brakeActive: false,
      harmonizeActive: false,
    });
  });

  it("restores the Drop-appropriate filter when capture interrupts a held Brake", () => {
    toneHarness.setImmediate(10);
    startPadPerformance();
    toneHarness.setImmediate(10.2);
    pressMoodBrake();
    scheduleMoodDropFilter(false, 10.25, 0.5);
    const frequency = toneMocks.filters[0].frequency;
    frequency.setValueAtTime.mockClear();
    toneHarness.setImmediate(10.3);

    suspendMoodPadsForCapture();

    expect(frequency.cancelScheduledValues).toHaveBeenCalledWith(10.3);
    expect(frequency.setValueAtTime).toHaveBeenCalledWith(
      MOOD_DROP_CLOSED_FREQUENCY_HZ,
      10.3,
    );
  });

  it("is a no-op at capture start when no pad is held", () => {
    toneHarness.setImmediate(10);
    startPadPerformance();
    const gate = toneMocks.gains[0].gain;
    gate.cancelScheduledValues.mockClear();
    gate.setValueAtTime.mockClear();

    suspendMoodPadsForCapture();

    expect(gate.cancelScheduledValues).not.toHaveBeenCalled();
    expect(gate.setValueAtTime).not.toHaveBeenCalled();
  });

  it("schedules Drop-off as an exact-boundary one-beat low-pass sweep", () => {
    scheduleMoodDropFilter(false, 12, 0.5);

    const frequency = toneMocks.filters[0].frequency;
    expect(frequency.cancelScheduledValues).toHaveBeenCalledWith(12);
    expect(frequency.setValueAtTime).toHaveBeenCalledWith(
      MOOD_FX_OPEN_FREQUENCY_HZ,
      12,
    );
    expect(frequency.linearRampToValueAtTime).toHaveBeenCalledWith(
      MOOD_DROP_CLOSED_FREQUENCY_HZ,
      12.5,
    );
  });

  it("cancels and replaces a same-boundary arm with a snap open", () => {
    scheduleMoodDropFilter(false, 12, 0.5);
    const frequency = toneMocks.filters[0].frequency;
    frequency.cancelScheduledValues.mockClear();
    frequency.setValueAtTime.mockClear();
    frequency.linearRampToValueAtTime.mockClear();

    scheduleMoodDropFilter(true, 12, 0.5);

    expect(frequency.cancelScheduledValues).toHaveBeenCalledWith(12);
    expect(frequency.setValueAtTime).toHaveBeenCalledWith(
      MOOD_FX_OPEN_FREQUENCY_HZ,
      12,
    );
    expect(frequency.linearRampToValueAtTime).not.toHaveBeenCalled();
  });

  it("cancels every pad automation and returns the chain to neutral on reset", () => {
    toneHarness.setImmediate(9);
    startPadPerformance();
    toneHarness.setImmediate(9.1);
    pressMoodGate();
    triggerMoodEcho();
    pressMoodBrake();
    pressMoodHarmonize();
    const gate = toneMocks.gains[0].gain;
    const wet = toneMocks.echoes[0].wet;
    const frequency = toneMocks.filters[0].frequency;
    const brakeGain = toneMocks.gains[1].gain;
    const harmonyGain = toneMocks.gains[2].gain;
    gate.cancelScheduledValues.mockClear();
    gate.setValueAtTime.mockClear();
    wet.cancelScheduledValues.mockClear();
    wet.setValueAtTime.mockClear();
    frequency.cancelScheduledValues.mockClear();
    frequency.setValueAtTime.mockClear();
    brakeGain.cancelScheduledValues.mockClear();
    brakeGain.setValueAtTime.mockClear();
    harmonyGain.cancelScheduledValues.mockClear();
    harmonyGain.setValueAtTime.mockClear();
    toneHarness.setImmediate(9.25);

    resetMoodDropFilter();

    expect(gate.cancelScheduledValues).toHaveBeenCalledWith(9.25);
    expect(gate.setValueAtTime).toHaveBeenCalledWith(1, 9.25);
    expect(wet.cancelScheduledValues).toHaveBeenCalledWith(9.25);
    expect(wet.setValueAtTime).toHaveBeenCalledWith(0, 9.25);
    expect(frequency.cancelScheduledValues).toHaveBeenCalledWith(9.25);
    expect(frequency.setValueAtTime).toHaveBeenCalledWith(
      MOOD_FX_OPEN_FREQUENCY_HZ,
      9.25,
    );
    expect(brakeGain.cancelScheduledValues).toHaveBeenCalledWith(9.25);
    expect(brakeGain.setValueAtTime).toHaveBeenCalledWith(1, 9.25);
    expect(harmonyGain.cancelScheduledValues).toHaveBeenCalledWith(9.25);
    expect(harmonyGain.setValueAtTime).toHaveBeenCalledWith(0, 9.25);
    expect(gateVisualActive(9.25)).toBe(false);
    expect(echoVisualLevel(9.25)).toBe(0);
    expect(brakeVisualLevel(9.25)).toBe(0);
    expect(harmonizeVisualLevel(9.25)).toBe(0);
  });

  it("disposes every owned node and can rebuild a fresh chain", () => {
    const firstInput = getMoodFxInput();
    const firstGate = toneMocks.gains[0];
    const firstBrake = toneMocks.gains[1];
    const firstEcho = toneMocks.echoes[0];
    const firstFilter = toneMocks.filters[0];
    toneHarness.setImmediate(1);
    startPadPerformance();
    pressMoodHarmonize();
    const firstHarmonyGain = toneMocks.gains[2];
    const firstThird = toneMocks.pitches[0];
    const firstFifth = toneMocks.pitches[1];

    __resetMoodFxForTesting();

    expect(firstGate.dispose).toHaveBeenCalledTimes(1);
    expect(firstBrake.dispose).toHaveBeenCalledTimes(1);
    expect(firstEcho.dispose).toHaveBeenCalledTimes(1);
    expect(firstFilter.dispose).toHaveBeenCalledTimes(1);
    expect(firstHarmonyGain.dispose).toHaveBeenCalledTimes(1);
    expect(firstThird.dispose).toHaveBeenCalledTimes(1);
    expect(firstFifth.dispose).toHaveBeenCalledTimes(1);
    expect(getMoodFxInput()).not.toBe(firstInput);
  });
});
