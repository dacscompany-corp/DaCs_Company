// ════════════════════════════════════════════════════════════════════
// LINKED LABOR (0113) — BEHAVIOUR TESTS ON PGLITE
//   npm run test:sql
// Runs 0098 and 0113 VERBATIM over ll_base.mjs. Terms:
// docs/superpowers/specs/2026-11-04-workmate-linked-labor-contracts-mvp-terms.md
// Design: docs/superpowers/specs/2026-11-07-workmate-linked-labor-design.md
// ════════════════════════════════════════════════════════════════════
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { LL_PRE, LL_TABLES, LL_HELPERS, M98, M113, IDS, seed, ROOT } from './ll_base.mjs';

const I = IDS;
let passed = 0, failed = 0;
const failures = [];
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { failed++; failures.push(name + ' — ' + e.message); console.log('  FAIL ' + name + '\n       ' + e.message); }
}
function assert(c, m) { if (!c) throw new Error(m); }
// jsonb sorts object keys, so compare objects with sorted keys.
const canon = (v) => Array.isArray(v) ? v.map(canon)
  : (v && typeof v === 'object') ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canon(v[k])])) : v;
function eq(a, b, m) { if (JSON.stringify(canon(a)) !== JSON.stringify(canon(b))) throw new Error((m || 'not equal') + ': ' + JSON.stringify(a) + ' !== ' + JSON.stringify(b)); }
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

async function as(db, uid) {
  await db.exec(`reset role; select set_config('test.uid', '${uid || ''}', false);`);
  if (uid) await db.exec('set role authenticated');
}
async function admin(db) { await db.exec(`reset role; select set_config('test.uid', '', false);`); }
async function one(db, sql, params = []) { return (await db.query(sql, params)).rows[0]; }
async function rows(db, sql, params = []) { return (await db.query(sql, params)).rows; }
async function err(promise) { try { await promise; return 'no error'; } catch (e) { return e.message; } }
async function n(db, sql, params = []) { await admin(db); return Number((await one(db, sql, params)).n); }

const F = {
  A1: '00000000-0000-0000-0000-0000000f0001', // Alpha House
  AW: '00000000-0000-0000-0000-0000000f0002', // Alpha Additional Works (child of A1)
  A2: '00000000-0000-0000-0000-0000000f0003', // Beta House (completed)
  A3: '00000000-0000-0000-0000-0000000f0004', // Gamma House (no BOQ)
  B1: '00000000-0000-0000-0000-0000000f0009', // company B
};

async function fresh() {
  const db = new PGlite();
  await db.exec(LL_PRE);
  await db.exec(LL_TABLES);
  await db.exec(LL_HELPERS);
  await db.exec(M98);
  await db.exec(M113);
  await seed((sql) => db.exec(sql));
  await db.exec(`insert into folders (id, owner_id, name, parent_folder_id, completed_at) values
    ('${F.A1}', '${I.OWNER}', 'Alpha House', null, null),
    ('${F.AW}', '${I.OWNER}', 'Alpha Additional Works', '${F.A1}', null),
    ('${F.A2}', '${I.OWNER}', 'Beta House', null, '2026-10-30T00:00:00Z'),
    ('${F.A3}', '${I.OWNER}', 'Gamma House', null, null),
    ('${F.B1}', '${I.OTHER}', 'Other Co House', null, null);`);
  return db;
}

const DEF = { owner: I.OWNER, folder: F.A1, name: 'Juan Cruz', scope: 'Masonry works', trade: 'Masonry',
              amount: 50000, basis: 'fixed', category: 'labor', works: [], signed: false, worker: null };
async function contract(db, uid, o = {}) {
  const c = { ...DEF, ...o };
  await as(db, uid);
  const r = await one(db, `insert into labor_contracts (owner_id, folder_id, worker_name, scope, trade, agreed_amount,
      pay_type, status, cap_history, category, works, pay_basis, agreement_signed, worker_id)
    values ($1, $2, $3, $4, $5, $6, 'pakyaw', 'ongoing', $7::jsonb, $8, $9::jsonb, $10, $11, $12) returning *`,
    [c.owner, c.folder, c.name, c.scope, c.trade, c.amount,
     JSON.stringify([{ amount: c.amount, at: '2026-11-01T00:00:00.000Z', note: 'Initial cap' }]),
     c.category, JSON.stringify(c.works), c.basis, c.signed, c.worker]);
  await admin(db);
  return r;
}
async function pay(db, contractId, o = {}) {
  await as(db, I.OWNER);
  const r = await one(db, `insert into payroll (owner_id, worker_name, labor_type, total_salary, payment_date,
      notes, contract_id, split_group, split_index, payment_method, liability_for, receipt_images, pay_milestone)
    values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13) returning *`,
    [I.OWNER, o.name || 'Juan Cruz', o.type || 'direct', o.amount ?? 1000, o.date || '2026-11-02',
     o.notes || 'paid at site', contractId, o.group || null, o.index ?? null, has(o, 'method') ? o.method : 'cash',
     o.liabilityFor || null, JSON.stringify(o.receipts || ['receipts/x.jpg']), o.milestone || 'DP']);
  await admin(db);
  return r;
}
async function call(db, uid, sql, params = []) { await as(db, uid); try { return (await one(db, sql, params)).r; } finally { await admin(db); } }
const link = (db, uid, c, w, no, reason = '') => call(db, uid, 'select lc_link($1, $2, $3, $4) r', [c, w, no, reason]);
const edit = (db, uid, c, changes, reason = '') => call(db, uid, 'select lc_edit($1, $2::jsonb, $3) r', [c, JSON.stringify(changes), reason]);
const end = (db, uid, c, reason) => call(db, uid, 'select lc_end($1, $2) r', [c, reason]);
const reopen = (db, uid, c, reason) => call(db, uid, 'select lc_reopen($1, $2) r', [c, reason]);
const del = (db, uid, c, reason = '') => call(db, uid, 'select lc_delete($1, $2) r', [c, reason]);
const merge = (db, uid, ids, keeper, title, reason = '') => call(db, uid, 'select lc_merge($1::uuid[], $2, $3, $4) r', [ids, keeper, title, reason]);
const mine = (db, uid) => call(db, uid, 'select ll_my_agreements() r');
async function events(db, contractId) {
  await admin(db);
  return rows(db, 'select kind, before, after, reason, actor_id from lc_events where contract_id = $1 order by id', [contractId]);
}
async function paidOf(db, id) {
  return Number((await one(db, `select coalesce(sum(total_salary), 0) s from payroll p where contract_id = $1 and lc_draws_down(p)`, [id])).s);
}

// ════ A. Structure and privileges ════════════════════════════════════

await test('A1 columns and history table exist; history has RLS on', async () => {
  const db = await fresh();
  const cols = (await rows(db, `select column_name from information_schema.columns where table_name = 'labor_contracts'
                                 and column_name in ('worker_id', 'ended_at', 'ended_by') order by 1`)).map(r => r.column_name);
  eq(cols, ['ended_at', 'ended_by', 'worker_id']);
  eq((await one(db, `select relrowsecurity r from pg_class where relname = 'lc_events'`)).r, true);
});

