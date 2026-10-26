// ════════════════════════════════════════════════════════════════════
// STAGE 2C COST MOVES — BEHAVIOUR TESTS ON PGLITE
//   npm run test:sql
//
// Runs migrations 0096, 0097, 0101, 0102, 0103, 0104 and 0105 VERBATIM on
// PGlite over the 2B-a suite's tables and helpers. Nothing here talks to the
// live database; supabase/tests/2c_acceptance.sql repeats the key cases
// there, rolled back.
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

console.log('\n2C cost moves (0096 + 0097 + 0101 + 0102 + 0103 + 0104 + 0105 on PGlite)');

// ── A. Company stock → a project (cost assignment, Q11) ──────────────

await test('company stock issued to a project: "Cost assignment pending" — no Spent until the main owner approves; then one "From warehouse" row', async () => {
  const db = await fresh();
  const it = await item(db, 'Cement');
  const f = await folder(db, 'Barlin'); const p = await period(db, f);
  await stocked(db, it, 10);                       // ₱1,000 → ₱100 a bag
  const before = await money(db);
  const r = await move(db, STAFF, { item_id: it, from: 'warehouse', to: f, quantity: 4, unplanned_reason: 'slab' });
  eq(r.cost_moves.length, 1, 'one request per movement per lot');
  const c = await cost(db, r.cost_moves[0]);
  eq([c.kind, c.status, c.from_folder, c.to_folder, num(c.quantity), c.received_on.toISOString?.().slice(0, 10) ?? String(c.received_on)],
     ['assign', 'pending', null, f, 4, TODAY]);
  eq(await money(db), before, 'pending: no expense row');
  eq(await companyStock(db), [['Cement', 6, 600, 4, 400, 0, 0, 0]], 'issued, assignment pending: still company cost');
  const a = await cdecide(db, OWNER, c.id, true);
  eq([a.status, num(a.quantity), num(a.value)], ['approved', 4, 400]);
  eq(await stockRows(db, f), [['From warehouse — Cement', 400, false, p]]);
  eq(await spent(db, f), 400);
  eq(await companyStock(db), [['Cement', 6, 600, 0, 0, 0, 0, 0]]);
  const e = await one(db, `select category, quantity, notes, split_group from expenses where stk_cost_move_id = $1`, [c.id]);
  eq([e.category, num(e.quantity), e.split_group], ['Materials', 4, null]);
  await refused(cdecide(db, OWNER, c.id, true), 'BAD_STATE', 'decided once');
  await fourPlaces(db, [f]);
});

await test('value by lot (Q12): item amount − discount + delivery fee, to the centavo; the last portion takes what is left — the portions add up exactly', async () => {
  const db = await fresh();
  const pcs = await item(db, 'Tie wire', 'piece');
  const pid = await buyWith(db, [{ destination: 'warehouse', item_name: 'Tie wire box', quantity: 3, unit: 'box', amount: 1000 }],
                            [{ kind: 'discount', amount: 10 }, { kind: 'delivery_fee', amount: 5 }]);
  await match(db, STAFF, pid, 1, pcs, 100, '3 boxes = 100 pcs');
  await receive(db, BUYER, pid, 1, 3);
  const lot = await lotOf(db, pid);
  eq(await held(db, lot, null), [995, 100], 'company holds the whole line: ₱995 for 100 pieces');
  const fs = [await folder(db, 'A'), await folder(db, 'B'), await folder(db, 'C')];
  for (const f of fs) await period(db, f);
  const vals = [];
  for (const [f, q] of [[fs[0], 33], [fs[1], 33], [fs[2], 34]]) {
    const r = await move(db, STAFF, { item_id: pcs, from: 'warehouse', to: f, quantity: q, unplanned_reason: 'ties' });
    vals.push(num((await cdecide(db, OWNER, r.cost_moves[0], true)).value));
  }
  eq(vals, [328.35, 328.35, 338.3], '995 × 33/100; 666.65 × 33/67; the rest');
  eq(Math.round(vals.reduce((s, v) => s + v, 0) * 100) / 100, 995);
  eq(await held(db, lot, null), [0, 0]);
  await fourPlaces(db, fs);
});

await test('funded like a purchase (Q14): the month the project received the goods, earliest billing number first, the rest Cover', async () => {
  const db = await fresh();
  const it = await item(db, 'Cement');
  const f = await folder(db, 'Barlin');
  const past = phDate(-40);
  const p1 = await periodOn(db, f, past, 300, 1), p2 = await periodOn(db, f, past, 100, 2);
  const now = await period(db, f);
  await stocked(db, it, 10, { date: past, received: past });
  const r = await move(db, STAFF, { item_id: it, from: 'warehouse', to: f, quantity: 5, unplanned_reason: 'slab', on: past });
  await cdecide(db, OWNER, r.cost_moves[0], true);
  const rows = await stockRows(db, f);
  eq(rows.map(x => [x[0], x[1], x[2], x[3] === now ? 'now' : x[2] ? 'cover' : x[3] === p1 ? 'p1' : x[3] === p2 ? 'p2' : '?']),
     [['From warehouse — Cement (1/3)', 300, false, 'p1'], ['From warehouse — Cement (2/3)', 100, false, 'p2'],
      ['From warehouse — Cement (3/3)', 100, true, 'cover']], 'never this month\'s period');
  eq((await all(db, `select distinct split_group g from expenses where stk_cost_move_id = $1`, [r.cost_moves[0]])).length, 1, 'one split group');
});

await test('an Additional Works job: its own period, in full, never Cover', async () => {
  const db = await fresh();
  const it = await item(db, 'Cement');
  const main = await folder(db, 'Barlin'); await period(db, main, 10);
  const aw = await folder(db, 'Extra room', { parent: main });
  await stocked(db, it, 10);
  const r = await move(db, STAFF, { item_id: it, from: 'warehouse', to: aw, quantity: 3, unplanned_reason: 'room' });
  eq((await cost(db, r.cost_moves[0])).kind, 'assign');
  await cdecide(db, OWNER, r.cost_moves[0], true);
  const rows = await stockRows(db, aw);
  eq(rows.map(x => [x[0], x[1], x[2]]), [['From warehouse — Cement', 300, false]]);
  eq(await spent(db, main), 0, 'the main project is not charged');
});

