// ════════════════════════════════════════════════════════════════════
// STAGE 2B-b (THE PHONE) — SERVER TESTS ON PGLITE
//   npm run test:sql
//
// Runs migrations 0096 … 0105 and 0106 VERBATIM on PGlite over the 2C
// suite's tables and helpers:
//   A. "From stock" on the workers' requests (0106's pr_my_requests);
//   B. the joint pilot's guarded clean-up (2bc_pilot_cleanup.sql), run on a
//      whole simulated pilot beside real data.
// Nothing here talks to the live database.
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
// --with-0107: and 3a's 0107 (tools) on top, switched ON — every behaviour here holds.
const WITH_0107 = process.argv.includes('--with-0107');
const M107 = WITH_0107 ? mig('0107_tools.sql') : '';
const M106 = mig('0106_workmate_phone_stock.sql');
const M85 = mig('0085_workmate_requests.sql');
const M51 = mig('0051_attendance_worker_owner.sql');
const CLEAN = read(path.join(ROOT, 'supabase/tests/2bc_pilot_cleanup.sql'));
// What 0085's pr_my_requests reads beyond the 2C base: teams, photos, who asks.
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
  if (WITH_0107) await db.exec(M107);
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

// ── 2B-b helpers ──────────────────────────────────────────────────────
const myRequests = async (db, who) => { await as(db, who); return (await one(db, `select pr_my_requests(100) x`)).x; };
const lineOf = (doc, lineId) => doc.flatMap(r => r.lines).find(l => l.id === lineId);
const issue = (db, who, it, to, qty, extra = {}) => move(db, who, { item_id: it, from: 'warehouse', to, quantity: qty, ...extra });
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
// The clean-up as the user runs it: the file, then (2nd run) with v_dry false.
const cleanup = (db, real = false) => {
  if (!real) return db.exec(CLEAN);
  const run = CLEAN.replace(/^  v_dry boolean := true;$/m, '  v_dry boolean := false;');
  assert(run !== CLEAN, 'the setting line is in the file');
  return db.exec(run);
};
async function state(db) {
  return one(db, `select (select count(*) from folders) folders, (select count(*) from projects) periods,
    (select count(*) from pr_catalog_items) items, (select count(*) from purchases) purchases, (select count(*) from purchase_lines) lines,
    (select count(*) || '/' || coalesce(sum(amount), 0) from expenses) expenses, (select count(*) from stk_records) records,
    (select count(*) from stk_moves) moves, (select count(*) from stk_cost_moves) cost_moves, (select count(*) from stk_events) events,
    (select count(*) from stk_covers) covers, (select count(*) from stk_lots) lots, (select count(*) from stk_locations) places,
    (select count(*) from pr_requests) requests, (select count(*) from pr_lines) req_lines, (select count(*) from suppliers) suppliers`);
}

console.log('\n2B-b phone (0096 + 0097 + 0101 + 0102 + 0103 + 0104 + 0105 + 0106 on PGlite)');

// ── A. "From stock" on the workers' requests (0106, Q26) ─────────────

await test('a worker sees "From stock" on their request line and portion once the office issues it; 0 before', async () => {
  const db = await fresh();
  const it = await item(db, 'Cement');
  const f = await folder(db, 'Barlin'); await period(db, f);
  await stocked(db, it, 10);
  const r = await request(db, f, { item: it, quantity: 6 });
  let l = lineOf(await myRequests(db, WORKER), r.line);
  eq([num(l.from_stock), l.portions.map(p => num(p.from_stock))], [0, [0]], 'nothing issued yet');
  await issue(db, STAFF, it, f, 4, { request_line_id: r.line });
  l = lineOf(await myRequests(db, WORKER), r.line);
  eq([num(l.from_stock), l.portions.map(p => num(p.from_stock)), num(l.needed)], [4, [4], 6], '4 of the 6 from stock; still needed as asked');
});

