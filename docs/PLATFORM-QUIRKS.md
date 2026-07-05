# PLATFORM-QUIRKS.md

Browser and platform gotcha register for Hyperactive Amateur.

Verified against current repo commit `dff68e2` on 2026-07-05. This is a
code-grounded draft for `docs/PLATFORM-QUIRKS.md`; every code verdict below was
checked against current source. "Under investigation" means the point comes from
an audit finding and should not be treated as fixed or fully proven.

Confidence labels:

- `verified-in-code`: current source implements or lacks the behavior stated.
- `documented-platform-behavior`: an official browser/hosting source supports the platform claim.
- `needs-real-device-check`: static source review is not enough; verify on phones or production.

## iOS Safari and WebKit

### Treat iOS browser shells as WebKit, but gate behavior by features

- Rule: Do not assume Chrome, Firefox, Edge, or Brave on iOS have Chromium/Gecko media behavior.
- Why: recording, playback, install, and export depend on WebKit-owned media APIs on iOS.
- Code/source/confidence: feature checks live in `src/components/CompatibilityBanner.tsx:14`; the only UA check is copy-only install guidance in `src/components/RecordingStation.tsx:312`; source: `.claude/v2-mobile/plan.md`; confidence: `verified-in-code`.

### Keep the canvas backing store at 480 by 480

- Rule: Make display size fluid with CSS, not by changing canvas width/height attributes.
- Why: `canvas.captureStream()` records the backing store, so changing it changes the export contract.
- Code/source/confidence: fixed attributes are in `src/components/Viewport.tsx:95`; export captures that canvas in `src/lib/export.ts:22`; source: https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/captureStream; confidence: `verified-in-code`.

### Hide arbitrary-element fullscreen when unsupported

- Rule: Feature-detect `requestFullscreen`; do not show a dead viewport fullscreen button.
- Why: iOS Safari does not support arbitrary-element fullscreen in the way desktop browsers do.
- Code/source/confidence: support check is `src/lib/useFullscreen.ts:16`; render gate is `src/components/Viewport.tsx:49`; source: `.claude/v2-mobile/plan.md`; confidence: `verified-in-code`.

### Keep inline muted video attributes on preview, poster, and hidden playback videos

- Rule: Do not remove `muted` or `playsInline` from camera preview or blob video elements without a mobile Safari test.
- Why: the app draws hidden videos into a canvas and shows a live camera preview; surprise fullscreen or feedback breaks the workflow.
- Code/source/confidence: preview video uses them in `src/components/RecordingStation.tsx:161`; hidden playback videos in `src/lib/videoEngine.ts:86`; poster videos in `src/lib/posterFrame.ts:25`; confidence: `verified-in-code`.

### Under investigation: Home Screen storage can look like a deleted Safari project

- Rule: Do not present Add to Home Screen as a safe migration path for projects already created in Safari until transfer/export exists.
- Why: the app stores projects in IndexedDB, and iOS Home Screen apps can have isolated storage from Safari.
- Code/source/confidence: standalone manifest is `public/manifest.webmanifest:5`; missing project returns a clean first-run load in `src/lib/rehydrate.ts:338`; source: https://bugs.webkit.org/show_bug.cgi?id=181849; confidence: `needs-real-device-check`.

### Under investigation: non-installed Safari storage is not durable enough for irreplaceable clips

- Rule: Treat local Safari IndexedDB as best effort unless persistence and backup/export behavior are verified.
- Why: recorded clip blobs, WAV sidecars, and posters all live locally.
- Code/source/confidence: `persistStorage()` is best effort in `src/lib/install.ts:75`; missing data has no warning in `src/lib/rehydrate.ts:338`; source: https://webkit.org/blog/14403/updates-to-storage-policy/; confidence: `needs-real-device-check`.

### Under investigation: iOS Web Audio session type is not declared

- Rule: If audio session handling is added, set it through a small helper and test silent switch, mic capture, playback, and export.
- Why: Tone playback, pad hits, sidecar capture, and export audio all depend on Web Audio.
- Code/source/confidence: audio is Tone-based in `src/lib/audio.ts:28`; no `navigator.audioSession` usage exists; source: https://developer.mozilla.org/en-US/docs/Web/API/Audio_Session_API; confidence: `needs-real-device-check`.

