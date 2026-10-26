// ════════════════════════════════════════════════════════════════════
// PAYMENTS SERVER (0102) STATIC TESTS:
//   run with  node tests/purchasing-payments-server.test.js
//
// Zero dependencies. Reads supabase/migrations/0102_purchase_payments.sql
// and fences what the behaviour tests cannot see (those are
// supabase/tests/2a4_payments.pglite.mjs, 2a4_concurrency.mjs and the 2A-1 /
// 2A-2 / 2A-3 suites re-run --with-0102 — npm run test:sql):
//   1. Outside the money model: 0102 writes and reads no expense or payroll
//      row, and redefines no Spent function; the four functions it does
//      redefine are their earlier text plus the lines 0102 adds.
//   2. Every function is granted to signed-in users (and checks the caller
//      itself) or revoked from them; the nine tables are private.
//   3. Every write is sent once (operation id) and every void needs a reason;
//      the main owner's writes check for the main owner.
//   4. The live acceptance script rolls back; test:sql runs the new suites.
// ════════════════════════════════════════════════════════════════════
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');
const strip = (sql) => sql.split('\n').map(l => l.replace(/--.*$/, '')).join('\n');
const M102 = strip(read('supabase/migrations/0102_purchase_payments.sql'));
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
function eq(a, b, m) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error((m || 'not equal') + ': ' + JSON.stringify(a) + ' !== ' + JSON.stringify(b)); }
function fnBody(code, name, where) {
  const m = code.match(new RegExp('create or replace function (?:public\\.)?' + name + '\\s*\\([\\s\\S]*?\\n(?:end )?\\$\\$;', 'i'));
  if (!m) throw new Error('function ' + name + ' not found in ' + where);
  return m[0];
}
const lines = (t) => t.split('\n').map(l => l.replace(/\s+$/, '')).filter(Boolean);
const added = (now, then) => lines(now).filter(l => !lines(then).includes(l)).map(l => l.trim());
const removed = (now, then) => lines(then).filter(l => !lines(now).includes(l)).map(l => l.trim());

