// ════════════════════════════════════════════════════════════════════
// STAGE 2A-1 PURCHASE RECORDING — TWO SESSIONS AT ONCE, REAL POSTGRESQL
//   npm run test:sql      (runs after 2a1_purchase.pglite.mjs)
//
// PGlite has one connection, so races need a real server: embedded-postgres
// starts a throwaway PostgreSQL on this machine (or the CI runner), loads
// migration 0096 VERBATIM over the same minimal tables, and fires pairs of
// calls on two connections at the same moment. Nothing touches the live DB.
//   1. two purchases on the SAME project        → no deadlock, fund never overspent
//   2. A+B against B+A                          → no deadlock
//   3. the same operation id twice at once      → one purchase, stock once, same answer
//   4. a correction against a new purchase      → no deadlock
//   5. two purchases adding to a NEW stock item → one stock item, both quantities
//   6. two corrections of the SAME purchase      → one after the other, one set of rows
//   7. a correction that waited                 → holds the CURRENT project's lock, not a stale one
//   8. a replacement against a new purchase     → no deadlock, stock never added twice
// ════════════════════════════════════════════════════════════════════
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.DACS_ROOT || path.join(HERE, '..', '..');
const MIG = process.env.DACS_0096 || path.join(ROOT, 'supabase/migrations/0096_purchase_recording.sql');
const read = (p) => fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const fnText = (src, name) => {
  const m = src.match(new RegExp('create or replace function ' + name + '\\s*\\([\\s\\S]*?\\n\\$\\$;', 'i'));
  if (!m) throw new Error('function ' + name + ' not found');
  return m[0];
};
const M02 = read(path.join(ROOT, 'supabase/migrations/0002_rls.sql'));
const M94 = read(path.join(ROOT, 'supabase/migrations/0094_workmate_work_plan_office.sql'));

const OWNER = '00000000-0000-0000-0000-00000000000a';
const ROUNDS = 15;
let passed = 0, failed = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) { passed++; console.log('  ok  ' + name); }
  else { failed++; failures.push(name + ' — ' + detail); console.log('  FAIL ' + name + '\n       ' + detail); }
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dacs-2a1-pg-'));
const port = 55000 + Math.floor(Math.random() * 4000);
const server = new EmbeddedPostgres({ databaseDir: dir, user: 'postgres', password: 'pw', port, persistent: false,
  initdbFlags: ['--encoding=UTF8', '--locale=C'], onLog: () => {} });
const cfg = { host: 'localhost', port, user: 'postgres', password: 'pw', database: 'postgres' };

