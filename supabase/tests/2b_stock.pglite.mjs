// ════════════════════════════════════════════════════════════════════
// STAGE 2B-a STOCK — BEHAVIOUR TESTS ON PGLITE
//   npm run test:sql
//
// Runs migrations 0096, 0097, 0101, 0102, 0103 and 0104 VERBATIM on PGlite
// (PostgreSQL in memory) over the same minimal tables as the 2A-4 suite.
// Nothing here talks to the live database; supabase/tests/2b_acceptance.sql
// repeats the key cases there, rolled back.
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
// --with-0105: and 2C's 0105 (cost moves) on top — every 2B-a behaviour holds.
// --with-0107: and 3a's 0107 (tools) on top of 0105, switched ON — every 2B-a behaviour holds for materials.
const WITH_0107 = process.argv.includes('--with-0107');
const M107 = WITH_0107 ? mig('0107_tools.sql') : '';
const WITH_0105 = process.argv.includes('--with-0105') || WITH_0107;
const M105 = WITH_0105 ? mig('0105_stock_cost_moves.sql') : '';

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
  if (WITH_0105) await db.exec(M105);
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
  if (WITH_0107) await db.query(`select tl_set_enabled(true)`);
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

console.log('\n2B-a stock (0096 + 0097 + 0101 + 0102 + 0103 + 0104' + (WITH_0105 ? ' + 0105' : '') + (WITH_0107 ? ' + 0107' : '') + ' on PGlite)');

// ── A. The switch, and who ────────────────────────────────────────────

await test('stock off: every write and read is refused STOCK_OFF, status says off; purchases work as before', async () => {
  const db = await fresh({ on: false });
  const it = await item(db, 'Cement');
  const pid = await warehouseBuy(db, 'Cement', 10);
  for (const [fn, args] of [['stk_match', [op(), pid, 1, it, '10', null]], ['stk_receive', [op(), pid, 1, '1', TODAY, '']],
                            ['stk_not_delivered', [op(), pid, 1, '1', 'x']], ['stk_leftover', [op(), pid, 1, '1', 'site', TODAY, '']],
                            ['stk_move', [op(), '{}']], ['stk_count', [op(), '{}']], ['stk_opening', [op(), '{}']],
                            ['stk_reverse', [op(), pid, 'x']], ['stk_decide', [op(), pid, true, 'x']]]) {
    await refused(rpc(db, OWNER, fn, args), 'STOCK_OFF', fn);
  }
  for (const fn of ['stk_overview()', 'stk_choices()']) await refused(db.query(`select ${fn}`), 'STOCK_OFF', fn);
  const status = async (who) => { await as(db, who); const s = (await one(db, `select stk_status() s`)).s;
                                  return [s.enabled, s.can_record, s.is_main_owner, s.is_owner, s.user_id]; };
  eq(await status(STAFF), [false, true, false, false, STAFF]);
  eq(await status(OWNER), [false, true, true, true, OWNER]);
  eq(await status(EXPOWNER), [false, true, false, true, EXPOWNER]);
  eq(await status(WORKER), [false, false, false, false, WORKER]);
});

await test('only the main owner switches stock on or off; each change is an event', async () => {
  const db = await fresh({ on: false });
  for (const who of [STAFF, BUYER, EXPOWNER, PMOWNER, WORKER]) {
    await as(db, who);
    await refused(db.query(`select stk_set_enabled(true)`), 'OWNER_ONLY', who);
  }
  await as(db, OWNER);
  await db.query(`select stk_set_enabled(true)`);
  await db.query(`select stk_set_enabled(true)`);
  await db.query(`select stk_set_enabled(false)`);
  eq((await all(db, `select detail ->> 'enabled' e from stk_events where kind = 'switched' order by id`)).map(r => r.e), ['true', 'false'],
     'a repeat is not a change');
  await as(db, STAFF);
  eq((await one(db, `select stk_status() s`)).s.enabled, false);
});

await test('who records: owner, office staff and Buyer staff — not workers, team leaders, PM-only accounts or another company', async () => {
  const db = await fresh();
  const it = await item(db, 'Cement');
  const f = await folder(db, 'Barlin');
  for (const who of [OWNER, STAFF, BUYER]) {
    const r = await opening(db, who, { item_id: it, at: 'warehouse', quantity: 1 });
    eq(r.status, 'pending', who);
  }
  await refused(opening(db, WORKER, { item_id: it, at: 'warehouse', quantity: 1 }), 'NOT_OFFICE');
  await refused(opening(db, LEADER, { item_id: it, at: 'warehouse', quantity: 1 }), 'NOT_OFFICE');
  await refused(opening(db, PMSTAFF, { item_id: it, at: 'warehouse', quantity: 1 }), 'NOT_ALLOWED');
  await refused(opening(db, PMOWNER, { item_id: it, at: 'warehouse', quantity: 1 }), 'NOT_ALLOWED');
  await refused(opening(db, OTHER, { item_id: it, at: 'warehouse', quantity: 1 }), 'STOCK_OFF', 'their company has stock off');
  await as(db, OTHER); await db.query(`select stk_set_enabled(true)`);
  await refused(opening(db, OTHER, { item_id: it, at: 'warehouse', quantity: 1 }), 'BAD_ITEM', 'another company\'s item');
  await refused(opening(db, OTHER, { item_id: await item(db, 'Sand', 'bag', OTHER), at: f, quantity: 1 }), 'BAD_PROJECT', 'another company\'s project');
  for (const who of [WORKER, LEADER, PMSTAFF]) {
    await as(db, who);
    await refused(db.query(`select stk_overview()`), 'NOT_ALLOWED', who);
    eq((await one(db, `select stk_status() s`)).s.enabled, false, who + ' sees no stock');
  }
});

// ── B. Receiving, matching, not delivered ─────────────────────────────

await test('a warehouse line waits to be matched and received; receipts in parts; awaiting goes down; stock only once matched', async () => {
  const db = await fresh();
  const it = await item(db, 'Cement');
  const pid = await warehouseBuy(db, 'Cement', 20);
  await as(db, STAFF);
  let ov = (await one(db, `select stk_overview() o`)).o;
  eq(ov.awaiting.length, 1);
  eq([num(ov.awaiting[0].awaiting), ov.awaiting[0].match, ov.awaiting[0].suggested_item_id], [20, null, it], 'one-click suggestion');
  await receive(db, BUYER, pid, 1, 12);
  eq(await bal(db, it, 'warehouse'), 0, 'received but not matched: not stock yet');
  await match(db, STAFF, pid, 1, it, 20);
  eq(await bal(db, it, 'warehouse'), 12, 'matched: the 12 received are stock');
  await receive(db, STAFF, pid, 1, 5);
  eq(await bal(db, it, 'warehouse'), 17);
  ov = (await one(db, `select stk_overview() o`)).o;
  eq([num(ov.awaiting[0].received), num(ov.awaiting[0].awaiting)], [17, 3]);
  await refused(receive(db, BUYER, pid, 1, 4), 'MORE_THAN_AWAITED');
  await receive(db, BUYER, pid, 1, 3);
  ov = (await one(db, `select stk_overview() o`)).o;
  eq(ov.awaiting.length, 0, 'all received and matched: off the list');
  eq(ov.items.map(i => [i.name, num(i.total)]), [['Cement', 20]]);
});

await test('a different unit: the office says how many item units the line is; partial receipts convert, the whole line is exact', async () => {
  const db = await fresh();
  const pcs = await item(db, 'Tie wire', 'piece');
  const pid = await warehouseBuy(db, 'Tie wire box', 3, { unit: 'box' });
  await refused(match(db, STAFF, pid, 1, pcs, 100), 'REASON_REQUIRED', 'a different unit needs a note');
  await refused(match(db, BUYER, pid, 1, pcs, 100, '3 boxes = 100 pcs'), 'OWN_PURCHASE', 'never by the buyer who bought it');
  await match(db, STAFF, pid, 1, pcs, 100, '3 boxes = 100 pcs');
  await receive(db, BUYER, pid, 1, 1);
  eq(await bal(db, pcs, 'warehouse'), 33.333, '1 of 3 boxes');
  await receive(db, BUYER, pid, 1, 1);
  eq(await bal(db, pcs, 'warehouse'), 66.667, '2 of 3 boxes: from the running total, not 33.333 + 33.333');
  await receive(db, BUYER, pid, 1, 1);
  eq(await bal(db, pcs, 'warehouse'), 100, 'all 3 boxes, one at a time: exactly 100, no rounding drift');
  // The owner may check their own purchase.
  const own = await warehouseBuy(db, 'Tie wire box', 1, { unit: 'box', who: OWNER });
  await match(db, OWNER, own, 1, pcs, 50, '1 box = 50 pcs');
});

