// ABOUTME: StepGrid — left-side track info (sticky) + scrollable column header / cell rows on the right.
// ABOUTME: Hosts the +4 extend buttons (left and right) and per-column hover-only minus to remove a column.
import { useState } from "react";
import { Plus, Minus } from "lucide-react";
import { useAppStore } from "../store/useAppStore";
import { TrackInfo } from "./TrackInfo";
import { MAX_STEP_COUNT } from "../store/initialState";

const TRACK_COUNT = 8;
const STEP_WIDTH = 40;
const STEP_GAP = 4;

interface StepCellProps {
  trackId: number;
  stepIndex: number;
  disabled: boolean;
  onHover: (col: number | null) => void;
}

function StepCell({ trackId, stepIndex, disabled, onHover }: StepCellProps) {
  const active = useAppStore((s) => s.project.tracks[trackId].steps[stepIndex]);
  const isCurrent = useAppStore(
    (s) => s.playback.isPlaying && s.playback.currentStep === stepIndex,
  );
  const isDownbeat = stepIndex % 4 === 0;

  let className = "rounded transition-colors shrink-0 ";
  if (active) className += "bg-orange-500 hover:bg-orange-400";
  else if (isDownbeat) className += "bg-zinc-700 hover:bg-zinc-600";
  else className += "bg-zinc-800 hover:bg-zinc-600";
  if (isCurrent) className += " ring-2 ring-orange-300";

  // Tailwind's important-modifier (!) on the coarse-pointer override forces it
  // to win against the inline width/height set for fine-pointer (mouse) layouts.
  const sizeClass = " pointer-coarse:!w-11 pointer-coarse:!h-11";
  return (
    <button
      type="button"
      aria-label={`track ${trackId + 1} step ${stepIndex + 1}`}
      aria-pressed={active}
      data-active={active}
      data-current={isCurrent}
      disabled={disabled}
      onClick={() => useAppStore.getState().actions.toggleStep(trackId, stepIndex)}
      onMouseEnter={() => onHover(stepIndex)}
      onMouseLeave={() => onHover(null)}
      style={{ width: STEP_WIDTH, height: 40 }}
      className={className + sizeClass + " disabled:opacity-50 disabled:cursor-not-allowed"}
    />
  );
}

interface ColumnHeaderProps {
  stepIndex: number;
  hovered: boolean;
  canRemove: boolean;
  onHover: (col: number | null) => void;
}

function ColumnHeader({ stepIndex, hovered, canRemove, onHover }: ColumnHeaderProps) {
  const showMinus = hovered && canRemove;
  const blockStart = Math.floor(stepIndex / 4) * 4;
  return (
    <div
      style={{ width: STEP_WIDTH }}
      className="h-6 flex items-center justify-center shrink-0"
      onMouseEnter={() => onHover(stepIndex)}
      onMouseLeave={() => onHover(null)}
    >
      <button
        type="button"
        aria-label={`Remove steps ${blockStart + 1}-${blockStart + 4}`}
        title={`Remove steps ${blockStart + 1}-${blockStart + 4}`}
        disabled={!canRemove}
        onClick={() => useAppStore.getState().actions.removeStepColumn(stepIndex)}
        className={
          "w-5 h-5 pointer-coarse:w-8 pointer-coarse:h-8 rounded-full flex items-center justify-center transition-opacity bg-red-500/80 hover:bg-red-500 text-white " +
          (showMinus
            ? "opacity-100"
            : "opacity-0 pointer-events-none any-pointer-coarse:opacity-40 any-pointer-coarse:pointer-events-auto")
        }
      >
        <Minus size={12} />
      </button>
    </div>
  );
}

function ExtendButton({ disabled }: { disabled: boolean }) {
  return (
    <button
      type="button"
      aria-label="Add 4 more steps"
      title="Add 4 more steps"
      disabled={disabled}
      onClick={() => useAppStore.getState().actions.extendSteps()}
      className={
        "shrink-0 flex items-center justify-center rounded-full border transition-colors " +
        "w-7 h-7 border-zinc-700 bg-zinc-900 text-zinc-300 hover:bg-zinc-800 hover:border-zinc-500 " +
        "disabled:opacity-30 disabled:cursor-not-allowed"
      }
    >
      <Plus size={14} />
    </button>
  );
}

export function StepGrid() {
  const stepCount = useAppStore((s) => s.project.stepCount);
  const isExporting = useAppStore((s) => s.playback.isExporting);
  const canRemove = stepCount > 4 && !isExporting;
  const canExtend = stepCount < MAX_STEP_COUNT && !isExporting;
  const [hoveredCol, setHoveredCol] = useState<number | null>(null);

  return (
    <div className="px-3 sm:px-6 py-4 flex gap-3">
      {/* Left fixed panel: 8 TrackInfo rows */}
      <div className="shrink-0 flex flex-col gap-1">
        <div className="h-6" aria-hidden />
        {Array.from({ length: TRACK_COUNT }, (_, i) => (
          <TrackInfo key={i} trackId={i} />
        ))}
      </div>
      {/* Right scrollable: column header (-) buttons + 8 cell rows + trailing + button */}
      <div className="flex-1 min-w-0 overflow-x-auto">
        <div className="inline-flex flex-col gap-1">
          <div className="flex items-center" style={{ gap: STEP_GAP }}>
            {Array.from({ length: stepCount }, (_, j) => (
              <ColumnHeader
                key={j}
                stepIndex={j}
                hovered={hoveredCol === j}
                canRemove={canRemove}
                onHover={setHoveredCol}
              />
            ))}
            <div className="ml-2">
              <ExtendButton disabled={!canExtend} />
            </div>
          </div>
          {Array.from({ length: TRACK_COUNT }, (_, trackId) => (
            <div
              key={trackId}
              className="flex items-center h-12"
              style={{ gap: STEP_GAP }}
              onMouseLeave={() => setHoveredCol(null)}
            >
              {Array.from({ length: stepCount }, (_, j) => (
                <StepCell
                  key={j}
                  trackId={trackId}
                  stepIndex={j}
                  disabled={isExporting}
                  onHover={setHoveredCol}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
