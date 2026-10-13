// ════════════════════════════════════════════════════════════════════
// Stage 1c-1 verification §2 — simultaneous use, with TWO real database
// connections (migration 0093). Terms:
// docs/superpowers/specs/2026-10-12-workmate-stage1c1-verification-mvp-terms.md
//
// WHAT IT DOES. Creates throwaway "ZZ 1c conc" projects, a team, tasks and
// blockers (COMMITTED, so both connections can see them), then drives two
// connections through each race in a fixed order: connection A runs its
// RPC and keeps its transaction open; connection B runs the conflicting
// RPC; the script records whether B waited, then lets A finish and checks
// B's outcome and the saved state. Pass = both finish, or one gets a named
// error code; nothing half-saved; never a deadlock (40P01) or a timeout.
//
// SAFETY.
// - Only rows it created, identified by EXACT ids generated here and
//   written to the ledger file BEFORE anything is created. Every name and
//   title starts with "ZZ 1c conc".
// - No storage file is ever committed (Supabase blocks deleting
//   storage.objects rows directly): the photo scenario's upload lives only
//   inside a connection that is always rolled back.
// - Time limits: 20 s per statement, 10 s per lock wait, 60 s idle in a
//   transaction, 120 s for the whole run (then it stops and cleans up).
// - Cleanup runs after success or failure; then a leftover check. If the
//   process or connection dies, run the recovery (below).
// - The connection string is read from an environment variable and is
//   never printed, saved or reported (error text is redacted). Note: any
//   software on the PC can read environment variables while they are set.
//
// RUN (PowerShell, in YOUR terminal — not pasted into chat):
//   1. One-time Postgres client outside the repo:
//        npm install --prefix "$env:TEMP\dacs-pg" pg@8.12.0
//   2. In Supabase: Project Settings → Database → SSL Configuration →
//      "Download certificate" (the Supabase CA, a .crt file). Then
//      Connect → Session pooler (port 5432) → copy the URI, and:
//        $env:DACS_DB_URL = '<paste the URI with the database password>'
//        $env:PG_DIR = "$env:TEMP\dacs-pg"
//        $env:PG_CA = '<full path of the downloaded .crt file>'
//      The connection is encrypted AND the server certificate is verified
//      against that CA (no "accept any certificate" shortcut).
//   3. node supabase/tests/1c_concurrency.mjs
//   4. Remove-Item Env:DACS_DB_URL      (clear the secret from the terminal)
// Use the SESSION pooler or direct connection, never the transaction
// pooler (6543): the test needs each connection to keep its transaction.
//
// RECOVERY (if it stopped before cleaning up):
//   node supabase/tests/1c_concurrency.mjs --cleanup     (uses the ledger)
//   or run supabase/tests/1c_concurrency_cleanup.sql in the SQL editor.
// ════════════════════════════════════════════════════════════════════
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const LEDGER = path.join(ROOT, '.superpowers', '1c_concurrency_ledger.json');
const RESULTS = path.join(ROOT, '.superpowers', '1c_concurrency_results.json');
const DB_URL = process.env.DACS_DB_URL;
const PG_DIR = process.env.PG_DIR;
const PG_CA = process.env.PG_CA;
const CLEANUP_ONLY = process.argv.includes('--cleanup');
const PREFIX = 'ZZ 1c conc';

if (!DB_URL || !PG_DIR || !PG_CA) {
  console.error('Set DACS_DB_URL, PG_DIR and PG_CA first (see the header of this file).');
  process.exit(2);
}
const CA = fs.readFileSync(PG_CA, 'utf8');
const { Client } = createRequire(path.join(PG_DIR, 'index.js'))('pg');

// Never let the secret reach the screen or a file.
const SECRETS = [DB_URL];
try { const u = new URL(DB_URL); if (u.password) SECRETS.push(decodeURIComponent(u.password), u.password); } catch { /* not a URL */ }
const redact = s => SECRETS.reduce((t, x) => (x ? String(t).split(x).join('***') : t), String(s));
const log = (...a) => console.log(...a.map(redact));

const sleep = ms => new Promise(r => setTimeout(r, ms));