await test('A2 anon can run nothing; authenticated only the public functions; internals have no grant', async () => {
  const db = await fresh();
  const pub = ['lc_link_candidates()', 'lc_link(uuid,uuid,integer,text)', 'lc_edit(uuid,jsonb,text)', 'lc_end(uuid,text)',
               'lc_reopen(uuid,text)', 'lc_delete(uuid,text)', 'lc_merge(uuid[],uuid,text,text)', 'll_my_agreements()'];
  const internal = ['lc_terms(labor_contracts)', 'lc_blank_free(jsonb)', 'lc_established(uuid,boolean)', 'lc_history_appended(jsonb,jsonb)',
                    'lc_person_name(uuid)', 'lc_who(uuid)', 'lc_eligible_worker(uuid,uuid)', 'lc_office_company()',
                    'lc_owner_company()', 'lc_check_link(uuid,uuid,text)', 'lc_works_list(jsonb)', 'lc_draws_down(payroll)',
                    'lc_guard()', 'lc_log()', 'll_num(jsonb)', 'll_truthy(jsonb)', 'll_folder_progress(uuid)', 'lc_events_no_change()'];
  for (const f of pub) {
    eq((await one(db, `select has_function_privilege('anon', '${f}', 'execute') r`)).r, false, 'anon ' + f);
    eq((await one(db, `select has_function_privilege('authenticated', '${f}', 'execute') r`)).r, true, 'auth ' + f);
  }
  for (const f of internal) {
    eq((await one(db, `select has_function_privilege('authenticated', '${f}', 'execute') r`)).r, false, 'auth ' + f);
    eq((await one(db, `select has_function_privilege('anon', '${f}', 'execute') r`)).r, false, 'anon ' + f);
  }
});

await test('A3 history: authenticated may only select; nobody may update, delete or truncate', async () => {
  const db = await fresh();
  for (const p of ['insert', 'update', 'delete', 'truncate']) {
    eq((await one(db, `select has_table_privilege('authenticated', 'lc_events', '${p}') r`)).r, false, p);
  }
  eq((await one(db, `select has_table_privilege('authenticated', 'lc_events', 'select') r`)).r, true);
  const c = await contract(db, I.OWNER);
  assert((await events(db, c.id)).length === 1, 'created event');
  assert((await err(db.exec(`update lc_events set reason = 'x'`))).includes('LC_EVENTS_APPEND_ONLY'), 'update');
  assert((await err(db.exec(`delete from lc_events`))).includes('LC_EVENTS_APPEND_ONLY'), 'delete');
  assert((await err(db.exec(`truncate lc_events`))).includes('LC_EVENTS_APPEND_ONLY'), 'truncate');
});

await test('A4 history is readable by owner accounts of the company only', async () => {
  const db = await fresh();
  await contract(db, I.OWNER);
  for (const [u, want] of [[I.OWNER, 1], [I.PMOWNER, 1], [I.STAFF, 0], [I.W1, 0], [I.OTHER, 0], [I.CLIENT, 0]]) {
    await as(db, u);
    eq(Number((await one(db, 'select count(*)::int n from lc_events')).n), want, 'reader ' + u);
  }
});

// ════ B. Creating a contract ═════════════════════════════════════════

await test('B1 staff create with a typed name as today, logged as created', async () => {
  const db = await fresh();
  const c = await contract(db, I.STAFF);
  const ev = await events(db, c.id);
  eq(ev.map(e => e.kind), ['created']);
  eq(ev[0].actor_id, I.STAFF);
  eq(ev[0].after.scope, 'Masonry works');
});

await test('B2 only the main owner may choose an account when creating', async () => {
  const db = await fresh();
  for (const u of [I.STAFF, I.PMOWNER]) {
    assert((await err(contract(db, u, { worker: I.W1 }))).includes('OWNER_ONLY'), 'creator ' + u);
  }
  const c = await contract(db, I.OWNER, { worker: I.W1 });
  eq(c.worker_id, I.W1);
  const ev = await events(db, c.id);
  eq(ev.map(e => e.kind), ['created', 'linked']);
  eq(ev[1].after.worker_no, 13);
  eq(ev[1].after.recorded_name, 'Juan Cruz');
});

await test('B3 creating with an ineligible account or a vendor contract is refused', async () => {
  const db = await fresh();
  for (const w of [I.GONE, I.WB, I.CLIENT, I.STAFF, I.OWNER, I.PARTNER]) {
    assert((await err(contract(db, I.OWNER, { worker: w }))).includes('NOT_ELIGIBLE'), 'worker ' + w);
  }
  assert((await err(contract(db, I.OWNER, { worker: I.W1, category: 'outsource' }))).includes('LABOR_ONLY'), 'vendor');
  eq(await n(db, 'select count(*)::int n from labor_contracts'), 0);
});

await test('B4 a new contract cannot start ended', async () => {
  const db = await fresh();
  await as(db, I.OWNER);
  const e = await err(db.query(`insert into labor_contracts (owner_id, folder_id, worker_name, ended_at) values ($1, $2, 'X', now())`, [I.OWNER, F.A1]));
  assert(e.includes('LC_FIELD_LOCKED'), e);
});

// ════ C. Linking ═════════════════════════════════════════════════════

await test('C1 the main owner links; the same link again changes nothing', async () => {
  const db = await fresh();
  const c = await contract(db, I.STAFF);
  const r = await link(db, I.OWNER, c.id, I.W1, 13);
  eq([r.changed, r.worker_id, r.worker_no], [true, I.W1, 13]);
  eq((await link(db, I.OWNER, c.id, I.W1, 13)).changed, false);
  const ev = await events(db, c.id);
  eq(ev.map(e => e.kind), ['created', 'linked']);
  eq(ev[1].before, null);
  eq(ev[1].after.name, 'Juan Cruz');
});

await test('C2 nobody else may link: staff, other owner account, other company, workers, clients', async () => {
  const db = await fresh();
  const c = await contract(db, I.OWNER);
  for (const u of [I.STAFF, I.PMOWNER, I.W1, I.LEAD, I.CLIENT, I.PARTNER]) {
    assert((await err(link(db, u, c.id, I.W1, 13))).includes('OWNER_ONLY'), 'caller ' + u);
  }
  assert((await err(link(db, I.OTHER, c.id, I.W1, 13))).includes('LC_NOT_FOUND'), 'other company');
  await admin(db);
  eq((await one(db, 'select worker_id from labor_contracts where id = $1', [c.id])).worker_id, null);
});

await test('C3 the worker number must match the account (same-name pick)', async () => {
  const db = await fresh();
  const c = await contract(db, I.OWNER);
  assert((await err(link(db, I.OWNER, c.id, I.W2, 13))).includes('WORKER_NO_MISMATCH'), 'W2 is W-0015');
  assert((await err(link(db, I.OWNER, c.id, I.W1, null))).includes('WORKER_NO_MISMATCH'), 'no number');
  for (const w of [I.GONE, I.WB, I.STAFF, I.CLIENT]) {
    assert((await err(link(db, I.OWNER, c.id, w, 13))).includes('NOT_ELIGIBLE'), 'worker ' + w);
  }
});

