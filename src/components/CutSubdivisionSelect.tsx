// ABOUTME: CutSubdivisionSelect — top-bar dropdown for visual-cut quantization.
// ABOUTME: Audio scheduling stays at 16ths regardless; this controls only the renderer.
import { useAppStore } from "../store/useAppStore";
import type { CutSubdivision } from "../types";

const OPTIONS: Array<{ value: CutSubdivision; label: string }> = [
  { value: "16n", label: "1/16" },
  { value: "8n", label: "1/8" },
  { value: "4n", label: "1/4" },
  { value: "2n", label: "1/2" },
  { value: "1m", label: "1 bar" },
];

export function CutSubdivisionSelect() {
  const value = useAppStore((s) => s.project.cutSubdivision);
  return (
    <label className="flex items-center gap-2 text-sm text-zinc-300">
      <span>Cut rate</span>
      <select
        aria-label="cut rate"
        value={value}
        onChange={(e) =>
          useAppStore.getState().actions.setCutSubdivision(e.target.value as CutSubdivision)
        }
        className="bg-zinc-900 rounded border border-zinc-700 px-2 py-1 focus:outline-none focus:border-orange-500"
      >
        {OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </label>
  );
}
