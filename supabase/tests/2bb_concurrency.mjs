// ════════════════════════════════════════════════════════════════════
// STAGE 2B-b — SETTLING A LOST ANSWER: TWO SESSIONS AT ONCE, REAL POSTGRESQL
//   npm run test:sql      (runs after 2bb_phone.pglite.mjs)
//
// Same approach as 2c_concurrency.mjs: a throwaway PostgreSQL on this
// machine (or the CI runner), migrations 0096 + 0097 + 0101 + 0102 + 0104 +
// 0105 + 0106 VERBATIM, two connections. Nothing touches the live database.
// The phone's "Cancel it" (pur_op_cancel) and a stock write with the same
// operation id take the SAME lock (pur_op_begin's):
//   1. a cancel while the original is being recorded waits, then says
//      'recorded' — the write stands, nothing is cancelled
//   2. the original arriving while a cancel holds the lock waits, then is
//      refused OP_CANCELLED — nothing recorded
//   3. both released together (the cancel 0-40 ms late), 15 rounds: always
//      one of those two, never a cancelled id that was also recorded
// ════════════════════════════════════════════════════════════════════
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { prBase, fnText, CATALOG_0085 } from './pr_base.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.DACS_ROOT || path.join(HERE, '..', '..');
const read = (p) => fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const mig = (f) => read(path.join(ROOT, 'supabase/migrations', f));
const M02 = mig('0002_rls.sql');
const M94 = mig('0094_workmate_work_plan_office.sql');

const OWNER = '00000000-0000-0000-0000-00000000000a';
const STAFF = '00000000-0000-0000-0000-00000000000b';
const BUYER = '00000000-0000-0000-0000-000000000011';
const WORKER = '00000000-0000-0000-0000-00000000000c';
const ROUNDS = 15;
const TODAY = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
let passed = 0, failed = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) { passed++; console.log('  ok  ' + name); }
  else { failed++; failures.push(name + ' — ' + detail); console.log('  FAIL ' + name + '\n       ' + detail); }
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dacs-2bb-pg-'));
const port = 55000 + Math.floor(Math.random() * 4000);
const server = new EmbeddedPostgres({ databaseDir: dir, user: 'postgres', password: 'pw', port, persistent: false,
  initdbFlags: ['--encoding=UTF8', '--locale=C'], onLog: () => {} });
const cfg = { host: 'localhost', port, user: 'postgres', password: 'pw', database: 'postgres' };

