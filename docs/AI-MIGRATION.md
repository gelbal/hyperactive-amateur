# AI key migration

The current Hyperactive Amateur build includes two API keys in the
client bundle:

- `VITE_ANTHROPIC_API_KEY` for "Suggest a beat" + variations.
- `VITE_GEMINI_API_KEY` for clip auto-tagging.

**This is fine for local development only.** Anything publicly deployed
will leak both keys to anyone who opens DevTools.

## Migration checklist

Before deploying to a real domain:

1. **Remove both keys** from `.env.local`, `.env`, and the build
   environment.
2. **Add server proxies** for each provider. On Vercel / Cloudflare
   Pages, drop in two Edge Functions.

   `api/suggest-pattern.ts` (Anthropic):

   ```ts
   export const config = { runtime: "edge" };

   export default async function handler(req: Request): Promise<Response> {
     if (req.method !== "POST") return new Response("nope", { status: 405 });
     const body = await req.text();
     const r = await fetch("https://api.anthropic.com/v1/messages", {
       method: "POST",
       headers: {
         "content-type": "application/json",
         "x-api-key": process.env.ANTHROPIC_API_KEY!,
         "anthropic-version": "2023-06-01",
       },
       body,
     });
     return new Response(r.body, {
       status: r.status,
       headers: { "content-type": "application/json" },
     });
   }
   ```

   `api/auto-tag.ts` (Gemini): same shape, forwarding to
   `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent`
   with the `x-goog-api-key` header.

3. **Point the client at the proxies.** Replace the SDK calls in
   `src/lib/aiSuggest.ts` and `src/lib/aiAutoTag.ts` with `fetch` to
   `/api/suggest-pattern` and `/api/auto-tag`. Drop
   `dangerouslyAllowBrowser` and the env-var reads.

4. **Verify in DevTools.** The Network panel should show
   `POST /api/suggest-pattern` and `POST /api/auto-tag` — never
   `api.anthropic.com` or `generativelanguage.googleapis.com` directly.

5. **Remove the build-time warnings** (`src/main.tsx`) once the keys
   are gone.

That's it — about 60 lines of code total across both functions.
