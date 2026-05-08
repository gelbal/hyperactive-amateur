// ABOUTME: usePopoverDismiss — close-on-outside-click + close-on-Escape effect for anchored popovers.
// ABOUTME: Listeners attach only while open; whileBusy skips dismissal during in-flight work like rendering.
import { useEffect, type RefObject } from "react";

interface Options {
  whileBusy?: boolean;
}

export function usePopoverDismiss(
  rootRef: RefObject<HTMLElement | null>,
  open: boolean,
  onDismiss: () => void,
  options: Options = {},
): void {
  const { whileBusy = false } = options;
  useEffect(() => {
    if (!open) return;
    const onPointer = (event: MouseEvent) => {
      if (whileBusy) return;
      if (!rootRef.current) return;
      if (rootRef.current.contains(event.target as Node)) return;
      onDismiss();
    };
    const onKey = (event: KeyboardEvent) => {
      if (whileBusy) return;
      if (event.key === "Escape") onDismiss();
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, whileBusy, rootRef, onDismiss]);
}
