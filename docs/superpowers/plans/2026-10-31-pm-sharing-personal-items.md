# PM Profit Sharing — Personal Items Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the main owner record items the owner or the partner bought for themselves on a PM project, so each item comes off **only that person's** profit-sharing figure, after the split.

**Architecture:** One new migration adds three private tables (items, append-only events, run-once ops), three main-owner-only write functions, an `items` key on the existing `pm_sharing_read`, and storage rules for an owner-only `pmSharing/` receipt folder. `js/pm-sharing.js` (the ONE sharing calculation) subtracts active items per side after the split. A new `js/pm-sharing-items.js` owns the Overview panel, the form and every `pm_si_*` call; `pm-admin.js` and `pm-sharing-dashboard.js` only display the new "after items" figures.

**Tech Stack:** Plain HTML + vanilla JS (no build step), Supabase Postgres (plpgsql, security-definer functions), Node test scripts (`npm test`), PGlite + embedded-postgres SQL suites (`npm run test:sql`).

**Spec:** [docs/superpowers/specs/2026-10-31-pm-sharing-personal-items-design.md](../specs/2026-10-31-pm-sharing-personal-items-design.md) — read it with this plan.

## Global Constraints

- **Never run `git commit` or `git push`.** The user commits by hand. Every "Commit" step below is **"Stop and tell the user which files changed"**.
- **Never run `npm run build`.**
- Items are **outside the money model**: never a bill, expense, Spent, Earned, Profit, payout, amount owed or accounting entry. They never change `balanceCents`, the reserve, `ownerCents` or `partnerCents` — only the new `*AfterCents` figures.
- Writes: **main owner only** = `pm_main_owner_id()` (role `owner`, `owner_id` null, active; never `allowed_modules`). Reads: owner-role accounts of the company = `pm_owner_company()`. Staff: no panel, no fetch, no figures.
- Mistakes are **corrected or voided with a reason, never deleted**. History rows can't be updated or deleted.
- Every write carries an operation id (`p_op_id`); the same id twice records once.
- Amount: > ₱0, < ₱100,000,000, at most 2 decimals — refused (`BAD_PRECISION`), never rounded.
- Date bought: not in the future (PH date, `Asia/Manila`). Local date keys are built from local parts, never `toISOString().slice(0,10)`.
- Receipt path: `pmSharing/<company uuid>/<yyyy-mm>/<uuid>.jpg` in the private `uploads` bucket.
- Migration number: **0110** (0109 is held by the Stage 4 draft). Task 1 Step 1 re-checks this.
- No change to `Client Management.html` / `Dacs Partnership.html` (partner portal excluded, Release 1 Phase C).
- All money in the browser is integer centavos via `PMShare.toCents`.

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `supabase/migrations/0110_pm_sharing_items.sql` | Create | Tables, helpers, `pm_si_record/correct/void`, `pm_sharing_read` + items, `pm_si_file_ok`, storage rules, privileges |
| `supabase/tests/pm_sharing_items_base.mjs` | Create | Shared fixtures for the two SQL suites (migrations, storage stand-ins) |
| `supabase/tests/pm_sharing_items.pglite.mjs` | Create | Behaviour suite on PGlite |
| `supabase/tests/pm_sharing_items_concurrency.mjs` | Create | Races + real-role pass on PostgreSQL |
| `supabase/tests/pm_sharing_items_acceptance.sql` | Create | Read-only live checks after the user applies 0110 |
| `js/pm-sharing.js` | Modify | `itemTotals`, `*AfterCents`, `items_exceed_share` flag, combine totals |
| `js/pm-sharing-items.js` | Create | Panel, form, receipt upload/open, the only `pm_si_*` caller |
| `js/receipt-storage.js` | Modify | `pm_sharing: 'pmSharing'` folder (path builder + fan-out scan) |
| `js/pm-admin.js` | Modify | Load items with the share, Overview split line + panel holder + mount, print item list, Reports split line |
| `js/pm-sharing-dashboard.js` | Modify | Hero, table, detail, CSV, print use after-items figures; new status |
| `admin.html` | Modify | Item form modal markup, script tag |
| `tests/pm-sharing.test.js` | Modify | Calculation + screen checks |
| `tests/pm-sharing-items.test.js` | Create | Panel/form/server-call tests + fences |
| `tests/storage-access.test.js` | Modify | `pmSharing` rules + FOLDERS entry |
| `package.json` | Modify | Add the new suites to `test` and `test:sql` |
| `docs/DATABASE_SCHEMA.md`, `CLAUDE.md`, `supabase/migrations/README.md`, Release 1 spec | Modify | Docs |

---

### Task 1: Migration 0110 — tables, write functions, read (with SQL behaviour + race suites)

**Files:**
- Create: `supabase/migrations/0110_pm_sharing_items.sql` (sections 1–5 now; section 6 storage comes in Task 2)
- Create: `supabase/tests/pm_sharing_items_base.mjs`
- Create: `supabase/tests/pm_sharing_items.pglite.mjs`
- Create: `supabase/tests/pm_sharing_items_concurrency.mjs`
- Modify: `package.json` (`test:sql`)

**Interfaces:**
- Consumes (0098): `pm_main_owner_id()`, `pm_owner_company()`, `pm_project_companies(project_id, company_owner_id)`, `pm_sharing_read(uuid[])`.
- Produces:
  - `pm_si_record(p_op_id uuid, p_project uuid, p_charged_to text, p_item_name text, p_amount numeric, p_bought_on date, p_note text, p_receipt_path text) → jsonb {item}`
  - `pm_si_correct(p_op_id uuid, p_id uuid, p_expected_version int, p_charged_to text, p_item_name text, p_amount numeric, p_bought_on date, p_note text, p_receipt_path text, p_reason text) → jsonb {item, changed}`
  - `pm_si_void(p_op_id uuid, p_id uuid, p_expected_version int, p_reason text) → jsonb {item}`
  - `pm_sharing_read(...)` result gains `items: [{id, project_id, charged_to, item_name, amount, bought_on, note, receipt_path, status, void_reason, version, created_at, updated_at, events:[{kind, reason, actor_email, at, old, new}]}]`
  - Error codes (`raise exception '<CODE>'`): `OWNER_ONLY`, `PROJECT_UNMAPPED`, `WRONG_COMPANY`, `BAD_CHARGED_TO`, `BAD_NAME`, `BAD_NOTE`, `BAD_REASON`, `BAD_AMOUNT`, `BAD_PRECISION`, `BAD_DATE`, `BAD_RECEIPT_PATH`, `REASON_REQUIRED`, `ITEM_VOIDED`, `ITEM_CHANGED`, `NOT_FOUND`, `BAD_OP`, `OP_REUSED`, `HISTORY_IMMUTABLE`.

- [ ] **Step 1: Confirm the migration number**

Run: `ls supabase/migrations | sort | tail -3` and read the "Next number" line of `supabase/migrations/README.md`.
Expected: highest on disk is `0108_tools_crew_numbers.sql` (or `0109_…` if Stage 4 landed). Use **0110** unless a `0110_` file already exists — then use the next free number and rename every `0110` / `M110` reference in this plan. If unsure whether 0109 is still reserved, ask the user before writing the file.

- [ ] **Step 2: Write the shared test fixtures**

Create `supabase/tests/pm_sharing_items_base.mjs`:

```js
// Shared by pm_sharing_items.pglite.mjs and pm_sharing_items_concurrency.mjs.
// 0110 needs 0098 (pm_main_owner_id, pm_owner_company, pm_project_companies,
// pm_sharing_read) and restates the uploads storage rules, so the storage
// table and the helpers its policy names get minimal stand-ins here.
// Nothing here talks to the live database.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
export { PM_BASE, IDS, seedProfiles } from './pm_sharing_base.mjs';
export { SUPABASE_DEFAULT_GRANTS } from './pm_cash_advances_base.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.DACS_ROOT || path.join(HERE, '..', '..');
const migration = (f) => fs.readFileSync(path.join(ROOT, 'supabase/migrations', f), 'utf8').replace(/\r\n/g, '\n');

export const M98 = migration('0098_pm_profit_sharing.sql');
export const M110 = migration('0110_pm_sharing_items.sql');

// Only what 0110's restated storage policy and rule functions need to be created.
export const STORAGE_STANDIN = `
create schema if not exists storage;
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner_id text);
alter table storage.objects enable row level security;
create table storage.buckets (id text primary key, public boolean);
create or replace function is_owner() returns boolean language sql stable as
  $$ select (select role from profiles where id = auth.uid()) = 'owner' $$;
create or replace function is_staff() returns boolean language sql stable as
  $$ select (select role from profiles where id = auth.uid()) = 'staff' $$;
create or replace function data_owner_id() returns uuid language sql stable as $$ select auth.uid() $$;
create or replace function pur_buyer() returns boolean language sql stable as $$ select false $$;`;
```

- [ ] **Step 3: Write the failing behaviour suite**

Create `supabase/tests/pm_sharing_items.pglite.mjs`:

```js
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

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) { console.log(failures.join('\n')); process.exit(1); }
```

- [ ] **Step 4: Run it to make sure it fails**

Run: `npm --prefix supabase/tests install --no-package-lock --no-audit --no-fund && node supabase/tests/pm_sharing_items.pglite.mjs`
Expected: crash with `ENOENT … 0110_pm_sharing_items.sql`.

- [ ] **Step 5: Write migration sections 1–5**

Create `supabase/migrations/0110_pm_sharing_items.sql`:

```sql
-- ════════════════════════════════════════════════════════════════════
-- 0110 — PM profit sharing: personal items.
-- Spec: docs/superpowers/specs/2026-10-31-pm-sharing-personal-items-design.md
--
-- An item the owner or the partner bought for THEMSELVES out of a PM
-- project's money. It lowers ONLY that person's sharing figure, after the
-- split (js/pm-sharing.js does the sum). OUTSIDE the money model: never a
-- bill, expense, Spent, Profit, payout, amount owed or accounting entry.
-- Nothing here reads or writes weekly_bills, expenses, warranty tables or
-- the sharing balance.
--
-- • Three private tables. RLS on, NO policies, privileges revoked. Reads go
--   through pm_sharing_read (restated below with an `items` key); writes
--   through pm_si_record / pm_si_correct / pm_si_void.
-- • Writes: MAIN OWNER only — pm_main_owner_id() (0098). Reads: owner-role
--   accounts of the company — pm_owner_company() (0098).
-- • Every write takes p_op_id: the first call with an id does the work and
--   stores its result; a repeat returns it and records nothing.
-- • Correct / void lock the item row and check its version (ITEM_CHANGED).
-- • Amounts are validated AS RECEIVED: more than two decimals is refused
--   (BAD_PRECISION), never rounded by the numeric(…,2) cast.
-- • project_id is a PLAIN value (no FK): deleting a project never erases
--   the items or their history (same as 0100).
-- • Receipt photos: pmSharing/<company>/<yyyy-mm>/<uuid>.jpg in `uploads`
--   (section 6): main owner writes, owner-role of that company reads.
-- Requires 0098 and 0102. Idempotent where practical.
-- ════════════════════════════════════════════════════════════════════

-- ── 1. Tables ─────────────────────────────────────────────────────────
create table if not exists pm_sharing_items (
  id               uuid primary key default gen_random_uuid(),
  company_owner_id uuid not null,
  project_id       uuid not null,
  charged_to       text not null check (charged_to in ('owner', 'partner')),
  item_name        text not null check (length(item_name) between 1 and 120),
  amount           numeric(14,2) not null check (amount > 0 and amount < 100000000),
  bought_on        date not null,
  note             text check (note is null or length(note) <= 500),
  receipt_path     text,
  status           text not null default 'active' check (status in ('active', 'voided')),
  void_reason      text,
  version          int not null default 1 check (version >= 1),
  created_by       uuid not null,
  created_at       timestamptz not null default now(),
  updated_by       uuid not null,
  updated_at       timestamptz not null default now(),
  constraint pm_sharing_items_void_reason check ((status = 'voided') = (void_reason is not null))
);
create index if not exists pm_sharing_items_project_idx on pm_sharing_items(project_id);
create index if not exists pm_sharing_items_company_idx on pm_sharing_items(company_owner_id);

-- Append-only history: one row per record / correct / void.
create table if not exists pm_sharing_item_events (
  id               bigint generated always as identity primary key,
  item_id          uuid not null,
  company_owner_id uuid not null,
  kind             text not null check (kind in ('recorded', 'corrected', 'voided')),
  old_values       jsonb,
  new_values       jsonb not null,
  reason           text,
  actor_id         uuid not null,
  actor_email      text,
  at               timestamptz not null default now()
);
create index if not exists pm_sharing_item_events_item_idx on pm_sharing_item_events(item_id, id);

-- One row per submitted write.
create table if not exists pm_sharing_item_ops (
  op_id            uuid primary key,
  company_owner_id uuid not null,
  action           text not null check (action in ('record', 'correct', 'void')),
  result           jsonb,
  actor_id         uuid not null,
  at               timestamptz not null default now()
);

create or replace function pm_si_events_immutable() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  raise exception 'HISTORY_IMMUTABLE' using errcode = 'P0001';
end;
$$;
drop trigger if exists pm_si_events_immutable_trg on pm_sharing_item_events;
create trigger pm_si_events_immutable_trg
  before update or delete on pm_sharing_item_events
  for each row execute function pm_si_events_immutable();

-- ── 2. Internal helpers (never granted to clients) ────────────────────
-- Trimmed text, NULL when blank; too long → p_code.
create or replace function pm_si_text(p text, p_max int, p_code text) returns text
language plpgsql immutable set search_path = public, pg_temp as $$
declare v text := nullif(btrim(p), '');
begin
  if v is not null and length(v) > p_max then raise exception '%', p_code using errcode = 'P0001'; end if;
  return v;
end;
$$;

-- Every field rule for a record or a correction, checked one at a time.
create or replace function pm_si_check(p_company uuid, p_charged_to text, p_name text, p_amount numeric,
                                       p_bought_on date, p_receipt text) returns void
language plpgsql stable set search_path = public, pg_temp as $$
begin
  if p_charged_to is null or p_charged_to not in ('owner', 'partner') then
    raise exception 'BAD_CHARGED_TO' using errcode = 'P0001';
  end if;
  if p_name is null or length(p_name) > 120 then raise exception 'BAD_NAME' using errcode = 'P0001'; end if;
  if p_amount is null or p_amount = 'NaN'::numeric or p_amount <= 0 or p_amount >= 100000000 then
    raise exception 'BAD_AMOUNT' using errcode = 'P0001';
  end if;
  if p_amount <> round(p_amount, 2) then raise exception 'BAD_PRECISION' using errcode = 'P0001'; end if;
  if p_bought_on is null or p_bought_on > (now() at time zone 'Asia/Manila')::date then
    raise exception 'BAD_DATE' using errcode = 'P0001';
  end if;
  if p_receipt is not null
     and p_receipt !~ ('^pmSharing/' || p_company::text || '/[0-9]{4}-[0-9]{2}/[0-9a-f-]{36}\.jpg$') then
    raise exception 'BAD_RECEIPT_PATH' using errcode = 'P0001';
  end if;
end;
$$;

-- NULL when this call owns the operation, otherwise the first call's result.
-- A concurrent call with the same id waits on the primary key.
create or replace function pm_si_op_begin(p_op uuid, p_company uuid, p_action text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_got uuid; v_row record;
begin
  if p_op is null then raise exception 'BAD_OP' using errcode = 'P0001'; end if;
  insert into pm_sharing_item_ops (op_id, company_owner_id, action, actor_id)
  values (p_op, p_company, p_action, auth.uid())
  on conflict (op_id) do nothing
  returning op_id into v_got;
  if v_got is not null then return null; end if;
  select company_owner_id, action, result into v_row from pm_sharing_item_ops where op_id = p_op;
  if v_row.company_owner_id is distinct from p_company or v_row.action is distinct from p_action
     or v_row.result is null then
    raise exception 'OP_REUSED' using errcode = 'P0001';
  end if;
  return v_row.result;
end;
$$;

create or replace function pm_si_op_end(p_op uuid, p_result jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update pm_sharing_item_ops set result = p_result where op_id = p_op;
  return p_result;
end;
$$;

create or replace function pm_si_project_ok(p_project uuid, p_company uuid) returns void
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v uuid;
begin
  select company_owner_id into v from pm_project_companies where project_id = p_project;
  if not found then raise exception 'PROJECT_UNMAPPED' using errcode = 'P0001'; end if;
  if v is distinct from p_company then raise exception 'WRONG_COMPANY' using errcode = 'P0001'; end if;
end;
$$;

create or replace function pm_si_json(p_id uuid) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object('id', i.id, 'project_id', i.project_id, 'charged_to', i.charged_to,
           'item_name', i.item_name, 'amount', i.amount, 'bought_on', i.bought_on, 'note', i.note,
           'receipt_path', i.receipt_path, 'status', i.status, 'void_reason', i.void_reason,
           'version', i.version, 'created_at', i.created_at, 'updated_at', i.updated_at)
    from pm_sharing_items i where i.id = p_id
$$;

create or replace function pm_si_event(p_item uuid, p_company uuid, p_kind text, p_old jsonb, p_reason text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into pm_sharing_item_events (item_id, company_owner_id, kind, old_values, new_values, reason, actor_id, actor_email)
  values (p_item, p_company, p_kind, p_old, pm_si_json(p_item), p_reason, auth.uid(),
          (select email from profiles where id = auth.uid()));
end;
$$;

-- The locked, active item at the version the caller saw.
create or replace function pm_si_lock(p_id uuid, p_company uuid, p_expected_version int) returns pm_sharing_items
language plpgsql security definer set search_path = public, pg_temp as $$
declare v pm_sharing_items;
begin
  select * into v from pm_sharing_items where id = p_id and company_owner_id = p_company for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;
  if v.status = 'voided' then raise exception 'ITEM_VOIDED' using errcode = 'P0001'; end if;
  if p_expected_version is null or p_expected_version <> v.version then
    raise exception 'ITEM_CHANGED' using errcode = 'P0001';
  end if;
  return v;
end;
$$;

-- ── 3. Writes — main owner only ───────────────────────────────────────
create or replace function pm_si_record(p_op_id uuid, p_project uuid, p_charged_to text, p_item_name text,
                                        p_amount numeric, p_bought_on date, p_note text, p_receipt_path text)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_company uuid := pm_main_owner_id();
  v_prior   jsonb;
  v_name    text;
  v_note    text;
  v_receipt text := nullif(btrim(p_receipt_path), '');
  v_id      uuid;
begin
  v_prior := pm_si_op_begin(p_op_id, v_company, 'record');
  if v_prior is not null then return v_prior; end if;
  perform pm_si_project_ok(p_project, v_company);
  v_name := pm_si_text(p_item_name, 120, 'BAD_NAME');
  v_note := pm_si_text(p_note, 500, 'BAD_NOTE');
  perform pm_si_check(v_company, p_charged_to, v_name, p_amount, p_bought_on, v_receipt);
  insert into pm_sharing_items (company_owner_id, project_id, charged_to, item_name, amount, bought_on, note,
                                receipt_path, created_by, updated_by)
  values (v_company, p_project, p_charged_to, v_name, p_amount, p_bought_on, v_note, v_receipt, auth.uid(), auth.uid())
  returning id into v_id;
  perform pm_si_event(v_id, v_company, 'recorded', null, null);
  return pm_si_op_end(p_op_id, jsonb_build_object('item', pm_si_json(v_id)));
end;
$$;

create or replace function pm_si_correct(p_op_id uuid, p_id uuid, p_expected_version int, p_charged_to text,
                                         p_item_name text, p_amount numeric, p_bought_on date, p_note text,
                                         p_receipt_path text, p_reason text)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_company uuid := pm_main_owner_id();
  v_prior   jsonb;
  v_item    pm_sharing_items;
  v_old     jsonb;
  v_name    text;
  v_note    text;
  v_reason  text;
  v_receipt text := nullif(btrim(p_receipt_path), '');
begin
  v_prior := pm_si_op_begin(p_op_id, v_company, 'correct');
  if v_prior is not null then return v_prior; end if;
  v_item := pm_si_lock(p_id, v_company, p_expected_version);
  v_reason := pm_si_text(p_reason, 500, 'BAD_REASON');
  if v_reason is null then raise exception 'REASON_REQUIRED' using errcode = 'P0001'; end if;
  v_name := pm_si_text(p_item_name, 120, 'BAD_NAME');
  v_note := pm_si_text(p_note, 500, 'BAD_NOTE');
  perform pm_si_check(v_company, p_charged_to, v_name, p_amount, p_bought_on, v_receipt);
  if (p_charged_to, v_name, p_amount, p_bought_on, v_note, v_receipt) is not distinct from
     (v_item.charged_to, v_item.item_name, v_item.amount, v_item.bought_on, v_item.note, v_item.receipt_path) then
    return pm_si_op_end(p_op_id, jsonb_build_object('item', pm_si_json(p_id), 'changed', false));
  end if;
  v_old := pm_si_json(p_id);
  update pm_sharing_items
     set charged_to = p_charged_to, item_name = v_name, amount = p_amount, bought_on = p_bought_on,
         note = v_note, receipt_path = v_receipt, version = version + 1, updated_by = auth.uid(), updated_at = now()
   where id = p_id;
  perform pm_si_event(p_id, v_company, 'corrected', v_old, v_reason);
  return pm_si_op_end(p_op_id, jsonb_build_object('item', pm_si_json(p_id), 'changed', true));
end;
$$;

create or replace function pm_si_void(p_op_id uuid, p_id uuid, p_expected_version int, p_reason text)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_company uuid := pm_main_owner_id();
  v_prior   jsonb;
  v_item    pm_sharing_items;
  v_old     jsonb;
  v_reason  text;
begin
  v_prior := pm_si_op_begin(p_op_id, v_company, 'void');
  if v_prior is not null then return v_prior; end if;
  v_item := pm_si_lock(p_id, v_company, p_expected_version);
  v_reason := pm_si_text(p_reason, 500, 'BAD_REASON');
  if v_reason is null then raise exception 'REASON_REQUIRED' using errcode = 'P0001'; end if;
  v_old := pm_si_json(p_id);
  update pm_sharing_items
     set status = 'voided', void_reason = v_reason, version = version + 1, updated_by = auth.uid(), updated_at = now()
   where id = p_id;
  perform pm_si_event(p_id, v_company, 'voided', v_old, v_reason);
  return pm_si_op_end(p_op_id, jsonb_build_object('item', pm_si_json(p_id)));
end;
$$;

-- ── 4. Read — 0098's pm_sharing_read, unchanged, plus `items` ─────────
create or replace function pm_sharing_read(p_projects uuid[] default null) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_company  uuid := pm_owner_company();
  v_can_edit boolean;
begin
  v_can_edit := exists (select 1 from profiles where id = auth.uid() and role = 'owner'
                          and owner_id is null and coalesce(status, 'active') = 'active');
  return jsonb_build_object(
    'can_edit', v_can_edit,
    'projects', coalesce((
      select jsonb_agg(jsonb_build_object(
               'project_id', m.project_id,
               'partner_pct', coalesce(a.partner_pct, 50),
               'is_default', a.project_id is null,
               'version', coalesce(a.version, 0)) order by m.project_id)
        from pm_project_companies m
        left join pm_sharing_agreements a on a.project_id = m.project_id
       where m.company_owner_id = v_company
         and (p_projects is null or m.project_id = any(p_projects))), '[]'::jsonb),
    'history', coalesce((
      select jsonb_agg(jsonb_build_object(
               'project_id', h.project_id, 'old_pct', h.old_pct, 'new_pct', h.new_pct,
               'old_was_default', h.old_was_default, 'reason', h.reason,
               'actor_email', h.actor_email, 'changed_at', h.changed_at,
               'project_name', h.project_name_snapshot) order by h.changed_at desc, h.id)
        from pm_sharing_changes h
       where h.company_owner_id = v_company
         and (p_projects is null or h.project_id = any(p_projects))), '[]'::jsonb),
    'partners', coalesce((
      select jsonb_agg(s.x) from (
        select distinct on (lower(pr.email)) jsonb_build_object(
                 'email', lower(pr.email),
                 'accepted', coalesce(pr.partner_agreement_accepted, false),
                 'accepted_at', pr.partner_agreement_accepted_at,
                 'doc_version', pr.partner_agreement_doc_version) as x
          from pm_project_companies m
          join construction_projects cp on cp.id = m.project_id
          join profiles pr on lower(pr.email) = lower(btrim(cp.partner_email)) and pr.role = 'partner'
         where m.company_owner_id = v_company
           and (p_projects is null or m.project_id = any(p_projects))
           and coalesce(btrim(cp.partner_email), '') <> ''
         order by lower(pr.email), pr.partner_agreement_accepted_at desc nulls last) s), '[]'::jsonb),
    'items', coalesce((
      select jsonb_agg(pm_si_json(i.id) || jsonb_build_object('events', coalesce((
               select jsonb_agg(jsonb_build_object('kind', e.kind, 'reason', e.reason, 'actor_email', e.actor_email,
                                                   'at', e.at, 'old', e.old_values, 'new', e.new_values) order by e.id)
                 from pm_sharing_item_events e where e.item_id = i.id), '[]'::jsonb))
             order by i.bought_on desc, i.created_at desc)
        from pm_sharing_items i
       where i.company_owner_id = v_company
         and (p_projects is null or i.project_id = any(p_projects))), '[]'::jsonb)
  );
end;
$$;

-- ── 5. Privileges ─────────────────────────────────────────────────────
alter table pm_sharing_items       enable row level security;
alter table pm_sharing_item_events enable row level security;
alter table pm_sharing_item_ops    enable row level security;
revoke all on table pm_sharing_items, pm_sharing_item_events, pm_sharing_item_ops from public, anon, authenticated;
revoke all on sequence pm_sharing_item_events_id_seq from public, anon, authenticated;
revoke all on function pm_si_events_immutable(), pm_si_text(text, int, text),
                       pm_si_check(uuid, text, text, numeric, date, text), pm_si_op_begin(uuid, uuid, text),
                       pm_si_op_end(uuid, jsonb), pm_si_project_ok(uuid, uuid), pm_si_json(uuid),
                       pm_si_event(uuid, uuid, text, jsonb, text), pm_si_lock(uuid, uuid, int)
  from public, anon, authenticated;
revoke all on function pm_si_record(uuid, uuid, text, text, numeric, date, text, text),
                       pm_si_correct(uuid, uuid, int, text, text, numeric, date, text, text, text),
                       pm_si_void(uuid, uuid, int, text), pm_sharing_read(uuid[])
  from public, anon;
grant execute on function pm_si_record(uuid, uuid, text, text, numeric, date, text, text),
                          pm_si_correct(uuid, uuid, int, text, text, numeric, date, text, text, text),
                          pm_si_void(uuid, uuid, int, text), pm_sharing_read(uuid[])
  to authenticated;
```

- [ ] **Step 6: Run the behaviour suite**

Run: `node supabase/tests/pm_sharing_items.pglite.mjs`
Expected: `14 passed, 0 failed`. Also run `node supabase/tests/pm_sharing.pglite.mjs` — Release 1's suite must still pass unchanged (it does not load 0110, so it proves nothing broke in 0098 itself; S12 above proves the restated read keeps its keys).

- [ ] **Step 7: Write the race + real-role suite**

Create `supabase/tests/pm_sharing_items_concurrency.mjs`:

```js
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
```

- [ ] **Step 8: Run it**

Run: `node supabase/tests/pm_sharing_items_concurrency.mjs`
Expected: `11 passed, 0 failed`.

- [ ] **Step 9: Add both suites to `test:sql`**

In `package.json`, at the end of the `test:sql` script, after `&& node supabase/tests/pm_cash_advances_concurrency.mjs`, append:
`&& node supabase/tests/pm_sharing_items.pglite.mjs && node supabase/tests/pm_sharing_items_concurrency.mjs`

- [ ] **Step 10: Stop — tell the user which files changed** (they commit).

---

### Task 2: Receipt storage rules for `pmSharing/`

