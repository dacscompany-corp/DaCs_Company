// ════════════════════════════════════════════════════════════════════
// PM PROFIT SHARING (0098) — BEHAVIOUR TESTS ON PGLITE
//   npm run test:sql
// Runs migration 0098 VERBATIM over the minimal tables in
// pm_sharing_base.mjs. Nothing here talks to the live database;
// pm_sharing_acceptance.sql repeats the RLS / grant checks live.
// ════════════════════════════════════════════════════════════════════
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PM_BASE, IDS, seedProfiles } from './pm_sharing_base.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.DACS_ROOT || path.join(HERE, '..', '..');
const M98 = fs.readFileSync(path.join(ROOT, 'supabase/migrations/0098_pm_profit_sharing.sql'), 'utf8').replace(/\r\n/g, '\n');
const I = IDS;

let passed = 0, failed = 0;
const failures = [];
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { failed++; failures.push(name + ' — ' + e.message); console.log('  FAIL ' + name + '\n       ' + e.message); }
}
function assert(c, m) { if (!c) throw new Error(m); }
function eq(a, b, m) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error((m || 'not equal') + ': ' + JSON.stringify(a) + ' !== ' + JSON.stringify(b)); }

async function fresh() {
  const db = new PGlite();
  await db.exec(PM_BASE);
  await db.exec(M98);
  await seedProfiles((sql) => db.exec(sql));
  return db;
}
async function as(db, uid) { await db.exec(`select set_config('test.uid', '${uid || ''}', false)`); }
async function one(db, sql, params = []) { return (await db.query(sql, params)).rows[0]; }
async function all(db, sql, params = []) { return (await db.query(sql, params)).rows; }
async function err(promise) { try { await promise; return 'no error'; } catch (e) { return e.message; } }
async function newProject(db, uid, name = 'P', extra = {}) {
  await as(db, uid);
  const r = await one(db, `insert into construction_projects (project_name, client_name, partner_email, status, terminated_at)
                           values ($1, $2, $3, $4, $5) returning id`,
    [name, extra.client || 'Client', extra.partner || null, extra.status || 'active', extra.terminatedAt || null]);
  return r.id;
}
async function mapping(db, pid) { return one(db, `select company_owner_id, source, mapped_by from pm_project_companies where project_id = $1`, [pid]); }

console.log('\nPM profit sharing (0098) on PGlite');

