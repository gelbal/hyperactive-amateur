# Architecture

Current code read from main at `dff68e2`. Runtime stack is React 18, Vite 8, Tone.js 15, Zustand 5, Tailwind 3.4, and TypeScript 5.6 (`package.json:21`, `package.json:24`, `package.json:25`, `package.json:40`, `package.json:41`, `package.json:42`). Required local validation commands are `npm test`, `npm run build`, `npm run smoke:browser`, and `npm audit --audit-level=moderate`; the first three are wired in `package.json:11`, `package.json:13`, and `package.json:14`.

## One-screen system overview

The app is one browser process with a single Zustand store, one Tone Transport, one canvas-backed hard-cut viewport, and browser media APIs around it.

```text
tap / key / button
    |
    v
canStartAudibleAction()
src/lib/audibleActionGate.ts:5
    |
    +--> playback: Tone.start() -> Tone.Transport 16n loop
    |        src/lib/audio.ts:28
    |        src/lib/audio.ts:48
    |        |
    |        +--> Tone.Player or fallback synth
    |        |    src/lib/audio.ts:98
    |        |    src/lib/audio.ts:112
    |        |
    |        +--> videoEngine.trigger(trackId, Tone time)
    |             src/lib/audio.ts:107
    |             src/lib/videoEngine.ts:144
    |             |
    |             v
    |        hidden <video> elements -> 480x480 canvas
    |        src/lib/videoEngine.ts:72
    |        src/components/Viewport.tsx:93
    |
    +--> recording: getUserMedia -> MediaRecorder video blob
    |        + Web Audio mic tap -> AudioBuffer -> WAV sidecar
    |        src/lib/recordingFlow.ts:136
    |        src/lib/recorder.ts:33
    |        src/lib/audioCapture.ts:49
    |        src/lib/recordingFlow.ts:154
    |
    +--> export: canvas.captureStream(30)
    |        + Tone destination tap -> MediaRecorder -> download
    |        src/lib/export.ts:22
    |        src/lib/export.ts:23
    |        src/lib/export.ts:122
    |
    +--> AI: browser fetches token, posts to /api/gemini
             server validates narrow Gemini contract and forwards with server key
             src/lib/aiHttpClient.ts:74
             src/lib/aiHttpClient.ts:103
             api/gemini.ts:607
```

Rule: audible and visible timing comes from the Web Audio clock. Tone Transport schedules every sequencer step (`src/lib/audio.ts:48`), the playhead UI is scheduled through `Tone.getDraw()` (`src/lib/audio.ts:55`), video trigger times are audio-context seconds (`src/lib/videoEngine.ts:24`), and the viewport draw loop passes `Tone.now()` into `drawCurrentFrame()` (`src/components/Viewport.tsx:70`).

The canvas backing store is the export contract. `Viewport` renders the canvas with `width={480}` and `height={480}` (`src/components/Viewport.tsx:93`, `src/components/Viewport.tsx:95`, `src/components/Viewport.tsx:96`), and export captures that same node with `canvas.captureStream(30)` (`src/lib/export.ts:22`).

External platform docs checked for browser behavior:

- Canvas capture: MDN documents `HTMLCanvasElement.captureStream()` returning a `MediaStream` from canvas contents: <https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/captureStream>.
- MediaRecorder MIME probing and containers: MDN documents `MediaRecorder.isTypeSupported()` and MediaRecorder MIME options; WebKit documents Safari MediaRecorder MP4/H.264/AAC support: <https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder/isTypeSupported_static>, <https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder>, <https://webkit.org/blog/11353/mediarecorder-api/>.
- Stream lifecycle: MDN documents `MediaStreamTrack` `ended` for permission revocation and hardware removal, and notes `stop()` does not fire `ended`: <https://developer.mozilla.org/en-US/docs/Web/API/MediaStreamTrack/ended_event>.
- Web Audio unlock: MDN documents contexts created outside user gestures starting suspended and needing resume after interaction: <https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API/Best_practices>.
- PWA install/storage/SW: MDN documents Chromium-only `beforeinstallprompt`, `StorageManager.persist()`, and service-worker `FetchEvent.respondWith()`: <https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/How_to/Trigger_install_prompt>, <https://developer.mozilla.org/en-US/docs/Web/API/StorageManager/persisted>, <https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerGlobalScope/fetch_event>.
- I did not find an official source for the project-specific claims that Safari/iPad WebKit may fail to decode MediaRecorder mixed containers through Web Audio or fail to paint first-frame blob thumbnails before playback. Those claims are grounded in code comments and app design (`src/types.ts:13`, `src/types.ts:19`, `src/lib/posterFrame.ts:13`), not independently verified web docs.

## State store and persistence

### Overview

The app uses one Zustand store created by `useAppStore`, with mutating operations nested under `actions` (`src/store/useAppStore.ts:107`, `src/store/useAppStore.ts:109`). Only `project` is stored in IndexedDB through manual snapshot/save/load helpers (`src/lib/persistence.ts:47`, `src/lib/persistence.ts:76`, `src/lib/persistence.ts:80`). Boot rehydrate validates and rebuilds derived clip fields before `hydrateProject()` writes into the store (`src/lib/rehydrate.ts:327`, `src/lib/rehydrate.ts:410`, `src/store/useAppStore.ts:466`).

### File inventory

| Path | Purpose |
| --- | --- |
| `src/store/useAppStore.ts` | Zustand store, project mutation guards, transient session state, media preferences, scratch/reset, and AI revision checks (`src/store/useAppStore.ts:49`, `src/store/useAppStore.ts:107`, `src/store/useAppStore.ts:504`). |
| `src/store/initialState.ts` | Fresh app state: 8 tracks, 16 steps, 90 BPM, default cut/hold/vibe/media/session values (`src/store/initialState.ts:5`, `src/store/initialState.ts:36`). |
| `src/types.ts` | Domain types and persistence boundary comments for clips, project, playback, media, and session slices (`src/types.ts:7`, `src/types.ts:65`, `src/types.ts:132`). |
| `src/lib/persistence.ts` | IndexedDB keys, schema version, snapshot shape, live save/load, recovery backup, clear (`src/lib/persistence.ts:6`, `src/lib/persistence.ts:47`, `src/lib/persistence.ts:99`). |
| `src/lib/autoSave.ts` | Store subscriber that debounces project saves and defers while recording is active (`src/lib/autoSave.ts:7`, `src/lib/autoSave.ts:41`, `src/lib/autoSave.ts:46`). |
| `src/lib/rehydrate.ts` | Load, normalize, migrate, backup, decode clips, recreate URLs, emit warnings (`src/lib/rehydrate.ts:245`, `src/lib/rehydrate.ts:304`, `src/lib/rehydrate.ts:421`). |
| `src/components/RecoveryBanner.tsx` | User-visible degraded-load warnings, with dismissal through store UI state (`src/components/RecoveryBanner.test.tsx:13`). |
| `src/lib/logger.ts` | 200-entry in-memory log ring mirrored to console with `[HA]` prefixes (`src/lib/logger.ts:4`, `src/lib/logger.ts:49`, `src/lib/logger.ts:91`). |

### Data flow

1. Store actions that affect saved output replace `state.project`; examples include `toggleStep`, `setBpm`, `setTrackClip`, `hydrateProject`, and pattern applies (`src/store/useAppStore.ts:110`, `src/store/useAppStore.ts:129`, `src/store/useAppStore.ts:267`, `src/store/useAppStore.ts:466`, `src/store/useAppStore.ts:482`).
2. `startAutoSave()` subscribes to store updates and only schedules a save when `state.project !== prev.project` (`src/lib/autoSave.ts:54`, `src/lib/autoSave.ts:56`, `src/lib/autoSave.ts:57`).
3. Autosave waits 500 ms, skips writes while `recording.state !== "idle"`, sets `dirtyWhileRecording`, and flushes once recording returns idle (`src/lib/autoSave.ts:7`, `src/lib/autoSave.ts:41`, `src/lib/autoSave.ts:46`, `src/lib/autoSave.ts:58`).
4. `snapshot()` writes only persisted shapes: blobs, trim times, tags, steps, mix/display fields, step count, AI reasoning, and `updatedAt`; object URLs and `AudioBuffer` are derived (`src/lib/persistence.ts:47`, `src/lib/persistence.ts:58`, `src/types.ts:9`, `src/types.ts:11`).
5. `rehydrateFromStorage()` returns a structured miss for empty storage, pauses autosave on load errors, normalizes legacy/malformed data, and writes a recovery backup before degraded hydration (`src/lib/rehydrate.ts:327`, `src/lib/rehydrate.ts:338`, `src/lib/rehydrate.ts:342`, `src/lib/rehydrate.ts:345`).
6. Clip rebuild prefers the WAV sidecar, falls back to video blob decode, regenerates missing posters best-effort, and recreates object URLs (`src/lib/rehydrate.ts:293`, `src/lib/rehydrate.ts:357`, `src/lib/rehydrate.ts:361`, `src/lib/rehydrate.ts:370`, `src/lib/rehydrate.ts:377`).

### Invariants

