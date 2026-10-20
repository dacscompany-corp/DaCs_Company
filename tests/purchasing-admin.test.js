// ════════════════════════════════════════════════════════════════════
// PURCHASING TAB TESTS: run with  node tests/purchasing-admin.test.js
//
// Zero dependencies. Loads the REAL js/purchasing-admin-core.js (it exports
// its pure half under Node) and reads the screens' source:
//   1. Previews agree with the server: the charge split (pur_prorate), what
//      a line covers and what is extra, what the form must refuse.
//   2. The body sent to pur_record keeps the request link, Unplanned lines
//      their reason, and adds up to the receipt total.
//   3. Which portion buttons show (claim / assign / release).
//   4. Wiring: the tab is in the nav for buyers only, its drill-down is
//      allowed for module-focused accounts, admin.html loads it, and the
//      screens call only the purchasing RPCs — never a table write.
//   5. Project Control's staff path sends owner-only changes for approval.
//   6. The review fixes (16 Oct): picked portions and substitutes in the
//      form, receipt photos that survive redraws and replacements, the
//      owner's field-by-field approval view, Purchasing for accounts
//      focused on Expenses, buyer-only receipt delivery, and Project
//      Control's one-line read.
// ════════════════════════════════════════════════════════════════════
'use strict';
const pa = require('../js/purchasing-admin-core.js');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

let passed = 0, failed = 0;
const failures = [];
// A test may return a promise; the summary waits for all of them.
const pending = [];
function test(name, fn) {
  const pass = () => { passed++; console.log('  ok  ' + name); };
  const fail = (e) => { failed++; failures.push(name + ' — ' + e.message); console.log('  FAIL ' + name + '\n       ' + e.message); };
  try {
    const r = fn();
    if (r && typeof r.then === 'function') pending.push(r.then(pass, fail)); else pass();
  } catch (e) { fail(e); }
}
function ok(c, m) { if (!c) throw new Error(m); }
function eq(a, b, label) {
  const x = JSON.stringify(a), y = JSON.stringify(b);
  if (x !== y) throw new Error((label || '') + ' expected ' + y + ', got ' + x);
}

console.log('\npurchasing-admin: previews agree with the server');

test('the default charge split is pur_prorate: ₱200 over ₱3,000 / ₱1,000 → ₱150 / ₱50 (spec example)', () => {
  eq(pa.prorate(200, [3000, 1000]), [150, 50]);
});
test('left-over centavos go to the biggest remainders, the earliest line on a tie; always adds up', () => {
  eq(pa.prorate(100, [1, 1, 1]), [33.34, 33.33, 33.33]);
  eq(pa.prorate(0.03, [1, 1, 1, 1, 1]), [0.01, 0.01, 0.01, 0, 0]);
  eq(pa.prorate(10, [0, 0]), [5, 5], 'no weights → equal');
  const s = pa.prorate(1234.57, [17.5, 3, 900.01]);
  eq(Math.round(s.reduce((a, b) => a + b, 0) * 100), 123457, 'adds up to the centavo');
});
test('a line covers up to Still to buy; the rest is extra; a different unit waits for a check', () => {
  eq(pa.coverPreview(10, 12, true), { covers: 10, extra: 2, unitCheck: false });
  eq(pa.coverPreview(10, 6, true), { covers: 6, extra: 0, unitCheck: false });
  eq(pa.coverPreview(-3, 2, true), { covers: 0, extra: 2, unitCheck: false }, 'never negative');
  eq(pa.coverPreview(24, 2, false), { covers: 0, extra: 0, unitCheck: true });
  ok(pa.sameUnit(' Bag ', 'bag') && !pa.sameUnit('box', 'pcs'), 'units compare trimmed, any case');
});
test('the receipt total is lines + fees − discounts', () => {
  eq(pa.receiptTotal([{ amount: 1000 }, { amount: 2000.5 }], [{ kind: 'delivery_fee', amount: 200 }, { kind: 'discount', amount: 100.25 }]), 3100.25);
});
test('money and quantities parse like the server (pur_money / pur_qty)', () => {
  eq([pa.parseMoney('1,500.50'), pa.parseMoney('1.234'), pa.parseMoney('-1'), pa.parseMoney('abc')], [1500.5, null, null, null]);
  eq([pa.parseQty('2.125'), pa.parseQty('0'), pa.parseQty('1.2345'), pa.parseQty('1e3')], [2.125, null, null, null]);
});

