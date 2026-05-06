# spec-v1.1.md — Hyperpad v1.1

> **Builds on:** v1 as specified in `spec.md` and built per `build-plan.md`.
> Assumes everything in v1 is shipped and working. This document is a delta.

---

## 1. Why this version exists

v1 ships the core mechanic (record → sequence → hard-cut playback → export) and
it works. But the hard-cut output is *too* hyperactive in practice — not
because the engine is broken, but because:

1. The visual cut rate is locked to the audio trigger rate (every 16th).
   Lasse Gjertsen cuts on 16ths plenty, but he cuts between *visually
   different shots* (drums close-up, piano hands, face wide). When every
   clip is shot at the same distance with the same framing, fast cutting
   reads as a strobe, not as a performance.
2. Some tracks (hats, ghost notes) shouldn't drive a video cut at all.
   They're audio carriers, not visual events.
3. Same-priority back-to-back triggers (vocal → vocal → vocal) re-cut
   between near-identical frames, compounding the strobe.

v1.1 addresses #2 and #3 in code (cheap), #1 partially in code, and #1
mostly via documentation (recording guide). It also expands AI usage in
two specific places where it has high leverage and shares existing
infrastructure.

---

## 2. Scope

### In scope (v1.1)

| # | Feature | Type |
|---|---|---|
| 1 | Per-track "show video" toggle | UX fix |
| 2 | User-controlled visual cut subdivision | UX fix |
| 3 | Same-tier ducking with configurable hold time | UX fix |
| 4 | Auto-tag clips on record (replaces manual picker as default) | AI |
| 5 | Pattern variations (busier / fill / half-time / strip) | AI |
| 6 | README recording guide | Docs |

### Deferred (with rationale)

- **Free-text tags beyond the 5 categories.** Breaks the priority table.
  Needs LLM-assigned priority tier per custom tag. Sequence-wise, ship
  auto-tag first, see the feel, then build free-text on top. → v1.2.
- **Arrangement / song mode.** Real product expansion (loop maker →
  song maker). Changes the data model, playback, and export. → v2.
- **Grid view.** Resisting on principle: it's a different aesthetic, not
  a fix for the hard-cut view. The hard-cut view is fixable. → v2 (if
  ever).
- **Deterministic micro-zoom variation per clip.** Considered, dropped
  for v1.1 — the recording guide gets you most of the way there for
  free, and code-faking framing variation feels like a hack. → reconsider
  in v1.2 if the recording guide doesn't land.

---

## 3. Functional specifications

### 3.1 Per-track "show video" toggle

**What.** Each track row gets a small icon button (eye / eye-off, lucide
`Eye` / `EyeOff`) controlling whether triggering this track produces a
video cut. Audio always plays regardless.

**Default.** `showVideo: true` for all tracks. New tracks are visible.

**Data model change.** Add to `Track`:

```ts
interface Track {
  // ...existing fields
  showVideo: boolean;  // default true
}
```

Add to persistence schema (`PersistedTrack`) with safe migration: if the
field is missing on load (existing v1 saves), default to `true`.

**Store action.** Add `setTrackShowVideo(trackId, showVideo: boolean)`.

**UI.** Eye icon next to the mute button on each track row. Tooltip:
"Show video on cut" / "Audio only — no video cut". Visual state: open
eye = orange-500, closed eye = zinc-500.

**Wiring.** In `triggerTrack(trackId, when)`:

```ts
// existing audio call stays as-is
player.start(when, ...);

// guard the video call
if (track.showVideo) {
  videoEngine.trigger(trackId, when);
}
```

That's the entire change. Everything downstream — priority, cuts, export
— keeps working.

**Recommended preset.** When auto-tag (§ 3.4) assigns a `hat` tag, set
`showVideo` to `false` automatically *unless* the user has already
manually set it. This is the killer combination: hats become audio-only
by default, exactly as Lasse uses them.

---

### 3.2 User-controlled visual cut subdivision

**What.** A dropdown in the top bar controls the minimum interval between
visual cuts. Audio scheduling is unchanged (still 16ths).

**Options.**
- 16th note (no-op vs. v1 — every audio trigger can cut)
- 8th note **(default)**
- Quarter note
- Half note
- Bar (one cut per bar — very chill)

**Data model change.** Add to project state:

```ts
interface AppState {
  project: {
    // ...existing fields
    cutSubdivision: '16n' | '8n' | '4n' | '2n' | '1m';  // Tone.js notation
  };
}
```

Default: `'8n'`. Persist with v1.0 → v1.1 migration (default if missing).

**Store action.** `setCutSubdivision(value)`.

**Implementation.** This is the meatiest change in v1.1. Two viable
approaches; we're picking the second:

*Approach A (rejected): minimum interval between cuts.* The video engine
tracks `lastCutTime`; if a new trigger arrives less than
`subdivisionInterval` since `lastCutTime`, drop it. Simple but
unmusical — cuts land wherever, not on the grid.

