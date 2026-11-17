// ════════════════════════════════════════════════════════════════════
// BUDGET OVERVIEW + REPORTS LABELS — node tests/budget-overview-labels.test.js
//
// Financial MVP Phase 1 (spec 2026-11-14 §3.4). Budget Overview's billing
// summary renders into admin.html's hidden legacy block (other code still
// writes to those ids), but what it says must be right if it ever shows:
//   • "Overall Profit"  → Contract value minus costs (full Project Control Spent)
//   • period "P&L"      → Fund balance: Fund Allocated − cost CHARGED to that
//                         billing, matched by period id (never by month/number)
//   • "Profitable"      → Contract less allocated funds (never profit)
//   • total             → Total Allocation Remaining
// and the Reports KPI names its basis: All Time vs costs by date.
// Runs the REAL functions lifted from js/expenses-module.js.
// ════════════════════════════════════════════════════════════════════
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const PF = require('../js/project-finance.js');

const EXP = fs.readFileSync(path.join(__dirname, '..', 'js', 'expenses-module.js'), 'utf8');
function lift(name) {
  const i = EXP.indexOf('function ' + name + '(');
  if (i === -1) throw new Error('SLICE NOT FOUND: function ' + name + ' in js/expenses-module.js');
  // A top-level function ends at its own column-0 closing brace.
  const j = EXP.indexOf('\n}\n', i);
  if (j === -1) throw new Error('SLICE NOT FOUND: end of function ' + name);
  return EXP.slice(i, j + 3);
}
let passed = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); passed++; };

// ── source fence: no profit wording survives for a contract or fund balance ──
for (const old of ["'Profitable'", 'Overall Profit', "'Overall ' + plTitle", 'Receivable Balance', "'Funds Available'",
  'Unbilled contract value', '_bsSpentForPeriod']) {
  ok(!EXP.includes(old), 'expenses-module.js still contains ' + old);
}

// ── the hidden billing summary, on the frozen 12 Nov Sample snapshot ──
const fx = require('./fixtures/sample-residence-2026-11-12.json');
function summary(overheadRows) {
  const els = { expBsStats: { innerHTML: '' }, expBillingSummaryList: { innerHTML: '' }, expBsTotalBlock: { innerHTML: '' } };
  const ctx = vm.createContext({ ...PF, Map, Set, Math, Number, String, Array,
    document: { getElementById: id => els[id] || null },
    expCurrentFolder: { id: fx.folder.id, name: fx.folder.name, totalBudget: fx.folder.totalBudget },
    expCurrentProject: null, expFolders: [], lucide: undefined,
    expExpenses: fx.expenses, expPayroll: fx.payroll, _rptOvhdRows: overheadRows });
  vm.runInContext(lift('formatNum') + lift('_mvpEsc') + lift('_updateBillingSummary'), ctx);
  ctx._updateBillingSummary(fx.periods);
  const strip = h => h.replace(/<[^>]+>/g, ' ').replace(/&#8369;/g, '₱').replace(/&#9888;/g, '⚠').replace(/\s+/g, ' ');
  return { stats: strip(els.expBsStats.innerHTML), list: els.expBillingSummaryList.innerHTML,
    listText: strip(els.expBillingSummaryList.innerHTML), total: strip(els.expBsTotalBlock.innerHTML) };
}
const s = summary(fx.overhead);
ok(/Contract value minus costs/.test(s.stats) && s.stats.includes('2,054,266.77'), 'contract less cost: ' + s.stats);
ok(s.stats.includes('Cost to date') && s.stats.includes('4,545,733.23'), 'cost to date is the full Spent: ' + s.stats);
ok(!/Profit|Loss|P&L|Break-even/.test(s.stats + s.listText + s.total), 'no profit wording: ' + s.stats + s.total);
const entry = id => {
  const i = s.list.indexOf('data-period-id="' + id + '"');
  ok(i !== -1, 'entry for period ' + id);
  return s.list.slice(i, s.list.indexOf('data-period-id=', i + 20) === -1 ? undefined : s.list.indexOf('data-period-id=', i + 20));
};
const sep = entry('00000000-0000-4000-8000-000000000004'), oct = entry('00000000-0000-4000-8000-000000000005');
ok(/Fund balance \+&#8369;879,210\.00/.test(sep) && /September/.test(sep), 'Sep #3 fund balance by period id: ' + sep.slice(0, 600));
ok(/Fund balance -&#8369;91,662\.00/.test(oct) && /October/.test(oct), 'Oct #3 fund balance by period id: ' + oct.slice(0, 600));
ok(/allocated/.test(s.listText) && !/received/i.test(s.listText), 'allocated, never received');
ok(s.listText.includes('⚠ Billing #3 is used by 2 periods (September 2026, October 2026) — check and renumber'), 'duplicate #3 flagged');
ok(/Not charged to a billing period/.test(s.listText) && s.listText.includes('280,095.00'), 'not charged line: ' + s.listText.slice(-300));
ok(/Total Allocation Remaining/.test(s.total) && s.total.includes('1,394,266.77'), 'total: ' + s.total);
// The project reconciliation closes: Σ fund balances − not charged = total (no Cover period here).
// Overhead not loaded yet: Unavailable — never a figure that leaves overhead out.
const u = summary(null);
ok(/Unavailable/.test(u.stats) && /Unavailable/.test(u.total), 'unloaded overhead reads Unavailable');
ok(!/2,054,266\.77|1,394,266\.77|280,095\.00/.test(u.stats + u.listText + u.total), 'no partial figure while overhead is unloaded');

// ── Reports KPI: the dashboard balance is named by its basis ──
function kpis(period) {
  const row = { innerHTML: '', style: {} };
  const ctx = vm.createContext({ ...PF, Set, Number,
    document: { getElementById: id => (id === 'rptKpiRow' ? row : null) },
    _pcIsOwner: () => true, _rptState: { period, folderId: 'f' }, expFolders: [{ id: 'f', totalBudget: 1000 }],
    _pcReportFolderIds: () => new Set(['f']) });
  vm.runInContext(lift('formatNum') + lift('_pcReportMoney') + lift('_pcReportBalanceLabel') + lift('_rptRenderKPIs'), ctx);
  ctx._rptRenderKPIs({ totals: { budget: 900, mats: 100, labor: 200, overhead: 50, totalSpent: 350, remaining: 550, cover: 0 } });
  return row.innerHTML;
}
ok(kpis('annual').includes('Total Allocation Remaining') && kpis('annual').includes('₱550.00'), 'All Time KPI');
ok(kpis('monthly').includes('Allocated less cost (by date)') && !kpis('monthly').includes('Total Allocation Remaining'), 'by-date KPI');

console.log('budget-overview-labels: ' + passed + ' checks passed');
