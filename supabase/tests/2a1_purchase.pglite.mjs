// ════════════════════════════════════════════════════════════════════
// STAGE 2A-1 PURCHASE RECORDING — BEHAVIOUR TESTS ON A LOCAL POSTGRES
//   npm run test:sql      (needs the dev dependency @electric-sql/pglite)
//
// Runs migration 0096 VERBATIM on PGlite (PostgreSQL 16 in memory) over a
// minimal copy of the tables it touches: folders, projects, project_budgets,
// expenses, payroll, profiles — with the real role helpers lifted from 0002
// and 0094. Nothing here talks to the live database. The live acceptance
// script (supabase/tests/2a1_acceptance.sql) repeats the key cases there.
// ════════════════════════════════════════════════════════════════════
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.DACS_ROOT || path.join(HERE, '..', '..');
const MIG = process.env.DACS_0096 || path.join(ROOT, 'supabase/migrations/0096_purchase_recording.sql');
const read = (p) => fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
// --with-0097: the same tests with 2A-2's migration applied on top — 0097
// must not change how a purchase is recorded, funded, corrected or voided.
// --with-0101: the same again with 2A-3a's 0101 on top of 0097.
// --with-0102: and 2A-4a's 0102 on top of those (payments must not change recording).
// --with-0104: and 2B-a's 0104 (stock) on top, switched OFF as before launch —
// the old tickbox and every purchase rule unchanged.
// --with-0105: and 2C's 0105 (cost moves) on top of 0104 — it redefines 0096's two guards.
// --with-0107: and 3a's 0107 (tools) on top of 0105, switched OFF — tools must not change
// how a purchase is recorded, corrected or voided.
const WITH_0107 = process.argv.includes('--with-0107');
const M107 = WITH_0107 ? read(path.join(ROOT, 'supabase/migrations/0107_tools.sql')) : '';
const WITH_0105 = process.argv.includes('--with-0105') || WITH_0107;
const WITH_0104 = process.argv.includes('--with-0104') || WITH_0105;
const WITH_0102 = process.argv.includes('--with-0102') || WITH_0104;
const M98 = WITH_0102 ? read(path.join(ROOT, 'supabase/migrations/0098_pm_profit_sharing.sql')) : '';
const M102 = WITH_0102 ? read(path.join(ROOT, 'supabase/migrations/0102_purchase_payments.sql')) : '';
const WITH_0101 = process.argv.includes('--with-0101') || WITH_0102;
const WITH_0097 = process.argv.includes('--with-0097') || WITH_0101;
const PR_MOD = WITH_0097 ? await import('./pr_base.mjs') : null;
const PR_BASE = WITH_0097 ? PR_MOD.prBase(ROOT) : '';
const M104 = WITH_0104 ? read(path.join(ROOT, 'supabase/migrations/0104_stock.sql')) : '';
const M105 = WITH_0105 ? read(path.join(ROOT, 'supabase/migrations/0105_stock_cost_moves.sql')) : '';
const M97 = WITH_0097 ? read(path.join(ROOT, 'supabase/migrations/0097_purchasing_office.sql')) : '';
const M101 = WITH_0101 ? read(path.join(ROOT, 'supabase/migrations/0101_purchasing_phone.sql')) : '';
const fnText = (src, name) => {
  const m = src.match(new RegExp('create or replace function ' + name + '\\s*\\([\\s\\S]*?\\n\\$\\$;', 'i'));
  if (!m) throw new Error('function ' + name + ' not found');
  return m[0];
};

const M02 = read(path.join(ROOT, 'supabase/migrations/0002_rls.sql'));
const M94 = read(path.join(ROOT, 'supabase/migrations/0094_workmate_work_plan_office.sql'));

const BASE = `
create role anon; create role authenticated;
create schema auth;
create function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
create table profiles (id uuid primary key, role text, owner_id uuid, status text, allowed_modules jsonb);
create table folders (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null, name text not null,
  parent_folder_id uuid references folders(id) on delete cascade, completed_at timestamptz,
  created_at timestamptz default now(), updated_at timestamptz default now());
create table projects (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null, folder_id uuid references folders(id) on delete cascade,
  month text, year int, funding_type text, billing_number int,
  created_at timestamptz default now(), updated_at timestamptz default now());
create table project_budgets (project_id uuid primary key references projects(id) on delete cascade, owner_id uuid not null,
  monthly_budget numeric not null default 0);
create table expenses (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null, project_id uuid references projects(id) on delete cascade,
  expense_name text, category text, quantity numeric, amount numeric, date_time text, notes text, payment_method text,
  po_image_url text, delivery_receipt_url text, supplier_invoice_url text, payment_receipt_url text,
  in_inventory boolean default false, cover_expense boolean default false,
  split_group text, split_index int, split_total int, client_submission_id uuid,
  created_at timestamptz default now(), updated_at timestamptz default now());
create table payroll (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null, project_id uuid references projects(id) on delete cascade,
  total_salary numeric, cover_expense boolean default false);
create table inventory (
  id uuid primary key default gen_random_uuid(), legacy_id text unique, owner_id uuid, item_name text, unit text,
  current_stock numeric, min_stock numeric, notes text, last_updated timestamptz, last_adjusted_by uuid,
  created_at timestamptz default now());
${fnText(M02, 'auth_role')}
${fnText(M02, 'is_owner')}
${fnText(M02, 'is_staff')}
${fnText(M02, 'data_owner_id')}
${fnText(M02, 'can_access')}
${fnText(M94, 'pr_is_office')}
`;

const OWNER = '00000000-0000-0000-0000-00000000000a';
const STAFF = '00000000-0000-0000-0000-00000000000b';
const WORKER = '00000000-0000-0000-0000-00000000000c';
const OTHER = '00000000-0000-0000-0000-00000000000d';
const PMONLY = '00000000-0000-0000-0000-00000000000e';
const EXPSTAFF = '00000000-0000-0000-0000-00000000000f';
let opSeq = 0;
const op = () => '10000000-0000-0000-0000-' + String(++opSeq).padStart(12, '0');

let passed = 0, failed = 0;
const failures = [];
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { failed++; failures.push(name + ' — ' + e.message); console.log('  FAIL ' + name + '\n       ' + e.message); }
}
function assert(c, m) { if (!c) throw new Error(m); }
function eq(a, b, m) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error((m || 'not equal') + ': ' + JSON.stringify(a) + ' !== ' + JSON.stringify(b)); }

// One fresh database per test: base schema + 0096 + the people.
async function fresh() {
  const db = new PGlite();
  await db.exec(BASE);
  await db.exec(read(MIG));
  if (WITH_0097) { await db.exec(PR_BASE); await db.exec(M97); }
  if (WITH_0101) { await db.exec(`create role service_role`); await db.exec(M101); }
  if (WITH_0102) { await db.exec(fnText(M98, 'pm_main_owner_id')); await db.exec(M102); }
  if (WITH_0104) { await db.exec(PR_MOD.CATALOG_0085); await db.exec(M104); if (WITH_0105) await db.exec(M105); if (WITH_0107) await db.exec(M107); }
  await db.exec(`insert into profiles values
    ('${OWNER}', 'owner', null, 'active', null), ('${STAFF}', 'staff', '${OWNER}', 'active', null),
    ('${WORKER}', 'worker', '${OWNER}', 'active', null), ('${OTHER}', 'owner', null, 'active', null),
    ('${PMONLY}', 'staff', '${OWNER}', 'active', '["pm"]'::jsonb),
    ('${EXPSTAFF}', 'staff', '${OWNER}', 'active', '["pm", "expenses"]'::jsonb);`);
  return db;
}
async function as(db, uid) { await db.exec(`select set_config('test.uid', '${uid}', false)`); }
async function one(db, sql, params = []) { return (await db.query(sql, params)).rows[0]; }
async function all(db, sql, params = []) { return (await db.query(sql, params)).rows; }
const num = (x) => Number(x);