// ── Task 1: company resolution + creation trigger + immutable history ──
await test('T1.1 main owner creates a project → mapped to own company, source created', async () => {
  const db = await fresh();
  const pid = await newProject(db, I.OWNER);
  eq(await mapping(db, pid), { company_owner_id: I.OWNER, source: 'created', mapped_by: I.OWNER });
});
await test('T1.2 focused owner and staff create → mapped to the main owner', async () => {
  const db = await fresh();
  eq((await mapping(db, await newProject(db, I.PMOWNER))).company_owner_id, I.OWNER, 'pm owner');
  eq((await mapping(db, await newProject(db, I.STAFF))).company_owner_id, I.OWNER, 'staff');
});
await test('T1.3 another company maps to itself', async () => {
  const db = await fresh();
  eq((await mapping(db, await newProject(db, I.OTHER))).company_owner_id, I.OTHER);
});
await test('T1.4 invalid company links reject the insert and leave no project', async () => {
  const db = await fresh();
  for (const [uid, code] of [[I.ORPHAN, 'BAD_COMPANY_LINK'], [I.BADLINK, 'BAD_COMPANY_LINK'],
                             [I.LINKPM, 'BAD_COMPANY_LINK'], [I.INACTLINK, 'BAD_COMPANY_LINK'],
                             [I.INACTSTAFF, 'INACTIVE'], [I.INACT, 'INACTIVE'],
                             [I.NOPROFILE, 'PROFILE_MISSING'], [I.CLIENT, 'NOT_OFFICE']]) {
    const msg = await err(newProject(db, uid, 'bad-' + uid));
    assert(msg.includes(code), uid + ' expected ' + code + ', got ' + msg);
  }
  await as(db, '');
  eq(Number((await one(db, `select count(*) n from construction_projects where project_name like 'bad-%'`)).n), 0, 'no rejected project kept');
});
await test('T1.5 no signed-in account (service role) → project kept, left unmapped (D3)', async () => {
  const db = await fresh();
  const pid = await newProject(db, '');
  eq(await mapping(db, pid), undefined);
});
await test('T1.6 history rows cannot be updated or deleted, even by the table owner', async () => {
  const db = await fresh();
  const pid = await newProject(db, I.OWNER);
  await db.query(`insert into pm_sharing_changes (project_id, company_owner_id, old_pct, new_pct, old_was_default, reason, actor_id)
                  values ($1, $2, 50, 40, true, 'r', $2)`, [pid, I.OWNER]);
  assert((await err(db.query(`update pm_sharing_changes set reason = 'x'`))).includes('HISTORY_IMMUTABLE'), 'update');
  assert((await err(db.query(`delete from pm_sharing_changes`))).includes('HISTORY_IMMUTABLE'), 'delete');
});
await test('T1.7 deleting a project removes mapping/agreement but keeps history with its UUID', async () => {
  const db = await fresh();
  const pid = await newProject(db, I.OWNER, 'Gone');
  await db.query(`insert into pm_sharing_agreements (project_id, company_owner_id, partner_pct, version, updated_by)
                  values ($1, $2, 40, 1, $2)`, [pid, I.OWNER]);
  await db.query(`insert into pm_sharing_changes (project_id, project_name_snapshot, company_owner_id, old_pct, new_pct, old_was_default, reason, actor_id)
                  values ($1, 'Gone', $2, 50, 40, true, 'r', $2)`, [pid, I.OWNER]);
  await db.query(`delete from construction_projects where id = $1`, [pid]);
  eq(await mapping(db, pid), undefined, 'mapping gone');
  eq(await one(db, `select 1 x from pm_sharing_agreements where project_id = $1`, [pid]), undefined, 'agreement gone');
  eq(await one(db, `select project_id, project_name_snapshot from pm_sharing_changes where project_id = $1`, [pid]),
     { project_id: pid, project_name_snapshot: 'Gone' }, 'history kept');
});
await test('T1.8 partner_pct column refuses out-of-range values', async () => {
  const db = await fresh();
  const pid = await newProject(db, I.OWNER);
  assert((await err(db.query(`insert into pm_sharing_agreements (project_id, company_owner_id, partner_pct, version, updated_by)
                               values ($1, $2, 100.01, 1, $2)`, [pid, I.OWNER]))) !== 'no error', '100.01 refused');
});

// ── Task 2: pm_set_sharing ──────────────────────────────────────────
async function setShare(db, uid, pid, pct, ver, reason) {
  await as(db, uid);
  return (await one(db, `select pm_set_sharing($1, $2::numeric, $3, $4) r`, [pid, pct, ver, reason])).r;
}
async function agreement(db, pid) {
  const r = await one(db, `select partner_pct::text p, version v from pm_sharing_agreements where project_id = $1`, [pid]);
  return r ? { p: r.p, v: r.v } : null;
}
async function historyCount(db, pid) { return Number((await one(db, `select count(*) n from pm_sharing_changes where project_id = $1`, [pid])).n); }

