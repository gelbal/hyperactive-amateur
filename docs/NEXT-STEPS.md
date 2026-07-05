# Next steps

Written 2026-07-05, against `main` at `dff68e2`. This is the working
priority list for whoever picks the project up: what is broken in
production right now, which bugs have been verified in the code, and
where the product should go next. Pair it with:

- `docs/audits/2026-07-audio-mobile-audit.md` — the verified findings
  behind Part 2, with file:line evidence.
- `docs/audits/2026-07-gemini-500-incident.md` — live-probe root cause
  behind Part 1.
- `docs/DEVELOPMENT.md` — env contract, post-deploy probes, real-device
  checklist referenced throughout.
- `AGENTS.md` — how to work on this repo at all.

Status labels: **[verified]** = confirmed by adversarial review or
direct reproduction; **[likely]** = strong code evidence, needs a
real-device check to be certain.

## Part 1 — Restore the deployed app (P0, hours)

The deployed app's AI features are fully down, and a chunk of the
mobile UX never shipped despite being in the source. Do these first;
all three are small.

### 1.1 Fix the `/api/gemini-token` function crash [verified]

Every AI call mints a token first, so this one crash takes down
Suggest, Variations, and auto-tagging with
`Gemini proxy 500: ... FUNCTION_INVOCATION_FAILED`. Live probes show
`/api/gemini-token` crashes before its method guard on both GET and
POST while `/api/gemini` (same module, same export shape) works — the
one asymmetry is that `vercel.json` configures only `api/gemini.ts`.

- Add `api/gemini-token.ts` to `vercel.json` `functions` with the same
  config as `api/gemini.ts` (`maxDuration: 60`).
- Wrap both exported handlers in a crash boundary that returns
  `503 {"error":"proxy-internal-error"}` (no secrets) and
  `console.error`s a route label — a config regression should never
  surface as a Vercel plain-text crash again.
- Optionally add named method exports (`export const GET/POST = ...`)
  alongside the `{ fetch }` default, per Vercel's documented handler
  shapes.
- Add a regression test that imports the actual entry modules
  (`api/gemini-token.ts` default export shape), not just the named
  handler.
- After deploying, check the Vercel runtime logs for the captured
  request IDs and run the post-deploy probes in `docs/DEVELOPMENT.md`.

### 1.2 Configure the production environment [verified]

Behind the crash there is a second, independent blocker: live
`POST /api/gemini` returns `503 {"error":"limiter-unconfigured"}`.
The proxy fails closed in production without a durable rate limiter.
`GEMINI_API_KEY` and origin config are already correct in production.

Set in Vercel (Production, and Preview if AI should work there):

```
UPSTASH_REDIS_REST_URL=https://...   # or KV_REST_API_URL
UPSTASH_REDIS_REST_TOKEN=...         # or KV_REST_API_TOKEN
GEMINI_REQUEST_TOKEN_SECRET=<openssl rand -base64 32>
```

The limiter URL must be HTTPS. Full contract and expected fail-closed
statuses: `docs/DEVELOPMENT.md` "Deploy to Vercel".

### 1.3 Revive the coarse-pointer CSS [verified]

The built CSS contains **zero** `(pointer: coarse)` rules: Tailwind
3.4 has no `pointer-coarse:`/`any-pointer-coarse:` variants and
`tailwind.config.js` defines none, so every touch-specific class in
the codebase is silently inert. On phones this currently disables the
44px tap-target pass, the tap-visible re-record and column-remove
affordances, and the camera Flip button entirely.

- Define the variants in `tailwind.config.js`
  (`addVariant("pointer-coarse", "@media (pointer: coarse)")` and
  `addVariant("any-pointer-coarse", "@media (any-pointer: coarse)")`),
  or replace the classes with plain CSS under those media queries.
- Add a build regression: assert the generated CSS contains
  `(pointer: coarse)` (a small script or test against `dist/`), so a
  future Tailwind upgrade cannot silently drop it again.
- Then re-run the real-device checks: Flip button visible, step cells
  44px, re-record reachable by tap.

## Part 2 — Verified media and mobile fixes (P1, the next few PRs)

These came out of an eight-dimension audit of the media surface with
adversarial verification of each finding. Full evidence in
`docs/audits/2026-07-audio-mobile-audit.md`. Grouped so each group is
one coherent PR.

### 2.1 Dead or silent audio on iOS (the "audio bugs persist" cluster)

