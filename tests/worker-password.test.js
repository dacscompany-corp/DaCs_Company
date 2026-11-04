// ═══════════════════════════════════════
// TEMPORARY PASSWORD TESTS: run with  node tests/worker-password.test.js
//
// Zero dependencies. Guards the admin-set-worker-password Edge Function
// (WorkMate Stage 3b-a, Q3):
//   I.   Only the main owner, and only active crew of their company.
//   II.  The password: readable, unbiased, and meets WorkMate's rule.
//   III. index.ts: the service key stays on the server, the password is never
//        logged or stored, the attempt is recorded first, and a failure says so.
//   IV.  attendance-signin and the profiles columns are untouched: the old app
//        reads both and cannot be updated.
// ═══════════════════════════════════════
'use strict';
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');
const DIR = path.join(ROOT, 'supabase/functions/admin-set-worker-password');

let passed = 0, failed = 0;
const failures = [];
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { failed++; failures.push(name + ' — ' + e.message); console.log('  FAIL ' + name + '\n       ' + e.message); }
}
function ok(c, m) { if (!c) throw new Error(m); }
function eq(a, b, m) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error((m || 'not equal') + ': ' + JSON.stringify(a) + ' !== ' + JSON.stringify(b)); }

(async () => {
  const core = await import(pathToFileURL(path.join(DIR, 'password-core.mjs')).href);
  const INDEX = read('supabase/functions/admin-set-worker-password/index.ts');
  const CODE = INDEX.replace(/^\s*\/\/.*$/gm, '');

  const MAIN = { id: 'm', role: 'owner', owner_id: null, status: 'active' };
  const crew = (o) => Object.assign({ id: 'w', role: 'worker', owner_id: 'm', status: 'active' }, o);

  console.log('\nworker password: who may, for whom');

  await test('only the main owner may ask', async () => {
    eq(core.decideReset({ caller: MAIN, target: crew() }), { ok: true });
    for (const [why, caller] of [
      ['another owner-role account', { id: 's', role: 'owner', owner_id: 'm', status: 'active' }],
      ['a switched-off main owner', { id: 'm', role: 'owner', owner_id: null, status: 'inactive' }],
      ['staff', { id: 's', role: 'staff', owner_id: 'm', status: 'active' }],
      ['a team leader', { id: 's', role: 'teamLeader', owner_id: 'm', status: 'active' }],
      ['a worker', { id: 's', role: 'worker', owner_id: 'm', status: 'active' }],
      ['a client', { id: 's', role: 'client', owner_id: 'm', status: 'active' }],
      ['no profile', null],
    ]) {
      eq(core.decideReset({ caller, target: crew() }), { ok: false, status: 403, code: 'OWNER_ONLY' }, why);
    }
  });

  await test('a missing status counts as active, as everywhere else', async () => {
    ok(core.isMainOwner({ role: 'owner', owner_id: null, status: null }), 'the main owner');
    eq(core.decideReset({ caller: MAIN, target: crew({ status: null }) }), { ok: true });
  });

  await test('only active workers and team leaders of this company can be reset', async () => {
    eq(core.decideReset({ caller: MAIN, target: crew({ role: 'teamLeader' }) }), { ok: true });
    const no = { ok: false, status: 404, code: 'NOT_A_WORKER' };
    for (const role of ['owner', 'staff', 'client', 'partner', 'engineer', null]) {
      eq(core.decideReset({ caller: MAIN, target: crew({ role }) }), no, String(role));
    }
    eq(core.decideReset({ caller: MAIN, target: crew({ owner_id: 'other' }) }), no, 'another company');
    eq(core.decideReset({ caller: MAIN, target: null }), no, 'nobody');
    eq(core.decideReset({ caller: MAIN, target: crew({ status: 'inactive' }) }), { ok: false, status: 409, code: 'ACCOUNT_INACTIVE' });
  });

  console.log('\nworker password: the password');

  const nodeRandom = (n) => require('crypto').randomBytes(n);

  await test('readable, with upper case, lower case and a digit, and no look-alike characters', async () => {
    for (let i = 0; i < 2000; i++) {
      const p = core.makeTemporaryPassword(nodeRandom);
      ok(/^[A-Z][a-z][2-9][a-z]-[A-Z][a-z][2-9][a-z]-[A-Z][a-z][2-9][a-z]$/.test(p), p);
      ok(!/[01OIil]/.test(p), 'look-alike in ' + p);
      ok(p.length >= 8, "WorkMate's rule");
    }
  });

  await test('different every time, and it uses the whole alphabet', async () => {
    const seen = new Set();
    const chars = new Set();
    for (let i = 0; i < 5000; i++) {
      const p = core.makeTemporaryPassword(nodeRandom);
      seen.add(p);
      for (const ch of p) chars.add(ch);
    }
    eq(seen.size, 5000, 'no repeats');
    eq(chars.size, 23 + 23 + 8 + 1, 'every allowed character turned up');
  });

  await test('a byte past the last whole multiple is thrown away, so no character is favoured', async () => {
    // 256 % 23 = 3: bytes 253, 254 and 255 must be skipped.
    const bytes = [255, 254, 253, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    const p = core.makeTemporaryPassword((n) => { const b = new Uint8Array(n); bytes.forEach((x, i) => { b[i] = x; }); return b; });
    eq(p.slice(0, 4), 'Aa2a', 'the skipped bytes chose nothing');
  });

  console.log('\nworker password: the function');

  await test('the service key comes from the environment; the caller is read from their own session', async () => {
    ok(/Deno\.env\.get\("SUPABASE_SERVICE_ROLE_KEY"\)/.test(CODE), 'env');
    ok(/admin\.auth\.getUser\(jwt\)/.test(CODE), 'their session');
    ok(!/eyJ[A-Za-z0-9_-]{10,}/.test(INDEX), 'no key in the file');
    ok(!/role:\s*"service_role"/.test(CODE), 'no forged role');
  });

  await test('the password is never logged, stored or put in an error', async () => {
    ok(!/console\.(log|error|warn|info|debug)/.test(CODE), 'no logging at all');
    const events = CODE.match(/insert\(\{[^}]*\}\)/g) || [];
    eq(events.length, 1, 'one insert shape');
    ok(!/password/i.test(events[0]), 'the event holds no password');
    eq((CODE.match(/temporary_password/g) || []).length, 1, 'returned in one place');
    ok(/"Cache-Control": "no-store"/.test(CODE), 'not cached');
    ok(/catch \{\n\s+return json\(\{ error: "SERVER_ERROR" \}, 500, c\);/.test(CODE), 'an error\'s text never reaches a reply');
  });

  await test('the attempt is recorded before the password changes, and the outcome after', async () => {
    const asked = CODE.indexOf('event("requested")');
    const set = CODE.indexOf('updateUserById(workerId, { password })');
    const failedAt = CODE.indexOf('event("failed")');
    const done = CODE.indexOf('event("temporary_set")');
    ok(asked > 0 && asked < set, 'recorded first');
    ok(set < failedAt && failedAt < done, 'a failure is recorded, and only success marks "must change"');
    ok(/if \(asked\.error\) return json\(\{ error: "SERVER_ERROR" \}, 500, c\);/.test(CODE), 'no trace, no reset');
    ok(/marked: !marked\.error/.test(CODE), 'an unrecorded mark is reported, not hidden');
  });

  await test('it decides before anything changes, changes only the password, and accepts no other account fields', async () => {
    ok(CODE.indexOf('decideReset({ caller, target })') < CODE.indexOf('event("requested")'), 'decided first');
    ok(/if \(!decision\.ok\) return json\(\{ error: decision\.code \}, decision\.status, c\);/.test(CODE), 'refusal returns');
    ok(!/createUser|deleteUser|\.from\("profiles"\)\.(update|upsert|insert|delete)/.test(CODE), 'no other account change');
    ok(/updateUserById\(workerId, \{ password \}\)/.test(CODE), 'only the password');
  });

  await test('browsers: only the portals\' own addresses, never a wildcard', async () => {
    ok(!/"Access-Control-Allow-Origin":\s*"\*"/.test(CODE), 'no wildcard');
    ok(/https:\/\/dacs-company\.vercel\.app/.test(CODE), 'the live site');
  });

  console.log('\nworker password: the old app stays safe');

  await test('attendance-signin does not mention any of this', async () => {
    for (const f of ['index.ts', 'eligibility.mjs']) {
      const s = read('supabase/functions/attendance-signin/' + f);
      ok(!/must_change|wk_password|temporary/i.test(s), f);
    }
  });

  await test('0111 adds no column to profiles, and writes no password', async () => {
    const sql = read('supabase/migrations/0111_workmate_tools_phone.sql').replace(/--.*$/gm, '');
    ok(!/alter table\s+(public\.)?profiles/i.test(sql), 'no new column on profiles');
    ok(!/encrypted_password|auth\.users/i.test(sql), 'no password handling in SQL');
    const table = sql.slice(sql.indexOf('create table if not exists wk_password_events'));
    ok(!/password\s+text|temporary\s+text/i.test(table.slice(0, table.indexOf(');'))), 'no password column');
  });

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  if (failed) { console.log('\nFAILURES:\n  ' + failures.join('\n  ')); process.exit(1); }
})();
