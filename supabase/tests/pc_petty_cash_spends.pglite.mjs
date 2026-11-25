// ════════════════════════════════════════════════════════════════════
// PETTY CASH FOR LABOR AND OVERHEAD (0122) — BEHAVIOUR TESTS ON PGLITE
//   npm run test:sql
//
// Runs 0096, 0097, 0101, 0102, 0103 and 0122 VERBATIM on PGlite over the
// same minimal tables as the 2A-4 suite, with payroll and overhead_expenses
// carrying the columns 0122's triggers read. Nothing here talks to the live
// database.
// Spec: docs/superpowers/specs/2026-11-25-petty-cash-labor-overhead-design.md
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
const M103 = read(path.join(ROOT, 'supabase/migrations/0103_buyer_return_photo.sql'));
const M122 = read(path.join(ROOT, 'supabase/migrations/0122_petty_cash_labor_overhead.sql'));

// 2a4_payments.pglite.mjs's base, with payroll widened and overhead_expenses added.
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
  worker_name text, role text, total_salary numeric, payment_date text, notes text, cover_expense boolean default false,
  split_group text, split_index int, split_total int);
create table overhead_expenses (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null, folder_id uuid references folders(id),
  scope text, expense_name text, category text, description text, amount numeric, date text, status text,
  deleted_at timestamptz);
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
const OTHER = '00000000-0000-0000-0000-00000000000d';    // another company's owner
const EXPOWNER = '00000000-0000-0000-0000-000000000014'; // owner-role account with PM + Expenses (not the main owner)
const OSTAFF = '00000000-0000-0000-0000-000000000018';   // another company's staff

let passed = 0, failed = 0;
const failures = [];
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { failed++; failures.push(name + ' — ' + e.message); console.log('  FAIL ' + name + '\n       ' + e.message); }
}
function assert(c, m) { if (!c) throw new Error(m); }
function eq(a, b, m) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error((m || 'not equal') + ': ' + JSON.stringify(a) + ' !== ' + JSON.stringify(b)); }
const num = (x) => Number(x);

// A Philippine calendar date, `days` from today (UTC+8 has no daylight time).
function phDate(days = 0) {
  return new Date(Date.now() + 8 * 3600e3 + days * 86400e3).toISOString().slice(0, 10);
}