1. **Declare the iOS audio session.** [verified] Web Audio output can be
   muted by the silent switch and misrouted after mic sessions when
   the page never declares intent. Where `navigator.audioSession`
   exists, set `type = "play-and-record"` while holding the mic and
   `"playback"` for playback/export; show a "check your silent switch"
   hint when audio starts but the API is absent.
2. **Own the AudioContext lifecycle.** [verified] Nothing listens for
   the context leaving `running` (iOS `interrupted` on calls/Siri/
   route changes), so the app can believe it is playing while audio is
   dead, and the stop button becomes the only way out. Add a single
   `statechange` owner: on `suspended`/`interrupted` during
   playback/export, stop the Transport, clear `isPlaying`, abort
   export, surface "tap to resume audio"; verify `state === "running"`
   after every `Tone.start()`.
3. **Make playback claim the gate before its first await.** [verified]
   `startPlayback()` awaits `Tone.start()` before flipping
   `isPlaying`, so a second tap (e.g. Record) can interleave during a
   slow unlock. Claim a `playback.starting` flag synchronously, include
   it in `canStartAudibleAction()`, re-check state after the await —
   recording and export already follow exactly this pattern.

### 2.2 Recording you can trust on a phone

1. **Tie the visible countdown to actual capture start.** [verified]
   The overlay counts down on its own interval, started before
   permissions/audio/stream acquisition; the real countdown starts
   after. Users perform into a window that isn't recording yet. Split
   `preparing` from `countdown` and start the visible count from the
   same timer that gates `recordClip()`.
2. **Handle track `mute`, not just `ended`.** [verified] The
   lifecycle owner only listens for `ended`, so any muted-but-live
   capture records silence/black as if healthy. (Whether iOS calls
   mute rather than end tracks on 18.4+ needs a real-device check —
   handle both.) Attach `mute`/`unmute` alongside
   `ended`; abort an in-flight recording on mute; route preview mute
   to the reconnect path.
3. **Clamp the audio sidecar to the capture window.** [verified] The
   WebAudio tap keeps collecting while MediaRecorder flushes, so
   stored audio can outrun the video and derived trims. Crop the
   captured buffer to the requested window and store actual (not
   requested) duration.
4. **Make Flip actually flip once a deviceId is pinned.** [verified]
   A persisted Sources-picker camera silently wins over
   `facingMode`; Flip then only blinks the preview. Clear
   `videoDeviceId` when flipping (or map to the opposite camera's
   device).
5. **Stop blocking the save path on poster capture.** [verified]
   Poster extraction waits on `loadeddata` (which never fires with
   mobile data-saver) and holds the recording overlay up to 1.5s.
   Save the clip first; generate posters async with
   `loadedmetadata`/`requestVideoFrameCallback` fallbacks.

### 2.3 Cuts that look right (the "video bugs" cluster)

1. **Draw from audible time, not scheduling time.** [verified — desktop
   too] The renderer paints from `Tone.now()` (includes lookahead) and
   mutates the displayed clip inside Transport callbacks that run
   ahead of the audible boundary, so cuts land early. Schedule visual
   state changes via `Tone.getDraw().schedule(...)` and drive
   `drawCurrentFrame()` from `Tone.immediate()`; guard negative
   elapsed times.
2. **Pre-seek hidden videos before the beat.** [verified] The 80ms
   video lookahead path is effectively dead in normal playback — seek
   and play collapse to the cut instant, which is where mobile decode
   latency shows as late/stale/black first frames. Schedule a video
   pre-roll at `time - LOOKAHEAD_S` from the transport path.
3. **Don't let expired clips block same-tier cuts.** [verified] A clip
   whose trimmed visual window has ended still holds the hold-time
   lock, so the viewport shows black while a same-tier candidate is
   suppressed. Treat `current` as gone once past its trim end.
4. **Guard `drawImage` against undecoded frames.** [verified] One
   `InvalidStateError` inside the rAF callback kills the render loop
   until remount (metadata-ready ≠ frame-ready on slow mobile decode).
   Require `readyState >= HAVE_CURRENT_DATA`, don't clear until the
   replacement is drawable, wrap the draw in try/catch.
5. **DPR-aware display canvas.** [verified, P2] The hero canvas is a
   480px bitmap stretched over a 3x-DPR phone screen — visibly soft.
   Render display at `cssSize × devicePixelRatio` while keeping a
   fixed 480×480 export surface (the export contract must not change).