1. **Project edits must be immutable.** Autosave observes only project reference changes, so in-place mutation can update React but never persist (`src/lib/autoSave.ts:57`).
2. **Persisted shape changes need persistence and rehydrate changes together.** Add fields to `PersistedProject`/`PersistedTrack`, `snapshot()`, normalization, and final project assembly (`src/lib/persistence.ts:10`, `src/lib/persistence.ts:30`, `src/lib/persistence.ts:47`, `src/lib/rehydrate.ts:410`).
3. **Derived clip fields are never persisted.** `Clip.url`, `Clip.audioBuffer`, and `Clip.posterUrl` are recreated, while blobs and trim metadata persist (`src/types.ts:9`, `src/types.ts:11`, `src/types.ts:25`, `src/lib/persistence.ts:60`).
4. **Step rows must match `project.stepCount`.** Extend/remove operate on every track, rehydrate resizes rows, and pattern apply rejects bad lengths (`src/store/useAppStore.ts:190`, `src/store/useAppStore.ts:215`, `src/lib/rehydrate.ts:105`, `src/store/useAppStore.ts:516`).
5. **Step count stays a multiple of 4 from 4 to 64.** Constants define bounds and increment, store edits use them, and rehydrate aligns saved values (`src/store/initialState.ts:7`, `src/store/initialState.ts:8`, `src/store/initialState.ts:9`, `src/lib/rehydrate.ts:89`).
6. **Export freezes project-output mutations.** Store actions return unchanged state while `playback.isExporting` for steps, tempo, clip/tag/showVideo, hydrate, pattern applies, scratch, and reset (`src/store/useAppStore.ts:112`, `src/store/useAppStore.ts:224`, `src/store/useAppStore.ts:267`, `src/store/useAppStore.ts:466`, `src/store/useAppStore.ts:504`, `src/store/useAppStore.ts:534`).
7. **AI pattern staleness depends on `session.projectRevision`.** Pattern callers capture a revision and `applyPatternIfCurrent()` rejects if revision or step count changed (`src/store/useAppStore.ts:49`, `src/store/useAppStore.ts:504`, `src/store/useAppStore.ts:509`).
8. **Recovery backup comes before degraded hydrate.** If backup fails, the app does not hydrate and autosave stays paused through `App` (`src/lib/rehydrate.ts:304`, `src/lib/rehydrate.ts:345`, `src/App.tsx:40`, `src/App.tsx:53`).

### Platform-specific paths

- Blob detection duck-types blob-like records because IndexedDB/test environments may not preserve prototypes (`src/lib/rehydrate.ts:41`).
- `blobToArrayBuffer()` falls back through `Response` before `decodeAudioData()` and decodes a copied buffer (`src/lib/rehydrate.ts:281`, `src/lib/rehydrate.ts:288`).
- Device IDs are local machine preferences in `localStorage`, not project data, and reads/writes are wrapped for unavailable/private storage (`src/store/initialState.ts:14`, `src/store/useAppStore.ts:25`, `src/types.ts:123`).
- Poster blobs exist because the app cannot depend on blob-backed video thumbnails before playback on iPad/WebKit; the official-doc part was not independently verified (`src/types.ts:19`, `src/lib/posterFrame.ts:13`).

### Test coverage notes

- Store export freeze, step grow/shrink, scratch URL revocation, manual tag/showVideo markers, hydrate dismissal, recovery warnings, and stale AI pattern rejection are covered in `src/store/useAppStore.test.ts:9`.
- Persistence and backup deletion are covered in `src/lib/persistence.test.ts:20`, `src/lib/persistence.test.ts:43`, and `src/lib/persistence.test.ts:55`.
- Autosave debounce and recording deferral are covered in `src/lib/autoSave.test.ts:22`, `src/lib/autoSave.test.ts:33`, and `src/lib/autoSave.test.ts:43`.
- Rehydrate migration, sidecar decode, backup-failure abort, and decode-failure clip drop are covered in `src/lib/rehydrate.test.ts:91`, `src/lib/rehydrate.test.ts:118`, `src/lib/rehydrate.test.ts:215`, and `src/lib/rehydrate.test.ts:245`.
- Weak spots: no full `App` integration test for autosave pause after degraded load, no multi-tab write test, and no real browser legacy video-container decode test.

## Audio engine

### Overview

Tone.js owns the shared Web Audio context and Transport. `initTransport()` sets BPM, creates fallback synths, syncs players, schedules one 16th-note loop, and subscribes to BPM/swing/track changes (`src/lib/audio.ts:34`, `src/lib/audio.ts:38`, `src/lib/audio.ts:41`, `src/lib/audio.ts:48`, `src/lib/audio.ts:60`, `src/lib/audio.ts:75`). Recorded clips play through `Tone.Player`; empty tracks use `MembraneSynth` fallback clicks (`src/lib/audio.ts:98`, `src/lib/audio.ts:112`).

### File inventory

| Path | Purpose |
| --- | --- |
| `src/lib/audio.ts` | Tone bootstrap, Transport loop, player lifecycle, play/stop/toggle, pad trigger, export abort hook (`src/lib/audio.ts:24`, `src/lib/audio.ts:48`, `src/lib/audio.ts:173`). |
| `src/lib/audibleActionGate.ts` | Shared predicate for starting playback, pads, recording, and export (`src/lib/audibleActionGate.ts:5`). |
| `src/lib/audioCapture.ts` | Live mic PCM capture through `MediaStreamSource -> ScriptProcessorNode -> AudioBuffer` (`src/lib/audioCapture.ts:49`, `src/lib/audioCapture.ts:56`). |
| `src/lib/audioBufferSlice.ts` | Trim-window copy helper for auto-tagging payloads (`src/lib/audioBufferSlice.ts:10`). |
| `src/lib/wavEncoder.ts` | Mono 16-bit PCM WAV sidecar encoder (`src/lib/wavEncoder.ts:30`, `src/lib/wavEncoder.ts:65`). |
| `src/lib/autoTrim.ts` | RMS trim-window detector using 10 ms windows and a 1.5 s content cap (`src/lib/autoTrim.ts:8`, `src/lib/autoTrim.ts:10`, `src/lib/autoTrim.ts:15`). |

### Data flow

1. `App` calls `initTransport()` once during boot; the function guards StrictMode double init (`src/App.tsx:31`, `src/App.tsx:32`, `src/lib/audio.ts:35`).
2. The scheduled 16th callback reads current step count, advances `stepCounter`, fires active unmuted track steps, and schedules `setCurrentStep()` via Tone Draw (`src/lib/audio.ts:48`, `src/lib/audio.ts:84`, `src/lib/audio.ts:87`, `src/lib/audio.ts:55`).
3. `triggerTrack()` starts a loaded `Tone.Player` with trim offset/duration, sends video triggers when `showVideo` is true, and increments pad flash sequence (`src/lib/audio.ts:98`, `src/lib/audio.ts:100`, `src/lib/audio.ts:101`, `src/lib/audio.ts:107`, `src/lib/audio.ts:108`).
4. `triggerTrackNow()` and `startPlayback()` both gate with `canStartAudibleAction()` before `Tone.start()` (`src/lib/audio.ts:117`, `src/lib/audio.ts:119`, `src/lib/audio.ts:163`, `src/lib/audio.ts:165`).
5. `syncPlayers()` rebuilds players only when clip object references change, and applies linear volume as dB (`src/lib/audio.ts:139`, `src/lib/audio.ts:143`, `src/lib/audio.ts:153`, `src/lib/audio.ts:133`).
6. `stopPlayback()` resets Tone Transport, step counter, current step, and video playback state; by default it also aborts active export (`src/lib/audio.ts:173`, `src/lib/audio.ts:177`, `src/lib/audio.ts:180`).

### Invariants

1. **Every audible start uses the shared gate.** It requires not playing, not exporting, and idle recording (`src/lib/audibleActionGate.ts:5`).
2. **Unlock Web Audio inside the user action path.** `ensureAudioStarted()` calls `Tone.start()`, and entry points call it before audio work (`src/lib/audio.ts:28`, `src/lib/audio.ts:119`, `src/lib/audio.ts:165`).
3. **Stopping playback must remain possible while playing.** `togglePlayback()` bypasses the start gate for the stop branch, while `PlayButton` disables only export or blocked starts (`src/lib/audio.ts:185`, `src/components/PlayButton.tsx:12`).
4. **Track IDs are array indexes 0 through 7.** `TRACK_PITCHES` has eight entries and `triggerTrack()` reads `project.tracks[trackId]` (`src/lib/audio.ts:12`, `src/lib/audio.ts:95`).
5. **Transport and local step counter reset together.** Start and stop both reset Transport position, step counter, video state, and UI current step (`src/lib/audio.ts:166`, `src/lib/audio.ts:167`, `src/lib/audio.ts:177`, `src/lib/audio.ts:179`).
6. **Scheduled React updates go through Tone Draw.** Direct wall-clock UI updates from the audio callback would drift from audible time (`src/lib/audio.ts:55`).
7. **Player start duration is never zero and exceptions are swallowed.** Rapid retriggers or zero trims must not kill the scheduler (`src/lib/audio.ts:101`, `src/lib/audio.ts:102`).
8. **Audio capture output stays silent.** `ScriptProcessorNode` is connected so it processes, then its output buffer is zeroed (`src/lib/audioCapture.ts:66`, `src/lib/audioCapture.ts:73`).

