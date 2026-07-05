# Audio and presentation audit — mobile focus (2026-07)

Audited 2026-07-05 against `main` at `dff68e2` (post quality-pass
PR #11), prompted by owner testing of the deployed app: AI features
down, audio/video bugs persisting on real devices.

**Method.** Eight audit dimensions, each investigated by an
independent agent reading the full code surface (with platform claims
checked against MDN/WebKit/W3C/Chrome docs); every finding then
adversarially re-verified by a separate agent instructed to refute it;
plus one dynamic pass (`npm run smoke:browser`, build, typecheck — all
green) and direct reproduction where possible. The companion
production incident is `docs/audits/2026-07-gemini-500-incident.md`.
Fix plan and sequencing: `docs/NEXT-STEPS.md`.

**Result.** 33 findings: 27 confirmed at severity, 5 confirmed with
corrections/downgrades, 1 reduced to cosmetic. None refuted. The local
code health is good (223 unit tests, 3 Playwright smoke tests, clean
build/typecheck/audit); the pain is concentrated in platform behavior
that unit tests cannot see.

## The two highest-impact facts

1. **The mobile ergonomics pass never shipped.** The built CSS contains
   zero `(pointer: coarse)` rules: Tailwind 3.4 has no
   `pointer-coarse:`/`any-pointer-coarse:` variants and
   `tailwind.config.js` defines none. All touch-target sizing,
   tap-visible re-record/column-remove affordances, and the camera
   Flip button (`hidden any-pointer-coarse:flex`) are inert on phones.
   Verified directly by inspecting `dist/assets/*.css`.
2. **Web Audio plays through an undeclared iOS audio session.** The
   app never sets `navigator.audioSession.type`; per WebKit, the
   default ambient session is muted by the ringer switch. A phone on
   silent plays nothing while the UI advances — indistinguishable from
   "the app is broken". (WebKit bug 237322; MDN Audio Session API.)

## Findings summary

Severity after verification. P0 breaks core use; P1 badly degrades;
P2 polish/edge; P3 cosmetic. "Where" is the primary location only —
full evidence chains live in the per-dimension sections of the source
reports and the verdicts (session artifacts); each row was re-verified
independently.

| # | Sev | Dimension | Finding | Where |
|---|-----|-----------|---------|-------|
| 1 | P0* | ui-mobile | `pointer-coarse:`/`any-pointer-coarse:` classes not emitted; mobile tap sizing, tap affordances, camera Flip all inert | `tailwind.config.js` |
| 2 | P1 | pwa | No `navigator.audioSession.type`; iOS silent switch mutes all Web Audio output | `src/lib/audio.ts:28` |
| 3 | P1 | audio-lifecycle | AudioContext `interrupted`/`suspended` never reconciled; playback state lies after calls/Siri/route changes | `src/lib/audio.ts:163` |
| 4 | P1 | audio-lifecycle | Playback doesn't claim the audible-action gate before awaiting `Tone.start()`; interleaving taps race | `src/lib/audio.ts:185` |
| 5 | P1 | capture | Countdown overlay runs its own clock, starts before permissions/stream/audio are ready; users perform before capture starts | `src/lib/recordingFlow.ts:87` |
| 6 | P1 | capture | WebAudio sidecar keeps recording during MediaRecorder flush; audio length can outrun video and derived trims | `src/lib/recorder.ts:109` |
| 7 | P1 | capture | Camera Flip is a no-op once a `videoDeviceId` is selected/persisted (deviceId beats facingMode) | `src/lib/media.ts:24` |
| 8 | P1 | capture | Track `mute`/`unmute` unhandled (only `ended`); muted-but-live capture records silence/black as healthy | `src/lib/streamLifecycle.ts:39` |
| 9 | P2 | capture | Poster capture waits on `loadeddata` (never fires w/ mobile data-saver) and blocks the save path up to 1.5s | `src/lib/posterFrame.ts:82` |
| 10 | P1 | av-sync | Renderer paints from `Tone.now()` (includes 0.1s lookahead) and mutates displayed clip in Transport callbacks → cuts land early | `src/lib/videoEngine.ts:249` |
| 11 | P1 | av-sync | 80ms video pre-seek path is dead in normal playback; seek+play collapse to the cut instant → late/stale/black first frames on mobile | `src/lib/videoEngine.ts:121` |
| 12 | P1 | av-sync | Clips past trim-end still hold the same-tier ducking lock → black viewport while candidates are suppressed | `src/lib/videoEngine.ts:210` |
| 13 | P1 | av-sync | `drawImage` on metadata-ready-but-undecoded video can throw and kill the rAF loop; canvas cleared before readiness check | `src/lib/videoEngine.ts:283` |
| 14 | P1 | export | Render→save is one automatic anchor click; no Web Share, no second gesture, URL revoked on 0ms timer — weak on iOS/standalone | `src/lib/export.ts:177` |
| 15 | P1 | export | Real-time export dies on any page-hide (screen lock included); no wake lock, no preflight warning | `src/lib/streamLifecycle.ts:86` |
| 16 | P3 | export | Export MP4 MIME candidates narrower/staler than recording probe (`h264,aac` missing); option/label gap, not a blocker on the floor | `src/lib/exportFormats.ts:12` |
| 17 | P1 | interruption | `resumeMedia()` not single-flight; double-tap or reconnect-during-countdown races can clobber a good stream to `denied` | `src/lib/media.ts:117` |
| 18 | P2 | interruption | Only `visibilitychange` wired; no `pagehide`/`pageshow`/bfcache reconciliation of held streams | `src/lib/streamLifecycle.ts:106` |
| 19 | P1 | interruption | Lifecycle suspension never calls `cancelCurrentRecording()`; hidden-during-countdown unwinds via timers into stuck UI/generic errors | `src/lib/streamLifecycle.ts:97` |
| 20 | P1 | pwa | iOS Add-to-Home-Screen storage partition makes an existing Safari project look deleted; install hint shown regardless of clips | `src/components/RecordingStation.tsx:315` |
| 21 | P1 | pwa | `storage.persist()` result ignored; Safari 7-day eviction and denial present as a clean first run — silent project loss | `src/lib/install.ts:75` |
| 22 | P2 | pwa | Offline AI actions surface raw `Failed to fetch`; no offline copy or control annotation | `src/lib/aiHttpClient.ts:105` |
| 23 | P1 | persist | Fresh recordings depend on a 500ms debounce for durability; no flush on hide/pagehide; lock the phone → newest clip gone | `src/lib/autoSave.ts:41` |
| 24 | P1 | persist | Recovery backup clones every blob (full second copy) before restoring; quota failure blocks restoring a readable project | `src/lib/persistence.ts:88` |
| 25 | P1 | persist | Missing IndexedDB project (eviction) indistinguishable from first run; no durability state, no warning | `src/lib/rehydrate.ts:338` |
| 26 | P2 | persist | Legacy clips without WAV sidecar are dropped wholesale on decode failure and the loss autosaved (WebKit WebM/Opus risk is historical/unproven on 18.4+) | `src/lib/rehydrate.ts:379` |
| 27 | P2 | ui-mobile | Hero canvas is a 480px bitmap stretched across 3x-DPR screens — visibly soft (display should be DPR-scaled; export surface stays 480) | `src/components/Viewport.tsx:93` |
| 28 | P2 | ui-mobile | Safe-area padding sits on `body` outside the dark shell → white gutters on notched phones, avoidable scroll | `src/index.css:72` |
| 29 | P2 | ui-mobile | Edge-anchored 288px popovers can clip off narrow viewports once the header wraps | `src/components/ExportButton.tsx:119` |
| 30 | P2 | ui-mobile | Flow/Cut selects, format radios, range thumbs remain well under 44px even after #1 is fixed | `src/components/FlowSelector.tsx:25` |
| 31 | P3 | audio-lifecycle | Visible-page `void Tone.start()` is a non-gesture, unchecked resume attempt; harmless but reports nothing | `src/lib/streamLifecycle.ts:103` |
| 32 | P0 | ai/deploy | `/api/gemini-token` crashes (`FUNCTION_INVOCATION_FAILED`) before its method guard; all AI features down (see incident report) | `vercel.json` |
| 33 | P0 | ai/deploy | Production limiter env unset → `limiter-unconfigured` fail-closed even once the crash is fixed (see incident report) | Vercel env |

\* P0 in effect: it silently disables an entire shipped feature set on
the platform it was built for.

### Corrections applied during verification

- **#8 (track mute):** the code gap is confirmed on any browser that
  leaves tracks live-but-muted; the specific "iOS call leaves tracks
  muted not ended" scenario could not be pinned to current official
  docs — treat as needs-real-device-check.
- **#16 (export MIME):** downgraded — Safari 18.4+ also records WebM,
  so the floor keeps a working export; the real defect is one stale,
  inconsistent candidate list across recording/export.
- **#18 (pagehide):** downgraded — the existing `visibilitychange`
  hidden handler already covers common app-switch paths; the gap is
  bfcache/frozen-restore reconciliation.
- **#26 (legacy WebM):** destructive drop-on-decode-failure is
  confirmed and test-pinned; the underlying WebKit decode failure is
  historical (Safari 15–17), unproven on 18.4+.
- **#31:** reduced to cosmetic; explicit user actions re-run
  `ensureAudioStarted()` anyway.

## What is solid (verified OK)

The audit deliberately recorded what it could *not* break. Highlights,
each checked in code and mostly pinned by tests:

- Every audible entry point (play, pads, keys, record, export) is
  gesture-backed and checks the shared gate; recording and export
  claim their state synchronously before awaits.
- Export ownership is exclusive and owner-scoped: overlapping exports
  are rejected, cleanup is owner-only, `isExporting` cannot be left
  stuck by a failed export; project mutations freeze during export at
  the store level.
- The recording pipeline releases previous streams before acquiring,
  handles stale device IDs with fallback+retry, cancels cleanly on
  Esc (no partial clips), and persists a WAV audio sidecar so mobile
  MediaRecorder blob flakiness no longer loses playback audio after
  reload.
- iOS/Safari MP4 recording works through the ordered MIME probe;
  bare (soft) constraints avoid `OverconstrainedError` on portrait
  phones; echo/feedback from the WebAudio tap is prevented.
- Rehydrate is schema-versioned and defensive (legacy v0 migration,
  per-entry step validation, trim clamping, tag pruning); load
  failures pause autosave with a visible recovery banner; object URLs
  are revoked on every replacement path.
- The service worker precaches build-injected assets, normalizes
  reload cache keys, keeps `/api/` network-only, deletes old caches,
  and survives cache-open/put failures; verified against a fresh
  production build and by the offline-reload smoke test.
- The hardened Gemini proxy validates origin/Fetch-Metadata/tokens
  before spending, caps body size under Vercel's platform limit, maps
  config failures to non-retryable client errors, and refreshes stale
  tokens once on 401 — all test-pinned. (Its deployment config is what
  failed; see the incident report.)

## Reading the evidence

The full per-dimension reports (findings with failure scenarios and
suggested fixes, plus complete Verified-OK lists with file:line and
platform sources) and the three adversarial verdict files are session
artifacts from the audit run. Their durable outputs are this summary,
the incident report, `docs/PLATFORM-QUIRKS.md` (the generalized
rules), and the prioritized fix plan in `docs/NEXT-STEPS.md`. When a
fix lands, update the corresponding row here (strike it through with a
commit reference) so this document stays the audit of record.