await test('T2.1 first save from the implicit 50/50 writes agreement v1 + one history row', async () => {
  const db = await fresh();
  const pid = await newProject(db, I.OWNER, 'Alpha', { client: 'Ana' });
  eq(await setShare(db, I.OWNER, pid, '40', 0, 'Agreed 60/40'), { changed: true, version: 1, partner_pct: 40 });
  eq(await agreement(db, pid), { p: '40.00', v: 1 });
  const h = await one(db, `select old_pct::text o, new_pct::text n, old_was_default d, reason, actor_id, actor_email,
                                  project_name_snapshot pn, client_name_snapshot cn, company_owner_id c
                             from pm_sharing_changes where project_id = $1`, [pid]);
  eq(h, { o: '50.00', n: '40.00', d: true, reason: 'Agreed 60/40', actor_id: I.OWNER, actor_email: 'admin@dacs.test',
          pn: 'Alpha', cn: 'Ana', c: I.OWNER });
});
await test('T2.2 saving the same % is a no-op: no version bump, no history', async () => {
  const db = await fresh();
  const pid = await newProject(db, I.OWNER);
  await setShare(db, I.OWNER, pid, '40', 0, 'r');
  eq(await setShare(db, I.OWNER, pid, '40', 1, ''), { changed: false, version: 1, partner_pct: 40 });
  eq(await historyCount(db, pid), 1);
  eq(await setShare(db, I.OWNER, await newProject(db, I.OWNER), '50', 0, null), { changed: false, version: 0, partner_pct: 50 },
     'saving 50 on a default project is a no-op');
});
await test('T2.3 precision: 40.123 refused (never stored as 40.12); 40.12, 0, 100, 33.33 accepted', async () => {
  const db = await fresh();
  const pid = await newProject(db, I.OWNER);
  assert((await err(setShare(db, I.OWNER, pid, '40.123', 0, 'r'))).includes('BAD_PCT'), '40.123');
  eq(await agreement(db, pid), null, 'nothing stored');
  let v = 0;
  for (const p of ['40.12', '0', '100', '33.33']) {
    const r = await setShare(db, I.OWNER, pid, p, v, 'r ' + p);
    assert(r.changed, p + ' accepted'); v = r.version;
  }
  eq(await agreement(db, pid), { p: '33.33', v: 4 });
});
await test('T2.4 invalid values refused: null, NaN, Infinity, -1, 100.01', async () => {
  const db = await fresh();
  const pid = await newProject(db, I.OWNER);
  for (const p of [null, 'NaN', 'Infinity', '-1', '100.01']) {
    assert((await err(setShare(db, I.OWNER, pid, p, 0, 'r'))).includes('BAD_PCT'), String(p));
  }
});
await test('T2.5 reason required, including when leaving the implicit 50/50', async () => {
  const db = await fresh();
  const pid = await newProject(db, I.OWNER);
  for (const r of [null, '', '   ']) {
    assert((await err(setShare(db, I.OWNER, pid, '40', 0, r))).includes('REASON_REQUIRED'), JSON.stringify(r));
  }
});
await test('T2.6 stale version refused', async () => {
  const db = await fresh();
  const pid = await newProject(db, I.OWNER);
  await setShare(db, I.OWNER, pid, '40', 0, 'r');
  assert((await err(setShare(db, I.OWNER, pid, '30', 0, 'r'))).includes('STALE'), 'expected 0 after v1');
  assert((await err(setShare(db, I.OWNER, pid, '30', null, 'r'))).includes('STALE'), 'null version');
});
await test('T2.7 only the main owner writes — focused owner refused even with allowed_modules cleared', async () => {
  const db = await fresh();
  const pid = await newProject(db, I.OWNER);
  for (const [uid, code] of [[I.PMOWNER, 'OWNER_ONLY'], [I.STAFF, 'OWNER_ONLY'], [I.CLIENT, 'OWNER_ONLY'],
                             [I.PARTNER, 'OWNER_ONLY'], [I.INACT, 'INACTIVE'], [I.NOPROFILE, 'PROFILE_MISSING'],
                             [I.BADLINK, 'OWNER_ONLY']]) {
    assert((await err(setShare(db, uid, pid, '40', 0, 'r'))).includes(code), uid + ' → ' + code);
  }
  await as(db, '');
  await db.query(`update profiles set allowed_modules = '[]'::jsonb where id = $1`, [I.PMOWNER]);
  assert((await err(setShare(db, I.PMOWNER, pid, '40', 0, 'r'))).includes('OWNER_ONLY'), 'cleared modules');
  eq(await agreement(db, pid), null, 'nothing written');
});
await test('T2.8 company checks: other company refused, unmapped refused and never mapped', async () => {
  const db = await fresh();
  const pid = await newProject(db, I.OWNER);
  assert((await err(setShare(db, I.OTHER, pid, '40', 0, 'r'))).includes('WRONG_COMPANY'), 'other company');
  const orphan = await newProject(db, '');
  assert((await err(setShare(db, I.OWNER, orphan, '40', 0, 'r'))).includes('PROJECT_UNMAPPED'), 'unmapped');
  eq(await mapping(db, orphan), undefined, 'still unmapped');
  assert((await err(setShare(db, I.OWNER, '00000000-0000-0000-0000-0000000000ff', '40', 0, 'r'))).includes('PROJECT_NOT_FOUND'), 'missing');
});

// ── Task 3: reads ───────────────────────────────────────────────────
async function readAs(db, uid, ids = null) {
  await as(db, uid);
  return (await one(db, `select pm_sharing_read($1::uuid[]) r`, [ids])).r;
}
async function reservesAs(db, uid, ids) {
  await as(db, uid);
  return (await one(db, `select wf_reserves_for($1::uuid[]) r`, [ids])).r;
}

