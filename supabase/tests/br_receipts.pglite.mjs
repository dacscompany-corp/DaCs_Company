// ═════════════════════════════════════════════════
// BILLING ACKNOWLEDGEMENT RECEIPTS (0114) — BEHAVIOUR TESTS ON PGLITE
//   npm run test:sql
// Runs 0114 VERBATIM over br_base.mjs.
// Terms: docs/superpowers/specs/2026-11-09-billing-acknowledgement-receipts-mvp-terms.md
// ═════════════════════════════════════════════════
import { PGlite } from '@electric-sql/pglite';
import { BR_SETUP, M114, IDS as I, seed, seedReceipts, F, P } from './br_base.mjs';

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
const issue = async (db, period, from = 'MH Interior', by = 'Cristher Dacome') => (await one(db, 'select bar_issue($1,$2,$3) r', [period, from, by])).r;
const reissue = async (db, id, reason = 'Fund Allocated changed', from = 'MH Interior', by = 'Cristher Dacome') => (await one(db, 'select bar_reissue($1,$2,$3,$4) r', [id, reason, from, by])).r;
const state = async (db, folder) => (await one(db, 'select bar_state($1) r', [folder])).r;
const n = async (db, sql) => { await admin(db); return Number((await one(db, sql)).n); };

async function fresh() {
  const db = new PGlite();
  for (const part of BR_SETUP) await db.exec(part);
  await db.exec(M114);
  await seed((sql) => db.exec(sql));
  await seedReceipts((sql) => db.exec(sql));
  await as(db, I.OWNER);
  return db;
}
const ym = async (db) => (await one(db, `select to_char((now() at time zone 'Asia/Manila')::date, 'YYYYMM') v`)).v;

console.log('\nBilling Acknowledgement Receipts — 0114 behaviour');

console.log('\nIssuing');
await test('a receipt takes its amount from Fund Allocated and its label from the billing', async () => {
  const db = await fresh();
  const r = await issue(db, P.BILL3);
  eq(Number(r.amount), 159000, 'amount');
  eq(r.billing_label, 'Progress Billing 3 (November 2026)', 'label');
  eq(r.receipt_no, `AR-${await ym(db)}-001`, 'number');
  eq([r.received_from, r.received_by], ['MH Interior', 'Cristher Dacome'], 'names');
  eq(r.folder_id, F.A, 'folder');
  assert(r.voided_at === null, 'live');
});
await test('there is no way to pass an amount: bar_issue takes a period and two names only', async () => {
  const db = await fresh();
  const args = (await one(db, `select pg_get_function_identity_arguments('bar_issue'::regproc) a`)).a;
  eq(args, 'p_period uuid, p_received_from text, p_received_by text');
});
await test('centavos survive, and other billing types are labelled', async () => {
  const db = await fresh();
  const r = await issue(db, P.DOWN);
  eq(Number(r.amount), 50000.5);
  eq(r.billing_label, 'Downpayment (October 2026)');
  eq((await issue(db, P.BLANK)).billing_label, 'Billing Period (December 2026)');
});
await test('pressing again returns the same receipt and uses no new number', async () => {
  const db = await fresh();
  const a = await issue(db, P.BILL3);
  const b = await issue(db, P.BILL3, 'Someone Else', 'Another Person');
  eq(b.id, a.id); eq(b.receipt_no, a.receipt_no); eq(b.received_from, 'MH Interior');
  eq(await n(db, 'select count(*) n from billing_receipts'), 1);
  eq((await rows(db, 'select last_no from billing_receipt_counters')).map(x => x.last_no), [1]);
});
await test('numbers run in order across projects, and past 999 they keep every digit', async () => {
  const db = await fresh();
  const m = await ym(db);
  eq((await issue(db, P.BILL3)).receipt_no, `AR-${m}-001`);
  eq((await issue(db, P.OTHER_SITE)).receipt_no, `AR-${m}-002`);
  await admin(db);
  await db.exec(`update billing_receipt_counters set last_no = 999`);
  await as(db, I.OWNER);
  eq((await issue(db, P.DOWN)).receipt_no, `AR-${m}-1000`);
});
await test('names are trimmed and required', async () => {
  const db = await fresh();
  eq((await issue(db, P.BILL3, '  MH  ', ' Ana ')).received_from, 'MH');
  assert((await err(issue(db, P.DOWN, '   ', 'Ana'))).includes('NAME_REQUIRED'), 'blank payer');
  assert((await err(issue(db, P.DOWN, 'MH', ''))).includes('NAME_REQUIRED'), 'blank signer');
  assert((await err(issue(db, P.DOWN, 'x'.repeat(201), 'Ana'))).includes('NAME_TOO_LONG'), 'long');
});