await test('three boxes entered separately total exactly 100 pieces — even with their receipt dates out of order, backdated, reversed and received again', async () => {
  const db = await fresh();
  const pcs = await item(db, 'Tie wire', 'piece');
  const pid = await warehouseBuy(db, 'Tie wire box', 3, { unit: 'box' });
  await match(db, STAFF, pid, 1, pcs, 100, '3 boxes = 100 pcs');
  // Each box's own quantity, by receipt; existing ones must never change.
  const layerQty = async () => Object.fromEntries((await all(db,
    `select m.record_id, m.quantity from stk_moves m join stk_records r on r.id = m.record_id
      where r.purchase_id = $1 and r.kind = 'receive' and r.status = 'done' and r.reversed_at is null`, [pid]))
    .map(x => [x.record_id, num(x.quantity)]));
  const b1 = await receive(db, BUYER, pid, 1, 1, phDate(-1));
  eq(await layerQty(), { [b1.record_id]: 33.333 });
  const b2 = await receive(db, BUYER, pid, 1, 1, phDate(-2));        // received BEFORE box 1, entered after
  eq(await layerQty(), { [b1.record_id]: 33.333, [b2.record_id]: 33.334 }, 'box 1 unchanged; box 2 = 66.667 − 33.333');
  const b3 = await receive(db, BUYER, pid, 1, 1, phDate(-3));        // received first of all, entered last
  eq(await layerQty(), { [b1.record_id]: 33.333, [b2.record_id]: 33.334, [b3.record_id]: 33.333 }, 'box 3 = 100 − 66.667');
  eq(await bal(db, pcs, 'warehouse'), 100, 'exactly 100 pieces');
  // Reversed, then received again (backdated further still): back to exactly 100, the others untouched.
  await reverse(db, BUYER, b2.record_id, 'entered twice');
  eq(await bal(db, pcs, 'warehouse'), 66.666, 'two boxes left');
  const b4 = await receive(db, BUYER, pid, 1, 1, phDate(-10));
  eq(await layerQty(), { [b1.record_id]: 33.333, [b3.record_id]: 33.333, [b4.record_id]: 33.334 }, 'box 4 = 100 − 66.666');
  eq(await bal(db, pcs, 'warehouse'), 100, 'exactly 100 again');
  // Received before the match, dates out of order: at the match the whole line is exactly 100 too.
  const late = await warehouseBuy(db, 'Tie wire box', 3, { unit: 'box' });
  for (const d of [-1, -3, -2]) await receive(db, BUYER, late, 1, 1, phDate(d));
  const before = await bal(db, pcs, 'warehouse');
  await match(db, STAFF, late, 1, pcs, 100, '3 boxes = 100 pcs');
  eq(Math.round((await bal(db, pcs, 'warehouse') - before) * 1000) / 1000, 100, 'matched afterwards: exactly 100');
});

await test('the same unit counts one for one; a match can change until stock counts anything under it, then it is fixed', async () => {
  const db = await fresh();
  const a = await item(db, 'Cement');
  const b = await item(db, 'Cement 40kg');
  const pid = await warehouseBuy(db, 'Cement', 10);
  await refused(match(db, STAFF, pid, 1, a, 9), 'BAD_QUANTITY', 'same unit: covers = the line quantity');
  await match(db, STAFF, pid, 1, a, 10);
  await match(db, STAFF, pid, 1, b, 10);
  await match(db, STAFF, pid, 1, a, 10);
  const r = await receive(db, STAFF, pid, 1, 4);
  eq(await bal(db, a, 'warehouse'), 4, 'received under the match: stock');
  await refused(match(db, STAFF, pid, 1, b, 10), 'STOCK_IN_USE', 'goods already counted under it');
  await reverse(db, STAFF, r.record_id, 'wrong item');
  await match(db, STAFF, pid, 1, b, 10);
  await receive(db, STAFF, pid, 1, 10);
  eq([await bal(db, a, 'warehouse'), await bal(db, b, 'warehouse')], [0, 10], 'only the live receipt counts, under the new match');
  await refused(match(db, STAFF, pid, 1, a, 10), 'STOCK_IN_USE');
  eq((await all(db, `select kind from stk_events where purchase_id = $1 and kind = 'matched' order by id`, [pid])).length, 4);
});

await test('a catalogue item\'s kind and unit are fixed once stock uses it — a match is enough, no request needed', async () => {
  const db = await fresh();
  const used = await item(db, 'Cement');
  const pending = await item(db, 'Sand');
  const free = await item(db, 'Gravel');
  const onlyMatched = await item(db, 'Tiles');
  const pid = await warehouseBuy(db, 'Cement', 10);
  await match(db, STAFF, pid, 1, used, 10);
  await opening(db, STAFF, { item_id: pending, at: 'warehouse', quantity: 3 });
  // A project line matched and nothing more: no lot, no stock record — the match alone fixes it.
  const f = await folder(db, 'Barlin'); await period(db, f);
  const pj = await projectBuy(db, f, 'Tiles', 4);
  await match(db, STAFF, pj, 1, onlyMatched, 4);
  eq(num((await one(db, `select count(*) n from stk_lots where item_id = $1`, [onlyMatched])).n), 0, 'no lot yet');
  const save = (id, kind, name, unit) => rpc(db, STAFF, 'pr_office_save_item', [id, kind, name, '', unit, '', true, null, null]);
  for (const id of [used, pending, onlyMatched]) {
    await refused(save(id, 'material', 'x', 'kg'), 'ITEM_IN_USE', 'unit');
    await refused(save(id, 'tool', 'x', 'bag'), 'ITEM_IN_USE', 'kind');
  }
  await save(used, 'material', 'Portland cement', 'bag');
  eq((await one(db, `select name, unit from pr_catalog_items where id = $1`, [used])), { name: 'Portland cement', unit: 'bag' },
     'the name, spec, category and so on stay editable');
  await save(free, 'material', 'Gravel', 'cu m');
  await db.exec(`reset role`);
  await refused(db.query(`update pr_catalog_items set unit = 'kg' where id = $1`, [used]), 'ITEM_IN_USE', 'no path around the save');
  await refused(db.query(`update pr_catalog_items set kind = 'tool' where id = $1`, [pending]), 'ITEM_IN_USE');
  await as(db, STAFF);
  const cat = (await one(db, `select pr_office_catalog() c`)).c;
  eq([used, pending, onlyMatched, free].map(id => cat.find(c => c.id === id).in_use), [true, true, true, false], 'the catalogue form locks the two fields');
  // A request line still locks it too (0092), and an item no longer matched is free again.
  const other = await item(db, 'Wire');
  await match(db, STAFF, pid, 1, other, 10);
  await save(used, 'material', 'Portland cement', 'sack');
});

await test('not delivered: the office closes the rest with a reason; it never silently disappears', async () => {
  const db = await fresh();
  const it = await item(db, 'Cement');
  const pid = await warehouseBuy(db, 'Cement', 10);
  await match(db, STAFF, pid, 1, it, 10);
  await receive(db, BUYER, pid, 1, 6);
  await refused(notDelivered(db, STAFF, pid, 1, 4, ''), 'REASON_REQUIRED');
  await refused(notDelivered(db, STAFF, pid, 1, 5), 'MORE_THAN_AWAITED');
  await notDelivered(db, STAFF, pid, 1, 4);
  await refused(receive(db, BUYER, pid, 1, 1), 'MORE_THAN_AWAITED', 'closed');
  await as(db, STAFF);
  eq((await one(db, `select stk_overview() o`)).o.awaiting.length, 0);
  const rec = (await one(db, `select stk_overview() o`)).o.recent.find(r => r.kind === 'not_delivered');
  eq([num(rec.quantity), rec.reason], [4, 'supplier ran out']);
  eq(await bal(db, it, 'warehouse'), 6);
});

