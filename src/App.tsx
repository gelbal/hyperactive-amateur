// ABOUTME: Root React component for Hyperpad — top bar (play button) plus the step grid.
// ABOUTME: Subsequent build steps will mount the viewport, pads, BPM input, and tags here.
import { useEffect, useState } from "react";
import { StepGrid } from "./components/StepGrid";
import { PlayButton } from "./components/PlayButton";
import { BpmInput } from "./components/BpmInput";
import { CameraPreview } from "./components/CameraPreview";
import { ExportButton } from "./components/ExportButton";
import { SuggestButton } from "./components/SuggestButton";
import { VariationButtons } from "./components/VariationButtons";
import { RecordCountdown } from "./components/RecordCountdown";
import { CompatibilityBanner } from "./components/CompatibilityBanner";
import { SwingSlider } from "./components/SwingSlider";
import { CutSubdivisionSelect } from "./components/CutSubdivisionSelect";
import { HoldTimeControl } from "./components/HoldTimeControl";
import { Viewport } from "./components/Viewport";
import { PadGrid } from "./components/PadGrid";
import { initTransport } from "./lib/audio";
import { useSpacebarPlayToggle } from "./lib/useSpacebarPlayToggle";
import { useKeyboardTriggers } from "./lib/useKeyboardTriggers";
import { rehydrateFromStorage } from "./lib/rehydrate";
import { startAutoSave, stopAutoSave } from "./lib/autoSave";

export function App() {
  const [hydrating, setHydrating] = useState(true);

  useEffect(() => {
    initTransport();
    let cancelled = false;
    rehydrateFromStorage()
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) {
          setHydrating(false);
          startAutoSave();
        }
      });
    return () => {
      cancelled = true;
      stopAutoSave();
    };
  }, []);
  useSpacebarPlayToggle();
  useKeyboardTriggers();

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      <CompatibilityBanner />
      <header className="flex items-center gap-4 p-4 border-b border-zinc-800">
        <h1 className="text-2xl font-bold">Hyperpad</h1>
        <PlayButton />
        <span className="text-[10px] text-zinc-500 -ml-2">space</span>
        <BpmInput />
        <SwingSlider />
        <CutSubdivisionSelect />
        <HoldTimeControl />
        <SuggestButton />
        <VariationButtons />
        <ExportButton />
        <CameraPreview />
      </header>
      <main className="flex flex-col items-center gap-6 py-6">
        {hydrating ? (
          <div className="text-zinc-500 text-sm">Loading project…</div>
        ) : (
          <>
            <Viewport />
            <PadGrid />
          </>
        )}
      </main>
      <StepGrid />
      <RecordCountdown />
    </div>
  );
}
