# PM Profit Sharing (Release 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Per-project owner/partner sharing percentages (private, audited, main-owner-only), one shared calculation behind PM Overview / Overview print / Reports, and a completed-projects Profit Sharing dashboard.

**Architecture:** Three private tables (`pm_project_companies`, `pm_sharing_agreements`, `pm_sharing_changes`) that no client role can touch directly. All reads and writes go through `security definer` functions in migration 0098. The browser calculation lives in one new pure module, `js/pm-sharing.js` (`window.PMShare`). Overview, Reports and the new dashboard (`js/pm-sharing-dashboard.js`) only format its results. Recorded warranty reserves reach other modules only through `WF.reserveFor` in `js/warranty-fund.js`, which calls the company-checked server read `wf_reserves_for`.

**Tech Stack:** Plain HTML + vanilla JS (no build step), Supabase Postgres (plpgsql), the Firestore-compat shim (`db.collection`), `window.sbClient.rpc`, Node test scripts (`npm test`), PGlite + embedded-postgres SQL suites (`npm run test:sql`).

**Spec:** `docs/superpowers/specs/2026-10-18-pm-profit-sharing-mvp-terms.md`. Executors read both documents.

## Global Constraints

- **Never run `npm run build`.** Edit files directly. No build step.
- **Never run `git commit` or `git push`.** Every task ends with a checkpoint where the user reviews and commits.
- Main owner = `profiles.role = 'owner'` and `profiles.owner_id is null`, with a profile row and `status = 'active'` (null = active). `allowed_modules` is never read for authority.
- Owner % = `100 − partner_pct`. Only `partner_pct` is stored: `numeric(5,2)`, 0–100, at most 2 decimals. The raw input is rejected **before** storage if it has more decimals.
- A project with no agreement row = 50/50, computed on read. Nothing is back-filled.
- Rounding: integer centavos. Partner amount = balance × % rounded **half away from zero**. Owner amount = balance − partner amount.
- Reserve: completed + usable recorded row → `contributedAmount` (₱0 is valid). Completed + no/void/deleted row → provisional `max(0, remaining × 5%)` + **Reserve needs review** (the only reason a project is excluded from confirmed totals). Not completed → `max(0, remaining × 5%)` labelled **Estimate**.
- Labels: "Internal allocation — not a payout." / "Internal allocation — not a payout or amount owed." A negative balance is **Shortfall**, never "owed", "debt" or "payout".
- Acceptance wording: "This acceptance record does not capture a project sharing percentage." Never claim what the signed document says.
- Staff (`currentUserRole === 'staff'`) never receive any sharing or reserve figure: not rendered, nav hidden, direct view refused, server refuses.
- `projects` means billing period. PM uses `construction_projects` ids. Never join them to `folders`.
- Dates: never `toISOString().slice(0,10)` for a local date key. Build it from local parts.
- Only `js/warranty-fund.js` touches warranty tables (through `wf_reserves_for`).
- Next migration numbers: **0098** (schema + functions) and **0099** (verified mapping). Local and live highest = 0097 (checked 18 Oct).

## Decisions made while planning (from code facts, 18 Oct)

- **D1 — Reads go through server functions.** The three tables have RLS on, **no policies**, and all privileges revoked from `anon`/`authenticated`. Owner-role accounts read through `pm_sharing_read`, which applies the company check. This is stricter than per-table policies and needs no shim `REG` entry.
- **D2 — `wf_reserves_for` server read.** `warranty_retentions` RLS is `owner_id = auth.uid()`, so admin-pm@ cannot read your reserve rows today (both live rows belong to the main owner). `wf_reserves_for` returns reserve rows for mapped projects of the caller's company. Only `WF.reserveFor` in `warranty-fund.js` calls it.
- **D3 — Inserts with no signed-in account** (service role / SQL editor, e.g. `supabase/tests/attendance_checks.sql` seeding) leave the project **unmapped**, so its sharing is locked. **Every signed-in account** with a missing profile, inactive status, wrong role or invalid company link is **rejected**. The only app creation path is `pmSaveProject` (`js/pm-admin.js` ~2026).
- **D4 — Legacy direct-cost ladder unchanged.** `directCostTotal`, then `labor + materials`, then `grandTotal − managementFee`, exactly as Overview, Reports and closeout (`termination-requests.js` ~377) use today. Its middle step leaves out overhead. **0 of 88 live bills use any fallback** (18 Oct). Recorded as finding **F6**; not changed, so closeout and the reserve snapshot stay comparable.
- **D5 — Overview range filter.** The reserve and sharing cards always show **lifetime** figures (all bills, all payments) and are not recalculated when the week range changes. Today the refresh mixes all-time paid with in-range cost, which is meaningless for a split.
- **D6 — Two migrations.** 0098 = schema and functions, no data. 0099 = mapping of the six ids, **written only after the owner verifies them** (Task 0).
- **D7 — Failures are explicit.** Every sharing read failure shows "Unavailable" / an error panel, never ₱0. Reports' existing fetch-error path empties its arrays; the sharing section checks its own error flag instead.

## File map

| File | Responsibility |
|---|---|
| `supabase/migrations/0098_pm_profit_sharing.sql` (new) | Company helpers, 3 tables, creation trigger, immutable history, `pm_set_sharing`, `pm_sharing_read`, `wf_reserves_for`, grants |
| `supabase/migrations/0099_pm_project_company_map.sql` (new, after Task 0) | Explicit mapping of the six verified ids |
| `supabase/tests/pm_sharing_base.mjs` (new) | Minimal tables shared by the two SQL suites |
| `supabase/tests/pm_sharing.pglite.mjs` (new) | Behaviour tests on PGlite |
| `supabase/tests/pm_sharing_concurrency.mjs` (new) | First-save race on real PostgreSQL |
| `supabase/tests/pm_sharing_acceptance.sql` (new) | Live checks, begin/rollback (RLS and grants) |
| `js/pm-sharing.js` (new) | `window.PMShare`: pure calculation and aggregation, pct parsing, error text, RPC wrappers |
| `js/pm-sharing-dashboard.js` (new) | `window.PMShareDash`: dashboard loader, filters, render, details, print, CSV |
| `js/warranty-fund.js` | Add `WF.reserveFor(ids)` |
| `js/pm-admin.js` | Delegate paid/outstanding/cost, share loaders and texts, Overview ×3, Reports ×2, project form section and save |
| `js/admin.js`, `admin.html` | Nav, view markup, staff guards, script tags, form markup |
| `tests/pm-sharing.test.js` (new), `tests/helpers/pm-admin-sandbox.js` (new) | Node tests; the sandbox runs the real `pm-admin.js` |
| `package.json` | Add the new suites |
| Docs | `docs/DATABASE_SCHEMA.md`, `docs/ARCHITECTURE.md` §4, `docs/PROJECT_MANAGEMENT_MVP.md`, `CLAUDE.md`, spec §12 (F6) |

---

### Task 0: Prerequisites (no code)

**Files:** none (results go in the checkpoint message).

- [ ] **Step 1: Owner verifies the six projects.** Show the owner the table in spec §4.6 and ask them to confirm each id belongs to the company. Ask specifically about the two completed "Los Churreros" records: are both genuine projects? Do not write 0099 until the owner has confirmed every id. Record the date and their exact answer.

- [ ] **Step 2: Re-verify the trust gate live** (read-only, via the Supabase MCP `execute_sql`, project `hqbgduyonlbbsvjuapre`):

```sql
select pg_get_triggerdef(oid) from pg_trigger
 where tgrelid = 'public.profiles'::regclass and tgname = 'profiles_guard_trg';
select pg_get_functiondef('public.profiles_guard'::regproc);
select policyname, cmd, qual, with_check from pg_policies where tablename = 'profiles' order by cmd;
```

Expected: `BEFORE UPDATE` trigger; the function refuses any change of `role` or `owner_id` when `auth.uid()` is not null (except client↔partner by owner/staff on another row). `profiles_insert` with check `id = auth.uid() and (role is null or role = 'client')`. **If any of this differs, STOP:** the creation trigger (Task 1) must not ship. Report back.

- [ ] **Step 3: Confirm the migration number.**

```bash
ls supabase/migrations | sort | tail -2
```

and live: `select name from supabase_migrations.schema_migrations order by version desc limit 1;`. Expected: `0097_purchasing_office` in both places. Otherwise renumber 0098/0099 to highest + 1 / + 2 throughout this plan.

- [ ] **Step 4: Checkpoint.** Report the results of steps 1–3 to the user. Do not continue to Task 13 (live apply) without the step 1 confirmation. Tasks 1–12 may proceed.

---

### Task 1: Company helpers, tables, creation trigger, immutable history

**Files:**
- Create: `supabase/migrations/0098_pm_profit_sharing.sql`
- Create: `supabase/tests/pm_sharing_base.mjs`
- Create: `supabase/tests/pm_sharing.pglite.mjs`
- Modify: `package.json` (`test:sql`)

**Interfaces:**
- Produces (SQL): `pm_caller_company() → uuid`, `pm_owner_company() → uuid`, `pm_main_owner_id() → uuid`; tables `pm_project_companies(project_id, company_owner_id, mapped_by, mapped_at, source)`, `pm_sharing_agreements(project_id, company_owner_id, partner_pct, version, updated_by, updated_at)`, `pm_sharing_changes(id, project_id, project_name_snapshot, client_name_snapshot, company_owner_id, old_pct, new_pct, old_was_default, reason, actor_id, actor_email, changed_at)`. Error messages: `NOT_SIGNED_IN`, `PROFILE_MISSING`, `INACTIVE`, `NOT_OFFICE`, `OWNER_ONLY`, `BAD_COMPANY_LINK`, `HISTORY_IMMUTABLE`.
- Produces (JS test helpers): `PM_BASE` (string), `IDS` (object of uuids), `seedProfiles(db)`.

- [ ] **Step 1: Write the shared SQL test base** — `supabase/tests/pm_sharing_base.mjs`:

```js
// Minimal copies of the live tables 0098 touches — enough to run the
// migration VERBATIM. Shared by pm_sharing.pglite.mjs and
// pm_sharing_concurrency.mjs. Nothing here talks to the live database.
export const PM_BASE = `
create role anon; create role authenticated;
create schema auth;
create function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
create table profiles (
  id uuid primary key, role text, owner_id uuid, status text, allowed_modules jsonb, email text,
  partner_agreement_accepted boolean, partner_agreement_accepted_at timestamptz,
  partner_agreement_doc_version int, created_at timestamptz default now());
create table construction_projects (
  id uuid primary key default gen_random_uuid(), owner_id uuid, project_name text, client_name text,
  client_email text, partner_email text, status text, terminated_at timestamptz);
create table warranty_retentions (
  id uuid primary key default gen_random_uuid(), owner_id uuid,
  project_id uuid references construction_projects(id) on delete set null,
  ref_no text, status text, total_paid numeric, direct_cost numeric, contributed_amount numeric,
  completed_at timestamptz, deleted_at timestamptz, updated_at timestamptz default now());
`;

export const IDS = {
  OWNER:      '00000000-0000-0000-0000-00000000000a', // main owner, company A
  PMOWNER:    '00000000-0000-0000-0000-000000000013', // owner-role, owner_id → OWNER, focused ['pm']
  STAFF:      '00000000-0000-0000-0000-00000000000b', // staff of OWNER
  CLIENT:     '00000000-0000-0000-0000-00000000000e',
  PARTNER:    '00000000-0000-0000-0000-00000000000f', // partner@x.test, accepted v3
  OTHER:      '00000000-0000-0000-0000-00000000000d', // main owner of company B
  INACT:      '00000000-0000-0000-0000-000000000021', // inactive main owner
  ORPHAN:     '00000000-0000-0000-0000-000000000022', // staff with null owner_id
  BADLINK:    '00000000-0000-0000-0000-000000000023', // owner whose owner_id → STAFF (not an owner)
  LINKPM:     '00000000-0000-0000-0000-000000000024', // staff whose owner_id → PMOWNER (target has owner_id)
  INACTLINK:  '00000000-0000-0000-0000-000000000025', // staff whose owner_id → INACT (inactive)
  INACTSTAFF: '00000000-0000-0000-0000-000000000026', // inactive staff of OWNER
  NOPROFILE:  '00000000-0000-0000-0000-000000000099', // signed in, no profile row
};

export async function seedProfiles(exec) {
  const I = IDS;
  await exec(`insert into profiles (id, role, owner_id, status, allowed_modules, email,
      partner_agreement_accepted, partner_agreement_accepted_at, partner_agreement_doc_version) values
    ('${I.OWNER}',      'owner',   null,           'active',   null,            'admin@dacs.test',    null, null, null),
    ('${I.PMOWNER}',    'owner',   '${I.OWNER}',   'active',   '["pm"]'::jsonb, 'admin-pm@dacs.test', null, null, null),
    ('${I.STAFF}',      'staff',   '${I.OWNER}',   'active',   null,            'staff@dacs.test',    null, null, null),
    ('${I.CLIENT}',     'client',  null,           'active',   null,            'client@x.test',      null, null, null),
    ('${I.PARTNER}',    'partner', null,           'active',   null,            'partner@x.test',     true, '2026-08-12T02:00:00Z', 3),
    ('${I.OTHER}',      'owner',   null,           'active',   null,            'other@b.test',       null, null, null),
    ('${I.INACT}',      'owner',   null,           'inactive', null,            'inact@c.test',       null, null, null),
    ('${I.ORPHAN}',     'staff',   null,           'active',   null,            'orphan@x.test',      null, null, null),
    ('${I.BADLINK}',    'owner',   '${I.STAFF}',   'active',   null,            'badlink@x.test',     null, null, null),
    ('${I.LINKPM}',     'staff',   '${I.PMOWNER}', 'active',   null,            'linkpm@x.test',      null, null, null),
    ('${I.INACTLINK}',  'staff',   '${I.INACT}',   'active',   null,            'inactlink@x.test',   null, null, null),
    ('${I.INACTSTAFF}', 'staff',   '${I.OWNER}',   'inactive', null,            'inactstaff@x.test',  null, null, null);`);
}
```

- [ ] **Step 2: Write the failing PGlite tests** — `supabase/tests/pm_sharing.pglite.mjs`:

```js
// ════════════════════════════════════════════════════════════════════
// PM PROFIT SHARING (0098) — BEHAVIOUR TESTS ON PGLITE
//   npm run test:sql
// Runs migration 0098 VERBATIM over the minimal tables in
// pm_sharing_base.mjs. Nothing here talks to the live database;
// pm_sharing_acceptance.sql repeats the RLS / grant checks live.
// ════════════════════════════════════════════════════════════════════
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PM_BASE, IDS, seedProfiles } from './pm_sharing_base.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.DACS_ROOT || path.join(HERE, '..', '..');
const M98 = fs.readFileSync(path.join(ROOT, 'supabase/migrations/0098_pm_profit_sharing.sql'), 'utf8').replace(/\r\n/g, '\n');
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
  await db.exec(M98);
  await seedProfiles((sql) => db.exec(sql));
  return db;
}
async function as(db, uid) { await db.exec(`select set_config('test.uid', '${uid || ''}', false)`); }
async function one(db, sql, params = []) { return (await db.query(sql, params)).rows[0]; }
async function all(db, sql, params = []) { return (await db.query(sql, params)).rows; }
async function err(promise) { try { await promise; return 'no error'; } catch (e) { return e.message; } }
async function newProject(db, uid, name = 'P', extra = {}) {
  await as(db, uid);
  const r = await one(db, `insert into construction_projects (project_name, client_name, partner_email, status, terminated_at)
                           values ($1, $2, $3, $4, $5) returning id`,
    [name, extra.client || 'Client', extra.partner || null, extra.status || 'active', extra.terminatedAt || null]);
  return r.id;
}
async function mapping(db, pid) { return one(db, `select company_owner_id, source, mapped_by from pm_project_companies where project_id = $1`, [pid]); }

console.log('\nPM profit sharing (0098) on PGlite');

// ── Task 1: company resolution + creation trigger + immutable history ──
await test('T1.1 main owner creates a project → mapped to own company, source created', async () => {
  const db = await fresh();
  const pid = await newProject(db, I.OWNER);
  eq(await mapping(db, pid), { company_owner_id: I.OWNER, source: 'created', mapped_by: I.OWNER });
});
await test('T1.2 focused owner and staff create → mapped to the main owner', async () => {
  const db = await fresh();
  eq((await mapping(db, await newProject(db, I.PMOWNER))).company_owner_id, I.OWNER, 'pm owner');
  eq((await mapping(db, await newProject(db, I.STAFF))).company_owner_id, I.OWNER, 'staff');
});
await test('T1.3 another company maps to itself', async () => {
  const db = await fresh();
  eq((await mapping(db, await newProject(db, I.OTHER))).company_owner_id, I.OTHER);
});
await test('T1.4 invalid company links reject the insert and leave no project', async () => {
  const db = await fresh();
  for (const [uid, code] of [[I.ORPHAN, 'BAD_COMPANY_LINK'], [I.BADLINK, 'BAD_COMPANY_LINK'],
                             [I.LINKPM, 'BAD_COMPANY_LINK'], [I.INACTLINK, 'BAD_COMPANY_LINK'],
                             [I.INACTSTAFF, 'INACTIVE'], [I.INACT, 'INACTIVE'],
                             [I.NOPROFILE, 'PROFILE_MISSING'], [I.CLIENT, 'NOT_OFFICE']]) {
    const msg = await err(newProject(db, uid, 'bad-' + uid));
    assert(msg.includes(code), uid + ' expected ' + code + ', got ' + msg);
  }
  await as(db, '');
  eq(Number((await one(db, `select count(*) n from construction_projects where project_name like 'bad-%'`)).n), 0, 'no rejected project kept');
});
await test('T1.5 no signed-in account (service role) → project kept, left unmapped (D3)', async () => {
  const db = await fresh();
  const pid = await newProject(db, '');
  eq(await mapping(db, pid), undefined);
});
await test('T1.6 history rows cannot be updated or deleted, even by the table owner', async () => {
  const db = await fresh();
  const pid = await newProject(db, I.OWNER);
  await db.query(`insert into pm_sharing_changes (project_id, company_owner_id, old_pct, new_pct, old_was_default, reason, actor_id)
                  values ($1, $2, 50, 40, true, 'r', $2)`, [pid, I.OWNER]);
  assert((await err(db.query(`update pm_sharing_changes set reason = 'x'`))).includes('HISTORY_IMMUTABLE'), 'update');
  assert((await err(db.query(`delete from pm_sharing_changes`))).includes('HISTORY_IMMUTABLE'), 'delete');
});
await test('T1.7 deleting a project removes mapping/agreement but keeps history with its UUID', async () => {
  const db = await fresh();
  const pid = await newProject(db, I.OWNER, 'Gone');
  await db.query(`insert into pm_sharing_agreements (project_id, company_owner_id, partner_pct, version, updated_by)
                  values ($1, $2, 40, 1, $2)`, [pid, I.OWNER]);
  await db.query(`insert into pm_sharing_changes (project_id, project_name_snapshot, company_owner_id, old_pct, new_pct, old_was_default, reason, actor_id)
                  values ($1, 'Gone', $2, 50, 40, true, 'r', $2)`, [pid, I.OWNER]);
  await db.query(`delete from construction_projects where id = $1`, [pid]);
  eq(await mapping(db, pid), undefined, 'mapping gone');
  eq(await one(db, `select 1 x from pm_sharing_agreements where project_id = $1`, [pid]), undefined, 'agreement gone');
  eq(await one(db, `select project_id, project_name_snapshot from pm_sharing_changes where project_id = $1`, [pid]),
     { project_id: pid, project_name_snapshot: 'Gone' }, 'history kept');
});
await test('T1.8 partner_pct column refuses out-of-range values', async () => {
  const db = await fresh();
  const pid = await newProject(db, I.OWNER);
  assert((await err(db.query(`insert into pm_sharing_agreements (project_id, company_owner_id, partner_pct, version, updated_by)
                               values ($1, $2, 100.01, 1, $2)`, [pid, I.OWNER]))) !== 'no error', '100.01 refused');
});

// @@TASK2@@
// @@TASK3@@

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) { console.log(failures.join('\n')); process.exit(1); }
```

(The `// @@TASK2@@` and `// @@TASK3@@` lines are insertion anchors for Tasks 2 and 3. Each later task replaces its anchor with its tests and keeps the anchor line below them.)

- [ ] **Step 3: Run it to verify it fails**

Run: `npm --prefix supabase/tests install --no-package-lock --no-audit --no-fund && node supabase/tests/pm_sharing.pglite.mjs`
Expected: crash with `ENOENT … 0098_pm_profit_sharing.sql`.

- [ ] **Step 4: Write the migration's first part** — `supabase/migrations/0098_pm_profit_sharing.sql`:

```sql
-- ════════════════════════════════════════════════════════════════════
-- 0098 — PM profit sharing (Release 1).
-- Spec: docs/superpowers/specs/2026-10-18-pm-profit-sharing-mvp-terms.md
--
-- An INTERNAL allocation of a PM project's remaining cash (paid − direct
-- cost − warranty reserve) between the owner and the project's partner.
-- Never a payout, amount owed, invoice or accounting entry.
--
-- • Three private tables. RLS on, NO policies, privileges revoked: no
--   client role reads or writes them directly. Everything goes through the
--   security-definer functions below, which check the caller's company.
-- • Main owner = role 'owner', owner_id null, active. allowed_modules is
--   NEVER read — any account can edit its own list (spec finding F5).
-- • role and owner_id are trusted because profiles_guard (BEFORE UPDATE)
--   refuses any change to them from a signed-in caller (re-verified 18 Oct).
-- Idempotent where practical.
-- ════════════════════════════════════════════════════════════════════

-- ── 1. Who is calling, and which company is theirs ────────────────────
-- Company = the main owner's account id. Owner-role or staff accounts with
-- an owner_id belong to that owner's company, but only when the target is a
-- real, active main owner. Anything else is BAD_COMPANY_LINK.
create or replace function pm_caller_company() returns uuid
language plpgsql stable security definer set search_path = public as $$
declare v_me record; v_main record;
begin
  if auth.uid() is null then raise exception 'NOT_SIGNED_IN' using errcode = 'P0001'; end if;
  select id, role, owner_id, status into v_me from profiles where id = auth.uid();
  if not found then raise exception 'PROFILE_MISSING' using errcode = 'P0001'; end if;
  if coalesce(v_me.status, 'active') <> 'active' then raise exception 'INACTIVE' using errcode = 'P0001'; end if;
  if v_me.role is null or v_me.role not in ('owner', 'staff') then
    raise exception 'NOT_OFFICE' using errcode = 'P0001';
  end if;
  if v_me.owner_id is null then
    if v_me.role <> 'owner' then raise exception 'BAD_COMPANY_LINK' using errcode = 'P0001'; end if;
    return v_me.id;
  end if;
  select id, role, owner_id, status into v_main from profiles where id = v_me.owner_id;
  if not found or v_main.role is distinct from 'owner' or v_main.owner_id is not null
     or coalesce(v_main.status, 'active') <> 'active' then
    raise exception 'BAD_COMPANY_LINK' using errcode = 'P0001';
  end if;
  return v_main.id;
end;
$$;

-- Owner-role readers (main owner and focused owners such as admin-pm@).
create or replace function pm_owner_company() returns uuid
language plpgsql stable security definer set search_path = public as $$
declare v_role text; v_status text;
begin
  if auth.uid() is null then raise exception 'NOT_SIGNED_IN' using errcode = 'P0001'; end if;
  select role, status into v_role, v_status from profiles where id = auth.uid();
  if not found then raise exception 'PROFILE_MISSING' using errcode = 'P0001'; end if;
  if coalesce(v_status, 'active') <> 'active' then raise exception 'INACTIVE' using errcode = 'P0001'; end if;
  if v_role is distinct from 'owner' then raise exception 'OWNER_ONLY' using errcode = 'P0001'; end if;
  return pm_caller_company();
end;
$$;

-- The one account that may change a split.
create or replace function pm_main_owner_id() returns uuid
language plpgsql stable security definer set search_path = public as $$
declare v_role text; v_owner uuid; v_status text;
begin
  if auth.uid() is null then raise exception 'NOT_SIGNED_IN' using errcode = 'P0001'; end if;
  select role, owner_id, status into v_role, v_owner, v_status from profiles where id = auth.uid();
  if not found then raise exception 'PROFILE_MISSING' using errcode = 'P0001'; end if;
  if coalesce(v_status, 'active') <> 'active' then raise exception 'INACTIVE' using errcode = 'P0001'; end if;
  if v_role is distinct from 'owner' or v_owner is not null then
    raise exception 'OWNER_ONLY' using errcode = 'P0001';
  end if;
  return auth.uid();
end;
$$;

-- ── 2. Tables ─────────────────────────────────────────────────────────
-- Trusted project → company map. Rows come ONLY from the creation trigger
-- (source 'created') or an explicit owner-verified migration (0099,
-- source 'owner_verified'). pm_set_sharing never creates one.
create table if not exists pm_project_companies (
  project_id       uuid primary key references construction_projects(id) on delete cascade,
  company_owner_id uuid not null,
  mapped_by        uuid,
  mapped_at        timestamptz not null default now(),
  source           text not null check (source in ('owner_verified', 'created'))
);
create index if not exists pm_project_companies_company_idx on pm_project_companies(company_owner_id);

-- The current split. No row = 50/50 (computed on read, never back-filled).
create table if not exists pm_sharing_agreements (
  project_id       uuid primary key references construction_projects(id) on delete cascade,
  company_owner_id uuid not null,
  partner_pct      numeric(5,2) not null check (partner_pct >= 0 and partner_pct <= 100),
  version          int not null check (version >= 1),
  updated_by       uuid not null,
  updated_at       timestamptz not null default now()
);

-- Append-only history. project_id is a PLAIN value (no foreign key) so a
-- deleted project can neither cascade nor blank its history.
create table if not exists pm_sharing_changes (
  id                    uuid primary key default gen_random_uuid(),
  project_id            uuid not null,
  project_name_snapshot text,
  client_name_snapshot  text,
  company_owner_id      uuid not null,
  old_pct               numeric(5,2) not null,
  new_pct               numeric(5,2) not null,
  old_was_default       boolean not null,
  reason                text not null check (length(btrim(reason)) > 0),
  actor_id              uuid not null,
  actor_email           text,
  changed_at            timestamptz not null default now()
);
create index if not exists pm_sharing_changes_project_idx on pm_sharing_changes(project_id, changed_at);
create index if not exists pm_sharing_changes_company_idx on pm_sharing_changes(company_owner_id);

create or replace function pm_sharing_changes_immutable() returns trigger
language plpgsql as $$
begin
  raise exception 'HISTORY_IMMUTABLE' using errcode = 'P0001';
end;
$$;
drop trigger if exists pm_sharing_changes_immutable_trg on pm_sharing_changes;
create trigger pm_sharing_changes_immutable_trg
  before update or delete on pm_sharing_changes
  for each row execute function pm_sharing_changes_immutable();

-- ── 3. New projects map to the creator's company ──────────────────────
-- A signed-in creator with no valid company link is REJECTED (the insert
-- fails). An insert with no signed-in account (service role / SQL editor)
-- is left unmapped: sharing stays locked for it (plan decision D3).
create or replace function pm_map_new_project() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_company uuid;
begin
  if auth.uid() is null then return null; end if;
  v_company := pm_caller_company();
  insert into pm_project_companies (project_id, company_owner_id, mapped_by, source)
  values (new.id, v_company, auth.uid(), 'created');
  return null;
end;
$$;
drop trigger if exists pm_map_new_project_trg on construction_projects;
create trigger pm_map_new_project_trg
  after insert on construction_projects
  for each row execute function pm_map_new_project();

-- @@SECTION4@@
-- @@SECTION5@@

-- ── 6. Privileges ─────────────────────────────────────────────────────
alter table pm_project_companies  enable row level security;
alter table pm_sharing_agreements enable row level security;
alter table pm_sharing_changes    enable row level security;
revoke all on table pm_project_companies, pm_sharing_agreements, pm_sharing_changes
  from public, anon, authenticated;
revoke all on function pm_caller_company(), pm_owner_company(), pm_main_owner_id(),
                       pm_map_new_project(), pm_sharing_changes_immutable()
  from public, anon, authenticated;
-- @@GRANTS@@
```

(`@@SECTION4@@`, `@@SECTION5@@` and `@@GRANTS@@` are anchors for Tasks 2 and 3. When the last task that uses an anchor is done, delete the anchor line.)

- [ ] **Step 5: Add the suite to `test:sql`** in `package.json`. Append to the existing `test:sql` value:

```
 && node supabase/tests/pm_sharing.pglite.mjs
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `node supabase/tests/pm_sharing.pglite.mjs`
Expected: `8 passed, 0 failed`.

- [ ] **Step 7: Checkpoint** — show the user the diff summary (`git status --short`). The user commits. Do not run git commit.

---

### Task 2: `pm_set_sharing` — the only write

**Files:**
- Modify: `supabase/migrations/0098_pm_profit_sharing.sql` (replace `-- @@SECTION4@@`)
- Modify: `supabase/tests/pm_sharing.pglite.mjs` (replace `// @@TASK2@@`)

**Interfaces:**
- Consumes: `pm_main_owner_id()`, the three tables (Task 1).
- Produces: `pm_set_sharing(p_project uuid, p_partner_pct numeric, p_expected_version int, p_reason text) → jsonb` returning `{changed:boolean, version:int, partner_pct:numeric}`. Errors: `OWNER_ONLY`, `PROFILE_MISSING`, `INACTIVE`, `PROJECT_NOT_FOUND`, `PROJECT_UNMAPPED`, `WRONG_COMPANY`, `BAD_PCT`, `STALE`, `REASON_REQUIRED`.

- [ ] **Step 1: Write the failing tests** — replace `// @@TASK2@@` with:

```js
// ── Task 2: pm_set_sharing ──────────────────────────────────────────
async function setShare(db, uid, pid, pct, ver, reason) {
  await as(db, uid);
  return (await one(db, `select pm_set_sharing($1, $2::numeric, $3, $4) r`, [pid, pct, ver, reason])).r;
}
async function agreement(db, pid) {
  const r = await one(db, `select partner_pct::text p, version v from pm_sharing_agreements where project_id = $1`, [pid]);
  return r ? { p: r.p, v: r.v } : null;
}
async function historyCount(db, pid) { return Number((await one(db, `select count(*) n from pm_sharing_changes where project_id = $1`, [pid])).n); }

await test('T2.1 first save from the implicit 50/50 writes agreement v1 + one history row', async () => {
  const db = await fresh();
  const pid = await newProject(db, I.OWNER, 'Alpha', { client: 'Ana' });
  eq(await setShare(db, I.OWNER, pid, '40', 0, 'Agreed 60/40'), { changed: true, version: 1, partner_pct: 40 });
  eq(await agreement(db, pid), { p: '40.00', v: 1 });
  const h = await one(db, `select old_pct::text o, new_pct::text n, old_was_default d, reason, actor_id, actor_email,
                                  project_name_snapshot pn, client_name_snapshot cn, company_owner_id c
                             from pm_sharing_changes where project_id = $1`, [pid]);
  eq(h, { o: '50.00', n: '40.00', d: true, reason: 'Agreed 60/40', actor_id: I.OWNER, actor_email: 'admin@dacs.test',
          pn: 'Alpha', cn: 'Ana', c: I.OWNER });
});
await test('T2.2 saving the same % is a no-op: no version bump, no history', async () => {
  const db = await fresh();
  const pid = await newProject(db, I.OWNER);
  await setShare(db, I.OWNER, pid, '40', 0, 'r');
  eq(await setShare(db, I.OWNER, pid, '40', 1, ''), { changed: false, version: 1, partner_pct: 40 });
  eq(await historyCount(db, pid), 1);
  eq(await setShare(db, I.OWNER, await newProject(db, I.OWNER), '50', 0, null), { changed: false, version: 0, partner_pct: 50 },
     'saving 50 on a default project is a no-op');
});
await test('T2.3 precision: 40.123 refused (never stored as 40.12); 40.12, 0, 100, 33.33 accepted', async () => {
  const db = await fresh();
  const pid = await newProject(db, I.OWNER);
  assert((await err(setShare(db, I.OWNER, pid, '40.123', 0, 'r'))).includes('BAD_PCT'), '40.123');
  eq(await agreement(db, pid), null, 'nothing stored');
  let v = 0;
  for (const p of ['40.12', '0', '100', '33.33']) {
    const r = await setShare(db, I.OWNER, pid, p, v, 'r ' + p);
    assert(r.changed, p + ' accepted'); v = r.version;
  }
  eq(await agreement(db, pid), { p: '33.33', v: 4 });
});
await test('T2.4 invalid values refused: null, NaN, Infinity, -1, 100.01', async () => {
  const db = await fresh();
  const pid = await newProject(db, I.OWNER);
  for (const p of [null, 'NaN', 'Infinity', '-1', '100.01']) {
    assert((await err(setShare(db, I.OWNER, pid, p, 0, 'r'))).includes('BAD_PCT'), String(p));
  }
});
await test('T2.5 reason required, including when leaving the implicit 50/50', async () => {
  const db = await fresh();
  const pid = await newProject(db, I.OWNER);
  for (const r of [null, '', '   ']) {
    assert((await err(setShare(db, I.OWNER, pid, '40', 0, r))).includes('REASON_REQUIRED'), JSON.stringify(r));
  }
});
await test('T2.6 stale version refused', async () => {
  const db = await fresh();
  const pid = await newProject(db, I.OWNER);
  await setShare(db, I.OWNER, pid, '40', 0, 'r');
  assert((await err(setShare(db, I.OWNER, pid, '30', 0, 'r'))).includes('STALE'), 'expected 0 after v1');
  assert((await err(setShare(db, I.OWNER, pid, '30', null, 'r'))).includes('STALE'), 'null version');
});
await test('T2.7 only the main owner writes — focused owner refused even with allowed_modules cleared', async () => {
  const db = await fresh();
  const pid = await newProject(db, I.OWNER);
  for (const [uid, code] of [[I.PMOWNER, 'OWNER_ONLY'], [I.STAFF, 'OWNER_ONLY'], [I.CLIENT, 'OWNER_ONLY'],
                             [I.PARTNER, 'OWNER_ONLY'], [I.INACT, 'INACTIVE'], [I.NOPROFILE, 'PROFILE_MISSING'],
                             [I.BADLINK, 'OWNER_ONLY']]) {
    assert((await err(setShare(db, uid, pid, '40', 0, 'r'))).includes(code), uid + ' → ' + code);
  }
  await as(db, '');
  await db.query(`update profiles set allowed_modules = '[]'::jsonb where id = $1`, [I.PMOWNER]);
  assert((await err(setShare(db, I.PMOWNER, pid, '40', 0, 'r'))).includes('OWNER_ONLY'), 'cleared modules');
  eq(await agreement(db, pid), null, 'nothing written');
});
await test('T2.8 company checks: other company refused, unmapped refused and never mapped', async () => {
  const db = await fresh();
  const pid = await newProject(db, I.OWNER);
  assert((await err(setShare(db, I.OTHER, pid, '40', 0, 'r'))).includes('WRONG_COMPANY'), 'other company');
  const orphan = await newProject(db, '');
  assert((await err(setShare(db, I.OWNER, orphan, '40', 0, 'r'))).includes('PROJECT_UNMAPPED'), 'unmapped');
  eq(await mapping(db, orphan), undefined, 'still unmapped');
  assert((await err(setShare(db, I.OWNER, '00000000-0000-0000-0000-0000000000ff', '40', 0, 'r'))).includes('PROJECT_NOT_FOUND'), 'missing');
});
```

- [ ] **Step 2: Run to verify the new tests fail**

Run: `node supabase/tests/pm_sharing.pglite.mjs`
Expected: T1.x pass; T2.x FAIL with `function pm_set_sharing(...) does not exist`.

- [ ] **Step 3: Implement** — replace `-- @@SECTION4@@` in the migration with:

```sql
-- ── 4. Change a split — main owner only, atomically, with history ─────
-- Order matters:
--   1. main owner (profile, active, role owner, no owner_id)
--   2. LOCK THE PROJECT ROW so two first saves (no agreement row yet)
--      serialise; then lock the agreement row if it exists
--   3. project mapped to the caller's company
--   4. validate the RAW %: numeric(5,2) would round 40.123 → 40.12
--   5. optimistic version check (0 when no row)
--   6. same value → no-op, no history
--   7. reason required (also when leaving the implicit 50/50)
--   8. upsert agreement (version + 1) and insert history together
create or replace function pm_set_sharing(p_project uuid, p_partner_pct numeric,
                                          p_expected_version int, p_reason text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_company uuid;
  v_proj    record;
  v_map     record;
  v_cur     record;
  v_has     boolean;
  v_ver     int;
  v_old     numeric;
  v_email   text;
begin
  v_company := pm_main_owner_id();

  select id, project_name, client_name into v_proj
    from construction_projects where id = p_project for update;
  if not found then raise exception 'PROJECT_NOT_FOUND' using errcode = 'P0001'; end if;

  select company_owner_id into v_map from pm_project_companies where project_id = p_project;
  if not found then raise exception 'PROJECT_UNMAPPED' using errcode = 'P0001'; end if;
  if v_map.company_owner_id is distinct from v_company then
    raise exception 'WRONG_COMPANY' using errcode = 'P0001';
  end if;

  if p_partner_pct is null or p_partner_pct = 'NaN'::numeric
     or p_partner_pct < 0 or p_partner_pct > 100
     or p_partner_pct <> round(p_partner_pct, 2) then
    raise exception 'BAD_PCT' using errcode = 'P0001';
  end if;

  select partner_pct, version into v_cur from pm_sharing_agreements where project_id = p_project for update;
  v_has := found;
  v_ver := case when v_has then v_cur.version else 0 end;
  if p_expected_version is null or p_expected_version <> v_ver then
    raise exception 'STALE' using errcode = 'P0001';
  end if;

  v_old := case when v_has then v_cur.partner_pct else 50 end;
  if p_partner_pct = v_old then
    return jsonb_build_object('changed', false, 'version', v_ver, 'partner_pct', v_old);
  end if;

  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'REASON_REQUIRED' using errcode = 'P0001';
  end if;

  insert into pm_sharing_agreements (project_id, company_owner_id, partner_pct, version, updated_by, updated_at)
  values (p_project, v_company, p_partner_pct, v_ver + 1, v_company, now())
  on conflict (project_id) do update
     set partner_pct = excluded.partner_pct, version = excluded.version,
         updated_by = excluded.updated_by, updated_at = excluded.updated_at;

  select email into v_email from profiles where id = v_company;
  insert into pm_sharing_changes (project_id, project_name_snapshot, client_name_snapshot, company_owner_id,
                                  old_pct, new_pct, old_was_default, reason, actor_id, actor_email)
  values (p_project, v_proj.project_name, v_proj.client_name, v_company,
          v_old, p_partner_pct, not v_has, btrim(p_reason), v_company, v_email);

  return jsonb_build_object('changed', true, 'version', v_ver + 1, 'partner_pct', p_partner_pct);
end;
$$;
```

- [ ] **Step 4: Run to verify they pass**

Run: `node supabase/tests/pm_sharing.pglite.mjs`
Expected: `16 passed, 0 failed`. If T2.1's `partner_pct` comes back as `"40"` instead of `40`: PGlite returns a jsonb numeric as a JS number, so the `eq` expects `40`. If your PGlite version returns a string, change the expected values in T2.1/T2.2 to match what PostgreSQL returns, not the other way round.

- [ ] **Step 5: Checkpoint** — diff summary to the user; the user commits.

---

### Task 3: Reads — `pm_sharing_read`, `wf_reserves_for`, grants

**Files:**
- Modify: `supabase/migrations/0098_pm_profit_sharing.sql` (replace `-- @@SECTION5@@` and `-- @@GRANTS@@`)
- Modify: `supabase/tests/pm_sharing.pglite.mjs` (replace `// @@TASK3@@`)

**Interfaces:**
- Consumes: `pm_owner_company()`, tables.
- Produces:
  - `pm_sharing_read(p_projects uuid[] default null) → jsonb` = `{ can_edit:boolean, projects:[{project_id, partner_pct, is_default, version}], history:[{project_id, old_pct, new_pct, old_was_default, reason, actor_email, changed_at, project_name}], partners:[{email, accepted, accepted_at, doc_version}] }`. `null` = all of the caller's mapped projects. Errors as `pm_owner_company`.
  - `wf_reserves_for(p_projects uuid[]) → jsonb` = `[{project_id, ref_no, status, deleted, contributed_amount, total_paid, direct_cost, completed_at}]`, at most one per project: the live row if any, else the latest deleted one.

- [ ] **Step 1: Write the failing tests** — replace `// @@TASK3@@` with:

```js
// ── Task 3: reads ───────────────────────────────────────────────────
async function readAs(db, uid, ids = null) {
  await as(db, uid);
  return (await one(db, `select pm_sharing_read($1::uuid[]) r`, [ids])).r;
}
async function reservesAs(db, uid, ids) {
  await as(db, uid);
  return (await one(db, `select wf_reserves_for($1::uuid[]) r`, [ids])).r;
}

await test('T3.1 owner reads own company: defaults 50/v0, can_edit true; other company invisible', async () => {
  const db = await fresh();
  const a = await newProject(db, I.OWNER);
  const b = await newProject(db, I.OWNER);
  await newProject(db, I.OTHER);
  await setShare(db, I.OWNER, a, '40', 0, 'r');
  const r = await readAs(db, I.OWNER);
  eq(r.can_edit, true);
  const byId = Object.fromEntries(r.projects.map(p => [p.project_id, p]));
  eq(Object.keys(byId).sort(), [a, b].sort(), 'only company A projects');
  eq([byId[a].partner_pct, byId[a].is_default, byId[a].version], [40, false, 1]);
  eq([byId[b].partner_pct, byId[b].is_default, byId[b].version], [50, true, 0]);
  eq(r.history.length, 1);
});
await test('T3.2 focused owner reads the same data with can_edit false', async () => {
  const db = await fresh();
  const a = await newProject(db, I.OWNER);
  await setShare(db, I.OWNER, a, '40', 0, 'r');
  const r = await readAs(db, I.PMOWNER);
  eq(r.can_edit, false);
  eq(r.projects.map(p => p.project_id), [a]);
  eq(r.history.map(h => h.reason), ['r']);
});
await test('T3.3 staff, client, partner, inactive, missing profile and bad link are refused reads', async () => {
  const db = await fresh();
  for (const [uid, code] of [[I.STAFF, 'OWNER_ONLY'], [I.CLIENT, 'OWNER_ONLY'], [I.PARTNER, 'OWNER_ONLY'],
                             [I.INACT, 'INACTIVE'], [I.NOPROFILE, 'PROFILE_MISSING'], [I.BADLINK, 'BAD_COMPANY_LINK']]) {
    assert((await err(readAs(db, uid))).includes(code), uid + ' → ' + code);
  }
});
await test('T3.4 the other company reads nothing of ours, even when it names our ids', async () => {
  const db = await fresh();
  const a = await newProject(db, I.OWNER);
  await setShare(db, I.OWNER, a, '40', 0, 'r');
  const r = await readAs(db, I.OTHER, [a]);
  eq([r.projects.length, r.history.length], [0, 0]);
});
await test('T3.5 partner acceptance facts come from the partner profile only', async () => {
  const db = await fresh();
  const a = await newProject(db, I.OWNER, 'A', { partner: ' Partner@X.test ' });
  const r = await readAs(db, I.OWNER, [a]);
  eq(r.partners.length, 1);
  eq([r.partners[0].email, r.partners[0].accepted, r.partners[0].doc_version], ['partner@x.test', true, 3]);
});
await test('T3.6 wf_reserves_for: owner + focused owner read; other company / staff do not', async () => {
  const db = await fresh();
  const a = await newProject(db, I.OWNER, 'A', { status: 'completed' });
  await as(db, '');
  await db.query(`insert into warranty_retentions (owner_id, project_id, ref_no, status, total_paid, direct_cost, contributed_amount)
                  values ($1, $2, 'WR-1', 'active', 280000, 188950, 4552.5)`, [I.OWNER, a]);
  for (const uid of [I.OWNER, I.PMOWNER]) {
    const r = await reservesAs(db, uid, [a]);
    eq(r.map(x => [x.ref_no, Number(x.contributed_amount), x.deleted]), [['WR-1', 4552.5, false]], uid);
  }
  eq(await reservesAs(db, I.OTHER, [a]), [], 'other company');
  assert((await err(reservesAs(db, I.STAFF, [a]))).includes('OWNER_ONLY'), 'staff');
});
await test('T3.7 wf_reserves_for prefers the live row; a lone deleted row is returned flagged deleted', async () => {
  const db = await fresh();
  const a = await newProject(db, I.OWNER, 'A', { status: 'completed' });
  const b = await newProject(db, I.OWNER, 'B', { status: 'completed' });
  await as(db, '');
  await db.query(`insert into warranty_retentions (owner_id, project_id, ref_no, status, contributed_amount, deleted_at)
                  values ($1, $2, 'OLD', 'active', 1, now()), ($1, $2, 'LIVE', 'active', 2, null),
                         ($1, $3, 'GONE', 'active', 3, now())`, [I.OWNER, a, b]);
  const r = Object.fromEntries((await reservesAs(db, I.OWNER, [a, b])).map(x => [x.project_id, [x.ref_no, x.deleted]]));
  eq(r[a], ['LIVE', false]); eq(r[b], ['GONE', true]);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node supabase/tests/pm_sharing.pglite.mjs`
Expected: T3.x FAIL with `function pm_sharing_read(uuid[]) does not exist`.

- [ ] **Step 3: Implement** — replace `-- @@SECTION5@@` with:

```sql
-- ── 5. Reads (owner-role accounts of the company) ─────────────────────
create or replace function pm_sharing_read(p_projects uuid[] default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
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
         order by lower(pr.email), pr.partner_agreement_accepted_at desc nulls last) s), '[]'::jsonb)
  );
end;
$$;

-- Recorded warranty reserves for the caller's company. warranty_retentions
-- RLS is owner_id = auth.uid(), which hides the main owner's rows from
-- admin-pm@ (plan D2). Called ONLY by WF.reserveFor in js/warranty-fund.js.
create or replace function wf_reserves_for(p_projects uuid[]) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_company uuid := pm_owner_company();
begin
  return coalesce((
    select jsonb_agg(s.x) from (
      select distinct on (w.project_id) jsonb_build_object(
               'project_id', w.project_id, 'ref_no', w.ref_no, 'status', w.status,
               'deleted', w.deleted_at is not null,
               'contributed_amount', w.contributed_amount,
               'total_paid', w.total_paid, 'direct_cost', w.direct_cost,
               'completed_at', w.completed_at) as x
        from warranty_retentions w
        join pm_project_companies m on m.project_id = w.project_id and m.company_owner_id = v_company
        join profiles wp on wp.id = w.owner_id
                        and (wp.id = v_company or (wp.role = 'owner' and wp.owner_id = v_company))
       where w.project_id = any(coalesce(p_projects, '{}'::uuid[]))
       order by w.project_id, (w.deleted_at is null) desc, w.updated_at desc nulls last, w.id) s), '[]'::jsonb);
end;
$$;
```

And replace `-- @@GRANTS@@` with:

```sql
revoke all on function pm_set_sharing(uuid, numeric, int, text), pm_sharing_read(uuid[]), wf_reserves_for(uuid[])
  from public, anon;
grant execute on function pm_set_sharing(uuid, numeric, int, text), pm_sharing_read(uuid[]), wf_reserves_for(uuid[])
  to authenticated;
```

- [ ] **Step 4: Run to verify they pass**

Run: `node supabase/tests/pm_sharing.pglite.mjs`
Expected: `23 passed, 0 failed`. Confirm no `@@` anchor remains: `grep -n "@@" supabase/migrations/0098_pm_profit_sharing.sql supabase/tests/pm_sharing.pglite.mjs` prints nothing.

- [ ] **Step 5: Checkpoint** — diff summary; the user commits.

---

### Task 4: First-save concurrency on real PostgreSQL

**Files:**
- Create: `supabase/tests/pm_sharing_concurrency.mjs`
- Modify: `package.json` (`test:sql`)

**Interfaces:** Consumes `PM_BASE`, `IDS`, `seedProfiles` (Task 1), `pm_set_sharing` (Task 2).

- [ ] **Step 1: Write the test**

```js
// ════════════════════════════════════════════════════════════════════
// PM PROFIT SHARING (0098) — TWO FIRST SAVES AT ONCE, REAL POSTGRESQL
//   npm run test:sql
// A throwaway PostgreSQL (embedded-postgres), 0098 VERBATIM. Two owner
// sessions save the SAME project's first split (no agreement row yet,
// both expecting version 0) at the same moment. The project-row lock
// must serialise them: exactly one wins, the other gets STALE, one
// history row, no deadlock.
// ════════════════════════════════════════════════════════════════════
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PM_BASE, IDS, seedProfiles } from './pm_sharing_base.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.DACS_ROOT || path.join(HERE, '..', '..');
const M98 = fs.readFileSync(path.join(ROOT, 'supabase/migrations/0098_pm_profit_sharing.sql'), 'utf8').replace(/\r\n/g, '\n');
const ROUNDS = 15;
let passed = 0, failed = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) { passed++; console.log('  ok  ' + name); }
  else { failed++; failures.push(name + ' — ' + detail); console.log('  FAIL ' + name + '\n       ' + detail); }
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dacs-pmshare-pg-'));
const port = 55000 + Math.floor(Math.random() * 4000);
const server = new EmbeddedPostgres({ databaseDir: dir, user: 'postgres', password: 'pw', port, persistent: false,
  initdbFlags: ['--encoding=UTF8', '--locale=C'], onLog: () => {} });
const cfg = { host: 'localhost', port, user: 'postgres', password: 'pw', database: 'postgres' };

console.log('\nPM profit sharing — two first saves at once (0098 on PostgreSQL)');
await server.initialise();
await server.start();
const admin = new pg.Client(cfg);
await admin.connect();
try {
  await admin.query(PM_BASE);
  await admin.query(M98);
  await seedProfiles((sql) => admin.query(sql));

  const session = async (uid) => {
    const c = new pg.Client(cfg); await c.connect();
    await c.query(`select set_config('test.uid', '${uid}', false)`);
    return c;
  };
  const run = async (c, pid, pct) => {
    try {
      await c.query('begin');
      const r = await c.query(`select pm_set_sharing($1, $2::numeric, 0, 'race') r`, [pid, pct]);
      await c.query('select pg_sleep(0.03)');
      await c.query('commit');
      return { ok: true, r: r.rows[0].r };
    } catch (e) {
      try { await c.query('rollback'); } catch {}
      return { ok: false, code: e.code, msg: e.message };
    }
  };

  let oneWinner = true, staleLoser = true, deadlock = false, history = true, versions = true;
  for (let i = 0; i < ROUNDS; i++) {
    await admin.query(`select set_config('test.uid', '${IDS.OWNER}', false)`);
    const pid = (await admin.query(`insert into construction_projects (project_name, status) values ('race ${i}', 'active') returning id`)).rows[0].id;
    const [a, b] = [await session(IDS.OWNER), await session(IDS.OWNER)];
    const [ra, rb] = await Promise.all([run(a, pid, i % 2 ? '40' : '60'), run(b, pid, '40')]);
    await a.end(); await b.end();
    const wins = [ra, rb].filter(r => r.ok && r.r.changed);
    const losers = [ra, rb].filter(r => !r.ok);
    if (wins.length !== 1) oneWinner = false;
    if (losers.length !== 1 || !losers[0].msg.includes('STALE')) staleLoser = false;
    if ([ra, rb].some(r => r.code === '40P01')) deadlock = true;
    const h = (await admin.query(`select count(*)::int n from pm_sharing_changes where project_id = $1`, [pid])).rows[0].n;
    if (h !== 1) history = false;
    const v = (await admin.query(`select version from pm_sharing_agreements where project_id = $1`, [pid])).rows[0].version;
    if (v !== 1) versions = false;
  }
  check('exactly one first save wins per round', oneWinner, 'a round had 0 or 2 winners');
  check('the other first save gets STALE', staleLoser, 'a loser was not STALE');
  check('no deadlock', !deadlock, '40P01 seen');
  check('exactly one history row per project', history, 'history count ≠ 1');
  check('agreement ends at version 1', versions, 'version ≠ 1');
} finally {
  await admin.end();
  await server.stop();
  fs.rmSync(dir, { recursive: true, force: true });
}
console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) { console.log(failures.join('\n')); process.exit(1); }
```

- [ ] **Step 2: Add it to `test:sql`** — append ` && node supabase/tests/pm_sharing_concurrency.mjs`.

- [ ] **Step 3: Run it**

Run: `node supabase/tests/pm_sharing_concurrency.mjs`
Expected: `5 passed, 0 failed`. To prove the test can catch the bug, temporarily delete `for update` from the `construction_projects` select in `pm_set_sharing`, re-run, and confirm a FAIL appears (a duplicate-key error or two history rows). **Restore the line**, then re-run to green.

- [ ] **Step 4: Checkpoint** — diff summary; the user commits.

---

### Task 5: `js/pm-sharing.js` — the shared calculation

**Files:**
- Create: `js/pm-sharing.js`
- Create: `tests/pm-sharing.test.js`
- Modify: `package.json` (`test`)

**Interfaces:**
- Produces `window.PMShare` (and `module.exports`):
  - `WARRANTY_PCT = 5`, `DEFAULT_PARTNER_PCT = 50`
  - `toCents(n) → int`, `roundDiv(num:int, den:int) → int` (half away from zero)
  - `paid(reqs) → number`, `outstanding(reqs) → number`, `directCost(bills) → number` (unchanged semantics, D4)
  - `split(balanceCents, partnerPct) → {partnerCents, ownerCents}`
  - `reserveFor(status, remainingCents, rec, paidCents, costCents) → {cents, kind:'recorded'|'provisional'|'estimate', needsReview, changedSinceCloseout, floored}`
  - `project(input) → Result` where input = `{id, name, clientName, partnerEmail, status, terminatedAt, bills, reqs, reserveRow, partnerPct}` and `reserveRow` = `{contributedAmount, status, deleted, totalPaid, directCost}` or null. `Result` = `{id, name, clientName, partnerEmail, status, completionKey, paidCents, costCents, outstandingCents, remainingCents, reserve, balanceCents, partnerPct, ownerPct, partnerCents, ownerCents, flags:string[], confirmed:boolean}`
  - `combine(results) → {totals, confirmed, review}`, totals = `{count, reviewCount, estimateCount, paidCents, costCents, reserveCents, availableCents, shortfallCents, netCents, ownerCents, partnerCents, ownerShortfallCents, partnerShortfallCents, outstandingCents}`
  - `dateKey(ts) → 'YYYY-MM-DD' | ''` (local parts), `fmtPct(n) → string`, `pesos(cents) → string`

- [ ] **Step 1: Write the failing tests** — `tests/pm-sharing.test.js`:

```js
// ════════════════════════════════════════════════════════════════════
// PM PROFIT SHARING — run with: node tests/pm-sharing.test.js
// Spec: docs/superpowers/specs/2026-10-18-pm-profit-sharing-mvp-terms.md
// Section A drives js/pm-sharing.js directly. Later sections run the REAL
// pm-admin.js / pm-sharing-dashboard.js in a sandbox (tests/helpers) and
// check what each screen actually shows — never a source pattern alone.
// ════════════════════════════════════════════════════════════════════
'use strict';
process.env.TZ = 'Asia/Manila';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const P = require('../js/pm-sharing.js');

let passed = 0, failed = 0;
const failures = [];
const queue = [];
function test(name, fn) { queue.push([name, fn]); }
function eq(a, b, label) {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error((label || 'value') + ': expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a));
}
function ok(c, label) { if (!c) throw new Error(label || 'expected truthy'); }

// ── fixtures ─────────────────────────────────────────────────────────
const verified = (amt) => ({ status: 'verified', amountPaid: amt });
const bill = (dct) => ({ directCostTotal: dct });
const rec = (contrib, paid, cost, extra = {}) => ({ contributedAmount: contrib, status: 'active', deleted: false, totalPaid: paid, directCost: cost, ...extra });
// Worked example (spec §7.9): A remaining 800,000 / reserve 40,000 / 60:40; B 500,000 / 25,000 / 50:50.
const projA = { id: 'A', projectName: 'Alpha', clientName: 'Ana', partnerEmail: 'p@x.test', status: 'completed', terminatedAt: '2026-08-02T03:00:00Z' };
const projB = { id: 'B', projectName: 'Beta', clientName: 'Ben', partnerEmail: '', status: 'completed', terminatedAt: null };
const inA = { ...projA, name: projA.projectName, bills: [], reqs: [verified(800000)], reserveRow: rec(40000, 800000, 0), partnerPct: 40 };
const inB = { ...projB, name: projB.projectName, bills: [], reqs: [verified(500000)], reserveRow: rec(25000, 500000, 0), partnerPct: 50 };

// ══ A. Calculation ═══════════════════════════════════════════════════
test('A1 worked example: ₱693,500 owner / ₱541,500 partner', () => {
  const c = P.combine([P.project(inA), P.project(inB)]);
  eq([c.totals.ownerCents, c.totals.partnerCents, c.totals.netCents, c.totals.reserveCents],
     [69350000, 54150000, 123500000, 6500000]);
});
test('A2 mixed percentages are split per project before combining', () => {
  const a = P.project(inA), b = P.project(inB);
  eq([a.ownerCents, a.partnerCents, b.ownerCents, b.partnerCents], [45600000, 30400000, 23750000, 23750000]);
});
test('A3 −₱100,000 remaining → reserve ₱0, −₱50,000 each, Shortfall (active and needs-review)', () => {
  for (const status of ['active', 'completed']) {
    const r = P.project({ id: 'L', status, bills: [bill(100000)], reqs: [], reserveRow: null, partnerPct: 50 });
    eq([r.reserve.cents, r.balanceCents, r.ownerCents, r.partnerCents, r.reserve.floored], [0, -10000000, -5000000, -5000000, true], status);
    ok(r.flags.includes('shortfall'), status + ' shortfall flag');
  }
});
test('A4 rounding: half away from zero, owner gets the residual', () => {
  eq(P.split(1, 50), { partnerCents: 1, ownerCents: 0 });
  eq(P.split(-1, 50), { partnerCents: -1, ownerCents: 0 });
  eq(P.split(10000, 33.33), { partnerCents: 3333, ownerCents: 6667 });
  eq(P.split(76000000, 0), { partnerCents: 0, ownerCents: 76000000 });
  eq(P.split(76000000, 100), { partnerCents: 76000000, ownerCents: 0 });
  eq([P.toCents(1.005), P.toCents(-1.005), P.toCents(5724.900000000001), P.toCents('12.34')], [101, -101, 572490, 1234]);
});
test('A5 reserve kinds: recorded ₱0 is valid; missing / void / deleted → provisional + needs review', () => {
  eq(P.reserveFor('completed', 100000, rec(0, 1000, 0), 100000, 0).kind, 'recorded');
  eq(P.reserveFor('completed', 100000, rec(0, 1000, 0), 100000, 0).needsReview, false);
  for (const r of [null, rec(5, 0, 0, { status: 'void' }), rec(5, 0, 0, { deleted: true })]) {
    const x = P.reserveFor('completed', 100000, r, 100000, 0);
    eq([x.kind, x.needsReview, x.cents], ['provisional', true, 5000]);
  }
  eq(P.reserveFor('active', 100000, null, 100000, 0).kind, 'estimate');
});
test('A6 needs review is the ONLY exclusion; warning chips stay in totals and can coexist', () => {
  const unpaidChanged = P.project({ ...inB, id: 'U', reqs: [verified(500000), { status: 'unpaid', totalAmount: 1000, amountPaid: 0 }],
                                    reserveRow: rec(25000, 400000, 0) });
  eq(unpaidChanged.flags, ['unpaid_balance', 'changed_since_closeout']);
  eq(unpaidChanged.confirmed, true);
  const review = P.project({ ...inB, id: 'R', reserveRow: null });
  const c = P.combine([P.project(inA), unpaidChanged, review]);
  eq([c.totals.count, c.totals.reviewCount, c.review.map(r => r.id)], [2, 1, ['R']]);
});
test('A7 changed since closeout compares current paid/cost with the closeout snapshot', () => {
  eq(P.project(inA).reserve.changedSinceCloseout, false);
  eq(P.project({ ...inA, bills: [bill(1)] }).reserve.changedSinceCloseout, true);
});
test('A8 legacy bills: ladder unchanged (D4); supply & install counted once', () => {
  eq(P.directCost([{ directCostTotal: 0, labor: 100, materials: 50, overhead: 30 }]), 150, 'labor+materials step (no overhead — F6)');
  eq(P.directCost([{ grandTotal: 115, managementFee: 15 }]), 100, 'grandTotal − fee step');
  eq(P.directCost([{ directCostTotal: 0, labor: 0, materials: 200, combined: 80 }]), 200, 'combined inside materials');
  eq(P.directCost([bill(1000), { directCostTotal: 0, labor: 10 }]), 1010);
});
test('A9 paid / outstanding keep the existing eligibility rules', () => {
  eq(P.paid([verified(100), { status: 'verified', paidAmount: 20 }, { status: 'verified', totalAmount: 7 },
             { status: 'partial', amountPaid: 5 }, { status: 'unpaid', totalAmount: 50 }]), 132);
  eq(P.outstanding([{ status: 'unpaid', totalAmount: 50 }, { status: 'partial', totalAmount: 30, amountPaid: 5 }, verified(9)]), 75);
});
test('A10 closeout parity: termination-requests.js ladder = PMShare.directCost', () => {
  const src = read('js/termination-requests.js');
  const start = src.indexOf('const directCost = bills.reduce((s, b) => {');
  ok(start !== -1, 'SLICE NOT FOUND: closeout directCost ladder — update tests/pm-sharing.test.js');
  const end = src.indexOf('}, 0);', start) + '}, 0);'.length;
  const ladder = new Function('bills', 'num', src.slice(start, end) + '\nreturn directCost;');
  const num = (v) => Number(v) || 0;
  const bills = [bill(1000), { directCostTotal: 0, labor: 100, materials: 50, overhead: 30 }, { grandTotal: 115, managementFee: 15 }];
  eq(ladder(bills, num), P.directCost(bills));
});
test('A11 partner email normalised; unassigned stays empty, never the client', () => {
  eq(P.project({ ...inA, partnerEmail: ' P@X.test ' }).partnerEmail, 'p@x.test');
  eq(P.project({ ...inB, clientEmail: 'client@x.test', partnerEmail: undefined }).partnerEmail, '');
});
test('A12 completion date key uses local (PH) parts, undated stays empty', () => {
  eq(P.dateKey('2026-08-01T17:30:00Z'), '2026-08-02', 'UTC evening = next PH day');
  eq(P.dateKey(null), ''); eq(P.dateKey('nonsense'), '');
  eq(P.dateKey({ toDate: () => new Date(2026, 7, 2, 9) }), '2026-08-02');
});
test('A13 fmtPct / pesos formatting', () => {
  eq([P.fmtPct(40), P.fmtPct(33.33), P.fmtPct(12.5), P.fmtPct(66.67000000000002)], ['40', '33.33', '12.5', '66.67']);
  eq([P.pesos(45600000), P.pesos(-5000000), P.pesos(0)], ['₱456,000.00', '−₱50,000.00', '₱0.00']);
});

// @@SECTIONS@@

// ── runner ───────────────────────────────────────────────────────────
(async () => {
  console.log('\nPM profit sharing');
  for (const [name, fn] of queue) {
    try { await fn(); passed++; console.log('  ok  ' + name); }
    catch (e) { failed++; failures.push(name + ' — ' + e.message); console.log('  FAIL ' + name + '\n       ' + e.message); }
  }
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  if (failed) { console.log(failures.join('\n')); process.exit(1); }
})();
```

(Later tasks insert their sections **above** the `// @@SECTIONS@@` line and keep the anchor.)

- [ ] **Step 2: Run it to verify it fails**

Run: `node tests/pm-sharing.test.js`
Expected: crash `Cannot find module '../js/pm-sharing.js'`.

- [ ] **Step 3: Implement `js/pm-sharing.js`**

```js
/* ══════════════════════════════════════════════════════════
   PM PROFIT SHARING — the ONE calculation (window.PMShare)
   Spec: docs/superpowers/specs/2026-10-18-pm-profit-sharing-mvp-terms.md

   An INTERNAL allocation of a PM project's remaining cash between the
   owner and the partner. Never a payout, amount owed or accounting entry,
   and outside Project Control's Spent / Earned / Profit entirely.

     Remaining cash  = paid − direct cost          (existing PM rules)
     Reserve         = recorded at closeout (completed), else
                       max(0, remaining × 5%)  — estimate / provisional
     Sharing balance = remaining − reserve
     Partner amount  = balance × partner% (centavos, half away from 0)
     Owner amount    = balance − partner amount

   Pure functions + thin RPC wrappers. Overview, Reports and the Profit
   Sharing dashboard only FORMAT what this returns.
   ══════════════════════════════════════════════════════════ */
(function (root) {
  'use strict';

  const WARRANTY_PCT = 5;
  const DEFAULT_PARTNER_PCT = 50;

  // Integer centavos. The tiny epsilon absorbs binary noise
  // (1.005 * 100 = 100.49999…; 5724.900000000001 from a stored reserve).
  function toCents(n) {
    const x = Number(n);
    if (!Number.isFinite(x)) return 0;
    const c = Math.round(Math.abs(x) * 100 + 1e-6);
    return x < 0 ? -c : c;
  }
  // num / den for integers, rounded half AWAY from zero.
  function roundDiv(num, den) {
    const neg = (num < 0) !== (den < 0);
    const a = Math.abs(num), d = Math.abs(den);
    let q = Math.floor(a / d);
    if ((a - q * d) * 2 >= d) q += 1;
    return neg ? -q : q;
  }
  function round2(n) { return Math.round(Number(n) * 100) / 100; }

  // ── existing PM rules, unchanged (plan D4) ─────────────────────────
  // Cash received: a verified request counts its paid amount (falling back
  // to paidAmount / totalAmount); anything else counts what was paid.
  function paid(reqs) {
    return (reqs || []).reduce((s, r) => {
      if (r.status === 'verified') return s + (Number(r.amountPaid || r.paidAmount || r.totalAmount) || 0);
      return s + (Number(r.amountPaid) || 0);
    }, 0);
  }
  function outstanding(reqs) {
    return (reqs || []).filter(r => r.status === 'unpaid' || r.status === 'partial')
      .reduce((s, r) => s + ((Number(r.totalAmount) || 0) - (Number(r.amountPaid) || 0)), 0);
  }
  // directCostTotal, then labor + materials, then grandTotal − fee. 0 counts
  // as missing. `materials` already includes supply & install (combined).
  // The middle step omits overhead (finding F6): no live bill uses it.
  function directCost(bills) {
    return (bills || []).reduce((s, b) => {
      const dct = Number(b.directCostTotal) || 0;
      if (dct) return s + dct;
      const lm = (Number(b.labor) || 0) + (Number(b.materials) || 0);
      if (lm) return s + lm;
      return s + ((Number(b.grandTotal) || 0) - (Number(b.managementFee) || 0));
    }, 0);
  }

  function split(balanceCents, partnerPct) {
    const bp = Math.round(Number(partnerPct) * 100);           // 40.25% → 4025
    const partnerCents = roundDiv(balanceCents * bp, 10000);
    return { partnerCents, ownerCents: balanceCents - partnerCents };
  }

  function reserveFor(status, remainingCents, rec, paidCents, costCents) {
    const estimate = Math.max(0, roundDiv(remainingCents * WARRANTY_PCT, 100));
    const floored = remainingCents < 0;
    if (status !== 'completed') {
      return { cents: estimate, kind: 'estimate', needsReview: false, changedSinceCloseout: false, floored };
    }
    const amt = rec ? Number(rec.contributedAmount) : NaN;
    const usable = !!rec && !rec.deleted && rec.status !== 'void' && Number.isFinite(amt) && amt >= 0;
    if (!usable) {
      return { cents: estimate, kind: 'provisional', needsReview: true, changedSinceCloseout: false, floored };
    }
    const changed = toCents(rec.totalPaid) !== paidCents || toCents(rec.directCost) !== costCents;
    return { cents: toCents(amt), kind: 'recorded', needsReview: false, changedSinceCloseout: changed, floored: false };
  }

  function dateKey(ts) {
    if (!ts) return '';
    const d = typeof ts.toDate === 'function' ? ts.toDate() : new Date(ts);
    if (isNaN(d)) return '';
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function project(input) {
    const reqs = input.reqs || [], bills = input.bills || [];
    const paidCents = toCents(paid(reqs));
    const costCents = toCents(directCost(bills));
    const outstandingCents = toCents(outstanding(reqs));
    const remainingCents = paidCents - costCents;
    const reserve = reserveFor(input.status, remainingCents, input.reserveRow, paidCents, costCents);
    const balanceCents = remainingCents - reserve.cents;
    const partnerPct = input.partnerPct == null ? DEFAULT_PARTNER_PCT : Number(input.partnerPct);
    const s = split(balanceCents, partnerPct);
    const flags = [];
    if (reserve.needsReview) flags.push('reserve_review');
    if (outstandingCents > 0) flags.push('unpaid_balance');
    if (balanceCents < 0) flags.push('shortfall');
    if (reserve.changedSinceCloseout) flags.push('changed_since_closeout');
    return {
      id: input.id, name: input.name || '', clientName: input.clientName || '',
      partnerEmail: String(input.partnerEmail || '').trim().toLowerCase(),
      status: input.status || '', completionKey: dateKey(input.terminatedAt),
      paidCents, costCents, outstandingCents, remainingCents, reserve, balanceCents,
      partnerPct, ownerPct: round2(100 - partnerPct),
      partnerCents: s.partnerCents, ownerCents: s.ownerCents,
      flags, confirmed: !reserve.needsReview,
    };
  }

  function combine(results) {
    const confirmed = (results || []).filter(r => r.confirmed);
    const review = (results || []).filter(r => !r.confirmed);
    const t = { count: confirmed.length, reviewCount: review.length,
                estimateCount: confirmed.filter(r => r.reserve.kind === 'estimate').length,
                paidCents: 0, costCents: 0, reserveCents: 0, availableCents: 0, shortfallCents: 0,
                netCents: 0, ownerCents: 0, partnerCents: 0, ownerShortfallCents: 0,
                partnerShortfallCents: 0, outstandingCents: 0 };
    confirmed.forEach(r => {
      t.paidCents += r.paidCents; t.costCents += r.costCents; t.reserveCents += r.reserve.cents;
      t.outstandingCents += r.outstandingCents; t.netCents += r.balanceCents;
      t.ownerCents += r.ownerCents; t.partnerCents += r.partnerCents;
      if (r.balanceCents >= 0) t.availableCents += r.balanceCents;
      else { t.shortfallCents += r.balanceCents; t.ownerShortfallCents += r.ownerCents; t.partnerShortfallCents += r.partnerCents; }
    });
    return { totals: t, confirmed, review };
  }

  function fmtPct(n) { return String(round2(n)); }
  function pesos(cents) {
    const c = Math.round(Number(cents) || 0);
    const s = (Math.abs(c) / 100).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return (c < 0 ? '−' : '') + '₱' + s;
  }

  // @@DATA_API@@

  const api = { WARRANTY_PCT, DEFAULT_PARTNER_PCT, toCents, roundDiv, paid, outstanding, directCost,
                split, reserveFor, project, combine, dateKey, fmtPct, pesos };
  // @@DATA_EXPORTS@@
  root.PMShare = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
```

