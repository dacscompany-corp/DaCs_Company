'use strict';
// PM Billing Documents (migration 0116): the Billing Request page, the choice
// the receipt dialog offers, the calls to the server, and what must never call
// them. Loads js/billing-receipts.js and js/pm-billing-docs.js into one sandbox.
// Spec: docs/superpowers/specs/2026-11-18-pm-billing-documents-design.md
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const assert = require('assert');

const ROOT = path.join(__dirname, '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const brSource = read('js/billing-receipts.js');
const source = read('js/pm-billing-docs.js');

function load(win) {
  const ctx = { window: win, console: { error() {}, log() {} }, Date, Number, String, Promise, Math, JSON, Object, Array };
  vm.createContext(ctx);
  vm.runInContext(brSource, ctx);
  vm.runInContext(source, ctx);
  return win;
}
function harness(role = 'owner', respond) {
  const calls = [], alerts = [], opened = [];
  const win = { currentUserRole: role, location: { origin: 'https://example.test' },
    alert: m => alerts.push(m),
    open() { const p = popup(); opened.push(p); return p; },
    sbClient: { rpc: async (name, args) => { calls.push([name, args]); return respond ? respond(name, args, calls) : { data: STATE, error: null }; } } };
  load(win);
  return { win, api: win.PMBillingDocs, calls, alerts, opened };
}
function popup() {
  const p = { closed: false, html: '', closes: 0,
    close() { this.closes++; this.closed = true; },
    document: { open() { p.html = ''; }, write(v) { p.html += v; }, close() {} } };
  return p;
}

// Objects made inside the sandbox have its own prototypes: compare their content.
const same = (a, b, m) => assert.deepStrictEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)), m);

let passed = 0;
const pending = [];
function test(name, fn) { pending.push(async () => { await fn(); passed++; console.log('  ok  ' + name); }); }

const PAYMENTS = [
  { id: 'p1', date: '2026-07-24', reference: null, label: 'Payment received (Jul 24, 2026)', amount: 200000, source: 'self_payment' },
  { id: 'v2', date: '2026-10-02', reference: null, label: 'Payment received (Oct 2, 2026)', amount: 140000.5, source: 'self_payment' },
  { id: 'v1', date: '2026-11-13', reference: 'GC-123', label: 'Payment received (Nov 13, 2026) · Ref. GC-123', amount: 389000, source: 'manual_payment' },
];
const STATE = {
  project: { id: 'pa', name: 'Sample Residence', address: 'Quezon City', client_name: 'Sample Client', client_email: 'client@x.test', budget: 1000000 },
  received_from: 'Sample Client', received_by: 'Cristher Dacome',
  business: { name: "DAC'S Building Design Services", tin: '', address: 'Quezon City' },
  payment_details: { method: 'gcash', gcashNumber: '0917', gcashName: 'Sample Name' },
  payments: PAYMENTS, total_received: 729000.5, receipts: [],
};
const RECEIPT = {
  id: 'r1', project_id: 'pa', payment_id: 'v1', receipt_no: 'AR-202611-004', issued_on: '2026-11-18',
  billing_label: 'Payment received (Nov 13, 2026) · Ref. GC-123', amount: 389000,
  received_from: 'Sample Client', received_by: 'Cristher Dacome', business: STATE.business,
  payment_details: STATE.payment_details, voided_at: null, void_reason: null,
};
const withReceipts = (...receipts) => ({ ...STATE, receipts });
const { api } = harness();
const NOW = new Date(2026, 10, 18, 9, 30);
const page = (state = STATE, extra = {}) => api.requestPageHTML(state, { percent: 10, amount: 100000, preparedBy: 'Ana Cruz', now: NOW, ...extra });

console.log('\nWhich payments are paid');
test('paid amount follows the Total cash receipt rule', () => {
  assert.strictEqual(api.paidAmount({ status: 'verified', amountPaid: 0, paidAmount: 140000.5 }), 140000.5);
  assert.strictEqual(api.paidAmount({ status: 'verified', amountPaid: 0, paidAmount: 0, totalAmount: 9 }), 9);
  assert.strictEqual(api.paidAmount({ status: 'paid', amountPaid: 200000 }), 200000);
  assert.strictEqual(api.paidAmount({ status: 'partial', amountPaid: 5 }), 5);
  assert.strictEqual(api.paidAmount({ status: 'submitted', amountPaid: 7, paidAmount: 7 }), 0);
  assert.strictEqual(api.paidAmount({ status: 'rejected', paidAmount: 30000 }), 0);
  assert.strictEqual(api.isPaidRow({ status: 'verified', amountPaid: 1 }), true);
  assert.strictEqual(api.isPaidRow({ status: 'unpaid', totalAmount: 10000 }), false);
});

