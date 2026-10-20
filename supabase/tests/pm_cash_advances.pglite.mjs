// ════════════════════════════════════════════════════════════════════
// PM WORKER CASH ADVANCES (0100) — BEHAVIOUR TESTS ON PGLITE
//   npm run test:sql
// Runs 0098 + 0100 VERBATIM. Rules R1–R16 are the spec's §4:
// docs/superpowers/specs/2026-10-19-worker-cash-advances-design.md
// ════════════════════════════════════════════════════════════════════
import { PGlite } from '@electric-sql/pglite';
import { randomUUID } from 'node:crypto';
import { PM_BASE, IDS, seedProfiles, M98, M100, PAYROLL_STANDIN, SUPABASE_DEFAULT_GRANTS } from './pm_cash_advances_base.mjs';

const I = IDS;
let passed = 0, failed = 0;
const failures = [];
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { failed++; failures.push(name + ' — ' + e.message); console.log('  FAIL ' + name + '\n       ' + e.message); }
}
function assert(c, m) { if (!c) throw new Error(m); }
function eq(a, b, m) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error((m || 'not equal') + ': ' + JSON.stringify(a) + ' !== ' + JSON.stringify(b)); }
// jsonb sorts object keys, so compare objects with sorted keys.
const canon = (v) => Array.isArray(v) ? v.map(canon)
  : (v && typeof v === 'object') ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canon(v[k])])) : v;
function same(a, b, m) { eq(canon(a), canon(b), m); }