### Platform-specific paths

- Web Audio can start suspended without a user gesture; code unlocks with `Tone.start()` and official MDN docs confirm the suspended/resume pattern (`src/lib/audio.ts:28`).
- The live mic tap uses deprecated `ScriptProcessorNode`; MDN says it is deprecated, but the project uses it deliberately for broad browser behavior and zero-fills output (`src/lib/audioCapture.ts:49`, `src/lib/audioCapture.ts:66`).
- `decodeAudioData()` receives a copied buffer in both recording and rehydrate paths (`src/lib/recorder.ts:116`, `src/lib/recorder.ts:118`, `src/lib/rehydrate.ts:288`).
- Visibility restore only nudges Tone; it does not reacquire camera/mic automatically (`src/lib/streamLifecycle.ts:100`, `src/lib/streamLifecycle.ts:103`).

### Test coverage notes

- Audio trigger behavior, showVideo skip, muted skip, fallback synth, manual unlock, export/recording gates, and volume conversion are covered in `src/lib/audio.test.ts:100` through `src/lib/audio.test.ts:166`.
- The shared gate is covered in `src/lib/audibleActionGate.test.ts:27`.
- Slicing, trimming, and WAV encoding are covered in `src/lib/audioBufferSlice.test.ts:45`, `src/lib/autoTrim.test.ts:44`, and `src/lib/wavEncoder.test.ts:38`.
- Weak spots: real Tone scheduling, real AudioContext unlock behavior, swing timing, and iOS background resume are not proven by unit tests.

## Recording pipeline

### Overview

Recording turns one live camera+mic `MediaStream` into a persisted `Clip`: video blob, object URL, decoded `AudioBuffer`, WAV sidecar, trim metadata, poster blob, and poster URL (`src/lib/recordingFlow.ts:139`, `src/lib/recordingFlow.ts:150`, `src/lib/recordingFlow.ts:154`). `RecordingStation` reuses a preview stream while mounted; `TrackInfo` starts a self-acquired one-shot flow (`src/components/RecordingStation.tsx:48`, `src/components/RecordingStation.tsx:131`, `src/components/TrackInfo.tsx:50`).

### File inventory

| Path | Purpose |
| --- | --- |
| `src/lib/recordingFlow.ts` | Countdown, stream ownership, recorder call, trim, poster, sidecar, store write, async auto-tag (`src/lib/recordingFlow.ts:80`, `src/lib/recordingFlow.ts:136`, `src/lib/recordingFlow.ts:161`). |
| `src/lib/recorder.ts` | Fixed-duration MediaRecorder wrapper plus live audio capture and stop watchdog (`src/lib/recorder.ts:33`, `src/lib/recorder.ts:38`, `src/lib/recorder.ts:86`). |
| `src/lib/media.ts` | Permission confirmation, constraints, stale device fallback, stream acquire/release, device enumeration (`src/lib/media.ts:14`, `src/lib/media.ts:42`, `src/lib/media.ts:107`). |
| `src/lib/streamLifecycle.ts` | Single owner of `suspended` transitions for track end, hidden page, and recorder errors (`src/lib/streamLifecycle.ts:1`, `src/lib/streamLifecycle.ts:68`, `src/lib/streamLifecycle.ts:83`). |
| `src/lib/posterFrame.ts` | Best-effort JPEG poster extraction from video blobs (`src/lib/posterFrame.ts:17`, `src/lib/posterFrame.ts:51`). |
| `src/components/RecordingStation.tsx` | In-viewport sequential recording UI with preview stream, skip/done, source picker, and install affordance (`src/components/RecordingStation.tsx:19`, `src/components/RecordingStation.tsx:35`, `src/components/RecordingStation.tsx:245`). |
| `src/components/RecordCountdown.tsx` | Countdown/recording overlay and Escape cancellation host (`src/lib/recordingFlow.ts:45`). |
| `src/components/TrackInfo.tsx` | Per-track record/re-record, thumbnail, tag picker, showVideo toggle, auto-tag status (`src/components/TrackInfo.tsx:23`, `src/components/TrackInfo.tsx:50`, `src/components/TrackInfo.tsx:110`). |

### Data flow

1. Permission gate calls `requestMedia()`, which prompts, stops tracks immediately, and stores `status: "granted"` with `stream: null` on success (`src/components/Viewport.tsx:181`, `src/lib/media.ts:42`, `src/lib/media.ts:51`, `src/lib/media.ts:54`, `src/lib/media.ts:57`).
2. `RecordingStation` acquires preview stream on mount, stores it in a ref/state, refreshes devices, and releases it on cleanup (`src/components/RecordingStation.tsx:52`, `src/components/RecordingStation.tsx:58`, `src/components/RecordingStation.tsx:63`, `src/components/RecordingStation.tsx:72`).
3. `recordIntoTrack()` serializes flows with module singletons, checks the audible gate, and synchronously claims countdown state before awaits (`src/lib/recordingFlow.ts:42`, `src/lib/recordingFlow.ts:84`, `src/lib/recordingFlow.ts:86`, `src/lib/recordingFlow.ts:87`).
4. After 3 s countdown, `recordClip(stream, 2000, getAudioContext())` runs MediaRecorder and live Web Audio capture in parallel (`src/lib/recordingFlow.ts:18`, `src/lib/recordingFlow.ts:19`, `src/lib/recordingFlow.ts:136`, `src/lib/recorder.ts:33`, `src/lib/recorder.ts:38`).
5. On success, recording flow creates URLs, trims, captures poster, writes WAV sidecar, calls `setTrackClip()`, slices trim window, and starts async auto-tagging (`src/lib/recordingFlow.ts:139`, `src/lib/recordingFlow.ts:140`, `src/lib/recordingFlow.ts:145`, `src/lib/recordingFlow.ts:154`, `src/lib/recordingFlow.ts:161`, `src/lib/recordingFlow.ts:164`).
6. Cleanup releases only self-acquired streams and always returns recording state to idle (`src/lib/recordingFlow.ts:178`, `src/lib/recordingFlow.ts:179`, `src/lib/recordingFlow.ts:180`).

### Invariants

1. **Recording state must always return to idle.** A stuck non-idle state blocks playback, pads, recording, and export through the shared gate (`src/lib/recordingFlow.ts:180`, `src/lib/audibleActionGate.ts:5`).
2. **Preview streams are externally owned.** `recordingFlow` skips release when a stream option was supplied (`src/lib/recordingFlow.ts:107`, `src/lib/recordingFlow.ts:179`).
3. **Abort never saves a partial clip.** Abort rejects the wait/recorder path and `runFlow()` returns before clip assembly (`src/lib/recordingFlow.ts:53`, `src/lib/recorder.ts:67`, `src/lib/recordingFlow.ts:171`).
4. **Live Web Audio capture is preferred over container decode.** Recorder returns captured `AudioBuffer` when present and only decodes the blob as fallback (`src/lib/recorder.ts:109`, `src/lib/recorder.ts:116`).
5. **`requestMedia()` is permission confirmation, not a live stream guarantee.** It stores granted/null after stopping tracks (`src/lib/media.ts:51`, `src/lib/media.ts:54`, `src/lib/media.ts:57`).
6. **All stream lifecycle transitions go through `streamLifecycle.ts`.** Intentional release detaches before stop; suspension has a store stream identity guard (`src/lib/streamLifecycle.ts:59`, `src/lib/streamLifecycle.ts:68`, `src/lib/streamLifecycle.ts:72`).
7. **Device constraints use ideal square hints and exact selected device IDs.** Device ID wins over facing mode (`src/lib/media.ts:16`, `src/lib/media.ts:24`, `src/lib/media.ts:27`).
8. **Poster capture is best-effort.** `captureFirstFrame()` resolves `null` on decode/timeout, and recording catches poster errors before saving (`src/lib/posterFrame.ts:8`, `src/lib/recordingFlow.ts:141`).

### Platform-specific paths

- MIME candidates probe WebM first and MP4 after; WebKit docs confirm Safari MediaRecorder MP4/H.264/AAC support (`src/lib/mediaRecorderSupport.ts:4`).
- Stale device IDs are retried after `NotFoundError` or `OverconstrainedError`; MDN documents exact constraints can reject with `OverconstrainedError` (`src/lib/media.ts:80`, `src/lib/media.ts:97`).
- Track `ended` is treated as revoked/interrupted hardware and funnels to suspended; MDN confirms ended can follow permission revocation or hardware removal (`src/lib/streamLifecycle.ts:35`).
- Hidden page aborts export or stops playback and suspends camera/mic, then visible nudges Tone only (`src/lib/streamLifecycle.ts:83`, `src/lib/streamLifecycle.ts:100`).
- `playsInline` is set on preview and hidden video elements to avoid mobile fullscreen takeover (`src/components/RecordingStation.tsx:161`, `src/lib/videoEngine.ts:88`).

### Test coverage notes