// ── B. Project → project (transfer, Q12) and back to company (Q10) ───

await test('leftovers moved to another project: "Cost transfer pending"; approval moves the cost — A down, B up, the line still adds up', async () => {
  const db = await fresh();
  const it = await item(db, 'Cement');
  const a = await folder(db, 'Barlin'); await period(db, a, 600);   // ₱600 budget → ₱400 Cover
  const b = await folder(db, 'Bagong'); const pb = await period(db, b);
  const r0 = await request(db, a, { item: it, quantity: 10 });
  const pj = await projectBuy(db, a, 'Cement', 10, { requestLine: r0.line });   // ₱1,000
  eq(await spent(db, a), 1000);
  await leftover(db, STAFF, pj, 1, 5, 'warehouse');
  const r = await move(db, STAFF, { item_id: it, from: 'warehouse', to: b, quantity: 5, unplanned_reason: 'slab' });
  const c = await cost(db, r.cost_moves[0]);
  eq([c.kind, c.from_folder, c.to_folder], ['transfer', a, b]);
  eq([await spent(db, a), await spent(db, b)], [1000, 0], 'pending: the cost stays where it was');
  await cdecide(db, OWNER, c.id, true);
  eq([await spent(db, a), await spent(db, b)], [500, 500]);
  eq((await stockRows(db, a)).map(x => [x[0], x[1], x[2]]),
     [['Moved to Bagong — Cement (1/2)', -300, false], ['Moved to Bagong — Cement (2/2)', -200, true]],
     'off A in proportion to where its cost sat: ₱600 period, ₱400 Cover');
  eq((await stockRows(db, b)).map(x => [x[0], x[1], x[2], x[3]]), [['Moved from Barlin — Cement', 500, false, pb]]);
  await fourPlaces(db, [a, b]);
});

await test('a delivery fee and a discount move with the goods: the giving project loses its share from every row that carried it', async () => {
  const db = await fresh();
  const it = await item(db, 'Cement'); const gr = await item(db, 'Gravel');
  const a = await folder(db, 'Barlin'); await period(db, a);
  const b = await folder(db, 'Bagong'); await period(db, b);
  const pj = await buyWith(db, [{ folder_id: a, item_name: 'Cement', quantity: 10, amount: 3000 },
                                { folder_id: a, item_name: 'Gravel', quantity: 1, unit: 'bag', amount: 1000 }],
                           [{ kind: 'delivery_fee', amount: 200 }, { kind: 'discount', amount: 100 }]);
  await match(db, STAFF, pj, 1, it, 10);
  await match(db, STAFF, pj, 2, gr, 1);
  eq(await spent(db, a), 4100);
  await leftover(db, STAFF, pj, 1, 4, 'site');
  const r = await move(db, STAFF, { item_id: it, from: a, to: b, quantity: 4, unplanned_reason: 'formwork' });
  const c = await cost(db, r.cost_moves[0]);
  eq(c.kind, 'transfer');
  const v = num((await cdecide(db, OWNER, c.id, true)).value);
  eq(v, Math.round((3000 - 75 + 150) * 4 / 10 * 100) / 100, '(₱3,000 − ₱75 discount + ₱150 fee) × 4/10');
  eq([await spent(db, a), await spent(db, b)], [4100 - v, v]);
  const out = await stockRows(db, a);
  eq(Math.round(out.reduce((s, x) => s + x[1], 0) * 100) / 100, -v, 'the out rows add up to the value');
  await fourPlaces(db, [a, b], { [a]: 1000 - 25 + 50 });   // the gravel line, never stocked
});

await test('a company lot brought back to the warehouse from a project: "Back to company stock" pending; a project\'s own leftovers keep their cost there', async () => {
  const db = await fresh();
  const it = await item(db, 'Cement');
  const a = await folder(db, 'Barlin'); await period(db, a);
  await stocked(db, it, 10);
  const i1 = await move(db, STAFF, { item_id: it, from: 'warehouse', to: a, quantity: 6, unplanned_reason: 'slab' });
  await cdecide(db, OWNER, i1.cost_moves[0], true);
  eq(await spent(db, a), 600);
  const ret = await move(db, STAFF, { item_id: it, returns_record: i1.record_id, quantity: 2 });
  const c = await cost(db, ret.cost_moves[0]);
  eq([c.kind, c.from_folder, c.to_folder, num(c.quantity)], ['back', a, null, 2], 'the return takes the project\'s own (approved) goods');
  await cdecide(db, OWNER, c.id, true);
  eq((await stockRows(db, a)).map(x => [x[0], x[1]]), [['From warehouse — Cement', 600], ['Back to company stock — Cement', -200]]);
  eq(await spent(db, a), 400);
  eq(await companyStock(db), [['Cement', 6, 600, 0, 0, 0, 0, 0]]);
  // A project's own leftovers brought to the warehouse: no request — still its cost (12 Oct).
  const r0 = await request(db, a, { item: it, quantity: 5 });
  const pj = await projectBuy(db, a, 'Cement', 5, { requestLine: r0.line });
  const lo = await leftover(db, STAFF, pj, 1, 2, 'warehouse');
  eq((await costsOf(db, lo.record_id)).length, 0);
  // …and issued back to that same project: none either.
  const back = await move(db, STAFF, { item_id: it, from: 'warehouse', to: a, quantity: 2, unplanned_reason: 'slab', lot_id: await lotOf(db, pj) });
  eq(back.cost_moves, []);
  await fourPlaces(db, [a]);
});

