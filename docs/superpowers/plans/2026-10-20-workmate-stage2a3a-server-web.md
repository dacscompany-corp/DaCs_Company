# WorkMate Stage 2A-3a — Phone purchasing: server, sign-in and Dacs Web — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Everything WorkMate 0.7.0 (plan 2A-3b) needs from the server and the sign-in, plus the Dacs Web fixes from the 20 October clean-up: migration **0101**, the `attendance-signin` buyer path, and the Purchases list / Record again / "Waiting for the owner" screens.

**Architecture:** One migration adds four small readers (`pur_signin_can_buy`, `pur_my_purchases`, `pur_destinations`, `pur_my_pending_changes`), lets the server make an Additional Works job's hidden billing period itself, and requires a receipt photo or a reason on PHONE purchases. Every other function and the money rules stay as 0096/0097 wrote them; `tests/purchasing-phone-server.test.js` proves that line by line. The sign-in decision moves into a plain-JS module the Edge Function imports and Node tests; the old Attendance app's answers do not change. The web changes are display and flow only; the server still decides everything.

**Tech Stack:** PostgreSQL / Supabase (plpgsql), Supabase Edge Function (Deno, `supabase-js@2`), vanilla JS (no build step), Node test files with no dependencies, PGlite + embedded-postgres for `npm run test:sql`.

**Spec:** [Mobile Purchasing](../specs/2026-09-30-workmate-mobile-purchasing-design.md) · answers: [2A-3 questions](../specs/2026-10-20-workmate-stage2a3-questions.md) (Q1–Q22 = A; Q23 pending for 2A-3b) · rulings R1–R8: [2A-3 roadmap](2026-10-20-workmate-stage2a3-roadmap.md) (approved 20 Oct) · before: [2A-2 plan, as built](2026-10-16-workmate-stage2a2-purchasing-office.md)

**Status:** Revision 1, 20 October 2026, **for the user's review**. Nothing is applied live and nothing is in the repo yet. The code below was built and tested first in a scratch clone (one commit per task, `npm test` green after each task, `npm run test:sql` all 13 suites green). This text was then re-applied to a fresh clone of `main` at 4fc97ec, and the result was byte-identical to the tested build (rehearsal: see the end).

## Global Constraints

- **Never run `npm run build`.** `js/portal-app.compiled.js` is the live source and is edited directly (CLAUDE.md).
- **A new data field needs a real DB column.** This plan's one new column is `purchases.no_receipt_reason`, in migration 0101.
- **Migrations:** next number = highest + 1 = **0101** (highest on disk: `0100_pm_cash_advances.sql`). Never SQL-editor changes. The user applies the file; we then verify the live database ourselves (memory: the user's "done apply" has not always matched the live DB).
- **Money invariants hold unchanged:** Cover is a subset of Spent, never a fourth bucket. Petty cash, refunds and credits stay outside Spent. Only a recorded purchase adds to Spent, once, through the shared recording operation. **0101 changes no Spent figure** (Task 1 proves it two ways). Run `npm test` after every task: it touches money code (`expenses-module.js`, `portal-app.compiled.js`).
- **Staff see no peso amounts** outside the two approved exceptions: Buyer staff inside Purchasing screens, and Project Control's Add/Edit forms and Materials/Labor lists. The new "Waiting for the owner" pill and the Withdraw prompt carry no amount.
- **Dates:** never `toISOString().slice(0,10)` for a local date. The server uses `(now() at time zone 'Asia/Manila')::date`.
- **Old Attendance app untouched (R1):** with no `x-dacs-app` header, `attendance-signin` answers every account exactly as before.
- **The user commits.** Executors never run `git commit` or `git push`. Each task ends at a "stop for the user" step.
- **CRLF files:** `supabase/migrations/README.md` and `docs/DATABASE_SCHEMA.md` use CRLF line endings in the repo. Change them with the Edit tool and keep CRLF. Every other file in this plan is LF.

## Rulings

**R1–R8:** approved in the [roadmap](2026-10-20-workmate-stage2a3-roadmap.md) on 20 October 2026, and built exactly as written there.

These came up while building and testing. **R9 changes behaviour; the user approved it on 20 October 2026.** The rest follow from rules already agreed.

- **R9 — A refusal revokes only the session it just made.** *Approved by the user, 20 October 2026.* Today `attendance-signin` revokes a refused account's sessions **globally** (`signOut(token, "global")`). An office person who tried a phone app was therefore also signed out of Dacs Web. From now on, a refusal (`NOT_A_WORKER`, `NO_WORKMATE_ACCESS`, a server error) revokes only the session this sign-in minted (`"local"`). A **deactivated** account (`ACCOUNT_INACTIVE`) still loses every session (`"global"`). The answer codes the old app sees do not change.
  - Supabase's sign-out scopes: `local` revokes the current session; `global` revokes every session of the account.
  - The access token minted for a refused sign-in stays valid until it expires, as with any Supabase sign-out. It is **never returned to the caller**: a refusal answers `{ error }` only. So nobody holds it.
- **R10 — The sign-in rule is a `.mjs` file beside the function.** CI runs Node 20, which cannot load TypeScript and reads a `.js` file with `export` as CommonJS. `eligibility.mjs` loads in both Deno and Node 20. The repo's `.gitignore` ignores every file type not listed; until this plan it listed `.mjs` only for `supabase/tests/`. **Without Task 2's `.gitignore` line, the file would silently not be committed, and the deployed function would fail to load.**
- **R11 — `pur_my_pending_changes()` (Q16).** Project Control rows know their purchase **line**, while a change request is keyed by **purchase**. Staff without the Buyer switch read no purchase rows (0097, R3). So the server returns the caller's own pending requests with their purchase's line and charge **ids**, plus the kind, reason and time. No amounts.
- **R12 — Record again drops the weekly picks, and is hidden on a replaced purchase (R7).** Copied picks would point at portions that may have been bought since. Without picks the server covers in its usual order (own portions, then unassigned), so nothing is covered twice. A purchase voided because a correction **replaced** it (`replaced_by` set) already has its newer version. Record again would double the cost, so it is not offered there.
- **R13 — One 2A-2 test changes.** Its phone purchase had no receipt. Under Q8 it is refused `NO_RECEIPT`, which is the new rule working. The test now gives it a receipt photo and still checks what it was written for: phone purchases need the Buyer switch.
- **R14 — Project Control's delete keeps its own dialog (R6).** When the row's purchase has a change waiting for the owner, it now offers Withdraw first (Q16). Changing the purchase meanwhile would make that request out of date.
- **R15 — The AW period lock.** Every purchase write already holds the job's `pur_folder:` advisory lock (`pur_lock`). `pur_fund` takes the same lock again, which is a no-op when it is already held, so its one-period guarantee does not depend on its callers. The race test therefore cannot fail by removing only that line; that is expected.

## File structure

| File | Task | What |
|---|---|---|
| `supabase/migrations/0101_purchasing_phone.sql` | 1 | **New.** The migration |
| `supabase/tests/2a3_server.pglite.mjs` | 1 | **New.** 23 behaviour tests on PGlite (0096 + 0097 + 0101 verbatim) |
| `supabase/tests/2a3_concurrency.mjs` | 1 | **New.** 2 two-session races on a throwaway PostgreSQL |
| `supabase/tests/2a3_acceptance.sql` | 1 | **New.** Live acceptance, rolls itself back |
| `tests/purchasing-phone-server.test.js` | 1 | **New.** Static fences: Spent untouched, grants, no amounts |
| `supabase/tests/2a1_purchase.pglite.mjs`, `2a2_purchasing.pglite.mjs` | 1 | `--with-0101` re-runs (and R13) |
| `package.json` | 1, 2 | New suites in `test:sql` and `test` |
| `supabase/migrations/README.md`, `docs/DATABASE_SCHEMA.md` | 1 | Docs (CRLF) |
| `supabase/functions/attendance-signin/eligibility.mjs` | 2 | **New.** Who may sign in (pure) |
| `supabase/functions/attendance-signin/index.ts` | 2 | Uses it; asks `pur_signin_can_buy` |
| `tests/signin-eligibility.test.js` | 2 | **New.** 10 tests (old app unchanged for every role) |
| `.gitignore` | 2 | Allows `supabase/functions/*/*.mjs` (R10) |
| `js/purchasing-admin-core.js` | 3 | Source labels, search, void word, Record again state, `chargesOf` |
| `js/purchasing-admin-purchases.js` | 3 | Purchases list (Source, project filter, search), typed void, No receipt, Record again, typed approval of a void |
| `js/purchasing-admin-record.js` | 3 | Record again form |
| `js/expenses-module.js` | 3 | "Waiting for the owner" + Withdraw (Q16) |
| `js/portal-app.compiled.js` | 3 | The same pill in Project Control's Materials list |
| `admin.html` | 3 | Cache-busters `?v=20261020a` |
| `tests/purchasing-admin.test.js` | 3 | 11 new tests |

---

### Task 1: Migration 0101 and its tests

**Files:**
- Create: `supabase/migrations/0101_purchasing_phone.sql`, `supabase/tests/2a3_server.pglite.mjs`, `supabase/tests/2a3_concurrency.mjs`, `supabase/tests/2a3_acceptance.sql`, `tests/purchasing-phone-server.test.js`
- Modify: `supabase/tests/2a1_purchase.pglite.mjs`, `supabase/tests/2a2_purchasing.pglite.mjs`, `package.json`, `supabase/migrations/README.md` (CRLF), `docs/DATABASE_SCHEMA.md` (CRLF)

**Interfaces:**
- Consumes: 0096/0097 as live (`pur_can_buy`, `pur_buyer`, `pur_actor_owner`, `pur_doc`, `pur_store`, `pur_charge_rows`, `pur_lock`, `pur_person_name`, `pr_line_bought`, `purchase_change_requests`, …).
- Produces (Task 2 and plan 2A-3b rely on these exact names):
  - `pur_signin_can_buy(p_user uuid) returns boolean`: service role only.
  - `pur_my_purchases(p_days int default 60) returns jsonb`: array of `pur_list_doc` rows; buyers only; `BAD_DAYS` outside 1–366.
  - `pur_destinations() returns jsonb`: `[{folder_id, name, works: [{folder_id, name}]}]`; buyers only.
  - `pur_my_pending_changes() returns jsonb`: `[{id, purchase_id, kind, reason, requested_at, line_ids[], charge_ids[]}]`; any account that may record.
  - `pur_list_doc(p_purchase uuid) returns jsonb`: 0097's list row + `no_receipt_reason`, `replaced_by`. Internal.
  - `purchases.no_receipt_reason text not null default ''` (≤ 300), body key `no_receipt_reason`; refusal codes `NO_RECEIPT`, `BAD_REASON`.
  - `pur_purchases(...)` and `pur_purchase(...)` rows now include `no_receipt_reason`.

- [ ] **Step 1: Write the behaviour tests**

Create `supabase/tests/2a3_server.pglite.mjs`:

````js
// ════════════════════════════════════════════════════════════════════
// STAGE 2A-3a PHONE PURCHASING SERVER — BEHAVIOUR TESTS ON PGLITE
//   npm run test:sql
//
// Runs migrations 0096, 0097 and 0101 VERBATIM on PGlite (PostgreSQL in
// memory) over the same minimal tables as the 2A-2 suite (pr_base.mjs).
// Nothing here talks to the live database; supabase/tests/2a3_acceptance.sql
// repeats the key cases there, rolled back.
// ════════════════════════════════════════════════════════════════════
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { prBase, fnText } from './pr_base.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.DACS_ROOT || path.join(HERE, '..', '..');
const read = (p) => fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const M02 = read(path.join(ROOT, 'supabase/migrations/0002_rls.sql'));
const M94 = read(path.join(ROOT, 'supabase/migrations/0094_workmate_work_plan_office.sql'));
const M96 = read(path.join(ROOT, 'supabase/migrations/0096_purchase_recording.sql'));
const M97 = read(path.join(ROOT, 'supabase/migrations/0097_purchasing_office.sql'));
const M101 = read(path.join(ROOT, 'supabase/migrations/0101_purchasing_phone.sql'));

// The 2A-1 base schema (same as 2a1_purchase.pglite.mjs), plus the service
// role the sign-in function runs as.
const BASE = `
create role anon; create role authenticated; create role service_role;
create schema auth;
create function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
create table profiles (id uuid primary key, role text, owner_id uuid, status text, allowed_modules jsonb);
create table folders (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null, name text not null,
  parent_folder_id uuid references folders(id) on delete cascade, completed_at timestamptz,
  created_at timestamptz default now(), updated_at timestamptz default now());
create table projects (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null, folder_id uuid references folders(id) on delete cascade,
  month text, year int, funding_type text, billing_number int,
  created_at timestamptz default now(), updated_at timestamptz default now());
create table project_budgets (project_id uuid primary key references projects(id) on delete cascade, owner_id uuid not null,
  monthly_budget numeric not null default 0);
create table expenses (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null, project_id uuid references projects(id) on delete cascade,
  expense_name text, category text, quantity numeric, amount numeric, date_time text, notes text, payment_method text,
  po_image_url text, delivery_receipt_url text, supplier_invoice_url text, payment_receipt_url text,
  in_inventory boolean default false, cover_expense boolean default false,
  split_group text, split_index int, split_total int, client_submission_id uuid,
  created_at timestamptz default now(), updated_at timestamptz default now());
create table payroll (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null, project_id uuid references projects(id) on delete cascade,
  total_salary numeric, cover_expense boolean default false);
create table inventory (
  id uuid primary key default gen_random_uuid(), legacy_id text unique, owner_id uuid, item_name text, unit text,
  current_stock numeric, min_stock numeric, notes text, last_updated timestamptz, last_adjusted_by uuid,
  created_at timestamptz default now());
${fnText(M02, 'auth_role')}
${fnText(M02, 'is_owner')}
${fnText(M02, 'is_staff')}
${fnText(M02, 'data_owner_id')}
${fnText(M02, 'can_access')}
${fnText(M94, 'pr_is_office')}
`;

const OWNER = '00000000-0000-0000-0000-00000000000a';
const STAFF = '00000000-0000-0000-0000-00000000000b';   // Expenses, no Buyer switch
const BUYER = '00000000-0000-0000-0000-000000000011';
const BUYER2 = '00000000-0000-0000-0000-000000000012';
const WORKER = '00000000-0000-0000-0000-00000000000c';
const LEADER = '00000000-0000-0000-0000-000000000015';
const OTHER = '00000000-0000-0000-0000-00000000000d';    // another company's owner
const PMOWNER = '00000000-0000-0000-0000-000000000013';  // owner-role account focused on PM
const EXPOWNER = '00000000-0000-0000-0000-000000000014'; // owner-role account with PM + Expenses (own scope)
const GONE = '00000000-0000-0000-0000-000000000016';     // inactive Buyer staff
const ORPHAN = '00000000-0000-0000-0000-000000000017';   // staff with no owner_id
const NOBODY = '00000000-0000-0000-0000-0000000000ff';   // no profile row
const RECEIPT = 'https://example.supabase.co/storage/v1/object/public/uploads/purchases/' + OWNER +
                '/2026-10/11111111-1111-1111-1111-111111111111.jpg';
let opSeq = 0;
const op = () => '30000000-0000-0000-0000-' + String(++opSeq).padStart(12, '0');

let passed = 0, failed = 0;
const failures = [];
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { failed++; failures.push(name + ' — ' + e.message); console.log('  FAIL ' + name + '\n       ' + e.message); }
}
function assert(c, m) { if (!c) throw new Error(m); }
function eq(a, b, m) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error((m || 'not equal') + ': ' + JSON.stringify(a) + ' !== ' + JSON.stringify(b)); }
const num = (x) => Number(x);

// A Philippine calendar date, `days` from today (UTC+8 has no daylight time,
// so shifting by 8 hours before reading the UTC date gives the local date).
function phDate(days = 0) {
  return new Date(Date.now() + 8 * 3600e3 + days * 86400e3).toISOString().slice(0, 10);
}
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
                'September', 'October', 'November', 'December'];

async function fresh() {
  const db = new PGlite();
  await db.exec(BASE);
  await db.exec(M96);
  await db.exec(prBase(ROOT));
  await db.exec(M97);
  await db.exec(M101);
  await db.exec(`insert into profiles (id, role, owner_id, status, allowed_modules, email, display_name) values
    ('${OWNER}', 'owner', null, 'active', null, 'admin@dacs.test', null),
    ('${STAFF}', 'staff', '${OWNER}', 'active', null, 'staff@dacs.test', null),
    ('${BUYER}', 'staff', '${OWNER}', 'active', null, 'juan@dacs.test', 'Juan'),
    ('${BUYER2}', 'staff', '${OWNER}', 'active', null, 'pedro@dacs.test', 'Pedro'),
    ('${WORKER}', 'worker', '${OWNER}', 'active', null, null, 'Mark'),
    ('${LEADER}', 'teamLeader', '${OWNER}', 'active', null, null, 'Lito'),
    ('${OTHER}', 'owner', null, 'active', null, 'other@x.test', null),
    ('${PMOWNER}', 'owner', '${OWNER}', 'active', '["pm"]'::jsonb, 'admin-pm@dacs.test', null),
    ('${EXPOWNER}', 'owner', '${OWNER}', 'active', '["pm", "expenses"]'::jsonb, 'admin-exp@dacs.test', null),
    ('${GONE}', 'staff', '${OWNER}', 'active', null, 'gone@dacs.test', 'Gone'),
    ('${ORPHAN}', 'staff', null, 'active', null, 'orphan@dacs.test', 'Orphan');`);
  await as(db, OWNER);
  await db.query(`select pur_set_buyer($1, true)`, [BUYER]);
  await db.query(`select pur_set_buyer($1, true)`, [BUYER2]);
  await db.query(`select pur_set_buyer($1, true)`, [GONE]);
  await db.query(`update profiles set status = 'inactive' where id = $1`, [GONE]);
  return db;
}
async function as(db, uid) { await db.exec(`select set_config('test.uid', '${uid}', false)`); }
async function one(db, sql, params = []) { return (await db.query(sql, params)).rows[0]; }
async function all(db, sql, params = []) { return (await db.query(sql, params)).rows; }
async function code(promise) {
  try { await promise; return 'no error'; } catch (e) { return e.message; }
}

async function folder(db, name, opts = {}) {
  return (await one(db, `insert into folders (owner_id, name, parent_folder_id, completed_at) values ($1, $2, $3, $4) returning id`,
    [opts.owner || OWNER, name, opts.parent || null, opts.completed ? new Date().toISOString() : null])).id;
}
async function period(db, folderId, budget = 100000, date = phDate(), owner = OWNER) {
  const d = new Date(date + 'T00:00:00Z');
  const id = (await one(db, `insert into projects (owner_id, folder_id, month, year, funding_type, billing_number)
                              values ($1, $2, $3, $4, 'progress', 1) returning id`,
    [owner, folderId, MONTHS[d.getUTCMonth()], d.getUTCFullYear()])).id;
  await db.query(`insert into project_budgets values ($1, $2, $3)`, [id, owner, budget]);
  return id;
}
function body(lines, extra = {}) {
  const total = extra.receipt_total ?? lines.reduce((s, l) => s + l.amount, 0);
  return { source: 'workmate', purchase_date: phDate(), supplier: 'Wilcon', notes: '', payment_method: 'CASH',
           docs: { po_image_url: RECEIPT }, ...extra, receipt_total: Math.round(total * 100) / 100,
           lines: lines.map(l => ({ destination: 'project', category: 'Materials', unit: 'bag', unplanned_reason: 'site ran out', ...l })) };
}
async function record(db, b, opId = op()) {
  return (await one(db, `select pur_record($1, $2::jsonb) as r`, [opId, JSON.stringify(b)])).r;
}
async function spent(db, folderId) {
  return num((await one(db, `select coalesce(sum(e.amount), 0) s from expenses e join projects p on p.id = e.project_id where p.folder_id = $1`, [folderId])).s);
}
async function periodsOf(db, folderId) {
  return all(db, `select p.id, p.month, p.year, p.funding_type,
                         exists (select 1 from project_budgets b where b.project_id = p.id) as has_budget
                    from projects p where p.folder_id = $1 order by p.created_at, p.id`, [folderId]);
}

console.log('\n2A-3a phone purchasing server (0096 + 0097 + 0101 on PGlite)');

// ── A. Signing a buyer in (Q1, R1, R3) ──────────────────────────────

await test('pur_signin_can_buy gives every account the same answer pur_buyer() gives it signed in', async () => {
  const db = await fresh();
  const people = { OWNER, STAFF, BUYER, BUYER2, WORKER, LEADER, OTHER, PMOWNER, EXPOWNER, GONE, ORPHAN };
  const want = { OWNER: true, STAFF: false, BUYER: true, BUYER2: true, WORKER: false, LEADER: false, OTHER: true,
                 PMOWNER: false, EXPOWNER: true, GONE: false, ORPHAN: false };
  for (const [name, id] of Object.entries(people)) {
    await as(db, id);
    const signedIn = (await one(db, `select pur_buyer() b`)).b;
    await as(db, '');
    const atSignIn = (await one(db, `select pur_signin_can_buy($1) b`, [id])).b;
    eq([name, atSignIn], [name, signedIn], 'same answer as pur_buyer()');
    eq([name, atSignIn], [name, want[name]], 'expected answer');
  }
  eq((await one(db, `select pur_signin_can_buy($1) b`, [NOBODY])).b, false, 'no profile row');
  eq((await one(db, `select pur_signin_can_buy(null) b`)).b, false, 'no id');
});

await test('turning the Buyer switch off (or deactivating) changes the sign-in answer at once', async () => {
  const db = await fresh();
  eq((await one(db, `select pur_signin_can_buy($1) b`, [BUYER])).b, true, 'on');
  await as(db, OWNER); await db.query(`select pur_set_buyer($1, false)`, [BUYER]);
  eq((await one(db, `select pur_signin_can_buy($1) b`, [BUYER])).b, false, 'switched off');
  await db.query(`select pur_set_buyer($1, true)`, [BUYER]);
  await db.query(`update profiles set status = 'inactive' where id = $1`, [BUYER]);
  eq((await one(db, `select pur_signin_can_buy($1) b`, [BUYER])).b, false, 'inactive');
  await db.query(`update profiles set status = 'active', allowed_modules = '["pm"]'::jsonb where id = $1`, [BUYER]);
  eq((await one(db, `select pur_signin_can_buy($1) b`, [BUYER])).b, false, 'focused away from Expenses');
});

await test('only the service role may ask pur_signin_can_buy (it answers for ANY account)', async () => {
  const db = await fresh();
  for (const role of ['authenticated', 'anon']) {
    await db.exec(`set role ${role}`);
    const r = await code(db.query(`select pur_signin_can_buy($1) b`, [BUYER]));
    await db.exec(`reset role`);
    assert(/permission denied/i.test(r), role + ' refused: ' + r);
  }
  await db.exec(`set role service_role`);
  const ok = (await one(db, `select pur_signin_can_buy($1) b`, [BUYER])).b;
  await db.exec(`reset role`);
  eq(ok, true, 'service role allowed');
});

// ── B. Additional Works job with no billing period (Q19, R4) ────────

await test('an AW job with no period: the purchase is recorded and the server makes ONE hidden period', async () => {
  const db = await fresh();
  const main = await folder(db, 'Barlin'); await period(db, main);
  const aw = await folder(db, 'Gazebo', { parent: main });
  await as(db, BUYER);
  const r = await record(db, body([{ folder_id: aw, item_name: 'Lumber', amount: 1500 }]));
  assert(r.purchase_id, 'recorded');
  const ps = await periodsOf(db, aw);
  const today = new Date(phDate() + 'T00:00:00Z');
  eq(ps.map(p => [p.month, p.year, p.funding_type, p.has_budget]),
     [[MONTHS[today.getUTCMonth()], today.getUTCFullYear(), 'downpayment', false]], 'one period, no budget row');
  eq(await spent(db, aw), 1500, 'charged in full');
  eq(num((await one(db, `select count(*) n from expenses e join projects p on p.id = e.project_id
                          where p.folder_id = $1 and e.cover_expense`, [aw])).n), 0, 'never Cover');
  // A second purchase (a fee share too) uses the same period.
  await record(db, body([{ folder_id: aw, item_name: 'Nails', amount: 300 }, { folder_id: main, item_name: 'Sand', amount: 700 }],
                        { charges: [{ kind: 'delivery_fee', amount: 100 }], receipt_total: 1100 }));
  eq((await periodsOf(db, aw)).length, 1, 'still one period');
  eq(await spent(db, aw) + await spent(db, main), 1500 + 1100, 'Spent = every receipt in full, fee included');
});

await test('the hidden period takes the PURCHASE month, and a later month reuses it (AW has no monthly cap)', async () => {
  const db = await fresh();
  const main = await folder(db, 'Barlin');
  const aw = await folder(db, 'Gazebo', { parent: main });
  await as(db, BUYER);
  await record(db, body([{ folder_id: aw, item_name: 'Lumber', amount: 100 }], { purchase_date: '2026-09-28' }));
  eq((await periodsOf(db, aw)).map(p => [p.month, p.year]), [['September', 2026]], 'September period');
  await record(db, body([{ folder_id: aw, item_name: 'Lumber', amount: 50 }], { purchase_date: '2026-10-02' }));
  eq((await periodsOf(db, aw)).length, 1, 'an existing period is used whatever its month (0096 rule unchanged)');
  eq(await spent(db, aw), 150, 'both charged');
});

