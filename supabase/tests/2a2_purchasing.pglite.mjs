// ════════════════════════════════════════════════════════════════════
// STAGE 2A-2 PURCHASING TAB + BUYER SWITCH — BEHAVIOUR TESTS ON PGLITE
//   npm run test:sql
//
// Runs migrations 0096 and 0097 VERBATIM on PGlite (PostgreSQL in memory)
// over a minimal copy of the tables they touch (see pr_base.mjs). Nothing
// here talks to the live database; supabase/tests/2a2_acceptance.sql
// repeats the key cases there, rolled back.
// ════════════════════════════════════════════════════════════════════
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { prBase, fnText } from './pr_base.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.DACS_ROOT || path.join(HERE, '..', '..');
const read = (p) => fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const M02 = read(path.join(ROOT, 'supabase/migrations/0002_rls.sql'));
const M94 = read(path.join(ROOT, 'supabase/migrations/0094_workmate_work_plan_office.sql'));
const M96 = read(path.join(ROOT, 'supabase/migrations/0096_purchase_recording.sql'));
const M97 = read(path.join(ROOT, 'supabase/migrations/0097_purchasing_office.sql'));
// --with-0101: the same tests with 2A-3a's 0101 on top — 0101 must not change
// how the Purchasing tab buys, covers, corrects or approves.
const WITH_0101 = process.argv.includes('--with-0101');
const M101 = WITH_0101 ? read(path.join(ROOT, 'supabase/migrations/0101_purchasing_phone.sql')) : '';

// The 2A-1 base schema (same as 2a1_purchase.pglite.mjs).
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
const STAFF = '00000000-0000-0000-0000-00000000000b';   // Expenses, no Buyer switch
const BUYER = '00000000-0000-0000-0000-000000000011';
const BUYER2 = '00000000-0000-0000-0000-000000000012';
const WORKER = '00000000-0000-0000-0000-00000000000c';
const OTHER = '00000000-0000-0000-0000-00000000000d';    // another company's owner
const PMOWNER = '00000000-0000-0000-0000-000000000013';  // owner-role account focused on PM
const EXPOWNER = '00000000-0000-0000-0000-000000000014'; // owner-role account with PM + Expenses (own scope)
let opSeq = 0;
const op = () => '20000000-0000-0000-0000-' + String(++opSeq).padStart(12, '0');

let passed = 0, failed = 0;
const failures = [];
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { failed++; failures.push(name + ' — ' + e.message); console.log('  FAIL ' + name + '\n       ' + e.message); }
}
function assert(c, m) { if (!c) throw new Error(m); }
function eq(a, b, m) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error((m || 'not equal') + ': ' + JSON.stringify(a) + ' !== ' + JSON.stringify(b)); }
const num = (x) => Number(x);

async function fresh() {
  const db = new PGlite();
  await db.exec(BASE);
  await db.exec(M96);
  await db.exec(prBase(ROOT));
  await db.exec(M97);
  if (WITH_0101) { await db.exec(`create role service_role`); await db.exec(M101); }
  await db.exec(`insert into profiles (id, role, owner_id, status, allowed_modules, email, display_name) values
    ('${OWNER}', 'owner', null, 'active', null, 'admin@dacs.test', null),
    ('${STAFF}', 'staff', '${OWNER}', 'active', null, 'staff@dacs.test', null),
    ('${BUYER}', 'staff', '${OWNER}', 'active', null, 'juan@dacs.test', 'Juan'),
    ('${BUYER2}', 'staff', '${OWNER}', 'active', null, 'pedro@dacs.test', 'Pedro'),
    ('${WORKER}', 'worker', '${OWNER}', 'active', null, null, 'Mark'),
    ('${OTHER}', 'owner', null, 'active', null, 'other@x.test', null),
    ('${PMOWNER}', 'owner', '${OWNER}', 'active', '["pm"]'::jsonb, 'admin-pm@dacs.test', null),
    ('${EXPOWNER}', 'owner', '${OWNER}', 'active', '["pm", "expenses"]'::jsonb, 'admin-exp@dacs.test', null);`);
  await as(db, OWNER);
  await db.query(`select pur_set_buyer($1, true)`, [BUYER]);
  await db.query(`select pur_set_buyer($1, true)`, [BUYER2]);
  return db;
}
async function as(db, uid) { await db.exec(`select set_config('test.uid', '${uid}', false)`); }
async function one(db, sql, params = []) { return (await db.query(sql, params)).rows[0]; }
async function all(db, sql, params = []) { return (await db.query(sql, params)).rows; }
async function code(promise) {
  try { await promise; return 'no error'; } catch (e) { return e.message; }
}

async function folder(db, name, opts = {}) {
  return (await one(db, `insert into folders (owner_id, name, parent_folder_id, completed_at) values ($1, $2, $3, $4) returning id`,
    [opts.owner || OWNER, name, opts.parent || null, opts.completed ? new Date().toISOString() : null])).id;
}
async function period(db, folderId, budget = 100000, owner = OWNER) {
  const id = (await one(db, `insert into projects (owner_id, folder_id, month, year, funding_type, billing_number)
                              values ($1, $2, 'October', 2026, 'progress', 1) returning id`, [owner, folderId])).id;
  await db.query(`insert into project_budgets values ($1, $2, $3)`, [id, owner, budget]);
  return id;
}
// A request line for a project, with its quantity in one portion of NOW's batch.
async function request(db, folderId, opts = {}) {
  const owner = opts.owner || OWNER;
  const batch = (await one(db, `select pr_batch_for($1, now()) b`, [owner])).b;
  const req = (await one(db, `insert into pr_requests (owner_id, requester_id, folder_id, work_folder_id)
                               values ($1, $2, $3, $4) returning id`, [owner, opts.requester || WORKER, folderId, opts.work || folderId])).id;
  const line = (await one(db, `insert into pr_lines (owner_id, request_id, description, unit, urgent, urgent_reason, needed_by)
                                values ($1, $2, $3, $4, $5, $6, $7) returning id`,
    [owner, req, opts.description || 'Cement', opts.unit || 'bag', !!opts.urgent, opts.urgent ? 'pour' : null, opts.urgent ? '2026-10-20' : null])).id;
  const portion = (await one(db, `insert into pr_line_portions (owner_id, line_id, batch_id, quantity) values ($1, $2, $3, $4) returning id`,
    [owner, line, batch, opts.quantity ?? 10])).id;
  return { req, line, portion, batch };
}
function body(lines, extra = {}) {
  const total = extra.receipt_total ?? lines.reduce((s, l) => s + l.amount, 0);
  return { source: 'purchasing', purchase_date: '2026-10-14', date_time: '2026-10-14T09:30', supplier: 'Wilcon',
           notes: '', payment_method: 'CASH', docs: {}, ...extra, receipt_total: Math.round(total * 100) / 100,
           lines: lines.map(l => ({ destination: 'project', category: 'Materials', unit: 'bag', ...l })) };
}
async function record(db, b, opId = op()) {
  return (await one(db, `select pur_record($1, $2::jsonb) as r`, [opId, JSON.stringify(b)])).r;
}
async function portions(db, line) {
  return (await all(db, `select id, quantity, pending_reduction, buyer_id, pr_portion_bought(id) as bought
                           from pr_line_portions where line_id = $1 order by created_at, id`, [line]))
    .map(p => ({ id: p.id, q: num(p.quantity), pending: num(p.pending_reduction), buyer: p.buyer_id, bought: num(p.bought) }));
}
async function listLine(db, line) {
  const rows = (await one(db, `select pur_shopping_list(null, null, 'all') l`)).l;
  return rows.find(r => r.line_id === line);
}
async function spent(db, folderId) {
  return num((await one(db, `select coalesce(sum(e.amount), 0) s from expenses e join projects p on p.id = e.project_id where p.folder_id = $1`, [folderId])).s);
}

console.log('\n2A-2 purchasing tab + Buyer switch (0096 + 0097' + (WITH_0101 ? ' + 0101' : '') + ' on PGlite)');

// ── A. The Buyer switch ──────────────────────────────────────────────

await test('the owner turns the Buyer switch on and off; each change is logged once', async () => {
  const db = await fresh();
  await as(db, STAFF); eq((await one(db, `select pur_buyer() b`)).b, false, 'staff without the switch');
  await as(db, BUYER); eq((await one(db, `select pur_buyer() b`)).b, true, 'buyer');
  await as(db, OWNER);
  await db.query(`select pur_set_buyer($1, false)`, [BUYER]);
  await db.query(`select pur_set_buyer($1, false)`, [BUYER]);   // no change → no second event
  await as(db, BUYER); eq((await one(db, `select pur_buyer() b`)).b, false, 'switched off');
  eq(num((await one(db, `select count(*) n from pur_buyer_events where user_id = $1`, [BUYER])).n), 2, 'on + off');
  await as(db, OWNER); eq((await one(db, `select pur_buyer() b`)).b, true, 'the owner may buy');
});

await test('only the owner sets the switch, only for their own staff', async () => {
  const db = await fresh();
  await as(db, BUYER);
  assert((await code(db.query(`select pur_set_buyer($1, true)`, [STAFF]))).includes('OWNER_ONLY'), 'staff refused');
  await as(db, OWNER);
  assert((await code(db.query(`select pur_set_buyer($1, true)`, [WORKER]))).includes('NOT_STAFF'), 'a worker cannot buy');
  await as(db, OTHER);
  assert((await code(db.query(`select pur_set_buyer($1, true)`, [STAFF]))).includes('NOT_STAFF'), 'another company');
  await as(db, OWNER);
  const list = (await one(db, `select pur_office_buyers() l`)).l;
  eq(list.map(x => [x.name, x.is_buyer]).sort(), [['Juan', true], ['Pedro', true], ['staff', false]], 'staff list with names');
});