console.log('\n2B-b settling a lost answer — two sessions at once (0096 + 0097 + 0101 + 0102 + 0104 + 0105 + 0106 on PostgreSQL)');
await server.initialise();
await server.start();
const admin = new pg.Client(cfg);
await admin.connect();
try {
  await admin.query(`
create role anon; create role authenticated; create role service_role;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
create table profiles (id uuid primary key, role text, owner_id uuid, status text, allowed_modules jsonb);
create table folders (id uuid primary key default gen_random_uuid(), owner_id uuid not null, name text not null,
  parent_folder_id uuid references folders(id), completed_at timestamptz, created_at timestamptz default now(), updated_at timestamptz default now());
create table projects (id uuid primary key default gen_random_uuid(), owner_id uuid not null, folder_id uuid references folders(id) on delete cascade,
  month text, year int, funding_type text, billing_number int, created_at timestamptz default now(), updated_at timestamptz default now());
create table project_budgets (project_id uuid primary key references projects(id) on delete cascade, owner_id uuid not null, monthly_budget numeric not null default 0);
create table expenses (id uuid primary key default gen_random_uuid(), owner_id uuid not null, project_id uuid references projects(id) on delete cascade,
  expense_name text, category text, quantity numeric, amount numeric, date_time text, notes text, payment_method text,
  po_image_url text, delivery_receipt_url text, supplier_invoice_url text, payment_receipt_url text,
  in_inventory boolean default false, cover_expense boolean default false, split_group text, split_index int, split_total int,
  client_submission_id uuid, created_at timestamptz default now(), updated_at timestamptz default now());
create table payroll (id uuid primary key default gen_random_uuid(), owner_id uuid not null, project_id uuid references projects(id) on delete cascade, total_salary numeric);
create table inventory (id uuid primary key default gen_random_uuid(), legacy_id text unique, owner_id uuid, item_name text, unit text,
  current_stock numeric, min_stock numeric, notes text, last_updated timestamptz, last_adjusted_by uuid, created_at timestamptz default now());
${fnText(M02, 'auth_role')}
${fnText(M02, 'is_owner')}
${fnText(M02, 'is_staff')}
${fnText(M02, 'data_owner_id')}
${fnText(M02, 'can_access')}
${fnText(M94, 'pr_is_office')}`);
  await admin.query(mig('0096_purchase_recording.sql'));
  await admin.query(prBase(ROOT));
  await admin.query(CATALOG_0085);
  await admin.query(mig('0097_purchasing_office.sql'));
  await admin.query(mig('0101_purchasing_phone.sql'));
  await admin.query(fnText(mig('0098_pm_profit_sharing.sql'), 'pm_main_owner_id'));
  await admin.query(mig('0102_purchase_payments.sql'));
  await admin.query(fnText(mig('0090_workmate_item_history.sql'), 'pr_clean_aliases'));
  await admin.query(mig('0104_stock.sql'));
  await admin.query(mig('0105_stock_cost_moves.sql'));
  // 0106's pr_my_requests reads request tables this harness does not build;
  // its body is not checked here (2bb_phone.pglite.mjs runs it).
  await admin.query(`set check_function_bodies = off`);
  await admin.query(mig('0106_workmate_phone_stock.sql'));
  await admin.query(`set check_function_bodies = on`);
  await admin.query(`insert into profiles (id, role, owner_id, status, display_name) values
    ('${OWNER}', 'owner', null, 'active', 'Owner'), ('${STAFF}', 'staff', '${OWNER}', 'active', 'Ana'),
    ('${BUYER}', 'staff', '${OWNER}', 'active', 'Juan'), ('${WORKER}', 'worker', '${OWNER}', 'active', 'Mark');
    select set_config('test.uid', '${OWNER}', false);
    select pur_set_buyer('${BUYER}', true);
    select stk_set_enabled(true);`);

  const one = async (sql, args) => (await admin.query(sql, args)).rows[0];
  const as = (uid) => admin.query(`select set_config('test.uid', '${uid}', false)`);
  const mkFolder = async (name) => (await one(`insert into folders (owner_id, name) values ($1, $2) returning id`, [OWNER, name])).id;
  const mkPeriod = async (f) => {
    const p = (await one(`insert into projects (owner_id, folder_id, month, year, funding_type, billing_number)
                          values ($1, $2, to_char(now() at time zone 'Asia/Manila', 'FMMonth'),
                                  extract(year from now() at time zone 'Asia/Manila')::int, 'progress', 1) returning id`, [OWNER, f])).id;
    await admin.query(`insert into project_budgets values ($1, $2, 1000000)`, [p, OWNER]);
  };
  const item = async (name) => (await one(`insert into pr_catalog_items (owner_id, name, unit) values ($1, $2, 'bag') returning id`, [OWNER, name])).id;
  const purchase = (lines) => JSON.stringify({ source: 'purchasing', purchase_date: TODAY, receipt_total: lines.reduce((s, l) => s + l.amount, 0),
    lines: lines.map(l => ({ category: 'Materials', unit: 'bag', unplanned_reason: 'test', ...l })) });
  const record = async (lines) => {
    await as(BUYER);
    return (await one(`select pur_record(gen_random_uuid(), $1::jsonb) r`, [purchase(lines)])).r.purchase_id;
  };
  const call = async (uid, sql, args) => { await as(uid); return (await one(sql, args)).r; };
  const MATCH = `select stk_match(gen_random_uuid(), $1, 1, $2, $3, null) r`;
  const RECEIVE = `select stk_receive(gen_random_uuid(), $1, 1, $2, '${TODAY}', '') r`;
  const MOVE = `select stk_move(gen_random_uuid(), $1::jsonb) r`;
  const stocked = async (it, qty) => {
    const pid = await record([{ destination: 'warehouse', item_name: 'Cement', quantity: qty, amount: qty * 100 }]);
    await call(OWNER, MATCH, [pid, it, String(qty)]);
    await call(BUYER, RECEIVE, [pid, String(qty)]);
    return pid;
  };
  const issue = (it, f, qty, extra = {}) => JSON.stringify({ item_id: it, from: 'warehouse', to: f, quantity: String(qty), on: TODAY,
                                                             unplanned_reason: 'test', ...extra });
  const bal = async (it, where) => Number((await one(`select coalesce(sum(stk_balance(lt.id, l.id)), 0) b from stk_lots lt, stk_locations l
                                                      where lt.item_id = $1 and l.owner_id = $2 and
                                                            (case when $3 = 'warehouse' then l.kind = 'warehouse' else l.folder_id::text = $3 end)`,
                                                     [it, OWNER, where])).b);
  const negatives = async () => Number((await one(`select count(*) n from stk_balances($1) where quantity < 0`, [OWNER])).n);

  const session = async (uid) => {
    const c = new pg.Client(cfg); await c.connect();
    await c.query(`select set_config('test.uid', '${uid}', false)`);
    return c;
  };
  async function pair(uidA, sqlA, argsA, uidB, sqlB, argsB) {
    const [a, b] = [await session(uidA), await session(uidB)];
    const run = async (c, sql, args) => {
      try {
        await c.query('begin');
        const r = await c.query(sql, args);
        await c.query('select pg_sleep(0.03)');
        await c.query('commit');
        return { ok: true, r: r.rows[0] && r.rows[0].r };
      } catch (e) {
        try { await c.query('rollback'); } catch {}
        return { ok: false, code: e.code, msg: e.message };
      }
    };
    const out = await Promise.all([run(a, sqlA, argsA), run(b, sqlB, argsB)]);
    await a.end(); await b.end();
    return out;
  }
  const deadlock = (out) => out.some(o => !o.ok && o.code === '40P01');

  const DECIDE = `select stk_cost_decide(gen_random_uuid(), $1, true, 'ok') r`;
  const CORRECT = `select pur_correct(gen_random_uuid(), $1, $2::jsonb, 'price') r`;
  const DECIDE_REC = `select stk_decide(gen_random_uuid(), $1, true, 'ok') r`;
  const REVERSE = `select stk_reverse(gen_random_uuid(), $1, 'wrong') r`;
  const COUNT = `select stk_count(gen_random_uuid(), $1::jsonb) r`;
  const spent = async (f) => Number((await one(`select coalesce(sum(e.amount), 0) s from expenses e left join projects p on p.id = e.project_id
                                                where coalesce(e.folder_id, p.folder_id) = $1`, [f])).s);
  const held = async (lot, h) => (await one(`select value v, quantity q from stk_held($1, $2)`, [lot, h]));
  const lotOf = async (pid) => (await one(`select id from stk_lots where purchase_id = $1`, [pid])).id;
  // Every lot's cost is in exactly one place, and each project's Spent is the stock cost it holds.
  const fourPlaces = async (it, folders) => {
    const lots = (await admin.query(`select lt.id, b.value v from stk_lots lt cross join lateral stk_lot_basis(lt.id) b
                                       where not lt.untraced and lt.item_id = $1`, [it])).rows;
    for (const l of lots) {
      let sum = Number((await held(l.id, null)).v)
        + Number((await one(`select coalesce(sum(value), 0) v from stk_cost_moves where lot_id = $1 and kind = 'loss'
                             and status = 'approved' and reversed_at is null`, [l.id])).v);
      for (const f of folders) sum += Number((await held(l.id, f)).v);
      if (Math.round(sum * 100) !== Math.round(Number(l.v) * 100)) return false;
    }
    for (const f of folders) {
      let h = 0;
      for (const l of lots) h += Number((await held(l.id, f)).v);
      if (Math.round(h * 100) !== Math.round(await spent(f) * 100)) return false;
    }
    return true;
  };
  // Every approved, unreversed cost move is valued at its lot's CURRENT price and quantity.
  const basisFresh = async () => Number((await one(`select count(*) n from stk_cost_moves c cross join lateral stk_lot_basis(c.lot_id) b
                                                     where c.status = 'approved' and c.reversed_at is null
                                                       and (c.basis_value <> b.value or c.basis_quantity <> b.quantity)`)).n) === 0;
  const priceBody = (f, amount) => JSON.stringify({ source: 'purchasing', purchase_date: TODAY, receipt_total: amount, supplier: 'Wilcon',
    lines: [{ destination: f ? 'project' : 'warehouse', folder_id: f || undefined, item_name: 'Cement', category: 'Materials', unit: 'bag',
              quantity: 10, amount, unplanned_reason: 'test' }] });

  const opMove = (id, it, f, qty) => ({ sql: `select stk_move($1, $2::jsonb) r`, args: [id, issue(it, f, qty)] });
  const CANCEL = `select pur_op_cancel($1) r`;
  const issued = async (it) => Number((await one(`select count(*) n from stk_records r where r.kind = 'issue' and r.item_id = $1`, [it])).n);
  const state = async (uid, id) => call(uid, `select pur_op_state($1) r`, [id]);
  // Has [p] settled within [ms]? (false = still waiting on a lock)
  const settled = (p, ms) => Promise.race([p.then(() => true, () => true), new Promise((r) => setTimeout(() => r(false), ms))]);
  const fails = async (p) => { try { await p; return null; } catch (e) { return e.message; } };

  // 1
  {
    let bad = 0;
    for (let i = 0; i < ROUNDS; i++) {
      const it = await item('B1 ' + i);
      const f = await mkFolder('cancel late ' + i); await mkPeriod(f);
      await stocked(it, 10);
      const id = (await one(`select gen_random_uuid() id`)).id;
      const [a, b] = [await session(BUYER), await session(BUYER)];
      await a.query('begin');
      const m = opMove(id, it, f, 4);
      await a.query(m.sql, m.args);                         // recorded, not yet committed: A holds the lock
      const cancel = b.query(CANCEL, [id]);
      const waited = !(await settled(cancel, 300));
      await a.query('commit');
      const answer = (await cancel).rows[0].r;
      await a.end(); await b.end();
      const ok = waited && answer === 'recorded' && await issued(it) === 1 && await state(BUYER, id) === 'recorded';
      if (!ok && bad++ === 0) console.log('       first bad:', waited, answer);
    }
    check('1. a cancel while the original is being recorded waits for it, then says recorded (the record stands)', bad === 0, `wrong outcome ${bad}`);
  }

  // 2
  {
    let bad = 0;
    for (let i = 0; i < ROUNDS; i++) {
      const it = await item('B2 ' + i);
      const f = await mkFolder('original late ' + i); await mkPeriod(f);
      await stocked(it, 10);
      const id = (await one(`select gen_random_uuid() id`)).id;
      const [a, b] = [await session(BUYER), await session(BUYER)];
      await b.query('begin');
      const first = (await b.query(CANCEL, [id])).rows[0].r;  // cancelled, not yet committed: B holds the lock
      const m = opMove(id, it, f, 4);
      const late = fails(a.query(m.sql, m.args));
      const waited = !(await settled(late, 300));
      await b.query('commit');
      const err = await late;
      await a.end(); await b.end();
      const ok = first === 'cancelled' && waited && /OP_CANCELLED/.test(err || '') && await issued(it) === 0
        && await state(BUYER, id) === 'cancelled';
      if (!ok && bad++ === 0) console.log('       first bad:', first, waited, err);
    }
    check('2. the original arriving while the cancel holds the lock waits, then is refused OP_CANCELLED (nothing recorded)', bad === 0, `wrong outcome ${bad}`);
  }

  // 3
  {
    let bad = 0, dead = 0, rec = 0, can = 0;
    for (let i = 0; i < ROUNDS; i++) {
      const it = await item('B3 ' + i);
      const f = await mkFolder('race ' + i); await mkPeriod(f);
      await stocked(it, 10);
      const id = (await one(`select gen_random_uuid() id`)).id;
      const m = opMove(id, it, f, 4);
      // The cancel starts 0, 10, 20 or 40 ms late, so both orders happen.
      const delay = [0, 0.01, 0.02, 0.04][i % 4];
      const out = await pair(BUYER, m.sql, m.args, BUYER, `select (select pur_op_cancel($1) from (select pg_sleep(${delay})) s) r`, [id]);
      if (deadlock(out)) dead++;
      const n = await issued(it);
      const recorded = out[0].ok && out[1].ok && out[1].r === 'recorded' && n === 1;
      const cancelled = !out[0].ok && /OP_CANCELLED/.test(out[0].msg) && out[1].ok && out[1].r === 'cancelled' && n === 0;
      if (recorded) rec++;
      if (cancelled) can++;
      if (!(recorded || cancelled) && bad++ === 0) console.log('       first bad:', JSON.stringify(out), n);
    }
    check(`3. a write and a cancel released together: recorded-and-reported or cancelled-and-refused, never both (${rec} recorded, ${can} cancelled)`,
      bad === 0 && dead === 0, `wrong outcome ${bad}, deadlocks ${dead}`);
  }
} finally {
  await admin.end();
  await server.stop();
}
console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) { console.log('\nFAILURES:\n  ' + failures.join('\n  ')); process.exit(1); }