- Recorder MIME selection, live capture preference, decode errors, recorder error routing, and abort are covered in `src/lib/recorder.test.ts:109` through `src/lib/recorder.test.ts:178`.
- Media permission, stale-device fallback, stream replacement, denied rollback, and constraint precedence are covered in `src/lib/media.test.ts:62` through `src/lib/media.test.ts:176`.
- Lifecycle suspension, stale-stream guards, hidden/visible behavior, export abort, and recorder-error branches are covered in `src/lib/streamLifecycle.test.ts:58` through `src/lib/streamLifecycle.test.ts:199`.
- Recording flow currently tests gating and early countdown claim (`src/lib/recordingFlow.test.ts:92`, `src/lib/recordingFlow.test.ts:114`), but not full real clip assembly.
- Weak spots: no unmocked browser test records a real clip, no real Safari MP4 capture validation, no dedicated `audioCapture.ts` test.

## Video presentation

### Overview

The renderer owns hidden muted inline `<video>` elements per recorded clip and paints exactly one active clip into the square canvas each animation frame (`src/lib/videoEngine.ts:72`, `src/lib/videoEngine.ts:86`, `src/lib/videoEngine.ts:279`). Trigger events come from the audio path and are selected at cut-subdivision boundaries by tag priority, recency, mute state, and same-tier hold (`src/lib/videoEngine.ts:10`, `src/lib/videoEngine.ts:221`, `src/lib/videoEngine.ts:248`).

### File inventory

| Path | Purpose |
| --- | --- |
| `src/lib/videoEngine.ts` | Hidden video lifecycle, trigger queue, cut-boundary scheduling, priority/hold selection, square crop draw, active canvas singleton (`src/lib/videoEngine.ts:54`, `src/lib/videoEngine.ts:72`, `src/lib/videoEngine.ts:319`). |
| `src/components/Viewport.tsx` | Canvas owner, rAF draw loop, media overlays, reconnect/record-more/fullscreen affordances (`src/components/Viewport.tsx:51`, `src/components/Viewport.tsx:60`, `src/components/Viewport.tsx:125`). |
| `src/lib/audio.ts` | Upstream producer for sequenced, pad, and key video triggers (`src/lib/audio.ts:84`, `src/lib/audio.ts:107`, `src/lib/audio.ts:117`). |
| `src/components/StepGrid.tsx` | Step toggles and current-step UI that feed the audio trigger loop (`src/components/StepGrid.tsx:20`, `src/components/StepGrid.tsx:108`). |
| `src/components/PadGrid.tsx` | Manual trigger surface using the same audio/video path (`src/components/PadGrid.tsx:15`, `src/components/PadGrid.tsx:35`). |
| `src/lib/useKeyboardTriggers.ts` | Digit/numpad 1-8 document hook for pad triggers (`src/lib/useKeyboardTriggers.ts:17`, `src/lib/useKeyboardTriggers.ts:29`). |
| `src/lib/useFullscreen.ts` | Feature-detected Fullscreen API wrapper for the viewport frame (`src/lib/useFullscreen.ts:12`, `src/lib/useFullscreen.ts:18`). |

### Data flow

1. `Viewport` calls `initVideoEngine()`, registers the active canvas, and starts an rAF loop that draws using `Tone.now()` (`src/components/Viewport.tsx:51`, `src/components/Viewport.tsx:55`, `src/components/Viewport.tsx:60`, `src/components/Viewport.tsx:70`).
2. `initVideoEngine()` wires existing clips, subscribes to track clip reference changes, and reschedules cut-boundary events when `project.cutSubdivision` changes (`src/lib/videoEngine.ts:344`, `src/lib/videoEngine.ts:352`, `src/lib/videoEngine.ts:357`, `src/lib/videoEngine.ts:365`).
3. `setClipForTrack()` tears down old videos, creates a muted inline auto-preload video for the clip URL, and stores trim metadata (`src/lib/videoEngine.ts:72`, `src/lib/videoEngine.ts:75`, `src/lib/videoEngine.ts:86`, `src/lib/videoEngine.ts:101`).
4. `audio.triggerTrack()` starts clip audio and calls `videoEngine.trigger()` only when `track.showVideo` is true (`src/lib/audio.ts:98`, `src/lib/audio.ts:107`).
5. While playback is running, triggers enter `pendingTriggers`; while stopped, pad/key triggers display immediately and do not leak into the queue (`src/lib/videoEngine.ts:148`, `src/lib/videoEngine.ts:150`, `src/lib/videoEngine.ts:152`).
6. Boundary callbacks consume triggers in `(windowStart, windowEnd]`, drop old triggers, keep future triggers, then apply same-tier hold (`src/lib/videoEngine.ts:221`, `src/lib/videoEngine.ts:233`, `src/lib/videoEngine.ts:254`, `src/lib/videoEngine.ts:257`).
7. `drawCurrentFrame()` clears black first, stops after trim end, returns if video dimensions are zero, otherwise center-crops to square (`src/lib/videoEngine.ts:283`, `src/lib/videoEngine.ts:292`, `src/lib/videoEngine.ts:299`, `src/lib/videoEngine.ts:305`).

### Invariants

1. **Presentation time is audio time.** Trigger start times and draw decisions are Tone/audio-context seconds, not rAF timestamps (`src/lib/videoEngine.ts:24`, `src/components/Viewport.tsx:70`).
2. **Canvas backing store stays 480x480.** CSS can scale the element, but export captures backing pixels (`src/components/Viewport.tsx:95`, `src/components/Viewport.tsx:96`, `src/lib/export.ts:22`).
3. **Eye-toggle gating is upstream.** Direct `videoEngine.trigger()` calls bypass `track.showVideo`; audio.ts is the only safe trigger entry (`src/lib/audio.ts:107`).
4. **Muted tracks are blocked in both layers.** Audio returns before trigger, and video priority strips muted contexts (`src/lib/audio.ts:96`, `src/lib/videoEngine.ts:176`).
5. **Metadata-not-ready triggers queue only the latest per track.** `pendingFirstTrigger` avoids failed early seeks and replays on `loadedmetadata` (`src/lib/videoEngine.ts:91`, `src/lib/videoEngine.ts:155`, `src/lib/videoEngine.ts:160`).
6. **Seek and play split by 80 ms for future cuts.** This reduces stale first frames at hard cuts (`src/lib/videoEngine.ts:35`, `src/lib/videoEngine.ts:135`).
7. **Do not remount/swap the canvas for fullscreen.** Export uses the registered canvas node; fullscreen enters the frame wrapper (`src/components/Viewport.tsx:55`, `src/components/ExportButton.tsx:66`, `src/components/Viewport.tsx:79`).
8. **Clip updates must replace clip object references.** Store and engine diffs are reference-based (`src/lib/videoEngine.ts:349`, `src/lib/videoEngine.ts:357`).

### Platform-specific paths

- Hidden videos are muted and `playsInline` for browser autoplay/inline behavior (`src/lib/videoEngine.ts:87`, `src/lib/videoEngine.ts:88`).
- `currentTime` and `.play()` are try/catch or promise-catch wrapped because browser seek/play races can fail without requiring app recovery (`src/lib/videoEngine.ts:110`, `src/lib/videoEngine.ts:117`).
- Center-crop handles cameras that negotiate 16:9 despite square constraints (`src/lib/videoEngine.ts:296`).
- Fullscreen support is feature-detected because arbitrary element fullscreen is not universal on iOS Safari (`src/lib/useFullscreen.ts:16`, `src/lib/useFullscreen.ts:18`).
- Background tabs can starve canvas capture; lifecycle aborts export on hidden (`src/lib/export.ts:22`, `src/lib/streamLifecycle.ts:86`).

### Test coverage notes

- Priority, mute filtering, hold behavior, boundary consumption, stopped trigger display, pending-trigger no-leak, lookahead scheduling, and trim-end clearing are covered in `src/lib/videoEngine.test.ts:73` through `src/lib/videoEngine.test.ts:191`.
- Upstream showVideo/mute contracts are covered in `src/lib/audio.test.ts:100`.
- Canvas backing size and viewport gate/reconnect/record-more states are covered in `src/components/Viewport.test.tsx:32` through `src/components/Viewport.test.tsx:143`.
- StepGrid export disabling and scroll layout are covered in `src/components/StepGrid.test.tsx:77` and `src/components/StepGrid.test.tsx:87`.
- Weak spots: no real browser pixel test for video decode/seek timing, center-crop pixels, fullscreen layout, or visual export correctness.

## Export pipeline

### Overview

Export renders the current sequencer in real time. `ExportButton` resolves the active viewport canvas, detects a supported MediaRecorder MIME, and calls `exportSong()` (`src/components/ExportButton.tsx:61`, `src/components/ExportButton.tsx:66`, `src/components/ExportButton.tsx:71`). `exportSong()` captures the canvas at 30 fps, adds a Tone destination tap to a `MediaStreamDestination`, records with MediaRecorder, runs Tone Transport for `bars * 4 * 60000 / bpm`, and downloads one blob (`src/lib/export.ts:18`, `src/lib/export.ts:67`, `src/lib/export.ts:122`, `src/lib/export.ts:158`).

### File inventory

