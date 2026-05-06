# build-plan.md — Amateur Hyperactive implementation plan

Pair this document with `spec.md`. The spec answers *what* we're building; this
document answers *how* and *in what order*. The end of this document is a
series of self-contained prompts ready to feed to a code-generation LLM
(Cursor, Aider, Claude Code, etc.) one at a time. Each prompt is sized to
ship a small, testable increment.

---

## Part 1 — High-level blueprint (10 phases)

These are the broad strokes. Each phase produces a meaningful, demoable
artifact. A user can stop after any phase and have something they can show.

| # | Phase | Demoable artifact at end of phase |
|---|---|---|
| 1 | **Foundation** | Empty 8×16 sequencer grid renders, Zustand store wired, Vitest passing. |
| 2 | **Audio sequencer** | Hit play, hear a metronome click on each toggled step at 90 BPM. |
| 3 | **Recording** | Record a 2s clip from your webcam, a single track fires that recorded sound on its toggled steps. |
| 4 | **Multi-track sound** | All 8 tracks recordable, each plays its own clip, tag picker works. |
| 5 | **Auto-trim** | Recorded clips trim themselves to the transient on save. |
| 6 | **Hard-cut video** | Canvas viewport plays the corresponding clip's video on each trigger, A/V locked. |
| 7 | **Live mode** | Keyboard `1`–`8` and on-screen pads trigger clips both standalone and over a playing pattern. |
| 8 | **Persistence** | Refresh the page; everything comes back. |
| 9 | **Export** | Click export → WebM file downloads with the song you just made. |
| 10 | **AI + polish** | "Suggest a beat" fills the grid; countdown UI, swing, BPM controls, compatibility banner. |

---

## Part 2 — First-pass chunking

Breaking each phase into 2–4 chunks before going to step granularity.

### Phase 1 · Foundation
- 1A. Scaffolding (Vite + React + TS + Tailwind + Vitest + dependencies)
- 1B. Type definitions + initial state
- 1C. Zustand store + actions
- 1D. Step grid UI wired to store

### Phase 2 · Audio sequencer
- 2A. Tone.js bootstrap + Transport with metronome on every step
- 2B. Toggled steps fire only on toggled cells
- 2C. Playhead UI + play/stop control
- 2D. BPM control

### Phase 3 · Recording
- 3A. `getUserMedia` hook + live camera preview
- 3B. `MediaRecorder` wrapper (capture → Blob → AudioBuffer)
- 3C. Per-track record flow (one track at a time, replaces metronome)

### Phase 4 · Multi-track sound
- 4A. Scale recording flow to all 8 tracks
- 4B. Tag picker per track

### Phase 5 · Auto-trim
- 5A. Auto-trim pure function
- 5B. Apply trim to Tone.Player playback offsets

### Phase 6 · Hard-cut video
- 6A. Canvas viewport scaffold + 8 hidden video elements
- 6B. Audio-clock-driven render loop (the critical step)
- 6C. Priority resolution for overlapping triggers

### Phase 7 · Live mode
- 7A. Keyboard `1`–`8` triggers
- 7B. On-screen pads + visual feedback

### Phase 8 · Persistence
- 8A. IndexedDB layer (save/load schema)
- 8B. Auto-save debouncing + rehydration

### Phase 9 · Export
- 9A. Audio + canvas stream routing
- 9B. MediaRecorder export pipeline + download
- 9C. Export dialog (length picker)

### Phase 10 · AI + polish
- 10A. Anthropic API wrapper
- 10B. "Suggest a beat" button + undo
- 10C. Countdown UI
- 10D. Swing control
- 10E. Compatibility banner + final polish

That's ~30 chunks. Some are still slightly too coarse, some are right-sized.
Going one more pass.

---

## Part 3 — Right-sized steps (final)

I went over the chunks once more, splitting anything that bundled too much
new complexity, merging anything trivially small. Final list of **31 steps**:

| # | Step | New surface area introduced |
|---|---|---|
| 1 | Scaffolding + Vitest | Project, tooling |
| 2 | Type definitions + `initialState` | Types only |
| 3 | Zustand store skeleton + actions | State + reducers |
| 4 | Step grid UI wired to store | First component |
| 5 | Tone.js bootstrap + metronome on every step | Audio context, Transport |
| 6 | Toggled steps fire metronome only on toggled cells | Step → trigger wiring |
| 7 | Play/stop + playhead UI | Transport control surface |
| 8 | BPM control | First numeric input + Transport reactivity |
| 9 | `getUserMedia` hook + camera preview | Media access permissions |
| 10 | `MediaRecorder` wrapper (record → Blob → AudioBuffer) | Recording mechanics |
| 11 | Per-track record button (1 track only) | UI flow |
| 12 | Recorded clip replaces metronome on track 0 | First "real" playback |
| 13 | Scale recording to all 8 tracks | Multi-track parity |
| 14 | Tag picker per track | UI primitive |
| 15 | Auto-trim pure function | DSP, fully unit-tested |
| 16 | Apply auto-trim to playback offsets | Wires § 15 into § 12 |
| 17 | Canvas viewport scaffold | First canvas |
| 18 | One hidden video drawn to canvas (track 0) | Video → canvas pipeline |
| 19 | Eight hidden videos, swap on trigger | Multi-track parity for video |
| 20 | Audio-clock-driven render loop **(critical)** | Sync architecture |
| 21 | Priority resolution for overlapping triggers | Visual cut policy |
| 22 | Keyboard `1`–`8` triggers | Live input source #2 |
| 23 | On-screen pads + visual feedback | Live input source #3 |
| 24 | IndexedDB save/load schema | Persistence primitive |
| 25 | Auto-save debouncing + rehydration | Refresh-safety end-to-end |
| 26 | Export: capture canvas + audio streams | Export plumbing |
| 27 | Export: MediaRecorder + download flow | Full export |
| 28 | Anthropic API wrapper (pure function) | Network call, isolated |
| 29 | "Suggest a beat" button + apply + undo | AI integration UX |
| 30 | 3-2-1 countdown UI | Polish |
| 31 | Swing + compatibility banner + final polish | Polish |

**Sanity check on sizing:**

- Each step has at least one testable concern (pure function, store action,
  component behavior, or end-to-end smoke test).
- Each step depends only on prior steps.
- No step introduces more than one new "kind of thing" (a new API, a new
  library, a new architectural pattern).
- Steps 20 and 27 are the trickiest; they're each well-bounded and the
  prompts spell out the architecture in detail to keep them safe.

---

## Part 4 — Prompts for a code-generation LLM

Each prompt is self-contained and assumes the LLM has access to the working
directory and can read existing files. Feed them to your tool of choice in
order. Don't skip — each builds on the last.

A few conventions I've used:

- **Test stack**: Vitest + React Testing Library + `@testing-library/jest-dom`.
  Co-locate tests next to source files: `Foo.tsx` + `Foo.test.tsx`.
- **TDD framing**: where it makes sense (pure functions, store actions),
  prompts ask for the test first. For UI/media code, tests assert behavior
  after the component is built.
- **Integration**: every prompt ends by wiring the new code into the
  running app. No orphan modules.

---

### Step 1 — Scaffolding + Vitest

