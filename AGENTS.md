# AGENTS.md — working on Hyperactive Amateur

Guidance for AI coding agents and new contributors. Humans: start here
too, then read `docs/DEVELOPMENT.md`.

Hyperactive Amateur is a browser step sequencer for making hard-cut
sample-from-yourself music videos: record eight short camera+mic
clips, sequence them on an 8×16 grid, play back as a hard-cut video on
a canvas, export to MP4/WebM. React 18 + TypeScript + Vite 8 + Zustand
+ Tone.js v15 + Tailwind 3.4. Persists to IndexedDB. Installable PWA.
Deployed on Vercel with a hardened Gemini proxy for the AI features.
Live at <https://hyperactive-amateur.fgelbal.com>.

## Read this before coding

| Doc | What it gives you |
| --- | --- |
| `docs/ARCHITECTURE.md` | Subsystem map, data flow, invariants, "where would I look if..." index |
| `docs/DEVELOPMENT.md` | Setup, commands, testing, debugging playbook, deploy + env contract |
| `docs/PLATFORM-QUIRKS.md` | Browser/OS gotchas (iOS Safari, MediaRecorder, Web Audio, PWA) — read before touching any media code |
| `docs/NEXT-STEPS.md` | Current priorities: production fixes, verified bugs, roadmap |
| `docs/audits/2026-07-audio-mobile-audit.md` | Verified open findings in the media/mobile surface |
| `docs/quality-pass/status.md` | What the 2026-06 hardening pass changed and why |
| `.claude/` | Git-ignored local planning docs (specs, build plans, PRODUCT.md). May be absent in a fresh clone; everything load-bearing is in `docs/`. |

## Validation loop

Every change lands green through all of these — run them locally, in
this order (details in `docs/DEVELOPMENT.md`):

```bash
npm test                          # vitest; 41 files+, all green, NO stray console output
npm run build                     # tsc -b + vite build
npm run smoke:browser             # Playwright smoke against the production build
npm audit --audit-level=moderate  # must report 0 vulnerabilities
```

Notes that catch people out:

- The test setup **fails tests on unexpected `console.error` and React
  `act(...)` warnings** (`src/test-setup.ts`). Pristine output is a
  hard requirement, not a style preference.
- Unit tests stub all media APIs; they cannot prove real-device
  behavior. Anything touching capture/playback/export also needs the
  real-device checklist in `docs/DEVELOPMENT.md`.
- Node 20.19+ or 22.12+ (`package.json` engines).

## Hard invariants — do not break these

1. **Single clock.** Everything audible or visible is timed from the
   audio context clock (`Tone.now()` / `audioContext.currentTime`) —
   never `performance.now()`, never rAF timestamps. (Known nuance:
   `Tone.now()` includes lookahead; see the audit before "fixing".)
2. **The canvas backing store stays 480×480.** `canvas.captureStream()`
   records it, so its size is the export contract. Display size is CSS.
   If you need a sharper on-screen canvas, split display from export
   surfaces — never just bump the attribute size.
3. **Every audible entry point goes through
   `canStartAudibleAction()`** (`src/lib/audibleActionGate.ts`) and
   claims its state synchronously *before* the first `await`. Playback,
   pads, keyboard, recording, export — all of them. A new button that
   makes noise must do the same.
4. **Project mutations freeze during export.** Store writers no-op when
   `isExporting`; UI controls must also *look* disabled. Export owns an
   exclusive session (`src/lib/exportSession.ts`); only the owner cleans up.
5. **All stream lifecycle transitions go through
   `src/lib/streamLifecycle.ts`.** Don't scatter `track.onended` /
   `visibilitychange` handlers around components.
6. **Persistence is schema-versioned.** Any change to persisted shapes
   (`src/lib/persistence.ts`, `src/types.ts`) needs a migration in
   `src/lib/rehydrate.ts` plus tests, and must keep the recovery-backup
   path working. Loop lengths stay multiples of 4.
7. **The service worker cache name derives from the build hash**, and
   `/api/` stays network-only. The precache list is injected at build
   time by `vite.config.ts` — verify `dist/sw.js` after touching either.
8. **API keys never reach the client.** All Gemini traffic goes through
   `/api/gemini` (+ `/api/gemini-token`); production fails closed
   without its env contract (see `docs/DEVELOPMENT.md`).
9. **Feature-detect, never UA-sniff.** Supported floor: desktop
   Chrome/Edge ≥120 and recent Firefox, iOS Safari 18.4+, current
   Android Chrome, WebKit-engine iOS browsers.
10. **Non-destructive trims.** Clip blobs are immutable; trim points are
    metadata used at play/draw time.

## Conventions

- Every code file starts with a two-line `ABOUTME:` comment describing
  what it does.
- TDD: write the failing test first; every step ends with the full
  suite green.
- Conventional commits (`fix(media): …`, `docs(mobile): …`), imperative
  mood, no AI attribution or marketing.
- Match the style of surrounding code; smallest reasonable change; no
  drive-by refactors — file an issue or note it in `docs/NEXT-STEPS.md`
  instead.
- Never introduce mock modes into app code; mocks live in tests only.
- `docs/` is committed and canonical. `.claude/` is git-ignored
  local planning material.

## Quick orientation

```
src/store/useAppStore.ts   Zustand store: project, playback, media, recording, session slices
src/lib/audio.ts           Tone.js transport, players, triggers, ensureAudioStarted()
src/lib/videoEngine.ts     hard-cut renderer: hidden <video>s -> canvas, priority + hold rules
src/lib/recordingFlow.ts   countdown -> recordClip() -> autoTrim -> poster -> setTrackClip
src/lib/recorder.ts        MediaRecorder + WebAudio sidecar capture (mobile reliability)
src/lib/export.ts          canvas.captureStream + destination tap -> MediaRecorder render
src/lib/streamLifecycle.ts suspended-state machine: track end, page hide, recorder errors
src/lib/rehydrate.ts       schema-versioned load, repair + recovery backup
api/gemini.ts              hardened Gemini proxy (origin allowlist, tokens, rate limits)
public/sw.js               app-shell service worker (build-time precache injection)
```

When in doubt about a symptom, use the "where would I look if..."
index at the end of `docs/ARCHITECTURE.md`.
