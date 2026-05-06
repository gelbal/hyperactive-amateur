// ABOUTME: Root React component for Hyperpad — currently just a header.
// ABOUTME: Subsequent build steps will mount the top bar, viewport, and grid here.
export function App() {
  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      <h1 className="text-3xl font-bold p-8">Hyperpad</h1>
    </div>
  );
}
