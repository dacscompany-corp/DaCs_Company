// ════════════════════════════════════════════════════════════════════
// PM SHARING PERSONAL ITEMS (0110) — BEHAVIOUR TESTS ON PGLITE
//   npm run test:sql
// Runs 0098 + 0110 VERBATIM. Spec:
// docs/superpowers/specs/2026-10-31-pm-sharing-personal-items-design.md
// ════════════════════════════════════════════════════════════════════
import { PGlite } from '@electric-sql/pglite';
import { randomUUID } from 'node:crypto';
import { PM_BASE, IDS, seedProfiles, M98, M110, STORAGE_STANDIN, SUPABASE_DEFAULT_GRANTS } from './pm_sharing_items_base.mjs';

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
  await db.exec(SUPABASE_DEFAULT_GRANTS);
  await db.exec(STORAGE_STANDIN);
  await db.exec(M98);
  await db.exec(M110);
  await seedProfiles((sql) => db.exec(sql));
  return db;
}
async function as(db, uid) { await db.exec(`select set_config('test.uid', '${uid || ''}', false)`); }
async function one(db, sql, params = []) { return (await db.query(sql, params)).rows[0]; }
async function err(promise) { try { await promise; return 'no error'; } catch (e) { return e.message; } }
async function count(db, table, where = 'true', params = []) {
  return Number((await one(db, `select count(*)::int n from ${table} where ${where}`, params)).n);
}
async function newProject(db, uid, name) {
  await as(db, uid);
  return (await one(db, `insert into construction_projects (project_name, status) values ($1, 'active') returning id`, [name])).id;
}
const REC = `select pm_si_record($1, $2, $3, $4, $5::numeric, $6::date, $7, $8) r`;
const COR = `select pm_si_correct($1, $2, $3, $4, $5, $6::numeric, $7::date, $8, $9, $10) r`;
const VOI = `select pm_si_void($1, $2, $3, $4) r`;
async function record(db, pid, over = {}) {
  const a = { op: randomUUID(), who: 'owner', name: 'Drill', amount: '10000', day: '2026-10-01', note: null, receipt: null, ...over };
  return (await one(db, REC, [a.op, pid, a.who, a.name, a.amount, a.day, a.note, a.receipt])).r.item;
}
async function setup() {
  const db = await fresh();
  const pid = await newProject(db, I.OWNER, 'Alpha House');
  const pidB = await newProject(db, I.OTHER, 'Other Co');
  await as(db, I.OWNER);
  return { db, pid, pidB };
}
const today = async (db) => (await one(db, `select (now() at time zone 'Asia/Manila')::date::text d`)).d;
const tomorrow = async (db) => (await one(db, `select ((now() at time zone 'Asia/Manila')::date + 1)::text d`)).d;

console.log('\nPM sharing personal items (0110) on PGlite');