**Goal:** A blank Vite + React + TypeScript app with Tailwind, Vitest,
React Testing Library, and the project's runtime dependencies installed.

**Builds on:** Nothing.

```text
Initialize a new Vite + React + TypeScript project named "amateur-hyperactive" in the
current directory.

Install runtime dependencies:
- react, react-dom
- zustand
- tone
- idb-keyval
- @anthropic-ai/sdk
- lucide-react
- clsx, tailwind-merge

Install dev dependencies:
- typescript, @types/react, @types/react-dom
- tailwindcss, postcss, autoprefixer
- vitest, @vitest/ui, jsdom
- @testing-library/react, @testing-library/jest-dom, @testing-library/user-event

Configuration:
- Configure Tailwind with `content: ["./index.html", "./src/**/*.{ts,tsx}"]`,
  enable dark mode with `darkMode: "class"`, and add `<html class="dark">` in
  index.html.
- Add a Vitest config in `vite.config.ts` with `test.environment = "jsdom"`,
  `test.globals = true`, and `test.setupFiles = ["./src/test-setup.ts"]`.
- Create `src/test-setup.ts` that imports `@testing-library/jest-dom`.
- Add npm scripts: `dev`, `build`, `preview`, `test`, `test:ui`.

Create the directory structure:
- src/components/
- src/store/
- src/lib/
- src/types.ts (empty file with `export {};`)

Create `src/App.tsx` rendering a single header: `<h1>Amateur Hyperactive</h1>` styled
with Tailwind (text-3xl, font-bold, p-8, bg-zinc-950, text-white,
min-h-screen).

Add `src/App.test.tsx` with one test: `App renders the title`. The test
should mount `<App />` and assert that the text "Amateur Hyperactive" is in the
document.

Verify by running `npm test` — the test should pass. Verify by running
`npm run dev` — the page should display "Amateur Hyperactive" on a dark background.

Do NOT add any business logic, state, or other components. This step is
exclusively scaffolding.
```

---

### Step 2 — Type definitions + `initialState`

**Goal:** A TypeScript types module describing the data model, plus an
`initialState` constant with 8 empty tracks.

**Builds on:** Step 1.

```text
In `src/types.ts`, define and export the following TypeScript types:

- `Tag = 'kick' | 'snare' | 'hat' | 'vocal' | 'fx'`
- `Clip` interface with fields:
  - `blob: Blob`
  - `url: string` (object URL, recreated on rehydrate)
  - `audioBuffer: AudioBuffer`
  - `trimStartMs: number`
  - `trimEndMs: number`
  - `durationMs: number`
- `Track` interface with fields:
  - `id: number` (0–7)
  - `clip: Clip | null`
  - `steps: boolean[]` (length 16)
  - `volume: number` (0–1)
  - `muted: boolean`
  - `tag: Tag | null`
- `RecordingState = 'idle' | 'countdown' | 'recording' | 'reviewing'`
- `AppState` interface with the shape from spec § 7 (project + playback +
  recording + ui sub-objects).

Then create `src/store/initialState.ts` that exports a function
`createInitialState(): AppState` returning a fresh empty state with:
- bpm: 90
- swing: 0
- tracks: array of 8 tracks (id 0–7), each with `clip: null`,
  `steps: new Array(16).fill(false)`, `volume: 1`, `muted: false`,
  `tag: null`
- playback: `{ isPlaying: false, currentStep: 0, activeTriggers: [] }`
- recording: `{ activeTrackId: null, state: 'idle' }`
- ui: `{ selectedTrackId: null, showExportDialog: false }`

Write `src/store/initialState.test.ts` with tests:
1. `createInitialState` returns an object with bpm=90, swing=0
2. Tracks array length is exactly 8
3. Each track has 16 false steps
4. Each track has the correct id (0 through 7)
5. Two calls to `createInitialState()` return independent objects (mutating
   one does not affect the other) — this is important because we'll reuse
   the function.

All tests must pass.

Do NOT create the Zustand store yet. Do NOT add any UI yet. Pure types
and initial-state factory only.
```

---

### Step 3 — Zustand store skeleton + actions

**Goal:** The Zustand store with a small set of actions covering toggling
steps and changing BPM. Just enough to drive the UI in Step 4.

**Builds on:** Steps 1–2.

```text
Create `src/store/useAppStore.ts` exporting a Zustand store typed as
`AppState & { actions: ... }`.

Use the action-co-located pattern: actions live under `state.actions` so
selectors can target state fields without re-running on action identity
changes.

Implement these actions in v1 of the store:
- `toggleStep(trackId: number, stepIndex: number): void`
  Flips the boolean at `tracks[trackId].steps[stepIndex]`.
- `setBpm(bpm: number): void`
  Clamps to [60, 180] and assigns.
- `setSwing(swing: number): void`
  Clamps to [0, 1] and assigns.
- `setTrackVolume(trackId: number, volume: number): void`
- `setTrackMuted(trackId: number, muted: boolean): void`

Initial state comes from `createInitialState()` (Step 2).

Write `src/store/useAppStore.test.ts` with tests for each action:
- toggleStep flips the targeted step and leaves others unchanged
- setBpm clamps to 180 if given 250
- setBpm clamps to 60 if given 30
- setSwing clamps to [0, 1]
- setTrackVolume on track 3 only mutates track 3
- setTrackMuted toggles correctly

Use `useAppStore.setState(createInitialState())` (or a `reset` test helper)
between tests to keep state clean.

All tests pass. Do NOT touch any UI yet. Do NOT add play/stop, recording,
or anything not listed.
```

---

### Step 4 — Step grid UI wired to store

**Goal:** A 16×8 button grid is rendered. Clicking a cell toggles its
state. Visual styling clearly distinguishes on/off and emphasizes
downbeats (steps 1, 5, 9, 13).

**Builds on:** Steps 1–3.

```text
Create `src/components/StepGrid.tsx`.

Render a grid of 8 rows × 16 columns of buttons. Each row corresponds to a
track (0–7), each column to a step (0–15). Use Tailwind grid layout
(`grid grid-cols-16` works if you extend Tailwind, otherwise inline-style
the grid template).

For each cell:
- Read `track.steps[stepIndex]` from `useAppStore` via a focused selector.
- On click, call `useAppStore.getState().actions.toggleStep(trackId, stepIndex)`.
- Style: `w-10 h-10`, rounded, with these state classes:
  - active step: `bg-orange-500`
  - inactive step on a downbeat (stepIndex % 4 === 0): `bg-zinc-700`
  - inactive step otherwise: `bg-zinc-800`
  - hover: `bg-zinc-600` if inactive, brighter orange if active

To the left of each row, render a small track label "T1" through "T8".

Mount `<StepGrid />` inside `App.tsx` below the existing header. Wrap in a
container with `flex flex-col gap-1 p-8`.

Write `src/components/StepGrid.test.tsx`:
1. Renders 128 step buttons (8 × 16)
2. Clicking a step button updates the store (verify by reading
   `useAppStore.getState()` after fireEvent.click)
3. After toggling, that button has the active class

All tests pass. The dev page now shows a clickable 8×16 grid below the
"Amateur Hyperactive" header.

Do NOT add play/stop, BPM input, or any audio. UI only.
```