console.log('\nRefusals');
await test('Cover periods and periods with no Fund Allocated get no receipt', async () => {
  const db = await fresh();
  assert((await err(issue(db, P.COVER))).includes('COVER_PERIOD'), 'cover');
  assert((await err(issue(db, P.ZERO))).includes('NO_FUND_ALLOCATED'), 'zero');
  eq(await n(db, 'select count(*) n from billing_receipts'), 0);
  eq(await n(db, 'select count(*) n from billing_receipt_counters'), 0, 'a refusal spends no number');
});
await test('staff, workers, clients and partners are refused every function', async () => {
  const db = await fresh();
  const receipt = await issue(db, P.BILL3);
  for (const uid of [I.STAFF, I.W1, I.LEAD, I.CLIENT, I.PARTNER]) {
    await as(db, uid);
    assert((await err(issue(db, P.DOWN))).includes('OWNER_ONLY'), 'issue ' + uid);
    assert((await err(state(db, F.A))).includes('OWNER_ONLY'), 'state ' + uid);
    assert((await err(reissue(db, receipt.id))).includes('OWNER_ONLY'), 'reissue ' + uid);
    assert((await err(one(db, 'select bar_set_parties($1,$2,$3)', [F.A, 'x', 'y']))).includes('OWNER_ONLY'), 'parties ' + uid);
  }
});
await test('another company\'s billing, project and receipt read as not found', async () => {
  const db = await fresh();
  const mine = await issue(db, P.BILL3);
  assert((await err(issue(db, P.B))).includes('NOT_FOUND'), 'period');
  assert((await err(state(db, F.B))).includes('NOT_FOUND'), 'folder');
  await as(db, I.OTHER);
  assert((await err(reissue(db, mine.id))).includes('NOT_FOUND'), 'receipt');
});
await test('a switched-off owner and a signed-out caller are refused', async () => {
  const db = await fresh();
  await admin(db);
  assert((await err(state(db, F.A))).includes('NOT_SIGNED_IN'), 'signed out');
  await db.exec(`update profiles set status = 'inactive' where id = '${I.PMOWNER}'`);
  await as(db, I.PMOWNER);
  assert((await err(state(db, F.A))).includes('INACTIVE'), 'inactive');
});
await test('an owner account of the same company can issue', async () => {
  const db = await fresh();
  await as(db, I.PMOWNER);
  const r = await issue(db, P.BILL3);
  eq(r.owner_id, I.OWNER, 'the company owns it');
  eq(r.created_by, I.PMOWNER, 'who pressed it is kept');
});

console.log('\nVoid and re-issue');
await test('re-issuing voids the old receipt with its reason and gives a new number and the new amount', async () => {
  const db = await fresh();
  const old = await issue(db, P.BILL3);
  await admin(db);
  await db.exec(`update project_budgets set monthly_budget = 200000 where project_id = '${P.BILL3}'`);
  await as(db, I.OWNER);
  const fresh2 = await reissue(db, old.id, 'Client added funds');
  assert(fresh2.id !== old.id, 'new row');
  eq(Number(fresh2.amount), 200000, 'new amount');
  eq(fresh2.receipt_no, `AR-${await ym(db)}-002`, 'new number');
  const was = await one(db, 'select * from billing_receipts where id = $1', [old.id]);
  assert(was.voided_at, 'voided');
  eq(was.void_reason, 'Client added funds');
  eq(was.voided_by, I.OWNER);
  eq(Number(was.amount), 159000, 'old amount kept');
  eq(was.receipt_no, old.receipt_no, 'old number kept');
});
await test('a re-issue needs a reason, and a voided receipt cannot be voided twice', async () => {
  const db = await fresh();
  const old = await issue(db, P.BILL3);
  assert((await err(reissue(db, old.id, '  '))).includes('REASON_REQUIRED'), 'blank');
  assert((await err(reissue(db, old.id, 'x'.repeat(501)))).includes('REASON_TOO_LONG'), 'long');
  await reissue(db, old.id);
  assert((await err(reissue(db, old.id))).includes('ALREADY_VOID'), 'twice');
  eq(await n(db, 'select count(*) n from billing_receipts where voided_at is null'), 1, 'one live');
});
await test('a refused re-issue leaves the old receipt live and spends no number', async () => {
  const db = await fresh();
  const old = await issue(db, P.BILL3);
  await admin(db);
  await db.exec(`update project_budgets set monthly_budget = 0 where project_id = '${P.BILL3}'`);
  await as(db, I.OWNER);
  assert((await err(reissue(db, old.id))).includes('NO_FUND_ALLOCATED'), 'refused');
  eq(await n(db, 'select count(*) n from billing_receipts where voided_at is null'), 1, 'still live');
  eq((await rows(db, 'select last_no from billing_receipt_counters')).map(x => x.last_no), [1], 'no number spent');
});
await test('a voided number is never used again, even after issuing more', async () => {
  const db = await fresh();
  const a = await issue(db, P.BILL3);
  const b = await reissue(db, a.id);
  const c = await issue(db, P.DOWN);
  const nos = [a.receipt_no, b.receipt_no, c.receipt_no];
  eq(new Set(nos).size, 3, nos.join());
});