await test('each weekly portion says what stock filled of it, not the whole line\'s', async () => {
  const db = await fresh();
  const it = await item(db, 'Cement');
  const f = await folder(db, 'Barlin'); await period(db, f);
  await stocked(db, it, 10);
  const r = await request(db, f, { item: it, quantity: 3 });
  const later = (await one(db, `select pr_batch_for($1, now() + interval '8 days') b`, [OWNER])).b;
  assert(later !== r.batch, 'a later weekly batch');
  await db.query(`insert into pr_line_portions (owner_id, line_id, batch_id, quantity) values ($1, $2, $3, 3)`, [OWNER, r.line, later]);
  await issue(db, STAFF, it, f, 4, { request_line_id: r.line });
  const l = lineOf(await myRequests(db, WORKER), r.line);
  const parts = l.portions.map(p => num(p.from_stock));
  eq([num(l.from_stock), parts.length, parts.reduce((a, b) => a + b, 0)], [4, 2, 4], 'the line 4, its two portions 4 between them');
  assert(parts.every(x => x < 4), 'no portion shows the whole line: ' + JSON.stringify(parts));
});

await test('a team leader sees "From stock" on a member\'s request too; another worker sees nothing of it', async () => {
  const db = await fresh();
  const it = await item(db, 'Cement');
  const f = await folder(db, 'Barlin'); await period(db, f);
  await stocked(db, it, 10);
  const team = (await one(db, `insert into pr_teams (owner_id, name) values ($1, 'Masons') returning id`, [OWNER])).id;
  await db.query(`insert into pr_team_members (owner_id, team_id, worker_id, is_leader) values ($1, $2, $3, false), ($1, $2, $4, true)`,
                 [OWNER, team, WORKER, LEADER]);
  const r = await request(db, f, { item: it, quantity: 5 });
  await db.query(`update pr_requests set team_id = $1 where id = $2`, [team, r.req]);
  await issue(db, BUYER, it, f, 5, { request_line_id: r.line });
  eq(num(lineOf(await myRequests(db, LEADER), r.line).from_stock), 5);
  const other = '00000000-0000-0000-0000-000000000016';
  await db.query(`insert into profiles (id, role, owner_id, status, display_name) values ($1, 'worker', $2, 'active', 'Ben')`, [other, OWNER]);
  eq(lineOf(await myRequests(db, other), r.line), undefined, 'not their request');
});

await test('a return keeps "From stock" (the goods were delivered, R57); a reversed issue takes it back to 0', async () => {
  const db = await fresh();
  const it = await item(db, 'Cement');
  const f = await folder(db, 'Barlin'); await period(db, f);
  await stocked(db, it, 10);
  const r = await request(db, f, { item: it, quantity: 6 });
  const i1 = await issue(db, STAFF, it, f, 6, { request_line_id: r.line });
  await move(db, STAFF, { item_id: it, returns_record: i1.record_id, quantity: 2 });
  eq(num(lineOf(await myRequests(db, WORKER), r.line).from_stock), 6, 'a return never reopens a request');
  const r2 = await request(db, f, { item: it, quantity: 3 });
  const i2 = await issue(db, STAFF, it, f, 3, { request_line_id: r2.line });
  await reverse(db, STAFF, i2.record_id, 'wrong project');
  eq(num(lineOf(await myRequests(db, WORKER), r2.line).from_stock), 0);
});

await test('0106 changes nothing else: the answer is 0085\'s, key for key, plus "from_stock" on lines and portions', async () => {
  const db = await fresh();
  const it = await item(db, 'Cement');
  const f = await folder(db, 'Barlin'); await period(db, f);
  const g = await folder(db, 'Extra room', { parent: f });
  await stocked(db, it, 10);
  const r = await request(db, f, { item: it, quantity: 6 });
  await request(db, g, { project: f, description: 'Sand', quantity: 2 });
  await issue(db, STAFF, it, f, 2, { request_line_id: r.line });
  await db.exec(fnText(M85, 'pr_my_requests').replace('create or replace function pr_my_requests(', 'create or replace function pr_my_requests_0085('));
  await as(db, WORKER);
  const was = (await one(db, `select pr_my_requests_0085(100) x`)).x;
  const now = (await one(db, `select pr_my_requests(100) x`)).x;
  const strip = (doc) => doc.map(rq => ({ ...rq, lines: rq.lines.map(({ from_stock, ...l }) => ({ ...l, portions: l.portions.map(({ from_stock: _f, ...p }) => p) })) }));
  eq(strip(now), was);
  assert(now.every(rq => rq.lines.every(l => 'from_stock' in l && l.portions.every(p => 'from_stock' in p))), 'every line and portion says it');
  const keys = new Set();
  const walk = (v) => { if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === 'object') Object.entries(v).forEach(([k, x]) => { keys.add(k); walk(x); }); };
  walk(now);
  eq([...keys].filter(k => /amount|price|cost|peso|value|supplier|lot|location|record/.test(k)), [], 'no money and no stock detail for workers');
});

