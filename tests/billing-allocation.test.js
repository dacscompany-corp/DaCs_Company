'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const A = require('../js/billing-allocation.js');

const eq = (actual, expected, message) => assert.deepStrictEqual(actual, expected, message);
const close = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 0.000001, message || `${actual} !== ${expected}`);
const policy = { directPct: 70, indirectPct: 20, targetMarginPct: 10 };

eq(A.pcValidateAllocationPolicy(policy).valid, true);
eq(A.pcValidateAllocationPolicy({ directPct: 70, indirectPct: 25, targetMarginPct: 10 }).valid, false);
eq(A.pcValidateAllocationPolicy(null), { valid: false, total: 0, message: 'Allocation not configured' });
eq(A.pcValidateAllocationPolicy({ directPct: 70.002, indirectPct: 19.998, targetMarginPct: 10 }).valid, true);
eq(A.pcValidateAllocationPolicy({ directPct: -1, indirectPct: 91, targetMarginPct: 10 }).valid, false);

const amounts = A.pcAllocationAmounts(100000, policy);
eq(amounts.directBudget, 70000);
eq(amounts.indirectBudget, 20000);
eq(amounts.targetMarginReserve, 10000);
eq(A.pcAllocationAmounts(-50, policy).base, 0);
eq(A.pcAllocationAmounts(100000, null), null);

eq(A.pcAllocationStatus(7999, 10000).key, 'healthy');
eq(A.pcAllocationStatus(8000, 10000).key, 'advisory');
eq(A.pcAllocationStatus(9000, 10000).key, 'high');
eq(A.pcAllocationStatus(10001, 10000).key, 'over');
eq(A.pcAllocationStatus(5, 0), { key: 'unbudgeted', pct: null });
eq(A.pcAllocationStatus(0, 0), { key: 'empty', pct: 0 });
close(A.pcAllocationStatus(125, 100).pct, 125);

const view = A.pcPeriodAllocationView(100000, policy, 72000, 19000);
eq(view.reserveAtRisk, 1000);
eq(view.totalActual, 91000);
eq(view.spendableBudget, 90000);
eq(view.directStatus.key, 'over');
eq(view.indirectStatus.key, 'high');
eq(A.pcPeriodAllocationView(100000, null, 1, 1), null);

const actuals = A.pcActualsForPeriod(
  'p1',
  [{ projectId: 'p1', totalSalary: 30000, laborType: 'direct' },
   { projectId: 'p1', totalSalary: 5000, laborType: 'indirect' },
   { projectId: 'other', totalSalary: 99999, laborType: 'direct' }],
  [{ projectId: 'p1', amount: 40000, coverExpense: true },
   { projectId: 'other', amount: 99999 }],
  [{ billingPeriodId: 'p1', amount: 3000 },
   { billingPeriodId: null, amount: 2000 },
   { billingPeriodId: 'p1', amount: 900, deletedAt: '2026-01-01' }],
  p => p.laborType === 'indirect'
);
eq(actuals.directActual, 70000);
eq(actuals.indirectActual, 8000);

const rollup = A.pcProjectAllocationRollup([
  view,
  A.pcPeriodAllocationView(50000, policy, 30000, 5000),
  null
], 1200, 18000, false);
eq(rollup.directBudget, 105000);
eq(rollup.indirectBudget, 30000);
eq(rollup.targetMarginReserve, 15000);
eq(rollup.directActual, 102000);
eq(rollup.indirectActual, 24000);
eq(rollup.unallocatedIndirect, 1200);
eq(rollup.actualProfit, 18000);
eq(rollup.isForecast, false);
eq(rollup.targetMarginVariance, 3000);
eq(A.pcProjectAllocationRollup([], 0, 123, true).targetMarginVariance, null);