console.log('\nFrozen once issued');
await test('later settings or Fund Allocated changes leave an issued receipt alone', async () => {
  const db = await fresh();
  const r = await issue(db, P.BILL3);
  eq(r.payment_details.bank, 'Sample Bank', 'copied');
  eq(r.business.name, "DAC'S Building Design Services", 'copied');
  assert(r.business.logos === undefined, 'logo images are not copied');
  await admin(db);
  await db.exec(`update settings set value = '{"businessName":"New Name","paymentDetails":{"method":"gcash","gcashNumber":"09"}}'::jsonb where key = 'invoiceDefaults'`);
  await db.exec(`update project_budgets set monthly_budget = 1 where project_id = '${P.BILL3}'`);
  await as(db, I.OWNER);
  const again = await issue(db, P.BILL3);
  eq(Number(again.amount), 159000); eq(again.payment_details.bank, 'Sample Bank'); eq(again.business.name, "DAC'S Building Design Services");
});
await test('even the database owner cannot change, un-void or delete a receipt', async () => {
  const db = await fresh();
  const r = await issue(db, P.BILL3);
  await admin(db);
  for (const sql of [`update billing_receipts set amount = 1`, `update billing_receipts set receipt_no = 'X'`, `update billing_receipts set received_from = 'X'`, `delete from billing_receipts`]) {
    assert((await err(db.exec(sql))).includes('RECEIPT_PERMANENT'), sql);
  }
  await as(db, I.OWNER);
  await reissue(db, r.id);
  await admin(db);
  assert((await err(db.exec(`update billing_receipts set voided_at = null, voided_by = null, void_reason = null where id = '${r.id}'`))).includes('RECEIPT_PERMANENT'), 'un-void');
});
await test('deleting a billing period keeps its receipt', async () => {
  const db = await fresh();
  const r = await issue(db, P.BILL3);
  await admin(db);
  await db.exec(`delete from projects where id = '${P.BILL3}'`);
  eq(await n(db, `select count(*) n from billing_receipts where id = '${r.id}'`), 1);
});

console.log('\nNames are remembered');
await test('the payer is remembered per project and the signer across projects', async () => {
  const db = await fresh();
  await issue(db, P.BILL3, 'MH Interior', 'Cristher Dacome');
  const a = await state(db, F.A);
  eq([a.received_from, a.received_by], ['MH Interior', 'Cristher Dacome']);
  const other = await state(db, F.A2);
  eq([other.received_from, other.received_by], ['', 'Cristher Dacome'], 'a new project asks for its own payer');
  await as(db, I.OTHER);
  eq((await state(db, F.B)).received_by, '', 'another company never sees this one\'s names');
});
await test('changing a name is remembered for later receipts and leaves old ones alone', async () => {
  const db = await fresh();
  const old = await issue(db, P.BILL3, 'Old Payer', 'Ana');
  await one(db, 'select bar_set_parties($1,$2,$3)', [F.A, 'New Payer', 'Ben']);
  const s = await state(db, F.A);
  eq([s.received_from, s.received_by], ['New Payer', 'Ben']);
  eq((await one(db, 'select received_from from billing_receipts where id = $1', [old.id])).received_from, 'Old Payer');
  assert((await err(one(db, 'select bar_set_parties($1,$2,$3)', [F.A, ' ', 'Ben']))).includes('NAME_REQUIRED'), 'blank');
  assert((await err(one(db, 'select bar_set_parties($1,$2,$3)', [F.B, 'x', 'y']))).includes('NOT_FOUND'), 'other company');
});

