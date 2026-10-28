// ════════════════════════════════════════════════════════════════════
// SPLIT EXPENSES AS ONE ROW:  node tests/expense-split-rows.test.js
//
// Zero dependencies. An expense bigger than one billing period's fund is
// saved as "Item (1/2)", "Item (2/2)" — one row per period. The office reads
// that as one expense, so lists show ONE row (js/expense-split-rows.js).
//   A. the helper groups, sums, strips "(1/2)" and keeps part 1's id/docs;
//   B. the screens use it: Project Control Materials, Recent entries, the
//      Reports table, CSV and print;
//   C. money stays on the raw rows: buildProject and the Spent helpers never
//      see the grouped rows, so each period keeps its own part.
// ════════════════════════════════════════════════════════════════════
'use strict';
const fs = require('fs');
const path = require('path');
const S = require('../js/expense-split-rows.js');
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

let passed = 0, failed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { failed++; failures.push(name + ' — ' + e.message); console.log('  FAIL ' + name + '\n       ' + e.message); }
}
function ok(c, m) { if (!c) throw new Error(m); }
function eq(a, b, m) { if (a !== b) throw new Error((m || '') + ' expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a)); }

const leg = (i, n, amt, pid, extra) => Object.assign({
  id: 'e' + i, expenseName: 'Cement (' + i + '/' + n + ')', amount: amt, projectId: pid,
  splitGroup: 'purchase:P1:1', splitIndex: i, splitTotal: n, quantity: 1,
}, extra || {});

console.log('\nA. Grouping');
test('two parts become one row with the summed amount', () => {
  const out = S.groupSplitRows([leg(1, 2, 5000, 'b1', { poImageUrl: 'po.jpg' }), leg(2, 2, 3000, 'b2')]);
  eq(out.length, 1, 'rows');
  eq(out[0].amount, 8000, 'amount');
  eq(out[0].expenseName, 'Cement', 'name');
  eq(out[0].id, 'e1', 'id is part 1');
  eq(out[0].poImageUrl, 'po.jpg', 'documents from part 1');
  eq(out[0]._parts.length, 2, 'parts');
  eq(out[0]._partial, false, 'complete');
  eq(out[0]._qtyUnknown, true, 'qty unknown');
});
test('parts are ordered by split index, whatever the input order', () => {
  const out = S.groupSplitRows([leg(2, 2, 3000, 'b2'), leg(1, 2, 5000, 'b1')]);
  eq(out[0]._parts.map(p => p.id).join(','), 'e1,e2');
  eq(out[0].id, 'e1');
});
test('ordinary rows pass through untouched and keep their order', () => {
  const a = { id: 'a', expenseName: 'Sand', amount: 100 };
  const b = { id: 'b', expenseName: 'Gravel (bulk)', amount: 200, splitTotal: 1, splitGroup: 'x' };
  const out = S.groupSplitRows([a, leg(1, 2, 5000, 'b1'), b, leg(2, 2, 3000, 'b2')]);
  eq(out.length, 3);
  eq(out[0], a, 'same object');
  eq(out[1].amount, 8000, 'split sits where part 1 was');
  eq(out[2], b, 'splitTotal 1 is not a split');
  eq(b.expenseName, 'Gravel (bulk)', 'names without k/n untouched');
});
test('a view holding only one part says so', () => {
  const out = S.groupSplitRows([leg(2, 2, 3000, 'b2')]);
  eq(out.length, 1);
  eq(out[0]._partial, true);
  eq(out[0].amount, 3000);
});
test('the input rows are not changed (money code may hold them)', () => {
  const rows = [leg(1, 2, 5000, 'b1'), leg(2, 2, 3000, 'b2')];
  S.groupSplitRows(rows);
  eq(rows[0].amount, 5000);
  eq(rows[0].expenseName, 'Cement (1/2)');
  ok(!rows[0]._parts, 'no _parts on the raw row');
});
test("portal rows use 'name'", () => {
  const out = S.groupSplitRows([{ ...leg(1, 2, 5, 'b1'), name: 'Bolts (1/2)' }, { ...leg(2, 2, 5, 'b2'), name: 'Bolts (2/2)' }], 'name');
  eq(out[0].name, 'Bolts');
});
test('two different splits stay apart', () => {
  const out = S.groupSplitRows([leg(1, 2, 5, 'b1'), leg(2, 2, 5, 'b2'),
    { ...leg(1, 2, 7, 'b1'), splitGroup: 'other' }, { ...leg(2, 2, 7, 'b2'), splitGroup: 'other' }]);
  eq(out.length, 2);
  eq(out[0].amount + '/' + out[1].amount, '10/14');
});
test('a part on Cover marks the row as partly Cover', () => {
  const out = S.groupSplitRows([leg(1, 2, 5, 'b1'), leg(2, 2, 5, 'cov', { coverExpense: true })]);
  eq(out[0].coverExpense, true);
});
test('period label joins the parts; a part with no period says so', () => {
  const labels = { b1: 'Billing #1', b2: 'Billing #2' };
  const g = S.groupSplitRows([leg(1, 3, 1, 'b1'), leg(2, 3, 1, 'b2'), leg(3, 3, 1, null)])[0];
  eq(S.periodLabel(g, id => labels[id] || ''), 'Billing #1 + Billing #2 + No billing period');
  eq(S.periodLabel({ projectId: 'b2' }, id => labels[id] || ''), 'Billing #2');
});
test('a part on Cover says so — not the billing period twice (F2, 2B-b pilot)', () => {
  const labels = { b1: 'Billing #1' };
  const g = S.groupSplitRows([leg(1, 2, 200, 'b1'), leg(2, 2, 100, 'b1', { coverExpense: true })])[0];
  eq(S.periodLabel(g, id => labels[id] || ''), 'Billing #1 + Billing #1 (Cover)');
});
test('purchase rows are told apart from older splits', () => {
  ok(S.isPurchaseRow({ purchaseLineId: 'L' }), 'line');
  ok(S.isPurchaseRow({ purchaseChargeId: 'C' }), 'charge');
  ok(!S.isPurchaseRow({ splitGroup: 'x' }), 'older split');
});

console.log('\nB. Screens use it');
const portal = read('js/portal-app.compiled.js');
const expenses = read('js/expenses-module.js');
const admin = read('admin.html');
const fnBody = (src, start, end) => {
  const i = src.indexOf(start); ok(i >= 0, 'not found: ' + start);
  const j = src.indexOf(end, i + start.length); ok(j > i, 'end not found: ' + end);
  return src.slice(i, j);
};
test('admin.html loads the helper before expenses-module.js', () => {
  const h = admin.indexOf('js/expense-split-rows.js'), e = admin.indexOf('js/expenses-module.js');
  ok(h > 0 && h < e, 'order');
});
test('mapExpenseDoc carries the split fields', () => {
  const body = fnBody(portal, 'function mapExpenseDoc', 'function mapMonthlyProject');
  ['splitGroup', 'splitIndex', 'splitTotal', 'purchaseLineId', 'purchaseChargeId'].forEach(k => ok(body.includes(k + ':'), k));
});
test('Materials list groups before filtering, counting and CSV', () => {
  const body = fnBody(portal, 'function MaterialDrill', 'function ItemDetailsModal');
  ok(/expGroupSplitRows\(materialTx, "name"\)/.test(body), 'groups materialTx');
  ok(/let result = displayTx;/.test(body), 'filters the grouped rows');
  ok(/const count = displayTx\.length;/.test(body), 'counts expenses, not parts');
  ok(!/project\.docCounts/.test(body), 'document counts are per expense');
});
test('older splits open the details window instead of editing part 1', () => {
  const body = fnBody(portal, 'function MaterialDrill', 'function ItemDetailsModal');
  eq((body.match(/if \(isOldSplit\(m\)\) \{ setDetailsItem\(m\); return; \}/g) || []).length, 2, 'edit and delete');
  const modal = fnBody(portal, 'function ItemDetailsModal', 'function PaymentTag');
  ok(/openEditExpenseModal\(p\.id\)/.test(modal) && /deleteExpense\(p\.id\)/.test(modal), 'per-part buttons');
  ok(/"Print Receipt"\), !oldSplit &&/.test(modal), 'no whole-row Edit for an older split');
});
test('Recent entries groups materials', () => {
  const body = fnBody(portal, 'function RecentEntries', '\nfunction ');
  ok(/expGroupSplitRows\(materialTx, "name"\)/.test(body));
});
test('Reports table, CSV and print group the expense detail', () => {
  ok(/_expListRows\(model\.expenses\)\.forEach/.test(fnBody(expenses, 'function exportRptTable', '\nfunction ')), 'CSV');
  ok(/_expListRows\(\[\.\.\.model\.expenses\]/.test(fnBody(expenses, 'function _pcReportDetails', '\nfunction ')), 'print');
  ok(/'rptExpDetail', _expListRows\(model\.expenses\)/.test(fnBody(expenses, 'function _rptRenderDetailTables', '\nfunction ')), 'screen');
});

test('Materials rows show "From purchase" and "Office review" tags', () => {
  const body = fnBody(portal, 'function MaterialDrill', 'function ItemDetailsModal');
  ok(/PaymentTag, \{ method: m\.paymentMethod \}\), purchaseTags\(m\)\)/.test(body), 'tags beside the name');
  ok(/"From purchase"/.test(body) && /"Office review"/.test(body), 'both labels');
  ok(/\(m\._parts \|\| \[m\]\)\.some\(\(p\) => window\.expPurNeedsReview\(p\.purchaseLineId\)\)/.test(body), 'review checks every part');
  ok(/addEventListener\("dacs:pur-review-flags"/.test(body), 're-renders when the flags load');
  const loader = fnBody(expenses, 'async function _purLoadReviewFlags', '\n}\n');
  ok(/dispatchEvent\(new Event\('dacs:pur-review-flags'\)\)/.test(loader), 'loader announces the flags');
  ok(/window\.expPurNeedsReview = id =>/.test(expenses), 'flag lookup exposed');
});

console.log('\nC. Money stays on the raw rows');
test('no money function groups rows', () => {
  const money = fnBody(portal, 'const LIABILITY_KEYWORDS', 'function mapExpenseDoc');
  ok(!/expGroupSplitRows|_parts/.test(money), 'buildProject / _projSpent area must not group');
  // In expenses-module.js only the three list renderers may group.
  eq((expenses.match(/_expListRows\(/g) || []).length, 4, 'definition + Reports table, CSV, print');
  eq((expenses.match(/expGroupSplitRows/g) || []).length, 2, 'only inside _expListRows');
});
test('the Materials header total and the period totals still add every part', () => {
  const body = fnBody(portal, 'function MaterialDrill', 'function ItemDetailsModal');
  // A grouped row's amount is the sum of its parts, so the category subtotal
  // over grouped rows equals the subtotal over the raw parts.
  const raw = [leg(1, 2, 5000, 'b1'), leg(2, 2, 3000, 'b2'), { id: 'x', expenseName: 'Sand', amount: 250 }];
  const sum = rows => rows.reduce((s, r) => s + r.amount, 0);
  eq(sum(S.groupSplitRows(raw)), sum(raw));
  // 2C (0105): every amount — except, for staff only, a stock cost move's (its value is the owner's).
  ok(/total = items\.reduce\(\(s, m\) => s \+ _shownAmount\(m\), 0\)/.test(body), 'subtotal sums amounts');
  ok(/const _shownAmount = \(m\) => _hideStockCost\(m\) \? 0 : Number\(m\.amount\) \|\| 0;/.test(portal), 'an owner\'s subtotal is every amount');
  ok(/const _hideStockCost = \(m\) => _staff\(\) && /.test(portal), 'only staff lose a cost move\'s amount');
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) { failures.forEach(f => console.log('  - ' + f)); process.exit(1); }
