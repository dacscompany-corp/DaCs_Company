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
assert.match(portalSource, /BillingPeriodsDrill, \{ project, childMonths, \.\.\.allocationCosts, allocationMap: isOwner \? visibleAllocationMap : \{\}, allocationAdjustments: isOwner \? allocationAdjustments : \[\]/, 'billing periods must synchronously gate confidential allocation props');
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

// Task 5: exercise the actual form callbacks, payloads and report output.
// These catch stale cross-folder selections and lost attribution on edit/export.
const vm = require('vm');
const overheadSource = read('js/overhead-module.js');
assert.match(adminSource, /for="ovhdExpBillingPeriod"/, 'admin selector needs an associated label');
assert.match(adminSource, /id="ovhdExpProject" onchange="_ovhdPopulateBillingPeriodSelect/, 'folder changes must refresh period choices');
assert.match(portalSource, /OverheadDrill, \{ key: projectId, project, childMonths,/, 'changing jobs must remount the drill and pass its periods');
assert.match(portalSource, /overheadRowsTx\.map\(\(e\) => \(\{[^\n]*billingPeriodId: e\.billingPeriodId[^\n]*history: e\.history/, 'drill mapping must preserve attribution and audit history');
const periods = [{ id: 'p1', folderId: 'f1', name: 'September' },
  { id: 'p2', folderId: 'f1', month: 'October', year: '2026' },
  { id: 'p3', folderId: 'f2', name: 'Other job' }];
function overheadHarness() {
  const elements = {};
  const el = id => elements[id] || (elements[id] = { value: '', style: {}, innerHTML: '', classList: { add() {}, remove() {} } });
  const writes = [];
  const scope = { value: 'project' };
  let printed = '', csv = '';
  const context = vm.createContext({ console, expProjects: periods.map(p => ({ ...p })), expFolders: [{ id: 'f1', name: 'Job One' }],
    currentUser: { uid: 'owner' }, window: { currentDataUserId: 'owner', open: () => ({ document: { write: h => { printed = h; }, close() {} }, print() {} }) },
    document: { getElementById: el, querySelector: () => scope, createElement: () => ({ click() {} }), body: { appendChild() {}, removeChild() {} } },
    firebase: { firestore: { FieldValue: { serverTimestamp: () => 'now' } } },
    db: { collection: name => { eq(name, 'overheadExpenses'); return { add: async data => { writes.push(data); return { id: 'new' }; }, doc: id => ({ update: async data => writes.push({ id, ...data }) }) }; } },
    Blob: class { constructor(parts) { csv = parts.join(''); } }, URL: { createObjectURL: () => 'blob:test', revokeObjectURL() {} }, setTimeout() {} });
  vm.runInContext(overheadSource, context);
  vm.runInContext('_ovhdRender = () => {}; _ovhdPopulateCategorySelect = () => {}; _ovhdMonth = "2026-09";', context);
  Object.entries({ ovhdExpProject: 'f1', ovhdExpBillingPeriod: 'p1', ovhdExpName: 'Fuel', ovhdExpCategory: 'Fuel', ovhdExpAmount: '100', ovhdExpDate: '2026-09-01', ovhdExpDescription: 'Site fuel' }).forEach(([id, value]) => { el(id).value = value; });
  return { context, el, scope, writes, reports: () => ({ printed, csv }) };
}

async function testOverheadAttribution() {
  const a = overheadHarness();
  await a.context.handleSaveOverheadExpense();
  eq(a.writes[0].billingPeriodId, 'p1', 'admin create must save the chosen period');
  a.el('ovhdEditingId').value = 'new';
  a.el('ovhdExpBillingPeriod').value = 'p2';
  await a.context.handleSaveOverheadExpense();
  eq(a.writes[1].billingPeriodId, 'p2', 'admin edit must save reassignment');
  assert.ok(a.writes[1].history.at(-1).fields.includes('billingPeriodId'), 'reassignment must be audited');
  a.context._ovhdPopulateBillingPeriodSelect('f1', 'p1');
  assert.match(a.el('ovhdExpBillingPeriod').innerHTML, /September/);
  assert.doesNotMatch(a.el('ovhdExpBillingPeriod').innerHTML, /Other job/);
  a.context._ovhdPopulateBillingPeriodSelect('f2', 'p1');
  eq(a.el('ovhdExpBillingPeriod').value, '', 'changing folder clears an incompatible period');
  a.scope.value = 'company';
  a.el('ovhdExpBillingPeriod').value = 'p1';
  a.context.onOverheadScopeFieldChange();
  eq(a.el('ovhdExpBillingPeriod').value, '', 'company scope clears period');
  eq(a.el('ovhdExpBillingPeriodGroup').style.display, 'none');
  a.el('ovhdExpBillingPeriod').value = 'p1';
  await a.context.handleSaveOverheadExpense();
  eq(a.writes.at(-1).billingPeriodId, null, 'company save cannot retain period');
  a.scope.value = 'project';
  a.el('ovhdExpProject').value = 'f1';
  for (const editingId of ['', 'new']) {
    a.el('ovhdEditingId').value = editingId;
    a.el('ovhdExpBillingPeriod').value = 'p3';
    await a.context.handleSaveOverheadExpense();
    eq(a.writes.at(-1).billingPeriodId, null, 'cross-folder create/edit must save Unallocated');
  }
  a.el('ovhdExpBillingPeriod').value = 'p1';
  a.context.expProjects[0].folderId = 'f2';
  await a.context.handleSaveOverheadExpense();
  eq(a.writes.at(-1).billingPeriodId, null, 'save must revalidate a period moved after the form opened');

  const b = overheadHarness();
  vm.runInContext(`_ovhdExpenses = [
    { folderId:'f1', billingPeriodId:'p1', amount:100, date:'2026-09-01' },
    { folderId:'f1', billingPeriodId:null, amount:200, date:'2026-09-01' },
    { folderId:'f1', billingPeriodId:'p3', amount:300, date:'2026-09-01' }];
    var expPayroll = [{ id:'pay', projectId:'p2', laborType:'indirect', totalSalary:400, paymentDate:'2026-09-01' }];`, b.context);
  b.context.exportOverheadCsv();
  b.context.printOverheadReport('monthly');
  b.context._ovhdRenderTable(b.context._ovhdRows());
  assert.match(b.reports().csv, /"Project","Billing Period"/);
  assert.match(b.reports().csv, /"Job One","September"/);
  assert.match(b.reports().csv, /"Job One","October 2026"/);
  eq((b.reports().csv.match(/"Unallocated"/g) || []).length, 2);
  assert.match(b.reports().printed, /<th>Project<\/th><th>Billing Period<\/th>/);
  assert.match(b.reports().printed, /<td>September<\/td>/);
  assert.match(b.reports().printed, /<td>October 2026<\/td>/);
  assert.doesNotMatch(b.reports().printed, /Other job/);
  assert.match(b.el('ovhdTableBody').innerHTML, /<td>September<\/td>/);
  assert.match(b.el('ovhdTableBody').innerHTML, /<td>October 2026<\/td>/);
  eq((b.el('ovhdTableBody').innerHTML.match(/<td>Unallocated<\/td>/g) || []).length, 2);

  const helper = sourceSlice(portalSource, 'function _pcActualsForPeriod(', 'function OverheadDrill(', 'folder-safe actuals');
  const ctx = vm.createContext({ ...A, _isOverheadPay: row => row.type === 'indirect' || row.type === 'liability' && row.liabilityFor === 'indirect', mapPayrollDoc: row => ({ ...row, type: row.laborType }) });
  vm.runInContext(helper, ctx);
  const overhead = [
    { folderId:'f1', billingPeriodId:'p1', amount:100 },
    { folderId:'f1', billingPeriodId:null, amount:200 },
    { folderId:'f2', billingPeriodId:'p1', amount:300 },
    { folderId:'f1', billingPeriodId:'p1', scope:'company', amount:400 },
    { folderId:'f1', billingPeriodId:'p2', amount:500 },
    { folderId:'f1', billingPeriodId:'p3', amount:700 },
    { folderId:'f1', billingPeriodId:'p1', amount:600, deletedAt:'x' }
  ];
  const actual = ctx._pcActualsForPeriod(periods[0], [
    { projectId:'p1', laborType:'indirect', totalSalary:50 },
    { projectId:'p1', laborType:'liability', liabilityFor:'indirect', totalSalary:10 }
  ], [{ projectId:'p1', amount:25, coverExpense:true }], overhead);
  eq(actual.indirectActual, 160, 'only same-folder matching overhead and indirect payroll consume envelope');
  eq(actual.directActual, 25, 'Cover remains in its original cost bucket');
  eq(ctx._pcActualsForPeriod(periods[2], [], [], overhead).indirectActual, 0, 'invalid relation cannot consume another folder envelope');
  await testOverheadDrill();
}

function drillHarness(storage) {
  const state = [], writes = [];
  let cursor = 0;
  let unmount = () => {};
  const context = vm.createContext({ console, React: { Fragment: 'fragment', createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity) }),
    useState: initial => { const i = cursor++; if (!(i in state)) state[i] = initial; return [state[i], next => { state[i] = typeof next === 'function' ? next(state[i]) : next; }]; },
    useRef: initial => { const i = cursor++; if (!(i in state)) state[i] = { current: initial }; return state[i]; },
    useEffect: (effect, deps) => { if (deps && !deps.length) unmount = effect() || (() => {}); } },
    _staff: () => false, _ocmStatus: () => null, peso: String, Ico: {}, ExpenseInboxMount() {}, _ovhdLocalToday: () => '2026-09-01',
    window: { currentDataUserId: 'owner', storage }, firebase: { firestore: { FieldValue: { serverTimestamp: () => 'now' } } }, alert: message => { throw new Error(message); },
    db: { collection: name => { eq(name, 'overheadExpenses'); return { add: async data => writes.push(data), doc: id => ({ update: async data => writes.push({ id, ...data }) }) }; } } });
  vm.runInContext(sourceSlice(portalSource, 'function OverheadDrill(', 'function _awId()', 'overhead drill'), context);
  const props = { folderId:'f1', childMonths:periods.map(p => ({ ...p })), overheadTx:[], indirectTx:[] };
  const render = () => { cursor = 0; return context.OverheadDrill(props); };
  const nodes = tree => [tree, ...(tree && tree.children || []).flatMap(child => typeof child === 'object' && child ? nodes(child) : [])];
  const find = predicate => nodes(render()).find(predicate);
  return { props, writes, render, find, unmount: () => unmount() };
}
async function testOverheadDrill() {
  const d = drillHarness();
  d.find(n => n.type === 'button' && n.children.includes('+ Add Expense')).props.onClick();
  let select = d.find(n => n.type === 'select' && n.props.id === 'ovhdDrillBillingPeriod');
  assert.ok(select, 'drill needs billing-period select');
  eq(select.children.filter(n => n.type === 'option').map(n => n.props.value), ['', 'p1', 'p2']);
  assert.ok(d.find(n => n.type === 'label' && n.props.htmlFor === select.props.id), 'select needs associated label');
  select.props.onChange({ target:{ value:'p1' } });
  d.find(n => n.type === 'input' && n.props.list === 'ovhdDrillCatList').props.onChange({ target:{ value:'Fuel' } });
  d.find(n => n.type === 'input' && n.props.type === 'number').props.onChange({ target:{ value:'100' } });
  await d.find(n => n.type === 'button' && n.children.includes('Save Expense')).props.onClick();
  eq(d.writes[0].billingPeriodId, 'p1', 'drill create saves selected period');
  d.props.overheadTx = [{ id:'e1', folderId:'f1', billingPeriodId:'p1', category:'Fuel', amount:100, date:'2026-09-01', history:[] }];
  d.props.indirectTx = [{ id:'pay', projectId:'p2', amount:50, date:'2026-09-01' }];
  assert.ok(d.find(n => n.type === 'td' && n.children.includes('September')), 'drill table labels attributed operating costs');
  assert.ok(d.find(n => n.type === 'td' && n.children.includes('October 2026')), 'drill table labels payroll using projectId');
  d.find(n => n.type === 'button' && n.props.title === 'Edit').props.onClick();
  eq(d.find(n => n.props.id === 'ovhdDrillBillingPeriod').props.value, 'p1');
  d.find(n => n.props.id === 'ovhdDrillBillingPeriod').props.onChange({ target:{ value:'p2' } });
  await d.find(n => n.type === 'button' && n.children.includes('Save Changes')).props.onClick();
  eq(d.writes[1].billingPeriodId, 'p2', 'drill edit saves reassignment');
  assert.ok(d.writes[1].history.at(-1).fields.includes('billingPeriodId'));
  d.find(n => n.type === 'button' && n.props.title === 'Edit').props.onClick();
  d.props.childMonths[0].folderId = 'f2';
  eq(d.find(n => n.props.id === 'ovhdDrillBillingPeriod').props.value, '', 'moved period disappears from drill selection');
  await d.find(n => n.type === 'button' && n.children.includes('Save Changes')).props.onClick();
  eq(d.writes.at(-1).billingPeriodId, null, 'drill edit revalidates moved period');
  d.find(n => n.type === 'button' && n.children.includes('+ Add Expense')).props.onClick();
  d.find(n => n.props.id === 'ovhdDrillBillingPeriod').props.onChange({ target:{ value:'p3' } });
  d.find(n => n.type === 'input' && n.props.list === 'ovhdDrillCatList').props.onChange({ target:{ value:'Fuel' } });
  d.find(n => n.type === 'input' && n.props.type === 'number').props.onChange({ target:{ value:'100' } });
  await d.find(n => n.type === 'button' && n.children.includes('Save Expense')).props.onClick();
  eq(d.writes.at(-1).billingPeriodId, null, 'drill create rejects cross-folder period');
}

async function testOverheadUploadFreshness() {
  for (const editing of [false, true]) {
    for (const change of ['period moved', 'folder changed', 'unmounted', 'unchanged']) {
      let finishUpload;
      const upload = new Promise(resolve => { finishUpload = resolve; });
      const d = drillHarness({ ref: () => ({ put: () => upload, getDownloadURL: async () => 'https://example.test/receipt.jpg' }) });
      if (editing) {
        d.props.overheadTx = [{ id:'e1', folderId:'f1', billingPeriodId:'p1', category:'Fuel', amount:100, date:'2026-09-01', history:[] }];
        d.find(n => n.type === 'button' && n.props.title === 'Edit').props.onClick();
      } else {
        d.find(n => n.type === 'button' && n.children.includes('+ Add Expense')).props.onClick();
        d.find(n => n.props.id === 'ovhdDrillBillingPeriod').props.onChange({ target:{ value:'p1' } });
        d.find(n => n.type === 'input' && n.props.list === 'ovhdDrillCatList').props.onChange({ target:{ value:'Fuel' } });
        d.find(n => n.type === 'input' && n.props.type === 'number').props.onChange({ target:{ value:'100' } });
      }
      d.find(n => n.type === 'input' && n.props.type === 'file').props.onChange({ target:{ files:[{ name:'receipt.jpg' }] } });
      const saving = d.find(n => n.type === 'button' && n.children.includes(editing ? 'Save Changes' : 'Save Expense')).props.onClick();
      eq(d.writes.length, 0, 'receipt upload must precede the expense write');
      if (change === 'period moved') d.props.childMonths = d.props.childMonths.map(p => p.id === 'p1' ? { ...p, folderId:'f2' } : p);
      if (change === 'folder changed') d.props.folderId = 'f2';
      d.render();
      if (change === 'unmounted') d.unmount();
      finishUpload();
      await saving;
      eq(d.writes.length, 1);
      eq(d.writes[0].billingPeriodId, change === 'unchanged' ? 'p1' : null,
        `${editing ? 'edit' : 'create'} must validate latest membership after upload: ${change}`);
      eq(d.writes[0].receiptUrl, 'https://example.test/receipt.jpg');
      if (editing && change !== 'unchanged') assert.ok(d.writes[0].history.at(-1).fields.includes('billingPeriodId'), 'upload-time invalidation must be audited');
    }
  }
}

function testOverheadCsvFormulas() {
  const h = overheadHarness();
  h.context.expFolders[0].name = '@job';
  h.context.expProjects[0].name = '=SUM("1","2")';
  vm.runInContext(`_ovhdExpenses = [{ folderId:'f1', billingPeriodId:'p1', amount:-123.45,
    date:'2026-09-01', category:'+category', expenseName:'-expense', status:'=status' }];`, h.context);
  h.context.exportOverheadCsv();
  eq(h.reports().csv.split('\n')[1], `"2026-09-01","Project","'@job","'=SUM(""1"",""2"")","'+category","'-expense","-123.45","'=status","Overhead Expense"`,
    'CSV textual cells must neutralize formulas before quoting, while numeric amounts remain numeric');
}

function dashboardHarness() {
  const state = [], edits = [];
  let cursor = 0;
  const context = vm.createContext({ ...A, console, Date, Set,
    React: { Fragment: 'fragment', createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity) }),
      useState: initial => { const i = cursor++; if (!(i in state)) state[i] = initial; return [state[i], next => { state[i] = next; }]; },
      useRef: () => ({ current: null }), useEffect() {} },
    window: { currentUserRole: 'owner', openEditProjectModal: id => edits.push(id) },
    peso: n => Number(n).toFixed(2), Ico: {}, COVER_LIMIT: 50000,
    _staff: () => context.window.currentUserRole === 'staff'
  });
  vm.runInContext(sourceSlice(portalSource, 'function shortRef(', 'function mapExpenseDoc', 'payroll mapper')
    + sourceSlice(portalSource, 'function _isOverheadPay', 'function FoldersGrid', 'money helpers')
    + sourceSlice(portalSource, 'function PageHead(', 'function KPIStrip(', 'print consumer')
    + sourceSlice(portalSource, 'function Summarize(', 'function RecentEntries(', 'dashboard')
    + sourceSlice(portalSource, 'function _pcActualsForPeriod(', 'function OverheadDrill(', 'actuals'), context);
  function expand(tree) {
    if (!tree || typeof tree !== 'object') return tree;
    if (typeof tree.type === 'function') return expand(tree.type(tree.props));
    return { ...tree, children: tree.children.map(expand) };
  }
  const render = (name, props) => { cursor = 0; return expand(context[name](props)); };
  const nodes = tree => !tree || typeof tree !== 'object' ? [] : [tree, ...tree.children.flatMap(nodes)];
  const text = tree => !tree || typeof tree === 'boolean' ? '' : typeof tree !== 'object' ? String(tree) : tree.children.map(text).join(' ');
  return { context, render, nodes, text, edits };
}

