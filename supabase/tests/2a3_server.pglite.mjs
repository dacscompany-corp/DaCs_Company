// ════════════════════════════════════════════════════════════════════
// STAGE 2A-3a PHONE PURCHASING SERVER — BEHAVIOUR TESTS ON PGLITE
//   npm run test:sql
//
// Runs migrations 0096, 0097 and 0101 VERBATIM on PGlite (PostgreSQL in
// memory) over the same minimal tables as the 2A-2 suite (pr_base.mjs).
// Nothing here talks to the live database; supabase/tests/2a3_acceptance.sql
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
const M101 = read(path.join(ROOT, 'supabase/migrations/0101_purchasing_phone.sql'));
// --with-0102: the same tests with 2A-4a's 0102 on top — payments must not change the phone server.
const WITH_0102 = process.argv.includes('--with-0102');
const M98 = WITH_0102 ? read(path.join(ROOT, 'supabase/migrations/0098_pm_profit_sharing.sql')) : '';
const M102 = WITH_0102 ? read(path.join(ROOT, 'supabase/migrations/0102_purchase_payments.sql')) : '';

// The 2A-1 base schema (same as 2a1_purchase.pglite.mjs), plus the service
// role the sign-in function runs as.
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
const GONE = '00000000-0000-0000-0000-000000000016';     // inactive Buyer staff
const ORPHAN = '00000000-0000-0000-0000-000000000017';   // staff with no owner_id
const NOBODY = '00000000-0000-0000-0000-0000000000ff';   // no profile row
const RECEIPT = 'https://example.supabase.co/storage/v1/object/public/uploads/purchases/' + OWNER +
                '/2026-10/11111111-1111-1111-1111-111111111111.jpg';
let opSeq = 0;
const op = () => '30000000-0000-0000-0000-' + String(++opSeq).padStart(12, '0');

let passed = 0, failed = 0;
const failures = [];
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { failed++; failures.push(name + ' — ' + e.message); console.log('  FAIL ' + name + '\n       ' + e.message); }
}
function assert(c, m) { if (!c) throw new Error(m); }
function eq(a, b, m) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error((m || 'not equal') + ': ' + JSON.stringify(a) + ' !== ' + JSON.stringify(b)); }
const num = (x) => Number(x);

// A Philippine calendar date, `days` from today (UTC+8 has no daylight time,
// so shifting by 8 hours before reading the UTC date gives the local date).
function phDate(days = 0) {
  return new Date(Date.now() + 8 * 3600e3 + days * 86400e3).toISOString().slice(0, 10);
}
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
                'September', 'October', 'November', 'December'];

