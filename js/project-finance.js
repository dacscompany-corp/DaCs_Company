// ════════════════════════════════════════════════════════════════════
// PROJECT FINANCE — the shared labelling layer for profit and allocation
// figures (Financial MVP Phase 1, spec docs/superpowers/specs/
// 2026-11-14-financial-management-mvp-design.md).
//
// Pure functions: no database, no roles, no DOM. Every screen, print and AI
// payload reads its figures from here so they cannot drift apart. Money is
// handled in integer centavos (half away from zero); dates are Asia/Manila
// calendar days built from parts.
//
// The ARITHMETIC of Spent / Earned / Profit stays where it always was
// (_projSpent / _projMargin in portal-app.compiled.js). This module only
// takes those totals and says what they are: a BOQ-based profit estimate,
// never "earned" or "recognized" profit. Loaded by admin.html right after
// billing-allocation.js; require()d directly by the tests.
// ════════════════════════════════════════════════════════════════════
(function (root) {
  'use strict';

  // The allocation policy validator lives in billing-allocation.js: a global in
  // the browser (loaded first), a module under Node.
  const A = (typeof module !== 'undefined' && module.exports && typeof require === 'function')
    ? require('./billing-allocation.js') : root;

  // Initial warning threshold (owner decision, 14 Nov 2026). One constant.
  const PF_BOQ_STALE_DAYS = 30;

  const PF_LABELS = Object.freeze({
    boqEstimate: 'BOQ-based profit estimate',
    projected: 'Projected final profit',
    recognized: 'Recognized Project Profit',
    unavailable: 'Unavailable',
    notConfirmed: 'Profit not confirmed',
    contractLessCost: 'Contract value minus costs',
    contractLessAllocated: 'Contract less allocated funds',
    operatingRemaining: 'Operating allocation remaining',
    totalRemaining: 'Total Allocation Remaining',
    fundBalance: 'Fund balance',
    companyFronted: 'Company-fronted cost',
    notCharged: 'Not charged to a billing period',
    boqSaved: 'BOQ last saved',
    boqDateUnavailable: 'BOQ date unavailable',
    boqSaveNote: "Saving a BOQ refreshes this date even when progress hasn't changed.",
    allTimeOnly: 'All Time only',
    noBoqProgress: 'No BOQ progress recorded',
    byDateRemaining: 'Allocated less cost (by date)',
    byDateCaption: 'Costs by date',
    incomplete: 'Incomplete'
  });

  const MON3 = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
    'September', 'October', 'November', 'December'];
  const MANILA_OFFSET_MS = 8 * 60 * 60 * 1000;   // UTC+8, no daylight saving
  const DAY_MS = 24 * 60 * 60 * 1000;
  const pad2 = n => (n < 10 ? '0' : '') + n;

  // Half away from zero, safe against binary float noise (2.675 × 100 is
  // 267.49999…; toPrecision(15) restores the decimal the user typed).
  function roundHalfAway(x) {
    const r = Math.round(Number(Math.abs(x).toPrecision(15)));
    return r === 0 ? 0 : (x < 0 ? -r : r);
  }

  function pfCents(value) {
    const n = Number(value);
    if (value === null || value === '' || !Number.isFinite(n)) return 0;
    return roundHalfAway(n * 100);
  }

  function pfPeso(cents) {
    const c = Math.trunc(Number(cents) || 0);
    const abs = Math.abs(c);
    const pesos = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return (c < 0 ? '−' : '') + '₱ ' + pesos + '.' + pad2(abs % 100);
  }

  function pfPct(percent) {
    if (percent === null || percent === undefined || !Number.isFinite(Number(percent))) return '—';
    return (roundHalfAway(Number(percent) * 100) / 100).toFixed(2) + '%';
  }

  // Accepts a Date, an ISO string, or a shim Timestamp ({ toDate() }).
  function toDateOrNull(value) {
    if (!value) return null;
    let d = null;
    if (typeof value.toDate === 'function') d = value.toDate();
    else if (typeof value.getTime === 'function') d = value;
    else if (typeof value === 'string') d = new Date(value);
    return d && typeof d.getTime === 'function' && !isNaN(d.getTime()) ? d : null;
  }

  function pfManilaDayKey(value) {
    const d = toDateOrNull(value);
    if (!d) return null;
    const m = new Date(d.getTime() + MANILA_OFFSET_MS);
    return m.getUTCFullYear() + '-' + pad2(m.getUTCMonth() + 1) + '-' + pad2(m.getUTCDate());
  }

  const dayNumber = key => {
    const [y, m, d] = key.split('-').map(Number);
    return Date.UTC(y, m - 1, d) / DAY_MS;
  };

  // What the BOQ-based estimate rests on: % complete, when the BOQ was last
  // saved, and whether it is Draft / For review / Stale / undated. `completion`
  // is _folderCompletion's result ({ hasData, pct, status?, savedAt? }).
  function pfBoqBasis(completion, today) {
    const c = completion || {};
    const hasProgress = !!c.hasData;
    const status = c.status === 'submitted' || c.status === 'approved' ? c.status : 'draft';
    const saved = toDateOrNull(c.savedAt);
    const savedDayKey = pfManilaDayKey(saved);
    const todayKey = pfManilaDayKey(today || new Date());
    const ageDays = savedDayKey && todayKey ? dayNumber(todayKey) - dayNumber(savedDayKey) : null;
    const isDraft = status === 'draft';
    const isForReview = status === 'submitted';
    const isUndated = !savedDayKey;
    const isStale = ageDays !== null && ageDays > PF_BOQ_STALE_DAYS;
    const badges = [];
    if (isDraft) badges.push('Draft');
    else if (isForReview) badges.push('For review');
    if (isStale) badges.push('Stale · ' + ageDays + ' days');
    if (isUndated) badges.push(PF_LABELS.boqDateUnavailable);
    let savedText = PF_LABELS.boqDateUnavailable;
    if (savedDayKey) {
      const [y, m, d] = savedDayKey.split('-').map(Number);
      savedText = PF_LABELS.boqSaved + ' ' + d + ' ' + MON3[m - 1] + ' ' + y;
    }
    const pct = Math.max(0, Math.min(1, Number(c.pct) || 0));
    return {
      hasProgress,
      completePct: hasProgress ? pct * 100 : null,
      status,
      savedAt: saved ? saved.toISOString() : null,
      savedDayKey,
      ageDays,
      isDraft,
      isForReview,
      isUndated,
      isStale,
      current: hasProgress && status === 'approved' && !isUndated && !isStale,
      savedText,
      badges
    };
  }

  // The profit figures DAC can show, labelled for what they are (spec §3.2).
  //   forecast: undefined → forecasting not enabled here (Phase 1): no line.
  //             null      → enabled, none approved: "Forecast pending".
  function pfProfitView({ contract, spent, completion, today, period, forecast } = {}) {
    const allTime = period === undefined || period === null || period === 'All Time';
    const basis = pfBoqBasis(completion, today);
    const pct = Math.max(0, Math.min(1, Number((completion || {}).pct) || 0));
    let earnedCents = null, profitCents = null, marginPct = null;
    if (basis.hasProgress && allTime) {
      earnedCents = pfCents((Number(contract) || 0) * pct);
      profitCents = earnedCents - pfCents(spent);
      marginPct = earnedCents > 0 ? profitCents / earnedCents * 100 : null;
    }
    const projected = forecast === null ? { label: PF_LABELS.projected, text: 'Forecast pending' } : null;
    let headline;
    if (!allTime) {
      headline = { kind: 'allTimeOnly', label: PF_LABELS.allTimeOnly, cents: null,
        reasons: ['Profit figures are cumulative — choose All Time to see them'] };
    } else if (basis.hasProgress && basis.current) {
      headline = { kind: 'boq', label: PF_LABELS.boqEstimate, cents: profitCents, reasons: [] };
    } else {
      const reasons = [];
      if (!basis.hasProgress) reasons.push(PF_LABELS.noBoqProgress);
      else {
        if (basis.isDraft) reasons.push('BOQ is Draft');
        if (basis.isForReview) reasons.push('BOQ is For review');
        if (basis.isStale) reasons.push('BOQ last saved ' + basis.ageDays + ' days ago');
        if (basis.isUndated) reasons.push(PF_LABELS.boqDateUnavailable);
      }
      if (forecast === null) reasons.push('No approved forecast');
      headline = { kind: 'notConfirmed', label: PF_LABELS.notConfirmed, cents: null, reasons };
    }
    return {
      allTime,
      headline,
      boq: { available: basis.hasProgress, label: PF_LABELS.boqEstimate, earnedCents, profitCents, marginPct, basis },
      projected,
      recognized: { label: PF_LABELS.recognized, text: PF_LABELS.unavailable, note: 'No verified accounting source' },
      contractLessCost: { label: PF_LABELS.contractLessCost,
        cents: allTime ? pfCents(contract) - pfCents(spent) : null }
    };
  }

  // ── Allocation (0073) in centavos — planning, never profit ─────────
  // direct and indirect round half away from zero; the reserve takes the
  // residual, so the three always add back to the base. A negative base (an
  // exact reversal) negates every bucket.
  function pfPeriodBuckets(baseCents, policy) {
    if (!policy || !A.pcValidateAllocationPolicy(policy).valid) return null;
    const base = Math.trunc(Number(baseCents) || 0);
    const directCents = roundHalfAway(base * Number(policy.directPct) / 100);
    const indirectCents = roundHalfAway(base * Number(policy.indirectPct) / 100);
    return { directCents, indirectCents, reserveCents: base - directCents - indirectCents };
  }

  const isCover = p => p && p.fundingType === 'president';

  // Total Allocation Remaining = client Fund Allocated − Spent.
  // Operating allocation remaining = direct + indirect − Spent, and Incomplete
  // (null) while a FUNDED client period has no snapshot. Both are cumulative
  // balances: null unless the view is All Time.
  function pfAllocationRemaining({ periods, allocationMap, spentCents, allTime } = {}) {
    let clientBaseCents = 0, directCents = 0, indirectCents = 0, reserveCents = 0, missing = 0;
    (periods || []).forEach(p => {
      if (isCover(p)) return;
      const base = pfCents(p.monthlyBudget);
      clientBaseCents += base;
      const buckets = pfPeriodBuckets(base, (allocationMap || {})[p.id]);
      if (buckets) {
        directCents += buckets.directCents;
        indirectCents += buckets.indirectCents;
        reserveCents += buckets.reserveCents;
      } else if (base > 0) missing++;
    });
    const whole = allTime !== false;
    const spent = Math.trunc(Number(spentCents) || 0);
    return {
      totalCents: whole ? clientBaseCents - spent : null,
      operatingCents: whole && missing === 0 ? directCents + indirectCents - spent : null,
      directCents, indirectCents, reserveCents, clientBaseCents,
      missing,
      incomplete: missing > 0
    };
  }

  // Each billing period's fund balance from the cost CHARGED to it, matched by
  // period id (never by number or month: two periods can share a number). Cover
  // periods report company-fronted cost instead of a balance. Costs with no
  // billing period — expenses tied only to the project, and project overhead
  // attached to no period of these folders — are "not charged", and still Spent.
  // Every sum is signed: a credit or a reversed cost move reduces it.
  function pfFundBalances({ periods, payroll, expenses, overhead, folderIds } = {}) {
    const list = periods || [];
    // Duck-typed: a Set made in another realm (a test vm) fails instanceof.
    const folders = folderIds && typeof folderIds.has === 'function' ? folderIds : new Set(list.map(p => p.folderId));
    const byId = new Map(list.map(p => [p.id, p]));
    const charged = new Map(list.map(p => [p.id, 0]));
    const charge = (id, cents) => charged.set(id, charged.get(id) + cents);
    let notChargedCents = 0;
    const notChargedRows = { expenses: 0, overhead: 0 };
    (payroll || []).forEach(row => {
      if (byId.has(row.projectId)) charge(row.projectId, pfCents(row.amount !== undefined && row.amount !== null ? row.amount : row.totalSalary));
    });
    (expenses || []).forEach(row => {
      if (row.projectId) { if (byId.has(row.projectId)) charge(row.projectId, pfCents(row.amount)); }
      else if (folders.has(row.folderId)) { notChargedCents += pfCents(row.amount); notChargedRows.expenses++; }
    });
    (overhead || []).forEach(row => {
      if (row.deletedAt || row.scope === 'company' || !folders.has(row.folderId)) return;
      const p = byId.get(row.billingPeriodId);
      if (p && p.folderId === row.folderId) charge(p.id, pfCents(row.amount));
      else { notChargedCents += pfCents(row.amount); notChargedRows.overhead++; }
    });
    let clientBaseCents = 0, chargedTotal = 0;
    const rows = list.map(p => {
      const cover = isCover(p);
      const baseCents = cover ? 0 : pfCents(p.monthlyBudget);
      const chargedCents = charged.get(p.id);
      clientBaseCents += baseCents;
      chargedTotal += chargedCents;
      return { id: p.id, folderId: p.folderId, fundingType: p.fundingType || '', billingNumber: p.billingNumber,
        month: p.month || '', year: p.year || '', cover, baseCents, chargedCents,
        balanceCents: cover ? null : baseCents - chargedCents,
        companyFrontedCents: cover ? chargedCents : null };
    });
    const spentCents = chargedTotal + notChargedCents;
    return { rows, notChargedCents, notChargedRows, spentCents, clientBaseCents,
      totalRemainingCents: clientBaseCents - spentCents };
  }

  // Client billing periods of one project that share a billing number > 0.
  // Flagged for reconciliation only — nothing is ever renumbered.
  function pfDuplicateBillingNumbers(periods) {
    const groups = new Map();
    (periods || []).forEach(p => {
      const n = Number(p.billingNumber);
      if (isCover(p) || !(n > 0)) return;
      const key = (p.folderId || '') + '|' + n;
      if (!groups.has(key)) groups.set(key, { folderId: p.folderId, number: n, periods: [] });
      groups.get(key).periods.push({ id: p.id, month: p.month || '', year: p.year || '' });
    });
    const order = q => {
      const m = MONTHS.indexOf(q.month);
      return (Number(q.year) || 0) * 100 + (m < 0 ? 12 : m);
    };
    return [...groups.values()].filter(g => g.periods.length > 1)
      .map(g => ({ ...g, periods: g.periods.slice().sort((x, y) => order(x) - order(y) || String(x.id).localeCompare(String(y.id))) }))
      .sort((x, y) => String(x.folderId).localeCompare(String(y.folderId)) || x.number - y.number);
  }

  function pfDuplicateText(group) {
    const when = group.periods.map(p => [p.month, p.year].filter(Boolean).join(' ')).join(', ');
    return 'Billing #' + group.number + ' is used by ' + group.periods.length + ' periods (' + when + ') — check and renumber';
  }

  const api = {
    PF_LABELS,
    PF_BOQ_STALE_DAYS,
    pfCents,
    pfPeso,
    pfPct,
    pfManilaDayKey,
    pfBoqBasis,
    pfProfitView,
    pfPeriodBuckets,
    pfAllocationRemaining,
    pfFundBalances,
    pfDuplicateBillingNumbers,
    pfDuplicateText
  };
  Object.keys(api).forEach(key => { root[key] = api[key]; });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