---

### Step 5 — Tone.js bootstrap + metronome on every step

**Goal:** Hit play, hear a synthesized click on every step at 90 BPM.
This proves the audio stack works end-to-end before we layer real samples.

**Builds on:** Steps 1–4.

```text
Create `src/lib/audio.ts` exporting:
- `getAudioContext(): AudioContext` — returns Tone's audio context,
  starting it on first call (`Tone.start()` requires user gesture but we
  can call it lazily).
- `initTransport(): void` — sets `Tone.Transport.bpm.value` to whatever the
  store currently has, schedules a 16th-note loop callback that:
    1. Reads `useAppStore.getState().project.bpm` and
       `useAppStore.getState().project.tracks` (we'll use tracks in step 6)
    2. Plays a synthesized `Tone.MembraneSynth` click on EVERY step (we
       wire to actual steps in the next step)
    3. Updates `playback.currentStep` in the store via
       `setState({ playback: { ...playback, currentStep: stepIndex }})`
  - Loop length is 16 sixteenth notes (one bar).
- `startPlayback(): Promise<void>` — calls `Tone.start()` then
  `Tone.Transport.start()`.
- `stopPlayback(): void` — calls `Tone.Transport.stop()` and resets
  `currentStep` to 0.

Add a play/stop button to `App.tsx` (above the grid) using lucide-react
icons. The button reads `playback.isPlaying` from the store and dispatches
`togglePlayback` (add this action to the store: it flips `isPlaying` and
calls `startPlayback`/`stopPlayback`).

The store should also call `initTransport()` once on first load (use
`useEffect` in App.tsx, NOT module-init, so JSDOM tests don't try to start
audio).

Tests in `src/lib/audio.test.ts`:
- Mock Tone.js (Vitest `vi.mock("tone", ...)`).
- Verify `startPlayback` calls `Tone.start` and `Tone.Transport.start`.
- Verify `stopPlayback` calls `Tone.Transport.stop` and resets currentStep
  to 0 in the store.

Manual verification (not automated): in the browser, click play, hear
clicks at 90 BPM, see currentStep updating in React DevTools.

Do NOT wire steps[] to triggering yet — that's the next step.
```

---

### Step 6 — Toggled steps fire metronome only on toggled cells

**Goal:** Toggling steps in the grid now controls which steps actually
trigger the click. This is the moment the sequencer becomes a sequencer.

**Builds on:** Step 5.

```text
Modify the Transport callback in `src/lib/audio.ts` so it only fires the
click for tracks where `steps[currentStepIndex] === true`.

Specifically, on each 16th-note tick:
- For each track 0–7: if `track.steps[currentStep]` is true and
  `track.muted` is false, schedule a click on a slightly different pitch
  per track (so you can hear which tracks are firing — use C3 for track
  0, D3 for track 1, ..., up the scale). This is temporary; we'll replace
  with recorded clips in Step 12.
- All clicks scheduled with `Tone.now()` so they're sample-accurate.

Update the `togglePlayback` flow if needed to ensure the latest store
state is read inside the callback (if you captured `tracks` outside the
callback, use a getter inside instead; this matters because the user can
toggle steps while playing).

Tests in `src/lib/audio.test.ts`:
- Add a test that mocks the Transport callback and verifies that with
  `tracks[0].steps[0] = true` and all others false, only one click is
  scheduled per loop on step 0.
- Verify `muted` tracks do NOT fire even when their step is on.

Manual verification: toggle a few steps, hit play, hear the rhythm.
Toggling steps while playing should change the rhythm immediately.

Do NOT yet add a playhead visual — that's the next step.
```

---

### Step 7 — Play/stop + playhead UI

**Goal:** A visible playhead sweeps the grid in time with the audio. The
play/stop button gets proper styling and keyboard shortcut (spacebar).

**Builds on:** Steps 5–6.

```text
In `src/components/StepGrid.tsx`, add a visual playhead:
- Subscribe to `playback.currentStep` and `playback.isPlaying` from the
  store.
- When `isPlaying` is true, the column matching `currentStep` gets a thin
  orange vertical bar overlay (`absolute` positioned, full height of grid).
- When `isPlaying` is false, no playhead is shown.

In `src/App.tsx`:
- Add a top bar (`flex items-center gap-4 p-4 border-b border-zinc-800`)
  containing the play/stop button.
- Use lucide-react `Play` / `Square` icons. Button is a circle, 48px,
  orange-500 background when stopped, zinc-800 with orange border when
  playing.
- Add a keyboard listener at the App level: spacebar toggles play/stop.
  Skip if focus is in an input.

Tests in `src/components/StepGrid.test.tsx`:
- Add a test that simulates `useAppStore.setState({ playback: { isPlaying:
  true, currentStep: 5, activeTriggers: [] } })` and asserts a playhead
  element with the correct positional class is rendered for column 5.

Manual verification: click play, watch the playhead sweep. Press spacebar,
verify it toggles. Type in any text input (none exist yet — this becomes
testable in Step 8 with the BPM input) — spacebar should NOT toggle.

Do NOT add BPM input yet.
```

---

### Step 8 — BPM control

**Goal:** A number input in the top bar that updates the BPM live during
playback. The Transport adjusts smoothly without restarting.

**Builds on:** Step 7.

```text
Add a BPM input component at `src/components/BpmInput.tsx`:
- A small numeric input (`w-16 text-center bg-zinc-900 rounded`) with a
  label "BPM".
- Reads `project.bpm` from the store.
- On change, calls `actions.setBpm(value)`.
- On blur, if the input is empty or NaN, reverts to the last valid BPM.
- Range: 60–180 (clamping in the store, also `min`/`max` on the input).

In `src/lib/audio.ts`, subscribe to BPM changes from the store using
`useAppStore.subscribe(state => state.project.bpm, (bpm) => {
  Tone.Transport.bpm.value = bpm;
})`. Set this subscription up in `initTransport`.

Mount `<BpmInput />` in the top bar next to the play button.

Tests in `src/components/BpmInput.test.tsx`:
- Renders with the current store BPM
- Typing a new value updates the store
- Typing an out-of-range value gets clamped (verified via store state)

Manual verification: start playback, change BPM from 90 to 130 — playback
should speed up immediately without stopping. Spacebar should NOT toggle
play while focus is in the BPM input.

Do NOT add swing yet (that's a polish step).
```

---

### Step 9 — `getUserMedia` hook + camera preview

**Goal:** A reusable hook that requests camera+mic and exposes the
resulting `MediaStream`. A small live camera preview component to verify
it works.

**Builds on:** Step 8.

```text
Create `src/lib/useMediaStream.ts`:

```ts
export interface UseMediaStreamResult {
  stream: MediaStream | null;
  error: Error | null;
  status: 'idle' | 'requesting' | 'granted' | 'denied';
  request: () => Promise<void>;
}