| Path | Purpose |
| --- | --- |
| `src/lib/export.ts` | Stream builder, render duration, MediaRecorder orchestration, progress, abort races, cleanup, download filename (`src/lib/export.ts:18`, `src/lib/export.ts:61`, `src/lib/export.ts:177`). |
| `src/lib/exportSession.ts` | Singleton active export registry for abort and overlap rejection (`src/lib/exportSession.ts:8`, `src/lib/exportSession.ts:10`, `src/lib/exportSession.ts:18`). |
| `src/lib/exportFormats.ts` | Supported export MIME detection and per-container dedupe (`src/lib/exportFormats.ts:12`, `src/lib/exportFormats.ts:36`). |
| `src/components/ExportButton.tsx` | Popover UI, format persistence, active-canvas check, render errors, download extension pairing (`src/components/ExportButton.tsx:39`, `src/components/ExportButton.tsx:61`, `src/components/ExportButton.tsx:85`). |
| `src/lib/async.ts` | Wait and timeout helpers used by recorder/export stop races (`src/lib/export.ts:6`, `src/lib/export.ts:147`). |
| `src/lib/streamLifecycle.ts` | Hidden-page abort source for active exports (`src/lib/streamLifecycle.ts:83`, `src/lib/streamLifecycle.ts:86`). |

### Data flow

1. `ExportButton` computes supported formats once, restores a saved MIME only if still supported, and persists later choices in guarded `localStorage` (`src/components/ExportButton.tsx:39`, `src/components/ExportButton.tsx:40`, `src/components/ExportButton.tsx:46`).
2. Render click checks the audible gate, active canvas, and supported format before calling `exportSong()` (`src/components/ExportButton.tsx:61`, `src/components/ExportButton.tsx:66`, `src/components/ExportButton.tsx:71`, `src/components/ExportButton.tsx:79`).
3. `exportSong()` gates again, registers the exclusive session, sets `isExporting`, starts audio, builds the merged stream, and constructs MediaRecorder with caller MIME (`src/lib/export.ts:77`, `src/lib/export.ts:85`, `src/lib/export.ts:90`, `src/lib/export.ts:92`, `src/lib/export.ts:94`).
4. Export resets Transport with `stopPlayback({ allowExportStop: true })`, marks `isPlaying`, starts recorder and Transport, then races duration, early recorder completion, and external abort (`src/lib/export.ts:118`, `src/lib/export.ts:119`, `src/lib/export.ts:122`, `src/lib/export.ts:134`).
5. Success requests final data when available, stops recorder, rejects zero chunks, and returns a typed blob (`src/lib/export.ts:145`, `src/lib/export.ts:146`, `src/lib/export.ts:154`, `src/lib/export.ts:158`).
6. Cleanup clears progress, unregisters only the owned session, stops playback with the export flag, clears `isExporting`, and disconnects/stops stream tracks (`src/lib/export.ts:159`, `src/lib/export.ts:161`, `src/lib/export.ts:170`, `src/lib/export.ts:172`).

### Invariants

1. **Render length formula is shared with UI.** `durationMs = bars * 4 * 60000 / bpm`, and the popover displays the same formula (`src/lib/export.ts:67`, `src/components/ExportButton.tsx:156`).
2. **Overlap is blocked twice.** Store gate and export-session singleton both protect Tone Transport and capture streams (`src/lib/export.ts:77`, `src/lib/export.ts:85`, `src/lib/exportSession.ts:10`).
3. **Export-owned stop calls pass `allowExportStop`.** Plain `stopPlayback()` aborts active export by design (`src/lib/audio.ts:173`, `src/lib/export.ts:118`, `src/lib/export.ts:170`).
4. **The Tone connection is a tap.** Cleanup must disconnect the destination tap and stop both merged and raw canvas tracks (`src/lib/export.ts:23`, `src/lib/export.ts:26`, `src/lib/export.ts:35`).
5. **Caller MIME and extension must stay paired.** `exportSong()` trusts `mimeType`; `ExportButton` passes chosen extension to filename (`src/lib/export.ts:54`, `src/components/ExportButton.tsx:82`, `src/components/ExportButton.tsx:85`).
6. **Early recorder stop is an error.** Returning a short blob would hide encoder crashes or stream loss (`src/lib/export.ts:139`).
7. **Final stop has a watchdog and zero-chunk guard.** Mobile implementations can hang or claim support but produce nothing (`src/lib/export.ts:147`, `src/lib/export.ts:154`).
8. **Download URL revocation is deferred.** Immediate revocation can cancel browser downloads (`src/lib/export.ts:177`, `src/lib/export.ts:185`).

### Platform-specific paths

- `canvas.captureStream(30)` depends on browser support and foreground canvas painting; MDN documents the API returning a stream from canvas contents (`src/lib/export.ts:22`).
- Export format detection returns `[]` when `MediaRecorder` is absent and probes one supported MIME per container (`src/lib/exportFormats.ts:37`, `src/lib/exportFormats.ts:39`).
- `recorder.start(1000)` requests periodic data chunks during long render windows (`src/lib/export.ts:122`).
- Hidden-page lifecycle aborts export instead of trying to continue in a mobile-backgrounded state (`src/lib/streamLifecycle.ts:86`).

### Test coverage notes

- Stream track wiring and Tone tap cleanup are covered in `src/lib/export.test.ts:49`.
- Success, MP4 MIME passthrough, stop timeout, active abort, overlap rejection, and deferred download URL revocation are covered in `src/lib/export.test.ts:111`, `src/lib/export.test.ts:130`, `src/lib/export.test.ts:139`, `src/lib/export.test.ts:164`, `src/lib/export.test.ts:183`, and `src/lib/export.test.ts:207`.
- Export format detection is covered in `src/lib/exportFormats.test.ts:24` through `src/lib/exportFormats.test.ts:43`.
- The browser smoke suite covers export error surfacing with an injected failing MediaRecorder (`test/browser/browser-smoke.pw.ts:284`).
- Weak spots: no real Chrome WebM or Safari MP4 file playback test, no real A/V sync assertion, and no pixel correctness check for captured frames.

## PWA, service worker, install, deploy, and build

### Overview

PWA support is custom, not Workbox. `public/sw.js` precaches an injected app shell under `ha-shell-%BUILD_HASH%`, serves same-origin GETs cache-first, runtime-caches successful `/assets/` responses, and bypasses `/api/` plus non-GET requests (`public/sw.js:3`, `public/sw.js:19`, `public/sw.js:56`). `vite.config.ts` mutates `dist/sw.js` after build to inject the hash and emitted asset URLs (`vite.config.ts:108`, `vite.config.ts:123`, `vite.config.ts:125`).

### File inventory

| Path | Purpose |
| --- | --- |
| `public/sw.js` | Classic service worker: install precache, activate cleanup, fetch cache strategy and API bypass (`public/sw.js:36`, `public/sw.js:43`, `public/sw.js:56`). |
| `vite.config.ts` | Vite/React config, dev Gemini proxy, SW hash/precache mutation, Vitest setup (`vite.config.ts:14`, `vite.config.ts:85`, `vite.config.ts:136`). |
| `public/manifest.webmanifest` | PWA manifest with standalone display and icon set (`public/manifest.webmanifest:2`, `public/manifest.webmanifest:6`, `public/manifest.webmanifest:10`). |
| `index.html` | App shell metadata, manifest/icon links, iOS web-app tags, GoatCounter script (`index.html:5`, `index.html:13`, `index.html:16`, `index.html:39`). |
| `src/main.tsx` | Dev-only log hook, prod-only SW registration, React mount (`src/main.tsx:9`, `src/main.tsx:16`, `src/main.tsx:25`). |
| `src/lib/install.ts` | `beforeinstallprompt` capture, install hook, standalone detection, persistent storage request (`src/lib/install.ts:32`, `src/lib/install.ts:54`, `src/lib/install.ts:63`, `src/lib/install.ts:75`). |
| `src/components/CompatibilityBanner.tsx` | Required API feature detection and dismissible warning (`src/components/CompatibilityBanner.tsx:14`, `src/components/CompatibilityBanner.tsx:54`). |
| `vercel.json` | Raises `api/gemini.ts` max duration to 60 seconds (`vercel.json:3`, `vercel.json:5`). |

### Data flow

1. Build runs `tsc -b && vite build`, then `swBuildHash.writeBundle()` reads built `index.html` and `sw.js` (`package.json:11`, `vite.config.ts:112`, `vite.config.ts:117`, `vite.config.ts:122`).
2. The plugin hashes built `index.html`, replaces `%BUILD_HASH%`, collects `/assets/*`, and replaces the exact `PRECACHE_DECLARATION` string (`vite.config.ts:118`, `vite.config.ts:123`, `vite.config.ts:124`, `vite.config.ts:127`).
3. Production `main.tsx` waits for `load` and registers `/sw.js`; dev builds do not register a SW (`src/main.tsx:13`, `src/main.tsx:16`, `src/main.tsx:17`).
4. SW install opens the versioned cache, `addAll`s `PRECACHE_URLS`, and calls `skipWaiting()` (`public/sw.js:36`, `public/sw.js:38`, `public/sw.js:40`).
5. SW activate deletes old `ha-shell-*` caches and claims clients (`public/sw.js:43`, `public/sw.js:48`, `public/sw.js:53`).
6. Fetch events return without `respondWith()` for `/api/` and non-GET, otherwise same-origin GETs go through cache-first (`public/sw.js:56`, `public/sw.js:60`, `public/sw.js:64`).
7. `App` captures install prompt and calls `persistStorage()` once on mount (`src/App.tsx:33`, `src/App.tsx:34`).

