// ABOUTME: RetagAllControl tests — disabled gate, busy → done flow, error surface.
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { RetagAllControl } from "./RetagAllControl";
import type { RetagResult } from "../lib/retagAll";

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

describe("RetagAllControl", () => {
  it("disabled with hint when <2 clips; enabled otherwise; reports busy → done end-to-end", async () => {
    const { rerender } = render(<RetagAllControl clipsCount={1} />);
    expect(screen.getByRole("button", { name: /re-tag/i })).toBeDisabled();
    expect(screen.getByText(/at least 2 clips/i)).toBeInTheDocument();

    const d = deferred<RetagResult>();
    const onRetag = vi.fn(() => d.promise);
    const onBusyChange = vi.fn();
    rerender(<RetagAllControl clipsCount={3} onRetag={onRetag} onBusyChange={onBusyChange} />);

    const button = screen.getByRole("button", { name: /re-tag/i });
    expect(button).not.toBeDisabled();
    fireEvent.click(button);

    expect(onRetag).toHaveBeenCalledTimes(1);
    expect(onBusyChange).toHaveBeenLastCalledWith(true);
    await waitFor(() => expect(screen.getByText(/re-tagging 3 clips/i)).toBeInTheDocument());
    expect(button).toBeDisabled();

    await act(async () => {
      d.resolve({ ok: true, tagged: 3 });
      await d.promise;
    });

    await waitFor(() => expect(screen.getByText(/tagged 3 clips/i)).toBeInTheDocument());
    expect(onBusyChange).toHaveBeenLastCalledWith(false);
  });

  it("renders the error surface when retag returns ok:false OR throws", async () => {
    const failing = vi.fn(async (): Promise<RetagResult> => ({ ok: false, tagged: 0, reason: "all-failed" }));
    const { unmount } = render(<RetagAllControl clipsCount={2} onRetag={failing} />);
    fireEvent.click(screen.getByRole("button", { name: /re-tag/i }));
    await waitFor(() => expect(screen.getByText(/re-tag failed/i)).toBeInTheDocument());
    unmount();

    const throwing = vi.fn(async (): Promise<RetagResult> => { throw new Error("boom"); });
    render(<RetagAllControl clipsCount={2} onRetag={throwing} />);
    fireEvent.click(screen.getByRole("button", { name: /re-tag/i }));
    await waitFor(() => expect(screen.getByText(/re-tag failed/i)).toBeInTheDocument());
  });
});