await test('C4 relinking or unlinking needs a reason and is logged with before and after', async () => {
  const db = await fresh();
  const c = await contract(db, I.OWNER);
  await link(db, I.OWNER, c.id, I.W1, 13);
  assert((await err(link(db, I.OWNER, c.id, I.W2, 15))).includes('REASON_REQUIRED'), 'relink');
  await link(db, I.OWNER, c.id, I.W2, 15, 'Picked the wrong Juan');
  assert((await err(link(db, I.OWNER, c.id, null, null))).includes('REASON_REQUIRED'), 'unlink');
  await link(db, I.OWNER, c.id, null, null, 'Contract is with the crew, not this account');
  const ev = await events(db, c.id);
  eq(ev.map(e => e.kind), ['created', 'linked', 'relinked', 'unlinked']);
  eq([ev[2].before.worker_no, ev[2].after.worker_no, ev[2].reason], [13, 15, 'Picked the wrong Juan']);
  eq([ev[3].before.worker_no, ev[3].after.worker_id], [15, null]);
});

await test('C5 vendor contracts are never linked', async () => {
  const db = await fresh();
  const c = await contract(db, I.OWNER, { category: 'outsource', name: 'ABC Steel' });
  assert((await err(link(db, I.OWNER, c.id, I.W1, 13))).includes('LABOR_ONLY'));
});

await test('C6 linking moves nothing: names, payroll and same-name contracts are untouched', async () => {
  const db = await fresh();
  const c = await contract(db, I.OWNER);
  const twin = await contract(db, I.OWNER, { scope: 'Plastering' });
  await pay(db, c.id, { amount: 3000 }); await pay(db, twin.id, { amount: 2000 });
  await admin(db);
  const before = await rows(db, 'select * from payroll order by id');
  await link(db, I.OWNER, c.id, I.W1, 13);
  await admin(db);
  eq(await rows(db, 'select * from payroll order by id'), before, 'payroll');
  const t = await one(db, 'select worker_id, worker_name from labor_contracts where id = $1', [twin.id]);
  eq([t.worker_id, t.worker_name], [null, 'Juan Cruz']);
  eq((await one(db, 'select worker_name from labor_contracts where id = $1', [c.id])).worker_name, 'Juan Cruz');
});

await test('C7 a direct write of the link, by anyone, is refused', async () => {
  const db = await fresh();
  const c = await contract(db, I.OWNER);
  for (const u of [I.OWNER, I.STAFF]) {
    await as(db, u);
    assert((await err(db.query('update labor_contracts set worker_id = $1 where id = $2', [I.W1, c.id]))).includes('LC_USE_FUNCTION'), 'by ' + u);
  }
  await admin(db);
  assert((await err(db.query('update labor_contracts set worker_id = $1 where id = $2', [I.W1, c.id]))).includes('LC_USE_FUNCTION'), 'by postgres');
});

await test('C8 candidates: the main owner sees active workers and leaders of the company, by number', async () => {
  const db = await fresh();
  const list = await call(db, I.OWNER, 'select lc_link_candidates() r');
  eq(list.map(x => x.worker_no), [13, 15, 17, 23]);
  eq(list[0], { id: I.W1, name: 'Juan Cruz', worker_no: 13, role: 'worker', position: 'Masonry' });
  for (const u of [I.STAFF, I.PMOWNER, I.W1]) {
    assert((await err(call(db, u, 'select lc_link_candidates() r'))).includes('OWNER_ONLY'), 'caller ' + u);
  }
});

// ════ D. Editing terms ═══════════════════════════════════════════════

await test('D1 a draft edits freely and the change is logged (changed fields only)', async () => {
  const db = await fresh();
  const c = await contract(db, I.OWNER);
  await as(db, I.OWNER);
  await db.query(`update labor_contracts set scope = 'Masonry and plastering', agreed_amount = 55000 where id = $1`, [c.id]);
  const ev = (await events(db, c.id)).pop();
  eq(ev.kind, 'edited');
  eq(ev.before, { scope: 'Masonry works', agreed_amount: 50000 });
  eq(ev.after, { scope: 'Masonry and plastering', agreed_amount: 55000 });
  eq(ev.reason, '');
});

await test('D2 once paid, a direct term change is refused; notes stay free and unlogged', async () => {
  const db = await fresh();
  const c = await contract(db, I.OWNER);
  await pay(db, c.id);
  await as(db, I.OWNER);
  assert((await err(db.query(`update labor_contracts set scope = 'x' where id = $1`, [c.id]))).includes('LC_REASON_NEEDED'), 'scope');
  assert((await err(db.query(`update labor_contracts set agreed_amount = 1 where id = $1`, [c.id]))).includes('LC_REASON_NEEDED'), 'amount');
  await db.query(`update labor_contracts set notes = 'call before visit' where id = $1`, [c.id]);
  eq((await events(db, c.id)).map(e => e.kind), ['created']);
});

await test('D3 once signed, the same rules apply (even with no payment)', async () => {
  const db = await fresh();
  // A signed agreement with its file, as the office saves one.
  await as(db, I.OWNER);
  const c = await one(db, `insert into labor_contracts (owner_id, folder_id, worker_name, scope, agreed_amount, category, pay_basis,
      cap_history, works, agreement_signed, agreement_pdf_url, agreement_pdf_name)
    values ($1, $2, 'Juan Cruz', 'Masonry', 50000, 'labor', 'fixed', '[]', '[]', true, 'https://x/signed.pdf', 'signed.pdf') returning *`,
    [I.OWNER, F.A1]);
  assert((await err(db.query(`update labor_contracts set agreement_pdf_url = '' where id = $1`, [c.id]))).includes('LC_REASON_NEEDED'), 'file cleared');
  assert((await err(db.query(`update labor_contracts set agreement_pdf_url = 'https://x/other.pdf' where id = $1`, [c.id]))).includes('LC_REASON_NEEDED'), 'file replaced');
  await admin(db);
});

await test('D4 lc_edit with a reason changes an established contract and logs it', async () => {
  const db = await fresh();
  const c = await contract(db, I.OWNER);
  await pay(db, c.id);
  assert((await err(edit(db, I.OWNER, c.id, { scope: 'Masonry, phase 2' }))).includes('REASON_REQUIRED'), 'no reason');
  const r = await edit(db, I.OWNER, c.id, { scope: 'Masonry, phase 2', agreed_amount: 60000 }, 'Added the rear wall');
  eq([r.established, r.changed.slice().sort()], [true, ['agreed_amount', 'scope']]);
  const ev = (await events(db, c.id)).pop();
  eq([ev.kind, ev.reason, ev.before.agreed_amount, ev.after.agreed_amount], ['edited', 'Added the rear wall', 50000, 60000]);
  eq(await paidOf(db, c.id), 1000, 'payments untouched');
});

await test('D5 lc_edit on a draft needs no reason; nothing changed means no event', async () => {
  const db = await fresh();
  const c = await contract(db, I.STAFF);
  await edit(db, I.STAFF, c.id, { trade: 'Plastering' });
  eq((await edit(db, I.STAFF, c.id, { trade: 'Plastering' })).changed, []);
  eq((await events(db, c.id)).map(e => e.kind), ['created', 'edited']);
});

await test('D6 daily↔fixed and labor↔vendor are locked once established (Q4); free on a draft', async () => {
  const db = await fresh();
  const c = await contract(db, I.OWNER);
  await edit(db, I.OWNER, c.id, { pay_basis: 'daily', agreed_amount: 0 });
  await edit(db, I.OWNER, c.id, { pay_basis: 'fixed', agreed_amount: 50000 });
  await pay(db, c.id);
  assert((await err(edit(db, I.OWNER, c.id, { pay_basis: 'daily' }, 'switching'))).includes('LC_BASIS_LOCKED'), 'basis');
  assert((await err(edit(db, I.OWNER, c.id, { category: 'outsource' }, 'switching'))).includes('LC_BASIS_LOCKED'), 'category');
  await as(db, I.OWNER);
  assert((await err(db.query(`update labor_contracts set pay_basis = 'daily' where id = $1`, [c.id]))).includes('LC_BASIS_LOCKED'), 'direct');
});

