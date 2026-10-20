// ════════════════════════════════════════════════════════════════════
// WORKER CASH ADVANCES — run with: node tests/cash-advance.test.js
// Spec: docs/superpowers/specs/2026-10-19-worker-cash-advances-design.md
// A drives js/cash-advance.js directly. B and C run the REAL screen files
// in the pm-admin sandbox (tests/helpers) — pm-admin.js is loaded but its
// projects grid is never opened, which is the "direct open" case.
// D checks the wiring and fences the ledger off from the money model.
// ════════════════════════════════════════════════════════════════════
'use strict';
process.env.TZ = 'Asia/Manila';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const CA = require('../js/cash-advance.js');
const { loadPmAdmin } = require('./helpers/pm-admin-sandbox.js');

let passed = 0, failed = 0;
const failures = [];
const queue = [];
function test(name, fn) { queue.push([name, fn]); }
function eq(a, b, label) {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error((label || 'value') + ': expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a));
}
function ok(c, label) { if (!c) throw new Error(label || 'expected truthy'); }

// ── shared fixtures ──────────────────────────────────────────────────
// pm-admin.js's real name helpers, the ones the screen borrows.
const PMA = loadPmAdmin();
const similar = PMA.ctx._pmNamesSimilar;
const groups = PMA.ctx._pmLaborNameGroups;

const PROJ = [{ id: 'P1', name: 'Alpha House' }, { id: 'P2', name: 'Beta Annex' }];
const ev = (kind, extra = {}) => ({ kind, at: '2026-10-01T02:00:00Z', actor_email: 'admin@dacs.test', changes: null, reason: null, repayment_id: null, ...extra });
const rep = (id, amount, extra = {}) => ({ id, amount, paid_on: '2026-10-08', payroll_ref: null, notes: null, created_at: '2026-10-08T02:00:00Z',
                                           voided_at: null, void_reason: null, voided_by_email: null, ...extra });
function adv(id, o = {}) {
  return { id, project_id: 'P1', project_name: 'Alpha House', project_deleted: false, worker_name: 'Francis Dela Cruz',
           issued_on: '2026-10-01', amount: 6000, suggest_pct: 30, notes: null, created_at: '2026-10-01T02:00:00Z', updated_at: null,
           voided_at: null, void_reason: null, voided_by_email: null, repayments: [], events: [ev('issued')], ...o };
}
// One project's daily bills (weeklyBills holds one doc per DAY; weekEndingDate is that day).
const BILLS = { P1: [
  { id: 'd1', weekEndingDate: '2026-10-07', entries: [
    { id: 'we_1', type: 'labor', details: 'Francis Dela Cruz', amount: 6450 },
    { id: 'we_2', type: 'labor', details: 'Danilo Reyes', amount: 3000 },
    { id: 'we_3', type: 'materials', details: 'Francis Dela Cruz', amount: 999 }] },
  { id: 'd2', weekEndingDate: '2026-10-08', entries: [
    // One payment split across two contracts — must show as ONE line.
    { id: 'we_4', type: 'labor', details: 'Franics Dela Cruz', amount: 2000, splitGroup: 'sp_1', splitIndex: 1, splitTotal: 2 },
    { id: 'we_5', type: 'labor', details: 'Franics Dela Cruz', amount: 1000, splitGroup: 'sp_1', splitIndex: 2, splitTotal: 2 }] },
  { id: 'd3', weekEndingDate: '2026-10-09', labor: 5000 },   // legacy total-only bill: no names
] };

// ══ A. Calculation (js/cash-advance.js) ═══════════════════════════════
test('A1 totals: unpaid / partial / fully paid / voided; voided repayments ignored', () => {
  eq(CA.totals(adv('a')), { amountCents: 600000, repaidCents: 0, balanceCents: 600000, status: 'unpaid', label: 'Unpaid' });
  eq(CA.totals(adv('a', { repayments: [rep('r', 1935)] })).status, 'partial');
  eq(CA.totals(adv('a', { repayments: [rep('r', 1935)] })).label, 'Partially Paid');
  eq(CA.totals(adv('a', { repayments: [rep('r', 6000)] })).label, 'Fully Paid');
  eq(CA.totals(adv('a', { repayments: [rep('r', 6000, { voided_at: '2026-10-09T00:00:00Z' })] })).balanceCents, 600000);
  eq(CA.totals(adv('a', { voided_at: '2026-10-09T00:00:00Z' })).label, 'Voided');
  eq(CA.totals(adv('a', { amount: 0.3, repayments: [rep('r1', 0.1), rep('r2', 0.2)] })).status, 'paid', 'no float drift');
});
test('A2 suggestion: ₱6,450 × 30% = ₱1,935; capped; 0% / no basis / no balance → none', () => {
  eq(CA.suggestion(645000, 30, 600000), { raw: 193500, capped: 193500, isCapped: false, none: false });
  eq(CA.suggestion(645000, 30, 120000), { raw: 193500, capped: 120000, isCapped: true, none: false });
  eq(CA.suggestion(645000, 0, 600000).none, true);
  eq(CA.suggestion(0, 30, 600000).none, true);
  eq(CA.suggestion(645000, 30, 0).none, true);
  eq(CA.suggestion(645000, 100, 900000).raw, 645000);
  eq(CA.suggestion(100000, 33.33, 900000).raw, 33330);
  eq(CA.suggestion(5, 30, 900000).raw, 2, 'half-up on centavos (1.5 → 2)');
  eq(CA.suggestion(1, 1, 900000).none, true, 'rounds to nothing → none');
  eq(CA.suggestion(999999995001, 99.99, 999999995001), { raw: 999899995001, capped: 999899995001, isCapped: false, none: false }, 'maximum rounding boundary');
});
test('A3 parseAmount: commas and ₱ allowed; >2 decimals rejected, never rounded', () => {
  eq(CA.parseAmount('1,935'), { ok: true, value: 1935, cents: 193500 });
  eq(CA.parseAmount('₱ 6,450.50'), { ok: true, value: 6450.5, cents: 645050 });
  eq(CA.parseAmount('100.005'), { ok: false, error: 'Amounts can have at most two decimal places.' });
  for (const s of ['0', '0.00', '-5', 'abc', '', '12345678901', '1.'])
    eq(CA.parseAmount(s), { ok: false, error: 'Enter an amount above ₱0.' }, s);
});
test('A4 parsePct: 0–100, two decimals at most', () => {
  eq(CA.parsePct('30'), { ok: true, value: 30 });
  eq(CA.parsePct('0'), { ok: true, value: 0 });
  eq(CA.parsePct('100'), { ok: true, value: 100 });
  eq(CA.parsePct('12.5%'), { ok: true, value: 12.5 });
  eq(CA.parsePct('100.01'), { ok: false, error: 'Suggested % must be 0 to 100.' });
  eq(CA.parsePct(''), { ok: false, error: 'Suggested % must be 0 to 100.' });
  eq(CA.parsePct('30.125'), { ok: false, error: 'Suggested % can have at most two decimal places.' });
});
test('A5 laborLines: fuzzy name, Labor only, split legs merged, newest first', () => {
  eq(CA.laborLines(BILLS.P1, 'Francis Dela Cruz', similar), [
    { key: 'd2|sp:sp_1', billId: 'd2', entryIds: ['we_4', 'we_5'], day: '2026-10-08', details: 'Franics Dela Cruz', cents: 300000 },
    { key: 'd1|e:we_1', billId: 'd1', entryIds: ['we_1'], day: '2026-10-07', details: 'Francis Dela Cruz', cents: 645000 }]);
  eq(CA.laborLines(BILLS.P1, 'Francis Dela Cruz').map(l => l.key), ['d1|e:we_1'], 'no helper → exact names only');
  // pm-admin treats an entry with no/unknown type as Labor; so do we.
  eq(CA.laborLines([{ id: 'd9', weekEndingDate: '2026-10-01', entries: [{ id: 'x', details: 'Francis Dela Cruz', amount: 100 }] }],
                   'Francis Dela Cruz', similar).length, 1);
  eq(CA.laborLines([], 'Francis', similar), []);
});
test('A6 payrollRef is the snapshot the server stores', () => {
  const line = CA.laborLines(BILLS.P1, 'Francis Dela Cruz', similar)[1];
  eq(CA.payrollRef(line), { billId: 'd1', entryIds: ['we_1'], day: '2026-10-07', details: 'Francis Dela Cruz', amount: 6450 });
});
test('A7 nameSuggestions: grouped by pm-admin, exact without it', () => {
  eq(CA.nameSuggestions(BILLS.P1, groups), ['Danilo Reyes', 'Franics Dela Cruz']);
  eq(CA.nameSuggestions(BILLS.P1), ['Danilo Reyes', 'Francis Dela Cruz', 'Franics Dela Cruz']);
});
test('A8 listSummary: totals skip voided; filters; newest issue first', () => {
  const list = [adv('a1', { repayments: [rep('r1', 1935)] }), adv('a2', { worker_name: 'Danilo Reyes', amount: 1000, issued_on: '2026-09-20', repayments: [rep('r2', 1000)] }),
                adv('a3', { amount: 500, voided_at: '2026-09-26T01:00:00Z' }), adv('a4', { worker_name: 'Ana Santos', amount: 2000, issued_on: '2026-10-05', project_id: 'P9' })];
  const base = { worker: '', project: '', status: 'all', showVoided: false };
  const s = CA.listSummary(list, base, similar);
  eq(s.rows.map(r => r.adv.id), ['a4', 'a1', 'a2']);
  eq(s.totals, { advancedCents: 900000, repaidCents: 293500, outstandingCents: 606500 });
  eq(CA.listSummary(list, { ...base, showVoided: true }, similar).rows.map(r => r.adv.id), ['a4', 'a1', 'a3', 'a2']);
  eq(CA.listSummary(list, { ...base, showVoided: true }, similar).totals.advancedCents, 900000, 'voided never counts');
  eq(CA.listSummary(list, { ...base, status: 'paid' }, similar).rows.map(r => r.adv.id), ['a2']);
  eq(CA.listSummary(list, { ...base, status: 'unpaid', showVoided: true }, similar).rows.map(r => r.adv.id), ['a4'], 'voided only under All');
  eq(CA.listSummary(list, { ...base, worker: 'Franics Dela Cruz' }, similar).rows.map(r => r.adv.id), ['a1'], 'typo');
  eq(CA.listSummary(list, { ...base, worker: 'ana' }, similar).rows.map(r => r.adv.id), ['a4'], 'part of a name');
  eq(CA.listSummary(list, { ...base, project: 'P9' }, similar).rows.map(r => r.adv.id), ['a4']);
});
test('A9 projectOptions: live projects plus deleted ones taken from advances', () => {
  eq(CA.projectOptions(PROJ, [adv('a', { project_id: 'P9', project_name: 'Old Site', project_deleted: true }), adv('b')]), [
    { id: 'P1', label: 'Alpha House', deleted: false }, { id: 'P2', label: 'Beta Annex', deleted: false },
    { id: 'P9', label: 'Old Site (project deleted)', deleted: true }]);
});
test('A10 errorText: server codes → plain messages; anything else is unknown', () => {
  const t = CA.totals(adv('a', { repayments: [rep('r', 1935)] }));
  eq(CA.errorText('OVER_BALANCE', t), { code: 'OVER_BALANCE', known: true, text: "That's more than the remaining balance of ₱4,065.00." });
  eq(CA.errorText('BELOW_REPAID', t).text, "The amount can't be lower than the ₱1,935.00 already repaid.");
  eq(CA.errorText('ALREADY_VOIDED').text, 'This was already voided.');
  eq(CA.errorText('VOIDED').text, 'This was already voided.');
  eq(CA.errorText('HAS_REPAYMENTS').text, "Void this advance's repayments first.");
  eq(CA.errorText('OWNER_ONLY').text, 'Only owner accounts can use Cash Advances.');
  eq(CA.errorText('BAD_PRECISION').text, 'Amounts can have at most two decimal places.');
  eq(CA.errorText('Failed to fetch'), { code: '', known: false, text: 'Failed to fetch' });
  ok(CA.RELOAD_CODES.includes('OVER_BALANCE') && CA.RELOAD_CODES.includes('ALREADY_VOIDED'), 'reload codes');
});
test('A11 dateKey uses local parts (PH, UTC+8)', () => {
  eq(CA.dateKey(new Date(2026, 9, 19, 0, 30)), '2026-10-19');
  ok(/^\d{4}-\d{2}-\d{2}$/.test(CA.dateKey()), 'today');
});
test('A12 newOpId: v4 uuids, never repeated', () => {
  const ids = new Set(Array.from({ length: 50 }, () => CA.newOpId()));
  eq(ids.size, 50);
  ids.forEach(id => ok(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id), id));
});
test('A13 pesos / fmtPct / DEFAULT_PCT', () => {
  eq([CA.pesos(645000), CA.pesos(0), CA.pesos(-150)], ['₱6,450.00', '₱0.00', '−₱1.50']);
  eq([CA.fmtPct(30), CA.fmtPct('12.50'), CA.fmtPct(33.333)], ['30', '12.5', '33.33']);
  eq(CA.DEFAULT_PCT, 30);
});
test('A14 server wrappers use exact RPC names and payloads', async () => {
  const calls = [];
  const old = global.sbClient;
  global.sbClient = { rpc: async (name, args) => { calls.push([name, args]); return { data: { name }, error: null }; } };
  try {
    await CA.server.list();
    await CA.server.projects();
    await CA.server.recordAdvance('op-a', { projectId: 'p1', worker: 'W', issuedOn: '2026-10-01', amount: 6000, pct: 30, notes: 'rent advance' });
    await CA.server.editAdvance('op-b', 'a1', { projectId: 'p1', worker: 'W2', issuedOn: '2026-10-02', amount: 5000, pct: 25, notes: 'updated agreement' });
    await CA.server.recordRepayment('op-c', 'a1', { paidOn: '2026-10-03', amount: 1000, payrollRef: { billId: 'b1', entryIds: ['e1'], day: '2026-10-02', details: 'W2', amount: 2500 }, notes: 'cash returned' });
    await CA.server.voidRepayment('op-d', 'r1', 'duplicate');
    await CA.server.voidAdvance('op-e', 'a1', 'wrong worker');
  } finally { global.sbClient = old; }
  eq(calls, [
    ['pm_ca_list', {}], ['pm_ca_projects', {}],
    ['pm_ca_record_advance', { p_op_id: 'op-a', p_project: 'p1', p_worker: 'W', p_issued_on: '2026-10-01', p_amount: 6000, p_pct: 30, p_notes: 'rent advance' }],
    ['pm_ca_edit_advance', { p_op_id: 'op-b', p_id: 'a1', p_project: 'p1', p_worker: 'W2', p_issued_on: '2026-10-02', p_amount: 5000, p_pct: 25, p_notes: 'updated agreement' }],
    ['pm_ca_record_repayment', { p_op_id: 'op-c', p_advance: 'a1', p_paid_on: '2026-10-03', p_amount: 1000, p_payroll_ref: { billId: 'b1', entryIds: ['e1'], day: '2026-10-02', details: 'W2', amount: 2500 }, p_notes: 'cash returned' }],
    ['pm_ca_void_repayment', { p_op_id: 'op-d', p_repayment: 'r1', p_reason: 'duplicate' }],
    ['pm_ca_void_advance', { p_op_id: 'op-e', p_id: 'a1', p_reason: 'wrong worker' }],
  ]);
});

