// ════════════════════════════════════════════════════════════════════
// Stage 1c-2 — the AI request gate (migration 0095) under SIMULTANEOUS
// requests, with two real database connections plus an observer.
//
// WHAT IT DOES. Puts an account (or the company) exactly one request
// below a limit with COMMITTED rows. Connection A takes the last slot and
// keeps its transaction open; connection B asks at the same moment. Pass =
// B waits (it can never slip past), then is refused when A commits — or
// allowed when A rolls back (an abandoned request gives its slot back);
// never a deadlock (40P01) or a timeout.
//   G1 person, 10-minute drafting limit — A commits    → B refused
//   G2 person, 10-minute drafting limit — A rolls back → B allowed
//   G3 company, rolling 24-hour limit — the owner (A) and the staff
//      account (B) ask for the 300th slot at once     → B refused
//   G0 cleanup removed only what this run recorded
//
// SAFETY.
// - It deletes ONLY rows whose exact ids it recorded. Every usage row it
//   causes is inserted inside a transaction; its id is read back (RETURNING,
//   or currval of the id sequence in the session that inserted it) and
//   written to the ledger BEFORE that transaction commits. Cleanup and
//   recovery delete exactly those ids — nothing is matched by value, time
//   or account.
// - A control row (same account, size and time as the test rows — what a
//   value-based delete would also have hit) is recorded separately. After
//   cleanup the run proves it survived, and that every usage row the test
//   accounts had before the run survived; then it removes the control row
//   by its own id.
// - Time limits: 20 s per statement, 10 s per lock wait, 60 s idle in a
//   transaction, 120 s for the whole run (then it stops and cleans up).
// - If the process dies: node supabase/tests/1c2_ai_gate_concurrency.mjs
//   --cleanup (reads the ledger), or run the generated
//   .superpowers/1c2_ai_gate_recovery.sql (the same exact ids) in the SQL
//   editor. Until cleaned, the recorded rows count against the staff
//   account's and the company's AI limits.
// - The connection string is read from an environment variable and is
//   never printed, saved or reported (error text is redacted).
//
// RUN: the same setup as supabase/tests/1c_concurrency.mjs (DACS_DB_URL,
// PG_DIR, PG_CA; the SESSION pooler), after 0095 is applied:
//   node supabase/tests/1c2_ai_gate_concurrency.mjs
//   Remove-Item Env:DACS_DB_URL
// ════════════════════════════════════════════════════════════════════
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const LEDGER = path.join(ROOT, '.superpowers', '1c2_ai_gate_ledger.json');
const RECOVERY = path.join(ROOT, '.superpowers', '1c2_ai_gate_recovery.sql');
const RESULTS = path.join(ROOT, '.superpowers', '1c2_ai_gate_results.json');
const DB_URL = process.env.DACS_DB_URL;
const PG_DIR = process.env.PG_DIR;
const PG_CA = process.env.PG_CA;
const CLEANUP_ONLY = process.argv.includes('--cleanup');
const CHARS = 100;

if (!DB_URL || !PG_DIR || !PG_CA) {
  console.error('Set DACS_DB_URL, PG_DIR and PG_CA first (see supabase/tests/1c_concurrency.mjs).');
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
    application_name: '1c2_ai_gate_' + name,
    statement_timeout: 20000,
    lock_timeout: 10000,
    idle_in_transaction_session_timeout: 60000,
    query_timeout: 25000,
    ssl: { ca: CA, rejectUnauthorized: true },
  });
}

// ── Ledger: exact ids, written before the row they name is committed ──
function saveLedger(l) {
  fs.mkdirSync(path.dirname(LEDGER), { recursive: true });
  fs.writeFileSync(LEDGER, JSON.stringify(l, null, 2));
  const ids = l.rows.concat(l.control ? [l.control] : []).map(x => String(BigInt(x)));
  fs.writeFileSync(RECOVERY,
    '-- Recovery for supabase/tests/1c2_ai_gate_concurrency.mjs: deletes exactly the rows it recorded.\n' +
    'begin;\n' +
    (ids.length ? 'delete from ai_requests where id in (' + ids.join(', ') + ');\n' : '') +
    'select count(*) as recorded_rows_left from ai_requests where id in (' + (ids.length ? ids.join(', ') : 'null') + ');\n' +
    'commit;\n');
}
function remember(l, id) { l.rows.push(String(id)); saveLedger(l); }
const removed = [];

