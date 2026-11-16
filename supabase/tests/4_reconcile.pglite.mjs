// ════════════════════════════════════════════════════════════════════
// STAGE 4 RECONCILIATION — SERVER TESTS ON PGLITE
//   npm run test:sql
//
// Runs migrations 0096 … 0108 and 0109 VERBATIM on PGlite (PostgreSQL in
// memory), over the 2C suite's tables and helpers. Nothing here talks to the
// live database; supabase/tests/4_acceptance.sql repeats the key cases there,
// rolled back.
// ════════════════════════════════════════════════════════════════════
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { prBase, fnText, CATALOG_0085 } from './pr_base.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.DACS_ROOT || path.join(HERE, '..', '..');
const read = (p) => fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const mig = (f) => read(path.join(ROOT, 'supabase/migrations', f));
const M02 = mig('0002_rls.sql');
const M94 = mig('0094_workmate_work_plan_office.sql');
const M96 = mig('0096_purchase_recording.sql');
const M97 = mig('0097_purchasing_office.sql');
const M98 = mig('0098_pm_profit_sharing.sql');
const M101 = mig('0101_purchasing_phone.sql');
const M102 = mig('0102_purchase_payments.sql');
const M103 = mig('0103_buyer_return_photo.sql');
const M90 = mig('0090_workmate_item_history.sql');
const M104 = mig('0104_stock.sql');
const M105 = mig('0105_stock_cost_moves.sql');
const M106 = mig('0106_workmate_phone_stock.sql');
const M107 = mig('0107_tools.sql');
const M108 = mig('0108_tools_crew_numbers.sql');
const M109 = mig('0109_reconciliation.sql');
const M85 = mig('0085_workmate_requests.sql');
const M51 = mig('0051_attendance_worker_owner.sql');
const REQUESTS_0085 = `
create table pr_teams (id uuid primary key default gen_random_uuid(), owner_id uuid not null references profiles(id),
  name text not null, active boolean not null default true, created_at timestamptz not null default now());
create table pr_team_members (id uuid primary key default gen_random_uuid(), owner_id uuid not null references profiles(id),
  team_id uuid not null references pr_teams(id), worker_id uuid not null references profiles(id), is_leader boolean not null default false,
  added_at timestamptz not null default now(), removed_at timestamptz);
create table pr_photos (id uuid primary key default gen_random_uuid(), owner_id uuid not null references profiles(id),
  request_id uuid not null references pr_requests(id), line_id uuid references pr_lines(id), storage_path text not null unique,
  uploaded_by uuid not null references profiles(id), created_at timestamptz not null default now());
${fnText(M85, 'pr_is_requester')}
${fnText(M85, 'pr_is_current_leader')}
${fnText(M51, 'attendance_data_owner')}
`;

