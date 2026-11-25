// ═════════════════════════════════════════════════
// RECEIPT DESCRIPTIONS TYPED BY THE OWNER (0118) — ON PGLITE
//   npm run test:sql
// Runs 0114, 0116, 0117 and 0118 VERBATIM over pmar_base.mjs (which carries
// the 0114 base and the Project Management tables).
// Spec: docs/superpowers/specs/2026-11-20-pc-receipt-payment-line-design.md (§ 0118)
// ═════════════════════════════════════════════════
import fs from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { PMAR_SETUP, M114, M116, IDS as I, seed, seedReceipts, seedPm, P, PAY } from './pmar_base.mjs';
import { ROOT } from './ll_base.mjs';

const mig = (f) => fs.readFileSync(path.join(ROOT, 'supabase/migrations', f), 'utf8').replace(/\r\n/g, '\n');
const M117 = mig('0117_pc_receipt_payment_line.sql');
const M118 = mig('0118_receipt_description.sql');

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
const DESC = 'Full Payment of the Down Payment (Nov 20, 2026)';
const pcIssue = async (db, period, desc, paidOn = '2026-11-18', ref = 'PC-REF-1') =>
  (await one(db, 'select bar_issue_described($1, $2, $3, $4::date, $5, $6) r', [period, 'MH Interior', 'Cristher Dacome', paidOn, ref, desc])).r;
const pcReissue = async (db, id, desc, reason = 'Better wording') =>
  (await one(db, 'select bar_reissue_described($1, $2, $3, $4, $5::date, $6, $7) r', [id, reason, 'MH Interior', 'Cristher Dacome', '2026-11-18', 'PC-REF-1', desc])).r;
const pmIssue = async (db, pay, desc) =>
  (await one(db, 'select pmar_issue_described($1, $2, $3, $4) r', [pay, 'Julienne Camba', 'Cristher Dacome', desc])).r;
const pmReissue = async (db, id, desc, reason = 'Better wording') =>
  (await one(db, 'select pmar_reissue_described($1, $2, $3, $4, $5) r', [id, reason, 'Julienne Camba', 'Cristher Dacome', desc])).r;

async function fresh() {
  const db = new PGlite();
  for (const part of PMAR_SETUP) await db.exec(part);
  for (const m of [M114, M116, M117, M118]) await db.exec(m);
  await seed((sql) => db.exec(sql));
  await seedReceipts((sql) => db.exec(sql));
  await seedPm((sql) => db.exec(sql));
  await as(db, I.OWNER);
  return db;
}
const ym = async (db) => (await one(db, `select to_char((now() at time zone 'Asia/Manila')::date, 'YYYYMM') v`)).v;

console.log('\nReceipt descriptions typed by the owner (0118)');

console.log('\nProject Control');
await test('a typed description is the line; the payment date and reference are still saved', async () => {
  const db = await fresh();
  const r = await pcIssue(db, P.BILL3, '  ' + DESC + '  ');
  eq([r.billing_label, r.paid_on, r.payment_reference, Number(r.amount)], [DESC, '2026-11-18', 'PC-REF-1', 159000]);
});
await test('a blank description falls back to the automatic line', async () => {
  const db = await fresh();
  eq((await pcIssue(db, P.BILL3, '   ')).billing_label, 'Progress Billing 3 (November 2026) · Payment received (Nov 18, 2026) · Ref. PC-REF-1');
  eq((await pcIssue(db, P.DOWN, null, '2026-10-05', '')).billing_label, 'Downpayment (October 2026) · Payment received (Oct 5, 2026)');
});
await test('a description over 200 characters is refused; 200 is fine', async () => {
  const db = await fresh();
  assert((await err(pcIssue(db, P.BILL3, 'd'.repeat(201)))).includes('DESCRIPTION_TOO_LONG'), '201');
  eq((await pcIssue(db, P.BILL3, 'd'.repeat(200))).billing_label.length, 200);
});
await test('the 0117 checks still apply: future date, long reference, Cover, staff', async () => {
  const db = await fresh();
  const tomorrow = (await one(db, `select to_char((now() at time zone 'Asia/Manila')::date + 1, 'YYYY-MM-DD') d`)).d;
  assert((await err(pcIssue(db, P.BILL3, DESC, tomorrow))).includes('PAID_ON_FUTURE'), 'future');
  assert((await err(pcIssue(db, P.BILL3, DESC, '2026-11-18', 'x'.repeat(101)))).includes('REFERENCE_TOO_LONG'), 'reference');
  assert((await err(pcIssue(db, P.COVER, DESC))).includes('COVER_PERIOD'), 'cover');
  await as(db, I.STAFF);
  assert((await err(pcIssue(db, P.BILL3, DESC))).includes('OWNER_ONLY'), 'staff');
});
await test('pressing again returns the same receipt; re-issue takes the new description and keeps the old one void', async () => {
  const db = await fresh();
  const a = await pcIssue(db, P.BILL3, DESC);
  eq((await pcIssue(db, P.BILL3, 'Other words')).id, a.id, 'same receipt');
  const r = await pcReissue(db, a.id, 'Full Payment of Progress Billing 3');
  eq(r.billing_label, 'Full Payment of Progress Billing 3');
  assert(r.receipt_no !== a.receipt_no, 'new number');
  await admin(db);
  const was = await one(db, 'select billing_label, voided_at from billing_receipts where id = $1', [a.id]);
  assert(was.voided_at !== null && was.billing_label === DESC, 'old receipt void and unchanged');
});

