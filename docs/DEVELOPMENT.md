# Development

This is the day-to-day working guide for Hyperactive Amateur. It is written for engineers and AI agents who need to make changes without the original author in the loop.

Source facts were checked against the repo at commit `dff68e2` on 2026-07-05. Live-incident citations refer to `docs/audits/2026-07-gemini-500-incident.md`. External platform notes are limited to the official docs listed near the end of this file.

## Set up the project

The app is a React 18, TypeScript, Vite 8, Zustand 5, Tone.js 15, and Tailwind 3.4 browser app. The package manifest pins those major surfaces in `package.json:21`, `package.json:24`, `package.json:25`, `package.json:40`, and `package.json:42`.

Use Node `^20.19.0 || >=22.12.0`. That requirement is enforced in `package.json:6` through `package.json:8` and repeated in the lockfile at `package-lock.json:38` through `package-lock.json:40`.

Install dependencies with:

```bash
npm install
```

Create local env from the example:

```bash
cp .env.example .env.local
```

The only required local value for AI features is:

```bash
GEMINI_API_KEY=...
```

`GEMINI_API_KEY` is intentionally server-side. `.env.example` describes it as a Vite-dev and Vercel runtime variable that never reaches the client bundle (`.env.example:4` through `.env.example:13`). The Vite dev middleware reads `.env.local`, writes `process.env.GEMINI_API_KEY` for the local API handler, and does not expose the key through `import.meta.env` (`vite.config.ts:11` through `vite.config.ts:14`, `vite.config.ts:27` through `vite.config.ts:30`, `vite.config.ts:136` through `vite.config.ts:143`).

Without `GEMINI_API_KEY`, the core sequencer, recording, playback, persistence, PWA shell, and export still run. AI features fail closed or quiet: the proxy returns `{"error":"no-key"}` (`api/gemini.ts:615` through `api/gemini.ts:618`, `api/gemini.ts:696` through `api/gemini.ts:698`), and the client maps that to `MissingApiKeyError` with a `.env.local` message (`src/lib/aiHttpClient.ts:84` through `src/lib/aiHttpClient.ts:87`, `src/lib/aiErrors.ts:11` through `src/lib/aiErrors.ts:18`).

The AI features that need the key are "Suggest a beat", pattern variations, per-clip auto-tagging, and batch re-tagging (`README.md:56` through `README.md:73`, `.env.example:4` through `.env.example:6`).

Local dev mounts both proxy routes:

```text
/api/gemini-token
/api/gemini
```

Those routes are mounted by the Vite plugin at `vite.config.ts:43` and `vite.config.ts:44` and use the same handler functions as production (`vite.config.ts:9`).

## Run the commands

The validation loop is:

```bash
npm test
npm run build
npm run smoke:browser
npm audit --audit-level=moderate
```

That loop is listed in README at `README.md:23` through `README.md:30`.

Run `npm run dev` for interactive development:

```bash
npm run dev
```

The script is `vite` (`package.json:9` through `package.json:10`). Default Vite serves on `http://localhost:5173` unless the port is taken; README uses that URL in `README.md:14` through `README.md:18`.

Green for `npm run dev` means the Vite server starts, the app boots, and local `/api/gemini` and `/api/gemini-token` are handled by the middleware. If `GEMINI_API_KEY` is absent, AI calls should surface the missing-key path rather than crashing.

Run the unit/integration suite once:

```bash
npm test
```

The script is `vitest run` (`package.json:14`). The quality-pass record for current main says the full suite passed as 41 files / 223 tests after the hardening pass (`docs/quality-pass/status.md:224` through `docs/quality-pass/status.md:228`).

Green for `npm test` means all Vitest tests pass with no unexpected console output. The test setup throws after each test if it sees a React `act(...)` warning or an unexpected `console.error` that does not begin with `[HA] ` (`src/test-setup.ts:24` through `src/test-setup.ts:31`, `src/test-setup.ts:48` through `src/test-setup.ts:57`).

Run the watch loop while developing narrow changes:

```bash
npm run test:watch
```

The script is plain `vitest` (`package.json:15`). It uses the same JSDOM setup and the same console-output guard as `npm test` because the setup file is configured in `vite.config.ts:144` through `vite.config.ts:148`.

Run the production build:

```bash
npm run build
```

The script is `tsc -b && vite build` (`package.json:11`). Green means TypeScript project references compile and Vite emits a production bundle.