await test('Q3 = B: an admin account focused on PM cannot buy; with Expenses it buys in its own scope only', async () => {
  const db = await fresh();
  await as(db, PMOWNER); eq((await one(db, `select pur_buyer() b`)).b, false, 'PM-only');
  await as(db, EXPOWNER); eq((await one(db, `select pur_buyer() b`)).b, true, 'PM + Expenses');
  const f = await folder(db, 'Barlin'); await period(db, f);
  assert((await code(record(db, body([{ folder_id: f, item_name: 'x', amount: 1, unplanned_reason: 'r' }])))).includes('BAD_PROJECT'),
    'the main company project is not in its scope');
});

await test('Purchasing and phone sources need the switch; the Expenses form keeps 0096 rules', async () => {
  const db = await fresh();
  const f = await folder(db, 'Barlin'); await period(db, f);
  const b = body([{ folder_id: f, item_name: 'Nails', amount: 50, unplanned_reason: 'site ran out' }]);
  await as(db, STAFF);
  assert((await code(record(db, b))).includes('BUYER_REQUIRED'), 'purchasing refused');
  // A phone purchase carries its receipt photo (0101 refuses one with neither a photo nor a reason).
  const phone = { ...b, source: 'workmate', docs: { po_image_url: 'https://example.test/receipt.jpg' } };
  assert((await code(record(db, phone))).includes('BUYER_REQUIRED'), 'phone refused');
  await record(db, { ...b, source: 'expenses_form' });
  await as(db, BUYER); await record(db, b);
  await record(db, phone);
  await as(db, OWNER);
  await db.query(`update profiles set status = 'inactive' where id = $1`, [BUYER]);
  await as(db, BUYER);
  assert((await code(record(db, b))).includes('NOT_OFFICE') || (await code(record(db, b))).includes('BUYER_REQUIRED'), 'inactive refused');
});

await test('review 1: without the switch no source links a request or takes a portion; ordinary entry still works', async () => {
  const db = await fresh();
  const f = await folder(db, 'Barlin'); await period(db, f);
  const r = await request(db, f, { quantity: 10 });
  await as(db, STAFF);
  const linked = { ...body([{ folder_id: f, item_name: 'Cement', quantity: 4, amount: 1000, request_line_id: r.line }]), source: 'expenses_form' };
  assert((await code(record(db, linked))).includes('BUYER_REQUIRED'), 'the Expenses form cannot link a request');
  const picked = { ...body([{ folder_id: f, item_name: 'Cement', quantity: 4, amount: 1000, request_line_id: r.line,
                              portion_picks: [{ portion_id: r.portion, quantity: 4 }] }]), source: 'expenses_form' };
  assert((await code(record(db, picked))).includes('BUYER_REQUIRED'), 'nor pick a portion');
  eq((await portions(db, r.line)).map(p => [p.bought, p.buyer]), [[0, null]], 'nothing bought, nobody holds it');
  eq(num((await one(db, `select count(*) n from pr_events where line_id = $1`, [r.line])).n), 0, 'no claim logged');
  // Ordinary Expenses entry is unchanged …
  const plain = await record(db, { ...body([{ folder_id: f, item_name: 'Nails', amount: 50 }]), source: 'expenses_form' });
  // … but neither a correction nor a request to the owner adds a link to it.
  const addLink = { ...body([{ folder_id: f, item_name: 'Cement', quantity: 4, amount: 50, request_line_id: r.line }]), source: 'expenses_form' };
  assert((await code(db.query(`select pur_correct($1, $2, $3::jsonb, 'link it')`, [op(), plain.purchase_id, JSON.stringify(addLink)]))).includes('BUYER_REQUIRED'), 'correction');
  assert((await code(db.query(`select pur_request_change($1, $2, 'correct', $3::jsonb, 'link it')`, [op(), plain.purchase_id, JSON.stringify(addLink)]))).includes('BUYER_REQUIRED'), 'change request');
  eq((await portions(db, r.line)).map(p => p.bought), [0], 'Bought still 0');
  // A buyer switched off is a non-buyer again.
  await as(db, OWNER); await db.query(`select pur_set_buyer($1, false)`, [BUYER]);
  await as(db, BUYER);
  assert((await code(record(db, linked))).includes('BUYER_REQUIRED'), 'switched off');
});

await test('review 1: a correction by someone who may not buy never hands a portion over', async () => {
  // Juan bought 4 (this week's portion); next week's 6 is unassigned. A
  // non-buyer raising the quantity in Project Control must not give Juan
  // next week's portion; nor may the owner give it to Juan once his switch is off.
  const db = await fresh();
  const f = await folder(db, 'Barlin'); await period(db, f);
  const r = await request(db, f, { quantity: 4 });
  const next = (await one(db, `select pr_batch_for($1, now() + interval '8 days') b`, [OWNER])).b;
  const w2 = (await one(db, `insert into pr_line_portions (owner_id, line_id, batch_id, quantity) values ($1, $2, $3, 6) returning id`, [OWNER, r.line, next])).id;
  await as(db, BUYER);
  const res = await record(db, body([{ folder_id: f, item_name: 'Cement', quantity: 4, amount: 1000, request_line_id: r.line }]));
  const pc = (q) => JSON.stringify({ purchase_date: '2026-10-14', date_time: '2026-10-14', supplier: 'Wilcon', receipt_total: q * 250, notes: '',
    payment_method: 'CASH', docs: {}, charges: [],
    lines: [{ destination: 'project', folder_id: f, item_name: 'Cement', category: 'Materials', quantity: q, unit: 'bag', amount: q * 250 }] });
  await as(db, STAFF);
  assert((await code(db.query(`select pur_correct($1, $2, $3::jsonb, 'six, not four')`, [op(), res.purchase_id, pc(6)]))).includes('EXTRA_REASON_REQUIRED'),
    'the added 2 cannot come from a portion nobody holds');
  eq((await portions(db, r.line)).map(p => [p.bought, p.buyer]), [[4, BUYER], [0, null]], 'next week still unassigned');
  await as(db, OWNER); await db.query(`select pur_set_buyer($1, false)`, [BUYER]);
  assert((await code(db.query(`select pur_correct($1, $2, $3::jsonb, 'six, not four')`, [op(), res.purchase_id, pc(6)]))).includes('EXTRA_REASON_REQUIRED'),
    'not to a buyer whose switch is off');
  eq((await one(db, `select buyer_id from pr_line_portions where id = $1`, [w2])).buyer_id, null, 'still unassigned');
});

// ── B. Who is buying what ────────────────────────────────────────────

await test('"I\'ll buy this": a buyer claims an unassigned portion; another buyer cannot take it', async () => {
  const db = await fresh();
  const f = await folder(db, 'Barlin');
  const r = await request(db, f);
  await as(db, BUYER);
  const res = (await one(db, `select pur_assign_portion($1, $2, null, null) r`, [r.portion, BUYER])).r;
  eq(res.changed, true, 'claimed');
  eq((await portions(db, r.line))[0].buyer, BUYER, 'held by the buyer');
  eq((await one(db, `select kind from pr_events where line_id = $1 order by id desc limit 1`, [r.line])).kind, 'portion_claimed', 'logged');
  await as(db, BUYER2);
  assert((await code(db.query(`select pur_assign_portion($1, $2, null, null)`, [r.portion, BUYER2]))).includes('ASSIGNED_TO_OTHER'), 'no taking over');
  assert((await code(db.query(`select pur_assign_portion($1, null, null, null)`, [r.portion]))).includes('NOT_YOUR_PORTION'), 'no releasing another');
  await as(db, OWNER);
  await db.query(`select pur_assign_portion($1, $2, null, 'Juan is off today')`, [r.portion, BUYER2]);
  eq((await portions(db, r.line))[0].buyer, BUYER2, 'the owner reassigns');
});

await test('assigning part of a portion splits it; Needed is never rewritten', async () => {
  const db = await fresh();
  const f = await folder(db, 'Barlin');
  const r = await request(db, f, { quantity: 10 });
  await as(db, OWNER);
  await db.query(`select pur_assign_portion($1, $2, 4, null)`, [r.portion, BUYER]);
  eq((await portions(db, r.line)).map(p => [p.q, p.buyer]), [[6, null], [4, BUYER]], '6 unassigned + 4 to Juan');
  eq(num((await listLine(db, r.line)).needed), 10, 'Needed stays 10');
  assert((await code(db.query(`select pur_assign_portion($1, $2, 7, null)`, [r.portion, BUYER2]))).includes('BAD_QUANTITY'), 'more than is left');
  assert((await code(db.query(`select pur_assign_portion($1, $2, null, null)`, [r.portion, STAFF]))).includes('BAD_BUYER'), 'not a buyer');
});