### Invariants

1. **The precache declaration string must match byte-for-byte.** The build plugin uses `String.replace()` against `PRECACHE_DECLARATION` (`vite.config.ts:85`, `vite.config.ts:127`).
2. **SW bytes must change when built assets change.** The cache hash comes from built `index.html`, which contains Vite content-hashed asset names (`vite.config.ts:104`, `vite.config.ts:118`).
3. **`ha-shell-` prefix stays stable unless migrated.** Activate cleanup only deletes caches with that prefix (`public/sw.js:4`, `public/sw.js:48`).
4. **`/api/` stays network-only.** The SW deliberately returns before `respondWith()` for API requests and non-GETs (`public/sw.js:56`, `public/sw.js:60`).
5. **Runtime caching stays limited to ok `/assets/` responses.** Cache-first is safe there because Vite asset names are content-hashed (`public/sw.js:11`, `public/sw.js:24`).
6. **SW registration stays production-only.** A dev SW would cache Vite HMR/runtime assets (`src/main.tsx:13`, `src/main.tsx:16`).
7. **Install prompt listeners must detach.** React StrictMode can double-mount the App effect (`src/lib/install.ts:30`, `src/App.tsx:56`, `src/App.tsx:58`).
8. **`GEMINI_API_KEY` must not enter the client env prefix.** Vite loads it into server middleware only (`vite.config.ts:137`, `vite.config.ts:142`).

### Platform-specific paths

- `beforeinstallprompt` is Chromium-only according to MDN; the app gates its prompt on captured event availability (`src/lib/install.ts:5`, `src/lib/install.ts:32`).
- iOS gets a static Share/Add to Home Screen hint and no programmatic prompt (`src/components/RecordingStation.tsx:292`, `src/components/RecordingStation.tsx:312`).
- Standalone detection checks standard display-mode and iOS `navigator.standalone` (`src/lib/install.ts:63`, `src/lib/install.ts:65`, `src/lib/install.ts:67`).
- Persistent storage is best-effort and swallowed; MDN documents `StorageManager.persisted()`/`persist()` around persistent buckets (`src/lib/install.ts:71`, `src/lib/install.ts:75`).
- Cache-key normalization converts reload requests to plain GET cache keys (`public/sw.js:15`).

### Test coverage notes

- Service worker install precache, offline reload matching, runtime asset caching, cache failure resilience, API passthrough, and old-cache cleanup are covered in `test/serviceWorker.test.ts:121` through `test/serviceWorker.test.ts:218`.
- Install prompt capture, detach, prompt consumption, hook rerender, standalone media query, and storage persistence are covered in `src/lib/install.test.ts:19` through `src/lib/install.test.ts:90`.
- Production build offline reload is covered by Playwright smoke (`test/browser/browser-smoke.pw.ts:247`).
- Weak spots: no direct unit test for `swBuildHash`, manifest/icon integrity, iOS `navigator.standalone`, CompatibilityBanner branches, or Vercel routing.

## AI integration

### Overview

AI has three browser products: per-recording auto-tag, holistic re-tag, and pattern suggest/variation. All model traffic goes through `/api/gemini-token` then `/api/gemini`; the client fetches/caches a short-lived token and posts with `x-ha-gemini-token` (`src/lib/aiHttpClient.ts:11`, `src/lib/aiHttpClient.ts:74`, `src/lib/aiHttpClient.ts:103`). The proxy allows only `gemini-3.1-flash-lite`, JSON responses, text or `audio/wav` inline parts, and a small config/schema subset (`api/gemini.ts:7`, `api/gemini.ts:20`, `api/gemini.ts:21`, `api/gemini.ts:128`).

### File inventory

| Path | Purpose |
| --- | --- |
| `api/gemini.ts` | Server-side proxy validation, origin/Fetch Metadata/rate limit/token checks, upstream forwarding, token issuer (`api/gemini.ts:607`, `api/gemini.ts:685`). |
| `api/gemini-token.ts` | Vercel route wrapper for token issuance (`api/gemini-token.ts:3`, `api/gemini-token.ts:5`). |
| `src/lib/aiHttpClient.ts` | Browser transport with token cache, one token-rejection retry, timeout, text extraction, typed errors (`src/lib/aiHttpClient.ts:37`, `src/lib/aiHttpClient.ts:123`, `src/lib/aiHttpClient.ts:157`). |
| `src/lib/aiSuggest.ts` | Suggest/vary prompts, schema-constrained 8 x stepCount grid, transient retry, validation (`src/lib/aiSuggest.ts:42`, `src/lib/aiSuggest.ts:109`, `src/lib/aiSuggest.ts:196`). |
| `src/lib/aiAutoTag.ts` | Per-clip classifier, WAV inline audio, fail-open behavior, 0.6 threshold export (`src/lib/aiAutoTag.ts:17`, `src/lib/aiAutoTag.ts:22`, `src/lib/aiAutoTag.ts:57`). |
| `src/lib/aiAutoTagBatch.ts` | Holistic classifier, sorted inputs, 3 MiB inline cap, `thinkingLevel: high`, index mapping (`src/lib/aiAutoTagBatch.ts:17`, `src/lib/aiAutoTagBatch.ts:21`, `src/lib/aiAutoTagBatch.ts:109`). |
| `src/lib/applyClassifiedTag.ts` | Single AI-to-store tag boundary honoring manual tags and manual showVideo toggles (`src/lib/applyClassifiedTag.ts:19`, `src/lib/applyClassifiedTag.ts:28`, `src/lib/applyClassifiedTag.ts:36`). |
| `src/lib/retagAll.ts` | Re-tag orchestration: populated tracks, batch first, per-clip fallback, threshold, cancellation (`src/lib/retagAll.ts:39`, `src/lib/retagAll.ts:107`, `src/lib/retagAll.ts:113`). |
| `src/components/SuggestButton.tsx` | Header suggest UI, revision snapshot, stale response rejection, undo (`src/components/SuggestButton.tsx:58`, `src/components/SuggestButton.tsx:80`, `src/components/SuggestButton.tsx:95`). |
| `src/components/VariationButtons.tsx` | Feel popover variation UI with same revision/undo pattern (`src/components/VariationButtons.tsx:53`, `src/components/VariationButtons.tsx:77`). |
| `src/components/RetagAllControl.tsx` | Cancellable re-tag UI that reports busy state to parent popover (`src/components/RetagAllControl.tsx:37`, `src/components/RetagAllControl.tsx:59`). |

### Data flow

1. Per-record auto-tag starts after a clip is saved and only sends the trimmed audio window (`src/lib/recordingFlow.ts:161`, `src/lib/recordingFlow.ts:164`, `src/lib/recordingFlow.ts:169`).
2. `autoTag()` converts audio to WAV, base64s it with `FileReader`, sends inline `audio/wav`, validates JSON, and returns `null` on failures (`src/lib/aiAutoTag.ts:71`, `src/lib/aiClient.ts:4`, `src/lib/aiAutoTag.ts:86`, `src/lib/aiAutoTag.ts:127`, `src/lib/aiAutoTag.ts:140`).
3. `retagAllClipsWith()` slices populated tracks, tries batch, falls back to per-clip on `null`, applies the same confidence threshold, and checks abort between phases (`src/lib/retagAll.ts:39`, `src/lib/retagAll.ts:107`, `src/lib/retagAll.ts:113`, `src/lib/retagAll.ts:67`, `src/lib/retagAll.ts:108`).
4. Suggest and Variation snapshot BPM, style, step count, tracks, reasoning, and `projectRevision`; they commit through `applyPatternIfCurrent()` (`src/components/SuggestButton.tsx:61`, `src/components/SuggestButton.tsx:69`, `src/components/SuggestButton.tsx:80`, `src/components/VariationButtons.tsx:56`, `src/components/VariationButtons.tsx:77`).
5. The HTTP client fetches a request token, posts the same params to `/api/gemini`, retries exactly once for token rejection, and extracts `candidates[0].content.parts[0].text` (`src/lib/aiHttpClient.ts:74`, `src/lib/aiHttpClient.ts:103`, `src/lib/aiHttpClient.ts:126`, `src/lib/aiHttpClient.ts:157`).
6. Production proxy validation checks origin, API key, Fetch Metadata, rate limit, signed token, body size, JSON, and narrow request shape before upstream fetch (`api/gemini.ts:612`, `api/gemini.ts:615`, `api/gemini.ts:620`, `api/gemini.ts:623`, `api/gemini.ts:632`, `api/gemini.ts:635`, `api/gemini.ts:651`).

### Invariants

