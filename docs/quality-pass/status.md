# Quality Pass Status

Date: 2026-06-24

## Phase 0: Baseline And Safety Net

- Required docs read first: `docs/quality-pass/quality-improvement-plan.md` and `docs/simmer/trajectory.md`.
- Working tree note: `docs/` and `.serena/` were already untracked at start of work. They are treated as user/tool artifacts and left in place.
- Deployment target for `api/gemini.ts`: Vercel serverless Node, based on `vercel.json` and the Vite dev middleware importing the same handler.
- Baseline dependency versions from `npm ls --depth=0`: `vite@5.4.21`, `vitest@2.1.9`, `@vitest/ui@2.1.9`.
- Baseline tests: `npm test` passed, 33 files / 134 tests. Existing React `act(...)` warnings were emitted in `StepGrid`, `SuggestButton`, `RecordingStation`, and `VariationButtons` tests.
- Baseline build: `npm run build` passed with Vite 5.4.21.
- Baseline audit: `npm audit --audit-level=moderate --json` failed with 9 findings: 1 low, 3 moderate, 3 high, 2 critical.
- Audit classification:
  - `@vitest/ui` critical, direct dev/test UI server, not production runtime.
  - `vitest` critical, direct dev/test runner, not production runtime.
  - `vite` high/moderate via dev server/build tooling, direct dev dependency, not shipped as runtime app code.
  - `ws` high, transitive dev dependency, no production runtime import found.
  - `form-data` high, transitive dev dependency, no production runtime import found.
  - `esbuild`, `@vitest/mocker`, and `vite-node` moderate transitive dev/test/build dependencies.
  - `@babel/core` low transitive dev/build dependency.
- Step-count contract decision: Option B. Loop lengths must remain bar-aligned in increments of 4 for this quality pass. The current `removeStepColumn` behavior violates that contract and remains a planned Phase 3 fix unless reached in this run.
- Shared browser API seams: existing tests already include fakes for MediaStream, stream tracks, canvas context, object URLs, and fetch. Additional seams will be added only as phases reach those paths.

## Gemini Proxy Contract

- Allowed model list: `gemini-3.1-flash-lite` only. Current call sites for Suggest, Variation, per-clip auto-tag, and batch auto-tag all use this model.
- Allowed config keys: `systemInstruction`, `responseMimeType`, `responseSchema`, and `thinkingConfig`.
- Allowed `responseMimeType`: `application/json`.
- Allowed `thinkingConfig`: object with `thinkingLevel: "high"` only.
- Allowed `systemInstruction`: string or REST-compatible `{ parts: [{ text: string }] }` text-only object.
- Allowed contents shape: non-empty SDK/REST-like `contents` array of role/parts entries. Parts may be text or `inlineData` with `mimeType: "audio/wav"` and base64 data.
- Expected largest legitimate payload: batch auto-tag allows up to 3 MiB of base64 inline audio client-side. The proxy request cap leaves JSON schema and prompt overhead below Vercel's production payload limit.
- Maximum proxy request size: 4 MiB serialized JSON body.
- Production limiter backend: durable Upstash/Vercel-KV-style Redis REST API (`UPSTASH_REDIS_REST_URL` plus `UPSTASH_REDIS_REST_TOKEN`, with Vercel KV aliases accepted). Production requires HTTPS limiter URLs and fails closed if no durable limiter is configured.
- Production origin sources: `GEMINI_ALLOWED_ORIGINS` for custom/public domains, plus Vercel-provided `VERCEL_PROJECT_PRODUCTION_URL`, `VERCEL_BRANCH_URL`, and `VERCEL_URL` when present.
- Production rate-limit identity: Vercel's `x-vercel-forwarded-for` header when present. Plain `x-forwarded-for` is treated as a development fallback, not a trusted production identity source.
- Access-control mode: strict Origin/Referer allowlist, production Fetch Metadata checks, short-lived server-signed request tokens, and route-scoped durable server-side rate limiting for token issuance, invalid-token attempts, and Gemini spends. Browser cross-origin scripts cannot mint or spend tokens merely by setting `Origin`; the durable limiter remains the abuse control for non-browser traffic.

## Phase 1 Progress