console.log('\nProject Management');
await test('a typed description is the line; the amount is still the paid amount', async () => {
  const db = await fresh();
  const r = await pmIssue(db, PAY.V1, DESC);
  eq([r.billing_label, Number(r.amount)], [DESC, 389000]);
});
await test('a blank description falls back to the automatic line', async () => {
  const db = await fresh();
  eq((await pmIssue(db, PAY.V1, '')).billing_label, 'Payment received (Nov 13, 2026) · Ref. GC-123');
});
await test('the 0116 checks still apply: not paid, staff, another company', async () => {
  const db = await fresh();
  assert((await err(pmIssue(db, PAY.S1, DESC))).includes('NOT_PAID'), 'not paid');
  assert((await err(pmIssue(db, PAY.B1, DESC))).includes('NOT_FOUND'), 'other company');
  assert((await err(pmIssue(db, PAY.V1, 'x'.repeat(201)))).includes('DESCRIPTION_TOO_LONG'), 'too long');
  await as(db, I.STAFF);
  assert((await err(pmIssue(db, PAY.V1, DESC))).includes('OWNER_ONLY'), 'staff');
});
await test('pressing again returns the same receipt; re-issue takes the new description', async () => {
  const db = await fresh();
  const a = await pmIssue(db, PAY.V1, DESC);
  eq((await pmIssue(db, PAY.V1, 'Other words')).id, a.id, 'same receipt');
  const r = await pmReissue(db, a.id, 'Down payment received');
  eq(r.billing_label, 'Down payment received');
  await admin(db);
  eq((await one(db, 'select count(*) n from pm_billing_receipts where voided_at is null')).n, 1, 'one live');
});

console.log('\nBoth');
await test('there is no way to pass an amount', async () => {
  const db = await fresh();
  const args = async (fn) => (await one(db, `select pg_get_function_identity_arguments('${fn}'::regproc) a`)).a;
  eq(await args('bar_issue_described'), 'p_period uuid, p_received_from text, p_received_by text, p_paid_on date, p_reference text, p_description text');
  eq(await args('bar_reissue_described'), 'p_receipt uuid, p_reason text, p_received_from text, p_received_by text, p_paid_on date, p_reference text, p_description text');
  eq(await args('pmar_issue_described'), 'p_payment uuid, p_received_from text, p_received_by text, p_description text');
  eq(await args('pmar_reissue_described'), 'p_receipt uuid, p_reason text, p_received_from text, p_received_by text, p_description text');
});
await test('numbers still run in one series across both, and a receipt still cannot be edited', async () => {
  const db = await fresh();
  const m = await ym(db);
  eq((await pcIssue(db, P.BILL3, DESC)).receipt_no, `AR-${m}-001`);
  const pm = await pmIssue(db, PAY.V1, DESC);
  eq(pm.receipt_no, `AR-${m}-002`);
  await admin(db);
  assert((await err(db.query(`update pm_billing_receipts set billing_label = 'x' where id = $1`, [pm.id]))).includes('RECEIPT_PERMANENT'), 'PM guard');
});
await test('only owners may call the new functions; helpers are closed', async () => {
  const db = await fresh();
  await admin(db);
  const r = await one(db, `select
      has_function_privilege('authenticated', 'bar_issue_described(uuid,text,text,date,text,text)', 'execute') a,
      has_function_privilege('anon', 'bar_issue_described(uuid,text,text,date,text,text)', 'execute') b,
      has_function_privilege('authenticated', 'pmar_issue_described(uuid,text,text,text)', 'execute') c,
      has_function_privilege('authenticated', 'bar_clean_description(text)', 'execute') d`);
  eq([r.a, r.b, r.c, r.d], [true, false, true, false]);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) { failures.forEach(f => console.log('  - ' + f)); process.exit(1); }