await test('buying 6 of 10 keeps the other 4 assigned; releasing them leaves the 6 with the buyer who bought them', async () => {
  const db = await fresh();
  const f = await folder(db, 'Barlin'); await period(db, f);
  const r = await request(db, f, { quantity: 10 });
  await as(db, BUYER);
  await db.query(`select pur_assign_portion($1, $2, null, null)`, [r.portion, BUYER]);
  await record(db, body([{ folder_id: f, item_name: 'Cement', quantity: 6, amount: 1500, request_line_id: r.line }]));
  let line = await listLine(db, r.line);
  eq([num(line.needed), num(line.bought), num(line.still_to_buy)], [10, 6, 4], 'Needed 10 · Bought 6 · Still 4');
  eq(line.portions.map(p => [num(p.bought), num(p.still_to_buy), p.buyer_name]), [[6, 4, 'Juan']], 'still assigned to Juan');
  await db.query(`select pur_assign_portion($1, null, null, null)`, [r.portion]);
  line = await listLine(db, r.line);
  eq(line.portions.map(p => [num(p.quantity), num(p.bought), p.buyer_name]), [[6, 6, 'Juan'], [4, 0, null]], 'the 4 is claimable');
  eq([num(line.needed), num(line.bought), num(line.still_to_buy)], [10, 6, 4], 'Needed unchanged');
  await as(db, BUYER2);
  const p4 = line.portions[1].id;
  await db.query(`select pur_assign_portion($1, $2, null, null)`, [p4, BUYER2]);
  const covers = await all(db, `select buyer_id, quantity from purchase_line_covers`);
  eq(covers.map(c => [c.buyer_id, num(c.quantity)]), [[BUYER, 6]], 'who bought the 6 never changes');
});

// ── C. Coverage ──────────────────────────────────────────────────────

await test('a purchase covers the buyer\'s own portion first, then unassigned ones (which the buyer then holds)', async () => {
  const db = await fresh();
  const f = await folder(db, 'Barlin'); await period(db, f);
  const r = await request(db, f, { quantity: 10 });
  await as(db, OWNER);
  await db.query(`select pur_assign_portion($1, $2, 4, null)`, [r.portion, BUYER]);
  await as(db, BUYER);
  await record(db, body([{ folder_id: f, item_name: 'Cement', quantity: 7, amount: 1750, request_line_id: r.line }]));
  eq((await portions(db, r.line)).map(p => [p.q, p.bought, p.buyer]), [[6, 3, BUYER], [4, 4, BUYER]], '4 own + 3 of the unassigned 6');
  eq(num((await listLine(db, r.line)).still_to_buy), 3, 'Still to buy 3');
});

await test('a staff buyer never covers another buyer\'s portion; the owner may', async () => {
  const db = await fresh();
  const f = await folder(db, 'Barlin'); await period(db, f);
  const r = await request(db, f, { quantity: 10 });
  await as(db, OWNER); await db.query(`select pur_assign_portion($1, $2, null, null)`, [r.portion, BUYER2]);
  await as(db, BUYER);
  const b = body([{ folder_id: f, item_name: 'Cement', quantity: 2, amount: 500, request_line_id: r.line }]);
  assert((await code(record(db, b))).includes('EXTRA_REASON_REQUIRED'), 'nothing it may cover → all extra');
  const pick = body([{ folder_id: f, item_name: 'Cement', quantity: 2, amount: 500, request_line_id: r.line,
                       portion_picks: [{ portion_id: r.portion, quantity: 2 }] }]);
  assert((await code(record(db, pick))).includes('ASSIGNED_TO_OTHER'), 'an explicit pick is refused');
  await as(db, OWNER);
  await record(db, b);
  eq((await portions(db, r.line))[0].bought, 2, 'the owner covered Pedro\'s portion');
  eq((await portions(db, r.line))[0].buyer, BUYER2, 'without taking it over');
});

await test('buying more than Still to buy: needs a reason and a location; Still to buy stays 0, never negative', async () => {
  const db = await fresh();
  const f = await folder(db, 'Barlin'); await period(db, f);
  const r = await request(db, f, { quantity: 10 });
  await as(db, BUYER);
  const base = { folder_id: f, item_name: 'Cement', quantity: 12, amount: 3000, request_line_id: r.line };
  assert((await code(record(db, body([base])))).includes('EXTRA_REASON_REQUIRED'), 'no reason');
  assert((await code(record(db, body([{ ...base, extra_reason: 'pack of 12' }])))).includes('EXTRA_REASON_REQUIRED'), 'no location');
  assert((await code(record(db, body([{ ...base, extra_reason: 'x', extra_location: 'garage' }])))).includes('BAD_EXTRA'), 'bad location');
  const res = await record(db, body([{ ...base, extra_reason: 'sold by the dozen', extra_location: 'warehouse' }]));
  eq(res.covers, [{ line: 1, extra: 2, covered: 10, unit_check: 'none' }], 'covers 10, extra 2');
  const line = await listLine(db, r.line);
  eq([num(line.bought), num(line.still_to_buy), num(line.extra)], [10, 0, 2], 'Bought 10 · Still 0 · Extra 2 (separate)');
  eq(await spent(db, f), 3000, 'the extra\'s cost stays on the project (location is not a cost move)');
});

await test('a different unit covers nothing until an audited office check; the buyer cannot check their own', async () => {
  const db = await fresh();
  const f = await folder(db, 'Barlin'); await period(db, f);
  const r = await request(db, f, { quantity: 24, unit: 'pcs', description: 'Hinge' });
  await as(db, BUYER);
  const res = await record(db, body([{ folder_id: f, item_name: 'Hinge', quantity: 2, unit: 'box', amount: 900, request_line_id: r.line }]));
  eq(res.covers, [{ line: 1, extra: 0, covered: 0, unit_check: 'pending' }], 'pending, nothing covered');
  let line = await listLine(db, r.line);
  eq([num(line.bought), num(line.still_to_buy), num(line.unit_checks)], [0, 24, 1], 'still 24, one check waiting');
  assert((await code(db.query(`select pur_check_unit($1, $2, 1, 24, '2 boxes of 12')`, [op(), res.purchase_id]))).includes('OWN_PURCHASE'), 'not their own');
  await as(db, BUYER2);
  assert((await code(db.query(`select pur_check_unit($1, $2, 1, 30, 'x')`, [op(), res.purchase_id]))).includes('MORE_THAN_NEEDED'), 'cannot cover more than needed');
  await db.query(`select pur_check_unit($1, $2, 1, 24, '2 boxes of 12')`, [op(), res.purchase_id]);
  line = await listLine(db, r.line);
  eq([num(line.bought), num(line.still_to_buy), num(line.unit_checks)], [24, 0, 0], 'covered after the check');
  eq((await one(db, `select kind, reason from purchase_history where purchase_id = $1 order by id desc limit 1`, [res.purchase_id])),
     { kind: 'unit_checked', reason: '2 boxes of 12' }, 'audited');
});

await test('review 2: picked portions are authoritative — 4 picked from one week, 6 bought: 2 extra, never another week', async () => {
  const db = await fresh();
  const f = await folder(db, 'Barlin'); await period(db, f);
  const r = await request(db, f, { quantity: 4 });
  const next = (await one(db, `select pr_batch_for($1, now() + interval '8 days') b`, [OWNER])).b;
  await db.query(`insert into pr_line_portions (owner_id, line_id, batch_id, quantity) values ($1, $2, $3, 6)`, [OWNER, r.line, next]);
  await as(db, BUYER);
  const base = { folder_id: f, item_name: 'Cement', quantity: 6, amount: 1500, request_line_id: r.line,
                 portion_picks: [{ portion_id: r.portion, quantity: 4 }] };
  assert((await code(record(db, body([base])))).includes('EXTRA_REASON_REQUIRED'), 'the 2 beyond the pick are extra');
  const res = await record(db, body([{ ...base, extra_reason: 'sold in sixes', extra_location: 'project' }]));
  eq(res.covers, [{ line: 1, extra: 2, covered: 4, unit_check: 'none' }], 'covers the picked portion only');
  eq((await portions(db, r.line)).map(p => [p.q, p.bought, p.buyer]), [[4, 4, BUYER], [6, 0, null]], 'next week untouched and unassigned');
});

await test('review 2: a price fix, a unit check on another line or a replacement keeps each line on the portions it covered', async () => {
  // Juan buys 5 while week 1 is Pedro's, so it covers the unassigned week-2
  // portion. The owner then gives week 1 to Juan. Re-running "own portions,
  // earliest first" would now move the 5 to week 1 — history must win.
  const db = await fresh();
  const f = await folder(db, 'Barlin'); await period(db, f);
  const r = await request(db, f, { quantity: 5 });
  const next = (await one(db, `select pr_batch_for($1, now() + interval '8 days') b`, [OWNER])).b;
  const w2 = (await one(db, `insert into pr_line_portions (owner_id, line_id, batch_id, quantity) values ($1, $2, $3, 5) returning id`, [OWNER, r.line, next])).id;
  const h = await request(db, f, { quantity: 24, unit: 'pcs', description: 'Hinge' });
  await as(db, OWNER); await db.query(`select pur_assign_portion($1, $2, null, null)`, [r.portion, BUYER2]);
  await as(db, BUYER);
  const lines = [{ folder_id: f, item_name: 'Cement', quantity: 5, amount: 1250, request_line_id: r.line },
                 { folder_id: f, item_name: 'Hinge', quantity: 2, unit: 'box', amount: 900, request_line_id: h.line }];
  const res = await record(db, body(lines));
  const line1 = async (pid) => (await all(db, `select c.portion_id, c.quantity from purchase_line_covers c join purchase_lines l on l.id = c.line_id
                                                 join purchases pu on pu.id = l.purchase_id
                                                where l.purchase_id = $1 and l.line_no = 1 and pu.status = 'recorded' order by c.id`, [pid]))
    .map(c => [c.portion_id, num(c.quantity)]);
  eq(await line1(res.purchase_id), [[w2, 5]], 'covers week 2');
  await as(db, OWNER); await db.query(`select pur_assign_portion($1, $2, null, 'Pedro is off')`, [r.portion, BUYER]);
  await db.query(`select pur_check_unit($1, $2, 2, 24, '2 boxes of 12')`, [op(), res.purchase_id]);
  eq(await line1(res.purchase_id), [[w2, 5]], 'a unit check on line 2 leaves line 1 on week 2');
  await as(db, BUYER);
  await db.query(`select pur_correct($1, $2, $3::jsonb, 'price')`, [op(), res.purchase_id, JSON.stringify(body([{ ...lines[0], amount: 1200 }, lines[1]]))]);
  eq(await line1(res.purchase_id), [[w2, 5]], 'a price fix leaves it on week 2');
  eq([num((await listLine(db, h.line)).bought), (await portions(db, r.line)).map(p => p.bought)], [24, [0, 5]], 'the check is kept; week 1 still to buy');
  const rep = (await one(db, `select pur_replace($1, $2, $3::jsonb, 'forgot the tape') r`, [op(), res.purchase_id,
    JSON.stringify(body([{ ...lines[0], amount: 1200 }, lines[1], { folder_id: f, item_name: 'Tape', amount: 20, unplanned_reason: 'r' }]))])).r;
  eq(await line1(rep.purchase_id), [[w2, 5]], 'the replacement covers week 2 too');
  // Only quantity ADDED by a correction looks for more: 5 → 7 covers 2 of Juan's week 1.
  await db.query(`select pur_correct($1, $2, $3::jsonb, 'two more')`, [op(), rep.purchase_id,
    JSON.stringify(body([{ ...lines[0], quantity: 7, amount: 1680 }, lines[1], { folder_id: f, item_name: 'Tape', amount: 20, unplanned_reason: 'r' }]))]);
  eq(await line1(rep.purchase_id), [[w2, 5], [r.portion, 2]], 'week 2 kept, the added 2 from week 1');
});