- Status: Phase 1 complete for this pass.
- Guardrail: focused Gemini proxy hardening is limited to one production module, `api/gemini.ts`, plus tests and this status log.
- Added `api/gemini.test.ts` with proxy regressions for method rejection, missing key, invalid JSON, model allowlist, config validation, body cap enforcement, origin rejection, production limiter fail-closed behavior, burst limiting, accepted app request shapes, and upstream error redaction.
- Review fix: the orchestrator found a TypeScript build break in `api/gemini.ts`; the implementation agent addressed it by replacing `HeadersInit`, narrowing schema numeric values, and preserving optional rate-limit headers in the return type.
- Adversarial review pass: Codex and Claude Code both found no app-call-site payload mismatch and no Vercel handler export blocker. Their actionable feedback was addressed by documenting production env vars, auto-allowing Vercel production/branch URLs, preferring `x-vercel-forwarded-for` over caller-supplied `x-forwarded-for` in production, rate-limiting before body reads, testing the real Upstash REST adapter path, asserting SDK-to-REST upstream mapping, adding production origin tests, adding validation guardrail negative tests, and ignoring `.serena/`.
- Follow-up Phase 1 review fix: added `/api/gemini-token`, production Fetch Metadata checks, a short-lived signed request token bound to origin plus Vercel client identity, client token fetching/caching before `/api/gemini` calls, one refresh/retry on stale token rejection, blank-env fallback handling, and node-side type-check coverage for `api/**/*.ts`.
- Residual Phase 1 risks:
  - Non-browser traffic can spoof browser headers, so the durable limiter remains required in production.
- Post-review validation:
  - `npm test -- api/gemini.test.ts src/lib/aiHttpClient.test.ts src/lib/aiAutoTagBatch.test.ts`: superseded by later focused and full-suite validation below.
  - `npm test`: passed, 34 files / 168 tests.
  - `npm run build`: passed.
  - `npm audit --audit-level=moderate`: still failed before Phase 1.2 dependency cleanup, with the known 9 dev-tooling findings classified above.
  - `git diff --check`: passed.

## Phase 1.2 Dependency Advisory Cleanup

- Status: complete for this pass.
- Removed the direct `@vitest/ui` dev dependency and the unused `test:ui` script.
- Ran `npm audit fix` for non-breaking transitive patches:
  - `@babel/core` and related Babel helpers moved to 7.29.7.
  - `form-data` moved to 4.0.6 through `jsdom`.
  - `ws` moved to 8.21.0 through `jsdom`.
- Upgraded the remaining Vite/Vitest toolchain cluster:
  - `vite`: 5.4.21 -> 8.1.0.
  - `vitest`: 2.1.9 -> 4.1.9.
  - `@vitejs/plugin-react`: 4.7.0 -> 6.0.3.
  - `postcss`: 8.5.14 -> 8.5.15 as a lockfile transitive/direct compatible refresh.
- Updated `package.json` engines from `20.x` to `^20.19.0 || >=22.12.0` to match the upgraded Vite/plugin requirements.
- Compatibility fixes required by Vitest 4:
  - `src/lib/audio.test.ts` Tone constructor mocks now use constructable function implementations instead of arrow functions.
  - `src/test-setup.ts` now always installs deterministic JSDOM `URL.createObjectURL`/`revokeObjectURL` shims, even when Node exposes stricter built-in versions.
- Validation:
  - `npm audit --audit-level=moderate`: passed with 0 vulnerabilities.
  - `npm test -- src/lib/audio.test.ts src/lib/rehydrate.test.ts`: passed, 2 files / 9 tests.
  - `npm test`: passed, 34 files / 162 tests.
  - `npm run build`: passed with Vite 8.1.0.
  - `git diff --check`: passed.
- Residual dependency risk: the package manager install needed `npm install --force` once to rewrite stale Vite 5 peer metadata from the old lockfile after the manifest was updated. The resulting installed tree is coherent in `npm ls --depth=0`, audits cleanly, and passes tests/build.

## Phase 2 Media And Export Correctness

