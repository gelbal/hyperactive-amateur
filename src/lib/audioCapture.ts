// ABOUTME: Capture live mic samples from a MediaStream into an AudioBuffer.
// ABOUTME: Used as the reliable playback source while MediaRecorder keeps the video blob.

const SCRIPT_PROCESSOR_BUFFER_SIZE = 4096;

export interface AudioBufferCapture {
  stop: () => AudioBuffer | null;
  cancel: () => void;
}

function readChannelCount(track: MediaStreamTrack): number {
  try {
    const settings = typeof track.getSettings === "function" ? track.getSettings() : {};
    return Math.max(1, Math.min(2, settings.channelCount ?? 1));
  } catch {
    return 1;
  }
}

function disconnectNode(node: AudioNode): void {
  try {
    node.disconnect();
  } catch {
    // Already disconnected.
  }
}

export function startAudioBufferCapture(
  stream: MediaStream,
  audioContext: AudioContext,
): AudioBufferCapture | null {
  const audioTracks =
    typeof stream.getAudioTracks === "function" ? stream.getAudioTracks() : [];
  if (audioTracks.length === 0) return null;
  if (
    typeof audioContext.createMediaStreamSource !== "function" ||
    typeof audioContext.createScriptProcessor !== "function" ||
    typeof audioContext.createBuffer !== "function" ||
    !audioContext.destination
  ) {
    return null;
  }

  const channelCount = readChannelCount(audioTracks[0]);
  const chunks: Float32Array[][] = Array.from({ length: channelCount }, () => []);
  let sampleCount = 0;
  let cancelled = false;

  const source = audioContext.createMediaStreamSource(new MediaStream(audioTracks));
  const processor = audioContext.createScriptProcessor(
    SCRIPT_PROCESSOR_BUFFER_SIZE,
    channelCount,
    channelCount,
  );

  processor.onaudioprocess = (event) => {
    if (cancelled) return;
    const input = event.inputBuffer;
    const inputChannels = Math.max(1, input.numberOfChannels);
    for (let channel = 0; channel < channelCount; channel += 1) {
      const sourceChannel = Math.min(channel, inputChannels - 1);
      chunks[channel].push(new Float32Array(input.getChannelData(sourceChannel)));
    }
    sampleCount += input.length;

    // ScriptProcessorNode must be connected to process. Keep output silent.
    const output = event.outputBuffer;
    for (let channel = 0; channel < output.numberOfChannels; channel += 1) {
      output.getChannelData(channel).fill(0);
    }
  };

  source.connect(processor);
  processor.connect(audioContext.destination);

  const disconnect = () => {
    processor.onaudioprocess = null;
    disconnectNode(processor);
    disconnectNode(source);
  };

  return {
    stop: () => {
      disconnect();
      if (cancelled || sampleCount === 0) return null;
      const audioBuffer = audioContext.createBuffer(
        channelCount,
        sampleCount,
        audioContext.sampleRate,
      );
      for (let channel = 0; channel < channelCount; channel += 1) {
        const target = audioBuffer.getChannelData(channel);
        let offset = 0;
        for (const chunk of chunks[channel]) {
          target.set(chunk, offset);
          offset += chunk.length;
        }
      }
      return audioBuffer;
    },
    cancel: () => {
      cancelled = true;
      disconnect();
    },
  };
}
