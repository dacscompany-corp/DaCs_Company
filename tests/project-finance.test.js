// ════════════════════════════════════════════════════════════════════
// PROJECT FINANCE TESTS — node tests/project-finance.test.js
//
// The shared labelling layer (js/project-finance.js): centavos, Manila dates,
// the BOQ basis behind the "BOQ-based profit estimate", the profit view's
// headline rules, and the allocation / fund-balance reconciliation.
// Spec: docs/superpowers/specs/2026-11-14-financial-management-mvp-design.md
// ════════════════════════════════════════════════════════════════════
'use strict';
const assert = require('assert');
const PF = require('../js/project-finance.js');

let passed = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); passed++; };
const at = s => new Date(s);

// ── money ────────────────────────────────────────────────────────────
eq(PF.pfCents(4545733.23), 454573323);
eq(PF.pfCents(0.005), 1);
eq(PF.pfCents(-0.005), -1);
eq(PF.pfCents(2.675), 268, 'half away from zero survives binary float noise');
eq(PF.pfCents('x'), 0);
eq(PF.pfCents(null), 0);
eq(PF.pfPeso(454573323), '₱ 4,545,733.23');
eq(PF.pfPeso(-12627600), '−₱ 126,276.00');
eq(PF.pfPeso(0), '₱ 0.00');
eq(PF.pfPct(1.6075), '1.61%');
eq(PF.pfPct(null), '—');

// ── Manila dates: three input shapes and the day boundary ────────────
eq(PF.pfManilaDayKey('2026-09-07T06:14:46.774Z'), '2026-09-07');
eq(PF.pfManilaDayKey({ toDate: () => new Date('2026-09-07T06:14:46.774Z') }), '2026-09-07', 'shim Timestamp');
eq(PF.pfManilaDayKey('2026-10-14T16:30:00Z'), '2026-10-15', '00:30 Manila is the next calendar day');
eq(PF.pfManilaDayKey(null), null);
eq(PF.pfManilaDayKey('garbage'), null);

// ── BOQ basis ────────────────────────────────────────────────────────
const comp = o => ({ hasData: true, pct: 0.7, status: 'approved', savedAt: '2026-11-01T02:00:00Z', ...o });
let b = PF.pfBoqBasis(comp({}), at('2026-11-14T04:00:00Z'));
eq([b.current, b.ageDays, b.savedText, b.badges], [true, 13, 'BOQ last saved 1 Nov 2026', []]);
eq(PF.pfBoqBasis(comp({ status: 'draft' }), at('2026-11-14T04:00:00Z')).badges, ['Draft']);
eq(PF.pfBoqBasis(comp({ status: 'submitted' }), at('2026-11-14T04:00:00Z')).badges, ['For review']);
eq(PF.pfBoqBasis(comp({ status: undefined }), at('2026-11-14T04:00:00Z')).isDraft, true, 'a BOQ with no status is a draft');
b = PF.pfBoqBasis(comp({ savedAt: '2026-10-14T16:30:00Z' }), at('2026-11-14T15:59:00Z'));
eq([b.ageDays, b.isStale, b.current], [30, false, true], 'day 30 (Manila) is not stale');
b = PF.pfBoqBasis(comp({ savedAt: '2026-10-14T16:30:00Z' }), at('2026-11-14T16:00:00Z'));
eq([b.ageDays, b.isStale, b.current, b.badges], [31, true, false, ['Stale · 31 days']], 'day 31 (Manila) is stale');
b = PF.pfBoqBasis(comp({ savedAt: null }), at('2026-11-14T04:00:00Z'));
eq([b.savedText, b.badges, b.current], ['BOQ date unavailable', ['BOQ date unavailable'], false]);
b = PF.pfBoqBasis(comp({ savedAt: { toDate: () => new Date('2026-11-01T02:00:00Z') } }), at('2026-11-14T04:00:00Z'));
eq([b.savedAt, b.current], ['2026-11-01T02:00:00.000Z', true], 'a shim Timestamp resolves');
eq(PF.pfBoqBasis({ hasData: false, pct: 0 }, at('2026-11-14T04:00:00Z')).hasProgress, false);
eq(PF.PF_BOQ_STALE_DAYS, 30);
eq(PF.PF_LABELS.boqSaveNote, "Saving a BOQ refreshes this date even when progress hasn't changed.");