*Approach B (chosen): quantize cuts to the subdivision grid.* The video
engine collects triggers within a "cut window" (one subdivision-length).
At the *boundary* of each window, it picks the priority winner from the
collected triggers and that's what shows. Empty windows hold the
previous frame.

Pseudocode for the video engine change:

```ts
class VideoEngine {
  private pendingTriggers: TriggerEvent[] = [];
  private cutSubdivision: NoteValue = '8n';

  trigger(trackId, when) {
    // unchanged: schedule the hidden video to seek+play at `when`
    scheduleVideoPlay(trackId, when);
    // new: queue for the next cut decision boundary
    this.pendingTriggers.push({ trackId, time: when, ... });
  }

  // New: subscribe to Transport at the cut subdivision rate
  onCutBoundary(boundaryTime) {
    const winner = pickPriority(
      this.pendingTriggers.filter(t => t.time <= boundaryTime
                                        && t.time > boundaryTime - subInterval),
      tagPriority,
      this.currentlyDisplayed
    );
    if (winner) this.currentlyDisplayed = winner;
    this.pendingTriggers = this.pendingTriggers.filter(
      t => t.time > boundaryTime
    );
  }

  drawCurrentFrame(ctx, audioTime) {
    if (this.currentlyDisplayed) drawVideo(this.currentlyDisplayed.trackId);
    else drawBlack();
  }
}
```

Hook the boundary signal off `Tone.Transport` with
`Tone.Transport.scheduleRepeat(callback, cutSubdivision)`. When the
subdivision setting changes, dispose and reschedule.

**Edge cases.**
- Subdivision changed mid-playback: dispose old `scheduleRepeat`, start
  new one at the next bar boundary to avoid mid-bar judder.
- Pause/stop: clear `pendingTriggers` and reset `currentlyDisplayed` to
  null.
- Live keyboard hits: still go through `trigger()`; quantize to the
  subdivision grid like any other event. (This is the right call — it
  means freestyle sessions also stay rhythmic. If users hate it, expose
  a "quantize live hits" toggle in v1.2.)

**UI.** A dropdown in the top bar between BPM and the Suggest button,
labeled "Cut rate" with the dropdown showing "1/16, 1/8, 1/4, 1/2, 1
bar".

---

### 3.3 Same-tier ducking with configurable hold time

**What.** Within an eligible cut window, if the priority winner has the
same tier as the currently displayed clip, *don't cut*. Hold the existing
frame.

**Why this is different from § 3.2.** Subdivision controls *when cuts
can happen*. Ducking controls *whether to actually cut* once a cut is
eligible. Vocal → vocal at 8th-note intervals: § 3.2 says "yes, cut is
eligible"; § 3.3 says "no, both are tier-5 vocals, hold the first one".

**Data model change.**

```ts
interface AppState {
  project: {
    // ...existing fields
    sameTierHoldMs: number;  // default 400
  };
}
```

Default 400ms (a quarter note at 90 BPM — feels grounded).

**Store action.** `setSameTierHoldMs(ms)` clamped [0, 2000].

**Implementation.** Modify `pickPriority` to take the currently displayed
event:

```ts
function pickPriority(
  candidates: TriggerEvent[],
  tagPriority: Record<string, number>,
  current: TriggerEvent | null,
  audioTime: number,
  sameTierHoldMs: number,
): TriggerEvent | null {
  if (candidates.length === 0) return current;
  const winner = highestPriority(candidates, tagPriority);
  if (!current) return winner;

  const winnerTier = tagPriority[winner.tag ?? 'untagged'];
  const currentTier = tagPriority[current.tag ?? 'untagged'];
  const elapsed = audioTime - current.startTime;

  if (winnerTier === currentTier && elapsed < sameTierHoldMs / 1000) {
    return current;  // duck — keep current
  }
  return winner;
}
```

A higher-tier event always wins (e.g., vocal still beats kick
immediately — that's intentional, it's the punctuation).

**UI.** A small "Hold time" slider in a settings popover (0–2000ms). Or
inline in the top bar with a compact display. Either is fine; popover
keeps the top bar cleaner.

**Tests** (add to `src/lib/videoEngine.test.ts`):
- Two same-tier triggers within hold time → second is suppressed.
- Two same-tier triggers past hold time → second wins.
- Different-tier triggers within hold time → higher tier still wins.
- Configurable hold time of 0 → always cut (regression test for v1
  behavior).

---

### 3.4 Auto-tag clips on record

**What.** When a clip finishes recording, automatically classify it as
kick / snare / hat / vocal / fx and apply the tag. The manual tag picker
becomes a *correction* UI rather than a primary input.

**Provider.** Gemini 3 Flash Preview (`gemini-3-flash-preview`) via the
`@google/genai` SDK. We send the recorded audio directly — no
feature extraction in the middle. Gemini natively handles audio input,
which makes the classification dramatically more accurate than
heuristics over hand-extracted features.

