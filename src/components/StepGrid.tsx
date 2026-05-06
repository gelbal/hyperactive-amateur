// ABOUTME: 8-row sequencer grid — composes TrackRow components.
// ABOUTME: Each TrackRow renders its own clip preview/record affordance + 16 step cells.
import { TrackRow } from "./TrackRow";

const TRACK_COUNT = 8;

export function StepGrid() {
  return (
    <div className="flex flex-col gap-1 p-8">
      {Array.from({ length: TRACK_COUNT }, (_, i) => (
        <TrackRow key={i} trackId={i} />
      ))}
    </div>
  );
}