function testAllocationDashboard() {
  const h = dashboardHarness();
  const project = { id:'f1', name:'Job One', revenue:200000, labor:72000, material:0, overhead:24000, completion:{ hasData:true, pct:0.6 } };
  const childMonths = [
    { id:'a', folderId:'f1', month:'September', year:2026, monthlyBudget:100000 },
    { id:'legacy', folderId:'f1', month:'August', year:2026, monthlyBudget:50000 },
    { id:'cover', folderId:'f1', month:'July', year:2026, monthlyBudget:900000, fundingType:'president' }
  ];
  const props = { project, childMonths, payrollRaw:[
    { projectId:'a', laborType:'direct', totalSalary:72000 },
    { projectId:'a', laborType:'indirect', totalSalary:15000 },
    { projectId:'a', laborType:'liability', liabilityFor:'indirect', totalSalary:1000 }
  ], expensesRaw:[], overheadRaw:[
    { folderId:'f1', billingPeriodId:'a', amount:3000 },
    { folderId:'f1', billingPeriodId:null, amount:5000 },
    { folderId:'f1', billingPeriodId:null, amount:6000, deletedAt:'x' },
    { folderId:'f1', scope:'company', amount:7000 },
    { folderId:'f2', amount:8000 }
  ], allocationMap:{ a:policy, cover:policy }, allocationAdjustments:[
    { id:'change', projectId:'a', oldDirectPct:70, oldIndirectPct:20, oldTargetMarginPct:10, newDirectPct:65, newIndirectPct:25, newTargetMarginPct:10, reason:'Site supervision', createdBy:'owner-123', createdAt:'2026-09-19T08:00:00Z' },
    { id:'other', projectId:'legacy', reason:'Wrong period' }
  ] };
  let tree = h.render('BillingPeriodsDrill', props);
  assert.match(h.text(tree), /Target Margin Reserve/, 'configured periods must render planning reserve');
  const cards = h.nodes(tree).filter(n => n.props.className === 'pc-period-card');
  const configured = cards.find(n => h.text(n).includes('September'));
  for (const amount of ['70000.00', '72000.00', '-2000.00', '20000.00', '19000.00', '1000.00', '10000.00']) assert.ok(h.text(configured).includes(amount), 'missing budget/actual/remaining ' + amount);
  assert.match(h.text(configured), /Over budget/);
  assert.match(h.text(configured), /High usage/);
  assert.match(h.text(configured), /Reserve at Risk/);
  const legacy = cards.find(n => h.text(n).includes('August'));
  assert.match(h.text(legacy), /Allocation not configured/);
  h.nodes(legacy).find(n => n.type === 'button' && h.text(n).includes('Apply Policy')).props.onClick();
  eq(h.edits, ['legacy'], 'Apply Policy must open the existing audited period editor');
  const cover = cards.find(n => h.text(n).includes('July'));
  assert.match(h.text(cover), /Cover Expenses/);
  assert.doesNotMatch(h.text(cover), /Target Margin Reserve|Apply Policy|900000|Allocation History/);
  const bars = h.nodes(configured).filter(n => n.type === 'progress');
  eq(bars.length, 2);
  assert.ok(bars.every(n => n.props['aria-label'] && n.props.max === 100 && n.props.value <= 100));
  h.nodes(configured).find(n => n.type === 'button' && h.text(n).includes('History')).props.onClick();
  tree = h.render('BillingPeriodsDrill', props);
  const dialog = h.nodes(tree).find(n => n.type === 'dialog');
  assert.ok(dialog, 'history must use a modal dialog');
  for (const value of ['Before', 'After', '70%', '65%', 'Site supervision', 'owner-123', '2026']) assert.ok(h.text(dialog).includes(value), 'history missing ' + value);
  assert.doesNotMatch(h.text(dialog), /Wrong period/);
  const summary = h.context._pcAllocationSummary(project, childMonths, props.payrollRaw, [], props.overheadRaw, props.allocationMap);
  eq(summary.directBudget, 70000);
  eq(summary.indirectBudget, 20000);
  eq(summary.targetMarginReserve, 10000);
  eq(summary.unallocatedIndirect, 5000);
  eq(summary.legacyCount, 1);
  eq(summary.configuredCount, 1);
  eq(summary.actualProfit, 24000);
  eq(summary.targetMarginVariance, 14000);
  eq(summary.directActual, 72000);
  eq(summary.indirectActual, 19000, 'unallocated operating costs must not consume the period envelope');
  const childRollup = h.context._pcAllocationSummary(project,
    [...childMonths, { id:'child-period', folderId:'child', monthlyBudget:50000 }, { id:'foreign', folderId:'f2', monthlyBudget:999999 }],
    [...props.payrollRaw, { projectId:'child-period', laborType:'direct', totalSalary:10000 }], [],
    [...props.overheadRaw, { folderId:'child', amount:600 }, { folderId:'child', billingPeriodId:'child-period', amount:700 }],
    { ...props.allocationMap, 'child-period':policy, foreign:policy }, ['f1', 'child']);
  eq(childRollup.directBudget, 105000, 'merged project includes child envelopes but excludes unrelated folders');
  eq(childRollup.indirectBudget, 30000);
  eq(childRollup.targetMarginReserve, 15000);
  eq(childRollup.directActual, 82000);
  eq(childRollup.indirectActual, 19700);
  eq(childRollup.unallocatedIndirect, 5600);
  let rollupTree = h.render('AllocationRollup', { summary });
  assert.match(h.text(rollupTree), /Actual Earned Profit/);
  assert.match(h.text(rollupTree), /Unallocated Indirect Cost/);
  assert.match(h.text(rollupTree), /14000.00/);
  project.completion = null;
  const forecast = h.context._pcAllocationSummary(project, childMonths, props.payrollRaw, [], props.overheadRaw, props.allocationMap);
  eq(forecast.targetMarginVariance, null);
  rollupTree = h.render('AllocationRollup', { summary:forecast });
  assert.match(h.text(rollupTree), /Forecast/);
  assert.doesNotMatch(h.text(rollupTree), /Actual Earned Profit|Target Variance/);
  props.payrollRaw[0].totalSalary = 56000;
  assert.match(h.text(h.render('BillingPeriodsDrill', props)), /Advisory/);
  for (const role of ['staff', 'client', undefined]) {
    h.context.window.currentUserRole = role;
    tree = h.render('BillingPeriodsDrill', props);
    assert.doesNotMatch(h.text(tree), /Target Margin Reserve|Allocation not configured|Apply Policy|History|Site supervision|70000|%/);
    eq(h.render('AllocationRollup', { summary }), null);
    eq(h.context._pcAllocationSummary(project, childMonths, props.payrollRaw, [], props.overheadRaw, props.allocationMap), null);
  }
}

