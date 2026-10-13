// ════════════════════════════════════════════════════════════════════
// WORKMATE OFFICE SERVER (0094, 0095) STATIC TESTS:
//   node tests/workmate-office-server.test.js
//
// Zero dependencies. Guards the SHAPE of the 1c-2 migrations: grants,
// SECURITY DEFINER + pinned search_path, the 0093 guards kept in the
// replaced wp_office_save_task, and that 0093 itself is untouched.
// BEHAVIOUR is proven live by supabase/tests/1c2_acceptance.sql (0094)
// and supabase/tests/1c2_ai_gate.sql (0095).
// ════════════════════════════════════════════════════════════════════
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const read = (rel) => { const p = path.join(ROOT, rel); return fs.existsSync(p) ? fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n') : ''; };
const strip = (s) => s.replace(/--.*$/gm, '');
const M94 = read('supabase/migrations/0094_workmate_work_plan_office.sql');
const C94 = strip(M94);

let passed = 0, failed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { failed++; failures.push(name + ' — ' + e.message); console.log('  FAIL ' + name + '\n       ' + e.message); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }
const fnBlock = (code, name) => (code.match(new RegExp('create or replace function ' + name + '\\s*\\([\\s\\S]*?\\n\\$\\$;', 'i')) || [''])[0];

console.log('\nworkmate office server (0094)');

test('0093 is untouched (applied migrations are never edited)', () => {
  const sha = crypto.createHash('sha256').update(read('supabase/migrations/0093_workmate_my_work.sql')).digest('hex');
  assert(sha === '367a0b2db5f040e18fc74fb49839b7de606e2c5bb0fbd9719f4f942a32c943b4', '0093 changed: ' + sha);
});

test('0094 exists, sets a lock timeout, holds no money', () => {
  assert(M94.length > 0, 'missing 0094_workmate_work_plan_office.sql');
  assert(/set local lock_timeout = '5s';/.test(C94), 'no lock timeout');
  assert(!/\b[a-z_]*(price|amount|cost|peso)[a-z_]*\b/i.test(C94), 'a money word appears');
});

test('office checks require an active account', () => {
  const f = fnBlock(C94, 'pr_is_office');
  assert(f && /security definer/i.test(f) && /set search_path = public/i.test(f), 'pr_is_office definer + search_path');
  assert(/is_owner\(\) or is_staff\(\)/.test(f) && /coalesce\(p\.status, 'active'\) = 'active'/.test(f), 'role AND active status');
});

test('wp_my_proposals: own proposals, own company, 90 days, four outcomes, no office-only fields', () => {
  const f = fnBlock(C94, 'wp_my_proposals');
  assert(f && /security definer/i.test(f) && /set search_path = public/i.test(f), 'definer + search_path');
  assert(/not pr_is_requester\(\) then\s+raise exception 'NOT_A_REQUESTER'/.test(f), 'requester check');
  assert(/t\.proposed_by = auth\.uid\(\)/.test(f) && /t\.owner_id = attendance_data_owner\(\)/.test(f) && /interval '90 days'/.test(f), 'scope');
  for (const s of ["'sent'", "'published'", "'declined'", "'cancelled'"]) assert(f.includes(s), s);
  assert(/e\.kind = 'cancelled'/.test(f) && /'reason'/.test(f), 'reason from the cancel event');
  for (const x of ['source_passage', 'office_flags', 'instructions', "'acks'", 'responsible']) assert(!f.includes(x), x + ' returned');
});

test('wp_office_save_task keeps every 0093 guard', () => {
  const f = fnBlock(C94, 'wp_office_save_task');
  assert(f, 'wp_office_save_task not replaced');
  for (const code of ['OFFICE_ONLY', 'BAD_OPERATION', 'TITLE_REQUIRED', 'BAD_DATES', 'NOT_FOUND', 'TASK_CLOSED', 'BAD_DESTINATION',
                      'BAD_TEAM', 'BAD_PERSON', 'NO_RESPONSIBLE', 'BAD_DEPENDENCY', 'DEPENDENCY_CYCLE'])
    assert(f.includes("'" + code + "'"), 'lost guard ' + code);
  assert(/for no key update/.test(f) && /'wp_deps:'/.test(f), 'row lock + per-project dependency lock kept');
  assert(/security definer/i.test(f) && /set search_path = public/i.test(f), 'definer + search_path');
});

test('wp_office_save_task versions automatically; minor text never covers people, team or dates', () => {
  const f = fnBlock(C94, 'wp_office_save_task');
  assert(/v_minor := coalesce\(\(p_data ->> 'minor_text_only'\)::boolean, false\);/.test(f), 'minor flag parsed');
  assert(/v_revised := t\.status <> 'draft'\s+and \(v_important or cardinality\(v_changes\) > 0 or \(v_text and not v_minor\)\);/.test(f),
    'revision rule');
  for (const k of ["'people'", "'team'", "'planned dates'", "'instructions'"]) assert(f.includes(k), 'change kind ' + k);
});

test('pr_is_office() stays internal: 0094 revokes it, grants it to no one, and no test calls it as a user', () => {
  assert(C94.includes('revoke all on function pr_is_office() from public, anon, authenticated;'), '0094 restates the revoke');
  assert(!/grant\s+execute\s+on\s+function\s+pr_is_office/i.test(C94), '0094 must not grant pr_is_office');
  const oa = strip(read('supabase/tests/1c2_office_active.sql'));
  assert(oa.length > 0, 'missing 1c2_office_active.sql');
  assert(!/(assert|perform|select|return)\s+(not\s+)?pr_is_office\s*\(\)/i.test(oa), '1c2_office_active.sql calls pr_is_office() directly');
  assert(oa.includes("has_function_privilege('authenticated', 'public.pr_is_office()', 'execute')"), 'the script checks it stays private');
});

test('0094 functions callable when signed in, never by anon', () => {
  for (const sig of ['wp_my_proposals()', 'wp_office_save_task(uuid, jsonb)']) {
    assert(C94.includes('revoke all on function ' + sig + ' from public, anon;'), 'revoke ' + sig);
    assert(C94.includes('grant execute on function ' + sig + ' to authenticated;'), 'grant ' + sig);
  }
});

test('every office-function claim in 1c2_office_active.sql is real (43 rows, each called by the script it names)', () => {
  const oa = read('supabase/tests/1c2_office_active.sql');
  const rows = [...oa.matchAll(/\('(\w+)',\s*'(read|write|internal)',\s*'(raises|filters)',\s*'(\w+)'\)/g)];
  assert(rows.length === 43, 'inventory rows: ' + rows.length);
  assert(rows.filter(r => r[2] === 'read').length === 16 && rows.filter(r => r[2] === 'internal').length === 1, 'kinds');
  for (const [, fn, , , by] of rows) {
    const script = strip(read('supabase/tests/' + by + '.sql'));
    assert(script.length > 0, fn + ': missing script ' + by + '.sql');
    assert(new RegExp('\\b' + fn + '\\s*\\(').test(script), fn + ' is not called in ' + by + '.sql');
  }
  assert(!/when\s+others\s+then\s+null/i.test(oa) && !/when\s+insufficient_privilege/i.test(oa), 'no error may be swallowed');
});

console.log('\nai request gate (0095)');
const M95 = read('supabase/migrations/0095_ai_request_gate.sql');
const C95 = strip(M95);

test('0095 exists, sets a lock timeout, holds no money', () => {
  assert(M95.length > 0, 'missing 0095_ai_request_gate.sql');
  assert(/set local lock_timeout = '5s';/.test(C95), 'no lock timeout');
  assert(!/\b[a-z_]*(price|amount|cost|peso)[a-z_]*\b/i.test(C95), 'a money word appears');
});

test('ai_requests is closed to clients (RLS on, no policy, no grants)', () => {
  assert(/alter table ai_requests enable row level security;/.test(C95), 'RLS');
  assert(!/create policy/i.test(C95), 'no policy may exist');
  assert(/revoke all on table ai_requests from anon, authenticated;/.test(C95), 'table revoked');
  assert(/check \(feature in \('budget_summary', 'work_plan_draft', 'health_briefing'\)\)/.test(C95), 'feature list');
  assert(!/(text|input|prompt|content|notes)\s+text/i.test((C95.match(/create table if not exists ai_requests \([\s\S]*?\);/) || [''])[0]), 'never stores the text');
});

test('ai_authorize: signed in, active, role and module per feature, size, limits, serialised', () => {
  const f = fnBlock(C95, 'ai_authorize');
  assert(f && /security definer/i.test(f) && /set search_path = public/i.test(f), 'definer + search_path');
  assert(/coalesce\(v_p\.status, 'active'\) <> 'active'/.test(f), 'active only');
  assert(/p_feature = 'work_plan_draft' and v_p\.role in \('owner', 'staff'\)/.test(f), 'draft roles');
  assert(/p_feature = 'budget_summary' and v_p\.role = 'owner'/.test(f), 'summary role');
  assert(/p_feature = 'health_briefing' and v_p\.role = 'owner'/.test(f), 'briefing role');
  assert(/v_max_chars := 12000; v_per_10min := 20; v_per_day := 100;/.test(f), 'briefing limits');
  assert(/v_p\.allowed_modules \? v_module/.test(f), 'module focus');
  assert(/v_max_chars := 40000; v_per_10min := 10; v_per_day := 50;/.test(f), 'draft limits');
  assert(/v_max_chars := 4000; v_per_10min := 20; v_per_day := 100;/.test(f), 'summary limits');
  assert(/>= 300 then/.test(f), 'company limit');
  assert(/'ai_req_user:'/.test(f) && /'ai_req_owner:'/.test(f), 'advisory locks');
  for (const code of ['AI_NOT_SIGNED_IN', 'AI_NOT_ALLOWED', 'AI_TOO_LARGE', 'AI_RATE_LIMITED']) assert(f.includes("'" + code + "'"), code);
});

test('the AI-gate concurrency test verifies TLS, hides the secret and deletes only recorded ids', () => {
  const m = read('supabase/tests/1c2_ai_gate_concurrency.mjs');
  assert(m.length > 0, 'missing 1c2_ai_gate_concurrency.mjs');
  assert(m.includes('rejectUnauthorized: true') && !m.includes('rejectUnauthorized: ' + 'false'), 'TLS must be verified');
  assert(/process\.env\.DACS_DB_URL/.test(m) && /const redact = /.test(m), 'secret from the environment, redacted');
  const deletes = [...m.matchAll(/delete from ai_requests where ([^'`]+)/g)].map(x => x[1]);
  assert(deletes.length >= 2 && deletes.every(w => /^id = any\(\$1::bigint\[\]\)|^id = \$1::bigint|^id in \(/.test(w)),
    'every delete is by recorded id: ' + JSON.stringify(deletes));
  assert(!/input_chars\s*=\s*\d/.test(m) && !/39999/.test(m), 'no deletion by value');
  assert(m.includes("currval('ai_requests_id_seq')") && /returning id/.test(m), 'ids read back before commit');
  for (const g of ['G0 ', 'G1 ', 'G2 ', 'G3 ']) assert(m.includes(g), g.trim());
  assert(!fs.existsSync(path.join(ROOT, 'supabase/tests/1c2_ai_gate_cleanup.sql')), 'no value-based recovery script');
});

test('ai_authorize callable when signed in, never by anon', () => {
  assert(C95.includes('revoke all on function ai_authorize(text, integer) from public, anon;'), 'revoke');
  assert(C95.includes('grant execute on function ai_authorize(text, integer) to authenticated;'), 'grant');
});

// ── Task 3 appends the 0095 tests above this line ──

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) { console.log('\nFailures:\n  ' + failures.join('\n  ')); process.exit(1); }