async function fresh() {
  const db = new PGlite();
  await db.exec(BASE);
  await db.exec(M96);
  await db.exec(prBase(ROOT));
  await db.exec(M97);
  await db.exec(M101);
  await db.exec(fnText(M98, 'pm_main_owner_id'));
  await db.exec(M102);
  await db.exec(M103);
  await db.exec(M122);
  await db.exec(`insert into profiles (id, role, owner_id, status, allowed_modules, email, display_name) values
    ('${OWNER}', 'owner', null, 'active', null, 'admin@dacs.test', null),
    ('${STAFF}', 'staff', '${OWNER}', 'active', null, 'staff@dacs.test', null),
    ('${BUYER}', 'staff', '${OWNER}', 'active', null, 'juan@dacs.test', 'Juan'),
    ('${BUYER2}', 'staff', '${OWNER}', 'active', null, 'pedro@dacs.test', 'Pedro'),
    ('${OTHER}', 'owner', null, 'active', null, 'other@x.test', null),
    ('${EXPOWNER}', 'owner', '${OWNER}', 'active', '["pm", "expenses"]'::jsonb, 'admin-exp@dacs.test', null),
    ('${OSTAFF}', 'staff', '${OTHER}', 'active', null, 'ostaff@x.test', 'Other staff');`);
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

async function folder(db, name = 'Sample Residence') {
  return (await one(db, `insert into folders (owner_id, name) values ($1, $2) returning id`, [OWNER, name])).id;
}
async function period(db, folderId) {
  return (await one(db, `insert into projects (owner_id, folder_id, month, year, funding_type, billing_number)
                          values ($1, $2, 'November', 2026, 'progress', 1) returning id`, [OWNER, folderId])).id;
}
async function addPay(db, pid, { amount = 1500, day = phDate(), by = null, worker = 'Mario', role = 'Mason', split = null } = {}) {
  return (await one(db, `insert into payroll (owner_id, project_id, worker_name, role, total_salary, payment_date, petty_cash_by, split_group)
                          values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`,
    [OWNER, pid, worker, role, amount, day, by, split])).id;
}
async function addOh(db, { amount = 800, day = phDate(), by = null, folderId = null, name = 'Diesel for generator' } = {}) {
  return (await one(db, `insert into overhead_expenses (owner_id, folder_id, scope, expense_name, category, description, amount, date, status, petty_cash_by)
                          values ($1, $2, $3, $4, 'Fuel', 'for the site', $5, $6, 'paid', $7) returning id`,
    [OWNER, folderId, folderId ? 'project' : 'company', name, amount, day, by])).id;
}
async function spends(db, buyer = null) {
  return all(db, `select id, buyer_id, kind, amount::float8 as amount, spent_on::text as spent_on, payroll_id, overhead_id,
                         split_group, label, place, voided_at is not null as voided, void_reason
                    from pur_cash_spends where $1::uuid is null or buyer_id = $1 order by created_at, id`, [buyer]);
}
const live = (rows) => rows.filter(r => !r.voided);
async function raw(db, buyer, upto = null) {
  return num((await one(db, `select pur_cash_raw($1, $2, $3::date) v`, [OWNER, buyer, upto])).v);
}

console.log('\nPetty cash for labor and overhead (0122)');

await test('staff buyer pays labor from own petty cash', async () => {
  const db = await fresh();
  const pid = await period(db, await folder(db));
  await as(db, BUYER);
  const before = await raw(db, BUYER);
  const id = await addPay(db, pid, { by: BUYER, day: phDate() + 'T08:30' });
  const rows = await spends(db, BUYER);
  eq(rows.length, 1, 'one spend');
  eq([rows[0].kind, rows[0].amount, rows[0].spent_on, rows[0].payroll_id, rows[0].label, rows[0].place, rows[0].voided],
     ['payroll', 1500, phDate(), id, 'Mario · Mason', 'Sample Residence', false]);
  eq(await raw(db, BUYER), before - 1500, 'balance drops');
});

await test('main owner records a buyer\'s petty cash', async () => {
  const db = await fresh();
  const pid = await period(db, await folder(db));
  await as(db, OWNER);
  await addPay(db, pid, { by: BUYER2 });
  eq((await spends(db)).map(r => r.buyer_id), [BUYER2]);
});

await test('staff cannot record another buyer\'s petty cash', async () => {
  const db = await fresh();
  const pid = await period(db, await folder(db));
  await as(db, BUYER);
  eq(await code(addPay(db, pid, { by: BUYER2 })), 'PERSON_NOT_ALLOWED');
  eq(num((await one(db, 'select count(*) c from payroll')).c), 0, 'no payroll row');
  eq((await spends(db)).length, 0, 'no spend');
});

await test('a non-main owner cannot either', async () => {
  const db = await fresh();
  const pid = await period(db, await folder(db));
  await as(db, EXPOWNER);
  eq(await code(addPay(db, pid, { by: BUYER })), 'PERSON_NOT_ALLOWED');
});

await test('only a staff account of this company holds petty cash', async () => {
  const db = await fresh();
  const pid = await period(db, await folder(db));
  await as(db, OWNER);
  eq(await code(addPay(db, pid, { by: OWNER })), 'NOT_A_BUYER', 'an owner');
  eq(await code(addPay(db, pid, { by: OSTAFF })), 'NOT_A_BUYER', 'another company\'s staff');
});

await test('petty cash needs a past day', async () => {
  const db = await fresh();
  const pid = await period(db, await folder(db));
  await as(db, BUYER);
  eq(await code(addPay(db, pid, { by: BUYER, day: '' })), 'PETTY_CASH_DATE', 'blank');
  eq(await code(addPay(db, pid, { by: BUYER, day: null })), 'PETTY_CASH_DATE', 'none');
  eq(await code(addPay(db, pid, { by: BUYER, day: '2026-13-01' })), 'PETTY_CASH_DATE', 'not a day');
  eq(await code(addPay(db, pid, { by: BUYER, day: phDate(1) })), 'PETTY_CASH_DATE', 'tomorrow');
  eq(await code(addPay(db, pid, { by: BUYER, amount: 0 })), 'BAD_AMOUNT', 'zero');
  eq((await spends(db)).length, 0);
});

await test('company-paid rows are untouched', async () => {
  const db = await fresh();
  const pid = await period(db, await folder(db));
  await as(db, BUYER);
  await addPay(db, pid, { by: null, day: '' });
  eq((await spends(db)).length, 0);
  eq(await raw(db, BUYER), 0);
});

await test('same day in another shape changes nothing', async () => {
  const db = await fresh();
  const pid = await period(db, await folder(db));
  await as(db, BUYER);
  const id = await addPay(db, pid, { by: BUYER, day: phDate(-2) });
  await db.query(`update payroll set payment_date = $2, total_salary = 1500.00 where id = $1`, [id, phDate(-2) + 'T00:00']);
  const rows = await spends(db);
  eq(rows.length, 1, 'still one spend');
  eq(rows[0].voided, false, 'not voided');
});

await test('an edit that leaves petty_cash_by alone keeps the spend', async () => {
  const db = await fresh();
  const pid = await period(db, await folder(db));
  await as(db, BUYER);
  const id = await addPay(db, pid, { by: BUYER });
  const first = (await spends(db))[0].id;
  await as(db, STAFF);
  await db.query(`update payroll set worker_name = 'Mario R.', notes = 'paid at site' where id = $1`, [id]);
  eq(live(await spends(db)).map(r => r.id), [first]);
});

await test('amount change voids and re-records', async () => {
  const db = await fresh();
  const pid = await period(db, await folder(db));
  await as(db, BUYER);
  const id = await addPay(db, pid, { by: BUYER });
  await as(db, STAFF);   // not a buyer: may still fix the amount
  await db.query(`update payroll set total_salary = 1800 where id = $1`, [id]);
  const rows = await spends(db);
  eq(rows.map(r => [r.amount, r.voided, r.void_reason, r.buyer_id]),
     [[1500, true, 'Payroll entry changed', BUYER], [1800, false, null, BUYER]]);
});

await test('switching to company voids', async () => {
  const db = await fresh();
  const pid = await period(db, await folder(db));
  await as(db, BUYER);
  const id = await addPay(db, pid, { by: BUYER });
  await db.query(`update payroll set petty_cash_by = null where id = $1`, [id]);
  const rows = await spends(db);
  eq(rows.map(r => [r.voided, r.void_reason]), [[true, 'Payroll entry changed']]);
});

await test('delete voids, never deletes', async () => {
  const db = await fresh();
  const pid = await period(db, await folder(db));
  await as(db, BUYER);
  const id = await addPay(db, pid, { by: BUYER });
  await db.query(`delete from payroll where id = $1`, [id]);
  const rows = await spends(db);
  eq(rows.map(r => [r.payroll_id, r.voided, r.void_reason]), [[id, true, 'Payroll entry deleted']]);
});

await test('cascade delete of a billing period voids its spends', async () => {
  const db = await fresh();
  const pid = await period(db, await folder(db));
  await as(db, BUYER);
  await addPay(db, pid, { by: BUYER, amount: 1000 });
  await addPay(db, pid, { by: BUYER, amount: 500 });
  await as(db, OWNER);
  await db.query(`delete from projects where id = $1`, [pid]);
  eq((await spends(db)).map(r => [r.voided, r.void_reason]), [[true, 'Payroll entry deleted'], [true, 'Payroll entry deleted']]);
  eq(await raw(db, BUYER), 0, 'balance back');
});

await test('split rows: one spend each', async () => {
  const db = await fresh();
  const pid = await period(db, await folder(db));
  await as(db, BUYER);
  await addPay(db, pid, { by: BUYER, amount: 1000, split: 'g1' });
  await addPay(db, pid, { by: BUYER, amount: 500, split: 'g1' });
  eq(live(await spends(db)).map(r => [r.amount, r.split_group]), [[1000, 'g1'], [500, 'g1']]);
});

await test('overhead: main owner, project and company scope', async () => {
  const db = await fresh();
  const f = await folder(db);
  await as(db, OWNER);
  const a = await addOh(db, { by: BUYER, folderId: f });
  const b = await addOh(db, { by: BUYER, folderId: null, name: '' });
  const rows = await spends(db);
  eq(rows.map(r => [r.kind, r.overhead_id, r.label, r.place, r.amount]),
     [['overhead', a, 'Diesel for generator', 'Sample Residence', 800], ['overhead', b, 'for the site', 'Company overhead', 800]]);
});

await test('overhead: staff cannot pick another buyer either', async () => {
  const db = await fresh();
  await as(db, BUYER);
  eq(await code(addOh(db, { by: BUYER2 })), 'PERSON_NOT_ALLOWED');
});

await test('overhead soft delete voids, restore re-records', async () => {
  const db = await fresh();
  await as(db, OWNER);
  const id = await addOh(db, { by: BUYER });
  await db.query(`update overhead_expenses set deleted_at = now() where id = $1`, [id]);
  eq((await spends(db)).map(r => [r.voided, r.void_reason]), [[true, 'Overhead entry deleted']]);
  await db.query(`update overhead_expenses set deleted_at = null where id = $1`, [id]);
  const rows = await spends(db);
  eq(rows.length, 2, 'a new record');
  eq(live(rows).map(r => r.overhead_id), [id]);
});

await test('a soft delete cannot slip another person in (review C1)', async () => {
  const db = await fresh();
  await as(db, OWNER);
  const id = await addOh(db, { by: BUYER2, amount: 5000 });
  await as(db, BUYER2);
  eq(await code(db.query(`update overhead_expenses set petty_cash_by = $2 where id = $1`, [id, BUYER])), 'PERSON_NOT_ALLOWED', 'directly');
  await db.query(`update overhead_expenses set deleted_at = now() where id = $1`, [id]);
  eq(await code(db.query(`update overhead_expenses set petty_cash_by = $2 where id = $1`, [id, BUYER])), 'PERSON_NOT_ALLOWED', 'while deleted');
  eq(live(await spends(db, BUYER)).length, 0, 'nothing on Juan');
});

await test('an already-deleted row cannot carry anyone else\'s petty cash (review C1)', async () => {
  const db = await fresh();
  await as(db, BUYER);
  const ins = (by) => db.query(`insert into overhead_expenses (owner_id, scope, expense_name, amount, date, petty_cash_by, deleted_at)
                                values ($1, 'company', 'x', 5000, $2, $3, now())`, [OWNER, phDate(), by]);
  eq(await code(ins(OWNER)), 'NOT_A_BUYER', 'not a holder');
  eq(await code(ins(BUYER2)), 'PERSON_NOT_ALLOWED', 'another buyer');
});

await test('only that buyer or the main owner may take petty cash off a row (review I1)', async () => {
  const db = await fresh();
  const pid = await period(db, await folder(db));
  await as(db, BUYER);
  const a = await addPay(db, pid, { by: BUYER });
  const b = await addPay(db, pid, { by: BUYER });
  for (const who of [BUYER2, STAFF, EXPOWNER]) {
    await as(db, who);
    eq(await code(db.query(`update payroll set petty_cash_by = null where id = $1`, [a])), 'PERSON_NOT_ALLOWED', who);
  }
  eq(live(await spends(db, BUYER)).length, 2, 'both still on Juan');
  await as(db, BUYER);
  await db.query(`update payroll set petty_cash_by = null where id = $1`, [a]);
  await as(db, OWNER);
  await db.query(`update payroll set petty_cash_by = null where id = $1`, [b]);
  eq(live(await spends(db, BUYER)).length, 0, 'the buyer and the main owner may');
  await as(db, BUYER);
  const c = await addPay(db, pid, { by: BUYER });
  await as(db, '');   // the service role (no signed-in user), as profiles_guard allows
  await db.query(`update payroll set petty_cash_by = null where id = $1`, [c]);
  eq(live(await spends(db, BUYER)).length, 0, 'the service role may');
});

await test('one live spend per entry', async () => {
  const db = await fresh();
  const pid = await period(db, await folder(db));
  await as(db, BUYER);
  const id = await addPay(db, pid, { by: BUYER });
  const msg = await code(db.query(`insert into pur_cash_spends (owner_id, buyer_id, amount, spent_on, kind, payroll_id)
                                   values ($1, $2, 5, current_date, 'payroll', $3)`, [OWNER, BUYER, id]));
  assert(/duplicate key|unique/i.test(msg), 'refused: ' + msg);
});

await test('a spend is never deleted or changed in place', async () => {
  const db = await fresh();
  const pid = await period(db, await folder(db));
  await as(db, BUYER);
  const id = await addPay(db, pid, { by: BUYER });
  const sid = (await spends(db))[0].id;
  eq(await code(db.query(`delete from pur_cash_spends where id = $1`, [sid])), 'HISTORY_IMMUTABLE', 'delete');
  eq(await code(db.query(`update pur_cash_spends set amount = 1 where id = $1`, [sid])), 'HISTORY_IMMUTABLE', 'amount');
  await db.query(`delete from payroll where id = $1`, [id]);
  eq(await code(db.query(`update pur_cash_spends set void_reason = 'x' where id = $1`, [sid])), 'HISTORY_IMMUTABLE', 'a voided one');
});

await test('voids count from the day they are made', async () => {
  const db = await fresh();
  const pid = await period(db, await folder(db));
  await as(db, BUYER);
  const id = await addPay(db, pid, { by: BUYER, day: phDate(-3) });
  await db.query(`delete from payroll where id = $1`, [id]);
  eq(await raw(db, BUYER, phDate(-1)), -1500, 'yesterday still shows it');
  eq(await raw(db, BUYER), 0, 'today it is undone');
});

await test('the daily report and the buyer card carry spends', async () => {
  const db = await fresh();
  const pid = await period(db, await folder(db));
  await as(db, BUYER);
  const id = await addPay(db, pid, { by: BUYER, day: phDate(-3) });
  await as(db, OWNER);
  await addOh(db, { by: BUYER, day: phDate(-3) });
  await db.query(`delete from payroll where id = $1`, [id]);
  const rep = (await one(db, `select pur_cash_report($1, $2, $3) r`, [BUYER, phDate(-3), phDate()])).r;
  const d0 = rep.days.find(d => d.day === phDate(-3));
  assert(d0, 'the payment day is listed');
  eq(d0.spends.map(s => [s.kind, num(s.amount), s.label, s.place, s.voided_on]),
     [['payroll', 1500, 'Mario · Mason', 'Sample Residence', phDate()], ['overhead', 800, 'Diesel for generator', 'Company overhead', null]]);
  eq(num(d0.closing), -2300, 'that day\'s closing');
  const today = rep.days.find(d => d.day === phDate());
  eq(today.reversals.map(x => [x.what, x.entry_day, num(x.amount), num(x.effect), x.reason]),
     [['Paid labor', phDate(-3), 1500, 1500, 'Payroll entry deleted']]);
  const card = (await one(db, `select pur_cash_buyer($1) c`, [BUYER])).c;
  eq(card.spends.map(s => [s.kind, num(s.amount), s.void_reason]).sort(),
     [['overhead', 800, null], ['payroll', 1500, 'Payroll entry deleted']]);
  eq(num(card.recorded), -800, 'the card\'s balance');
});

await test('nobody reads the table directly', async () => {
  const db = await fresh();
  await as(db, BUYER);
  await db.exec('set role authenticated');
  const msg = await code(db.query('select * from pur_cash_spends'));
  await db.exec('reset role');
  assert(/permission denied/i.test(msg), 'refused: ' + msg);
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) { console.log('\nFAILURES:\n  ' + failures.join('\n  ')); process.exit(1); }