const defined = [...M102.matchAll(/create or replace function (?:public\.)?([a-z_]+)\s*\(/g)].map(m => m[1]);
const TABLES = ['pur_payments', 'pur_supplier_credits', 'pur_refunds', 'pur_cash_issues', 'pur_cash_returns',
                'pur_cash_counts', 'pur_own_money', 'pur_buyer_repayments', 'pur_money_events'];

console.log('\n0102: outside the money model');
test('0102 writes and reads no expense or payroll row', () => {
  ok(!/\b(insert\s+into|update|delete\s+from)\s+(public\.)?(expenses|payroll)\b/i.test(M102), 'writes');
  ok(!/\b(from|join)\s+(public\.)?(expenses|payroll)\b/i.test(M102), 'reads');
  ok(!/dacs\.purchase_write', 'on'/.test(M102.replace(fnBody(M102, 'pur_record', '0102'), '')),
    'only pur_record (0096\'s recording) opens the expense-row guard');
});
test('0102 redefines no Spent, funding or cover function', () => {
  for (const f of ['pur_store', 'pur_charge_rows', 'pur_clear_rows', 'pur_fund', 'pur_period_remaining', 'pur_cover_period',
                   'pur_prorate', 'pur_insert', 'pur_correct', 'pur_replace', 'pur_void', 'pur_cover_lines', 'pur_purchase_view']) {
    ok(!defined.includes(f), '0102 must not redefine ' + f);
  }
});
test('pur_record is 0096\'s, plus "paid now" in the same transaction', () => {
  const now = fnBody(M102, 'pur_record', '0102'), then = fnBody(M96, 'pur_record', '0096');
  eq(removed(now, then), ['perform pur_header_ok(p_body);', 'perform pur_lock(pur_body_keys(p_body));',
                          'v_result := pur_insert(v_owner, v_uid, p_body, null);'], 'only these three now read v_body');
  ok(added(now, then).every(l => /v_pays|v_body|v_pay\b|v_ids|BAD_PAY|BUYER_REQUIRED|pur_buyer\(\)|pur_pay_insert|pur_pay_state|^end if;$|^end loop;$|^raise exception|v_result := v_result \|\|/.test(l)
    || ['perform pur_header_ok(v_body);', 'perform pur_lock(pur_body_keys(v_body));', 'v_result := pur_insert(v_owner, v_uid, v_body, null);'].includes(l)),
    'only payment lines added: ' + JSON.stringify(added(now, then)));
  ok(now.indexOf('pur_insert(') < now.indexOf('pur_pay_insert('), 'the purchase first, then its payments');
  ok(now.indexOf('pur_pay_insert(') < now.indexOf('insert into pur_ops'), 'the answer is stored after the payments');
});
test('pur_header_ok is 0097\'s plus refusing payments on a correction or replacement', () => {
  const now = fnBody(M102, 'pur_header_ok', '0102'), then = fnBody(M97, 'pur_header_ok', '0097');
  eq(added(now, then), ["if p_body ? 'payments' then", "raise exception 'BAD_PAY' using errcode = 'P0001';"]);
  eq(removed(now, then), []);
  ok(lines(now).length === lines(then).length + 3, 'one if … end if block added');
});
test('pur_list_doc is 0101\'s plus the payment state', () => {
  const now = fnBody(M102, 'pur_list_doc', '0102'), then = fnBody(M101, 'pur_list_doc', '0101');
  eq(added(now, then), ["'replaced_by', pu.replaced_by,", "'pay', pur_pay_state(pu.id))"]);
  eq(removed(now, then), ["'replaced_by', pu.replaced_by)"]);
});
test('receipt_mark_attached is 0097\'s plus the payment proof and return photo', () => {
  const now = fnBody(M102, 'receipt_mark_attached', '0102'), then = fnBody(M97, 'receipt_mark_attached', '0097');
  eq(added(now, then), ["elsif tg_table_name = 'pur_payments' then", 'v_vals := array[new.proof_url];',
                        "elsif tg_table_name = 'pur_cash_returns' then", 'v_vals := array[new.photo_url];']);
  eq(removed(now, then), []);
});

console.log('\n0102: access');
const PUBLIC = ['pur_record', 'pur_pay', 'pur_void_payment', 'pur_accept_own_money', 'pur_reject_own_money', 'pur_resolve_overpaid', 'pur_void_refund',
  'pur_void_credit', 'pur_cash_give', 'pur_cash_dispute', 'pur_cash_clear_dispute', 'pur_cash_void_issue', 'pur_cash_report_return',
  'pur_cash_withdraw_return', 'pur_cash_decide_return', 'pur_cash_void_return', 'pur_cash_count', 'pur_cash_void_count',
  'pur_set_own_money', 'pur_repay_buyer', 'pur_void_repayment', 'pur_purchase_payments', 'pur_credits', 'pur_my_cash',
  'pur_cash_buyer', 'pur_cash_tracker', 'pur_overpaid', 'pur_cash_report', 'pur_payment_badges'];
const grants = [...M102.matchAll(/grant execute on function [\s\S]*?;/g)].map(m => m[0]).join('\n');
const revokesAll = [...M102.matchAll(/revoke all on function ([\s\S]*?) from public, anon, authenticated;/g)].map(m => m[1]).join(' ');
// The storage rules (R13) run as the signed-in reader, like pur_buyer(): granted, each answering only about the caller.
const STORAGE_RULES = ['uploads_can_read', 'uploads_can_write', 'pur_petty_reader'];
test('every function is granted to signed-in users or revoked from them — none in between', () => {
  for (const f of defined) {
    if (f === 'receipt_mark_attached') continue;   // a trigger; revoked from public, anon as 0097 did
    if (STORAGE_RULES.includes(f)) continue;       // checked in the R13 test
    const granted = new RegExp('\\b' + f + '\\(').test(grants);
    const revoked = new RegExp('\\b' + f + '\\(').test(revokesAll);
    ok(granted !== revoked, f + (granted ? ' is both granted and revoked' : ' is neither granted nor revoked'));
    ok(granted === PUBLIC.includes(f), f + (granted ? ' is callable but not in the public list' : ' should be callable'));
  }
  ok(!/to (anon|public)\b/.test(grants), 'nothing for anon or public');
});
test('the nine tables are private: RLS on, no policy, every privilege revoked', () => {
  // The only policies 0102 writes are the upload ledger's and the storage overwrite rule, restated for pettyCash (R13).
  eq([...M102.matchAll(/create policy ("?[a-z_]+"?) on ([a-z_.]+)/g)].map(m => m[1] + ' on ' + m[2]),
     ['receipt_uploads_insert on public.receipt_uploads', '"uploads_admin_update" on storage.objects'], 'no policy on the new tables');
  for (const t of TABLES) {
    ok(new RegExp('alter table ' + t + ' enable row level security;').test(M102), t + ' RLS');
    ok(new RegExp('revoke all on table [^;]*\\b' + t + '\\b[^;]*from public, anon, authenticated;').test(M102), t + ' revoked');
  }
  ok(/revoke all on sequence pur_money_events_seq_seq from public, anon, authenticated;/.test(M102), 'the history\'s sequence');
});
test('each public function checks its caller first: buyers (pur_pay_owner / pur_actor_owner) or the main owner (pur_main_owner)', () => {
  const OWNER_ONLY = ['pur_accept_own_money', 'pur_reject_own_money', 'pur_resolve_overpaid', 'pur_void_refund', 'pur_void_credit', 'pur_cash_give',
    'pur_cash_clear_dispute', 'pur_cash_void_issue', 'pur_cash_decide_return', 'pur_cash_void_return', 'pur_cash_count',
    'pur_cash_void_count', 'pur_set_own_money', 'pur_repay_buyer', 'pur_void_repayment', 'pur_cash_tracker', 'pur_overpaid', 'pur_cash_report',
    'pur_cash_buyer'];
  for (const f of PUBLIC) {
    const body = fnBody(M102, f, '0102');
    const decl = body.slice(0, body.indexOf('begin'));
    if (f === 'pur_record') { ok(/pur_actor_owner\(p_body ->> 'source'\)/.test(decl), f); continue; }
    if (f === 'pur_payment_badges') { ok(/is_owner\(\)/.test(body) && /pur_actor_owner\('expenses_form'\)/.test(body), f); continue; }
    if (OWNER_ONLY.includes(f)) ok(/v_owner uuid := pur_main_owner\(\);/.test(decl), f + ' main owner only');
    else ok(/v_owner uuid := pur_pay_owner\(\);/.test(decl), f + ' buyers only');
  }
  const main = fnBody(M102, 'pur_main_owner', '0102');
  ok(/pm_main_owner_id\(\)/.test(main) && /pur_is_main_owner\(\)/.test(main), 'the main owner = 0098\'s, with the Expenses section');
  ok(/p\.owner_id is null/.test(fnBody(M102, 'pur_is_main_owner', '0102')) && /allowed_modules \? 'expenses'/.test(fnBody(M102, 'pur_is_main_owner', '0102')),
    'no sub-owner, no account focused away from Expenses');
});

test('R13: return photos get their own private folder — 0097\'s storage rules plus the pettyCash lines, before every general rule', () => {
  const r = fnBody(M102, 'uploads_can_read', '0102'), r0 = fnBody(M97, 'uploads_can_read', '0097');
  const w = fnBody(M102, 'uploads_can_write', '0102'), w0 = fnBody(M97, 'uploads_can_write', '0097');
  eq(added(r, r0), ["if v_folder = 'pettyCash' then", 'return pur_petty_reader(p_name);'], 'read: only the pettyCash lines added');
  eq(removed(r, r0), []);
  eq(lines(r).length, lines(r0).length + 3, 'read: one if … end if');
  eq(added(w, w0), ["if v_folder = 'pettyCash' then"], 'write: only the pettyCash test added (its return line is the purchases one)');
  eq(removed(w, w0), []);
  eq(lines(w).length, lines(w0).length + 3, 'write: one if … end if');
  ok(r.indexOf("v_folder = 'pettyCash'") < r.indexOf('p_owner_id = v_uid::text then return true'), 'before the uploader read-back');
  ok(r.indexOf("v_folder = 'pettyCash'") < r.indexOf('if is_owner() or is_staff() then return true'), 'before the generic owner/staff rule');
  ok(w.indexOf("v_folder = 'pettyCash'") < w.indexOf('if is_owner() or is_staff() then return true'), 'write: before the generic rule');
  const reader = fnBody(M102, 'pur_petty_reader', '0102');
  ok(/pur_is_main_owner\(\)/.test(reader) && /u\.uploaded_by = auth\.uid\(\)/.test(reader) && /= data_owner_id\(\)::text/.test(reader),
    'the main owner, or the uploader, of that company');
  ok(/revoke all on function public\.pur_petty_reader\(text\) from public, anon;/.test(M102) &&
     /grant execute on function public\.pur_petty_reader\(text\) to authenticated;/.test(M102), 'callable by signed-in readers only');
  for (const f of ['uploads_can_read(text, text)', 'uploads_can_write(text)']) {
    ok(M102.includes('revoke all on function public.' + f + ' from anon;') && M102.includes('grant execute on function public.' + f + ' to authenticated;'), f);
  }
  const upd = M102.slice(M102.indexOf('create policy "uploads_admin_update"'), M102.indexOf('-- ════ 10.'));
  eq((upd.match(/when split_part\(name, '\/', 1\) = 'pettyCash' then false/g) || []).length, 2, 'never overwritten (using and check)');
  ok(/when 'petty_cash' then 'pettyCash'/.test(M102) && /kind not in \('purchase', 'petty_cash'\) or pur_buyer\(\)/.test(M102), 'the ledger: buyers, the right folder');
  ok(/u\.kind = 'petty_cash'\s+and u\.uploaded_by = auth\.uid\(\)/.test(fnBody(M102, 'pur_cash_report_return', '0102')), 'a return attaches only its buyer\'s own photo');
});

console.log('\n0102: sent once, voided with a reason');
test('every public write starts by asking pur_op_begin for an earlier answer and stores its own', () => {
  const READS = ['pur_purchase_payments', 'pur_credits', 'pur_my_cash', 'pur_cash_buyer', 'pur_cash_tracker', 'pur_overpaid', 'pur_cash_report',
                 'pur_payment_badges', 'pur_set_own_money'];
  for (const f of PUBLIC.filter(x => !READS.includes(x) && x !== 'pur_record')) {
    const body = fnBody(M102, f, '0102');
    const begin = body.indexOf('v_prev := pur_op_begin(p_op);');
    ok(begin !== -1, f + ' takes an operation id');
    ok(/if v_prev is not null then return v_prev; end if;/.test(body.slice(begin)), f + ' returns the first answer');
    ok(/return pur_op_done\(v_owner, p_op, '[a-z_]+'/.test(body), f + ' stores its answer');
  }
  ok(/on conflict \(user_id\) do update/.test(fnBody(M102, 'pur_set_own_money', '0102')), 'the switch: setting it twice is the same');
});
test('every void and rejection needs a reason; nothing is deleted', () => {
  ok(/v_reason text := pur_reason\(p_reason\);/.test(fnBody(M102, 'pur_reject_own_money', '0102')), 'a rejected own-money claim says why (R9)');
  for (const f of ['pur_void_payment', 'pur_void_refund', 'pur_void_credit', 'pur_cash_void_issue', 'pur_cash_void_return',
                   'pur_cash_void_count', 'pur_void_repayment']) {
    ok(/v_reason text := pur_reason\(p_reason\);/.test(fnBody(M102, f, '0102')), f + ' reason');
  }
  ok(/else pur_reason\(p_note\) end/.test(fnBody(M102, 'pur_cash_decide_return', '0102')), 'a rejection');
  ok(/v_note text := pur_reason\(p_note\);/.test(fnBody(M102, 'pur_cash_dispute', '0102')), 'a dispute says why');
  ok(!/\bdelete\s+from\s+pur_/i.test(M102), 'no delete');
  ok(/before update or delete on pur_money_events/.test(M102), 'history append-only');
});
test('the limits that must hold under races take a lock first', () => {
  ok(/from pur_supplier_credits where id = v_credit and owner_id = p_owner for update/.test(fnBody(M102, 'pur_pay_insert', '0102')), 'a credit row');
  for (const f of ['pur_pay', 'pur_void_payment', 'pur_resolve_overpaid', 'pur_void_refund', 'pur_void_credit']) {
    ok(/perform pur_purchase_lock\(/.test(fnBody(M102, f, '0102')), f + ' locks the purchase');
  }
  const repay = fnBody(M102, 'pur_repay_buyer', '0102');
  ok(repay.indexOf('pur_person_lock(p_buyer)') < repay.indexOf('pur_owes(v_owner, p_buyer)'), 'the buyer, before reading what is owed');
});

console.log('\n0102: acceptance and CI');
test('the live acceptance script rolls itself back and ends with the success row', () => {
  const acc = read('supabase/tests/2a4_acceptance.sql');
  const code = strip(acc).trim();
  ok(/^begin;/.test(code) && /rollback;$/.test(code), 'begin … rollback');
  ok(!/\bcommit\b/i.test(code), 'never commits');
  ok(/'2a4 acceptance: all checks passed'/.test(acc), 'success row');
});
test('npm run test:sql runs the 2A-4a suites and re-runs 2A-1 / 2A-2 / 2A-3 with 0102', () => {
  const sql = JSON.parse(read('package.json')).scripts['test:sql'];
  for (const s of ['2a4_payments.pglite.mjs', '2a4_concurrency.mjs', '2a1_purchase.pglite.mjs --with-0102',
                   '2a2_purchasing.pglite.mjs --with-0102', '2a3_server.pglite.mjs --with-0102']) {
    ok(sql.includes('node supabase/tests/' + s), 'test:sql runs ' + s);
  }
  ok(JSON.parse(read('package.json')).scripts.test.includes('node tests/purchasing-payments-server.test.js'), 'npm test runs this file');
});
test('the migrations README and the schema doc know 0102', () => {
  ok(/\*\*0102 \(WorkMate Stage 2A-4a/.test(read('supabase/migrations/README.md')), 'README: the 0102 entry');
  const doc = read('docs/DATABASE_SCHEMA.md');
  for (const t of TABLES) ok(doc.includes(t), 'DATABASE_SCHEMA.md: ' + t);
  ok(/payments_tracked/.test(doc), 'DATABASE_SCHEMA.md: purchases.payments_tracked');
});

console.log('\n0103 (2A-4b): a buyer sees the photo of their own return');

test('0103: pur_cash_detail (+ photo_url) and pur_list_doc (+ supplier_id) are 0102\'s text plus one key, still internal; pur_my_ops_done reads the caller\'s own ids', () => {
  const M103raw = read('supabase/migrations/0103_buyer_return_photo.sql');
  const M103 = strip(M103raw);
  const fns = [...M103.matchAll(/create or replace function (?:public\.)?([a-z_]+)\s*\(/g)].map(m => m[1]);
  eq(fns, ['pur_cash_detail', 'pur_list_doc', 'pur_my_ops_done'], 'three functions');
  ok(!/create table|alter table|create policy|drop |insert into|update |delete from/i.test(M103), 'no table, policy, drop or data change');
  eq([...M103.matchAll(/^grant [^;]*;/gm)].map(m => m[0]), ['grant execute on function pur_my_ops_done(uuid[]) to authenticated;'],
     'the one grant: pur_my_ops_done (pur_cash_detail and pur_list_doc stay internal)');
  ok(/revoke all on function pur_my_ops_done\(uuid\[\]\) from public, anon;/.test(M103), 'never for anon');
  const od = fnBody(M103, 'pur_my_ops_done', '0103');
  ok(/o\.actor_id = auth\.uid\(\)/.test(od) && /cardinality\(p_ops\), 0\) > 200/.test(od), 'the caller\'s own ids only, 200 at most');
  ok(!/insert|update|delete/i.test(od), 'a read');
  ok(/revoke all on function pur_cash_detail\(uuid, uuid\) from public, anon, authenticated;/.test(M103), 'revoked again, explicitly');
  ok(/revoke all on function pur_list_doc\(uuid\) from public, anon, authenticated;/.test(M103), 'pur_list_doc revoked again, explicitly');
  const ld = fnBody(M103, 'pur_list_doc', '0103'), ld102 = fnBody(M102, 'pur_list_doc', '0102');
  eq(removed(ld, ld102), [], 'pur_list_doc keeps every 0102 line');
  eq(added(ld, ld102), ["'supplier_id', pu.supplier_id,"], '… plus the listed supplier');
  const now = fnBody(M103, 'pur_cash_detail', '0103'), then = fnBody(M102, 'pur_cash_detail', '0102');
  eq(removed(now, then), ["'voided_at', r.voided_at) order by r.created_at desc), '[]'::jsonb)"], 'one line replaced');
  eq(added(now, then), ["'photo_url', r.photo_url, 'voided_at', r.voided_at) order by r.created_at desc), '[]'::jsonb)"], '… by itself plus photo_url');
  ok(!/expenses|payroll|_projSpent/.test(M103), 'nothing about Spent');
});
test('npm run test:sql re-runs the payments suite with 0103; the migrations README and the schema doc know 0103', () => {
  const pkg = JSON.parse(read('package.json'));
  ok(/node supabase\/tests\/2a4_payments\.pglite\.mjs && node supabase\/tests\/2a4_payments\.pglite\.mjs --with-0103 &&/.test(pkg.scripts['test:sql']),
    'test:sql runs 2a4_payments with and without 0103');
  // (0103's file name left the next-number line when 0104 arrived; its paragraph stays.)
  ok(/\*\*0103 \(WorkMate Stage 2A-4b/.test(read('supabase/migrations/README.md')), 'README');
  ok(/0103/.test(read('docs/DATABASE_SCHEMA.md')) && /photo_url/.test(read('docs/DATABASE_SCHEMA.md')), 'DATABASE_SCHEMA');
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) { console.log('\nFAILURES:\n  ' + failures.join('\n  ')); process.exit(1); }