async function folder(db, name, opts = {}) {
  return (await one(db, `insert into folders (owner_id, name, parent_folder_id, completed_at) values ($1, $2, $3, $4) returning id`,
    [opts.owner || OWNER, name, opts.parent || null, opts.completed ? new Date().toISOString() : null])).id;
}
async function period(db, folderId, month, year, opts = {}) {
  const id = (await one(db, `insert into projects (owner_id, folder_id, month, year, funding_type, billing_number, created_at)
                              values ($1, $2, $3, $4, $5, $6, $7) returning id`,
    [opts.owner || OWNER, folderId, month, year, opts.president ? 'president' : 'progress',
     opts.billing ?? null, opts.created || new Date(Date.now() + (opts.order || 0) * 1000).toISOString()])).id;
  if (opts.budget != null) await db.query(`insert into project_budgets values ($1, $2, $3)`, [id, opts.budgetOwner || opts.owner || OWNER, opts.budget]);
  return id;
}
async function spend(db, periodId, amount) {
  await db.query(`insert into expenses (owner_id, project_id, expense_name, amount) values ($1, $2, 'earlier', $3)`, [OWNER, periodId, amount]);
}
function body(lines, extra = {}) {
  const total = extra.receipt_total ?? lines.reduce((s, l) => s + l.amount, 0)
    + (extra.charges || []).reduce((s, c) => s + (c.kind === 'delivery_fee' ? c.amount : -c.amount), 0);
  return { source: 'expenses_form', purchase_date: '2026-10-14', date_time: '2026-10-14T09:30', supplier: 'Wilcon',
           notes: '', payment_method: 'CASH', docs: {}, ...extra, receipt_total: Math.round(total * 100) / 100,
           lines: lines.map(l => ({ destination: 'project', category: 'Materials', quantity: 1, ...l })) };
}
async function record(db, b, opId = op()) {
  return (await one(db, `select pur_record($1, $2::jsonb) as r`, [opId, JSON.stringify(b)])).r;
}
async function rows(db, periodId) {
  return (await all(db, `select amount, cover_expense, expense_name from expenses where project_id = $1 and purchase_line_id is not null order by split_index nulls first`, [periodId]))
    .map(r => ({ amount: num(r.amount), cover: r.cover_expense, name: r.expense_name }));
}
async function code(promise) {
  try { await promise; return 'no error'; } catch (e) { return e.message; }
}

console.log('\n2A-1 purchase recording (0096' + (WITH_0097 ? ' + 0097' : '') + (WITH_0101 ? ' + 0101' : '') + (WITH_0102 ? ' + 0102' : '') + (WITH_0104 ? ' + 0104 (stock off)' : '') + (WITH_0105 ? ' + 0105' : '') + ' on PGlite)');

await test('§3.3 example: ₱8,000 on 14 Oct → ₱3,000 + ₱4,000 + ₱1,000 Cover (earliest billing number first)', async () => {
  const db = await fresh(); await as(db, OWNER);
  const f = await folder(db, 'Barlin');
  const p1 = await period(db, f, 'October', 2026, { billing: 1, budget: 5000 });
  const p2 = await period(db, f, 'October', 2026, { billing: 2, budget: 4000 });
  const cover = await period(db, f, 'October', 2026, { president: true });
  await spend(db, p1, 2000);
  const r = await record(db, body([{ folder_id: f, item_name: 'Cement', amount: 8000 }]));
  eq(await rows(db, p1), [{ amount: 3000, cover: false, name: 'Cement (1/3)' }]);
  eq(await rows(db, p2), [{ amount: 4000, cover: false, name: 'Cement (2/3)' }]);
  eq(await rows(db, cover), [{ amount: 1000, cover: true, name: 'Cement (3/3)' }]);
  eq(r.needs_review, []);
  const total = await one(db, `select sum(amount) s from expenses where purchase_line_id is not null`);
  eq(num(total.s), 8000, 'Spent counts the purchase once; Cover is part of it');
});

await test('earliest billing number wins even when a later period has less left (not "lowest remaining first")', async () => {
  const db = await fresh(); await as(db, OWNER);
  const f = await folder(db, 'A');
  const p2 = await period(db, f, 'October', 2026, { billing: 2, budget: 1000, order: 1 });
  const p1 = await period(db, f, 'October', 2026, { billing: 1, budget: 9000, order: 2 });
  await record(db, body([{ folder_id: f, item_name: 'Sand', amount: 500 }]));
  eq(await rows(db, p1), [{ amount: 500, cover: false, name: 'Sand' }]);
  eq(await rows(db, p2), []);
});

await test('never another month: September money is not used for an October purchase', async () => {
  const db = await fresh(); await as(db, OWNER);
  const f = await folder(db, 'A');
  const sep = await period(db, f, 'September', 2026, { billing: 1, budget: 50000 });
  const oct = await period(db, f, 'October', 2026, { billing: 2, budget: 100 });
  await record(db, body([{ folder_id: f, item_name: 'Paint', amount: 300 }]));
  eq(await rows(db, sep), []);
  eq(await rows(db, oct), [{ amount: 100, cover: false, name: 'Paint (1/2)' }, { amount: 200, cover: true, name: 'Paint (2/2)' }],
     'no Cover period → the shortage sits on the same-month client period, flagged cover');
});

await test('Q23: no period that month → all Cover on the latest Cover period, flagged for office review', async () => {
  const db = await fresh(); await as(db, OWNER);
  const f = await folder(db, 'A');
  await period(db, f, 'August', 2026, { billing: 1, budget: 10000 });
  const septCover = await period(db, f, 'September', 2026, { president: true });
  const r = await record(db, body([{ folder_id: f, item_name: 'Tiles', amount: 2500 }]));
  eq(await rows(db, septCover), [{ amount: 2500, cover: true, name: 'Tiles' }]);
  eq(r.needs_review, [1]);
  eq((await one(db, `select needs_funding_review v from purchase_lines`)).v, true);
});

await test("Q23 without any Cover period → tied to the project, flagged cover — never another month's client period", async () => {
  const db = await fresh(); await as(db, OWNER);
  const f = await folder(db, 'A');
  const aug = await period(db, f, 'August', 2026, { billing: 1, budget: 10000 });
  const sept = await period(db, f, 'September', 2026, { billing: 2, budget: 10000 });
  const r = await record(db, body([{ folder_id: f, item_name: 'Tiles', amount: 100 }]));
  eq(await rows(db, sept), [], "September's client period is not used");
  eq(await rows(db, aug), [], "August's client period is not used");
  const e = await all(db, `select project_id, folder_id, cover_expense, amount from expenses where purchase_line_id is not null`);
  eq(e.map(x => [x.project_id, x.folder_id, x.cover_expense, num(x.amount)]), [[null, f, true, 100]]);
  eq(r.needs_review, [1]);
});