After service-worker changes, inspect generated output, not just source:

```bash
npm run build
rg -n "%BUILD_HASH%|%PRECACHE_URLS%" dist/sw.js
rg -n "PRECACHE_URLS|ha-shell-" dist/sw.js
```

Green means the placeholder search returns no matches, and `dist/sw.js` has a concrete `ha-shell-*` cache name plus emitted `/assets/...` URLs. The build plugin replaces `%BUILD_HASH%` and injects emitted assets at `vite.config.ts:96` through `vite.config.ts:130`; the smoke report verified this behavior in generated output at `smoke-report.md:79` through `smoke-report.md:88`.

Run browser smoke:

```bash
npm run smoke:browser
```

The script builds first and then runs Playwright (`package.json:13`). The Playwright config serves Vite preview on `127.0.0.1:4173` by default (`playwright.config.ts:5` through `playwright.config.ts:7`, `playwright.config.ts:29` through `playwright.config.ts:34`).

Green for `npm run smoke:browser` means 3 Playwright smoke tests pass. Current smoke scope is production boot plus offline service-worker reload, keyboard playback gating during recording countdown plus page-hide media suspension, and export error UI through a mocked failing `MediaRecorder` (`test/browser/browser-smoke.pw.ts:247` through `test/browser/browser-smoke.pw.ts:294`).

On macOS, Playwright uses the system Chrome channel by default. CI can install Playwright Chromium and unset `PLAYWRIGHT_CHANNEL`; the channel selection is in `playwright.config.ts:8` through `playwright.config.ts:10`.

Run audit last:

```bash
npm audit --audit-level=moderate
```

Green means npm reports 0 moderate-or-higher vulnerabilities. The quality pass records that audit was green after dependency cleanup (`docs/quality-pass/status.md:224` through `docs/quality-pass/status.md:228`).

Generated local artifacts are intentionally ignored: `dist/`, `playwright-report/`, `test-results/`, `.playwright-mcp/`, `.serena/`, `.agent-relay/`, `.mcp.json`, and `*.tsbuildinfo` are in `.gitignore:4` through `.gitignore:39`.

## Write and run tests

Vitest runs in JSDOM with globals, CSS disabled, and `src/test-setup.ts` loaded before tests (`vite.config.ts:144` through `vite.config.ts:148`).

Use Testing Library for React components. Existing component tests import `render`, `screen`, `fireEvent`, `waitFor`, and `act` from Testing Library, for example `src/components/StepGrid.test.tsx:2`, `src/components/VariationButtons.test.tsx:2`, and `src/components/RecordingStation.test.tsx:2`.

Wrap subscribed store mutations and async UI updates in `act()`. This is not optional: the setup file detects React act warnings in both `console.error` and `console.warn` (`src/test-setup.ts:24` through `src/test-setup.ts:42`) and then fails the test (`src/test-setup.ts:48` through `src/test-setup.ts:57`).

Intentional app logger errors must go through the shared logger so they start with `[HA] `. The setup file allows `[HA] ` `console.error` output but fails other `console.error` output (`src/test-setup.ts:28` through `src/test-setup.ts:33`).

The setup file installs deterministic browser API shims:

- `Blob.arrayBuffer()` fallback (`src/test-setup.ts:59` through `src/test-setup.ts:69`).
- `URL.createObjectURL()` and `URL.revokeObjectURL()` stubs (`src/test-setup.ts:71` through `src/test-setup.ts:77`).
- Memory-backed `localStorage` fallback (`src/test-setup.ts:79` through `src/test-setup.ts:113`).
- Minimal canvas 2D context (`src/test-setup.ts:115` through `src/test-setup.ts:145`).
- Quiet `HTMLMediaElement.play()`, `pause()`, and `load()` stubs (`src/test-setup.ts:147` through `src/test-setup.ts:159`).
- Minimal `MediaStream` polyfill (`src/test-setup.ts:161` through `src/test-setup.ts:186`).
- `requestAnimationFrame` fallback if missing (`src/test-setup.ts:188` through `src/test-setup.ts:193`).

Use `fake-indexeddb/auto` in tests that touch IndexedDB or persistence. Existing examples are `src/lib/persistence.test.ts:1` through `src/lib/persistence.test.ts:3`, `src/lib/autoSave.test.ts:3`, `src/lib/rehydrate.test.ts:3`, and `src/store/useAppStore.test.ts:4`.

