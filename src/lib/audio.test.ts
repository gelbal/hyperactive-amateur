// ABOUTME: Tests for audio.ts trigger gating — showVideo gate, mute respected, fallback synth.
// ABOUTME: Tone is fully mocked so JSDOM never touches a real audio context.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createAudioContextStub, type AudioContextStub } from "../test-utils/audioContextStub";

type RepeatCb = (time: number) => void;
const transportMock = {
  start: vi.fn(),
  stop: vi.fn(),
  clear: vi.fn(),
  scheduleRepeat: vi.fn<(cb: RepeatCb, interval: string) => number>(() => 1),
  bpm: { value: 90 },
  swing: 0,
  swingSubdivision: "16n",
};

const videoEngineTrigger = vi.fn();
vi.mock("./videoEngine", () => ({
  trigger: (...args: unknown[]) => videoEngineTrigger(...args),
  resetPlaybackState: vi.fn(),
}));

const drawMock = { schedule: vi.fn((fn: () => void) => fn()) };
let audioContextStub: AudioContextStub;

interface SynthMock {
  triggerAttackRelease: ReturnType<typeof vi.fn>;
  toDestination: () => SynthMock;
}
const synthInstances: SynthMock[] = [];
function makeSynth(): SynthMock {
  const s: SynthMock = {
    triggerAttackRelease: vi.fn(),
    toDestination: () => s,
  };
  synthInstances.push(s);
  return s;
}

interface PlayerMock {
  start: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
  toDestination: () => PlayerMock;
  loaded: boolean;
  volume: { value: number };
}
const playerInstances: PlayerMock[] = [];
function makePlayer(): PlayerMock {
  const p: PlayerMock = {
    start: vi.fn(),
    dispose: vi.fn(),
    toDestination: () => p,
    loaded: true,
    volume: { value: 0 },
  };
  playerInstances.push(p);
  return p;
}

vi.mock("tone", () => ({
  start: vi.fn().mockResolvedValue(undefined),
  getTransport: vi.fn(() => transportMock),
  getDraw: vi.fn(() => drawMock),
  getContext: vi.fn(() => ({ rawContext: audioContextStub })),
  MembraneSynth: vi.fn(function MembraneSynth() {
    return makeSynth();
  }),
  Player: vi.fn(function Player() {
    return makePlayer();
  }),
  now: vi.fn(() => 0),
  immediate: vi.fn(() => 0),
}));

import { initTransport, __resetAudioForTesting, togglePlayback, triggerTrackNow } from "./audio";
import { useAppStore } from "../store/useAppStore";
import * as Tone from "tone";
import type { Clip } from "../types";
import {
  __resetPendingAudibleClaimForTesting,
  canStartAudibleAction,
} from "./audibleActionGate";

