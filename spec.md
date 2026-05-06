# spec.md — Amateur Hyperactive

> A web app for making Lasse Gjertsen–style "Hyperactive" videos: record 8 short
> clips of yourself making sounds, arrange them in a step sequencer, get a
> hip-hop beat with synchronized hard-cut video as output.

---

## 1. Vision

**One-line pitch.** Record eight ~1–2 second sound+video clips of yourself, drop
them onto a 16-step grid, hit play, and watch a hyperactive hip-hop music video
of you "performing" the song play back in real time. Export to WebM and share.

**Inspiration.** Lasse Gjertsen's "Hyperactive" and "Amateur" — sample-based
videos built from hundreds of one-sound clips, sequenced to form a song. We're
collapsing that workflow into an app: record fast, sequence on a grid (not a
free timeline), play back as a single hard-cut viewport.

**Why hip-hop.** Sample-based by tradition, rhythm-forward, tolerant of lo-fi
audio, and the genre's aesthetic embraces glitch/chop/cut — exactly what this
tool produces.

---

## 2. Scope

### In scope (v1)

- Webcam + mic recording, one clip per track, with auto-trim.
- 8 tracks × 16 steps step sequencer.
- Hard-cut single-viewport playback (canvas-based renderer).
- Live keyboard mode: freestyle + play-along, `1`–`8` keybinds with onscreen
  pads.
- AI "Suggest a beat" feature (Claude Haiku 4.5).
- Real-time WebM export via `MediaRecorder`.
- Auto-save single project to IndexedDB.

### Out of scope (v1) — see § v2 Roadmap

- Grid playback view (Incredibox-style).
- WebCodecs MP4 export.
- Multiple named projects / project picker.
- Sampler/keyboard mode for melodies (pitch-shifted clips across keys).
- Free timeline / video-editor mode.
- Cloud sync, accounts, share-by-link.
- Mobile / tablet support.
- Audio classification (auto-labeling clips).

---

## 3. Core user flow

```
1. Open app → empty 8-track sequencer + record permission prompt.
2. Click record on Track 1 slot → 3-2-1 countdown → record up to 2s →
   auto-trim → preview.
3. Optional: tag the clip ('kick' / 'snare' / 'hat' / 'vocal' / 'fx').
4. Repeat for tracks 2–8.
5. Toggle steps on the grid manually — OR — click "Suggest a beat" → AI
   fills the grid based on track tags + tempo + genre.
6. Hit play → playhead sweeps the grid, audio plays, viewport hard-cuts to
   the active track's clip on each hit.
7. Optionally jam live with keyboard `1`–`8` over the playing pattern.
8. Click export → real-time MediaRecorder capture → WebM downloads.
9. Refresh-safe: project autosaved continuously to IndexedDB.
```

---

## 4. Tech stack

### Decided

| Concern         | Choice                  | Rationale                                                                 |
| --------------- | ----------------------- | ------------------------------------------------------------------------- |
| Framework       | React 18 + TypeScript   | Maximum AI/ecosystem support, safe for vibe coding.                       |
| Build tool      | Vite                    | Fast dev server, modern, no SSR needed.                                   |
| State           | Zustand                 | Minimal boilerplate for the amount of state we have.                      |
| Styling         | Tailwind + shadcn/ui    | Fast UI iteration; shadcn primitives for buttons / dialogs / sliders.     |
| Audio           | Tone.js (on Web Audio)  | `Tone.Transport` solves BPM, scheduling, swing, quantization out of box.  |
| Storage         | IndexedDB via `idb-keyval` | Tiny wrapper, sufficient for our blob + JSON needs.                    |
| Recording       | `MediaRecorder` + `getUserMedia` | Native browser APIs, no library needed.                          |
| Export          | `MediaRecorder` from `canvas.captureStream()` + audio context | Real-time WebM. Simple. |
| AI provider     | Claude Haiku 4.5        | Fast, cheap, reliable structured output via tool use.                     |
| AI architecture | Client-direct, env-var key (DEV ONLY) | Fastest dev path. **MUST** migrate to proxy before public deploy. |
| Hosting         | Vercel (or Cloudflare Pages) | Static deploy; ready to add edge function later for AI proxy.         |
| Browser target  | Chrome/Edge desktop, current versions | All required APIs supported.                                |