- [ ] **Step 4: Add the suite to `npm test`** — in `package.json` append to the `test` script: ` && node tests/pm-sharing.test.js`.

- [ ] **Step 5: Run to verify it passes**

Run: `node tests/pm-sharing.test.js`
Expected: `13 passed, 0 failed`. Then `node --check js/pm-sharing.js`.

- [ ] **Step 6: Checkpoint** — diff summary; the user commits.

---

### Task 6: Data API (`PMShare.load/save/parsePct/errorText/acceptanceFacts`) and `WF.reserveFor`

**Files:**
- Modify: `js/pm-sharing.js` (replace `// @@DATA_API@@` and `// @@DATA_EXPORTS@@`)
- Modify: `js/warranty-fund.js` (after the `window.WF_CONST = WF_CONST;` line, ~59)
- Modify: `tests/pm-sharing.test.js` (section B above `// @@SECTIONS@@`)

**Interfaces:**
- Produces on `PMShare`:
  - `load(projectIds|null) → Promise<{can_edit, projects, history, partners}>`
  - `save(projectId, partnerPct, expectedVersion, reason) → Promise<{changed, version, partner_pct}>`
  - `parsePct(str) → {ok:true, value:number} | {ok:false, error:string}`
  - `errorText(message) → string`
  - `acceptanceFacts(partnerEmail, partners, lastChangeAt) → string[]`
- Produces `window.WF.reserveFor(projectIds) → Promise<{[projectId]: {contributedAmount, status, deleted, refNo, totalPaid, directCost, completedAt}}>`

- [ ] **Step 1: Write the failing tests** — insert above `// @@SECTIONS@@`:

```js
// ══ B. Data API + WF.reserveFor ══════════════════════════════════════
function fakeSb(handler) {
  const calls = [];
  return { calls, rpc: async (name, args) => { calls.push([name, args]); return handler(name, args); } };
}
test('B1 load/save call the right functions with the right arguments', async () => {
  const sb = fakeSb((n) => ({ data: n === 'pm_sharing_read' ? { can_edit: true, projects: [] } : { changed: true }, error: null }));
  globalThis.sbClient = sb;
  await P.load(['A']); await P.load(null);
  await P.save('A', 40, 0, ' Agreed ');
  eq(sb.calls, [['pm_sharing_read', { p_projects: ['A'] }], ['pm_sharing_read', { p_projects: null }],
                ['pm_set_sharing', { p_project: 'A', p_partner_pct: 40, p_expected_version: 0, p_reason: 'Agreed' }]]);
});
test('B2 a server error rejects (never resolves to empty data)', async () => {
  globalThis.sbClient = fakeSb(() => ({ data: null, error: { message: 'OWNER_ONLY' } }));
  let msg = '';
  try { await P.load(null); } catch (e) { msg = e.message; }
  eq(msg, 'OWNER_ONLY');
  eq(P.errorText('STALE'), 'This split was changed by someone else — reload.');
  eq(P.errorText('whatever'), 'whatever');
});
test('B3 parsePct: 0–100, at most 2 decimals, no blanks or junk', () => {
  eq(P.parsePct(' 40 '), { ok: true, value: 40 });
  eq(P.parsePct('33.33'), { ok: true, value: 33.33 });
  eq(P.parsePct('0'), { ok: true, value: 0 });
  eq(P.parsePct('100'), { ok: true, value: 100 });
  for (const bad of ['', ' ', 'abc', '40.123', '-1', '100.01', '1e2', 'NaN', 'Infinity', '40,5']) {
    eq(P.parsePct(bad).ok, false, JSON.stringify(bad));
  }
});
test('B4 acceptance facts state only what is recorded', () => {
  const partners = [{ email: 'p@x.test', accepted: true, accepted_at: '2026-08-12T02:00:00Z', doc_version: 3 }];
  const lines = P.acceptanceFacts('p@x.test', partners, '2026-09-01T00:00:00Z');
  ok(/^Partnership Agreement v3 accepted .+\. This acceptance record does not capture a project sharing percentage\.$/.test(lines[0]), lines[0]);
  eq(lines[1], 'Split changed after last signed agreement.');
  eq(P.acceptanceFacts('p@x.test', partners, '2026-08-01T00:00:00Z').length, 1, 'change before acceptance → no flag');
  eq(P.acceptanceFacts('q@x.test', partners, null), ['No Partnership Agreement acceptance on record.']);
  eq(P.acceptanceFacts('', partners, null), ['Partner unassigned.']);
});
test('B5 WF.reserveFor calls wf_reserves_for and rounds noisy amounts', async () => {
  const src = read('js/warranty-fund.js');
  const start = src.indexOf('window.WF.reserveFor = async function');
  ok(start !== -1, 'SLICE NOT FOUND: WF.reserveFor');
  const end = src.indexOf('\n    };\n', start) + '\n    };\n'.length;
  const sb = fakeSb(() => ({ data: [{ project_id: 'A', ref_no: 'WR-1', status: 'active', deleted: false,
    contributed_amount: '5724.900000000001', total_paid: '400000', direct_cost: '285502', completed_at: null }], error: null }));
  const win = { sbClient: sb, WF: {} };
  new Function('window', src.slice(start, end))(win);
  const r = await win.WF.reserveFor(['A', '', null]);
  eq(sb.calls, [['wf_reserves_for', { p_projects: ['A'] }]]);
  eq(r.A, { contributedAmount: 5724.9, status: 'active', deleted: false, refNo: 'WR-1', totalPaid: 400000, directCost: 285502, completedAt: null });
  eq(await win.WF.reserveFor([]), {}, 'no ids → no call');
  eq(sb.calls.length, 1);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node tests/pm-sharing.test.js`
Expected: B1–B5 FAIL (`P.load is not a function`, `SLICE NOT FOUND: WF.reserveFor`).

- [ ] **Step 3: Implement the data API** — replace `// @@DATA_API@@` in `js/pm-sharing.js` with:

```js
  // ── server calls (owner-role accounts; the server re-checks everything) ──
  async function rpc(name, args) {
    const sb = root.sbClient;
    if (!sb || typeof sb.rpc !== 'function') throw new Error('Not connected');
    const { data, error } = await sb.rpc(name, args);
    if (error) throw new Error(error.message || String(error));
    return data;
  }
  function load(projectIds) {
    return rpc('pm_sharing_read', { p_projects: projectIds == null ? null : projectIds });
  }
  function save(projectId, partnerPct, expectedVersion, reason) {
    return rpc('pm_set_sharing', { p_project: projectId, p_partner_pct: partnerPct,
                                   p_expected_version: expectedVersion, p_reason: String(reason || '').trim() });
  }
  // The form sends the value AS TYPED — never pre-rounded, so the server
  // can refuse 40.123 instead of storing 40.12.
  function parsePct(str) {
    const s = String(str == null ? '' : str).trim();
    if (!/^\d{1,3}(\.\d{1,2})?$/.test(s)) {
      return { ok: false, error: /^\d{1,3}\.\d{3,}$/.test(s) ? 'Use at most 2 decimal places.' : 'Enter a number from 0 to 100.' };
    }
    const v = Number(s);
    if (v < 0 || v > 100) return { ok: false, error: 'Enter a number from 0 to 100.' };
    return { ok: true, value: v };
  }
  const ERRORS = {
    STALE: 'This split was changed by someone else — reload.',
    OWNER_ONLY: 'Only the main owner can change the split.',
    REASON_REQUIRED: 'Give a reason for changing the split.',
    BAD_PCT: 'Enter a number from 0 to 100 with at most 2 decimal places.',
    PROJECT_UNMAPPED: 'Project not linked to a company — sharing locked.',
    WRONG_COMPANY: 'This project belongs to another company.',
    INACTIVE: 'This account is not active.',
    PROFILE_MISSING: 'This account has no profile.',
    BAD_COMPANY_LINK: 'This account is not linked to a valid company.',
  };
  function errorText(message) {
    const m = String(message || '');
    const key = Object.keys(ERRORS).find(k => m.indexOf(k) !== -1);
    return key ? ERRORS[key] : m;
  }
  // Facts from the partner's own acceptance record — never "accepted the split".
  function acceptanceFacts(partnerEmail, partners, lastChangeAt) {
    const email = String(partnerEmail || '').trim().toLowerCase();
    if (!email) return ['Partner unassigned.'];
    const p = (partners || []).find(x => String(x.email || '').toLowerCase() === email);
    if (!p || !p.accepted || !p.accepted_at) return ['No Partnership Agreement acceptance on record.'];
    const when = new Date(p.accepted_at).toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' });
    const lines = ['Partnership Agreement' + (p.doc_version ? ' v' + p.doc_version : '') + ' accepted ' + when
                   + '. This acceptance record does not capture a project sharing percentage.'];
    if (lastChangeAt && new Date(lastChangeAt) > new Date(p.accepted_at)) lines.push('Split changed after last signed agreement.');
    return lines;
  }
```

and replace `// @@DATA_EXPORTS@@` with:

```js
  Object.assign(api, { load, save, parsePct, errorText, acceptanceFacts });
```

- [ ] **Step 4: Implement `WF.reserveFor`** — in `js/warranty-fund.js`, directly after the line `    window.WF_CONST = WF_CONST;` insert:

```js

    // Read-only reserve lookup for PM profit sharing (spec 2026-10-18 §4.5).
    // The ONLY way another module learns a project's recorded reserve: a
    // company-checked server read (wf_reserves_for, 0098) — never a table
    // query, so this file stays the sole owner of the warranty tables.
    // Amounts are rounded to centavos on read; storage is left untouched.
    window.WF = window.WF || {};
    window.WF.reserveFor = async function (projectIds) {
        const ids = (projectIds || []).filter(Boolean);
        if (!ids.length) return {};
        const { data, error } = await window.sbClient.rpc('wf_reserves_for', { p_projects: ids });
        if (error) throw new Error(error.message || 'Reserve read failed');
        const cents = (v) => Math.round((Number(v) || 0) * 100 + 1e-6) / 100;
        const out = {};
        (data || []).forEach(r => {
            out[r.project_id] = {
                contributedAmount: cents(r.contributed_amount),
                status: r.status, deleted: !!r.deleted, refNo: r.ref_no,
                totalPaid: Number(r.total_paid) || 0, directCost: Number(r.direct_cost) || 0,
                completedAt: r.completed_at || null,
            };
        });
        return out;
    };
```

- [ ] **Step 5: Run to verify they pass**

Run: `node tests/pm-sharing.test.js && node --check js/pm-sharing.js && node --check js/warranty-fund.js`
Expected: `18 passed, 0 failed`; both syntax checks silent.

- [ ] **Step 6: Checkpoint** — diff summary; the user commits.

---

### Task 7: Overview — first render, range refresh, print

**Files:**
- Create: `tests/helpers/pm-admin-sandbox.js`
- Modify: `js/pm-admin.js`: top-level state (~25), `_pmOvOutstanding`/`_pmOvPaid` (~195–204), new share helpers after `_pmOvPaid`, `_pmLoadOverview` (~159–178), `_pmOvHtml` (~232–240 cost ladder, ~519–524, ~585–586), `pmOvApplyRange` (~893–900 ladder, ~955–968), `pmOvPrintReport` (~1056–1075, ~1170–1171)
- Modify: `admin.html` (script tag before `js/pm-admin.js`, ~5427)
- Modify: `tests/pm-sharing.test.js` (section C)

**Interfaces:**
- Consumes: `PMShare.*` (Tasks 5–6), `WF.reserveFor` (Task 6).
- Produces in `pm-admin.js` (global functions): `_pmCanSeeShare() → boolean`; `_pmLoadShareFor(projectId) → Promise<{partnerPct, isDefault, version, canEdit, reserveRow, history} | {error}>`; `_pmShareModel(p, bills, reqs, share) → Result | null`; `_pmShareTexts(model, share) → {unavailable, reserveValue, reserveSub, balanceLabel, balanceValue, balanceColor, splitLine, caption, floorNote}`; global `let _pmOvShare`.
- Produces `tests/helpers/pm-admin-sandbox.js` → `loadPmAdmin({role}) → {ctx, els, printed, toasts, run}`.

- [ ] **Step 1: Write the sandbox helper** — `tests/helpers/pm-admin-sandbox.js`:

```js
// Runs the REAL js/pm-sharing.js + js/pm-admin.js in a Node vm context with
// a stub DOM, so tests can call the live screen functions and read what
// they render. Unknown DOM ids get a recording stub element.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.join(__dirname, '..', '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

function makeEl(id) {
  return { id, textContent: '', innerHTML: '', value: '', disabled: false, checked: false, style: {}, dataset: {},
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    querySelector() { return null; }, querySelectorAll() { return []; }, addEventListener() {},
    appendChild() {}, removeChild() {}, remove() { this.removed = true; }, setAttribute() {}, closest() { return null; },
    focus() {}, click() {} };
}

function loadPmAdmin(opts = {}) {
  const els = new Map();
  const printed = [];
  const toasts = [];
  const el = (id) => { if (!els.has(id)) els.set(id, makeEl(id)); return els.get(id); };
  const document = {
    getElementById: el,
    querySelector: (sel) => el('qs:' + sel),
    querySelectorAll: () => [],
    addEventListener() {}, removeEventListener() {},
    createElement: (t) => makeEl('new:' + t),
    body: makeEl('body'),
  };
  const ctx = { console, document, setTimeout, clearTimeout, Intl, Date, Math, JSON, Promise, Number, String,
                Array, Object, isNaN, parseFloat, parseInt, encodeURIComponent, Blob: function () {},
                URL: { createObjectURL: () => 'blob:', revokeObjectURL() {} },
                navigator: { userAgent: 'node' }, location: { origin: 'http://test' },
                alert() {}, confirm() { return true; } };
  ctx.window = ctx; ctx.self = ctx; ctx.globalThis = ctx;
  ctx.open = () => ({ document: { write(h) { printed.push(h); }, close() {} }, focus() {}, print() {} });
  ctx.firebase = { firestore: { FieldValue: { serverTimestamp: () => 'TS' } } };
  ctx.currentUserRole = opts.role || 'owner';
  vm.createContext(ctx);
  const exp = read('js/expenses-module.js');
  const fStart = exp.indexOf('function formatNum(n) {');
  const fEnd = exp.indexOf('function formatDate(d) {', fStart);
  if (fStart === -1 || fEnd === -1) throw new Error('SLICE NOT FOUND: formatNum in expenses-module.js');
  vm.runInContext(exp.slice(fStart, fEnd)
    + '\nfunction setText(id, v) { const e = document.getElementById(id); if (e) e.textContent = v; }\n', ctx);
  vm.runInContext(read('js/pm-sharing.js'), ctx, { filename: 'pm-sharing.js' });
  vm.runInContext(read('js/pm-admin.js'), ctx, { filename: 'pm-admin.js' });
  ctx._pmToast = (msg, isErr) => { toasts.push([msg, !!isErr]); };
  const run = (code) => vm.runInContext(code, ctx);
  return { ctx, els, printed, toasts, run };
}
module.exports = { loadPmAdmin, makeEl };
```

If `vm.runInContext(read('js/pm-admin.js'))` throws `ReferenceError: X is not defined` at load time, add `X` to `ctx` above as a no-op stub (`X: function () {}` or `X: {}`) and re-run. Load-time references only; do not stub anything the four money sites call.

- [ ] **Step 2: Write the failing tests** — insert above `// @@SECTIONS@@`:

```js
// ══ C. Overview: first render, range refresh, print (real pm-admin.js) ══
const { loadPmAdmin } = require('./helpers/pm-admin-sandbox.js');
const shareOf = (pct, row) => ({ partnerPct: pct, isDefault: false, version: 1, canEdit: true, reserveRow: row, history: [] });
function overview(role, project, bills, reqs, share) {
  const sb = loadPmAdmin({ role });
  sb.run(`_pmActiveProject = ${JSON.stringify(project)}; _pmOvBills = ${JSON.stringify(bills)};
          _pmOvReqs = ${JSON.stringify(reqs)}; _pmOvShare = ${JSON.stringify(share)};`);
  return { sb, html: sb.ctx._pmOvHtml(project, [], bills, reqs) };
}
test('C1 Overview shows the recorded reserve and the 60/40 split for project A', () => {
  const { html } = overview('owner', projA, [], [verified(800000)], shareOf(40, rec(40000, 800000, 0)));
  for (const s of ['Warranty reserve', '₱40,000.00', 'Recorded at closeout', 'Sharing balance', '₱760,000.00',
                   'You ₱456,000.00 (60%)', 'Partner ₱304,000.00 (40%)', 'Internal allocation — not a payout.']) {
    ok(html.includes(s), 'missing: ' + s);
  }
  ok(!html.includes('Profit share') && !html.includes('50% after retention'), 'old 50/50 card gone');
});
test('C2 a loss shows ₱0 estimate reserve and a −₱50,000 each Shortfall', () => {
  const p = { ...projA, status: 'active' };
  const { html } = overview('owner', p, [bill(100000)], [], shareOf(50, null));
  for (const s of ['Estimate · 5% of remaining cash', 'Shortfall', '−₱100,000.00', 'You −₱50,000.00 (50%)',
                   'Partner −₱50,000.00 (50%)', 'Retention is floored at ₱0']) ok(html.includes(s), 'missing: ' + s);
});
test('C3 a failed sharing read shows Unavailable, never ₱0', () => {
  const { html } = overview('owner', projA, [], [verified(800000)], { error: 'boom' });
  ok(html.includes('Unavailable'), 'Unavailable');
  ok(!html.includes('Internal allocation'), 'no split text on failure');
});
test('C4 staff get neither card', () => {
  const { html } = overview('staff', projA, [], [verified(800000)], shareOf(40, rec(40000, 800000, 0)));
  for (const s of ['pm-ov-kpi-retention', 'pm-ov-kpi-sharing', 'Warranty reserve', 'Sharing balance', '₱304,000.00']) {
    ok(!html.includes(s), 'staff saw: ' + s);
  }
});
test('C5 range refresh never touches the lifetime reserve / sharing cards (D5)', () => {
  const { sb } = overview('owner', projA, [{ ...bill(1000), weekEndingDate: '2026-07-31' }], [verified(800000)], shareOf(40, rec(40000, 800000, 0)));
  sb.ctx.document.getElementById('pm-ov-kpi-retention').textContent = 'SENTINEL-R';
  sb.ctx.document.getElementById('pm-ov-kpi-sharing').textContent = 'SENTINEL-S';
  sb.ctx.document.getElementById('pm-ov-range').value = 'latest';
  sb.ctx.pmOvApplyRange();
  eq(sb.ctx.document.getElementById('pm-ov-kpi-retention').textContent, 'SENTINEL-R');
  eq(sb.ctx.document.getElementById('pm-ov-kpi-sharing').textContent, 'SENTINEL-S');
});
test('C6 Overview print carries the same figures and labels', () => {
  const { sb } = overview('owner', projA, [], [verified(800000)], shareOf(40, rec(40000, 800000, 0)));
  sb.ctx.pmOvPrintReport();
  const h = sb.printed.join('');
  for (const s of ['Warranty Reserve', '₱40,000.00', 'You ₱456,000.00 (60%)', 'Partner ₱304,000.00 (40%)',
                   'Internal allocation — not a payout.']) ok(h.includes(s), 'print missing: ' + s);
  ok(!h.includes('50% of'), 'old 50/50 subtitle gone');
});
test('C7 Overview paid/cost delegate to the shared rules', () => {
  const sb = loadPmAdmin({ role: 'owner' });
  eq(sb.ctx._pmOvPaid([verified(5), { status: 'partial', amountPaid: 2 }]), 7);
  eq(sb.ctx._pmOvOutstanding([{ status: 'unpaid', totalAmount: 9 }]), 9);
});
```

- [ ] **Step 3: Run to verify they fail**

Run: `node tests/pm-sharing.test.js`
Expected: C1–C6 FAIL (e.g. `missing: Warranty reserve`, or `_pmOvShare is not defined`). C7 may already pass.

- [ ] **Step 4: Load `pm-sharing.js` before `pm-admin.js`** — in `admin.html`, directly above `<script src="js/pm-admin.js?v=20260915a"></script>` add:

```html
<script src="js/pm-sharing.js?v=20261018a"></script>
```

and bump the pm-admin tag to `js/pm-admin.js?v=20261018a`.

- [ ] **Step 5: State** — in `js/pm-admin.js`, after line 27 (`let _pmOvContractVal  = 0; …`) add:

```js
let _pmOvShare        = null;     // sharing split + recorded reserve for the active project (owner-role only)
```

- [ ] **Step 6: Delegate paid/outstanding and add the share helpers** — replace the bodies of `_pmOvOutstanding` and `_pmOvPaid` (~195–204) with:

```js
function _pmOvOutstanding(reqs) {
    return window.PMShare.outstanding(reqs);
}
function _pmOvPaid(reqs) {
    return window.PMShare.paid(reqs);
}

// ── Profit sharing (spec 2026-10-18) ─────────────────────────────────
// Owner-role accounts only. Staff never receive these figures: the cards
// are not rendered for them at all (CLAUDE.md staff rule; spec §6.2).
function _pmCanSeeShare() { return window.currentUserRole === 'owner'; }

// The split + recorded reserve for ONE project. Never throws: a failed read
// comes back as { error } so the cards say "Unavailable", never ₱0.
async function _pmLoadShareFor(projectId) {
    try {
        const [read, reserves] = await Promise.all([
            window.PMShare.load([projectId]),
            window.WF.reserveFor([projectId]),
        ]);
        const row = (read.projects || []).find(x => x.project_id === projectId);
        if (!row) return { error: 'PROJECT_UNMAPPED' };
        return { partnerPct: Number(row.partner_pct), isDefault: !!row.is_default, version: row.version,
                 canEdit: !!read.can_edit, reserveRow: reserves[projectId] || null,
                 history: (read.history || []).filter(h => h.project_id === projectId) };
    } catch (e) {
        console.warn('PM: sharing read failed', e.message);
        return { error: e.message || 'failed' };
    }
}

// Lifetime sharing figures for one project, from the shared calculation.
function _pmShareModel(p, bills, reqs, share) {
    if (!share || share.error) return null;
    return window.PMShare.project({
        id: p.id, name: p.projectName, clientName: p.clientName, partnerEmail: p.partnerEmail,
        status: p.status, terminatedAt: p.terminatedAt, bills, reqs,
        reserveRow: share.reserveRow, partnerPct: share.partnerPct,
    });
}

// Display text for the reserve + sharing cards (screen and print share it).
function _pmShareTexts(m, share) {
    if (!m) {
        const why = share && share.error ? window.PMShare.errorText(share.error) : 'Could not load sharing data';
        return { unavailable: true, reserveValue: 'Unavailable', reserveSub: why, balanceLabel: 'Sharing balance',
                 balanceValue: 'Unavailable', balanceColor: '#8f352c', splitLine: why, caption: '', floorNote: '' };
    }
    const P = window.PMShare;
    const kind = m.reserve.kind;
    const reserveSub = (kind === 'recorded' ? 'Recorded at closeout'
                     : kind === 'provisional' ? 'Provisional · Reserve needs review'
                     : 'Estimate · 5% of remaining cash')
                     + (m.reserve.changedSinceCloseout ? ' · Collections/costs changed since closeout' : '');
    const shortfall = m.balanceCents < 0;
    return {
        unavailable: false,
        reserveValue: P.pesos(m.reserve.cents),
        reserveSub,
        balanceLabel: shortfall ? 'Shortfall' : 'Sharing balance',
        balanceValue: P.pesos(m.balanceCents),
        balanceColor: shortfall ? '#8f352c' : '#0f6342',
        splitLine: 'You ' + P.pesos(m.ownerCents) + ' (' + P.fmtPct(m.ownerPct) + '%) · Partner '
                 + P.pesos(m.partnerCents) + ' (' + P.fmtPct(m.partnerPct) + '%)',
        caption: 'Internal allocation — not a payout.',
        floorNote: m.reserve.floored ? 'Retention is floored at ₱0 when costs exceed collections.' : '',
    };
}
```

