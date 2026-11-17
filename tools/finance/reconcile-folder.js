#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════
// RECONCILE ONE PROJECT CONTROL FOLDER AGAINST ITS LIVE RECORDS — read-only.
//
//   node tools/finance/reconcile-folder.js --folder <folders.id> [--today <ISO>] [--out <file>]
//   node tools/finance/reconcile-folder.js --sql-self-test
//
// Financial MVP Phase 1 (spec docs/superpowers/specs/2026-11-14-financial-
// management-mvp-design.md §7.1). Reads the folder's current rows through the
// linked Supabase project (`npx supabase db query --linked`, SELECT only), then
// runs the OLD money functions (lifted from js/portal-app.compiled.js, the way
// the screen builds a project) and the NEW labelling layer (js/project-
// finance.js) over the same rows, and checks that they agree to the centavo.
//
// It writes nothing anywhere. It sends only its own fixed SELECT statements;
// as a second line of defence, the guard refuses any statement that does not
// start with SELECT / WITH, contains a write keyword (including SELECT … INTO)
// or more than one statement. The guard cannot tell whether a function called
// inside a SELECT has side effects, so the tool calls none. Worker names are
// read only because the old labour classifier needs them for untyped rows, and
// are never printed.
// Exit: 0 = every check passed, 1 = a check failed, 2 = refused, 3 = query failed.
// ════════════════════════════════════════════════════════════════════
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const PF = require(path.join(ROOT, 'js', 'project-finance.js'));
const { loadPortalMoney, projectFromRows } = require(path.join(ROOT, 'tests', 'helpers', 'portal-money.js'));

const args = process.argv.slice(2);
const arg = name => { const i = args.indexOf(name); return i === -1 ? null : args[i + 1]; };

// ── the read-only guard ──────────────────────────────────────────────
const READ_ONLY = /^\s*(select|with)\b/i;
const WRITE_WORD = /\b(insert|update|delete|alter|drop|create|grant|revoke|truncate|copy|call|do|into|merge|lock|vacuum|reindex|cluster|refresh|notify|listen|set|reset|execute|prepare)\b/i;
function guard(sql) {
  const body = sql.trim().replace(/;\s*$/, '');
  if (!READ_ONLY.test(body) || WRITE_WORD.test(body) || body.includes(';')) {
    console.error('Refused: only a single read-only SELECT may run. Nothing was sent.');
    process.exit(2);
  }
  return body;
}
if (args.includes('--sql-self-test')) {
  guard('select 1');
  console.log('read-only SELECT accepted');
  for (const bad of ["update folders set name = 'x'", 'select * into stolen from folders', 'select 1; delete from folders']) {
    if (READ_ONLY.test(bad.trim()) && !WRITE_WORD.test(bad) && !bad.trim().replace(/;\s*$/, '').includes(';')) {
      console.error('GUARD FAILED: not refused: ' + bad);
      process.exit(1);
    }
  }
  guard("update folders set name = 'x'");   // must exit 2 before anything is sent
  console.error('GUARD FAILED: a write was not refused');
  process.exit(1);
}

const folderId = arg('--folder');
if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(folderId || '')) {
  console.error('Usage: node tools/finance/reconcile-folder.js --folder <folders.id uuid> [--today <ISO>] [--out <file>]');
  process.exit(2);
}
const today = arg('--today') ? new Date(arg('--today')) : new Date();
if (isNaN(today.getTime())) {
  console.error('--today must be an ISO date, e.g. 2026-11-14T00:00:00+08:00');
  process.exit(2);
}