This introduces a *second* provider into the stack (Claude Haiku for
text-pattern generation in § 3.5; Gemini Flash for audio
classification here). It's a deliberate choice: each provider is used
where its strengths matter, and the two features are independent.

**API key.** Google AI Studio key, free tier. Generate at
https://aistudio.google.com/app/apikey. Add to `.env`:

```
VITE_GEMINI_API_KEY=...
```

Document in `.env.example` and the README. Note: this is *not* a Google
Cloud key — those are different and require billing setup.

**SDK install.** Add `@google/genai` to dependencies (peer-installs
nothing else of note).

**Audio preparation.** Recording produces a WebM blob with Opus audio,
plus a decoded `AudioBuffer` we already have in v1. Gemini accepts
several audio MIME types; the most universally supported is WAV
(uncompressed PCM). We convert the AudioBuffer to a WAV blob in the
browser and send inline base64. The clip is short (≤2s, mono, 48kHz),
so the WAV is ~150KB — small enough to inline without using the Files
API.

Create `src/lib/wavEncoder.ts`:

```ts
/**
 * Encode an AudioBuffer to a WAV blob (16-bit PCM).
 * Pure function, no dependencies.
 */
export function audioBufferToWav(buffer: AudioBuffer): Blob;
```

A 16-bit PCM WAV writer is ~30 lines of plain JS — write the RIFF
header, copy interleaved samples scaled to int16, return as a Blob with
`type: 'audio/wav'`. No library needed.

**Classification call.** Create `src/lib/aiAutoTag.ts`:

```ts
import { GoogleGenAI, Type } from '@google/genai';

export interface AutoTagResult {
  tag: Tag;
  confidence: number;
  reasoning?: string;
}

export async function autoTag(
  audioBuffer: AudioBuffer
): Promise<AutoTagResult | null>;
```

Implementation:

```ts
const wav = audioBufferToWav(audioBuffer);
const base64 = await blobToBase64(wav);

const client = new GoogleGenAI({
  apiKey: import.meta.env.VITE_GEMINI_API_KEY,
});

const response = await client.models.generateContent({
  model: 'gemini-3-flash-preview',
  contents: [
    {
      role: 'user',
      parts: [
        {
          inlineData: {
            mimeType: 'audio/wav',
            data: base64,
          },
        },
        {
          text:
            'Classify this short audio sample for a hip-hop step ' +
            'sequencer. Listen to the sound and pick exactly one tag:\n' +
            '- kick: low-frequency thump or boom (mouth, chest hit, ' +
            'sub bass)\n' +
            '- snare: mid-frequency crack or slap (claps, tongue ' +
            'pops, table hits with brightness)\n' +
            '- hat: high-frequency tick or hiss (ts, sh, finger ' +
            'snaps)\n' +
            '- vocal: any voiced sound, word, syllable, or extended ' +
            'tone (yeah, uh, hm, sung note)\n' +
            '- fx: anything else or ambiguous (whooshes, weird ' +
            'noises, breaths)\n\n' +
            'Return your best guess with a confidence score 0-1 ' +
            'reflecting how clearly the audio matches that category.',
        },
      ],
    },
  ],
  config: {
    responseMimeType: 'application/json',
    responseSchema: {
      type: Type.OBJECT,
      properties: {
        tag: {
          type: Type.STRING,
          enum: ['kick', 'snare', 'hat', 'vocal', 'fx'],
        },
        confidence: { type: Type.NUMBER },
        reasoning: { type: Type.STRING },
      },
      required: ['tag', 'confidence'],
    },
  },
});

const parsed = JSON.parse(response.text);
// validate, return AutoTagResult or null
```

**Behavior.**
- After recording finishes (post auto-trim, before user reviews):
  1. Call `autoTag(clip.audioBuffer)`. Don't block the recording flow —
     run in the background; UI shows a small "tagging..." spinner on
     the track.
  2. If `confidence >= 0.6`: apply tag via `setTrackTag`, show small
     toast "Tagged as {tag}".
  3. If `confidence < 0.6`: leave untagged, show subtle prompt
     "Couldn't auto-tag — pick one below".
- The 5-chip picker stays visible for correction. Clicking a chip
  overrides the auto-tag.

**Hat → audio-only auto-default.** When auto-tag returns `hat` with
confidence ≥ 0.6, also set the track's `showVideo` to `false` (only
if the user hasn't already manually set it for this track in this
session). This is the killer combination noted in § 3.1.

**Cost / quota note.** Gemini's free tier in AI Studio is generous.
Each call is roughly: 1–2 seconds of audio (~32–64 audio tokens) + a
short prompt + a short JSON response. Pennies per thousand calls in
paid tier; well within the free tier for any realistic dev usage.

**Failure modes.**
- Network error: silent fallback, leave untagged. (Don't block the
  recording flow on the API.)
- Schema mismatch / parse error: silent fallback.
- Missing API key: silent fallback. (We already gate the Suggest
  button on key presence; auto-tag should fail open, not loud.)