await test('receiving and closing are for warehouse lines of recorded purchases only', async () => {
  const db = await fresh();
  const f = await folder(db, 'Barlin'); await period(db, f);
  const pj = await projectBuy(db, f, 'Cement', 5);
  await refused(receive(db, BUYER, pj, 1, 1), 'NOT_WAREHOUSE');
  await refused(notDelivered(db, STAFF, pj, 1, 1), 'NOT_WAREHOUSE');
  const pid = await warehouseBuy(db, 'Cement', 5);
  await refused(receive(db, BUYER, pid, 2, 1), 'NOT_FOUND');
  await refused(receive(db, BUYER, pid, 1, 0), 'BAD_QUANTITY');
  await refused(receive(db, BUYER, pid, 1, '1.2345'), 'BAD_QUANTITY');
  await refused(receive(db, BUYER, pid, 1, 1, phDate(1)), 'BAD_DATE', 'not tomorrow');
  await as(db, OWNER);
  await db.query(`select pur_void($1, $2, 'wrong')`, [op(), pid]);
  await refused(receive(db, BUYER, pid, 1, 1), 'NOT_FOUND', 'a voided purchase');
});

// ── C. Issuing, requests, returns, moves ──────────────────────────────

await test('an issue fills a request line ("From stock"): Still to buy drops; Bought stays purchases only; the warehouse hint shows', async () => {
  const db = await fresh();
  const it = await item(db, 'Cement');
  const f = await folder(db, 'Barlin'); await period(db, f);
  await stocked(db, it, 20);
  const r = await request(db, f, { item: it, quantity: 10 });
  await as(db, BUYER);
  let l = (await one(db, `select pur_shopping_list(null, null, 'all') l`)).l.find(x => x.line_id === r.line);
  eq([num(l.in_warehouse), l.in_warehouse_unit, num(l.still_to_buy)], [20, 'bag', 10], 'the hint before the issue');
  const res = await move(db, STAFF, { item_id: it, from: 'warehouse', to: f, quantity: 6, request_line_id: r.line });
  eq(res.kind, 'issue');
  eq(await still(db, r.line), 4);
  await as(db, BUYER);
  l = (await one(db, `select pur_shopping_list(null, null, 'all') l`)).l.find(x => x.line_id === r.line);
  eq([num(l.bought), num(l.from_stock), num(l.still_to_buy), num(l.in_warehouse)], [0, 6, 4, 14]);
  eq([num(l.portions[0].bought), num(l.portions[0].from_stock), num(l.portions[0].still_to_buy)], [0, 6, 4]);
  eq([await bal(db, it, 'warehouse'), await bal(db, it, f)], [14, 6]);
  // A purchase afterwards covers only what is still needed (the rest is extra, with a reason).
  await refused(projectBuy(db, f, 'Cement', 5, { requestLine: r.line }), 'EXTRA_REASON_REQUIRED');
  await projectBuy(db, f, 'Cement', 4, { requestLine: r.line });
  eq(await still(db, r.line), 0);
  await as(db, BUYER);
  l = (await one(db, `select pur_shopping_list(null, null, 'all') l`)).l.find(x => x.line_id === r.line);
  eq([num(l.bought), num(l.from_stock), num(l.still_to_buy)], [4, 6, 0]);
});

await test('an issue to a project names a request line or an unplanned reason; the request must fit', async () => {
  const db = await fresh();
  const it = await item(db, 'Cement');
  const other = await item(db, 'Sand');
  const f = await folder(db, 'Barlin');
  const g = await folder(db, 'Prado');
  await stocked(db, it, 50);
  const r = await request(db, f, { item: it, quantity: 10 });
  await refused(move(db, STAFF, { item_id: it, from: 'warehouse', to: f, quantity: 1 }), 'UNPLANNED_REASON_REQUIRED');
  await refused(move(db, STAFF, { item_id: it, from: 'warehouse', to: g, quantity: 1, request_line_id: r.line }), 'BAD_REQUEST_LINK', 'another project\'s request');
  await refused(move(db, STAFF, { item_id: it, from: 'warehouse', to: f, quantity: 11, request_line_id: r.line }), 'REQUEST_EXCEEDED');
  const rs = await request(db, f, { item: other, quantity: 10 });
  await refused(move(db, STAFF, { item_id: it, from: 'warehouse', to: f, quantity: 1, request_line_id: rs.line }), 'ITEM_MISMATCH');
  const ru = await request(db, f, { quantity: 10, unit: 'kg' });
  await refused(move(db, STAFF, { item_id: it, from: 'warehouse', to: f, quantity: 1, request_line_id: ru.line }), 'UNIT_MISMATCH');
  await db.exec(`reset role`);
  await db.query(`update pr_lines set status = 'cancelled' where id = $1`, [ru.line]);
  const rn = await request(db, f, { quantity: 10 });   // no catalogue item, same unit: allowed
  await move(db, STAFF, { item_id: it, from: 'warehouse', to: f, quantity: 3, request_line_id: rn.line });
  await db.query(`update pr_lines set status = 'cancelled' where id = $1`, [rn.line]);
  await refused(move(db, STAFF, { item_id: it, from: 'warehouse', to: f, quantity: 1, request_line_id: rn.line }), 'LINE_CLOSED');
  await move(db, STAFF, { item_id: it, from: 'warehouse', to: f, quantity: 2, unplanned_reason: 'formwork' });
  eq(await bal(db, it, f), 5);
});

await test('picked portions are the only ones filled; without picks the earliest week first', async () => {
  const db = await fresh();
  const it = await item(db, 'Cement');
  const f = await folder(db, 'Barlin');
  await stocked(db, it, 50);
  const r = await request(db, f, { item: it, quantity: 4 });
  await db.exec(`reset role`);
  const later = (await one(db, `select pr_batch_for($1, now() + interval '8 days') b`, [OWNER])).b;
  const p2 = (await one(db, `insert into pr_line_portions (owner_id, line_id, batch_id, quantity) values ($1, $2, $3, 6) returning id`,
    [OWNER, r.line, later])).id;
  await move(db, STAFF, { item_id: it, from: 'warehouse', to: f, quantity: 5, request_line_id: r.line });
  eq((await all(db, `select portion_id, quantity from stk_covers order by id`)).map(c => [c.portion_id, num(c.quantity)]),
     [[r.portion, 4], [p2, 1]], 'this week first, then next');
  await refused(move(db, STAFF, { item_id: it, from: 'warehouse', to: f, quantity: 2, request_line_id: r.line,
                                  portion_picks: [{ portion_id: r.portion, quantity: '2' }] }), 'REQUEST_EXCEEDED', 'that portion is full');
  await move(db, STAFF, { item_id: it, from: 'warehouse', to: f, quantity: 2, request_line_id: r.line,
                          portion_picks: [{ portion_id: p2, quantity: '2' }] });
  eq(await still(db, r.line), 3);
});