await test('D7 locked and unknown fields are refused by lc_edit', async () => {
  const db = await fresh();
  const c = await contract(db, I.OWNER);
  for (const k of ['folder_id', 'owner_id', 'worker_id', 'ended_at', 'ended_by', 'id', 'created_at']) {
    assert((await err(edit(db, I.OWNER, c.id, { [k]: null }))).includes('LC_FIELD_LOCKED'), k);
  }
  assert((await err(edit(db, I.OWNER, c.id, { status: 'completed' }))).includes('BAD_CHANGE'), 'status');
  assert((await err(edit(db, I.OWNER, c.id, { worker_name_x: 'a' }))).includes('BAD_CHANGE'), 'unknown');
});

await test('D8 cap history only grows: appends pass (also when paid), rewrites are refused', async () => {
  const db = await fresh();
  const c = await contract(db, I.OWNER);
  await pay(db, c.id);
  const h = c.cap_history.concat([{ fileUrl: 'u', fileName: 'f.jpg', at: '2026-11-03T00:00:00.000Z', note: 'File uploaded' }]);
  await as(db, I.OWNER);
  await db.query('update labor_contracts set cap_history = $1::jsonb where id = $2', [JSON.stringify(h), c.id]);
  assert((await err(db.query(`update labor_contracts set cap_history = '[]'::jsonb where id = $1`, [c.id]))).includes('LC_HISTORY_APPEND_ONLY'), 'emptied');
  const forged = [{ amount: 1, at: 'x', note: 'Initial cap' }].concat(h.slice(1));
  assert((await err(db.query('update labor_contracts set cap_history = $1::jsonb where id = $2', [JSON.stringify(forged), c.id]))).includes('LC_HISTORY_APPEND_ONLY'), 'rewritten');
});

await test('D9 only the office of the company may edit', async () => {
  const db = await fresh();
  const c = await contract(db, I.OWNER);
  for (const u of [I.W1, I.LEAD, I.CLIENT, I.PARTNER]) {
    assert((await err(edit(db, u, c.id, { scope: 'x' }))).includes('OFFICE_ONLY'), 'caller ' + u);
  }
  assert((await err(edit(db, I.OTHER, c.id, { scope: 'x' }))).includes('LC_NOT_FOUND'), 'other company');
});

await test('D11 a blank box is not a change: \'\' or [] for a NULL needs no reason and logs nothing', async () => {
  const db = await fresh();
  const c = await contract(db, I.OWNER, { category: 'outsource', name: 'ABC Steel' });
  await admin(db);
  await db.query('update labor_contracts set trade = null, works = null, agreement_pdf_url = null, agreement_pdf_name = null where id = $1', [c.id]);
  await pay(db, c.id);
  const logged = (await events(db, c.id)).length;
  // What the Edit form sends for those empty boxes, with only the notes really changed.
  const r = await edit(db, I.OWNER, c.id, { trade: '', works: [], agreement_pdf_url: '', agreement_pdf_name: '', notes: 'call first' });
  eq(r.changed, ['notes']);
  eq((await events(db, c.id)).length, logged, 'the blank boxes were logged as a change of terms');
  await admin(db);
  eq((await one(db, 'select trade, works, agreement_pdf_url from labor_contracts where id = $1', [c.id])), { trade: null, works: null, agreement_pdf_url: null });
  assert((await err(edit(db, I.OWNER, c.id, { trade: 'Welding' }))).includes('REASON_REQUIRED'), 'a real change still needs one');
});

await test('D10 a linked contract cannot become a vendor contract, even as a draft', async () => {
  const db = await fresh();
  const c = await contract(db, I.OWNER, { worker: I.W1 });
  assert((await err(edit(db, I.OWNER, c.id, { category: 'outsource' }))).includes('LABOR_ONLY'));
});

// ════ E. Ending ══════════════════════════════════════════════════════

await test('E1 an owner account ends and reopens with a reason; staff and others cannot', async () => {
  const db = await fresh();
  const c = await contract(db, I.OWNER);
  assert((await err(end(db, I.OWNER, c.id, ''))).includes('REASON_REQUIRED'), 'reason');
  for (const u of [I.STAFF, I.W1, I.CLIENT]) {
    assert((await err(end(db, u, c.id, 'x'))).includes('OWNER_ROLE_ONLY'), 'caller ' + u);
  }
  const r = await end(db, I.PMOWNER, c.id, 'Replaced by a daily contract');
  assert(r.changed && r.ended_at, 'ended');
  eq((await end(db, I.OWNER, c.id, 'again')).changed, false);
  assert((await err(reopen(db, I.OWNER, c.id, ''))).includes('REASON_REQUIRED'), 'reopen reason');
  eq((await reopen(db, I.OWNER, c.id, 'Ended by mistake')).changed, true);
  eq((await events(db, c.id)).map(e => e.kind), ['created', 'ended', 'reopened']);
});

await test('E2 ending marks nothing paid and moves no payment; it can still be paid to settle (Q4)', async () => {
  const db = await fresh();
  const c = await contract(db, I.OWNER, { amount: 50000 });
  await pay(db, c.id, { amount: 20000 });
  await admin(db);
  const before = await rows(db, 'select * from payroll order by id');
  await end(db, I.OWNER, c.id, 'Switched to a daily contract');
  await admin(db);
  eq(await rows(db, 'select * from payroll order by id'), before);
  const row = await one(db, 'select agreed_amount, status from labor_contracts where id = $1', [c.id]);
  eq([Number(row.agreed_amount), row.status], [50000, 'ongoing']);
  await pay(db, c.id, { amount: 5000, date: '2026-11-05' });
  eq(await paidOf(db, c.id), 25000);
});

await test('E3 a replacement leaves the old contract, its payments and its balance as they were', async () => {
  const db = await fresh();
  const old = await contract(db, I.OWNER, { amount: 50000, worker: I.W1 });
  await pay(db, old.id, { amount: 20000 });
  await end(db, I.OWNER, old.id, 'Replaced: now paid daily');
  const neu = await contract(db, I.OWNER, { basis: 'daily', amount: 0, worker: I.W1, scope: 'Masonry (daily)' });
  const list = (await mine(db, I.W1)).agreements;
  const o = list.find(a => a.id === old.id), d = list.find(a => a.id === neu.id);
  eq([o.ended, o.agreed, o.paid, o.balance], [true, 50000, 20000, 30000]);
  eq([d.ended, d.agreed, d.paid, d.balance], [false, null, 0, null]);
});

await test('E4 the end fields cannot be written directly', async () => {
  const db = await fresh();
  const c = await contract(db, I.OWNER);
  await as(db, I.OWNER);
  assert((await err(db.query('update labor_contracts set ended_at = now() where id = $1', [c.id]))).includes('LC_USE_FUNCTION'));
});

// ════ F. Deleting ════════════════════════════════════════════════════

