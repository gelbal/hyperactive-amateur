// ABOUTME: Ambient Audio Session API typings for browsers that expose navigator.audioSession.
// ABOUTME: Keeps audio lifecycle code feature-detected without shipping a runtime shim.
export {};

declare global {
  interface AudioSessionLike {
    type: "auto" | "playback" | "play-and-record" | "ambient" | "transient" | "transient-solo";
  }

  interface Navigator {
    audioSession?: AudioSessionLike;
  }
}