export function useMediaStream(): UseMediaStreamResult { ... }
```

Implementation:
- Initial status: `idle`.
- `request()` calls `getUserMedia({ video: { width: 720, height: 720,
  facingMode: 'user' }, audio: { sampleRate: 48000, channelCount: 1 }})`.
- Sets status to `requesting` while pending, then `granted` or `denied`.
- On unmount, stops all tracks on the stream.
- Idempotent: calling `request()` twice returns the existing stream.

Create `src/components/CameraPreview.tsx`:
- Calls `useMediaStream()` on mount.
- If status is `idle`, shows a "Enable camera" button that calls `request`.
- If status is `granted`, renders a `<video>` with `srcObject = stream`,
  autoPlay, muted, playsInline. 200×200 square in the top bar (rounded).
- If status is `denied`, shows an inline error message.

Mount `<CameraPreview />` in the top bar of `App.tsx` (rightmost item).

Tests in `src/lib/useMediaStream.test.ts`:
- Mock `navigator.mediaDevices.getUserMedia` to return a fake MediaStream.
- Test the status transitions (idle → requesting → granted).
- Test denied path (mock rejects with NotAllowedError).
- Test idempotency.

Manual verification: open the dev page, click "Enable camera," see your
face in the corner. Refresh — status should reset to idle (this is fine
for v1).

Do NOT start recording yet. Stream access only.
```

---

### Step 10 — `MediaRecorder` wrapper

**Goal:** A small library that, given a MediaStream, records for a fixed
duration and returns `{ blob, audioBuffer, durationMs }`. This is the
recording primitive.

**Builds on:** Step 9.

```text
Create `src/lib/recorder.ts` exporting:

```ts
export interface RecordingResult {
  blob: Blob;
  audioBuffer: AudioBuffer;
  durationMs: number;
}

export async function recordClip(
  stream: MediaStream,
  durationMs: number = 2000,
  audioContext: AudioContext
): Promise<RecordingResult>;
```

Implementation:
- Create a `MediaRecorder` with `mimeType: 'video/webm; codecs=vp9,opus'`
  (fall back to 'video/webm' if vp9 unsupported).
- Collect chunks via `ondataavailable`.
- Stop after `durationMs` via setTimeout.
- On stop:
  - Combine chunks into a single Blob.
  - Convert blob → ArrayBuffer.
  - Decode the audio side via `audioContext.decodeAudioData` on a copy of
    the ArrayBuffer (the WebM container has audio Opus track that
    decodeAudioData can extract).
  - Return `{ blob, audioBuffer, durationMs }`.
- If decode fails, throw a clear error (we'll handle gracefully in the UI
  step).

Tests in `src/lib/recorder.test.ts`:
- Mock MediaRecorder via a tiny fake class that fires `dataavailable` and
  `stop` events on a timer.
- Mock `audioContext.decodeAudioData` to return a fake AudioBuffer.
- Verify the function resolves with a result of the right shape.
- Verify duration matches input.
- Verify it throws if decode fails.

Do NOT integrate with the UI yet. This is just the primitive.
```

---

### Step 11 — Per-track record button (track 0 only)

**Goal:** A record button on track 0 that captures a clip and stores it on
the track. UI shows the recorded clip's first frame as a thumbnail. The
clip is in the store but does not yet replace the metronome.

**Builds on:** Step 10.

```text
Add an action to the store:
- `setTrackClip(trackId: number, clip: Clip): void`
- `clearTrackClip(trackId: number): void`

Create `src/components/TrackRow.tsx` that renders one row of the grid plus:
- Track label (left, "T1"–"T8")
- Clip thumbnail OR record button (where the label currently sits — make
  the row layout `flex items-center gap-2`)
- The 16 step buttons (move the existing rendering from StepGrid into
  here)

For now, ONLY track 0 gets a working record button. Tracks 1–7 just show
a disabled "—" placeholder (we'll enable them in Step 13).

Record button behavior on track 0:
- Click → use the MediaStream from the existing CameraPreview (lift the
  hook into App, share via context or a Zustand slice — preferred:
  promote `useMediaStream` result into the store via a zustand slice
  `media` with `stream: MediaStream | null`).
- Show "..." text while recording (we'll add a real countdown in Step 30).
- When done, create an object URL, package as a `Clip`, call
  `setTrackClip(0, clip)`.
- Replace the record button with a thumbnail: render a `<video>` with
  `src = clip.url`, `currentTime = 0`, muted, paused. On hover, show a
  small "re-record" button overlay.

Refactor `StepGrid.tsx` to render 8 `<TrackRow />` components instead of
its previous flat grid.

Tests in `src/components/TrackRow.test.tsx`:
- Renders without a clip: shows record button (track 0) or placeholder
  (other tracks)
- After `setTrackClip(0, fakeClip)` is dispatched, the row shows a thumb.
- Clicking re-record clears the clip.

Manual verification: enable camera, click record on track 0, see a
thumbnail appear. Hit play — you should still hear the metronome (we wire
the recorded clip to playback in the next step).
```

---

### Step 12 — Recorded clip replaces metronome on track 0

**Goal:** When track 0 has a clip, its toggled steps trigger the recorded
audio (no longer the metronome). Tracks 1–7 still trigger the metronome
(or are silent if you prefer; pick one and document).

**Builds on:** Step 11.

```text
Modify `src/lib/audio.ts`:
- Add a `Tone.Player` per track, lazily created when the track gets a
  clip. Store these in a module-level `Map<number, Tone.Player>` keyed by
  trackId.
- On `setTrackClip` (subscribe to store changes), build a new
  `Tone.Player` from the clip's audio: convert the AudioBuffer into a
  Tone-compatible buffer via `Tone.Buffer(audioBuffer)`. Connect to
  `Tone.Destination`.
- On `clearTrackClip`, dispose the existing Player.
- In the Transport callback, change the trigger logic: if a track has a
  clip, fire its Player from `trimStartMs / 1000` (we'll add real trim in
  Step 16; for now it's always 0). Otherwise, fall back to the metronome
  pitch (track 1–7 with no clip).

Tests in `src/lib/audio.test.ts`:
- Mock Tone.Player.
- After `setTrackClip(0, fakeClip)`, verify a Player was created.
- After firing track 0's step, verify Player.start was called.
- After `clearTrackClip(0)`, verify the player is disposed.

Manual verification: record a sound on track 0 (e.g., say "yeah"). Toggle
steps 1, 5, 9, 13. Hit play — you should hear "yeah, yeah, yeah, yeah" on
the four downbeats. The other tracks (still empty) play their metronome
clicks.

Do NOT scale to all 8 tracks yet — that's the next step (it's a small
change but worth confirming this works first).
```

---

### Step 13 — Scale recording to all 8 tracks

**Goal:** Every track has an enabled record button. All 8 can be filled
with their own clips.

**Builds on:** Step 12.

```text
In `src/components/TrackRow.tsx`, remove the special case for track 0:
all 8 tracks now render a working record button when no clip is present.

Verify visually: record on a few tracks, toggle a pattern, hit play, hear
all of them.

Add an integration test in `src/components/TrackRow.test.tsx`:
- Mount the full grid with `useAppStore.setState(...)` simulating clips on
  multiple tracks.
- Verify each track's thumbnail renders.

No code beyond removing the conditional. Smallest possible step but worth
isolating because it's the moment the app becomes "real."
```

---

### Step 14 — Tag picker per track

**Goal:** After a clip is recorded, a small chip-picker appears allowing
the user to tag the clip (kick / snare / hat / vocal / fx). Tags are
persisted on the track.