await test('F1 a draft deletes as today and its terms stay in the log', async () => {
  const db = await fresh();
  const c = await contract(db, I.OWNER);
  await as(db, I.OWNER);
  await db.query('delete from labor_contracts where id = $1', [c.id]);
  const ev = (await events(db, c.id)).pop();
  eq([ev.kind, ev.before.scope, ev.before.payments], ['deleted', 'Masonry works', 0]);
});

await test('F2 a paid contract needs lc_delete with a reason; payments become uncapped, as before', async () => {
  const db = await fresh();
  const c = await contract(db, I.OWNER);
  const p = await pay(db, c.id, { amount: 7000 });
  await as(db, I.OWNER);
  assert((await err(db.query('delete from labor_contracts where id = $1', [c.id]))).includes('LC_REASON_NEEDED'), 'direct');
  assert((await err(del(db, I.OWNER, c.id))).includes('REASON_REQUIRED'), 'no reason');
  assert((await err(del(db, I.STAFF, c.id, 'x'))).includes('OWNER_ROLE_ONLY'), 'staff');
  await del(db, I.OWNER, c.id, 'Entered twice');
  await admin(db);
  eq((await one(db, 'select contract_id, total_salary from payroll where id = $1', [p.id])), { contract_id: null, total_salary: '7000' });
  const ev = (await events(db, c.id)).pop();
  eq([ev.kind, ev.reason, ev.before.payments, Number(ev.before.paid)], ['deleted', 'Entered twice', 1, 7000]);
});

await test('F3 a linked contract is never deleted (end it or unlink it first)', async () => {
  const db = await fresh();
  const c = await contract(db, I.OWNER, { worker: I.W1 });
  assert((await err(del(db, I.OWNER, c.id, 'x'))).includes('LC_LINKED'), 'function');
  await as(db, I.OWNER);
  assert((await err(db.query('delete from labor_contracts where id = $1', [c.id]))).includes('LC_LINKED'), 'direct');
});

await test('F4 deleting a project folder still takes its contracts, linked and paid ones too, and logs them', async () => {
  const db = await fresh();
  const a = await contract(db, I.OWNER, { worker: I.W1 });
  const b = await contract(db, I.OWNER, { folder: F.AW });
  await pay(db, a.id); await pay(db, b.id);
  await as(db, I.OWNER);
  await db.query('delete from folders where id = $1', [F.A1]);
  eq(await n(db, 'select count(*)::int n from labor_contracts'), 0);
  for (const c of [a, b]) {
    const ev = (await events(db, c.id)).pop();
    eq([ev.kind, ev.reason], ['deleted', 'Project folder deleted']);
  }
});

// ════ G. Merging ═════════════════════════════════════════════════════

await test('G1 one unlinked person: one step, summed cap, works in order, payments repointed, money the same', async () => {
  const db = await fresh();
  const a = await contract(db, I.OWNER, { scope: 'Ceiling', amount: 10000 });
  const b = await contract(db, I.OWNER, { scope: 'Demolition', amount: 5000, works: ['Pullout', { name: ' Haul-out ' }] });
  const c = await contract(db, I.OWNER, { scope: 'Drywall', amount: 7000, signed: true });
  await pay(db, a.id, { amount: 3000 }); await pay(db, b.id, { amount: 1000 });
  const paidBefore = (await paidOf(db, a.id)) + (await paidOf(db, b.id)) + (await paidOf(db, c.id));
  assert((await err(merge(db, I.OWNER, [a.id, b.id, c.id], c.id, 'Package'))).includes('REASON_REQUIRED'), 'reason');
  const r = await merge(db, I.OWNER, [a.id, b.id, c.id], c.id, 'Package', 'One agreement for the whole job');
  eq([r.agreed, r.works], [22000, ['Ceiling', 'Pullout', 'Haul-out', 'Drywall']]);
  await admin(db);
  const k = await one(db, 'select scope, agreed_amount, works, cap_history, agreement_signed from labor_contracts where id = $1', [c.id]);
  eq([k.scope, Number(k.agreed_amount), k.agreement_signed], ['Package', 22000, true]);
  eq(k.cap_history[k.cap_history.length - 1].note, 'Merged 3 jobs into one lumpsum');
  eq(await n(db, 'select count(*)::int n from labor_contracts'), 1);
  eq(await paidOf(db, c.id), paidBefore);
  eq((await events(db, a.id)).pop().kind, 'merged');
  eq((await events(db, a.id)).pop().after, { merged_into: c.id });
  eq((await events(db, c.id)).pop().reason, 'One agreement for the whole job');
});

await test('G2 never across people: linked + unlinked, two accounts with one name, two typed names', async () => {
  const db = await fresh();
  const l1 = await contract(db, I.OWNER, { worker: I.W1 });
  const u1 = await contract(db, I.OWNER);
  const l2 = await contract(db, I.OWNER, { worker: I.W2 });
  const other = await contract(db, I.OWNER, { name: 'Pedro Cruz' });
  for (const [ids, why] of [[[l1.id, u1.id], 'linked+unlinked'], [[l1.id, l2.id], 'two accounts'], [[u1.id, other.id], 'two names']]) {
    assert((await err(merge(db, I.OWNER, ids, ids[0], 'P', 'r'))).includes('LC_MERGE_MIXED'), why);
  }
  eq(await n(db, 'select count(*)::int n from labor_contracts'), 4);
});

await test('G3 one linked account with different typed names merges, and the link stays', async () => {
  const db = await fresh();
  const a = await contract(db, I.OWNER, { worker: I.W1, name: 'Juan Cruz' });
  const b = await contract(db, I.OWNER, { worker: I.W1, name: 'Juan Cruz (Demolition)' });
  await pay(db, b.id);
  await merge(db, I.OWNER, [a.id, b.id], a.id, 'Package', 'one agreement');
  await admin(db);
  eq((await one(db, 'select worker_id from labor_contracts where id = $1', [a.id])).worker_id, I.W1);
  eq((await mine(db, I.W1)).agreements.length, 1);
});

await test('G4 not across daily and fixed; two daily contracts merge with no cap', async () => {
  const db = await fresh();
  const f = await contract(db, I.OWNER, { scope: 'A' });
  const d1 = await contract(db, I.OWNER, { scope: 'B', basis: 'daily', amount: 0 });
  const d2 = await contract(db, I.OWNER, { scope: 'C', basis: 'daily', amount: 0 });
  assert((await err(merge(db, I.OWNER, [f.id, d1.id], f.id, 'P'))).includes('LC_MERGE_BASIS'), 'mixed');
  const r = await merge(db, I.OWNER, [d1.id, d2.id], d1.id, 'Daily package');
  eq([r.agreed, r.works], [0, ['B', 'C']]);
});