// ── screen sandbox ───────────────────────────────────────────────────
// The real pm-admin.js is loaded (for its name helpers) but its projects
// grid is never opened — exactly the "open Cash Advances directly" case.
function fakeDb(bills, failFor) {
  const calls = [];
  return { calls, collection: (c) => ({ doc: (pid) => ({ collection: (sub) => ({ get: async () => {
    calls.push([c, pid, sub]);
    if (failFor && failFor.includes(pid)) throw new Error('offline');
    return { docs: (bills[pid] || []).map(b => ({ id: b.id, data: () => { const { id, ...rest } = b; return rest; } })) };
  } }) }) }) };
}
function fakeApi(advances, projects = PROJ) {
  const api = { calls: [], state: { advances } };
  api.list = async () => { api.calls.push(['list']); return JSON.parse(JSON.stringify(api.state.advances)); };
  api.projects = async () => { api.calls.push(['projects']); return projects; };
  return api;
}
const SCREEN_FILES = ['js/cash-advance.js', 'js/cash-advance-admin.js', 'js/cash-advance-forms.js'];
function loadCA(role, opts = {}) {
  const sb = loadPmAdmin({ role });
  sb.ctx.crypto = globalThis.crypto;
  sb.db = fakeDb(opts.bills || BILLS, opts.billsFail);
  sb.ctx.db = sb.db;
  sb.cleanups = [];
  sb.ctx.registerViewCleanup = (fn) => sb.cleanups.push(fn);
  sb.reports = [];
  sb.ctx._dacsReportError = (...a) => sb.reports.push(a);
  for (const f of SCREEN_FILES) vm.runInContext(read(f), sb.ctx, { filename: f });
  sb.D = sb.ctx.CashAdvanceAdmin;
  const html = (id) => sb.ctx.document.getElementById(id).innerHTML;
  sb.root = () => html('pmCashAdvancesRoot');
  sb.results = () => html('pmCashAdvancesResults');
  sb.modal = () => html('pmCashAdvancesModal');
  return sb;
}
const ADVANCES = () => [
  adv('a1', { repayments: [rep('r1', 1935, { payroll_ref: { billId: 'd1', entryIds: ['we_1'], day: '2026-10-07', details: 'Francis Dela Cruz', amount: 6450 } })],
              events: [ev('issued'), ev('repaid', { repayment_id: 'r1' })] }),
  adv('a2', { worker_name: 'Danilo Reyes', amount: 1000, issued_on: '2026-09-20', repayments: [rep('r2', 1000)],
              events: [ev('issued'), ev('repaid', { repayment_id: 'r2' })] }),
  adv('a3', { worker_name: 'Voided Worker', amount: 500, issued_on: '2026-09-25', voided_at: '2026-09-26T01:00:00Z',
              void_reason: 'Wrong worker', voided_by_email: 'admin@dacs.test', events: [ev('issued'), ev('voided', { reason: 'Wrong worker' })] }),
  adv('a4', { worker_name: 'Ana Santos', amount: 2000, issued_on: '2026-08-02', project_id: 'P9', project_name: 'Old Site', project_deleted: true }),
];