### Under investigation: `BaseAudioContext.state === "interrupted"` is not handled

- Rule: Do not assume a visible page means the AudioContext is running.
- Why: OS audio focus changes can leave UI state ahead of actual audio state.
- Code/source/confidence: raw context is exposed in `src/lib/audio.ts:24`, but no statechange owner exists; source: https://developer.mozilla.org/en-US/docs/Web/API/BaseAudioContext/state; confidence: `needs-real-device-check`.

## Android Chrome

### Use `beforeinstallprompt` only as an optional install affordance

- Rule: The app must work when `beforeinstallprompt` never fires.
- Why: Android Chrome can expose a programmatic prompt; iOS Safari cannot.
- Code/source/confidence: capture is in `src/lib/install.ts:27`; user-triggered prompt is `src/lib/install.ts:54`; button renders from `src/components/RecordingStation.tsx:300`; source: `.claude/v2-mobile/plan.md`; confidence: `verified-in-code`.

### Use Pointer Events for touch-operable drag controls

- Rule: Do not add parallel mouse and touch handlers for the BPM dial.
- Why: one pointer path keeps mouse, touch, and pen behavior aligned and avoids page scroll during drag.
- Code/source/confidence: `BpmDial` uses pointer capture in `src/components/BpmDial.tsx:81`; `touchAction: "none"` is set in `src/components/BpmDial.tsx:120`; source: `.claude/v2-mobile/plan.md`; confidence: `verified-in-code`.

### Confirmed: coarse-pointer Tailwind variants are inert in the built CSS

- Rule: Verify generated CSS, not only JSX class strings, before trusting mobile touch-size fixes. Tailwind 3.4 has no built-in `pointer-coarse:`/`any-pointer-coarse:` variants; they must be defined in `tailwind.config.js` (or the classes replaced with plain `@media (pointer: coarse)` CSS).
- Why: these classes drive the 44 px tap targets, the tap-visible re-record/column-remove affordances, and the camera Flip button (`hidden any-pointer-coarse:flex`) — all currently dead on touch devices.
- Code/source/confidence: classes appear in `src/components/StepGrid.tsx:35`, `src/components/TrackInfo.tsx:146`, and `src/components/RecordingStation.tsx:201`; `tailwind.config.js` defines no variant; the built `dist/assets/*.css` contains zero `(pointer: coarse)` media queries (verified 2026-07-05). See `docs/audits/2026-07-audio-mobile-audit.md`; confidence: `verified-in-code`.

## MediaRecorder and codecs

### Always probe MediaRecorder MIME strings at runtime

- Rule: Never hardcode a browser-to-container mapping without `MediaRecorder.isTypeSupported()`.
- Why: recording and export need a MIME the current browser can actually produce.
- Code/source/confidence: recording candidates are in `src/lib/mediaRecorderSupport.ts:4`; export formats are in `src/lib/exportFormats.ts:12`; source: https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder/isTypeSupported_static; confidence: `documented-platform-behavior`.

### Prefer WebM for Chromium, but keep MP4 fallback for Safari

- Rule: Use WebM where supported, but offer MP4 where Safari/WebKit exposes it.
- Why: browser MediaRecorder support and shareability differ by platform.
- Code/source/confidence: recording includes WebM and MP4 candidates in `src/lib/mediaRecorderSupport.ts:4`; export exposes WebM/MP4 choices in `src/lib/exportFormats.ts:12`; source: https://webkit.org/blog/11353/mediarecorder-api/; confidence: `documented-platform-behavior`.

### Keep feature detection even with Safari 18.4 WebM support

- Rule: Treat Safari 18.4+ support as a capability to probe, not as a UA assumption.
- Why: the documented mobile floor is iOS Safari 18.4+, but browser shells and versions still vary.
- Code/source/confidence: compatibility passes only when a supported recording MIME is found in `src/components/CompatibilityBanner.tsx:16`; source: https://developer.apple.com/documentation/safari-release-notes/safari-18_4-release-notes; confidence: `documented-platform-behavior`.

### Persist a WAV sidecar for every new recording