await test('T3.1 owner reads own company: defaults 50/v0, can_edit true; other company invisible', async () => {
  const db = await fresh();
  const a = await newProject(db, I.OWNER);
  const b = await newProject(db, I.OWNER);
  await newProject(db, I.OTHER);
  await setShare(db, I.OWNER, a, '40', 0, 'r');
  const r = await readAs(db, I.OWNER);
  eq(r.can_edit, true);
  const byId = Object.fromEntries(r.projects.map(p => [p.project_id, p]));
  eq(Object.keys(byId).sort(), [a, b].sort(), 'only company A projects');
  eq([byId[a].partner_pct, byId[a].is_default, byId[a].version], [40, false, 1]);
  eq([byId[b].partner_pct, byId[b].is_default, byId[b].version], [50, true, 0]);
  eq(r.history.length, 1);
});
await test('T3.2 focused owner reads the same data with can_edit false', async () => {
  const db = await fresh();
  const a = await newProject(db, I.OWNER);
  await setShare(db, I.OWNER, a, '40', 0, 'r');
  const r = await readAs(db, I.PMOWNER);
  eq(r.can_edit, false);
  eq(r.projects.map(p => p.project_id), [a]);
  eq(r.history.map(h => h.reason), ['r']);
});
await test('T3.3 staff, client, partner, inactive, missing profile and bad link are refused reads', async () => {
  const db = await fresh();
  for (const [uid, code] of [[I.STAFF, 'OWNER_ONLY'], [I.CLIENT, 'OWNER_ONLY'], [I.PARTNER, 'OWNER_ONLY'],
                             [I.INACT, 'INACTIVE'], [I.NOPROFILE, 'PROFILE_MISSING'], [I.BADLINK, 'BAD_COMPANY_LINK']]) {
    assert((await err(readAs(db, uid))).includes(code), uid + ' → ' + code);
  }
});
await test('T3.4 the other company reads nothing of ours, even when it names our ids', async () => {
  const db = await fresh();
  const a = await newProject(db, I.OWNER);
  await setShare(db, I.OWNER, a, '40', 0, 'r');
  const r = await readAs(db, I.OTHER, [a]);
  eq([r.projects.length, r.history.length], [0, 0]);
});
await test('T3.5 partner acceptance facts come from the partner profile only', async () => {
  const db = await fresh();
  const a = await newProject(db, I.OWNER, 'A', { partner: ' Partner@X.test ' });
  const r = await readAs(db, I.OWNER, [a]);
  eq(r.partners.length, 1);
  eq([r.partners[0].email, r.partners[0].accepted, r.partners[0].doc_version], ['partner@x.test', true, 3]);
});
await test('T3.6 wf_reserves_for: owner + focused owner read; other company / staff do not', async () => {
  const db = await fresh();
  const a = await newProject(db, I.OWNER, 'A', { status: 'completed' });
  await as(db, '');
  await db.query(`insert into warranty_retentions (owner_id, project_id, ref_no, status, total_paid, direct_cost, contributed_amount)
                  values ($1, $2, 'WR-1', 'active', 280000, 188950, 4552.5)`, [I.OWNER, a]);
  for (const uid of [I.OWNER, I.PMOWNER]) {
    const r = await reservesAs(db, uid, [a]);
    eq(r.map(x => [x.ref_no, Number(x.contributed_amount), x.deleted]), [['WR-1', 4552.5, false]], uid);
  }
  eq(await reservesAs(db, I.OTHER, [a]), [], 'other company');
  assert((await err(reservesAs(db, I.STAFF, [a]))).includes('OWNER_ONLY'), 'staff');
});
await test('T3.7 wf_reserves_for prefers the live row; a lone deleted row is returned flagged deleted', async () => {
  const db = await fresh();
  const a = await newProject(db, I.OWNER, 'A', { status: 'completed' });
  const b = await newProject(db, I.OWNER, 'B', { status: 'completed' });
  await as(db, '');
  await db.query(`insert into warranty_retentions (owner_id, project_id, ref_no, status, contributed_amount, deleted_at)
                  values ($1, $2, 'OLD', 'active', 1, now()), ($1, $2, 'LIVE', 'active', 2, null),
                         ($1, $3, 'GONE', 'active', 3, now())`, [I.OWNER, a, b]);
  const r = Object.fromEntries((await reservesAs(db, I.OWNER, [a, b])).map(x => [x.project_id, [x.ref_no, x.deleted]]));
  eq(r[a], ['LIVE', false]); eq(r[b], ['GONE', true]);
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) { console.log(failures.join('\n')); process.exit(1); }
