// ABOUTME: 8x16 step sequencer grid — clickable cells toggle steps in the store.
// ABOUTME: Downbeat columns (0, 4, 8, 12) get a slightly lighter background.
import { useAppStore } from "../store/useAppStore";

const STEP_COUNT = 16;
const TRACK_COUNT = 8;

interface StepCellProps {
  trackId: number;
  stepIndex: number;
}

function StepCell({ trackId, stepIndex }: StepCellProps) {
  const active = useAppStore((s) => s.project.tracks[trackId].steps[stepIndex]);
  const isDownbeat = stepIndex % 4 === 0;

  const onClick = () => {
    useAppStore.getState().actions.toggleStep(trackId, stepIndex);
  };

  let className = "w-10 h-10 rounded transition-colors ";
  if (active) {
    className += "bg-orange-500 hover:bg-orange-400";
  } else if (isDownbeat) {
    className += "bg-zinc-700 hover:bg-zinc-600";
  } else {
    className += "bg-zinc-800 hover:bg-zinc-600";
  }

  return (
    <button
      type="button"
      aria-label={`track ${trackId + 1} step ${stepIndex + 1}`}
      aria-pressed={active}
      data-active={active}
      data-track={trackId}
      data-step={stepIndex}
      onClick={onClick}
      className={className}
    />
  );
}

interface TrackRowProps {
  trackId: number;
}

function TrackRow({ trackId }: TrackRowProps) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-10 text-sm text-zinc-400 font-mono">T{trackId + 1}</span>
      <div className="grid grid-cols-16 gap-1">
        {Array.from({ length: STEP_COUNT }, (_, i) => (
          <StepCell key={i} trackId={trackId} stepIndex={i} />
        ))}
      </div>
    </div>
  );
}

export function StepGrid() {
  return (
    <div className="flex flex-col gap-1 p-8">
      {Array.from({ length: TRACK_COUNT }, (_, i) => (
        <TrackRow key={i} trackId={i} />
      ))}
    </div>
  );
}
