'use strict';
// Acknowledgement Receipts (migration 0114): the printed pages, the choice the
// dialog offers, the calls to the server, and what must never call them.
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const assert = require('assert');

const ROOT = path.join(__dirname, '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const source = read('js/billing-receipts.js');

function load(win) {
  const ctx = { window: win, console, Date, Number, String, Promise };
  vm.createContext(ctx);
  vm.runInContext(source, ctx);
  return win.BillingReceipts;
}
const browser = (role = 'owner', extra = {}) => ({ currentUserRole: role, location: { origin: 'https://example.test' }, ...extra });
const api = load(browser());

let passed = 0;
const pending = [];
function test(name, fn) {
  pending.push(async () => { await fn(); passed++; console.log('  ok  ' + name); });
}

const RECEIPT = {
  id: 'r1', period_id: 'p1', folder_id: 'f1', receipt_no: 'AR-202611-001', issued_on: '2026-11-09',
  billing_label: 'Progress Billing 3 (November 2026)', amount: 159000,
  received_from: 'MH Interior and Construction Incorporated', received_by: 'Cristher Dacome',
  business: { name: "DAC'S Building Design Services", tin: '', address: '' },
  payment_details: { method: 'bank', bank: 'Security Bank', accountNo: '0001', accountName: 'Cristher Dacome', branch: '' },
  voided_at: null, void_reason: null
};
const STATE = {
  folder: { id: 'f1', name: 'Tuth Residence', description: 'Quezon City' },
  received_from: 'MH Interior', received_by: 'Cristher Dacome',
  business: { name: "DAC'S Building Design Services", tin: '', address: 'Quezon City' },
  payment_details: { method: 'gcash', gcashNumber: '0917', gcashName: 'Sample Name' },
  periods: [{ id: 'p1', label: 'Progress Billing 3 (November 2026)', amount: 159000 },
            { id: 'p2', label: 'Downpayment (October 2026)', amount: 41000 },
            { id: 'p3', label: 'Progress Billing 4 (December 2026)', amount: 0 }],
  total_received: 200000, receipts: []
};

console.log('\nThe receipt page');
test('it carries everything on the sample', () => {
  const html = api.receiptHTML(RECEIPT);
  for (const text of ['ACKNOWLEDGEMENT RECEIPT', 'AR No.: </span><strong>AR-202611-001', 'Date: </span><strong>Nov 9, 2026',
    'MH Interior and Construction Incorporated', 'Progress Billing 3 (November 2026)', '<th>Description</th>', 'Amount (PHP)',
    'One Hundred Fifty-Nine Thousand Pesos Only', 'Amount in words', 'Payment Details', 'Bank Transfer', 'Security Bank', '0001',
    'Paid by', 'Received by', 'Cristher Dacome', 'not valid as an Official Receipt']) {
    assert(html.includes(text), 'missing: ' + text);
  }
  assert(html.includes('DAC&#39;S Building Design Services'), 'company name');
  assert.strictEqual(html.split('₱159,000.00').length - 1, 1, 'the total');
  assert(!html.includes('class="statement"') && !html.includes('as payment for'), 'no receipt sentence (owner, 22 Nov 2026)');
  assert(html.includes('<td class="num">159,000.00</td>'), 'the item row');
  for (const gone of ['Qty', 'Unit Price', 'Full Payment Amount', 'Item Description']) assert(!html.includes(gone), 'layout C drops: ' + gone);
});
test('layout C: the payment date and reference move out of the automatic line into plain Payment Details rows', () => {
  const html = api.receiptHTML({ ...RECEIPT, billing_label: 'Progress Billing 3 (November 2026) · Payment received (Nov 18, 2026) · Ref. PC-NDBMOB-1',
    paid_on: '2026-11-18', payment_reference: 'PC-NDBMOB-1' });
  assert(html.includes('<td>1</td><td>Progress Billing 3 (November 2026)</td>'), 'the item line is the billing alone');
  assert(html.includes('<tr><td>Payment Date</td><td>Nov 18, 2026</td></tr>'));
  assert(html.includes('<tr><td>Reference No.</td><td>PC-NDBMOB-1</td></tr>'), 'a plain row');
  assert.strictEqual(html.split('PC-NDBMOB-1').length - 1, 1, 'printed once, not highlighted');
  assert(html.indexOf('Payment Date') < html.indexOf('Reference No.') && html.indexOf('Reference No.') < html.indexOf('Payment Via'), 'date, reference, then how it was paid');
});
test('a Project Management line (no billing name, no saved columns) splits the same way', () => {
  const html = api.receiptHTML({ ...RECEIPT, billing_label: 'Payment received (Nov 20, 2026) · Ref. GC-9' });
  assert(html.includes('<td>1</td><td>Payment received</td>'));
  assert(html.includes('<td>Payment Date</td><td>Nov 20, 2026</td>') && html.includes('<td>Reference No.</td><td>GC-9</td>'));
});
test('a line the owner typed differently prints as typed', () => {
  const typed = 'Full Payment of the Down Payment';
  const html = api.receiptHTML({ ...RECEIPT, billing_label: typed, paid_on: '2026-11-20', payment_reference: 'X1' });
  assert(html.includes('<td>1</td><td>' + typed + '</td>'));
  assert(html.includes('<td>Reference No.</td><td>X1</td>'), 'the saved reference still prints');
  const other = api.splitLine('Progress Billing 3 · Payment received (Nov 18, 2026) · Ref. OLD', '2026-11-18', 'NEW');
  assert.strictEqual(other.item, 'Progress Billing 3 · Payment received (Nov 18, 2026) · Ref. OLD', 'a line that disagrees with the saved reference is left whole');
});
test('amounts in words', () => {
  assert.strictEqual(api.pesoWords(169000), 'One Hundred Sixty-Nine Thousand Pesos Only');
  assert.strictEqual(api.pesoWords(1), 'One Peso Only');
  assert.strictEqual(api.pesoWords(50000.5), 'Fifty Thousand Pesos and 50/100 Only');
  assert.strictEqual(api.pesoWords(1234567.08), 'One Million Two Hundred Thirty-Four Thousand Five Hundred Sixty-Seven Pesos and 08/100 Only');
  assert.strictEqual(api.pesoWords(0), 'Zero Pesos Only');
});
const STAMP = 'src="https://example.test/assets/images/dacs-signature.png"';
const stampedAboveName = html => {
  const block = html.indexOf('<div class="sign">');
  const stamp = html.indexOf(STAMP, block);
  const name = html.indexOf('<div class="who">', block);
  return block > 0 && stamp > block && stamp < name;
};
test('DAC\'s e-signature is stamped above the Received by name', () => {
  assert(stampedAboveName(api.receiptHTML(RECEIPT)));
});
test('the Overall Billing Acknowledgement carries the same stamp', () => {
  assert(stampedAboveName(api.overallHTML(STATE, 'MH Interior', 'Cristher Dacome', '2026-11-09')));
});
test('centavos always show', () => {
  assert(api.receiptHTML({ ...RECEIPT, amount: 50000.5 }).includes('₱50,000.50'));
});
test('GCash details print as GCash', () => {
  const html = api.receiptHTML({ ...RECEIPT, payment_details: { method: 'gcash', gcashNumber: '0917', gcashName: 'Ana' } });
  for (const text of ['GCash', 'GCash No.', '0917', 'Ana']) assert(html.includes(text), text);
  assert(!html.includes('Bank Transfer'));
});
test('no saved payment details means no empty payment box', () => {
  assert(!api.receiptHTML({ ...RECEIPT, payment_details: {} }).includes('Payment Details'));
});
test('everything typed is escaped', () => {
  const html = api.receiptHTML({ ...RECEIPT, received_from: '<img src=x onerror=alert(1)>', received_by: '<b>A</b>', billing_label: '<i>L</i>' });
  assert(!html.includes('<img src=x'));
  assert(!html.includes('<b>A</b>'));
  assert(!html.includes('<i>L</i>'));
  assert(html.includes('&lt;img src=x'));
});
test('a bank prints as Payment Via <bank>, Bank Transfer No. and Account Name, with no Branch', () => {
  const html = api.receiptHTML({ ...RECEIPT, payment_details: { method: 'bank', bank: 'BDO', accountNo: '013570037929', accountName: 'Cristher Dacome', branch: 'Cubao' } });
  for (const text of ['<td>Payment Via</td><td>BDO</td>', '<td>Bank Transfer No.</td><td>013570037929</td>', '<td>Account Name</td><td>Cristher Dacome</td>']) {
    assert(html.includes(text), 'missing: ' + text);
  }
  assert(!html.includes('Branch') && !html.includes('Cubao'), 'no branch line');
});
test('company details and signature can be hidden and shown, never printed as controls, and remembered', () => {
  for (const html of [api.receiptHTML(RECEIPT), api.overallHTML(STATE, 'MH', 'Ana', '2026-11-09')]) {
    for (const text of ['id="tglCompany"', 'id="tglSign"', 'Company details', 'Signature', 'class="company-block"',
                        'body.hide-company .company-block{display:none}', 'body.hide-sign .sign{display:none}', "'dacs.receipt.hide'"]) {
      assert(html.includes(text), 'missing: ' + text);
    }
    assert(/@media print\{\.tools\{display:none\}\}/.test(html), 'the switches never print');
    assert(/try\{[^}]*localStorage/.test(html), 'storage is guarded');
  }
});
test('a blank company name falls back to the house name', () => {
  assert(api.receiptHTML({ ...RECEIPT, business: {} }).includes('DAC&#39;S Building Design Services'));
});
test('a live receipt is not marked void; a voided one clearly is, with its reason', () => {
  assert(!/\bVOID\b/.test(api.receiptHTML(RECEIPT)));
  const html = api.receiptHTML({ ...RECEIPT, voided_at: '2026-11-10T00:00:00Z', void_reason: 'Client <added> funds' });
  assert(/\bVOID\b/.test(html));
  assert(html.includes('Client &lt;added&gt; funds'));
});
test('Download PDF saves the page as a file, and printing leaves no browser header or footer', () => {
  for (const html of [api.receiptHTML(RECEIPT), api.overallHTML(STATE, 'MH', 'Ana', '2026-11-09')]) {
    assert(html.includes('id="dlPdf"') && html.includes('Download PDF'), 'the button');
    assert(html.includes('html2pdf.bundle.min.js') && html.includes('html2pdf(page,'), 'saves through html2pdf (its one-call form downloads the file)');
    assert(/@page\{size:A4 portrait;margin:0\}/.test(html), 'a zero page margin leaves the browser no room for its date, title and address');
  }
});
test('the print button never prints', () => {
  assert(/@media print\{[^}]*\.noprint\{display:none/.test(api.receiptHTML(RECEIPT).replace(/\s+/g, '')) || /\.noprint\{display:none/.test(api.receiptHTML(RECEIPT)));
  assert(api.receiptHTML(RECEIPT).includes('window.print()'));
});

console.log('\nThe Overall Billing Acknowledgement page');
const OVERALL = api.overallHTML ? api.overallHTML(STATE, 'MH Interior', 'Cristher Dacome', '2026-11-09') : '';
test('it is headed correctly and ends with the grand total', () => {
  for (const text of ['PROOF OF PAYMENTS', 'MH Interior', 'Two Hundred Thousand Pesos Only', 'Total Received', '₱200,000.00', 'Tuth Residence', 'Received by', 'Cristher Dacome', 'Nov 9, 2026']) {
    assert(OVERALL.includes(text), 'missing: ' + text);
  }
});
test('every client billing that has Fund Allocated is listed with its amount, in layout C\'s table', () => {
  for (const text of ['<th>Description</th>', 'Amount (PHP)',
    'Downpayment (October 2026)', '41,000.00', 'Progress Billing 3 (November 2026)', '159,000.00', 'Total Billings']) {
    assert(OVERALL.includes(text), 'missing: ' + text);
  }
});
test('there is no discount column', () => {
  assert(!OVERALL.includes('Disc.') && !OVERALL.includes('>0%<'));
});
test('the billings run in date order, numbered', () => {
  assert(OVERALL.indexOf('Downpayment (October 2026)') < OVERALL.indexOf('Progress Billing 3 (November 2026)'), 'date order');
  assert(/<td>1<\/td><td>Downpayment \(October 2026\)/.test(OVERALL), 'numbered from 1');
});
test('a billing with no Fund Allocated yet is not listed as received', () => {
  assert(!OVERALL.includes('Progress Billing 4 (December 2026)'));
});
test('on paper the signature, totals and rows never split across pages, and headings stay on one line', () => {
  assert(/@media print\{.*\.sign,\.total,\.pay,tr\{break-inside:avoid\}/.test(OVERALL));
  assert(/th\{[^}]*white-space:nowrap/.test(OVERALL));
});
test('money spent never appears', () => {
  for (const text of ['Spent', 'spent', 'Used', 'Remaining']) assert(!OVERALL.includes(text), 'must not show: ' + text);
});
test('billing names are escaped', () => {
  const html = api.overallHTML({ ...STATE, periods: [{ id: 'x', label: '<i>Odd</i> (May 2026)', amount: 5 }] }, 'A', 'B', '2026-11-09');
  assert(!html.includes('<i>Odd</i>') && html.includes('&lt;i&gt;Odd'));
});
test('it has no AR number, because it is not saved', () => {
  assert(!OVERALL.includes('Acknowledgement No'));
  assert(!OVERALL.includes('AR-'));
});
test('typed text and the project name are escaped', () => {
  const html = api.overallHTML({ ...STATE, folder: { name: '<script>x</script>' } }, '<u>A</u>', '<u>B</u>', '2026-11-09');
  assert(!html.includes('<script>x') && !html.includes('<u>'));
});
test('payment details follow the saved settings', () => {
  assert(OVERALL.includes('GCash') && OVERALL.includes('0917'));
});

console.log('\nWhat pressing the button offers');
const withReceipts = (...receipts) => ({ ...STATE, receipts });
test('no receipt yet: offer to issue it for the Fund Allocated', () => {
  const plan = api.planFor(STATE, 'p1');
  assert.strictEqual(plan.kind, 'new');
  assert.strictEqual(plan.amount, 159000);
});
test('no Fund Allocated: nothing to issue', () => {
  assert.strictEqual(api.planFor(STATE, 'p3').kind, 'no_fund');
});
test('a Cover or unknown billing is not offered', () => {
  assert.strictEqual(api.planFor(STATE, 'cover').kind, 'unavailable');
});
test('an issued receipt that still matches reopens', () => {
  const plan = api.planFor(withReceipts(RECEIPT), 'p1');
  assert.strictEqual(plan.kind, 'issued');
  assert.strictEqual(plan.live.id, 'r1');
});
test('Fund Allocated changed by a centavo: offer void and re-issue', () => {
  const plan = api.planFor(withReceipts({ ...RECEIPT, amount: 158999.99 }), 'p1');
  assert.strictEqual(plan.kind, 'changed');
  assert.strictEqual(plan.amount, 159000);
});
test('the same amount written differently is not a change', () => {
  assert.strictEqual(api.planFor(withReceipts({ ...RECEIPT, amount: '159000.00' }), 'p1').kind, 'issued');
});
test('voided receipts stay listed and never count as the live one', () => {
  const old = { ...RECEIPT, id: 'r0', receipt_no: 'AR-202611-000', voided_at: '2026-11-10', void_reason: 'x' };
  const plan = api.planFor(withReceipts(old), 'p1');
  assert.strictEqual(plan.kind, 'new');
  assert.deepStrictEqual(plan.voided.map(r => r.id), ['r0']);
  assert.strictEqual(api.planFor(withReceipts(old, RECEIPT), 'p1').kind, 'issued');
});
test('another billing\'s receipt is ignored', () => {
  assert.strictEqual(api.planFor(withReceipts({ ...RECEIPT, period_id: 'p2' }), 'p1').kind, 'new');
});

console.log('\nTalking to the server');
function harness(role, respond) {
  const calls = [];
  const win = browser(role, { sbClient: { rpc: async (name, args) => {
    calls.push([name, args]);
    return respond ? respond(name, args) : { data: RECEIPT, error: null };
  } } });
  const popup = { closed: false, html: '', closes: 0,
    close() { this.closes++; this.closed = true; },
    document: { open() { popup.html = ''; }, write(v) { popup.html += v; }, close() {} } };
  return { calls, popup, api: load(win), win };
}
test('issuing sends the billing and the two names, never an amount', async () => {
  const h = harness();
  await h.api.actions.issue(h.popup, 'p1', 'MH', 'Ana');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(h.calls)), [['bar_issue', { p_period: 'p1', p_received_from: 'MH', p_received_by: 'Ana' }]]);
  assert(h.popup.html.includes('AR-202611-001'));
});
test('issuing with a payment date and reference uses 0117, still never an amount', async () => {
  const h = harness();
  await h.api.actions.issue(h.popup, 'p1', 'MH', 'Ana', { paidOn: '2026-11-18', reference: 'PC-NDBMOB-1' });
  assert.deepStrictEqual(JSON.parse(JSON.stringify(h.calls)), [['bar_issue_with_payment',
    { p_period: 'p1', p_received_from: 'MH', p_received_by: 'Ana', p_paid_on: '2026-11-18', p_reference: 'PC-NDBMOB-1' }]]);
});
test('re-issuing with a payment date and reference uses 0117', async () => {
  const h = harness();
  await h.api.actions.reissue(h.popup, 'r1', 'Wrong date', 'MH', 'Ana', { paidOn: '2026-11-17', reference: '' });
  assert.deepStrictEqual(JSON.parse(JSON.stringify(h.calls)), [['bar_reissue_with_payment',
    { p_receipt: 'r1', p_reason: 'Wrong date', p_received_from: 'MH', p_received_by: 'Ana', p_paid_on: '2026-11-17', p_reference: '' }]]);
});
test('the payment date is required and never in the future; the reference is optional, up to 100 characters', () => {
  const today = '2026-11-20';
  assert.deepStrictEqual({ ...api.checkPayment('2026-11-18', '  PC-1  ', today) }, { paidOn: '2026-11-18', reference: 'PC-1' });
  assert.deepStrictEqual({ ...api.checkPayment(today, '', today) }, { paidOn: today, reference: '' });
  assert.deepStrictEqual({ ...api.checkPayment('', 'x', today) }, { error: 'Please enter the payment date.' });
  assert.deepStrictEqual({ ...api.checkPayment('18/11/2026', 'x', today) }, { error: 'Please enter the payment date.' });
  assert.deepStrictEqual({ ...api.checkPayment('2026-11-21', '', today) }, { error: 'The payment date cannot be later than today.' });
  assert.deepStrictEqual({ ...api.checkPayment(today, 'r'.repeat(101), today) }, { error: 'That reference is too long. Please keep it to 100 characters.' });
  assert.strictEqual(api.checkPayment(today, 'r'.repeat(100), today).reference.length, 100);
});
test('the window\'s payment fields: a date box up to today, filled in, and a reference box', () => {
  const html = api.paymentFieldsHTML('2026-11-18', 'A"<b>', '2026-11-20');
  assert(/<input id="brPaidOn" type="date" value="2026-11-18" max="2026-11-20"/.test(html), 'date box');
  assert(/<input id="brRef" type="text" maxlength="100" value="A&quot;&lt;b&gt;"/.test(html), 'reference box, escaped');
  assert(html.includes('Payment date') && html.includes('Reference no.'));
});
test('Project Control\'s window asks for the payment; Project Management\'s does not', () => {
  assert(/askPayment: true/.test(source), 'PC_OPS asks');
  assert(!/askPayment/.test(read('js/pm-billing-docs.js')), 'PM never asks');
});
test('issuing with a typed description uses 0118, still never an amount', async () => {
  const h = harness();
  await h.api.actions.issue(h.popup, 'p1', 'MH', 'Ana', { paidOn: '2026-11-20', reference: '' }, 'Full Payment of the Down Payment (Nov 20, 2026)');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(h.calls)), [['bar_issue_described',
    { p_period: 'p1', p_received_from: 'MH', p_received_by: 'Ana', p_paid_on: '2026-11-20', p_reference: '', p_description: 'Full Payment of the Down Payment (Nov 20, 2026)' }]]);
});
test('re-issuing with a typed description uses 0118', async () => {
  const h = harness();
  await h.api.actions.reissue(h.popup, 'r1', 'Wording', 'MH', 'Ana', { paidOn: '2026-11-20', reference: 'X' }, 'Down payment');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(h.calls)), [['bar_reissue_described',
    { p_receipt: 'r1', p_reason: 'Wording', p_received_from: 'MH', p_received_by: 'Ana', p_paid_on: '2026-11-20', p_reference: 'X', p_description: 'Down payment' }]]);
});
test('the automatic line: billing name, payment date, then the reference when there is one', () => {
  assert.strictEqual(api.paymentLine('Progress Billing 3 (November 2026)', '2026-11-18', 'PC-NDBMOB-1'),
    'Progress Billing 3 (November 2026) · Payment received (Nov 18, 2026) · Ref. PC-NDBMOB-1');
  assert.strictEqual(api.paymentLine('Downpayment (October 2026)', '2026-10-05', ''), 'Downpayment (October 2026) · Payment received (Oct 5, 2026)');
  assert.strictEqual(api.paymentLine('B'.repeat(190), '2026-10-05', 'R').length, 200, 'cut to 200');
});
test('the description is required and at most 200 characters', () => {
  assert.deepStrictEqual({ ...api.checkDescription('  Full Payment of the Down Payment  ') }, { description: 'Full Payment of the Down Payment' });
  assert.deepStrictEqual({ ...api.checkDescription('   ') }, { error: 'Please enter a description.' });
  assert.deepStrictEqual({ ...api.checkDescription('d'.repeat(201)) }, { error: 'That description is too long. Please keep it to 200 characters.' });
  assert.strictEqual(api.checkDescription('d'.repeat(200)).description.length, 200);
});
test('the description box is filled in and escaped', () => {
  const html = api.descriptionFieldHTML('Payment "A" <b>');
  assert(/<textarea id="brDesc"[^>]*maxlength="200"[^>]*>Payment &quot;A&quot; &lt;b&gt;<\/textarea>/.test(html), html);
  assert(html.includes('Description'));
});
test('Project Control fills the description from the billing, date and reference', () => {
  assert(/autoLine: \(plan, paidOn, reference\) => paymentLine\(plan\.period\.label, paidOn, reference\)/.test(source));
});
test('re-issuing sends the reason', async () => {
  const h = harness();
  await h.api.actions.reissue(h.popup, 'r1', 'Added funds', 'MH', 'Ana');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(h.calls)), [['bar_reissue', { p_receipt: 'r1', p_reason: 'Added funds', p_received_from: 'MH', p_received_by: 'Ana' }]]);
});
test('the Overall page remembers the names, then prints', async () => {
  const h = harness('owner', () => ({ data: null, error: null }));
  await h.api.actions.overall(h.popup, STATE, 'MH', 'Ana');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(h.calls)), [['bar_set_parties', { p_folder: 'f1', p_received_from: 'MH', p_received_by: 'Ana' }]]);
  assert(h.popup.html.includes('PROOF OF PAYMENTS'));
});
test('a refusal closes the window, prints nothing and says why', async () => {
  const h = harness('owner', () => ({ data: null, error: { code: 'P0001', message: 'NO_FUND_ALLOCATED' } }));
  await assert.rejects(h.api.actions.issue(h.popup, 'p1', 'MH', 'Ana'), /no Fund Allocated/);
  assert.strictEqual(h.popup.closes, 1);
  assert(!h.popup.html.includes('AR-'));
});
test('an Overall page whose names cannot be saved does not print', async () => {
  const h = harness('owner', () => ({ data: null, error: { code: 'P0001', message: 'OWNER_ONLY' } }));
  await assert.rejects(h.api.actions.overall(h.popup, STATE, 'MH', 'Ana'));
  assert(!h.popup.html.includes('PROOF OF PAYMENTS'));
});
test('a window the user closed while waiting is left alone', async () => {
  const h = harness();
  h.popup.closed = true;
  await h.api.actions.issue(h.popup, 'p1', 'MH', 'Ana');
  assert.strictEqual(h.popup.html, '');
});
test('a blocked pop-up is explained before anything is sent', () => {
  const h = harness();
  h.win.open = () => null;
  assert.throws(() => h.api.actions.openWindow(), /allow pop-ups/);
  assert.strictEqual(h.calls.length, 0);
});
test('only owner accounts get anywhere, even by calling it directly', async () => {
  for (const role of ['staff', 'worker', 'teamLeader', 'client', 'partner', null]) {
    const h = harness(role);
    await h.api.openReceipt({ id: 'f1' }, 'p1');
    await h.api.openOverall({ id: 'f1' });
    assert.strictEqual(h.calls.length, 0, String(role));
  }
});

