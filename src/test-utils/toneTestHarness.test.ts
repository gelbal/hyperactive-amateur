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

  it("shares mutable Transport seconds across module reads", () => {
    const harness = createToneHarness();
    const Tone = harness.createToneModule();
    const transport = Tone.getTransport();

    // Stopped, the position does not advance; running, Tone reads it on the
    // lookahead clock (0.1 s ahead).
    expect(transport.seconds).toBe(0);
    transport.start();
    expect(transport.seconds).toBeCloseTo(0.1);

    transport.seconds = 12.5;
    expect(Tone.getTransport().seconds).toBe(12.5);
  });

  it("interprets scheduleOnce times in Transport time and fires at absolute audio time", () => {
    const harness = createToneHarness();
    const Tone = harness.createToneModule();
    const transport = Tone.getTransport();
    const callback = vi.fn();

    harness.setImmediate(16.6);
    transport.start();
    // Running, position 100 is read at the lookahead clock (16.7): 100.5 is 17.2.
    transport.seconds = 100;
    const eventId = transport.scheduleOnce(callback, 100.5);

    harness.transport.fireOnce(eventId);
    expect(callback.mock.calls[0][0]).toBeCloseTo(17.2);
  });

  it("captures Transport start and stop calls while sharing mutable position", () => {
    const harness = createToneHarness();
    const Tone = harness.createToneModule();
    const transport = Tone.getTransport();

    transport.position = "2:0:0";
    transport.start();
    transport.stop();

    expect(Tone.getTransport().position).toBe("2:0:0");
    expect(harness.transport.start).toHaveBeenCalledTimes(1);
    expect(harness.transport.stop).toHaveBeenCalledTimes(1);
  });

  it("exposes the async Tone.start surface", async () => {
    const harness = createToneHarness();
    const Tone = harness.createToneModule();

    await expect(Tone.start()).resolves.toBeUndefined();
    expect(harness.start).toHaveBeenCalledTimes(1);
  });
});
