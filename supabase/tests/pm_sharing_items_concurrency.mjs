// ════════════════════════════════════════════════════════════════════
// PM SHARING PERSONAL ITEMS (0110) — RACES ON REAL POSTGRESQL
//   npm run test:sql
// A throwaway PostgreSQL (embedded-postgres), 0098 + 0110 VERBATIM. Two
// main-owner sessions act on the SAME item at once: the item row lock and
// version check must let exactly one win; the op id must make a doubled
// submission record once. Then a real-role pass as `authenticated`/`anon`.
// ════════════════════════════════════════════════════════════════════
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { PM_BASE, IDS, seedProfiles, M98, M110, STORAGE_STANDIN, SUPABASE_DEFAULT_GRANTS } from './pm_sharing_items_base.mjs';

const ROUNDS = 12;
let passed = 0, failed = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) { passed++; console.log('  ok  ' + name); }
  else { failed++; failures.push(name + ' — ' + detail); console.log('  FAIL ' + name + '\n       ' + detail); }
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dacs-pmsi-pg-'));
const port = 55000 + Math.floor(Math.random() * 4000);
const server = new EmbeddedPostgres({ databaseDir: dir, user: 'postgres', password: 'pw', port, persistent: false,
  initdbFlags: ['--encoding=UTF8', '--locale=C'], onLog: () => {} });
const cfg = { host: 'localhost', port, user: 'postgres', password: 'pw', database: 'postgres' };

const REC = `select pm_si_record($1, $2, 'owner', 'Racer', $3::numeric, '2026-10-01', null, null) r`;
const COR = `select pm_si_correct($1, $2, 1, 'owner', 'Racer', $3::numeric, '2026-10-01', null, null, 'race') r`;
const VOI = `select pm_si_void($1, $2, 1, 'race') r`;