// Static migration contracts: no local Postgres is required by this test runner.
// These fence privileges and audit structure; deployment still needs real RLS/RPC checks.
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const migrationFile = 'supabase/migrations/0073_project_control_billing_allocations.sql';
assert.ok(fs.existsSync(path.join(__dirname, '..', migrationFile)), 'allocation schema migration is missing');
const sql = read(migrationFile).replace(/--[^\n]*/g, '').toLowerCase();
function sqlHas(pattern, message) { assert.match(sql, pattern, message); }
function tableDefinition(table) {
  const match = sql.match(new RegExp('create table if not exists public\\.' + table + '\\s*\\(([\\s\\S]*?)\\n\\);'));
  assert.ok(match, `${table}: missing table definition`);
  return match[1];
}
const policyTable = 'project_control_allocation_policies';
const snapshotTable = 'project_control_billing_allocations';
const auditTable = 'billing_allocation_adjustments';
for (const [table, key, parent] of [[policyTable, 'folder_id', 'folders'], [snapshotTable, 'project_id', 'projects']]) {
  const definition = tableDefinition(table);
  assert.match(definition, new RegExp(key + '\\s+uuid primary key references public\\.' + parent + '\\(id\\) on delete cascade'), `${table}: wrong project-system FK`);
  for (const col of ['direct_pct', 'indirect_pct', 'target_margin_pct']) {
    assert.match(definition, new RegExp(col + '\\s+numeric\\(5,\\s*2\\) not null'), `${table}: incomplete snapshot permitted`);
    assert.match(definition, new RegExp(col + '\\s*>=\\s*0'), `${table}: negative allocation permitted`);
  }
  assert.match(definition, /abs\(direct_pct\s*\+\s*indirect_pct\s*\+\s*target_margin_pct\s*-\s*100\)\s*<\s*0\.005/, `${table}: percentages must total 100`);
}
const auditDefinition = tableDefinition(auditTable);
for (const col of ['old_direct_pct', 'old_indirect_pct', 'old_target_margin_pct', 'new_direct_pct', 'new_indirect_pct', 'new_target_margin_pct']) {
  assert.match(auditDefinition, new RegExp(col + '\\s+numeric\\(5,\\s*2\\)'), `audit omits ${col}`);
}
assert.match(auditDefinition, /created_by\s+uuid not null/, 'audit must identify the actor');
assert.match(auditDefinition, /created_at\s+timestamptz not null default now\(\)/, 'audit must timestamp changes');
assert.match(auditDefinition, /reason\s+text not null/, 'audit must preserve the reason');