Persistence tests should assert both normal project records and recovery backups. The persistence keys are `PROJECT_KEY` and `PROJECT_BACKUP_KEY` in `src/lib/persistence.ts:6` through `src/lib/persistence.ts:8`; `clearProject()` deletes both keys at `src/lib/persistence.ts:99` through `src/lib/persistence.ts:102`.

Media tests use mocks and shims. They do not prove real camera, microphone, codec, WebKit, or mobile PWA behavior. The Playwright smoke suite also mocks camera and recorder surfaces (`test/browser/browser-smoke.pw.ts:5` through `test/browser/browser-smoke.pw.ts:116`), so passing browser smoke is not a real-device signoff.

Name Playwright smoke tests `*.pw.ts` and put them under `test/browser/`. The Playwright config matches only that suffix (`playwright.config.ts:13` through `playwright.config.ts:14`), and the quality-pass notes call out the naming rule so Vitest does not collect browser smoke files (`docs/quality-pass/status.md:160` through `docs/quality-pass/status.md:164`).

When adding tests for API proxy behavior, prefer handler-level tests in `api/gemini.test.ts` and include production env stubs. Existing tests cover non-POST rejection, missing key, token issuance, invalid JSON, model/config validation, body cap, origin checks, Fetch Metadata checks, limiter fail-closed behavior, request-token behavior, and Upstash/KV limiter wiring (`api/gemini.test.ts:251` through `api/gemini.test.ts:683`).

When touching service-worker logic, add or update `test/serviceWorker.test.ts`. Current coverage includes install precache, reload cache-key normalization, runtime asset caching, cache failure tolerance, `/api/` network-only behavior, and old cache deletion (`test/serviceWorker.test.ts:120` through `test/serviceWorker.test.ts:218`).

Follow TDD for bug fixes: write or update the failing test first, then make the smallest code change that turns the relevant test green, then run the full validation loop before handing off.

Do not add mock modes to app code. Mocks belong in tests only.

## Use the real-device checklist

Automated tests cannot validate the most failure-prone browser surfaces in this project. Anything touching capture, playback, export, stream lifecycle, service-worker install, or mobile UI needs real-device verification before claiming platform correctness.

Minimum real-device checklist from local planning material:

- iPhone Safari 18.4+: record a clip end-to-end, then share an MP4 export to WhatsApp or iMessage (`.claude/todo.md:182` through `.claude/todo.md:185`).
- Android Chrome: record a clip, trigger `beforeinstallprompt`, and install to the home screen (`.claude/todo.md:184` through `.claude/todo.md:186`).
- iPhone Firefox, Chrome, or Edge: confirm WebKit-engine parity with Safari (`.claude/todo.md:186`).
- iOS background interruption: background the app during a record cycle, reopen it, confirm the reconnect pill appears, and confirm one tap resumes (`.claude/todo.md:187`).

When relevant, extend that checklist with reload-from-IndexedDB playback, both detected export containers, hide/lock interruptions across preview/countdown/record/play/export, and installed-PWA offline reload. If you cannot run hardware checks, say so in the PR or handoff; do not treat JSDOM, mocked Playwright, or desktop Chrome as proof of iOS Safari, Android Chrome, real MediaRecorder codec negotiation, real microphone capture, or installed-PWA behavior.

## Debug local behavior

Use the shared logger first for AI and persistence issues. `src/lib/logger.ts` keeps a 200-entry in-memory ring buffer, mirrors entries to console with `[HA] <event>`, and exposes `getLogs()` / `clearLogs()` (`src/lib/logger.ts:4`, `src/lib/logger.ts:49` through `src/lib/logger.ts:78`).

In dev builds only, the entrypoint installs a browser helper:

```js
window.__haLogs()
window.__haLogs.dump()
window.__haLogs.clear()
```

The hook is documented and installed at `src/lib/logger.ts:91` through `src/lib/logger.ts:98` and `src/main.tsx:7` through `src/main.tsx:11`. It is not installed in production builds.

Known logger event names live in `LOG_EVENTS` (`src/lib/logger.ts:10` through `src/lib/logger.ts:30`). Use those constants, not string literals, when adding observability.

Autosave failures are observable through `autosave.error`. `src/lib/autoSave.ts` logs persistence failures at `src/lib/autoSave.ts:14` through `src/lib/autoSave.ts:17`, and there is focused coverage in `src/lib/autoSave.error.test.ts:25`.

Inspect IndexedDB through browser DevTools:

1. Open Application or Storage.
2. Find IndexedDB database `keyval-store`; this is the default store used by `idb-keyval`, and the smoke test seeds that database directly at `test/browser/browser-smoke.pw.ts:208` through `test/browser/browser-smoke.pw.ts:224`.
3. Open object store `keyval`.
4. Look for key `hyperactive-amateur-project` (`src/lib/persistence.ts:7`).
5. If recovery happened, look for `hyperactive-amateur-project:recovery-backup` (`src/lib/persistence.ts:8`).

The persisted project is schema-versioned. Current persisted schema version is `1` (`src/lib/persistence.ts:6`). Missing schema version means legacy v0 in the migration path (`src/lib/rehydrate.ts:245` through `src/lib/rehydrate.ts:253`).

Device preferences and a few UI choices live in `localStorage`, not IndexedDB. Preferred input device IDs use local storage because they are per-machine settings (`src/types.ts:123`, `src/store/initialState.ts:14` through `src/store/initialState.ts:23`, `src/store/useAppStore.ts:25` through `src/store/useAppStore.ts:32`).

To reset local project state from the app, use the Scratch/reset flow. Store-level `scratch()` also calls `clearProject()` to remove persisted records (`src/store/useAppStore.ts:554` through `src/store/useAppStore.ts:557`).

## Debug media and playback

Keep the hard invariants in sight:

- Use the audio clock for audible and visible timing. `Tone.Transport.scheduleRepeat()` drives the sequencer (`src/lib/audio.ts:48`), the UI playhead goes through `Tone.getDraw()` (`src/lib/audio.ts:55`), and video render receives audio-context seconds (`src/components/Viewport.tsx:70`, `src/lib/videoEngine.ts:24`).
- Do not change the canvas backing size. `Viewport` renders a `480` by `480` canvas (`src/components/Viewport.tsx:93` through `src/components/Viewport.tsx:96`), and export captures that canvas (`src/lib/export.ts:22`).
- Route audible entry points through `canStartAudibleAction()` (`src/lib/audibleActionGate.ts:5`). Playback and pad triggers gate in `src/lib/audio.ts:117` and `src/lib/audio.ts:163`; recording gates in `src/lib/recordingFlow.ts:86`; export gates in `src/lib/export.ts:77`; keyboard/spacebar hooks gate through their trigger/toggle calls (`src/lib/useKeyboardTriggers.ts:36`, `src/lib/useSpacebarPlayToggle.ts:24`).
- Claim blocking state synchronously before the first `await`. Recording sets countdown state before async startup (`src/lib/recordingFlow.ts:84` through `src/lib/recordingFlow.ts:87`), and export sets `isExporting(true)` immediately after session acquisition (`src/lib/export.ts:73` through `src/lib/export.ts:90`).
- Do not scatter media lifecycle handlers. `streamLifecycle.ts` owns track-ended, page-hide/show, and recorder-error transitions (`src/lib/streamLifecycle.ts:1` through `src/lib/streamLifecycle.ts:2`).

For recording failures, inspect:

- `src/lib/media.ts` for constraints, device fallback, permission confirmation, and stream ownership.
- `src/lib/recordingFlow.ts` for countdown, stream acquisition, recorder call, auto-trim, poster, WAV sidecar, and store write.
- `src/lib/recorder.ts` for `MediaRecorder` behavior plus Web Audio sidecar capture.
- `src/lib/audioCapture.ts` for the live mic tap.

For silent playback after reload, inspect the WAV sidecar path first. Recording writes `audioBlob` in `src/lib/recordingFlow.ts:150` through `src/lib/recordingFlow.ts:154`; persistence stores it in `src/lib/persistence.ts:60` through `src/lib/persistence.ts:62`; rehydrate prefers it at `src/lib/rehydrate.ts:293`.

For export bugs, inspect `src/lib/export.ts`, `src/lib/exportSession.ts`, `src/lib/exportFormats.ts`, and `src/components/ExportButton.tsx`. Export builds a stream from `canvas.captureStream(30)` plus a Tone destination tap (`src/lib/export.ts:22` through `src/lib/export.ts:31`), then drives a real-time render through `MediaRecorder`.

For service-worker bugs, remember source and shipped files differ. Source is `public/sw.js`; the shipped worker is `dist/sw.js` after `npm run build`. The source has placeholders at `public/sw.js:3` and `public/sw.js:5`; `vite.config.ts` replaces them after Vite emits the bundle.

