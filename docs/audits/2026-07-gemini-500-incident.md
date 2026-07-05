# Gemini 500 root cause

## Live probe results (exact requests + responses)

All API probes used `Origin: https://hyperactive-amateur.fgelbal.com` and browser-like Fetch Metadata headers so the production guard at `api/gemini.ts:363-377` would not be the first rejection. I made 5 live requests total: one HTML fetch and four API probes.

### 1. Site HTML

Request:

```sh
curl -sS -D /tmp/ha-html-headers.txt -o /tmp/ha-index.html https://hyperactive-amateur.fgelbal.com/
```

Response headers captured:

```text
HTTP/1.1 200 Connection established

HTTP/2 200
accept-ranges: bytes
access-control-allow-origin: *
age: 42732
cache-control: public, max-age=0, must-revalidate
content-disposition: inline
content-type: text/html; charset=utf-8
date: Sun, 05 Jul 2026 06:08:56 GMT
etag: "ab87282761c46600b599d94fa73663d4"
last-modified: Sat, 04 Jul 2026 18:16:44 GMT
server: Vercel
strict-transport-security: max-age=63072000
x-vercel-cache: HIT
x-vercel-id: cdg1::tl4zj-1783231736678-8bc63340c5c7
content-length: 2089
```

The deployed HTML references:

```html
<script type="module" crossorigin src="/assets/index-CPOD2tYm.js"></script>
<link rel="stylesheet" crossorigin href="/assets/index-BpLIWp6J.css">
```

### 2. `GET /api/gemini-token`

Request:

```sh
curl -i -sS -X GET 'https://hyperactive-amateur.fgelbal.com/api/gemini-token' \
  -H 'Origin: https://hyperactive-amateur.fgelbal.com' \
  -H 'Sec-Fetch-Site: same-origin' \
  -H 'Sec-Fetch-Mode: cors' \
  -H 'Sec-Fetch-Dest: empty'
```

Response:

```text
HTTP/1.1 200 Connection established

HTTP/2 500
cache-control: public, max-age=0, must-revalidate
content-type: text/plain; charset=utf-8
date: Sun, 05 Jul 2026 06:09:04 GMT
server: Vercel
strict-transport-security: max-age=63072000
x-vercel-cache: MISS
x-vercel-error: FUNCTION_INVOCATION_FAILED
x-vercel-id: cdg1::6pcpp-1783231743332-33846e9374dd
content-length: 96

A server error has occurred

FUNCTION_INVOCATION_FAILED

cdg1::6pcpp-1783231743332-33846e9374dd
```

Expected from source: JSON 405 from `handleGeminiTokenRequest()` before any env, limiter, token, or body work (`api/gemini.ts:685-688`). The live response proves this route is crashing before or outside the handler body.

### 3. `GET /api/gemini`

Request:

```sh
curl -i -sS -X GET 'https://hyperactive-amateur.fgelbal.com/api/gemini' \
  -H 'Origin: https://hyperactive-amateur.fgelbal.com' \
  -H 'Sec-Fetch-Site: same-origin' \
  -H 'Sec-Fetch-Mode: cors' \
  -H 'Sec-Fetch-Dest: empty'
```

Response:

```text
HTTP/1.1 200 Connection established

HTTP/2 405
age: 0
cache-control: no-store
content-type: application/json
date: Sun, 05 Jul 2026 06:09:08 GMT
server: Vercel
strict-transport-security: max-age=63072000
x-vercel-cache: MISS
x-vercel-id: cdg1::iad1::4tbhc-1783231748033-5874cc827d59

{"error":"method-not-allowed"}
```

This route reaches the source handler and returns the expected guard at `api/gemini.ts:607-610`.

### 4. `POST /api/gemini-token`

Request:

```sh
curl -i -sS -X POST 'https://hyperactive-amateur.fgelbal.com/api/gemini-token' \
  -H 'Origin: https://hyperactive-amateur.fgelbal.com' \
  -H 'Sec-Fetch-Site: same-origin' \
  -H 'Sec-Fetch-Mode: cors' \
  -H 'Sec-Fetch-Dest: empty' \
  -H 'Content-Type: application/json' \
  --data '{}'
```