console.log('\npurchasing-admin: the form and its body');

const linked = { requestLineId: 'L1', requestUnit: 'bag', still: 10, folderId: 'F1', itemName: 'Cement', quantity: 12, unit: 'bag', amount: 3000 };
test('the form refuses an extra without a reason and location, and Unplanned without a reason', () => {
  const st = { purchaseDate: '2026-10-14', lines: [linked, { folderId: 'F1', itemName: 'Tape', quantity: 1, amount: 10 }], charges: [] };
  eq(pa.formProblems(st).map(p => p.code + ':' + p.line), ['EXTRA_REASON_REQUIRED:1', 'UNPLANNED_REASON_REQUIRED:2']);
  const fixed = { ...st, lines: [{ ...linked, extraReason: 'pack of 12', extraLocation: 'warehouse' },
                                 { folderId: 'F1', itemName: 'Tape', quantity: 1, amount: 10, unplannedReason: 'leak' }] };
  eq(pa.formProblems(fixed), []);
});
test('the form refuses a split that does not add up, a missing date and a missing project', () => {
  const st = { purchaseDate: '', lines: [{ ...linked, quantity: 2, folderId: '' }],
               charges: [{ kind: 'delivery_fee', amount: 100, shares: [60, 30] }] };
  eq(pa.formProblems(st).map(p => p.code), ['BAD_DATE', 'BAD_PROJECT', 'SPLIT_MISMATCH']);
});
test('the body keeps the request link and the extra; an Unplanned line sends its reason and no link', () => {
  const b = pa.buildBody({ purchaseDate: '2026-10-14', supplierId: 'S1', paymentMethod: 'Cash', boughtBy: 'U2',
    lines: [{ ...linked, extraReason: ' pack ', extraLocation: 'warehouse', portionPicks: [{ portionId: 'P1', quantity: 4 }] },
            { destination: 'warehouse', itemName: 'Bolts', quantity: 6, unit: 'pcs', amount: 60, unplannedReason: 'stock' }],
    charges: [{ kind: 'delivery_fee', amount: 200 }] });
  eq(b.source, 'purchasing');
  eq(b.receipt_total, 3260);
  eq([b.lines[0].request_line_id, b.lines[0].extra_reason, b.lines[0].portion_picks], ['L1', 'pack', [{ portion_id: 'P1', quantity: 4 }]]);
  eq([b.lines[1].request_line_id, b.lines[1].folder_id, b.lines[1].unplanned_reason], [null, null, 'stock']);
  eq(b.bought_by, 'U2');
  ok(!('shares' in b.charges[0]), 'no shares unless adjusted → the server splits');
});

console.log('\npurchasing-admin: portion buttons');

const me = { userId: 'me', isOwner: false };
test('unassigned: "I\'ll buy this" and Assign; mine: Release; someone else\'s: nothing for staff', () => {
  eq(pa.portionActions({ buyer_id: null, still_to_buy: 3 }, me), { claim: true, release: false, assign: true });
  eq(pa.portionActions({ buyer_id: 'me', still_to_buy: 3 }, me), { claim: false, release: true, assign: false });
  eq(pa.portionActions({ buyer_id: 'x', still_to_buy: 3 }, me), { claim: false, release: false, assign: false });
  eq(pa.portionActions({ buyer_id: 'x', still_to_buy: 3 }, { userId: 'o', isOwner: true }), { claim: false, release: true, assign: true });
  eq(pa.portionActions({ buyer_id: null, still_to_buy: 0 }, me), { claim: false, release: false, assign: false }, 'nothing left');
  eq([pa.buyerLabel({ buyer_id: null }, me), pa.buyerLabel({ buyer_id: 'me' }, me), pa.buyerLabel({ buyer_id: 'x', buyer_name: 'Pedro' }, me)],
     ['Unassigned', 'You', 'Pedro']);
});
test('server codes become sentences; an unknown error keeps its text', () => {
  ok(pa.errorMessage({ message: 'EXTRA_REASON_REQUIRED', hint: 'Line 1: 2 more' }).includes('Line 1: 2 more'), 'hint shown');
  ok(pa.errorMessage({ code: 'PGRST202' }).includes('0097'), 'not applied yet');
  ok(pa.errorMessage(new Error('boom')).startsWith('Something went wrong: boom'), 'fallback');
  ok(pa.needsOwner({ message: 'COMPLETED_PROJECT' }) && !pa.needsOwner({ message: 'BAD_DATE' }), 'owner-only codes');
});