// ── profit view: the ₱74,267 case (R1, R2) ───────────────────────────
const sample = { contract: 6600000, spent: 4545733.23, today: at('2026-11-12T04:16:15Z'), period: 'All Time',
  completion: comp({ status: 'draft', savedAt: '2026-09-07T06:14:46.774Z' }) };
let v = PF.pfProfitView(sample);
eq([v.boq.earnedCents, v.boq.profitCents, PF.pfPct(v.boq.marginPct)], [462000000, 7426677, '1.61%']);
eq(v.headline, { kind: 'notConfirmed', label: 'Profit not confirmed', cents: null,
  reasons: ['BOQ is Draft', 'BOQ last saved 66 days ago'] });
eq([v.recognized.label, v.recognized.text], ['Recognized Project Profit', 'Unavailable']);
eq([v.contractLessCost.label, v.contractLessCost.cents, v.projected], ['Contract value minus costs', 205426677, null]);
v = PF.pfProfitView({ ...sample, completion: comp({ savedAt: '2026-11-01T02:00:00Z' }) });
eq([v.headline.kind, v.headline.label, v.headline.cents], ['boq', 'BOQ-based profit estimate', 7426677]);
v = PF.pfProfitView({ ...sample, completion: { hasData: false, pct: 0 } });
eq([v.boq.available, v.headline.reasons], [false, ['No BOQ progress recorded']]);
eq(v.contractLessCost.cents, 205426677, 'contract less cost survives without a BOQ');
v = PF.pfProfitView({ ...sample, period: 'This Month' });
eq([v.headline.kind, v.headline.label, v.boq.profitCents, v.contractLessCost.cents], ['allTimeOnly', 'All Time only', null, null]);
for (const period of ['Last 30 days', 'Quarter to Date', 'Year to Date']) {
  eq(PF.pfProfitView({ ...sample, period }).headline.kind, 'allTimeOnly', period + ' is not All Time');
}
v = PF.pfProfitView({ ...sample, forecast: null });
eq([v.projected, v.headline.reasons[v.headline.reasons.length - 1]],
  [{ label: 'Projected final profit', text: 'Forecast pending' }, 'No approved forecast']);
// fence: the profit view never reads allocation planning (CLAUDE.md, billing allocations)
for (const fn of [PF.pfProfitView, PF.pfBoqBasis]) {
  assert.doesNotMatch(fn.toString(), /pcAllocation|pcPeriod|directPct|targetMargin|allocationMap/);
  passed++;
}

// ── allocation buckets and remaining (T01, T02, T21) ─────────────────
const policy = { directPct: 70, indirectPct: 20, targetMarginPct: 10 };
eq(PF.pfPeriodBuckets(10000000, policy), { directCents: 7000000, indirectCents: 2000000, reserveCents: 1000000 });
eq(PF.pfPeriodBuckets(10001, policy), { directCents: 7001, indirectCents: 2000, reserveCents: 1000 }, 'residual goes to the reserve');
eq(PF.pfPeriodBuckets(-10001, policy), { directCents: -7001, indirectCents: -2000, reserveCents: -1000 }, 'an exact reversal negates every bucket');
eq(PF.pfPeriodBuckets(100, null), null);
eq(PF.pfPeriodBuckets(100, { directPct: 70, indirectPct: 25, targetMarginPct: 10 }), null);
const a = { id: 'a', folderId: 'f', fundingType: 'progress', monthlyBudget: 100000 };
let r = PF.pfAllocationRemaining({ periods: [a], allocationMap: { a: policy }, spentCents: PF.pfCents(87000), allTime: true });
eq([r.operatingCents, r.totalCents, r.incomplete], [300000, 1300000, false]);
r = PF.pfAllocationRemaining({ periods: [a, { id: 'b', folderId: 'f', fundingType: 'progress', monthlyBudget: 50000 },
  { id: 'z', folderId: 'f', fundingType: 'progress', monthlyBudget: 0 },
  { id: 'c', folderId: 'f', fundingType: 'president', monthlyBudget: 0 }],
  allocationMap: { a: policy }, spentCents: PF.pfCents(87000), allTime: true });