console.log('\nWhat the page is told');
await test('the state lists client billings, and the total leaves Cover out', async () => {
  const db = await fresh();
  const s = await state(db, F.A);
  eq(Number(s.total_received), 159000 + 50000.5 + 1000, 'total');
  const ids = s.periods.map(p => p.id);
  assert(ids.includes(P.BILL3) && ids.includes(P.ZERO), 'client periods');
  assert(!ids.includes(P.COVER), 'no Cover');
  eq(s.periods.find(p => p.id === P.BILL3).label, 'Progress Billing 3 (November 2026)');
  eq(s.folder.name, 'Alpha House');
  eq(s.payment_details.bank, 'Sample Bank');
  eq(s.business.address, 'Quezon City');
  assert(!JSON.stringify(s).includes('big-image-data'), 'no logo images');
});
await test('the state lists this project\'s receipts, voided ones included', async () => {
  const db = await fresh();
  const a = await issue(db, P.BILL3);
  await reissue(db, a.id);
  await issue(db, P.OTHER_SITE);
  const s = await state(db, F.A);
  eq(s.receipts.length, 2);
  eq(s.receipts.filter(r => r.voided_at).length, 1);
});

console.log('\nAccess');
await test('owners read their company\'s receipts; staff, clients and other companies see none', async () => {
  const db = await fresh();
  await issue(db, P.BILL3);
  eq((await rows(db, 'select id from billing_receipts')).length, 1, 'owner');
  await as(db, I.PMOWNER);
  eq((await rows(db, 'select id from billing_receipts')).length, 1, 'same-company owner');
  for (const uid of [I.STAFF, I.CLIENT, I.PARTNER, I.W1, I.OTHER]) {
    await as(db, uid);
    eq((await rows(db, 'select id from billing_receipts')).length, 0, uid);
  }
});
await test('nobody writes directly, and the counter and names tables stay closed', async () => {
  const db = await fresh();
  await issue(db, P.BILL3);
  const denied = async (sql) => assert((await err(db.exec(sql))).includes('permission denied'), sql);
  await denied(`insert into billing_receipts (owner_id, folder_id, period_id, receipt_no, issued_on, billing_label, amount, received_from, received_by, created_by)
    values ('${I.OWNER}', '${F.A}', '${P.DOWN}', 'AR-X', now(), 'x', 1, 'x', 'x', '${I.OWNER}')`);
  await denied(`update billing_receipts set amount = 1`);
  await denied(`delete from billing_receipts`);
  await denied(`select * from billing_receipt_counters`);
  await denied(`select * from billing_receipt_parties`);
  await denied(`insert into billing_receipt_parties (folder_id, owner_id) values ('${F.A2}', '${I.OWNER}')`);
});
await test('signed-out visitors can reach nothing; helper functions are private', async () => {
  const db = await fresh();
  await admin(db);
  const can = async (role, fn) => (await one(db, `select has_function_privilege($1, $2, 'execute') v`, [role, fn])).v;
  for (const fn of ['bar_state(uuid)', 'bar_issue(uuid,text,text)', 'bar_reissue(uuid,text,text,text)', 'bar_set_parties(uuid,text,text)']) {
    eq(await can('authenticated', fn), true, 'authenticated ' + fn);
    eq(await can('anon', fn), false, 'anon ' + fn);
  }
  for (const fn of ['bar_company()', 'bar_period_label(text,integer,text,integer)', 'bar_new_receipt(uuid,uuid,text,text)', 'bar_save_parties(uuid,uuid,text,text)', 'billing_receipts_guard()']) {
    eq(await can('authenticated', fn), false, 'authenticated ' + fn);
    eq(await can('anon', fn), false, 'anon ' + fn);
  }
  eq((await one(db, `select has_table_privilege('anon', 'billing_receipts', 'select') v`)).v, false, 'anon table');
});

console.log('\nOutside the money model');
await test('issuing and re-issuing touch no expense, payroll, invoice, budget or billing period', async () => {
  const db = await fresh();
  await admin(db);
  await db.exec(`insert into expenses (owner_id, project_id, amount) values ('${I.OWNER}', '${P.BILL3}', 10);
                 insert into invoices (owner_id, total_amount) values ('${I.OWNER}', 10);
                 insert into payroll (owner_id, project_id, worker_name, total_salary) values ('${I.OWNER}', '${P.BILL3}', 'A', 10);`);
  const snap = async () => {
    await admin(db);
    const o = {};
    for (const t of ['expenses', 'payroll', 'invoices', 'project_budgets', 'projects', 'folders']) o[t] = (await rows(db, `select * from ${t} order by 1`));
    return JSON.stringify(o);
  };
  const before = await snap();
  await as(db, I.OWNER);
  const r = await issue(db, P.BILL3);
  await reissue(db, r.id);
  await state(db, F.A);
  await one(db, 'select bar_set_parties($1,$2,$3)', [F.A, 'x', 'y']);
  eq(await snap(), before);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) { failures.forEach(f => console.log('  - ' + f)); process.exit(1); }
