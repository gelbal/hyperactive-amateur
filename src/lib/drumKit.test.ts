// ABOUTME: drumKit tests — eight named voices by track position, built lazily with exact Tone options.
// ABOUTME: Tone is mocked; each voice is checked for its constructor, options object, trigger shape and dispose.
import { describe, it, expect, vi, beforeEach } from "vitest";

interface NodeMock {
  triggerAttackRelease: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
  toDestination: ReturnType<typeof vi.fn>;
  connect: ReturnType<typeof vi.fn>;
}
const { synthInstances, filterInstances, makeSynth, makeFilter } = vi.hoisted(() => {
  const synthInstances: NodeMock[] = [];
  const filterInstances: NodeMock[] = [];
  const makeNode = (): NodeMock => {
    const n: NodeMock = {
      triggerAttackRelease: vi.fn(),
      dispose: vi.fn(),
      toDestination: vi.fn(() => n),
      connect: vi.fn(() => n),
    };
    return n;
  };
  const makeSynth = (): NodeMock => {
    const n = makeNode();
    synthInstances.push(n);
    return n;
  };
  const makeFilter = (): NodeMock => {
    const n = makeNode();
    filterInstances.push(n);
    return n;
  };
  return { synthInstances, filterInstances, makeSynth, makeFilter };
});

vi.mock("tone", () => ({
  MembraneSynth: vi.fn(function MembraneSynth() {
    return makeSynth();
  }),
  MetalSynth: vi.fn(function MetalSynth() {
    return makeSynth();
  }),
  NoiseSynth: vi.fn(function NoiseSynth() {
    return makeSynth();
  }),
  Filter: vi.fn(function Filter() {
    return makeFilter();
  }),
}));

import * as Tone from "tone";
import { KIT } from "./drumKit";

// Captured before any beforeEach clears the mocks: components import KIT
// for names and tags, so importing it must build no synth.
const builtAtImport = [Tone.MembraneSynth, Tone.MetalSynth, Tone.NoiseSynth, Tone.Filter].map(
  (ctor) => vi.mocked(ctor).mock.calls.length,
);

describe("drumKit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    synthInstances.length = 0;
    filterInstances.length = 0;
  });

  it("builds nothing at import, so components can read names and tags", () => {
    expect(builtAtImport).toEqual([0, 0, 0, 0]);
  });

  it("has eight voices by track position with plain names and tag families", () => {
    expect(KIT.map((v) => v.name)).toEqual([
      "kick",
      "hat",
      "snare",
      "open hat",
      "kick 2",
      "hat 2",
      "clap",
      "ride",
    ]);
    expect(KIT.map((v) => v.tag)).toEqual([
      "kick",
      "hat",
      "snare",
      "hat",
      "kick",
      "hat",
      "snare",
      "hat",
    ]);
  });

  it.each([
    [0, "MembraneSynth", { pitchDecay: 0.05, octaves: 6, envelope: { decay: 0.3 } }, ["A1", "16n", 0.25, 0.5]],
    [2, "NoiseSynth", { noise: { type: "white" }, envelope: { decay: 0.15 } }, ["16n", 0.25, 0.5]],
    [4, "MembraneSynth", { pitchDecay: 0.08, octaves: 8, envelope: { decay: 0.2 } }, ["C2", "16n", 0.25, 0.5]],
    [6, "NoiseSynth", { noise: { type: "pink" }, envelope: { decay: 0.2 } }, ["16n", 0.25, 0.5]],
    [7, "MetalSynth", { envelope: { decay: 0.8, release: 0.5 }, harmonicity: 3, resonance: 3000 }, [250, "16n", 0.25, 0.5]],
  ] as const)(
    "voice %i is a %s built with exactly its options at -10 dB, routed out, triggered and disposed",
    (index, synth, options, triggerArgs) => {
      const voice = KIT[index].make();

      const ctor = Tone[synth] as unknown as ReturnType<typeof vi.fn>;
      expect(ctor).toHaveBeenCalledTimes(1);
      // optionsFromArguments drops unknown keys silently, so the exact
      // object is pinned here.
      expect(ctor).toHaveBeenCalledWith({ ...options, volume: -10 });
      expect(synthInstances[0].toDestination).toHaveBeenCalledTimes(1);
      expect(Tone.Filter).not.toHaveBeenCalled();

      voice.trigger(0.25, 0.5);
      expect(synthInstances[0].triggerAttackRelease).toHaveBeenCalledWith(...triggerArgs);

      voice.dispose();
      expect(synthInstances[0].dispose).toHaveBeenCalledTimes(1);
    },
  );

  // Hats are high-passed noise, not MetalSynths: a MetalSynth hit starts six
  // FM oscillator pairs, too much DSP for a phone with three hats on 16ths.
  it.each([
    [1, 0.05, 7000],
    [3, 0.3, 7000],
    [5, 0.08, 9000],
  ] as const)(
    "voice %i is white noise with a %s s decay through a %i Hz high-pass, triggered and disposed with its filter",
    (index, decay, frequency) => {
      const voice = KIT[index].make();

      expect(Tone.NoiseSynth).toHaveBeenCalledWith({
        noise: { type: "white" },
        envelope: { decay },
        volume: -10,
      });
      expect(Tone.Filter).toHaveBeenCalledWith({ type: "highpass", frequency });
      expect(Tone.MetalSynth).not.toHaveBeenCalled();
      expect(synthInstances[0].connect).toHaveBeenCalledWith(filterInstances[0]);
      expect(synthInstances[0].toDestination).not.toHaveBeenCalled();
      expect(filterInstances[0].toDestination).toHaveBeenCalledTimes(1);

      voice.trigger(0.25, 0.5);
      expect(synthInstances[0].triggerAttackRelease).toHaveBeenCalledWith("16n", 0.25, 0.5);

      voice.dispose();
      expect(synthInstances[0].dispose).toHaveBeenCalledTimes(1);
      expect(filterInstances[0].dispose).toHaveBeenCalledTimes(1);
    },
  );
});