**Tests** (`src/lib/aiAutoTag.test.ts` + `wavEncoder.test.ts`):
- WAV encoder: encode a known AudioBuffer, decode the resulting blob's
  bytes, assert RIFF header, sample rate, sample count match.
- Mock the Gemini SDK with a fake `generateContent` returning a known
  JSON; assert correct shape returned.
- Mock the SDK throwing → returns null, doesn't throw.
- Mock the SDK returning malformed JSON → returns null.
- Missing API key → returns null without making a network call.

---

### 3.5 Pattern variations

**What.** Four new buttons next to "Suggest a beat":
- **Make it busier** — adds hits to the existing pattern.
- **Add a fill** — adds a fill in steps 13–16 (the last beat of the bar).
- **Half-time** — halves the perceived tempo by stretching the kick/snare
  pattern.
- **Strip it back** — removes hits, focus on downbeats.

Each takes the *current* pattern as input and returns a modified one.
Same undo flow as v1's Suggest.

**Implementation.** Extend `src/lib/aiSuggest.ts`:

```ts
export type Variation = 'busier' | 'fill' | 'halftime' | 'strip';

export async function varyPattern(
  input: SuggestPatternInput & {
    currentPattern: boolean[][];   // 8x16
    variation: Variation;
  }
): Promise<boolean[][]>;
```

Same tool-use schema as `suggestPattern`. Different system prompts per
variation. Example for `busier`:

```
You are a hip-hop beat producer. Take the given 8x16 step pattern and
make it busier by adding hits — particularly on hat and ghost-snare.
Preserve the kick and main snare positions. Return the modified 8x16
pattern.
```

**UI.** A button group next to "Suggest a beat":

```
[Suggest a beat] [Busier] [Fill] [Half-time] [Strip] [Genre: boom-bap ▼]
```

Lucide icons: `Sparkles`, `Plus`, `Zap` (fill), `MoveHorizontal` (halftime),
`Minus` (strip).

Each button triggers the same flow as Suggest: snapshot → call → apply →
toast with Undo. Disabled when fewer than 4 tracks have clips OR when no
pattern is set yet (variations need something to vary). Disabled while a
call is in flight (any variation button locks all of them).

**Tests** (`src/lib/aiSuggest.test.ts`):
- Each variation generates a valid 8×16 grid.
- API failures handled per existing patterns.
- UI: clicking a variation shows toast with Undo, Undo restores prior
  pattern.

---

### 3.6 README recording guide

This is the highest-leverage change of all and it's free. Add a new
section to `README.md` (after the install/run instructions, before the
v2 roadmap):

```markdown
## Recording for best results

Hyperpad cuts between your clips on every musical hit. If all 8 of
your clips are shot from exactly the same distance with the same
framing and the same background, those cuts read as a strobe instead of
a performance. The fix is in your hands, not the app's.

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
```

---

## 4. Implementation notes

### 4.1 Order of operations

Build in this sequence — each step is testable independently and the
later ones depend on the earlier ones:

1. § 3.1 (showVideo toggle) — smallest change, biggest immediate impact.
2. § 3.2 (cut subdivision) — meatiest, but contained to the video engine.
3. § 3.3 (same-tier ducking) — small change to the priority resolver.
4. § 3.4 (auto-tag) — independent feature; AI infrastructure already
   exists in v1.
5. § 3.5 (pattern variations) — additive UI on existing API code.
6. § 3.6 (README) — free.

### 4.2 Persistence migration

Three new fields enter the persisted schema:

```ts
interface PersistedTrack {
  // ...
  showVideo: boolean;           // default true if missing
}
interface PersistedProject {
  // ...
  cutSubdivision: NoteValue;    // default '8n' if missing
  sameTierHoldMs: number;       // default 400 if missing
  version: 2;                    // bump from 1 to 2
}
```

In `loadProject()`, if `version === 1` (or missing), migrate by filling
defaults and writing back as `version: 2`. Don't break old saves.

### 4.3 New library

One new dependency: `@google/genai` for the Gemini SDK (used in § 3.4
auto-tag).

```bash
npm install @google/genai
```

Everything else in v1.1 uses libraries already in the v1 tree:
- `tone` — Transport.scheduleRepeat for cut boundaries
- `@anthropic-ai/sdk` — pattern generation and variations (§ 3.5)
- React, Zustand, Tailwind, lucide-react — UI

New code modules not present in v1:
- `src/lib/wavEncoder.ts` — pure JS, no dependencies. Encodes an
  AudioBuffer as a 16-bit PCM WAV blob for sending to Gemini.
- `src/lib/aiAutoTag.ts` — wraps the Gemini call.

### 4.4 What to test, what to verify manually