await test("a Cover row never sits on another month's client period: a December purchase leaves October's money alone", async () => {
  const db = await fresh(); await as(db, OWNER);
  const f = await folder(db, 'A');
  const oct = await period(db, f, 'October', 2026, { billing: 1, budget: 1000 });
  const dec = { purchase_date: '2026-12-02', date_time: '2026-12-02T09:00' };
  const r = await record(db, body([{ folder_id: f, item_name: 'Dec item', amount: 300 }], dec));
  const e = await all(db, `select project_id, folder_id, cover_expense, amount from expenses where purchase_line_id is not null`);
  eq(e.map(x => [x.project_id, x.folder_id, x.cover_expense, num(x.amount)]), [[null, f, true, 300]],
     'ONE Cover row tied to the project (no Cover period, no December period)');
  eq((await one(db, `select needs_funding_review v from purchase_lines`)).v, true, 'flagged for office review');
  eq(r.needs_review, [1]);
  eq(num((await one(db, `select pur_period_remaining($1) n`, [oct])).n), 1000, 'October still has all its ₱1,000');
  await record(db, body([{ folder_id: f, item_name: 'Oct item', amount: 1000 }], { purchase_date: '2026-10-20', date_time: '2026-10-20T09:00' }));
  eq(await rows(db, oct), [{ amount: 1000, cover: false, name: 'Oct item' }], 'the October purchase is funded ₱1,000 from October, no Cover');
  eq(num((await one(db, `select coalesce(sum(amount), 0) s from expenses where cover_expense`)).s), 300, 'Cover = only the December ₱300 fronted');
});

await test('…but with a Cover (president) period in November, a December shortage still goes to that Cover period', async () => {
  const db = await fresh(); await as(db, OWNER);
  const f = await folder(db, 'A');
  const oct = await period(db, f, 'October', 2026, { billing: 1, budget: 1000 });
  const novCover = await period(db, f, 'November', 2026, { president: true });
  const r = await record(db, body([{ folder_id: f, item_name: 'Dec item', amount: 300 }], { purchase_date: '2026-12-02', date_time: '2026-12-02T09:00' }));
  eq(await rows(db, novCover), [{ amount: 300, cover: true, name: 'Dec item' }], 'parked on the Cover period (it carries no client budget)');
  eq(await rows(db, oct), []);
  eq(num((await one(db, `select count(*) n from expenses where folder_id is not null`)).n), 0, 'not tied to the project');
  eq(r.needs_review, [1]);
  eq(num((await one(db, `select pur_period_remaining($1) n`, [oct])).n), 1000, 'October untouched');
});

await test('a period with no budget, and Cover periods, are never funding sources', async () => {
  const db = await fresh(); await as(db, OWNER);
  const f = await folder(db, 'A');
  const zero = await period(db, f, 'October', 2026, { billing: 1, budget: 0 });
  const r = await record(db, body([{ folder_id: f, item_name: 'Wire', amount: 50 }]));
  eq(await rows(db, zero), [{ amount: 50, cover: true, name: 'Wire' }]);
  eq(r.needs_review, [1], 'only a zero-budget period that month counts as no eligible period');
});

await test('remaining = budget − expenses − payroll (exactly as Dacs Web)', async () => {
  const db = await fresh(); await as(db, OWNER);
  const f = await folder(db, 'A');
  const p1 = await period(db, f, 'October', 2026, { billing: 1, budget: 10000 });
  await spend(db, p1, 1000);
  await db.query(`insert into payroll (owner_id, project_id, total_salary) values ($1, $2, 8500)`, [OWNER, p1]);
  await record(db, body([{ folder_id: f, item_name: 'Nails', amount: 700 }]));
  eq(await rows(db, p1), [{ amount: 500, cover: false, name: 'Nails (1/2)' }, { amount: 200, cover: true, name: 'Nails (2/2)' }]);
});

await test('Q24: Additional Works → its own period in full, no cap, never Cover', async () => {
  const db = await fresh(); await as(db, OWNER);
  const main = await folder(db, 'Main');
  await period(db, main, 'October', 2026, { billing: 1, budget: 999999 });
  const aw = await folder(db, 'Gazebo', { parent: main });
  const awp = await period(db, aw, 'September', 2026, {});
  await record(db, body([{ folder_id: aw, item_name: 'Lumber', amount: 22000 }]));
  eq(await rows(db, awp), [{ amount: 22000, cover: false, name: 'Lumber' }]);
  eq((await one(db, `select count(*) n from expenses e join projects p on p.id = e.project_id where p.folder_id = $1`, [main])).n, 0, 'parent Main Contract untouched');
});

await test('two lines on one project: the second sees what the first used', async () => {
  const db = await fresh(); await as(db, OWNER);
  const f = await folder(db, 'A');
  const p1 = await period(db, f, 'October', 2026, { billing: 1, budget: 1000 });
  await record(db, body([{ folder_id: f, item_name: 'A', amount: 800 }, { folder_id: f, item_name: 'B', amount: 500 }]));
  const r = await all(db, `select l.line_no, e.amount, e.cover_expense from expenses e join purchase_lines l on l.id = e.purchase_line_id order by l.line_no, e.cover_expense`);
  eq(r.map(x => [x.line_no, num(x.amount), x.cover_expense]), [[1, 800, false], [2, 200, false], [2, 300, true]]);
});

await test('Q4: ₱200 delivery fee over ₱3,000 (A) + ₱1,000 (B) → A ₱150, B ₱50 "Delivery fee (share)" rows', async () => {
  const db = await fresh(); await as(db, OWNER);
  const a = await folder(db, 'A'), b = await folder(db, 'B');
  const pa = await period(db, a, 'October', 2026, { billing: 1, budget: 100000 });
  const pb = await period(db, b, 'October', 2026, { billing: 1, budget: 100000 });
  await record(db, body([{ folder_id: a, item_name: 'Pipe', amount: 3000 }, { folder_id: b, item_name: 'Pipe', amount: 1000 }],
                        { charges: [{ kind: 'delivery_fee', amount: 200 }] }));
  const fees = await all(db, `select project_id, amount, expense_name from expenses where purchase_charge_id is not null order by amount desc`);
  eq(fees.map(x => [x.project_id, num(x.amount), x.expense_name]), [[pa, 150, 'Delivery fee (share)'], [pb, 50, 'Delivery fee (share)']]);
});

await test('rounding: a ₱100 fee over three equal lines → 33.34 + 33.33 + 33.33 (remainder to the largest, first on a tie)', async () => {
  const db = await fresh(); await as(db, OWNER);
  const a = await folder(db, 'A'), b = await folder(db, 'B'), c = await folder(db, 'C');
  for (const f of [a, b, c]) await period(db, f, 'October', 2026, { billing: 1, budget: 100000 });
  await record(db, body([{ folder_id: a, item_name: 'x', amount: 10 }, { folder_id: b, item_name: 'x', amount: 10 }, { folder_id: c, item_name: 'x', amount: 10 }],
                        { charges: [{ kind: 'delivery_fee', amount: 100 }] }));
  const s = await all(db, `select s.amount from purchase_charge_shares s join purchase_lines l on l.id = s.line_id order by l.line_no`);
  eq(s.map(x => num(x.amount)), [33.34, 33.33, 33.33]);
});

