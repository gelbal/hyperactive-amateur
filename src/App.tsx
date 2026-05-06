// ABOUTME: Root React component for Hyperpad — header plus the step sequencer grid.
// ABOUTME: Subsequent build steps will mount the top bar, viewport, and pads here.
import { StepGrid } from "./components/StepGrid";

export function App() {
  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      <h1 className="text-3xl font-bold p-8">Hyperpad</h1>
      <StepGrid />
    </div>
  );
}