await test('a plain move from a site to the warehouse takes the project\'s goods: "back"; between sites of company goods not yet assigned: a fresh assignment', async () => {
  const db = await fresh();
  const it = await item(db, 'Cement');
  const a = await folder(db, 'Barlin'); await period(db, a);
  const b = await folder(db, 'Bagong'); await period(db, b);
  await stocked(db, it, 10);
  const i1 = await move(db, STAFF, { item_id: it, from: 'warehouse', to: a, quantity: 3, unplanned_reason: 'slab' });
  await cdecide(db, OWNER, i1.cost_moves[0], true);                                    // A holds 3
  const i2 = await move(db, STAFF, { item_id: it, from: 'warehouse', to: a, quantity: 2, unplanned_reason: 'slab' });   // 2 pending
  // To B: the goods NOT yet the site's own leave first — company goods → a fresh assignment to B.
  const m = await move(db, STAFF, { item_id: it, from: a, to: b, quantity: 2, unplanned_reason: 'formwork' });
  eq((await costsOf(db, m.record_id)).map(c => [c.kind, c.from_folder, c.to_folder, num(c.quantity)]), [['assign', null, b, 2]]);
  await as(db, OWNER);
  eq(num((await one(db, `select stk_cost_effective($1) e`, [i2.cost_moves[0]])).e), 0, 'A\'s pending assignment shrank to nothing');
  await refused(cdecide(db, OWNER, i2.cost_moves[0], true), 'NOTHING_LEFT');
  await cdecide(db, OWNER, i2.cost_moves[0], false, 'went to Bagong');
  await cdecide(db, OWNER, m.cost_moves[0], true);
  const w = await move(db, STAFF, { item_id: it, from: a, to: 'warehouse', quantity: 1 });
  eq((await costsOf(db, w.record_id)).map(c => [c.kind, c.from_folder, c.to_folder]), [['back', a, null]]);
  eq([await spent(db, a), await spent(db, b)], [300, 200]);
  await fourPlaces(db, [a, b]);
});

await test('Q12\'s own example: ₱100 for 3 pieces moved one at a time → ₱33.33 + ₱33.33 + ₱33.34', async () => {
  const db = await fresh();
  const it = await item(db, 'Cement');
  const pid = await warehouseBuy(db, 'Cement', 3, { amount: 100 });
  await match(db, STAFF, pid, 1, it, 3);
  await receive(db, BUYER, pid, 1, 3);
  const fs = [await folder(db, 'A'), await folder(db, 'B'), await folder(db, 'C')];
  const vals = [];
  for (const f of fs) {
    await period(db, f);
    const r = await move(db, STAFF, { item_id: it, from: 'warehouse', to: f, quantity: 1, unplanned_reason: 'x' });
    vals.push(num((await cdecide(db, OWNER, r.cost_moves[0], true)).value));
  }
  eq(vals, [33.33, 33.33, 33.34]);
  await fourPlaces(db, fs);
});

await test('a delivery fee on Cover while its line sat on the period: the move comes off each in proportion (Q15)', async () => {
  const db = await fresh();
  const it = await item(db, 'Cement');
  const a = await folder(db, 'Barlin'); await period(db, a, 1000);
  const b = await folder(db, 'Bagong'); await period(db, b);
  const pj = await buyWith(db, [{ folder_id: a, item_name: 'Cement', quantity: 10, amount: 1000 }], [{ kind: 'delivery_fee', amount: 100 }]);
  await match(db, STAFF, pj, 1, it, 10);
  eq((await all(db, `select amount a, cover_expense c from expenses order by amount desc`)).map(r => [num(r.a), r.c]), [[1000, false], [100, true]],
     'the line fills the period; its fee goes to Cover');
  await leftover(db, STAFF, pj, 1, 5, 'warehouse');
  const r = await move(db, STAFF, { item_id: it, from: 'warehouse', to: b, quantity: 5, unplanned_reason: 'slab' });
  eq(num((await cdecide(db, OWNER, r.cost_moves[0], true)).value), 550);
  eq((await stockRows(db, a)).map(x => [x[1], x[2]]), [[-500, false], [-50, true]], '₱500 off the period, ₱50 off Cover');
  await fourPlaces(db, [a, b]);
});

await test('a project\'s own leftovers moved from its site to the warehouse keep their cost there: no request (12 Oct)', async () => {
  const db = await fresh();
  const it = await item(db, 'Cement');
  const a = await folder(db, 'Barlin'); await period(db, a);
  const r0 = await request(db, a, { item: it, quantity: 6 });
  const pj = await projectBuy(db, a, 'Cement', 6, { requestLine: r0.line });
  await leftover(db, STAFF, pj, 1, 4, 'site');
  const m = await move(db, STAFF, { item_id: it, from: a, to: 'warehouse', quantity: 3 });
  eq(m.cost_moves, []);
  eq(await spent(db, a), 600);
  eq(await companyStock(db), [], 'still the project\'s cost, not company stock');
  await fourPlaces(db, [a]);
});

await test('a return after the assignment was approved brings back the project\'s goods — even with company goods still waiting there', async () => {
  const db = await fresh();
  const it = await item(db, 'Cement');
  const a = await folder(db, 'Barlin'); await period(db, a);
  await stocked(db, it, 10);
  const i1 = await move(db, STAFF, { item_id: it, from: 'warehouse', to: a, quantity: 4, unplanned_reason: 'slab' });
  await cdecide(db, OWNER, i1.cost_moves[0], true);
  const i2 = await move(db, STAFF, { item_id: it, from: 'warehouse', to: a, quantity: 3, unplanned_reason: 'slab' });
  const ret = await move(db, STAFF, { item_id: it, returns_record: i1.record_id, quantity: 2 });
  eq((await costsOf(db, ret.record_id)).map(c => [c.kind, c.from_folder, c.to_folder, num(c.quantity)]), [['back', a, null, 2]]);
  await as(db, OWNER);
  eq(num((await one(db, `select stk_cost_effective($1) e`, [i2.cost_moves[0]])).e), 3, 'the other issue still waits for all 3');
  await fourPlaces(db, [a]);
});

