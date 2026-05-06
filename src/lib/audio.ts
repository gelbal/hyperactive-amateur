// ABOUTME: Tone.js bootstrap, Transport scheduling, and play/stop control for Hyperpad.
// ABOUTME: Single source of audio truth; UI components call into the exported functions.
import * as Tone from "tone";
import { useAppStore } from "../store/useAppStore";

const STEP_COUNT = 16;

// Per-track pitches let you hear which tracks are firing while we're still on
// the placeholder metronome. They get replaced with real Tone.Players in step 12.
const TRACK_PITCHES = ["C2", "D2", "E2", "F2", "G2", "A2", "B2", "C3"];

let initialized = false;
let metronomeSynths: Tone.MembraneSynth[] = [];
let scheduledEventId: number | null = null;
let bpmUnsubscribe: (() => void) | null = null;
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

  scheduledEventId = transport.scheduleRepeat((time) => {
    const stepIndex = stepCounter % STEP_COUNT;
    stepCounter += 1;

    onStep(stepIndex, time);

    // Schedule the UI update on the draw clock so it lands on the right paint.
    Tone.getDraw().schedule(() => {
      useAppStore.getState().actions.setCurrentStep(stepIndex);
    }, time);
  }, "16n");

  bpmUnsubscribe = useAppStore.subscribe((state, prev) => {
    if (state.project.bpm !== prev.project.bpm) {
      Tone.getTransport().bpm.value = state.project.bpm;
    }
  });
}

// Per-step trigger logic. Each track that has its current step toggled on
// (and isn't muted) fires a synth click on its pitch. Real Tone.Players
// will replace this in step 12.
function onStep(stepIndex: number, time: number): void {
  const tracks = useAppStore.getState().project.tracks;
  for (const track of tracks) {
    if (!track.steps[stepIndex] || track.muted) continue;
    const synth = metronomeSynths[track.id];
    if (synth) {
      synth.triggerAttackRelease(TRACK_PITCHES[track.id], "16n", time);
    }
  }
}

export async function startPlayback(): Promise<void> {
  await Tone.start();
  stepCounter = 0;
  Tone.getTransport().start();
}

export function stopPlayback(): void {
  Tone.getTransport().stop();
  stepCounter = 0;
  useAppStore.getState().actions.setCurrentStep(0);
}

export async function togglePlayback(): Promise<void> {
  const isPlaying = useAppStore.getState().playback.isPlaying;
  if (isPlaying) {
    stopPlayback();
    useAppStore.getState().actions.setIsPlaying(false);
  } else {
    await startPlayback();
    useAppStore.getState().actions.setIsPlaying(true);
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
  metronomeSynths = [];
  initialized = false;
  stepCounter = 0;
}
