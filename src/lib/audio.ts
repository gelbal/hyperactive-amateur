// ABOUTME: Tone.js bootstrap, Transport scheduling, and play/stop control for Hyperactive Amateur.
// ABOUTME: Owns per-track Tone.Players for recorded clips plus the drum kit that plays on empty tracks.
import * as Tone from "tone";
import { useAppStore } from "../store/useAppStore";
import { canStartAudibleAction, claimPendingAudible, isPendingAudibleCurrent } from "./audibleActionGate";
import { ensureAudioRunning } from "./audioLifecycle";
import { abortActiveExport } from "./exportSession";
import * as videoEngine from "./videoEngine";
import { voiceFor, type DrumVoice } from "./drumKit";
import type { Clip, Track } from "../types";

// The kit keeps the sequencer audible while a track has no recorded clip:
// each track plays its chosen drum voice (drumKit.ts). One instance per
// track, never shared: a synth started twice at the same time throws.
let initialized = false;
let kit: Array<{ id: string; voice: DrumVoice } | undefined> = [];
// A replaced voice is disposed after this long, so its tail and any hit
// Tone has already scheduled in its lookahead still play.
const VOICE_RETIRE_MS = 1500;
const retiring = new Map<DrumVoice, ReturnType<typeof setTimeout>>();
let moodCountInStrike: Tone.MembraneSynth | null = null;
let moodCountInNoise: Tone.NoiseSynth | null = null;
let moodCountInNoiseFilter: Tone.Filter | null = null;
let players: Map<number, Tone.Player> = new Map();
let lastClips: Map<number, Clip | null> = new Map();
let scheduledEventId: number | null = null;
let bpmUnsubscribe: (() => void) | null = null;
let swingUnsubscribe: (() => void) | null = null;
let tracksUnsubscribe: (() => void) | null = null;
let stepCounter = 0;

export function getAudioContext(): AudioContext {
  return Tone.getContext().rawContext as AudioContext;
}

// Wires up Tone.Transport with a 16th-note loop callback. Idempotent — safe to call
// multiple times (e.g. from React StrictMode-double-invoked effects).
export function initTransport(): void {
  if (initialized) return;
  initialized = true;

  const transport = Tone.getTransport();
  transport.bpm.value = useAppStore.getState().project.bpm;

  syncKit(useAppStore.getState().project.tracks);

  // Build any Tone.Players for clips that already exist (rehydrate path).
  syncPlayers(useAppStore.getState().project.tracks);

  scheduledEventId = transport.scheduleRepeat((time) => {
    // The Transport is shared: while a Mood performance owns it, the Chop
    // pattern (and the kit on empty tracks) stays silent.
    if (useAppStore.getState().mood.performance.isPerforming) return;
    const stepCount = useAppStore.getState().project.stepCount;
    const stepIndex = stepCounter % stepCount;
    stepCounter += 1;

    onStep(stepIndex, time);

    Tone.getDraw().schedule(() => {
      useAppStore.getState().actions.setCurrentStep(stepIndex);
    }, time);
  }, "16n");

  bpmUnsubscribe = useAppStore.subscribe((state, prev) => {
    if (state.project.bpm !== prev.project.bpm) {
      Tone.getTransport().bpm.value = state.project.bpm;
    }
  });

  // Swing applies on 16th notes (smallest grid of the sequencer).
  Tone.getTransport().swingSubdivision = "16n";
  Tone.getTransport().swing = useAppStore.getState().project.swing;
  swingUnsubscribe = useAppStore.subscribe((state, prev) => {
    if (state.project.swing !== prev.project.swing) {
      Tone.getTransport().swing = state.project.swing;
    }
  });

  tracksUnsubscribe = useAppStore.subscribe((state, prev) => {
    if (state.project.tracks !== prev.project.tracks) {
      syncPlayers(state.project.tracks);
      syncKit(state.project.tracks);
    }
  });
}

// Per-step trigger logic. If the track has a Tone.Player, fire that with the
// trim offsets; otherwise play its kit voice.
function onStep(stepIndex: number, time: number): void {
  const tracks = useAppStore.getState().project.tracks;
  for (const track of tracks) {
    if (!track.steps[stepIndex] || track.muted) continue;
    triggerTrack(track.id, time);
  }
}