| Concern | Test type |
|---|---|
| `pickPriority` with ducking | Unit (pure function) |
| `wavEncoder` round-trip | Unit (synthesized buffers, byte-level assertions) |
| `autoTag` request/response | Unit (mocked SDK) |
| `varyPattern` request shape | Unit (mocked SDK) |
| Persistence migration v1 → v2 | Unit (load fixture, assert shape) |
| Show-video toggle gates video events | Unit (videoEngine.trigger spy) |
| Cut subdivision quantizes correctly | Manual + integration |
| Recording flow with auto-tag | Manual end-to-end |

The cut subdivision is the one to verify most carefully *manually*. Set a
pattern at 90 BPM with hits on every 16th, set subdivision to 1/4, hit
play — the visual should cut cleanly on each downbeat, not in between.
If it judders, the boundary subscription isn't aligned to the Transport
clock.

---

## 5. Build plan — prompts for the code-gen LLM

Same conventions as `build-plan.md` Part 4: each prompt is self-contained,
TDD where possible, integrates into the running app at the end. Feed in
order.

### Step v1.1-1 — Add `showVideo` to Track + persistence migration

```text
Modify the Hyperpad codebase to add a `showVideo` field to the Track
type.

1. In `src/types.ts`, add `showVideo: boolean` to the Track interface.
2. In `src/store/initialState.ts`, set `showVideo: true` on every track
   created by `createInitialState()`. Update its tests to assert this.
3. In `src/store/useAppStore.ts`, add a new action:
   `setTrackShowVideo(trackId: number, showVideo: boolean): void`. Add
   tests covering: setting on track 3 only mutates track 3; can toggle
   true → false → true.
4. In `src/lib/persistence.ts`:
   - Add `showVideo: boolean` to `PersistedTrack`.
   - Bump `PersistedProject.version` to 2.
   - In `loadProject()`, if a loaded project has `version: 1` or no
     `version`, migrate by setting every track's `showVideo: true` and
     writing back as v2. Add a unit test that loads a v1 fixture (you
     can construct one inline) and verifies the migration.
   - In `saveProject()`, always save `version: 2`.

All tests pass. No UI yet.
```

---

### Step v1.1-2 — Wire `showVideo` into `triggerTrack`

```text
In `src/lib/audio.ts`, modify the unified `triggerTrack(trackId, when)`
function so that the call to `videoEngine.trigger(...)` is gated by the
track's `showVideo` flag. The audio call (Tone.Player.start) is
unconditional.

Update the test in `src/lib/audio.test.ts`:
- With `showVideo: true`, both audio and video are triggered.
- With `showVideo: false`, audio fires but `videoEngine.trigger` is NOT
  called.

Manual verification not possible yet (no UI). Tests must pass.
```

---

### Step v1.1-3 — Eye/EyeOff toggle UI on track row

```text
In `src/components/TrackRow.tsx`, add an eye-toggle button to each
track row, positioned next to the existing mute button.

- Use `Eye` (lucide-react) when `track.showVideo === true`,
  styled `text-orange-500`.
- Use `EyeOff` when `false`, styled `text-zinc-500`.
- Click toggles via `actions.setTrackShowVideo(trackId, !track.showVideo)`.
- Tooltip: "Show video on cut" (when on) / "Audio only — no video cut"
  (when off).
- Aria-label matching the tooltip.

Tests in `TrackRow.test.tsx`:
- Renders the eye icon when showVideo true.
- Renders the eye-off icon when false.
- Clicking the icon toggles store state.

Manual verification: toggle a track to audio-only, sequence a pattern,
hit play. That track's clip plays audio but does NOT cause the viewport
to cut to its video.
```

---

### Step v1.1-4 — Cut subdivision: state + Transport wiring

```text
In `src/types.ts`, add to `AppState.project`:
  `cutSubdivision: '16n' | '8n' | '4n' | '2n' | '1m';`

In `src/store/initialState.ts`, default to `'8n'`. Update tests.

In `src/store/useAppStore.ts`, add action:
  `setCutSubdivision(value: CutSubdivision): void`
with tests.

In `src/lib/persistence.ts`:
- Add to `PersistedProject` schema.
- Migration: if missing on v1 load, default to `'8n'`. Bump version
  handled in v1.1-1.

In `src/lib/audio.ts`, do NOT yet change the Transport callback. Just
expose a function `setVideoCutSubdivision(value: CutSubdivision): void`
that will be wired in the next step.

Tests pass. No UI yet.
```

---

### Step v1.1-5 — Cut subdivision: video engine quantization

