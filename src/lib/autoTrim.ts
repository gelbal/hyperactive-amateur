// ABOUTME: autoTrim — find a non-destructive trim window around the loudest part of a clip.
// ABOUTME: Pure RMS-based onset detection in 10ms windows; default cap is 1.5s after onset.
export interface TrimRange {
  trimStartMs: number;
  trimEndMs: number;
}

const WINDOW_MS = 10;
const PRE_ROLL_MS = 50;
const MAX_CONTENT_MS = 1500;
const MIN_CLIP_MS = 50;
const SILENCE_RMS = 1e-6;
const ONSET_THRESHOLD_RATIO = 0.05;

export function autoTrim(buffer: AudioBuffer, maxContentMs = MAX_CONTENT_MS): TrimRange {
  const durationMs = buffer.duration * 1000;

  if (durationMs < MIN_CLIP_MS) {
    return { trimStartMs: 0, trimEndMs: durationMs };
  }

  const data = buffer.getChannelData(0);
  const sampleRate = buffer.sampleRate;
  const windowSamples = Math.max(1, Math.floor(sampleRate * (WINDOW_MS / 1000)));
  const windowCount = Math.floor(data.length / windowSamples);

  if (windowCount === 0) {
    return { trimStartMs: 0, trimEndMs: durationMs };
  }

  const rms = new Float32Array(windowCount);
  let peakRms = 0;
  let peakWindow = 0;

  for (let w = 0; w < windowCount; w++) {
    const start = w * windowSamples;
    let sumSq = 0;
    for (let i = 0; i < windowSamples; i++) {
      const sample = data[start + i];
      sumSq += sample * sample;
    }
    const value = Math.sqrt(sumSq / windowSamples);
    rms[w] = value;
    if (value > peakRms) {
      peakRms = value;
      peakWindow = w;
    }
  }

  if (peakRms < SILENCE_RMS) {
    return { trimStartMs: 0, trimEndMs: durationMs };
  }

  const threshold = peakRms * ONSET_THRESHOLD_RATIO;

  let onsetWindow = peakWindow;
  for (let w = peakWindow; w >= 0; w--) {
    if (rms[w] < threshold) {
      onsetWindow = w + 1;
      break;
    }
    onsetWindow = w;
  }

  const onsetMs = onsetWindow * WINDOW_MS;
  const peakMs = peakWindow * WINDOW_MS;

  const trimStartMs = Math.max(0, onsetMs - PRE_ROLL_MS);
  const trimEndMs = Math.min(durationMs, peakMs + maxContentMs);

  return { trimStartMs, trimEndMs };
}
