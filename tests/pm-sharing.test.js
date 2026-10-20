// ════════════════════════════════════════════════════════════════════
// PM PROFIT SHARING — run with: node tests/pm-sharing.test.js
// Spec: docs/superpowers/specs/2026-10-18-pm-profit-sharing-mvp-terms.md
// Section A drives js/pm-sharing.js directly. Later sections run the REAL
// pm-admin.js / pm-sharing-dashboard.js in a sandbox (tests/helpers) and
// check what each screen actually shows — never a source pattern alone.
// ════════════════════════════════════════════════════════════════════
'use strict';
process.env.TZ = 'Asia/Manila';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const P = require('../js/pm-sharing.js');

let passed = 0, failed = 0;
const failures = [];
const queue = [];
function test(name, fn) { queue.push([name, fn]); }
function eq(a, b, label) {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error((label || 'value') + ': expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a));
}
function ok(c, label) { if (!c) throw new Error(label || 'expected truthy'); }

// ── fixtures ─────────────────────────────────────────────────────────
const verified = (amt) => ({ status: 'verified', amountPaid: amt });
const bill = (dct) => ({ directCostTotal: dct });
const rec = (contrib, paid, cost, extra = {}) => ({ contributedAmount: contrib, status: 'active', deleted: false, totalPaid: paid, directCost: cost, ...extra });
// Worked example (spec §7.9): A remaining 800,000 / reserve 40,000 / 60:40; B 500,000 / 25,000 / 50:50.
const projA = { id: 'A', projectName: 'Alpha', clientName: 'Ana', partnerEmail: 'p@x.test', status: 'completed', terminatedAt: '2026-08-02T03:00:00Z' };
const projB = { id: 'B', projectName: 'Beta', clientName: 'Ben', partnerEmail: '', status: 'completed', terminatedAt: null };
const inA = { ...projA, name: projA.projectName, bills: [], reqs: [verified(800000)], reserveRow: rec(40000, 800000, 0), partnerPct: 40 };
const inB = { ...projB, name: projB.projectName, bills: [], reqs: [verified(500000)], reserveRow: rec(25000, 500000, 0), partnerPct: 50 };

// ══ A. Calculation ═══════════════════════════════════════════════════
test('A1 worked example: ₱693,500 owner / ₱541,500 partner', () => {
  const c = P.combine([P.project(inA), P.project(inB)]);
  eq([c.totals.ownerCents, c.totals.partnerCents, c.totals.netCents, c.totals.reserveCents],
     [69350000, 54150000, 123500000, 6500000]);
});
test('A2 mixed percentages are split per project before combining', () => {
  const a = P.project(inA), b = P.project(inB);
  eq([a.ownerCents, a.partnerCents, b.ownerCents, b.partnerCents], [45600000, 30400000, 23750000, 23750000]);
});
test('A3 −₱100,000 remaining → reserve ₱0, −₱50,000 each, Shortfall (active and needs-review)', () => {
  for (const status of ['active', 'completed']) {
    const r = P.project({ id: 'L', status, bills: [bill(100000)], reqs: [], reserveRow: null, partnerPct: 50 });
    eq([r.reserve.cents, r.balanceCents, r.ownerCents, r.partnerCents, r.reserve.floored], [0, -10000000, -5000000, -5000000, true], status);
    ok(r.flags.includes('shortfall'), status + ' shortfall flag');
  }
});
test('A4 rounding: half away from zero, owner gets the residual', () => {
  eq(P.split(1, 50), { partnerCents: 1, ownerCents: 0 });
  eq(P.split(-1, 50), { partnerCents: -1, ownerCents: 0 });
  eq(P.split(10000, 33.33), { partnerCents: 3333, ownerCents: 6667 });
  eq(P.split(76000000, 0), { partnerCents: 0, ownerCents: 76000000 });
  eq(P.split(76000000, 100), { partnerCents: 76000000, ownerCents: 0 });
  eq([P.toCents(1.005), P.toCents(-1.005), P.toCents(5724.900000000001), P.toCents('12.34')], [101, -101, 572490, 1234]);
});
test('A5 reserve kinds: recorded ₱0 is valid; missing / void / deleted → provisional + needs review', () => {
  eq(P.reserveFor('completed', 100000, rec(0, 1000, 0), 100000, 0).kind, 'recorded');
  eq(P.reserveFor('completed', 100000, rec(0, 1000, 0), 100000, 0).needsReview, false);
  for (const r of [null, rec(5, 0, 0, { status: 'void' }), rec(5, 0, 0, { deleted: true })]) {
    const x = P.reserveFor('completed', 100000, r, 100000, 0);
    eq([x.kind, x.needsReview, x.cents], ['provisional', true, 5000]);
  }
  eq(P.reserveFor('active', 100000, null, 100000, 0).kind, 'estimate');
});
test('A6 needs review is the ONLY exclusion; warning chips stay in totals and can coexist', () => {
  const unpaidChanged = P.project({ ...inB, id: 'U', reqs: [verified(500000), { status: 'unpaid', totalAmount: 1000, amountPaid: 0 }],
                                    reserveRow: rec(25000, 400000, 0) });
  eq(unpaidChanged.flags, ['unpaid_balance', 'changed_since_closeout']);
  eq(unpaidChanged.confirmed, true);
  const review = P.project({ ...inB, id: 'R', reserveRow: null });
  const c = P.combine([P.project(inA), unpaidChanged, review]);
  eq([c.totals.count, c.totals.reviewCount, c.review.map(r => r.id)], [2, 1, ['R']]);
});
test('A7 changed since closeout compares current paid/cost with the closeout snapshot', () => {
  eq(P.project(inA).reserve.changedSinceCloseout, false);
  eq(P.project({ ...inA, bills: [bill(1)] }).reserve.changedSinceCloseout, true);
});
test('A8 legacy bills: ladder unchanged (D4); supply & install counted once', () => {
  eq(P.directCost([{ directCostTotal: 0, labor: 100, materials: 50, overhead: 30 }]), 150, 'labor+materials step (no overhead — F6)');
  eq(P.directCost([{ grandTotal: 115, managementFee: 15 }]), 100, 'grandTotal − fee step');
  eq(P.directCost([{ directCostTotal: 0, labor: 0, materials: 200, combined: 80 }]), 200, 'combined inside materials');
  eq(P.directCost([bill(1000), { directCostTotal: 0, labor: 10 }]), 1010);
});
test('A9 paid / outstanding keep the existing eligibility rules', () => {
  eq(P.paid([verified(100), { status: 'verified', paidAmount: 20 }, { status: 'verified', totalAmount: 7 },
             { status: 'partial', amountPaid: 5 }, { status: 'unpaid', totalAmount: 50 }]), 132);
  eq(P.outstanding([{ status: 'unpaid', totalAmount: 50 }, { status: 'partial', totalAmount: 30, amountPaid: 5 }, verified(9)]), 75);
});
test('A10 closeout parity: termination-requests.js ladder = PMShare.directCost', () => {
  const src = read('js/termination-requests.js');
  const start = src.indexOf('const directCost = bills.reduce((s, b) => {');
  ok(start !== -1, 'SLICE NOT FOUND: closeout directCost ladder — update tests/pm-sharing.test.js');
  const end = src.indexOf('}, 0);', start) + '}, 0);'.length;
  const ladder = new Function('bills', 'num', src.slice(start, end) + '\nreturn directCost;');
  const num = (v) => Number(v) || 0;
  const bills = [bill(1000), { directCostTotal: 0, labor: 100, materials: 50, overhead: 30 }, { grandTotal: 115, managementFee: 15 }];
  eq(ladder(bills, num), P.directCost(bills));
});
test('A11 partner email normalised; unassigned stays empty, never the client', () => {
  eq(P.project({ ...inA, partnerEmail: ' P@X.test ' }).partnerEmail, 'p@x.test');
  eq(P.project({ ...inB, clientEmail: 'client@x.test', partnerEmail: undefined }).partnerEmail, '');
});
test('A12 completion date key uses local (PH) parts, undated stays empty', () => {
  eq(P.dateKey('2026-08-01T17:30:00Z'), '2026-08-02', 'UTC evening = next PH day');
  eq(P.dateKey(null), ''); eq(P.dateKey('nonsense'), '');
  eq(P.dateKey({ toDate: () => new Date(2026, 7, 2, 9) }), '2026-08-02');
});
test('A13 fmtPct / pesos formatting', () => {
  eq([P.fmtPct(40), P.fmtPct(33.33), P.fmtPct(12.5), P.fmtPct(66.67000000000002)], ['40', '33.33', '12.5', '66.67']);
  eq([P.pesos(45600000), P.pesos(-5000000), P.pesos(0)], ['₱456,000.00', '−₱50,000.00', '₱0.00']);
});

// ══ B. Data API + WF.reserveFor ══════════════════════════════════════
function fakeSb(handler) {
  const calls = [];
  return { calls, rpc: async (name, args) => { calls.push([name, args]); return handler(name, args); } };
}
test('B1 load/save call the right functions with the right arguments', async () => {
  const sb = fakeSb((n) => ({ data: n === 'pm_sharing_read' ? { can_edit: true, projects: [] } : { changed: true }, error: null }));
  globalThis.sbClient = sb;
  await P.load(['A']); await P.load(null);
  await P.save('A', 40, 0, ' Agreed ');
  eq(sb.calls, [['pm_sharing_read', { p_projects: ['A'] }], ['pm_sharing_read', { p_projects: null }],
                ['pm_set_sharing', { p_project: 'A', p_partner_pct: 40, p_expected_version: 0, p_reason: 'Agreed' }]]);
});
test('B2 a server error rejects (never resolves to empty data)', async () => {
  globalThis.sbClient = fakeSb(() => ({ data: null, error: { message: 'OWNER_ONLY' } }));
  let msg = '';
  try { await P.load(null); } catch (e) { msg = e.message; }
  eq(msg, 'OWNER_ONLY');
  eq(P.errorText('STALE'), 'This split was changed by someone else — reload.');
  eq(P.errorText('whatever'), 'whatever');
  eq(P.errorText('BAD_COMPANY_LINK'), 'This account is not linked to a valid company.');
});
test('B3 parsePct: 0–100, at most 2 decimals, no blanks or junk', () => {
  eq(P.parsePct(' 40 '), { ok: true, value: 40 });
  eq(P.parsePct('33.33'), { ok: true, value: 33.33 });
  eq(P.parsePct('0'), { ok: true, value: 0 });
  eq(P.parsePct('100'), { ok: true, value: 100 });
  for (const bad of ['', ' ', 'abc', '40.123', '-1', '100.01', '1e2', 'NaN', 'Infinity', '40,5']) {
    eq(P.parsePct(bad).ok, false, JSON.stringify(bad));
  }
});
test('B4 acceptance facts state only what is recorded', () => {
  const partners = [{ email: 'p@x.test', accepted: true, accepted_at: '2026-08-12T02:00:00Z', doc_version: 3 }];
  const lines = P.acceptanceFacts('p@x.test', partners, '2026-09-01T00:00:00Z');
  ok(/^Partnership Agreement v3 accepted .+\. This acceptance record does not capture a project sharing percentage\.$/.test(lines[0]), lines[0]);
  eq(lines[1], 'Split changed after last signed agreement.');
  eq(P.acceptanceFacts('p@x.test', partners, '2026-08-01T00:00:00Z').length, 1, 'change before acceptance → no flag');
  eq(P.acceptanceFacts('q@x.test', partners, null), ['No Partnership Agreement acceptance on record.']);
  eq(P.acceptanceFacts('', partners, null), ['Partner unassigned.']);
});
test('B5 WF.reserveFor calls wf_reserves_for and rounds noisy amounts', async () => {
  const src = read('js/warranty-fund.js');
  const start = src.indexOf('window.WF.reserveFor = async function');
  ok(start !== -1, 'SLICE NOT FOUND: WF.reserveFor');
  const end = src.indexOf('\n    };\n', start) + '\n    };\n'.length;
  const sb = fakeSb(() => ({ data: [{ project_id: 'A', ref_no: 'WR-1', status: 'active', deleted: false,
    contributed_amount: '5724.900000000001', total_paid: '400000', direct_cost: '285502', completed_at: null }], error: null }));
  const win = { sbClient: sb, WF: {} };
  new Function('window', src.slice(start, end))(win);
  const r = await win.WF.reserveFor(['A', '', null]);
  eq(sb.calls, [['wf_reserves_for', { p_projects: ['A'] }]]);
  eq(r.A, { contributedAmount: 5724.9, status: 'active', deleted: false, refNo: 'WR-1', totalPaid: 400000, directCost: 285502, completedAt: null });
  eq(await win.WF.reserveFor([]), {}, 'no ids → no call');
  eq(sb.calls.length, 1);
});

// ══ C. Overview: first render, range refresh, print (real pm-admin.js) ══
const { loadPmAdmin } = require('./helpers/pm-admin-sandbox.js');
const shareOf = (pct, row) => ({ partnerPct: pct, isDefault: false, version: 1, canEdit: true, reserveRow: row, history: [] });
function overview(role, project, bills, reqs, share) {
  const sb = loadPmAdmin({ role });
  sb.run(`_pmActiveProject = ${JSON.stringify(project)}; _pmOvBills = ${JSON.stringify(bills)};
          _pmOvReqs = ${JSON.stringify(reqs)}; _pmOvShare = ${JSON.stringify(share)};`);
  return { sb, html: sb.ctx._pmOvHtml(project, [], bills, reqs) };
}
test('C1 Overview shows the recorded reserve and the 60/40 split for project A', () => {
  const { html } = overview('owner', projA, [], [verified(800000)], shareOf(40, rec(40000, 800000, 0)));
  for (const s of ['Warranty reserve', '₱40,000.00', 'Recorded at closeout', 'Sharing balance', '₱760,000.00',
                   'You ₱456,000.00 (60%)', 'Partner ₱304,000.00 (40%)', 'Internal allocation — not a payout.']) {
    ok(html.includes(s), 'missing: ' + s);
  }
  ok(!html.includes('Profit share') && !html.includes('50% after retention'), 'old 50/50 card gone');
});
test('C2 a loss shows ₱0 estimate reserve and a −₱50,000 each Shortfall', () => {
  const p = { ...projA, status: 'active' };
  const { html } = overview('owner', p, [bill(100000)], [], shareOf(50, null));
  for (const s of ['Estimate · 5% of remaining cash', 'Shortfall', '−₱100,000.00', 'You −₱50,000.00 (50%)',
                   'Partner −₱50,000.00 (50%)', 'Retention is floored at ₱0']) ok(html.includes(s), 'missing: ' + s);
});
test('C3 a failed sharing read shows Unavailable, never ₱0', () => {
  const { html } = overview('owner', projA, [], [verified(800000)], { error: 'boom' });
  ok(html.includes('Unavailable'), 'Unavailable');
  ok(!html.includes('Internal allocation'), 'no split text on failure');
});
test('C4 staff get neither card', () => {
  const { html } = overview('staff', projA, [], [verified(800000)], shareOf(40, rec(40000, 800000, 0)));
  for (const s of ['pm-ov-kpi-retention', 'pm-ov-kpi-sharing', 'Warranty reserve', 'Sharing balance', '₱304,000.00']) {
    ok(!html.includes(s), 'staff saw: ' + s);
  }
});
test('C5 range refresh never touches the lifetime reserve / sharing cards (D5)', () => {
  const { sb } = overview('owner', projA, [{ ...bill(1000), weekEndingDate: '2026-07-31' }], [verified(800000)], shareOf(40, rec(40000, 800000, 0)));
  sb.ctx.document.getElementById('pm-ov-kpi-retention').textContent = 'SENTINEL-R';
  sb.ctx.document.getElementById('pm-ov-kpi-sharing').textContent = 'SENTINEL-S';
  sb.ctx.document.getElementById('pm-ov-range').value = 'latest';
  sb.ctx.pmOvApplyRange();
  eq(sb.ctx.document.getElementById('pm-ov-kpi-retention').textContent, 'SENTINEL-R');
  eq(sb.ctx.document.getElementById('pm-ov-kpi-sharing').textContent, 'SENTINEL-S');
});
test('C6 Overview print carries the same figures and labels', () => {
  const { sb } = overview('owner', projA, [], [verified(800000)], shareOf(40, rec(40000, 800000, 0)));
  sb.ctx.pmOvPrintReport();
  const h = sb.printed.join('');
  for (const s of ['Warranty Reserve', '₱40,000.00', 'You ₱456,000.00 (60%)', 'Partner ₱304,000.00 (40%)',
                   'Internal allocation — not a payout.']) ok(h.includes(s), 'print missing: ' + s);
  ok(!h.includes('50% of'), 'old 50/50 subtitle gone');
});
test('C7 Overview paid/cost delegate to the shared rules', () => {
  const sb = loadPmAdmin({ role: 'owner' });
  eq(sb.ctx._pmOvPaid([verified(5), { status: 'partial', amountPaid: 2 }]), 7);
  eq(sb.ctx._pmOvOutstanding([{ status: 'unpaid', totalAmount: 9 }]), 9);
});

// ══ D. Reports (real pm-admin.js) ════════════════════════════════════
function reports(role, share, fetchError = false) {
  const sb = loadPmAdmin({ role });
  const bills = [];
  const reqs = [{ ...verified(800000), projectId: 'A' }, { ...verified(500000), projectId: 'B' }];
  sb.run(`_pmRptState.projects = ${JSON.stringify([projA, projB])}; _pmRptState.bills = ${JSON.stringify(bills)};
          _pmRptState.payReqs = ${JSON.stringify(reqs)}; _pmRptState.share = ${JSON.stringify(share)};
          _pmRptState.fetchError = ${fetchError};`);
  return sb;
}
const rptShare = { read: { can_edit: true, history: [], partners: [],
                           projects: [{ project_id: 'A', partner_pct: 40, is_default: false, version: 1 },
                                      { project_id: 'B', partner_pct: 50, is_default: true, version: 0 }] },
                   reserves: { A: rec(40000, 800000, 0), B: rec(25000, 500000, 0) }, error: null };
test('D1 Reports computes each project separately, then combines', () => {
  const cr = reports('owner', rptShare).ctx._pmRptCashReceipt();
  eq([cr.share.totals.ownerCents, cr.share.totals.partnerCents, cr.share.totals.reserveCents], [69350000, 54150000, 6500000]);
  eq(cr.netCash, 1300000);
});
test('D2 Reports KPI row shows the combined split and labels', () => {
  const sb = reports('owner', rptShare);
  sb.ctx._pmRptRenderKPIs([]);
  const h = sb.ctx.document.getElementById('pmRptKpiRow').innerHTML;
  for (const s of ['Warranty Reserve', '₱65,000.00', 'Sharing Balance', '₱1,235,000.00', 'You ₱693,500.00',
                   'Partner ₱541,500.00', 'Internal allocation — not a payout.']) ok(h.includes(s), 'missing: ' + s);
  ok(!h.includes('50% of Remaining'), 'old 50/50 card gone');
});
test('D3 a reserve-needs-review project stays out of totals and is counted in a note', () => {
  const s = JSON.parse(JSON.stringify(rptShare)); delete s.reserves.B;
  const sb = reports('owner', s);
  const cr = sb.ctx._pmRptCashReceipt();
  eq([cr.share.totals.count, cr.share.totals.reviewCount, cr.share.totals.ownerCents], [1, 1, 45600000]);
  sb.ctx._pmRptRenderKPIs([]);
  ok(sb.ctx.document.getElementById('pmRptKpiRow').innerHTML.includes('1 project needs reserve review (not in totals)'), 'note');
});
test('D4 a failed load shows an error, never ₱0 sharing figures', () => {
  for (const sb of [reports('owner', { error: 'boom' }), reports('owner', rptShare, true)]) {
    sb.ctx._pmRptRenderKPIs([]);
    const h = sb.ctx.document.getElementById('pmRptKpiRow').innerHTML;
    ok(h.includes('Sharing unavailable'), 'error card');
    ok(!h.includes('Sharing Balance'), 'no balance card');
  }
});
test('D5 Reports print carries the combined split', () => {
  const sb = reports('owner', rptShare);
  sb.run(`_pmRptState.period = 'annual'; _pmRptState.year = 2026;`);
  sb.ctx.printPMReportsDashboard();
  const h = sb.printed.join('');
  for (const s of ['Warranty Reserve', 'You ₱693,500.00', 'Partner ₱541,500.00', 'Internal allocation — not a payout.']) {
    ok(h.includes(s), 'print missing: ' + s);
  }
});
test('D6 staff: Reports KPI row hidden and print refused (unchanged behaviour)', () => {
  const sb = reports('staff', rptShare);
  sb.ctx._pmRptRenderKPIs([]);
  eq(sb.ctx.document.getElementById('pmRptKpiRow').style.display, 'none');
  sb.ctx.printPMReportsDashboard();
  eq(sb.printed.length, 0);
});

// ══ E. Project form (real pm-admin.js) ════════════════════════════════
function formSandbox(role, opts = {}) {
  const sb = loadPmAdmin({ role });
  const set = (id, v) => { sb.ctx.document.getElementById(id).value = v; };
  set('pmProjectId', opts.id === undefined ? 'P1' : opts.id); set('pmProjectClientName', 'Client'); set('pmProjectName', 'Name');
  set('pmProjectEmail', ''); set('pmProjectStatus', 'active'); set('pmProjectStartDate', ''); set('pmProjectAddress', '');
  set('pmProjectBudget', ''); set('pmProjectEndDate', ''); set('pmProjectFeePct', '15');
  const saves = [], updates = [], rebills = [];
  sb.ctx.db = { collection: () => ({ doc: () => ({ update: async (d) => { updates.push(d); } }),
                                     add: async () => ({ id: 'NEW' }) }) };
  sb.ctx.PMShare.save = async (...a) => { saves.push(a); if (opts.saveFails) throw new Error('STALE'); return { changed: true }; };
  sb.ctx._pmRecomputeUnpaidBills = async (...a) => { rebills.push(a); return 0; };
  sb.ctx._pmLoadProjectsList = () => {};
  sb.ctx.pmCloseModal = () => {};
  sb.run(`_pmProjects = [{ id: 'P1', managementFeePct: 15 }];`);
  return { sb, set, saves, updates, rebills };
}
test('E1 linked inputs: typing one share fills the other', () => {
  const { sb, set } = formSandbox('owner');
  sb.run(`_pmShareForm = { projectId: 'P1', partnerPct: 50, version: 0, canEdit: true, isNew: false };`);
  set('pmShareOwnerPct', '60'); sb.ctx.pmShareLink('owner');
  eq(sb.ctx.document.getElementById('pmSharePartnerPct').value, '40');
  set('pmSharePartnerPct', '33.33'); sb.ctx.pmShareLink('partner');
  eq(sb.ctx.document.getElementById('pmShareOwnerPct').value, '66.67');
  eq(sb.ctx.document.getElementById('pmShareReasonWrap').style.display, 'block', 'reason shown on change');
});
test('E2 edit: saves the typed % with version + reason, never re-bills', async () => {
  const f = formSandbox('owner');
  f.sb.run(`_pmShareForm = { projectId: 'P1', partnerPct: 50, version: 0, canEdit: true, isNew: false };`);
  f.set('pmShareOwnerPct', '60'); f.set('pmSharePartnerPct', '40'); f.set('pmShareReason', ' Agreed 60/40 ');
  await f.sb.ctx.pmSaveProject();
  eq(f.saves, [['P1', 40, 0, 'Agreed 60/40']]);
  eq(f.rebills.length, 0, 'sharing never re-bills');
  ok(!('partnerPct' in f.updates[0]) && !('partner_pct' in f.updates[0]), 'no sharing field on the project row');
});
test('E3 edit: a changed % with no reason blocks the whole save', async () => {
  const f = formSandbox('owner');
  f.sb.run(`_pmShareForm = { projectId: 'P1', partnerPct: 50, version: 0, canEdit: true, isNew: false };`);
  f.set('pmShareOwnerPct', '60'); f.set('pmSharePartnerPct', '40'); f.set('pmShareReason', '');
  await f.sb.ctx.pmSaveProject();
  eq([f.saves.length, f.updates.length], [0, 0]);
  eq(f.sb.ctx.document.getElementById('err-pmSharePct').textContent, 'Give a reason for changing the split.');
});
test('E4 invalid % blocks the save (40.123 never rounded in the browser)', async () => {
  const f = formSandbox('owner');
  f.sb.run(`_pmShareForm = { projectId: 'P1', partnerPct: 50, version: 0, canEdit: true, isNew: false };`);
  f.set('pmShareOwnerPct', '60'); f.set('pmSharePartnerPct', '40.123'); f.set('pmShareReason', 'x');
  await f.sb.ctx.pmSaveProject();
  eq([f.saves.length, f.updates.length], [0, 0]);
});
test('E5 create: a non-default split saves with the creation reason', async () => {
  const f = formSandbox('owner', { id: '' });
  f.sb.run(`_pmShareForm = { projectId: null, partnerPct: 50, version: 0, canEdit: true, isNew: true };`);
  f.set('pmShareOwnerPct', '70'); f.set('pmSharePartnerPct', '30');
  await f.sb.ctx.pmSaveProject();
  eq(f.saves, [['NEW', 30, 0, 'Set when the project was created']]);
});
test('E6 unchanged % → no sharing call', async () => {
  const f = formSandbox('owner');
  f.sb.run(`_pmShareForm = { projectId: 'P1', partnerPct: 50, version: 0, canEdit: true, isNew: false };`);
  f.set('pmShareOwnerPct', '50'); f.set('pmSharePartnerPct', '50');
  await f.sb.ctx.pmSaveProject();
  eq(f.saves.length, 0);
});
test('E7 sharing failure after a good project save → partial-save message', async () => {
  const f = formSandbox('owner', { saveFails: true });
  f.sb.run(`_pmShareForm = { projectId: 'P1', partnerPct: 50, version: 0, canEdit: true, isNew: false };`);
  f.set('pmShareOwnerPct', '60'); f.set('pmSharePartnerPct', '40'); f.set('pmShareReason', 'r');
  await f.sb.ctx.pmSaveProject();
  eq(f.updates.length, 1, 'project saved');
  eq(f.sb.toasts.pop(), ['Project saved; sharing not saved — still 50/50. This split was changed by someone else — reload.', true]);
});
test('E8 view-only (focused owner) and staff: no sharing save', async () => {
  const f = formSandbox('owner');
  f.sb.run(`_pmShareForm = { projectId: 'P1', partnerPct: 50, version: 0, canEdit: false, isNew: false };`);
  f.set('pmSharePartnerPct', '40'); f.set('pmShareReason', 'r');
  await f.sb.ctx.pmSaveProject();
  eq(f.saves.length, 0, 'view-only');
  const s = formSandbox('staff');
  await s.sb.ctx._pmShareOpenForm('P1');
  ok(s.sb.ctx.document.getElementById('pmShareSection').removed, 'section removed for staff');
  await s.sb.ctx.pmSaveProject();
  eq([s.saves.length, s.updates.length], [0, 1], 'staff project save still works');
});

test('E9 both share fields are validated: junk in either blocks the save', async () => {
  const f = formSandbox('owner');
  f.sb.run(`_pmShareForm = { projectId: 'P1', partnerPct: 50, version: 0, canEdit: true, isNew: false };`);
  f.set('pmShareOwnerPct', 'abc'); f.set('pmSharePartnerPct', '40'); f.set('pmShareReason', 'r');
  await f.sb.ctx.pmSaveProject();
  eq([f.saves.length, f.updates.length], [0, 0]);
  ok(f.sb.ctx.document.getElementById('err-pmSharePct').textContent.length > 0, 'parse error shown');
});
test('E10 the two shares must total exactly 100', async () => {
  const f = formSandbox('owner');
  f.sb.run(`_pmShareForm = { projectId: 'P1', partnerPct: 50, version: 0, canEdit: true, isNew: false };`);
  f.set('pmShareOwnerPct', '61'); f.set('pmSharePartnerPct', '40'); f.set('pmShareReason', 'r');
  await f.sb.ctx.pmSaveProject();
  eq([f.saves.length, f.updates.length], [0, 0]);
  eq(f.sb.ctx.document.getElementById('err-pmSharePct').textContent, 'Your share and partner share must total 100%.');
});
test('E11 a create error shows friendly text', async () => {
  const f = formSandbox('owner', { id: '' });
  f.sb.ctx.db = { collection: () => ({ add: async () => { throw new Error('NOT_OFFICE'); } }) };
  await f.sb.ctx.pmSaveProject();
  eq(f.sb.toasts.pop(), ['Save failed: This account cannot create projects.', true]);
});
// ══ F. Dashboard (real pm-sharing-dashboard.js) ═══════════════════════
function loadDash(role) {
  const sb = loadPmAdmin({ role });
  require('vm').runInContext(read('js/pm-sharing-dashboard.js'), sb.ctx, { filename: 'pm-sharing-dashboard.js' });
  return sb;
}
const dashData = () => ({
  read: { can_edit: true, history: [], partners: [],
          projects: [{ project_id: 'A', partner_pct: 40, is_default: false, version: 1 },
                     { project_id: 'B', partner_pct: 50, is_default: true, version: 0 },
                     { project_id: 'C', partner_pct: 50, is_default: true, version: 0 }] },
  projects: [projA, projB, { ...projB, id: 'C', projectName: 'Beta', terminatedAt: '2026-09-10T02:00:00Z' }],
  perProject: { A: { bills: [], reqs: [verified(800000)] }, B: { bills: [], reqs: [verified(500000)] },
                C: { bills: [], reqs: [verified(1000)] } },
  reserves: { A: rec(40000, 800000, 0), B: rec(25000, 500000, 0) },   // C has no reserve → needs review
});
test('F1 summary = confirmed projects only; worked example totals; C in review', async () => {
  const sb = loadDash('owner');
  sb.ctx.PMShareDash._setFetch(async () => dashData());
  await sb.ctx.PMShareDash.load();
  const h = sb.ctx.document.getElementById('pmSharingRoot').innerHTML + sb.ctx.document.getElementById('pmSharingResults').innerHTML;
  for (const s of ['2 confirmed · 1 with reserve needing review', '₱693,500.00', '₱541,500.00',
                   'Internal allocation — not a payout or amount owed.', 'Reserve needs review', 'Provisional']) {
    ok(h.includes(s), 'missing: ' + s);
  }
});
test('F2 filters: partner unassigned, undated only, date range, search', () => {
  const sb = loadDash('owner');
  const D = sb.ctx.PMShareDash, P = sb.ctx.PMShare, d = dashData();
  const results = d.projects.map(p => P.project({ ...p, name: p.projectName, ...d.perProject[p.id], reserveRow: d.reserves[p.id] || null,
                                                  partnerPct: d.read.projects.find(x => x.project_id === p.id).partner_pct }));
  const base = { from: '', to: '', undatedOnly: false, partner: 'all', q: '' };
  eq(D.applyFilters(results, { ...base, partner: 'unassigned' }).map(r => r.id), ['B', 'C']);
  eq(D.applyFilters(results, { ...base, partner: 'p@x.test' }).map(r => r.id), ['A']);
  eq(D.applyFilters(results, { ...base, undatedOnly: true }).map(r => r.id), ['B']);
  eq(D.applyFilters(results, { ...base, from: '2026-08-01', to: '2026-08-31' }).map(r => r.id), ['A']);
  eq(D.applyFilters(results, { ...base, q: 'ana' }).map(r => r.id), ['A']);
  eq(D.applyFilters(results, base).map(r => r.id), ['A', 'B', 'C'], 'undated kept under All');
});
test('F3 same-named projects get completion date + short id', () => {
  const sb = loadDash('owner');
  const P = sb.ctx.PMShare;
  const b = P.project({ ...projB, id: 'b1aaaaaa', name: 'Beta' });
  const c = P.project({ ...projB, id: 'c2bbbbbb', name: 'Beta', terminatedAt: '2026-09-10T02:00:00Z' });
  eq(sb.ctx.PMShareDash.labelFor(b, [b, c]), 'Beta · undated · b1aaaa');
  eq(sb.ctx.PMShareDash.labelFor(c, [b, c]), 'Beta · 2026-09-10 · c2bbbb');
  eq(sb.ctx.PMShareDash.labelFor(P.project(inA), [P.project(inA)]), 'Alpha');
});
test('F4 chips coexist; Ready only when nothing else applies', () => {
  const sb = loadDash('owner');
  const P = sb.ctx.PMShare, D = sb.ctx.PMShareDash;
  eq(D.chipsFor(P.project(inA)), ['Ready']);
  const both = P.project({ ...inB, reqs: [verified(500000), { status: 'unpaid', totalAmount: 1, amountPaid: 0 }], reserveRow: rec(25000, 1, 0) });
  eq(D.chipsFor(both), ['Unpaid client balance', 'Changed since closeout']);
});
test('F5 a stale response is discarded', async () => {
  const sb = loadDash('owner');
  const D = sb.ctx.PMShareDash;
  let releaseFirst;
  const first = new Promise(r => { releaseFirst = r; });
  let n = 0;
  D._setFetch(async () => { n++; if (n === 1) { await first; const d = dashData(); d.projects = [projA]; return d; } return dashData(); });
  const p1 = D.load();
  const p2 = D.load();
  await p2; releaseFirst(); await p1;
  eq(D._state.results.length, 3, 'newer result kept');
});
test('F6 a failed load shows an error panel, never ₱0', async () => {
  const sb = loadDash('owner');
  sb.ctx.PMShareDash._setFetch(async () => { throw new Error('OWNER_ONLY'); });
  await sb.ctx.PMShareDash.load();
  const h = sb.ctx.document.getElementById('pmSharingRoot').innerHTML;
  ok(h.includes('Could not load Profit Sharing'), 'error panel');
  ok(!h.includes('₱0.00'), 'no zero totals');
});
test('F7 staff: nothing rendered, nothing fetched', async () => {
  const sb = loadDash('staff');
  let fetched = false;
  sb.ctx.PMShareDash._setFetch(async () => { fetched = true; return dashData(); });
  await sb.ctx.initPMSharingDashboard();
  eq(sb.ctx.document.getElementById('pmSharingRoot').innerHTML, '');
  eq(fetched, false);
});
test('F8 wiring: nav, focus access, staff guards, view, script', () => {
  const adm = read('js/admin.js'), html = read('admin.html');
  const pmBlock = adm.slice(adm.indexOf("{ id: 'pm', label: 'Project Management'"), adm.indexOf("{ id: 'attendance'"));
  ok(pmBlock.includes("view: 'pmSharing'"), 'PRIMARY_NAV pm module (focused pm accounts reach it through modules)');
  ok(/const hidden = \['warrantyFund', 'pmSharing'\]/.test(adm), '_visibleNav hides it from staff');
  ok(/\['userNavigator', 'clientAccounts', 'expReports', 'reimbursements', 'warrantyFund', 'pmSharing'/.test(adm), 'staff sidebar hide list');
  ok(html.includes('data-view="pmSharing"') && html.includes('id="pmSharingView"') && html.includes('id="pmSharingRoot"'), 'markup');
  ok(/'warrantyFund', 'pmSharing', 'attAppUpdates'/.test(html) && html.includes("view === 'pmSharing') view = 'pmProjects'"), 'staff blocked + bounce');
  ok(html.includes("view === 'pmSharing' && typeof initPMSharingDashboard === 'function'"), 'init hook');
  ok(html.indexOf('js/pm-sharing.js') < html.indexOf('js/pm-admin.js') && html.indexOf('js/pm-sharing-dashboard.js') > html.indexOf('js/warranty-fund.js'), 'script order');
});

test('F9 typing in search re-renders results only; the filter bar is not rebuilt', async () => {
  const sb = loadDash('owner');
  const D = sb.ctx.PMShareDash, doc = sb.ctx.document;
  D._setFetch(async () => dashData());
  await D.load();
  const rootBefore = doc.getElementById('pmSharingRoot').innerHTML;
  const resBefore = doc.getElementById('pmSharingResults').innerHTML;
  ok(rootBefore.includes('Search project or client'), 'shell has the filter bar');
  D.setFilter('q', 'ana');
  eq(doc.getElementById('pmSharingRoot').innerHTML, rootBefore, 'shell untouched');
  const res = doc.getElementById('pmSharingResults').innerHTML;
  ok(res !== resBefore, 'results changed');
  ok(res.includes('Alpha') && !res.includes('Beta'), 'only Alpha remains');
  ok(res.includes('1 confirmed · 0 with reserve needing review'), 'count is project A only');
  const t = D.buildModel(D._state.results, D._state.filters).totals;
  eq([t.count, t.paidCents, t.reserveCents], [1, 80000000, 4000000], 'totals reflect only project A');
  D.setFilter('q', 'zzz');
  ok(doc.getElementById('pmSharingResults').innerHTML.includes('No completed projects match these filters.'), 'empty message inside results');
  eq(doc.getElementById('pmSharingRoot').innerHTML, rootBefore, 'filter bar still there');
});
test('F10 rows are data-driven: data-pms-id, no inline open handler', async () => {
  const sb = loadDash('owner');
  sb.ctx.PMShareDash._setFetch(async () => dashData());
  await sb.ctx.PMShareDash.load();
  const res = sb.ctx.document.getElementById('pmSharingResults').innerHTML;
  ok(res.includes('data-pms-id="A"'), 'row carries its id');
  ok(!res.includes('onclick="PMShareDash.open'), 'no inline open handler');
});

test('F6 unmapped completed projects get a notice (and are not shown)', async () => {
  const sb = loadDash('owner');
  sb.ctx.PMShareDash._setFetch(async () => ({ ...dashData(), unmappedCompleted: 2 }));
  await sb.ctx.PMShareDash.load();
  const h = sb.ctx.document.getElementById('pmSharingResults').innerHTML;
  ok(h.includes('2 completed projects not linked to a company — sharing locked (not shown).'), 'notice missing: ' + h.slice(0, 200));
  sb.ctx.PMShareDash._setFetch(async () => ({ ...dashData(), unmappedCompleted: 0 }));
  await sb.ctx.PMShareDash.load();
  ok(!sb.ctx.document.getElementById('pmSharingResults').innerHTML.includes('not linked to a company'), 'no notice when 0');
});
// ══ G. Dashboard details, print, CSV ══════════════════════════════════
test('G1 csvCell: text cells protected, numbers stay numbers (negatives too)', () => {
  const D = loadDash('owner').ctx.PMShareDash;
  eq([D.csvCell('=SUM(A1)'), D.csvCell('+1'), D.csvCell('-x'), D.csvCell('@a'), D.csvCell('\tx'), D.csvCell('a,b'), D.csvCell('say "hi"')],
     ["'=SUM(A1)", "'+1", "'-x", "'@a", "'\tx", '"a,b"', '"say ""hi"""']);
  eq([D.csvCell(-50000), D.csvCell(456000.5), D.csvCell(0)], ['-50000', '456000.5', '0']);
});
test('G2 CSV = same model: meta lines, rows, provisional review rows, totals', async () => {
  const sb = loadDash('owner');
  const D = sb.ctx.PMShareDash;
  D._setFetch(async () => dashData());
  await D.load();
  const csv = D.toCsv(D.buildModel(D._state.results, D._state.filters), D.metaLines());
  ok(csv.includes('Internal allocation — not a payout or amount owed.'), 'label');
  ok(/As of,/.test(csv) && csv.includes('Filters,'), 'meta');
  ok(csv.includes('Alpha,') && csv.includes(',456000,') && csv.includes(',304000,'), 'A row numbers');
  ok(csv.includes('Provisional — reserve needs review'), 'review row marked');
  ok(/Totals \(confirmed\),.*,693500,.*,541500/.test(csv), 'totals row');
  ok(!csv.includes('Cash shortfall'), 'no Cash shortfall line when nothing is short');
});
test('G3 print uses the same model and labels', async () => {
  const sb = loadDash('owner');
  const D = sb.ctx.PMShareDash;
  D._setFetch(async () => dashData());
  await D.load();
  D.print();
  const h = sb.printed.join('');
  for (const s of ['Profit Sharing', '₱693,500.00', '₱541,500.00', 'Internal allocation — not a payout or amount owed.',
                   'Reserve needs review', 'As of']) ok(h.includes(s), 'print missing: ' + s);
});
test('G4 details panel: breakdown, reserve basis, history, acceptance facts; no action buttons', async () => {
  const sb = loadDash('owner');
  const D = sb.ctx.PMShareDash;
  const d = dashData();
  d.read.partners = [{ email: 'p@x.test', accepted: true, accepted_at: '2026-08-12T02:00:00Z', doc_version: 3 }];
  d.read.history = [{ project_id: 'A', old_pct: 50, new_pct: 40, old_was_default: true, reason: 'Agreed 60/40',
                      actor_email: 'admin@dacs.test', changed_at: '2026-09-01T00:00:00Z' }];
  D._setFetch(async () => d);
  await D.load();
  D.open('A');
  const h = sb.ctx.document.getElementById('pmSharingDetail').innerHTML;
  for (const s of ['Collected', 'Labor', 'Supply &amp; install', 'Site overhead', 'Recorded at closeout', 'Agreed 60/40',
                   'This acceptance record does not capture a project sharing percentage.',
                   'Split changed after last signed agreement.', 'Internal allocation — not a payout or amount owed.']) {
    ok(h.includes(s), 'detail missing: ' + s);
  }
  ok(!/<button[^>]*>(?!Close)/.test(h), 'only a Close button');
});


const lossData = () => {
  const d = dashData();
  d.read.projects.push({ project_id: "L", partner_pct: 50, is_default: true, version: 0 });
  d.projects.push({ ...projB, id: "L", projectName: "Loss", clientName: "Lou", terminatedAt: "2026-09-12T02:00:00Z" });
  d.perProject.L = { bills: [bill(100000)], reqs: [] };
  d.reserves.L = rec(0, 0, 100000);
  return d;
};
// minimal CSV reader for the checks below (handles quotes and doubled quotes)
function csvRows(csv) {
  const rows = []; let row = [], cell = "", q = false;
  for (let i = 0; i < csv.length; i++) {
    const ch = csv[i];
    if (q) { if (ch === '"') { if (csv[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; }
    else if (ch === '"') q = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\r") { /* skip */ }
    else if (ch === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
    else cell += ch;
  }
  row.push(cell); rows.push(row);
  return rows;
}
test("G5 staff: print writes nothing, downloadCsv does nothing, toCsv still callable", async () => {
  const sb = loadDash("staff");
  const D = sb.ctx.PMShareDash;
  let urls = 0, blobs = 0;
  sb.ctx.Blob = function () { blobs++; };
  sb.ctx.URL ={ createObjectURL: () => { urls++; return "blob:"; }, revokeObjectURL() {} };
  D._setFetch(async () => dashData());
  await D.load();
  D.print();
  eq(sb.printed.length, 0, "nothing printed");
  D.downloadCsv();
  eq(urls, 0, "no blob url");
  eq(blobs, 0, "no Blob constructed");
  eq(typeof D.toCsv(D.buildModel(D._state.results, D._state.filters), D.metaLines()), "string");
});
test("G6 hostile search text is escaped in print and protected in CSV", async () => {
  const sb = loadDash("owner");
  const D = sb.ctx.PMShareDash;
  D._setFetch(async () => dashData());
  await D.load();
  D._state.filters.q = '<img src=x onerror=alert(1)>,=HYPERLINK("x")';
  D.print();
  const h = sb.printed.join("");
  ok(!h.includes("<img src=x"), "raw tag in print");
  ok(h.includes("&lt;img"), "escaped tag in print");
  const csv = D.toCsv(D.buildModel(D._state.results, D._state.filters), D.metaLines());
  const fl = csv.split("\r\n").find(l => l.startsWith("Filters,"));
  ok(fl.startsWith('Filters,"'), "filters value is quoted");
  const cells = csvRows(csv).flat();
  ok(cells.some(x => x.includes("=HYPERLINK")), "hostile text present");
  ok(cells.every(x => !x.startsWith("=")), "no unprotected = cell");
});
test("G6b a project name starting with = is protected as text in the CSV Project cell", async () => {
  const sb = loadDash("owner");
  const D = sb.ctx.PMShareDash;
  const d = dashData();
  d.projects[0] = { ...projA, projectName: '=HYPERLINK("http://x")' };
  D._setFetch(async () => d);
  await D.load();
  const csv = D.toCsv(D.buildModel(D._state.results, D._state.filters), D.metaLines());
  const line = csv.split("\r\n").find(l => l.includes("HYPERLINK"));
  ok(line && line.startsWith('"\'=HYPERLINK(""http://x"")"'), "raw quoted form: " + line);
  const row = csvRows(csv).find(r => r[0].includes("HYPERLINK"));
  eq(row[0], '\'=HYPERLINK("http://x")', "unquoted Project cell");
  ok(csvRows(csv).flat().every(x => !x.startsWith("=")), "no cell starts with =");
});
test("G7 negative project: Shortfall in CSV and print, Cash shortfall line", async () => {
  const sb = loadDash("owner");
  const D = sb.ctx.PMShareDash;
  D._setFetch(async () => lossData());
  await D.load();
  const csv = D.toCsv(D.buildModel(D._state.results, D._state.filters), D.metaLines());
  const row = csvRows(csv).find(r => r[0] === "Loss");
  ok(row, "Loss row");
  ok(row.includes("-100000"), "balance is a number");
  ok(/Shortfall/.test(row[row.length - 1]), "review cell says Shortfall");
  ok(csv.includes(",-100000,"), "numeric -100000 cell");
  ok(csv.split("\r\n").includes("Cash shortfall,-100000"), "Cash shortfall line");
  D.print();
  const h = sb.printed.join("");
  ok(h.includes("−₱100,000.00"), "negative peso in print");
  ok(h.includes("Shortfall"), "Shortfall in print");
});
test("G8 file format: CRLF lines, BOM on downloaded file", async () => {
  const sb = loadDash("owner");
  const D = sb.ctx.PMShareDash;
  D._setFetch(async () => dashData());
  await D.load();
  const csv = D.toCsv(D.buildModel(D._state.results, D._state.filters), D.metaLines());
  ok(csv.includes("\r\n") && !/[^\r]\n/.test(csv), "CRLF only");
  let parts = null;
  sb.ctx.Blob = function (p) { parts = p; };
  D.downloadCsv();
  ok(parts && parts[0].startsWith("\uFEFF"), "BOM first");
});

// ── runner ───────────────────────────────────────────────────────────
(async () => {
  console.log('\nPM profit sharing');
  for (const [name, fn] of queue) {
    try { await fn(); passed++; console.log('  ok  ' + name); }
    catch (e) { failed++; failures.push(name + ' — ' + e.message); console.log('  FAIL ' + name + '\n       ' + e.message); }
  }
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  if (failed) { console.log(failures.join('\n')); process.exit(1); }
})();