async function accounts(C) {
  const one = async (sql, p) => (await C.query(sql, p)).rows[0];
  const w7 = (await one(`select id from profiles where worker_no = 7 and role = 'worker' and coalesce(status,'active') = 'active'`))?.id;
  if (!w7) throw new Error('W-0007 must exist and be active');
  const owner = (await one(
    `select p.id from profiles w join profiles p on p.id = coalesce(w.owner_id, w.id)
      where w.id = $1 and p.role = 'owner' and coalesce(p.status,'active') = 'active'
        and coalesce(case when jsonb_typeof(p.allowed_modules) = 'array' and jsonb_array_length(p.allowed_modules) > 0
                          then p.allowed_modules ? 'workplan' end, true)`, [w7]))?.id;
  if (!owner) throw new Error('the owner of W-0007 must be an active owner allowed to draft');
  const staff = (await one(`select id from profiles where role = 'staff' and owner_id = $1 and coalesce(status,'active') = 'active' limit 1`, [owner]))?.id;
  if (!staff) throw new Error('need an active staff account of the owner');
  return { w7, owner, staff };
}

// Delete exactly the recorded rows and prove they are gone.
async function cleanup(C, l) {
  if (l.rows.length) {
    await C.query('delete from ai_requests where id = any($1::bigint[])', [l.rows]);
    const left = (await C.query('select count(*)::int as n from ai_requests where id = any($1::bigint[])', [l.rows])).rows[0].n;
    if (left) throw new Error(left + ' recorded rows are still there');
    removed.push(...l.rows);
  }
  l.rows = [];
  saveLedger(l);
}

const count = async (C, where, params) => (await C.query('select count(*)::int as n from ai_requests where ' + where, params)).rows[0].n;
const personRecent = (C, uid) => count(C, `user_id = $1 and feature = 'work_plan_draft' and created_at > now() - interval '10 minutes'`, [uid]);
const personDay = (C, uid) => count(C, `user_id = $1 and feature = 'work_plan_draft' and created_at > now() - interval '24 hours'`, [uid]);
const companyDay = (C, owner) => count(C, `owner_id = $1 and created_at > now() - interval '24 hours'`, [owner]);

// Insert n rows in one transaction; their ids reach the ledger before commit.
async function addRows(C, l, owner, uid, n) {
  if (n <= 0) return;
  await C.query('begin');
  try {
    const r = await C.query(`insert into ai_requests (owner_id, user_id, feature, input_chars)
                             select $1, $2, 'work_plan_draft', $3 from generate_series(1, $4::int) returning id`, [owner, uid, CHARS, n]);
    r.rows.forEach(x => l.rows.push(String(x.id)));
    saveLedger(l);
    await C.query('commit');
  } catch (e) {
    await C.query('rollback').catch(() => {});
    throw e;
  }
}

// The staff account exactly one draft below its 10-minute limit.
async function personBelow(C, l, a) {
  await cleanup(C, l);
  const used = await personRecent(C, a.staff);
  if (used > 9) throw new Error('the staff account used AI drafting in the last 10 minutes; wait 10 minutes and run again');
  if (await personDay(C, a.staff) + (9 - used) + 2 > 50) throw new Error('the staff account is near its 24-hour drafting limit; run again later');
  if (await companyDay(C, a.owner) + (9 - used) + 2 > 300) throw new Error('the company is near its 24-hour AI limit; run again later');
  await addRows(C, l, a.owner, a.staff, 9 - used);
}

// The company exactly one request below its 24-hour limit, with rows of
// neither racer (W-0007), so only the company limit decides.
async function companyBelow(C, l, a) {
  await cleanup(C, l);
  const used = await companyDay(C, a.owner);
  if (used > 299) throw new Error('the company used 300 AI requests in the last 24 hours; run again later');
  for (const uid of [a.owner, a.staff]) {
    if (await personRecent(C, uid) > 8 || await personDay(C, uid) > 48) throw new Error('a test account is near its own drafting limit; run again later');
  }
  await addRows(C, l, a.owner, a.w7, 299 - used);
}

async function begin(client, uid) {
  await client.query('begin');
  await client.query('set local role authenticated');
  await client.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: uid, role: 'authenticated' })]);
}
const run = (client, sql, params) =>
  client.query(sql, params).then(r => ({ ok: true, rows: r.rows }), e => ({ ok: false, message: e.message, code: e.code }));