await test('lots: oldest received first, across purchases; a named lot is honoured; never more than is there', async () => {
  const db = await fresh();
  const it = await item(db, 'Cement');
  const f = await folder(db, 'Barlin');
  const old = await stocked(db, it, 5, { date: phDate(-3) });
  const neu = await stocked(db, it, 10, { date: phDate(-1) });
  const lotOf = async (pid) => (await one(db, `select id from stk_lots where purchase_id = $1`, [pid])).id;
  const r1 = await move(db, STAFF, { item_id: it, from: 'warehouse', to: f, quantity: 7, unplanned_reason: 'slab' });
  eq(r1.lots.map(x => [x.lot_id, num(x.quantity)]), [[await lotOf(old), 5], [await lotOf(neu), 2]]);
  await refused(move(db, STAFF, { item_id: it, from: 'warehouse', to: f, quantity: 1, unplanned_reason: 'x', lot_id: await lotOf(old) }), 'NOT_ENOUGH');
  const r2 = await move(db, STAFF, { item_id: it, from: 'warehouse', to: f, quantity: 3, unplanned_reason: 'x', lot_id: await lotOf(neu) });
  eq(r2.lots.map(x => num(x.quantity)), [3]);
  await refused(move(db, STAFF, { item_id: it, from: 'warehouse', to: f, quantity: 6, unplanned_reason: 'x' }), 'NOT_ENOUGH');
  await refused(move(db, STAFF, { item_id: it, from: 'warehouse', to: f, quantity: 1, unplanned_reason: 'x',
                                  lot_id: '00000000-0000-0000-0000-000000000001' }), 'BAD_LOT');
  eq([await bal(db, it, 'warehouse'), await bal(db, it, f)], [5, 10]);
});

await test('oldest RECEIVED first, by delivery: a late part delivery of an old purchase goes after an earlier delivery of a newer one', async () => {
  const db = await fresh();
  const it = await item(db, 'Cement');
  const f = await folder(db, 'Barlin');
  // A: bought 10 days ago, 5 arrive 8 days ago, the other 5 two days ago.
  const a = await warehouseBuy(db, 'Cement', 10, { date: phDate(-10) });
  await match(db, OWNER, a, 1, it, 10);
  await receive(db, BUYER, a, 1, 5, phDate(-8));
  // B: bought 6 days ago, all 10 arrived 7 days ago — received before it was matched.
  const b = await warehouseBuy(db, 'Cement', 10, { date: phDate(-6) });
  await receive(db, BUYER, b, 1, 10, phDate(-7));
  await match(db, OWNER, b, 1, it, 10);
  await receive(db, BUYER, a, 1, 5, phDate(-2));
  const i1 = await move(db, STAFF, { item_id: it, from: 'warehouse', to: f, quantity: 8, unplanned_reason: 'slab' });
  eq(await layersOf(db, i1.lots), [[phDate(-8), 5], [phDate(-7), 3]], 'A\'s first delivery, then B — never A\'s late delivery');
  const i2 = await move(db, STAFF, { item_id: it, from: 'warehouse', to: f, quantity: 9, unplanned_reason: 'slab' });
  eq(await layersOf(db, i2.lots), [[phDate(-7), 7], [phDate(-2), 2]]);
  // A return brings the same layers back, last moved first.
  const ret = await move(db, STAFF, { item_id: it, returns_record: i2.record_id, quantity: 4 });
  eq(await layersOf(db, ret.lots), [[phDate(-2), 2], [phDate(-7), 2]]);
  // A loss comes off the oldest received layer there.
  const c = await count(db, STAFF, { item_id: it, at: 'warehouse', counted: 6, reason: 'damaged' });
  await decide(db, OWNER, c.record_id, true);
  const loss = await all(db, `select m.layer, m.quantity from stk_moves m where m.record_id = $1`, [c.record_id]);
  eq(await layersOf(db, loss), [[phDate(-7), 1]]);
  // A delivery entered late but received earliest goes first.
  const e = await warehouseBuy(db, 'Cement', 3);
  await match(db, OWNER, e, 1, it, 3);
  await receive(db, BUYER, e, 1, 3, phDate(-30));
  const i3 = await move(db, STAFF, { item_id: it, from: 'warehouse', to: f, quantity: 4, unplanned_reason: 'slab' });
  eq(await layersOf(db, i3.lots), [[phDate(-30), 3], [phDate(-7), 1]]);
  // Naming a lot still picks within it, oldest received first.
  const i4 = await move(db, STAFF, { item_id: it, from: 'warehouse', to: f, quantity: 1, unplanned_reason: 'x',
                                     lot_id: (await one(db, `select id from stk_lots where purchase_id = $1`, [a])).id });
  eq(await layersOf(db, i4.lots), [[phDate(-2), 1]]);
  // The item's screen lists each layer with the day it was received.
  await as(db, STAFF);
  const one1 = (await one(db, `select stk_item($1) i`, [it])).i;
  eq(one1.lots.flatMap(l => l.layers.filter(y => y.name === 'Warehouse').map(y => [y.received_on, num(y.quantity)])),
     [[phDate(-2), 4]], 'what is left in the warehouse: A\'s late delivery');
  // A receipt is refused reversal once any of THAT delivery moved on — not another's.
  const rB = (await one(db, `select id from stk_records where purchase_id = $1 and kind = 'receive'`, [b])).id;
  await refused(reverse(db, BUYER, rB, 'x'), 'MOVED_ON');
});

await test('a delivery is reversed only while its own goods are still there — not because a later delivery of the same purchase is', async () => {
  const db = await fresh();
  const it = await item(db, 'Cement');
  const f = await folder(db, 'Barlin');
  const pid = await warehouseBuy(db, 'Cement', 10, { date: phDate(-4) });
  await match(db, OWNER, pid, 1, it, 10);
  const first = await receive(db, BUYER, pid, 1, 5, phDate(-3));
  const second = await receive(db, BUYER, pid, 1, 5, phDate(-1));
  await move(db, STAFF, { item_id: it, from: 'warehouse', to: f, quantity: 5, unplanned_reason: 'slab' });
  await refused(reverse(db, BUYER, first.record_id, 'x'), 'MOVED_ON', 'the first delivery went to Barlin');
  await reverse(db, BUYER, second.record_id, 'wrong day');
  eq([await bal(db, it, 'warehouse'), await bal(db, it, f)], [0, 5]);
});

await test('several issues from one purchase (8 now, 5 next week) and a return of part of one: the same lots come back, the request stays filled', async () => {
  const db = await fresh();
  const it = await item(db, 'Cement');
  const f = await folder(db, 'Barlin');
  await stocked(db, it, 20);
  const r = await request(db, f, { item: it, quantity: 13 });
  const i1 = await move(db, STAFF, { item_id: it, from: 'warehouse', to: f, quantity: 8, request_line_id: r.line });
  await move(db, BUYER, { item_id: it, from: 'warehouse', to: f, quantity: 5, request_line_id: r.line });
  eq(await still(db, r.line), 0);
  const ret = await move(db, STAFF, { item_id: it, returns_record: i1.record_id, quantity: 3 });
  eq(ret.kind, 'return');
  eq(ret.lots.map(x => x.lot_id), i1.lots.map(x => x.lot_id));
  eq([await bal(db, it, 'warehouse'), await bal(db, it, f)], [10, 10]);
  eq(await still(db, r.line), 0, 'returned unused goods do not reopen the request');
  await refused(move(db, STAFF, { item_id: it, returns_record: i1.record_id, quantity: 6 }), 'MORE_THAN_ISSUED');
  await move(db, STAFF, { item_id: it, returns_record: i1.record_id, quantity: 5 });
  await refused(move(db, STAFF, { item_id: it, returns_record: i1.record_id, quantity: 1 }), 'MORE_THAN_ISSUED');
  const ret2 = await move(db, STAFF, { item_id: it, returns_record: ret.record_id, quantity: 1 }).catch(e => e.message);
  assert(String(ret2).includes('BAD_RETURN'), 'a return is not returned');
  await as(db, STAFF);
  const rec = (await one(db, `select stk_overview() o`)).o.recent.find(x => x.id === i1.record_id);
  eq(num(rec.returnable), 0);
});

