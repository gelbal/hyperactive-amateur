// ABOUTME: MoodMode — lazy-loaded root shell for the layered-loop Mood mode.
// ABOUTME: Starts with a stage picker, render stage, and Mood practice controls.
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { LayoutGrid, Play, Square, SquareSplitHorizontal } from "lucide-react";
import { BpmDialControl } from "../BpmDial";
import { LoadFailedNotice } from "../LoadFailedNotice";
import { getAudioContext } from "../../lib/audio";
import { LOG_EVENTS, logger } from "../../lib/logger";
import { canStartAudibleAction } from "../../lib/audibleActionGate";
import { runAudibleAction } from "../../lib/audibleActionRunner";
import {
  backfillMoodOneClassification,
  countInBeatSeconds,
  registerMoodRecordingInterrupt,
  stopMoodTakeEarly,
} from "../../lib/moodRecordingFlow";
import { armLens } from "../../lib/moodPerformance";
import {
  registerMoodPerformanceInterrupt,
  startMoodPerformance,
  stopMoodPerformance,
} from "../../lib/moodTransport";
import * as moodRehydrate from "../../lib/moodRehydrate";
import { useMoodKeys } from "../../lib/useMoodKeys";
import {
  cancelActiveRecordingByUser,
  useRecordingEscapeCancel,
} from "../../lib/useRecordingEscapeCancel";
import { useAppStore } from "../../store/useAppStore";
import type {
  MoodLens,
  MoodPiece,
  MoodStageId,
  MoodTimeFeel,
  MoodVibeId,
  RecordingState,
  TakeReceipt,
} from "../../types";
import { RecordingErrorNotice } from "../RecordingErrorNotice";
import { RecordingStatusBar, takeReceiptCopy } from "../RecordingStatusBar";
import { DropPad } from "./DropPad";
import { MoodFxPads } from "./MoodFxPads";
import { MicStrip } from "./MicStrip";
import { MoodOptionsControl } from "./MoodOptions";
import { MoodStage } from "./MoodStage";

const STAGE_LABELS: Record<MoodStageId, string> = {
  corners: "Corners",
  row: "Row",
  stack: "Stack",
};

const STAGE_SUBTITLES: Record<MoodStageId, string> = {
  corners: "2×2 · square video",
  row: "side by side · widescreen video",
  stack: "stacked · vertical video",
};

const STAGE_ORDER: MoodStageId[] = ["corners", "row", "stack"];

type MoodCycleBars = NonNullable<MoodPiece["cycleBars"]>;

type FeelOption = {
  id: Exclude<MoodTimeFeel, "freestyle">;
  label: string;
  subtitle: string;
};

const FEEL_OPTIONS: FeelOption[] = [
  {
    id: "pocket",
    label: "Pocket",
    subtitle: "your first loop sets the length",
  },
  {
    id: "click",
    label: "Click",
    subtitle: "steady tempo you set",
  },
];

const CYCLE_BAR_OPTIONS: MoodCycleBars[] = [1, 2, 4];

const MOOD_HEADER_TICK_MS = 100;
const KEPT_RECEIPT_MS = 1_500;
const DROP_GESTURE_HINT_MS = 4_000;
const HARMONIZE_GESTURE_HINT_MS = 4_000;

let hasShownDropGestureHint = false;
let hasShownHarmonizeGestureHint = false;

const LENS_OPTIONS: {
  id: MoodLens;
  label: string;
  subtitle: string;
  icon: typeof LayoutGrid;
}[] = [
  { id: "wall", label: "Wall", subtitle: "everyone", icon: LayoutGrid },
  {
    id: "splits",
    label: "Splits",
    subtitle: "anchor + wings",
    icon: SquareSplitHorizontal,
  },
  { id: "solo", label: "Solo", subtitle: "one mic per cycle", icon: Square },
];