### Hard dependencies

- `react`, `react-dom`
- `vite`, `@vitejs/plugin-react`, `typescript`
- `tone`
- `zustand`
- `tailwindcss`, `@radix-ui/*` (via shadcn/ui)
- `idb-keyval`
- `@anthropic-ai/sdk` (or plain `fetch` against `/v1/messages`)

---

## 5. Functional specifications

### 5.1 Recording

**Trigger.** Click the record button in any empty track slot (or right-click
"re-record" a filled slot).

**Flow.**
1. Pre-flight: ensure `getUserMedia({ video: true, audio: true })` permission
   has been granted; if not, show prompt.
2. Show 3-2-1 countdown overlay (1s per number).
3. Start recording with `MediaRecorder` configured as
   `{ mimeType: 'video/webm; codecs=vp9,opus' }`. Hard cap at 2000ms with
   `setTimeout`-based stop.
4. On stop, get the `Blob`; decode the audio side into an `AudioBuffer` for
   downstream auto-trim and Tone.js playback.
5. Run auto-trim algorithm (§ 5.2). Persist trimmed clip to IndexedDB.
6. Show preview (clip plays once) + tag picker (5 chips: kick / snare / hat /
   vocal / fx; "skip" allowed).
7. Slot is now filled; clip is ready to be triggered.

**Constraints.**
- Resolution: capture at native webcam resolution but downscale to 720×720
  square for storage and rendering. Square aspect ratio simplifies the
  hard-cut viewport.
- Audio: 48kHz, mono.
- Per-clip storage budget: ~500KB–2MB after compression.

### 5.2 Auto-trim algorithm

Goal: remove silence before the user's sound and trim trailing dead air.

```ts
function autoTrim(buffer: AudioBuffer): { startMs: number; endMs: number } {
  // 1. Compute RMS in 10ms windows across the buffer.
  // 2. Find the window with the maximum RMS = "peak".
  // 3. Walk backward from peak until RMS drops below 5% of peak. That's
  //    sound-onset; subtract 50ms pre-roll for safety.
  // 4. End = min(peak + 1500ms, buffer.duration). Hard cap 1.5s of audible
  //    content per clip.
  // 5. Return { startMs, endMs }. The original blob is preserved; trim
  //    points are metadata that drive playback offsets.
}
```

Trim is **non-destructive**: original blob is kept, `trimStartMs` /
`trimEndMs` are offsets used by Tone.js (`Player.start(time, offset, duration)`)
and the canvas video renderer. User can manually adjust trim with handles
(stretch goal in v1; fine for v1.5).

### 5.3 Tracks and step sequencer

**Layout.** 8 horizontal track rows, each with:
- Clip preview thumbnail (first frame after auto-trim)
- Track tag chip (kick / snare / hat / vocal / fx / unset)
- 16 step toggles
- Mute / volume per track
- Re-record button

**Controls (top bar).**
- Play / stop
- BPM input (60–180, default 90, also adjustable via mouse-drag on the value)
- Swing slider (0–100%, default 0)
- "Suggest a beat" button (§ 5.5)
- Export button

**Grid behavior.**
- 16 steps = 1 bar of 16th notes.
- Step toggles are simple booleans per track.
- Visual playhead sweeps left-to-right during playback, highlighting the
  current step.
- Steps 1, 5, 9, 13 (downbeats) are visually emphasized.

**Quantization.** All sequencer triggers are quantized to 16th notes via
`Tone.Transport`. No micro-timing in v1.

### 5.4 Playback (hard-cut renderer)