```text
This is the biggest change in v1.1. Modify `src/lib/videoEngine.ts` to
quantize visual cuts to a configurable subdivision.

CURRENT BEHAVIOR (v1): every `trigger()` call may immediately become the
displayed video on the next render frame, via the priority resolver.

NEW BEHAVIOR (v1.1):
- `trigger(trackId, when)` still schedules the hidden video to seek+play
  at `when` (audio-side).
- It also pushes an event to a `pendingTriggers` array (with the track's
  current tag — read from store).
- A separate "cut boundary" subscription is registered against
  `Tone.Transport.scheduleRepeat(callback, cutSubdivision)`.
- At each boundary callback (with `boundaryTime` argument):
  - Find pendingTriggers within the previous subdivision window.
  - Apply `pickPriority` (modified in step v1.1-7 for ducking).
  - If a winner exists, set it as `currentlyDisplayed`.
  - Drain consumed triggers from `pendingTriggers`.
- `drawCurrentFrame` uses `currentlyDisplayed.trackId` (or fills black).

API additions:
- `setCutSubdivision(value: CutSubdivision)`: dispose the existing
  `scheduleRepeat`, register a new one. Subscribe to store changes so
  the engine reacts when the user changes the setting.
- On stop: clear pendingTriggers, reset currentlyDisplayed to null.

Tests in `src/lib/videoEngine.test.ts`:
- Extract the quantization logic to a pure function:
  `quantizeToBoundary(triggers, boundaryTime, windowMs, priorityFn)
  → winner | null`
- Test: 4 triggers landing in one window → priority winner returned.
- Test: empty window → null returned.
- Test: trigger past the window → ignored.

Manual verification: set subdivision to '4n' (quarter), record clips,
sequence a busy pattern, hit play. Visual should cut on each beat (4
times per bar) regardless of how many audio hits fire between beats.
```

---

### Step v1.1-6 — Cut subdivision: dropdown UI

```text
Create `src/components/CutSubdivisionSelect.tsx`:
- A small dropdown labeled "Cut rate".
- Options: "1/16", "1/8", "1/4", "1/2", "1 bar" mapping to '16n', '8n',
  '4n', '2n', '1m'.
- Reads `project.cutSubdivision` from the store.
- onChange dispatches `actions.setCutSubdivision(value)`.

Mount it in the top bar between the BPM input and the Suggest button.

Tests:
- Renders with current store value.
- Changing value updates store.

Manual verification: change cut rate during playback. The subdivision
change should take effect cleanly at the next bar boundary (or
immediately if the audio engine handles it that way).
```

---

### Step v1.1-7 — Same-tier ducking in pickPriority

```text
Modify `pickPriority` in `src/lib/videoEngine.ts` (or wherever the
priority resolver lives — extract to its own pure module if not already).

New signature:
```ts
function pickPriority(
  candidates: TriggerEvent[],
  tagPriority: Record<string, number>,
  current: TriggerEvent | null,
  audioTime: number,
  sameTierHoldMs: number
): TriggerEvent | null
```

Behavior:
- If candidates is empty, return current (hold).
- Compute the highest-priority candidate.
- If current is null, return the candidate.
- If candidate's tier === current's tier AND
  (audioTime - current.startTime) * 1000 < sameTierHoldMs, return current.
- Otherwise return the candidate.

Higher-tier candidates always win regardless of hold time.

Add to `AppState.project`: `sameTierHoldMs: number` (default 400).
Add action `setSameTierHoldMs(ms)` clamped [0, 2000]. Update persistence.

Wire `sameTierHoldMs` into the boundary callback path so it's available
when pickPriority is called.

Tests in `src/lib/pickPriority.test.ts`:
- Two same-tier triggers within hold time → current is held.
- Two same-tier triggers past hold time → new candidate wins.
- Different-tier candidate within hold time → still wins.
- Hold time of 0 → always uses new candidate (regression for v1).
- Empty candidates → returns current.

Manual verification: record 3 vocal clips, set them all to fire on
sequential 16th notes, set hold time to 400ms, hit play. The viewport
should hold on the first vocal until the 400ms hold elapses.
```

---

### Step v1.1-8 — Hold time slider UI

```text
Create `src/components/HoldTimeControl.tsx`:
- A small slider (0–2000ms, step 50ms) labeled "Hold".
- Reads `project.sameTierHoldMs`, dispatches `setSameTierHoldMs`.
- Display the current value next to the slider (e.g., "400ms").

Mount in the top bar after the cut subdivision dropdown. (Optional:
hide behind a settings popover if the top bar is getting crowded — your
call based on layout.)

Tests:
- Renders with current value.
- Changing slider updates store.

Manual verification: adjust hold time during playback. Quick changes
between values should immediately affect cut behavior on next trigger.
```

---

### Step v1.1-9 — WAV encoder + Gemini SDK setup

```text
Install the Gemini SDK and add the API key to the environment.

1. `npm install @google/genai`
2. Update `.env.example` to include:
   ```
   VITE_GEMINI_API_KEY=
   ```
   And document in README: get a key from
   https://aistudio.google.com/app/apikey (free tier, no billing
   required). This is NOT a Google Cloud key.
3. In `src/main.tsx` (or wherever the existing Anthropic key warning
   lives), add an analogous warning for the Gemini key in production
   builds:
   ```ts
   if (import.meta.env.PROD && import.meta.env.VITE_GEMINI_API_KEY) {
     console.warn('🚨 Gemini API key in production bundle. Migrate to a proxy.');
   }
   ```

Then create `src/lib/wavEncoder.ts`:

```ts
/**
 * Encode an AudioBuffer to a 16-bit PCM WAV blob.
 * Pure function, no dependencies.
 */