await test('stock off: "from_stock" is there and 0; the grant is unchanged (authenticated, never anon)', async () => {
  const db = await fresh({ on: false });
  const f = await folder(db, 'Barlin'); await period(db, f);
  const r = await request(db, f, { quantity: 2 });
  eq(num(lineOf(await myRequests(db, WORKER), r.line).from_stock), 0);
  eq([(await one(db, `select has_function_privilege('authenticated', 'pr_my_requests(integer)', 'execute') x`)).x,
      (await one(db, `select has_function_privilege('anon', 'pr_my_requests(integer)', 'execute') x`)).x], [true, false]);
});

const ACCEPT = read(path.join(ROOT, 'supabase/tests/2bb_acceptance.sql'));
// Supabase's auth.uid() reads the JWT claims, as the script sets them; live profiles have created_at.
async function acceptancePrep(db) {
  await db.exec(`create or replace function auth.uid() returns uuid language sql stable as
                   $$ select coalesce(nullif(current_setting('test.uid', true), ''),
                                      nullif(current_setting('request.jwt.claims', true), '')::json ->> 'sub')::uuid $$;
                 alter table profiles add column if not exists created_at timestamptz not null default now();
                 select set_config('test.uid', '', false);`);
}

await test('the live acceptance script (2bb_acceptance.sql) passes as written, stock off, and changes nothing', async () => {
  const db = await fresh({ on: false });
  const f = await folder(db, 'Barlin'); await period(db, f);
  await request(db, f, { quantity: 2 });
  await request(db, f, { quantity: 1, description: 'Sand' });
  await acceptancePrep(db);
  const before = await one(db, `select (select count(*) from pr_requests) r, (select count(*) from stk_settings) s`);
  const res = await db.exec(ACCEPT);
  assert(res.some(x => (x.rows || []).some(r => r.result === '2bb acceptance: all checks passed')), 'the success row');
  eq(await one(db, `select (select count(*) from pr_requests) r, (select count(*) from stk_settings) s`), before);
});

await test('the acceptance script fails on a database without 0106, and when anon may read requests', async () => {
  for (const [why, spoil, want] of [
    ['0085\'s pr_my_requests (0106 not applied)', (db) => db.exec(fnText(M85, 'pr_my_requests')), 'A2'],
    ['anon granted', (db) => db.exec(`grant execute on function pr_my_requests(integer) to anon`), 'C1'],
    ['0096\'s pur_op_begin (a cancelled id not refused)', (db) => db.exec(fnText(M96, 'pur_op_begin')), 'D5'],
    ['pur_op_cancel open to anon', (db) => db.exec(`grant execute on function pur_op_cancel(uuid) to anon`), 'C3'],
    ['lines without from_stock (portions with it)', (db) => {
      const line = "                        'from_stock', pr_line_from_stock(l.id),\n";
      const fn = fnText(M106, 'pr_my_requests');
      assert(fn.split(line).length === 2, 'the line key is in 0106 once');
      return db.exec(fn.replace(line, ''));
    }, 'A2'],
  ]) {
    const db = await fresh({ on: false });
    const f = await folder(db, 'Barlin'); await period(db, f);
    await request(db, f, { quantity: 2 });
    await acceptancePrep(db);
    await spoil(db);
    await refused(db.exec(ACCEPT), want, why);
  }
});