await test('G5 bad merges are refused before anything changes', async () => {
  const db = await fresh();
  const a = await contract(db, I.OWNER, { scope: 'A' });
  const b = await contract(db, I.OWNER, { scope: 'B' });
  const v = await contract(db, I.OWNER, { scope: 'V', category: 'outsource' });
  const ob = await contract(db, I.OTHER, { owner: I.OTHER, folder: F.B1 });
  assert((await err(merge(db, I.OWNER, [a.id], a.id, 'P'))).includes('BAD_MERGE'), 'one');
  assert((await err(merge(db, I.OWNER, [a.id, b.id], v.id, 'P'))).includes('BAD_MERGE'), 'keeper outside');
  assert((await err(merge(db, I.OWNER, [a.id, a.id], a.id, 'P'))).includes('BAD_MERGE'), 'twice');
  assert((await err(merge(db, I.OWNER, [a.id, v.id], a.id, 'P'))).includes('LC_MERGE_MIXED'), 'vendor');
  assert((await err(merge(db, I.OWNER, [a.id, ob.id], a.id, 'P'))).includes('LC_NOT_FOUND'), 'other company');
  assert((await err(merge(db, I.STAFF, [a.id, b.id], a.id, 'P'))).includes('OWNER_ROLE_ONLY'), 'staff');
  eq(await n(db, 'select count(*)::int n from labor_contracts'), 4);
});

await test('G6 never across projects: the same worker on two projects (or a project and its Additional Works) is refused, and nothing changes', async () => {
  const db = await fresh();
  // One linked worker with paid jobs on Alpha House, Beta House and Alpha's Additional Works…
  const a1 = await contract(db, I.OWNER, { worker: I.W1, folder: F.A1, scope: 'Alpha masonry', amount: 10000 });
  const a2 = await contract(db, I.OWNER, { worker: I.W1, folder: F.A2, scope: 'Beta masonry', amount: 20000, signed: true });
  const aw = await contract(db, I.OWNER, { worker: I.W1, folder: F.AW, scope: 'Extra wall', amount: 5000 });
  // …and one unlinked typed name on two projects.
  const u1 = await contract(db, I.OWNER, { folder: F.A1, scope: 'Ceiling' });
  const u2 = await contract(db, I.OWNER, { folder: F.A3, scope: 'Drywall' });
  for (const c of [a1, a2, aw, u1, u2]) await pay(db, c.id, { amount: 1000 });
  await admin(db);
  const snap = async () => ({
    contracts: await rows(db, 'select * from labor_contracts order by id'),
    payroll: await rows(db, 'select * from payroll order by id'),
    history: await rows(db, 'select * from lc_events order by id'),
  });
  const before = await snap();
  for (const [ids, why] of [[[a1.id, a2.id], 'linked worker, two projects'],
                            [[a1.id, aw.id], 'a project and its Additional Works'],
                            [[a1.id, a2.id, aw.id], 'three projects'],
                            [[u1.id, u2.id], 'unlinked name, two projects']]) {
    const e = await err(merge(db, I.OWNER, ids, ids[0], 'Package', 'one agreement'));
    assert(e.includes('LC_MERGE_FOLDER'), why + ': ' + e);
  }
  eq(await snap(), before, 'contracts, payments or history changed');
});

// ════ H. The worker's own agreements ═════════════════════════════════

async function phoneSetup() {
  const db = await fresh();
  await db.exec(`insert into boq_documents (owner_id, folder_id, cost_items) values
    ('${I.OWNER}', '${F.A1}', '[{"subItems":[{"lineItems":[{"qty":"10","materialRate":"100","laborRate":"100","percentCompletion":"25"}]}]}]'),
    ('${I.OWNER}', '${F.AW}', '[{"subItems":[{"lineItems":[{"qty":"1","materialRate":"1,000","laborRate":"0","percentCompletion":"80"}]}]}]');`);
  const main = await contract(db, I.OWNER, { worker: I.W1, scope: 'Masonry works', amount: 50000 });
  const aw = await contract(db, I.OWNER, { worker: I.W1, folder: F.AW, scope: 'Extra wall', amount: 8000,
                                           works: ['Wall', { name: 'Coping' }, '  '] });
  const daily = await contract(db, I.OWNER, { worker: I.W1, folder: F.A2, scope: 'Painting', basis: 'daily', amount: 0 });
  const gamma = await contract(db, I.OWNER, { worker: I.W1, folder: F.A3, scope: 'Tiling', amount: 1000 });
  const twin = await contract(db, I.OWNER, { worker: I.W2, scope: 'Same name, other person' });
  const unlinked = await contract(db, I.OWNER, { scope: 'Unlinked, same typed name' });
  await pay(db, main.id, { amount: 10000, date: '2026-10-01', method: 'cash' });
  await pay(db, main.id, { amount: 4000, date: '2026-10-08', group: 'g1', index: 0, method: 'gcash' });
  await pay(db, main.id, { amount: 6000, date: '2026-10-08', group: 'g1', index: 1, method: 'gcash' });
  await pay(db, main.id, { amount: 999, type: 'indirect' });
  await pay(db, main.id, { amount: 888, type: 'liability', liabilityFor: 'indirect' });
  await pay(db, gamma.id, { amount: 1500, date: '2026-10-20' });
  await pay(db, daily.id, { amount: 700, date: '2026-10-21', method: null });
  await pay(db, twin.id, { amount: 123 }); await pay(db, unlinked.id, { amount: 456 });
  return { db, main, aw, daily, gamma, twin, unlinked };
}

await test('H1 the worker sees exactly their own linked agreements, and nobody else does', async () => {
  const s = await phoneSetup();
  const ids = (await mine(s.db, I.W1)).agreements.map(a => a.id).sort();
  eq(ids, [s.main.id, s.aw.id, s.daily.id, s.gamma.id].sort());
  eq((await mine(s.db, I.W2)).agreements.map(a => a.id), [s.twin.id], 'same name, other account');
  for (const u of [I.HELPER, I.LEAD]) eq((await mine(s.db, u)).agreements, [], 'caller ' + u);
  for (const u of [I.GONE, I.OWNER, I.STAFF, I.CLIENT, I.PARTNER]) {
    assert((await err(mine(s.db, u))).includes('NOT_A_REQUESTER'), 'caller ' + u);
  }
  eq((await mine(s.db, I.WB)).agreements, [], 'other company, same name and number');
});

await test('H2 fixed: agreed, paid (Overhead pay excluded) and balance; split parts are one payment', async () => {
  const s = await phoneSetup();
  const a = (await mine(s.db, I.W1)).agreements.find(x => x.id === s.main.id);
  eq([a.pay_basis, a.agreed, a.paid, a.balance], ['fixed', 50000, 20000, 30000]);
  eq(a.payments, [{ date: '2026-10-08', amount: 10000, method: 'gcash' }, { date: '2026-10-01', amount: 10000, method: 'cash' }]);
  eq([a.project, a.main_project, a.project_completed, a.ended, a.scope, a.trade], ['Alpha House', null, false, false, 'Masonry works', 'Masonry']);
  eq(a.progress_pct, 25);
});

await test('H3 Additional Works shows its own progress and names the main project (Q1)', async () => {
  const s = await phoneSetup();
  const a = (await mine(s.db, I.W1)).agreements.find(x => x.id === s.aw.id);
  eq([a.project, a.main_project, a.progress_pct, a.works], ['Alpha Additional Works', 'Alpha House', 80, ['Wall', 'Coping']]);
});

await test('H4 daily: paid only, no agreed and no balance; completed project flagged', async () => {
  const s = await phoneSetup();
  const a = (await mine(s.db, I.W1)).agreements.find(x => x.id === s.daily.id);
  eq([a.pay_basis, a.agreed, a.paid, a.balance, a.project_completed, a.progress_pct], ['daily', null, 700, null, true, null]);
  eq(a.payments, [{ date: '2026-10-21', amount: 700, method: null }]);
});

