/**
 * DAC's Admin — nightly Project Management push (Cloudflare Worker, free tier).
 * ----------------------------------------------------------------------------
 * Cron fires at 15:59 UTC = 11:59 PM Philippine time. For every device that
 * opted in (push_subscriptions), it computes that project's numbers from
 * Supabase and sends a Web Push the service worker shows on the device.
 *
 * No npm deps — Web Push (RFC 8291) + VAPID (RFC 8292) via Web Crypto.
 *
 * Secrets/vars (set with `npx wrangler secret put NAME`):
 *   SUPABASE_URL           e.g. https://hqbg...supabase.co   (var is fine)
 *   SUPABASE_SERVICE_ROLE  service-role key (reads all rows; keep secret)
 *   VAPID_PUBLIC           VAPID public key  (base64url)
 *   VAPID_PRIVATE          VAPID private key (base64url)
 *   VAPID_SUBJECT          e.g. mailto:you@yourdomain.com
 *   TRIGGER_KEY            any random string — lets you test via /run?key=...
 */

export default {
  async scheduled(event, env, ctx) { ctx.waitUntil(run(env, false)); },
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname === '/run' && url.searchParams.get('key') === env.TRIGGER_KEY) {
      const debug = url.searchParams.get('debug') === '1';
      try {
        const out = await run(env, debug);
        if (debug) return new Response(JSON.stringify(out, null, 2), { headers: { 'Content-Type': 'application/json' } });
        return new Response('ran');
      } catch (e) {
        return new Response('error: ' + e.message + '\n' + (e.stack || ''), { status: 500 });
      }
    }
    return new Response('ok');
  },
};

// ── Main ────────────────────────────────────────────────────────────────
async function run(env, debug) {
  const results = [];
  const subs = await sb(env, 'push_subscriptions?select=*');
  if (!subs.length) return debug ? { subs: 0, note: 'No subscriptions stored.' } : undefined;

  const byProj = {};
  subs.forEach(s => { (byProj[s.project_id] = byProj[s.project_id] || []).push(s); });
  const today = phtDate();
  let lastMessages = null;

  for (const pid in byProj) {
    let messages;
    try { messages = await buildMessages(env, pid, today); }
    catch (e) {
      messages = [{ title: "DAC's — summary unavailable", body: "Couldn't load tonight's numbers.", url: '/admin.html', tag: 'pm-daily-err-' + pid }];
      if (debug) results.push({ pid, msgError: e.message });
    }
    lastMessages = messages;
    for (const s of byProj[pid]) {
      let dead = false;
      for (const msg of messages) {        // 5 separate notifications per device
        if (dead) break;
        try {
          const r = await sendPush(s, JSON.stringify(msg), env);
          if (debug) results.push({ pid, metric: msg.title, status: r.status, body: r.text });
          if (r.status === 404 || r.status === 410) {
            await sb(env, `push_subscriptions?id=eq.${s.id}`, { method: 'DELETE' });
            dead = true;
          }
        } catch (e) {
          if (debug) results.push({ pid, metric: msg.title, error: e.message });
        }
      }
    }
  }
  return debug ? { subs: subs.length, today, messages: lastMessages, sends: results } : undefined;
}

// ── Metrics (mirror the admin app's formulas) ─────────────────────────────
async function buildMessages(env, pid, today) {
  const [projRow] = await sb(env, `construction_projects?id=eq.${pid}&select=client_name,project_name,budget`).catch(() => []);
  const bills = await sb(env, `weekly_bills?project_id=eq.${pid}&select=*`);
  const reqs  = await sb(env, `payment_requests?construction_project_id=eq.${pid}&select=*`).catch(() => []);
  const ms    = await sb(env, `milestones?project_id=eq.${pid}&select=*`).catch(() => []);
  const funds = await sb(env, `revolving_fund_requests?project_id=eq.${pid}&select=*`).catch(() => []);

  const directCost = bills.reduce((s, b) => s + directCostOf(b), 0);
  const paid       = paidOf(reqs);
  const netCash    = paid - directCost;                          // Remaining cash receipt (all-time)
  const progress   = progressOf(ms);                             // Progress %
  const daily      = bills.filter(b => b.week_ending_date === today).reduce((s, b) => s + directCostOf(b), 0);
  const totalFund  = funds.reduce((s, f) => s + (Number(f.amount) || 0), 0);
  const spentWeeks = funds.reduce((s, f) => s + weekDirectCost(bills, f.week_start), 0);
  const runBal     = totalFund - spentWeeks;                     // Revolving-fund running balance

  const peso   = n => '₱' + Math.round(n).toLocaleString('en-PH');
  const signed = n => (n < 0 ? '−' : '+') + peso(Math.abs(n));
  const name   = (projRow && (projRow.client_name || projRow.project_name)) || 'Project';

  // One notification per metric (unique `tag` so they don't collapse into one).
  const metrics = [
    ['Remaining cash receipt', signed(netCash)],
    ['Progress',               progress + '%'],
    ['Direct cost',            peso(directCost)],
    ["Today's expenses",       peso(daily)],
    ['Revolving balance',      signed(runBal)],
  ];
  return metrics.map(([label, value], i) => ({
    title: `${name} — ${label}`,
    body:  value,
    url:   '/admin.html',
    tag:   `pm-daily-${pid}-${i}`,
  }));
}