await test('given shares must add up to the charge; a fee on a warehouse line writes no row', async () => {
  const db = await fresh(); await as(db, OWNER);
  const a = await folder(db, 'A');
  await period(db, a, 'October', 2026, { billing: 1, budget: 100000 });
  const bad = body([{ folder_id: a, item_name: 'x', amount: 100 }], { charges: [{ kind: 'delivery_fee', amount: 20, shares: [{ line: 1, amount: 19 }] }] });
  assert((await code(record(db, bad))).includes('SPLIT_MISMATCH'), 'shares ≠ charge must be refused');
  const ok = body([{ folder_id: a, item_name: 'x', amount: 100 }, { destination: 'warehouse', item_name: 'stock', amount: 100 }],
                  { charges: [{ kind: 'delivery_fee', amount: 20, shares: [{ line: 1, amount: 5 }, { line: 2, amount: 15 }] }] });
  await record(db, ok);
  eq((await all(db, `select amount from expenses where purchase_charge_id is not null`)).map(x => num(x.amount)), [5]);
  eq(num((await one(db, `select count(*) n from expenses where purchase_line_id is not null`)).n), 1, 'the warehouse line writes no expense row');
});

await test('discount reduces the line before funding; never a negative row; totals must match', async () => {
  const db = await fresh(); await as(db, OWNER);
  const a = await folder(db, 'A');
  const p = await period(db, a, 'October', 2026, { billing: 1, budget: 100000 });
  await record(db, body([{ folder_id: a, item_name: 'Rebar', amount: 1000 }], { charges: [{ kind: 'discount', amount: 100 }] }));
  eq(await rows(db, p), [{ amount: 900, cover: false, name: 'Rebar' }]);
  eq(num((await one(db, `select count(*) n from expenses where amount < 0`)).n), 0);
  const tooBig = body([{ folder_id: a, item_name: 'x', amount: 50 }, { folder_id: a, item_name: 'y', amount: 500 }],
                      { charges: [{ kind: 'discount', amount: 60, shares: [{ line: 1, amount: 60 }] }] });
  assert((await code(record(db, tooBig))).includes('DISCOUNT_TOO_LARGE'), 'a discount above its line must be refused');
  const mismatch = body([{ folder_id: a, item_name: 'x', amount: 50 }], { receipt_total: 51 });
  assert((await code(record(db, mismatch))).includes('TOTAL_MISMATCH'), 'lines + fees − discounts must equal the receipt');
});

await test('a retry with the same operation id records once and returns the first answer', async () => {
  const db = await fresh(); await as(db, OWNER);
  const a = await folder(db, 'A');
  await period(db, a, 'October', 2026, { billing: 1, budget: 100000 });
  const id = op();
  const r1 = await record(db, body([{ folder_id: a, item_name: 'x', amount: 10 }]), id);
  const r2 = await record(db, body([{ folder_id: a, item_name: 'CHANGED', amount: 99 }]), id);
  eq(r2.replayed, true, 'the replay is marked, so the form can say the edits were not saved');
  eq(r1.replayed, undefined, 'the first answer is not marked');
  const { replayed, ...firstAnswer } = r2;
  eq(firstAnswer, r1, 'otherwise it is the first answer');
  eq(num((await one(db, `select count(*) n from purchases`)).n), 1);
  eq(num((await one(db, `select sum(amount) s from expenses`)).s), 10);
});

await test('staff are funded from budgets they cannot see (not everything Cover)', async () => {
  const db = await fresh(); await as(db, STAFF);
  const a = await folder(db, 'A');
  const p = await period(db, a, 'October', 2026, { billing: 1, budget: 1000 });
  await record(db, body([{ folder_id: a, item_name: 'x', amount: 400 }]));
  eq(await rows(db, p), [{ amount: 400, cover: false, name: 'x' }]);
  eq((await one(db, `select recorded_by, owner_id from purchases`)), { recorded_by: STAFF, owner_id: OWNER });
});

await test('only office accounts record; another owner\'s project is refused; the actual date must match date_time', async () => {
  const db = await fresh();
  const a = await folder(db, 'A');
  await period(db, a, 'October', 2026, { billing: 1, budget: 1000 });
  await as(db, WORKER);
  assert((await code(record(db, body([{ folder_id: a, item_name: 'x', amount: 1 }])))).includes('NOT_OFFICE'), 'worker must be refused');
  await as(db, OTHER);
  assert((await code(record(db, body([{ folder_id: a, item_name: 'x', amount: 1 }])))).includes('BAD_PROJECT'), 'other owner must be refused');
  await as(db, OWNER);
  assert((await code(record(db, body([{ folder_id: a, item_name: 'x', amount: 1 }], { date_time: '2026-11-02T08:00' })))).includes('BAD_DATE'), 'date mismatch must be refused');
  assert((await code(record(db, body([{ folder_id: a, item_name: 'x', amount: 1.005 }])))).includes('BAD_AMOUNT'), 'sub-centavo amount must be refused');
  assert((await code(record(db, body([{ folder_id: a, item_name: 'x', amount: -1 }], { receipt_total: 0 })))).includes('BAD_AMOUNT'), 'negative amount must be refused');
});

await test('month names: "Oct", "10" and " october " all match October', async () => {
  for (const m of ['Oct', '10', ' october ']) {
    const db = await fresh(); await as(db, OWNER);
    const a = await folder(db, 'A');
    const p = await period(db, a, m, 2026, { billing: 1, budget: 1000 });
    await record(db, body([{ folder_id: a, item_name: 'x', amount: 10 }]));
    eq(await rows(db, p), [{ amount: 10, cover: false, name: 'x' }], 'month ' + JSON.stringify(m));
  }
});

await test('completed project: staff refused, owner allowed (completed is the only lock)', async () => {
  const db = await fresh();
  const a = await folder(db, 'A', { completed: true });
  await period(db, a, 'October', 2026, { billing: 1, budget: 1000 });
  await as(db, STAFF);
  assert((await code(record(db, body([{ folder_id: a, item_name: 'x', amount: 1 }])))).includes('COMPLETED_PROJECT'), 'staff must be refused');
  await as(db, OWNER);
  await record(db, body([{ folder_id: a, item_name: 'x', amount: 1 }]));
});

await test('completed project: an Additional Works job under it is locked too — staff refused, owner allowed', async () => {
  const db = await fresh();
  const main = await folder(db, 'Main', { completed: true });
  const aw = await folder(db, 'Gazebo', { parent: main });
  await period(db, aw, 'October', 2026, { billing: 1 });
  await as(db, STAFF);
  assert((await code(record(db, body([{ folder_id: aw, item_name: 'x', amount: 1 }])))).includes('COMPLETED_PROJECT'),
         'staff must be refused on an AW job of a completed project');
  await as(db, OWNER);
  const r = await record(db, body([{ folder_id: aw, item_name: 'x', amount: 1 }]));
  await as(db, STAFF);
  assert((await code(one(db, `select pur_void($1, $2, 'fix') r`, [op(), r.purchase_id]))).includes('COMPLETED_PROJECT'),
         'staff must be refused a void on it too (pur_open)');
  await as(db, OWNER);
  await one(db, `select pur_void($1, $2, 'fix') r`, [op(), r.purchase_id]);
});

await test('purchase rows change only through the purchase; ordinary rows are untouched', async () => {
  const db = await fresh(); await as(db, OWNER);
  const a = await folder(db, 'A');
  const p = await period(db, a, 'October', 2026, { billing: 1, budget: 1000 });
  await spend(db, p, 5);
  await record(db, body([{ folder_id: a, item_name: 'x', amount: 10 }]));
  assert((await code(db.query(`update expenses set amount = 1 where purchase_line_id is not null`))).includes('PURCHASE_ROW'), 'update must be refused');
  assert((await code(db.query(`delete from expenses where purchase_line_id is not null`))).includes('PURCHASE_ROW'), 'delete must be refused');
  const line = (await one(db, `select id from purchase_lines`)).id;
  assert((await code(db.query(`insert into expenses (owner_id, project_id, amount, purchase_line_id) values ($1, $2, 1, $3)`, [OWNER, p, line]))).includes('PURCHASE_ROW'), 'insert must be refused');
  await db.query(`update expenses set amount = 6 where purchase_line_id is null`);
  await db.query(`delete from expenses where purchase_line_id is null`);
});