console.log('\npurchasing-admin: wiring');

test('the nav has Purchasing and its drill-down, hidden unless the server says this account may buy', () => {
  const src = read('js/admin.js');
  ok(/view: 'reqPurchasing'/.test(src) && /view: 'reqPurchase',[^}]*hidden: true/.test(src), 'modules');
  ok(/requests: \['reqDetail', 'reqPurchase'\]/.test(src), '_FOCUS_SUBVIEWS');
  ok(/p\.id === 'requests' && !window\.currentCanBuy[\s\S]{0,400}'reqPurchasing', 'reqPurchase'/.test(src), '_visibleNav gate');
  ok(/rpc\('pur_me'\)[\s\S]{0,120}currentCanBuy = !!\(purMe && purMe\.can_buy\)/.test(src), 'loaded from the server at sign-in');
});
test('admin.html loads the purchasing files after Requests, with their views', () => {
  const html = read('admin.html');
  for (const f of ['purchasing-admin-core', 'purchasing-admin-list', 'purchasing-admin-record', 'purchasing-admin-purchases']) {
    ok(html.indexOf('js/' + f + '.js') > html.indexOf('js/requests-admin-core.js'), f);
  }
  ok(/id="reqPurchasingView"/.test(html) && /id="reqPurchaseView"/.test(html), 'views');
  ok(/REQ_VIEWS\s*=\s*\[[^\]]*'reqPurchasing','reqPurchase'\]/.test(html), 'REQ_VIEWS');
  ok(html.indexOf('css/purchasing-admin.css') > 0, 'styles');
  // Files this stage changes must reach an already-open browser (a stale admin.js hides the tab).
  for (const f of ['supabase-config', 'admin', 'receipt-storage', 'expenses-module', 'user-navigator']) {
    const m = html.match(new RegExp('js/' + f + '\\.js\\?v=(\\d{8})'));
    ok(m && Number(m[1]) >= 20261016, f + '.js cache-buster not bumped for 2A-2');
  }
});
test('the screens call only purchasing RPCs and write no table directly', () => {
  const allowed = new Set(['pur_me', 'pur_shopping_list', 'pur_assign_portion', 'pr_office_set_arranged', 'pr_office_batches',
    'pur_buyer_options', 'pur_suppliers', 'pur_save_supplier', 'pur_record', 'pur_correct', 'pur_replace', 'pur_void',
    'pur_purchases', 'pur_purchase', 'pur_check_unit', 'pur_request_change', 'pur_change_requests', 'pur_decide_change',
    'pur_withdraw_change']);
  for (const f of ['purchasing-admin-core', 'purchasing-admin-list', 'purchasing-admin-record', 'purchasing-admin-purchases']) {
    const src = read('js/' + f + '.js');
    for (const m of src.matchAll(/rpc\('([a-z_]+)'/g)) ok(allowed.has(m[1]), f + ' calls ' + m[1]);
    ok(!/\.(insert|update|upsert|delete)\(/.test(src.replace(/\.update\(\)/g, '')), f + ' writes a table directly');
  }
});
test('purchase receipts go to their own buyers-only folder', () => {
  ok(/purchase: 'purchases'/.test(read('js/receipt-storage.js')), 'receipt-storage FOLDER');
  ok(/uploadReceipt\('purchase'/.test(read('js/purchasing-admin-record.js')), 'the record form uploads there');
});
test('the Buyer switch is the owner\'s, in Users → Navigator, through the server', () => {
  const src = read('js/user-navigator.js');
  ok(/currentUserRole === 'owner'[\s\S]{0,120}rpc\('pur_office_buyers'\)/.test(src), 'listed for the owner only');
  ok(/rpc\('pur_set_buyer', \{ p_user: uid, p_on: !!on \}\)/.test(src), 'set through pur_set_buyer');
  ok(/user\.role === 'staff' \? _buyers\[user\.uid\]/.test(src), 'staff rows only');
});
test('Project Control: staff send an owner-only correction or void for approval, never retry it themselves', () => {
  const src = read('js/expenses-module.js');
  ok(/function _purNeedsOwner\(err\)\s*\{\s*return window\.currentUserRole === 'staff' && \/OWNER_APPROVAL_NEEDED\|COMPLETED_PROJECT\//.test(src), 'staff + owner-only codes');
  ok(/_purSendToOwner\(pur\.purchase\.id, 'void', null, reason\)/.test(src), 'void');
  ok(/_purSendToOwner\(pur\.purchase\.id, 'correct', _purLastBody, reason\)/.test(src), 'correction');
  ok(/rpc\('pur_request_change'/.test(src), 'through pur_request_change');
});

console.log('\npurchasing-admin: review fixes (16 Oct)');

test('review 2: picked portions are the only ones a line covers — the preview and the form agree with the server', () => {
  const portions = [{ id: 'P1', still_to_buy: 4 }, { id: 'P2', still_to_buy: 6 }];
  eq(pa.pickedStill(portions, [{ portionId: 'P1', quantity: 4 }]), 4);
  eq(pa.pickedStill(portions, [{ portionId: 'P1', quantity: 9 }, { portionId: 'P9', quantity: 2 }]), 4, 'a pick is capped by its portion; unknown portions add nothing');
  const l = { requestLineId: 'L1', requestUnit: 'bag', unit: 'bag', still: 10, portions, folderId: 'F1', itemName: 'Cement', amount: 1500,
              quantity: 6, portionPicks: [{ portionId: 'P1', quantity: 4 }] };
  eq(pa.lineStill(l), 4, 'with picks: only the picks');
  eq(pa.lineStill({ ...l, portionPicks: [] }), 10, 'without picks: everything this buyer may cover');
  eq(pa.formProblems({ purchaseDate: '2026-10-14', lines: [l], charges: [] }).map(p => p.code), ['EXTRA_REASON_REQUIRED'], '6 bought, 4 picked: 2 extra');
  const b = pa.buildBody({ purchaseDate: '2026-10-14', lines: [{ ...l, portionPicks: [{ portionId: 'P1', quantity: 4 }, { portionId: 'P2', quantity: 0 }] }], charges: [] });
  eq(b.lines[0].portion_picks, [{ portion_id: 'P1', quantity: 4 }], 'empty picks are not sent');
});
test('R14: a renamed item must say whether it is a substitute; a substitute needs a reason and waits for a check', () => {
  const l = { requestLineId: 'L1', requestUnit: 'gal', requestName: 'Boysen paint white', unit: 'gal', still: 10, folderId: 'F1',
              itemName: 'Davies paint white', quantity: 10, amount: 5000 };
  const st = (x) => ({ purchaseDate: '2026-10-14', lines: [x], charges: [] });
  eq(pa.formProblems(st(l)).map(p => p.code), ['NAME_DIFFERS']);
  eq(pa.formProblems(st({ ...l, itemName: '  boysen   PAINT white ' })), [], 'case and spacing are not a different name');
  eq(pa.formProblems(st({ ...l, match: 'wording' })), [], 'same item, other words');
  eq(pa.formProblems(st({ ...l, match: 'substitute' })).map(p => p.code), ['SUBSTITUTE_REASON_REQUIRED']);
  const sub = { ...l, match: 'substitute', substituteReason: 'out of stock' };
  eq(pa.formProblems(st(sub)), []);
  ok(!pa.countsDirectly(sub) && pa.countsDirectly({ ...l, match: 'wording' }), 'a substitute does not count until checked');
  const b = pa.buildBody(st(sub));
  eq([b.lines[0].substitute, b.lines[0].substitute_reason], [true, 'out of stock']);
  eq(pa.buildBody(st({ ...l, match: 'wording', substituteReason: 'x' })).lines[0].substitute_reason, '', 'no reason sent unless a substitute');
  const rec = read('js/purchasing-admin-record.js');
  ok(/\['substitute', 'Substitute — an important specification differs'\]/.test(rec), 'the form offers the choice');
});
test('review 5: a replacement photo uploads even after an earlier upload; a redraw keeps unsaved choices', () => {
  const a = { name: 'a.jpg' }, b2 = { name: 'b.jpg' };
  eq(pa.docUploads({ dr: a }, {}), ['dr'], 'first choice');
  eq(pa.docUploads({ dr: a }, { dr: { file: a, url: 'u1' } }), [], 'already uploaded as that file');
  eq(pa.docUploads({ dr: b2 }, { dr: { file: a, url: 'u1' } }), ['dr'], 'a replacement goes up');
  const src = read('js/purchasing-admin-record.js');
  ok(!/!st\.docs\[field\]/.test(src), 'no "already has a URL" skip');
  ok(/for \(const key of PA\.docUploads\(st\.files, st\.uploaded\)\)/.test(src), 'uploads what docUploads says');
  ok(/if \(file\) st\.files\[el\.dataset\.doc\] = file;/.test(src), 'a chosen photo is kept in the form state');
  ok(/const chosen = st\.files\[key\];[\s\S]{0,200}esc\(chosen\.name/.test(src), 'a redraw shows the chosen photo again');
  ok(/st\.uploaded\[key\] = \{ file, url: st\.docs\[field\] \}/.test(src), 'remembers which file each upload was');
});
test('review 3: the owner sees every field — quantities, units, dates, supplier, receipts and fee splits', () => {
  const base = { purchase_date: '2026-10-14', date_time: '2026-10-14T09:30', supplier: 'Wilcon', bought_by: 'Juan', receipt_total: 1100,
    payment_method: 'Cash', notes: '', receipts: { delivery_receipt_url: 'aaaa1111' },
    lines: [{ item_name: 'Hinge', quantity: 2, unit: 'box', amount: 900, where: 'Barlin · Main Contract', request: 'Hinge (pcs)', picks: [] },
            { item_name: 'Tape', quantity: 1, unit: 'roll', amount: 100, where: 'Barlin · Main Contract', unplanned_reason: 'r' }],
    charges: [{ kind: 'delivery_fee', amount: 100, shares: [90, 10] }] };
  const proposed = { ...base, date_time: '2026-10-13T08:00', supplier: 'Wilcon · Cubao', bought_by: null, receipt_total: 1150,
    receipts: { delivery_receipt_url: 'bbbb2222' },
    lines: [{ ...base.lines[0], picks: [{ quantity: 2, cutoff_at: '2026-10-17T04:00:00Z', buyer: 'Pedro' }] }, { ...base.lines[1], quantity: 3, amount: 150, where: 'Prado · Main Contract' }],
    charges: [{ kind: 'delivery_fee', amount: 100, shares: [40, 60] }] };
  const rows = pa.changeRows(base, proposed);
  const changed = rows.filter(r => r.changed).map(r => r.group + ' / ' + r.label);
  eq(changed, ['Receipt / Date and time bought', 'Receipt / Supplier', 'Receipt / Receipt total', 'Receipt / Receipt photos',
               'Line 1 / Request', 'Line 2 / Quantity', 'Line 2 / Amount', 'Line 2 / Project / warehouse', 'Fees and discounts / Fee / discount 1']);
  const q = rows.find(r => r.group === 'Line 2' && r.label === 'Quantity');
  eq([q.before, q.after], ['1 roll', '3 roll']);
  ok(rows.find(r => r.label === 'Fee / discount 1').after.includes('line 1: ₱40.00, line 2: ₱60.00'), 'the split asked for');
  const req1 = rows.find(r => r.group === 'Line 1' && r.label === 'Request');
  ok(req1.after.includes('held by Pedro') && req1.changed, 'a pick shows who holds the portion');
  ok(!rows.find(r => r.label === 'Bought by').changed, 'a body without "bought by" keeps the buyer');
  ok(rows.length > changed.length, 'unchanged fields are listed too');
  const two = pa.changeRows(base, { ...base, lines: [base.lines[0]] });
  ok(two.some(r => r.group === 'Line 2' && r.after === '(removed)' && r.changed), 'a removed line shows');
});
test('review 3: the approval screen shows the comparison and will not approve a request the purchase has outrun', () => {
  const src = read('js/purchasing-admin-purchases.js');
  ok(/PA\.changeRows\(r\.base, r\.proposed, RA\.cutoffLabel\)/.test(src), 'field-by-field comparison');
  ok(/r\.changed_since \? ' disabled/.test(src), 'Approve disabled when the purchase changed');
  ok(!/function summarize\(/.test(src), 'the old one-line summary is gone');
});
test('review 4: an account focused on Expenses that may buy gets Requests → Purchasing — and nothing else of Requests', () => {
  const src = read('js/admin.js');
  const slice = src.slice(src.indexOf('const PRIMARY_NAV = ['), src.indexOf('function findPrimaryForView('));
  const nav = (role, modules, canBuy) => {
    const sb = { window: { currentCanBuy: canBuy }, currentUserRole: role, currentAllowedModules: modules };
    vm.createContext(sb);
    vm.runInContext(slice + '\nthis.__nav = _visibleNav(); this.__views = window.focusAllowedViews();', sb);
    return { nav: sb.__nav, views: sb.__views };
  };
  const r = nav('owner', ['expenses'], true);
  const req = r.nav.find(p => p.id === 'requests');
  ok(req, 'a Requests tab');
  eq([req.defaultView, req.modules.map(m => m.view)], ['reqPurchasing', ['reqPurchasing', 'reqPurchase']], 'Purchasing only');
  ok(r.views.includes('reqPurchasing') && r.views.includes('reqPurchase') && !r.views.includes('reqQueue'), 'the view guard lets it in, not the queue');
  ok(!nav('owner', ['expenses'], false).nav.some(p => p.id === 'requests'), 'not when the server says it may not buy');
  ok(!nav('owner', ['pm'], false).nav.some(p => p.id === 'requests'), 'a PM-only account: no Requests');
  const full = nav('staff', null, true).nav.find(p => p.id === 'requests');
  ok(full.modules.some(m => m.view === 'reqQueue') && full.modules.some(m => m.view === 'reqPurchasing'), 'unfocused buyers keep all of Requests');
  ok(!nav('staff', null, false).nav.find(p => p.id === 'requests').modules.some(m => m.view === 'reqPurchasing'), 'non-buyers never see Purchasing');
  ok(/const primary = nav\.find\(p => p\.id === id\) \|\| PRIMARY_NAV\.find/.test(src), 'the tab lands on the visible section\'s default view');
});
test('R13: purchase receipts are downloaded with the viewer\'s session — never a signed link, never cached', async () => {
  const src = read('js/supabase-config.js');
  const fn = src.slice(src.indexOf('window.dacsSignedUrl = async function'), src.indexOf('const _dacsIsPubUpload'));
  const calls = [];
  const sb = { storage: { from: () => ({
    download: async (p) => { calls.push('download ' + p); return { data: { blob: p }, error: null }; },
    createSignedUrl: async (p, s) => { calls.push('sign ' + p + ' ' + s); return { data: { signedUrl: 'https://signed/' + p }, error: null }; },
  }) } };
  const ctx = { window: {}, sb, URL: { createObjectURL: (b) => 'blob:local/' + b.blob }, Date, decodeURIComponent };
  vm.createContext(ctx);
  vm.runInContext('const DACS_PUB_UPLOADS_RE = /\\/storage\\/v1\\/object\\/public\\/uploads\\/([^?#]+)/; const _dacsSignCache = new Map();\n' + fn, ctx);
  const pub = (p) => 'https://x.supabase.co/storage/v1/object/public/uploads/' + p;
  const p1 = 'purchases/c0/2026-10/r1.jpg';
  eq(await ctx.window.dacsSignedUrl(pub(p1)), 'blob:local/' + p1);
  eq(await ctx.window.dacsSignedUrl(pub(p1)), 'blob:local/' + p1);
  eq(calls, ['download ' + p1, 'download ' + p1], 'checked by Storage on every view; no signed URL');
  eq(await ctx.window.dacsSignedUrl(pub('expenseReceipts/c0/2026-10/e.jpg')), 'https://signed/expenseReceipts/c0/2026-10/e.jpg', 'other receipts unchanged');
  ok(!/dacsMaybeSignUrl/.test(read('js/purchasing-admin-purchases.js')), 'the purchase screen opens receipts through the shim, not a signed link');
});
test('R3: Project Control reads the purchase behind a row through pur_entry_row — no purchase table', () => {
  const src = read('js/expenses-module.js');
  ok(/rpc\('pur_entry_row', \{/.test(src) && /rpc\('pur_review_lines'\)/.test(src), 'server reads');
  ok(!/from\('purchase(s|_lines|_charges|_charge_shares|_history)'\)/.test(src), 'no direct read of a purchase table');
});

test('fix 1: a correction keeps the stored receipt photos (a replacement of a different line count has no other source)', () => {
  const d = pa.storedDocs({ po_image_url: 'a1', delivery_receipt_url: 'b2', supplier_invoice_url: 'c3', payment_receipt_url: 'd4',
                            other_url: 'zz', extra: '' });
  eq(d, { po_image_url: 'a1', delivery_receipt_url: 'b2', supplier_invoice_url: 'c3', payment_receipt_url: 'd4' });
  eq(pa.storedDocs({ po_image_url: '', delivery_receipt_url: null, supplier_invoice_url: 5, payment_receipt_url: 'ok' }), { payment_receipt_url: 'ok' });
  eq(pa.storedDocs(null), {});
  const b = pa.buildBody({ purchaseDate: '2026-10-14', docs: pa.storedDocs({ po_image_url: 'a1' }), lines: [], charges: [] });
  eq(b.docs, { po_image_url: 'a1' }, 'the body carries them');
  const rec = read('js/purchasing-admin-record.js');
  ok(/docs: PA\.storedDocs\(doc\.docs\)/.test(rec), 'fromPurchase seeds docs from the stored purchase');
  ok(/st\.stored\b/.test(rec) && /delete st\.docs\[field\];[\s\S]{0,120}st\.stored/.test(rec), 'Remove on a new choice falls back to the stored photo');
});
test('fix 2: a Purchasing correction keeps the stored time of day unless the date was changed', () => {
  const base = { purchaseDate: '2026-10-14', dateTime: '2026-10-14T09:30', lines: [], charges: [] };
  eq(pa.buildBody(base).date_time, '2026-10-14T09:30', 'same date: stored time kept');
  eq(pa.buildBody({ ...base, purchaseDate: '2026-10-15' }).date_time, '2026-10-15', 'changed date: the new date');
  eq(pa.buildBody({ purchaseDate: '2026-10-14', lines: [], charges: [] }).date_time, '2026-10-14', 'a new purchase sends the date');
  const rec = read('js/purchasing-admin-record.js');
  ok(/dateTime: doc\.date_time/.test(rec) && /dateTime: st\.dateTime/.test(rec), 'the state carries the stored date_time into the body');
});
test('fix 3: picking a listed supplier clears the typed supplier text', () => {
  const rec = read('js/purchasing-admin-record.js');
  ok(/dataset\.h === 'supplierId'[^\n]*st\.supplier = ''/.test(rec), 'the supplier select clears the typed text');
  ok(/st\.supplierId = s\.id;\s*st\.supplier = '';/.test(rec), 'a new supplier clears it too');
});
test('fix 4: a pick shows its holder only while the portion still exists', () => {
  const mk = (picks) => ({ item_name: 'x', quantity: 1, unit: 'u', amount: 1, request: 'R', picks });
  const rows = (picks) => pa.changeRows({ lines: [mk([])] }, { lines: [mk(picks)] }).find(r => r.group === 'Line 1' && r.label === 'Request').after;
  ok(rows([{ quantity: 1, cutoff_at: '2026-10-17T04:00:00Z' }]).includes('(unassigned)'), 'no buyer → unassigned');
  const gone = rows([{ quantity: 1, cutoff_at: null, buyer: 'Pedro' }]);
  ok(gone.includes('a portion no longer there') && !/held by|unassigned/.test(gone), 'a removed portion has no suffix');
});
test('fix 5: the staff void notice is shown after the modal has closed', () => {
  const src = read('js/purchasing-admin-purchases.js');
  const i = src.indexOf("p_kind: 'void'");
  const onSubmitTail = src.slice(i, src.indexOf('onDone', i));
  ok(!/PA\.notice\(/.test(onSubmitTail), 'no notice inside onSubmit');
  ok(/onDone: \(\) => \{[^}]*PA\.notice\(/.test(src.slice(i)), 'shown from onDone');
});
test('fix 6: a non-buyer is not handed purchase receipts they cannot open', () => {
  const src = read('js/expenses-module.js');
  const at = src.indexOf('const d = { ...(pur.purchase.docs');
  ok(at > 0 && /currentCanBuy[\s\S]{0,300}purchases\\\/[\s\S]{0,200}storagePathOf\(/.test(src.slice(at, at + 1200)), 'purchases/ URLs are left out unless the account may buy');
});

console.log('\npurchasing-admin: final review fixes (16 Oct)');

test('final 1: a batch-filtered list picks the portions it shows, so the server covers exactly those', () => {
  const portions = [{ id: 'A', still_to_buy: 4, buyer_id: 'me' }, { id: 'B', still_to_buy: 3, buyer_id: null },
                    { id: 'C', still_to_buy: 5, buyer_id: 'other' }, { id: 'D', still_to_buy: 0, buyer_id: 'me' }];
  eq(pa.defaultPicks(portions, { userId: 'me', isOwner: false }), [{ portionId: 'A', quantity: 4 }, { portionId: 'B', quantity: 3 }],
     'own + unassigned, not another buyer\'s, nothing-left skipped, list order');
  eq(pa.defaultPicks(portions, { userId: 'boss', isOwner: true }), [{ portionId: 'A', quantity: 4 }, { portionId: 'B', quantity: 3 }, { portionId: 'C', quantity: 5 }],
     'the owner: every portion with something left');
  eq(pa.defaultPicks(null, { userId: 'me' }), []);
  const list = read('js/purchasing-admin-list.js');
  ok(/PA\.openRecord\(\{ requestLines: picked, batchId: ui\.batchId \|\| ''/.test(list), 'the list passes the batch it is filtered to');
  const rec = read('js/purchasing-admin-record.js');
  ok(/portionPicks: batchId \? PA\.defaultPicks\(l\.portions, me\) : \[\]/.test(rec), 'picks are pre-filled only when a batch is set');
  ok(/fromRequest\(l, me, ctx\.batchId\)/.test(rec), 'the form hands the batch to fromRequest');
  const picks = pa.defaultPicks(portions, { userId: 'me' });
  const l = { requestLineId: 'L', requestUnit: 'bag', unit: 'bag', still: 7, portions: portions.slice(0, 2), folderId: 'F', itemName: 'Cement', amount: 700,
              quantity: 7, portionPicks: picks };
  eq(pa.lineStill(l), 7, 'default quantity equals the picks\' total');
  eq(pa.formProblems({ purchaseDate: '2026-10-14', lines: [l], charges: [] }), []);
});
test('final minor 2: a correction that did not raise the quantity is not asked for an extra reason', () => {
  const base = { requestLineId: 'L', requestUnit: 'bag', unit: 'bag', still: 7, folderId: 'F', itemName: 'Cement', amount: 100, quantity: 10 };
  const st = (x) => ({ purchaseDate: '2026-10-14', lines: [x], charges: [] });
  eq(pa.formProblems(st(base)).map(p => p.code), ['EXTRA_REASON_REQUIRED'], 'a new purchase of 10 against 7 still needs it');
  eq(pa.formProblems(st({ ...base, origQuantity: 10 })), [], 'price fix: the server labels the extra itself');
  eq(pa.formProblems(st({ ...base, origQuantity: 9 })).map(p => p.code), ['EXTRA_REASON_REQUIRED'], 'raised above the stored quantity: still asked');
  ok(/origQuantity: Number\(l\.quantity\)/.test(read('js/purchasing-admin-record.js')), 'fromPurchase remembers the stored quantity');
});
test('final minor 6: BAD_DOCS has plain words in the Purchasing tab and in Expenses', () => {
  ok(/receipt photo link is not valid/.test(pa.ERRORS.BAD_DOCS), 'ERRORS');
  ok(/BAD_DOCS:\s+'A receipt photo link is not valid/.test(read('js/expenses-module.js')), '_purErrorText');
});

Promise.all(pending).then(() => {
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  if (failed) { console.log('\nFAILURES:\n  ' + failures.join('\n  ')); process.exit(1); }
});
