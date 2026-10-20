// ════════════════════════════════════════════════════════════════════
// PM PROFIT SHARING (0098) — TWO FIRST SAVES AT ONCE, REAL POSTGRESQL
//   npm run test:sql
// A throwaway PostgreSQL (embedded-postgres), 0098 VERBATIM. Two owner
// sessions save the SAME project's first split (no agreement row yet,
// both expecting version 0) at the same moment. The project-row lock
// must serialise them: exactly one wins, the other gets STALE, one
// history row, no deadlock.
// ════════════════════════════════════════════════════════════════════
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PM_BASE, IDS, seedProfiles } from './pm_sharing_base.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.DACS_ROOT || path.join(HERE, '..', '..');
const M98 = fs.readFileSync(path.join(ROOT, 'supabase/migrations/0098_pm_profit_sharing.sql'), 'utf8').replace(/\r\n/g, '\n');
const ROUNDS = 15;
let passed = 0, failed = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) { passed++; console.log('  ok  ' + name); }
  else { failed++; failures.push(name + ' — ' + detail); console.log('  FAIL ' + name + '\n       ' + detail); }
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dacs-pmshare-pg-'));
const port = 55000 + Math.floor(Math.random() * 4000);
const server = new EmbeddedPostgres({ databaseDir: dir, user: 'postgres', password: 'pw', port, persistent: false,
  initdbFlags: ['--encoding=UTF8', '--locale=C'], onLog: () => {} });
const cfg = { host: 'localhost', port, user: 'postgres', password: 'pw', database: 'postgres' };

console.log('\nPM profit sharing — two first saves at once (0098 on PostgreSQL)');
await server.initialise();
await server.start();
const admin = new pg.Client(cfg);
await admin.connect();
try {
  await admin.query(PM_BASE);
  await admin.query(M98);
  await seedProfiles((sql) => admin.query(sql));

  const session = async (uid) => {
    const c = new pg.Client(cfg); await c.connect();
    await c.query(`select set_config('test.uid', '${uid}', false)`);
    return c;
  };
  const run = async (c, pid, pct) => {
    try {
      await c.query('begin');
      const r = await c.query(`select pm_set_sharing($1, $2::numeric, 0, 'race') r`, [pid, pct]);
      await c.query('select pg_sleep(0.03)');
      await c.query('commit');
      return { ok: true, r: r.rows[0].r };
    } catch (e) {
      try { await c.query('rollback'); } catch {}
      return { ok: false, code: e.code, msg: e.message };
    }
  };

  let oneWinner = true, staleLoser = true, deadlock = false, history = true, versions = true;
  for (let i = 0; i < ROUNDS; i++) {
    await admin.query(`select set_config('test.uid', '${IDS.OWNER}', false)`);
    const pid = (await admin.query(`insert into construction_projects (project_name, status) values ('race ${i}', 'active') returning id`)).rows[0].id;
    const [a, b] = [await session(IDS.OWNER), await session(IDS.OWNER)];
    const [ra, rb] = await Promise.all([run(a, pid, i % 2 ? '40' : '60'), run(b, pid, '40')]);
    await a.end(); await b.end();
    const wins = [ra, rb].filter(r => r.ok && r.r.changed);
    const losers = [ra, rb].filter(r => !r.ok);
    if (wins.length !== 1) oneWinner = false;
    if (losers.length !== 1 || !losers[0].msg.includes('STALE')) staleLoser = false;
    if ([ra, rb].some(r => r.code === '40P01')) deadlock = true;
    const h = (await admin.query(`select count(*)::int n from pm_sharing_changes where project_id = $1`, [pid])).rows[0].n;
    if (h !== 1) history = false;
    const v = (await admin.query(`select version from pm_sharing_agreements where project_id = $1`, [pid])).rows[0].version;
    if (v !== 1) versions = false;
  }
  check('exactly one first save wins per round', oneWinner, 'a round had 0 or 2 winners');
  check('the other first save gets STALE', staleLoser, 'a loser was not STALE');
  check('no deadlock', !deadlock, '40P01 seen');
  check('exactly one history row per project', history, 'history count ≠ 1');
  check('agreement ends at version 1', versions, 'version ≠ 1');

  // ── Real-role pass: run as `authenticated` with Supabase-like grants ──
  // (privileges on the pm_* tables are NOT granted; only the functions work)
  await admin.query(`grant usage on schema public to authenticated;
    grant select, insert, update on construction_projects, profiles to authenticated;`);
  const asRole = async (uid) => {
    const c = new pg.Client(cfg); await c.connect();
    await c.query('set role authenticated');
    await c.query(`select set_config('test.uid', '${uid}', false)`);
    return c;
  };
  const codeOf = async (c, sql) => {
    try { await c.query(sql); return null; } catch (e) { return e; }
  };
  const own = await asRole(IDS.OWNER);
  let rp = null;
  try {
    rp = (await own.query(`insert into construction_projects (project_name, status) values ('role pass', 'active') returning id`)).rows[0].id;
  } catch (e) { check('(a) authenticated owner inserts a project', false, e.message); }
  if (rp) {
    const map = (await admin.query(`select company_owner_id from pm_project_companies where project_id = $1`, [rp])).rows;
    check('(a) insert as authenticated maps the project', map.length === 1 && map[0].company_owner_id === IDS.OWNER, JSON.stringify(map));
    let sv = null;
    try { sv = (await own.query(`select pm_set_sharing($1, 40, 0, 'role pass') r`, [rp])).rows[0].r; } catch (e) { sv = { err: e.message }; }
    check('(b) pm_set_sharing succeeds as authenticated owner', sv && sv.changed === true, JSON.stringify(sv));
    let rd = null;
    try { rd = (await own.query(`select pm_sharing_read(null) r`)).rows[0].r; } catch (e) { rd = { err: e.message }; }
    check('(c) pm_sharing_read(null) returns the project',
      rd && Array.isArray(rd.projects) && rd.projects.some(x => x.project_id === rp), JSON.stringify(rd).slice(0, 200));
  }
  const eD = await codeOf(own, 'select * from pm_sharing_agreements');
  check('(d) direct select on pm_sharing_agreements fails 42501', eD && eD.code === '42501', eD ? eD.code + ' ' + eD.message : 'no error');
  const eE = await codeOf(own, `insert into pm_project_companies (project_id, company_owner_id, source) values (gen_random_uuid(), '${IDS.OWNER}', 'created')`);
  check('(e) direct insert into pm_project_companies fails 42501', eE && eE.code === '42501', eE ? eE.code + ' ' + eE.message : 'no error');
  await own.end();
  const stf = await asRole(IDS.STAFF);
  const eF = await codeOf(stf, 'select pm_sharing_read(null)');
  check('(f) staff pm_sharing_read raises OWNER_ONLY', eF && /OWNER_ONLY/.test(eF.message), eF ? eF.message : 'no error');
  await stf.end();
} finally {
  await admin.end();
  await server.stop();
  fs.rmSync(dir, { recursive: true, force: true });
}
console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) { console.log(failures.join('\n')); process.exit(1); }