await test('an AW job that already has a period: nothing new is made (0096 behaviour)', async () => {
  const db = await fresh();
  const main = await folder(db, 'Barlin');
  const aw = await folder(db, 'Gazebo', { parent: main });
  const p = await period(db, aw, 0);
  await as(db, BUYER);
  await record(db, body([{ folder_id: aw, item_name: 'Lumber', amount: 900 }]));
  eq((await periodsOf(db, aw)).map(x => x.id), [p], 'same single period');
  eq(num((await one(db, `select coalesce(sum(amount), 0) s from expenses where project_id = $1`, [p])).s), 900, 'charged to it');
});

await test('Main Contract with no period is unchanged: Cover at project level, flagged for review, no period made', async () => {
  const db = await fresh();
  const main = await folder(db, 'Prado');
  await as(db, BUYER);
  await record(db, body([{ folder_id: main, item_name: 'Cement', amount: 400 }]));
  eq((await periodsOf(db, main)).length, 0, 'no period invented for a Main Contract');
  const row = await one(db, `select l.needs_funding_review r from purchase_lines l where l.folder_id = $1`, [main]);
  eq(row.r, true, 'office review flag');
});

await test('another company\'s AW job is still refused, and no period is made for it', async () => {
  const db = await fresh();
  const theirs = await folder(db, 'Theirs', { owner: OTHER });
  const theirAw = await folder(db, 'Their job', { owner: OTHER, parent: theirs });
  await as(db, BUYER);
  assert((await code(record(db, body([{ folder_id: theirAw, item_name: 'x', amount: 10 }])))).includes('BAD_PROJECT'), 'refused');
  eq((await periodsOf(db, theirAw)).length, 0, 'nothing made');
});

await test('correcting and voiding an AW purchase keep the one period; Spent follows the purchase', async () => {
  const db = await fresh();
  const main = await folder(db, 'Barlin');
  const aw = await folder(db, 'Gazebo', { parent: main });
  await as(db, BUYER);
  const r = await record(db, body([{ folder_id: aw, item_name: 'Lumber', amount: 1000 }]));
  const fixed = body([{ folder_id: aw, item_name: 'Lumber', amount: 800 }]);
  await db.query(`select pur_correct($1, $2, $3::jsonb, 'price fix')`, [op(), r.purchase_id, JSON.stringify(fixed)]);
  eq(await spent(db, aw), 800, 'corrected');
  await db.query(`select pur_void($1, $2, 'wrong job')`, [op(), r.purchase_id]);
  eq(await spent(db, aw), 0, 'voided');
  eq((await periodsOf(db, aw)).length, 1, 'the period stays (as on the web)');
});

// ── C. No receipt (Q8, R5) ──────────────────────────────────────────

await test('a phone purchase with no receipt photo and no reason is refused NO_RECEIPT', async () => {
  const db = await fresh();
  const f = await folder(db, 'Barlin'); await period(db, f);
  await as(db, BUYER);
  for (const docs of [{}, { po_image_url: '' }, { po_image_url: RECEIPT.replace('https', 'http') }]) {
    const r = await code(record(db, body([{ folder_id: f, item_name: 'Nails', amount: 50 }], { docs })));
    assert(r.includes('NO_RECEIPT') || r.includes('BAD_DOCS'), 'refused for ' + JSON.stringify(docs) + ': ' + r);
  }
  assert((await code(record(db, body([{ folder_id: f, item_name: 'Nails', amount: 50 }], { docs: {}, no_receipt_reason: '   ' }))))
    .includes('NO_RECEIPT'), 'a blank reason is no reason');
  eq(num((await one(db, `select count(*) n from purchases`)).n), 0, 'nothing recorded');
  eq(await spent(db, f), 0, 'nothing in Spent');
});

await test('a phone purchase with a photo, or with a reason, is recorded; the reason is kept and shown', async () => {
  const db = await fresh();
  const f = await folder(db, 'Barlin'); await period(db, f);
  await as(db, BUYER);
  const a = await record(db, body([{ folder_id: f, item_name: 'Nails', amount: 50 }]));
  const b = await record(db, body([{ folder_id: f, item_name: 'Rope', amount: 80 }], { docs: {}, no_receipt_reason: '  Sari-sari store, no receipt  ' }));
  const rows = await all(db, `select id, no_receipt_reason r from purchases order by created_at`);
  eq(rows.map(x => x.r), ['', 'Sari-sari store, no receipt'], 'trimmed reason stored');
  const list = (await one(db, `select pur_purchases(null, null, null, 'all') l`)).l;
  eq(list.find(x => x.id === b.purchase_id).no_receipt_reason, 'Sari-sari store, no receipt', 'in the office list');
  eq(list.find(x => x.id === a.purchase_id).no_receipt_reason, '', 'empty when there is a photo');
  eq((await one(db, `select pur_purchase($1) p`, [b.purchase_id])).p.no_receipt_reason, 'Sari-sari store, no receipt', 'in the purchase view');
  eq((await one(db, `select pur_my_purchases(60) l`)).l.find(x => x.id === b.purchase_id).no_receipt_reason,
     'Sari-sari store, no receipt', 'in My purchases');
  eq(await spent(db, f), 130, 'both in Spent');
});

await test('a reason longer than 300 characters is refused BAD_REASON', async () => {
  const db = await fresh();
  const f = await folder(db, 'Barlin'); await period(db, f);
  await as(db, BUYER);
  assert((await code(record(db, body([{ folder_id: f, item_name: 'Nails', amount: 50 }], { docs: {}, no_receipt_reason: 'x'.repeat(301) }))))
    .includes('BAD_REASON'), 'refused');
  await record(db, body([{ folder_id: f, item_name: 'Nails', amount: 50 }], { docs: {}, no_receipt_reason: 'x'.repeat(300) }));
});

await test('R5: the web (Purchasing tab and Expenses form) still records without a receipt or a reason', async () => {
  const db = await fresh();
  const f = await folder(db, 'Barlin'); await period(db, f);
  await as(db, BUYER);
  await record(db, body([{ folder_id: f, item_name: 'Nails', amount: 50 }], { source: 'purchasing', docs: {} }));
  await as(db, STAFF);
  await record(db, { ...body([{ folder_id: f, item_name: 'Rope', amount: 20 }], { source: 'expenses_form', docs: {} }),
                     lines: [{ destination: 'project', folder_id: f, item_name: 'Rope', category: 'Materials', unit: 'pc', amount: 20 }] });
  eq(num((await one(db, `select count(*) n from purchases where status = 'recorded'`)).n), 2, 'both recorded');
});

await test('a correction cannot leave a phone purchase with neither a photo nor a reason', async () => {
  const db = await fresh();
  const f = await folder(db, 'Barlin'); await period(db, f);
  await as(db, BUYER);
  const r = await record(db, body([{ folder_id: f, item_name: 'Nails', amount: 50 }]));
  const blank = body([{ folder_id: f, item_name: 'Nails', amount: 50 }], { docs: { po_image_url: '' } });
  assert((await code(db.query(`select pur_correct($1, $2, $3::jsonb, 'remove photo')`, [op(), r.purchase_id, JSON.stringify(blank)]))).includes('NO_RECEIPT'),
    'refused');
  eq((await one(db, `select docs ->> 'po_image_url' u from purchases where id = $1`, [r.purchase_id])).u, RECEIPT, 'photo kept');
  // The trigger is the last line: any writer (not only pur_insert, which trims)
  // is refused a blank reason with no photo.
  assert((await code(db.query(`update purchases set docs = '{}'::jsonb, no_receipt_reason = '   ' where id = $1`, [r.purchase_id])))
    .includes('NO_RECEIPT'), 'a whitespace reason written directly is refused');
  // A correction that keeps the photo goes through.
  const ok = body([{ folder_id: f, item_name: 'Nails', amount: 45 }]);
  await db.query(`select pur_correct($1, $2, $3::jsonb, 'price')`, [op(), r.purchase_id, JSON.stringify(ok)]);
  eq(await spent(db, f), 45, 'corrected');
});

await test('a phone purchase recorded with a reason can be corrected without adding a photo', async () => {
  const db = await fresh();
  const f = await folder(db, 'Barlin'); await period(db, f);
  await as(db, BUYER);
  const r = await record(db, body([{ folder_id: f, item_name: 'Rope', amount: 80 }], { docs: {}, no_receipt_reason: 'no receipt given' }));
  const fix = body([{ folder_id: f, item_name: 'Rope', amount: 70 }], { docs: {} });
  await db.query(`select pur_correct($1, $2, $3::jsonb, 'price')`, [op(), r.purchase_id, JSON.stringify(fix)]);
  eq((await one(db, `select no_receipt_reason r from purchases where id = $1`, [r.purchase_id])).r, 'no receipt given', 'reason kept');
  eq(await spent(db, f), 70, 'corrected');
});

await test('voiding a phone purchase is not blocked by the receipt rule', async () => {
  const db = await fresh();
  const f = await folder(db, 'Barlin'); await period(db, f);
  await as(db, BUYER);
  const r = await record(db, body([{ folder_id: f, item_name: 'Rope', amount: 80 }], { docs: {}, no_receipt_reason: 'none' }));
  await db.query(`select pur_void($1, $2, 'mistake')`, [op(), r.purchase_id]);
  eq((await one(db, `select status from purchases where id = $1`, [r.purchase_id])).status, 'void', 'voided');
});

// ── D. My purchases (Q12) ───────────────────────────────────────────

await test('My purchases: what I bought or recorded, every status, the last 60 days, newest first', async () => {
  const db = await fresh();
  const f = await folder(db, 'Barlin'); await period(db, f);
  await as(db, BUYER);
  const mine = await record(db, body([{ folder_id: f, item_name: 'Mine', amount: 10 }], { purchase_date: phDate(-1) }));
  const voided = await record(db, body([{ folder_id: f, item_name: 'Voided', amount: 10 }], { purchase_date: phDate(-2) }));
  await db.query(`select pur_void($1, $2, 'mistake')`, [op(), voided.purchase_id]);
  const old = await record(db, body([{ folder_id: f, item_name: 'Old', amount: 10 }], { purchase_date: phDate(-61) }));
  const edge = await record(db, body([{ folder_id: f, item_name: 'Edge', amount: 10 }], { purchase_date: phDate(-60) }));
  await as(db, BUYER2);
  const theirs = await record(db, body([{ folder_id: f, item_name: 'Theirs', amount: 10 }]));
  await as(db, OWNER);   // the owner records a purchase Juan made
  const forMe = await record(db, body([{ folder_id: f, item_name: 'ForMe', amount: 10 }], { source: 'purchasing', bought_by: BUYER, docs: {} }));
  await as(db, BUYER);
  const list = (await one(db, `select pur_my_purchases(60) l`)).l;
  eq(list.map(x => x.id), [forMe.purchase_id, mine.purchase_id, voided.purchase_id, edge.purchase_id], 'mine, newest first');
  eq(list.find(x => x.id === voided.purchase_id).status, 'void', 'voided shown');
  assert(!list.some(x => x.id === old.purchase_id || x.id === theirs.purchase_id), 'not older than 60 days, not someone else\'s');
  eq((await one(db, `select pur_my_purchases(61) l`)).l.length, 5, 'a longer window reaches the old one');
  await as(db, BUYER2);
  eq((await one(db, `select pur_my_purchases(60) l`)).l.map(x => x.id), [theirs.purchase_id], 'Pedro sees only his');
});

await test('My purchases rows have the office list shape (same builder) plus nothing hidden', async () => {
  const db = await fresh();
  const f = await folder(db, 'Barlin'); await period(db, f);
  await as(db, BUYER);
  const r = await record(db, body([{ folder_id: f, item_name: 'Nails', amount: 50 }]));
  const a = (await one(db, `select pur_my_purchases(60) l`)).l[0];
  const b = (await one(db, `select pur_purchases(null, null, null, 'all') l`)).l.find(x => x.id === r.purchase_id);
  eq(a, b, 'identical rows');
  eq(Object.keys(b).sort(), ['bought_by_name', 'extra', 'id', 'lines', 'linked', 'needs_review', 'no_receipt_reason', 'pending_change',
    'projects', 'purchase_date', 'receipt_total', 'recorded_by_name', 'replaced_by', 'source', 'status', 'supplier', 'unit_check',
    'unplanned', 'warehouse'], '0097 keys + no_receipt_reason + replaced_by');
});

await test('My purchases is for buyers only, and the window is 1–366 days', async () => {
  const db = await fresh();
  for (const who of [STAFF, WORKER, PMOWNER, GONE]) {
    await as(db, who);
    assert((await code(db.query(`select pur_my_purchases(60)`))).match(/BUYER_REQUIRED|NOT_OFFICE/), 'refused ' + who);
  }
  await as(db, BUYER);
  for (const d of [0, 367, null]) {
    assert((await code(db.query(`select pur_my_purchases($1)`, [d]))).includes('BAD_DAYS'), 'bad window ' + d);
  }
});

// ── E. Where a phone purchase can go (Q11) ──────────────────────────

await test('pur_destinations: open projects of my company, each with its open AW jobs', async () => {
  const db = await fresh();
  const barlin = await folder(db, 'Barlin');
  const prado = await folder(db, 'prado');
  await folder(db, 'Closed', { completed: true });
  await folder(db, '   ');
  const gazebo = await folder(db, 'Gazebo', { parent: barlin });
  await folder(db, 'Done job', { parent: barlin, completed: true });
  const awning = await folder(db, 'Awning', { parent: barlin });
  await folder(db, 'Theirs', { owner: OTHER });
  await as(db, BUYER);
  const d = (await one(db, `select pur_destinations() d`)).d;
  eq(d.map(x => x.name), ['Barlin', 'prado'], 'open top-level projects, by name');
  eq(d[0].works.map(w => [w.folder_id, w.name]), [[awning, 'Awning'], [gazebo, 'Gazebo']], 'open AW jobs');
  eq([d[1].folder_id, d[1].name, d[1].works], [prado, 'prado', []], 'no jobs');
  for (const who of [STAFF, WORKER, PMOWNER]) {
    await as(db, who);
    assert((await code(db.query(`select pur_destinations()`))).match(/BUYER_REQUIRED/), 'refused ' + who);
  }
});

// ── F. "Waiting for the owner" in Project Control (Q16) ─────────────

await test('pur_my_pending_changes: my own pending requests with their line and charge ids, nothing else', async () => {
  const db = await fresh();
  const f = await folder(db, 'Barlin'); await period(db, f);
  await as(db, STAFF);   // Project Control entry, no Buyer switch
  const pc = (item, amount) => ({ source: 'expenses_form', purchase_date: phDate(), receipt_total: amount, docs: {},
    lines: [{ destination: 'project', folder_id: f, item_name: item, category: 'Materials', unit: 'pc', amount }] });
  const a = await record(db, pc('Nails', 50));
  const b = await record(db, pc('Rope', 80));
  await as(db, OWNER); await db.query(`update folders set completed_at = now() where id = $1`, [f]);
  await as(db, STAFF);
  const ra = (await one(db, `select pur_request_change($1, $2, 'void', null, 'wrong project') r`, [op(), a.purchase_id])).r;
  const rb = (await one(db, `select pur_request_change($1, $2, 'void', null, 'duplicate') r`, [op(), b.purchase_id])).r;
  await db.query(`select pur_withdraw_change($1)`, [rb.request_id]);
  const mine = (await one(db, `select pur_my_pending_changes() l`)).l;
  eq(mine.length, 1, 'only the pending one');
  const lineA = (await one(db, `select id from purchase_lines where purchase_id = $1`, [a.purchase_id])).id;
  eq([mine[0].id, mine[0].purchase_id, mine[0].kind, mine[0].reason, mine[0].line_ids, mine[0].charge_ids],
     [ra.request_id, a.purchase_id, 'void', 'wrong project', [lineA], []], 'ids, kind and reason');
  eq(Object.keys(mine[0]).sort(), ['charge_ids', 'id', 'kind', 'line_ids', 'purchase_id', 'reason', 'requested_at'], 'no amounts, no purchase data');
  // Someone else's requests are not mine; the owner has none of their own.
  await as(db, BUYER); eq((await one(db, `select pur_my_pending_changes() l`)).l, [], 'another staff member sees none');
  await as(db, OWNER); eq((await one(db, `select pur_my_pending_changes() l`)).l, [], 'the owner sends none');
  // Withdraw from there, and it is gone.
  await as(db, STAFF);
  await db.query(`select pur_withdraw_change($1)`, [mine[0].id]);
  eq((await one(db, `select pur_my_pending_changes() l`)).l, [], 'withdrawn');
});

await test('pur_my_pending_changes is for office accounts allowed Expenses only', async () => {
  const db = await fresh();
  await as(db, WORKER);
  assert((await code(db.query(`select pur_my_pending_changes()`))).includes('NOT_OFFICE'), 'worker refused');
  await as(db, PMOWNER);
  assert((await code(db.query(`select pur_my_pending_changes()`))).includes('NOT_ALLOWED'), 'PM-only refused');
});

// ── G. Nothing else moved ───────────────────────────────────────────

await test('0101 changes no Spent: the same purchases give the same expense rows as 0097 alone', async () => {
  const run = async (with101) => {
    const db = new PGlite();
    await db.exec(BASE); await db.exec(M96); await db.exec(prBase(ROOT)); await db.exec(M97);
    if (with101) await db.exec(M101);
    await db.exec(`insert into profiles (id, role, owner_id, status, allowed_modules, email, display_name) values
      ('${OWNER}', 'owner', null, 'active', null, 'admin@dacs.test', null),
      ('${BUYER}', 'staff', '${OWNER}', 'active', null, 'juan@dacs.test', 'Juan')`);
    await as(db, OWNER); await db.query(`select pur_set_buyer($1, true)`, [BUYER]);
    const f = (await one(db, `insert into folders (id, owner_id, name) values ('40000000-0000-0000-0000-000000000001', $1, 'Barlin') returning id`, [OWNER])).id;
    const d = new Date(phDate() + 'T00:00:00Z');
    const p1 = (await one(db, `insert into projects (owner_id, folder_id, month, year, funding_type, billing_number)
                                values ($1, $2, $3, $4, 'progress', 1) returning id`, [OWNER, f, MONTHS[d.getUTCMonth()], d.getUTCFullYear()])).id;
    await db.query(`insert into project_budgets values ($1, $2, 1000)`, [p1, OWNER]);
    await as(db, BUYER);
    const src = { source: 'purchasing', purchase_date: phDate(), supplier: 'Wilcon', docs: {}, receipt_total: 1700,
                  charges: [{ kind: 'delivery_fee', amount: 200 }, { kind: 'discount', amount: 100 }],
                  lines: [{ destination: 'project', folder_id: f, item_name: 'Cement', unit: 'bag', amount: 1200, unplanned_reason: 'r' },
                          { destination: 'project', folder_id: f, item_name: 'Sand', unit: 'cu.m', amount: 400, unplanned_reason: 'r' }] };
    await one(db, `select pur_record('30000000-0000-0000-0000-999999999999', $1::jsonb) r`, [JSON.stringify(src)]);
    return (await all(db, `select e.expense_name, e.amount::text a, e.cover_expense c, e.project_id = $1 as funded
                             from expenses e order by e.expense_name, e.amount`, [p1])).map(x => [x.expense_name, x.a, x.c, x.funded]);
  };
  eq(await run(true), await run(false), 'identical rows');
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) { console.log('\nFAILURES:\n  ' + failures.join('\n  ')); process.exit(1); }
````

Create `supabase/tests/2a3_concurrency.mjs`:

````js
// ════════════════════════════════════════════════════════════════════
// STAGE 2A-3a PHONE PURCHASING — TWO SESSIONS AT ONCE, REAL POSTGRESQL
//   npm run test:sql      (runs after 2a3_server.pglite.mjs)
//
// Same approach as 2a2_concurrency.mjs: a throwaway PostgreSQL on this
// machine (or the CI runner), migrations 0096 + 0097 + 0101 VERBATIM over the
// same minimal tables, pairs of calls released at the same moment on two
// connections. Nothing touches the live database.
//   1. two phone purchases for the same AW job with NO period → one period, both recorded
//   2. an AW purchase (making its period) against one for its parent project → no deadlock
// ════════════════════════════════════════════════════════════════════
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { prBase, fnText } from './pr_base.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.DACS_ROOT || path.join(HERE, '..', '..');
const read = (p) => fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const M02 = read(path.join(ROOT, 'supabase/migrations/0002_rls.sql'));
const M94 = read(path.join(ROOT, 'supabase/migrations/0094_workmate_work_plan_office.sql'));

const OWNER = '00000000-0000-0000-0000-00000000000a';
const BUYER = '00000000-0000-0000-0000-000000000011';
const BUYER2 = '00000000-0000-0000-0000-000000000012';
const ROUNDS = 15;
let passed = 0, failed = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) { passed++; console.log('  ok  ' + name); }
  else { failed++; failures.push(name + ' — ' + detail); console.log('  FAIL ' + name + '\n       ' + detail); }
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dacs-2a3-pg-'));
const port = 55000 + Math.floor(Math.random() * 4000);
const server = new EmbeddedPostgres({ databaseDir: dir, user: 'postgres', password: 'pw', port, persistent: false,
  initdbFlags: ['--encoding=UTF8', '--locale=C'], onLog: () => {} });
const cfg = { host: 'localhost', port, user: 'postgres', password: 'pw', database: 'postgres' };

