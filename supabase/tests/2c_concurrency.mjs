// ════════════════════════════════════════════════════════════════════
// STAGE 2C COST MOVES — TWO SESSIONS AT ONCE, REAL POSTGRESQL
//   npm run test:sql      (runs after 2c_cost.pglite.mjs)
//
// Same approach as 2b_concurrency.mjs: a throwaway PostgreSQL on this
// machine (or the CI runner), migrations 0096 + 0097 + 0101 + 0102 + 0104 +
// 0105 VERBATIM, pairs of calls released at the same moment on two
// connections. Nothing touches the live database.
//   1. an approval while the goods are returned → charged for what was there
//   2. two approvals of one cost move (two tabs) → charged once
//   3. a price fix while a transfer is approved → never a stale value
//   4. a price fix while a warehouse loss is confirmed → never a stale value
//   5. an approval while the movement is reversed → one wins
//   6. two approvals (two items) into one billing period → its budget filled once
//   7. one approval pressed twice (same operation id) → one answer
//   8. a price fix while a warehouse lot's assignment is approved → never stale
//   9. a re-fund while a transfer out of it is approved → never rows moved under it
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

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dacs-2c-pg-'));
const port = 55000 + Math.floor(Math.random() * 4000);
const server = new EmbeddedPostgres({ databaseDir: dir, user: 'postgres', password: 'pw', port, persistent: false,
  initdbFlags: ['--encoding=UTF8', '--locale=C'], onLog: () => {} });
const cfg = { host: 'localhost', port, user: 'postgres', password: 'pw', database: 'postgres' };

