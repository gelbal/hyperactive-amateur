# AI key migration

The Hyperpad v1 build includes an Anthropic API key in the client bundle via
`VITE_ANTHROPIC_API_KEY`. **This is fine for local development only.** Anything
publicly deployed will leak the key to anyone who opens DevTools.

## Migration checklist

Before deploying to a real domain:

1. **Remove the key from `.env.local`**, `.env`, and the build environment.
2. **Add a server proxy.** On Vercel / Cloudflare Pages, drop in an Edge
   Function at `/api/suggest-pattern`. A reference implementation:

   ```ts
   // api/suggest-pattern.ts (Vercel Edge Function)
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

3. **Point the client at the proxy.** Replace the `Anthropic` SDK call in
   `src/lib/aiSuggest.ts` with:

   ```ts
   const r = await fetch("/api/suggest-pattern", {
     method: "POST",
     headers: { "content-type": "application/json" },
     body: JSON.stringify(messagesParams),
   });
   const response = await r.json();
   ```

   Drop `dangerouslyAllowBrowser` and the env-var read.

4. **Verify in DevTools.** The Network panel for a `Suggest a beat` click
   should show `POST /api/suggest-pattern`, never `api.anthropic.com`.

5. **Remove the build-time warning** (`src/main.tsx`) once the key is gone.

That's it — about 30 lines of code total.
