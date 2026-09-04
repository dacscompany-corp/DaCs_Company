// ════════════════════════════════════════════════════════════════════
// MONEY MATH TESTS — run with:  node tests/money-math.test.js
//
// Zero dependencies, no framework. Each test feeds known inputs into the
// REAL functions (extracted from the live JS files at run time — never a
// copy) and fails loudly if any money rule is broken.
//
// The rules under guard (see CLAUDE.md and docs/OVERHEAD_MODULE.md):
//   1. Every peso lands in exactly ONE bucket (labor / material / overhead).
//   2. Indirect labor is Overhead, not Labor. Statutory burden follows the
//      worker it was paid for (coordinator's SSS → Overhead, mason's → Labor).
//   3. Overhead / indirect pay NEVER draws down a pakyaw contract.
//   4. Profit is measured on EARNED revenue (percentage-of-completion).
//      No accomplishment data → labelled Forecast, never Earned.
//   5. Company P&L: unmeasured projects book ZERO profit (losses immediately);
//      company overhead = company-scope rows only, soft-deleted excluded.
//   6. Soft-deleted overhead expenses never count anywhere.
//
// If a test fails with "SLICE NOT FOUND", the source file was restructured —
// update the extraction markers below, don't delete the test.
// ════════════════════════════════════════════════════════════════════
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

