// ═════════════════════════════════════════════════
// PROJECT CONTROL RECEIPTS: PAYMENT DATE + REFERENCE (0117) — ON PGLITE
//   npm run test:sql
// Runs 0114 and 0117 VERBATIM over br_base.mjs.
// Spec: docs/superpowers/specs/2026-11-20-pc-receipt-payment-line-design.md
// ═════════════════════════════════════════════════
import fs from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { BR_SETUP, M114, IDS as I, seed, seedReceipts, F, P } from './br_base.mjs';
import { ROOT } from './ll_base.mjs';

const M117 = fs.readFileSync(path.join(ROOT, 'supabase/migrations/0117_pc_receipt_payment_line.sql'), 'utf8').replace(/\r\n/g, '\n');

let passed = 0, failed = 0;
const failures = [];
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { failed++; failures.push(name + ' — ' + e.message); console.log('  FAIL ' + name + '\n       ' + e.message); }
}
function assert(c, m) { if (!c) throw new Error(m); }
function eq(a, b, m) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error((m || 'not equal') + ': ' + JSON.stringify(a) + ' vs ' + JSON.stringify(b)); }
async function as(db, uid) {
  await db.exec(`reset role; select set_config('test.uid', '${uid || ''}', false);`);
  if (uid) await db.exec('set role authenticated');
}
const admin = (db) => as(db, null);
const one = async (db, sql, params = []) => (await db.query(sql, params)).rows[0];
const err = async (p) => { try { await p; return 'no error'; } catch (e) { return e.message; } };
const REF = 'PC-NDBMOB-20261118-70453908';
const issue = async (db, period, paidOn = '2026-11-18', ref = REF) =>
  (await one(db, 'select bar_issue_with_payment($1, $2, $3, $4::date, $5) r', [period, 'MH Interior', 'Cristher Dacome', paidOn, ref])).r;
const reissue = async (db, id, paidOn, ref, reason = 'Wrong payment date') =>
  (await one(db, 'select bar_reissue_with_payment($1, $2, $3, $4, $5::date, $6) r', [id, reason, 'MH Interior', 'Cristher Dacome', paidOn, ref])).r;
const manilaDay = async (db, plusDays) =>
  (await one(db, `select to_char((now() at time zone 'Asia/Manila')::date + $1::int, 'YYYY-MM-DD') d`, [plusDays])).d;

async function fresh() {
  const db = new PGlite();
  for (const part of BR_SETUP) await db.exec(part);
  await db.exec(M114);
  await db.exec(M117);
  await seed((sql) => db.exec(sql));
  await seedReceipts((sql) => db.exec(sql));
  await as(db, I.OWNER);
  return db;
}

console.log('\nProject Control receipts — payment date and reference (0117)');

