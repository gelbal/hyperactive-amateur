// ABOUTME: Tests for the deterministic AudioContext and audioSession stubs used by lifecycle tests.
// ABOUTME: Keeps Web Audio state transitions observable without touching a real browser context.
import { describe, expect, it } from "vitest";
import { createAudioContextStub, installNavigatorAudioSession } from "./audioContextStub";

describe("audioContextStub", () => {
  it("starts suspended", () => {
    const context = createAudioContextStub();

    expect(context.state).toBe("suspended");
  });

  it("fires registered statechange listeners exactly once per state change", () => {
    const context = createAudioContextStub();
    const calls: Event[] = [];
    const listener = (event: Event) => calls.push(event);

    context.addEventListener("statechange", listener);
    context.setState("running");

    expect(calls).toHaveLength(1);
    expect(context.state).toBe("running");

    context.removeEventListener("statechange", listener);
    context.setState("suspended");

    expect(calls).toHaveLength(1);
    expect(context.state).toBe("suspended");
  });

  it("installs a navigator audioSession recorder and uninstalls cleanly", () => {
    const original = navigator.audioSession;
    const installed = installNavigatorAudioSession();

    navigator.audioSession!.type = "playback";
    navigator.audioSession!.type = "play-and-record";

    expect(installed.types).toEqual(["playback", "play-and-record"]);

    installed.uninstall();

    expect(navigator.audioSession).toBe(original);
  });
});
