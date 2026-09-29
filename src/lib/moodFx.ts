// ABOUTME: Lazy Mood-only master insert for Drop plus live Gate, Echo, and Brake processing.
// ABOUTME: Keeps pad automation and matching visual envelopes on the audible audio clock.
import * as Tone from "tone";
import { useAppStore } from "../store/useAppStore";
import type { MoodFxPreset, MoodKeyMode } from "../types";
import { DROP_BEATS_PER_CYCLE, nextBeatBoundary } from "./moodClock";

export const MOOD_FX_OPEN_FREQUENCY_HZ = 18_000;
export const MOOD_DROP_CLOSED_FREQUENCY_HZ = 380;
export const MOOD_BRAKE_FREQUENCY_HZ = 120;
export const MOOD_BRAKE_GAIN = 0.72;
export const MOOD_ECHO_WET = 0.5;
export const MOOD_HARMONY_WET = 0.5;

export const MOOD_FX_PRESETS: Readonly<
  Record<MoodFxPreset, { dropClosedHz: number; echoFeedback: number }>
> = {
  neutral: { dropClosedHz: MOOD_DROP_CLOSED_FREQUENCY_HZ, echoFeedback: 0.35 },
  sweep: { dropClosedHz: 220, echoFeedback: 0.42 },
  wash: { dropClosedHz: 720, echoFeedback: 0.52 },
};

const DEFAULT_ECHO_DELAY_SECONDS = 0.25;
const GATE_SCHEDULE_AHEAD_BEATS = 2;
const HARMONY_ATTACK_SECONDS = 0.05;
const HARMONY_WINDOW_SIZE = 0.04;

interface MoodFxChain {
  gateGain: Tone.Gain;
  echo: Tone.FeedbackDelay;
  dropFilter: Tone.Filter;
  brakeGain: Tone.Gain;
}

interface MoodHarmonyChain {
  pitchThird: Tone.PitchShift;
  pitchFifth: Tone.PitchShift;
  harmonyGain: Tone.Gain;
  tapsConnected: boolean;
}

interface GateState {
  pressTime: number;
  halfBeatSeconds: number;
  beatSeconds: number;
  held: boolean;
  releaseTime: number | null;
  scheduledThrough: number;
  scheduledGain: 0 | 1;
  repeatEventId: number | null;
}

interface EchoState {
  startTime: number;
  beatSeconds: number;
}

interface BrakeState {
  pressTime: number;
  beatSeconds: number;
  filterAffected: boolean;
  held: boolean;
  releaseTime: number | null;
}

interface HarmonizeState {
  pressTime: number;
  held: boolean;
  releaseTime: number | null;
}

interface ScheduledDropState {
  active: boolean;
  boundaryTime: number;
}

interface MoodFxPadState {
  gateActive: boolean;
  echoActive: boolean;
  brakeActive: boolean;
  harmonizeActive: boolean;
}

const NEUTRAL_PAD_STATE: MoodFxPadState = {
  gateActive: false,
  echoActive: false,
  brakeActive: false,
  harmonizeActive: false,
};

let chain: MoodFxChain | null = null;
let harmonyChain: MoodHarmonyChain | null = null;
let gateState: GateState | null = null;
let echoState: EchoState | null = null;
let brakeState: BrakeState | null = null;
let harmonizeState: HarmonizeState | null = null;
let scheduledDropState: ScheduledDropState | null = null;
let padState: MoodFxPadState = NEUTRAL_PAD_STATE;
const padStateListeners = new Set<() => void>();
let dropClosedFrequencyHz = MOOD_DROP_CLOSED_FREQUENCY_HZ;

function getMoodFxChain(): MoodFxChain {
  if (chain) return chain;

  const gateGain = new Tone.Gain(1);
  const echo = new Tone.FeedbackDelay({
    delayTime: DEFAULT_ECHO_DELAY_SECONDS,
    feedback: MOOD_FX_PRESETS.neutral.echoFeedback,
    wet: 0,
  });
  const dropFilter = new Tone.Filter({
    frequency: MOOD_FX_OPEN_FREQUENCY_HZ,
    type: "lowpass",
  });
  const brakeGain = new Tone.Gain(1);
  gateGain.connect(echo);
  echo.connect(dropFilter);
  dropFilter.connect(brakeGain);
  brakeGain.toDestination();
  chain = { gateGain, echo, dropFilter, brakeGain };
  return chain;
}