const BASE = `
create role anon; create role authenticated; create role service_role;
create schema auth;
create function auth.uid() returns uuid language sql stable as
  $$ select coalesce(nullif(current_setting('test.uid', true), ''),
                     nullif(current_setting('request.jwt.claims', true), '')::json ->> 'sub')::uuid $$;
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
const STAFF = '00000000-0000-0000-0000-00000000000b';   // Expenses, no Buyer switch
const BUYER = '00000000-0000-0000-0000-000000000011';
const BUYER2 = '00000000-0000-0000-0000-000000000012';
const WORKER = '00000000-0000-0000-0000-00000000000c';
const LEADER = '00000000-0000-0000-0000-000000000015';
const OTHER = '00000000-0000-0000-0000-00000000000d';    // another company's owner
const PMOWNER = '00000000-0000-0000-0000-000000000013';  // owner-role account focused on PM
const EXPOWNER = '00000000-0000-0000-0000-000000000014'; // owner-role account with PM + Expenses (own scope)
const PMSTAFF = '00000000-0000-0000-0000-000000000018';  // staff focused on PM only
let opSeq = 0;
const op = () => '40000000-0000-0000-0000-' + String(++opSeq).padStart(12, '0');

let passed = 0, failed = 0;
const failures = [];
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { failed++; failures.push(name + ' — ' + e.message); console.log('  FAIL ' + name + '\n       ' + e.message); }
}
function assert(c, m) { if (!c) throw new Error(m); }
function eq(a, b, m) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error((m || 'not equal') + ': ' + JSON.stringify(a) + ' !== ' + JSON.stringify(b)); }
const num = (x) => Number(x);
function phDate(days = 0) {
  return new Date(Date.now() + 8 * 3600e3 + days * 86400e3).toISOString().slice(0, 10);
}
const TODAY = phDate();

async function fresh(opts = {}) {
  const db = new PGlite();
  await db.exec(BASE);
  await db.exec(M96);
  await db.exec(prBase(ROOT));
  await db.exec(CATALOG_0085);
  await db.exec(fnText(M90, 'pr_clean_aliases'));   // 0092's catalogue save calls it
  await db.exec(M97);
  await db.exec(M101);
  await db.exec(fnText(M98, 'pm_main_owner_id'));
  await db.exec(M102);
  await db.exec(M103);
  await db.exec(M104);
  await db.exec(M105);
  await db.exec(REQUESTS_0085);
  await db.exec(M106);
  await db.exec(M107);
  await db.exec(M108);
  if (!opts.no109) await db.exec(M109);
  await db.exec(`insert into profiles (id, role, owner_id, status, allowed_modules, email, display_name) values
    ('${OWNER}', 'owner', null, 'active', null, 'admin@dacs.test', null),
    ('${STAFF}', 'staff', '${OWNER}', 'active', null, 'staff@dacs.test', 'Ana'),
    ('${BUYER}', 'staff', '${OWNER}', 'active', null, 'juan@dacs.test', 'Juan'),
    ('${BUYER2}', 'staff', '${OWNER}', 'active', null, 'pedro@dacs.test', 'Pedro'),
    ('${WORKER}', 'worker', '${OWNER}', 'active', null, null, 'Mark'),
    ('${LEADER}', 'teamLeader', '${OWNER}', 'active', null, null, 'Lito'),
    ('${OTHER}', 'owner', null, 'active', null, 'other@x.test', null),
    ('${PMOWNER}', 'owner', '${OWNER}', 'active', '["pm"]'::jsonb, 'admin-pm@dacs.test', null),
    ('${EXPOWNER}', 'owner', '${OWNER}', 'active', '["pm", "expenses"]'::jsonb, 'admin-exp@dacs.test', null),
    ('${PMSTAFF}', 'staff', '${OWNER}', 'active', '["pm"]'::jsonb, 'pmstaff@dacs.test', 'Pia');`);
  await as(db, OWNER);
  await db.query(`select pur_set_buyer($1, true)`, [BUYER]);
  await db.query(`select pur_set_buyer($1, true)`, [BUYER2]);
  if (opts.on !== false) await db.query(`select stk_set_enabled(true)`);
  return db;
}
async function as(db, uid) { await db.exec(`select set_config('test.uid', '${uid}', false)`); }
async function one(db, sql, params = []) { return (await db.query(sql, params)).rows[0]; }
async function all(db, sql, params = []) { return (await db.query(sql, params)).rows; }
async function code(promise) {
  try { await promise; return 'no error'; } catch (e) { return e.message; }
}
async function refused(promise, want, m) {
  const got = await code(promise);
  assert(got.includes(want), (m || 'refused') + ': expected ' + want + ', got ' + got);
}

async function folder(db, name, opts = {}) {
  return (await one(db, `insert into folders (owner_id, name, parent_folder_id, completed_at) values ($1, $2, $3, $4) returning id`,
    [opts.owner || OWNER, name, opts.parent || null, opts.completed ? new Date().toISOString() : null])).id;
}
async function period(db, folderId, budget = 100000) {
  const d = new Date(TODAY + 'T00:00:00Z');
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const id = (await one(db, `insert into projects (owner_id, folder_id, month, year, funding_type, billing_number)
                              values ($1, $2, $3, $4, 'progress', 1) returning id`, [OWNER, folderId, months[d.getUTCMonth()], d.getUTCFullYear()])).id;
  await db.query(`insert into project_budgets values ($1, $2, $3)`, [id, OWNER, budget]);
  return id;
}
async function item(db, name, unit = 'bag', owner = OWNER) {
  return (await one(db, `insert into pr_catalog_items (owner_id, name, unit) values ($1, $2, $3) returning id`, [owner, name, unit])).id;
}
// A request line for a project (Main Contract or work), one portion of NOW's batch.
async function request(db, folderId, opts = {}) {
  const batch = (await one(db, `select pr_batch_for($1, now()) b`, [OWNER])).b;
  const req = (await one(db, `insert into pr_requests (owner_id, requester_id, folder_id, work_folder_id)
                               values ($1, $2, $3, $4) returning id`, [OWNER, WORKER, opts.project || folderId, folderId])).id;
  const line = (await one(db, `insert into pr_lines (owner_id, request_id, description, unit, catalog_item_id)
                                values ($1, $2, $3, $4, $5) returning id`,
    [OWNER, req, opts.description || 'Cement', opts.unit || 'bag', opts.item || null])).id;
  const portion = (await one(db, `insert into pr_line_portions (owner_id, line_id, batch_id, quantity) values ($1, $2, $3, $4) returning id`,
    [OWNER, line, batch, opts.quantity ?? 10])).id;
  return { req, line, portion, batch };
}
function body(lines, extra = {}) {
  const total = lines.reduce((s, l) => s + l.amount, 0);
  return { source: 'purchasing', purchase_date: extra.date || TODAY, supplier: 'Wilcon', notes: '', payment_method: 'CASH',
           docs: {}, no_receipt_reason: 'test', receipt_total: Math.round(total * 100) / 100,
           lines: lines.map(l => ({ destination: 'project', category: 'Materials', unit: 'bag', unplanned_reason: 'site ran out', ...l })) };
}
async function record(db, b, who = BUYER) {
  await as(db, who);
  return (await one(db, `select pur_record($1, $2::jsonb) as r`, [op(), JSON.stringify(b)])).r;
}
// A recorded warehouse purchase: one line of `qty` `unit` named `name`.
async function warehouseBuy(db, name, qty, opts = {}) {
  const r = await record(db, body([{ destination: 'warehouse', item_name: name, quantity: qty, unit: opts.unit || 'bag',
                                     amount: opts.amount || qty * 100 }], { date: opts.date }), opts.who || BUYER);
  return r.purchase_id;
}
async function projectBuy(db, f, name, qty, opts = {}) {
  const line = { folder_id: f, item_name: name, quantity: qty, unit: opts.unit || 'bag', amount: opts.amount || qty * 100 };
  if (opts.requestLine) { line.request_line_id = opts.requestLine; delete line.unplanned_reason; }
  const r = await record(db, body([line], { date: opts.date }), opts.who || BUYER);
  return r.purchase_id;
}
const P = (amount, extra = {}) => ({ amount: String(amount), paid_on: phDate(), method: 'cash', source: 'company', ...extra });
const rpc = async (db, who, fn, args) => {
  await as(db, who);
  const ph = args.map((_, i) => '$' + (i + 1)).join(', ');
  return (await one(db, `select ${fn}(${ph}) as r`, args)).r;
};
const match = (db, who, pid, line, itemId, covers, note = null) => rpc(db, who, 'stk_match', [op(), pid, line, itemId, String(covers), note]);
const receive = (db, who, pid, line, qty, on = TODAY) => rpc(db, who, 'stk_receive', [op(), pid, line, String(qty), on, '']);
const notDelivered = (db, who, pid, line, qty, reason = 'supplier ran out') => rpc(db, who, 'stk_not_delivered', [op(), pid, line, String(qty), reason]);
const leftover = (db, who, pid, line, qty, where = 'site') => rpc(db, who, 'stk_leftover', [op(), pid, line, String(qty), where, TODAY, '']);
const move = (db, who, b) => rpc(db, who, 'stk_move', [op(), JSON.stringify({ on: TODAY, ...b, quantity: String(b.quantity) })]);
const count = (db, who, b) => rpc(db, who, 'stk_count', [op(), JSON.stringify({ on: TODAY, ...b, counted: String(b.counted) })]);
const opening = (db, who, b) => rpc(db, who, 'stk_opening', [op(), JSON.stringify({ on: TODAY, ...b, quantity: String(b.quantity) })]);
const decide = (db, who, rec, ok, note = 'ok') => rpc(db, who, 'stk_decide', [op(), rec, ok, note]);
const reverse = (db, who, rec, reason = 'mistake') => rpc(db, who, 'stk_reverse', [op(), rec, reason]);

async function wh(db) { return (await one(db, `select id from stk_locations where owner_id = $1 and kind = 'warehouse'`, [OWNER])).id; }
async function site(db, f) { return (await one(db, `select id from stk_locations where owner_id = $1 and folder_id = $2`, [OWNER, f]))?.id; }
async function bal(db, itemId, where) {
  const loc = where === 'warehouse' ? await wh(db) : await site(db, where);
  if (!loc) return 0;
  return num((await one(db, `select stk_item_balance($1, $2, $3) b`, [OWNER, itemId, loc])).b);
}
async function money(db) {
  return one(db, `select (select count(*) from expenses) n, (select coalesce(sum(amount), 0) from expenses) s,
                         (select count(*) from payroll) pr, (select count(*) from pur_payments) pay`);
}
async function still(db, line) {
  return num((await one(db, `select coalesce(sum(greatest(0, p.quantity - p.pending_reduction - pr_portion_bought(p.id))), 0) s
                               from pr_line_portions p where p.line_id = $1`, [line])).s);
}
// A matched, received warehouse lot of `qty` bags of item `it`
// (opts.date: purchased; opts.received: the day it arrived).
async function stocked(db, it, qty, opts = {}) {
  const pid = await warehouseBuy(db, opts.name || 'Cement', qty, { date: opts.date });
  await match(db, OWNER, pid, 1, it, qty);
  await receive(db, opts.receiver || BUYER, pid, 1, qty, opts.received || TODAY);
  return pid;
}
// The day each layer an answer's moves came from was received, with its quantity.
async function layersOf(db, takes) {
  const out = [];
  for (const t of takes) {
    const r = await one(db, `select on_date::text d from stk_records where id = $1`, [t.layer]);
    out.push([r.d, num(t.quantity)]);
  }
  return out;
}

// ── 2C helpers ────────────────────────────────────────────────────────
const cdecide = (db, who, id, ok, note = 'ok') => rpc(db, who, 'stk_cost_decide', [op(), id, ok, note]);
const creverse = (db, who, id, reason = 'wrong lot') => rpc(db, who, 'stk_cost_reverse', [op(), id, reason]);
const cresubmit = (db, who, id, note = 'see the delivery photo') => rpc(db, who, 'stk_cost_resubmit', [op(), id, note]);
async function cost(db, id) { return one(db, `select * from stk_cost_moves where id = $1`, [id]); }
async function costsOf(db, rec) { return all(db, `select * from stk_cost_moves where record_id = $1 order by requested_at, id`, [rec]); }
async function lotOf(db, pid) { return (await one(db, `select id from stk_lots where purchase_id = $1`, [pid])).id; }
// A project's Spent: every expense row of its billing periods, or on the project itself.
async function spent(db, f) {
  return num((await one(db, `select coalesce(sum(e.amount), 0) s from expenses e left join projects p on p.id = e.project_id
                              where coalesce(e.folder_id, p.folder_id) = $1`, [f])).s);
}
// A project's cost-move rows: [name, amount, Cover, billing period].
async function stockRows(db, f) {
  return (await all(db, `select e.expense_name n, e.amount a, e.cover_expense c, e.project_id p from expenses e
                           left join projects p on p.id = e.project_id
                          where e.stk_cost_move_id is not null and coalesce(e.folder_id, p.folder_id) = $1
                          order by e.created_at, e.split_index nulls first, e.amount desc`, [f])).map(r => [r.n, num(r.a), r.c, r.p]);
}
async function held(db, lot, holder) {
  const r = await one(db, `select value, quantity from stk_held($1, $2)`, [lot, holder]);
  return [num(r.value), num(r.quantity)];
}
async function lossValue(db, lot) {
  return num((await one(db, `select coalesce(sum(value), 0) v from stk_cost_moves where lot_id = $1 and kind = 'loss'
                              and status = 'approved' and reversed_at is null`, [lot])).v);
}
async function companyStock(db, who = OWNER) {
  await as(db, who);
  return (await one(db, `select stk_company_stock() x`)).x.map(i => [i.name, num(i.in_warehouse.quantity), num(i.in_warehouse.value),
    num(i.issued_pending.quantity), num(i.issued_pending.value), num(i.awaiting.quantity), num(i.loss.quantity), num(i.loss.value)]);
}
// A purchase with delivery fees / discounts (receipt total = lines + fees − discounts).
async function buyWith(db, lines, charges, opts = {}) {
  const b = body(lines, { date: opts.date });
  b.charges = charges;
  b.receipt_total = Math.round((b.receipt_total + charges.reduce((s, c) => s + (c.kind === 'discount' ? -c.amount : c.amount), 0)) * 100) / 100;
  return (await record(db, b, opts.who || BUYER)).purchase_id;
}
async function periodOn(db, f, date, budget = 100000, billing = 1, funding = 'progress') {
  const d = new Date(date + 'T00:00:00Z');
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const id = (await one(db, `insert into projects (owner_id, folder_id, month, year, funding_type, billing_number)
                              values ($1, $2, $3, $4, $5, $6) returning id`, [OWNER, f, months[d.getUTCMonth()], d.getUTCFullYear(), funding, billing])).id;
  await db.query(`insert into project_budgets values ($1, $2, $3)`, [id, OWNER, budget]);
  return id;
}
// Every traced lot: its cost is in exactly one place — company stock, a
// project (whose Spent carries it), or company stock loss.
// (notStock: a project's purchase cost that is not a stock lot, e.g. a line never stocked.)
async function fourPlaces(db, folders, notStock = {}) {
  const lots = await all(db, `select lt.id, b.value v from stk_lots lt cross join lateral stk_lot_basis(lt.id) b where not lt.untraced`);
  for (const l of lots) {
    let sum = (await held(db, l.id, null))[0] + await lossValue(db, l.id);
    for (const f of folders) sum += (await held(db, l.id, f))[0];
    eq(Math.round(sum * 100) / 100, num(l.v), 'lot ' + l.id + ': company + projects + loss = its cost');
  }
  for (const f of folders) {
    let h = notStock[f] || 0;
    for (const l of lots) h += (await held(db, l.id, f))[0];
    eq(await spent(db, f), Math.round(h * 100) / 100, 'project Spent = the stock cost it holds');
  }
}

// ── Stage 4 helpers ───────────────────────────────────────────────────
const places = (db, who = OWNER, from = phDate(-400), to = phDate(30)) => rpc(db, who, 'rec_purchase_places', [from, to]);
const waiting = (db, who = OWNER) => rpc(db, who, 'rec_waiting', []);
const review = (db, who = OWNER) => rpc(db, who, 'rec_review_lines', []);
const bills = (db, who = OWNER) => rpc(db, who, 'rec_bills', []);
const moneyOut = (db, who = OWNER) => rpc(db, who, 'rec_money_out', []);
const accept = (db, who, pid, lineNo, reason = 'No client allocation this month — the company covers it', opId = op()) =>
  rpc(db, who, 'rec_accept_cover', [opId, pid, lineNo, reason]);
const withdraw = (db, who, mark, reason = 'Marked by mistake', opId = op()) => rpc(db, who, 'rec_withdraw_cover', [opId, mark, reason]);
const tick = (db, who, cm, group, checked = true, note = '', opId = op()) => rpc(db, who, 'rec_bill_check', [opId, cm, group, checked, note]);
const placeOf = async (db, pid) => (await places(db)).purchases.find(p => p.id === pid);
const six = (p) => [num(p.recorded), num(p.own), num(p.other), num(p.company), num(p.loss), num(p.difference)];
// Every expense row as one fingerprint: Stage 4 never changes one.
async function rowsPrint(db) {
  return one(db, `select count(*) n, coalesce(sum(amount), 0) s,
                         md5(coalesce(string_agg(id::text || ':' || coalesce(project_id::text, '-') || ':' || coalesce(folder_id::text, '-')
                                                 || ':' || amount::text || ':' || coalesce(cover_expense, false)::text, ',' order by id), '')) h
                    from expenses`);
}
// A project purchase dated in a month with no billing period (another month has one): Cover + "Office review".
async function uncovered(db, name = 'Barlin', amount = 344) {
  const f = await folder(db, name);
  await periodOn(db, f, phDate(-100));
  const b = body([{ folder_id: f, item_name: 'PAINTING MATERIALS', quantity: 1, unit: 'lot', amount }]);
  const pid = (await record(db, b)).purchase_id;
  return { f, pid, b };
}
const flag = async (db, pid, lineNo = 1) =>
  (await one(db, `select needs_funding_review x from purchase_lines where purchase_id = $1 and line_no = $2`, [pid, lineNo])).x;

console.log('\nStage 4 reconciliation (0096 … 0108 + 0109 on PGlite)');

// ── A. Where every purchase peso is (Q4) ─────────────────────────────

await test('a project purchase (Project Control or Purchasing): all of it in its own project — adds up', async () => {
  const db = await fresh();
  const f = await folder(db, 'Barlin'); await period(db, f);
  await as(db, STAFF);
  const pc = (await one(db, `select pur_record($1, $2::jsonb) r`, [op(), JSON.stringify({ ...body([{ folder_id: f, item_name: 'Tiles', quantity: 1, amount: 3360 }]),
                                                                                         source: 'expenses_form' })])).r.purchase_id;
  const pu = await projectBuy(db, f, 'Cement', 10);
  eq(six(await placeOf(db, pc)), [3360, 3360, 0, 0, 0, 0]);
  eq(six(await placeOf(db, pu)), [1000, 1000, 0, 0, 0, 0]);
  const t = (await places(db)).totals;
  eq([num(t.purchases), num(t.recorded), num(t.own), num(t.difference), num(t.with_difference)], [2, 4360, 4360, 0, 0]);
});

await test('project and warehouse lines with a delivery fee and a discount: the project part in its Spent, the rest company stock — to the centavo', async () => {
  const db = await fresh();
  const f = await folder(db, 'Barlin'); await period(db, f);
  const pid = await buyWith(db, [{ folder_id: f, item_name: 'Sand', quantity: 3, amount: 1000 },
                                 { destination: 'warehouse', item_name: 'Cement', quantity: 7, amount: 1777.77 }],
                            [{ kind: 'delivery_fee', amount: 33.33 }, { kind: 'discount', amount: 10 }]);
  const p = await placeOf(db, pid);
  eq(num(p.recorded), 2801.10);
  eq(num(p.own), await spent(db, f), 'own = the project\'s Spent from it');
  eq(Math.round((num(p.own) + num(p.company)) * 100) / 100, 2801.10, 'own + company stock = the receipt');
  eq(num(p.difference), 0);
  eq(p.projects.split(', ').sort(), ['Barlin', 'Warehouse']);
});

await test('company stock issued and approved: the cost sits in the receiving project; a reversal brings it back — adds up at every step', async () => {
  const db = await fresh();
  const it = await item(db, 'Cement');
  const f = await folder(db, 'Barlin'); await period(db, f);
  const pid = await stocked(db, it, 10);                          // ₱1,000
  eq(six(await placeOf(db, pid)), [1000, 0, 0, 1000, 0, 0], 'in the warehouse: company stock');
  const r = await move(db, STAFF, { item_id: it, from: 'warehouse', to: f, quantity: 4, unplanned_reason: 'slab' });
  eq(six(await placeOf(db, pid)), [1000, 0, 0, 1000, 0, 0], 'pending: still company stock');
  await cdecide(db, OWNER, r.cost_moves[0], true);
  eq(six(await placeOf(db, pid)), [1000, 0, 400, 600, 0, 0], 'approved: ₱400 in Barlin');
  await creverse(db, OWNER, r.cost_moves[0]);
  eq(six(await placeOf(db, pid)), [1000, 0, 0, 1000, 0, 0], 'reversed: back to company stock');
});

await test('leftovers moved to another project: the buying project keeps the rest, the receiving one holds the moved part', async () => {
  const db = await fresh();
  const it = await item(db, 'Cement');
  const a = await folder(db, 'Barlin'); await period(db, a, 600);
  const b = await folder(db, 'Bagong'); await period(db, b);
  const r0 = await request(db, a, { item: it, quantity: 10 });
  const pj = await projectBuy(db, a, 'Cement', 10, { requestLine: r0.line });
  await leftover(db, STAFF, pj, 1, 5, 'warehouse');
  const r = await move(db, STAFF, { item_id: it, from: 'warehouse', to: b, quantity: 5, unplanned_reason: 'slab' });
  await cdecide(db, OWNER, r.cost_moves[0], true);
  eq(six(await placeOf(db, pj)), [1000, 500, 500, 0, 0, 0]);
  eq([await spent(db, a), await spent(db, b)], [500, 500], 'the same as each project\'s Spent');
});

await test('a confirmed warehouse loss: company stock loss — and a busy day still adds up for every purchase', async () => {
  const db = await fresh();
  const it = await item(db, 'Cement');
  const a = await folder(db, 'Barlin'); await period(db, a, 700);
  const b = await folder(db, 'Bagong'); await period(db, b, 250);
  const cc = await folder(db, 'Cubao'); await period(db, cc);
  const w1 = await buyWith(db, [{ destination: 'warehouse', item_name: 'Cement', quantity: 7, amount: 1777.77 }],
                           [{ kind: 'delivery_fee', amount: 33.33 }]);
  await match(db, STAFF, w1, 1, it, 7); await receive(db, BUYER, w1, 1, 7);
  const w2 = await warehouseBuy(db, 'Cement', 6, { amount: 1000 });
  await match(db, STAFF, w2, 1, it, 6); await receive(db, BUYER, w2, 1, 6);
  const r0 = await request(db, a, { item: it, quantity: 9 });
  const pj = await projectBuy(db, a, 'Cement', 9, { requestLine: r0.line, amount: 999.99 });
  await leftover(db, STAFF, pj, 1, 4, 'warehouse');
  const ok = async (rec) => { for (const id of rec.cost_moves) await cdecide(db, OWNER, id, true); };
  await ok(await move(db, STAFF, { item_id: it, from: 'warehouse', to: a, quantity: 5, unplanned_reason: 'x' }));
  await ok(await move(db, STAFF, { item_id: it, from: 'warehouse', to: b, quantity: 6, unplanned_reason: 'x' }));
  await ok(await move(db, STAFF, { item_id: it, from: a, to: cc, quantity: 3, unplanned_reason: 'formwork' }));
  await ok(await move(db, STAFF, { item_id: it, from: b, to: 'warehouse', quantity: 2 }));
  const cnt = await count(db, STAFF, { item_id: it, at: 'warehouse', counted: 0, reason: 'damaged' });
  if (cnt.status === 'pending') await decide(db, OWNER, cnt.record_id, true);
  const all4 = await places(db);
  for (const p of all4.purchases) eq(num(p.difference), 0, p.what + ' adds up');
  eq(num(all4.totals.recorded), 1811.10 + 1000 + 999.99);
  assert(num(all4.totals.loss) > 0, 'some of it is company stock loss');
  eq(Math.round((num(all4.totals.own) + num(all4.totals.other)) * 100) / 100,
     Math.round((await spent(db, a) + await spent(db, b) + await spent(db, cc)) * 100) / 100,
     'own + other = the three projects\' Spent');
});

await test('a warehouse line not matched or received yet: company stock at its value', async () => {
  const db = await fresh();
  const pid = await warehouseBuy(db, 'Cement', 5, { amount: 950 });
  eq(six(await placeOf(db, pid)), [950, 0, 0, 950, 0, 0]);
});

await test('voided purchases are listed apart and count nowhere; a corrected purchase appears once', async () => {
  const db = await fresh();
  const f = await folder(db, 'Barlin'); await period(db, f);
  const v = await projectBuy(db, f, 'Cement', 2);
  await as(db, BUYER);
  await db.query(`select pur_void($1, $2, 'entered twice')`, [op(), v]);
  const b = body([{ folder_id: f, item_name: 'Sand', quantity: 1, amount: 500 }]);
  const c = (await record(db, b)).purchase_id;
  await db.query(`select pur_correct($1, $2, $3::jsonb, 'price')`, [op(), c, JSON.stringify({ ...b, receipt_total: 550,
    lines: [{ ...b.lines[0], amount: 550 }] })]);
  const all4 = await places(db);
  eq(all4.purchases.map(p => [p.id, num(p.recorded), num(p.difference)]), [[c, 550, 0]]);
  eq(all4.voided.map(p => [p.id, num(p.recorded), p.reason]), [[v, 200, 'entered twice']]);
});

await test('a stray expense row shows up as a difference — the check really compares two sets of records', async () => {
  const db = await fresh();
  const f = await folder(db, 'Barlin'); const per = await period(db, f);
  const pid = await projectBuy(db, f, 'Cement', 10);
  const line = (await one(db, `select id from purchase_lines where purchase_id = $1`, [pid])).id;
  await db.exec(`alter table expenses disable trigger expenses_purchase_guard`);
  await db.query(`insert into expenses (owner_id, project_id, amount, purchase_line_id) values ($1, $2, 25, $3)`, [OWNER, per, line]);
  await db.exec(`alter table expenses enable trigger expenses_purchase_guard`);
  const p = await placeOf(db, pid);
  eq(six(p), [1000, 1025, 0, 0, 0, -25]);
  eq(num((await places(db)).totals.with_difference), 1);
});

await test('the date range: only purchases made between the two days; bad dates and ranges refused', async () => {
  const db = await fresh();
  const f = await folder(db, 'Barlin'); await period(db, f);
  await periodOn(db, f, phDate(-40), 100000, 2);
  const old = await projectBuy(db, f, 'Cement', 1, { date: phDate(-40) });
  const now = await projectBuy(db, f, 'Sand', 1);
  eq((await places(db, OWNER, phDate(-1), phDate())).purchases.map(p => p.id), [now]);
  eq((await places(db, OWNER, phDate(-50), phDate(-30))).purchases.map(p => p.id), [old]);
  await refused(places(db, OWNER, '2026-13-01', '2026-12-31'), 'BAD_DATE');
  await refused(places(db, OWNER, 'yesterday', '2026-12-31'), 'BAD_DATE');
  await refused(places(db, OWNER, phDate(), phDate(-1)), 'BAD_RANGE');
});

await test('who: owner accounts with Expenses; staff, Buyer staff, workers and a PM-only owner are refused; another company sees only its own', async () => {
  const db = await fresh();
  const f = await folder(db, 'Barlin'); await period(db, f);
  await projectBuy(db, f, 'Cement', 1);
  for (const [who, want] of [[STAFF, 'OWNER_ONLY'], [BUYER, 'OWNER_ONLY'], [WORKER, 'OWNER_ONLY'], [LEADER, 'OWNER_ONLY'],
                             [PMSTAFF, 'OWNER_ONLY'], [PMOWNER, 'NOT_ALLOWED']]) {
    for (const fn of [() => places(db, who), () => waiting(db, who), () => review(db, who), () => bills(db, who), () => moneyOut(db, who)]) {
      await refused(fn(), want, who);
    }
  }
  eq((await places(db, OTHER)).purchases, [], 'another company');
  eq((await places(db, EXPOWNER)).purchases, [], 'an owner account sees its own company only');
});

// ── B. Waiting, as counts (Q5) ───────────────────────────────────────

await test('waiting: billing period, unpaid, cost moves, change requests, stock, tools and bills — the cash counts reach the main owner only', async () => {
  const db = await fresh();
  const it = await item(db, 'Cement');
  const f = await folder(db, 'Barlin'); await period(db, f);
  const base = await waiting(db);
  eq([base.billing_period, base.unpaid, base.cost_moves, base.change_requests, base.stock, base.tools, base.bills].map(num), [0, 0, 0, 0, 0, 0, 0]);
  eq([base.own_money, base.returns, base.disputes, base.overpaid].map(num), [0, 0, 0, 0], 'the main owner sees the cash counts');
  await uncovered(db, 'Eagle');                                              // 1 line waiting for a billing period, Unpaid too
  const pid = await stocked(db, it, 10);
  const r = await move(db, STAFF, { item_id: it, from: 'warehouse', to: f, quantity: 2, unplanned_reason: 'slab' });  // 1 cost move pending
  await as(db, BUYER);
  await db.query(`select pur_request_change($1, $2, 'void', null, 'wrong project')`, [op(), pid]);                     // 1 change request
  await count(db, STAFF, { item_id: it, at: 'warehouse', counted: 7, reason: 'damaged' });                            // 1 count waiting
  await as(db, OWNER);
  await db.query(`select tl_set_enabled(true)`);
  const drill = (await one(db, `insert into pr_catalog_items (owner_id, name, unit, kind) values ($1, 'Drill', 'pc', 'tool') returning id`, [OWNER])).id;
  const reg = await rpc(db, STAFF, 'tl_register', [op(), JSON.stringify({ item_id: drill, condition: 'good', at: 'warehouse',
                                                                           photo_path: `tools/${OWNER}/2026-10/${crypto.randomUUID()}.jpg` })]);
  await rpc(db, STAFF, 'tl_report_lost', [op(), reg.tools[0].tool_id, 'not on site']);                                     // 1 tool waiting
  let w = await waiting(db);
  eq([w.billing_period, w.unpaid, w.cost_moves, w.change_requests, w.stock, w.tools, w.bills].map(num), [1, 2, 1, 1, 1, 1, 0]);
  await cdecide(db, OWNER, r.cost_moves[0], true);
  w = await waiting(db);
  eq([num(w.cost_moves), num(w.bills)], [0, 1], 'approved: a bill to check');
  const g = (await bills(db))[0];
  await tick(db, OWNER, g.cost_move_id, g.group);
  eq(num((await waiting(db)).bills), 0);
  const sub = await waiting(db, EXPOWNER);
  eq(['own_money', 'returns', 'disputes', 'overpaid'].map(k => k in sub), [false, false, false, false], 'not the main owner: no cash keys');
});

await test('waiting, cash: own money to accept, a return to confirm, a disputed handover and an Overpaid purchase', async () => {
  const db = await fresh();
  const f = await folder(db, 'Barlin'); await period(db, f);
  const a = await projectBuy(db, f, 'Cement', 10);                 // ₱1,000
  await as(db, OWNER);
  await db.query(`select pur_cash_give($1, $2, '500', $3, 'cash', '')`, [op(), BUYER, phDate()]);
  await rpc(db, BUYER, 'pur_pay', [op(), a, JSON.stringify(P(300, { source: 'own_money' }))]);            // not allowed → to accept
  await rpc(db, OWNER, 'pur_pay', [op(), a, JSON.stringify(P(900))]);                                      // ₱1,200 paid on ₱1,000
  await as(db, BUYER);
  await db.query(`select pur_cash_report_return($1, '100', $2, 'Sir John', '', '')`, [op(), phDate()]);
  const issue = (await one(db, `select id from pur_cash_issues where buyer_id = $1`, [BUYER])).id;
  await db.query(`select pur_cash_dispute($1, $2, 'I got ₱450')`, [op(), issue]);
  const w = await waiting(db);
  eq([w.own_money, w.returns, w.disputes, w.overpaid].map(num), [1, 1, 1, 1]);
});

// ── C. "Cover is right" (Q6) ─────────────────────────────────────────

await test('a purchase in a month with no billing period waits; "Cover is right" needs a reason, clears the mark, and moves no money', async () => {
  const db = await fresh();
  const { f, pid } = await uncovered(db, 'Eagle', 344);
  eq(await flag(db, pid), true);
  const r = await review(db);
  eq(r.waiting.map(x => [x.ref, x.line_no, x.item, x.project, num(x.amount), x.rows.every(y => y.cover), x.period_now]),
     [[pid.slice(0, 8), 1, 'PAINTING MATERIALS', 'Eagle', 344, true, false]]);
  await refused(accept(db, OWNER, pid, 1, '   '), 'REASON_REQUIRED');
  const before = await rowsPrint(db);
  const out = await accept(db, OWNER, pid, 1);
  eq(await flag(db, pid), false);
  eq(await rowsPrint(db), before, 'not one expense row changed');
  eq((await review(db)).waiting, []);
  await as(db, OWNER);
  eq((await one(db, `select pur_review_lines() x`)).x, [], 'Project Control\'s "Office review" mark is gone too');
  const m = (await review(db)).marks;
  eq(m.map(x => [x.id, x.ref, x.item, x.project, num(x.amount), x.current, x.withdrawn_at]),
     [[out.mark_id, pid.slice(0, 8), 'PAINTING MATERIALS', 'Eagle', 344, true, null]]);
  eq(six(await placeOf(db, pid)), [344, 344, 0, 0, 0, 0], 'still in Spent, still adds up');
  void f;
});

await test('only owner accounts mark; staff and Buyer staff are refused; another company cannot reach the line', async () => {
  const db = await fresh();
  const { pid } = await uncovered(db);
  await refused(accept(db, STAFF, pid, 1), 'OWNER_ONLY');
  await refused(accept(db, BUYER, pid, 1), 'OWNER_ONLY');
  await refused(accept(db, PMOWNER, pid, 1), 'NOT_ALLOWED');
  await refused(accept(db, OTHER, pid, 1), 'NOT_FOUND');
  eq(await flag(db, pid), true, 'still waiting');
});

await test('a correction re-checks the line: still no billing period → it waits again, the old mark no longer applies and cannot be withdrawn', async () => {
  const db = await fresh();
  const { pid, b } = await uncovered(db);
  const out = await accept(db, OWNER, pid, 1);
  await as(db, BUYER);
  await db.query(`select pur_correct($1, $2, $3::jsonb, 'receipt photo added')`, [op(), pid, JSON.stringify(b)]);
  eq(await flag(db, pid), true, 'waiting again');
  const r = await review(db);
  eq(r.waiting.length, 1);
  eq(r.marks.map(x => [x.id, x.current]), [[out.mark_id, false]]);
  await refused(withdraw(db, OWNER, out.mark_id), 'CHANGED_SINCE');
  await accept(db, OWNER, pid, 1, 'Still no client allocation for October');
  eq((await review(db)).marks.map(x => x.current), [true, false], 'a new mark for the line as it is now');
  await refused(withdraw(db, OWNER, out.mark_id), 'CHANGED_SINCE', 'the older mark is superseded, even though the line reads the same');
});

await test('adding the month\'s billing period and saving again re-funds the line, as today — no mark needed', async () => {
  const db = await fresh();
  const { f, pid, b } = await uncovered(db);
  await periodOn(db, f, phDate(), 100000, 2);
  eq((await review(db)).waiting[0].period_now, true, 'the screen can say a period exists now');
  await as(db, BUYER);
  await db.query(`select pur_correct($1, $2, $3::jsonb, 'October period added')`, [op(), pid, JSON.stringify(b)]);
  eq(await flag(db, pid), false);
  eq((await all(db, `select cover_expense c from expenses e join purchase_lines l on l.id = e.purchase_line_id where l.purchase_id = $1`, [pid])).map(x => x.c),
     [false], 'on the new period now');
  eq((await review(db)).waiting, []);
});

await test('withdraw: a reason, only while the line is exactly as marked; it puts the mark back and the history stays', async () => {
  const db = await fresh();
  const { pid } = await uncovered(db);
  const out = await accept(db, OWNER, pid, 1);
  await refused(withdraw(db, OWNER, out.mark_id, ''), 'REASON_REQUIRED');
  await refused(withdraw(db, STAFF, out.mark_id), 'OWNER_ONLY');
  const before = await rowsPrint(db);
  await withdraw(db, OWNER, out.mark_id);
  eq(await flag(db, pid), true);
  eq(await rowsPrint(db), before, 'no money moved');
  await refused(withdraw(db, OWNER, out.mark_id), 'BAD_STATE');
  const m = (await review(db)).marks[0];
  eq([m.current, m.withdraw_reason, m.withdrawn_by !== null], [false, 'Marked by mistake', true]);
  await refused(withdraw(db, OWNER, crypto.randomUUID()), 'NOT_FOUND');
});

await test('refused: a line not waiting, a voided purchase, a line not on Cover, a line that does not exist', async () => {
  const db = await fresh();
  const f = await folder(db, 'Barlin'); await period(db, f);
  const ok = await projectBuy(db, f, 'Cement', 1);
  await refused(accept(db, OWNER, ok, 1), 'NOT_WAITING');
  await refused(accept(db, OWNER, ok, 2), 'NOT_FOUND');
  await db.query(`update purchase_lines set needs_funding_review = true where purchase_id = $1`, [ok]);   // forged: a flag on a period row
  await refused(accept(db, OWNER, ok, 1), 'NOT_COVER');
  const { pid } = await uncovered(db, 'Eagle');
  await as(db, BUYER);
  await db.query(`select pur_void($1, $2, 'duplicate')`, [op(), pid]);
  await refused(accept(db, OWNER, pid, 1), 'BAD_STATE');
});

await test('retries record once: the same operation id returns the first answer', async () => {
  const db = await fresh();
  const { pid } = await uncovered(db);
  const id = op();
  const a = await accept(db, OWNER, pid, 1, 'first', id);
  const b = await accept(db, OWNER, pid, 1, 'first', id);
  eq([b.mark_id, b.replayed], [a.mark_id, true]);
  eq(num((await one(db, `select count(*) n from rec_cover_marks`)).n), 1);
});

await test('marks are history: never deleted, changed only by a withdrawal', async () => {
  const db = await fresh();
  const { pid } = await uncovered(db);
  const out = await accept(db, OWNER, pid, 1);
  await refused(db.query(`delete from rec_cover_marks where id = $1`, [out.mark_id]), 'HISTORY_LOCKED');
  await refused(db.query(`update rec_cover_marks set reason = 'changed' where id = $1`, [out.mark_id]), 'HISTORY_LOCKED');
});

// ── D. Bills to check (Q10) ──────────────────────────────────────────

await test('an approved cost move is listed with the months it changed on each side; tick and un-tick — the latest counts', async () => {
  const db = await fresh();
  const it = await item(db, 'Cement');
  const a = await folder(db, 'Barlin'); await period(db, a, 600);
  const b = await folder(db, 'Bagong'); await period(db, b);
  const r0 = await request(db, a, { item: it, quantity: 10 });
  const pj = await projectBuy(db, a, 'Cement', 10, { requestLine: r0.line });
  await leftover(db, STAFF, pj, 1, 5, 'warehouse');
  const r = await move(db, STAFF, { item_id: it, from: 'warehouse', to: b, quantity: 5, unplanned_reason: 'slab' });
  eq(await bills(db), [], 'pending: nothing to check yet');
  await cdecide(db, OWNER, r.cost_moves[0], true);
  const g = await bills(db);
  eq(g.map(x => [x.change, x.kind, x.item, num(x.quantity), num(x.value), x.from, x.to, x.checked]),
     [['approved', 'transfer', 'Cement', 5, 500, 'Barlin', 'Bagong', false]]);
  const month = (await one(db, `select rec_period_label(id) l from projects where folder_id = $1`, [a])).l;
  eq(g[0].sides.map(s => [s.project, s.period, s.cover, num(s.amount)]),
     [['Barlin', month, false, -300], ['Barlin', month, true, -200], ['Bagong', (await one(db, `select rec_period_label(id) l from projects where folder_id = $1`, [b])).l, false, 500]]);
  await refused(tick(db, OWNER, g[0].cost_move_id, g[0].group, true, 'x'.repeat(501)), 'BAD_NOTE');
  await tick(db, OWNER, g[0].cost_move_id, g[0].group, true, 'Barlin bill #3 credited ₱500');
  let t = (await bills(db))[0];
  eq([t.checked, t.note, t.checked_by !== null], [true, 'Barlin bill #3 credited ₱500', true]);
  await tick(db, OWNER, g[0].cost_move_id, g[0].group, false, 'wrong bill');
  t = (await bills(db))[0];
  eq([t.checked, t.note], [false, 'wrong bill']);
});

await test('a reversal is its own item: the rows it removed, on the same months; the approval keeps its tick', async () => {
  const db = await fresh();
  const it = await item(db, 'Cement');
  const f = await folder(db, 'Barlin'); await period(db, f);
  await stocked(db, it, 10);
  const r = await move(db, STAFF, { item_id: it, from: 'warehouse', to: f, quantity: 4, unplanned_reason: 'slab' });
  await cdecide(db, OWNER, r.cost_moves[0], true);
  const g1 = (await bills(db))[0];
  await tick(db, OWNER, g1.cost_move_id, g1.group);
  await creverse(db, OWNER, r.cost_moves[0]);
  const g = await bills(db);
  eq(g.map(x => [x.change, x.checked, x.sides.map(s => num(s.amount))]), [['reversed', false, [-400]], ['approved', true, [400]]]);
  assert(g[0].group !== g[1].group, 'two items');
});

await test('a cost from an earlier month, moved and then reversed later: two items, each naming that month\'s billing period — after the reversal deleted its rows', async () => {
  const db = await fresh();
  const it = await item(db, 'Cement');
  const a = await folder(db, 'Barlin'); const old = await periodOn(db, a, phDate(-60), 600);   // ₱600 then: ₱1,000 bought → ₱400 Cover
  const b = await folder(db, 'Bagong'); const now = await period(db, b);
  const r0 = await request(db, a, { item: it, quantity: 10 });
  const pj = await projectBuy(db, a, 'Cement', 10, { requestLine: r0.line, date: phDate(-60) });
  await leftover(db, STAFF, pj, 1, 5, 'warehouse');
  const r = await move(db, STAFF, { item_id: it, from: 'warehouse', to: b, quantity: 5, unplanned_reason: 'slab' });
  await cdecide(db, OWNER, r.cost_moves[0], true);
  await creverse(db, OWNER, r.cost_moves[0]);
  eq(num((await one(db, `select count(*) n from expenses where stk_cost_move_id = $1`, [r.cost_moves[0]])).n), 0, 'the reversal deleted its rows');
  const g = await bills(db);
  const sides = (x) => x.sides.map(s => [s.period_id, s.folder_id, s.cover, num(s.amount)]).sort((p, q) => p[3] - q[3]);
  eq(g.map(x => x.change), ['reversed', 'approved']);
  eq(sides(g[1]), [[old, a, false, -300], [old, a, true, -200], [now, b, false, 500]], 'approved: off the earlier month (period and Cover), onto Bagong');
  eq(sides(g[0]), [[now, b, false, -500], [old, a, true, 200], [old, a, false, 300]], 'reversed: the same months, the other way');
  assert(new Date(g[0].at) >= new Date(g[1].at), 'the reversal is the later item');
});

await test('cost moves approved before 0109 appear once, from their rows', async () => {
  const db = await fresh({ no109: true });
  const it = await item(db, 'Cement');
  const f = await folder(db, 'Barlin'); await period(db, f);
  await stocked(db, it, 10);
  const r = await move(db, STAFF, { item_id: it, from: 'warehouse', to: f, quantity: 3, unplanned_reason: 'slab' });
  await cdecide(db, OWNER, r.cost_moves[0], true);
  await db.exec(M109);
  const g = await bills(db);
  eq(g.map(x => [x.change, x.group, x.sides.map(s => num(s.amount))]), [['approved', '0:added', [300]]]);
  await db.exec(M109);                                                     // run twice: still once
  eq((await bills(db)).length, 1);
});

await test('the log and the ticks are history; a tick needs a real group; staff refused; plain expenses are not logged', async () => {
  const db = await fresh();
  const it = await item(db, 'Cement');
  const f = await folder(db, 'Barlin'); await period(db, f);
  await projectBuy(db, f, 'Sand', 1);
  eq(num((await one(db, `select count(*) n from rec_cost_row_log`)).n), 0, 'a purchase writes no log');
  await stocked(db, it, 10);
  const r = await move(db, STAFF, { item_id: it, from: 'warehouse', to: f, quantity: 4, unplanned_reason: 'slab' });
  await cdecide(db, OWNER, r.cost_moves[0], true);
  const g = (await bills(db))[0];
  await tick(db, OWNER, g.cost_move_id, g.group);
  await refused(db.query(`delete from rec_cost_row_log`), 'HISTORY_LOCKED');
  await refused(db.query(`update rec_cost_row_log set amount = 0`), 'HISTORY_LOCKED');
  await refused(db.query(`delete from rec_bill_checks`), 'HISTORY_LOCKED');
  await refused(tick(db, OWNER, g.cost_move_id, '999999:added'), 'NOT_FOUND');
  await refused(tick(db, OWNER, g.cost_move_id, g.group.replace(':added', ':removed')), 'NOT_FOUND');
  await refused(tick(db, OWNER, g.cost_move_id, 'abc'), 'BAD_STATE');
  await refused(tick(db, OWNER, g.cost_move_id, '12'), 'BAD_STATE');
  await refused(tick(db, STAFF, g.cost_move_id, g.group), 'OWNER_ONLY');
  await refused(tick(db, OTHER, g.cost_move_id, g.group), 'NOT_FOUND');
});

// ── E. Money still out (Q9) ──────────────────────────────────────────

await test('owed by supplier: Unpaid and Partly paid balances; untracked purchases apart, never owed; payments never change Spent', async () => {
  const db = await fresh();
  const f = await folder(db, 'Barlin'); await period(db, f);
  const a = await projectBuy(db, f, 'Cement', 10);                         // ₱1,000 Unpaid (Wilcon)
  const b = await projectBuy(db, f, 'Sand', 5);                            // ₱500
  const c = (await record(db, { ...body([{ folder_id: f, item_name: 'Nails', quantity: 1, amount: 80 }]), supplier: '' })).purchase_id;
  const d = await projectBuy(db, f, 'Tiles', 1, { amount: 5000 });
  await db.query(`update purchases set payments_tracked = false where id = $1`, [d]);           // as before 2A-4: not tracked
  const before = await rowsPrint(db);
  await rpc(db, OWNER, 'pur_pay', [op(), b, JSON.stringify(P(300))]);
  const m = await moneyOut(db);
  eq(m.owed.map(x => [x.supplier, num(x.purchases), num(x.partly_paid), num(x.balance)]),
     [['Wilcon', 2, 1, 1200], ['No supplier recorded', 1, 0, 80]]);
  eq([num(m.not_tracked.purchases), num(m.not_tracked.total)], [1, 5000]);
  eq(await rowsPrint(db), before, 'a payment changes no expense row');
  void a; void c;
});

await test('supplier credit left; Overpaid and the buyers\' cash reach the main owner only', async () => {
  const db = await fresh();
  const f = await folder(db, 'Barlin'); await period(db, f);
  await as(db, OWNER);
  const sup = (await one(db, `select pur_save_supplier(null, 'Citi Hardware', 'Pasig', '', true) s`)).s.id;
  const a = (await record(db, { ...body([{ folder_id: f, item_name: 'Cement', quantity: 10, amount: 1000 }]), supplier: '', supplier_id: sup })).purchase_id;
  await rpc(db, OWNER, 'pur_pay', [op(), a, JSON.stringify(P(1300))]);                                  // ₱300 over
  await db.query(`select pur_cash_give($1, $2, '5000', $3, 'cash', '')`, [op(), BUYER, phDate()]);
  let m = await moneyOut(db);
  eq([num(m.overpaid.purchases), num(m.overpaid.amount)], [1, 300]);
  eq(m.buyers.map(x => [x.name, num(x.cash_held), num(x.shortfall), num(x.owed_to_buyer)]), [['Juan', 5000, 0, 0]]);
  await rpc(db, OWNER, 'pur_resolve_overpaid', [op(), a, JSON.stringify([]), JSON.stringify({ amount: '300', note: 'kept as credit' })]);
  m = await moneyOut(db);
  eq(m.credits.map(x => [x.supplier, num(x.credits), num(x.left)]), [['Citi Hardware · Pasig', 1, 300]]);
  eq([num(m.overpaid.purchases)], [0]);
  const sub = await moneyOut(db, EXPOWNER);
  eq(['overpaid', 'buyers'].map(k => k in sub), [false, false], 'not the main owner: no cash keys');
});

// ── F. The confirmed-payments script (Q8, Task 5) ───────────────────
// The script as committed — only its main owner, its list and its dry-run
// switch are filled in here, the same three lines the user would change.
const PAYSCRIPT = read(path.join(ROOT, 'supabase/tests/4_confirmed_payments.sql'));
async function payScript(db, confirm, dry = true) {
  let s = PAYSCRIPT;
  const swap = (a, b) => { assert(s.split(a).length === 2, 'script line: ' + a); s = s.replace(a, b); };
  swap(`v_main constant uuid := '869c0be7-da92-44d4-a2b1-03dac7fed7e9';`, `v_main constant uuid := '${OWNER}';`);
  swap(`v_confirm constant jsonb := $c$\n[]\n$c$;`, `v_confirm constant jsonb := $c$\n${JSON.stringify(confirm)}\n$c$;`);
  if (!dry) swap('\n  v_dry boolean := true;\n', '\n  v_dry boolean := false;\n');
  await db.exec(`select set_config('test.uid', '', false)`);
  return code(db.exec(s));
}
const confirmOf = (pid, total, extra = {}) => ({ ref: pid.slice(0, 8), expect_total: total.toFixed(2), paid_on: phDate(),
  amount: total.toFixed(2), source: 'company', person_email: null, method: 'bank_transfer', note: 'confirmed by the owner', ...extra });
async function payPrint(db) {
  return one(db, `select count(*) n, coalesce(sum(amount), 0) s from pur_payments`);
}

await test('the payments script as shipped: nothing confirmed → refused, nothing changed', async () => {
  const db = await fresh();
  const f = await folder(db, 'Barlin'); await period(db, f);
  await projectBuy(db, f, 'Cement', 10);
  const before = [await rowsPrint(db), await payPrint(db)];
  const s = PAYSCRIPT;
  assert(s.includes('v_confirm constant jsonb := $c$\n[]\n$c$;'), 'the committed list is empty');
  assert(s.includes('\n  v_dry boolean := true;\n'), 'the committed script is a dry run');
  await db.exec(`select set_config('test.uid', '', false)`);
  const got = await code(db.exec(s.replace(`'869c0be7-da92-44d4-a2b1-03dac7fed7e9'`, `'${OWNER}'`)));
  assert(got.includes('NOTHING CONFIRMED'), got);
  eq([await rowsPrint(db), await payPrint(db)], before);
});

await test('the payments script refuses, changing nothing: a wrong total, an unknown code, a payment already there, bad dates, too much, a duplicate, a missing method, petty cash with no buyer, a voided purchase', async () => {
  const db = await fresh();
  const f = await folder(db, 'Barlin'); await period(db, f);
  const a = await projectBuy(db, f, 'Cement', 10);            // ₱1,000
  const b = await projectBuy(db, f, 'Sand', 5);               // ₱500
  const v = await projectBuy(db, f, 'Gravel', 1);
  await rpc(db, OWNER, 'pur_pay', [op(), b, JSON.stringify(P(100))]);
  await as(db, BUYER); await db.query(`select pur_void($1, $2, 'duplicate')`, [op(), v]);
  const before = [await rowsPrint(db), await payPrint(db)];
  const cases = [
    [[confirmOf(a, 999)], 'totals 1000.00 now'],
    [[{ ...confirmOf(a, 1000), ref: 'ffffffff' }], 'matches 0 purchases'],
    [[confirmOf(b, 500)], 'already has a payment'],
    [[confirmOf(a, 1000, { paid_on: phDate(-3) })], 'before its purchase date'],
    [[confirmOf(a, 1000, { paid_on: phDate(2) })], 'in the future'],
    [[confirmOf(a, 1000, { amount: '1000.01' })], 'at most its total'],
    [[confirmOf(a, 1000), confirmOf(a, 1000)], 'listed twice'],
    [[{ ...confirmOf(a, 1000), method: undefined }], 'missing a field'],
    [[confirmOf(a, 1000, { method: 'GCash' })], 'missing a field'],
    [[confirmOf(a, 1000, { source: 'petty_cash' })], 'needs the staff buyer'],
    [[confirmOf(v, 100)], 'is voided'],
    [[confirmOf(a, 1000), confirmOf(v, 100)], 'is voided'],
  ];
  for (const [list, want] of cases) {
    const got = await payScript(db, list, false);
    assert(got.includes(want), want + ': got ' + got);
    eq([await rowsPrint(db), await payPrint(db)], before, want + ': nothing changed');
  }
});

await test('the payments script: a dry run records nothing; the real run records exactly the confirmed payments — Spent unchanged, a second run refused', async () => {
  const db = await fresh();
  const f = await folder(db, 'Barlin'); await period(db, f);
  const a = await projectBuy(db, f, 'Cement', 10);            // ₱1,000 — confirmed paid in full
  const b = await projectBuy(db, f, 'Sand', 5);               // ₱500   — confirmed ₱200 paid by the buyer's own money
  const c = await projectBuy(db, f, 'Nails', 1);              // ₱100   — not confirmed: stays Unpaid
  const list = [confirmOf(a, 1000, { paid_on: phDate() }),
                confirmOf(b, 500, { amount: '200.00', source: 'own_money', person_email: 'juan@dacs.test', method: 'gcash' })];
  const before = [await rowsPrint(db), await payPrint(db)];
  const dry = await payScript(db, list, true);
  assert(dry.includes('DRY RUN OK') && dry.includes('2 confirmed payment(s)'), dry);
  eq([await rowsPrint(db), await payPrint(db)], before, 'the dry run undid everything');
  const real = await payScript(db, list, false);
  eq(real, 'no error');
  eq(await rowsPrint(db), before[0], 'not one expense row changed');
  const st = async (pid) => (await one(db, `select pur_pay_state($1) s`, [pid])).s;
  eq([(await st(a)).state, (await st(b)).state, (await st(c)).state], ['paid', 'partial', 'unpaid']);
  eq((await all(db, `select source, method, amount, created_by from pur_payments order by amount desc`)).map(r => [r.source, r.method, num(r.amount), r.created_by]),
     [['company', 'bank_transfer', 1000, OWNER], ['own_money', 'gcash', 200, OWNER]]);
  const again = await payScript(db, list, false);
  assert(again.includes('already has a payment'), again);
});

// ── G. The live check (Q14) ─────────────────────────────────────────
const LIVECHECK = read(path.join(ROOT, 'supabase/tests/4_live_check.sql'));
async function liveCheck(db) {
  await db.exec(`select set_config('test.uid', '', false)`);
  const sql = LIVECHECK.replace(`'869c0be7-da92-44d4-a2b1-03dac7fed7e9'`, `'${OWNER}'`);
  assert(sql !== LIVECHECK, 'the check names admin@');
  const res = await db.exec(sql);
  return res.flatMap(r => r.rows || []).filter(r => r && 'check_name' in r);
}

await test('the live check: on a busy day of stock moves every check holds; it reads only', async () => {
  const db = await fresh();
  const it = await item(db, 'Cement');
  const a = await folder(db, 'Barlin'); await period(db, a, 700);
  const b = await folder(db, 'Bagong'); await period(db, b, 250);
  const w = await warehouseBuy(db, 'Cement', 10, { amount: 1000 });
  await match(db, STAFF, w, 1, it, 10); await receive(db, BUYER, w, 1, 10);
  const r0 = await request(db, a, { item: it, quantity: 9 });
  const pj = await projectBuy(db, a, 'Cement', 9, { requestLine: r0.line, amount: 999.99 });
  await leftover(db, STAFF, pj, 1, 4, 'warehouse');
  const ok = async (rec) => { for (const id of rec.cost_moves) await cdecide(db, OWNER, id, true); };
  await ok(await move(db, STAFF, { item_id: it, from: 'warehouse', to: a, quantity: 5, unplanned_reason: 'x' }));
  await ok(await move(db, STAFF, { item_id: it, from: 'warehouse', to: b, quantity: 6, unplanned_reason: 'x' }));
  const back = await move(db, STAFF, { item_id: it, from: b, to: 'warehouse', quantity: 2 });
  await ok(back);
  await creverse(db, OWNER, back.cost_moves[0]);
  await uncovered(db, 'Eagle');
  const before = await rowsPrint(db);
  const rows = await liveCheck(db);
  eq(rows.length, 6);
  for (const r of rows) eq([r.check_name, r.ok, r.detail], [r.check_name, true, r.detail]);
  assert(/lines waiting for a billing period: 1/.test(rows[5].check_name), rows[5].check_name);
  eq(await rowsPrint(db), before, 'read only');
});

await test('the live check catches a stray row (C2) and a cost-move row removed behind the log\'s back (C1, C4)', async () => {
  const db = await fresh();
  const it = await item(db, 'Cement');
  const f = await folder(db, 'Barlin'); const per = await period(db, f);
  await stocked(db, it, 10);
  const r = await move(db, STAFF, { item_id: it, from: 'warehouse', to: f, quantity: 4, unplanned_reason: 'slab' });
  await cdecide(db, OWNER, r.cost_moves[0], true);
  const pid = await projectBuy(db, f, 'Sand', 1);
  const line = (await one(db, `select id from purchase_lines where purchase_id = $1`, [pid])).id;
  await db.exec(`alter table expenses disable trigger expenses_purchase_guard`);
  await db.query(`insert into expenses (owner_id, project_id, amount, purchase_line_id) values ($1, $2, 25, $3)`, [OWNER, per, line]);
  let rows = await liveCheck(db);
  eq(rows.map(x => x.ok), [true, false, true, true, true, true], 'C2: the stray row');
  await db.query(`delete from expenses where purchase_line_id = $1 and amount = 25`, [line]);
  await db.exec(`alter table expenses disable trigger rec_log_cost_rows_del`);
  await db.query(`delete from expenses where stk_cost_move_id = $1`, [r.cost_moves[0]]);
  await db.exec(`alter table expenses enable trigger rec_log_cost_rows_del`);
  await db.exec(`alter table expenses enable trigger expenses_purchase_guard`);
  rows = await liveCheck(db);
  eq(rows.map(x => x.ok), [false, false, true, false, true, true], 'C1, C2 and C4: rows gone while the cost move stands');
});

// ── H. The pilot's guarded clean-up (4_pilot_cleanup.sql) ───────────
const CLEAN = read(path.join(ROOT, 'supabase/tests/4_pilot_cleanup.sql'));
async function stubs(db) {
  await db.exec(`
    create table if not exists construction_projects (id uuid primary key default gen_random_uuid(), folder_id uuid references folders(id) on delete set null);
    create table if not exists wp_tasks (id uuid primary key default gen_random_uuid(), folder_id uuid references folders(id), work_folder_id uuid references folders(id));
    create table if not exists wp_blockers (id uuid primary key default gen_random_uuid(), request_id uuid references pr_requests(id));
    create table if not exists overhead_expenses (id uuid primary key default gen_random_uuid(), folder_id uuid references folders(id) on delete cascade,
      billing_period_id uuid references projects(id) on delete set null, amount numeric);
    create table if not exists reimbursements (id uuid primary key default gen_random_uuid(), folder_id uuid references folders(id) on delete cascade);
    create table if not exists labor_contracts (id uuid primary key default gen_random_uuid(), folder_id uuid references folders(id) on delete cascade);
    create table if not exists pr_line_conflicts (id uuid primary key default gen_random_uuid(), line_id uuid references pr_lines(id));
    create table if not exists pr_item_refs (id uuid primary key default gen_random_uuid(), catalog_item_id uuid references pr_catalog_items(id),
      folder_id uuid references folders(id) on delete cascade);
    create table if not exists pr_gallery_photos (id uuid primary key default gen_random_uuid(), catalog_item_id uuid references pr_catalog_items(id));`);
}
const cleanup = (db, real = false) => {
  const run = real ? CLEAN.replace(/^  v_dry boolean := true;$/m, '  v_dry boolean := false;') : CLEAN;
  assert(!real || run !== CLEAN, 'the setting line is in the file');
  return db.exec(run);
};
async function snap4(db) {
  return one(db, `select (select count(*) from folders) folders, (select count(*) from projects) periods,
                         (select count(*) from pr_catalog_items) items, (select count(*) from purchases) purchases,
                         (select count(*) from expenses) exp_n, (select coalesce(sum(amount), 0) from expenses) exp_sum,
                         (select count(*) from pur_payments) pays, (select count(*) from pur_money_events) mev,
                         (select count(*) from stk_records) recs, (select count(*) from stk_cost_moves) cms,
                         (select count(*) from rec_cover_marks) marks, (select count(*) from rec_cost_row_log) log,
                         (select count(*) from rec_bill_checks) ticks`);
}
// The Stage 4 pilot (Q14) beside real data: a real purchase paid, a real
// "Cover is right" mark, a real cost move approved and ticked.
async function pilot4() {
  const db = await fresh();
  await stubs(db);
  const it = await item(db, 'Cement');
  const house = await folder(db, 'House'); await period(db, house);
  const realPaid = await projectBuy(db, house, 'Tiles', 1, { amount: 3360 });
  await rpc(db, OWNER, 'pur_pay', [op(), realPaid, JSON.stringify(P(3360))]);
  const real = await uncovered(db, 'Eagle Residence');
  await accept(db, OWNER, real.pid, 1, 'Real: no client allocation');
  const realLot = await stocked(db, it, 10);
  const rm = await move(db, STAFF, { item_id: it, from: 'warehouse', to: house, quantity: 2, unplanned_reason: 'real' });
  await cdecide(db, OWNER, rm.cost_moves[0], true);
  const rg = (await bills(db))[0];
  await tick(db, OWNER, rg.cost_move_id, rg.group, true, 'real bill');
  // ZZ
  const A = await folder(db, 'ZZ 4 pilot A'); await periodOn(db, A, phDate(-100));
  const B = await folder(db, 'ZZ 4 pilot B'); await period(db, B);
  const zi = await item(db, 'ZZ 4 pilot cement');
  await as(db, OWNER);
  const paid = (await one(db, `select pur_record($1, $2::jsonb) r`, [op(), JSON.stringify({
    ...body([{ folder_id: A, item_name: 'ZZ 4 pilot paint', quantity: 1, amount: 344 }]),
    source: 'expenses_form', supplier: 'ZZ 4 pilot supplier', payments: [P(344, { method: 'gcash' })] })])).r.purchase_id;
  const zc = await accept(db, OWNER, paid, 1, 'ZZ pilot');
  await withdraw(db, OWNER, zc.mark_id, 'ZZ pilot');
  await accept(db, OWNER, paid, 1, 'ZZ pilot again');
  const zw = await stocked(db, zi, 10, { name: 'ZZ 4 pilot cement' });
  const zm = await move(db, STAFF, { item_id: zi, from: 'warehouse', to: B, quantity: 4, unplanned_reason: 'ZZ' });
  await cdecide(db, OWNER, zm.cost_moves[0], true);
  const zg = (await bills(db)).find(x => x.cost_move_id === zm.cost_moves[0]);
  await tick(db, OWNER, zg.cost_move_id, zg.group, true, 'ZZ');
  await creverse(db, OWNER, zm.cost_moves[0]);
  const cnt = await count(db, STAFF, { item_id: zi, at: 'warehouse', counted: 9, reason: 'damaged' });
  if (cnt.status === 'pending') await decide(db, OWNER, cnt.record_id, true);
  await as(db, '');
  return { db, it, house, realPaid, realLot, real, A, B, zi, paid, zw, rm };
}
await test('the pilot clean-up: the dry run changes nothing; the real run removes only ZZ — real payments, marks, ticks, log and money stay; guards back on', async () => {
  const p = await pilot4();
  const db = p.db;
  const before = await snap4(db);
  const realRows = await one(db, `select count(*) n, coalesce(sum(amount), 0) s from expenses e left join projects pp on pp.id = e.project_id
                                   where coalesce(e.folder_id, pp.folder_id) not in (select id from folders where name like 'ZZ 4 pilot%')`);
  await refused(cleanup(db), 'DRY RUN OK', 'the dry run');
  eq(await snap4(db), before, 'nothing changed');
  await cleanup(db, true);
  eq(num((await one(db, `select count(*) n from folders where name like 'ZZ 4 pilot%'`)).n), 0);
  eq(num((await one(db, `select count(*) n from pr_catalog_items where name like 'ZZ 4 pilot%'`)).n), 0);
  eq((await all(db, `select id from purchases`)).map(r => r.id).sort(), [p.realPaid, p.real.pid, p.realLot].sort(), 'the three real purchases stay');
  eq(num((await one(db, `select count(*) n from pur_payments`)).n), 1, 'the real payment stays');
  eq(num((await one(db, `select count(*) n from rec_cover_marks`)).n), 1, 'the real mark stays');
  eq(num((await one(db, `select count(*) n from rec_bill_checks`)).n), 1, 'the real tick stays');
  eq(num((await one(db, `select count(*) n from rec_cost_row_log`)).n), 1, "the real cost move's log row stays");
  const after = await one(db, `select count(*) n, coalesce(sum(amount), 0) s from expenses`);
  eq([num(after.n), num(after.s)], [num(realRows.n), num(realRows.s)], 'real expense rows as they were');
  eq(num((await one(db, `select count(*) n from pg_trigger where tgname in ('stk_events_no_change', 'stk_moves_no_change', 'stk_covers_no_change',
      'pur_money_events_immutable_trg', 'rec_cost_row_log_locked', 'rec_bill_checks_locked', 'rec_cover_marks_guard') and tgenabled = 'O'`)).n), 7,
     'guards back on');
  await refused(db.query(`delete from rec_cover_marks`), 'HISTORY_LOCKED', 'and they hold');
  await refused(cleanup(db), 'no project named', 'a second run finds nothing');
});
await test("the clean-up stops (and changes nothing) when ZZ and real are mixed, or a ZZ payment came from a buyer's cash", async () => {
  for (const [why, spoil, want] of [
    ['a ZZ purchase paid from petty cash', async (p) => {
      await rpc(p.db, OWNER, 'pur_pay', [op(), p.zw, JSON.stringify(P(100, { source: 'petty_cash', person_id: BUYER }))]); },
     'came from petty cash'],
    ['ZZ goods moved onto a real project', async (p) => {
      await move(p.db, STAFF, { item_id: p.zi, from: 'warehouse', to: p.house, quantity: 1, unplanned_reason: 'x' }); },
     'real'],
    ['a real purchase line on a ZZ project', async (p) => {
      await as(p.db, BUYER);
      await p.db.query(`select pur_record($1, $2::jsonb)`, [op(), JSON.stringify(body([{ folder_id: p.house, item_name: 'Sand', quantity: 1, amount: 50 },
                                                                                      { folder_id: p.A, item_name: 'ZZ 4 pilot sand', quantity: 1, amount: 50 }]))]); },
     'also has a real line'],
  ]) {
    const p = await pilot4();
    await spoil(p);
    await as(p.db, '');
    const before = await snap4(p.db);
    await refused(cleanup(p.db, true), want, why);
    eq(await snap4(p.db), before, why + ': nothing changed');
  }
});

// ── I. Add Expense's saves, settled even if the browser loses one (R120) ──

const reserve = (db, who, id) => rpc(db, who, 'pur_op_reserve', [id]);
const recover = (db, who) => rpc(db, who, 'pur_op_recover', []);
const opState = (db, who, id) => rpc(db, who, 'pur_op_state', [id]);
const settled = (r) => [r.cancelled, r.recorded];         // [cancelled, recorded]
// An Add Expense save — the purchase and its "Paid now?" payment in one pur_record.
async function addExpense(db, f, id, amount, who = OWNER) {
  await as(db, who);
  return (await one(db, `select pur_record($1, $2::jsonb) r`, [id, JSON.stringify({ ...body([{ folder_id: f, item_name: 'Glue', quantity: 1, amount }]),
    source: 'expenses_form', payments: [P(amount)] })])).r;
}
const tally = async (db) => ({ purchases: num((await one(db, `select count(*) n from purchases where status = 'recorded'`)).n),
                               payments: num((await one(db, `select count(*) n from pur_payments`)).n) });

await test('Add Expense: ids registered before sending; with the browser\'s copy unreadable, recovery cancels every unsettled save — its first request arriving after the list was checked is refused', async () => {
  const db = await fresh();
  const f = await folder(db, 'Barlin'); await period(db, f);
  const a = op(), b = op(), c = op();
  await reserve(db, OWNER, a);
  await reserve(db, OWNER, a);                                    // registered again: harmless
  await reserve(db, OWNER, b);
  await reserve(db, OWNER, c);
  await addExpense(db, f, a, 60);                                 // a reached the server (its reply lost); b never did; c is still on its way
  const listed = await tally(db);                                 // "the list": a only — b and c are absent, which proves nothing
  eq(listed, { purchases: 1, payments: 1 });
  eq(settled(await recover(db, OWNER)), [2, 0], 'b and c cancelled for good; a was settled already');
  eq([await opState(db, OWNER, a), await opState(db, OWNER, b), await opState(db, OWNER, c)], ['recorded', 'cancelled', 'cancelled']);
  await refused(addExpense(db, f, c, 40), 'OP_CANCELLED', 'c\'s first request, arriving after the list was checked');
  await refused(addExpense(db, f, b, 80), 'OP_CANCELLED', 'b, arriving even later');
  eq(await tally(db), listed, 'nothing recorded by the late requests — no purchase, no payment');
  eq(settled(await recover(db, OWNER)), [0, 0], 'nothing left to settle');
  const d = op();
  await reserve(db, OWNER, d);
  await addExpense(db, f, d, 40);                                 // entered again: once
  eq(await tally(db), { purchases: 2, payments: 2 });
});

await test('Add Expense recovery is per account: another account\'s unsettled save — even under the same id — is untouched', async () => {
  const db = await fresh();
  const f = await folder(db, 'Barlin'); await period(db, f);
  const x = op();
  await reserve(db, OWNER, x);
  await reserve(db, STAFF, x);                                    // the same id from another account is another operation
  eq(settled(await recover(db, STAFF)), [1, 0]);
  eq([await opState(db, STAFF, x), await opState(db, OWNER, x)], ['cancelled', 'none']);
  await addExpense(db, f, x, 60, OWNER);                          // the owner's save still records — once
  eq([await opState(db, OWNER, x), (await tally(db)).purchases], ['recorded', 1]);
  eq(settled(await recover(db, OWNER)), [0, 0], 'recorded before recovery: never cancelled');
});

await test('Add Expense registration and recovery: accounts that may use Add Expense only; a missing id refused', async () => {
  const db = await fresh();
  for (const [who, want] of [[WORKER, 'NOT_OFFICE'], [LEADER, 'NOT_OFFICE'], ['', 'NOT_OFFICE'], [PMOWNER, 'NOT_ALLOWED'], [PMSTAFF, 'NOT_ALLOWED']]) {
    await refused(reserve(db, who, op()), want, 'register as ' + (who || 'nobody'));
    await refused(recover(db, who), want, 'recover as ' + (who || 'nobody'));
  }
  await refused(reserve(db, OWNER, null), 'BAD_OP');
  for (const who of [OWNER, STAFF, BUYER, EXPOWNER]) await reserve(db, who, op());
  eq(num((await one(db, `select count(*) n from pur_op_reservations`)).n), 4);
});

// ── J. Permissions ───────────────────────────────────────────────────

await test('permissions: the ten calls for authenticated only; helpers are internal; the four tables have RLS and no policy', async () => {
  const db = await fresh();
  for (const f of ['rec_purchase_places(text,text)', 'rec_waiting()', 'rec_review_lines()', 'rec_bills()', 'rec_money_out()',
                   'rec_accept_cover(uuid,uuid,integer,text)', 'rec_withdraw_cover(uuid,uuid,text)',
                   'rec_bill_check(uuid,uuid,text,boolean,text)', 'pur_op_reserve(uuid)', 'pur_op_recover()']) {
    eq([f, (await one(db, `select has_function_privilege('authenticated', $1, 'execute') x`, [f])).x,
        (await one(db, `select has_function_privilege('anon', $1, 'execute') x`, [f])).x], [f, true, false]);
  }
  for (const f of ['rec_owner()', 'rec_cover_marks_guard()', 'rec_history_locked()', 'rec_row_folder(uuid,uuid)', 'rec_log_cost_rows()',
                   'rec_line_value(uuid)', 'rec_line_key(uuid,integer)', 'rec_mark_current(uuid)', 'rec_period_label(uuid)',
                   'rec_bill_groups(uuid)']) {
    eq([f, (await one(db, `select has_function_privilege('authenticated', $1, 'execute') x`, [f])).x], [f, false]);
  }
  for (const t of ['rec_cover_marks', 'rec_cost_row_log', 'rec_bill_checks', 'pur_op_reservations']) {
    const r = await one(db, `select relrowsecurity rls, (select count(*) from pg_policies where tablename = $1) n from pg_class where relname = $1`, [t]);
    eq([t, r.rls, num(r.n)], [t, true, 0]);
  }
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) { console.log('\nFAILURES:\n  ' + failures.join('\n  ')); process.exit(1); }
