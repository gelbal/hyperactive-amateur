// ABOUTME: Deterministic AudioContext and audioSession test doubles for lifecycle tests.
// ABOUTME: Models statechange dispatch and navigator audioSession writes without real Web Audio.
export type AudioContextStubState = AudioContextState | "interrupted";
export type AudioContextStub = Pick<AudioContext, "addEventListener" | "removeEventListener"> & {
  readonly state: AudioContextStubState;
  setState: (nextState: AudioContextStubState) => void;
  dispatchStateChange: () => void;
};
export type NavigatorAudioSessionForStub = Navigator["audioSession"];

type StateChangeListener = EventListenerOrEventListenerObject;

export function createAudioContextStub(): AudioContextStub {
  const target = new EventTarget();
  let state: AudioContextStubState = "suspended";

  const dispatchStateChange = () => {
    target.dispatchEvent(new Event("statechange"));
  };

  return {
    get state() {
      return state;
    },
    setState(nextState) {
      state = nextState;
      dispatchStateChange();
    },
    dispatchStateChange,
    addEventListener(
      type: string,
      listener: EventListenerOrEventListenerObject | null,
      options?: boolean | AddEventListenerOptions,
    ) {
      if (type !== "statechange" || listener === null) return;
      target.addEventListener(type, listener as StateChangeListener, options);
    },
    removeEventListener(
      type: string,
      listener: EventListenerOrEventListenerObject | null,
      options?: boolean | EventListenerOptions,
    ) {
      if (type !== "statechange" || listener === null) return;
      target.removeEventListener(type, listener as StateChangeListener, options);
    },
  };
}

export function installNavigatorAudioSession(): { types: AudioSessionLike["type"][]; uninstall: () => void } {
  const types: AudioSessionLike["type"][] = [];
  const hadOwnAudioSession = Object.prototype.hasOwnProperty.call(navigator, "audioSession");
  const previousDescriptor = Object.getOwnPropertyDescriptor(navigator, "audioSession");
  let currentType: AudioSessionLike["type"] = "auto";

  const audioSession: NonNullable<NavigatorAudioSessionForStub> = {
    get type() {
      return currentType;
    },
    set type(nextType) {
      currentType = nextType;
      types.push(nextType);
    },
  };

  Object.defineProperty(navigator, "audioSession", {
    configurable: true,
    enumerable: true,
    value: audioSession,
  });

  return {
    types,
    uninstall() {
      if (hadOwnAudioSession && previousDescriptor) {
        Object.defineProperty(navigator, "audioSession", previousDescriptor);
        return;
      }
      delete (navigator as Navigator & { audioSession?: AudioSessionLike }).audioSession;
    },
  };
}