- [ ] **Step 7: Load the share with the Overview** — in `_pmLoadOverview` replace the `Promise.all([...])` destructure and add the assignment:

```js
        const [msSnap, billsSnap, paySnap, share] = await Promise.all([
            base.collection('milestones').get(),
            base.collection('weeklyBills').get(),
            db.collection('paymentRequests').where('constructionProjectId', '==', pid).get(),
            _pmCanSeeShare() ? _pmLoadShareFor(pid) : Promise.resolve(null),
        ]);
```

and directly after `_pmOvReqs  = reqs;` add `        _pmOvShare = share;`.

- [ ] **Step 8: Overview first render** — in `_pmOvHtml`:
  (a) Replace the `const directCost = bills.reduce((s, b) => { … }, 0);` block (~234–240) with `    const directCost = window.PMShare.directCost(bills);`. Keep the comment above it.
  (b) Replace lines ~519–524 (the "Warranty retention = a FIXED 5%…" comment through `const psColor …`) with:

```js
    // Warranty reserve + sharing balance — lifetime figures from the shared
    // calculation (js/pm-sharing.js). Owner-role only: staff get neither card.
    const showShare = _pmCanSeeShare();
    const shareTx = showShare ? _pmShareTexts(_pmShareModel(p, bills, reqs, _pmOvShare), _pmOvShare) : null;
```

  (c) Replace the two card lines (~585–586) with:

```js
        ${showShare ? card(_ico.shield, 'Warranty reserve', shareTx.unavailable ? '#8f352c' : '#9a6c12', shareTx.reserveValue, 'pm-ov-kpi-retention', subFooter(shareTx.reserveSub), '#fbf2dc', '#ecd8a6') : ''}
        ${showShare ? card(_ico.trend, shareTx.balanceLabel, shareTx.balanceColor, shareTx.balanceValue, 'pm-ov-kpi-sharing', subFooter([shareTx.splitLine, shareTx.caption, shareTx.floorNote].filter(Boolean).join('<br>')), '#eaf4ef', '#c6e6d5') : ''}
```

- [ ] **Step 9: Range refresh** — in `pmOvApplyRange`:
  (a) Replace its `const directCost = bills.reduce(…)` block with `    const directCost = window.PMShare.directCost(bills);`.
  (b) Replace the block from `// Warranty retention (5% of netCash) and Profit share (half of what's left).` through the closing `}` of the `if (psEl) {…}` (~955–968) with:

```js
    // Warranty reserve + sharing balance are LIFETIME figures (all bills, all
    // payments) and are deliberately not range-filtered (plan D5): a split of
    // all-time paid minus in-range cost would mean nothing.
```

- [ ] **Step 10: Overview print** — in `pmOvPrintReport`:
  (a) Replace its `const directCost = bills.reduce(…)` block with `    const directCost = window.PMShare.directCost(bills);`.
  (b) Replace from `const warrantyRetention = netCash * 0.05;` through `const profitShare = distributable / 2;` (~1068–1075, with the comment between) with:

```js
    // Same lifetime sharing figures as the on-screen cards (owner-role only).
    const showShare = _pmCanSeeShare();
    const shareTx = showShare ? _pmShareTexts(_pmShareModel(p, bills, reqs, _pmOvShare), _pmOvShare) : null;
```

  (c) Replace the two `kpi(...)` lines (~1170–1171) with:

```js
    ${showShare ? kpi('Warranty Reserve', shareTx.reserveValue, '#fbf2dc', '#ecd8a6', '#9a6c12', shareTx.reserveSub, true) : ''}
    ${showShare ? kpi(shareTx.balanceLabel, shareTx.balanceValue, '#eaf4ef', '#c6e6d5', shareTx.balanceColor, [shareTx.splitLine, shareTx.caption].filter(Boolean).join(' · '), true) : ''}
```

- [ ] **Step 11: Run all tests**

Run: `node tests/pm-sharing.test.js && node --check js/pm-admin.js && npm test`
Expected: section C passes (`25 passed`), `npm test` all green (money-math unaffected). `grep -n "0\.05\|/ 2;" js/pm-admin.js` shows no remaining retention or profit-share lines at the three Overview sites.

- [ ] **Step 12: Checkpoint** — diff summary; the user commits.

---

### Task 8: Reports — per-project calculation, on-screen and print

**Files:**
- Modify: `js/pm-admin.js`: `_pmRptState` (~8727), `loadPMRptData` (~8872–8898), `_pmRptRenderKPIs` Cash Receipt block (~9127–9170), `_pmRptCashReceipt` (~9180–9195), `printPMReportsDashboard` Cash Receipt KPIs (~9525–9533)
- Modify: `tests/pm-sharing.test.js` (section D)

**Interfaces:**
- Consumes: `_pmCanSeeShare`, `PMShare.project/combine/pesos/fmtPct/errorText`, `WF.reserveFor`.
- Produces: `_pmRptCashReceipt() → {paid, outstanding, directCost, netCash, share: {results, totals, review, unmapped} | null, shareError: string | null}`; `_pmRptShareCards() → {reserveValue, reserveSub, balanceLabel, balanceValue, splitLine, notes} | {error}`.

- [ ] **Step 1: Write the failing tests** — insert above `// @@SECTIONS@@`:

```js
// ══ D. Reports (real pm-admin.js) ════════════════════════════════════
function reports(role, share, fetchError = false) {
  const sb = loadPmAdmin({ role });
  const bills = [];
  const reqs = [{ ...verified(800000), projectId: 'A' }, { ...verified(500000), projectId: 'B' }];
  sb.run(`_pmRptState.projects = ${JSON.stringify([projA, projB])}; _pmRptState.bills = ${JSON.stringify(bills)};
          _pmRptState.payReqs = ${JSON.stringify(reqs)}; _pmRptState.share = ${JSON.stringify(share)};
          _pmRptState.fetchError = ${fetchError};`);
  return sb;
}
const rptShare = { read: { can_edit: true, history: [], partners: [],
                           projects: [{ project_id: 'A', partner_pct: 40, is_default: false, version: 1 },
                                      { project_id: 'B', partner_pct: 50, is_default: true, version: 0 }] },
                   reserves: { A: rec(40000, 800000, 0), B: rec(25000, 500000, 0) }, error: null };
test('D1 Reports computes each project separately, then combines', () => {
  const cr = reports('owner', rptShare).ctx._pmRptCashReceipt();
  eq([cr.share.totals.ownerCents, cr.share.totals.partnerCents, cr.share.totals.reserveCents], [69350000, 54150000, 6500000]);
  eq(cr.netCash, 1300000);
});
test('D2 Reports KPI row shows the combined split and labels', () => {
  const sb = reports('owner', rptShare);
  sb.ctx._pmRptRenderKPIs([]);
  const h = sb.ctx.document.getElementById('pmRptKpiRow').innerHTML;
  for (const s of ['Warranty Reserve', '₱65,000.00', 'Sharing Balance', '₱1,235,000.00', 'You ₱693,500.00',
                   'Partner ₱541,500.00', 'Internal allocation — not a payout.']) ok(h.includes(s), 'missing: ' + s);
  ok(!h.includes('50% of Remaining'), 'old 50/50 card gone');
});
test('D3 a reserve-needs-review project stays out of totals and is counted in a note', () => {
  const s = JSON.parse(JSON.stringify(rptShare)); delete s.reserves.B;
  const sb = reports('owner', s);
  const cr = sb.ctx._pmRptCashReceipt();
  eq([cr.share.totals.count, cr.share.totals.reviewCount, cr.share.totals.ownerCents], [1, 1, 45600000]);
  sb.ctx._pmRptRenderKPIs([]);
  ok(sb.ctx.document.getElementById('pmRptKpiRow').innerHTML.includes('1 project needs reserve review (not in totals)'), 'note');
});
test('D4 a failed load shows an error, never ₱0 sharing figures', () => {
  for (const sb of [reports('owner', { error: 'boom' }), reports('owner', rptShare, true)]) {
    sb.ctx._pmRptRenderKPIs([]);
    const h = sb.ctx.document.getElementById('pmRptKpiRow').innerHTML;
    ok(h.includes('Sharing unavailable'), 'error card');
    ok(!h.includes('Sharing Balance'), 'no balance card');
  }
});
test('D5 Reports print carries the combined split', () => {
  const sb = reports('owner', rptShare);
  sb.run(`_pmRptState.period = 'annual'; _pmRptState.year = 2026;`);
  sb.ctx.printPMReportsDashboard();
  const h = sb.printed.join('');
  for (const s of ['Warranty Reserve', 'You ₱693,500.00', 'Partner ₱541,500.00', 'Internal allocation — not a payout.']) {
    ok(h.includes(s), 'print missing: ' + s);
  }
});
test('D6 staff: Reports KPI row hidden and print refused (unchanged behaviour)', () => {
  const sb = reports('staff', rptShare);
  sb.ctx._pmRptRenderKPIs([]);
  eq(sb.ctx.document.getElementById('pmRptKpiRow').style.display, 'none');
  sb.ctx.printPMReportsDashboard();
  eq(sb.printed.length, 0);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node tests/pm-sharing.test.js`
Expected: D1–D5 FAIL (`cr.share` undefined / missing strings). D6 passes already.

- [ ] **Step 3: State** — add two fields to `_pmRptState` (after `payReqs: [],`):

```js
    share: null,       // { read, reserves, error } — owner-role only; never derived from a failed fetch
    fetchError: false, // bills/payments fetch failed — sharing figures must not render
```

- [ ] **Step 4: Load** — in `loadPMRptData`, inside the `try` after `_pmRptState.payReqs = results.flatMap(r => r.payReqs);` add:

```js
        _pmRptState.fetchError = false;
```

in its `catch` add `_pmRptState.fetchError = true;`, and before the final `_pmRptState.loading = false;` add:

```js
    // Sharing split + recorded reserves for the projects in scope (owner-role
    // only). Kept separate from the cost fetch so a failure here shows as an
    // error card instead of ₱0 figures (plan D7).
    _pmRptState.share = null;
    if (_pmCanSeeShare() && scopeProjects.length) {
        const ids = scopeProjects.map(p => p.id);
        try {
            const [read, reserves] = await Promise.all([window.PMShare.load(ids), window.WF.reserveFor(ids)]);
            _pmRptState.share = { read, reserves, error: null };
        } catch (e) {
            _pmRptState.share = { error: e.message || 'failed' };
        }
    }
```

- [ ] **Step 5: Calculation** — replace the whole of `_pmRptCashReceipt` (from its comment block through its closing `}`) with:

```js
// Cash-receipt figures for the current Reports scope (one project or "All
// Projects"), always all-time. Paid / cost use the shared PM rules. The
// sharing split is computed PER PROJECT first (its own %, its own reserve)
// and only then combined — never 5% / 50% of a pooled balance.
function _pmRptCashReceipt() {
    const P = window.PMShare;
    const reqs = _pmRptState.payReqs || [];
    const bills = _pmRptState.bills || [];
    const paid = P.paid(reqs);
    const outstanding = P.outstanding(reqs);
    const directCost = P.directCost(bills);
    const out = { paid, outstanding, directCost, netCash: paid - directCost, share: null, shareError: null };
    if (!_pmCanSeeShare()) return out;
    const sh = _pmRptState.share;
    if (_pmRptState.fetchError) { out.shareError = 'Report data failed to load'; return out; }
    if (!sh || sh.error) { out.shareError = sh && sh.error ? P.errorText(sh.error) : 'Sharing data not loaded'; return out; }
    const rows = {};
    (sh.read.projects || []).forEach(r => { rows[r.project_id] = r; });
    const scope = _pmRptState.projects || [];
    const results = scope.filter(p => rows[p.id]).map(p => P.project({
        id: p.id, name: p.projectName, clientName: p.clientName, partnerEmail: p.partnerEmail,
        status: p.status, terminatedAt: p.terminatedAt,
        bills: bills.filter(b => b.projectId === p.id), reqs: reqs.filter(r => r.projectId === p.id),
        reserveRow: (sh.reserves || {})[p.id] || null, partnerPct: Number(rows[p.id].partner_pct),
    }));
    const c = P.combine(results);
    out.share = { results, totals: c.totals, review: c.review, unmapped: scope.length - results.length };
    return out;
}

// Card text for the Reports sharing section (screen + print share it).
function _pmRptShareCards(cr) {
    if (cr.shareError || !cr.share) return { error: cr.shareError || 'Sharing data not loaded' };
    const P = window.PMShare, t = cr.share.totals;
    const notes = [];
    if (t.estimateCount) notes.push('Includes estimates for ' + t.estimateCount + ' project' + (t.estimateCount > 1 ? 's' : '') + ' not yet completed');
    if (t.reviewCount) notes.push(t.reviewCount + ' project' + (t.reviewCount > 1 ? 's need' : ' needs') + ' reserve review (not in totals)');
    if (cr.share.unmapped) notes.push(cr.share.unmapped + ' project' + (cr.share.unmapped > 1 ? 's' : '') + ' not linked to a company (sharing locked)');
    return {
        reserveValue: P.pesos(t.reserveCents),
        reserveSub: 'Recorded at closeout for completed projects; 5% estimate otherwise',
        balanceLabel: t.netCents < 0 ? 'Shortfall' : 'Sharing Balance',
        balanceValue: P.pesos(t.netCents),
        splitLine: 'You ' + P.pesos(t.ownerCents) + ' · Partner ' + P.pesos(t.partnerCents),
        caption: 'Internal allocation — not a payout.',
        notes,
    };
}
```

- [ ] **Step 6: On-screen render** — in `_pmRptRenderKPIs`, replace the second `rpt-grid rpt-grid-3` block (from `html += '<div class="rpt-grid rpt-grid-3" style="margin-top:12px;">'` through its closing `+ '</div>';`) with:

```js
    const sc = _pmRptShareCards(cr);
    html += '<div class="rpt-grid rpt-grid-3" style="margin-top:12px;">'
        + '<div class="rpt-kpi-card' + (crOver ? ' rpt-kpi-card--over' : '') + '">'
        +   '<div class="rpt-kpi-dotrow"><span class="rpt-kpi-label">Remaining Cash Receipt</span></div>'
        +   '<div class="rpt-kpi-val">' + (crOver ? '&minus;' : '+') + '&#8369;' + formatNum(Math.abs(cr.netCash)) + '</div>'
        +   '<div class="rpt-kpi-sub">Paid &minus; Direct Cost</div>'
        + '</div>'
        + (sc.error
            ? '<div class="rpt-kpi-card rpt-kpi-card--over" style="grid-column:span 2;">'
              + '<div class="rpt-kpi-dotrow"><span class="rpt-kpi-label">Sharing unavailable</span></div>'
              + '<div class="rpt-kpi-sub">' + _esc(sc.error) + '</div></div>'
            : '<div class="rpt-kpi-card">'
              + '<div class="rpt-kpi-dotrow"><span class="rpt-kpi-label">Warranty Reserve</span></div>'
              + '<div class="rpt-kpi-val">' + sc.reserveValue + '</div>'
              + '<div class="rpt-kpi-sub">' + sc.reserveSub + '</div>'
              + '</div>'
              + '<div class="rpt-kpi-card">'
              + '<div class="rpt-kpi-dotrow"><span class="rpt-kpi-label">' + sc.balanceLabel + '</span></div>'
              + '<div class="rpt-kpi-val">' + sc.balanceValue + '</div>'
              + '<div class="rpt-kpi-sub">' + sc.splitLine + '<br>' + sc.caption
              +   (sc.notes.length ? '<br>' + sc.notes.join('<br>') : '') + '</div>'
              + '</div>')
        + '</div>';
```

- [ ] **Step 7: Print** — in `printPMReportsDashboard`, replace the two lines `${kpi('Warranty Retention', …)}` and `${kpi('Profit Share', …)}` (~9530–9533) with:

```js
    ${(() => { const sc = _pmRptShareCards(cr); return sc.error
        ? kpi('Sharing unavailable', '—', _esc(sc.error))
        : kpi('Warranty Reserve', sc.reserveValue, sc.reserveSub)
          + kpi(sc.balanceLabel, sc.balanceValue, sc.splitLine + ' · ' + sc.caption + (sc.notes.length ? ' · ' + sc.notes.join(' · ') : '')); })()}
```

- [ ] **Step 8: Run all tests**

Run: `node tests/pm-sharing.test.js && node --check js/pm-admin.js && npm test`
Expected: `31 passed`; `npm test` green. `grep -n "netCash \* 0.05\|profitShare" js/pm-admin.js` prints nothing.

If D5 fails with a load-time `ReferenceError` inside the print path, add that name as a stub in `tests/helpers/pm-admin-sandbox.js` only if it is a pure display helper (e.g. a chart or logo URL). Never stub `_pmRptCashReceipt`, `_pmRptShareCards` or `PMShare`.

- [ ] **Step 9: Checkpoint** — diff summary; the user commits.

---

### Task 9: Project form — Financial agreement section and save path

**Files:**
- Modify: `admin.html` (after the `pm-fee-highlight` block, ~5535)
- Modify: `js/pm-admin.js`: `pmOpenProjectModal`, `pmEditProject`, `pmSaveProject` (~1909–2060), new form helpers before `pmOpenProjectModal`
- Modify: `tests/pm-sharing.test.js` (section E)

**Interfaces:**
- Consumes: `PMShare.load/save/parsePct/fmtPct/errorText`, `_pmCanSeeShare`, `_pmShowErr`, `_pmClearErr`, `_esc`.
- Produces: `window.pmShareLink(which:'owner'|'partner')`; `_pmShareOpenForm(projectId|null) → Promise<void>`; global `let _pmShareForm` = `{projectId, partnerPct, version, canEdit, isNew} | null`.

- [ ] **Step 1: Write the failing tests** — insert above `// @@SECTIONS@@`:

```js
// ══ E. Project form (real pm-admin.js) ════════════════════════════════
function formSandbox(role, opts = {}) {
  const sb = loadPmAdmin({ role });
  const set = (id, v) => { sb.ctx.document.getElementById(id).value = v; };
  set('pmProjectId', opts.id === undefined ? 'P1' : opts.id); set('pmProjectClientName', 'Client'); set('pmProjectName', 'Name');
  set('pmProjectEmail', ''); set('pmProjectStatus', 'active'); set('pmProjectStartDate', ''); set('pmProjectAddress', '');
  set('pmProjectBudget', ''); set('pmProjectEndDate', ''); set('pmProjectFeePct', '15');
  const saves = [], updates = [], rebills = [];
  sb.ctx.db = { collection: () => ({ doc: () => ({ update: async (d) => { updates.push(d); } }),
                                     add: async () => ({ id: 'NEW' }) }) };
  sb.ctx.PMShare.save = async (...a) => { saves.push(a); if (opts.saveFails) throw new Error('STALE'); return { changed: true }; };
  sb.ctx._pmRecomputeUnpaidBills = async (...a) => { rebills.push(a); return 0; };
  sb.ctx._pmLoadProjectsList = () => {};
  sb.ctx.pmCloseModal = () => {};
  sb.run(`_pmProjects = [{ id: 'P1', managementFeePct: 15 }];`);
  return { sb, set, saves, updates, rebills };
}
test('E1 linked inputs: typing one share fills the other', () => {
  const { sb, set } = formSandbox('owner');
  sb.run(`_pmShareForm = { projectId: 'P1', partnerPct: 50, version: 0, canEdit: true, isNew: false };`);
  set('pmShareOwnerPct', '60'); sb.ctx.pmShareLink('owner');
  eq(sb.ctx.document.getElementById('pmSharePartnerPct').value, '40');
  set('pmSharePartnerPct', '33.33'); sb.ctx.pmShareLink('partner');
  eq(sb.ctx.document.getElementById('pmShareOwnerPct').value, '66.67');
  eq(sb.ctx.document.getElementById('pmShareReasonWrap').style.display, 'block', 'reason shown on change');
});
test('E2 edit: saves the typed % with version + reason, never re-bills', async () => {
  const f = formSandbox('owner');
  f.sb.run(`_pmShareForm = { projectId: 'P1', partnerPct: 50, version: 0, canEdit: true, isNew: false };`);
  f.set('pmSharePartnerPct', '40'); f.set('pmShareReason', ' Agreed 60/40 ');
  await f.sb.ctx.pmSaveProject();
  eq(f.saves, [['P1', 40, 0, 'Agreed 60/40']]);
  eq(f.rebills.length, 0, 'sharing never re-bills');
  ok(!('partnerPct' in f.updates[0]) && !('partner_pct' in f.updates[0]), 'no sharing field on the project row');
});
test('E3 edit: a changed % with no reason blocks the whole save', async () => {
  const f = formSandbox('owner');
  f.sb.run(`_pmShareForm = { projectId: 'P1', partnerPct: 50, version: 0, canEdit: true, isNew: false };`);
  f.set('pmSharePartnerPct', '40'); f.set('pmShareReason', '');
  await f.sb.ctx.pmSaveProject();
  eq([f.saves.length, f.updates.length], [0, 0]);
  eq(f.sb.ctx.document.getElementById('err-pmSharePct').textContent, 'Give a reason for changing the split.');
});
test('E4 invalid % blocks the save (40.123 never rounded in the browser)', async () => {
  const f = formSandbox('owner');
  f.sb.run(`_pmShareForm = { projectId: 'P1', partnerPct: 50, version: 0, canEdit: true, isNew: false };`);
  f.set('pmSharePartnerPct', '40.123'); f.set('pmShareReason', 'x');
  await f.sb.ctx.pmSaveProject();
  eq([f.saves.length, f.updates.length], [0, 0]);
});
test('E5 create: a non-default split saves with the creation reason', async () => {
  const f = formSandbox('owner', { id: '' });
  f.sb.run(`_pmShareForm = { projectId: null, partnerPct: 50, version: 0, canEdit: true, isNew: true };`);
  f.set('pmSharePartnerPct', '30');
  await f.sb.ctx.pmSaveProject();
  eq(f.saves, [['NEW', 30, 0, 'Set when the project was created']]);
});
test('E6 unchanged % → no sharing call', async () => {
  const f = formSandbox('owner');
  f.sb.run(`_pmShareForm = { projectId: 'P1', partnerPct: 50, version: 0, canEdit: true, isNew: false };`);
  f.set('pmSharePartnerPct', '50');
  await f.sb.ctx.pmSaveProject();
  eq(f.saves.length, 0);
});
test('E7 sharing failure after a good project save → partial-save message', async () => {
  const f = formSandbox('owner', { saveFails: true });
  f.sb.run(`_pmShareForm = { projectId: 'P1', partnerPct: 50, version: 0, canEdit: true, isNew: false };`);
  f.set('pmSharePartnerPct', '40'); f.set('pmShareReason', 'r');
  await f.sb.ctx.pmSaveProject();
  eq(f.updates.length, 1, 'project saved');
  eq(f.sb.toasts.pop(), ['Project saved; sharing not saved — still 50/50. This split was changed by someone else — reload.', true]);
});
test('E8 view-only (focused owner) and staff: no sharing save', async () => {
  const f = formSandbox('owner');
  f.sb.run(`_pmShareForm = { projectId: 'P1', partnerPct: 50, version: 0, canEdit: false, isNew: false };`);
  f.set('pmSharePartnerPct', '40'); f.set('pmShareReason', 'r');
  await f.sb.ctx.pmSaveProject();
  eq(f.saves.length, 0, 'view-only');
  const s = formSandbox('staff');
  await s.sb.ctx._pmShareOpenForm('P1');
  ok(s.sb.ctx.document.getElementById('pmShareSection').removed, 'section removed for staff');
  await s.sb.ctx.pmSaveProject();
  eq([s.saves.length, s.updates.length], [0, 1], 'staff project save still works');
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node tests/pm-sharing.test.js`
Expected: E1–E8 FAIL (`pmShareLink is not a function`, etc.).