// ── A2. What the phone's lost-answer handling relies on (R101, R102) ──

const moveBody = (it, f, q) => JSON.stringify({ on: TODAY, item_id: it, from: 'warehouse', to: f, quantity: q, unplanned_reason: 'slab' });
const opState = async (db, who, id) => { await as(db, who); return (await one(db, `select pur_op_state($1) x`, [id])).x; };
const opCancel = async (db, who, id) => { await as(db, who); return (await one(db, `select pur_op_cancel($1) x`, [id])).x; };
const issueCount = async (db) => num((await one(db, `select count(*) n from stk_records where kind = 'issue'`)).n);

await test('Cancel it: under the operation lock the server finds it recorded (changing nothing) or cancels the id for good; Check reads it', async () => {
  const db = await fresh();
  const it = await item(db, 'Cement');
  const f = await folder(db, 'Barlin'); await period(db, f);
  const pid = await stocked(db, it, 10);
  const done = op();
  await rpc(db, STAFF, 'stk_move', [done, moveBody(it, f, '4')]);
  eq([await opState(db, STAFF, done), await opCancel(db, STAFF, done), await opState(db, STAFF, done)], ['recorded', 'recorded', 'recorded'],
     'recorded: the cancel says so and changes nothing');
  eq([await issueCount(db), await bal(db, it, 'warehouse')], [1, 6]);
  const lost = op();
  eq(await opState(db, STAFF, lost), 'none', 'never arrived');
  eq([await opCancel(db, STAFF, lost), await opCancel(db, STAFF, lost), await opState(db, STAFF, lost)], ['cancelled', 'cancelled', 'cancelled'],
     'cancelled for good; asking again gives the same answer');
  eq(await opState(db, BUYER, lost), 'none', 'another account\'s ids are its own');
  await refused(rpc(db, STAFF, 'stk_move', [lost, moveBody(it, f, '4')]), 'OP_CANCELLED', 'an issue with it');
  await refused(rpc(db, STAFF, 'stk_receive', [lost, pid, 1, '1', TODAY, '']), 'OP_CANCELLED', 'a receipt with it');
  await refused(rpc(db, STAFF, 'stk_leftover', [lost, pid, 1, '1', 'site', TODAY, '']), 'OP_CANCELLED', 'leftovers with it');
  eq([await issueCount(db), await bal(db, it, 'warehouse')], [1, 6], 'nothing recorded by any of them');
  // Ids are each account's own: staff@ recorded `shared`; the buyer cancelling the same id cancels the buyer's own.
  const shared = op();
  await rpc(db, STAFF, 'stk_move', [shared, moveBody(it, f, '1')]);
  eq(await opCancel(db, BUYER, shared), 'cancelled', 'never answered from another account\'s record');
  await refused(rpc(db, BUYER, 'stk_move', [shared, moveBody(it, f, '1')]), 'OP_CANCELLED', 'the buyer\'s own id is cancelled');
  eq([await opState(db, STAFF, shared), await opState(db, BUYER, shared), await issueCount(db)], ['recorded', 'cancelled', 2],
     'staff@\'s record untouched; the buyer recorded nothing');
  await refused((async () => { await as(db, ''); return one(db, `select pur_op_cancel($1) x`, [op()]); })(), 'AUTH_REQUIRED', 'signed in only');
});

await test('the original request arriving after cancellation and a new submission: only the new submission records', async () => {
  const db = await fresh();
  const it = await item(db, 'Cement');
  const f = await folder(db, 'Barlin'); await period(db, f);
  await stocked(db, it, 10);
  const original = op();              // sent with 4; its answer was lost before it reached the server
  eq(await opState(db, STAFF, original), 'none');
  eq(await opCancel(db, STAFF, original), 'cancelled', 'the phone cancels it before the person may change it');
  const changed = op();               // the person changed it to 6: a new submission, a new id
  await rpc(db, STAFF, 'stk_move', [changed, moveBody(it, f, '6')]);
  await refused(rpc(db, STAFF, 'stk_move', [original, moveBody(it, f, '4')]), 'OP_CANCELLED', 'the original, arriving late, is refused');
  eq([await issueCount(db), num((await one(db, `select quantity q from stk_records where kind = 'issue'`)).q), await bal(db, it, 'warehouse')], [1, 6, 4],
     'only the new submission: one issue of 6');
  eq([await opState(db, STAFF, original), await opState(db, STAFF, changed)], ['cancelled', 'recorded']);
});