console.log('\n2A-3a phone purchasing — two sessions at once (0096 + 0097 + 0101 on PostgreSQL)');
await server.initialise();
await server.start();
const admin = new pg.Client(cfg);
await admin.connect();
try {
  await admin.query(`
create role anon; create role authenticated; create role service_role;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
create table profiles (id uuid primary key, role text, owner_id uuid, status text, allowed_modules jsonb);
create table folders (id uuid primary key default gen_random_uuid(), owner_id uuid not null, name text not null,
  parent_folder_id uuid references folders(id), completed_at timestamptz, created_at timestamptz default now(), updated_at timestamptz default now());
create table projects (id uuid primary key default gen_random_uuid(), owner_id uuid not null, folder_id uuid references folders(id) on delete cascade,
  month text, year int, funding_type text, billing_number int, created_at timestamptz default now(), updated_at timestamptz default now());
create table project_budgets (project_id uuid primary key references projects(id) on delete cascade, owner_id uuid not null, monthly_budget numeric not null default 0);
create table expenses (id uuid primary key default gen_random_uuid(), owner_id uuid not null, project_id uuid references projects(id) on delete cascade,
  expense_name text, category text, quantity numeric, amount numeric, date_time text, notes text, payment_method text,
  po_image_url text, delivery_receipt_url text, supplier_invoice_url text, payment_receipt_url text,
  in_inventory boolean default false, cover_expense boolean default false, split_group text, split_index int, split_total int,
  client_submission_id uuid, created_at timestamptz default now(), updated_at timestamptz default now());
create table payroll (id uuid primary key default gen_random_uuid(), owner_id uuid not null, project_id uuid references projects(id) on delete cascade, total_salary numeric);
create table inventory (id uuid primary key default gen_random_uuid(), legacy_id text unique, owner_id uuid, item_name text, unit text,
  current_stock numeric, min_stock numeric, notes text, last_updated timestamptz, last_adjusted_by uuid, created_at timestamptz default now());
${fnText(M02, 'auth_role')}
${fnText(M02, 'is_owner')}
${fnText(M02, 'is_staff')}
${fnText(M02, 'data_owner_id')}
${fnText(M02, 'can_access')}
${fnText(M94, 'pr_is_office')}`);
  await admin.query(read(path.join(ROOT, 'supabase/migrations/0096_purchase_recording.sql')));
  await admin.query(prBase(ROOT));
  await admin.query(read(path.join(ROOT, 'supabase/migrations/0097_purchasing_office.sql')));
  await admin.query(read(path.join(ROOT, 'supabase/migrations/0101_purchasing_phone.sql')));
  await admin.query(`insert into profiles (id, role, owner_id, status, display_name) values
    ('${OWNER}', 'owner', null, 'active', 'Owner'), ('${BUYER}', 'staff', '${OWNER}', 'active', 'Juan'),
    ('${BUYER2}', 'staff', '${OWNER}', 'active', 'Pedro');
    select set_config('test.uid', '${OWNER}', false);
    select pur_set_buyer('${BUYER}', true); select pur_set_buyer('${BUYER2}', true);`);

  const mkFolder = async (name, parent = null) =>
    (await admin.query(`insert into folders (owner_id, name, parent_folder_id) values ($1, $2, $3) returning id`, [OWNER, name, parent])).rows[0].id;
  const mkPeriod = async (f) => {
    const p = (await admin.query(`insert into projects (owner_id, folder_id, month, year, funding_type, billing_number)
                                  values ($1, $2, 'October', 2026, 'progress', 1) returning id`, [OWNER, f])).rows[0].id;
    await admin.query(`insert into project_budgets values ($1, $2, 1000000)`, [p, OWNER]);
  };
  const buy = (f, amount) => JSON.stringify({ source: 'workmate', purchase_date: '2026-10-14', receipt_total: amount,
    docs: { po_image_url: 'https://example.test/receipt.jpg' },
    lines: [{ destination: 'project', folder_id: f, item_name: 'Lumber', unit: 'pc', amount, unplanned_reason: 'test' }] });
  const session = async (uid) => {
    const c = new pg.Client(cfg); await c.connect();
    await c.query(`select set_config('test.uid', '${uid}', false)`);
    return c;
  };
  async function pair(uidA, sqlA, argsA, uidB, sqlB, argsB) {
    const [a, b] = [await session(uidA), await session(uidB)];
    const run = async (c, sql, args) => {
      try {
        await c.query('begin');
        const r = await c.query(sql, args);
        await c.query('select pg_sleep(0.03)');
        await c.query('commit');
        return { ok: true, r: r.rows[0] && r.rows[0].r };
      } catch (e) {
        try { await c.query('rollback'); } catch {}
        return { ok: false, code: e.code, msg: e.message };
      }
    };
    const out = await Promise.all([run(a, sqlA, argsA), run(b, sqlB, argsB)]);
    await a.end(); await b.end();
    return out;
  }
  const REC = `select pur_record(gen_random_uuid(), $1::jsonb) r`;
  const deadlock = (out) => out.some(o => !o.ok && o.code === '40P01');
  const periods = async (f) => Number((await admin.query(`select count(*) n from projects where folder_id = $1`, [f])).rows[0].n);
  const spent = async (f) => Number((await admin.query(`select coalesce(sum(e.amount), 0) s from expenses e join projects p on p.id = e.project_id
                                                          where p.folder_id = $1`, [f])).rows[0].s);

  // 1
  {
    let bad = 0, dead = 0, errs = 0;
    for (let i = 0; i < ROUNDS; i++) {
      const main = await mkFolder('main ' + i);
      const aw = await mkFolder('job ' + i, main);
      const out = await pair(BUYER, REC, [buy(aw, 100)], BUYER2, REC, [buy(aw, 250)]);
      if (deadlock(out)) dead++;
      if (out.some(o => !o.ok)) errs++;
      if (await periods(aw) !== 1 || await spent(aw) !== 350) bad++;
    }
    check('1. two phone purchases for the same AW job with no period: one period made, both recorded in full',
      bad === 0 && dead === 0 && errs === 0, `wrong period count or Spent ${bad}, deadlocks ${dead}, failed calls ${errs}`);
  }
  // 2
  {
    let dead = 0, errs = 0;
    for (let i = 0; i < ROUNDS; i++) {
      const main = await mkFolder('parent ' + i);
      await mkPeriod(main);
      const aw = await mkFolder('child ' + i, main);
      const out = await pair(BUYER, REC, [buy(aw, 100)], BUYER2, REC, [buy(main, 100)]);
      if (deadlock(out)) dead++;
      if (out.some(o => !o.ok)) errs++;
    }
    check('2. an AW purchase (making its period) against a purchase for its parent project: no deadlock, both recorded',
      dead === 0 && errs === 0, `deadlocks ${dead}, failed ${errs}`);
  }
} finally {
  await admin.end();
  await server.stop();
}
console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) { console.log('\nFAILURES:\n  ' + failures.join('\n  ')); process.exit(1); }
````

Create `tests/purchasing-phone-server.test.js`:

````js
// ════════════════════════════════════════════════════════════════════
// PHONE PURCHASING SERVER (0101) STATIC TESTS:
//   run with  node tests/purchasing-phone-server.test.js
//
// Zero dependencies. Reads supabase/migrations/0101_purchasing_phone.sql
// and fences what the behaviour tests cannot see (those are
// supabase/tests/2a3_server.pglite.mjs, 2a3_concurrency.mjs and the 2A-1 /
// 2A-2 suites re-run --with-0101 — npm run test:sql):
//   1. Spent is untouched: 0101 redefines no expense-row function; pur_fund's
//      Main Contract half and pur_insert are 0096/0097's text apart from the
//      lines 0101 adds.
//   2. Every function is granted to signed-in users (and checks the caller
//      itself), revoked from them, or — pur_signin_can_buy — given to the
//      service role only.
//   3. What staff without the Buyer switch can read carries no amounts.
//   4. The live acceptance script rolls back; test:sql runs the new suites.
// ════════════════════════════════════════════════════════════════════
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');
const strip = (sql) => sql.split('\n').map(l => l.replace(/--.*$/, '')).join('\n');
const M101 = strip(read('supabase/migrations/0101_purchasing_phone.sql'));
const M97 = strip(read('supabase/migrations/0097_purchasing_office.sql'));
const M96 = strip(read('supabase/migrations/0096_purchase_recording.sql'));

let passed = 0, failed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { failed++; failures.push(name + ' — ' + e.message); console.log('  FAIL ' + name + '\n       ' + e.message); }
}
function ok(c, m) { if (!c) throw new Error(m); }
function fnBody(code, name, where) {
  const m = code.match(new RegExp('create or replace function (?:public\\.)?' + name + '\\s*\\([\\s\\S]*?\\n(?:end )?\\$\\$;', 'i'));
  if (!m) throw new Error('function ' + name + ' not found in ' + where);
  return m[0];
}
// Lines of a function, blank lines and trailing spaces dropped.
const lines = (t) => t.split('\n').map(l => l.replace(/\s+$/, '')).filter(Boolean);

const defined = [...M101.matchAll(/create or replace function (?:public\.)?([a-z_]+)\s*\(/g)].map(m => m[1]);

console.log('\n0101: Spent is untouched');
test('0101 redefines no expense-row or period-arithmetic function', () => {
  for (const f of ['pur_store', 'pur_charge_rows', 'pur_clear_rows', 'pur_period_remaining', 'pur_cover_period', 'pur_prorate',
                   'pur_record', 'pur_correct', 'pur_replace', 'pur_void', 'pur_cover_lines']) {
    ok(!defined.includes(f), '0101 must not redefine ' + f);
  }
  eq(defined.slice().sort(), ['pur_destinations', 'pur_fund', 'pur_insert', 'pur_list_doc', 'pur_my_pending_changes', 'pur_my_purchases',
    'pur_purchase_view', 'pur_purchases', 'pur_require_receipt', 'pur_signin_can_buy'], 'exactly these functions');
});
test('pur_fund: only the Additional Works branch changes — the Main Contract half is 0096\'s text', () => {
  const now = fnBody(M101, 'pur_fund', '0101'), then = fnBody(M96, 'pur_fund', '0096');
  const tail = (t) => lines(t.slice(t.indexOf('-- Main Contract') >= 0 ? t.indexOf('for v_p in') : t.indexOf('for v_p in')));
  ok(JSON.stringify(tail(now)) === JSON.stringify(tail(then)), 'Main Contract funding and Cover are unchanged');
  ok(/insert into projects \(owner_id, folder_id, month, year, funding_type\)/.test(now) && /'downpayment'/.test(now), 'makes one hidden AW period');
  ok(!/project_budgets|project_control_billing_allocations/.test(now.slice(0, now.indexOf('for v_p in'))),
    'R4: the AW period gets no budget row and no allocation snapshot');
  ok(!/AW_NO_PERIOD/.test(now), 'no longer refuses');
  ok(/volatile/.test(now.slice(0, now.indexOf('as $$'))), 'volatile (it writes)');
});
test('pur_insert is 0097\'s apart from storing the "No receipt" reason', () => {
  const now = lines(fnBody(M101, 'pur_insert', '0101')), then = lines(fnBody(M97, 'pur_insert', '0097'));
  const added = now.filter(l => !then.includes(l));
  const removed = then.filter(l => !now.includes(l));
  ok(added.every(l => /no_receipt_reason|BAD_REASON|^\s*end if;$|^\s*returning id into v_id;$|p_actor, pur_bought_by\(p_owner, p_body, p_current_buyer\), v_supplier,$|recorded_by, bought_by, supplier_id, no_receipt_reason\)$/.test(l)),
    'only reason lines added: ' + JSON.stringify(added));
  ok(removed.every(l => /recorded_by, bought_by, supplier_id\)$|p_actor, pur_bought_by\(p_owner, p_body, p_current_buyer\), v_supplier\)$/.test(l)),
    'only the column list and values line changed: ' + JSON.stringify(removed));
});
test('pur_purchase_view is 0097\'s plus no_receipt_reason', () => {
  const now = lines(fnBody(M101, 'pur_purchase_view', '0101')), then = lines(fnBody(M97, 'pur_purchase_view', '0097'));
  eq(now.filter(l => !then.includes(l)).map(l => l.trim()), ["'no_receipt_reason', pu.no_receipt_reason,"], 'one line added');
  eq(then.filter(l => !now.includes(l)), [], 'nothing removed');
});

console.log('\n0101: access');
const PUBLIC = ['pur_purchases', 'pur_my_purchases', 'pur_destinations', 'pur_my_pending_changes'];
test('every function is granted to signed-in users or revoked from them — none in between', () => {
  for (const f of defined) {
    if (f === 'pur_signin_can_buy') continue;
    const granted = new RegExp('grant execute on function ' + f + '\\(').test(M101);
    const revoked = new RegExp('revoke all on function ' + f + '\\([^)]*\\) from public, anon, authenticated').test(M101);
    ok(granted !== revoked, f + (granted ? ' is both granted and revoked' : ' is neither granted nor revoked'));
    ok(granted === PUBLIC.includes(f), f + (granted ? ' is callable but not in the public list' : ' should be callable'));
    if (granted) ok(new RegExp('grant execute on function ' + f + '\\([^)]*\\) to authenticated;').test(M101), f + ' granted to authenticated only');
  }
});
test('pur_signin_can_buy: revoked from every signed-in role, granted to the service role only', () => {
  ok(/revoke all on function pur_signin_can_buy\(uuid\) from public, anon, authenticated;/.test(M101), 'revoked');
  eq([...M101.matchAll(/grant execute on function pur_signin_can_buy\(uuid\) to ([a-z_]+);/g)].map(m => m[1]), ['service_role'], 'service role only');
});
test('each public reader checks the caller itself', () => {
  for (const f of ['pur_purchases', 'pur_my_purchases', 'pur_destinations']) ok(/if not pur_buyer\(\) then\s+raise exception 'BUYER_REQUIRED'/.test(fnBody(M101, f, '0101')), f + ' buyers only');
  ok(/pur_actor_owner\('expenses_form'\)/.test(fnBody(M101, 'pur_my_pending_changes', '0101')), 'pending changes: office accounts allowed Expenses');
  ok(/r\.requested_by = auth\.uid\(\)/.test(fnBody(M101, 'pur_my_pending_changes', '0101')), 'pending changes: the caller\'s own only');
});

console.log('\n0101: no amounts for staff without the Buyer switch');
test('pur_my_pending_changes returns ids, kind, reason and time — no amount, no purchase document', () => {
  const body = fnBody(M101, 'pur_my_pending_changes', '0101');
  ok(!/amount|receipt_total|pur_doc|pur_review_doc|base_doc|body/.test(body.replace(/r\.reason/g, '')), 'nothing priced');
});

console.log('\n0101: acceptance and CI');
test('the live acceptance script rolls itself back and ends with the success row', () => {
  const acc = read('supabase/tests/2a3_acceptance.sql');
  const code = strip(acc).trim();
  ok(/^begin;/.test(code) && /rollback;$/.test(code), 'begin … rollback');
  ok(!/\bcommit\b/i.test(code), 'never commits');
  ok(/'2a3 acceptance: all checks passed'/.test(acc), 'success row');
});
test('npm run test:sql runs the 2A-3a suites and re-runs 2A-1 / 2A-2 with 0101', () => {
  const sql = JSON.parse(read('package.json')).scripts['test:sql'];
  for (const s of ['2a3_server.pglite.mjs', '2a3_concurrency.mjs', '2a1_purchase.pglite.mjs --with-0101', '2a2_purchasing.pglite.mjs --with-0101']) {
    ok(sql.includes('node supabase/tests/' + s), 'test:sql runs ' + s);
  }
  ok(JSON.parse(read('package.json')).scripts.test.includes('node tests/purchasing-phone-server.test.js'), 'npm test runs this file');
});

function eq(a, b, m) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error((m || 'not equal') + ': ' + JSON.stringify(a) + ' !== ' + JSON.stringify(b)); }

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) { console.log('\nFAILURES:\n  ' + failures.join('\n  ')); process.exit(1); }
````

Make the 2A-1 and 2A-2 suites re-runnable with 0101 on top. The second hunk of the 2A-2 change is R13.