- [ ] **Step 3: Markup** — in `admin.html`, directly after the closing `</div>` of `<div class="pm-fee-highlight">` (the line after `<span>%</span>` + `</div>`, ~5535) insert:

```html
      <!-- Financial agreement (profit sharing, 0098). Owner-role only: removed
           from the DOM for staff by _pmShareOpenForm. Editable only when the
           server says this is the main owner (pm_sharing_read.can_edit). -->
      <div id="pmShareSection" style="display:none;">
        <div class="pm-form-section">Financial agreement</div>
        <div style="font-size:12px;color:#6b7280;margin:-2px 0 10px;">Fee changes what the client is billed. Shares divide the cash left after costs and the warranty reserve.</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
          <div class="pm-form-group">
            <label class="pm-field-label" for="pmShareOwnerPct">Your share %</label>
            <input type="text" inputmode="decimal" id="pmShareOwnerPct" class="pm-input" oninput="pmShareLink('owner')">
          </div>
          <div class="pm-form-group">
            <label class="pm-field-label" for="pmSharePartnerPct">Partner share %</label>
            <input type="text" inputmode="decimal" id="pmSharePartnerPct" class="pm-input" oninput="pmShareLink('partner')">
          </div>
        </div>
        <div class="pm-field-err" id="err-pmSharePct"></div>
        <div class="pm-form-group" id="pmShareReasonWrap" style="display:none;">
          <label class="pm-field-label" for="pmShareReason">Reason for the change <span style="color:#b91c1c;">*</span></label>
          <input type="text" id="pmShareReason" class="pm-input" maxlength="300">
        </div>
        <div id="pmShareStatus" style="font-size:12px;color:#6b7280;margin-top:4px;"></div>
        <div id="pmShareHistory" style="margin-top:8px;"></div>
      </div>
```

- [ ] **Step 4: Form helpers** — in `js/pm-admin.js`, directly above `window.pmOpenProjectModal = function() {` insert:

```js
// ── Financial agreement on the project form (profit sharing) ─────────
// Owner-role accounts see it; only the main owner may edit (the server
// decides — can_edit comes from pm_sharing_read). Staff never get it.
let _pmShareForm = null;      // { projectId, partnerPct, version, canEdit, isNew }
let _pmShareFormSeq = 0;      // drops a slow read for a modal that has moved on

window.pmShareLink = function(which) {
    const o = document.getElementById('pmShareOwnerPct');
    const p = document.getElementById('pmSharePartnerPct');
    if (!o || !p) return;
    const src = which === 'owner' ? o : p;
    const dst = which === 'owner' ? p : o;
    const r = window.PMShare.parsePct(src.value);
    if (r.ok) { dst.value = window.PMShare.fmtPct(100 - r.value); _pmClearErr('err-pmSharePct'); }
    _pmShareSyncReason();
};

function _pmShareSyncReason() {
    const wrap = document.getElementById('pmShareReasonWrap');
    if (!wrap || !_pmShareForm) return;
    const r = window.PMShare.parsePct(document.getElementById('pmSharePartnerPct').value);
    wrap.style.display = (!_pmShareForm.isNew && r.ok && r.value !== _pmShareForm.partnerPct) ? 'block' : 'none';
}

function _pmShareHistoryHtml(history) {
    if (!history || !history.length) return '<div style="font-size:12px;color:#9ca3af;">No changes recorded — split is the original setting.</div>';
    const P = window.PMShare;
    return '<div style="font-size:12px;font-weight:600;color:#374151;margin-bottom:4px;">Change history</div>'
        + history.map(h => '<div style="font-size:12px;color:#4b5563;padding:3px 0;border-top:1px solid #f0f0f0;">'
            + _esc(new Date(h.changed_at).toLocaleString('en-PH')) + ' · ' + _esc(h.actor_email || '')
            + ' · partner ' + _esc(P.fmtPct(h.old_pct)) + '% → ' + _esc(P.fmtPct(h.new_pct)) + '%'
            + (h.old_was_default ? ' (from the 50/50 default)' : '') + ' · ' + _esc(h.reason) + '</div>').join('');
}

async function _pmShareOpenForm(projectId) {
    const sec = document.getElementById('pmShareSection');
    if (!sec) return;
    _pmShareForm = null;
    if (!_pmCanSeeShare()) { sec.remove(); return; }
    const seq = ++_pmShareFormSeq;
    const o = document.getElementById('pmShareOwnerPct'), p = document.getElementById('pmSharePartnerPct');
    const status = document.getElementById('pmShareStatus'), hist = document.getElementById('pmShareHistory');
    sec.style.display = 'block';
    o.value = '50'; p.value = '50'; o.disabled = true; p.disabled = true;
    document.getElementById('pmShareReason').value = '';
    document.getElementById('pmShareReasonWrap').style.display = 'none';
    _pmClearErr('err-pmSharePct');
    status.textContent = 'Loading split…'; hist.innerHTML = '';
    try {
        const read = await window.PMShare.load(projectId ? [projectId] : []);
        if (seq !== _pmShareFormSeq) return;
        const row = projectId ? (read.projects || []).find(x => x.project_id === projectId) : null;
        if (projectId && !row) { status.textContent = window.PMShare.errorText('PROJECT_UNMAPPED'); return; }
        const partnerPct = row ? Number(row.partner_pct) : 50;
        _pmShareForm = { projectId: projectId || null, partnerPct, version: row ? row.version : 0,
                         canEdit: !!read.can_edit, isNew: !projectId };
        p.value = window.PMShare.fmtPct(partnerPct); o.value = window.PMShare.fmtPct(100 - partnerPct);
        o.disabled = p.disabled = !_pmShareForm.canEdit;
        status.textContent = _pmShareForm.canEdit ? (row && row.is_default ? 'Using the 50/50 default.' : '')
                                                  : 'View only — only the main owner can change the split.';
        hist.innerHTML = projectId ? _pmShareHistoryHtml((read.history || []).filter(h => h.project_id === projectId)) : '';
    } catch (e) {
        if (seq !== _pmShareFormSeq) return;
        status.textContent = 'Could not load the sharing split: ' + window.PMShare.errorText(e.message);
    }
}
```

- [ ] **Step 5: Open hooks** — at the end of `pmOpenProjectModal` (before `document.getElementById('pmProjectModal').style.display = 'flex';`) add `    _pmShareOpenForm(null);`. In `pmEditProject` at the same spot add `    _pmShareOpenForm(p.id);`.

- [ ] **Step 6: Save path** — in `pmSaveProject`:
  (a) After the two `if (!clientName)` / `if (!projectName)` validation lines and **before** `if (!valid) return;`, insert:

```js
    // Sharing split — validated BEFORE anything is saved, saved AFTER the
    // project (it needs the id). Never part of `data`: the split lives in its
    // own private table, and changing it never re-bills (spec §6.1).
    let shareReq = null;
    if (_pmShareForm && _pmShareForm.canEdit) {
        _pmClearErr('err-pmSharePct');
        const r = window.PMShare.parsePct(document.getElementById('pmSharePartnerPct').value);
        if (!r.ok) { _pmShowErr('err-pmSharePct', r.error); valid = false; }
        else if (r.value !== _pmShareForm.partnerPct) {
            const reason = _pmShareForm.isNew ? 'Set when the project was created'
                         : (document.getElementById('pmShareReason').value || '').trim();
            if (!reason) { _pmShowErr('err-pmSharePct', 'Give a reason for changing the split.'); valid = false; }
            else shareReq = { value: r.value, version: _pmShareForm.version, reason, before: _pmShareForm.partnerPct };
        }
    }
```

  (b) Add a helper just above `window.pmSaveProject`:

```js
// Saves the split after the project row is saved. Returns '' or the
// partial-save message — the project itself is already saved either way.
async function _pmShareSaveAfter(projectId, shareReq) {
    if (!shareReq || !projectId) return '';
    try {
        await window.PMShare.save(projectId, shareReq.value, shareReq.version, shareReq.reason);
        _pmRptState.share = null;
        return '';
    } catch (e) {
        const P = window.PMShare;
        return 'Project saved; sharing not saved — still ' + P.fmtPct(100 - shareReq.before) + '/' + P.fmtPct(shareReq.before)
             + '. ' + P.errorText(e.message);
    }
}
```

  (c) In the **edit** branch, replace `if (feeChanged && reBilled > 0) _pmToast(...); else _pmToast('Project saved');` with:

```js
            const shareMsg = await _pmShareSaveAfter(projectId, shareReq);
            if (shareMsg) _pmToast(shareMsg, true);
            else if (feeChanged && reBilled > 0) _pmToast(`Fee set to ${managementFeePct}% · re-billed ${reBilled} unpaid week${reBilled > 1 ? 's' : ''}`);
            else _pmToast('Project saved');
            if (_pmActiveProject && _pmActiveProject.id === projectId && document.getElementById('pm-ov-root')
                && typeof _pmLoadOverview === 'function' && !shareMsg && shareReq) _pmLoadOverview();
```

  (d) In the **create** branch, replace `_pmToast('Project created');` with:

```js
            const shareMsg = await _pmShareSaveAfter(ref && ref.id, shareReq);
            _pmToast(shareMsg || 'Project created', !!shareMsg);
```

- [ ] **Step 7: Run all tests**

Run: `node tests/pm-sharing.test.js && node --check js/pm-admin.js && npm test`
Expected: `39 passed`; `npm test` green.

- [ ] **Step 8: Checkpoint** — diff summary; the user commits.

---

### Task 10: Profit Sharing dashboard — wiring, loader, summary, table, chart

**Files:**
- Create: `js/pm-sharing-dashboard.js`
- Modify: `js/admin.js`: PRIMARY_NAV pm modules (~2248), titles (~783), staff sidebar list (~409), `_visibleNav` staff filter (~2427)
- Modify: `admin.html`: sidebar (~233), view markup (after `warrantyFundView`, ~1791), titles (~6269), staff `blocked` list + bounce (~6330–6337), init (~6391), script tag (after `termination-requests.js`, ~5436)
- Modify: `tests/pm-sharing.test.js` (section F)

**Interfaces:**
- Consumes: `PMShare.load/project/combine/pesos/fmtPct/acceptanceFacts/errorText`, `WF.reserveFor`, `db`, `_esc` (pm-admin global).
- Produces `window.PMShareDash`: `init()`, `load()`, `render()`, `applyFilters(results, filters) → results`, `buildModel(results, filters) → {rows, review, totals, partners}`, `labelFor(result, all) → string`, `chipsFor(result) → string[]`, `_state`, `_setFetch(fn)`. `filters` = `{from:'', to:'', undatedOnly:false, partner:'all'|'unassigned'|email, q:''}`. The fetcher returns `{read, projects, perProject:{[id]:{bills, reqs}}, reserves}`. Global `initPMSharingDashboard()`.

- [ ] **Step 1: Write the failing tests** — insert above `// @@SECTIONS@@`:

```js
// ══ F. Dashboard (real pm-sharing-dashboard.js) ═══════════════════════
function loadDash(role) {
  const sb = loadPmAdmin({ role });
  require('vm').runInContext(read('js/pm-sharing-dashboard.js'), sb.ctx, { filename: 'pm-sharing-dashboard.js' });
  return sb;
}
const dashData = () => ({
  read: { can_edit: true, history: [], partners: [],
          projects: [{ project_id: 'A', partner_pct: 40, is_default: false, version: 1 },
                     { project_id: 'B', partner_pct: 50, is_default: true, version: 0 },
                     { project_id: 'C', partner_pct: 50, is_default: true, version: 0 }] },
  projects: [projA, projB, { ...projB, id: 'C', projectName: 'Beta', terminatedAt: '2026-09-10T02:00:00Z' }],
  perProject: { A: { bills: [], reqs: [verified(800000)] }, B: { bills: [], reqs: [verified(500000)] },
                C: { bills: [], reqs: [verified(1000)] } },
  reserves: { A: rec(40000, 800000, 0), B: rec(25000, 500000, 0) },   // C has no reserve → needs review
});
test('F1 summary = confirmed projects only; worked example totals; C in review', async () => {
  const sb = loadDash('owner');
  sb.ctx.PMShareDash._setFetch(async () => dashData());
  await sb.ctx.PMShareDash.load();
  const h = sb.ctx.document.getElementById('pmSharingRoot').innerHTML;
  for (const s of ['2 confirmed · 1 with reserve needing review', '₱693,500.00', '₱541,500.00',
                   'Internal allocation — not a payout or amount owed.', 'Reserve needs review', 'Provisional']) {
    ok(h.includes(s), 'missing: ' + s);
  }
});
test('F2 filters: partner unassigned, undated only, date range, search', () => {
  const sb = loadDash('owner');
  const D = sb.ctx.PMShareDash, P = sb.ctx.PMShare, d = dashData();
  const results = d.projects.map(p => P.project({ ...p, name: p.projectName, ...d.perProject[p.id], reserveRow: d.reserves[p.id] || null,
                                                  partnerPct: d.read.projects.find(x => x.project_id === p.id).partner_pct }));
  const base = { from: '', to: '', undatedOnly: false, partner: 'all', q: '' };
  eq(D.applyFilters(results, { ...base, partner: 'unassigned' }).map(r => r.id), ['B', 'C']);
  eq(D.applyFilters(results, { ...base, partner: 'p@x.test' }).map(r => r.id), ['A']);
  eq(D.applyFilters(results, { ...base, undatedOnly: true }).map(r => r.id), ['B']);
  eq(D.applyFilters(results, { ...base, from: '2026-08-01', to: '2026-08-31' }).map(r => r.id), ['A']);
  eq(D.applyFilters(results, { ...base, q: 'ana' }).map(r => r.id), ['A']);
  eq(D.applyFilters(results, base).map(r => r.id), ['A', 'B', 'C'], 'undated kept under All');
});
test('F3 same-named projects get completion date + short id', () => {
  const sb = loadDash('owner');
  const P = sb.ctx.PMShare;
  const b = P.project({ ...projB, id: 'b1aaaaaa', name: 'Beta' });
  const c = P.project({ ...projB, id: 'c2bbbbbb', name: 'Beta', terminatedAt: '2026-09-10T02:00:00Z' });
  eq(sb.ctx.PMShareDash.labelFor(b, [b, c]), 'Beta · undated · b1aaaa');
  eq(sb.ctx.PMShareDash.labelFor(c, [b, c]), 'Beta · 2026-09-10 · c2bbbb');
  eq(sb.ctx.PMShareDash.labelFor(P.project(inA), [P.project(inA)]), 'Alpha');
});
test('F4 chips coexist; Ready only when nothing else applies', () => {
  const sb = loadDash('owner');
  const P = sb.ctx.PMShare, D = sb.ctx.PMShareDash;
  eq(D.chipsFor(P.project(inA)), ['Ready']);
  const both = P.project({ ...inB, reqs: [verified(500000), { status: 'unpaid', totalAmount: 1, amountPaid: 0 }], reserveRow: rec(25000, 1, 0) });
  eq(D.chipsFor(both), ['Unpaid client balance', 'Changed since closeout']);
});
test('F5 a stale response is discarded', async () => {
  const sb = loadDash('owner');
  const D = sb.ctx.PMShareDash;
  let releaseFirst;
  const first = new Promise(r => { releaseFirst = r; });
  let n = 0;
  D._setFetch(async () => { n++; if (n === 1) { await first; const d = dashData(); d.projects = [projA]; return d; } return dashData(); });
  const p1 = D.load();
  const p2 = D.load();
  await p2; releaseFirst(); await p1;
  eq(D._state.results.length, 3, 'newer result kept');
});
test('F6 a failed load shows an error panel, never ₱0', async () => {
  const sb = loadDash('owner');
  sb.ctx.PMShareDash._setFetch(async () => { throw new Error('OWNER_ONLY'); });
  await sb.ctx.PMShareDash.load();
  const h = sb.ctx.document.getElementById('pmSharingRoot').innerHTML;
  ok(h.includes('Could not load Profit Sharing'), 'error panel');
  ok(!h.includes('₱0.00'), 'no zero totals');
});
test('F7 staff: nothing rendered, nothing fetched', async () => {
  const sb = loadDash('staff');
  let fetched = false;
  sb.ctx.PMShareDash._setFetch(async () => { fetched = true; return dashData(); });
  await sb.ctx.initPMSharingDashboard();
  eq(sb.ctx.document.getElementById('pmSharingRoot').innerHTML, '');
  eq(fetched, false);
});
test('F8 wiring: nav, focus access, staff guards, view, script', () => {
  const adm = read('js/admin.js'), html = read('admin.html');
  const pmBlock = adm.slice(adm.indexOf("{ id: 'pm', label: 'Project Management'"), adm.indexOf("{ id: 'attendance'"));
  ok(pmBlock.includes("view: 'pmSharing'"), 'PRIMARY_NAV pm module (focused pm accounts reach it through modules)');
  ok(/const hidden = \['warrantyFund', 'pmSharing'\]/.test(adm), '_visibleNav hides it from staff');
  ok(/\['userNavigator', 'clientAccounts', 'expReports', 'reimbursements', 'warrantyFund', 'pmSharing'/.test(adm), 'staff sidebar hide list');
  ok(html.includes('data-view="pmSharing"') && html.includes('id="pmSharingView"') && html.includes('id="pmSharingRoot"'), 'markup');
  ok(/'warrantyFund', 'pmSharing', 'attAppUpdates'/.test(html) && html.includes("view === 'pmSharing') view = 'pmProjects'"), 'staff blocked + bounce');
  ok(html.includes("view === 'pmSharing' && typeof initPMSharingDashboard === 'function'"), 'init hook');
  ok(html.indexOf('js/pm-sharing.js') < html.indexOf('js/pm-admin.js') && html.indexOf('js/pm-sharing-dashboard.js') > html.indexOf('js/warranty-fund.js'), 'script order');
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node tests/pm-sharing.test.js`
Expected: section F fails (`ENOENT … pm-sharing-dashboard.js`).

- [ ] **Step 3: Implement `js/pm-sharing-dashboard.js`**