await test('two requests waiting on the same goods: the earlier one is charged first — never both for the same bags', async () => {
  const db = await fresh();
  const it = await item(db, 'Cement');
  const a = await folder(db, 'Barlin'); await period(db, a);
  await stocked(db, it, 10);
  const i1 = await move(db, STAFF, { item_id: it, from: 'warehouse', to: a, quantity: 4, unplanned_reason: 'slab' });
  const i2 = await move(db, STAFF, { item_id: it, from: 'warehouse', to: a, quantity: 4, unplanned_reason: 'slab' });
  await move(db, STAFF, { item_id: it, from: a, to: 'warehouse', quantity: 5 });   // 3 left at the site
  await as(db, OWNER);
  eq([num((await one(db, `select stk_cost_effective($1) e`, [i1.cost_moves[0]])).e),
      num((await one(db, `select stk_cost_effective($1) e`, [i2.cost_moves[0]])).e)], [3, 0]);
  await refused(cdecide(db, OWNER, i2.cost_moves[0], true), 'NOTHING_LEFT', 'the later one first');
  eq(num((await cdecide(db, OWNER, i1.cost_moves[0], true)).value), 300);
  await fourPlaces(db, [a]);
});

await test('a reversal is refused while the goods it brought have moved on — counted by whose cost they are', async () => {
  const db = await fresh();
  const it = await item(db, 'Cement');
  const a = await folder(db, 'Barlin'); await period(db, a);
  await stocked(db, it, 10);
  const i1 = await move(db, STAFF, { item_id: it, from: 'warehouse', to: a, quantity: 4, unplanned_reason: 'slab' });
  await cdecide(db, OWNER, i1.cost_moves[0], true);
  const i2 = await move(db, STAFF, { item_id: it, from: 'warehouse', to: a, quantity: 3, unplanned_reason: 'slab' });
  const m = await move(db, STAFF, { item_id: it, from: a, to: 'warehouse', quantity: 3 });   // i2's company goods leave first
  eq(m.cost_moves, [], 'company goods back to company stock: nothing to ask');
  await refused(reverse(db, STAFF, i2.record_id, 'wrong'), 'MOVED_ON', 'its goods are back in the warehouse');
  await reverse(db, STAFF, m.record_id, 'wrong');
  await reverse(db, STAFF, i2.record_id, 'wrong');
  eq((await cost(db, i2.cost_moves[0])).status, 'withdrawn');
  eq([await bal(db, it, 'warehouse'), await bal(db, it, a), await spent(db, a)], [6, 4, 400]);
  await fourPlaces(db, [a]);
});

// ── C. Pending shrinks; reject; resubmit (Q10, Q19, Q20) ──────────────

await test('goods that left before approval are not charged: the pending assignment shrinks; nothing left → only a rejection', async () => {
  const db = await fresh();
  const it = await item(db, 'Cement');
  const a = await folder(db, 'Barlin'); await period(db, a);
  await stocked(db, it, 10);
  const i1 = await move(db, STAFF, { item_id: it, from: 'warehouse', to: a, quantity: 5, unplanned_reason: 'slab' });
  const ret = await move(db, STAFF, { item_id: it, returns_record: i1.record_id, quantity: 2 });
  eq(ret.cost_moves, [], 'company goods back to company stock: nothing to ask');
  await as(db, OWNER);
  const card = (await one(db, `select stk_cost_pending() x`)).x;
  eq(card.map(x => [num(x.quantity), num(x.effective), num(x.estimate)]), [[5, 3, 300]], 'the card shows what is still there');
  const a1 = await cdecide(db, OWNER, i1.cost_moves[0], true);
  eq([num(a1.quantity), num(a1.value)], [3, 300], 'whole, for what is still there');
  const i2 = await move(db, STAFF, { item_id: it, from: 'warehouse', to: a, quantity: 2, unplanned_reason: 'slab' });
  await move(db, STAFF, { item_id: it, returns_record: i2.record_id, quantity: 2 });
  await refused(cdecide(db, OWNER, i2.cost_moves[0], true), 'NOTHING_LEFT');
  await refused(cdecide(db, OWNER, i2.cost_moves[0], false, ' '), 'REASON_REQUIRED', 'a rejection needs a reason');
  eq((await cdecide(db, OWNER, i2.cost_moves[0], false, 'all returned')).status, 'rejected');
  eq(await spent(db, a), 300);
  await fourPlaces(db, [a]);
});

await test('reject keeps the goods recorded and the cost where it was; a stock recorder resubmits with a note — no second movement', async () => {
  const db = await fresh();
  const it = await item(db, 'Cement');
  const a = await folder(db, 'Barlin'); await period(db, a);
  await stocked(db, it, 10);
  const i1 = await move(db, STAFF, { item_id: it, from: 'warehouse', to: a, quantity: 4, unplanned_reason: 'slab' });
  const id = i1.cost_moves[0];
  await cdecide(db, OWNER, id, false, 'which slab?');
  eq([await bal(db, it, a), await spent(db, a)], [4, 0]);
  await refused(cresubmit(db, STAFF, id, ' '), 'REASON_REQUIRED');
  await refused(cresubmit(db, WORKER, id), 'NOT_OFFICE');
  const rs = await cresubmit(db, STAFF, id, 'Slab 2 — see photo');
  const n = await cost(db, rs.cost_move_id);
  eq([n.status, n.resubmits, n.note, num(n.quantity), n.record_id], ['pending', id, 'Slab 2 — see photo', 4, i1.record_id]);
  await refused(cresubmit(db, BUYER, id), 'BAD_STATE', 'one open request per movement');
  eq((await all(db, `select id from stk_records where kind = 'issue'`)).length, 1);
  await cdecide(db, OWNER, n.id, true);
  eq(await spent(db, a), 400);
  await refused(cresubmit(db, STAFF, id), 'BAD_STATE', 'already approved');
  const ev = (await all(db, `select kind from stk_events where cost_move_id is not null order by id`)).map(r => r.kind);
  eq(ev, ['cost_requested', 'cost_rejected', 'cost_resubmitted', 'cost_approved']);
});

// ── D. Who ───────────────────────────────────────────────────────────