await test('moves between projects and back to the warehouse; no request needed to the warehouse, and none allowed', async () => {
  const db = await fresh();
  const it = await item(db, 'Cement');
  const a = await folder(db, 'Barlin');
  const aw = await folder(db, 'Barlin AW', { parent: a });
  const b = await folder(db, 'Prado');
  await stocked(db, it, 10);
  await move(db, STAFF, { item_id: it, from: 'warehouse', to: a, quantity: 6, unplanned_reason: 'slab' });
  const m = await move(db, STAFF, { item_id: it, from: a, to: b, quantity: 2, unplanned_reason: 'Prado ran out' });
  eq(m.kind, 'move');
  const r = await request(db, aw, { project: a, item: it, quantity: 3 });
  await move(db, STAFF, { item_id: it, from: a, to: aw, quantity: 3, request_line_id: r.line });
  eq(await still(db, r.line), 0, 'an Additional Works request filled from Main Contract leftovers');
  await refused(move(db, STAFF, { item_id: it, from: b, to: 'warehouse', quantity: 1, unplanned_reason: 'x' }), 'BAD_REQUEST_LINK');
  await move(db, STAFF, { item_id: it, from: b, to: 'warehouse', quantity: 2 });
  await refused(move(db, STAFF, { item_id: it, from: a, to: a, quantity: 1, unplanned_reason: 'x' }), 'BAD_LOCATION');
  await refused(move(db, STAFF, { item_id: it, from: 'nowhere', to: a, quantity: 1, unplanned_reason: 'x' }), 'BAD_LOCATION');
  eq([await bal(db, it, 'warehouse'), await bal(db, it, a), await bal(db, it, aw), await bal(db, it, b)], [6, 1, 3, 0]);
});

// ── D. Leftovers of project purchases ─────────────────────────────────

await test('leftovers of a project purchase: at its site or brought to the warehouse; the lot keeps the project\'s cost; never more than bought', async () => {
  const db = await fresh();
  const it = await item(db, 'Cement');
  const f = await folder(db, 'Barlin'); await period(db, f);
  const r = await request(db, f, { item: it, quantity: 10 });
  const pj = await projectBuy(db, f, 'Cement', 10, { requestLine: r.line });
  await leftover(db, BUYER, pj, 1, 3, 'site');
  await leftover(db, STAFF, pj, 1, 2, 'warehouse');
  await refused(leftover(db, STAFF, pj, 1, 6), 'MORE_THAN_BOUGHT');
  eq([await bal(db, it, f), await bal(db, it, 'warehouse')], [3, 2]);
  const lot = await one(db, `select cost_folder_id, since::text, untraced from stk_lots where purchase_id = $1`, [pj]);
  eq([lot.cost_folder_id, lot.since, lot.untraced], [f, TODAY, false]);
  eq((await one(db, `select auto from stk_matches where purchase_id = $1`, [pj])).auto, true, 'matched by its request\'s catalogue item');
  const un = await projectBuy(db, f, 'Gravel', 4);
  await refused(leftover(db, STAFF, un, 1, 1), 'TO_MATCH', 'an unlisted line is matched first');
  const gravel = await item(db, 'Gravel');
  await match(db, STAFF, un, 1, gravel, 4);
  await leftover(db, STAFF, un, 1, 1);
  // Linked to a request whose catalogue item counts in another unit: never matched automatically (Q5).
  const wire = await item(db, 'Tie wire', 'piece');
  const rw = await request(db, f, { item: wire, unit: 'box', description: 'Tie wire', quantity: 2 });
  const boxes = await projectBuy(db, f, 'Tie wire', 2, { unit: 'box', requestLine: rw.line });
  await refused(leftover(db, STAFF, boxes, 1, 1), 'TO_MATCH', 'a box is not a piece');
  await match(db, STAFF, boxes, 1, wire, 100, '2 boxes = 100 pcs');
  await leftover(db, STAFF, boxes, 1, 30);
  eq(await bal(db, wire, f), 30);
  const whp = await warehouseBuy(db, 'Cement', 2);
  await refused(leftover(db, STAFF, whp, 1, 1), 'NOT_PROJECT');
  await refused(leftover(db, STAFF, pj, 1, 1, 'garage'), 'BAD_LOCATION');
  // The leftovers move on like any stock: issued from the warehouse to another project.
  const g = await folder(db, 'Prado');
  await move(db, STAFF, { item_id: it, from: 'warehouse', to: g, quantity: 2, unplanned_reason: 'Prado' });
  eq(await bal(db, it, g), 2);
});

// ── E. Counts and opening stock ───────────────────────────────────────

await test('a count equal to the books is done at once; a different one waits for the main owner, with a reason', async () => {
  const db = await fresh();
  const it = await item(db, 'Cement');
  await stocked(db, it, 10);
  const same = await count(db, STAFF, { item_id: it, at: 'warehouse', counted: 10 });
  eq([same.status, num(same.difference)], ['done', 0]);
  await refused(count(db, STAFF, { item_id: it, at: 'warehouse', counted: 8 }), 'REASON_REQUIRED');
  const short = await count(db, STAFF, { item_id: it, at: 'warehouse', counted: 8, reason: 'damaged', note: 'wet bags' });
  eq([short.status, num(short.book), num(short.difference)], ['pending', 10, -2]);
  eq(await bal(db, it, 'warehouse'), 10, 'nothing changes until confirmed');
  await refused(count(db, BUYER, { item_id: it, at: 'warehouse', counted: 9, reason: 'lost' }), 'COUNT_PENDING', 'one open count per item and place');
  for (const who of [STAFF, BUYER, EXPOWNER]) await refused(decide(db, who, short.record_id, true), 'OWNER_ONLY', who);
  await decide(db, OWNER, short.record_id, true, 'checked');
  eq(await bal(db, it, 'warehouse'), 8);
  await refused(decide(db, OWNER, short.record_id, true), 'BAD_STATE', 'decided once');
});

await test('a count is confirmed only while the books read what they read; rejected with a reason; extra goods found become an untraced lot', async () => {
  const db = await fresh();
  const it = await item(db, 'Cement');
  const f = await folder(db, 'Barlin');
  await stocked(db, it, 10);
  const c1 = await count(db, STAFF, { item_id: it, at: 'warehouse', counted: 7, reason: 'lost' });
  await move(db, STAFF, { item_id: it, from: 'warehouse', to: f, quantity: 1, unplanned_reason: 'x' });
  await refused(decide(db, OWNER, c1.record_id, true), 'STALE_COUNT');
  await refused(decide(db, OWNER, c1.record_id, false, ''), 'REASON_REQUIRED');
  await decide(db, OWNER, c1.record_id, false, 'count again');
  const c2 = await count(db, STAFF, { item_id: it, at: 'warehouse', counted: 12, reason: 'miscounted' });
  await decide(db, OWNER, c2.record_id, true);
  eq(await bal(db, it, 'warehouse'), 12);
  eq(num((await one(db, `select count(*) n from stk_lots where untraced`)).n), 1);
});

await test('a loss comes off the lots at that place, oldest first', async () => {
  const db = await fresh();
  const it = await item(db, 'Cement');
  const old = await stocked(db, it, 3, { date: phDate(-2) });
  await stocked(db, it, 5);
  const c = await count(db, STAFF, { item_id: it, at: 'warehouse', counted: 4, reason: 'expired' });
  await decide(db, OWNER, c.record_id, true);
  const moves = await all(db, `select lt.purchase_id, m.quantity, m.to_location from stk_moves m join stk_lots lt on lt.id = m.lot_id where m.record_id = $1 order by m.id`, [c.record_id]);
  eq(moves.map(x => [x.purchase_id === old, num(x.quantity), x.to_location]), [[true, 3], [false, 1]].map(x => [...x, null]));
});

