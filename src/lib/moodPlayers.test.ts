// ABOUTME: moodPlayers tests — phase-lock Mood take loops and shared gain routing.
// ABOUTME: Tone and Web Audio are mocked so buffer padding and start math stay deterministic.
import { beforeEach, describe, expect, it, vi } from "vitest";

const { toneHarness } = await vi.hoisted(async () => {
  const { createToneHarness } = await import("../test-utils/toneTestHarness");
  return { toneHarness: createToneHarness() };
});

const moodFxMocks = vi.hoisted(() => ({
  input: { name: "mood-fx-input" },
}));

const toneMocks = vi.hoisted(() => {
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

  interface GainMock {
    gain: {
      value: number;
      cancelScheduledValues: ReturnType<typeof vi.fn>;
      setValueAtTime: ReturnType<typeof vi.fn>;
    };
    connect: ReturnType<typeof vi.fn>;
    dispose: ReturnType<typeof vi.fn>;
  }

  const players: PlayerMock[] = [];
  const gains: GainMock[] = [];

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

  function makeGain(initialGain: number): GainMock {
    const gain: GainMock = {
      gain: {
        value: initialGain,
        cancelScheduledValues: vi.fn(),
        setValueAtTime: vi.fn((value: number) => {
          gain.gain.value = value;
        }),
      },
      connect: vi.fn(() => gain),
      dispose: vi.fn(),
    };
    gains.push(gain);
    return gain;
  }

  return { gains, makeGain, makePlayer, players };
});

vi.mock("./moodFx", () => ({
  getMoodFxInput: () => moodFxMocks.input,
}));

vi.mock("tone", () => {
  return {
    ...toneHarness.createToneModule(),
    Gain: vi.fn(function Gain(initialGain: number) {
      return toneMocks.makeGain(initialGain);
    }),
    Player: vi.fn(function Player(buffer: AudioBuffer) {
      return toneMocks.makePlayer(buffer);
    }),
  };
});

const fakeContext = {
  createBuffer: vi.fn((channels: number, length: number, sampleRate: number) => {
    const data = Array.from({ length: channels }, () => new Float32Array(length));
    return {
      sampleRate,
      length,
      duration: length / sampleRate,
      numberOfChannels: channels,
      getChannelData: (channel: number) => data[channel],
    } as unknown as AudioBuffer;
  }),
} as unknown as AudioContext;

vi.mock("./audio", () => ({
  getAudioContext: () => fakeContext,
}));

import {
  __resetMoodPlayersForTesting,
  scheduleMoodPlayerSwap,
  setCaptureGain,
  stopAllMoodPlayers,
  syncMoodPlayers,
} from "./moodPlayers";
import { makeMoodTake } from "../test-utils/moodFixtures";

function makeBuffer(
  sampleRate: number,
  channels: number,
  fill: (channel: number, sampleIndex: number) => number,
  length: number,
): AudioBuffer {
  const data = Array.from({ length: channels }, (_, channel) => {
    const samples = new Float32Array(length);
    for (let i = 0; i < length; i += 1) samples[i] = fill(channel, i);
    return samples;
  });

  return {
    sampleRate,
    length,
    duration: length / sampleRate,
    numberOfChannels: channels,
    getChannelData: (channel: number) => data[channel],
  } as unknown as AudioBuffer;
}