function harmonyThirdForMode(mode: MoodKeyMode): number {
  return mode === "minor" ? 3 : 4;
}

function setHarmonyPitches(mode: MoodKeyMode): void {
  if (!harmonyChain) return;
  harmonyChain.pitchThird.pitch = harmonyThirdForMode(mode);
  harmonyChain.pitchFifth.pitch = 7;
}

function getMoodHarmonyChain(mode: MoodKeyMode): MoodHarmonyChain {
  if (harmonyChain) {
    setHarmonyPitches(mode);
    return harmonyChain;
  }
  const fx = getMoodFxChain();
  const pitchThird = new Tone.PitchShift({
    pitch: harmonyThirdForMode(mode),
    windowSize: HARMONY_WINDOW_SIZE,
  });
  const pitchFifth = new Tone.PitchShift({
    pitch: 7,
    windowSize: HARMONY_WINDOW_SIZE,
  });
  const harmonyGain = new Tone.Gain(0);
  pitchThird.connect(harmonyGain);
  pitchFifth.connect(harmonyGain);
  harmonyGain.connect(fx.echo);
  harmonyChain = { pitchThird, pitchFifth, harmonyGain, tapsConnected: false };
  return harmonyChain;
}

function connectHarmonyTaps(harmony: MoodHarmonyChain): void {
  if (harmony.tapsConnected) return;
  const { gateGain } = getMoodFxChain();
  gateGain.connect(harmony.pitchThird);
  gateGain.connect(harmony.pitchFifth);
  harmony.tapsConnected = true;
}

function disconnectHarmonyTaps(): void {
  if (!chain || !harmonyChain?.tapsConnected) return;
  chain.gateGain.disconnect(harmonyChain.pitchThird);
  chain.gateGain.disconnect(harmonyChain.pitchFifth);
  harmonyChain.tapsConnected = false;
}

function assertFiniteSeconds(label: string, value: number): void {
  if (!Number.isFinite(value)) {
    throw new RangeError(`${label} must be finite audio-clock seconds`);
  }
}

function assertPositiveSeconds(label: string, value: number): void {
  assertFiniteSeconds(label, value);
  if (value <= 0) {
    throw new RangeError(`${label} must be greater than zero`);
  }
}

function updatePadState(patch: Partial<MoodFxPadState>): void {
  const next = { ...padState, ...patch };
  if (
    next.gateActive === padState.gateActive &&
    next.echoActive === padState.echoActive &&
    next.brakeActive === padState.brakeActive &&
    next.harmonizeActive === padState.harmonizeActive
  ) {
    return;
  }
  padState = next;
  for (const listener of padStateListeners) listener();
}

function currentPerformanceTiming(): {
  beatSeconds: number;
  cycleSeconds: number;
  epoch: number;
  dropActive: boolean;
} | null {
  const state = useAppStore.getState();
  const piece = state.mood.piece;
  const performance = state.mood.performance;
  if (
    !performance.isPerforming ||
    performance.epoch === null ||
    piece?.cycleSeconds === null ||
    piece?.cycleSeconds === undefined ||
    piece.cycleSeconds <= 0
  ) {
    return null;
  }
  return {
    beatSeconds: piece.cycleSeconds / DROP_BEATS_PER_CYCLE,
    cycleSeconds: piece.cycleSeconds,
    epoch: performance.epoch,
    dropActive: performance.dropActive,
  };
}

function currentPadContext(): ReturnType<typeof currentPerformanceTiming> {
  const state = useAppStore.getState();
  if (state.appMode !== "mood" || state.recording.state !== "idle") return null;
  return currentPerformanceTiming();
}

