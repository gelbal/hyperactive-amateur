// ABOUTME: Play/stop transport control — primary action button in the top bar.
// ABOUTME: Reads playback.isPlaying from the store; calls togglePlayback on click.
import { useState } from "react";
import { Play, Square, X } from "lucide-react";
import { useAppStore } from "../store/useAppStore";
import { togglePlayback } from "../lib/audio";
import { canStartAudibleAction } from "../lib/audibleActionGate";
import { runAudibleAction } from "../lib/audibleActionRunner";
import {
  markSilentSwitchHintDismissed,
  shouldShowSilentSwitchHint,
} from "../lib/audioLifecycle";

export function PlayButton() {
  const [dismissedHint, setDismissedHint] = useState(false);
  const isPlaying = useAppStore((s) => s.playback.isPlaying);
  const isExporting = useAppStore((s) => s.playback.isExporting);
  const audioState = useAppStore((s) => s.playback.audioState);
  const canStart = useAppStore(canStartAudibleAction);
  const disabled = isExporting || (!isPlaying && !canStart);
  const showSilentSwitchHint =
    audioState === "running" && !dismissedHint && shouldShowSilentSwitchHint();

  const handleClick = () => {
    runAudibleAction(togglePlayback());
  };

  const dismissSilentSwitchHint = () => {
    markSilentSwitchHintDismissed();
    setDismissedHint(true);
  };

  return (
    <div className="static lg:relative flex flex-col items-center">
      <button
        type="button"
        aria-label={isPlaying ? "Stop playback" : "Start playback"}
        title="Play or stop (space)"
        disabled={disabled}
        onClick={handleClick}
        className={
          "w-12 h-12 rounded-full flex items-center justify-center transition-colors " +
          (disabled
            ? "bg-zinc-800 text-zinc-600 cursor-not-allowed"
            : isPlaying
              ? "bg-zinc-800 border-2 border-orange-500 text-orange-500 hover:bg-zinc-700"
              : "bg-orange-500 text-zinc-950 hover:bg-orange-400")
        }
      >
        {isPlaying ? <Square size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" />}
      </button>
      {/* z-20: below the Feel and Export panels (z-30), which hang under the
          header at the same spot; an open panel covers the hint, not the
          other way round. ha-silent-hint: the stylesheet removes the hint
          while a panel is open, so its Dismiss button is not reachable
          behind the panel. */}
      {showSilentSwitchHint && (
        <div className="ha-silent-hint absolute inset-x-3 top-full mt-2 z-20 w-auto max-w-[24rem] mx-auto flex items-center gap-2 rounded-md border border-orange-500/60 bg-zinc-950/95 px-3 py-2 text-xs text-orange-200 shadow-lg lg:inset-x-auto lg:left-1/2 lg:-translate-x-1/2 lg:w-56 lg:max-w-none lg:mx-0">
          <span>No sound? Check your phone's silent switch.</span>
          <button
            type="button"
            aria-label="Dismiss silent switch hint"
            onClick={dismissSilentSwitchHint}
            className="ml-auto flex h-6 w-6 shrink-0 items-center justify-center rounded text-orange-200 hover:bg-zinc-800 hover:text-white"
          >
            <X size={12} aria-hidden />
          </button>
        </div>
      )}
    </div>
  );
}