await test('the line keeps the billing name, then the payment date and the reference', async () => {
  const db = await fresh();
  const r = await issue(db, P.BILL3);
  eq(r.billing_label, 'Progress Billing 3 (November 2026) · Payment received (Nov 18, 2026) · Ref. ' + REF, 'line');
  eq([r.paid_on, r.payment_reference, Number(r.amount)], ['2026-11-18', REF, 159000], 'saved values');
});
await test('no reference: the line ends after the payment date', async () => {
  const db = await fresh();
  const r = await issue(db, P.DOWN, '2026-10-05', '   ');
  eq(r.billing_label, 'Downpayment (October 2026) · Payment received (Oct 5, 2026)');
  eq(r.payment_reference, null);
});
await test('there is no way to pass an amount', async () => {
  const db = await fresh();
  eq((await one(db, `select pg_get_function_identity_arguments('bar_issue_with_payment'::regproc) a`)).a,
     'p_period uuid, p_received_from text, p_received_by text, p_paid_on date, p_reference text');
  eq((await one(db, `select pg_get_function_identity_arguments('bar_reissue_with_payment'::regproc) a`)).a,
     'p_receipt uuid, p_reason text, p_received_from text, p_received_by text, p_paid_on date, p_reference text');
});
await test('a missing or future payment date is refused; today is fine', async () => {
  const db = await fresh();
  assert((await err(issue(db, P.BILL3, null))).includes('PAID_ON_REQUIRED'), 'missing');
  assert((await err(issue(db, P.BILL3, await manilaDay(db, 1)))).includes('PAID_ON_FUTURE'), 'tomorrow in Manila');
  const today = await manilaDay(db, 0);
  eq((await issue(db, P.BILL3, today)).paid_on, today, 'today');
});
await test('a reference over 100 characters is refused; 100 is fine', async () => {
  const db = await fresh();
  assert((await err(issue(db, P.BILL3, '2026-11-18', 'x'.repeat(101)))).includes('REFERENCE_TOO_LONG'), '101');
  eq((await issue(db, P.BILL3, '2026-11-18', 'y'.repeat(100))).payment_reference.length, 100);
});
await test('pressing again returns the same receipt and spends no number', async () => {
  const db = await fresh();
  const a = await issue(db, P.BILL3);
  const b = await issue(db, P.BILL3, '2026-11-01', 'OTHER');
  eq([b.id, b.receipt_no, b.paid_on], [a.id, a.receipt_no, '2026-11-18']);
  await admin(db);
  eq(Number((await one(db, 'select count(*) n from billing_receipts')).n), 1);
});
await test('void and re-issue takes the new date and reference and keeps the old receipt void', async () => {
  const db = await fresh();
  const old = await issue(db, P.BILL3);
  const r = await reissue(db, old.id, '2026-11-17', 'NEW-REF');
  eq(r.billing_label, 'Progress Billing 3 (November 2026) · Payment received (Nov 17, 2026) · Ref. NEW-REF');
  assert(r.receipt_no !== old.receipt_no, 'new number');
  await admin(db);
  const was = await one(db, 'select voided_at, void_reason, paid_on::text paid_on from billing_receipts where id = $1', [old.id]);
  assert(was.voided_at !== null && was.void_reason === 'Wrong payment date', 'old voided with the reason');
  eq(was.paid_on, '2026-11-18', 'old receipt unchanged');
  await as(db, I.OWNER);
  assert((await err(reissue(db, old.id, '2026-11-17', 'X'))).includes('ALREADY_VOID'), 'already void');
  assert((await err(reissue(db, r.id, '2026-11-17', 'X', ' '))).includes('REASON_REQUIRED'), 'reason');
});
await test('a receipt issued before 0117 can be re-issued with a payment date', async () => {
  const db = await fresh();
  const old = (await one(db, `select bar_issue($1, 'MH Interior', 'Cristher Dacome') r`, [P.BILL3])).r;
  eq([old.billing_label, old.paid_on, old.payment_reference], ['Progress Billing 3 (November 2026)', null, null], 'the old functions still work');
  const r = await reissue(db, old.id, '2026-11-18', REF);
  eq(r.billing_label, 'Progress Billing 3 (November 2026) · Payment received (Nov 18, 2026) · Ref. ' + REF);
});
await test('the same checks as before: staff, Cover and no Fund Allocated are refused', async () => {
  const db = await fresh();
  assert((await err(issue(db, P.COVER))).includes('COVER_PERIOD'), 'cover');
  assert((await err(issue(db, P.ZERO))).includes('NO_FUND_ALLOCATED'), 'zero');
  await as(db, I.STAFF);
  assert((await err(issue(db, P.BILL3))).includes('OWNER_ONLY'), 'staff');
});
await test('a receipt still can never be edited', async () => {
  const db = await fresh();
  const r = await issue(db, P.BILL3);
  await admin(db);
  assert((await err(db.query(`update billing_receipts set paid_on = '2026-01-01' where id = $1`, [r.id]))).includes('RECEIPT_PERMANENT'), 'paid_on');
  assert((await err(db.query(`update billing_receipts set payment_reference = 'x' where id = $1`, [r.id]))).includes('RECEIPT_PERMANENT'), 'reference');
});
await test('bar_state hands the date and reference back for a re-issue', async () => {
  const db = await fresh();
  await issue(db, P.BILL3);
  const s = (await one(db, 'select bar_state($1) r', [F.A])).r;
  eq([s.receipts[0].paid_on, s.receipts[0].payment_reference], ['2026-11-18', REF]);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) { failures.forEach(f => console.log('  - ' + f)); process.exit(1); }
