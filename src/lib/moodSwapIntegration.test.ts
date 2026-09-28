// ABOUTME: Mood swap integration tests — the real transport, conductor, commit seam and players together.
// ABOUTME: Only Tone's nodes and the audio context are mocked, so boundary swaps are checked end to end.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { toneHarness } = await vi.hoisted(async () => {
  const { createToneHarness } = await import("../test-utils/toneTestHarness");
  return { toneHarness: createToneHarness() };
});

const toneNodes = vi.hoisted(() => {
  interface PlayerMock {
    buffer: AudioBuffer;
    connect: ReturnType<typeof vi.fn>;
    dispose: ReturnType<typeof vi.fn>;
    start: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
    loop: boolean;
    loopStart: number;
    loopEnd: number;
  }
  const players: PlayerMock[] = [];

  function makePlayer(buffer: AudioBuffer): PlayerMock {
    let loopEnd = 0;
    const player: PlayerMock = {
      buffer,
      connect: vi.fn(() => player),
      dispose: vi.fn(),
      start: vi.fn(() => player),
      stop: vi.fn(() => player),
      loop: false,
      loopStart: 0,
      // Tone's Player range-checks loopEnd against the loaded buffer.
      get loopEnd() {
        return loopEnd;
      },
      set loopEnd(value: number) {
        if (value < 0 || value > buffer.duration) {
          throw new RangeError(`Value must be within [0, ${buffer.duration}], got: ${value}`);
        }
        loopEnd = value;
      },
    };
    players.push(player);
    return player;
  }

  function makeGain() {
    const gain = {
      gain: { value: 1, cancelScheduledValues: vi.fn(), setValueAtTime: vi.fn() },
      connect: vi.fn(() => gain),
      dispose: vi.fn(),
    };
    return gain;
  }

  return { players, makePlayer, makeGain };
});

vi.mock("tone", () => ({
  ...toneHarness.createToneModule(),
  Gain: vi.fn(function Gain() {
    return toneNodes.makeGain();
  }),
  Player: vi.fn(function Player(buffer: AudioBuffer) {
    return toneNodes.makePlayer(buffer);
  }),
}));

function makeBuffer(sampleRate: number, length: number): AudioBuffer {
  const data = new Float32Array(length).fill(0.5);
  return {
    sampleRate,
    length,
    duration: length / sampleRate,
    numberOfChannels: 1,
    getChannelData: () => data,
  } as unknown as AudioBuffer;
}

vi.mock("./audio", () => ({
  getAudioContext: () => ({
    createBuffer: (_channels: number, length: number, sampleRate: number) =>
      makeBuffer(sampleRate, length),
  }),
}));

vi.mock("./audioLifecycle", () => ({
  ensureAudioRunning: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./moodFx", () => ({
  getMoodFxInput: () => ({ name: "mood-fx-input" }),
  initializeMoodFxForPerformance: vi.fn(),
  resetMoodDropFilter: vi.fn(),
  scheduleMoodDropFilter: vi.fn(),
}));

import { __resetPendingAudibleClaimForTesting } from "./audibleActionGate";
import { applyDueCommits } from "./moodCommits";
import { armSelection } from "./moodPerformance";
import { __resetMoodPlayersForTesting } from "./moodPlayers";
import {
  __resetMoodTransportForTesting,
  startMoodPerformance,
  stopMoodPerformance,
} from "./moodTransport";
import {
  __getMoodVideoPoolStateForTesting,
  __resetMoodVideoPoolForTesting,
  videoForTake,
} from "./moodVideoPool";
import { useAppStore } from "../store/useAppStore";
import { makeMoodTake } from "../test-utils/moodFixtures";

function take(id: string) {
  return makeMoodTake({ id, audioBuffer: makeBuffer(48_000, 96_000), durationSeconds: 2 });
}

// A Pocket piece with a 2 s cycle: take-a and take-b on mic 0, take-c on
// mic 1; take-a and take-c live, performing from epoch 10.
async function performFromEpochTen() {
  const actions = useAppStore.getState().actions;
  const takes = { takeA: take("take-a"), takeB: take("take-b"), takeC: take("take-c") };
  actions.createMoodPiece("row", "pocket");
  actions.setMoodTake("mic-0", takes.takeA);
  actions.setMoodTake("mic-0", takes.takeB);
  actions.setMoodTake("mic-1", takes.takeC);
  actions.setAppMode("mood");
  armSelection("mic-0", "take-a");
  armSelection("mic-1", "take-c");
  toneHarness.setImmediate(9.9);
  await startMoodPerformance();

}