- Status: complete for this pass.
- Centralized media stream ownership in `src/lib/streamLifecycle.ts` with release/suspend helpers that detach lifecycle listeners, stop tracks, and only mutate the store when it still owns the stream.
- `src/lib/media.ts` now registers lifecycle listeners on acquired streams and releases any previously held stream before replacing it.
- Added `src/lib/exportSession.ts` and made `exportSong()` acquire an exclusive session before its first await. Only the owning export session can stop export playback, clear `isExporting`, unregister the session, or clean export streams.
- Page hide now aborts active export and still suspends any held recording/preview stream.
- Added `src/lib/audibleActionGate.ts` and wired playback, pads, keyboard triggers, spacebar, recording, and export start through it. Recording cannot start during playback/export; playback/pads/keys/export cannot start during recording; Space cannot stop export-owned playback.
- Output-affecting project mutations no-op during export, including steps, step count, BPM/swing/cut/hold, subgenre, vibe, volume/mute, clips, showVideo, tags, tag reasoning, pattern application, hydrate, scratch, and reset.
- `applyClassifiedTag()` now returns `applied: false` when export freeze prevents its store writes, so async auto-tag and re-tag callers do not report false success.
- Review loop:
  - Codex adversarial review returned NO-GO for tag mutation, hidden-page media cleanup, recording/export overlap, export overlap races, spacebar export stop, and recording-start async windows; all were addressed.
  - Follow-up Codex review returned NO-GO for recording while playback, subgenre/vibe freeze, false `applyClassifiedTag` success, and non-owner export cleanup; all were addressed.
  - Final narrow Codex review returned GO with no findings.
  - Claude Code review was attempted but unavailable in this environment: `claude -p --max-budget-usd 1` failed with `Exceeded USD budget (1)`.
- Validation after final Phase 2 fixes:
  - `npm test`: passed, 38 files / 193 tests.
  - `npm run build`: passed.
  - `npm audit --audit-level=moderate`: passed with 0 vulnerabilities.
  - `git diff --check`: passed.

## Phase 3 Persistence And State Contracts

- Status: complete for this pass.
- Added persisted schema versioning and a recovery path in `src/lib/rehydrate.ts` for legacy/v0 saves, malformed project fields, invalid track counts/ids, invalid step counts, invalid step entries, invalid tags, invalid trim/duration fields, and corrupt clip blobs.
- Degraded recovery now writes a bounded backup under `hyperactive-amateur-project:recovery-backup` before hydrating repaired data. If that backup write fails, rehydrate returns `{ ok: false, degraded: true }`, leaves the original persisted project untouched, shows recovery warnings, and `App` does not start autosave.
- Added `RecoveryBanner` so recovery warnings are visible and dismissible; dismissal only clears UI state, not the saved backup.
- Autosave now tracks `dirtyWhileRecording`, skips partial recording-state saves, and flushes the latest project once recording returns to idle. Rejected saves log `autosave.error` through the shared logger.
- Step removal now removes the four-step block containing the selected column, preserving the multiple-of-4 loop-length contract.
- Review loop:
  - Initial Codex adversarial review returned NO-GO for backup failure overwrite risk, missing no-schema legacy migration, permissive `Boolean()` step coercion, and untested autosave error observability.
  - All findings were addressed with implementation changes and tests.
  - Follow-up Codex adversarial review returned GO with no blocking findings.
  - Claude Code review was attempted twice but unavailable in this environment: `claude -p --max-budget-usd 1` failed with `Exceeded USD budget (1)`.
- Validation after final Phase 3 fixes:
  - `npm test`: passed, 40 files / 204 tests.
  - `npm run build`: passed.
  - `npm audit --audit-level=moderate`: passed with 0 vulnerabilities.
  - `git diff --check`: passed.

## Phase 4 Visual, PWA, And AI UX Correctness

- Status: complete for this pass.
- Visual trim end:
  - `drawCurrentFrame()` now uses the current audio time to stop drawing once the displayed clip reaches its trimmed duration.
  - After trim end, the viewport is cleared and the hidden video is paused; a repeated trigger resets the displayed start time and draws from trim start again.
  - Added regression coverage for drawing before trim end and clearing after trim end.
- AI suggestion overwrite races:
  - Added transient `session.projectRevision` and a guarded `applyPatternIfCurrent(grid, expectedProjectRevision, expectedStepCount)` store action.
  - Grid/project-shape mutations that can stale an AI pattern response now bump the revision.
  - Suggest and Variation flows capture revision and step count at request time, then show a retry conflict message instead of overwriting user edits when the project changed while Gemini was pending.
  - Added store, Suggest, and Variation tests for unchanged applies, stale edit rejection, and step-count-change rejection.
- Service worker caching:
  - `public/sw.js` keeps `/api/` network-only, deletes old `ha-shell-*` caches, runtime-caches same-origin `/assets/` as fallback, and now precaches `PRECACHE_URLS` at install.
  - `vite.config.ts` injects emitted `dist/assets` URLs into `dist/sw.js` while replacing `%BUILD_HASH%`, closing the first-load/offline-hard-reload gap where runtime caching could miss JS/CSS loaded before service-worker control.
  - Added service-worker tests for build-injected asset precache, runtime asset caching, `cache.put` rejection, `caches.open` rejection, API network-only behavior, and old cache cleanup.
  - README mobile/offline documentation now describes build-time asset precaching, runtime fallback caching, `/api/` network-only behavior, cache versioning, and bad-deploy recovery by changed asset hashes.