1. **Client request shape and proxy allowlist move together.** Model, config keys, schema keys, and inline MIME are enforced server-side (`api/gemini.ts:7`, `api/gemini.ts:20`, `api/gemini.ts:21`, `api/gemini.ts:128`).
2. **Production checks run before body read/upstream work.** Rate limiting and token validation happen before `readBodyWithLimit()` (`api/gemini.ts:623`, `api/gemini.ts:632`, `api/gemini.ts:635`).
3. **Auto-tag fails open; suggest/vary fail loud.** Auto-tag and batch catch and return `null`; grid generation throws validation/transport errors to UI (`src/lib/aiAutoTag.ts:140`, `src/lib/aiAutoTagBatch.ts:207`, `src/lib/aiSuggest.ts:248`).
4. **Confidence threshold is caller-enforced.** New auto-tag callers must apply `AUTO_TAG_CONFIDENCE_THRESHOLD` before store writes (`src/lib/aiAutoTag.ts:22`, `src/lib/recordingFlow.ts:195`, `src/lib/retagAll.ts:70`).
5. **AI tag writes go through `applyClassifiedTag()`.** It skips export, missing tracks, and manually tagged tracks, then writes tag/reasoning as system (`src/lib/applyClassifiedTag.ts:24`, `src/lib/applyClassifiedTag.ts:28`, `src/lib/applyClassifiedTag.ts:31`).
6. **Hat audio-only behavior must be symmetric.** System tag writes set `showVideo = tag !== "hat"` unless the user manually toggled video (`src/lib/applyClassifiedTag.ts:36`, `src/lib/applyClassifiedTag.ts:39`).
7. **Pattern race protection depends on revision hygiene.** Pending model output is rejected if revision or step count changed (`src/store/useAppStore.ts:504`, `src/store/useAppStore.ts:509`, `src/store/useAppStore.ts:516`).
8. **Batch result indexes map to sorted input order.** The code sorts inputs by track ID and maps model indexes back through that sorted list (`src/lib/aiAutoTagBatch.ts:109`, `src/lib/aiAutoTagBatch.ts:191`, `src/lib/aiAutoTagBatch.ts:195`).
9. **Size budgets are layered.** Batch inline estimate is 3 MiB, proxy serialized body cap is 4 MiB, and client timeout is 55 s under the 60 s Vercel function duration (`src/lib/aiAutoTagBatch.ts:21`, `api/gemini.ts:8`, `src/lib/aiHttpClient.ts:18`, `vercel.json:5`).
10. **Production fail-closed behavior is intentional.** Missing key, allowed origins, durable limiter, or token secret return stable errors before upstream (`api/gemini.ts:615`, `api/gemini.ts:356`, `api/gemini.ts:570`, `api/gemini.ts:445`).

### Platform-specific paths

- The Vercel function export shape is `{ fetch }`, and Vite imports named handlers for dev middleware (`api/gemini.ts:724`, `vite.config.ts:9`).
- Dev middleware adapts Node streams to Web `Request` and sets `duplex: "half"` for non-GET bodies (`vite.config.ts:49`, `vite.config.ts:58`, `vite.config.ts:61`).
- Production identity prefers `x-vercel-forwarded-for` and does not trust caller `x-forwarded-for`; dev accepts local forwarding headers (`api/gemini.ts:388`, `api/gemini.ts:392`).
- `blobToBase64()` uses browser `FileReader`, so plain Node callers need the test/browser environment seam (`src/lib/aiClient.ts:4`).
- `AbortSignal.timeout()` maps timeout DOMExceptions into `UpstreamTimeoutError` (`src/lib/aiHttpClient.ts:123`, `src/lib/aiHttpClient.ts:138`).

### Test coverage notes

- Proxy method/key/body/model/config/origin/token/rate-limit/upstream-redaction and current request shapes are covered in `api/gemini.test.ts:251` through `api/gemini.test.ts:807`, especially `api/gemini.test.ts:787`.
- HTTP token fetch/cache/retry/status mapping/timeout are covered in `src/lib/aiHttpClient.test.ts:51` through `src/lib/aiHttpClient.test.ts:208`.
- Suggest/vary schema, prompt guidance, kit notes, retry, malformed JSON, and variations are covered in `src/lib/aiSuggest.test.ts:19` through `src/lib/aiSuggest.test.ts:219`.
- Per-clip and batch auto-tag request shapes/fail-open behavior are covered in `src/lib/aiAutoTag.test.ts:47` and `src/lib/aiAutoTagBatch.test.ts:60`.
- Retag thresholding, fallback, manual overrides, reasoning, and cancellation are covered in `src/lib/retagAll.test.ts:62` through `src/lib/retagAll.test.ts:188`.
- Weak spots: no real Gemini calls, no Vite dev middleware test, no browser smoke for AI flows, and `TrackInfo` auto-tag status UI is not directly tested.

## UI shell

### Overview

`App` owns the bootstrap effect and first-screen composition: compatibility/recovery banners, header controls, viewport, pads, and step grid (`src/App.tsx:31`, `src/App.tsx:66`, `src/App.tsx:130`, `src/App.tsx:143`). Feature visibility is clip-count gated: Export/Feel/pads/grid need any clip, Suggest/Flow/Variations need `AI_UNLOCK_CLIPS` clips (`src/App.tsx:27`, `src/App.tsx:103`, `src/App.tsx:110`, `src/App.tsx:113`, `src/lib/aiSuggest.ts:21`).

### File inventory

| Path | Purpose |
| --- | --- |
| `src/App.tsx` | Bootstrap, autosave gate, keyboard hooks, header/body composition, clip-count gating (`src/App.tsx:31`, `src/App.tsx:63`, `src/App.tsx:103`). |
| `src/components/PlayButton.tsx` | Header play/stop button that allows stop but blocks starts when gated (`src/components/PlayButton.tsx:8`, `src/components/PlayButton.tsx:12`). |
| `src/components/BpmDial.tsx` | Pointer/wheel/keyboard tempo control with visual stops and store clamp delegation (`src/components/BpmDial.tsx:6`, `src/components/BpmDial.tsx:77`, `src/components/BpmDial.tsx:81`). |
| `src/components/FeelDisclosure.tsx` | Popover for cut/swing/hold, variations, re-tag, scratch, with busy pinning (`src/components/FeelDisclosure.tsx:23`, `src/components/FeelDisclosure.tsx:36`, `src/components/FeelDisclosure.tsx:90`). |
| `src/components/StepGrid.tsx` | Sticky track info plus horizontally scrollable step cells, remove block, extend buttons (`src/components/StepGrid.tsx:108`, `src/components/StepGrid.tsx:125`). |
| `src/components/PadGrid.tsx` | 4x2 trigger pad surface with trigger flash sequence (`src/components/PadGrid.tsx:15`, `src/components/PadGrid.tsx:76`). |
| `src/components/TrackInfo.tsx` | Per-track recording, thumbnail, eye toggle, tag picker, auto-tag status (`src/components/TrackInfo.tsx:23`, `src/components/TrackInfo.tsx:135`, `src/components/TrackInfo.tsx:160`). |
| `src/lib/useKeyboardTriggers.ts` | Digit/numpad key trigger hook with repeat/editable suppression (`src/lib/useKeyboardTriggers.ts:29`, `src/lib/useKeyboardTriggers.ts:31`). |
| `src/lib/useSpacebarPlayToggle.ts` | Spacebar playback hook with export and start gates (`src/lib/useSpacebarPlayToggle.ts:16`, `src/lib/useSpacebarPlayToggle.ts:23`). |
| `src/lib/usePopoverDismiss.ts` | Mousedown/Escape outside-dismiss hook with `whileBusy` suppression (`src/lib/usePopoverDismiss.ts:9`, `src/lib/usePopoverDismiss.ts:18`). |
| `src/test-setup.ts` | Vitest guard and browser API polyfills (`src/test-setup.ts:28`, `src/test-setup.ts:59`, `src/test-setup.ts:115`). |

### Data flow

1. `main.tsx` mounts `<App />` under React StrictMode; dev-only log hook and prod-only SW registration happen before mount (`src/main.tsx:11`, `src/main.tsx:16`, `src/main.tsx:25`).
2. App boot initializes Tone, captures install prompt, requests persistent storage, installs visibility listener, runs rehydrate, and starts autosave only if rehydrate was safe (`src/App.tsx:31`, `src/App.tsx:33`, `src/App.tsx:34`, `src/App.tsx:35`, `src/App.tsx:38`, `src/App.tsx:53`).
3. Header controls render based on clip count; empty projects show first-sound copy instead of pads/grid (`src/App.tsx:103`, `src/App.tsx:110`, `src/App.tsx:132`, `src/App.tsx:135`, `src/App.tsx:143`).
4. Play button and pads derive disabled state from `canStartAudibleAction()`; spacebar can stop playback but cannot stop export-owned playback (`src/components/PlayButton.tsx:11`, `src/components/PadGrid.tsx:19`, `src/lib/useSpacebarPlayToggle.ts:23`).
5. StepGrid disables cells/remove/extend while exporting and delegates actual mutation to store actions (`src/components/StepGrid.tsx:110`, `src/components/StepGrid.tsx:111`, `src/components/StepGrid.tsx:153`).
6. Feel popover stays open while retag or variation is busy, so async child state and undo/result UI survive (`src/components/FeelDisclosure.tsx:29`, `src/components/FeelDisclosure.tsx:36`, `src/components/VariationButtons.tsx:49`, `src/components/RetagAllControl.tsx:40`).
7. Scratch is two-step and then calls `actions.scratch()` from the store (`src/components/FeelDisclosure.tsx:90`, `src/components/FeelDisclosure.tsx:124`).