await test('correction: Spent changes by exactly the difference; history keeps before and after', async () => {
  const db = await fresh(); await as(db, OWNER);
  const a = await folder(db, 'A');
  const p1 = await period(db, a, 'October', 2026, { billing: 1, budget: 5000 });
  const cover = await period(db, a, 'October', 2026, { president: true });
  const r = await record(db, body([{ folder_id: a, item_name: 'Cement', amount: 4000 }]));
  const before = num((await one(db, `select sum(amount) s from expenses`)).s);
  await one(db, `select pur_correct($1, $2, $3::jsonb, 'wrong amount') r`, [op(), r.purchase_id, JSON.stringify(body([{ folder_id: a, item_name: 'Cement', amount: 6000 }]))]);
  eq(num((await one(db, `select sum(amount) s from expenses`)).s) - before, 2000);
  eq(await rows(db, p1), [{ amount: 5000, cover: false, name: 'Cement (1/2)' }]);
  eq(await rows(db, cover), [{ amount: 1000, cover: true, name: 'Cement (2/2)' }]);
  const h = await all(db, `select kind, reason, before->'lines'->0->>'amount' b, after->'lines'->0->>'amount' a from purchase_history order by id`);
  eq(h.map(x => [x.kind, x.reason, x.b, x.a]), [['recorded', '', null, '4000.00'], ['corrected', 'wrong amount', '4000.00', '6000.00']]);
});

await test('correction rules: a reason is required, lines cannot be added, staff cannot move a line to another project', async () => {
  const db = await fresh(); await as(db, STAFF);
  const a = await folder(db, 'A'), b = await folder(db, 'B');
  await period(db, a, 'October', 2026, { billing: 1, budget: 5000 });
  await period(db, b, 'October', 2026, { billing: 1, budget: 5000 });
  const r = await record(db, body([{ folder_id: a, item_name: 'x', amount: 10 }]));
  const corr = (bd, reason = 'fix') => one(db, `select pur_correct($1, $2, $3::jsonb, $4) r`, [op(), r.purchase_id, JSON.stringify(bd), reason]);
  assert((await code(corr(body([{ folder_id: a, item_name: 'x', amount: 11 }]), ' '))).includes('REASON_REQUIRED'), 'reason');
  assert((await code(corr(body([{ folder_id: a, item_name: 'x', amount: 5 }, { folder_id: a, item_name: 'y', amount: 5 }])))).includes('LINES_CHANGED'), 'lines');
  assert((await code(corr(body([{ folder_id: b, item_name: 'x', amount: 10 }])))).includes('OWNER_APPROVAL_NEEDED'), 'move');
  await as(db, OWNER);
  await corr(body([{ folder_id: b, item_name: 'x', amount: 10 }]));
  eq(num((await one(db, `select count(*) n from expenses e join projects p on p.id = e.project_id where p.folder_id = $1`, [b])).n), 1, 'owner may move it');
});

await test('void: rows leave Spent; purchase, receipt and history stay; a second void is refused', async () => {
  const db = await fresh(); await as(db, OWNER);
  const a = await folder(db, 'A');
  await period(db, a, 'October', 2026, { billing: 1, budget: 5000 });
  const r = await record(db, body([{ folder_id: a, item_name: 'x', amount: 10 }], { docs: { supplier_invoice_url: 'https://x/si.jpg', evil: 'nope' } }));
  eq((await one(db, `select supplier_invoice_url u from expenses`)).u, 'https://x/si.jpg', 'receipt on the first row');
  await one(db, `select pur_void($1, $2, 'duplicate entry') r`, [op(), r.purchase_id]);
  eq(num((await one(db, `select count(*) n from expenses`)).n), 0);
  eq(await one(db, `select status, docs from purchases`), { status: 'void', docs: { supplier_invoice_url: 'https://x/si.jpg' } });
  eq((await all(db, `select kind from purchase_history order by id`)).map(x => x.kind), ['recorded', 'voided']);
  assert((await code(one(db, `select pur_void($1, $2, 'again') r`, [op(), r.purchase_id]))).includes('BAD_STATE'), 'second void');
});

await test('a correction recomputes against the CURRENT remaining fund (its own old rows released first)', async () => {
  const db = await fresh(); await as(db, OWNER);
  const a = await folder(db, 'A');
  const p1 = await period(db, a, 'October', 2026, { billing: 1, budget: 1000 });
  const r = await record(db, body([{ folder_id: a, item_name: 'x', amount: 1000 }]));
  await one(db, `select pur_correct($1, $2, $3::jsonb, 'typo') r`, [op(), r.purchase_id, JSON.stringify(body([{ folder_id: a, item_name: 'x', amount: 900 }]))]);
  eq(await rows(db, p1), [{ amount: 900, cover: false, name: 'x' }], 'not pushed to Cover by its own earlier rows');
});

await test('NO billing period at all: kept, counted at once as Cover tied to the project, flagged — no period invented', async () => {
  const db = await fresh(); await as(db, OWNER);
  const f = await folder(db, 'Empty');
  const r = await record(db, body([{ folder_id: f, item_name: 'Rebar', amount: 1500 }]));
  eq(r.needs_review, [1]);
  eq(r.rows.map(x => [x.period_id, num(x.amount), x.cover]), [[null, 1500, true]]);
  const e = await one(db, `select project_id, folder_id, cover_expense, amount from expenses where purchase_line_id is not null`);
  eq([e.project_id, e.folder_id, e.cover_expense, num(e.amount)], [null, f, true, 1500]);
  eq(num((await one(db, `select count(*) n from projects`)).n), 0, 'no period was invented');
});

await test('re-fund after the office adds a period: same purchase date, same total, moved once, review cleared', async () => {
  const db = await fresh(); await as(db, OWNER);
  const f = await folder(db, 'Empty');
  const r = await record(db, body([{ folder_id: f, item_name: 'Rebar', amount: 1500 }]));
  const p = await period(db, f, 'October', 2026, { billing: 1, budget: 1000 });
  const cover = await period(db, f, 'October', 2026, { president: true });
  const rr = (await one(db, `select pur_refund($1, $2, 'billing period added') r`, [op(), r.purchase_id])).r;
  eq(rr.needs_review, []);
  eq(await rows(db, p), [{ amount: 1000, cover: false, name: 'Rebar (1/2)' }]);
  eq(await rows(db, cover), [{ amount: 500, cover: true, name: 'Rebar (2/2)' }]);
  eq(num((await one(db, `select sum(amount) s from expenses`)).s), 1500, 'total Spent unchanged');
  eq(num((await one(db, `select count(*) n from expenses where folder_id is not null`)).n), 0, 'the no-period row is gone');
  eq((await one(db, `select purchase_date::text d from purchases`)).d, '2026-10-14');
  eq((await all(db, `select kind from purchase_history order by id`)).map(x => x.kind), ['recorded', 'refunded']);
  assert((await code(one(db, `select pur_refund($1, $2, ' ') r`, [op(), r.purchase_id]))).includes('REASON_REQUIRED'), 'reason');
});

