'use strict';

const assert = require('assert');
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

console.log('billing allocation tests passed');