console.log('\nWhat pressing a receipt button offers');
test('planFor offers to issue, reopen, or void and re-issue', () => {
  const fresh = api.planFor(STATE, 'v1');
  assert.strictEqual(fresh.kind, 'new');
  assert.strictEqual(fresh.amount, 389000);
  same({ ...fresh.period }, { id: 'v1', label: 'Payment received (Nov 13, 2026) · Ref. GC-123' });
  assert.strictEqual(api.planFor(withReceipts(RECEIPT), 'v1').kind, 'issued');
  assert.strictEqual(api.planFor(withReceipts({ ...RECEIPT, amount: 390000 }), 'v1').kind, 'changed');
  assert.strictEqual(api.planFor(withReceipts({ ...RECEIPT, amount: 388999.99 }), 'v1').kind, 'changed');
  const old = { ...RECEIPT, id: 'r0', voided_at: '2026-11-17', void_reason: 'x' };
  same(api.planFor(withReceipts(old, RECEIPT), 'v1').voided.map(r => r.id), ['r0']);
});
test('a receipt whose payment is no longer paid: changed, nothing to re-issue', () => {
  const plan = api.planFor({ ...STATE, payments: PAYMENTS.filter(p => p.id !== 'v1'), receipts: [RECEIPT] }, 'v1');
  assert.strictEqual(plan.kind, 'changed');
  assert.strictEqual(plan.amount, 0);
  assert.strictEqual(plan.period.label, RECEIPT.billing_label);
  assert.strictEqual(plan.live.id, 'r1');
});
test('not paid and no receipt: nothing to issue', () => {
  assert.strictEqual(api.planFor(STATE, 's1').kind, 'not_paid');
});
test('pressing the receipt button opens the shared dialog with Project Management wording', async () => {
  const h = harness();
  const seen = [];
  h.win.BillingReceipts.openReceiptDialog = (state, plan, ops) => seen.push({ state, plan, ops });
  await h.api.openReceipt('pa', 'v1');
  same(h.calls, [['pmar_state', { p_project: 'pa' }]]);
  assert.strictEqual(seen.length, 1);
  assert.strictEqual(seen[0].plan.kind, 'new');
  assert.strictEqual(seen[0].ops.amountLabel, 'Amount paid');
  assert.strictEqual(seen[0].ops.noAmountText, 'This payment is no longer marked paid, so no new receipt can be issued.');
  assert.strictEqual(seen[0].ops.autoLine(seen[0].plan), 'Payment received (Nov 13, 2026) · Ref. GC-123', 'the Description box starts with the payment line');
});
test('issue and reissue with a typed description use 0118, still never an amount', async () => {
  const h = harness('owner', () => ({ data: RECEIPT, error: null }));
  await h.api.actions.issue(popup(), 'v1', 'Julienne Camba', 'Ana', undefined, 'Full Payment of the Down Payment (Nov 20, 2026)');
  await h.api.actions.reissue(popup(), 'r1', 'Wording', 'Julienne Camba', 'Ana', undefined, 'Down payment');
  same(h.calls, [
    ['pmar_issue_described', { p_payment: 'v1', p_received_from: 'Julienne Camba', p_received_by: 'Ana', p_description: 'Full Payment of the Down Payment (Nov 20, 2026)' }],
    ['pmar_reissue_described', { p_receipt: 'r1', p_reason: 'Wording', p_received_from: 'Julienne Camba', p_received_by: 'Ana', p_description: 'Down payment' }]]);
});
test('a database without 0118 says so', () => {
  assert(/0118/.test(api.refusalText({ code: 'PGRST202', message: 'Could not find the function public.pmar_issue_described' })));
});

console.log('\nThe receipt page');
test("the receipt page is 0114's page, the payment line's date and reference as Payment Details rows", () => {
  const html = harness().win.BillingReceipts.receiptHTML(RECEIPT);
  for (const text of ['ACKNOWLEDGEMENT RECEIPT', 'AR-202611-004', '<td>1</td><td>Payment received</td>',
    '<td>Payment Date</td><td>Nov 13, 2026</td>', '<td>Reference No.</td><td>GC-123</td>', 'Sample Client']) {
    assert(html.includes(text), 'missing: ' + text);
  }
  assert.strictEqual(html.split('₱389,000.00').length - 1, 1, 'the total');
});