// The row ai_authorize() just inserted in THIS session, recorded before commit.
async function rememberOwnRow(client, l) {
  await client.query('reset role');
  const id = (await client.query(`select currval('ai_requests_id_seq')::text as id`)).rows[0].id;
  remember(l, id);
}

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

const AUTH = `select ai_authorize('work_plan_draft', ${CHARS}) as r`;
const badLock = res => !res.ok && (res.code === '40P01' || res.code === '55P03' || res.code === '57014');

const results = [];
function record(name, checks) {
  const pass = checks.every(c => c.ok);
  results.push({ name, pass, checks });
  log((pass ? 'PASS ' : 'FAIL ') + name);
  for (const c of checks) log('   ' + (c.ok ? 'ok   ' : 'FAIL ') + c.what + (c.ok ? '' : ' — got ' + c.got));
}
const chk = (what, ok, got) => ({ what, ok: !!ok, got: got === undefined ? '' : JSON.stringify(got) });

// A takes the last slot and holds its transaction; B asks at the same moment.
async function race(A, B, C, pidB, uidA, uidB, endA, l) {
  await begin(A, uidA);
  const a1 = await run(A, AUTH);
  if (a1.ok) await rememberOwnRow(A, l);
  await begin(B, uidB);
  const pB = run(B, AUTH);
  const state = await watch(C, pidB, pB);
  await A.query(endA);
  const b1 = await pB;
  if (b1.ok) { await rememberOwnRow(B, l); await B.query('commit'); } else await B.query('rollback');
  return { a1, state, b1 };
}

async function scenarios(A, B, C, pidB, l, a) {
  const reset = async () => { await A.query('rollback').catch(() => {}); await B.query('rollback').catch(() => {}); };

  try {
    await personBelow(C, l, a);
    const { a1, state, b1 } = await race(A, B, C, pidB, a.staff, a.staff, 'commit', l);
    const n = await personRecent(C, a.staff);
    record('G1 person 10-minute limit — A takes the last slot and commits while B asks', [
      chk('A takes the 10th slot', a1.ok, a1),
      chk('B waited for A', state === 'waiting', state),
      chk('B is refused AI_RATE_LIMITED', !b1.ok && b1.message === 'AI_RATE_LIMITED', b1),
      chk('exactly 10 drafts in 10 minutes', n === 10, n),
      chk('no deadlock or timeout', !badLock(a1) && !badLock(b1), [a1.code, b1.code]),
    ]);
  } catch (e) { await reset(); record('G1 person 10-minute limit', [chk('ran', false, redact(e.message))]); }

  try {
    await personBelow(C, l, a);
    const { a1, state, b1 } = await race(A, B, C, pidB, a.staff, a.staff, 'rollback', l);
    const n = await personRecent(C, a.staff);
    record('G2 person 10-minute limit — A takes the last slot and rolls back while B asks', [
      chk('A takes the 10th slot', a1.ok, a1),
      chk('B waited for A', state === 'waiting', state),
      chk('B is allowed once A gave the slot back', b1.ok, b1),
      chk('exactly 10 drafts in 10 minutes', n === 10, n),
      chk('no deadlock or timeout', !badLock(a1) && !badLock(b1), [a1.code, b1.code]),
    ]);
  } catch (e) { await reset(); record('G2 person 10-minute limit, rollback', [chk('ran', false, redact(e.message))]); }

  try {
    await companyBelow(C, l, a);
    const { a1, state, b1 } = await race(A, B, C, pidB, a.owner, a.staff, 'commit', l);
    const n = await companyDay(C, a.owner);
    record('G3 company 24-hour limit — the owner and the staff account ask for the 300th slot at once', [
      chk('the owner takes the 300th slot', a1.ok, a1),
      chk('the staff request waited', state === 'waiting', state),
      chk('the staff request is refused AI_RATE_LIMITED', !b1.ok && b1.message === 'AI_RATE_LIMITED', b1),
      chk('exactly 300 requests in 24 hours', n === 300, n),
      chk('no deadlock or timeout', !badLock(a1) && !badLock(b1), [a1.code, b1.code]),
    ]);
  } catch (e) { await reset(); record('G3 company 24-hour limit', [chk('ran', false, redact(e.message))]); }
}