Response:

```text
HTTP/1.1 200 Connection established

HTTP/2 500
cache-control: public, max-age=0, must-revalidate
content-type: text/plain; charset=utf-8
date: Sun, 05 Jul 2026 06:09:18 GMT
server: Vercel
strict-transport-security: max-age=63072000
x-vercel-cache: MISS
x-vercel-error: FUNCTION_INVOCATION_FAILED
x-vercel-id: cdg1::tl4zj-1783231758569-e42e3a1b70ea
content-length: 96

A server error has occurred

FUNCTION_INVOCATION_FAILED

cdg1::tl4zj-1783231758569-e42e3a1b70ea
```

Expected from source if production env were incomplete: JSON `{"error":"no-key"}` at `api/gemini.ts:696-698`, `{"error":"limiter-unconfigured"}` at `api/gemini.ts:700-706`, or a token at `api/gemini.ts:709-712`. The live response again proves a function crash before clean fail-closed handling.

### 5. `POST /api/gemini`

Request:

```sh
curl -i -sS -X POST 'https://hyperactive-amateur.fgelbal.com/api/gemini' \
  -H 'Origin: https://hyperactive-amateur.fgelbal.com' \
  -H 'Sec-Fetch-Site: same-origin' \
  -H 'Sec-Fetch-Mode: cors' \
  -H 'Sec-Fetch-Dest: empty' \
  -H 'Content-Type: application/json' \
  --data '{"model":"gemini-3.1-flash-lite","contents":[{"role":"user","parts":[{"text":"Return JSON: {\"ok\":true}"}]}],"config":{"responseMimeType":"application/json","responseSchema":{"type":"OBJECT","properties":{"ok":{"type":"BOOLEAN"}},"required":["ok"]}}}'
```

Response:

```text
HTTP/1.1 200 Connection established

HTTP/2 503
cache-control: no-store
content-type: application/json
date: Sun, 05 Jul 2026 06:09:23 GMT
server: Vercel
strict-transport-security: max-age=63072000
x-vercel-cache: MISS
x-vercel-id: cdg1::iad1::t9mtf-1783231763566-f7d77c520bd9

{"error":"limiter-unconfigured"}
```

This is a graceful fail-closed response from `enforceRateLimit()` (`api/gemini.ts:575-589`) after origin and API key checks. It means the main proxy function is deployed and invoking correctly, `GEMINI_API_KEY` is present, and the origin is accepted; the durable limiter env is missing or invalid.

Focused local verification:

```text
npm test -- api/gemini.test.ts src/lib/aiHttpClient.test.ts
Test Files  2 passed (2)
Tests  53 passed (53)
```

## Crash-path analysis (file:line)

Vercel says `FUNCTION_INVOCATION_FAILED` can be a runtime crash or an unhandled exception/rejection. Official Vercel Node docs also say `/api/*.ts` functions may use the `export default { fetch(request) { ... } }` Web Standard export and that Node functions support standard Web APIs such as `Request` and `Response`:

- https://vercel.com/docs/errors/function_invocation_failed
- https://vercel.com/docs/functions/runtimes/node-js

Code paths inspected:

- **Top-level module code, shared proxy:** `api/gemini.ts` imports `node:crypto` at `api/gemini.ts:3`, declares constants/Sets at `api/gemini.ts:5-29`, and initializes only module-local nullable state at `api/gemini.ts:58-59`. If `node:crypto`, `Response`, or other Web APIs were absent globally, `/api/gemini` would also fail. Live `GET /api/gemini` returned the expected JSON 405, so this shared module is loadable in production.
- **Top-level module code, token route:** `api/gemini-token.ts` only imports `handleGeminiTokenRequest` from `./gemini` (`api/gemini-token.ts:3`) and exports `{ fetch: handleGeminiTokenRequest }` (`api/gemini-token.ts:5-7`). Since both GET and POST crash before the first line of `handleGeminiTokenRequest()` can return a 405/503/200, the crash is at token-route module packaging/import/export invocation, not inside token business logic.
- **Handler export shape:** `api/gemini.ts` exports the same `{ fetch }` shape at `api/gemini.ts:724-729`, and it works live. `api/gemini-token.ts` uses the same shape at `api/gemini-token.ts:5-7`, but crashes live. The suspicious difference is deployment config: `vercel.json` only mentions `api/gemini.ts` (`vercel.json:3-7`) and does not mention `api/gemini-token.ts`. This is not supposed to be required according to current Vercel docs, but it is the only local config asymmetry that matches the live split.
- **Env parsing:** `readEnv()` only trims strings and returns undefined for blank env (`api/gemini.ts:80-83`). Integer parsing falls back on invalid values (`api/gemini.ts:85-104`). Limiter URL parsing catches invalid URLs and rejects non-HTTPS limiter URLs in production without throwing (`api/gemini.ts:545-557`).
- **Origin allowlist:** Origin handling catches malformed Referer and origin values (`api/gemini.ts:301-311`, `api/gemini.ts:313-360`). Live `POST /api/gemini` reached the limiter check, so origin validation is not the current production blocker.
- **Fetch Metadata:** In production, missing/non-browser Fetch Metadata returns JSON `browser-fetch-required` (`api/gemini.ts:363-377`). The probes included these headers, and `/api/gemini` reached the limiter. Not the crash.
- **API key:** `/api/gemini` returns JSON `no-key` if `GEMINI_API_KEY` is absent (`api/gemini.ts:615-618`). Live `POST /api/gemini` reached the later limiter guard, so `GEMINI_API_KEY` is present in production.
- **Limiter configuration:** `configuredRateLimitStore()` returns an Upstash/Vercel KV REST store only when a URL/token pair exists (`api/gemini.ts:559-568`), returns `null` in production without one (`api/gemini.ts:570`), and `enforceRateLimit()` maps that to JSON `limiter-unconfigured` 503 (`api/gemini.ts:575-580`). Live `POST /api/gemini` proves this graceful path is currently active.
- **Limiter REST calls:** Upstash `fetch()`/non-OK/invalid JSON/invalid payload failures can throw inside `UpstashRateLimitStore.increment()` (`api/gemini.ts:519-542`), but `enforceRateLimit()` catches `store.increment()` errors and returns JSON `rate-limit-unavailable` 503 (`api/gemini.ts:584-589`). This is not an uncaught crash path.
- **Request token crypto:** `createSignedRequestToken()` calls `randomBytes()` and HMAC signing (`api/gemini.ts:442-455`), and `handleGeminiTokenRequest()` does not wrap that call (`api/gemini.ts:709-710`). A low-level crypto failure could crash. However, live `GET /api/gemini-token` crashes even though the method guard at `api/gemini.ts:685-688` should return before crypto. So crypto is not the observed crash.
- **Token validation:** Bad/missing request tokens are handled as JSON 401 in production (`api/gemini.ts:458-495`, used at `api/gemini.ts:632-633`). HMAC comparison length-checks before `timingSafeEqual()` (`api/gemini.ts:429-433`). Not the current crash.
- **Request body handling:** `readBodyWithLimit()` manually reads a Web `ReadableStream` (`api/gemini.ts:270-299`). A stream read error or a non-Web request object could throw because there is no local try/catch around `reader.read()`. This could affect `/api/gemini` POSTs if the runtime handed in a Node `IncomingMessage` instead of a Web `Request`, but live `/api/gemini` POST reached the limiter before body reads, and token route does not read a body. Not the observed token crash.
- **Upstream Gemini call:** Network/upstream fetch failures are caught (`api/gemini.ts:656-672`), and upstream status codes are redacted into stable JSON errors (`api/gemini.ts:600-604`, `api/gemini.ts:674`). Not reached in live probes because the limiter fails closed first.
- **Client error surface:** The deployed client fetches `/api/gemini-token` before posting `/api/gemini` (`src/lib/aiHttpClient.ts:74-82`, `src/lib/aiHttpClient.ts:103-110`). A 500 token response is mapped to `Gemini proxy 500: <body>` (`src/lib/aiHttpClient.ts:46-56`, `src/lib/aiHttpClient.ts:90-92`). That exactly matches the owner-visible `Gemini proxy 500: A server error has occurred FUNCTION_INVOCATION_FAILED ...` string.

