# Hyperactive Amateur Quality Improvement Plan

## Goal

Turn the audit findings into a shippable quality pass that improves security, media lifecycle correctness, export reliability, persistence safety, and test confidence without broad rewrites or unrelated design changes.

## Scope

This plan addresses the audit findings from the June 24, 2026 review:

- Public Gemini proxy hardening.
- Media stream ownership and release correctness.
- Export cancellation and visibility-change safety.
- Playback, pad, and keyboard gating during recording/export.
- Persistence schema validation, recovery, and autosave correctness.
- Step-count invariant cleanup.
- Service worker offline asset caching.
- Video trim-end enforcement.
- AI suggestion conflict protection.
- Dependency security updates and test warning cleanup.

Out of scope for this pass:

- Major redesign of the UI.
- New AI features beyond safer request handling and conflict prevention.
- Full React 19, Tailwind 4, or Vite 8 migration unless required by the dependency security work.
- Replacing Tone.js, Zustand, or the current canvas/video architecture.

## Implementation Principles

- Fix correctness before polish.
- Centralize ownership rules rather than adding local one-off guards.
- Preserve existing UX unless a safety fix requires a small visible state.
- Add focused tests for every bug fixed.
- Every regression test must be shown to fail against the current pre-fix behavior, or the implementation report must explain why red-before-green proof was not practical.
- Manual smoke tests supplement automated checks; they do not replace deterministic tests for logic that can be exercised locally.
- Prefer small, reviewable commits or phases.
- Keep browser APIs behind thin seams when tests need fakes.
- UI disabled states must mirror library-level guards; never rely on UI-only prevention for keyboard, imperative, media, or export paths.

## Phase 0: Baseline And Safety Net

### Tasks

- Confirm current `npm test`, `npm run build`, and `npm audit --audit-level=moderate`.
- Add a short `docs/quality-pass/status.md` progress log while implementing.
- Add or update tests before changing each risky path where practical.
- Capture exact baseline dependency versions, test count, build result, and `npm audit --json` summary in `docs/quality-pass/status.md`.
- Establish shared test seams/fakes for browser APIs used across this pass: document visibility, MediaRecorder, getUserMedia/MediaStream tracks, canvas frame timing, and CacheStorage.
- Decide the step-count contract before persistence validation, export fixes, AI prompt/schema changes, or service-worker/browser smoke work. Record the decision in `docs/quality-pass/status.md`.
- Before changing `api/gemini.ts`, record the actual deployment target in `docs/quality-pass/status.md`. Default assumption from the current code is Vercel serverless Node; if that is wrong, update the security implementation notes before coding.
- Before changing `api/gemini.ts`, freeze the Gemini proxy contract in `docs/quality-pass/status.md`: allowed model list, allowed config keys, maximum request size, expected largest legitimate payload, production limiter backend, and access-control mode.

### Acceptance Criteria

- Baseline status is recorded.
- No unrelated files are changed.
- Any existing untracked tool artifacts are either explicitly left alone or removed only with user approval.
- Each phase records which regression tests were red before green, which checks were manual only, and why.

## Phase 1: Security Hardening

### 1. Harden `api/gemini.ts`

Problem: the Gemini proxy currently accepts arbitrary scripted POSTs with caller-selected model, contents, and generation config.

Plan:

- Inventory the current AI call sites before writing validation: model names, `contents` shapes, `config` keys, inline audio payload sizes, JSON schema usage, and `systemInstruction` shapes.
- Add an explicit model allowlist matching the app's actual needs.
- Validate request shape:
  - `contents` must be present and within a conservative serialized byte limit.
  - `config` may only include allowed generation fields.
  - numeric generation fields must be clamped or rejected outside limits.
  - `systemInstruction` must be string or a narrow REST-compatible object.
- Define a concrete `MAX_BODY_BYTES` that allows legitimate app payloads, including batch auto-tag audio, while rejecting abusive requests.
- Enforce body size by the actual read path where possible, not only by `Content-Length`, because chunked or missing lengths must not bypass the cap.
- Add an Origin/Referer allowlist as defense in depth; do not treat CORS absence or Gemini quota caps as sufficient abuse protection.
- Choose a spoof-resistant access-control mode before marking the finding closed: authenticated request, server-verified signed short-lived token, or another same-origin proof that a scripted client cannot forge by setting `Origin`.
- Add a rate-limit seam that is durable in production. In-memory or no-op limiting is development-only and cannot close the security finding.
- For the current Vercel-style target, prefer Vercel KV or Upstash Redis for the durable limiter. If neither a durable limiter nor spoof-resistant access control is configured, the implementation must fail closed for unauthenticated production requests unless the user explicitly approves leaving the Gemini relay abuse finding OPEN in `docs/quality-pass/status.md`.
- Tests must prove limiter behavior through an injected durable-store interface, including separate simulated invocations, not only a single in-process counter.
- Return stable error codes for invalid model/config/body/rate-limit.
- Ensure upstream errors are mapped to stable internal codes and do not echo sensitive provider details.