export function audioBufferToWav(buffer: AudioBuffer): Blob;
```

Implementation:
- Build the RIFF/WAVE header (44 bytes): "RIFF", file size, "WAVE",
  "fmt ", subchunk size 16, format 1 (PCM), numChannels, sampleRate,
  byteRate, blockAlign, bitsPerSample 16, "data", data size.
- Iterate channel samples, interleave if stereo, scale floats from
  [-1, 1] to int16 range, write little-endian.
- Return a Blob with `type: 'audio/wav'`.
- For our use case, force mono: average channels if input is stereo.

Tests in `src/lib/wavEncoder.test.ts`:
- Encode a known 1s 440Hz sine AudioBuffer (mono, 48kHz) → assert blob
  size = 44 + 48000 * 2 = 96044 bytes (header + 16-bit samples).
- Decode the resulting blob's bytes (use a DataView):
  - assert "RIFF" magic at offset 0
  - assert sample rate field equals 48000
  - assert bits per sample field equals 16
  - assert "data" chunk magic at expected offset
- Encode a stereo buffer → assert output is mono (one channel
  averaged).
- Encode an empty buffer → assert valid WAV with 0 data bytes.

No UI integration yet.
```

---

### Step v1.1-10 — Gemini auto-tag API call

```text
Create `src/lib/aiAutoTag.ts`:

```ts
export interface AutoTagResult {
  tag: Tag;  // 'kick' | 'snare' | 'hat' | 'vocal' | 'fx'
  confidence: number;
  reasoning?: string;
}

export async function autoTag(
  audioBuffer: AudioBuffer
): Promise<AutoTagResult | null>;
```

Implementation:
- If `import.meta.env.VITE_GEMINI_API_KEY` is missing, return null
  immediately (silent failure).
- Convert the AudioBuffer to a WAV Blob via `audioBufferToWav`.
- Convert the Blob to base64 (helper: read with FileReader as data URL,
  strip the prefix).
- Call `client.models.generateContent` with model
  `gemini-3-flash-preview`, an `inlineData` part with mimeType
  `audio/wav` and the base64 data, and a text part with the
  classification prompt (see spec § 3.4 for the full prompt).
- Use `responseMimeType: 'application/json'` and `responseSchema` with
  the tag enum, confidence number, and optional reasoning string.
- Parse `response.text` as JSON. Validate:
  - tag is one of the 5 enum values
  - confidence is a number in [0, 1]
- Return AutoTagResult on success; return null on any error, parse
  failure, or schema mismatch.
- Wrap the entire call in try/catch — never throw.

Tests in `src/lib/aiAutoTag.test.ts`:
- Mock `@google/genai` GoogleGenAI class. Verify the request shape:
  - model is `gemini-3-flash-preview`
  - has an inlineData part with audio/wav mimeType
  - has a text part with the classification prompt
  - has responseSchema with the right enum values
- Mock returning valid JSON `{tag: 'kick', confidence: 0.85}` → returns
  expected AutoTagResult.
- Mock returning invalid tag value → returns null.
- Mock returning malformed JSON → returns null.
- Mock SDK throwing → returns null, doesn't throw.
- Missing API key → returns null without making a network call (assert
  the SDK constructor is NOT called).

No UI integration yet.
```

---

### Step v1.1-11 — Wire auto-tag into recording flow

```text
In the recording flow (the component that handles
`recordClip` → `setTrackClip`), add an auto-tag step after the clip is
saved to the track.

Sequence:
1. Recording finishes, blob + audioBuffer + trim available.
2. Build a Clip object and dispatch `setTrackClip(trackId, clip)` as
   before.
3. Show a small "tagging..." spinner on the track row.
4. Fire-and-forget: call `autoTag(clip.audioBuffer)`. Don't block the
   recording flow on the API.
5. When the promise resolves:
   - If result has confidence >= 0.6: call
     `setTrackTag(trackId, result.tag)`. Show toast "Tagged as {tag}".
   - If result is null or confidence < 0.6: leave untagged, show toast
     "Couldn't auto-tag — pick one below".
6. Hide the spinner regardless.
7. The 5-chip picker remains visible. Manual selection overrides
   auto-tag.

Special case: if auto-tag returns 'hat' with confidence >= 0.6 AND the
track's `showVideo` has not been manually set this session, also
dispatch `setTrackShowVideo(trackId, false)`. Show a brief toast
"Hi-hat detected — set to audio-only".

Track which tracks have had `showVideo` manually toggled in a transient
Set kept in the store (NOT persisted; reset on "new project" and on
page load). Add to the store: `manuallyToggledShowVideo: Set<number>`,
and have `setTrackShowVideo` add the trackId to this set when called
from the UI (but NOT when called from the auto-tag flow). Pass a
`source: 'user' | 'system'` parameter or expose two separate actions
to disambiguate.

Tests:
- Mock autoTag to return `{tag: 'kick', confidence: 0.85}` → store has
  tag set after recording.
- Mock autoTag to return `{tag: 'fx', confidence: 0.4}` → tag remains
  null.
- Mock autoTag to return `{tag: 'hat', confidence: 0.9}` → showVideo
  becomes false.
- Mock autoTag to return `{tag: 'hat', confidence: 0.9}` AFTER user
  has manually toggled showVideo on → showVideo stays as user set it.
- Mock autoTag returning null → recording flow completes; track stays
  untagged; no crash.

Manual verification: record several distinct sounds (a "boom" → kick,
a "ts ts" → hat, a "yeah" → vocal). Verify tags are mostly correct.
Verify the hat clip auto-disables its video. Misses are fine — the
picker handles corrections.
```

