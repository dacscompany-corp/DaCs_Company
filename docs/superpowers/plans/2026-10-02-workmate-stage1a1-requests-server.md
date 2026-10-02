# WorkMate Stage 1a-1 — Requests Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One migration (0085) gives DAC'S WorkMate a safe server for material/tool requests — teams, a catalogue, *Allow requests*, weekly batches with a Saturday-noon Manila cutoff, requests with stable line identities, quantity portions by batch, history and conflicts, retry-safe worker RPCs, private request photos — and locks the legacy `requests`/`request_items` tables to own-read-only for workers.

**Architecture:** Workers never touch the new `pr_*` tables directly: every worker read and write goes through `SECURITY DEFINER` RPCs that check eligibility, team leadership and ownership on the server and record an idempotency result per operation id (`pr_ops`), so a retried offline send returns the first answer instead of acting twice. Owner/staff read the tables through RLS (Dacs Web, plan 1a-2). Quantities live in **portions** (one per batch), so an increase after cutoff never moves what was already arranged, and a decrease removes the newest unarranged quantity first and only *flags* arranged quantity for the office.

**Tech Stack:** Supabase Postgres (SQL migration, plpgsql), Supabase Storage policies, Node (zero-dependency static tests, as `tests/storage-access.test.js`), a live verification script run inside a rolled-back transaction (as `supabase/tests/attendance_checks.sql`).

**Spec:** `docs/superpowers/specs/2026-09-29-unified-worker-app-design.md` (§3, §4A, §4B, §4E, §6 row 1a, §9) and `docs/superpowers/plans/2026-10-02-workmate-stage1a-roadmap.md` (decisions table).

## Global Constraints

