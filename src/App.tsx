// ABOUTME: Root React component for Hyperpad — top bar (play button) plus the step grid.
// ABOUTME: Subsequent build steps will mount the viewport, pads, BPM input, and tags here.
import { useEffect } from "react";
import { StepGrid } from "./components/StepGrid";
import { PlayButton } from "./components/PlayButton";
import { BpmInput } from "./components/BpmInput";
import { CameraPreview } from "./components/CameraPreview";
import { Viewport } from "./components/Viewport";
import { PadGrid } from "./components/PadGrid";
import { initTransport } from "./lib/audio";
import { useSpacebarPlayToggle } from "./lib/useSpacebarPlayToggle";
import { useKeyboardTriggers } from "./lib/useKeyboardTriggers";

export function App() {
  useEffect(() => {
    initTransport();
  }, []);
  useSpacebarPlayToggle();
  useKeyboardTriggers();

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      <header className="flex items-center gap-4 p-4 border-b border-zinc-800">
        <h1 className="text-2xl font-bold">Hyperpad</h1>
        <PlayButton />
        <BpmInput />
        <CameraPreview />
      </header>
      <main className="flex flex-col items-center gap-6 py-6">
        <Viewport />
        <PadGrid />
      </main>
      <StepGrid />
    </div>
  );
}
