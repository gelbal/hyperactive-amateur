// ABOUTME: ModeSwitch — two-segment header control for swapping Chop and Mood.
// ABOUTME: Stops active Chop playback before entering Mood so only one mode owns sound.
import { stopPlayback } from "../lib/audio";
import { useAppStore } from "../store/useAppStore";
import type { AppMode } from "../types";

const MODES: Array<{ id: AppMode; label: string }> = [
  { id: "chop", label: "Chop" },
  { id: "mood", label: "Mood" },
];

export function ModeSwitch() {
  const appMode = useAppStore((s) => s.appMode);
  const isExporting = useAppStore((s) => s.playback.isExporting);
  const recordingState = useAppStore((s) => s.recording.state);
  const disabled = isExporting || recordingState !== "idle";

  const switchMode = (nextMode: AppMode) => {
    if (disabled || nextMode === appMode) return;
    const state = useAppStore.getState();
    if (
      state.appMode === "chop" &&
      nextMode === "mood" &&
      state.playback.isPlaying
    ) {
      stopPlayback();
    }
    useAppStore.getState().actions.setAppMode(nextMode);
  };

  return (
    <div
      role="group"
      aria-label="Mode"
      className="inline-flex rounded border border-zinc-700 bg-zinc-900 p-0.5"
    >
      {MODES.map((mode) => {
        const active = appMode === mode.id;
        return (
          <button
            key={mode.id}
            type="button"
            aria-pressed={active}
            disabled={disabled}
            onClick={() => switchMode(mode.id)}
            className={
              "px-3 py-1.5 text-sm font-medium rounded-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 " +
              "disabled:cursor-not-allowed disabled:opacity-40 " +
              (active
                ? "bg-orange-500 text-zinc-950"
                : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100")
            }
          >
            {mode.label}
          </button>
        );
      })}
    </div>
  );
}
