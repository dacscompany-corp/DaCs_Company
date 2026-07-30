// ════════════════════════════════════════════════════════════════════
// CLIENT REIMBURSEMENT TRACKER TESTS — run with:
//     node tests/reimbursement.test.js
//
// Zero dependencies, no framework. The REAL js/reimbursement-module.js is
// loaded (never a copy) against a stub DOM and a stub Firestore-compat shim.
// That works because the module only ever touches .value / .innerHTML /
// .style / .textContent / .onclick / .max on elements, so plain objects are
// enough — no jsdom needed.
//
// The rules under guard (see CLAUDE.md and migration 0041):
//   1. ISOLATION — every save touches EXACTLY the `reimbursements` collection.
//      No invoice, payment request, expense, payroll row or journal entry may
//      ever be written from this module. That isolation *is* the feature; if a
//      test here fails on a stray write, the module stopped being a tracker.
//   2. 'reimbursed' is a LABEL — it only sets status + amount_reimbursed.
//   3. Tracking totals: cancelled records are excluded from Total Advanced,
//      settled/cancelled ones owe nothing, partials owe the remainder.
//   4. Soft-deleted records never appear anywhere.
//   5. Local date keys — PH is UTC+8, so an expense date must never render or
//      compare a day early (the toISOString trap in CLAUDE.md).
//   6. Editing never duplicates, and never silently rewrites status.
//   7. Record text and receipt URLs from the DB are escaped / scheme-checked
//      before they reach innerHTML or an href.
//
// If this file fails with "MODULE SHAPE CHANGED", the module's exported
// window functions were renamed — update the names here, don't delete the test.
// ════════════════════════════════════════════════════════════════════
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'js', 'reimbursement-module.js');