Validation:

- Unit tests for invalid method, missing key, invalid JSON, invalid model, disallowed config keys, oversized body with missing/understated `Content-Length`, disallowed Origin, limiter rejection, and valid proxy mapping.
- Tests that a forged-Origin request without the required access-control proof is rejected.
- Tests that a request pattern evading a single-process limiter still fails through the chosen durable limiter or access-control gate.
- Tests for Suggest, Variation, per-clip auto-tag, and batch auto-tag request shapes.
- Tests that upstream provider errors do not leak API keys or raw provider messages.
- Existing AI client tests still pass.

### 2. Address dependency advisories

Problem: `npm audit` reports critical Vitest UI/server issues and high Vite/ws/form-data advisories.

Plan:

- Classify each advisory as production-runtime, dev-server, test-only, or build-only before changing dependencies.
- Default to deferring Vite/Vitest major upgrades to a separate pass unless a reachable production-runtime critical/high advisory cannot be cleared without them.
- Upgrade the smallest safe set first:
  - Patch-level safe updates where available.
  - Vitest and Vite major updates only if the test/build config remains low-risk.
- Remove `@vitest/ui` first if it is not needed in day-to-day scripts; otherwise upgrade it with Vitest as its own isolated cluster.
- Re-run tests/build/audit after each dependency cluster.
- If a Vite/Vitest major upgrade is required, record the decision and rollback path in `docs/quality-pass/status.md` before proceeding.
- Do not add new large test dependencies until the existing dependency cleanup is stable.

Validation:

- `npm test` passes.
- `npm run build` passes.
- Test count before/after dependency updates is recorded; unexpected drops fail the phase.
- After any Vite/Vitest major bump, briefly introduce and revert one deliberately failing assertion to confirm the runner still reports failures.
- `npm audit --audit-level=moderate` has no production-runtime critical/high advisories; remaining dev/build-only advisories are documented with package, severity, reachability, and rationale.

## Phase 2: Media And Export Correctness

### Shared prerequisite: visibility and ownership coordinator

Tasks 3 and 4 both react to page visibility and both touch transport or stream ownership. Build one lifecycle coordinator before changing either path.

The coordinator must:

- Treat `streamLifecycle.ts` as the existing lifecycle owner rather than introducing a parallel listener.
- Know whether an export session currently owns the Tone transport and export stream.
- On hide while export is active, abort export and avoid running generic media suspend against export-owned streams.
- On hide while export is idle, run generic media release/suspend for the held recording/preview stream.
- Preserve the stale-stream guard already present in the stream lifecycle code.
- Avoid registering two independent `visibilitychange` handlers for the same ownership decisions.

### 3. Centralize media stream release/suspend

Problem: `installVisibilityListener()` clears the store stream on hide without stopping tracks or detaching lifecycle listeners.

Plan:

- Finish the existing lifecycle consolidation with one helper for intentional release and one helper for unexpected suspension.
- Ensure every transition that removes a live stream:
  - detaches `ended` listeners,
  - stops all tracks,
  - clears store state only if it still owns that stream,
  - leaves media status as `suspended` for unexpected loss and `granted` for intentional release.
- Make `setMedia` or acquisition logic release any previous live stream before replacing it, or enforce replacement through the central function.
- Review `resumeMedia()`, `acquirePreviewStream`, `releasePreviewStream`, `scratch`, and visibility handling against that invariant.
- Preserve RecordingStation's external preview-stream ownership: `recordIntoTrack()` must not release a stream it did not acquire.

Validation:

- Tests for visibility hide stopping tracks and detaching listeners.
- Tests for replacing one acquired stream with another without leaking the first.
- Tests for stale `ended` events not mutating a newer stream.
- Tests for double-release no-op behavior and release-after-replace not stopping the newer stream.

### 4. Make export abort on visibility loss or transport interruption

Problem: export owns the Tone transport, but page hide stops playback independently; export can finish with incomplete output.

Plan:

- Add an export session guard with `AbortController` or equivalent.
- When export starts, record that export owns the transport.
- Visibility hide should abort active export rather than merely stop playback.
- `exportSong()` should reject if:
  - document becomes hidden,
  - MediaRecorder stops early,
  - transport is externally stopped,
  - no chunks are produced.