function connect(name) {
  return new Client({
    connectionString: DB_URL,
    application_name: '1c_concurrency_' + name,
    statement_timeout: 20000,
    lock_timeout: 10000,
    idle_in_transaction_session_timeout: 60000,
    query_timeout: 25000,
    ssl: { ca: CA, rejectUnauthorized: true },
  });
}

// ── Ledger: exact ids, written before anything is created ──
function newLedger() {
  const t = () => randomUUID();
  return {
    created: new Date().toISOString(),
    folders: { p1: t(), p2: t() },
    team: t(),
    tasks: { A1: t(), B1: t(), C2a: t(), D2a: t(), C2b: t(), D2b: t(), E3: t(), X4: t(), Y4: t(), G5: t(), M5: t() },
    blockers: { BL3a: t(), BL3b: t() },
    ops: { att3a: t(), att3b: t() },
  };
}
function writeLedger(l) { fs.mkdirSync(path.dirname(LEDGER), { recursive: true }); fs.writeFileSync(LEDGER, JSON.stringify(l, null, 2)); }

// ── Cleanup by exact ids, then by prefix inside our own project folders ──
async function cleanup(C, l) {
  const tasks = Object.values(l.tasks), folders = Object.values(l.folders), ops = Object.values(l.ops);
  await C.query('rollback').catch(() => {});
  await C.query('begin');
  try {
    const byPrefix = (await C.query(
      `select id from wp_tasks where title like $1 and folder_id = any($2::uuid[])`, [PREFIX + '%', folders])).rows.map(r => r.id);
    const all = [...new Set([...tasks, ...byPrefix])];
    await C.query('delete from wp_photos where task_id = any($1::uuid[])', [all]);
    await C.query('delete from wp_events where task_id = any($1::uuid[])', [all]);
    await C.query('delete from wp_acks where task_id = any($1::uuid[])', [all]);
    await C.query('delete from wp_blockers where task_id = any($1::uuid[])', [all]);
    await C.query('delete from wp_dependencies where task_id = any($1::uuid[]) or depends_on = any($1::uuid[])', [all]);
    await C.query('delete from wp_task_people where task_id = any($1::uuid[])', [all]);
    await C.query('delete from wp_ops where op_id = any($1::uuid[])', [ops]);
    await C.query('delete from wp_tasks where id = any($1::uuid[])', [all]);
    await C.query('delete from pr_team_members where team_id = $1', [l.team]);
    await C.query('delete from pr_teams where id = $1 and name like $2', [l.team, PREFIX + '%']);
    await C.query('delete from folders where id = any($1::uuid[]) and name like $2', [folders, PREFIX + '%']);
    await C.query('commit');
  } catch (e) {
    await C.query('rollback').catch(() => {});
    throw e;
  }
}

async function leftovers(C, l) {
  const r = await C.query(
    `select (select count(*) from folders where id = any($1::uuid[]) or name like $4)::int as folders,
            (select count(*) from pr_teams where id = $2 or name like $4)::int as teams,
            (select count(*) from wp_tasks where id = any($3::uuid[]) or title like $4)::int as tasks,
            (select count(*) from wp_blockers where task_id = any($3::uuid[]))::int as blockers,
            (select count(*) from wp_dependencies where task_id = any($3::uuid[]) or depends_on = any($3::uuid[]))::int as links,
            (select count(*) from storage.objects where bucket_id = 'task-photos' and name like '%/conc-%')::int as photos`,
    [Object.values(l.folders), l.team, Object.values(l.tasks), PREFIX + '%']);
  return r.rows[0];
}

// ── Accounts (same as the acceptance scripts) ──
async function accounts(C) {
  const one = async (sql) => (await C.query(sql)).rows[0]?.id;
  const w7 = await one(`select id from profiles where worker_no = 7 and role = 'worker' and coalesce(status,'active') = 'active'`);
  const w19 = await one(`select id from profiles where worker_no = 19 and role = 'worker' and coalesce(status,'active') = 'active'`);
  const w21 = await one(`select id from profiles where worker_no = 21 and role = 'teamLeader' and coalesce(status,'active') = 'active'`);
  if (!w7 || !w19 || !w21) throw new Error('W-0007, W-0019 and W-0021 must exist and be active');
  const owner = (await C.query('select coalesce(owner_id, id) as id from profiles where id = $1', [w7])).rows[0].id;
  const staff = (await C.query(`select id from profiles where role = 'staff' and owner_id = $1 and coalesce(status,'active') = 'active' limit 1`, [owner])).rows[0]?.id;
  if (!staff) throw new Error('need an active staff account of the owner');
  return { w7, w19, w21, owner, staff };
}

