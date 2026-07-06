// ABOUTME: Unit tests for the deterministic Tone clock and scheduler harness.
// ABOUTME: Pins audio-clock lookahead, Draw scheduling, and Transport callback capture.
import { describe, it, expect, vi, afterEach } from "vitest";

import { createToneHarness } from "./toneTestHarness";

describe("test clock harness", () => {
  afterEach(() => {
    vi.doUnmock("tone");
    vi.resetModules();
  });

  it("keeps Tone.now lookahead configurable while Tone.immediate stays audible time", async () => {
    const harness = createToneHarness();
    vi.doMock("tone", () => harness.createToneModule());
    const Tone = await import("tone");

    expect(Tone.immediate()).toBe(0);
    expect(Tone.now()).toBeCloseTo(0.1, 6);

    harness.setNow(2);
    expect(Tone.immediate()).toBe(2);
    expect(Tone.now()).toBeCloseTo(2.1, 6);

    harness.setLookahead(0.25);
    expect(Tone.immediate()).toBe(2);
    expect(Tone.now()).toBeCloseTo(2.25, 6);
  });

  it("holds Draw callbacks until advanceTo passes their scheduled time", () => {
    const harness = createToneHarness();
    const Tone = harness.createToneModule();
    const callback = vi.fn();

    Tone.getDraw().schedule(callback, 1);
    harness.draw.advanceTo(0.999);
    expect(callback).not.toHaveBeenCalled();

    harness.draw.advanceTo(1);
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it("captures Transport.scheduleOnce callbacks for manual firing", () => {
    const harness = createToneHarness();
    const Tone = harness.createToneModule();
    const callback = vi.fn();

    const eventId = Tone.getTransport().scheduleOnce(callback, 1.5);
    expect(callback).not.toHaveBeenCalled();

    harness.transport.fireOnce(eventId);
    expect(callback).toHaveBeenCalledWith(1.5);
  });
});