await test('re-review 1: a price fix keeps each week\'s QUANTITY — 4 + 4 stays 4 + 4 after an earlier purchase is voided', async () => {
  // Week 1 needs 8, week 2 needs 4. An earlier purchase took 4 of week 1, so
  // this one covered the other 4 of week 1 and 4 of week 2. Voiding the
  // earlier one frees week 1; a price fix must not turn 4 + 4 into 8 + 0.
  const db = await fresh();
  const f = await folder(db, 'Barlin'); await period(db, f);
  const r = await request(db, f, { quantity: 8 });
  const next = (await one(db, `select pr_batch_for($1, now() + interval '8 days') b`, [OWNER])).b;
  const w2 = (await one(db, `insert into pr_line_portions (owner_id, line_id, batch_id, quantity) values ($1, $2, $3, 4) returning id`, [OWNER, r.line, next])).id;
  await as(db, BUYER);
  const early = await record(db, body([{ folder_id: f, item_name: 'Cement', quantity: 4, amount: 1000, request_line_id: r.line }]));
  const line = { folder_id: f, item_name: 'Cement', quantity: 8, amount: 2000, request_line_id: r.line };
  const res = await record(db, body([line]));
  const covers = async (pid) => (await all(db, `select c.portion_id, c.quantity from purchase_line_covers c join purchase_lines l on l.id = c.line_id
                                                  join purchases pu on pu.id = l.purchase_id
                                                 where l.purchase_id = $1 and pu.status = 'recorded' order by c.id`, [pid]))
    .map(c => [c.portion_id, num(c.quantity)]);
  eq(await covers(res.purchase_id), [[r.portion, 4], [w2, 4]], '4 + 4');
  await db.query(`select pur_void($1, $2, 'duplicate')`, [op(), early.purchase_id]);
  await db.query(`select pur_correct($1, $2, $3::jsonb, 'price')`, [op(), res.purchase_id, JSON.stringify(body([{ ...line, amount: 1950 }]))]);
  eq(await covers(res.purchase_id), [[r.portion, 4], [w2, 4]], 'a price fix keeps 4 + 4');
  eq((await portions(db, r.line)).map(p => p.bought), [4, 4], 'week 1 still has 4 to buy');
  const rep = (await one(db, `select pur_replace($1, $2, $3::jsonb, 'new receipt') r`, [op(), res.purchase_id,
    JSON.stringify(body([{ ...line, amount: 1950 }, { folder_id: f, item_name: 'Tape', amount: 20, unplanned_reason: 'r' }]))])).r;
  eq(await covers(rep.purchase_id), [[r.portion, 4], [w2, 4]], 'and so does a replacement');
  // Two more: added quantity follows the usual order (own portions, earliest week first).
  await db.query(`select pur_correct($1, $2, $3::jsonb, 'two more')`, [op(), rep.purchase_id,
    JSON.stringify(body([{ ...line, quantity: 10, amount: 2450 }, { folder_id: f, item_name: 'Tape', amount: 20, unplanned_reason: 'r' }]))]);
  eq(await covers(rep.purchase_id), [[r.portion, 4], [w2, 4], [r.portion, 2]], 'the 2 added come from week 1; week 2 unchanged');
});

await test('re-review 2: a correction cannot pick another buyer\'s portion — recording and correcting check the same', async () => {
  const db = await fresh();
  const f = await folder(db, 'Barlin'); await period(db, f);
  const r = await request(db, f, { quantity: 4 });
  const next = (await one(db, `select pr_batch_for($1, now() + interval '8 days') b`, [OWNER])).b;
  const w2 = (await one(db, `insert into pr_line_portions (owner_id, line_id, batch_id, quantity) values ($1, $2, $3, 6) returning id`, [OWNER, r.line, next])).id;
  await as(db, OWNER); await db.query(`select pur_assign_portion($1, $2, null, null)`, [w2, BUYER2]);
  await as(db, BUYER);
  const line = { folder_id: f, item_name: 'Cement', quantity: 4, amount: 1000, request_line_id: r.line,
                 portion_picks: [{ portion_id: r.portion, quantity: 4 }] };
  const res = await record(db, body([line]));
  const repick = body([{ ...line, quantity: 6, amount: 1500, portion_picks: [{ portion_id: r.portion, quantity: 4 }, { portion_id: w2, quantity: 2 }] }]);
  assert((await code(record(db, repick))).includes('ASSIGNED_TO_OTHER'), 'recording refuses Pedro\'s portion');
  assert((await code(db.query(`select pur_correct($1, $2, $3::jsonb, 'two more')`, [op(), res.purchase_id, JSON.stringify(repick)]))).includes('ASSIGNED_TO_OTHER'),
    'so does a correction that newly picks it');
  assert((await code(db.query(`select pur_replace($1, $2, $3::jsonb, 'two more')`, [op(), res.purchase_id,
    JSON.stringify(body([repick.lines[0], { folder_id: f, item_name: 'Tape', amount: 20, unplanned_reason: 'r' }]))]))).includes('ASSIGNED_TO_OTHER'),
    'and a replacement');
  eq((await portions(db, r.line)).map(p => [p.bought, p.buyer]), [[4, BUYER], [0, BUYER2]], 'Pedro\'s portion untouched');
  // The owner may cover it — without taking it over.
  await as(db, OWNER);
  await db.query(`select pur_correct($1, $2, $3::jsonb, 'two more')`, [op(), res.purchase_id, JSON.stringify(repick)]);
  eq((await portions(db, r.line)).map(p => [p.bought, p.buyer]), [[4, BUYER], [2, BUYER2]], 'the owner covered 2, Pedro still holds it');
});

await test('R14: a substitute states why and covers nothing until someone else checks it', async () => {
  const db = await fresh();
  const f = await folder(db, 'Barlin'); await period(db, f);
  const r = await request(db, f, { quantity: 10, description: 'Boysen paint white', unit: 'gal' });
  await as(db, BUYER);
  const sub = { folder_id: f, item_name: 'Davies paint white', quantity: 10, unit: 'gal', amount: 5000, request_line_id: r.line, substitute: true };
  assert((await code(record(db, body([sub])))).includes('SUBSTITUTE_REASON_REQUIRED'), 'a reason is needed');
  const res = await record(db, body([{ ...sub, substitute_reason: 'Boysen out of stock; same coverage per gallon' }]));
  eq(res.covers, [{ line: 1, extra: 0, covered: 0, unit_check: 'pending' }], 'waits for an office check');
  let line = await listLine(db, r.line);
  eq([num(line.still_to_buy), num(line.unit_checks)], [10, 1], 'Still to buy 10, one check waiting');
  assert((await code(db.query(`select pur_check_unit($1, $2, 1, 10, 'fine')`, [op(), res.purchase_id]))).includes('OWN_PURCHASE'), 'not the buyer');
  await as(db, BUYER2);
  await db.query(`select pur_check_unit($1, $2, 1, 10, 'Equivalent — confirmed with the foreman')`, [op(), res.purchase_id]);
  line = await listLine(db, r.line);
  eq([num(line.bought), num(line.still_to_buy)], [10, 0], 'covered after the check');
  const l = await one(db, `select item_name, substitute, substitute_reason from purchase_lines where purchase_id = $1`, [res.purchase_id]);
  eq([l.item_name, l.substitute, l.substitute_reason], ['Davies paint white', true, 'Boysen out of stock; same coverage per gallon'], 'actual item and reason kept');
  // Renaming the substitute is checked again (the check named another item).
  await as(db, BUYER);
  await db.query(`select pur_correct($1, $2, $3::jsonb, 'brand')`, [op(), res.purchase_id,
    JSON.stringify(body([{ ...sub, item_name: 'Nation paint white', substitute_reason: 'Davies also out' }]))]);
  eq(num((await listLine(db, r.line)).bought), 0, 'a different substitute waits for its own check');
});