function currentHarmonizeContext(): {
  timing: NonNullable<ReturnType<typeof currentPerformanceTiming>>;
  mode: MoodKeyMode;
} | null {
  const timing = currentPadContext();
  const mode = useAppStore.getState().mood.piece?.keyEstimate?.mode;
  return timing && mode ? { timing, mode } : null;
}

function clearGateRepeat(): void {
  if (gateState?.repeatEventId === null || gateState?.repeatEventId === undefined) return;
  Tone.getTransport().clear(gateState.repeatEventId);
  gateState.repeatEventId = null;
}

function resetPadScheduleState(): void {
  clearGateRepeat();
  disconnectHarmonyTaps();
  gateState = null;
  echoState = null;
  brakeState = null;
  harmonizeState = null;
  scheduledDropState = null;
  updatePadState(NEUTRAL_PAD_STATE);
}

function resetChainAt(now: number): void {
  if (!chain) return;
  const { gateGain, echo, dropFilter, brakeGain } = chain;
  gateGain.gain.cancelScheduledValues(now);
  gateGain.gain.setValueAtTime(1, now);
  echo.wet.cancelScheduledValues(now);
  echo.wet.setValueAtTime(0, now);
  dropFilter.frequency.cancelScheduledValues(now);
  dropFilter.frequency.setValueAtTime(MOOD_FX_OPEN_FREQUENCY_HZ, now);
  brakeGain.gain.cancelScheduledValues(now);
  brakeGain.gain.setValueAtTime(1, now);
  if (harmonyChain) {
    harmonyChain.harmonyGain.gain.cancelScheduledValues(now);
    harmonyChain.harmonyGain.gain.setValueAtTime(0, now);
  }
}

function schedulePadEnd(
  pad: keyof MoodFxPadState,
  endTime: number,
  isCurrent: () => boolean,
  clearState: () => void,
): void {
  Tone.getDraw().schedule(() => {
    if (!isCurrent()) return;
    clearState();
    updatePadState({ [pad]: false });
  }, endTime);
}

function scheduleGateThrough(targetTime: number): void {
  const state = gateState;
  if (!state) return;
  const { gain } = getMoodFxChain().gateGain;
  const epsilon = state.halfBeatSeconds * 1e-9;
  while (state.scheduledThrough + state.halfBeatSeconds <= targetTime + epsilon) {
    state.scheduledThrough += state.halfBeatSeconds;
    state.scheduledGain = state.scheduledGain === 0 ? 1 : 0;
    gain.setValueAtTime(state.scheduledGain, state.scheduledThrough);
  }
}

function extendGate(audioTime: number): void {
  const state = gateState;
  if (!state?.held) return;
  scheduleGateThrough(audioTime + GATE_SCHEDULE_AHEAD_BEATS * state.beatSeconds);
}

function dropBaseOpenAt(audioTime: number, fallback: boolean): boolean {
  if (scheduledDropState && scheduledDropState.boundaryTime <= audioTime) {
    return scheduledDropState.active;
  }
  return fallback;
}

function brakeAffectsBoundary(boundaryTime: number): boolean {
  if (!brakeState) return false;
  return brakeState.releaseTime === null || boundaryTime < brakeState.releaseTime;
}

// Momentary pads release on the next beat boundary while a performance clock is
// running, or immediately when it is not.
function quantizedReleaseTime(): number {
  const timing = currentPerformanceTiming();
  const now = Tone.immediate();
  return timing ? nextBeatBoundary(timing.epoch, timing.cycleSeconds, now) : now;
}

export function getMoodFxInput(): Tone.Gain {
  return getMoodFxChain().gateGain;
}

export function initializeMoodFxForPerformance(cycleSeconds: number): void {
  assertPositiveSeconds("cycleSeconds", cycleSeconds);
  const now = Tone.immediate();
  const fx = getMoodFxChain();
  const piece = useAppStore.getState().mood.piece;
  const preset = MOOD_FX_PRESETS[piece?.artDirection?.fxPreset ?? "neutral"];
  dropClosedFrequencyHz = preset.dropClosedHz;
  resetPadScheduleState();
  resetChainAt(now);
  const delaySeconds = cycleSeconds / DROP_BEATS_PER_CYCLE / 2;
  fx.echo.delayTime.cancelScheduledValues(now);
  fx.echo.delayTime.setValueAtTime(delaySeconds, now);
  fx.echo.feedback.cancelScheduledValues(now);
  fx.echo.feedback.setValueAtTime(preset.echoFeedback, now);
  if (piece?.keyEstimate) setHarmonyPitches(piece.keyEstimate.mode);
}