To test the service worker locally:

```bash
npm run build
npm run preview -- --host 127.0.0.1 --port 4173
```

Then open `http://127.0.0.1:4173`, inspect Application -> Service Workers, wait for `/sw.js`, and test reload/offline behavior. Service workers are registered only in production builds (`src/main.tsx:13` through `src/main.tsx:19`), so `npm run dev` is the wrong environment for SW debugging.

The service worker intentionally leaves `/api/` network-only. `public/sw.js` returns without `respondWith()` for same-origin `/api/` and any non-GET request (`public/sw.js:56` through `public/sw.js:62`). Do not cache Gemini or token responses.

## Debug the Gemini proxy locally

Local AI calls go through Vite middleware, not Vercel. The middleware converts Node requests to Web `Request`, calls `handleGeminiTokenRequest()` or `handleGeminiRequest()`, and writes a Web `Response` back to Vite (`vite.config.ts:18` through `vite.config.ts:45`, `vite.config.ts:49` through `vite.config.ts:83`).

Start dev:

```bash
GEMINI_API_KEY=... npm run dev
```

Probe token issuance locally:

```bash
curl -i -sS -X POST 'http://localhost:5173/api/gemini-token' \
  -H 'Origin: http://localhost:5173' \
  -H 'Content-Type: application/json' \
  --data '{}'
```

Expected local success with a key is `200` JSON containing `token` and `expiresAt`. In non-production, signed request tokens are not required for `/api/gemini` (`api/gemini.ts:458` through `api/gemini.ts:460`), but the browser client still fetches a token first (`src/lib/aiHttpClient.ts:74` through `src/lib/aiHttpClient.ts:110`).

Probe missing-key behavior by unsetting the key. `/api/gemini-token` should return `503 {"error":"no-key"}` (`api/gemini.ts:696` through `api/gemini.ts:698`), and `/api/gemini` should return `503 {"error":"no-key"}` (`api/gemini.ts:615` through `api/gemini.ts:618`).

The local limiter is in-memory when not production. `configuredRateLimitStore()` returns a `MemoryRateLimitStore` unless production requires a durable limiter (`api/gemini.ts:559` through `api/gemini.ts:572`).

When debugging request validation, remember the proxy accepts only a narrow Gemini contract:

- Model allowlist is `gemini-3.1-flash-lite` (`api/gemini.ts:7`, `api/gemini.ts:249` through `api/gemini.ts:253`).
- Body cap is 4 MiB (`api/gemini.ts:8`, `api/gemini.ts:270` through `api/gemini.ts:299`).
- Allowed config keys are `systemInstruction`, `responseMimeType`, `responseSchema`, and `thinkingConfig` (`api/gemini.ts:20`, `api/gemini.ts:214` through `api/gemini.ts:247`).
- Inline audio is only `audio/wav` base64 (`api/gemini.ts:128` through `api/gemini.ts:132`).

## Deploy to Vercel

The project is designed for Vercel. `vercel.json` currently sets `maxDuration: 60` for `api/gemini.ts` only (`vercel.json:1` through `vercel.json:7`). The token route exists as `api/gemini-token.ts` and exports a `{ fetch }` wrapper around `handleGeminiTokenRequest()` (`api/gemini-token.ts:1` through `api/gemini-token.ts:7`).

Production AI proxy env is fail-closed. `.env.example` lists the same contract at `.env.example:15` through `.env.example:36`. Set these in the Vercel Production environment; set Preview too if AI should work on preview deployments:

```bash
GEMINI_API_KEY=<Google AI Studio/Gemini API key>
GEMINI_ALLOWED_ORIGINS=https://hyperactive-amateur.fgelbal.com

# Preferred durable limiter:
UPSTASH_REDIS_REST_URL=https://<upstash-rest-endpoint>
UPSTASH_REDIS_REST_TOKEN=<upstash-rest-token>

# Or Vercel KV aliases instead of the Upstash names:
KV_REST_API_URL=https://<vercel-kv-rest-endpoint>
KV_REST_API_TOKEN=<vercel-kv-rest-token>

# Recommended separate HMAC secret:
GEMINI_REQUEST_TOKEN_SECRET=<random 32+ byte secret>

# Optional tuning:
GEMINI_RATE_LIMIT_MAX=60
GEMINI_RATE_LIMIT_WINDOW_SECONDS=600
GEMINI_REQUEST_TOKEN_TTL_SECONDS=120
```