await test('Project Control\'s correction keeps the request link, rebuilds covers once, and Spent moves by the difference', async () => {
  const db = await fresh();
  const f = await folder(db, 'Barlin'); await period(db, f);
  const r = await request(db, f, { quantity: 10 });
  await as(db, BUYER);
  const res = await record(db, body([{ folder_id: f, item_name: 'Cement', quantity: 6, amount: 1500, request_line_id: r.line }]));
  await as(db, STAFF);   // a non-buyer fixing the price from Project Control: no link, no source
  const pc = { purchase_date: '2026-10-14', date_time: '2026-10-14', supplier: 'Wilcon', receipt_total: 1560, notes: '', payment_method: 'CASH', docs: {},
               lines: [{ destination: 'project', folder_id: f, item_name: 'Cement', category: 'Materials', quantity: 6, unit: 'bag', amount: 1560 }], charges: [] };
  await db.query(`select pur_correct($1, $2, $3::jsonb, 'receipt said 1,560')`, [op(), res.purchase_id, JSON.stringify(pc)]);
  await as(db, BUYER);
  eq((await one(db, `select request_line_id from purchase_lines where purchase_id = $1`, [res.purchase_id])).request_line_id, r.line, 'link kept');
  eq(num((await one(db, `select count(*) n from purchase_line_covers`)).n), 1, 'covers rebuilt, not doubled');
  eq(num((await listLine(db, r.line)).bought), 6, 'Bought still 6');
  eq(await spent(db, f), 1560, 'Spent +60');
});

await test('corrections: raising the quantity past Still to buy needs a reason; a request reduced after buying does not', async () => {
  const db = await fresh();
  const f = await folder(db, 'Barlin'); await period(db, f);
  const r = await request(db, f, { quantity: 10 });
  await as(db, BUYER);
  const res = await record(db, body([{ folder_id: f, item_name: 'Cement', quantity: 10, amount: 2500, request_line_id: r.line }]));
  const raised = body([{ folder_id: f, item_name: 'Cement', quantity: 11, amount: 2750, request_line_id: r.line }]);
  assert((await code(db.query(`select pur_correct($1, $2, $3::jsonb, 'one more')`, [op(), res.purchase_id, JSON.stringify(raised)]))).includes('EXTRA_REASON_REQUIRED'), 'raised');
  // The worker reduces the request to 7 after buying (0085/0097 rule: flagged on the bought portion).
  await db.query(`select pr_apply_quantity($1, 7, $2)`, [r.line, OWNER]);
  const priceOnly = body([{ folder_id: f, item_name: 'Cement', quantity: 10, amount: 2400, request_line_id: r.line }]);
  await db.query(`select pur_correct($1, $2, $3::jsonb, 'discount')`, [op(), res.purchase_id, JSON.stringify(priceOnly)]);
  const l = await one(db, `select covered_qty, extra_qty, extra_reason, extra_location from purchase_lines where purchase_id = $1`, [res.purchase_id]);
  eq([num(l.covered_qty), num(l.extra_qty), l.extra_reason, l.extra_location],
     [7, 3, 'The request was reduced after this was bought', 'project'], 'honest system reason');
  eq(num((await listLine(db, r.line)).still_to_buy), 0, 'never negative');
});

await test('void returns the quantity to Still to buy; the assignment stays; history keeps who bought', async () => {
  const db = await fresh();
  const f = await folder(db, 'Barlin'); await period(db, f);
  const r = await request(db, f, { quantity: 10 });
  await as(db, BUYER);
  const res = await record(db, body([{ folder_id: f, item_name: 'Cement', quantity: 10, amount: 2500, request_line_id: r.line }]));
  eq(num((await listLine(db, r.line)).still_to_buy), 0, 'all bought');
  await db.query(`select pur_void($1, $2, 'wrong supplier')`, [op(), res.purchase_id]);
  const line = await listLine(db, r.line);
  eq([num(line.bought), num(line.still_to_buy), line.portions[0].buyer_name], [0, 10, 'Juan'], 'back to Still 10, still Juan\'s');
  eq(await spent(db, f), 0, 'Spent back to 0');
  eq(num((await one(db, `select count(*) n from purchase_line_covers`)).n), 1, 'the cover stays as history');
});

await test('replace covers the same portions once (the old purchase is voided first)', async () => {
  const db = await fresh();
  const f = await folder(db, 'Barlin'); await period(db, f);
  const r = await request(db, f, { quantity: 10 });
  const r2 = await request(db, f, { quantity: 5, description: 'Sand', unit: 'cu.m' });
  await as(db, BUYER);
  const res = await record(db, body([{ folder_id: f, item_name: 'Cement', quantity: 10, amount: 2500, request_line_id: r.line }]));
  const nb = body([{ folder_id: f, item_name: 'Cement', quantity: 10, amount: 2500, request_line_id: r.line },
                   { folder_id: f, item_name: 'Sand', quantity: 5, unit: 'cu.m', amount: 4000, request_line_id: r2.line }]);
  const rep = (await one(db, `select pur_replace($1, $2, $3::jsonb, 'forgot the sand') r`, [op(), res.purchase_id, JSON.stringify(nb)])).r;
  eq((await rep).covers.map(c => num(c.covered)), [10, 5], 'both covered in full');
  eq(num((await listLine(db, r.line)).bought), 10, 'Cement bought 10, not 20');
  eq(await spent(db, f), 6500, 'Spent once');
});

await test('a retry with the same operation id covers once', async () => {
  const db = await fresh();
  const f = await folder(db, 'Barlin'); await period(db, f);
  const r = await request(db, f, { quantity: 10 });
  await as(db, BUYER);
  const id = op();
  const b = body([{ folder_id: f, item_name: 'Cement', quantity: 4, amount: 1000, request_line_id: r.line }]);
  await record(db, b, id);
  const again = await record(db, b, id);
  eq(again.replayed, true, 'replayed');
  eq(num((await listLine(db, r.line)).bought), 4, 'Bought 4, once');
});

await test('request links stay in their project and company; no request = Unplanned with a reason', async () => {
  const db = await fresh();
  const f = await folder(db, 'Barlin'); await period(db, f);
  const g = await folder(db, 'Prado'); await period(db, g);
  const r = await request(db, f);
  await as(db, BUYER);
  assert((await code(record(db, body([{ folder_id: g, item_name: 'Cement', quantity: 1, amount: 1, request_line_id: r.line }])))).includes('BAD_REQUEST_LINK'), 'other project');
  assert((await code(record(db, body([{ destination: 'warehouse', item_name: 'Cement', quantity: 1, amount: 1, request_line_id: r.line }])))).includes('BAD_REQUEST_LINK'), 'warehouse line');
  assert((await code(record(db, body([{ folder_id: f, item_name: 'Cement', quantity: 1, amount: 1, request_line_id: 'nope' }])))).includes('BAD_REQUEST_LINK'), 'not a uuid');
  assert((await code(record(db, body([{ folder_id: f, item_name: 'Tape', quantity: 1, amount: 1 }])))).includes('UNPLANNED_REASON_REQUIRED'), 'unplanned needs a reason');
  await record(db, body([{ folder_id: f, item_name: 'Tape', quantity: 1, amount: 1, unplanned_reason: 'leak at the roof' }]));
  await as(db, OTHER);
  const og = await folder(db, 'Theirs', { owner: OTHER }); await period(db, og, 100000, OTHER);
  assert((await code(record(db, { ...body([{ folder_id: og, item_name: 'Cement', quantity: 1, amount: 1, request_line_id: r.line }]), source: 'expenses_form' }))).includes('BAD_REQUEST_LINK'), 'another company\'s request');
});

await test('only the owner records a purchase for someone else, and only for a buyer', async () => {
  const db = await fresh();
  const f = await folder(db, 'Barlin'); await period(db, f);
  const b = body([{ folder_id: f, item_name: 'Tape', amount: 10, unplanned_reason: 'r' }]);
  await as(db, BUYER);
  assert((await code(record(db, { ...b, bought_by: BUYER2 }))).includes('BAD_BUYER'), 'a buyer for another');
  await as(db, OWNER);
  assert((await code(record(db, { ...b, bought_by: STAFF }))).includes('BAD_BUYER'), 'not a buyer');
  const res = await record(db, { ...b, bought_by: BUYER2 });
  const pu = await one(db, `select recorded_by, bought_by from purchases where id = $1`, [res.purchase_id]);
  eq([pu.recorded_by, pu.bought_by], [OWNER, BUYER2], 'encoder and buyer kept apart');
});

// ── D. Quantity changes protect what was bought ──────────────────────

await test('a reduction removes unbought quantity first, then FLAGS the bought portion — a purchase is never erased', async () => {
  const db = await fresh();
  const f = await folder(db, 'Barlin'); await period(db, f);
  const r = await request(db, f, { quantity: 10 });
  await as(db, BUYER);
  await record(db, body([{ folder_id: f, item_name: 'Cement', quantity: 6, amount: 1500, request_line_id: r.line }]));
  await db.query(`select pr_apply_quantity($1, 5, $2)`, [r.line, OWNER]);
  const ps = await portions(db, r.line);
  eq(ps.map(p => [p.q, p.pending, p.bought]), [[6, 1, 6]], 'the unbought 4 went; 1 flagged on the bought 6');
  const line = await listLine(db, r.line);
  eq([num(line.needed), num(line.bought), num(line.still_to_buy)], [5, 6, 0], 'Needed 5, Bought 6, Still 0');
});

await test('new demand never merges into a portion someone is buying or bought', async () => {
  const db = await fresh();
  const f = await folder(db, 'Barlin');
  const r = await request(db, f, { quantity: 10 });
  await as(db, BUYER); await db.query(`select pur_assign_portion($1, $2, null, null)`, [r.portion, BUYER]);
  await as(db, OWNER); await db.query(`select pr_office_change_quantity($1, 13, 'three more for the gate')`, [r.line]);
  await as(db, BUYER);
  eq((await portions(db, r.line)).map(p => [p.q, p.buyer]), [[10, BUYER], [3, null]], 'a new unassigned portion of 3');
  const line = await listLine(db, r.line);
  assert(line.portions[0].changed === true, 'Juan sees "quantity changed"');
});

