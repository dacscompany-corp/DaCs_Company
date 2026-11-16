// ════════════════════════════════════════════════════════════════════
// PHONE PURCHASING SERVER (0101) STATIC TESTS:
//   run with  node tests/purchasing-phone-server.test.js
//
// Zero dependencies. Reads supabase/migrations/0101_purchasing_phone.sql
// and fences what the behaviour tests cannot see (those are
// supabase/tests/2a3_server.pglite.mjs, 2a3_concurrency.mjs and the 2A-1 /
// 2A-2 suites re-run --with-0101 — npm run test:sql):
//   1. Spent is untouched: 0101 redefines no expense-row function; pur_fund's
//      Main Contract half and pur_insert are 0096/0097's text apart from the
//      lines 0101 adds.
//   2. Every function is granted to signed-in users (and checks the caller
//      itself), revoked from them, or — pur_signin_can_buy — given to the
//      service role only.
//   3. What staff without the Buyer switch can read carries no amounts.
//   4. The live acceptance script rolls back; test:sql runs the new suites.
// ════════════════════════════════════════════════════════════════════
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');
const strip = (sql) => sql.split('\n').map(l => l.replace(/--.*$/, '')).join('\n');
const M101 = strip(read('supabase/migrations/0101_purchasing_phone.sql'));
const M97 = strip(read('supabase/migrations/0097_purchasing_office.sql'));
const M96 = strip(read('supabase/migrations/0096_purchase_recording.sql'));

let passed = 0, failed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { failed++; failures.push(name + ' — ' + e.message); console.log('  FAIL ' + name + '\n       ' + e.message); }
}
function ok(c, m) { if (!c) throw new Error(m); }
function fnBody(code, name, where) {
  const m = code.match(new RegExp('create or replace function (?:public\\.)?' + name + '\\s*\\([\\s\\S]*?\\n(?:end )?\\$\\$;', 'i'));
  if (!m) throw new Error('function ' + name + ' not found in ' + where);
  return m[0];
}
// Lines of a function, blank lines and trailing spaces dropped.
const lines = (t) => t.split('\n').map(l => l.replace(/\s+$/, '')).filter(Boolean);

const defined = [...M101.matchAll(/create or replace function (?:public\.)?([a-z_]+)\s*\(/g)].map(m => m[1]);

console.log('\n0101: Spent is untouched');
test('0101 redefines no expense-row or period-arithmetic function', () => {
  for (const f of ['pur_store', 'pur_charge_rows', 'pur_clear_rows', 'pur_period_remaining', 'pur_cover_period', 'pur_prorate',
                   'pur_record', 'pur_correct', 'pur_replace', 'pur_void', 'pur_cover_lines']) {
    ok(!defined.includes(f), '0101 must not redefine ' + f);
  }
  eq(defined.slice().sort(), ['pur_destinations', 'pur_fund', 'pur_insert', 'pur_list_doc', 'pur_my_pending_changes', 'pur_my_purchases',
    'pur_purchase_view', 'pur_purchases', 'pur_require_receipt', 'pur_signin_can_buy'], 'exactly these functions');
});
test('pur_fund: only the Additional Works branch changes — the Main Contract half is 0096\'s text', () => {
  const now = fnBody(M101, 'pur_fund', '0101'), then = fnBody(M96, 'pur_fund', '0096');
  const tail = (t) => lines(t.slice(t.indexOf('-- Main Contract') >= 0 ? t.indexOf('for v_p in') : t.indexOf('for v_p in')));
  ok(JSON.stringify(tail(now)) === JSON.stringify(tail(then)), 'Main Contract funding and Cover are unchanged');
  ok(/insert into projects \(owner_id, folder_id, month, year, funding_type\)/.test(now) && /'downpayment'/.test(now), 'makes one hidden AW period');
  ok(!/project_budgets|project_control_billing_allocations/.test(now.slice(0, now.indexOf('for v_p in'))),
    'R4: the AW period gets no budget row and no allocation snapshot');
  ok(!/AW_NO_PERIOD/.test(now), 'no longer refuses');
  ok(/volatile/.test(now.slice(0, now.indexOf('as $$'))), 'volatile (it writes)');
});
test('pur_insert is 0097\'s apart from storing the "No receipt" reason', () => {
  const now = lines(fnBody(M101, 'pur_insert', '0101')), then = lines(fnBody(M97, 'pur_insert', '0097'));
  const added = now.filter(l => !then.includes(l));
  const removed = then.filter(l => !now.includes(l));
  ok(added.every(l => /no_receipt_reason|BAD_REASON|^\s*end if;$|^\s*returning id into v_id;$|p_actor, pur_bought_by\(p_owner, p_body, p_current_buyer\), v_supplier,$|recorded_by, bought_by, supplier_id, no_receipt_reason\)$/.test(l)),
    'only reason lines added: ' + JSON.stringify(added));
  ok(removed.every(l => /recorded_by, bought_by, supplier_id\)$|p_actor, pur_bought_by\(p_owner, p_body, p_current_buyer\), v_supplier\)$/.test(l)),
    'only the column list and values line changed: ' + JSON.stringify(removed));
});
test('pur_purchase_view is 0097\'s plus no_receipt_reason', () => {
  const now = lines(fnBody(M101, 'pur_purchase_view', '0101')), then = lines(fnBody(M97, 'pur_purchase_view', '0097'));
  eq(now.filter(l => !then.includes(l)).map(l => l.trim()), ["'no_receipt_reason', pu.no_receipt_reason,"], 'one line added');
  eq(then.filter(l => !now.includes(l)), [], 'nothing removed');
});

