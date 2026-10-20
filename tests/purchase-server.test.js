// ════════════════════════════════════════════════════════════════════
// PURCHASE SERVER (0096) STATIC TESTS:  node tests/purchase-server.test.js
//
// Zero dependencies. Guards the SHAPE of migration 0096 (WorkMate Stage
// 2A-1, one purchase recording operation) and of the Dacs Web code around
// it: grants, SECURITY DEFINER + pinned search_path, locks before writes,
// the expense-row guard, Cover kept a subset, the stock move kept on the
// server, and the no-period rows read by every Spent site. BEHAVIOUR is
// proven by `npm run test:sql` — supabase/tests/2a1_purchase.pglite.mjs
// (PostgreSQL in memory) and 2a1_concurrency.mjs (two sessions on a real
// PostgreSQL) — and live by supabase/tests/2a1_acceptance.sql.
// ════════════════════════════════════════════════════════════════════
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const read = (rel) => { const p = path.join(ROOT, rel); return fs.existsSync(p) ? fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n') : ''; };
const strip = (s) => s.replace(/--.*$/gm, '');
const M = read('supabase/migrations/0096_purchase_recording.sql');
const C = strip(M);
const EXP = read('js/expenses-module.js');
const PC = read('js/portal-app.compiled.js');

let passed = 0, failed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { failed++; failures.push(name + ' — ' + e.message); console.log('  FAIL ' + name + '\n       ' + e.message); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }
const fnBlock = (name) => (C.match(new RegExp('create or replace function ' + name + '\\s*\\([\\s\\S]*?\\n\\$\\$;', 'i')) || [''])[0];
const between = (src, a, b) => { const i = src.indexOf(a); return i === -1 ? '' : src.slice(i, src.indexOf(b, i + a.length)); };

console.log('\npurchase server (0096)');

test('0095 is untouched (applied migrations are never edited)', () => {
  const sha = crypto.createHash('sha256').update(read('supabase/migrations/0095_ai_request_gate.sql')).digest('hex');
  assert(sha === '80414edd6a2f2215920a09846436109d957f77b9e43a0446929cf13cbb0a7a7d', '0095 changed: ' + sha);
});

test('0096 exists and sets a lock timeout', () => {
  assert(M.length > 0, 'missing supabase/migrations/0096_purchase_recording.sql');
  assert(/set local lock_timeout = '5s';/.test(C), 'no lock timeout');
});

const PUBLIC = ['pur_record(uuid, jsonb)', 'pur_correct(uuid, uuid, jsonb, text)', 'pur_refund(uuid, uuid, text)', 'pur_void(uuid, uuid, text)',
  'pur_replace(uuid, uuid, jsonb, text)', 'pur_live_purchases(uuid, uuid)', 'pur_reader()'];
const INTERNAL = ['pur_lock(text[])', 'pur_body_keys(jsonb)', 'pur_stored_keys(uuid)', 'pur_month_no(text)',
  'pur_period_remaining(uuid)', 'pur_cover_period(uuid, uuid, date)', 'pur_fund(uuid, uuid, date, numeric)',
  'pur_prorate(numeric, numeric[])', 'pur_money(text)', 'pur_actor_owner(text)', 'pur_store(uuid, uuid, jsonb)',
  'pur_charge_rows(uuid)', 'pur_clear_rows(uuid)', 'pur_move_stock(uuid, uuid)', 'pur_doc(uuid)', 'pur_header_ok(jsonb)',
  'pur_op_begin(uuid)', 'pur_open(uuid, uuid)', 'pur_guard_expense_row()', 'pur_guard_delete()',
  'pur_purchase_lock(uuid)', 'pur_insert(uuid, uuid, jsonb, jsonb)', 'pur_uuid(text)', 'pur_qty(text)'];
const OPS = ['pur_record', 'pur_correct', 'pur_refund', 'pur_void', 'pur_replace'];
const ON_A_PURCHASE = ['pur_correct', 'pur_refund', 'pur_void', 'pur_replace'];

test('the five operations, the deletion pre-check and the read check: authenticated only, never anon', () => {
  for (const f of PUBLIC) {
    const esc = f.replace(/[()[\]]/g, '\\$&');
    assert(new RegExp('revoke all on function ' + esc + ' from public, anon;').test(C), f + ' not revoked from anon');
    assert(new RegExp('grant execute on function ' + esc + ' to authenticated;').test(C), f + ' not granted');
  }
});

test('every helper is internal (revoked from authenticated too)', () => {
  for (const f of INTERNAL) {
    const esc = f.replace(/[()[\]]/g, '\\$&');
    assert(new RegExp('revoke all on function ' + esc + ' from public, anon, authenticated;').test(C), f + ' is callable by users');
    assert(!new RegExp('grant execute on function ' + esc).test(C), f + ' granted');
  }
});

test('definer functions pin search_path; every pur_ function is accounted for', () => {
  const all = [...C.matchAll(/create or replace function (pur_\w+)\s*\(/g)].map(m => m[1]);
  const named = [...PUBLIC, ...INTERNAL].map(f => f.slice(0, f.indexOf('(')));
  for (const n of all) assert(named.includes(n), n + ' has no grant/revoke line');
  for (const n of all) {
    const b = fnBlock(n);
    if (/security definer/.test(b)) assert(/set search_path = public/.test(b), n + ' definer without search_path');
  }
});

test('who: active office accounts allowed Expenses; phone purchasing needs the Buyer switch', () => {
  const b = fnBlock('pur_actor_owner');
  assert(/pr_is_office\(\)/.test(b), 'office check must use pr_is_office (active accounts, 0094)');
  assert(/allowed_modules/.test(b) && /\? 'expenses'/.test(b) && /NOT_ALLOWED/.test(b), 'module-focused accounts must need expenses');
  assert(/'workmate'/.test(b) && /BUYER_REQUIRED/.test(b), "source 'workmate' must be refused until the Buyer switch exists");
  for (const n of OPS) assert(/pur_actor_owner\(/.test(fnBlock(n)), n + ' does not check the caller');
});

test('each operation takes its operation lock, then every project/stock lock, BEFORE writing anything', () => {
  assert(/pg_advisory_xact_lock/.test(fnBlock('pur_op_begin')) && /from pur_ops/.test(fnBlock('pur_op_begin')), 'pur_op_begin must lock, then read the stored answer');
  assert(/order by 1/.test(fnBlock('pur_lock')), 'locks must be taken in one fixed order');
  for (const n of OPS) {
    const b = fnBlock(n);
    const begin = b.indexOf('pur_op_begin(p_op)'), lock = b.indexOf('perform pur_lock('), write = b.search(/\n\s*(insert into|update |delete from|perform pur_clear_rows|perform pur_store)/);
    assert(begin !== -1 && lock > begin && write > lock, n + ': op lock → project locks → writes');
    assert(/insert into pur_ops/.test(b), n + ' does not store its answer');
  }
});

test('a change to one purchase locks THAT purchase before reading which projects it touches', () => {
  assert(/pg_advisory_xact_lock\(hashtextextended\('pur_purchase:'/.test(fnBlock('pur_purchase_lock')), 'per-purchase lock');
  for (const n of ON_A_PURCHASE) {
    const b = fnBlock(n);
    const pl = b.indexOf('perform pur_purchase_lock(p_purchase)'), keys = b.indexOf('pur_stored_keys(p_purchase)');
    assert(pl !== -1 && keys > pl, n + ': purchase lock → its stored projects');
  }
});

test('purchase-made and project-level rows are guarded; only the operations open the guard', () => {
  assert(/create trigger expenses_purchase_guard before insert or update or delete on expenses/.test(C), 'no guard trigger');
  assert(/old\.folder_id is not null/.test(fnBlock('pur_guard_expense_row')) && /new\.folder_id is not null/.test(fnBlock('pur_guard_expense_row')), 'project-level rows unguarded');
  const opened = [...C.matchAll(/set_config\('dacs\.purchase_write', 'on', true\)/g)].length;
  assert(opened === 5, 'the guard must be opened by exactly the five operations, found ' + opened);
});

test('Cover stays a subset; no period invented; links stay inside the company', () => {
  const rows = fnBlock('pur_charge_rows');
  assert(/insert into expenses \(/.test(rows) && /cover_expense/.test(rows), 'purchases must write ordinary expense rows flagged cover');
  assert(!/insert into projects/i.test(C), 'a period must never be created');
  assert(/p\.owner_id = p_owner/.test(fnBlock('pur_fund')) && /b\.owner_id = p_owner/.test(fnBlock('pur_fund')), 'periods and budgets must belong to the company');
  assert(/f\.owner_id = p_owner/.test(fnBlock('pur_store')), 'the project must belong to the company');
  assert(!/folder_id uuid references folders/.test(between(C, 'create table if not exists purchase_lines', ');')), 'purchase lines must not block deleting a project');
});

test('Cover link: a Cover period of any month, else a client period of the purchase month only', () => {
  assert(/\)\s*c\s+where[^\n]*\bsame_month\b/.test(fnBlock('pur_cover_period')), 'a Cover row never sits on another month\'s client period');
});

test('the completed-project lock also covers Additional Works jobs (completion is stamped on the main project)', () => {
  for (const f of ['pur_store', 'pur_open'])
    assert(/join folders par on par\.id = f\.parent_folder_id/.test(fnBlock(f)) && /par\.completed_at is not null/.test(fnBlock(f)),
           f + ' must also refuse staff when the parent project is completed');
});

test('a replayed operation is marked, so the form can say its later edits were not applied', () => {
  assert(/return v_prev \|\| jsonb_build_object\('replayed', true\);/.test(fnBlock('pur_op_begin')), 'pur_op_begin must mark a replay');
});

test('a project or period with a live purchase cannot be deleted — checked BEFORE its cascade, from the purchase lines', () => {
  assert(/create trigger folders_purchase_delete_guard before delete on folders/.test(C), 'folders guard');
  assert(/create trigger projects_purchase_delete_guard before delete on projects/.test(C), 'periods guard');
  const g = fnBlock('pur_guard_delete');
  assert(/from purchase_lines l join purchases pu on pu\.id = l\.purchase_id\s+where l\.folder_id = old\.id and pu\.status = 'recorded'/.test(g),
         'the project guard must read purchase lines (a fully discounted purchase has no expense rows)');
  assert(/PURCHASES_LIVE/.test(g), 'clear error');
  assert(/purchase_lines l where l\.purchase_id = pu\.id and l\.folder_id = p_folder/.test(fnBlock('pur_live_purchases')), 'the pre-check counts lines too');
});

test('the pre-check counts the Additional Works jobs under the project too', () => {
  assert(/parent_folder_id/.test(fnBlock('pur_live_purchases')), 'the pre-check counts the Additional Works jobs under the project too');
});

test('Project Control Additional Works delete asks about purchases before the confirm', () => {
  const b = between(PC, 'const deleteChild = async', '\n  };');
  const pre = b.indexOf('rpc("pur_live_purchases"');
  assert(pre !== -1 && pre < b.indexOf('confirm('), 'deleteChild must check purchases before confirm(');
});

test('_purErrorText maps BAD_PROJECT (reachable server codes are never shown raw)', () => {
  assert(/BAD_PROJECT:\s+'/.test(between(EXP, 'function _purErrorText(', '\n}\n')), 'BAD_PROJECT unmapped');
});

test('the period view skips no-period rows (they are added once by the panels, not into the period)', () => {
  const b = between(EXP, 'function updateBudgetOverview(', 'const exps    =');
  assert(/if \(!e\.projectId && e\.folderId\) return false;/.test(b), 'period branch must exclude no-period rows');
});

test('reading purchases needs the same access as recording them', () => {
  const r = fnBlock('pur_reader');
  assert(/pr_is_office\(\)/.test(r) && /\? 'expenses'/.test(r), 'active office account allowed Expenses');
  assert(/using \(can_access\(owner_id\) and pur_reader\(\)\)/.test(C), 'every purchase table policy must also require pur_reader()');
  assert(/using \(pur_reader\(\) and exists/.test(C), 'the shares policy too');
});

test('stock moves on the server, once per line', () => {
  assert(/create table if not exists purchase_stock_moves \(\s*line_id uuid primary key/.test(C), 'one move per line');
  assert(/on conflict \(line_id\) do nothing/.test(fnBlock('pur_move_stock')) && /if found then/.test(fnBlock('pur_move_stock')), 'a second move must add nothing');
  assert(/pur_move_stock\(/.test(fnBlock('pur_insert')) && !/pur_move_stock\(/.test(fnBlock('pur_correct') + fnBlock('pur_refund') + fnBlock('pur_void')), 'only recording moves stock');
  assert(/i\.owner_id = v_line\.owner_id or i\.owner_id is null/.test(fnBlock('pur_move_stock')), 'stock items stay inside the company (own, or unowned legacy)');
  assert(/p_carry/.test(fnBlock('pur_insert')) && /v_carry/.test(fnBlock('pur_replace')), 'a replacement carries the stock already moved');
});

test('nothing outside the money model is touched (reimbursements, warranty, quotations, allocations)', () => {
  for (const t of ['reimbursements', 'warranty_', 'quotations', 'project_control_billing_allocations', 'overhead_expenses'])
    assert(!C.includes(t), '0096 mentions ' + t);
});

console.log('\nDacs Web around it');

test('Add expense records through pur_record and decides no funding, Cover or stock itself', () => {
  const add = between(EXP, 'async function handleAddExpense(', '\nasync function deleteExpense(');
  assert(add.includes("rpc('pur_record'"), 'Add expense must call pur_record');
  assert(!/sortedSources|\.remain\b|coverExpense/.test(add), 'Add expense still decides funding or Cover itself');
  assert(!add.includes('_addExpenseToInventory('), 'the stock update must be the server\'s (once per line), never the browser\'s');
  assert(/data && data\.replayed/.test(add), 'handleAddExpense must read replayed and warn that later form edits were not applied');
});

test('the old browser stock writer is gone (the server owns stock now)', () => {
  assert(!EXP.includes('_addExpenseToInventory'), '_addExpenseToInventory must not come back');
});

test('staff never see a budget-based Cover guess (they cannot read budgets; the server funds it)', () => {
  const b = between(EXP, 'function _updateExpBudgetBanner(', '\nfunction expFundingCheckChanged(');
  const staff = b.indexOf("window.currentUserRole === 'staff'");
  assert(staff !== -1 && staff < b.indexOf('const folderMonths'), 'staff must return before the budget-based banner');
  const list = between(EXP, 'const _coverSet = new Set();', 'const _renderExpRow');
  assert(/if \(window\.currentUserRole !== 'staff'\)/.test(list), 'the list guess must skip staff');
  assert(/if \(e\.purchaseLineId \|\| e\.purchaseChargeId\) return;/.test(list), 'purchase rows must keep their real Cover flag');
});

test('purchase-made rows are edited and deleted through their purchase', () => {
  const del = between(EXP, 'async function deleteExpense(', '\nwindow.expToggleInventoryFields = function');
  const voidAt = del.indexOf("rpc('pur_void'");
  assert(voidAt !== -1 && voidAt < del.indexOf("showDeleteConfirm('Delete this expense?')"), 'delete must void a purchase row first');
  const save = between(EXP, 'async function _purSaveCorrection(', '\nasync function handleEditExpense(');
  assert(save.includes("rpc('pur_correct'") && save.includes('p_reason: reason'), 'edit must correct through pur_correct with a reason');
  const edit = between(EXP, 'async function handleEditExpense(', '\n// ════');
  const gate = edit.indexOf('if (_editingPurchase) return _purSaveCorrection();');
  assert(gate !== -1 && gate < edit.indexOf('.update(updateData)'), 'a purchase row must never reach the plain update');
});

test('no-period rows reach every Spent site: Project Control cards, detail, Additional Works, periods, Expenses, reports', () => {
  assert(/folderId: d\.projectId \? null : d\.folderId \|\| null/.test(PC), 'mapExpenseDoc must carry folderId');
  assert(PC.includes('childIds.has(e.projectId) || !e.projectId && e.folderId === f.id'), 'project cards');
  assert(PC.includes('childMonthIds.has(e.projectId) || !e.projectId && e.folderId === projectId'), 'project detail');
  assert(PC.includes('cfMonthIds.has(e.projectId) || !e.projectId && e.folderId === cf.id'), 'Additional Works cards');
  assert(/const totalSpent = cards\.reduce\(\(sum, c\) => sum \+ c\.totalCost, 0\) \+ noPeriodSpent;/.test(PC), 'billing-period drill total');
  assert(/where\('folderId', '==', folderId\)/.test(between(EXP, 'function subscribeFolderData(', '\n}\n')), 'Expenses folder view');
  const model = between(EXP, 'function _pcReportModel(', '\nfunction _pcDashboardReport(');
  assert(/noPeriodMaterial/.test(model) && /mats:sum\(rows, 'mats'\) \+ noPeriodMaterial/.test(model)
      && /cover:sum\(rows, 'cover'\) \+ noPeriodMaterial/.test(model), 'shared report model (Reports, KPI, prints, CSV)');
  assert(/No billing period \(Cover\)/.test(between(EXP, 'function exportRptTable(', '\nfunction ')), 'CSV line');
  assert(/No billing period \(Cover\)/.test(between(EXP, 'function _pcPrintFundingSummary(', '\nfunction ')), 'printed line');
  for (const [fn, marker] of [['function updateDashboardBudget(', '_expNoPeriodSpent(null)'], ['function renderProjectPanel(', '_expNoPeriodSpent(fid)'],
                              ['function mvpRenderFolderGrid(', '_expNoPeriodSpent(folder.id)'], ['function mvpRenderOvFolderDetail(', '_expNoPeriodRows(null)']])
    assert(between(EXP, fn, '\nfunction ').includes(marker), fn + ' must add the no-period purchases');
});

test('deleting asks about live purchases before the confirm and before anything is removed', () => {
  for (const fn of ['async function deleteFolder(', 'async function deleteProject(']) {
    const b = between(EXP, fn, '\nasync function ');
    const pre = b.indexOf("rpc('pur_live_purchases'"), confirm = b.indexOf('showDeleteConfirm('), first = b.search(/db\.collection\(|db\.batch\(/);
    assert(pre !== -1 && pre < confirm && pre < first, fn + ' must check purchases first');
  }
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) { console.log('\nFAILURES:\n  ' + failures.join('\n  ')); process.exit(1); }