function makeClip(): Clip {
  return {
    blob: new Blob([new Uint8Array([1])], { type: "video/webm" }),
    url: "blob:test/1",
    audioBuffer: { duration: 1, sampleRate: 48000 } as AudioBuffer,
    audioStatus: "ok",
    trimStartMs: 0,
    trimEndMs: 1000,
    durationMs: 1000,
    posterBlob: null,
    posterUrl: null,
  };
}

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("audio: per-step trigger logic", () => {
  beforeEach(() => {
    audioContextStub = createAudioContextStub();
    audioContextStub.setState("running");
    __resetAudioForTesting();
    useAppStore.getState().actions.setIsExporting(false);
    useAppStore.getState().actions.reset();
    transportMock.scheduleRepeat.mockClear();
    transportMock.start.mockClear();
    transportMock.stop.mockClear();
    transportMock.clear.mockClear();
    synthInstances.length = 0;
    playerInstances.length = 0;
    videoEngineTrigger.mockClear();
    vi.mocked(Tone.start).mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
    __resetPendingAudibleClaimForTesting();
  });

  it("clipped track: fires player + videoEngine; showVideo=false skips video; muted skips both", () => {
    initTransport();
    const a = useAppStore.getState().actions;
    // Track 0: normal — should trigger player + video.
    a.setTrackClip(0, makeClip());
    a.toggleStep(0, 0);
    // Track 1: showVideo=false — audio only.
    a.setTrackClip(1, makeClip());
    a.toggleStep(1, 0);
    a.setTrackShowVideo(1, false);
    // Track 2: muted — neither audio nor video.
    a.setTrackClip(2, makeClip());
    a.toggleStep(2, 0);
    a.setTrackMuted(2, true);

    const cb = transportMock.scheduleRepeat.mock.calls[0]?.[0];
    cb?.(0.25);

    expect(playerInstances[0].start).toHaveBeenCalledWith(0.25, 0, 1);
    expect(videoEngineTrigger).toHaveBeenCalledWith(0, 0.25, 0.25);
    expect(playerInstances[1].start).toHaveBeenCalled();
    expect(videoEngineTrigger).toHaveBeenCalledTimes(1); // only track 0 cut
    expect(playerInstances[2].start).not.toHaveBeenCalled();
  });

  it("falls back to a synth click for tracks without a clip", () => {
    initTransport();
    useAppStore.getState().actions.toggleStep(2, 0);
    const cb = transportMock.scheduleRepeat.mock.calls[0]?.[0];
    cb?.(0);
    expect(synthInstances[2].triggerAttackRelease).toHaveBeenCalledWith("E2", "16n", 0, 1);
  });

  it("does not create a player or fallback click for clips with unavailable audio", () => {
    initTransport();
    const a = useAppStore.getState().actions;
    a.setTrackClip(0, makeClip());
    a.setTrackClip(1, {
      ...makeClip(),
      audioBuffer: null,
      audioStatus: "unavailable",
    });
    a.toggleStep(0, 0);
    a.toggleStep(1, 0);

    const cb = transportMock.scheduleRepeat.mock.calls[0]?.[0];
    cb?.(0.5);

    expect(playerInstances).toHaveLength(1);
    expect(playerInstances[0].start).toHaveBeenCalledWith(0.5, 0, 1);
    expect(synthInstances[1].triggerAttackRelease).not.toHaveBeenCalled();
    expect(videoEngineTrigger).toHaveBeenCalledWith(1, 0.5, 0.5);
  });

  it("manual triggers unlock the audio context before firing", async () => {
    initTransport();
    await triggerTrackNow(2);
    expect(Tone.start).toHaveBeenCalled();
    expect(synthInstances[2].triggerAttackRelease).toHaveBeenCalledWith("E2", "16n", 0, 1);
  });

  it("manual clipped triggers display at Tone.immediate while audio schedules at Tone.now", async () => {
    initTransport();
    useAppStore.getState().actions.setTrackClip(0, makeClip());
    vi.mocked(Tone.now).mockReturnValueOnce(2.1);
    vi.mocked(Tone.immediate).mockReturnValueOnce(2.0);

    await triggerTrackNow(0);

    expect(playerInstances[0].start).toHaveBeenCalledWith(2.1, 0, 1);
    expect(videoEngineTrigger).toHaveBeenCalledWith(0, 2.1, 2.0);
  });

  it("does not mark playback playing when audio never reaches running", async () => {
    vi.useFakeTimers();
    audioContextStub.setState("suspended");
    initTransport();

    const promise = togglePlayback();
    const rejection = expect(promise).rejects.toMatchObject({ name: "AudioUnavailableError" });

    await vi.advanceTimersByTimeAsync(500);

    await rejection;
    expect(transportMock.start).not.toHaveBeenCalled();
    expect(useAppStore.getState().playback.isPlaying).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("holds the audible gate while playback waits for audio unlock", async () => {
    initTransport();
    const audioStarted = deferred();
    vi.mocked(Tone.start).mockReturnValueOnce(audioStarted.promise);

    const promise = togglePlayback();

    expect(canStartAudibleAction(useAppStore.getState())).toBe(false);
    expect(transportMock.start).not.toHaveBeenCalled();

    audioStarted.resolve();
    await promise;

    expect(Tone.start).toHaveBeenCalledTimes(1);
    expect(transportMock.start).toHaveBeenCalledTimes(1);
    expect(useAppStore.getState().playback.isPlaying).toBe(true);
    expect(canStartAudibleAction(useAppStore.getState())).toBe(false);

    useAppStore.getState().actions.setIsPlaying(false);

    expect(canStartAudibleAction(useAppStore.getState())).toBe(true);
  });

  it("holds the audible gate while a pad trigger waits for audio unlock", async () => {
    initTransport();
    const audioStarted = deferred();
    vi.mocked(Tone.start).mockReturnValueOnce(audioStarted.promise);

    const promise = triggerTrackNow(2);

    expect(canStartAudibleAction(useAppStore.getState())).toBe(false);
    expect(synthInstances[2].triggerAttackRelease).not.toHaveBeenCalled();

    audioStarted.resolve();
    await promise;

    expect(Tone.start).toHaveBeenCalledTimes(1);
    expect(synthInstances[2].triggerAttackRelease).toHaveBeenCalledWith("E2", "16n", 0, 1);
    expect(canStartAudibleAction(useAppStore.getState())).toBe(true);
  });

  it("ignores a second playback toggle while the first is starting", async () => {
    initTransport();
    const audioStarted = deferred();
    vi.mocked(Tone.start).mockReturnValueOnce(audioStarted.promise);

    const first = togglePlayback();
    const second = togglePlayback();

    expect(Tone.start).toHaveBeenCalledTimes(1);

    audioStarted.resolve();
    await Promise.all([first, second]);

    expect(transportMock.start).toHaveBeenCalledTimes(1);
    expect(useAppStore.getState().playback.isPlaying).toBe(true);

    useAppStore.getState().actions.setIsPlaying(false);

    expect(canStartAudibleAction(useAppStore.getState())).toBe(true);
  });

  it("aborts playback start if recording becomes active during audio unlock", async () => {
    initTransport();
    const audioStarted = deferred();
    vi.mocked(Tone.start).mockReturnValueOnce(audioStarted.promise);

    const promise = togglePlayback();
    useAppStore.getState().actions.setRecordingState("recording", 0);

    audioStarted.resolve();
    await promise;

    expect(Tone.start).toHaveBeenCalledTimes(1);
    expect(transportMock.start).not.toHaveBeenCalled();
    expect(useAppStore.getState().playback.isPlaying).toBe(false);
    expect(canStartAudibleAction(useAppStore.getState())).toBe(false);

    useAppStore.getState().actions.setRecordingState("idle", null);

    expect(canStartAudibleAction(useAppStore.getState())).toBe(true);
  });

  it("ignores manual playback controls while export owns the Transport", async () => {
    initTransport();
    useAppStore.getState().actions.setIsExporting(true);
    useAppStore.getState().actions.setIsPlaying(true);

    await triggerTrackNow(2);
    await togglePlayback();

    expect(Tone.start).not.toHaveBeenCalled();
    expect(transportMock.start).not.toHaveBeenCalled();
    expect(transportMock.stop).not.toHaveBeenCalled();
    expect(synthInstances[2].triggerAttackRelease).not.toHaveBeenCalled();
  });

  it("ignores manual playback and pad triggers while recording is active", async () => {
    initTransport();
    useAppStore.getState().actions.setRecordingState("recording", 0);

    await triggerTrackNow(2);
    await togglePlayback();

    expect(Tone.start).not.toHaveBeenCalled();
    expect(transportMock.start).not.toHaveBeenCalled();
    expect(synthInstances[2].triggerAttackRelease).not.toHaveBeenCalled();
  });

  it("applies persisted linear track volume to Tone players", () => {
    initTransport();
    const actions = useAppStore.getState().actions;
    actions.setTrackVolume(0, 0.5);
    actions.setTrackClip(0, makeClip());
    expect(playerInstances[0].volume.value).toBeCloseTo(-6.0206, 4);

    actions.setTrackVolume(0, 0);
    expect(playerInstances[0].volume.value).toBe(-Infinity);
  });
});