function testAllocationPrint() {
  const h = dashboardHarness();
  let payload, printed = '';
  const summary = { directBudget:123, indirectBudget:456, targetMarginReserve:789, unallocatedIndirect:12, actualProfit:321, targetMarginVariance:-468, legacyCount:2, configuredCount:1, isForecast:false };
  h.context.window.dacsPrintProjectCostSummary = d => { payload = d; };
  const props = { project:{ name:'Job', revenue:1000, labor:100, material:200, overhead:300 }, projects:[], period:'All Time', allocationSummary:summary };
  const tree = h.render('PageHead', props);
  h.nodes(tree).find(n => n.type === 'button' && h.text(n).includes('Print Summary')).props.onClick();
  eq(payload.allocationSummary, summary, 'print must receive the same precomputed rollup');
  const ctx = vm.createContext({ window:{ currentUserRole:'owner', location:{ origin:'https://example.test' }, open:() => ({ document:{ write: html => { printed = html; }, close() {} } }) } });
  vm.runInContext(sourceSlice(read('js/print-utils.js'), 'window.dacsPrintProjectCostSummary =', '/**\n * ONE shared', 'cost print'), ctx);
  ctx.window.dacsPrintProjectCostSummary(payload);
  for (const value of ['Target Margin Reserve', '123.00', '456.00', '789.00', 'Unallocated Indirect Cost', '12.00', 'Actual Earned Profit', '321.00', '-468.00', 'Allocation not configured']) assert.ok(printed.includes(value), 'print missing ' + value);
  payload.allocationSummary = { ...summary, isForecast:true, targetMarginVariance:null };
  ctx.window.dacsPrintProjectCostSummary(payload);
  assert.match(printed, /Forecast Profit/);
  assert.doesNotMatch(printed, /Actual Earned Profit|Target Variance/);
  h.context.window.currentUserRole = 'client';
  h.nodes(h.render('PageHead', props)).find(n => n.type === 'button' && h.text(n).includes('Print Summary')).props.onClick();
  assert.ok(!payload.allocationSummary, 'non-owner print must omit stale allocation data');
  ctx.window.currentUserRole = 'client';
  ctx.window.dacsPrintProjectCostSummary({ ...payload, allocationSummary:summary });
  assert.doesNotMatch(printed, /Target Margin Reserve|Unallocated Indirect Cost/);
  h.context.window.currentUserRole = 'staff';
  payload = null;
  h.nodes(tree).find(n => n.type === 'button' && h.text(n).includes('Print Summary')).props.onClick();
  eq(payload, null, 'stale owner print handler must refuse a later staff session');
  ctx.window.currentUserRole = 'staff';
  printed = '';
  ctx.window.dacsPrintProjectCostSummary({ allocationSummary:summary });
  eq(printed, '', 'staff must never receive a monetary print document');
}

