// ABOUTME: Play/stop transport control — primary action button in the top bar.
// ABOUTME: Reads playback.isPlaying from the store; calls togglePlayback on click.
import { Play, Square } from "lucide-react";
import { useAppStore } from "../store/useAppStore";
import { togglePlayback } from "../lib/audio";

export function PlayButton() {
  const isPlaying = useAppStore((s) => s.playback.isPlaying);

  const handleClick = () => {
    void togglePlayback();
  };

  return (
    <button
      type="button"
      aria-label={isPlaying ? "Stop playback" : "Start playback"}
      onClick={handleClick}
      className={
        "w-12 h-12 rounded-full flex items-center justify-center transition-colors " +
        (isPlaying
          ? "bg-zinc-800 border-2 border-orange-500 text-orange-500 hover:bg-zinc-700"
          : "bg-orange-500 text-zinc-950 hover:bg-orange-400")
      }
    >
      {isPlaying ? <Square size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" />}
    </button>
  );
}
