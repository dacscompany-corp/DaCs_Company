// ════════════════════════════════════════════════════════════════════
// WORKMATE REQUESTS — OFFICE (0086) STATIC TESTS:
//   run with  node tests/workmate-requests-office.test.js
//
// Zero dependencies. Guards the shape of migration 0086:
//   - every function is SECURITY DEFINER with a pinned search_path;
//   - every office RPC refuses non-office callers and checks the row's owner;
//   - line changes lock the pr_lines row before touching portions;
//   - batch rows can no longer be inserted or updated directly;
//   - every function has a permission decision (granted RPC or internal).
// The LIVE behaviour is checked by supabase/tests/0086_verify.sql.
// ════════════════════════════════════════════════════════════════════
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const MIGRATION = path.join(ROOT, 'supabase/migrations/0086_workmate_requests_office.sql');

let passed = 0, failed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { failed++; failures.push(name + ' — ' + e.message); console.log('  FAIL ' + name + '\n       ' + e.message); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }

const SQL = fs.existsSync(MIGRATION) ? fs.readFileSync(MIGRATION, 'utf8') : '';
const CODE = SQL.replace(/--.*$/gm, '');
function fnBlock(name) {
  const m = CODE.match(new RegExp('create or replace function ' + name + '\\s*\\([\\s\\S]*?\\$\\$;', 'i'));
  return m ? m[0] : '';
}
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const OFFICE_RPCS = [
  'pr_office_queue(text)', 'pr_office_request(uuid)', 'pr_office_set_arranged(uuid, boolean)',
  'pr_office_resolve_reduction(uuid, text, text)', 'pr_office_change_quantity(uuid, numeric, text)',
  'pr_office_cancel_line(uuid, text)', 'pr_office_resolve_conflict(uuid, boolean, text)',
  'pr_office_match_item(uuid, uuid)', 'pr_office_move_portion(uuid, uuid, text)', 'pr_office_batches()',
  'pr_office_set_batch_dates(uuid, date, date)', 'pr_office_people()', 'pr_office_teams()',
  'pr_office_save_team(uuid, text, boolean)', 'pr_office_add_member(uuid, uuid)', 'pr_office_remove_member(uuid, uuid)',
  'pr_office_set_leader(uuid, uuid)', 'pr_office_catalog()',
  'pr_office_save_item(uuid, text, text, text, text, text, boolean)', 'pr_office_projects()',
  'pr_office_set_allow_requests(uuid, boolean)', 'pr_folder_request_count(uuid)'];
const INTERNAL = ['pr_is_office()', 'pr_request_doc(uuid, boolean)'];
const LINE_WRITERS = ['pr_office_set_arranged', 'pr_office_resolve_reduction', 'pr_office_change_quantity',
  'pr_office_cancel_line', 'pr_office_resolve_conflict', 'pr_office_match_item', 'pr_office_move_portion'];

console.log('\nworkmate-requests office (0086)');

test('the migration exists', () => assert(SQL.length > 0, 'missing ' + MIGRATION));

test('every function is SECURITY DEFINER with a pinned search_path', () => {
  const fns = [...CODE.matchAll(/create or replace function[\s\S]*?\$\$;/gi)].map(m => m[0]);
  assert(fns.length === OFFICE_RPCS.length + INTERNAL.length, 'expected ' + (OFFICE_RPCS.length + INTERNAL.length) + ' functions, found ' + fns.length);
  for (const f of fns) {
    assert(/security definer/i.test(f), 'not SECURITY DEFINER: ' + f.slice(0, 70));
    assert(/set search_path = public/i.test(f), 'no search_path: ' + f.slice(0, 70));
  }
});

test('every office RPC refuses non-office callers', () => {
  for (const sig of OFFICE_RPCS) {
    const b = fnBlock(sig.split('(')[0]);
    assert(b, 'no function ' + sig);
    assert(/pr_is_office\(\)/.test(b), sig + ' does not check pr_is_office()');
  }
});