- Review loop:
  - Initial Codex adversarial review returned NO-GO for missing `caches.open` rejection coverage; addressed with a harness option and regression test.
  - Follow-up Codex adversarial review returned NO-GO for the service worker relying only on runtime `/assets/` caching even though registration happens after the first JS/CSS requests; addressed with build-time precache injection and a generated-worker verification.
  - Final Codex adversarial review returned GO with no blocking findings after checking `public/sw.js`, `vite.config.ts`, `test/serviceWorker.test.ts`, regenerated `dist/sw.js`, `npm test`, `npm run build`, `npm audit --audit-level=moderate`, and `git diff --check`.
  - Claude Code returned an earlier static GO before the final build-time precache fix, but a fresh final Claude Code pass was unavailable because the CLI reported `You've hit your session limit · resets 9:50pm (Europe/Madrid)`.
- Validation after final Phase 4 fixes:
  - `npm test -- src/lib/videoEngine.test.ts src/components/SuggestButton.test.tsx src/components/VariationButtons.test.tsx src/store/useAppStore.test.ts test/serviceWorker.test.ts`: passed, 5 files / 32 tests.
  - `npm test`: passed, 41 files / 214 tests.
  - `npm run build`: passed.
  - Generated `dist/sw.js` contained concrete `PRECACHE_URLS` for the emitted Vite JS/CSS assets, with `%BUILD_HASH%` replaced by a concrete `ha-shell-*` cache name.
  - `npm audit --audit-level=moderate`: passed with 0 vulnerabilities.
  - `git diff --check`: passed.

## Phase 5 Test Quality And Browser Coverage

- Status: complete for this pass.
- React warning cleanup:
  - Added a Vitest setup guard that fails tests on React `act(...)` warnings and unexpected non-`[HA]` `console.error` output.
  - Kept intentional app logger output allowed through the existing `[HA]` prefix.
  - Wrapped subscribed store mutations, async AI promise resolution, and interaction-triggered state updates in `act()` for `StepGrid`, `SuggestButton`, `VariationButtons`, and `RecordingStation` tests.
  - Fixed a `RecordingStation` runtime edge case found during warning cleanup: the preview stream effect no longer acquires camera/mic when the station has no target track and renders nothing.
- Browser smoke coverage:
  - Added `@playwright/test`, `playwright.config.ts`, and `npm run smoke:browser`.
  - Browser smoke files use `.pw.ts` naming under `test/browser/` so Vitest does not collect them.
  - `smoke:browser` builds the production bundle, serves Vite preview, and runs Chrome/Chromium smoke tests without real camera permission.
  - Smoke coverage includes production app boot, service-worker offline reload, keyboard playback gating during recording countdown, page-hide media suspension, and export error UI through a mocked failing `MediaRecorder`.
  - Added `playwright-report/` and `test-results/` to `.gitignore` and removed generated Playwright artifacts after runs.
- Service worker reload fix discovered by browser smoke:
  - The initial browser smoke found that a reload request could miss cached shell/assets even after install-time precache.
  - `public/sw.js` now normalizes cache keys to a plain GET `Request` before `caches.match()` and `cache.put()`, so browser reload metadata does not bypass cached app-shell entries.
  - `test/serviceWorker.test.ts` now models reload cache mode and verifies precached app shell is served without network.
- Review loop:
  - Codex adversarial review returned GO with no blocking findings after inspecting the warning guard, browser smoke, service-worker reload behavior, generated `dist/sw.js`, and package/config wiring.
  - Claude Code review was attempted but unavailable because the CLI reported `You've hit your session limit · resets 9:50pm (Europe/Madrid)`.
- Validation after final Phase 5 fixes:
  - `npm test`: passed, 41 files / 215 tests.
  - `npm run build`: passed.
  - `npm run smoke:browser`: passed, 3 Playwright tests.
  - Codex focused review validation: `npm test -- --run test/serviceWorker.test.ts src/lib/audibleActionGate.test.ts src/lib/streamLifecycle.test.ts src/lib/export.test.ts src/lib/useSpacebarPlayToggle.test.tsx src/lib/useKeyboardTriggers.test.tsx` passed, 6 files / 29 tests.
  - `npm audit --audit-level=moderate`: passed with 0 vulnerabilities.
  - `git diff --check`: passed.

