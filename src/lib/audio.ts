// ABOUTME: Tone.js bootstrap, Transport scheduling, and play/stop control for Hyperactive Amateur.
// ABOUTME: Owns per-track Tone.Players for recorded clips plus a fallback metronome.
import * as Tone from "tone";
import { useAppStore } from "../store/useAppStore";
import { claimPendingAudible } from "./audibleActionGate";
import { ensureAudioRunning } from "./audioLifecycle";
import { abortActiveExport } from "./exportSession";
import * as videoEngine from "./videoEngine";
import type { Clip, Track } from "../types";

// Per-track pitches let you hear which tracks are firing while a track has no
// recorded clip. They keep the sequencer audible during build-up phases.
const TRACK_PITCHES = ["C2", "D2", "E2", "F2", "G2", "A2", "B2", "C3"];

let initialized = false;
let metronomeSynths: Tone.MembraneSynth[] = [];
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

  metronomeSynths = TRACK_PITCHES.map(
    () => new Tone.MembraneSynth({ volume: -10 }).toDestination(),
  );

  // Build any Tone.Players for clips that already exist (rehydrate path).
  syncPlayers(useAppStore.getState().project.tracks);

  scheduledEventId = transport.scheduleRepeat((time) => {
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
    }
  });
}

// Per-step trigger logic. If the track has a Tone.Player, fire that with the
// trim offsets; otherwise fall back to the placeholder synth.
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

  const player = players.get(trackId);
  if (player && player.loaded && track.clip) {
    const offset = track.clip.trimStartMs / 1000;
    const duration = Math.max(0.01, (track.clip.trimEndMs - track.clip.trimStartMs) / 1000);
    try {
      player.start(when, offset, duration);
    } catch {
      // Player can reject restart-too-soon at the same time slot; safe to swallow.
    }
    if (track.showVideo) videoEngine.trigger(trackId, when, displayStartTime);
    useAppStore.getState().actions.markTriggered(trackId);
    return;
  }

  const synth = metronomeSynths[trackId];
  if (synth) synth.triggerAttackRelease(TRACK_PITCHES[trackId], "16n", when, track.volume);
  useAppStore.getState().actions.markTriggered(trackId);
}

export async function triggerTrackNow(trackId: number): Promise<void> {
  const release = claimPendingAudible();
  if (!release) return;

  try {
    await ensureAudioRunning();
    if (!canStartAfterPendingAudible()) return;
    triggerTrack(trackId, nowSeconds(), Tone.immediate());
  } finally {
    release();
  }
}

export function nowSeconds(): number {
  return Tone.now();
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

    if (track.clip) {
      const player = new Tone.Player(track.clip.audioBuffer).toDestination();
      applyPlayerVolume(player, track.volume);
      players.set(track.id, player);
    }

    lastClips.set(track.id, track.clip);
  }
}

function canStartAfterPendingAudible(): boolean {
  const { playback, recording } = useAppStore.getState();
  return (
    !playback.isPlaying &&
    !playback.isExporting &&
    recording.state === "idle"
  );
}

async function startPlaybackAfterAudioRunning(): Promise<boolean> {
  await ensureAudioRunning();
  if (!canStartAfterPendingAudible()) return false;

  stepCounter = 0;
  Tone.getTransport().position = 0;
  videoEngine.resetPlaybackState();
  useAppStore.getState().actions.setCurrentStep(0);
  Tone.getTransport().start();
  return true;
}

export function stopPlayback(options: { allowExportStop?: boolean } = {}): void {
  if (!options.allowExportStop) {
    abortActiveExport("Export was interrupted by a playback stop.");
  }
  Tone.getTransport().stop();
  Tone.getTransport().position = 0;
  stepCounter = 0;
  videoEngine.resetPlaybackState();
  useAppStore.getState().actions.setCurrentStep(0);
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
  players = new Map();
  lastClips = new Map();
  metronomeSynths = [];
  initialized = false;
  stepCounter = 0;
}