console.log('\n2C cost moves — two sessions at once (0096 + 0097 + 0101 + 0102 + 0104 + 0105 on PostgreSQL)');
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

  // 1
  {
    let bad = 0, dead = 0;
    for (let i = 0; i < ROUNDS; i++) {
      const it = await item('C1 ' + i);
      const f = await mkFolder('return ' + i); await mkPeriod(f);
      await stocked(it, 10);
      const is = await call(STAFF, MOVE, [issue(it, f, 4)]);
      const ret = JSON.stringify({ item_id: it, returns_record: is.record_id, quantity: '2', on: TODAY });
      const out = await pair(OWNER, DECIDE, [is.cost_moves[0]], STAFF, MOVE, [ret]);
      if (deadlock(out)) dead++;
      const c = await one(`select approved_quantity q, value v from stk_cost_moves where id = $1`, [is.cost_moves[0]]);
      const back = Number((await one(`select count(*) n from stk_cost_moves where kind = 'back' and to_folder is null and from_folder = $1`, [f])).n);
      // Approval first: 4 charged, the return asks to bring 2 back. Return first: only the 2 still there are charged.
      const ok = out.every(o => o.ok)
        && ((Number(c.q) === 4 && Number(c.v) === 400 && back === 1) || (Number(c.q) === 2 && Number(c.v) === 200 && back === 0))
        && await negatives() === 0 && await fourPlaces(it, [f]);
      if (!ok && bad++ === 0) console.log('       first bad:', JSON.stringify(out));
    }
    check('1. the owner approves while goods are returned: charged for what was there when approved — never for goods already back',
      bad === 0 && dead === 0, `wrong outcome ${bad}, deadlocks ${dead}`);
  }
  // 2
  {
    let bad = 0, dead = 0;
    for (let i = 0; i < ROUNDS; i++) {
      const it = await item('C2 ' + i);
      const f = await mkFolder('double ' + i); await mkPeriod(f);
      await stocked(it, 10);
      const is = await call(STAFF, MOVE, [issue(it, f, 4)]);
      const out = await pair(OWNER, DECIDE, [is.cost_moves[0]], OWNER, DECIDE, [is.cost_moves[0]]);
      if (deadlock(out)) dead++;
      if (out.filter(o => o.ok).length !== 1 || !out.some(o => !o.ok && /BAD_STATE/.test(o.msg)) || await spent(f) !== 400) bad++;
    }
    check('2. two approvals of the same cost move at once (two tabs): charged once',
      bad === 0 && dead === 0, `wrong outcome ${bad}, deadlocks ${dead}`);
  }
  // 3
  {
    let bad = 0, dead = 0;
    for (let i = 0; i < ROUNDS; i++) {
      const it = await item('C3 ' + i);
      const a = await mkFolder('price A ' + i); await mkPeriod(a);
      const b = await mkFolder('price B ' + i); await mkPeriod(b);
      const pid = await record([{ destination: 'project', folder_id: a, item_name: 'Cement', quantity: 10, amount: 1000 }]);
      await call(OWNER, MATCH, [pid, it, '10']);
      await call(STAFF, `select stk_leftover(gen_random_uuid(), $1, 1, '5', 'warehouse', '${TODAY}', '') r`, [pid]);
      const mv = await call(STAFF, MOVE, [issue(it, b, 5)]);
      const out = await pair(OWNER, DECIDE, [mv.cost_moves[0]], OWNER, CORRECT, [pid, priceBody(a, 1200)]);
      if (deadlock(out)) dead++;
      const v = Number((await one(`select coalesce(value, -1) v from stk_cost_moves where id = $1`, [mv.cost_moves[0]])).v);
      // Approval first: the price fix is refused. Price fix first: approved at the new price.
      const ok = out.filter(o => o.ok).length >= 1
        && ((out[0].ok && !out[1].ok && /STOCK_COST_IN_USE/.test(out[1].msg) && v === 500)
            || (out[0].ok && out[1].ok && v === 600))
        && await basisFresh() && await fourPlaces(it, [a, b]);
      if (!ok && bad++ === 0) console.log('       first bad:', JSON.stringify(out));
    }
    check('3. a price fix while the owner approves the leftovers\' transfer: never a cost move valued at a stale price',
      bad === 0 && dead === 0, `wrong outcome ${bad}, deadlocks ${dead}`);
  }
  // 4
  {
    let bad = 0, dead = 0;
    for (let i = 0; i < ROUNDS; i++) {
      const it = await item('C4 ' + i);
      const pid = await stocked(it, 10);
      const cnt = await call(STAFF, COUNT, [JSON.stringify({ item_id: it, at: 'warehouse', counted: '7', reason: 'damaged', on: TODAY })]);
      const out = await pair(OWNER, DECIDE_REC, [cnt.record_id], OWNER, CORRECT, [pid, priceBody(null, 1200)]);
      if (deadlock(out)) dead++;
      const v = Number((await one(`select coalesce(sum(value), -1) v from stk_cost_moves where record_id = $1`, [cnt.record_id])).v);
      const ok = out[0].ok
        && ((!out[1].ok && /STOCK_COST_IN_USE/.test(out[1].msg) && v === 300) || (out[1].ok && v === 360))
        && await basisFresh() && await fourPlaces(it, []);
      if (!ok && bad++ === 0) console.log('       first bad:', JSON.stringify(out));
    }
    check('4. a price fix while a warehouse loss is confirmed: the loss is valued at the price that stands',
      bad === 0 && dead === 0, `wrong outcome ${bad}, deadlocks ${dead}`);
  }
  // 5
  {
    let bad = 0, dead = 0;
    for (let i = 0; i < ROUNDS; i++) {
      const it = await item('C5 ' + i);
      const f = await mkFolder('reverse ' + i); await mkPeriod(f);
      await stocked(it, 10);
      const is = await call(STAFF, MOVE, [issue(it, f, 4)]);
      const out = await pair(OWNER, DECIDE, [is.cost_moves[0]], STAFF, REVERSE, [is.record_id]);
      if (deadlock(out)) dead++;
      const st = (await one(`select status from stk_cost_moves where id = $1`, [is.cost_moves[0]])).status;
      const ok = out.filter(o => o.ok).length === 1
        && ((out[0].ok && /COST_MOVED/.test(out[1].msg) && st === 'approved' && await spent(f) === 400)
            || (out[1].ok && /BAD_STATE/.test(out[0].msg) && st === 'withdrawn' && await spent(f) === 0))
        && await fourPlaces(it, [f]);
      if (!ok && bad++ === 0) console.log('       first bad:', JSON.stringify(out));
    }
    check('5. the owner approves while the movement is reversed: one wins — never a charge for goods that went back',
      bad === 0 && dead === 0, `wrong outcome ${bad}, deadlocks ${dead}`);
  }
  // 6
  {
    let bad = 0, dead = 0;
    for (let i = 0; i < ROUNDS; i++) {
      const it = await item('C6 ' + i), it2 = await item('C6b ' + i);   // two items: only the project's lock is shared
      const f = await mkFolder('budget ' + i);
      const p = (await one(`insert into projects (owner_id, folder_id, month, year, funding_type, billing_number)
                            values ($1, $2, to_char(now() at time zone 'Asia/Manila', 'FMMonth'),
                                    extract(year from now() at time zone 'Asia/Manila')::int, 'progress', 1) returning id`, [OWNER, f])).id;
      await admin.query(`insert into project_budgets values ($1, $2, 500)`, [p, OWNER]);
      await stocked(it, 10); await stocked(it2, 10);
      const i1 = await call(STAFF, MOVE, [issue(it, f, 4)]);
      const i2 = await call(STAFF, MOVE, [issue(it2, f, 4)]);
      const out = await pair(OWNER, DECIDE, [i1.cost_moves[0]], OWNER, DECIDE, [i2.cost_moves[0]]);
      if (deadlock(out)) dead++;
      const inPeriod = Number((await one(`select coalesce(sum(amount), 0) s from expenses where project_id = $1 and not cover_expense`, [p])).s);
      if (!out.every(o => o.ok) || inPeriod !== 500 || await spent(f) !== 800) bad++;
    }
    check('6. two approvals of different items into one billing period at once: the period fills to its budget once, the rest is Cover',
      bad === 0 && dead === 0, `wrong outcome ${bad}, deadlocks ${dead}`);
  }
  // 7
  {
    let bad = 0, dead = 0;
    for (let i = 0; i < ROUNDS; i++) {
      const it = await item('C7 ' + i);
      const f = await mkFolder('press ' + i); await mkPeriod(f);
      await stocked(it, 10);
      const is = await call(STAFF, MOVE, [issue(it, f, 4)]);
      const opId = (await one(`select gen_random_uuid() g`)).g;
      const SAME = `select stk_cost_decide('${opId}', $1, true, 'ok') r`;
      const out = await pair(OWNER, SAME, [is.cost_moves[0]], OWNER, SAME, [is.cost_moves[0]]);
      if (deadlock(out)) dead++;
      if (!out.every(o => o.ok) || out[0].r.cost_move_id !== out[1].r.cost_move_id || await spent(f) !== 400) bad++;
    }
    check('7. the same approval pressed twice at once (one operation id): one answer, charged once',
      bad === 0 && dead === 0, `wrong outcome ${bad}, deadlocks ${dead}`);
  }
  // 8
  {
    let bad = 0, dead = 0;
    for (let i = 0; i < ROUNDS; i++) {
      const it = await item('C8 ' + i);
      const f = await mkFolder('assign price ' + i); await mkPeriod(f);
      const pid = await stocked(it, 10);
      const is = await call(STAFF, MOVE, [issue(it, f, 4)]);
      const out = await pair(OWNER, DECIDE, [is.cost_moves[0]], OWNER, CORRECT, [pid, priceBody(null, 1200)]);
      if (deadlock(out)) dead++;
      const v = Number((await one(`select coalesce(value, -1) v from stk_cost_moves where id = $1`, [is.cost_moves[0]])).v);
      // Approval first: the price fix is refused. Price fix first: approved at the new price (₱1,200 × 4/10).
      const ok = out[0].ok
        && ((!out[1].ok && /STOCK_COST_IN_USE/.test(out[1].msg) && v === 400) || (out[1].ok && v === 480))
        && await basisFresh() && await fourPlaces(it, [f]);
      if (!ok && bad++ === 0) console.log('       first bad:', JSON.stringify(out));
    }
    check('8. a price fix on a warehouse purchase while its assignment is approved: never valued at a stale price',
      bad === 0 && dead === 0, `wrong outcome ${bad}, deadlocks ${dead}`);
  }
  // 9
  {
    let bad = 0, dead = 0;
    const REFUND = `select pur_refund(gen_random_uuid(), $1, 'billing periods re-checked') r`;
    const allocFresh = async () => Number((await one(`select count(*) n from stk_cost_moves c join stk_lots lt on lt.id = c.lot_id
                                                       where c.status = 'approved' and c.reversed_at is null
                                                         and c.basis_alloc is distinct from stk_purchase_alloc(lt.purchase_id)`)).n) === 0;
    for (let i = 0; i < ROUNDS; i++) {
      const it = await item('C9 ' + i);
      const a = await mkFolder('refund A ' + i), b = await mkFolder('refund B ' + i); await mkPeriod(b);
      const p1 = (await one(`insert into projects (owner_id, folder_id, month, year, funding_type, billing_number)
                             values ($1, $2, to_char(now() at time zone 'Asia/Manila', 'FMMonth'),
                                     extract(year from now() at time zone 'Asia/Manila')::int, 'progress', 1) returning id`, [OWNER, a])).id;
      await admin.query(`insert into project_budgets values ($1, $2, 600)`, [p1, OWNER]);
      const pid = await record([{ destination: 'project', folder_id: a, item_name: 'Cement', quantity: 10, amount: 1000 }]);
      await call(OWNER, MATCH, [pid, it, '10']);
      await call(STAFF, `select stk_leftover(gen_random_uuid(), $1, 1, '5', 'warehouse', '${TODAY}', '') r`, [pid]);
      const mv = await call(STAFF, MOVE, [issue(it, b, 2)]);
      const p2 = (await one(`insert into projects (owner_id, folder_id, month, year, funding_type, billing_number)
                             values ($1, $2, to_char(now() at time zone 'Asia/Manila', 'FMMonth'),
                                     extract(year from now() at time zone 'Asia/Manila')::int, 'progress', 2) returning id`, [OWNER, a])).id;
      await admin.query(`insert into project_budgets values ($1, $2, 1000)`, [p2, OWNER]);
      const out = await pair(OWNER, DECIDE, [mv.cost_moves[0]], OWNER, REFUND, [pid]);
      if (deadlock(out)) dead++;
      const cover = Number((await one(`select coalesce(sum(e.amount), 0) s from expenses e join projects p on p.id = e.project_id
                                         where p.folder_id = $1 and e.cover_expense`, [a])).s);
      // Approval first: the re-fund is refused and ₱320 stays on Cover. Re-fund first: no Cover left; approved off the new periods.
      const ok = out[0].ok
        && ((!out[1].ok && /STOCK_COST_FUNDING/.test(out[1].msg) && cover === 320) || (out[1].ok && cover === 0))
        && await allocFresh() && await fourPlaces(it, [a, b]);
      if (!ok && bad++ === 0) console.log('       first bad:', JSON.stringify(out), cover);
    }
    check('9. a re-fund while the owner approves a transfer out of the same purchase: never rows moved under an approved cost move',
      bad === 0 && dead === 0, `wrong outcome ${bad}, deadlocks ${dead}`);
  }
} finally {
  await admin.end();
  await server.stop();
}
console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) { console.log('\nFAILURES:\n  ' + failures.join('\n  ')); process.exit(1); }
