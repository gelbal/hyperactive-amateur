// ABOUTME: MoodMode — lazy-loaded root shell for the layered-loop Mood mode.
// ABOUTME: Starts with a stage picker and shows the placeholder stage until real performance UI lands.
import { useEffect, useState } from "react";
import { STAGE_DESCRIPTORS } from "../../lib/moodStages";
import { useAppStore } from "../../store/useAppStore";
import type { MoodStageId } from "../../types";

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

function StagePicker() {
  const createMoodPiece = useAppStore((s) => s.actions.createMoodPiece);

  return (
    <section className="flex w-full max-w-4xl flex-col items-center gap-5">
      <div className="grid w-full gap-3 sm:grid-cols-3">
        {STAGE_ORDER.map((stage) => (
          <button
            key={stage}
            type="button"
            onClick={() => createMoodPiece(stage, "pocket")}
            className="flex min-h-44 flex-col items-center justify-center gap-3 rounded border border-zinc-800 bg-zinc-900 p-5 text-zinc-200 transition-colors hover:border-orange-500 hover:bg-zinc-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500"
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
    </section>
  );
}

function ScratchMoodControl() {
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
        onClick={() => setArmed(true)}
        className="rounded border border-zinc-700 px-3 py-2 text-sm text-zinc-300 transition-colors hover:border-zinc-600 hover:bg-zinc-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500"
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
          onClick={() => {
            useAppStore.getState().actions.scratchMoodPiece();
            setArmed(false);
          }}
          className="rounded bg-red-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-red-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-300"
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

export function MoodMode() {
  const piece = useAppStore((s) => s.mood.piece);

  if (!piece) return <StagePicker />;

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
      <ScratchMoodControl />
    </section>
  );
}

export default MoodMode;
