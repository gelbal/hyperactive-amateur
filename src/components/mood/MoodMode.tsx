// ABOUTME: MoodMode — lazy-loaded root shell for the layered-loop Mood mode.
// ABOUTME: Starts with a stage picker, render stage, and Mood practice controls.
import { useEffect, useRef, useState } from "react";
import { LayoutGrid, Play, Square, SquareSplitHorizontal } from "lucide-react";
import { BpmDialControl } from "../BpmDial";
import { getAudioContext } from "../../lib/audio";
import { canStartAudibleAction } from "../../lib/audibleActionGate";
import { runAudibleAction } from "../../lib/audibleActionRunner";
import { armLens } from "../../lib/moodPerformance";
import { startMoodPerformance, stopMoodPerformance } from "../../lib/moodTransport";
import * as moodRehydrate from "../../lib/moodRehydrate";
import { useMoodKeys } from "../../lib/useMoodKeys";
import { useRecordingEscapeCancel } from "../../lib/useRecordingEscapeCancel";
import { useAppStore } from "../../store/useAppStore";
import type {
  MoodLens,
  MoodPiece,
  MoodStageId,
  MoodTimeFeel,
  MoodVibeId,
} from "../../types";
import { RecordingErrorNotice } from "../RecordingErrorNotice";
import { MicStrip } from "./MicStrip";
import { MoodStage } from "./MoodStage";

const STAGE_LABELS: Record<MoodStageId, string> = {
  corners: "Corners",
  row: "Row",
  stack: "Stack",
};