await test('only the main owner approves, rejects and reverses; owner accounts see values, staff only the state', async () => {
  const db = await fresh();
  const it = await item(db, 'Cement');
  const a = await folder(db, 'Barlin'); await period(db, a);
  await stocked(db, it, 10);
  const i1 = await move(db, STAFF, { item_id: it, from: 'warehouse', to: a, quantity: 4, unplanned_reason: 'slab' });
  const id = i1.cost_moves[0];
  for (const who of [STAFF, BUYER, EXPOWNER, PMOWNER, WORKER]) {
    await refused(cdecide(db, who, id, true), 'OWNER_ONLY', who);
    await as(db, who);
    await refused(db.query(`select stk_cost_pending()`), 'OWNER_ONLY', who);
  }
  // Another company's main owner: their own stock is off; switched on, ours is not theirs.
  await refused(cdecide(db, OTHER, id, true), 'STOCK_OFF');
  await as(db, OTHER); await db.query(`select stk_set_enabled(true)`);
  await refused(cdecide(db, OTHER, id, true), 'NOT_FOUND');
  eq((await one(db, `select stk_cost_pending() x`)).x, [], 'their list is their own');
  await as(db, STAFF);
  const rec = (await one(db, `select stk_item($1) x`, [it])).x;
  const json = JSON.stringify(rec);
  assert(json.includes('"status":"pending"') && json.includes('"kind":"assign"'), 'staff see the state');
  assert(!/"value"|"estimate"/.test(json), 'staff never see a value');
  await refused(db.query(`select stk_company_stock()`), 'NOT_ALLOWED', 'company stock is for owner accounts');
  await refused(companyStock(db, EXPOWNER), 'STOCK_OFF', 'an owner account with its own scope reads its own (off)');
  eq((await companyStock(db, OWNER))[0][0], 'Cement');
  await cdecide(db, OWNER, id, true);
  for (const who of [STAFF, EXPOWNER]) await refused(creverse(db, who, id), 'OWNER_ONLY', who);
  await as(db, OWNER);
  assert(/"value":400/.test(JSON.stringify((await one(db, `select stk_item($1) x`, [it])).x)), 'the owner sees ₱400');
});

await test('a completed project: approval refused until it is reopened (Q16) — into it, out of it, or a job under it; rejecting still works', async () => {
  const db = await fresh();
  const it = await item(db, 'Cement');
  const a = await folder(db, 'Barlin'); await period(db, a);
  const aw = await folder(db, 'Extra room', { parent: a });
  await stocked(db, it, 10);
  const i1 = await move(db, STAFF, { item_id: it, from: 'warehouse', to: a, quantity: 3, unplanned_reason: 'slab' });
  const i2 = await move(db, STAFF, { item_id: it, from: 'warehouse', to: aw, quantity: 3, unplanned_reason: 'room' });
  await db.query(`update folders set completed_at = now() where id = $1`, [a]);
  await refused(cdecide(db, OWNER, i1.cost_moves[0], true), 'COMPLETED_PROJECT');
  await refused(cdecide(db, OWNER, i2.cost_moves[0], true), 'COMPLETED_PROJECT', 'a job under a completed project');
  await db.query(`update folders set completed_at = null where id = $1`, [a]);
  await cdecide(db, OWNER, i1.cost_moves[0], true);
  const b = await folder(db, 'Bagong'); await period(db, b);
  const m = await move(db, STAFF, { item_id: it, from: a, to: b, quantity: 1, unplanned_reason: 'formwork' });
  await db.query(`update folders set completed_at = now() where id = $1`, [a]);
  await refused(cdecide(db, OWNER, m.cost_moves[0], true), 'COMPLETED_PROJECT', 'out of a completed project');
  eq((await cdecide(db, OWNER, m.cost_moves[0], false, 'project closed')).status, 'rejected');
  eq(await spent(db, b), 0);
});

// ── E. Never edited: reversal (Q21–Q23) ──────────────────────────────

await test('a movement is not reversed while an approved cost move rides on it (COST_MOVED); its pending one is withdrawn', async () => {
  const db = await fresh();
  const it = await item(db, 'Cement');
  const a = await folder(db, 'Barlin'); await period(db, a);
  await stocked(db, it, 10);
  const i1 = await move(db, STAFF, { item_id: it, from: 'warehouse', to: a, quantity: 4, unplanned_reason: 'slab' });
  await reverse(db, STAFF, i1.record_id, 'wrong project');
  eq((await cost(db, i1.cost_moves[0])).status, 'withdrawn');
  await refused(cdecide(db, OWNER, i1.cost_moves[0], true), 'BAD_STATE');
  const i2 = await move(db, STAFF, { item_id: it, from: 'warehouse', to: a, quantity: 4, unplanned_reason: 'slab' });
  await cdecide(db, OWNER, i2.cost_moves[0], true);
  await refused(reverse(db, OWNER, i2.record_id, 'wrong'), 'COST_MOVED');
  await refused(creverse(db, OWNER, i2.cost_moves[0], ' '), 'REASON_REQUIRED');
  await creverse(db, OWNER, i2.cost_moves[0], 'wrong project');
  eq([await spent(db, a), (await all(db, `select 1 from expenses where stk_cost_move_id is not null`)).length], [0, 0], 'its rows are gone');
  const c = await cost(db, i2.cost_moves[0]);
  eq([c.status, c.reverse_reason, num(c.value)], ['approved', 'wrong project', 400], 'the record and its reason stay');
  await reverse(db, OWNER, i2.record_id, 'wrong project');
  eq(await bal(db, it, 'warehouse'), 10);
  await refused(creverse(db, OWNER, i2.cost_moves[0]), 'BAD_STATE', 'reversed once');
});