---

### Step v1.1-12 — Pattern variation API

```text
In `src/lib/aiSuggest.ts`, add:

```ts
export type Variation = 'busier' | 'fill' | 'halftime' | 'strip';

export async function varyPattern(input: {
  bpm: number;
  subgenre: 'boom-bap' | 'trap';
  tracks: Array<{ id: number; tag: Tag | null }>;
  currentPattern: boolean[][];
  variation: Variation;
}): Promise<boolean[][]>;
```

Implementation: similar to `suggestPattern` but with:
- A variation-specific system prompt (see spec § 3.5 for the busier
  example; write analogous prompts for fill, halftime, strip).
- The user message includes the current pattern as JSON.
- Tool use schema is unchanged (returns 8x16 grid).
- Same validation as suggestPattern.

Tests in `src/lib/aiSuggest.test.ts`:
- Each variation type produces a valid 8x16 grid (mock SDK).
- Validation failures return rejected promise.
- Each variation uses a different system prompt (assert via mock spy).
```

---

### Step v1.1-13 — Pattern variation buttons

```text
In `src/components/SuggestButton.tsx` (or split into a new
`PatternControls.tsx` if it's getting long), add four new buttons next
to the existing Suggest button:

- "Busier" (icon: Plus)
- "Fill" (icon: Zap)
- "Half-time" (icon: MoveHorizontal)
- "Strip" (icon: Minus)

Each button:
- Disabled if any of: <4 clips, no current pattern (all steps false), or
  any other variation/suggest call is in flight.
- On click: snapshot pattern, set loading state, call
  `varyPattern({ ..., variation: <type> })`, on success
  `actions.applyPattern(result)`, show toast "{Variation} applied. Undo?"
  with Undo restoring the snapshot.
- On error: toast with error message.

Tests:
- Each button calls varyPattern with the correct variation arg.
- Buttons are disabled when conditions aren't met.
- Undo restores prior pattern.

Manual verification: load a project, click each variation button in
turn. Each should produce a distinctly different feel. Undo works for
each.
```

---

### Step v1.1-14 — README recording guide

```text
Update `README.md` to add a "Recording for best results" section after
the install/run instructions and before the v2 roadmap. Use the content
from spec § 3.6 verbatim (or adapt lightly for tone).

No code changes. No tests.
```

---

### Step v1.1-15 — Final smoke test

```text
Run the full v1.1 smoke test (manual, can use Playwright if it was
added in v1):

1. Open the app fresh (clear IndexedDB if needed).
2. Record 5 clips: a "boom", "tss", "ts ts", "yeah", "uh".
   - Verify auto-tag assigns plausible tags.
   - Verify the "tss" or "ts ts" gets auto-set to audio-only (if hat).
3. Toggle one track to audio-only manually.
4. Click "Suggest a beat" → pattern fills.
5. Click "Half-time" → pattern noticeably slows.
6. Click "Undo" in the toast → pattern restores.
7. Set cut rate to 1/4. Hit play. Visual cuts on beats only.
8. Set hold time to 600ms. Trigger same-tag clips manually with
   keyboard 1–8 — held frames should be visible.
9. Hit Export → render → download.
10. Open the WebM, verify visual feels less hyper than v1.
11. Refresh the page — everything restores including showVideo,
    cutSubdivision, holdMs.

Document any issues. Ship if clean.
```

---

## 6. After v1.1

If the recording guide + visual cut controls + auto-tag don't get the
feel where you want it, the next levers (in order of impact) are:

1. **Free-text tags with LLM-assigned priority** — handles unusual
   sounds (table thump, ride bell). Was deferred from v1.1.
2. **Arrangement / song mode** — chain multiple patterns. The path to
   actual songs.
3. **Deterministic micro-zoom variation per clip** — fakes framing
   variation in code. Cheap but feels gimmicky.
4. **WebCodecs MP4 export** — already in spec.md § 10. The export size
   and format issues become real once the app gets shared.

Don't bundle these into v1.1. Ship v1.1, demo it, then pick the next
target based on what people actually say.