await test('opening stock: untraced (₱0 later) or traced to a recorded project line; waits for the main owner; never more than the line brought', async () => {
  const db = await fresh();
  const it = await item(db, 'Cement');
  const f = await folder(db, 'Barlin'); await period(db, f);
  const o1 = await opening(db, STAFF, { item_id: it, at: 'warehouse', quantity: 40, note: 'shelf A' });
  eq(await bal(db, it, 'warehouse'), 0, 'pending');
  await decide(db, OWNER, o1.record_id, true);
  eq(await bal(db, it, 'warehouse'), 40);
  const r = await request(db, f, { item: it, quantity: 10 });
  const pj = await projectBuy(db, f, 'Cement', 10, { requestLine: r.line });
  const o2 = await opening(db, STAFF, { item_id: it, at: f, quantity: 6, purchase_id: pj, line_no: 1 });
  await refused(opening(db, STAFF, { item_id: it, at: f, quantity: 5, purchase_id: pj, line_no: 1 }), 'MORE_THAN_BOUGHT', 'pending counts');
  await refused(leftover(db, STAFF, pj, 1, 5), 'MORE_THAN_BOUGHT', 'leftovers share the same room');
  await decide(db, OWNER, o2.record_id, true);
  eq(await bal(db, it, f), 6);
  eq((await one(db, `select cost_folder_id from stk_lots where purchase_id = $1`, [pj])).cost_folder_id, f, 'traced: the cost stays with its project');
  const whp = await warehouseBuy(db, 'Cement', 2);
  await refused(opening(db, STAFF, { item_id: it, at: 'warehouse', quantity: 1, purchase_id: whp, line_no: 1 }), 'NOT_PROJECT');
  const sand = await item(db, 'Sand');
  await refused(opening(db, STAFF, { item_id: sand, at: f, quantity: 1, purchase_id: pj, line_no: 1 }), 'ITEM_MISMATCH');
});

await test('a pending record is withdrawn by whoever recorded it (or the main owner), never by someone else', async () => {
  const db = await fresh();
  const it = await item(db, 'Cement');
  const o = await opening(db, STAFF, { item_id: it, at: 'warehouse', quantity: 5 });
  await refused(reverse(db, BUYER, o.record_id), 'NOT_YOURS');
  const w = await reverse(db, STAFF, o.record_id, 'typo');
  eq(w.status, 'withdrawn');
  await refused(decide(db, OWNER, o.record_id, true), 'BAD_STATE');
  const o2 = await opening(db, STAFF, { item_id: it, at: 'warehouse', quantity: 5 });
  eq((await reverse(db, OWNER, o2.record_id, 'not ours')).status, 'withdrawn');
});

// ── F. Reversals ──────────────────────────────────────────────────────

await test('a mistaken issue is reversed (never edited): the goods are back, the request is open again, the record stays', async () => {
  const db = await fresh();
  const it = await item(db, 'Cement');
  const f = await folder(db, 'Barlin');
  await stocked(db, it, 10);
  const r = await request(db, f, { item: it, quantity: 10 });
  const i = await move(db, STAFF, { item_id: it, from: 'warehouse', to: f, quantity: 4, request_line_id: r.line });
  await refused(reverse(db, STAFF, i.record_id, ''), 'REASON_REQUIRED');
  await reverse(db, STAFF, i.record_id, 'wrong project');
  eq([await bal(db, it, 'warehouse'), await bal(db, it, f), await still(db, r.line)], [10, 0, 10]);
  const row = await one(db, `select kind, quantity, reversed_at is not null rev, reverse_reason from stk_records where id = $1`, [i.record_id]);
  eq([row.kind, num(row.quantity), row.rev, row.reverse_reason], ['issue', 4, true, 'wrong project']);
  await refused(reverse(db, STAFF, i.record_id), 'BAD_STATE', 'reversed once');
});

await test('reversing is refused while the goods have moved on: an issue with returns, a receipt already issued, leftovers moved', async () => {
  const db = await fresh();
  const it = await item(db, 'Cement');
  const f = await folder(db, 'Barlin'); await period(db, f);
  const g = await folder(db, 'Prado');
  const pid = await stocked(db, it, 10);
  const rcpt = (await one(db, `select id from stk_records where kind = 'receive' and purchase_id = $1`, [pid])).id;
  const i = await move(db, STAFF, { item_id: it, from: 'warehouse', to: f, quantity: 6, unplanned_reason: 'slab' });
  const ret = await move(db, STAFF, { item_id: it, returns_record: i.record_id, quantity: 1 });
  await refused(reverse(db, STAFF, i.record_id), 'RETURNS_FIRST');
  await refused(reverse(db, BUYER, rcpt), 'MOVED_ON', 'the received bags were issued');
  await reverse(db, STAFF, ret.record_id);
  await move(db, STAFF, { item_id: it, from: f, to: g, quantity: 6, unplanned_reason: 'x' });
  await refused(reverse(db, STAFF, i.record_id), 'MOVED_ON', 'the issued bags moved on to Prado');
  const r = await request(db, f, { item: it, quantity: 5 });
  const pj = await projectBuy(db, f, 'Cement', 5, { requestLine: r.line });
  const lo = await leftover(db, STAFF, pj, 1, 2);
  await move(db, STAFF, { item_id: it, from: f, to: 'warehouse', quantity: 2 });
  await refused(reverse(db, STAFF, lo.record_id), 'MOVED_ON');
});

await test('who reverses: whoever recorded it or an owner account; a confirmed count or opening stock only the main owner', async () => {
  const db = await fresh();
  const it = await item(db, 'Cement');
  const f = await folder(db, 'Barlin');
  await stocked(db, it, 10);
  const i = await move(db, STAFF, { item_id: it, from: 'warehouse', to: f, quantity: 1, unplanned_reason: 'x' });
  await refused(reverse(db, BUYER, i.record_id), 'NOT_YOURS');
  await refused(reverse(db, EXPOWNER, i.record_id), 'STOCK_OFF', 'admin-exp@ is its own company');
  await reverse(db, OWNER, i.record_id);
  const o = await opening(db, STAFF, { item_id: it, at: 'warehouse', quantity: 2 });
  await decide(db, OWNER, o.record_id, true);
  await refused(reverse(db, STAFF, o.record_id), 'NOT_ALLOWED');
  await reverse(db, OWNER, o.record_id);
  eq(await bal(db, it, 'warehouse'), 10);
  const same = await count(db, STAFF, { item_id: it, at: 'warehouse', counted: 10 });
  await refused(reverse(db, OWNER, same.record_id), 'BAD_STATE', 'a count that changed nothing has nothing to reverse');
});

// ── G. Purchases with stock (Q21, Q22) ────────────────────────────────

await test('a purchase with stock records cannot be voided or replaced; after reversing them it can', async () => {
  const db = await fresh();
  const it = await item(db, 'Cement');
  const pid = await warehouseBuy(db, 'Cement', 10);
  await receive(db, BUYER, pid, 1, 4);
  await as(db, OWNER);
  await refused(db.query(`select pur_void($1, $2, 'wrong')`, [op(), pid]), 'STOCK_IN_USE');
  const b = body([{ destination: 'warehouse', item_name: 'Cement', quantity: 10, amount: 1000 }]);
  await refused(db.query(`select pur_replace($1, $2, $3::jsonb, 'fix')`, [op(), pid, JSON.stringify(b)]), 'STOCK_IN_USE');
  const rec = (await one(db, `select id from stk_records where purchase_id = $1`, [pid])).id;
  await reverse(db, BUYER, rec, 'wrong line');
  await as(db, OWNER);
  await db.query(`select pur_void($1, $2, 'wrong')`, [op(), pid]);
  eq((await one(db, `select status from purchases where id = $1`, [pid])).status, 'void');
  // A purchase only MATCHED (no goods yet) voids as before.
  const p2 = await warehouseBuy(db, 'Cement', 3);
  await match(db, STAFF, p2, 1, it, 3);
  await as(db, OWNER);
  await db.query(`select pur_void($1, $2, 'wrong')`, [op(), p2]);
});