// ── Throwaway data, committed so both connections see it ──
async function setup(C, l, a) {
  const T = l.tasks, P = l.folders;
  await C.query('begin');
  await C.query(`insert into folders (id, owner_id, name) values ($1, $3, $4), ($2, $3, $5)`,
    [P.p1, P.p2, a.owner, PREFIX + ' project 1', PREFIX + ' project 2']);
  await C.query(`insert into pr_teams (id, owner_id, name) values ($1, $2, $3)`, [l.team, a.owner, PREFIX + ' team']);
  await C.query(`insert into pr_team_members (owner_id, team_id, worker_id, is_leader) values ($1,$2,$3,true), ($1,$2,$4,false), ($1,$2,$5,false)`,
    [a.owner, l.team, a.w21, a.w7, a.w19]);
  const draft = (id, title) => C.query(
    `insert into wp_tasks (id, owner_id, folder_id, work_folder_id, title, created_by) values ($1, $2, $3, $3, $4, $5)`,
    [id, a.owner, P.p1, PREFIX + ' ' + title, a.staff]);
  for (const k of ['A1', 'B1', 'C2a', 'D2a', 'C2b', 'D2b', 'X4', 'Y4', 'G5', 'M5']) await draft(T[k], k);
  for (const k of ['X4', 'Y4']) {
    await C.query(`insert into wp_task_people (owner_id, task_id, person_id, role) values ($1, $2, $3, 'responsible')`, [a.owner, T[k], a.w7]);
  }
  // E3: a published task (W-0019 responsible) with two open blockers.
  await C.query(`insert into wp_tasks (id, owner_id, folder_id, work_folder_id, team_id, title, status, version, version_at, published_at, created_by)
                 values ($1, $2, $3, $3, $4, $5, 'not_started', 1, now(), now(), $6)`,
    [T.E3, a.owner, P.p1, l.team, PREFIX + ' E3', a.staff]);
  await C.query(`insert into wp_task_people (owner_id, task_id, person_id, role) values ($1, $2, $3, 'responsible')`, [a.owner, T.E3, a.w19]);
  for (const k of ['BL3a', 'BL3b']) {
    await C.query(`insert into wp_blockers (id, owner_id, task_id, kind, description, reported_by) values ($1, $2, $3, 'materials', $4, $5)`,
      [l.blockers[k], a.owner, T.E3, PREFIX + ' ' + k, a.w19]);
  }
  await C.query('commit');
}

// ── Two-connection helpers ──
async function begin(client, uid) {
  await client.query('begin');
  if (uid) await asUser(client, uid);
}
async function asUser(client, uid) {
  await client.query('set local role authenticated');
  await client.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: uid, role: 'authenticated' })]);
}
const run = (client, sql, params) =>
  client.query(sql, params).then(r => ({ ok: true, rows: r.rows }), e => ({ ok: false, message: e.message, code: e.code }));

// Did B's call wait on a lock, or finish on its own? (watched from C)
async function watch(C, pid, promise, ms = 3000) {
  let settled = false;
  promise.then(() => { settled = true; });
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (settled) return 'finished';
    const r = await C.query('select wait_event_type from pg_stat_activity where pid = $1', [pid]);
    if (r.rows[0]?.wait_event_type === 'Lock') return 'waiting';
    await sleep(100);
  }
  return settled ? 'finished' : 'unknown';
}

const SAVE = 'select wp_office_save_task($1::uuid, $2::jsonb) as r';
const CANCEL = 'select wp_office_cancel($1::uuid, $2) as r';
const PUBLISH = 'select wp_office_publish(null, $1::uuid[], null, null, null) as r';
const CLEAR = 'select wp_office_clear_blocker($1::uuid, $2) as r';
const ATTACH = 'select wp_attach_photo($1::uuid, $2::uuid, $3::uuid, null, $4) as r';
const badLock = res => !res.ok && (res.code === '40P01' || res.code === '55P03' || res.code === '57014');

