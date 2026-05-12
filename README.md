# Hyperactive Amateur

A browser-based step sequencer for making hard-cut sample-from-yourself
videos. Record eight short clips of yourself making sounds, drop them
on a 16-step grid, hit play, and watch a hip-hop video of you
"performing" the song play back in real time. Export to WebM.

## Quick start

```bash
# requires node 20+
npm install
cp .env.example .env.local        # add your Gemini key, see below
npm run dev                       # http://localhost:5173
```

You'll be prompted for camera and microphone access on first record.
**Built for desktop Chrome and Edge ≥120.** Recent Firefox should work
(the in-app compatibility banner feature-detects what it needs).
Safari is unsupported until it ships VP9 `MediaRecorder`.

## API key

The "Suggest a beat", variation buttons (Busier / Fill / Half-time /
Strip), and clip auto-tagging all run on Gemini Flash. Get a free
key at [aistudio.google.com/app/apikey](https://aistudio.google.com/app/apikey)
(Google AI Studio key, **not** a Google Cloud key) and put it in
`.env.local`:

```
GEMINI_API_KEY=AIza...
```

Without a key the rest of the app works fine; AI features just go
quiet.

## Recording for best results

The hard-cut output cuts between your clips on every musical hit. If
all eight clips are shot from the same distance with the same framing
and the same background, those cuts read as a strobe instead of a
performance. The fix is in your hands, not the app's.

**Vary at least one of these per clip:**

- **Distance from the camera.** Some close-up (mouth fills the
  frame), some further back.
- **Framing.** Some center, some left, some right. Move your chair.
- **Background.** Different walls, a window, a bookshelf. Move the
  laptop, or move yourself.

A practical first session:

| Track | Sound | Framing |
|---|---|---|
| 1 (kick) | mouth thump "buh" | extreme close-up on mouth |
| 2 (snare) | tongue click "tk" | medium, centered |
| 3 (hat) | "ts ts ts" | profile, looking right |
| 4 (vocal) | "yeah" | wide, against window |
| 5 (vocal) | "uh" | wide, against bookshelf |
| 6 (fx) | finger snap | hands only, low frame |
| 7 (fx) | table thump | hands only, low frame |
| 8 (kick alt) | chest hit "hmf" | medium, slight angle |

## Visual cut controls

Three dials in the **Feel** popover tame the visual feel without
re-recording:

- **Cut rate** quantizes cuts to 1/16, 1/8 (default), 1/4, 1/2, or
  1 bar. Audio scheduling stays at 16ths regardless.
- **Hold** sets the minimum time the renderer holds a cut before a
  same-tier (e.g. vocal → vocal) clip can replace it. Higher-tier
  clips always cut through.
- The **eye toggle** on each track row flips a track to audio-only
  so it fires sound but never causes a viewport cut. Auto-tag flips
  hi-hats to audio-only by default; override any time.

## Inspiration

Inspired by Lasse Gjertsen's two videos:

- [Hyperactive](https://www.youtube.com/watch?v=o9698TqtY4A)
- [Amateur](https://www.youtube.com/watch?v=JzqumbhfxRo)

He cut every shot by hand. This app collapses the workflow into a
sequencer.
