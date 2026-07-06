// ABOUTME: SwingSlider — top-bar control for the 16th-note swing amount (0..1).
import { useAppStore } from "../store/useAppStore";

export function SwingSlider() {
  const swing = useAppStore((s) => s.project.swing);
  const isExporting = useAppStore((s) => s.playback.isExporting);
  return (
    <label className="flex items-center gap-2 text-sm text-zinc-300">
      <span>Swing</span>
      <input
        type="range"
        min={0}
        max={100}
        value={Math.round(swing * 100)}
        aria-label="swing"
        disabled={isExporting}
        onChange={(e) => useAppStore.getState().actions.setSwing(Number(e.target.value) / 100)}
        className="w-24 disabled:opacity-30 disabled:cursor-not-allowed"
      />
      <span className="w-8 text-right font-mono tabular-nums text-zinc-400 text-xs">
        {Math.round(swing * 100)}%
      </span>
    </label>
  );
}
