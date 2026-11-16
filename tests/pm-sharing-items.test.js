// ════════════════════════════════════════════════════════════════════
// PM SHARING PERSONAL ITEMS — run with: node tests/pm-sharing-items.test.js
// Spec: docs/superpowers/specs/2026-10-31-pm-sharing-personal-items-design.md
// A: pure helpers. B: panel. C: form + server calls (fake sbClient). D: fences.
// Runs the REAL js/pm-sharing-items.js in the pm-admin sandbox.
// ════════════════════════════════════════════════════════════════════
'use strict';
process.env.TZ = 'Asia/Manila';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const { loadPmAdmin } = require('./helpers/pm-admin-sandbox.js');

let passed = 0, failed = 0;
const failures = [];
const queue = [];
function test(name, fn) { queue.push([name, fn]); }
function eq(a, b, label) {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error((label || 'value') + ': expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a));
}
function ok(c, label) { if (!c) throw new Error(label || 'expected truthy'); }

const OWNER = '00000000-0000-0000-0000-00000000000a';
function load(role = 'owner') {
  const sb = loadPmAdmin({ role });
  const calls = [], uploads = [];
  sb.ctx.sbClient = {
    rpc: async (name, args) => { calls.push([name, args]); return sb.ctx.__rpcReply ? sb.ctx.__rpcReply(name, args) : { data: { item: {} }, error: null }; },
    storage: { from: () => ({
      upload: async (p) => { uploads.push(p); return { error: null }; },
      createSignedUrl: async (p) => ({ data: { signedUrl: 'https://signed/' + p }, error: null }),
    }) },
  };
  sb.ctx.DacsReceipts = { newId: () => 'op-' + (calls.length + uploads.length + 1),
    compressToBlob: async () => 'BLOB',
    receiptPath: (kind, owner) => (kind === 'pm_sharing' ? 'pmSharing/' : 'x/') + owner + '/2026-10/11111111-1111-4111-8111-111111111111.jpg' };
  vm.runInContext(read('js/pm-sharing-items.js'), sb.ctx, { filename: 'pm-sharing-items.js' });
  return { sb, S: sb.ctx.PMShareItems, calls, uploads, $: (id) => sb.ctx.document.getElementById(id) };
}
const it = (o = {}) => ({ id: 'i1', project_id: 'A', charged_to: 'owner', item_name: 'Drill', amount: 10000,
  bought_on: '2026-10-01', note: null, receipt_path: null, status: 'active', void_reason: null, version: 1, events: [], ...o });
const NOW = new Date(2026, 9, 31, 7, 30);   // 7:30 AM PH — UTC is still Oct 30
const fill = ($, f) => { for (const [id, v] of Object.entries(f)) $(id).value = v; };

// ══ A. Pure helpers ══════════════════════════════════════════════════
test('A1 todayKey uses local (PH) parts, not UTC', () => {
  eq(load().S.todayKey(NOW), '2026-10-31');
});
test('A2 parseAmount: >0, ≤ 8 digits, ≤ 2 decimals, commas allowed, value kept as typed', () => {
  const { S } = load();
  eq(S.parseAmount('10,000.50'), { ok: true, value: '10000.50' });
  eq(S.parseAmount('0.01'), { ok: true, value: '0.01' });
  for (const bad of ['', '0', '0.00', '-5', 'abc', '100000000', '1e3']) ok(!S.parseAmount(bad).ok, bad);
  eq(S.parseAmount('10.005').error, S.ERRORS.BAD_PRECISION);
});
test('A3 validate: every field rule; reason only required when correcting', () => {
  const { S } = load();
  const good = { chargedTo: 'partner', itemName: '  Phone ', amount: '5000', boughtOn: '2026-10-31', note: ' ', reason: '' };
  const v = S.validate(good, 'record', NOW);
  eq(v.value, { chargedTo: 'partner', itemName: 'Phone', amount: '5000', boughtOn: '2026-10-31', note: null, reason: null });
  ok(!S.validate(good, 'correct', NOW).ok, 'correct needs a reason');
  const bad = S.validate({ chargedTo: '', itemName: '', amount: '0', boughtOn: '2026-11-01', note: 'n'.repeat(501), reason: '' }, 'record', NOW);
  eq(Object.keys(bad.errors).sort(), ['amount', 'boughtOn', 'chargedTo', 'itemName', 'note']);
});
test('A4 errorText maps server codes, passes unknown text through', () => {
  const { S } = load();
  eq(S.errorText('ERROR: ITEM_CHANGED'), 'This item was changed by someone else — reload.');
  eq(S.errorText('OWNER_ONLY'), 'Only the main owner can record personal items.');
  eq(S.errorText('weird'), 'weird');
});

// ══ B. Panel ═════════════════════════════════════════════════════════
test('B1 main owner: totals per person, Add / Correct / Void buttons, voided greyed and ₱0', () => {
  const { S } = load();
  const h = S.panelHtml([it(), it({ id: 'i2', charged_to: 'partner', item_name: 'Phone', amount: 5000 }),
                         it({ id: 'i3', item_name: 'Old', status: 'voided', void_reason: 'mistake' })], true);
  for (const s of ['Personal items', 'You −₱10,000.00', 'Partner −₱5,000.00', 'Add item', 'Drill', 'Phone',
                   "PMShareItems.openCorrect('i1')", "PMShareItems.voidItem('i2')", 'Voided — mistake',
                   'Not a project cost']) ok(h.includes(s), 'missing: ' + s);
  ok(!h.includes("openCorrect('i3')") && !h.includes("voidItem('i3')"), 'no buttons on a voided item');
});
test('B2 other owner-role accounts: list only, no buttons', () => {
  const h = load().S.panelHtml([it()], false);
  ok(h.includes('Drill'), 'list');
  for (const s of ['Add item', 'openCorrect', 'voidItem']) ok(!h.includes(s), 'should hide: ' + s);
});
test('B3 receipt button only when a path is stored; text is escaped', () => {
  const { S } = load();
  ok(S.panelHtml([it({ receipt_path: 'pmSharing/x.jpg' })], false).includes("PMShareItems.openReceipt('i1')"), 'receipt');
  ok(!S.panelHtml([it()], false).includes('openReceipt'), 'no receipt');
  ok(S.panelHtml([it({ item_name: '<b>x</b>' })], false).includes('&lt;b&gt;x&lt;/b&gt;'), 'escaped');
});
test('B4 staff: mount renders nothing', () => {
  const { S, $ } = load('staff');
  const el = $('pmSiPanel'); el.innerHTML = 'SENTINEL';
  S.mount(el, { projectId: 'A', items: [it()], canEdit: true, companyId: OWNER });
  eq(el.innerHTML, '');
});

// ══ C. Form + server calls ═══════════════════════════════════════════
test('C1 add: sends the typed values with a fresh op id, then reloads', async () => {
  const { S, calls, $ } = load();
  let reloaded = 0;
  S.mount($('pmSiPanel'), { projectId: 'A', items: [], canEdit: true, companyId: OWNER, onChange: async () => { reloaded++; } });
  S.openAdd();
  eq($('pmSiModal').style.display, 'flex');
  fill($, { pmSiChargedTo: 'owner', pmSiName: 'Drill', pmSiAmount: '10,000', pmSiDate: '2026-10-01', pmSiNote: '', pmSiReason: '' });
  await S.submit();
  eq(calls.length, 1);
  eq(calls[0][0], 'pm_si_record');
  const a = calls[0][1];
  eq([a.p_project, a.p_charged_to, a.p_item_name, a.p_amount, a.p_bought_on, a.p_note, a.p_receipt_path],
     ['A', 'owner', 'Drill', '10000', '2026-10-01', null, null]);
  ok(typeof a.p_op_id === 'string' && a.p_op_id.length > 0, 'op id');
  eq([reloaded, $('pmSiModal').style.display], [1, 'none']);
});
test('C2 a failed save keeps the form open and the SAME op id is reused on retry', async () => {
  const { sb, S, calls, $ } = load();
  S.mount($('pmSiPanel'), { projectId: 'A', items: [], canEdit: true, companyId: OWNER });
  S.openAdd();
  fill($, { pmSiChargedTo: 'owner', pmSiName: 'Drill', pmSiAmount: '1', pmSiDate: '2026-10-01', pmSiNote: '', pmSiReason: '' });
  sb.ctx.__rpcReply = () => ({ data: null, error: { message: 'network down' } });
  await S.submit();
  eq($('pmSiErr').textContent, 'network down');
  eq($('pmSiModal').style.display, 'flex');
  sb.ctx.__rpcReply = null;
  await S.submit();
  eq(calls[0][1].p_op_id, calls[1][1].p_op_id, 'same op id');
});
test('C3 invalid fields block the save and show field errors', async () => {
  const { S, calls, $ } = load();
  S.mount($('pmSiPanel'), { projectId: 'A', items: [], canEdit: true, companyId: OWNER });
  S.openAdd();
  fill($, { pmSiChargedTo: '', pmSiName: '', pmSiAmount: 'x', pmSiDate: '2026-10-01', pmSiNote: '', pmSiReason: '' });
  await S.submit();
  eq(calls.length, 0);
  ok($('err-pmSiChargedTo').textContent && $('err-pmSiName').textContent && $('err-pmSiAmount').textContent, 'field errors shown');
});
test('C4 receipt: uploaded once to pmSharing/<company>/…, path sent; retry does not upload again', async () => {
  const { sb, S, calls, uploads, $ } = load();
  S.mount($('pmSiPanel'), { projectId: 'A', items: [], canEdit: true, companyId: OWNER });
  S.openAdd();
  fill($, { pmSiChargedTo: 'partner', pmSiName: 'Phone', pmSiAmount: '5000', pmSiDate: '2026-10-01', pmSiNote: '', pmSiReason: '' });
  $('pmSiReceipt').files = [{ name: 'r.jpg' }];
  sb.ctx.__rpcReply = () => ({ data: null, error: { message: 'boom' } });
  await S.submit();
  sb.ctx.__rpcReply = null;
  await S.submit();
  eq(uploads, ['pmSharing/' + OWNER + '/2026-10/11111111-1111-4111-8111-111111111111.jpg']);
  eq(calls[1][1].p_receipt_path, uploads[0]);
});
test('C5 correct: prefilled, needs a reason, sends id + version, keeps the old receipt', async () => {
  const { S, calls, $ } = load();
  S.mount($('pmSiPanel'), { projectId: 'A', items: [it({ receipt_path: 'pmSharing/old.jpg', version: 3 })], canEdit: true, companyId: OWNER });
  S.openCorrect('i1');
  eq([$('pmSiName').value, $('pmSiAmount').value, $('pmSiChargedTo').value, $('pmSiReasonRow').style.display], ['Drill', '10000', 'owner', '']);
  await S.submit();
  eq(calls.length, 0, 'blocked without a reason');
  $('pmSiReason').value = 'wrong amount'; $('pmSiAmount').value = '9000';
  await S.submit();
  const a = calls[0][1];
  eq([calls[0][0], a.p_id, a.p_expected_version, a.p_amount, a.p_receipt_path, a.p_reason],
     ['pm_si_correct', 'i1', 3, '9000', 'pmSharing/old.jpg', 'wrong amount']);
});
test('C6 void: asks for a reason; cancel or blank sends nothing', async () => {
  const { sb, S, calls, $ } = load();
  S.mount($('pmSiPanel'), { projectId: 'A', items: [it({ version: 2 })], canEdit: true, companyId: OWNER });
  sb.ctx.prompt = () => null; await S.voidItem('i1');
  sb.ctx.prompt = () => '   '; await S.voidItem('i1');
  eq(calls.length, 0);
  sb.ctx.prompt = () => 'bought twice'; await S.voidItem('i1');
  eq([calls[0][0], calls[0][1].p_id, calls[0][1].p_expected_version, calls[0][1].p_reason], ['pm_si_void', 'i1', 2, 'bought twice']);
});
test('C7 view-only accounts cannot open the form or void', async () => {
  const { sb, S, calls, $ } = load();
  S.mount($('pmSiPanel'), { projectId: 'A', items: [it()], canEdit: false, companyId: OWNER });
  sb.ctx.prompt = () => 'x';
  S.openAdd(); S.openCorrect('i1'); await S.voidItem('i1');
  ok($('pmSiModal').style.display !== 'flex', 'form stays closed');
  eq(calls.length, 0);
});

test('C8 closeForm is a no-op while a save is in flight; the save keeps its original op id and values', async () => {
  const { sb, S, calls, $ } = load();
  S.mount($('pmSiPanel'), { projectId: 'A', items: [], canEdit: true, companyId: OWNER });
  let release; const gate = new Promise(r => { release = r; });
  sb.ctx.sbClient.storage = { from: () => ({ upload: async () => { await gate; return { error: null }; } }) };
  S.openAdd();
  fill($, { pmSiChargedTo: 'partner', pmSiName: 'Phone', pmSiAmount: '5000', pmSiDate: '2026-10-01', pmSiNote: '', pmSiReason: '' });
  $('pmSiReceipt').files = [{ name: 'r.jpg' }];
  const original = S._state.opId;
  const pending = S.submit();
  S.closeForm();
  eq($('pmSiModal').style.display, 'flex', 'stays open while busy');
  eq($('pmSiCancelBtn').disabled, true, 'cancel disabled');
  release();
  await pending;
  eq(calls.length, 1);
  eq([calls[0][1].p_op_id, calls[0][1].p_item_name, calls[0][1].p_project], [original, 'Phone', 'A']);
  eq($('pmSiModal').style.display, 'none');
});
test('C9 a reload failure after a good save is not reported as a failed save', async () => {
  const { sb, S, calls, $ } = load();
  const bad = async () => { throw new Error('refresh boom'); };
  S.mount($('pmSiPanel'), { projectId: 'A', items: [it({ version: 3 })], canEdit: true, companyId: OWNER, onChange: bad });
  S.openCorrect('i1');
  $('pmSiReason').value = 'typo';
  await S.submit();
  eq(calls[0][0], 'pm_si_correct');
  eq($('pmSiErr').textContent, '');
  const t = sb.toasts.map(x => x[0]);
  ok(t.includes('Saved, but the list could not refresh — reload the page.'), 'refresh toast: ' + t);
  ok(!t.some(x => /fail/i.test(x)), 'no failed-save toast');
  sb.toasts.length = 0;
  sb.ctx.prompt = () => 'dup';
  await S.voidItem('i1');
  const t2 = sb.toasts.map(x => x[0]);
  ok(t2.includes('Saved, but the list could not refresh — reload the page.'), 'void refresh toast: ' + t2);
  ok(!t2.some(x => /Void failed/.test(x)), 'no Void failed');
});
test('C10 receipt: blocked pop-up toasts and fetches nothing; a failed link closes the tab', async () => {
  const { sb, S, $ } = load();
  let signed = 0;
  sb.ctx.sbClient.storage = { from: () => ({ createSignedUrl: async () => { signed++; return { data: null, error: { message: 'x' } }; } }) };
  S.mount($('pmSiPanel'), { projectId: 'A', items: [it({ receipt_path: 'pmSharing/x.jpg' })], canEdit: false, companyId: OWNER });
  sb.ctx.open = () => null;
  await S.openReceipt('i1');
  eq(signed, 0);
  ok(sb.toasts.some(x => x[0] === 'Allow pop-ups to open the receipt.' && x[1]), 'popup toast');
  let closed = 0;
  sb.ctx.open = () => ({ close() { closed++; } });
  await S.openReceipt('i1');
  eq([signed, closed], [1, 1]);
  ok(sb.toasts.some(x => x[0] === 'Could not open the receipt.'), 'link toast');
});
test('C11 receipt opens for items rendered by panelHtml without mount (dashboard)', async () => {
  const { sb, S } = load();
  let signedPath = null, opened = 0;
  sb.ctx.sbClient.storage = { from: () => ({ createSignedUrl: async (p) => { signedPath = p; return { data: { signedUrl: 'u' }, error: null }; } }) };
  sb.ctx.open = () => { opened++; return { close() {} }; };
  S.panelHtml([it({ receipt_path: 'pmSharing/z.jpg' })], false);
  await S.openReceipt('i1');
  eq([signedPath, opened], ['pmSharing/z.jpg', 1]);
});
test('C12 print panel has no buttons at all', () => {
  const { S } = load();
  const h = S.panelHtml([it({ receipt_path: 'pmSharing/z.jpg' })], true, { print: true });
  ok(!h.includes('onclick') && !h.includes('Receipt') && !h.includes('Add item'), 'buttons in print');
  ok(h.includes('Drill'), 'item still listed');
});

// ══ D. Fences ════════════════════════════════════════════════════════
test('D1 only js/pm-sharing-items.js names the pm_si_* functions or item tables', () => {
  const dir = path.join(ROOT, 'js');
  for (const f of fs.readdirSync(dir).filter(n => n.endsWith('.js') && n !== 'pm-sharing-items.js'))
    ok(!/pm_si_|pm_sharing_item/.test(read('js/' + f)), 'js/' + f);
});
test('D2 the money model never names personal items', () => {
  const src = read('js/portal-app.compiled.js');
  for (const fn of ['_projSpent', '_projEarned', '_projMargin', '_recognisedProfit']) {
    const i = src.indexOf('function ' + fn);
    ok(i !== -1, 'SLICE NOT FOUND: ' + fn);
    const body = src.slice(i, src.indexOf('\nfunction ', i + 1));   // _projSpent is a one-liner: stop at the next function
    ok(!/PMShareItems|ItemsCents|AfterCents|pm_si_|personal item/i.test(body), fn);
  }
  const pmShare = read('js/pm-sharing.js');
  const dc = pmShare.slice(pmShare.indexOf('function directCost('), pmShare.indexOf('function split('));
  ok(dc.length > 0 && !/item/i.test(dc), 'PM direct cost never reads items');
});
test('D3 wiring: script tag after pm-sharing.js, modal markup present', () => {
  const html = read('admin.html');
  const a = html.indexOf('src="js/pm-sharing.js'), b = html.indexOf('src="js/pm-sharing-items.js');
  ok(b > a && a !== -1, 'script order');
  for (const id of ['pmSiModal', 'pmSiChargedTo', 'pmSiName', 'pmSiAmount', 'pmSiDate', 'pmSiNote', 'pmSiReceipt',
                    'pmSiReasonRow', 'pmSiReason', 'pmSiErr', 'pmSiSaveBtn', 'pmSiTitle'])
    ok(html.includes('id="' + id + '"'), 'missing #' + id);
});

// ── runner ───────────────────────────────────────────────────────────
(async () => {
  console.log('\nPM sharing personal items');
  for (const [name, fn] of queue) {
    try { await fn(); passed++; console.log('  ok  ' + name); }
    catch (e) { failed++; failures.push(name + ' — ' + e.message); console.log('  FAIL ' + name + '\n       ' + e.message); }
  }
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  if (failed) { console.log(failures.join('\n')); process.exit(1); }
})();