export function scheduleMoodDropFilter(
  active: boolean,
  boundaryTime: number,
  beatSeconds: number,
): void {
  assertFiniteSeconds("boundaryTime", boundaryTime);
  assertPositiveSeconds("beatSeconds", beatSeconds);
  scheduledDropState = { active, boundaryTime };

  // Brake owns the filter while held. The Drop intent is retained above and
  // becomes the base restored by Brake's quantized release.
  if (brakeAffectsBoundary(boundaryTime)) return;

  const { frequency } = getMoodFxChain().dropFilter;
  frequency.cancelScheduledValues(boundaryTime);
  frequency.setValueAtTime(MOOD_FX_OPEN_FREQUENCY_HZ, boundaryTime);
  if (!active) {
    frequency.linearRampToValueAtTime(
      dropClosedFrequencyHz,
      boundaryTime + beatSeconds,
    );
  }
}

export function pressMoodGate(): boolean {
  const context = currentPadContext();
  if (!context || gateState?.held) return false;
  const pressTime = Tone.immediate();
  const halfBeatSeconds = context.beatSeconds / 2;
  const { gain } = getMoodFxChain().gateGain;
  gain.cancelScheduledValues(pressTime);
  gain.setValueAtTime(0, pressTime);
  gateState = {
    pressTime,
    halfBeatSeconds,
    beatSeconds: context.beatSeconds,
    held: true,
    releaseTime: null,
    scheduledThrough: pressTime,
    scheduledGain: 0,
    repeatEventId: null,
  };
  scheduleGateThrough(pressTime + GATE_SCHEDULE_AHEAD_BEATS * context.beatSeconds);
  const transport = Tone.getTransport();
  gateState.repeatEventId = transport.scheduleRepeat(
    extendGate,
    context.beatSeconds,
    transport.seconds + context.beatSeconds,
  );
  updatePadState({ gateActive: true });
  return true;
}

export function releaseMoodGate(): boolean {
  const state = gateState;
  if (!state?.held) return false;
  const releaseTime = quantizedReleaseTime();
  state.held = false;
  state.releaseTime = releaseTime;
  clearGateRepeat();
  const { gain } = getMoodFxChain().gateGain;
  gain.cancelScheduledValues(releaseTime);
  gain.setValueAtTime(1, releaseTime);
  schedulePadEnd(
    "gateActive",
    releaseTime,
    () => gateState === state && gateState.releaseTime === releaseTime,
    () => {
      gateState = null;
    },
  );
  return true;
}

export function triggerMoodEcho(): boolean {
  const context = currentPadContext();
  if (!context) return false;
  const startTime = Tone.immediate();
  const endTime = startTime + context.beatSeconds;
  const { wet } = getMoodFxChain().echo;
  wet.cancelScheduledValues(startTime);
  wet.setValueAtTime(0, startTime);
  wet.linearRampToValueAtTime(MOOD_ECHO_WET, startTime + context.beatSeconds / 2);
  wet.linearRampToValueAtTime(0, endTime);
  const state: EchoState = { startTime, beatSeconds: context.beatSeconds };
  echoState = state;
  updatePadState({ echoActive: true });
  schedulePadEnd(
    "echoActive",
    endTime,
    () => echoState === state,
    () => {
      echoState = null;
    },
  );
  return true;
}