await test('a bought portion cannot move to another batch', async () => {
  const db = await fresh();
  const f = await folder(db, 'Barlin'); await period(db, f);
  const r = await request(db, f, { quantity: 10 });
  await as(db, BUYER);
  await record(db, body([{ folder_id: f, item_name: 'Cement', quantity: 2, amount: 500, request_line_id: r.line }]));
  const next = (await one(db, `select pr_batch_for($1, now() + interval '8 days') b`, [OWNER])).b;
  await as(db, OWNER);
  assert((await code(db.query(`select pr_office_move_portion($1, $2, null)`, [r.portion, next]))).includes('BOUGHT'), 'refused');
});

// ── E. Owner approval ────────────────────────────────────────────────

await test('a staff change for the owner: requested, approved once, applied through the normal correction', async () => {
  const db = await fresh();
  const f = await folder(db, 'Barlin'); await period(db, f);
  const g = await folder(db, 'Prado'); await period(db, g);
  await as(db, BUYER);
  const res = await record(db, body([{ folder_id: f, item_name: 'Tape', amount: 100, unplanned_reason: 'r' }]));
  const moved = body([{ folder_id: g, item_name: 'Tape', amount: 100, unplanned_reason: 'r' }]);
  assert((await code(db.query(`select pur_correct($1, $2, $3::jsonb, 'wrong site')`, [op(), res.purchase_id, JSON.stringify(moved)]))).includes('OWNER_APPROVAL_NEEDED'), 'needs the owner');
  const reqOp = op();
  const cr = (await one(db, `select pur_request_change($1, $2, 'correct', $3::jsonb, 'wrong site') r`, [reqOp, res.purchase_id, JSON.stringify(moved)])).r;
  eq((await one(db, `select pur_request_change($1, $2, 'correct', $3::jsonb, 'wrong site') r`, [reqOp, res.purchase_id, JSON.stringify(moved)])).r.request_id, cr.request_id, 'retry = same request');
  assert((await code(db.query(`select pur_request_change($1, $2, 'void', null, 'again')`, [op(), res.purchase_id]))).includes('ALREADY_PENDING'), 'one pending per purchase');
  await as(db, BUYER2);
  eq((await one(db, `select pur_change_requests('pending') l`)).l.length, 0, 'another staff member does not see it');
  await as(db, OWNER);
  eq((await one(db, `select pur_change_requests('pending') l`)).l.length, 1, 'the owner sees it');
  const decideOp = op();
  const d = (await one(db, `select pur_decide_change($1, $2, true, null) r`, [decideOp, cr.request_id])).r;
  eq(d.status, 'approved', 'approved');
  eq((await one(db, `select pur_decide_change($1, $2, true, null) r`, [decideOp, cr.request_id])).r.replayed, true, 'decide retry');
  eq([await spent(db, f), await spent(db, g)], [0, 100], 'moved to Prado once');
  const h = await one(db, `select kind, reason from purchase_history where purchase_id = $1 order by id desc limit 1`, [res.purchase_id]);
  eq(h.kind, 'corrected', 'normal correction');
  assert(h.reason.includes('requested by Juan'), 'history names who asked');
});

await test('a request goes stale if the purchase changed; a rejection needs a note; the requester can withdraw', async () => {
  const db = await fresh();
  const f = await folder(db, 'Barlin', { completed: false }); await period(db, f);
  await as(db, BUYER);
  const res = await record(db, body([{ folder_id: f, item_name: 'Tape', amount: 100, unplanned_reason: 'r' }]));
  const cr = (await one(db, `select pur_request_change($1, $2, 'void', null, 'duplicate') r`, [op(), res.purchase_id])).r;
  await as(db, OWNER);
  const fix = body([{ folder_id: f, item_name: 'Tape', amount: 90, unplanned_reason: 'r' }]);
  await db.query(`select pur_correct($1, $2, $3::jsonb, 'price')`, [op(), res.purchase_id, JSON.stringify(fix)]);
  eq((await one(db, `select pur_decide_change($1, $2, true, null) r`, [op(), cr.request_id])).r.status, 'stale', 'stale');
  eq(await spent(db, f), 90, 'nothing applied');
  await as(db, BUYER);
  const cr2 = (await one(db, `select pur_request_change($1, $2, 'void', null, 'duplicate') r`, [op(), res.purchase_id])).r;
  await as(db, OWNER);
  assert((await code(db.query(`select pur_decide_change($1, $2, false, '')`, [op(), cr2.request_id]))).includes('REASON_REQUIRED'), 'note needed');
  await db.query(`select pur_decide_change($1, $2, false, 'keep it')`, [op(), cr2.request_id]);
  await as(db, BUYER);
  const cr3 = (await one(db, `select pur_request_change($1, $2, 'void', null, 'dup') r`, [op(), res.purchase_id])).r;
  await db.query(`select pur_withdraw_change($1)`, [cr3.request_id]);
  eq((await one(db, `select status from purchase_change_requests where id = $1`, [cr3.request_id])).status, 'withdrawn', 'withdrawn');
  await as(db, OWNER);
  assert((await code(db.query(`select pur_request_change($1, $2, 'void', null, 'x')`, [op(), res.purchase_id]))).includes('OWNER_CAN_DO_IT'), 'the owner just does it');
});

await test('review 3: the owner sees the whole change, and any change since — even a unit check — makes it stale', async () => {
  const db = await fresh();
  const f = await folder(db, 'Barlin'); await period(db, f);
  const g = await folder(db, 'Prado'); await period(db, g);
  const h = await request(db, f, { quantity: 24, unit: 'pcs', description: 'Hinge' });
  await as(db, OWNER);
  const sup = (await one(db, `select pur_save_supplier(null, 'Wilcon', 'Cubao', '', true) s`)).s;
  await as(db, BUYER);
  const hinge = { folder_id: f, item_name: 'Hinge', quantity: 2, unit: 'box', amount: 900, request_line_id: h.line };
  const res = await record(db, body([hinge, { folder_id: f, item_name: 'Tape', amount: 100, unplanned_reason: 'r' }],
                                    { charges: [{ kind: 'delivery_fee', amount: 100 }], receipt_total: 1100 }));
  const moved = body([hinge, { folder_id: g, item_name: 'Tape', quantity: 3, unit: 'roll', amount: 150, unplanned_reason: 'r' }],
                     { purchase_date: '2026-10-13', date_time: '2026-10-13T08:00', supplier: '', supplier_id: sup.id, receipt_total: 1150,
                       charges: [{ kind: 'delivery_fee', amount: 100, shares: [{ line: 1, amount: 40 }, { line: 2, amount: 60 }] }] });
  const cr = (await one(db, `select pur_request_change($1, $2, 'correct', $3::jsonb, 'The tape was for Prado') r`,
                        [op(), res.purchase_id, JSON.stringify(moved)])).r;
  await as(db, OWNER);
  let req = (await one(db, `select pur_change_requests('pending') l`)).l[0];
  eq([req.base.purchase_date, req.proposed.purchase_date, req.proposed.date_time], ['2026-10-14', '2026-10-13', '2026-10-13T08:00'], 'dates');
  eq([req.base.supplier, req.proposed.supplier], ['Wilcon', 'Wilcon · Cubao'], 'supplier');
  eq(req.proposed.lines.map(l => [num(l.quantity), l.unit, num(l.amount), l.where]),
     [[2, 'box', 900, 'Barlin · Main Contract'], [3, 'roll', 150, 'Prado · Main Contract']], 'quantities, units, amounts, projects');
  eq([req.base.lines[1].quantity, req.base.lines[1].unit].map(String), ['1', 'bag'], 'the tape as it was');
  eq([req.base.charges[0].shares.map(num), req.proposed.charges[0].shares.map(num)], [[90, 10], [40, 60]], 'fee split before and asked for');
  eq([req.proposed.lines[0].request, num(req.proposed.receipt_total)], ['Hinge (pcs)', 1150], 'request and total');
  eq(req.changed_since, false, 'nothing changed yet');
  // An office check after the request changes what the purchase covers.
  await db.query(`select pur_check_unit($1, $2, 1, 24, '2 boxes of 12')`, [op(), res.purchase_id]);
  req = (await one(db, `select pur_change_requests('pending') l`)).l[0];
  eq(req.changed_since, true, 'the owner is warned before approving');
  eq((await one(db, `select pur_decide_change($1, $2, true, null) r`, [op(), cr.request_id])).r.status, 'stale', 'approval refused');
  eq([await spent(db, f), await spent(db, g)], [1100, 0], 'nothing applied');
});

await test('completed project: a staff void goes to the owner and is applied on approval', async () => {
  const db = await fresh();
  const f = await folder(db, 'Barlin'); await period(db, f);
  await as(db, BUYER);
  const res = await record(db, body([{ folder_id: f, item_name: 'Tape', amount: 100, unplanned_reason: 'r' }]));
  await db.query(`update folders set completed_at = now() where id = $1`, [f]);
  assert((await code(db.query(`select pur_void($1, $2, 'dup')`, [op(), res.purchase_id]))).includes('COMPLETED_PROJECT'), 'staff refused');
  const cr = (await one(db, `select pur_request_change($1, $2, 'void', null, 'duplicate receipt') r`, [op(), res.purchase_id])).r;
  await as(db, OWNER);
  await db.query(`select pur_decide_change($1, $2, true, null)`, [op(), cr.request_id]);
  eq((await one(db, `select status from purchases where id = $1`, [res.purchase_id])).status, 'void', 'voided');
});