**Builds on:** Step 13.

```text
Add a store action: `setTrackTag(trackId: number, tag: Tag | null)`.

In `src/components/TrackRow.tsx`, after a clip is present, render a tag
chip group between the thumbnail and the steps:
- 5 small pill buttons: kick, snare, hat, vocal, fx
- Selected one has `bg-orange-500`, others have `bg-zinc-700`
- Clicking a selected tag deselects it (sets to null)

Default tag after recording is `null` (untagged).

Tests in `src/components/TrackRow.test.tsx`:
- Render a track with a clip and tag = null. All chips are unselected.
- Click "kick" — store updates, chip is selected.
- Click "kick" again — store updates to null, chip deselects.

Manual verification: record clips on a few tracks, tag them. Refresh
(state will be lost since persistence is later). Tags are temporarily
stored in memory only.
```

---

### Step 15 — Auto-trim pure function

**Goal:** A well-tested DSP function that, given an AudioBuffer, returns
`{ trimStartMs, trimEndMs }`. Pure, no side effects.

**Builds on:** Steps 1–2 only (it's a leaf utility).

```text
Create `src/lib/autoTrim.ts`:

```ts
export interface TrimRange {
  trimStartMs: number;
  trimEndMs: number;
}

export function autoTrim(buffer: AudioBuffer): TrimRange;
```

Algorithm (from spec § 5.2):
1. Get channel 0 samples (`buffer.getChannelData(0)`).
2. Compute RMS in 10ms windows (window size = `buffer.sampleRate * 0.01`).
3. Find the window with maximum RMS — call this peak.
4. Walk backward from peak, find the first window whose RMS is below 5%
   of peak RMS. That index in samples is the start, minus 50ms pre-roll
   (clamped to 0).
5. End = min(peak time + 1500ms, buffer.duration * 1000).
6. Return `{ trimStartMs, trimEndMs }`.

Edge cases:
- All-silence buffer (peak RMS < 1e-6): return `{ trimStartMs: 0,
  trimEndMs: buffer.duration * 1000 }`.
- Buffer shorter than 50ms: return the whole buffer untrimmed.

Tests in `src/lib/autoTrim.test.ts` (use synthesized AudioBuffers via the
`OfflineAudioContext` API or a fake helper):
1. Synthesize a buffer with a click at t=500ms (Hann-windowed pulse) in 2s
   of silence. Assert trim starts ~450ms (500 - 50) and ends at min(2000,
   500+1500) = 2000.
2. Synthesize a buffer with a click at t=1500ms in 2s of silence. Assert
   end is clamped to 2000ms.
3. Pure silence buffer. Assert returns full range.
4. 30ms buffer. Assert returns full range.

All tests pass. NO integration with the rest of the app yet.
```

---

### Step 16 — Apply auto-trim to playback offsets

**Goal:** When a clip is recorded, run auto-trim, store the trim values
on the clip, and use them as offsets when triggering the Tone.Player.

**Builds on:** Steps 12, 15.

```text
In `src/lib/recorder.ts`, after decoding the audio, also call
`autoTrim(audioBuffer)` and include the result in the recording flow.
Update the Clip interface usage: trimStartMs and trimEndMs come from
autoTrim, not 0.

In `src/lib/audio.ts`, change the Player trigger to:
```
player.start(when, clip.trimStartMs / 1000,
             (clip.trimEndMs - clip.trimStartMs) / 1000);
```

Tests:
- Update `src/lib/audio.test.ts` to verify start is called with the
  correct trim offsets.

Manual verification: record yourself with a leading silence ("...uh"),
the playback should start at "uh" not at the silence. The thumbnail still
shows the original first frame; that's fine for v1 (we'll address in v1.5
trim UI).
```

---

### Step 17 — Canvas viewport scaffold

**Goal:** A fixed-size square canvas in the UI where the hard-cut video
will eventually appear. For now it just clears to a dark color and shows
"viewport" text.

**Builds on:** Step 16.

```text
Create `src/components/Viewport.tsx`:
- 480×480 canvas (we render 720×720 internally and CSS-scale; but for v1
  just 480×480 1:1 to keep things simple).
- A render loop using `requestAnimationFrame` that fills with
  `#0a0a0a` and draws the text "VIEWPORT" centered. This is purely
  scaffolding — the real renderer comes in Step 19+20.
- The canvas exposes `ctx` via a ref so future steps can draw to it.

Mount `<Viewport />` in `App.tsx` above the StepGrid. Layout: horizontally
the camera preview is on the right of the top bar, the viewport is in the
main content area centered, and the StepGrid is below the viewport.

Tests in `src/components/Viewport.test.tsx`:
- Renders a `<canvas>` element.
- Has the expected dimensions.

Manual verification: a dark square appears in the main area with
"VIEWPORT" text. (This text will be replaced; just confirms render loop
works.)

Do NOT wire any video yet.
```

---

### Step 18 — One hidden video drawn to canvas (track 0)

**Goal:** When track 0 has a clip and fires a step, the canvas draws the
current frame of that clip's video. Confirms the video → canvas pipeline.

**Builds on:** Step 17.

```text
Create `src/lib/videoEngine.ts` exporting a class or module-level state:

```ts
interface VideoEngine {
  setClipForTrack(trackId: number, clip: Clip | null): void;
  trigger(trackId: number, when: number): void;
  // Called every frame by the renderer.
  drawCurrentFrame(ctx: CanvasRenderingContext2D, audioTime: number): void;
}
```

Internally maintain:
- A Map of `trackId → HTMLVideoElement` for hidden videos.
- Each hidden video: muted, preload='auto', src = clip.url. Appended to
  document.body but `display: none` (or a hidden div).
- When `trigger(trackId, when)` is called: schedule the video to play
  starting at `when` (audio time). For now, just call
  `video.currentTime = trimStartMs/1000; video.play()` immediately
  (we'll fix sync in Step 20).
- An `activeTrigger: { trackId, startedAt } | null` field — the most
  recent trigger.
- `drawCurrentFrame` reads activeTrigger and, if recent enough (e.g.,
  within the clip's duration), calls
  `ctx.drawImage(video, 0, 0, canvas.width, canvas.height)`.

For this step, only track 0's clip is wired up. Other tracks are
ignored.

Modify `Viewport.tsx` to:
- On mount, get the canvas context.
- In the render loop, call `videoEngine.drawCurrentFrame(ctx, Tone.now())`
  instead of the placeholder text.

In `src/lib/audio.ts`, in the Transport callback, when track 0 fires,
also call `videoEngine.trigger(0, when)`.

Tests:
- Skip canvas draw assertions (hard to test without snapshot tooling).
- Test `setClipForTrack` and `trigger` API surface (state transitions).

Manual verification: record on track 0, sequence steps, hit play. The
canvas should show your face on each step that fires. Other tracks may be
blank frames — that's fine for now.
```

---

### Step 19 — Eight hidden videos, swap on trigger

**Goal:** All 8 tracks' clips are pre-loaded as hidden videos. Triggering
any track shows its frame. The "currently active track" is whichever one
fired most recently (we'll add proper priority in Step 21).

**Builds on:** Step 18.

```text
Generalize `src/lib/videoEngine.ts`:
- Subscribe to store changes: when any track's clip changes, call
  `setClipForTrack(trackId, clip)` to keep hidden videos in sync.
- Initialize hidden videos in `document.body` (or a dedicated div) for all
  8 tracks, lazily as clips arrive.
- Track an `activeTrigger` of `{ trackId, startedAt, clipDurationMs }`.
- On any `trigger(trackId, when)`, replace `activeTrigger` (most-recent
  wins, naive policy for now).
- `drawCurrentFrame` always uses `activeTrigger.trackId`'s video.

In `src/lib/audio.ts`, the Transport callback now calls
`videoEngine.trigger(trackId, when)` for every track that fires (not just
track 0).

Manual verification: record on 4 tracks, sequence them on different steps,
hit play. The viewport should cut between them as the playhead advances.

Note: timing may be slightly off (we drift because we're not using the
audio clock yet) — that's the fix for Step 20.
```

---

### Step 20 — Audio-clock-driven render loop *(critical)*

**Goal:** The render loop reads `Tone.now()` (audio clock) and chooses
which video frame to display based on a queue of scheduled triggers, so
A/V is locked. This is the most important step in the project.

**Builds on:** Step 19.

```text
Refactor `src/lib/videoEngine.ts` to use a SCHEDULED-EVENT model:

Replace `activeTrigger` with `triggers: TriggerEvent[]`:
```ts
interface TriggerEvent {
  trackId: number;
  startTime: number;        // in audio context seconds (Tone.now() base)
  endTime: number;          // startTime + clip play duration
}
```

`trigger(trackId, when)` PUSHES a new event onto the array (does not
replace). It also schedules:
- A microtask at `when` to set the video element's `currentTime` and
  `play()`. Use `Tone.Transport.scheduleOnce` or a custom timer keyed on
  `audioContext.currentTime`.

`drawCurrentFrame(ctx, audioTime)` (called from rAF loop):
1. GC: remove events from `triggers` whose `endTime < audioTime - 0.5`.
2. Find all events where `startTime <= audioTime <= endTime`.
3. If none, fill the canvas with `#0a0a0a` and return.
4. If multiple, pick one by priority (single placeholder rule for this
   step: most recently STARTED wins; we'll add tag-based priority in
   Step 21).
5. Draw that event's track's video to the canvas.

CRITICAL: `Viewport.tsx`'s render loop must read `Tone.now()` (audio
context time), NOT `performance.now()`. Pass it into
`drawCurrentFrame`.

Add a sync verification helper in `videoEngine.ts`:
- `getDebugInfo(): { activeEvents: TriggerEvent[], audioTime: number }`
- A small dev-only overlay component reading this and showing the count
  of active events. Helps debug visually.

Tests in `src/lib/videoEngine.test.ts`:
- Pure function tests for the priority resolver and active-event finder
  (extract these as pure functions for testability):
  - `findActiveEvents(events, audioTime): TriggerEvent[]`
  - `pickPriority(events, priorityTable): TriggerEvent | null`
  - GC: events past their endTime + 0.5s are pruned.
- Property test idea: scheduling a trigger at t=0 with duration 1s — at
  t=0.5 it's active; at t=1.6 it's gone.

Manual verification: record yourself counting "1, 2, 3, 4". Sequence
them on steps 1, 5, 9, 13 at 90 BPM. The visual cuts must land on the
beat — within a frame or two. If they drift, the audio clock isn't being
used correctly.

This step is critical to get right. Do NOT skip the audio-time pass into
the render loop.
```

---

### Step 21 — Priority resolution for overlapping triggers

**Goal:** When multiple tracks fire on the same step, the visual cut goes
to the highest-priority tag (vocal > fx > snare > kick > hat > untagged).

**Builds on:** Step 20.

```text
Define a priority table in `src/lib/videoEngine.ts`:
```ts
const TAG_PRIORITY: Record<Tag | 'untagged', number> = {
  vocal: 5, fx: 4, snare: 3, kick: 2, hat: 1, untagged: 0,
};
```

`pickPriority(events, tagsByTrackId)`:
- For each active event, look up the track's tag.
- Pick the event with the highest priority. Tie-break by most-recent
  startTime.
- Return null if list is empty.

The store's tags are the source of truth. The video engine subscribes
(or accepts a tags getter callback in its config).

Update `findActiveEvents` to also strip events for muted tracks (defense
in depth).

Tests in `src/lib/videoEngine.test.ts`:
- 3 simultaneous events: vocal + kick + hat. Asserts vocal wins.
- 2 untagged events at different start times. Asserts most recent wins.
- All muted: returns null.

Manual verification: record clips, tag them (one as vocal, one as kick,
one as hat), set them all to fire on step 1. Hit play — you should see
the vocal clip's video.
```

---

### Step 22 — Keyboard `1`–`8` triggers

**Goal:** Pressing `1`–`8` triggers the corresponding track's clip in
real time. Works alongside playback (events layer on top) and standalone
(playback off).

**Builds on:** Step 21.

```text
Create `src/lib/useKeyboardTriggers.ts`:
- A hook that attaches a `keydown` listener to `document`.
- On keys `Digit1` through `Digit8` (also `Numpad1`–`Numpad8`), with
  `event.repeat === false` AND focus NOT in an input/textarea:
  - Compute `trackId = key - 1`.
  - Call `triggerTrack(trackId, Tone.now())` — a unified function that:
    - Plays the audio (Tone.Player.start)
    - Calls `videoEngine.trigger(trackId, Tone.now())`
- Detaches on unmount.

Extract `triggerTrack(trackId, when)` into `src/lib/audio.ts` as the
unified primitive used by:
- The Transport callback (replace inline trigger logic with
  `triggerTrack`)
- The keyboard hook
- (Step 23) the on-screen pads

Mount `useKeyboardTriggers()` in `App.tsx`.

Tests in `src/lib/useKeyboardTriggers.test.ts`:
- Render a component using the hook, fire keydown for "1", verify a mock
  `triggerTrack(0, ...)` was called.
- keys outside 1–8 do nothing.
- `event.repeat = true` is ignored (held key).
- Focus in an input prevents triggering.

Manual verification: with the page loaded and clips on tracks 1–8, press
1–8. Each should fire the audio and update the canvas. Press 1 while
sequencer is playing — your live hit should layer on top.
```

---

### Step 23 — On-screen pads + visual feedback

**Goal:** A 4×2 grid of clickable pads showing each track's first frame.
Click triggers like keyboard. Pads flash on any trigger source.

**Builds on:** Step 22.

```text
Create `src/components/PadGrid.tsx`:
- A 4×2 grid of clickable buttons (one per track).
- Each pad shows the track's clip thumbnail (or a placeholder).
- Below the thumbnail: track number + tag chip (small, read-only).
- Above the thumbnail: keybind hint badge (e.g., "1").
- Click → call `triggerTrack(trackId, Tone.now())`.
- Pads get a brief visual flash animation when their track is triggered.
  Implementation: subscribe to a `lastTriggered: { trackId, time }` field
  in the store (add this), set it on every `triggerTrack` call. Each
  pad's flash = `time` updated within the last 150ms.

Mount `<PadGrid />` in `App.tsx` to the right of the Viewport, or below
it (whichever fits the layout — design-eye it).

Tests in `src/components/PadGrid.test.tsx`:
- Renders 8 pads.
- Clicking a pad triggers its track.
- After a trigger, the pad has the flash class for ~150ms.

Manual verification: click pads, see flashes. Sequencer playing should
cause pads to flash automatically. Keyboard 1–8 should also flash the pads.
```

---

### Step 24 — IndexedDB save/load schema

**Goal:** A persistence layer that can save the current project to
IndexedDB and load it back. No auto-save yet — explicit save/load buttons
for testing.

**Builds on:** Step 23.

```text
Create `src/lib/persistence.ts`:

```ts
export interface PersistedProject {
  version: 1;
  bpm: number;
  swing: number;
  tracks: PersistedTrack[];
  updatedAt: number;
}
export interface PersistedTrack {
  id: number;
  clipBlob: Blob | null;
  trimStartMs: number;
  trimEndMs: number;
  durationMs: number;
  tag: Tag | null;
  steps: boolean[];
  volume: number;
  muted: boolean;
}

export async function saveProject(state: AppState): Promise<void>;
export async function loadProject(): Promise<PersistedProject | null>;
export async function clearProject(): Promise<void>;
```

Use `idb-keyval` with key `current-project`.

Note: AudioBuffer and the object URL are derived; we store only the Blob
and the trim numbers. On load, we'll re-decode and re-create object URLs.

Tests in `src/lib/persistence.test.ts`:
- Use fake-indexeddb (npm package) for tests.
- Save then load returns equivalent shape.
- `clearProject` removes the record.

Add temporary "Save" and "Load" buttons to `App.tsx` for manual testing
(removed in Step 25). They call saveProject/loadProject; on load, they
also need to re-decode each track's blob to AudioBuffer and recreate
object URLs.

Manual verification: record on a few tracks, hit save, refresh, hit load
— clips return.
```

---

### Step 25 — Auto-save debouncing + rehydration

**Goal:** Project auto-saves 500ms after any change. On app load, project
auto-rehydrates. The temporary save/load buttons are removed.

**Builds on:** Step 24.

```text
In `src/store/useAppStore.ts`, add a subscription that calls a debounced
`saveProject(getState())` whenever `project` (bpm, swing, tracks) changes.
Use a small custom debounce (no need for lodash). Skip saving while
`recording.state !== 'idle'` to avoid weird intermediate state.

In `src/App.tsx`, add a top-level effect that on mount:
1. Calls `loadProject()`.
2. If a project exists:
   - Re-decode each track's `clipBlob` into an AudioBuffer (use
     `getAudioContext().decodeAudioData`).
   - Recreate object URLs.
   - Build full `Track` objects with these.
   - Call a new store action `hydrateProject(persistedProject, decodedClips)`.
3. If no project, leave the empty initial state.

Action: `hydrateProject(persisted, clips)` replaces project state and
also re-creates Tone.Players and video engine entries.

Show a small loading indicator while hydration runs.

Remove the temporary Save/Load buttons.

Tests:
- Add an integration test that saves a project, calls hydrateProject with
  the result, and verifies state matches.
- Test the debounce: rapid changes within 500ms cause one save call.

Manual verification: record clips, refresh the page, see the same project
restored — clips, tags, steps, BPM, all of it.
```

---

### Step 26 — Export: capture canvas + audio streams

**Goal:** A function that produces a `MediaStream` combining the canvas's
captureStream and the Tone.js audio output. Tested in isolation before
adding MediaRecorder.

**Builds on:** Step 25.

```text
Create `src/lib/export.ts` exporting:

```ts
export function buildExportStream(
  canvas: HTMLCanvasElement,
  audioContext: AudioContext
): { stream: MediaStream; cleanup: () => void };
```

Implementation:
- `canvasStream = canvas.captureStream(30)`
- Create a MediaStreamDestination from the audio context.
- Tap Tone's destination output into this dest:
  `Tone.getDestination().connect(streamDest)`. Note: this creates an
  ADDITIONAL connection, not a replacement — playback through speakers
  still works.
- `audioStream = streamDest.stream`
- Return `new MediaStream([canvasStream.getVideoTracks()[0],
   audioStream.getAudioTracks()[0]])`.
- `cleanup()` disposes the dest and stops tracks.

Tests:
- Mock canvas.captureStream and the audio context.
- Verify the returned MediaStream has 1 video track and 1 audio track.
- Verify cleanup disposes both.

Add a temporary debug button "Test Export Stream" that calls
buildExportStream, plays the song for 5 seconds, and logs the resulting
MediaStream. (Removed in Step 27.)

Manual verification: dev console shows a valid MediaStream object.
```

---

### Step 27 — Export: MediaRecorder + download flow

**Goal:** Click "Export" → modal with a length slider (1–8 bars) → click
"Render" → in-page progress bar while playback runs → WebM file downloads.

**Builds on:** Step 26.

```text
In `src/lib/export.ts`, add:

```ts
export async function exportSong(
  canvas: HTMLCanvasElement,
  audioContext: AudioContext,
  bars: number,
  bpm: number,
  onProgress?: (fraction: number) => void
): Promise<Blob>;
```

Behavior:
- Compute durationMs = (bars * 4 * 60_000) / bpm.
- Build the export stream (Step 26).
- Create `new MediaRecorder(stream, { mimeType: 'video/webm; codecs=vp9,opus',
  videoBitsPerSecond: 4_000_000 })`.
- Reset Transport to step 0.
- Start the Transport AND the recorder simultaneously.
- onProgress called every 100ms with elapsed / durationMs.
- After durationMs: stop Transport, stop recorder, await stop event.
- Return the Blob.
- Cleanup the stream.

Create `src/components/ExportDialog.tsx`:
- A modal triggered by the "Export" button in the top bar.
- Length slider: 1–8 bars (default 4).
- "Render" button: disabled while rendering.
- Progress bar.
- On completion: trigger a download via:
  ```
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `amateur-hyperactive-${formatDate()}.webm`;
  a.click();
  URL.revokeObjectURL(url);
  ```
- Close button + outside-click to dismiss.

Add the Export button to the top bar (right of the BPM input).

Remove the temporary debug button from Step 26.

Tests:
- Mock MediaRecorder. Verify `exportSong` resolves with a Blob and calls
  onProgress.
- ExportDialog: opens on button click, closes on dismiss, calls exportSong
  with the right bars value.

Manual verification: record clips, sequence a pattern, click Export →
Render. A WebM file downloads. Open it in VLC — your song should play
back with synchronized video.

This is the moment the project becomes shareable. Celebrate.
```

---

### Step 28 — Anthropic API wrapper (pure function)

**Goal:** A function that, given a project state, calls the Anthropic API
and returns an 8×16 boolean grid. Isolated and testable.

**Builds on:** Step 27.

```text
Create `src/lib/aiSuggest.ts`:

```ts
export interface SuggestPatternInput {
  bpm: number;
  subgenre: 'boom-bap' | 'trap';
  tracks: Array<{ id: number; tag: Tag | null }>;
}

export async function suggestPattern(
  input: SuggestPatternInput
): Promise<boolean[][]>;  // 8x16 grid
```

Implementation:
- Use `@anthropic-ai/sdk` with `dangerouslyAllowBrowser: true` (we're
  client-direct in dev; flag is required in browser).
- API key from `import.meta.env.VITE_ANTHROPIC_API_KEY`.
- Throw a clear error if the key is missing.
- Use the request shape from spec § 5.5 (system prompt, tool use schema).
- Parse the tool_use block from the response.
- Validate: must be an array of 8 arrays of 16 booleans. Throw
  ValidationError on mismatch.
- Return the validated grid.

ALSO add a build-time check in `src/main.tsx`:
```
if (import.meta.env.PROD && import.meta.env.VITE_ANTHROPIC_API_KEY) {
  console.warn('🚨 API key built into production bundle! Migrate to a proxy.');
}
```

Add `.env.example` documenting the var. Add a sample
`docs/AI-MIGRATION.md` explaining the proxy migration steps for v2.

Tests in `src/lib/aiSuggest.test.ts`:
- Mock the Anthropic SDK.
- Happy path: returns 8×16 grid.
- Validation: returns 7×16 → throws.
- Validation: returns booleans-as-strings → throws.
- Missing API key → throws clear error.

Do NOT integrate with UI yet — that's Step 29.
```

---

### Step 29 — "Suggest a beat" button + apply + undo

**Goal:** A button in the top bar that calls suggestPattern and applies
the result to the store. A toast notification with an "Undo" action that
reverts to the previous pattern.

**Builds on:** Step 28.

```text
Add a store action: `applyPattern(grid: boolean[][])`. It replaces all
8 tracks' `steps` with the grid. Disabled if grid shape is invalid.

Add a "Suggest a beat" button to the top bar (lucide-react `Sparkles`
icon). Disabled if fewer than 4 tracks have clips.

On click:
1. Snapshot current pattern: `prevSteps = state.tracks.map(t => [...t.steps])`.
2. Show a loading state on the button.
3. Call `suggestPattern({ bpm, subgenre: 'boom-bap', tracks: state.tracks
   .map(t => ({ id: t.id, tag: t.tag }))})`.
4. On success: applyPattern(result), show toast "AI suggested a pattern.
   Undo?" with an Undo button that restores prevSteps.
5. On error: show toast with error message.

Use a small toast component (or @radix-ui/react-toast via shadcn).

For now keep subgenre fixed at 'boom-bap'. Add a small dropdown next to
the button to switch between boom-bap and trap (still simple).

Tests in `src/components/SuggestButton.test.tsx`:
- Disabled with <4 clips.
- Click calls suggestPattern.
- Successful response updates the store.
- Undo restores previous pattern.

Manual verification: record 4+ clips, tag them, click Suggest. The grid
fills with a pattern. Undo restores. Hit play.
```

---

### Step 30 — 3-2-1 countdown UI

**Goal:** When the user clicks record on a track, a 3-2-1 countdown
overlay appears before recording actually starts.

**Builds on:** Step 29.

```text
Create `src/components/RecordCountdown.tsx`:
- A full-screen overlay (semi-transparent black backdrop).
- Large "3", "2", "1" digits, one per second, with a subtle scale-down
  animation each tick.

In the recording flow (Step 11+13), wrap the `recordClip` call:
1. Set recording.state = 'countdown'. Show overlay.
2. Wait 3 seconds, ticking down each second.
3. Set recording.state = 'recording'. Hide overlay (a small recording
   indicator on the track tile takes its place).
4. After recording: state = 'reviewing' until tag is selected, then
   'idle'.

Tests:
- Mock timers (`vi.useFakeTimers`).
- Verify the overlay shows "3", then "2", then "1", then disappears.
- Verify the recording API is called only after the countdown.

Manual verification: click record, see 3-2-1, hear yourself recording.
```

---

### Step 31 — Swing + compatibility banner + final polish

**Goal:** Ship-ready polish. Swing slider works (16th-note offset). Users
on unsupported browsers see a clear banner. Empty states and labels are
all present.

**Builds on:** Step 30.

```text
1. SWING:
   - Add a swing slider to the top bar (0–100%, default 0). Wires to
     `actions.setSwing`.
   - In `src/lib/audio.ts`, configure `Tone.Transport.swing = swing` and
     `Tone.Transport.swingSubdivision = '16n'`. Subscribe to swing
     changes.
   - Verify: with swing 50%, off-beat 16ths shift later (audible
     shuffle).

2. COMPATIBILITY BANNER:
   - On mount, detect browser support: required APIs are MediaRecorder,
     MediaStreamDestination, canvas.captureStream, IndexedDB.
   - On Safari (no MediaRecorder VP9 support): show a banner at the top
     of the page: "Amateur Hyperactive needs Chrome or Edge for v1. Safari support is
     coming."
   - Banner is dismissible (localStorage).
   - Detect via feature detection, not user-agent sniffing.

3. EMPTY STATE:
   - When no clips have been recorded, show a small instructional overlay
     in the viewport: "Record some sounds in the tracks below to get
     started."
   - When the camera isn't enabled, show a "Enable your camera" button
     with explanation.

4. KEYBOARD HINTS:
   - Show key hints next to the play button ("space"), pads ("1"–"8"),
     and BPM input ("scroll to change" — implement scroll-wheel to
     adjust by 1).

5. README:
   - Write `README.md` covering: what it is, how to run locally, how to
     set up the API key, the v1 → public-deploy migration checklist.

6. FINAL E2E SMOKE TEST:
   - Add a Playwright (or just manual) checklist to the README:
     - Record 4 clips.
     - Tag them.
     - Hit Suggest a Beat.
     - Adjust BPM.
     - Hit Play.
     - Click Export → render → download.
     - Refresh page → all clips and pattern restored.
     - Press 1–8 keys live during playback.

Manual verification: complete the smoke-test checklist end-to-end. Fix
anything that cracks.

Ship it.
```

---

## Notes on the prompts

A few things worth flagging before you feed them to your LLM of choice:

1. **Order matters.** Step 20 in particular depends on the renderer being
   stubbed in Step 17–19 first. Don't try to short-circuit by jumping
   straight to "build the whole video engine."

2. **Run tests after every step.** Each prompt specifies what to test;
   don't move on until those tests pass. The cost of skipping is finding
   a sync bug 4 steps later with no idea what introduced it.

3. **Manual verification is part of the loop.** Audio/video work isn't
   fully unit-testable. Each prompt's "manual verification" line is a
   short smoke test the LLM can't do on your behalf.

4. **If a prompt comes back with too much code**, ask the LLM to split.
   Code-gen tools sometimes pile two steps' worth of changes into one
   pass, which is exactly what we tried to avoid by sizing carefully.

5. **The build order of prompts mirrors the build order in the spec
   (§ 12).** They're consistent. If a prompt seems to disagree with the
   spec, the spec wins — re-read it and adjust.

6. **A few things are intentionally deferred to v1.5/v2** and are listed
   in spec § 10. Don't be tempted to bolt them in early. The whole point
   of the staging is to have something playable by Step 12 and shippable
   by Step 27.

Good luck.