// ── tiny test harness ────────────────────────────────────────────────
let passed = 0, failed = 0;
const failures = [];
function test(name, fn) {
    return Promise.resolve()
        .then(fn)
        .then(() => { passed++; console.log('  ok  ' + name); })
        .catch((e) => {
            failed++; failures.push(name + ' — ' + e.message);
            console.log('  FAIL ' + name + '\n       ' + e.message);
        });
}
function eq(actual, expected, label) {
    if (actual !== expected) {
        throw new Error((label || 'value') + ': expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual));
    }
}
function ok(cond, label) { if (!cond) throw new Error(label || 'expected truthy'); }

// ── stub DOM ─────────────────────────────────────────────────────────
const els = {};
function el(id) {
    if (!els[id]) els[id] = { id, value: '', innerHTML: '', textContent: '', max: '', style: {}, files: [], disabled: false };
    return els[id];
}
global.document = { getElementById: (id) => el(id) };
global.window = global;
global.currentDataUserId = 'owner-uid';
global.auth = { currentUser: { email: 'architect@dacs.ph' } };
global.firebase = { firestore: { FieldValue: { serverTimestamp: () => '<<serverTimestamp>>' } } };
global.lucide = { createIcons: () => {} };
global.URL = { createObjectURL: () => 'blob:stub' };

// ── stub data + shim ─────────────────────────────────────────────────
const ts = (ms) => ({ toMillis: () => ms, toDate: () => new Date(ms) });
const folders = [{ id: 'f1', name: 'Villa Ramos', clientEmail: 'ramos@mail.com' }];
const store = [
    { id: 'r1', refNo: 'RB-2026-0001', folderId: 'f1', projectName: 'Villa Ramos',
      clientName: 'Mr. Ramos', clientEmail: 'ramos@mail.com', paidByName: 'Arch. Dela Cruz',
      paidBy: 'architect@dacs.ph', expenseCategory: 'Permits & Government Fees',
      description: 'Building permit fee', amount: 12500, amountReimbursed: 0,
      expenseDate: '2026-07-02', status: 'pending', history: [], createdAt: ts(1000) },
    { id: 'r2', refNo: 'RB-2026-0002', folderId: 'f1', projectName: 'Villa Ramos',
      clientName: 'Mr. Ramos', clientEmail: 'ramos@mail.com', expenseCategory: 'Materials',
      description: 'Emergency cement delivery', amount: 8000, amountReimbursed: 3000,
      expenseDate: '2026-07-20', status: 'partially_reimbursed', history: [], createdAt: ts(2000) },
    { id: 'r3', refNo: 'RB-2026-0003', folderId: 'f1', expenseCategory: 'Printing & Documents',
      description: 'Blueprint printing', amount: 1500, amountReimbursed: 1500,
      expenseDate: '2026-06-11', status: 'reimbursed', history: [], createdAt: ts(3000) },
    { id: 'r4', refNo: 'RB-2026-0004', folderId: 'f1', expenseCategory: 'Materials',
      description: 'Cancelled advance', amount: 999, amountReimbursed: 0,
      expenseDate: '2026-07-25', status: 'cancelled', history: [], createdAt: ts(4000) },
    { id: 'r5', deletedAt: '2026-07-01', refNo: 'RB-2026-0009', folderId: 'f1',
      description: 'soft-deleted advance', amount: 50000, status: 'pending', createdAt: ts(5000) },
];
// EVERY write the module attempts, whatever the collection — rule 1 is checked
// by asserting nothing but `reimbursements` ever shows up here.
const writes = [];
const snap = (rows) => ({ docs: rows.map(r => ({ id: r.id, data: () => r })) });
let _emit = null;
const emit = () => _emit && _emit(snap(store));

global.db = {
    collection(name) {
        return {
            where() { return this; },
            get: async () => (name === 'folders' ? snap(folders) : snap(store)),
            onSnapshot(cb) { if (name === 'reimbursements') _emit = cb; cb(snap(store)); return () => {}; },
            doc(id) { return { update: async (data) => { writes.push({ op: 'update', name, id, data }); } }; },
            add: async (data) => { writes.push({ op: 'add', name, data }); return { id: 'created' }; },
        };
    },
};
global.storage = { ref: () => ({ put: async () => {}, getDownloadURL: async () => 'https://uploads/r.jpg' }) };

// Load the live module.
eval(fs.readFileSync(SRC, 'utf8'));

['initReimbursementModule', 'rbOpenForm', 'rbSaveForm', 'rbOpenStatus', 'rbConfirmStatus',
 'rbOpenDetail', 'rbOnStatusFilter', 'rbOnSearch', 'rbOnFromFilter', 'rbOnToFilter',
 'rbClearFilters', 'rbOnFolderChange'].forEach((f) => {
    if (typeof global[f] !== 'function') {
        console.error('MODULE SHAPE CHANGED: js/reimbursement-module.js no longer exports window.' + f
            + ' — update tests/reimbursement.test.js, do not delete the test.');
        process.exit(1);
    }
});

// Fill the create form with a valid record.
function fillForm(over) {
    const v = Object.assign({
        rbEditingId: '', rbFolderId: 'f1', rbClientName: 'Mr. Ramos', rbClientEmail: 'ramos@mail.com',
        rbPaidByName: 'Arch. Dela Cruz', rbPaidBy: 'architect@dacs.ph',
        rbExpenseCategory: 'Transportation & Delivery', rbDescription: 'Hauling of tiles',
        rbAmount: '4,250.50', rbExpenseDate: '2026-07-28', rbNotes: '', rbReceiptUrl: '', rbReceiptName: '',
    }, over || {});
    Object.keys(v).forEach((k) => { el(k).value = v[k]; });
}
const onlyReimbursements = () => writes.every((w) => w.name === 'reimbursements');

// ════════════════════════════════════════════════════════════════════
(async () => {

    console.log('\nA. List, totals and soft delete');
    initReimbursementModule();
    await new Promise((r) => setImmediate(r));       // let the folder fetch settle

    await test('records render, soft-deleted ones never do', () => {
        const b = els.rbTableBody.innerHTML;
        ok(b.includes('RB-2026-0001'), 'live record missing');
        ok(!b.includes('soft-deleted advance'), 'a deletedAt record leaked into the list');
    });
    await test('Total Advanced excludes cancelled records', () => {
        eq(els.rbKpiAdvanced.innerHTML, '₱22,000.00');     // 12500 + 8000 + 1500
    });
    await test('Awaiting Reimbursement = unpaid + the partial remainder', () => {
        eq(els.rbKpiOutstanding.innerHTML, '₱17,500.00');  // 12500 + (8000 − 3000)
    });
    await test('Reimbursed total counts partial payments and settled records', () => {
        eq(els.rbKpiBack.innerHTML, '₱4,500.00');          // 3000 + 1500
    });
    await test('newest record first', () => {
        const b = els.rbTableBody.innerHTML;
        ok(b.indexOf('RB-2026-0004') < b.indexOf('RB-2026-0001'), 'not sorted by createdAt desc');
    });
    await test('a partial record shows what came back and what is left', () => {
        ok(els.rbTableBody.innerHTML.includes('₱3,000.00 back · ₱5,000.00 left'), 'partial split missing');
    });
    await test('PH dates: 2026-07-02 renders as Jul 2, never Jul 1 (UTC+8 trap)', () => {
        ok(els.rbTableBody.innerHTML.includes('Jul 2, 2026'), 'expense date shifted a day');
    });

    console.log('\nB. Search and filters');
    await test('status filter narrows the list', () => {
        rbOnStatusFilter('reimbursed');
        const b = els.rbTableBody.innerHTML;
        ok(b.includes('RB-2026-0003') && !b.includes('RB-2026-0001'), 'status filter ignored');
        rbOnStatusFilter('');
    });
    await test('keyword search matches the description', () => {
        rbOnSearch('cement');
        const b = els.rbTableBody.innerHTML;
        ok(b.includes('RB-2026-0002') && !b.includes('RB-2026-0001'), 'search ignored');
        rbOnSearch('');
    });
    await test('date range filters on the expense date', () => {
        rbOnFromFilter('2026-07-01'); rbOnToFilter('2026-07-15');
        const b = els.rbTableBody.innerHTML;
        ok(b.includes('RB-2026-0001') && !b.includes('RB-2026-0003'), 'date range ignored');
        rbClearFilters();
        eq(els.rbKpiCount.innerHTML, '4', 'clearing filters did not restore the full set');
    });

    console.log('\nC. Create — and the isolation rule');
    await test('reference continues the year sequence', async () => {
        await rbOpenForm();
        eq(els.rbFormRef.innerHTML, 'RB-2026-0005');
    });
    await test('project picker is populated before the form opens', async () => {
        await rbOpenForm();
        ok(els.rbFolderId.innerHTML.includes('Villa Ramos'), 'empty project dropdown');
    });
    await test('picking a project pre-fills the folder client', async () => {
        await rbOpenForm();
        el('rbClientEmail').value = '';
        rbOnFolderChange('f1');
        eq(els.rbClientEmail.value, 'ramos@mail.com');
    });
    await test('incomplete form writes nothing', async () => {
        writes.length = 0;
        fillForm({ rbFolderId: '' });        await rbSaveForm();
        fillForm({ rbDescription: '' });     await rbSaveForm();
        fillForm({ rbAmount: '0' });         await rbSaveForm();
        fillForm({ rbExpenseDate: '2099-01-01' }); await rbSaveForm();   // future
        eq(writes.length, 0, 'a rejected form still wrote to the database');
    });
    await test('create writes ONE row, and only to `reimbursements` (isolation)', async () => {
        writes.length = 0;
        fillForm();
        await rbSaveForm();
        eq(writes.length, 1, 'expected exactly one write, got ' + JSON.stringify(writes.map((w) => w.op + ':' + w.name)));
        ok(onlyReimbursements(), 'the module wrote outside `reimbursements` — it is no longer a tracker');
        eq(writes[0].op, 'add');
    });
    await test('a new record starts Pending, with nothing reimbursed', () => {
        const d = writes[0].data;
        eq(d.status, 'pending');
        eq(d.amountReimbursed, 0);
        ok(Array.isArray(d.history) && d.history.length === 1, 'history not seeded');
    });
    await test('comma-formatted amounts are parsed, project name snapshotted', () => {
        eq(writes[0].data.amount, 4250.5);
        eq(writes[0].data.projectName, 'Villa Ramos');
        eq(writes[0].data.refNo, 'RB-2026-0005');
    });

    console.log('\nD. Status is a label, not a transaction');
    await test('marking Reimbursed sets the label + full amount, and writes nothing else', async () => {
        writes.length = 0;
        rbOpenStatus('r1');
        el('rbStatusNew').value = 'reimbursed';
        el('rbStatusRemark').value = 'Paid via bank transfer';
        await rbConfirmStatus();
        eq(writes.length, 1, 'a status change must not create a second record (invoice / payment / expense)');
        ok(onlyReimbursements(), 'status change wrote outside `reimbursements`');
        const d = writes[0].data;
        eq(d.status, 'reimbursed');
        eq(d.amountReimbursed, 12500, 'full amount not marked paid back');
        // Only tracking fields may move.
        const touched = Object.keys(d).sort().join(',');
        eq(touched, 'amountReimbursed,history,remarks,status,updatedAt', 'unexpected fields written');
    });
    await test('the transition and its remark land in the history', () => {
        const h = writes[0].data.history;
        eq(h.length, 1);
        ok(/Pending → Reimbursed/.test(h[0].note), 'transition not recorded: ' + h[0].note);
        ok(/bank transfer/.test(h[0].note), 'remark not recorded');
        eq(writes[0].data.remarks, 'Paid via bank transfer');
    });
    await test('a "partial" equal to the full amount is rejected', async () => {
        writes.length = 0;
        rbOpenStatus('r1');
        el('rbStatusNew').value = 'partially_reimbursed';
        el('rbStatusPaid').value = '12500';
        await rbConfirmStatus();
        eq(writes.length, 0, 'full amount accepted as a partial');
    });
    await test('a real partial amount is stored', async () => {
        writes.length = 0;
        rbOpenStatus('r1');
        el('rbStatusNew').value = 'partially_reimbursed';
        el('rbStatusPaid').value = '5000';
        await rbConfirmStatus();
        eq(writes[0].data.status, 'partially_reimbursed');
        eq(writes[0].data.amountReimbursed, 5000);
    });
    await test('cancelling resets reimbursed-so-far', async () => {
        writes.length = 0;
        rbOpenStatus('r2');
        el('rbStatusNew').value = 'cancelled';
        el('rbStatusRemark').value = '';
        await rbConfirmStatus();
        eq(writes[0].data.amountReimbursed, 0);
    });

    console.log('\nE. Edit');
    await test('edit updates the same row and never duplicates', async () => {
        writes.length = 0;
        await rbOpenForm('r2');
        eq(els.rbEditingId.value, 'r2', 'edit form did not load the record');
        el('rbAmount').value = '9000';
        await rbSaveForm();
        eq(writes.length, 1);
        eq(writes[0].op, 'update');
        eq(writes[0].id, 'r2');
        ok(onlyReimbursements(), 'edit wrote outside `reimbursements`');
    });
    await test('edit appends an audit entry and never rewrites status', () => {
        const d = writes[0].data;
        ok(d.history.some((h) => /Edited: amount/.test(h.note)), 'no audit entry for the change');
        eq(d.status, undefined, 'edit rewrote status — that belongs to the status dialog');
        eq(d.refNo, undefined, 'edit rewrote the reference');
    });
    await test('editing a record that vanished does not fall through to create', async () => {
        writes.length = 0;
        fillForm({ rbEditingId: 'no-such-id' });
        await rbSaveForm();
        eq(writes.length, 0, 'a stale edit created a duplicate advance');
    });

    console.log('\nF. Detail drawer');
    await test('drawer shows the record with advanced / back / outstanding', () => {
        rbOpenDetail('r2');
        const d = els.rbDetailBody.innerHTML;
        ok(d.includes('RB-2026-0002') && d.includes('Emergency cement delivery'), 'record not shown');
        ok(d.includes('₱8,000.00') && d.includes('₱3,000.00') && d.includes('₱5,000.00'), 'money breakdown missing');
        ok(d.includes('Status history'), 'no status history section');
    });

    console.log('\nG. Untrusted stored values');
    store.push({ id: 'x1', refNo: 'RB-2026-0099', folderId: 'f1',
        description: '<img src=x onerror=alert(1)>', clientName: '"><script>bad()</script>',
        amount: 1, amountReimbursed: 0, expenseDate: '2026-07-10', status: 'pending',
        receiptUrl: 'javascript:alert(1)', receiptName: 'r.jpg', history: [], createdAt: ts(9000) });
    emit();
    await test('record text is escaped in the list', () => {
        const b = els.rbTableBody.innerHTML;
        ok(b.includes('RB-2026-0099'), 'live snapshot did not re-render');
        ok(!b.includes('<img src=x') && b.includes('&lt;img'), 'description not escaped');
        ok(!b.includes('<script>') && b.includes('&lt;script&gt;'), 'client name not escaped');
    });
    await test('a non-http receipt URL never reaches an href', () => {
        rbOpenDetail('x1');
        const d = els.rbDetailBody.innerHTML;
        ok(d.includes('RB-2026-0099'), 'drawer did not open');
        ok(!d.includes('javascript:'), 'javascript: URL rendered');
        ok(d.includes('No receipt attached'), 'unsafe URL should fall back to "none"');
    });

    // ════════════════════════════════════════════════════════════════
    console.log('\n──────────────────────────────────────');
    console.log(passed + ' passed, ' + failed + ' failed');
    if (failed) {
        console.log('\nFAILED:');
        failures.forEach((f) => console.log('  ✗ ' + f));
        console.log('\nA reimbursement-tracker rule is broken. If a write to another collection'
            + '\nappeared, the module is no longer isolated — that is the whole feature.');
        process.exit(1);
    }
    console.log('Reimbursement tracker holds: isolated, label-only, no day-shift.');
})();