function testAllocationRootDateScope() {
  const h = dashboardHarness();
  const ctx = h.context;
  const rootSource = sourceSlice(portalSource, 'function PortalApp()', '(function() {\n  const mount', 'portal root');
  const stateNames = [...rootSource.matchAll(/const \[(\w+),\s*\w+\] = React\.useState\(/g)].map(match => match[1]);
  ctx.React.useMemo = fn => fn();
  ctx.window.useTweaks = () => [{}, () => {}];
  // Freeze the clock, not the production filter, so month-boundary behavior is exercised.
  ctx.Date = class extends Date { constructor(...args) { super(...(args.length ? args : ['2026-09-20T12:00:00'])); } };
  vm.runInContext(sourceSlice(portalSource, 'function mapExpenseDoc(', 'function _isOverheadPay', 'expense and period mappers')
    + sourceSlice(portalSource, 'function periodCutoff(', 'function BillingSummary(', 'date filter') + rootSource, ctx);
  const fixture = {
    period:'This Month', view:'periods', isOwner:true, authUid:'owner', ownerId:'owner', loading:false, projectId:'parent',
    foldersRaw:[{ id:'parent', name:'Main job', totalBudget:100000 }, { id:'child', parentFolderId:'parent', name:'Additional works', totalBudget:50000 }],
    monthsRaw:[{ id:'p', folderId:'parent', month:'September', year:2026, monthlyBudget:1000 },
      { id:'c', folderId:'child', month:'September', year:2026, monthlyBudget:1000 }],
    allocationMap:{ p:policy, c:policy }, payrollRaw:[], expensesRaw:[], overheadRaw:[]
  };
  for (const [projectId, folderId, scale] of [['p', 'parent', 1], ['c', 'child', 2]]) {
    for (const [date, multiplier] of [['2026-09-01', 1], ['2026-08-31', 10]]) {
      fixture.payrollRaw.push({ projectId, paymentDate:date, laborType:'direct', totalSalary:100 * scale * multiplier },
        { projectId, paymentDate:date, laborType:'liability', liabilityFor:'indirect', totalSalary:20 * scale * multiplier });
      fixture.expensesRaw.push({ projectId, dateTime:date + 'T08:00:00', amount:50 * scale * multiplier });
      fixture.overheadRaw.push({ folderId, billingPeriodId:projectId, date, amount:30 * scale * multiplier },
        { folderId, billingPeriodId:null, date, amount:5 * scale * multiplier });
    }
  }
  const useState = ctx.React.useState;
  function root(projectId, period) {
    let index = 0;
    const state = { ...fixture, projectId, period };
    ctx.React.useState = initial => {
      const key = stateNames[index++];
      return [Object.prototype.hasOwnProperty.call(state, key) ? state[key] : typeof initial === 'function' ? initial() : initial, () => {}];
    };
    try { return ctx.PortalApp(); } finally { ctx.React.useState = useState; }
  }
  for (const [period, multiplier] of [['This Month', 1], ['All Time', 11]]) {
    for (const [folderId, ownScale, rollupScale] of [['parent', 1, 3], ['child', 2, 2]]) {
      const tree = root(folderId, period);
      const head = h.nodes(tree).find(n => n.type === ctx.PageHead).props;
      const drill = h.nodes(tree).find(n => n.type === ctx.BillingPeriodsDrill).props;
      eq(head.allocationSummary.directActual, 150 * rollupScale * multiplier, 'rollup retains child periods and date scope');
      eq(head.allocationSummary.indirectActual, 50 * rollupScale * multiplier);
      eq(head.allocationSummary.unallocatedIndirect, 5 * rollupScale * multiplier);
      eq(head.project.spent, 205 * rollupScale * multiplier, 'allocation scope agrees with project costs');
      const cardTree = h.render('BillingPeriodsDrill', drill);
      const cards = h.nodes(cardTree).filter(n => n.props.className === 'pc-period-card');
      eq(cards.length, 1, 'parent drill must not acquire child period cards');
      const actual = ctx._pcActualsForPeriod(drill.childMonths[0], drill.payrollRaw, drill.expensesRaw, drill.overheadRaw);
      eq(actual.directActual, 150 * ownScale * multiplier, `${folderId} card direct actual must use ${period}`);
      eq(actual.indirectActual, 50 * ownScale * multiplier, `${folderId} card indirect actual must use ${period}`);
      const cardText = h.text(cards[0]);
      for (const value of [150 * ownScale * multiplier, 50 * ownScale * multiplier,
        700 - 150 * ownScale * multiplier, 200 - 50 * ownScale * multiplier]) {
        assert.ok(cardText.includes(value.toFixed(2)), `${folderId} ${period} card missing actual/remaining ${value}`);
      }
      if (period === 'This Month') assert.doesNotMatch(cardText, /Over budget|Reserve at Risk/);
      else assert.match(cardText, /Over budget/);
    }
  }
}

// Removing an output's shared model, role gate, attribution check or escaping must
// fail here. The DOM/download/window doubles only capture real renderer output.
function expenseReportHarness() {
  const elements = {};
  const charts = {};
  const el = id => elements[id] || (elements[id] = { innerHTML:'', textContent:'', value:'', style:{},
    classList:{ add(){}, remove(){}, toggle(){} }, setAttribute(){}, getContext(){ return this; },
    querySelector(){ return null; }, querySelectorAll(){ return []; }, closest(){ return null; }, dataset:{} });
  let printed = '', csv = '';
  const context = vm.createContext({ console:{ log(){}, error:console.error }, ...A,
    window:{ currentUserRole:'owner', location:{ href:'https://example.test/admin.html', origin:'https://example.test' },
      open:() => ({ document:{ write:html => { printed = html; }, close(){} }, focus(){}, print(){}, addEventListener(){} }) },
    document:{ getElementById:el, querySelector:() => null, querySelectorAll:() => [], addEventListener(){},
      createElement:() => ({ click(){}, style:{} }), body:{ style:{}, appendChild(){}, removeChild(){} } },
    Chart:class { constructor(canvas, config) { this.config = config; charts[Object.keys(elements).find(id => elements[id] === canvas)] = config; } destroy(){ this.config.destroyed = true; } }, setTimeout(){}, clearTimeout(){},
    Blob:class { constructor(parts){ csv = parts.join(''); } }, URL:{ createObjectURL:() => 'blob:test', revokeObjectURL(){} } });
  vm.runInContext(expensesSource, context);
  const printSource = fs.readFileSync(path.join(__dirname, '../js/print-utils.js'), 'utf8');
  vm.runInContext(printSource.slice(printSource.indexOf('window.dacsPrintHeader ='), printSource.indexOf('\n/**', printSource.indexOf('window.dacsPrintHeader ='))), context);
  vm.runInContext(`
    expFolders = [{id:'f',name:'=Job <script>alert(1)</script>',totalBudget:5000},
      {id:'child',parentFolderId:'f',name:'Extra',totalBudget:1000}, {id:'other',name:'Other'}];
    expProjects = [
      {id:'p',folderId:'f',month:'September',year:2026,monthlyBudget:1000},
      {id:'legacy',folderId:'f',month:'September',year:2026,monthlyBudget:200},
      {id:'cover',folderId:'f',month:'September',year:2026,monthlyBudget:999,fundingType:'president'},
      {id:'child-p',folderId:'child',month:'September',year:2026,monthlyBudget:500},
      {id:'old',folderId:'f',month:'September',year:2025,monthlyBudget:100},
      {id:'foreign',folderId:'other',month:'September',year:2026,monthlyBudget:9000}];
    _pcAllocationMap = {p:{directPct:70,indirectPct:20,targetMarginPct:10},
      cover:{directPct:70,indirectPct:20,targetMarginPct:10},
      'child-p':{directPct:70,indirectPct:20,targetMarginPct:10}};
    expExpenses = _ovAllExpenses = [
      {id:'e1',projectId:'p',amount:100,expenseName:'=1+1',dateTime:'2026-09-01T12:00:00',coverExpense:true},
      {id:'e2',projectId:'legacy',amount:20,dateTime:'2026-09-01T12:00:00'},
      {id:'e3',projectId:'cover',amount:30,dateTime:'2026-09-01T12:00:00'},
      {id:'e4',projectId:'child-p',amount:40,dateTime:'2026-09-01T12:00:00'},
      {id:'e5',projectId:'old',amount:10,dateTime:'2025-09-01T12:00:00'}];
    expPayroll = _ovAllPayroll = [
      {id:'d',projectId:'p',totalSalary:50,laborType:'direct',paymentDate:'2026-09-02'},
      {id:'ds',projectId:'p',totalSalary:5,laborType:'liability',liabilityFor:'direct',paymentDate:'2026-09-02'},
      {id:'i',projectId:'p',totalSalary:20,laborType:'indirect',paymentDate:'2026-09-02'},
      {id:'is',projectId:'p',totalSalary:2,laborType:'liability',liabilityFor:'indirect',paymentDate:'2026-09-02'}];
    _rptOvhdRows = [
      {id:'h1',folderId:'f',billingPeriodId:'p',amount:8,date:'2026-09-03'},
      {id:'h2',folderId:'f',billingPeriodId:null,amount:9,date:'2026-09-03'},
      {id:'h3',folderId:'f',billingPeriodId:'foreign',amount:3,date:'2026-09-03'},
      {id:'h4',folderId:'f',billingPeriodId:'p',scope:'company',amount:777,date:'2026-09-03'},
      {id:'h5',folderId:'f',billingPeriodId:'p',amount:888,deletedAt:'deleted',date:'2026-09-03'},
      {id:'h6',folderId:'child',billingPeriodId:'child-p',amount:4,date:'2026-09-03'},
      {id:'h7',folderId:'f',billingPeriodId:null,amount:6,date:'2025-09-03'}];
    _rptState = {folderId:'f',period:'monthly',year:2026,projects:expProjects,
      allExpenses:expExpenses,allPayroll:expPayroll};
    showExpNotif = () => {};
  `, context);
  return { context, el, output:() => ({ printed,csv }), elements, charts };
}

function testExpenseReportModel() {
  const h = expenseReportHarness(), c = h.context;
  assert.equal(typeof c._pcReportModel, 'function', 'missing shared report integration');
  const model = c._pcReportModel('f');
  eq(model.rows.length, 5, 'parent includes child periods, excludes foreign folder');
  const p = model.rows.find(r => r.id === 'p');
  eq(p.mats, 100); eq(p.labor, 55); eq(p.overhead, 30); eq(p.totalSpent, 185);
  eq(p.allocation.directActual, 155); eq(p.allocation.indirectActual, 30);
  eq(p.allocation.directBudget, 700); eq(p.allocation.targetMarginReserve, 100);
  eq(model.rows.find(r => r.id === 'cover').allocation, null);
  eq(model.rows.find(r => r.id === 'legacy').allocation, null);
  eq(model.totals.budget, 1800); eq(model.totals.totalSpent, 307);
  eq(model.totals.remaining, 1493); eq(model.totals.unallocatedIndirect, 18);
  eq(model.allocation.targetMarginReserve, 150);
  const report = c._pcDashboardReport();
  eq(report.model.totals.totalSpent, 291, 'selected year excludes 2025 expense and overhead');
  eq(report.model.totals.budget, 1700);
  eq(report.model.totals.unallocatedIndirect, 12);
  eq(report.groups.reduce((s,g) => s + g.totalSpent, 0), 291);
  eq(report.groups.find(g => g.months.includes('September')).totalSpent, 291);
  eq(model.totals.cover, 130, 'cover costs remain a subset of Spent');
  eq(c._pcReportModel('child').totals.totalSpent, 44, 'child drill excludes parent overhead');
  for (const mode of ['weekly','quarterly','semi','annual']) {
    vm.runInContext('_rptState.period = ' + JSON.stringify(mode), c);
    const scoped = c._pcDashboardReport();
    close(scoped.groups.reduce((s,g) => s + g.totalSpent, 0), mode === 'annual' ? 307 : 291);
    close(scoped.groups.reduce((s,g) => s + g.budget, 0), mode === 'annual' ? 1800 : 1700);
  }
  vm.runInContext('_pcAllocationMap.p = {directPct:50,indirectPct:30,targetMarginPct:20};', c);
  eq(c._pcReportModel('f').totals.totalSpent, 307, 'planning changes cannot change Spent');
  eq(c._pcReportModel('f').totals.remaining, 1493, 'reserve cannot be subtracted from Remaining');
}

function testExpenseReportOutputs() {
  const h = expenseReportHarness(), c = h.context;
  c.printFullBillingSummary();
  eq(h.output().printed, '', 'no selected folder must not print company-wide data');
  c.mvpRenderOvBillingPeriods('f');
  assert.match(h.el('mvpOvPeriodGrid').innerHTML, /Target Margin Reserve/);
  assert.match(h.el('mvpOvPeriodGrid').innerHTML, /Allocation not configured/);
  c.mvpOvOpenPeriodDetail('f', 'p');
  assert.match(h.el('pdAllocation').innerHTML, /155\.00/);
  assert.match(h.el('pdAllocation').innerHTML, /Target Margin Reserve/);
  c.renderReportsDashboard();
  assert.match(h.el('rptAllocationReport').innerHTML, /Target Margin Reserve/);
  assert.match(h.el('rptAllocationReport').innerHTML, /Unallocated Indirect/);
  assert.match(h.el('rptSummaryTbody').innerHTML, /291\.00/);
  eq(h.charts.rptTrendChart.data.datasets.filter(d => d.stack === 'spend')
    .reduce((sum, d) => sum + d.data.reduce((s, n) => s + n, 0), 0), 291,
    'spending chart must include overhead, matching the report table');
  c.mvpRenderOverviewFolderGrid();
  assert.match(h.el('mvpOverviewFolderGrid').innerHTML, /307\.00/, 'overview folder cost must include unallocated overhead');
  c.exportRptTable();
  assert.match(h.output().csv, /"Target Margin Reserve"/);
  assert.match(h.output().csv, /"'\=1\+1"/, 'expense names must be formula safe');
  assert.match(h.output().csv, /"291\.00"/);
  assert.match(h.output().csv, /"Allocation not configured"/);
  for (const [fn, id, spent] of [['printFullBillingSummary','f','307.00'],
    ['printBillingSummaryReceipt','p','185.00'], ['printReportsDashboard',null,'291.00']]) {
    c[fn](id);
    const out = h.output().printed;
    assert.match(out, /Target Margin Reserve/, fn);
    assert.ok(out.includes(spent), fn + ' must print the same actual costs');
    assert.doesNotMatch(out, /<script>alert\(1\)<\/script>/, fn + ' must escape text');
  }
  c.window.currentUserRole = 'staff';
  c.mvpRenderOvBillingPeriods('f'); c.mvpOvOpenPeriodDetail('f','p'); c.renderReportsDashboard(); c.exportRptTable(); c.mvpRenderOverviewFolderGrid();
  for (const id of ['mvpOverviewFolderGrid','mvpOvPeriodGrid','pdAllocation','pdKpiRow','rptAllocationReport','rptSummaryTbody']) {
    assert.doesNotMatch(h.el(id).innerHTML, /Target Margin Reserve|700\.00|155\.00|291\.00|₱|&#8369;/, id + ' leaks staff money');
  }
  assert.doesNotMatch(h.output().csv, /Target Margin Reserve|700\.00|155\.00|291\.00|100\.00|%/);
  for (const [fn,id] of [['printFullBillingSummary','f'],['printBillingSummaryReceipt','p'],['printReportsDashboard',null]]) {
    c[fn](id);
    assert.doesNotMatch(h.output().printed, /Target Margin Reserve|700\.00|155\.00|291\.00|₱|&#8369;/, fn + ' leaks staff money');
  }
  c.mvpRenderOvFolderDetail('f');
  assert.doesNotMatch(h.el('mvpOvKpiContractDelta1').textContent, /₱|[0-9]/, 'staff folder delta leaks money');
}

async function testExpenseReportLoading() {
  const h = expenseReportHarness(), c = h.context;
  c.currentUser = { uid:'owner' };
  c.loadRptData();
  eq(c._pcDashboardReport().model.totals.totalSpent, 291, 'loaded parent report must include child expenses');
  c.mvpOvOpenPeriodDetail('f', 'p');
  h.el('expReportsView').style.display = '';
  h.el('mvpOvDetailState').style.display = '';
  vm.runInContext(`
    _mvpOvCurrentFolderId = 'f';
    _pcAllocationMap.p = {directPct:50,indirectPct:30,targetMarginPct:20};
    renderProjectPanel = updateDashboardBudget = mvpRenderFolderGrid = mvpRenderAllProjectsTable = mvpPayRenderFolderGrid = () => {};
  `, c);
  c._renderAllPanels();
  assert.match(h.el('pdAllocation').innerHTML, /500\.00/, 'open period must refresh after allocation snapshot');
  assert.match(h.el('rptAllocationReport').innerHTML, /500\.00/, 'open report must refresh after allocation snapshot');

  let deliver;
  c.db = { collection(name) {
    eq(name, 'overheadExpenses');
    return { where(field, op, uid) {
      eq([field,op,uid], ['userId','==','owner']);
      return { get:async () => ({docs:[]}), onSnapshot(next) { deliver = next; return () => {}; } };
    } };
  } };
  vm.runInContext('_rptOvhdRows = null;', c);
  c.renderReportsDashboard();
  assert.equal(typeof deliver, 'function', 'report overhead must subscribe for subsequent changes');
  deliver({docs:[{id:'new',data:() => ({folderId:'f',amount:100,date:'2026-09-01'})}]});
  await new Promise(resolve => setImmediate(resolve));
  assert.match(h.el('rptSummaryTbody').innerHTML, /367\.00/, 'first overhead snapshot must render');
  deliver({docs:[{id:'new',data:() => ({folderId:'f',amount:200,date:'2026-09-01'})}]});
  assert.match(h.el('rptSummaryTbody').innerHTML, /467\.00/, 'overhead changes must refresh active report');
  vm.runInContext('expProjects = [];', c);
  c.loadRptData();
  await new Promise(resolve => setImmediate(resolve));
  assert.match(h.el('rptSummaryTbody').innerHTML, /200\.00/, 'job overhead still counts without any billing periods');
  assert.doesNotMatch(h.el('rptAllocationReport').innerHTML, /500\.00/, 'empty period scope must clear previous allocation rows');
}

function testReportChartCategoryCollisions() {
  const h = expenseReportHarness(), c = h.context;
  vm.runInContext(`
    _ovAllExpenses.push({projectId:'p',category:'Labor',amount:100},
      {projectId:'p',category:'Overhead',amount:200}, {projectId:'p',category:'__proto__',amount:'10'});
  `, c);
  c.renderReportsDashboard();
  c.mvpOvOpenPeriodDetail('f','p');
  for (const [id, expected] of [['rptCompositionChart',601], ['expCategoryChart',601], ['pdDonutChart',495]]) {
    eq(h.charts[id].data.datasets[0].data.reduce((sum, n) => sum + n, 0), expected,
      id + ' must retain expense categories that collide with synthetic buckets');
    const data = h.charts[id].data;
    const amounts = label => Array.from(data.labels, (name,i) => name === label ? data.datasets[0].data[i] : null)
      .filter(amount => amount !== null).sort((a,b) => a - b);
    eq(amounts('Labor'), [55,100]);
    eq(amounts('Overhead'), [id === 'pdDonutChart' ? 30 : 46,200]);
    eq(amounts('__proto__'), [10]);
  }
  vm.runInContext('_ovAllExpenses.length = 0; _ovAllPayroll.length = 0; _rptOvhdRows = [];', c);
  c.renderReportsDashboard(); c.mvpOvOpenPeriodDetail('f','p');
  for (const id of ['rptCompositionChart','expCategoryChart','pdDonutChart']) {
    eq(h.charts[id].data.datasets[0].data.reduce((sum,n) => sum + n, 0), 0,
      id + ' must not invent spending in an empty period');
  }
}

function testStaffReportDateScope() {
  const h = expenseReportHarness(), c = h.context;
  vm.runInContext(`expProjects.find(p => p.id === 'old').name = 'Prior Year Only';
    expProjects.find(p => p.id === 'p').name = 'Current Year Only';`, c);
  c.window.currentUserRole = 'staff';
  for (const mode of ['weekly','monthly','quarterly','semi']) {
    vm.runInContext('_rptState.period = ' + JSON.stringify(mode), c);
    c.exportRptTable(); c.printReportsDashboard();
    for (const output of [h.output().csv, h.output().printed.replace(/<style>[\s\S]*?<\/style>/g, '').replace(/<[^>]*>/g, '')]) {
      assert.match(output, /Current Year Only/);
      assert.doesNotMatch(output, /Prior Year Only|Target Margin Reserve|₱|\d+\.\d{2}|\d+(?:\.\d+)?%/);
    }
  }
  const january = c._pcReportModel('f', {start:new Date(2026,0,1),end:new Date(2026,1,1)});
  eq(january.rows.length, 0, 'staff applies a narrower date window before redaction');
  vm.runInContext("_rptState.period = 'annual';", c);
  c.exportRptTable(); c.printReportsDashboard();
  for (const output of [h.output().csv,h.output().printed]) assert.match(output, /Prior Year Only/);
}

function testFolderlessPeriodPrintScope() {
  const h = expenseReportHarness(), c = h.context;
  vm.runInContext(`expProjects.push({id:'loose',name:'Legacy Folderless',month:'August',year:2026,monthlyBudget:100});
    _ovAllExpenses.push({projectId:'loose',expenseName:'Folderless Cost',amount:12});
    expCurrentProject = expProjects.find(p => p.id === 'loose');`, c);
  for (const [fn,arg] of [['printFullBillingSummary',undefined],['printBillingSummaryReceipt','loose']]) {
    c[fn](arg);
    assert.match(h.output().printed, /Folderless Cost/, fn + ' must include explicitly selected folderless period');
    assert.match(h.output().printed, /88\.00/);
    assert.doesNotMatch(h.output().printed, /September 2026|=1\+1/);
  }
}

function testDeletedPeriodDetailTeardown() {
  for (const role of ['owner','staff']) {
    const h = expenseReportHarness(), c = h.context;
    c.mvpOvOpenPeriodDetail('f','p');
    const donut = h.charts.pdDonutChart, bar = h.charts.pdBarChart;
    vm.runInContext("expProjects = expProjects.filter(p => p.id !== 'p');", c);
    c.window.currentUserRole = role;
    c.currentUser = {uid:'owner'};
    h.el('expReportsView').style.display = 'none';
    h.el('mvpOvDetailState').style.display = 'none';
    c._pcRefreshReportViews();
    eq(h.el('mvpPeriodDetailModal').style.display, 'none', role + ' must close deleted period');
    eq(h.el('mvpPeriodDetailModal').dataset.projectId, undefined);
    eq(donut.destroyed, true); eq(bar.destroyed, true);
    eq(c.document.body.style.overflow, '');
    for (const id of ['pdAllocation','pdKpiRow','pdExpensesSection','pdPayrollSection','pdDonutLegend']) eq(h.el(id).innerHTML, '');
    for (const id of ['pdTitle','pdBudgetAmt','pdUtilPct']) eq(h.el(id).textContent, '');
  }
}

function testPublicPrintContracts() {
  const h = expenseReportHarness(), c = h.context;
  vm.runInContext(`expFolders[0].description = 'Renovation <unsafe>';
    expProjects[0].fundingType = 'progress'; expProjects[0].billingNumber = 7;
    _ovAllPayroll[0].workerName = 'Lump Worker'; _ovAllPayroll[0].dailyRate = 0;
    _ovAllPayroll[0].daysWorked = 3;
    _ovAllExpenses[0].category = 'Concrete';`, c);
  const missing = [];
  for (const [fn,arg,contracts] of [
    ['printFullBillingSummary','f',[/DACS-TRANSPARENT\.png/,/Professional Building Design/,/Renovation &lt;unsafe&gt;/,/Progress Billing #7/,/Subtotal.*Progress Billing/i,/Grand Total Balance/,/Total Contract/]],
    ['printBillingSummaryReceipt','p',[/DACS-TRANSPARENT\.png/,/Billing Period Summary/,/SUMMARY NO\./,/SUM-[A-Z0-9]+/,/Progress Billing #7/,/Renovation &lt;unsafe&gt;/,/Lump Sum/,/Expenses Subtotal/,/Payroll Subtotal/]],
    ['printReportsDashboard',null, [/DACS-TRANSPARENT\.png/,/Monthly Report/,/Category Breakdown/,/Concrete/,/Lump Sum/,/Expenses Subtotal/,/Payroll Subtotal/,/Receivable Balance/,/Funds Available/]]
  ]) {
    c[fn](arg);
    const out = h.output().printed;
    contracts.forEach(pattern => { if (!pattern.test(out)) missing.push(fn + ': ' + pattern); });
    assert.doesNotMatch(out, /Renovation <unsafe>/);
  }
  assert.deepStrictEqual(missing, [], 'public print contracts missing');
}

function reportTableRows(html, caption) {
  const table = html.match(new RegExp('<caption>' + caption + '</caption>[\\s\\S]*?<tbody>([\\s\\S]*?)</tbody>'));
  assert.ok(table, 'missing printed table: ' + caption);
  return [...table[1].matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map(row =>
    [...row[1].matchAll(/<(?:th|td)\b[^>]*>([\s\S]*?)<\/(?:th|td)>/g)].map(cell => cell[1].replace(/<[^>]*>/g, '')));
}

// These contracts catch missing dates, receipt semantics, misaligned subtotals
// and operational counts after the three printers share their calculations.
function testPrintMetadataAndTotals() {
  const h = expenseReportHarness(), c = h.context;
  vm.runInContext(`
    expProjects[0].name = 'Foundation draw';
    expProjects[0].fundingType = 'progress'; expProjects[0].billingNumber = 7;
    _ovAllPayroll[0].workerName = 'Daily Worker';
    _ovAllPayroll[0].dailyRate = 25; _ovAllPayroll[0].daysWorked = 2;
  `, c);
  c.printFullBillingSummary('f');
  const full = h.output().printed;
  const progress = reportTableRows(full, 'Progress Billing');
  assert.ok(progress[0].some(cell => cell.includes('September 2026')), 'custom period name must retain its month/year');
  assert.match(progress[0].join(' '), /Foundation draw/);
  eq(progress.at(-1).slice(-6), ['₱1,000.00','₱100.00','₱55.00','₱30.00','₱185.00','₱815.00']);
  eq(reportTableRows(full, 'Grand Total Balance')[0], ['₱200.00','₱55.00','₱52.00','₱1,493.00']);
  assert.match(full, /Total Billed \(Received\)/); assert.match(full, /Net Balance/);

  c.printBillingSummaryReceipt('p');
  const receipt = h.output().printed;
  assert.match(receipt, /Foundation draw/); assert.match(receipt, /September 2026/);
  const receiptCosts = reportTableRows(receipt, 'Actual Costs')[0];
  eq(receiptCosts, ['₱1,000.00','₱100.00','₱55.00','₱30.00','₱185.00','₱815.00']);
  assert.match(receipt, /Received/); assert.match(receipt, /Net Balance/);
  const payroll = reportTableRows(receipt, 'Payroll Detail[^<]*');
  eq(payroll.find(row => row[2] === 'Daily Worker').slice(-3), ['2','₱25.00','₱50.00']);
  eq(payroll.at(-1).at(-1), '₱77.00', 'payroll detail subtotal must include all pay, with indirect still only in Overhead');
  c.printBillingSummaryReceipt('cover');
  const cover = h.output().printed;
  assert.match(cover, /Covered/); assert.match(cover, /Total Covered/);
  eq(reportTableRows(cover, 'Actual Costs')[0], ['₱30.00','₱30.00','₱0.00','₱0.00','₱30.00','₱30.00'],
    'Total Covered states the positive cost covered, not the remaining zero-budget balance');
  vm.runInContext('expProjects[0].monthlyBudget = 100;', c);
  c.printBillingSummaryReceipt('p');
  eq(reportTableRows(h.output().printed, 'Actual Costs')[0].at(-1), '₱-85.00',
    'a non-cover receipt must retain its negative remaining balance');
  vm.runInContext('expProjects[0].monthlyBudget = 1000;', c);

  c.printReportsDashboard();
  const dashboard = h.output().printed;
  const monthly = reportTableRows(dashboard, 'Monthly Period Breakdown');
  assert.match(dashboard, /Transactions/); assert.match(dashboard, /Workers/);
  eq(monthly[0].slice(-3), ['Healthy','4','4']);
  eq(monthly.at(-1).slice(-3), ['Healthy','4','4']);
  assert.match(dashboard, /11 periods with no activity/);
  const category = reportTableRows(dashboard, 'Category Breakdown');
  eq(category.at(-1).slice(0,3), ['TOTAL','₱291.00','100.0%']);
  assert.match(dashboard, /Expense Detail - 4 transactions/);
  assert.match(dashboard, /Payroll Detail - 4 entries/);
}

Promise.allSettled([testOverheadAttribution(), testOverheadUploadFreshness(), Promise.resolve().then(testOverheadCsvFormulas), Promise.resolve().then(testAllocationDashboard), Promise.resolve().then(testAllocationPrint), Promise.resolve().then(testAllocationRootDateScope), Promise.resolve().then(testExpenseReportModel), Promise.resolve().then(testExpenseReportOutputs), testExpenseReportLoading(), ...[testReportChartCategoryCollisions, testStaffReportDateScope, testFolderlessPeriodPrintScope, testDeletedPeriodDetailTeardown, testPublicPrintContracts, testPrintMetadataAndTotals].map(test => Promise.resolve().then(test))])
  .then(results => {
    const failures = results.filter(result => result.status === 'rejected');
    if (failures.length) { failures.forEach(result => console.error(result.reason)); process.exitCode = 1; }
    else console.log('billing allocation tests passed');
  });