**Files:**
- Modify: `supabase/migrations/0110_pm_sharing_items.sql` (append section 6)
- Modify: `js/receipt-storage.js:13-15,91`
- Modify: `tests/storage-access.test.js` (FOLDERS, scanner regex, new test)
- Modify: `supabase/tests/pm_sharing_items.pglite.mjs` (one more test)

**Interfaces:**
- Consumes: `pm_main_owner_id()`, `pm_owner_company()` (0098); 0102's latest `uploads_can_read` / `uploads_can_write` / `uploads_admin_update`.
- Produces: `public.pm_si_file_ok(p_name text, p_write boolean) → boolean`; `DacsReceipts.receiptPath('pm_sharing', companyId)` → `pmSharing/<company>/<yyyy-mm>/<uuid>.jpg`.

- [ ] **Step 1: Write the failing static test**

In `tests/storage-access.test.js`:

(a) In `FOLDERS`, after `tools: 'admin',` add:
```js
  // 0110: PM sharing personal-item receipts — main owner writes, owner-role of the company reads.
  pmSharing: 'pmSharing',
```
(b) In `uploadFolders()`, change the receipt-storage pattern to:
```js
    /\b(?:expense|payroll|purchase|petty_cash|pm_sharing):\s*'([A-Za-z][\w-]*)'/g, // receipt-storage.js FOLDER map
```
(c) In the "scan still finds the known upload sites" list, add `'pmSharing'` after `'pettyCash'`.
(d) After the petty-cash test, add:
```js
test('PM sharing receipts: main owner writes, owner-role of the company reads (0110), before every other rule', () => {
  const r = lastFn('uploads_can_read');
  const w = lastFn('uploads_can_write');
  ok(r.includes("v_folder = 'pmSharing' then\n    return pm_si_file_ok(p_name, false);"), 'read rule for pmSharing missing or reshaped');
  ok(w.includes("v_folder = 'pmSharing' then\n    return pm_si_file_ok(p_name, true);"), 'write rule for pmSharing missing or reshaped');
  ok(r.indexOf("v_folder = 'pmSharing'") < r.indexOf('p_owner_id = v_uid::text then return true'), 'read: pmSharing rule must precede the uploader read-back');
  ok(r.indexOf("v_folder = 'pmSharing'") < r.indexOf('if is_owner() or is_staff() then return true'), 'read: pmSharing rule must precede the generic rule');
  ok(w.indexOf("v_folder = 'pmSharing'") < w.indexOf('if is_owner() or is_staff() then return true'), 'write: pmSharing rule must precede the generic rule');
  // Earlier folder rules are still there, unchanged, in the same latest definition.
  ok(r.includes("v_folder = 'pettyCash' then\n    return pur_petty_reader(p_name);"), 'pettyCash read rule kept');
  ok(r.includes("v_folder = 'purchases' then\n    return pur_buyer() and split_part(p_name, '/', 2) = data_owner_id()::text;"), 'purchases read rule kept');
  ok(w.includes("v_folder = 'pettyCash' then\n    return pur_buyer() and v_seg2 = data_owner_id()::text;"), 'pettyCash write rule kept');
  const sql = allRules();
  const from = sql.lastIndexOf('create policy "uploads_admin_update"');
  const upd = sql.slice(from, sql.indexOf(');', from) + 2);
  ok(upd.includes("split_part(name, '/', 1) = 'pmSharing' then false"), 'a personal-item receipt is never overwritten');
  ok(upd.includes("split_part(name, '/', 1) = 'pettyCash' then false"), 'pettyCash overwrite rule kept');
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `node tests/storage-access.test.js`
Expected: FAIL on `read rule for pmSharing missing or reshaped` and `scan no longer sees uploads to pmSharing`.

- [ ] **Step 3: Add the folder to the receipt path builder**

In `js/receipt-storage.js`, replace lines 13–15:
```js
  // 'purchase' (0097): one receipt for a whole purchase — buyers of the company only.
  // 'petty_cash' (0102): a buyer's return photo — never visible to other buyers.
  const FOLDER = { expense: 'expenseReceipts', payroll: 'payrollReceipts', purchase: 'purchases', petty_cash: 'pettyCash' };
```
with:
```js
  // 'purchase' (0097): one receipt for a whole purchase — buyers of the company only.
  // 'petty_cash' (0102): a buyer's return photo — never visible to other buyers.
  // 'pm_sharing' (0110): a PM sharing personal-item receipt — path only; js/pm-sharing-items.js
  //   uploads it itself (no receipt_uploads ledger row: the item row holds the path).
  const FOLDER = { expense: 'expenseReceipts', payroll: 'payrollReceipts', purchase: 'purchases', petty_cash: 'pettyCash',
                   pm_sharing: 'pmSharing' };
```
and add to the header comment (after the `pettyCash/` line): `// pmSharing/ (0110): PM sharing personal-item receipts — the main owner writes, owner-role accounts of that company read.`

- [ ] **Step 4: Append section 6 to the migration**