const results = [];
function record(name, checks) {
  const pass = checks.every(c => c.ok);
  results.push({ name, pass, checks });
  log((pass ? 'PASS ' : 'FAIL ') + name);
  for (const c of checks) log('   ' + (c.ok ? 'ok   ' : 'FAIL ') + c.what + (c.ok ? '' : ' — got ' + c.got));
}
const chk = (what, ok, got) => ({ what, ok: !!ok, got: got === undefined ? '' : JSON.stringify(got) });

async function scenarios(A, B, C, pidA, pidB, l, a) {
  const T = l.tasks, P = l.folders;
  const reset = async () => { await A.query('rollback').catch(() => {}); await B.query('rollback').catch(() => {}); };

  // S1 — two people save opposite dependencies at once.
  try {
    await begin(A, a.staff);
    const a1 = await run(A, SAVE, [T.A1, { folder_id: P.p1, title: PREFIX + ' A1', depends_on: [T.B1] }]);
    await begin(B, a.staff);
    const pB = run(B, SAVE, [T.B1, { folder_id: P.p1, title: PREFIX + ' B1', depends_on: [T.A1] }]);
    const state = await watch(C, pidB, pB);
    await A.query('commit');
    const b1 = await pB;
    await B.query('rollback');
    const links = (await C.query('select task_id, depends_on from wp_dependencies where task_id = any($1::uuid[])', [[T.A1, T.B1]])).rows;
    record('S1 opposite dependency saves', [
      chk('A saves A1 → B1', a1.ok, a1),
      chk('B waits for A (no deadlock)', state === 'waiting', state),
      chk('B is refused with DEPENDENCY_CYCLE', !b1.ok && b1.message === 'DEPENDENCY_CYCLE', b1),
      chk('no deadlock / timeout', !badLock(b1), b1),
      chk('only A1 → B1 saved', links.length === 1 && links[0].task_id === T.A1 && links[0].depends_on === T.B1, links),
    ]);
  } finally { await reset(); }

  // S2a — link first, then cancel the task being waited for.
  try {
    await begin(A, a.staff);
    const a1 = await run(A, SAVE, [T.C2a, { folder_id: P.p1, title: PREFIX + ' C2a', depends_on: [T.D2a] }]);
    await begin(B, a.staff);
    const pB = run(B, CANCEL, [T.D2a, PREFIX + ' cancel']);
    const state = await watch(C, pidB, pB);
    await A.query('commit');
    const b1 = await pB;
    await B.query('rollback');
    const d = (await C.query('select status from wp_tasks where id = $1', [T.D2a])).rows[0];
    const link = (await C.query('select count(*)::int as n from wp_dependencies where task_id = $1 and depends_on = $2', [T.C2a, T.D2a])).rows[0].n;
    record('S2a link, then cancel', [
      chk('A links C2a → D2a', a1.ok, a1),
      chk('B waits for A', state === 'waiting', state),
      chk('B is refused with HAS_DEPENDENTS', !b1.ok && b1.message === 'HAS_DEPENDENTS', b1),
      chk('no deadlock / timeout', !badLock(b1), b1),
      chk('D2a still a draft, link kept', d?.status === 'draft' && link === 1, { d, link }),
    ]);
  } finally { await reset(); }

  // S2b — cancel first, then link to it.
  try {
    await begin(B, a.staff);
    const b1 = await run(B, CANCEL, [T.D2b, PREFIX + ' cancel']);
    await begin(A, a.staff);
    const pA = run(A, SAVE, [T.C2b, { folder_id: P.p1, title: PREFIX + ' C2b', depends_on: [T.D2b] }]);
    const state = await watch(C, pidA, pA);
    await B.query('commit');
    const a1 = await pA;
    await A.query('rollback');
    const d = (await C.query('select status from wp_tasks where id = $1', [T.D2b])).rows[0];
    const link = (await C.query('select count(*)::int as n from wp_dependencies where depends_on = $1', [T.D2b])).rows[0].n;
    record('S2b cancel, then link', [
      chk('B cancels D2b', b1.ok, b1),
      chk('A waits for B', state === 'waiting', state),
      chk('A is refused with BAD_DEPENDENCY', !a1.ok && a1.message === 'BAD_DEPENDENCY', a1),
      chk('no deadlock / timeout', !badLock(a1), a1),
      chk('D2b cancelled, nothing links to it', d?.status === 'cancelled' && link === 0, { d, link }),
    ]);
  } finally { await reset(); }

  // S3a / S3b — worker attaches a photo to a blocker while the office clears it.
  for (const [label, blocker, op, first] of [['S3a attach, then clear', l.blockers.BL3a, l.ops.att3a, 'attach'],
                                              ['S3b clear, then attach', l.blockers.BL3b, l.ops.att3b, 'clear']]) {
    const photo = `${a.w19}/${T.E3}/conc-${blocker}.jpg`;
    const attachTx = async () => {
      await A.query('begin');
      // the phone's upload — inside A only, always rolled back, never committed
      await A.query(`insert into storage.objects (bucket_id, name, owner) values ('task-photos', $1, $2)`, [photo, a.w19]);
      await asUser(A, a.w19);
      return run(A, ATTACH, [op, T.E3, blocker, photo]);
    };
    const clearTx = async () => { await begin(B, a.staff); return run(B, CLEAR, [blocker, PREFIX + ' checked']); };
    try {
      let firstRes, secondRes, state;
      if (first === 'attach') {
        firstRes = await attachTx();
        await begin(B, a.staff);
        const pB = run(B, CLEAR, [blocker, PREFIX + ' checked']);
        state = await watch(C, pidB, pB);
        secondRes = await pB;
      } else {
        firstRes = await clearTx();
        await A.query('begin');
        await A.query(`insert into storage.objects (bucket_id, name, owner) values ('task-photos', $1, $2)`, [photo, a.w19]);
        await asUser(A, a.w19);
        const pA = run(A, ATTACH, [op, T.E3, blocker, photo]);
        state = await watch(C, pidA, pA);
        secondRes = await pA;
      }
      await B.query('commit');          // the office's clear is kept
      await A.query('rollback');        // the photo (and its storage row) is never kept
      const bl = (await C.query('select cleared_at is not null as cleared from wp_blockers where id = $1', [blocker])).rows[0];
      const stray = (await C.query(`select count(*)::int as n from storage.objects where bucket_id = 'task-photos' and name = $1`, [photo])).rows[0].n;
      record(label, [
        chk('first action succeeds', firstRes.ok, firstRes),
        chk('second action does not wait (compatible locks)', state === 'finished', state),
        chk('second action succeeds', secondRes.ok, secondRes),
        chk('no deadlock / timeout', !badLock(secondRes) && !badLock(firstRes), { firstRes, secondRes }),
        chk('blocker cleared and kept', bl?.cleared === true, bl),
        chk('no storage row left behind', stray === 0, stray),
      ]);
    } finally { await reset(); }
  }

  // S4 — two publishes of the same two tasks in opposite orders.
  try {
    await begin(A, a.staff);
    const a1 = await run(A, PUBLISH, [[T.X4, T.Y4]]);
    await begin(B, a.staff);
    const pB = run(B, PUBLISH, [[T.Y4, T.X4]]);
    const state = await watch(C, pidB, pB);
    await A.query('commit');
    const b1 = await pB;
    await B.query('commit');
    const rows = (await C.query(`select t.id, t.status, t.version,
                                        (select count(*)::int from wp_events e where e.task_id = t.id and e.kind = 'published') as published_events
                                   from wp_tasks t where t.id = any($1::uuid[])`, [[T.X4, T.Y4]])).rows;
    record('S4 overlapping publishes, opposite orders', [
      chk('A publishes both', a1.ok && a1.rows[0].r.published_tasks === 2, a1),
      chk('B waits for A (no deadlock)', state === 'waiting', state),
      chk('B finishes and publishes nothing twice', b1.ok && b1.rows[0].r.published_tasks === 0, b1),
      chk('no deadlock / timeout', !badLock(b1), b1),
      chk('each task published once, version 1', rows.length === 2 && rows.every(r => r.status === 'not_started' && r.version === 1 && r.published_events === 1), rows),
    ]);
  } finally { await reset(); }

  // S5 — move a draft to another project while someone links a task to it.
  try {
    await begin(A, a.staff);
    const a1 = await run(A, SAVE, [T.G5, { folder_id: P.p1, title: PREFIX + ' G5', depends_on: [T.M5] }]);
    await begin(B, a.staff);
    const pB = run(B, SAVE, [T.M5, { folder_id: P.p2, title: PREFIX + ' M5' }]);
    const state = await watch(C, pidB, pB);
    await A.query('commit');
    const b1 = await pB;
    await B.query('rollback');
    const m = (await C.query('select folder_id from wp_tasks where id = $1', [T.M5])).rows[0];
    record('S5 move a draft while it is being linked', [
      chk('A links G5 → M5', a1.ok, a1),
      chk('B waits for A', state === 'waiting', state),
      chk('B is refused with BAD_DEPENDENCY', !b1.ok && b1.message === 'BAD_DEPENDENCY', b1),
      chk('no deadlock / timeout', !badLock(b1), b1),
      chk('M5 stays in project 1', m?.folder_id === P.p1, m),
    ]);
  } finally { await reset(); }
}