console.log('\nThe Billing Request percentage');
test('the requested amount is that percentage of the contract, to the centavo', () => {
  assert.strictEqual(api.requestAmount(2200000, 10), 220000);
  assert.strictEqual(api.requestAmount(2200000, 12.5), 275000);
  assert.strictEqual(api.requestAmount(1234.56, 7.5), 92.59);
});
test('a percentage is 0.01 to 100, with up to two decimals', () => {
  for (const [typed, value] of [['10', 10], ['12.5', 12.5], ['0.01', 0.01], ['100', 100], [' 7.25 ', 7.25]]) assert.strictEqual(api.validPercent(typed), value, typed);
  for (const typed of ['', ' ', '0', '-1', '100.01', '12.345', 'abc', '1e1', 'Infinity']) assert.strictEqual(api.validPercent(typed), null, typed);
});
test('no warning while the request fits what is left of the contract', () => {
  assert.strictEqual(api.requestWarning(2200000, 1980000, 220000), '');
  assert.strictEqual(api.requestWarning(2200000, 0, 2200000), '');
});
test('a request over what is left warns, and names what is left', () => {
  const text = api.requestWarning(2200000, 1980000, 330000);
  assert(text.includes('₱220,000.00'), text);
  assert(/over/i.test(text), text);
});
test('a contract already fully billed warns too', () => {
  assert(/already/i.test(api.requestWarning(1000, 1000, 100)));
  assert(/already/i.test(api.requestWarning(1000, 1500, 100)));
});

