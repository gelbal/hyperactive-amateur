# Hyperpad

A web app for making Lasse Gjertsen-style "Hyperactive" videos: record 8 short
clips of yourself making sounds, arrange them on a 16-step grid, and watch a
hard-cut hip-hop music video play back in real time. Export to WebM.

This repo follows the spec in [`spec.md`](spec.md) and the staged
implementation plan in [`build-plan.md`](build-plan.md). Progress is tracked
in [`todo.md`](todo.md).

## Quick start

```bash
# requires node 20+
npm install
cp .env.example .env.local   # then add your Anthropic key — see below
npm run dev                  # http://localhost:5173
```

You'll be prompted to grant camera + microphone access on first record.
**Hyperpad targets desktop Chrome / Edge ≥120.** Safari is unsupported in v1.

## Anthropic API key

The "Suggest a beat" button calls Claude Haiku 4.5 directly from the browser
in dev. Get a key at [console.anthropic.com](https://console.anthropic.com)
and drop it in `.env.local`:

```
VITE_ANTHROPIC_API_KEY=sk-ant-...
```

Without the key the rest of the app works fine; the Suggest button just
errors when clicked.

> **Important:** the dev key is bundled into the client. Before deploying
> Hyperpad anywhere public, follow [`docs/AI-MIGRATION.md`](docs/AI-MIGRATION.md)
> to move the call behind a server proxy.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Vite dev server with HMR |
| `npm run build` | Type-check (`tsc -b`) and produce a production bundle |
| `npm run preview` | Serve the production bundle locally |
| `npm test` | Run the Vitest suite once |
| `npm run test:watch` | Vitest in watch mode |
| `npm run test:ui` | Vitest UI |

## How it works (one paragraph each)

**Audio.** Tone.js owns the Transport. A 16th-note `scheduleRepeat` fires
`triggerTrack(trackId, when)` per active step. Each track has a pre-built
`Tone.Player` from its decoded `AudioBuffer`; tracks without a clip fall back
to a placeholder synth so the metronome stays audible.

**Video.** A canvas in the centre of the page is the visible "viewport." The
`videoEngine` keeps one hidden `<video>` element per track and a queue of
scheduled `TriggerEvent`s in audio-context seconds. The rAF loop reads
`Tone.now()` (the audio clock — never `performance.now()`), runs gc + active
+ priority resolution, and `drawImage`s the winning track's video frame.
Priority is `vocal > fx > snare > kick > hat > untagged`.

**Live mode.** Keys `1`–`8` (and Numpad), pad clicks, and Transport step
triggers all funnel through `triggerTrack(trackId, when)` so the audio,
canvas, and pad-flash feedback line up regardless of source.

**Persistence.** A debounced subscriber in `autoSave.ts` writes the project
to IndexedDB 500ms after any edit. On mount, `rehydrate.ts` decodes each
clip blob into a fresh `AudioBuffer`, recreates the object URLs, and
dispatches `hydrateProject` — the audio + video subscriptions pick up the
new clips automatically.

**Export.** `buildExportStream` taps `Tone.getDestination()` into a
`MediaStreamDestination` (so speakers stay live) and combines that with
`canvas.captureStream(30)`. `exportSong` runs the Transport for the chosen
bars while a `MediaRecorder` records, then resolves with a single WebM blob.

## Manual smoke-test checklist

After any non-trivial change, walk this end-to-end:

- [ ] Enable camera (top right) and grant permission.
- [ ] Record a clip on track 1 — see the 3-2-1 countdown, then the thumbnail.
- [ ] Tag it (kick/snare/hat/vocal/fx).
- [ ] Repeat for 3+ more tracks.
- [ ] Toggle a few steps; click play; hear the rhythm.
- [ ] Watch the viewport — frames should cut on each beat.
- [ ] Adjust BPM (type or scroll); playback should retune live.
- [ ] Push the swing slider; hats should shuffle.
- [ ] Press keys `1`–`8` over a playing pattern — pads flash, viewport cuts.
- [ ] Click "Suggest a beat"; confirm a pattern applies; click Undo to revert.
- [ ] Export → render 4 bars → WebM downloads and plays correctly in VLC.
- [ ] Refresh the page — clips, tags, BPM, and pattern all return.

## Project layout

```
src/
  App.tsx                    # top-level layout + global hooks
  main.tsx                   # entry; warns if API key is in prod bundle
  components/
    StepGrid.tsx, TrackRow.tsx, PadGrid.tsx
    Viewport.tsx             # canvas + rAF render loop
    PlayButton.tsx, BpmInput.tsx, SwingSlider.tsx
    CameraPreview.tsx
    ExportButton.tsx, ExportDialog.tsx
    SuggestButton.tsx
    RecordCountdown.tsx, CompatibilityBanner.tsx
  lib/
    audio.ts                 # Tone.Transport, Players, triggerTrack
    videoEngine.ts           # hidden videos, scheduled-event renderer
    recorder.ts              # MediaRecorder wrapper
    autoTrim.ts              # RMS-based clip trim
    useMediaStream.ts        # getUserMedia hook
    useKeyboardTriggers.ts   # 1-8 keybinds
    useSpacebarPlayToggle.ts # play/stop shortcut
    persistence.ts, autoSave.ts, rehydrate.ts
    export.ts                # buildExportStream + exportSong
    aiSuggest.ts             # Anthropic SDK wrapper
  store/
    useAppStore.ts           # Zustand store + actions
    initialState.ts          # 8 empty tracks, 90 BPM
  types.ts                   # shared domain types
```

## Roadmap

`spec.md` § 10 lists the v2 backlog. The shortlist:

1. Grid playback view (Incredibox-style).
2. WebCodecs MP4 export (faster than realtime).
3. Manual trim handles on the clip waveform.
4. Multiple named projects.
5. AI variations ("make it busier" / "half-time it").