await test('a correction may not undo stock: not below what was received and closed, nor another unit, destination or project', async () => {
  const db = await fresh();
  const it = await item(db, 'Cement');
  const f = await folder(db, 'Barlin'); await period(db, f);
  const pid = await stocked(db, it, 10);
  const fix = async (line) => {
    await as(db, OWNER);
    return db.query(`select pur_correct($1, $2, $3::jsonb, 'fix')`, [op(), pid, JSON.stringify(body([line]))]);
  };
  await refused(fix({ destination: 'warehouse', item_name: 'Cement', quantity: 9, amount: 900 }), 'STOCK_IN_USE');
  await refused(fix({ destination: 'warehouse', item_name: 'Cement', quantity: 10, unit: 'kg', amount: 900 }), 'STOCK_IN_USE');
  await refused(fix({ destination: 'project', folder_id: f, item_name: 'Cement', quantity: 10, amount: 900 }), 'STOCK_IN_USE');
  await fix({ destination: 'warehouse', item_name: 'Portland cement', quantity: 12, amount: 1150 });
  eq(await bal(db, it, 'warehouse'), 10, 'a price, name or larger quantity fix keeps the stock and the match');
  eq((await one(db, `select stk_overview() o`)).o.awaiting.map(a => num(a.awaiting)), [2], '2 more now awaited');
  // A project line's leftovers: not below them, not to another project.
  const g = await folder(db, 'Prado'); await period(db, g);
  const pj = await projectBuy(db, f, 'Cement', 10);
  await match(db, STAFF, pj, 1, it, 10);
  await leftover(db, STAFF, pj, 1, 4);
  const fixPj = async (line) => {
    await as(db, OWNER);
    return db.query(`select pur_correct($1, $2, $3::jsonb, 'fix')`, [op(), pj, JSON.stringify(body([line]))]);
  };
  await refused(fixPj({ folder_id: f, item_name: 'Cement', quantity: 3, amount: 300 }), 'STOCK_IN_USE');
  await refused(fixPj({ folder_id: g, item_name: 'Cement', quantity: 10, amount: 1000 }), 'STOCK_IN_USE');
  await fixPj({ folder_id: f, item_name: 'Cement', quantity: 4, amount: 400 });
});

await test('a matched line whose unit is corrected before any stock record goes back to "To match"', async () => {
  const db = await fresh();
  const it = await item(db, 'Cement');
  const pid = await warehouseBuy(db, 'Cement', 10);
  await match(db, STAFF, pid, 1, it, 10);
  await as(db, OWNER);
  await db.query(`select pur_correct($1, $2, $3::jsonb, 'fix')`, [op(), pid,
    JSON.stringify(body([{ destination: 'warehouse', item_name: 'Cement', quantity: 10, unit: 'sack', amount: 1000 }]))]);
  eq(num((await one(db, `select count(*) n from stk_matches where purchase_id = $1`, [pid])).n), 0);
  eq(num((await one(db, `select count(*) n from stk_lots where purchase_id = $1`, [pid])).n), 0);
  eq((await all(db, `select kind from stk_events where purchase_id = $1 order by id`, [pid])).map(r => r.kind), ['matched', 'unmatched']);
  await as(db, STAFF);
  eq((await one(db, `select stk_overview() o`)).o.awaiting[0].match, null);
});

// ── H. The old tickbox (Q29) ──────────────────────────────────────────

await test('the old "Add to inventory" tickbox works while stock is off, and is refused once it is on (nothing saved)', async () => {
  const db = await fresh({ on: false });
  const f = await folder(db, 'Barlin'); await period(db, f);
  const tick = body([{ folder_id: f, item_name: 'Nails', quantity: 2, amount: 100, in_inventory: true }]);
  await record(db, tick);
  eq(num((await one(db, `select count(*) n from inventory`)).n), 1, 'off: as before');
  await as(db, OWNER); await db.query(`select stk_set_enabled(true)`);
  const before = await money(db);
  await refused(record(db, body([{ folder_id: f, item_name: 'Bolts', quantity: 2, amount: 100, in_inventory: true }])), 'STOCK_TICK_RETIRED');
  eq(await money(db), before, 'nothing saved');
  await as(db, OWNER);
  await refused(db.query(`insert into inventory (owner_id, item_name, current_stock) values ($1, 'x', 1)`, [OWNER]), 'STOCK_TICK_RETIRED');
  await record(db, body([{ folder_id: f, item_name: 'Bolts', quantity: 2, amount: 100 }]));
});

// ── I. Retries, money, balances ───────────────────────────────────────

await test('a retried operation records once and returns the first answer, marked replayed', async () => {
  const db = await fresh();
  const it = await item(db, 'Cement');
  const f = await folder(db, 'Barlin');
  await stocked(db, it, 10);
  const press = op();
  const b = JSON.stringify({ item_id: it, from: 'warehouse', to: f, quantity: '3', on: TODAY, unplanned_reason: 'x' });
  await as(db, STAFF);
  const a1 = (await one(db, `select stk_move($1, $2::jsonb) r`, [press, b])).r;
  const a2 = (await one(db, `select stk_move($1, $2::jsonb) r`, [press, b])).r;
  eq([a2.record_id, a2.replayed], [a1.record_id, true]);
  eq(await bal(db, it, f), 3);
  await as(db, BUYER);
  const a3 = (await one(db, `select stk_move($1, $2::jsonb) r`, [press, b])).r;
  assert(a3.record_id !== a1.record_id && !a3.replayed, 'another person\'s operation is their own');
  const r1 = (await one(db, `select stk_reverse($1, $2, 'x') r`, [press, a3.record_id])).r;
  assert(r1.replayed, 'the same press for a different call answers the first call (never runs again)');
});

await test('no stock action writes a peso: expenses, payroll and payments are untouched through a whole day of stock', async () => {
  const db = await fresh();
  const it = await item(db, 'Cement');
  const f = await folder(db, 'Barlin'); await period(db, f);
  const g = await folder(db, 'Prado'); await period(db, g);
  const r = await request(db, f, { item: it, quantity: 10 });
  const pj = await projectBuy(db, f, 'Cement', 10, { requestLine: r.line });
  const before = await money(db);
  const pid = await warehouseBuy(db, 'Cement', 20);
  const afterBuy = await money(db);
  eq([afterBuy.n, afterBuy.s], [before.n, before.s], 'a warehouse purchase writes no Spent (2A)');
  await match(db, STAFF, pid, 1, it, 20);
  await receive(db, BUYER, pid, 1, 15);
  await notDelivered(db, STAFF, pid, 1, 5);
  const i = await move(db, STAFF, { item_id: it, from: 'warehouse', to: g, quantity: 6, unplanned_reason: 'x' });
  await move(db, STAFF, { item_id: it, returns_record: i.record_id, quantity: 2 });
  await leftover(db, STAFF, pj, 1, 3);
  await move(db, STAFF, { item_id: it, from: f, to: g, quantity: 3, unplanned_reason: 'x' });
  const c = await count(db, STAFF, { item_id: it, at: 'warehouse', counted: 10, reason: 'lost' });
  await decide(db, OWNER, c.record_id, true);
  const o = await opening(db, STAFF, { item_id: it, at: 'warehouse', quantity: 4 });
  await decide(db, OWNER, o.record_id, true);
  await reverse(db, OWNER, o.record_id);
  eq(await money(db), afterBuy, 'the same expense rows, sum, payroll and payments');
});

await test('stk_balances agrees with stk_balance for every lot and place, and nothing is ever negative', async () => {
  const db = await fresh();
  const it = await item(db, 'Cement');
  const pcs = await item(db, 'Tie wire', 'piece');
  const f = await folder(db, 'Barlin');
  const g = await folder(db, 'Prado');
  await stocked(db, it, 10, { date: phDate(-1) });
  await stocked(db, it, 7);
  const tw = await warehouseBuy(db, 'Tie wire box', 3, { unit: 'box' });
  await match(db, STAFF, tw, 1, pcs, 100, '3 boxes = 100');
  await receive(db, BUYER, tw, 1, 2);
  await move(db, STAFF, { item_id: it, from: 'warehouse', to: f, quantity: 12, unplanned_reason: 'x' });
  await move(db, STAFF, { item_id: it, from: f, to: g, quantity: 5, unplanned_reason: 'x' });
  await move(db, STAFF, { item_id: pcs, from: 'warehouse', to: g, quantity: 66.667, unplanned_reason: 'x' });
  const rows = await all(db, `select lot_id, location_id, quantity from stk_balances($1)`, [OWNER]);
  for (const x of rows) {
    eq(num((await one(db, `select stk_balance($1, $2) b`, [x.lot_id, x.location_id])).b), num(x.quantity), 'lot ' + x.lot_id);
    assert(num(x.quantity) > 0, 'never negative');
    const layered = await one(db, `select coalesce(sum(quantity), 0) q from stk_layers($1) where lot_id = $2 and location_id = $3`,
                              [OWNER, x.lot_id, x.location_id]);
    eq(num(layered.q), num(x.quantity), 'its layers add up to it');
  }
  eq(num((await one(db, `select count(*) n from stk_layers($1) where quantity < 0`, [OWNER])).n), 0, 'no layer below zero');
  eq([await bal(db, it, 'warehouse'), await bal(db, it, f), await bal(db, it, g), await bal(db, pcs, 'warehouse'), await bal(db, pcs, g)],
     [5, 7, 5, 0, 66.667]);
});

