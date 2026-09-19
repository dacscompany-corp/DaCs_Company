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

console.log('billing allocation tests passed');
