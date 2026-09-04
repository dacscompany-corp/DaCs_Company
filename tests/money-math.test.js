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
// Sections that drive an async function (the two merge sections) register their
// promise here; the tally at the bottom waits for all of them, so no section can
// report after the totals have already been printed.
const asyncSections = [];

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
    ['lcDrawsDown', 'lcPaid', 'lcStats', 'lcIsOutsource', 'lcWorksList', 'lcIsLumpsum']
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
      // The LIVE lumpsum helper (migration 0062), not a stub: the scope line
      // expands a lumpsum contract into its works, so the sheet must be built
      // with the same code the screen uses.
      lcWorksList: pakyaw([]).lcWorksList,
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



// == M. LUMPSUM CONTRACTS (migration 0062) =========================
// A LUMPSUM contract is ONE capped agreement covering SEVERAL works: the works
// are text lines carried in `works`, and the whole list is paid from a single
// cap by a single payment stream. Francis Febra's five jobs at 200,000 become
// ONE contract at 200,000 that lists five works, so a 23,000 payment is tagged
// ONCE instead of being split five ways.
//
// MONEY: nothing moves. A lumpsum is still one capped contract drawn down by
// payroll rows, so
//
//     Labor = direct + (liability - liabilityIndirect)      <- unchanged
//
// and `works` carries NO pesos — it is a list of names. The invariant these
// tests fence: five jobs totalling 200,000 and one lumpsum of 200,000 must
// produce the IDENTICAL agreed / paid / remaining, or the shape of a contract
// would be changing the money.
//
// It is deliberately NOT a third `category`: a lumpsum is still a labor (or Out
// Source) contract, so every list filter, id lookup and drawdown path keeps
// working untouched. Non-empty `works` IS the discriminator — no second flag to
// drift out of sync.
console.log('\nM. Lumpsum contracts');
{
  const WORKS = ['Plumbing Works', 'Owner Supply', 'Architectural/Interior Finishing Works',
                 'Carpentry Works', 'Civil Works'];
  // The SAME 200,000 agreed with Francis, shaped two ways.
  const asFiveJobs = [
    { id: 'a1', folderId: 'f1', workerName: 'Francis Febra', scope: 'Plumbing Works',  agreedAmount: 45000, payType: 'pakyaw' },
    { id: 'a2', folderId: 'f1', workerName: 'Francis Febra', scope: 'Owner Supply',    agreedAmount: 30000, payType: 'pakyaw' },
    { id: 'a3', folderId: 'f1', workerName: 'Francis Febra', scope: 'Architectural/Interior Finishing Works', agreedAmount: 50000, payType: 'pakyaw' },
    { id: 'a4', folderId: 'f1', workerName: 'Francis Febra', scope: 'Carpentry Works', agreedAmount: 35000, payType: 'pakyaw' },
    { id: 'a5', folderId: 'f1', workerName: 'Francis Febra', scope: 'Civil Works',     agreedAmount: 40000, payType: 'pakyaw' },
  ];
  const asLumpsum = { id: 'L1', folderId: 'f1', workerName: 'Francis Febra',
                      scope: 'General Works Package', agreedAmount: 200000, payType: 'pakyaw',
                      works: WORKS.slice() };

  // 23,000 paid: five tagged rows on the old shape, ONE row on the lumpsum.
  const splitPay = [
    { id: 'p1', contractId: 'a1', totalSalary: 5175 },
    { id: 'p2', contractId: 'a2', totalSalary: 3450 },
    { id: 'p3', contractId: 'a3', totalSalary: 5750 },
    { id: 'p4', contractId: 'a4', totalSalary: 4025 },
    { id: 'p5', contractId: 'a5', totalSalary: 4600 },
  ];
  const onePay = [{ id: 'p1', contractId: 'L1', totalSalary: 23000 }];

  const lump  = pakyaw(onePay);
  const split = pakyaw(splitPay);

  test('a contract carrying works is a lumpsum; a plain job is not', () => {
    ok(lump.lcIsLumpsum(asLumpsum), 'a 5-work contract did not read as lumpsum');
    ok(!lump.lcIsLumpsum(asFiveJobs[0]), 'a plain single job read as lumpsum');
    ok(!lump.lcIsLumpsum({ works: [] }), 'an empty works list is not a lumpsum');
    ok(!lump.lcIsLumpsum(undefined), 'a missing contract is not a lumpsum');
  });

  test('the works list is cleaned: blanks and stray whitespace never survive', () =>
    eq(lump.lcWorksList({ works: ['  Plumbing Works ', '', '   ', 'Civil Works'] }).join('|'),
       'Plumbing Works|Civil Works', 'cleaned works'));

  test('a contract with no works column at all reads as an empty list', () => {
    // Migration 0062 unapplied reads as undefined — the old behaviour must survive.
    eq(lump.lcWorksList({ id: 'x' }).length, 0, 'undefined works');
    eq(lump.lcWorksList({ works: 'Plumbing' }).length, 0, 'a non-array works');
  });

  test('ONE payment draws down the WHOLE lumpsum — no splitting', () => {
    const st = lump.lcStats(asLumpsum);
    eq(st.agreed, 200000, 'agreed');
    eq(st.paid, 23000, 'paid');
    eq(st.remaining, 177000, 'still to pay');
  });

  test('MONEY UNCHANGED: five jobs and one lumpsum give the identical balance', () => {
    const five = asFiveJobs.reduce((a, c) => {
      const s = split.lcStats(c);
      return { agreed: a.agreed + s.agreed, paid: a.paid + s.paid, remaining: a.remaining + s.remaining };
    }, { agreed: 0, paid: 0, remaining: 0 });
    const one = lump.lcStats(asLumpsum);
    eq(one.agreed, five.agreed, 'agreed drifted when the contract was reshaped');
    eq(one.paid, five.paid, 'paid drifted when the contract was reshaped');
    eq(one.remaining, five.remaining, 'remaining drifted when the contract was reshaped');
  });

  test('works carry NO pesos — adding them never moves a balance', () => {
    const bare = { id: 'L1', agreedAmount: 200000 };
    const withWorks = { id: 'L1', agreedAmount: 200000, works: WORKS.slice() };
    eq(lump.lcStats(withWorks).paid, lump.lcStats(bare).paid, 'paid');
    eq(lump.lcStats(withWorks).agreed, lump.lcStats(bare).agreed, 'agreed');
    eq(lump.lcStats(withWorks).remaining, lump.lcStats(bare).remaining, 'remaining');
  });

  test('overhead pay still never draws down a lumpsum cap', () => {
    // Rule 3 must survive the new shape: an indirect row tagged to the lumpsum
    // is Overhead, and Overhead never eats a pakyaw contract.
    const withIndirect = pakyaw(onePay.concat([{ id: 'p9', contractId: 'L1', totalSalary: 9999, laborType: 'indirect' }]));
    eq(withIndirect.lcStats(asLumpsum).paid, 23000, 'indirect pay drew down the lumpsum');
  });

  test('a lumpsum is NOT a third category — it stays a labor contract', () => {
    // If it became `category: 'lumpsum'` every list filter, segment tab and id
    // lookup built on the labor/outsource split would silently drop it.
    ok(!lump.lcIsOutsource(asLumpsum), 'the lumpsum fell out of the labor side');
    ok(lump.lcIsLumpsum({ category: 'outsource', works: WORKS.slice() }),
       'an Out Source lumpsum stopped reading as lumpsum');
  });

  // ── The printed agreement lists the WORKS, not the container ──────
  const lumpFixtures = [asLumpsum];
  const pcL = evalWith(
    slice(expensesSrc, 'function lcWorkerContracts(',
          '// Orientation date as it prints on the manual', 'js/expenses-module.js'),
    {
      lcIsOutsource: (c) => !!c && c.category === 'outsource',
      lcWorksList: lump.lcWorksList,          // the LIVE helper, not a stub
      lcOrientationDateLabel: () => 'September 4, 2026',
      expFolders: [{ id: 'f1', name: 'Los Churreros', code: 'LC-01' }],
      expLaborContracts: lumpFixtures,
    },
    ['lcWorkerContracts', 'lcWorkerAgreementDetails']);

  test('PC: the agreement lists the lumpsum WORKS, numbered — not its title', () =>
    eq(pcL.lcWorkerAgreementDetails(pcL.lcWorkerContracts(asLumpsum)).scope,
       '1) Plumbing Works  2) Owner Supply  3) Architectural/Interior Finishing Works'
       + '  4) Carpentry Works  5) Civil Works', 'lumpsum scope line'));

  test('PC: the agreement amount is the ONE cap, never multiplied by the works', () =>
    eq(pcL.lcWorkerAgreementDetails(pcL.lcWorkerContracts(asLumpsum)).amount,
       '200,000.00', 'lumpsum agreed amount'));

  test('PC: a lumpsum with a single work still prints unnumbered', () =>
    eq(pcL.lcWorkerAgreementDetails([{ scope: 'Package', agreedAmount: 10, works: ['Painting'] }]).scope,
       'Painting', 'single-work scope'));

  const pmL = evalWith(
    slice(pmSrc, 'function _pmWorkerContracts(', 'async function _pmOpenWorkerAgreement(', 'js/pm-admin.js'),
    { _pmActiveProject: { id: 'p1', projectName: 'Los Churreros' }, _pmLaborContracts: lumpFixtures },
    ['_pmWorkerContracts', '_pmWorkerAgreementDetails', '_pmWorksList', '_pmIsLumpsum']);

  test('PM: the same works helper, with the same cleaning rules', () => {
    ok(pmL._pmIsLumpsum(asLumpsum), 'PM did not read the contract as lumpsum');
    ok(!pmL._pmIsLumpsum(asFiveJobs[0]), 'PM read a plain job as lumpsum');
    eq(pmL._pmWorksList({ works: [' A ', '', 'B'] }).join('|'), 'A|B', 'PM cleaned works');
  });

  test('PM: the agreement lists the lumpsum works, numbered', () =>
    eq(pmL._pmWorkerAgreementDetails(pmL._pmWorkerContracts(asLumpsum)).scope,
       '1) Plumbing Works  2) Owner Supply  3) Architectural/Interior Finishing Works'
       + '  4) Carpentry Works  5) Civil Works', 'PM lumpsum scope line'));

  test('PM and PC print the same works line for the same lumpsum', () =>
    eq(pmL._pmWorkerAgreementDetails(pmL._pmWorkerContracts(asLumpsum)).scope,
       pcL.lcWorkerAgreementDetails(pcL.lcWorkerContracts(asLumpsum)).scope,
       'the two modules disagree about what the lumpsum covers'));

  // ── Wiring guards: a works list that cannot round-trip is worse than none ──
  test('`works` is registered as JSON in the shim for BOTH contract tables', () => {
    const shim = read('js/supabase-config.js');
    const lines = shim.split('\n');
    const pcReg = lines.find(l => l.indexOf("laborContracts: { table: 'labor_contracts'") !== -1) || '';
    const pmReg = lines.find(l => l.indexOf("'constructionProjects/laborContracts'") !== -1) || '';
    ok(/json:\s*\[[^\]]*'works'/.test(pcReg), 'Project Control: works is not in the json registry — it will not round-trip');
    ok(/json:\s*\[[^\]]*'works'/.test(pmReg), 'Project Management: works is not in the json registry — it will not round-trip');
  });

  test('a migration adds the `works` column to both contract tables', () => {
    const dir = path.join(ROOT, 'supabase', 'migrations');
    const sql = fs.readdirSync(dir).filter(f => /\.sql$/.test(f))
      .map(f => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n');
    ok(/alter table labor_contracts[\s\S]{0,160}works jsonb/.test(sql),
       'no migration adds labor_contracts.works — the save will fail silently');
    ok(/alter table pm_labor_contracts[\s\S]{0,160}works jsonb/.test(sql),
       'no migration adds pm_labor_contracts.works — the save will fail silently');
  });

  test('both save paths write `works`, on create AND on edit', () => {
    // Four call sites: PC create/edit (expenses-module.js) and PM create/edit
    // (pm-admin.js). Miss one and a lumpsum silently loses its works on save.
    ok((expensesSrc.match(/[,{]\s*works[,\s}]/g) || []).length >= 2,
       'Project Control is not writing works on both create and edit');
    ok((pmSrc.match(/[,{]\s*works[,\s}]/g) || []).length >= 2,
       'Project Management is not writing works on both create and edit');
  });
}


// == N. MERGING JOBS INTO ONE LUMPSUM (migration 0062) ==============
// Collapsing a worker's five contracts into ONE lumpsum rewrites live money
// records, so the ORDER of the three writes is the whole safety property:
//
//   1. update the KEEPER (title, summed cap, works)
//   2. REPOINT the other contracts' payroll rows onto it
//   3. DELETE the now-empty contracts
//
// `payroll.contract_id` is `on delete set null` (migration 0014). Delete before
// repointing and every payment silently unlinks: the worker's paid-to-date drops
// to 0 and the pesos reappear as "Other (uncapped) payments". Doing the keeper
// FIRST is what makes an unapplied migration 0062 abort harmlessly, before any
// payment has moved and before any contract is gone.
//
// MONEY: the merge must be a pure reshape. The new cap is the SUM of the old
// caps and every payroll row survives with only its contract_id changed, so
// agreed / paid / remaining read exactly as they did before.
{
  // Francis Febra as the screen shows him: 5 jobs, 200,000 agreed, 53,000 paid.
  const mkContracts = () => [
    { id: 'a1', folderId: 'f1', workerName: 'Francis Febra', scope: 'Architectural/Interior Finishing Works', agreedAmount: 50000, payType: 'pakyaw' },
    { id: 'a2', folderId: 'f1', workerName: 'Francis Febra', scope: 'Carpentry Works', agreedAmount: 35000, payType: 'pakyaw' },
    { id: 'a3', folderId: 'f1', workerName: 'Francis Febra', scope: 'Civil Works',     agreedAmount: 40000, payType: 'pakyaw' },
    { id: 'a4', folderId: 'f1', workerName: 'Francis Febra', scope: 'Owner Supply',    agreedAmount: 30000, payType: 'pakyaw' },
    { id: 'a5', folderId: 'f1', workerName: 'Francis Febra', scope: 'Plumbing Works',  agreedAmount: 45000, payType: 'pakyaw' },
    // A vendor of the same name, and a second worker: neither may be swept in.
    { id: 'v9', folderId: 'f1', workerName: 'Francis Febra', scope: 'Windows supply & install', agreedAmount: 90000, category: 'outsource' },
    { id: 'z9', folderId: 'f1', workerName: 'Mark Frias',    scope: 'Masonry',         agreedAmount: 10000, payType: 'pakyaw' },
  ];
  const mkPayroll = () => [
    { id: 'p1', contractId: 'a1', totalSalary: 13250 },
    { id: 'p2', contractId: 'a2', totalSalary: 9275 },
    { id: 'p3', contractId: 'a3', totalSalary: 10600 },
    { id: 'p4', contractId: 'a4', totalSalary: 7950 },
    { id: 'p5', contractId: 'a5', totalSalary: 11925 },
    { id: 'p6', contractId: 'v9', totalSalary: 5000 },   // vendor — must NOT move
    { id: 'p7', contractId: 'z9', totalSalary: 2000 },   // Mark   — must NOT move
    { id: 'p8', contractId: null, totalSalary: 500 },    // uncapped — must NOT move
  ];

  // A recording fake of the Firestore-compat shim: every write appends to `log`
  // in the order it was actually issued, which is the thing under test.
  function harness(opts) {
    opts = opts || {};
    const contracts = mkContracts(), payroll = mkPayroll();
    const log = [];
    const db = {
      collection: (name) => ({
        doc: (id) => ({
          update: async (patch) => {
            log.push(name + ':update:' + id);
            if (name === 'laborContracts' && opts.failKeeperUpdate) {
              throw new Error('column "works" of relation "labor_contracts" does not exist');
            }
            const row = (name === 'payroll' ? payroll : contracts).find(x => x.id === id);
            if (row) Object.assign(row, patch);
          },
          delete: async () => {
            log.push(name + ':delete:' + id);
            const i = contracts.findIndex(x => x.id === id);
            // Faithful to migration 0014: `on delete set null` unlinks the rows.
            if (i !== -1) { contracts.splice(i, 1); payroll.forEach(p => { if (p.contractId === id) p.contractId = null; }); }
          },
        }),
      }),
    };
    const merge = evalWith(
      slice(expensesSrc, 'async function lcMergeToLumpsum(', '// Confirm-and-name dialog.', 'js/expenses-module.js'),
      {
        db,
        expLaborContracts: contracts,
        expPayroll: payroll,
        _staff: () => !!opts.staff,
        showDeleteConfirm: async () => opts.confirm !== false,
        showExpNotif: (m, k) => log.push('notif:' + (k || '') + ':' + m),
        formatNum: (n) => String(n),
        firebase: { firestore: { FieldValue: { serverTimestamp: () => 'TS' } } },
        // The LIVE grouping and drawdown helpers, so the merge is tested against
        // the same code the worker card and the agreement are built from.
        lcWorkerContracts: evalWith(
          slice(expensesSrc, 'function lcWorkerContracts(', '// Orientation date as it prints on the manual', 'js/expenses-module.js'),
          { lcIsOutsource: (c) => !!c && c.category === 'outsource',
            lcWorksList: pakyaw([]).lcWorksList,
            lcOrientationDateLabel: () => '', expFolders: [], expLaborContracts: contracts },
          ['lcWorkerContracts']).lcWorkerContracts,
        lcWorksList: pakyaw([]).lcWorksList,
        lcPaid: (cid) => payroll.filter(p => p.contractId === cid)
                                .reduce((s, p) => s + (Number(p.totalSalary) || 0), 0),
      },
      ['lcMergeToLumpsum']);
    return { merge: merge.lcMergeToLumpsum, contracts, payroll, log };
  }

  const paidOf = (payroll, ids) => payroll
    .filter(p => ids.indexOf(p.contractId) !== -1)
    .reduce((s, p) => s + (Number(p.totalSalary) || 0), 0);
  const FIVE = ['a1', 'a2', 'a3', 'a4', 'a5'];

  // Every assertion below needs the merge to have finished, so each test drives
  // its own harness to completion first. The merge swallows its own errors into a
  // notif, so the rejection arm is only a safety net.
  const run = (opts, title) => {
    const h = harness(opts);
    return h.merge('Francis Febra', title || 'General Works Package').then(() => h, () => h);
  };

  const results = {};
  const pending = [
    run().then(r => { results.ok = { h: r }; }),
    run({ failKeeperUpdate: true }).then(r => { results.failed = { h: r }; }),
    run({ confirm: false }).then(r => { results.cancelled = { h: r }; }),
    run({ staff: true }).then(r => { results.staff = { h: r }; }),
  ];

  asyncSections.push(Promise.all(pending).then(() => {
    console.log('\nN. Merging jobs into one lumpsum');
    test('the keeper is written BEFORE any payment moves or contract dies', () => {
      const log = results.ok.h.log.filter(l => l.indexOf('notif:') !== 0);
      const firstDelete = log.findIndex(l => l.indexOf(':delete:') !== -1);
      const firstRepoint = log.findIndex(l => l.indexOf('payroll:update:') === 0);
      eq(log[0].indexOf('laborContracts:update:'), 0, 'first write is not the keeper update');
      ok(firstRepoint !== -1 && firstRepoint < firstDelete,
         'a contract was deleted before its payments were repointed — on delete set null just unlinked them');
    });

    test('every payment of the merged jobs now points at the ONE keeper', () => {
      const { contracts, payroll } = results.ok.h;
      const keeper = contracts.find(c => c.workerName === 'Francis Febra' && c.category !== 'outsource');
      eq(payroll.filter(p => p.contractId === keeper.id).length, 5, 'payments on the lumpsum');
      ok(!payroll.some(p => p.contractId === null && ['p1', 'p2', 'p3', 'p4', 'p5'].indexOf(p.id) !== -1),
         'a payment was left unlinked — its pesos fell out of the contract into "uncapped"');
    });

    test('MONEY UNCHANGED: the same paid total, under one summed cap', () => {
      const { contracts, payroll } = results.ok.h;
      const keeper = contracts.find(c => c.workerName === 'Francis Febra' && c.category !== 'outsource');
      eq(keeper.agreedAmount, 200000, 'the merged cap is not the sum of the five');
      eq(paidOf(payroll, [keeper.id]), 53000, 'paid-to-date moved during the merge');
      eq(keeper.agreedAmount - paidOf(payroll, [keeper.id]), 147000, 'still to pay');
    });

    test('the five jobs become the works list, and the container gets the title', () => {
      const keeper = results.ok.h.contracts.find(c => c.workerName === 'Francis Febra' && c.category !== 'outsource');
      eq((keeper.works || []).join(' | '),
         'Architectural/Interior Finishing Works | Carpentry Works | Civil Works | Owner Supply | Plumbing Works',
         'works list');
      eq(keeper.scope, 'General Works Package', 'contract title');
    });

    test('exactly four contracts are deleted — the vendor and Mark survive', () => {
      const { contracts } = results.ok.h;
      eq(contracts.filter(c => c.workerName === 'Francis Febra' && c.category !== 'outsource').length, 1, 'Francis labor rows');
      ok(contracts.some(c => c.id === 'v9'), 'the vendor subcontract was swallowed by the worker merge');
      ok(contracts.some(c => c.id === 'z9'), 'another worker’s contract was deleted');
    });

    test('the vendor’s and other workers’ payments are never re-tagged', () => {
      const { payroll } = results.ok.h;
      eq(payroll.find(p => p.id === 'p6').contractId, 'v9', 'vendor payment moved');
      eq(payroll.find(p => p.id === 'p7').contractId, 'z9', 'another worker’s payment moved');
      eq(payroll.find(p => p.id === 'p8').contractId, null, 'an uncapped payment was captured');
    });

    test('the cap change is recorded in capHistory, not applied silently', () => {
      const keeper = results.ok.h.contracts.find(c => c.workerName === 'Francis Febra' && c.category !== 'outsource');
      ok((keeper.capHistory || []).some(h => /merged/i.test(h.note || '') && h.amount === 200000),
         'the merge raised a cap from 50,000 to 200,000 and left no trace of it');
    });

    // The load-bearing failure case: migration 0062 unapplied.
    test('a failed keeper write moves NO payment and deletes NO contract', () => {
      const { contracts, payroll, log } = results.failed.h;
      eq(contracts.length, 7, 'contracts were deleted after the merge had already failed');
      eq(paidOf(payroll, FIVE), 53000, 'payments were repointed after the merge had already failed');
      ok(!log.some(l => l.indexOf(':delete:') !== -1), 'a delete ran after the keeper write failed');
      ok(!log.some(l => l.indexOf('payroll:update:') === 0), 'a repoint ran after the keeper write failed');
    });

    test('a failed merge says migration 0062 is missing, and that nothing changed', () => {
      ok(results.failed.h.log.some(l => /0062/.test(l) && /[Nn]othing was changed/.test(l)),
         'the user is not told the merge was a no-op — they may re-run it blind');
    });

    test('the merge dialog is the ONLY confirmation — no second Delete prompt', () => {
      // lcOpenMerge's dialog already states the works, the cap and the deletes.
      // Falling through to showDeleteConfirm as well asked the user twice, the
      // second time under a red "Confirm Delete" heading that misnames a merge.
      ok(/lcMergeToLumpsum\(key, title, true\)/.test(expensesSrc),
         'the merge dialog stopped passing preconfirmed — the user gets a second, mislabelled Delete prompt');
      ok(/if \(!preconfirmed && !await showDeleteConfirm\(msg\)\)/.test(expensesSrc),
         'the preconfirmed guard is gone; either the dialog is bypassed or the double prompt is back');
    });

    test('declining the confirm changes nothing at all', () => {
      const { contracts, payroll, log } = results.cancelled.h;
      eq(contracts.length, 7, 'contracts changed after Cancel');
      eq(paidOf(payroll, FIVE), 53000, 'payments changed after Cancel');
      eq(log.length, 0, 'a write was issued after Cancel');
    });

    test('staff cannot merge — it rewrites caps, which they may not even see', () => {
      eq(results.staff.h.log.length, 0, 'a staff account issued a merge write');
      eq(results.staff.h.contracts.length, 7, 'staff merged contracts');
    });

    // Guard the ordering at the source too: the tests above prove the behaviour,
    // this names the rule so a future edit that reorders the block is caught even
    // if someone stubs the harness differently.
    test('the source still repoints before deleting', () => {
      const src = slice(expensesSrc, 'async function lcMergeToLumpsum(', '// Confirm-and-name dialog.', 'js/expenses-module.js');
      const repoint = src.indexOf("collection('payroll')");
      const del = src.indexOf('.delete()');
      ok(repoint !== -1 && del !== -1 && repoint < del,
         'the delete loop now runs before the repoint loop — on delete set null will unlink every payment');
    });

  }));
}


// == O. PM: MERGING JOBS INTO ONE LUMPSUM (migration 0062) ==========
// The Project Management twin of §N. Same three steps in the same order, but the
// repoint is materially riskier: Project Control re-tags a payment by writing one
// `payroll.contract_id` COLUMN, whereas PM's tag lives inside the
// `weeklyBills.entries[]` JSON blob. Repointing therefore rewrites whole entry
// ARRAYS — and every other field in every entry (amount, days, receipts, type,
// worker) has to survive that rewrite untouched. Losing one is losing real data
// that no foreign key will restore.
//
// PM also has NO foreign key on the tag, so deleting a contract leaves orphaned
// contractIds rather than nulling them. The keeper-first ordering still holds:
// it is the migration-0062 guard, and it keeps a half-finished merge re-runnable.
{
  const mkContracts = () => [
    { id: 'c1', workerName: 'Francis Febra', scope: 'Carpentry Works', agreedAmount: 35000, payType: 'pakyaw' },
    { id: 'c2', workerName: 'Francis Febra', scope: 'Flooring Works',  agreedAmount: 15000, payType: 'pakyaw' },
    { id: 'c3', workerName: 'Francis Febra', scope: 'Metal Works',     agreedAmount: 20000, payType: 'pakyaw' },
    { id: 'c4', workerName: 'Mark Frias',    scope: 'Masonry',         agreedAmount: 10000, payType: 'pakyaw' },
  ];
  // Two bills. Entries carry more than a tag — amounts, days, receipts and type
  // all have to come through the rewrite byte for byte.
  const mkBills = () => [
    { id: 'b1', entries: [
        { id: 'e1', type: 'labor', contractId: 'c1', amount: 4064.52, days: 3, worker: 'Francis Febra', receipts: ['r1.jpg'] },
        { id: 'e2', type: 'labor', contractId: 'c2', amount: 1741.93, days: 1, worker: 'Francis Febra' },
        { id: 'e3', type: 'labor', contractId: 'c4', amount: 2000,    days: 2, worker: 'Mark Frias' },
      ] },
    { id: 'b2', entries: [
        { id: 'e4', type: 'labor', contractId: 'c3', amount: 2322.58, days: 2, worker: 'Francis Febra' },
        { id: 'e5', type: 'material', contractId: null, amount: 900, note: 'cement' },
      ] },
    // Mentions nobody being merged — must not be written at all.
    { id: 'b3', entries: [{ id: 'e6', type: 'labor', contractId: 'c4', amount: 500, days: 1 }] },
  ];

  function harness(opts) {
    opts = opts || {};
    const contracts = mkContracts(), bills = mkBills(), log = [];
    const docFor = (path, id) => ({
      update: async (patch) => {
        log.push(path + ':update:' + id);
        if (path === 'contracts' && opts.failKeeperUpdate) {
          throw new Error('column "works" of relation "pm_labor_contracts" does not exist');
        }
        const row = (path === 'bills' ? bills : contracts).find(x => x.id === id);
        if (row) Object.assign(row, patch);
      },
      delete: async () => {
        log.push(path + ':delete:' + id);
        const i = contracts.findIndex(x => x.id === id);
        if (i !== -1) contracts.splice(i, 1);   // PM has no FK: tags are left orphaned
      },
    });
    const merged = evalWith(
      slice(pmSrc, 'async function _pmMergeToLumpsum(', '// Confirm-and-name dialog.', 'js/pm-admin.js'),
      {
        _pmActiveProject: { id: 'p1' },
        _pmLaborContracts: contracts,
        _pmOutsourceContracts: [],
        _pmWeekBills: bills,
        _pmWorksList: pakyaw([]).lcWorksList,      // identical rules; §M proves the twins agree
        _pmLcCol: () => ({ doc: (id) => docFor('contracts', id) }),
        _pmOcCol: () => ({ doc: (id) => docFor('contracts', id) }),
        _pmToast: (m, e) => log.push('toast:' + (e ? 'err:' : '') + m),
        _pmLoadLaborTab: async () => { log.push('reload'); },
        _pmLoadOutsourceTab: async () => { log.push('reload'); },
        _pmRenderContractsTab: undefined,
        firebase: { firestore: { FieldValue: { serverTimestamp: () => 'TS' } } },
        db: { collection: () => ({ doc: () => ({ collection: () => ({ doc: (id) => docFor('bills', id) }) }) }) },
      },
      ['_pmMergeToLumpsum']);
    return { merge: merged._pmMergeToLumpsum, contracts, bills, log };
  }

  const paidOf = (bills, cid) => bills.reduce((s, b) => s + (b.entries || [])
    .filter(e => e.type === 'labor' && e.contractId === cid)
    .reduce((t, e) => t + (Number(e.amount) || 0), 0), 0);

  const run = (opts) => {
    const h = harness(opts);
    return h.merge('Francis Febra', 'General Works Package', 'labor')
      .then(() => h, () => h);
  };

  asyncSections.push(Promise.all([run(), run({ failKeeperUpdate: true })]).then(([ok_, failed]) => {
    console.log('\nO. PM: merging jobs into one lumpsum');
    test('PM: the keeper is written BEFORE any bill is rewritten or contract dies', () => {
      const w = ok_.log.filter(l => l.indexOf('toast:') !== 0 && l !== 'reload');
      const firstBill = w.findIndex(l => l.indexOf('bills:update:') === 0);
      const firstDel  = w.findIndex(l => l.indexOf(':delete:') !== -1);
      eq(w[0], 'contracts:update:c1', 'first write is not the keeper update');
      ok(firstBill !== -1 && firstBill < firstDel,
         'a contract was deleted before its entries were re-tagged — they would point at a dead id');
    });

    test('PM: every merged entry now carries the keeper’s id', () => {
      const { bills } = ok_;
      const ids = bills.flatMap(b => b.entries.filter(e => e.worker === 'Francis Febra').map(e => e.contractId));
      eq([...new Set(ids)].join(','), 'c1', 'Francis’s entries do not all point at the one contract');
    });

    test('PM MONEY UNCHANGED: the same paid total under one summed cap', () => {
      const keeper = ok_.contracts.find(c => c.id === 'c1');
      eq(keeper.agreedAmount, 70000, 'the merged cap is not the sum of the three');
      eq(paidOf(ok_.bills, 'c1'), 8129.03, 'paid-to-date moved during the merge');
    });

    test('PM: the rewrite preserves every other field of every entry', () => {
      // The whole hazard of a JSON blob: rewriting an array can silently drop
      // fields no column would have protected.
      const e1 = ok_.bills.find(b => b.id === 'b1').entries.find(e => e.id === 'e1');
      eq(e1.amount, 4064.52, 'amount');
      eq(e1.days, 3, 'days');
      eq((e1.receipts || []).join(','), 'r1.jpg', 'receipts were lost in the re-tag');
      eq(e1.type, 'labor', 'type');
      eq(e1.worker, 'Francis Febra', 'worker');
    });

    test('PM: another worker’s entries and the material line are untouched', () => {
      const b1 = ok_.bills.find(b => b.id === 'b1');
      eq(b1.entries.find(e => e.id === 'e3').contractId, 'c4', 'Mark’s entry was re-tagged');
      eq(ok_.bills.find(b => b.id === 'b2').entries.find(e => e.id === 'e5').contractId, null,
         'a material line was captured by a labor merge');
    });

    test('PM: a bill mentioning nobody merged is never written', () =>
      ok(!ok_.log.some(l => l === 'bills:update:b3'),
         'an untouched bill was rewritten — needless writes on a JSON blob risk needless loss'));

    test('PM: exactly the two spare contracts are deleted', () => {
      eq(ok_.contracts.filter(c => c.workerName === 'Francis Febra').length, 1, 'Francis rows');
      ok(ok_.contracts.some(c => c.id === 'c4'), 'another worker’s contract was deleted');
    });

    test('PM: the three jobs become the works list under the given title', () => {
      const keeper = ok_.contracts.find(c => c.id === 'c1');
      eq((keeper.works || []).join(' | '), 'Carpentry Works | Flooring Works | Metal Works', 'works');
      eq(keeper.scope, 'General Works Package', 'title');
    });

    test('PM: a failed keeper write rewrites NO bill and deletes NO contract', () => {
      const { contracts, bills, log } = failed;
      eq(contracts.length, 4, 'contracts were deleted after the merge had already failed');
      eq(paidOf(bills, 'c1'), 4064.52, 'entries were re-tagged after the merge had already failed');
      ok(!log.some(l => l.indexOf('bills:update:') === 0), 'a bill was rewritten after the keeper write failed');
      ok(!log.some(l => l.indexOf(':delete:') !== -1), 'a delete ran after the keeper write failed');
    });

    test('PM: a failed merge names migration 0062 and says nothing changed', () =>
      ok(failed.log.some(l => /0062/.test(l) && /[Nn]othing was changed/.test(l)),
         'the user is not told the merge was a no-op — they may re-run it blind'));

    test('PM: the source still re-tags before deleting', () => {
      const src = slice(pmSrc, 'async function _pmMergeToLumpsum(', '// Confirm-and-name dialog.', 'js/pm-admin.js');
      ok(src.indexOf('bills.doc(b.id).update') < src.indexOf('.delete()'),
         'the delete loop now runs before the re-tag loop — entries would point at a dead contract');
    });

    test('PM: the Merge button passes the worker name as DATA, not as JS source', () => {
      // _esc escapes an apostrophe to &#39;, and the browser decodes entities
      // BEFORE parsing an inline handler — so a name spliced into a quoted
      // argument breaks the button for "O'Brien" and executes for a crafted
      // name. The value must travel in a data attribute and be read back with
      // this.dataset, where it stays data the whole way.
      ok(/data-worker="' \+ _esc\(name\) \+ '"/.test(pmSrc),
         'the worker name is no longer carried in a data attribute');
      ok(/pmOpenMerge\(this\.dataset\.worker,this\.dataset\.seg\)/.test(pmSrc),
         'the merge handler stopped reading the name from dataset');
      ok(!/pmOpenMerge\(\s*'\s*"\s*\+/.test(pmSrc) && pmSrc.indexOf("pmOpenMerge('\" +") === -1,
         'the worker name is being interpolated into the onclick as a JS string again');
    });

    test('PM and PC merges agree: keeper first, repoint, then delete', () => {
      const pc = slice(expensesSrc, 'async function lcMergeToLumpsum(', '// Confirm-and-name dialog.', 'js/expenses-module.js');
      const pm = slice(pmSrc, 'async function _pmMergeToLumpsum(', '// Confirm-and-name dialog.', 'js/pm-admin.js');
      [['PC', pc], ['PM', pm]].forEach(([lbl, src]) => {
        ok(/agreedAmount: total/.test(src), lbl + ': the merged cap is no longer the sum of the caps');
        ok(/works: works/.test(src), lbl + ': the merge stopped writing the works list');
      });
    });

  }));
}


// == P. MATERIAL CATEGORIES FOR A LUMPSUM (migration 0062) =========
// The materials category picker offers one label per labor contract, in the
// format "scope (worker)". Merging a worker's jobs into ONE lumpsum therefore
// collapsed that list: five options like "Plumbing Works (Francis Febra)" became
// the single "General Works Package (Francis Febra)", and a materials cost could
// no longer say which work it belonged to.
//
// So a lumpsum contributes ONE LABEL PER WORK, plus its container for a cost that
// belongs to the package as a whole.
//
// This is LABELLING, not money. A category is free text stamped on the expense
// row — it never tags a contract and never draws anything down, so no label here
// can touch the single cap a lumpsum is paid from. What these tests protect is
// that merging does not quietly delete the choices the user had before, and that
// the two modules keep offering the SAME list.
console.log('\nP. Material categories for a lumpsum');
{
  const WORKS = ['Carpentry Works', 'Flooring Works', 'Metal Works'];
  const lumpsum = { id: 'L1', workerName: 'Francis Febra', scope: 'General Works Package', works: WORKS.slice() };
  const plainJob = { id: 'j1', workerName: 'Mark Frias', scope: 'Masonry' };
  // The wart the screenshot showed: a contract titled with the worker's own name
  // rendered as "Francis Febra (Francis Febra)".
  const selfTitled = { id: 's1', workerName: 'Ana Cruz', scope: 'Ana Cruz' };
  const noScope = { id: 'n1', workerName: 'Jun Diaz', scope: '' };

  const contracts = [lumpsum, plainJob, selfTitled, noScope];

  const pcLabels = evalWith(
    slice(expensesSrc, 'function _expContractLabels', '// The hand-managed `categories` list', 'js/expenses-module.js'),
    { lcLaborOnly: () => contracts, expLaborContracts: contracts, lcWorksList: pakyaw([]).lcWorksList },
    ['_expContractLabels'])._expContractLabels;

  const pmLabels = evalWith(
    // NOTE the end marker: slice() stops BEFORE it, so '\n}\n' would cut the
    // function's own closing brace off. §K can use that form because it only
    // text-searches the result; anything eval'd needs a marker that sits past
    // the end of the function.
    slice(pmSrc, 'function _pmMatCatContractLabels', '\n/**\n * Rebuild the option list', 'js/pm-admin.js'),
    { _pmLaborContracts: contracts, _pmWorksList: pakyaw([]).lcWorksList },
    ['_pmMatCatContractLabels'])._pmMatCatContractLabels;

  test('PC: every work of a lumpsum is its own category', () => {
    const got = pcLabels();
    WORKS.forEach(w => ok(got.indexOf(w + ' (Francis Febra)') !== -1,
      'merging deleted the "' + w + '" category — a materials cost can no longer name that work'));
  });

  test('PC: the container is offered too, for a cost covering the whole package', () =>
    ok(pcLabels().indexOf('General Works Package (Francis Febra)') !== -1, 'container label'));

  test('PC: a plain single job is unchanged', () =>
    ok(pcLabels().indexOf('Masonry (Mark Frias)') !== -1, 'the ordinary contract label moved'));

  test('PC: a contract titled with the worker’s own name says it once', () => {
    const got = pcLabels();
    ok(got.indexOf('Ana Cruz') !== -1, 'the de-duplicated label is missing');
    ok(got.indexOf('Ana Cruz (Ana Cruz)') === -1, 'the doubled label is back');
  });

  test('PC: a contract with no scope still offers the worker', () =>
    ok(pcLabels().indexOf('Jun Diaz') !== -1, 'a scopeless contract vanished from the picker'));

  test('PM offers exactly the same categories as PC', () =>
    eq(pmLabels().join(' | '), pcLabels().join(' | '),
       'the two modules disagree about the material categories for the same contracts'));

  test('merging never REMOVES a category that existed before it', () => {
    // The regression this section exists for: before the merge each job was its
    // own contract and its own label. After the merge every one of those labels
    // must still be on offer.
    const before = [
      { id: 'b1', workerName: 'Francis Febra', scope: 'Carpentry Works' },
      { id: 'b2', workerName: 'Francis Febra', scope: 'Flooring Works' },
      { id: 'b3', workerName: 'Francis Febra', scope: 'Metal Works' },
    ];
    const beforeLabels = evalWith(
      slice(expensesSrc, 'function _expContractLabels', '// The hand-managed `categories` list', 'js/expenses-module.js'),
      { lcLaborOnly: () => before, expLaborContracts: before, lcWorksList: pakyaw([]).lcWorksList },
      ['_expContractLabels'])._expContractLabels();
    const afterLabels = evalWith(
      slice(expensesSrc, 'function _expContractLabels', '// The hand-managed `categories` list', 'js/expenses-module.js'),
      { lcLaborOnly: () => [lumpsum], expLaborContracts: [lumpsum], lcWorksList: pakyaw([]).lcWorksList },
      ['_expContractLabels'])._expContractLabels();
    beforeLabels.forEach(l => ok(afterLabels.indexOf(l) !== -1,
      'the merge dropped the category "' + l + '" that existed before it'));
  });

  test('a lumpsum category is a LABEL — it carries no contract tag', () => {
    // If a category ever started tagging a contract it would draw down a cap.
    // The picker builds plain strings; this fences that it stays that way.
    const src = slice(expensesSrc, 'function _expContractLabels', '// The hand-managed `categories` list', 'js/expenses-module.js');
    ok(src.indexOf('contractId') === -1 && src.indexOf('agreedAmount') === -1,
       'the category builder is reading contract money or ids — categories are free text, not a drawdown');
  });
}

// ════════════════════════════════════════════════════════════════════
// §N above is ASYNC — it drives the merge through a recording fake db — so the
// tally is a function §N calls once its assertions have run. Every other section
// is synchronous and has already reported by then.
function summary() {
  console.log('\n──────────────────────────────────────');
  console.log(passed + ' passed, ' + failed + ' failed');
  if (failed) {
    console.log('\nFAILED:');
    failures.forEach(f => console.log('  ✗ ' + f));
    console.log('\nA money rule is broken (or the source was restructured — see marker errors).');
    process.exit(1);
  }
  console.log('All money rules hold.');
}
// Every synchronous section has already reported by now; wait for the async ones
// before printing the totals, or a failure in them would land after the tally and
// the run would exit 0 on a broken money rule.
Promise.all(asyncSections).then(summary);
