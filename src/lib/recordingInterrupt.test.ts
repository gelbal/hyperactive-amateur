// ABOUTME: recordingInterrupt tests — pins multi-flow lifecycle interruption dispatch.
// ABOUTME: Ensures Mood and Chop handlers can coexist without clobbering each other.
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  interruptActiveRecording,
  registerRecordingInterruptHandler,
} from "./recordingInterrupt";

describe("recordingInterrupt", () => {
  afterEach(() => {
    registerRecordingInterruptHandler(null);
  });

  it("keeps multiple registered handlers and dispatches only to the active one", () => {
    let chopActive = false;
    let moodActive = false;
    const chopInterrupt = vi.fn();
    const moodInterrupt = vi.fn();

    registerRecordingInterruptHandler({
      isActive: () => chopActive,
      interrupt: chopInterrupt,
    });
    registerRecordingInterruptHandler({
      isActive: () => moodActive,
      interrupt: moodInterrupt,
    });

    chopActive = true;
    expect(interruptActiveRecording("interrupted")).toBe(true);
    expect(chopInterrupt).toHaveBeenCalledTimes(1);
    expect(chopInterrupt).toHaveBeenCalledWith("interrupted");
    expect(moodInterrupt).not.toHaveBeenCalled();

    chopActive = false;
    moodActive = true;
    expect(interruptActiveRecording("interrupted")).toBe(true);
    expect(chopInterrupt).toHaveBeenCalledTimes(1);
    expect(moodInterrupt).toHaveBeenCalledTimes(1);
    expect(moodInterrupt).toHaveBeenCalledWith("interrupted");

    moodActive = false;
    expect(interruptActiveRecording("interrupted")).toBe(false);
    expect(chopInterrupt).toHaveBeenCalledTimes(1);
    expect(moodInterrupt).toHaveBeenCalledTimes(1);
  });
});