export function pressMoodBrake(): boolean {
  const context = currentPadContext();
  if (!context || brakeState?.held) return false;
  const pressTime = Tone.immediate();
  const filterAffected = dropBaseOpenAt(pressTime, context.dropActive);
  const fx = getMoodFxChain();
  fx.brakeGain.gain.cancelScheduledValues(pressTime);
  fx.brakeGain.gain.setValueAtTime(1, pressTime);
  fx.brakeGain.gain.linearRampToValueAtTime(
    MOOD_BRAKE_GAIN,
    pressTime + context.beatSeconds,
  );
  if (filterAffected) {
    fx.dropFilter.frequency.cancelScheduledValues(pressTime);
    fx.dropFilter.frequency.setValueAtTime(MOOD_FX_OPEN_FREQUENCY_HZ, pressTime);
    fx.dropFilter.frequency.linearRampToValueAtTime(
      MOOD_BRAKE_FREQUENCY_HZ,
      pressTime + context.beatSeconds,
    );
  }
  brakeState = {
    pressTime,
    beatSeconds: context.beatSeconds,
    filterAffected,
    held: true,
    releaseTime: null,
  };
  updatePadState({ brakeActive: true });
  return true;
}

export function releaseMoodBrake(): boolean {
  const state = brakeState;
  if (!state?.held) return false;
  const timing = currentPerformanceTiming();
  const now = Tone.immediate();
  const releaseTime = timing
    ? nextBeatBoundary(timing.epoch, timing.cycleSeconds, now)
    : now;
  state.held = false;
  state.releaseTime = releaseTime;
  const fx = getMoodFxChain();
  fx.brakeGain.gain.cancelScheduledValues(releaseTime);
  fx.brakeGain.gain.setValueAtTime(1, releaseTime);
  if (state.filterAffected) {
    const baseOpen = dropBaseOpenAt(releaseTime, timing?.dropActive ?? true);
    fx.dropFilter.frequency.cancelScheduledValues(releaseTime);
    fx.dropFilter.frequency.setValueAtTime(
      baseOpen ? MOOD_FX_OPEN_FREQUENCY_HZ : dropClosedFrequencyHz,
      releaseTime,
    );
  }
  schedulePadEnd(
    "brakeActive",
    releaseTime,
    () => brakeState === state && brakeState.releaseTime === releaseTime,
    () => {
      brakeState = null;
    },
  );
  return true;
}

export function pressMoodHarmonize(): boolean {
  const context = currentHarmonizeContext();
  if (!context || harmonizeState?.held) return false;
  const pressTime = Tone.immediate();
  const harmony = getMoodHarmonyChain(context.mode);
  setHarmonyPitches(context.mode);
  connectHarmonyTaps(harmony);
  harmony.harmonyGain.gain.cancelScheduledValues(pressTime);
  harmony.harmonyGain.gain.setValueAtTime(0, pressTime);
  harmony.harmonyGain.gain.linearRampToValueAtTime(
    MOOD_HARMONY_WET,
    pressTime + HARMONY_ATTACK_SECONDS,
  );
  harmonizeState = { pressTime, held: true, releaseTime: null };
  updatePadState({ harmonizeActive: true });
  return true;
}

export function releaseMoodHarmonize(): boolean {
  const state = harmonizeState;
  if (!state?.held || !harmonyChain) return false;
  const releaseTime = quantizedReleaseTime();
  state.held = false;
  state.releaseTime = releaseTime;
  harmonyChain.harmonyGain.gain.cancelScheduledValues(releaseTime);
  harmonyChain.harmonyGain.gain.setValueAtTime(0, releaseTime);
  schedulePadEnd(
    "harmonizeActive",
    releaseTime,
    () => harmonizeState === state && harmonizeState.releaseTime === releaseTime,
    () => {
      disconnectHarmonyTaps();
      harmonizeState = null;
    },
  );
  return true;
}

export function gateVisualActive(audioTime: number): boolean {
  const state = gateState;
  if (!state || !Number.isFinite(audioTime) || audioTime < state.pressTime) return false;
  if (state.releaseTime !== null && audioTime >= state.releaseTime) return false;
  const phase = Math.floor((audioTime - state.pressTime) / state.halfBeatSeconds);
  return phase % 2 === 0;
}

