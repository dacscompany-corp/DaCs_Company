// ════════════════════════════════════════════════════════════════════
// PURCHASING SERVER (0097) STATIC TESTS: run with  node tests/purchasing-server.test.js
//
// Zero dependencies. Reads supabase/migrations/0097_purchasing_office.sql
// and fences what behaviour tests cannot see (those are
// supabase/tests/2a2_purchasing.pglite.mjs, 2a2_concurrency.mjs and the
// 2A-1 suite re-run with 0097 — npm run test:sql):
//   1. Spent is untouched: 0097 redefines none of 0096's funding or
//      expense-row functions; covers never feed an amount.
//   2. Every function is either granted to signed-in users (and checks the
//      caller itself) or revoked from them; no policy for anon / public,
//      none "for all"; only SELECT policies — writes go through functions.
//   3. The shopping list is quantities and names only.
//   4. The live acceptance script is self-rolling-back; test:sql runs it all.
//   5. The review fixes (16 Oct): new request links need the Buyer switch
//      whatever the source; picks and history are authoritative; a change
//      request goes stale on ANY change; purchase rows are buyers-only with
//      Project Control's one-line read; substitutes wait for a check.
// ════════════════════════════════════════════════════════════════════
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');
const SQL = read('supabase/migrations/0097_purchasing_office.sql');
// SQL with -- comments removed, so a comment cannot satisfy a check.
const CODE = SQL.split('\n').map(l => l.replace(/--.*$/, '')).join('\n');

