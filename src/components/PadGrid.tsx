// ABOUTME: PadGrid — 4x2 of clickable pads, one per track. Click triggers like the keyboard.
// ABOUTME: Each pad subscribes to playback.triggerSeq[trackId] and flashes briefly on every fire.
import { useEffect, useState } from "react";
import { useAppStore } from "../store/useAppStore";
import { triggerTrackNow } from "../lib/audio";

const FLASH_MS = 150;
const TRACK_COUNT = 8;

interface PadProps {
  trackId: number;
}

function Pad({ trackId }: PadProps) {
  const seq = useAppStore((s) => s.playback.triggerSeq[trackId]);
  const clip = useAppStore((s) => s.project.tracks[trackId].clip);
  const tag = useAppStore((s) => s.project.tracks[trackId].tag);
  const [flashing, setFlashing] = useState(false);

  useEffect(() => {
    if (seq === 0) return;
    setFlashing(true);
    const id = window.setTimeout(() => setFlashing(false), FLASH_MS);
    return () => window.clearTimeout(id);
  }, [seq]);

  return (
    <button
      type="button"
      aria-label={`pad ${trackId + 1}`}
      data-flashing={flashing}
      onClick={() => void triggerTrackNow(trackId)}
      className={
        "relative aspect-square rounded-lg border overflow-hidden transition-colors " +
        (flashing
          ? "bg-orange-500 border-orange-300"
          : "bg-zinc-900 border-zinc-700 hover:border-zinc-500")
      }
    >
      {clip ? (
        clip.posterUrl ? (
          <img
            src={clip.posterUrl}
            alt=""
            aria-hidden
            className="absolute inset-0 w-full h-full object-cover opacity-80"
          />
        ) : (
          <div
            aria-hidden
            className="absolute inset-0 bg-zinc-800"
          />
        )
      ) : (
        <div className="absolute inset-0 flex items-center justify-center text-xs text-zinc-600">
          empty
        </div>
      )}
      <span className="absolute top-1 left-1 px-1.5 py-0.5 text-[10px] rounded bg-black/60 text-white">
        {trackId + 1}
      </span>
      {tag && (
        <span className="absolute bottom-1 right-1 px-1.5 py-0.5 text-[10px] rounded bg-black/60 text-orange-300">
          {tag}
        </span>
      )}
    </button>
  );
}

export function PadGrid() {
  return (
    <div className="grid grid-cols-4 gap-2 w-full max-w-[480px]" aria-label="trigger pads">
      {Array.from({ length: TRACK_COUNT }, (_, i) => (
        <Pad key={i} trackId={i} />
      ))}
    </div>
  );
}
