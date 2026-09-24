// ABOUTME: FeelDisclosure — single button that opens a popover holding the tempo dial, the timing controls and the AI hints (style, flow, variations).
// ABOUTME: On desktop the button label carries the live state (BPM · cut rate · swing · hold); on phones it is the icon and the word so the controls row fits.
import { useCallback, useEffect, useRef, useState } from "react";
import { Sliders, Trash2 } from "lucide-react";
import { useAppStore, selectClipCount } from "../store/useAppStore";
import { usePopoverDismiss } from "../lib/usePopoverDismiss";
import { BpmDial } from "./BpmDial";
import { SwingSlider } from "./SwingSlider";
import { CutSubdivisionSelect } from "./CutSubdivisionSelect";
import { HoldTimeControl } from "./HoldTimeControl";
import { RetagAllControl } from "./RetagAllControl";
import { VariationButtons } from "./VariationButtons";
import { StyleSelector } from "./StyleSelector";
import { FlowSelector } from "./FlowSelector";
import { AI_UNLOCK_CLIPS } from "../lib/aiSuggest";
import type { CutSubdivision } from "../types";

const CUT_LABEL: Record<CutSubdivision, string> = {
  "16n": "1/16",
  "8n": "1/8",
  "4n": "1/4",
  "2n": "1/2",
  "1m": "1 bar",
};

export function FeelDisclosure() {
  const bpm = useAppStore((s) => s.project.bpm);
  const cut = useAppStore((s) => s.project.cutSubdivision);
  const swing = useAppStore((s) => s.project.swing);
  const hold = useAppStore((s) => s.project.sameTierHoldMs);
  const clipsCount = useAppStore(selectClipCount);
  const [open, setOpen] = useState(false);
  const [retagBusy, setRetagBusy] = useState(false);
  const [variationBusy, setVariationBusy] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const close = useCallback(() => setOpen(false), []);
  // Pin the popover open while either AI call is in flight — otherwise a
  // click-outside or Escape would unmount the busy child and swallow its
  // Undo / result toast.
  usePopoverDismiss(rootRef, open, close, { whileBusy: retagBusy || variationBusy });

  const summary = `${bpm} BPM · ${CUT_LABEL[cut]} · ${Math.round(swing * 100)}% · ${hold}ms`;

  return (
    // Below lg this wrapper is not positioned, so the popover's containing
    // block is the sticky header: it lands under the header at any scroll
    // offset (a fixed box with no top sat at its unscrolled static position
    // and drifted down by whatever sits above the header). lg, not sm: a
    // phone in landscape is wider than sm and must keep the capped, scrolling
    // phone panel. At lg the wrapper anchors it under the button again.
    <div className="static lg:relative" ref={rootRef}>
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label="Feel: tempo, cut rate, swing, hold, style, flow"
        onClick={() => setOpen((v) => !v)}
        className={
          "flex items-center gap-2 px-2.5 lg:px-3 py-2 pointer-coarse:min-h-11 text-sm rounded border transition-colors " +
          (open
            ? "bg-zinc-800 border-zinc-600"
            : "bg-zinc-900 border-zinc-700 hover:bg-zinc-800 hover:border-zinc-600")
        }
      >
        <Sliders size={14} className="text-zinc-400" />
        <span className="text-zinc-300">Feel</span>
        {/* The live values ride along only where the row has room; on a
            phone the button is the icon and the word so the controls row
            stays one line. */}
        <span className="hidden lg:inline font-mono tabular-nums text-xs text-zinc-500">{summary}</span>
      </button>
      {open && (
        <div
          role="dialog"
          aria-label="Feel controls"
          className="absolute inset-x-3 top-full mt-2 z-30 w-auto max-w-[24rem] mx-auto max-h-[calc(100dvh_-_100%_-_1rem_-_env(safe-area-inset-top)_-_env(safe-area-inset-bottom))] overflow-y-auto rounded-md border border-zinc-700 bg-zinc-900 shadow-xl p-4 flex flex-col gap-3 lg:inset-x-auto lg:left-0 lg:min-w-[18rem] lg:max-w-none lg:mx-0 lg:max-h-none lg:overflow-visible"
        >
          {/* Tempo first: it is the control reached for most, and the only
              one whose value shows on the button. */}
          <BpmDial />
          <CutSubdivisionSelect />
          <SwingSlider />
          <HoldTimeControl />
          {clipsCount >= AI_UNLOCK_CLIPS && (
            <div className="border-t border-zinc-800 pt-3 flex flex-col gap-2">
              {/* Style and Flow shape what Suggest and the variations produce;
                  side by side they read as the two knobs on the same thing. */}
              <div className="flex flex-wrap items-center gap-3">
                <StyleSelector />
                <FlowSelector />
              </div>
              <span className="text-sm text-zinc-300">Variations</span>
              <VariationButtons onBusyChange={setVariationBusy} />
            </div>
          )}
          <div className="border-t border-zinc-800 pt-3">
            <RetagAllControl clipsCount={clipsCount} onBusyChange={setRetagBusy} />
          </div>
          <div className="border-t border-zinc-800 pt-3">
            <ScratchControl onScratched={() => setOpen(false)} />
          </div>
        </div>
      )}
    </div>
  );
}

interface ScratchControlProps {
  onScratched: () => void;
}

// Two-click destructive control: first click reveals confirm + cancel; second
// click on confirm wipes state + IndexedDB. No modal because the popover is
// already a transient surface.
function ScratchControl({ onScratched }: ScratchControlProps) {
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    if (!armed) return;
    const id = window.setTimeout(() => setArmed(false), 5000);
    return () => window.clearTimeout(id);
  }, [armed]);

  if (!armed) {
    return (
      <button
        type="button"
        onClick={() => setArmed(true)}
        aria-label="Scratch: start fresh"
        className="w-full flex items-center justify-center gap-2 px-3 py-2 text-sm rounded text-zinc-300 hover:bg-zinc-800 border border-zinc-800"
      >
        <Trash2 size={14} />
        Scratch
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-zinc-400 text-center">
        This wipes every clip, step, and setting. Sure?
      </p>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => {
            useAppStore.getState().actions.scratch();
            setArmed(false);
            onScratched();
          }}
          aria-label="Confirm scratch"
          className="flex-1 px-3 py-2 text-sm rounded bg-red-600 hover:bg-red-500 text-white font-medium"
        >
          Yes, scratch it
        </button>
        <button
          type="button"
          onClick={() => setArmed(false)}
          aria-label="Cancel scratch"
          className="flex-1 px-3 py-2 text-sm rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