Append to `supabase/migrations/0110_pm_sharing_items.sql` (the two rule functions are 0102's text with the `pmSharing` branch added right after `pettyCash`; everything else is unchanged):

```sql
-- ── 6. Receipt photos: pmSharing/<company>/<yyyy-mm>/<uuid>.jpg ───────
-- Write: the main owner. Read: owner-role accounts of that company (the main
-- owner and focused owners such as admin-pm@). data_owner_id() is the
-- caller's own id for a focused owner, so the company comes from 0098's
-- helpers. SECURITY DEFINER: those helpers are not granted to clients.
create or replace function public.pm_si_file_ok(p_name text, p_write boolean) returns boolean
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_company uuid;
begin
  if auth.uid() is null then return false; end if;
  begin
    v_company := case when p_write then pm_main_owner_id() else pm_owner_company() end;
  exception when others then
    return false;
  end;
  return p_name ~ ('^pmSharing/' || v_company::text || '/[0-9]{4}-[0-9]{2}/[0-9a-f-]{36}\.jpg$');
end $$;
revoke all on function public.pm_si_file_ok(text, boolean) from public, anon;
grant execute on function public.pm_si_file_ok(text, boolean) to authenticated;

-- 0102's rules, plus the pmSharing folder.
create or replace function public.uploads_can_read(p_name text, p_owner_id text)
returns boolean language plpgsql stable set search_path = public as $$
declare
  v_uid    uuid := auth.uid();
  v_folder text := split_part(p_name, '/', 1);
  v_pid    uuid := dacs_try_uuid(split_part(p_name, '/', 2));
begin
  if v_uid is null then return false; end if;

  -- 0097: purchase receipts — buyers of THAT company only (not even the uploader once the switch is off).
  if v_folder = 'purchases' then
    return pur_buyer() and split_part(p_name, '/', 2) = data_owner_id()::text;
  end if;

  -- 0102: petty cash return photos — the main owner and the uploading buyer only.
  if v_folder = 'pettyCash' then
    return pur_petty_reader(p_name);
  end if;

  -- 0110: PM sharing personal-item receipts — owner-role accounts of THAT company only.
  if v_folder = 'pmSharing' then
    return pm_si_file_ok(p_name, false);
  end if;

  -- The uploader can always read back their own file.
  if p_owner_id is not null and p_owner_id = v_uid::text then return true; end if;

  -- Owner-only modules (quotations 0045, reimbursements 0041).
  if v_folder in ('quotations', 'reimbursementReceipts') then return is_owner(); end if;

  -- 0089: expense/payroll receipts — owner/staff of THAT company only.
  if v_folder in ('expenseReceipts', 'payrollReceipts') then
    return (is_owner() or is_staff()) and split_part(p_name, '/', 2) = data_owner_id()::text;
  end if;

  -- Owner and staff: everything else (staff encode receipts from here).
  if is_owner() or is_staff() then return true; end if;

  -- Construction client / partner: files filed under THEIR project. Same
  -- test as the weekly_bills _client_read / _partner_read policies.
  if v_folder in ('weeklyBillReceipts', 'procurementReceipts', 'accomplishmentReports', 'projectTerms') then
    return v_pid is not null
       and (cproj_client_can_read(v_pid) or cproj_partner_can_read(v_pid));
  end if;

  -- Employee agreement PDF: every non-owner admin role (staff, worker,
  -- teamLeader) signs it at first login in admin.html (js/admin.js).
  if v_folder = 'employeeTermsGlobal' then return coalesce(is_worker(), false); end if;

  -- Agreement templates shown at the client/partner signing gates.
  -- coalesce: a profile with a NULL role must not be denied (NOT NULL = NULL).
  if v_folder = 'agreementDocs' then return not coalesce(is_worker(), false); end if;

  return false;
end $$;

create or replace function public.uploads_can_write(p_name text)
returns boolean language plpgsql stable set search_path = public as $$
declare
  v_uid    uuid := auth.uid();
  v_folder text := split_part(p_name, '/', 1);
  v_seg2   text := split_part(p_name, '/', 2);
begin
  if v_uid is null then return false; end if;

  -- 0097: purchase receipts — buyers of THAT company only.
  if v_folder = 'purchases' then
    return pur_buyer() and v_seg2 = data_owner_id()::text;
  end if;

  -- 0102: petty cash return photos — buyers of THAT company (read back through the ledger).
  if v_folder = 'pettyCash' then
    return pur_buyer() and v_seg2 = data_owner_id()::text;
  end if;

  -- 0110: PM sharing personal-item receipts — the main owner only.
  if v_folder = 'pmSharing' then
    return pm_si_file_ok(p_name, true);
  end if;

  if v_folder in ('quotations', 'reimbursementReceipts') then return is_owner(); end if;

  -- 0089: expense/payroll receipts — owner/staff of THAT company only.
  if v_folder in ('expenseReceipts', 'payrollReceipts') then
    return (is_owner() or is_staff()) and split_part(p_name, '/', 2) = data_owner_id()::text;
  end if;

  if is_owner() or is_staff() then return true; end if;
  -- Signatures. Clients/partners (js/client-management-app.js):
  --   signatures/<uid>_<ts>.png  and  signatures/proj_<project>_<uid>_<ts>.png
  -- Workers/team leaders (employee agreement gate, js/admin.js):
  --   signatures/employee_<uid>_<ts>.png  only
  if v_folder = 'signatures' then
    if coalesce(is_worker(), false) then
      return p_name ~ ('^signatures/employee_' || v_uid::text || '_[0-9]+\.png$');
    end if;
    return p_name ~ ('^signatures/(proj_[0-9a-f-]{36}_)?' || v_uid::text || '_[0-9]+\.png$');
  end if;
  --   signed-terms/<uid>/<ts>_<name>.pdf   (dacsSnapshotPdf, every signing gate)
  if v_folder = 'signed-terms'  then return v_seg2 = v_uid::text; end if;

  -- Workers and team leaders upload nothing else.
  if coalesce(is_worker(), false) then return false; end if;
  --   procurementReceipts/<project>/…  (client "bought by client" receipt; clients only,
  --   partners are read-only, same as the procurement_client_update table policy)
  if v_folder = 'procurementReceipts' then
    return dacs_try_uuid(v_seg2) is not null and cproj_client_can_read(dacs_try_uuid(v_seg2));
  end if;

  return false;
end $$;

revoke all on function public.uploads_can_read(text, text) from public;
revoke all on function public.uploads_can_write(text) from public;
revoke all on function public.uploads_can_read(text, text) from anon;
revoke all on function public.uploads_can_write(text) from anon;
grant execute on function public.uploads_can_read(text, text) to authenticated;
grant execute on function public.uploads_can_write(text) to authenticated;

-- 0102's overwrite policy; a personal-item receipt is never overwritten (each upload is a new uuid).
drop policy if exists "uploads_admin_update" on storage.objects;
create policy "uploads_admin_update" on storage.objects
  for update to authenticated
  using (bucket_id = 'uploads' and
         case when split_part(name, '/', 1) = 'purchases'
                then pur_buyer() and split_part(name, '/', 2) = data_owner_id()::text
              when split_part(name, '/', 1) = 'pettyCash' then false
              when split_part(name, '/', 1) = 'pmSharing' then false
              when split_part(name, '/', 1) in ('quotations', 'reimbursementReceipts') then is_owner()
              when split_part(name, '/', 1) in ('expenseReceipts', 'payrollReceipts')
                then (is_owner() or is_staff()) and split_part(name, '/', 2) = data_owner_id()::text
              else (is_owner() or is_staff()) end)
  with check (bucket_id = 'uploads' and
         case when split_part(name, '/', 1) = 'purchases'
                then pur_buyer() and split_part(name, '/', 2) = data_owner_id()::text
              when split_part(name, '/', 1) = 'pettyCash' then false
              when split_part(name, '/', 1) = 'pmSharing' then false
              when split_part(name, '/', 1) in ('quotations', 'reimbursementReceipts') then is_owner()
              when split_part(name, '/', 1) in ('expenseReceipts', 'payrollReceipts')
                then (is_owner() or is_staff()) and split_part(name, '/', 2) = data_owner_id()::text
              else (is_owner() or is_staff()) end);
```

Before saving, diff your two rule functions against 0102's (`awk '/create or replace function public.uploads_can_read/,/^end \$\$;/' supabase/migrations/0102_purchase_payments.sql`) — the **only** difference must be the `pmSharing` branch and its comment. If 0102 is no longer the latest definition (`grep -ln "create or replace function public.uploads_can_read" supabase/migrations/*.sql | tail -1`), copy from the latest one instead.

- [ ] **Step 5: Add the SQL behaviour check for `pm_si_file_ok`**

In `supabase/tests/pm_sharing_items.pglite.mjs`, before the final `console.log`, add:

```js
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
```

- [ ] **Step 6: Run everything this task touches**

Run: `node tests/storage-access.test.js && node tests/receipt-storage.test.js && node supabase/tests/pm_sharing_items.pglite.mjs && node supabase/tests/pm_sharing_items_concurrency.mjs`
Expected: all pass (`15 passed` for the PGlite suite).

- [ ] **Step 7: Stop — tell the user which files changed.**

---

### Task 3: The calculation — `PMShare` subtracts items after the split

**Files:**
- Modify: `js/pm-sharing.js` (header comment, new `itemTotals`, `project`, `combine`, exports)
- Test: `tests/pm-sharing.test.js` (new section H, before the runner)

**Interfaces:**
- Consumes: item rows as returned by `pm_sharing_read().items` (`charged_to`, `amount`, `status`).
- Produces:
  - `PMShare.itemTotals(items) → { ownerCents, partnerCents, ownerCount, partnerCount }` (active items only)
  - `PMShare.project({...,items})` result adds `ownerItemsCents`, `partnerItemsCents`, `ownerAfterCents`, `partnerAfterCents`, flag `'items_exceed_share'`
  - `PMShare.combine(...).totals` adds `ownerItemsCents`, `partnerItemsCents`, `ownerAfterCents`, `partnerAfterCents`

- [ ] **Step 1: Write the failing tests**

In `tests/pm-sharing.test.js`, just above `// ── runner ──`, add:

```js
// ══ H. Personal items (0110) — come off one person's share, after the split ══
const item = (who, amount, status = 'active') => ({ charged_to: who, amount, status });
test('H1 worked example: ₱100,000 balance, 50/50, ₱10,000 owner item → owner ₱40,000 / partner ₱50,000', () => {
  const r = P.project({ id: 'H', status: 'completed', bills: [], reqs: [verified(100000)], reserveRow: rec(0, 100000, 0),
                        partnerPct: 50, items: [item('owner', 10000)] });
  eq([r.balanceCents, r.ownerCents, r.partnerCents], [10000000, 5000000, 5000000], 'split unchanged');
  eq([r.ownerItemsCents, r.ownerAfterCents, r.partnerItemsCents, r.partnerAfterCents], [1000000, 4000000, 0, 5000000]);
});
test('H2 an owner item never moves the partner figure, and the other way round', () => {
  const none = P.project({ ...inA, items: [] });
  const own = P.project({ ...inA, items: [item('owner', 5000)] });
  const par = P.project({ ...inA, items: [item('partner', 7000)] });
  eq(own.partnerAfterCents, none.partnerCents, 'owner item');
  eq(par.ownerAfterCents, none.ownerCents, 'partner item');
  eq([own.ownerAfterCents, par.partnerAfterCents], [none.ownerCents - 500000, none.partnerCents - 700000]);
});
test('H3 voided items count ₱0; centavos are exact', () => {
  const r = P.project({ ...inA, items: [item('owner', 0.01), item('owner', 0.02), item('owner', 999, 'voided'),
                                         ...Array.from({ length: 10 }, () => item('partner', 0.1))] });
  eq([r.ownerItemsCents, r.partnerItemsCents], [3, 100]);
  eq(P.itemTotals([item('owner', '12.34'), item('partner', 1.005), item('owner', 5, 'voided'), null, item('both', 9)]),
     { ownerCents: 1234, partnerCents: 101, ownerCount: 1, partnerCount: 1 });
});
test('H4 items bigger than the share → negative after-items figure + items_exceed_share', () => {
  const r = P.project({ ...inA, items: [item('partner', 400000)] });     // partner share ₱304,000
  eq(r.partnerAfterCents, 30400000 - 40000000);
  ok(r.flags.includes('items_exceed_share'), 'flag');
  ok(r.confirmed, 'the flag does not move a project out of the counted group');
  ok(!P.project({ ...inA, items: [item('partner', 1)] }).flags.includes('items_exceed_share'), 'no flag when the share covers it');
  const loss = P.project({ id: 'L', status: 'active', bills: [bill(100000)], reqs: [], reserveRow: null, partnerPct: 50 });
  ok(!loss.flags.includes('items_exceed_share'), 'a loss alone is not this flag');
});
test('H5 balance, reserve, paid, cost and pre-item shares are identical with and without items', () => {
  const a = P.project({ ...inA }), b = P.project({ ...inA, items: [item('owner', 123), item('partner', 456)] });
  for (const k of ['paidCents', 'costCents', 'remainingCents', 'balanceCents', 'ownerCents', 'partnerCents', 'partnerPct'])
    eq(b[k], a[k], k);
  eq(b.reserve, a.reserve, 'reserve');
});
test('H6 no items → after figures equal the shares, item sums 0, no new flag', () => {
  const r = P.project({ ...inA });
  eq([r.ownerItemsCents, r.partnerItemsCents, r.ownerAfterCents, r.partnerAfterCents], [0, 0, r.ownerCents, r.partnerCents]);
  ok(!r.flags.includes('items_exceed_share'), 'no flag');
});
test('H7 combine totals the after-items figures over counted projects only', () => {
  const a = P.project({ ...inA, items: [item('owner', 1000)] });
  const b = P.project({ ...inB, items: [item('partner', 2000)] });
  const review = P.project({ ...inB, id: 'R', reserveRow: null, items: [item('owner', 99999)] });   // not counted
  const t = P.combine([a, b, review]).totals;
  eq([t.ownerItemsCents, t.partnerItemsCents], [100000, 200000]);
  eq([t.ownerAfterCents, t.partnerAfterCents], [t.ownerCents - 100000, t.partnerCents - 200000]);
});
test('H8 pm-sharing.js never names a project-cost or money-model symbol for items', () => {
  const src = read('js/pm-sharing.js');
  const body = src.slice(src.indexOf('function itemTotals('), src.indexOf('function project('));
  ok(body.length > 0, 'SLICE NOT FOUND: itemTotals');
  ok(!/directCost|bills|expenses|Spent|reserve/i.test(body), 'itemTotals must only read items');
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node tests/pm-sharing.test.js`
Expected: H1–H8 FAIL (`P.itemTotals is not a function` / `undefined` fields).

- [ ] **Step 3: Implement**

In `js/pm-sharing.js`:

(a) In the header comment, after the `Owner amount    = balance − partner amount` line, add:
```
     Personal items (0110): an item bought for ONE person comes off only
       that person's amount, after the split — the balance, the reserve and
       the split itself never change:
         Owner after items   = owner amount   − owner's active items
         Partner after items = partner amount − partner's active items
```

(b) Add above `function project(input) {`:
```js
  // Personal items (0110): active items only, per side, in centavos.
  function itemTotals(items) {
    const t = { ownerCents: 0, partnerCents: 0, ownerCount: 0, partnerCount: 0 };
    (items || []).forEach(i => {
      if (!i || i.status !== 'active') return;
      if (i.charged_to === 'owner') { t.ownerCents += toCents(i.amount); t.ownerCount++; }
      else if (i.charged_to === 'partner') { t.partnerCents += toCents(i.amount); t.partnerCount++; }
    });
    return t;
  }
```

(c) In `project(input)`, after `if (reserve.changedSinceCloseout) flags.push('changed_since_closeout');` add:
```js
    const it = itemTotals(input.items);
    const ownerAfterCents = s.ownerCents - it.ownerCents;
    const partnerAfterCents = s.partnerCents - it.partnerCents;
    if ((it.ownerCount && ownerAfterCents < 0) || (it.partnerCount && partnerAfterCents < 0)) flags.push('items_exceed_share');
```
and in its returned object, after `partnerCents: s.partnerCents, ownerCents: s.ownerCents,` add:
```js
      ownerItemsCents: it.ownerCents, partnerItemsCents: it.partnerCents, ownerAfterCents, partnerAfterCents,
```

(d) In `combine`, add to the initial `t` object: `ownerItemsCents: 0, partnerItemsCents: 0, ownerAfterCents: 0, partnerAfterCents: 0,` and inside `confirmed.forEach(r => {`, after `t.ownerCents += r.ownerCents; t.partnerCents += r.partnerCents;` add:
```js
      t.ownerItemsCents += r.ownerItemsCents; t.partnerItemsCents += r.partnerItemsCents;
      t.ownerAfterCents += r.ownerAfterCents; t.partnerAfterCents += r.partnerAfterCents;
```

(e) In `const api = { … }`, add `itemTotals,` after `split,`.

- [ ] **Step 4: Run the tests**

Run: `node tests/pm-sharing.test.js`
Expected: every test passes, including all Release 1 tests (no items → nothing changes).

- [ ] **Step 5: Run the money suite**

Run: `npm test`
Expected: all suites pass.

- [ ] **Step 6: Stop — tell the user which files changed.**

---

### Task 4: `js/pm-sharing-items.js` — the panel, the form, the only `pm_si_*` caller

**Files:**
- Create: `js/pm-sharing-items.js`
- Modify: `admin.html` (form modal markup before the `pmShare…` project modal block's closing area — put it right after the `prQRSettingsModal` block ends; script tag after `pm-sharing-dashboard.js`)
- Create: `tests/pm-sharing-items.test.js`
- Modify: `package.json` (`test`)

**Interfaces:**
- Consumes: `window.PMShare` (`itemTotals`, `toCents`, `pesos`), `window.DacsReceipts` (`compressToBlob`, `receiptPath`, `newId`), `window.sbClient` (`rpc`, `storage`), `window._pmToast(msg, isErr)`, `window.currentUserRole`.
- Produces `window.PMShareItems`:
  - `mount(el, { projectId, items, canEdit, companyId, onChange })` — renders the panel; staff → empty
  - `panelHtml(items, canEdit) → string`
  - `validate(fields, mode, now) → { ok, errors, value }` where `value = { chargedTo, itemName, amount (string as typed, no commas), boughtOn, note|null, reason|null }`
  - `parseAmount(str)`, `todayKey(now)`, `errorText(message)`, `ERRORS`, `newOpId()`
  - `openAdd()`, `openCorrect(id)`, `onReceiptChange()`, `closeForm()`, `submit()`, `voidItem(id)`, `openReceipt(id)`
  - `server.record(op, projectId, value, receiptPath)`, `server.correct(op, item, value, receiptPath)`, `server.void(op, item, reason)`
  - `_state` (tests only)

- [ ] **Step 1: Write the failing tests**

Create `tests/pm-sharing-items.test.js`:

```js
// ════════════════════════════════════════════════════════════════════
// PM SHARING PERSONAL ITEMS — run with: node tests/pm-sharing-items.test.js
// Spec: docs/superpowers/specs/2026-10-31-pm-sharing-personal-items-design.md
// A: pure helpers. B: panel. C: form + server calls (fake sbClient). D: fences.
// Runs the REAL js/pm-sharing-items.js in the pm-admin sandbox.
// ════════════════════════════════════════════════════════════════════
'use strict';
process.env.TZ = 'Asia/Manila';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const { loadPmAdmin } = require('./helpers/pm-admin-sandbox.js');

let passed = 0, failed = 0;
const failures = [];
const queue = [];
function test(name, fn) { queue.push([name, fn]); }
function eq(a, b, label) {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error((label || 'value') + ': expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a));
}
function ok(c, label) { if (!c) throw new Error(label || 'expected truthy'); }

const OWNER = '00000000-0000-0000-0000-00000000000a';
function load(role = 'owner') {
  const sb = loadPmAdmin({ role });
  const calls = [], uploads = [];
  sb.ctx.sbClient = {
    rpc: async (name, args) => { calls.push([name, args]); return sb.ctx.__rpcReply ? sb.ctx.__rpcReply(name, args) : { data: { item: {} }, error: null }; },
    storage: { from: () => ({
      upload: async (p) => { uploads.push(p); return { error: null }; },
      createSignedUrl: async (p) => ({ data: { signedUrl: 'https://signed/' + p }, error: null }),
    }) },
  };
  sb.ctx.DacsReceipts = { newId: () => 'op-' + (calls.length + uploads.length + 1),
    compressToBlob: async () => 'BLOB',
    receiptPath: (kind, owner) => (kind === 'pm_sharing' ? 'pmSharing/' : 'x/') + owner + '/2026-10/11111111-1111-4111-8111-111111111111.jpg' };
  vm.runInContext(read('js/pm-sharing-items.js'), sb.ctx, { filename: 'pm-sharing-items.js' });
  return { sb, S: sb.ctx.PMShareItems, calls, uploads, $: (id) => sb.ctx.document.getElementById(id) };
}
const it = (o = {}) => ({ id: 'i1', project_id: 'A', charged_to: 'owner', item_name: 'Drill', amount: 10000,
  bought_on: '2026-10-01', note: null, receipt_path: null, status: 'active', void_reason: null, version: 1, events: [], ...o });
const NOW = new Date(2026, 9, 31, 7, 30);   // 7:30 AM PH — UTC is still Oct 30
const fill = ($, f) => { for (const [id, v] of Object.entries(f)) $(id).value = v; };

// ══ A. Pure helpers ══════════════════════════════════════════════════
test('A1 todayKey uses local (PH) parts, not UTC', () => {
  eq(load().S.todayKey(NOW), '2026-10-31');
});
test('A2 parseAmount: >0, ≤ 8 digits, ≤ 2 decimals, commas allowed, value kept as typed', () => {
  const { S } = load();
  eq(S.parseAmount('10,000.50'), { ok: true, value: '10000.50' });
  eq(S.parseAmount('0.01'), { ok: true, value: '0.01' });
  for (const bad of ['', '0', '0.00', '-5', 'abc', '100000000', '1e3']) ok(!S.parseAmount(bad).ok, bad);
  eq(S.parseAmount('10.005').error, S.ERRORS.BAD_PRECISION);
});
test('A3 validate: every field rule; reason only required when correcting', () => {
  const { S } = load();
  const good = { chargedTo: 'partner', itemName: '  Phone ', amount: '5000', boughtOn: '2026-10-31', note: ' ', reason: '' };
  const v = S.validate(good, 'record', NOW);
  eq(v.value, { chargedTo: 'partner', itemName: 'Phone', amount: '5000', boughtOn: '2026-10-31', note: null, reason: null });
  ok(!S.validate(good, 'correct', NOW).ok, 'correct needs a reason');
  const bad = S.validate({ chargedTo: '', itemName: '', amount: '0', boughtOn: '2026-11-01', note: 'n'.repeat(501), reason: '' }, 'record', NOW);
  eq(Object.keys(bad.errors).sort(), ['amount', 'boughtOn', 'chargedTo', 'itemName', 'note']);
});
test('A4 errorText maps server codes, passes unknown text through', () => {
  const { S } = load();
  eq(S.errorText('ERROR: ITEM_CHANGED'), 'This item was changed by someone else — reload.');
  eq(S.errorText('OWNER_ONLY'), 'Only the main owner can record personal items.');
  eq(S.errorText('weird'), 'weird');
});

// ══ B. Panel ═════════════════════════════════════════════════════════
test('B1 main owner: totals per person, Add / Correct / Void buttons, voided greyed and ₱0', () => {
  const { S } = load();
  const h = S.panelHtml([it(), it({ id: 'i2', charged_to: 'partner', item_name: 'Phone', amount: 5000 }),
                         it({ id: 'i3', item_name: 'Old', status: 'voided', void_reason: 'mistake' })], true);
  for (const s of ['Personal items', 'You −₱10,000.00', 'Partner −₱5,000.00', 'Add item', 'Drill', 'Phone',
                   "PMShareItems.openCorrect('i1')", "PMShareItems.voidItem('i2')", 'Voided — mistake',
                   'Not a project cost']) ok(h.includes(s), 'missing: ' + s);
  ok(!h.includes("openCorrect('i3')") && !h.includes("voidItem('i3')"), 'no buttons on a voided item');
});
test('B2 other owner-role accounts: list only, no buttons', () => {
  const h = load().S.panelHtml([it()], false);
  ok(h.includes('Drill'), 'list');
  for (const s of ['Add item', 'openCorrect', 'voidItem']) ok(!h.includes(s), 'should hide: ' + s);
});
test('B3 receipt button only when a path is stored; text is escaped', () => {
  const { S } = load();
  ok(S.panelHtml([it({ receipt_path: 'pmSharing/x.jpg' })], false).includes("PMShareItems.openReceipt('i1')"), 'receipt');
  ok(!S.panelHtml([it()], false).includes('openReceipt'), 'no receipt');
  ok(S.panelHtml([it({ item_name: '<b>x</b>' })], false).includes('&lt;b&gt;x&lt;/b&gt;'), 'escaped');
});
test('B4 staff: mount renders nothing', () => {
  const { S, $ } = load('staff');
  const el = $('pmSiPanel'); el.innerHTML = 'SENTINEL';
  S.mount(el, { projectId: 'A', items: [it()], canEdit: true, companyId: OWNER });
  eq(el.innerHTML, '');
});

// ══ C. Form + server calls ═══════════════════════════════════════════
test('C1 add: sends the typed values with a fresh op id, then reloads', async () => {
  const { S, calls, $ } = load();
  let reloaded = 0;
  S.mount($('pmSiPanel'), { projectId: 'A', items: [], canEdit: true, companyId: OWNER, onChange: async () => { reloaded++; } });
  S.openAdd();
  eq($('pmSiModal').style.display, 'flex');
  fill($, { pmSiChargedTo: 'owner', pmSiName: 'Drill', pmSiAmount: '10,000', pmSiDate: '2026-10-01', pmSiNote: '', pmSiReason: '' });
  await S.submit();
  eq(calls.length, 1);
  eq(calls[0][0], 'pm_si_record');
  const a = calls[0][1];
  eq([a.p_project, a.p_charged_to, a.p_item_name, a.p_amount, a.p_bought_on, a.p_note, a.p_receipt_path],
     ['A', 'owner', 'Drill', '10000', '2026-10-01', null, null]);
  ok(typeof a.p_op_id === 'string' && a.p_op_id.length > 0, 'op id');
  eq([reloaded, $('pmSiModal').style.display], [1, 'none']);
});
test('C2 a failed save keeps the form open and the SAME op id is reused on retry', async () => {
  const { sb, S, calls, $ } = load();
  S.mount($('pmSiPanel'), { projectId: 'A', items: [], canEdit: true, companyId: OWNER });
  S.openAdd();
  fill($, { pmSiChargedTo: 'owner', pmSiName: 'Drill', pmSiAmount: '1', pmSiDate: '2026-10-01', pmSiNote: '', pmSiReason: '' });
  sb.ctx.__rpcReply = () => ({ data: null, error: { message: 'network down' } });
  await S.submit();
  eq($('pmSiErr').textContent, 'network down');
  eq($('pmSiModal').style.display, 'flex');
  sb.ctx.__rpcReply = null;
  await S.submit();
  eq(calls[0][1].p_op_id, calls[1][1].p_op_id, 'same op id');
});
test('C3 invalid fields block the save and show field errors', async () => {
  const { S, calls, $ } = load();
  S.mount($('pmSiPanel'), { projectId: 'A', items: [], canEdit: true, companyId: OWNER });
  S.openAdd();
  fill($, { pmSiChargedTo: '', pmSiName: '', pmSiAmount: 'x', pmSiDate: '2026-10-01', pmSiNote: '', pmSiReason: '' });
  await S.submit();
  eq(calls.length, 0);
  ok($('err-pmSiChargedTo').textContent && $('err-pmSiName').textContent && $('err-pmSiAmount').textContent, 'field errors shown');
});
test('C4 receipt: uploaded once to pmSharing/<company>/…, path sent; retry does not upload again', async () => {
  const { sb, S, calls, uploads, $ } = load();
  S.mount($('pmSiPanel'), { projectId: 'A', items: [], canEdit: true, companyId: OWNER });
  S.openAdd();
  fill($, { pmSiChargedTo: 'partner', pmSiName: 'Phone', pmSiAmount: '5000', pmSiDate: '2026-10-01', pmSiNote: '', pmSiReason: '' });
  $('pmSiReceipt').files = [{ name: 'r.jpg' }];
  sb.ctx.__rpcReply = () => ({ data: null, error: { message: 'boom' } });
  await S.submit();
  sb.ctx.__rpcReply = null;
  await S.submit();
  eq(uploads, ['pmSharing/' + OWNER + '/2026-10/11111111-1111-4111-8111-111111111111.jpg']);
  eq(calls[1][1].p_receipt_path, uploads[0]);
});
test('C5 correct: prefilled, needs a reason, sends id + version, keeps the old receipt', async () => {
  const { S, calls, $ } = load();
  S.mount($('pmSiPanel'), { projectId: 'A', items: [it({ receipt_path: 'pmSharing/old.jpg', version: 3 })], canEdit: true, companyId: OWNER });
  S.openCorrect('i1');
  eq([$('pmSiName').value, $('pmSiAmount').value, $('pmSiChargedTo').value, $('pmSiReasonRow').style.display], ['Drill', '10000', 'owner', '']);
  await S.submit();
  eq(calls.length, 0, 'blocked without a reason');
  $('pmSiReason').value = 'wrong amount'; $('pmSiAmount').value = '9000';
  await S.submit();
  const a = calls[0][1];
  eq([calls[0][0], a.p_id, a.p_expected_version, a.p_amount, a.p_receipt_path, a.p_reason],
     ['pm_si_correct', 'i1', 3, '9000', 'pmSharing/old.jpg', 'wrong amount']);
});
test('C6 void: asks for a reason; cancel or blank sends nothing', async () => {
  const { sb, S, calls, $ } = load();
  S.mount($('pmSiPanel'), { projectId: 'A', items: [it({ version: 2 })], canEdit: true, companyId: OWNER });
  sb.ctx.prompt = () => null; await S.voidItem('i1');
  sb.ctx.prompt = () => '   '; await S.voidItem('i1');
  eq(calls.length, 0);
  sb.ctx.prompt = () => 'bought twice'; await S.voidItem('i1');
  eq([calls[0][0], calls[0][1].p_id, calls[0][1].p_expected_version, calls[0][1].p_reason], ['pm_si_void', 'i1', 2, 'bought twice']);
});
test('C7 view-only accounts cannot open the form or void', async () => {
  const { sb, S, calls, $ } = load();
  S.mount($('pmSiPanel'), { projectId: 'A', items: [it()], canEdit: false, companyId: OWNER });
  sb.ctx.prompt = () => 'x';
  S.openAdd(); S.openCorrect('i1'); await S.voidItem('i1');
  ok($('pmSiModal').style.display !== 'flex', 'form stays closed');
  eq(calls.length, 0);
});

// ══ D. Fences ════════════════════════════════════════════════════════
test('D1 only js/pm-sharing-items.js names the pm_si_* functions or item tables', () => {
  const dir = path.join(ROOT, 'js');
  for (const f of fs.readdirSync(dir).filter(n => n.endsWith('.js') && n !== 'pm-sharing-items.js'))
    ok(!/pm_si_|pm_sharing_item/.test(read('js/' + f)), 'js/' + f);
});
test('D2 the money model never names personal items', () => {
  const src = read('js/portal-app.compiled.js');
  for (const fn of ['_projSpent', '_projEarned', '_projMargin', '_recognisedProfit']) {
    const i = src.indexOf('function ' + fn);
    ok(i !== -1, 'SLICE NOT FOUND: ' + fn);
    const body = src.slice(i, src.indexOf('\nfunction ', i + 1));   // _projSpent is a one-liner: stop at the next function
    ok(!/PMShareItems|ItemsCents|AfterCents|pm_si_|personal item/i.test(body), fn);
  }
  const pmShare = read('js/pm-sharing.js');
  const dc = pmShare.slice(pmShare.indexOf('function directCost('), pmShare.indexOf('function split('));
  ok(dc.length > 0 && !/item/i.test(dc), 'PM direct cost never reads items');
});
test('D3 wiring: script tag after pm-sharing.js, modal markup present', () => {
  const html = read('admin.html');
  const a = html.indexOf('js/pm-sharing.js'), b = html.indexOf('js/pm-sharing-items.js');
  ok(b > a && a !== -1, 'script order');
  for (const id of ['pmSiModal', 'pmSiChargedTo', 'pmSiName', 'pmSiAmount', 'pmSiDate', 'pmSiNote', 'pmSiReceipt',
                    'pmSiReasonRow', 'pmSiReason', 'pmSiErr', 'pmSiSaveBtn', 'pmSiTitle'])
    ok(html.includes('id="' + id + '"'), 'missing #' + id);
});

// ── runner ───────────────────────────────────────────────────────────
(async () => {
  console.log('\nPM sharing personal items');
  for (const [name, fn] of queue) {
    try { await fn(); passed++; console.log('  ok  ' + name); }
    catch (e) { failed++; failures.push(name + ' — ' + e.message); console.log('  FAIL ' + name + '\n       ' + e.message); }
  }
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  if (failed) { console.log(failures.join('\n')); process.exit(1); }
})();
```

D2's markers were checked on 2026-10-31: all four are top-level `function _projSpent(` / `_recognisedProfit(` / `_projEarned(` / `_projMargin(` declarations in `js/portal-app.compiled.js` (lines ~357–409). If it reports SLICE NOT FOUND, copy the markers `tests/money-math.test.js` uses. Never delete the check.

- [ ] **Step 2: Run to verify it fails**

Run: `node tests/pm-sharing-items.test.js`
Expected: crash `ENOENT … js/pm-sharing-items.js`.

- [ ] **Step 3: Write the module**

Create `js/pm-sharing-items.js`:

```js
/* ══════════════════════════════════════════════════════════
   PM PROFIT SHARING — PERSONAL ITEMS (window.PMShareItems)
   Spec: docs/superpowers/specs/2026-10-31-pm-sharing-personal-items-design.md

   An item the owner or the partner bought for THEMSELVES out of a PM
   project's money. It lowers only that person's sharing figure, after the
   split — PMShare.project does the sum. OUTSIDE the money model: never a
   bill, expense, Spent, Profit, payout or amount owed.

   The ONLY file that names the pm_si_* server functions
   (tests/pm-sharing-items.test.js fences it). The main owner writes; other
   owner-role accounts read; staff get nothing (no panel, no fetch).
   Receipts: pmSharing/<company>/<yyyy-mm>/<uuid>.jpg, uploaded here and
   opened through a short-lived signed link.
   ══════════════════════════════════════════════════════════ */
(function (root) {
  'use strict';

  const ERRORS = {
    OWNER_ONLY: 'Only the main owner can record personal items.',
    PROJECT_UNMAPPED: 'Project not linked to a company — sharing locked.',
    WRONG_COMPANY: 'This project belongs to another company.',
    BAD_CHARGED_TO: 'Choose who the item is charged to.',
    BAD_NAME: 'Enter the item name (up to 120 characters).',
    BAD_NOTE: 'Keep the note to 500 characters.',
    BAD_REASON: 'Keep the reason to 500 characters.',
    BAD_AMOUNT: 'Enter an amount above ₱0 and below ₱100,000,000.',
    BAD_PRECISION: 'Use at most 2 decimal places.',
    BAD_DATE: 'Enter the date bought — not a future date.',
    BAD_RECEIPT_PATH: 'The receipt photo could not be linked. Choose it again.',
    REASON_REQUIRED: 'Give a reason.',
    ITEM_VOIDED: 'This item was already voided.',
    ITEM_CHANGED: 'This item was changed by someone else — reload.',
    NOT_FOUND: 'This item no longer exists — reload.',
    OP_REUSED: 'This save clashed with an earlier one — close the form and try again.',
    BAD_OP: 'This save clashed with an earlier one — close the form and try again.',
    INACTIVE: 'This account is not active.',
    NOT_SIGNED_IN: 'Sign in again and retry.',
  };
  function errorText(message) {
    const m = String(message || '');
    const key = Object.keys(ERRORS).find(k => m.indexOf(k) !== -1);
    return key ? ERRORS[key] : m;
  }

  const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const P = () => root.PMShare;
  const WHO = { owner: 'You', partner: 'Partner' };

  // ── pure helpers ───────────────────────────────────────────────────
  // Local (PH) date key — never toISOString (UTC lags a day before 8 AM).
  function todayKey(now) {
    const d = now || new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function fmtDay(key) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key || ''));
    if (!m) return String(key || '');
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
      .toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' });
  }
  // The amount is sent AS TYPED (commas removed) so the server refuses 10.005
  // instead of the browser rounding it.
  function parseAmount(str) {
    const s = String(str == null ? '' : str).replace(/,/g, '').trim();
    if (/^\d+\.\d{3,}$/.test(s)) return { ok: false, error: ERRORS.BAD_PRECISION };
    if (!/^\d{1,8}(\.\d{1,2})?$/.test(s) || !(Number(s) > 0)) return { ok: false, error: ERRORS.BAD_AMOUNT };
    return { ok: true, value: s };
  }
  function validate(f, mode, now) {
    const errors = {};
    if (f.chargedTo !== 'owner' && f.chargedTo !== 'partner') errors.chargedTo = ERRORS.BAD_CHARGED_TO;
    const name = String(f.itemName || '').trim();
    if (!name || name.length > 120) errors.itemName = ERRORS.BAD_NAME;
    const a = parseAmount(f.amount);
    if (!a.ok) errors.amount = a.error;
    const day = String(f.boughtOn || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || day > todayKey(now)) errors.boughtOn = ERRORS.BAD_DATE;
    const note = String(f.note || '').trim();
    if (note.length > 500) errors.note = ERRORS.BAD_NOTE;
    const reason = String(f.reason || '').trim();
    if (reason.length > 500) errors.reason = ERRORS.BAD_REASON;
    else if (mode === 'correct' && !reason) errors.reason = ERRORS.REASON_REQUIRED;
    const ok = !Object.keys(errors).length;
    return { ok, errors, value: ok ? { chargedTo: f.chargedTo, itemName: name, amount: a.value, boughtOn: day,
                                       note: note || null, reason: reason || null } : null };
  }
  function newOpId() {
    if (root.DacsReceipts && typeof root.DacsReceipts.newId === 'function') return root.DacsReceipts.newId();
    return root.crypto.randomUUID();
  }

  // ── server calls (the server re-checks everything) ─────────────────
  async function rpc(name, args) {
    const sb = root.sbClient;
    if (!sb || typeof sb.rpc !== 'function') throw new Error('Not connected');
    const { data, error } = await sb.rpc(name, args);
    if (error) throw new Error(error.message || String(error));
    return data;
  }
  const server = {
    record: (op, projectId, v, receiptPath) => rpc('pm_si_record', {
      p_op_id: op, p_project: projectId, p_charged_to: v.chargedTo, p_item_name: v.itemName, p_amount: v.amount,
      p_bought_on: v.boughtOn, p_note: v.note, p_receipt_path: receiptPath || null }),
    correct: (op, item, v, receiptPath) => rpc('pm_si_correct', {
      p_op_id: op, p_id: item.id, p_expected_version: item.version, p_charged_to: v.chargedTo, p_item_name: v.itemName,
      p_amount: v.amount, p_bought_on: v.boughtOn, p_note: v.note, p_receipt_path: receiptPath || null, p_reason: v.reason }),
    void: (op, item, reason) => rpc('pm_si_void', {
      p_op_id: op, p_id: item.id, p_expected_version: item.version, p_reason: String(reason || '').trim() }),
  };
  // No receipt_uploads ledger row: the item row is what holds the path.
  async function uploadReceipt(file, companyId) {
    const R = root.DacsReceipts;
    const blob = await R.compressToBlob(file);
    const path = R.receiptPath('pm_sharing', companyId);
    const { error } = await root.sbClient.storage.from('uploads').upload(path, blob, { upsert: false, contentType: 'image/jpeg' });
    if (error) throw new Error('Couldn\'t upload the photo: ' + (error.message || error));
    return path;
  }

  // ── panel ──────────────────────────────────────────────────────────
  const S = { el: null, projectId: null, items: [], canEdit: false, companyId: null, onChange: null,
              mode: null, item: null, opId: null, receiptPath: null, busy: false };
  const toast = (msg, isErr) => { if (typeof root._pmToast === 'function') root._pmToast(msg, !!isErr); };
  const btn = 'style="font:600 12px \'IBM Plex Sans\';padding:5px 10px;border-radius:8px;border:1px solid #d6dde4;background:#fff;color:#334155;cursor:pointer;"';

  function panelHtml(items, canEdit) {
    const p = P(), list = items || [];
    const t = p.itemTotals(list);
    const rows = list.map(i => {
      const voided = i.status === 'voided';
      const amount = esc(p.pesos(p.toCents(i.amount)));
      return '<div class="pm-si-row" style="display:flex;justify-content:space-between;gap:12px;padding:10px 0;border-top:1px solid #eef0f3;'
        + (voided ? 'opacity:.55;' : '') + '">'
        + '<div style="min-width:0;"><div style="font:600 13px \'IBM Plex Sans\';color:#1f2420;">' + esc(i.item_name) + '</div>'
        + '<div style="font:500 12px \'IBM Plex Sans\';color:#6c6c70;">' + esc(WHO[i.charged_to] || '') + ' · ' + esc(fmtDay(i.bought_on))
        + (i.note ? ' · ' + esc(i.note) : '') + '</div>'
        + (voided ? '<div style="font:600 12px \'IBM Plex Sans\';color:#8f352c;">Voided — ' + esc(i.void_reason) + '</div>' : '')
        + '</div>'
        + '<div style="display:flex;align-items:center;gap:8px;flex-shrink:0;">'
        + '<span style="font:700 13px \'IBM Plex Sans\';">' + (voided ? '<s>' + amount + '</s>' : amount) + '</span>'
        + (i.receipt_path ? '<button type="button" ' + btn + ' onclick="PMShareItems.openReceipt(\'' + esc(i.id) + '\')">Receipt</button>' : '')
        + (canEdit && !voided
            ? '<button type="button" ' + btn + ' onclick="PMShareItems.openCorrect(\'' + esc(i.id) + '\')">Correct</button>'
              + '<button type="button" ' + btn + ' onclick="PMShareItems.voidItem(\'' + esc(i.id) + '\')">Void</button>'
            : '')
        + '</div></div>';
    }).join('');
    return '<div style="background:#fff;border:1px solid #e7e6e2;border-radius:14px;padding:16px 18px;margin-top:16px;">'
      + '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;">'
      + '<div><div style="font:700 14px \'IBM Plex Sans\';color:#1f2420;">Personal items</div>'
      + '<div style="font:500 12px \'IBM Plex Sans\';color:#6c6c70;">Bought for one person — comes off only that person\'s share. Not a project cost.</div>'
      + '<div style="font:600 12.5px \'IBM Plex Sans\';color:#334155;margin-top:4px;">You −' + esc(p.pesos(t.ownerCents))
      + ' · Partner −' + esc(p.pesos(t.partnerCents)) + '</div></div>'
      + (canEdit ? '<button type="button" class="pm-btn pm-btn-primary" onclick="PMShareItems.openAdd()">Add item</button>' : '')
      + '</div>'
      + (rows || '<div style="font:500 12.5px \'IBM Plex Sans\';color:#8794a3;padding-top:10px;">No personal items.</div>')
      + '</div>';
  }
  function mount(el, opts) {
    if (!el) return;
    if (root.currentUserRole !== 'owner') { el.innerHTML = ''; return; }
    Object.assign(S, { el, projectId: opts.projectId, items: opts.items || [], canEdit: !!opts.canEdit,
                       companyId: opts.companyId || null, onChange: opts.onChange || null });
    el.innerHTML = panelHtml(S.items, S.canEdit);
  }

  // ── form (markup in admin.html: #pmSiModal) ────────────────────────
  const $ = (id) => document.getElementById(id);
  const FIELDS = { chargedTo: 'pmSiChargedTo', itemName: 'pmSiName', amount: 'pmSiAmount', boughtOn: 'pmSiDate',
                   note: 'pmSiNote', reason: 'pmSiReason' };
  function showErrors(errors) {
    Object.keys(FIELDS).forEach(k => { const e = $('err-' + FIELDS[k]); if (e) e.textContent = errors[k] || ''; });
  }
  function openForm(mode, item) {
    S.mode = mode; S.item = item || null; S.opId = newOpId(); S.receiptPath = null;
    $('pmSiTitle').textContent = mode === 'correct' ? 'Correct personal item' : 'Add personal item';
    $('pmSiChargedTo').value = item ? item.charged_to : '';
    $('pmSiName').value = item ? item.item_name : '';
    $('pmSiAmount').value = item ? String(Number(item.amount)) : '';
    $('pmSiDate').value = item ? item.bought_on : todayKey();
    $('pmSiNote').value = item && item.note ? item.note : '';
    $('pmSiReason').value = '';
    $('pmSiReceipt').value = '';
    $('pmSiReasonRow').style.display = mode === 'correct' ? '' : 'none';
    $('pmSiErr').textContent = '';
    showErrors({});
    $('pmSiModal').style.display = 'flex';
  }
  function openAdd() { if (S.canEdit) openForm('record', null); }
  function openCorrect(id) {
    const item = S.items.find(x => x.id === id);
    if (S.canEdit && item && item.status === 'active') openForm('correct', item);
  }
  // A new photo was picked: the next save uploads it (a retry reuses the upload).
  function onReceiptChange() { S.receiptPath = null; }
  function closeForm() {
    $('pmSiModal').style.display = 'none';
    S.mode = null; S.item = null; S.opId = null; S.receiptPath = null;
  }
  async function submit() {
    if (S.busy || !S.mode) return;
    const f = {};
    Object.keys(FIELDS).forEach(k => { f[k] = $(FIELDS[k]).value; });
    const v = validate(f, S.mode);
    showErrors(v.errors);
    if (!v.ok) return;
    const mode = S.mode;
    S.busy = true; $('pmSiSaveBtn').disabled = true; $('pmSiErr').textContent = '';
    try {
      const fileEl = $('pmSiReceipt');
      const file = fileEl && fileEl.files && fileEl.files[0];
      if (file && !S.receiptPath) S.receiptPath = await uploadReceipt(file, S.companyId);
      const path = S.receiptPath || (mode === 'correct' ? S.item.receipt_path : null);
      if (mode === 'record') await server.record(S.opId, S.projectId, v.value, path);
      else await server.correct(S.opId, S.item, v.value, path);
      closeForm();
      toast(mode === 'record' ? 'Personal item added' : 'Personal item corrected');
      if (S.onChange) await S.onChange();
    } catch (e) {
      $('pmSiErr').textContent = errorText(e.message);
    } finally {
      S.busy = false; $('pmSiSaveBtn').disabled = false;
    }
  }
  async function voidItem(id) {
    const item = S.items.find(x => x.id === id);
    if (!S.canEdit || S.busy || !item || item.status !== 'active') return;
    const reason = root.prompt('Why are you voiding "' + item.item_name + '"? It will count ₱0 and stay in the history.');
    if (reason == null) return;
    if (!String(reason).trim()) { toast(ERRORS.REASON_REQUIRED, true); return; }
    S.busy = true;
    try {
      await server.void(newOpId(), item, reason);
      toast('Personal item voided');
      if (S.onChange) await S.onChange();
    } catch (e) {
      toast('Void failed: ' + errorText(e.message), true);
    } finally {
      S.busy = false;
    }
  }
  async function openReceipt(id) {
    const item = S.items.find(x => x.id === id);
    if (!item || !item.receipt_path) return;
    const w = root.open('', '_blank');
    const { data, error } = await root.sbClient.storage.from('uploads').createSignedUrl(item.receipt_path, 600);
    if (error || !data) { if (w) w.close(); toast('Could not open the receipt.', true); return; }
    if (w) w.location = data.signedUrl;
  }

  root.PMShareItems = { ERRORS, errorText, todayKey, parseAmount, validate, newOpId, server, panelHtml, mount,
                        openAdd, openCorrect, onReceiptChange, closeForm, submit, voidItem, openReceipt, _state: S };
})(typeof window !== 'undefined' ? window : globalThis);
```

- [ ] **Step 4: Add the modal markup and the script tag**

In `admin.html`, directly after the closing `</div>` of the `prQRSettingsModal` block (the `</div>` that follows its `pm-modal-footer`), add:

```html
<!-- PM → Profit Sharing → Personal items (0110). Owner-role only; js/pm-sharing-items.js drives it. -->
<div id="pmSiModal" class="pm-modal-overlay" style="display:none;" onclick="if(event.target===this)PMShareItems.closeForm()">
    <div class="pm-modal-box">
        <div class="pm-modal-header">
            <div class="pm-modal-htitle">
                <span class="pm-modal-hicon"><i data-lucide="shopping-bag" style="width:16px;height:16px;"></i></span>
                <span id="pmSiTitle">Add personal item</span>
            </div>
            <button class="pm-modal-close" aria-label="Close" onclick="PMShareItems.closeForm()"><i data-lucide="x"></i></button>
        </div>
        <div class="pm-modal-body">
            <p class="pm-modal-intro">Something you or the partner bought for yourselves from this project's money. It comes off only that person's share — it is not a project cost.</p>
            <div class="pm-form-group">
                <label class="pm-field-label" for="pmSiChargedTo">Charged to</label>
                <select id="pmSiChargedTo" class="pm-input">
                    <option value="">Choose…</option>
                    <option value="owner">You (owner)</option>
                    <option value="partner">Partner</option>
                </select>
                <div class="pm-field-err" id="err-pmSiChargedTo"></div>
            </div>
            <div class="pm-form-group">
                <label class="pm-field-label" for="pmSiName">Item</label>
                <input type="text" id="pmSiName" class="pm-input" maxlength="120">
                <div class="pm-field-err" id="err-pmSiName"></div>
            </div>
            <div class="pm-form-group">
                <label class="pm-field-label" for="pmSiAmount">Amount (₱)</label>
                <input type="text" inputmode="decimal" id="pmSiAmount" class="pm-input">
                <div class="pm-field-err" id="err-pmSiAmount"></div>
            </div>
            <div class="pm-form-group">
                <label class="pm-field-label" for="pmSiDate">Date bought</label>
                <input type="date" id="pmSiDate" class="pm-input">
                <div class="pm-field-err" id="err-pmSiDate"></div>
            </div>
            <div class="pm-form-group">
                <label class="pm-field-label" for="pmSiNote">Note (optional)</label>
                <input type="text" id="pmSiNote" class="pm-input" maxlength="500">
                <div class="pm-field-err" id="err-pmSiNote"></div>
            </div>
            <div class="pm-form-group">
                <label class="pm-field-label" for="pmSiReceipt">Receipt photo (optional)</label>
                <input type="file" id="pmSiReceipt" accept="image/*" class="pm-input" onchange="PMShareItems.onReceiptChange()">
            </div>
            <div class="pm-form-group" id="pmSiReasonRow" style="display:none;">
                <label class="pm-field-label" for="pmSiReason">Reason for the correction</label>
                <input type="text" id="pmSiReason" class="pm-input" maxlength="500">
                <div class="pm-field-err" id="err-pmSiReason"></div>
            </div>
            <div class="pm-field-err" id="pmSiErr"></div>
        </div>
        <div class="pm-modal-footer">
            <button class="pm-btn pm-btn-secondary" onclick="PMShareItems.closeForm()">Cancel</button>
            <button id="pmSiSaveBtn" class="pm-btn pm-btn-primary" onclick="PMShareItems.submit()">Save</button>
        </div>
    </div>
</div>
```

and after `<script src="js/pm-sharing-dashboard.js?v=20261019f"></script>` add:
```html
<!-- PM sharing personal items (0110). After pm-sharing.js and receipt-storage.js. -->
<script src="js/pm-sharing-items.js?v=20261031a"></script>
```

- [ ] **Step 5: Add the suite to `npm test`**

In `package.json` `test`, after `&& node tests/pm-sharing.test.js` insert `&& node tests/pm-sharing-items.test.js`.

- [ ] **Step 6: Run**

Run: `node --check js/pm-sharing-items.js && node tests/pm-sharing-items.test.js && npm test`
Expected: `18 passed, 0 failed` for the new suite; `npm test` green.

- [ ] **Step 7: Stop — tell the user which files changed.**

---

### Task 5: Overview, Overview print and Reports show the after-items figures

**Files:**
- Modify: `js/pm-admin.js` — `_pmLoadShareFor` (~line 212), `_pmShareModel` (~231), `_pmShareTexts` (~240), `_pmLoadOverview` (~160), `_pmOvHtml` KPI block (~639), Overview print (~1196), `_pmRptCashReceipt` (~9335), `_pmRptShareCards` (~9362)
- Test: `tests/pm-sharing.test.js` (section I)

**Interfaces:**
- Consumes: `PMShare.project` fields from Task 3; `PMShareItems.mount` / `panelHtml` from Task 4; `read.items` from Task 1.
- Produces: `_pmLoadShareFor` result gains `items: [...]` (this project only). `_pmShareTexts` result gains `itemsNote` (string, '' when none).

- [ ] **Step 1: Write the failing tests**

In `tests/pm-sharing.test.js`, after section H, add:

```js
// ══ I. Personal items on the Overview, its print and Reports (real pm-admin.js) ══
const itemRow = (who, amount, o = {}) => ({ id: 'x' + amount, project_id: 'A', charged_to: who, item_name: 'Thing', amount,
  bought_on: '2026-10-01', status: 'active', version: 1, events: [], ...o });
const shareWith = (pct, row, items) => ({ ...shareOf(pct, row), items });
test('I1 Overview card: split line uses the after-items figures and names the items', () => {
  const { html } = overview('owner', projA, [], [verified(800000)], shareWith(40, rec(40000, 800000, 0), [itemRow('owner', 6000)]));
  for (const s of ['₱760,000.00', 'You ₱450,000.00 (60%, after ₱6,000.00 items)', 'Partner ₱304,000.00 (40%)'])
    ok(html.includes(s), 'missing: ' + s);
});
test('I2 Overview card: items bigger than a share → red "Items exceed share"', () => {
  const { html } = overview('owner', projA, [], [verified(800000)], shareWith(40, rec(40000, 800000, 0), [itemRow('partner', 400000)]));
  ok(html.includes('Partner −₱96,000.00 (40%, after ₱400,000.00 items)'), 'negative partner');
  ok(html.includes('Items exceed share'), 'warning');
});
test('I3 Overview: the items panel holder is drawn for owner-role, never for staff', () => {
  ok(overview('owner', projA, [], [verified(800000)], shareWith(40, rec(40000, 800000, 0), [])).html.includes('id="pmSiPanel"'), 'owner');
  ok(!overview('staff', projA, [], [verified(800000)], shareWith(40, rec(40000, 800000, 0), [])).html.includes('pmSiPanel'), 'staff');
});
test('I4 Overview print: same split line plus the item list (voided marked)', () => {
  const { sb } = overview('owner', projA, [], [verified(800000)],
    shareWith(40, rec(40000, 800000, 0), [itemRow('owner', 6000, { item_name: 'Drill' }), itemRow('partner', 50, { item_name: 'Old', status: 'voided', void_reason: 'dup' })]));
  sb.ctx.pmOvPrintReport();
  const h = sb.printed.join('');
  for (const s of ['You ₱450,000.00 (60%, after ₱6,000.00 items)', 'Personal items', 'Drill', '₱6,000.00', 'Old', 'Voided — dup'])
    ok(h.includes(s), 'print missing: ' + s);
});
test('I5 _pmLoadShareFor keeps only this project\'s items', async () => {
  const sb = loadPmAdmin({ role: 'owner' });
  sb.ctx.PMShare.load = async () => ({ can_edit: true, history: [], partners: [],
    projects: [{ project_id: 'A', partner_pct: 40, is_default: false, version: 1 }],
    items: [itemRow('owner', 1), { ...itemRow('owner', 2), project_id: 'B' }] });
  sb.ctx.WF = { reserveFor: async () => ({}) };
  const s = await sb.ctx._pmLoadShareFor('A');
  eq(s.items.map(i => i.amount), [1]);
});
test('I6 Reports: combined split line uses after-items totals', () => {
  const share = { ...rptShare, read: { ...rptShare.read, items: [{ ...itemRow('owner', 3500), project_id: 'A' }, { ...itemRow('partner', 1500), project_id: 'B' }] } };
  const sb = reports('owner', share);
  sb.ctx._pmRptRenderKPIs([]);
  const h = sb.ctx.document.getElementById('pmRptKpiRow').innerHTML;
  ok(h.includes('You ₱690,000.00 (after ₱3,500.00 items) · Partner ₱540,000.00 (after ₱1,500.00 items)'), h.slice(0, 400));
});
test('I7 no items anywhere → every Release 1 line is unchanged', () => {
  const { html } = overview('owner', projA, [], [verified(800000)], shareWith(40, rec(40000, 800000, 0), []));
  ok(html.includes('You ₱456,000.00 (60%) · Partner ₱304,000.00 (40%)'), 'unchanged line');
  ok(!html.includes('after ') && !html.includes('Items exceed share'), 'no item wording');
});
```

Also make the sandbox load the items module, so the print (I4) and the dashboard page (Task 6, J2) can call `PMShareItems.panelHtml`. In `tests/helpers/pm-admin-sandbox.js`, after the line that runs `js/pm-admin.js`, add:
```js
  // PM sharing personal items (0110): the Overview print and the dashboard page reuse its list.
  vm.runInContext(read('js/pm-sharing-items.js'), ctx, { filename: 'pm-sharing-items.js' });
```
(`tests/pm-sharing-items.test.js` runs the file again in its own `load()` — re-defining `window.PMShareItems` is harmless.)

- [ ] **Step 2: Run to verify they fail**

Run: `node tests/pm-sharing.test.js && node tests/cash-advance.test.js`
Expected: I1–I6 FAIL; I7 passes (or fails only on the holder) — existing tests, and the cash-advance suite that shares the sandbox, still pass.

- [ ] **Step 3: Load items with the share**

In `_pmLoadShareFor`, change the returned object to include items:
```js
        return { partnerPct: Number(row.partner_pct), isDefault: !!row.is_default, version: row.version,
                 canEdit: !!read.can_edit, reserveRow: reserves[projectId] || null,
                 history: (read.history || []).filter(h => h.project_id === projectId),
                 items: (read.items || []).filter(i => i.project_id === projectId) };
```

In `_pmShareModel`, add `items: share.items || [],` after `reserveRow: share.reserveRow, partnerPct: share.partnerPct,`.

- [ ] **Step 4: Change the split line**

In `_pmShareTexts`, add `itemsNote: ''` to the `unavailable` return object, and replace the `splitLine:` property with:
```js
        splitLine: 'You ' + P.pesos(m.ownerAfterCents) + ' (' + P.fmtPct(m.ownerPct) + '%'
                 + (m.ownerItemsCents ? ', after ' + P.pesos(m.ownerItemsCents) + ' items' : '') + ') · Partner '
                 + P.pesos(m.partnerAfterCents) + ' (' + P.fmtPct(m.partnerPct) + '%'
                 + (m.partnerItemsCents ? ', after ' + P.pesos(m.partnerItemsCents) + ' items' : '') + ')',
        itemsNote: m.flags.includes('items_exceed_share') ? 'Items exceed share' : '',
```

- [ ] **Step 5: Show the warning, the holder, and mount the panel**

In `_pmOvHtml`, in the sharing card line, change the subFooter list to include the note in red:
```js
        ${showShare ? card(_ico.trend, shareTx.balanceLabel, shareTx.balanceColor, shareTx.balanceValue, 'pm-ov-kpi-sharing', subFooter([shareTx.splitLine, shareTx.itemsNote ? '<span style="color:#8f352c;font-weight:700;">' + shareTx.itemsNote + '</span>' : '', shareTx.caption, shareTx.floorNote].filter(Boolean).join('<br>')), '#eaf4ef', '#c6e6d5') : ''}
```
Directly after the `</div>` that closes `pm-ov-metricgrid` (the line after the sharing card), add:
```js
      ${showShare ? '<div id="pmSiPanel"></div>' : ''}
```
In `_pmLoadOverview`, after `root.innerHTML = _pmOvHtml(_pmActiveProject, ms, bills, reqs);` add:
```js
        // Personal items panel (0110) — owner-role only; re-runs this load after a save.
        if (_pmCanSeeShare() && share && !share.error && window.PMShareItems) {
            window.PMShareItems.mount(document.getElementById('pmSiPanel'), {
                projectId: pid, items: share.items, canEdit: share.canEdit,
                companyId: window.currentDataUserId, onChange: _pmLoadOverview });
        }
```
(`canEdit` is `pm_sharing_read`'s `can_edit` = main owner; the main owner's own id is the company id.)

- [ ] **Step 6: Overview print — note + item list**

In the print function (the block around line 1196), change the sharing kpi's sub text to
`[shareTx.splitLine, shareTx.itemsNote, shareTx.caption].filter(Boolean).join(' · ')`, and directly after the closing `</div>` of that KPI grid add:
```js
  ${showShare && _pmOvShare && !_pmOvShare.error && (_pmOvShare.items || []).length ? `
  <div style="margin-top:14px;">
    <div style="font:700 12px 'IBM Plex Sans';color:#1f2420;margin-bottom:4px;">Personal items (come off one person's share only)</div>
    ${window.PMShareItems ? window.PMShareItems.panelHtml(_pmOvShare.items, false) : ''}
  </div>` : ''}
```
(`panelHtml(..., false)` has no buttons, so the print has none.)

- [ ] **Step 7: Reports**

In `_pmRptCashReceipt`, in the `P.project({ … })` call add after `partnerPct: Number(rows[p.id].partner_pct),`:
```js
        items: (sh.read.items || []).filter(i => i.project_id === p.id),
```
In `_pmRptShareCards`, replace the `splitLine:` property with:
```js
        splitLine: 'You ' + P.pesos(t.ownerAfterCents) + (t.ownerItemsCents ? ' (after ' + P.pesos(t.ownerItemsCents) + ' items)' : '')
                 + ' · Partner ' + P.pesos(t.partnerAfterCents) + (t.partnerItemsCents ? ' (after ' + P.pesos(t.partnerItemsCents) + ' items)' : ''),
```

- [ ] **Step 8: Run**

Run: `node --check js/pm-admin.js && node tests/pm-sharing.test.js && npm test`
Expected: all pass (Release 1 tests C1–C8 and D1–D7 unchanged).

- [ ] **Step 9: Stop — tell the user which files changed.**

---

### Task 6: Profit Sharing dashboard uses the after-items figures

**Files:**
- Modify: `js/pm-sharing-dashboard.js` — `toResults` (~52), status tables (~140–172), `heroHtml` (~233), `rowHtml` / `tableHtml` (~293–328), `renderDetail` (~433), `toCsv` (~522), `print` (~557)
- Test: `tests/pm-sharing.test.js` (section J)

**Interfaces:**
- Consumes: `d.read.items` (from `PMShare.load(null)` — already in `defaultFetch`'s `read`), `PMShare.project` / `combine` fields from Task 3, `PMShareItems.panelHtml` from Task 4.
- Produces: no new exports. New status key `items_exceed_share` (chip "Items exceed share", tone `loss`).

- [ ] **Step 1: Write the failing tests**

In `tests/pm-sharing.test.js`, after section I, add:

```js
// ══ J. Personal items on the dashboard (real pm-sharing-dashboard.js) ══
const dashWithItems = () => {
  const d = dashData();
  d.read.items = [{ ...itemRow('owner', 6000), project_id: 'A', item_name: 'Drill' },
                  { ...itemRow('partner', 400000), project_id: 'B', item_name: 'Car' }];   // B partner share ₱237,500
  return d;
};
test('J1 hero + table + totals use after-items figures, with the items under them', async () => {
  const sb = loadDash('owner');
  sb.ctx.PMShareDash._setFetch(async () => dashWithItems());
  await sb.ctx.PMShareDash.load();
  const h = pageHtml(sb);
  for (const s of ['₱687,500.00', '₱141,500.00', '₱450,000.00', 'after ₱6,000.00 items', '−₱162,500.00', 'after ₱400,000.00 items',
                   'Items exceed share']) ok(h.includes(s), 'missing: ' + s);
  ok(h.includes('₱1,235,000.00'), 'left to share unchanged');
});
test('J2 detail page: after-items parts + read-only item list + where to change them', async () => {
  const sb = loadDash('owner');
  const D = sb.ctx.PMShareDash;
  D._setFetch(async () => dashWithItems());
  await D.load();
  D.open('A');
  const h = sb.ctx.document.getElementById('pmSharingDetail').innerHTML;
  for (const s of ['Personal items', 'Drill', '₱450,000.00', "Add or correct items on this project's Overview."]) ok(h.includes(s), 'missing: ' + s);
  ok(!h.includes('openCorrect') && !h.includes('Add item'), 'read-only');
});
test('J3 CSV: four item columns per row and in the totals', async () => {
  const sb = loadDash('owner');
  const D = sb.ctx.PMShareDash;
  D._setFetch(async () => dashWithItems());
  await D.load();
  const csv = D.toCsv(D.buildModel(D._state.results, D._state.filters), D.metaLines());
  ok(csv.includes('Your items,Your amount after items,Partner items,Partner amount after items'), 'headers');
  ok(/Alpha,.*,456000,40,304000,6000,450000,0,304000,/.test(csv), 'A row');
  ok(/Totals \(confirmed\),.*,693500,,541500,6000,687500,400000,141500,/.test(csv), 'totals row');
});
test('J4 print: shares after items, by-partner after items', async () => {
  const sb = loadDash('owner');
  const D = sb.ctx.PMShareDash;
  D._setFetch(async () => dashWithItems());
  await D.load();
  D.print();
  const h = sb.printed.join('');
  for (const s of ['₱687,500.00', '₱141,500.00', '₱450,000.00', 'after ₱6,000.00 items', 'Items exceed share']) ok(h.includes(s), 'print missing: ' + s);
});
test('J5 no items → dashboard figures and CSV numbers unchanged', async () => {
  const sb = loadDash('owner');
  const D = sb.ctx.PMShareDash;
  D._setFetch(async () => dashData());
  await D.load();
  const h = pageHtml(sb);
  ok(h.includes('₱693,500.00') && h.includes('₱541,500.00') && !h.includes('after ₱'), 'unchanged');
});
```

Check the dashboard exposes `open` (grep `open:` / `open(` in the `window.PMShareDash = {` export). If the detail opener has another name, use it in J2.

- [ ] **Step 2: Run to verify they fail**

Run: `node tests/pm-sharing.test.js`
Expected: J1–J4 FAIL; J5 and every earlier test pass.

- [ ] **Step 3: Pass items in**

In `toResults`, add after `reserveRow: d.reserves[p.id] || null, partnerPct: Number(rows[p.id].partner_pct),`:
```js
            items: (d.read.items || []).filter(i => i.project_id === p.id),
```

- [ ] **Step 4: Status tables**

- `PRIORITY`: append `'items_exceed_share'` (last — lowest priority).
- `CHIP`: add `items_exceed_share: 'Items exceed share'`.
- `TONE`: add `items_exceed_share: 'loss'`.
- `STATUS_BOX`: add `items_exceed_share: ['Items exceed a share', "One person's personal items are more than their share of this project. Their figure shows as a minus; the other person's share is not touched."],`
- `shortText` switch: add `case 'items_exceed_share': return "Personal items are more than one person's share.";`
- In `print`: add to `TONES` `items_exceed_share: ['#F8E7E4', '#8F352C']`; to `MEAN` `items_exceed_share: "Personal items are more than one person's share; that figure is a minus."`; and add `'items_exceed_share'` to the `legendRows` filter list after `'reserve_review'`.

- [ ] **Step 5: Screen figures**

Add a helper next to `peso`:
```js
    // "after ₱X items" under a share, only when that person has items.
    const itemsSub = (cents) => cents ? '<div class="pms-sub">after ' + peso(cents) + ' items</div>' : '';
```
- `heroHtml`: the two values become `peso(t.ownerAfterCents)` / `peso(t.partnerAfterCents)` (and their `< 0` checks use the same fields); append `itemsSub(t.ownerItemsCents)` / `itemsSub(t.partnerItemsCents)` after each `pms-hero-s` div. `shareSplit(t)` stays on `t.ownerCents` / `t.netCents` (the % is the agreed split, before items).
- `rowHtml`: own / partner cells become `peso(r.ownerAfterCents) + itemsSub(r.ownerItemsCents)` and `peso(r.partnerAfterCents) + itemsSub(r.partnerItemsCents)`; give each cell its own negative class: `(r.ownerAfterCents < 0 ? ' pms-neg' : '')` instead of `neg`.
- `tableHtml` totals: `t.ownerAfterCents` / `t.partnerAfterCents` (+ `itemsSub` of the totals), negative checks on the same fields.
- `renderDetail`: add `const its = (S.data.read.items || []).filter(i => i.project_id === r.id);` next to `const hist = …`. The two `pms-part-v` values become `r.ownerAfterCents` / `r.partnerAfterCents` with `itemsSub(...)` after each; then, after the `</div>` closing `pms-step4`, add:
```js
            +   (its.length
                  ? '<div class="pms-step pms-step--sub"><div></div><div class="pms-step-t">Personal items</div><div></div></div>'
                    + (window.PMShareItems ? window.PMShareItems.panelHtml(its, false) : '')
                    + '<div class="pms-muted">Add or correct items on this project\'s Overview.</div>'
                  : '')
```

- [ ] **Step 6: CSV**

In `toCsv`: append to `cols` after `'Partner amount'`: `'Your items', 'Your amount after items', 'Partner items', 'Partner amount after items'`; in `row`, after `peso(r.partnerCents),` add `peso(r.ownerItemsCents), peso(r.ownerAfterCents), peso(r.partnerItemsCents), peso(r.partnerAfterCents),`; in the totals line after `peso(t.partnerCents),` add `peso(t.ownerItemsCents), peso(t.ownerAfterCents), peso(t.partnerItemsCents), peso(t.partnerAfterCents),`. Then fix G2's expectations only if its regexes depended on the column right after "Partner amount" (they don't: `,456000,` / `,304000,` and the totals regex still match).

- [ ] **Step 7: Print**

In `print`:
- by-partner: `g.cents += r.partnerAfterCents;`
- `shareCell(c, pct, items)`: add an `items` argument and append `(items ? '<div class="grey pct">after ' + esc(p.pesos(items)) + ' items</div>' : '')`; call it with `shareCell(r.ownerAfterCents, r.ownerPct, r.ownerItemsCents) + shareCell(r.partnerAfterCents, r.partnerPct, r.partnerItemsCents)`.
- counted totals row: `t.ownerAfterCents` / `t.partnerAfterCents`.
- top block: the two big values become `t.ownerAfterCents` / `t.partnerAfterCents`, each followed by `(t.ownerItemsCents ? '<div class="grey">after ' + esc(p.pesos(t.ownerItemsCents)) + ' items</div>' : '')` (same for partner).

- [ ] **Step 8: Run**

Run: `node --check js/pm-sharing-dashboard.js && node tests/pm-sharing.test.js && npm test`
Expected: all pass, including F1–F10, G1–G5, P1–P10.

- [ ] **Step 9: Browser check**

Open `admin.html`, log in as the owner, open a PM project's Overview: the "Personal items" panel shows under the KPI cards with **Add item**. Open PM → Profit Sharing: figures unchanged (no items yet). Do **not** save anything on the live DB until Task 8 — 0110 isn't applied, so a save would fail with "function pm_si_record does not exist" (expected right now).

- [ ] **Step 10: Stop — tell the user which files changed.**

---

### Task 7: Docs + full verification

**Files:**
- Modify: `docs/DATABASE_SCHEMA.md` (after the `pm_sharing_changes` row, ~line 1236)
- Modify: `CLAUDE.md` (Money invariants, after the PM profit sharing bullet)
- Modify: `supabase/migrations/README.md` (next-number line)
- Modify: `docs/superpowers/specs/2026-10-18-pm-profit-sharing-mvp-terms.md` (addendum at the end)
- Modify: `docs/ARCHITECTURE.md` §4 module map (one line for `js/pm-sharing-items.js`)

- [ ] **Step 1: Schema doc** — add three rows in the PM sharing table:

```markdown
| `pm_sharing_items` (0110) | `id`, `company_owner_id`, `project_id` (**plain value, no FK**), `charged_to` `owner`/`partner`, `item_name` 1-120, `amount numeric(14,2)` > 0 and < 100,000,000, `bought_on` (not future, PH date), `note` <= 500, `receipt_path` (`pmSharing/<company>/<yyyy-mm>/<uuid>.jpg`), `status` `active`/`voided`, `void_reason` (set iff voided), `version`, `created_*`, `updated_*`. Personal item bought for ONE person: comes off only that person's sharing figure, after the split. **Outside the money model.** Never deleted. Private: read via `pm_sharing_read().items`, written via `pm_si_record` / `pm_si_correct` / `pm_si_void` (main owner only) |
| `pm_sharing_item_events` (0110) | Append-only (`HISTORY_IMMUTABLE` trigger): `item_id`, `company_owner_id`, `kind` recorded/corrected/voided, `old_values`, `new_values`, `reason`, `actor_id`, `actor_email`, `at` |
| `pm_sharing_item_ops` (0110) | Run-once ledger: `op_id` PK, `company_owner_id`, `action` record/correct/void, `result`, `actor_id`, `at` |
```

- [ ] **Step 2: CLAUDE.md** — after the "PM profit sharing (0098)" bullet add:

```markdown
- **PM sharing personal items (0110) come off one person's share, after the split.** An item the owner or
  partner bought for themselves: `ownerAfterCents = ownerCents − owner items`, same for the partner. It never
  changes the sharing balance, the reserve or the split, and is **never** a bill, expense, Spent, Profit, payout
  or amount owed. Main owner writes (`pm_si_*`, only from `js/pm-sharing-items.js`); owner-role reads; staff
  nothing. Corrected or voided with a reason, never deleted. Receipts in owner-only `pmSharing/`.
  Spec: `docs/superpowers/specs/2026-10-31-pm-sharing-personal-items-design.md`.
```

- [ ] **Step 3: Migrations README** — update the next-number line to **0111** (highest on disk `0110_pm_sharing_items.sql`), keeping the note that 0109 belongs to Stage 4 if it is still not on disk.

- [ ] **Step 4: Release 1 spec addendum** — append:

```markdown
## Addendum 2026-10-31 — Personal items

Personal items (0110) extend this calculation after the split; see
`2026-10-31-pm-sharing-personal-items-design.md`. Nothing in §5's balance, reserve or split changes.
```

- [ ] **Step 5: Architecture map** — in `docs/ARCHITECTURE.md` §4, next to `pm-sharing.js`, add: `js/pm-sharing-items.js — PM sharing personal items panel/form; the only pm_si_* caller (0110).`

- [ ] **Step 6: Full verification**

Run: `npm test && npm run test:sql`
Expected: every suite green. Then `node --check` each changed JS file. Report the pass counts to the user.

- [ ] **Step 7: Stop — tell the user which files changed.**

---

### Task 8: Apply 0110 and live acceptance (user-gated)

**Files:**
- Create: `supabase/tests/pm_sharing_items_acceptance.sql`

- [ ] **Step 0: Pre-apply drift check** (0110 restates `uploads_can_read`, `uploads_can_write` and policy `uploads_admin_update` wholesale; live has drifted before)

1. Run `node supabase/tests/pm_sharing_items_preapply.mjs` — it prints the md5 the live function bodies should have if live still matches 0102.
2. Run `supabase/tests/pm_sharing_items_preapply.sql` (read-only) through the Supabase MCP `execute_sql`.
3. Compare: both md5 rows must equal the .mjs output; the four helpers (`pur_petty_reader`, `pm_main_owner_id`, `pm_owner_company`, `dacs_try_uuid`) must say `true`; `pm_sharing_items absent` must say `true`; read the `uploads_admin_update` `qual` / `with_check` and confirm the six known folder branches (purchases, pettyCash, quotations/reimbursementReceipts, expenseReceipts/payrollReceipts, else) are all there.
4. On ANY difference **stop and report** — do not ask the user to apply 0110 until the drift is understood and 0110's restatement is reconciled with live.

- [ ] **Step 1: The read-only acceptance script**

`supabase/tests/pm_sharing_items_acceptance.sql` is already written (tables, RLS, privileges of the write functions, every helper hidden from `authenticated`, the events sequence, `pm_si_file_ok`, trigger, `pm_sharing_read` items, storage rules, overwrite policy, starts empty). It is run in Step 3 after the apply.

- [ ] **Step 2: Ask the user to apply 0110**

Tell the user: "Apply `supabase/migrations/0110_pm_sharing_items.sql` (through your usual migration path, not SQL-editor one-offs). Tell me when it's done." **Wait.**

- [ ] **Step 3: Verify it really is live**

Run the acceptance script through the Supabase MCP `execute_sql` (not the SQL editor — its RLS step breaks some scripts). Every row must be `ok = true`. If any is false, stop and report — the user's "done" has not matched the live DB before.

- [ ] **Step 4: Browser pilot (main owner) on a real project, ZZ-marked**

With the user watching, on one PM project:
1. Add item: You, `ZZ test drill`, ₱10.00, today, with a receipt photo → panel shows it; Sharing card split line shows "after ₱10.00 items"; open **Receipt** works.
2. Correct it to Partner, ₱12.00, reason `ZZ test` → the owner line goes back, the partner line shows "after ₱12.00 items".
3. Void it, reason `ZZ test` → greyed "Voided — ZZ test", lines back to Release 1 wording.
4. Log in as admin-pm@: list visible, no buttons. Log in as a staff account: no panel, no sharing cards.
5. Profit Sharing dashboard + its print + CSV (if the pilot project is completed): no change from the voided item.

- [ ] **Step 5: Clean up the ZZ pilot — only with the user's OK**

Items are never deleted by the app, and the history is append-only. Ask the user whether to leave the voided ZZ item (it counts ₱0) or remove it. If they want it removed, show them **exactly** which rows the filter matches first (`select id, item_name, project_id from pm_sharing_items where item_name like 'ZZ %'`) and delete only after they confirm, in one transaction that disables `pm_si_events_immutable_trg` around the event delete and re-enables it; also delete the `pm_sharing_item_ops` rows whose `result` contains the ZZ item id (`where result::text like '%<zz item id>%'`); delete the ZZ receipt file from storage too.

- [ ] **Step 6: Report** — what passed, what was cleaned, and the files to commit. The user commits and pushes.

---

## Self-review notes

- Spec §2 D1–D8 → Tasks 1 (D4, D8, server), 3 (D1, D7), 4 (D5, D8 UI), 5/6 (D6 display).
- Spec §4.6 receipts → Task 2. Spec §6.2 table → Tasks 5 and 6. Spec §7.1–7.4 → Tasks 3, 4 (fences), 1/2 (server), 8 (live).
- Plan refinements vs the spec (spec updated to match): receipt path is `pmSharing/<company>/<yyyy-mm>/` (re-uses `DacsReceipts.receiptPath`; project is not in the path); the not-main-owner error is 0098's `OWNER_ONLY`; the dashboard shows items as an "after ₱X items" line under each share instead of a separate column; the dashboard project page tells the user to correct items on the Overview instead of linking there.
