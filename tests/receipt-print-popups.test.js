// ════════════════════════════════════════════════════════════════════
// RECEIPT PRINT POPUPS (runtime) — run with:  node tests/receipt-print-popups.test.js
// Zero dependencies. Extracts the real printTransactionReceipt and
// printWorkerReceiptSummary from js/expenses-module.js, runs them against
// fakes, and checks the popup ends up with the SIGNED page (or the unsigned
// one if signing fails) — never stuck on "Preparing receipts…".
// If it fails with "SLICE NOT FOUND", update the markers — don't delete it.
// ════════════════════════════════════════════════════════════════════
'use strict';
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'expenses-module.js'), 'utf8');

let pass = 0, fail = 0;
function ok(c, m) { if (c) { pass++; console.log('  ok  ' + m); } else { fail++; console.log('  FAIL  ' + m); } }

function slice(start) {
  const i = src.indexOf(start);
  if (i < 0) throw new Error('SLICE NOT FOUND: ' + start);
  const rest = src.slice(i + start.length);
  const m = rest.search(/\n(?:async function |function |window\.\w+ = )/);
  if (m < 0) throw new Error('SLICE NOT FOUND (end): ' + start);
  return src.slice(i, i + start.length + m);
}
const SRC_T = slice('function printTransactionReceipt(');
const SRC_W = slice('function printWorkerReceiptSummary(');

const PHOTO = 'https://p.supabase.co/storage/v1/object/public/uploads/payrollReceipts/o/2026-10/x.jpg';
const tick = () => new Promise(r => setTimeout(r, 0));

function build(signHtml) {
  const writes = []; let closed = 0;
  const popup = { document: { write: s => writes.push(s), open() {}, close() { closed++; } }, close() { closed++; } };
  const notes = [];
  const rec = { id: 'r1', projectId: 'p1', workerName: 'Juan', expenseName: 'Cement', amount: 100, totalSalary: 500,
    daysWorked: 2, paymentDate: '2026-10-01', dateTime: '2026-10-01T08:00:00', receiptImages: [PHOTO],
    paymentReceiptUrl: PHOTO, category: 'Materials', quantity: 1, notes: '' };
  const win = {
    open: () => popup,
    dacsStatementCSS: () => '', dacsStatementHead: () => 'HEAD', dacsStatementSigns: () => 'SIGNS',
    dacsStatementFoot: () => 'FOOT', dacsStatementPrintScript: () => '', dacsStatementRef: () => 'REF',
    dacsPayMethodLabel: () => 'Cash', dacsPayMethodSplit: () => [],
  };
  const env = {
    expExpenses: [rec], expPayroll: [rec], _pmExp: [], _pmPay: [], expProjects: [{ id: 'p1', name: 'P' }], expFolders: [],
    formatNum: n => String(n), payMethodLabel: () => 'Cash', showExpNotif: (m, t) => notes.push(m),
    _mergePayrollPools: () => [rec], _projLabel: () => 'P', _defaults: {}, window: win,
    DacsReceipts: { signHtml }, document: { createElement: () => ({}), body: {} }, alert: () => {},
    currentUserRole: 'owner', _staff: () => false, firebase: {}, console,
  };
  const names = Object.keys(env);
  const mk = code => new Function(...names, code + '\nreturn { t: typeof printTransactionReceipt === "function" ? printTransactionReceipt : null, w: typeof printWorkerReceiptSummary === "function" ? printWorkerReceiptSummary : null };')(...names.map(n => env[n]));
  const t = mk(SRC_T).t, w = mk(SRC_W).w;
  return { t, w, writes, popup, notes, get closed() { return closed; } };
}
const sign = html => Promise.resolve(html.replace('/object/public/uploads/', '/object/sign/uploads/'));

(async () => {
  const cases = [['printTransactionReceipt(expense)', h => h.t('expense', 'r1')],
                 ['printTransactionReceipt(payroll)', h => h.t('payroll', 'r1')],
                 ['printWorkerReceiptSummary', h => h.w('Juan')]];
  for (const [name, run] of cases) {
    const h = build(sign);
    let err = null;
    try { run(h); } catch (e) { err = e; }
    ok(!err, name + ': no exception' + (err ? ' (' + err.message + ')' : ''));
    await tick(); await tick();
    const last = h.writes[h.writes.length - 1] || '';
    ok(/<!DOCTYPE html/i.test(last) && last.includes('/object/sign/uploads/') && !last.includes('/object/public/uploads/'),
       name + ': popup gets the signed page');
    ok((h.writes[0] || '').includes('Preparing receipts'), name + ': placeholder written first');

    const h2 = build(() => Promise.reject(new Error('sign down')));
    try { run(h2); } catch (_) {}
    await tick(); await tick();
    const last2 = h2.writes[h2.writes.length - 1] || '';
    ok(/<!DOCTYPE html/i.test(last2) && last2.includes('/object/public/uploads/'), name + ': signing failure falls back to the unsigned page');
  }
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
