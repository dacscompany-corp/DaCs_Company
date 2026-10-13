/**
 * DAC's Portal — AI proxy (Cloudflare Worker, Workers AI)
 * ----------------------------------------------------------------
 * Runs Cloudflare Workers AI for two portal features:
 *   budget_summary  — Project Control AI budget summary (js/ai-summary.js)
 *   health_briefing — Project Control AI health briefing (js/ai-assistant.js)
 *   work_plan_draft — Work Plan meeting drafts (js/workplan-admin-core.js)
 *
 * Every request must carry the caller's Supabase session. Before any
 * model runs, the worker (1) refuses a missing token, (2) applies a cheap
 * per-address flood guard, (3) refuses oversized or malformed requests,
 * then (4) calls ai_authorize() (migration 0095) AS THE CALLER, which
 * checks the account is active and allowed this feature, the input size
 * and the per-person / per-company limits, and records the request. The
 * model and the answer length are chosen HERE per feature; any model the
 * browser names is ignored. CORS only stops other websites' pages; it is
 * not the security.
 *
 * Config (wrangler.toml): [ai] binding AI; [vars] SUPABASE_URL and
 * SUPABASE_ANON_KEY (public, the same as js/supabase-config.js); the
 * PREAUTH_LIMITER rate-limit binding. Deploy: npx wrangler deploy
 */

// Only allow requests from these origins (add your live URL when you deploy).
const ALLOWED_ORIGINS = [
  'http://127.0.0.1:5501',
  'http://localhost:5501',
  'https://dacs-company.vercel.app',   // production (Vercel)
];

// Llama 3.3 70B fp8-fast for both features. Llama 3.1 8B was retired by
// Cloudflare on 30 May 2026. Check `npx wrangler ai models` before
// changing a model; the Llama models answer in a `response` field.
const MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
const FEATURES = {
  budget_summary:  { model: MODEL, maxTokens: 700,  maxChars: 4000 },
  health_briefing: { model: MODEL, maxTokens: 600,  maxChars: 12000 },
  work_plan_draft: { model: MODEL, maxTokens: 2000, maxChars: 40000 },
};
const MAX_BODY_BYTES = 65536;
const MAX_MESSAGES = 4;

// ai_authorize() refusals → HTTP status. Anything unexpected fails closed.
const GATE_STATUS = { AI_NOT_SIGNED_IN: 401, AI_NOT_ALLOWED: 403, AI_TOO_LARGE: 413, AI_RATE_LIMITED: 429 };
const MESSAGES = {
  AI_NOT_SIGNED_IN: 'Sign in again to use the AI.',
  AI_NOT_ALLOWED: 'This account cannot use this AI feature.',
  AI_TOO_LARGE: 'Too much text for the AI. Shorten it and try again.',
  AI_RATE_LIMITED: 'AI limit reached. Try again later.',
  AI_BAD_REQUEST: 'The AI request could not be read.',
  AI_GATE_UNAVAILABLE: 'The AI is not available right now. Try again.',
  AI_FAILED: 'The AI did not answer. Try again.',
};

function corsHeaders(origin) {
  // Allow the explicit list plus any Vercel deployment (production + previews).
  const ok = ALLOWED_ORIGINS.includes(origin) || /^https:\/\/[a-z0-9-]+\.vercel\.app$/i.test(origin);
  const allow = ok ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Vary': 'Origin',
  };
}