This is the trickiest piece. The renderer is **canvas-based** because:
- It composes cleanly into a `MediaStream` for export.
- Future v2 grid view can swap a different draw routine without touching
  the audio path.
- Source-swap on a single `<video>` element has worse seek latency than
  drawing from one of N preloaded videos.

**Architecture.**

```
8 hidden <video> elements    ──► canvas (visible viewport)
     ▲                              ▲
     │ play() / seek                │ ctx.drawImage() each frame
     │                              │
Trigger function ◄────── audioContext.currentTime clock ──┐
     ▲                                                    │
     │                                                    │
Tone.Transport step callbacks ──┴──► Tone.Player.start() (audio)
Keyboard / pad handlers ────────┴──► same trigger function
```

**Active-clip selection (when multiple tracks fire on the same step).**
Audio: all triggered tracks play simultaneously (mixed). Video: priority
order picks one clip to display. Default priority (highest first):
`vocal > fx > snare > kick > hat > unset`. User can drag to reorder
priority in v1.5; v1 ships fixed priority.

**Trigger function.**
```ts
function triggerTrack(trackId: number, when: number) {
  // Audio: schedule clip on Tone.Transport at `when`.
  tracks[trackId].player.start(when, trimStartMs / 1000,
                                (trimEndMs - trimStartMs) / 1000);
  // Video: register an "active clip" event for the renderer to consume.
  videoScheduler.add({ trackId, when });
}
```

**Canvas render loop.**
- Driven by `requestAnimationFrame`, but timing decisions read from
  `audioContext.currentTime`, NOT `performance.now()`. This is critical —
  see § 9 implementation notes.
- On each frame:
  1. Compute current audio time.
  2. Find the most recent video event with `when <= currentTime` that has
     priority over any other active event. Resolve via priority table.
  3. Read the corresponding hidden `<video>` element's current frame
     (advance `currentTime` if needed).
  4. `ctx.drawImage(video, 0, 0, 720, 720)`.

### 5.5 AI: Suggest a beat

**Endpoint.** Claude Haiku 4.5 via Anthropic Messages API.

**Trigger.** "Suggest a beat" button. Disabled until at least 4 of 8 tracks
have clips. Replaces current pattern (with toast + undo).

**Request shape.**
```json
{
  "model": "claude-haiku-4-5-20251001",
  "max_tokens": 512,
  "system": "You are a hip-hop beat producer. Given track labels, tempo, and a target subgenre, return a 16-step pattern across 8 tracks as strict JSON. Patterns should feel musical, with kick on 1 and 9 by default for boom-bap, snare on 5 and 13, and varying hat density. Use vocal/fx tracks sparingly for accents.",
  "messages": [{
    "role": "user",
    "content": "Tempo: 90 BPM. Subgenre: boom-bap. Tracks: 0=kick, 1=snare, 2=hat, 3=vocal-yeah, 4=vocal-uh, 5=fx, 6=clap, 7=unset. Generate a pattern."
  }],
  "tools": [{
    "name": "set_pattern",
    "description": "Set the 8x16 step pattern for the sequencer.",
    "input_schema": {
      "type": "object",
      "properties": {
        "tracks": {
          "type": "array",
          "items": {
            "type": "array",
            "items": { "type": "boolean" },
            "minItems": 16,
            "maxItems": 16
          },
          "minItems": 8,
          "maxItems": 8
        }
      },
      "required": ["tracks"]
    }
  }],
  "tool_choice": { "type": "tool", "name": "set_pattern" }
}
```

**Response handling.** Extract `tool_use` block's `input.tracks`. Validate
shape (8×16 booleans). Apply to store. If validation fails, show toast and
do nothing.

**Cost.** ~250 tokens in, ~150 tokens out. Pennies per call. No rate
limiting needed at v1 scale.

**Failure modes.**
- Network error → toast "Couldn't reach the model. Try again."
- Schema mismatch → toast "Got a weird response. Try again."
- API key missing → block button entirely with explanatory tooltip.