```js
/* ══════════════════════════════════════════════════════════
   PM → PROFIT SHARING dashboard (window.PMShareDash)
   Spec: docs/superpowers/specs/2026-10-18-pm-profit-sharing-mvp-terms.md §7

   Completed projects only. Owner-role accounts only — staff get an empty
   view and nothing is fetched. Every figure comes from PMShare.project /
   PMShare.combine; cards, table, chart, print and CSV all read ONE model.
   Internal allocation — never a payout or an amount owed.
   ══════════════════════════════════════════════════════════ */
(function () {
    'use strict';
    const S = {
        seq: 0, loading: false, error: null, data: null, results: [], asOf: null, openId: null,
        filters: { from: '', to: '', undatedOnly: false, partner: 'all', q: '' },
    };
    const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    const canSee = () => window.currentUserRole === 'owner';

    // ── fetch: mapped projects of MY company first, then records only for those ──
    async function defaultFetch() {
        const read = await window.PMShare.load(null);
        const mapped = new Set((read.projects || []).map(r => r.project_id));
        const snap = await db.collection('constructionProjects').get();
        const projects = snap.docs.map(d => ({ id: d.id, ...d.data() }))
            .filter(p => mapped.has(p.id) && p.status === 'completed');
        const ids = projects.map(p => p.id);
        const [pairs, reserves] = await Promise.all([
            Promise.all(projects.map(async p => {
                const [b, r] = await Promise.all([
                    db.collection('constructionProjects').doc(p.id).collection('weeklyBills').get(),
                    db.collection('paymentRequests').where('constructionProjectId', '==', p.id).get(),
                ]);
                return [p.id, { bills: b.docs.map(d => ({ id: d.id, ...d.data() })),
                                reqs: r.docs.map(d => ({ id: d.id, ...d.data() })) }];
            })),
            window.WF.reserveFor(ids),
        ]);
        return { read, projects, perProject: Object.fromEntries(pairs), reserves };
    }
    let fetchFn = defaultFetch;

    function toResults(d) {
        const rows = {};
        (d.read.projects || []).forEach(r => { rows[r.project_id] = r; });
        return d.projects.filter(p => rows[p.id]).map(p => window.PMShare.project({
            id: p.id, name: p.projectName, clientName: p.clientName, partnerEmail: p.partnerEmail,
            status: p.status, terminatedAt: p.terminatedAt,
            bills: (d.perProject[p.id] || {}).bills || [], reqs: (d.perProject[p.id] || {}).reqs || [],
            reserveRow: d.reserves[p.id] || null, partnerPct: Number(rows[p.id].partner_pct),
        }));
    }

    async function load() {
        const my = ++S.seq;
        S.loading = true; S.error = null; render();
        try {
            const d = await fetchFn();
            if (my !== S.seq) return;              // a newer load started — drop this one
            S.data = d; S.results = toResults(d); S.asOf = new Date();
        } catch (e) {
            if (my !== S.seq) return;
            S.data = null; S.results = []; S.error = e.message || 'Load failed';
        }
        S.loading = false; render();
    }

    // ── pure model ─────────────────────────────────────────────────────
    function applyFilters(results, f) {
        const q = String(f.q || '').trim().toLowerCase();
        return results.filter(r => {
            if (f.partner === 'unassigned') { if (r.partnerEmail) return false; }
            else if (f.partner && f.partner !== 'all' && r.partnerEmail !== f.partner) return false;
            const key = r.completionKey;
            if (f.undatedOnly) { if (key) return false; }
            else if (f.from || f.to) {
                if (!key) return false;
                if (f.from && key < f.from) return false;
                if (f.to && key > f.to) return false;
            }
            if (q && (r.name + ' ' + r.clientName).toLowerCase().indexOf(q) === -1) return false;
            return true;
        });
    }
    function labelFor(r, all) {
        const dup = all.filter(x => x.name === r.name).length > 1;
        return dup ? r.name + ' · ' + (r.completionKey || 'undated') + ' · ' + String(r.id).slice(0, 6) : r.name;
    }
    const CHIP = { unpaid_balance: 'Unpaid client balance', shortfall: 'Shortfall',
                   reserve_review: 'Reserve needs review', changed_since_closeout: 'Changed since closeout' };
    function chipsFor(r) {
        const c = r.flags.map(f => CHIP[f]).filter(Boolean);
        return c.length ? c : ['Ready'];
    }
    function buildModel(results, filters) {
        const picked = applyFilters(results, filters);
        const c = window.PMShare.combine(picked);
        const partners = Array.from(new Set(results.map(r => r.partnerEmail).filter(Boolean))).sort();
        return { rows: c.confirmed, review: c.review, totals: c.totals, partners, all: results };
    }

    // ── render ─────────────────────────────────────────────────────────
    const P = () => window.PMShare;
    function card(label, value, sub, tone) {
        return '<div class="pms-card' + (tone ? ' pms-' + tone : '') + '"><div class="pms-card-l">' + esc(label) + '</div>'
             + '<div class="pms-card-v">' + esc(value) + '</div>' + (sub ? '<div class="pms-card-s">' + esc(sub) + '</div>' : '') + '</div>';
    }
    function filtersHtml(m) {
        const f = S.filters;
        return '<div class="pms-filters">'
            + '<input type="search" placeholder="Search project or client" value="' + esc(f.q) + '" oninput="PMShareDash.setFilter(\'q\', this.value)">'
            + '<select onchange="PMShareDash.setFilter(\'partner\', this.value)">'
            +   '<option value="all"' + (f.partner === 'all' ? ' selected' : '') + '>All partners</option>'
            +   '<option value="unassigned"' + (f.partner === 'unassigned' ? ' selected' : '') + '>Partner unassigned</option>'
            +   m.partners.map(p => '<option value="' + esc(p) + '"' + (f.partner === p ? ' selected' : '') + '>' + esc(p) + '</option>').join('')
            + '</select>'
            + '<label>From <input type="date" value="' + esc(f.from) + '" onchange="PMShareDash.setFilter(\'from\', this.value)"' + (f.undatedOnly ? ' disabled' : '') + '></label>'
            + '<label>To <input type="date" value="' + esc(f.to) + '" onchange="PMShareDash.setFilter(\'to\', this.value)"' + (f.undatedOnly ? ' disabled' : '') + '></label>'
            + '<label><input type="checkbox"' + (f.undatedOnly ? ' checked' : '') + ' onchange="PMShareDash.setFilter(\'undatedOnly\', this.checked)"> Undated only</label>'
            + '<button type="button" onclick="PMShareDash.print()">Print / PDF</button>'
            + '<button type="button" onclick="PMShareDash.downloadCsv()">CSV</button>'
            + '<button type="button" onclick="PMShareDash.load()">Refresh</button>'
            + '</div>';
    }
    function rowHtml(r, all, provisional) {
        const p = P();
        return '<tr onclick="PMShareDash.open(\'' + esc(r.id) + '\')" class="pms-row">'
            + '<td>' + esc(labelFor(r, all)) + '<div class="pms-sub">' + esc(r.clientName) + '</div></td>'
            + '<td>' + (r.partnerEmail ? esc(r.partnerEmail) : '<em>Partner unassigned</em>') + '</td>'
            + '<td>' + esc(r.completionKey || 'Undated') + '</td>'
            + '<td class="n">' + p.pesos(r.paidCents) + '</td>'
            + '<td class="n">' + p.pesos(r.costCents) + '</td>'
            + '<td class="n">' + p.pesos(r.remainingCents) + '</td>'
            + '<td class="n">' + p.pesos(r.reserve.cents) + (provisional ? ' <span class="pms-tag">Provisional</span>' : '') + '</td>'
            + '<td class="n' + (r.balanceCents < 0 ? ' pms-neg' : '') + '">' + p.pesos(r.balanceCents) + '</td>'
            + '<td class="n">' + p.fmtPct(r.ownerPct) + '% · ' + p.pesos(r.ownerCents) + '</td>'
            + '<td class="n">' + p.fmtPct(r.partnerPct) + '% · ' + p.pesos(r.partnerCents) + '</td>'
            + '<td class="n">' + p.pesos(r.outstandingCents) + '</td>'
            + '<td>' + chipsFor(r).map(c => '<span class="pms-chip">' + esc(c) + '</span>').join(' ') + '</td>'
            + '</tr>';
    }
    const HEAD = '<tr><th>Project / client</th><th>Partner</th><th>Completed</th><th>Collected</th><th>Costs</th>'
               + '<th>Remaining cash</th><th>Warranty reserve</th><th>Sharing balance</th><th>Your % / amount</th>'
               + '<th>Partner % / amount</th><th title="Client still owes: unpaid + partial requests">Client balance</th><th>Review</th></tr>';
    function chartHtml(rows) {
        if (!rows.length) return '';
        const max = Math.max(1, ...rows.map(r => Math.abs(r.balanceCents)));
        return '<div class="pms-chart" aria-label="Sharing balance per project">' + rows.map(r => {
            const w = Math.abs(r.balanceCents) / max * 50;
            const ow = r.balanceCents === 0 ? 0 : Math.abs(r.ownerCents) / Math.abs(r.balanceCents) * w;
            const bar = r.balanceCents >= 0
                ? '<div class="pms-bar" style="left:50%;width:' + w + '%"><span class="pms-own" style="width:' + (w ? ow / w * 100 : 0) + '%"></span></div>'
                : '<div class="pms-bar pms-short" style="left:' + (50 - w) + '%;width:' + w + '%"></div>';
            return '<div class="pms-chart-row"><div class="pms-chart-l">' + esc(labelFor(r, S.results)) + '</div>'
                 + '<div class="pms-chart-t"><div class="pms-axis"></div>' + bar + '</div>'
                 + '<div class="pms-chart-v">' + P().pesos(r.balanceCents) + '</div></div>';
        }).join('') + '<div class="pms-legend"><span class="pms-own-k"></span> Your part <span class="pms-par-k"></span> Partner part <span class="pms-short-k"></span> Shortfall</div></div>';
    }
    function render() {
        const root = document.getElementById('pmSharingRoot');
        if (!root) return;
        if (!canSee()) { root.innerHTML = ''; return; }
        if (S.loading && !S.data) { root.innerHTML = '<div class="pms-state">Loading Profit Sharing…</div>'; return; }
        if (S.error) {
            root.innerHTML = '<div class="pms-state pms-err">Could not load Profit Sharing: ' + esc(P().errorText(S.error))
                           + ' <button type="button" onclick="PMShareDash.load()">Retry</button></div>';
            return;
        }
        const m = buildModel(S.results, S.filters);
        const t = m.totals, p = P();
        const head = '<div class="pms-head"><h2>Profit Sharing</h2><div class="pms-note">Completed projects · '
                   + 'Internal allocation — not a payout or amount owed. As of ' + esc(S.asOf ? S.asOf.toLocaleString('en-PH') : '') + '</div></div>';
        if (!m.rows.length && !m.review.length) {
            root.innerHTML = head + filtersHtml(m) + '<div class="pms-state">No completed projects match these filters.</div>';
            return;
        }
        root.innerHTML = head + filtersHtml(m)
            + '<div class="pms-cards">'
            + card('Projects', t.count + ' confirmed · ' + t.reviewCount + ' with reserve needing review', '')
            + card('Client cash collected', p.pesos(t.paidCents), 'Lifetime eligible receipts')
            + card('Project costs', p.pesos(t.costCents), 'Lifetime, incl. billable site overhead')
            + card('Recorded warranty reserve', p.pesos(t.reserveCents), 'Frozen at closeout')
            + card('Available for sharing', p.pesos(t.availableCents), 'Projects with a positive balance')
            + card('Cash shortfall', p.pesos(t.shortfallCents), 'Projects with a negative balance', t.shortfallCents < 0 ? 'neg' : '')
            + card('Net sharing balance', p.pesos(t.netCents), 'Available + shortfall')
            + card('Your allocation', p.pesos(t.ownerCents), t.ownerShortfallCents ? 'Includes shortfall ' + p.pesos(t.ownerShortfallCents) : '')
            + card('Partner allocation', p.pesos(t.partnerCents), t.partnerShortfallCents ? 'Includes shortfall ' + p.pesos(t.partnerShortfallCents) : '')
            + card('Outstanding client balance', p.pesos(t.outstandingCents), 'Unpaid + partial requests')
            + '</div>'
            + '<div class="pms-caption">Internal allocation — not a payout or amount owed.</div>'
            + chartHtml(m.rows)
            + '<div class="pms-tablewrap"><table class="pms-table"><thead>' + HEAD + '</thead><tbody>'
            + m.rows.map(r => rowHtml(r, m.all, false)).join('')
            + '</tbody></table></div>'
            + (m.review.length
                ? '<h3 class="pms-review-h">Reserve needs review — not in the totals above</h3>'
                  + '<div class="pms-tablewrap"><table class="pms-table"><thead>' + HEAD + '</thead><tbody>'
                  + m.review.map(r => rowHtml(r, m.all, true)).join('') + '</tbody></table></div>'
                : '')
            + '<div id="pmSharingDetail"></div>';
        if (S.openId) renderDetail();
    }

    function setFilter(k, v) { S.filters[k] = v; render(); }
    // @@DETAIL_PRINT_CSV@@

    async function init() {
        const root = document.getElementById('pmSharingRoot');
        if (!canSee()) { if (root) root.innerHTML = ''; return; }
        await load();
    }

    window.PMShareDash = { init, load, render, applyFilters, buildModel, labelFor, chipsFor, setFilter,
                           _state: S, _setFetch: (fn) => { fetchFn = fn || defaultFetch; } };
    // @@DASH_EXPORTS@@
    window.initPMSharingDashboard = init;
})();
```

Until Task 11, `render()` references `renderDetail`, and the filter bar calls `PMShareDash.open/print/downloadCsv`. For Task 10 only, replace `// @@DETAIL_PRINT_CSV@@` with this stub block (Task 11 replaces it):

```js
    function renderDetail() {}
```

- [ ] **Step 4: Styles** — append to the end of `css/pm-admin.css` (confirm the PM stylesheet name with `grep -n "pm-admin.css\|pm.css" admin.html`; if PM styles are inline in `admin.html`, put this in a new `<style>` block next to `pmSharingView`):

```css
/* ── PM Profit Sharing dashboard (spec 2026-10-18 §7) ── */
.pms-head h2{font:700 22px 'IBM Plex Sans',sans-serif;margin:0;}
.pms-note,.pms-caption{font-size:12px;color:#6b7280;margin-top:4px;}
.pms-filters{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:14px 0;}
.pms-filters input,.pms-filters select,.pms-filters button{font:inherit;font-size:13px;padding:7px 10px;border:1px solid #d6dde4;border-radius:8px;background:#fff;}
.pms-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px;}
.pms-card{border:1px solid #e5e7eb;border-radius:12px;padding:12px 14px;background:#fff;}
.pms-card-l{font-size:11.5px;font-weight:600;color:#7c7b75;}
.pms-card-v{font:700 18px 'IBM Plex Sans',sans-serif;margin-top:6px;font-variant-numeric:tabular-nums;}
.pms-card-s{font-size:11px;color:#9a9992;margin-top:4px;}
.pms-neg .pms-card-v,.pms-neg{color:#8f352c;}
.pms-tablewrap{overflow-x:auto;margin-top:12px;}
.pms-table{width:100%;border-collapse:collapse;font-size:12.5px;}
.pms-table th,.pms-table td{padding:8px;border-bottom:1px solid #eef0f3;text-align:left;white-space:nowrap;}
.pms-table td.n{text-align:right;font-variant-numeric:tabular-nums;}
.pms-row{cursor:pointer;} .pms-row:hover{background:#f7f9fb;}
.pms-sub{font-size:11px;color:#9ca3af;}
.pms-chip,.pms-tag{display:inline-block;font-size:10.5px;font-weight:700;padding:2px 8px;border-radius:99px;background:#eef2f6;color:#44525f;}
.pms-tag{background:#fbf2dc;color:#9a6c12;}
.pms-review-h{font:700 14px 'IBM Plex Sans',sans-serif;margin:18px 0 0;color:#9a6c12;}
.pms-state{padding:28px;text-align:center;color:#6b7280;} .pms-err{color:#8f352c;}
.pms-chart{margin-top:14px;} .pms-chart-row{display:grid;grid-template-columns:180px 1fr 120px;gap:8px;align-items:center;font-size:12px;margin:4px 0;}
.pms-chart-t{position:relative;height:14px;background:#f5f6f8;border-radius:4px;}
.pms-axis{position:absolute;left:50%;top:0;bottom:0;width:1px;background:#9ca3af;}
.pms-bar{position:absolute;top:2px;bottom:2px;background:#9dc9b4;border-radius:3px;overflow:hidden;}
.pms-own{display:block;height:100%;background:#0f6342;} .pms-short{background:#c2564a;}
.pms-chart-v{text-align:right;font-variant-numeric:tabular-nums;}
.pms-legend{font-size:11px;color:#6b7280;margin-top:6px;}
.pms-own-k,.pms-par-k,.pms-short-k{display:inline-block;width:10px;height:10px;border-radius:2px;vertical-align:middle;margin-left:8px;}
.pms-own-k{background:#0f6342;} .pms-par-k{background:#9dc9b4;} .pms-short-k{background:#c2564a;}
@media (max-width:640px){.pms-chart-row{grid-template-columns:1fr;}}
```

- [ ] **Step 5: Wiring — `js/admin.js`**
  1. PRIMARY_NAV pm `modules`, after the `warrantyFund` entry:
     ```js
        // Profit Sharing (0098) — completed-project owner/partner allocation.
        // Internal allocation, never a payout. Owner-role only; hidden from staff below.
        { view: 'pmSharing',           label: 'Profit Sharing',       icon: 'pie-chart' },
     ```
  2. Titles map (~783), after `warrantyFund: 'Warranty Fund',`: `        pmSharing:        'Profit Sharing',`
  3. Staff sidebar list (~409): `['userNavigator', 'clientAccounts', 'expReports', 'reimbursements', 'warrantyFund', 'pmSharing', 'quoteList', 'attAppUpdates']`
  4. `_visibleNav` staff pm filter (~2427): `const hidden = ['warrantyFund', 'pmSharing'];` and extend its comment: `// Profit Sharing is peso amounts end to end too (0098).`

  `_FOCUS_SUBVIEWS` needs **no** entry: `pmSharing` is a listed module of the `pm` section, so `allowed_modules: ['pm']` accounts reach it already, and project details are a panel inside the same view (no drill-down view). F8 checks the module entry.

- [ ] **Step 6: Wiring — `admin.html`**
  1. Sidebar, after the `warrantyFund` `<a>`:
     ```html
                    <a href="#" class="nav-item nav-child" data-view="pmSharing">
                        <span class="nav-icon-wrap"><i data-lucide="pie-chart" class="nav-icon"></i></span><span>Profit Sharing</span>
                    </a>
     ```
  2. After the closing `</div>` of `<div id="warrantyFundView" …>`:
     ```html
        <!-- PM → Profit Sharing (0098). Owner-role only; js/pm-sharing-dashboard.js renders it. -->
        <div id="pmSharingView" class="content-view" style="display:none;">
            <div id="pmSharingRoot"></div>
        </div>
     ```
  3. Titles map (~6269): add `        pmSharing:        'Profit Sharing',`
  4. Staff `blocked` list (~6330): insert `'pmSharing'` after `'warrantyFund'`, and change the bounce to `if (view === 'warrantyFund' || view === 'pmSharing') view = 'pmProjects';`
  5. Init (after the `warrantyFund` init line ~6391): `        if (view === 'pmSharing' && typeof initPMSharingDashboard === 'function') initPMSharingDashboard();`
  6. Script tag after `js/termination-requests.js`: `<script src="js/pm-sharing-dashboard.js?v=20261018a"></script>`

- [ ] **Step 7: Run all tests**

Run: `node tests/pm-sharing.test.js && node --check js/pm-sharing-dashboard.js && node --check js/admin.js && npm test`
Expected: `47 passed`; all green.

- [ ] **Step 8: Checkpoint** — diff summary; the user commits.

---

### Task 11: Dashboard — project details, print, CSV

**Files:**
- Modify: `js/pm-sharing-dashboard.js` (replace the Task 10 stub at `// @@DETAIL_PRINT_CSV@@` and fill `// @@DASH_EXPORTS@@`)
- Modify: `tests/pm-sharing.test.js` (section G)

**Interfaces:**
- Produces on `PMShareDash`: `open(id)`, `close()`, `renderDetail()`, `csvCell(v) → string`, `toCsv(model, meta) → string`, `print()`, `downloadCsv()`, `metaLines() → string[]`.

- [ ] **Step 1: Write the failing tests** — insert above `// @@SECTIONS@@`:

```js
// ══ G. Dashboard details, print, CSV ══════════════════════════════════
test('G1 csvCell: text cells protected, numbers stay numbers (negatives too)', () => {
  const D = loadDash('owner').ctx.PMShareDash;
  eq([D.csvCell('=SUM(A1)'), D.csvCell('+1'), D.csvCell('-x'), D.csvCell('@a'), D.csvCell('\tx'), D.csvCell('a,b'), D.csvCell('say "hi"')],
     ["'=SUM(A1)", "'+1", "'-x", "'@a", "'\tx", '"a,b"', '"say ""hi"""']);
  eq([D.csvCell(-50000), D.csvCell(456000.5), D.csvCell(0)], ['-50000', '456000.5', '0']);
});
test('G2 CSV = same model: meta lines, rows, provisional review rows, totals', async () => {
  const sb = loadDash('owner');
  const D = sb.ctx.PMShareDash;
  D._setFetch(async () => dashData());
  await D.load();
  const csv = D.toCsv(D.buildModel(D._state.results, D._state.filters), D.metaLines());
  ok(csv.includes('Internal allocation — not a payout or amount owed.'), 'label');
  ok(/As of,/.test(csv) && csv.includes('Filters,'), 'meta');
  ok(csv.includes('Alpha,') && csv.includes(',456000,') && csv.includes(',304000,'), 'A row numbers');
  ok(csv.includes('Provisional — reserve needs review'), 'review row marked');
  ok(/Totals \(confirmed\),.*,693500,.*,541500/.test(csv), 'totals row');
});
test('G3 print uses the same model and labels', async () => {
  const sb = loadDash('owner');
  const D = sb.ctx.PMShareDash;
  D._setFetch(async () => dashData());
  await D.load();
  D.print();
  const h = sb.printed.join('');
  for (const s of ['Profit Sharing', '₱693,500.00', '₱541,500.00', 'Internal allocation — not a payout or amount owed.',
                   'Reserve needs review', 'As of']) ok(h.includes(s), 'print missing: ' + s);
});
test('G4 details panel: breakdown, reserve basis, history, acceptance facts; no action buttons', async () => {
  const sb = loadDash('owner');
  const D = sb.ctx.PMShareDash;
  const d = dashData();
  d.read.partners = [{ email: 'p@x.test', accepted: true, accepted_at: '2026-08-12T02:00:00Z', doc_version: 3 }];
  d.read.history = [{ project_id: 'A', old_pct: 50, new_pct: 40, old_was_default: true, reason: 'Agreed 60/40',
                      actor_email: 'admin@dacs.test', changed_at: '2026-09-01T00:00:00Z' }];
  D._setFetch(async () => d);
  await D.load();
  D.open('A');
  const h = sb.ctx.document.getElementById('pmSharingDetail').innerHTML;
  for (const s of ['Collected', 'Labor', 'Supply &amp; install', 'Site overhead', 'Recorded at closeout', 'Agreed 60/40',
                   'This acceptance record does not capture a project sharing percentage.',
                   'Split changed after last signed agreement.', 'Internal allocation — not a payout or amount owed.']) {
    ok(h.includes(s), 'detail missing: ' + s);
  }
  ok(!/<button[^>]*>(?!Close)/.test(h), 'only a Close button');
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node tests/pm-sharing.test.js`
Expected: G1–G4 FAIL (`D.csvCell is not a function`, …).

- [ ] **Step 3: Implement** — replace the stub `function renderDetail() {}` (and its anchor line) with:

```js
    // ── details panel (read-only: no control here creates any record) ──
    function open(id) { S.openId = id; renderDetail(); }
    function close() { S.openId = null; const el = document.getElementById('pmSharingDetail'); if (el) el.innerHTML = ''; }
    function renderDetail() {
        const el = document.getElementById('pmSharingDetail');
        const r = S.results.find(x => x.id === S.openId);
        if (!el || !r || !S.data) return;
        const p = P();
        const pp = S.data.perProject[r.id] || { bills: [], reqs: [] };
        const bd = (typeof _pmOvBreakdown === 'function') ? _pmOvBreakdown(pp.bills)
                 : { labor: 0, materials: 0, combined: 0, overhead: 0 };
        const rec = S.data.reserves[r.id];
        const hist = (S.data.read.history || []).filter(h => h.project_id === r.id);
        const facts = p.acceptanceFacts(r.partnerEmail, S.data.read.partners, hist.length ? hist[0].changed_at : null);
        const line = (k, v) => '<div class="pms-dl"><span>' + esc(k) + '</span><b>' + v + '</b></div>';
        el.innerHTML = '<div class="pms-detail"><div class="pms-detail-h"><h3>' + esc(labelFor(r, S.results)) + '</h3>'
            + '<button type="button" onclick="PMShareDash.close()">Close</button></div>'
            + '<div class="pms-note">Internal allocation — not a payout or amount owed.</div>'
            + '<h4>1. Collected</h4>' + line('Collected', p.pesos(r.paidCents))
            + pp.reqs.map(q => line((q.weekEndingDate || 'No date') + ' · ' + (q.status || ''),
                                    p.pesos(p.toCents(p.paid([q]))))).join('')
            + '<h4>2. Costs</h4>' + line('Labor', p.pesos(p.toCents(bd.labor))) + line('Pure materials', p.pesos(p.toCents(bd.materials)))
            + line('Supply & install', p.pesos(p.toCents(bd.combined))) + line('Site overhead', p.pesos(p.toCents(bd.overhead)))
            + line('Project costs', p.pesos(r.costCents))
            + '<h4>3. Remaining cash</h4>' + line('Collected − costs', p.pesos(r.remainingCents))
            + '<h4>4. Warranty reserve</h4>'
            + line(r.reserve.kind === 'recorded' ? 'Recorded at closeout' : 'Provisional · Reserve needs review', p.pesos(r.reserve.cents))
            + (rec ? line('Closeout basis', esc(rec.refNo || '') + ' · paid ' + p.pesos(p.toCents(rec.totalPaid)) + ' · cost ' + p.pesos(p.toCents(rec.directCost))) : '')
            + (r.reserve.changedSinceCloseout ? '<div class="pms-warn">Collections/costs changed since closeout.</div>' : '')
            + '<h4>5. Sharing</h4>' + line(r.balanceCents < 0 ? 'Shortfall' : 'Sharing balance', p.pesos(r.balanceCents))
            + line('You (' + p.fmtPct(r.ownerPct) + '%)', p.pesos(r.ownerCents))
            + line('Partner (' + p.fmtPct(r.partnerPct) + '%)', p.pesos(r.partnerCents))
            + '<h4>6. Client balance</h4>' + line('Outstanding', p.pesos(r.outstandingCents))
            + '<h4>7. Split history</h4>'
            + (hist.length ? hist.map(h => '<div class="pms-hist">' + esc(new Date(h.changed_at).toLocaleString('en-PH')) + ' · '
                  + esc(h.actor_email || '') + ' · partner ' + esc(p.fmtPct(h.old_pct)) + '% → ' + esc(p.fmtPct(h.new_pct)) + '% · '
                  + esc(h.reason) + '</div>').join('') : '<div class="pms-hist">No changes — the original setting.</div>')
            + '<h4>8. Partner acceptance</h4>' + facts.map(f => '<div class="pms-hist">' + esc(f) + '</div>').join('')
            + '</div>';
    }

    // ── print + CSV: built from the SAME model as the screen ───────────
    function metaLines() {
        const f = S.filters;
        const range = f.undatedOnly ? 'Undated only' : (f.from || f.to) ? (f.from || '…') + ' to ' + (f.to || '…') : 'All completion dates';
        const partner = f.partner === 'all' ? 'All partners' : f.partner === 'unassigned' ? 'Partner unassigned' : f.partner;
        return ['Profit Sharing — completed projects',
                'Internal allocation — not a payout or amount owed.',
                'As of,' + (S.asOf ? S.asOf.toLocaleString('en-PH') : ''),
                'Filters,' + [range, partner, f.q ? 'search "' + f.q + '"' : ''].filter(Boolean).join(' · '),
                'Basis,Remaining cash = collected − costs; sharing balance = remaining − recorded warranty reserve; split per project'];
    }
    function csvCell(v) {
        if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
        let s = String(v == null ? '' : v);
        if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
        return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }
    function toCsv(m, meta) {
        const peso = (c) => c / 100;
        const cols = ['Project', 'Client', 'Partner', 'Completed', 'Collected', 'Costs', 'Remaining cash', 'Warranty reserve',
                      'Reserve basis', 'Sharing balance', 'Your %', 'Your amount', 'Partner %', 'Partner amount', 'Client balance', 'Review'];
        const row = (r, provisional) => [labelFor(r, m.all), r.clientName, r.partnerEmail || 'Partner unassigned',
            r.completionKey || 'Undated', peso(r.paidCents), peso(r.costCents), peso(r.remainingCents), peso(r.reserve.cents),
            provisional ? 'Provisional — reserve needs review' : (r.reserve.kind === 'recorded' ? 'Recorded at closeout' : 'Estimate'),
            peso(r.balanceCents), r.ownerPct, peso(r.ownerCents), r.partnerPct, peso(r.partnerCents),
            peso(r.outstandingCents), chipsFor(r).join(' · ')];
        const t = m.totals;
        const lines = meta.map(l => l.split(',').length > 1
            ? csvCell(l.slice(0, l.indexOf(','))) + ',' + csvCell(l.slice(l.indexOf(',') + 1)) : csvCell(l));
        lines.push('');
        lines.push(cols.map(csvCell).join(','));
        m.rows.forEach(r => lines.push(row(r, false).map(csvCell).join(',')));
        m.review.forEach(r => lines.push(row(r, true).map(csvCell).join(',')));
        lines.push(['Totals (confirmed)', '', '', '', peso(t.paidCents), peso(t.costCents), peso(t.paidCents - t.costCents),
                    peso(t.reserveCents), '', peso(t.netCents), '', peso(t.ownerCents), '', peso(t.partnerCents),
                    peso(t.outstandingCents), t.reviewCount + ' with reserve needing review (not in totals)'].map(csvCell).join(','));
        return lines.join('\r\n');
    }
    function downloadCsv() {
        if (!canSee() || !S.data) return;
        const csv = toCsv(buildModel(S.results, S.filters), metaLines());
        const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
        const a = document.createElement('a');
        const d = new Date();
        a.href = URL.createObjectURL(blob);
        a.download = 'profit-sharing-' + d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') + '.csv';
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    }
    function print() {
        if (!canSee() || !S.data) return;
        const m = buildModel(S.results, S.filters), t = m.totals, p = P();
        const meta = metaLines();
        const tr = (r, prov) => '<tr><td>' + esc(labelFor(r, m.all)) + '</td><td>' + esc(r.partnerEmail || 'Partner unassigned') + '</td><td>'
            + esc(r.completionKey || 'Undated') + '</td><td>' + p.pesos(r.paidCents) + '</td><td>' + p.pesos(r.costCents) + '</td><td>'
            + p.pesos(r.reserve.cents) + (prov ? ' (Provisional)' : '') + '</td><td>' + p.pesos(r.balanceCents) + '</td><td>'
            + p.fmtPct(r.ownerPct) + '% ' + p.pesos(r.ownerCents) + '</td><td>' + p.fmtPct(r.partnerPct) + '% ' + p.pesos(r.partnerCents)
            + '</td><td>' + esc(chipsFor(r).join(' · ')) + '</td></tr>';
        const th = '<tr><th>Project</th><th>Partner</th><th>Completed</th><th>Collected</th><th>Costs</th><th>Reserve</th>'
                 + '<th>Sharing balance</th><th>You</th><th>Partner</th><th>Review</th></tr>';
        const w = window.open('', '_blank', 'width=1100,height=800');
        if (!w) return;
        w.document.write('<!DOCTYPE html><html><head><meta charset="utf-8"><title>Profit Sharing</title><style>'
            + 'body{font:12px Helvetica,Arial,sans-serif;margin:24px;color:#1f2420}h1{font-size:20px;margin:0}'
            + 'table{width:100%;border-collapse:collapse;margin-top:10px}th,td{border-bottom:1px solid #ddd;padding:5px;text-align:left}'
            + '.k{display:inline-block;margin:6px 14px 0 0}.k b{display:block;font-size:14px}</style></head><body>'
            + '<h1>Profit Sharing</h1><div>' + meta.map(l => esc(l.replace(',', ': '))).join('<br>') + '</div>'
            + '<div><span class="k">Projects<b>' + t.count + ' confirmed · ' + t.reviewCount + ' with reserve needing review</b></span>'
            + '<span class="k">Net sharing balance<b>' + p.pesos(t.netCents) + '</b></span>'
            + '<span class="k">Your allocation<b>' + p.pesos(t.ownerCents) + '</b></span>'
            + '<span class="k">Partner allocation<b>' + p.pesos(t.partnerCents) + '</b></span>'
            + '<span class="k">Cash shortfall<b>' + p.pesos(t.shortfallCents) + '</b></span></div>'
            + '<table><thead>' + th + '</thead><tbody>' + m.rows.map(r => tr(r, false)).join('') + '</tbody></table>'
            + (m.review.length ? '<h3>Reserve needs review — not in the totals above</h3><table><thead>' + th + '</thead><tbody>'
                + m.review.map(r => tr(r, true)).join('') + '</tbody></table>' : '')
            + '<script>window.onload=function(){window.print();}<\/script></body></html>');
        w.document.close();
    }
```

and replace `// @@DASH_EXPORTS@@` with:

```js
    Object.assign(window.PMShareDash, { open, close, renderDetail, csvCell, toCsv, metaLines, print, downloadCsv });
```

Add to the dashboard CSS block from Task 10:

```css
.pms-detail{margin-top:16px;border:1px solid #e5e7eb;border-radius:12px;padding:14px 16px;background:#fff;}
.pms-detail-h{display:flex;justify-content:space-between;align-items:center;} .pms-detail h4{font-size:12.5px;margin:12px 0 4px;}
.pms-dl{display:flex;justify-content:space-between;font-size:12.5px;padding:2px 0;} .pms-hist{font-size:12px;color:#4b5563;padding:2px 0;}
.pms-warn{font-size:12px;color:#9a6c12;margin-top:4px;}
```

- [ ] **Step 4: Run all tests**

Run: `node tests/pm-sharing.test.js && node --check js/pm-sharing-dashboard.js && npm test`
Expected: `51 passed`; all green. `grep -n "@@" js/pm-sharing.js js/pm-sharing-dashboard.js` prints nothing.

- [ ] **Step 5: Checkpoint** — diff summary; the user commits.

---

### Task 12: Live acceptance script and documentation

**Files:**
- Create: `supabase/tests/pm_sharing_acceptance.sql`
- Modify: `docs/DATABASE_SCHEMA.md`, `docs/ARCHITECTURE.md` (§4 module map), `docs/PROJECT_MANAGEMENT_MVP.md`, `CLAUDE.md` (money invariants), spec §12 (add F6), `supabase/migrations/README.md` (canonical order)

- [ ] **Step 1: Write the acceptance script** — `supabase/tests/pm_sharing_acceptance.sql`:

```sql
-- ════════════════════════════════════════════════════════════════════
-- 0098 PM profit sharing — live acceptance (RLS, grants, roles).
-- Self-wrapped in begin / rollback: nothing persists. Run through the
-- Supabase MCP execute_sql (not the SQL editor — see memory note on its
-- RLS step). Needs one active main owner, one owner-role account whose
-- owner_id points to it, and one active staff account of that owner.
-- Success ends with the row 'pm sharing acceptance: all checks passed'.
-- ════════════════════════════════════════════════════════════════════
begin;
set local statement_timeout = '60s';

select set_config('vpm.owner', (select id::text from profiles
  where role = 'owner' and owner_id is null and coalesce(status, 'active') = 'active' order by created_at limit 1), true);
select set_config('vpm.pmowner', (select id::text from profiles
  where role = 'owner' and owner_id::text = current_setting('vpm.owner') order by created_at limit 1), true);
select set_config('vpm.staff', (select id::text from profiles
  where role = 'staff' and owner_id::text = current_setting('vpm.owner') and coalesce(status, 'active') = 'active'
  order by created_at limit 1), true);
do $$ begin
  assert current_setting('vpm.owner', true) <> '' and current_setting('vpm.pmowner', true) <> ''
     and current_setting('vpm.staff', true) <> '', 'need a main owner, a focused owner and a staff account';
end $$;

-- 1. The owner creates a project: the trigger maps it.
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('vpm.owner'), 'role', 'authenticated')::text, true);
with ins as (insert into construction_projects (project_name, client_name, status)
             values ('ZZ pm sharing acceptance', 'ZZ client', 'active') returning id)
select set_config('vpm.proj', (select id::text from ins), true);
do $$ declare r jsonb; begin
  r := pm_sharing_read(array[current_setting('vpm.proj')::uuid]);
  assert jsonb_array_length(r->'projects') = 1, 'ACC-1 mapped on create';
  assert (r->>'can_edit')::boolean, 'ACC-1 owner can edit';
  r := pm_set_sharing(current_setting('vpm.proj')::uuid, 40, 0, 'acceptance');
  assert (r->>'changed')::boolean and (r->>'version')::int = 1, 'ACC-2 first save';
  r := pm_set_sharing(current_setting('vpm.proj')::uuid, 40, 1, '');
  assert not (r->>'changed')::boolean, 'ACC-3 same % no-op';
  begin perform pm_set_sharing(current_setting('vpm.proj')::uuid, 40.123, 1, 'x');
        raise exception 'ACC-4 40.123 accepted';
  exception when others then assert sqlerrm like '%BAD_PCT%', 'ACC-4 ' || sqlerrm; end;
  begin perform pm_set_sharing(current_setting('vpm.proj')::uuid, 30, 0, 'x');
        raise exception 'ACC-5 stale accepted';
  exception when others then assert sqlerrm like '%STALE%', 'ACC-5 ' || sqlerrm; end;
end $$;

-- 2. Direct table access is denied for signed-in users (even the owner).
do $$ begin
  begin perform 1 from pm_sharing_agreements limit 1; raise exception 'ACC-6 direct read allowed';
  exception when insufficient_privilege then null; end;
  begin update pm_sharing_changes set reason = 'x'; raise exception 'ACC-7 history update allowed';
  exception when insufficient_privilege then null; end;
  begin insert into pm_project_companies (project_id, company_owner_id, source)
        values (current_setting('vpm.proj')::uuid, auth.uid(), 'created'); raise exception 'ACC-8 mapping insert allowed';
  exception when insufficient_privilege then null; end;
end $$;

-- 3. Focused owner: reads, cannot write.
select set_config('request.jwt.claims', json_build_object('sub', current_setting('vpm.pmowner'), 'role', 'authenticated')::text, true);
do $$ declare r jsonb; begin
  r := pm_sharing_read(array[current_setting('vpm.proj')::uuid]);
  assert jsonb_array_length(r->'projects') = 1 and not (r->>'can_edit')::boolean, 'ACC-9 focused owner reads, view only';
  assert jsonb_array_length(r->'history') = 1, 'ACC-9 history visible';
  begin perform pm_set_sharing(current_setting('vpm.proj')::uuid, 30, 1, 'x'); raise exception 'ACC-10 focused write allowed';
  exception when others then assert sqlerrm like '%OWNER_ONLY%', 'ACC-10 ' || sqlerrm; end;
  perform wf_reserves_for(array[current_setting('vpm.proj')::uuid]);
end $$;

-- 4. Staff: no reads, no writes.
select set_config('request.jwt.claims', json_build_object('sub', current_setting('vpm.staff'), 'role', 'authenticated')::text, true);
do $$ begin
  begin perform pm_sharing_read(null); raise exception 'ACC-11 staff read allowed';
  exception when others then assert sqlerrm like '%OWNER_ONLY%', 'ACC-11 ' || sqlerrm; end;
  begin perform wf_reserves_for(array[current_setting('vpm.proj')::uuid]); raise exception 'ACC-12 staff reserve read allowed';
  exception when others then assert sqlerrm like '%OWNER_ONLY%', 'ACC-12 ' || sqlerrm; end;
  begin perform pm_set_sharing(current_setting('vpm.proj')::uuid, 30, 1, 'x'); raise exception 'ACC-13 staff write allowed';
  exception when others then assert sqlerrm like '%OWNER_ONLY%', 'ACC-13 ' || sqlerrm; end;
end $$;

-- 5. Owner reads the recorded reserves of real completed projects (if any).
select set_config('request.jwt.claims', json_build_object('sub', current_setting('vpm.owner'), 'role', 'authenticated')::text, true);
do $$ declare n int; m int; begin
  select count(*) into m from pm_sharing_read(null) x, jsonb_array_elements(x->'projects') e;
  select jsonb_array_length(wf_reserves_for(array(select (e->>'project_id')::uuid
           from jsonb_array_elements(pm_sharing_read(null)->'projects') e))) into n;
  raise notice 'mapped projects: %, reserves readable: %', m, n;
end $$;

select 'pm sharing acceptance: all checks passed' as result;
rollback;
```

- [ ] **Step 2: Docs**
  - `docs/DATABASE_SCHEMA.md`: add the three tables (columns, constraints, "RLS on, no policies, all privileges revoked; read via `pm_sharing_read`; write via `pm_set_sharing` main owner only"), the trigger `pm_map_new_project_trg` on `construction_projects`, and `wf_reserves_for`.
  - `docs/ARCHITECTURE.md` §4 module map: add `js/pm-sharing.js` (PMShare — PM sharing calculation, the only one) and `js/pm-sharing-dashboard.js` (PM → Profit Sharing, owner-role only).
  - `docs/PROJECT_MANAGEMENT_MVP.md`: a "Profit sharing" subsection with the formula, the recorded-reserve rule, the labels and who can edit.
  - `CLAUDE.md` → Money invariants, add after the Purchasing bullets:
    ```markdown
    - **PM profit sharing (0098) is an internal allocation outside the money model.** Sharing balance =
      PM remaining cash (paid − direct cost) − warranty reserve (recorded at closeout for completed
      projects; `max(0, 5%)` estimate otherwise), split per project by `pm_sharing_agreements.partner_pct`
      (no row = 50/50). Never a payout, amount owed, invoice or accounting entry, and never touches Project
      Control's Spent / Earned / Profit. Only `pm_set_sharing` changes a split — main owner only
      (role owner, `owner_id` null, active; **never** `allowed_modules`). History is append-only. Only
      `js/pm-sharing.js` computes it; warranty data reaches it only through `WF.reserveFor`. Owner-role
      only; staff never see it. Spec: `docs/superpowers/specs/2026-10-18-pm-profit-sharing-mvp-terms.md`.
    ```
  - Spec §12: add
    ```markdown
    - **F6 — Legacy direct-cost fallback omits overhead.** The ladder used by Overview, Reports and
      closeout (`directCostTotal` → `labor + materials` → `grandTotal − fee`) leaves out overhead at the
      middle step. 0 of 88 live bills use any fallback (18 Oct). Kept unchanged so closeout snapshots stay
      comparable; fix all three call sites together if a fallback bill ever appears.
    ```
    and update the spec status line to "Implementation plan: `docs/superpowers/plans/2026-10-18-pm-profit-sharing.md`."
  - `supabase/migrations/README.md`: add 0098 (and 0099 once written) to the canonical order.

- [ ] **Step 3: Verify**

Run: `npm test && npm run test:sql`
Expected: all suites green.

- [ ] **Step 4: Checkpoint** — diff summary; the user commits.

---

### Task 13: Live apply (with approval), mapping, browser verification

**Files:**
- Create (only after Task 0 Step 1 confirmation): `supabase/migrations/0099_pm_project_company_map.sql`

- [ ] **Step 1: Ask the user for approval** to apply 0098 live and to push the web code. Do not proceed without an explicit yes. Order: **0098 live → 0099 live → push web.** If the web goes out before the mappings, every project shows "Project not linked to a company — sharing locked" (safe, but confusing).

- [ ] **Step 1b: Pre-apply checks** (read-only, via `execute_sql`; all three before Step 2):

  1. Re-run the Task 0 Step 2 trust-gate queries and confirm the results are unchanged.
  2. Company-link check. Expected: **every row resolves `OK`**.

```sql
select p.id, p.email, p.role, p.owner_id, coalesce(p.status,'active') status,
  case when p.owner_id is null then (case when p.role='owner' then 'OK' else 'BAD_COMPANY_LINK' end)
       when m.id is null or m.role is distinct from 'owner' or m.owner_id is not null
            or coalesce(m.status,'active')<>'active' then 'BAD_COMPANY_LINK' else 'OK' end resolves
from profiles p left join profiles m on m.id = p.owner_id
where p.role in ('owner','staff') and coalesce(p.status,'active')='active';
```

  3. Keep this rollback ready in case the acceptance script (Step 3) fails:

```sql
drop trigger if exists pm_map_new_project_trg on construction_projects;
```

- [ ] **Step 2: Apply 0098** with the Supabase MCP `apply_migration` (name `0098_pm_profit_sharing`, the file contents verbatim). Then verify it is really there (memory: user-applied migrations have not matched the live DB before):

```sql
select proname from pg_proc where proname in ('pm_set_sharing','pm_sharing_read','wf_reserves_for','pm_caller_company','pm_map_new_project') order by 1;
select tgname from pg_trigger where tgname in ('pm_map_new_project_trg','pm_sharing_changes_immutable_trg');
select relname, relrowsecurity from pg_class where relname in ('pm_project_companies','pm_sharing_agreements','pm_sharing_changes');
```

Expected: 5 functions, 2 triggers, 3 tables with `relrowsecurity = true`.

- [ ] **Step 3: Run the acceptance script** via MCP `execute_sql` (whole file). Expected final row: `pm sharing acceptance: all checks passed`.

- [ ] **Step 4: Write 0099** — only with the owner's Task 0 confirmation in hand.

  **Before writing 0099, re-query ALL `construction_projects` that are not yet in `pm_project_companies`** (not just the six from 18 Oct) and have the owner confirm each one. After 0099 is applied, `select id from construction_projects where id not in (select project_id from pm_project_companies);` must return only projects the owner deliberately left unmapped. Fill in the date and the owner's confirmation text; include **only** the ids they confirmed:

```sql
-- ════════════════════════════════════════════════════════════════════
-- 0099 — Map the existing PM projects to the main owner's company.
-- Owner verification: <YYYY-MM-DD>, "<owner's confirmation, verbatim>".
-- Explicit ids only — never "all projects". Fails loudly if an id is
-- missing, there is not exactly one active main owner, or an id is
-- already mapped to another company. Rows record source owner_verified.
-- ════════════════════════════════════════════════════════════════════
do $$
declare
  v_ids   uuid[] := array[
    '6236abf5-4f32-4bee-a0d0-8aa738a6a5b0',  -- Los Churreros (completed 2026-08-02, WR-2026-0001)
    '4b22ede3-180f-415b-b793-9998d34e0aec',  -- Los Churreros (completed 2026-08-02, WR-2026-0002)
    '732f858e-603d-477e-b88f-3049ca421bea',  -- Los Churreros System Plus
    '49426a37-cca0-4eba-ba5f-e6bb48729872',  -- Los Churreros Crossroad
    'f18d349b-133e-4908-9bdc-30c2741fbfca',  -- Los Churreros Baliuag
    'a62714db-fa03-47c9-81ef-6067f4adf6e5'   -- Los Churreros SM North Dining Extention
  ]::uuid[];
  v_owner uuid;
  v_n     int;
begin
  select count(*) into v_n from profiles
   where role = 'owner' and owner_id is null and coalesce(status, 'active') = 'active';
  if v_n <> 1 then raise exception 'expected exactly one active main owner, found %', v_n; end if;
  select id into v_owner from profiles
   where role = 'owner' and owner_id is null and coalesce(status, 'active') = 'active';

  select count(*) into v_n from construction_projects where id = any(v_ids);
  if v_n <> array_length(v_ids, 1) then raise exception 'a verified project id is missing (% of %)', v_n, array_length(v_ids, 1); end if;

  if exists (select 1 from pm_project_companies where project_id = any(v_ids) and company_owner_id <> v_owner) then
    raise exception 'a verified project is already mapped to another company';
  end if;

  insert into pm_project_companies (project_id, company_owner_id, mapped_by, source)
  select unnest(v_ids), v_owner, v_owner, 'owner_verified'
  on conflict (project_id) do nothing;
end $$;
```

Apply it with `apply_migration` (name `0099_pm_project_company_map`), then verify:

```sql
select source, count(*) from pm_project_companies group by source;
```

Expected: `owner_verified | 6` (or the confirmed count).

- [ ] **Step 5: Push the web code** (the user pushes; the agent only reports readiness).

- [ ] **Step 6: Browser checks** (`admin.html`). Record pass/fail for each:
  1. **Owner:** open a completed Los Churreros project's Overview. The reserve card shows the recorded amount and "Recorded at closeout". The sharing card shows the balance and "You … (50%) · Partner … (50%)" with "Internal allocation — not a payout." Change the week range: neither card changes. Print: same figures.
  2. **Owner:** edit that project, set Partner share 40, enter a reason, save. Toast "Project saved". Reopen: 60/40 with a history row. Overview updates. Re-save at 40: no new history row.
  3. **Owner:** Reports → All Projects: per-project combined split, with notes for estimates. Print matches.
  4. **Owner:** Project Management → Profit Sharing: two completed projects, cards add up to the table, chart, filters (Partner unassigned, Undated only, date range, search), details panel, Print/PDF, CSV opens cleanly in a spreadsheet with negative amounts as numbers.
  5. **admin-pm@:** Profit Sharing opens. The project form shows the split read-only ("View only — only the main owner can change the split.").
  6. **Staff:** no Profit Sharing nav item. Going to `#pmSharing` (or calling `switchView('pmSharing')` in the console) bounces to Projects. The project form has no Financial agreement section, and the fee field still works. Overview has no Warranty reserve or Sharing card. (The other Overview amounts staff already see are finding F2, unchanged.)
  7. Query `client_errors` for new errors: `select at, page, kind, message from client_errors where at > now() - interval '1 hour' order by at desc;`

- [ ] **Step 7: Final checkpoint** — report results: tests, acceptance script, browser checks, and any failures with evidence. The user commits.

---

## Self-review notes (spec → task)

| Spec | Task |
|---|---|
| §2 authority, main owner, active, company link | 1, 2, 3 (T1.4, T2.7, T3.3), 12 (ACC-10/11/13) |
| §4.1 mapping, trigger, gate, no mapping from set_sharing | 0, 1, 2 (T2.8), 13 |
| §4.2–4.3 tables, default 50, history no FK + snapshot, immutable | 1 (T1.6/T1.7), 3 (T3.1) |
| §4.4 order, project lock, raw precision, stale, no-op, reason | 2, 4 |
| §4.5 reads, WF.reserveFor, rounding on read, acceptance facts | 3, 6 |
| §4.6 six ids verified first | 0, 13 |
| §5 calculation, rounding, reserve table, needs-review definition, shortfalls | 5 |
| §6.1 form, linked fields, reason, view-only, staff not rendered, partial save, no rebill | 9 |
| §6.2 four sites, per-project Reports, labels, floor note | 7, 8 |
| §7 dashboard placement, loading order, stale, errors, filters, cards, table, chips, chart, details, print, CSV | 10, 11 |
| §8 acceptance facts wording | 6 (B4), 11 (G4) |
| §9 permissions | 3, 7 (C4), 8 (D6), 9 (E8), 10 (F7/F8), 12, 13 |
| §11 tests | 1–12 |
| §12 findings (F6 added) | 12 |