const VIBE_OPTIONS: {
  id: MoodVibeId;
  label: string;
  swatchClass: string;
  subtitle?: string;
}[] = [
  { id: "clean", label: "Clean", swatchClass: "bg-zinc-500" },
  { id: "print", label: "Print", swatchClass: "bg-stone-300" },
  { id: "mixtape", label: "Mixtape", swatchClass: "bg-orange-800" },
  { id: "blocks", label: "Blocks", swatchClass: "bg-orange-500" },
  { id: "camcorder", label: "Camcorder", swatchClass: "bg-cyan-500" },
  {
    id: "kaleido",
    label: "Kaleido",
    swatchClass: "bg-violet-400",
    subtitle: "mirror funhouse on the beat",
  },
  {
    id: "weave",
    label: "Weave",
    swatchClass: "bg-amber-200",
    subtitle: "worn film swaying in the gate",
  },
  {
    id: "crossroll",
    label: "Crossroll",
    swatchClass: "bg-white",
    subtitle: "the picture rolls on the turnaround",
  },
  { id: "ghost", label: "Ghost", swatchClass: "bg-teal-300" },
  { id: "solar", label: "Solar", swatchClass: "bg-amber-400" },
];

function StageGlyph({ stage }: { stage: MoodStageId }) {
  if (stage === "corners") {
    return (
      <svg viewBox="0 0 64 64" aria-hidden="true" focusable="false" className="h-16 w-16">
        {[6, 34].map((y) =>
          [6, 34].map((x) => (
            <rect
              key={`${x}-${y}`}
              x={x}
              y={y}
              width="24"
              height="24"
              rx="2"
              fill="none"
              stroke="currentColor"
              strokeWidth="4"
            />
          )),
        )}
      </svg>
    );
  }

  if (stage === "row") {
    return (
      <svg viewBox="0 0 64 64" aria-hidden="true" focusable="false" className="h-16 w-16">
        {[4, 24, 44].map((x) => (
          <rect
            key={x}
            x={x}
            y="10"
            width="16"
            height="44"
            rx="2"
            fill="none"
            stroke="currentColor"
            strokeWidth="4"
          />
        ))}
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 64 64" aria-hidden="true" focusable="false" className="h-16 w-16">
      {[4, 24, 44].map((y) => (
        <rect
          key={y}
          x="10"
          y={y}
          width="44"
          height="16"
          rx="2"
          fill="none"
          stroke="currentColor"
          strokeWidth="4"
        />
      ))}
    </svg>
  );
}

function StagePicker({ disabled }: { disabled: boolean }) {
  const createMoodPiece = useAppStore((s) => s.actions.createMoodPiece);
  const [timeFeel, setTimeFeel] = useState<FeelOption["id"]>("pocket");
  const [clickBpm, setClickBpm] = useState(90);
  const [cycleBars, setCycleBars] = useState<MoodCycleBars>(2);

  const birthMood = (stage: MoodStageId) => {
    createMoodPiece(
      stage,
      timeFeel,
      timeFeel === "click" ? { bpm: clickBpm, cycleBars } : undefined,
    );
  };

  return (
    <section className="flex w-full max-w-6xl flex-col items-center gap-5">
      <p className="text-sm font-semibold text-zinc-500">pick your stage</p>
      <div className="grid w-full gap-3 sm:grid-cols-3">
        {STAGE_ORDER.map((stage) => (
          <button
            key={stage}
            type="button"
            disabled={disabled}
            title={disabled ? "frozen during export" : undefined}
            onClick={() => birthMood(stage)}
            className="flex min-h-44 flex-col items-center justify-center gap-3 rounded border border-zinc-800 bg-zinc-900 p-5 text-zinc-200 transition-colors hover:border-orange-500 hover:bg-zinc-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-zinc-800 disabled:hover:bg-zinc-900"
          >
            <span className="text-orange-500">
              <StageGlyph stage={stage} />
            </span>
            <span className="text-lg font-semibold">{STAGE_LABELS[stage]}</span>
            <span className="text-center text-sm text-zinc-500">
              {STAGE_SUBTITLES[stage]}
            </span>
          </button>
        ))}
      </div>

      <div className="flex w-full flex-col gap-3">
        <div role="group" aria-label="Time feel" className="grid gap-2 sm:grid-cols-2">
          {FEEL_OPTIONS.map((feel) => {
            const selected = timeFeel === feel.id;
            return (
              <button
                key={feel.id}
                type="button"
                aria-pressed={selected}
                disabled={disabled}
                title={disabled ? "frozen during export" : undefined}
                onClick={() => setTimeFeel(feel.id)}
                className={
                  "flex min-h-16 flex-col justify-center rounded border px-4 py-3 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 disabled:cursor-not-allowed disabled:opacity-40 " +
                  (selected
                    ? "border-orange-500 bg-orange-500/10 text-orange-100"
                    : "border-zinc-800 bg-zinc-950 text-zinc-300 hover:border-zinc-700 hover:bg-zinc-900")
                }
              >
                <span className="text-sm font-semibold">{feel.label}</span>
                <span className="text-xs text-zinc-500">{feel.subtitle}</span>
              </button>
            );
          })}
        </div>

        {timeFeel === "click" && (
          <div className="flex w-full flex-col gap-4 rounded border border-zinc-800 bg-zinc-950 p-4 sm:flex-row sm:items-center sm:justify-between">
            <BpmDialControl bpm={clickBpm} onChange={setClickBpm} disabled={disabled} />
            <div role="group" aria-label="Cycle bars" className="grid grid-cols-3 gap-2">
              {CYCLE_BAR_OPTIONS.map((bars) => {
                const selected = cycleBars === bars;
                return (
                  <button
                    key={bars}
                    type="button"
                    aria-pressed={selected}
                    disabled={disabled}
                    title={disabled ? "frozen during export" : undefined}
                    onClick={() => setCycleBars(bars)}
                    className={
                      "min-h-11 rounded border px-3 py-2 text-sm font-medium tabular-nums transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 disabled:cursor-not-allowed disabled:opacity-40 " +
                      (selected
                        ? "border-orange-500 bg-orange-500 text-zinc-950"
                        : "border-zinc-700 bg-zinc-900 text-zinc-200 hover:border-zinc-500")
                    }
                  >
                    {bars} {bars === 1 ? "bar" : "bars"}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function moodFeelName(piece: MoodPiece): "Pocket" | "Click" {
  return piece.timeFeel === "click" ? "Click" : "Pocket";
}

function moodLoopBadgeCopy(piece: MoodPiece): string {
  const feel = moodFeelName(piece);
  if (piece.cycleSeconds !== null) {
    return `${feel} · ${piece.cycleSeconds.toFixed(1)}s loop`;
  }
  if (piece.timeFeel === "click" && piece.bpm !== null && piece.cycleBars !== null) {
    return `Click · ${piece.bpm} · ${piece.cycleBars} ${
      piece.cycleBars === 1 ? "bar" : "bars"
    }`;
  }
  return "Pocket · first loop sets the length";
}


function MoodPlayButton({ cycleSeconds }: { cycleSeconds: MoodPiece["cycleSeconds"] }) {
  const isExporting = useAppStore((s) => s.playback.isExporting);
  const recordingState = useAppStore((s) => s.recording.state);
  const isPerforming = useAppStore((s) => s.mood.performance.isPerforming);
  const canStart = useAppStore(canStartAudibleAction);
  const needsCycle = cycleSeconds === null;
  const recordingActive = recordingState !== "idle";
  const disabled = isExporting || recordingActive || (!isPerforming && (needsCycle || !canStart));
  const disabledTitle = !disabled
    ? undefined
    : recordingActive
      ? "locked during capture"
      : isExporting
        ? "frozen during export"
        : needsCycle
          ? "record the One first"
          : "finish the current action first";

  const handleClick = () => {
    if (isExporting || recordingActive) return;
    useAppStore.getState().actions.setLastTakeReceipt(null);
    if (isPerforming) {
      stopMoodPerformance();
      return;
    }
    if (needsCycle || !canStart) return;
    runAudibleAction(startMoodPerformance());
  };

  return (
    <button
      type="button"
      aria-label={isPerforming ? "Stop mood performance" : "Start mood performance"}
      disabled={disabled}
      title={disabledTitle}
      onClick={handleClick}
      className={
        "inline-flex h-10 pointer-coarse:h-11 items-center gap-2 rounded border px-3 text-sm font-semibold transition-colors " +
        "disabled:cursor-not-allowed disabled:border-zinc-800 disabled:bg-zinc-900 disabled:text-zinc-600 " +
        (isPerforming
          ? "border-orange-500 bg-zinc-900 text-orange-500 hover:bg-zinc-800"
          : "border-orange-500 bg-orange-500 text-zinc-950 hover:bg-orange-400")
      }
    >
      {isPerforming ? (
        <Square size={16} fill="currentColor" aria-hidden />
      ) : (
        <Play size={16} fill="currentColor" aria-hidden />
      )}
      <span>{isPerforming ? "Stop" : "Play"}</span>
    </button>
  );
}

function moodNowSeconds(): number {
  return getAudioContext().currentTime;
}

function queryMoodHeaderSlot(): HTMLElement | null {
  if (typeof document === "undefined") return null;
  return document.querySelector<HTMLElement>("[data-mood-header-slot]");
}

function useMoodHeaderSlot(): HTMLElement | null {
  const [slot, setSlot] = useState<HTMLElement | null>(() => queryMoodHeaderSlot());

  useEffect(() => {
    setSlot(queryMoodHeaderSlot());
  }, []);

  return slot;
}

type MoodCaptureIdentity = {
  micId: string;
  label: string;
};

function moodCaptureIdentity(piece: MoodPiece, micId: string): MoodCaptureIdentity | null {
  const micIndex = piece.mics.findIndex((mic) => mic.id === micId);
  if (micIndex < 0) return null;
  const mic = piece.mics[micIndex];
  return {
    micId,
    label: `M${micIndex + 1} · take ${mic.takes.length + 1}`,
  };
}

function moodRecordingBarState(
  recordingState: RecordingState,
  captureEndsAt: number | null,
  audioNow: number,
): "preparing" | "countdown" | "recording" | "finishing" {
  if (recordingState === "preparing" || recordingState === "countdown") {
    return recordingState;
  }
  if (
    recordingState === "reviewing" ||
    (recordingState === "recording" &&
      captureEndsAt !== null &&
      audioNow >= captureEndsAt)
  ) {
    return "finishing";
  }
  return recordingState === "recording" ? "recording" : "finishing";
}

function MoodTakeReceiptChip({
  receipt,
  onDismiss,
}: {
  receipt: TakeReceipt;
  onDismiss: () => void;
}) {
  const copy = takeReceiptCopy(receipt);
  return (
    <div className="flex h-10 shrink-0 items-center gap-1 rounded border border-zinc-800 bg-zinc-900 pl-2 pr-1">
      <span role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {receipt.kind === "kept" ? "take kept" : "take too short, try again"}
      </span>
      <span
        className={`whitespace-nowrap font-mono text-xs font-bold tabular-nums ${
          receipt.kind === "kept" ? "text-orange-500" : "text-red-300"
        }`}
      >
        {copy}
      </span>
      <button
        type="button"
        aria-label="dismiss take note"
        onClick={onDismiss}
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded text-lg leading-none text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 pointer-coarse:min-h-11 pointer-coarse:min-w-11"
      >
        ×
      </button>
    </div>
  );
}

function MoodHeaderCluster({ piece }: { piece: MoodPiece }) {
  const cycleCount = useAppStore((s) => s.mood.performance.cycleCount);
  const hotMicId = useAppStore((s) => s.mood.performance.hotMicId);
  const monitorWithHeadphones = useAppStore((s) => s.mood.monitorWithHeadphones);
  const recordingState = useAppStore((s) => s.recording.state);
  const countdownEndsAt = useAppStore((s) => s.recording.countdownEndsAt);
  const captureEndsAt = useAppStore((s) => s.recording.captureEndsAt);
  const lastTakeReceipt = useAppStore((s) => s.recording.lastTakeReceipt);
  const setLastTakeReceipt = useAppStore((s) => s.actions.setLastTakeReceipt);
  const [audioNow, setAudioNow] = useState(() => moodNowSeconds());
  const captureIdentityRef = useRef<MoodCaptureIdentity | null>(null);
  const lastTakeReceiptRef = useRef(lastTakeReceipt);
  lastTakeReceiptRef.current = lastTakeReceipt;

  if (hotMicId) {
    const nextIdentity = moodCaptureIdentity(piece, hotMicId);
    if (
      nextIdentity &&
      (recordingState === "preparing" ||
        captureIdentityRef.current === null ||
        captureIdentityRef.current.micId !== hotMicId)
    ) {
      captureIdentityRef.current = nextIdentity;
    }
  }

  useEffect(() => {
    setAudioNow(moodNowSeconds());
    if (recordingState !== "recording") return;
    const id = window.setInterval(() => setAudioNow(moodNowSeconds()), MOOD_HEADER_TICK_MS);
    return () => window.clearInterval(id);
  }, [recordingState]);

  useEffect(() => {
    if (lastTakeReceipt?.kind !== "kept") return;
    const id = window.setTimeout(() => setLastTakeReceipt(null), KEPT_RECEIPT_MS);
    return () => window.clearTimeout(id);
  }, [lastTakeReceipt, setLastTakeReceipt]);

  useEffect(
    () => () => {
      if (lastTakeReceiptRef.current?.kind === "kept") {
        useAppStore.getState().actions.setLastTakeReceipt(null);
      }
    },
    [],
  );

  const showRecordingBar = recordingState !== "idle";
  if (showRecordingBar) {
    const identity =
      captureIdentityRef.current ??
      (hotMicId ? moodCaptureIdentity(piece, hotMicId) : null) ?? {
        micId: piece.mics[0]?.id ?? "mic-0",
        label: "M1 · take 1",
      };
    const currentAudioNow =
      recordingState === "recording" ? Math.max(audioNow, moodNowSeconds()) : audioNow;
    const barState = moodRecordingBarState(
      recordingState,
      captureEndsAt,
      currentAudioNow,
    );

    return (
      <RecordingStatusBar
        identity={identity.label}
        state={barState}
        beatSeconds={countInBeatSeconds(piece)}
        countdownEndsAt={countdownEndsAt}
        captureEndsAt={captureEndsAt}
        nowSeconds={moodNowSeconds}
        loopsMuted={
          recordingState === "recording" &&
          !monitorWithHeadphones &&
          piece.cycleSeconds !== null
        }
        onStop={recordingState === "recording" ? stopMoodTakeEarly : undefined}
        onCancel={
          recordingState === "preparing" || recordingState === "countdown"
            ? cancelActiveRecordingByUser
            : undefined
        }
      />
    );
  }

  return (
    <>
      <MoodPlayButton cycleSeconds={piece.cycleSeconds} />
      <span className="text-[10px] text-zinc-500 -ml-2">space</span>
      <span
        role="group"
        aria-label="Time feel"
        className="rounded border border-zinc-800 bg-zinc-950 px-3 py-2 font-mono text-xs tabular-nums text-zinc-300"
      >
        {moodLoopBadgeCopy(piece)}
      </span>
      {piece.cycleSeconds !== null && (
        <span
          role="group"
          aria-label="Mood cycle count"
          title="loops since Play"
          className="rounded border border-zinc-800 bg-zinc-950 px-3 py-2 font-mono text-xs tabular-nums text-orange-500"
        >
          loop {cycleCount}
        </span>
      )}
      {lastTakeReceipt && (
        <MoodTakeReceiptChip
          receipt={lastTakeReceipt}
          onDismiss={() => setLastTakeReceipt(null)}
        />
      )}
      <MoodOptionsControl piece={piece} />
    </>
  );
}

function MoodLensControl({ piece }: { piece: MoodPiece }) {
  const { lens } = piece;
  const isExporting = useAppStore((s) => s.playback.isExporting);
  const recordingState = useAppStore((s) => s.recording.state);
  const armedLens = useAppStore((s) => s.mood.performance.armedLens);
  const disabled = isExporting || recordingState !== "idle";

  return (
    <div
      role="group"
      aria-label="Lens"
      className="inline-flex h-11 rounded border border-zinc-800 bg-zinc-950 p-1"
    >
      {LENS_OPTIONS.map((option) => {
        const selected = lens === option.id;
        const armed = armedLens === option.id;
        const Icon = option.icon;
        const armedDescriptionId = `mood-lens-${option.id}-armed`;
        const title =
          recordingState !== "idle"
            ? `${option.label} lens locked during capture`
            : isExporting
              ? `${option.label} lens frozen during export`
              : `${option.label} lens`;
        return (
          <button
            key={option.id}
            type="button"
            aria-label={`${option.label} lens`}
            aria-pressed={selected}
            aria-describedby={armed ? armedDescriptionId : undefined}
            data-armed={armed ? "true" : undefined}
            disabled={disabled}
            title={title}
            onClick={() => armLens(option.id)}
            className={
              "inline-flex h-full min-w-[5.5rem] flex-col items-center justify-center rounded px-1.5 pointer-coarse:min-h-11 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 disabled:cursor-not-allowed disabled:opacity-40 " +
              (selected
                ? "bg-orange-500 text-zinc-950"
                : armed
                  ? "animate-pulse border border-orange-400/50 text-orange-300 ring-2 ring-orange-500/40 hover:bg-zinc-900"
                  : "text-zinc-300 hover:bg-zinc-900 hover:text-zinc-100")
            }
          >
            <span className="inline-flex items-center gap-1 text-xs font-semibold leading-none">
              <Icon size={13} aria-hidden />
              <span>{option.label}</span>
            </span>
            <span className="mt-0.5 whitespace-nowrap font-mono text-[8px] font-normal leading-none tracking-normal opacity-70">
              {option.subtitle}
            </span>
            {armed ? (
              <span id={armedDescriptionId} className="sr-only">
                armed for next cycle
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

function MoodVibeControl({ vibe }: { vibe: MoodVibeId }) {
  const isExporting = useAppStore((s) => s.playback.isExporting);
  const isPerforming = useAppStore((s) => s.mood.performance.isPerforming);
  const recordingState = useAppStore((s) => s.recording.state);
  const setMoodVibe = useAppStore((s) => s.actions.setMoodVibe);
  const disabled = isExporting || isPerforming || recordingState !== "idle";

  return (
    <div
      role="group"
      aria-label="Vibe"
      className="inline-flex h-11 max-w-full flex-nowrap gap-1 overflow-x-auto rounded border border-zinc-800 bg-zinc-950 p-1"
    >
      {VIBE_OPTIONS.map((option) => {
        const selected = vibe === option.id;
        const vibeTitle = option.subtitle
          ? `${option.label}: ${option.subtitle}`
          : `${option.label} vibe`;
        const title =
          recordingState !== "idle"
            ? `${vibeTitle} locked during capture`
            : isExporting
              ? `${vibeTitle} frozen during export`
              : isPerforming
                ? `${vibeTitle} locked during performance`
                : vibeTitle;
        return (
          <button
            key={option.id}
            type="button"
            aria-label={`${option.label} vibe`}
            aria-pressed={selected}
            disabled={disabled}
            title={title}
            onClick={() => setMoodVibe(option.id)}
            className={
              "inline-flex h-full shrink-0 items-center justify-center gap-1 rounded px-1 text-[11px] font-semibold pointer-coarse:min-h-11 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 disabled:cursor-not-allowed disabled:opacity-40 " +
              (selected
                ? "bg-zinc-900 text-zinc-100 ring-2 ring-orange-500"
                : "text-zinc-300 hover:bg-zinc-900 hover:text-zinc-100")
            }
          >
            <span
              aria-hidden
              className={`h-3 w-3 rounded-sm border border-zinc-950/40 ${option.swatchClass}`}
            />
            {selected ? <span>{option.label}</span> : null}
          </button>
        );
      })}
    </div>
  );
}


function DropPadWithHint({ vibe }: { vibe: MoodVibeId }) {
  const isPerforming = useAppStore((s) => s.mood.performance.isPerforming);
  const recordingState = useAppStore((s) => s.recording.state);
  const wasPerformingRef = useRef(isPerforming);
  const [showHint, setShowHint] = useState(false);

  useEffect(() => {
    const performanceStarted = isPerforming && !wasPerformingRef.current;
    wasPerformingRef.current = isPerforming;
    if (
      !performanceStarted ||
      vibe === "clean" ||
      recordingState !== "idle" ||
      hasShownDropGestureHint
    ) {
      return;
    }
    hasShownDropGestureHint = true;
    setShowHint(true);
  }, [isPerforming, recordingState, vibe]);

  useEffect(() => {
    if (!showHint) return;
    if (recordingState !== "idle") {
      setShowHint(false);
      return;
    }
    const id = window.setTimeout(() => setShowHint(false), DROP_GESTURE_HINT_MS);
    return () => window.clearTimeout(id);
  }, [recordingState, showHint]);

  return (
    <div className="relative shrink-0">
      <DropPad vibe={vibe} />
      {showHint && recordingState === "idle" ? (
        <div
          role="status"
          aria-live="polite"
          className="absolute bottom-[calc(100%+0.5rem)] left-1/2 z-30 w-max max-w-64 -translate-x-1/2 rounded border border-orange-500/60 bg-zinc-950 px-3 py-2 text-center text-xs font-medium text-orange-200 shadow-xl"
        >
          punch the vibe — tap DROP or press D
        </div>
      ) : null}
    </div>
  );
}

function MoodFxPadsWithHint() {
  const isPerforming = useAppStore((s) => s.mood.performance.isPerforming);
  const recordingState = useAppStore((s) => s.recording.state);
  const hasKeyEstimate = useAppStore((s) => Boolean(s.mood.piece?.keyEstimate));
  const enabled = isPerforming && recordingState === "idle" && hasKeyEstimate;
  const wasEnabledRef = useRef(enabled);
  const [showHint, setShowHint] = useState(false);

  useEffect(() => {
    const becameEnabled = enabled && !wasEnabledRef.current;
    wasEnabledRef.current = enabled;
    if (!becameEnabled || hasShownHarmonizeGestureHint) return;
    hasShownHarmonizeGestureHint = true;
    setShowHint(true);
  }, [enabled]);

  useEffect(() => {
    if (!showHint) return;
    if (!enabled) {
      setShowHint(false);
      return;
    }
    const id = window.setTimeout(
      () => setShowHint(false),
      HARMONIZE_GESTURE_HINT_MS,
    );
    return () => window.clearTimeout(id);
  }, [enabled, showHint]);

  return (
    <div className="relative shrink-0">
      <MoodFxPads />
      {showHint && enabled ? (
        <div
          role="status"
          aria-live="polite"
          className="absolute bottom-[calc(100%+0.5rem)] left-1/2 z-30 w-max max-w-64 -translate-x-1/2 rounded border border-orange-500/60 bg-zinc-950 px-3 py-2 text-center text-xs font-medium text-orange-200 shadow-xl"
        >
          Harmonize ready: hold H to layer AI-picked harmony from your own loop
        </div>
      ) : null}
    </div>
  );
}

function MoodPieceControls({ piece }: { piece: MoodPiece }) {
  return (
    <div className="flex w-full flex-col gap-3">
      <MicStrip piece={piece} />
      <div className="flex w-full flex-wrap items-end justify-center gap-x-2 gap-y-3 wide:flex-nowrap wide:justify-start">
        <div className="flex shrink-0 flex-col gap-1">
          <span className="text-[10px] uppercase tracking-widest text-zinc-600">LENS</span>
          <MoodLensControl piece={piece} />
        </div>
        <div className="flex min-w-0 max-w-full shrink-0 flex-col gap-1">
          <span
            data-testid="drop-group-label"
            className="text-[10px] uppercase tracking-widest text-zinc-600"
          >
            DROP
          </span>
          <div
            role="group"
            aria-label="Live effects"
            className="flex max-w-[calc(100vw-1.5rem)] items-center gap-1 overflow-x-auto"
          >
            <DropPadWithHint vibe={piece.vibe} />
            <MoodFxPadsWithHint />
          </div>
        </div>
        <div className="flex min-w-0 flex-col gap-1">
          <span className="text-[10px] uppercase tracking-widest text-zinc-600">VIBE</span>
          <MoodVibeControl vibe={piece.vibe} />
        </div>
      </div>
    </div>
  );
}

function queueMoodPosterJobs(jobs: moodRehydrate.MoodPosterRegenerationJob[] = []): void {
  for (const job of jobs) {
    void job.posterPromise.then((posterBlob) => {
      if (!posterBlob) return;
      const posterUrl = URL.createObjectURL(posterBlob);
      useAppStore
        .getState()
        .actions.attachMoodTakePoster(job.micId, job.takeId, posterBlob, posterUrl);
      // The attach no-ops when exporting or when the take/piece is gone
      // (scratch, delete) — a URL that did not land must be revoked.
      const attached = useAppStore
        .getState()
        .mood.piece?.mics.find((mic) => mic.id === job.micId)
        ?.takes.find((take) => take.id === job.takeId)?.posterUrl;
      if (attached !== posterUrl) URL.revokeObjectURL(posterUrl);
    });
  }
}

// A hydrate abandoned by unmount (mode switch mid-load) must return the
// store to "cold" — re-entry only restarts hydration from there. Guarded so
// a newer mount's completed hydration is never clobbered.
function abandonPendingHydration(decodedPiece: MoodPiece | null = null): void {
  for (const mic of decodedPiece?.mics ?? []) {
    for (const take of mic.takes) {
      if (take.url) URL.revokeObjectURL(take.url);
      if (take.posterUrl) URL.revokeObjectURL(take.posterUrl);
    }
  }
  const state = useAppStore.getState();
  if (state.mood.hydration === "hydrating") {
    state.actions.setMoodHydration("cold");
  }
}

export function MoodMode() {
  useMoodKeys();
  const headerSlot = useMoodHeaderSlot();
  const piece = useAppStore((s) => s.mood.piece);
  const hydration = useAppStore((s) => s.mood.hydration);
  const isExporting = useAppStore((s) => s.playback.isExporting);
  const recordingState = useAppStore((s) => s.recording.state);
  const recordingError = useAppStore((s) => s.recording.error);
  const hydrationStartedRef = useRef(false);
  const backfillRequestedForEntryRef = useRef(false);
  const unmountedRef = useRef(false);
  const recordingActive =
    recordingState === "preparing" || recordingState === "countdown" || recordingState === "recording";
  useRecordingEscapeCancel(recordingActive);

  useEffect(() => {
    const unregisterMoodRecordingInterrupt = registerMoodRecordingInterrupt();
    const unregisterMoodPerformanceInterrupt = registerMoodPerformanceInterrupt();
    unmountedRef.current = false;
    return () => {
      unregisterMoodRecordingInterrupt();
      unregisterMoodPerformanceInterrupt();
      unmountedRef.current = true;
    };
  }, []);

  useEffect(() => {
    if (hydration !== "cold" || hydrationStartedRef.current) return;
    hydrationStartedRef.current = true;
    useAppStore.getState().actions.setMoodHydration("hydrating");
    void moodRehydrate
      .rehydrateMoodFromStorage()
      .then(async (loaded) => {
        if (unmountedRef.current) return abandonPendingHydration();
        if (loaded.ok && loaded.piece) {
          const decoded = await moodRehydrate.decodeMoodTakes(loaded.piece, getAudioContext());
          if (unmountedRef.current) return abandonPendingHydration(decoded.piece);
          // Decode repairs are diagnostics like the load's own; the take's
          // repair state carries the only actionable part.
          if (decoded.warnings.length > 0) {
            logger.info(LOG_EVENTS.RECOVERY_APPLIED, { scope: "mood", warnings: decoded.warnings });
          }
          useAppStore.getState().actions.hydrateMoodPiece(decoded.piece);
          queueMoodPosterJobs(decoded.posterJobs);
          return;
        }
        useAppStore.getState().actions.hydrateMoodPiece(null);
      })
      .catch((err: unknown) => {
        logger.error(LOG_EVENTS.RECOVERY_LOAD_FAILED, {
          scope: "mood",
          message: err instanceof Error ? err.message : String(err),
        });
        if (unmountedRef.current) return abandonPendingHydration();
        // Mood saving stays paused for the session: a write would replace
        // the record that could not be read.
        useAppStore.getState().actions.setMoodHydration("failed");
      });
  }, [hydration]);

  useEffect(() => {
    if (
      hydration !== "ready" ||
      !piece ||
      isExporting ||
      backfillRequestedForEntryRef.current
    ) {
      return;
    }
    backfillRequestedForEntryRef.current = true;
    backfillMoodOneClassification();
  }, [hydration, isExporting, piece]);

  if (hydration === "cold" || hydration === "hydrating") {
    return <div className="text-zinc-500 text-sm">Loading mood...</div>;
  }

  const loadFailedNotice =
    hydration === "failed" ? (
      <LoadFailedNotice
        label="Saved mood could not be opened"
        message="Couldn't open your saved mood — takes won't be saved."
      />
    ) : null;

  if (!piece) {
    return (
      <>
        {loadFailedNotice}
        <StagePicker disabled={isExporting} />
      </>
    );
  }

  // The portaled transport or capture action precedes Mood Export in App's
  // header, then focus moves through main content: stage invitation controls,
  // mic chips, the open StackSheet rows, Lens, Drop, Vibe, and headphones.
  return (
    <>
      {headerSlot ? createPortal(<MoodHeaderCluster piece={piece} />, headerSlot) : null}
      <section className="flex min-h-0 flex-1 w-full max-w-6xl flex-col items-center gap-5">
        {loadFailedNotice}
        <MoodStage piece={piece} />
        <RecordingErrorNotice message={recordingError} />
        <MoodPieceControls piece={piece} />
      </section>
    </>
  );
}

export default MoodMode;