**Migration to proxy (before any public deploy).** Move the `fetch` call
into a Vercel Edge Function at `/api/suggest-pattern`. Client posts the
already-formatted prompt body; function adds `Authorization: Bearer
$ANTHROPIC_API_KEY` and forwards. ~30 lines.

### 5.6 Live keyboard mode

**Modes.**
- **Freestyle**: sequencer is stopped. Keyboard `1`–`8` (and on-screen pads,
  also `ASDFGHJK` as alt) trigger the corresponding track's clip. Same
  hard-cut renderer.
- **Play-along**: sequencer is running its pattern. Live keypresses layer
  on top — they fire additional triggers AND win the visual cut for that
  moment (overriding the priority table).

**Trigger handling.**
- `keydown` event with `event.repeat === false` → call `triggerTrack(n, now)`.
- `keyup` is ignored (clips play to their natural length; no held-note
  semantics in v1).
- Latency budget: <50ms key-to-sound (Web Audio with pre-decoded buffers
  trivially achieves this).

**On-screen pads.** 8 large clickable tiles, labeled with track tag and
keybind hint. Tap = trigger. Visual feedback: pad flashes when triggered
(by any source — keyboard, sequencer, or click).

### 5.7 Export

**v1: Real-time `MediaRecorder` to WebM.**

```ts
async function exportSong(durationMs: number): Promise<Blob> {
  const canvasStream = canvas.captureStream(30); // 30 fps
  const audioDest = audioContext.createMediaStreamDestination();
  // Route Tone.Master into audioDest (Tone.connect(Tone.getDestination(),
  // audioDest)).
  const stream = new MediaStream([
    canvasStream.getVideoTracks()[0],
    audioDest.stream.getAudioTracks()[0],
  ]);
  const recorder = new MediaRecorder(stream, {
    mimeType: 'video/webm; codecs=vp9,opus',
    videoBitsPerSecond: 4_000_000,
  });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => chunks.push(e.data);
  recorder.start();
  Tone.Transport.start();
  await wait(durationMs);
  Tone.Transport.stop();
  recorder.stop();
  await new Promise(r => recorder.onstop = r);
  return new Blob(chunks, { type: 'video/webm' });
}
```

**Default export length.** 4 bars at current BPM (~10s at 90 BPM). Slider
1–8 bars in the export dialog.

**Filename.** `amateur-hyperactive-{projectName}-{YYYYMMDD-HHmm}.webm`.

**v2 path: WebCodecs.** Same canvas renderer, but instead of MediaRecorder,
encode frames offline via `VideoEncoder` and mux to MP4 using `mp4-muxer`.
Produces shareable MP4, faster than realtime.

### 5.8 Persistence

**Schema (single record at key `current-project`).**

```ts
interface PersistedProject {
  version: 1;
  bpm: number;
  swing: number;
  tracks: PersistedTrack[]; // length 8
  updatedAt: number;
}
interface PersistedTrack {
  id: number;
  clipBlob: Blob | null;       // video/webm
  trimStartMs: number;
  trimEndMs: number;
  tag: 'kick' | 'snare' | 'hat' | 'vocal' | 'fx' | null;
  steps: boolean[];            // length 16
  volume: number;
  muted: boolean;
}
```

**Save trigger.** Debounced 500ms after any state change. Rehydrate on
load.

**Quota.** Expect <20MB per project. Modern Chrome offers tens of GB.

**Reset.** "New project" button shows confirmation, then clears the record
and reinitializes empty state.

---

## 6. Non-functional requirements

- **Audio latency**: trigger-to-sound <50ms (key, click, or sequencer step).
- **Video sync**: hard cuts within ±50ms of audio onset.
- **Recording start latency**: countdown end → recording active <50ms.
- **AI suggest latency**: button click → pattern applied <2s p95.
- **Page load**: cold load to interactive <3s on a 50Mbps connection.
- **Memory ceiling**: <300MB resident with 8 clips loaded.
- **Browser support**: Chrome ≥120, Edge ≥120 fully supported. Firefox best
  effort. Safari unsupported in v1 (show compatibility banner).