// ── J. Reading ────────────────────────────────────────────────────────

await test('the Stock screen: items by place, waiting for the owner, latest records; one item\'s lots and history; choices', async () => {
  const db = await fresh();
  const it = await item(db, 'Cement');
  const f = await folder(db, 'Barlin'); await period(db, f);
  const done = await folder(db, 'Old job', { completed: true });
  await stocked(db, it, 10);
  await move(db, STAFF, { item_id: it, from: 'warehouse', to: f, quantity: 4, unplanned_reason: 'slab' });
  await count(db, STAFF, { item_id: it, at: 'warehouse', counted: 5, reason: 'lost' });
  await as(db, STAFF);
  const ov = (await one(db, `select stk_overview() o`)).o;
  eq(ov.items.map(i => [i.name, i.unit, num(i.total), i.places.map(p => [p.name, num(p.quantity)])]),
     [['Cement', 'bag', 10, [['Warehouse', 6], ['Barlin', 4]]]]);
  eq(ov.pending.map(p => [p.kind, num(p.quantity), num(p.book_quantity), p.recorded_by_name]), [['count', 5, 6, 'Ana']]);
  eq(ov.recent.map(r => r.kind), ['count', 'issue', 'receive']);
  const one1 = (await one(db, `select stk_item($1) i`, [it])).i;
  eq(one1.lots.length, 1);
  eq(one1.lots[0].places.map(p => [p.name, num(p.quantity)]), [['Barlin', 4], ['Warehouse', 6]]);
  eq(one1.records.map(r => r.kind), ['count', 'issue', 'receive']);
  const ch = (await one(db, `select stk_choices() c`)).c;
  eq(ch.items.map(i => i.name), ['Cement']);
  eq(ch.projects.map(p => [p.name, p.completed]), [['Barlin', false], ['Old job', true]], 'completed projects stay pickable for physical records (Q16)');
  const r = await request(db, f, { item: it, quantity: 3 });
  await as(db, STAFF);
  eq((await one(db, `select stk_request_lines($1) x`, [f])).x.map(l => [l.line_id, num(l.still_to_buy)]), [[r.line, 3]]);
  const pj = await projectBuy(db, f, 'Cement', 2, { requestLine: r.line });
  await as(db, STAFF);
  const pl = (await one(db, `select stk_project_lines($1) x`, [f])).x;
  eq(pl.map(l => [l.purchase_id, num(l.quantity), num(l.entered)]), [[pj, 2, 0]]);
  void done;
});

await test('no read carries a peso amount (staff see quantities only)', async () => {
  const db = await fresh();
  const it = await item(db, 'Cement');
  const f = await folder(db, 'Barlin'); await period(db, f);
  await stocked(db, it, 10);
  await move(db, STAFF, { item_id: it, from: 'warehouse', to: f, quantity: 4, unplanned_reason: 'slab' });
  const r = await request(db, f, { item: it, quantity: 3 });
  await projectBuy(db, f, 'Cement', 2, { requestLine: r.line });
  await as(db, STAFF);
  const docs = [(await one(db, `select stk_overview() x`)).x, (await one(db, `select stk_item($1) x`, [it])).x,
                (await one(db, `select stk_project_lines($1) x`, [f])).x, (await one(db, `select stk_choices() x`)).x,
                (await one(db, `select stk_request_lines($1) x`, [f])).x];
  const keys = new Set();
  const walk = (v) => { if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === 'object') Object.entries(v).forEach(([k, x]) => { keys.add(k); walk(x); }); };
  docs.forEach(walk);
  const money = [...keys].filter(k => /amount|price|cost(?!_folder)|peso|total_amount|gross|value|supplier/.test(k));
  eq(money, WITH_0105 ? ['costs'] : [], 'no money keys (2C: a record\'s cost-move states, no values)');
  const text = JSON.stringify(docs);
  assert(!text.includes('Wilcon'), 'no supplier');
});

await test('permissions: authenticated may call the operations and readers only; no table is readable directly', async () => {
  const db = await fresh();
  const callable = ['stk_status()', 'stk_set_enabled(boolean)', 'stk_match(uuid,uuid,integer,uuid,text,text)',
    'stk_receive(uuid,uuid,integer,text,text,text)', 'stk_not_delivered(uuid,uuid,integer,text,text)',
    'stk_leftover(uuid,uuid,integer,text,text,text,text)', 'stk_move(uuid,jsonb)', 'stk_count(uuid,jsonb)', 'stk_opening(uuid,jsonb)',
    'stk_decide(uuid,uuid,boolean,text)', 'stk_reverse(uuid,uuid,text)', 'stk_overview()', 'stk_item(uuid)',
    'stk_project_lines(uuid)', 'stk_choices()', 'stk_request_lines(uuid)', 'pur_shopping_list(uuid,uuid,text)',
    ...(WITH_0105 ? ['stk_cost_decide(uuid,uuid,boolean,text)', 'stk_cost_reverse(uuid,uuid,text)',
                     'stk_cost_resubmit(uuid,uuid,text)', 'stk_cost_pending()', 'stk_company_stock()'] : [])];
  for (const f of callable) {
    eq([f, (await one(db, `select has_function_privilege('authenticated', $1, 'execute') x`, [f])).x,
        (await one(db, `select has_function_privilege('anon', $1, 'execute') x`, [f])).x], [f, true, false]);
  }
  const fns = (await all(db, `select p.oid::regprocedure::text f from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                               where n.nspname = 'public' and (p.proname like 'stk\\_%' or p.proname in
                               ('pr_portion_purchased', 'pr_line_purchased', 'pr_portion_from_stock', 'pr_line_from_stock',
                                'pr_portion_bought', 'pr_line_bought', 'pur_purchase_view'))`)).map(r => r.f.replace(/ /g, ''));
  const internal = fns.filter(f => !callable.includes(f));
  assert(internal.length >= 30, 'internal helpers found: ' + internal.length);
  for (const f of internal) {
    eq([f, (await one(db, `select has_function_privilege('authenticated', $1, 'execute') x`, [f])).x], [f, false]);
  }
  for (const t of ['stk_settings', 'stk_locations', 'stk_matches', 'stk_lots', 'stk_records', 'stk_moves', 'stk_covers', 'stk_events']) {
    const r = await one(db, `select relrowsecurity rls, (select count(*) from pg_policies where tablename = $1) n from pg_class where relname = $1`, [t]);
    eq([t, r.rls, num(r.n)], [t, true, 0]);
  }
});

await test('history is append-only: events, moves and covers cannot be changed or deleted', async () => {
  const db = await fresh();
  const it = await item(db, 'Cement');
  const f = await folder(db, 'Barlin');
  await stocked(db, it, 10);
  const r = await request(db, f, { item: it, quantity: 3 });
  await move(db, STAFF, { item_id: it, from: 'warehouse', to: f, quantity: 3, request_line_id: r.line });
  await db.exec(`reset role`);
  for (const sql of [`update stk_events set reason = 'x'`, `delete from stk_events`, `update stk_moves set quantity = 1`,
                     `delete from stk_moves`, `update stk_covers set quantity = 1`, `delete from stk_covers`]) {
    await refused(db.query(sql), 'HISTORY_IMMUTABLE', sql);
  }
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) { console.log('\nFAILURES:\n  ' + failures.join('\n  ')); process.exit(1); }