async function fresh() {
  const db = new PGlite();
  await db.exec(BASE);
  await db.exec(M96);
  await db.exec(prBase(ROOT));
  await db.exec(M97);
  await db.exec(M101);
  if (WITH_0102) { await db.exec(fnText(M98, 'pm_main_owner_id')); await db.exec(M102); }
  await db.exec(`insert into profiles (id, role, owner_id, status, allowed_modules, email, display_name) values
    ('${OWNER}', 'owner', null, 'active', null, 'admin@dacs.test', null),
    ('${STAFF}', 'staff', '${OWNER}', 'active', null, 'staff@dacs.test', null),
    ('${BUYER}', 'staff', '${OWNER}', 'active', null, 'juan@dacs.test', 'Juan'),
    ('${BUYER2}', 'staff', '${OWNER}', 'active', null, 'pedro@dacs.test', 'Pedro'),
    ('${WORKER}', 'worker', '${OWNER}', 'active', null, null, 'Mark'),
    ('${LEADER}', 'teamLeader', '${OWNER}', 'active', null, null, 'Lito'),
    ('${OTHER}', 'owner', null, 'active', null, 'other@x.test', null),
    ('${PMOWNER}', 'owner', '${OWNER}', 'active', '["pm"]'::jsonb, 'admin-pm@dacs.test', null),
    ('${EXPOWNER}', 'owner', '${OWNER}', 'active', '["pm", "expenses"]'::jsonb, 'admin-exp@dacs.test', null),
    ('${GONE}', 'staff', '${OWNER}', 'active', null, 'gone@dacs.test', 'Gone'),
    ('${ORPHAN}', 'staff', null, 'active', null, 'orphan@dacs.test', 'Orphan');`);
  await as(db, OWNER);
  await db.query(`select pur_set_buyer($1, true)`, [BUYER]);
  await db.query(`select pur_set_buyer($1, true)`, [BUYER2]);
  await db.query(`select pur_set_buyer($1, true)`, [GONE]);
  await db.query(`update profiles set status = 'inactive' where id = $1`, [GONE]);
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
async function period(db, folderId, budget = 100000, date = phDate(), owner = OWNER) {
  const d = new Date(date + 'T00:00:00Z');
  const id = (await one(db, `insert into projects (owner_id, folder_id, month, year, funding_type, billing_number)
                              values ($1, $2, $3, $4, 'progress', 1) returning id`,
    [owner, folderId, MONTHS[d.getUTCMonth()], d.getUTCFullYear()])).id;
  await db.query(`insert into project_budgets values ($1, $2, $3)`, [id, owner, budget]);
  return id;
}
function body(lines, extra = {}) {
  const total = extra.receipt_total ?? lines.reduce((s, l) => s + l.amount, 0);
  return { source: 'workmate', purchase_date: phDate(), supplier: 'Wilcon', notes: '', payment_method: 'CASH',
           docs: { po_image_url: RECEIPT }, ...extra, receipt_total: Math.round(total * 100) / 100,
           lines: lines.map(l => ({ destination: 'project', category: 'Materials', unit: 'bag', unplanned_reason: 'site ran out', ...l })) };
}
async function record(db, b, opId = op()) {
  return (await one(db, `select pur_record($1, $2::jsonb) as r`, [opId, JSON.stringify(b)])).r;
}
async function spent(db, folderId) {
  return num((await one(db, `select coalesce(sum(e.amount), 0) s from expenses e join projects p on p.id = e.project_id where p.folder_id = $1`, [folderId])).s);
}
async function periodsOf(db, folderId) {
  return all(db, `select p.id, p.month, p.year, p.funding_type,
                         exists (select 1 from project_budgets b where b.project_id = p.id) as has_budget
                    from projects p where p.folder_id = $1 order by p.created_at, p.id`, [folderId]);
}

console.log('\n2A-3a phone purchasing server (0096 + 0097 + 0101' + (WITH_0102 ? ' + 0102' : '') + ' on PGlite)');

// ── A. Signing a buyer in (Q1, R1, R3) ──────────────────────────────

await test('pur_signin_can_buy gives every account the same answer pur_buyer() gives it signed in', async () => {
  const db = await fresh();
  const people = { OWNER, STAFF, BUYER, BUYER2, WORKER, LEADER, OTHER, PMOWNER, EXPOWNER, GONE, ORPHAN };
  const want = { OWNER: true, STAFF: false, BUYER: true, BUYER2: true, WORKER: false, LEADER: false, OTHER: true,
                 PMOWNER: false, EXPOWNER: true, GONE: false, ORPHAN: false };
  for (const [name, id] of Object.entries(people)) {
    await as(db, id);
    const signedIn = (await one(db, `select pur_buyer() b`)).b;
    await as(db, '');
    const atSignIn = (await one(db, `select pur_signin_can_buy($1) b`, [id])).b;
    eq([name, atSignIn], [name, signedIn], 'same answer as pur_buyer()');
    eq([name, atSignIn], [name, want[name]], 'expected answer');
  }
  eq((await one(db, `select pur_signin_can_buy($1) b`, [NOBODY])).b, false, 'no profile row');
  eq((await one(db, `select pur_signin_can_buy(null) b`)).b, false, 'no id');
});

await test('turning the Buyer switch off (or deactivating) changes the sign-in answer at once', async () => {
  const db = await fresh();
  eq((await one(db, `select pur_signin_can_buy($1) b`, [BUYER])).b, true, 'on');
  await as(db, OWNER); await db.query(`select pur_set_buyer($1, false)`, [BUYER]);
  eq((await one(db, `select pur_signin_can_buy($1) b`, [BUYER])).b, false, 'switched off');
  await db.query(`select pur_set_buyer($1, true)`, [BUYER]);
  await db.query(`update profiles set status = 'inactive' where id = $1`, [BUYER]);
  eq((await one(db, `select pur_signin_can_buy($1) b`, [BUYER])).b, false, 'inactive');
  await db.query(`update profiles set status = 'active', allowed_modules = '["pm"]'::jsonb where id = $1`, [BUYER]);
  eq((await one(db, `select pur_signin_can_buy($1) b`, [BUYER])).b, false, 'focused away from Expenses');
});

await test('only the service role may ask pur_signin_can_buy (it answers for ANY account)', async () => {
  const db = await fresh();
  for (const role of ['authenticated', 'anon']) {
    await db.exec(`set role ${role}`);
    const r = await code(db.query(`select pur_signin_can_buy($1) b`, [BUYER]));
    await db.exec(`reset role`);
    assert(/permission denied/i.test(r), role + ' refused: ' + r);
  }
  await db.exec(`set role service_role`);
  const ok = (await one(db, `select pur_signin_can_buy($1) b`, [BUYER])).b;
  await db.exec(`reset role`);
  eq(ok, true, 'service role allowed');
});

// ── B. Additional Works job with no billing period (Q19, R4) ────────

await test('an AW job with no period: the purchase is recorded and the server makes ONE hidden period', async () => {
  const db = await fresh();
  const main = await folder(db, 'Barlin'); await period(db, main);
  const aw = await folder(db, 'Gazebo', { parent: main });
  await as(db, BUYER);
  const r = await record(db, body([{ folder_id: aw, item_name: 'Lumber', amount: 1500 }]));
  assert(r.purchase_id, 'recorded');
  const ps = await periodsOf(db, aw);
  const today = new Date(phDate() + 'T00:00:00Z');
  eq(ps.map(p => [p.month, p.year, p.funding_type, p.has_budget]),
     [[MONTHS[today.getUTCMonth()], today.getUTCFullYear(), 'downpayment', false]], 'one period, no budget row');
  eq(await spent(db, aw), 1500, 'charged in full');
  eq(num((await one(db, `select count(*) n from expenses e join projects p on p.id = e.project_id
                          where p.folder_id = $1 and e.cover_expense`, [aw])).n), 0, 'never Cover');
  // A second purchase (a fee share too) uses the same period.
  await record(db, body([{ folder_id: aw, item_name: 'Nails', amount: 300 }, { folder_id: main, item_name: 'Sand', amount: 700 }],
                        { charges: [{ kind: 'delivery_fee', amount: 100 }], receipt_total: 1100 }));
  eq((await periodsOf(db, aw)).length, 1, 'still one period');
  eq(await spent(db, aw) + await spent(db, main), 1500 + 1100, 'Spent = every receipt in full, fee included');
});

await test('the hidden period takes the PURCHASE month, and a later month reuses it (AW has no monthly cap)', async () => {
  const db = await fresh();
  const main = await folder(db, 'Barlin');
  const aw = await folder(db, 'Gazebo', { parent: main });
  await as(db, BUYER);
  await record(db, body([{ folder_id: aw, item_name: 'Lumber', amount: 100 }], { purchase_date: '2026-09-28' }));
  eq((await periodsOf(db, aw)).map(p => [p.month, p.year]), [['September', 2026]], 'September period');
  await record(db, body([{ folder_id: aw, item_name: 'Lumber', amount: 50 }], { purchase_date: '2026-10-02' }));
  eq((await periodsOf(db, aw)).length, 1, 'an existing period is used whatever its month (0096 rule unchanged)');
  eq(await spent(db, aw), 150, 'both charged');
});

await test('an AW job that already has a period: nothing new is made (0096 behaviour)', async () => {
  const db = await fresh();
  const main = await folder(db, 'Barlin');
  const aw = await folder(db, 'Gazebo', { parent: main });
  const p = await period(db, aw, 0);
  await as(db, BUYER);
  await record(db, body([{ folder_id: aw, item_name: 'Lumber', amount: 900 }]));
  eq((await periodsOf(db, aw)).map(x => x.id), [p], 'same single period');
  eq(num((await one(db, `select coalesce(sum(amount), 0) s from expenses where project_id = $1`, [p])).s), 900, 'charged to it');
});

await test('Main Contract with no period is unchanged: Cover at project level, flagged for review, no period made', async () => {
  const db = await fresh();
  const main = await folder(db, 'Prado');
  await as(db, BUYER);
  await record(db, body([{ folder_id: main, item_name: 'Cement', amount: 400 }]));
  eq((await periodsOf(db, main)).length, 0, 'no period invented for a Main Contract');
  const row = await one(db, `select l.needs_funding_review r from purchase_lines l where l.folder_id = $1`, [main]);
  eq(row.r, true, 'office review flag');
});

await test('another company\'s AW job is still refused, and no period is made for it', async () => {
  const db = await fresh();
  const theirs = await folder(db, 'Theirs', { owner: OTHER });
  const theirAw = await folder(db, 'Their job', { owner: OTHER, parent: theirs });
  await as(db, BUYER);
  assert((await code(record(db, body([{ folder_id: theirAw, item_name: 'x', amount: 10 }])))).includes('BAD_PROJECT'), 'refused');
  eq((await periodsOf(db, theirAw)).length, 0, 'nothing made');
});

await test('correcting and voiding an AW purchase keep the one period; Spent follows the purchase', async () => {
  const db = await fresh();
  const main = await folder(db, 'Barlin');
  const aw = await folder(db, 'Gazebo', { parent: main });
  await as(db, BUYER);
  const r = await record(db, body([{ folder_id: aw, item_name: 'Lumber', amount: 1000 }]));
  const fixed = body([{ folder_id: aw, item_name: 'Lumber', amount: 800 }]);
  await db.query(`select pur_correct($1, $2, $3::jsonb, 'price fix')`, [op(), r.purchase_id, JSON.stringify(fixed)]);
  eq(await spent(db, aw), 800, 'corrected');
  await db.query(`select pur_void($1, $2, 'wrong job')`, [op(), r.purchase_id]);
  eq(await spent(db, aw), 0, 'voided');
  eq((await periodsOf(db, aw)).length, 1, 'the period stays (as on the web)');
});

// ── C. No receipt (Q8, R5) ──────────────────────────────────────────

await test('a phone purchase with no receipt photo and no reason is refused NO_RECEIPT', async () => {
  const db = await fresh();
  const f = await folder(db, 'Barlin'); await period(db, f);
  await as(db, BUYER);
  for (const docs of [{}, { po_image_url: '' }, { po_image_url: RECEIPT.replace('https', 'http') }]) {
    const r = await code(record(db, body([{ folder_id: f, item_name: 'Nails', amount: 50 }], { docs })));
    assert(r.includes('NO_RECEIPT') || r.includes('BAD_DOCS'), 'refused for ' + JSON.stringify(docs) + ': ' + r);
  }
  assert((await code(record(db, body([{ folder_id: f, item_name: 'Nails', amount: 50 }], { docs: {}, no_receipt_reason: '   ' }))))
    .includes('NO_RECEIPT'), 'a blank reason is no reason');
  eq(num((await one(db, `select count(*) n from purchases`)).n), 0, 'nothing recorded');
  eq(await spent(db, f), 0, 'nothing in Spent');
});

await test('a phone purchase with a photo, or with a reason, is recorded; the reason is kept and shown', async () => {
  const db = await fresh();
  const f = await folder(db, 'Barlin'); await period(db, f);
  await as(db, BUYER);
  const a = await record(db, body([{ folder_id: f, item_name: 'Nails', amount: 50 }]));
  const b = await record(db, body([{ folder_id: f, item_name: 'Rope', amount: 80 }], { docs: {}, no_receipt_reason: '  Sari-sari store, no receipt  ' }));
  const rows = await all(db, `select id, no_receipt_reason r from purchases order by created_at`);
  eq(rows.map(x => x.r), ['', 'Sari-sari store, no receipt'], 'trimmed reason stored');
  const list = (await one(db, `select pur_purchases(null, null, null, 'all') l`)).l;
  eq(list.find(x => x.id === b.purchase_id).no_receipt_reason, 'Sari-sari store, no receipt', 'in the office list');
  eq(list.find(x => x.id === a.purchase_id).no_receipt_reason, '', 'empty when there is a photo');
  eq((await one(db, `select pur_purchase($1) p`, [b.purchase_id])).p.no_receipt_reason, 'Sari-sari store, no receipt', 'in the purchase view');
  eq((await one(db, `select pur_my_purchases(60) l`)).l.find(x => x.id === b.purchase_id).no_receipt_reason,
     'Sari-sari store, no receipt', 'in My purchases');
  eq(await spent(db, f), 130, 'both in Spent');
});

await test('a reason longer than 300 characters is refused BAD_REASON', async () => {
  const db = await fresh();
  const f = await folder(db, 'Barlin'); await period(db, f);
  await as(db, BUYER);
  assert((await code(record(db, body([{ folder_id: f, item_name: 'Nails', amount: 50 }], { docs: {}, no_receipt_reason: 'x'.repeat(301) }))))
    .includes('BAD_REASON'), 'refused');
  await record(db, body([{ folder_id: f, item_name: 'Nails', amount: 50 }], { docs: {}, no_receipt_reason: 'x'.repeat(300) }));
});

await test('R5: the web (Purchasing tab and Expenses form) still records without a receipt or a reason', async () => {
  const db = await fresh();
  const f = await folder(db, 'Barlin'); await period(db, f);
  await as(db, BUYER);
  await record(db, body([{ folder_id: f, item_name: 'Nails', amount: 50 }], { source: 'purchasing', docs: {} }));
  await as(db, STAFF);
  await record(db, { ...body([{ folder_id: f, item_name: 'Rope', amount: 20 }], { source: 'expenses_form', docs: {} }),
                     lines: [{ destination: 'project', folder_id: f, item_name: 'Rope', category: 'Materials', unit: 'pc', amount: 20 }] });
  eq(num((await one(db, `select count(*) n from purchases where status = 'recorded'`)).n), 2, 'both recorded');
});

await test('a correction cannot leave a phone purchase with neither a photo nor a reason', async () => {
  const db = await fresh();
  const f = await folder(db, 'Barlin'); await period(db, f);
  await as(db, BUYER);
  const r = await record(db, body([{ folder_id: f, item_name: 'Nails', amount: 50 }]));
  const blank = body([{ folder_id: f, item_name: 'Nails', amount: 50 }], { docs: { po_image_url: '' } });
  assert((await code(db.query(`select pur_correct($1, $2, $3::jsonb, 'remove photo')`, [op(), r.purchase_id, JSON.stringify(blank)]))).includes('NO_RECEIPT'),
    'refused');
  eq((await one(db, `select docs ->> 'po_image_url' u from purchases where id = $1`, [r.purchase_id])).u, RECEIPT, 'photo kept');
  // The trigger is the last line: any writer (not only pur_insert, which trims)
  // is refused a blank reason with no photo.
  assert((await code(db.query(`update purchases set docs = '{}'::jsonb, no_receipt_reason = '   ' where id = $1`, [r.purchase_id])))
    .includes('NO_RECEIPT'), 'a whitespace reason written directly is refused');
  // A correction that keeps the photo goes through.
  const ok = body([{ folder_id: f, item_name: 'Nails', amount: 45 }]);
  await db.query(`select pur_correct($1, $2, $3::jsonb, 'price')`, [op(), r.purchase_id, JSON.stringify(ok)]);
  eq(await spent(db, f), 45, 'corrected');
});

await test('a phone purchase recorded with a reason can be corrected without adding a photo', async () => {
  const db = await fresh();
  const f = await folder(db, 'Barlin'); await period(db, f);
  await as(db, BUYER);
  const r = await record(db, body([{ folder_id: f, item_name: 'Rope', amount: 80 }], { docs: {}, no_receipt_reason: 'no receipt given' }));
  const fix = body([{ folder_id: f, item_name: 'Rope', amount: 70 }], { docs: {} });
  await db.query(`select pur_correct($1, $2, $3::jsonb, 'price')`, [op(), r.purchase_id, JSON.stringify(fix)]);
  eq((await one(db, `select no_receipt_reason r from purchases where id = $1`, [r.purchase_id])).r, 'no receipt given', 'reason kept');
  eq(await spent(db, f), 70, 'corrected');
});

await test('voiding a phone purchase is not blocked by the receipt rule', async () => {
  const db = await fresh();
  const f = await folder(db, 'Barlin'); await period(db, f);
  await as(db, BUYER);
  const r = await record(db, body([{ folder_id: f, item_name: 'Rope', amount: 80 }], { docs: {}, no_receipt_reason: 'none' }));
  await db.query(`select pur_void($1, $2, 'mistake')`, [op(), r.purchase_id]);
  eq((await one(db, `select status from purchases where id = $1`, [r.purchase_id])).status, 'void', 'voided');
});

// ── D. My purchases (Q12) ───────────────────────────────────────────

await test('My purchases: what I bought or recorded, every status, the last 60 days, newest first', async () => {
  const db = await fresh();
  const f = await folder(db, 'Barlin'); await period(db, f);
  await as(db, BUYER);
  const mine = await record(db, body([{ folder_id: f, item_name: 'Mine', amount: 10 }], { purchase_date: phDate(-1) }));
  const voided = await record(db, body([{ folder_id: f, item_name: 'Voided', amount: 10 }], { purchase_date: phDate(-2) }));
  await db.query(`select pur_void($1, $2, 'mistake')`, [op(), voided.purchase_id]);
  const old = await record(db, body([{ folder_id: f, item_name: 'Old', amount: 10 }], { purchase_date: phDate(-61) }));
  const edge = await record(db, body([{ folder_id: f, item_name: 'Edge', amount: 10 }], { purchase_date: phDate(-60) }));
  await as(db, BUYER2);
  const theirs = await record(db, body([{ folder_id: f, item_name: 'Theirs', amount: 10 }]));
  await as(db, OWNER);   // the owner records a purchase Juan made
  const forMe = await record(db, body([{ folder_id: f, item_name: 'ForMe', amount: 10 }], { source: 'purchasing', bought_by: BUYER, docs: {} }));
  await as(db, BUYER);
  const list = (await one(db, `select pur_my_purchases(60) l`)).l;
  eq(list.map(x => x.id), [forMe.purchase_id, mine.purchase_id, voided.purchase_id, edge.purchase_id], 'mine, newest first');
  eq(list.find(x => x.id === voided.purchase_id).status, 'void', 'voided shown');
  assert(!list.some(x => x.id === old.purchase_id || x.id === theirs.purchase_id), 'not older than 60 days, not someone else\'s');
  eq((await one(db, `select pur_my_purchases(61) l`)).l.length, 5, 'a longer window reaches the old one');
  await as(db, BUYER2);
  eq((await one(db, `select pur_my_purchases(60) l`)).l.map(x => x.id), [theirs.purchase_id], 'Pedro sees only his');
});

await test('My purchases rows have the office list shape (same builder) plus nothing hidden', async () => {
  const db = await fresh();
  const f = await folder(db, 'Barlin'); await period(db, f);
  await as(db, BUYER);
  const r = await record(db, body([{ folder_id: f, item_name: 'Nails', amount: 50 }]));
  const a = (await one(db, `select pur_my_purchases(60) l`)).l[0];
  const b = (await one(db, `select pur_purchases(null, null, null, 'all') l`)).l.find(x => x.id === r.purchase_id);
  eq(a, b, 'identical rows');
  eq(Object.keys(b).sort(), ['bought_by_name', 'extra', 'id', 'lines', 'linked', 'needs_review', 'no_receipt_reason',
    ...(WITH_0102 ? ['pay'] : []), 'pending_change',
    'projects', 'purchase_date', 'receipt_total', 'recorded_by_name', 'replaced_by', 'source', 'status', 'supplier', 'unit_check',
    'unplanned', 'warehouse'], '0097 keys + no_receipt_reason + replaced_by' + (WITH_0102 ? ' + pay (0102)' : ''));
});

await test('My purchases is for buyers only, and the window is 1–366 days', async () => {
  const db = await fresh();
  for (const who of [STAFF, WORKER, PMOWNER, GONE]) {
    await as(db, who);
    assert((await code(db.query(`select pur_my_purchases(60)`))).match(/BUYER_REQUIRED|NOT_OFFICE/), 'refused ' + who);
  }
  await as(db, BUYER);
  for (const d of [0, 367, null]) {
    assert((await code(db.query(`select pur_my_purchases($1)`, [d]))).includes('BAD_DAYS'), 'bad window ' + d);
  }
});

// ── E. Where a phone purchase can go (Q11) ──────────────────────────

await test('pur_destinations: open projects of my company, each with its open AW jobs', async () => {
  const db = await fresh();
  const barlin = await folder(db, 'Barlin');
  const prado = await folder(db, 'prado');
  await folder(db, 'Closed', { completed: true });
  await folder(db, '   ');
  const gazebo = await folder(db, 'Gazebo', { parent: barlin });
  await folder(db, 'Done job', { parent: barlin, completed: true });
  const awning = await folder(db, 'Awning', { parent: barlin });
  await folder(db, 'Theirs', { owner: OTHER });
  await as(db, BUYER);
  const d = (await one(db, `select pur_destinations() d`)).d;
  eq(d.map(x => x.name), ['Barlin', 'prado'], 'open top-level projects, by name');
  eq(d[0].works.map(w => [w.folder_id, w.name]), [[awning, 'Awning'], [gazebo, 'Gazebo']], 'open AW jobs');
  eq([d[1].folder_id, d[1].name, d[1].works], [prado, 'prado', []], 'no jobs');
  for (const who of [STAFF, WORKER, PMOWNER]) {
    await as(db, who);
    assert((await code(db.query(`select pur_destinations()`))).match(/BUYER_REQUIRED/), 'refused ' + who);
  }
});

// ── F. "Waiting for the owner" in Project Control (Q16) ─────────────

await test('pur_my_pending_changes: my own pending requests with their line and charge ids, nothing else', async () => {
  const db = await fresh();
  const f = await folder(db, 'Barlin'); await period(db, f);
  await as(db, STAFF);   // Project Control entry, no Buyer switch
  const pc = (item, amount) => ({ source: 'expenses_form', purchase_date: phDate(), receipt_total: amount, docs: {},
    lines: [{ destination: 'project', folder_id: f, item_name: item, category: 'Materials', unit: 'pc', amount }] });
  const a = await record(db, pc('Nails', 50));
  const b = await record(db, pc('Rope', 80));
  await as(db, OWNER); await db.query(`update folders set completed_at = now() where id = $1`, [f]);
  await as(db, STAFF);
  const ra = (await one(db, `select pur_request_change($1, $2, 'void', null, 'wrong project') r`, [op(), a.purchase_id])).r;
  const rb = (await one(db, `select pur_request_change($1, $2, 'void', null, 'duplicate') r`, [op(), b.purchase_id])).r;
  await db.query(`select pur_withdraw_change($1)`, [rb.request_id]);
  const mine = (await one(db, `select pur_my_pending_changes() l`)).l;
  eq(mine.length, 1, 'only the pending one');
  const lineA = (await one(db, `select id from purchase_lines where purchase_id = $1`, [a.purchase_id])).id;
  eq([mine[0].id, mine[0].purchase_id, mine[0].kind, mine[0].reason, mine[0].line_ids, mine[0].charge_ids],
     [ra.request_id, a.purchase_id, 'void', 'wrong project', [lineA], []], 'ids, kind and reason');
  eq(Object.keys(mine[0]).sort(), ['charge_ids', 'id', 'kind', 'line_ids', 'purchase_id', 'reason', 'requested_at'], 'no amounts, no purchase data');
  // Someone else's requests are not mine; the owner has none of their own.
  await as(db, BUYER); eq((await one(db, `select pur_my_pending_changes() l`)).l, [], 'another staff member sees none');
  await as(db, OWNER); eq((await one(db, `select pur_my_pending_changes() l`)).l, [], 'the owner sends none');
  // Withdraw from there, and it is gone.
  await as(db, STAFF);
  await db.query(`select pur_withdraw_change($1)`, [mine[0].id]);
  eq((await one(db, `select pur_my_pending_changes() l`)).l, [], 'withdrawn');
});

await test('pur_my_pending_changes is for office accounts allowed Expenses only', async () => {
  const db = await fresh();
  await as(db, WORKER);
  assert((await code(db.query(`select pur_my_pending_changes()`))).includes('NOT_OFFICE'), 'worker refused');
  await as(db, PMOWNER);
  assert((await code(db.query(`select pur_my_pending_changes()`))).includes('NOT_ALLOWED'), 'PM-only refused');
});

// ── G. Nothing else moved ───────────────────────────────────────────

await test('0101 changes no Spent: the same purchases give the same expense rows as 0097 alone', async () => {
  const run = async (with101) => {
    const db = new PGlite();
    await db.exec(BASE); await db.exec(M96); await db.exec(prBase(ROOT)); await db.exec(M97);
    if (with101) await db.exec(M101);
    await db.exec(`insert into profiles (id, role, owner_id, status, allowed_modules, email, display_name) values
      ('${OWNER}', 'owner', null, 'active', null, 'admin@dacs.test', null),
      ('${BUYER}', 'staff', '${OWNER}', 'active', null, 'juan@dacs.test', 'Juan')`);
    await as(db, OWNER); await db.query(`select pur_set_buyer($1, true)`, [BUYER]);
    const f = (await one(db, `insert into folders (id, owner_id, name) values ('40000000-0000-0000-0000-000000000001', $1, 'Barlin') returning id`, [OWNER])).id;
    const d = new Date(phDate() + 'T00:00:00Z');
    const p1 = (await one(db, `insert into projects (owner_id, folder_id, month, year, funding_type, billing_number)
                                values ($1, $2, $3, $4, 'progress', 1) returning id`, [OWNER, f, MONTHS[d.getUTCMonth()], d.getUTCFullYear()])).id;
    await db.query(`insert into project_budgets values ($1, $2, 1000)`, [p1, OWNER]);
    await as(db, BUYER);
    const src = { source: 'purchasing', purchase_date: phDate(), supplier: 'Wilcon', docs: {}, receipt_total: 1700,
                  charges: [{ kind: 'delivery_fee', amount: 200 }, { kind: 'discount', amount: 100 }],
                  lines: [{ destination: 'project', folder_id: f, item_name: 'Cement', unit: 'bag', amount: 1200, unplanned_reason: 'r' },
                          { destination: 'project', folder_id: f, item_name: 'Sand', unit: 'cu.m', amount: 400, unplanned_reason: 'r' }] };
    await one(db, `select pur_record('30000000-0000-0000-0000-999999999999', $1::jsonb) r`, [JSON.stringify(src)]);
    return (await all(db, `select e.expense_name, e.amount::text a, e.cover_expense c, e.project_id = $1 as funded
                             from expenses e order by e.expense_name, e.amount`, [p1])).map(x => [x.expense_name, x.a, x.c, x.funded]);
  };
  eq(await run(true), await run(false), 'identical rows');
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) { console.log('\nFAILURES:\n  ' + failures.join('\n  ')); process.exit(1); }