---

## 7. Data model (in-memory)

```ts
// Zustand store shape (simplified)
interface AppState {
  project: {
    bpm: number;
    swing: number;
    tracks: Track[];
  };
  playback: {
    isPlaying: boolean;
    currentStep: number;       // 0-15, drives playhead UI
    activeTriggers: ActiveTrigger[]; // recent trigger events for renderer
  };
  recording: {
    activeTrackId: number | null;
    state: 'idle' | 'countdown' | 'recording' | 'reviewing';
  };
  ui: {
    selectedTrackId: number | null;
    showExportDialog: boolean;
  };
}

interface Track {
  id: number;
  clip: Clip | null;
  steps: boolean[];
  volume: number;
  muted: boolean;
  tag: Tag | null;
}

interface Clip {
  blob: Blob;
  url: string;                 // object URL, recreated on rehydrate
  audioBuffer: AudioBuffer;    // for Tone.Player
  trimStartMs: number;
  trimEndMs: number;
  durationMs: number;
}

type Tag = 'kick' | 'snare' | 'hat' | 'vocal' | 'fx';

interface ActiveTrigger {
  trackId: number;
  startedAt: number;           // audioContext.currentTime
  durationMs: number;
}
```

---

## 8. Architecture

```
┌─────────────────────────────────────────────────────────┐
│                       React UI                          │
│  TrackRow × 8, StepGrid, TopBar, Pads, ExportDialog     │
└──────────────┬──────────────────────────┬───────────────┘
               │                          │
               ▼                          ▼
       ┌───────────────┐         ┌────────────────┐
       │ Zustand store │◄────────│ Persistence    │
       │  (project +   │         │ (idb-keyval,   │
       │  playback)    │ debounce│  IndexedDB)    │
       └───┬───────┬───┘         └────────────────┘
           │       │
           ▼       ▼
    ┌──────────┐ ┌─────────────────┐
    │ Audio    │ │ Video           │
    │ engine   │ │ engine          │
    │(Tone.js: │ │(canvas + 8      │
    │ Transport│ │ hidden <video>) │
    │ + Players│ │                 │
    └────┬─────┘ └────────┬────────┘
         │                │
         └────────┬───────┘
                  ▼
       audioContext.currentTime
       (single clock for everything)
```

---

## 9. Implementation notes (read this before coding)

These are the gotchas that will eat days if missed.

1. **Single clock: `audioContext.currentTime`.** Drive the canvas render
   loop's "what should be on screen?" decision from the audio clock, not
   `performance.now()` and not `requestAnimationFrame`'s elapsed time.
   `requestAnimationFrame` decides *when to paint*; the audio clock decides
   *what to paint*. Mixing these is the #1 source of A/V drift.

2. **Pre-decode all audio on clip load.** Do
   `audioContext.decodeAudioData(blob)` once, store the `AudioBuffer`,
   reuse on every trigger. Decoding on trigger adds ~10–50ms of latency.