## Ranked root causes with evidence

1. **Most likely: `/api/gemini-token.ts` is deployed/invoked with a broken function wrapper or route packaging.**

   Evidence: `GET /api/gemini-token` should return `{"error":"method-not-allowed"}` at `api/gemini.ts:685-688`, before any env or token code. Instead it returns Vercel text 500 with `x-vercel-error: FUNCTION_INVOCATION_FAILED`. `POST /api/gemini-token` also crashes. The token route file contains almost no logic of its own beyond `import { handleGeminiTokenRequest } from "./gemini"` and `export default { fetch: handleGeminiTokenRequest }` (`api/gemini-token.ts:3-7`). The sibling `/api/gemini` route with the shared module and same style export works live (`api/gemini.ts:724-729`). The one deployment config asymmetry is that `vercel.json` configures only `api/gemini.ts` (`vercel.json:3-7`), not `api/gemini-token.ts`.

   Confidence: **High** that the crash is before the token handler body. **Medium** that the exact cause is the export/config asymmetry; the Vercel runtime logs for the captured `x-vercel-id` values are needed to distinguish "default export object not callable" from an import-resolution/bundling fault.

2. **Definitely present but not the `FUNCTION_INVOCATION_FAILED`: missing/invalid durable limiter env in production.**

   Evidence: live `POST /api/gemini` returned `{"error":"limiter-unconfigured"}` with no `x-vercel-error`. That maps exactly to `configuredRateLimitStore()` returning `null` in production (`api/gemini.ts:559-570`) and `enforceRateLimit()` returning a clean 503 (`api/gemini.ts:575-580`). The quality-pass contract requires a durable Upstash/Vercel-KV-style limiter in production (`docs/quality-pass/status.md:35`) and the README says production deploys fail closed without it (`README.md:75-88`).

   Confidence: **High**.

3. **Not likely: missing `GEMINI_API_KEY` or bad origin config.**

   Evidence: `/api/gemini` checks the API key before limiter enforcement (`api/gemini.ts:615-623`) and validates origin before the API key (`api/gemini.ts:612-618`). The live response reached `limiter-unconfigured`, so the origin was accepted and `GEMINI_API_KEY` was present. The docs require origin config (`docs/quality-pass/status.md:36`, `README.md:77-84`), but origin is not the live blocker.

   Confidence: **High**.

4. **Possible but not evidenced: unhandled crypto/body/runtime exceptions.**

   Evidence: token signing has no outer catch around `randomBytes()`/HMAC (`api/gemini.ts:442-455`, `api/gemini.ts:709-710`), and body stream reads can throw (`api/gemini.ts:270-299`). These should be hardened, but they cannot explain `GET /api/gemini-token` crashing before the method guard.

   Confidence: **Low** for the current incident, **medium** as future hardening work.

## Fix plan (code + env/config)

### Code/config changes

1. Make the token route impossible to deploy as an invalid handler:
   - Add `api/gemini-token.ts` to `vercel.json` with the same function config as `api/gemini.ts`, at minimum:

     ```json
     {
       "functions": {
         "api/gemini.ts": { "maxDuration": 60 },
         "api/gemini-token.ts": { "maxDuration": 60 }
       }
     }
     ```

   - Also export named HTTP method handlers for both API files, because Vercel documents method exports as an alternative to the `{ fetch }` Web export. For example:

     ```ts
     export const POST = handleGeminiTokenRequest;
     export const GET = handleGeminiTokenRequest;
     export default { fetch: handleGeminiTokenRequest };
     ```

     Do the same for `handleGeminiRequest`. Keeping `GET` routed through the same handler preserves the existing JSON 405 guard.

2. Add an outer crash boundary at the exported Vercel route layer. The current handler internals mostly fail closed, but exported functions should catch any unexpected throw and return a clean JSON 503, with server-side `console.error` including a route label. This should wrap both `handleGeminiRequest()` and `handleGeminiTokenRequest()`.

   Desired production behavior for any unexpected throw:

   ```json
   {"error":"proxy-internal-error"}
   ```

   with status `503`, `cache-control: no-store`, and no provider secrets in the body.

