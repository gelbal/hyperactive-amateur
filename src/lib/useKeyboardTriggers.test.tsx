// ABOUTME: useKeyboardTriggers tests — code → trackId mapping + suppression in inputs.
import { render } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

const triggerTrackNow = vi.fn();
vi.mock("./audio", () => ({
  triggerTrackNow: (...args: unknown[]) => triggerTrackNow(...args),
}));

import { useKeyboardTriggers } from "./useKeyboardTriggers";

function Harness({ withInput = false }: { withInput?: boolean }) {
  useKeyboardTriggers();
  return withInput ? <input data-testid="x" /> : null;
}

describe("useKeyboardTriggers", () => {
  beforeEach(() => triggerTrackNow.mockClear());

  it("fires on Digit3 → track 2, ignores held keys (repeat), ignores key-press inside an input", () => {
    const { getByTestId } = render(<Harness withInput />);
    document.body.dispatchEvent(new KeyboardEvent("keydown", { code: "Digit3", bubbles: true }));
    expect(triggerTrackNow).toHaveBeenCalledWith(2);
    triggerTrackNow.mockClear();
    document.body.dispatchEvent(
      new KeyboardEvent("keydown", { code: "Digit1", repeat: true, bubbles: true }),
    );
    expect(triggerTrackNow).not.toHaveBeenCalled();
    getByTestId("x").dispatchEvent(
      new KeyboardEvent("keydown", { code: "Digit1", bubbles: true }),
    );
    expect(triggerTrackNow).not.toHaveBeenCalled();
  });
});