async function main() {
  const C = connect('observer');
  const A = connect('a');
  const B = connect('b');
  let ledger = null;
  let exitCode = 1;
  let cleanupFailed = false;
  const opened = new Set();
  const open = async (client) => { await client.connect(); opened.add(client); };
  const kill = setTimeout(() => { log('TIME LIMIT (120 s) reached — stopping; cleanup follows.'); finish(); }, 120000);
  let finishing = false;
  async function finish() {
    if (finishing) return;
    finishing = true;
    try {
      // Close A and B first: that rolls back anything they still hold.
      await Promise.allSettled([A, B].filter(c => opened.has(c)).map(c => c.end()));
      if (ledger) {
        await cleanup(C, ledger);                        // exactly the recorded ids
        if (ledger.control) {
          if (!CLEANUP_ONLY) {
            const has = async ids => (await C.query('select count(*)::int as n from ai_requests where id = any($1::bigint[])', [ids])).rows[0].n;
            const control = await has([ledger.control]);
            const earlier = await has(ledger.preexisting.length ? ledger.preexisting : ['0']);
            record('G0 cleanup removes only the rows this run recorded', [
              chk('the control row (same account, size and time) survived', control === 1, control),
              chk('every earlier usage row of the test accounts survived', earlier === ledger.preexisting.length,
                  { survived: earlier, expected: ledger.preexisting.length }),
            ]);
          }
          await C.query('delete from ai_requests where id = $1::bigint', [ledger.control]);   // ours, by its own id
          removed.push(ledger.control);
          ledger.control = null;
          saveLedger(ledger);
        }
        fs.rmSync(LEDGER, { force: true });
        fs.rmSync(RECOVERY, { force: true });
        log('Removed exactly these recorded rows: ' + (removed.join(', ') || 'none'));
      }
    } catch (e) {
      log('CLEANUP FAILED: ' + e.message + ' — the ledger is kept; run: node supabase/tests/1c2_ai_gate_concurrency.mjs --cleanup' +
          ' (or .superpowers/1c2_ai_gate_recovery.sql in the SQL editor)');
      cleanupFailed = true;
    } finally {
      clearTimeout(kill);
      if (CLEANUP_ONLY) exitCode = cleanupFailed ? 1 : 0;
      else {
        const failed = results.filter(r => !r.pass).length;
        log(`\n${results.length - failed} of ${results.length} checks passed.`);
        exitCode = !cleanupFailed && results.length === 4 && failed === 0 ? 0 : 1;
      }
      fs.mkdirSync(path.dirname(RESULTS), { recursive: true });
      fs.writeFileSync(RESULTS, redact(JSON.stringify({ at: new Date().toISOString(), removed, results }, null, 2)));
      if (opened.has(C)) await Promise.allSettled([C.end()]);
      process.exit(exitCode);
    }
  }
  process.on('SIGINT', () => { log('Interrupted — cleaning up.'); finish(); });

  try {
    await open(C);
    if (CLEANUP_ONLY) {
      if (!fs.existsSync(LEDGER)) log('No ledger file — nothing recorded to clean.');
      else ledger = JSON.parse(fs.readFileSync(LEDGER, 'utf8'));
      return await finish();
    }
    if (fs.existsSync(LEDGER)) throw new Error('A ledger from an earlier run exists — run with --cleanup first.');
    await open(A);
    await open(B);
    const pidB = (await B.query('select pg_backend_pid() as p')).rows[0].p;
    const a = await accounts(C);
    // Usage rows the test accounts already had (last 29 days): all must survive.
    const preexisting = (await C.query(
      `select id::text from ai_requests where user_id = any($1::uuid[]) and created_at > now() - interval '29 days'`,
      [[a.owner, a.staff, a.w7]])).rows.map(r => r.id);
    ledger = { created: new Date().toISOString(), rows: [], control: null, preexisting };
    saveLedger(ledger);
    // The control row: same account, size and time as the test's rows.
    await C.query('begin');
    const ctl = await C.query(`insert into ai_requests (owner_id, user_id, feature, input_chars)
                               values ($1, $2, 'work_plan_draft', $3) returning id::text`, [a.owner, a.staff, CHARS]);
    ledger.control = ctl.rows[0].id;
    saveLedger(ledger);                                  // recorded BEFORE commit
    await C.query('commit');
    await scenarios(A, B, C, pidB, ledger, a);
  } catch (e) {
    log('STOPPED: ' + e.message);
    await C.query('rollback').catch(() => {});
  }
  await finish();
}

main();
