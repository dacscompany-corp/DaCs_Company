// ═════════════════════════════════════════════════
// PM BILLING DOCUMENTS (0116) — BEHAVIOUR TESTS ON PGLITE
//   npm run test:sql
// Runs 0114 and 0116 VERBATIM over pmar_base.mjs.
// Spec: docs/superpowers/specs/2026-11-18-pm-billing-documents-design.md
// ═════════════════════════════════════════════════
import { PGlite } from '@electric-sql/pglite';
import { PMAR_SETUP, M114, M116, IDS as I, seed, seedReceipts, seedPm, P, PM, PAY } from './pmar_base.mjs';

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
const rows = async (db, sql, params = []) => (await db.query(sql, params)).rows;
const err = async (p) => { try { await p; return 'no error'; } catch (e) { return e.message; } };
const issue = async (db, pay, from = 'Sample Client', by = 'Cristher Dacome') => (await one(db, 'select pmar_issue($1,$2,$3) r', [pay, from, by])).r;
const reissue = async (db, id, reason = 'Amount corrected', from = 'Sample Client', by = 'Cristher Dacome') => (await one(db, 'select pmar_reissue($1,$2,$3,$4) r', [id, reason, from, by])).r;
const state = async (db, project) => (await one(db, 'select pmar_state($1) r', [project])).r;
const barIssue = async (db, period) => (await one(db, `select bar_issue($1, 'MH Interior', 'Cristher Dacome') r`, [period])).r;
const n = async (db, sql) => { await admin(db); return Number((await one(db, sql)).n); };

async function fresh() {
  const db = new PGlite();
  for (const part of PMAR_SETUP) await db.exec(part);
  await db.exec(M114);
  await db.exec(M116);
  await seed((sql) => db.exec(sql));
  await seedReceipts((sql) => db.exec(sql));
  await seedPm((sql) => db.exec(sql));
  await as(db, I.OWNER);
  return db;
}
const ym = async (db) => (await one(db, `select to_char((now() at time zone 'Asia/Manila')::date, 'YYYYMM') v`)).v;

console.log('\nPM Billing Documents — 0116 behaviour');

console.log('\nIssuing');
await test('a receipt takes the paid amount and labels the payment with its date and reference', async () => {
  const db = await fresh();
  const r = await issue(db, PAY.V1);
  eq(Number(r.amount), 389000, 'amount');
  eq(r.billing_label, 'Payment received (Nov 13, 2026) · Ref. GC-123', 'label');
  eq(r.receipt_no, `AR-${await ym(db)}-001`, 'number');
  eq([r.project_id, r.payment_id, r.owner_id], [PM.A, PAY.V1, I.OWNER], 'links');
  eq([r.received_from, r.received_by], ['Sample Client', 'Cristher Dacome'], 'names');
  assert(r.voided_at === null, 'live');
});
await test('there is no way to pass an amount', async () => {
  const db = await fresh();
  eq((await one(db, `select pg_get_function_identity_arguments('pmar_issue'::regproc) a`)).a,
     'p_payment uuid, p_received_from text, p_received_by text');
  eq((await one(db, `select pg_get_function_identity_arguments('pmar_reissue'::regproc) a`)).a,
     'p_receipt uuid, p_reason text, p_received_from text, p_received_by text');
});
await test('verified with no amount_paid falls back to paid_amount, centavos kept', async () => {
  const db = await fresh();
  const r = await issue(db, PAY.V2);
  eq(Number(r.amount), 140000.5);
  eq(r.billing_label, 'Payment received (Oct 2, 2026)');
});
await test('a website payment marked paid gets a receipt', async () => {
  const db = await fresh();
  eq(Number((await issue(db, PAY.P1)).amount), 200000);
});
await test('submitted, rejected and unpaid rows are refused', async () => {
  const db = await fresh();
  for (const pay of [PAY.S1, PAY.R1, PAY.U1]) assert((await err(issue(db, pay))).includes('NOT_PAID'), 'refused: ' + pay);
  eq(await n(db, 'select count(*) n from pm_billing_receipts'), 0);
});
await test('pressing again returns the same receipt and spends no number', async () => {
  const db = await fresh();
  const a = await issue(db, PAY.V1);
  const b = await issue(db, PAY.V1, 'Someone Else', 'Another Person');
  eq(b.id, a.id); eq(b.receipt_no, a.receipt_no); eq(b.received_from, 'Sample Client');
  eq(await n(db, 'select count(*) n from pm_billing_receipts'), 1);
  eq((await rows(db, 'select last_no from billing_receipt_counters')).map(x => x.last_no), [1]);
});
await test('Project Control and Project Management share one number series', async () => {
  const db = await fresh();
  const m = await ym(db);
  eq((await barIssue(db, P.BILL3)).receipt_no, `AR-${m}-001`);
  eq((await issue(db, PAY.V1)).receipt_no, `AR-${m}-002`);
  eq((await barIssue(db, P.DOWN)).receipt_no, `AR-${m}-003`);
  eq((await issue(db, PAY.P1)).receipt_no, `AR-${m}-004`);
});

