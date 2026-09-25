// ABOUTME: Tests the shared async wait and abort plumbing used by browser media flows.
// ABOUTME: Pins optional-signal waits, audio-clock deadlines, abort classification, and messages.
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  errorMessage,
  getAbortReason,
  isFlowAbort,
  throwIfFlowAborted,
  waitMs,
  waitUntilAudioTime,
} from "./async";

describe("async helpers", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("waitMs resolves without an abort signal", async () => {
    vi.useFakeTimers();

    const result = waitMs(25);
    await vi.advanceTimersByTimeAsync(25);

    await expect(result).resolves.toBeUndefined();
  });

  it("waitMs rejects a pre-aborted signal without starting a timer", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    controller.abort();

    await expect(waitMs(25, controller.signal)).rejects.toMatchObject({
      name: "AbortError",
      message: "Aborted before wait started",
    });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("waitMs clears its timer when the signal aborts during the wait", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const removeEventListener = vi.spyOn(controller.signal, "removeEventListener");
    const result = waitMs(25, controller.signal);
    const rejection = expect(result).rejects.toMatchObject({
      name: "AbortError",
      message: "Aborted during wait",
    });

    controller.abort();

    await rejection;
    expect(vi.getTimerCount()).toBe(0);
    expect(removeEventListener).toHaveBeenCalledWith("abort", expect.any(Function));
  });

  it.each([
    ["without a signal", false],
    ["with a signal", true],
  ])("waitUntilAudioTime polls the audio clock to its deadline %s", async (_label, withSignal) => {
    vi.useFakeTimers();
    const clock = { currentTime: 1 };
    const controller = new AbortController();

    const result = withSignal
      ? waitUntilAudioTime(1.05, clock, controller.signal)
      : waitUntilAudioTime(1.05, clock);
    clock.currentTime = 1.05;
    await vi.advanceTimersByTimeAsync(50);

    await expect(result).resolves.toBeUndefined();
  });

  it("throwIfFlowAborted throws only after the signal aborts", () => {
    const controller = new AbortController();

    expect(() => throwIfFlowAborted(controller.signal, "Flow stopped")).not.toThrow();
    controller.abort();

    expect(() => throwIfFlowAborted(controller.signal, "Flow stopped")).toThrow(
      expect.objectContaining({ name: "AbortError", message: "Flow stopped" }),
    );
  });

  it("isFlowAbort recognizes AbortErrors and the signal reason by identity", () => {
    const controller = new AbortController();
    const reason = { kind: "flow-stop" };

    expect(isFlowAbort(new DOMException("Stopped", "AbortError"), controller.signal)).toBe(true);
    controller.abort(reason);
    expect(isFlowAbort(reason, controller.signal)).toBe(true);
    expect(isFlowAbort({ kind: "flow-stop" }, controller.signal)).toBe(false);
  });

  it("getAbortReason maps interrupted exactly and every other reason to user", () => {
    const interrupted = new AbortController();
    const other = new AbortController();
    interrupted.abort("interrupted");
    other.abort("anything-else");

    expect(getAbortReason(interrupted.signal)).toBe("interrupted");
    expect(getAbortReason(other.signal)).toBe("user");
  });

  it("errorMessage reads Error messages and stringifies non-Errors", () => {
    expect(errorMessage(new Error("broken"))).toBe("broken");
    expect(errorMessage(42)).toBe("42");
  });
});
