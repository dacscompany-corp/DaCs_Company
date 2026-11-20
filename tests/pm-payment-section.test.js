'use strict';
// Project Management → Money → Payment after 0116: the two document buttons,
// the payment photo, and the Friday payment request gone from the office
// screens. Runs the REAL js/pm-admin.js (tests/helpers/pm-admin-sandbox.js)
// with the real js/pm-billing-docs.js and js/receipt-storage.js beside it.
// Spec: docs/superpowers/specs/2026-11-18-pm-billing-documents-design.md
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const assert = require('assert');
const { loadPmAdmin } = require('./helpers/pm-admin-sandbox.js');

const ROOT = path.join(__dirname, '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const ADMIN = read('admin.html');
const PM_SRC = read('js/pm-admin.js');
const CSS = read('css/pm-admin.css');
const COMPANY = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const UUID = '11111111-2222-4333-8444-555555555555';
const PROJECT = { id: 'pa', projectName: 'Sample Residence', clientName: 'Sample Client', clientEmail: 'client@x.test', budget: 1000000 };

const ROWS = [
  { id: 'v1', status: 'verified', source: 'manual_payment', weekEndingDate: '2026-11-13', amount: 389000, totalAmount: 389000, amountPaid: 389000 },
  { id: 'p1', status: 'paid', source: 'self_payment', weekEndingDate: '2026-07-24', amount: 200000, totalAmount: 200000, amountPaid: 200000 },
  { id: 's1', status: 'submitted', source: 'self_payment', weekEndingDate: '2026-11-14', amount: 50000, totalAmount: 50000, amountPaid: 0 },
  { id: 'r1', status: 'rejected', source: 'self_payment', weekEndingDate: '2026-11-01', amount: 30000, totalAmount: 30000, amountPaid: 0 },
  { id: 'u1', status: 'unpaid', source: 'pm-admin', weekEndingDate: '2026-11-20', amount: 10000, carryover: 0, totalAmount: 10000, amountPaid: 0, strict: true },
];

function setup(role = 'owner', opts = {}) {
  const sb = loadPmAdmin({ role });
  const ctx = sb.ctx;
  const log = { adds: [], updates: [], uploads: [], receipts: [], requests: [], order: [] };
  ctx.crypto = { randomUUID: () => UUID };
  ctx.currentDataUserId = COMPANY;
  ctx.auth = { currentUser: { email: 'admin@dacs.test' } };
  ctx.sbClient = { storage: { from: (bucket) => ({
    upload(p, blob, o) { log.uploads.push([bucket, p, o]); log.order.push('upload'); return Promise.resolve({ error: opts.failUpload ? { message: 'upload down' } : null }); },
    getPublicUrl(p) { return { data: { publicUrl: 'https://proj.supabase.co/storage/v1/object/public/' + bucket + '/' + p } }; },
  }) } };
  const rows = opts.rows || ROWS;
  const query = { where() { return query; }, orderBy() { return query; },
    async get() { return { docs: rows.map(r => ({ id: r.id, data: () => ({ ...r }) })) }; } };
  ctx.db = { collection: () => ({ ...query,
    async add(data) { log.adds.push(data); log.order.push('add'); return { id: 'new' }; },
    doc: (id) => ({ async update(data) { log.updates.push([id, data]); log.order.push('update'); } }) }) };
  vm.runInContext(read('js/receipt-storage.js'), ctx, { filename: 'receipt-storage.js' });
  vm.runInContext(read('js/pm-billing-docs.js'), ctx, { filename: 'pm-billing-docs.js' });
  ctx.DacsReceipts.compressToBlob = async () => ({ jpeg: true });
  ctx.PMBillingDocs.openReceipt = async (projectId, paymentId) => { log.receipts.push([projectId, paymentId]); };
  ctx.PMBillingDocs.openBillingRequest = async (projectId) => { log.requests.push(projectId); };
  sb.run(`_pmActiveProject = ${JSON.stringify(PROJECT)};`);
  const el = (id) => ctx.document.getElementById(id);
  return { sb, ctx, log, el };
}
const flush = () => new Promise(r => setTimeout(r, 0));
const theadOf = (html, tbodyId) => {
  const at = html.indexOf('id="' + tbodyId + '"');
  const head = html.lastIndexOf('<thead>', at);
  return html.slice(head, html.indexOf('</thead>', head)).match(/<th[^>]*>([^<]*)<\/th>/g).map(t => t.replace(/<[^>]+>/g, ''));
};

let passed = 0;
const pending = [];
function test(name, fn) { pending.push(async () => { await fn(); passed++; console.log('  ok  ' + name); }); }

console.log('\nA. The Payment section');
test('the table is Date, Amount, Status, Actions', () => {
  assert.deepStrictEqual(theadOf(ADMIN, 'pm-pay-tbody'), ['Date', 'Amount', 'Status', 'Actions']);
  const { ctx, el } = setup();
  ctx._pmPayRenderTable(ROWS);
  const html = el('pm-pay-tbody').innerHTML;
  for (const s of ['Strict', 'Unstrict', 'Carryover', 'data-pm-action="edit"', 'data-pm-action="toggle-strict"']) assert(!html.includes(s), 'still shows ' + s);
  assert(html.includes('Nov 13, 2026') && html.includes('₱389,000.00'));
});
test('every row has View; owner sees Acknowledgement Receipt only on paid rows', async () => {
  const { ctx, el, log } = setup();
  ctx._pmPayRenderTable(ROWS);
  const html = el('pm-pay-tbody').innerHTML;
  const rowOf = (id) => html.slice(html.indexOf('data-pm-id="' + id + '"'), html.indexOf('</tr>', html.indexOf('data-pm-id="' + id + '"')));
  for (const id of ['v1', 'p1']) assert(rowOf(id).includes('data-pm-action="ack-receipt"'), 'receipt on ' + id);
  for (const id of ['s1', 'r1', 'u1']) assert(!rowOf(id).includes('data-pm-action="ack-receipt"'), 'no receipt on ' + id);
  for (const r of ROWS) assert(rowOf(r.id).includes('data-pm-action="review"'), 'view on ' + r.id);
  assert(rowOf('v1').includes('Acknowledgement Receipt'));
  ctx._pmPayAction('ack-receipt', ROWS[0]);
  await flush();
  assert.deepStrictEqual(log.receipts, [['pa', 'v1']]);
});
test('staff see no document buttons', async () => {
  const staff = setup('staff');
  staff.ctx._pmPayRenderTable(ROWS);
  assert(!staff.el('pm-pay-tbody').innerHTML.includes('ack-receipt'));
  await staff.ctx._pmLoadPayments();
  assert.strictEqual(staff.el('pm-pay-billing-request').style.display, 'none');
  staff.ctx.pmOpenBillingRequest();
  assert.deepStrictEqual(staff.log.requests, []);
  const owner = setup('owner');
  await owner.ctx._pmLoadPayments();
  assert.strictEqual(owner.el('pm-pay-billing-request').style.display, '');
  owner.ctx.pmOpenBillingRequest();
  assert.deepStrictEqual(owner.log.requests, ['pa']);
});
test('Total cash receipt uses the shared paid rule', () => {
  const { ctx, el } = setup();
  ctx._pmPayUpdateKPIs(ROWS);
  assert.strictEqual(el('pm-pay-total-paid').textContent, ctx._fmt(ctx.PMShare.paid(ROWS)));
  assert.strictEqual(el('pm-pay-total-paid').textContent, ctx._fmt(589000));
});
test('the Friday payment request is gone from the Payment section', () => {
  for (const s of ['pmPaymentRequestModal', 'pm-pay-banner', 'pm-pay-outstanding', 'pm-pay-next-due', 'pm-pay-strict-count',
                   'Send Payment Request', 'Strict weeks', 'pmOpenPaymentRequestModal']) assert(!ADMIN.includes(s), 'admin.html still has ' + s);
  for (const s of ['pmOpenPaymentRequestModal', 'pmEditPayReq', 'pmSavePaymentRequest', 'pmToggleStrict', 'pm-pay-banner']) {
    assert(!PM_SRC.includes(s), 'pm-admin.js still has ' + s);
  }
  assert(!CSS.includes('.pm-pay-banner'), 'css still styles the banner');
});

console.log('\nB. Add Payment');
test('Add Payment defaults to today and says Payment date', () => {
  const { ctx, el } = setup();
  ctx.pmOpenAddPaymentModal();
  assert.strictEqual(el('pmAddPayDate').value, ctx._pmToday());
  const modal = ADMIN.slice(ADMIN.indexOf('id="pmAddPaymentModal"'), ADMIN.indexOf('id="pmSelfPayReviewModal"'));
  assert(modal.includes('Payment date') && !modal.includes('Payment for week of'));
  assert(modal.includes('id="pmAddPayPhoto"') && modal.includes('accept="image/*"'));
});
function fillPayment(ctx, el, photo) {
  ctx.pmOpenAddPaymentModal();
  el('pmAddPayDate').value = '2026-11-18';
  el('pmAddPayAmount').value = '50000';
  if (photo) ctx.pmAddPayPhotoChanged({ files: [{ name: 'slip.jpg', type: 'image/jpeg', size: 1000 }] });
}
test('Add Payment with a photo uploads to paymentReceipts and saves proofUrl', async () => {
  const { ctx, el, log } = setup();
  fillPayment(ctx, el, true);
  await ctx.pmSaveManualPayment();
  assert.strictEqual(log.uploads.length, 1);
  const [bucket, p, o] = log.uploads[0];
  assert.strictEqual(bucket, 'uploads');
  assert(new RegExp('^paymentReceipts/' + COMPANY + '/\\d{4}-\\d{2}/[0-9a-f-]{36}\\.jpg$').test(p), p);
  assert.deepStrictEqual({ ...o }, { upsert: false, contentType: 'image/jpeg' });
  assert.strictEqual(log.adds.length, 1);
  assert.strictEqual(log.adds[0].proofUrl, 'https://proj.supabase.co/storage/v1/object/public/uploads/' + p);
  assert.strictEqual(log.adds[0].source, 'manual_payment');
  assert.deepStrictEqual(log.order, ['upload', 'add']);
});
test('Add Payment without a photo sends no proofUrl key', async () => {
  const { ctx, el, log } = setup();
  fillPayment(ctx, el, false);
  await ctx.pmSaveManualPayment();
  assert.strictEqual(log.uploads.length, 0);
  assert.strictEqual(log.adds.length, 1);
  assert(!('proofUrl' in log.adds[0]));
});
test('a failed photo upload saves nothing and shows the reason', async () => {
  const { ctx, el, log } = setup('owner', { failUpload: true });
  fillPayment(ctx, el, true);
  el('pmAddPaymentModal').style.display = 'flex';
  await ctx.pmSaveManualPayment();
  assert.strictEqual(log.adds.length, 0);
  assert(/upload down/.test(el('err-pmAddPayPhoto').textContent), el('err-pmAddPayPhoto').textContent);
  assert.strictEqual(el('pmAddPaymentModal').style.display, 'flex');
});
test('removing the chosen photo means none is uploaded', async () => {
  const { ctx, el, log } = setup();
  fillPayment(ctx, el, true);
  ctx.pmAddPayPhotoClear();
  await ctx.pmSaveManualPayment();
  assert.strictEqual(log.uploads.length, 0);
  assert(!('proofUrl' in log.adds[0]));
});

console.log('\nC. View');
test('View shows the office photo first, then the website photo', () => {
  const { ctx, el } = setup();
  ctx.pmReviewSelfPay({ ...ROWS[0], proofUrl: 'https://u/office.jpg', proofBase64: 'data:image/jpeg;base64,AAA' });
  assert.strictEqual(el('pmSelfPayImg').src, 'https://u/office.jpg');
  ctx.pmReviewSelfPay({ ...ROWS[1], proofBase64: 'data:image/jpeg;base64,AAA' });
  assert.strictEqual(el('pmSelfPayImg').src, 'data:image/jpeg;base64,AAA');
});
test('payments recorded by hand get Add photo, then Replace photo; website payments get neither', () => {
  const { ctx, el } = setup();
  ctx.pmReviewSelfPay({ ...ROWS[0] });
  assert.strictEqual(el('pmPayPhotoRow').style.display, '');
  assert.strictEqual(el('pmPayPhotoBtn').textContent, 'Add photo');
  ctx.pmReviewSelfPay({ ...ROWS[0], proofUrl: 'https://u/office.jpg' });
  assert.strictEqual(el('pmPayPhotoBtn').textContent, 'Replace photo');
  ctx.pmReviewSelfPay({ ...ROWS[1] });
  assert.strictEqual(el('pmPayPhotoRow').style.display, 'none');
});
test('replacing a photo changes only the photo', async () => {
  const { ctx, el, log } = setup();
  ctx.pmReviewSelfPay({ ...ROWS[0] });
  await ctx.pmSavePaymentPhoto({ files: [{ name: 'slip.jpg', type: 'image/jpeg', size: 1000 }], value: 'x' });
  assert.strictEqual(log.uploads.length, 1);
  assert.strictEqual(log.updates.length, 1);
  assert.strictEqual(log.updates[0][0], 'v1');
  assert.deepStrictEqual(Object.keys(log.updates[0][1]).sort(), ['proofUrl', 'updatedAt']);
  assert.strictEqual(el('pmSelfPayImg').src, log.updates[0][1].proofUrl);
  assert.strictEqual(el('pmPayPhotoBtn').textContent, 'Replace photo');
});
test('a website payment photo can never be replaced from View', async () => {
  const { ctx, log } = setup();
  ctx.pmReviewSelfPay({ ...ROWS[1] });
  await ctx.pmSavePaymentPhoto({ files: [{ name: 'slip.jpg' }], value: 'x' });
  assert.deepStrictEqual([log.uploads.length, log.updates.length], [0, 0]);
});

console.log('\nD. The Friday request is gone from the project cards and the Overview');
const FRIDAY = { id: 'u1', status: 'unpaid', source: 'pm-admin', weekEndingDate: '2026-11-20', amount: 10000, totalAmount: 10000, amountPaid: 0, strict: true };
const PAID = { id: 'v1', status: 'verified', source: 'manual_payment', weekEndingDate: '2026-11-13', amountPaid: 800000, totalAmount: 800000 };
test('project cards show no This Friday, Balance due or payment badge', async () => {
  const { ctx, el, sb } = setup();
  ctx.db = { collection: () => {
    const q = { where() { return q; }, orderBy() { return q; }, doc() { return q; }, collection() { return q; },
      async get() { return { docs: [{ id: 'u1', data: () => ({ ...FRIDAY }) }, { id: 'v1', data: () => ({ ...PAID }) }], empty: false }; } };
    return q;
  } };
  const active = { id: 'pa', clientName: 'Sample Client', projectName: 'Sample Residence', budget: 1000000, status: 'active' };
  await ctx._pmComputeProjectMetrics(active);
  const closed = { ...active, id: 'pc', status: 'completed', _m: { progressPct: 100 } };
  ctx._pmRenderProjectCards([active, closed]);
  const html = el('pm-cards-grid').innerHTML;
  for (const s of ['This Friday', 'Balance due', 'On track', 'Partial last week', 'Overdue']) assert(!html.includes(s), 'card still shows ' + s);
  assert(html.includes('✓ Completed'), 'closeout badge kept');
  assert.deepStrictEqual(Object.keys(active._m), ['progressPct']);
  assert(sb);
});
test('the Overview has no Next payment due, Outstanding balance or payment pill', () => {
  const { ctx, sb } = setup();
  sb.run(`_pmOvBills = []; _pmOvReqs = ${JSON.stringify([PAID, FRIDAY])}; _pmOvShare = null;`);
  const html = ctx._pmOvHtml(PROJECT, [], [], [PAID, FRIDAY]);
  assert(html.includes('Remaining cash receipt') && html.includes('Project Budget'), 'the cash and budget cards are kept');
  for (const s of ['Next payment due', 'Outstanding balance', 'Send request', 'On track', 'Partial last week', 'STRICT', 'No payment scheduled']) {
    assert(!html.includes(s), 'Overview still shows ' + s);
  }
});
test('no screen sends or edits a Friday request any more', () => {
  assert(!/>\s*Send request\s*</.test(PM_SRC), 'a Send request button remains');
  assert(!/source:\s*'pm-admin'/.test(PM_SRC), 'something still creates pm-admin payment requests');
  for (const s of ['thisFriday', 'balanceDue', 'cadenceBadge', 'cadenceLabel', 'nextDueDate', 'ovNextDue']) assert(!PM_SRC.includes(s), 'pm-admin.js still has ' + s);
});

console.log('\nE. PM Reports: no Outstanding figure (it measured only the Friday request)');
function reportsWith(reqs) {
  const { sb, ctx } = setup();
  sb.run(`_pmRptState.projects = ${JSON.stringify([{ ...PROJECT, status: 'active' }])}; _pmRptState.bills = [];
          _pmRptState.payReqs = ${JSON.stringify(reqs)}; _pmRptState.share = null; _pmRptState.fetchError = false;
          _pmRptState.period = 'annual'; _pmRptState.year = 2026;`);
  return { sb, ctx };
}
test('the Reports screen shows Total Paid and Remaining Cash Receipt, and no Outstanding', () => {
  const { ctx } = reportsWith([{ ...PAID, projectId: 'pa' }, { ...FRIDAY, projectId: 'pa' }]);
  ctx._pmRptRenderKPIs([]);
  const h = ctx.document.getElementById('pmRptKpiRow').innerHTML;
  for (const s of ['Total Paid', '800,000.00', 'Remaining Cash Receipt']) assert(h.includes(s), 'missing: ' + s);
  for (const s of ['Outstanding', 'client still owes']) assert(!h.includes(s), 'Reports still shows ' + s);
  assert(!('outstanding' in ctx._pmRptCashReceipt()), 'cash figures still carry outstanding');
});
test('the Reports printout has no Outstanding either', () => {
  const { sb, ctx } = reportsWith([{ ...PAID, projectId: 'pa' }, { ...FRIDAY, projectId: 'pa' }]);
  ctx.printPMReportsDashboard();
  const h = sb.printed.join('');
  for (const s of ['Total Paid', 'Remaining Cash Receipt']) assert(h.includes(s), 'print missing: ' + s);
  for (const s of ['Outstanding', 'client still owes']) assert(!h.includes(s), 'print still shows ' + s);
});

(async () => {
  for (const run of pending) await run();
  console.log(`\nPM payment section: ${passed} passed`);
})().catch(error => { console.error(error); process.exitCode = 1; });