test('the Prepared by name is remembered in this browser, and forgotten when left blank', () => {
  const store = {};
  const b = load(browser('owner', { localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } } }));
  assert.strictEqual(b.loadPreparedBy(), '');
  b.savePreparedBy('  Ana Cruz ');
  assert.strictEqual(b.loadPreparedBy(), 'Ana Cruz');
  b.savePreparedBy('   ');
  assert.strictEqual(b.loadPreparedBy(), '');
});
test('a browser that blocks or lacks storage still works', () => {
  const blocked = load(browser('owner', { localStorage: { getItem() { throw Error('blocked'); }, setItem() { throw Error('blocked'); }, removeItem() { throw Error('blocked'); } } }));
  assert.strictEqual(blocked.loadPreparedBy(), '');
  blocked.savePreparedBy('Ana');
  blocked.savePreparedBy('');
  const none = load(browser('owner'));
  assert.strictEqual(none.loadPreparedBy(), '');
  none.savePreparedBy('Ana');
});

console.log('\nRefusals in plain words');
test('each server refusal has its own message', () => {
  for (const code of ['NOT_SIGNED_IN', 'PROFILE_MISSING', 'INACTIVE', 'OWNER_ONLY', 'NOT_FOUND', 'COVER_PERIOD', 'NO_FUND_ALLOCATED',
    'NAME_REQUIRED', 'NAME_TOO_LONG', 'REASON_REQUIRED', 'REASON_TOO_LONG', 'ALREADY_VOID']) {
    const text = api.refusalText({ code: 'P0001', message: code });
    assert(text && !text.includes(code) && !text.startsWith('Something went wrong'), code + ': ' + text);
  }
});
test('the payment refusals read in plain words, and a database without 0117 says so', () => {
  assert.strictEqual(api.refusalText({ message: 'PAID_ON_REQUIRED' }), 'Please enter the payment date.');
  assert.strictEqual(api.refusalText({ message: 'PAID_ON_FUTURE' }), 'The payment date cannot be later than today.');
  assert.strictEqual(api.refusalText({ message: 'REFERENCE_TOO_LONG' }), 'That reference is too long. Please keep it to 100 characters.');
  assert(/0117/.test(api.refusalText({ code: 'PGRST202', message: 'Could not find the function public.bar_issue_with_payment' })));
});
test('a too-long description reads in plain words, and a database without 0118 says so', () => {
  assert.strictEqual(api.refusalText({ message: 'DESCRIPTION_TOO_LONG' }), 'That description is too long. Please keep it to 200 characters.');
  assert(/0118/.test(api.refusalText({ code: 'PGRST202', message: 'Could not find the function public.bar_issue_described' })));
});
test('a database without 0114 says so', () => {
  assert(/0114/.test(api.refusalText({ code: 'PGRST202', message: 'Could not find the function public.bar_state' })));
  assert(/0114/.test(api.refusalText({ message: 'relation "billing_receipts" does not exist' })));
});