console.log('\nVoid and re-issue');
await test('void and re-issue keeps the old receipt and takes the new paid amount', async () => {
  const db = await fresh();
  const old = await issue(db, PAY.V1);
  await admin(db);
  await db.exec(`update payment_requests set amount_paid = 390000, paid_amount = 390000, total_amount = 390000 where id = '${PAY.V1}'`);
  await as(db, I.OWNER);
  const r = await reissue(db, old.id);
  eq(Number(r.amount), 390000, 'new amount');
  assert(r.receipt_no !== old.receipt_no, 'new number');
  await admin(db);
  const was = await one(db, 'select voided_at, void_reason from pm_billing_receipts where id = $1', [old.id]);
  assert(was.voided_at !== null, 'old voided');
  eq(was.void_reason, 'Amount corrected');
  eq(await n(db, `select count(*) n from pm_billing_receipts where payment_id = '${PAY.V1}' and voided_at is null`), 1);
});
await test('re-issue needs a reason, and a void receipt cannot be voided again', async () => {
  const db = await fresh();
  const old = await issue(db, PAY.V1);
  assert((await err(reissue(db, old.id, '   '))).includes('REASON_REQUIRED'), 'reason');
  await reissue(db, old.id);
  assert((await err(reissue(db, old.id))).includes('ALREADY_VOID'), 'already void');
});
await test('a receipt can never be edited or deleted', async () => {
  const db = await fresh();
  const r = await issue(db, PAY.V1);
  await admin(db);
  assert((await err(db.query('update pm_billing_receipts set amount = 1 where id = $1', [r.id]))).includes('RECEIPT_PERMANENT'), 'edit');
  assert((await err(db.query('delete from pm_billing_receipts where id = $1', [r.id]))).includes('RECEIPT_PERMANENT'), 'delete');
});

console.log('\nWho may');
await test("staff and clients are refused, and another company's project is not found", async () => {
  const db = await fresh();
  await issue(db, PAY.V1);
  for (const who of [I.STAFF, I.CLIENT]) {
    await as(db, who);
    assert((await err(state(db, PM.A))).includes('OWNER_ONLY'), 'state refused for ' + who);
    assert((await err(issue(db, PAY.V1))).includes('OWNER_ONLY'), 'issue refused for ' + who);
  }
  await as(db, I.STAFF);
  eq((await rows(db, 'select * from pm_billing_receipts')).length, 0, 'staff read nothing');
  eq((await err(db.query('select * from pm_billing_receipt_parties'))).includes('permission denied'), true, 'names table closed');
  await as(db, I.OWNER);
  assert((await err(state(db, PM.B))).includes('NOT_FOUND'), 'other project state');
  assert((await err(issue(db, PAY.B1))).includes('NOT_FOUND'), 'other project payment');
});