- Rule: Do not rely on decoding playback audio out of the recorded video container for new saves.
- Why: current playback and rehydrate are intentionally decoupled from WebM/MP4 audio decode reliability.
- Code/source/confidence: recording creates `audioBlob` in `src/lib/recordingFlow.ts:154`; persistence stores it in `src/lib/persistence.ts:61`; rehydrate decodes it first in `src/lib/rehydrate.ts:293`; source: `scratchpad/relay-out/audit-persist-media.md`; confidence: `verified-in-code`.

### Keep MediaRecorder video and Web Audio sidecar alignment under test

- Rule: MediaRecorder owns the video blob; Web Audio owns the playback sidecar, so their capture windows must stay aligned.
- Why: mobile stop/flush timing can make audio and video drift.
- Code/source/confidence: `recordClip()` creates both paths in `src/lib/recorder.ts:33`; sidecar capture uses `src/lib/audioCapture.ts:49`; source: `scratchpad/relay-out/audit-capture.md`; confidence: `needs-real-device-check`.

### Treat ScriptProcessorNode as legacy capture plumbing

- Rule: If live sidecar capture changes, evaluate AudioWorklet; do not expand ScriptProcessor usage casually.
- Why: ScriptProcessor is deprecated but currently works as the live mic tap.
- Code/source/confidence: ScriptProcessor is required in `src/lib/audioCapture.ts:35`; output is zero-filled to avoid feedback in `src/lib/audioCapture.ts:66`; source: https://developer.mozilla.org/en-US/docs/Web/API/ScriptProcessorNode; confidence: `documented-platform-behavior`.

### Keep defensive copies before `decodeAudioData()`

- Rule: Preserve `arrayBuffer.slice(0)` before Web Audio decoding.
- Why: this avoids browser-specific input-buffer detachment surprises in fallback and rehydrate paths.
- Code/source/confidence: recording fallback copies in `src/lib/recorder.ts:116`; rehydrate copies in `src/lib/rehydrate.ts:288`; source: `scratchpad/relay-out/registers/decisions-gotchas.md`; confidence: `verified-in-code`.

### Under investigation: export MP4 probing is narrower than recording probing

- Rule: Add or share `video/mp4; codecs=h264,aac` for export only after real Safari/WebKit probes.
- Why: compatibility may pass while export misses the only supported MP4 string.
- Code/source/confidence: recording includes that MIME in `src/lib/mediaRecorderSupport.ts:9`; export does not in `src/lib/exportFormats.ts:24`; source: `scratchpad/relay-out/audit-export.md`; confidence: `needs-real-device-check`.

### Under investigation: poster extraction can delay save completion

- Rule: If users see recordings linger before saving, save the clip first and generate posters later.
- Why: mobile blob-video decode events can be delayed or skipped.
- Code/source/confidence: poster extraction times out in `src/lib/posterFrame.ts:51`, but `recordingFlow` awaits it before `setTrackClip()` in `src/lib/recordingFlow.ts:143`; source: `scratchpad/relay-out/audit-capture.md`; confidence: `needs-real-device-check`.

## Web Audio and AudioContext lifecycle

### Gate every audible entry point

- Rule: Playback, pads, recording, and export must call `canStartAudibleAction()` from the real entry point.
- Why: the app cannot safely record, export, and play audible output at the same time.
- Code/source/confidence: predicate is `src/lib/audibleActionGate.ts:5`; call sites include `src/lib/audio.ts:117`, `src/lib/audio.ts:163`, `src/lib/recordingFlow.ts:86`, and `src/lib/export.ts:77`; source: `scratchpad/relay-out/audit-audio-lifecycle.md`; confidence: `verified-in-code`.

### Claim long-running audible work before the first await

- Rule: A path that awaits media/audio unlock must synchronously claim ownership first.
- Why: mobile audio unlock and getUserMedia can be slow enough for double taps and cross-control races.
- Code/source/confidence: recording claims `"countdown"` in `src/lib/recordingFlow.ts:87`; export claims session and `isExporting` in `src/lib/export.ts:85`; playback lacks an equivalent starting flag in `src/lib/audio.ts:163`; source: `scratchpad/relay-out/audit-audio-lifecycle.md`; confidence: `verified-in-code`.

### Keep the audio clock as the sequencing source of truth