eq([r.missing, r.incomplete, r.operatingCents, r.totalCents], [1, true, null, 6300000],
  'a funded period without a snapshot makes operating Incomplete; total still shows');
r = PF.pfAllocationRemaining({ periods: [a], allocationMap: { a: policy }, spentCents: 0, allTime: false });
eq([r.totalCents, r.operatingCents], [null, null], 'cumulative balances are All Time only');

// ── fund balances by period id: signed credit, Cover, deleted, company, stray link ──
const fb = PF.pfFundBalances({ folderIds: new Set(['f']),
  periods: [a, { id: 'c', folderId: 'f', fundingType: 'president', monthlyBudget: 0 }],
  payroll: [{ projectId: 'a', totalSalary: 30000 }],
  expenses: [{ projectId: 'a', amount: 40000 }, { projectId: 'a', amount: -5000 }, { projectId: 'c', amount: 2000 },
    { projectId: null, folderId: 'f', amount: 1000 }, { projectId: 'other-job', amount: 77777 }],
  overhead: [{ folderId: 'f', billingPeriodId: 'a', amount: 3000 }, { folderId: 'f', billingPeriodId: null, amount: 500 },
    { folderId: 'f', billingPeriodId: 'elsewhere', amount: 700 }, { folderId: 'f', billingPeriodId: 'a', amount: 900, deletedAt: 'x' },
    { folderId: 'f', scope: 'company', amount: 9999 }, { folderId: 'g', billingPeriodId: null, amount: 4444 }] });
const row = id => fb.rows.find(x => x.id === id);
eq([row('a').chargedCents, row('a').balanceCents], [6800000, 3200000], 'a credit row is summed signed, never clamped');
eq([row('c').balanceCents, row('c').companyFrontedCents], [null, 200000]);
eq([fb.notChargedCents, fb.notChargedRows, fb.spentCents, fb.totalRemainingCents],
  [220000, { expenses: 1, overhead: 2 }, 7220000, 2780000]);
eq(row('a').balanceCents - row('c').companyFrontedCents - fb.notChargedCents, fb.totalRemainingCents, 'the project reconciliation closes');
// Additional Works counted once; overhead pointing at another folder's period is not charged
const aw = { id: 'w', folderId: 'aw', fundingType: 'progress', monthlyBudget: 20000 };
const fbAw = PF.pfFundBalances({ folderIds: new Set(['f', 'aw']), periods: [a, aw], payroll: [], expenses: [],
  overhead: [{ folderId: 'aw', billingPeriodId: 'w', amount: 100 }, { folderId: 'f', billingPeriodId: 'w', amount: 50 }] });
eq([fbAw.rows.length, fbAw.rows.find(x => x.id === 'w').chargedCents, fbAw.notChargedCents, fbAw.clientBaseCents],
  [2, 10000, 5000, 12000000]);

// ── duplicate billing numbers (T19) ──────────────────────────────────
const dup = PF.pfDuplicateBillingNumbers([
  { id: 'o', folderId: 'f', fundingType: 'progress', billingNumber: 3, month: 'October', year: '2026' },
  { id: 's', folderId: 'f', fundingType: 'progress', billingNumber: 3, month: 'September', year: '2026' },
  { id: 'm', folderId: 'f', fundingType: 'mobilization', billingNumber: null, month: 'May', year: '2026' },
  { id: 'n', folderId: 'f', fundingType: 'mobilization', billingNumber: 0, month: 'May', year: '2026' },
  { id: 'p', folderId: 'f', fundingType: 'president', billingNumber: 3, month: 'May', year: '2026' },
  { id: 'x', folderId: 'g', fundingType: 'progress', billingNumber: 3, month: 'May', year: '2026' }]);
eq(dup.map(g => [g.number, g.periods.map(p => p.id)]), [[3, ['s', 'o']]]);
eq(PF.pfDuplicateText(dup[0]), 'Billing #3 is used by 2 periods (September 2026, October 2026) — check and renumber');

console.log('project-finance: ' + passed + ' checks passed');
