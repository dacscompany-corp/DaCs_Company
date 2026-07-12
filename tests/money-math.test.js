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

// portal helpers: classifier, money helpers, buildProject, BOQ math
const portal = evalWith(
  slice(portalSrc, 'const LIABILITY_KEYWORDS', 'function mapExpenseDoc', 'portal-app.compiled.js')
  + slice(portalSrc, 'function _isOverheadPay', 'function FoldersGrid', 'portal-app.compiled.js')
  + '\nfunction shortRef(p, id){ return p + "-" + id; }\n',
  { window: undefined },
  ['classifyLabor', 'mapPayrollDoc', '_isOverheadPay', '_projOverhead', '_projSpent',
   '_folderCompletion', '_projEarned', '_projMargin', '_recognisedProfit', '_companyOverhead',
   'buildProject', 'boqGrandTotal', 'boqAccTotal']
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
console.log('\n──────────────────────────────────────');
console.log(passed + ' passed, ' + failed + ' failed');
if (failed) {
  console.log('\nFAILED:');
  failures.forEach(f => console.log('  ✗ ' + f));
  console.log('\nA money rule is broken (or the source was restructured — see marker errors).');
  process.exit(1);
}
console.log('All money rules hold.');