export function echoVisualLevel(audioTime: number): number {
  const state = echoState;
  if (!state || !Number.isFinite(audioTime)) return 0;
  const elapsed = audioTime - state.startTime;
  if (elapsed < 0 || elapsed >= state.beatSeconds) return 0;
  const halfBeat = state.beatSeconds / 2;
  if (elapsed <= halfBeat) return (elapsed / halfBeat) * MOOD_ECHO_WET;
  return ((state.beatSeconds - elapsed) / halfBeat) * MOOD_ECHO_WET;
}

export function brakeVisualLevel(audioTime: number): number {
  const state = brakeState;
  if (!state || !Number.isFinite(audioTime) || audioTime < state.pressTime) return 0;
  if (state.releaseTime !== null && audioTime >= state.releaseTime) return 0;
  return Math.min(1, (audioTime - state.pressTime) / state.beatSeconds);
}

export function harmonizeVisualLevel(audioTime: number): number {
  const state = harmonizeState;
  if (!state || !Number.isFinite(audioTime) || audioTime < state.pressTime) return 0;
  if (state.releaseTime !== null && audioTime >= state.releaseTime) return 0;
  return Math.min(1, (audioTime - state.pressTime) / HARMONY_ATTACK_SECONDS);
}

export function getMoodFxPadState(): MoodFxPadState {
  return padState;
}

export function subscribeMoodFxPadState(listener: () => void): () => void {
  padStateListeners.add(listener);
  return () => padStateListeners.delete(listener);
}

// Kept under the W2 name so every existing stop/scratch seam now resets the
// whole insert rather than only the Drop filter.
export function resetMoodDropFilter(): void {
  const now = Tone.immediate();
  resetPadScheduleState();
  resetChainAt(now);
}

// The take window is sacred: momentary pad gestures end the instant capture
// begins. The Drop stays as arranged — it is latched performance state, not a
// held gesture — so a Brake that borrowed the filter hands it back to the
// Drop-appropriate frequency instead of forcing it open.
export function suspendMoodPadsForCapture(): void {
  if (!gateState && !echoState && !brakeState && !harmonizeState) return;
  const now = Tone.immediate();
  const restoreClosed =
    brakeState?.filterAffected === true &&
    !dropBaseOpenAt(now, currentPerformanceTiming()?.dropActive ?? true);
  clearGateRepeat();
  if (chain) {
    chain.gateGain.gain.cancelScheduledValues(now);
    chain.gateGain.gain.setValueAtTime(1, now);
    chain.echo.wet.cancelScheduledValues(now);
    chain.echo.wet.setValueAtTime(0, now);
    chain.brakeGain.gain.cancelScheduledValues(now);
    chain.brakeGain.gain.setValueAtTime(1, now);
    if (brakeState?.filterAffected) {
      chain.dropFilter.frequency.cancelScheduledValues(now);
      chain.dropFilter.frequency.setValueAtTime(
        restoreClosed ? dropClosedFrequencyHz : MOOD_FX_OPEN_FREQUENCY_HZ,
        now,
      );
    }
  }
  if (harmonyChain) {
    harmonyChain.harmonyGain.gain.cancelScheduledValues(now);
    harmonyChain.harmonyGain.gain.setValueAtTime(0, now);
  }
  disconnectHarmonyTaps();
  gateState = null;
  echoState = null;
  brakeState = null;
  harmonizeState = null;
  updatePadState(NEUTRAL_PAD_STATE);
}

function disposeMoodFx(): void {
  if (harmonyChain) {
    const ownedHarmony = harmonyChain;
    disconnectHarmonyTaps();
    harmonyChain = null;
    ownedHarmony.pitchThird.dispose();
    ownedHarmony.pitchFifth.dispose();
    ownedHarmony.harmonyGain.dispose();
  }
  if (!chain) return;
  const owned = chain;
  chain = null;
  owned.gateGain.dispose();
  owned.echo.dispose();
  owned.dropFilter.dispose();
  owned.brakeGain.dispose();
}

export function __resetMoodFxForTesting(): void {
  resetPadScheduleState();
  disposeMoodFx();
  dropClosedFrequencyHz = MOOD_DROP_CLOSED_FREQUENCY_HZ;
}