const policies = [...sql.matchAll(/create policy\s+\w+\s+on\s+public\.(\w+)\s+for\s+(all|select|insert|update|delete)\s+to\s+authenticated\s+([\s\S]*?);/g)];
for (const table of [policyTable, snapshotTable, auditTable]) {
  sqlHas(new RegExp('alter table public\\.' + table + ' enable row level security'), `${table}: RLS must be enabled`);
  sqlHas(new RegExp('revoke all on table public\\.' + table + ' from public, anon, authenticated'), `${table}: default privileges must be removed`);
  const ownPolicies = policies.filter(p => p[1] === table);
  assert.ok(ownPolicies.length, `${table}: owner read access missing`);
  for (const [, , , predicate] of ownPolicies) {
    assert.match(predicate, /owner_id\s*=\s*\(select auth\.uid\(\)\)/, `${table}: tenant isolation missing`);
    assert.match(predicate, /role\s*=\s*'owner'/, `${table}: staff must never read allocation data`);
  }
}
eq(policies.filter(p => p[1] === snapshotTable).map(p => p[2]).sort(), ['insert', 'select'], 'snapshot changes must use the RPC');
eq(policies.filter(p => p[1] === auditTable).map(p => p[2]), ['select'], 'clients must not forge or change audit rows');
sqlHas(/grant select, insert, update, delete on table public\.project_control_allocation_policies to authenticated/, 'folder defaults need owner CRUD');
sqlHas(/grant select, insert on table public\.project_control_billing_allocations to authenticated/, 'new snapshots need a true insert path');
sqlHas(/grant select on table public\.billing_allocation_adjustments to authenticated/, 'audit history must be read-only');
sqlHas(/with check\s*\([\s\S]*?from public\.folders[\s\S]*?\.id\s*=\s*folder_id[\s\S]*?\.owner_id\s*=\s*\(select auth\.uid\(\)\)/, 'policy must belong to the parent folder owner');
sqlHas(/with check\s*\([\s\S]*?from public\.projects[\s\S]*?\.id\s*=\s*project_id[\s\S]*?\.owner_id\s*=\s*\(select auth\.uid\(\)\)/, 'snapshot must belong to the parent period owner');
sqlHas(/alter table public\.overhead_expenses\s+add column if not exists billing_period_id uuid references public\.projects\(id\) on delete set null/, 'overhead must reference billing periods, not construction projects');
sqlHas(/create index if not exists\s+\w+\s+on public\.overhead_expenses\(billing_period_id\)/, 'billing-period overhead FK needs an index');
assert.doesNotMatch(sql, /alter table\s+(?:public\.)?(?:folder_budgets|project_budgets)\b/, 'client-readable budgets must not carry target margin');

const rpc = sql.match(/create or replace function public\.update_project_control_billing_allocation\([\s\S]*?as \$\$([\s\S]*?)\$\$;/);
assert.ok(rpc, 'transactional adjustment RPC missing');
assert.match(rpc[0], /security definer\s+set search_path\s*=\s*''/, 'privileged RPC must have an empty search_path');
assert.match(rpc[1], /if auth\.uid\(\) is null then\s+raise exception/, 'RPC must reject anonymous calls');
assert.match(rpc[1], /from public\.profiles[\s\S]*?role\s*=\s*'owner'/, 'RPC must reject non-owner roles');
assert.match(rpc[1], /from public\.projects[\s\S]*?id\s*=\s*p_project_id[\s\S]*?owner_id\s*=\s*auth\.uid\(\)[\s\S]*?for update;\s*if not found then\s*raise exception/, 'RPC must lock and authorize the billing period');
assert.match(rpc[1], /btrim\(coalesce\(p_reason, ''\)\)\s*=\s*''/, 'RPC must reject a blank adjustment reason');
assert.match(rpc[1], /p_direct_pct is null[\s\S]*?p_indirect_pct is null[\s\S]*?p_target_margin_pct is null/, 'RPC must reject incomplete percentages');
assert.match(rpc[1], /from public\.project_control_billing_allocations[\s\S]*?for update;/, 'RPC must lock the old snapshot');
assert.match(rpc[1], /insert into public\.billing_allocation_adjustments[\s\S]*?insert into public\.project_control_billing_allocations[\s\S]*?on conflict\s*\(project_id\)\s*do update/, 'audit and snapshot must share one transaction');
assert.doesNotMatch(rpc[1], /exception when|\bcommit\b|\brollback\b/, 'RPC failure must roll back both writes');
sqlHas(/revoke all on function public\.update_project_control_billing_allocation\(uuid, numeric, numeric, numeric, text\) from public, anon, authenticated/, 'remove default RPC execution privileges');
sqlHas(/grant execute on function public\.update_project_control_billing_allocation\(uuid, numeric, numeric, numeric, text\) to authenticated/, 'only authenticated callers may enter the RPC');

// Exercise the real registry and converters: wrong names fail at the DB boundary.
const shim = read('js/supabase-config.js');
const start = shim.indexOf('const camelToSnake');
const end = shim.indexOf('// \u2500\u2500 6. Snapshot wrappers', start);
assert.ok(start !== -1 && end !== -1, 'SLICE NOT FOUND: update shim test extraction markers');
const { REG, toRow, fromRow } = new Function(shim.slice(start, end) + '\nreturn { REG, toRow, fromRow };')();
for (const [collection, table, key] of [
  ['projectControlAllocationPolicies', policyTable, 'folder_id'],
  ['projectControlBillingAllocations', snapshotTable, 'project_id']
]) {
  const config = REG[collection];
  assert.ok(config, `${collection}: shim registry missing`);
  eq(config.table, table);
  eq(config.idField, key);
  eq(toRow(config, { userId: 'owner-1', ...policy, updatedAt: new Date('2026-09-19T00:00:00Z') }), {
    owner_id: 'owner-1', direct_pct: 70, indirect_pct: 20, target_margin_pct: 10,
    updated_at: '2026-09-19T00:00:00.000Z'
  });
  const doc = fromRow(config, { owner_id: 'owner-1', direct_pct: 70, indirect_pct: 20, target_margin_pct: 10, updated_at: '2026-09-19T00:00:00Z' });
  eq(doc.userId, 'owner-1');
  eq(doc.targetMarginPct, 10);
  eq(doc.updatedAt.toDate().toISOString(), '2026-09-19T00:00:00.000Z');
}
assert.ok(REG.billingAllocationAdjustments, 'audit collection registry missing');
eq(REG.billingAllocationAdjustments.table, auditTable);
const adjustment = fromRow(REG.billingAllocationAdjustments, {
  owner_id: 'owner-1', project_id: 'period-1', old_direct_pct: null, old_indirect_pct: null,
  old_target_margin_pct: null, new_direct_pct: 70, new_indirect_pct: 20, new_target_margin_pct: 10,
  reason: 'Configure legacy period', created_by: 'owner-1', created_at: '2026-09-19T00:00:00Z'
});
eq(adjustment.oldDirectPct, null);
eq(adjustment.newTargetMarginPct, 10);
eq(adjustment.createdBy, 'owner-1');
eq(adjustment.userId, 'owner-1');
eq(adjustment.createdAt.toDate().toISOString(), '2026-09-19T00:00:00.000Z');

// Task 3 persistence fences. These source contracts protect browser-only write
// paths that cannot be exercised without Firebase/Supabase credentials.
const expensesSource = read('js/expenses-module.js');
const portalSource = read('js/portal-app.compiled.js');
function sourceSlice(source, start, end, label) {
  const from = source.indexOf(start);
  assert.ok(from !== -1, `${label}: start marker missing`);
  const to = end ? source.indexOf(end, from) : source.length;
  assert.ok(to !== -1, `${label}: end marker missing`);
  return source.slice(from, to);
}
function requireOwnerOnlySubscriptions(source, label) {
  const ownerBlock = sourceSlice(source, 'if (window.currentUserRole === \'owner\')', null, label);
  for (const collection of ['projectControlAllocationPolicies', 'projectControlBillingAllocations', 'billingAllocationAdjustments']) {
    assert.match(ownerBlock, new RegExp("db\\.collection\\(['\\\"]" + collection + "['\\\"]\\)"), `${label}: ${collection} must only be queried as owner`);
  }
}
const createFolder = sourceSlice(expensesSource, 'async function handleCreateFolder', 'let _editingFolderId', 'normal folder creation');
assert.match(createFolder, /pcReadPolicyInputs\('createFolder'\)/, 'normal folder creation must read the owner-selected default allocation policy');
assert.match(createFolder, /_pcSaveFolderPolicy\(ref\.id, policy\)/, 'normal folder creation must persist the selected allocation policy');
assert.match(expensesSource, /PC_ALLOCATION_DEFAULTS/, 'normal folder creation must use the shared default policy');

const createPeriod = sourceSlice(expensesSource, 'async function handleCreateProject', '// ════════════════════════════════════════════════════════════\n// FOLDER CRUD', 'normal billing-period creation');
assert.match(createPeriod, /_pcInsertInitialAllocation\(ref\.id, pcFolderPolicy\(folderId\)\)/, 'normal non-cover period creation must use a true snapshot insert');
assert.match(createPeriod, /!isPresident/, 'normal cover period creation must not create a snapshot');
assert.match(expensesSource, /sbClient\.from\('project_control_billing_allocations'\)\.insert\(/, 'initial snapshots must use a direct Supabase insert');

const editPeriod = sourceSlice(expensesSource, 'async function handleEditProject', '// ════════════════════════════════════════════════════════════\n// SELECT PROJECT', 'billing-period edit');
assert.match(editPeriod, /pcSaveAllocationAdjustment\(id, requestedPolicy, reason\)/, 'billing-period allocation changes must use the audited adjustment path');
assert.match(expensesSource, /sbClient\.rpc\('update_project_control_billing_allocation'/, 'billing-period allocation changes must use the audited RPC');
assert.match(editPeriod, /requestedPolicy = typeof window\.pcReadPolicyInputs === 'function'/, 'legacy edits must distinguish an explicit allocation request from the folder default');
assert.match(editPeriod, /!existingPolicy && previous\?\.fundingType !== 'president' && !reason/, 'legacy allocation application requires an explicit reason');
assert.match(editPeriod, /existingPolicy && _pcAllocationChanged\(existingPolicy, requestedPolicy\) && !reason/, 'existing allocation changes require a reason only when percentages change');
assert.doesNotMatch(editPeriod, /_pcRequestedPolicy\('editProject'/, 'ordinary legacy period edits must not fall back to the folder policy');

const autoPeriod = sourceSlice(portalSource, 'async function ensureAdditionalWorksPeriod', 'async function openAddEntry', 'Additional Works auto period');
assert.match(autoPeriod, /db\.collection\("projectBudgets"\)\.doc\(ref\.id\)\.set\(\{ userId: uid, monthlyBudget: 0 \}\)/, 'Additional Works auto period must create its zero budget row');
assert.match(autoPeriod, /sbClient\.from\("project_control_billing_allocations"\)\.insert\(/, 'Additional Works auto period must insert a snapshot');

const additionalWorks = sourceSlice(portalSource, 'function AdditionalWorksDrill', 'function _esc2', 'Additional Works folders');
const policyWrites = additionalWorks.match(/db\.collection\("projectControlAllocationPolicies"\)\.doc\([^)]*\)\.set\(/g) || [];
assert.ok(policyWrites.length >= 2, 'both Additional Works child-folder creation paths must persist default policies');
const additionalWorksSave = sourceSlice(additionalWorks, 'const save = async', 'const deleteChild', 'Additional Works estimate save');
assert.doesNotMatch(sourceSlice(additionalWorksSave, 'if (childId) {', '} else {', 'Additional Works estimate edit'), /projectControlAllocationPolicies/, 'editing an Additional Works estimate must not rewrite its allocation policy');

requireOwnerOnlySubscriptions(expensesSource, 'Expenses allocation subscriptions');
assert.match(portalSource, /typeof db === "undefined" \|\| !isOwner/, 'Project Control must skip owner-only allocation subscriptions for staff and non-owners');
const visibleAllocationMap = sourceSlice(portalSource, 'const visibleAllocationMap = React.useMemo', 'React.useEffect(() => {\n    if (!ownerId', 'visible allocation map');
assert.match(visibleAllocationMap, /if \(!isOwner\) return \{\};/, 'visible allocation maps must be empty synchronously for non-owners');
assert.match(portalSource, /Summarize, \{ project, allocationMap: isOwner \? visibleAllocationMap : \{\}, allocationAdjustments: isOwner \? allocationAdjustments : \[\] \}/, 'project summary must synchronously gate confidential allocation props');
assert.match(portalSource, /BillingPeriodsDrill, \{ project, childMonths, payrollRaw, expensesRaw, allocationMap: isOwner \? visibleAllocationMap : \{\}, allocationAdjustments: isOwner \? allocationAdjustments : \[\]/, 'billing periods must synchronously gate confidential allocation props');
for (const collection of ['projectControlAllocationPolicies', 'projectControlBillingAllocations', 'billingAllocationAdjustments']) {
  assert.match(portalSource, new RegExp("db\\.collection\\(\\\"" + collection + "\\\"\\)"), `Project Control must subscribe to ${collection} for owners`);
}

for (const collection of ['folderBudgets', 'projectBudgets', 'projects']) {
  for (const source of [expensesSource, portalSource]) {
    const writes = source.match(new RegExp("db\\.collection\\(['\\\"]" + collection + "['\\\"]\\)\\.doc\\([^)]*\\)\\.(?:set|update)\\(\\{[^}]*\\}", 'g')) || [];
    writes.forEach(write => assert.doesNotMatch(write, /targetMarginPct|target_margin_pct/, `${collection} must not store target-margin data`));
  }
}

// Task 4 allocation controls are intentionally source-tested: this runner has
// no browser or authenticated Supabase session, but these contracts protect the
// owner-only DOM and the shared validation/RPC paths it must invoke.
const adminSource = read('admin.html');
const expensesCss = read('css/expenses-module.css');
const expensesMvpCss = read('css/expenses-mvp.css');
for (const prefix of ['createFolder', 'editFolder', 'editProject']) {
  const totalId = prefix + 'AllocationTotal';
  assert.match(adminSource, new RegExp('id="' + totalId + '"[^>]*role="status"[^>]*aria-live="polite"'), `${prefix}: allocation total must be announced politely`);
  for (const field of ['DirectPct', 'IndirectPct', 'TargetMarginPct']) {
    const id = prefix + field;
    assert.match(adminSource, new RegExp('<label[^>]*for="' + id + '"[^>]*>'), `${prefix}: ${field} needs a visible label`);
    const input = adminSource.match(new RegExp('<input(?=[^>]*id="' + id + '")[^>]*>'));
    assert.ok(input, `${prefix}: ${field} input is missing`);
    for (const attribute of ['type="number"', 'min="0"', 'max="100"', 'step="0.01"', 'aria-describedby="' + totalId + '"']) {
      assert.ok(input[0].includes(attribute), `${prefix}: ${field} needs ${attribute}`);
    }
  }
}
assert.match(adminSource, /id="createFolderDirectPct" value="70"/, 'new folder allocation starts at 70% direct cost');
assert.match(adminSource, /id="createFolderIndirectPct" value="20"/, 'new folder allocation starts at 20% indirect cost');
assert.match(adminSource, /id="createFolderTargetMarginPct" value="10"/, 'new folder allocation starts at 10% target margin');
for (const id of ['createProjectAllocationPreview', 'editProjectAllocationPreview']) {
  assert.match(adminSource, new RegExp('id="' + id + '"[^>]*data-pc-owner-only'), `${id}: preview must be owner-only`);
}
for (const id of ['createFolderAllocationControls', 'editFolderAllocationControls', 'editProjectAllocationControls']) {
  assert.match(adminSource, new RegExp('id="' + id + '"[^>]*data-pc-owner-only'), `${id}: controls must be owner-only`);
}
assert.match(adminSource, /Target Margin Reserve/, 'allocation UI must call the reserve by its correct name');
assert.doesNotMatch(sourceSlice(adminSource, 'id="createFolderAllocationControls"', '</form>', 'folder allocation form'), />\s*Profit\s*</, 'allocation UI must not call target margin Profit');
assert.match(adminSource, /id="editProjAllocationReason"/, 'billing-period edit needs an adjustment reason field');

for (const fn of ['pcReadPolicyInputs', 'pcRenderPolicyTotal', 'pcRenderBillingPreview']) {
  assert.match(expensesSource, new RegExp('function ' + fn + '\\('), `${fn} must be available to allocation forms`);
}
assert.match(expensesSource, /pcReadPolicyInputs\(prefix\)[\s\S]*pcValidateAllocationPolicy/, 'policy input reader must use the shared validation engine');
assert.match(expensesSource, /pcRenderBillingPreview\(mode\)[\s\S]*pcAllocationAmounts/, 'billing preview must use the shared allocation engine');
assert.match(expensesSource, /isPresident[\s\S]*pcRenderBillingPreview/, 'cover funding must suppress billing allocation preview');
assert.match(expensesSource, /field\.disabled = !isVisible/, 'cover funding must disable hidden snapshot inputs so stale validity cannot block the period form');
assert.match(expensesSource, /pcRenderPolicyTotal\(prefix\)[\s\S]*aria-invalid/, 'invalid allocation totals must set accessible invalid state');
assert.match(expensesSource, /pcSaveAllocationAdjustment\(id, requestedPolicy, reason\)/, 'legacy allocation application must use the audited RPC');
assert.match(expensesSource, /!existingPolicy[\s\S]*pcSaveAllocationAdjustment\(id, requestedPolicy, reason\)/, 'legacy allocation application must audit null prior values through the RPC');
assert.match(expensesSource, /Apply Allocation Policy/, 'legacy billing periods need an explicit apply action');
assert.match(expensesCss, /\.pc-allocation-fields[\s\S]*grid-template-columns:\s*repeat\(3,\s*minmax\(/, 'allocation inputs need stable three-column desktop tracks');
assert.match(expensesCss, /@media \(max-width:\s*560px\)[\s\S]*\.pc-allocation-fields[\s\S]*grid-template-columns:\s*1fr/, 'allocation inputs need a narrow-screen single-column layout');
assert.match(expensesMvpCss, /\.pc-allocation-swatch--direct/, 'preview must have a direct-cost swatch');
assert.match(expensesMvpCss, /\.pc-allocation-swatch--indirect/, 'preview must have an indirect-cost swatch');
assert.match(expensesMvpCss, /\.pc-allocation-swatch--reserve/, 'preview must have a reserve swatch');

// Task 4 fix round 1: modal state must reset on every entry path and cover
// transitions must retain dormant snapshots without retaining stale authority.
const createFolderOpener = sourceSlice(expensesSource, 'function openCreateFolderModal', 'window.onFillFromPaymentRequest', 'create-folder opener');
assert.match(createFolderOpener, /createFolderForm'\)\?\.reset\(\)/, 'opening a new folder must reset stale form state');
assert.match(createFolderOpener, /_pcPrepareCreateFolderAllocation\(\)/, 'opening a new folder must reapply 70\/20\/10 and total validity');
assert.match(createFolderOpener, /openExpModal\('createFolderModal'\)/, 'the create-folder wrapper must retain the existing modal infrastructure');
assert.match(adminSource, /onclick="openCreateFolderModal\(\)"/, 'static create-folder entry points must use the reset wrapper');
assert.match(expensesSource, /onclick="openCreateFolderModal\(\)"/, 'rendered create-folder entry points must use the reset wrapper');

const paymentRequestFill = sourceSlice(expensesSource, 'window.onFillFromPaymentRequest = function', 'function onFundingTypeChange', 'payment-request fill');
assert.match(paymentRequestFill, /budgetInput\.value = Number\(amount\)\.toLocaleString\('en-PH'\);[\s\S]*pcRenderBillingPreview\('createProject'\)/, 'payment-request amounts must refresh the allocation preview immediately');

assert.match(expensesSource, /function _pcRawPeriodPolicy\(projectId\)/, 'edit preparation needs access to a dormant retained snapshot');
assert.match(expensesSource, /const existingPolicy = _pcRawPeriodPolicy\(project\.id\)/, 'cover-funded edits must populate from a retained snapshot when one exists');
assert.match(expensesSource, /_pcUpdateEditAllocationReason\(null, true\)/, 'Cover selection must force reason controls inactive');
const reasonState = sourceSlice(expensesSource, 'function _pcUpdateEditAllocationReason', 'function pcRenderPolicyTotal', 'adjustment reason state');
assert.match(reasonState, /const needsReason = !suppressReason/, 'Cover state must override legacy reason state');
assert.match(reasonState, /if \(!needsReason && input\) input\.value = '';/, 'unchanged policy state must clear stale adjustment reasons');
assert.doesNotMatch(adminSource, /Target Margin %/, 'percentage labels must name the reserve explicitly');
eq((adminSource.match(/Target Margin Reserve %/g) || []).length, 3, 'all percentage labels must say Target Margin Reserve %');

console.log('billing allocation tests passed');