await test('H5 over cap shows a negative balance; no BOQ shows no progress, never 100%', async () => {
  const s = await phoneSetup();
  const a = (await mine(s.db, I.W1)).agreements.find(x => x.id === s.gamma.id);
  eq([a.agreed, a.paid, a.balance, a.progress_pct], [1000, 1500, -500, null]);
});

await test('H6 nothing private leaves the server', async () => {
  const s = await phoneSetup();
  await edit(s.db, I.OWNER, s.main.id, { notes: 'SECRET-NOTE', agreement_pdf_url: 'https://x/SECRET.pdf' }, 'attach');
  const text = JSON.stringify(await mine(s.db, I.W1));
  for (const bad of ['SECRET', 'receipts/x.jpg', 'paid at site', 'cap_history', 'Initial cap', 'worker_name', 'pay_milestone',
                     'DP', 'owner_id', 'folder_id', 'split_group', 'Juan Cruz', 'Same name', 'Unlinked']) {
    assert(!text.includes(bad), 'leaked ' + bad);
  }
});

await test('H7 unlinking or ending updates the view; a vendor contract never appears', async () => {
  const s = await phoneSetup();
  await link(s.db, I.OWNER, s.gamma.id, null, null, 'Wrong person');
  await end(s.db, I.OWNER, s.main.id, 'Finished early');
  const list = (await mine(s.db, I.W1)).agreements;
  assert(!list.some(a => a.id === s.gamma.id), 'unlinked gone');
  const m = list.find(a => a.id === s.main.id);
  assert(m.ended && m.ended_at, 'ended shown');
  eq(list[list.length - 1].id, s.main.id, 'ended ones last');
});

await test('H8 a worker reads nothing directly: contracts, payroll, BOQs, folders, history', async () => {
  const s = await phoneSetup();
  await as(s.db, I.W1);
  for (const t of ['labor_contracts', 'payroll', 'boq_documents', 'folders', 'lc_events']) {
    eq(Number((await one(s.db, `select count(*)::int n from ${t}`)).n), 0, t);
  }
  await admin(s.db);
});

// ════ I. Progress = the office's _folderCompletion ═══════════════════

function sliceFn(src, name) {
  const i = src.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('SLICE NOT FOUND: ' + name);
  let depth = 0, j = src.indexOf('{', i);
  for (; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}' && --depth === 0) break;
  }
  return src.slice(i, j + 1);
}
const PORTAL = fs.readFileSync(path.join(ROOT, 'js/portal-app.compiled.js'), 'utf8');
const jsCtx = vm.createContext({});
vm.runInContext(['_billNum', '_billLITotal', 'boqGrandTotal', 'boqAccTotal', '_folderCompletion']
  .map(f => sliceFn(PORTAL, f)).join('\n') + '\nthis.fc = _folderCompletion;', jsCtx);

const BOQS = {
  plain:     [{ subItems: [{ lineItems: [{ qty: '10', materialRate: '100', laborRate: '50', percentCompletion: '40' }] }] }],
  commas:    [{ subItems: [{ lineItems: [{ qty: '1,200', materialRate: '1,234.50', laborRate: '0', percentCompletion: '12.5' },
                                         { qty: 3, materialRate: 99.99, laborRate: 10, percentCompletion: 100 }] }] }],
  overrides: [{ subItems: [{ lineItems: [{ qty: '5', materialRate: '100', laborRate: '20', materialOverride: true, percentCompletion: '50' },
                                         { qty: '5', materialRate: '100', laborRate: '20', laborOverride: 'yes', percentCompletion: '10' },
                                         { qty: '5', materialRate: '100', laborRate: '20', materialOverride: 0, laborOverride: '', percentCompletion: '30' }] }] }],
  zeroAcc:   [{ subItems: [{ lineItems: [{ qty: '10', materialRate: '100', laborRate: '0', percentCompletion: '0' }] }] }],
  zeroTotal: [{ subItems: [{ lineItems: [{ qty: '0', materialRate: '100', laborRate: '0', percentCompletion: '50' }] }] }],
  over100:   [{ subItems: [{ lineItems: [{ qty: '1', materialRate: '100', laborRate: '0', percentCompletion: '150' }] }] }],
  garbage:   [{ subItems: [{ lineItems: [{ qty: 'abc', materialRate: '12abc', laborRate: ' 7 ', percentCompletion: '50%' },
                                         { qty: '2e1', materialRate: '.5', laborRate: '-1', percentCompletion: '5.' },
                                         { qty: null, materialRate: '', percentCompletion: undefined }] },
                            { lineItems: [] }, {}] }, {}],
  manyItems: [{ subItems: [{ lineItems: [{ qty: '3', materialRate: '7', laborRate: '11', percentCompletion: '33.3' }] }] },
              { subItems: [{ lineItems: [{ qty: '13', materialRate: '17', laborRate: '19', percentCompletion: '66.6' }] }] }],
};

await test('I1 progress equals the office _folderCompletion on every sample BOQ', async () => {
  const db = await fresh();
  const folders = Object.keys(BOQS);
  for (const name of folders) {
    const fid = (await one(db, `insert into folders (owner_id, name) values ($1, $2) returning id`, [I.OWNER, name])).id;
    await db.query('insert into boq_documents (owner_id, folder_id, cost_items) values ($1, $2, $3::jsonb)', [I.OWNER, fid, JSON.stringify(BOQS[name])]);
    const js = jsCtx.fc([{ folderId: fid, costItems: JSON.parse(JSON.stringify(BOQS[name])) }], fid);
    const sql = (await one(db, 'select ll_folder_progress($1) p', [fid])).p;
    if (!js.hasData) eq(sql, null, name + ' (no data)');
    else assert(sql !== null && Math.abs(sql - js.pct) < 1e-12, name + ': sql ' + sql + ' vs js ' + js.pct);
  }
});

await test('I2 with two BOQs both pick the one with more cost items; no BOQ means no figure', async () => {
  const db = await fresh();
  const small = BOQS.plain, big = BOQS.manyItems;
  await db.query('insert into boq_documents (owner_id, folder_id, cost_items) values ($1, $2, $3::jsonb), ($1, $2, $4::jsonb)',
                 [I.OWNER, F.A1, JSON.stringify(small), JSON.stringify(big)]);
  const js = jsCtx.fc([{ folderId: F.A1, costItems: small }, { folderId: F.A1, costItems: big }], F.A1);
  const sql = (await one(db, 'select ll_folder_progress($1) p', [F.A1])).p;
  assert(Math.abs(sql - js.pct) < 1e-12, sql + ' vs ' + js.pct);
  eq((await one(db, 'select ll_folder_progress($1) p', [F.A3])).p, null);
  eq(jsCtx.fc([], F.A3).hasData, false);
});

await test('I3 Additional Works never borrows the main project\'s progress', async () => {
  const db = await fresh();
  await db.query('insert into boq_documents (owner_id, folder_id, cost_items) values ($1, $2, $3::jsonb)', [I.OWNER, F.A1, JSON.stringify(BOQS.plain)]);
  eq((await one(db, 'select ll_folder_progress($1) p', [F.AW])).p, null);
});

// ════ J. No money moves ══════════════════════════════════════════════