// Unified trigger entry point used by the Transport, keyboard hook, and pads.
// Stopped pad/key visuals can use a separate audible display time.
export function triggerTrack(trackId: number, when: number, displayStartTime = when): void {
  const track = useAppStore.getState().project.tracks[trackId];
  if (!track || track.muted) return;

  if (track.clip) {
    // A player exists only for a clip with decoded audio; a clip whose audio
    // is unavailable still cuts to its video.
    const player = players.get(trackId);
    if (player?.loaded) {
      const offset = track.clip.trimStartMs / 1000;
      const duration = Math.max(0.01, (track.clip.trimEndMs - track.clip.trimStartMs) / 1000);
      try {
        player.start(when, offset, duration);
      } catch {
        // Player can reject restart-too-soon at the same time slot; safe to swallow.
      }
    }
    if (track.showVideo) videoEngine.trigger(trackId, when, displayStartTime);
  } else {
    // No clip: the track's kit voice. Optional because render tests use this
    // module without initTransport, so the kit is not built there.
    kit[trackId]?.voice.trigger(when, track.volume);
  }
  useAppStore.getState().actions.markTriggered(trackId);
}

type MoodCountInVoice = {
  pitch: string;
  strikeVelocity: number;
  noiseVelocity: number;
};

const MOOD_COUNT_IN_BASE: MoodCountInVoice = {
  pitch: "C5",
  strikeVelocity: 0.36,
  noiseVelocity: 0.18,
};
const MOOD_COUNT_IN_RISE: Record<1 | 2 | 3, MoodCountInVoice> = {
  3: { pitch: "D5", strikeVelocity: 0.4, noiseVelocity: 0.2 },
  2: { pitch: "E5", strikeVelocity: 0.42, noiseVelocity: 0.21 },
  1: { pitch: "G5", strikeVelocity: 0.45, noiseVelocity: 0.23 },
};
const MOOD_COUNT_IN_ACCENT: MoodCountInVoice = {
  pitch: "A5",
  strikeVelocity: 0.6,
  noiseVelocity: 0.32,
};

function ensureMoodCountInVoice(): void {
  if (moodCountInStrike && moodCountInNoise && moodCountInNoiseFilter) return;

  moodCountInStrike = new Tone.MembraneSynth({
    volume: -10,
    pitchDecay: 0.006,
    octaves: 2,
    oscillator: { type: "sine" },
    envelope: { attack: 0.001, decay: 0.045, sustain: 0, release: 0.02 },
  }).toDestination();
  moodCountInNoiseFilter = new Tone.Filter({
    frequency: 4_500,
    type: "highpass",
    Q: 1,
  }).toDestination();
  moodCountInNoise = new Tone.NoiseSynth({
    volume: -18,
    noise: { type: "white" },
    envelope: { attack: 0.001, decay: 0.025, sustain: 0, release: 0.01 },
  });
  moodCountInNoise.connect(moodCountInNoiseFilter);
}

export function triggerMoodCountInTick(
  when: number,
  opts: { beatsRemaining: number; accent: boolean },
): void {
  ensureMoodCountInVoice();
  const voice = opts.accent
    ? MOOD_COUNT_IN_ACCENT
    : opts.beatsRemaining > 3
      ? MOOD_COUNT_IN_BASE
      : MOOD_COUNT_IN_RISE[Math.max(1, opts.beatsRemaining) as 1 | 2 | 3];

  moodCountInStrike?.triggerAttackRelease(voice.pitch, "32n", when, voice.strikeVelocity);
  moodCountInNoise?.triggerAttackRelease(0.025, when, voice.noiseVelocity);
}

export async function triggerTrackNow(trackId: number): Promise<void> {
  const release = claimPendingAudible();
  if (!release) return;

  try {
    await ensureAudioRunning();
    if (!canStartAfterPendingAudible()) return;
    triggerTrack(trackId, Tone.now(), Tone.immediate());
  } finally {
    release();
  }
}

function linearVolumeToDb(volume: number): number {
  const clamped = Math.max(0, Math.min(1, volume));
  if (clamped === 0) return -Infinity;
  return 20 * Math.log10(clamped);
}

function applyPlayerVolume(player: Tone.Player, volume: number): void {
  player.volume.value = linearVolumeToDb(volume);
}

