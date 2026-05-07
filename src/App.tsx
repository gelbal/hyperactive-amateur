// ABOUTME: Root React component for Hyperactive Amateur — top bar (play button) plus the step grid.
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
import { FeelDisclosure } from "./components/FeelDisclosure";
import { Viewport } from "./components/Viewport";
import { PadGrid } from "./components/PadGrid";
import { initTransport } from "./lib/audio";
import { useSpacebarPlayToggle } from "./lib/useSpacebarPlayToggle";
import { useKeyboardTriggers } from "./lib/useKeyboardTriggers";
import { rehydrateFromStorage } from "./lib/rehydrate";
import { startAutoSave, stopAutoSave } from "./lib/autoSave";
import { tryAutoGrantMedia } from "./lib/media";

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
    // If the browser already remembers the camera+mic grant, skip the gate.
    void tryAutoGrantMedia();
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
      <header className="border-b border-zinc-800">
        <div className="flex items-center gap-5 px-4 pt-3 pb-2">
          <h1 className="text-lg font-semibold tracking-tight text-zinc-300">
            Hyperactive Amateur
          </h1>
          <div className="flex items-center gap-3">
            <PlayButton />
            <span className="text-[10px] text-zinc-500 -ml-1">space</span>
            <BpmInput />
          </div>
          <span className="h-6 w-px bg-zinc-800" aria-hidden />
          <FeelDisclosure />
        </div>
        <div className="flex items-center gap-3 px-4 pt-2 pb-3 border-t border-zinc-900">
          <SuggestButton />
          <VariationButtons />
          <ExportButton />
          <CameraPreview />
        </div>
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
