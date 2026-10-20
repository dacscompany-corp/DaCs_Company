# Worker Cash Advances Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Project Management → **Cash Advances** tab where owner-role accounts record money advanced to workers on a PM project, see a payroll-based suggested repayment, record any agreed repayment by hand, and void mistakes — without changing payroll or any project money total.

**Architecture:** Migration `0100` adds four private tables (advances, repayments, append-only events, operation ids) behind security-definer `pm_ca_*` functions that lock the advance row for every balance-affecting write and replay a stored result for a repeated operation id. The browser side is three plain-JS files: `js/cash-advance.js` (pure calculations + the only RPC wrappers), `js/cash-advance-admin.js` (list, detail, payroll loading) and `js/cash-advance-forms.js` (pop-ups). Payroll is only *read*, per project, from `constructionProjects/{id}/weeklyBills`.

**Tech Stack:** Plain HTML + vanilla JS (no build step), Supabase/PostgreSQL (plpgsql), Node test scripts (`node tests/*.test.js`), PGlite and embedded-postgres for SQL tests (`npm run test:sql`).

**Spec:** `docs/superpowers/specs/2026-10-19-worker-cash-advances-design.md` — read it first; rule numbers R1–R16 below refer to its §4.

## Global Constraints

- **Never run `npm run build`.** Edit files directly. No `src/`, no JSX.
- **Never `git commit` or `git push`.** The user commits by hand. Each task ends with a checkpoint listing the changed files instead of a commit.
- The working tree already has **uncommitted user changes** in `admin.html`, `css/pm-admin.css`, `js/pm-admin.js` and others. Edit by exact-string replacement only; never reformat, revert or rewrite those files wholesale.
- Migration number is **`0100`**. Do **not** apply it to the live database until Task 9, and only after the user says yes.
- Owner-role only: browser check `window.currentUserRole === 'owner'`; server check `pm_owner_company()` (0098).
- **Outside the money model.** Nothing may write `weekly_bills`, payroll, expenses, invoices or any accounting table, and no Spent / Earned / Profit / PM-total / Profit Sharing / Warranty code may mention cash advances.
- Amounts must be **> ₱0**; more than two decimal places is **rejected, never rounded** (`BAD_PRECISION`). Suggested % is **0–100**, at most two decimals, **default 30**.
- Dates are local PH date keys built from local parts — **never `toISOString().slice(0,10)`**.
- Do not edit these lines (other suites match them exactly): `const hidden = ['warrantyFund', 'pmSharing'];` in `js/admin.js`, and `'warrantyFund', 'pmSharing', 'attAppUpdates',` in `admin.html`'s staff `blocked` list.
- User-visible copy, verbatim:
  - `Suggestion only — nothing is deducted.` · `No suggestion` · `Void its repayments first.`
  - `Payroll lines couldn't load — type an amount instead.` · `Amounts can have at most two decimal places.`
  - `Enter an amount above ₱0.` · `Suggested % must be 0 to 100.` · `Give a reason for voiding.`
  - `Only owner accounts can use Cash Advances.` · `This was already voided.` · `Void this advance's repayments first.`
- Verification commands: `npm test`, `npm run test:sql`, `node --check <file>`.

## File map

| File | Responsibility | Task |
|---|---|---|
| `supabase/migrations/0100_pm_cash_advances.sql` | tables, trigger, `pm_ca_*` functions, privileges | 1 |
| `supabase/tests/pm_cash_advances_base.mjs` | shared fixture: 0098 base + migration text | 1 |
| `supabase/tests/pm_cash_advances.pglite.mjs` | every rule R1–R16 on PGlite | 1 |
| `supabase/tests/pm_cash_advances_concurrency.mjs` | races + real-role privileges on PostgreSQL | 2 |
| `js/cash-advance.js` | `window.CashAdvance`: totals, suggestion, parsing, Labor-line matching, list summary, error text, op ids, RPC wrappers | 3 |
| `js/cash-advance-admin.js` | `window.CashAdvanceAdmin`: list, detail, history, payroll loading | 4 |
| `js/cash-advance-forms.js` | advance / repayment / void pop-ups, submit with op id | 5 |
| `js/admin.js`, `admin.html`, `css/pm-admin.css` | nav, owner-only gates, view container, scripts, styles | 6 |
| `tests/cash-advance.test.js` | logic (A), screens (B), forms (C), wiring + isolation (D) | 3–6 |
| `package.json` | wire the new suites | 1, 2, 3 |
| `CLAUDE.md`, `docs/ARCHITECTURE.md`, `docs/DATABASE_SCHEMA.md`, `supabase/migrations/README.md` | docs | 7 |

Tasks 1–7 change nothing live. Task 8 is the full local verification; Task 9 applies 0100 live (with approval) and runs the browser pass.

---

### Task 1: Migration 0100 and its PGlite behaviour tests

**Files:**
- Create: `supabase/migrations/0100_pm_cash_advances.sql`
- Create: `supabase/tests/pm_cash_advances_base.mjs`
- Create: `supabase/tests/pm_cash_advances.pglite.mjs`
- Modify: `package.json` (`test:sql` script)

**Interfaces:**
- Consumes (0098): `pm_owner_company() → uuid` (raises `NOT_SIGNED_IN` / `PROFILE_MISSING` / `INACTIVE` / `OWNER_ONLY` / `BAD_COMPANY_LINK`), table `pm_project_companies(project_id, company_owner_id)`.
- Produces (called by `js/cash-advance.js`, Task 3) — all return `jsonb`:
  - `pm_ca_projects()` → `[{ id, name }]`
  - `pm_ca_list()` → `[Advance]`, newest `issued_on` first
  - `pm_ca_record_advance(p_op_id uuid, p_project uuid, p_worker text, p_issued_on date, p_amount numeric, p_pct numeric, p_notes text)` → `{ advance }`
  - `pm_ca_edit_advance(p_op_id uuid, p_id uuid, p_project uuid, p_worker text, p_issued_on date, p_amount numeric, p_pct numeric, p_notes text)` → `{ advance, changed }`
  - `pm_ca_record_repayment(p_op_id uuid, p_advance uuid, p_paid_on date, p_amount numeric, p_payroll_ref jsonb, p_notes text)` → `{ advance, repayment_id }`
  - `pm_ca_void_repayment(p_op_id uuid, p_repayment uuid, p_reason text)` → `{ advance }`
  - `pm_ca_void_advance(p_op_id uuid, p_id uuid, p_reason text)` → `{ advance }`
  - **Advance JSON shape:** `{ id, project_id, project_name, project_deleted, worker_name, issued_on ('YYYY-MM-DD'), amount (number), suggest_pct (number), notes, created_at, updated_at, voided_at, void_reason, voided_by_email, repayments: [{ id, paid_on, amount, payroll_ref, notes, created_at, voided_at, void_reason, voided_by_email }], events: [{ kind, repayment_id, changes, reason, actor_email, at }] }`
  - **Payroll ref shape:** `{ billId: string, entryIds: string[], day: string, details: string, amount: number }`

- [ ] **Step 1: Write the shared SQL test fixture**

Create `supabase/tests/pm_cash_advances_base.mjs`:

```js
// Shared by pm_cash_advances.pglite.mjs and pm_cash_advances_concurrency.mjs.
// 0100 needs 0098 (pm_owner_company, pm_project_companies), so both
// migrations run VERBATIM over the minimal tables in pm_sharing_base.mjs.
// Nothing here talks to the live database.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
export { PM_BASE, IDS, seedProfiles } from './pm_sharing_base.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.DACS_ROOT || path.join(HERE, '..', '..');
const migration = (f) => fs.readFileSync(path.join(ROOT, 'supabase/migrations', f), 'utf8').replace(/\r\n/g, '\n');

export const M98 = migration('0098_pm_profit_sharing.sql');
export const M100 = migration('0100_pm_cash_advances.sql');
// A stand-in payroll table: only there to prove the ledger never writes payroll.
export const PAYROLL_STANDIN = `create table weekly_bills (id uuid primary key default gen_random_uuid(), project_id uuid, entries jsonb);`;
```

- [ ] **Step 2: Write the failing PGlite suite**

Create `supabase/tests/pm_cash_advances.pglite.mjs`:

```js
// ════════════════════════════════════════════════════════════════════
// PM WORKER CASH ADVANCES (0100) — BEHAVIOUR TESTS ON PGLITE
//   npm run test:sql
// Runs 0098 + 0100 VERBATIM. Rules R1–R16 are the spec's §4:
// docs/superpowers/specs/2026-10-19-worker-cash-advances-design.md
// ════════════════════════════════════════════════════════════════════
import { PGlite } from '@electric-sql/pglite';
import { randomUUID } from 'node:crypto';
import { PM_BASE, IDS, seedProfiles, M98, M100, PAYROLL_STANDIN } from './pm_cash_advances_base.mjs';

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
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) { console.log(failures.join('\n')); process.exit(1); }
```

- [ ] **Step 3: Run it to confirm it fails**