async function fresh() {
  const db = new PGlite();
  await db.exec(PM_BASE);
  await db.exec(SUPABASE_DEFAULT_GRANTS);
  await db.exec(PAYROLL_STANDIN);
  await db.exec(M98);
  await db.exec(M100);
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
async function setup() {
  const db = await fresh();
  const pid = await newProject(db, I.OWNER, 'Alpha House');
  const pid2 = await newProject(db, I.OWNER, 'Beta Annex');
  const pidB = await newProject(db, I.OTHER, 'Other Co');
  return { db, pid, pid2, pidB };
}

const T = {
  rec:   ['uuid', 'uuid', 'text', 'date', 'numeric', 'numeric', 'text'],
  edit:  ['uuid', 'uuid', 'uuid', 'text', 'date', 'numeric', 'numeric', 'text'],
  repay: ['uuid', 'uuid', 'date', 'numeric', 'jsonb', 'text'],
  void:  ['uuid', 'uuid', 'text'],
};
async function callFn(db, uid, fn, args, types) {
  await as(db, uid);
  const ph = args.map((_, i) => '$' + (i + 1) + '::' + types[i]).join(', ');
  return (await one(db, `select ${fn}(${ph}) r`, args)).r;
}
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const record = (db, uid, o = {}) => callFn(db, uid, 'pm_ca_record_advance', [
  o.op || randomUUID(), o.project,
  has(o, 'worker') ? o.worker : 'Francis Dela Cruz', has(o, 'on') ? o.on : '2026-10-01',
  has(o, 'amount') ? o.amount : '6000', has(o, 'pct') ? o.pct : '30', has(o, 'notes') ? o.notes : null], T.rec);
const edit = (db, uid, a, o = {}) => callFn(db, uid, 'pm_ca_edit_advance', [
  o.op || randomUUID(), a.id, has(o, 'project') ? o.project : a.project_id,
  has(o, 'worker') ? o.worker : a.worker_name, has(o, 'on') ? o.on : a.issued_on,
  has(o, 'amount') ? o.amount : String(a.amount), has(o, 'pct') ? o.pct : String(a.suggest_pct),
  has(o, 'notes') ? o.notes : a.notes], T.edit);
const repay = (db, uid, advanceId, o = {}) => callFn(db, uid, 'pm_ca_record_repayment', [
  o.op || randomUUID(), advanceId, has(o, 'on') ? o.on : '2026-10-08',
  has(o, 'amount') ? o.amount : '1935', o.ref === undefined ? null : JSON.stringify(o.ref),
  has(o, 'notes') ? o.notes : null], T.repay);
const voidRep = (db, uid, id, reason = 'Entered twice', op) => callFn(db, uid, 'pm_ca_void_repayment', [op || randomUUID(), id, reason], T.void);
const voidAdv = (db, uid, id, reason = 'Wrong worker', op) => callFn(db, uid, 'pm_ca_void_advance', [op || randomUUID(), id, reason], T.void);
async function list(db, uid) { await as(db, uid); return (await one(db, 'select pm_ca_list() r')).r; }
async function projects(db, uid) { await as(db, uid); return (await one(db, 'select pm_ca_projects() r')).r; }
const repaidCents = (a) => a.repayments.filter(r => !r.voided_at).reduce((s, r) => s + Math.round(r.amount * 100), 0);
async function expectCode(promise, code, label) {
  const m = await err(promise);
  assert(m.includes(code), (label || '') + ' expected ' + code + ', got ' + m);
}

console.log('\nPM worker cash advances (0100) on PGlite');

// ── A. Recording an advance ─────────────────────────────────────────
await test('A1 owner records an advance — stored, issued event, op result kept', async () => {
  const { db, pid } = await setup();
  const op = randomUUID();
  const a = (await record(db, I.OWNER, { op, project: pid, amount: '6000.50', notes: ' cash for rent ' })).advance;
  eq([a.project_id, a.project_name, a.worker_name, a.issued_on, a.amount, a.suggest_pct, a.notes, a.project_deleted, a.voided_at],
     [pid, 'Alpha House', 'Francis Dela Cruz', '2026-10-01', 6000.5, 30, 'cash for rent', false, null]);
  eq(a.events.map(e => [e.kind, e.actor_email]), [['issued', 'admin@dacs.test']]);
  eq(a.repayments, []);
  eq(await one(db, 'select company_owner_id, action, result is not null as stored from pm_cash_advance_ops where op_id = $1', [op]),
     { company_owner_id: I.OWNER, action: 'record_advance', stored: true });
});
await test('A2 focused owner (admin-pm@) records into the main owner company', async () => {
  const { db, pid } = await setup();
  const a = (await record(db, I.PMOWNER, { project: pid })).advance;
  eq((await one(db, 'select company_owner_id from pm_cash_advances where id = $1', [a.id])).company_owner_id, I.OWNER);
  eq((await list(db, I.OWNER)).map(x => x.id), [a.id], 'main owner sees it');
});
await test('A3 staff, client, partner, inactive, no profile, signed out, other company — refused, nothing kept', async () => {
  const { db, pid } = await setup();
  for (const [uid, code] of [[I.STAFF, 'OWNER_ONLY'], [I.CLIENT, 'OWNER_ONLY'], [I.PARTNER, 'OWNER_ONLY'],
                             [I.INACT, 'INACTIVE'], [I.NOPROFILE, 'PROFILE_MISSING'], ['', 'NOT_SIGNED_IN'],
                             [I.OTHER, 'NOT_FOUND']]) {
    await expectCode(record(db, uid, { project: pid }), code, uid || 'signed out');
  }
  eq(await count(db, 'pm_cash_advances'), 0);
  eq(await count(db, 'pm_cash_advance_ops'), 0, 'refused calls leave no op row');
});
await test('A4 R1/R1a/R2 validation — rejected, never rounded; 0% and 100% accepted', async () => {
  const { db, pid } = await setup();
  for (const [o, code] of [
    [{ amount: '0' }, 'BAD_AMOUNT'], [{ amount: '-5' }, 'BAD_AMOUNT'], [{ amount: null }, 'BAD_AMOUNT'],
    [{ amount: '10000000000' }, 'BAD_AMOUNT'], [{ amount: '100.005' }, 'BAD_PRECISION'],
    [{ pct: '100.01' }, 'BAD_PCT'], [{ pct: '-1' }, 'BAD_PCT'], [{ pct: null }, 'BAD_PCT'], [{ pct: '30.125' }, 'BAD_PRECISION'],
    [{ worker: '   ' }, 'BAD_WORKER'], [{ worker: null }, 'BAD_WORKER'], [{ worker: 'x'.repeat(121) }, 'BAD_WORKER'],
    [{ on: null }, 'BAD_DATE']]) {
    await expectCode(record(db, I.OWNER, { project: pid, ...o }), code, JSON.stringify(o));
  }
  await expectCode(callFn(db, I.OWNER, 'pm_ca_record_advance', [null, pid, 'A', '2026-10-01', '1', '30', null], T.rec), 'BAD_OP', 'null op');
  eq(await count(db, 'pm_cash_advances'), 0);
  const z = (await record(db, I.OWNER, { project: pid, pct: '0' })).advance;
  const h = (await record(db, I.OWNER, { project: pid, pct: '100', amount: '0.01' })).advance;
  eq([z.suggest_pct, h.suggest_pct, h.amount], [0, 100, 0.01]);
});
await test('A5 unmapped or unknown project → NOT_FOUND', async () => {
  const { db } = await setup();
  const loose = await newProject(db, '', 'Unmapped');   // no signed-in creator → no company row (0098 D3)
  await expectCode(record(db, I.OWNER, { project: loose }), 'NOT_FOUND');
  await expectCode(record(db, I.OWNER, { project: randomUUID() }), 'NOT_FOUND');
});

// ── B. Reads ────────────────────────────────────────────────────────
await test('B1 pm_ca_projects lists the caller company only', async () => {
  const { db } = await setup();
  eq((await projects(db, I.OWNER)).map(p => p.name), ['Alpha House', 'Beta Annex']);
  eq((await projects(db, I.PMOWNER)).map(p => p.name), ['Alpha House', 'Beta Annex']);
  eq((await projects(db, I.OTHER)).map(p => p.name), ['Other Co']);
  await expectCode(projects(db, I.STAFF), 'OWNER_ONLY');
});
await test('B2 pm_ca_list is company-scoped, newest issue first; staff refused', async () => {
  const { db, pid, pidB } = await setup();
  await record(db, I.OWNER, { project: pid, worker: 'Older', on: '2026-09-01' });
  await record(db, I.OWNER, { project: pid, worker: 'Newer', on: '2026-10-05' });
  await record(db, I.OTHER, { project: pidB, worker: 'Other worker' });
  eq((await list(db, I.OWNER)).map(a => a.worker_name), ['Newer', 'Older']);
  eq((await list(db, I.OTHER)).map(a => a.worker_name), ['Other worker']);
  await expectCode(list(db, I.STAFF), 'OWNER_ONLY');
});

// ── C. Repayments ───────────────────────────────────────────────────
await test('C1 a repayment is stored with a repaid event', async () => {
  const { db, pid } = await setup();
  const a = (await record(db, I.OWNER, { project: pid })).advance;
  const r = await repay(db, I.OWNER, a.id, { amount: '1935', notes: 'agreed' });
  eq(r.advance.repayments.map(x => [x.amount, x.paid_on, x.notes, x.voided_at]), [[1935, '2026-10-08', 'agreed', null]]);
  eq(r.advance.events.map(e => e.kind), ['issued', 'repaid']);
  eq(r.advance.events[1].repayment_id, r.repayment_id);
});
await test('C2 R5 a repayment can never exceed the balance', async () => {
  const { db, pid } = await setup();
  const a = (await record(db, I.OWNER, { project: pid, amount: '2000' })).advance;
  await repay(db, I.OWNER, a.id, { amount: '1500' });
  await expectCode(repay(db, I.OWNER, a.id, { amount: '600' }), 'OVER_BALANCE');
  const last = await repay(db, I.OWNER, a.id, { amount: '500' });
  eq(repaidCents(last.advance), 200000);
  await expectCode(repay(db, I.OWNER, a.id, { amount: '0.01' }), 'OVER_BALANCE', 'balance 0');
});
await test('C3 repayment validation and scoping', async () => {
  const { db, pid } = await setup();
  const a = (await record(db, I.OWNER, { project: pid })).advance;
  await expectCode(repay(db, I.OWNER, a.id, { amount: '0' }), 'BAD_AMOUNT');
  await expectCode(repay(db, I.OWNER, a.id, { amount: '0.001' }), 'BAD_PRECISION');
  await expectCode(repay(db, I.OWNER, a.id, { on: null }), 'BAD_DATE');
  await expectCode(repay(db, I.OWNER, randomUUID()), 'NOT_FOUND');
  await expectCode(repay(db, I.OTHER, a.id), 'NOT_FOUND', 'other company');
  await expectCode(repay(db, I.STAFF, a.id), 'OWNER_ONLY');
  eq(await count(db, 'pm_cash_advance_repayments'), 0);
});
await test('C4 R12 payroll reference: shape-checked snapshot, extra keys dropped', async () => {
  const { db, pid } = await setup();
  const a = (await record(db, I.OWNER, { project: pid })).advance;
  const ref = { billId: 'b1', entryIds: ['we_1', 'we_2'], day: '2026-10-07', details: 'Francis', amount: 6450 };
  const r = await repay(db, I.OWNER, a.id, { amount: '100', ref: { ...ref, extra: 'x' } });
  same(r.advance.repayments[0].payroll_ref, ref);
  for (const bad of ['text', { ...ref, entryIds: [] }, { ...ref, entryIds: 'we_1' }, { ...ref, entryIds: [1] },
                     { ...ref, amount: '6450' }, { ...ref, billId: '' }, { billId: 'b1' }]) {
    await expectCode(repay(db, I.OWNER, a.id, { amount: '100', ref: bad }), 'BAD_REF', JSON.stringify(bad));
  }
  const n = await repay(db, I.OWNER, a.id, { amount: '100', ref: null });
  eq(n.advance.repayments[1].payroll_ref, null);
});
await test('C5 R12 editing or deleting the payroll line later changes nothing', async () => {
  const { db, pid } = await setup();
  const bill = (await one(db, `insert into weekly_bills (project_id, entries) values ($1, '[{"id":"we_1","amount":6450}]') returning id`, [pid])).id;
  const a = (await record(db, I.OWNER, { project: pid })).advance;
  const ref = { billId: bill, entryIds: ['we_1'], day: '2026-10-07', details: 'Francis', amount: 6450 };
  await repay(db, I.OWNER, a.id, { amount: '100', ref });
  await db.query(`update weekly_bills set entries = '[{"id":"we_1","amount":1}]' where id = $1`, [bill]);
  await db.query(`delete from weekly_bills where id = $1`, [bill]);
  same((await list(db, I.OWNER))[0].repayments[0].payroll_ref, ref);
});

// ── D. Editing ──────────────────────────────────────────────────────
await test('D1 edit writes only the changed fields; a no-change edit writes no event', async () => {
  const { db, pid } = await setup();
  const a = (await record(db, I.OWNER, { project: pid, notes: 'n1' })).advance;
  const r = await edit(db, I.OWNER, a, { worker: 'Francis D. Cruz', pct: '25', amount: '6500' });
  eq(r.changed, true);
  same(r.advance.events[1].changes, { worker_name: ['Francis Dela Cruz', 'Francis D. Cruz'], suggest_pct: [30, 25], amount: [6000, 6500] });
  const r2 = await edit(db, I.OWNER, r.advance, {});
  eq([r2.changed, r2.advance.events.length], [false, 2]);
});
await test('D2 R7 amount may not drop below what is repaid', async () => {
  const { db, pid } = await setup();
  const a = (await record(db, I.OWNER, { project: pid })).advance;
  await repay(db, I.OWNER, a.id, { amount: '2000' });
  await expectCode(edit(db, I.OWNER, a, { amount: '1999.99' }), 'BELOW_REPAID');
  const r = await edit(db, I.OWNER, a, { amount: '2000' });
  eq([r.advance.amount, repaidCents(r.advance)], [2000, 200000]);
  await expectCode(repay(db, I.OWNER, a.id, { amount: '0.01' }), 'OVER_BALANCE');
});
await test('D3 R15 moving to another project: own live project only', async () => {
  const { db, pid, pid2, pidB } = await setup();
  const a = (await record(db, I.OWNER, { project: pid })).advance;
  await expectCode(edit(db, I.OWNER, a, { project: pidB }), 'NOT_FOUND', 'other company project');
  await expectCode(edit(db, I.OWNER, a, { project: null }), 'NOT_FOUND', 'null project');
  const r = await edit(db, I.OWNER, a, { project: pid2 });
  eq([r.advance.project_id, r.advance.project_name], [pid2, 'Beta Annex']);
  same(r.advance.events[1].changes, { project: ['Alpha House', 'Beta Annex'] });
});
await test('D4 edit validation', async () => {
  const { db, pid } = await setup();
  const a = (await record(db, I.OWNER, { project: pid })).advance;
  for (const [o, code] of [[{ amount: '0' }, 'BAD_AMOUNT'], [{ amount: '1.234' }, 'BAD_PRECISION'], [{ pct: '101' }, 'BAD_PCT'],
                           [{ pct: '1.001' }, 'BAD_PRECISION'], [{ worker: '' }, 'BAD_WORKER'], [{ on: null }, 'BAD_DATE']]) {
    await expectCode(edit(db, I.OWNER, a, o), code, JSON.stringify(o));
  }
  await expectCode(edit(db, I.OTHER, a), 'NOT_FOUND', 'other company');
});

// ── E. Voiding ──────────────────────────────────────────────────────
await test('E1 R9/R10 voiding a repayment restores the balance and keeps the record', async () => {
  const { db, pid } = await setup();
  const a = (await record(db, I.OWNER, { project: pid })).advance;
  const rp = await repay(db, I.OWNER, a.id, { amount: '2000' });
  const v = await voidRep(db, I.PMOWNER, rp.repayment_id, '  Entered twice  ');
  const r = v.advance.repayments[0];
  eq([r.amount, r.void_reason, r.voided_by_email, !!r.voided_at], [2000, 'Entered twice', 'admin-pm@dacs.test', true]);
  eq(repaidCents(v.advance), 0);
  eq(v.advance.events.map(e => e.kind), ['issued', 'repaid', 'repayment_voided']);
  eq(v.advance.events[2].reason, 'Entered twice');
  await repay(db, I.OWNER, a.id, { amount: '6000' });   // the full amount fits again
});
await test('E2 void repayment refusals', async () => {
  const { db, pid } = await setup();
  const a = (await record(db, I.OWNER, { project: pid })).advance;
  const rp = await repay(db, I.OWNER, a.id, { amount: '100' });
  await expectCode(voidRep(db, I.OWNER, rp.repayment_id, '   '), 'BAD_REASON');
  await expectCode(voidRep(db, I.OWNER, rp.repayment_id, null), 'BAD_REASON');
  await expectCode(voidRep(db, I.OTHER, rp.repayment_id), 'NOT_FOUND');
  await expectCode(voidRep(db, I.STAFF, rp.repayment_id), 'OWNER_ONLY');
  await expectCode(voidRep(db, I.OWNER, randomUUID()), 'NOT_FOUND');
  await voidRep(db, I.OWNER, rp.repayment_id);
  await expectCode(voidRep(db, I.OWNER, rp.repayment_id), 'ALREADY_VOIDED');
});
await test('E3 R11/R8 an advance with live repayments cannot be voided; a voided advance is frozen', async () => {
  const { db, pid } = await setup();
  const a = (await record(db, I.OWNER, { project: pid })).advance;
  const rp = await repay(db, I.OWNER, a.id, { amount: '1000' });
  await expectCode(voidAdv(db, I.OWNER, a.id), 'HAS_REPAYMENTS');
  await voidRep(db, I.OWNER, rp.repayment_id);
  await expectCode(voidAdv(db, I.OWNER, a.id, ' '), 'BAD_REASON');
  const v = (await voidAdv(db, I.OWNER, a.id, 'Wrong worker')).advance;
  eq([!!v.voided_at, v.void_reason, v.voided_by_email, v.events.at(-1).kind], [true, 'Wrong worker', 'admin@dacs.test', 'voided']);
  await expectCode(repay(db, I.OWNER, a.id), 'VOIDED');
  await expectCode(edit(db, I.OWNER, a, { worker: 'X' }), 'VOIDED');
  await expectCode(voidAdv(db, I.OWNER, a.id), 'ALREADY_VOIDED');
  eq((await list(db, I.OWNER)).length, 1, 'still listed');
});

// ── F. Deleted projects (R15) ───────────────────────────────────────
await test('F1 deleting a project is not blocked; its advances keep working', async () => {
  const { db, pid, pid2 } = await setup();
  const a = (await record(db, I.OWNER, { project: pid, amount: '5000' })).advance;
  const b = (await record(db, I.OWNER, { project: pid2, amount: '1000' })).advance;
  const rp = await repay(db, I.OWNER, a.id, { amount: '1000' });
  await as(db, '');
  await db.query('delete from construction_projects where id = $1', [pid]);
  let la = (await list(db, I.OWNER)).find(x => x.id === a.id);
  eq([la.project_deleted, la.project_name], [true, 'Alpha House']);
  await repay(db, I.OWNER, a.id, { amount: '500' });
  const e = await edit(db, I.OWNER, la, { worker: 'Francis Cruz' });
  eq([e.advance.project_name, e.advance.worker_name], ['Alpha House', 'Francis Cruz']);
  await voidRep(db, I.OWNER, rp.repayment_id);
  await expectCode(record(db, I.OWNER, { project: pid }), 'NOT_FOUND', 'new advance on a deleted project');
  await expectCode(edit(db, I.OWNER, b, { project: pid }), 'NOT_FOUND', 'moving onto a deleted project');
  la = (await list(db, I.OWNER)).find(x => x.id === a.id);
  for (const r of la.repayments.filter(r => !r.voided_at)) await voidRep(db, I.OWNER, r.id);
  eq(!!(await voidAdv(db, I.OWNER, a.id)).advance.voided_at, true);
});

// ── G. Operation ids (R16) ──────────────────────────────────────────
await test('G1 the same repayment op twice records once and returns the same result', async () => {
  const { db, pid } = await setup();
  const a = (await record(db, I.OWNER, { project: pid })).advance;
  const op = randomUUID();
  const r1 = await repay(db, I.OWNER, a.id, { op, amount: '1000' });
  const r2 = await repay(db, I.OWNER, a.id, { op, amount: '1000' });
  const r3 = await repay(db, I.OWNER, a.id, { op, amount: '2500' });   // a retry never re-reads its arguments
  eq(r2, r1); eq(r3, r1);
  eq(await count(db, 'pm_cash_advance_repayments'), 1);
  eq(await count(db, 'pm_cash_advance_events', `kind = 'repaid'`), 1);
});
await test('G2 every other write replays too', async () => {
  const { db, pid } = await setup();
  const opA = randomUUID();
  const a1 = await record(db, I.OWNER, { op: opA, project: pid });
  eq(await record(db, I.OWNER, { op: opA, project: pid, worker: 'Someone else' }), a1);
  eq(await count(db, 'pm_cash_advances'), 1);
  const a = a1.advance;
  const opE = randomUUID();
  const e1 = await edit(db, I.OWNER, a, { op: opE, worker: 'Francis Cruz' });
  eq(await edit(db, I.OWNER, a, { op: opE, worker: 'Third name' }), e1);
  eq(await count(db, 'pm_cash_advance_events', `kind = 'edited'`), 1);
  const rp = await repay(db, I.OWNER, a.id, { amount: '100' });
  const opV = randomUUID();
  const v1 = await voidRep(db, I.OWNER, rp.repayment_id, 'x', opV);
  eq(await voidRep(db, I.OWNER, rp.repayment_id, 'x', opV), v1);
  eq(await count(db, 'pm_cash_advance_events', `kind = 'repayment_voided'`), 1);
  const opD = randomUUID();
  const d1 = await voidAdv(db, I.OWNER, a.id, 'y', opD);
  eq(await voidAdv(db, I.OWNER, a.id, 'y', opD), d1);
  eq(await count(db, 'pm_cash_advance_events', `kind = 'voided'`), 1);
});
await test('G3 an op id used for another action or by another company → OP_CONFLICT', async () => {
  const { db, pid, pidB } = await setup();
  const op = randomUUID();
  const a = (await record(db, I.OWNER, { op, project: pid })).advance;
  await expectCode(repay(db, I.OWNER, a.id, { op }), 'OP_CONFLICT', 'different action');
  await expectCode(record(db, I.OTHER, { op, project: pidB }), 'OP_CONFLICT', 'other company');
});
await test('G4 a refused call leaves no op row, so the same id can be retried', async () => {
  const { db, pid } = await setup();
  const a = (await record(db, I.OWNER, { project: pid, amount: '1000' })).advance;
  const op = randomUUID();
  await expectCode(repay(db, I.OWNER, a.id, { op, amount: '1500' }), 'OVER_BALANCE');
  eq(await count(db, 'pm_cash_advance_ops', 'op_id = $1', [op]), 0);
  const ok2 = await repay(db, I.OWNER, a.id, { op, amount: '900' });
  eq(repaidCents(ok2.advance), 90000);
});
await test('G5 a retry returns the first result even after later changes', async () => {
  const { db, pid } = await setup();
  const a = (await record(db, I.OWNER, { project: pid })).advance;
  const op1 = randomUUID();
  await repay(db, I.OWNER, a.id, { op: op1, amount: '100' });
  await repay(db, I.OWNER, a.id, { amount: '200' });
  eq((await repay(db, I.OWNER, a.id, { op: op1, amount: '100' })).advance.repayments.length, 1);
  eq((await list(db, I.OWNER))[0].repayments.length, 2);
});

// ── H. History, isolation, lock-down ────────────────────────────────
await test('H1 R14 history rows cannot be updated or deleted, even by the table owner', async () => {
  const { db, pid } = await setup();
  await record(db, I.OWNER, { project: pid });
  await expectCode(db.query(`update pm_cash_advance_events set reason = 'x'`), 'HISTORY_IMMUTABLE', 'update');
  await expectCode(db.query(`delete from pm_cash_advance_events`), 'HISTORY_IMMUTABLE', 'delete');
});
await test('H2 a full flow never touches payroll', async () => {
  const { db, pid } = await setup();
  await db.query(`insert into weekly_bills (project_id, entries) values ($1, '[{"id":"we_1","type":"labor","amount":6450}]')`, [pid]);
  const before = (await one(db, `select json_agg(w order by id) j from weekly_bills w`)).j;
  const a = (await record(db, I.OWNER, { project: pid })).advance;
  const rp = await repay(db, I.OWNER, a.id, { amount: '1935', ref: { billId: 'b', entryIds: ['we_1'], day: '2026-10-07', details: 'F', amount: 6450 } });
  await edit(db, I.OWNER, a, { amount: '7000' });
  await voidRep(db, I.OWNER, rp.repayment_id);
  await voidAdv(db, I.OWNER, a.id);
  eq((await one(db, `select json_agg(w order by id) j from weekly_bills w`)).j, before);
});
await test('H3 tables: RLS on, no policies; only the seven public functions are callable', async () => {
  const { db } = await setup();
  const tables = ['pm_cash_advances', 'pm_cash_advance_repayments', 'pm_cash_advance_events', 'pm_cash_advance_ops'];
  for (const t of tables) {
    eq((await one(db, `select relrowsecurity r from pg_class where relname = $1`, [t])).r, true, t + ' rls');
    eq(await count(db, 'pg_policies', 'tablename = $1', [t]), 0, t + ' policies');
    eq((await one(db, `select has_table_privilege('authenticated', $1, 'select') p`, [t])).p, false, t + ' select');
  }
  for (const f of ['pm_ca_projects()', 'pm_ca_list()',
                   'pm_ca_record_advance(uuid, uuid, text, date, numeric, numeric, text)',
                   'pm_ca_edit_advance(uuid, uuid, uuid, text, date, numeric, numeric, text)',
                   'pm_ca_record_repayment(uuid, uuid, date, numeric, jsonb, text)',
                   'pm_ca_void_repayment(uuid, uuid, text)', 'pm_ca_void_advance(uuid, uuid, text)']) {
    eq((await one(db, `select has_function_privilege('authenticated', $1, 'execute') p`, [f])).p, true, f);
    eq((await one(db, `select has_function_privilege('anon', $1, 'execute') p`, [f])).p, false, f + ' anon');
  }
  for (const f of ['pm_ca_advance_json(uuid)', 'pm_ca_lock(uuid, uuid)', 'pm_ca_op_begin(uuid, uuid, text)',
                   'pm_ca_op_end(uuid, jsonb)', 'pm_ca_event(uuid, uuid, text, uuid, jsonb, text)',
                   'pm_ca_repaid(uuid)', 'pm_ca_project_name(uuid, uuid)']) {
    eq((await one(db, `select has_function_privilege('authenticated', $1, 'execute') p`, [f])).p, false, f + ' must be private');
  }
  eq((await one(db, `select has_sequence_privilege('authenticated', 'pm_cash_advance_events_seq_seq', 'usage') p`)).p, false, 'identity sequence must be revoked');
  for (const f of ['pm_ca_events_immutable()', 'pm_ca_clean(text)', 'pm_ca_check_amount(numeric)', 'pm_ca_check_pct(numeric)', 'pm_ca_clean_ref(jsonb)']) {
    const cfg = (await one(db, `select array_to_string(proconfig, ',') c from pg_proc where oid = $1::regprocedure`, [f])).c || '';
    assert(cfg.includes('search_path=public, pg_temp'), f + ' must pin search_path, got ' + cfg);
  }
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) { console.log(failures.join('\n')); process.exit(1); }