console.log('\n0101: access');
const PUBLIC = ['pur_purchases', 'pur_my_purchases', 'pur_destinations', 'pur_my_pending_changes'];
test('every function is granted to signed-in users or revoked from them — none in between', () => {
  for (const f of defined) {
    if (f === 'pur_signin_can_buy') continue;
    const granted = new RegExp('grant execute on function ' + f + '\\(').test(M101);
    const revoked = new RegExp('revoke all on function ' + f + '\\([^)]*\\) from public, anon, authenticated').test(M101);
    ok(granted !== revoked, f + (granted ? ' is both granted and revoked' : ' is neither granted nor revoked'));
    ok(granted === PUBLIC.includes(f), f + (granted ? ' is callable but not in the public list' : ' should be callable'));
    if (granted) ok(new RegExp('grant execute on function ' + f + '\\([^)]*\\) to authenticated;').test(M101), f + ' granted to authenticated only');
  }
});
test('pur_signin_can_buy: revoked from every signed-in role, granted to the service role only', () => {
  ok(/revoke all on function pur_signin_can_buy\(uuid\) from public, anon, authenticated;/.test(M101), 'revoked');
  eq([...M101.matchAll(/grant execute on function pur_signin_can_buy\(uuid\) to ([a-z_]+);/g)].map(m => m[1]), ['service_role'], 'service role only');
});
test('each public reader checks the caller itself', () => {
  for (const f of ['pur_purchases', 'pur_my_purchases', 'pur_destinations']) ok(/if not pur_buyer\(\) then\s+raise exception 'BUYER_REQUIRED'/.test(fnBody(M101, f, '0101')), f + ' buyers only');
  ok(/pur_actor_owner\('expenses_form'\)/.test(fnBody(M101, 'pur_my_pending_changes', '0101')), 'pending changes: office accounts allowed Expenses');
  ok(/r\.requested_by = auth\.uid\(\)/.test(fnBody(M101, 'pur_my_pending_changes', '0101')), 'pending changes: the caller\'s own only');
});

console.log('\n0101: no amounts for staff without the Buyer switch');
test('pur_my_pending_changes returns ids, kind, reason and time — no amount, no purchase document', () => {
  const body = fnBody(M101, 'pur_my_pending_changes', '0101');
  ok(!/amount|receipt_total|pur_doc|pur_review_doc|base_doc|body/.test(body.replace(/r\.reason/g, '')), 'nothing priced');
});

console.log('\n0101: acceptance and CI');
test('the live acceptance script rolls itself back and ends with the success row', () => {
  const acc = read('supabase/tests/2a3_acceptance.sql');
  const code = strip(acc).trim();
  ok(/^begin;/.test(code) && /rollback;$/.test(code), 'begin … rollback');
  ok(!/\bcommit\b/i.test(code), 'never commits');
  ok(/'2a3 acceptance: all checks passed'/.test(acc), 'success row');
});
test('npm run test:sql runs the 2A-3a suites and re-runs 2A-1 / 2A-2 with 0101', () => {
  const sql = JSON.parse(read('package.json')).scripts['test:sql'];
  for (const s of ['2a3_server.pglite.mjs', '2a3_concurrency.mjs', '2a1_purchase.pglite.mjs --with-0101', '2a2_purchasing.pglite.mjs --with-0101']) {
    ok(sql.includes('node supabase/tests/' + s), 'test:sql runs ' + s);
  }
  ok(JSON.parse(read('package.json')).scripts.test.includes('node tests/purchasing-phone-server.test.js'), 'npm test runs this file');
});

function eq(a, b, m) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error((m || 'not equal') + ': ' + JSON.stringify(a) + ' !== ' + JSON.stringify(b)); }

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) { console.log('\nFAILURES:\n  ' + failures.join('\n  ')); process.exit(1); }
