(function (root) {
  'use strict';

  const PC_ALLOCATION_DEFAULTS = Object.freeze({
    directPct: 70,
    indirectPct: 20,
    targetMarginPct: 10
  });
  const num = value => Number(value) || 0;

  function pcValidateAllocationPolicy(policy) {
    if (!policy) return { valid: false, total: 0, message: 'Allocation not configured' };
    const values = [Number(policy.directPct), Number(policy.indirectPct), Number(policy.targetMarginPct)];
    const total = values.reduce((sum, value) => sum + value, 0);
    const valid = values.every(value => Number.isFinite(value) && value >= 0) && Math.abs(total - 100) < 0.005;
    return { valid, total, message: valid ? '' : 'Direct, Indirect and Target Margin must total 100%' };
  }

  function pcAllocationAmounts(base, policy) {
    if (!pcValidateAllocationPolicy(policy).valid) return null;
    const amount = Math.max(0, num(base));
    return {
      base: amount,
      directBudget: amount * Number(policy.directPct) / 100,
      indirectBudget: amount * Number(policy.indirectPct) / 100,
      targetMarginReserve: amount * Number(policy.targetMarginPct) / 100
    };
  }

  function pcAllocationStatus(actual, budget) {
    const spent = Math.max(0, num(actual));
    const allowed = Math.max(0, num(budget));
    if (!(allowed > 0)) return { key: spent > 0 ? 'unbudgeted' : 'empty', pct: spent > 0 ? null : 0 };
    const pct = spent / allowed * 100;
    return { key: pct > 100 ? 'over' : pct >= 90 ? 'high' : pct >= 80 ? 'advisory' : 'healthy', pct };
  }

  function pcPeriodAllocationView(base, policy, directActual, indirectActual) {
    const amounts = pcAllocationAmounts(base, policy);
    if (!amounts) return null;
    const direct = Math.max(0, num(directActual));
    const indirect = Math.max(0, num(indirectActual));
    const spendableBudget = amounts.directBudget + amounts.indirectBudget;
    const totalActual = direct + indirect;
    return Object.assign({}, amounts, {
      directActual: direct,
      indirectActual: indirect,
      directRemaining: amounts.directBudget - direct,
      indirectRemaining: amounts.indirectBudget - indirect,
      directStatus: pcAllocationStatus(direct, amounts.directBudget),
      indirectStatus: pcAllocationStatus(indirect, amounts.indirectBudget),
      spendableBudget,
      totalActual,
      reserveAtRisk: Math.max(0, totalActual - spendableBudget)
    });
  }

  function pcActualsForPeriod(periodId, payroll, expenses, overhead, isIndirectPayroll) {
    let directActual = (expenses || []).filter(row => row.projectId === periodId)
      .reduce((sum, row) => sum + num(row.amount), 0);
    let indirectActual = 0;
    (payroll || []).filter(row => row.projectId === periodId).forEach(row => {
      const amount = num(row.amount != null ? row.amount : row.totalSalary);
      if (isIndirectPayroll(row)) indirectActual += amount;
      else directActual += amount;
    });
    indirectActual += (overhead || []).filter(row => !row.deletedAt && row.billingPeriodId === periodId)
      .reduce((sum, row) => sum + num(row.amount), 0);
    return { directActual, indirectActual };
  }

  function pcProjectAllocationRollup(periodViews, unallocatedIndirect, actualProfit, isForecast) {
    const totals = (periodViews || []).filter(Boolean).reduce((sum, row) => ({
      directBudget: sum.directBudget + row.directBudget,
      indirectBudget: sum.indirectBudget + row.indirectBudget,
      targetMarginReserve: sum.targetMarginReserve + row.targetMarginReserve,
      directActual: sum.directActual + row.directActual,
      indirectActual: sum.indirectActual + row.indirectActual
    }), { directBudget: 0, indirectBudget: 0, targetMarginReserve: 0, directActual: 0, indirectActual: 0 });
    totals.unallocatedIndirect = Math.max(0, num(unallocatedIndirect));
    totals.actualProfit = num(actualProfit);
    totals.isForecast = !!isForecast;
    totals.targetMarginVariance = isForecast ? null : totals.actualProfit - totals.targetMarginReserve;
    return totals;
  }

  const api = {
    PC_ALLOCATION_DEFAULTS,
    pcValidateAllocationPolicy,
    pcAllocationAmounts,
    pcAllocationStatus,
    pcPeriodAllocationView,
    pcActualsForPeriod,
    pcProjectAllocationRollup
  };
  Object.keys(api).forEach(key => { root[key] = api[key]; });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