function directCostOf(b) {
  const dct = Number(b.direct_cost_total) || 0;
  if (dct) return dct;
  const lm = (Number(b.labor) || 0) + (Number(b.materials) || 0);
  if (lm) return lm;
  return (Number(b.grand_total) || 0) - (Number(b.management_fee) || 0);
}
function paidOf(reqs) {
  return reqs.reduce((s, r) => {
    if (r.status === 'verified') return s + (Number(r.amount_paid) || Number(r.paid_amount) || Number(r.total_amount) || 0);
    return s + (Number(r.amount_paid) || 0);
  }, 0);
}
function progressOf(ms) {
  if (!ms.length) return 0;
  const items = ms.map(m => m.data || m);   // milestones store fields in a `data` jsonb column
  const hasPct = items.some(x => x.percentage != null && x.percentage !== '' && !isNaN(x.percentage));
  if (hasPct) return Math.round(items.filter(x => x.status === 'completed').reduce((s, x) => s + (Number(x.percentage) || 0), 0));
  const done = items.filter(x => x.status === 'completed').length;
  return Math.round(done / items.length * 100);
}
function weekDirectCost(bills, weekStart) {
  if (!weekStart) return 0;
  const start = new Date(weekStart + 'T00:00:00'); const end = new Date(start); end.setDate(end.getDate() + 6);
  const pad = n => String(n).padStart(2, '0');
  const endStr = end.getFullYear() + '-' + pad(end.getMonth() + 1) + '-' + pad(end.getDate());
  return bills.filter(b => b.week_ending_date && b.week_ending_date >= weekStart && b.week_ending_date <= endStr)
              .reduce((s, b) => s + directCostOf(b), 0);
}
function phtDate() {
  const d = new Date(Date.now() + 8 * 3600 * 1000);
  const pad = n => String(n).padStart(2, '0');
  return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
}

// ── Supabase REST ─────────────────────────────────────────────────────────
async function sb(env, path, opts = {}) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE}`,
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
    },
  });
  if (!res.ok) throw new Error('Supabase ' + path + ' ' + res.status);
  if (opts.method === 'DELETE') return null;
  return res.json();
}

// ── Web Push (RFC 8291 aes128gcm) + VAPID (RFC 8292 ES256) ────────────────
async function sendPush(sub, payloadStr, env) {
  const endpoint = sub.endpoint;
  const aud = new URL(endpoint).origin;
  const jwt = await vapidJWT(aud, env.VAPID_SUBJECT || 'mailto:admin@example.com', env.VAPID_PUBLIC, env.VAPID_PRIVATE);
  const body = await encryptPayload(payloadStr, sub.p256dh, sub.auth);
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      TTL: '86400',
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      Authorization: `vapid t=${jwt}, k=${env.VAPID_PUBLIC}`,
    },
    body,
  });
  let text = '';
  if (!(res.status >= 200 && res.status < 300)) { try { text = (await res.text()).slice(0, 300); } catch (_) {} }
  return { status: res.status, text };
}

async function vapidJWT(aud, subject, pubB64, privB64) {
  const enc = o => b64url(new TextEncoder().encode(JSON.stringify(o)));
  const header = { typ: 'JWT', alg: 'ES256' };
  const payload = { aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: subject };
  const signingInput = enc(header) + '.' + enc(payload);
  const pub = b64urlDecode(pubB64);
  const jwk = {
    kty: 'EC', crv: 'P-256', ext: true,
    x: b64url(pub.slice(1, 33)),
    y: b64url(pub.slice(33, 65)),
    d: b64url(b64urlDecode(privB64)),
  };
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, new TextEncoder().encode(signingInput));
  return signingInput + '.' + b64url(new Uint8Array(sig));
}

async function encryptPayload(payloadStr, p256dhB64, authB64) {
  const te = new TextEncoder();
  const clientPub = b64urlDecode(p256dhB64);  // 65 bytes
  const authSecret = b64urlDecode(authB64);   // 16 bytes
  const serverKeys = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const serverPub = new Uint8Array(await crypto.subtle.exportKey('raw', serverKeys.publicKey)); // 65 bytes
  const clientKey = await crypto.subtle.importKey('raw', clientPub, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: clientKey }, serverKeys.privateKey, 256));

  const ikmInfo = concat(te.encode('WebPush: info'), new Uint8Array([0]), clientPub, serverPub);
  const ikm = await hkdf(authSecret, shared, ikmInfo, 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, concat(te.encode('Content-Encoding: aes128gcm'), new Uint8Array([0])), 16);
  const nonce = await hkdf(salt, ikm, concat(te.encode('Content-Encoding: nonce'), new Uint8Array([0])), 12);

  const plaintext = concat(te.encode(payloadStr), new Uint8Array([2])); // single, last record
  const aesKey = await crypto.subtle.importKey('raw', cek, { name: 'AES-GCM' }, false, ['encrypt']);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aesKey, plaintext));

  const rs = new Uint8Array([0, 0, 0x10, 0]);          // record size 4096
  const idlen = new Uint8Array([serverPub.length]);    // 65
  return concat(salt, rs, idlen, serverPub, ct);
}

async function hkdf(salt, ikm, info, len) {
  const baseKey = await crypto.subtle.importKey('raw', ikm, { name: 'HKDF' }, false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, baseKey, len * 8);
  return new Uint8Array(bits);
}

// ── helpers ───────────────────────────────────────────────────────────────
function concat(...arrs) {
  let len = 0; arrs.forEach(a => len += a.length);
  const out = new Uint8Array(len); let o = 0;
  arrs.forEach(a => { out.set(a, o); o += a.length; });
  return out;
}
function b64url(bytes) {
  let bin = ''; const a = new Uint8Array(bytes);
  for (let i = 0; i < a.length; i++) bin += String.fromCharCode(a[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlDecode(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  const pad = '='.repeat((4 - (s.length % 4)) % 4);
  const bin = atob(s + pad);
  const a = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
  return a;
}