`GEMINI_API_KEY` is required for both token issuance and generate calls (`api/gemini.ts:615` through `api/gemini.ts:618`, `api/gemini.ts:696` through `api/gemini.ts:698`).

`GEMINI_ALLOWED_ORIGINS` is the explicit production allowlist. The code also accepts `VERCEL_PROJECT_PRODUCTION_URL`, `VERCEL_BRANCH_URL`, and `VERCEL_URL` when Vercel provides them (`api/gemini.ts:326` through `api/gemini.ts:335`), but README and `.env.example` still recommend listing the custom domain explicitly (`README.md:99` through `README.md:102`, `.env.example:15` through `.env.example:19`).

Durable rate limiting is required in production. If no Upstash or KV pair is configured, `configuredRateLimitStore()` returns `null` in production (`api/gemini.ts:559` through `api/gemini.ts:570`), and requests fail closed with `{"error":"limiter-unconfigured"}` (`api/gemini.ts:575` through `api/gemini.ts:580`).

Limiter URLs must be HTTPS in production. `normalizedLimiterUrl()` rejects non-HTTPS production limiter URLs before a bearer token is used (`api/gemini.ts:545` through `api/gemini.ts:557`), and README documents the HTTPS requirement at `README.md:87` through `README.md:88`.

Rate-limit buckets are route-scoped and identity-scoped. `rateLimitKey()` includes scope, origin, and identity (`api/gemini.ts:403` through `api/gemini.ts:405`); `/api/gemini-token` uses scope `"token"` (`api/gemini.ts:700`), and `/api/gemini` uses the default `"generate"` scope (`api/gemini.ts:575` through `api/gemini.ts:578`, `api/gemini.ts:623`).

Production request identity prefers Vercel's `x-vercel-forwarded-for`, falls back to caller-forwarded headers only outside production, and otherwise uses `"shared"` (`api/gemini.ts:388` through `api/gemini.ts:400`).

Production browser calls need same-origin Fetch Metadata before token issuance or token spending. The code requires `Sec-Fetch-Site: same-origin`, accepts only `cors` or `same-origin` fetch mode when present, and accepts only `empty` destination when present (`api/gemini.ts:363` through `api/gemini.ts:377`).

Signed request tokens are short-lived and bind to origin plus rate-limit identity. Token creation is in `api/gemini.ts:442` through `api/gemini.ts:455`; validation checks signature, expiry, origin, identity, and nonce at `api/gemini.ts:458` through `api/gemini.ts:495`.

Default token secret is `GEMINI_REQUEST_TOKEN_SECRET`, falling back to `GEMINI_API_KEY` when unset (`api/gemini.ts:408` through `api/gemini.ts:410`). Use a separate secret in production so rotating the Gemini key and rotating request-token signing are separate operations.

Production fail-closed statuses to expect:

- Missing key: `503 {"error":"no-key"}`.
- Missing production origin: `503 {"error":"origin-not-configured"}` or `403 {"error":"origin-required"}` depending on headers.
- Disallowed origin: `403 {"error":"disallowed-origin"}`.
- Missing browser Fetch Metadata in production: `403 {"error":"browser-fetch-required"}`.
- Missing durable limiter: `503 {"error":"limiter-unconfigured"}`.
- Limiter backend failure: `503 {"error":"rate-limit-unavailable"}`.
- Missing generate request token in production: `401 {"error":"request-token-required"}`.
- Invalid generate request token in production: `401 {"error":"invalid-request-token"}`.

The current live incident report found `/api/gemini` reached graceful fail-closed limiter behavior, while `/api/gemini-token` returned Vercel plain-text `FUNCTION_INVOCATION_FAILED` before handler-level JSON (`docs/audits/2026-07-gemini-500-incident.md:44` through `docs/audits/2026-07-gemini-500-incident.md:77`, `docs/audits/2026-07-gemini-500-incident.md:152` through `docs/audits/2026-07-gemini-500-incident.md:183`). Check Vercel runtime logs and route packaging if that recurs.

## Run post-deploy probes

Use the deployed origin. Include browser-like Fetch Metadata so production Fetch Metadata checks are not the first rejection.

Check the app shell:

```bash
curl -sS -D /tmp/ha-html-headers.txt -o /tmp/ha-index.html \
  https://hyperactive-amateur.fgelbal.com/
```