// ── F. Isolation ─────────────────────────────────────────────────────

await test('workers, non-buyer staff and other companies read and change nothing purchase-related', async () => {
  const db = await fresh();
  const f = await folder(db, 'Barlin'); await period(db, f);
  const r = await request(db, f);
  for (const who of [WORKER, STAFF, PMOWNER]) {
    await as(db, who);
    for (const call of [`select pur_shopping_list()`, `select pur_purchases()`, `select pur_suppliers()`, `select pur_buyer_options()`]) {
      const c = await code(db.query(call));
      assert(c.includes('BUYER_REQUIRED'), who + ' ' + call + ' → ' + c);
    }
    assert((await code(db.query(`select pur_assign_portion($1, $2, null, null)`, [r.portion, who]))).includes('BUYER_REQUIRED'), who + ' assign');
  }
  await as(db, OTHER);
  eq((await one(db, `select pur_shopping_list(null, null, 'all') l`)).l, [], 'another company sees no lines');
  assert((await code(db.query(`select pur_assign_portion($1, $2, null, null)`, [r.portion, OTHER]))).includes('NOT_FOUND'), 'another company cannot assign');
});

await test('R3: purchase rows are read by buyers only; Project Control staff get the one line they edit', async () => {
  const db = await fresh();
  const f = await folder(db, 'Barlin'); await period(db, f);
  await as(db, BUYER);
  const res = await record(db, body([{ folder_id: f, item_name: 'Tape', amount: 100, unplanned_reason: 'r' }]));
  const lineId = (await one(db, `select id from purchase_lines where purchase_id = $1`, [res.purchase_id])).id;
  eq((await one(db, `select pur_reader() r`)).r, true, 'a buyer reads purchase rows');
  await as(db, STAFF);
  eq((await one(db, `select pur_reader() r`)).r, false, 'staff without the switch no longer do (0096 let them)');
  const row = (await one(db, `select pur_entry_row($1, null) r`, [lineId])).r;
  eq([row.purchase.id, row.line.item_name, num(row.line.gross_amount), num(row.line_count), num(row.charge_count)],
     [res.purchase_id, 'Tape', 100, 1, 0], 'what the Edit Expense form needs');
  eq([Object.keys(row).sort(), 'bought_by' in row.purchase, 'request_line_id' in row.line],
     [['charge_count', 'line', 'line_count', 'purchase'], false, false], 'and nothing else');
  eq((await one(db, `select pur_review_lines() r`)).r, [], 'review flags: ids only');
  await as(db, WORKER);
  assert((await code(db.query(`select pur_entry_row($1, null)`, [lineId]))).includes('NOT_OFFICE'), 'a worker gets nothing');
  await as(db, PMOWNER);
  assert((await code(db.query(`select pur_entry_row($1, null)`, [lineId]))).includes('NOT_ALLOWED'), 'an account without Expenses gets nothing');
  await as(db, OTHER);
  assert((await code(db.query(`select pur_entry_row($1, null)`, [lineId]))).includes('NOT_FOUND'), 'another company gets nothing');
});

await test('the shopping list is quantities and names only — no peso amount anywhere', async () => {
  const db = await fresh();
  const f = await folder(db, 'Barlin'); await period(db, f);
  const r = await request(db, f, { quantity: 10, urgent: true });
  await as(db, BUYER);
  await record(db, body([{ folder_id: f, item_name: 'Cement', quantity: 3, amount: 777.77, request_line_id: r.line }]));
  const text = JSON.stringify((await one(db, `select pur_shopping_list() l`)).l);
  // '777.77', not '777': the ids in the list are random and may contain 777.
  assert(!text.includes('777.77') && !/amount|price|total|cost/i.test(text), 'no money: ' + text.slice(0, 200));
  assert(text.includes('"urgent":true'), 'urgent shown');
});

// ── G. Receipts ──────────────────────────────────────────────────────

await test('purchase receipts: buyers of that company only — not non-buyer staff, workers or other companies', async () => {
  const db = await fresh();
  const p = `purchases/${OWNER}/2026-10/30000000-0000-0000-0000-000000000001.jpg`;
  const can = async (who, fn) => { await as(db, who); return (await one(db, fn === 'r' ? `select uploads_can_read($1, null) x` : `select uploads_can_write($1) x`, [p])).x; };
  eq([await can(OWNER, 'r'), await can(BUYER, 'r'), await can(BUYER, 'w')], [true, true, true], 'owner and buyer');
  eq([await can(STAFF, 'r'), await can(STAFF, 'w'), await can(WORKER, 'r'), await can(OTHER, 'r'), await can(PMOWNER, 'r')],
     [false, false, false, false, false], 'everyone else refused');
  await db.query(`insert into receipt_uploads (path, owner_id, kind) values ($1, $2, 'purchase')`, [p, OWNER]);
});

// ── H. Fix round 1 ───────────────────────────────────────────────────

await test('fix 1: a replacement keeps who bought and the supplier — whoever replaces it, whatever the body omits', async () => {
  const db = await fresh();
  const f = await folder(db, 'Barlin'); await period(db, f);
  const r = await request(db, f, { quantity: 10 });
  await as(db, OWNER);
  const sup = (await one(db, `select pur_save_supplier(null, 'Wilcon', 'Cubao', '', true) s`)).s;
  await as(db, BUYER);
  const line = { folder_id: f, item_name: 'Cement', quantity: 10, amount: 2500, request_line_id: r.line };
  const res = await record(db, body([line], { supplier_id: sup.id }));
  // (a) Pedro replaces Juan's purchase; the body says nothing about who bought.
  await as(db, BUYER2);
  const rep = (await one(db, `select pur_replace($1, $2, $3::jsonb, 'price') r`, [op(), res.purchase_id, JSON.stringify(body([{ ...line, amount: 2400 }]))])).r;
  const np = await one(db, `select bought_by, recorded_by, supplier_id from purchases where id = $1`, [rep.purchase_id]);
  eq([np.bought_by, np.recorded_by, np.supplier_id], [BUYER, BUYER2, sup.id], 'Juan still bought it; Pedro recorded the change; the supplier stays (c)');
  eq((await all(db, `select distinct c.buyer_id from purchase_line_covers c join purchase_lines l on l.id = c.line_id where l.purchase_id = $1`, [rep.purchase_id])).map(x => x.buyer_id),
     [BUYER], 'every cover is still Juan\'s');
  // (b) Sending the same buyer explicitly is accepted too.
  const rep2 = (await one(db, `select pur_replace($1, $2, $3::jsonb, 'again') r`, [op(), rep.purchase_id,
    JSON.stringify(body([{ ...line, amount: 2450 }], { bought_by: BUYER }))])).r;
  eq((await one(db, `select bought_by from purchases where id = $1`, [rep2.purchase_id])).bought_by, BUYER, 'bought_by: Juan accepted');
});

await test('fix 1: the owner approving a staff replacement does not become the buyer', async () => {
  const db = await fresh();
  const f = await folder(db, 'Barlin'); await period(db, f);
  const g = await folder(db, 'Prado'); await period(db, g);
  await as(db, BUYER);
  const res = await record(db, body([{ folder_id: f, item_name: 'Tape', amount: 100, unplanned_reason: 'r' }]));
  await as(db, STAFF);
  const moved = { ...body([{ folder_id: g, item_name: 'Tape', amount: 100 }]), source: 'expenses_form' };
  const cr = (await one(db, `select pur_request_change($1, $2, 'replace', $3::jsonb, 'wrong site') r`, [op(), res.purchase_id, JSON.stringify(moved)])).r;
  await as(db, OWNER);
  const d = (await one(db, `select pur_decide_change($1, $2, true, null) r`, [op(), cr.request_id])).r;
  eq(d.status, 'approved', 'approved');
  const np = await one(db, `select bought_by, recorded_by from purchases where id = $1`, [d.result.purchase_id]);
  eq([np.bought_by, np.recorded_by], [BUYER, OWNER], 'Juan bought it, the owner applied it');
});

await test('fix 2: non-buyers see a whole purchase only when it is one line without fees; their change request shows no base or current', async () => {
  const db = await fresh();
  const f = await folder(db, 'Barlin'); await period(db, f);
  await as(db, BUYER);
  const two = await record(db, body([{ folder_id: f, item_name: 'Tape', amount: 100, unplanned_reason: 'r' },
                                     { folder_id: f, item_name: 'Nails', amount: 50, unplanned_reason: 'r' }], { supplier: 'Secret Supplier' }));
  const one1 = await record(db, body([{ folder_id: f, item_name: 'Wire', amount: 30, unplanned_reason: 'r' }]));
  const lineOf = async (p) => (await one(db, `select id from purchase_lines where purchase_id = $1 order by line_no limit 1`, [p])).id;
  await as(db, STAFF);
  const r2 = (await one(db, `select pur_entry_row($1, null) r`, [await lineOf(two.purchase_id)])).r;
  eq(Object.keys(r2.purchase).sort(), ['id', 'status'], 'a two-line purchase: id and status only');
  eq([num(r2.line_count), r2.line.item_name], [2, 'Tape'], 'the line and the counts stay');
  assert(!JSON.stringify(r2).includes('Secret'), 'no supplier');
  const r1 = (await one(db, `select pur_entry_row($1, null) r`, [await lineOf(one1.purchase_id)])).r;
  eq([r1.purchase.supplier, num(r1.purchase.receipt_total)], ['Wilcon', 30], 'a one-line purchase keeps its header');
  const cr = (await one(db, `select pur_request_change($1, $2, 'void', null, 'duplicate') r`, [op(), two.purchase_id])).r;
  const mine = (await one(db, `select pur_change_requests('pending') l`)).l.find(x => x.id === cr.request_id);
  eq([mine.base, mine.current], [null, null], 'the requester sees neither the stored purchase nor its present state');
  await as(db, OWNER);
  const seen = (await one(db, `select pur_change_requests('pending') l`)).l.find(x => x.id === cr.request_id);
  eq([seen.base.lines.length, seen.current.lines.length], [2, 2], 'the owner sees both');
});

