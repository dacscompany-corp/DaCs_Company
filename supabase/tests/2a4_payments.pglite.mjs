// ════════════════════════════════════════════════════════════════════
// STAGE 2A-4a PAYING FOR PURCHASES — BEHAVIOUR TESTS ON PGLITE
//   npm run test:sql
//
// Runs migrations 0096, 0097, 0101 and 0102 VERBATIM on PGlite (PostgreSQL
// in memory) over the same minimal tables as the 2A-3 suite, plus 0098's
// main-owner check. Nothing here talks to the live database;
// supabase/tests/2a4_acceptance.sql repeats the key cases there, rolled back.
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
const M98 = read(path.join(ROOT, 'supabase/migrations/0098_pm_profit_sharing.sql'));
const M102 = read(path.join(ROOT, 'supabase/migrations/0102_purchase_payments.sql'));
// --with-0103: re-run every test with 0103 on top (2A-4b: a return's photo reaches its buyer).
const WITH_0103 = process.argv.includes('--with-0103');
const M103 = WITH_0103 ? read(path.join(ROOT, 'supabase/migrations/0103_buyer_return_photo.sql')) : '';

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

// without102: the database as it was before 0102 (to test purchases recorded before it).
async function fresh(opts = {}) {
  const db = new PGlite();
  await db.exec(BASE);
  await db.exec(M96);
  await db.exec(prBase(ROOT));
  await db.exec(M97);
  await db.exec(M101);
  if (!opts.without102) {
    await db.exec(fnText(M98, 'pm_main_owner_id'));
    await db.exec(M102);
    if (WITH_0103) await db.exec(M103);
  }
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

// ── helpers for 0102 ─────────────────────────────────────────────────
async function supplier(db, name = 'Wilcon', owner = OWNER) {
  return (await one(db, `insert into suppliers (owner_id, name, created_by) values ($1, $2, $1) returning id`, [owner, name])).id;
}
const P = (amount, extra = {}) => ({ amount: String(amount), paid_on: phDate(), method: 'cash', source: 'company', ...extra });
async function pay(db, purchaseId, p, opId = op()) {
  return (await one(db, `select pur_pay($1, $2, $3::jsonb) as r`, [opId, purchaseId, JSON.stringify(p)])).r;
}
async function state(db, purchaseId) {
  return (await one(db, `select pur_pay_state($1) s`, [purchaseId])).s;
}
async function raw(db, buyer, upto = null) {
  return num((await one(db, `select pur_cash_raw($1, $2, $3::date) v`, [OWNER, buyer, upto])).v);
}
async function owes(db, buyer) { return num((await one(db, `select pur_owes($1, $2) v`, [OWNER, buyer])).v); }
async function give(db, buyer, amount, day = phDate()) {
  await as(db, OWNER);
  return (await one(db, `select pur_cash_give($1, $2, $3, $4, 'cash', '') r`, [op(), buyer, String(amount), day])).r;
}
async function money(db) {
  return one(db, `select (select count(*) from expenses) n, (select coalesce(sum(amount), 0) from expenses) s,
                         (select count(*) from payroll) pr`);
}
// A recorded project purchase by `who`, for ₱amount (one line, or several).
async function bought(db, who, amount, extra = {}) {
  const f = extra.folder || await folder(db, 'Barlin ' + (++opSeq));
  if (!extra.folder) await period(db, f);
  await as(db, who);
  const r = await record(db, body([{ folder_id: f, item_name: 'Cement', quantity: 1, amount }], extra.body || {}));
  return { id: r.purchase_id, folder: f, r };
}
async function resolve(db, purchaseId, refunds, credit = null, opId = op()) {
  return (await one(db, `select pur_resolve_overpaid($1, $2, $3::jsonb, $4::jsonb) r`,
    [opId, purchaseId, JSON.stringify(refunds), credit === null ? null : JSON.stringify(credit)])).r;
}

console.log('\n2A-4a paying for purchases (0096 + 0097 + 0101 + 0102 on PGlite)');

// ── A. "Paid now": the purchase and its payments together (Q3) ─────────

await test('paid in full from petty cash at the counter: one send records the purchase AND its payment; Paid; cash held goes down', async () => {
  const db = await fresh();
  const f = await folder(db, 'Barlin'); await period(db, f);
  await give(db, BUYER, 5000);
  await as(db, BUYER);
  const r = await record(db, body([{ folder_id: f, item_name: 'Cement', quantity: 5, amount: 1250 }],
    { payments: [P(1250, { source: 'petty_cash' })] }));
  eq(r.payments.length, 1, 'payment saved with the purchase');
  eq(r.pay.state, 'paid');
  eq(await raw(db, BUYER), 3750, '₱5,000 − ₱1,250');
  eq(num((await one(db, `select person_id::text = $1 as me from pur_payments`, [BUYER])).me ? 1 : 0), 1, 'the buyer\'s own petty cash');
});

await test('a refused payment refuses the purchase too: nothing is saved, and the same press can be sent again fixed', async () => {
  const db = await fresh();
  const f = await folder(db, 'Barlin'); await period(db, f);
  await as(db, BUYER);
  const press = op();
  const bad = body([{ folder_id: f, item_name: 'Cement', quantity: 1, amount: 500 }], { payments: [P(500, { method: 'bitcoin' })] });
  assert((await code(record(db, bad, press))).includes('BAD_METHOD'), 'refused');
  eq(num((await one(db, `select count(*) n from purchases`)).n), 0, 'no purchase');
  eq(num((await one(db, `select count(*) n from expenses`)).n), 0, 'no Spent');
  eq(num((await one(db, `select count(*) n from pur_ops`)).n), 0, 'the press is not used up');
  const r = await record(db, { ...bad, payments: [P(500)] }, press);
  eq(r.pay.state, 'paid', 'fixed and sent again with the same press');
});

await test('a retry records the purchase and its payment once', async () => {
  const db = await fresh();
  const f = await folder(db, 'Barlin'); await period(db, f);
  await as(db, BUYER);
  const press = op();
  const b = body([{ folder_id: f, item_name: 'Cement', quantity: 1, amount: 500 }], { payments: [P(200), P(300)] });
  const first = await record(db, b, press);
  const again = await record(db, b, press);
  eq(again.replayed, true, 'the first answer');
  eq(again.purchase_id, first.purchase_id);
  eq(num((await one(db, `select count(*) n from purchases`)).n), 1);
  eq(num((await one(db, `select count(*) n from pur_payments`)).n), 2, 'two payments, once');
});

await test('a correction or a replacement never carries payments (BAD_PAY); more than 5 at once refused', async () => {
  const db = await fresh();
  const { id, folder: f } = await bought(db, BUYER, 500);
  const b = body([{ folder_id: f, item_name: 'Cement', quantity: 1, amount: 450 }], { payments: [P(450)] });
  assert((await code(db.query(`select pur_correct($1, $2, $3::jsonb, 'price')`, [op(), id, JSON.stringify(b)]))).includes('BAD_PAY'), 'correct');
  assert((await code(db.query(`select pur_replace($1, $2, $3::jsonb, 'more')`, [op(), id, JSON.stringify(b)]))).includes('BAD_PAY'), 'replace');
  const six = body([{ folder_id: f, item_name: 'Sand', quantity: 1, amount: 600 }], { payments: [1, 2, 3, 4, 5, 6].map(() => P(100)) });
  assert((await code(record(db, six))).includes('BAD_PAY'), 'six');
});

await test('paying at recording needs the Buyer switch: Project Control staff still record, without payments', async () => {
  const db = await fresh();
  const f = await folder(db, 'Barlin'); await period(db, f);
  await as(db, STAFF);
  const b = body([{ folder_id: f, item_name: 'Cement', quantity: 1, amount: 500 }], { source: 'expenses_form' });
  assert((await code(record(db, { ...b, payments: [P(500)] }))).includes('BUYER_REQUIRED'), 'with payments');
  const r = await record(db, b);
  eq((await state(db, r.purchase_id)).state, 'unpaid', 'recorded, Unpaid');
});

// ── B. Payments (Q4–Q8) ─────────────────────────────────────────────────

await test('a deposit, then the rest: Unpaid → Partially paid → Paid, every payment kept', async () => {
  const db = await fresh();
  const { id } = await bought(db, BUYER, 10000);
  eq((await state(db, id)).state, 'unpaid');
  await pay(db, id, P(3000));
  let s = await state(db, id);
  eq([s.state, num(s.paid), num(s.balance)], ['partial', 3000, 7000]);
  await pay(db, id, P(2000, { method: 'gcash' }));
  await pay(db, id, P(5000, { method: 'bank_transfer' }));
  s = await state(db, id);
  eq([s.state, num(s.paid), num(s.balance)], ['paid', 10000, 0]);
  eq(num((await one(db, `select count(*) n from pur_payments where purchase_id = $1`, [id])).n), 3, 'never overwritten');
});

await test('spec example 7: ₱10,500 paid on ₱10,000 → Overpaid ₱500; Spent never changes', async () => {
  const db = await fresh();
  const { id } = await bought(db, BUYER, 10000);
  const before = await money(db);
  for (const a of [3000, 2000, 5000, 500]) await pay(db, id, P(a));
  const s = await state(db, id);
  eq([s.state, num(s.excess), num(s.unresolved)], ['overpaid', 500, 500]);
  eq(await money(db), before, 'expenses and payroll untouched');
});

await test('one receipt across two projects: one payment on the purchase, never a copy per project', async () => {
  const db = await fresh();
  const a = await folder(db, 'Barlin'); await period(db, a);
  const b = await folder(db, 'Malolos'); await period(db, b);
  await as(db, BUYER);
  const r = await record(db, body([{ folder_id: a, item_name: 'Cement', quantity: 1, amount: 3000 },
                                   { folder_id: b, item_name: 'Sand', quantity: 1, amount: 1000 }], { payments: [P(4000)] }));
  eq(num((await one(db, `select count(*) n from pur_payments`)).n), 1);
  eq(r.pay.state, 'paid');
});

await test('who may pay: buyers of the company; staff without the switch, workers and another company cannot', async () => {
  const db = await fresh();
  const { id } = await bought(db, BUYER, 1000);
  await as(db, BUYER2);
  await pay(db, id, P(100));
  await as(db, OWNER);
  await pay(db, id, P(100));
  for (const [who, want] of [[STAFF, 'BUYER_REQUIRED'], [WORKER, 'BUYER_REQUIRED'], [PMOWNER, 'BUYER_REQUIRED'], [OTHER, 'NOT_FOUND']]) {
    await as(db, who);
    const r = await code(pay(db, id, P(100)));
    assert(r.includes(want), who + ': ' + r);
  }
});

await test('petty cash and own money: a buyer records their own; only the main owner records another buyer\'s', async () => {
  const db = await fresh();
  const { id } = await bought(db, BUYER, 1000);
  await as(db, BUYER);
  assert((await code(pay(db, id, P(100, { source: 'petty_cash', person_id: BUYER2 })))).includes('PERSON_NOT_ALLOWED'), 'another buyer');
  await pay(db, id, P(100, { source: 'petty_cash' }));
  eq(await raw(db, BUYER), -100, 'defaults to the caller');
  await as(db, OWNER);
  assert((await code(pay(db, id, P(100, { source: 'petty_cash' })))).includes('PERSON_REQUIRED'), 'owner must say whose');
  assert((await code(pay(db, id, P(100, { source: 'petty_cash', person_id: OWNER })))).includes('NOT_A_BUYER'), 'the owner holds no petty cash');
  assert((await code(pay(db, id, P(100, { source: 'own_money', person_id: WORKER })))).includes('NOT_A_BUYER'), 'a worker');
  assert((await code(pay(db, id, P(100, { source: 'petty_cash', person_id: 'nope' })))).includes('BAD_PERSON'), 'garbage id');
  await pay(db, id, P(100, { source: 'petty_cash', person_id: BUYER2 }));
  eq(await raw(db, BUYER2), -100, 'the main owner entered it for Pedro');
});

await test('bad payments are refused, nothing saved: ₱0, three decimals, a future or ancient date, unknown source/method, a non-https proof', async () => {
  const db = await fresh();
  const { id } = await bought(db, BUYER, 1000);
  const cases = [[P(0), 'BAD_AMOUNT'], [P('10.005'), 'BAD_AMOUNT'], [P(-5), 'BAD_AMOUNT'], [P(10, { paid_on: phDate(1) }), 'BAD_DATE'],
                 [P(10, { paid_on: '2019-12-31' }), 'BAD_DATE'], [P(10, { paid_on: '2026-02-30' }), 'BAD_DATE'],
                 [P(10, { source: 'loan' }), 'BAD_PAY_SOURCE'], [P(10, { method: 'barter' }), 'BAD_METHOD'],
                 [P(10, { proof_url: 'javascript:alert(1)' }), 'BAD_DOCS'], [P(10, { note: 'x'.repeat(301) }), 'BAD_NOTE'],
                 [P(10, { credit_id: '11111111-1111-1111-1111-111111111111' }), 'BAD_PAY']];
  for (const [p, want] of cases) {
    const r = await code(pay(db, id, p));
    assert(r.includes(want), JSON.stringify(p) + ' → ' + r);
  }
  eq(num((await one(db, `select count(*) n from pur_payments`)).n), 0);
});

await test('no new payment on a voided purchase (BAD_STATE)', async () => {
  const db = await fresh();
  const { id } = await bought(db, BUYER, 1000);
  await db.query(`select pur_void($1, $2, 'mistake')`, [op(), id]);
  assert((await code(pay(db, id, P(100)))).includes('BAD_STATE'));
});

await test('Q2: a purchase recorded before 0102 reads "Payment not tracked" until a payment is recorded on it', async () => {
  const db = await fresh({ without102: true });
  const f = await folder(db, 'Barlin'); await period(db, f);
  await as(db, BUYER);
  const old = (await record(db, body([{ folder_id: f, item_name: 'Cement', quantity: 1, amount: 900 }]))).purchase_id;
  await as(db, '');
  await db.exec(fnText(M98, 'pm_main_owner_id'));
  await db.exec(M102);
  if (WITH_0103) await db.exec(M103);
  eq((await state(db, old)).state, 'not_tracked', 'not "Unpaid"');
  await as(db, BUYER);
  const fresh2 = (await record(db, body([{ folder_id: f, item_name: 'Sand', quantity: 1, amount: 100 }]))).purchase_id;
  eq((await state(db, fresh2)).state, 'unpaid', 'a new one is tracked');
  await pay(db, old, P(400));
  const s = await state(db, old);
  eq([s.state, s.tracked], ['partial', true], 'one payment turns tracking on');
});

await test('a mistaken payment is voided with a reason by whoever recorded it (or the main owner); never deleted; petty cash comes back', async () => {
  const db = await fresh();
  const { id } = await bought(db, BUYER, 1000);
  await give(db, BUYER, 1000);
  await as(db, BUYER);
  const p = (await pay(db, id, P(600, { source: 'petty_cash' }))).payment_id;
  eq(await raw(db, BUYER), 400);
  await as(db, BUYER2);
  assert((await code(db.query(`select pur_void_payment($1, $2, 'not mine')`, [op(), p]))).includes('NOT_YOURS'), 'another buyer');
  await as(db, BUYER);
  assert((await code(db.query(`select pur_void_payment($1, $2, '  ')`, [op(), p]))).includes('REASON_REQUIRED'), 'reason');
  await db.query(`select pur_void_payment($1, $2, 'wrong amount')`, [op(), p]);
  eq(await raw(db, BUYER), 1000, 'the cash is back');
  eq((await state(db, id)).state, 'unpaid');
  assert((await code(db.query(`select pur_void_payment($1, $2, 'again')`, [op(), p]))).includes('ALREADY_VOIDED'));
  eq(num((await one(db, `select count(*) n from pur_payments where id = $1 and voided_at is not null`, [p])).n), 1, 'kept, voided');
  await as(db, OWNER);
  const q = (await pay(db, id, P(100))).payment_id;
  await as(db, BUYER);
  await as(db, OWNER);
  await db.query(`select pur_void_payment($1, $2, 'owner fixes it')`, [op(), q]);
});

await test('Q8: a lower corrected total makes it Overpaid; a voided purchase with payments is "to recover"; Spent follows only the purchase', async () => {
  const db = await fresh();
  const { id, folder: f } = await bought(db, BUYER, 1000);
  await pay(db, id, P(1000));
  await as(db, BUYER);
  const fixed = body([{ folder_id: f, item_name: 'Cement', quantity: 1, amount: 800 }]);
  await db.query(`select pur_correct($1, $2, $3::jsonb, 'discount')`, [op(), id, JSON.stringify(fixed)]);
  let s = await state(db, id);
  eq([s.state, num(s.excess)], ['overpaid', 200]);
  eq(await spent(db, f), 800, 'Spent = the corrected purchase, payments ignored');
  await db.query(`select pur_void($1, $2, 'cancelled')`, [op(), id]);
  s = await state(db, id);
  eq([s.state, num(s.due), num(s.unresolved)], ['void_paid', 0, 1000]);
  eq(await spent(db, f), 0);
});

await test('a replacement takes its payments, refunds and "not tracked" with it', async () => {
  const db = await fresh();
  const { id, folder: f } = await bought(db, BUYER, 1000);
  await pay(db, id, P(400));
  await as(db, BUYER);
  const two = body([{ folder_id: f, item_name: 'Cement', quantity: 1, amount: 1000 }, { folder_id: f, item_name: 'Nails', quantity: 1, amount: 50 }]);
  const r = (await one(db, `select pur_replace($1, $2, $3::jsonb, 'forgot nails') r`, [op(), id, JSON.stringify(two)])).r;
  eq(num((await one(db, `select count(*) n from pur_payments where purchase_id = $1`, [r.purchase_id])).n), 1, 'moved');
  const s = await state(db, r.purchase_id);
  eq([s.state, num(s.paid), num(s.balance)], ['partial', 400, 650]);
  eq((await state(db, id)).state, 'void', 'the old version has nothing to recover');
});

// ── C. Overpaid, refunds, supplier credit (Q9–Q12) ──────────────────────

await test('only the main owner (with Expenses) resolves Overpaid', async () => {
  const db = await fresh();
  const { id } = await bought(db, BUYER, 100);
  await pay(db, id, P(150));
  for (const who of [BUYER, STAFF, PMOWNER, EXPOWNER, WORKER]) {
    await as(db, who);
    const r = await code(resolve(db, id, [{ amount: '50', funded_by: 'company', received_by: 'company', received_on: phDate() }]));
    assert(r.includes('OWNER_ONLY') || r.includes('NOT_ALLOWED'), who + ': ' + r);
  }
  await as(db, OWNER);
  await db.query(`update profiles set allowed_modules = '["pm"]'::jsonb where id = $1`, [OWNER]);
  assert((await code(resolve(db, id, [{ amount: '50', funded_by: 'company', received_by: 'company', received_on: phDate() }]))).includes('NOT_ALLOWED'),
    'a main owner focused away from Expenses');
});

await test('the agreed example: ₱700 petty cash + ₱300 own money, ₱500 over → ₱300 back into petty cash, ₱200 to the buyer', async () => {
  const db = await fresh();
  await as(db, OWNER);
  await db.query(`select pur_set_own_money($1, true)`, [BUYER]);
  await give(db, BUYER, 700);
  const { id, folder: f } = await bought(db, BUYER, 1000);
  await as(db, BUYER);
  await pay(db, id, P(700, { source: 'petty_cash' }));
  await pay(db, id, P(300, { source: 'own_money' }));
  const fixed = body([{ folder_id: f, item_name: 'Cement', quantity: 1, amount: 500 }]);
  await db.query(`select pur_correct($1, $2, $3::jsonb, 'half returned')`, [op(), id, JSON.stringify(fixed)]);
  eq([await raw(db, BUYER), await owes(db, BUYER)], [0, 300], 'before');
  await as(db, OWNER);
  const list = (await one(db, `select pur_overpaid() r`)).r;
  eq(list.length, 1);
  const sug = Object.fromEntries(list[0].suggested.map(x => [x.source, num(x.amount)]));
  eq(sug, { own_money: 300, petty_cash: 200 }, 'suggested: the latest payments first (own money, then petty cash)');
  await resolve(db, id, [
    { amount: '300', funded_by: 'petty_cash', person_id: BUYER, received_by: 'petty_cash', received_on: phDate() },
    { amount: '200', funded_by: 'own_money', person_id: BUYER, received_by: 'buyer', received_on: phDate() }]);
  eq([await raw(db, BUYER), await owes(db, BUYER)], [300, 100], 'cash held +₱300, company owes −₱200');
  eq((await state(db, id)).state, 'paid', 'resolved');
  eq((await one(db, `select pur_overpaid() r`)).r.length, 0, 'off the list');
});

await test('each refund part is capped by what that money paid; the total by what is over; the same peso is resolved once', async () => {
  const db = await fresh();
  await give(db, BUYER, 1000);
  const { id } = await bought(db, BUYER, 600);
  await as(db, BUYER);
  await pay(db, id, P(400, { source: 'petty_cash' }));
  await pay(db, id, P(400));   // company
  await as(db, OWNER);
  const part = (amount, funded_by, received_by, person_id) => ({ amount: String(amount), funded_by, received_by, person_id, received_on: phDate() });
  assert((await code(resolve(db, id, [part(250, 'company', 'company')]))).includes('OVER_RESOLVED'), 'over is ₱200');
  assert((await code(resolve(db, id, [part(150, 'own_money', 'buyer', BUYER)]))).includes('OVER_SOURCE'), 'no own money paid');
  assert((await code(resolve(db, id, [part(150, 'petty_cash', 'company', BUYER2)]))).includes('OVER_SOURCE'), 'Pedro\'s cash did not pay');
  assert((await code(resolve(db, id, [part(100, 'company', 'company'), part(150, 'petty_cash', 'company', BUYER)]))).includes('OVER_RESOLVED'),
    'all or nothing');
  eq(num((await one(db, `select count(*) n from pur_refunds`)).n), 0, 'nothing kept from the refused call');
  await resolve(db, id, [part(120, 'company', 'company'), part(80, 'petty_cash', 'company', BUYER)]);
  assert((await code(resolve(db, id, [part(1, 'company', 'company')]))).includes('OVER_RESOLVED'), 'resolved once');
  assert((await code(resolve(db, id, []))).includes('NOTHING_TO_RESOLVE'));
});

await test('refund routes: back into petty cash or to the company; company money refunded to the buyer is cash they hold; bad routes refused', async () => {
  const db = await fresh();
  await give(db, BUYER, 500);
  const { id } = await bought(db, BUYER, 100);
  await as(db, BUYER);
  await pay(db, id, P(300, { source: 'petty_cash' }));
  await as(db, OWNER);
  await pay(db, id, P(300));   // the owner paid too: ₱500 over
  const part = (amount, funded_by, received_by, person_id) => ({ amount: String(amount), funded_by, received_by, person_id, received_on: phDate() });
  assert((await code(resolve(db, id, [part(10, 'own_money', 'petty_cash', BUYER)]))).includes('BAD_REFUND_ROUTE'));
  assert((await code(resolve(db, id, [part(10, 'petty_cash', 'buyer', BUYER)]))).includes('BAD_REFUND_ROUTE'));
  assert((await code(resolve(db, id, [part(10, 'company', 'petty_cash', null)]))).includes('NOT_A_BUYER'), 'who received it');
  const held = await raw(db, BUYER);
  await resolve(db, id, [part(100, 'petty_cash', 'company', BUYER)]);
  eq(await raw(db, BUYER), held, 'petty cash → company moves no balance');
  await resolve(db, id, [part(250, 'company', 'petty_cash', BUYER)]);
  eq(await raw(db, BUYER), held + 250, 'company money now held by the buyer');
});

await test('a supplier credit is a balance: used in parts on later purchases until gone, each use once; it is not cash', async () => {
  const db = await fresh();
  const wil = await supplier(db, 'Wilcon');
  const ace = await supplier(db, 'Ace');
  const { id } = await bought(db, BUYER, 1000, { body: { supplier_id: wil } });
  await pay(db, id, P(1500));
  await as(db, OWNER);
  const credit = (await resolve(db, id, [], { amount: '500', note: 'credit memo 1234' })).created[0].credit_id;
  const b = await bought(db, BUYER, 400, { body: { supplier_id: wil } });
  const c2 = await bought(db, BUYER, 400, { body: { supplier_id: wil } });
  const other = await bought(db, BUYER, 400, { body: { supplier_id: ace } });
  await give(db, BUYER, 1000);
  await as(db, BUYER);
  const held = await raw(db, BUYER);
  const use = op();
  await pay(db, b.id, P(200, { source: 'credit', credit_id: credit }), use);
  await pay(db, b.id, P(200, { source: 'credit', credit_id: credit }), use);   // a retry
  eq(num((await one(db, `select pur_credit_left($1) v`, [credit])).v), 300, 'used once: ₱300 left');
  await pay(db, b.id, P(200, { source: 'petty_cash' }));
  eq((await state(db, b.id)).state, 'paid', 'credit + cash = the full cost');
  assert((await code(pay(db, c2.id, P(301, { source: 'credit', credit_id: credit })))).includes('OVER_CREDIT'), 'never past what is left');
  const last = (await pay(db, c2.id, P(300, { source: 'credit', credit_id: credit }))).payment_id;
  eq(num((await one(db, `select pur_credit_left($1) v`, [credit])).v), 0, 'used up');
  assert((await code(pay(db, other.id, P(1, { source: 'credit', credit_id: credit })))).includes('CREDIT_SUPPLIER'), 'another supplier');
  eq(await raw(db, BUYER), held - 200, 'only the ₱200 cash left the petty cash');
  await db.query(`select pur_void_payment($1, $2, 'wrong')`, [op(), last]);
  eq(num((await one(db, `select pur_credit_left($1) v`, [credit])).v), 300, 'a voided use gives it back');
  await as(db, OWNER);
  assert((await code(db.query(`select pur_void_credit($1, $2, 'x')`, [op(), credit]))).includes('CREDIT_USED'), 'used credit stays');
  const listed = (await one(db, `select pur_credits($1) r`, [wil])).r;
  eq(listed.map(x => num(x.left)), [300]);
});

await test('Q10: an overpaid credit-funded payment goes back to that supplier\'s credit (suggested), unless a real refund is recorded', async () => {
  const db = await fresh();
  const wil = await supplier(db, 'Wilcon');
  const first = await bought(db, BUYER, 100, { body: { supplier_id: wil } });
  await pay(db, first.id, P(600));
  await as(db, OWNER);
  const credit = (await resolve(db, first.id, [], { amount: '500' })).created[0].credit_id;
  const { id, folder: f } = await bought(db, BUYER, 500, { body: { supplier_id: wil } });
  await as(db, BUYER);
  await pay(db, id, P(500, { source: 'credit', credit_id: credit }));
  const fixed = body([{ folder_id: f, item_name: 'Cement', quantity: 1, amount: 300 }], { supplier_id: wil });
  await db.query(`select pur_correct($1, $2, $3::jsonb, 'two bags back')`, [op(), id, JSON.stringify(fixed)]);
  await as(db, OWNER);
  const row = (await one(db, `select pur_overpaid() r`)).r.find(x => x.id === id);
  eq(row.suggested.map(x => [x.source, num(x.amount)]), [['credit', 200]], 'the excess came from credit');
  await resolve(db, id, [], { amount: '200', note: 'back to Wilcon credit' });
  eq((await one(db, `select pur_credits($1) r`, [wil])).r.reduce((s, x) => s + num(x.left), 0), 200, 'Wilcon credit ₱200 again');
});

await test('a payment that was refunded cannot be voided until the refund is (RESOLVED_FIRST)', async () => {
  const db = await fresh();
  const { id } = await bought(db, BUYER, 100);
  await as(db, OWNER);
  const p = (await pay(db, id, P(300))).payment_id;
  const r = (await resolve(db, id, [{ amount: '200', funded_by: 'company', received_by: 'company', received_on: phDate() }])).created[0].refund_id;
  assert((await code(db.query(`select pur_void_payment($1, $2, 'oops')`, [op(), p]))).includes('RESOLVED_FIRST'));
  await db.query(`select pur_void_refund($1, $2, 'entered wrong')`, [op(), r]);
  await db.query(`select pur_void_payment($1, $2, 'oops')`, [op(), p]);
  eq((await state(db, id)).state, 'unpaid');
  // Still more over than resolved after the void — only "refunded more than that money paid" can stop it.
  const db2 = await fresh();
  await give(db2, BUYER, 300);
  const b = await bought(db2, BUYER, 1000);
  await as(db2, BUYER);
  const petty = (await pay(db2, b.id, P(300, { source: 'petty_cash' }))).payment_id;
  await as(db2, OWNER);
  await pay(db2, b.id, P(1500));
  await resolve(db2, b.id, [{ amount: '300', funded_by: 'petty_cash', person_id: BUYER, received_by: 'petty_cash', received_on: phDate() }]);
  assert((await code(db2.query(`select pur_void_payment($1, $2, 'oops')`, [op(), petty]))).includes('RESOLVED_FIRST'),
    'petty cash refunded ₱300 it would no longer have paid');
});

await test('a credit needs a listed supplier: the purchase\'s, or one picked when confirming', async () => {
  const db = await fresh();
  const { id } = await bought(db, BUYER, 100, { body: { supplier: 'Sari-sari store' } });
  await pay(db, id, P(150));
  await as(db, OWNER);
  assert((await code(resolve(db, id, [], { amount: '50' }))).includes('CREDIT_SUPPLIER'), 'no supplier on the list');
  const s = await supplier(db, 'Sari-sari store');
  await resolve(db, id, [], { amount: '50', supplier_id: s });
  eq((await state(db, id)).state, 'paid');
});

await test('a payment a supplier credit relies on cannot be voided either (more would be given back than is over)', async () => {
  const db = await fresh();
  const wil = await supplier(db, 'Wilcon');
  const { id } = await bought(db, BUYER, 100, { body: { supplier_id: wil } });
  await as(db, OWNER);
  const p = (await pay(db, id, P(300))).payment_id;
  const credit = (await resolve(db, id, [], { amount: '200' })).created[0].credit_id;
  // No refund here: only "what is over" can stop this void.
  assert((await code(db.query(`select pur_void_payment($1, $2, 'oops')`, [op(), p]))).includes('RESOLVED_FIRST'));
  await db.query(`select pur_void_credit($1, $2, 'entered wrong')`, [op(), credit]);
  await db.query(`select pur_void_payment($1, $2, 'oops')`, [op(), p]);
  eq((await state(db, id)).state, 'unpaid');
});

await test('Q10: a credit-funded overpayment may instead be refunded in cash — to the company, or into a buyer\'s hands (cash they hold)', async () => {
  const db = await fresh();
  const wil = await supplier(db, 'Wilcon');
  const first = await bought(db, BUYER, 100, { body: { supplier_id: wil } });
  await pay(db, first.id, P(600));
  await as(db, OWNER);
  const credit = (await resolve(db, first.id, [], { amount: '500' })).created[0].credit_id;
  const { id, folder: f } = await bought(db, BUYER, 500, { body: { supplier_id: wil } });
  await as(db, BUYER);
  await pay(db, id, P(500, { source: 'credit', credit_id: credit }));
  const fixed = body([{ folder_id: f, item_name: 'Cement', quantity: 1, amount: 300 }], { supplier_id: wil });
  await db.query(`select pur_correct($1, $2, $3::jsonb, 'two bags back')`, [op(), id, JSON.stringify(fixed)]);
  await as(db, OWNER);
  const part = (amount, received_by, person_id) => ({ amount: String(amount), funded_by: 'credit', received_by, person_id, received_on: phDate() });
  assert((await code(resolve(db, id, [part(600, 'company')]))).includes('OVER_SOURCE'), 'never more than the credit paid');
  assert((await code(resolve(db, id, [part(10, 'buyer', BUYER)]))).includes('BAD_REFUND_ROUTE'), 'credit money is not the buyer\'s own');
  const held = await raw(db, BUYER);
  await resolve(db, id, [part(120, 'company'), part(80, 'petty_cash', BUYER)]);
  eq((await state(db, id)).state, 'paid', 'resolved by refunds, not credit');
  eq(await raw(db, BUYER), held + 80, 'the ₱80 handed to the buyer is cash they hold');
  eq((await one(db, `select pur_credits($1) r`, [wil])).r.reduce((s, x) => s + num(x.left), 0), 0, 'the credit was not restored');
});

await test('pur_cash_buyer: the main owner reads one buyer\'s entries (counts included); a buyer cannot', async () => {
  const db = await fresh();
  await give(db, BUYER, 1000);
  await as(db, OWNER);
  await db.query(`select pur_cash_count($1, $2, $3, '900', 'site')`, [op(), BUYER, phDate()]);
  const d = (await one(db, `select pur_cash_buyer($1) d`, [BUYER])).d;
  eq([num(d.held), d.issues.length, d.counts.length, num(d.counts[0].recorded)], [1000, 1, 1, 1000]);
  assert((await code(db.query(`select pur_cash_buyer($1)`, [WORKER]))).includes('NOT_A_BUYER'));
  await as(db, BUYER2);
  assert((await code(db.query(`select pur_cash_buyer($1)`, [BUYER]))).includes('OWNER_ONLY'), 'another buyer');
  await as(db, BUYER);
  eq((await one(db, `select pur_my_cash() m`)).m.counts.length, 1, 'a buyer sees their own counts too');
});

// ── D. Petty cash (Q13–Q20) ─────────────────────────────────────────────

await test('only the main owner gives petty cash, and only to a staff buyer', async () => {
  const db = await fresh();
  for (const who of [BUYER, STAFF, PMOWNER, EXPOWNER]) {
    await as(db, who);
    const r = await code(db.query(`select pur_cash_give($1, $2, '1000', $3, 'cash', '')`, [op(), BUYER, phDate()]));
    assert(r.includes('OWNER_ONLY') || r.includes('NOT_ALLOWED'), who + ': ' + r);
  }
  await as(db, OWNER);
  for (const target of [STAFF, WORKER, OWNER, GONE]) {
    const r = await code(db.query(`select pur_cash_give($1, $2, '1000', $3, 'cash', '')`, [op(), target, phDate()]));
    assert(r.includes('NOT_A_BUYER'), target + ': ' + r);
  }
  await give(db, BUYER, 1000);
  eq(await raw(db, BUYER), 1000, 'counts at once (Q14)');
});

await test('Q14: "I did not receive this" flags it without changing the balance; the main owner clears the flag or voids the entry', async () => {
  const db = await fresh();
  const issue = (await give(db, BUYER, 1000)).issue_id;
  await as(db, BUYER2);
  assert((await code(db.query(`select pur_cash_dispute($1, $2, 'not me')`, [op(), issue]))).includes('NOT_FOUND'), 'only the buyer it was given to');
  await as(db, BUYER);
  await db.query(`select pur_cash_dispute($1, $2, 'only got 500')`, [op(), issue]);
  eq(await raw(db, BUYER), 1000, 'balance unchanged');
  assert((await code(db.query(`select pur_cash_dispute($1, $2, 'again')`, [op(), issue]))).includes('ALREADY_DISPUTED'));
  await as(db, OWNER);
  eq((await one(db, `select pur_cash_tracker() t`)).t.disputes.length, 1, 'on the tracker');
  await db.query(`select pur_cash_clear_dispute($1, $2, 'handed over at the site, he forgot')`, [op(), issue]);
  eq((await one(db, `select pur_cash_tracker() t`)).t.disputes.length, 0);
  await db.query(`select pur_cash_void_issue($1, $2, 'entered twice')`, [op(), issue]);
  eq(await raw(db, BUYER), 0, 'a void takes it out');
});

await test('Q17: a reported return waits; only the main owner\'s confirmation lowers the balance; a rejection needs a reason; the buyer may withdraw', async () => {
  const db = await fresh();
  await give(db, BUYER, 1000);
  await as(db, BUYER);
  const a = (await one(db, `select pur_cash_report_return($1, '300', $2, 'Sir John', '', '') r`, [op(), phDate()])).r.return_id;
  eq(await raw(db, BUYER), 1000, 'not until confirmed');
  eq(num((await one(db, `select pur_my_cash() m`)).m.pending_returns), 300, 'shown apart');
  const b = (await one(db, `select pur_cash_report_return($1, '50', $2, '', '', '') r`, [op(), phDate()])).r.return_id;
  await db.query(`select pur_cash_withdraw_return($1, $2)`, [op(), b]);
  await as(db, OWNER);
  assert((await code(db.query(`select pur_cash_decide_return($1, $2, false, '')`, [op(), a]))).includes('REASON_REQUIRED'));
  assert((await code(db.query(`select pur_cash_decide_return($1, $2, true, '')`, [op(), b]))).includes('BAD_STATE'), 'withdrawn');
  await db.query(`select pur_cash_decide_return($1, $2, true, 'counted')`, [op(), a]);
  eq(await raw(db, BUYER), 700);
  await as(db, BUYER);
  assert((await code(db.query(`select pur_cash_withdraw_return($1, $2)`, [op(), a]))).includes('BAD_STATE'), 'decided');
  const c = (await one(db, `select pur_cash_report_return($1, '100', $2, '', '', '') r`, [op(), phDate()])).r.return_id;
  await as(db, OWNER);
  await db.query(`select pur_cash_decide_return($1, $2, false, 'never received')`, [op(), c]);
  eq(await raw(db, BUYER), 700, 'a rejection changes nothing');
  await db.query(`select pur_cash_void_return($1, $2, 'it was ₱200')`, [op(), a]);
  eq(await raw(db, BUYER), 1000, 'a confirmed return voided');
  await as(db, WORKER);
  assert((await code(db.query(`select pur_cash_report_return($1, '1', $2, '', '', '')`, [op(), phDate()]))).includes('BUYER_REQUIRED'));
});

await test('Q16: paying more than the petty cash recorded keeps the payment; cash held reads ₱0 and the rest is an unreconciled shortfall', async () => {
  const db = await fresh();
  await give(db, BUYER, 800);
  const { id } = await bought(db, BUYER, 1000);
  await as(db, BUYER);
  await pay(db, id, P(1000, { source: 'petty_cash' }));
  const m = (await one(db, `select pur_my_cash() m`)).m;
  eq([num(m.recorded), num(m.held), num(m.shortfall)], [-200, 0, 200]);
  await give(db, BUYER, 200, phDate());
  const t = (await one(db, `select pur_cash_tracker() t`)).t.buyers.find(x => x.buyer_id === BUYER);
  eq([num(t.held), num(t.shortfall)], [0, 0], 'reconciled by recording the missing handover');
});

await test('Q19: a cash count is a record only, shown against the balance recorded that day', async () => {
  const db = await fresh();
  await give(db, BUYER, 3500);
  await as(db, OWNER);
  await db.query(`select pur_cash_count($1, $2, $3, '3200', 'counted at the site')`, [op(), BUYER, phDate()]);
  const t = (await one(db, `select pur_cash_tracker() t`)).t.buyers.find(x => x.buyer_id === BUYER);
  eq([num(t.last_count.counted), num(t.last_count.recorded)], [3200, 3500], 'short ₱300');
  eq(await raw(db, BUYER), 3500, 'no balance change');
  await as(db, BUYER);
  assert((await code(db.query(`select pur_cash_count($1, $2, $3, '1', '')`, [op(), BUYER, phDate()]))).includes('OWNER_ONLY'));
});

await test('Q18/Q20 the daily report: opening + received + refunds in − payments − confirmed returns = closing; a return counts on its confirmation day; empty days skipped', async () => {
  const db = await fresh();
  await give(db, BUYER, 5000, phDate(-3));
  const { id } = await bought(db, BUYER, 1500);
  await as(db, BUYER);
  await pay(db, id, P(1500, { source: 'petty_cash', paid_on: phDate(-2) }));
  await db.query(`select pur_cash_report_return($1, '1000', $2, 'Sir', '', '')`, [op(), phDate(-1)]);
  await as(db, OWNER);
  const ret = (await one(db, `select id from pur_cash_returns`)).id;
  await db.query(`select pur_cash_decide_return($1, $2, true, '')`, [op(), ret]);
  const rep = (await one(db, `select pur_cash_report($1, $2, $3) r`, [BUYER, phDate(-5), phDate()])).r;
  eq(rep.days.map(d => d.day), [phDate(-3), phDate(-2), phDate()], 'three days with entries; the handover day is not one of them');
  eq(rep.days.map(d => [num(d.opening), num(d.closing)]), [[0, 5000], [5000, 3500], [3500, 2500]]);
  for (const d of rep.days) {
    const sum = (k) => d[k].reduce((s, x) => s + num(x.amount), 0);
    eq(num(d.opening) + sum('received') + sum('refunds_in') - sum('payments') - sum('returns'), num(d.closing), d.day + ' adds up');
  }
  eq(rep.days[2].returns[0].handed_on, phDate(-1), 'shown with its handover day');
  eq(rep.days[1].payments[0].items, ['Cement'], 'what was bought');
  eq([num(rep.opening), num(rep.closing)], [0, 2500]);
  assert((await code(db.query(`select pur_cash_report($1, $2, $3)`, [BUYER, phDate(-100), phDate()]))).includes('BAD_RANGE'), 'at most 92 days');
});

await test('R7: a voided entry stays on its own day; the void is a reversal on the day it was made — past closings never change', async () => {
  const db = await fresh();
  const issue = (await give(db, BUYER, 1000, phDate(-2))).issue_id;
  const { id } = await bought(db, BUYER, 300);
  await as(db, BUYER);
  const p = (await pay(db, id, P(300, { source: 'petty_cash', paid_on: phDate(-1) }))).payment_id;
  await as(db, OWNER);
  const before = (await one(db, `select pur_cash_report($1, $2, $3) r`, [BUYER, phDate(-2), phDate(-1)])).r;
  await as(db, BUYER);
  await db.query(`select pur_void_payment($1, $2, 'double entry')`, [op(), p]);
  await as(db, OWNER);
  await db.query(`select pur_cash_void_issue($1, $2, 'given twice')`, [op(), issue]);
  const rep = (await one(db, `select pur_cash_report($1, $2, $3) r`, [BUYER, phDate(-2), phDate()])).r;
  eq(rep.days.map(d => d.day), [phDate(-2), phDate(-1), phDate()]);
  eq(rep.days.slice(0, 2).map(d => num(d.closing)), before.days.map(d => num(d.closing)), 'the past closings are what they were');
  eq([rep.days[1].payments[0].voided_on, rep.days[0].received[0].voided_on], [phDate(), phDate()], 'marked voided, still on their days');
  eq(rep.days[2].reversals.map(r => [r.what, num(r.effect), r.reason]),
     [['Paid to supplier', 300, 'double entry'], ['Petty cash given', -1000, 'given twice']], 'today: the two reversals');
  for (const d of rep.days) {
    const sum = (k) => d[k].reduce((s, x) => s + num(x.amount), 0);
    const rev = d.reversals.reduce((s, x) => s + num(x.effect), 0);
    eq(num(d.opening) + sum('received') + sum('refunds_in') - sum('payments') - sum('returns') + rev, num(d.closing), d.day + ' adds up');
  }
  eq(await raw(db, BUYER), 0, 'today: both undone');
});

await test('R11: a confirmed return of more than is recorded leaves cash held at ₱0 and the rest as an unreconciled shortfall', async () => {
  const db = await fresh();
  await give(db, BUYER, 500);
  await as(db, BUYER);
  const r = (await one(db, `select pur_cash_report_return($1, '800', $2, '', '', '') r`, [op(), phDate()])).r.return_id;
  await as(db, OWNER);
  await db.query(`select pur_cash_decide_return($1, $2, true, 'counted ₱800')`, [op(), r]);
  const t = (await one(db, `select pur_cash_tracker() t`)).t.buyers.find(x => x.buyer_id === BUYER);
  eq([num(t.recorded), num(t.held), num(t.shortfall)], [-300, 0, 300]);
});

await test('R4: a replacement moves each payment with its own history entry; the payment keeps its first purchase', async () => {
  const db = await fresh();
  const { id, folder: f } = await bought(db, BUYER, 1000);
  const a = (await pay(db, id, P(300))).payment_id;
  const b = (await pay(db, id, P(200, { method: 'gcash' }))).payment_id;
  await as(db, BUYER);
  const two = body([{ folder_id: f, item_name: 'Cement', quantity: 1, amount: 1000 }, { folder_id: f, item_name: 'Nails', quantity: 1, amount: 50 }]);
  const n = (await one(db, `select pur_replace($1, $2, $3::jsonb, 'forgot nails') r`, [op(), id, JSON.stringify(two)])).r.purchase_id;
  const rows = await all(db, `select id, purchase_id, first_purchase_id, amount, paid_on, method from pur_payments order by amount`);
  eq(rows.map(r => [r.purchase_id === n, r.first_purchase_id === id, num(r.amount), r.method]),
     [[true, true, 200, 'gcash'], [true, true, 300, 'cash']], 'moved, every detail kept');
  const ev = await all(db, `select ref_id, purchase_id, detail ->> 'from_purchase' f from pur_money_events where kind = 'payment_moved' order by amount`);
  eq(ev.map(e => [e.ref_id, e.purchase_id === n, e.f === id]), [[b, true, true], [a, true, true]], 'one entry per payment');
  eq([(await state(db, id)).state, (await state(db, n)).state, num((await state(db, n)).paid)], ['void', 'partial', 500],
     'counted once, on the new version');
  const pv = (await one(db, `select pur_purchase_payments($1) v`, [n])).v;
  eq(pv.payments.map(x => x.moved), [true, true]);
});

await test('R9: the main owner rejects an own-money claim with a reason — never owed, the decision kept, no second decision', async () => {
  const db = await fresh();
  const { id } = await bought(db, BUYER, 1000);
  await as(db, BUYER);
  const p = (await pay(db, id, P(400, { source: 'own_money' }))).payment_id;
  assert((await code(db.query(`select pur_reject_own_money($1, $2, 'no')`, [op(), p]))).includes('OWNER_ONLY'));
  await as(db, OWNER);
  assert((await code(db.query(`select pur_reject_own_money($1, $2, ' ')`, [op(), p]))).includes('REASON_REQUIRED'));
  await db.query(`select pur_reject_own_money($1, $2, 'I said to wait for petty cash')`, [op(), p]);
  eq(await owes(db, BUYER), 0, 'never owed');
  await as(db, BUYER);
  eq(num((await one(db, `select pur_my_cash() m`)).m.owes_to_review), 0, 'off the review list');
  await as(db, OWNER);
  eq((await one(db, `select pur_cash_tracker() t`)).t.to_review.length, 0);
  assert((await code(db.query(`select pur_accept_own_money($1, $2)`, [op(), p]))).includes('BAD_STATE'), 'no accept after a reject');
  assert((await code(db.query(`select pur_reject_own_money($1, $2, 'again')`, [op(), p]))).includes('BAD_STATE'), 'once');
  eq((await state(db, id)).state, 'partial', 'the supplier was still paid');
  const j = (await one(db, `select pur_payment_json($1) j`, [p])).j;
  eq(j.reject_reason, 'I said to wait for petty cash');
  eq((await all(db, `select kind from pur_money_events where ref_id = $1 order by seq`, [p])).map(r => r.kind), ['paid', 'own_money_rejected']);
});

await test('R13: a return photo lives in pettyCash/, read only by the main owner and the buyer who uploaded it', async () => {
  const db = await fresh();
  const mine = `pettyCash/${OWNER}/2026-10/44444444-4444-4444-4444-444444444444.jpg`;
  await db.query(`insert into receipt_uploads (path, owner_id, kind, uploaded_by, state) values ($1, $2, 'petty_cash', $3, 'pending')`, [mine, OWNER, BUYER]);
  const can = async (who, fn) => { await as(db, who); return (await one(db, fn === 'r' ? `select uploads_can_read($1, $2) x` : `select uploads_can_write($1) x`, fn === 'r' ? [mine, BUYER] : [mine])).x; };
  eq([await can(BUYER, 'r'), await can(OWNER, 'r'), await can(BUYER2, 'r'), await can(STAFF, 'r'), await can(EXPOWNER, 'r'), await can(WORKER, 'r')],
     [true, true, false, false, false, false], 'the uploader and the main owner only (even with the uploader id passed for another reader)');
  eq([await can(BUYER, 'w'), await can(STAFF, 'w'), await can(WORKER, 'w')], [true, false, false], 'buyers of the company write');
  const url = 'https://example.supabase.co/storage/v1/object/public/uploads/' + mine;
  await as(db, BUYER2);
  assert((await code(db.query(`select pur_cash_report_return($1, '1', $2, '', $3, '')`, [op(), phDate(), url]))).includes('BAD_DOCS'),
    'another buyer cannot attach it');
  const purchasesPath = `purchases/${OWNER}/2026-10/55555555-5555-5555-5555-555555555555.jpg`;
  await db.query(`insert into receipt_uploads (path, owner_id, kind, uploaded_by, state) values ($1, $2, 'purchase', $3, 'pending')`, [purchasesPath, OWNER, BUYER]);
  await as(db, BUYER);
  assert((await code(db.query(`select pur_cash_report_return($1, '1', $2, '', $3, '')`, [op(), phDate(),
    'https://example.supabase.co/storage/v1/object/public/uploads/' + purchasesPath]))).includes('BAD_DOCS'), 'never from the shared purchases folder');
  await db.query(`select pur_cash_report_return($1, '1', $2, '', $3, '')`, [op(), phDate(), url]);
  eq((await one(db, `select state from receipt_uploads where path = $1`, [mine])).state, 'attached', 'the uploader attaches their own');
});

await test('Q24: the tracker and report are the main owner\'s; a buyer sees only their own cash', async () => {
  const db = await fresh();
  await give(db, BUYER, 1000);
  await give(db, BUYER2, 2000);
  for (const who of [BUYER, STAFF, PMOWNER, EXPOWNER]) {
    await as(db, who);
    assert((await code(db.query(`select pur_cash_tracker()`))).match(/OWNER_ONLY|NOT_ALLOWED/), who + ' tracker');
    assert((await code(db.query(`select pur_cash_report($1, $2, $3)`, [BUYER, phDate(), phDate()]))).match(/OWNER_ONLY|NOT_ALLOWED/), who + ' report');
    assert((await code(db.query(`select pur_overpaid()`))).match(/OWNER_ONLY|NOT_ALLOWED/), who + ' overpaid');
  }
  await as(db, BUYER);
  const mine = (await one(db, `select pur_my_cash() m`)).m;
  eq([num(mine.held), mine.issues.length], [1000, 1], 'Juan sees his ₱1,000 only');
  await as(db, OWNER);
  eq((await one(db, `select pur_my_cash() m`)).m.holder, false, 'the owner holds no petty cash');
  const t = (await one(db, `select pur_cash_tracker() t`)).t;
  eq(t.buyers.map(b => [b.name, num(b.held)]).sort(), [['Juan', 1000], ['Pedro', 2000]], 'both buyers, GONE has nothing');
});

// ── E. The buyer's own money (Q21, Q22) ─────────────────────────────────

await test('Q21: own money while "May use own money" is off is kept and flagged, not owed until the main owner accepts it', async () => {
  const db = await fresh();
  const { id } = await bought(db, BUYER, 1000);
  await as(db, BUYER);
  const p = (await pay(db, id, P(400, { source: 'own_money' }))).payment_id;
  eq((await one(db, `select authorized from pur_payments where id = $1`, [p])).authorized, false);
  eq([await owes(db, BUYER), num((await one(db, `select pur_my_cash() m`)).m.owes_to_review)], [0, 400]);
  eq((await state(db, id)).state, 'partial', 'it still paid the supplier');
  await as(db, BUYER);
  assert((await code(db.query(`select pur_accept_own_money($1, $2)`, [op(), p]))).includes('OWNER_ONLY'));
  await as(db, OWNER);
  eq((await one(db, `select pur_cash_tracker() t`)).t.to_review.length, 1);
  await db.query(`select pur_accept_own_money($1, $2)`, [op(), p]);
  eq(await owes(db, BUYER), 400);
  assert((await code(db.query(`select pur_accept_own_money($1, $2)`, [op(), p]))).includes('BAD_STATE'), 'once');
  await db.query(`select pur_set_own_money($1, true)`, [BUYER]);
  await as(db, BUYER);
  const q = (await pay(db, id, P(100, { source: 'own_money' }))).payment_id;
  eq((await one(db, `select authorized from pur_payments where id = $1`, [q])).authorized, true, 'switch on: authorized');
  eq(num((await one(db, `select count(*) n from pur_money_events where kind = 'own_money_on'`)).n), 1, 'switch history');
});

await test('Q22: repayments are the main owner\'s, never more than owed, voided with a reason', async () => {
  const db = await fresh();
  await as(db, OWNER);
  await db.query(`select pur_set_own_money($1, true)`, [BUYER]);
  const { id } = await bought(db, BUYER, 1000);
  await as(db, BUYER);
  await pay(db, id, P(1000, { source: 'own_money' }));
  assert((await code(db.query(`select pur_repay_buyer($1, $2, '100', $3, 'cash', '')`, [op(), BUYER, phDate()]))).includes('OWNER_ONLY'));
  await as(db, OWNER);
  const r = (await one(db, `select pur_repay_buyer($1, $2, '600', $3, 'gcash', '') r`, [op(), BUYER, phDate()])).r;
  eq(num(r.owes), 400);
  assert((await code(db.query(`select pur_repay_buyer($1, $2, '500', $3, 'cash', '')`, [op(), BUYER, phDate()]))).includes('OVER_OWED'));
  await db.query(`select pur_void_repayment($1, $2, 'paid twice by mistake')`, [op(), r.repayment_id]);
  eq(await owes(db, BUYER), 1000);
  eq(await raw(db, BUYER), 0, 'repaying never touches petty cash');
});

// ── F. Outside the money model, private, retried once ───────────────────

await test('nothing here writes expenses or payroll: Spent is identical through every operation', async () => {
  const db = await fresh();
  const wil = await supplier(db, 'Wilcon');
  await as(db, OWNER);
  await db.query(`select pur_set_own_money($1, true)`, [BUYER]);
  const { id } = await bought(db, BUYER, 1000, { body: { supplier_id: wil } });
  const before = await money(db);
  await give(db, BUYER, 2000);
  await as(db, BUYER);
  await pay(db, id, P(700, { source: 'petty_cash' }));
  await pay(db, id, P(500, { source: 'own_money' }));
  const ret = (await one(db, `select pur_cash_report_return($1, '100', $2, '', '', '') r`, [op(), phDate()])).r.return_id;
  await as(db, OWNER);
  await db.query(`select pur_cash_decide_return($1, $2, true, '')`, [op(), ret]);
  await resolve(db, id, [{ amount: '100', funded_by: 'own_money', person_id: BUYER, received_by: 'buyer', received_on: phDate() }], { amount: '100' });
  await db.query(`select pur_repay_buyer($1, $2, '300', $3, 'cash', '')`, [op(), BUYER, phDate()]);
  await db.query(`select pur_cash_count($1, $2, $3, '1200', '')`, [op(), BUYER, phDate()]);
  eq(await money(db), before, 'expenses (rows, ₱) and payroll unchanged');
  const src = M102.replace(/--[^\n]*/g, '');
  assert(!/\b(insert\s+into|update|delete\s+from)\s+(public\.)?(expenses|payroll)\b/i.test(src), '0102 writes no expense or payroll row');
  assert(!/\bfrom\s+(public\.)?(expenses|payroll)\b/i.test(src), '0102 reads neither');
});

await test('the nine tables are private: a signed-in client reads and writes none of them directly', async () => {
  const db = await fresh();
  await give(db, BUYER, 100);
  await as(db, OWNER);
  await db.exec(`set role authenticated`);
  for (const t of ['pur_payments', 'pur_supplier_credits', 'pur_refunds', 'pur_cash_issues', 'pur_cash_returns',
                   'pur_cash_counts', 'pur_own_money', 'pur_buyer_repayments', 'pur_money_events']) {
    assert((await code(db.query(`select * from ${t}`))).includes('permission denied'), t);
  }
  assert((await code(db.query(`insert into pur_cash_issues (owner_id, buyer_id, amount, issued_on, method, created_by)
                                 values ($1, $2, 1, current_date, 'cash', $1)`, [OWNER, BUYER]))).includes('permission denied'));
  for (const f of ['pur_cash_raw($1, $1)', 'pur_owes($1, $1)', 'pur_pay_state($1)']) {
    assert((await code(db.query(`select ${f}`, [OWNER]))).includes('permission denied'), f + ' is internal');
  }
  await db.exec(`reset role`);
});

await test('every write answers a retry with its first answer (petty cash given once, a return reported once, a repayment once)', async () => {
  const db = await fresh();
  await as(db, OWNER);
  const g = op();
  await db.query(`select pur_cash_give($1, $2, '1000', $3, 'cash', '')`, [g, BUYER, phDate()]);
  const again = (await one(db, `select pur_cash_give($1, $2, '1000', $3, 'cash', '') r`, [g, BUYER, phDate()])).r;
  eq(again.replayed, true);
  eq(await raw(db, BUYER), 1000, 'given once');
  await as(db, BUYER);
  const rr = op();
  await db.query(`select pur_cash_report_return($1, '100', $2, '', '', '')`, [rr, phDate()]);
  await db.query(`select pur_cash_report_return($1, '100', $2, '', '', '')`, [rr, phDate()]);
  eq(num((await one(db, `select count(*) n from pur_cash_returns`)).n), 1, 'reported once');
});

await test('Project Control\'s badge: owner accounts only, by purchase line and charge id', async () => {
  const db = await fresh();
  const { id } = await bought(db, BUYER, 1000);
  await pay(db, id, P(400));
  const line = (await one(db, `select id from purchase_lines where purchase_id = $1`, [id])).id;
  await as(db, OWNER);
  eq((await one(db, `select pur_payment_badges() b`)).b[line], 'partial');
  for (const [who, want] of [[STAFF, 'OWNER_ONLY'], [BUYER, 'OWNER_ONLY'], [WORKER, 'OWNER_ONLY'], [PMOWNER, 'NOT_ALLOWED']]) {
    await as(db, who);
    const r = await code(db.query(`select pur_payment_badges()`));
    assert(r.includes(want), who + ': ' + r);
  }
});

await test('a payment\'s proof photo and a return\'s photo mark their uploads attached', async () => {
  const db = await fresh();
  const { id } = await bought(db, BUYER, 100);
  const path1 = `purchases/${OWNER}/2026-10/22222222-2222-2222-2222-222222222222.jpg`;
  const path2 = `pettyCash/${OWNER}/2026-10/33333333-3333-3333-3333-333333333333.jpg`;
  await db.query(`insert into receipt_uploads (path, owner_id, kind, uploaded_by, state) values ($1, $2, 'purchase', $3, 'pending'), ($4, $2, 'petty_cash', $3, 'pending')`,
    [path1, OWNER, BUYER, path2]);
  const url = (p) => 'https://example.supabase.co/storage/v1/object/public/uploads/' + p;
  await as(db, BUYER);
  await pay(db, id, P(100, { proof_url: url(path1) }));
  await db.query(`select pur_cash_report_return($1, '1', $2, '', $3, '')`, [op(), phDate(), url(path2)]);
  eq((await all(db, `select state from receipt_uploads order by path desc`)).map(r => r.state), ['attached', 'attached']);
});

await test('the history is append-only', async () => {
  const db = await fresh();
  await give(db, BUYER, 100);
  assert((await code(db.query(`update pur_money_events set amount = 1`))).includes('HISTORY_IMMUTABLE'));
  assert((await code(db.query(`delete from pur_money_events`))).includes('HISTORY_IMMUTABLE'));
  eq((await all(db, `select kind from pur_money_events`)).map(r => r.kind), ['cash_given']);
});

if (WITH_0103) await test('0103: the buyer\'s own return photo (F3), the owner in that buyer\'s view, no other buyer; list rows name their supplier; done operations are the caller\'s own (R38)', async () => {
  const db = await fresh();
  await give(db, BUYER, 500);
  const mine = `pettyCash/${OWNER}/2026-10/66666666-6666-6666-6666-666666666666.jpg`;
  const url = 'https://example.supabase.co/storage/v1/object/public/uploads/' + mine;
  await db.query(`insert into receipt_uploads (path, owner_id, kind, uploaded_by, state) values ($1, $2, 'petty_cash', $3, 'pending')`, [mine, OWNER, BUYER]);
  await as(db, BUYER);
  await db.query(`select pur_cash_report_return($1, '200', $2, 'the owner', $3, '')`, [op(), phDate(), url]);
  await db.query(`select pur_cash_report_return($1, '50', $2, '', '', 'no photo')`, [op(), phDate()]);
  const mineNow = (await one(db, `select pur_my_cash() x`)).x;
  eq(mineNow.returns.map(r => r.photo_url).sort(), ['', url], 'both returns, the photo where there is one');
  await as(db, OWNER);
  eq((await one(db, `select pur_cash_buyer($1) x`, [BUYER])).x.returns.map(r => r.photo_url).sort(), ['', url], 'the main owner too');
  await as(db, BUYER2);
  const other = (await one(db, `select pur_my_cash() x`)).x;
  eq(other.returns, [], 'another buyer sees only their own (none)');
  assert(/OWNER_ONLY|NOT_ALLOWED/.test(await code(db.query(`select pur_cash_buyer($1)`, [BUYER]))), 'and cannot read Juan\'s');
  await db.exec(`set role authenticated`);
  assert((await code(db.query(`select pur_cash_detail($1, $2)`, [OWNER, BUYER]))).includes('permission denied'), 'still internal');
  await db.exec(`reset role`);
  // A purchases-list row (Purchasing, My purchases) also names its supplier, for paying from its credit offline.
  const wil = await supplier(db, 'ZZ Wilcon');
  const { id } = await bought(db, BUYER, 100, { body: { supplier_id: wil } });
  await as(db, BUYER);
  const row = (await one(db, `select pur_my_purchases(30) x`)).x.find(r => r.id === id);
  eq([row.supplier_id, row.pay.state], [wil, 'unpaid'], 'My purchases: the supplier and the payment state');
  // R38: which of MY operation ids the server already has — never another account's.
  const mine1 = op(), mine2 = op();
  await give(db, BUYER, 10);
  await as(db, BUYER);
  await db.query(`select pur_cash_report_return($1, '1', $2, '', '', '')`, [mine1, phDate()]);
  const askBoth = async () => (await one(db, `select pur_my_ops_done($1::uuid[]) x`, [[mine1, mine2]])).x;
  eq(await askBoth(), [mine1], 'the accepted one only');
  await as(db, BUYER2);
  eq(await askBoth(), [], 'another buyer learns nothing of Juan\'s');
  assert((await code(db.query(`select pur_my_ops_done($1::uuid[])`, [Array.from({ length: 201 }, () => op())]))).includes('BAD_OP'), '200 at most');
  await as(db, BUYER);
  // Nothing else in the answer changed: 0102's keys plus photo_url on each return.
  eq(Object.keys(mineNow.returns[0]).sort(),
     ['amount', 'decided_at', 'decision_note', 'handed_on', 'handed_to', 'id', 'photo_url', 'status', 'voided_at']);
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) { console.log('\nFAILURES:\n  ' + failures.join('\n  ')); process.exit(1); }
