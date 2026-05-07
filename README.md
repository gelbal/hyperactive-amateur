# Hyperactive Amateur

A web app for making Lasse Gjertsen-style "Hyperactive" / "Amateur"
videos: record 8 short clips of yourself making sounds, arrange them on
a 16-step grid, and watch a hard-cut hip-hop music video play back in
real time. Export to WebM.

This repo follows the spec in [`spec.md`](spec.md) and the staged
implementation plan in [`build-plan.md`](build-plan.md), with the v1.1
delta in [`spec-v1.1.md`](spec-v1.1.md). Progress is tracked in
[`todo.md`](todo.md).

## Quick start

```bash
# requires node 20+
npm install
cp .env.example .env.local   # then add your API keys — see below
npm run dev                  # http://localhost:5173
```

You'll be prompted to grant camera + microphone access on first record.
**Hyperactive Amateur targets desktop Chrome / Edge ≥120.** Safari is
unsupported.

## API keys

Two AI providers, each for a different job. Both are optional — the app
runs fine without them, only the corresponding features go quiet.

| Variable | Used for | Get a key |
|---|---|---|
| `VITE_ANTHROPIC_API_KEY` | "Suggest a beat" + variations (Claude Haiku 4.5) | [console.anthropic.com](https://console.anthropic.com) |
| `VITE_GEMINI_API_KEY` | Auto-tagging recorded clips (Gemini 3 Flash Preview) | [aistudio.google.com/app/apikey](https://aistudio.google.com/app/apikey) — free tier, **not** a Google Cloud key |

Drop both into `.env.local`:

```
VITE_ANTHROPIC_API_KEY=sk-ant-...
VITE_GEMINI_API_KEY=AIza...
```

> **Important:** dev keys are bundled into the client. Before deploying
> Hyperactive Amateur anywhere public, follow
> [`docs/AI-MIGRATION.md`](docs/AI-MIGRATION.md) to move both calls
> behind a server proxy.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Vite dev server with HMR |
| `npm run build` | Type-check (`tsc -b`) and produce a production bundle |
| `npm run preview` | Serve the production bundle locally |
| `npm test` | Run the Vitest suite once |
| `npm run test:watch` | Vitest in watch mode |
| `npm run test:ui` | Vitest UI |

## Recording for best results

Hyperactive Amateur cuts between your clips on every musical hit. If
all 8 of your clips are shot from exactly the same distance with the
same framing and the same background, those cuts read as a strobe
instead of a performance. The fix is in your hands, not the app's.

### Vary at least one of these per clip

- **Distance from the camera.** Some clips zoomed in close (mouth fills
  the frame), some clips further back (head and shoulders).
- **Framing position.** Some clips dead-center, some clips left, some
  clips right. Move your chair.
- **Background.** Different walls, a window, a bookshelf, a plant. Move
  the laptop, or move yourself.

You don't need all three for every clip. Even one varied dimension per
clip removes most of the strobe effect.

### A practical recipe (copy this for your first session)

| Track | Sound idea | Framing |
|---|---|---|
| 1 (kick) | mouth thump "buh" | extreme close-up on mouth |
| 2 (snare) | tongue click "tk" | medium, centered |
| 3 (hat) | "ts ts ts" | profile, looking right |
| 4 (vocal) | "yeah" | wide, against window |
| 5 (vocal) | "uh" | wide, against bookshelf |
| 6 (fx) | finger snap | hands only, low frame |
| 7 (fx) | table thump | hands only, low frame |
| 8 (kick alt) | chest hit "hmf" | medium, slight angle |

### One more tip

Keep the lighting the same across clips. Different framings work; wildly
different exposures look like errors.

### Visual cut controls

Three knobs in the top bar tame the visual feel without re-recording:

- **Cut rate** — quantize cuts to 1/16, 1/8 (default), 1/4, 1/2 or 1 bar.
  Audio scheduling stays at 16ths regardless.
- **Hold** — minimum time the renderer holds a cut before another
  same-tier (e.g. vocal → vocal) clip can replace it. Higher-tier
  clips always cut through.
- **Eye toggle on each track row** — flip a track to audio-only so it
  fires sound but never causes a viewport cut. The auto-tag flow sets
  hi-hats to audio-only by default; you can override.

## How it works (one paragraph each)

**Audio.** Tone.js owns the Transport. A 16th-note `scheduleRepeat` fires
`triggerTrack(trackId, when)` per active step. Each track has a pre-built
`Tone.Player` from its decoded `AudioBuffer`; tracks without a clip fall back
to a placeholder synth so the metronome stays audible.

**Video.** A canvas in the centre of the page is the visible "viewport." The
`videoEngine` keeps one hidden `<video>` element per track and a queue of
pending `TriggerEvent`s. A `Tone.Transport.scheduleRepeat` at the configured
cut subdivision picks the priority winner per window (vocal > fx > snare >
kick > hat > untagged) with same-tier ducking, then `drawImage`s that
clip's video frame. Audio-clock-driven so A/V stays locked.

**Live mode.** Keys `1`–`8` (and Numpad), pad clicks, and Transport step
triggers all funnel through `triggerTrack(trackId, when)` so audio,
canvas, and pad-flash feedback line up regardless of source.

**Auto-tag.** When a clip lands, the recorded `AudioBuffer` is encoded to
a tiny WAV and sent to Gemini 3 Flash Preview, which returns one of the
five tags plus a confidence score. Confidence ≥ 0.6 applies the tag;
hat clips also auto-flip to audio-only unless the user has already set
the eye toggle.

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
- [ ] Verify auto-tag assigns a plausible tag (with the Gemini key set).
- [ ] Verify a hat clip auto-flips its eye to closed.
- [ ] Repeat for 3+ more tracks.
- [ ] Toggle a few steps; click play; hear the rhythm.
- [ ] Watch the viewport — frames should cut on the chosen subdivision.
- [ ] Adjust BPM (type or scroll); playback should retune live.
- [ ] Push the swing slider; hats should shuffle.
- [ ] Change cut rate to 1/4 mid-playback — cuts land cleanly on beats.
- [ ] Push the hold slider; same-tier transitions should hold.
- [ ] Press keys `1`–`8` over a playing pattern — pads flash, viewport cuts.
- [ ] Click "Suggest a beat"; confirm a pattern applies; click Undo to revert.
- [ ] Click each variation (Busier / Fill / Half-time / Strip); each undoes cleanly.
- [ ] Export → render 4 bars → WebM downloads and plays correctly in VLC.
- [ ] Refresh the page — clips, tags, BPM, cut rate, hold, and pattern all return.

## Project layout

```
src/
  App.tsx                    # top-level layout + global hooks
  main.tsx                   # entry; warns if API key is in prod bundle
  components/
    StepGrid.tsx, TrackRow.tsx, PadGrid.tsx
    Viewport.tsx             # canvas + rAF render loop
    PlayButton.tsx, BpmInput.tsx, SwingSlider.tsx
    CutSubdivisionSelect.tsx, HoldTimeControl.tsx
    CameraPreview.tsx
    ExportButton.tsx, ExportDialog.tsx
    SuggestButton.tsx, VariationButtons.tsx
    RecordCountdown.tsx, CompatibilityBanner.tsx
  lib/
    audio.ts                 # Tone.Transport, Players, triggerTrack
    videoEngine.ts           # hidden videos, quantized renderer
    recorder.ts              # MediaRecorder wrapper
    autoTrim.ts              # RMS-based clip trim
    wavEncoder.ts            # AudioBuffer → 16-bit PCM WAV
    useMediaStream.ts        # getUserMedia hook
    useKeyboardTriggers.ts   # 1-8 keybinds
    useSpacebarPlayToggle.ts # play/stop shortcut
    persistence.ts, autoSave.ts, rehydrate.ts
    export.ts                # buildExportStream + exportSong
    aiSuggest.ts             # Anthropic wrapper (suggest + variations)
    aiAutoTag.ts             # Gemini wrapper (auto-tag clips)
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
5. Free-text tags beyond the 5 categories.
6. Arrangement / song mode (chain multiple patterns).
