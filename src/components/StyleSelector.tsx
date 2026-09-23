// ABOUTME: StyleSelector — dropdown for the subgenre hint sent to AI Suggest (boom-bap, trap, lo-fi, phonk).
// ABOUTME: Lives in the Feel panel beside Flow; text size is left to the stylesheet so coarse pointers get 16px.
import { useAppStore } from "../store/useAppStore";
import { SUBGENRES } from "../lib/aiSuggest";
import type { Subgenre } from "../types";

export function StyleSelector() {
  const value = useAppStore((s) => s.project.subgenre);
  const isExporting = useAppStore((s) => s.playback.isExporting);
  return (
    <label className="flex items-center gap-2 text-sm text-zinc-300">
      <span>Style</span>
      <select
        value={value}
        disabled={isExporting}
        onChange={(e) =>
          useAppStore.getState().actions.setSubgenre(e.target.value as Subgenre)
        }
        className="bg-zinc-900 rounded border border-zinc-700 text-zinc-200 px-2 py-1 pointer-coarse:min-h-11 focus:outline-none focus:border-orange-500 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
      >
        {SUBGENRES.map((g) => (
          <option key={g} value={g}>
            {g}
          </option>
        ))}
      </select>
    </label>
  );
}
