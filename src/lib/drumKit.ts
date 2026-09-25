// ABOUTME: The drum kit that plays on tracks without a recorded clip: eleven named voices in a role-grouped cycle, a default per track position.
// ABOUTME: Tone construction stays behind make(), so components import names and tags without touching audio.
import * as Tone from "tone";
import type { Tag } from "../types";

// Every voice but the cowbell triggers for a sixteenth; a voice's length is
// its envelope, not this.
const DURATION = "16n";
// The level the original kit plays at; newer voices set their own, since
// the ones in a phone speaker's loudest range would drown the kicks.
const VOLUME_DB = -10;

export interface DrumVoice {
  trigger(when: number, velocity: number): void;
  dispose(): void;
}

export interface KitVoice {
  // Stable id stored with the project; the name is what the UI shows.
  id: string;
  name: string;
  // The family Suggest is told for a track playing this voice.
  tag: Tag;
  make(): DrumVoice;
}

// Typed from the constructors, so an unknown option key is a compile error
// (Tone's optionsFromArguments would drop it silently at run time).
type MembraneOptions = NonNullable<ConstructorParameters<typeof Tone.MembraneSynth>[0]>;
type MetalOptions = NonNullable<ConstructorParameters<typeof Tone.MetalSynth>[0]>;
type NoiseOptions = NonNullable<ConstructorParameters<typeof Tone.NoiseSynth>[0]>;
type SynthOptions = NonNullable<ConstructorParameters<typeof Tone.Synth>[0]>;
type FilterOptions = Partial<Tone.FilterOptions>;

function membrane(note: string, options: MembraneOptions): DrumVoice {
  const synth = new Tone.MembraneSynth({ volume: VOLUME_DB, ...options }).toDestination();
  return {
    trigger: (when, velocity) => {
      synth.triggerAttackRelease(note, DURATION, when, velocity);
    },
    dispose: () => {
      synth.dispose();
    },
  };
}

// MetalSynth has no frequency option (its frequency is a Signal set by
// the trigger note), so the pitch travels with each trigger.
function metal(hz: number, options: MetalOptions): DrumVoice {
  const synth = new Tone.MetalSynth({ volume: VOLUME_DB, ...options }).toDestination();
  return {
    trigger: (when, velocity) => {
      synth.triggerAttackRelease(hz, DURATION, when, velocity);
    },
    dispose: () => {
      synth.dispose();
    },
  };
}

function noise(options: NoiseOptions): DrumVoice {
  const synth = new Tone.NoiseSynth({ volume: VOLUME_DB, ...options }).toDestination();
  return {
    trigger: (when, velocity) => {
      synth.triggerAttackRelease(DURATION, when, velocity);
    },
    dispose: () => {
      synth.dispose();
    },
  };
}

// Hats and the shaker are white noise through a filter rather than
// MetalSynths: a MetalSynth hit starts six FM oscillator pairs, too much DSP
// for a phone running several of them on 16ths while it records an export.
function filteredNoise(options: NoiseOptions, filterOptions: FilterOptions): DrumVoice {
  const filter = new Tone.Filter(filterOptions).toDestination();
  const synth = new Tone.NoiseSynth({ noise: { type: "white" }, volume: VOLUME_DB, ...options }).connect(filter);
  return {
    trigger: (when, velocity) => {
      synth.triggerAttackRelease(DURATION, when, velocity);
    },
    dispose: () => {
      synth.dispose();
      filter.dispose();
    },
  };
}

// The 808 cowbell: two square tones through a band-pass. It holds a fixed
// time (its sustain is not zero), so its length does not follow the tempo.
const COWBELL_HZ = [540, 800] as const;
const COWBELL_HOLD_S = 0.1;

function cowbell(): DrumVoice {
  const filter = new Tone.Filter({ type: "bandpass", frequency: 1000, Q: 2 }).toDestination();
  const tone: SynthOptions = {
    oscillator: { type: "square" },
    envelope: { attack: 0.001, decay: 0.05, sustain: 0.3, release: 0.2 },
    volume: -18,
  };
  const synths = COWBELL_HZ.map(() => new Tone.Synth(tone).connect(filter));
  return {
    trigger: (when, velocity) => {
      synths.forEach((synth, i) => synth.triggerAttackRelease(COWBELL_HZ[i], COWBELL_HOLD_S, when, velocity));
    },
    dispose: () => {
      for (const synth of synths) synth.dispose();
      filter.dispose();
    },
  };
}

// The cycle order, grouped by role: lows, backbeats, tops, percussion.
export const KIT: readonly KitVoice[] = [
  { id: "kick", name: "kick", tag: "kick", make: () => membrane("A1", { pitchDecay: 0.05, octaves: 6, envelope: { decay: 0.3 } }) },
  { id: "thump", name: "thump", tag: "kick", make: () => membrane("C2", { pitchDecay: 0.08, octaves: 8, envelope: { decay: 0.2 } }) },
  { id: "snare", name: "snare", tag: "snare", make: () => noise({ noise: { type: "white" }, envelope: { decay: 0.15 } }) },
  { id: "clap", name: "clap", tag: "snare", make: () => noise({ noise: { type: "pink" }, envelope: { decay: 0.2 } }) },
  {
    id: "rim",
    name: "rim",
    tag: "snare",
    make: () =>
      membrane("E5", {
        oscillator: { type: "square" },
        pitchDecay: 0.008,
        octaves: 2,
        envelope: { attack: 0.001, decay: 0.05, sustain: 0, release: 0.02 },
        volume: -16,
      }),
  },
  { id: "hat", name: "hat", tag: "hat", make: () => filteredNoise({ envelope: { decay: 0.05 } }, { type: "highpass", frequency: 7000 }) },
  { id: "tick", name: "tick", tag: "hat", make: () => filteredNoise({ envelope: { decay: 0.08 } }, { type: "highpass", frequency: 9000 }) },
  { id: "open-hat", name: "open hat", tag: "hat", make: () => filteredNoise({ envelope: { decay: 0.3 } }, { type: "highpass", frequency: 7000 }) },
  {
    id: "shaker",
    name: "shaker",
    tag: "hat",
    make: () =>
      filteredNoise(
        { envelope: { attack: 0.03, decay: 0.08, sustain: 0, release: 0.02 }, volume: -12 },
        { type: "bandpass", frequency: 5000, Q: 1.5 },
      ),
  },
  { id: "ride", name: "ride", tag: "hat", make: () => metal(250, { envelope: { decay: 0.8, release: 0.5 }, harmonicity: 3, resonance: 3000 }) },
  { id: "cowbell", name: "cowbell", tag: "fx", make: cowbell },
];

// The voice each track position plays until the user picks another.
export const DEFAULT_VOICES: readonly string[] = ["kick", "hat", "snare", "open-hat", "thump", "tick", "clap", "ride"];

const BY_ID = new Map(KIT.map((voice) => [voice.id, voice]));

export function isVoiceId(id: unknown): id is string {
  return typeof id === "string" && BY_ID.has(id);
}

// The track's chosen voice, or its position default when it has none (or
// one this build does not know).
export function voiceFor(track: { id: number; voice?: string }): KitVoice {
  return (track.voice !== undefined && BY_ID.get(track.voice)) || BY_ID.get(DEFAULT_VOICES[track.id])!;
}

export function nextVoiceId(id: string): string {
  const index = KIT.findIndex((voice) => voice.id === id);
  return KIT[(index + 1) % KIT.length].id;
}