- Ensure cleanup always clears progress, `isExporting`, transport state, and export stream tracks.
- During export, either snapshot the project state used by audio/video rendering or block project mutations that affect captured output: step toggles, step-count changes, mute/volume, showVideo, trim, and clip replacement.
- Define corrupted output concretely: zero chunks, truncated duration versus expected duration, decode failure, or explicit recorder/visibility interruption.

Validation:

- Unit tests for visibility-change abort.
- Unit tests for recorder early stop and cleanup.
- Tests that export errors surface through the export UI and always clear export state.
- Browser smoke test: start export, background tab, verify visible error and no corrupted download. This is supplemental to the automated checks.

### 5. Gate audible actions during recording/export

Problem: playback, pads, keyboard triggers, and spacebar can fire while recording is in countdown/recording/reviewing.

Plan:

- Add a central predicate such as `canStartAudibleAction(state)` and use it in:
  - `togglePlayback`,
  - `triggerTrackNow`,
  - `PlayButton`,
  - `PadGrid`,
  - `useKeyboardTriggers`,
  - `useSpacebarPlayToggle`,
  - export start.
- During recording, block playback and pad/keyboard triggers.
- During export, keep existing blocking behavior and make it consistent at both UI and library layers.
- Consider making `RecordCountdown` intercept pointer events during countdown/recording so accidental clicks do not pass through.
- Treat `countdown`, `recording`, and `reviewing` as blocked states unless a later implementation explicitly narrows the contract.

Validation:

- Tests for play button disabled during recording/export.
- Tests for keyboard and pad triggers no-op during recording/export.
- Tests for export start blocked during recording.
- Tests for the shared predicate directly, including the `countdown` state.

## Phase 3: Persistence And State Contracts

### 6. Add persisted project validation and recovery behavior

Problem: load/rehydrate trusts most persisted values and can silently drop clips or overwrite a partially recovered project.

Plan:

- Add a persisted schema version.
- Treat projects with no version field as legacy/v0 and migrate them forward; do not discard existing saves just because they lack a schema version.
- Define a field-by-field recovery matrix before implementation: clamp, normalize, drop clip, reset project, reject load, or preserve original.
- Validate and normalize:
  - bpm, swing, cut subdivision, same-tier hold, subgenre, vibe,
  - step count and track count,
  - track ids, steps arrays, volume, muted, showVideo, tag,
  - trim and duration fields.
- Clamp values that are safely recoverable; reject or reset values that break invariants.
- Record recovery warnings in store/UI instead of only `console.warn`.
- Before saving after a degraded recovery, keep a backup copy under a separate key or require a user-visible recovery acknowledgement.
- Rehydrate should return structured recovery status such as `{ ok, degraded, warnings }` instead of only boolean.
- Autosave must not overwrite the only recoverable corrupted copy before degraded recovery has been backed up or acknowledged.
- Keep backups bounded, for example one backup key, to avoid filling storage quota.

Validation:

- Tests for malformed `stepCount`, malformed rows, missing tracks, invalid tags, invalid trim windows, and corrupt clip blobs.
- Tests that degraded recovery does not immediately destroy the prior persisted project.
- Migration test for a realistic legacy/v0 persisted project with no schema version.

### 7. Fix autosave dirty-state loss

Problem: autosave drops a scheduled save if the timer fires while recording is active.

Plan:

- Track `dirtyWhileRecording`.
- If save is skipped because recording is not idle, flush when recording transitions back to idle.
- Surface save failures via logger and/or UI state rather than fire-and-forget silence.
- Use the same recording-idle definition as the audible-action gating predicate so state contracts do not diverge.

Validation:

- Test: project changes during recording, timer fires, recording returns idle, save eventually runs.
- Test: normal debounced save still runs once.
- Test: save failure is observable.

### 8. Resolve step-count invariant

Problem: types say step count is always a multiple of 4, but removing one column produces arbitrary lengths.

Plan:

- Choose one contract:
  - Option A: arbitrary loop lengths are supported; update types/comments, AI prompts, labels, and export assumptions.
  - Option B: loops must stay bar-aligned; change removal to remove groups of four or disable invalid removals.
- Prefer Option B for this quality pass unless playback, export duration, bar labels, README copy, AI prompts, and tests are all updated for arbitrary loop lengths.

Validation:

- Tests cover the chosen contract.
- README and UI copy match the behavior.

## Phase 4: Visual, PWA, And AI UX Correctness

### 9. Enforce visual trim end

Problem: audio playback respects trim end, but the video canvas keeps drawing the hidden video after the trimmed window.

Plan:

- Track displayed event elapsed time in `drawCurrentFrame`.
- After trim end:
  - freeze on final trimmed frame, clear to black, or hold poster; choose the least surprising behavior.
