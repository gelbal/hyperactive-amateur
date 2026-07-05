# Hyperactive Amateur

A browser-based step sequencer for making hard-cut sample-from-yourself
videos. Record eight short clips of yourself making sounds, drop them
on a 16-step grid, hit play, and watch a hip-hop video of you
"performing" the song play back in real time. Export to WebM by
default on Chromium browsers, with MP4 used where the browser exposes
that MediaRecorder path.

Live at [hyperactive-amateur.fgelbal.com](https://hyperactive-amateur.fgelbal.com/).

## Quick start

```bash
# requires Node 20.19+ or 22.12+
npm install
cp .env.example .env.local        # add your Gemini key, see below
npm run dev                       # http://localhost:5173
```

You'll be prompted for camera and microphone access on first record.

## Documentation

Contributors and AI agents: start with [`AGENTS.md`](AGENTS.md), then

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — subsystem map,
  invariants, and a "where would I look if..." symptom index
- [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md) — setup, testing,
  debugging, deploy + production env contract, post-deploy probes
- [`docs/PLATFORM-QUIRKS.md`](docs/PLATFORM-QUIRKS.md) — the
  browser/OS gotcha register (read before touching media code)
- [`docs/NEXT-STEPS.md`](docs/NEXT-STEPS.md) — current priorities and
  roadmap
- [`docs/audits/`](docs/audits/) — verified audit findings and
  incident reports

## Validation

```bash
npm test
npm run build
npm run smoke:browser
npm audit --audit-level=moderate
```

`npm run smoke:browser` builds the production bundle, starts Vite
preview, and runs Playwright smoke tests. On macOS it uses system
Chrome by default; CI can install Playwright Chromium and unset
`PLAYWRIGHT_CHANNEL`.

**Supported browsers:** desktop Chrome and Edge ≥120, recent Firefox,
iOS Safari 18.4+ (March 2025), current Android Chrome, and any
WebKit-engine iOS browser (Firefox, Chrome, Edge, Brave). The in-app
compatibility banner feature-detects what the active browser actually
supports.

**On mobile:** tap Share → Add to Home Screen (iOS Safari) or the
in-browser install prompt (Android Chrome) to run it like a native
app. The service worker caches the app shell so subsequent launches
are instant, and production builds inject the emitted `/assets/`
JS/CSS into the install-time precache so offline reloads can boot the
current bundle after the first load. Later same-origin assets are still
runtime-cached as a fallback. `/api/` stays network-only. New
production builds replace the service worker cache name with a build
hash, call `skipWaiting()` / `clients.claim()`, and delete older
`ha-shell-*` caches on activation; if a bad service-worker deploy ever
ships, a new build with changed `index.html` asset hashes forces a
fresh cache.

## API key

The "Suggest a beat", variation buttons (Busier / Fill / Half-time /
Strip), and clip auto-tagging all run on Gemini Flash. Get a free
key at [aistudio.google.com/app/apikey](https://aistudio.google.com/app/apikey)
(Google AI Studio key, **not** a Google Cloud key) and put it in
`.env.local`:

```
GEMINI_API_KEY=AIza...
```

The key stays server-side — a tiny Vite middleware in dev (and a Vercel
function in production) reads it from `process.env` and proxies calls
through `/api/gemini`. It never reaches the client bundle.

Without a key the rest of the app works fine; AI features just go
quiet.

### Production AI proxy settings

Production deploys fail closed unless the Gemini proxy has both an
allowed origin and a durable rate-limit backend. In Vercel, set:

```
GEMINI_API_KEY=...
GEMINI_ALLOWED_ORIGINS=https://hyperactive-amateur.fgelbal.com
UPSTASH_REDIS_REST_URL=...
UPSTASH_REDIS_REST_TOKEN=...
```

Vercel KV's `KV_REST_API_URL` and `KV_REST_API_TOKEN` aliases work in
place of the Upstash names. The limiter URL must be HTTPS in production.
`GEMINI_RATE_LIMIT_MAX` and `GEMINI_RATE_LIMIT_WINDOW_SECONDS` are
optional; they default to 60 requests per 10 minutes per route bucket
and client identity. Production browser calls also fetch a short-lived
signed request token from `/api/gemini-token`; by default that token is
signed with `GEMINI_API_KEY`, or you can set
`GEMINI_REQUEST_TOKEN_SECRET` separately. In production, token issuance
and token spending also require browser Fetch Metadata for a same-origin
request, so a browser page on another origin cannot mint tokens merely
by setting an `Origin` value. Token issuance, invalid-token attempts,
and Gemini spends are all rate-limited. The durable limiter remains the
control for non-browser traffic. The proxy also accepts Vercel's
`VERCEL_PROJECT_PRODUCTION_URL`, `VERCEL_BRANCH_URL`, and `VERCEL_URL`
as allowed origins when the platform provides them, but custom domains
should still be listed in `GEMINI_ALLOWED_ORIGINS`.

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