await test('cost reversals go newest first: a later approved move (or movement) relying on one blocks it', async () => {
  const db = await fresh();
  const it = await item(db, 'Cement');
  const a = await folder(db, 'Barlin'); await period(db, a);
  const b = await folder(db, 'Bagong'); await period(db, b);
  await stocked(db, it, 10);
  const i1 = await move(db, STAFF, { item_id: it, from: 'warehouse', to: a, quantity: 4, unplanned_reason: 'slab' });
  await cdecide(db, OWNER, i1.cost_moves[0], true);
  const m = await move(db, STAFF, { item_id: it, from: a, to: b, quantity: 4, unplanned_reason: 'formwork' });
  await cdecide(db, OWNER, m.cost_moves[0], true);
  eq([await spent(db, a), await spent(db, b)], [0, 400]);
  await refused(creverse(db, OWNER, i1.cost_moves[0]), 'LATER_MOVES_FIRST');
  await creverse(db, OWNER, m.cost_moves[0]);
  await refused(creverse(db, OWNER, i1.cost_moves[0]), 'LATER_MOVES_FIRST', 'the goods physically left A on A\'s cost');
  await reverse(db, OWNER, m.record_id, 'wrong site');
  await creverse(db, OWNER, i1.cost_moves[0]);
  eq([await spent(db, a), await spent(db, b)], [0, 0]);
  await fourPlaces(db, [a, b]);
});

await test('a purchase line\'s price or quantity cannot change while approved cost moves value its lot (Q21); other changes can', async () => {
  const db = await fresh();
  const it = await item(db, 'Cement');
  const a = await folder(db, 'Barlin'); await period(db, a);
  const b = await folder(db, 'Bagong'); await period(db, b);
  const r0 = await request(db, a, { item: it, quantity: 10 });
  const line = { folder_id: a, item_name: 'Cement', quantity: 10, amount: 1000, request_line_id: r0.line };
  const pj = await projectBuy(db, a, 'Cement', 10, { requestLine: r0.line });
  await leftover(db, STAFF, pj, 1, 5, 'warehouse');
  const m = await move(db, STAFF, { item_id: it, from: 'warehouse', to: b, quantity: 5, unplanned_reason: 'slab' });
  await cdecide(db, OWNER, m.cost_moves[0], true);
  const fix = (l, extra = {}) => { const x = body([{ ...l }], extra); delete x.lines[0].unplanned_reason; return x; };
  await as(db, OWNER);
  await refused(db.query(`select pur_correct($1, $2, $3::jsonb, 'price')`, [op(), pj, JSON.stringify(fix({ ...line, amount: 1200 }))]), 'STOCK_COST_IN_USE');
  const same = fix(line); same.supplier = 'CW Home Depot';
  await db.query(`select pur_correct($1, $2, $3::jsonb, 'supplier')`, [op(), pj, JSON.stringify(same)]);
  eq([await spent(db, a), await spent(db, b)], [500, 500], 'a supplier fix changes no peso');
  await creverse(db, OWNER, m.cost_moves[0], 'price was wrong');
  await db.query(`select pur_correct($1, $2, $3::jsonb, 'price')`, [op(), pj, JSON.stringify(fix({ ...line, amount: 1200 }))]);
  eq([await spent(db, a), await spent(db, b)], [1200, 0]);
  // Reversed to fix the price: a stock recorder asks again for the same movement.
  const again = await cresubmit(db, STAFF, m.cost_moves[0], 'price fixed');
  eq(num((await cdecide(db, OWNER, again.cost_move_id, true)).value), 600, '₱1,200 × 5/10');
  eq([await spent(db, a), await spent(db, b)], [600, 600]);
  await refused(db.query(`select pur_correct($1, $2, $3::jsonb, 'qty')`, [op(), pj, JSON.stringify(fix({ ...line, quantity: 8, amount: 1200 }))]),
                'STOCK_COST_IN_USE', 'quantity too');
  await fourPlaces(db, [a, b]);
});

await test('re-funding after a partial transfer (R81 rev 2): refused while cost moves rely on it — period totals, Cover and later transfers stay right', async () => {
  const db = await fresh();
  const it = await item(db, 'Cement');
  const a = await folder(db, 'Barlin'); const p1 = await period(db, a, 600);
  const b = await folder(db, 'Bagong'); await period(db, b);
  const c = await folder(db, 'Cubao'); await period(db, c);
  let p2 = null;
  // A's money by billing period and Cover: {"p1|false": 480, …}
  const groups = async () => {
    const rows = await all(db, `select e.project_id p, e.cover_expense c, sum(e.amount) s from expenses e left join projects pp on pp.id = e.project_id
                                 where coalesce(e.folder_id, pp.folder_id) = $1 group by 1, 2`, [a]);
    const out = {};
    for (const r of rows) out[(r.p === p1 ? 'p1' : r.p === p2 ? 'p2' : r.p ? 'other' : 'none') + '|' + r.c] = Math.round(num(r.s) * 100) / 100;
    return Object.fromEntries(Object.entries(out).filter(([, v]) => v !== 0).sort());
  };
  const refund = () => rpc(db, OWNER, 'pur_refund', [op(), pj, 'billing periods re-checked']);
  const pj = await projectBuy(db, a, 'Cement', 10);            // ₱1,000 → ₱600 billing #1, ₱400 Cover
  await match(db, STAFF, pj, 1, it, 10);
  eq(await groups(), { 'p1|false': 600, 'p1|true': 400 });
  await refund();                                               // nothing relies on it yet: allowed
  eq(await groups(), { 'p1|false': 600, 'p1|true': 400 });
  await leftover(db, STAFF, pj, 1, 5, 'warehouse');
  const m1 = await move(db, STAFF, { item_id: it, from: 'warehouse', to: b, quantity: 2, unplanned_reason: 'slab' });
  eq(num((await cdecide(db, OWNER, m1.cost_moves[0], true)).value), 200);
  eq(await groups(), { 'p1|false': 480, 'p1|true': 320 }, '₱200 off in proportion: ₱120 period, ₱80 Cover');
  // The transfer freed ₱120 of billing #1, so re-funding would now move rows: refused.
  await refused(refund(), 'STOCK_COST_FUNDING', 'freed budget');
  // A second billing period this month would take the Cover part: refused too; a correction that re-funds as well.
  p2 = await periodOn(db, a, TODAY, 1000, 2);
  await refused(refund(), 'STOCK_COST_FUNDING', 'a new billing period');
  const fix = body([{ folder_id: a, item_name: 'Cement', quantity: 10, amount: 1000 }]); fix.supplier = 'CW Home Depot';
  await refused(rpc(db, OWNER, 'pur_correct', [op(), pj, JSON.stringify(fix), 'supplier']), 'STOCK_COST_FUNDING', 'a supplier fix that re-funds');
  eq(await groups(), { 'p1|false': 480, 'p1|true': 320 }, 'nothing moved');
  eq((await all(db, `select kind from purchase_history where purchase_id = $1 order by id`, [pj])).map(r => r.kind), ['recorded', 'refunded'],
     'the refusals left no history');
  // A later transfer while it stands: off the same groups, in proportion.
  const m2 = await move(db, STAFF, { item_id: it, from: 'warehouse', to: c, quantity: 2, unplanned_reason: 'slab' });
  eq(num((await cdecide(db, OWNER, m2.cost_moves[0], true)).value), 200);
  eq(await groups(), { 'p1|false': 360, 'p1|true': 240 });
  eq([await spent(db, b), await spent(db, c)], [200, 200]);
  await fourPlaces(db, [a, b, c]);
  // Reverse both (newest first): now the re-fund goes through — ₱600 billing #1, ₱400 billing #2, no Cover.
  await creverse(db, OWNER, m2.cost_moves[0], 'to re-fund');
  await creverse(db, OWNER, m1.cost_moves[0], 'to re-fund');
  await refund();
  eq(await groups(), { 'p1|false': 600, 'p2|false': 400 });
  // Asked again and approved: off the new groups — no Cover left to reduce.
  const again = await cresubmit(db, STAFF, m1.cost_moves[0], 'after re-funding');
  eq(num((await cdecide(db, OWNER, again.cost_move_id, true)).value), 200);
  eq(await groups(), { 'p1|false': 480, 'p2|false': 320 });
  await refused(refund(), 'STOCK_COST_FUNDING', 'relied on again');
  await fourPlaces(db, [a, b, c]);
});