Run: `npm --prefix supabase/tests install --no-package-lock --no-audit --no-fund && node supabase/tests/pm_cash_advances.pglite.mjs`
Expected: crashes with `ENOENT … 0100_pm_cash_advances.sql` (the migration doesn't exist yet).

- [ ] **Step 4: Write the migration**

Create `supabase/migrations/0100_pm_cash_advances.sql`:

```sql
-- ════════════════════════════════════════════════════════════════════
-- 0100 — PM worker cash advances (tracking ledger).
-- Spec: docs/superpowers/specs/2026-10-19-worker-cash-advances-design.md
--
-- Money advanced to workers on a PM project and the repayments the owner
-- records by hand. OUTSIDE the money model: nothing here creates payroll,
-- an expense, invoice or accounting entry, nothing writes weekly_bills, and
-- no Spent / Earned / Profit code reads these tables. The suggested
-- repayment is computed in the browser and is never stored as a repayment.
--
-- • Four private tables. RLS on, NO policies, privileges revoked. Every
--   read and write goes through the security-definer functions below.
-- • Who: owner-role accounts of the company — pm_owner_company() (0098).
-- • project_id is a PLAIN value (no FK): deleting a project neither blocks
--   on nor erases the ledger. The project is checked only when an advance
--   is created or moved to another project (spec R15); otherwise an advance
--   is reached through its saved company_owner_id.
-- • Every write takes p_op_id. The first call with an id does the work and
--   stores its result; a repeat returns that result and writes nothing (R16).
-- • Every write that reads or changes a balance first locks the advance row
--   (select … for update), so concurrent saves run one after another (R13).
-- • Amounts and % are validated AS RECEIVED: more than two decimals is
--   refused (BAD_PRECISION), never rounded by the numeric(…,2) cast.
-- Requires 0098. Idempotent where practical.
-- ════════════════════════════════════════════════════════════════════

-- ── 1. Tables ─────────────────────────────────────────────────────────
create table if not exists pm_cash_advances (
  id                    uuid primary key default gen_random_uuid(),
  company_owner_id      uuid not null,
  project_id            uuid not null,
  project_name_snapshot text,
  worker_name           text not null check (length(btrim(worker_name)) between 1 and 120),
  issued_on             date not null,
  amount                numeric(12,2) not null check (amount > 0),
  suggest_pct           numeric(5,2) not null default 30 check (suggest_pct >= 0 and suggest_pct <= 100),
  notes                 text,
  created_by            uuid not null,
  created_at            timestamptz not null default now(),
  updated_by            uuid,
  updated_at            timestamptz,
  voided_at             timestamptz,
  voided_by             uuid,
  void_reason           text,
  constraint pm_cash_advances_void_chk check (
    (voided_at is null and voided_by is null and void_reason is null)
    or (voided_at is not null and voided_by is not null and length(btrim(void_reason)) > 0))
);
create index if not exists pm_cash_advances_company_idx on pm_cash_advances(company_owner_id, issued_on desc);
create index if not exists pm_cash_advances_project_idx on pm_cash_advances(project_id);

create table if not exists pm_cash_advance_repayments (
  id               uuid primary key default gen_random_uuid(),
  advance_id       uuid not null references pm_cash_advances(id) on delete restrict,
  company_owner_id uuid not null,
  paid_on          date not null,
  amount           numeric(12,2) not null check (amount > 0),
  -- Optional snapshot of the Labor line the suggestion was based on:
  -- { billId, entryIds[], day, details, amount }. Never a live link (R12).
  payroll_ref      jsonb,
  notes            text,
  created_by       uuid not null,
  created_at       timestamptz not null default now(),
  voided_at        timestamptz,
  voided_by        uuid,
  void_reason      text,
  constraint pm_cash_advance_repayments_void_chk check (
    (voided_at is null and voided_by is null and void_reason is null)
    or (voided_at is not null and voided_by is not null and length(btrim(void_reason)) > 0))
);
create index if not exists pm_cash_advance_repayments_advance_idx on pm_cash_advance_repayments(advance_id);

-- Append-only history. seq gives a stable order even inside one transaction.
create table if not exists pm_cash_advance_events (
  seq              bigint generated always as identity primary key,
  advance_id       uuid not null,
  company_owner_id uuid not null,
  kind             text not null check (kind in ('issued', 'edited', 'repaid', 'repayment_voided', 'voided')),
  repayment_id     uuid,
  changes          jsonb,
  reason           text,
  actor_id         uuid not null,
  actor_email      text,
  at               timestamptz not null default now()
);
create index if not exists pm_cash_advance_events_advance_idx on pm_cash_advance_events(advance_id, seq);

-- One row per submitted write (spec §5.3a).
create table if not exists pm_cash_advance_ops (
  op_id            uuid primary key,
  company_owner_id uuid not null,
  action           text not null check (action in ('record_advance', 'edit_advance', 'record_repayment',
                                                   'void_repayment', 'void_advance')),
  result           jsonb,
  actor_id         uuid not null,
  at               timestamptz not null default now()
);

create or replace function pm_ca_events_immutable() returns trigger
language plpgsql as $$
begin
  raise exception 'HISTORY_IMMUTABLE' using errcode = 'P0001';
end;
$$;
drop trigger if exists pm_ca_events_immutable_trg on pm_cash_advance_events;
create trigger pm_ca_events_immutable_trg
  before update or delete on pm_cash_advance_events
  for each row execute function pm_ca_events_immutable();

-- ── 2. Internal helpers (never granted to clients) ────────────────────
create or replace function pm_ca_clean(p text) returns text
language sql immutable as $$ select nullif(btrim(p), '') $$;

create or replace function pm_ca_check_amount(p numeric) returns void
language plpgsql immutable as $$
begin
  if p is null or p = 'NaN'::numeric or p <= 0 or p >= 10000000000 then
    raise exception 'BAD_AMOUNT' using errcode = 'P0001';
  end if;
  if p <> round(p, 2) then raise exception 'BAD_PRECISION' using errcode = 'P0001'; end if;
end;
$$;

create or replace function pm_ca_check_pct(p numeric) returns void
language plpgsql immutable as $$
begin
  if p is null or p = 'NaN'::numeric or p < 0 or p > 100 then
    raise exception 'BAD_PCT' using errcode = 'P0001';
  end if;
  if p <> round(p, 2) then raise exception 'BAD_PRECISION' using errcode = 'P0001'; end if;
end;
$$;

-- Checked one step at a time: SQL does not promise left-to-right OR, and
-- jsonb_array_length on a non-array would raise its own error.
create or replace function pm_ca_clean_ref(p jsonb) returns jsonb
language plpgsql immutable as $$
begin
  if p is null or jsonb_typeof(p) = 'null' then return null; end if;
  if jsonb_typeof(p) <> 'object' then raise exception 'BAD_REF' using errcode = 'P0001'; end if;
  if coalesce(jsonb_typeof(p->'billId'), '') <> 'string' or btrim(p->>'billId') = '' then
    raise exception 'BAD_REF' using errcode = 'P0001';
  end if;
  if coalesce(jsonb_typeof(p->'entryIds'), '') <> 'array' then raise exception 'BAD_REF' using errcode = 'P0001'; end if;
  if jsonb_array_length(p->'entryIds') = 0
     or exists (select 1 from jsonb_array_elements(p->'entryIds') x where jsonb_typeof(x) <> 'string') then
    raise exception 'BAD_REF' using errcode = 'P0001';
  end if;
  if coalesce(jsonb_typeof(p->'day'), '') <> 'string' or coalesce(jsonb_typeof(p->'details'), '') <> 'string'
     or coalesce(jsonb_typeof(p->'amount'), '') <> 'number' then
    raise exception 'BAD_REF' using errcode = 'P0001';
  end if;
  return jsonb_build_object('billId', p->'billId', 'entryIds', p->'entryIds', 'day', p->'day',
                            'details', p->'details', 'amount', p->'amount');
end;
$$;

-- R16. Returns NULL when this call owns the operation, otherwise the stored
-- result of the first call. A concurrent call with the same id waits on the
-- primary key until the first one commits or rolls back.
create or replace function pm_ca_op_begin(p_op uuid, p_company uuid, p_action text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_got uuid; v_row record;
begin
  if p_op is null then raise exception 'BAD_OP' using errcode = 'P0001'; end if;
  insert into pm_cash_advance_ops (op_id, company_owner_id, action, actor_id)
  values (p_op, p_company, p_action, auth.uid())
  on conflict (op_id) do nothing
  returning op_id into v_got;
  if v_got is not null then return null; end if;
  select company_owner_id, action, result into v_row from pm_cash_advance_ops where op_id = p_op;
  if v_row.company_owner_id is distinct from p_company or v_row.action is distinct from p_action
     or v_row.result is null then
    raise exception 'OP_CONFLICT' using errcode = 'P0001';
  end if;
  return v_row.result;
end;
$$;

create or replace function pm_ca_op_end(p_op uuid, p_result jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update pm_cash_advance_ops set result = p_result where op_id = p_op;
  return p_result;
end;
$$;

-- R13. The one lock every balance-affecting write takes first.
create or replace function pm_ca_lock(p_id uuid, p_company uuid) returns pm_cash_advances
language plpgsql security definer set search_path = public, pg_temp as $$
declare v pm_cash_advances;
begin
  select * into v from pm_cash_advances where id = p_id and company_owner_id = p_company for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;
  return v;
end;
$$;

create or replace function pm_ca_repaid(p_id uuid) returns numeric
language sql security definer set search_path = public, pg_temp as $$
  select coalesce(sum(amount), 0) from pm_cash_advance_repayments where advance_id = p_id and voided_at is null
$$;

-- R15. A project being newly assigned must be live and in the caller's company.
create or replace function pm_ca_project_name(p_project uuid, p_company uuid) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare v text;
begin
  select cp.project_name into v
    from pm_project_companies m join construction_projects cp on cp.id = m.project_id
   where m.project_id = p_project and m.company_owner_id = p_company;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;
  return coalesce(v, '');
end;
$$;

create or replace function pm_ca_event(p_advance uuid, p_company uuid, p_kind text, p_repayment uuid,
                                       p_changes jsonb, p_reason text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into pm_cash_advance_events (advance_id, company_owner_id, kind, repayment_id, changes, reason, actor_id, actor_email)
  values (p_advance, p_company, p_kind, p_repayment, p_changes, p_reason, auth.uid(),
          (select email from profiles where id = auth.uid()));
end;
$$;

-- The one JSON shape every read and write returns. NO company check —
-- private; callers have already scoped p_id to the caller's company.
create or replace function pm_ca_advance_json(p_id uuid) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'id', a.id, 'project_id', a.project_id, 'project_name', a.project_name_snapshot,
    'project_deleted', not exists (select 1 from construction_projects cp where cp.id = a.project_id),
    'worker_name', a.worker_name, 'issued_on', a.issued_on, 'amount', a.amount, 'suggest_pct', a.suggest_pct,
    'notes', a.notes, 'created_at', a.created_at, 'updated_at', a.updated_at,
    'voided_at', a.voided_at, 'void_reason', a.void_reason,
    'voided_by_email', (select email from profiles where id = a.voided_by),
    'repayments', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', r.id, 'paid_on', r.paid_on, 'amount', r.amount, 'payroll_ref', r.payroll_ref,
               'notes', r.notes, 'created_at', r.created_at, 'voided_at', r.voided_at,
               'void_reason', r.void_reason,
               'voided_by_email', (select email from profiles where id = r.voided_by))
             order by r.paid_on, r.created_at, r.id)
        from pm_cash_advance_repayments r where r.advance_id = a.id), '[]'::jsonb),
    'events', coalesce((
      select jsonb_agg(jsonb_build_object(
               'kind', e.kind, 'repayment_id', e.repayment_id, 'changes', e.changes,
               'reason', e.reason, 'actor_email', e.actor_email, 'at', e.at) order by e.seq)
        from pm_cash_advance_events e where e.advance_id = a.id), '[]'::jsonb))
  from pm_cash_advances a where a.id = p_id
$$;

-- ── 3. Reads ──────────────────────────────────────────────────────────
create or replace function pm_ca_projects() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_company uuid := pm_owner_company();
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', cp.id, 'name', coalesce(cp.project_name, ''))
                     order by lower(coalesce(cp.project_name, '')), cp.id)
      from pm_project_companies m join construction_projects cp on cp.id = m.project_id
     where m.company_owner_id = v_company), '[]'::jsonb);
end;
$$;

create or replace function pm_ca_list() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_company uuid := pm_owner_company();
begin
  return coalesce((
    select jsonb_agg(pm_ca_advance_json(a.id) order by a.issued_on desc, a.created_at desc, a.id)
      from pm_cash_advances a where a.company_owner_id = v_company), '[]'::jsonb);
end;
$$;

-- ── 4. Writes ─────────────────────────────────────────────────────────
create or replace function pm_ca_record_advance(p_op_id uuid, p_project uuid, p_worker text, p_issued_on date,
                                                p_amount numeric, p_pct numeric, p_notes text)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_company uuid := pm_owner_company();
  v_prior   jsonb;
  v_worker  text := pm_ca_clean(p_worker);
  v_name    text;
  v_id      uuid;
begin
  v_prior := pm_ca_op_begin(p_op_id, v_company, 'record_advance');
  if v_prior is not null then return v_prior; end if;
  perform pm_ca_check_amount(p_amount);
  perform pm_ca_check_pct(p_pct);
  if v_worker is null or length(v_worker) > 120 then raise exception 'BAD_WORKER' using errcode = 'P0001'; end if;
  if p_issued_on is null then raise exception 'BAD_DATE' using errcode = 'P0001'; end if;
  v_name := pm_ca_project_name(p_project, v_company);
  insert into pm_cash_advances (company_owner_id, project_id, project_name_snapshot, worker_name, issued_on,
                                amount, suggest_pct, notes, created_by)
  values (v_company, p_project, v_name, v_worker, p_issued_on, p_amount, p_pct, pm_ca_clean(p_notes), auth.uid())
  returning id into v_id;
  perform pm_ca_event(v_id, v_company, 'issued', null, null, null);
  return pm_ca_op_end(p_op_id, jsonb_build_object('advance', pm_ca_advance_json(v_id)));
end;
$$;

create or replace function pm_ca_edit_advance(p_op_id uuid, p_id uuid, p_project uuid, p_worker text, p_issued_on date,
                                              p_amount numeric, p_pct numeric, p_notes text)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_company uuid := pm_owner_company();
  v_prior   jsonb;
  v_adv     pm_cash_advances;
  v_worker  text := pm_ca_clean(p_worker);
  v_notes   text := pm_ca_clean(p_notes);
  v_name    text;
  v_changes jsonb := '{}'::jsonb;
begin
  v_prior := pm_ca_op_begin(p_op_id, v_company, 'edit_advance');
  if v_prior is not null then return v_prior; end if;
  v_adv := pm_ca_lock(p_id, v_company);
  if v_adv.voided_at is not null then raise exception 'VOIDED' using errcode = 'P0001'; end if;
  perform pm_ca_check_amount(p_amount);
  perform pm_ca_check_pct(p_pct);
  if v_worker is null or length(v_worker) > 120 then raise exception 'BAD_WORKER' using errcode = 'P0001'; end if;
  if p_issued_on is null then raise exception 'BAD_DATE' using errcode = 'P0001'; end if;
  if p_amount < pm_ca_repaid(p_id) then raise exception 'BELOW_REPAID' using errcode = 'P0001'; end if;

  v_name := v_adv.project_name_snapshot;
  if p_project is distinct from v_adv.project_id then
    v_name := pm_ca_project_name(p_project, v_company);
    v_changes := v_changes || jsonb_build_object('project', jsonb_build_array(v_adv.project_name_snapshot, v_name));
  end if;
  if v_worker is distinct from v_adv.worker_name then
    v_changes := v_changes || jsonb_build_object('worker_name', jsonb_build_array(v_adv.worker_name, v_worker));
  end if;
  if p_issued_on is distinct from v_adv.issued_on then
    v_changes := v_changes || jsonb_build_object('issued_on', jsonb_build_array(v_adv.issued_on, p_issued_on));
  end if;
  if p_amount <> v_adv.amount then
    v_changes := v_changes || jsonb_build_object('amount', jsonb_build_array(v_adv.amount, p_amount::numeric(12,2)));
  end if;
  if p_pct <> v_adv.suggest_pct then
    v_changes := v_changes || jsonb_build_object('suggest_pct', jsonb_build_array(v_adv.suggest_pct, p_pct::numeric(5,2)));
  end if;
  if v_notes is distinct from v_adv.notes then
    v_changes := v_changes || jsonb_build_object('notes', jsonb_build_array(v_adv.notes, v_notes));
  end if;

  if v_changes <> '{}'::jsonb then
    update pm_cash_advances
       set project_id = p_project, project_name_snapshot = v_name, worker_name = v_worker,
           issued_on = p_issued_on, amount = p_amount, suggest_pct = p_pct, notes = v_notes,
           updated_by = auth.uid(), updated_at = now()
     where id = p_id;
    perform pm_ca_event(p_id, v_company, 'edited', null, v_changes, null);
  end if;
  return pm_ca_op_end(p_op_id, jsonb_build_object('advance', pm_ca_advance_json(p_id),
                                                  'changed', v_changes <> '{}'::jsonb));
end;
$$;

create or replace function pm_ca_record_repayment(p_op_id uuid, p_advance uuid, p_paid_on date, p_amount numeric,
                                                  p_payroll_ref jsonb, p_notes text)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_company uuid := pm_owner_company();
  v_prior   jsonb;
  v_adv     pm_cash_advances;
  v_ref     jsonb;
  v_rid     uuid;
begin
  v_prior := pm_ca_op_begin(p_op_id, v_company, 'record_repayment');
  if v_prior is not null then return v_prior; end if;
  v_adv := pm_ca_lock(p_advance, v_company);
  if v_adv.voided_at is not null then raise exception 'VOIDED' using errcode = 'P0001'; end if;
  perform pm_ca_check_amount(p_amount);
  if p_paid_on is null then raise exception 'BAD_DATE' using errcode = 'P0001'; end if;
  v_ref := pm_ca_clean_ref(p_payroll_ref);
  if p_amount > v_adv.amount - pm_ca_repaid(p_advance) then
    raise exception 'OVER_BALANCE' using errcode = 'P0001';
  end if;
  insert into pm_cash_advance_repayments (advance_id, company_owner_id, paid_on, amount, payroll_ref, notes, created_by)
  values (p_advance, v_company, p_paid_on, p_amount, v_ref, pm_ca_clean(p_notes), auth.uid())
  returning id into v_rid;
  perform pm_ca_event(p_advance, v_company, 'repaid', v_rid, null, null);
  return pm_ca_op_end(p_op_id, jsonb_build_object('advance', pm_ca_advance_json(p_advance), 'repayment_id', v_rid));
end;
$$;

create or replace function pm_ca_void_repayment(p_op_id uuid, p_repayment uuid, p_reason text)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_company uuid := pm_owner_company();
  v_prior   jsonb;
  v_reason  text := pm_ca_clean(p_reason);
  v_aid     uuid;
  v_rep     pm_cash_advance_repayments;
begin
  v_prior := pm_ca_op_begin(p_op_id, v_company, 'void_repayment');
  if v_prior is not null then return v_prior; end if;
  if v_reason is null then raise exception 'BAD_REASON' using errcode = 'P0001'; end if;
  select advance_id into v_aid from pm_cash_advance_repayments
   where id = p_repayment and company_owner_id = v_company;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;
  perform pm_ca_lock(v_aid, v_company);                       -- parent first, always
  select * into v_rep from pm_cash_advance_repayments where id = p_repayment for update;
  if v_rep.voided_at is not null then raise exception 'ALREADY_VOIDED' using errcode = 'P0001'; end if;
  update pm_cash_advance_repayments
     set voided_at = now(), voided_by = auth.uid(), void_reason = v_reason
   where id = p_repayment;
  perform pm_ca_event(v_aid, v_company, 'repayment_voided', p_repayment, null, v_reason);
  return pm_ca_op_end(p_op_id, jsonb_build_object('advance', pm_ca_advance_json(v_aid)));
end;
$$;

create or replace function pm_ca_void_advance(p_op_id uuid, p_id uuid, p_reason text)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_company uuid := pm_owner_company();
  v_prior   jsonb;
  v_reason  text := pm_ca_clean(p_reason);
  v_adv     pm_cash_advances;
begin
  v_prior := pm_ca_op_begin(p_op_id, v_company, 'void_advance');
  if v_prior is not null then return v_prior; end if;
  if v_reason is null then raise exception 'BAD_REASON' using errcode = 'P0001'; end if;
  v_adv := pm_ca_lock(p_id, v_company);
  if v_adv.voided_at is not null then raise exception 'ALREADY_VOIDED' using errcode = 'P0001'; end if;
  if exists (select 1 from pm_cash_advance_repayments where advance_id = p_id and voided_at is null) then
    raise exception 'HAS_REPAYMENTS' using errcode = 'P0001';
  end if;
  update pm_cash_advances set voided_at = now(), voided_by = auth.uid(), void_reason = v_reason where id = p_id;
  perform pm_ca_event(p_id, v_company, 'voided', null, null, v_reason);
  return pm_ca_op_end(p_op_id, jsonb_build_object('advance', pm_ca_advance_json(p_id)));
end;
$$;

-- ── 5. Privileges ─────────────────────────────────────────────────────
alter table pm_cash_advances           enable row level security;
alter table pm_cash_advance_repayments enable row level security;
alter table pm_cash_advance_events     enable row level security;
alter table pm_cash_advance_ops        enable row level security;
revoke all on table pm_cash_advances, pm_cash_advance_repayments, pm_cash_advance_events, pm_cash_advance_ops
  from public, anon, authenticated;
revoke all on function pm_ca_events_immutable(), pm_ca_clean(text), pm_ca_check_amount(numeric),
                       pm_ca_check_pct(numeric), pm_ca_clean_ref(jsonb), pm_ca_op_begin(uuid, uuid, text),
                       pm_ca_op_end(uuid, jsonb), pm_ca_lock(uuid, uuid), pm_ca_repaid(uuid),
                       pm_ca_project_name(uuid, uuid), pm_ca_event(uuid, uuid, text, uuid, jsonb, text),
                       pm_ca_advance_json(uuid)
  from public, anon, authenticated;
revoke all on function pm_ca_projects(), pm_ca_list(),
                       pm_ca_record_advance(uuid, uuid, text, date, numeric, numeric, text),
                       pm_ca_edit_advance(uuid, uuid, uuid, text, date, numeric, numeric, text),
                       pm_ca_record_repayment(uuid, uuid, date, numeric, jsonb, text),
                       pm_ca_void_repayment(uuid, uuid, text), pm_ca_void_advance(uuid, uuid, text)
  from public, anon;
grant execute on function pm_ca_projects(), pm_ca_list(),
                          pm_ca_record_advance(uuid, uuid, text, date, numeric, numeric, text),
                          pm_ca_edit_advance(uuid, uuid, uuid, text, date, numeric, numeric, text),
                          pm_ca_record_repayment(uuid, uuid, date, numeric, jsonb, text),
                          pm_ca_void_repayment(uuid, uuid, text), pm_ca_void_advance(uuid, uuid, text)
  to authenticated;
```

- [ ] **Step 5: Run the suite to confirm it passes**

Run: `node supabase/tests/pm_cash_advances.pglite.mjs`
Expected: every line `ok`, last line `28 passed, 0 failed`.
If one fails, fix the migration, never weaken the test. A `has_function_privilege` failure on PGlite means a `revoke` names the wrong signature.

- [ ] **Step 6: Wire it into `test:sql`**

In `package.json`, in the `"test:sql"` value, replace `&& node supabase/tests/pm_sharing_concurrency.mjs"` with:

```
&& node supabase/tests/pm_sharing_concurrency.mjs && node supabase/tests/pm_cash_advances.pglite.mjs"
```

Run: `npm run test:sql`
Expected: every suite passes, ending with the cash-advance suite's `28 passed, 0 failed`.

- [ ] **Step 7: Checkpoint (no commit)**

Changed: `supabase/migrations/0100_pm_cash_advances.sql`, `supabase/tests/pm_cash_advances_base.mjs`, `supabase/tests/pm_cash_advances.pglite.mjs`, `package.json`.

---

### Task 2: Race tests and real-role privileges on PostgreSQL

**Files:**
- Create: `supabase/tests/pm_cash_advances_concurrency.mjs`
- Modify: `package.json` (`test:sql`)

**Interfaces:**
- Consumes: the Task 1 functions, `pm_cash_advances_base.mjs`.
- Produces: nothing new. This task proves R13 and R16 under real concurrency.

- [ ] **Step 1: Write the race suite**

Create `supabase/tests/pm_cash_advances_concurrency.mjs`:

```js
// ════════════════════════════════════════════════════════════════════
// PM WORKER CASH ADVANCES (0100) — RACES ON REAL POSTGRESQL
//   npm run test:sql
// A throwaway PostgreSQL (embedded-postgres), 0098 + 0100 VERBATIM. Two
// owner sessions act on the SAME advance at the same moment; the advance
// row lock (R13) must serialise them and the op id (R16) must make a
// doubled submission record once. Then a real-role pass as `authenticated`.
// ════════════════════════════════════════════════════════════════════
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { PM_BASE, IDS, seedProfiles, M98, M100, PAYROLL_STANDIN } from './pm_cash_advances_base.mjs';

const ROUNDS = 12;
let passed = 0, failed = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) { passed++; console.log('  ok  ' + name); }
  else { failed++; failures.push(name + ' — ' + detail); console.log('  FAIL ' + name + '\n       ' + detail); }
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dacs-pmca-pg-'));
const port = 55000 + Math.floor(Math.random() * 4000);
const server = new EmbeddedPostgres({ databaseDir: dir, user: 'postgres', password: 'pw', port, persistent: false,
  initdbFlags: ['--encoding=UTF8', '--locale=C'], onLog: () => {} });
const cfg = { host: 'localhost', port, user: 'postgres', password: 'pw', database: 'postgres' };

const REPAY = `select pm_ca_record_repayment($1, $2, '2026-10-08', $3::numeric, null, null) r`;
const EDIT  = `select pm_ca_edit_advance($1, $2, $3, 'Racer', '2026-10-01', $4::numeric, 30, null) r`;
const VOIDA = `select pm_ca_void_advance($1, $2, 'race') r`;

console.log('\nPM worker cash advances — races (0100 on PostgreSQL)');
await server.initialise();
await server.start();
const admin = new pg.Client(cfg);
await admin.connect();
try {
  await admin.query(PM_BASE);
  await admin.query(PAYROLL_STANDIN);
  await admin.query(M98);
  await admin.query(M100);
  await seedProfiles((sql) => admin.query(sql));

  const asOwner = async (sql, params) => {
    await admin.query(`select set_config('test.uid', '${IDS.OWNER}', false)`);
    return (await admin.query(sql, params)).rows[0];
  };
  const pid = (await asOwner(`insert into construction_projects (project_name, status) values ('Race site', 'active') returning id`)).id;
  const newAdvance = async (amount) => (await asOwner(
    `select pm_ca_record_advance($1, $2, 'Racer', '2026-10-01', $3::numeric, 30, null) r`, [randomUUID(), pid, amount])).r.advance.id;
  const repaid = async (id) => Number((await admin.query(
    `select coalesce(sum(amount), 0) s from pm_cash_advance_repayments where advance_id = $1 and voided_at is null`, [id])).rows[0].s);
  const session = async (uid) => {
    const c = new pg.Client(cfg); await c.connect();
    await c.query(`select set_config('test.uid', '${uid}', false)`);
    return c;
  };
  // Each call runs in its own transaction and holds it briefly, so the
  // other session has to wait on the advance lock (or the op id).
  const run = async (c, sql, params) => {
    try {
      await c.query('begin');
      const r = await c.query(sql, params);
      await c.query('select pg_sleep(0.03)');
      await c.query('commit');
      return { ok: true, r: r.rows[0].r };
    } catch (e) {
      try { await c.query('rollback'); } catch {}
      return { ok: false, code: e.code, msg: e.message };
    }
  };
  const pair = async (a, b) => {
    const [s1, s2] = [await session(IDS.OWNER), await session(IDS.OWNER)];
    const out = await Promise.all([run(s1, ...a), run(s2, ...b)]);
    await s1.end(); await s2.end();
    return out;
  };
  let deadlock = false;
  const noteDeadlock = (rs) => { if (rs.some(r => r.code === '40P01')) deadlock = true; };

  // 1. Two repayments race for the last of a balance.
  let r1 = true, r1b = true;
  for (let i = 0; i < ROUNDS; i++) {
    const id = await newAdvance('1000');
    const rs = await pair([REPAY, [randomUUID(), id, '600']], [REPAY, [randomUUID(), id, '600']]);
    noteDeadlock(rs);
    if (rs.filter(r => r.ok).length !== 1 || !rs.find(r => !r.ok)?.msg.includes('OVER_BALANCE')) r1 = false;
    if (await repaid(id) !== 600) r1b = false;
  }
  check('two repayments for the last of a balance: exactly one wins, the other OVER_BALANCE', r1, 'a round broke the rule');
  check('repaid never exceeds the advance', r1b, 'repaid ≠ 600');

  // 2. A repayment races an amount reduction.
  let r2 = true;
  for (let i = 0; i < ROUNDS; i++) {
    const id = await newAdvance('1000');
    const rs = await pair([REPAY, [randomUUID(), id, '600']], [EDIT, [randomUUID(), id, pid, '500']]);
    noteDeadlock(rs);
    const loser = rs.find(r => !r.ok);
    const amount = Number((await admin.query(`select amount from pm_cash_advances where id = $1`, [id])).rows[0].amount);
    if (rs.filter(r => r.ok).length !== 1 || !loser || !/BELOW_REPAID|OVER_BALANCE/.test(loser.msg) || await repaid(id) > amount) r2 = false;
  }
  check('repayment vs amount reduction: one wins, repaid ≤ amount', r2, 'a round broke the rule');

  // 3. A repayment races voiding the advance.
  let r3 = true;
  for (let i = 0; i < ROUNDS; i++) {
    const id = await newAdvance('1000');
    const rs = await pair([REPAY, [randomUUID(), id, '600']], [VOIDA, [randomUUID(), id]]);
    noteDeadlock(rs);
    const loser = rs.find(r => !r.ok);
    if (rs.filter(r => r.ok).length !== 1 || !loser || !/HAS_REPAYMENTS|VOIDED/.test(loser.msg)) r3 = false;
  }
  check('repayment vs void advance: exactly one wins', r3, 'a round broke the rule');

  // 4. The same op id submitted twice at once (R16).
  let r4 = true;
  for (let i = 0; i < ROUNDS; i++) {
    const id = await newAdvance('1000');
    const op = randomUUID();
    const rs = await pair([REPAY, [op, id, '300']], [REPAY, [op, id, '300']]);
    noteDeadlock(rs);
    const n = Number((await admin.query(`select count(*) n from pm_cash_advance_repayments where advance_id = $1`, [id])).rows[0].n);
    const ev = Number((await admin.query(`select count(*) n from pm_cash_advance_events where advance_id = $1 and kind = 'repaid'`, [id])).rows[0].n);
    if (!rs.every(r => r.ok) || JSON.stringify(rs[0].r) !== JSON.stringify(rs[1].r) || n !== 1 || ev !== 1) r4 = false;
  }
  check('same op id twice at once: one repayment, one event, identical results', r4, 'a round broke the rule');
  check('no deadlock in any round', !deadlock, '40P01 seen');

  // ── Real-role pass: `authenticated` / `anon` with Supabase-like grants ──
  await admin.query(`grant usage on schema public to authenticated, anon;
    grant select, insert, update on construction_projects, profiles to authenticated;`);
  const asRole = async (role, uid) => {
    const c = new pg.Client(cfg); await c.connect();
    await c.query('set role ' + role);
    await c.query(`select set_config('test.uid', '${uid}', false)`);
    return c;
  };
  const errOf = async (c, sql, params) => { try { await c.query(sql, params); return null; } catch (e) { return e; } };
  const someId = await newAdvance('100');
  const own = await asRole('authenticated', IDS.OWNER);
  let listed = null;
  try { listed = (await own.query('select pm_ca_list() r')).rows[0].r; } catch (e) { listed = { err: e.message }; }
  check('(a) owner lists through pm_ca_list as authenticated', Array.isArray(listed) && listed.some(a => a.id === someId), JSON.stringify(listed).slice(0, 200));
  let rec = null;
  try { rec = (await own.query(`select pm_ca_record_advance($1, $2, 'Role pass', '2026-10-01', 50, 30, null) r`, [randomUUID(), pid])).rows[0].r; }
  catch (e) { rec = { err: e.message }; }
  check('(b) owner records through the function as authenticated', rec && rec.advance && rec.advance.worker_name === 'Role pass', JSON.stringify(rec));
  for (const [label, sql] of [['(c) direct select on pm_cash_advances', 'select * from pm_cash_advances'],
                              ['(d) direct insert into pm_cash_advance_ops', `insert into pm_cash_advance_ops (op_id, company_owner_id, action, actor_id) values (gen_random_uuid(), '${IDS.OWNER}', 'void_advance', '${IDS.OWNER}')`],
                              ['(e) private helper pm_ca_advance_json', `select pm_ca_advance_json('${someId}')`]]) {
    const e = await errOf(own, sql);
    check(label + ' fails 42501', e && e.code === '42501', e ? e.code + ' ' + e.message : 'no error');
  }
  await own.end();
  const stf = await asRole('authenticated', IDS.STAFF);
  const eS = await errOf(stf, 'select pm_ca_list()');
  check('(f) staff pm_ca_list raises OWNER_ONLY', eS && /OWNER_ONLY/.test(eS.message), eS ? eS.message : 'no error');
  await stf.end();
  const anon = await asRole('anon', '');
  const eA = await errOf(anon, 'select pm_ca_list()');
  check('(g) anon cannot execute pm_ca_list (42501)', eA && eA.code === '42501', eA ? eA.code + ' ' + eA.message : 'no error');
  await anon.end();
} finally {
  await admin.end();
  await server.stop();
  fs.rmSync(dir, { recursive: true, force: true });
}
console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) { console.log(failures.join('\n')); process.exit(1); }
```

- [ ] **Step 2: Run it**

Run: `node supabase/tests/pm_cash_advances_concurrency.mjs`
Expected: `13 passed, 0 failed`. A round where both sessions win means a write function reads the balance **before** `pm_ca_lock`. Fix the function, never the test.

- [ ] **Step 3: Wire it into `test:sql`**

In `package.json`, replace `&& node supabase/tests/pm_cash_advances.pglite.mjs"` with:

```
&& node supabase/tests/pm_cash_advances.pglite.mjs && node supabase/tests/pm_cash_advances_concurrency.mjs"
```

Run: `npm run test:sql` — Expected: all suites pass.

- [ ] **Step 4: Checkpoint (no commit)**

Changed: `supabase/tests/pm_cash_advances_concurrency.mjs`, `package.json`.

---

### Task 3: `js/cash-advance.js` — the one calculation and the RPC wrappers

**Files:**
- Create: `js/cash-advance.js`
- Create: `tests/cash-advance.test.js` (section A + shared fixtures + runner)
- Modify: `package.json` (`test` script)

**Interfaces:**
- Consumes: the Task 1 RPC names and JSON shapes; pm-admin.js helpers are passed in as arguments (`similarFn`, `groupFn`), never referenced by name here.
- Produces `window.CashAdvance` (also `module.exports`). **All money values are integer centavos** unless named `value`/`amount`:
  - `DEFAULT_PCT = 30`, `STATUS_LABEL`, `RELOAD_CODES: string[]`
  - `toCents(n) → int`, `pesos(cents) → '₱6,450.00'`, `fmtPct(n) → '30'`, `dateKey(date?) → 'YYYY-MM-DD'` (local)
  - `totals(adv) → { amountCents, repaidCents, balanceCents, status: 'unpaid'|'partial'|'paid'|'voided', label }`
  - `suggestion(basisCents, pct, balanceCents) → { raw, capped, isCapped, none }`
  - `parseAmount(str) → { ok:true, value:number, cents } | { ok:false, error }`
  - `parsePct(str) → { ok:true, value } | { ok:false, error }`
  - `laborLines(bills, workerName, similarFn?) → [{ key, billId, entryIds[], day, details, cents }]` newest day first
  - `payrollRef(line) → { billId, entryIds, day, details, amount }`
  - `nameSuggestions(bills, groupFn?) → string[]` sorted
  - `listSummary(advances, filters, similarFn?) → { rows: [{ adv, t }], totals: { advancedCents, repaidCents, outstandingCents } }` — `filters = { worker, project, status: 'all'|'unpaid'|'partial'|'paid', showVoided }`
  - `projectOptions(projects, advances) → [{ id, label, deleted }]`
  - `errorCode(message) → code|''`, `errorText(message, totals?) → { code, known, text }`
  - `newOpId() → uuid v4`
  - `server.{ list(), projects(), recordAdvance(op, f), editAdvance(op, id, f), recordRepayment(op, advanceId, f), voidRepayment(op, repaymentId, reason), voidAdvance(op, id, reason) }`. Here `f` for advances is `{ projectId, worker, issuedOn, amount, pct, notes }`, and for repayments `{ paidOn, amount, notes, payrollRef }`.

- [ ] **Step 1: Write the failing tests (section A, shared fixtures, runner)**

Create `tests/cash-advance.test.js`:

```js
// ════════════════════════════════════════════════════════════════════
// WORKER CASH ADVANCES — run with: node tests/cash-advance.test.js
// Spec: docs/superpowers/specs/2026-10-19-worker-cash-advances-design.md
// A drives js/cash-advance.js directly. B and C run the REAL screen files
// in the pm-admin sandbox (tests/helpers) — pm-admin.js is loaded but its
// projects grid is never opened, which is the "direct open" case.
// D checks the wiring and fences the ledger off from the money model.
// ════════════════════════════════════════════════════════════════════
'use strict';
process.env.TZ = 'Asia/Manila';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const CA = require('../js/cash-advance.js');
const { loadPmAdmin } = require('./helpers/pm-admin-sandbox.js');

let passed = 0, failed = 0;
const failures = [];
const queue = [];
function test(name, fn) { queue.push([name, fn]); }
function eq(a, b, label) {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error((label || 'value') + ': expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a));
}
function ok(c, label) { if (!c) throw new Error(label || 'expected truthy'); }

// ── shared fixtures ──────────────────────────────────────────────────
// pm-admin.js's real name helpers, the ones the screen borrows.
const PMA = loadPmAdmin();
const similar = PMA.ctx._pmNamesSimilar;
const groups = PMA.ctx._pmLaborNameGroups;

const PROJ = [{ id: 'P1', name: 'Alpha House' }, { id: 'P2', name: 'Beta Annex' }];
const ev = (kind, extra = {}) => ({ kind, at: '2026-10-01T02:00:00Z', actor_email: 'admin@dacs.test', changes: null, reason: null, repayment_id: null, ...extra });
const rep = (id, amount, extra = {}) => ({ id, amount, paid_on: '2026-10-08', payroll_ref: null, notes: null, created_at: '2026-10-08T02:00:00Z',
                                           voided_at: null, void_reason: null, voided_by_email: null, ...extra });
function adv(id, o = {}) {
  return { id, project_id: 'P1', project_name: 'Alpha House', project_deleted: false, worker_name: 'Francis Dela Cruz',
           issued_on: '2026-10-01', amount: 6000, suggest_pct: 30, notes: null, created_at: '2026-10-01T02:00:00Z', updated_at: null,
           voided_at: null, void_reason: null, voided_by_email: null, repayments: [], events: [ev('issued')], ...o };
}
// One project's daily bills (weeklyBills holds one doc per DAY; weekEndingDate is that day).
const BILLS = { P1: [
  { id: 'd1', weekEndingDate: '2026-10-07', entries: [
    { id: 'we_1', type: 'labor', details: 'Francis Dela Cruz', amount: 6450 },
    { id: 'we_2', type: 'labor', details: 'Danilo Reyes', amount: 3000 },
    { id: 'we_3', type: 'materials', details: 'Francis Dela Cruz', amount: 999 }] },
  { id: 'd2', weekEndingDate: '2026-10-08', entries: [
    // One payment split across two contracts — must show as ONE line.
    { id: 'we_4', type: 'labor', details: 'Franics Dela Cruz', amount: 2000, splitGroup: 'sp_1', splitIndex: 1, splitTotal: 2 },
    { id: 'we_5', type: 'labor', details: 'Franics Dela Cruz', amount: 1000, splitGroup: 'sp_1', splitIndex: 2, splitTotal: 2 }] },
  { id: 'd3', weekEndingDate: '2026-10-09', labor: 5000 },   // legacy total-only bill: no names
] };

// ══ A. Calculation (js/cash-advance.js) ═══════════════════════════════
test('A1 totals: unpaid / partial / fully paid / voided; voided repayments ignored', () => {
  eq(CA.totals(adv('a')), { amountCents: 600000, repaidCents: 0, balanceCents: 600000, status: 'unpaid', label: 'Unpaid' });
  eq(CA.totals(adv('a', { repayments: [rep('r', 1935)] })).status, 'partial');
  eq(CA.totals(adv('a', { repayments: [rep('r', 1935)] })).label, 'Partially Paid');
  eq(CA.totals(adv('a', { repayments: [rep('r', 6000)] })).label, 'Fully Paid');
  eq(CA.totals(adv('a', { repayments: [rep('r', 6000, { voided_at: '2026-10-09T00:00:00Z' })] })).balanceCents, 600000);
  eq(CA.totals(adv('a', { voided_at: '2026-10-09T00:00:00Z' })).label, 'Voided');
  eq(CA.totals(adv('a', { amount: 0.3, repayments: [rep('r1', 0.1), rep('r2', 0.2)] })).status, 'paid', 'no float drift');
});
test('A2 suggestion: ₱6,450 × 30% = ₱1,935; capped; 0% / no basis / no balance → none', () => {
  eq(CA.suggestion(645000, 30, 600000), { raw: 193500, capped: 193500, isCapped: false, none: false });
  eq(CA.suggestion(645000, 30, 120000), { raw: 193500, capped: 120000, isCapped: true, none: false });
  eq(CA.suggestion(645000, 0, 600000).none, true);
  eq(CA.suggestion(0, 30, 600000).none, true);
  eq(CA.suggestion(645000, 30, 0).none, true);
  eq(CA.suggestion(645000, 100, 900000).raw, 645000);
  eq(CA.suggestion(100000, 33.33, 900000).raw, 33330);
  eq(CA.suggestion(5, 30, 900000).raw, 2, 'half-up on centavos (1.5 → 2)');
  eq(CA.suggestion(1, 1, 900000).none, true, 'rounds to nothing → none');
});
test('A3 parseAmount: commas and ₱ allowed; >2 decimals rejected, never rounded', () => {
  eq(CA.parseAmount('1,935'), { ok: true, value: 1935, cents: 193500 });
  eq(CA.parseAmount('₱ 6,450.50'), { ok: true, value: 6450.5, cents: 645050 });
  eq(CA.parseAmount('100.005'), { ok: false, error: 'Amounts can have at most two decimal places.' });
  for (const s of ['0', '0.00', '-5', 'abc', '', '12345678901', '1.'])
    eq(CA.parseAmount(s), { ok: false, error: 'Enter an amount above ₱0.' }, s);
});
test('A4 parsePct: 0–100, two decimals at most', () => {
  eq(CA.parsePct('30'), { ok: true, value: 30 });
  eq(CA.parsePct('0'), { ok: true, value: 0 });
  eq(CA.parsePct('100'), { ok: true, value: 100 });
  eq(CA.parsePct('12.5%'), { ok: true, value: 12.5 });
  eq(CA.parsePct('100.01'), { ok: false, error: 'Suggested % must be 0 to 100.' });
  eq(CA.parsePct(''), { ok: false, error: 'Suggested % must be 0 to 100.' });
  eq(CA.parsePct('30.125'), { ok: false, error: 'Suggested % can have at most two decimal places.' });
});
test('A5 laborLines: fuzzy name, Labor only, split legs merged, newest first', () => {
  eq(CA.laborLines(BILLS.P1, 'Francis Dela Cruz', similar), [
    { key: 'd2|sp:sp_1', billId: 'd2', entryIds: ['we_4', 'we_5'], day: '2026-10-08', details: 'Franics Dela Cruz', cents: 300000 },
    { key: 'd1|e:we_1', billId: 'd1', entryIds: ['we_1'], day: '2026-10-07', details: 'Francis Dela Cruz', cents: 645000 }]);
  eq(CA.laborLines(BILLS.P1, 'Francis Dela Cruz').map(l => l.key), ['d1|e:we_1'], 'no helper → exact names only');
  // pm-admin treats an entry with no/unknown type as Labor; so do we.
  eq(CA.laborLines([{ id: 'd9', weekEndingDate: '2026-10-01', entries: [{ id: 'x', details: 'Francis Dela Cruz', amount: 100 }] }],
                   'Francis Dela Cruz', similar).length, 1);
  eq(CA.laborLines([], 'Francis', similar), []);
});
test('A6 payrollRef is the snapshot the server stores', () => {
  const line = CA.laborLines(BILLS.P1, 'Francis Dela Cruz', similar)[1];
  eq(CA.payrollRef(line), { billId: 'd1', entryIds: ['we_1'], day: '2026-10-07', details: 'Francis Dela Cruz', amount: 6450 });
});
test('A7 nameSuggestions: grouped by pm-admin, exact without it', () => {
  eq(CA.nameSuggestions(BILLS.P1, groups), ['Danilo Reyes', 'Franics Dela Cruz']);
  eq(CA.nameSuggestions(BILLS.P1), ['Danilo Reyes', 'Francis Dela Cruz', 'Franics Dela Cruz']);
});
test('A8 listSummary: totals skip voided; filters; newest issue first', () => {
  const list = [adv('a1', { repayments: [rep('r1', 1935)] }), adv('a2', { worker_name: 'Danilo Reyes', amount: 1000, issued_on: '2026-09-20', repayments: [rep('r2', 1000)] }),
                adv('a3', { amount: 500, voided_at: '2026-09-26T01:00:00Z' }), adv('a4', { worker_name: 'Ana Santos', amount: 2000, issued_on: '2026-10-05', project_id: 'P9' })];
  const base = { worker: '', project: '', status: 'all', showVoided: false };
  const s = CA.listSummary(list, base, similar);
  eq(s.rows.map(r => r.adv.id), ['a4', 'a1', 'a2']);
  eq(s.totals, { advancedCents: 900000, repaidCents: 293500, outstandingCents: 606500 });
  eq(CA.listSummary(list, { ...base, showVoided: true }, similar).rows.map(r => r.adv.id), ['a4', 'a1', 'a3', 'a2']);
  eq(CA.listSummary(list, { ...base, showVoided: true }, similar).totals.advancedCents, 900000, 'voided never counts');
  eq(CA.listSummary(list, { ...base, status: 'paid' }, similar).rows.map(r => r.adv.id), ['a2']);
  eq(CA.listSummary(list, { ...base, status: 'unpaid', showVoided: true }, similar).rows.map(r => r.adv.id), ['a4'], 'voided only under All');
  eq(CA.listSummary(list, { ...base, worker: 'Franics Dela Cruz' }, similar).rows.map(r => r.adv.id), ['a1'], 'typo');
  eq(CA.listSummary(list, { ...base, worker: 'ana' }, similar).rows.map(r => r.adv.id), ['a4'], 'part of a name');
  eq(CA.listSummary(list, { ...base, project: 'P9' }, similar).rows.map(r => r.adv.id), ['a4']);
});
test('A9 projectOptions: live projects plus deleted ones taken from advances', () => {
  eq(CA.projectOptions(PROJ, [adv('a', { project_id: 'P9', project_name: 'Old Site', project_deleted: true }), adv('b')]), [
    { id: 'P1', label: 'Alpha House', deleted: false }, { id: 'P2', label: 'Beta Annex', deleted: false },
    { id: 'P9', label: 'Old Site (project deleted)', deleted: true }]);
});
test('A10 errorText: server codes → plain messages; anything else is unknown', () => {
  const t = CA.totals(adv('a', { repayments: [rep('r', 1935)] }));
  eq(CA.errorText('OVER_BALANCE', t), { code: 'OVER_BALANCE', known: true, text: "That's more than the remaining balance of ₱4,065.00." });
  eq(CA.errorText('BELOW_REPAID', t).text, "The amount can't be lower than the ₱1,935.00 already repaid.");
  eq(CA.errorText('ALREADY_VOIDED').text, 'This was already voided.');
  eq(CA.errorText('VOIDED').text, 'This was already voided.');
  eq(CA.errorText('HAS_REPAYMENTS').text, "Void this advance's repayments first.");
  eq(CA.errorText('OWNER_ONLY').text, 'Only owner accounts can use Cash Advances.');
  eq(CA.errorText('BAD_PRECISION').text, 'Amounts can have at most two decimal places.');
  eq(CA.errorText('Failed to fetch'), { code: '', known: false, text: 'Failed to fetch' });
  ok(CA.RELOAD_CODES.includes('OVER_BALANCE') && CA.RELOAD_CODES.includes('ALREADY_VOIDED'), 'reload codes');
});
test('A11 dateKey uses local parts (PH, UTC+8)', () => {
  eq(CA.dateKey(new Date(2026, 9, 19, 0, 30)), '2026-10-19');
  ok(/^\d{4}-\d{2}-\d{2}$/.test(CA.dateKey()), 'today');
});
test('A12 newOpId: v4 uuids, never repeated', () => {
  const ids = new Set(Array.from({ length: 50 }, () => CA.newOpId()));
  eq(ids.size, 50);
  ids.forEach(id => ok(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id), id));
});
test('A13 pesos / fmtPct / DEFAULT_PCT', () => {
  eq([CA.pesos(645000), CA.pesos(0), CA.pesos(-150)], ['₱6,450.00', '₱0.00', '−₱1.50']);
  eq([CA.fmtPct(30), CA.fmtPct('12.50'), CA.fmtPct(33.333)], ['30', '12.5', '33.33']);
  eq(CA.DEFAULT_PCT, 30);
});

// ── runner ───────────────────────────────────────────────────────────
(async () => {
  console.log('\nWorker cash advances');
  for (const [name, fn] of queue) {
    try { await fn(); passed++; console.log('  ok  ' + name); }
    catch (e) { failed++; failures.push(name + ' — ' + e.message); console.log('  FAIL ' + name + '\n       ' + e.message); }
  }
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  if (failed) { console.log(failures.join('\n')); process.exit(1); }
})();
```

- [ ] **Step 2: Run to confirm it fails**

Run: `node tests/cash-advance.test.js`
Expected: `Error: Cannot find module '../js/cash-advance.js'`.

- [ ] **Step 3: Write `js/cash-advance.js`**

```js
/* ══════════════════════════════════════════════════════════
   WORKER CASH ADVANCES — the ONE calculation (window.CashAdvance)
   Spec: docs/superpowers/specs/2026-10-19-worker-cash-advances-design.md

   A tracking ledger OUTSIDE the money model. Money advanced to a worker on
   a PM project, and the repayments the owner records by hand:

     Repaid     = sum of the non-voided repayments
     Balance    = advance − repaid   (the server refuses any repayment above it)
     Suggestion = payroll × suggested %, capped at the balance — a LABEL,
                  never a deduction, payment or repayment

   Pure functions + the thin server wrappers. This is the ONLY file that
   names the server's cash-advance functions (tests/cash-advance.test.js
   fences it). Nothing here touches payroll, expenses or Spent / Earned /
   Profit. Money is handled in integer centavos.
   ══════════════════════════════════════════════════════════ */
(function (root) {
  'use strict';

  const DEFAULT_PCT = 30;
  const STATUS_LABEL = { unpaid: 'Unpaid', partial: 'Partially Paid', paid: 'Fully Paid', voided: 'Voided' };
  // pm-admin.js's daily-expense types; anything unrecognised is Labor there, so here too.
  const PM_ENTRY_TYPES = ['labor', 'materials', 'both', 'overhead'];

  // Integer centavos. The epsilon absorbs binary noise (1.005 * 100 = 100.4999…).
  function toCents(n) {
    const x = Number(n);
    if (!Number.isFinite(x)) return 0;
    const c = Math.round(Math.abs(x) * 100 + 1e-6);
    return x < 0 ? -c : c;
  }
  function pesos(cents) {
    const c = Math.round(Number(cents) || 0);
    const s = (Math.abs(c) / 100).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return (c < 0 ? '−' : '') + '₱' + s;
  }
  function fmtPct(n) {
    const x = Number(n);
    return String(Number.isFinite(x) ? Math.round(x * 100) / 100 : 0);
  }
  // Local date key — never toISOString().slice(0,10) (PH is UTC+8).
  function dateKey(d) {
    const x = d instanceof Date ? d : new Date();
    return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0');
  }

  function totals(adv) {
    const a = adv || {};
    const amountCents = toCents(a.amount);
    const repaidCents = (a.repayments || []).filter(r => r && !r.voided_at).reduce((s, r) => s + toCents(r.amount), 0);
    const balanceCents = amountCents - repaidCents;
    let status;
    if (a.voided_at) status = 'voided';
    else if (repaidCents <= 0) status = 'unpaid';
    else if (balanceCents <= 0) status = 'paid';
    else status = 'partial';
    return { amountCents, repaidCents, balanceCents, status, label: STATUS_LABEL[status] };
  }

  // basis × pct in integer maths: pct is held in hundredths of a percent, so
  // ₱6,450 × 30% = 645000 × 3000 / 10000 = 193500 centavos, rounded half-up.
  function suggestion(basisCents, pct, balanceCents) {
    const b = Math.round(Number(basisCents) || 0);
    const p = Math.round((Number(pct) || 0) * 100);
    const bal = Math.round(Number(balanceCents) || 0);
    const none = { raw: 0, capped: 0, isCapped: false, none: true };
    if (p <= 0 || b <= 0 || bal <= 0) return none;
    const raw = Math.floor((b * p + 5000) / 10000);
    if (raw <= 0) return none;
    return { raw, capped: Math.min(raw, bal), isCapped: raw > bal, none: false };
  }

  // The form sends the value AS TYPED (after stripping ₱ and commas) — never
  // pre-rounded, so 100.005 is refused rather than stored as 100.01.
  function parseAmount(str) {
    const s = String(str == null ? '' : str).replace(/[₱,\s]/g, '');
    if (/^\d+\.\d{3,}$/.test(s)) return { ok: false, error: 'Amounts can have at most two decimal places.' };
    if (!/^\d{1,10}(\.\d{1,2})?$/.test(s)) return { ok: false, error: 'Enter an amount above ₱0.' };
    const value = Number(s);
    if (!(value > 0)) return { ok: false, error: 'Enter an amount above ₱0.' };
    return { ok: true, value, cents: toCents(value) };
  }
  function parsePct(str) {
    const s = String(str == null ? '' : str).replace(/[%\s]/g, '');
    if (/^\d+\.\d{3,}$/.test(s)) return { ok: false, error: 'Suggested % can have at most two decimal places.' };
    if (!/^\d{1,3}(\.\d{1,2})?$/.test(s)) return { ok: false, error: 'Suggested % must be 0 to 100.' };
    const value = Number(s);
    if (value < 0 || value > 100) return { ok: false, error: 'Suggested % must be 0 to 100.' };
    return { ok: true, value };
  }

  function nameKey(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }
  function exactSimilar(a, b) { const k = nameKey(a); return k !== '' && k === nameKey(b); }
  function entryType(v) { return PM_ENTRY_TYPES.indexOf(v) >= 0 ? v : 'labor'; }

  // A worker's Labor lines on one project. Legs of one split payment
  // (splitGroup) are one line, summed — never "(1/2)" rows.
  function laborLines(bills, workerName, similarFn) {
    const same = typeof similarFn === 'function' ? similarFn : exactSimilar;
    const byKey = new Map();
    (bills || []).forEach(b => {
      const entries = Array.isArray(b && b.entries) ? b.entries : [];
      entries.forEach((e, i) => {
        if (!e || entryType(e.type) !== 'labor') return;
        const details = String(e.details || '').trim();
        if (!details || !same(details, workerName)) return;
        const key = String(b.id) + '|' + (e.splitGroup ? 'sp:' + e.splitGroup : 'e:' + (e.id || 'i' + i));
        let line = byKey.get(key);
        if (!line) {
          line = { key, billId: String(b.id), entryIds: [], day: String(b.weekEndingDate || ''), details, cents: 0 };
          byKey.set(key, line);
        }
        line.entryIds.push(String(e.id || ''));
        line.cents += toCents(e.amount);
      });
    });
    return Array.from(byKey.values()).filter(l => l.cents > 0)
      .sort((x, y) => y.day.localeCompare(x.day) || x.details.localeCompare(y.details));
  }
  function payrollRef(line) {
    return { billId: line.billId, entryIds: line.entryIds.slice(), day: line.day, details: line.details, amount: line.cents / 100 };
  }
  function nameSuggestions(bills, groupFn) {
    const rows = [];
    (bills || []).forEach(b => (Array.isArray(b && b.entries) ? b.entries : []).forEach(e => {
      const details = String((e && e.details) || '').trim();
      if (e && details && entryType(e.type) === 'labor') rows.push({ details, amount: Number(e.amount) || 0 });
    }));
    let names;
    if (typeof groupFn === 'function') names = Array.from(groupFn(rows), g => g.canonical);
    else {
      const seen = new Map();
      rows.forEach(r => { const k = nameKey(r.details); if (k && !seen.has(k)) seen.set(k, r.details); });
      names = Array.from(seen.values());
    }
    return names.filter(Boolean).sort((a, b) => a.localeCompare(b));
  }

  // A voided advance is listed only with "Show voided" on AND the All chip.
  function listSummary(advances, filters, similarFn) {
    const f = Object.assign({ worker: '', project: '', status: 'all', showVoided: false }, filters || {});
    const same = typeof similarFn === 'function' ? similarFn : exactSimilar;
    const q = String(f.worker || '').trim();
    const qk = nameKey(q);
    const rows = (advances || []).map(a => ({ adv: a, t: totals(a) })).filter(({ adv, t }) => {
      if (t.status === 'voided' && !(f.showVoided && f.status === 'all')) return false;
      if (f.status !== 'all' && t.status !== f.status) return false;
      if (f.project && adv.project_id !== f.project) return false;
      if (qk && !(nameKey(adv.worker_name).includes(qk) || same(adv.worker_name, q))) return false;
      return true;
    }).sort((x, y) => String(y.adv.issued_on || '').localeCompare(String(x.adv.issued_on || ''))
                   || String(y.adv.created_at || '').localeCompare(String(x.adv.created_at || '')));
    const live = rows.filter(r => r.t.status !== 'voided');
    return { rows, totals: {
      advancedCents: live.reduce((s, r) => s + r.t.amountCents, 0),
      repaidCents: live.reduce((s, r) => s + r.t.repaidCents, 0),
      outstandingCents: live.reduce((s, r) => s + Math.max(0, r.t.balanceCents), 0) } };
  }
  function projectOptions(projects, advances) {
    const out = new Map();
    (projects || []).forEach(p => { if (p && p.id) out.set(p.id, { id: p.id, label: p.name || 'Untitled project', deleted: false }); });
    (advances || []).forEach(a => {
      if (!a || !a.project_id || out.has(a.project_id)) return;
      out.set(a.project_id, { id: a.project_id, label: (a.project_name || 'Untitled project') + (a.project_deleted ? ' (project deleted)' : ''),
                              deleted: !!a.project_deleted });
    });
    return Array.from(out.values()).sort((x, y) => x.label.localeCompare(y.label));
  }

  const MESSAGES = {
    OWNER_ONLY: 'Only owner accounts can use Cash Advances.',
    NOT_OFFICE: 'Only owner accounts can use Cash Advances.',
    OVER_BALANCE: (t) => t ? "That's more than the remaining balance of " + pesos(t.balanceCents) + '.' : "That's more than the remaining balance.",
    BELOW_REPAID: (t) => t ? "The amount can't be lower than the " + pesos(t.repaidCents) + ' already repaid.' : "The amount can't be lower than what has already been repaid.",
    HAS_REPAYMENTS: "Void this advance's repayments first.",
    BAD_AMOUNT: 'Enter an amount above ₱0.',
    BAD_PCT: 'Suggested % must be 0 to 100.',
    BAD_PRECISION: 'Amounts can have at most two decimal places.',
    BAD_REASON: 'Give a reason for voiding.',
    BAD_WORKER: "Enter the worker's name.",
    BAD_DATE: 'Pick a date.',
    BAD_REF: "That payroll line couldn't be linked — pick it again or type an amount.",
    VOIDED: 'This was already voided.',
    ALREADY_VOIDED: 'This was already voided.',
    OP_CONFLICT: 'This form was already used for something else — close it and try again.',
    BAD_OP: 'Close the form and try again.',
    NOT_FOUND: 'This record or project no longer exists — the list has been reloaded.',
    INACTIVE: 'This account is not active.',
    PROFILE_MISSING: 'This account has no profile.',
    BAD_COMPANY_LINK: 'This account is not linked to a valid company.',
    NOT_SIGNED_IN: 'Sign in again and retry.',
  };
  // Refusals that mean the screen is out of date: reload before showing the message.
  const RELOAD_CODES = ['OVER_BALANCE', 'BELOW_REPAID', 'HAS_REPAYMENTS', 'VOIDED', 'ALREADY_VOIDED', 'NOT_FOUND'];
  function errorCode(message) {
    const toks = String(message || '').match(/[A-Z][A-Z_]{2,}/g) || [];
    return toks.find(t => Object.prototype.hasOwnProperty.call(MESSAGES, t)) || '';
  }
  function errorText(message, t) {
    const code = errorCode(message);
    if (!code) return { code: '', known: false, text: String(message || 'Unknown error') };
    const m = MESSAGES[code];
    return { code, known: true, text: typeof m === 'function' ? m(t || null) : m };
  }

  function newOpId() {
    const c = root.crypto;
    if (c && typeof c.randomUUID === 'function') return c.randomUUID();
    const b = new Uint8Array(16);
    c.getRandomValues(b);
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    const h = Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
    return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20);
  }

  // ── server calls (owner-role accounts; the server re-checks everything) ──
  async function rpc(name, args) {
    const sb = root.sbClient;
    if (!sb || typeof sb.rpc !== 'function') throw new Error('Not connected');
    const { data, error } = await sb.rpc(name, args || {});
    if (error) throw new Error(error.message || String(error));
    return data;
  }
  const server = {
    list: () => rpc('pm_ca_list'),
    projects: () => rpc('pm_ca_projects'),
    recordAdvance: (op, f) => rpc('pm_ca_record_advance', { p_op_id: op, p_project: f.projectId, p_worker: f.worker,
      p_issued_on: f.issuedOn, p_amount: f.amount, p_pct: f.pct, p_notes: f.notes || null }),
    editAdvance: (op, id, f) => rpc('pm_ca_edit_advance', { p_op_id: op, p_id: id, p_project: f.projectId, p_worker: f.worker,
      p_issued_on: f.issuedOn, p_amount: f.amount, p_pct: f.pct, p_notes: f.notes || null }),
    recordRepayment: (op, advanceId, f) => rpc('pm_ca_record_repayment', { p_op_id: op, p_advance: advanceId,
      p_paid_on: f.paidOn, p_amount: f.amount, p_payroll_ref: f.payrollRef || null, p_notes: f.notes || null }),
    voidRepayment: (op, repaymentId, reason) => rpc('pm_ca_void_repayment', { p_op_id: op, p_repayment: repaymentId, p_reason: reason }),
    voidAdvance: (op, id, reason) => rpc('pm_ca_void_advance', { p_op_id: op, p_id: id, p_reason: reason }),
  };

  const api = { DEFAULT_PCT, STATUS_LABEL, RELOAD_CODES, toCents, pesos, fmtPct, dateKey, totals, suggestion,
                parseAmount, parsePct, laborLines, payrollRef, nameSuggestions, listSummary, projectOptions,
                errorCode, errorText, newOpId, server };
  root.CashAdvance = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
```

- [ ] **Step 4: Run to confirm it passes**

Run: `node --check js/cash-advance.js && node tests/cash-advance.test.js`
Expected: `13 passed, 0 failed`.

- [ ] **Step 5: Wire into `npm test`**

In `package.json`'s `"test"` value, replace the final `&& node tests/pm-sharing.test.js"` with:

```
&& node tests/pm-sharing.test.js && node tests/cash-advance.test.js"
```

Run: `npm test` — Expected: every suite passes (the money suite unchanged).

- [ ] **Step 6: Checkpoint (no commit)**

Changed: `js/cash-advance.js`, `tests/cash-advance.test.js`, `package.json`.

---

### Task 4: `js/cash-advance-admin.js` — list, detail, history, payroll loading

**Files:**
- Create: `js/cash-advance-admin.js`
- Modify: `tests/cash-advance.test.js` (add the sandbox helpers + section B **above** the `// ── runner` line)

**Interfaces:**
- Consumes: `window.CashAdvance` (Task 3); the global `db` (supabase-config.js shim) for `db.collection('constructionProjects').doc(id).collection('weeklyBills').get()`; pm-admin.js top-level functions `_pmNamesSimilar(a, b) → bool` and `_pmLaborNameGroups(rows) → [{ canonical }]`; optional globals `registerViewCleanup(fn)`, `_dacsReportError(kind, message, source, line, col, stack)`, `_pmToast(msg, isError)`.
- DOM holders (created in Task 6): `#pmCashAdvancesRoot` (list shell or detail), `#pmCashAdvancesModal` (forms). The list shell itself contains `#pmCashAdvancesResults`.
- Produces `window.CashAdvanceAdmin` and `window.initCashAdvances` (= `init`):
  - `init() → Promise`, `load() → Promise`, `render()`, `renderResults()`, `setFilter(key, value)`, `open(id)`, `close()`
  - `_state` — `{ seq, loading, loaded, error, advances, projects, filters, openId, bills, modal, fallbackReported }`
  - `_setApi(api|null)` — swap the server object (tests)
  - `_upsert(advance)` — replace or add an advance in `_state.advances`
  - `_h` — `{ esc, money, fmtDay, fmtAt, field, loadBills(projectId) → Promise<{ bills, error }>, similar() → fn|undefined, grouper() → fn|undefined, server() → api, report(message, stack) }`

- [ ] **Step 1: Add the sandbox helpers and section B tests**

In `tests/cash-advance.test.js`, insert above `// ── runner ──…`:

```js
// ── screen sandbox ───────────────────────────────────────────────────
// The real pm-admin.js is loaded (for its name helpers) but its projects
// grid is never opened — exactly the "open Cash Advances directly" case.
function fakeDb(bills, failFor) {
  const calls = [];
  return { calls, collection: (c) => ({ doc: (pid) => ({ collection: (sub) => ({ get: async () => {
    calls.push([c, pid, sub]);
    if (failFor && failFor.includes(pid)) throw new Error('offline');
    return { docs: (bills[pid] || []).map(b => ({ id: b.id, data: () => { const { id, ...rest } = b; return rest; } })) };
  } }) }) }) };
}
function fakeApi(advances, projects = PROJ) {
  const api = { calls: [], state: { advances } };
  api.list = async () => { api.calls.push(['list']); return JSON.parse(JSON.stringify(api.state.advances)); };
  api.projects = async () => { api.calls.push(['projects']); return projects; };
  return api;
}
const SCREEN_FILES = ['js/cash-advance.js', 'js/cash-advance-admin.js'];
function loadCA(role, opts = {}) {
  const sb = loadPmAdmin({ role });
  sb.ctx.crypto = globalThis.crypto;
  sb.db = fakeDb(opts.bills || BILLS, opts.billsFail);
  sb.ctx.db = sb.db;
  sb.cleanups = [];
  sb.ctx.registerViewCleanup = (fn) => sb.cleanups.push(fn);
  sb.reports = [];
  sb.ctx._dacsReportError = (...a) => sb.reports.push(a);
  for (const f of SCREEN_FILES) vm.runInContext(read(f), sb.ctx, { filename: f });
  sb.D = sb.ctx.CashAdvanceAdmin;
  const html = (id) => sb.ctx.document.getElementById(id).innerHTML;
  sb.root = () => html('pmCashAdvancesRoot');
  sb.results = () => html('pmCashAdvancesResults');
  sb.modal = () => html('pmCashAdvancesModal');
  return sb;
}
const ADVANCES = () => [
  adv('a1', { repayments: [rep('r1', 1935, { payroll_ref: { billId: 'd1', entryIds: ['we_1'], day: '2026-10-07', details: 'Francis Dela Cruz', amount: 6450 } })],
              events: [ev('issued'), ev('repaid', { repayment_id: 'r1' })] }),
  adv('a2', { worker_name: 'Danilo Reyes', amount: 1000, issued_on: '2026-09-20', repayments: [rep('r2', 1000)],
              events: [ev('issued'), ev('repaid', { repayment_id: 'r2' })] }),
  adv('a3', { worker_name: 'Voided Worker', amount: 500, issued_on: '2026-09-25', voided_at: '2026-09-26T01:00:00Z',
              void_reason: 'Wrong worker', voided_by_email: 'admin@dacs.test', events: [ev('issued'), ev('voided', { reason: 'Wrong worker' })] }),
  adv('a4', { worker_name: 'Ana Santos', amount: 2000, issued_on: '2026-08-02', project_id: 'P9', project_name: 'Old Site', project_deleted: true }),
];

// ══ B. Screens — list and detail (real cash-advance-admin.js) ═════════
test('B1 owner: list loads; totals skip voided; rows show status and a deleted project', async () => {
  const sb = loadCA('owner'); const api = fakeApi(ADVANCES()); sb.D._setApi(api);
  await sb.D.init();
  for (const s of ['Cash Advances', '+ New advance', 'Tracking only', 'Show voided']) ok(sb.root().includes(s), 'shell missing: ' + s);
  const r = sb.results();
  for (const s of ['₱9,000.00', '₱2,935.00', '₱6,065.00', 'Francis Dela Cruz', 'Partially Paid', 'Danilo Reyes', 'Fully Paid',
                   'Ana Santos', 'Unpaid', 'Old Site', '(project deleted)']) ok(r.includes(s), 'results missing: ' + s);
  ok(!r.includes('Voided Worker'), 'voided hidden by default');
  eq(api.calls.map(c => c[0]).sort(), ['list', 'projects']);
  eq(sb.db.calls.length, 0, 'the list never reads payroll');
});
test('B2 staff: nothing rendered, nothing fetched', async () => {
  const sb = loadCA('staff'); const api = fakeApi(ADVANCES()); sb.D._setApi(api);
  await sb.D.init();
  eq(sb.root(), '');
  eq(api.calls.length, 0);
});
test('B3 filters: status, show voided, worker (typo and part), deleted project', async () => {
  const sb = loadCA('owner'); sb.D._setApi(fakeApi(ADVANCES())); await sb.D.init();
  const names = () => ['Francis Dela Cruz', 'Danilo Reyes', 'Voided Worker', 'Ana Santos'].filter(n => sb.results().includes(n));
  sb.D.setFilter('status', 'paid'); eq(names(), ['Danilo Reyes']);
  sb.D.setFilter('status', 'all'); sb.D.setFilter('showVoided', true);
  eq(names(), ['Francis Dela Cruz', 'Danilo Reyes', 'Voided Worker', 'Ana Santos']);
  ok(sb.results().includes('pca-badge--voided'), 'voided badge');
  sb.D.setFilter('showVoided', false);
  sb.D.setFilter('worker', 'Franics Dela Cruz'); eq(names(), ['Francis Dela Cruz'], 'typo still finds the worker');
  sb.D.setFilter('worker', 'ana'); eq(names(), ['Ana Santos'], 'part of a name');
  sb.D.setFilter('worker', ''); sb.D.setFilter('project', 'P9'); eq(names(), ['Ana Santos']);
  ok(sb.root().includes('Old Site (project deleted)'), 'deleted project offered in the filter');
  sb.D.setFilter('project', ''); sb.D.setFilter('status', 'unpaid'); eq(names(), ['Ana Santos']);
});
test('B4 detail of a partly repaid advance', async () => {
  const sb = loadCA('owner'); sb.D._setApi(fakeApi(ADVANCES())); await sb.D.init();
  sb.D.open('a1');
  const h = sb.root();
  for (const s of ['← Cash Advances', 'Francis Dela Cruz', 'Alpha House', '₱6,000.00', '₱1,935.00', '₱4,065.00', '30% of payroll',
                   'Record repayment', 'Edit advance', 'Void advance', 'Void its repayments first.', 'Advance issued',
                   'Repayment ₱1,935.00', 'From payroll: Oct 7, 2026 · Francis Dela Cruz · ₱6,450.00'])
    ok(h.includes(s), 'missing: ' + s);
  ok(h.includes('pca-btn--danger" disabled'), 'Void advance disabled while a repayment is live');
  ok(h.includes("CashAdvanceAdmin.openVoid('repayment', 'r1')"), 'a live repayment can be voided');
  sb.D.close();
  ok(sb.root().includes('+ New advance'), 'back to the list');
});
test('B5 detail: fully paid has no Record repayment; a voided advance is read-only', async () => {
  const sb = loadCA('owner'); sb.D._setApi(fakeApi(ADVANCES())); await sb.D.init();
  sb.D.open('a2');
  ok(!sb.root().includes('Record repayment'), 'fully paid');
  ok(sb.root().includes('Edit advance'), 'still editable');
  sb.D.open('a3');
  const h = sb.root();
  ok(h.includes('Wrong worker') && h.includes('admin@dacs.test') && h.includes('Advance voided'), 'void shown with who and why');
  ok(!h.includes('Record repayment') && !h.includes('Edit advance') && !h.includes('Void advance'), 'no actions on a voided advance');
});
test('B6 history: original issue amount, edits old → new, a struck-through voided repayment', async () => {
  const list = [adv('a5', { amount: 6500,
    repayments: [rep('r5', 500, { voided_at: '2026-10-09T03:00:00Z', void_reason: 'Entered twice', voided_by_email: 'admin-pm@dacs.test' })],
    events: [ev('issued'), ev('edited', { changes: { amount: [6000, 6500], worker_name: ['Francis', 'Francis Dela Cruz'] } }),
             ev('repaid', { repayment_id: 'r5' }), ev('repayment_voided', { repayment_id: 'r5', reason: 'Entered twice' })] })];
  const sb = loadCA('owner'); sb.D._setApi(fakeApi(list)); await sb.D.init();
  sb.D.open('a5');
  const h = sb.root();
  for (const s of ['Advance issued</b> — ₱6,000.00', 'Amount ₱6,000.00 → ₱6,500.00', 'Worker Francis → Francis Dela Cruz',
                   'class="is-void"', 'by admin-pm@dacs.test — Entered twice', 'Repayment of ₱500.00 voided</b> — Entered twice'])
    ok(h.includes(s), 'missing: ' + s);
  ok(!h.includes("openVoid('repayment', 'r5')"), 'a voided repayment cannot be voided again');
  ok(h.includes('₱6,500.00'), 'balance back to the full amount');
});
test('B7 payroll is fetched per project, cached, and dropped when the view is left', async () => {
  const sb = loadCA('owner'); sb.D._setApi(fakeApi(ADVANCES())); await sb.D.init();
  const r = await sb.D._h.loadBills('P1');
  eq([r.error, r.bills.length], [null, 3]);
  await sb.D._h.loadBills('P1');
  eq(sb.db.calls, [['constructionProjects', 'P1', 'weeklyBills']], 'second read served from the cache');
  ok(sb.cleanups.length >= 1, 'a view cleanup is registered');
  sb.cleanups.forEach(fn => fn());
  eq(Object.keys(sb.D._state.bills).length, 0);
  await sb.D._h.loadBills('P1');
  eq(sb.db.calls.length, 2, 're-opened view reads fresh payroll');
});
test('B8 a load failure shows a plain message and Retry', async () => {
  const sb = loadCA('owner'); const api = fakeApi(ADVANCES());
  api.list = async () => { throw new Error('OWNER_ONLY'); };
  sb.D._setApi(api); await sb.D.init();
  ok(sb.results().includes('Only owner accounts can use Cash Advances.') && sb.results().includes('Retry'), sb.results());
});
test('B9 the screen file never writes to the database', () => {
  const src = read('js/cash-advance-admin.js');
  ok(!/\.(set|update|add|delete)\(/.test(src), 'found a write call');
  ok(!/pm_ca_|pm_cash_advance/.test(src), 'the screen must go through window.CashAdvance.server');
});
```

- [ ] **Step 2: Run to confirm section B fails**

Run: `node tests/cash-advance.test.js`
Expected: B1–B9 FAIL (`ENOENT … js/cash-advance-admin.js`); A1–A13 still pass.

- [ ] **Step 3: Write `js/cash-advance-admin.js`**

```js
/* ══════════════════════════════════════════════════════════
   PM → CASH ADVANCES — list and detail (window.CashAdvanceAdmin)
   Spec: docs/superpowers/specs/2026-10-19-worker-cash-advances-design.md §6

   Owner-role accounts only: anyone else gets an empty view and nothing is
   fetched (the server refuses them too). Every figure comes from
   window.CashAdvance; this file only renders. A tracking ledger — payroll
   and project totals are never changed, and nothing here writes anything.

   Holders inside #pmCashAdvancesView:
     #pmCashAdvancesRoot     the list shell (header, filters) or one advance
     #pmCashAdvancesResults  totals + table, inside the shell — re-rendered on
                             each filter change so typing never loses focus
     #pmCashAdvancesModal    the open form (js/cash-advance-forms.js)

   Payroll (Labor lines) is read HERE, per project, straight from
   constructionProjects/{id}/weeklyBills — never from pm-admin.js state —
   so the view works when opened directly (spec §6.1a). Only pm-admin.js's
   name helpers are borrowed; without them names match exactly.
   ══════════════════════════════════════════════════════════ */
(function () {
    'use strict';
    const S = {
        seq: 0, loading: false, loaded: false, error: null, advances: [], projects: [],
        filters: { worker: '', project: '', status: 'all', showVoided: false },
        openId: null, bills: Object.create(null), modal: null, fallbackReported: false,
    };
    let api = null;
    const CA = () => window.CashAdvance;
    const server = () => api || CA().server;
    const $ = (id) => document.getElementById(id);
    const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    const canSee = () => window.currentUserRole === 'owner';
    const money = (cents) => CA().pesos(cents);
    const field = (label, inner) => '<label class="pca-field"><span class="pca-label">' + esc(label) + '</span>' + inner + '</label>';

    function fmtDay(key) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(String(key || ''))) return key ? String(key) : '—';
        const [y, m, d] = String(key).split('-').map(Number);
        return new Date(y, m - 1, d).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' });
    }
    function fmtAt(iso) {
        const d = new Date(iso);
        if (isNaN(d)) return '';
        return d.toLocaleString('en-PH', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
    }

    function report(message, stack) {
        try {
            if (typeof window._dacsReportError === 'function') {
                window._dacsReportError('error', 'cash-advance: ' + message, 'cash-advance-admin.js', 0, 0, stack || '');
            }
        } catch (_) { /* the reporter must never break the screen */ }
    }
    // pm-admin.js's top-level name helpers. Missing → exact matching, reported once.
    function helper(name) {
        const fn = window[name];
        if (typeof fn === 'function') return fn;
        if (!S.fallbackReported) {
            S.fallbackReported = true;
            report(name + ' missing — exact name matching');
        }
        return undefined;
    }
    const similar = () => helper('_pmNamesSimilar');
    const grouper = () => helper('_pmLaborNameGroups');

    // One read per project per visit; a failed read is not cached.
    function loadBills(projectId) {
        if (!projectId) return Promise.resolve({ bills: [], error: null });
        if (!S.bills[projectId]) {
            const store = (typeof db !== 'undefined') ? db : null;
            S.bills[projectId] = Promise.resolve()
                .then(() => store.collection('constructionProjects').doc(projectId).collection('weeklyBills').get())
                .then(snap => ({ bills: snap.docs.map(d => ({ id: d.id, ...d.data() })), error: null }))
                .catch(e => { delete S.bills[projectId]; return { bills: [], error: e || new Error('load failed') }; });
        }
        return S.bills[projectId];
    }

    function cleanup() {
        S.bills = Object.create(null);
        S.modal = null;
        S.openId = null;
        const m = $('pmCashAdvancesModal');
        if (m) m.innerHTML = '';
    }

    function init() {
        if (!canSee()) {
            const root = $('pmCashAdvancesRoot'); if (root) root.innerHTML = '';
            const m = $('pmCashAdvancesModal'); if (m) m.innerHTML = '';
            return Promise.resolve();
        }
        cleanup();
        if (typeof window.registerViewCleanup === 'function') window.registerViewCleanup(cleanup);
        return load();
    }

    async function load() {
        if (!canSee()) return;
        const seq = ++S.seq;
        S.loading = true; S.error = null;
        render();
        try {
            const [advances, projects] = await Promise.all([server().list(), server().projects()]);
            if (seq !== S.seq) return;
            S.advances = Array.isArray(advances) ? advances : [];
            S.projects = Array.isArray(projects) ? projects : [];
            S.loaded = true;
        } catch (e) {
            if (seq !== S.seq) return;
            const t = CA().errorText(e && e.message);
            if (!t.known) report(t.text, e && e.stack);
            S.error = t.text;
        } finally {
            if (seq === S.seq) { S.loading = false; render(); }
        }
    }

    function upsert(advance) {
        if (!advance || !advance.id) return;
        const i = S.advances.findIndex(a => a.id === advance.id);
        if (i >= 0) S.advances[i] = advance; else S.advances.push(advance);
    }

    function render() {
        const root = $('pmCashAdvancesRoot');
        if (!root) return;
        if (!canSee()) { root.innerHTML = ''; return; }
        const open = S.openId ? S.advances.find(a => a.id === S.openId) : null;
        if (open) { root.innerHTML = detailHtml(open); return; }
        S.openId = null;
        root.innerHTML = shellHtml();
        renderResults();
    }

    function setFilter(key, value) {
        S.filters[key] = value;
        if (key === 'worker') renderResults();   // keep the search box (and its focus)
        else render();
    }
    function open(id) { S.openId = id; render(); }
    function close() { S.openId = null; render(); }

    // ── list ─────────────────────────────────────────────────────────
    const badge = (t) => '<span class="pca-badge pca-badge--' + t.status + '">' + esc(t.label) + '</span>';
    const projectLabel = (a) => esc(a.project_name || 'Untitled project')
        + (a.project_deleted ? ' <span class="pca-muted">(project deleted)</span>' : '');

    function shellHtml() {
        const f = S.filters;
        const opts = CA().projectOptions(S.projects, S.advances);
        const chip = (v, label) => '<button type="button" class="pca-chip' + (f.status === v ? ' is-on' : '') + '" aria-pressed="'
            + (f.status === v) + '" onclick="CashAdvanceAdmin.setFilter(\'status\', \'' + v + '\')">' + esc(label) + '</button>';
        return '<div class="pca">'
            + '<div class="pca-head"><div><h2 class="pca-title">Cash Advances</h2>'
            +   '<p class="pca-sub">Money advanced to workers and what they have paid back. Tracking only — payroll and project totals are not changed.</p></div>'
            +   '<button type="button" class="pca-btn pca-btn--primary" onclick="CashAdvanceAdmin.openAdvanceForm()">+ New advance</button></div>'
            + '<div class="pca-filters">'
            +   '<input type="search" id="pcaFilterWorker" class="pca-input" placeholder="Search worker" aria-label="Search worker" value="'
            +     esc(f.worker) + '" oninput="CashAdvanceAdmin.setFilter(\'worker\', this.value)">'
            +   '<select id="pcaFilterProject" class="pca-input" aria-label="Project" onchange="CashAdvanceAdmin.setFilter(\'project\', this.value)">'
            +     '<option value="">All projects</option>'
            +     opts.map(o => '<option value="' + esc(o.id) + '"' + (f.project === o.id ? ' selected' : '') + '>' + esc(o.label) + '</option>').join('')
            +   '</select>'
            +   '<div class="pca-chips" role="group" aria-label="Status">'
            +     chip('all', 'All') + chip('unpaid', 'Unpaid') + chip('partial', 'Partially Paid') + chip('paid', 'Fully Paid') + '</div>'
            +   '<label class="pca-check"><input type="checkbox" id="pcaShowVoided"' + (f.showVoided ? ' checked' : '')
            +     ' onchange="CashAdvanceAdmin.setFilter(\'showVoided\', this.checked)"> Show voided</label>'
            + '</div>'
            + '<div id="pmCashAdvancesResults"></div>'
            + '</div>';
    }

    function renderResults() {
        const el = $('pmCashAdvancesResults');
        if (!el) return;
        if (S.loading && !S.loaded) { el.innerHTML = '<p class="pca-muted">Loading cash advances…</p>'; return; }
        if (S.error) {
            el.innerHTML = '<div class="pca-alert">' + esc(S.error)
                + ' <button type="button" class="pca-btn" onclick="CashAdvanceAdmin.load()">Retry</button></div>';
            return;
        }
        const sum = CA().listSummary(S.advances, S.filters, similar());
        const card = (label, cents) => '<div class="pca-card"><span class="pca-card-label">' + esc(label)
            + '</span><span class="pca-card-value">' + money(cents) + '</span></div>';
        let h = '<div class="pca-cards">' + card('Total advanced', sum.totals.advancedCents)
            + card('Total repaid', sum.totals.repaidCents) + card('Outstanding', sum.totals.outstandingCents) + '</div>';
        if (!S.advances.length) { el.innerHTML = h + '<p class="pca-empty">No cash advances yet.</p>'; return; }
        if (!sum.rows.length) { el.innerHTML = h + '<p class="pca-empty">No cash advances match.</p>'; return; }
        h += '<div class="pca-table-wrap"><table class="pca-table"><thead><tr><th>Worker</th><th>Project</th><th>Issued</th>'
            + '<th class="num">Advanced</th><th class="num">Repaid</th><th class="num">Balance</th><th class="num">%</th><th>Status</th>'
            + '</tr></thead><tbody>'
            + sum.rows.map(({ adv, t }) => {
                const go = 'CashAdvanceAdmin.open(\'' + esc(adv.id) + '\')';
                return '<tr class="pca-row' + (t.status === 'voided' ? ' is-void' : '') + '" tabindex="0" onclick="' + go
                    + '" onkeydown="if(event.key===\'Enter\')' + go + '">'
                    + '<td>' + esc(adv.worker_name) + '</td><td>' + projectLabel(adv) + '</td><td>' + esc(fmtDay(adv.issued_on)) + '</td>'
                    + '<td class="num">' + money(t.amountCents) + '</td><td class="num">' + money(t.repaidCents) + '</td>'
                    + '<td class="num">' + money(t.balanceCents) + '</td><td class="num">' + esc(CA().fmtPct(adv.suggest_pct)) + '%</td>'
                    + '<td>' + badge(t) + '</td></tr>';
            }).join('')
            + '</tbody></table></div>';
        el.innerHTML = h;
    }

    // ── detail ───────────────────────────────────────────────────────
    const FIELD = { project: 'Project', worker_name: 'Worker', issued_on: 'Date issued', amount: 'Amount',
                    suggest_pct: 'Suggested %', notes: 'Notes' };
    function changesText(ch) {
        return Object.keys(ch || {}).map(k => {
            const pair = Array.isArray(ch[k]) ? ch[k] : [null, null];
            const f = (v) => k === 'amount' ? money(CA().toCents(v))
                : k === 'suggest_pct' ? CA().fmtPct(v) + '%'
                : k === 'issued_on' ? fmtDay(v)
                : (v == null || v === '' ? '(blank)' : String(v));
            return esc(FIELD[k] || k) + ' ' + esc(f(pair[0])) + ' → ' + esc(f(pair[1]));
        }).join('; ');
    }
    // The amount at issue: the "old" side of the first amount edit, else today's amount.
    function issuedAmount(adv) {
        const e = (adv.events || []).find(x => x.kind === 'edited' && x.changes && x.changes.amount);
        return e ? e.changes.amount[0] : adv.amount;
    }
    function historyHtml(adv) {
        const reps = new Map((adv.repayments || []).map(r => [r.id, r]));
        const live = !adv.voided_at;
        const who = (e) => ' <span class="pca-muted">' + esc(fmtAt(e.at)) + (e.actor_email ? ' · ' + esc(e.actor_email) : '') + '</span>';
        const voidNote = (x) => '<div class="pca-void-note">Voided ' + esc(fmtAt(x.voided_at))
            + (x.voided_by_email ? ' by ' + esc(x.voided_by_email) : '') + ' — ' + esc(x.void_reason) + '</div>';
        return (adv.events || []).map(e => {
            if (e.kind === 'issued') return '<li><b>Advance issued</b> — ' + money(CA().toCents(issuedAmount(adv))) + who(e) + '</li>';
            if (e.kind === 'edited') return '<li><b>Edited</b> — ' + changesText(e.changes) + who(e) + '</li>';
            if (e.kind === 'repaid') {
                const r = reps.get(e.repayment_id) || {};
                const voided = !!r.voided_at;
                return '<li' + (voided ? ' class="is-void"' : '') + '><b>Repayment ' + money(CA().toCents(r.amount)) + '</b> paid '
                    + esc(fmtDay(r.paid_on)) + who(e)
                    + (r.payroll_ref ? '<div class="pca-ref">From payroll: ' + esc(fmtDay(r.payroll_ref.day)) + ' · '
                        + esc(r.payroll_ref.details) + ' · ' + money(CA().toCents(r.payroll_ref.amount)) + '</div>' : '')
                    + (r.notes ? '<div class="pca-ref">' + esc(r.notes) + '</div>' : '')
                    + (voided ? voidNote(r)
                        : (live ? ' <button type="button" class="pca-link" onclick="CashAdvanceAdmin.openVoid(\'repayment\', \''
                            + esc(r.id) + '\')">Void</button>' : ''))
                    + '</li>';
            }
            if (e.kind === 'repayment_voided') {
                const r = reps.get(e.repayment_id) || {};
                return '<li><b>Repayment of ' + money(CA().toCents(r.amount)) + ' voided</b> — ' + esc(e.reason) + who(e) + '</li>';
            }
            if (e.kind === 'voided') return '<li><b>Advance voided</b> — ' + esc(e.reason) + who(e) + '</li>';
            return '';
        }).join('');
    }
    function detailHtml(adv) {
        const t = CA().totals(adv);
        const live = !adv.voided_at;
        const liveReps = (adv.repayments || []).filter(r => !r.voided_at);
        const stat = (label, val) => '<div class="pca-stat"><span class="pca-card-label">' + esc(label)
            + '</span><span class="pca-stat-value">' + val + '</span></div>';
        let h = '<div class="pca"><button type="button" class="pca-back" onclick="CashAdvanceAdmin.close()">← Cash Advances</button>'
            + '<div class="pca-head"><div><h2 class="pca-title">' + esc(adv.worker_name) + '</h2>'
            + '<p class="pca-sub">' + projectLabel(adv) + ' · issued ' + esc(fmtDay(adv.issued_on)) + '</p></div>' + badge(t) + '</div>'
            + '<div class="pca-cards">' + stat('Advanced', money(t.amountCents)) + stat('Repaid', money(t.repaidCents))
            + stat('Balance', money(t.balanceCents)) + stat('Suggested repayment', esc(CA().fmtPct(adv.suggest_pct)) + '% of payroll') + '</div>';
        if (adv.notes) h += '<p class="pca-notes"><b>Agreement:</b> ' + esc(adv.notes) + '</p>';
        if (!live) {
            h += '<div class="pca-alert">Voided ' + esc(fmtAt(adv.voided_at)) + (adv.voided_by_email ? ' by ' + esc(adv.voided_by_email) : '')
                + ' — ' + esc(adv.void_reason) + '</div>';
        } else {
            const id = esc(adv.id);
            h += '<div class="pca-actions">'
                + (t.balanceCents > 0 ? '<button type="button" class="pca-btn pca-btn--primary" onclick="CashAdvanceAdmin.openRepaymentForm(\''
                    + id + '\')">Record repayment</button>' : '')
                + '<button type="button" class="pca-btn" onclick="CashAdvanceAdmin.openAdvanceForm(\'' + id + '\')">Edit advance</button>'
                + '<button type="button" class="pca-btn pca-btn--danger"' + (liveReps.length ? ' disabled aria-describedby="pcaVoidHint"' : '')
                + ' onclick="CashAdvanceAdmin.openVoid(\'advance\', \'' + id + '\')">Void advance</button>'
                + (liveReps.length ? '<span id="pcaVoidHint" class="pca-muted">Void its repayments first.</span>' : '')
                + '</div>';
        }
        h += '<h3 class="pca-h3">History</h3><ol class="pca-history">' + historyHtml(adv) + '</ol></div>';
        return h;
    }

    window.CashAdvanceAdmin = {
        init, load, render, renderResults, setFilter, open, close,
        _state: S,
        _setApi: (a) => { api = a || null; },
        _upsert: upsert,
        _h: { esc, money, fmtDay, fmtAt, field, loadBills, similar, grouper, server, report },
    };
    window.initCashAdvances = init;
})();
```

- [ ] **Step 4: Run to confirm it passes**

Run: `node --check js/cash-advance-admin.js && node tests/cash-advance.test.js`
Expected: `22 passed, 0 failed`.

- [ ] **Step 5: Checkpoint (no commit)**

Changed: `js/cash-advance-admin.js`, `tests/cash-advance.test.js`.

---

### Task 5: `js/cash-advance-forms.js` — advance, repayment (with the suggestion) and void pop-ups

**Files:**
- Create: `js/cash-advance-forms.js`
- Modify: `tests/cash-advance.test.js` (`SCREEN_FILES` gains the forms file; add `writeApi` + section C above `// ── runner`)

**Interfaces:**
- Consumes: `window.CashAdvance` (Task 3); `window.CashAdvanceAdmin._state`, `._h`, `._upsert`, `.render`, `.load` (Task 4).
- Produces, merged into `window.CashAdvanceAdmin`: `openAdvanceForm(id?)`, `pickProject(projectId) → Promise<string[]>`, `saveAdvance() → Promise`, `openRepaymentForm(advanceId) → Promise`, `pickBasis(value)`, `renderCalc()`, `useSuggestion()`, `saveRepayment() → Promise`, `openVoid('advance'|'repayment', id)`, `saveVoid() → Promise`, `closeModal()`.
- `_state.modal` while a form is open: `{ kind: 'advance'|'repay'|'void', opId, saving, label, id?, advanceId?, what?, projectId?, lines?, linesError?, basis?, suggest? }`.
- Element ids: `pcaProject`, `pcaWorker`, `pcaWorkerNames`, `pcaNamesNote`, `pcaIssued`, `pcaAmount`, `pcaPct`, `pcaNotes`, `pcaBasis`, `pcaBasisTyped`, `pcaBasisAmt`, `pcaLinesNote`, `pcaCalc`, `pcaUse`, `pcaPaidOn`, `pcaAmt`, `pcaLinkWrap`, `pcaLinkRef`, `pcaRepNotes`, `pcaVoidReason`, `pcaFormError`, `pcaSave`.

- [ ] **Step 1: Add the forms to the sandbox and write section C**

In `tests/cash-advance.test.js`, change:

```js
const SCREEN_FILES = ['js/cash-advance.js', 'js/cash-advance-admin.js'];
```

to:

```js
const SCREEN_FILES = ['js/cash-advance.js', 'js/cash-advance-admin.js', 'js/cash-advance-forms.js'];
```

Then insert above `// ── runner ──…`:

```js
// A fake server that applies writes to its own copy and answers like the RPCs.
function writeApi(advances) {
  const api = fakeApi(advances);
  const find = (id) => api.state.advances.find(a => a.id === id);
  const done = (id) => ({ advance: JSON.parse(JSON.stringify(find(id))) });
  api.recordAdvance = async (op, f) => {
    api.calls.push(['recordAdvance', op, f]);
    api.state.advances.push(adv('new1', { project_id: f.projectId, worker_name: f.worker, amount: f.amount,
                                          suggest_pct: f.pct, issued_on: f.issuedOn, notes: f.notes }));
    return done('new1');
  };
  api.editAdvance = async (op, id, f) => {
    api.calls.push(['editAdvance', op, id, f]);
    Object.assign(find(id), { worker_name: f.worker, amount: f.amount, suggest_pct: f.pct, issued_on: f.issuedOn, notes: f.notes });
    return done(id);
  };
  api.recordRepayment = async (op, id, f) => {
    api.calls.push(['recordRepayment', op, id, f]);
    const a = find(id);
    a.repayments.push(rep('rN' + a.repayments.length, f.amount, { paid_on: f.paidOn, payroll_ref: f.payrollRef }));
    return done(id);
  };
  api.voidRepayment = async (op, rid, reason) => {
    api.calls.push(['voidRepayment', op, rid, reason]);
    const a = api.state.advances.find(x => x.repayments.some(r => r.id === rid));
    Object.assign(a.repayments.find(r => r.id === rid), { voided_at: '2026-10-10T00:00:00Z', void_reason: reason });
    return done(a.id);
  };
  api.voidAdvance = async (op, id, reason) => {
    api.calls.push(['voidAdvance', op, id, reason]);
    Object.assign(find(id), { voided_at: '2026-10-10T00:00:00Z', void_reason: reason });
    return done(id);
  };
  return api;
}
const el = (sb, id) => sb.ctx.document.getElementById(id);
const setVal = (sb, id, v) => { el(sb, id).value = v; };
const errText = (sb) => el(sb, 'pcaFormError').textContent;
const calc = (sb) => el(sb, 'pcaCalc').innerHTML;
async function opened(list, opts) {
  const sb = loadCA('owner', opts); const api = writeApi(list || ADVANCES()); sb.D._setApi(api);
  await sb.D.init();
  return { sb, api };
}
const lineOf = (sb, billId) => sb.D._state.modal.lines.find(l => l.billId === billId);

// ══ C. Forms (real cash-advance-forms.js) ═════════════════════════════
test('C1 direct open: no projects grid, names load from the picked project payroll', async () => {
  const { sb } = await opened();
  ok(sb.ctx.CashAdvance && !sb.ctx.document.getElementById('pmProjectsGrid').innerHTML, 'pm-admin grid never rendered');
  sb.D.openAdvanceForm();
  ok(sb.modal().includes('New cash advance') && sb.modal().includes('id="pcaPct" class="pca-input" inputmode="decimal" value="30"'), 'default 30%');
  ok(sb.modal().includes('value="' + sb.ctx.CashAdvance.dateKey() + '"'), 'today, local');
  await sb.D.pickProject('P1');
  eq(sb.db.calls, [['constructionProjects', 'P1', 'weeklyBills']]);
  const dl = el(sb, 'pcaWorkerNames').innerHTML;
  ok(dl.includes('value="Franics Dela Cruz"') && dl.includes('value="Danilo Reyes"'), dl);
  ok(!dl.includes('value="Francis Dela Cruz"'), 'spelling variants grouped into one name');
});
test('C2 new advance: browser checks, then one server call with the typed values', async () => {
  const { sb, api } = await opened();
  sb.D.openAdvanceForm();
  const fill = (o) => { for (const [k, v] of Object.entries(o)) setVal(sb, k, v); };
  fill({ pcaProject: '', pcaWorker: 'Ana', pcaIssued: '2026-10-19', pcaAmount: '2,500.50', pcaPct: '30', pcaNotes: '' });
  await sb.D.saveAdvance(); eq(errText(sb), 'Choose a project.');
  fill({ pcaProject: 'P1', pcaPct: '101' }); await sb.D.saveAdvance(); eq(errText(sb), 'Suggested % must be 0 to 100.');
  fill({ pcaPct: '30.125' }); await sb.D.saveAdvance(); eq(errText(sb), 'Suggested % can have at most two decimal places.');
  fill({ pcaPct: '30', pcaAmount: '2500.505' }); await sb.D.saveAdvance(); eq(errText(sb), 'Amounts can have at most two decimal places.');
  fill({ pcaAmount: '0' }); await sb.D.saveAdvance(); eq(errText(sb), 'Enter an amount above ₱0.');
  fill({ pcaWorker: '  ', pcaAmount: '2,500.50' }); await sb.D.saveAdvance(); eq(errText(sb), "Enter the worker's name.");
  fill({ pcaWorker: 'Ana' }); await sb.D.saveAdvance();
  const calls = api.calls.filter(c => c[0] === 'recordAdvance');
  eq(calls.length, 1, 'refused-in-browser attempts never reached the server');
  eq(calls[0][2], { projectId: 'P1', worker: 'Ana', issuedOn: '2026-10-19', amount: 2500.5, pct: 30, notes: null });
  ok(/^[0-9a-f-]{36}$/.test(calls[0][1]), 'op id sent');
  eq(sb.modal(), '', 'closed');
  ok(sb.results().includes("CashAdvanceAdmin.open('new1')"), 'listed');
});
test('C3 edit: amount shows the repaid floor; below it is refused before the server', async () => {
  const { sb, api } = await opened();
  sb.D.openAdvanceForm('a1');
  const m = sb.modal();
  ok(m.includes('Edit advance') && m.includes('value="6000.00"') && m.includes("Can't go below ₱1,935.00 already repaid."), m);
  for (const [k, v] of Object.entries({ pcaProject: 'P1', pcaWorker: 'Francis Dela Cruz', pcaIssued: '2026-10-01', pcaAmount: '1000', pcaPct: '30', pcaNotes: '' }))
    setVal(sb, k, v);
  await sb.D.saveAdvance();
  eq(errText(sb), "The amount can't be lower than the ₱1,935.00 already repaid.");
  setVal(sb, 'pcaAmount', '6500');
  await sb.D.saveAdvance();
  const c = api.calls.find(x => x[0] === 'editAdvance');
  eq([c[2], c[3].amount], ['a1', 6500]);
  eq(sb.modal(), '');
});
test('C4 repayment form: the worker\'s Labor lines, newest first, split legs as one; amount starts empty', async () => {
  const { sb } = await opened();
  await sb.D.openRepaymentForm('a1');
  const sel = el(sb, 'pcaBasis').innerHTML;
  ok(sel.indexOf('Oct 8, 2026') > -1 && sel.indexOf('Oct 8, 2026') < sel.indexOf('Oct 7, 2026'), 'newest first: ' + sel);
  ok(sel.includes('₱3,000.00') && !sel.includes('₱2,000.00') && !sel.includes('₱1,000.00'), 'split shown once, not its parts');
  ok(!sel.includes('Danilo') && !sel.includes('₱999.00') && !sel.includes('₱5,000.00'), 'other worker / materials / total-only excluded');
  ok(sel.includes('value="typed">Type an amount'), 'typed basis offered');
  ok(sb.modal().includes('id="pcaAmt" class="pca-input" inputmode="decimal" value=""'), 'actual amount starts empty');
  ok(sb.modal().includes('Balance <b>₱4,065.00</b>'), 'balance shown');
});
test('C5 suggestion from a payroll line; Use copies it, nothing else does', async () => {
  const { sb } = await opened();
  await sb.D.openRepaymentForm('a1');
  sb.D.pickBasis(lineOf(sb, 'd1').key);
  ok(calc(sb).includes('₱6,450.00 × 30% = <b>₱1,935.00</b> suggested'), calc(sb));
  ok(calc(sb).includes('Use ₱1,935.00') && calc(sb).includes('Suggestion only — nothing is deducted.'), calc(sb));
  eq(el(sb, 'pcaAmt').value, '', 'a suggestion never fills the amount by itself');
  eq(el(sb, 'pcaLinkWrap').style.display, '', 'link option shown for a picked line');
  sb.D.useSuggestion();
  eq(el(sb, 'pcaAmt').value, '1935.00');
});
test('C6 capped at the balance; 0% → No suggestion and no Use button', async () => {
  const list = [adv('a6', { repayments: [rep('r6', 4800)] }), adv('a7', { suggest_pct: 0 })];
  const { sb } = await opened(list);
  await sb.D.openRepaymentForm('a6');
  sb.D.pickBasis(lineOf(sb, 'd1').key);
  ok(calc(sb).includes('<b>₱1,935.00</b> suggested') && calc(sb).includes('capped at the balance, <b>₱1,200.00</b>')
     && calc(sb).includes('Use ₱1,200.00'), calc(sb));
  sb.D.closeModal();
  await sb.D.openRepaymentForm('a7');
  sb.D.pickBasis(lineOf(sb, 'd1').key);
  ok(calc(sb).includes('No suggestion') && !calc(sb).includes('pcaUse') && calc(sb).includes('Suggestion only — nothing is deducted.'), calc(sb));
});
test('C7 a typed payroll amount only feeds the suggestion — never the repayment or a reference', async () => {
  const { sb, api } = await opened();
  await sb.D.openRepaymentForm('a1');
  sb.D.pickBasis('typed');
  eq([el(sb, 'pcaBasisTyped').style.display, el(sb, 'pcaLinkWrap').style.display], ['', 'none']);
  setVal(sb, 'pcaBasisAmt', '6450'); sb.D.renderCalc();
  ok(calc(sb).includes('<b>₱1,935.00</b> suggested'), calc(sb));
  eq(el(sb, 'pcaAmt').value, '');
  setVal(sb, 'pcaAmt', '1000'); setVal(sb, 'pcaPaidOn', '2026-10-09'); setVal(sb, 'pcaRepNotes', '');
  await sb.D.saveRepayment();
  eq(api.calls.find(x => x[0] === 'recordRepayment')[3], { paidOn: '2026-10-09', amount: 1000, notes: null, payrollRef: null });
});
test('C8 a linked payroll line is saved as a snapshot; unticked saves none', async () => {
  const { sb, api } = await opened();
  await sb.D.openRepaymentForm('a1');
  sb.D.pickBasis(lineOf(sb, 'd2').key);
  el(sb, 'pcaLinkRef').checked = true;
  setVal(sb, 'pcaAmt', '500'); setVal(sb, 'pcaPaidOn', '2026-10-09'); setVal(sb, 'pcaRepNotes', 'agreed with Francis');
  await sb.D.saveRepayment();
  eq(api.calls.find(x => x[0] === 'recordRepayment')[3], { paidOn: '2026-10-09', amount: 500, notes: 'agreed with Francis',
     payrollRef: { billId: 'd2', entryIds: ['we_4', 'we_5'], day: '2026-10-08', details: 'Franics Dela Cruz', amount: 3000 } });
  await sb.D.openRepaymentForm('a1');
  sb.D.pickBasis(lineOf(sb, 'd1').key);
  el(sb, 'pcaLinkRef').checked = false;
  setVal(sb, 'pcaAmt', '100'); setVal(sb, 'pcaRepNotes', '');
  await sb.D.saveRepayment();
  eq(api.calls.filter(x => x[0] === 'recordRepayment')[1][3].payrollRef, null);
});
test('C9 browser checks before the server: ≤ ₱0, three decimals, over the balance', async () => {
  const { sb, api } = await opened();
  await sb.D.openRepaymentForm('a1');
  setVal(sb, 'pcaPaidOn', '2026-10-09');
  for (const [v, msg] of [['0', 'Enter an amount above ₱0.'], ['10.005', 'Amounts can have at most two decimal places.'],
                          ['4065.01', "That's more than the remaining balance of ₱4,065.00."]]) {
    setVal(sb, 'pcaAmt', v); await sb.D.saveRepayment(); eq(errText(sb), msg, v);
  }
  eq(api.calls.filter(x => x[0] === 'recordRepayment').length, 0);
});
test('C10 a double-click records once and shows Saving…', async () => {
  const { sb, api } = await opened();
  const real = api.recordRepayment;
  api.recordRepayment = async (...a) => { await new Promise(r => setTimeout(r, 5)); return real(...a); };
  await sb.D.openRepaymentForm('a1');
  setVal(sb, 'pcaAmt', '1000'); setVal(sb, 'pcaPaidOn', '2026-10-09');
  const p1 = sb.D.saveRepayment();
  eq([el(sb, 'pcaSave').disabled, el(sb, 'pcaSave').textContent], [true, 'Saving…']);
  const p2 = sb.D.saveRepayment();
  await Promise.all([p1, p2]);
  eq(api.calls.filter(x => x[0] === 'recordRepayment').length, 1);
});
test('C11 a network failure keeps the op id, so the retry can only record once', async () => {
  const { sb, api } = await opened();
  const real = api.recordRepayment; let first = true;
  api.recordRepayment = async (op, ...rest) => {
    api.calls.push(['attempt', op]);
    if (first) { first = false; throw new Error('Failed to fetch'); }
    return real(op, ...rest);
  };
  await sb.D.openRepaymentForm('a1');
  setVal(sb, 'pcaAmt', '1000'); setVal(sb, 'pcaPaidOn', '2026-10-09');
  await sb.D.saveRepayment();
  ok(errText(sb).startsWith("Couldn't save"), errText(sb));
  eq(el(sb, 'pcaSave').disabled, false, 'button usable again');
  ok(sb.modal() !== '', 'form still open');
  await sb.D.saveRepayment();
  const attempts = api.calls.filter(x => x[0] === 'attempt');
  eq(attempts.length, 2); eq(attempts[0][1], attempts[1][1], 'same op id on the retry');
  eq(sb.modal(), '', 'closed after success');
  eq(sb.reports.length, 1, 'the unknown failure was reported once');
  await sb.D.openRepaymentForm('a1');
  ok(sb.D._state.modal.opId !== attempts[0][1], 'a new form gets a new op id');
});
test('C12 a server refusal reloads first, then explains with the fresh balance', async () => {
  const { sb, api } = await opened();
  api.recordRepayment = async () => {
    api.state.advances[0].repayments.push(rep('rX', 3565));   // someone else repaid meanwhile
    throw new Error('OVER_BALANCE');
  };
  await sb.D.openRepaymentForm('a1');
  setVal(sb, 'pcaAmt', '1000'); setVal(sb, 'pcaPaidOn', '2026-10-09');
  await sb.D.saveRepayment();
  eq(api.calls.filter(c => c[0] === 'list').length, 2, 'reloaded');
  eq(errText(sb), "That's more than the remaining balance of ₱500.00.");
  ok(sb.modal() !== '', 'form stays open');
});
test('C13 payroll that cannot load: typed basis offered, names simply absent', async () => {
  const { sb } = await opened(null, { billsFail: ['P1'] });
  await sb.D.openRepaymentForm('a1');
  eq(el(sb, 'pcaLinesNote').textContent, "Payroll lines couldn't load — type an amount instead.");
  eq([sb.D._state.modal.basis, el(sb, 'pcaBasisTyped').style.display], ['typed', '']);
  ok(el(sb, 'pcaBasis').innerHTML.includes('Type an amount'));
  sb.D.closeModal();
  sb.D.openAdvanceForm();
  eq(await sb.D.pickProject('P1'), []);
  eq(el(sb, 'pcaWorkerNames').innerHTML, '');
});
test('C14 voids: reason required; an advance with live repayments cannot open the void', async () => {
  const { sb, api } = await opened();
  sb.D.openVoid('advance', 'a1');
  eq(sb.modal(), '', 'blocked while r1 is live');
  sb.D.openVoid('repayment', 'r1');
  ok(sb.modal().includes('Void repayment') && sb.modal().includes('stays in the history'), sb.modal());
  setVal(sb, 'pcaVoidReason', '   '); await sb.D.saveVoid(); eq(errText(sb), 'Give a reason for voiding.');
  setVal(sb, 'pcaVoidReason', 'Entered twice'); await sb.D.saveVoid();
  const c = api.calls.find(x => x[0] === 'voidRepayment');
  eq([c[2], c[3]], ['r1', 'Entered twice']);
  sb.D.open('a1');
  ok(sb.root().includes('Entered twice') && !sb.root().includes('pca-btn--danger" disabled'), 'balance restored, void advance enabled');
  sb.D.openVoid('advance', 'a1');
  setVal(sb, 'pcaVoidReason', 'Wrong worker'); await sb.D.saveVoid();
  eq(api.calls.find(x => x[0] === 'voidAdvance').slice(2), ['a1', 'Wrong worker']);
});
test('C15 without pm-admin.js name helpers: exact matching, reported once', async () => {
  const sb = loadCA('owner');
  sb.ctx._pmNamesSimilar = undefined; sb.ctx._pmLaborNameGroups = undefined;
  sb.D._setApi(writeApi(ADVANCES())); await sb.D.init();
  await sb.D.openRepaymentForm('a1');
  const sel = el(sb, 'pcaBasis').innerHTML;
  ok(sel.includes('Oct 7, 2026') && !sel.includes('Oct 8, 2026'), 'exact spelling only: ' + sel);
  sb.D.closeModal();
  sb.D.openAdvanceForm();
  const names = await sb.D.pickProject('P1');
  eq(names, ['Danilo Reyes', 'Francis Dela Cruz', 'Franics Dela Cruz']);
  eq(sb.reports.length, 1);
});
test('C16 the forms file never writes to the database or names the server functions', () => {
  const src = read('js/cash-advance-forms.js');
  ok(!/\.(set|update|add|delete)\(/.test(src), 'found a write call');
  ok(!/pm_ca_|pm_cash_advance/.test(src), 'must go through window.CashAdvance.server');
});
```

- [ ] **Step 2: Run to confirm section C fails**

Run: `node tests/cash-advance.test.js`
Expected: every test fails at load with `ENOENT … js/cash-advance-forms.js` (the sandbox now loads it).

- [ ] **Step 3: Write `js/cash-advance-forms.js`**

```js
/* ══════════════════════════════════════════════════════════
   PM → CASH ADVANCES — pop-up forms (merged into window.CashAdvanceAdmin)
   Spec: docs/superpowers/specs/2026-10-19-worker-cash-advances-design.md §6.3–6.5

   New / edit advance, record repayment (with the suggestion calculator) and
   the two voids. Every form holds ONE operation id from opening until a
   success or close; a retry re-sends it, so the server records once (R16).
   The browser checks mirror the server's; the server's locked check is final.

   The suggestion is a label: the "Payroll basis" (a picked Labor line or a
   typed figure) only feeds the calculator. The actual repayment starts empty
   and changes only when the owner types it or presses "Use ₱…".
   ══════════════════════════════════════════════════════════ */
(function () {
    'use strict';
    const A = () => window.CashAdvanceAdmin;
    const CA = () => window.CashAdvance;
    const S = () => A()._state;
    const H = () => A()._h;
    const $ = (id) => document.getElementById(id);
    const val = (id) => { const e = $(id); return e ? String(e.value == null ? '' : e.value) : ''; };
    const isDay = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s);
    const NOTE = '<p class="pca-calc-note">Suggestion only — nothing is deducted.</p>';

    function show(html) {
        const h = $('pmCashAdvancesModal');
        if (h) h.innerHTML = '<div class="pca-overlay" role="dialog" aria-modal="true"><div class="pca-modal">' + html + '</div></div>';
    }
    function closeModal() {
        const m = S().modal;
        if (m && m.saving) return;            // never abandon a save in flight
        S().modal = null;
        const h = $('pmCashAdvancesModal');
        if (h) h.innerHTML = '';
    }
    function setError(msg) { const e = $('pcaFormError'); if (e) e.textContent = msg || ''; }
    function setSaving(m, on) {
        const b = $('pcaSave');
        if (!b) return;
        b.disabled = !!on;
        b.textContent = on ? 'Saving…' : m.label;
    }
    function buttons(onSave, label, danger) {
        return '<div class="pca-modal-actions"><button type="button" class="pca-btn" onclick="CashAdvanceAdmin.closeModal()">Cancel</button>'
            + '<button type="button" id="pcaSave" class="pca-btn ' + (danger ? 'pca-btn--danger' : 'pca-btn--primary') + '" onclick="'
            + onSave + '">' + H().esc(label) + '</button></div>';
    }
    function toast(msg) { if (typeof window._pmToast === 'function') window._pmToast(msg); }

    // One submit path for every form: guards the double-click, keeps the op
    // id on failure, reloads when the screen was stale, reports the unknown.
    async function submit(m, call, onDone) {
        m.saving = true;
        setSaving(m, true);
        setError('');
        try {
            const res = await call();
            m.saving = false;
            if (S().modal === m) closeModal();
            onDone(res || {});
            A().render();
            toast('Saved.');
        } catch (e) {
            m.saving = false;
            const msg = e && e.message;
            const code = CA().errorCode(msg);
            if (CA().RELOAD_CODES.includes(code)) await A().load();
            const advId = m.advanceId || m.id;
            const fresh = advId ? S().advances.find(a => a.id === advId) : null;
            const t = CA().errorText(msg, fresh ? CA().totals(fresh) : null);
            if (!t.known) H().report(t.text, e && e.stack);
            if (S().modal === m) {
                setSaving(m, false);
                setError(t.known ? t.text : "Couldn't save — check the connection and try again. (" + t.text + ')');
            }
        }
    }

    // ── new / edit advance ───────────────────────────────────────────
    function openAdvanceForm(id) {
        const adv = id ? S().advances.find(a => a.id === id) : null;
        if (id && (!adv || adv.voided_at)) return;
        const esc = H().esc, field = H().field;
        S().modal = { kind: 'advance', id: adv ? adv.id : null, opId: CA().newOpId(), saving: false,
                      label: adv ? 'Save changes' : 'Save advance', projectId: '' };
        const t = adv ? CA().totals(adv) : null;
        const cur = adv ? adv.project_id : '';
        const projects = CA().projectOptions(S().projects, adv ? [adv] : []);
        show('<h3 class="pca-modal-title">' + (adv ? 'Edit advance' : 'New cash advance') + '</h3>'
            + field('Project', '<select id="pcaProject" class="pca-input" onchange="CashAdvanceAdmin.pickProject(this.value)">'
                + (adv ? '' : '<option value="">Choose a project</option>')
                + projects.map(o => '<option value="' + esc(o.id) + '"' + (o.id === cur ? ' selected' : '') + '>' + esc(o.label) + '</option>').join('')
                + '</select>')
            + field('Worker name', '<input id="pcaWorker" class="pca-input" list="pcaWorkerNames" autocomplete="off" value="'
                + esc(adv ? adv.worker_name : '') + '"><datalist id="pcaWorkerNames"></datalist><span id="pcaNamesNote" class="pca-muted"></span>')
            + field('Date issued', '<input id="pcaIssued" type="date" class="pca-input" value="' + esc(adv ? adv.issued_on : CA().dateKey()) + '">')
            + field('Amount advanced (₱)', '<input id="pcaAmount" class="pca-input" inputmode="decimal" value="'
                + esc(adv ? (CA().toCents(adv.amount) / 100).toFixed(2) : '') + '">'
                + (t && t.repaidCents > 0 ? '<span class="pca-muted">Can\'t go below ' + H().money(t.repaidCents) + ' already repaid.</span>' : ''))
            + field('Suggested repayment %', '<input id="pcaPct" class="pca-input" inputmode="decimal" value="'
                + esc(adv ? CA().fmtPct(adv.suggest_pct) : String(CA().DEFAULT_PCT)) + '">'
                + '<span class="pca-muted">Of each payroll — a suggestion only, nothing is deducted.</span>')
            + field('Notes / agreement', '<textarea id="pcaNotes" class="pca-input" rows="3">' + esc(adv ? adv.notes || '' : '') + '</textarea>')
            + '<p id="pcaFormError" class="pca-error" role="alert"></p>'
            + buttons('CashAdvanceAdmin.saveAdvance()', S().modal.label));
        if (cur) pickProject(cur);
    }

    // Name suggestions come from THAT project's Labor lines (spec §6.3).
    async function pickProject(projectId) {
        const m = S().modal;
        if (!m || m.kind !== 'advance') return [];
        m.projectId = projectId || '';
        const dl = $('pcaWorkerNames'), note = $('pcaNamesNote');
        if (dl) dl.innerHTML = '';
        if (!projectId) return [];
        if (note) note.textContent = 'Loading names…';
        const res = await H().loadBills(projectId);
        if (S().modal !== m || m.projectId !== projectId) return [];
        if (note) note.textContent = '';
        if (res.error) return [];          // suggestions simply don't appear
        const names = CA().nameSuggestions(res.bills, H().grouper());
        if (dl) dl.innerHTML = names.map(n => '<option value="' + H().esc(n) + '"></option>').join('');
        return names;
    }

    async function saveAdvance() {
        const m = S().modal;
        if (!m || m.kind !== 'advance' || m.saving) return;
        const adv = m.id ? S().advances.find(a => a.id === m.id) : null;
        const projectId = val('pcaProject'), worker = val('pcaWorker').trim(), issuedOn = val('pcaIssued');
        const amt = CA().parseAmount(val('pcaAmount')), pct = CA().parsePct(val('pcaPct'));
        let msg = '';
        if (!projectId) msg = 'Choose a project.';
        else if (!worker) msg = "Enter the worker's name.";
        else if (!isDay(issuedOn)) msg = 'Pick a date.';
        else if (!amt.ok) msg = amt.error;
        else if (!pct.ok) msg = pct.error;
        else if (adv && amt.cents < CA().totals(adv).repaidCents) {
            msg = "The amount can't be lower than the " + H().money(CA().totals(adv).repaidCents) + ' already repaid.';
        }
        if (msg) { setError(msg); return; }
        const f = { projectId, worker, issuedOn, amount: amt.value, pct: pct.value, notes: val('pcaNotes').trim() || null };
        await submit(m, () => (m.id ? H().server().editAdvance(m.opId, m.id, f) : H().server().recordAdvance(m.opId, f)),
                     (res) => A()._upsert(res.advance));
    }

    // ── record repayment ─────────────────────────────────────────────
    async function openRepaymentForm(advanceId) {
        const adv = S().advances.find(a => a.id === advanceId);
        if (!adv || adv.voided_at) return;
        const t = CA().totals(adv);
        if (t.balanceCents <= 0) return;
        const esc = H().esc, field = H().field, money = H().money;
        const m = S().modal = { kind: 'repay', advanceId, opId: CA().newOpId(), saving: false, label: 'Save repayment',
                                lines: [], linesError: false, basis: '', suggest: null };
        show('<h3 class="pca-modal-title">Record repayment</h3>'
            + '<p class="pca-sub">' + esc(adv.worker_name) + ' · Balance <b>' + money(t.balanceCents) + '</b></p>'
            + '<section class="pca-calc" aria-label="Suggested repayment">'
            +   '<h4 class="pca-calc-title">Suggested repayment (' + esc(CA().fmtPct(adv.suggest_pct)) + '% of payroll)</h4>'
            +   field('Payroll basis', '<select id="pcaBasis" class="pca-input" onchange="CashAdvanceAdmin.pickBasis(this.value)">'
                  + '<option value="">Loading payroll lines…</option></select>')
            +   '<div id="pcaBasisTyped" style="display:none">'
            +     field('Payroll amount (₱) — for the suggestion only', '<input id="pcaBasisAmt" class="pca-input" inputmode="decimal" oninput="CashAdvanceAdmin.renderCalc()">')
            +   '</div>'
            +   '<p id="pcaLinesNote" class="pca-muted"></p>'
            +   '<div id="pcaCalc" class="pca-calc-result"></div>'
            + '</section>'
            + field('Payment date', '<input id="pcaPaidOn" type="date" class="pca-input" value="' + esc(CA().dateKey()) + '">')
            + field('Actual repayment (₱)', '<input id="pcaAmt" class="pca-input" inputmode="decimal" value="">')
            + '<label class="pca-check" id="pcaLinkWrap" style="display:none"><input type="checkbox" id="pcaLinkRef" checked> Link this payroll line to the repayment</label>'
            + field('Notes', '<textarea id="pcaRepNotes" class="pca-input" rows="2"></textarea>')
            + '<p id="pcaFormError" class="pca-error" role="alert"></p>'
            + buttons('CashAdvanceAdmin.saveRepayment()', m.label));
        renderCalc();
        const res = await H().loadBills(adv.project_id);
        if (S().modal !== m) return;
        m.linesError = !!res.error;
        m.lines = res.error ? [] : CA().laborLines(res.bills, adv.worker_name, H().similar());
        const sel = $('pcaBasis');
        if (sel) {
            sel.innerHTML = (m.lines.length ? '<option value="">Choose a payroll line</option>' : '<option value="">No payroll lines for this worker</option>')
                + m.lines.map(l => '<option value="' + esc(l.key) + '">' + esc(H().fmtDay(l.day) + ' · ' + l.details + ' · ' + money(l.cents)) + '</option>').join('')
                + '<option value="typed">Type an amount</option>';
        }
        const note = $('pcaLinesNote');
        if (note) note.textContent = m.linesError ? "Payroll lines couldn't load — type an amount instead." : '';
        if (m.linesError) {
            if (sel) sel.value = 'typed';
            pickBasis('typed');
        }
    }

    const currentLine = (m) => (m.lines || []).find(l => l.key === m.basis) || null;
    function basisCents(m) {
        if (m.basis === 'typed') { const p = CA().parseAmount(val('pcaBasisAmt')); return p.ok ? p.cents : 0; }
        const l = currentLine(m);
        return l ? l.cents : 0;
    }
    function pickBasis(value) {
        const m = S().modal;
        if (!m || m.kind !== 'repay') return;
        m.basis = value || '';
        const typed = $('pcaBasisTyped'); if (typed) typed.style.display = m.basis === 'typed' ? '' : 'none';
        const link = $('pcaLinkWrap'); if (link) link.style.display = currentLine(m) ? '' : 'none';
        renderCalc();
    }
    function renderCalc() {
        const m = S().modal;
        if (!m || m.kind !== 'repay') return;
        const adv = S().advances.find(a => a.id === m.advanceId);
        const el = $('pcaCalc');
        if (!adv || !el) return;
        const money = H().money;
        const pct = Number(adv.suggest_pct) || 0;
        const b = basisCents(m);
        m.suggest = null;
        if (pct <= 0) { el.innerHTML = '<p class="pca-calc-line">No suggestion</p>' + NOTE; return; }
        if (b <= 0) { el.innerHTML = '<p class="pca-muted">Pick a payroll line or type an amount to see the suggestion.</p>' + NOTE; return; }
        const s = CA().suggestion(b, pct, CA().totals(adv).balanceCents);
        if (s.none) { el.innerHTML = '<p class="pca-calc-line">No suggestion</p>' + NOTE; return; }
        m.suggest = s.capped;
        el.innerHTML = '<p class="pca-calc-line">' + money(b) + ' × ' + H().esc(CA().fmtPct(pct)) + '% = <b>' + money(s.raw) + '</b> suggested</p>'
            + (s.isCapped ? '<p class="pca-calc-line">capped at the balance, <b>' + money(s.capped) + '</b></p>' : '')
            + '<button type="button" class="pca-btn" id="pcaUse" onclick="CashAdvanceAdmin.useSuggestion()">Use ' + money(s.capped) + '</button>'
            + NOTE;
    }
    function useSuggestion() {
        const m = S().modal;
        if (!m || m.kind !== 'repay' || m.suggest == null) return;
        const e = $('pcaAmt');
        if (e) e.value = (m.suggest / 100).toFixed(2);
    }
    async function saveRepayment() {
        const m = S().modal;
        if (!m || m.kind !== 'repay' || m.saving) return;
        const adv = S().advances.find(a => a.id === m.advanceId);
        if (!adv) return;
        const t = CA().totals(adv);
        const paidOn = val('pcaPaidOn');
        const amt = CA().parseAmount(val('pcaAmt'));
        let msg = '';
        if (!isDay(paidOn)) msg = 'Pick a date.';
        else if (!amt.ok) msg = amt.error;
        else if (amt.cents > t.balanceCents) msg = "That's more than the remaining balance of " + H().money(t.balanceCents) + '.';
        if (msg) { setError(msg); return; }
        const line = currentLine(m);
        const link = $('pcaLinkRef');
        const f = { paidOn, amount: amt.value, notes: val('pcaRepNotes').trim() || null,
                    payrollRef: line && link && link.checked ? CA().payrollRef(line) : null };
        await submit(m, () => H().server().recordRepayment(m.opId, m.advanceId, f), (res) => A()._upsert(res.advance));
    }

    // ── voids ────────────────────────────────────────────────────────
    function openVoid(what, id) {
        let adv = null, rep = null;
        if (what === 'repayment') {
            adv = S().advances.find(a => (a.repayments || []).some(r => r.id === id));
            rep = adv ? adv.repayments.find(r => r.id === id) : null;
            if (!rep || rep.voided_at || adv.voided_at) return;
        } else {
            adv = S().advances.find(a => a.id === id);
            if (!adv || adv.voided_at || (adv.repayments || []).some(r => !r.voided_at)) return;   // R11
        }
        const esc = H().esc, money = H().money;
        const label = what === 'repayment' ? 'Void repayment' : 'Void advance';
        S().modal = { kind: 'void', what, id, advanceId: adv.id, opId: CA().newOpId(), saving: false, label };
        show('<h3 class="pca-modal-title">' + label + '</h3>'
            + '<p class="pca-sub">' + (what === 'repayment'
                ? 'The ' + money(CA().toCents(rep.amount)) + ' repayment of ' + esc(H().fmtDay(rep.paid_on))
                  + ' stops counting and the balance goes back up by that amount. It stays in the history.'
                : 'This advance of ' + money(CA().toCents(adv.amount)) + ' to ' + esc(adv.worker_name)
                  + ' stops counting in every total. It stays in the history.') + '</p>'
            + H().field('Reason', '<textarea id="pcaVoidReason" class="pca-input" rows="2"></textarea>')
            + '<p id="pcaFormError" class="pca-error" role="alert"></p>'
            + buttons('CashAdvanceAdmin.saveVoid()', label, true));
    }
    async function saveVoid() {
        const m = S().modal;
        if (!m || m.kind !== 'void' || m.saving) return;
        const reason = val('pcaVoidReason').trim();
        if (!reason) { setError('Give a reason for voiding.'); return; }
        await submit(m, () => (m.what === 'repayment' ? H().server().voidRepayment(m.opId, m.id, reason)
                                                      : H().server().voidAdvance(m.opId, m.id, reason)),
                     (res) => A()._upsert(res.advance));
    }

    if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
        document.addEventListener('keydown', (e) => {
            if (e && e.key === 'Escape' && window.CashAdvanceAdmin && S().modal) closeModal();
        });
    }

    Object.assign(window.CashAdvanceAdmin, { openAdvanceForm, pickProject, saveAdvance, openRepaymentForm, pickBasis,
                                             renderCalc, useSuggestion, saveRepayment, openVoid, saveVoid, closeModal });
})();
```

- [ ] **Step 4: Run to confirm it passes**

Run: `node --check js/cash-advance-forms.js && node tests/cash-advance.test.js`
Expected: `38 passed, 0 failed`.

- [ ] **Step 5: Checkpoint (no commit)**

Changed: `js/cash-advance-forms.js`, `tests/cash-advance.test.js`.

---

### Task 6: Wiring — nav, owner-only gates, view container, scripts, styles; isolation fences

**Files:**
- Modify: `js/admin.js` (four exact-string edits)
- Modify: `admin.html` (seven exact-string edits)
- Modify: `css/pm-admin.css` (append one block)
- Modify: `tests/cash-advance.test.js` (section D above `// ── runner`)

**Interfaces:**
- Consumes: `window.initCashAdvances` (Task 4), the `pca-*` class names used in Tasks 4–5.
- Produces: the `pmCashAdvances` view, reachable only by `currentUserRole === 'owner'`.

- [ ] **Step 1: Write the failing wiring + isolation tests (section D)**

Insert above `// ── runner ──…` in `tests/cash-advance.test.js`:

```js
// ══ D. Wiring and isolation ═══════════════════════════════════════════
test('D1 nav: PM entry, owner-only filter, staff sidebar hide, view title', () => {
  const adm = read('js/admin.js');
  const pmBlock = adm.slice(adm.indexOf("{ id: 'pm', label: 'Project Management'"), adm.indexOf("{ id: 'attendance'"));
  ok(/\{ view: 'pmCashAdvances',\s+label: 'Cash Advances',\s+icon: 'wallet' \}/.test(pmBlock), 'PRIMARY_NAV pm entry');
  ok(adm.includes("if (p.id === 'pm' && role !== 'owner') {") && adm.includes("m.view !== 'pmCashAdvances'"), '_visibleNav owner-only filter');
  ok(adm.includes("'warrantyFund', 'pmSharing', 'pmCashAdvances', 'quoteList', 'attAppUpdates'].forEach"), 'staff sidebar hide list');
  ok(adm.includes("pmCashAdvances:   'Cash Advances',"), 'admin.js view title');
});
test('D2 admin.html: sidebar item, container, title, owner-only bounce, init hook, scripts after pm-admin.js', () => {
  const html = read('admin.html');
  ok(html.includes('data-view="pmCashAdvances"'), 'sidebar item');
  ok(html.includes('id="pmCashAdvancesView"') && html.includes('id="pmCashAdvancesRoot"') && html.includes('id="pmCashAdvancesModal"'), 'container');
  ok(html.includes("pmCashAdvances:   'Cash Advances',"), 'title');
  ok(html.includes("if (view === 'pmCashAdvances' && currentUserRole !== 'owner') view = 'pmProjects';"), 'owner-only bounce');
  ok(html.includes("if (view === 'pmCashAdvances' && typeof initCashAdvances === 'function') initCashAdvances();"), 'init hook');
  const at = (s) => html.indexOf(s);
  ok(at('src="js/pm-admin.js') > 0 && at('src="js/cash-advance.js') > at('src="js/pm-admin.js'), 'logic after pm-admin.js (name helpers)');
  ok(at('src="js/cash-advance-admin.js') > at('src="js/cash-advance.js') && at('src="js/cash-advance-forms.js') > at('src="js/cash-advance-admin.js'), 'script order');
  ok(!/PM_VIEWS\s*=\s*\[[^\]]*pmCashAdvances/.test(html), 'not in PM_VIEWS (that starts the projects grid)');
});
test('D3 never on the client or partner portals', () => {
  for (const f of ['Client Management.html', 'Dacs Partnership.html'])
    ok(!/cash-advance|pmCashAdvances/.test(read(f)), f);
});
test('D4 isolation: no money, payroll, report, sharing or warranty file mentions cash advances', () => {
  const bad = /pm_ca_|pm_cash_advance|CashAdvance|cashAdvance|cash_advance|pmCashAdvances|cash-advance/;
  for (const f of ['js/portal-app.compiled.js', 'js/expenses-module.js', 'js/overhead-module.js', 'js/billing-allocation.js',
                   'js/pm-admin.js', 'js/pm-sharing.js', 'js/pm-sharing-dashboard.js', 'js/pm-report-print.js', 'js/warranty-fund.js',
                   'js/termination-requests.js', 'js/invoice-module.js', 'js/labor-invoice-module.js', 'js/print-utils.js',
                   'js/reimbursement-module.js', 'js/payment-requests.js'])
    ok(!bad.test(read(f)), f + ' mentions cash advances');
});
test('D5 only js/cash-advance.js names the server functions or tables', () => {
  const dir = path.join(ROOT, 'js');
  for (const f of fs.readdirSync(dir).filter(n => n.endsWith('.js') && n !== 'cash-advance.js'))
    ok(!/pm_ca_|pm_cash_advance/.test(read('js/' + f)), 'js/' + f);
  ok(read('js/cash-advance.js').includes("rpc('pm_ca_record_repayment'"), 'the wrappers live in cash-advance.js');
});
test('D6 the migration never writes or reads payroll, expenses or project rows', () => {
  const body = read('supabase/migrations/0100_pm_cash_advances.sql').replace(/--[^\n]*/g, '');
  ok(!/\b(insert\s+into|update|delete\s+from)\s+(weekly_bills|payroll|expenses|overhead_expenses|construction_projects|payment_requests|invoices|folders|labor_contracts|pm_labor_contracts|pm_project_companies)\b/i.test(body),
     'writes a money / project table');
  ok(!/\bweekly_bills\b/i.test(body), 'reads payroll');
});
```

- [ ] **Step 2: Run to confirm section D fails**

Run: `node tests/cash-advance.test.js`
Expected: D1 and D2 FAIL (no wiring yet). D3–D6 already pass, because the earlier tasks respected the fences.

- [ ] **Step 3: Edit `js/admin.js` (four exact-string replacements)**

(a) PRIMARY_NAV. Replace:

```js
        { view: 'pmSharing',           label: 'Profit Sharing',       icon: 'pie-chart' },
```

with:

```js
        { view: 'pmSharing',           label: 'Profit Sharing',       icon: 'pie-chart' },
        // Worker Cash Advances (0100) — money advanced to workers and what they
        // paid back. Tracking ledger outside the money model. Owner-role only.
        { view: 'pmCashAdvances',      label: 'Cash Advances',        icon: 'wallet' },
```

(b) `_visibleNav()`: put the owner-only filter **first** in the `.map`, so it applies before the staff branch returns. Replace:

```js
        .map(p => {
            if (role === 'staff' && p.id === 'expenses') {
```

with:

```js
        .map(p => {
            if (p.id === 'pm' && role !== 'owner') {
                // Cash Advances (0100) is worker money end to end — owner-role
                // accounts only. The server (pm_owner_company) refuses the rest.
                p = { ...p, modules: p.modules.filter(m => m.view !== 'pmCashAdvances') };
            }
            if (role === 'staff' && p.id === 'expenses') {
```

(c) Staff sidebar hide list. Replace:

```js
        ['userNavigator', 'clientAccounts', 'expReports', 'reimbursements', 'warrantyFund', 'pmSharing', 'quoteList', 'attAppUpdates'].forEach(view => {
```

with:

```js
        ['userNavigator', 'clientAccounts', 'expReports', 'reimbursements', 'warrantyFund', 'pmSharing', 'pmCashAdvances', 'quoteList', 'attAppUpdates'].forEach(view => {
```

(d) View title (the `admin.js` copy of the titles map). Replace:

```js
        pmSharing:        'Profit Sharing',
        boqBuilder:       'Accomplishment Report',
```

with:

```js
        pmSharing:        'Profit Sharing',
        pmCashAdvances:   'Cash Advances',
        boqBuilder:       'Accomplishment Report',
```

- [ ] **Step 4: Edit `admin.html` (seven exact-string replacements)**

(a) Sidebar item. Replace:

```html
                    <a href="#" class="nav-item nav-child" data-view="pmSharing">
                        <span class="nav-icon-wrap"><i data-lucide="pie-chart" class="nav-icon"></i></span><span>Profit Sharing</span>
                    </a>
```

with:

```html
                    <a href="#" class="nav-item nav-child" data-view="pmSharing">
                        <span class="nav-icon-wrap"><i data-lucide="pie-chart" class="nav-icon"></i></span><span>Profit Sharing</span>
                    </a>
                    <a href="#" class="nav-item nav-child" data-view="pmCashAdvances">
                        <span class="nav-icon-wrap"><i data-lucide="wallet" class="nav-icon"></i></span><span>Cash Advances</span>
                    </a>
```

(b) View container. Replace:

```html
        <div id="pmSharingView" class="content-view" style="display:none;">
            <div id="pmSharingRoot"></div>
        </div>
```

with:

```html
        <div id="pmSharingView" class="content-view" style="display:none;">
            <div id="pmSharingRoot"></div>
        </div>

        <!-- PM → Cash Advances (0100). Owner-role only; js/cash-advance-admin.js renders
             the list / one advance into the root, js/cash-advance-forms.js the pop-ups. -->
        <div id="pmCashAdvancesView" class="content-view" style="display:none;">
            <div id="pmCashAdvancesRoot"></div>
            <div id="pmCashAdvancesModal"></div>
        </div>
```

(c) Title (the `admin.html` titles map — this one is followed by `consBatch`). Replace:

```js
        pmSharing:        'Profit Sharing',
        consBatch:        'Current Batch',
```

with:

```js
        pmSharing:        'Profit Sharing',
        pmCashAdvances:   'Cash Advances',
        consBatch:        'Current Batch',
```

(d) Owner-only bounce, inside the role guard after the worker branch. Replace:

```js
            } else if (currentUserRole === 'worker' || currentUserRole === 'teamLeader') {
                const allowed = ['consBatch','consUrgent','consBatchHistory'];
                if (!allowed.includes(view)) view = 'consBatch';
            }
```

with:

```js
            } else if (currentUserRole === 'worker' || currentUserRole === 'teamLeader') {
                const allowed = ['consBatch','consUrgent','consBatchHistory'];
                if (!allowed.includes(view)) view = 'consBatch';
            }
            // Cash Advances (0100) is owner-role only — staff and everyone else
            // bounce to the projects grid. The server refuses them too.
            if (view === 'pmCashAdvances' && currentUserRole !== 'owner') view = 'pmProjects';
```

(e) Init hook. Replace:

```js
        if (view === 'pmSharing' && typeof initPMSharingDashboard === 'function') initPMSharingDashboard();
```

with:

```js
        if (view === 'pmSharing' && typeof initPMSharingDashboard === 'function') initPMSharingDashboard();
        if (view === 'pmCashAdvances' && typeof initCashAdvances === 'function') initCashAdvances();
```

(f) Scripts, after the Profit Sharing dashboard (and so after `pm-admin.js`). Replace:

```html
<script src="js/pm-sharing-dashboard.js?v=20261019f"></script>
```

with:

```html
<script src="js/pm-sharing-dashboard.js?v=20261019f"></script>
<!-- Worker Cash Advances (0100). After pm-admin.js: the screen borrows its
     _pmNamesSimilar / _pmLaborNameGroups name helpers. -->
<script src="js/cash-advance.js?v=20261020a"></script>
<script src="js/cash-advance-admin.js?v=20261020a"></script>
<script src="js/cash-advance-forms.js?v=20261020a"></script>
```

If the `pm-sharing-dashboard.js` version stamp has changed since this plan was written, keep whatever stamp is there. Only the three new lines matter.

(g) Stylesheet cache-buster. Replace `css/pm-admin.css?v=20261019b` with `css/pm-admin.css?v=20261020a`. If the stamp differs, bump whatever is there.

- [ ] **Step 5: Append the styles to `css/pm-admin.css`**

Append at the end of the file:

```css
/* ── PM → Cash Advances (0100) — js/cash-advance-admin.js / cash-advance-forms.js ── */
.pca{display:flex;flex-direction:column;gap:18px;max-width:1180px;}
.pca-head{display:flex;flex-wrap:wrap;align-items:flex-start;justify-content:space-between;gap:12px;}
.pca-title{margin:0;font:600 22px Barlow,sans-serif;color:var(--pm-ink);}
.pca-sub{margin:4px 0 0;font:400 13.5px 'IBM Plex Sans',sans-serif;color:#6b6a65;}
.pca-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:38px;padding:8px 14px;border:1px solid var(--pm-border);border-radius:10px;background:#fff;font:600 13.5px Barlow,sans-serif;color:#3a3a3c;cursor:pointer;}
.pca-btn:hover{border-color:var(--pm-green);color:var(--pm-green);}
.pca-btn:disabled{opacity:.5;cursor:not-allowed;}
.pca-btn--primary{background:var(--pm-green);border-color:var(--pm-green);color:#fff;}
.pca-btn--primary:hover{background:var(--pm-green-hover);color:#fff;}
.pca-btn--danger{color:#b4453a;}
.pca-btn:focus-visible,.pca-chip:focus-visible,.pca-link:focus-visible,.pca-back:focus-visible,.pca-row:focus-visible{outline:2px solid var(--pm-green);outline-offset:2px;}
.pca-filters{display:flex;flex-wrap:wrap;align-items:center;gap:10px;}
.pca-input{min-height:38px;padding:8px 10px;border:1px solid var(--pm-border);border-radius:10px;font:400 14px 'IBM Plex Sans',sans-serif;background:#fff;color:var(--pm-ink);box-sizing:border-box;max-width:100%;}
textarea.pca-input{width:100%;resize:vertical;}
.pca-chips{display:flex;flex-wrap:wrap;gap:6px;}
.pca-chip{padding:6px 12px;border:1px solid var(--pm-border);border-radius:999px;background:#fff;font:600 12.5px Barlow,sans-serif;color:#3a3a3c;cursor:pointer;}
.pca-chip.is-on{background:var(--pm-tint);border-color:var(--pm-green);color:var(--pm-green);}
.pca-check{display:inline-flex;align-items:center;gap:6px;font:400 13.5px 'IBM Plex Sans',sans-serif;color:#3a3a3c;}
.pca-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;}
.pca-card,.pca-stat{display:flex;flex-direction:column;gap:4px;padding:14px 16px;border:1px solid var(--pm-border);border-radius:12px;background:#fff;}
.pca-card-label{font:600 11.5px Barlow,sans-serif;letter-spacing:.04em;text-transform:uppercase;color:#7a7972;}
.pca-card-value,.pca-stat-value{font:600 20px Barlow,sans-serif;color:var(--pm-ink);font-variant-numeric:tabular-nums;}
.pca-table-wrap{overflow-x:auto;border:1px solid var(--pm-border);border-radius:12px;background:#fff;}
.pca-table{width:100%;border-collapse:collapse;font:400 13.5px 'IBM Plex Sans',sans-serif;}
.pca-table th{padding:10px 12px;text-align:left;font:600 11.5px Barlow,sans-serif;letter-spacing:.04em;text-transform:uppercase;color:#7a7972;border-bottom:1px solid var(--pm-border);white-space:nowrap;}
.pca-table td{padding:11px 12px;border-bottom:1px solid var(--pm-line);color:var(--pm-ink);}
.pca-table .num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap;}
.pca-row{cursor:pointer;}
.pca-row:hover{background:var(--pm-tint-soft);}
.pca-row.is-void td{color:#9b9a94;text-decoration:line-through;}
.pca-badge{display:inline-block;padding:3px 9px;border-radius:999px;font:600 12px Barlow,sans-serif;white-space:nowrap;}
.pca-badge--unpaid{background:#fbeeea;color:#9a3b2f;}
.pca-badge--partial{background:#fdf3dc;color:#8a5a00;}
.pca-badge--paid{background:var(--pm-tint);color:var(--pm-green);}
.pca-badge--voided{background:#efeeea;color:#6b6a65;}
.pca-muted{color:#7a7972;font-size:12.5px;}
.pca-empty{margin:0;padding:28px;text-align:center;color:#7a7972;border:1px dashed var(--pm-border);border-radius:12px;}
.pca-alert{padding:12px 14px;border-radius:10px;background:#fbeeea;color:#7d2f25;font:400 13.5px 'IBM Plex Sans',sans-serif;}
.pca-back{align-self:flex-start;border:0;background:none;padding:4px 0;font:600 13.5px Barlow,sans-serif;color:var(--pm-green);cursor:pointer;}
.pca-actions{display:flex;flex-wrap:wrap;align-items:center;gap:10px;}
.pca-notes{margin:0;font:400 13.5px 'IBM Plex Sans',sans-serif;color:#3a3a3c;}
.pca-h3{margin:6px 0 0;font:600 15px Barlow,sans-serif;color:var(--pm-ink);}
.pca-history{margin:0;padding:0 0 0 18px;display:flex;flex-direction:column;gap:10px;font:400 13.5px 'IBM Plex Sans',sans-serif;color:var(--pm-ink);}
.pca-history li.is-void > b{text-decoration:line-through;color:#9b9a94;}
.pca-ref{margin-top:3px;color:#5d5c57;font-size:12.5px;}
.pca-void-note{margin-top:3px;color:#9a3b2f;font-size:12.5px;}
.pca-link{border:0;background:none;padding:0 4px;font:600 12.5px Barlow,sans-serif;color:#b4453a;cursor:pointer;text-decoration:underline;}
.pca-overlay{position:fixed;inset:0;z-index:1000;display:flex;align-items:flex-start;justify-content:center;padding:6vh 16px;background:rgba(28,28,26,.45);overflow-y:auto;}
.pca-modal{width:100%;max-width:520px;padding:22px;border-radius:14px;background:#fff;box-shadow:0 18px 50px rgba(0,0,0,.18);display:flex;flex-direction:column;gap:12px;box-sizing:border-box;}
.pca-modal-title{margin:0;font:600 18px Barlow,sans-serif;color:var(--pm-ink);}
.pca-field{display:flex;flex-direction:column;gap:5px;}
.pca-field .pca-input{width:100%;}
.pca-label{font:600 12.5px Barlow,sans-serif;color:#3a3a3c;}
.pca-calc{padding:12px 14px;border:1px dashed var(--pm-border-2);border-radius:12px;background:var(--pm-tint-soft);display:flex;flex-direction:column;gap:8px;}
.pca-calc-title{margin:0;font:600 13px Barlow,sans-serif;color:var(--pm-green);}
.pca-calc-line{margin:0;font:400 14px 'IBM Plex Sans',sans-serif;font-variant-numeric:tabular-nums;}
.pca-calc-note{margin:0;font-size:12px;color:#7a7972;}
.pca-error{margin:0;min-height:1em;color:#b4453a;font:500 13px 'IBM Plex Sans',sans-serif;}
.pca-modal-actions{display:flex;justify-content:flex-end;gap:10px;flex-wrap:wrap;}
@media (max-width:600px){.pca-filters .pca-input{flex:1 1 100%;}}
```

- [ ] **Step 6: Run everything**

Run: `node --check js/admin.js && node tests/cash-advance.test.js && npm test`
Expected: `44 passed, 0 failed` for the cash-advance suite, and every other suite passes too. Watch especially `tests/pm-sharing.test.js`: its access test matches the lines you were told not to touch.

- [ ] **Step 7: Checkpoint (no commit)**

Changed: `js/admin.js`, `admin.html`, `css/pm-admin.css`, `tests/cash-advance.test.js`.

---

### Task 7: Documentation

**Files:**
- Modify: `CLAUDE.md`, `docs/ARCHITECTURE.md`, `docs/DATABASE_SCHEMA.md`, `supabase/migrations/README.md`

**Interfaces:** none (documentation only).

- [ ] **Step 1: `CLAUDE.md` — money-invariant bullet**

Insert directly after the bullet that starts `- **PM profit sharing (0098) is an internal allocation outside the money model.**`, and after that bullet's last line (the one ending `Spec: \`docs/superpowers/specs/2026-10-18-pm-profit-sharing-mvp-terms.md\`.`):

```markdown
- **Worker cash advances (0100) are a tracking ledger outside the money model.** Money advanced to a
  worker on a PM project and the repayments the owner records by hand. Balance = advance −
  non-voided repayments; a repayment can never exceed it, and the server locks the advance row for
  every repayment, edit and void. The suggested repayment (payroll × %, default 30%, capped at the
  balance) is a **label** — never a deduction, payment or repayment. Nothing may feed advances or
  repayments into payroll, Spent / Earned / Profit, an expense, invoice or accounting entry, and the
  project link charges nothing to the project. Mistakes are **voided with a reason, never deleted**;
  every write carries an operation id so a retry records once. Only `js/cash-advance.js` calls the
  `pm_ca_*` functions (`tests/cash-advance.test.js` fences it). Owner-role only; staff never see it.
  Spec: `docs/superpowers/specs/2026-10-19-worker-cash-advances-design.md`.
```

- [ ] **Step 2: `docs/ARCHITECTURE.md` §4 — module map row**

Insert a new row directly after the row that starts `| PM Profit Sharing |`:

```markdown
| Worker Cash Advances | `cash-advance.js` (`window.CashAdvance`), `cash-advance-admin.js` + `cash-advance-forms.js` (`window.CashAdvanceAdmin`) | Money advanced to workers on a PM project and the repayments the owner records by hand (`0100`) - **a tracking ledger outside the money model**: no payroll, expense, invoice or accounting side effects, and no money math reads it. `cash-advance.js` is the only calculation (balance, status, suggestion) and the only caller of the `pm_ca_*` functions. The screen reads each project's Labor lines itself from `constructionProjects/{id}/weeklyBills` (never pm-admin.js state), so it works when opened directly; it borrows only pm-admin.js's `_pmNamesSimilar` / `_pmLaborNameGroups`. PM -> Cash Advances (`pmCashAdvances`). Owner-role only; staff never see it |
```

- [ ] **Step 3: `docs/DATABASE_SCHEMA.md` — new section**

Append at the end of the file:

```markdown
## PM worker cash advances (0100)

A tracking ledger of money advanced to workers on a PM project and the repayments the owner records by hand - **outside the money model** (no payroll, expense, invoice or accounting entry; no Spent / Earned / Profit code reads it). Spec `docs/superpowers/specs/2026-10-19-worker-cash-advances-design.md`. All four tables have **RLS on, no policies, and all privileges revoked** from `anon`/`authenticated`. Everything goes through the `pm_ca_*` functions, for owner-role accounts of the company only (`pm_owner_company()`, 0098).

| Table / object | Columns and rules |
|---|---|
| `pm_cash_advances` | `id`, `company_owner_id`, `project_id` (a `construction_projects.id`, **plain value, no FK** - deleting a project neither blocks on nor erases the ledger), `project_name_snapshot`, `worker_name` (typed; 1-120 chars), `issued_on`, `amount numeric(12,2) > 0`, `suggest_pct numeric(5,2)` 0-100 default 30, `notes`, `created_by/at`, `updated_by/at`, `voided_at/by`, `void_reason` (all three set together). Never deleted |
| `pm_cash_advance_repayments` | `id`, `advance_id` -> advances (restrict), `company_owner_id`, `paid_on`, `amount numeric(12,2) > 0`, `payroll_ref` jsonb snapshot `{billId, entryIds[], day, details, amount}` or null (never a live link), `notes`, `created_by/at`, void fields as above |
| `pm_cash_advance_events` | Append-only history: `seq` identity, `advance_id` (plain), `company_owner_id`, `kind` (`issued`/`edited`/`repaid`/`repayment_voided`/`voided`), `repayment_id`, `changes` (`{field: [old, new]}`), `reason`, `actor_id`, `actor_email`, `at`. `pm_ca_events_immutable_trg` refuses UPDATE/DELETE |
| `pm_cash_advance_ops` | One row per submitted write: `op_id` PK (from the browser), `company_owner_id`, `action`, `result` jsonb, `actor_id`, `at`. A repeated `op_id` returns the stored `result` and writes nothing; another action/company -> `OP_CONFLICT` |
| `pm_ca_projects()` / `pm_ca_list()` | Reads: the company's mapped PM projects; every advance with repayments, events and `project_deleted` |
| `pm_ca_record_advance` / `pm_ca_edit_advance` / `pm_ca_record_repayment` / `pm_ca_void_repayment` / `pm_ca_void_advance` | Writes, each taking `p_op_id` first. Lock the advance row before any balance check. Refusals: `BAD_AMOUNT`, `BAD_PRECISION` (more than 2 decimals - rejected, never rounded), `BAD_PCT`, `BAD_WORKER`, `BAD_DATE`, `BAD_REF`, `BAD_REASON`, `OVER_BALANCE`, `BELOW_REPAID`, `HAS_REPAYMENTS`, `VOIDED`, `ALREADY_VOIDED`, `NOT_FOUND`, `BAD_OP`, `OP_CONFLICT`. The project is checked only on create or a project change |
```

- [ ] **Step 4: `supabase/migrations/README.md` — canonical order**

Insert a new paragraph directly after the one that starts `**0099 (PM project company map)**`:

```markdown
**0100 (PM worker cash advances)** Worker cash-advance tracking ledger — four private tables (advances, repayments, append-only events, operation ids) and the `pm_ca_*` functions; owner-role accounts of the company only; outside the money model. Spec docs/superpowers/specs/2026-10-19-worker-cash-advances-design.md
```

- [ ] **Step 5: Checkpoint (no commit)**

Run: `npm test` (the docs aren't tested, but confirm nothing else moved).
Changed: `CLAUDE.md`, `docs/ARCHITECTURE.md`, `docs/DATABASE_SCHEMA.md`, `supabase/migrations/README.md`.

---

### Task 8: Full local verification

**Files:** none changed (unless a check fails, in which case fix the owning task's file).

- [ ] **Step 1: Syntax-check every authored JS file, as CI does**

Run: `for f in js/*.js tests/*.js service-worker.js; do node --check "$f" || echo "FAIL $f"; done`
Expected: no `FAIL` lines.

- [ ] **Step 2: All Node suites**

Run: `npm test`
Expected: every suite ends `0 failed`. `tests/money-math.test.js` passes unchanged (proof the money model is untouched); `tests/cash-advance.test.js` shows `44 passed, 0 failed`.

- [ ] **Step 3: All SQL suites**

Run: `npm run test:sql`
Expected: every suite passes. The two new ones show `28 passed, 0 failed` and `13 passed, 0 failed`.

- [ ] **Step 4: Hand-check the diff for the fences**

Run: `git diff --stat` and `git status`
Expected: only the files listed in Tasks 1–7, plus the user's pre-existing uncommitted changes. No edit to `js/portal-app.compiled.js`, `js/expenses-module.js`, `js/pm-admin.js` or either portal HTML.

- [ ] **Step 5: Stop and report to the user**

Report the test totals and the changed-file list. **Do not commit** — the user commits. Ask for approval before Task 9.

---

### Task 9: Apply 0100 live and run the browser pass (needs the user's yes)

**Files:** none.

- [ ] **Step 1: Get explicit approval**

Ask: "Apply migration 0100 to the live database now?" Do nothing until the user says yes. Approval for an earlier migration doesn't carry over.

- [ ] **Step 2: Check the live state first**

With the Supabase MCP `execute_sql` (read-only):

```sql
select to_regclass('public.pm_cash_advances') as advances,
       to_regprocedure('public.pm_owner_company()') as owner_fn,
       (select count(*) from pm_project_companies) as mapped_projects;
```

Expected: `advances` null (not yet applied), `owner_fn` not null (0098 is live), `mapped_projects` ≥ 6 (0099). **Stop** if `owner_fn` is null (0098 isn't live) or `mapped_projects` < 6 (0099 isn't live). Then list the PM projects the picker will NOT offer:

```sql
select cp.id, cp.project_name, cp.status
  from construction_projects cp
  left join pm_project_companies m on m.project_id = cp.id
 where m.project_id is null;
```

Show that list to the user. Any active project in it can't take advances until it is mapped, and mapping needs a new owner-verified data migration (0101). Never insert the rows from the SQL editor.

- [ ] **Step 3: Apply the file verbatim**

Use the Supabase MCP `apply_migration` with name `0100_pm_cash_advances` and the exact contents of `supabase/migrations/0100_pm_cash_advances.sql`. Never paste an edited copy and never use the SQL editor.

- [ ] **Step 4: Verify what is live (don't trust "done")**

```sql
select c.relname, c.relrowsecurity,
       (select count(*) from pg_policies p where p.tablename = c.relname) as policies,
       has_table_privilege('authenticated', c.oid, 'select') as auth_select
  from pg_class c
 where c.relname in ('pm_cash_advances', 'pm_cash_advance_repayments', 'pm_cash_advance_events', 'pm_cash_advance_ops')
 order by 1;
select p.proname, has_function_privilege('authenticated', p.oid, 'execute') as auth_exec,
       has_function_privilege('anon', p.oid, 'execute') as anon_exec
  from pg_proc p where p.proname like 'pm_ca_%' order by 1;
```

Expected: 4 tables, all `relrowsecurity = true`, `policies = 0`, `auth_select = false`. `auth_exec = true` only for `pm_ca_projects`, `pm_ca_list`, `pm_ca_record_advance`, `pm_ca_edit_advance`, `pm_ca_record_repayment`, `pm_ca_void_repayment`, `pm_ca_void_advance`. Every `anon_exec` is false.

Then run the Supabase MCP `get_advisors` (type `security`). Expected for 0100: only INFO `rls_enabled_no_policy` on the four `pm_cash_advance*` tables (intended), and no `function_search_path_mutable` for any `pm_ca_*` function.

- [ ] **Step 5: Browser pass — owner** (`admin.html`, signed in as the main owner)

1. **Direct open:** open Project Management → **Cash Advances** straight away, then **reload the page while on it**. Do **not** open the Projects grid first. The list loads ("No cash advances yet.").
2. **+ New advance:** pick a project with Labor lines. Worker-name suggestions appear. Suggested % shows 30 and the date is today. Save ₱6,000 for a worker who has a ₱6,450 Labor line.
3. Open it and click **Record repayment**. That worker's Labor lines are listed, newest first. Pick the ₱6,450 line: the box shows "₱6,450.00 × 30% = **₱1,935.00** suggested" and "Suggestion only — nothing is deducted." The actual amount is still empty.
4. Click **Use ₱1,935.00**, change it to **1000**, then **double-click Save**. History shows exactly **one** ₱1,000 repayment; the balance is ₱5,000.00; the status is Partially Paid.
5. Try **5000.01**: refused, "That's more than the remaining balance of ₱5,000.00."
6. **Void** the repayment with a reason. The balance goes back to ₱6,000.00, and the repayment stays in History, struck through, with who, when and why.
7. **Void advance** is disabled while a repayment is live. Once all repayments are voided it works, and the advance drops out of the totals ("Show voided" brings it back).
8. Open that project in the Projects grid and Project Control/Overview. **Payroll and all money totals are unchanged.**
9. Sign in as **admin-pm@**: the tab shows, and the advance from step 2 is listed.

- [ ] **Step 6: Browser pass — staff**

Signed in as a staff account: no Cash Advances tab anywhere (sidebar or top row). Typing the view in via the console (`switchView('pmCashAdvances')`) lands on Projects.

- [ ] **Step 7: Check for production errors**

```sql
select at, page, kind, message, source, line from client_errors
 where at > now() - interval '1 hour' and (message ilike '%cash%' or source ilike '%cash-advance%')
 order by at desc limit 20;
```

Expected: no rows (one `_pmNamesSimilar missing` row would mean a script-order problem).

- [ ] **Step 8: Report**

Tell the user the result of each browser step and remind them to commit. The suggested message:
`Worker Cash Advances: migration 0100, PM → Cash Advances tab, tests and docs`.