export default {
  async fetch(request, env) {
    const cors = corsHeaders(request.headers.get('Origin') || '');

    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
    if (request.method !== 'POST') {
      return new Response('POST only', { status: 405, headers: cors });
    }

    // 1. A session token, before anything else runs.
    const auth = /^Bearer ([A-Za-z0-9._~+\/=-]+)$/.exec(request.headers.get('Authorization') || '');
    if (!auth) return fail('AI_NOT_SIGNED_IN', 401, cors);

    // 2. Flood guard per connecting address (approximate by design; the
    //    real per-account limits are in ai_authorize()).
    if (env.PREAUTH_LIMITER) {
      const { success } = await env.PREAUTH_LIMITER.limit({ key: request.headers.get('CF-Connecting-IP') || 'unknown' });
      if (!success) return fail('AI_RATE_LIMITED', 429, cors);
    }

    // 3. Size and shape, before the database.
    if (Number(request.headers.get('Content-Length') || 0) > MAX_BODY_BYTES) return fail('AI_TOO_LARGE', 413, cors);
    const raw = await request.text();
    if (new TextEncoder().encode(raw).length > MAX_BODY_BYTES) return fail('AI_TOO_LARGE', 413, cors);
    let body;
    try {
      body = JSON.parse(raw);
    } catch {
      return fail('AI_BAD_REQUEST', 400, cors);
    }
    const feature = body && Object.prototype.hasOwnProperty.call(FEATURES, body.feature) ? FEATURES[body.feature] : null;
    const messages = body && body.messages;
    if (!feature || !Array.isArray(messages) || !messages.length || messages.length > MAX_MESSAGES
        || !messages.every(m => m && (m.role === 'system' || m.role === 'user') && typeof m.content === 'string')) {
      return fail('AI_BAD_REQUEST', 400, cors);
    }
    const chars = messages.reduce((n, m) => n + m.content.length, 0);
    if (chars > feature.maxChars) return fail('AI_TOO_LARGE', 413, cors);

    // 4. The account, feature, size and limits — decided and recorded by
    //    the database, as the caller.
    let gate;
    try {
      gate = await fetch(env.SUPABASE_URL + '/rest/v1/rpc/ai_authorize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: env.SUPABASE_ANON_KEY, Authorization: 'Bearer ' + auth[1] },
        body: JSON.stringify({ p_feature: body.feature, p_chars: chars }),
      });
    } catch {
      return fail('AI_GATE_UNAVAILABLE', 503, cors);
    }
    if (!gate.ok) {
      let info = null;
      try { info = await gate.json(); } catch { info = null; }
      const code = (/AI_[A-Z_]+/.exec(String((info && info.message) || '')) || [])[0];
      if (code && GATE_STATUS[code]) return fail(code, GATE_STATUS[code], cors);
      if (gate.status === 401) return fail('AI_NOT_SIGNED_IN', 401, cors);
      if (gate.status >= 500) return fail('AI_GATE_UNAVAILABLE', 503, cors);
      return fail('AI_NOT_ALLOWED', 403, cors);
    }

    if (!env.AI) return fail('AI_FAILED', 502, cors);
    try {
      const result = await env.AI.run(feature.model, {
        messages,
        temperature: Math.min(Math.max(Number(body.temperature ?? 0.4) || 0, 0), 1),
        max_tokens: Math.max(1, Math.min(Number(body.max_tokens) || feature.maxTokens, feature.maxTokens)),
      });
      // OpenAI-shaped response so the portal reads choices[0].message.content.
      return json({ choices: [{ message: { role: 'assistant', content: answerText(result) } }] }, 200, cors);
    } catch (err) {
      console.error('Workers AI error: ' + (err && err.message ? err.message : String(err)));
      return fail('AI_FAILED', 502, cors);
    }
  },
};

// Llama models answer in `response`; OpenAI-style models in `choices`.
function answerText(result) {
  if (!result) return '';
  if (result.response && typeof result.response === 'object') return JSON.stringify(result.response);
  if (typeof result.response === 'string') return result.response;
  if (result.result && typeof result.result.response === 'string') return result.result.response;
  const msg = result.choices && result.choices[0] && result.choices[0].message;
  return msg && typeof msg.content === 'string' ? msg.content : '';
}

function fail(code, status, cors) {
  return json({ error: { code, message: MESSAGES[code] } }, status, cors);
}

function json(obj, status, cors) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}