function query(sql) {
  const body = guard(sql);
  const file = path.join(os.tmpdir(), 'dacs-reconcile-' + process.pid + '-' + Math.random().toString(36).slice(2) + '.sql');
  fs.writeFileSync(file, body + '\n');
  let r;
  try {
    r = spawnSync('npx', ['supabase', 'db', 'query', '--linked', '-f', '"' + file + '"'],
      { cwd: ROOT, shell: true, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  } finally {
    try { fs.unlinkSync(file); } catch (e) { /* already gone */ }   // removed before any exit
  }
  const out = (r.stdout || '').trim();
  let parsed = null;
  try { parsed = JSON.parse(out.slice(out.indexOf('{'))); } catch (e) { /* reported below */ }
  if (r.status !== 0 || !parsed || !Array.isArray(parsed.rows)) {
    console.error('Query failed:\n' + (r.stderr || '') + '\n' + out.slice(0, 2000));
    process.exit(3);
  }
  return parsed.rows;
}

// ── read ─────────────────────────────────────────────────────────────
const folders = query(`select f.id, f.name, f.parent_folder_id, fb.total_budget from folders f
  left join folder_budgets fb on fb.folder_id = f.id
  where f.id = '${folderId}' or f.parent_folder_id = '${folderId}'`);
const parent = folders.find(f => f.id === folderId);
if (!parent) { console.error('No folder ' + folderId); process.exit(3); }
const ids = folders.map(f => f.id);
const inFolders = '(' + ids.map(id => `'${id}'`).join(',') + ')';
const periodsRaw = query(`select p.id, p.folder_id, p.month, p.year, p.billing_number, p.funding_type, pb.monthly_budget,
  a.direct_pct, a.indirect_pct, a.target_margin_pct from projects p
  left join project_budgets pb on pb.project_id = p.id
  left join project_control_billing_allocations a on a.project_id = p.id
  where p.folder_id in ${inFolders}`);
const inPeriods = `(select id from projects where folder_id in ${inFolders})`;
const payrollRaw = query(`select id, project_id, worker_name, role, labor_type, total_salary, payment_date, liability_for
  from payroll where project_id in ${inPeriods}`);
const expensesRaw = query(`select id, project_id, folder_id, amount, date_time, cover_expense, purchase_line_id, stk_cost_move_id
  from expenses where project_id in ${inPeriods} or (project_id is null and folder_id in ${inFolders})`);
const overheadRaw = query(`select id, folder_id, scope, amount, date, deleted_at, billing_period_id
  from overhead_expenses where folder_id in ${inFolders}`);
const boqRaw = query(`select id, folder_id, status, updated_at, cost_items from boq_documents where folder_id in ${inFolders}`);

// ── map to the shapes the shim gives the browser ─────────────────────
const n = v => (v === null || v === undefined ? 0 : Number(v));
const periods = periodsRaw.map(p => ({ id: p.id, folderId: p.folder_id, month: p.month || '', year: p.year || '',
  billingNumber: p.billing_number, fundingType: p.funding_type || '', monthlyBudget: n(p.monthly_budget) }));
const allocationMap = Object.fromEntries(periodsRaw.filter(p => p.direct_pct !== null && p.direct_pct !== undefined)
  .map(p => [p.id, { directPct: n(p.direct_pct), indirectPct: n(p.indirect_pct), targetMarginPct: n(p.target_margin_pct) }]));
const payroll = payrollRaw.map(r => ({ id: r.id, projectId: r.project_id, workerName: r.worker_name, role: r.role,
  laborType: r.labor_type, totalSalary: n(r.total_salary), paymentDate: r.payment_date, liabilityFor: r.liability_for }));
const expenses = expensesRaw.map(r => ({ id: r.id, projectId: r.project_id, folderId: r.folder_id, amount: n(r.amount),
  dateTime: r.date_time, coverExpense: !!r.cover_expense, purchaseLineId: r.purchase_line_id, stkCostMoveId: r.stk_cost_move_id }));
const overhead = overheadRaw.map(r => ({ id: r.id, folderId: r.folder_id, scope: r.scope, amount: n(r.amount), date: r.date,
  deletedAt: r.deleted_at, billingPeriodId: r.billing_period_id }));
const boqDocs = boqRaw.map(b => ({ id: b.id, folderId: b.folder_id, status: b.status, updatedAt: b.updated_at,
  costItems: Array.isArray(b.cost_items) ? b.cost_items : [] }));

// ── OLD: the project exactly as PortalApp builds it (Additional Works merged) ──
const money = loadPortalMoney();
const c = PF.pfCents;
function folderProject(f) {
  const own = periods.filter(p => p.folderId === f.id);
  const ownIds = new Set(own.map(p => p.id));
  return projectFromRows({ folder: { id: f.id, name: f.name, totalBudget: n(f.total_budget) }, periods: own,
    payroll: payroll.filter(r => ownIds.has(r.projectId)),
    expenses: expenses.filter(e => ownIds.has(e.projectId) || (!e.projectId && e.folderId === f.id)),
    overhead: overhead.filter(o => o.folderId === f.id), boqDocs });
}
const base = folderProject(parent);
const kids = folders.filter(f => f.id !== folderId).map(folderProject);
const merged = { ...base,
  revenue: base.revenue + kids.reduce((s, k) => s + k.revenue, 0),
  labor: base.labor + kids.reduce((s, k) => s + k.labor, 0),
  material: base.material + kids.reduce((s, k) => s + k.material, 0),
  allocated: base.allocated + kids.reduce((s, k) => s + k.allocated, 0),
  overhead: base.overhead + kids.reduce((s, k) => s + (k.overhead || 0), 0) };
merged.spent = money._projSpent(merged);
merged.completion = money._folderCompletion(boqDocs, folderId);
const oldMargin = money._projMargin(merged);

// ── NEW: the labelling layer over the same rows ──────────────────────
const pv = PF.pfProfitView({ contract: merged.revenue, spent: merged.spent, completion: merged.completion, today, period: 'All Time' });
const rem = PF.pfAllocationRemaining({ periods, allocationMap, spentCents: c(merged.spent), allTime: true });
const fb = PF.pfFundBalances({ periods, payroll, expenses, overhead, folderIds: new Set(ids) });
const dups = PF.pfDuplicateBillingNumbers(periods);

// ── checks ───────────────────────────────────────────────────────────
const lines = [];
const say = s => { lines.push(s); console.log(s); };
let failures = 0;
const check = (name, pass, detail) => { if (!pass) failures++; say((pass ? 'PASS ' : 'FAIL ') + name + (detail ? ' — ' + detail : '')); };
const P = PF.pfPeso;
const periodIds = new Set(periods.map(p => p.id));
const liveOverhead = overhead.filter(o => !o.deletedAt && o.scope !== 'company');
const unique = rows => new Set(rows.map(r => r.id)).size === rows.length;

check('C1 old Spent = new Spent', c(merged.spent) === fb.spentCents, P(c(merged.spent)) + ' vs ' + P(fb.spentCents));
if (pv.boq.available) {
  check('C2 old "Earned" profit = BOQ-based profit estimate', c(oldMargin.profit) === pv.boq.profitCents,
    P(c(oldMargin.profit)) + ' vs ' + P(pv.boq.profitCents));
} else {
  check('C2 old "Forecast" profit = Contract value minus costs (no BOQ progress)', c(oldMargin.profit) === pv.contractLessCost.cents,
    P(c(oldMargin.profit)) + ' vs ' + P(pv.contractLessCost.cents));
}
const oldRemaining = c(merged.allocated) - c(merged.spent);
check('C3 old Budget Remaining = Total Allocation Remaining',
  oldRemaining === rem.totalCents && rem.totalCents === fb.totalRemainingCents,
  P(oldRemaining) + ' / ' + P(rem.totalCents) + ' / ' + P(fb.totalRemainingCents)
  + (oldRemaining !== rem.totalCents ? ' (a Cover period carries a fund amount?)' : ''));
const sumBalances = fb.rows.filter(r => !r.cover).reduce((s, r) => s + r.balanceCents, 0);
const sumFronted = fb.rows.filter(r => r.cover).reduce((s, r) => s + r.companyFrontedCents, 0);
check('C4 Σ fund balances − company-fronted − not charged = total', sumBalances - sumFronted - fb.notChargedCents === fb.totalRemainingCents,
  P(sumBalances) + ' − ' + P(sumFronted) + ' − ' + P(fb.notChargedCents));
const expCharged = expenses.filter(e => e.projectId && periodIds.has(e.projectId)).length;
const ovCharged = liveOverhead.filter(o => periods.some(p => p.id === o.billingPeriodId && p.folderId === o.folderId)).length;
check('C5 every row counted once',
  unique(payroll) && unique(expenses) && unique(overhead)
  && payroll.every(r => periodIds.has(r.projectId))
  && expCharged + fb.notChargedRows.expenses === expenses.length
  && ovCharged + fb.notChargedRows.overhead === liveOverhead.length,
  `payroll ${payroll.length} · expenses ${expCharged} charged + ${fb.notChargedRows.expenses} not = ${expenses.length} · `
  + `overhead ${ovCharged} charged + ${fb.notChargedRows.overhead} not = ${liveOverhead.length} live (${overhead.length - liveOverhead.length} deleted/company)`);
if (!rem.incomplete) {
  const dv = rem.directCents - c(merged.labor) - c(merged.material), iv = rem.indirectCents - c(merged.overhead);
  check('C6 operating = direct variance + indirect variance', rem.operatingCents === dv + iv, P(rem.operatingCents) + ' = ' + P(dv) + ' + ' + P(iv));
} else {
  say('SKIP C6 operating allocation remaining is Incomplete (' + rem.missing + ' funded billing period(s) have no allocation)');
}

// ── the figures (no names, no row-level personal data) ───────────────
const b = pv.boq.basis;
say('');
say('Folder ' + parent.name + ' (' + folderId + ')' + (kids.length ? ' + ' + kids.length + ' Additional Works' : '') + ' · read ' + today.toISOString());
say('Contract                       ' + P(c(merged.revenue)));
say('BOQ                            ' + (b.hasProgress ? b.completePct.toFixed(1) + '% complete' : 'no progress') + ' · ' + b.savedText
  + ' · status ' + b.status + (b.ageDays !== null ? ' · ' + b.ageDays + ' days' : '') + (b.badges.length ? ' · ⚠ ' + b.badges.join(' · ⚠ ') : ''));
say('Spent                          ' + P(c(merged.spent)) + '  (Labor ' + P(c(merged.labor)) + ' · Material ' + P(c(merged.material))
  + ' · Overhead ' + P(c(merged.overhead)) + ')');
say('Cover (subset of Spent)        ' + P(c(merged.coverCost)));
say('Headline                       ' + pv.headline.label + (pv.headline.cents !== null ? ' ' + P(pv.headline.cents) : '')
  + (pv.headline.reasons.length ? ' — ' + pv.headline.reasons.join(' · ') : ''));
say('BOQ-based profit estimate      ' + (pv.boq.available ? P(pv.boq.profitCents) + ' (' + PF.pfPct(pv.boq.marginPct) + ' of BOQ-earned revenue)' : 'No BOQ progress recorded'));
say('Recognized Project Profit      ' + pv.recognized.text);
say('Contract value minus costs     ' + P(pv.contractLessCost.cents));
say('Contract less allocated funds  ' + P(c(merged.revenue) - c(merged.allocated)));
say('Direct / indirect / reserve    ' + P(rem.directCents) + ' / ' + P(rem.indirectCents) + ' / ' + P(rem.reserveCents));
say('Direct variance                ' + P(rem.directCents - c(merged.labor) - c(merged.material)));
say('Indirect variance              ' + P(rem.indirectCents - c(merged.overhead)));
say('Operating allocation remaining ' + (rem.incomplete ? 'Incomplete — ' + rem.missing + ' period(s) without allocation' : P(rem.operatingCents)));
say('Total Allocation Remaining     ' + P(rem.totalCents));
say('');
say('Billing periods (matched by id):');
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
fb.rows.slice().sort((x, y) => (Number(x.year) - Number(y.year)) || (MONTHS.indexOf(x.month) - MONTHS.indexOf(y.month))).forEach(r => {
  say('  ' + (r.billingNumber ? 'Billing #' + r.billingNumber : 'Unnumbered') + ' · ' + r.fundingType + ' · ' + r.month + ' ' + r.year
    + ' · ' + r.id + '  fund ' + P(r.baseCents) + '  charged ' + P(r.chargedCents)
    + (r.cover ? '  company-fronted ' + P(r.companyFrontedCents) : '  Fund balance ' + P(r.balanceCents)));
});
say('  Not charged to a billing period: ' + P(fb.notChargedCents) + ' (' + fb.notChargedRows.expenses + ' expense rows, '
  + fb.notChargedRows.overhead + ' overhead rows)');
say('Duplicate billing numbers: ' + (dups.length ? dups.map(PF.pfDuplicateText).join(' | ') : 'none'));
const untyped = payroll.filter(r => !['direct', 'indirect', 'liability'].includes(r.laborType));
say('Classified by name (payroll without labor_type): ' + untyped.length + ' rows, ' + P(untyped.reduce((s, r) => s + c(r.totalSalary), 0)));
say('Rows loaded: payroll ' + payroll.length + ', expenses ' + expenses.length + ' (' + expenses.filter(e => e.purchaseLineId).length
  + ' from purchases, ' + expenses.filter(e => e.stkCostMoveId).length + ' stock cost moves), overhead ' + overhead.length
  + ', billing periods ' + periods.length + ', BOQ documents ' + boqDocs.length);

// ── for information: how today differs from the frozen 14 Nov snapshot ──
const frozen = path.join(ROOT, 'tests', 'fixtures', 'sample-residence-2026-11-14.json');
if (fs.existsSync(frozen)) {
  const fx = JSON.parse(fs.readFileSync(frozen, 'utf8'));
  if (fx.folder.id === folderId) {
    const x = fx.expected;
    const now = { spentCents: fb.spentCents, boqEstimateCents: pv.boq.profitCents, operatingCents: rem.operatingCents,
      totalRemainingCents: rem.totalCents, notChargedCents: fb.notChargedCents, contractLessCostCents: pv.contractLessCost.cents };
    const diffs = Object.keys(now).filter(k => now[k] !== x[k]).map(k => k + ' ' + P(x[k]) + ' → ' + P(now[k]));
    say('');
    say('Versus the frozen 14 Nov snapshot (information only): ' + (diffs.length ? diffs.join('; ') : 'identical'));
  }
}

say('');
say(failures ? failures + ' CHECK(S) FAILED' : 'ALL CHECKS PASSED');
if (arg('--out')) fs.writeFileSync(arg('--out'), lines.join('\n') + '\n');
process.exit(failures ? 1 : 0);