await test('0106\'s pur_op_begin is 0096\'s, unchanged but for refusing a cancelled id', () => {
  const was = fnText(M96, 'pur_op_begin');
  const now = fnText(M106, 'pur_op_begin');
  const back = now.replace('  v_kind text;\n', '')
    .replace('select o.result, o.kind into v_prev, v_kind', 'select o.result into v_prev')
    .replace(/  -- 2B-b \(R102\)[\s\S]*?raise exception 'OP_CANCELLED' using errcode = 'P0001';\n  end if;\n/, '');
  eq(back, was);
  assert(now.includes("perform pg_advisory_xact_lock(hashtextextended('pur_op:' || auth.uid() || ':' || p_op, 0));"), 'the lock');
  assert(fnText(M106, 'pur_op_cancel').includes("perform pg_advisory_xact_lock(hashtextextended('pur_op:' || auth.uid() || ':' || p_op, 0));"),
         'the cancel takes the very same lock');
});

await test('a repeated operation id gets the first answer, whatever the payload — so the phone never changes one', async () => {
  const db = await fresh();
  const it = await item(db, 'Cement');
  const f = await folder(db, 'Barlin'); await period(db, f);
  await stocked(db, it, 10);
  const id = op();
  const body = (q) => JSON.stringify({ on: TODAY, item_id: it, from: 'warehouse', to: f, quantity: q, unplanned_reason: 'slab' });
  const first = await rpc(db, STAFF, 'stk_move', [id, body('4')]);
  const again = await rpc(db, STAFF, 'stk_move', [id, body('6')]);
  eq([again.record_id, again.replayed], [first.record_id, true], 'the first answer, marked replayed');
  eq(num((await one(db, `select count(*) n from stk_records where kind = 'issue'`)).n), 1, 'recorded once');
  eq(num((await one(db, `select quantity q from stk_records where kind = 'issue'`)).q), 4, 'the 6 was never recorded');
});

// ── B. The joint pilot's clean-up (Q30) ──────────────────────────────