console.log('\nWhere it stands in the app');
test('admin.html loads the module before Project Control', () => {
  const admin = read('admin.html');
  const mod = admin.indexOf('js/billing-receipts.js');
  assert(mod > 0, 'script tag');
  assert(mod < admin.indexOf('js/portal-app.compiled.js" defer'), 'order');
});
test('only js/billing-receipts.js calls the bar_ functions', () => {
  const offenders = fs.readdirSync(path.join(ROOT, 'js')).filter(f => f.endsWith('.js') && f !== 'billing-receipts.js')
    .filter(f => /\bbar_(state|issue|reissue|set_parties)\b|billing_receipt/.test(read('js/' + f)));
  assert.deepStrictEqual(offenders, []);
});
test('no money function reads a receipt', () => {
  const portal = read('js/portal-app.compiled.js');
  for (const name of ['_projSpent', '_projEarned', '_projMargin', '_recognisedProfit', '_projOverhead']) {
    const at = portal.indexOf('function ' + name + '(');
    assert(at >= 0, name);
    const body = portal.slice(at, portal.indexOf('\nfunction ', at + 10));
    assert(!/BillingReceipts|billing_receipt|bar_/.test(body), name);
  }
});
test('the module writes to nothing but its own server functions', () => {
  assert(!/\.collection\(|\.from\(|\.insert\(|\.upsert\(|\.delete\(/.test(source));
});

(async () => {
  for (const run of pending) await run();
  console.log(`\nBilling receipts: ${passed} passed`);
})().catch(error => { console.error(error); process.exitCode = 1; });