## Wider Codex-Only Adversarial Pass

- Status: complete for this pass.
- Review setup:
  - Ran three independent Codex adversarial reviews covering security/backend/persistence, browser/media/export/PWA, and state/UI/test/release readiness.
- Findings addressed in code:
  - First-time recording could be dismissed into a dead-end; the viewport now shows a "Record first sound" affordance whenever empty tracks remain and the station is dismissed.
  - Skipping every empty track in the station now shows a no-target recovery state with a start-over path instead of rendering nothing.
  - Step-grid controls now visibly disable while export owns playback, and the extend button disables at the max step count.
  - Download object URLs are revoked after the click turn instead of synchronously.
  - Recorder errors now suspend media when any required stream track has ended, not only when all tracks have ended.
  - Recording cancellation after audio startup now exits before acquiring camera/mic.
  - App startup no longer probes permissions to auto-grant media on reload; camera/mic acquisition stays behind explicit user intent.
  - Rehydrate load failures now return a degraded result with a visible warning so autosave stays paused instead of overwriting an unreadable saved project.
  - Gemini token issuance and invalid-token attempts now run through route-scoped durable rate-limit buckets.
  - Production Upstash/Vercel KV limiter URLs must be HTTPS before the bearer token is used.
  - `retagAll` tests now restore console spies so the global warning guard cannot be masked across cases.
  - README export-format and validation-command documentation was corrected.
- Remaining follow-up:
  - The next meaningful security hardening step is an operation-specific Gemini proxy contract that builds prompts and schemas server-side rather than accepting the current validated client-built Gemini request bodies.
- Validation after wider pass fixes:
  - `npm test -- api/gemini.test.ts src/components/Viewport.test.tsx src/components/RecordingStation.test.tsx src/components/StepGrid.test.tsx src/lib/export.test.ts src/lib/streamLifecycle.test.ts src/lib/recordingFlow.test.ts src/lib/media.test.ts src/lib/rehydrate.test.ts src/lib/retagAll.test.ts`: passed, 10 files / 101 tests.
  - `npm test`: passed, 41 files / 223 tests.
  - `npm run build`: passed.
  - `npm run smoke:browser`: passed, 3 Playwright tests.
  - `npm audit --audit-level=moderate`: passed with 0 vulnerabilities.
  - `git diff --check`: passed.

## Final Documentation Sync And Artifact Cleanup

- Status: complete for this PR.
- Documentation drift fixed:
  - README Node requirement now matches `package.json` engines: Node 20.19+ or 22.12+.
  - README and `.env.example` now document that production limiter URLs must be HTTPS.
  - README, `.env.example`, and this status log now describe route-scoped rate limiting across token issuance, invalid-token attempts, and Gemini spends.
  - The quality plan/status no longer describes the limiter as only a spend-side control.
- Local generated artifacts removed before commit:
  - `dist/`
  - `test-results/`
  - `playwright-report/`
  - `tsconfig.app.tsbuildinfo`
  - `tsconfig.node.tsbuildinfo`
  - `.DS_Store` files, including copies under `node_modules/`
- Validation after final cleanup:
  - `npm test`: passed, 41 files / 223 tests.
  - `npm run build`: passed.
  - `npm run smoke:browser`: passed, 3 Playwright tests.
  - `npm audit --audit-level=moderate`: passed with 0 vulnerabilities.
  - `git diff --check`: passed.

## Vercel Type Surface Fix

- Status: complete.
- Vercel deploy reported TypeScript errors for Node built-ins (`node:stream`, `node:crypto`, `node:fs`, `node:path`, `node:http`), Node globals (`process`), and fetch-style globals (`Request`, `Response`, `Headers`, `RequestInit`, `fetch`, `DOMException`) in `vite.config.ts` and `api/gemini.ts`.
- Fix:
  - Added `@types/node` as a direct dev dependency instead of relying on Vite/Vitest transitive type packages.
  - Updated `tsconfig.node.json` with `types: ["node"]`.
  - Added `DOM` and `DOM.Iterable` libs to the Node/API TypeScript project because the Vercel-style API handler and Vite dev middleware intentionally use fetch-standard request/response types.
- Validation after fix:
  - `npm run build`: passed.