Expected: HTTP `200`, HTML references current hashed `/assets/...` JS/CSS. The incident report's live probe saw `HTTP/2 200` and hashed asset references (`docs/audits/2026-07-gemini-500-incident.md:7` through `docs/audits/2026-07-gemini-500-incident.md:42`).

Check token route method guard:

```bash
curl -i -sS -X GET 'https://hyperactive-amateur.fgelbal.com/api/gemini-token' \
  -H 'Origin: https://hyperactive-amateur.fgelbal.com' \
  -H 'Sec-Fetch-Site: same-origin' \
  -H 'Sec-Fetch-Mode: cors' \
  -H 'Sec-Fetch-Dest: empty'
```

Expected after route packaging is healthy: `405 {"error":"method-not-allowed"}` with no `x-vercel-error`. The source handler returns that before env, limiter, token, or body work (`api/gemini.ts:685` through `api/gemini.ts:688`), and the incident report calls this out as the expected verification target (`docs/audits/2026-07-gemini-500-incident.md:325` through `docs/audits/2026-07-gemini-500-incident.md:327`).

Check main proxy method guard:

```bash
curl -i -sS -X GET 'https://hyperactive-amateur.fgelbal.com/api/gemini' \
  -H 'Origin: https://hyperactive-amateur.fgelbal.com' \
  -H 'Sec-Fetch-Site: same-origin' \
  -H 'Sec-Fetch-Mode: cors' \
  -H 'Sec-Fetch-Dest: empty'
```

Expected: `405 {"error":"method-not-allowed"}` with no `x-vercel-error`. The incident report observed that exact stable JSON path for `/api/gemini` (`docs/audits/2026-07-gemini-500-incident.md:81` through `docs/audits/2026-07-gemini-500-incident.md:112`).

Check token issuance:

```bash
curl -i -sS -X POST 'https://hyperactive-amateur.fgelbal.com/api/gemini-token' \
  -H 'Origin: https://hyperactive-amateur.fgelbal.com' \
  -H 'Sec-Fetch-Site: same-origin' \
  -H 'Sec-Fetch-Mode: cors' \
  -H 'Sec-Fetch-Dest: empty' \
  -H 'Content-Type: application/json' \
  --data '{}'
```

Expected with full env: `200 {"token":"...","expiresAt":...}`. Expected with limiter intentionally absent: `503 {"error":"limiter-unconfigured"}`. Never accept Vercel plain-text `FUNCTION_INVOCATION_FAILED`; that means the function crashed outside clean handler behavior (`docs/audits/2026-07-gemini-500-incident.md:317` through `docs/audits/2026-07-gemini-500-incident.md:329`).

Check generate without token:

```bash
curl -i -sS -X POST 'https://hyperactive-amateur.fgelbal.com/api/gemini' \
  -H 'Origin: https://hyperactive-amateur.fgelbal.com' \
  -H 'Sec-Fetch-Site: same-origin' \
  -H 'Sec-Fetch-Mode: cors' \
  -H 'Sec-Fetch-Dest: empty' \
  -H 'Content-Type: application/json' \
  --data '{"model":"gemini-3.1-flash-lite","contents":[{"role":"user","parts":[{"text":"Return JSON: {\"ok\":true}"}]}],"config":{"responseMimeType":"application/json","responseSchema":{"type":"OBJECT","properties":{"ok":{"type":"BOOLEAN"}},"required":["ok"]}}}'
```

Expected with full env and no `x-ha-gemini-token`: `401 {"error":"request-token-required"}`. If limiter env is missing, expect `503 {"error":"limiter-unconfigured"}` before token validation because rate limiting runs first (`api/gemini.ts:623` through `api/gemini.ts:633`).

Check generate with a fresh token by minting a token first, then sending the same body with:

```text
x-ha-gemini-token: <token>
```

Expected: Gemini JSON `200` or a sanitized JSON proxy error such as `upstream-timeout`, `upstream-rate-limited`, `upstream-unavailable`, `upstream-rejected`, or `upstream-fetch-failed`; never provider secrets, never Vercel plain-text `FUNCTION_INVOCATION_FAILED` (`api/gemini.ts:600` through `api/gemini.ts:604`, `api/gemini.ts:656` through `api/gemini.ts:682`).

After API probes, trigger all in-app AI surfaces from the deployed page: Suggest pattern, Variation, single clip auto-tag, and batch auto-tag. The incident report specifically says to confirm the browser no longer shows `Gemini proxy 500: A server error has occurred FUNCTION_INVOCATION_FAILED` (`docs/audits/2026-07-gemini-500-incident.md:331` through `docs/audits/2026-07-gemini-500-incident.md:337`).

