// ════════════════════════════════════════════════════════════════════
// AI WORKER TESTS:  node tests/ai-worker.test.js
//
// Runs the REAL cloudflare-worker/worker.js in Node with a fake Workers AI,
// a fake rate limiter and a fake Supabase ai_authorize(). Proves every
// refusal happens BEFORE any AI call, that the worker (not the browser)
// picks the model and caps the answer, and that both portal features send
// what the worker requires. Live limits: supabase/tests/1c2_ai_gate.sql.
// ════════════════════════════════════════════════════════════════════
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const src = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const WORKER = src('cloudflare-worker/worker.js');
const MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';

let passed = 0, failed = 0;
const failures = [];
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { failed++; failures.push(name + ' — ' + e.message); console.log('  FAIL ' + name + '\n       ' + e.message); }
}
function ok(cond, msg) { if (!cond) throw new Error(msg); }
function eq(actual, expected, label) {
  const a = JSON.stringify(actual), b = JSON.stringify(expected);
  if (a !== b) throw new Error((label || '') + ' expected ' + b + ', got ' + a);
}

function setup(o) {
  const opt = o || {};
  const calls = { gate: [], ai: [], limiter: 0 };
  const fetchImpl = async (url, init) => {
    calls.gate.push({ url, init });
    if (opt.gateThrows) throw new Error('network down');
    const g = opt.gate || { status: 200, body: { ok: true } };
    return new Response(JSON.stringify(g.body), { status: g.status, headers: { 'Content-Type': 'application/json' } });
  };
  const mod = { exports: {} };
  new Function('module', 'fetch', WORKER.replace('export default', 'module.exports ='))(mod, fetchImpl);
  const env = {
    SUPABASE_URL: 'https://example.supabase.co', SUPABASE_ANON_KEY: 'anon-key',
    AI: { run: async (model, input) => {
      calls.ai.push({ model, input });
      if (opt.aiThrows) throw new Error('model error');
      return opt.aiResult || { response: 'hello' };
    } },
    PREAUTH_LIMITER: { limit: async () => { calls.limiter++; return { success: !opt.limited }; } },
  };
  const run = (body, headers, method) => mod.exports.fetch(new Request('https://dacs-ai.example/', {
    method: method || 'POST',
    headers: Object.assign({ 'Content-Type': 'application/json', Origin: 'https://dacs-company.vercel.app' }, headers || {}),
    body: method === 'OPTIONS' ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)),
  }), env);
  return { run, calls };
}
const AUTH = { Authorization: 'Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.c2ln' };
const draft = (extra) => Object.assign({ feature: 'work_plan_draft',
  messages: [{ role: 'system', content: 'rules' }, { role: 'user', content: 'notes' }] }, extra || {});
const summary = (extra) => Object.assign({ feature: 'budget_summary', messages: [{ role: 'user', content: 'budget' }] }, extra || {});
async function expectRefused(res, status, code) {
  eq(res.status, status, 'status');
  eq((await res.json()).error.code, code, 'code');
}

