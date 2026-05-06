# Hyperpad — implementation checklist

Tracks progress against `build-plan.md` (31 steps across 10 phases). Check items as they ship; each step ends with `npm test` green plus, where applicable, manual verification in the browser.

## Phase 1 · Foundation

- [x] **Step 1** — Vite + React + TS scaffolding, Tailwind, Vitest, deps installed, blank `<h1>Hyperpad</h1>` page
- [x] **Step 2** — Type definitions in `src/types.ts`, `createInitialState()` factory + tests
- [x] **Step 3** — Zustand store skeleton with `toggleStep`, `setBpm`, `setSwing`, `setTrackVolume`, `setTrackMuted` + tests
- [x] **Step 4** — `<StepGrid />` renders 8×16 buttons wired to store, downbeats emphasized

## Phase 2 · Audio sequencer

- [x] **Step 5** — Tone.js bootstrap, Transport ticks 16ths, metronome on every step
- [x] **Step 6** — Triggers gated on `track.steps[i] === true`, mute respected, per-track pitches
- [x] **Step 7** — Play/stop button, spacebar toggle, visual playhead overlay
- [x] **Step 8** — `<BpmInput />` updates Transport live, clamping at store level

## Phase 3 · Recording

- [x] **Step 9** — `useMediaStream` hook + `<CameraPreview />` component
- [x] **Step 10** — `recordClip()` wrapper around MediaRecorder returning `{ blob, audioBuffer, durationMs }`
- [x] **Step 11** — Track 0 record button → stores `Clip`, thumbnail, re-record affordance
- [x] **Step 12** — Track 0 clip replaces metronome via per-track `Tone.Player` map

## Phase 4 · Multi-track sound

- [x] **Step 13** — Recording enabled on all 8 tracks
- [x] **Step 14** — Tag picker (kick/snare/hat/vocal/fx) chips per track

## Phase 5 · Auto-trim

- [x] **Step 15** — `autoTrim()` pure function (RMS windows, peak detect, 5% threshold) + tests
- [x] **Step 16** — Recording flow stores trim values; `Player.start` uses trim offsets

## Phase 6 · Hard-cut video

- [x] **Step 17** — `<Viewport />` 480×480 canvas with rAF render loop scaffold
- [x] **Step 18** — `videoEngine` module: 1 hidden video for track 0 → drawn to canvas on trigger
- [x] **Step 19** — All 8 hidden videos, naive most-recent-wins swap
- [x] **Step 20** — *Critical:* render loop reads `Tone.now()`, scheduled-event queue with GC
- [x] **Step 21** — Tag-based priority resolution (vocal > fx > snare > kick > hat > untagged)

## Phase 7 · Live mode

- [x] **Step 22** — `useKeyboardTriggers` hook for `1`–`8` (and Numpad), `triggerTrack` extracted
- [x] **Step 23** — `<PadGrid />` 4×2 clickable pads with flash-on-trigger feedback

## Phase 8 · Persistence

- [x] **Step 24** — `persistence.ts` save/load/clear via `idb-keyval` + temporary Save/Load buttons
- [ ] **Step 25** — Debounced auto-save (500ms), rehydrate on mount, decode blobs back to `AudioBuffer`

## Phase 9 · Export

- [ ] **Step 26** — `buildExportStream()` combines `canvas.captureStream(30)` + Tone audio dest
- [ ] **Step 27** — `exportSong()` + `<ExportDialog />` with bars slider, progress, WebM download

## Phase 10 · AI + polish

- [ ] **Step 28** — `suggestPattern()` Anthropic SDK wrapper with tool-use schema validation
- [ ] **Step 29** — "Suggest a beat" button, undo toast, boom-bap/trap dropdown — *requires `VITE_ANTHROPIC_API_KEY`*
- [ ] **Step 30** — 3-2-1 countdown overlay before recording begins
- [ ] **Step 31** — Swing slider, compatibility banner, empty states, keyboard hints, README, smoke-test checklist

---

## Cross-cutting reminders (from spec § 9)

- Single clock: `audioContext.currentTime` (via `Tone.now()`) is the source of truth — **never** `performance.now()` for A/V decisions
- Pre-decode audio on clip load (cache `AudioBuffer`, reuse on every trigger)
- Pre-warm hidden videos: `preload='auto'`, `muted=true`, set `currentTime` then `play()`
- For export, *tap* `Tone.getDestination()` into `MediaStreamDestination`, don't replace it
- Revoke object URLs on clip replacement to avoid leaks
- Keyboard handlers must skip when focus is in `<input>` / `<textarea>`
- iOS Safari is unsupported in v1; show a banner

## API key milestone

The Anthropic key is needed at **Step 28**. Until then, no env var required. When we get there I'll prompt for it and explain where to drop it (`.env.local` → `VITE_ANTHROPIC_API_KEY=…`).