test('every office RPC is scoped to the caller\'s company', () => {
  for (const sig of OFFICE_RPCS) {
    const b = fnBlock(sig.split('(')[0]);
    assert(/can_access\(|data_owner_id\(\)/.test(b), sig + ' has no owner scope');
  }
});

test('line changes lock the line before its portions', () => {
  for (const f of LINE_WRITERS) {
    const b = fnBlock(f);
    const lock = b.search(/from pr_lines ln[\s\S]*?for update/i);
    const portionWrite = b.search(/(update|delete from|insert into) pr_line_portions/i);
    assert(lock > 0, f + ' never locks pr_lines');
    if (portionWrite > 0) assert(lock < portionWrite, f + ' writes portions before locking the line');
  }
});

test('every line change is recorded in pr_events', () => {
  for (const f of LINE_WRITERS) assert(/insert into pr_events/i.test(fnBlock(f)), f + ' writes no event');
});

test('office quantity changes and cancels need a reason', () => {
  for (const f of ['pr_office_change_quantity', 'pr_office_cancel_line']) {
    const b = fnBlock(f);
    assert(/'REASON_REQUIRED'/.test(b) && /btrim\(coalesce\(p_reason, ''\)\) = ''/.test(b), f + ' does not require a reason');
  }
});

test('the open queue keeps requests the office still has to act on', () => {
  const b = fnBlock('pr_office_queue');
  assert(/status = 'open'/.test(b) && /pending_reduction > 0/.test(b) && /resolved_at is null/.test(b),
    'open scope must include open lines, pending reductions and unresolved conflicts');
});

test('the 300-row cap never drops requests that need office action', () => {
  const b = fnBlock('pr_office_queue');
  const order = b.search(/order by \(exists/i), limit = b.search(/limit 300/i);
  assert(order > 0 && limit > order, 'needs-action requests must sort first inside the capped select');
});

test('office cancel locks the request before the line (same order as pr_cancel_request)', () => {
  const b = fnBlock('pr_office_cancel_line');
  const req = b.search(/from pr_requests r where[\s\S]*?for update/i);
  const line = b.search(/from pr_lines ln[\s\S]*?for update/i);
  assert(req > 0 && line > 0 && req < line, 'the request lock must come first');
});

test('quantities keep the 0085 bounds (> 0, <= 1,000,000, 3 decimals)', () => {
  const b = fnBlock('pr_office_change_quantity');
  assert(/p_quantity <= 0 or p_quantity > 1000000 or p_quantity <> round\(p_quantity, 3\)/.test(b), 'quantity bounds missing');
});

test('batch rows can no longer be inserted or updated directly', () => {
  assert(/drop policy if exists pr_batches_admin_insert on pr_batches;/i.test(CODE), 'insert policy not dropped');
  assert(/drop policy if exists pr_batches_admin_update on pr_batches;/i.test(CODE), 'update policy not dropped');
  assert(!/create policy[^;]*on pr_batches/i.test(CODE), 'must not create a new pr_batches policy');
});

test('setup tables can no longer be inserted or updated directly', () => {
  for (const t of ['pr_teams', 'pr_team_members', 'pr_catalog_items', 'pr_project_settings']) {
    for (const c of ['insert', 'update']) {
      assert(new RegExp('drop policy if exists ' + t + '_admin_' + c + ' on ' + t + ';', 'i').test(CODE), t + ' ' + c + ' policy not dropped');
    }
    assert(!new RegExp('create policy[^;]*on ' + t + '\\b', 'i').test(CODE), 'must not create a new ' + t + ' policy');
  }
});

test('batch dates: only purchase_on / delivery_on change, delivery not before purchase', () => {
  const b = fnBlock('pr_office_set_batch_dates');
  assert(/set purchase_on = p_purchase_on, delivery_on = p_delivery_on/.test(b), 'wrong columns updated');
  assert(!/cutoff_at\s*=/.test(b.split('set purchase_on')[1] || ''), 'must not change cutoff_at');
  assert(/p_delivery_on < p_purchase_on/.test(b) && /'BAD_DATES'/.test(b), 'date order check missing');
});

test('a leader must hold the Team Leader role and be a current member', () => {
  const b = fnBlock('pr_office_set_leader');
  assert(/'teamLeader'/.test(b) && /'NOT_A_TEAM_LEADER'/.test(b) && /'NOT_IN_TEAM'/.test(b), 'leader rules missing');
  const clear = b.search(/set is_leader = false/), set = b.search(/set is_leader = true/);
  assert(clear > 0 && set > clear, 'the old leader must be cleared before the new one is set (one-leader index)');
});

test('permissions: office RPCs to signed-in users, internals to nobody', () => {
  for (const f of OFFICE_RPCS) {
    assert(new RegExp('revoke all on function ' + esc(f) + ' from public, anon;', 'i').test(CODE), 'missing revoke for ' + f);
    assert(new RegExp('grant execute on function ' + esc(f) + ' to authenticated;', 'i').test(CODE), 'missing grant for ' + f);
  }
  for (const f of INTERNAL) {
    assert(new RegExp('revoke all on function ' + esc(f) + ' from public, anon, authenticated;', 'i').test(CODE), 'missing revoke for ' + f);
    assert(!new RegExp('grant execute on function ' + esc(f), 'i').test(CODE), f + ' must not be granted');
  }
});

test('no money anywhere in 0086', () => {
  assert(!/price|amount|cost|peso/i.test(CODE), '0086 mentions money');
});

test('no for-all or public/anon policies', () => {
  assert(!/\bfor\s+all\b/i.test(CODE), 'found a for-all policy');
  for (const s of CODE.split(';').filter(s => !/^\s*grant\s+execute\s+on\s+function\b/i.test(s))) {
    assert(!/\bto\s+(public|anon)\b/i.test(s), 'found to public/anon: ' + s.trim().slice(0, 60));
  }
});

// ── Dacs Web call sites (Task 7) ──
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
function bodyFrom(src, start) {
  const i = src.indexOf(start);
  if (i < 0) return '';
  return src.slice(i, i + 4000);
}

test('deleteFolder asks pr_folder_request_count before confirming or deleting anything', () => {
  const b = bodyFrom(read('js/expenses-module.js'), 'async function deleteFolder(id)');
  assert(b, 'deleteFolder not found');
  const check = b.indexOf("rpc('pr_folder_request_count'");
  assert(check > 0, 'no request-count check');
  assert(check < b.indexOf('showDeleteConfirm('), 'the check must come before the confirm');
  assert(check < b.indexOf('.delete('), 'the check must come before any delete');
  assert(/catch \(err\) \{\s*showExpNotif\([^;]*nothing was deleted[^;]*\);\s*return;/.test(b), 'a failed check must stop the delete');
});

test('Additional Works deleteChild asks pr_folder_request_count first', () => {
  const b = bodyFrom(read('js/portal-app.compiled.js'), 'const deleteChild = async (child) => {');
  assert(b, 'deleteChild not found');
  const check = b.indexOf('rpc("pr_folder_request_count"');
  assert(check > 0, 'no request-count check');
  assert(check < b.indexOf('confirm('), 'the check must come before the confirm');
  assert(check < b.indexOf('.delete('), 'the check must come before the delete');
  assert(/nothing was deleted/.test(b.slice(0, b.indexOf('confirm('))), 'a failed check must stop the delete');
});

test('only owner and staff may sign in to the web portal', () => {
  const src = read('js/admin.js');
  assert(/const ADMIN_ROLES = \['owner', 'staff'\];/.test(src), 'ADMIN_ROLES must be exactly owner and staff');
  assert(/use the DACS app on their phone/.test(src), 'workers get a message pointing them to the app');
});

// ── SUMMARY (keep last) ──
console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) { console.log('\nFAILURES:\n  ' + failures.join('\n  ')); process.exit(1); }