console.log('\nPM sharing personal items — races (0110 on PostgreSQL)');
await server.initialise();
await server.start();
const admin = new pg.Client(cfg);
await admin.connect();
try {
  await admin.query(PM_BASE);
  await admin.query(SUPABASE_DEFAULT_GRANTS);
  await admin.query(STORAGE_STANDIN);
  await admin.query(M98);
  await admin.query(M110);
  await seedProfiles((sql) => admin.query(sql));

  const asOwner = async (sql, params) => {
    await admin.query(`select set_config('test.uid', '${IDS.OWNER}', false)`);
    return (await admin.query(sql, params)).rows[0];
  };
  const pid = (await asOwner(`insert into construction_projects (project_name, status) values ('Race site', 'active') returning id`)).id;
  const newItem = async () => (await asOwner(REC, [randomUUID(), pid, '1000'])).r.item.id;
  const session = async (uid) => {
    const c = new pg.Client(cfg); await c.connect();
    await c.query(`select set_config('test.uid', '${uid}', false)`);
    return c;
  };
  const resultOf = async (promise) => {
    try { return { ok: true, r: (await promise).rows[0].r }; }
    catch (e) { return { ok: false, code: e.code, msg: e.message }; }
  };
  // Hold the first transaction open, start the second, confirm it waits on a lock, then commit the first.
  const pair = async (a, b) => {
    let s1, s2, lockWait = false;
    try {
      s1 = await session(IDS.OWNER);
      s2 = await session(IDS.OWNER);
      await s1.query('begin');
      const first = await resultOf(s1.query(...a));
      await s2.query('begin');
      const pid2 = (await s2.query('select pg_backend_pid() pid')).rows[0].pid;
      let secondDone = false;
      const secondPromise = resultOf(s2.query(...b)).finally(() => { secondDone = true; });
      for (let i = 0; i < 200 && !secondDone; i++) {
        const wait = (await admin.query(`select wait_event_type from pg_stat_activity where pid = $1`, [pid2])).rows[0]?.wait_event_type;
        if (wait === 'Lock') { lockWait = true; break; }
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      await s1.query('commit');
      const second = await secondPromise;
      await s2.query(second.ok ? 'commit' : 'rollback');
      return { out: [first, second], lockWait };
    } catch (e) {
      try { await s1?.query('rollback'); } catch {}
      try { await s2?.query('rollback'); } catch {}
      throw e;
    } finally {
      await Promise.allSettled([s1?.end(), s2?.end()]);
    }
  };
  let deadlock = false;
  const noteDeadlock = (rs) => { if (rs.some(r => r.code === '40P01')) deadlock = true; };

  // 1. Two corrections of version 1 at once.
  let r1 = true;
  for (let i = 0; i < ROUNDS; i++) {
    const id = await newItem();
    const { out: rs, lockWait } = await pair([COR, [randomUUID(), id, '900']], [COR, [randomUUID(), id, '800']]);
    noteDeadlock(rs);
    const v = (await admin.query(`select version, amount from pm_sharing_items where id = $1`, [id])).rows[0];
    if (!lockWait || rs.filter(r => r.ok).length !== 1 || !rs.find(r => !r.ok)?.msg.includes('ITEM_CHANGED')
        || v.version !== 2 || Number(v.amount) !== 900) r1 = false;
  }
  check('two corrections of the same version: one wins, the other ITEM_CHANGED', r1, 'a round broke the rule');

  // 2. A correction races a void.
  let r2 = true;
  for (let i = 0; i < ROUNDS; i++) {
    const id = await newItem();
    const { out: rs, lockWait } = await pair([VOI, [randomUUID(), id]], [COR, [randomUUID(), id, '700']]);
    noteDeadlock(rs);
    const v = (await admin.query(`select status, amount from pm_sharing_items where id = $1`, [id])).rows[0];
    if (!lockWait || !rs[0].ok || rs[1].ok || !/ITEM_VOIDED|ITEM_CHANGED/.test(rs[1].msg)
        || v.status !== 'voided' || Number(v.amount) !== 1000) r2 = false;
  }
  check('void then correction: the void wins, the correction is refused', r2, 'a round broke the rule');

  // 3. The same op id submitted twice at once.
  let r3 = true;
  for (let i = 0; i < ROUNDS; i++) {
    const op = randomUUID();
    const before = Number((await admin.query(`select count(*) n from pm_sharing_items`)).rows[0].n);
    const { out: rs, lockWait } = await pair([REC, [op, pid, '50']], [REC, [op, pid, '50']]);
    noteDeadlock(rs);
    const after = Number((await admin.query(`select count(*) n from pm_sharing_items`)).rows[0].n);
    if (!lockWait || !rs.every(r => r.ok) || rs[0].r.item.id !== rs[1].r.item.id || after !== before + 1) r3 = false;
  }
  check('same op id twice at once: one item, identical results', r3, 'a round broke the rule');
  check('no deadlock in any round', !deadlock, '40P01 seen');

  // ── Real-role pass ──
  await admin.query(`grant usage on schema public to authenticated, anon;
    grant select, insert, update on construction_projects, profiles to authenticated;`);
  const asRole = async (role, uid) => {
    const c = new pg.Client(cfg); await c.connect();
    await c.query('set role ' + role);
    await c.query(`select set_config('test.uid', '${uid}', false)`);
    return c;
  };
  const errOf = async (c, sql, params) => { try { await c.query(sql, params); return null; } catch (e) { return e; } };
  const someId = await newItem();
  const own = await asRole('authenticated', IDS.OWNER);
  let rec = null;
  try { rec = (await own.query(REC, [randomUUID(), pid, '75'])).rows[0].r; } catch (e) { rec = { err: e.message }; }
  check('(a) main owner records through the function as authenticated', rec && rec.item && Number(rec.item.amount) === 75, JSON.stringify(rec));
  let read = null;
  try { read = (await own.query(`select pm_sharing_read(null) r`)).rows[0].r; } catch (e) { read = { err: e.message }; }
  check('(b) main owner reads items through pm_sharing_read', read && Array.isArray(read.items) && read.items.some(x => x.id === someId), JSON.stringify(read).slice(0, 200));
  for (const [label, sql] of [['(c) direct select on pm_sharing_items', 'select * from pm_sharing_items'],
                              ['(d) direct insert into pm_sharing_item_ops', `insert into pm_sharing_item_ops (op_id, company_owner_id, action, actor_id) values (gen_random_uuid(), '${IDS.OWNER}', 'void', '${IDS.OWNER}')`],
                              ['(e) private helper pm_si_json', `select pm_si_json('${someId}')`]]) {
    const e = await errOf(own, sql);
    check(label + ' fails 42501', e && e.code === '42501', e ? e.code + ' ' + e.message : 'no error');
  }
  await own.end();
  const pm = await asRole('authenticated', IDS.PMOWNER);
  const eP = await errOf(pm, REC, [randomUUID(), pid, '1']);
  check('(f) admin-pm@ cannot record (OWNER_ONLY)', eP && /OWNER_ONLY/.test(eP.message), eP ? eP.message : 'no error');
  await pm.end();
  const anon = await asRole('anon', '');
  const eA = await errOf(anon, REC, [randomUUID(), pid, '1']);
  check('(g) anon cannot execute pm_si_record (42501)', eA && eA.code === '42501', eA ? eA.code + ' ' + eA.message : 'no error');
  await anon.end();
} finally {
  await admin.end();
  await server.stop();
  fs.rmSync(dir, { recursive: true, force: true });
}
console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) { console.log(failures.join('\n')); process.exit(1); }