- Rule: Do not time audible or visible cuts from `performance.now()` or rAF timestamps.
- Why: the hard-cut canvas has to follow Tone/Web Audio time.
- Code/source/confidence: Tone transport passes scheduled `time` in `src/lib/audio.ts:48`; viewport paints from `Tone.now()` in `src/components/Viewport.tsx:67`; source: `scratchpad/relay-out/audit-av-sync.md`; confidence: `verified-in-code`.

### Under investigation: `Tone.now()` lookahead can draw visuals early

- Rule: If fixing A/V sync, stay on the audio clock; consider `Tone.immediate()` or Draw scheduling, not wall-clock time.
- Why: Tone callbacks can run ahead of audible time, and visuals can switch before sound.
- Code/source/confidence: current draw loop passes `Tone.now()` in `src/components/Viewport.tsx:70`; boundary state mutates in `src/lib/videoEngine.ts:249`; source: `scratchpad/relay-out/audit-av-sync.md`; confidence: `needs-real-device-check`.

### Do not treat visibility restore as guaranteed audio unlock

- Rule: User activation is the reliable place to unlock Web Audio.
- Why: automatic resume can fail silently after app switch or lock.
- Code/source/confidence: visible-page handler calls `void Tone.start()` without await/check in `src/lib/streamLifecycle.ts:100`; user entry points also call `ensureAudioStarted()` in `src/lib/audio.ts:117`; source: https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Autoplay; confidence: `needs-real-device-check`.

### Export audio is a Tone destination tap

- Rule: Debug missing export audio at the destination tap before changing player scheduling.
- Why: export combines raw canvas video and a Web Audio `MediaStreamDestination`.
- Code/source/confidence: destination tap is built in `src/lib/export.ts:23`; Tone destination connects at `src/lib/export.ts:26` and disconnects at `src/lib/export.ts:35`; source: `scratchpad/relay-out/audit-export.md`; confidence: `verified-in-code`.

## getUserMedia and stream lifecycle

### Use soft camera constraints unless the user selected a device

- Rule: Use ideal size/aspect/facing constraints by default; reserve exact `deviceId` for Sources selection.
- Why: phones can reject mandatory constraints or pick different cameras across sessions.
- Code/source/confidence: ideal constraints are in `src/lib/media.ts:16`; `deviceId` wins over `facingMode` in `src/lib/media.ts:21`; source: https://developer.mozilla.org/en-US/docs/Web/API/MediaTrackConstraints/facingMode; confidence: `documented-platform-behavior`.

### Clear stale saved devices and retry with defaults

- Rule: Treat `NotFoundError` and `OverconstrainedError` from saved devices as stale preferences.
- Why: mobile and laptop input devices can disappear or change IDs.
- Code/source/confidence: stale detection is `src/lib/media.ts:80`; preferences are cleared and retried in `src/lib/media.ts:92`; source: `scratchpad/relay-out/audit-capture.md`; confidence: `verified-in-code`.

### Release permission-probe streams immediately

- Rule: Permission probing should not keep the camera light on.
- Why: preview and recording own their own stream lifetime.
- Code/source/confidence: `requestMedia()` stops probe tracks in `src/lib/media.ts:51`; preview effect acquires/releases in `src/components/RecordingStation.tsx:52`; source: `scratchpad/relay-out/audit-interruption.md`; confidence: `verified-in-code`.

### Route stream loss through `streamLifecycle.ts`

- Rule: Do not add ad hoc ended/visibility/recorder-loss handlers in components.
- Why: the app needs one transition into `media.status === "suspended"`.
- Code/source/confidence: acquired streams register lifecycle in `src/lib/media.ts:112`; track-ended listeners attach in `src/lib/streamLifecycle.ts:39`; recorder stream-loss check is `src/lib/streamLifecycle.ts:115`; confidence: `verified-in-code`.

### Detach lifecycle listeners before intentional stops

- Rule: Stop tracks through the lifecycle helpers, not scattered loops.
- Why: intentional release must not self-report as a suspension or let stale streams clear newer streams.
- Code/source/confidence: release detaches and stops in `src/lib/streamLifecycle.ts:59`; suspension owns exact-stream transition in `src/lib/streamLifecycle.ts:68`; source: https://developer.mozilla.org/en-US/docs/Web/API/MediaStreamTrack/stop; confidence: `verified-in-code`.

