// ABOUTME: Tests the shared abort-aware recording stream acquisition seam.
// ABOUTME: Pins late-stream release, listener cleanup, and single-settlement behavior.
import { beforeEach, describe, expect, it, vi } from "vitest";

const mediaMocks = vi.hoisted(() => ({
  acquireRecordingStream: vi.fn(),
  releaseRecordingStream: vi.fn(),
}));

vi.mock("./media", () => ({
  acquireRecordingStream: mediaMocks.acquireRecordingStream,
  releaseRecordingStream: mediaMocks.releaseRecordingStream,
}));

import { acquireRecordingStreamUntilAbort } from "./recordingAcquire";

function makeDeferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
} {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function flushMicrotasks(times = 3): Promise<void> {
  for (let i = 0; i < times; i += 1) {
    await Promise.resolve();
  }
}

describe("acquireRecordingStreamUntilAbort", () => {
  beforeEach(() => {
    mediaMocks.acquireRecordingStream.mockReset();
    mediaMocks.releaseRecordingStream.mockReset();
  });

  it("rejects a pre-aborted signal and releases the stream when acquisition later resolves", async () => {
    const acquisition = makeDeferred<MediaStream>();
    const stream = {} as MediaStream;
    const controller = new AbortController();
    controller.abort();
    mediaMocks.acquireRecordingStream.mockReturnValue(acquisition.promise);

    const result = acquireRecordingStreamUntilAbort(controller.signal);
    acquisition.resolve(stream);

    await expect(result).rejects.toMatchObject({
      name: "AbortError",
      message: "Aborted during media acquisition",
    });
    expect(mediaMocks.releaseRecordingStream).toHaveBeenCalledOnce();
    expect(mediaMocks.releaseRecordingStream).toHaveBeenCalledWith(stream);
  });

  it("rejects an abort during pending acquisition and releases the stream when it lands", async () => {
    const acquisition = makeDeferred<MediaStream>();
    const stream = {} as MediaStream;
    const controller = new AbortController();
    mediaMocks.acquireRecordingStream.mockReturnValue(acquisition.promise);

    const result = acquireRecordingStreamUntilAbort(controller.signal);
    controller.abort();
    acquisition.resolve(stream);

    await expect(result).rejects.toMatchObject({
      name: "AbortError",
      message: "Aborted during media acquisition",
    });
    expect(mediaMocks.releaseRecordingStream).toHaveBeenCalledWith(stream);
  });

  it("resolves a successful acquisition and removes the abort listener", async () => {
    const stream = {} as MediaStream;
    const controller = new AbortController();
    const removeEventListener = vi.spyOn(controller.signal, "removeEventListener");
    mediaMocks.acquireRecordingStream.mockResolvedValue(stream);

    await expect(acquireRecordingStreamUntilAbort(controller.signal)).resolves.toBe(stream);

    expect(removeEventListener).toHaveBeenCalledWith("abort", expect.any(Function));
    controller.abort();
    await flushMicrotasks();
    expect(mediaMocks.releaseRecordingStream).not.toHaveBeenCalled();
  });

  it("does not double-settle or leave an unhandled rejection when acquisition rejects after abort", async () => {
    const acquisition = makeDeferred<MediaStream>();
    const controller = new AbortController();
    const onResolved = vi.fn();
    const onRejected = vi.fn();
    mediaMocks.acquireRecordingStream.mockReturnValue(acquisition.promise);

    const result = acquireRecordingStreamUntilAbort(controller.signal);
    void result.then(onResolved, onRejected);
    controller.abort();
    await flushMicrotasks();

    acquisition.reject(new Error("permission denied after abort"));
    await flushMicrotasks();

    expect(onResolved).not.toHaveBeenCalled();
    expect(onRejected).toHaveBeenCalledOnce();
    expect(onRejected).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "AbortError",
        message: "Aborted during media acquisition",
      }),
    );
    expect(mediaMocks.releaseRecordingStream).not.toHaveBeenCalled();
  });
});