- Ensure repeated triggers still restart from trim start.

Validation:

- Unit test for drawing before and after trim end.
- Browser smoke test with visibly moving clip and short trim window.

### 10. Prevent AI suggestion overwrite races

Problem: Suggest and Variation snapshot the grid, await Gemini, then apply the returned grid even if the user edited meanwhile.

Plan:

- Add a store-level project/grid revision counter or hash.
- Increment it for `toggleStep`, `extendSteps`, `removeStepColumn`, `applyPattern`, hydrate/reset, and any project load/switch operation that changes the active grid.
- Capture revision before request.
- On response, apply only if revision, step count, and active project identity are unchanged.
- If changed, show a small conflict message and allow retry.

Validation:

- Tests for unchanged revision applies.
- Tests for changed revision does not overwrite user edits.
- Tests for project load/switch or step-count change while an AI request is pending.

### 11. Improve service worker caching

Problem: service worker precaches only `/` and `/index.html`; hashed JS/CSS are not cached for offline reload.

Plan:

- Prefer runtime-caching same-origin immutable hashed assets, such as Vite `/assets/` JS/CSS, after first fetch. Use build-time manifest injection only if runtime caching cannot meet the offline-reload acceptance criteria.
- Keep `/api/` network-only.
- Delete old versioned caches on activate.
- Define and document the update strategy, including `skipWaiting`/`clients.claim` behavior and a cache-bust recovery path for a bad service-worker deploy.

Validation:

- Test or integration check that current hashed JS/CSS assets are cached.
- Test that `/api/` requests are network-only and are never written to cache.
- Test that activate deletes prior versioned caches.
- Browser production-build smoke test: load once, go offline, hard-reload, and verify the app boots from cached shell plus assets.
- Browser production-build smoke test or documented manual procedure: deploy v1 then v2 and verify a returning client converges to v2.

## Phase 5: Test Quality And Browser Coverage

### 12. Clean React test warnings

Problem: tests pass but emit `act(...)` warnings, especially in components with async state/timers.

Plan:

- Wrap interactions and timer advances in Testing Library utilities or `act`.
- Prefer `userEvent` where it reflects user behavior.
- Keep tests deterministic with fake timers only where needed.

Validation:

- `npm test` passes without React `act(...)` warnings.
- `act(...)` and unexpected `console.error` warnings are machine-detected so they cannot be missed in scrollback.

### 13. Add real-browser smoke coverage

Problem: jsdom tests do not exercise real camera/media/export/PWA browser APIs.

Plan:

- Add Playwright or equivalent smoke tests only if dependency cleanup is stable and the added dependency impact is acceptable.
- Cover:
  - app loads,
  - service worker/offline shell in production preview,
  - keyboard gating,
  - export error path with mocked MediaRecorder/canvas capture,
  - visibility-change behavior.
- For real camera flows, prefer mocked media devices unless manual testing is required.
- Real camera permission automation is deferred unless a later implementation finds a low-cost, reliable path.

Validation:

- New browser smoke command documented.
- CI/local command passes without requiring real camera permission.

## Preferred Execution Order

1. Security hardening for Gemini and dependency advisories.
2. Step-count contract decision.
3. Shared test seams and lifecycle coordinator.
4. Media lifecycle centralization.
5. Export abort and audible-action gating.
6. Persistence validation and autosave.
7. Video trim-end and AI conflict prevention.
8. Service worker assets.
9. Test-warning cleanup and browser smoke tests.

## Implementation Agent Handoff

The implementation agent should:

- Work in a separate Codex worktree.
- Implement in small phases.
- Treat each numbered task as a separate phase boundary unless two tasks share an explicit prerequisite. Stop and report before continuing if a phase touches more than five production modules, requires a major dependency migration, or invalidates earlier acceptance criteria.
- Run relevant focused tests after each phase.
- Run full `npm test`, `npm run build`, and `npm audit --audit-level=moderate` before reporting.
- Avoid UI redesigns.
- Avoid destructive git commands.
- Record what changed, tests run, remaining risks, and any intentionally deferred findings.
- Report any manual-only validation separately from automated validation.

## Definition Of Done

- All P1/P2 audit issues are either fixed or explicitly deferred with rationale.
- Full test and build pass.
- Security advisories are reduced to no critical/high issues or documented.
- Media stream lifecycle has one clear ownership contract.
- Export cannot silently produce known-bad output after page hide/interruption.
- Persistence has validation and safe recovery behavior.
- New tests cover the fixed failure modes.
- Regression tests are red-before-green where practical.
- Remaining dependency advisories are classified by package, severity, reachability, and rationale.
- Final report explains what was fixed, what remains, and how to verify.