### Keep `suspended` distinct from `denied`

- Rule: Suspended means "was granted, currently disconnected"; do not show the first-run permission gate.
- Why: returning users need a reconnect action, not a reload/permission explanation.
- Code/source/confidence: `Viewport` excludes suspended from the gate in `src/components/Viewport.tsx:38`; reconnect calls `resumeMedia()` in `src/components/Viewport.tsx:125`; action is `src/store/useAppStore.ts:444`; confidence: `verified-in-code`.

### Under investigation: live-but-muted tracks are not handled

- Rule: Do not rely only on `readyState`; a live track can still be temporarily unable to provide data.
- Why: calls, OS capture changes, or privacy controls can produce silent or black clips.
- Code/source/confidence: lifecycle listens only for `ended` in `src/lib/streamLifecycle.ts:39`; recorder checks `readyState` only in `src/lib/streamLifecycle.ts:117`; source: https://developer.mozilla.org/en-US/docs/Web/API/MediaStreamTrack/mute_event; confidence: `needs-real-device-check`.

### Under investigation: page lifecycle handling is visibility-only

- Rule: If restore bugs remain, add `pagehide`, `pageshow`, and frozen-page reconciliation centrally.
- Why: mobile bfcache and OS restore can leave stale `MediaStream` objects in JS state.
- Code/source/confidence: `App` installs only visibility handling in `src/App.tsx:35`; listener attaches only `visibilitychange` in `src/lib/streamLifecycle.ts:106`; source: https://developer.mozilla.org/en-US/docs/Web/API/Window/pagehide_event; confidence: `needs-real-device-check`.

### Page hide is a hard interruption for real-time export

- Rule: Tell users to keep the screen open during export.
- Why: export records live rAF canvas frames and Tone output in real time.
- Code/source/confidence: hidden-page handling aborts export in `src/lib/streamLifecycle.ts:85`; export races that abort in `src/lib/export.ts:134`; source: https://developer.mozilla.org/en-US/blog/using-the-page-visibility-api/; confidence: `documented-platform-behavior`.

## Service worker and PWA

### Register the service worker only in production

- Rule: Do not run the app service worker in Vite dev mode.
- Why: a dev service worker can cache HMR assets and make local debugging lie.
- Code/source/confidence: registration is gated by `import.meta.env.PROD` in `src/main.tsx:16`; registration failure is swallowed in `src/main.tsx:18`; source: `scratchpad/relay-out/audit-pwa.md`; confidence: `verified-in-code`.

### Verify the built `dist/sw.js`, not only `public/sw.js`

- Rule: Cache name and precache list are build outputs.
- Why: the shipped worker has placeholders replaced from emitted Vite assets.
- Code/source/confidence: placeholders are in `public/sw.js:3`; Vite injects hash and assets in `vite.config.ts:96` and `vite.config.ts:123`; source: `scratchpad/relay-out/audit-pwa.md`; confidence: `verified-in-code`.

### Use `skipWaiting()` and `clients.claim()` deliberately

- Rule: A newly installed worker does not control already-open pages unless claimed.
- Why: first-load asset requests can be outside service-worker control.
- Code/source/confidence: install calls `skipWaiting()` in `public/sw.js:40`; activate claims clients in `public/sw.js:53`; source: https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API/Using_Service_Workers; confidence: `documented-platform-behavior`.

### Keep `/api/` network-only

- Rule: Never cache Gemini or token routes in the service worker.
- Why: stale AI responses, tokens, or errors are security and UX bugs.
- Code/source/confidence: `/api/` and non-GET requests bypass `respondWith()` in `public/sw.js:56`; Gemini responses set `no-store` in `api/gemini.ts:61`; source: `scratchpad/relay-out/audit-pwa.md`; confidence: `verified-in-code`.

### Treat install precache as all-or-nothing, runtime asset cache as best effort

