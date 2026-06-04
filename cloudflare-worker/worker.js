/**
 * DAC's Portal — AI proxy (Cloudflare Worker, free tier)
 * ----------------------------------------------------------------
 * Uses Cloudflare Workers AI (runs ON Cloudflare — no external API
 * call, no IP blocking, no API key). The portal POSTs a chat-style
 * { messages: [...] } payload; we return an OpenAI-shaped response
 * so the frontend needs no changes.
 *
 * Requires the [ai] binding in wrangler.toml.  Deploy: npx wrangler deploy
 */

// Only allow requests from these origins (add your live URL when you deploy).
const ALLOWED_ORIGINS = [
  'http://127.0.0.1:5501',
  'http://localhost:5501',
  'https://dacs-company.vercel.app',   // production (Vercel)
  // 'https://your-app.web.app',       // ← add your Firebase Hosting URL here too if used
];

// Workers AI model. Swap to '@cf/meta/llama-3.3-70b-instruct-fp8-fast' for
// richer summaries (uses more neurons); the 8b model is fast and free-friendly.
const MODEL = '@cf/meta/llama-3.1-8b-instruct';

function corsHeaders(origin) {
  // Allow the explicit list plus any Vercel deployment (production + previews).
  const ok = ALLOWED_ORIGINS.includes(origin) || /^https:\/\/[a-z0-9-]+\.vercel\.app$/i.test(origin);
  const allow = ok ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin',
  };
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const cors = corsHeaders(origin);

    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
    if (request.method !== 'POST') {
      return new Response('POST only', { status: 405, headers: cors });
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: { message: 'Invalid JSON body' } }, 400, cors);
    }

    if (!Array.isArray(body.messages) || !body.messages.length) {
      return json({ error: { message: '`messages` array required' } }, 400, cors);
    }

    if (!env.AI) {
      return json({ error: { message: 'Workers AI binding not configured (check wrangler.toml [ai])' } }, 500, cors);
    }

    try {
      const result = await env.AI.run(body.model || MODEL, {
        messages: body.messages,
        temperature: body.temperature ?? 0.4,
        max_tokens: body.max_tokens ?? 700,
      });

      const content =
        (result && (result.response != null ? result.response : (result.result && result.result.response))) || '';

      // OpenAI-shaped response so the frontend can stay unchanged.
      return json({ choices: [{ message: { role: 'assistant', content } }] }, 200, cors);
    } catch (err) {
      return json({ error: { message: 'Workers AI error: ' + (err && err.message ? err.message : String(err)) } }, 500, cors);
    }
  },
};

function json(obj, status, cors) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}