// ══ B. Screens — list and detail (real cash-advance-admin.js) ═════════
test('B1 owner: list loads; totals skip voided; rows show status and a deleted project', async () => {
  const sb = loadCA('owner'); const api = fakeApi(ADVANCES()); sb.D._setApi(api);
  await sb.D.init();
  for (const s of ['Cash Advances', '+ New advance', 'Tracking only', 'Show voided']) ok(sb.root().includes(s), 'shell missing: ' + s);
  const r = sb.results();
  for (const s of ['₱9,000.00', '₱2,935.00', '₱6,065.00', 'Francis Dela Cruz', 'Partially Paid', 'Danilo Reyes', 'Fully Paid',
                   'Ana Santos', 'Unpaid', 'Old Site', '(project deleted)']) ok(r.includes(s), 'results missing: ' + s);
  ok(!r.includes('Voided Worker'), 'voided hidden by default');
  eq(api.calls.map(c => c[0]).sort(), ['list', 'projects']);
  eq(sb.db.calls.length, 0, 'the list never reads payroll');
});
test('B2 staff: nothing rendered, nothing fetched', async () => {
  const sb = loadCA('staff'); const api = fakeApi(ADVANCES()); sb.D._setApi(api);
  await sb.D.init();
  eq(sb.root(), '');
  eq(api.calls.length, 0);
});
test('B3 filters: status, show voided, worker (typo and part), deleted project', async () => {
  const sb = loadCA('owner'); sb.D._setApi(fakeApi(ADVANCES())); await sb.D.init();
  const names = () => ['Francis Dela Cruz', 'Danilo Reyes', 'Voided Worker', 'Ana Santos'].filter(n => sb.results().includes(n));
  sb.D.setFilter('status', 'paid'); eq(names(), ['Danilo Reyes']);
  sb.D.setFilter('status', 'all'); sb.D.setFilter('showVoided', true);
  eq(names(), ['Francis Dela Cruz', 'Danilo Reyes', 'Voided Worker', 'Ana Santos']);
  ok(sb.results().includes('pca-badge--voided'), 'voided badge');
  sb.D.setFilter('showVoided', false);
  sb.D.setFilter('worker', 'Franics Dela Cruz'); eq(names(), ['Francis Dela Cruz'], 'typo still finds the worker');
  sb.D.setFilter('worker', 'ana'); eq(names(), ['Ana Santos'], 'part of a name');
  sb.D.setFilter('worker', ''); sb.D.setFilter('project', 'P9'); eq(names(), ['Ana Santos']);
  ok(sb.root().includes('Old Site (project deleted)'), 'deleted project offered in the filter');
  sb.D.setFilter('project', ''); sb.D.setFilter('status', 'unpaid'); eq(names(), ['Ana Santos']);
});
test('B4 detail of a partly repaid advance', async () => {
  const sb = loadCA('owner'); sb.D._setApi(fakeApi(ADVANCES())); await sb.D.init();
  sb.D.open('a1');
  const h = sb.root();
  for (const s of ['← Cash Advances', 'Francis Dela Cruz', 'Alpha House', '₱6,000.00', '₱1,935.00', '₱4,065.00', '30% of payroll',
                   'Record repayment', 'Edit advance', 'Void advance', 'Void its repayments first.', 'Advance issued',
                   'Repayment ₱1,935.00', 'From payroll: Oct 7, 2026 · Francis Dela Cruz · ₱6,450.00'])
    ok(h.includes(s), 'missing: ' + s);
  ok(h.includes('pca-btn--danger" disabled'), 'Void advance disabled while a repayment is live');
  ok(h.includes("CashAdvanceAdmin.openVoid('repayment', 'r1')"), 'a live repayment can be voided');
  sb.D.close();
  ok(sb.root().includes('+ New advance'), 'back to the list');
});
test('B5 detail: fully paid has no Record repayment; a voided advance is read-only', async () => {
  const sb = loadCA('owner'); sb.D._setApi(fakeApi(ADVANCES())); await sb.D.init();
  sb.D.open('a2');
  ok(!sb.root().includes('Record repayment'), 'fully paid');
  ok(sb.root().includes('Edit advance'), 'still editable');
  sb.D.open('a3');
  const h = sb.root();
  ok(h.includes('Wrong worker') && h.includes('admin@dacs.test') && h.includes('Advance voided'), 'void shown with who and why');
  ok(!h.includes('Record repayment') && !h.includes('Edit advance') && !h.includes('Void advance'), 'no actions on a voided advance');
});
test('B6 history: original issue amount, edits old → new, a struck-through voided repayment', async () => {
  const list = [adv('a5', { amount: 6500,
    repayments: [rep('r5', 500, { voided_at: '2026-10-09T03:00:00Z', void_reason: 'Entered twice', voided_by_email: 'admin-pm@dacs.test' })],
    events: [ev('issued'), ev('edited', { changes: { amount: [6000, 6500], worker_name: ['Francis', 'Francis Dela Cruz'] } }),
             ev('repaid', { repayment_id: 'r5' }), ev('repayment_voided', { repayment_id: 'r5', reason: 'Entered twice' })] })];
  const sb = loadCA('owner'); sb.D._setApi(fakeApi(list)); await sb.D.init();
  sb.D.open('a5');
  const h = sb.root();
  for (const s of ['Advance issued</b> — ₱6,000.00', 'Amount ₱6,000.00 → ₱6,500.00', 'Worker Francis → Francis Dela Cruz',
                   'class="is-void"', 'by admin-pm@dacs.test — Entered twice', 'Repayment of ₱500.00 voided</b> — Entered twice'])
    ok(h.includes(s), 'missing: ' + s);
  ok(!h.includes("openVoid('repayment', 'r5')"), 'a voided repayment cannot be voided again');
  ok(h.includes('₱6,500.00'), 'balance back to the full amount');
});
test('B7 payroll is fetched per project, cached, and dropped when the view is left', async () => {
  const sb = loadCA('owner'); sb.D._setApi(fakeApi(ADVANCES())); await sb.D.init();
  const r = await sb.D._h.loadBills('P1');
  eq([r.error, r.bills.length], [null, 3]);
  await sb.D._h.loadBills('P1');
  eq(sb.db.calls, [['constructionProjects', 'P1', 'weeklyBills']], 'second read served from the cache');
  ok(sb.cleanups.length >= 1, 'a view cleanup is registered');
  sb.cleanups.forEach(fn => fn());
  eq(Object.keys(sb.D._state.bills).length, 0);
  await sb.D._h.loadBills('P1');
  eq(sb.db.calls.length, 2, 're-opened view reads fresh payroll');
});
test('B8 a load failure shows a plain message and Retry', async () => {
  const sb = loadCA('owner'); const api = fakeApi(ADVANCES());
  api.list = async () => { throw new Error('OWNER_ONLY'); };
  sb.D._setApi(api); await sb.D.init();
  ok(sb.results().includes('Only owner accounts can use Cash Advances.') && sb.results().includes('Retry'), sb.results());
});
test('B9 the screen file never writes to the database', () => {
  const src = read('js/cash-advance-admin.js');
  ok(!/\.(set|update|add|delete)\(/.test(src), 'found a write call');
  ok(!/pm_ca_|pm_cash_advance/.test(src), 'the screen must go through window.CashAdvance.server');
});

// A fake server that applies writes to its own copy and answers like the RPCs.
function writeApi(advances) {
  const api = fakeApi(advances);
  const find = (id) => api.state.advances.find(a => a.id === id);
  const done = (id) => ({ advance: JSON.parse(JSON.stringify(find(id))) });
  api.recordAdvance = async (op, f) => {
    api.calls.push(['recordAdvance', op, f]);
    api.state.advances.push(adv('new1', { project_id: f.projectId, worker_name: f.worker, amount: f.amount,
                                          suggest_pct: f.pct, issued_on: f.issuedOn, notes: f.notes }));
    return done('new1');
  };
  api.editAdvance = async (op, id, f) => {
    api.calls.push(['editAdvance', op, id, f]);
    Object.assign(find(id), { worker_name: f.worker, amount: f.amount, suggest_pct: f.pct, issued_on: f.issuedOn, notes: f.notes });
    return done(id);
  };
  api.recordRepayment = async (op, id, f) => {
    api.calls.push(['recordRepayment', op, id, f]);
    const a = find(id);
    a.repayments.push(rep('rN' + a.repayments.length, f.amount, { paid_on: f.paidOn, payroll_ref: f.payrollRef }));
    return done(id);
  };
  api.voidRepayment = async (op, rid, reason) => {
    api.calls.push(['voidRepayment', op, rid, reason]);
    const a = api.state.advances.find(x => x.repayments.some(r => r.id === rid));
    Object.assign(a.repayments.find(r => r.id === rid), { voided_at: '2026-10-10T00:00:00Z', void_reason: reason });
    return done(a.id);
  };
  api.voidAdvance = async (op, id, reason) => {
    api.calls.push(['voidAdvance', op, id, reason]);
    Object.assign(find(id), { voided_at: '2026-10-10T00:00:00Z', void_reason: reason });
    return done(id);
  };
  return api;
}
const el = (sb, id) => sb.ctx.document.getElementById(id);
const setVal = (sb, id, v) => { el(sb, id).value = v; };
const errText = (sb) => el(sb, 'pcaFormError').textContent;
const calc = (sb) => el(sb, 'pcaCalc').innerHTML;
async function opened(list, opts) {
  const sb = loadCA('owner', opts); const api = writeApi(list || ADVANCES()); sb.D._setApi(api);
  await sb.D.init();
  return { sb, api };
}
const lineOf = (sb, billId) => sb.D._state.modal.lines.find(l => l.billId === billId);

// ══ C. Forms (real cash-advance-forms.js) ═════════════════════════════
test('C1 direct open: no projects grid, names load from the picked project payroll', async () => {
  const { sb } = await opened();
  ok(sb.ctx.CashAdvance && !sb.ctx.document.getElementById('pmProjectsGrid').innerHTML, 'pm-admin grid never rendered');
  sb.D.openAdvanceForm();
  ok(sb.modal().includes('New cash advance') && sb.modal().includes('id="pcaPct" class="pca-input" inputmode="decimal" value="30"'), 'default 30%');
  ok(sb.modal().includes('value="' + sb.ctx.CashAdvance.dateKey() + '"'), 'today, local');
  await sb.D.pickProject('P1');
  eq(sb.db.calls, [['constructionProjects', 'P1', 'weeklyBills']]);
  const dl = el(sb, 'pcaWorkerNames').innerHTML;
  ok(dl.includes('value="Franics Dela Cruz"') && dl.includes('value="Danilo Reyes"'), dl);
  ok(!dl.includes('value="Francis Dela Cruz"'), 'spelling variants grouped into one name');
});
test('C2 new advance: browser checks, then one server call with the typed values', async () => {
  const { sb, api } = await opened();
  sb.D.openAdvanceForm();
  const fill = (o) => { for (const [k, v] of Object.entries(o)) setVal(sb, k, v); };
  fill({ pcaProject: '', pcaWorker: 'Ana', pcaIssued: '2026-10-19', pcaAmount: '2,500.50', pcaPct: '30', pcaNotes: '' });
  await sb.D.saveAdvance(); eq(errText(sb), 'Choose a project.');
  fill({ pcaProject: 'P1', pcaPct: '101' }); await sb.D.saveAdvance(); eq(errText(sb), 'Suggested % must be 0 to 100.');
  fill({ pcaPct: '30.125' }); await sb.D.saveAdvance(); eq(errText(sb), 'Suggested % can have at most two decimal places.');
  fill({ pcaPct: '30', pcaAmount: '2500.505' }); await sb.D.saveAdvance(); eq(errText(sb), 'Amounts can have at most two decimal places.');
  fill({ pcaAmount: '0' }); await sb.D.saveAdvance(); eq(errText(sb), 'Enter an amount above ₱0.');
  fill({ pcaWorker: '  ', pcaAmount: '2,500.50' }); await sb.D.saveAdvance(); eq(errText(sb), "Enter the worker's name.");
  fill({ pcaWorker: 'Ana' }); await sb.D.saveAdvance();
  const calls = api.calls.filter(c => c[0] === 'recordAdvance');
  eq(calls.length, 1, 'refused-in-browser attempts never reached the server');
  eq(calls[0][2], { projectId: 'P1', worker: 'Ana', issuedOn: '2026-10-19', amount: 2500.5, pct: 30, notes: null });
  ok(/^[0-9a-f-]{36}$/.test(calls[0][1]), 'op id sent');
  eq(sb.modal(), '', 'closed');
  ok(sb.results().includes("CashAdvanceAdmin.open('new1')"), 'listed');
});
test('C3 edit: amount shows the repaid floor; below it is refused before the server', async () => {
  const { sb, api } = await opened();
  sb.D.openAdvanceForm('a1');
  const m = sb.modal();
  ok(m.includes('Edit advance') && m.includes('value="6000.00"') && m.includes("Can't go below ₱1,935.00 already repaid."), m);
  for (const [k, v] of Object.entries({ pcaProject: 'P1', pcaWorker: 'Francis Dela Cruz', pcaIssued: '2026-10-01', pcaAmount: '1000', pcaPct: '30', pcaNotes: '' }))
    setVal(sb, k, v);
  await sb.D.saveAdvance();
  eq(errText(sb), "The amount can't be lower than the ₱1,935.00 already repaid.");
  setVal(sb, 'pcaAmount', '6500');
  await sb.D.saveAdvance();
  const c = api.calls.find(x => x[0] === 'editAdvance');
  eq([c[2], c[3].amount], ['a1', 6500]);
  eq(sb.modal(), '');
});
test('C4 repayment form: the worker\'s Labor lines, newest first, split legs as one; amount starts empty', async () => {
  const { sb } = await opened();
  await sb.D.openRepaymentForm('a1');
  const sel = el(sb, 'pcaBasis').innerHTML;
  ok(sel.indexOf('Oct 8, 2026') > -1 && sel.indexOf('Oct 8, 2026') < sel.indexOf('Oct 7, 2026'), 'newest first: ' + sel);
  ok(sel.includes('₱3,000.00') && !sel.includes('₱2,000.00') && !sel.includes('₱1,000.00'), 'split shown once, not its parts');
  ok(!sel.includes('Danilo') && !sel.includes('₱999.00') && !sel.includes('₱5,000.00'), 'other worker / materials / total-only excluded');
  ok(sel.includes('value="typed">Type an amount'), 'typed basis offered');
  ok(sb.modal().includes('id="pcaAmt" class="pca-input" inputmode="decimal" value=""'), 'actual amount starts empty');
  ok(sb.modal().includes('Balance <b>₱4,065.00</b>'), 'balance shown');
});
test('C5 suggestion from a payroll line; Use copies it, nothing else does', async () => {
  const { sb } = await opened();
  await sb.D.openRepaymentForm('a1');
  sb.D.pickBasis(lineOf(sb, 'd1').key);
  ok(calc(sb).includes('₱6,450.00 × 30% = <b>₱1,935.00</b> suggested'), calc(sb));
  ok(calc(sb).includes('Use ₱1,935.00') && calc(sb).includes('Suggestion only — nothing is deducted.'), calc(sb));
  eq(el(sb, 'pcaAmt').value, '', 'a suggestion never fills the amount by itself');
  eq(el(sb, 'pcaLinkWrap').style.display, '', 'link option shown for a picked line');
  sb.D.useSuggestion();
  eq(el(sb, 'pcaAmt').value, '1935.00');
});
test('C6 capped at the balance; 0% → No suggestion and no Use button', async () => {
  const list = [adv('a6', { repayments: [rep('r6', 4800)] }), adv('a7', { suggest_pct: 0 })];
  const { sb } = await opened(list);
  await sb.D.openRepaymentForm('a6');
  sb.D.pickBasis(lineOf(sb, 'd1').key);
  ok(calc(sb).includes('<b>₱1,935.00</b> suggested') && calc(sb).includes('capped at the balance, <b>₱1,200.00</b>')
     && calc(sb).includes('Use ₱1,200.00'), calc(sb));
  sb.D.closeModal();
  await sb.D.openRepaymentForm('a7');
  sb.D.pickBasis(lineOf(sb, 'd1').key);
  ok(calc(sb).includes('No suggestion') && !calc(sb).includes('pcaUse') && calc(sb).includes('Suggestion only — nothing is deducted.'), calc(sb));
});
test('C7 a typed payroll amount only feeds the suggestion — never the repayment or a reference', async () => {
  const { sb, api } = await opened();
  await sb.D.openRepaymentForm('a1');
  sb.D.pickBasis('typed');
  eq([el(sb, 'pcaBasisTyped').style.display, el(sb, 'pcaLinkWrap').style.display], ['', 'none']);
  setVal(sb, 'pcaBasisAmt', '6450'); sb.D.renderCalc();
  ok(calc(sb).includes('<b>₱1,935.00</b> suggested'), calc(sb));
  eq(el(sb, 'pcaAmt').value, '');
  setVal(sb, 'pcaAmt', '1000'); setVal(sb, 'pcaPaidOn', '2026-10-09'); setVal(sb, 'pcaRepNotes', '');
  await sb.D.saveRepayment();
  eq(api.calls.find(x => x[0] === 'recordRepayment')[3], { paidOn: '2026-10-09', amount: 1000, notes: null, payrollRef: null });
});
test('C8 a linked payroll line is saved as a snapshot; unticked saves none', async () => {
  const { sb, api } = await opened();
  await sb.D.openRepaymentForm('a1');
  sb.D.pickBasis(lineOf(sb, 'd2').key);
  el(sb, 'pcaLinkRef').checked = true;
  setVal(sb, 'pcaAmt', '500'); setVal(sb, 'pcaPaidOn', '2026-10-09'); setVal(sb, 'pcaRepNotes', 'agreed with Francis');
  await sb.D.saveRepayment();
  eq(api.calls.find(x => x[0] === 'recordRepayment')[3], { paidOn: '2026-10-09', amount: 500, notes: 'agreed with Francis',
     payrollRef: { billId: 'd2', entryIds: ['we_4', 'we_5'], day: '2026-10-08', details: 'Franics Dela Cruz', amount: 3000 } });
  await sb.D.openRepaymentForm('a1');
  sb.D.pickBasis(lineOf(sb, 'd1').key);
  el(sb, 'pcaLinkRef').checked = false;
  setVal(sb, 'pcaAmt', '100'); setVal(sb, 'pcaRepNotes', '');
  await sb.D.saveRepayment();
  eq(api.calls.filter(x => x[0] === 'recordRepayment')[1][3].payrollRef, null);
});
test('C9 browser checks before the server: ≤ ₱0, three decimals, over the balance', async () => {
  const { sb, api } = await opened();
  await sb.D.openRepaymentForm('a1');
  setVal(sb, 'pcaPaidOn', '2026-10-09');
  for (const [v, msg] of [['0', 'Enter an amount above ₱0.'], ['10.005', 'Amounts can have at most two decimal places.'],
                          ['4065.01', "That's more than the remaining balance of ₱4,065.00."]]) {
    setVal(sb, 'pcaAmt', v); await sb.D.saveRepayment(); eq(errText(sb), msg, v);
  }
  eq(api.calls.filter(x => x[0] === 'recordRepayment').length, 0);
});
test('C10 a double-click records once and shows Saving…', async () => {
  const { sb, api } = await opened();
  const real = api.recordRepayment;
  api.recordRepayment = async (...a) => { await new Promise(r => setTimeout(r, 5)); return real(...a); };
  await sb.D.openRepaymentForm('a1');
  setVal(sb, 'pcaAmt', '1000'); setVal(sb, 'pcaPaidOn', '2026-10-09');
  const p1 = sb.D.saveRepayment();
  eq([el(sb, 'pcaSave').disabled, el(sb, 'pcaSave').textContent], [true, 'Saving…']);
  const p2 = sb.D.saveRepayment();
  await Promise.all([p1, p2]);
  eq(api.calls.filter(x => x[0] === 'recordRepayment').length, 1);
});
test('C11 a network failure keeps the op id, so the retry can only record once', async () => {
  const { sb, api } = await opened();
  const real = api.recordRepayment; let first = true;
  api.recordRepayment = async (op, ...rest) => {
    api.calls.push(['attempt', op]);
    if (first) { first = false; throw new Error('Failed to fetch'); }
    return real(op, ...rest);
  };
  await sb.D.openRepaymentForm('a1');
  setVal(sb, 'pcaAmt', '1000'); setVal(sb, 'pcaPaidOn', '2026-10-09');
  await sb.D.saveRepayment();
  ok(errText(sb).startsWith("Couldn't save"), errText(sb));
  eq(el(sb, 'pcaSave').disabled, false, 'button usable again');
  ok(sb.modal() !== '', 'form still open');
  await sb.D.saveRepayment();
  const attempts = api.calls.filter(x => x[0] === 'attempt');
  eq(attempts.length, 2); eq(attempts[0][1], attempts[1][1], 'same op id on the retry');
  eq(sb.modal(), '', 'closed after success');
  eq(sb.reports.length, 1, 'the unknown failure was reported once');
  await sb.D.openRepaymentForm('a1');
  ok(sb.D._state.modal.opId !== attempts[0][1], 'a new form gets a new op id');
});
test('C12 a server refusal reloads first, then explains with the fresh balance', async () => {
  const { sb, api } = await opened();
  api.recordRepayment = async () => {
    api.state.advances[0].repayments.push(rep('rX', 3565));   // someone else repaid meanwhile
    throw new Error('OVER_BALANCE');
  };
  await sb.D.openRepaymentForm('a1');
  setVal(sb, 'pcaAmt', '1000'); setVal(sb, 'pcaPaidOn', '2026-10-09');
  await sb.D.saveRepayment();
  eq(api.calls.filter(c => c[0] === 'list').length, 2, 'reloaded');
  eq(errText(sb), "That's more than the remaining balance of ₱500.00.");
  ok(sb.modal() !== '', 'form stays open');
});
test('C13 payroll that cannot load: typed basis offered, names simply absent', async () => {
  const { sb } = await opened(null, { billsFail: ['P1'] });
  await sb.D.openRepaymentForm('a1');
  eq(el(sb, 'pcaLinesNote').textContent, "Payroll lines couldn't load — type an amount instead.");
  eq([sb.D._state.modal.basis, el(sb, 'pcaBasisTyped').style.display], ['typed', '']);
  ok(el(sb, 'pcaBasis').innerHTML.includes('Type an amount'));
  sb.D.closeModal();
  sb.D.openAdvanceForm();
  eq(await sb.D.pickProject('P1'), []);
  eq(el(sb, 'pcaWorkerNames').innerHTML, '');
});
test('C14 voids: reason required; an advance with live repayments cannot open the void', async () => {
  const { sb, api } = await opened();
  sb.D.openVoid('advance', 'a1');
  eq(sb.modal(), '', 'blocked while r1 is live');
  sb.D.openVoid('repayment', 'r1');
  ok(sb.modal().includes('Void repayment') && sb.modal().includes('stays in the history'), sb.modal());
  setVal(sb, 'pcaVoidReason', '   '); await sb.D.saveVoid(); eq(errText(sb), 'Give a reason for voiding.');
  setVal(sb, 'pcaVoidReason', 'Entered twice'); await sb.D.saveVoid();
  const c = api.calls.find(x => x[0] === 'voidRepayment');
  eq([c[2], c[3]], ['r1', 'Entered twice']);
  sb.D.open('a1');
  ok(sb.root().includes('Entered twice') && !sb.root().includes('pca-btn--danger" disabled'), 'balance restored, void advance enabled');
  sb.D.openVoid('advance', 'a1');
  setVal(sb, 'pcaVoidReason', 'Wrong worker'); await sb.D.saveVoid();
  eq(api.calls.find(x => x[0] === 'voidAdvance').slice(2), ['a1', 'Wrong worker']);
});
test('C15 without pm-admin.js name helpers: exact matching, reported once', async () => {
  const sb = loadCA('owner');
  sb.ctx._pmNamesSimilar = undefined; sb.ctx._pmLaborNameGroups = undefined;
  sb.D._setApi(writeApi(ADVANCES())); await sb.D.init();
  await sb.D.openRepaymentForm('a1');
  const sel = el(sb, 'pcaBasis').innerHTML;
  ok(sel.includes('Oct 7, 2026') && !sel.includes('Oct 8, 2026'), 'exact spelling only: ' + sel);
  sb.D.closeModal();
  sb.D.openAdvanceForm();
  const names = await sb.D.pickProject('P1');
  eq(names, ['Danilo Reyes', 'Francis Dela Cruz', 'Franics Dela Cruz']);
  eq(sb.reports.length, 1);
});
test('C16 the forms file never writes to the database or names the server functions', () => {
  const src = read('js/cash-advance-forms.js');
  ok(!/\.(set|update|add|delete)\(/.test(src), 'found a write call');
  ok(!/pm_ca_|pm_cash_advance/.test(src), 'must go through window.CashAdvance.server');
});

// ══ D. Wiring and isolation ═══════════════════════════════════════════
test('D1 nav: PM entry, owner-only filter, staff sidebar hide, view title', () => {
  const adm = read('js/admin.js');
  const pmBlock = adm.slice(adm.indexOf("{ id: 'pm', label: 'Project Management'"), adm.indexOf("{ id: 'attendance'"));
  ok(/\{ view: 'pmCashAdvances',\s+label: 'Cash Advances',\s+icon: 'wallet' \}/.test(pmBlock), 'PRIMARY_NAV pm entry');
  ok(adm.includes("if (p.id === 'pm' && role !== 'owner') {") && adm.includes("m.view !== 'pmCashAdvances'"), '_visibleNav owner-only filter');
  ok(adm.includes("'warrantyFund', 'pmSharing', 'pmCashAdvances', 'quoteList', 'attAppUpdates'].forEach"), 'staff sidebar hide list');
  ok(adm.includes("pmCashAdvances:   'Cash Advances',"), 'admin.js view title');
});
test('D2 admin.html: sidebar item, container, title, owner-only bounce, init hook, scripts after pm-admin.js', () => {
  const html = read('admin.html');
  ok(html.includes('data-view="pmCashAdvances"'), 'sidebar item');
  ok(html.includes('id="pmCashAdvancesView"') && html.includes('id="pmCashAdvancesRoot"') && html.includes('id="pmCashAdvancesModal"'), 'container');
  ok(html.includes("pmCashAdvances:   'Cash Advances',"), 'title');
  ok(html.includes("if (view === 'pmCashAdvances' && currentUserRole !== 'owner') view = 'pmProjects';"), 'owner-only bounce');
  ok(html.includes("if (view === 'pmCashAdvances' && typeof initCashAdvances === 'function') initCashAdvances();"), 'init hook');
  const at = (s) => html.indexOf(s);
  ok(at('src="js/pm-admin.js') > 0 && at('src="js/cash-advance.js') > at('src="js/pm-admin.js'), 'logic after pm-admin.js (name helpers)');
  ok(at('src="js/cash-advance-admin.js') > at('src="js/cash-advance.js') && at('src="js/cash-advance-forms.js') > at('src="js/cash-advance-admin.js'), 'script order');
  ok(!/PM_VIEWS\s*=\s*\[[^\]]*pmCashAdvances/.test(html), 'not in PM_VIEWS (that starts the projects grid)');
});
test('D3 never on the client or partner portals', () => {
  for (const f of ['Client Management.html', 'Dacs Partnership.html'])
    ok(!/cash-advance|pmCashAdvances/.test(read(f)), f);
});
test('D4 isolation: no money, payroll, report, sharing or warranty file mentions cash advances', () => {
  const bad = /pm_ca_|pm_cash_advance|CashAdvance|cashAdvance|cash_advance|pmCashAdvances|cash-advance/;
  for (const f of ['js/portal-app.compiled.js', 'js/expenses-module.js', 'js/overhead-module.js', 'js/billing-allocation.js',
                   'js/pm-admin.js', 'js/pm-sharing.js', 'js/pm-sharing-dashboard.js', 'js/pm-report-print.js', 'js/warranty-fund.js',
                   'js/termination-requests.js', 'js/invoice-module.js', 'js/labor-invoice-module.js', 'js/print-utils.js',
                   'js/reimbursement-module.js', 'js/payment-requests.js'])
    ok(!bad.test(read(f)), f + ' mentions cash advances');
});
test('D5 only js/cash-advance.js names the server functions or tables', () => {
  const dir = path.join(ROOT, 'js');
  for (const f of fs.readdirSync(dir).filter(n => n.endsWith('.js') && n !== 'cash-advance.js'))
    ok(!/pm_ca_|pm_cash_advance/.test(read('js/' + f)), 'js/' + f);
  ok(read('js/cash-advance.js').includes("rpc('pm_ca_record_repayment'"), 'the wrappers live in cash-advance.js');
});
test('D6 the migration never writes or reads payroll, expenses or project rows', () => {
  const body = read('supabase/migrations/0100_pm_cash_advances.sql').replace(/--[^\n]*/g, '');
  ok(!/\b(insert\s+into|update|delete\s+from)\s+(weekly_bills|payroll|expenses|overhead_expenses|construction_projects|payment_requests|invoices|folders|labor_contracts|pm_labor_contracts|pm_project_companies)\b/i.test(body),
     'writes a money / project table');
  ok(!/\bweekly_bills\b/i.test(body), 'reads payroll');
});
test('D7 the --pm-* design tokens are defined for the Cash Advances view', () => {
  const css = read('css/pm-admin.css');
  const head = css.slice(0, css.indexOf('{'));
  ok(/#pmCashAdvancesView/.test(head), 'the first token rule must include #pmCashAdvancesView, or every var(--pm-*) in .pca-* is undefined');
  ok(/--pm-green:/.test(css.slice(css.indexOf('{'), css.indexOf('}'))), 'that first rule is the token block');
});

// ── runner ───────────────────────────────────────────────────────────
(async () => {
  console.log('\nWorker cash advances');
  for (const [name, fn] of queue) {
    try { await fn(); passed++; console.log('  ok  ' + name); }
    catch (e) { failed++; failures.push(name + ' — ' + e.message); console.log('  FAIL ' + name + '\n       ' + e.message); }
  }
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  if (failed) { console.log(failures.join('\n')); process.exit(1); }
})();