````diff
diff --git a/supabase/tests/2a1_purchase.pglite.mjs b/supabase/tests/2a1_purchase.pglite.mjs
--- a/supabase/tests/2a1_purchase.pglite.mjs
+++ b/supabase/tests/2a1_purchase.pglite.mjs
@@ -19,9 +19,12 @@ const MIG = process.env.DACS_0096 || path.join(ROOT, 'supabase/migrations/0096_p
 const read = (p) => fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
 // --with-0097: the same tests with 2A-2's migration applied on top — 0097
 // must not change how a purchase is recorded, funded, corrected or voided.
-const WITH_0097 = process.argv.includes('--with-0097');
+// --with-0101: the same again with 2A-3a's 0101 on top of 0097.
+const WITH_0101 = process.argv.includes('--with-0101');
+const WITH_0097 = process.argv.includes('--with-0097') || WITH_0101;
 const PR_BASE = WITH_0097 ? (await import('./pr_base.mjs')).prBase(ROOT) : '';
 const M97 = WITH_0097 ? read(path.join(ROOT, 'supabase/migrations/0097_purchasing_office.sql')) : '';
+const M101 = WITH_0101 ? read(path.join(ROOT, 'supabase/migrations/0101_purchasing_phone.sql')) : '';
 const fnText = (src, name) => {
   const m = src.match(new RegExp('create or replace function ' + name + '\\s*\\([\\s\\S]*?\\n\\$\\$;', 'i'));
   if (!m) throw new Error('function ' + name + ' not found');
@@ -93,6 +96,7 @@ async function fresh() {
   await db.exec(BASE);
   await db.exec(read(MIG));
   if (WITH_0097) { await db.exec(PR_BASE); await db.exec(M97); }
+  if (WITH_0101) { await db.exec(`create role service_role`); await db.exec(M101); }
   await db.exec(`insert into profiles values
     ('${OWNER}', 'owner', null, 'active', null), ('${STAFF}', 'staff', '${OWNER}', 'active', null),
     ('${WORKER}', 'worker', '${OWNER}', 'active', null), ('${OTHER}', 'owner', null, 'active', null),
@@ -138,7 +142,7 @@ async function code(promise) {
   try { await promise; return 'no error'; } catch (e) { return e.message; }
 }
 
-console.log('\n2A-1 purchase recording (0096' + (WITH_0097 ? ' + 0097' : '') + ' on PGlite)');
+console.log('\n2A-1 purchase recording (0096' + (WITH_0097 ? ' + 0097' : '') + (WITH_0101 ? ' + 0101' : '') + ' on PGlite)');
 
 await test('§3.3 example: ₱8,000 on 14 Oct → ₱3,000 + ₱4,000 + ₱1,000 Cover (earliest billing number first)', async () => {
   const db = await fresh(); await as(db, OWNER);
````

````diff
diff --git a/supabase/tests/2a2_purchasing.pglite.mjs b/supabase/tests/2a2_purchasing.pglite.mjs
--- a/supabase/tests/2a2_purchasing.pglite.mjs
+++ b/supabase/tests/2a2_purchasing.pglite.mjs
@@ -20,6 +20,10 @@ const M02 = read(path.join(ROOT, 'supabase/migrations/0002_rls.sql'));
 const M94 = read(path.join(ROOT, 'supabase/migrations/0094_workmate_work_plan_office.sql'));
 const M96 = read(path.join(ROOT, 'supabase/migrations/0096_purchase_recording.sql'));
 const M97 = read(path.join(ROOT, 'supabase/migrations/0097_purchasing_office.sql'));
+// --with-0101: the same tests with 2A-3a's 0101 on top — 0101 must not change
+// how the Purchasing tab buys, covers, corrects or approves.
+const WITH_0101 = process.argv.includes('--with-0101');
+const M101 = WITH_0101 ? read(path.join(ROOT, 'supabase/migrations/0101_purchasing_phone.sql')) : '';
 
 // The 2A-1 base schema (same as 2a1_purchase.pglite.mjs).
 const BASE = `
@@ -87,6 +91,7 @@ async function fresh() {
   await db.exec(M96);
   await db.exec(prBase(ROOT));
   await db.exec(M97);
+  if (WITH_0101) { await db.exec(`create role service_role`); await db.exec(M101); }
   await db.exec(`insert into profiles (id, role, owner_id, status, allowed_modules, email, display_name) values
     ('${OWNER}', 'owner', null, 'active', null, 'admin@dacs.test', null),
     ('${STAFF}', 'staff', '${OWNER}', 'active', null, 'staff@dacs.test', null),
@@ -153,7 +158,7 @@ async function spent(db, folderId) {
   return num((await one(db, `select coalesce(sum(e.amount), 0) s from expenses e join projects p on p.id = e.project_id where p.folder_id = $1`, [folderId])).s);
 }
 
-console.log('\n2A-2 purchasing tab + Buyer switch (0096 + 0097 on PGlite)');
+console.log('\n2A-2 purchasing tab + Buyer switch (0096 + 0097' + (WITH_0101 ? ' + 0101' : '') + ' on PGlite)');
 
 // ── A. The Buyer switch ──────────────────────────────────────────────
 
@@ -197,10 +202,12 @@ await test('Purchasing and phone sources need the switch; the Expenses form keep
   const b = body([{ folder_id: f, item_name: 'Nails', amount: 50, unplanned_reason: 'site ran out' }]);
   await as(db, STAFF);
   assert((await code(record(db, b))).includes('BUYER_REQUIRED'), 'purchasing refused');
-  assert((await code(record(db, { ...b, source: 'workmate' }))).includes('BUYER_REQUIRED'), 'phone refused');
+  // A phone purchase carries its receipt photo (0101 refuses one with neither a photo nor a reason).
+  const phone = { ...b, source: 'workmate', docs: { po_image_url: 'https://example.test/receipt.jpg' } };
+  assert((await code(record(db, phone))).includes('BUYER_REQUIRED'), 'phone refused');
   await record(db, { ...b, source: 'expenses_form' });
   await as(db, BUYER); await record(db, b);
-  await record(db, { ...b, source: 'workmate' });
+  await record(db, phone);
   await as(db, OWNER);
   await db.query(`update profiles set status = 'inactive' where id = $1`, [BUYER]);
   await as(db, BUYER);
````

Register the suites (`test:sql` gains four runs; `test` gains the static file):

````diff
diff --git a/package.json b/package.json
--- a/package.json
+++ b/package.json
@@ -1,10 +1,10 @@
 {
   "scripts": {
-    "test": "node tests/money-math.test.js && node tests/reimbursement.test.js && node tests/quotation.test.js && node tests/quotation-pdf-import.test.js && node tests/shim-fromrow.test.js && node tests/shim-docref.test.js && node tests/shim-omit.test.js && node tests/folder-completion.test.js && node tests/attendance.test.js && node tests/billing-allocation.test.js && node tests/app-updates.test.js && node tests/storage-access.test.js && node tests/app-streams.test.js && node tests/booking.test.js && node tests/workmate-requests.test.js && node tests/workmate-requests-office.test.js && node tests/requests-admin.test.js && node tests/shim-addmany.test.js && node tests/receipt-storage.test.js && node tests/receipt-save-paths.test.js && node tests/receipt-print-popups.test.js && node tests/workmate-history.test.js && node tests/project-control-staff.test.js && node tests/workmate-workplan.test.js && node tests/workmate-office-server.test.js && node tests/workplan-admin.test.js && node tests/ai-worker.test.js && node tests/workplan-screens.test.js && node tests/purchase-server.test.js && node tests/purchase-screens.test.js && node tests/expense-split-rows.test.js && node tests/staff-payroll-period.test.js && node tests/purchasing-admin.test.js && node tests/purchasing-server.test.js && node tests/pm-sharing.test.js && node tests/cash-advance.test.js",
+    "test": "node tests/money-math.test.js && node tests/reimbursement.test.js && node tests/quotation.test.js && node tests/quotation-pdf-import.test.js && node tests/shim-fromrow.test.js && node tests/shim-docref.test.js && node tests/shim-omit.test.js && node tests/folder-completion.test.js && node tests/attendance.test.js && node tests/billing-allocation.test.js && node tests/app-updates.test.js && node tests/storage-access.test.js && node tests/app-streams.test.js && node tests/booking.test.js && node tests/workmate-requests.test.js && node tests/workmate-requests-office.test.js && node tests/requests-admin.test.js && node tests/shim-addmany.test.js && node tests/receipt-storage.test.js && node tests/receipt-save-paths.test.js && node tests/receipt-print-popups.test.js && node tests/workmate-history.test.js && node tests/project-control-staff.test.js && node tests/workmate-workplan.test.js && node tests/workmate-office-server.test.js && node tests/workplan-admin.test.js && node tests/ai-worker.test.js && node tests/workplan-screens.test.js && node tests/purchase-server.test.js && node tests/purchase-screens.test.js && node tests/expense-split-rows.test.js && node tests/staff-payroll-period.test.js && node tests/purchasing-admin.test.js && node tests/purchasing-server.test.js && node tests/pm-sharing.test.js && node tests/cash-advance.test.js && node tests/purchasing-phone-server.test.js",
     "build": "node -e \"console.error('\\n*** BUILD DISABLED (2026-07-03) ***\\njs/portal-app.compiled.js IS the source of truth — edit it directly.\\nThe stale JSX source was deleted on 2026-07-28; there is nothing to build from.\\nSee README.md section 13.\\n'); process.exit(1)\"",
     "build:watch": "npm run build",
     "build:prod": "npm run build",
-    "test:sql": "npm --prefix supabase/tests install --no-package-lock --no-audit --no-fund && node supabase/tests/2a1_purchase.pglite.mjs && node supabase/tests/2a1_concurrency.mjs && node supabase/tests/2a1_purchase.pglite.mjs --with-0097 && node supabase/tests/2a2_purchasing.pglite.mjs && node supabase/tests/2a2_concurrency.mjs && node supabase/tests/pm_sharing.pglite.mjs && node supabase/tests/pm_sharing_concurrency.mjs && node supabase/tests/pm_cash_advances.pglite.mjs && node supabase/tests/pm_cash_advances_concurrency.mjs"
+    "test:sql": "npm --prefix supabase/tests install --no-package-lock --no-audit --no-fund && node supabase/tests/2a1_purchase.pglite.mjs && node supabase/tests/2a1_concurrency.mjs && node supabase/tests/2a1_purchase.pglite.mjs --with-0097 && node supabase/tests/2a2_purchasing.pglite.mjs && node supabase/tests/2a2_concurrency.mjs && node supabase/tests/2a1_purchase.pglite.mjs --with-0101 && node supabase/tests/2a2_purchasing.pglite.mjs --with-0101 && node supabase/tests/2a3_server.pglite.mjs && node supabase/tests/2a3_concurrency.mjs && node supabase/tests/pm_sharing.pglite.mjs && node supabase/tests/pm_sharing_concurrency.mjs && node supabase/tests/pm_cash_advances.pglite.mjs && node supabase/tests/pm_cash_advances_concurrency.mjs"
   },
   "devDependencies": {
     "esbuild": "^0.28.0",
````

- [ ] **Step 2: Run the tests and see them fail**

Run: `node supabase/tests/2a3_server.pglite.mjs` and `node tests/purchasing-phone-server.test.js`
Expected: both stop at once with `ENOENT … supabase/migrations/0101_purchasing_phone.sql`. The migration does not exist yet.

(In the scratch build, the same suite run against a placeholder `0101` (`select 1;`) gave **6 passed, 17 failed**. Four of the six that pass are the "unchanged behaviour" checks: an AW job that already has a period, Main Contract with no period, another company's job, and R5's web purchase without a receipt. The other two pass trivially when 0101 is empty: voiding a phone purchase, and "0101 changes no Spent".)

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/0101_purchasing_phone.sql`:

````sql
-- 0101 — WorkMate Stage 2A-3a: what phone purchasing needs from the server.
--
-- Spec: docs/superpowers/specs/2026-09-30-workmate-mobile-purchasing-design.md;
-- answers: docs/superpowers/specs/2026-10-20-workmate-stage2a3-questions.md
-- (Q1–Q22 = A; Q23, the Terms screen for buyers, is pending for 2A-3b);
-- roadmap and rulings R1–R8:
-- docs/superpowers/plans/2026-10-20-workmate-stage2a3-roadmap.md;
-- plan: docs/superpowers/plans/2026-10-20-workmate-stage2a3a-server-web.md.
--
-- ── 1. Signing a buyer in (Q1, R1, R3). The attendance-signin Edge Function
--    runs as the service role, where pur_buyer() (which reads auth.uid())
--    cannot be asked. pur_signin_can_buy(user) gives it the very same answer
--    for a given account: pur_can_buy in that account's own company, the
--    company worked out exactly as data_owner_id() does. Service role only.
--
-- ── 2. An Additional Works job with no billing period (Q19, R4). 0096
--    refused such a purchase (AW_NO_PERIOD); Dacs Web avoided it by creating
--    one hidden period in the browser first, which the phone cannot do.
--    pur_fund now creates that ONE period itself — a projects row with
--    funding_type 'downpayment' and the purchase's month and year, as the
--    web's staff path does: no budget row, no allocation snapshot (an
--    allocation is never back-filled with defaults). The cost is the same as
--    before: an AW job is charged in full to its own period, never Cover.
--    Every purchase write already holds the job's 'pur_folder:' lock
--    (pur_lock), and pur_fund takes it again (a no-op when held), so two
--    purchases at once still create one period. pur_fund becomes VOLATILE;
--    only pur_charge_rows calls it.
--
-- ── 3. "No receipt" (Q8, R5). purchases.no_receipt_reason. A PHONE purchase
--    (source 'workmate') needs a receipt photo or a reason: refused
--    NO_RECEIPT on insert and on any update that would leave it with
--    neither. The web form keeps receipts optional. pur_insert is redefined
--    only to store the reason (≤ 300 characters, BAD_REASON).
--
-- ── 4. What the phone reads. pur_my_purchases(days): what the caller bought
--    or recorded, every status, newest first (Q12). pur_destinations(): open
--    projects with their open Additional Works jobs, for the record form
--    (Q11). pur_purchases / pur_purchase show no_receipt_reason; both lists
--    share one row builder, pur_list_doc.
--
-- ── 5. "Waiting for the owner" in Project Control (Q16). Staff without the
--    Buyer switch read no purchase rows (0097, R3), and a change request is
--    keyed by purchase while a Project Control row knows only its purchase
--    LINE. pur_my_pending_changes() returns the caller's own pending change
--    requests with the ids of their purchase's lines and charges — ids,
--    kind, reason and time only, no amounts — so the row can say so and
--    offer Withdraw (0097's pur_withdraw_change).
--
-- Money: Spent is computed exactly as in 0096/0097. Nothing here writes an
-- expense row except through the unchanged pur_charge_rows.

-- ════ 1. Signing a buyer in ═══════════════════════════════════════════

create or replace function pur_signin_can_buy(p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((
    select pur_can_buy(p.id, case when p.role = 'staff' then coalesce(p.owner_id, p.id) else p.id end)
      from profiles p where p.id = p_user), false)
$$;

-- ════ 2. The Additional Works period ══════════════════════════════════

create or replace function pur_fund(p_owner uuid, p_folder uuid, p_date date, p_amount numeric)
returns table (period_id uuid, amount numeric, cover boolean, review boolean)
language plpgsql volatile security definer set search_path = public as $$
declare
  v_aw boolean;
  v_left numeric := round(p_amount, 2);
  v_p record;
  v_remain numeric;
  v_charge numeric;
  v_any boolean := false;
  v_cover uuid;
begin
  if v_left <= 0 then
    return;
  end if;
  select f.parent_folder_id is not null into v_aw from folders f where f.id = p_folder and f.owner_id = p_owner;
  if v_aw is null then
    raise exception 'BAD_PROJECT' using errcode = 'P0001';
  end if;

  -- Additional Works: its own period, in full, no monthly cap, never Cover (Q24).
  if v_aw then
    -- The same key pur_lock takes for this project (already held by every
    -- purchase write): two purchases at once still make ONE period.
    perform pg_advisory_xact_lock(hashtextextended('pur_folder:' || p_folder::text, 0));
    select p.id into v_cover
      from projects p
     where p.folder_id = p_folder and p.owner_id = p_owner
     order by (pur_month_no(p.month) = extract(month from p_date)::int and p.year = extract(year from p_date)::int) desc nulls last,
              p.year desc nulls last, pur_month_no(p.month) desc nulls last, p.billing_number desc nulls last, p.created_at desc, p.id
     limit 1;
    if v_cover is null then
      -- 0101 (Q19): the job's one hidden period, as Dacs Web's staff path makes it.
      insert into projects (owner_id, folder_id, month, year, funding_type)
      values (p_owner, p_folder,
              (array['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
                     'September', 'October', 'November', 'December'])[extract(month from p_date)::int],
              extract(year from p_date)::int, 'downpayment')
      returning id into v_cover;
    end if;
    return query select v_cover, v_left, false, false;
    return;
  end if;

  -- Main Contract: this month's client periods, earliest billing number first.
  for v_p in
    select p.id
      from projects p
      join project_budgets b on b.project_id = p.id and b.owner_id = p_owner
     where p.folder_id = p_folder
       and p.owner_id = p_owner
       and coalesce(p.funding_type, 'progress') <> 'president'
       and b.monthly_budget > 0
       and pur_month_no(p.month) = extract(month from p_date)::int
       and p.year = extract(year from p_date)::int
     order by p.billing_number nulls last, p.created_at, p.id
  loop
    v_any := true;
    exit when v_left <= 0;
    v_remain := pur_period_remaining(v_p.id);
    if v_remain > 0 then
      v_charge := least(v_remain, v_left);
      v_left := v_left - v_charge;
      return query select v_p.id, v_charge, false, false;
    end if;
  end loop;

  -- Shortage → Cover. No Cover period and no period in the purchase month →
  -- the project itself (period null), never another month's client period.
  if v_left > 0 then
    v_cover := pur_cover_period(p_owner, p_folder, p_date);
    return query select v_cover, v_left, true, not v_any;
  end if;
end;
$$;

-- ════ 3. No receipt ═══════════════════════════════════════════════════

alter table purchases add column if not exists no_receipt_reason text not null default '';
alter table purchases drop constraint if exists purchases_no_receipt_reason_check;
alter table purchases add constraint purchases_no_receipt_reason_check check (char_length(no_receipt_reason) <= 300);

-- A phone purchase keeps a receipt photo (an https link in docs) or says why
-- there is none.
create or replace function pur_require_receipt() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.source = 'workmate'
     and btrim(coalesce(new.no_receipt_reason, '')) = ''
     and not exists (select 1 from jsonb_each_text(case when jsonb_typeof(new.docs) = 'object' then new.docs else '{}'::jsonb end) d(k, v)
                      where v ~ '^https://') then
    raise exception 'NO_RECEIPT' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists purchases_require_receipt on purchases;
create trigger purchases_require_receipt
  before insert or update of docs, no_receipt_reason, source on purchases
  for each row execute function pur_require_receipt();

-- 0097's pur_insert, plus the "No receipt" reason (the only change).
create or replace function pur_insert(p_owner uuid, p_actor uuid, p_body jsonb, p_carry jsonb, p_keep jsonb default null,
                                      p_history jsonb default null, p_current_buyer uuid default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_supplier uuid := pur_supplier_of(p_owner, p_body);
  v_covers jsonb;
  v_result jsonb;
begin
  -- A receipt "link" must be an https address (a stored javascript: value
  -- would run when someone opens it). Empty values are ignored as before.
  if exists (select 1 from jsonb_each(coalesce(p_body -> 'docs', '{}'::jsonb)) d(k, v)
              where k in ('po_image_url', 'delivery_receipt_url', 'supplier_invoice_url', 'payment_receipt_url')
                and jsonb_typeof(v) = 'string' and v #>> '{}' <> '' and v #>> '{}' !~ '^https://') then
    raise exception 'BAD_DOCS' using errcode = 'P0001';
  end if;
  if char_length(btrim(coalesce(p_body ->> 'no_receipt_reason', ''))) > 300 then
    raise exception 'BAD_REASON' using errcode = 'P0001';
  end if;
  insert into purchases (owner_id, source, purchase_date, date_time, supplier, receipt_total, notes, payment_method, docs,
                         recorded_by, bought_by, supplier_id, no_receipt_reason)
  values (p_owner, coalesce(p_body ->> 'source', 'expenses_form'), (p_body ->> 'purchase_date')::date,
          coalesce(nullif(p_body ->> 'date_time', ''), p_body ->> 'purchase_date'),
          coalesce(nullif(btrim(coalesce(p_body ->> 'supplier', '')), ''),
                   (select s.name || case when s.branch <> '' then ' · ' || s.branch else '' end from suppliers s where s.id = v_supplier), ''),
          pur_money(p_body ->> 'receipt_total'), btrim(coalesce(p_body ->> 'notes', '')),
          btrim(coalesce(p_body ->> 'payment_method', '')),
          coalesce((select jsonb_object_agg(k, v) from jsonb_each(coalesce(p_body -> 'docs', '{}'::jsonb)) d(k, v)
                     where k in ('po_image_url', 'delivery_receipt_url', 'supplier_invoice_url', 'payment_receipt_url')
                       and jsonb_typeof(v) = 'string'), '{}'::jsonb),
          p_actor, pur_bought_by(p_owner, p_body, p_current_buyer), v_supplier,
          btrim(coalesce(p_body ->> 'no_receipt_reason', '')))
  returning id into v_id;

  perform pur_store(p_owner, v_id, p_body);
  -- Carried-over stock: the first new "track in inventory" line of the same
  -- item takes the old move over (no stock change). Nothing is ever moved twice.
  insert into purchase_stock_moves (line_id, inventory_id, quantity)
  select l.id, c.inventory_id, c.quantity
    from (select k.*, row_number() over (partition by lower(k.item_name) order by k.line_no) rn
            from jsonb_to_recordset(coalesce(p_carry, '[]'::jsonb)) as k(line_no int, item_name text, inventory_id uuid, quantity numeric)) c
    join (select x.*, row_number() over (partition by lower(x.item_name) order by x.line_no) rn
            from purchase_lines x where x.purchase_id = v_id and x.in_inventory) l
      on lower(l.item_name) = lower(c.item_name) and l.rn = c.rn
  on conflict (line_id) do nothing;
  perform pur_apply_checks(v_id, p_keep);
  v_covers := pur_cover_lines(v_id, p_actor, coalesce(p_history, '[]'::jsonb));
  v_result := pur_charge_rows(v_id) || jsonb_build_object('stock_moves', pur_move_stock(v_id, p_actor), 'covers', v_covers);
  insert into purchase_history (owner_id, purchase_id, kind, after, actor_id)
  values (p_owner, v_id, 'recorded', pur_doc(v_id), p_actor);
  return v_result;
end;
$$;

-- ════ 4. What the phone reads ═════════════════════════════════════════

-- One row of a purchases list (0097's pur_purchases row, plus the
-- "No receipt" reason and the purchase that replaced a voided one).
create or replace function pur_list_doc(p_purchase uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
           'id', pu.id, 'status', pu.status, 'source', pu.source, 'purchase_date', pu.purchase_date,
           'supplier', pu.supplier, 'receipt_total', pu.receipt_total,
           'recorded_by_name', pur_person_name(pu.recorded_by),
           'bought_by_name', pur_person_name(coalesce(pu.bought_by, pu.recorded_by)),
           'projects', (select coalesce(jsonb_agg(distinct l.folder_name), '[]'::jsonb) from purchase_lines l
                         where l.purchase_id = pu.id and l.destination = 'project'),
           'warehouse', exists (select 1 from purchase_lines l where l.purchase_id = pu.id and l.destination = 'warehouse'),
           'lines', (select count(*) from purchase_lines l where l.purchase_id = pu.id),
           'linked', (select count(*) from purchase_lines l where l.purchase_id = pu.id and l.request_line_id is not null),
           'unplanned', exists (select 1 from purchase_lines l where l.purchase_id = pu.id and l.unplanned_reason <> ''),
           'extra', exists (select 1 from purchase_lines l where l.purchase_id = pu.id and l.extra_qty > 0),
           'unit_check', exists (select 1 from purchase_lines l where l.purchase_id = pu.id and l.unit_check = 'pending'),
           'needs_review', exists (select 1 from purchase_lines l where l.purchase_id = pu.id and l.needs_funding_review),
           'pending_change', exists (select 1 from purchase_change_requests r where r.purchase_id = pu.id and r.status = 'pending'),
           'no_receipt_reason', pu.no_receipt_reason,
           'replaced_by', pu.replaced_by)
    from purchases pu where pu.id = p_purchase
$$;

-- 0097's purchases list, built from pur_list_doc (same filters, same limit).
create or replace function pur_purchases(p_from date default null, p_to date default null, p_folder uuid default null,
                                         p_status text default 'recorded') returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_owner uuid;
begin
  if not pur_buyer() then
    raise exception 'BUYER_REQUIRED' using errcode = 'P0001';
  end if;
  v_owner := data_owner_id();
  return (select coalesce(jsonb_agg(x.doc order by x.purchase_date desc, x.created_at desc), '[]'::jsonb)
            from (select pu.purchase_date, pu.created_at, pur_list_doc(pu.id) as doc
                    from purchases pu
                   where pu.owner_id = v_owner
                     and (p_from is null or pu.purchase_date >= p_from)
                     and (p_to is null or pu.purchase_date <= p_to)
                     and (coalesce(p_status, 'recorded') = 'all' or pu.status = coalesce(p_status, 'recorded'))
                     and (p_folder is null or exists (select 1 from purchase_lines l
                                                        left join folders f on f.id = l.folder_id
                                                       where l.purchase_id = pu.id
                                                         and (l.folder_id = p_folder or f.parent_folder_id = p_folder)))
                   order by pu.purchase_date desc, pu.created_at desc
                   limit 300) x);
end;
$$;

-- My purchases (Q12): what the caller bought or recorded in the last p_days
-- days (Philippine date), every status, newest first, at most 300.
create or replace function pur_my_purchases(p_days int default 60) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_owner uuid;
  v_uid uuid := auth.uid();
begin
  if not pur_buyer() then
    raise exception 'BUYER_REQUIRED' using errcode = 'P0001';
  end if;
  if p_days is null or p_days not between 1 and 366 then
    raise exception 'BAD_DAYS' using errcode = 'P0001';
  end if;
  v_owner := data_owner_id();
  return (select coalesce(jsonb_agg(x.doc order by x.purchase_date desc, x.created_at desc), '[]'::jsonb)
            from (select pu.purchase_date, pu.created_at, pur_list_doc(pu.id) as doc
                    from purchases pu
                   where pu.owner_id = v_owner
                     and (pu.recorded_by = v_uid or pu.bought_by = v_uid)
                     and pu.purchase_date >= (now() at time zone 'Asia/Manila')::date - p_days
                   order by pu.purchase_date desc, pu.created_at desc
                   limit 300) x);
end;
$$;

-- Where a phone purchase may go (Q11): the company's open projects, each
-- with its open Additional Works jobs. The warehouse needs no row.
create or replace function pur_destinations() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_owner uuid;
begin
  if not pur_buyer() then
    raise exception 'BUYER_REQUIRED' using errcode = 'P0001';
  end if;
  v_owner := data_owner_id();
  return (select coalesce(jsonb_agg(jsonb_build_object(
            'folder_id', f.id, 'name', f.name,
            'works', (select coalesce(jsonb_agg(jsonb_build_object('folder_id', c.id, 'name', c.name) order by lower(c.name), c.id), '[]'::jsonb)
                        from folders c
                       where c.parent_folder_id = f.id and c.owner_id = v_owner and c.completed_at is null
                         and coalesce(btrim(c.name), '') <> ''))
          order by lower(f.name), f.id), '[]'::jsonb)
            from folders f
           where f.owner_id = v_owner and f.parent_folder_id is null and f.completed_at is null
             and coalesce(btrim(f.name), '') <> '');
end;
$$;

-- The caller's own pending change requests, with their purchase's line and
-- charge ids (Q16). Any account that may record (0096's rule), buyer or not.
create or replace function pur_my_pending_changes() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_owner uuid := pur_actor_owner('expenses_form');
begin
  return (select coalesce(jsonb_agg(jsonb_build_object(
            'id', r.id, 'purchase_id', r.purchase_id, 'kind', r.kind, 'reason', r.reason, 'requested_at', r.requested_at,
            'line_ids', (select coalesce(jsonb_agg(l.id order by l.line_no), '[]'::jsonb) from purchase_lines l where l.purchase_id = r.purchase_id),
            'charge_ids', (select coalesce(jsonb_agg(c.id order by c.charge_no), '[]'::jsonb) from purchase_charges c where c.purchase_id = r.purchase_id))
          order by r.requested_at desc), '[]'::jsonb)
            from purchase_change_requests r
           where r.owner_id = v_owner and r.requested_by = auth.uid() and r.status = 'pending');
end;
$$;

-- 0097's one-purchase view, plus the "No receipt" reason.
create or replace function pur_purchase_view(p_purchase uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select pur_doc(pu.id) || jsonb_build_object(
    'recorded_by_name', pur_person_name(pu.recorded_by),
    'bought_by_name', pur_person_name(coalesce(pu.bought_by, pu.recorded_by)),
    'created_at', pu.created_at, 'updated_at', pu.updated_at, 'replaced_by', pu.replaced_by,
    'no_receipt_reason', pu.no_receipt_reason,
    'covers', (select coalesce(jsonb_agg(jsonb_build_object(
                 'line', l.line_no, 'request_line_id', c.request_line_id, 'portion_id', c.portion_id,
                 'quantity', c.quantity, 'buyer_name', pur_person_name(c.buyer_id),
                 'request_description', rl.description, 'request_unit', rl.unit,
                 'cutoff_at', (select b.cutoff_at from pr_line_portions p join pr_batches b on b.id = p.batch_id where p.id = c.portion_id))
               order by l.line_no, c.id), '[]'::jsonb)
                 from purchase_line_covers c join purchase_lines l on l.id = c.line_id
                 join pr_lines rl on rl.id = c.request_line_id
                where l.purchase_id = pu.id),
    'requests', (select coalesce(jsonb_agg(jsonb_build_object('line', l.line_no, 'request_line_id', l.request_line_id,
                   'description', rl.description, 'spec', rl.spec, 'unit', rl.unit,
                   'needed', (select coalesce(sum(p.quantity - p.pending_reduction), 0) from pr_line_portions p where p.line_id = rl.id),
                   'bought', pr_line_bought(rl.id)) order by l.line_no), '[]'::jsonb)
                   from purchase_lines l join pr_lines rl on rl.id = l.request_line_id where l.purchase_id = pu.id),
    'history', (select coalesce(jsonb_agg(jsonb_build_object('kind', h.kind, 'reason', h.reason, 'at', h.at,
                  'actor_name', pur_person_name(h.actor_id)) order by h.id), '[]'::jsonb)
                  from purchase_history h where h.purchase_id = pu.id),
    'change_requests', (select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'kind', r.kind, 'status', r.status,
                          'reason', r.reason, 'requested_by_name', pur_person_name(r.requested_by), 'requested_at', r.requested_at,
                          'decision_note', r.decision_note) order by r.requested_at desc), '[]'::jsonb)
                          from purchase_change_requests r where r.purchase_id = pu.id))
  from purchases pu where pu.id = p_purchase
$$;

-- ════ 5. Who may call what ════════════════════════════════════════════

-- The sign-in function only (service role). Never a signed-in user: it
-- answers for ANY account id.
revoke all on function pur_signin_can_buy(uuid) from public, anon, authenticated;
grant execute on function pur_signin_can_buy(uuid) to service_role;

-- Internal helpers: only the SECURITY DEFINER operations call them.
-- (create or replace keeps a function's permissions; restated so they can never drift.)
revoke all on function pur_fund(uuid, uuid, date, numeric) from public, anon, authenticated;
revoke all on function pur_require_receipt() from public, anon, authenticated;
revoke all on function pur_insert(uuid, uuid, jsonb, jsonb, jsonb, jsonb, uuid) from public, anon, authenticated;
revoke all on function pur_list_doc(uuid) from public, anon, authenticated;
revoke all on function pur_purchase_view(uuid) from public, anon, authenticated;

-- Readers for buyers (each refuses BUYER_REQUIRED itself).
revoke all on function pur_purchases(date, date, uuid, text) from public, anon;
grant execute on function pur_purchases(date, date, uuid, text) to authenticated;
revoke all on function pur_my_purchases(int) from public, anon;
grant execute on function pur_my_purchases(int) to authenticated;
revoke all on function pur_destinations() from public, anon;
grant execute on function pur_destinations() to authenticated;
-- Project Control's "Waiting for the owner" (refuses NOT_OFFICE / NOT_ALLOWED itself).
revoke all on function pur_my_pending_changes() from public, anon;
grant execute on function pur_my_pending_changes() to authenticated;
````

- [ ] **Step 4: Run the tests and see them pass**

Run each:
- `node supabase/tests/2a3_server.pglite.mjs` → `23 passed, 0 failed`
- `node supabase/tests/2a3_concurrency.mjs` → `2 passed, 0 failed` (15 rounds each; about a minute)
- `node supabase/tests/2a1_purchase.pglite.mjs --with-0101` → `45 passed, 0 failed`
- `node supabase/tests/2a2_purchasing.pglite.mjs --with-0101` → `44 passed, 0 failed`, and still `44 passed` without the flag
- `node tests/purchasing-phone-server.test.js` → `10 passed, 0 failed`

(`supabase/tests/node_modules` comes from `npm --prefix supabase/tests install --no-package-lock --no-audit --no-fund`, which `npm run test:sql` runs first.)

- [ ] **Step 5: Write the live acceptance script**

Create `supabase/tests/2a3_acceptance.sql` (run in Task 4 through MCP `execute_sql`, never the SQL editor):

````sql
-- ════════════════════════════════════════════════════════════════════
-- Stage 2A-3a acceptance — migration 0101 (live behaviour).
--
-- Self-wrapped in begin / rollback: nothing persists — not the Buyer
-- switch, not the test project, its Additional Works job, the period the
-- server makes for it, or any purchase. Builds its own "ZZ 2a3" project.
-- Editor-safe (set_config 'v2a3.*', no temp objects). Needs one active main
-- owner with an active staff account allowed Expenses, and one active worker
-- of that owner. The staff account's Buyer switch is turned OFF at the start
-- (and on again in A) inside this transaction, so its real setting is kept.
-- Run it through MCP execute_sql.
-- Success ends with the row '2a3 acceptance: all checks passed'.
--   A. the sign-in answer = pur_buyer(), service role only
--   B. an AW job with no period: one hidden period, charged in full
--   C. a phone purchase needs a receipt photo or a reason (web does not)
--   D. My purchases and the destinations list
--   E. no other project's Spent moved
-- ════════════════════════════════════════════════════════════════════

begin;
set local statement_timeout = '60s';
set local lock_timeout = '5s';

do $$
declare
  v_owner uuid; v_staff uuid; v_worker uuid; v_main uuid; v_job uuid; v_today date := (now() at time zone 'Asia/Manila')::date;
begin
  select p.id, s.id into v_owner, v_staff
    from profiles p join profiles s on s.owner_id = p.id and s.role = 'staff' and coalesce(s.status, 'active') = 'active'
         and (jsonb_typeof(s.allowed_modules) is distinct from 'array' or jsonb_array_length(s.allowed_modules) = 0
              or s.allowed_modules ? 'expenses')
   where p.role = 'owner' and p.owner_id is null and coalesce(p.status, 'active') = 'active'
   order by p.created_at, s.created_at limit 1;
  select w.id into v_worker from profiles w
   where w.owner_id = v_owner and w.role in ('worker', 'teamLeader') and coalesce(w.status, 'active') = 'active'
   order by w.created_at limit 1;
  assert v_owner is not null and v_staff is not null and v_worker is not null,
    'need an active main owner with an active staff account allowed Expenses and an active worker';
  -- Start from "no Buyer switch" whatever the live setting is (rolled back below).
  update pur_buyers set is_buyer = false where user_id = v_staff;

  insert into folders (owner_id, name) values (v_owner, 'ZZ 2a3 project') returning id into v_main;
  insert into folders (owner_id, name, parent_folder_id) values (v_owner, 'ZZ 2a3 job', v_main) returning id into v_job;
  insert into projects (owner_id, folder_id, month, year, funding_type, billing_number)
  values (v_owner, v_main, to_char(v_today, 'FMMonth'), extract(year from v_today)::int, 'progress', 1);
  insert into project_budgets (project_id, owner_id, monthly_budget) select id, v_owner, 1000000 from projects where folder_id = v_main;

  perform set_config('v2a3.owner', v_owner::text, true);
  perform set_config('v2a3.staff', v_staff::text, true);
  perform set_config('v2a3.worker', v_worker::text, true);
  perform set_config('v2a3.main', v_main::text, true);
  perform set_config('v2a3.job', v_job::text, true);
  perform set_config('v2a3.today', v_today::text, true);
  -- E (before): every other project's Spent.
  perform set_config('v2a3.others', (select coalesce(sum(e.amount), 0)::text from expenses e join projects p on p.id = e.project_id
                                      where p.owner_id = v_owner and p.folder_id not in (v_main, v_job)), true);
end $$;

-- ═══ A. The sign-in answer ═══
set local role service_role;
do $$
begin
  assert pur_signin_can_buy(current_setting('v2a3.owner')::uuid), 'A1 the main owner may buy';
  assert not pur_signin_can_buy(current_setting('v2a3.staff')::uuid), 'A2 staff without the switch may not';
  assert not pur_signin_can_buy(current_setting('v2a3.worker')::uuid), 'A3 a worker may not';
  assert not pur_signin_can_buy(gen_random_uuid()), 'A4 an unknown id may not';
end $$;
reset role;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('v2a3.owner'), 'role', 'authenticated')::text, true);
do $$
begin
  begin
    perform pur_signin_can_buy(current_setting('v2a3.owner')::uuid);
    raise exception 'A5 a signed-in user called pur_signin_can_buy';
  exception when insufficient_privilege then null;
  end;
  perform pur_set_buyer(current_setting('v2a3.staff')::uuid, true);
end $$;
reset role;
set local role service_role;
do $$
begin
  assert pur_signin_can_buy(current_setting('v2a3.staff')::uuid), 'A6 the switch on → staff may buy at sign-in';
end $$;
reset role;

-- ═══ B–D as the Buyer (staff with the switch on) ═══
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('v2a3.staff'), 'role', 'authenticated')::text, true);
do $$
declare r jsonb; v_list jsonb; v_d jsonb; v_receipt text := 'https://example.test/zz-2a3-receipt.jpg';
begin
  assert pur_buyer(), 'A7 pur_buyer() agrees with the sign-in answer';
  -- B. AW job with no period.
  r := pur_record(gen_random_uuid(), jsonb_build_object('source', 'workmate', 'purchase_date', current_setting('v2a3.today'),
         'receipt_total', 1500, 'docs', jsonb_build_object('po_image_url', v_receipt),
         'lines', jsonb_build_array(jsonb_build_object('folder_id', current_setting('v2a3.job'), 'item_name', 'ZZ 2a3 lumber',
                                                       'unit', 'pc', 'amount', 1500, 'unplanned_reason', 'ZZ test'))));
  assert r ->> 'purchase_id' is not null, 'B1 recorded';
  r := pur_record(gen_random_uuid(), jsonb_build_object('source', 'workmate', 'purchase_date', current_setting('v2a3.today'),
         'receipt_total', 500, 'docs', jsonb_build_object('po_image_url', v_receipt),
         'lines', jsonb_build_array(jsonb_build_object('folder_id', current_setting('v2a3.job'), 'item_name', 'ZZ 2a3 nails',
                                                       'unit', 'box', 'amount', 500, 'unplanned_reason', 'ZZ test'))));
  -- C. No receipt.
  begin
    perform pur_record(gen_random_uuid(), jsonb_build_object('source', 'workmate', 'purchase_date', current_setting('v2a3.today'),
      'receipt_total', 80, 'lines', jsonb_build_array(jsonb_build_object('folder_id', current_setting('v2a3.main'),
                                                     'item_name', 'ZZ 2a3 rope', 'unit', 'pc', 'amount', 80, 'unplanned_reason', 'ZZ test'))));
    raise exception 'C1 a phone purchase without a receipt or a reason was recorded';
  exception when others then
    assert sqlerrm like '%NO_RECEIPT%', 'C1 wrong error: ' || sqlerrm;
  end;
  r := pur_record(gen_random_uuid(), jsonb_build_object('source', 'workmate', 'purchase_date', current_setting('v2a3.today'),
         'receipt_total', 80, 'no_receipt_reason', 'ZZ sari-sari store, no receipt',
         'lines', jsonb_build_array(jsonb_build_object('folder_id', current_setting('v2a3.main'), 'item_name', 'ZZ 2a3 rope',
                                                       'unit', 'pc', 'amount', 80, 'unplanned_reason', 'ZZ test'))));
  perform set_config('v2a3.noreceipt', r ->> 'purchase_id', true);
  r := pur_record(gen_random_uuid(), jsonb_build_object('source', 'purchasing', 'purchase_date', current_setting('v2a3.today'),
         'receipt_total', 20, 'lines', jsonb_build_array(jsonb_build_object('folder_id', current_setting('v2a3.main'),
                                                        'item_name', 'ZZ 2a3 tape', 'unit', 'pc', 'amount', 20, 'unplanned_reason', 'ZZ test'))));
  assert r ->> 'purchase_id' is not null, 'C2 the Purchasing tab still records without a receipt (R5)';
  -- D. My purchases and destinations.
  v_list := pur_my_purchases(60);
  assert (select count(*) from jsonb_array_elements(v_list) x
           where (x -> 'projects') ?| array['ZZ 2a3 project', 'ZZ 2a3 job']) = 4, 'D1 my four ZZ purchases listed';
  assert (select x ->> 'no_receipt_reason' from jsonb_array_elements(v_list) x where x ->> 'id' = current_setting('v2a3.noreceipt'))
         = 'ZZ sari-sari store, no receipt', 'D2 the reason is shown';
  v_d := pur_destinations();
  assert exists (select 1 from jsonb_array_elements(v_d) x where x ->> 'folder_id' = current_setting('v2a3.main')
                    and (x -> 'works') @> jsonb_build_array(jsonb_build_object('folder_id', current_setting('v2a3.job'), 'name', 'ZZ 2a3 job'))),
    'D3 the project and its job are listed';
end $$;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('v2a3.worker'), 'role', 'authenticated')::text, true);
do $$
begin
  begin
    perform pur_my_purchases(60);
    raise exception 'D4 a worker read My purchases';
  exception when others then
    assert sqlerrm like '%BUYER_REQUIRED%' or sqlerrm like '%NOT_OFFICE%', 'D4 wrong error: ' || sqlerrm;
  end;
  begin
    perform pur_destinations();
    raise exception 'D5 a worker read the destinations';
  exception when others then
    assert sqlerrm like '%BUYER_REQUIRED%', 'D5 wrong error: ' || sqlerrm;
  end;
end $$;
reset role;

-- ═══ B and E checked as the database owner ═══
do $$
declare v_n int; v_spent numeric;
begin
  select count(*) into v_n from projects where folder_id = current_setting('v2a3.job')::uuid;
  assert v_n = 1, 'B2 exactly one period for the job, got ' || v_n;
  assert exists (select 1 from projects p where p.folder_id = current_setting('v2a3.job')::uuid and p.funding_type = 'downpayment'
                    and p.month = to_char(current_setting('v2a3.today')::date, 'FMMonth')
                    and not exists (select 1 from project_budgets b where b.project_id = p.id)), 'B3 downpayment, purchase month, no budget row';
  select coalesce(sum(e.amount), 0) into v_spent from expenses e join projects p on p.id = e.project_id
   where p.folder_id = current_setting('v2a3.job')::uuid;
  assert v_spent = 2000, 'B4 the job is charged in full: ' || v_spent;
  assert not exists (select 1 from expenses e join projects p on p.id = e.project_id
                      where p.folder_id = current_setting('v2a3.job')::uuid and e.cover_expense), 'B5 never Cover';
  select coalesce(sum(e.amount), 0) into v_spent from expenses e join projects p on p.id = e.project_id
   where p.owner_id = current_setting('v2a3.owner')::uuid
     and p.folder_id not in (current_setting('v2a3.main')::uuid, current_setting('v2a3.job')::uuid);
  assert v_spent = current_setting('v2a3.others')::numeric, 'E1 no other project''s Spent moved';
end $$;

select '2a3 acceptance: all checks passed' as result;
rollback;
````

- [ ] **Step 6: Document 0101**

Both files use **CRLF**. Make these changes with the Edit tool and keep the CRLF endings. The diffs below are shown without the CRs.

````diff
diff --git a/supabase/migrations/README.md b/supabase/migrations/README.md
--- a/supabase/migrations/README.md
+++ b/supabase/migrations/README.md
@@ -6,8 +6,8 @@
 one-offs — that habit is why `0020_schema_drift_catchup.sql`, `0025` and the drift they
 capture exist. Write the migration, apply the migration, commit the migration.
 
-- **Next number = highest existing + 1** (**0101** — highest on disk is
-  `0100_pm_cash_advances.sql`). Sort the folder before you pick; don't
+- **Next number = highest existing + 1** (**0102** — highest on disk is
+  `0101_purchasing_phone.sql`). Sort the folder before you pick; don't
   trust this line if it looks stale. Duplicate numbers are how we got into trouble.
 - **`0075` and `0076` are TAKEN but not on `main`.** They belong to the abandoned
   project cost-plan branch (`project_cost_plans`, then its `%` columns) and **both
@@ -186,6 +186,8 @@ file creates the policy only when it is missing, so applying it live changes not
 
 **0100 (PM worker cash advances)** Worker cash-advance tracking ledger — four private tables (advances, repayments, append-only events, operation ids) and the `pm_ca_*` functions; owner-role accounts of the company only; outside the money model. Spec docs/superpowers/specs/2026-10-19-worker-cash-advances-design.md **Apply 0100 before pushing the web change** — the Cash Advances tab calls the pm_ca_* functions; without them it shows a raw "could not find the function" error and reports to client_errors.
 
+**0101 (WorkMate Stage 2A-3a — what phone purchasing needs from the server)** adds `pur_signin_can_buy(user)` (service role only: the `attendance-signin` Edge Function's buyer check — the same answer `pur_buyer()` gives that account signed in, its company worked out as `data_owner_id()` does); redefines `pur_fund` (now VOLATILE: an Additional Works job with no billing period gets ONE hidden period — `funding_type 'downpayment'`, the purchase's month and year, no budget row, no allocation snapshot, as the web's staff path makes it — instead of `AW_NO_PERIOD`; the job is still charged in full, never Cover; the job's `pur_folder:` lock keeps it to one period); adds `purchases.no_receipt_reason` with trigger `purchases_require_receipt` (a PHONE purchase, source `workmate`, needs an https receipt link in `docs` or a reason — `NO_RECEIPT`; the web keeps receipts optional) and redefines `pur_insert` only to store the reason (≤ 300, `BAD_REASON`); adds `pur_list_doc` (one purchases-list row, now also `no_receipt_reason` and `replaced_by`), `pur_my_purchases(days)` (what the caller bought or recorded, every status, last 1–366 days), `pur_destinations()` (open projects with their open AW jobs) and `pur_my_pending_changes()` (the caller's own change requests waiting for the owner, with their purchase's line and charge ids — no amounts — for Project Control's "Waiting for the owner" and Withdraw); `pur_purchases` and `pur_purchase_view` show the reason. Spent is computed exactly as before. **Apply 0101 before deploying the `attendance-signin` change and the web change** (both call it). Prove with `npm run test:sql` (`2a3_server.pglite.mjs`, `2a3_concurrency.mjs`, and the 2A-1 / 2A-2 suites re-run `--with-0101`); live: `supabase/tests/2a3_acceptance.sql` (self-wrapped, rolls back).
+
 Get the truth before relying on this line:
 
 ```sql
````

````diff
diff --git a/docs/DATABASE_SCHEMA.md b/docs/DATABASE_SCHEMA.md
--- a/docs/DATABASE_SCHEMA.md
+++ b/docs/DATABASE_SCHEMA.md
@@ -1077,6 +1077,22 @@ The office side of buying: who may buy, who is buying which part of a request, a
 | Storage `uploads/purchases/<company>/<yyyy-mm>/<uuid>.jpg` | One receipt per purchase, read and written only by `pur_buyer()` of that company — not by non-buyer staff, workers, clients or partners. Dacs Web never signs a link for this folder: it downloads with the viewer's session, so Storage checks the rule on every view (`supabase-config.js` §11b). `receipt_uploads` accepts kind `purchase` |
 | Changed 0085/0086/0096 functions | `pr_apply_quantity` (bought quantity is protected like arranged: reduced only by flagging), `pr_office_move_portion` (`BOUGHT`), `pur_reader` (buyers only), `pur_actor_owner` (sources `purchasing`/`workmate` need the switch), `pur_store`, `pur_insert` (7 arguments), `pur_correct` (keeps a line's request link when the body leaves it out — Project Control's form — and its covers' portions), `pur_replace` (voids first, keeps covers' portions, the old buyer and the supplier), `pur_doc`, `pur_header_ok`, `pur_body_keys` / `pur_stored_keys` (`pr_line:` locks) |
 
+## Phone purchasing (0101) — WorkMate Stage 2A-3a
+
+What buying from the WorkMate phone needs from the server. Spec `docs/superpowers/specs/2026-09-30-workmate-mobile-purchasing-design.md`; answers `docs/superpowers/specs/2026-10-20-workmate-stage2a3-questions.md`; plan `docs/superpowers/plans/2026-10-20-workmate-stage2a3a-server-web.md`.
+
+| Table / object | Columns and rules |
+|---|---|
+| `pur_signin_can_buy(user)` | **Service role only.** The `attendance-signin` Edge Function's buyer check: `pur_can_buy` in that account's own company (worked out as `data_owner_id()` does) — the same answer `pur_buyer()` gives the account signed in |
+| `pur_fund` (0096, redefined, now VOLATILE) | An Additional Works job with no billing period gets ONE hidden period (`funding_type 'downpayment'`, the purchase's month and year, no budget row, no allocation snapshot) instead of `AW_NO_PERIOD`. Charged in full to it, never Cover, as before. The job's `pur_folder:` lock keeps it to one |
+| `purchases.no_receipt_reason` (text, ≤ 300, default `''`) | Why a phone purchase has no receipt photo. Trigger `purchases_require_receipt`: a `workmate` purchase must keep an https link in `docs` or a non-blank reason (`NO_RECEIPT`), on insert and on every update of `docs` / the reason / `source`. Web sources keep receipts optional |
+| `pur_insert` (0097, redefined) | Stores `no_receipt_reason` (`BAD_REASON` over 300). Nothing else changed |
+| `pur_list_doc(purchase)` | One purchases-list row: 0097's row plus `no_receipt_reason` and `replaced_by`. Used by `pur_purchases` and `pur_my_purchases` (internal) |
+| `pur_my_purchases(days default 60)` | Buyers only: what the caller bought or recorded, every status, purchase date within the last 1–366 Philippine days (`BAD_DAYS`), newest first, at most 300 |
+| `pur_destinations()` | Buyers only: the company's open projects (name not blank) with their open Additional Works jobs (`works`), for the phone's record form |
+| `pur_my_pending_changes()` | Any account that may record (0096's rule), buyer or not: the caller's OWN pending change requests — `id`, `purchase_id`, `kind`, `reason`, `requested_at`, and the purchase's `line_ids` / `charge_ids`. No amounts. Project Control and Expenses show "Waiting for the owner" on those rows and offer Withdraw (`pur_withdraw_change`) |
+| `pur_purchase_view` (0097, redefined) | Adds `no_receipt_reason` |
+
 ## PM profit sharing (0098)
 
 An internal owner/partner allocation per PM project - **outside the money model** (never a payout, invoice or accounting entry). Spec `docs/superpowers/specs/2026-10-18-pm-profit-sharing-mvp-terms.md`; plan `docs/superpowers/plans/2026-10-18-pm-profit-sharing.md`. `project_id` is a `construction_projects.id` (never a `folders.id`). The three tables have **RLS on, no policies, and all privileges revoked** from `anon`/`authenticated`: nothing reads or writes them directly. Read through `pm_sharing_read` (owner-role accounts of the company); write through `pm_set_sharing` (main owner only).
````

- [ ] **Step 7: Full run**

Run: `npm test` → exit 0. Run: `npm run test:sql` → exit 0, with these totals in order: 45, 10, 45, 44, 5, **45, 44, 23, 2**, 23, 11, 28, 13 (the bold ones are new).

Mutation spot-check (the scratch build did this; optional for the executor). Each of these changes to 0101 must turn the suite red:
1. company worked out as `coalesce(owner_id, id)` for every role;
2. the receipt trigger on insert only;
3. a blank reason counted as a reason;
4. My purchases = recorded only;
5. completed AW jobs listed;
6. AW still refused;
7. the reason not stored.

All 7 are caught. Case 3 only by the direct-update check, because `pur_insert` trims the reason before the trigger sees it.

- [ ] **Step 8: Stop for the user**

Hand back. The user reviews and commits Task 1. Nothing is applied live yet: that is Task 4.

---

### Task 2: `attendance-signin` lets buyers into WorkMate

**Files:**
- Create: `supabase/functions/attendance-signin/eligibility.mjs`, `tests/signin-eligibility.test.js`
- Modify: `supabase/functions/attendance-signin/index.ts`, `.gitignore`, `package.json`

**Interfaces:**
- Consumes: `pur_signin_can_buy(p_user uuid)` (Task 1), through `admin.rpc("pur_signin_can_buy", { p_user })` with the service role.
- Produces (plan 2A-3b's app relies on these):
  - Request header `x-dacs-app: workmate` (already sent by every WorkMate build, 0082). With it:
    - `200 { session, worker, access: "worker" | "buyer" }`
    - `403 { error: "NO_WORKMATE_ACCESS" }` for any other active account
    - `403 { error: "ACCOUNT_INACTIVE" }` for a deactivated one
  - Without the header: exactly the pre-0101 responses (no `access` key, `NOT_A_WORKER` for non-workers).
  - `eligibility.mjs` exports `WORKER_ROLES`, `isWorkMate(app)`, `needsBuyerCheck({role, status, app})`, `decideAccess({role, status, app, canBuy})`, `revokeScope(code)`.

- [ ] **Step 1: Write the test**

Create `tests/signin-eligibility.test.js`:

````js
// ════════════════════════════════════════════════════════════════════
// SIGN-IN ELIGIBILITY TESTS: run with  node tests/signin-eligibility.test.js
//
// Zero dependencies. Guards the attendance-signin Edge Function's one
// decision (supabase/functions/attendance-signin/eligibility.mjs), WorkMate
// Stage 2A-3a (Q1, R1, R3, R9):
//   I.   The old Attendance app (no x-dacs-app header) answers EXACTLY as
//        before 0101, for every role — buyers included.
//   II.  WorkMate admits workers and team leaders as before, and buyers
//        (pur_signin_can_buy) as "buyer"; refuses everyone else with
//        NO_WORKMATE_ACCESS; an inactive account is ACCOUNT_INACTIVE.
//   III. The buyer check is asked only when it can change the answer.
//   IV.  A refusal revokes only the session it just minted, except an
//        inactive account (every session).
//   V.   index.ts wires it: header read, RPC name, response shape.
// ════════════════════════════════════════════════════════════════════
'use strict';
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const DIR = path.join(__dirname, '..', 'supabase/functions/attendance-signin');

let passed = 0, failed = 0;
const failures = [];
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { failed++; failures.push(name + ' — ' + e.message); console.log('  FAIL ' + name + '\n       ' + e.message); }
}
function eq(a, b, m) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error((m || 'not equal') + ': ' + JSON.stringify(a) + ' !== ' + JSON.stringify(b)); }
function ok(v, label) { if (!v) throw new Error(label || 'expected truthy'); }

const ROLES = ['worker', 'teamLeader', 'staff', 'owner', 'client', 'partner', null, ''];
const STATUSES = ['active', null, 'inactive', 'deleted'];

(async () => {
  const E = await import(pathToFileURL(path.join(DIR, 'eligibility.mjs')).href);
  const { decideAccess, needsBuyerCheck, revokeScope, isWorkMate } = E;
  // The function before 0101, written out: the old app must keep exactly this.
  const before = (role, status) => !['worker', 'teamLeader'].includes(role ?? '') ? { ok: false, code: 'NOT_A_WORKER' }
    : (status ?? 'active') !== 'active' ? { ok: false, code: 'ACCOUNT_INACTIVE' } : { ok: true, access: 'worker' };

  console.log('\nI. The old Attendance app is untouched');
  await test('no header: every role and status gets the pre-0101 answer, whatever the buyer check would say', () => {
    for (const role of ROLES) for (const status of STATUSES) for (const canBuy of [false, true]) for (const app of [null, '', 'attendance', 'Attendance']) {
      eq(decideAccess({ role, status, app, canBuy }), before(role, status), JSON.stringify({ role, status, app, canBuy }));
    }
  });
  await test('the old app never triggers the buyer check', () => {
    for (const role of ROLES) for (const status of STATUSES) eq(needsBuyerCheck({ role, status, app: null }), false, role + '/' + status);
  });

  console.log('\nII. WorkMate');
  await test('workers and team leaders: as before', () => {
    for (const role of ['worker', 'teamLeader']) for (const canBuy of [false, true]) {
      eq(decideAccess({ role, status: 'active', app: 'workmate', canBuy }), { ok: true, access: 'worker' }, role);
      eq(decideAccess({ role, status: null, app: 'workmate', canBuy }), { ok: true, access: 'worker' }, role + ' no status');
      eq(decideAccess({ role, status: 'inactive', app: 'workmate', canBuy }), { ok: false, code: 'ACCOUNT_INACTIVE' }, role + ' inactive');
    }
  });
  await test('an account that may buy (owner, admin with Expenses, Buyer staff) comes in as a buyer', () => {
    for (const role of ['staff', 'owner']) {
      eq(decideAccess({ role, status: 'active', app: 'workmate', canBuy: true }), { ok: true, access: 'buyer' }, role);
      eq(decideAccess({ role, status: null, app: 'workmate', canBuy: true }), { ok: true, access: 'buyer' }, role + ' no status');
    }
  });
  await test('everyone else is refused NO_WORKMATE_ACCESS; inactive is ACCOUNT_INACTIVE', () => {
    for (const role of ['staff', 'owner', 'client', 'partner', null, '']) {
      eq(decideAccess({ role, status: 'active', app: 'workmate', canBuy: false }), { ok: false, code: 'NO_WORKMATE_ACCESS' }, String(role));
      eq(decideAccess({ role, status: 'inactive', app: 'workmate', canBuy: false }), { ok: false, code: 'ACCOUNT_INACTIVE' }, role + ' inactive');
      // An inactive account is never let in, even if a stale check said it could buy.
      eq(decideAccess({ role, status: 'inactive', app: 'workmate', canBuy: true }), { ok: false, code: 'ACCOUNT_INACTIVE' }, role + ' inactive+canBuy');
    }
  });
  await test('the header is read the way the server reads it (trimmed, any case); anything else is the old app', () => {
    for (const app of ['workmate', 'WorkMate', ' workmate ', 'WORKMATE']) ok(isWorkMate(app), app);
    for (const app of [null, undefined, '', 'attendance', 'workmate2', 'work mate']) ok(!isWorkMate(app), String(app));
  });

  console.log('\nIII. The buyer check');
  await test('asked only for an active non-worker coming from WorkMate', () => {
    eq(needsBuyerCheck({ role: 'staff', status: 'active', app: 'workmate' }), true, 'staff');
    eq(needsBuyerCheck({ role: 'owner', status: null, app: 'workmate' }), true, 'owner');
    eq(needsBuyerCheck({ role: 'worker', status: 'active', app: 'workmate' }), false, 'worker');
    eq(needsBuyerCheck({ role: 'teamLeader', status: 'active', app: 'workmate' }), false, 'leader');
    eq(needsBuyerCheck({ role: 'staff', status: 'inactive', app: 'workmate' }), false, 'inactive');
  });

  console.log('\nIV. What a refusal revokes');
  await test('an inactive account loses every session; any other refusal only the one just minted', () => {
    eq(revokeScope('ACCOUNT_INACTIVE'), 'global', 'inactive');
    eq(revokeScope('NOT_A_WORKER'), 'local', 'not a worker');
    eq(revokeScope('NO_WORKMATE_ACCESS'), 'local', 'no access');
    eq(revokeScope('SERVER_ERROR'), 'local', 'server error');
  });

  console.log('\nV. index.ts wiring');
  const src = fs.readFileSync(path.join(DIR, 'index.ts'), 'utf8').replace(/\r\n/g, '\n');
  await test('index.ts decides with eligibility.mjs, reads the x-dacs-app header and asks pur_signin_can_buy', () => {
    ok(/from "\.\/eligibility\.mjs"/.test(src), 'imports eligibility.mjs');
    ok(/req\.headers\.get\("x-dacs-app"\)/.test(src), 'reads x-dacs-app');
    ok(/admin\.rpc\(\s*"pur_signin_can_buy",\s*\{\s*p_user:\s*auth\.user\.id\s*\}/.test(src), 'calls pur_signin_can_buy with the signed-in id');
    ok(/needsBuyerCheck\(/.test(src) && /decideAccess\(/.test(src) && /revokeScope\(/.test(src), 'uses all three rules');
    ok(!/WORKER_ROLES\.includes/.test(src), 'no second copy of the role rule left in index.ts');
  });
  await test('the old app gets the old response shape; WorkMate also gets "access"', () => {
    ok(/fromWorkMate \? \{ \.\.\.payload, access: decision\.access \} : payload/.test(src), 'access only for WorkMate');
    ok(/signOut\(session\.access_token, scope\)/.test(src), 'revoke with the decided scope');
  });

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  if (failed) { console.log('\nFAILURES:\n  ' + failures.join('\n  ')); process.exit(1); }
})();
````

Register it (`npm test`):

````diff
diff --git a/package.json b/package.json
--- a/package.json
+++ b/package.json
@@ -1,6 +1,6 @@
 {
   "scripts": {
-    "test": "node tests/money-math.test.js && node tests/reimbursement.test.js && node tests/quotation.test.js && node tests/quotation-pdf-import.test.js && node tests/shim-fromrow.test.js && node tests/shim-docref.test.js && node tests/shim-omit.test.js && node tests/folder-completion.test.js && node tests/attendance.test.js && node tests/billing-allocation.test.js && node tests/app-updates.test.js && node tests/storage-access.test.js && node tests/app-streams.test.js && node tests/booking.test.js && node tests/workmate-requests.test.js && node tests/workmate-requests-office.test.js && node tests/requests-admin.test.js && node tests/shim-addmany.test.js && node tests/receipt-storage.test.js && node tests/receipt-save-paths.test.js && node tests/receipt-print-popups.test.js && node tests/workmate-history.test.js && node tests/project-control-staff.test.js && node tests/workmate-workplan.test.js && node tests/workmate-office-server.test.js && node tests/workplan-admin.test.js && node tests/ai-worker.test.js && node tests/workplan-screens.test.js && node tests/purchase-server.test.js && node tests/purchase-screens.test.js && node tests/expense-split-rows.test.js && node tests/staff-payroll-period.test.js && node tests/purchasing-admin.test.js && node tests/purchasing-server.test.js && node tests/pm-sharing.test.js && node tests/cash-advance.test.js && node tests/purchasing-phone-server.test.js",
+    "test": "node tests/money-math.test.js && node tests/reimbursement.test.js && node tests/quotation.test.js && node tests/quotation-pdf-import.test.js && node tests/shim-fromrow.test.js && node tests/shim-docref.test.js && node tests/shim-omit.test.js && node tests/folder-completion.test.js && node tests/attendance.test.js && node tests/billing-allocation.test.js && node tests/app-updates.test.js && node tests/storage-access.test.js && node tests/app-streams.test.js && node tests/booking.test.js && node tests/workmate-requests.test.js && node tests/workmate-requests-office.test.js && node tests/requests-admin.test.js && node tests/shim-addmany.test.js && node tests/receipt-storage.test.js && node tests/receipt-save-paths.test.js && node tests/receipt-print-popups.test.js && node tests/workmate-history.test.js && node tests/project-control-staff.test.js && node tests/workmate-workplan.test.js && node tests/workmate-office-server.test.js && node tests/workplan-admin.test.js && node tests/ai-worker.test.js && node tests/workplan-screens.test.js && node tests/purchase-server.test.js && node tests/purchase-screens.test.js && node tests/expense-split-rows.test.js && node tests/staff-payroll-period.test.js && node tests/purchasing-admin.test.js && node tests/purchasing-server.test.js && node tests/pm-sharing.test.js && node tests/cash-advance.test.js && node tests/purchasing-phone-server.test.js && node tests/signin-eligibility.test.js",
     "build": "node -e \"console.error('\\n*** BUILD DISABLED (2026-07-03) ***\\njs/portal-app.compiled.js IS the source of truth — edit it directly.\\nThe stale JSX source was deleted on 2026-07-28; there is nothing to build from.\\nSee README.md section 13.\\n'); process.exit(1)\"",
     "build:watch": "npm run build",
     "build:prod": "npm run build",
````

- [ ] **Step 2: Run it and see it fail**

Run: `node tests/signin-eligibility.test.js`
Expected: `ERR_MODULE_NOT_FOUND … supabase/functions/attendance-signin/eligibility.mjs`.

- [ ] **Step 3: Write the rule**

Create `supabase/functions/attendance-signin/eligibility.mjs`:

````js
// ════════════════════════════════════════════════════════════════════
// Who the attendance-signin function lets in — the one decision, kept
// free of Deno and Supabase so tests/signin-eligibility.test.js can run it
// under plain Node (CI runs Node 20, which cannot load TypeScript).
//
// The old DACS Attendance app sends no x-dacs-app header: it gets exactly
// the pre-0101 answer for every account. DAC'S WorkMate sends
// `x-dacs-app: workmate` (0082): it also lets in an account that may buy
// (pur_signin_can_buy, 0101 — the server's own pur_buyer() rule), as a
// "buyer". WorkMate Stage 2A-3a: Q1, R1, R3, R9.
// ════════════════════════════════════════════════════════════════════

/** Same rule as attendance_time_in (0050 §8): a team leader records attendance like a worker. */
export const WORKER_ROLES = ['worker', 'teamLeader'];

/** The header test the server uses (0082): trimmed, any case. */
export function isWorkMate(app) {
  return String(app ?? '').trim().toLowerCase() === 'workmate';
}

const isWorkerRole = (role) => WORKER_ROLES.includes(role ?? '');
// coalesce(status, 'active') — matches the RPCs: older profiles carry no status.
const isActive = (status) => (status ?? 'active') === 'active';

/**
 * Whether to ask pur_signin_can_buy at all: only when its answer can change
 * the outcome (an active non-worker signing in from WorkMate).
 * @param {{role: string|null, status: string|null, app: string|null}} p
 */
export function needsBuyerCheck({ role, status, app }) {
  return isWorkMate(app) && !isWorkerRole(role) && isActive(status);
}

/**
 * @param {{role: string|null, status: string|null, app: string|null, canBuy: boolean}} p
 * @returns {{ok: true, access: 'worker'|'buyer'} | {ok: false, code: string}}
 */
export function decideAccess({ role, status, app, canBuy }) {
  if (!isWorkMate(app)) {
    // The old app, byte for byte as before 0101: role first, then status.
    if (!isWorkerRole(role)) return { ok: false, code: 'NOT_A_WORKER' };
    if (!isActive(status)) return { ok: false, code: 'ACCOUNT_INACTIVE' };
    return { ok: true, access: 'worker' };
  }
  if (!isActive(status)) return { ok: false, code: 'ACCOUNT_INACTIVE' };
  if (isWorkerRole(role)) return { ok: true, access: 'worker' };
  if (canBuy === true) return { ok: true, access: 'buyer' };
  return { ok: false, code: 'NO_WORKMATE_ACCESS' };
}

/**
 * What a refusal revokes (R9). A deactivated account loses every session,
 * as before. Any other refusal revokes only the session this sign-in just
 * made: an office account that tried the phone stays signed in to Dacs Web.
 */
export function revokeScope(code) {
  return code === 'ACCOUNT_INACTIVE' ? 'global' : 'local';
}
````

- [ ] **Step 4: Let git keep it (R10)**

````diff
diff --git a/.gitignore b/.gitignore
--- a/.gitignore
+++ b/.gitignore
@@ -31,6 +31,8 @@
 !.gitattributes
 !cloudflare-worker/wrangler.toml
 !supabase/tests/*.mjs
+# An Edge Function's plain-JS module (Node-tested, e.g. attendance-signin/eligibility.mjs).
+!supabase/functions/*/*.mjs
 
 # ── Exclude generated/build folders ────────────────────────
 node_modules/
````

Check: `git status --short supabase/functions` must list `?? supabase/functions/attendance-signin/eligibility.mjs`. If it lists nothing, the file is still ignored.

- [ ] **Step 5: Use it in the function**

````diff
diff --git a/supabase/functions/attendance-signin/index.ts b/supabase/functions/attendance-signin/index.ts
--- a/supabase/functions/attendance-signin/index.ts
+++ b/supabase/functions/attendance-signin/index.ts
@@ -1,7 +1,9 @@
 // ════════════════════════════════════════════════════════════════════
 // Edge Function: attendance-signin
 //
-// Signs a construction worker into the native Android attendance app.
+// Signs a construction worker into the native Android attendance app —
+// and, from DAC'S WorkMate only (x-dacs-app: workmate), an office account
+// that may buy (WorkMate Stage 2A-3a, migration 0101).
 //
 // ── WHY THE APP DOES NOT CALL /auth/v1/token DIRECTLY. This project
 //    enforces Cloudflare Turnstile on auth (Auth → Bot & Abuse
@@ -21,6 +23,16 @@
 //    or a non-worker account never receives tokens at all, and the ones
 //    that were minted along the way are revoked before we answer. The
 //    app therefore cannot end up holding a session it should not have.
+//    The rule lives in eligibility.mjs (tests/signin-eligibility.test.js):
+//      old app (no header) — workers and team leaders only, exactly as
+//        before 0101;
+//      WorkMate — workers and team leaders as "worker", plus any account
+//        pur_signin_can_buy (0101) says may buy, as "buyer" (the same
+//        answer as the server's pur_buyer()); everyone else
+//        NO_WORKMATE_ACCESS.
+//    A refusal revokes only the session it just made (an office account
+//    that tried the phone stays signed in to Dacs Web), except a
+//    deactivated account, which loses every session.
 //
 // ── NO CORS HEADERS, deliberately. This endpoint is for the native app.
 //    Without Access-Control-Allow-Origin a browser cannot read the
@@ -30,7 +42,9 @@
 // POST { email, password }
 //   → 200 { session: { access_token, refresh_token, expires_in, token_type },
 //           worker:  { id, email, display_name, position, worker_no, role, status } }
-//   → 4xx { error: CODE }   INVALID_CREDENTIALS | NOT_A_WORKER |
+//         + access: "worker" | "buyer"            (WorkMate only)
+//   → 4xx { error: CODE }   INVALID_CREDENTIALS | NOT_A_WORKER (old app) |
+//                           NO_WORKMATE_ACCESS (WorkMate) |
 //                           ACCOUNT_INACTIVE | TOO_MANY_ATTEMPTS | BAD_REQUEST
 //   → 5xx { error: "SERVER_ERROR" }
 //
@@ -40,14 +54,11 @@
 // Deploy: supabase functions deploy attendance-signin
 // ════════════════════════════════════════════════════════════════════
 import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
+import { decideAccess, isWorkMate, needsBuyerCheck, revokeScope } from "./eligibility.mjs";
 
 const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
 const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
 
-// Same rule as attendance_time_in (0050 §8): teamLeader records
-// attendance exactly like a worker does.
-const WORKER_ROLES = ["worker", "teamLeader"];
-
 const json = (body: unknown, status: number) =>
   new Response(JSON.stringify(body), {
     status,
@@ -70,6 +81,10 @@ Deno.serve(async (req) => {
   const password = String(body.password ?? "");
   if (!email || !password) return fail("BAD_REQUEST", 400);
 
+  // 0082: WorkMate says who it is; the old app sends nothing.
+  const app = req.headers.get("x-dacs-app");
+  const fromWorkMate = isWorkMate(app);
+
   // First hop only: the rest of x-forwarded-for is caller-supplied and
   // trivially spoofed, so throttling on it would be throttling on a
   // string the attacker picks.
@@ -126,9 +141,10 @@ Deno.serve(async (req) => {
   const session = auth.session;
 
   // Tokens exist from here on. Any refusal below must revoke them.
-  const revoke = async () => {
+  const revoke = async (code: string) => {
+    const scope = revokeScope(code);
     try {
-      await admin.auth.admin.signOut(session.access_token, "global");
+      await admin.auth.admin.signOut(session.access_token, scope);
     } catch (e) {
       console.error("could not revoke session for refused sign-in", e);
     }
@@ -143,28 +159,41 @@ Deno.serve(async (req) => {
 
   if (profErr) {
     console.error("profile read failed", profErr);
-    await revoke();
+    await revoke("SERVER_ERROR");
     return fail("SERVER_ERROR", 500);
   }
 
-  if (!profile || !WORKER_ROLES.includes(profile.role ?? "")) {
-    await record(true); // the password WAS right; not a brute-force signal
-    await revoke();
-    return fail("NOT_A_WORKER", 403);
+  const role = profile?.role ?? null;
+  // coalesce(status,'active') — matches the RPCs exactly (eligibility.mjs).
+  // Older profiles rows carry no status, and locking those workers out would
+  // be a bug attendance_time_in does not have.
+  const status = profile?.status ?? null;
+
+  // ── 4. May this account buy? (WorkMate, active non-workers only) ──
+  let canBuy = false;
+  if (profile && needsBuyerCheck({ role, status, app })) {
+    const { data: buys, error: buyErr } = await admin.rpc(
+      "pur_signin_can_buy", { p_user: auth.user.id },
+    );
+    if (buyErr) {
+      console.error("buyer check failed", buyErr);
+      await revoke("SERVER_ERROR");
+      return fail("SERVER_ERROR", 500);
+    }
+    canBuy = buys === true;
   }
 
-  // coalesce(status,'active') — matches the RPCs exactly. Older profiles
-  // rows carry no status, and locking those workers out would be a bug
-  // attendance_time_in does not have.
-  if ((profile.status ?? "active") !== "active") {
-    await record(true);
-    await revoke();
-    return fail("ACCOUNT_INACTIVE", 403);
-  }
+  const decision = profile
+    ? decideAccess({ role, status, app, canBuy })
+    : { ok: false as const, code: fromWorkMate ? "NO_WORKMATE_ACCESS" : "NOT_A_WORKER" };
 
-  await record(true);
+  await record(true); // the password WAS right; not a brute-force signal
+  if (!decision.ok) {
+    await revoke(decision.code);
+    return fail(decision.code, 403);
+  }
 
-  return json({
+  const payload = {
     session: {
       access_token: session.access_token,
       refresh_token: session.refresh_token,
@@ -172,5 +201,7 @@ Deno.serve(async (req) => {
       token_type: session.token_type,
     },
     worker: profile,
-  }, 200);
+  };
+  // The old app gets exactly the old shape.
+  return json(fromWorkMate ? { ...payload, access: decision.access } : payload, 200);
 });
````

- [ ] **Step 6: Run the tests and type-check the function**

- `node tests/signin-eligibility.test.js` → `10 passed, 0 failed`
- `cd supabase/functions/attendance-signin && npx --yes deno check index.ts` → ends with `Check index.ts` and no error. Deno 2.9.6 through npx; it downloads `supabase-js` from esm.sh. The original file checks the same way.
- `npm test` → exit 0

- [ ] **Step 7: Stop for the user**

Hand back. The user commits Task 2.

---

### Task 3: Dacs Web — Source, project filter, typed void, Record again, "Waiting for the owner"

**Files:**
- Modify: `tests/purchasing-admin.test.js`, `js/purchasing-admin-core.js`, `js/purchasing-admin-purchases.js`, `js/purchasing-admin-record.js`, `js/expenses-module.js`, `js/portal-app.compiled.js`, `admin.html`

**Interfaces:**
- Consumes: `pur_purchases(p_from, p_to, p_folder, p_status)` (its `p_folder` filter already includes the project's Additional Works), `pr_office_projects()` (0090: top-level projects with a `completed` flag), `pur_withdraw_change(p_request)` (0097), and from Task 1 `pur_my_pending_changes()` and the rows' `no_receipt_reason` / `replaced_by`.
- Produces (pure, exported by `purchasing-admin-core.js` under Node):
  - `sourceLabel(source)`, `SOURCE_LABEL`, `searchPurchases(rows, text)`
  - `voidWord(places)`, `voidConfirmed(word, typed)`, `placesOf(doc)`
  - `canRecordAgain(doc)`, `chargesOf(doc)`, `recordAgainState(doc, me)`
  - Error words for `NO_RECEIPT`, `BAD_REASON`, `CONFIRM_WORD`
- Browser globals: `window.expPurPendingChange(lineOrChargeId) → request | null`, refreshed by `_purLoadReviewFlags()`, which still fires `dacs:pur-review-flags`.

- [ ] **Step 1: Write the tests**

`pr_office_projects` joins the Purchasing screens' allowed RPCs. The 11 new tests go before the final summary.

````diff
diff --git a/tests/purchasing-admin.test.js b/tests/purchasing-admin.test.js
--- a/tests/purchasing-admin.test.js
+++ b/tests/purchasing-admin.test.js
@@ -144,7 +144,9 @@ test('the screens call only purchasing RPCs and write no table directly', () =>
   const allowed = new Set(['pur_me', 'pur_shopping_list', 'pur_assign_portion', 'pr_office_set_arranged', 'pr_office_batches',
     'pur_buyer_options', 'pur_suppliers', 'pur_save_supplier', 'pur_record', 'pur_correct', 'pur_replace', 'pur_void',
     'pur_purchases', 'pur_purchase', 'pur_check_unit', 'pur_request_change', 'pur_change_requests', 'pur_decide_change',
-    'pur_withdraw_change']);
+    'pur_withdraw_change',
+    // 2A-3a: the Purchases list's project filter (read-only, office accounts).
+    'pr_office_projects']);
   for (const f of ['purchasing-admin-core', 'purchasing-admin-list', 'purchasing-admin-record', 'purchasing-admin-purchases']) {
     const src = read('js/' + f + '.js');
     for (const m of src.matchAll(/rpc\('([a-z_]+)'/g)) ok(allowed.has(m[1]), f + ' calls ' + m[1]);
@@ -367,6 +369,128 @@ test('final minor 6: BAD_DOCS has plain words in the Purchasing tab and in Expen
   ok(/BAD_DOCS:\s+'A receipt photo link is not valid/.test(read('js/expenses-module.js')), '_purErrorText');
 });
 
+console.log('\npurchasing-admin: 2A-3a (20 Oct) — where a purchase came from, typed void, Record again, waiting for the owner');
+
+test('Q17: each purchase says where it came from — Project Control, Purchasing or Phone', () => {
+  eq(pa.sourceLabel('expenses_form'), 'Project Control');
+  eq(pa.sourceLabel('purchasing'), 'Purchasing');
+  eq(pa.sourceLabel('workmate'), 'Phone');
+  eq(pa.sourceLabel('something new'), 'something new', 'an unknown source is shown as it is');
+  const list = read('js/purchasing-admin-purchases.js');
+  ok(/<th>Source<\/th>/.test(list) && /PA\.sourceLabel\(p\.source\)/.test(list), 'the list has a Source column');
+});
+test('Q17: search matches every word against supplier, projects, people and source', () => {
+  const rows = [
+    { id: 1, supplier: 'Wilcon Depot', projects: ['Barlin Residence'], warehouse: false, bought_by_name: 'Juan', recorded_by_name: 'Juan', source: 'workmate', receipt_total: 1500 },
+    { id: 2, supplier: 'Citi Hardware', projects: ['Sulit Residence', 'Prado'], warehouse: true, bought_by_name: 'Pedro', recorded_by_name: 'admin', source: 'expenses_form', receipt_total: 15750 },
+  ];
+  eq(pa.searchPurchases(rows, '').map(r => r.id), [1, 2], 'empty search keeps all');
+  eq(pa.searchPurchases(rows, 'barlin').map(r => r.id), [1], 'project, any case');
+  eq(pa.searchPurchases(rows, 'hardware sulit').map(r => r.id), [2], 'every word must match');
+  eq(pa.searchPurchases(rows, 'project control').map(r => r.id), [2], 'by source label');
+  eq(pa.searchPurchases(rows, 'phone').map(r => r.id), [1], 'phone');
+  eq(pa.searchPurchases(rows, 'warehouse').map(r => r.id), [2], 'warehouse');
+  eq(pa.searchPurchases(rows, 'admin').map(r => r.id), [2], 'who recorded it');
+  eq(pa.searchPurchases(rows, '15750').map(r => r.id), [2], 'the total');
+  eq(pa.searchPurchases(rows, 'nothing-like-this').map(r => r.id), [], 'no match');
+});
+test('Q17: the Purchases list filters by project (and its Additional Works) on the server', () => {
+  const list = read('js/purchasing-admin-purchases.js');
+  ok(/RA\.rpc\('pur_purchases', \{ p_from: ui\.from \|\| null, p_to: ui\.to \|\| null, p_folder: ui\.folder \|\| null, p_status: ui\.status \}\)/.test(list), 'p_folder is the chosen project');
+  ok(/RA\.rpc\('pr_office_projects'\)/.test(list), 'the project choices come from pr_office_projects (completed ones included)');
+  ok(/data-folder/.test(list) && /data-search/.test(list), 'a project filter and a search box');
+});
+test('R6: the word to type — the one project\'s first word, else VOID', () => {
+  eq(pa.voidWord(['Barlin Residence']), 'Barlin');
+  eq(pa.voidWord(['Barlin Residence', 'Barlin Residence']), 'Barlin', 'several lines, one project');
+  eq(pa.voidWord(['J. Apo Residence']), 'J.', 'the first word as written');
+  eq(pa.voidWord(['(ZZ) test']), 'ZZ', 'brackets around a word are not part of it');
+  eq(pa.voidWord(['Barlin Residence · Main Contract']), 'Barlin', 'an approval\'s "where" label');
+  eq(pa.voidWord(['Barlin Residence', 'Prado']), 'VOID', 'two projects');
+  eq(pa.voidWord(['Warehouse']), 'VOID', 'warehouse only');
+  eq(pa.voidWord(['Barlin', 'Warehouse']), 'VOID', 'project + warehouse');
+  eq(pa.voidWord([]), 'VOID', 'nothing known');
+  eq(pa.voidWord(['   ']), 'VOID', 'a blank name');
+  ok(pa.voidConfirmed('Barlin', ' barlin ') && pa.voidConfirmed('VOID', 'void'), 'trimmed, any case');
+  ok(!pa.voidConfirmed('Barlin', 'Barli') && !pa.voidConfirmed('Barlin', '') && !pa.voidConfirmed('Barlin', null), 'anything else is refused');
+});
+test('R6: the places of a purchase (purchase view) and of an approval (review doc)', () => {
+  eq(pa.placesOf({ lines: [{ destination: 'project', folder_name: 'Barlin' }, { destination: 'warehouse', folder_name: '' }] }), ['Barlin', 'Warehouse']);
+  eq(pa.placesOf({ lines: [{ where: 'Sulit · Main Contract' }, { where: 'Warehouse' }] }), ['Sulit · Main Contract', 'Warehouse']);
+  eq(pa.placesOf(null), []);
+});
+test('R6: Void asks for the word, and so does the owner\'s approval of a staff void', () => {
+  const src = read('js/purchasing-admin-purchases.js');
+  ok(/const word = PA\.voidWord\(PA\.placesOf\(doc\)\)/.test(src), 'the purchase page works the word out');
+  ok(/if \(!PA\.voidConfirmed\(word, form\.confirm\.value\)\) throw new Error\('CONFIRM_WORD'\)/.test(src), 'Void is refused without it');
+  ok(/r\.kind === 'void'/.test(src) && /PA\.voidWord\(PA\.placesOf\(r\.base\)\)/.test(src), 'an approved void asks for the word too');
+  ok(/CONFIRM_WORD:/.test(read('js/purchasing-admin-core.js')), 'the refusal has words');
+  // Project Control's own delete keeps its dialog (R6): one row, its project already on screen.
+  ok(!/voidWord/.test(read('js/expenses-module.js')), 'Project Control is unchanged');
+});
+test('Q8: "No receipt" is flagged in the list and shown on the purchase', () => {
+  eq(pa.purchaseFlags({ status: 'recorded', no_receipt_reason: 'sari-sari store' }).map(f => f.text), ['No receipt']);
+  eq(pa.purchaseFlags({ status: 'recorded', no_receipt_reason: '' }).map(f => f.text), []);
+  ok(/doc\.no_receipt_reason/.test(read('js/purchasing-admin-purchases.js')), 'the purchase page shows the reason');
+  ok(/NO_RECEIPT:/.test(read('js/purchasing-admin-core.js')), 'NO_RECEIPT has words');
+});
+test('R7: Record again only from a voided purchase nothing replaced', () => {
+  ok(pa.canRecordAgain({ status: 'void', replaced_by: null }), 'voided');
+  ok(!pa.canRecordAgain({ status: 'void', replaced_by: 'x' }), 'voided because a correction replaced it: its newer version exists');
+  ok(!pa.canRecordAgain({ status: 'recorded' }), 'still recorded');
+  ok(/PA\.canRecordAgain\(doc\)/.test(read('js/purchasing-admin-purchases.js')) &&
+     /PA\.openRecord\(\{ again: doc \}\)/.test(read('js/purchasing-admin-purchases.js')), 'the button opens the form with the copy');
+});
+test('R7: Record again copies the purchase into a NEW one; request links are re-checked, picks are not copied', () => {
+  const doc = {
+    id: 'P1', status: 'void', purchase_date: '2026-10-14', date_time: '2026-10-14T09:30', supplier: 'Wilcon', supplier_id: 'S1',
+    payment_method: 'Cash', notes: 'n', bought_by: 'B1', docs: { po_image_url: 'https://x/a.jpg', delivery_receipt_url: '' },
+    lines: [
+      { line: 1, destination: 'project', folder_id: 'F1', folder_name: 'Barlin', item_name: 'Cement', category: 'Materials', quantity: 6, unit: 'bag',
+        amount: 1500, request_line_id: 'L1', portion_picks: [{ portion_id: 'X', quantity: 6 }], covered: 6, extra: 0, substitute: false },
+      { line: 2, destination: 'warehouse', folder_id: null, folder_name: '', item_name: 'Tape', category: 'Materials', quantity: 2, unit: 'roll',
+        amount: 100, request_line_id: null, unplanned_reason: 'spare', in_inventory: true },
+    ],
+    requests: [{ line: 1, request_line_id: 'L1', description: 'Cement', spec: '40kg', unit: 'bag', needed: 10, bought: 4 }],
+    charges: [{ kind: 'delivery_fee', amount: 100, shares: [{ line: 1, amount: 50 }, { line: 2, amount: 50 }] }],
+  };
+  const s = pa.recordAgainState(doc, { userId: 'B2', isOwner: false });
+  eq([s.purchaseDate, s.dateTime, s.supplierId, s.supplier, s.paymentMethod, s.notes], ['2026-10-14', '2026-10-14T09:30', 'S1', '', 'Cash', 'n'], 'header');
+  eq(s.boughtBy, 'B2', 'a non-owner records it as their own purchase');
+  eq(pa.recordAgainState(doc, { userId: 'O', isOwner: true }).boughtBy, 'B1', 'the owner keeps who bought it');
+  eq(s.docs, { po_image_url: 'https://x/a.jpg' }, 'the receipt photo is copied (empty slots dropped)');
+  eq(s.onFile, ['po_image_url'], 'shown as on file');
+  const [a, b] = s.lines;
+  eq([a.requestLineId, a.requestName, a.requestUnit, a.still, a.portionPicks, a.portions, a.copied], ['L1', 'Cement 40kg', 'bag', 6, [], null, true],
+    'request link kept; Still to buy as it is NOW (10 − 4); no picks copied');
+  eq(a.origQuantity, undefined, 'a new purchase: buying over Still to buy needs its reason again');
+  eq([a.match, a.quantity, a.amount, a.folderId, a.folderLabel], ['wording', 6, '1500', 'F1', 'Barlin'], 'line copied');
+  eq([b.destination, b.requestLineId, b.unplannedReason, b.inInventory], ['warehouse', null, 'spare', true], 'warehouse line copied');
+  eq(s.charges, [{ kind: 'delivery_fee', amount: '100', adjust: true, shares: ['50', '50'] }], 'an adjusted split stays adjusted');
+  const body = pa.buildBody(Object.assign({}, s, { lines: s.lines.map(l => Object.assign({}, l, { quantity: l.quantity, amount: Number(l.amount) })),
+    charges: s.charges.map(c => ({ kind: c.kind, amount: Number(c.amount), shares: c.shares.map(Number) })) }));
+  eq(body.lines[0].portion_picks, [], 'the server covers in its usual order — never a portion bought since');
+  eq(body.receipt_total, 1700, 'adds up');
+  const rec = read('js/purchasing-admin-record.js');
+  ok(/ctx\.again \? fromAgain\(ctx\.again, me\)/.test(rec), 'the form starts from the copy');
+  ok(/editId: null/.test(rec.slice(rec.indexOf('function fromAgain'))), 'a copy is a new purchase (pur_record), never a correction');
+});
+test('Q16: Project Control shows "Waiting for the owner" and offers Withdraw', () => {
+  const em = read('js/expenses-module.js');
+  ok(/rpc\('pur_my_pending_changes'\)/.test(em), 'loads the sender\'s own pending changes');
+  ok(/window\.expPurPendingChange = /.test(em), 'exposes them per line / charge id');
+  ok(/rpc\('pur_withdraw_change', \{ p_request: /.test(em), 'Withdraw');
+  ok((em.match(/await _purOfferWithdraw\(/g) || []).length >= 2, 'asked before editing AND before voiding a row that is waiting');
+  ok(/Waiting for the owner/.test(read('js/portal-app.compiled.js')) && /expPurPendingChange/.test(read('js/portal-app.compiled.js')),
+    'Project Control\'s Materials list shows the pill');
+});
+test('2A-3a: changed scripts are re-fetched (cache-busters bumped)', () => {
+  const html = read('admin.html');
+  for (const f of ['purchasing-admin-core', 'purchasing-admin-purchases', 'purchasing-admin-record', 'expenses-module']) {
+    ok(new RegExp('js/' + f + '\\.js\\?v=20261020a').test(html), f + ' bumped');
+  }
+});
+
 Promise.all(pending).then(() => {
   console.log('\n' + passed + ' passed, ' + failed + ' failed');
   if (failed) { console.log('\nFAILURES:\n  ' + failures.join('\n  ')); process.exit(1); }
````

- [ ] **Step 2: Run them and see them fail**

Run: `node tests/purchasing-admin.test.js`
Expected: `33 passed, 11 failed`. The 11 are the new tests; the 33 earlier ones still pass.

- [ ] **Step 3: The pure helpers**

````diff
diff --git a/js/purchasing-admin-core.js b/js/purchasing-admin-core.js
--- a/js/purchasing-admin-core.js
+++ b/js/purchasing-admin-core.js
@@ -5,6 +5,9 @@
 //   js/purchasing-admin-record.js    — record a purchase (one receipt, many lines)
 //   js/purchasing-admin-purchases.js — purchases, one purchase, owner approvals
 //
+// 2A-3a (0101): where a purchase came from (Source), a search over the
+// list, the word typed before a void (R6), "No receipt", Record again (R7).
+//
 // Unlike the rest of Requests this tab shows PESO amounts — only to those
 // the server lets buy (owner, admin accounts allowed Expenses, staff with
 // the Buyer switch: CLAUDE.md "Purchasing — staff exception"). Every rule
@@ -292,6 +295,7 @@
     function purchaseFlags(p) {
         const f = [];
         if (p.status === 'void') f.push({ text: 'Void', tone: 'hidden' });
+        if (p.no_receipt_reason) f.push({ text: 'No receipt', tone: 'abandoned' });
         if (p.pending_change) f.push({ text: 'Owner approval pending', tone: 'working' });
         if (p.unit_check) f.push({ text: 'Unit check', tone: 'abandoned' });
         if (p.needs_review) f.push({ text: 'Office review', tone: 'working' });
@@ -300,6 +304,99 @@
         return f;
     }
 
+    // Where a purchase was entered (purchases.source).
+    const SOURCE_LABEL = { expenses_form: 'Project Control', purchasing: 'Purchasing', workmate: 'Phone' };
+    function sourceLabel(source) {
+        return SOURCE_LABEL[source] || String(source || '');
+    }
+
+    // The Purchases list's search: every typed word must appear in the
+    // supplier, a project, who bought or recorded it, the source or the total.
+    function searchPurchases(rows, text) {
+        const words = String(text || '').toLowerCase().split(/\s+/).filter(Boolean);
+        if (!words.length) return (rows || []).slice();
+        return (rows || []).filter(p => {
+            const hay = [p.supplier, (p.projects || []).join(' '), p.warehouse ? 'warehouse' : '', p.bought_by_name,
+                         p.recorded_by_name, sourceLabel(p.source), String(p.receipt_total == null ? '' : p.receipt_total)]
+                .join(' ').toLowerCase();
+            return words.every(w => hay.includes(w));
+        });
+    }
+
+    // R6: before a void the person types a word. One project → its first
+    // word (brackets and quotes trimmed off); several projects, the
+    // warehouse, or nothing known → VOID. places = one label per line.
+    function voidWord(places) {
+        const names = Array.from(new Set((places || []).map(x => String(x || '').trim())));
+        if (names.length !== 1 || !names[0] || names[0] === 'Warehouse') return 'VOID';
+        const first = names[0].split(/\s+/)[0].replace(/^[("'[]+|[)"'\],;:]+$/g, '');
+        return first || 'VOID';
+    }
+    function voidConfirmed(word, typed) {
+        return !!word && String(typed == null ? '' : typed).trim().toLowerCase() === String(word).toLowerCase();
+    }
+    // A label per line: the purchase view's lines (destination, folder_name)
+    // or an approval's review doc (where).
+    function placesOf(doc) {
+        return ((doc && doc.lines) || []).map(l => l.where != null ? l.where
+            : (l.destination === 'warehouse' ? 'Warehouse' : (l.folder_name || '')));
+    }
+
+    // R7: only a purchase voided on its own — one a correction replaced has
+    // its newer version already.
+    function canRecordAgain(doc) {
+        return !!doc && doc.status === 'void' && !doc.replaced_by;
+    }
+
+    // A fee or discount as the record form holds it: a split the office
+    // adjusted stays adjusted; an automatic one stays automatic.
+    function chargesOf(doc) {
+        const lines = (doc && doc.lines) || [];
+        return ((doc && doc.charges) || []).map(c => {
+            const given = lines.map(l => {
+                const sh = (c.shares || []).find(x => x.line === l.line);
+                return sh ? Number(sh.amount) : 0;
+            });
+            const auto = prorate(Number(c.amount), lines.map(l => Number(l.amount)));
+            const custom = given.some((g, i) => round2(g) !== round2(auto[i]));
+            return { kind: c.kind, amount: String(c.amount), adjust: custom, shares: custom ? given.map(String) : null };
+        });
+    }
+
+    // R7: the record form's state for a NEW purchase copied from a voided
+    // one (the screen adds its blank-line defaults and an operation id).
+    // Request links are kept and re-checked by the server when it is saved;
+    // weekly picks are NOT copied (the server covers in its usual order, so
+    // a portion bought since is simply not covered). Still to buy is what the
+    // request needs now. Only the owner records for someone else.
+    function recordAgainState(doc, me) {
+        const reqs = {};
+        (doc.requests || []).forEach(r => { reqs[r.line] = r; });
+        const docs = storedDocs(doc.docs);
+        return {
+            purchaseDate: doc.purchase_date, dateTime: doc.date_time || '',
+            supplierId: doc.supplier_id || '', supplier: doc.supplier_id ? '' : (doc.supplier || ''),
+            paymentMethod: doc.payment_method || '', notes: doc.notes || '',
+            boughtBy: me && me.isOwner ? (doc.bought_by || me.userId) : (me && me.userId) || null,
+            docs, stored: Object.assign({}, docs), onFile: Object.keys(docs),
+            lines: (doc.lines || []).map(l => {
+                const r = reqs[l.line];
+                return {
+                    requestLineId: l.request_line_id || null, requestUnit: r ? r.unit : '',
+                    requestName: r ? r.description + (r.spec ? ' ' + r.spec : '') : '',
+                    still: r ? Math.max(0, round3(Number(r.needed) - Number(r.bought))) : 0,
+                    portions: null, portionPicks: [], copied: true,
+                    destination: l.destination, folderId: l.folder_id || '', folderLabel: l.folder_name || '',
+                    itemName: l.item_name, category: l.category || '', quantity: Number(l.quantity), unit: l.unit || '',
+                    amount: String(l.amount), extraReason: l.extra_reason || '', extraLocation: l.extra_location || '',
+                    match: l.substitute ? 'substitute' : 'wording', substituteReason: l.substitute_reason || '',
+                    unplannedReason: l.unplanned_reason || '', inInventory: !!l.in_inventory,
+                };
+            }),
+            charges: chargesOf(doc),
+        };
+    }
+
     // Changes the server keeps for the owner (staff then get "send to the owner").
     function needsOwner(error) {
         return /OWNER_APPROVAL_NEEDED|COMPLETED_PROJECT/.test(String((error && (error.message || error)) || ''));
@@ -401,6 +498,9 @@
         BAD_PROJECT: 'Pick a project and its work, or the warehouse.',
         BAD_DESTINATION: 'Pick a project and its work, or the warehouse.',
         AW_NO_PERIOD: 'This Additional Works job has no billing period yet.',
+        NO_RECEIPT: 'A phone purchase needs a receipt photo, or a reason why there is none.',
+        BAD_REASON: 'Keep the reason to 300 characters.',
+        CONFIRM_WORD: 'Type the word shown to confirm.',
         REASON_REQUIRED: 'Write a short reason. It is kept in the history.',
         NOT_FOUND: 'This record no longer exists or belongs to another company. Reload the page.',
         BAD_STATE: 'This purchase was already voided or replaced. Reload the page.',
@@ -423,7 +523,8 @@
     const pure = { round2, round3, peso, qty, parseMoney, parseQty, sameUnit, portionActions, buyerLabel, filterList,
                    listSummary, coverPreview, pickedStill, lineStill, defaultPicks, countsDirectly, docUploads, storedDocs, prorate, receiptTotal,
                    buildBody, formProblems, HISTORY_LABEL, REQUEST_STATUS, purchaseFlags, needsOwner, changeRows, ERRORS,
-                   errorMessage };
+                   errorMessage, SOURCE_LABEL, sourceLabel, searchPurchases, voidWord, voidConfirmed, placesOf, canRecordAgain,
+                   chargesOf, recordAgainState };
 
     if (typeof module !== 'undefined' && module.exports) {
         module.exports = pure;
````

- [ ] **Step 4: The Purchases list, the purchase page and approvals**

````diff
diff --git a/js/purchasing-admin-purchases.js b/js/purchasing-admin-purchases.js
--- a/js/purchasing-admin-purchases.js
+++ b/js/purchasing-admin-purchases.js
@@ -2,10 +2,16 @@
 // Requests → Purchasing → Purchases, one purchase (reqPurchase) and Owner
 // approvals (0097). Buyers only.
 //
-//   Purchases        — newest first, a date range and a project.
+//   Purchases        — newest first, a date range, a project (with its
+//                      Additional Works) and a search; where each was
+//                      entered (Source: Project Control / Purchasing /
+//                      Phone) — real Project Control purchases share this
+//                      list (2A-3a, Q17).
 //   One purchase     — its lines, what each covered on its request, extras,
-//                      unit checks, receipt photos, history; Correct (the
-//                      record form), Void, Check a different unit.
+//                      unit checks, receipt photos ("No receipt" and why),
+//                      history; Correct (the record form), Void (the person
+//                      types the project's first word, R6), Check a
+//                      different unit, Record again from a voided one (R7).
 //   Owner approvals  — staff changes the server keeps for the owner. The
 //                      owner approves (the server runs the very same
 //                      correct / replace / void) or rejects with a note;
@@ -26,13 +32,29 @@
         const d = new Date();
         return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
     }
-    const ui = { from: null, to: null, status: 'recorded' };
+    const ui = { from: null, to: null, status: 'recorded', folder: '', search: '', projects: null };
+
+    // One row of the Purchases list.
+    function purchaseRow(p) {
+        return '<tr class="req-row" tabindex="0" data-id="' + esc(p.id) + '">' +
+            '<td>' + esc(RA.formatDay(p.purchase_date)) + '</td>' +
+            '<td>' + esc(p.supplier || '—') + '</td>' +
+            '<td>' + esc((p.projects || []).join(', ') + (p.warehouse ? ((p.projects || []).length ? ' · ' : '') + 'Warehouse' : '')) +
+              '<div class="req-muted">' + esc(p.lines + (p.lines === 1 ? ' line' : ' lines') + (p.linked ? ' · ' + p.linked + ' from requests' : '')) + '</div></td>' +
+            '<td>' + esc(PA.sourceLabel(p.source)) + '</td>' +
+            '<td><strong>' + esc(PA.peso(p.receipt_total)) + '</strong></td>' +
+            '<td>' + esc(p.bought_by_name) + (p.bought_by_name !== p.recorded_by_name ? '<div class="req-muted">recorded by ' + esc(p.recorded_by_name) + '</div>' : '') + '</td>' +
+            '<td>' + PA.purchaseFlags(p).map(f => PA.pill(f.text, f.tone)).join(' ') + '</td>' +
+          '</tr>';
+    }
 
     async function renderPurchases(body, me) {
         if (ui.from === null) { ui.from = monthStart(); ui.to = todayKey(); }
         let rows;
         try {
-            rows = await RA.rpc('pur_purchases', { p_from: ui.from || null, p_to: ui.to || null, p_folder: null, p_status: ui.status });
+            // Every project, completed ones too (an old purchase may need finding).
+            if (!ui.projects) ui.projects = (await RA.rpc('pr_office_projects')) || [];
+            rows = await RA.rpc('pur_purchases', { p_from: ui.from || null, p_to: ui.to || null, p_folder: ui.folder || null, p_status: ui.status });
         } catch (e) { RA.fail(body, e); return; }
         rows = rows || [];
         body.innerHTML =
@@ -42,30 +64,39 @@
               '<select class="att-filter" data-status aria-label="Status">' +
                 [['recorded', 'Recorded'], ['void', 'Voided'], ['all', 'All']].map(s => '<option value="' + s[0] + '"' + (s[0] === ui.status ? ' selected' : '') + '>' + s[1] + '</option>').join('') +
               '</select>' +
+              '<select class="att-filter" data-folder aria-label="Project">' +
+                '<option value="">All projects</option>' +
+                ui.projects.map(f => '<option value="' + esc(f.folder_id) + '"' + (f.folder_id === ui.folder ? ' selected' : '') + '>' +
+                  esc(f.name + (f.completed ? ' (completed)' : '')) + '</option>').join('') +
+              '</select>' +
+              '<input class="att-input" type="search" data-search placeholder="Search supplier, project, person, source…" aria-label="Search" value="' + esc(ui.search) + '">' +
               (rows.length >= 300 ? '<span class="req-muted">Showing the newest 300 — narrow the dates.</span>' : '') +
             '</div>' +
+            '<p class="req-muted">Project Control purchases are listed here too — check the Source and the project before you void anything.</p>' +
             (rows.length
               ? '<div class="att-card"><div class="att-card-body" style="padding:0"><div class="req-table-wrap"><table class="att-table req-table">' +
-                  '<thead><tr><th>Date</th><th>Supplier</th><th>For</th><th>Total</th><th>Bought by</th><th>Status</th></tr></thead><tbody>' +
-                  rows.map(p => '<tr class="req-row" tabindex="0" data-id="' + esc(p.id) + '">' +
-                    '<td>' + esc(RA.formatDay(p.purchase_date)) + '</td>' +
-                    '<td>' + esc(p.supplier || '—') + '</td>' +
-                    '<td>' + esc((p.projects || []).join(', ') + (p.warehouse ? ((p.projects || []).length ? ' · ' : '') + 'Warehouse' : '')) +
-                      '<div class="req-muted">' + esc(p.lines + (p.lines === 1 ? ' line' : ' lines') + (p.linked ? ' · ' + p.linked + ' from requests' : '')) + '</div></td>' +
-                    '<td><strong>' + esc(PA.peso(p.receipt_total)) + '</strong></td>' +
-                    '<td>' + esc(p.bought_by_name) + (p.bought_by_name !== p.recorded_by_name ? '<div class="req-muted">recorded by ' + esc(p.recorded_by_name) + '</div>' : '') + '</td>' +
-                    '<td>' + PA.purchaseFlags(p).map(f => PA.pill(f.text, f.tone)).join(' ') + '</td>' +
-                  '</tr>').join('') +
-                '</tbody></table></div></div></div>'
+                  '<thead><tr><th>Date</th><th>Supplier</th><th>For</th><th>Source</th><th>Total</th><th>Bought by</th><th>Status</th></tr></thead><tbody data-rows></tbody>' +
+                '</table></div></div></div><div class="att-empty" data-none hidden>Nothing matches the search.</div>'
               : '<div class="att-empty">No purchases in these dates.</div>');
         const reload = () => renderPurchases(body, me);
+        // The search filters what the server sent, without a reload (the box keeps its focus).
+        const draw = () => {
+            const tb = body.querySelector('[data-rows]');
+            if (!tb) return;
+            const shown = PA.searchPurchases(rows, ui.search);
+            tb.innerHTML = shown.map(purchaseRow).join('');
+            body.querySelector('[data-none]').hidden = shown.length > 0;
+            tb.querySelectorAll('tr[data-id]').forEach(tr => {
+                tr.addEventListener('click', () => PA.openPurchase(tr.dataset.id));
+                tr.addEventListener('keydown', e => { if (e.key === 'Enter') PA.openPurchase(tr.dataset.id); });
+            });
+        };
         body.querySelector('[data-from]').addEventListener('change', e => { ui.from = e.target.value; reload(); });
         body.querySelector('[data-to]').addEventListener('change', e => { ui.to = e.target.value; reload(); });
         body.querySelector('[data-status]').addEventListener('change', e => { ui.status = e.target.value; reload(); });
-        body.querySelectorAll('tr[data-id]').forEach(tr => {
-            tr.addEventListener('click', () => PA.openPurchase(tr.dataset.id));
-            tr.addEventListener('keydown', e => { if (e.key === 'Enter') PA.openPurchase(tr.dataset.id); });
-        });
+        body.querySelector('[data-folder]').addEventListener('change', e => { ui.folder = e.target.value; reload(); });
+        body.querySelector('[data-search]').addEventListener('input', e => { ui.search = e.target.value; draw(); });
+        draw();
         RA.icons();
     }
 
@@ -103,16 +134,22 @@
         const open = doc.status === 'recorded';
         const pending = (doc.change_requests || []).find(r => r.status === 'pending');
         const docs = Object.entries(doc.docs || {}).filter(([, v]) => v);
+        // R6: the word typed before a void (the one project's first word, else VOID).
+        const word = PA.voidWord(PA.placesOf(doc));
         host.innerHTML =
             '<div class="att-stack pur-tab">' +
               RA.head('Purchase · ' + RA.formatDay(doc.purchase_date), (doc.supplier || 'No supplier') + ' · ' + PA.peso(doc.receipt_total) +
-                ' · bought by ' + doc.bought_by_name + (doc.bought_by_name !== doc.recorded_by_name ? ', recorded by ' + doc.recorded_by_name : ''),
+                ' · bought by ' + doc.bought_by_name + (doc.bought_by_name !== doc.recorded_by_name ? ', recorded by ' + doc.recorded_by_name : '') +
+                ' · entered in ' + PA.sourceLabel(doc.source),
                 '<button type="button" class="att-btn" data-back>← Purchases</button>' +
-                (open && !pending ? '<button type="button" class="att-btn" data-correct>Correct…</button><button type="button" class="att-btn att-btn--warn" data-void>Void…</button>' : '')) +
+                (open && !pending ? '<button type="button" class="att-btn" data-correct>Correct…</button><button type="button" class="att-btn att-btn--warn" data-void>Void…</button>' : '') +
+                (PA.canRecordAgain(doc) ? '<button type="button" class="att-btn" data-again>Record again…</button>' : '')) +
               (doc.status === 'void' ? '<div class="att-info att-info--warn"><i data-lucide="ban"></i><div>Voided — it counts for nothing in Spent or Bought. ' +
                   (doc.replaced_by ? 'It was replaced by a newer version.' : 'Its receipt and history are kept.') + '</div></div>' : '') +
               (pending ? '<div class="att-info"><i data-lucide="hourglass"></i><div>A change is waiting for the owner (' + esc(pending.kind) + ', by ' +
                   esc(pending.requested_by_name) + '): ' + esc(pending.reason) + '</div></div>' : '') +
+              (doc.no_receipt_reason ? '<div class="att-info att-info--warn"><i data-lucide="receipt"></i><div>No receipt: ' +
+                  esc(doc.no_receipt_reason) + '</div></div>' : '') +
               '<div class="att-card"><div class="att-card-body" style="padding:0"><div class="req-table-wrap"><table class="att-table req-table">' +
                 '<thead><tr><th>#</th><th>Item</th><th>Quantity</th><th>Amount</th><th>Request</th><th></th></tr></thead><tbody>' +
                 (doc.lines || []).map(l => lineRow(l, doc)).join('') +
@@ -144,17 +181,24 @@
         }));
         const corr = host.querySelector('[data-correct]');
         if (corr) corr.addEventListener('click', () => PA.openRecord({ purchase: doc }));
+        // R7: a NEW purchase filled in from this voided one; nothing is saved until Save.
+        const again = host.querySelector('[data-again]');
+        if (again) again.addEventListener('click', () => PA.openRecord({ again: doc }));
         let sentToOwner = false;
         const vd = host.querySelector('[data-void]');
         if (vd) vd.addEventListener('click', () => RA.modal({
             title: 'Void this purchase?',
             sub: 'It leaves Spent and Bought — all ' + (doc.lines || []).length + ' line(s). The receipt and history are kept; it does not say goods were returned or money refunded.',
-            body: '<label class="att-label">Reason (kept in the history)<input class="att-input" name="reason" maxlength="500" required></label>',
+            body: '<p><strong>' + esc((doc.lines || []).map(l => l.destination === 'warehouse' ? 'Warehouse' : l.folder_name).filter((v, i, a) => a.indexOf(v) === i).join(', ') || '—') +
+                    '</strong> · ' + esc(doc.supplier || 'No supplier') + ' · <strong>' + esc(PA.peso(doc.receipt_total)) + '</strong> · entered in ' + esc(PA.sourceLabel(doc.source)) + '</p>' +
+                  '<label class="att-label">Reason (kept in the history)<input class="att-input" name="reason" maxlength="500" required></label>' +
+                  '<label class="att-label">Type <strong>' + esc(word) + '</strong> to confirm<input class="att-input" name="confirm" autocomplete="off" required></label>',
             submitLabel: 'Void purchase', warn: true,
             errorMessage: PA.errorMessage,
             onSubmit: async (form) => {
                 const reason = form.reason.value.trim();
                 if (!reason) throw new Error('REASON_REQUIRED');
+                if (!PA.voidConfirmed(word, form.confirm.value)) throw new Error('CONFIRM_WORD');
                 sentToOwner = false;
                 try {
                     await RA.rpc('pur_void', { p_op: root.DacsReceipts.newId(), p_purchase: doc.id, p_reason: reason });
@@ -244,12 +288,29 @@
             (decided.length ? '<h3 class="pur-h3">Decided</h3>' + decided.map(card).join('') : '');
         const reload = () => renderApprovals(body, me);
         body.querySelectorAll('[data-open]').forEach(b => b.addEventListener('click', () => PA.openPurchase(b.dataset.open)));
+        const approve = async (id) => {
+            const res = await RA.rpc('pur_decide_change', { p_op: root.DacsReceipts.newId(), p_request: id, p_approve: true, p_note: null });
+            if (res && res.status === 'stale') PA.notice('The purchase changed after this was asked, so nothing was applied. Ask for a new request.', 'Out of date');
+        };
         body.querySelectorAll('[data-approve]').forEach(b => b.addEventListener('click', async () => {
+            const r = list.find(x => x.id === b.dataset.approve);
+            // R6: approving a void voids for good — the owner types the word too.
+            if (r && r.kind === 'void') {
+                const word = PA.voidWord(PA.placesOf(r.base));
+                return RA.modal({
+                    title: 'Approve this void?',
+                    sub: 'The whole purchase leaves Spent and Bought. There is no undo.',
+                    body: '<label class="att-label">Type <strong>' + esc(word) + '</strong> to confirm<input class="att-input" name="confirm" autocomplete="off" required></label>',
+                    submitLabel: 'Approve void', warn: true, errorMessage: PA.errorMessage,
+                    onSubmit: async (form) => {
+                        if (!PA.voidConfirmed(word, form.confirm.value)) throw new Error('CONFIRM_WORD');
+                        await approve(r.id);
+                    },
+                    onDone: reload,
+                });
+            }
             b.disabled = true;
-            try {
-                const res = await RA.rpc('pur_decide_change', { p_op: root.DacsReceipts.newId(), p_request: b.dataset.approve, p_approve: true, p_note: null });
-                if (res && res.status === 'stale') PA.notice('The purchase changed after this was asked, so nothing was applied. Ask for a new request.', 'Out of date');
-            } catch (e) { PA.notice(e); }
+            try { await approve(b.dataset.approve); } catch (e) { PA.notice(e); }
             reload();
         }));
         body.querySelectorAll('[data-reject]').forEach(b => b.addEventListener('click', () => RA.modal({
````

- [ ] **Step 5: Record again in the record form** (`fromPurchase` now uses the shared `chargesOf`; same result)

````diff
diff --git a/js/purchasing-admin-record.js b/js/purchasing-admin-record.js
--- a/js/purchasing-admin-record.js
+++ b/js/purchasing-admin-record.js
@@ -2,7 +2,9 @@
 // Requests → Purchasing → Record purchase (0097). One receipt, many lines,
 // several projects. Opens from the shopping list with the ticked request
 // lines, empty ("Purchase with no request"), or from a purchase to correct
-// it. Saves through the SAME server operations as everything else:
+// it, or from a voided purchase to record it again (R7, 2A-3a: a NEW
+// purchase filled in from the old one). Saves through the SAME server
+// operations as everything else:
 //   new            → pur_record   (source 'purchasing')
 //   same lines     → pur_correct  (reason required)
 //   lines added or removed → pur_replace (reason required)
@@ -23,7 +25,7 @@
     if (!RA || !PA) return;
     const esc = RA.esc;
 
-    let ctx = null;   // { requestLines, batchId, purchase, onDone }
+    let ctx = null;   // { requestLines, batchId, purchase, again, onDone }
     let st = null;    // the form
 
     const DOCS = [['po', 'po_image_url', 'Purchase order'], ['dr', 'delivery_receipt_url', 'Delivery receipt'],
@@ -94,18 +96,22 @@
             }),
             // A split the office adjusted stays adjusted: a correction never
             // quietly resets it to the automatic one.
-            charges: (doc.charges || []).map(c => {
-                const given = (doc.lines || []).map(l => {
-                    const sh = (c.shares || []).find(x => x.line === l.line);
-                    return sh ? Number(sh.amount) : 0;
-                });
-                const auto = PA.prorate(Number(c.amount), (doc.lines || []).map(l => Number(l.amount)));
-                const custom = given.some((g, i) => PA.round2(g) !== PA.round2(auto[i]));
-                return { kind: c.kind, amount: String(c.amount), adjust: custom, shares: custom ? given.map(String) : null };
-            }),
+            charges: PA.chargesOf(doc),
         };
     }
 
+    // R7: a NEW purchase filled in from a voided one (PurchasingAdmin.
+    // recordAgainState): request links are re-checked by the server, picks
+    // are not copied, nothing is saved until Save.
+    function fromAgain(doc, me) {
+        const s = PA.recordAgainState(doc, me);
+        return Object.assign(s, {
+            opId: root.DacsReceipts.newId(), editId: null, editLines: 0, reason: '', againOf: doc.id,
+            files: {}, uploaded: {},
+            lines: s.lines.map(l => Object.assign(newLine(), l)),
+        });
+    }
+
     // The line with its typed quantity, for the pure previews.
     function parsed(l) {
         return Object.assign({}, l, { quantity: PA.parseQty(l.quantity) || 0 });
@@ -133,6 +139,7 @@
     // ones it covers; none picked = the server's automatic order.
     function picksHtml(l, i) {
         if (!l.requestLineId) return '';
+        if (l.copied) return '<div class="req-muted">Covers your own portions first, then unassigned ones, earliest first — checked again when you save.</div>';
         if (!l.portions) {
             const kept = (l.portionPicks || []).filter(k => Number(k.quantity) > 0);
             return kept.length ? '<div class="req-muted">Picked portions are kept: ' + esc(kept.map(k => PA.qty(k.quantity)).join(' + ')) + '</div>'
@@ -360,7 +367,7 @@
             });
         } catch (e) { RA.fail(host, e); return; }
         if (!st) {
-            st = ctx.purchase ? fromPurchase(ctx.purchase) : {
+            st = ctx.purchase ? fromPurchase(ctx.purchase) : ctx.again ? fromAgain(ctx.again, me) : {
                 opId: root.DacsReceipts.newId(), editId: null, editLines: 0, reason: '',
                 purchaseDate: todayKey(), supplierId: '', supplier: '', paymentMethod: 'Cash', notes: '', boughtBy: me.userId,
                 docs: {}, files: {}, uploaded: {}, onFile: [],
@@ -371,7 +378,8 @@
 
         host.innerHTML =
             '<div class="att-card"><div class="att-card-body">' +
-              '<h3 class="pur-h3">' + (st.editId ? 'Correct this purchase' : 'Record a purchase') + '</h3>' +
+              '<h3 class="pur-h3">' + (st.editId ? 'Correct this purchase' : st.againOf ? 'Record again — a new purchase copied from a voided one' : 'Record a purchase') + '</h3>' +
+              (st.againOf ? '<p class="req-muted">Check every line: it is saved as a new purchase. The voided one stays voided, as history.</p>' : '') +
               '<div class="pur-rec-row">' +
                 '<label class="att-label">Date bought<input class="att-input" type="date" data-h="purchaseDate" value="' + esc(st.purchaseDate) + '"></label>' +
                 '<label class="att-label pur-w2">Supplier<select class="att-input" data-h="supplierId">' +
@@ -484,7 +492,7 @@
             onDone: rerender,
         }));
         host.querySelector('[data-cancel]').addEventListener('click', () => {
-            const back = st.editId;
+            const back = st.editId || st.againOf;
             ctx = null; st = null;
             PA.ui.tab = back ? 'purchases' : 'list';
             if (back) PA.openPurchase(back); else root.switchView('reqPurchasing');
````

- [ ] **Step 6: "Waiting for the owner" in Expenses and Project Control (Q16, R11, R14)**

````diff
diff --git a/js/expenses-module.js b/js/expenses-module.js
--- a/js/expenses-module.js
+++ b/js/expenses-module.js
@@ -2074,6 +2074,7 @@ function renderExpensesTable() {
         const purBadge = (e.purchaseLineId || e.purchaseChargeId)
             ? '<span title="Recorded as a purchase — edit or void it to change it" style="display:inline-flex;align-items:center;margin-left:6px;padding:1px 7px;border-radius:999px;background:#eef2ff;color:#3730a3;font-size:10.5px;font-weight:700;border:1px solid #c7d2fe;">From purchase</span>'
               + (_purReviewLines.has(e.purchaseLineId) ? '<span title="No billing period for its month — charged to Cover until the office reviews it" style="display:inline-flex;align-items:center;margin-left:6px;padding:1px 7px;border-radius:999px;background:#fff7ed;color:#c2410c;font-size:10.5px;font-weight:700;border:1px solid #fed7aa;">Office review</span>' : '')
+              + (window.expPurPendingChange(e.purchaseLineId || e.purchaseChargeId) ? '<span title="You sent a change of this purchase to the owner — open the row to withdraw it" style="display:inline-flex;align-items:center;margin-left:6px;padding:1px 7px;border-radius:999px;background:#fefce8;color:#a16207;font-size:10.5px;font-weight:700;border:1px solid #fde68a;">Waiting for the owner</span>' : '')
             : '';
         return `
         <tr class="exp-group-row">
@@ -2938,17 +2939,47 @@ function _expNoPeriodSpent(folderId) {
 // Lines the server charged to Cover because their month had no billing
 // period (Q23) — shown as "Office review" in the Expenses list and in
 // Project Control's Materials list (which listens for the event below).
+// Also (2A-3a, Q16) the changes THIS account sent to the owner and the owner
+// has not decided: "Waiting for the owner", with Withdraw. Staff without the
+// Buyer switch read no purchase rows, so both come through the server as ids
+// (pur_review_lines, pur_my_pending_changes — no amounts).
 let _purReviewLines = new Set();
+let _purPending = new Map();   // purchase line / charge id → my pending change request
 async function _purLoadReviewFlags() {
     try {
         // Ids only, through the server (0097: purchase tables are buyers-only).
         const { data, error } = await window.sbClient.rpc('pur_review_lines');
         if (error) throw error;
         _purReviewLines = new Set(data || []);
-        window.dispatchEvent(new Event('dacs:pur-review-flags'));
     } catch (err) { console.warn('purchase review flags:', err); }
+    try {
+        const { data, error } = await window.sbClient.rpc('pur_my_pending_changes');
+        if (error) throw error;
+        const byId = new Map();
+        (data || []).forEach(r => (r.line_ids || []).concat(r.charge_ids || []).forEach(id => byId.set(id, r)));
+        _purPending = byId;
+    } catch (err) { console.warn('purchase changes waiting for the owner:', err); }
+    window.dispatchEvent(new Event('dacs:pur-review-flags'));
 }
 window.expPurNeedsReview = id => !!id && _purReviewLines.has(id);
+window.expPurPendingChange = id => (id && _purPending.get(id)) || null;
+
+// Q16: a purchase-made row whose purchase has a change this account sent to
+// the owner. Changing it now would make that request out of date, so offer
+// to withdraw it first. true = nothing is waiting, or it was withdrawn (go on).
+async function _purOfferWithdraw(e) {
+    const r = window.expPurPendingChange(e && (e.purchaseLineId || e.purchaseChargeId));
+    if (!r) return true;
+    const ok = await _purConfirm('Waiting for the owner',
+        'You sent this purchase to the owner to ' + (r.kind === 'void' ? 'void' : 'change') + ' it. Your reason: "' + (r.reason || '') +
+        '". Withdraw that request to change the purchase yourself?', 'Withdraw request');
+    if (!ok) return false;
+    const { error } = await window.sbClient.rpc('pur_withdraw_change', { p_request: r.id });
+    if (error) { showExpNotif('Error: ' + _purErrorText(error), 'error'); return false; }
+    showExpNotif('Request withdrawn.', 'success');
+    await _purLoadReviewFlags();
+    return true;
+}
 
 // Set while the Edit Expense modal is correcting a purchase (else null).
 let _editingPurchase = null;
@@ -3074,6 +3105,7 @@ async function deleteExpense(id) {
         catch (err) { console.error('deleteExpense fetch:', err); }
     }
     if (pe && (pe.purchaseLineId || pe.purchaseChargeId)) {
+        if (!await _purOfferWithdraw(pe)) return;
         let pur;
         try { pur = await _purForRow(pe); } catch (err) { showExpNotif('Error: ' + _purErrorText(err), 'error'); return; }
         if (pur.purchase.status !== 'recorded') { showExpNotif('This purchase was already voided.', 'error'); return; }
@@ -4377,6 +4409,7 @@ async function openEditExpenseModal(id) {
     _editingPurchase = null;
     _purEditOpId = null;
     if (e.purchaseLineId || e.purchaseChargeId) {
+        if (!await _purOfferWithdraw(e)) return;
         let pur;
         try { pur = await _purForRow(e); } catch (err) { showExpNotif('Error: ' + _purErrorText(err), 'error'); return; }
         if (pur.purchase.status !== 'recorded') { showExpNotif('This purchase was voided.', 'error'); return; }
````

````diff
diff --git a/js/portal-app.compiled.js b/js/portal-app.compiled.js
--- a/js/portal-app.compiled.js
+++ b/js/portal-app.compiled.js
@@ -3299,7 +3299,9 @@ function MaterialDrill({ project, onBack, materialTx, childMonths, activeFolder,
   const purchaseTags = (m) => {
     if (!(window.expIsPurchaseRow && window.expIsPurchaseRow(m))) return null;
     const review = typeof window.expPurNeedsReview === "function" && (m._parts || [m]).some((p) => window.expPurNeedsReview(p.purchaseLineId));
-    return /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("span", { title: "Recorded as a purchase — edit or void it to change it", style: tagStyle("#eef2ff", "#3730a3", "#c7d2fe") }, "From purchase"), review && /* @__PURE__ */ React.createElement("span", { title: "No billing period for its month — charged to Cover until the office reviews it", style: tagStyle("#fff7ed", "#c2410c", "#fed7aa") }, "Office review"));
+    // 2A-3a (Q16): a change this account sent to the owner, not yet decided.
+    const waiting = typeof window.expPurPendingChange === "function" && (m._parts || [m]).some((p) => window.expPurPendingChange(p.purchaseLineId || p.purchaseChargeId));
+    return /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("span", { title: "Recorded as a purchase — edit or void it to change it", style: tagStyle("#eef2ff", "#3730a3", "#c7d2fe") }, "From purchase"), review && /* @__PURE__ */ React.createElement("span", { title: "No billing period for its month — charged to Cover until the office reviews it", style: tagStyle("#fff7ed", "#c2410c", "#fed7aa") }, "Office review"), waiting && /* @__PURE__ */ React.createElement("span", { title: "You sent a change of this purchase to the owner — open the row to withdraw it", style: tagStyle("#fefce8", "#a16207", "#fde68a") }, "Waiting for the owner"));
   };
   const openReceiptThumb = (m) => {
     if (_staff()) return;
````

- [ ] **Step 7: Cache-busters** (a changed script must be re-fetched by open tabs)

````diff
diff --git a/admin.html b/admin.html
--- a/admin.html
+++ b/admin.html
@@ -5413,7 +5413,7 @@
 <script src="js/print-utils.js"></script>
 <script src="js/receipt-storage.js?v=20261016a"></script>
 <script src="js/expense-split-rows.js?v=20261015a"></script>
-<script src="js/expenses-module.js?v=20261016a"></script>
+<script src="js/expenses-module.js?v=20261020a"></script>
 <script src="js/overhead-module.js"></script>
 <script src="js/reimbursement-module.js"></script>
 <script src="js/construction-module.js"></script>
@@ -5427,10 +5427,10 @@
 <script src="js/requests-admin-setup.js?v=20261012a"></script>
 <script src="js/requests-admin-history.js?v=20261012a"></script>
 <script src="js/requests-admin-gallery.js?v=20261012a"></script>
-<script src="js/purchasing-admin-core.js?v=20261016a"></script>
+<script src="js/purchasing-admin-core.js?v=20261020a"></script>
 <script src="js/purchasing-admin-list.js?v=20261016a"></script>
-<script src="js/purchasing-admin-record.js?v=20261016a"></script>
-<script src="js/purchasing-admin-purchases.js?v=20261016a"></script>
+<script src="js/purchasing-admin-record.js?v=20261020a"></script>
+<script src="js/purchasing-admin-purchases.js?v=20261020a"></script>
 <script src="js/workplan-admin-core.js?v=20261013a"></script>
 <script src="js/workplan-admin-form.js?v=20261013a"></script>
 <script src="js/workplan-admin-board.js?v=20261013a"></script>
````

- [ ] **Step 8: Run everything**

- `node tests/purchasing-admin.test.js` → `44 passed, 0 failed`
- `npm test` → exit 0 (money suite and `project-control-staff` included)
- `for f in js/*.js tests/*.js; do node --check "$f" || echo "SYNTAX $f"; done` → prints nothing

- [ ] **Step 9: Stop for the user**

Hand back. The user commits Task 3. **Do not push yet**: in Task 4 the web goes live after 0101 and the function.

---

### Task 4: Live — apply 0101, deploy the sign-in, push the web, browser checks

Order **R8**: 0101 → function → web. Each step adds something and changes nothing for the old app, so stopping between steps is safe.

- [ ] **Step 1: Pre-flight (MCP `execute_sql`, read-only)**

```sql
select max(version) from supabase_migrations.schema_migrations;   -- the last applied is 0100's
select count(*) from purchases where source = 'workmate';           -- expect 0 (the new trigger would judge them)
select count(*) from purchase_change_requests where status = 'pending';
select count(*) from projects p join folders f on f.id = p.folder_id where f.parent_folder_id is not null; -- AW periods today
```

- [ ] **Step 2: The user applies 0101**

Hand the user `supabase/migrations/0101_purchasing_phone.sql`, applied the same way as 0096–0100. After the user says it is applied, **check the live database ourselves**:

```sql
select proname, provolatile from pg_proc
 where proname in ('pur_signin_can_buy', 'pur_fund', 'pur_insert', 'pur_list_doc', 'pur_purchases', 'pur_my_purchases',
                   'pur_destinations', 'pur_my_pending_changes', 'pur_purchase_view', 'pur_require_receipt')
 order by 1;                                                         -- 10 rows; pur_fund 'v'
select column_name, column_default from information_schema.columns
 where table_name = 'purchases' and column_name = 'no_receipt_reason';
select tgname from pg_trigger where tgname = 'purchases_require_receipt';
select has_function_privilege('authenticated', 'pur_signin_can_buy(uuid)', 'execute') as auth_can,   -- false
       has_function_privilege('service_role', 'pur_signin_can_buy(uuid)', 'execute') as svc_can,     -- true
       has_function_privilege('anon', 'pur_my_purchases(int)', 'execute') as anon_can;               -- false
```

Then compare each function body with the file, as for 0097. Compute `md5(prosrc)` for the 10 functions live, and the same for the bodies between `$$ … $$` in the file. Every one must match.

Then run `supabase/tests/2a3_acceptance.sql` through MCP `execute_sql` (never the SQL editor: memory "SQL editor temp-table trap"). It must end with `2a3 acceptance: all checks passed`, and nothing is left behind (it rolls back). Re-run `supabase/tests/2a2_acceptance.sql` and `2a1_acceptance.sql` the same way. Both must still pass.

- [ ] **Step 3: Deploy `attendance-signin`**

Deploy both files, `index.ts` and `eligibility.mjs`, with Supabase MCP `deploy_edge_function` (`verify_jwt` as it is today), or with `supabase functions deploy attendance-signin` if the CLI is installed. Then check:

- `get_edge_function attendance-signin`: the version went up, and both files are there.
- **Old app, unchanged:** a worker's old-app Time In still works today. Check `attendance_records` for a record after the deploy, or ask a worker to time in.
- **WorkMate worker:** W-0007 signs in on the test phone (WorkMate 0.6.0) and reaches Home.
- **WorkMate, office account without the Buyer switch:** `staff@` on the test phone is refused. WorkMate 0.6.0 does not know the new code yet, so it shows its general "server problem" message until 2A-3b. **R9 check: `staff@` stays signed in on Dacs Web** in an open browser tab.
- Function logs show no `buyer check failed`.

The **buyer** path (`access: "buyer"`) is first used by plan 2A-3b's app. It is already covered by `pur_signin_can_buy` = `pur_buyer()` (acceptance A1–A7) and by `tests/signin-eligibility.test.js`.

- [ ] **Step 4: The user pushes the web**

The user pushes Tasks 1–3. Check that the live site serves `js/purchasing-admin-core.js?v=20261020a`.

- [ ] **Step 5: Browser checks**

As owner (`admin@`) and staff (`staff@`, Buyer switch off unless stated). Use a test project named **`ZZ 2a3 browser`** with one Additional Works job **`ZZ 2a3 job`** (no billing period) and one billing period on the main project.

> **Real purchases share the Purchases list.** Before any void or clean-up, **filter the list to `ZZ 2a3 browser`** with the new project filter, and check the Source and the project of each row. Memory: "Live cleanup: real rows mixed in".

| # | Check | Expect |
|---|---|---|
| W1 | Purchases list (owner) | A **Source** column. Project Control entries read "Project Control". The note about real purchases is shown |
| W2 | Project filter `ZZ 2a3 browser`; then search for a supplier word | Only that project's purchases (its AW job included); the search narrows without a reload and keeps the box's focus |
| W3 | Record a purchase for `ZZ 2a3 job` in the Purchasing tab (no period exists) | Saved. Project Control shows it under the job. One hidden period exists for the job (`projects` row, `funding_type 'downpayment'`, no budget row). This was B9/B10 of 2A-1 |
| W4 | Void it: wrong word, then the right word | The dialog shows project, supplier, total and Source. A wrong word is refused ("Type the word shown to confirm."); the right one voids it |
| W5 | **Record again** on it | The form shows "Record again", filled in. Save → a NEW purchase, the voided one stays voided. Correct a different ZZ purchase so it is replaced: its old version has **no** Record again |
| W6 | Staff: in Project Control, mark the main ZZ project completed (owner), then staff deletes a ZZ material row | "Send to the owner?" → sent. The row shows **Waiting for the owner** in Project Control and in Expenses. No new peso amount appears anywhere for staff |
| W7 | Staff opens that row | "Waiting for the owner … Withdraw request?" → Withdraw → "Request withdrawn." The pill is gone |
| W8 | Staff sends the void again; the owner approves it in Owner approvals | Approving a **void** asks for the word too |
| W9 | `client_errors` since the push | Nothing new from these screens |

Clean-up: with the list **filtered to `ZZ 2a3 browser`**, check every row is a ZZ purchase. The owner removes the test project with a guarded SQL transaction as in 2A-2: dry run first, refuse to run if any matched row is not ZZ, then apply. Real purchases are never touched.

- [ ] **Step 6: Close-out**

Append `## Execution notes` to this plan (what passed, what was rerouted, anything found). Update memory `workmate-stage2-decisions.md`: 2A-3a live; next is 2A-3b, the app.

---

## Self-review (against the spec and the answers)

| Answer / ruling | Where |
|---|---|
| Q1, R1, R3 (sign-in) | Task 1 `pur_signin_can_buy`, Task 2 `eligibility.mjs` + `index.ts`; app side in 2A-3b |
| Q2, Q4–Q7, Q9–Q13, Q20–Q22 (phone screens) | Plan 2A-3b. This plan provides their server reads (`pur_destinations`, `pur_my_purchases`) and the rules they rely on |
| Q23 (the Terms screen for buyers) | **Pending**: not approved yet. Decided before plan 2A-3b. Nothing in this plan depends on it |
| Q8, R5 (receipt or reason, phone only) | Task 1 column + trigger + `pur_insert`; Task 3 shows "No receipt" |
| Q12 (My purchases) | Task 1 `pur_my_purchases` |
| Q14, Q15 (keep staff void; stale stays stale) | No change: kept as built in 2A-2 |
| Q16, R11, R14 (Waiting for the owner) | Task 1 `pur_my_pending_changes`; Task 3 expenses-module + portal |
| Q17, R6 (Source, filter, search, typed void) | Task 3 |
| Q18, R7, R12 (Record again) | Task 3 |
| Q19, R4, R15 (AW period) | Task 1 `pur_fund` |
| R2 (Buyer switch off → phone wipes) | Plan 2A-3b. The server already refuses at once (`pur_buyer()`, acceptance A6/A7) |
| R8 (order) | Task 4 |
| R9 (local revoke; approved 20 Oct), R10 (.mjs + .gitignore) | Task 2 |
| R13 (2A-2 test) | Task 1 Step 1 |

No placeholders. Every function named in a later task is defined in an earlier one (checked against Task 1's Interfaces). `npm test` passes at the end of each task on its own.

## Rehearsal

This text was re-applied to a fresh clone of `main` at 4fc97ec:
- new files written from the blocks above;
- LF diffs applied with `git apply`;
- the two CRLF docs patched with their CRs kept.

The result was compared with the tested build, file by file: **byte-identical**. `npm test` exit 0; `npm run test:sql` exit 0.