### 2.4 Export that survives a phone

1. **Offer Web Share, and split render from save.** [verified] The
   only handoff is a programmatic anchor download fired after an
   await — weak on iOS, worse in standalone. Keep the finished blob in
   state, show explicit Share/Download buttons, use
   `navigator.canShare({files})`/`share()` from the user's tap, revoke
   the URL later.
2. **Hold a wake lock and warn about backgrounding.** [verified]
   Real-time export means a 32-second phone render dies if the screen
   locks (page-hide aborts it by design). Request a Screen Wake Lock
   during export and say "keep this screen open"; make the abort
   message actionable.
3. **Unify recording/export MIME probes.** [verified, low severity]
   Export probes a narrower, staler MP4 list than the recording
   support probe (`h264,aac` missing). Safari 18.4+ also records WebM
   so export stays available on the floor, but the inconsistent lists
   can hide or mislabel the MP4 option. Share one ordered candidate
   list; label by what the recorder actually reports.

### 2.5 Projects that survive (storage durability)

1. **Make a finished recording a durability boundary.** [verified] A
   fresh clip only reaches IndexedDB via a 500ms debounce; lock the
   phone at the wrong moment and it is gone. Save immediately after
   `setTrackClip()`, and flush pending saves on
   `visibilitychange`/`pagehide`.
2. **Stop doubling media in the recovery backup.** [verified] Degraded
   rehydrate writes a full second copy of every blob before restoring;
   near quota this fails and blocks restoration of a readable project.
   Reference blobs instead of cloning; cap backup bytes; on backup
   failure restore read-only with autosave paused.