// Diff the current track list against the last clip we wired and create / dispose
// Tone.Players accordingly. Cheap to call repeatedly.
function syncPlayers(tracks: Track[]): void {
  for (const track of tracks) {
    const previousClip = lastClips.get(track.id) ?? null;
    const existing = players.get(track.id);
    if (track.clip === previousClip) {
      if (existing) applyPlayerVolume(existing, track.volume);
      continue;
    }

    if (existing) {
      existing.dispose();
      players.delete(track.id);
    }

    if (track.clip?.audioBuffer) {
      const player = new Tone.Player(track.clip.audioBuffer).toDestination();
      applyPlayerVolume(player, track.volume);
      players.set(track.id, player);
    }

    lastClips.set(track.id, track.clip);
  }
}

// Build each track's voice, rebuilding only a track whose resolved voice id
// changed (an unset choice and its explicit default are the same voice).
function syncKit(tracks: Track[]): void {
  for (const track of tracks) {
    const choice = voiceFor(track);
    const current = kit[track.id];
    if (current?.id === choice.id) continue;
    if (current) retire(current.voice);
    kit[track.id] = { id: choice.id, voice: choice.make() };
  }
}

function retire(voice: DrumVoice): void {
  retiring.set(
    voice,
    setTimeout(() => {
      retiring.delete(voice);
      voice.dispose();
    }, VOICE_RETIRE_MS),
  );
}

// Re-checked after the unlock's await: a tap that was pending when the page
// went hidden must not start sound in the background once audio resumes, nor
// on return when the frozen unlock settles only then. A switch to Mood during
// the unlock drops it too: Mood has no Chop Play to stop it with.
function canStartAfterPendingAudible(): boolean {
  const state = useAppStore.getState();
  return (
    isPendingAudibleCurrent() &&
    !(typeof document !== "undefined" && document.hidden) &&
    state.appMode === "chop" &&
    canStartAudibleAction(state)
  );
}

async function startPlaybackAfterAudioRunning(): Promise<boolean> {
  await ensureAudioRunning();
  if (!canStartAfterPendingAudible()) return false;

  rewindTransport();
  Tone.getTransport().start();
  return true;
}

// Back to step 0 with no staged or displayed cut, for both start and stop.
function rewindTransport(): void {
  Tone.getTransport().position = 0;
  stepCounter = 0;
  videoEngine.resetPlaybackState();
  useAppStore.getState().actions.setCurrentStep(0);
}

export function stopPlayback(options: { allowExportStop?: boolean } = {}): void {
  if (!options.allowExportStop) {
    abortActiveExport("Export was interrupted by a playback stop.");
  }
  Tone.getTransport().stop();
  rewindTransport();
  useAppStore.getState().actions.setIsPlaying(false);
}

export async function togglePlayback(): Promise<void> {
  const state = useAppStore.getState();
  if (state.playback.isExporting) return;
  const isPlaying = state.playback.isPlaying;
  if (isPlaying) {
    stopPlayback();
  } else {
    const release = claimPendingAudible();
    if (!release) return;

    try {
      const started = await startPlaybackAfterAudioRunning();
      if (started) useAppStore.getState().actions.setIsPlaying(true);
    } finally {
      release();
    }
  }
}

// Test-only reset hook so vitest can re-init between cases.
export function __resetAudioForTesting(): void {
  if (scheduledEventId !== null) {
    Tone.getTransport().clear(scheduledEventId);
    scheduledEventId = null;
  }
  if (bpmUnsubscribe) {
    bpmUnsubscribe();
    bpmUnsubscribe = null;
  }
  if (swingUnsubscribe) {
    swingUnsubscribe();
    swingUnsubscribe = null;
  }
  if (tracksUnsubscribe) {
    tracksUnsubscribe();
    tracksUnsubscribe = null;
  }
  for (const player of players.values()) player.dispose();
  moodCountInStrike?.dispose();
  moodCountInNoise?.dispose();
  moodCountInNoiseFilter?.dispose();
  moodCountInStrike = null;
  moodCountInNoise = null;
  moodCountInNoiseFilter = null;
  players = new Map();
  lastClips = new Map();
  for (const entry of kit) entry?.voice.dispose();
  kit = [];
  for (const [voice, timer] of retiring) {
    clearTimeout(timer);
    voice.dispose();
  }
  retiring.clear();
  initialized = false;
  stepCounter = 0;
}