- Rule: Let install fail on bad precache, but do not fail successful JS/CSS network fetches when runtime cache writes fail.
- Why: partial app shells are dangerous, but Cache Storage quota failures should not break online loads.
- Code/source/confidence: install waits on `cache.addAll()` in `public/sw.js:36`; runtime asset `cache.put()` catches errors in `public/sw.js:23`; source: https://developer.mozilla.org/en-US/docs/Web/API/Cache/addAll; confidence: `documented-platform-behavior`.

### Normalize reload request cache keys

- Rule: Match precached shell entries through a plain GET cache key.
- Why: browser reload metadata can otherwise miss cached app-shell responses.
- Code/source/confidence: `cacheKeyFor()` creates a new GET request in `public/sw.js:15`; lookup and write use it in `public/sw.js:19`; source: `scratchpad/relay-out/audit-pwa.md`; confidence: `verified-in-code`.

### Under investigation: offline AI UX is not normalized

- Rule: Core PWA shell can load offline, but AI controls must explain that model calls need network.
- Why: installed users can tap Suggest or auto-tag while offline and see raw fetch failures.
- Code/source/confidence: service worker bypasses `/api/` in `public/sw.js:56`; AI posts to `/api/gemini-token` and `/api/gemini` in `src/lib/aiHttpClient.ts:74`; source: `scratchpad/relay-out/audit-pwa.md`; confidence: `needs-real-device-check`.

## IndexedDB and storage

### Persist schema-versioned data only

- Rule: Persisted shape changes need migration/repair tests.
- Why: local projects must survive reloads and loop lengths must remain aligned to 4 steps.
- Code/source/confidence: schema version is `src/lib/persistence.ts:6`; missing version becomes legacy v0 in `src/lib/rehydrate.ts:245`; step count aligns in `src/lib/rehydrate.ts:89`; confidence: `verified-in-code`.

### Reject invalid persisted steps instead of coercing them

- Rule: Do not use truthiness on persisted grid entries.
- Why: strings or objects could silently create beats.
- Code/source/confidence: `normalizeSteps()` accepts only booleans in `src/lib/rehydrate.ts:105`; invalid entries warn at `src/lib/rehydrate.ts:117`; source: `scratchpad/relay-out/audit-persist-media.md`; confidence: `verified-in-code`.

### Persist blobs, not object URLs

- Rule: Recreate object URLs on load and revoke old ones on replacement.
- Why: object URLs are session resources and leak if kept around.
- Code/source/confidence: snapshot stores blobs in `src/lib/persistence.ts:58`; rehydrate creates URLs in `src/lib/rehydrate.ts:370`; replacement revokes in `src/store/useAppStore.ts:271`; confidence: `verified-in-code`.

### Pause autosave when recovery cannot safely proceed

- Rule: If load or backup fails, do not overwrite the saved project with an empty state.
- Why: storage errors are exactly when autosave can destroy the last recoverable data.
- Code/source/confidence: load failures return degraded warnings in `src/lib/rehydrate.ts:327`; failed recovery backup returns degraded failure in `src/lib/rehydrate.ts:344`; `App` gates autosave in `src/App.tsx:38`; confidence: `verified-in-code`.

### Under investigation: fresh recordings depend on debounced autosave for durability

- Rule: Treat recording completion as a durability boundary if last-clip loss appears after lock or app switch.
- Why: mobile OS kills can happen before a 500 ms debounce writes IndexedDB.
- Code/source/confidence: `setTrackClip()` runs in `src/lib/recordingFlow.ts:161`; autosave debounce is `src/lib/autoSave.ts:7`; source: `scratchpad/relay-out/audit-persist-media.md`; confidence: `needs-real-device-check`.

### Under investigation: recovery backup duplicates media bytes

- Rule: Be careful adding blob fields until recovery backup size and quota are redesigned.
- Why: degraded repair can write a full second copy of every clip, sidecar, and poster.
- Code/source/confidence: backup stores the full project in `src/lib/persistence.ts:88`; rehydrate requires backup before repair proceeds in `src/lib/rehydrate.ts:344`; source: `scratchpad/relay-out/audit-persist-media.md`; confidence: `needs-real-device-check`.

### Under investigation: legacy clips without sidecars are dropped if decode fails