await test("links stay inside the company and project: another owner's period, budget or Cover period is never used", async () => {
  const db = await fresh(); await as(db, OWNER);
  const f = await folder(db, 'A');
  // Wrong company on the period, on its budget, or on both — and a foreign Cover period.
  const foreignBoth = await period(db, f, 'October', 2026, { billing: 1, budget: 99999, owner: OTHER });
  const foreignPeriod = await period(db, f, 'October', 2026, { billing: 1, budget: 99999, owner: OTHER, budgetOwner: OWNER });
  // Our own period with a foreign budget row: never a funding source (billing #3, after ours, so Cover never lands on it either).
  const foreignBudget = await period(db, f, 'October', 2026, { billing: 3, budget: 99999, budgetOwner: OTHER });
  const foreignCover = await period(db, f, 'October', 2026, { president: true, owner: OTHER });
  const mine = await period(db, f, 'October', 2026, { billing: 2, budget: 100 });
  await record(db, body([{ folder_id: f, item_name: 'x', amount: 150 }]));
  for (const p of [foreignBoth, foreignPeriod, foreignBudget, foreignCover]) eq(await rows(db, p), [], 'a foreign period was used');
  eq(await rows(db, mine), [{ amount: 100, cover: false, name: 'x (1/2)' }, { amount: 50, cover: true, name: 'x (2/2)' }]);
});

await test('small fees never overcharge: ₱0.03 over five equal lines → exactly ₱0.03, no negative share', async () => {
  const db = await fresh(); await as(db, OWNER);
  const f = await folder(db, 'A');
  await period(db, f, 'October', 2026, { billing: 1, budget: 100000 });
  const lines = [1, 2, 3, 4, 5].map(i => ({ folder_id: f, item_name: 'x' + i, amount: 10 }));
  await record(db, body(lines, { charges: [{ kind: 'delivery_fee', amount: 0.03 }] }));
  const sh = (await all(db, `select s.amount from purchase_charge_shares s join purchase_lines l on l.id = s.line_id order by l.line_no`)).map(x => num(x.amount));
  eq(sh, [0.01, 0.01, 0.01]);
  eq(num((await one(db, `select sum(amount) s from expenses where purchase_charge_id is not null`)).s), 0.03);
  const p7 = (await one(db, `select pur_prorate(1, array[1,1,1,1,1,1,1]::numeric[]) s`)).s.map(Number);
  eq(p7, [0.15, 0.15, 0.14, 0.14, 0.14, 0.14, 0.14], '₱1 over 7: one leftover centavo each, earliest first');
  const p3 = (await one(db, `select pur_prorate(0.05, array[1,1,1]::numeric[]) s`)).s.map(Number);
  eq(p3, [0.02, 0.02, 0.01]);
});

await test('Expenses access only: a PM-focused account is refused; phone purchasing needs the Buyer switch', async () => {
  const db = await fresh();
  const f = await folder(db, 'A');
  await period(db, f, 'October', 2026, { billing: 1, budget: 100 });
  await as(db, PMONLY);
  assert((await code(record(db, body([{ folder_id: f, item_name: 'x', amount: 1 }])))).includes('NOT_ALLOWED'), 'PM-only refused');
  await as(db, EXPSTAFF);
  await record(db, body([{ folder_id: f, item_name: 'x', amount: 1 }]));
  // A staff account allowed Expenses but without the Buyer switch (2A-2).
  assert((await code(record(db, body([{ folder_id: f, item_name: 'x', amount: 1 }], { source: 'workmate' })))).includes('BUYER_REQUIRED'), 'workmate refused');
});

await test('stock: added inside the purchase, once per line — retries, corrections and a repeat call add nothing', async () => {
  const db = await fresh(); await as(db, OWNER);
  const f = await folder(db, 'A');
  await period(db, f, 'October', 2026, { billing: 1, budget: 100000 });
  await db.query(`insert into inventory (item_name, unit, current_stock, min_stock) values ('Cement', 'bag', 5, 0)`);
  const id = op();
  const lines = (cement) => [{ folder_id: f, item_name: 'Cement', amount: cement, quantity: 10, in_inventory: true },
                             { folder_id: f, item_name: 'New Pipe', amount: 50, quantity: 3, unit: 'pc', in_inventory: true, min_stock: 2 }];
  const r1 = await record(db, body(lines(100)), id);
  eq(r1.stock_moves, 2);
  const r2 = await record(db, body(lines(100)), id);
  eq(r2.replayed, true, 'a retry is marked replayed');
  const { replayed, ...firstAnswer } = r2;
  eq(firstAnswer, r1, 'a retry returns the first answer');
  const inv = async () => (await all(db, `select item_name, current_stock, min_stock, unit from inventory order by item_name`))
    .map(x => [x.item_name, num(x.current_stock), num(x.min_stock), x.unit]);
  eq(await inv(), [['Cement', 15, 0, 'bag'], ['New Pipe', 3, 2, 'pc']]);
  await one(db, `select pur_correct($1, $2, $3::jsonb, 'fix price') r`, [op(), r1.purchase_id, JSON.stringify(body(lines(120)))]);
  eq(await inv(), [['Cement', 15, 0, 'bag'], ['New Pipe', 3, 2, 'pc']], 'a correction moves no stock');
  eq(num((await one(db, `select pur_move_stock($1, $2) n`, [r1.purchase_id, OWNER])).n), 0, 'a repeat stock call moves nothing');
  eq(await inv(), [['Cement', 15, 0, 'bag'], ['New Pipe', 3, 2, 'pc']]);
  eq(num((await one(db, `select count(*) n from purchase_stock_moves`)).n), 2);
});

await test('deleting: refused while a purchase is live; after voiding, the project deletes and its history stays readable', async () => {
  const db = await fresh(); await as(db, OWNER);
  const f = await folder(db, 'ZZ delete me');
  await period(db, f, 'October', 2026, { billing: 1, budget: 100 });
  const r1 = await record(db, body([{ folder_id: f, item_name: 'x', amount: 10 }]));
  const g = await folder(db, 'ZZ no period');
  const r2 = await record(db, body([{ folder_id: g, item_name: 'y', amount: 20 }]));
  assert((await code(db.query(`delete from folders where id = $1`, [f]))).includes('PURCHASES_LIVE'), 'a live purchase blocks the delete');
  assert((await code(db.query(`delete from folders where id = $1`, [g]))).includes('PURCHASES_LIVE'), 'a live no-period purchase blocks it too');
  await one(db, `select pur_void($1, $2, 'test') r`, [op(), r1.purchase_id]);
  await one(db, `select pur_void($1, $2, 'test') r`, [op(), r2.purchase_id]);
  await db.query(`delete from folders where id = $1`, [f]);
  await db.query(`delete from folders where id = $1`, [g]);
  eq((await all(db, `select folder_name from purchase_lines order by folder_name`)).map(x => x.folder_name), ['ZZ delete me', 'ZZ no period']);
});

await test('a project-level row cannot be written outside the purchase functions', async () => {
  const db = await fresh(); await as(db, OWNER);
  const f = await folder(db, 'A');
  assert((await code(db.query(`insert into expenses (owner_id, folder_id, amount) values ($1, $2, 5)`, [OWNER, f]))).includes('PURCHASE_ROW'), 'insert refused');
});

