// ABOUTME: The fixed drum kit that plays on tracks without a recorded clip: one named voice per track position.
// ABOUTME: Tone construction stays behind make(), so components import names and tags without touching audio.
import * as Tone from "tone";
import type { Tag } from "../types";

// One duration for every voice; a voice's length is its envelope, not this.
const DURATION = "16n";
const VOLUME_DB = -10;

export interface DrumVoice {
  trigger(when: number, velocity: number): void;
  dispose(): void;
}

export interface KitVoice {
  name: string;
  tag: Tag;
  make(): DrumVoice;
}

// Typed from the constructors, so an unknown option key is a compile error
// (Tone's optionsFromArguments would drop it silently at run time).
type MembraneOptions = NonNullable<ConstructorParameters<typeof Tone.MembraneSynth>[0]>;
type MetalOptions = NonNullable<ConstructorParameters<typeof Tone.MetalSynth>[0]>;
type NoiseOptions = NonNullable<ConstructorParameters<typeof Tone.NoiseSynth>[0]>;

function membrane(note: string, options: MembraneOptions): DrumVoice {
  const synth = new Tone.MembraneSynth({ ...options, volume: VOLUME_DB }).toDestination();
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
  const synth = new Tone.MetalSynth({ ...options, volume: VOLUME_DB }).toDestination();
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
  const synth = new Tone.NoiseSynth({ ...options, volume: VOLUME_DB }).toDestination();
  return {
    trigger: (when, velocity) => {
      synth.triggerAttackRelease(DURATION, when, velocity);
    },
    dispose: () => {
      synth.dispose();
    },
  };
}

// By track position. The second four are the first four's variation.
export const KIT: readonly KitVoice[] = [
  { name: "kick", tag: "kick", make: () => membrane("A1", { pitchDecay: 0.05, octaves: 6, envelope: { decay: 0.3 } }) },
  { name: "hat", tag: "hat", make: () => metal(200, { envelope: { decay: 0.05 } }) },
  { name: "snare", tag: "snare", make: () => noise({ noise: { type: "white" }, envelope: { decay: 0.15 } }) },
  { name: "open hat", tag: "hat", make: () => metal(200, { envelope: { decay: 0.35 } }) },
  { name: "kick 2", tag: "kick", make: () => membrane("C2", { pitchDecay: 0.08, octaves: 8, envelope: { decay: 0.2 } }) },
  { name: "hat 2", tag: "hat", make: () => metal(320, { envelope: { decay: 0.08 }, resonance: 6000, octaves: 1 }) },
  { name: "clap", tag: "snare", make: () => noise({ noise: { type: "pink" }, envelope: { decay: 0.2 } }) },
  { name: "ride", tag: "hat", make: () => metal(250, { envelope: { decay: 0.8, release: 0.5 }, harmonicity: 3, resonance: 3000 }) },
];