- Rule: Do not assume old WebM projects recover on every WebKit build.
- Why: current saves have WAV sidecars, but old saves can depend on mixed-container Web Audio decode.
- Code/source/confidence: sidecar decode falls back to clip decode in `src/lib/rehydrate.ts:293`; decode failure drops the clip in `src/lib/rehydrate.ts:379`; source: https://webkit.org/blog/16574/webkit-features-in-safari-18-4/; confidence: `needs-real-device-check`.

## Vercel and deployment

### Keep request bodies below Vercel's function body cap

- Rule: App-level body limits must stay below the platform limit.
- Why: Gemini audio requests can include inline WAV data, and platform rejections will not have app-shaped JSON.
- Code/source/confidence: proxy cap is 4 MiB in `api/gemini.ts:8`; streamed body enforcement is `api/gemini.ts:270`; source: https://vercel.com/kb/guide/how-to-bypass-vercel-body-size-limit-serverless-functions; confidence: `documented-platform-behavior`.

### Account for Base64 expansion before inline audio

- Rule: Raw audio bytes are not the JSON request size once Base64 encoded.
- Why: inline WAV can hit body caps faster than the original blob size suggests.
- Code/source/confidence: inline data must be Base64 `audio/wav` in `api/gemini.ts:128`; body size is checked before parse in `api/gemini.ts:270`; source: https://developer.mozilla.org/en-US/docs/Glossary/Base64; confidence: `documented-platform-behavior`.

### Keep Gemini keys server-side

- Rule: Do not expose `GEMINI_API_KEY` through Vite client env.
- Why: browser traffic must go through proxy validation, tokens, and rate limiting.
- Code/source/confidence: Vite loads the key only for dev middleware in `vite.config.ts:136`; server reads it in `api/gemini.ts:615`; client only calls `/api/gemini-token` and `/api/gemini` in `src/lib/aiHttpClient.ts:11`; confidence: `verified-in-code`.

### Production Gemini traffic fails closed

- Rule: Production requires allowed origin, Fetch Metadata, limiter, signed token, key, and body validation.
- Why: the proxy protects Gemini spend and should not be a generic model tunnel.
- Code/source/confidence: origin check is `api/gemini.ts:612`; Fetch Metadata is `api/gemini.ts:620`; limiter is `api/gemini.ts:623`; token is `api/gemini.ts:632`; source: https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Sec-Fetch-Site; confidence: `verified-in-code`.

### Fetch Metadata is not the whole security model

- Rule: Do not remove signed tokens or durable rate limiting because `Sec-Fetch-*` checks exist.
- Why: non-browser clients can send arbitrary headers.
- Code/source/confidence: signed tokens validate in `api/gemini.ts:458`; missing production limiter returns 503 in `api/gemini.ts:579`; source: https://www.w3.org/TR/fetch-metadata/; confidence: `documented-platform-behavior`.

### Use Vercel system URL variables only as origin allowlist inputs

- Rule: Treat `VERCEL_PROJECT_PRODUCTION_URL`, `VERCEL_BRANCH_URL`, and `VERCEL_URL` as origin strings, not secrets.
- Why: preview and production deployments need generated-domain validation.
- Code/source/confidence: allowed origins include those variables in `api/gemini.ts:326`; local dev origins are non-production only in `api/gemini.ts:338`; source: https://vercel.com/docs/environment-variables/system-environment-variables; confidence: `documented-platform-behavior`.

### Keep client timeout below function duration

- Rule: Browser AI calls should time out before Vercel returns a platform timeout.
- Why: AI UI needs typed timeout handling rather than HTML/opaque failures.
- Code/source/confidence: client timeout is 55 seconds in `src/lib/aiHttpClient.ts:15`; function max duration is 60 seconds in `vercel.json:3`; timeout maps to `UpstreamTimeoutError` in `src/lib/aiHttpClient.ts:133`; confidence: `verified-in-code`.

### Keep the Vercel fetch wrapper shape

- Rule: Preserve the default `{ fetch: handler }` exports unless the Vercel runtime contract changes.
- Why: Vite dev imports named handlers, while deployment uses default function wrappers.
- Code/source/confidence: Gemini wrapper is `api/gemini.ts:724`; token wrapper is `api/gemini-token.ts:5`; source: `scratchpad/relay-out/registers/decisions-gotchas.md`; confidence: `verified-in-code`.