await test('J1 link, edit, end and reopen leave payroll exactly as it was', async () => {
  const db = await fresh();
  const c = await contract(db, I.OWNER);
  await pay(db, c.id, { amount: 1000 }); await pay(db, c.id, { amount: 2000, group: 'g', index: 0 });
  await admin(db);
  const before = await rows(db, 'select * from payroll order by id');
  await link(db, I.OWNER, c.id, I.W1, 13);
  await edit(db, I.OWNER, c.id, { scope: 'x', agreed_amount: 1 }, 'correction');
  await end(db, I.OWNER, c.id, 'done'); await reopen(db, I.OWNER, c.id, 'not done');
  await link(db, I.OWNER, c.id, null, null, 'undo');
  await admin(db);
  eq(await rows(db, 'select * from payroll order by id'), before);
});

// ════ K. Today's office, unchanged, against 0113 ══════════════════════
// The deployment order is: commit, apply 0113 and verify it, THEN push the new
// web. In between, the web that is live today runs against 0113. These replay
// its exact writes (js/expenses-module.js at 68bc8ff, through the shim: a PATCH
// of the columns it sends, updated_at as a timestamp). Everything that keeps
// the history intact works; a change of terms on a signed or paid contract is
// refused with nothing changed — the protection is never skipped.

// The old Edit contract: every form field, '' for an empty box, [] for no works.
const oldEdit = (o = {}) => ({ worker_name: 'Juan Cruz', scope: 'Masonry works', trade: '', agreed_amount: 50000,
  pay_type: 'pakyaw', notes: 'paid weekly', category: 'labor', works: [], pay_basis: 'fixed', updated_at: '2026-11-08T03:00:00.000Z', ...o });
async function patch(db, uid, id, cols) {
  await as(db, uid);
  const keys = Object.keys(cols);
  const set = keys.map((k, i) => k + ' = $' + (i + 2) + (['works', 'cap_history'].includes(k) ? '::jsonb' : '')).join(', ');
  const vals = keys.map(k => ['works', 'cap_history'].includes(k) ? JSON.stringify(cols[k]) : cols[k]);
  try { await db.query('update labor_contracts set ' + set + ' where id = $1', [id, ...vals]); } finally { await admin(db); }
}
async function paidContract(db, o = {}) {
  const c = await contract(db, I.OWNER, o);
  await admin(db);
  // As on live: 5 contracts have no trade, 2 have no agreement file.
  await db.query('update labor_contracts set trade = null, agreement_pdf_url = null, agreement_pdf_name = null where id = $1', [c.id]);
  await pay(db, c.id, { amount: 1000 });
  await admin(db);
  return (await one(db, 'select * from labor_contracts where id = $1', [c.id]));
}

await test('K1 old Edit, terms unchanged (only notes; blank boxes sent as \'\'): saved, nothing logged', async () => {
  const db = await fresh();
  const c = await paidContract(db);
  const logged = (await events(db, c.id)).length;
  await patch(db, I.OWNER, c.id, oldEdit({ agreement_signed: false, agreement_pdf_url: '', agreement_pdf_name: '', agreement_signed_at: null }));
  eq((await one(db, 'select notes from labor_contracts where id = $1', [c.id])).notes, 'paid weekly');
  eq((await events(db, c.id)).length, logged, 'a blank box was logged as a change of terms');
});

await test('K2 old Edit, a real change of terms on a paid contract: refused, nothing changed', async () => {
  const db = await fresh();
  const c = await paidContract(db);
  const e = await err(patch(db, I.OWNER, c.id, oldEdit({ scope: 'Masonry and plastering', agreed_amount: 60000 })));
  assert(e.includes('LC_REASON_NEEDED'), e);
  eq(await one(db, 'select * from labor_contracts where id = $1', [c.id]), c);
});

await test('K3 old Edit of a draft: saved as before, and logged', async () => {
  const db = await fresh();
  const c = await contract(db, I.OWNER);
  await patch(db, I.STAFF, c.id, oldEdit({ scope: 'Masonry and plastering' }));
  eq((await events(db, c.id)).pop().kind, 'edited');
});

await test('K4 old Raise cap on a paid contract: refused, cap and history unchanged', async () => {
  const db = await fresh();
  const c = await paidContract(db);
  const h = c.cap_history.concat([{ amount: 70000, at: '2026-11-08T03:00:00.000Z', note: 'Raised cap' }]);
  const e = await err(patch(db, I.OWNER, c.id, { agreed_amount: 70000, cap_history: h, updated_at: '2026-11-08T03:00:00.000Z' }));
  assert(e.includes('LC_REASON_NEEDED'), e);
  eq(await one(db, 'select * from labor_contracts where id = $1', [c.id]), c);
});

await test('K5 old Add file (a cap-history line) on a paid contract: saved', async () => {
  const db = await fresh();
  const c = await paidContract(db);
  const h = c.cap_history.concat([{ fileUrl: 'https://x/f.jpg', fileName: 'f.jpg', at: '2026-11-08T03:00:00.000Z', note: 'File uploaded' }]);
  await patch(db, I.OWNER, c.id, { cap_history: h, updated_at: '2026-11-08T03:00:00.000Z' });
  eq((await one(db, 'select cap_history from labor_contracts where id = $1', [c.id])).cap_history.length, 2);
});

await test('K6 old Delete: a draft goes as before; a paid contract is refused and keeps its payments', async () => {
  const db = await fresh();
  const d = await contract(db, I.OWNER, { scope: 'Draft' });
  const c = await paidContract(db);
  await as(db, I.OWNER);
  await db.query('delete from labor_contracts where id = $1', [d.id]);
  assert((await err(db.query('delete from labor_contracts where id = $1', [c.id]))).includes('LC_REASON_NEEDED'), 'paid');
  await admin(db);
  eq(await paidOf(db, c.id), 1000);
});

await test('K7 old Merge (keeper first) of paid contracts: the first write is refused, so nothing moves', async () => {
  const db = await fresh();
  const a = await paidContract(db, { scope: 'A' });
  const b = await paidContract(db, { scope: 'B' });
  await admin(db);
  const before = { c: await rows(db, 'select * from labor_contracts order by id'), p: await rows(db, 'select * from payroll order by id') };
  const e = await err(patch(db, I.OWNER, a.id, { scope: 'General Works Package', agreed_amount: 100000, works: ['A', 'B'],
    cap_history: a.cap_history.concat([{ amount: 100000, at: 'x', note: 'Merged 2 jobs into one lumpsum' }]) }));
  assert(e.includes('LC_REASON_NEEDED'), e);
  eq({ c: await rows(db, 'select * from labor_contracts order by id'), p: await rows(db, 'select * from payroll order by id') }, before);
});

await test('K8 payroll is untouched by 0113: owner and staff save, change and delete contract payments as before', async () => {
  const db = await fresh();
  const c = await paidContract(db);
  await as(db, I.STAFF);
  const p = (await one(db, `insert into payroll (owner_id, worker_name, labor_type, total_salary, payment_date, contract_id)
                            values ($1, 'Juan Cruz', 'direct', 500, '2026-11-08', $2) returning id`, [I.OWNER, c.id])).id;
  await db.query('update payroll set total_salary = 600 where id = $1', [p]);
  await as(db, I.OWNER);
  await db.query('delete from payroll where id = $1', [p]);
  await admin(db);
  eq(await paidOf(db, c.id), 1000);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) { console.log('\nFailures:\n  ' + failures.join('\n  ')); process.exit(1); }