await test('S1 main owner records an item: active, version 1, one "recorded" event', async () => {
  const { db, pid } = await setup();
  const it = await record(db, pid, { name: '  Drill  ', note: ' for me ' });
  eq([it.charged_to, it.item_name, Number(it.amount), it.bought_on, it.note, it.status, it.version],
     ['owner', 'Drill', 10000, '2026-10-01', 'for me', 'active', 1]);
  eq(await count(db, 'pm_sharing_item_events', `item_id = $1 and kind = 'recorded'`, [it.id]), 1);
});
await test('S2 partner items and today\'s date are accepted', async () => {
  const { db, pid } = await setup();
  const it = await record(db, pid, { who: 'partner', day: await today(db) });
  eq(it.charged_to, 'partner');
});
await test('S3 focused owner (admin-pm@), staff, other company, signed out: writes refused', async () => {
  const { db, pid } = await setup();
  for (const uid of [I.PMOWNER, I.STAFF, I.CLIENT, I.PARTNER, I.INACT]) {
    await as(db, uid);
    const m = await err(record(db, pid));
    assert(/OWNER_ONLY|INACTIVE/.test(m), uid + ': ' + m);
  }
  await as(db, '');
  assert(/NOT_SIGNED_IN/.test(await err(record(db, pid))), 'signed out');
  await as(db, I.OTHER);
  assert(/WRONG_COMPANY/.test(await err(record(db, pid))), 'other company on our project');
  await as(db, I.OWNER);
  eq(await count(db, 'pm_sharing_items'), 0, 'nothing written');
});
await test('S4 unmapped project → PROJECT_UNMAPPED', async () => {
  const { db } = await setup();
  const loose = (await one(db, `insert into construction_projects (project_name) values ('Loose') returning id`)).id;
  await db.exec(`delete from pm_project_companies where project_id = '${loose}'`);
  assert(/PROJECT_UNMAPPED/.test(await err(record(db, loose))), 'unmapped');
});
await test('S5 field checks: who, name, amount, decimals, date, note, receipt path', async () => {
  const { db, pid } = await setup();
  const cases = [
    [{ who: 'both' }, 'BAD_CHARGED_TO'], [{ who: null }, 'BAD_CHARGED_TO'],
    [{ name: '   ' }, 'BAD_NAME'], [{ name: 'x'.repeat(121) }, 'BAD_NAME'],
    [{ amount: '0' }, 'BAD_AMOUNT'], [{ amount: '-5' }, 'BAD_AMOUNT'], [{ amount: '100000000' }, 'BAD_AMOUNT'],
    [{ amount: '10.005' }, 'BAD_PRECISION'],
    [{ day: await tomorrow(db) }, 'BAD_DATE'], [{ day: null }, 'BAD_DATE'],
    [{ note: 'n'.repeat(501) }, 'BAD_NOTE'],
    [{ receipt: 'expenseReceipts/' + I.OWNER + '/2026-10/' + randomUUID() + '.jpg' }, 'BAD_RECEIPT_PATH'],
    [{ receipt: 'pmSharing/' + I.OTHER + '/2026-10/' + randomUUID() + '.jpg' }, 'BAD_RECEIPT_PATH'],
  ];
  for (const [over, code] of cases) {
    const m = await err(record(db, pid, over));
    assert(m.includes(code), JSON.stringify(over).slice(0, 60) + ' → ' + m);
  }
  const ok = await record(db, pid, { amount: '99999999.99', receipt: 'pmSharing/' + I.OWNER + '/2026-10/' + randomUUID() + '.jpg' });
  eq(Number(ok.amount), 99999999.99);
});
await test('S6 same op id twice → one item, one event, same result; op id reused for another action → OP_REUSED', async () => {
  const { db, pid } = await setup();
  const op = randomUUID();
  const a = await record(db, pid, { op }), b = await record(db, pid, { op });
  eq(a.id, b.id);
  eq(await count(db, 'pm_sharing_items'), 1);
  eq(await count(db, 'pm_sharing_item_events'), 1);
  assert(/OP_REUSED/.test(await err(db.query(VOI, [op, a.id, 1, 'x']))), 'reuse for void');
  assert(/BAD_OP/.test(await err(db.query(REC, [null, pid, 'owner', 'X', '1', '2026-10-01', null, null]))), 'null op');
});
await test('S7 correct: needs reason and current version; writes a "corrected" event with old values', async () => {
  const { db, pid } = await setup();
  const it = await record(db, pid);
  assert(/REASON_REQUIRED/.test(await err(db.query(COR, [randomUUID(), it.id, 1, 'partner', 'Drill', '9000', '2026-10-01', null, null, '  ']))), 'reason');
  assert(/ITEM_CHANGED/.test(await err(db.query(COR, [randomUUID(), it.id, 2, 'partner', 'Drill', '9000', '2026-10-01', null, null, 'typo']))), 'stale');
  const r = (await one(db, COR, [randomUUID(), it.id, 1, 'partner', 'Drill', '9000', '2026-10-01', null, null, 'typo'])).r;
  eq([r.changed, r.item.charged_to, Number(r.item.amount), r.item.version], [true, 'partner', 9000, 2]);
  const ev = await one(db, `select kind, reason, old_values->>'charged_to' o, new_values->>'charged_to' n from pm_sharing_item_events where item_id = $1 and kind = 'corrected'`, [it.id]);
  eq([ev.kind, ev.reason, ev.o, ev.n], ['corrected', 'typo', 'owner', 'partner']);
});
await test('S8 correct with nothing changed → changed:false, no event, version kept', async () => {
  const { db, pid } = await setup();
  const it = await record(db, pid);
  const r = (await one(db, COR, [randomUUID(), it.id, 1, 'owner', 'Drill', '10000.00', '2026-10-01', null, null, 'no-op'])).r;
  eq([r.changed, r.item.version], [false, 1]);
  eq(await count(db, 'pm_sharing_item_events', `kind = 'corrected'`), 0);
});
await test('S9 void: reason + version; then correct/void again → ITEM_VOIDED', async () => {
  const { db, pid } = await setup();
  const it = await record(db, pid);
  assert(/REASON_REQUIRED/.test(await err(db.query(VOI, [randomUUID(), it.id, 1, '']))), 'reason');
  const v = (await one(db, VOI, [randomUUID(), it.id, 1, 'bought by mistake'])).r.item;
  eq([v.status, v.void_reason, v.version], ['voided', 'bought by mistake', 2]);
  assert(/ITEM_VOIDED/.test(await err(db.query(VOI, [randomUUID(), it.id, 2, 'again']))), 'void twice');
  assert(/ITEM_VOIDED/.test(await err(db.query(COR, [randomUUID(), it.id, 2, 'owner', 'Drill', '1', '2026-10-01', null, null, 'x']))), 'correct voided');
  eq(await count(db, 'pm_sharing_items'), 1, 'never deleted');
});
await test('S10 another company\'s owner cannot correct or void our item (NOT_FOUND)', async () => {
  const { db, pid } = await setup();
  const it = await record(db, pid);
  await as(db, I.OTHER);
  assert(/NOT_FOUND/.test(await err(db.query(VOI, [randomUUID(), it.id, 1, 'x']))), 'void');
  assert(/NOT_FOUND/.test(await err(db.query(COR, [randomUUID(), it.id, 1, 'owner', 'X', '1', '2026-10-01', null, null, 'x']))), 'correct');
});
await test('S11 history is append-only', async () => {
  const { db, pid } = await setup();
  await record(db, pid);
  assert(/HISTORY_IMMUTABLE/.test(await err(db.query(`update pm_sharing_item_events set reason = 'x'`))), 'update');
  assert(/HISTORY_IMMUTABLE/.test(await err(db.query(`delete from pm_sharing_item_events`))), 'delete');
});
await test('S12 pm_sharing_read: items for owner-role readers of the company only, with events', async () => {
  const { db, pid, pidB } = await setup();
  const it = await record(db, pid);
  await one(db, VOI, [randomUUID(), it.id, 1, 'mistake']);
  await record(db, pid, { who: 'partner', name: 'Phone', amount: '5000' });
  await as(db, I.OTHER); await record(db, pidB, { name: 'Other co item' });
  for (const uid of [I.OWNER, I.PMOWNER]) {
    await as(db, uid);
    const r = (await one(db, `select pm_sharing_read($1::uuid[]) r`, [[pid]])).r;
    eq(r.items.map(x => x.item_name).sort(), ['Drill', 'Phone'], uid);
    const d = r.items.find(x => x.item_name === 'Drill');
    eq([d.status, d.events.map(e => e.kind)], ['voided', ['recorded', 'voided']], uid + ' events');
    assert(!r.items.some(x => x.item_name === 'Other co item'), 'no other company');
    assert(Array.isArray(r.projects) && Array.isArray(r.history) && Array.isArray(r.partners), 'Release 1 keys kept');
  }
  await as(db, I.STAFF);
  assert(/OWNER_ONLY/.test(await err(db.query(`select pm_sharing_read(null) r`))), 'staff refused');
});
await test('S13 nothing outside the item tables is written (no weekly bill, expense or reserve)', async () => {
  const { db, pid } = await setup();
  const before = await count(db, 'warranty_retentions');
  await record(db, pid);
  eq(await count(db, 'warranty_retentions'), before);
  eq((await one(db, `select count(*)::int n from information_schema.tables where table_name in ('weekly_bills', 'expenses')`)).n, 0,
     'the test DB has no bill/expense tables — 0110 must not need them');
});
await test('S14 privileges: tables and helpers are not granted to clients; write/read functions are', async () => {
  const { db } = await setup();
  const priv = async (sql) => (await one(db, sql)).ok;
  for (const t of ['pm_sharing_items', 'pm_sharing_item_events', 'pm_sharing_item_ops']) {
    eq(await priv(`select has_table_privilege('authenticated', '${t}', 'select') ok`), false, t + ' select');
    eq(await priv(`select has_table_privilege('anon', '${t}', 'insert') ok`), false, t + ' insert');
  }
  for (const f of ['pm_si_json(uuid)', 'pm_si_op_begin(uuid, uuid, text)', 'pm_si_check(uuid, text, text, numeric, date, text)']) {
    eq(await priv(`select has_function_privilege('authenticated', '${f}', 'execute') ok`), false, f);
  }
  for (const f of ['pm_si_record(uuid, uuid, text, text, numeric, date, text, text)',
                   'pm_si_correct(uuid, uuid, int, text, text, numeric, date, text, text, text)',
                   'pm_si_void(uuid, uuid, int, text)', 'pm_sharing_read(uuid[])']) {
    eq(await priv(`select has_function_privilege('authenticated', '${f}', 'execute') ok`), true, f + ' authenticated');
    eq(await priv(`select has_function_privilege('anon', '${f}', 'execute') ok`), false, f + ' anon');
  }
});

