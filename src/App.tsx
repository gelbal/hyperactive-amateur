// ABOUTME: Root React component for Hyperpad — top bar (play button) plus the step grid.
// ABOUTME: Subsequent build steps will mount the viewport, pads, BPM input, and tags here.
import { useEffect } from "react";
import { StepGrid } from "./components/StepGrid";
import { PlayButton } from "./components/PlayButton";
import { BpmInput } from "./components/BpmInput";
import { CameraPreview } from "./components/CameraPreview";
import { initTransport } from "./lib/audio";
import { useSpacebarPlayToggle } from "./lib/useSpacebarPlayToggle";

export function App() {
  useEffect(() => {
    initTransport();
  }, []);
  useSpacebarPlayToggle();

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      <header className="flex items-center gap-4 p-4 border-b border-zinc-800">
        <h1 className="text-2xl font-bold">Hyperpad</h1>
        <PlayButton />
        <BpmInput />
        <CameraPreview />
      </header>
      <StepGrid />
    </div>
  );
}