3. **Pre-warm hidden videos.** Set `video.preload = 'auto'`,
   `video.muted = true` (browsers won't autoplay unmuted), and on each
   trigger do `video.currentTime = trimStartMs / 1000; video.play()`.
   Failing to mute = failed `play()` returns rejected promise.

4. **MediaRecorder and audio routing.** Tone.js routes through
   `Tone.getDestination()`. To capture for export: route a tap of that
   destination into `audioContext.createMediaStreamDestination()`. Don't
   *replace* the destination — the user still needs to hear playback.

5. **`canvas.captureStream(30)` framerate.** 30 fps is enough for hard
   cuts and produces smaller files. 60 fps doubles file size for no
   visible win in this aesthetic.

6. **IndexedDB blob lifetime.** Object URLs created with
   `URL.createObjectURL(blob)` must be revoked on clip replacement to avoid
   leaks. Recreate them on every rehydrate.

7. **Keyboard input scope.** Attach key listeners to `document` only when
   the app is focused and not in a text input (BPM field, project name).
   Use `event.target.tagName === 'INPUT'` guards.

8. **AI key handling.** The env var (`VITE_ANTHROPIC_API_KEY`) is exposed
   to the client at build time. Add a runtime warning banner if
   `import.meta.env.PROD === true` and the key is set — prevents accidental
   public deploy with a leaked key.

9. **iOS Safari is not supported.** Show a compatibility banner up front;
   trying to limp along leaks effort everywhere. Revisit when Safari ships
   WebCodecs.

---

## 10. v2 roadmap (in priority order)

1. **Grid view.** Incredibox-style 8-tile playback view, toggleable
   alongside hard-cut. Same data, different draw routine.
2. **WebCodecs MP4 export.** Faster-than-realtime, shareable MP4 output.
3. **Manual trim UI.** Drag handles on the clip waveform to fine-tune
   trim points.
4. **Multiple named projects.** Project picker, duplicate, rename, delete.
5. **AI variations.** "Make it busier" / "Add a fill" / "Half-time it"
   buttons.
6. **Sampler / keyboard mode.** Pitch-shift one clip across a keyboard for
   melodies. Solves the "Amateur" use case.
7. **Audio classification.** Auto-tag clips on record using a multimodal
   model — drops the manual tag step.
8. **Long-take recording mode.** Record a 30s take, auto-chop on transients
   into 8 clips.
9. **AI proxy.** Vercel Edge Function for production deployment.
10. **Mobile / PWA.** When iOS Safari catches up on WebCodecs.

---

## 11. Open questions

- **App name.** **Amateur Hyperactive** (after Lasse Gjertsen's two source
  videos). Earlier working name "Hyperpad" was dropped before v1.2.
- **Visual aesthetic accent color.** Suggested options:
  hip-hop-orange (`#FF5C00`), glitch-magenta (`#FF1F8F`),
  classic-MPC-red (`#E60012`). Pick one for shadcn theme.
- **Default export length.** Currently 4 bars. Worth user-testing 8 bars
  as a default — feels more like a "song."
- **Tag taxonomy.** kick/snare/hat/vocal/fx is a 5-category compromise.
  Worth considering a "free text" override for unusual sounds (table-thump,
  bottle-cap) once we see what users actually record.
- **Onboarding.** First-time users will land on an empty 8-track grid with
  no idea what to do. Worth a 30-second guided tour or a "load demo
  project" button with pre-recorded clips (would require shipping a few
  MB of demo assets).

---

## 12. Build order suggestion (for vibe coding)

A workable order to keep momentum and have something playable early:

1. Vite + React + TS + Tailwind shell. Render an 8×16 grid of buttons,
   wire up Zustand state for which steps are toggled.
2. Add Tone.js. Wire up `Tone.Transport` to step through the grid at
   90 BPM. Use a placeholder audio sample (e.g., a pre-loaded mp3 of a
   kick) to verify scheduling works.
3. Add `getUserMedia` + `MediaRecorder`. Record a clip to an in-memory
   blob, decode to AudioBuffer, swap in for the placeholder. Now you can
   record one sound and beat with it.
4. Scale to 8 tracks. Add the per-track record button + tag picker.
5. Build the canvas hard-cut renderer. Start with 1 visible video, then
   wire the trigger → video swap logic.
6. Add the live keyboard pads. Free, since `triggerTrack` already exists.
7. Add IndexedDB persistence. Verify refresh-safety end-to-end.
8. Add MediaRecorder export.
9. Add the AI "Suggest a beat" button.
10. Polish: countdown UI, auto-trim, swing slider, BPM input.

Steps 1–4 should be ~2 days of vibe coding. Steps 5–8 are the meaty
middle. Steps 9–10 are quick wins to feel done.