3. **Surface storage durability.** [verified] `persist()` results are
   ignored and eviction (Safari's 7-day rule for non-installed sites)
   presents as a clean first run — users lose projects "silently by
   design". Track `persisted()` state, warn when clips exist without
   durability, and pair with 3.1's export/import as the real fix.
4. **Warn about the iOS install storage split.** [verified] Add to
   Home Screen creates a separate storage partition; installing after
   recording makes the project look deleted. Warn when clips exist and
   the install hint is shown; the transfer path is 3.1.
5. **Keep undecodable legacy clips instead of dropping them.**
   [verified] The destructive drop-then-autosave behavior is real and
   test-pinned; the WebKit WebM/Opus decode failure that triggers it
   is historical (Safari 15-17) and unproven on 18.4+. Keep the clip
   in a "needs audio repair" state and don't autosave destructively.

### 2.6 Interruption robustness

1. **Single-flight `resumeMedia()`.** [verified] Double-tapping the
   reconnect pill (or reconnecting during a queued recording) races
   two `getUserMedia` calls; a stale failure can clobber a good
   stream with `denied`. Add an acquire token/generation and disable
   the pill while recording is active.
2. **Handle `pagehide`/`pageshow` and bfcache.** [verified, P2]
   Only `visibilitychange` is wired (it does cover common app-switch
   paths); the gap is bfcache/frozen-restore, which can revive the
   page with a dead stream still marked `granted`. On `pageshow`,
   reconcile track liveness before trusting held streams.
3. **Cancel in-flight recording on lifecycle suspension.** [verified]
   Page-hide stops the stream but leaves the recording flow to unwind
   through timers, so returning users see a stuck countdown or a
   generic error. Route lifecycle interruptions through
   `cancelCurrentRecording()` with a specific "recording interrupted"
   reset.

### 2.7 Smaller presentation fixes (P2, batch into any UI PR)

- Safe-area padding sits on `body` outside the dark app shell — white
  gutters on notched phones; move background/padding onto the shell.
- Header popovers (`min-w-[18rem]`, edge-anchored) can clip off a
  narrow viewport once the header wraps; clamp to viewport or use
  fixed positioning on small screens.
- Flow/Cut/format-picker controls sit under 44px even after 1.3;
  give form controls a shared `min-h-11` treatment on coarse pointers.
- Offline AI actions surface raw `Failed to fetch`; map transport
  errors to "AI needs an internet connection" and annotate the buttons
  when `navigator.onLine === false`.

## Part 3 — Advance the product (after the floor is solid)

Ordered by product leverage over effort, drawing on the v1 spec
roadmap, the v1.1 "after" list, PRODUCT.md's deferred set, and the
issues that keep resurfacing in session history.

1. **Project export/import (a `.hyperactive` file).** One ZIP of
   project JSON + clip blobs. This is not just a feature — it is the
   real fix for storage eviction, the iOS install storage split, and
   device-to-device moves, and it unlocks sharing beats as editable
   projects, not just rendered videos. Do this before any cloud/auth
   thinking.
2. **Long-take recording.** Record one 20–30s take, auto-chop on
   transients (the `autoTrim` RMS machinery generalizes), let the user
   assign chops to pads. Collapses the eight-recordings friction that
   is the biggest drop-off risk on phones — and it is the original
   Gjertsen workflow.
3. **Arrangement mode.** Chain patterns (A/A/B/A) into a song.
   Deferred in both spec rounds; it is the gap between a toy loop and
   a shareable track. Keep it dumb: a pattern list with per-pattern
   bars, one tap to duplicate-and-vary (the variation engine already
   exists).
4. **Demo project.** Ship one pre-recorded project (a few MB) behind a
   "load demo" button on the empty state. First-session comprehension
   without a tutorial — the empty-grid cold start is still the worst
   onboarding moment. (Open question in the v1 spec; still true.)
5. **WebCodecs export.** Faster-than-realtime MP4 rendering removes
   the whole "keep the screen on for 32 seconds" class of pain and
   makes 8-bar exports viable on phones. Safari 18.4 has what's
   needed; keep MediaRecorder as fallback. Pairs naturally with 2.4.
6. **Grid view (Incredibox-style).** Alternate draw routine over the
   same trigger stream — the renderer was explicitly architected for
   this swap. Good medium-size feature for a new contributor.
7. **Manual trim UI.** Drag handles on the clip waveform; trim data is
   already non-destructive metadata.
8. **Free-text tags with LLM-assigned priority.** The 5-tag taxonomy
   fails for table-thumps and bottle-caps; the tagging pipeline
   already returns reasoning — let it place custom tags in the
   priority order.
9. **Creative seasoning (small, on-brand):** cut-style presets
   (hold/priority/subdivision bundles with names like "Gjertsen",
   "Strobe", "Lazy Sunday"); a WAV stem export next to the video
   (beatmakers will sample themselves); MIDI input for the pads on
   desktop. All three are contained and reinforce the "instrument, not
   dashboard" personality — none adds a chatbot.

## Part 4 — Engineering platform (continuous)

- **CI is the biggest gap: there is none.** A GitHub Actions workflow
  running `npm test`, `npm run build`, `npm audit --audit-level=moderate`,
  and `npm run smoke:browser` (Playwright installs Chromium; unset
  `PLAYWRIGHT_CHANNEL`) on every PR would have caught the inert-CSS
  and doc-drift classes automatically. Add a `dist/` CSS assertion
  (1.3) and the entry-module test (1.1) to it.
- **Operation-specific Gemini endpoints.** The quality pass left this
  as its explicit follow-up: move prompt/schema construction
  server-side (`/api/suggest`, `/api/autotag`, ...) so the proxy stops
  accepting client-built Gemini bodies.
- **Decide the two accepted risks consciously:** production rate-limit
  identity falls back to a shared bucket when `x-vercel-forwarded-for`
  is missing; signed tokens have no nonce replay store. Either accept
  and document, or fix.
- **AudioWorklet migration.** The live capture tap rides deprecated
  `ScriptProcessorNode`; fine today, but plan the swap before browsers
  force it.
- **Real-device cadence.** The checklist in `docs/DEVELOPMENT.md`
  needs an owner and a rhythm (every media-touching PR, minimum:
  iPhone Safari record→play→export, Android Chrome install→record,
  silent-switch and phone-call interruption passes).
- **Telemetry decision.** Reliability work on mobile is flying blind
  without knowing how often suspension/interruption fires in the wild.
  It was deliberately deferred as a privacy question — decide it,
  don't let it linger.

## How to use this document

Work top-down. Part 1 is a single afternoon including deploys and
probes. Part 2 groups are PR-sized; each should land with tests plus
its real-device check, full validation loop green (`AGENTS.md`).
Re-verify Part 2 statuses against
`docs/audits/2026-07-audio-mobile-audit.md` before starting an item —
if a fix already landed, update both docs. Part 3 items each deserve a
short spec in `.claude/` (or `docs/`) in the style of
`.claude/v2-mobile/plan.md` before code: goal, scope, out-of-scope,
steps, test plan. That discipline is why this codebase is still easy
to hand off — keep it.