// The pilot as the runbook (Task 4) does it — on the web and the phone —
// beside real data that must survive untouched.
async function pilot(db) {
  await stubs(db);
  // Real data first.
  const realItem = await item(db, 'Cement');
  const real = await folder(db, 'Barlin'); await period(db, real);
  const realBuy = await stocked(db, realItem, 10);
  const ri = await issue(db, STAFF, realItem, real, 3, { unplanned_reason: 'slab' });
  await cdecide(db, OWNER, ri.cost_moves[0], true);
  const realReq = await request(db, real, { item: realItem, quantity: 2 });
  await db.query(`insert into expenses (owner_id, project_id, expense_name, category, quantity, amount)
                  select $1, id, 'Nails', 'Materials', 1, 75 from projects where folder_id = $2`, [OWNER, real]);
  // The ZZ pilot.
  const a = await folder(db, 'ZZ 2bc pilot A'); await period(db, a);
  const b = await folder(db, 'ZZ 2bc pilot B'); await period(db, b, 500);
  const job = await folder(db, 'ZZ 2bc pilot A — extra room', { parent: a });
  const cement = await item(db, 'ZZ 2bc cement');
  const wire = await item(db, 'ZZ 2bc wire', 'piece');
  const sand = await item(db, 'ZZ 2bc sand');
  const req = await request(db, a, { item: cement, quantity: 6 });
  await request(db, job, { project: a, item: sand, quantity: 2, description: 'ZZ 2bc sand' });
  const wh = await buyWith(db, [{ destination: 'warehouse', item_name: 'ZZ 2bc cement', quantity: 10, amount: 1000 }],
                           [{ kind: 'delivery_fee', amount: 50 }]);
  await db.query(`insert into suppliers (owner_id, name, created_by) values ($1, 'ZZ 2bc hardware', $1)`, [OWNER]);
  await db.query(`update purchases set supplier_id = (select id from suppliers where name = 'ZZ 2bc hardware') where id = $1`, [wh]);
  await receive(db, BUYER, wh, 1, 6);
  await match(db, STAFF, wh, 1, cement, 10);
  await receive(db, BUYER, wh, 1, 4);
  const i1 = await issue(db, BUYER, cement, a, 4, { request_line_id: req.line });
  await cdecide(db, OWNER, i1.cost_moves[0], true);
  const back = await move(db, BUYER, { item_id: cement, returns_record: i1.record_id, quantity: 1 });
  await cdecide(db, OWNER, back.cost_moves[0], true);
  const pj = await projectBuy(db, b, 'ZZ 2bc wire', 2, { unit: 'box', amount: 300 });
  await match(db, STAFF, pj, 1, wire, 100, '2 boxes = 100 pcs');
  await leftover(db, BUYER, pj, 1, 50, 'warehouse');   // in pieces (the item's unit)
  const t = await move(db, BUYER, { item_id: wire, from: 'warehouse', to: a, quantity: 30, unplanned_reason: 'ties' });
  await cdecide(db, OWNER, t.cost_moves[0], false, 'wrong project');
  const again = await cresubmit(db, STAFF, t.cost_moves[0], 'see photo');
  await cdecide(db, OWNER, again.cost_move_id, true);
  const mv = await move(db, BUYER, { item_id: cement, from: a, to: b, quantity: 1, unplanned_reason: 'formwork' });
  await cdecide(db, OWNER, mv.cost_moves[0], true);
  const c = await count(db, STAFF, { item_id: cement, at: 'warehouse', counted: 5, reason: 'damaged' });
  await decide(db, OWNER, c.record_id, true);
  const o = await opening(db, STAFF, { item_id: sand, at: job, quantity: 3 });
  await decide(db, OWNER, o.record_id, true);
  const wrong = await issue(db, STAFF, cement, b, 1, { unplanned_reason: 'x' });
  await reverse(db, STAFF, wrong.record_id, 'mistake');
  return { real, realItem, realBuy, realReq, a, b, cement, wh, pj, req };
}