await test('S15 receipt files: main owner writes, owner-role reads, nobody else; wrong company/shape refused', async () => {
  const { db } = await setup();
  const good = 'pmSharing/' + I.OWNER + '/2026-10/' + randomUUID() + '.jpg';
  const ok = async (uid, name, write) => { await as(db, uid); return (await one(db, `select pm_si_file_ok($1, $2) ok`, [name, write])).ok; };
  eq([await ok(I.OWNER, good, true), await ok(I.OWNER, good, false)], [true, true], 'main owner');
  eq([await ok(I.PMOWNER, good, true), await ok(I.PMOWNER, good, false)], [false, true], 'admin-pm@ reads only');
  for (const uid of [I.STAFF, I.CLIENT, I.PARTNER, I.OTHER, I.INACT, '']) {
    eq([await ok(uid, good, true), await ok(uid, good, false)], [false, false], 'refused: ' + uid);
  }
  eq(await ok(I.OWNER, 'pmSharing/' + I.OTHER + '/2026-10/' + randomUUID() + '.jpg', false), false, 'other company path');
  eq(await ok(I.OWNER, 'pmSharing/' + I.OWNER + '/x.jpg', true), false, 'bad shape');
  eq(await ok(I.OWNER, 'expenseReceipts/' + I.OWNER + '/2026-10/' + randomUUID() + '.jpg', true), false, 'other folder');
});
console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) { console.log(failures.join('\n')); process.exit(1); }