function frame(audibleTime: number): void {
  toneHarness.setImmediate(audibleTime);
  applyDueCommits(audibleTime);
}

describe("Mood boundary swaps, end to end", () => {
  beforeEach(() => {
    useAppStore.getState().actions.reset();
    __resetPendingAudibleClaimForTesting();
    __resetMoodTransportForTesting();
    __resetMoodPlayersForTesting();
    __resetMoodVideoPoolForTesting();
    toneNodes.players.length = 0;
    toneHarness.transport.reset();
    toneHarness.draw.reset();
    toneHarness.setLookahead(0.1);
  });

  afterEach(() => {
    stopMoodPerformance();
    __resetMoodTransportForTesting();
    __resetMoodPlayersForTesting();
    __resetMoodVideoPoolForTesting();
    useAppStore.getState().actions.reset();
  });

  it("sounds a swap from the boundary on the audio clock and adopts it at the commit", async () => {
    await performFromEpochTen();
    // Players start in mic order: take-a, then take-c.
    expect(toneNodes.players).toHaveLength(2);
    const [playerA] = toneNodes.players;
    expect(useAppStore.getState().mood.performance.epoch).toBe(10);
    toneHarness.setImmediate(10.4);
    armSelection("mic-0", "take-b");

    // The arm clock (11.95) is short of the boundary at 12: not locked yet.
    frame(11.85);
    expect(toneNodes.players).toHaveLength(2);

    frame(11.92);
    const playerB = toneNodes.players[2];
    expect(playerB.start).toHaveBeenCalledWith(12, 0);
    expect(playerA.stop).toHaveBeenCalledWith(12);

    frame(12.0);
    expect(useAppStore.getState().mood.performance.selections["mic-0"]).toBe("take-b");
    expect(toneNodes.players).toHaveLength(3);
    expect(playerA.dispose).toHaveBeenCalledTimes(1);
    expect(playerB.dispose).not.toHaveBeenCalled();
  });

  it("leaves a live layer sounding when its take gains a poster before another mic swaps", async () => {
    await performFromEpochTen();
    const playerC = toneNodes.players[1];
    toneHarness.setImmediate(10.4);
    useAppStore
      .getState()
      .actions.attachMoodTakePoster("mic-1", "take-c", new Blob(["p"]), "blob:test/poster-c");
    armSelection("mic-0", "take-b");

    frame(11.92);
    frame(12.0);

    // Only take-b's player is new; take-c's keeps sounding across the commit.
    expect(toneNodes.players).toHaveLength(3);
    expect(playerC.stop).not.toHaveBeenCalled();
    expect(playerC.dispose).not.toHaveBeenCalled();
  });
  it("brings a live take whose audio is repaired in on the audio clock at the next boundary", async () => {
    const actions = useAppStore.getState().actions;
    actions.createMoodPiece("row", "pocket");
    actions.setMoodTake("mic-0", take("take-a"));
    // take-c's audio could not be decoded when Play started.
    actions.setMoodTake("mic-1", { ...take("take-c"), audioBuffer: null, audioStatus: "unavailable" });
    actions.setAppMode("mood");
    armSelection("mic-0", "take-a");
    armSelection("mic-1", "take-c");
    toneHarness.setImmediate(9.9);
    await startMoodPerformance();
    expect(toneNodes.players).toHaveLength(1);

    toneHarness.setImmediate(10.4);
    const unavailable = useAppStore.getState().mood.piece?.mics[1].takes[0];
    actions.restoreMoodTakeAudio("mic-1", "take-c", makeBuffer(48_000, 96_000), null, unavailable);
    frame(10.4);
    frame(11.92);

    const playerC = toneNodes.players[1];
    expect(playerC.start).toHaveBeenCalledWith(12, 0);
    frame(12.0);
    expect(toneNodes.players).toHaveLength(2);
    expect(playerC.dispose).not.toHaveBeenCalled();
  });
  it("keeps the video a take is armed with for the next boundary through an earlier commit", async () => {
    await performFromEpochTen();
    toneHarness.setImmediate(10.4);
    armSelection("mic-0", "take-b");
    // After the arm clock passes 12, a tap on take-a again queues it for 14.
    toneHarness.setImmediate(11.92);
    armSelection("mic-0", "take-a");
    const preparedA = videoForTake("take-a");

    frame(12.0);

    expect(useAppStore.getState().mood.performance.selections["mic-0"]).toBe("take-b");
    expect(videoForTake("take-a")).toBe(preparedA);
  });

  it("moves a live take's video to a new sync offset only when its audio moves", async () => {
    await performFromEpochTen();
    const videoC = videoForTake("take-c");
    if (!videoC) throw new Error("Expected take-c's video");
    let position = 0;
    const seeks: number[] = [];
    Object.defineProperty(videoC, "currentTime", {
      configurable: true,
      get: () => position,
      set: (value: number) => {
        position = value;
        seeks.push(value);
      },
    });
    frame(10.5);

    // Sync Assist nudges take-c 200 ms later; the performer then arms mic 0.
    const actions = useAppStore.getState().actions;
    actions.applyMoodSyncOffsetIfCurrent(
      "mic-1",
      "take-c",
      200,
      useAppStore.getState().session.moodRevision,
    );
    seeks.length = 0;
    toneHarness.setImmediate(10.6);
    armSelection("mic-0", "take-b");
    frame(10.7);
    frame(11.5);
    expect(seeks).toEqual([]);

    frame(11.92);
    frame(12.0);
    // At 12, 200 ms late: 1.8 s into its previous pass.
    expect(seeks.at(-1)).toBeCloseTo(1.8);
  });
  it("starts a take's video at its cut when it is picked again after its swap locked", async () => {
    await performFromEpochTen();
    toneHarness.setImmediate(10.4);
    armSelection("mic-0", "take-b");
    frame(11.5);
    // The pre-roll holds take-b's first frame a lead before 12.
    toneHarness.draw.advanceTo(11.92);
    // Picked again after the arm clock passed 12: also queued for 14.
    toneHarness.setImmediate(11.95);
    armSelection("mic-0", "take-b");
    frame(11.95);

    frame(12.01);
    frame(12.3);

    const takeB = __getMoodVideoPoolStateForTesting().find((entry) => entry.takeId === "take-b");
    expect(takeB?.playing).toBe(true);
  });
  it("brings a re-synced take in at its own boundary, not at another mic's earlier commit", async () => {
    await performFromEpochTen();
    const playerC = toneNodes.players[1];
    toneHarness.setImmediate(10.4);
    armSelection("mic-0", "take-b");
    // Sync Assist lands on take-c after the arm clock passed 12: its resync
    // is queued for 14.
    toneHarness.setImmediate(11.96);
    useAppStore
      .getState()
      .actions.applyMoodSyncOffsetIfCurrent(
        "mic-1",
        "take-c",
        200,
        useAppStore.getState().session.moodRevision,
      );
    frame(11.96);
    frame(12.01);
    expect(playerC.dispose).not.toHaveBeenCalled();

    frame(13.92);
    frame(14.0);
    expect(playerC.stop).toHaveBeenCalledWith(14);
    const resyncedC = toneNodes.players.find(
      (player) => player !== playerC && player.start.mock.calls[0]?.[0] === 14,
    );
    expect(resyncedC).toBeDefined();
  });

  it("does not leave a take picked while stopped frozen by a join cut short by the stop", async () => {
    await performFromEpochTen();
    toneHarness.setImmediate(10.4);
    armSelection("mic-0", "take-b");
    toneHarness.setImmediate(11.5);
    stopMoodPerformance();
    // Picked while stopped: it goes live at once. The pre-roll scheduled for
    // the old cut then comes due.
    armSelection("mic-0", "take-b");
    toneHarness.draw.advanceTo(11.95);

    const takeB = __getMoodVideoPoolStateForTesting().find((entry) => entry.takeId === "take-b");
    expect(useAppStore.getState().mood.performance.selections["mic-0"]).toBe("take-b");
    expect(takeB?.playing).toBe(true);
  });

  it("keeps a locked take's pre-rolled video when its mic is re-armed for the next boundary", async () => {
    await performFromEpochTen();
    useAppStore.getState().actions.setMoodTake("mic-0", take("take-d"));
    toneHarness.setImmediate(10.4);
    armSelection("mic-0", "take-b");
    const preparedB = videoForTake("take-b");
    expect(preparedB).toBeInstanceOf(HTMLVideoElement);

    // After take-b's swap locked for 12, the performer arms take-d for 14.
    toneHarness.setImmediate(11.95);
    armSelection("mic-0", "take-d");
    expect(videoForTake("take-b")).toBe(preparedB);

    frame(12.01);
    expect(useAppStore.getState().mood.performance.selections["mic-0"]).toBe("take-b");
    expect(videoForTake("take-b")).toBe(preparedB);
  });
});