await test('the clean-up removes every ZZ pilot row and nothing real — dry run first, then the real run', async () => {
  const db = await fresh();
  const p = await pilot(db);
  await db.exec(`reset role`);
  // A real supplier no purchase uses yet: only "ZZ 2bc…" suppliers may go.
  await db.query(`insert into suppliers (owner_id, name, created_by) values ($1, 'Real Hardware', $1)`, [OWNER]);
  const before = await state(db);
  const realBefore = await one(db, `select (select count(*) || '/' || sum(e.amount) from expenses e join projects pp on pp.id = e.project_id where pp.folder_id = $1) barlin,
                                           (select count(*) from stk_records r where r.item_id = $2) real_records,
                                           (select count(*) from stk_cost_moves c join stk_lots lt on lt.id = c.lot_id where lt.item_id = $2) real_cost,
                                           (select count(*) from stk_settings where enabled) switched_on`, [p.real, p.realItem]);
  const dry = await code(cleanup(db));
  assert(dry.includes('DRY RUN OK') && /purchases 2/.test(dry) && /projects 3/.test(dry) && /requests 2/.test(dry), dry);
  eq(await state(db), before, 'the dry run changed nothing');
  await cleanup(db, true);
  eq((await all(db, `select name from folders order by name`)).map(r => r.name), ['Barlin']);
  eq((await all(db, `select name from pr_catalog_items order by name`)).map(r => r.name), ['Cement']);
  eq((await all(db, `select name from suppliers where name like 'ZZ%'`)).length, 0);
  eq((await all(db, `select name from suppliers where name = 'Real Hardware'`)).length, 1, 'a real supplier stays, used or not');
  // Every stock row left is the real purchase's or the real item's.
  eq(await one(db, `select (select count(*) from stk_records where not (coalesce(item_id = $1, false) or coalesce(purchase_id = $2, false))) records,
                           (select count(*) from stk_lots where item_id <> $1) lots,
                           (select count(*) from stk_matches where item_id <> $1 or purchase_id <> $2) matches,
                           (select count(*) from stk_cost_moves c join stk_lots lt on lt.id = c.lot_id where lt.item_id <> $1) cost_moves,
                           (select count(*) from stk_moves m join stk_lots lt on lt.id = m.lot_id where lt.item_id <> $1) moves,
                           (select count(*) from stk_locations where kind = 'site' and folder_id <> $3) sites`, [p.realItem, p.realBuy, p.real]),
     { records: 0, lots: 0, matches: 0, cost_moves: 0, moves: 0, sites: 0 }, 'no ZZ stock row left');
  eq(await one(db, `select (select count(*) || '/' || sum(e.amount) from expenses e join projects pp on pp.id = e.project_id where pp.folder_id = $1) barlin,
                           (select count(*) from stk_records r where r.item_id = $2) real_records,
                           (select count(*) from stk_cost_moves c join stk_lots lt on lt.id = c.lot_id where lt.item_id = $2) real_cost,
                           (select count(*) from stk_settings where enabled) switched_on`, [p.real, p.realItem]), realBefore, 'real data untouched, the switch left as it was');
  eq(num((await one(db, `select count(*) n from purchases`)).n), 1, 'the real purchase only');
  eq(num((await one(db, `select count(*) n from pr_requests`)).n), 1, 'the real request only');
  eq(num((await one(db, `select count(*) n from stk_locations where kind = 'warehouse'`)).n), 1, 'the warehouse place stays');
  eq((await all(db, `select tgname from pg_trigger where tgname in ('stk_events_no_change', 'stk_moves_no_change', 'stk_covers_no_change')
                      and tgenabled = 'O' order by 1`)).length, 3, 'history guards back on');
  await refused(db.query(`delete from stk_events`), 'HISTORY_IMMUTABLE', 'and they work');
  await refused(cleanup(db), 'no project named', 'a second run finds nothing');
  // Stock still works for real goods afterwards.
  await issue(db, STAFF, p.realItem, p.real, 1, { unplanned_reason: 'after clean-up' });
});

await test('the clean-up refuses — and changes nothing — when real data is mixed into the pilot', async () => {
  for (const [why, spoil, want] of [
    ['real goods at a ZZ site', (db, p) => issue(db, STAFF, p.realItem, p.a, 1, { unplanned_reason: 'x' }), 'real goods were recorded at a ZZ site'],
    ['a hand-entered expense on a ZZ project', (db, p) => db.query(`insert into expenses (owner_id, project_id, amount)
        select $1, id, 10 from projects where folder_id = $2`, [OWNER, p.a]), 'hand-entered expense'],
    ['a real line on a ZZ purchase', (db, p) => db.query(`insert into purchase_lines (owner_id, purchase_id, line_no, destination, folder_id, item_name, quantity, gross_amount)
        values ($1, $2, 9, 'project', $3, 'Nails', 1, 5)`, [OWNER, p.wh, p.real]), 'also has a real line'],
    ['a ZZ item on a real request', (db, p) => db.query(`update pr_lines set catalog_item_id = $1 where id = $2`, [p.cement, p.realReq.line]), 'ZZ item is on a real request'],
    ['a Work Plan task on a ZZ project', (db, p) => db.query(`insert into wp_tasks (folder_id) values ($1)`, [p.a]), 'Work Plan task'],
  ]) {
    const db = await fresh();
    const p = await pilot(db);
    await as(db, OWNER);
    await spoil(db, p);
    await db.exec(`reset role`);
    const before = await state(db);
    await refused(cleanup(db, true), want, why);
    eq(await state(db), before, why + ': nothing changed');
  }
  const db = await fresh();
  await stubs(db);
  await refused(cleanup(db, true), 'no project named', 'no pilot at all');
});

