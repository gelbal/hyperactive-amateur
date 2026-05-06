// ABOUTME: HoldTimeControl — slider for the same-tier ducking hold time (0..2000ms).
import { useAppStore } from "../store/useAppStore";

export function HoldTimeControl() {
  const value = useAppStore((s) => s.project.sameTierHoldMs);
  return (
    <label className="flex items-center gap-2 text-sm text-zinc-300">
      <span>Hold</span>
      <input
        type="range"
        min={0}
        max={2000}
        step={50}
        value={value}
        aria-label="hold time"
        onChange={(e) =>
          useAppStore.getState().actions.setSameTierHoldMs(Number(e.target.value))
        }
        className="w-24"
      />
      <span className="w-12 text-right font-mono tabular-nums text-zinc-400 text-xs">
        {value}ms
      </span>
    </label>
  );
}