console.log('\nThe Billing Request page');
test('the Billing Request page carries the request, every payment and the total', () => {
  const html = page();
  for (const text of ['Billing Request', 'Please release the next billing funds to support continued project work. The breakdown below lists each payment received so far.',
    '10% of Project Budget', '₱100,000.00', 'Total Received', '₱729,000.50', 'Sample Client', 'client@x.test', 'Sample Residence',
    'Quezon City', 'Ana Cruz', 'Ref. GC-123', '₱200,000.00', '₱140,000.50', '₱389,000.00', 'Payments received']) {
    assert(html.includes(text), 'missing: ' + text);
  }
  assert(html.indexOf('Jul 24, 2026') < html.indexOf('Oct 2, 2026') && html.indexOf('Oct 2, 2026') < html.indexOf('Nov 13, 2026'), 'oldest first');
  for (const text of ['₱1,000,000.00', 'Spent', 'spent', 'Cover']) assert(!html.includes(text), 'must not show: ' + text);
});
test('the Billing Request carries a Reference, like Project Control\'s FLD- one', () => {
  const html = page({ ...STATE, project: { ...STATE.project, id: '4f1c9a2e-77b0-4c1d-9e2f-0a1b2c3d4e5f' } });
  assert(/<span>Reference<\/span><span>PM-4F1C9A<\/span>/.test(html), 'Reference PM-4F1C9A');
  assert(html.indexOf('Reference') < html.indexOf('Date issued'), 'Reference above Date issued');
  assert(!page({ ...STATE, project: { ...STATE.project, id: '' } }).includes('Reference'), 'no id, no Reference line');
});
test('the Billing Request prints with no payments yet', () => {
  const html = page({ ...STATE, payments: [], total_received: 0 });
  assert(html.includes('No payments received yet'));
  assert(/Total Received<\/th><td>₱0\.00/.test(html), 'Total Received ₱0.00');
});
test('printing hides the print button', () => {
  assert(/@media print\{[^]*\.toolbar\{display:none\}/.test(page()));
  assert(page().includes('window.print()'));
});
test('the Billing Request page escapes every typed text', () => {
  const html = page({ ...STATE, project: { ...STATE.project, client_name: 'A<b>&"\'', name: "DAC'S <i>" },
    payments: [{ ...PAYMENTS[2], reference: '<script>' }] }, { preparedBy: '<img src=x>' });
  for (const raw of ['A<b>', '<i>', '<script>', '<img src=x>']) assert(!html.includes(raw), 'raw: ' + raw);
  for (const safe of ['A&lt;b&gt;&amp;&quot;&#39;', 'DAC&#39;S &lt;i&gt;', '&lt;script&gt;', '&lt;img src=x&gt;']) assert(html.includes(safe), 'escaped: ' + safe);
});
test('a client with no name falls back to the email; with neither, the box is left out', () => {
  assert(page({ ...STATE, project: { ...STATE.project, client_name: '' } }).includes('client@x.test'));
  assert(!page({ ...STATE, project: { ...STATE.project, client_name: '', client_email: '' } }).includes('Requested from'));
});

console.log('\nThe percentage');
test('over-budget warnings use the spec wording', () => {
  assert.strictEqual(api.requestWarning(1000000, 950000, 100000),
    'This request is over what is left of the Project Budget (₱50,000.00). You can still continue.');
  assert.strictEqual(api.requestWarning(1000000, 1000000, 1),
    'This project has already received its full Project Budget, so this request goes over it. You can still continue.');
  assert.strictEqual(api.requestWarning(1000000, 900000, 100000), '');
});
test('remaining and percentages for the percentage window', () => {
  const BR = harness().win.BillingReceipts;
  same(BR.requestSummary(778000, 389000, 10),
    { receivedPct: '50%', remaining: 389000, remainingPct: '50%', amount: 77800, after: 311200, afterPct: '40%' });
  same(BR.requestSummary(300000, 100000, 0),
    { receivedPct: '33.33%', remaining: 200000, remainingPct: '66.67%', amount: 0, after: 200000, afterPct: '66.67%' });
  same(BR.requestSummary(1000, 1200, 10),
    { receivedPct: '120%', remaining: 0, remainingPct: '0%', amount: 100, after: 0, afterPct: '0%' }, 'over budget never goes below zero');
  assert.strictEqual(BR.requestSummary(0, 5, 10).remainingPct, '', 'no budget, no percentage');
});
test('the PM window shows received and remaining with their share of the Project Budget', () => {
  const BR = harness().win.BillingReceipts;
  const o = { contract: 778000, allocated: 389000, contractLabel: 'Project Budget', allocatedLabel: 'Total received so far', showRemaining: true };
  const top = BR.percentWindowTop(o).replace(/<[^>]+>/g, '');
  for (const s of ['Project Budget: ₱778,000.00', 'Total received so far: ₱389,000.00 (50% of Project Budget)',
                   'Remaining: ₱389,000.00 (50% of Project Budget)']) assert(top.includes(s), 'missing: ' + s);
  assert.strictEqual(BR.percentPreviewText(o, 10),
    'Requested amount: ₱77,800.00. Remaining after this request: ₱311,200.00 (40% of Project Budget)');
});
test("Project Control's percentage window is unchanged", () => {
  const BR = harness().win.BillingReceipts;
  const o = { contract: 6600000, allocated: 5940000 };
  const top = BR.percentWindowTop(o).replace(/<[^>]+>/g, '');
  assert(top.includes('Project Budget (contract): ₱6,600,000.00') && top.includes('Total Allocated so far: ₱5,940,000.00'));
  assert(!top.includes('Remaining') && !top.includes('%'));
  assert.strictEqual(BR.percentPreviewText(o, 10), 'Requested amount: ₱660,000.00');
  assert(!/showRemaining/.test(read('js/portal-app.compiled.js')), 'Project Control never asks for the remaining lines');
});
test('the percentage window says Project Budget and Total received so far', async () => {
  const h = harness();
  const asked = [];
  h.win.BillingReceipts.askRequestPercent = o => asked.push(o);
  await h.api.openBillingRequest('pa');
  assert.strictEqual(asked.length, 1);
  const o = asked[0];
  same([o.projectName, o.contract, o.allocated, o.contractLabel, o.allocatedLabel, o.showRemaining],
    ['Sample Residence', 1000000, 729000.5, 'Project Budget', 'Total received so far', true]);
  assert.strictEqual(o.warning, h.api.requestWarning);
});
test('continuing re-reads the project and prints the page in the window it opened', async () => {
  const h = harness();
  let onContinue;
  h.win.BillingReceipts.askRequestPercent = o => { onContinue = o.onContinue; };
  await h.api.openBillingRequest('pa');
  await onContinue(10, 'Ana Cruz');
  assert.strictEqual(h.opened.length, 1);
  same(h.calls.map(c => c[0]), ['pmar_state', 'pmar_state']);
  assert(h.opened[0].html.includes('₱100,000.00') && h.opened[0].html.includes('Ana Cruz'));
});
test('no Project Budget: message, no window', async () => {
  for (const budget of [null, 0]) {
    const h = harness('owner', () => ({ data: { ...STATE, project: { ...STATE.project, budget } }, error: null }));
    let asked = 0;
    h.win.BillingReceipts.askRequestPercent = () => { asked++; };
    await h.api.openBillingRequest('pa');
    same(h.alerts, ['This project has no Project Budget yet, so a percentage cannot be worked out.']);
    assert.strictEqual(h.opened.length, 0);
    assert.strictEqual(asked, 0);
  }
});
test('a failed fresh read closes the window and prints nothing', async () => {
  const h = harness('owner', (name, args, calls) => calls.length > 1 ? { data: null, error: { message: 'network down' } } : { data: STATE, error: null });
  let onContinue;
  h.win.BillingReceipts.askRequestPercent = o => { onContinue = o.onContinue; };
  await h.api.openBillingRequest('pa');
  await onContinue(10, '');
  assert.strictEqual(h.opened[0].closed, true);
  assert(!h.opened[0].html.includes('<table'));
  same(h.alerts, ['Could not prepare the billing request. Please refresh and try again.']);
});

console.log('\nTalking to the server');
test('refusals read in plain words', () => {
  assert.strictEqual(api.refusalText({ message: 'NOT_PAID' }), 'This payment is not marked paid, so there is nothing to acknowledge.');
  assert.strictEqual(api.refusalText({ message: 'OWNER_ONLY' }), 'Only owner accounts can do this.');
  assert(/already voided/.test(api.refusalText({ message: 'ALREADY_VOID' })));
  for (const e of [{ code: 'PGRST202', message: 'Could not find the function public.pmar_state' }, { message: 'relation "pm_billing_receipts" does not exist' }]) {
    assert.strictEqual(api.refusalText(e), 'Acknowledgement Receipts in Project Management need database update 0116 applied first.');
  }
});
test('issue and reissue call only pmar_ functions with no amount', async () => {
  const h = harness('owner', () => ({ data: RECEIPT, error: null }));
  const p1 = popup(), p2 = popup();
  await h.api.actions.issue(p1, 'v1', 'Sample Client', 'Ana');
  await h.api.actions.reissue(p2, 'r1', 'Amount corrected', 'Sample Client', 'Ana');
  same(h.calls, [
    ['pmar_issue', { p_payment: 'v1', p_received_from: 'Sample Client', p_received_by: 'Ana' }],
    ['pmar_reissue', { p_receipt: 'r1', p_reason: 'Amount corrected', p_received_from: 'Sample Client', p_received_by: 'Ana' }]]);
  assert(h.calls.every(([, args]) => Object.keys(args).every(k => !/amount/i.test(k))));
  assert(p1.html.includes('AR-202611-004') && p2.html.includes('ACKNOWLEDGEMENT RECEIPT'));
});
test('a refusal closes the window and says why', async () => {
  const h = harness('owner', () => ({ data: null, error: { code: 'P0001', message: 'NOT_PAID' } }));
  const p = popup();
  await assert.rejects(h.api.actions.issue(p, 's1', 'A', 'B'), /not marked paid/);
  assert.strictEqual(p.closed, true);
});
test('staff and other roles open nothing', async () => {
  for (const role of ['staff', 'worker', 'client', '', null]) {
    const h = harness(role);
    let asked = 0, dialogs = 0;
    h.win.BillingReceipts.askRequestPercent = () => { asked++; };
    h.win.BillingReceipts.openReceiptDialog = () => { dialogs++; };
    await h.api.openReceipt('pa', 'v1');
    await h.api.openBillingRequest('pa');
    same([h.calls.length, h.opened.length, asked, dialogs], [0, 0, 0, 0], String(role));
  }
});

console.log('\nWhere it stands in the app');
test('only pm-billing-docs.js calls pmar_, and no money file mentions the PM receipts', () => {
  const offenders = fs.readdirSync(path.join(ROOT, 'js')).filter(f => f.endsWith('.js') && f !== 'pm-billing-docs.js')
    .filter(f => /\bpmar_/.test(read('js/' + f)));
  same(offenders, []);
  for (const f of ['portal-app.compiled.js', 'expenses-module.js', 'pm-sharing.js', 'warranty-fund.js', 'cash-advance.js', 'project-finance.js']) {
    assert(!/pm_billing_receipt|pmar_|PMBillingDocs/.test(read('js/' + f)), f);
  }
});
test('the module writes to nothing but its own server functions', () => {
  assert(!/\.collection\(|\.from\(|\.insert\(|\.upsert\(|\.delete\(|\.update\(/.test(source));
});
test("Project Control's dialogs and window keep their wording", () => {
  assert(/amountLabel: 'Fund Allocated'/.test(brSource), 'PC dialogs say Fund Allocated');
  assert(brSource.includes("noAmountText: 'A new receipt can be issued once this billing has Fund Allocated.'"));
  assert(brSource.includes("o.contractLabel || 'Project Budget (contract)'"));
  assert(brSource.includes("o.allocatedLabel || 'Total Allocated so far'"));
});
test('admin.html loads the module right after billing-receipts.js', () => {
  const admin = read('admin.html');
  const at = (re) => { const m = admin.match(re); return m ? m.index : -1; };
  const br = at(/<script src="js\/billing-receipts\.js\?v=\d{8}[a-z]"><\/script>/);
  const pm = at(/<script src="js\/pm-billing-docs\.js\?v=\d{8}[a-z]"><\/script>/);
  assert(br > 0 && pm > br, 'order');
  assert(pm < admin.indexOf('js/pm-admin.js'), 'before pm-admin.js');
});

(async () => {
  for (const run of pending) await run();
  console.log(`\nPM billing documents: ${passed} passed`);
})().catch(error => { console.error(error); process.exitCode = 1; });