let passed = 0, failed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { failed++; failures.push(name + ' — ' + e.message); console.log('  FAIL ' + name + '\n       ' + e.message); }
}
function ok(c, m) { if (!c) throw new Error(m); }
function fnBody(name) {
  const m = CODE.match(new RegExp('create or replace function (?:public\\.)?' + name + '\\s*\\([\\s\\S]*?\\n(?:end )?\\$\\$;', 'i'));
  if (!m) throw new Error('function ' + name + ' not found in 0097');
  return m[0];
}
const defined = [...CODE.matchAll(/create or replace function (?:public\.)?([a-z_]+)\s*\(/g)].map(m => m[1]);

console.log('\n0097: Spent is untouched');

test('0097 redefines none of the functions that turn a purchase into Spent', () => {
  for (const f of ['pur_fund', 'pur_charge_rows', 'pur_period_remaining', 'pur_cover_period', 'pur_clear_rows', 'pur_prorate', 'pur_move_stock']) {
    ok(!defined.includes(f), f + ' is redefined in 0097');
  }
});
test('covers carry quantities only — no amount column, and nothing reads them into an expense row', () => {
  const table = CODE.slice(CODE.indexOf('create table if not exists purchase_line_covers'), CODE.indexOf(');', CODE.indexOf('create table if not exists purchase_line_covers')));
  ok(!/amount|price|cost/i.test(table), 'a money column on purchase_line_covers');
  ok(!/insert into expenses/i.test(CODE), '0097 writes expense rows itself');
});
test('recording still writes its expense rows through 0096\'s pur_charge_rows, after the covers', () => {
  const ins = fnBody('pur_insert');
  ok(ins.indexOf('pur_cover_lines(v_id') < ins.indexOf('pur_charge_rows(v_id)'), 'pur_insert: covers, then charge rows');
  const cor = fnBody('pur_correct');
  ok(cor.includes('perform pur_clear_rows(p_purchase)') && cor.includes('pur_charge_rows(p_purchase)'), 'pur_correct still replaces its rows');
  ok(/drop function if exists pur_insert\(uuid, uuid, jsonb, jsonb\);/.test(CODE), 'the 4-argument pur_insert is dropped (no ambiguous overload)');
});
test('Bought counts RECORDED purchases only, and is rebuilt — never added to', () => {
  ok(/pu\.status = 'recorded'/.test(fnBody('pr_portion_bought')) && /pu\.status = 'recorded'/.test(fnBody('pr_line_bought')), 'recorded only');
  const cov = fnBody('pur_cover_lines');
  ok(/delete from purchase_line_covers c using purchase_lines l where l\.id = c\.line_id and l\.purchase_id = p_purchase;/.test(cov), 'covers rebuilt from scratch');
  ok(/greatest\(0, v_p\.quantity - v_p\.pending_reduction - pr_portion_bought\(v_p\.id\)\)/.test(cov), 'each portion up to its Still to buy');
  ok(/'EXTRA_REASON_REQUIRED'/.test(cov), 'an extra needs a reason');
});
test('a replacement voids the old purchase BEFORE recording the new one', () => {
  const rep = fnBody('pur_replace');
  ok(rep.indexOf("update purchases set status = 'void'") < rep.indexOf('pur_insert(v_owner'), 'void first');
});
test('a reduction protects bought quantity like arranged quantity', () => {
  const ap = fnBody('pr_apply_quantity');
  ok(/arranged_at is not null or pr_portion_bought\(id\) > 0/.test(ap), 'flagged on bought portions');
  ok(/buyer_id is null[\s\S]{0,80}pr_portion_bought\(id\) = 0/.test(ap), 'new demand never merges into a bought or assigned portion');
  ok(/'BOUGHT'/.test(fnBody('pr_office_move_portion')), 'a bought portion cannot move batch');
});

console.log('\n0097: access');

const PUBLIC = ['pur_me', 'pur_office_buyers', 'pur_set_buyer', 'pur_buyer_options', 'pur_suppliers', 'pur_save_supplier',
  'pur_assign_portion', 'pur_check_unit', 'pur_request_change', 'pur_withdraw_change', 'pur_decide_change', 'pur_change_requests',
  'pur_shopping_list', 'pur_purchases', 'pur_purchase', 'pur_correct', 'pur_replace', 'pur_buyer', 'pur_reader',
  'pur_entry_row', 'pur_review_lines'];
const STORAGE = ['uploads_can_read', 'uploads_can_write'];
const TRIGGER = ['receipt_mark_attached'];
test('every function is granted to signed-in users or revoked from them — none left in between', () => {
  for (const f of defined) {
    if (STORAGE.includes(f) || TRIGGER.includes(f) || f === 'pr_office_move_portion') continue;
    const granted = new RegExp('grant execute on function ' + f + '\\(').test(CODE);
    const revoked = new RegExp('revoke all on function ' + f + '\\([^)]*\\) from public, anon, authenticated').test(CODE);
    ok(granted !== revoked, f + (granted ? ' is both granted and revoked' : ' is neither granted nor revoked'));
    ok(granted === PUBLIC.includes(f), f + (granted ? ' is callable but not in the public list' : ' should be callable'));
  }
});
test('nothing is granted to anon or public; every policy is a SELECT policy for authenticated', () => {
  ok(!/grant [^;]* to [^;]*\b(anon|public)\b/i.test(CODE), 'a grant to anon/public');
  for (const m of CODE.matchAll(/create policy [^;]+;/g)) {
    const p = m[0];
    if (/on storage\.objects/.test(p) || /on public\.receipt_uploads/.test(p)) continue;
    ok(/for select to authenticated/.test(p), 'not a select-for-authenticated policy: ' + p.slice(0, 80));
  }
  ok(!/\bfor all\b/i.test(CODE), 'a "for all" policy');
});
test('every public function checks its caller first', () => {
  for (const f of PUBLIC.filter(f => !['pur_me', 'pur_buyer'].includes(f))) {
    const b = fnBody(f);
    ok(/pur_buyer\(\)|is_owner\(\)|pur_actor_owner\(|requested_by = v_uid/.test(b), f + ' does not check who is calling');
  }
});
test('the Buyer switch is the main owner\'s, for their own staff only', () => {
  const b = fnBody('pur_set_buyer');
  ok(/not coalesce\(is_owner\(\), false\)/.test(b) && /p\.role = 'staff' and p\.owner_id = v_uid/.test(b), 'owner, own staff');
  const can = fnBody('pur_can_buy');
  ok(/p\.allowed_modules \? 'expenses'/.test(can), 'Expenses section required (Q3 = B)');
  ok(/coalesce\(p\.status, 'active'\) = 'active'/.test(can), 'active accounts only');
});
test('only the owner reassigns someone else\'s portion; only the owner decides change requests', () => {
  const a = fnBody('pur_assign_portion');
  ok(/'ASSIGNED_TO_OTHER'/.test(a) && /'NOT_YOUR_PORTION'/.test(a) && /if not coalesce\(is_owner\(\), false\) then/.test(a), 'buyer limits');
  ok(/not coalesce\(is_owner\(\), false\)/.test(fnBody('pur_decide_change')), 'owner decides');
  ok(/'OWN_PURCHASE'/.test(fnBody('pur_check_unit')), 'never the buyer\'s own unit check');
});

console.log('\n0097: what workers and the shopping list can see');

test('the shopping list is quantities and names only', () => {
  const b = fnBody('pur_shopping_list');
  ok(!/gross_amount|receipt_total|'amount'|price/.test(b), 'money in the shopping list');
});
test('tables that hold purchase data are readable only through buyer / purchase-reader policies', () => {
  ok(/suppliers_buyer_read on suppliers for select to authenticated using \(can_access\(owner_id\) and pur_buyer\(\)\)/.test(CODE), 'suppliers');
  ok(/purchase_line_covers_reader on purchase_line_covers for select to authenticated using \(can_access\(owner_id\) and pur_reader\(\)\)/.test(CODE), 'covers');
  ok(/purchase_change_requests_read[\s\S]{0,200}is_owner\(\) or requested_by = auth\.uid\(\)/.test(CODE), 'change requests: owner or the requester');
});

console.log('\n0097: review fixes (16 Oct)');

test('review 1: a new request link, new picks or a takeover need the Buyer switch whatever the source', () => {
  const cov = fnBody('pur_cover_lines');
  ok(/if not v_may_buy and \(v_h is null or v_line\.portion_picks is distinct from v_h -> 'picks'\) then\s+raise exception 'BUYER_REQUIRED'/.test(cov), 'link guard');
  ok(/v_may_assign := v_may_buy and pur_can_buy\(v_buyer, pu\.owner_id\)/.test(cov), 'who may hand a portion over');
  ok(/p\.buyer_id is null and v_may_assign/.test(cov) && /if v_p\.buyer_id is null and v_may_assign then/.test(cov), 'unassigned portions only with that right');
  ok(/if p_kind <> 'void' and not pur_buyer\(\) and pur_links_changed\(p_purchase, p_body\) then\s+raise exception 'BUYER_REQUIRED'/.test(fnBody('pur_request_change')), 'nor through the owner');
});
test('review 2: picked portions are the only ones a line covers; history comes first and is taken before the change', () => {
  const cov = fnBody('pur_cover_lines');
  ok(/v_auto := case when v_repicked then 0\s+when v_h is null then v_target\s+else greatest\(0, v_target - \(v_h ->> 'target'\)::numeric\) end;/.test(cov), 'automatic only for a new link or added quantity');
  ok(/if v_left > 0 and v_auto > 0 and not v_picked then/.test(cov), 'a picked line never covers automatically');
  ok(cov.indexOf("v_h -> 'covers'") > 0 && cov.indexOf("v_h -> 'covers'") < cov.indexOf('order by case when p.buyer_id = v_buyer'), 'history before automatic');
  const cor = fnBody('pur_correct');
  const h = 'v_hist := pur_cover_history(p_purchase)';
  ok(cor.indexOf(h) > 0 && cor.indexOf(h) < cor.indexOf('delete from purchase_lines'), 'correction: history before the lines go');
  ok(/pur_cover_lines\(p_purchase, v_uid, v_hist\)/.test(cor), 'correction uses it');
  const rp = fnBody('pur_replace');
  ok(rp.indexOf(h) > 0 && rp.indexOf(h) < rp.indexOf("update purchases set status = 'void'") && /pur_insert\(v_owner, v_uid, v_body, v_carry, v_keep, v_hist, coalesce\(pu\.bought_by, pu\.recorded_by\)\)/.test(rp), 'replacement');
  const chk = fnBody('pur_check_unit');
  ok(chk.indexOf(h) > 0 && chk.indexOf(h) < chk.indexOf("set unit_check = 'confirmed'") && /pur_cover_lines\(p_purchase, v_uid, v_hist\)/.test(chk), 'unit check');
  ok(/pur_cover_lines\(v_id, p_actor, coalesce\(p_history, '\[\]'::jsonb\)\)/.test(fnBody('pur_insert')), 'a new purchase has no history');
});
test('re-review: history keeps each portion\'s quantity; a portion newly picked in a correction is checked like a new purchase', () => {
  const cov = fnBody('pur_cover_lines');
  const hist = cov.slice(cov.indexOf("from jsonb_array_elements(v_h -> 'covers')"), cov.indexOf('if v_left > 0 and v_auto > 0 and v_picked then'));
  ok(/v_take := least\(v_left, \(v_pick ->> 'quantity'\)::numeric, v_cap\);/.test(hist), 'each historical portion at most its old quantity');
  ok(/v_repicked := v_picked and \(v_h is null or v_line\.portion_picks is distinct from v_h -> 'picks'\);/.test(cov), 'picks made in this change');
  ok((cov.match(/if not \(v_p\.id = any \(v_had\)\) and not v_owner_caller and v_p\.buyer_id is not null and v_p\.buyer_id <> v_buyer then\s+raise exception 'ASSIGNED_TO_OTHER'/g) || []).length === 2,
     'a portion the line did not cover before: never another buyer\'s (new picks, and more of unchanged picks)');
  ok(!/v_h is null and not v_owner_caller/.test(cov), 'the check is no longer skipped for lines with history');
});
test('review 3: a change request keeps the purchase as seen; approval re-checks all of it; a unit check counts as a change', () => {
  ok(/base_doc jsonb not null/.test(CODE), 'base_doc column');
  ok(/pu\.updated_at, pur_doc\(p_purchase\), v_uid, p_op/.test(fnBody('pur_request_change')), 'stored at request time');
  ok(/pu\.updated_at <> r\.base_updated_at or pur_doc\(pu\.id\) is distinct from r\.base_doc then/.test(fnBody('pur_decide_change')), 'stale on any change');
  ok(/update purchases set updated_at = now\(\) where id = p_purchase;/.test(fnBody('pur_check_unit')), 'a check changes the purchase');
  const cr = fnBody('pur_change_requests');
  ok(/'base', case when coalesce\(is_owner\(\), false\) or pur_buyer\(\) then pur_review_doc/.test(cr)
     && /'current', case when coalesce\(is_owner\(\), false\) or pur_buyer\(\) then pur_review_doc/.test(cr)
     && /'proposed'/.test(cr) && /'changed_since'/.test(cr), 'the owner and buyers get both versions; others only their own proposal');
  const rv = fnBody('pur_review_doc');
  for (const k of ["'purchase_date'", "'date_time'", "'supplier'", "'bought_by'", "'quantity'", "'unit'", "'picks'", "'shares'", "'receipts'"]) ok(rv.includes(k), 'review shows ' + k);
  ok(/pur_prorate\(/.test(rv), 'the automatic fee split is shown, not left blank');
});
test('R3: purchase rows are buyers-only; Project Control reads one line, nothing more', () => {
  ok(/create or replace function pur_reader\(\) returns boolean[\s\S]{0,120}begin\s+return pur_buyer\(\);\s+end;/.test(CODE), 'pur_reader = pur_buyer');
  const e = fnBody('pur_entry_row');
  ok(/pur_actor_owner\('expenses_form'\)/.test(e), 'accounts that may record');
  ok(!/purchase_line_covers|purchase_history|request_line_id|bought_by|change_requests/.test(e), 'nothing beyond the edit form');
  ok(/select coalesce\(jsonb_agg\(l\.id\), '\[\]'::jsonb\)/.test(fnBody('pur_review_lines')), 'review flags: ids only');
});
test('fix round 1: a replacement keeps the buyer and supplier; non-buyers do not read whole purchases or drop links', () => {
  ok(/revoke all on function pur_insert\(uuid, uuid, jsonb, jsonb, jsonb, jsonb, uuid\) from public, anon, authenticated;/.test(CODE), 'pur_insert (7 arguments) is internal');
  ok(/pur_bought_by\(p_owner, p_body, p_current_buyer\)/.test(fnBody('pur_insert')), 'the current buyer is kept');
  ok(/v_body := v_body \|\| jsonb_build_object\('supplier_id', pu\.supplier_id\)/.test(fnBody('pur_replace')), 'the supplier is kept');
  ok(/revoke all on function pur_links_dropped\(uuid, jsonb\) from public, anon, authenticated;/.test(CODE), 'pur_links_dropped is internal');
  ok(/not pur_buyer\(\) and pur_links_dropped\(p_purchase, v_body\)/.test(fnBody('pur_correct')), 'a correction cannot drop a link');
  ok(/not pur_buyer\(\) and pur_links_dropped\(p_purchase, p_body\)/.test(fnBody('pur_replace')), 'a replacement cannot');
  ok(/pur_links_dropped\(p_purchase, case when p_kind = 'correct' then pur_inherit\(p_purchase, p_body\) else p_body end\)/.test(fnBody('pur_request_change')), 'nor a request');
  const ent = fnBody('pur_entry_row');
  ok(/'purchase', case when v_whole then/.test(ent) && /else jsonb_build_object\('id', pu\.id, 'status', pu\.status\) end/.test(ent), 'non-buyers get id and status of a larger purchase');
  const cov = fnBody('pur_cover_lines');
  ok(/raise exception 'LINE_CLOSED'/.test(cov) && /if v_h is null and \(v_req\.line_status <> 'open' or v_req\.request_status <> 'submitted'\) then/.test(cov), 'no new link to a cancelled line');
  ok(/row_number\(\) over \(order by \(h ->> 'line_no'\)::int\)/.test(cov) && !/\(h ->> 'line_no'\)::int = v_line\.line_no/.test(cov), 'history by request line and order, not line number');
  ok(/order by l\.urgent desc, l\.needed_by nulls last, first_cutoff nulls last, f\.name, r\.received_at, l\.position\s+limit 500/.test(fnBody('pur_shopping_list')), 'the shopping list is ordered before the limit');
  ok(/'buyer', case when po\.buyer_id is null then null else pur_person_name\(po\.buyer_id\) end/.test(fnBody('pur_review_doc')), 'the owner sees whose portion a pick takes');
});
test('R14: a substitute needs a reason and an office check before it covers anything', () => {
  ok(/'SUBSTITUTE_REASON_REQUIRED'/.test(fnBody('pur_store')), 'reason');
  ok(/v_direct := lower\(btrim\(v_line\.unit\)\) = lower\(btrim\(v_req\.unit\)\) and not v_line\.substitute;/.test(fnBody('pur_cover_lines')), 'covers only after a check');
  ok(/'item', lower\(btrim\(l\.item_name\)\), 'substitute', l\.substitute/.test(fnBody('pur_keep_checks')), 'a check is kept for the same item only');
});

test('final minor 6: a receipt link must be https — recording and correcting refuse anything else', () => {
  for (const name of ['pur_insert', 'pur_correct']) {
    const b = fnBody(name);
    ok(/jsonb_typeof\(v\) = 'string' and v #>> '\{\}' <> '' and v #>> '\{\}' !~ '\^https:\/\/'\) then\s+raise exception 'BAD_DOCS'/.test(b), name + ' refuses a non-https docs value');
  }
});

console.log('\n0097: proof');

test('the live acceptance script rolls back and ends with the success row', () => {
  const a = read('supabase/tests/2a2_acceptance.sql');
  ok(/^begin;$/m.test(a) && /\nrollback;\s*$/.test(a), 'begin … rollback');
  ok(!/create temp table/i.test(a), 'no temp table (the SQL editor breaks it)');
  ok(/'2a2 acceptance: all checks passed'/.test(a), 'success row');
});
test('npm run test:sql runs the 2A-2 suites and the 2A-1 suite with 0097', () => {
  const s = JSON.parse(read('package.json')).scripts['test:sql'];
  for (const part of ['2a2_purchasing.pglite.mjs', '2a2_concurrency.mjs', '2a1_purchase.pglite.mjs --with-0097']) ok(s.includes(part), part);
  ok(JSON.parse(read('package.json')).scripts.test.includes('tests/purchasing-server.test.js'), 'npm test runs this file');
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) { console.log('\nFAILURES:\n  ' + failures.join('\n  ')); process.exit(1); }