### Invariants

1. **Bootstrap must not autosave unsafe loads.** `App` starts autosave only when degraded load did not fail (`src/App.tsx:40`, `src/App.tsx:53`).
2. **Bootstrap cleanup is required under StrictMode.** App detaches install, visibility, and autosave effects (`src/App.tsx:56`, `src/App.tsx:58`, `src/App.tsx:60`).
3. **Export freeze is store-level, not only UI.** UI disables controls, but the store guards are the source of truth (`src/components/StepGrid.tsx:153`, `src/store/useAppStore.ts:112`).
4. **Keyboard hooks mount once at App level.** Duplicating them causes double triggers (`src/App.tsx:63`, `src/App.tsx:64`, `src/lib/useKeyboardTriggers.ts:40`).
5. **Keyboard shortcuts skip editable targets and repeats.** Both hooks suppress input/select/contentEditable and repeated keydown events (`src/lib/useKeyboardTriggers.ts:8`, `src/lib/useKeyboardTriggers.ts:32`, `src/lib/useSpacebarPlayToggle.ts:8`, `src/lib/useSpacebarPlayToggle.ts:20`).
6. **Cut subdivision is visual-only.** Type comments state audio scheduling stays at 16ths (`src/types.ts:69`, `src/components/CutSubdivisionSelect.tsx:1`).
7. **Tag picker default source is user.** TrackInfo calls `setTrackTag()` without a source; the store defaults to `"user"` and marks manual tags (`src/components/TrackInfo.tsx:163`, `src/store/useAppStore.ts:329`, `src/store/useAppStore.ts:352`).
8. **Test output must stay clean.** Unexpected `console.error` and React act warnings fail after each test unless routed through `[HA]` logger output (`src/test-setup.ts:28`, `src/test-setup.ts:48`, `src/lib/logger.ts:55`).

### Platform-specific paths

- BPM drag uses pointer capture and `touchAction: "none"` to avoid mobile scroll during knob drags (`src/components/BpmDial.tsx:81`, `src/components/BpmDial.tsx:120`).
- Popover dismissal listens to `mousedown`, not click, and `whileBusy` suppresses pointer/Escape dismissal during async work (`src/lib/usePopoverDismiss.ts:18`, `src/lib/usePopoverDismiss.ts:24`).
- Digit mapping uses `event.code` for physical `Digit1-8` and `Numpad1-8` (`src/lib/useKeyboardTriggers.ts:17`).
- Step cells carry `pointer-coarse:` Tailwind classes intended for 44 px touch targets (`src/components/StepGrid.tsx:33`) — but Tailwind 3.4 ships no such variant and `tailwind.config.js` defines none, so the built CSS has no `(pointer: coarse)` rules and these classes are currently inert. See `docs/audits/2026-07-audio-mobile-audit.md`.
- Browser smoke injects media/MediaRecorder mocks, so it validates UI plumbing but not real device media success (`test/browser/browser-smoke.pw.ts:5`).

### Test coverage notes

- StepGrid behavior, mobile tap sizing, scroll layout, export disabling, and max-step cap are covered in `src/components/StepGrid.test.tsx:35` through `src/components/StepGrid.test.tsx:102`.
- Suggest/Variation gating, apply, undo/stale rejection are covered in `src/components/SuggestButton.test.tsx:42`, `src/components/SuggestButton.test.tsx:71`, `src/components/VariationButtons.test.tsx:41`, and `src/components/VariationButtons.test.tsx:67`.
- Retag control, Feel scratch, Recovery banner, BpmDial, keyboard hooks, and spacebar hook are covered in `src/components/RetagAllControl.test.tsx:14`, `src/components/FeelDisclosure.test.tsx:7`, `src/components/RecoveryBanner.test.tsx:13`, `src/components/BpmDial.test.tsx:24`, `src/lib/useKeyboardTriggers.test.tsx:18`, and `src/lib/useSpacebarPlayToggle.test.tsx:18`.
- Browser smoke covers production boot/offline reload, recording keyboard gate plus hidden-page suspension, and export error UI (`test/browser/browser-smoke.pw.ts:247`, `test/browser/browser-smoke.pw.ts:262`, `test/browser/browser-smoke.pw.ts:284`).
- Weak spots: no direct `App.test.tsx`, no direct tests for Swing/Cut/Hold/Flow controls, no `usePopoverDismiss` dedicated test, no TrackInfo auto-tag status test.

## Where would I look if...

| Symptom | Start here |
| --- | --- |
| No sound on first tap | Audio engine: `canStartAudibleAction()` and `Tone.start()` in `src/lib/audibleActionGate.ts:5`, `src/lib/audio.ts:28`, `src/lib/audio.ts:117`. |
| Playhead moves but pads/clips are silent | Audio engine player sync and mute/volume: `src/lib/audio.ts:75`, `src/lib/audio.ts:98`, `src/lib/audio.ts:133`. |
| Fallback synth plays instead of recorded clip | Player not loaded or clip missing: `src/lib/audio.ts:98`, `src/lib/audio.ts:112`, `src/lib/rehydrate.ts:357`. |
| Viewport is black between cuts | Video presentation draw/trim/dimensions/showVideo: `src/lib/videoEngine.ts:283`, `src/lib/videoEngine.ts:292`, `src/lib/videoEngine.ts:299`, `src/lib/audio.ts:107`. |
| Wrong clip wins a cut | Video presentation priority/hold/window: `src/lib/videoEngine.ts:10`, `src/lib/videoEngine.ts:221`, `src/lib/videoEngine.ts:257`. |
| Cuts do not follow selected subdivision | Cut boundary subscription: `src/lib/videoEngine.ts:319`, `src/lib/videoEngine.ts:365`, `src/components/CutSubdivisionSelect.tsx:2`. |
| Export has no audio | Export Tone tap and AudioContext unlock: `src/lib/export.ts:23`, `src/lib/export.ts:26`, `src/lib/export.ts:92`. |
| Export is black or frozen | Active canvas and rAF draw loop: `src/components/ExportButton.tsx:66`, `src/components/Viewport.tsx:60`, `src/lib/export.ts:22`. |
| Export hangs at Rendering | MediaRecorder stop watchdog/session cleanup: `src/lib/export.ts:147`, `src/lib/export.ts:159`, `src/lib/exportSession.ts:10`. |
| Recording gets stuck or buttons stay disabled | Recording state/gate cleanup: `src/lib/recordingFlow.ts:84`, `src/lib/recordingFlow.ts:178`, `src/lib/audibleActionGate.ts:5`. |
| Camera light stays on | Stream ownership/release: `src/components/RecordingStation.tsx:72`, `src/lib/recordingFlow.ts:179`, `src/lib/streamLifecycle.ts:59`. |
| Reconnect pill appears unexpectedly | Stream lifecycle suspension paths: `src/lib/streamLifecycle.ts:35`, `src/lib/streamLifecycle.ts:68`, `src/lib/streamLifecycle.ts:83`. |
| Wrong phone camera is used | Media constraints and saved device IDs: `src/lib/media.ts:14`, `src/lib/media.ts:24`, `src/store/useAppStore.ts:414`. |
| Clip thumbnails are missing after reload | Poster persistence/regeneration: `src/lib/persistence.ts:62`, `src/lib/rehydrate.ts:361`, `src/lib/posterFrame.ts:17`. |
| Project is gone or partial after reload | Persistence/rehydrate recovery warnings and backups: `src/lib/persistence.ts:7`, `src/lib/rehydrate.ts:327`, `src/lib/rehydrate.ts:401`, `src/components/RecoveryBanner.tsx:7`. |
| Edits do not save | Autosave reference check, recording deferral, degraded-load autosave pause: `src/lib/autoSave.ts:57`, `src/lib/autoSave.ts:46`, `src/App.tsx:40`. |
| AI button errors | AI transport/proxy/status mapping: `src/lib/aiHttpClient.ts:46`, `src/lib/aiHttpClient.ts:144`, `api/gemini.ts:607`. |
| Suggest overwrites a recent edit | Revision bump and stale apply guard: `src/store/useAppStore.ts:49`, `src/components/SuggestButton.tsx:61`, `src/store/useAppStore.ts:504`. |
| Auto-tag looks right but does not apply | Manual tag/export guard in `applyClassifiedTag()`: `src/lib/applyClassifiedTag.ts:24`, `src/lib/applyClassifiedTag.ts:28`. |
| Offline reload fails | Service worker precache injection and cache key normalization: `vite.config.ts:123`, `public/sw.js:15`, `test/serviceWorker.test.ts:143`. |
| Tests fail on console/act warnings | Test setup console guard: `src/test-setup.ts:28`, `src/test-setup.ts:48`. |
