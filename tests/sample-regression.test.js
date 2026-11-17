// ════════════════════════════════════════════════════════════════════
// SAMPLE RESIDENCE REGRESSION — node tests/sample-regression.test.js
//
// The ₱74,267 "Net Profit · Earned" display, traced 14 Nov 2026: BOQ-earned
// revenue ₱4,620,000.00 (contract ₱6,600,000 × BOQ 70%, a Draft BOQ last saved
// 7 Sep 2026) less cost ₱4,545,733.23. It never came from the 70/20/10
// allocation. Both dated snapshots are FROZEN fixtures: they must keep
// reproducing exactly, whatever the live data does. Live Sample is checked
// separately by tools/finance/reconcile-folder.js.
//
// For each snapshot: the OLD money functions (extracted from the live portal
// source) reproduce what was on screen, and the NEW labelling layer shows the
// same number under its honest label, with the right allocation figures and
// fund balances matched by billing-period id.
// Spec: docs/superpowers/specs/2026-11-14-financial-management-mvp-design.md §2, §7.1
// ════════════════════════════════════════════════════════════════════
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const PF = require('../js/project-finance.js');
const { loadPortalMoney, projectFromFixture } = require('./helpers/portal-money.js');

let passed = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); passed++; };
const c = PF.pfCents;
const old = loadPortalMoney();

for (const file of ['sample-residence-2026-11-12.json', 'sample-residence-2026-11-14.json']) {
  const fx = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', file), 'utf8'));
  const x = fx.expected;
  const tag = ' [' + file + ']';
  const p = projectFromFixture(fx);
  const m = old._projMargin(p);

  // ── the old path reproduces what was on screen (the verified cause) ──
  eq([c(p.spent), c(p.labor), c(p.material), c(p.overhead), c(p.coverCost)],
    [x.spentCents, x.laborCents, x.materialCents, x.overheadCents, x.coverCents], 'buckets' + tag);
  eq([m.isForecast, c(m.earned), c(m.profit)], [false, x.earnedCents, x.boqEstimateCents], 'old earned profit' + tag);
  eq((m.profit < 0 ? 'Net Loss' : 'Net Profit') + (m.isForecast ? ' · Forecast' : ' · Earned'), x.legacyLabel, 'old label' + tag);
  eq('₱ ' + old.peso(m.profit), x.legacyHeroText, 'old hero text' + tag);
  eq([p.completion.status, p.completion.savedAt], ['draft', '2026-09-07T06:14:46.774Z'], 'BOQ basis' + tag);

  // ── the new view: same number, honest label, demoted (R1, R2, R4) ──
  const v = PF.pfProfitView({ contract: p.revenue, spent: p.spent, completion: p.completion, today: new Date(fx.today), period: 'All Time' });
  eq([v.boq.profitCents, PF.pfPeso(v.boq.profitCents), PF.pfPct(v.boq.marginPct)],
    [x.boqEstimateCents, x.boqEstimateText, x.marginText], 'estimate' + tag);
  eq([v.boq.label, v.boq.basis.ageDays, v.boq.basis.savedText, v.boq.basis.badges],
    ['BOQ-based profit estimate', x.ageDays, x.savedText, x.badges], 'basis' + tag);
  eq(v.headline, x.headline, 'headline' + tag);
  assert.doesNotMatch(JSON.stringify(v), /Net Profit|Earned/, 'the new view never says Net Profit or Earned' + tag);
  eq(v.recognized.text, 'Unavailable', 'recognized' + tag);
  eq(v.contractLessCost.cents, x.contractLessCostCents, 'contract less cost' + tag);

  // ── allocation, by billing-period id ─────────────────────────────
  const map = Object.fromEntries(fx.periods.map(q => [q.id, fx.policy]));
  const months = fx.periods.map(old.mapMonthlyProject);
  const r = PF.pfAllocationRemaining({ periods: months, allocationMap: map, spentCents: c(p.spent), allTime: true });
  eq([r.directCents, r.indirectCents, r.reserveCents, r.operatingCents, r.totalCents],
    [x.directCents, x.indirectCents, x.reserveCents, x.operatingCents, x.totalRemainingCents], 'allocation' + tag);
  eq([r.directCents - c(p.labor) - c(p.material), r.indirectCents - c(p.overhead)],
    [x.directVarianceCents, x.indirectVarianceCents], 'variances' + tag);
  eq(r.operatingCents, x.directVarianceCents + x.indirectVarianceCents, 'operating = direct + indirect variance' + tag);
  eq(c(p.revenue) - c(p.allocated), x.contractLessAllocatedCents, 'contract less allocated funds' + tag);
  eq(c(p.allocated) - c(p.spent), x.totalRemainingCents, 'the old Budget Remaining equals the new total' + tag);
  const fb = PF.pfFundBalances({ periods: months, payroll: fx.payroll, expenses: fx.expenses, overhead: fx.overhead,
    folderIds: new Set([fx.folder.id]) });
  eq(Object.fromEntries(fb.rows.map(q => [q.id, q.balanceCents])), x.fundBalanceCents, 'fund balances by id' + tag);
  eq([fb.notChargedCents, fb.spentCents, fb.totalRemainingCents], [x.notChargedCents, x.spentCents, x.totalRemainingCents],
    'the reconciliation closes' + tag);
  eq(PF.pfDuplicateBillingNumbers(months).map(g => ({ number: g.number, periodIds: g.periods.map(q => q.id), text: PF.pfDuplicateText(g) })),
    x.duplicates, 'duplicate #3' + tag);

  // ── R3: no allocation figure produces the estimate ────────────────
  for (const cents of [r.directCents, r.directCents + r.indirectCents, r.reserveCents, r.operatingCents, r.totalCents,
    r.directCents - c(p.spent), c(p.allocated) * 7 / 10]) {
    assert.notStrictEqual(cents, x.boqEstimateCents, 'an allocation figure equals the estimate' + tag);
    passed++;
  }
}

// ── the BOQ basis comes from the SAME document as the % complete ─────
{
  const line = pct => ({ qty: 1, materialRate: 1000, laborRate: 0, percentCompletion: pct });
  const docA = { folderId: 'f1', status: 'draft', updatedAt: '2026-09-01T00:00:00Z',
    costItems: [{ subItems: [{ lineItems: [line(50)] }] }, { subItems: [{ lineItems: [line(50)] }] }] };
  const docB = { folderId: 'f1', status: 'approved', updatedAt: { toDate: () => new Date('2026-11-01T00:00:00Z') },
    costItems: [{ subItems: [{ lineItems: [line(90)] }] }] };
  const comp = old._folderCompletion([docB, docA], 'f1');
  eq([comp.pct, comp.status, comp.savedAt], [0.5, 'draft', '2026-09-01T00:00:00Z'], 'basis and % from one document');
  const compB = old._folderCompletion([docB], 'f1');
  eq([compB.status, compB.savedAt], ['approved', '2026-11-01T00:00:00.000Z'], 'a shim Timestamp resolves to ISO');
  eq(old._folderCompletion([{ ...docA, costItems: [{ subItems: [{ lineItems: [line(0)] }] }] }], 'f1'),
    { hasData: false, pct: 0, status: 'draft', savedAt: '2026-09-01T00:00:00Z' }, 'no progress keeps its basis');
  eq(old._folderCompletion([], 'f1'), { hasData: false, pct: 0 }, 'no BOQ at all');
}

console.log('sample-regression: ' + passed + ' checks passed');