(async () => {
  console.log('\nai worker: refused before any AI call');

  await test('no session token: 401, nothing else runs', async () => {
    const { run, calls } = setup();
    await expectRefused(await run(draft()), 401, 'AI_NOT_SIGNED_IN');
    eq([calls.limiter, calls.gate.length, calls.ai.length], [0, 0, 0]);
  });

  await test('flood guard: 429 before the database or AI', async () => {
    const { run, calls } = setup({ limited: true });
    await expectRefused(await run(draft(), AUTH), 429, 'AI_RATE_LIMITED');
    eq([calls.gate.length, calls.ai.length], [0, 0]);
  });

  await test('body over 64 KB: 413 before the database or AI', async () => {
    const { run, calls } = setup();
    await expectRefused(await run(draft({ messages: [{ role: 'user', content: 'x'.repeat(70000) }] }), AUTH), 413, 'AI_TOO_LARGE');
    eq([calls.gate.length, calls.ai.length], [0, 0]);
  });

  await test('feature input cap: a 4,001-character summary is refused before the database', async () => {
    const { run, calls } = setup();
    await expectRefused(await run(summary({ messages: [{ role: 'user', content: 'x'.repeat(4001) }] }), AUTH), 413, 'AI_TOO_LARGE');
    eq(calls.gate.length, 0);
  });

  await test('malformed requests: bad JSON, unknown feature, too many or wrong messages', async () => {
    for (const body of ['{not json', { messages: [{ role: 'user', content: 'x' }] }, draft({ feature: 'chat' }),
                        draft({ messages: [] }), draft({ messages: Array(5).fill({ role: 'user', content: 'x' }) }),
                        draft({ messages: [{ role: 'assistant', content: 'x' }] }), draft({ messages: [{ role: 'user', content: 5 }] })]) {
      const { run, calls } = setup();
      await expectRefused(await run(body, AUTH), 400, 'AI_BAD_REQUEST');
      eq([calls.gate.length, calls.ai.length], [0, 0], JSON.stringify(body).slice(0, 60));
    }
  });

  await test('the database gate decides: each refusal maps to its status and runs no AI', async () => {
    const cases = [
      [{ status: 400, body: { code: 'P0001', message: 'AI_RATE_LIMITED' } }, 429, 'AI_RATE_LIMITED'],
      [{ status: 400, body: { code: 'P0001', message: 'AI_NOT_ALLOWED' } }, 403, 'AI_NOT_ALLOWED'],
      [{ status: 400, body: { code: 'P0001', message: 'AI_TOO_LARGE' } }, 413, 'AI_TOO_LARGE'],
      [{ status: 400, body: { code: 'P0001', message: 'AI_NOT_SIGNED_IN' } }, 401, 'AI_NOT_SIGNED_IN'],
      [{ status: 401, body: { message: 'JWT expired' } }, 401, 'AI_NOT_SIGNED_IN'],
      [{ status: 403, body: { message: 'permission denied for function ai_authorize' } }, 403, 'AI_NOT_ALLOWED'],
      [{ status: 400, body: { message: 'something unexpected' } }, 403, 'AI_NOT_ALLOWED'],
      [{ status: 503, body: { message: 'down' } }, 503, 'AI_GATE_UNAVAILABLE'],
    ];
    for (const [gate, status, code] of cases) {
      const { run, calls } = setup({ gate });
      await expectRefused(await run(draft(), AUTH), status, code);
      eq(calls.ai.length, 0, code + ' ran the AI');
    }
    const down = setup({ gateThrows: true });
    await expectRefused(await down.run(draft(), AUTH), 503, 'AI_GATE_UNAVAILABLE');
    eq(down.calls.ai.length, 0);
  });

  console.log('\nai worker: allowed requests');

  await test('the gate is called as the caller, with the counted characters', async () => {
    const { run, calls } = setup();
    eq((await run(draft(), AUTH)).status, 200);
    eq(calls.gate.length, 1);
    eq(calls.gate[0].url, 'https://example.supabase.co/rest/v1/rpc/ai_authorize');
    eq([calls.gate[0].init.headers.apikey, calls.gate[0].init.headers.Authorization], ['anon-key', AUTH.Authorization]);
    eq(JSON.parse(calls.gate[0].init.body), { p_feature: 'work_plan_draft', p_chars: 10 });
  });

  await test('the worker picks the model and caps the answer; a requested model is ignored', async () => {
    const d = setup();
    const res = await d.run(draft({ model: '@cf/some/expensive-model', max_tokens: 99999, temperature: 5 }), AUTH);
    eq(await res.json(), { choices: [{ message: { role: 'assistant', content: 'hello' } }] });
    eq([d.calls.ai[0].model, d.calls.ai[0].input.max_tokens, d.calls.ai[0].input.temperature], [MODEL, 2000, 1]);
    const s = setup();
    await s.run(summary(), AUTH);
    eq([s.calls.ai[0].model, s.calls.ai[0].input.max_tokens, s.calls.ai[0].input.temperature], [MODEL, 700, 0.4]);
  });

  await test('answers in either Workers AI shape; an AI error is a 502', async () => {
    const c = setup({ aiResult: { choices: [{ message: { content: 'from choices' } }] } });
    eq((await (await c.run(summary(), AUTH)).json()).choices[0].message.content, 'from choices');
    const e = setup({ aiThrows: true });
    await expectRefused(await e.run(summary(), AUTH), 502, 'AI_FAILED');
  });

  await test('an already-parsed object answer comes back as its JSON string; max_tokens is at least 1', async () => {
    const o = setup({ aiResult: { response: { tasks: [{ title: 'Wall prep' }] } } });
    const res = await o.run(draft({ max_tokens: -5 }), AUTH);
    eq((await res.json()).choices[0].message.content, '{"tasks":[{"title":"Wall prep"}]}');
    ok(o.calls.ai[0].input.max_tokens >= 1, 'max_tokens must reach the model as at least 1, got ' + o.calls.ai[0].input.max_tokens);
  });

  await test('health briefing: its own caps (600 tokens, 12,000 characters)', async () => {
    const h = setup();
    await h.run({ feature: 'health_briefing', messages: [{ role: 'user', content: 'brief' }], max_tokens: 5000 }, AUTH);
    eq([h.calls.ai[0].model, h.calls.ai[0].input.max_tokens], [MODEL, 600]);
    eq(JSON.parse(h.calls.gate[0].init.body).p_feature, 'health_briefing');
    const big = setup();
    await expectRefused(await big.run({ feature: 'health_briefing', messages: [{ role: 'user', content: 'x'.repeat(12001) }] }, AUTH), 413, 'AI_TOO_LARGE');
    eq(big.calls.gate.length, 0);
  });

  await test('CORS lets the portal send the session header', async () => {
    const { run } = setup();
    const res = await run(null, {}, 'OPTIONS');
    ok(/Authorization/.test(res.headers.get('Access-Control-Allow-Headers')), 'Authorization not allowed');
    eq(res.headers.get('Access-Control-Allow-Origin'), 'https://dacs-company.vercel.app');
  });

  console.log('\nai worker: configuration and callers');

  await test('no retired model anywhere; config carries the flood guard and the public Supabase values', async () => {
    for (const f of ['cloudflare-worker/worker.js', 'js/ai-summary.js', 'js/ai-assistant.js', 'js/workplan-admin-core.js', 'cloudflare-worker/SETUP.md'])
      ok(!src(f).includes('llama-3.1-8b'), f + ' still names the retired 8B model');
    const toml = src('cloudflare-worker/wrangler.toml');
    ok(/\[\[ratelimits\]\]\s*\nname = "PREAUTH_LIMITER"\s*\nnamespace_id = "1095"/.test(toml), 'PREAUTH_LIMITER binding');
    ok(/limit = 30\s*\n\s*period = 60/.test(toml), 'flood guard 30 per 60 s');
    const key = /const SUPABASE_ANON_KEY\s*=\s*'([^']+)'/.exec(src('js/supabase-config.js'))[1];
    const url = /const SUPABASE_URL\s*=\s*'([^']+)'/.exec(src('js/supabase-config.js'))[1];
    ok(toml.includes('SUPABASE_ANON_KEY = "' + key + '"') && toml.includes('SUPABASE_URL = "' + url + '"'), 'Supabase values match supabase-config.js');
    ok(src('.gitignore').includes('!cloudflare-worker/wrangler.toml'), 'wrangler.toml must be tracked');
  });

  await test('all three portal features send the session and their feature name', async () => {
    const s = src('js/ai-summary.js');
    ok(/Authorization: 'Bearer ' \+ session\.access_token/.test(s) && /feature: 'budget_summary'/.test(s), 'ai-summary.js');
    const a = src('js/ai-assistant.js');
    ok(/Authorization: 'Bearer ' \+ session\.access_token/.test(a) && /feature: 'health_briefing'/.test(a), 'ai-assistant.js');
    const w = src('js/workplan-admin-core.js');
    ok(/Authorization: 'Bearer ' \+ token/.test(w) && /feature: 'work_plan_draft'/.test(w), 'workplan-admin-core.js');
  });

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  if (failed) { console.log('\nFailures:\n  ' + failures.join('\n  ')); process.exit(1); }
})();