Confirm `/api/` remains network-only through the service worker. The source worker skips `/api/` in `public/sw.js:56` through `public/sw.js:62`, and the incident report includes a hard-reload sanity check for stale workers (`docs/audits/2026-07-gemini-500-incident.md:339`).

## Follow conventions

Every code file starts with two `ABOUTME:` comment lines. Examples: `src/main.tsx:1` through `src/main.tsx:2`, `src/lib/logger.ts:1` through `src/lib/logger.ts:2`, and `api/gemini.ts:1` through `api/gemini.ts:2`.

Use conventional commits in imperative mood, for example `fix(media): suspend stream on recorder error` or `docs(mobile): add real-device checklist`.

Keep changes small and local. Do not do drive-by refactors; if you find unrelated work, track it separately rather than mixing it into the patch.

Respect the export freeze. Store writers that affect output no-op while `playback.isExporting`; UI controls also need to look disabled. The quality-pass summary lists this as a hardened behavior (`docs/quality-pass/status.md:84` through `docs/quality-pass/status.md:101`).

Any persisted shape change needs all of these:

- Type update in `src/types.ts` and/or `src/lib/persistence.ts`.
- `snapshot()` update in `src/lib/persistence.ts:47` through `src/lib/persistence.ts:73`.
- Migration/normalization in `src/lib/rehydrate.ts`.
- Tests for legacy load, malformed data, and recovery-backup behavior.

Loop lengths stay multiples of 4. Store constants set min, max, and increment (`src/store/initialState.ts:7` through `src/store/initialState.ts:9`), and rehydrate aligns saved step counts (`src/lib/rehydrate.ts:89`).

Feature-detect browser capabilities. The app checks `MediaRecorder`, supported recording formats, canvas `captureStream`, Web Audio, and IndexedDB in `src/components/CompatibilityBanner.tsx:14` through `src/components/CompatibilityBanner.tsx:37`. Avoid user-agent sniffing; one current exception exists in `src/components/RecordingStation.tsx:314`, so do not copy that pattern without replacing it with feature detection.

Prefer existing seams over new abstractions. Important seams already exist for the audio gate (`src/lib/audibleActionGate.ts`), stream lifecycle (`src/lib/streamLifecycle.ts`), export sessions (`src/lib/exportSession.ts`), Gemini HTTP transport (`src/lib/aiHttpClient.ts`), media recorder support (`src/lib/mediaRecorderSupport.ts`), and persistence/rehydrate (`src/lib/persistence.ts`, `src/lib/rehydrate.ts`).

`docs/` is committed and canonical. `.claude/README.md` also points back to committed docs as the always-present documentation layer (`.claude/README.md:7` through `.claude/README.md:10`).

`.claude/` is git-ignored local planning material. `.gitignore` excludes it at `.gitignore:41` through `.gitignore:44`; `.claude/README.md` says committed docs live in `docs/` and `.claude/` is a planning layer (`.claude/README.md:1` through `.claude/README.md:10`). It may contain `CLAUDE.md`, `PRODUCT.md`, `todo.md`, versioned specs/build plans under `v1/`, `v1.1/`, `v2-mobile/`, and `notes/ai-migration.md` (`.claude/README.md:12` through `.claude/README.md:43`).

Treat `.claude/` as useful context, not source of truth. It can be historical or partially superseded; for example, `.claude/todo.md` still contains older Anthropic wording at `.claude/todo.md:61` through `.claude/todo.md:80`, while current source and README use Gemini.

## Platform docs checked

Official docs checked for platform behavior: MDN Service Worker lifecycle and fetch behavior (<https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API/Using_Service_Workers>, <https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerGlobalScope/fetch_event>), MDN MediaRecorder and MIME probing (<https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder>, <https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder/isTypeSupported_static>), and Vercel environment/body-limit docs (<https://vercel.com/docs/environment-variables>, <https://vercel.com/docs/environment-variables/system-environment-variables>, <https://vercel.com/kb/guide/how-to-bypass-vercel-body-size-limit-serverless-functions>).

I did not independently verify project-specific mobile hardware symptoms in official docs. Claims about iOS/Android recording, share targets, and installed-PWA behavior remain real-device checklist items unless a device run proves them.