// ── F. Company stock loss (Q27) ──────────────────────────────────────

await test('a confirmed warehouse loss of company goods: value to company stock loss with the count — no Spent anywhere; reversed with it', async () => {
  const db = await fresh();
  const it = await item(db, 'Cement');
  const a = await folder(db, 'Barlin'); await period(db, a);
  const pid = await stocked(db, it, 10);
  const before = await money(db);
  const c = await count(db, STAFF, { item_id: it, at: 'warehouse', counted: 7, reason: 'damaged' });
  eq((await costsOf(db, c.record_id)).length, 0, 'nothing until the main owner confirms');
  await decide(db, OWNER, c.record_id, true);
  const loss = await costsOf(db, c.record_id);
  eq(loss.map(x => [x.kind, x.status, num(x.approved_quantity), num(x.value), x.location]), [['loss', 'approved', 3, 300, null]]);
  eq(await money(db), before, 'no expense row');
  eq(await companyStock(db), [['Cement', 7, 700, 0, 0, 0, 3, 300]]);
  await reverse(db, OWNER, c.record_id, 'found them');
  eq((await cost(db, loss[0].id)).reversed_at !== null, true);
  eq(await companyStock(db), [['Cement', 10, 1000, 0, 0, 0, 0, 0]]);
  // A project's own leftovers lost: they stay its cost — no loss move.
  const r0 = await request(db, a, { item: it, quantity: 4 });
  const pj = await projectBuy(db, a, 'Cement', 4, { requestLine: r0.line });
  await leftover(db, STAFF, pj, 1, 4, 'site');
  const c2 = await count(db, STAFF, { item_id: it, at: a, counted: 1, reason: 'lost' });
  await decide(db, OWNER, c2.record_id, true);
  eq((await costsOf(db, c2.record_id)).length, 0);
  eq(await spent(db, a), 400);
  await fourPlaces(db, [a]);
  void pid;
});

await test('untraced old stock is ₱0 and never asks for a cost move (Q13)', async () => {
  const db = await fresh();
  const it = await item(db, 'Cement');
  const a = await folder(db, 'Barlin'); await period(db, a);
  const o = await opening(db, STAFF, { item_id: it, at: 'warehouse', quantity: 20 });
  await decide(db, OWNER, o.record_id, true);
  const m = await move(db, STAFF, { item_id: it, from: 'warehouse', to: a, quantity: 5, unplanned_reason: 'slab' });
  eq(m.cost_moves, []);
  const c = await count(db, STAFF, { item_id: it, at: 'warehouse', counted: 10, reason: 'other' });
  await decide(db, OWNER, c.record_id, true);
  eq((await all(db, `select 1 from stk_cost_moves`)).length, 0);
  eq(await companyStock(db), [], 'untraced goods are not company stock value');
});

// ── G. The money, everywhere ─────────────────────────────────────────

await test('a busy day: every peso of every line in exactly one place — company stock, a project, or company stock loss', async () => {
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
  await ok(await move(db, STAFF, { item_id: it, from: 'warehouse', to: cc, quantity: 4, unplanned_reason: 'x' }));
  await ok(await move(db, STAFF, { item_id: it, from: cc, to: b, quantity: 2, unplanned_reason: 'formwork' }));
  const cnt = await count(db, STAFF, { item_id: it, at: 'warehouse', counted: 0, reason: 'damaged' });
  if (cnt.status === 'pending') await decide(db, OWNER, cnt.record_id, true);
  await fourPlaces(db, [a, b, cc]);
  const total = await one(db, `select coalesce(sum(amount), 0) s from expenses where stk_cost_move_id is not null`);
  assert(Math.abs(num(total.s)) > 0, 'cost moves wrote rows');
  for (const [nm, x] of await all(db, `select split_group, sum(split_total) from expenses where split_group like 'stkcost:%' group by 1`).then(r => r.map(y => [y.split_group, 0]))) void nm, x;
});

