# AI key migration

The current Hyperactive Amateur build includes a single API key in
the client bundle:

- `GEMINI_API_KEY` — auto-tagging clips, "Suggest a beat", and the
  pattern variation buttons.

**This is fine for local development only.** Anything publicly
deployed will leak the key to anyone who opens DevTools.

## Migration checklist

Before deploying to a real domain:

1. **Remove the key** from `.env.local`, `.env`, and the build
   environment.
2. **Add a server proxy.** On Vercel / Cloudflare Pages, drop in an
   Edge Function. Reference implementation at `api/gemini.ts`:

   ```ts
   export const config = { runtime: "edge" };

   export default async function handler(req: Request): Promise<Response> {
     if (req.method !== "POST") return new Response("nope", { status: 405 });
     const body = await req.text();
     const r = await fetch(
       "https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent",
       {
         method: "POST",
         headers: {
           "content-type": "application/json",
           "x-goog-api-key": process.env.GEMINI_API_KEY!,
         },
         body,
       },
     );
     return new Response(r.body, {
       status: r.status,
       headers: { "content-type": "application/json" },
     });
   }
   ```

3. **Point the client at the proxy.** Replace the `GoogleGenAI`
   client construction in `src/lib/aiSuggest.ts` and
   `src/lib/aiAutoTag.ts` with `fetch("/api/gemini", ...)`. Drop
   the env-var reads in both files.

4. **Verify in DevTools.** The Network panel should show requests
   only to `/api/gemini`, never to `generativelanguage.googleapis.com`
   directly.

5. **Remove the build-time warning** in `src/main.tsx` once the
   key is gone.

That's it — about 30 lines of code total.