console.log('\nState');
await test('pmar_state lists paid payments oldest first with the total, receipts and names', async () => {
  const db = await fresh();
  await barIssue(db, P.BILL3);                 // Received by last used in Project Control
  const s = await state(db, PM.A);
  eq(s.payments.map(p => p.id), [PAY.P1, PAY.V2, PAY.V1], 'order');
  eq(s.payments.map(p => Number(p.amount)), [200000, 140000.5, 389000], 'amounts');
  eq(s.payments.map(p => p.label), ['Payment received (Jul 24, 2026)', 'Payment received (Oct 2, 2026)',
                                     'Payment received (Nov 13, 2026) · Ref. GC-123'], 'labels');
  eq(s.payments.map(p => p.date), ['2026-07-24', '2026-10-02', '2026-11-13'], 'dates');
  eq(s.payments[2].reference, 'GC-123'); eq(s.payments[2].source, 'manual_payment');
  eq(Number(s.total_received), 729000.5, 'total');
  const sorted = (o) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));
  eq(sorted(s.project), sorted({ id: PM.A, name: 'Sample Residence', address: 'Quezon City', client_name: 'Sample Client',
                                 client_email: 'client@x.test', budget: 1000000 }), 'project');
  eq(s.received_from, 'Sample Client', 'client name first');
  eq(s.received_by, 'Cristher Dacome', 'from Project Control');
  eq(s.business.name, "DAC'S Building Design Services");
  eq(s.payment_details.bank, 'Sample Bank');
  eq(s.receipts, []);
});
await test('names typed once: Received from per project, Received by across both systems', async () => {
  const db = await fresh();
  await issue(db, PAY.V1, 'Client X', 'Person Y');
  eq((await state(db, PM.A)).received_from, 'Client X');
  eq((await state(db, PM.Z)).received_from, 'Zero Client', 'other project keeps its client name');
  eq((await state(db, PM.Z)).received_by, 'Person Y', 'Received by follows');
});
await test('state for a project with no payments', async () => {
  const db = await fresh();
  const s = await state(db, PM.Z);
  eq(s.payments, []); eq(Number(s.total_received), 0); eq(s.project.budget, null);
});
await test('state keeps the receipt of a payment that is no longer paid', async () => {
  const db = await fresh();
  const r = await issue(db, PAY.V1);
  await admin(db);
  await db.exec(`update payment_requests set status = 'submitted' where id = '${PAY.V1}'`);
  await as(db, I.OWNER);
  const s = await state(db, PM.A);
  assert(!s.payments.some(p => p.id === PAY.V1), 'not listed as paid');
  eq(s.receipts.map(x => x.id), [r.id], 'receipt kept');
  assert((await err(issue(db, PAY.V1))).includes('no error'), 'pressing again returns the live receipt');
});
await test('a long or odd reference is stored raw and cut to 200', async () => {
  const db = await fresh();
  await admin(db);
  await db.query('update payment_requests set reference_number = $1 where id = $2', [`<b>&"'` + 'x'.repeat(300), PAY.V1]);
  await as(db, I.OWNER);
  const r = await issue(db, PAY.V1);
  eq(r.billing_label.length, 200);
  assert(r.billing_label.startsWith(`Payment received (Nov 13, 2026) · Ref. <b>&"'x`), r.billing_label.slice(0, 60));
});

console.log('\nBoundaries');
await test('nothing outside the receipt tables changes', async () => {
  const db = await fresh();
  const snap = async () => {
    await admin(db);
    const out = [];
    for (const t of ['payment_requests', 'expenses', 'invoices', 'projects', 'project_budgets', 'construction_projects']) {
      out.push((await one(db, `select count(*) c, md5(coalesce(string_agg(t::text, '' order by t::text), '')) h from ${t} t`)));
    }
    await as(db, I.OWNER);
    return out;
  };
  const before = await snap();
  const r = await issue(db, PAY.V1);
  await reissue(db, r.id);
  await state(db, PM.A);
  eq(await snap(), before);
});
await test('proof_url exists, and payment photos follow the payment rows: every office account, never a client or worker', async () => {
  const db = await fresh();
  await admin(db);
  const col = await one(db, `select data_type, is_nullable from information_schema.columns where table_name = 'payment_requests' and column_name = 'proof_url'`);
  eq(col, { data_type: 'text', is_nullable: 'YES' });
  // The browser files a photo under its own currentDataUserId: the main owner's id for the
  // main owner and staff, admin-pm@'s OWN id for admin-pm@ (owner role). All three see
  // every PM payment row, so all three must open every photo.
  const file = (folder) => `paymentReceipts/${folder}/2026-11/11111111-2222-4333-8444-555555555555.jpg`;
  const can = async (who, path) => {
    await as(db, who);
    const r = await one(db, 'select uploads_can_read($1, null) r, uploads_can_write($1) w', [path]);
    return [r.r, r.w];
  };
  for (const folder of [I.OWNER, I.PMOWNER]) {
    for (const who of [I.OWNER, I.PMOWNER, I.STAFF]) eq(await can(who, file(folder)), [true, true], `${who} on ${folder}'s photo`);
    eq(await can(I.CLIENT, file(folder)), [false, false], 'client');
    eq(await can(I.W1, file(folder)), [false, false], 'worker');
  }
  // Photo access is the same as access to the payment rows themselves (payreq_admin: owner or staff).
  await as(db, I.PMOWNER);
  eq((await rows(db, 'select id from payment_requests')).length, 7, 'admin-pm@ sees every payment row');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) { failures.forEach(f => console.log('  - ' + f)); process.exit(1); }
