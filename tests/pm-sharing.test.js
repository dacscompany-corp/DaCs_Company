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
test('C2 a loss shows ₱0 estimate reserve and a −₱50,000 each Loss to split', () => {
  const p = { ...projA, status: 'active' };
  const { html } = overview('owner', p, [bill(100000)], [], shareOf(50, null));
  for (const s of ['Estimate · 5% of remaining cash', 'Loss to split', '−₱100,000.00', 'You −₱50,000.00 (50%)',
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

test('C8 Overview: a completed project with no recorded reserve reads "Provisional · Not counted yet"', () => {
  const { html } = overview('owner', projA, [], [verified(800000)], shareOf(40, null));
  ok(html.includes('Provisional · Not counted yet'), 'new provisional label');
  ok(html.includes('₱40,000.00'), 'provisional reserve = 5% of ₱800,000 remaining');
  for (const s of ['Reserve needs review', 'Shortfall']) ok(!html.includes(s), 'old word: ' + s);
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
  const kh = sb.ctx.document.getElementById('pmRptKpiRow').innerHTML;
  ok(kh.includes('1 project not counted yet (reserve not recorded)'), 'note');
  ok(!kh.includes('reserve review'), 'old note wording gone');
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

test('D7 Reports: a negative combined balance is labelled "Loss to split", never "Shortfall"', () => {
  const sb = loadPmAdmin({ role: 'owner' });
  const bills = [{ directCostTotal: 900000, projectId: 'A' }];          // A: 800,000 paid − 900,000 cost
  const reqs = [{ ...verified(800000), projectId: 'A' }];
  const share = { read: { can_edit: true, history: [], partners: [], projects: [{ project_id: 'A', partner_pct: 50, is_default: true, version: 0 }] },
                  reserves: { A: rec(0, 800000, 900000) }, error: null };
  sb.run(`_pmRptState.projects = ${JSON.stringify([projA])}; _pmRptState.bills = ${JSON.stringify(bills)};
          _pmRptState.payReqs = ${JSON.stringify(reqs)}; _pmRptState.share = ${JSON.stringify(share)}; _pmRptState.fetchError = false;`);
  const cr = sb.ctx._pmRptCashReceipt();
  eq([cr.share.totals.netCents, cr.share.totals.ownerCents, cr.share.totals.partnerCents], [-10000000, -5000000, -5000000]);
  sb.ctx._pmRptRenderKPIs([]);
  const h = sb.ctx.document.getElementById('pmRptKpiRow').innerHTML;
  ok(h.includes('Loss to split') && h.includes('−₱100,000.00'), 'loss label + amount');
  ok(!h.includes('Shortfall'), 'old word gone');
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
// The list page renders into three ids: the shell (#pmSharingRoot), the filter-dependent
// summary above the toolbar (#pmSharingSummary) and the table below it (#pmSharingResults).
const pageHtml = (sb) => ['pmSharingRoot', 'pmSharingSummary', 'pmSharingResults']
  .map(id => sb.ctx.document.getElementById(id).innerHTML).join('');
test('F1 summary = counted projects only; worked example totals; C not counted yet', async () => {
  const sb = loadDash('owner');
  sb.ctx.PMShareDash._setFetch(async () => dashData());
  await sb.ctx.PMShareDash.load();
  const h = pageHtml(sb);
  for (const s of ['From 2 completed projects', '₱693,500.00', '₱541,500.00', '₱1,235,000.00', 'Total · 2 counted',
                   'Internal allocation — not a payout or amount owed.', 'Not counted yet', 'Provisional']) {
    ok(h.includes(s), 'missing: ' + s);
  }
  ok(!h.includes('₱1,235,950.00'), 'review project C (balance ₱950) is not in the totals');
  ok(!h.includes('Reserve needs review'), 'old wording gone');
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
  eq(D.chipsFor(both), ['Client still owes', 'Edited after closeout']);
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
  ok(res.includes('Total · 1 counted'), 'count is project A only');
  ok(doc.getElementById('pmSharingSummary').innerHTML.includes('From 1 completed project,'), 'summary re-rendered too');
  const t = D.buildModel(D._state.results, D._state.filters).totals;
  eq([t.count, t.paidCents, t.reserveCents], [1, 80000000, 4000000], 'totals reflect only project A');
  D.setFilter('q', 'zzz');
  ok(doc.getElementById('pmSharingResults').innerHTML.includes('No completed projects match.'), 'empty message inside results');
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
  ok(csv.includes('Provisional — not counted yet'), 'review row marked');
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
                   'Not counted yet', 'estimated', 'As of']) ok(h.includes(s), 'print missing: ' + s);
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
  for (const s of ['Client paid', 'Labor', 'Pure materials', 'Supply &amp; install', 'Site overhead', 'Set aside at closeout',
                   'Partner 50% → 40%', 'Agreed 60/40', 'admin@dacs.test',
                   'This acceptance record does not capture a project sharing percentage.',
                   'Split changed after last signed agreement.', 'Internal allocation — not a payout or amount owed.']) {
    ok(h.includes(s), 'detail missing: ' + s);
  }
  const buttons = h.match(/<button[^>]*>/g) || [];
  eq(buttons.map(b => (b.match(/onclick="([^"]*)"/) || [])[1]).sort(), ['PMShareDash.close()', 'PMShareDash.print()'],
     'only Back and Print');
  ok(!/<(input|select|textarea)\b/.test(h), 'no form controls in the detail');
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
test("G7 negative project: Loss in CSV and print, Cash shortfall line", async () => {
  const sb = loadDash("owner");
  const D = sb.ctx.PMShareDash;
  D._setFetch(async () => lossData());
  await D.load();
  const csv = D.toCsv(D.buildModel(D._state.results, D._state.filters), D.metaLines());
  const row = csvRows(csv).find(r => r[0] === "Loss");
  ok(row, "Loss row");
  ok(row.includes("-100000"), "balance is a number");
  ok(/^Loss/.test(row[row.length - 1]), "review cell says Loss");
  ok(csv.includes(",-100000,"), "numeric -100000 cell");
  ok(csv.split("\r\n").includes("Cash shortfall,-100000"), "Cash shortfall line");
  D.print();
  const h = sb.printed.join("");
  ok(h.includes("−₱100,000.00"), "negative peso in print");
  ok(h.includes(">Loss<"), "Loss in print");
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

// ══ R. Redesign 1a (split first) ══════════════════════════════════
async function loadedDash(data, role = 'owner') {
  const sb = loadDash(role);
  sb.ctx.PMShareDash._setFetch(async () => data);
  await sb.ctx.PMShareDash.load();
  return sb;
}
const summaryOf = (sb) => sb.ctx.document.getElementById('pmSharingSummary').innerHTML;
test("R1 hero: your share vs partners' share, worked example, internal-figures sentence", async () => {
  const sb = await loadedDash(dashData());
  const h = summaryOf(sb);
  for (const s of ['Your share', '₱693,500.00', "Partners' share", '₱541,500.00',
                   '56.15% of the amount left to share', '43.85% · 1 partner',
                   'From 2 completed projects, <b>₱1,235,000.00</b> is left after costs and warranty reserves.',
                   "That amount is split project by project, using each project's agreed percentage.",
                   'These are internal figures, not payouts or amounts owed.']) ok(h.includes(s), 'hero missing: ' + s);
  ok(/class="pms-hero-own" style="width:56\.15\d*%"/.test(h), 'bar width = owner %');
});
test('R2 sum boxes: client paid − costs − reserve = left to share', async () => {
  const h = summaryOf(await loadedDash(dashData()));
  for (const s of ['How the amount to share is worked out', 'Client paid', '₱1,300,000.00', 'All payments received',
                   'Project costs', '₱0.00', 'Labor, materials, site overhead', 'Warranty reserve', '₱65,000.00',
                   'Set aside at closeout for repairs', 'Left to share', '₱1,235,000.00', 'After costs and reserve']) {
    ok(h.includes(s), 'sum missing: ' + s);
  }
  const l = summaryOf(await loadedDash(lossData()));
  ok(l.includes('Includes ₱100,000.00 loss on 1 project'), 'loss subline');
  ok(l.includes('₱1,135,000.00'), 'net includes the loss');
});
test('R3 attention lists the not-counted project; hidden when nothing needs a look', async () => {
  const sb = await loadedDash(dashData());
  const h = summaryOf(sb);
  ok(h.includes('1 project needs a look'), 'heading');
  ok(/class="pms-attn-card"[^>]*data-pms-id="C"/.test(h), 'card for C, clickable by data-pms-id');
  ok(h.includes('Not counted yet') && h.includes('Warranty reserve wasn&#39;t recorded at closeout. Left out of the totals.'), 'C explanation');
  ok(!/data-pms-id="A"/.test(h) && !/data-pms-id="B"/.test(h), 'ready projects not listed');
  sb.ctx.PMShareDash.setFilter('q', 'ana');
  ok(!/need(s)? a look/.test(summaryOf(sb)), 'section hidden with 0 flagged projects');
  const l = summaryOf(await loadedDash(lossData()));
  ok(l.includes('2 projects need a look'), 'two flagged');
  ok(l.indexOf('data-pms-id="C"') < l.indexOf('data-pms-id="L"'), 'Not counted yet sorts before Loss');
  ok(l.includes('Lost ₱100,000.00 after costs and reserve. The loss lowers both shares.'), 'loss explanation');
});
test('R4 status priority: one main pill, other flags as minor pills; chipsFor returns all', async () => {
  const sb = loadDash('owner');
  const P = sb.ctx.PMShare, D = sb.ctx.PMShareDash;
  const all = P.project({ id: 'Z', status: 'completed', bills: [bill(100000)],
                          reqs: [{ status: 'unpaid', totalAmount: 5, amountPaid: 0 }], reserveRow: null, partnerPct: 50 });
  eq(D.chipsFor(all), ['Not counted yet', 'Loss', 'Client still owes']);
  eq(D.mainStatus(all), 'reserve_review');
  eq(D.mainStatus(P.project(inA)), 'ready');
  const d = dashData();
  d.perProject.B.reqs = [verified(500000), { status: 'unpaid', totalAmount: 1000, amountPaid: 0 }];
  d.reserves.B = rec(25000, 400000, 0);                       // closeout snapshot differs → edited after closeout
  const sb2 = await loadedDash(d);
  const res = sb2.ctx.document.getElementById('pmSharingResults').innerHTML;
  const rowB = res.slice(res.indexOf('data-pms-id="B"'), res.indexOf('data-pms-id="C"'));
  ok(/pms-pill pms-pill--unpaid">Client still owes</.test(rowB), 'main pill');
  ok(/pms-pill pms-pill--minor">Edited after closeout</.test(rowB), 'minor pill');
  ok(rowB.indexOf('Client still owes') < rowB.indexOf('Edited after closeout'), 'main first');
  const att = summaryOf(sb2);
  ok(att.includes('Client still owes ₱1,000.00. Counted with what has been paid so far.'), 'attention uses the main status');
});
test('R5 open(id) shows the full-page detail instead of the list; close() returns', async () => {
  const sb = await loadedDash(dashData());
  const D = sb.ctx.PMShareDash, doc = sb.ctx.document;
  D.open('A');
  const root = doc.getElementById('pmSharingRoot').innerHTML;
  ok(root.includes('id="pmSharingDetail"'), 'detail holder');
  ok(!root.includes('pmSharingResults') && !root.includes('pms-table') && !root.includes('Search project or client'), 'no list');
  const h = doc.getElementById('pmSharingDetail').innerHTML;
  for (const s of ['onclick="PMShareDash.close()"', 'Profit Sharing', 'Alpha', 'Ready', 'Ana · Completed Aug 2, 2026 · Partner p@x.test',
                   "How this project's share was worked out", 'Client paid', '₱800,000.00', 'Minus project costs',
                   'Cash left after costs', 'Minus warranty reserve', '−₱40,000.00', 'Left to share', '₱760,000.00',
                   'You · 60%', '₱456,000.00', 'Partner · 40%', '₱304,000.00',
                   'Payments, costs and the warranty reserve are final. This project is counted in the totals.',
                   'Client balance', 'No changes. This is the original split.', 'Partner agreement',
                   'No Partnership Agreement acceptance on record.', 'Internal allocation — not a payout or amount owed.']) {
    ok(h.includes(s), 'detail missing: ' + s);
  }
  D.open('C');
  const c = doc.getElementById('pmSharingDetail').innerHTML;
  for (const s of ['Not counted yet', 'No warranty reserve was recorded at closeout, so the reserve shown is an estimate.',
                   'Estimate only. No reserve was recorded at closeout, so this uses 5% of the cash left after costs.',
                   'Completed Sep 10, 2026', 'No partner assigned']) ok(c.includes(s), 'C detail missing: ' + s);
  D.open('B');
  ok(doc.getElementById('pmSharingDetail').innerHTML.includes('Ben · No completion date · Partner No partner assigned'), 'undated B');
  const sbAcc = loadDash('owner');
  const d = dashData();
  d.read.partners = [{ email: 'p@x.test', accepted: true, accepted_at: '2026-08-12T02:00:00Z', doc_version: 3 }];
  sbAcc.ctx.PMShareDash._setFetch(async () => d);
  await sbAcc.ctx.PMShareDash.load();
  sbAcc.ctx.PMShareDash.open('A');
  ok(sbAcc.ctx.document.getElementById('pmSharingDetail').innerHTML
       .includes('This acceptance record does not capture a project sharing percentage.'), 'acceptance facts verbatim');
  D.close();
  const back = doc.getElementById('pmSharingRoot').innerHTML;
  ok(back.includes('id="pmSharingResults"') && back.includes('Search project or client') && !back.includes('id="pmSharingDetail"'), 'list back');
  ok(doc.getElementById('pmSharingResults').innerHTML.includes('pms-table'), 'table back');
  eq(D._state.openId, null);
});
test('R6 nothing positive to share → no NaN, no negative widths, amounts still shown', async () => {
  const d = lossData();
  d.read.projects = d.read.projects.filter(x => x.project_id === 'L');
  d.projects = d.projects.filter(p => p.id === 'L');
  for (const data of [d, { ...dashData(), read: { ...dashData().read, projects: [] }, projects: [] }]) {
    const sb = await loadedDash(data);
    const h = pageHtml(sb);
    ok(!h.includes('NaN') && !h.includes('Infinity'), 'no NaN');
    ok(!/width:\s*-/.test(h), 'no negative width');
    ok(summaryOf(sb).includes('No positive amount to share'), 'empty bar text');
  }
  const sb = await loadedDash(d);
  const h = summaryOf(sb);
  ok(h.includes('−₱50,000.00') && h.includes('−₱100,000.00'), 'amounts still shown');
  sb.ctx.PMShareDash.open('L');
  const det = sb.ctx.document.getElementById('pmSharingDetail').innerHTML;
  ok(det.includes('Loss to split') && det.includes('pms-step4 pms-neg'), 'detail loss tint');
  ok(!det.includes('Shortfall') && !det.includes('NaN'), 'no old word, no NaN');
});
test('R7 CSV and print use the new status words', async () => {
  const sb = await loadedDash(lossData());
  const D = sb.ctx.PMShareDash;
  const csv = D.toCsv(D.buildModel(D._state.results, D._state.filters), D.metaLines());
  D.print();
  const pr = sb.printed.join('');
  for (const [name, out] of [['csv', csv], ['print', pr]]) {
    for (const s of ['Not counted yet', 'Loss', 'Ready']) ok(out.includes(s), name + ' missing: ' + s);
    for (const s of ['Reserve needs review', 'reserve needing review', 'Unpaid client balance', 'Changed since closeout', 'Shortfall']) {
      ok(!out.includes(s), name + ' still says: ' + s);
    }
  }
  ok(csv.includes('Provisional — not counted yet'), 'CSV provisional marking');
  ok(/Totals \(confirmed\),.*1 not counted yet \(not in totals\)/.test(csv), 'CSV totals note');
});
test('R8 partner chips and dates: data attributes, escaped, no data in handlers', async () => {
  const d = dashData();
  d.projects[0] = { ...projA, partnerEmail: '"><img src=x onerror=alert(1)>@x.test' };
  const sb = await loadedDash(d);
  const root = sb.ctx.document.getElementById('pmSharingRoot').innerHTML;
  ok(root.includes('data-pms-partner="all"') && root.includes('data-pms-partner="unassigned"'), 'constant chips');
  ok(root.includes('All partners') && root.includes('No partner'), 'chip labels');
  ok(!root.includes('<img src=x'), 'hostile email escaped');
  ok(root.includes('data-pms-partner="&quot;&gt;&lt;img src=x onerror=alert(1)&gt;@x.test"'), 'escaped attribute');
  ok(!/onclick="[^"]*setFilter\('partner'/.test(root), 'no partner value inside a handler');
  ok(root.includes('Any completion date'), 'default date label');
  const D = sb.ctx.PMShareDash;
  D.setFilter('from', '2026-08-01'); D.setFilter('to', '2026-08-31');
  ok(sb.ctx.document.getElementById('pmSharingRoot').innerHTML.includes('Aug 1 – Aug 31, 2026'), 'range label');
  D.setFilter('undatedOnly', true);
  ok(sb.ctx.document.getElementById('pmSharingRoot').innerHTML.includes('>Undated only<'), 'undated label');
  D.setFilter('partner', 'unassigned');
  ok(/aria-pressed="true" data-pms-partner="unassigned"/.test(sb.ctx.document.getElementById('pmSharingRoot').innerHTML), 'active chip');
});
test('R9 header: title, updated time, Print / CSV / Refresh with constant handlers', async () => {
  const sb = await loadedDash(dashData());
  const root = sb.ctx.document.getElementById('pmSharingRoot').innerHTML;
  for (const s of ['<h1 class="pms-title">Profit Sharing</h1>', 'Completed projects · Updated ', 'onclick="PMShareDash.print()"',
                   'Print / PDF', 'onclick="PMShareDash.downloadCsv()"', 'onclick="PMShareDash.load()"', 'title="Refresh"']) {
    ok(root.includes(s), 'header missing: ' + s);
  }
  ok(root.includes('id="pmSharingSummary"') && root.indexOf('id="pmSharingSummary"') < root.indexOf('Search project or client')
     && root.indexOf('Search project or client') < root.indexOf('id="pmSharingResults"'), 'summary · toolbar · table order');
});

test('R10 mixed profit and loss: owner share above the net → no % in the hero, amounts still shown', async () => {
  // A: +₱760,000 at 60/40 (owner ₱456,000). L2: −₱700,000 at 0/100 (owner ₱0, partner −₱700,000).
  // Net ₱60,000; owner ₱456,000 = 760% of it — a % would be meaningless.
  const d = dashData();
  d.read.projects = [{ project_id: 'A', partner_pct: 40, is_default: false, version: 1 },
                     { project_id: 'L2', partner_pct: 100, is_default: false, version: 1 }];
  d.projects = [projA, { ...projB, id: 'L2', projectName: 'Loss two', terminatedAt: '2026-09-01T02:00:00Z' }];
  d.perProject.L2 = { bills: [bill(700000)], reqs: [] };
  d.reserves = { A: rec(40000, 800000, 0), L2: rec(0, 0, 700000) };
  const sb = await loadedDash(d);
  const t = sb.ctx.PMShareDash.buildModel(sb.ctx.PMShareDash._state.results, sb.ctx.PMShareDash._state.filters).totals;
  eq([t.netCents, t.ownerCents, t.partnerCents], [6000000, 45600000, -39600000], 'fixture: owner > net');
  const h = summaryOf(sb);
  const hero = h.slice(h.indexOf('pms-hero'), h.indexOf('pms-hero-p'));
  ok(h.includes('No positive amount to share'), 'fallback bar');
  ok(h.includes('₱456,000.00') && h.includes('−₱396,000.00'), 'amounts still shown');
  ok(!/−?\d+(\.\d+)?%/.test(hero), 'no % at all in the hero: ' + (hero.match(/[-−]?\d+(\.\d+)?%/g) || []).join(','));
  ok(!/[-−]\d+(\.\d+)?%/.test(h), 'no negative % anywhere in the summary');
  ok(!(h.match(/(\d+(?:\.\d+)?)%/g) || []).some(x => parseFloat(x) > 100), 'no % above 100 in the summary');
  ok(!/width:\s*-/.test(h) && !h.includes('NaN'), 'no negative width, no NaN');
  ok(!/aria-label="Your share/.test(h), 'no % in an aria-label either');
});
test('R11 table rows: focusable buttons named by project and amount, no table/row roles wrapping them', async () => {
  const sb = await loadedDash(dashData());
  const res = sb.ctx.document.getElementById('pmSharingResults').innerHTML;
  ok(!/role="(table|row|cell|columnheader)"/.test(res), 'no table/row roles');
  ok(/role="button" tabindex="0" aria-label="Alpha, left to share ₱760,000.00, Ready" data-pms-id="A"/.test(res), 'row A named');
  ok(/aria-label="Beta · 2026-09-10 · C, left to share ₱950.00, provisional, Not counted yet" data-pms-id="C"/.test(res), 'review row named');
  ok(/pms-thead" aria-hidden="true"/.test(res), 'visual header hidden from screen readers');
});
test('R12 date popover closes on Escape and outside click; one listener pair, removed on close', async () => {
  const sb = await loadedDash(dashData());
  const D = sb.ctx.PMShareDash, doc = sb.ctx.document;
  const live = new Map();
  let adds = 0;
  doc.addEventListener = (type, fn) => { adds++; live.set(type, fn); };
  doc.removeEventListener = (type, fn) => { if (live.get(type) === fn) live.delete(type); };
  const pop = doc.getElementById('pmSharingDatePop'), btn = doc.getElementById('pmSharingDateBtn');
  D.toggleDates();
  eq([D._state.dateOpen, pop.hidden, [...live.keys()].sort()], [true, false, ['click', 'keydown']]);
  D.setFilter('from', '2026-08-01');                      // re-render while open: still open, no new listeners
  eq([D._state.dateOpen, adds], [true, 2]);
  ok(doc.getElementById('pmSharingRoot').innerHTML.includes('id="pmSharingDatePop" class="pms-pop">'), 'rendered open');
  const tIn = {}, tOut = {};
  pop.contains = (t) => t === tIn; btn.contains = () => false;
  live.get('click')({ target: tIn });
  eq(D._state.dateOpen, true, 'click inside keeps it open');
  live.get('keydown')({ key: 'Tab' });
  eq(D._state.dateOpen, true, 'other keys ignored');
  live.get('keydown')({ key: 'Escape' });
  eq([D._state.dateOpen, pop.hidden, live.size], [false, true, 0], 'Escape closes and unbinds');
  D.toggleDates();
  live.get('click')({ target: tOut });
  eq([D._state.dateOpen, live.size, adds], [false, 0, 4], 'outside click closes and unbinds');
  D.toggleDates(); D.open('A');
  eq([D._state.dateOpen, live.size], [false, 0], 'opening a project closes it too');
});

// ══ P. Printed statement v2 ═══════════════════════════════════════════
const printOf = async (data) => { const sb = await loadedDash(data); sb.ctx.PMShareDash.print(); return sb.printed.join(''); };
test('P1 header, summary values and the "how it is worked out" box', async () => {
  const h = await printOf(dashData());
  for (const s of ["Completed projects · DAC's Building Design Services", '/assets/images/DACS-TRANSPARENT.png', '<div class="t">Profit Sharing</div>',
                   '<span class="k">As of</span>', '<span class="k">Completed</span><span class="v">All dates</span>', '<span class="k">Partners</span><span class="v">All partners</span>',
                   'Your share · 56.15%', '₱693,500.00', "Partners' share · 43.85%", '₱541,500.00',
                   'How the amount to share is worked out', '− Project costs (labor, materials, site overhead)', '− Warranty reserve (set aside at closeout)',
                   '= Left to share · 2 projects', '₱1,235,000.00', "Split project by project, using each project&#39;s agreed percentage.",
                   'Basis: left to share = client paid',
                   'fonts.googleapis.com/css2?family=Barlow']) ok(h.includes(s), 'print missing: ' + s);
  ok(!h.includes('Includes a ') , 'no loss sentence when nothing is short');
});
test('P2 by-partner lines: fixture partner sum, unassigned confirmed rows', async () => {
  const h = await printOf(dashData());
  ok(h.includes('<span>p@x.test · 1 project</span><span class="n b right">₱304,000.00</span>'), 'partner A sum is its partnerCents');
  ok(h.includes('<span>No partner assigned · 1 project</span>'), 'unassigned confirmed row');
});
test('P3 loss fixture: Loss to split in red, loss sentence, partner "includes a loss"', async () => {
  const d = lossData();
  d.projects.find(x => x.id === 'L').partnerEmail = 'q@x.test';
  const h = await printOf(d);
  ok(h.includes('<td class="r b negc">−₱100,000.00</td>'), 'red left-to-share cell');
  ok(h.includes('class="r negc">−₱50,000.00<div class="grey pct">50%</div>'), 'red share cells with pct');
  ok(h.includes('<span>q@x.test · 1 project, includes a loss</span><span class="n b right negc">−₱50,000.00</span>'), 'partner line red + loss mark');
  ok(h.includes('Includes a ₱100,000.00 loss on 1 project.'), 'loss sentence');
  ok(h.includes('<span class="pill" style="background:#F8E7E4;color:#8F352C">Loss</span>'), 'Loss pill');
  ok(h.includes('<div class="grey">Loss to split') === false, 'sanity');
});
test('P3b a net loss prints "= Loss to split" in red', async () => {
  const d = { ...dashData() };
  d.reserves = { A: rec(0, 0, 0), B: rec(0, 0, 0) };
  d.perProject = { A: { bills: [bill(900000)], reqs: [verified(800000)] }, B: { bills: [bill(900000)], reqs: [verified(500000)] }, C: d.perProject.C };
  const h = await printOf(d);
  ok(h.includes('<div class="ln tot neg"><span>= Loss to split · 2 projects</span>'), 'net loss label in red');
});
test('P4 review row: own section, estimated, excluded from totals and by-partner sums', async () => {
  const h = await printOf(dashData());
  ok(h.includes('<h2 class="tight">Not counted yet</h2>') && h.includes('estimated</span>'), 'review card');
  ok(h.includes('− estimated reserve') && h.includes('No warranty reserve was recorded at closeout, so this project is left out of the totals until it is.'), 'copy');
  const counted = h.slice(h.indexOf('<h2>Counted projects</h2>'), h.indexOf('<h2 class="tight">Not counted yet</h2>'));
  ok(!counted.includes('Beta') || counted.split('Beta').length - 1 === 1, 'review project is not a counted row (only confirmed Beta B)');
  ok(counted.includes('Total · 2 projects'), 'count excludes review');
  ok(h.includes('<span>No partner assigned · 1 project</span>'), 'by-partner counts confirmed only');
  ok(h.includes('Not counted yet'), 'status');
});
test('P5 per-page footer, spacer, landscape page, empty state', async () => {
  const h = await printOf(dashData());
  ok(h.includes('</tbody><tfoot><tr><td><div class="foot-space"></div></td></tr></tfoot></table>') && h.includes('<table class="sheet"><thead>'), 'tfoot spacer wraps the statement');
  ok(h.includes('.foot-space{height:0.55in}') && h.includes('position:fixed') && h.includes('print-color-adjust:exact'), 'print css');
  ok(h.includes("Profit Sharing · DAC's Building Design Services · As of ") && h.includes('Internal allocation — not a payout or amount owed.'), 'footer');
  const sb = await loadedDash(dashData());
  sb.ctx.PMShareDash._state.filters.q = 'zzzz-no-match';
  sb.ctx.PMShareDash.print();
  const e = sb.printed.join('');
  ok(e.includes('No completed projects match these filters.') && e.includes('Profit Sharing') && e.includes('Internal allocation'), 'empty state');
  ok(!e.includes('Counted projects'), 'no table when empty');
});
test('V1 landscape page and the Counted projects table with its total row', async () => {
  const h = await printOf(dashData());
  ok(h.includes('@page{size:letter landscape;margin:0.5in}'), 'landscape @page');
  ok(h.includes('@media screen{') && h.includes('max-width:11in') && h.includes('min-height:8.5in'), 'screen landscape sheet');
  for (const s of ['<h2>Counted projects</h2>', '<table class="grid"><thead>', '>Client paid</th>', '>Left to share</th>', '>Your share</th>', '>Partner share</th>', '>Status</th>',
                   '<tr class="total"><td>Total · 2 projects</td>', 'class="r green">₱693,500.00', '<td class="r">₱541,500.00</td>']) ok(h.includes(s), 'missing: ' + s);
  ok(h.includes('<b>Alpha</b>') && h.includes('Ana · Aug 2, 2026 · p@x.test'), 'row label + subline');
});
test('V2 the Not counted yet section is omitted when there are no review rows', async () => {
  const d = dashData();
  d.reserves.C = rec(25000, 1000, 0);
  const h = await printOf(d);
  ok(!h.includes('Not counted yet'), 'no review section');
  ok(h.includes('What the statuses mean') && h.includes('grid-template-columns:1fr"'), 'legend takes the space');
});
test('V3 legend lists only present statuses plus Ready, with the unpaid amount', async () => {
  const d = dashData();
  d.perProject.A.reqs.push({ status: 'unpaid', totalAmount: 1000, amountPaid: 0 });
  const h = await printOf(d);
  const lg = h.slice(h.indexOf('What the statuses mean'));
  ok(lg.includes('>Ready</b>') && lg.includes('Payments, costs and reserve are final.'), 'Ready');
  ok(lg.includes('>Client still owes</b>') && lg.includes('Counted with what has been paid so far. Alpha: ₱1,000.00 unpaid.'), 'unpaid line');
  ok(lg.includes('>Not counted yet</b>') && lg.includes('left out of the totals.'), 'review status present');
  ok(!lg.includes('>Loss</b>') && !lg.includes('>Edited after closeout</b>'), 'absent statuses omitted');
});
test('P6 card title: name (+ short id only when duplicated), date once in the subline', async () => {
  const d = dashData();
  d.projects[2] = { ...d.projects[2], projectName: 'Alpha' };   // C duplicates A's name
  const h = await printOf(d);
  ok(h.includes('<b>Beta</b>') && h.includes('<b>Alpha · A</b>') && h.includes('<b>Alpha · C</b>'), 'plain name and name + short id');
  ok(!h.includes('<b>Alpha · Aug') && !h.includes('undated'), 'no date in the title');
});
test('P7 hostile name, client and partner are escaped exactly once in print', async () => {
  const d = dashData();
  d.projects[0] = { ...projA, projectName: '<b>X</b>', clientName: '<i>Y</i>', partnerEmail: "\"q'@x.test" };
  const h = await printOf(d);
  ok(!h.includes('<b>X') && !h.includes('<i>Y'), 'no raw tags');
  ok(h.includes('&lt;b&gt;X&lt;/b&gt;') && h.includes('&lt;i&gt;Y&lt;/i&gt;'), 'escaped');
  ok(h.includes('&quot;q&#39;@x.test') && !h.includes('&amp;quot;') && !h.includes('&amp;lt;') && !h.includes('&amp;#39;'), 'escaped once, not twice');
});
test('P8 share % rule is one helper shared by hero and print', () => {
  const src = read('js/pm-sharing-dashboard.js');
  eq(src.split('function shareSplit(').length - 1, 1);
  eq(src.split('shareSplit(t)').length - 1, 3, 'defined once, used by hero and print');
});
test('P9 print waits link -> fonts.load -> fonts.ready (+ logo), prints once; hard cap', async () => {
  const src = read('js/pm-sharing-dashboard.js');
  ok(src.includes('setTimeout(go, 1500)') && src.includes('id="pmsFonts"') && src.includes('id="pmsLogo"'), 'cap + ids');
  const sb = await loadedDash(dashData());
  let prints = 0;
  const order = [], lis = { font: {}, logo: {} };
  const mk = (k, extra) => ({ addEventListener: (ev, fn) => { (lis[k][ev] = lis[k][ev] || []).push(fn); }, ...extra });
  const fontsEl = mk('font', { sheet: null }), logoEl = mk('logo', { complete: false });
  const fonts = { load: (spec) => { order.push('load:' + spec); return Promise.resolve([]); },
                  get ready() { order.push('ready'); return Promise.resolve(); } };
  sb.ctx.open = () => ({ print() { order.push('print'); prints++; }, document: { write() {}, close() {}, fonts,
    getElementById: (id) => id === 'pmsFonts' ? fontsEl : id === 'pmsLogo' ? logoEl : null } });
  sb.ctx.PMShareDash.print();
  const tick = () => new Promise(r => setTimeout(r, 20));
  await tick();
  eq(order, [], 'no fonts.load / fonts.ready / print before the stylesheet link resolves');
  lis.font.load.forEach(fn => fn()); await tick();
  eq(order.slice(0, 3).sort(), ['load:400 12pt Barlow', 'load:600 30pt "Playfair Display"', 'load:700 12pt Barlow'], 'faces requested after the link');
  eq(order[3], 'ready', 'fonts.ready only after the loads');
  eq(prints, 0, 'logo still pending');
  lis.logo.error.forEach(fn => fn()); await tick();
  eq([prints, order[order.length - 1]], [1, 'print'], 'printed once, last');
  lis.font.load.forEach(fn => fn()); lis.logo.load.forEach(fn => fn()); await tick();
  eq(prints, 1, 'never twice');
});
test('P10 duplicated names use name + short id everywhere in print, never the date', async () => {
  const d = lossData();
  d.projects.find(x => x.id === 'L').partnerEmail = 'q@x.test';
  d.projects.push({ ...projB, id: 'M', projectName: 'Loss', clientName: 'Mia', terminatedAt: '2026-09-13T02:00:00Z', partnerEmail: 'q@x.test' });
  d.read.projects.push({ project_id: 'M', partner_pct: 50, is_default: true, version: 0 });
  d.perProject.M = { bills: [bill(100000)], reqs: [] }; d.reserves.M = rec(0, 0, 100000);
  const h = await printOf(d);
  ok(h.includes('<b>Loss · L</b>') && h.includes('<b>Loss · M</b>'), 'titles with short ids');
  ok(!h.includes('Loss · Sep') && !h.includes('Loss · undated'), 'no date in any title');
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