console.log('\n2A-1 purchase recording — two sessions at once (0096 on PostgreSQL)');
await server.initialise();
await server.start();
const admin = new pg.Client(cfg);
await admin.connect();
try {
  await admin.query(`
create role anon; create role authenticated;
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
${fnText(M94, 'pr_is_office')}
insert into profiles values ('${OWNER}', 'owner', null, 'active', null);`);
  await admin.query(read(MIG));

  const mkFolder = async (name, budget) => {
    const f = (await admin.query(`insert into folders (owner_id, name) values ($1, $2) returning id`, [OWNER, name])).rows[0].id;
    const p = (await admin.query(`insert into projects (owner_id, folder_id, month, year, funding_type, billing_number)
                                  values ($1, $2, 'October', 2026, 'progress', 1) returning id`, [OWNER, f])).rows[0].id;
    await admin.query(`insert into project_budgets values ($1, $2, $3)`, [p, OWNER, budget]);
    await admin.query(`insert into projects (owner_id, folder_id, month, year, funding_type) values ($1, $2, 'October', 2026, 'president')`, [OWNER, f]);
    return f;
  };
  const body = (lines) => JSON.stringify({ purchase_date: '2026-10-14',
    receipt_total: lines.reduce((s, l) => s + l.amount, 0), lines });
  const session = async () => {
    const c = new pg.Client(cfg); await c.connect();
    await c.query(`select set_config('test.uid', '${OWNER}', false)`);
    return c;
  };
  // Two calls, each in its own transaction, released together.
  async function pair(sqlA, argsA, sqlB, argsB) {
    const [a, b] = [await session(), await session()];
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
  const REC = `select pur_record(gen_random_uuid(), $1::jsonb) r`;

  // 1. Same project, both at once: no deadlock, the fund is never overspent.
  {
    const f = await mkFolder('same', 1000);
    let bad = [];
    for (let i = 0; i < ROUNDS; i++) {
      const out = await pair(REC, [body([{ folder_id: f, item_name: 'x', amount: 40 }])], REC, [body([{ folder_id: f, item_name: 'y', amount: 40 }])]);
      bad = bad.concat(out.filter(o => !o.ok).map(o => o.code + ' ' + o.msg));
    }
    check('1. two purchases on the same project: no deadlock, no error', bad.length === 0, JSON.stringify([...new Set(bad)]));
    const t = (await admin.query(`select coalesce(sum(e.amount) filter (where not e.cover_expense), 0) n, coalesce(sum(e.amount) filter (where e.cover_expense), 0) c
                                    from expenses e join projects p on p.id = e.project_id where p.folder_id = $1`, [f])).rows[0];
    check('1. the period gives exactly its ₱1,000, the rest is Cover', Number(t.n) === 1000 && Number(t.c) === ROUNDS * 80 - 1000,
          'non-cover ' + t.n + ', cover ' + t.c);
  }

  // 2. Crossed order: A+B against B+A.
  {
    const a = await mkFolder('A', 100000), b = await mkFolder('B', 100000);
    let bad = [];
    for (let i = 0; i < ROUNDS; i++) {
      const out = await pair(REC, [body([{ folder_id: a, item_name: 'x', amount: 5 }, { folder_id: b, item_name: 'x', amount: 5 }])],
                             REC, [body([{ folder_id: b, item_name: 'y', amount: 5 }, { folder_id: a, item_name: 'y', amount: 5 }])]);
      bad = bad.concat(out.filter(o => !o.ok).map(o => o.code + ' ' + o.msg));
    }
    check('2. A+B against B+A: no deadlock, no error', bad.length === 0, JSON.stringify([...new Set(bad)]));
  }

  // 3. The same operation id twice at once (an overlapping save / interrupted retry).
  {
    const f = await mkFolder('op', 100000);
    let bad = [], same = 0;
    for (let i = 0; i < ROUNDS; i++) {
      const id = '20000000-0000-0000-0000-' + String(i).padStart(12, '0');
      const b = body([{ folder_id: f, item_name: 'Op Stock ' + i, amount: 10, quantity: 4, in_inventory: true }]);
      const out = await pair(`select pur_record($1, $2::jsonb) r`, [id, b], `select pur_record($1, $2::jsonb) r`, [id, b]);
      bad = bad.concat(out.filter(o => !o.ok).map(o => o.code + ' ' + o.msg));
      // Same purchase; exactly one of the two is the replay (marked "replayed").
      if (out.every(o => o.ok) && out[0].r.purchase_id === out[1].r.purchase_id
          && out.filter(o => o.r.replayed === true).length === 1) same++;
    }
    check('3. same operation id at once: both succeed with the same answer', bad.length === 0 && same === ROUNDS,
          'same ' + same + '/' + ROUNDS + ' ' + JSON.stringify([...new Set(bad)]));
    const n = (await admin.query(`select count(*) n from purchase_lines l join purchases pu on pu.id = l.purchase_id where l.folder_id = $1`, [f])).rows[0].n;
    const stock = (await admin.query(`select count(*) n, coalesce(sum(current_stock), 0) s from inventory where item_name like 'Op Stock %'`)).rows[0];
    check('3. recorded once, stock moved once', Number(n) === ROUNDS && Number(stock.n) === ROUNDS && Number(stock.s) === ROUNDS * 4,
          'lines ' + n + ', stock items ' + stock.n + ', stock ' + stock.s);
  }

  // 4. A correction (old project A → new project B, owner) against a new purchase on B then A.
  {
    const a = await mkFolder('CA', 100000), b = await mkFolder('CB', 100000);
    let bad = [];
    for (let i = 0; i < ROUNDS; i++) {
      const rec = (await (async () => { const c = await session(); const r = await c.query(REC, [body([{ folder_id: a, item_name: 'm', amount: 7 }])]); await c.end(); return r.rows[0].r; })());
      const out = await pair(`select pur_correct(gen_random_uuid(), $1, $2::jsonb, 'move') r`, [rec.purchase_id, body([{ folder_id: b, item_name: 'm', amount: 7 }])],
                             REC, [body([{ folder_id: b, item_name: 'n', amount: 3 }, { folder_id: a, item_name: 'n', amount: 3 }])]);
      bad = bad.concat(out.filter(o => !o.ok).map(o => o.code + ' ' + o.msg));
    }
    check('4. a correction against a new purchase: no deadlock, no error', bad.length === 0, JSON.stringify([...new Set(bad)]));
  }

  // 5. Two purchases adding to the same NEW stock item at once.
  {
    const f = await mkFolder('stock', 100000);
    let bad = [];
    for (let i = 0; i < ROUNDS; i++) {
      const name = 'Fresh Item ' + i;
      const out = await pair(REC, [body([{ folder_id: f, item_name: name, amount: 1, quantity: 2, in_inventory: true }])],
                             REC, [body([{ folder_id: f, item_name: name, amount: 1, quantity: 5, in_inventory: true }])]);
      bad = bad.concat(out.filter(o => !o.ok).map(o => o.code + ' ' + o.msg));
    }
    const s = (await admin.query(`select count(*) n, count(distinct item_name) d, coalesce(sum(current_stock), 0) s from inventory where item_name like 'Fresh Item %'`)).rows[0];
    check('5. same new stock item at once: one item each, both quantities', bad.length === 0 && Number(s.n) === ROUNDS && Number(s.d) === ROUNDS && Number(s.s) === ROUNDS * 7,
          'items ' + s.n + ', stock ' + s.s + ' ' + JSON.stringify([...new Set(bad)]));
  }
  // 6. Two corrections of the SAME purchase at once: one after the other,
  //    each on the purchase as the other left it — one set of rows remains.
  {
    const a = await mkFolder('SA', 100000), b = await mkFolder('SB', 100000), c = await mkFolder('SC', 100000);
    let bad = [], clean = 0;
    for (let i = 0; i < ROUNDS; i++) {
      const s0 = await session();
      const rec = (await s0.query(REC, [body([{ folder_id: a, item_name: 'same' + i, amount: 9 }])])).rows[0].r;
      await s0.end();
      const out = await pair(`select pur_correct(gen_random_uuid(), $1, $2::jsonb, 'to B') r`, [rec.purchase_id, body([{ folder_id: b, item_name: 'same' + i, amount: 9 }])],
                             `select pur_correct(gen_random_uuid(), $1, $2::jsonb, 'to C') r`, [rec.purchase_id, body([{ folder_id: c, item_name: 'same' + i, amount: 9 }])]);
      bad = bad.concat(out.filter(o => !o.ok).map(o => o.code + ' ' + o.msg));
      const left = (await admin.query(`select count(*) n, coalesce(sum(e.amount), 0) s, count(distinct p.folder_id) f
                                         from expenses e join purchase_lines l on l.id = e.purchase_line_id
                                         join projects p on p.id = e.project_id where l.purchase_id = $1`, [rec.purchase_id])).rows[0];
      if (Number(left.n) === 1 && Number(left.s) === 9 && Number(left.f) === 1) clean++;
    }
    check('6. two corrections of the same purchase at once: no error, one set of rows left', bad.length === 0 && clean === ROUNDS,
          'clean ' + clean + '/' + ROUNDS + ' ' + JSON.stringify([...new Set(bad)]));
  }

  // 7. A correction that WAITED holds the lock of the purchase's CURRENT
  //    project (the one the first correction moved it to), not a stale one.
  {
    const a = await mkFolder('LA', 100000), b = await mkFolder('LB', 100000), c = await mkFolder('LC', 100000);
    const s0 = await session();
    const rec = (await s0.query(REC, [body([{ folder_id: a, item_name: 'locked', amount: 5 }])])).rows[0].r;
    await s0.end();
    const [t1, t2] = [await session(), await session()];
    const pid2 = (await t2.query('select pg_backend_pid() p')).rows[0].p;
    await t1.query('begin');
    await t1.query(`select pur_correct(gen_random_uuid(), $1, $2::jsonb, 'to B') r`, [rec.purchase_id, body([{ folder_id: b, item_name: 'locked', amount: 5 }])]);
    await t2.query('begin');
    const waiting = t2.query(`select pur_correct(gen_random_uuid(), $1, $2::jsonb, 'to C') r`, [rec.purchase_id, body([{ folder_id: c, item_name: 'locked', amount: 5 }])]);
    await new Promise(r => setTimeout(r, 300));
    await t1.query('commit');
    await waiting;
    const held = async (folder) => Number((await admin.query(
      `select count(*) n from pg_locks l, (select hashtextextended('pur_folder:' || $2, 0) k) x
        where l.locktype = 'advisory' and l.pid = $1 and l.granted
          and l.classid::bigint = ((x.k >> 32) & 4294967295) and l.objid::bigint = (x.k & 4294967295)`, [pid2, folder])).rows[0].n);
    const holdsB = await held(b), holdsC = await held(c), holdsA = await held(a);
    await t2.query('commit');
    await t1.end(); await t2.end();
    check('7. a waiting correction locks the purchase\'s current project (B) and the new one (C), not the stale one (A)',
          holdsB === 1 && holdsC === 1 && holdsA === 0, 'A ' + holdsA + ', B ' + holdsB + ', C ' + holdsC);
  }

  // 8. A replacement against a new purchase on the same project and stock item.
  {
    const f = await mkFolder('RP', 100000);
    let bad = [];
    for (let i = 0; i < ROUNDS; i++) {
      const s0 = await session();
      const rec = (await s0.query(REC, [body([{ folder_id: f, item_name: 'Rep Item ' + i, amount: 4, quantity: 2, in_inventory: true }])])).rows[0].r;
      await s0.end();
      const out = await pair(`select pur_replace(gen_random_uuid(), $1, $2::jsonb, 'add line') r`, [rec.purchase_id,
                               body([{ folder_id: f, item_name: 'Rep Item ' + i, amount: 4, quantity: 2, in_inventory: true }, { folder_id: f, item_name: 'Rep Extra ' + i, amount: 1 }])],
                             REC, [body([{ folder_id: f, item_name: 'Rep Item ' + i, amount: 3, quantity: 5, in_inventory: true }])]);
      bad = bad.concat(out.filter(o => !o.ok).map(o => o.code + ' ' + o.msg));
    }
    const s = (await admin.query(`select count(*) n, coalesce(sum(current_stock), 0) s from inventory where item_name like 'Rep Item %'`)).rows[0];
    check('8. a replacement against a new purchase: no deadlock; stock = first 2 + new 5, never the replaced 2 again',
          bad.length === 0 && Number(s.n) === ROUNDS && Number(s.s) === ROUNDS * 7, 'items ' + s.n + ', stock ' + s.s + ' ' + JSON.stringify([...new Set(bad)]));
  }
} finally {
  await admin.end();
  await server.stop();
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) { console.log('\nFAILURES:\n  ' + failures.join('\n  ')); process.exit(1); }