await test('every other clean-up guard refuses too (one pilot; each spoil rolled back afterwards)', async () => {
  const db = await fresh();
  const p = await pilot(db);
  const periodOf = async (f) => (await one(db, `select id from projects where folder_id = $1 order by id limit 1`, [f])).id;
  for (const [why, spoil, want] of [
    ['a real job under a ZZ project', () => folder(db, 'Fence', { parent: p.a }), 'a job under a ZZ project'],
    ['a ZZ job under a real project', () => folder(db, 'ZZ 2bc pilot stray', { parent: p.real }), 'sits under a real project'],
    ['a payment on a ZZ purchase', () => db.query(`insert into pur_payments (owner_id, purchase_id, first_purchase_id, amount, paid_on, method, source, created_by)
        values ($1, $2, $2, 10, $3, 'cash', 'company', $1)`, [OWNER, p.wh, TODAY]), 'payments, refunds or credits'],
    ['a real purchase covering a ZZ request', () => db.query(`insert into purchase_lines (owner_id, purchase_id, line_no, destination, item_name, quantity, gross_amount, request_line_id)
        values ($1, $2, 9, 'warehouse', 'Nails', 1, 5, $3)`, [OWNER, p.realBuy, p.req.line]), 'a real purchase covers a ZZ request'],
    ['a Work Plan blocker on a ZZ request', () => db.query(`insert into wp_blockers (request_id) values ($1)`, [p.req.req]), 'Work Plan blocker'],
    ['a ZZ purchase matched to a real item', () => db.query(`update stk_lots set item_id = $1 where purchase_id = $2`, [p.realItem, p.wh]), 'matched to a real catalogue item'],
    ['ZZ goods issued to a real project', () => issue(db, STAFF, p.cement, p.real, 1, { unplanned_reason: 'x' }), 'recorded at a real project'],
    ['a ZZ cost-move row on a real project', async () => {
      await db.exec(`select set_config('dacs.purchase_write', 'on', true)`);
      await db.query(`update expenses set project_id = $1 where stk_cost_move_id is not null and project_id = $2`, [await periodOf(p.real), await periodOf(p.b)]);
    }, 'wrote a row on a real project'],
    ['a gallery photo of a ZZ item', () => db.query(`insert into pr_gallery_photos (catalog_item_id) values ($1)`, [p.cement]), 'gallery photos'],
  ]) {
    await db.exec(`reset role`);
    const before = await state(db);
    await db.exec('begin');
    await spoil();
    await db.exec(`reset role`);
    await refused(cleanup(db, true), want, why);
    await db.exec('rollback');
    eq(await state(db), before, why + ': rolled back');
  }
  await cleanup(db, true);
  eq(num((await one(db, `select count(*) n from folders where name like 'ZZ%'`)).n), 0, 'and with no spoil it cleans');
});

await test('the clean-up\'s own after-checks stop a broken copy of it, with nothing changed', async () => {
  const db = await fresh();
  await pilot(db);
  await db.exec(`reset role`);
  const real = CLEAN.replace(/^  v_dry boolean := true;$/m, '  v_dry boolean := false;');
  for (const [why, from, to, want] of [
    ['a ZZ item left behind', '  delete from pr_catalog_items where id = any(zi);\n', '', 'a ZZ row is still there'],
    ['a ZZ project left behind', '  delete from folders where id = any(zf);\n', '', 'a ZZ project is still there'],
    ['real expenses deleted', '  delete from expenses where stk_cost_move_id = any(zcm) or', '  delete from expenses where true or', 'real expenses changed'],
    ['a history guard left off', "  execute 'alter table stk_moves enable trigger stk_moves_no_change';\n", '', 'history guard is not back on'],
  ]) {
    assert(real.split(from).length === 2, why + ': the line is in the file once');
    const before = await state(db);
    await refused(db.exec(real.replace(from, to)), want, why);
    eq(await state(db), before, why + ': nothing changed');
  }
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) { console.log('\nFAILURES:\n  ' + failures.join('\n  ')); process.exit(1); }
