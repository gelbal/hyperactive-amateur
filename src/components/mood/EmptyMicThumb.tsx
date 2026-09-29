// ABOUTME: Shared dashed microphone thumbnail for Mood slots without a poster image.
// ABOUTME: Keeps empty mic and take placeholders visually identical across strip and stack.
import { Mic2 } from "lucide-react";

export function EmptyMicThumb({ testId }: { testId?: string }) {
  return (
    <span
      data-testid={testId}
      aria-hidden="true"
      className="flex h-10 w-10 shrink-0 items-center justify-center rounded border border-dashed border-zinc-700 bg-zinc-950 text-zinc-600"
    >
      <Mic2 size={16} />
    </span>
  );
}
