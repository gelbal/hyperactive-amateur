// ABOUTME: export — combine the canvas captureStream and a tap of the Tone audio destination.
// ABOUTME: Tap (don't replace) Tone.getDestination so the user keeps hearing playback during render.
import * as Tone from "tone";

const FRAMERATE = 30;

export interface ExportStream {
  stream: MediaStream;
  cleanup: () => void;
}

export function buildExportStream(
  canvas: HTMLCanvasElement,
  audioContext: AudioContext,
): ExportStream {
  const canvasStream = canvas.captureStream(FRAMERATE);
  const dest = audioContext.createMediaStreamDestination();
  // Tone routes audio through Tone.getDestination(); connecting it to our
  // recording destination ADDS a tap, it does not replace speaker output.
  Tone.getDestination().connect(dest);

  const videoTrack = canvasStream.getVideoTracks()[0];
  const audioTrack = dest.stream.getAudioTracks()[0];
  const tracks: MediaStreamTrack[] = [];
  if (videoTrack) tracks.push(videoTrack);
  if (audioTrack) tracks.push(audioTrack);
  const stream = new MediaStream(tracks);

  const cleanup = () => {
    try {
      Tone.getDestination().disconnect(dest);
    } catch {
      // disconnect throws if the connection was already torn down.
    }
    for (const track of stream.getTracks()) track.stop();
    for (const track of canvasStream.getTracks()) track.stop();
  };

  return { stream, cleanup };
}