3. Add a deploy smoke check that hits:
   - `GET /api/gemini-token` -> JSON 405, no `x-vercel-error`.
   - `POST /api/gemini-token` with same-origin Fetch Metadata -> JSON 503 `limiter-unconfigured` when limiter env is intentionally absent, or 200 token when configured.
   - `GET /api/gemini` -> JSON 405, no `x-vercel-error`.

4. Add a regression test that exercises the actual default export shape from `api/gemini-token.ts`, not only the named `handleGeminiTokenRequest()` imported from `api/gemini.ts`. Current tests cover handler behavior (`api/gemini.test.ts:271-283`) and client behavior, but not the Vercel entry module shape.

### Required Vercel production env vars

Set these in Vercel for the **Production** environment; also set Preview values if AI should work on preview deployments.

```sh
GEMINI_API_KEY=<Google AI Studio/Gemini API key>
GEMINI_ALLOWED_ORIGINS=https://hyperactive-amateur.fgelbal.com

# Upstash Redis REST, preferred:
UPSTASH_REDIS_REST_URL=https://<your-upstash-rest-endpoint>
UPSTASH_REDIS_REST_TOKEN=<your-upstash-rest-token>

# Or Vercel KV aliases instead of the Upstash names:
KV_REST_API_URL=https://<your-vercel-kv-rest-endpoint>
KV_REST_API_TOKEN=<your-vercel-kv-rest-token>

# Strongly recommended separate signing secret:
GEMINI_REQUEST_TOKEN_SECRET=<random 32+ byte secret, e.g. openssl rand -base64 32>

# Optional; defaults already exist in code:
GEMINI_RATE_LIMIT_MAX=60
GEMINI_RATE_LIMIT_WINDOW_SECONDS=600
GEMINI_REQUEST_TOKEN_TTL_SECONDS=120
```

Notes:

- The limiter URL must be HTTPS in production (`api/gemini.ts:545-557`, `README.md:87-88`).
- The code also accepts `VERCEL_PROJECT_PRODUCTION_URL`, `VERCEL_BRANCH_URL`, and `VERCEL_URL` as origin sources (`api/gemini.ts:332-335`, `docs/quality-pass/status.md:36`), but the README still recommends explicitly listing the custom domain (`README.md:99-102`).
- `GEMINI_API_KEY` appears to be present already, because live `/api/gemini` got past the key check to `limiter-unconfigured`.

## What to verify after deploying the fix

1. Check Vercel runtime logs for the captured token-route IDs:
   - `cdg1::6pcpp-1783231743332-33846e9374dd`
   - `cdg1::tl4zj-1783231758569-e42e3a1b70ea`

   The expected stack should point at token route invocation/handler export or module import, not limiter/env business logic.

2. Re-run the same probes:
   - `GET /api/gemini-token` should return `405 {"error":"method-not-allowed"}` with no `x-vercel-error`.
   - `POST /api/gemini-token` should return `200 {"token": "...", "expiresAt": ...}` once the limiter env is set.
   - `POST /api/gemini` without `x-ha-gemini-token` should return `401 {"error":"request-token-required"}` once the limiter env is set.
   - `POST /api/gemini` with a freshly minted token and minimal valid body should return either a Gemini JSON 200 or a sanitized proxy JSON error, never Vercel plain-text `FUNCTION_INVOCATION_FAILED`.

3. Trigger each in-app AI feature from the deployed page:
   - Suggest pattern.
   - Variation.
   - Single clip auto-tag.
   - Batch auto-tag.

   Confirm the browser no longer shows `Gemini proxy 500: A server error has occurred FUNCTION_INVOCATION_FAILED`.

4. Confirm `/api/` remains network-only through the service worker. The status doc says `/api/` is network-only (`docs/quality-pass/status.md:135-137`), so a stale service worker should not cache these 500s, but a hard reload after deployment is still a useful sanity check.
