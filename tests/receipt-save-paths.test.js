// ════════════════════════════════════════════════════════════════════
// RECEIPT SAVE PATHS — run with:  node tests/receipt-save-paths.test.js
// Zero dependencies. Static fences on js/expenses-module.js (spec
// 2026-10-08-receipt-photos-storage-design.md §4.3–4.4):
//   • the four receipt save paths upload files — never base64 in the row;
//   • add-expense / add-payroll save all split rows in ONE insert (addMany)
//     with a submission id, so a retry can't duplicate;
//   • a failure keeps the form (no reset in the catch);
//   • the two print popups sign photo links before writing the window.
// If a check fails with "SLICE NOT FOUND", update the markers — don't delete it.
// ════════════════════════════════════════════════════════════════════
'use strict';
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'expenses-module.js'), 'utf8');

let passed = 0, failed = 0; const failures = [];
function test(name, fn) {
  try { fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { failed++; failures.push(name + ' — ' + e.message); console.log('  FAIL ' + name + '\n       ' + e.message); }
}
function ok(c, l) { if (!c) throw new Error(l || 'expected truthy'); }
function fn(name) {
  const i = src.indexOf(name);
  if (i === -1) throw new Error('SLICE NOT FOUND: ' + name);
  const next = src.slice(i + name.length).search(/\n(async )?function |\nwindow\.[A-Za-z_]+ = /);
  return src.slice(i, next === -1 ? undefined : i + name.length + next);
}

test('no base64 receipt compression is left in the module', () => {
  ok(!src.includes('compressImageToBase64'), 'compressImageToBase64 still present');
});
test('_uploadReceiptFile uploads through DacsReceipts and caches by file', () => {
  const f = fn('async function _uploadReceiptFile(');
  ok(f.includes('DacsReceipts.compressToBlob(') && f.includes('DacsReceipts.uploadReceipt(kind, blob, _uid())'), 'upload helper');
  ok(f.includes('_receiptUploadCache.get(file)') && f.includes('_receiptUploadCache.set(file, url)'), 'retry must reuse the uploaded file');
});
test('_saveRowsOnce: one addMany; a 23505 on the submission index means "already saved"', () => {
  const f = fn('async function _saveRowsOnce(');
  ok(f.includes('.addMany(rows)'), 'must save with addMany');
  ok(f.includes("err.code === '23505'") && f.includes('client_submission'), 'duplicate check');
  ok(f.includes("where('clientSubmissionId', '==', submissionId)"), 'must confirm the earlier rows exist');
});
for (const [name, kind, idVar] of [['async function handleAddExpense(', 'expense', '_expSubmissionId'], ['async function handleAddPayroll(', 'payroll', '_paySubmissionId']]) {
  test(name + ' uploads files, saves once with a submission id, never batches', () => {
    const f = fn(name);
    ok(f.includes("_uploadReceiptFile('" + kind + "'"), 'no file upload');
    ok(!f.includes('db.batch()') && !f.includes('batch.commit()'), 'still writes rows one at a time');
    ok(f.includes("_saveRowsOnce('" + (kind === 'expense' ? 'expenses' : 'payroll') + "', rows, " + idVar + ')'), 'not saved through _saveRowsOnce');
    ok(f.includes('clientSubmissionId: ' + idVar), 'rows lack the submission id');
    ok(f.includes(idVar + ' = null'), 'submission id not cleared after success');
    const c = f.slice(f.lastIndexOf('} catch'));
    ok(!/\.reset\(\)|clearPayReceiptPreview\(\)/.test(c), 'the catch branch must keep the form and its attachments');
  });
}
for (const [name, kind] of [['async function handleEditExpense(', 'expense'], ['async function handleEditPayroll(', 'payroll']]) {
  test(name + ' uploads newly attached photos and no longer swallows a failure', () => {
    const f = fn(name);
    ok(f.includes("_uploadReceiptFile('" + kind + "'"), 'no file upload');
    ok(!/catch \(_\) \{\}/.test(f), 'a photo failure is still swallowed silently');
  });
}
test('closing an add form forgets its submission id (a later entry can never be taken for an earlier lost save)', () => {
  const f = fn('function closeExpModal(');
  ok(f.includes("if (id === 'addExpenseModal') _expSubmissionId = null;"), 'expense id not cleared on close');
  ok(f.includes("if (id === 'addPayrollModal') _paySubmissionId = null;"), 'payroll id not cleared on close');
});
test('the "already saved" branch of add-expense still mirrors to inventory', () => {
  const f = fn('async function handleAddExpense(');
  const a = f.indexOf("if (outcome === 'already')");
  ok(a !== -1 && f.indexOf('_addExpenseToInventory(', a) !== -1 && f.indexOf('_addExpenseToInventory(', a) < f.indexOf('return;', a), 'inventory mirror missing from the already branch');
});
test('both print popups open in the click, then sign photo links before writing', () => {
  for (const name of ['function printWorkerReceiptSummary(', 'function printTransactionReceipt(']) {
    const f = fn(name);
    const open = f.indexOf("window.open('', '_blank'");
    const sign = f.indexOf('DacsReceipts.signHtml(');
    ok(open !== -1 && sign !== -1, name + ' must open a window and call DacsReceipts.signHtml');
    ok(open < sign, name + ': window.open must come before signing (pop-up blockers)');
    ok(!/\bawait\b/.test(f.slice(0, open)), name + ': nothing may be awaited before window.open');
  }
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) { console.log('\nFailures:\n  ' + failures.join('\n  ')); process.exit(1); }