await test('deleting is refused BEFORE anything is removed — a fully discounted purchase (no expense rows) counts too; the pre-check says so', async () => {
  const db = await fresh(); await as(db, OWNER);
  const f = await folder(db, 'ZZ discounted');
  const p = await period(db, f, 'October', 2026, { billing: 1, budget: 100 });
  await spend(db, p, 5);
  const r = await record(db, body([{ folder_id: f, item_name: 'free sample', amount: 10 }], { charges: [{ kind: 'discount', amount: 10 }] }));
  eq(num((await one(db, `select count(*) n from expenses where purchase_line_id is not null`)).n), 0, 'a zero line writes no expense row');
  eq((await one(db, `select pur_live_purchases($1, null) n`, [f])).n, 1, 'the pre-check counts it');
  assert((await code(db.query(`delete from folders where id = $1`, [f]))).includes('PURCHASES_LIVE'), 'the folder delete must be refused');
  eq(num((await one(db, `select count(*) n from expenses where project_id = $1`, [p])).n), 1, 'nothing was removed');
  const q = await period(db, f, 'October', 2026, { billing: 2, budget: 100 });
  const r2 = await record(db, body([{ folder_id: f, item_name: 'x', amount: 150 }]));
  eq((await one(db, `select pur_live_purchases(null, $1) n`, [q])).n, 1, 'the pre-check sees the period that carries a purchase');
  assert((await code(db.query(`delete from projects where id = $1`, [q]))).includes('PURCHASES_LIVE'), 'the period delete must be refused');
  await one(db, `select pur_void($1, $2, 'test') r`, [op(), r.purchase_id]);
  await one(db, `select pur_void($1, $2, 'test') r`, [op(), r2.purchase_id]);
  eq((await one(db, `select pur_live_purchases($1, $2) n`, [f, q])).n, 0);
  await db.query(`delete from folders where id = $1`, [f]);
});

await test('the pre-check and the delete guard cover Additional Works jobs under a project', async () => {
  const db = await fresh(); await as(db, OWNER);
  const parent = await folder(db, 'ZZ parent');
  const sibling = await folder(db, 'ZZ sibling');
  const child = await folder(db, 'ZZ aw job', { parent });
  await period(db, child, 'October', 2026, { billing: 1, budget: 100 });
  const r = await record(db, body([{ folder_id: child, item_name: 'aw item', amount: 30 }]));
  eq((await one(db, `select pur_live_purchases($1, null) n`, [parent])).n, 1, 'the parent counts the purchase on its job');
  eq((await one(db, `select pur_live_purchases($1, null) n`, [child])).n, 1, 'the job counts it');
  eq((await one(db, `select pur_live_purchases($1, null) n`, [sibling])).n, 0, 'an unrelated project reads 0');
  assert((await code(db.query(`delete from folders where id = $1`, [parent]))).includes('PURCHASES_LIVE'), 'the parent delete is refused');
  await one(db, `select pur_void($1, $2, 'test') r`, [op(), r.purchase_id]);
  eq((await one(db, `select pur_live_purchases($1, null) n`, [parent])).n, 0, 'voided: parent reads 0');
  await db.query(`delete from folders where id = $1`, [parent]);
});

await test('reading purchases needs the same access as recording them: PM-only staff and workers read nothing', async () => {
  const db = await fresh(); await as(db, OWNER);
  const f = await folder(db, 'A');
  await period(db, f, 'October', 2026, { billing: 1, budget: 100 });
  await record(db, body([{ folder_id: f, item_name: 'x', amount: 10 }], { charges: [{ kind: 'delivery_fee', amount: 2 }] }));
  await db.exec(`grant usage on schema public, auth to authenticated; grant select on all tables in schema public to authenticated;
                 grant execute on all functions in schema auth to authenticated;`);
  const seen = async (uid) => {
    await as(db, uid);
    await db.exec('set role authenticated');
    const n = {};
    for (const t of ['purchases', 'purchase_lines', 'purchase_charges', 'purchase_charge_shares', 'purchase_history'])
      n[t] = num((await one(db, `select count(*) n from ${t}`)).n);
    await db.exec('reset role');
    return Object.values(n).join(',');
  };
  // 0097 narrows this (review R3): purchase rows are read by those who may
  // BUY — the owner and staff with the Buyer switch. Other staff keep
  // Project Control's entry through pur_entry_row, and read no table.
  if (WITH_0097) { await as(db, OWNER); await db.query(`select pur_set_buyer($1, true)`, [EXPSTAFF]); }
  eq(await seen(OWNER), '1,1,1,1,1');
  eq(await seen(EXPSTAFF), '1,1,1,1,1');
  eq(await seen(STAFF), WITH_0097 ? '0,0,0,0,0' : '1,1,1,1,1', WITH_0097 ? 'staff without the Buyer switch read nothing (0097)' : 'staff');
  eq(await seen(PMONLY), '0,0,0,0,0', 'a PM-only account must read nothing');
  eq(await seen(WORKER), '0,0,0,0,0');
  eq(await seen(OTHER), '0,0,0,0,0', 'another company reads nothing');
});

await test("stock stays inside the company: its own item first, else an unowned one, never another company's", async () => {
  const db = await fresh(); await as(db, OWNER);
  const f = await folder(db, 'A');
  await period(db, f, 'October', 2026, { billing: 1, budget: 100000 });
  await db.query(`insert into inventory (owner_id, item_name, unit, current_stock, min_stock) values ($1, 'Cement', 'bag', 100, 0), (null, 'Wire', 'roll', 7, 0)`, [OTHER]);
  await record(db, body([{ folder_id: f, item_name: 'Cement', amount: 10, quantity: 4, in_inventory: true },
                         { folder_id: f, item_name: 'Wire', amount: 10, quantity: 1, in_inventory: true }]));
  const inv = (await all(db, `select owner_id, item_name, current_stock from inventory order by item_name, owner_id nulls first`))
    .map(x => [x.owner_id, x.item_name, num(x.current_stock)]);
  eq(inv, [[OWNER, 'Cement', 4], [OTHER, 'Cement', 100], [null, 'Wire', 8]], 'another company\'s Cement untouched; the unowned Wire used');
});

await test('replace: a different number of lines, one transaction — old voided, new recorded, stock never added twice', async () => {
  const db = await fresh(); await as(db, OWNER);
  const f = await folder(db, 'A');
  const p = await period(db, f, 'October', 2026, { billing: 1, budget: 100000 });
  const r = await record(db, body([{ folder_id: f, item_name: 'Cement', amount: 400, quantity: 10, in_inventory: true }]));
  const stock = async () => (await all(db, `select item_name, current_stock from inventory order by item_name`)).map(x => [x.item_name, num(x.current_stock)]);
  eq(await stock(), [['Cement', 10]]);
  const nb = body([{ folder_id: f, item_name: 'Cement', amount: 400, quantity: 10, in_inventory: true },
                   { folder_id: f, item_name: 'Sand', amount: 100, quantity: 5, in_inventory: true }]);
  const rr = (await one(db, `select pur_replace($1, $2, $3::jsonb, 'forgot the sand') r`, [op(), r.purchase_id, JSON.stringify(nb)])).r;
  eq(await stock(), [['Cement', 10], ['Sand', 5]], 'Cement carried over, not added again; only Sand is new');
  eq(rr.stock_moves, 1);
  eq(await one(db, `select status, replaced_by from purchases where id = $1`, [r.purchase_id]), { status: 'void', replaced_by: rr.purchase_id });
  eq(num((await one(db, `select sum(amount) s from expenses where project_id = $1`, [p])).s), 500, 'Spent = the new purchase only');
  eq((await all(db, `select kind from purchase_history where purchase_id = $1 order by id`, [r.purchase_id])).map(x => x.kind), ['recorded', 'replaced']);
  assert((await code(one(db, `select pur_replace($1, $2, $3::jsonb, 'again') r`, [op(), r.purchase_id, JSON.stringify(nb)]))).includes('BAD_STATE'), 'the old one is closed');
  // Staff may not move a cost to another project through a replacement either.
  const g = await folder(db, 'B');
  await period(db, g, 'October', 2026, { billing: 1, budget: 100000 });
  await as(db, STAFF);
  const moved = body([{ folder_id: g, item_name: 'Cement', amount: 400, quantity: 10, in_inventory: true }]);
  assert((await code(one(db, `select pur_replace($1, $2, $3::jsonb, 'move') r`, [op(), rr.purchase_id, JSON.stringify(moved)]))).includes('OWNER_APPROVAL_NEEDED'), 'staff move');
});