// ── Main ──
async function main() {
  const C = connect('observer');
  const A = connect('a');
  const B = connect('b');
  let ledger = null;
  let exitCode = 1;
  const opened = new Set();             // only end clients that actually connected
  const open = async (client) => { await client.connect(); opened.add(client); };
  const kill = setTimeout(() => { log('TIME LIMIT (120 s) reached — stopping; cleanup follows.'); finish(); }, 120000);
  let finishing = false;
  async function finish() {
    if (finishing) return;
    finishing = true;
    try {
      // Close A and B first: that rolls back anything they still hold, so
      // their locks can never block the cleanup.
      await Promise.allSettled([A, B].filter(c => opened.has(c)).map(c => c.end()));
      if (ledger) {
        await cleanup(C, ledger);
        const left = await leftovers(C, ledger);
        const clean = Object.values(left).every(n => n === 0);
        log('Leftover check: ' + JSON.stringify(left) + (clean ? ' — clean' : ' — NOT CLEAN, run the recovery'));
        if (clean) fs.rmSync(LEDGER, { force: true }); else exitCode = 1;
      }
    } catch (e) {
      log('CLEANUP FAILED: ' + e.message + ' — the ledger is kept; run: node supabase/tests/1c_concurrency.mjs --cleanup');
      exitCode = 1;
    } finally {
      clearTimeout(kill);
      fs.mkdirSync(path.dirname(RESULTS), { recursive: true });
      fs.writeFileSync(RESULTS, redact(JSON.stringify({ at: new Date().toISOString(), results }, null, 2)));
      if (opened.has(C)) await Promise.allSettled([C.end()]);
      process.exit(exitCode);
    }
  }
  process.on('SIGINT', () => { log('Interrupted — cleaning up.'); finish(); });

  try {
    await open(C);
    if (CLEANUP_ONLY) {
      if (!fs.existsSync(LEDGER)) { log('No ledger file — nothing recorded to clean. Use 1c_concurrency_cleanup.sql if needed.'); exitCode = 0; }
      else { ledger = JSON.parse(fs.readFileSync(LEDGER, 'utf8')); exitCode = 0; }
      return await finish();
    }
    if (fs.existsSync(LEDGER)) throw new Error('A ledger from an earlier run exists — run with --cleanup first.');
    await open(A);
    await open(B);
    const pidA = (await A.query('select pg_backend_pid() as p')).rows[0].p;
    const pidB = (await B.query('select pg_backend_pid() as p')).rows[0].p;
    const a = await accounts(C);
    ledger = newLedger();
    writeLedger(ledger);                 // ids recorded BEFORE anything is created
    await setup(C, ledger, a);
    await scenarios(A, B, C, pidA, pidB, ledger, a);
    const failed = results.filter(r => !r.pass).length;
    log(`\n${results.length - failed} of ${results.length} scenarios passed.`);
    exitCode = failed ? 1 : 0;
  } catch (e) {
    log('STOPPED: ' + e.message);
    exitCode = 1;
  }
  await finish();
}

main();