await test('deleting is guarded: cost-move rows are never edited or deleted by hand; a project or billing period holding stock is never deleted', async () => {
  const db = await fresh();
  const it = await item(db, 'Cement');
  const a = await folder(db, 'Barlin'); const p = await period(db, a);
  const b = await folder(db, 'Bagong');
  await stocked(db, it, 10);
  const i1 = await move(db, STAFF, { item_id: it, from: 'warehouse', to: a, quantity: 4, unplanned_reason: 'slab' });
  await cdecide(db, OWNER, i1.cost_moves[0], true);
  const e = (await one(db, `select id from expenses where stk_cost_move_id is not null`)).id;
  await refused(db.query(`update expenses set amount = 1 where id = $1`, [e]), 'STOCK_COST_ROW');
  await refused(db.query(`update expenses set expense_name = 'x' where id = $1`, [e]), 'STOCK_COST_ROW');
  await refused(db.query(`delete from expenses where id = $1`, [e]), 'STOCK_COST_ROW');
  await refused(db.query(`insert into expenses (owner_id, project_id, amount, stk_cost_move_id) values ($1, $2, 5, $3)`,
                         [OWNER, p, i1.cost_moves[0]]), 'STOCK_COST_ROW');
  await refused(db.query(`delete from projects where id = $1`, [p]), 'STOCK_LIVE');
  await refused(db.query(`delete from folders where id = $1`, [a]), 'STOCK_LIVE');
  // A project with only a pending request (goods still at its site) is held too.
  await move(db, STAFF, { item_id: it, from: 'warehouse', to: b, quantity: 1, unplanned_reason: 'x' });
  await refused(db.query(`delete from folders where id = $1`, [b]), 'STOCK_LIVE');
  // An ordinary expense row is untouched by all this.
  await db.query(`insert into expenses (owner_id, project_id, amount, expense_name) values ($1, $2, 50, 'Nails')`, [OWNER, p]);
  await db.query(`delete from expenses where expense_name = 'Nails'`);
});

await test('stock off: nothing can be decided; the Owner approvals list is empty; company stock is not read', async () => {
  const db = await fresh();
  const it = await item(db, 'Cement');
  const a = await folder(db, 'Barlin'); await period(db, a);
  await stocked(db, it, 10);
  const i1 = await move(db, STAFF, { item_id: it, from: 'warehouse', to: a, quantity: 4, unplanned_reason: 'slab' });
  await as(db, OWNER); await db.query(`select stk_set_enabled(false)`);
  await refused(cdecide(db, OWNER, i1.cost_moves[0], true), 'STOCK_OFF');
  await refused(creverse(db, OWNER, i1.cost_moves[0]), 'STOCK_OFF');
  await refused(cresubmit(db, STAFF, i1.cost_moves[0]), 'STOCK_OFF');
  await as(db, OWNER);
  eq((await one(db, `select stk_cost_pending() x`)).x, []);
  await refused(db.query(`select stk_company_stock()`), 'STOCK_OFF');
});

await test('a retried approval records once and returns the first answer', async () => {
  const db = await fresh();
  const it = await item(db, 'Cement');
  const a = await folder(db, 'Barlin'); await period(db, a);
  await stocked(db, it, 10);
  const i1 = await move(db, STAFF, { item_id: it, from: 'warehouse', to: a, quantity: 4, unplanned_reason: 'slab' });
  await as(db, OWNER);
  const o = op();
  const r1 = (await one(db, `select stk_cost_decide($1, $2, true, 'ok') r`, [o, i1.cost_moves[0]])).r;
  const r2 = (await one(db, `select stk_cost_decide($1, $2, true, 'ok') r`, [o, i1.cost_moves[0]])).r;
  eq([r2.cost_move_id, r2.replayed, num(r2.value)], [r1.cost_move_id, true, 400]);
  eq(await spent(db, a), 400, 'once');
});

await test('permissions: the five new calls for authenticated only; stk_cost_moves has RLS and no policy; helpers are internal', async () => {
  const db = await fresh();
  for (const f of ['stk_cost_decide(uuid,uuid,boolean,text)', 'stk_cost_reverse(uuid,uuid,text)', 'stk_cost_resubmit(uuid,uuid,text)',
                   'stk_cost_pending()', 'stk_company_stock()', 'stk_move(uuid,jsonb)', 'stk_decide(uuid,uuid,boolean,text)',
                   'stk_reverse(uuid,uuid,text)']) {
    eq([f, (await one(db, `select has_function_privilege('authenticated', $1, 'execute') x`, [f])).x,
        (await one(db, `select has_function_privilege('anon', $1, 'execute') x`, [f])).x], [f, true, false]);
  }
  for (const f of ['stk_bucket_balance(uuid,uuid,uuid,uuid)', 'stk_buckets(uuid,uuid)', 'stk_lot_basis(uuid)', 'stk_held(uuid,uuid)',
                   'stk_cost_value(uuid,uuid,numeric)', 'stk_cost_effective(uuid)', 'stk_cost_requests(uuid)', 'stk_cost_losses(uuid)',
                   'stk_cost_carriers(uuid,uuid)', 'stk_cost_rows(uuid)', 'stk_cost_json(uuid)', 'stk_folder_name(uuid)',
                   'stk_folder_completed(uuid)', 'stk_take(uuid,uuid,uuid,numeric,uuid)', 'stk_check_record(uuid)',
                   'stk_record_json(uuid)', 'stk_moves_holder()', 'stk_guard_cost_basis()', 'pur_guard_expense_row()', 'pur_guard_delete()']) {
    eq([f, (await one(db, `select has_function_privilege('authenticated', $1, 'execute') x`, [f])).x], [f, false]);
  }
  const r = await one(db, `select relrowsecurity rls, (select count(*) from pg_policies where tablename = 'stk_cost_moves') n
                             from pg_class where relname = 'stk_cost_moves'`);
  eq([r.rls, num(r.n)], [true, 0]);
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) { console.log('\nFAILURES:\n  ' + failures.join('\n  ')); process.exit(1); }
