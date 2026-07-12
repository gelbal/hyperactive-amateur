// ABOUTME: StackSheet — Mood mic take chooser as anchored popover or coarse bottom sheet.
// ABOUTME: Routes take/off selection through moodPerformance so touch and keys share arming.
import { useCallback, useRef } from "react";
import { Mic2, Plus, Power } from "lucide-react";
import { usePopoverDismiss } from "../../lib/usePopoverDismiss";
import * as moodPerformance from "../../lib/moodPerformance";
import { recordMoodTake } from "../../lib/moodRecordingFlow";
import { MAX_TAKES_PER_MIC } from "../../lib/moodStages";
import { useAppStore } from "../../store/useAppStore";
import type { MoodMic, MoodPart, MoodSelectionEntry, MoodTake } from "../../types";

interface StackSheetProps {
  mic: MoodMic;
  micNumber: number;
  open: boolean;
  onClose: () => void;
}

const PART_LABELS: Record<MoodPart, string> = {
  lead: "Lead",
  harmony: "Harmony",
  bass: "Bass",
  beatbox: "Beatbox",
  adlib: "Adlib",
};

function formatDuration(seconds: number): string {
  return `${seconds.toFixed(1)}s`;
}

function partLabel(take: MoodTake): string {
  return take.part ? PART_LABELS[take.part] : "No part yet";
}

function TakeThumb({ take }: { take: MoodTake }) {
  if (take.posterUrl) {
    return (
      <img
        src={take.posterUrl}
        alt=""
        aria-hidden="true"
        className="h-10 w-10 shrink-0 rounded object-cover bg-zinc-950"
      />
    );
  }

  return (
    <span
      aria-hidden="true"
      className="flex h-10 w-10 shrink-0 items-center justify-center rounded border border-dashed border-zinc-700 bg-zinc-950 text-zinc-600"
    >
      <Mic2 size={16} />
    </span>
  );
}

export function StackSheet({ mic, micNumber, open, onClose }: StackSheetProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const activeEntry = useAppStore(
    (s) => s.mood.performance.armed[mic.id] ?? s.mood.performance.selections[mic.id] ?? "off",
  );
  const canRecordTheOne = useAppStore(
    (s) =>
      Boolean(s.mood.piece) &&
      s.mood.piece?.cycleSeconds === null &&
      mic.takes.length < MAX_TAKES_PER_MIC &&
      s.recording.state === "idle" &&
      !s.playback.isExporting,
  );
  const canRecordNewTake = useAppStore(
    (s) =>
      Boolean(s.mood.piece) &&
      s.mood.piece?.cycleSeconds !== null &&
      mic.takes.length < MAX_TAKES_PER_MIC &&
      s.recording.state === "idle" &&
      !s.playback.isExporting,
  );
  const canRecordTake = canRecordTheOne || canRecordNewTake;
  const close = useCallback(() => onClose(), [onClose]);
  usePopoverDismiss(rootRef, open, close);

  if (!open) return null;

  const choose = (entry: MoodSelectionEntry) => {
    moodPerformance.armSelection(mic.id, entry);
    onClose();
  };
  const recordNextTake = () => {
    if (!canRecordTake) return;
    void recordMoodTake(mic.id);
    onClose();
  };

  const rowBase =
    "flex min-h-11 w-full items-center gap-3 rounded border px-3 py-2 text-left text-sm transition-colors pointer-coarse:min-h-12 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500";
  const selectedRow = "border-orange-500 bg-orange-500/10 text-orange-100";
  const idleRow = "border-zinc-800 bg-zinc-950 text-zinc-300 hover:border-zinc-700 hover:bg-zinc-900";

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-label={`Mic ${micNumber} stack`}
      className="absolute left-0 top-full z-40 mt-2 flex w-[min(20rem,calc(100vw-1.5rem))] max-h-[min(60vh,28rem)] flex-col gap-2 overflow-y-auto rounded-md border border-zinc-700 bg-zinc-900 p-3 shadow-xl pointer-coarse:fixed pointer-coarse:inset-x-3 pointer-coarse:bottom-3 pointer-coarse:top-auto pointer-coarse:mt-0 pointer-coarse:w-auto pointer-coarse:max-w-none pointer-coarse:max-h-[min(70dvh,32rem)] pointer-coarse:rounded-lg"
    >
      <div className="flex items-center justify-between gap-3 px-1">
        <span className="font-mono text-xs uppercase text-zinc-500">Mic {micNumber}</span>
        <span className="text-[11px] text-zinc-500">Stack</span>
      </div>

      <div className="flex flex-col gap-1">
        {mic.takes.map((take, index) => {
          const selected = activeEntry === take.id;
          return (
            <button
              key={take.id}
              type="button"
              onClick={() => choose(take.id)}
              className={`${rowBase} ${selected ? selectedRow : idleRow}`}
            >
              <TakeThumb take={take} />
              <span className="flex min-w-0 flex-1 items-center gap-2">
                <span className="font-medium text-zinc-100">Take {index + 1}</span>
                <span className="font-mono text-xs tabular-nums text-zinc-500">
                  {formatDuration(take.durationSeconds)}
                </span>
                <span className="ml-auto truncate text-xs text-zinc-400">
                  {partLabel(take)}
                </span>
              </span>
            </button>
          );
        })}

        <button
          type="button"
          onClick={() => choose("off")}
          className={`${rowBase} ${activeEntry === "off" ? selectedRow : idleRow}`}
        >
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded border border-zinc-800 bg-zinc-950 text-zinc-500">
            <Power size={16} aria-hidden="true" />
          </span>
          <span className="flex min-w-0 flex-1 items-center gap-2">
            <span className="font-medium text-zinc-100">Off</span>
            <span className="ml-auto text-xs text-zinc-500">Mute this mic</span>
          </span>
        </button>

        <button
          type="button"
          disabled={!canRecordTake}
          onClick={recordNextTake}
          className={`flex min-h-11 w-full items-center gap-3 rounded border px-3 py-2 text-left text-sm transition-colors pointer-coarse:min-h-12 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 ${
            canRecordTake
              ? idleRow
              : "cursor-not-allowed border-zinc-800 bg-zinc-950/70 text-zinc-600 opacity-70"
          }`}
        >
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded border border-dashed border-zinc-800">
            <Plus size={16} aria-hidden="true" />
          </span>
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="font-medium">
              {canRecordTheOne ? "record the One" : "new take — punches in on the One"}
            </span>
            {canRecordTheOne ? <span className="text-xs">First take</span> : null}
          </span>
        </button>
      </div>
    </div>
  );
}