// ── tiny test harness ────────────────────────────────────────────────
let passed = 0, failed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { failed++; failures.push(name + ' — ' + e.message); console.log('  FAIL ' + name + '\n       ' + e.message); }
}
function eq(actual, expected, label) {
  const a = typeof actual === 'number' ? +actual.toFixed(6) : actual;
  const b = typeof expected === 'number' ? +expected.toFixed(6) : expected;
  if (a !== b) throw new Error((label || 'value') + ': expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a));
}
function ok(cond, label) { if (!cond) throw new Error(label || 'expected truthy'); }

// ── extract live functions from a source file ────────────────────────
// slice(file, startMarker, endMarker) → source text between the markers.
function slice(src, start, end, file) {
  const i = src.indexOf(start);
  if (i === -1) throw new Error('SLICE NOT FOUND: "' + start + '" in ' + file + ' — file restructured; update tests/money-math.test.js markers');
  const j = src.indexOf(end, i);
  if (j === -1) throw new Error('SLICE NOT FOUND: end "' + end + '" in ' + file);
  return src.slice(i, j);
}
// Evaluate source with injected globals; return the named bindings.
function evalWith(src, ctx, names) {
  const fn = new Function('ctx', 'with(ctx){' + src + '\n; return {' + names.join(',') + '};}');
  return fn(ctx);
}

// ════════════════════════════════════════════════════════════════════
// Load the live code
// ════════════════════════════════════════════════════════════════════
const portalSrc = read('js/portal-app.compiled.js');
const expensesSrc = read('js/expenses-module.js');
const overheadSrc = read('js/overhead-module.js');
const pmSrc = read('js/pm-admin.js');

// portal helpers: classifier, money helpers, buildProject, BOQ math
const portal = evalWith(
  slice(portalSrc, 'const LIABILITY_KEYWORDS', 'function mapExpenseDoc', 'portal-app.compiled.js')
  + slice(portalSrc, 'function _isOverheadPay', 'function FoldersGrid', 'portal-app.compiled.js')
  + '\nfunction shortRef(p, id){ return p + "-" + id; }\n',
  { window: undefined },
  ['classifyLabor', 'mapPayrollDoc', '_isOverheadPay', '_projOverhead', '_projSpent',
   '_folderCompletion', '_projEarned', '_projMargin', '_recognisedProfit', '_companyOverhead',
   '_ocmStatus', 'buildProject', 'boqGrandTotal', 'boqAccTotal']
);

// pakyaw drawdown: lcDrawsDown / lcPaid / lcStats read the expPayroll global
function pakyaw(expPayroll) {
  return evalWith(
    slice(expensesSrc, 'function lcDrawsDown', '// Worker names seen on this folder', 'expenses-module.js'),
    { expPayroll },
    ['lcDrawsDown', 'lcPaid', 'lcStats']
  );
}

// admin Overhead page merge: reads _ovhdExpenses/_ovAllPayroll/expProjects globals
function adminOverhead(ctx) {
  return evalWith(
    slice(overheadSrc, 'const _OVHD_INDIRECT_KEYWORDS', '// ── Init', 'overhead-module.js'),
    Object.assign({ _ovhdExpenses: [], _ovAllPayroll: [], expPayroll: [], expProjects: [] }, ctx),
    ['_ovhdIsIndirectPay', '_ovhdIndirectRows', '_ovhdRows']
  );
}

// ════════════════════════════════════════════════════════════════════
// A. Cost buckets — buildProject
// ════════════════════════════════════════════════════════════════════
console.log('\nA. Cost buckets (buildProject)');
{
  const folder = { id: 'f1', totalBudget: 1000000 };
  const months = [{ id: 'm1', monthlyBudget: 900000, fundingType: '' }];
  const labor = [
    { projectId: 'm1', type: 'direct',    liabilityFor: 'direct',   amount: 300000 }, // masons
    { projectId: 'm1', type: 'indirect',  liabilityFor: 'direct',   amount: 50000 },  // coordinator
    { projectId: 'm1', type: 'liability', liabilityFor: 'direct',   amount: 20000 },  // masons' SSS
    { projectId: 'm1', type: 'liability', liabilityFor: 'indirect', amount: 4000 }    // coordinator's SSS
  ];
  const material = [{ projectId: 'm1', amount: 400000, docs: {} }];
  const ovhd = [
    { folderId: 'f1', amount: 30000 },                         // fuel/utilities
    { folderId: 'f1', amount: 10000, deletedAt: 'x' }          // soft-deleted
  ];
  const p = portal.buildProject(folder, months, labor, material, ovhd);

  test('labor = direct + DIRECT burden only', () => eq(p.labor, 320000));
  test('overhead = indirect + indirect burden + operating costs', () => eq(p.overhead, 84000));
  test('overhead breakdown: indirect labor slice', () => eq(p.overheadBreakdown.indirectLabor, 54000));
  test('overhead breakdown: operating costs slice', () => eq(p.overheadBreakdown.expenses, 30000));
  test('soft-deleted overhead expense excluded', () => ok(p.overheadBreakdown.expenses === 30000, '10k deleted row leaked in'));
  test('liability total stays the TRUE total (both burdens)', () => eq(p.laborBreakdown.liability, 24000));
  test('EVERY PESO ONCE: spent = all live money exactly', () => eq(p.spent, 300000 + 50000 + 20000 + 4000 + 400000 + 30000));
  test('_projSpent agrees with buildProject.spent', () => eq(portal._projSpent(p), p.spent));
}

// ════════════════════════════════════════════════════════════════════
// B. Percentage-of-completion — earned margin
// ════════════════════════════════════════════════════════════════════
console.log('\nB. Percentage-of-completion (earned margin)');
{
  const boq = (pct) => [{ folderId: 'f1', costItems: [{ subItems: [{ lineItems: [
    { qty: 1, materialRate: 600000, laborRate: 400000, percentCompletion: pct }
  ] }] }] }];
  const proj = (boqRaw, spend) => ({
    revenue: 1000000, labor: spend, material: 0, overhead: 0,
    completion: portal._folderCompletion(boqRaw, 'f1')
  });

  test('10% built, 80k spent → 20% EARNED margin (not 92%)', () => {
    const m = portal._projMargin(proj(boq(10), 80000));
    eq(m.isForecast, false, 'isForecast'); eq(m.pct, 20, 'margin'); eq(m.earned, 100000, 'earned');
  });
  test('50% built, 560k spent → −12% (overrun exposed, not +44%)', () => {
    const m = portal._projMargin(proj(boq(50), 560000));
    eq(m.isForecast, false); eq(m.pct, -12, 'margin');
  });
  test('100% built, 780k spent → 22%', () => {
    const m = portal._projMargin(proj(boq(100), 780000));
    eq(m.pct, 22, 'margin');
  });
  test('BOQ all zeros → FORECAST fallback (no false "losing money")', () => {
    const m = portal._projMargin(proj(boq(0), 80000));
    eq(m.isForecast, true, 'isForecast'); eq(m.earned, 1000000, 'earned falls back to contract');
  });
  test('no BOQ at all → FORECAST fallback', () => {
    const m = portal._projMargin(proj([], 80000));
    eq(m.isForecast, true);
  });
  test('completion is clamped to 100% (bad data cannot inflate earned)', () => {
    const c = portal._folderCompletion(boq(150), 'f1');
    eq(c.pct, 1, 'pct clamped');
  });
}

// ════════════════════════════════════════════════════════════════════
// C. Company P&L — recognition rules
// ════════════════════════════════════════════════════════════════════
console.log('\nC. Company P&L (zero-profit method + immediate losses)');
{
  const comp = (pct) => ({ hasData: pct > 0, pct: pct / 100 });
  const P = (rev, cost, pct) => ({ revenue: rev, labor: cost, material: 0, overhead: 0, completion: comp(pct) });

  test('measured healthy job books its earned profit', () =>
    eq(portal._recognisedProfit(P(1000000, 500000, 60)), 100000));
  test('measured overrun books its earned loss', () =>
    eq(portal._recognisedProfit(P(1000000, 560000, 50)), -60000));
  test('UNMEASURED healthy job books ZERO (not +1.8M of fiction)', () =>
    eq(portal._recognisedProfit(P(2000000, 200000, 0)), 0));
  test('unmeasured job already OVER contract books the loss immediately', () =>
    eq(portal._recognisedProfit(P(500000, 700000, 0)), -200000));
  test('company overhead: company scope + legacy no-folder rows, minus deleted/project', () => {
    const rows = [
      { scope: 'company', amount: 120000 },
      { scope: 'project', folderId: 'f1', amount: 30000 },       // project — excluded
      { folderId: 'f9', amount: 15000 },                          // legacy project — excluded
      { amount: 40000 },                                          // legacy company — included
      { scope: 'company', amount: 99999, deletedAt: 'x' }         // deleted — excluded
    ];
    eq(portal._companyOverhead(rows), 160000);
  });
}

// ════════════════════════════════════════════════════════════════════
// D. Pakyaw contracts — overhead pay never draws down
// ════════════════════════════════════════════════════════════════════
console.log('\nD. Pakyaw drawdown (lcPaid / lcStats)');
{
  const rows = [
    { id: 'p1', contractId: 'c1', laborType: 'direct',    totalSalary: 30000 },
    { id: 'p2', contractId: 'c1', laborType: 'indirect',  totalSalary: 8000 },  // must NOT draw down
    { id: 'p3', contractId: 'c1', laborType: 'liability', totalSalary: 5000 },
    { id: 'p4', contractId: 'c2', laborType: 'direct',    totalSalary: 9999 }   // other contract
  ];
  const lc = pakyaw(rows);

  test('OVERHEAD PAY NEVER DRAWS DOWN: indirect row skipped even with contractId', () =>
    eq(lc.lcPaid('c1'), 35000, 'paid (30k direct + 5k liability, NOT the 8k indirect)'));
  test('remaining balance reflects only drawdown rows', () =>
    eq(lc.lcStats({ id: 'c1', agreedAmount: 100000 }).remaining, 65000));
  test('excludeRowId lets an edit ignore its own old amount', () =>
    eq(lc.lcPaid('c1', 'p1'), 5000));
  test('no contract → zero', () => eq(lc.lcPaid(null), 0));
}

// ════════════════════════════════════════════════════════════════════
// E. Routing — which rows belong to Overhead
// ════════════════════════════════════════════════════════════════════
console.log('\nE. Overhead routing (portal + admin page agree)');
{
  test('portal: indirect pay routes to Overhead', () =>
    ok(portal._isOverheadPay({ type: 'indirect' })));
  test("portal: coordinator's SSS (liabilityFor indirect) routes to Overhead", () =>
    ok(portal._isOverheadPay({ type: 'liability', liabilityFor: 'indirect' })));
  test("portal: mason's SSS stays in Labor", () =>
    ok(!portal._isOverheadPay({ type: 'liability', liabilityFor: 'direct' })));
  test('portal: legacy liability row (no flag) stays in Labor — nothing reclassified silently', () =>
    ok(!portal._isOverheadPay({ type: 'liability' })));

  const ctx = {
    expProjects: [{ id: 'm1', folderId: 'f1' }],
    _ovAllPayroll: [
      { id: 'p1', projectId: 'm1', workerName: 'Mark Frias', role: 'Coordinator Site Supervision', laborType: 'indirect', totalSalary: 8000, paymentDate: '2026-07-04' },
      { id: 'p2', projectId: 'm1', workerName: 'Juan Cruz', role: 'Mason', laborType: 'direct', totalSalary: 5000, paymentDate: '2026-07-04' },
      { id: 'p3', projectId: 'm1', workerName: 'Ana Reyes', role: 'Procurement Staff', totalSalary: 6000, paymentDate: '2026-07-05' },          // legacy: no laborType
      { id: 'p4', projectId: 'm1', workerName: 'SSS Remit', role: 'SSS', laborType: 'liability', liabilityFor: 'indirect', totalSalary: 900, paymentDate: '2026-07-06' },
      { id: 'p5', projectId: 'm1', workerName: 'SSS Remit', role: 'SSS', laborType: 'liability', totalSalary: 1200, paymentDate: '2026-07-06' }  // direct burden
    ],
    _ovhdExpenses: [{ id: 'e1', scope: 'project', folderId: 'f1', category: 'Fuel', amount: 3000, date: '2026-07-02' }]
  };
  const adm = adminOverhead(ctx);
  const rows = adm._ovhdIndirectRows();

  test('admin page: coordinator appears (tagged indirect)', () =>
    ok(rows.some(r => r.expenseName === 'Mark Frias')));
  test('admin page: legacy Procurement row caught by role keyword', () =>
    ok(rows.some(r => r.expenseName === 'Ana Reyes')));
  test("admin page: coordinator's SSS included, mason's SSS excluded", () => {
    eq(rows.filter(r => r.category === 'SSS').length, 1, 'exactly one SSS row');
    eq(rows.filter(r => r.category === 'SSS')[0].amount, 900);
  });
  test('admin page: mason excluded', () => ok(!rows.some(r => r.expenseName === 'Juan Cruz')));
  test('admin page: payroll rows are namespaced (pay:) so they can never be edited as expenses', () =>
    ok(rows.every(r => String(r.id).startsWith('pay:'))));
  test('admin page: merged rows = expenses + indirect payroll', () =>
    eq(adm._ovhdRows().length, 1 + rows.length));
}

// ════════════════════════════════════════════════════════════════════
// F. Legacy classifier — your wording must be recognised
// ════════════════════════════════════════════════════════════════════
console.log('\nF. Legacy classifier (rows saved before laborType existed)');
{
  test('"Coordinator Site Supervision" → indirect (the Mark Frias case)', () =>
    eq(portal.classifyLabor('Coordinator Site Supervision', 'Mark Frias'), 'indirect'));
  test('"Supervision" alone → indirect (substring bug fixed)', () =>
    eq(portal.classifyLabor('Supervision', ''), 'indirect'));
  test('"Procurement Staff" → indirect', () =>
    eq(portal.classifyLabor('Procurement Staff', ''), 'indirect'));
  test('"Mason" → direct', () => eq(portal.classifyLabor('Mason', ''), 'direct'));
  test('"SSS" → liability (liability keywords win)', () => eq(portal.classifyLabor('SSS', ''), 'liability'));
  test('explicit laborType always beats the keyword guess', () =>
    eq(portal.mapPayrollDoc({ id: 'x', laborType: 'direct', role: 'Coordinator', totalSalary: 1 }).type, 'direct'));
}

// ════════════════════════════════════════════════════════════════════
// G. BOQ totals — the base of earned revenue
// ════════════════════════════════════════════════════════════════════
console.log('\nG. BOQ totals');
{
  const items = [{ subItems: [{ lineItems: [
    { qty: 2, materialRate: 100, laborRate: 50, percentCompletion: 50 },   // 300 total, 150 done
    { qty: 1, materialRate: 1000, laborRate: 0, percentCompletion: 100 },  // 1000 total, 1000 done
    { qty: 3, materialRate: '1,000', laborRate: 0, percentCompletion: 0 }  // comma string → 3000
  ] }] }];
  test('grand total handles qty × (material + labor) and comma strings', () =>
    eq(portal.boqGrandTotal(items), 4300));
  test('accomplished total weights each line by its % completion', () =>
    eq(portal.boqAccTotal(items), 1150));
  test('material/labor overrides zero out that component', () =>
    eq(portal.boqGrandTotal([{ subItems: [{ lineItems: [{ qty: 2, materialRate: 100, laborRate: 50, materialOverride: true }] }] }]), 100));
}

// ════════════════════════════════════════════════════════════════════
// H. OCM allowance — priced overhead vs actual
// ════════════════════════════════════════════════════════════════════
console.log('\nH. OCM allowance (priced vs actual overhead)');
{
  test('10% of a 1M contract → 100k allowance; 81k spent = 81% used, within', () => {
    const o = portal._ocmStatus(1000000, 10, 81000);
    eq(o.allowance, 100000); eq(o.usedPct, 81); eq(o.over, false); eq(o.remaining, 19000);
  });
  test('overrun flagged: 120k spent on a 100k allowance → over, −20k remaining', () => {
    const o = portal._ocmStatus(1000000, 10, 120000);
    eq(o.over, true); eq(o.remaining, -20000); eq(o.usedPct, 120);
  });
  test('no allowance configured (pct 0 / null / no contract) → null, never a fake comparison', () => {
    ok(portal._ocmStatus(1000000, 0, 50000) === null, 'pct 0');
    ok(portal._ocmStatus(1000000, null, 50000) === null, 'pct null');
    ok(portal._ocmStatus(0, 10, 50000) === null, 'no contract');
  });
  test('zero spend on a set allowance → 0% used, full remaining', () => {
    const o = portal._ocmStatus(2000000, 8, 0);
    eq(o.allowance, 160000); eq(o.usedPct, 0); eq(o.remaining, 160000);
  });
}

// ════════════════════════════════════════════════════════════════════
// I. Cover / president money — spending, not a fourth bucket
// ════════════════════════════════════════════════════════════════════
// "Cover" (a president-funded period, or a row flagged coverExpense) is the
// same work, paid out of the company's own pocket because the client's
// allocation ran out. It is therefore SPENDING: it belongs in Labor and in
// Material like any other cost, and the Cover figure reported beside them is
// a SUBSET of those totals — never added on top.
//
// This went wrong once (fixed 2026-08-20): the Reports KPI row dropped only
// the coverExpense FLAG from materials but the whole president PERIOD from
// labor. Cover material then showed inside Materials AND inside Cover — the
// same pesos twice on one row — while cover payroll showed in neither Labor
// nor Total Spent, so Project Control and Reports disagreed on the total.
console.log('\nI. Cover / president money');
{
  const folder = { id: 'f1', totalBudget: 1000000 };
  const months = [
    { id: 'm1', monthlyBudget: 500000, fundingType: 'progress'  },  // client-funded
    { id: 'm2', monthlyBudget: 0,      fundingType: 'president' }   // the cover pool
  ];
  const labor = [
    { projectId: 'm1', type: 'direct', liabilityFor: 'direct', amount: 200000 },
    { projectId: 'm2', type: 'direct', liabilityFor: 'direct', amount: 40000  }   // cover payroll
  ];
  const material = [
    { projectId: 'm1', amount: 100000, docs: {} },
    { projectId: 'm2', amount: 60000,  docs: {} },                                // cover material
    { projectId: 'm1', amount: 5000,   docs: {}, coverExpense: true }             // flagged overflow
  ];
  const p = portal.buildProject(folder, months, labor, material, []);

  test('cover payroll counts as Labor', () => eq(p.labor, 240000));
  test('cover material counts as Material', () => eq(p.material, 165000));
  test('EVERY PESO ONCE: spent includes cover exactly once', () => eq(p.spent, 405000));
  test('coverCost reports the overflow slice', () => eq(p.coverCost, 105000));
  test('coverCost is a SUBSET of spent, never an addition', () =>
    ok(p.coverCost < p.spent && p.spent === p.labor + p.material + p.overhead,
       'cover must not be a fourth bucket added to spent'));
  test('a project with no cover pool is unaffected', () => {
    const q2 = portal.buildProject(folder, [months[0]], [labor[0]], [material[0]], []);
    eq(q2.coverCost, 0); eq(q2.spent, 300000);
  });
}

// The Reports module computes the same buckets INLINE, inside render functions
// that cannot be extracted and called. These guards fail if either carve-out is
// reintroduced there — the exact edit that caused the 2026-08-20 mismatch, and
// the kind a merge silently reverts.
{
  const carveOuts = [
    ['Reports KPI · materials',      "_srcExp.filter(e => _kpiProjIdSet.has(e.projectId) && !e.coverExpense)"],
    ['Reports KPI · labor',          "_srcPay.filter(p => _kpiProjIdSet.has(p.projectId) && !_kpiPresProjIds.has(p.projectId))"],
    ['All-time summary · materials', "allExps.filter(e => !e.coverExpense)"],
    ['All-time summary · labor',     "allPay.filter(p => !presProjIds.has(p.projectId))"],
    ['Printed report · materials',   "_prtProjIdSet.has(e.projectId) && !e.coverExpense"],
    ['Printed report · labor',       "_prtProjIdSet.has(p.projectId) && !_prtPresProjIds.has(p.projectId)"]
  ];
  carveOuts.forEach(function (c) {
    test(c[0] + ' does not carve cover out of the total', () =>
      ok(expensesSrc.indexOf(c[1]) === -1,
         'expenses-module.js re-excludes cover money here — Reports will disagree with Project Control again'));
  });
  test('Cover card still says it is included in the totals above', () =>
    ok(expensesSrc.indexOf('included above') !== -1,
       'the Cover sub-label must keep saying "included above", or it reads as a fourth bucket'));
}

// The printed report must show the SAME balance figure as the screen and as the
// TOTAL row of its own table: Funds Available = Allocated - Spent. It used to
// print "Budget Remaining" = contract - spent, a card deleted from the site,
// which treated the whole contract as spendable AND already contained the
// Receivable Balance printed next to it (the unbilled amount, twice in one band).
{
  test('printed report computes Funds Available as Allocated - Spent', () =>
    ok(expensesSrc.indexOf('const contractVariance= totReceived - totSpent;') !== -1,
       'the print sheet is back on contract - spent: it will disagree with the screen and with its own TOTAL row'));
  test('printed report no longer prints the deleted "Budget Remaining" card', () =>
    ok(expensesSrc.indexOf('BUDGET REMAINING') === -1,
       'that card does not exist on the site; the print must not resurrect it'));
  test('printed balance is a percentage of ALLOCATED, not of contract', () =>
    ok(expensesSrc.indexOf('const contractRemPct  = totReceived > 0 ? (contractVariance / totReceived) * 100 : 0;') !== -1,
       'percentage base drifted back to the contract'));
}

// == J. OUT SOURCE IS NOT A FOURTH BUCKET (migration 0057) ==========
// Project Control Out Source contracts are VENDOR subcontracts living in the
// SAME `labor_contracts` table as in-house labor, split only by `category`.
// They are drawn down by the SAME payroll rows, so their pesos stay inside the
// Labor bucket:
//
//     Labor = direct + (liability - liabilityIndirect)      <- unchanged
//
// The in-house / Out Source split shown in the Worker Tracker is a READING AID,
// derived at render time from each payment's contract. It must never become a
// fourth bucket in Spent, and must never be stamped on the payroll row (that
// would need a backfill and would freeze history against later recategorising).
{
  test('Out Source contracts are split by `category`, not a separate table', () =>
    ok(expensesSrc.indexOf("c.category === 'outsource'") !== -1,
       'the category discriminator is gone - outsource and labor contracts have been split apart'));

  test('the contract array stays MIXED so id lookups still resolve either kind', () =>
    ok(expensesSrc.indexOf('function lcListByCategory(cat)') !== -1,
       'lcListByCategory is gone; if expLaborContracts were filtered at the source, every .find(x => x.id === id) breaks for one kind'));

  test('Out Source draws down through payroll, exactly like a labor contract', () =>
    ok(/function lcPaid\(contractId, excludeRowId\)[\s\S]{0,400}expPayroll/.test(expensesSrc),
       'lcPaid no longer sums payroll - the outsource drawdown path has been rerouted'));

  test('the in-house / Out Source split is DERIVED, not a stored payroll field', () =>
    ok(portalSrc.indexOf('_laborSplit') !== -1 && portalSrc.indexOf('_osIds') !== -1,
       'the derived split is gone; if it became a payroll column it needs a migration and a backfill'));

  test('the derived split reads the CONTRACT, never a flag on the payroll row', () =>
    ok(portalSrc.indexOf('t.contractId && _osIds.has(t.contractId)') !== -1,
       'the split stopped resolving through the contract - a stamped payroll flag freezes history'));

  test('a vendor contract never carries a Worker Agreement', () =>
    ok(expensesSrc.indexOf('vendors sign no Worker Agreement') !== -1,
       'the Out Source branch that suppresses the agreement fields is gone'));

  test('a vendor contract never carries a trade', () =>
    ok(expensesSrc.indexOf("const trade = isOutsource ? ''") !== -1,
       'Out Source contracts are writing a trade again - that is a worker field'));
}

// == K. ONE WORK AGREEMENT PER WORKER ==============================
// A worker hired for several capped jobs signs ONE pakyaw contract, not one
// sheet per job: the form's "SAKLAW NG TRABAHO / SCOPE OF WORK" lists every
// job and "NAPAGKASUNDUANG HALAGA / AGREED CONTRACT AMOUNT" is the SUM of
// their caps. This is a PRINTING rule, not a money rule — each job still draws
// down its own cap, and nothing here may ever add a peso to Spent.
//
// Two grouping rules are load-bearing, and are what these tests fence:
//   * the sheet covers exactly the jobs the WORKER CARD shows — trimmed name,
//     case-SENSITIVE — so a job typed "francis febra" stays its own card and is
//     never swept into someone else's contract amount;
//   * Project Control's contract array is MIXED across categories, so a VENDOR
//     subcontract must never land on a worker's agreement.
{
  const pcFixtures = [
    { id: 'a1', folderId: 'f1', workerName: 'Francis Febra',  scope: 'Architectural/Interior Finishing Works', agreedAmount: 50000, payType: 'pakyaw' },
    { id: 'b2', folderId: 'f1', workerName: 'Francis Febra ', scope: 'Carpentry Works', agreedAmount: 35000, payType: 'pakyaw' },
    { id: 'c3', folderId: 'f1', workerName: 'Francis Febra',  scope: 'Civil Works',     agreedAmount: 40000, payType: 'pakyaw' },
    { id: 'd4', folderId: 'f1', workerName: 'Francis Febra',  scope: 'Owner Supply',    agreedAmount: 30000, payType: 'pakyaw' },
    { id: 'e5', folderId: 'f1', workerName: 'Francis Febra',  scope: 'Plumbing Works',  agreedAmount: 45000, payType: 'pakyaw' },
    // Same NAME, vendor side of the same table — must never join the sheet.
    { id: 'v6', folderId: 'f1', workerName: 'Francis Febra',  scope: 'Windows supply & install', agreedAmount: 90000, category: 'outsource' },
    // Same person, different capitalisation: its own card, so its own sheet.
    { id: 'x7', folderId: 'f1', workerName: 'francis febra',  scope: 'Painting', agreedAmount: 12000, payType: 'pakyaw' },
    { id: 'n8', folderId: 'f1', workerName: '', scope: 'Nameless one', agreedAmount: 1000, payType: 'pakyaw' },
    { id: 'n9', folderId: 'f1', workerName: '', scope: 'Nameless two', agreedAmount: 2000, payType: 'pakyaw' },
  ];
  const pc = evalWith(
    slice(expensesSrc, 'function lcWorkerContracts(',
          '// Orientation date as it prints on the manual', 'js/expenses-module.js'),
    {
      lcIsOutsource: (c) => !!c && c.category === 'outsource',
      lcOrientationDateLabel: () => 'September 4, 2026',
      expFolders: [{ id: 'f1', name: 'Los Churreros', code: 'LC-01' }],
      expLaborContracts: pcFixtures,
    },
    ['lcWorkerContracts', 'lcWorkerAgreementDetails']);
  const FF = pcFixtures[2];                                   // opened from job 3 of 5

  test('PC: one sheet covers every LABOR job the worker holds', () =>
    eq(pc.lcWorkerContracts(FF).length, 5, 'jobs on the sheet'));

  test('PC: AGREED CONTRACT AMOUNT is the SUM of the caps, never one job', () =>
    eq(pc.lcWorkerAgreementDetails(pc.lcWorkerContracts(FF)).amount, '200,000.00', 'combined amount'));

  test('PC: SCOPE OF WORK lists every job, numbered', () =>
    eq(pc.lcWorkerAgreementDetails(pc.lcWorkerContracts(FF)).scope,
       '1) Architectural/Interior Finishing Works  2) Carpentry Works  3) Civil Works  4) Owner Supply  5) Plumbing Works',
       'combined scope'));

  test('PC: a VENDOR subcontract never lands on a worker agreement', () =>
    ok(!pc.lcWorkerContracts(FF).some((c) => c.category === 'outsource'),
       'an Out Source job leaked onto the worker sheet — the category filter is gone'));

  test('PC: a vendor sheet covers only vendor jobs', () => {
    const v = pc.lcWorkerContracts(pcFixtures[5]);
    eq(v.length, 1, 'vendor jobs');
    eq(v[0].id, 'v6', 'vendor job');
  });

  test('PC: a differently-CASED name stays its own worker, matching its card', () =>
    eq(pc.lcWorkerContracts(pcFixtures[6]).length, 1, 'lowercase-name jobs'));

  test('PC: nameless contracts share a card but NEVER share an agreement', () =>
    eq(pc.lcWorkerContracts(pcFixtures[7]).length, 1, 'nameless jobs on one sheet'));

  test('PC: a single job prints unnumbered, at its own amount', () => {
    const one = pc.lcWorkerAgreementDetails(pc.lcWorkerContracts(pcFixtures[6]));
    eq(one.scope, 'Painting', 'single scope');
    eq(one.amount, '12,000.00', 'single amount');
  });

  test('PC: pay type reads Mixed when the jobs disagree, never one job’s terms', () => {
    const cs = pc.lcWorkerContracts(FF);
    eq(pc.lcWorkerAgreementDetails(cs).payType, 'Pakyaw', 'all pakyaw');
    eq(pc.lcWorkerAgreementDetails(cs.concat([{ scope: 'z', agreedAmount: 0, payType: 'inhouse' }])).payType,
       'Mixed', 'mixed pay types');
  });

  const pmFixtures = [
    { id: 'a1', workerName: 'Francis Febra',  scope: 'Architectural/Interior Finishing Works', agreedAmount: 50000, payType: 'pakyaw' },
    { id: 'b2', workerName: 'Francis Febra ', scope: 'Carpentry Works', agreedAmount: 35000, payType: 'pakyaw' },
    { id: 'c3', workerName: 'Francis Febra',  scope: 'Civil Works',     agreedAmount: 40000, payType: 'pakyaw' },
    { id: 'd4', workerName: 'Francis Febra',  scope: 'Owner Supply',    agreedAmount: 30000, payType: 'pakyaw' },
    { id: 'e5', workerName: 'Francis Febra',  scope: 'Plumbing Works',  agreedAmount: 45000, payType: 'pakyaw' },
    { id: 'z9', workerName: 'Mark Frias',     scope: 'Masonry',         agreedAmount: 10000, payType: 'inhouse' },
  ];
  const pm = evalWith(
    slice(pmSrc, 'function _pmWorkerContracts(', 'async function _pmOpenWorkerAgreement(', 'js/pm-admin.js'),
    { _pmActiveProject: { id: 'p1', projectName: 'Los Churreros' }, _pmLaborContracts: pmFixtures },
    ['_pmWorkerContracts', '_pmWorkerAgreementDetails']);
  const PMFF = pmFixtures[2];

  test('PM: one sheet covers every job the worker holds on the project', () =>
    eq(pm._pmWorkerContracts(PMFF).length, 5, 'jobs on the sheet'));

  test('PM: AGREED CONTRACT AMOUNT is the SUM of the caps', () =>
    eq(pm._pmWorkerAgreementDetails(pm._pmWorkerContracts(PMFF)).amount, '200,000.00', 'combined amount'));

  test('PM: SCOPE OF WORK lists every job, numbered', () =>
    eq(pm._pmWorkerAgreementDetails(pm._pmWorkerContracts(PMFF)).scope,
       '1) Architectural/Interior Finishing Works  2) Carpentry Works  3) Civil Works  4) Owner Supply  5) Plumbing Works',
       'combined scope'));

  test('PM: another worker keeps their own sheet', () =>
    eq(pm._pmWorkerContracts(pmFixtures[5]).length, 1, 'Mark’s jobs'));

  test('PM and PC agree on the same worker’s combined amount', () =>
    eq(pm._pmWorkerAgreementDetails(pm._pmWorkerContracts(PMFF)).amount,
       pc.lcWorkerAgreementDetails(pc.lcWorkerContracts(FF)).amount,
       'the two modules disagree about what the worker agreed to'));

  test('the sheet prints agreed CAPS — it never restates what was paid', () => {
    // If either sheet started summing PAYMENTS it would be restating Spent on a
    // document that is not part of the money model.
    ok(slice(expensesSrc, 'function lcWorkerAgreementDetails(', '\n}\n', 'js/expenses-module.js')
        .indexOf('lcPaid') === -1, 'the PC sheet is reading payments — it prints agreed caps only');
    ok(slice(pmSrc, 'function _pmWorkerAgreementDetails(', '\n}\n', 'js/pm-admin.js')
        .indexOf('_pmContractPaid') === -1, 'the PM sheet is reading payments — it prints agreed caps only');
  });
}


// == L. ONE PAYMENT, SEVERAL JOBS — THE SPLIT ======================
// A day's labor pay often covers several of a worker's capped jobs at once.
// Ticking more than one splits the amount pro-rata by what each job still
// owes, and each leg is saved as its own row/entry, because the drawdown sums
// by contractId — one row could only ever credit one job.
//
// The invariant that matters for the money model: THE LEGS RE-ADD TO THE
// AMOUNT ENTERED. If they did not, splitting a payment would quietly change
// Spent. Project Control (lcAllocateAcrossContracts) and Project Management
// (_pmAllocateAcrossContracts) must agree — the same payment split in the two
// modules has to land the same way.
{
  const mkPC = (rows) => evalWith(
    slice(expensesSrc, 'function lcAllocateAcrossContracts(', '\n// Show the per-contract breakdown', 'js/expenses-module.js'),
    { expLaborContracts: rows, lcStats: (c) => ({ remaining: c.remaining }) },
    ['lcAllocateAcrossContracts']).lcAllocateAcrossContracts;
  const mkPM = (rows) => evalWith(
    slice(pmSrc, 'function _pmAllocateAcrossContracts(', '\n// What each ticked job will be charged', 'js/pm-admin.js'),
    { _pmLaborContracts: rows, _pmContractStats: (c) => ({ remaining: c.remaining }) },
    ['_pmAllocateAcrossContracts'])._pmAllocateAcrossContracts;

  const rows = [
    { id: 'a', remaining: 50000 },
    { id: 'b', remaining: 30000 },
    { id: 'c', remaining: 20000 },
  ];
  const ids = ['a', 'b', 'c'];
  const sum = (legs) => legs.reduce((s, l) => s + l.amount, 0);

  test('split is pro-rata by what each job still owes', () => {
    const legs = mkPM(rows)(ids, 10000);
    eq(legs[0].amount, 5000, 'job a (50% of the remaining work)');
    eq(legs[1].amount, 3000, 'job b');
    eq(legs[2].amount, 2000, 'job c');
  });

  test('the legs re-add to the amount entered — Spent cannot drift', () => {
    [10000, 13000, 1, 7777.77, 99999.99].forEach((total) => {
      eq(sum(mkPM(rows)(ids, total)), total, 'PM legs for ' + total);
      eq(sum(mkPC(rows)(ids, total)), total, 'PC legs for ' + total);
    });
  });

  test('an awkward amount puts the rounding on the LAST leg, not nowhere', () => {
    const legs = mkPM(rows)(ids, 1);
    eq(legs.length, 3, 'legs');
    eq(sum(legs), 1, 'total');
    ok(legs.every((l) => l.amount >= 0), 'a leg went negative');
  });

  test('all jobs settled falls back to an EVEN split, never a dropped payment', () => {
    const settled = [{ id: 'a', remaining: 0 }, { id: 'b', remaining: 0 }];
    const legs = mkPM(settled)(['a', 'b'], 900);
    eq(legs.length, 2, 'legs');
    eq(sum(legs), 900, 'total');
    eq(legs[0].amount, 450, 'even leg');
  });

  test('an over-drawn job carries no NEGATIVE weight in the split', () => {
    // Weights are clamped at 0: a job already over its cap must not pull a
    // negative share and hand another job more than the payment.
    const over = [{ id: 'a', remaining: -5000 }, { id: 'b', remaining: 10000 }];
    const legs = mkPM(over)(['a', 'b'], 1000);
    eq(sum(legs), 1000, 'total');
    eq(legs[0].amount, 0, 'the over-drawn job takes nothing');
    eq(legs[1].amount, 1000, 'the open job takes it all');
  });

  test('a single tick is ONE leg for the whole amount', () => {
    const legs = mkPM(rows)(['b'], 4200);
    eq(legs.length, 1, 'legs');
    eq(legs[0].amount, 4200, 'amount');
    eq(legs[0].contractId, 'b', 'contract');
  });

  test('nothing ticked, or a zero amount, allocates nothing at all', () => {
    eq(mkPM(rows)([], 5000).length, 0, 'no ticks');
    eq(mkPM(rows)(ids, 0).length, 0, 'zero amount');
  });

  test('PM and PC split the same payment identically', () => {
    const a = mkPM(rows)(ids, 13000).map((l) => l.contractId + ':' + l.amount).join('|');
    const b = mkPC(rows)(ids, 13000).map((l) => l.contractId + ':' + l.amount).join('|');
    eq(a, b, 'the two modules disagree about how one payment splits');
  });

  test('a split leg is saved with its own contractId, never a shared row', () =>
    // The whole point of splitting into legs: _pmContractPaid sums entries by
    // contractId, so a single entry carrying several ids would credit nobody.
    ok(pmSrc.indexOf('contractId: leg.contractId') !== -1,
       'the split stopped stamping each leg with its own contract'));

  test('days are not repeated across split legs', () =>
    ok(pmSrc.indexOf('days: split ? 0 : days') !== -1,
       'a 3-way split is reporting 3x the days worked'));
}


// ════════════════════════════════════════════════════════════════════
console.log('\n──────────────────────────────────────');
console.log(passed + ' passed, ' + failed + ' failed');
if (failed) {
  console.log('\nFAILED:');
  failures.forEach(f => console.log('  ✗ ' + f));
  console.log('\nA money rule is broken (or the source was restructured — see marker errors).');
  process.exit(1);
}
console.log('All money rules hold.');
