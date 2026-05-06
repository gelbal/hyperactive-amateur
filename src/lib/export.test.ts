// ABOUTME: buildExportStream tests — mocks canvas.captureStream + audio destination tap.
import { describe, it, expect, vi, beforeEach } from "vitest";

const destinationConnect = vi.fn();
const destinationDisconnect = vi.fn();
vi.mock("tone", () => ({
  getDestination: vi.fn(() => ({
    connect: destinationConnect,
    disconnect: destinationDisconnect,
  })),
}));

import { buildExportStream } from "./export";

function makeCanvas(): HTMLCanvasElement {
  const videoTrack = { kind: "video", stop: vi.fn() } as unknown as MediaStreamTrack;
  const canvas = {
    captureStream: vi.fn(() => ({
      getVideoTracks: () => [videoTrack],
      getTracks: () => [videoTrack],
    })),
  } as unknown as HTMLCanvasElement;
  return canvas;
}

function makeAudioContext() {
  const audioTrack = { kind: "audio", stop: vi.fn() } as unknown as MediaStreamTrack;
  return {
    createMediaStreamDestination: vi.fn(() => ({
      stream: {
        getAudioTracks: () => [audioTrack],
      },
    })),
  } as unknown as AudioContext;
}

describe("buildExportStream", () => {
  beforeEach(() => {
    destinationConnect.mockClear();
    destinationDisconnect.mockClear();
  });

  it("returns a MediaStream with a video and audio track", () => {
    const canvas = makeCanvas();
    const ctx = makeAudioContext();
    const { stream, cleanup } = buildExportStream(canvas, ctx);
    expect(stream.getVideoTracks()).toHaveLength(1);
    expect(stream.getAudioTracks()).toHaveLength(1);
    expect(destinationConnect).toHaveBeenCalledTimes(1);
    cleanup();
  });

  it("cleanup disconnects the destination tap", () => {
    const canvas = makeCanvas();
    const ctx = makeAudioContext();
    const { cleanup } = buildExportStream(canvas, ctx);
    cleanup();
    expect(destinationDisconnect).toHaveBeenCalledTimes(1);
  });
});