- **Repo:** `C:\Users\John Aerol Tapales\Documents\Dacs Web`. All paths are relative to it.
- **NEVER `git commit` / `git push`.** The user commits. Every task ends "Stop — no commit".
- **Migration number 0085** (`supabase/migrations/0084_appointments_booking_details.sql` is the highest on disk; the README's "next = 0084" line is stale and is corrected in Task 7). Never reuse a number. **Never apply anything to the live database from a task** — the controller dry-runs it in a rolled-back transaction and the **user applies** it (Task 8).
- **Idempotent DDL:** `create table if not exists`, `create index if not exists`, `create or replace function`, `drop policy if exists` before every `create policy`. The file must apply cleanly twice.
- **Project Control only:** every destination is a `folders` row. Main Contract = the top-level project folder itself; an Additional Works job = a child folder (`parent_folder_id` = the project). PM (`construction_projects`) is never a destination — not even by passing its id.
- **Completed blocks new demand:** a project with `completed_at`, or an Additional Works child with `completed_at`, refuses new requests and quantity *increases*; decreases, cancels and reading stay allowed.
- **Weekly batch:** the cutoff is **Saturday 12:00 noon Asia/Manila**, by the **server's received time**; a request received at/after the cutoff joins the next week. Default purchasing = the Monday after the cutoff (cutoff date + 2), delivery = the Wednesday after (cutoff date + 4).
- **No money:** no `pr_*` column may hold a price, amount, cost or total.
- **Workers reach `pr_*` only through RPCs:** RLS is enabled on every `pr_*` table and **no `pr_*` policy grants anything to workers**. Owner/staff policies: `select` on all `pr_*` tables; `insert/update` only on setup tables (`pr_teams`, `pr_team_members`, `pr_catalog_items`, `pr_project_settings`, `pr_batches`). Request data changes only through RPCs.
- **Who requests:** profile role `worker` or `teamLeader`, status active (`coalesce(status,'active') = 'active'`). Owner scope = `attendance_data_owner()` (= `coalesce(profiles.owner_id, profiles.id)` of the caller).
- **Team rules:** a team request needs the caller to be a current member; naming an intended member other than yourself needs the caller to be that team's **current leader** (team-member row with `is_leader`, not removed, team active, **and** profile role `teamLeader`). One current leader per team. Tool lines carry no intended member.
- **Retry rule:** every worker write takes a client-generated `p_op uuid`; the first result is stored in `pr_ops (actor_id, op_id)` and returned verbatim on retry.
- **Every `SECURITY DEFINER` function** has `set search_path = public`. Worker RPCs are `grant execute ... to authenticated`; internal helpers are `revoke all ... from public, anon, authenticated` and never granted.
- **Error codes** are raised as `raise exception '<CODE>' using errcode = 'P0001'` with exactly these codes: `NOT_A_REQUESTER`, `BAD_OPERATION`, `DESTINATION_CLOSED`, `NOT_IN_TEAM`, `NOT_TEAM_LEADER`, `BAD_MEMBER`, `BAD_CATALOG_ITEM`, `NO_LINES`, `TOO_MANY_LINES`, `BAD_LINE`, `BAD_QUANTITY`, `URGENT_NEEDS_REASON`, `NOT_YOUR_LINE`, `NOT_YOUR_REQUEST`, `LINE_CLOSED`, `BAD_PATH`, `PHOTO_NOT_UPLOADED`.
- **Legacy tables:** `requests` / `request_items` stay as read-only history: owner/staff keep full access; a worker may read **only their own** rows and write nothing.
- **Photos:** private bucket **`request-photos`** (JPEG, 5 MB), object path `{requester_uid}/{request_id}/{photo_id}.jpg`. Readable by the requester, the request team's current leader, and owner/staff only.
- **Tests:** `node tests/workmate-requests.test.js` (static, added to `npm test`) + `supabase/tests/0085_verify.sql` (live, rolled back). `npm test` must stay green (`node --check` style syntax is not applicable to SQL).
- **Line endings LF**; every file ends with one newline.

---

## File map

| File | Task | Responsibility |
|---|---|---|
| `supabase/migrations/0085_workmate_requests.sql` | 1–6 | The whole server change, in numbered sections §1–§11 |
| `tests/workmate-requests.test.js` | 1–6 | Static guards on the migration text |
| `package.json` | 1 | Add the new test to `npm test` |
| `supabase/tests/0085_verify.sql` | 8 | Live behaviour checks (rolled back) |
| `docs/DATABASE_SCHEMA.md`, `supabase/migrations/README.md`, `docs/ARCHITECTURE.md` | 7 | Documentation |

---

### Task 1: Setup tables — teams, catalogue, *Allow requests*, batches (§1–§5)

**Files:**
- Create: `supabase/migrations/0085_workmate_requests.sql`
- Create: `tests/workmate-requests.test.js`
- Modify: `package.json` (`scripts.test`)

**Interfaces:**
- Produces (SQL): `pr_is_requester() → boolean`; tables `pr_teams`, `pr_team_members`, `pr_catalog_items`, `pr_project_settings`, `pr_batches`; `pr_is_current_member(p_team uuid, p_user uuid) → boolean`; `pr_is_current_leader(p_team uuid, p_user uuid) → boolean`; `pr_project_open(p_folder uuid) → boolean`; `pr_work_open(p_folder uuid, p_work uuid) → boolean`; `pr_cutoff_after(p_at timestamptz) → timestamptz`; `pr_batch_for(p_owner uuid, p_at timestamptz) → uuid`; `pr_person_name(p_id uuid) → text`.
- Produces (test file): the harness `test(name, fn)`, constants `SQL` (raw text) and `CODE` (text with `--` comments stripped), and helpers `tableBlock(name)`, `fnBlock(name)`; later tasks add tests above the line `// ── SUMMARY (keep last) ──`.

- [ ] **Step 1: Write the failing static test** — create `tests/workmate-requests.test.js`:

```js
// ════════════════════════════════════════════════════════════════════
// WORKMATE REQUESTS (0085) STATIC TESTS: run with  node tests/workmate-requests.test.js
//
// Zero dependencies. Guards the shape of migration 0085:
//   - every pr_* table has RLS and NO policy that lets a worker in
//     (workers reach requests only through SECURITY DEFINER RPCs);
//   - no pr_* column can hold money;
//   - every SECURITY DEFINER function pins its search_path;
//   - worker RPCs are granted, internal helpers are not;
//   - the legacy requests tables are own-read-only for workers.
// The LIVE behaviour is checked by supabase/tests/0085_verify.sql.
// ════════════════════════════════════════════════════════════════════
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const MIGRATION = path.join(ROOT, 'supabase/migrations/0085_workmate_requests.sql');

let passed = 0, failed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { failed++; failures.push(name + ' — ' + e.message); console.log('  FAIL ' + name + '\n       ' + e.message); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }

const SQL = fs.existsSync(MIGRATION) ? fs.readFileSync(MIGRATION, 'utf8') : '';
const CODE = SQL.replace(/--.*$/gm, '');

/** The `create table if not exists <name> ( ... );` statement, or ''. */
function tableBlock(name) {
  const m = CODE.match(new RegExp('create table if not exists ' + name + '\\s*\\(([\\s\\S]*?)\\n\\);', 'i'));
  return m ? m[1] : '';
}
/** The `create or replace function <name>(...` ... `$$;` statement, or ''. */
function fnBlock(name) {
  const m = CODE.match(new RegExp('create or replace function ' + name + '\\s*\\([\\s\\S]*?\\$\\$;', 'i'));
  return m ? m[0] : '';
}
const PR_TABLES = () => [...CODE.matchAll(/create table if not exists (pr_\w+)/gi)].map(m => m[1]);

console.log('\nworkmate-requests (0085)');

test('the migration exists', () => assert(SQL.length > 0, 'missing ' + MIGRATION));

test('setup tables exist', () => {
  for (const t of ['pr_teams', 'pr_team_members', 'pr_catalog_items', 'pr_project_settings', 'pr_batches']) {
    assert(tableBlock(t), 'no table ' + t);
  }
});

test('every pr_* table has row level security', () => {
  for (const t of PR_TABLES()) {
    assert(new RegExp('alter table ' + t + ' enable row level security', 'i').test(CODE), t + ' has no RLS');
  }
});

test('no pr_* policy lets a worker in', () => {
  const policies = [...CODE.matchAll(/create policy[\s\S]*?;/gi)].map(m => m[0]).filter(p => /\bon\s+(public\.)?pr_\w+/i.test(p));
  assert(policies.length > 0, 'no pr_* policies found');
  for (const p of policies) {
    assert(!/is_worker\(|pr_is_requester\(|auth\.uid\(\)/i.test(p), 'worker-reachable policy: ' + p.slice(0, 120));
  }
});

test('no pr_* column can hold money', () => {
  for (const t of PR_TABLES()) {
    const cols = tableBlock(t).split('\n').map(l => l.trim().split(/\s+/)[0].toLowerCase());
    for (const c of cols) assert(!/price|amount|cost|total|peso/.test(c), t + '.' + c + ' looks like money');
  }
});

test('every SECURITY DEFINER function pins search_path', () => {
  const fns = [...CODE.matchAll(/create or replace function[\s\S]*?\$\$;/gi)].map(m => m[0]);
  for (const f of fns.filter(f => /security definer/i.test(f))) {
    assert(/set search_path = public/i.test(f), 'no search_path: ' + f.slice(0, 80));
  }
});

test('one current leader per team', () => {
  assert(/create unique index if not exists pr_team_one_leader on pr_team_members\s*\(team_id\)\s*where is_leader and removed_at is null/i.test(CODE),
    'missing the one-leader index');
});

test('a leader is named on the team AND holds the teamLeader role', () => {
  const f = fnBlock('pr_is_current_leader');
  assert(/is_leader/.test(f) && /removed_at is null/.test(f) && /'teamLeader'/.test(f) && /t\.active/.test(f), 'leader rule incomplete');
});

test('the cutoff is Saturday 12:00 noon, Manila time', () => {
  const f = fnBlock('pr_cutoff_after');
  assert(/'Asia\/Manila'/.test(f), 'not Manila time');
  assert(/isodow/.test(f) && /\b6\b/.test(f), 'not Saturday (isodow 6)');
  assert(/time '12:00'/.test(f), 'not 12:00 noon');
});

test('batches default to Monday purchasing and Wednesday delivery', () => {
  const f = fnBlock('pr_batch_for');
  assert(/v_day \+ 2/.test(f) && /v_day \+ 4/.test(f), 'purchase/delivery offsets are not +2/+4');
});

test('requestable projects are top-level, open Project Control folders', () => {
  const f = fnBlock('pr_project_open');
  assert(/from folders f/.test(f) && /parent_folder_id is null/.test(f) && /completed_at is null/.test(f), 'project rule incomplete');
  assert(/attendance_data_owner\(\)/.test(f), 'not owner-scoped');
  assert(!/construction_projects/.test(f), 'PM must never be a destination');
});

// ── SUMMARY (keep last) ──
console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) { console.log('\nFAILURES:\n  ' + failures.join('\n  ')); process.exit(1); }
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node tests/workmate-requests.test.js`
Expected: FAIL — `the migration exists — missing …0085_workmate_requests.sql`, exit code 1.

- [ ] **Step 3: Write sections §1–§5 of the migration** — create `supabase/migrations/0085_workmate_requests.sql`:

```sql
-- 0085 — WorkMate Requests, Stage 1a-1: the server for material/tool requests.
--
-- ── WHAT. Workers and team leaders request materials and tools from DAC'S
--    WorkMate; admin/staff process them in Dacs Web (plan 1a-2). This file
--    adds the data, the rules and the worker RPCs. Spec:
--    docs/superpowers/specs/2026-09-29-unified-worker-app-design.md §4A/§4B/§4E.
--
-- ── WORKERS NEVER TOUCH pr_* TABLES DIRECTLY. RLS is on everywhere and no
--    pr_* policy grants a worker anything: every worker read/write is a
--    SECURITY DEFINER RPC that checks the destination, the team and the
--    owner on the server. Hiding a button in the app is not a permission.
--
-- ── NO MONEY. No pr_* column holds a price, amount or cost (spec §2:
--    workers and leaders never see procurement amounts). Purchasing and
--    costs arrive with Stage 2/4 in their own tables.
--
-- ── RETRY-SAFE. Every worker write carries a client-made operation id; the
--    first result is stored in pr_ops and returned verbatim on retry, so an
--    offline phone re-sending never doubles a request or re-batches it.
--
-- ── PROJECT CONTROL ONLY. Destinations are folders: Main Contract = the
--    project folder, Additional Works = a child folder. PM is never one.
--
-- Outside the money model: nothing here feeds Spent / Earned / Profit.

-- ════ §1 Who may request ═══════════════════════════════════════════════

create or replace function pr_is_requester() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles p
     where p.id = auth.uid()
       and p.role in ('worker', 'teamLeader')
       and coalesce(p.status, 'active') = 'active')
$$;

-- "Juan dela Cruz", or "W-0042" when no name was entered. Never an email or
-- phone number: colleagues' contact details are not shared (spec §4G).
create or replace function pr_person_name(p_id uuid) returns text
language sql stable security definer set search_path = public as $$
  select coalesce(nullif(btrim(p.display_name), ''),
                  case when p.worker_no is null then null else 'W-' || lpad(p.worker_no::text, 4, '0') end,
                  'Worker')
    from profiles p where p.id = p_id
$$;

-- ════ §2 Teams ═════════════════════════════════════════════════════════

create table if not exists pr_teams (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references profiles(id),
  name text not null check (btrim(name) <> ''),
  active boolean not null default true,
  created_by uuid references profiles(id) default auth.uid(),
  created_at timestamptz not null default now()
);
create unique index if not exists pr_teams_owner_name on pr_teams (owner_id, lower(btrim(name))) where active;
alter table pr_teams enable row level security;

-- Membership history is kept: removing someone sets removed_at, so an old
-- request still shows who was on the team when it was made.
create table if not exists pr_team_members (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references profiles(id),
  team_id uuid not null references pr_teams(id),
  worker_id uuid not null references profiles(id),
  is_leader boolean not null default false,
  added_at timestamptz not null default now(),
  removed_at timestamptz,
  check (removed_at is null or removed_at >= added_at)
);
create unique index if not exists pr_team_members_current on pr_team_members (team_id, worker_id) where removed_at is null;
create unique index if not exists pr_team_one_leader on pr_team_members (team_id) where is_leader and removed_at is null;
alter table pr_team_members enable row level security;

create or replace function pr_is_current_member(p_team uuid, p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from pr_team_members m join pr_teams t on t.id = m.team_id
     where m.team_id = p_team and m.worker_id = p_user
       and m.removed_at is null and t.active)
$$;

-- Acting for a team needs BOTH the teamLeader role and the current leader
-- assignment to THAT team (spec §3). The role alone grants nothing.
create or replace function pr_is_current_leader(p_team uuid, p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
      from pr_team_members m
      join pr_teams t on t.id = m.team_id
      join profiles p on p.id = m.worker_id
     where m.team_id = p_team and m.worker_id = p_user
       and m.is_leader and m.removed_at is null and t.active
       and p.role = 'teamLeader' and coalesce(p.status, 'active') = 'active')
$$;

-- ════ §3 The item catalogue ════════════════════════════════════════════

-- One row = one defined item: "PVC pipe | 1/2 in, 3 m | piece". Different
-- sizes or units are different rows; the same identity cannot be added twice.
create table if not exists pr_catalog_items (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references profiles(id),
  kind text not null check (kind in ('material', 'tool')),
  name text not null check (btrim(name) <> ''),
  spec text not null default '',
  unit text not null check (btrim(unit) <> ''),
  category text not null default '',
  active boolean not null default true,
  created_by uuid references profiles(id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists pr_catalog_identity
  on pr_catalog_items (owner_id, kind, lower(btrim(name)), lower(btrim(spec)), lower(btrim(unit))) where active;
alter table pr_catalog_items enable row level security;

-- ════ §4 Which projects accept requests ════════════════════════════════

-- "Allow requests": admin/staff open an upcoming Project Control project to
-- requests before it has a geofence or Time In (spec §3). Separate from the
-- Attendance "Hide from workers" switch on purpose.
create table if not exists pr_project_settings (
  folder_id uuid primary key references folders(id),
  owner_id uuid not null references profiles(id),
  allow_requests boolean not null default false,
  updated_by uuid references profiles(id) default auth.uid(),
  updated_at timestamptz not null default now()
);
alter table pr_project_settings enable row level security;

-- A top-level Project Control project the caller's company may request for
-- now: named, not completed, and either explicitly allowed or ready for
-- attendance by its geofence rule. Attendance's HIDDEN flag is deliberately
-- not consulted: hiding a site from Time In must not switch off requests.
create or replace function pr_project_open(p_folder uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from folders f
     where f.id = p_folder
       and f.owner_id = attendance_data_owner()
       and f.parent_folder_id is null
       and f.completed_at is null
       and coalesce(btrim(f.name), '') <> ''
       and (
         exists (select 1 from pr_project_settings s where s.folder_id = f.id and s.allow_requests)
         or not coalesce((select a.require_geofence from attendance_config a where a.owner_id = f.owner_id), false)
         or exists (select 1 from attendance_project_geofence g
                     where g.project_system = 'pc' and g.folder_id = f.id
                       and g.owner_id = f.owner_id and g.enabled)))
$$;

-- The work a request is for: the project itself (Main Contract) or one of
-- its own open Additional Works children. Both records are checked: an open
-- child never rescues a completed parent, and vice versa (spec §3).
create or replace function pr_work_open(p_folder uuid, p_work uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select pr_project_open(p_folder)
     and (p_work = p_folder
          or exists (select 1 from folders c
                      where c.id = p_work and c.parent_folder_id = p_folder
                        and c.completed_at is null and coalesce(btrim(c.name), '') <> ''))
$$;

-- ════ §5 Weekly batches ════════════════════════════════════════════════

-- One row per weekly cutoff. Admin/staff may move purchase_on / delivery_on
-- (holidays, supplier delays); workers see the updated dates.
create table if not exists pr_batches (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references profiles(id),
  cutoff_at timestamptz not null,
  purchase_on date not null,
  delivery_on date not null,
  updated_by uuid references profiles(id),
  updated_at timestamptz not null default now(),
  unique (owner_id, cutoff_at)
);
alter table pr_batches enable row level security;

-- The first Saturday 12:00 noon (Asia/Manila) strictly AFTER p_at. A request
-- received at exactly 12:00 Saturday has missed that week's cutoff.
create or replace function pr_cutoff_after(p_at timestamptz) returns timestamptz
language sql stable set search_path = public as $$
  with l as (select (p_at at time zone 'Asia/Manila') as t),
       c as (select t, (t::date + ((6 - extract(isodow from t)::int + 7) % 7)) + time '12:00' as cand from l)
  select (case when cand > t then cand else cand + interval '7 days' end) at time zone 'Asia/Manila' from c
$$;

-- The batch for something received at p_at, created on first use with the
-- default Monday purchasing / Wednesday delivery.
create or replace function pr_batch_for(p_owner uuid, p_at timestamptz) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_cut timestamptz := pr_cutoff_after(p_at);
  v_day date := (pr_cutoff_after(p_at) at time zone 'Asia/Manila')::date;  -- the Saturday
  v_id uuid;
begin
  insert into pr_batches (owner_id, cutoff_at, purchase_on, delivery_on)
  values (p_owner, v_cut, v_day + 2, v_day + 4)
  on conflict (owner_id, cutoff_at) do nothing;
  select id into v_id from pr_batches where owner_id = p_owner and cutoff_at = v_cut;
  return v_id;
end;
$$;

-- ════ Setup-table policies: owner/staff manage, workers have none ═══════

drop policy if exists pr_teams_admin on pr_teams;
create policy pr_teams_admin on pr_teams for all to authenticated
  using (is_owner() or is_staff()) with check (is_owner() or is_staff());
drop policy if exists pr_team_members_admin on pr_team_members;
create policy pr_team_members_admin on pr_team_members for all to authenticated
  using (is_owner() or is_staff()) with check (is_owner() or is_staff());
drop policy if exists pr_catalog_items_admin on pr_catalog_items;
create policy pr_catalog_items_admin on pr_catalog_items for all to authenticated
  using (is_owner() or is_staff()) with check (is_owner() or is_staff());
drop policy if exists pr_project_settings_admin on pr_project_settings;
create policy pr_project_settings_admin on pr_project_settings for all to authenticated
  using (is_owner() or is_staff()) with check (is_owner() or is_staff());
drop policy if exists pr_batches_admin on pr_batches;
create policy pr_batches_admin on pr_batches for all to authenticated
  using (is_owner() or is_staff()) with check (is_owner() or is_staff());
```

- [ ] **Step 4: Add the test to `npm test`** — in `package.json`, append ` && node tests/workmate-requests.test.js` to the end of the `"test"` script string (after `node tests/booking.test.js`).

- [ ] **Step 5: Run it to verify it passes**

Run: `node tests/workmate-requests.test.js` → all `ok`, `11 passed, 0 failed`. Then `npm test` → every suite passes.

- [ ] **Step 6: Stop — no commit.**

---
### Task 2: Request tables (§6)

**Files:**
- Modify: `supabase/migrations/0085_workmate_requests.sql` (append §6)
- Modify: `tests/workmate-requests.test.js` (add tests above `// ── SUMMARY (keep last) ──`)

**Interfaces:**
- Consumes: Task 1 tables (`pr_teams`, `pr_catalog_items`, `pr_batches`) and `folders`, `profiles`.
- Produces: tables `pr_requests`, `pr_lines`, `pr_line_portions`, `pr_line_conflicts`, `pr_events`, `pr_ops`, `pr_photos` (columns exactly as below — later tasks and plans 1a-2/1a-3 read them by these names).

- [ ] **Step 1: Write the failing tests** — add above the SUMMARY marker:

```js
test('request tables exist', () => {
  for (const t of ['pr_requests', 'pr_lines', 'pr_line_portions', 'pr_line_conflicts', 'pr_events', 'pr_ops', 'pr_photos']) {
    assert(tableBlock(t), 'no table ' + t);
  }
});

test('a retried submit cannot create a second request', () => {
  assert(/unique \(requester_id, client_op_id\)/i.test(tableBlock('pr_requests')), 'pr_requests needs unique (requester_id, client_op_id)');
  assert(/primary key \(actor_id, op_id\)/i.test(tableBlock('pr_ops')), 'pr_ops needs primary key (actor_id, op_id)');
});

test('an urgent line must carry a reason and a needed-by date', () => {
  assert(/check \(not urgent or \(btrim\(coalesce\(urgent_reason, ''\)\) <> '' and needed_by is not null\)\)/i.test(tableBlock('pr_lines')),
    'pr_lines urgent check missing');
});

test('a portion can never flag more than it holds', () => {
  assert(/pending_reduction numeric\(12,3\) not null default 0 check \(pending_reduction >= 0 and pending_reduction <= quantity\)/i.test(tableBlock('pr_line_portions')),
    'pending_reduction bounds missing');
});

test('request data is read-only to the office through RLS (changes go through RPCs)', () => {
  for (const t of ['pr_requests', 'pr_lines', 'pr_line_portions', 'pr_line_conflicts', 'pr_events', 'pr_ops', 'pr_photos']) {
    const pols = [...CODE.matchAll(new RegExp('create policy \\w+ on ' + t + '\\b[\\s\\S]*?;', 'gi'))].map(m => m[0]);
    assert(pols.length === 1, t + ' should have exactly one policy, found ' + pols.length);
    assert(/for select/i.test(pols[0]) && /is_owner\(\) or is_staff\(\)/i.test(pols[0]), t + ' policy must be owner/staff SELECT only');
  }
});
```

- [ ] **Step 2: Run to verify they fail** — `node tests/workmate-requests.test.js` → the five new tests FAIL (`no table pr_requests`, …).

- [ ] **Step 3: Append §6 to the migration**

```sql
-- ════ §6 Requests, lines, portions, history ═══════════════════════════

-- One request = one destination (project + Main Contract or one Additional
-- Works job) and at most one team. Items are its lines.
create table if not exists pr_requests (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references profiles(id),
  requester_id uuid not null references profiles(id),
  team_id uuid references pr_teams(id),
  folder_id uuid not null references folders(id),
  work_folder_id uuid not null references folders(id),
  client_op_id uuid not null,
  drafted_at timestamptz,
  received_at timestamptz not null default now(),
  note text not null default '',
  status text not null default 'submitted' check (status in ('submitted', 'cancelled')),
  cancelled_at timestamptz,
  unique (requester_id, client_op_id)
);
create index if not exists pr_requests_owner_received on pr_requests (owner_id, received_at desc);
create index if not exists pr_requests_team on pr_requests (team_id) where team_id is not null;
alter table pr_requests enable row level security;

-- A line keeps its id forever (never delete-and-reinsert, spec §10). Its
-- quantity lives in pr_line_portions; `version` rises on every change and
-- is how an offline edit made against an old version is caught.
create table if not exists pr_lines (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references profiles(id),
  request_id uuid not null references pr_requests(id),
  position int not null check (position >= 0),
  kind text not null check (kind in ('material', 'tool')),
  catalog_item_id uuid references pr_catalog_items(id),
  description text not null check (btrim(description) <> ''),
  spec text not null default '',
  unit text not null check (btrim(unit) <> ''),
  category text not null default '',
  intended_member_id uuid references profiles(id),
  urgent boolean not null default false,
  urgent_reason text,
  needed_by date,
  notes text not null default '',
  status text not null default 'open' check (status in ('open', 'cancelled')),
  version int not null default 1,
  has_conflict boolean not null default false,
  created_at timestamptz not null default now(),
  check (not urgent or (btrim(coalesce(urgent_reason, '')) <> '' and needed_by is not null)),
  unique (request_id, position)
);
create index if not exists pr_lines_request on pr_lines (request_id);
alter table pr_lines enable row level security;

-- A line's quantity, split by weekly batch. Arranged quantity (the office
-- has arranged it for purchase, plan 1a-2) is never shrunk by a worker:
-- a reduction that reaches it is recorded as pending_reduction for the
-- office to act on. Still needed = sum(quantity - pending_reduction).
create table if not exists pr_line_portions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references profiles(id),
  line_id uuid not null references pr_lines(id),
  batch_id uuid not null references pr_batches(id),
  quantity numeric(12,3) not null check (quantity > 0),
  arranged_at timestamptz,
  arranged_by uuid references profiles(id),
  pending_reduction numeric(12,3) not null default 0 check (pending_reduction >= 0 and pending_reduction <= quantity),
  created_at timestamptz not null default now()
);
create index if not exists pr_line_portions_line on pr_line_portions (line_id);
create index if not exists pr_line_portions_batch on pr_line_portions (batch_id);
alter table pr_line_portions enable row level security;

-- An edit made against an outdated version. Both values are kept; the
-- office resolves it (plan 1a-2). Nothing is silently overwritten.
create table if not exists pr_line_conflicts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references profiles(id),
  line_id uuid not null references pr_lines(id),
  proposed_by uuid not null references profiles(id),
  base_version int not null,
  current_version int not null,
  proposed_quantity numeric(12,3) not null check (proposed_quantity >= 0),
  current_quantity numeric(12,3) not null,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references profiles(id),
  resolution text
);
create index if not exists pr_line_conflicts_open on pr_line_conflicts (line_id) where resolved_at is null;
alter table pr_line_conflicts enable row level security;

-- Who changed what, when (spec §4B). Append-only: no update/delete path.
create table if not exists pr_events (
  id bigserial primary key,
  owner_id uuid not null references profiles(id),
  request_id uuid not null references pr_requests(id),
  line_id uuid references pr_lines(id),
  actor_id uuid not null references profiles(id),
  kind text not null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists pr_events_request on pr_events (request_id, created_at);
alter table pr_events enable row level security;

-- The first answer to each client operation, returned verbatim on retry.
create table if not exists pr_ops (
  op_id uuid not null,
  actor_id uuid not null references profiles(id),
  kind text not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key (actor_id, op_id)
);
alter table pr_ops enable row level security;

-- Private request photos (bucket request-photos, §10). Never the gallery.
create table if not exists pr_photos (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references profiles(id),
  request_id uuid not null references pr_requests(id),
  line_id uuid references pr_lines(id),
  storage_path text not null unique,
  uploaded_by uuid not null references profiles(id),
  created_at timestamptz not null default now()
);
create index if not exists pr_photos_request on pr_photos (request_id);
alter table pr_photos enable row level security;

-- The office reads request data; every change goes through an RPC.
drop policy if exists pr_requests_office_read on pr_requests;
create policy pr_requests_office_read on pr_requests for select to authenticated using (is_owner() or is_staff());
drop policy if exists pr_lines_office_read on pr_lines;
create policy pr_lines_office_read on pr_lines for select to authenticated using (is_owner() or is_staff());
drop policy if exists pr_line_portions_office_read on pr_line_portions;
create policy pr_line_portions_office_read on pr_line_portions for select to authenticated using (is_owner() or is_staff());
drop policy if exists pr_line_conflicts_office_read on pr_line_conflicts;
create policy pr_line_conflicts_office_read on pr_line_conflicts for select to authenticated using (is_owner() or is_staff());
drop policy if exists pr_events_office_read on pr_events;
create policy pr_events_office_read on pr_events for select to authenticated using (is_owner() or is_staff());
drop policy if exists pr_ops_office_read on pr_ops;
create policy pr_ops_office_read on pr_ops for select to authenticated using (is_owner() or is_staff());
drop policy if exists pr_photos_office_read on pr_photos;
create policy pr_photos_office_read on pr_photos for select to authenticated using (is_owner() or is_staff());
```

- [ ] **Step 4: Run to verify they pass** — `node tests/workmate-requests.test.js` → all ok (16 passed).

- [ ] **Step 5: Stop — no commit.**

---

### Task 3: Worker read RPCs — destinations, teams, catalogue (§7)

**Files:**
- Modify: `supabase/migrations/0085_workmate_requests.sql` (append §7)
- Modify: `tests/workmate-requests.test.js`

**Interfaces:**
- Consumes: `pr_is_requester()`, `pr_project_open(uuid)`, `pr_is_current_leader(uuid, uuid)`, `pr_person_name(uuid)` (Task 1).
- Produces (worker RPCs, used by plan 1a-3):
  - `pr_destinations() → table(project_id uuid, project_name text, work_id uuid, work_name text, is_main boolean)` — Main Contract rows have `work_id = project_id`, `work_name = 'Main Contract'`, `is_main = true`.
  - `pr_my_teams() → table(team_id uuid, team_name text, i_lead boolean, members jsonb)` — `members` = `[{"id": uuid, "name": text}]`, current members only.
  - `pr_catalog() → table(id uuid, kind text, name text, spec text, unit text, category text)`.

- [ ] **Step 1: Write the failing tests**

```js
test('worker read RPCs exist and require an active worker', () => {
  for (const f of ['pr_destinations', 'pr_my_teams', 'pr_catalog']) {
    const b = fnBlock(f);
    assert(b, 'no function ' + f);
    assert(/security definer/i.test(b), f + ' must be SECURITY DEFINER');
    assert(/pr_is_requester\(\)/.test(b), f + ' must check pr_is_requester()');
    assert(/attendance_data_owner\(\)|pr_project_open\(/.test(b), f + ' must be owner-scoped');
  }
});

test('destinations offer Main Contract and open Additional Works only', () => {
  const b = fnBlock('pr_destinations');
  assert(/'Main Contract'/.test(b), 'Main Contract label missing');
  assert(/parent_folder_id = f\.id/.test(b) && /completed_at is null/.test(b), 'Additional Works rule missing');
  assert(!/construction_projects/.test(b), 'PM must never be a destination');
});

test("teams never expose colleagues' contact details", () => {
  const b = fnBlock('pr_my_teams');
  assert(!/email|phone|contact/i.test(b), 'pr_my_teams must not return email/phone');
  assert(/pr_person_name\(/.test(b), 'names come from pr_person_name');
});
```

- [ ] **Step 2: Run to verify they fail** — `node tests/workmate-requests.test.js` → the 3 new tests FAIL (`no function pr_destinations`).

- [ ] **Step 3: Append §7**

```sql
-- ════ §7 What a worker may choose from ════════════════════════════════

-- Projects open to requests, each with its Main Contract and its own open
-- Additional Works jobs. Request-only projects appear here and never in the
-- Time In picker (that list is attendance_projects_for_worker, unchanged).
create or replace function pr_destinations()
returns table (project_id uuid, project_name text, work_id uuid, work_name text, is_main boolean)
language sql stable security definer set search_path = public as $$
  select f.id, f.name, f.id, 'Main Contract'::text, true
    from folders f
   where pr_is_requester() and pr_project_open(f.id)
  union all
  select f.id, f.name, c.id, c.name, false
    from folders f
    join folders c on c.parent_folder_id = f.id
   where pr_is_requester() and pr_project_open(f.id)
     and c.completed_at is null and coalesce(btrim(c.name), '') <> ''
  order by 2, 5 desc, 4
$$;

-- The caller's current teams, whether they lead each, and its current
-- members (names only — never contact details).
create or replace function pr_my_teams()
returns table (team_id uuid, team_name text, i_lead boolean, members jsonb)
language sql stable security definer set search_path = public as $$
  select t.id, t.name, pr_is_current_leader(t.id, auth.uid()),
         (select coalesce(jsonb_agg(jsonb_build_object('id', m2.worker_id, 'name', pr_person_name(m2.worker_id))
                                    order by pr_person_name(m2.worker_id)), '[]'::jsonb)
            from pr_team_members m2
           where m2.team_id = t.id and m2.removed_at is null)
    from pr_teams t
    join pr_team_members m on m.team_id = t.id
   where pr_is_requester()
     and t.active and t.owner_id = attendance_data_owner()
     and m.worker_id = auth.uid() and m.removed_at is null
   order by t.name
$$;

-- The official item list. Workers pick from it, or describe a missing item.
create or replace function pr_catalog()
returns table (id uuid, kind text, name text, spec text, unit text, category text)
language sql stable security definer set search_path = public as $$
  select c.id, c.kind, c.name, c.spec, c.unit, c.category
    from pr_catalog_items c
   where pr_is_requester() and c.active and c.owner_id = attendance_data_owner()
   order by c.kind, lower(c.name), lower(c.spec)
$$;
```

- [ ] **Step 4: Run to verify they pass** — all ok (19 passed).

- [ ] **Step 5: Stop — no commit.**

---

### Task 4: Submitting a request (§8)

**Files:**
- Modify: `supabase/migrations/0085_workmate_requests.sql` (append §8)
- Modify: `tests/workmate-requests.test.js`

**Interfaces:**
- Consumes: `pr_is_requester`, `pr_work_open`, `pr_is_current_member`, `pr_is_current_leader`, `pr_batch_for` (Task 1); Task 2 tables.
- Produces: `pr_submit_request(p_op uuid, p_request jsonb) → jsonb`.
  - `p_request` = `{"folder_id": uuid, "work_id": uuid (optional, defaults to folder_id = Main Contract), "team_id": uuid|null, "drafted_at": ISO-8601|null, "note": text, "lines": [{"kind": "material"|"tool", "catalog_item_id": uuid|null, "description": text, "spec": text, "unit": text, "category": text, "intended_member_id": uuid|null, "quantity": number, "urgent": bool, "urgent_reason": text|null, "needed_by": "YYYY-MM-DD"|null, "notes": text}]}` (1–100 lines).
  - Returns `{"request_id": uuid, "received_at": timestamptz, "batch_id": uuid, "cutoff_at": timestamptz, "purchase_on": date, "delivery_on": date, "line_ids": [uuid, …]}` — `line_ids` in the order of `lines`.

- [ ] **Step 1: Write the failing tests**

```js
test('submit checks the operation id BEFORE writing anything', () => {
  const b = fnBlock('pr_submit_request');
  assert(b, 'no function pr_submit_request');
  const look = b.search(/from pr_ops/i), write = b.search(/insert into pr_requests/i);
  assert(look > 0 && write > look, 'pr_ops lookup must come before the first insert');
  assert(/insert into pr_ops/i.test(b), 'the result must be stored in pr_ops');
});

test('submit enforces destination, team and leader rules on the server', () => {
  const b = fnBlock('pr_submit_request');
  for (const needle of ['pr_work_open(', 'pr_is_current_member(', 'pr_is_current_leader(', "'DESTINATION_CLOSED'", "'NOT_IN_TEAM'", "'NOT_TEAM_LEADER'", "'BAD_MEMBER'"]) {
    assert(b.includes(needle), 'missing ' + needle);
  }
  assert(!/construction_projects/.test(b), 'PM must never be a destination');
});

test("submit batches by the SERVER's received time, never the phone's", () => {
  const b = fnBlock('pr_submit_request');
  assert(/v_now timestamptz := now\(\)/.test(b) && /pr_batch_for\(v_owner, v_now\)/.test(b), 'batch must come from now()');
  assert(!/pr_batch_for\([^)]*drafted/i.test(b), 'drafted_at must never pick the batch');
});

test('submit caps a request at 100 lines', () => {
  assert(/> 100/.test(fnBlock('pr_submit_request')) && /'TOO_MANY_LINES'/.test(fnBlock('pr_submit_request')), 'line cap missing');
});
```

- [ ] **Step 2: Run to verify they fail** — the 4 new tests FAIL (`no function pr_submit_request`).

- [ ] **Step 3: Append §8**

```sql
-- ════ §8 Submitting a request ═════════════════════════════════════════

-- One call per request, retry-safe. The batch is chosen by the SERVER's
-- received time (spec §4A): a draft made Friday but first received Saturday
-- 12:00 joins next week. A retried p_op returns the first answer and writes
-- nothing. Every rule is checked here, whatever the app showed.
create or replace function pr_submit_request(p_op uuid, p_request jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_now timestamptz := now();
  v_prev jsonb;
  v_owner uuid;
  v_folder uuid;
  v_work uuid;
  v_team uuid;
  v_batch uuid;
  v_req uuid;
  v_line jsonb;
  v_line_id uuid;
  v_pos int := 0;
  v_kind text;
  v_qty numeric;
  v_urgent boolean;
  v_item uuid;
  v_member uuid;
  v_needed_by date;
  v_drafted timestamptz;
  v_result jsonb;
begin
  if v_uid is null or not pr_is_requester() then
    raise exception 'NOT_A_REQUESTER' using errcode = 'P0001';
  end if;
  if p_op is null or p_request is null then
    raise exception 'BAD_OPERATION' using errcode = 'P0001';
  end if;

  select o.result into v_prev from pr_ops o where o.actor_id = v_uid and o.op_id = p_op;
  if found then
    return v_prev;
  end if;

  v_owner := attendance_data_owner();

  begin
    v_folder := (p_request ->> 'folder_id')::uuid;
    v_work := coalesce(nullif(p_request ->> 'work_id', '')::uuid, v_folder);
  exception when invalid_text_representation then
    raise exception 'DESTINATION_CLOSED' using errcode = 'P0001';
  end;
  if v_folder is null or not pr_work_open(v_folder, v_work) then
    raise exception 'DESTINATION_CLOSED' using errcode = 'P0001';
  end if;

  begin
    v_team := nullif(p_request ->> 'team_id', '')::uuid;
  exception when invalid_text_representation then
    raise exception 'NOT_IN_TEAM' using errcode = 'P0001';
  end;
  if v_team is not null and not (
       pr_is_current_member(v_team, v_uid)
       and exists (select 1 from pr_teams t where t.id = v_team and t.owner_id = v_owner)) then
    raise exception 'NOT_IN_TEAM' using errcode = 'P0001';
  end if;

  if jsonb_typeof(p_request -> 'lines') is distinct from 'array' or jsonb_array_length(p_request -> 'lines') = 0 then
    raise exception 'NO_LINES' using errcode = 'P0001';
  end if;
  if jsonb_array_length(p_request -> 'lines') > 100 then
    raise exception 'TOO_MANY_LINES' using errcode = 'P0001';
  end if;

  begin
    v_drafted := nullif(p_request ->> 'drafted_at', '')::timestamptz;
  exception when others then
    v_drafted := null;  -- the phone's draft time is information only; never fail a request on it
  end;

  v_batch := pr_batch_for(v_owner, v_now);

  insert into pr_requests (owner_id, requester_id, team_id, folder_id, work_folder_id, client_op_id, drafted_at, received_at, note)
  values (v_owner, v_uid, v_team, v_folder, v_work, p_op, v_drafted, v_now, coalesce(p_request ->> 'note', ''))
  returning id into v_req;

  for v_line in select value from jsonb_array_elements(p_request -> 'lines') loop
    v_kind := v_line ->> 'kind';
    if v_kind is null or v_kind not in ('material', 'tool')
       or coalesce(btrim(v_line ->> 'description'), '') = ''
       or coalesce(btrim(v_line ->> 'unit'), '') = '' then
      raise exception 'BAD_LINE' using errcode = 'P0001';
    end if;

    begin
      v_qty := (v_line ->> 'quantity')::numeric;
    exception when others then
      v_qty := null;
    end;
    if v_qty is null or v_qty <= 0 or v_qty > 1000000 then
      raise exception 'BAD_QUANTITY' using errcode = 'P0001';
    end if;

    begin
      v_urgent := coalesce((v_line ->> 'urgent')::boolean, false);
      v_needed_by := nullif(v_line ->> 'needed_by', '')::date;
      v_item := nullif(v_line ->> 'catalog_item_id', '')::uuid;
      v_member := case when v_kind = 'material' then nullif(v_line ->> 'intended_member_id', '')::uuid end;
    exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow then
      raise exception 'BAD_LINE' using errcode = 'P0001';
    end;

    if v_urgent and (coalesce(btrim(v_line ->> 'urgent_reason'), '') = '' or v_needed_by is null) then
      raise exception 'URGENT_NEEDS_REASON' using errcode = 'P0001';
    end if;
    if v_item is not null and not exists (
         select 1 from pr_catalog_items c
          where c.id = v_item and c.owner_id = v_owner and c.active and c.kind = v_kind) then
      raise exception 'BAD_CATALOG_ITEM' using errcode = 'P0001';
    end if;
    -- "Optional intended member from the request's team" (spec §4A). Naming
    -- someone other than yourself is acting for the team: leader only.
    if v_member is not null then
      if v_team is null or not pr_is_current_member(v_team, v_member) then
        raise exception 'BAD_MEMBER' using errcode = 'P0001';
      end if;
      if v_member <> v_uid and not pr_is_current_leader(v_team, v_uid) then
        raise exception 'NOT_TEAM_LEADER' using errcode = 'P0001';
      end if;
    end if;

    insert into pr_lines (owner_id, request_id, position, kind, catalog_item_id, description, spec, unit, category,
                          intended_member_id, urgent, urgent_reason, needed_by, notes)
    values (v_owner, v_req, v_pos, v_kind, v_item, btrim(v_line ->> 'description'), coalesce(btrim(v_line ->> 'spec'), ''),
            btrim(v_line ->> 'unit'), coalesce(btrim(v_line ->> 'category'), ''), v_member, v_urgent,
            case when v_urgent then btrim(v_line ->> 'urgent_reason') end, v_needed_by, coalesce(v_line ->> 'notes', ''))
    returning id into v_line_id;

    insert into pr_line_portions (owner_id, line_id, batch_id, quantity) values (v_owner, v_line_id, v_batch, v_qty);
    v_pos := v_pos + 1;
  end loop;

  insert into pr_events (owner_id, request_id, actor_id, kind, detail)
  values (v_owner, v_req, v_uid, 'submitted', jsonb_build_object('lines', v_pos, 'batch_id', v_batch));

  select jsonb_build_object(
           'request_id', v_req, 'received_at', v_now, 'batch_id', b.id,
           'cutoff_at', b.cutoff_at, 'purchase_on', b.purchase_on, 'delivery_on', b.delivery_on,
           'line_ids', (select jsonb_agg(l.id order by l.position) from pr_lines l where l.request_id = v_req))
    into v_result
    from pr_batches b where b.id = v_batch;

  insert into pr_ops (op_id, actor_id, kind, result) values (p_op, v_uid, 'submit', v_result);
  return v_result;
end;
$$;
```

- [ ] **Step 4: Run to verify they pass** — all ok (23 passed).

- [ ] **Step 5: Stop — no commit.**

---

### Task 5: Changing quantities and cancelling (§9)

**Files:**
- Modify: `supabase/migrations/0085_workmate_requests.sql` (append §9)
- Modify: `tests/workmate-requests.test.js`

**Interfaces:**
- Consumes: Task 1–2 tables and helpers; `pr_work_open`.
- Produces:
  - internal `pr_apply_quantity(p_line uuid, p_new numeric, p_owner uuid) → void`;
  - `pr_change_quantity(p_op uuid, p_line uuid, p_base_version int, p_quantity numeric) → jsonb` = `{"status": "applied"|"conflict", "version": int, "needed": numeric}`;
  - `pr_cancel_line(p_op uuid, p_line uuid) → jsonb` = `{"status": "cancelled", "version": int}`;
  - `pr_cancel_request(p_op uuid, p_request uuid) → jsonb` = `{"status": "cancelled", "lines": int}`.

- [ ] **Step 1: Write the failing tests**

```js
test('a decrease removes the newest unarranged quantity first, then only FLAGS arranged quantity', () => {
  const b = fnBlock('pr_apply_quantity');
  assert(b, 'no function pr_apply_quantity');
  const unarranged = b.search(/arranged_at is null\s+order by created_at desc/i);
  const arranged = b.search(/arranged_at is not null\s+order by created_at desc/i);
  assert(unarranged > 0 && arranged > 0, 'both passes must walk newest first');
  assert(/pending_reduction = pending_reduction \+ v_take/.test(b), 'arranged quantity must be flagged, not shrunk');
});

test('an increase first takes back a pending reduction, then adds to the batch for NOW', () => {
  const b = fnBlock('pr_apply_quantity');
  assert(/pending_reduction = pending_reduction - v_take/.test(b), 'increase must absorb pending reductions first');
  assert(/pr_batch_for\(p_owner, now\(\)\)/.test(b), 'new quantity must join the batch for now()');
});

test('an outdated edit is kept as a conflict, never applied', () => {
  const b = fnBlock('pr_change_quantity');
  assert(b, 'no function pr_change_quantity');
  assert(/p_base_version is distinct from l\.version/.test(b), 'version check missing');
  assert(/insert into pr_line_conflicts/i.test(b) && /has_conflict = true/.test(b), 'conflict must be recorded and flagged');
});

test('quantity and cancel RPCs are retry-safe and owner-only', () => {
  for (const f of ['pr_change_quantity', 'pr_cancel_line', 'pr_cancel_request']) {
    const b = fnBlock(f);
    assert(b, 'no function ' + f);
    const look = b.search(/from pr_ops/i), firstWrite = b.search(/insert into|update pr_|perform pr_apply_quantity/i);
    assert(look > 0 && firstWrite > look, f + ': pr_ops lookup must precede writes');
    assert(/requester_id <> v_uid/.test(b), f + ': requester-only check missing');
    assert(/insert into pr_ops/i.test(b), f + ': result not stored');
  }
});

test('completed work refuses quantity increases only', () => {
  const b = fnBlock('pr_change_quantity');
  assert(/p_quantity > v_current and not pr_work_open\(/.test(b), 'increase-only completed check missing');
});
```

- [ ] **Step 2: Run to verify they fail** — the 5 new tests FAIL.

- [ ] **Step 3: Append §9**

```sql
-- ════ §9 Changing quantities and cancelling ═══════════════════════════

-- Moves a line's still-needed total to p_new (spec §4B):
--   increase → first take back quantity already flagged for reduction
--              (newest arranged first); the rest is new demand in the batch
--              for NOW, merged only into that batch's UNARRANGED portion —
--              10 arranged this week + 2 added after cutoff stay separate.
--   decrease → remove the newest UNARRANGED quantity first; whatever is
--              left is FLAGGED on arranged portions (pending_reduction) for
--              the office — a placed order or purchase is never erased.
create or replace function pr_apply_quantity(p_line uuid, p_new numeric, p_owner uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_total numeric;
  v_delta numeric;
  v_take numeric;
  v_batch uuid;
  v_target uuid;
  p record;
begin
  select coalesce(sum(quantity - pending_reduction), 0) into v_total
    from pr_line_portions where line_id = p_line;

  if p_new > v_total then
    v_delta := p_new - v_total;
    for p in select * from pr_line_portions
              where line_id = p_line and arranged_at is not null and pending_reduction > 0
              order by created_at desc, id desc for update loop
      exit when v_delta <= 0;
      v_take := least(v_delta, p.pending_reduction);
      update pr_line_portions set pending_reduction = pending_reduction - v_take where id = p.id;
      v_delta := v_delta - v_take;
    end loop;
    if v_delta > 0 then
      v_batch := pr_batch_for(p_owner, now());
      select id into v_target from pr_line_portions
       where line_id = p_line and batch_id = v_batch and arranged_at is null
       order by created_at desc, id desc limit 1;
      if v_target is null then
        insert into pr_line_portions (owner_id, line_id, batch_id, quantity) values (p_owner, p_line, v_batch, v_delta);
      else
        update pr_line_portions set quantity = quantity + v_delta where id = v_target;
      end if;
    end if;

  elsif p_new < v_total then
    v_delta := v_total - p_new;
    for p in select * from pr_line_portions
              where line_id = p_line and arranged_at is null
              order by created_at desc, id desc for update loop
      exit when v_delta <= 0;
      v_take := least(v_delta, p.quantity);
      if v_take >= p.quantity then
        delete from pr_line_portions where id = p.id;
      else
        update pr_line_portions set quantity = quantity - v_take where id = p.id;
      end if;
      v_delta := v_delta - v_take;
    end loop;
    for p in select * from pr_line_portions
              where line_id = p_line and arranged_at is not null
              order by created_at desc, id desc for update loop
      exit when v_delta <= 0;
      v_take := least(v_delta, p.quantity - p.pending_reduction);
      if v_take > 0 then
        update pr_line_portions set pending_reduction = pending_reduction + v_take where id = p.id;
        v_delta := v_delta - v_take;
      end if;
    end loop;
  end if;
end;
$$;

-- The requester changes a line's quantity. p_base_version is the version the
-- phone last saw: if the office changed the line since, BOTH values are kept
-- as a conflict for the office to resolve (spec §4E) and nothing is applied.
create or replace function pr_change_quantity(p_op uuid, p_line uuid, p_base_version int, p_quantity numeric) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_prev jsonb;
  v_current numeric;
  v_result jsonb;
  l record;
begin
  if v_uid is null or not pr_is_requester() then
    raise exception 'NOT_A_REQUESTER' using errcode = 'P0001';
  end if;
  if p_op is null or p_line is null then
    raise exception 'BAD_OPERATION' using errcode = 'P0001';
  end if;

  select o.result into v_prev from pr_ops o where o.actor_id = v_uid and o.op_id = p_op;
  if found then
    return v_prev;
  end if;

  select ln.id, ln.owner_id, ln.request_id, ln.status, ln.version,
         r.requester_id, r.status as request_status, r.folder_id, r.work_folder_id
    into l
    from pr_lines ln join pr_requests r on r.id = ln.request_id
   where ln.id = p_line
     for update of ln;
  if not found or l.requester_id <> v_uid then
    raise exception 'NOT_YOUR_LINE' using errcode = 'P0001';
  end if;
  if l.status <> 'open' or l.request_status <> 'submitted' then
    raise exception 'LINE_CLOSED' using errcode = 'P0001';
  end if;
  if p_quantity is null or p_quantity <= 0 or p_quantity > 1000000 then
    raise exception 'BAD_QUANTITY' using errcode = 'P0001';
  end if;

  select coalesce(sum(quantity - pending_reduction), 0) into v_current
    from pr_line_portions where line_id = p_line;

  if p_base_version is distinct from l.version then
    insert into pr_line_conflicts (owner_id, line_id, proposed_by, base_version, current_version, proposed_quantity, current_quantity)
    values (l.owner_id, p_line, v_uid, coalesce(p_base_version, 0), l.version, p_quantity, v_current);
    update pr_lines set has_conflict = true where id = p_line;
    insert into pr_events (owner_id, request_id, line_id, actor_id, kind, detail)
    values (l.owner_id, l.request_id, p_line, v_uid, 'quantity_conflict',
            jsonb_build_object('proposed', p_quantity, 'current', v_current, 'base_version', p_base_version, 'version', l.version));
    v_result := jsonb_build_object('status', 'conflict', 'version', l.version, 'needed', v_current);
  else
    if p_quantity > v_current and not pr_work_open(l.folder_id, l.work_folder_id) then
      raise exception 'DESTINATION_CLOSED' using errcode = 'P0001';
    end if;
    perform pr_apply_quantity(p_line, p_quantity, l.owner_id);
    update pr_lines set version = version + 1 where id = p_line;
    insert into pr_events (owner_id, request_id, line_id, actor_id, kind, detail)
    values (l.owner_id, l.request_id, p_line, v_uid, 'quantity_changed', jsonb_build_object('from', v_current, 'to', p_quantity));
    v_result := jsonb_build_object('status', 'applied', 'version', l.version + 1, 'needed', p_quantity);
  end if;

  insert into pr_ops (op_id, actor_id, kind, result) values (p_op, v_uid, 'change_quantity', v_result);
  return v_result;
end;
$$;

-- The requester cancels one line. Its unarranged quantity goes; arranged
-- quantity is flagged for the office. History stays.
create or replace function pr_cancel_line(p_op uuid, p_line uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_prev jsonb;
  v_result jsonb;
  l record;
begin
  if v_uid is null or not pr_is_requester() then
    raise exception 'NOT_A_REQUESTER' using errcode = 'P0001';
  end if;
  if p_op is null or p_line is null then
    raise exception 'BAD_OPERATION' using errcode = 'P0001';
  end if;

  select o.result into v_prev from pr_ops o where o.actor_id = v_uid and o.op_id = p_op;
  if found then
    return v_prev;
  end if;

  select ln.id, ln.owner_id, ln.request_id, ln.status, ln.version, r.requester_id, r.status as request_status
    into l
    from pr_lines ln join pr_requests r on r.id = ln.request_id
   where ln.id = p_line
     for update of ln;
  if not found or l.requester_id <> v_uid then
    raise exception 'NOT_YOUR_LINE' using errcode = 'P0001';
  end if;
  if l.status <> 'open' or l.request_status <> 'submitted' then
    raise exception 'LINE_CLOSED' using errcode = 'P0001';
  end if;

  perform pr_apply_quantity(p_line, 0, l.owner_id);
  update pr_lines set status = 'cancelled', version = version + 1 where id = p_line;
  insert into pr_events (owner_id, request_id, line_id, actor_id, kind, detail)
  values (l.owner_id, l.request_id, p_line, v_uid, 'line_cancelled', '{}'::jsonb);

  v_result := jsonb_build_object('status', 'cancelled', 'version', l.version + 1);
  insert into pr_ops (op_id, actor_id, kind, result) values (p_op, v_uid, 'cancel_line', v_result);
  return v_result;
end;
$$;

-- The requester cancels the whole request: every open line as above.
create or replace function pr_cancel_request(p_op uuid, p_request uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_prev jsonb;
  v_result jsonb;
  v_count int := 0;
  r record;
  ln record;
begin
  if v_uid is null or not pr_is_requester() then
    raise exception 'NOT_A_REQUESTER' using errcode = 'P0001';
  end if;
  if p_op is null or p_request is null then
    raise exception 'BAD_OPERATION' using errcode = 'P0001';
  end if;

  select o.result into v_prev from pr_ops o where o.actor_id = v_uid and o.op_id = p_op;
  if found then
    return v_prev;
  end if;

  select id, owner_id, requester_id, status into r from pr_requests where id = p_request for update;
  if not found or r.requester_id <> v_uid then
    raise exception 'NOT_YOUR_REQUEST' using errcode = 'P0001';
  end if;
  if r.status <> 'submitted' then
    raise exception 'LINE_CLOSED' using errcode = 'P0001';
  end if;

  for ln in select id from pr_lines where request_id = p_request and status = 'open' order by position for update loop
    perform pr_apply_quantity(ln.id, 0, r.owner_id);
    update pr_lines set status = 'cancelled', version = version + 1 where id = ln.id;
    v_count := v_count + 1;
  end loop;
  update pr_requests set status = 'cancelled', cancelled_at = now() where id = p_request;
  insert into pr_events (owner_id, request_id, actor_id, kind, detail)
  values (r.owner_id, p_request, v_uid, 'request_cancelled', jsonb_build_object('lines', v_count));

  v_result := jsonb_build_object('status', 'cancelled', 'lines', v_count);
  insert into pr_ops (op_id, actor_id, kind, result) values (p_op, v_uid, 'cancel_request', v_result);
  return v_result;
end;
$$;
```

- [ ] **Step 4: Run to verify they pass** — all ok (28 passed).

- [ ] **Step 5: Stop — no commit.**

---
### Task 6: Reading requests, and private photos (§10)

**Files:**
- Modify: `supabase/migrations/0085_workmate_requests.sql` (append §10)
- Modify: `tests/workmate-requests.test.js`

**Interfaces:**
- Consumes: Task 1–5 tables and helpers.
- Produces:
  - `pr_my_requests(p_limit int default 50) → jsonb` — an array, newest first, of the caller's own requests plus (for a current leader) their teams' requests. Each element: `{"id", "status", "received_at", "drafted_at", "note", "mine": bool, "requester_name", "project_id", "project_name", "work_id", "work_name" ("Main Contract" for the project itself), "team_id", "team_name", "lines": [{"id", "position", "kind", "catalog_item_id", "description", "spec", "unit", "category", "intended_member_id", "intended_member_name", "urgent", "urgent_reason", "needed_by", "notes", "status", "version", "has_conflict", "needed": numeric, "portions": [{"quantity", "pending_reduction", "arranged": bool, "cutoff_at", "purchase_on", "delivery_on"}]}], "photos": [{"id", "line_id", "path"}]}`. `p_limit` is clamped to 1–200.
  - Bucket `request-photos` (private, `image/jpeg`, 5 MB); storage policies "request-photos: requester uploads own", "request-photos: requester and leader read", "request-photos: office reads".
  - `pr_owns_request_path(p_name text) → boolean`, `pr_can_read_request_photo(p_name text) → boolean` (used by those policies).
  - `pr_attach_photo(p_op uuid, p_request uuid, p_line uuid, p_path text) → jsonb` = `{"photo_id": uuid}`; the object must already be uploaded at `p_path` = `{auth.uid()}/{p_request}/…`.

- [ ] **Step 1: Write the failing tests**

```js
test('my requests = mine, plus my teams when I am their current leader', () => {
  const b = fnBlock('pr_my_requests');
  assert(b, 'no function pr_my_requests');
  assert(/r\.requester_id = auth\.uid\(\)/.test(b) && /pr_is_current_leader\(r\.team_id, auth\.uid\(\)\)/.test(b), 'visibility rule missing');
  assert(/r\.owner_id = attendance_data_owner\(\)/.test(b) && /pr_is_requester\(\)/.test(b), 'not owner/requester scoped');
  assert(!/email|phone/i.test(b), 'must not return contact details');
  assert(/least\(coalesce\(p_limit, 50\), 200\)/.test(b), 'limit must be clamped');
});

test('request photos live in their own PRIVATE bucket', () => {
  assert(/insert into storage\.buckets[\s\S]*'request-photos', 'request-photos', false, 5242880, array\['image\/jpeg'\]/.test(CODE), 'bucket definition wrong');
  assert(!/'uploads'/.test(CODE), 'request photos must never touch the legacy uploads bucket');
});

test('photo policies: requester uploads own path; requester, team leader and office read', () => {
  const pols = [...CODE.matchAll(/create policy "request-photos:[^"]*" on storage\.objects[\s\S]*?;/gi)].map(m => m[0]);
  assert(pols.length === 3, 'expected 3 request-photos policies, found ' + pols.length);
  assert(pols.some(p => /for insert/i.test(p) && /pr_owns_request_path\(name\)/.test(p)), 'upload policy missing');
  assert(pols.some(p => /for select/i.test(p) && /pr_can_read_request_photo\(name\)/.test(p)), 'requester/leader read policy missing');
  assert(pols.some(p => /for select/i.test(p) && /is_owner\(\) or is_staff\(\)/.test(p)), 'office read policy missing');
  assert(!pols.some(p => /for (update|delete|all)/i.test(p)), 'workers must not update or delete photos');
});

test('attaching a photo needs the uploaded object, the right path and a retry-safe op', () => {
  const b = fnBlock('pr_attach_photo');
  assert(b, 'no function pr_attach_photo');
  assert(/from storage\.objects/.test(b) && /'PHOTO_NOT_UPLOADED'/.test(b), 'must check the object exists');
  assert(/'BAD_PATH'/.test(b) && /v_uid::text \|\| '\/' \|\| p_request::text \|\| '\/'/.test(b), 'path prefix check missing');
  assert(/from pr_ops/.test(b) && /insert into pr_ops/.test(b), 'not retry-safe');
});
```

- [ ] **Step 2: Run to verify they fail** — the 4 new tests FAIL.

- [ ] **Step 3: Append §10**

```sql
-- ════ §10 Reading requests, and private photos ════════════════════════

-- What the app's Requests tab shows: the caller's own requests, plus their
-- teams' requests while they are the current leader. Quantities only —
-- no money exists in these tables. Names, never contact details.
create or replace function pr_my_requests(p_limit int default 50) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(x.doc order by x.received_at desc), '[]'::jsonb)
  from (
    select r.received_at,
           jsonb_build_object(
             'id', r.id, 'status', r.status, 'received_at', r.received_at, 'drafted_at', r.drafted_at, 'note', r.note,
             'mine', r.requester_id = auth.uid(),
             'requester_name', pr_person_name(r.requester_id),
             'project_id', r.folder_id, 'project_name', f.name,
             'work_id', r.work_folder_id,
             'work_name', case when r.work_folder_id = r.folder_id then 'Main Contract' else w.name end,
             'team_id', r.team_id, 'team_name', t.name,
             'lines', (
               select coalesce(jsonb_agg(jsonb_build_object(
                        'id', l.id, 'position', l.position, 'kind', l.kind, 'catalog_item_id', l.catalog_item_id,
                        'description', l.description, 'spec', l.spec, 'unit', l.unit, 'category', l.category,
                        'intended_member_id', l.intended_member_id,
                        'intended_member_name', case when l.intended_member_id is null then null else pr_person_name(l.intended_member_id) end,
                        'urgent', l.urgent, 'urgent_reason', l.urgent_reason, 'needed_by', l.needed_by, 'notes', l.notes,
                        'status', l.status, 'version', l.version, 'has_conflict', l.has_conflict,
                        'needed', (select coalesce(sum(p.quantity - p.pending_reduction), 0) from pr_line_portions p where p.line_id = l.id),
                        'portions', (
                          select coalesce(jsonb_agg(jsonb_build_object(
                                   'quantity', p.quantity, 'pending_reduction', p.pending_reduction,
                                   'arranged', p.arranged_at is not null,
                                   'cutoff_at', b.cutoff_at, 'purchase_on', b.purchase_on, 'delivery_on', b.delivery_on)
                                 order by b.cutoff_at, p.created_at), '[]'::jsonb)
                            from pr_line_portions p join pr_batches b on b.id = p.batch_id
                           where p.line_id = l.id))
                      order by l.position), '[]'::jsonb)
                 from pr_lines l where l.request_id = r.id),
             'photos', (
               select coalesce(jsonb_agg(jsonb_build_object('id', ph.id, 'line_id', ph.line_id, 'path', ph.storage_path)
                                order by ph.created_at), '[]'::jsonb)
                 from pr_photos ph where ph.request_id = r.id)
           ) as doc
      from pr_requests r
      join folders f on f.id = r.folder_id
      join folders w on w.id = r.work_folder_id
      left join pr_teams t on t.id = r.team_id
     where pr_is_requester()
       and r.owner_id = attendance_data_owner()
       and (r.requester_id = auth.uid()
            or (r.team_id is not null and pr_is_current_leader(r.team_id, auth.uid())))
     order by r.received_at desc
     limit greatest(1, least(coalesce(p_limit, 50), 200))
  ) x
$$;

-- Raw request photos: never the legacy shared `uploads` bucket (spec §4A).
-- Path {requester_uid}/{request_id}/{photo_id}.jpg.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('request-photos', 'request-photos', false, 5242880, array['image/jpeg'])
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- The object path names the caller and one of the caller's own requests.
-- SECURITY DEFINER because it reads pr_requests, which workers cannot.
create or replace function pr_owns_request_path(p_name text) returns boolean
language sql stable security definer set search_path = public as $$
  select pr_is_requester()
     and (storage.foldername(p_name))[1] = auth.uid()::text
     and exists (select 1 from pr_requests r
                  where r.id::text = (storage.foldername(p_name))[2]
                    and r.requester_id = auth.uid())
$$;

-- The caller may see a photo of this request: its requester, or the current
-- leader of the request's team (spec §4G: never the whole crew).
create or replace function pr_can_read_request_photo(p_name text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from pr_requests r
     where r.id::text = (storage.foldername(p_name))[2]
       and r.requester_id::text = (storage.foldername(p_name))[1]
       and (r.requester_id = auth.uid()
            or (r.team_id is not null and pr_is_current_leader(r.team_id, auth.uid()))))
$$;

drop policy if exists "request-photos: requester uploads own" on storage.objects;
create policy "request-photos: requester uploads own" on storage.objects for insert to authenticated
  with check (bucket_id = 'request-photos' and pr_owns_request_path(name));

drop policy if exists "request-photos: requester and leader read" on storage.objects;
create policy "request-photos: requester and leader read" on storage.objects for select to authenticated
  using (bucket_id = 'request-photos' and pr_can_read_request_photo(name));

drop policy if exists "request-photos: office reads" on storage.objects;
create policy "request-photos: office reads" on storage.objects for select to authenticated
  using (bucket_id = 'request-photos' and (is_owner() or is_staff()));

-- Links an uploaded photo to the request (and optionally one line).
-- Upload first, then attach: the row only ever points at a real object.
create or replace function pr_attach_photo(p_op uuid, p_request uuid, p_line uuid, p_path text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_prev jsonb;
  v_result jsonb;
  v_id uuid;
  r record;
begin
  if v_uid is null or not pr_is_requester() then
    raise exception 'NOT_A_REQUESTER' using errcode = 'P0001';
  end if;
  if p_op is null or p_request is null then
    raise exception 'BAD_OPERATION' using errcode = 'P0001';
  end if;

  select o.result into v_prev from pr_ops o where o.actor_id = v_uid and o.op_id = p_op;
  if found then
    return v_prev;
  end if;

  select id, owner_id, requester_id into r from pr_requests where id = p_request;
  if not found or r.requester_id <> v_uid then
    raise exception 'NOT_YOUR_REQUEST' using errcode = 'P0001';
  end if;
  if p_line is not null and not exists (select 1 from pr_lines l where l.id = p_line and l.request_id = p_request) then
    raise exception 'BAD_LINE' using errcode = 'P0001';
  end if;
  if p_path is null or left(p_path, length(v_uid::text || '/' || p_request::text || '/')) <> v_uid::text || '/' || p_request::text || '/' then
    raise exception 'BAD_PATH' using errcode = 'P0001';
  end if;
  if not exists (select 1 from storage.objects o where o.bucket_id = 'request-photos' and o.name = p_path) then
    raise exception 'PHOTO_NOT_UPLOADED' using errcode = 'P0001';
  end if;

  insert into pr_photos (owner_id, request_id, line_id, storage_path, uploaded_by)
  values (r.owner_id, p_request, p_line, p_path, v_uid)
  on conflict (storage_path) do nothing;
  select id into v_id from pr_photos where storage_path = p_path;

  insert into pr_events (owner_id, request_id, line_id, actor_id, kind, detail)
  values (r.owner_id, p_request, p_line, v_uid, 'photo_attached', jsonb_build_object('photo_id', v_id));

  v_result := jsonb_build_object('photo_id', v_id);
  insert into pr_ops (op_id, actor_id, kind, result) values (p_op, v_uid, 'attach_photo', v_result);
  return v_result;
end;
$$;
```

- [ ] **Step 4: Run to verify they pass** — all ok (32 passed).

- [ ] **Step 5: Stop — no commit.**

---

### Task 7: Legacy lockdown, call permissions, documentation (§11–§12)

**Files:**
- Modify: `supabase/migrations/0085_workmate_requests.sql` (append §11, §12)
- Modify: `tests/workmate-requests.test.js`
- Modify: `docs/DATABASE_SCHEMA.md` (new section before `## Relationship map`)
- Modify: `supabase/migrations/README.md` (the "Next number" bullet)

**Interfaces:**
- Consumes: every function created in Tasks 1–6 (exact signatures below).
- Produces: final permissions; documentation.

- [ ] **Step 1: Write the failing tests**

```js
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const WORKER_RPCS = ['pr_destinations()', 'pr_my_teams()', 'pr_catalog()', 'pr_submit_request(uuid, jsonb)',
  'pr_change_quantity(uuid, uuid, integer, numeric)', 'pr_cancel_line(uuid, uuid)', 'pr_cancel_request(uuid, uuid)',
  'pr_my_requests(integer)', 'pr_attach_photo(uuid, uuid, uuid, text)'];
const POLICY_HELPERS = ['pr_is_requester()', 'pr_owns_request_path(text)', 'pr_can_read_request_photo(text)'];
const INTERNAL = ['pr_person_name(uuid)', 'pr_is_current_member(uuid, uuid)', 'pr_is_current_leader(uuid, uuid)',
  'pr_project_open(uuid)', 'pr_work_open(uuid, uuid)', 'pr_cutoff_after(timestamptz)', 'pr_batch_for(uuid, timestamptz)',
  'pr_apply_quantity(uuid, numeric, uuid)'];

test('worker RPCs and policy helpers: signed-in users only, never anon', () => {
  for (const f of [...WORKER_RPCS, ...POLICY_HELPERS]) {
    assert(new RegExp('revoke all on function ' + esc(f) + ' from public, anon;', 'i').test(CODE), 'missing revoke for ' + f);
    assert(new RegExp('grant execute on function ' + esc(f) + ' to authenticated;', 'i').test(CODE), 'missing grant for ' + f);
  }
});

test('internal helpers are callable by nobody', () => {
  for (const f of INTERNAL) {
    assert(new RegExp('revoke all on function ' + esc(f) + ' from public, anon, authenticated;', 'i').test(CODE), 'missing revoke for ' + f);
    assert(!new RegExp('grant execute on function ' + esc(f), 'i').test(CODE), f + ' must not be granted');
  }
});

test('every function in the migration is classified', () => {
  const names = [...CODE.matchAll(/create or replace function (pr_\w+)\s*\(/gi)].map(m => m[1]);
  const known = [...WORKER_RPCS, ...POLICY_HELPERS, ...INTERNAL].map(s => s.split('(')[0]);
  for (const n of names) assert(known.includes(n), n + ' has no permission decision');
});

test('legacy requests: workers read only their own and write nothing', () => {
  assert(/drop policy if exists requests_worker_create on requests;/i.test(CODE), 'requests_worker_create not dropped');
  assert(/drop policy if exists requests_worker_update on requests;/i.test(CODE), 'requests_worker_update not dropped');
  assert(/drop policy if exists request_items_rw on request_items;/i.test(CODE), 'request_items_rw not dropped');
  const read = CODE.match(/create policy requests_read on requests[\s\S]*?;/i);
  assert(read && /is_worker\(\) and requested_by = auth\.uid\(\)/.test(read[0]), 'requests_read must be own-only for workers');
  const items = [...CODE.matchAll(/create policy (request_items_\w+) on request_items[\s\S]*?;/gi)].map(m => m[0]);
  assert(items.length === 2, 'expected request_items_admin + request_items_worker_read');
  const worker = items.find(p => /request_items_worker_read/.test(p));
  assert(worker && /for select/i.test(worker) && /r\.requested_by = auth\.uid\(\)/.test(worker), 'worker item policy must be SELECT own only');
});
```

- [ ] **Step 2: Run to verify they fail** — the 4 new tests FAIL.

- [ ] **Step 3: Append §11 and §12**

```sql
-- ════ §11 Legacy requests: read-only history ═══════════════════════════

-- Spec §6/§10: at Stage 1a, workers lose broad access to colleagues'
-- requests through the legacy tables — on the SERVER, not just the screen.
-- Before this, any worker could read every request (requests_read) and
-- request_items_rw let any worker update or DELETE any item. The rows
-- (2 requests, 3 items, last March 2026) stay as history: owner/staff keep
-- full access; a worker may read only their own and write nothing.
drop policy if exists requests_read on requests;
create policy requests_read on requests for select
  using (is_owner() or is_staff() or (is_worker() and requested_by = auth.uid()));
drop policy if exists requests_worker_create on requests;
drop policy if exists requests_worker_update on requests;

drop policy if exists request_items_rw on request_items;
drop policy if exists request_items_admin on request_items;
create policy request_items_admin on request_items for all
  using (is_owner() or is_staff()) with check (is_owner() or is_staff());
drop policy if exists request_items_worker_read on request_items;
create policy request_items_worker_read on request_items for select
  using (is_worker() and exists (select 1 from requests r where r.id = request_items.request_id and r.requested_by = auth.uid()));

-- ════ §12 Who may call what ═══════════════════════════════════════════

-- Internal helpers: only other SECURITY DEFINER functions call them.
revoke all on function pr_person_name(uuid) from public, anon, authenticated;
revoke all on function pr_is_current_member(uuid, uuid) from public, anon, authenticated;
revoke all on function pr_is_current_leader(uuid, uuid) from public, anon, authenticated;
revoke all on function pr_project_open(uuid) from public, anon, authenticated;
revoke all on function pr_work_open(uuid, uuid) from public, anon, authenticated;
revoke all on function pr_cutoff_after(timestamptz) from public, anon, authenticated;
revoke all on function pr_batch_for(uuid, timestamptz) from public, anon, authenticated;
revoke all on function pr_apply_quantity(uuid, numeric, uuid) from public, anon, authenticated;

-- Evaluated inside storage policies, so the signed-in caller needs EXECUTE.
revoke all on function pr_is_requester() from public, anon;
grant execute on function pr_is_requester() to authenticated;
revoke all on function pr_owns_request_path(text) from public, anon;
grant execute on function pr_owns_request_path(text) to authenticated;
revoke all on function pr_can_read_request_photo(text) from public, anon;
grant execute on function pr_can_read_request_photo(text) to authenticated;

-- The worker RPCs (each checks pr_is_requester() itself).
revoke all on function pr_destinations() from public, anon;
grant execute on function pr_destinations() to authenticated;
revoke all on function pr_my_teams() from public, anon;
grant execute on function pr_my_teams() to authenticated;
revoke all on function pr_catalog() from public, anon;
grant execute on function pr_catalog() to authenticated;
revoke all on function pr_submit_request(uuid, jsonb) from public, anon;
grant execute on function pr_submit_request(uuid, jsonb) to authenticated;
revoke all on function pr_change_quantity(uuid, uuid, integer, numeric) from public, anon;
grant execute on function pr_change_quantity(uuid, uuid, integer, numeric) to authenticated;
revoke all on function pr_cancel_line(uuid, uuid) from public, anon;
grant execute on function pr_cancel_line(uuid, uuid) to authenticated;
revoke all on function pr_cancel_request(uuid, uuid) from public, anon;
grant execute on function pr_cancel_request(uuid, uuid) to authenticated;
revoke all on function pr_my_requests(integer) from public, anon;
grant execute on function pr_my_requests(integer) to authenticated;
revoke all on function pr_attach_photo(uuid, uuid, uuid, text) from public, anon;
grant execute on function pr_attach_photo(uuid, uuid, uuid, text) to authenticated;
```

- [ ] **Step 4: Documentation**

1. `supabase/migrations/README.md` — replace the bullet that starts `- **Next number = highest existing + 1** (**0084** — highest on disk is` and its two continuation lines with:

```markdown
- **Next number = highest existing + 1** (**0086** — highest on disk is
  `0085_workmate_requests.sql`). Sort the folder before you pick; don't
  trust this line if it looks stale. Duplicate numbers are how we got into trouble.
```

2. `docs/DATABASE_SCHEMA.md` — insert this section immediately before the line `## Relationship map`:

```markdown
## 13. WorkMate Requests (`0085`) — material/tool requests from DAC'S WorkMate

Stage 1a-1 server (plan `docs/superpowers/plans/2026-10-02-workmate-stage1a1-requests-server.md`). **Project Control only. No money anywhere** — no `pr_*` column holds a price, amount or cost. **Workers never read or write `pr_*` tables directly**: RLS is on and no `pr_*` policy grants a worker anything; every worker action is a `SECURITY DEFINER` RPC. Owner/staff read everything; they edit only the setup tables directly (request data changes through RPCs).

| Table | What it is |
|---|---|
| `pr_teams`, `pr_team_members` | Teams; membership history (`removed_at`); one current leader per team (`is_leader`). Acting for a team needs the leader row **and** profile role `teamLeader` |
| `pr_catalog_items` | Official items: `kind` material/tool, `name`, `spec`, `unit`, `category`; one active row per identity |
| `pr_project_settings` | `allow_requests` per top-level project folder — opens an upcoming project to requests; independent of Attendance's hide switch |
| `pr_batches` | One per weekly cutoff: **Saturday 12:00 noon Asia/Manila** (`cutoff_at`), default `purchase_on` = Monday, `delivery_on` = Wednesday; editable by the office |
| `pr_requests` | One destination (`folder_id` = project, `work_folder_id` = project itself for Main Contract or a child Additional Works folder), optional `team_id`, `client_op_id` (unique per requester), server `received_at` |
| `pr_lines` | Stable-id items: kind, optional `catalog_item_id`, description/spec/unit/category, optional `intended_member_id` (materials), per-line `urgent` + reason + `needed_by`, `version`, `has_conflict` |
| `pr_line_portions` | A line's quantity by batch. `arranged_at` set by the office; `pending_reduction` = quantity a worker reduced that was already arranged (office to act). **Still needed = Σ(quantity − pending_reduction)** |
| `pr_line_conflicts` | An edit made against an outdated `version` — both values kept for the office |
| `pr_events` | Append-only history (submitted, quantity_changed, quantity_conflict, line_cancelled, request_cancelled, photo_attached) |
| `pr_ops` | First result per `(actor_id, op_id)` — a retried phone operation returns it verbatim |
| `pr_photos` | Private request photos, bucket **`request-photos`** (`{requester}/{request}/{photo}.jpg`; requester, current team leader, owner/staff) |

Worker RPCs: `pr_destinations()`, `pr_my_teams()`, `pr_catalog()`, `pr_submit_request(op, request)`, `pr_change_quantity(op, line, base_version, quantity)`, `pr_cancel_line(op, line)`, `pr_cancel_request(op, request)`, `pr_my_requests(limit)`, `pr_attach_photo(op, request, line, path)`. Completed projects / Additional Works refuse new requests and quantity increases (decreases, cancels and reading stay). PM projects are never destinations.

**Legacy `requests` / `request_items`** (Flutter-prototype era) are read-only history since `0085`: owner/staff full access; a worker reads only their own rows and writes nothing.
```

- [ ] **Step 5: Run to verify** — `node tests/workmate-requests.test.js` → all ok (36 passed); `npm test` → all suites pass.

- [ ] **Step 6: Stop — no commit.**

---

### Task 8: Live verification script, dry run, apply, verify

**Files:**
- Create: `supabase/tests/0085_verify.sql`

**Interfaces:**
- Consumes: everything in 0085; three existing live accounts — **W-0007** (role `worker`, John Tapales), **W-0019** (role `worker`, Danilo Tapales), **W-0021** (role `teamLeader`, Mark Frias) — all active under one owner (verified 2026-10-02).

- [ ] **Step 1: Write `supabase/tests/0085_verify.sql`**

```sql
-- ════════════════════════════════════════════════════════════════════
-- 0085 WorkMate Requests — live behaviour checks.
--
-- ONE transaction, ALWAYS rolled back — nothing persists:
--   after apply:   begin;  <this file>  rollback;
--   dry run first: begin;  <0085 migration>  <this file>  rollback;
--
-- Uses three existing active accounts under one owner: W-0007 (worker),
-- W-0019 (worker), W-0021 (teamLeader). Builds its own throwaway projects,
-- team and catalogue item. A failed check aborts with its message; success
-- ends with the row 'pr verify: all checks passed'.
-- ════════════════════════════════════════════════════════════════════

create temp table t_ctx (k text primary key, v text) on commit drop;
grant all on t_ctx to authenticated;

-- ── 0. Accounts and a throwaway project tree (as the database owner) ──
do $$
declare
  v_worker uuid; v_other uuid; v_leader uuid; v_owner uuid;
  v_p uuid; v_p2 uuid; v_aw uuid; v_done uuid; v_done_aw uuid; v_team uuid; v_item uuid; v_pm uuid;
begin
  select id into v_worker from profiles where worker_no = 7  and role = 'worker'     and coalesce(status, 'active') = 'active';
  select id into v_other  from profiles where worker_no = 19 and role = 'worker'     and coalesce(status, 'active') = 'active';
  select id into v_leader from profiles where worker_no = 21 and role = 'teamLeader' and coalesce(status, 'active') = 'active';
  assert v_worker is not null and v_other is not null and v_leader is not null,
    'accounts W-0007 and W-0019 (workers) and W-0021 (teamLeader) must exist and be active';
  v_owner := (select coalesce(owner_id, id) from profiles where id = v_worker);
  assert (select coalesce(owner_id, id) from profiles where id = v_other) = v_owner
     and (select coalesce(owner_id, id) from profiles where id = v_leader) = v_owner, 'the three accounts must share one owner';

  insert into folders (owner_id, name) values (v_owner, 'ZZ 0085 verify project') returning id into v_p;
  insert into folders (owner_id, name) values (v_owner, 'ZZ 0085 verify project two') returning id into v_p2;
  insert into folders (owner_id, name, parent_folder_id) values (v_owner, 'ZZ 0085 verify AW', v_p) returning id into v_aw;
  insert into folders (owner_id, name, completed_at) values (v_owner, 'ZZ 0085 verify done project', now()) returning id into v_done;
  insert into folders (owner_id, name, parent_folder_id, completed_at) values (v_owner, 'ZZ 0085 verify done AW', v_p, now()) returning id into v_done_aw;
  insert into pr_project_settings (folder_id, owner_id, allow_requests)
  values (v_p, v_owner, true), (v_p2, v_owner, true), (v_done, v_owner, true);

  insert into pr_teams (owner_id, name) values (v_owner, 'ZZ 0085 verify team') returning id into v_team;
  insert into pr_team_members (owner_id, team_id, worker_id, is_leader)
  values (v_owner, v_team, v_leader, true), (v_owner, v_team, v_worker, false);
  insert into pr_catalog_items (owner_id, kind, name, spec, unit, category)
  values (v_owner, 'material', 'ZZ PVC pipe', '1/2 in, 3 m', 'pc', 'plumbing') returning id into v_item;
  select id into v_pm from construction_projects limit 1;

  insert into t_ctx values ('worker', v_worker), ('other', v_other), ('leader', v_leader), ('owner', v_owner),
    ('p', v_p), ('p2', v_p2), ('aw', v_aw), ('done', v_done), ('done_aw', v_done_aw), ('team', v_team), ('item', v_item),
    ('pm', coalesce(v_pm, gen_random_uuid())::text);
end $$;

-- ── 1. The weekly cutoff and batch defaults ──
do $$
declare b record;
begin
  assert pr_cutoff_after('2026-10-03 11:59:59+08') = '2026-10-03 12:00:00+08', 'Sat 11:59:59 → that Saturday noon';
  assert pr_cutoff_after('2026-10-03 12:00:00+08') = '2026-10-10 12:00:00+08', 'Sat 12:00 exactly → next Saturday';
  assert pr_cutoff_after('2026-10-04 08:00:00+08') = '2026-10-10 12:00:00+08', 'Sunday → next Saturday';
  assert pr_cutoff_after('2026-10-02 23:30:00+08') = '2026-10-03 12:00:00+08', 'Friday night → tomorrow noon';
  assert pr_cutoff_after('2026-10-03 03:59:00+00') = '2026-10-03 12:00:00+08', 'a UTC instant is read as Manila time';
  select * into b from pr_batches where id = pr_batch_for((select v::uuid from t_ctx where k = 'owner'), '2030-01-05 09:00:00+08');
  assert b.cutoff_at = '2030-01-05 12:00:00+08' and b.purchase_on = '2030-01-07' and b.delivery_on = '2030-01-09',
    'batch defaults: Saturday noon cutoff, Monday purchase, Wednesday delivery';
end $$;

-- ── 2. As the worker W-0007 ──
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', (select v from t_ctx where k = 'worker'), 'role', 'authenticated')::text, true);

do $$
declare
  v_p uuid := (select v::uuid from t_ctx where k = 'p');
  v_p2 uuid := (select v::uuid from t_ctx where k = 'p2');
  v_aw uuid := (select v::uuid from t_ctx where k = 'aw');
  v_done uuid := (select v::uuid from t_ctx where k = 'done');
  v_done_aw uuid := (select v::uuid from t_ctx where k = 'done_aw');
  v_team uuid := (select v::uuid from t_ctx where k = 'team');
  v_leader uuid := (select v::uuid from t_ctx where k = 'leader');
  v_item uuid := (select v::uuid from t_ctx where k = 'item');
  v_pm uuid := (select v::uuid from t_ctx where k = 'pm');
  v_line jsonb;
  r jsonb; r2 jsonb; mine jsonb;
begin
  v_line := jsonb_build_object('kind', 'material', 'catalog_item_id', v_item, 'description', 'ZZ PVC pipe',
                               'spec', '1/2 in, 3 m', 'unit', 'pc', 'category', 'plumbing', 'quantity', 10);

  assert exists (select 1 from pr_destinations() d where d.project_id = v_p and d.work_id = v_p and d.is_main and d.work_name = 'Main Contract'), 'Main Contract offered';
  assert exists (select 1 from pr_destinations() d where d.project_id = v_p and d.work_id = v_aw and not d.is_main), 'open Additional Works offered';
  assert not exists (select 1 from pr_destinations() d where d.project_id = v_done or d.work_id = v_done_aw), 'completed work never offered';
  assert exists (select 1 from pr_my_teams() t where t.team_id = v_team and not t.i_lead and jsonb_array_length(t.members) = 2), 'worker sees their team (2 members), not as leader';
  assert exists (select 1 from pr_catalog() c where c.id = v_item), 'catalogue visible';

  r := pr_submit_request('00000000-0000-4000-8000-000000000001', jsonb_build_object('folder_id', v_p, 'work_id', v_p, 'lines', jsonb_build_array(v_line)));
  assert r ? 'request_id' and jsonb_array_length(r -> 'line_ids') = 1, 'submit returns the request and its line ids';
  r2 := pr_submit_request('00000000-0000-4000-8000-000000000001', jsonb_build_object('folder_id', v_p, 'work_id', v_p, 'lines', jsonb_build_array(v_line, v_line)));
  assert r2 = r, 'a retried operation returns the first answer and writes nothing';
  mine := pr_my_requests(50);
  assert jsonb_array_length(mine) = 1, 'exactly one request after the retry';
  assert (mine -> 0 -> 'lines' -> 0 ->> 'needed')::numeric = 10, 'needed = 10';
  assert mine -> 0 ->> 'work_name' = 'Main Contract', 'Main Contract label';
  assert (mine -> 0 ->> 'mine')::boolean, 'marked as mine';
  insert into t_ctx values ('req1', r ->> 'request_id'), ('line1', r -> 'line_ids' ->> 0);

  r := pr_submit_request(gen_random_uuid(), jsonb_build_object('folder_id', v_p, 'work_id', v_aw, 'lines', jsonb_build_array(v_line)));
  assert r ? 'request_id', 'a request for open Additional Works is accepted';

  begin perform pr_submit_request(gen_random_uuid(), jsonb_build_object('folder_id', v_done, 'lines', jsonb_build_array(v_line)));
    assert false, 'completed project accepted';
  exception when others then assert sqlerrm = 'DESTINATION_CLOSED', 'completed project: ' || sqlerrm; end;
  begin perform pr_submit_request(gen_random_uuid(), jsonb_build_object('folder_id', v_p, 'work_id', v_done_aw, 'lines', jsonb_build_array(v_line)));
    assert false, 'completed Additional Works accepted';
  exception when others then assert sqlerrm = 'DESTINATION_CLOSED', 'completed AW: ' || sqlerrm; end;
  begin perform pr_submit_request(gen_random_uuid(), jsonb_build_object('folder_id', v_p2, 'work_id', v_aw, 'lines', jsonb_build_array(v_line)));
    assert false, 'Additional Works under the wrong project accepted';
  exception when others then assert sqlerrm = 'DESTINATION_CLOSED', 'wrong parent: ' || sqlerrm; end;
  begin perform pr_submit_request(gen_random_uuid(), jsonb_build_object('folder_id', v_pm, 'lines', jsonb_build_array(v_line)));
    assert false, 'a PM project id accepted';
  exception when others then assert sqlerrm = 'DESTINATION_CLOSED', 'PM id: ' || sqlerrm; end;
  begin perform pr_submit_request(gen_random_uuid(), jsonb_build_object('folder_id', v_p, 'lines', '[]'::jsonb));
    assert false, 'no lines accepted';
  exception when others then assert sqlerrm = 'NO_LINES', 'no lines: ' || sqlerrm; end;
  begin perform pr_submit_request(gen_random_uuid(), jsonb_build_object('folder_id', v_p, 'lines', jsonb_build_array(v_line || '{"quantity": 0}'::jsonb)));
    assert false, 'zero quantity accepted';
  exception when others then assert sqlerrm = 'BAD_QUANTITY', 'zero: ' || sqlerrm; end;
  begin perform pr_submit_request(gen_random_uuid(), jsonb_build_object('folder_id', v_p, 'lines', jsonb_build_array(v_line || '{"urgent": true}'::jsonb)));
    assert false, 'urgent without a reason accepted';
  exception when others then assert sqlerrm = 'URGENT_NEEDS_REASON', 'urgent: ' || sqlerrm; end;
  begin perform pr_submit_request(gen_random_uuid(), jsonb_build_object('folder_id', v_p, 'team_id', v_team,
          'lines', jsonb_build_array(v_line || jsonb_build_object('intended_member_id', v_leader))));
    assert false, 'a plain member named another member';
  exception when others then assert sqlerrm = 'NOT_TEAM_LEADER', 'member for another: ' || sqlerrm; end;

  r := pr_submit_request(gen_random_uuid(), jsonb_build_object('folder_id', v_p, 'team_id', v_team,
         'lines', jsonb_build_array(v_line || jsonb_build_object('urgent', true, 'urgent_reason', 'slab pour Friday', 'needed_by', '2026-10-09'))));
  assert r ? 'request_id', 'a member submits a team request for themselves';
  insert into t_ctx values ('team_req', r ->> 'request_id');

  assert (select count(*) from pr_requests) = 0 and (select count(*) from pr_lines) = 0
     and (select count(*) from pr_teams) = 0 and (select count(*) from pr_ops) = 0,
    'workers read pr_* tables only through RPCs';
end $$;

-- quantities, conflicts (still W-0007)
do $$
declare
  v_line uuid := (select v::uuid from t_ctx where k = 'line1');
  r jsonb; req jsonb; l jsonb;
begin
  r := pr_change_quantity('00000000-0000-4000-8000-000000000002', v_line, 1, 12);
  assert r ->> 'status' = 'applied' and (r ->> 'version')::int = 2 and (r ->> 'needed')::numeric = 12, '10 → 12 applied at version 2';
  assert pr_change_quantity('00000000-0000-4000-8000-000000000002', v_line, 1, 12) = r, 'a retried change returns the first answer';
  r := pr_change_quantity(gen_random_uuid(), v_line, 1, 8);
  assert r ->> 'status' = 'conflict' and (r ->> 'needed')::numeric = 12, 'an edit against an outdated version is a conflict, not an overwrite';
  select e into req from jsonb_array_elements(pr_my_requests(50)) e where e ->> 'id' = (select v from t_ctx where k = 'req1');
  l := req -> 'lines' -> 0;
  assert (l ->> 'needed')::numeric = 12 and (l ->> 'has_conflict')::boolean and jsonb_array_length(l -> 'portions') = 1,
    'still 12 in one portion, flagged as a conflict';
end $$;

-- ── 3. The spec §4B example: 10 arranged this week + 2 unarranged next week, reduced to 9 ──
reset role;
do $$
declare
  v_line uuid := (select v::uuid from t_ctx where k = 'line1');
  v_owner uuid := (select v::uuid from t_ctx where k = 'owner');
begin
  update pr_line_portions set quantity = 10, arranged_at = now() where line_id = v_line;
  insert into pr_line_portions (owner_id, line_id, batch_id, quantity, created_at)
  values (v_owner, v_line, pr_batch_for(v_owner, now() + interval '7 days'), 2, now() + interval '1 second');
end $$;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', (select v from t_ctx where k = 'worker'), 'role', 'authenticated')::text, true);
do $$
declare
  v_line uuid := (select v::uuid from t_ctx where k = 'line1');
  r jsonb; l jsonb;
begin
  r := pr_change_quantity(gen_random_uuid(), v_line, 2, 9);
  assert r ->> 'status' = 'applied' and (r ->> 'needed')::numeric = 9, '12 → 9 applied';
  select e -> 'lines' -> 0 into l from jsonb_array_elements(pr_my_requests(50)) e where e ->> 'id' = (select v from t_ctx where k = 'req1');
  assert jsonb_array_length(l -> 'portions') = 1, 'the later unarranged 2 are removed first';
  assert (l -> 'portions' -> 0 ->> 'quantity')::numeric = 10 and (l -> 'portions' -> 0 ->> 'pending_reduction')::numeric = 1
     and (l -> 'portions' -> 0 ->> 'arranged')::boolean, 'the arranged 10 stay, with 1 flagged for the office';

  r := pr_change_quantity(gen_random_uuid(), v_line, 3, 10);
  select e -> 'lines' -> 0 into l from jsonb_array_elements(pr_my_requests(50)) e where e ->> 'id' = (select v from t_ctx where k = 'req1');
  assert jsonb_array_length(l -> 'portions') = 1 and (l -> 'portions' -> 0 ->> 'pending_reduction')::numeric = 0,
    '9 → 10 takes back the flagged 1 instead of buying one more';

  r := pr_cancel_line(gen_random_uuid(), v_line);
  assert r ->> 'status' = 'cancelled', 'line cancelled';
  select e -> 'lines' -> 0 into l from jsonb_array_elements(pr_my_requests(50)) e where e ->> 'id' = (select v from t_ctx where k = 'req1');
  assert l ->> 'status' = 'cancelled' and (l ->> 'needed')::numeric = 0
     and (l -> 'portions' -> 0 ->> 'pending_reduction')::numeric = 10, 'cancel flags the arranged 10, erases nothing';
  begin perform pr_change_quantity(gen_random_uuid(), v_line, 5, 3);
    assert false, 'a cancelled line accepted a change';
  exception when others then assert sqlerrm = 'LINE_CLOSED', 'cancelled line: ' || sqlerrm; end;
end $$;

-- ── 4. Photos (object inserted by the database owner, standing in for the app's upload) ──
reset role;
insert into storage.objects (bucket_id, name, owner)
select 'request-photos', (select v from t_ctx where k = 'worker') || '/' || (select v from t_ctx where k = 'req1') || '/p1.jpg',
       (select v::uuid from t_ctx where k = 'worker');
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', (select v from t_ctx where k = 'worker'), 'role', 'authenticated')::text, true);
do $$
declare
  v_req uuid := (select v::uuid from t_ctx where k = 'req1');
  v_path text := (select v from t_ctx where k = 'worker') || '/' || (select v from t_ctx where k = 'req1') || '/p1.jpg';
  r jsonb;
begin
  r := pr_attach_photo(gen_random_uuid(), v_req, null, v_path);
  assert r ? 'photo_id', 'photo attached';
  assert (select count(*) from storage.objects where bucket_id = 'request-photos') = 1, 'the requester sees their photo';
  begin perform pr_attach_photo(gen_random_uuid(), v_req, null, 'someone-else/' || v_req || '/p2.jpg');
    assert false, 'a foreign path accepted';
  exception when others then assert sqlerrm = 'BAD_PATH', 'foreign path: ' || sqlerrm; end;
  begin perform pr_attach_photo(gen_random_uuid(), v_req, null, (select v from t_ctx where k = 'worker') || '/' || v_req || '/missing.jpg');
    assert false, 'a photo that was never uploaded accepted';
  exception when others then assert sqlerrm = 'PHOTO_NOT_UPLOADED', 'missing photo: ' || sqlerrm; end;
end $$;

-- ── 5. As the team leader W-0021 ──
select set_config('request.jwt.claims', json_build_object('sub', (select v from t_ctx where k = 'leader'), 'role', 'authenticated')::text, true);
do $$
declare
  v_p uuid := (select v::uuid from t_ctx where k = 'p');
  v_team uuid := (select v::uuid from t_ctx where k = 'team');
  v_worker uuid := (select v::uuid from t_ctx where k = 'worker');
  ids text[];
  r jsonb;
begin
  assert exists (select 1 from pr_my_teams() t where t.team_id = v_team and t.i_lead), 'the leader leads the team';
  select array_agg(e ->> 'id') into ids from jsonb_array_elements(pr_my_requests(50)) e;
  assert (select v from t_ctx where k = 'team_req') = any (ids), 'the leader sees the member''s team request';
  assert not ((select v from t_ctx where k = 'req1') = any (ids)), 'the leader does not see the member''s individual request';
  r := pr_submit_request(gen_random_uuid(), jsonb_build_object('folder_id', v_p, 'team_id', v_team,
         'lines', jsonb_build_array(jsonb_build_object('kind', 'material', 'description', 'Outlet, 2-gang', 'unit', 'pc',
                                                       'quantity', 6, 'intended_member_id', v_worker))));
  assert r ? 'request_id', 'the leader submits for a member';
  begin perform pr_change_quantity(gen_random_uuid(), (select v::uuid from t_ctx where k = 'line1'), 6, 1);
    assert false, 'the leader changed a member''s line';
  exception when others then assert sqlerrm = 'NOT_YOUR_LINE', 'leader edit: ' || sqlerrm; end;
  assert (select count(*) from storage.objects where bucket_id = 'request-photos') = 0, 'an individual request''s photo is not the leader''s to see';
end $$;

-- ── 6. As the other worker W-0019 (in no team) ──
select set_config('request.jwt.claims', json_build_object('sub', (select v from t_ctx where k = 'other'), 'role', 'authenticated')::text, true);
do $$
declare
  v_p uuid := (select v::uuid from t_ctx where k = 'p');
  v_team uuid := (select v::uuid from t_ctx where k = 'team');
  n int;
begin
  assert jsonb_array_length(pr_my_requests(50)) = 0, 'no access to colleagues'' requests';
  assert not exists (select 1 from pr_my_teams()), 'in no team';
  begin perform pr_submit_request(gen_random_uuid(), jsonb_build_object('folder_id', v_p, 'team_id', v_team,
          'lines', jsonb_build_array(jsonb_build_object('kind', 'tool', 'description', 'Drill', 'unit', 'pc', 'quantity', 1))));
    assert false, 'used a team they are not in';
  exception when others then assert sqlerrm = 'NOT_IN_TEAM', 'foreign team: ' || sqlerrm; end;
  begin perform pr_cancel_request(gen_random_uuid(), (select v::uuid from t_ctx where k = 'req1'));
    assert false, 'cancelled a colleague''s request';
  exception when others then assert sqlerrm = 'NOT_YOUR_REQUEST', 'foreign cancel: ' || sqlerrm; end;
  assert (select count(*) from storage.objects where bucket_id = 'request-photos') = 0, 'a colleague''s photo is invisible';

  -- legacy tables: own rows only, no writes
  assert (select count(*) from requests where requested_by is distinct from auth.uid()) = 0, 'legacy requests: own rows only';
  with d as (delete from request_items returning 1) select count(*) into n from d;
  assert n = 0, 'legacy request_items: a worker deletes nothing';
  begin
    insert into requests (requested_by, status) values (auth.uid(), 'pending');
    assert false, 'legacy requests: a worker inserted a row';
  exception when insufficient_privilege then null;
  end;
end $$;

-- ── 7. The office's view (as the database owner) ──
reset role;
do $$
begin
  assert (select count(*) from pr_line_conflicts where line_id = (select v::uuid from t_ctx where k = 'line1')) = 1, 'the conflict is kept for the office';
  assert (select count(*) from pr_events where request_id = (select v::uuid from t_ctx where k = 'req1')) >= 6, 'history recorded';
  assert (select count(*) from pr_requests where client_op_id = '00000000-0000-4000-8000-000000000001') = 1, 'one request for the retried op';
end $$;

select 'pr verify: all checks passed' as result;
```

- [ ] **Step 2: Static check** — `node tests/workmate-requests.test.js` and `npm test` still pass (the verify script is not part of `npm test`).

- [ ] **Step 3: Dry run (controller only, never a subagent; ask the user first — a dry run sends DDL to the live project even though it is rolled back, and the user declined an unannounced one on 2026-10-02)** — with the Supabase MCP `execute_sql` on project `hqbgduyonlbbsvjuapre`, run ONE call whose query is `begin;` + the full text of `0085_workmate_requests.sql` + the full text of `0085_verify.sql` + `rollback;`. Expected: the last result is `pr verify: all checks passed`. Any failure: record it, fix the migration or the script through the review loop, and repeat. Confirm afterwards that nothing persisted: `select count(*) from information_schema.tables where table_name like 'pr\_%'` → `0`.

- [ ] **Step 4: The user applies 0085** — the user applies `supabase/migrations/0085_workmate_requests.sql` to the live project the way they applied 0082/0083. Then the controller verifies (the user's "applied" has not always matched the live database):
  - `select count(*) from information_schema.tables where table_schema = 'public' and table_name like 'pr\_%'` → `12`;
  - `select public from storage.buckets where id = 'request-photos'` → `false`;
  - `select policyname from pg_policies where tablename = 'requests'` → contains `requests_read` and `requests_admin_write` only;
  - then runs `begin;` + `0085_verify.sql` + `rollback;` → `pr verify: all checks passed`.

- [ ] **Step 5: Execution notes** — append `## Execution notes` to this plan: deviations, the dry-run result, the apply date and the post-apply verification result.

- [ ] **Step 6: Stop — no commit.** Tell the user which files are ready to commit.

---

## Self-review (done while writing)

- **Spec 1a coverage (server side):** teams + explicit leader (Task 1, 4, 6); catalogue + unlisted items (`catalog_item_id` optional, Task 1/4 — matching is plan 1a-2); Main Contract / Additional Works (Task 1 `pr_work_open`, Task 3); manual *Allow requests* (Task 1); completed-project rules for parent and child (Task 1, 4, 5); weekly batches with Saturday-noon Manila cutoff by received time (Task 1, 4); per-item urgency (Task 2, 4); quantity portions by batch incl. the spec's 10+2→9 example (Task 5, verified in Task 8 §3); private request photos (Task 6); offline-safe retries and conflicts (Task 2, 4, 5); legacy broad access removed on the server (Task 7); PM never a destination (Task 1, 4, verified with a real PM id); no money (Task 1 test).
- **Deferred to 1a-2 (office):** marking portions arranged, acting on `pending_reduction`, resolving conflicts, matching unlisted items, editing batch dates, team/catalogue/allow screens. **Deferred to 1a-3 (app):** the Requests screens and offline queue.
- **Placeholder scan:** none.
- **Names across tasks:** `pr_is_requester`, `pr_person_name`, `pr_is_current_member`, `pr_is_current_leader`, `pr_project_open`, `pr_work_open`, `pr_cutoff_after`, `pr_batch_for`, `pr_apply_quantity`, the nine worker RPCs and two policy helpers — the same signatures in Tasks 1–8.

## Execution notes (2026-10-02)

Run subagent-driven in four batches (Tasks 1+2, 3+4, 5+6, 7+8), no commits, no helper touched the database. Final: 43 static tests, `npm test` exit 0. Dry run (migration + verify, rolled back) passed in the SQL editor at 21:47; **0085 applied live 2026-10-02 21:49** and verified by query: 12 `pr_*` tables all with RLS, 20 `pr_*` functions, `request-photos` private, 3 photo policies, legacy `requests` = `requests_admin_write`, `requests_read`; legacy `request_items` = four admin policies + `request_items_worker_read`; `pr_batch_for` not callable by `authenticated`; `pr_submit_request` callable by `authenticated`, not `anon`.

Deviations from the plan text, and why:

- **No `for all` policies** — `tests/storage-access.test.js` bans them in migrations ≥ 0081. Setup tables get `_admin_read/_insert/_update` (no delete: deactivate instead); legacy `request_items` gets four per-command owner/staff policies.
- **Tenant scoping** — every `pr_*` policy is `(is_owner() or is_staff()) and can_access(owner_id)`; `pr_ops` (no owner column) is scoped through its actor's owner; the office storage-read policy checks `can_access` on the request's owner.
- **Hardening from reviews** — `pg_advisory_xact_lock` per (user, op) before every `pr_ops` lookup; BAD_QUANTITY for more than 3 decimals; an increase only grows a portion that is still unarranged (row lock + re-check); an unchanged quantity is a no-op.
- **Request list rule** — `pr_project_open` = Allow requests OR (today's Attendance picker rule: geofence rule AND not hidden). Spec §3.
- **`pr_project_settings.folder_id on delete cascade`**; `pr_requests` keep no-action FKs (history).
- **`0085_verify.sql`** wraps itself in begin/rollback; the batch-defaults check was fixed after the first dry run (a row inserted by a function inside a WHERE is invisible to that same statement).

Carried to 1a-2 (office): `deleteFolder` / Additional Works delete must refuse when `pr_requests` exist before deleting anything; `pr_batches` changes only `purchase_on`/`delivery_on`, through an RPC or guard; office RPCs that arrange portions or resolve reductions lock the `pr_lines` row first.
Carried to 1a-3 (app): chain base versions for queued edits to one line; never reuse an op id across RPCs; a clear message for an owner-less account (currently DESTINATION_CLOSED).