const STAGE_SUBTITLES: Record<MoodStageId, string> = {
  corners: "Four square mics for tight framing.",
  row: "Two to five portrait mics in a wide row.",
  stack: "Two to five landscape mics in a vertical stack.",
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

const LENS_OPTIONS: { id: MoodLens; label: string; icon: typeof LayoutGrid }[] = [
  { id: "wall", label: "Wall", icon: LayoutGrid },
  { id: "splits", label: "Splits", icon: SquareSplitHorizontal },
];

const VIBE_OPTIONS: { id: MoodVibeId; label: string; swatchClass: string }[] = [
  { id: "clean", label: "Clean", swatchClass: "bg-zinc-500" },
  { id: "blocks", label: "Blocks", swatchClass: "bg-orange-500" },
  { id: "mixtape", label: "Mixtape", swatchClass: "bg-orange-800" },
  { id: "camcorder", label: "Camcorder", swatchClass: "bg-cyan-500" },
  { id: "print", label: "Print", swatchClass: "bg-stone-300" },
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
    <section className="flex w-full max-w-4xl flex-col items-center gap-5">
      <div className="grid w-full gap-3 sm:grid-cols-3">
        {STAGE_ORDER.map((stage) => (
          <button
            key={stage}
            type="button"
            disabled={disabled}
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

function moodFeelLabel(piece: MoodPiece): string {
  if (piece.timeFeel !== "click") return "Pocket";
  if (piece.bpm === null || piece.cycleBars === null) return "Click";
  return `Click · ${piece.bpm} · ${piece.cycleBars} ${piece.cycleBars === 1 ? "bar" : "bars"}`;
}

function ScratchMoodControl({ disabled }: { disabled: boolean }) {
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    if (!armed) return;
    const id = window.setTimeout(() => setArmed(false), 5000);
    return () => window.clearTimeout(id);
  }, [armed]);

  if (!armed) {
    return (
      <button
        type="button"
        disabled={disabled}
        onClick={() => setArmed(true)}
        className="rounded border border-zinc-700 px-3 py-2 text-sm text-zinc-300 transition-colors pointer-coarse:min-h-11 hover:border-zinc-600 hover:bg-zinc-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-zinc-700 disabled:hover:bg-transparent"
      >
        Scratch this mood
      </button>
    );
  }

  return (
    <div className="flex flex-col items-center gap-2">
      <p className="text-center text-xs text-zinc-400">This forgets this mood shell. Sure?</p>
      <div className="flex gap-2">
        <button
          type="button"
          disabled={disabled}
          onClick={() => {
            useAppStore.getState().actions.scratchMoodPiece();
            setArmed(false);
          }}
          className="rounded bg-red-600 px-3 py-2 text-sm font-medium text-white transition-colors pointer-coarse:min-h-11 hover:bg-red-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-300 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-red-600"
        >
          Yes, scratch it
        </button>
        <button
          type="button"
          onClick={() => setArmed(false)}
          className="rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-200 transition-colors pointer-coarse:min-h-11 hover:bg-zinc-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function MoodPlayButton({ cycleSeconds }: { cycleSeconds: MoodPiece["cycleSeconds"] }) {
  const isExporting = useAppStore((s) => s.playback.isExporting);
  const recordingState = useAppStore((s) => s.recording.state);
  const isPerforming = useAppStore((s) => s.mood.performance.isPerforming);
  const canStart = useAppStore(canStartAudibleAction);
  const needsCycle = cycleSeconds === null;
  const recordingActive = recordingState !== "idle";
  const disabled = isExporting || recordingActive || (!isPerforming && (needsCycle || !canStart));

  const handleClick = () => {
    if (isExporting || recordingActive) return;
    if (isPerforming) {
      stopMoodPerformance();
      return;
    }
    if (needsCycle || !canStart) return;
    runAudibleAction(startMoodPerformance());
  };

  return (
    <div className="flex flex-col items-center gap-1">
      <button
        type="button"
        aria-label={isPerforming ? "Stop mood performance" : "Start mood performance"}
        disabled={disabled}
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
      {needsCycle && !isPerforming && (
        <span className="text-xs text-zinc-500">record the One first</span>
      )}
    </div>
  );
}

function MoodLensControl({ lens }: { lens: MoodLens }) {
  const isExporting = useAppStore((s) => s.playback.isExporting);
  const recordingState = useAppStore((s) => s.recording.state);
  const armedLens = useAppStore((s) => s.mood.performance.armedLens);
  const disabled = isExporting || recordingState !== "idle";

  return (
    <div
      role="group"
      aria-label="Mood lens"
      className="inline-flex rounded border border-zinc-800 bg-zinc-950 p-1"
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
              "inline-flex h-9 min-w-24 items-center justify-center gap-2 rounded px-3 text-sm font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 disabled:cursor-not-allowed disabled:opacity-40 " +
              (selected
                ? "bg-orange-500 text-zinc-950"
                : armed
                  ? "animate-pulse border border-orange-400/50 text-orange-300 ring-2 ring-orange-500/40 hover:bg-zinc-900"
                  : "text-zinc-300 hover:bg-zinc-900 hover:text-zinc-100")
            }
          >
            <Icon size={15} aria-hidden />
            <span>{option.label}</span>
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
      aria-label="Mood vibe"
      className="inline-flex max-w-full flex-wrap gap-1 rounded border border-zinc-800 bg-zinc-950 p-1"
    >
      {VIBE_OPTIONS.map((option) => {
        const selected = vibe === option.id;
        const title =
          recordingState !== "idle"
            ? `${option.label} vibe locked during capture`
            : isExporting
              ? `${option.label} vibe frozen during export`
              : isPerforming
                ? `${option.label} vibe locked during performance`
                : `${option.label} vibe`;
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
              "inline-flex h-9 items-center justify-center gap-1.5 rounded px-2.5 text-xs font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 disabled:cursor-not-allowed disabled:opacity-40 " +
              (selected
                ? "bg-zinc-900 text-zinc-100 ring-2 ring-orange-500"
                : "text-zinc-300 hover:bg-zinc-900 hover:text-zinc-100")
            }
          >
            <span
              aria-hidden
              className={`h-3 w-3 rounded-sm border border-zinc-950/40 ${option.swatchClass}`}
            />
            <span>{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}

function MoodPieceControls({ piece }: { piece: MoodPiece }) {
  const cycleCount = useAppStore((s) => s.mood.performance.cycleCount);
  const isExporting = useAppStore((s) => s.playback.isExporting);
  const isPerforming = useAppStore((s) => s.mood.performance.isPerforming);

  return (
    <div className="flex w-full flex-col gap-3">
      <MicStrip piece={piece} />
      <div className="flex w-full flex-col items-center justify-between gap-3 sm:flex-row">
        <div className="flex flex-wrap items-center justify-center gap-2 sm:justify-start">
          <MoodLensControl lens={piece.lens} />
          <MoodVibeControl vibe={piece.vibe} />
          <span
            aria-label="Time feel"
            className="rounded border border-zinc-800 bg-zinc-950 px-3 py-2 font-mono text-xs tabular-nums text-zinc-300"
          >
            {moodFeelLabel(piece)}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <MoodPlayButton cycleSeconds={piece.cycleSeconds} />
          <span
            aria-label="Mood cycle count"
            className="rounded border border-zinc-800 bg-zinc-950 px-3 py-2 font-mono text-xs tabular-nums text-orange-500"
          >
            Cycle {cycleCount}
          </span>
        </div>
      </div>
      <div className="flex justify-center sm:justify-end">
        <ScratchMoodControl disabled={isExporting || isPerforming} />
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
    });
  }
}

function mergeMoodHydrateResults(
  loaded: moodRehydrate.MoodRehydrateResult,
  decoded: moodRehydrate.MoodHydrateResult,
): moodRehydrate.MoodHydrateResult {
  const warnings = Array.from(new Set([...loaded.warnings, ...decoded.warnings]));
  return {
    ...decoded,
    degraded: loaded.degraded || decoded.degraded,
    warnings,
  };
}

export function MoodMode() {
  useMoodKeys();
  const piece = useAppStore((s) => s.mood.piece);
  const hydration = useAppStore((s) => s.mood.hydration);
  const isExporting = useAppStore((s) => s.playback.isExporting);
  const recordingState = useAppStore((s) => s.recording.state);
  const recordingError = useAppStore((s) => s.recording.error);
  const hydrationStartedRef = useRef(false);
  const unmountedRef = useRef(false);
  const recordingActive =
    recordingState === "preparing" || recordingState === "countdown" || recordingState === "recording";
  useRecordingEscapeCancel(recordingActive);

  useEffect(() => {
    unmountedRef.current = false;
    return () => {
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
        if (unmountedRef.current) return;
        if (loaded.ok && loaded.piece) {
          const decoded = await moodRehydrate.decodeMoodTakes(loaded.piece, getAudioContext());
          if (unmountedRef.current) return;
          const result = mergeMoodHydrateResults(loaded, decoded);
          useAppStore.getState().actions.hydrateMoodPiece(result);
          queueMoodPosterJobs(result.posterJobs);
          return;
        }
        useAppStore.getState().actions.hydrateMoodPiece({
          ok: loaded.ok,
          degraded: loaded.degraded,
          piece: null,
          warnings: loaded.warnings,
        });
      })
      .catch(() => {
        if (unmountedRef.current) return;
        useAppStore.getState().actions.hydrateMoodPiece({
          ok: false,
          degraded: true,
          piece: null,
          warnings: [
            "Saved mood could not be loaded. Autosave was paused to avoid overwriting it.",
          ],
        });
      });
  }, [hydration]);

  if (hydration === "cold" || hydration === "hydrating") {
    return <div className="text-zinc-500 text-sm">Loading mood...</div>;
  }

  if (!piece) return <StagePicker disabled={isExporting} />;

  return (
    <section className="flex w-full max-w-4xl flex-col items-center gap-5">
      <MoodStage piece={piece} />
      <RecordingErrorNotice message={recordingError} />
      <MoodPieceControls piece={piece} />
    </section>
  );
}

export default MoodMode;