await test('fix 3: the owner sees whose portion a change picks', async () => {
  const db = await fresh();
  const f = await folder(db, 'Barlin'); await period(db, f);
  const r = await request(db, f, { quantity: 10 });
  await as(db, OWNER); await db.query(`select pur_assign_portion($1, $2, null, null)`, [r.portion, BUYER2]);
  await as(db, BUYER);
  const res = await record(db, body([{ folder_id: f, item_name: 'Tape', amount: 100, unplanned_reason: 'r' }]));
  const asked = body([{ folder_id: f, item_name: 'Cement', quantity: 4, amount: 100, request_line_id: r.line,
                        portion_picks: [{ portion_id: r.portion, quantity: 4 }] }]);
  const cr = (await one(db, `select pur_request_change($1, $2, 'replace', $3::jsonb, 'it was cement') r`, [op(), res.purchase_id, JSON.stringify(asked)])).r;
  await as(db, OWNER);
  const req = (await one(db, `select pur_change_requests('pending') l`)).l.find(x => x.id === cr.request_id);
  eq(req.proposed.lines[0].picks.map(p => [num(p.quantity), p.buyer]), [[4, 'Pedro']], 'Pedro holds it');
});

await test('fix 5: no NEW link to a cancelled line — a price fix on an already-linked one still works', async () => {
  const db = await fresh();
  const f = await folder(db, 'Barlin'); await period(db, f);
  const r = await request(db, f, { quantity: 10 });
  const r2 = await request(db, f, { quantity: 5, description: 'Sand', unit: 'cu.m' });
  await as(db, BUYER);
  const line = { folder_id: f, item_name: 'Cement', quantity: 4, amount: 1000, request_line_id: r.line };
  const res = await record(db, body([line]));
  await db.query(`update pr_lines set status = 'cancelled' where id = $1`, [r.line]);
  await db.query(`update pr_lines set status = 'cancelled' where id = $1`, [r2.line]);
  await db.query(`select pur_correct($1, $2, $3::jsonb, 'price')`, [op(), res.purchase_id, JSON.stringify(body([{ ...line, amount: 900 }]))]);
  eq(await spent(db, f), 900, 'the price fix went through');
  assert((await code(record(db, body([{ folder_id: f, item_name: 'Sand', quantity: 1, unit: 'cu.m', amount: 10, request_line_id: r2.line }])))).includes('LINE_CLOSED'),
    'a new link to the cancelled line is refused');
  await db.query(`update pr_lines set status = 'open' where id = $1`, [r2.line]);
  await db.query(`update pr_requests set status = 'cancelled' where id = $1`, [r2.req]);
  assert((await code(record(db, body([{ folder_id: f, item_name: 'Sand', quantity: 1, unit: 'cu.m', amount: 10, request_line_id: r2.line }])))).includes('LINE_CLOSED'),
    'nor to a line of a cancelled request');
});

await test('fix 9: a replacement that puts a new line AHEAD of a linked one keeps the linked line on its old portion', async () => {
  const db = await fresh();
  const f = await folder(db, 'Barlin'); await period(db, f);
  const r = await request(db, f, { quantity: 5 });
  const next = (await one(db, `select pr_batch_for($1, now() + interval '8 days') b`, [OWNER])).b;
  const w2 = (await one(db, `insert into pr_line_portions (owner_id, line_id, batch_id, quantity) values ($1, $2, $3, 5) returning id`, [OWNER, r.line, next])).id;
  await as(db, OWNER); await db.query(`select pur_assign_portion($1, $2, null, null)`, [r.portion, BUYER2]);
  await as(db, BUYER);
  const cement = { folder_id: f, item_name: 'Cement', quantity: 5, amount: 1250, request_line_id: r.line };
  const res = await record(db, body([cement]));     // week 1 is Pedro's, so this covers week 2
  await as(db, OWNER); await db.query(`select pur_assign_portion($1, $2, null, 'Pedro is off')`, [r.portion, BUYER]);
  const covered = async (pid) => (await all(db, `select c.portion_id, c.quantity from purchase_line_covers c join purchase_lines l on l.id = c.line_id
                                                   where l.purchase_id = $1 order by c.id`, [pid])).map(c => [c.portion_id, num(c.quantity)]);
  eq(await covered(res.purchase_id), [[w2, 5]], 'week 2 to begin with');
  await as(db, BUYER);
  const tape = { folder_id: f, item_name: 'Tape', amount: 20, unplanned_reason: 'r' };
  const rep = (await one(db, `select pur_replace($1, $2, $3::jsonb, 'forgot the tape') r`, [op(), res.purchase_id, JSON.stringify(body([tape, { ...cement, amount: 1200 }]))])).r;
  eq(await covered(rep.purchase_id), [[w2, 5]], 'the Cement line (now line 2) still covers week 2');
  // Project Control (no switch) can do the same without being refused for "a new link".
  await as(db, STAFF);
  const nails = { folder_id: f, item_name: 'Nails', amount: 10 };
  const rep2 = (await one(db, `select pur_replace($1, $2, $3::jsonb, 'forgot the nails') r`, [op(), rep.purchase_id,
    JSON.stringify({ ...body([nails, tape, { ...cement, amount: 1200 }]), source: 'expenses_form' })])).r;
  eq(await covered(rep2.purchase_id), [[w2, 5]], 'a non-buyer keeps it too, no BUYER_REQUIRED');
});

await test('fix 10: someone without the switch cannot unlink a request line; a buyer can (as Unplanned, with a reason)', async () => {
  const db = await fresh();
  const f = await folder(db, 'Barlin'); await period(db, f);
  const r = await request(db, f, { quantity: 10 });
  await as(db, BUYER);
  const line = { folder_id: f, item_name: 'Cement', quantity: 4, amount: 1000, request_line_id: r.line };
  const res = await record(db, body([line]));
  const unlink = { ...body([{ ...line, request_line_id: null }]), source: 'expenses_form' };
  await as(db, STAFF);
  assert((await code(db.query(`select pur_correct($1, $2, $3::jsonb, 'x')`, [op(), res.purchase_id, JSON.stringify(unlink)]))).includes('BUYER_REQUIRED'), 'correct');
  assert((await code(db.query(`select pur_request_change($1, $2, 'correct', $3::jsonb, 'x')`, [op(), res.purchase_id, JSON.stringify(unlink)]))).includes('BUYER_REQUIRED'), 'request a correction');
  assert((await code(db.query(`select pur_request_change($1, $2, 'replace', $3::jsonb, 'x')`, [op(), res.purchase_id, JSON.stringify(unlink)]))).includes('BUYER_REQUIRED'), 'request a replacement');
  assert((await code(db.query(`select pur_replace($1, $2, $3::jsonb, 'x')`, [op(), res.purchase_id, JSON.stringify(unlink)]))).includes('BUYER_REQUIRED'), 'replace');
  await as(db, BUYER);
  eq(num((await listLine(db, r.line)).bought), 4, 'the link and Bought are unchanged');
  await db.query(`select pur_correct($1, $2, $3::jsonb, 'it was not for that request')`, [op(), res.purchase_id,
    JSON.stringify(body([{ ...line, request_line_id: null, unplanned_reason: 'bought for the roof' }]))]);
  eq(num((await listLine(db, r.line)).bought), 0, 'a buyer may unlink');
});

await test('final minor 6: a receipt link that is not https is refused on record and on correct; an uploads URL is kept', async () => {
  const db = await fresh();
  const f = await folder(db, 'Barlin'); await period(db, f);
  await as(db, BUYER);
  const line = { folder_id: f, item_name: 'Cement', quantity: 4, amount: 1000, unplanned_reason: 'roof' };
  const evil = body([line], { docs: { po_image_url: 'javascript:alert(1)' } });
  assert((await code(db.query(`select pur_record($1, $2::jsonb)`, [op(), JSON.stringify(evil)]))).includes('BAD_DOCS'), 'record');
  const good = 'https://x.supabase.co/storage/v1/object/public/uploads/purchases/a.jpg';
  const res = await record(db, body([line], { docs: { po_image_url: good, delivery_receipt_url: '' } }));
  eq((await one(db, `select docs from purchases where id = $1`, [res.purchase_id])).docs.po_image_url, good, 'https kept; an empty value is not refused (stored as before)');
  const bad = body([line], { docs: { payment_receipt_url: 'javascript:alert(1)' } });
  assert((await code(db.query(`select pur_correct($1, $2, $3::jsonb, 'x')`, [op(), res.purchase_id, JSON.stringify(bad)]))).includes('BAD_DOCS'), 'correct');
  assert((await code(db.query(`select pur_replace($1, $2, $3::jsonb, 'x')`, [op(), res.purchase_id, JSON.stringify(bad)]))).includes('BAD_DOCS'), 'replace');
  await db.query(`select pur_correct($1, $2, $3::jsonb, 'new photo')`, [op(), res.purchase_id, JSON.stringify(body([line], { docs: { payment_receipt_url: good } }))]);
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) { console.log('\nFAILURES:\n  ' + failures.join('\n  ')); process.exit(1); }
