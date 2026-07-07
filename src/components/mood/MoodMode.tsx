// ABOUTME: MoodMode — lazy-loaded root shell for the layered-loop Mood mode.
// ABOUTME: Starts with a stage picker, placeholder stage, and temporary transport controls.
import { useEffect, useRef, useState } from "react";
import { Play, Square } from "lucide-react";
import { BpmDialControl } from "../BpmDial";
import { getAudioContext } from "../../lib/audio";
import { runAudibleAction } from "../../lib/audibleActionRunner";
import { STAGE_DESCRIPTORS } from "../../lib/moodStages";
import { startMoodPerformance, stopMoodPerformance } from "../../lib/moodTransport";
import * as moodRehydrate from "../../lib/moodRehydrate";
import { useAppStore } from "../../store/useAppStore";
import type { MoodPiece, MoodStageId, MoodTimeFeel } from "../../types";

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
        className="rounded border border-zinc-700 px-3 py-2 text-sm text-zinc-300 transition-colors hover:border-zinc-600 hover:bg-zinc-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-zinc-700 disabled:hover:bg-transparent"
      >
        Scratch this mood
      </button>
    );
  }

  return (
    <div className="flex flex-col items-center gap-2">
      <p className="text-center text-xs text-zinc-400">
        This forgets this mood shell. Sure?
      </p>
      <div className="flex gap-2">
        <button
          type="button"
          disabled={disabled}
          onClick={() => {
            useAppStore.getState().actions.scratchMoodPiece();
            setArmed(false);
          }}
          className="rounded bg-red-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-red-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-300 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-red-600"
        >
          Yes, scratch it
        </button>
        <button
          type="button"
          onClick={() => setArmed(false)}
          className="rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-200 transition-colors hover:bg-zinc-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function moodFeelLabel(piece: MoodPiece): string {
  if (piece.timeFeel !== "click") return "Pocket";
  if (piece.bpm === null || piece.cycleBars === null) return "Click";
  return `Click · ${piece.bpm} · ${piece.cycleBars} ${piece.cycleBars === 1 ? "bar" : "bars"}`;
}

function MoodPieceControls({
  piece,
  scratchDisabled,
}: {
  piece: MoodPiece;
  scratchDisabled: boolean;
}) {
  const isExporting = useAppStore((s) => s.playback.isExporting);
  const isPerforming = useAppStore((s) => s.mood.performance.isPerforming);
  const cycleCount = useAppStore((s) => s.mood.performance.cycleCount);
  const transportDisabled = isExporting || (!isPerforming && piece.cycleSeconds === null);

  const toggleMoodPerformance = () => {
    if (isPerforming) {
      stopMoodPerformance();
      return;
    }
    runAudibleAction(startMoodPerformance());
  };

  return (
    <div className="flex w-full flex-col items-center justify-between gap-3 sm:flex-row">
      <span
        aria-label="Time feel"
        className="rounded border border-zinc-800 bg-zinc-950 px-3 py-2 font-mono text-xs tabular-nums text-zinc-300"
      >
        {moodFeelLabel(piece)}
      </span>
      <div className="flex items-center gap-2">
        <button
          type="button"
          aria-label={isPerforming ? "Stop mood performance" : "Start mood performance"}
          disabled={transportDisabled}
          onClick={toggleMoodPerformance}
          className={
            "inline-flex h-10 items-center gap-2 rounded border px-3 text-sm font-semibold transition-colors " +
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
        <span
          aria-label="Mood cycle count"
          className="rounded border border-zinc-800 bg-zinc-950 px-3 py-2 font-mono text-xs tabular-nums text-orange-500"
        >
          Cycle {cycleCount}
        </span>
        <ScratchMoodControl disabled={scratchDisabled} />
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
  const piece = useAppStore((s) => s.mood.piece);
  const hydration = useAppStore((s) => s.mood.hydration);
  const isExporting = useAppStore((s) => s.playback.isExporting);
  const isPerforming = useAppStore((s) => s.mood.performance.isPerforming);
  const hydrationStartedRef = useRef(false);
  const unmountedRef = useRef(false);

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

  const stageName = STAGE_LABELS[piece.stage];
  const micCount = piece.mics.length;
  const descriptor = STAGE_DESCRIPTORS[piece.stage];

  return (
    <section className="flex w-full max-w-4xl flex-col items-center gap-5">
      <div className="flex aspect-square w-full max-w-[28rem] flex-col items-center justify-center gap-2 rounded border border-zinc-800 bg-zinc-900 text-center shadow-inner">
        <span className="text-2xl font-black text-zinc-100">{stageName} stage</span>
        <span className="font-mono text-sm tabular-nums text-orange-500">
          {micCount} mics
        </span>
        <span className="text-xs text-zinc-500">
          {descriptor.canvasSize.w} x {descriptor.canvasSize.h}
        </span>
      </div>
      <MoodPieceControls piece={piece} scratchDisabled={isExporting || isPerforming} />
    </section>
  );
}

export default MoodMode;