describe("moodPlayers", () => {
  let defaultAudioBuffer: AudioBuffer;

  beforeEach(() => {
    __resetMoodPlayersForTesting();
    toneMocks.players.length = 0;
    toneMocks.gains.length = 0;
    toneHarness.setImmediate(0);
    toneHarness.setLookahead(0);
    defaultAudioBuffer = makeBuffer(
      48_000,
      1,
      (_channel, sampleIndex) => sampleIndex / 1_000,
      48_000,
    );
    vi.mocked(fakeContext.createBuffer).mockClear();
  });

  it("diffs by takeId and rebuilds only when the take's audio changes", () => {
    const takeA = makeMoodTake({ id: "take-a", audioBuffer: defaultAudioBuffer });
    syncMoodPlayers([{ takeId: "take-a", take: takeA }], 0, 2);
    const first = toneMocks.players[0];

    syncMoodPlayers([{ takeId: "take-a", take: takeA }], 0, 2);
    expect(toneMocks.players).toHaveLength(1);
    expect(first.dispose).not.toHaveBeenCalled();

    const replacement = makeMoodTake({
      id: "take-a",
      audioBuffer: defaultAudioBuffer,
      trimEndMs: 900,
    });
    syncMoodPlayers([{ takeId: "take-a", take: replacement }], 0, 2);
    expect(toneMocks.players).toHaveLength(2);
    expect(first.dispose).toHaveBeenCalledTimes(1);

    const second = toneMocks.players[1];
    syncMoodPlayers([], 0, 2);
    expect(second.stop).toHaveBeenCalledTimes(1);
    expect(second.dispose).toHaveBeenCalledTimes(1);
  });

  it("skips unavailable-audio takes without creating a player", () => {
    const unavailable = makeMoodTake({
      id: "take-muted-by-repair",
      audioBuffer: null,
      audioStatus: "unavailable",
      durationSeconds: 1,
      trimEndMs: 1_000,
    });

    expect(() =>
      syncMoodPlayers([{ takeId: "take-muted-by-repair", take: unavailable }], 0, 2),
    ).not.toThrow();
    expect(toneMocks.players).toHaveLength(0);
  });

  it("pads the trimmed content to the cycleMultiple loop period", () => {
    const source = makeBuffer(48000, 2, (channel, sampleIndex) => {
      return channel === 0 ? sampleIndex : -sampleIndex;
    }, 48000);
    const take = makeMoodTake({
      id: "long-loop",
      audioBuffer: source,
      trimStartMs: 250,
      trimEndMs: 750,
      durationSeconds: 0.5,
      cycleMultiple: 2,
    });

    syncMoodPlayers([{ takeId: "long-loop", take }], 0, 4);

    const player = toneMocks.players[0];
    expect(player.loop).toBe(true);
    expect(player.loopStart).toBe(0);
    expect(player.loopEnd).toBe(8);
    expect(player.buffer.length).toBe(384000);
    expect(player.buffer.duration).toBe(8);
    expect(player.buffer.numberOfChannels).toBe(2);
    expect(player.buffer.getChannelData(0)[0]).toBe(12000);
    expect(player.buffer.getChannelData(1)[0]).toBe(-12000);
    expect(player.buffer.getChannelData(0)[23999]).toBe(35999);
    expect(player.buffer.getChannelData(0)[24000]).toBe(0);
    expect(player.buffer.getChannelData(0)[383999]).toBe(0);
  });

  it.each([
    { now: 10, offset: 0 },
    { now: 11.5, offset: 1.5 },
    { now: 14, offset: 4 },
    { now: 18.1, offset: 0.1 },
  ])("starts immediately with a phase offset for now=$now", (row) => {
    toneHarness.setImmediate(row.now);
    const take = makeMoodTake({
      id: `phase-${row.now}`,
      audioBuffer: defaultAudioBuffer,
      cycleMultiple: 2,
    });

    syncMoodPlayers([{ takeId: take.id, take }], 10, 4);

    const [startAt, offset] = toneMocks.players[0].start.mock.calls[0];
    expect(startAt).toBe(row.now);
    expect(offset).toBeCloseTo(row.offset);
  });

  it("joins immediately just after a cycle boundary instead of waiting a full cycle", () => {
    toneHarness.setImmediate(4.02);
    const take = makeMoodTake({
      id: "late-boundary",
      audioBuffer: defaultAudioBuffer,
      cycleMultiple: 1,
    });

    syncMoodPlayers([{ takeId: "late-boundary", take }], 0, 4);

    const [startAt, offset] = toneMocks.players[0].start.mock.calls[0];
    expect(startAt).toBe(4.02);
    expect(startAt).not.toBe(8);
    expect(offset).toBeCloseTo(0.02);
  });

  it("nudges a take by syncOffsetMs the way Sync Assist is asked: positive starts it later", () => {
    toneHarness.setImmediate(13.9);
    const later = makeMoodTake({
      id: "later",
      audioBuffer: defaultAudioBuffer,
      cycleMultiple: 1,
      syncOffsetMs: 250,
    });

    // 3.9 s into the cycle, a take started 250 ms later is 3.65 s in.
    syncMoodPlayers([{ takeId: "later", take: later }], 10, 4);
    {
      const [startAt, offset] = toneMocks.players[0].start.mock.calls[0];
      expect(startAt).toBe(13.9);
      expect(offset).toBeCloseTo(3.65);
    }

    // Started 250 ms earlier, it has wrapped: 0.15 s into its next pass.
    const earlier = makeMoodTake({
      id: "earlier",
      audioBuffer: defaultAudioBuffer,
      cycleMultiple: 1,
      syncOffsetMs: -250,
    });
    syncMoodPlayers([{ takeId: "earlier", take: earlier }], 10, 4);
    {
      const [startAt, offset] = toneMocks.players[1].start.mock.calls[0];
      expect(startAt).toBe(13.9);
      expect(offset).toBeCloseTo(0.15);
    }
  });

  it.each([44_100, 48_000])(
    "builds a loop buffer that holds the whole period at every Click tempo (%i Hz)",
    (sampleRate) => {
      const buffer = makeBuffer(sampleRate, 1, () => 0.5, sampleRate);
      for (const bpm of [70, 80, 90, 100, 110, 120, 130, 140, 150, 160]) {
        for (const bars of [1, 2, 4]) {
          for (const cycleMultiple of [0.5, 1, 2, 4] as const) {
            const cycleSeconds = (bars * 4 * 60) / bpm;
            const take = makeMoodTake({
              id: `take-${bpm}-${bars}-${cycleMultiple}`,
              audioBuffer: buffer,
              cycleMultiple,
            });
            syncMoodPlayers([{ takeId: take.id, take }], 0, cycleSeconds);
            const player = toneMocks.players[toneMocks.players.length - 1];
            expect(player.loopEnd).toBe(cycleMultiple * cycleSeconds);
            expect(player.buffer.duration).toBeGreaterThanOrEqual(player.loopEnd);
          }
        }
      }
    },
  );

  it("creates one shared capture gain node and routes players through it", () => {
    setCaptureGain(true);
    expect(toneMocks.gains).toHaveLength(1);
    expect(toneMocks.gains[0].gain.value).toBe(0);
    expect(toneMocks.gains[0].connect).toHaveBeenCalledWith(moodFxMocks.input);

    const takeA = makeMoodTake({ id: "take-a", audioBuffer: defaultAudioBuffer });
    const takeB = makeMoodTake({ id: "take-b", audioBuffer: defaultAudioBuffer });
    syncMoodPlayers(
      [
        { takeId: "take-a", take: takeA },
        { takeId: "take-b", take: takeB },
      ],
      0,
      2,
    );

    expect(toneMocks.gains).toHaveLength(1);
    expect(toneMocks.players[0].connect).toHaveBeenCalledWith(toneMocks.gains[0]);
    expect(toneMocks.players[1].connect).toHaveBeenCalledWith(toneMocks.gains[0]);

    setCaptureGain(false);
    expect(toneMocks.gains[0].gain.value).toBe(1);
  });

  it("switches the capture gain on the audio clock's current time, not one lookahead later", () => {
    toneHarness.setLookahead(0.1);
    toneHarness.setImmediate(4);

    setCaptureGain(true);

    const gain = toneMocks.gains[0].gain;
    expect(gain.cancelScheduledValues).toHaveBeenCalledWith(4);
    expect(gain.setValueAtTime).toHaveBeenLastCalledWith(0, 4);

    toneHarness.setImmediate(9);
    setCaptureGain(false);
    expect(gain.setValueAtTime).toHaveBeenLastCalledWith(1, 9);
  });

  describe("boundary swaps scheduled on the audio clock", () => {
    function liveTakes() {
      return {
        takeA: makeMoodTake({ id: "take-a", audioBuffer: defaultAudioBuffer }),
        takeB: makeMoodTake({ id: "take-b", audioBuffer: defaultAudioBuffer }),
      };
    }

    beforeEach(() => {
      toneHarness.setLookahead(0.1);
    });

    it("starts the incoming take at the boundary in phase and stops the outgoing one there", () => {
      const { takeA, takeB } = liveTakes();
      syncMoodPlayers([{ takeId: "take-a", take: takeA }], 0, 2);
      // The lookahead clock has passed the boundary at 4: the swap is final.
      toneHarness.setImmediate(3.95);

      scheduleMoodPlayerSwap("take-a", { takeId: "take-b", take: takeB }, 4, 0, 2);

      const [outgoing, incoming] = toneMocks.players;
      expect(outgoing.stop).toHaveBeenCalledWith(4);
      expect(outgoing.dispose).not.toHaveBeenCalled();
      expect(incoming.start).toHaveBeenCalledWith(4, 0);
      expect(incoming.connect).toHaveBeenCalledWith(toneMocks.gains[0]);
    });

    it("schedules a swap once however often it is asked while locked", () => {
      const { takeA, takeB } = liveTakes();
      syncMoodPlayers([{ takeId: "take-a", take: takeA }], 0, 2);
      toneHarness.setImmediate(3.92);

      scheduleMoodPlayerSwap("take-a", { takeId: "take-b", take: takeB }, 4, 0, 2);
      toneHarness.setImmediate(3.95);
      scheduleMoodPlayerSwap("take-a", { takeId: "take-b", take: takeB }, 4, 0, 2);

      expect(toneMocks.players).toHaveLength(2);
      expect(toneMocks.players[0].stop).toHaveBeenCalledTimes(1);
    });

    it("adopts the scheduled player at the commit instead of starting another late", () => {
      const { takeA, takeB } = liveTakes();
      syncMoodPlayers([{ takeId: "take-a", take: takeA }], 0, 2);
      toneHarness.setImmediate(3.95);
      scheduleMoodPlayerSwap("take-a", { takeId: "take-b", take: takeB }, 4, 0, 2);

      toneHarness.setImmediate(4.01);
      syncMoodPlayers([{ takeId: "take-b", take: takeB }], 0, 2);

      expect(toneMocks.players).toHaveLength(2);
      expect(toneMocks.players[0].dispose).toHaveBeenCalledTimes(1);
      expect(toneMocks.players[1].dispose).not.toHaveBeenCalled();
      expect(toneMocks.players[1].start).toHaveBeenCalledTimes(1);
    });

    it("joins a multi-cycle take mid-period at the boundary's phase", () => {
      const take = makeMoodTake({ id: "take-c", audioBuffer: defaultAudioBuffer, cycleMultiple: 2 });
      toneHarness.setImmediate(1.95);

      scheduleMoodPlayerSwap(null, { takeId: "take-c", take }, 2, 0, 2);

      expect(toneMocks.players[0].start).toHaveBeenCalledWith(2, 2);
    });

    it("starts at the audible time, in phase, when the boundary already passed", () => {
      const { takeA, takeB } = liveTakes();
      syncMoodPlayers([{ takeId: "take-a", take: takeA }], 0, 2);
      toneHarness.setImmediate(4.05);

      scheduleMoodPlayerSwap("take-a", { takeId: "take-b", take: takeB }, 4, 0, 2);

      expect(toneMocks.players[0].stop).toHaveBeenCalledWith(4.05);
      const [startAt, offset] = toneMocks.players[1].start.mock.calls[0];
      expect(startAt).toBe(4.05);
      expect(offset).toBeCloseTo(0.05);
    });

    it("stops the outgoing take for an Off swap and schedules nothing for missing audio", () => {
      const { takeA } = liveTakes();
      const silent = makeMoodTake({ id: "silent", audioStatus: "unavailable", audioBuffer: null });
      syncMoodPlayers([{ takeId: "take-a", take: takeA }], 0, 2);
      toneHarness.setImmediate(3.95);

      scheduleMoodPlayerSwap("take-a", { takeId: "silent", take: silent }, 4, 0, 2);

      expect(toneMocks.players).toHaveLength(1);
      expect(toneMocks.players[0].stop).toHaveBeenCalledWith(4);
    });

    it("leaves a live take alone when the swap keeps the same take", () => {
      const { takeA } = liveTakes();
      syncMoodPlayers([{ takeId: "take-a", take: takeA }], 0, 2);
      toneHarness.setImmediate(3.95);

      scheduleMoodPlayerSwap("take-a", { takeId: "take-a", take: takeA }, 4, 0, 2);

      expect(toneMocks.players).toHaveLength(1);
      expect(toneMocks.players[0].stop).not.toHaveBeenCalled();
    });

    it("replaces a scheduled player whose audio changed before the commit, at the audible time", () => {
      const { takeB } = liveTakes();
      toneHarness.setImmediate(3.95);
      scheduleMoodPlayerSwap(null, { takeId: "take-b", take: takeB }, 4, 0, 2);
      const resynced = { ...takeB, syncOffsetMs: 20 };

      toneHarness.setImmediate(4.01);
      syncMoodPlayers([{ takeId: "take-b", take: resynced }], 0, 2);

      expect(toneMocks.players).toHaveLength(2);
      expect(toneMocks.players[0].dispose).toHaveBeenCalledTimes(1);
      // Not one lookahead later: in phase from now, 20 ms later-synced.
      const [startAt, offset] = toneMocks.players[1].start.mock.calls[0];
      expect(startAt).toBe(4.01);
      expect(offset).toBeCloseTo(1.99);
    });

    it("starts a performance's first players at the epoch, not before it", () => {
      const { takeA } = liveTakes();
      // Play: the epoch is the arm clock's now, a lookahead ahead.
      toneHarness.setImmediate(9.9);

      syncMoodPlayers([{ takeId: "take-a", take: takeA }], 10, 2);

      expect(toneMocks.players[0].start).toHaveBeenCalledWith(10, 0);
    });

    it("swaps A to B and back when a paint stall locks both boundaries at once", () => {
      const { takeA, takeB } = liveTakes();
      syncMoodPlayers([{ takeId: "take-a", take: takeA }], 0, 4);
      // No frame ran between locking 4 and 8: the first one comes at 7.95.
      toneHarness.setImmediate(7.95);
      scheduleMoodPlayerSwap("take-a", { takeId: "take-b", take: takeB }, 4, 0, 4);
      scheduleMoodPlayerSwap("take-b", { takeId: "take-a", take: takeA }, 8, 0, 4);

      syncMoodPlayers([{ takeId: "take-b", take: takeB }], 0, 4);
      toneHarness.setImmediate(8.01);
      syncMoodPlayers([{ takeId: "take-a", take: takeA }], 0, 4);

      const [liveA, playerB, nextA] = toneMocks.players;
      expect(liveA.dispose).toHaveBeenCalledTimes(1);
      expect(playerB.stop).toHaveBeenCalledWith(8);
      expect(playerB.dispose).toHaveBeenCalledTimes(1);
      expect(nextA.start).toHaveBeenCalledWith(8, 0);
      expect(nextA.dispose).not.toHaveBeenCalled();
      expect(toneMocks.players).toHaveLength(3);
    });

    it("disposes a scheduled take that a later locked swap replaces before its commit", () => {
      const { takeA, takeB } = liveTakes();
      toneHarness.setImmediate(3.95);
      scheduleMoodPlayerSwap(null, { takeId: "take-a", take: takeA }, 4, 0, 2);

      scheduleMoodPlayerSwap("take-a", { takeId: "take-b", take: takeB }, 4, 0, 2);
      toneHarness.setImmediate(4.01);
      syncMoodPlayers([{ takeId: "take-b", take: takeB }], 0, 2);

      expect(toneMocks.players).toHaveLength(2);
      expect(toneMocks.players[0].dispose).toHaveBeenCalledTimes(1);
      expect(toneMocks.players[1].dispose).not.toHaveBeenCalled();
    });

    it("disposes a scheduled player whose take does not go live at the commit", () => {
      const { takeA, takeB } = liveTakes();
      syncMoodPlayers([{ takeId: "take-a", take: takeA }], 0, 2);
      toneHarness.setImmediate(3.95);
      scheduleMoodPlayerSwap("take-a", { takeId: "take-b", take: takeB }, 4, 0, 2);

      // take-b was deleted before the boundary: its commit resolved to Off.
      toneHarness.setImmediate(4.01);
      syncMoodPlayers([], 0, 2);

      expect(toneMocks.players[0].dispose).toHaveBeenCalledTimes(1);
      expect(toneMocks.players[1].dispose).toHaveBeenCalledTimes(1);
    });

    it("keeps a live player when only the take's metadata changed", () => {
      const { takeA } = liveTakes();
      syncMoodPlayers([{ takeId: "take-a", take: takeA }], 0, 2);
      const withPoster = { ...takeA, posterUrl: "blob:test/poster-a" };

      toneHarness.setImmediate(4.01);
      syncMoodPlayers([{ takeId: "take-a", take: withPoster }], 0, 2);

      expect(toneMocks.players).toHaveLength(1);
      expect(toneMocks.players[0].dispose).not.toHaveBeenCalled();
    });

    it("adopts a scheduled player whose take only gained metadata before the commit", () => {
      const { takeB } = liveTakes();
      toneHarness.setImmediate(3.95);
      scheduleMoodPlayerSwap(null, { takeId: "take-b", take: takeB }, 4, 0, 2);

      toneHarness.setImmediate(4.01);
      syncMoodPlayers([{ takeId: "take-b", take: { ...takeB, posterUrl: "blob:test/poster-b" } }], 0, 2);

      expect(toneMocks.players).toHaveLength(1);
      expect(toneMocks.players[0].dispose).not.toHaveBeenCalled();
    });

    it("schedules nothing when the incoming take plays the same audio as the live one", () => {
      const { takeA } = liveTakes();
      syncMoodPlayers([{ takeId: "take-a", take: takeA }], 0, 2);
      toneHarness.setImmediate(3.95);

      scheduleMoodPlayerSwap(
        "take-a",
        { takeId: "take-a", take: { ...takeA, posterUrl: "blob:test/poster-a" } },
        4,
        0,
        2,
      );

      expect(toneMocks.players).toHaveLength(1);
      expect(toneMocks.players[0].stop).not.toHaveBeenCalled();
    });

    it("keeps a player scheduled for a later boundary through an earlier commit", () => {
      const { takeA, takeB } = liveTakes();
      // A paint stall: the frame at 5.95 sees swaps locked for 4 and 6.
      toneHarness.setImmediate(5.95);
      scheduleMoodPlayerSwap(null, { takeId: "take-a", take: takeA }, 4, 0, 2);
      scheduleMoodPlayerSwap(null, { takeId: "take-b", take: takeB }, 6, 0, 2);

      syncMoodPlayers([{ takeId: "take-a", take: takeA }], 0, 2);
      toneHarness.setImmediate(6.01);
      syncMoodPlayers(
        [
          { takeId: "take-a", take: takeA },
          { takeId: "take-b", take: takeB },
        ],
        0,
        2,
      );

      expect(toneMocks.players).toHaveLength(2);
      expect(toneMocks.players[1].start).toHaveBeenCalledWith(6, 0);
      expect(toneMocks.players[1].dispose).not.toHaveBeenCalled();
    });

    it("stops a take scheduled for one boundary at the next when both are locked for one mic", () => {
      const { takeA, takeB } = liveTakes();
      toneHarness.setImmediate(5.95);
      scheduleMoodPlayerSwap(null, { takeId: "take-a", take: takeA }, 4, 0, 2);
      scheduleMoodPlayerSwap("take-a", { takeId: "take-b", take: takeB }, 6, 0, 2);

      expect(toneMocks.players[0].stop).toHaveBeenCalledWith(6);
      syncMoodPlayers([{ takeId: "take-a", take: takeA }], 0, 2);
      expect(toneMocks.players[0].dispose).not.toHaveBeenCalled();

      toneHarness.setImmediate(6.01);
      syncMoodPlayers([{ takeId: "take-b", take: takeB }], 0, 2);
      expect(toneMocks.players[0].dispose).toHaveBeenCalledTimes(1);
      expect(toneMocks.players).toHaveLength(2);
    });

    it("keeps a live take sounding until its replacement's later boundary, through an earlier commit", () => {
      const { takeA } = liveTakes();
      syncMoodPlayers([{ takeId: "take-a", take: takeA }], 0, 2);
      const resynced = { ...takeA, syncOffsetMs: 20 };
      // A paint stall: the frame at 3.95 schedules the resync for 4 and
      // drains an earlier boundary, where the store already has the new take.
      toneHarness.setImmediate(3.95);
      scheduleMoodPlayerSwap("take-a", { takeId: "take-a", take: resynced }, 4, 0, 2);

      syncMoodPlayers([{ takeId: "take-a", take: resynced }], 0, 2);
      const [sounding, replacement] = toneMocks.players;
      expect(sounding.dispose).not.toHaveBeenCalled();
      expect(replacement.dispose).not.toHaveBeenCalled();

      toneHarness.setImmediate(4.01);
      syncMoodPlayers([{ takeId: "take-a", take: resynced }], 0, 2);
      expect(sounding.dispose).toHaveBeenCalledTimes(1);
      expect(replacement.dispose).not.toHaveBeenCalled();
      expect(toneMocks.players).toHaveLength(2);
    });

    it("keeps a take's scheduled player when the same take is queued again for the next boundary", () => {
      const { takeA, takeB } = liveTakes();
      syncMoodPlayers([{ takeId: "take-a", take: takeA }], 0, 2);
      toneHarness.setImmediate(13.95);
      scheduleMoodPlayerSwap("take-a", { takeId: "take-b", take: takeB }, 12, 0, 2);

      scheduleMoodPlayerSwap("take-b", { takeId: "take-b", take: takeB }, 14, 0, 2);

      expect(toneMocks.players).toHaveLength(2);
      expect(toneMocks.players[1].stop).not.toHaveBeenCalled();
      expect(toneMocks.players[1].dispose).not.toHaveBeenCalled();
    });

    it("judges scheduled starts against the drain's audio time, not a later clock read", () => {
      const { takeA, takeB } = liveTakes();
      syncMoodPlayers([{ takeId: "take-a", take: takeA }], 0, 2);
      toneHarness.setImmediate(13.95);
      // take-a resyncs at 14; take-b joins mic 1 at 14 too.
      const resynced = { ...takeA, syncOffsetMs: 20 };
      scheduleMoodPlayerSwap("take-a", { takeId: "take-a", take: resynced }, 14, 0, 2);
      scheduleMoodPlayerSwap(null, { takeId: "take-b", take: takeB }, 14, 0, 2);

      // The drain for an earlier boundary runs at 13.999; the clock has
      // crossed 14 by the time the players sync.
      toneHarness.setImmediate(14.001);
      syncMoodPlayers([{ takeId: "take-a", take: resynced }], 0, 2, 13.999);

      const [sounding, replacement, playerB] = toneMocks.players;
      expect(sounding.dispose).not.toHaveBeenCalled();
      expect(replacement.dispose).not.toHaveBeenCalled();
      expect(playerB.dispose).not.toHaveBeenCalled();
    });

    it("disposes scheduled players when the performance stops", () => {
      const { takeB } = liveTakes();
      toneHarness.setImmediate(3.95);
      scheduleMoodPlayerSwap(null, { takeId: "take-b", take: takeB }, 4, 0, 2);

      stopAllMoodPlayers();

      expect(toneMocks.players[0].dispose).toHaveBeenCalledTimes(1);
    });
  });

  it("stops and disposes every mood player", () => {
    const takeA = makeMoodTake({ id: "take-a", audioBuffer: defaultAudioBuffer });
    const takeB = makeMoodTake({ id: "take-b", audioBuffer: defaultAudioBuffer });
    syncMoodPlayers(
      [
        { takeId: "take-a", take: takeA },
        { takeId: "take-b", take: takeB },
      ],
      0,
      2,
    );

    stopAllMoodPlayers();

    expect(toneMocks.players[0].stop).toHaveBeenCalledTimes(1);
    expect(toneMocks.players[0].dispose).toHaveBeenCalledTimes(1);
    expect(toneMocks.players[1].stop).toHaveBeenCalledTimes(1);
    expect(toneMocks.players[1].dispose).toHaveBeenCalledTimes(1);

    syncMoodPlayers([{ takeId: "take-a", take: takeA }], 0, 2);
    expect(toneMocks.players).toHaveLength(3);
  });
});