await test('replace: one item on several lines — each old stock move is carried to its own new line, never added twice', async () => {
  const db = await fresh(); await as(db, OWNER);
  const a = await folder(db, 'A'), b = await folder(db, 'B');
  await period(db, a, 'October', 2026, { billing: 1, budget: 100000 });
  await period(db, b, 'October', 2026, { billing: 1, budget: 100000 });
  const line = (f, name, amt, q) => ({ folder_id: f, item_name: name, amount: amt, quantity: q, in_inventory: true });
  const r = await record(db, body([line(a, 'Cement', 400, 10), line(b, 'Cement', 200, 5)]));
  const stock = async () => (await all(db, `select item_name, current_stock from inventory order by item_name`)).map(x => [x.item_name, num(x.current_stock)]);
  eq(await stock(), [['Cement', 15]]);
  const nb = body([line(a, 'Cement', 400, 10), line(b, 'Cement', 200, 5), line(a, 'Sand', 30, 3)]);
  await one(db, `select pur_replace($1, $2, $3::jsonb, 'forgot the sand') r`, [op(), r.purchase_id, JSON.stringify(nb)]);
  eq(await stock(), [['Cement', 15], ['Sand', 3]], 'Cement stays 15; only Sand is new');
});

await test('quantity and min_stock are plain decimals: NaN, Infinity, text, negative and zero are refused and inventory is untouched', async () => {
  const db = await fresh(); await as(db, OWNER);
  const f = await folder(db, 'A');
  await period(db, f, 'October', 2026, { billing: 1, budget: 100000 });
  await db.query(`insert into inventory (item_name, unit, current_stock, min_stock) values ('Wire', 'roll', 7, 0)`);
  for (const q of ['NaN', 'Infinity', 'abc', '-1', '0', '1.2345']) {
    const c = await code(record(db, body([{ folder_id: f, item_name: 'Wire', amount: 5, quantity: q, in_inventory: true }])));
    assert(c.includes('BAD_QUANTITY'), 'quantity ' + q + ' gave ' + c);
  }
  const c2 = await code(record(db, body([{ folder_id: f, item_name: 'Wire', amount: 5, quantity: 1, min_stock: 'NaN', in_inventory: true }])));
  assert(c2.includes('BAD_QUANTITY'), 'min_stock NaN gave ' + c2);
  eq((await all(db, `select item_name, current_stock from inventory`)).map(x => [x.item_name, num(x.current_stock)]), [['Wire', 7]]);
  eq(num((await one(db, `select count(*) n from purchases`)).n), 0);
});

await test('replace by staff: a project line cannot be moved to the warehouse (same rule as a correction)', async () => {
  const db = await fresh(); await as(db, STAFF);
  const f = await folder(db, 'A');
  await period(db, f, 'October', 2026, { billing: 1, budget: 100000 });
  const r = await record(db, body([{ folder_id: f, item_name: 'x', amount: 10 }]));
  const wh = body([{ destination: 'warehouse', item_name: 'x', amount: 10 }]);
  assert((await code(one(db, `select pur_replace($1, $2, $3::jsonb, 'move') r`, [op(), r.purchase_id, JSON.stringify(wh)]))).includes('OWNER_APPROVAL_NEEDED'), 'staff move to warehouse');
  eq(num((await one(db, `select sum(amount) s from expenses`)).s), 10, 'the cost stays in Spent');
  await as(db, OWNER);
  await one(db, `select pur_replace($1, $2, $3::jsonb, 'move') r`, [op(), r.purchase_id, JSON.stringify(wh)]);
});

await test('lock keys use the canonical uuid; an invalid project id is BAD_PROJECT', async () => {
  const db = await fresh(); await as(db, OWNER);
  const f = await folder(db, 'A');
  await period(db, f, 'October', 2026, { billing: 1, budget: 100 });
  const keys = async (id) => (await one(db, `select pur_body_keys($1::jsonb) k`, [JSON.stringify({ lines: [{ folder_id: id }] })])).k;
  eq(await keys(f.toUpperCase()), await keys(f.toLowerCase()), 'upper and lower case must lock the same project');
  eq(await keys('{' + f + '}'), await keys(f), 'brace-wrapped too');
  for (const bad of ['not-a-uuid', '12345']) {
    assert((await code(record(db, body([{ folder_id: bad, item_name: 'x', amount: 1 }])))).includes('BAD_PROJECT'), 'folder_id ' + bad);
  }
  await record(db, body([{ folder_id: f.toUpperCase(), item_name: 'x', amount: 1 }]));
});

await test('malformed input keeps to the error codes: 2026-02-31 is BAD_DATE, a non-boolean in_inventory is BAD_LINES', async () => {
  const db = await fresh(); await as(db, OWNER);
  const f = await folder(db, 'A');
  await period(db, f, 'October', 2026, { billing: 1, budget: 100 });
  assert((await code(record(db, body([{ folder_id: f, item_name: 'x', amount: 1 }], { purchase_date: '2026-02-31', date_time: '' })))).includes('BAD_DATE'), 'impossible date');
  assert((await code(record(db, body([{ folder_id: f, item_name: 'x', amount: 1, in_inventory: 'maybe' }])))).includes('BAD_LINES'), 'in_inventory maybe');
});

await test('completed project: staff are refused for correct, refund, void and replace; the owner may', async () => {
  const db = await fresh(); await as(db, OWNER);
  const f = await folder(db, 'A');
  await period(db, f, 'October', 2026, { billing: 1, budget: 1000 });
  const r = await record(db, body([{ folder_id: f, item_name: 'x', amount: 10 }]));
  await db.query(`update folders set completed_at = now() where id = $1`, [f]);
  const b = JSON.stringify(body([{ folder_id: f, item_name: 'x', amount: 12 }]));
  const calls = {
    correct: () => one(db, `select pur_correct($1, $2, $3::jsonb, 'fix') r`, [op(), r.purchase_id, b]),
    refund: () => one(db, `select pur_refund($1, $2, 'fix') r`, [op(), r.purchase_id]),
    void: () => one(db, `select pur_void($1, $2, 'fix') r`, [op(), r.purchase_id]),
    replace: () => one(db, `select pur_replace($1, $2, $3::jsonb, 'fix') r`, [op(), r.purchase_id, b]),
  };
  await as(db, STAFF);
  for (const [k, fn] of Object.entries(calls)) assert((await code(fn())).includes('COMPLETED_PROJECT'), 'staff ' + k);
  await as(db, OWNER);
  await calls.correct();
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) { console.log('\nFAILURES:\n  ' + failures.join('\n  ')); process.exit(1); }
