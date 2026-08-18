# Attendance Backend Foundation (Phase A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the database foundation for construction worker attendance — three tables, two `profiles` columns, two idempotent RPCs, RLS, and a private photo bucket — verifiable on its own before any Android code exists.

**Architecture:** All attendance writes go through two `security definer` Postgres functions (`attendance_time_in`, `attendance_time_out`) rather than direct table access. Each is idempotent on a client-generated `event_id`, so an offline queue can replay a submission any number of times without creating duplicates. The MVP §14 status machine lives in SQL next to the unique constraint that backs it, and `total_minutes` is computed server-side so the worker app and admin web can never disagree.

**Tech Stack:** PostgreSQL 15 (Supabase), plpgsql, Supabase Storage, Supabase RLS. No build step; the web side is plain vanilla JS.

**Spec:** [docs/superpowers/specs/2026-08-18-construction-attendance-android-design.md](../specs/2026-08-18-construction-attendance-android-design.md)

## Global Constraints

- **Migration number is `0050`.** Highest on disk is `0049_quotation_submitted_by.sql`. Never reuse a number. `supabase/migrations/README.md` line 9 still says "next = 0045" — it is stale and gets corrected in Task 9.
- **Every statement must be idempotent** — `create table if not exists`, `create index if not exists`, `add column if not exists`, `create or replace function`, `drop policy if exists` before `create policy`.
- **Migrations are immutable once applied.** `0050` is not yet applied, so it may be edited freely during this plan. Once it is pushed to production, fix mistakes with `0051`.
- **Never run `npm run build`.** It is a hard-fail stub. `js/portal-app.compiled.js` is the source of truth and is edited directly.
- **A new data field needs a real DB column.** `js/supabase-config.js` maps camelCase to snake_case; writing a field whose column does not exist makes the save fail *silently*.
- **Attendance is isolated from the money model.** No statement in this plan may reference `folders`, `projects`, `construction_projects`, `expenses`, `payroll`, `labor_contracts`, `invoices`, `payment_requests` or `boq_documents`.
- **Timezone: `Asia/Manila` (UTC+8).** `work_date` is derived as `(captured_at at time zone 'Asia/Manila')::date`. Never use a UTC date for a local day key.
- **Error tokens are the API.** Every domain error raises `errcode = 'P0001'` with one of these exact MESSAGE strings, which the Kotlin client maps to bilingual copy: `AUTH_REQUIRED`, `EVENT_ID_REQUIRED`, `EVENT_ID_CONFLICT`, `NOT_A_WORKER`, `ACCOUNT_INACTIVE`, `CAPTURED_IN_FUTURE`, `PROJECT_UNAVAILABLE`, `ALREADY_TIMED_IN`, `NOT_TIMED_IN`, `ALREADY_COMPLETE`, `TIMEOUT_BEFORE_TIMEIN`, `SHIFT_TOO_LONG`.
- **Existing helpers to reuse, not reinvent** (all from `0002_rls.sql`, applied to live): `auth_role()`, `is_owner()`, `is_staff()`, `is_worker()`, `data_owner_id()`, `can_access(p_owner uuid)`.
- **`profiles` columns that already exist:** `id, kind, role, owner_id, email, first_name, last_name, display_name, status, agreement_accepted, legacy_uid, created_at, updated_at`. `status` is `'active'`/`'inactive'`. There is **no** `position` and **no** `worker_no`.

---

## How this gets applied (read before Task 1)

There is **no `supabase/config.toml` and no Supabase CLI on PATH.** Migrations in this repo are applied by pasting the migration file into the Supabase SQL editor. The house rule in `supabase/migrations/README.md` is *"nothing touches the schema except a file in this folder"* — that forbids ad-hoc edits, not the editor itself. Write the file, paste the file, commit the file.

Two things make iterating this way acceptable here:

1. **`0050` is purely additive.** New tables, new functions, new policies on new tables, and two new nullable columns. It drops nothing and rewrites no existing data, so re-running it is safe and a mistake is recoverable.
2. **Every statement is idempotent**, so pasting the file twice is a no-op.

The one statement that touches a live shared table is the `alter table profiles` in Task 2. It gets its own verification step.

**Optional but recommended:** installing the Supabase CLI (`npm i -g supabase`, then `supabase link`) would enable `supabase db reset` against a local or branch database and is the real fix for the drift documented in `README.md`. It is out of scope for this plan.

---

### Task 1: Pre-flight — establish live schema truth

`CLAUDE.md` warns the live DB has drifted from the migrations twice this year, and `supabase/migrations/README.md` says everything past `0027` is unverified, `0041` and `0044` are **not** applied. Assume nothing.

**Files:**
- Create: `docs/superpowers/plans/2026-08-18-attendance-preflight-results.md` (scratch record, deleted in Task 9)

- [ ] **Step 1: Record which migrations the CLI knows about**

Run in the Supabase SQL editor:

```sql
select version, name
from supabase_migrations.schema_migrations
order by version;
```

Note the caveat from `README.md`: this table only records CLI pushes. A missing row means "check whether the object exists", not "not applied".

- [ ] **Step 2: Confirm the four things Task 2 depends on**

```sql
-- A. profiles must NOT already have position / worker_no
select column_name, data_type
from information_schema.columns
where table_schema = 'public' and table_name = 'profiles'
  and column_name in ('position', 'worker_no', 'status', 'role', 'owner_id');

-- B. the 0002 helper functions must exist
select proname
from pg_proc
where proname in ('auth_role','is_owner','is_staff','is_worker','data_owner_id','can_access')
order by proname;

-- C. no attendance objects may exist yet
select table_name
from information_schema.tables
where table_schema = 'public' and table_name like 'attendance%';

-- D. the highest migration number actually on disk
--    (run in a shell, not SQL) — confirms 0049 is still the max
```

**Expected:** A returns exactly `status`, `role`, `owner_id` (3 rows — **not** `position` or `worker_no`). B returns all 6 names. C returns 0 rows.

- [ ] **Step 3: Write down the answers**

Create `docs/superpowers/plans/2026-08-18-attendance-preflight-results.md` recording the output of each query and the date. If A returns `position` or `worker_no`, **stop** — the live DB has drifted from `0001_init.sql` and Task 2's `add column if not exists` will silently keep an existing column of possibly the wrong type. Report it before continuing.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/plans/2026-08-18-attendance-preflight-results.md
git commit -m "chore: record live schema pre-flight for attendance migration 0050"
```

---

### Task 2: Tables, `profiles` columns, and `worker_no` assignment

**Files:**
- Create: `supabase/migrations/0050_attendance.sql`
- Test: `supabase/tests/attendance_checks.sql` (created here, extended in Tasks 5–7)

**Interfaces:**
- Consumes: `profiles`, `auth.users`, and the `0002_rls.sql` helpers.
- Produces: tables `attendance_projects` (PK `bigint`), `attendance_records` (PK `uuid`), `attendance_terms_acceptances` (PK `uuid`); columns `profiles.position text`, `profiles.worker_no integer`; sequence `worker_no_seq`; function `assign_worker_no()`; trigger `profiles_worker_no_trg`; function `attendance_touch_updated_at()`.

- [ ] **Step 1: Write the failing test**

Create `supabase/tests/attendance_checks.sql`:

```sql
-- ════════════════════════════════════════════════════════════════════
-- Attendance — schema, RPC and RLS checks.
-- Run in the Supabase SQL editor AFTER applying 0050_attendance.sql.
--
-- Every block is wrapped in begin/rollback, so running this file leaves
-- NO data behind. Failures raise loudly via `assert` — a silent pass
-- means the assertion ran and held.
--
-- Kept separate from rls_checks.sql on purpose: attendance is a
-- deliberately isolated module (see the spec, §2), and its checks
-- travel with it.
--
-- ── 0. Fill these in from your database ──────────────────────────────
--    select id, email, role, owner_id, status from profiles
--     where role in ('owner','staff','worker') order by role;
--
--    <OWNER_UUID>   an owner profile
--    <WORKER_UUID>  a worker profile whose owner_id = <OWNER_UUID>
--    <STAFF_UUID>   a staff profile whose owner_id = <OWNER_UUID>
--    <OTHER_UUID>   any profile belonging to a DIFFERENT owner
-- ════════════════════════════════════════════════════════════════════

-- ╔══════════════════════════════════════════════════════════════════╗
-- ║ 1. Schema shape — tables, columns and constraints exist.          ║
-- ╚══════════════════════════════════════════════════════════════════╝
begin;
  do $$
  declare n int;
  begin
    select count(*) into n from information_schema.tables
     where table_schema = 'public'
       and table_name in ('attendance_projects','attendance_records','attendance_terms_acceptances');
    assert n = 3, format('expected 3 attendance tables, found %s', n);

    select count(*) into n from information_schema.columns
     where table_schema = 'public' and table_name = 'profiles'
       and column_name in ('position','worker_no');
    assert n = 2, format('expected profiles.position and profiles.worker_no, found %s', n);

    -- the one-record-per-day guarantee
    select count(*) into n from pg_indexes
     where schemaname = 'public' and indexname = 'attendance_worker_day_uniq';
    assert n = 1, 'attendance_worker_day_uniq is missing — one-record-per-day is unenforced';

    -- the idempotency guarantee
    select count(*) into n from pg_indexes
     where schemaname = 'public' and indexname = 'attendance_timein_event_uniq';
    assert n = 1, 'attendance_timein_event_uniq is missing — replay would duplicate';

    raise notice 'BLOCK 1 OK — schema shape';
  end $$;
rollback;

-- ╔══════════════════════════════════════════════════════════════════╗
-- ║ 2. Every existing worker got a worker_no; nobody else did.        ║
-- ╚══════════════════════════════════════════════════════════════════╝
begin;
  do $$
  declare n int;
  begin
    select count(*) into n from profiles
     where role in ('worker','teamLeader') and worker_no is null;
    assert n = 0, format('%s worker profiles have no worker_no', n);

    select count(*) into n from profiles
     where coalesce(role,'') not in ('worker','teamLeader') and worker_no is not null;
    assert n = 0, format('%s non-worker profiles were given a worker_no', n);

    raise notice 'BLOCK 2 OK — worker_no backfill';
  end $$;
rollback;
```

- [ ] **Step 2: Run it to verify it fails**

Paste blocks 1–2 into the Supabase SQL editor.

**Expected:** Block 1 fails with `expected 3 attendance tables, found 0`. (Block 2's first assertion may pass vacuously if `worker_no` does not exist — Postgres will instead error on the unknown column, which is also a correct failure.)

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/0050_attendance.sql`:

```sql
-- ════════════════════════════════════════════════════════════════════
-- 0050_attendance.sql
--
-- CONSTRUCTION WORKER ATTENDANCE — worker-recorded Time In / Time Out
-- with project, photo and description. Backs the native Android worker
-- app; the admin views live in admin.html.
--
-- ── DELIBERATELY ISOLATED — same rule as reimbursements (0041), the
--    warranty retention fund (0043) and quotations (0045):
--      · no money math reads these tables (Labor / Material / Overhead /
--        Spent / Earned / Profit all ignore them),
--      · they create no folder, construction_project, invoice,
--        payment_request, expense or payroll row,
--      · attendance hours are NOT the basis of pay. DAC's labour is
--        pakyaw / in-house capped pay (labor_contracts.agreed_amount
--        drawn down by payroll.contract_id). Hours here are a record of
--        attendance, nothing more. The MVP's own 9h45m example includes
--        an unpaid lunch break.
--    There is no peso column here, so the staff amount-hiding rule is
--    not implicated. Do NOT add a rate field "to make reports useful".
--
-- ── ALL WRITES GO THROUGH attendance_time_in / attendance_time_out.
--    Workers have SELECT on their own rows and no INSERT/UPDATE at all.
--    The RPCs are idempotent on a client-generated event_id so the app's
--    offline queue can replay a submission safely.
--
-- ── TIMEZONE: work_date is derived as
--    (captured_at at time zone 'Asia/Manila')::date.
--    PH is UTC+8; a UTC date key rolls back a day. See CLAUDE.md.
--
-- Idempotent — safe on the live DB and on a fresh database.
-- ════════════════════════════════════════════════════════════════════


-- ── 1. Shared updated_at trigger ────────────────────────────────────
create or replace function attendance_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;


-- ── 2. Projects — the list workers pick from ────────────────────────
-- Deliberately NOT folders or construction_projects: those are two
-- different id spaces in the money model (folders.id ≠
-- construction_projects.id) and attendance must stay out of both.
-- Only a name is needed for the MVP.
create table if not exists attendance_projects (
  id         bigint generated always as identity primary key,
  owner_id   uuid    not null references auth.users(id) on delete cascade,
  name       text    not null,
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists attendance_projects_owner_name_uniq
  on attendance_projects (owner_id, lower(name));
create index if not exists attendance_projects_owner_active_idx
  on attendance_projects (owner_id, is_active);

drop trigger if exists attendance_projects_touch on attendance_projects;
create trigger attendance_projects_touch before update on attendance_projects
  for each row execute function attendance_touch_updated_at();


-- ── 3. profiles: position + worker_no ───────────────────────────────
-- MVP §3 collects Position at account creation; the Profile screen and
-- the attendance record both display it. profiles has neither column
-- (the `position int default 0` columns elsewhere in 0001_init.sql are
-- list-ordering fields on unrelated tables).
alter table profiles
  add column if not exists position  text,
  add column if not exists worker_no integer;

create unique index if not exists profiles_worker_no_uniq
  on profiles (worker_no) where worker_no is not null;

create sequence if not exists worker_no_seq as integer start 1;

-- Assign a worker number the first time a row is a worker. Displayed as
-- W-0042. BEFORE trigger, so it only shapes NEW — it never fights the
-- profiles_guard trigger (0019), which runs first by name ('g' < 'w')
-- and only polices role/owner_id.
create or replace function assign_worker_no()
returns trigger language plpgsql as $$
begin
  if new.worker_no is null and coalesce(new.role,'') in ('worker','teamLeader') then
    new.worker_no := nextval('worker_no_seq');
  end if;
  return new;
end $$;

drop trigger if exists profiles_worker_no_trg on profiles;
create trigger profiles_worker_no_trg
  before insert or update of role on profiles
  for each row execute function assign_worker_no();

-- Backfill existing workers. Guarded on IS NULL, so replaying is a no-op.
update profiles
   set worker_no = nextval('worker_no_seq')
 where worker_no is null
   and coalesce(role,'') in ('worker','teamLeader');


-- ── 4. Attendance records — one row per worker per work_date ────────
create table if not exists attendance_records (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references auth.users(id) on delete cascade,
  worker_id   uuid not null references auth.users(id) on delete cascade,

  -- Snapshots. A later rename must not rewrite history.
  worker_name     text,
  worker_position text,

  work_date   date     not null,
  session_seq smallint not null default 1,   -- reserved for split shifts; always 1 in the MVP
  status      text     not null default 'working',

  timein_project_id   bigint references attendance_projects(id),
  timein_project_name text        not null,  -- snapshot
  timein_at           timestamptz not null,
  timein_photo_path   text        not null,  -- storage object path, never a URL
  timein_description  text,
  timein_lat          double precision,
  timein_lng          double precision,
  timein_accuracy_m   double precision,
  timein_event_id     uuid        not null,  -- client-generated; the idempotency key
  timein_was_offline  boolean     not null default false,
  timein_received_at  timestamptz not null default now(),

  timeout_project_id   bigint references attendance_projects(id),
  timeout_project_name text,
  timeout_at           timestamptz,
  timeout_photo_path   text,
  timeout_description  text,
  timeout_lat          double precision,
  timeout_lng          double precision,
  timeout_accuracy_m   double precision,
  timeout_event_id     uuid,
  timeout_was_offline  boolean,
  timeout_received_at  timestamptz,

  total_minutes integer,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- 'no_record' is the ABSENCE of a row, never a stored value.
  constraint attendance_status_chk
    check (status in ('working','complete','abandoned')),
  constraint attendance_complete_chk
    check (status <> 'complete' or timeout_at is not null),
  constraint attendance_order_chk
    check (timeout_at is null or timeout_at >= timein_at)
);

-- The one-record-per-day guarantee (spec decision #2).
create unique index if not exists attendance_worker_day_uniq
  on attendance_records (worker_id, work_date, session_seq);

-- The idempotency guarantees.
create unique index if not exists attendance_timein_event_uniq
  on attendance_records (timein_event_id);
create unique index if not exists attendance_timeout_event_uniq
  on attendance_records (timeout_event_id) where timeout_event_id is not null;

create index if not exists attendance_owner_date_idx
  on attendance_records (owner_id, work_date desc);
create index if not exists attendance_worker_date_idx
  on attendance_records (worker_id, work_date desc);

drop trigger if exists attendance_records_touch on attendance_records;
create trigger attendance_records_touch before update on attendance_records
  for each row execute function attendance_touch_updated_at();


-- ── 5. Terms acceptance — versioned ─────────────────────────────────
-- A NEW table, not the existing profiles.terms_* columns: those belong
-- to the partner / client sign-gate (0016–0020), a different document
-- and audience. Reusing them would break that gate.
create table if not exists attendance_terms_acceptances (
  id            uuid primary key default gen_random_uuid(),
  worker_id     uuid not null references auth.users(id) on delete cascade,
  terms_version text not null,
  accepted_at   timestamptz not null default now()
);

create unique index if not exists attendance_terms_worker_version_uniq
  on attendance_terms_acceptances (worker_id, terms_version);
```

- [ ] **Step 4: Apply it and run the test to verify it passes**

Paste `0050_attendance.sql` into the Supabase SQL editor, then re-run blocks 1–2 of `attendance_checks.sql`.

**Expected:** `BLOCK 1 OK — schema shape` and `BLOCK 2 OK — worker_no backfill`, no assertion errors.

- [ ] **Step 5: Verify the `profiles` change did no harm**

This is the only statement touching a live shared table.

```sql
-- No row lost its role, and worker numbers are unique and gap-free-enough.
select role, count(*) as n, count(worker_no) as with_no
from profiles group by role order by role;

-- The web shim reads these as workerNo / position — confirm the types.
select column_name, data_type, is_nullable
from information_schema.columns
where table_schema='public' and table_name='profiles'
  and column_name in ('position','worker_no');
```

**Expected:** `worker`/`teamLeader` rows have `with_no = n`; every other role has `with_no = 0`. `position` is `text`, `worker_no` is `integer`, both nullable.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/0050_attendance.sql supabase/tests/attendance_checks.sql
git commit -m "feat(attendance): add attendance tables, profiles.position/worker_no (0050)"
```

---

### Task 3: RLS policies

**Files:**
- Modify: `supabase/migrations/0050_attendance.sql` (append section 6)
- Test: `supabase/tests/attendance_checks.sql` (append block 3)

**Interfaces:**
- Consumes: `can_access(p_owner uuid)`, `data_owner_id()`, `is_owner()`, `is_staff()` from `0002_rls.sql`; the three tables from Task 2.
- Produces: RLS enabled on all three attendance tables. Workers get **SELECT only** — no INSERT or UPDATE policy exists for them anywhere, which is what forces writes through the RPCs.

- [ ] **Step 1: Write the failing test**

Append to `supabase/tests/attendance_checks.sql`:

```sql
-- ╔══════════════════════════════════════════════════════════════════╗
-- ║ 3. RLS — a worker may read own rows and active projects only,     ║
-- ║    and may NOT write attendance_records directly.                 ║
-- ╚══════════════════════════════════════════════════════════════════╝
begin;
  -- Seed as service role (bypasses RLS), then drop to the worker.
  insert into attendance_projects (owner_id, name, is_active)
  values ('<OWNER_UUID>'::uuid, 'ZZ Test Active',   true),
         ('<OWNER_UUID>'::uuid, 'ZZ Test Inactive', false);

  insert into attendance_records
    (owner_id, worker_id, work_date, timein_project_name, timein_at,
     timein_photo_path, timein_event_id)
  values
    ('<OWNER_UUID>'::uuid, '<WORKER_UUID>'::uuid, current_date,
     'ZZ Test Active', now(), 'zz/test/in.jpg', gen_random_uuid()),
    ('<OWNER_UUID>'::uuid, '<OTHER_UUID>'::uuid,  current_date,
     'ZZ Test Active', now(), 'zz/other/in.jpg', gen_random_uuid());

  set local role authenticated;
  set local request.jwt.claims =
    '{"sub":"<WORKER_UUID>","email":"worker@example.com","role":"authenticated"}';

  do $$
  declare n int; blocked boolean := false;
  begin
    -- own rows only
    select count(*) into n from attendance_records;
    assert n = 1, format('worker should see exactly 1 own record, saw %s', n);

    -- active projects only
    select count(*) into n from attendance_projects where name like 'ZZ Test%';
    assert n = 1, format('worker should see only the ACTIVE test project, saw %s', n);

    -- direct writes must be impossible
    begin
      insert into attendance_records
        (owner_id, worker_id, work_date, timein_project_name, timein_at,
         timein_photo_path, timein_event_id)
      values ('<OWNER_UUID>'::uuid, '<WORKER_UUID>'::uuid, current_date + 1,
              'ZZ Test Active', now(), 'zz/hack.jpg', gen_random_uuid());
    exception when insufficient_privilege or others then
      blocked := true;
    end;
    assert blocked, 'worker was able to INSERT attendance_records directly — RPC bypass is possible';

    raise notice 'BLOCK 3 OK — worker RLS';
  end $$;
rollback;

-- ╔══════════════════════════════════════════════════════════════════╗
-- ║ 4. Staff act as their owner and can read the team's records.       ║
-- ╚══════════════════════════════════════════════════════════════════╝
begin;
  insert into attendance_records
    (owner_id, worker_id, work_date, timein_project_name, timein_at,
     timein_photo_path, timein_event_id)
  values ('<OWNER_UUID>'::uuid, '<WORKER_UUID>'::uuid, current_date,
          'ZZ Test Active', now(), 'zz/test/in.jpg', gen_random_uuid());

  set local role authenticated;
  set local request.jwt.claims =
    '{"sub":"<STAFF_UUID>","email":"staff@example.com","role":"authenticated"}';

  do $$
  declare n int;
  begin
    select count(*) into n from attendance_records where worker_id = '<WORKER_UUID>'::uuid;
    assert n >= 1, 'staff cannot see their owner''s attendance records';
    raise notice 'BLOCK 4 OK — staff RLS';
  end $$;
rollback;
```

- [ ] **Step 2: Run it to verify it fails**

Replace the four placeholder UUIDs with real ones, then run blocks 3–4.

**Expected:** failure — with RLS not yet enabled, the worker sees **both** records and both projects, so block 3's first assertion fails with `worker should see exactly 1 own record, saw 2`.

- [ ] **Step 3: Append the RLS section to the migration**

Append to `supabase/migrations/0050_attendance.sql`:

```sql
-- ── 6. Row-Level Security ───────────────────────────────────────────
alter table attendance_projects           enable row level security;
alter table attendance_records            enable row level security;
alter table attendance_terms_acceptances  enable row level security;

-- Projects: owner + their staff manage; workers read the ACTIVE list of
-- the owner whose data they share.
drop policy if exists attendance_projects_admin_all on attendance_projects;
create policy attendance_projects_admin_all on attendance_projects
  for all to authenticated
  using      (can_access(owner_id))
  with check (can_access(owner_id));

drop policy if exists attendance_projects_worker_select on attendance_projects;
create policy attendance_projects_worker_select on attendance_projects
  for select to authenticated
  using (is_active and owner_id = data_owner_id());

-- Records: owner + staff read and update (the admin views, and closing a
-- dangling record). NO insert policy for anyone — inserts happen only
-- inside the security-definer RPCs.
drop policy if exists attendance_records_admin_select on attendance_records;
create policy attendance_records_admin_select on attendance_records
  for select to authenticated
  using (can_access(owner_id));

drop policy if exists attendance_records_admin_update on attendance_records;
create policy attendance_records_admin_update on attendance_records
  for update to authenticated
  using      (can_access(owner_id))
  with check (can_access(owner_id));

-- Workers read their own history. Deliberately SELECT-only: there is no
-- worker INSERT or UPDATE policy, which is what forces every write
-- through attendance_time_in / attendance_time_out.
drop policy if exists attendance_records_worker_select on attendance_records;
create policy attendance_records_worker_select on attendance_records
  for select to authenticated
  using (worker_id = auth.uid());

-- Terms: a worker records and reads their own acceptance; admins read.
drop policy if exists attendance_terms_worker_select on attendance_terms_acceptances;
create policy attendance_terms_worker_select on attendance_terms_acceptances
  for select to authenticated
  using (worker_id = auth.uid() or is_owner() or is_staff());

drop policy if exists attendance_terms_worker_insert on attendance_terms_acceptances;
create policy attendance_terms_worker_insert on attendance_terms_acceptances
  for insert to authenticated
  with check (worker_id = auth.uid());
```

- [ ] **Step 4: Re-apply and run the test to verify it passes**

Paste the appended section into the SQL editor, then re-run blocks 1–4.

**Expected:** `BLOCK 3 OK — worker RLS` and `BLOCK 4 OK — staff RLS`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0050_attendance.sql supabase/tests/attendance_checks.sql
git commit -m "feat(attendance): RLS — worker read-only, writes only via RPC"
```

---

### Task 4: Private photo bucket

**Files:**
- Modify: `supabase/migrations/0050_attendance.sql` (append section 7)
- Test: `supabase/tests/attendance_checks.sql` (append block 5)

**Interfaces:**
- Produces: private Storage bucket `attendance`; policies `attendance_worker_insert`, `attendance_worker_select`, `attendance_admin_select` on `storage.objects`.
- Path contract the Android app must follow: `{worker_id}/{work_date}/{in|out}-{event_id}.jpg`. The first path segment is the worker's uuid, which is what the policies key on via `storage.foldername(name)[1]`.

- [ ] **Step 1: Write the failing test**

Append to `supabase/tests/attendance_checks.sql`:

```sql
-- ╔══════════════════════════════════════════════════════════════════╗
-- ║ 5. Photo bucket exists, is PRIVATE, and is prefix-scoped.         ║
-- ╚══════════════════════════════════════════════════════════════════╝
begin;
  do $$
  declare v_public boolean; n int;
  begin
    select public into v_public from storage.buckets where id = 'attendance';
    assert v_public is not null, 'bucket "attendance" does not exist';
    assert v_public = false, 'bucket "attendance" is PUBLIC — worker photos must be private';

    select count(*) into n from pg_policies
     where schemaname = 'storage' and tablename = 'objects'
       and policyname in ('attendance_worker_insert','attendance_worker_select','attendance_admin_select');
    assert n = 3, format('expected 3 attendance storage policies, found %s', n);

    raise notice 'BLOCK 5 OK — photo bucket';
  end $$;
rollback;
```

- [ ] **Step 2: Run it to verify it fails**

**Expected:** `bucket "attendance" does not exist`.

- [ ] **Step 3: Append the storage section to the migration**

Append to `supabase/migrations/0050_attendance.sql`. Follows the policy convention of `0027_private_uploads.sql` / `0032_uploads_no_overwrite.sql`:

```sql
-- ── 7. Photo storage — private bucket, prefix-scoped ───────────────
-- Photos are FILES, never base64. The repo stores cost-item and
-- quotation images as base64 in jsonb, which is fine for four renders
-- per quote and fatal here: 20 workers × 2 photos × 250 workdays ≈
-- 10,000 photos a year.
--
-- Path contract: {worker_id}/{work_date}/{in|out}-{event_id}.jpg
-- The leading segment is the worker's uuid; the policies below key on it.
insert into storage.buckets (id, name, public)
values ('attendance', 'attendance', false)
on conflict (id) do update set public = false;

-- A worker may upload only under their own uuid prefix.
drop policy if exists attendance_worker_insert on storage.objects;
create policy attendance_worker_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'attendance'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- A worker may read back only their own photos.
drop policy if exists attendance_worker_select on storage.objects;
create policy attendance_worker_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'attendance'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Owner and staff may read every photo belonging to a worker they can
-- access. Signed-URL creation is gated by this SELECT.
drop policy if exists attendance_admin_select on storage.objects;
create policy attendance_admin_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'attendance'
    and exists (
      select 1 from profiles p
       where p.id::text = (storage.foldername(objects.name))[1]
         and can_access(coalesce(p.owner_id, p.id))
    )
  );

-- No UPDATE and no DELETE policy: an attendance photo is write-once.
-- Overwriting or removing evidence is not a worker capability, and the
-- RPCs never need it.
```

- [ ] **Step 4: Re-apply and run the test to verify it passes**

**Expected:** `BLOCK 5 OK — photo bucket`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0050_attendance.sql supabase/tests/attendance_checks.sql
git commit -m "feat(attendance): private photo bucket with prefix-scoped policies"
```

---

### Task 5: `attendance_time_in` RPC

**Files:**
- Modify: `supabase/migrations/0050_attendance.sql` (append section 8)
- Test: `supabase/tests/attendance_checks.sql` (append blocks 6–8)

**Interfaces:**
- Consumes: `attendance_records`, `attendance_projects`, `profiles`, the unique indexes from Task 2.
- Produces:

```
attendance_time_in(
  p_project_id  bigint,
  p_captured_at timestamptz,
  p_photo_path  text,
  p_event_id    uuid,
  p_description text             default null,
  p_lat         double precision default null,
  p_lng         double precision default null,
  p_accuracy_m  double precision default null,
  p_was_offline boolean          default false
) returns attendance_records
```

Returns the whole row. Raises `errcode 'P0001'` with MESSAGE one of `AUTH_REQUIRED`, `EVENT_ID_REQUIRED`, `EVENT_ID_CONFLICT`, `NOT_A_WORKER`, `ACCOUNT_INACTIVE`, `CAPTURED_IN_FUTURE`, `PROJECT_UNAVAILABLE`, `ALREADY_TIMED_IN`.

- [ ] **Step 1: Write the failing test**

Append to `supabase/tests/attendance_checks.sql`:

```sql
-- ╔══════════════════════════════════════════════════════════════════╗
-- ║ 6. Time In — happy path, then IDEMPOTENT REPLAY.                  ║
-- ║    The replay case is the whole reason this is an RPC.             ║
-- ╚══════════════════════════════════════════════════════════════════╝
begin;
  insert into attendance_projects (owner_id, name, is_active)
  values ('<OWNER_UUID>'::uuid, 'ZZ RPC Project', true);

  set local role authenticated;
  set local request.jwt.claims =
    '{"sub":"<WORKER_UUID>","email":"worker@example.com","role":"authenticated"}';

  do $$
  declare
    v_proj  bigint;
    v_event uuid := gen_random_uuid();
    v_a     attendance_records;
    v_b     attendance_records;
    n       int;
  begin
    select id into v_proj from attendance_projects where name = 'ZZ RPC Project';

    -- first call
    v_a := attendance_time_in(
      p_project_id  => v_proj,
      p_captured_at => timestamptz '2026-08-17 07:45:00+08',
      p_photo_path  => '<WORKER_UUID>/2026-08-17/in-x.jpg',
      p_event_id    => v_event,
      p_description => 'Started construction work at Block A.'
    );
    assert v_a.status = 'working', format('expected status working, got %s', v_a.status);
    assert v_a.work_date = date '2026-08-17',
      format('expected work_date 2026-08-17, got %s', v_a.work_date);
    assert v_a.timein_project_name = 'ZZ RPC Project', 'project name was not snapshotted';
    assert v_a.total_minutes is null, 'total_minutes must stay null until Time Out';

    -- SAME event id replayed — must return the same row, not a new one
    v_b := attendance_time_in(
      p_project_id  => v_proj,
      p_captured_at => timestamptz '2026-08-17 07:45:00+08',
      p_photo_path  => '<WORKER_UUID>/2026-08-17/in-x.jpg',
      p_event_id    => v_event
    );
    assert v_b.id = v_a.id, 'replay created a DIFFERENT record — idempotency is broken';

    select count(*) into n from attendance_records
     where worker_id = '<WORKER_UUID>'::uuid and work_date = date '2026-08-17';
    assert n = 1, format('replay left %s rows, expected 1', n);

    raise notice 'BLOCK 6 OK — Time In happy path + idempotent replay';
  end $$;
rollback;

-- ╔══════════════════════════════════════════════════════════════════╗
-- ║ 7. Time In twice with DIFFERENT event ids → ALREADY_TIMED_IN.     ║
-- ╚══════════════════════════════════════════════════════════════════╝
begin;
  insert into attendance_projects (owner_id, name, is_active)
  values ('<OWNER_UUID>'::uuid, 'ZZ RPC Project', true);

  set local role authenticated;
  set local request.jwt.claims =
    '{"sub":"<WORKER_UUID>","email":"worker@example.com","role":"authenticated"}';

  do $$
  declare v_proj bigint; v_msg text := ''; n int;
  begin
    select id into v_proj from attendance_projects where name = 'ZZ RPC Project';

    perform attendance_time_in(v_proj, timestamptz '2026-08-17 07:45:00+08',
              'p/in-1.jpg', gen_random_uuid());
    begin
      perform attendance_time_in(v_proj, timestamptz '2026-08-17 09:00:00+08',
                'p/in-2.jpg', gen_random_uuid());
    exception when others then v_msg := sqlerrm;
    end;
    assert v_msg = 'ALREADY_TIMED_IN', format('expected ALREADY_TIMED_IN, got "%s"', v_msg);

    select count(*) into n from attendance_records
     where worker_id = '<WORKER_UUID>'::uuid and work_date = date '2026-08-17';
    assert n = 1, format('duplicate Time In left %s rows', n);

    raise notice 'BLOCK 7 OK — duplicate Time In blocked';
  end $$;
rollback;

-- ╔══════════════════════════════════════════════════════════════════╗
-- ║ 8. UTC+8 DATE BOUNDARY — 23:50 and 00:10 Manila are different     ║
-- ║    work_dates. A UTC date key would collapse them. Also rejects   ║
-- ║    a future capture and an inactive project.                      ║
-- ╚══════════════════════════════════════════════════════════════════╝
begin;
  insert into attendance_projects (owner_id, name, is_active)
  values ('<OWNER_UUID>'::uuid, 'ZZ RPC Project',  true),
         ('<OWNER_UUID>'::uuid, 'ZZ RPC Inactive', false);

  set local role authenticated;
  set local request.jwt.claims =
    '{"sub":"<WORKER_UUID>","email":"worker@example.com","role":"authenticated"}';

  do $$
  declare
    v_proj bigint; v_off bigint; v_msg text := '';
    d1 date; d2 date;
  begin
    select id into v_proj from attendance_projects where name = 'ZZ RPC Project';
    select id into v_off  from attendance_projects where name = 'ZZ RPC Inactive';

    -- 2026-08-17 23:50+08 → work_date 2026-08-17 (in UTC it is 15:50 same day)
    d1 := (attendance_time_in(v_proj, timestamptz '2026-08-17 23:50:00+08',
             'p/a.jpg', gen_random_uuid())).work_date;
    assert d1 = date '2026-08-17', format('23:50 Manila gave work_date %s', d1);

    -- 2026-08-18 00:10+08 → work_date 2026-08-18 (in UTC it is 2026-08-17 16:10)
    d2 := (attendance_time_in(v_proj, timestamptz '2026-08-18 00:10:00+08',
             'p/b.jpg', gen_random_uuid())).work_date;
    assert d2 = date '2026-08-18', format('00:10 Manila gave work_date %s', d2);
    assert d1 <> d2, 'midnight boundary collapsed two days into one work_date';

    -- a capture in the future is rejected outright
    begin
      perform attendance_time_in(v_proj, now() + interval '10 minutes',
                'p/c.jpg', gen_random_uuid());
    exception when others then v_msg := sqlerrm;
    end;
    assert v_msg = 'CAPTURED_IN_FUTURE', format('expected CAPTURED_IN_FUTURE, got "%s"', v_msg);

    -- an inactive project is not selectable
    v_msg := '';
    begin
      perform attendance_time_in(v_off, timestamptz '2026-08-19 07:45:00+08',
                'p/d.jpg', gen_random_uuid());
    exception when others then v_msg := sqlerrm;
    end;
    assert v_msg = 'PROJECT_UNAVAILABLE', format('expected PROJECT_UNAVAILABLE, got "%s"', v_msg);

    raise notice 'BLOCK 8 OK — UTC+8 boundary, future capture, inactive project';
  end $$;
rollback;
```

- [ ] **Step 2: Run it to verify it fails**

**Expected:** `function attendance_time_in(...) does not exist`.

- [ ] **Step 3: Append the RPC to the migration**

Append to `supabase/migrations/0050_attendance.sql`:

```sql
-- ── 8. attendance_time_in ───────────────────────────────────────────
-- The ONLY way a Time In is written. security definer, so it writes past
-- the worker's SELECT-only RLS.
--
-- IDEMPOTENT ON p_event_id. The Android app generates the uuid at the
-- moment the worker taps SUBMIT and persists it in Room, so replaying a
-- queued submission returns the existing record instead of duplicating
-- it. This is the property the whole offline queue rests on.
create or replace function attendance_time_in(
  p_project_id  bigint,
  p_captured_at timestamptz,
  p_photo_path  text,
  p_event_id    uuid,
  p_description text             default null,
  p_lat         double precision default null,
  p_lng         double precision default null,
  p_accuracy_m  double precision default null,
  p_was_offline boolean          default false
) returns attendance_records
language plpgsql security definer set search_path = public as $$
declare
  v_uid   uuid := auth.uid();
  v_prof  record;
  v_owner uuid;
  v_date  date;
  v_name  text;
  v_row   attendance_records;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'P0001';
  end if;
  if p_event_id is null then
    raise exception 'EVENT_ID_REQUIRED' using errcode = 'P0001';
  end if;

  -- ── Idempotent replay: same event id → same row, unchanged.
  select * into v_row from attendance_records where timein_event_id = p_event_id;
  if found then
    if v_row.worker_id <> v_uid then
      raise exception 'EVENT_ID_CONFLICT' using errcode = 'P0001';
    end if;
    return v_row;
  end if;

  -- ── Who is calling. `position` is a Postgres col_name_keyword, so it is
  --    table-qualified and aliased rather than referenced bare.
  select p.id,
         p.role,
         p.owner_id,
         p.display_name,
         p.position                    as job_position,
         coalesce(p.status,'active')   as status
    into v_prof
    from profiles p where p.id = v_uid;

  if not found or coalesce(v_prof.role,'') not in ('worker','teamLeader') then
    raise exception 'NOT_A_WORKER' using errcode = 'P0001';
  end if;
  if v_prof.status <> 'active' then
    raise exception 'ACCOUNT_INACTIVE' using errcode = 'P0001';
  end if;
  v_owner := coalesce(v_prof.owner_id, v_uid);

  -- ── A capture cannot be in the future. 2 minutes of tolerance for
  --    ordinary device clock drift; anything beyond that is tampering.
  --    This is the ONE clock rule that applies to offline records too.
  if p_captured_at > now() + interval '2 minutes' then
    raise exception 'CAPTURED_IN_FUTURE' using errcode = 'P0001';
  end if;

  -- ── The project must belong to this worker's owner and be active.
  select name into v_name
    from attendance_projects
   where id = p_project_id and owner_id = v_owner and is_active;
  if not found then
    raise exception 'PROJECT_UNAVAILABLE' using errcode = 'P0001';
  end if;

  -- ── Local day key. PH is UTC+8; a UTC date rolls back a day.
  v_date := (p_captured_at at time zone 'Asia/Manila')::date;

  -- ── One record per worker per day (MVP §14).
  if exists (
    select 1 from attendance_records
     where worker_id = v_uid and work_date = v_date and session_seq = 1
  ) then
    raise exception 'ALREADY_TIMED_IN' using errcode = 'P0001';
  end if;

  insert into attendance_records (
    owner_id, worker_id, worker_name, worker_position,
    work_date, session_seq, status,
    timein_project_id, timein_project_name, timein_at, timein_photo_path,
    timein_description, timein_lat, timein_lng, timein_accuracy_m,
    timein_event_id, timein_was_offline, timein_received_at
  ) values (
    v_owner, v_uid, v_prof.display_name, v_prof.job_position,
    v_date, 1, 'working',
    p_project_id, v_name, p_captured_at, p_photo_path,
    nullif(btrim(coalesce(p_description,'')), ''), p_lat, p_lng, p_accuracy_m,
    p_event_id, coalesce(p_was_offline,false), now()
  )
  returning * into v_row;

  return v_row;
end $$;

revoke all on function attendance_time_in(bigint, timestamptz, text, uuid, text,
  double precision, double precision, double precision, boolean) from public;
grant execute on function attendance_time_in(bigint, timestamptz, text, uuid, text,
  double precision, double precision, double precision, boolean) to authenticated;
```

- [ ] **Step 4: Re-apply and run the test to verify it passes**

**Expected:** `BLOCK 6 OK`, `BLOCK 7 OK`, `BLOCK 8 OK`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0050_attendance.sql supabase/tests/attendance_checks.sql
git commit -m "feat(attendance): attendance_time_in RPC, idempotent on event_id"
```

---

### Task 6: `attendance_time_out` RPC

**Files:**
- Modify: `supabase/migrations/0050_attendance.sql` (append section 9)
- Test: `supabase/tests/attendance_checks.sql` (append blocks 9–10)

**Interfaces:**
- Consumes: `attendance_time_in` (to create the open record the tests time out of).
- Produces:

```
attendance_time_out(
  p_project_id  bigint,
  p_captured_at timestamptz,
  p_photo_path  text,
  p_event_id    uuid,
  p_description text             default null,
  p_lat         double precision default null,
  p_lng         double precision default null,
  p_accuracy_m  double precision default null,
  p_was_offline boolean          default false
) returns attendance_records
```

Sets `status = 'complete'` and `total_minutes`. Raises `NOT_TIMED_IN`, `ALREADY_COMPLETE`, `TIMEOUT_BEFORE_TIMEIN`, `SHIFT_TOO_LONG`, plus the same auth/project/clock errors as Task 5.

- [ ] **Step 1: Write the failing test**

Append to `supabase/tests/attendance_checks.sql`:

```sql
-- ╔══════════════════════════════════════════════════════════════════╗
-- ║ 9. Time Out — total_minutes, independent project, replay,         ║
-- ║    and the MVP's own worked example: 7:45 AM → 5:30 PM = 585.     ║
-- ╚══════════════════════════════════════════════════════════════════╝
begin;
  insert into attendance_projects (owner_id, name, is_active)
  values ('<OWNER_UUID>'::uuid, 'ZZ Site A', true),
         ('<OWNER_UUID>'::uuid, 'ZZ Site B', true);

  set local role authenticated;
  set local request.jwt.claims =
    '{"sub":"<WORKER_UUID>","email":"worker@example.com","role":"authenticated"}';

  do $$
  declare
    a bigint; b bigint;
    v_out uuid := gen_random_uuid();
    r attendance_records; r2 attendance_records;
    n int;
  begin
    select id into a from attendance_projects where name = 'ZZ Site A';
    select id into b from attendance_projects where name = 'ZZ Site B';

    perform attendance_time_in(a, timestamptz '2026-08-17 07:45:00+08',
              'p/in.jpg', gen_random_uuid());

    -- Time Out on a DIFFERENT project — MVP §13 stores both independently
    r := attendance_time_out(
      p_project_id  => b,
      p_captured_at => timestamptz '2026-08-17 17:30:00+08',
      p_photo_path  => 'p/out.jpg',
      p_event_id    => v_out,
      p_description => 'Finished construction work at Block A.'
    );

    assert r.status = 'complete', format('expected complete, got %s', r.status);
    assert r.total_minutes = 585,
      format('7:45 AM to 5:30 PM must be 585 minutes (9h45m), got %s', r.total_minutes);
    assert r.timein_project_name  = 'ZZ Site A', 'Time In project was overwritten';
    assert r.timeout_project_name = 'ZZ Site B', 'Time Out project was not stored independently';
    assert r.work_date = date '2026-08-17', 'work_date changed on Time Out';

    -- replay returns the same row
    r2 := attendance_time_out(b, timestamptz '2026-08-17 17:30:00+08',
            'p/out.jpg', v_out);
    assert r2.id = r.id, 'Time Out replay created a different record';

    select count(*) into n from attendance_records
     where worker_id = '<WORKER_UUID>'::uuid and work_date = date '2026-08-17';
    assert n = 1, format('expected 1 row after Time Out + replay, got %s', n);

    raise notice 'BLOCK 9 OK — Time Out, 585 minutes, independent projects, replay';
  end $$;
rollback;

-- ╔══════════════════════════════════════════════════════════════════╗
-- ║ 10. Time Out error paths: no Time In, already complete,           ║
-- ║     and Time Out before Time In.                                  ║
-- ╚══════════════════════════════════════════════════════════════════╝
begin;
  insert into attendance_projects (owner_id, name, is_active)
  values ('<OWNER_UUID>'::uuid, 'ZZ Site A', true);

  set local role authenticated;
  set local request.jwt.claims =
    '{"sub":"<WORKER_UUID>","email":"worker@example.com","role":"authenticated"}';

  do $$
  declare a bigint; v_msg text := ''; n int;
  begin
    select id into a from attendance_projects where name = 'ZZ Site A';

    -- (a) Time Out with no Time In
    begin
      perform attendance_time_out(a, timestamptz '2026-08-17 17:30:00+08',
                'p/o.jpg', gen_random_uuid());
    exception when others then v_msg := sqlerrm;
    end;
    assert v_msg = 'NOT_TIMED_IN', format('expected NOT_TIMED_IN, got "%s"', v_msg);

    -- (b) Time Out BEFORE Time In
    perform attendance_time_in(a, timestamptz '2026-08-17 07:45:00+08',
              'p/i.jpg', gen_random_uuid());
    v_msg := '';
    begin
      perform attendance_time_out(a, timestamptz '2026-08-17 06:00:00+08',
                'p/o.jpg', gen_random_uuid());
    exception when others then v_msg := sqlerrm;
    end;
    assert v_msg = 'TIMEOUT_BEFORE_TIMEIN',
      format('expected TIMEOUT_BEFORE_TIMEIN, got "%s"', v_msg);

    -- (c) Time Out twice with different event ids
    perform attendance_time_out(a, timestamptz '2026-08-17 17:30:00+08',
              'p/o1.jpg', gen_random_uuid());
    v_msg := '';
    begin
      perform attendance_time_out(a, timestamptz '2026-08-17 18:00:00+08',
                'p/o2.jpg', gen_random_uuid());
    exception when others then v_msg := sqlerrm;
    end;
    assert v_msg = 'ALREADY_COMPLETE', format('expected ALREADY_COMPLETE, got "%s"', v_msg);

    select count(*) into n from attendance_records
     where worker_id = '<WORKER_UUID>'::uuid and work_date = date '2026-08-17';
    assert n = 1, format('error paths left %s rows, expected 1', n);

    raise notice 'BLOCK 10 OK — Time Out error paths';
  end $$;
rollback;

-- ╔══════════════════════════════════════════════════════════════════╗
-- ║ 10b. A forgotten Time Out cannot be closed a day late.            ║
-- ║      The night-shift window must not silently produce a 33h day.  ║
-- ╚══════════════════════════════════════════════════════════════════╝
begin;
  insert into attendance_projects (owner_id, name, is_active)
  values ('<OWNER_UUID>'::uuid, 'ZZ Site A', true);

  set local role authenticated;
  set local request.jwt.claims =
    '{"sub":"<WORKER_UUID>","email":"worker@example.com","role":"authenticated"}';

  do $$
  declare a bigint; v_msg text := ''; r attendance_records;
  begin
    select id into a from attendance_projects where name = 'ZZ Site A';

    -- timed in yesterday morning, never timed out
    perform attendance_time_in(a, timestamptz '2026-08-17 07:45:00+08',
              'p/i.jpg', gen_random_uuid());

    -- tries to time out the NEXT afternoon → 33 hours later
    begin
      perform attendance_time_out(a, timestamptz '2026-08-18 17:00:00+08',
                'p/o.jpg', gen_random_uuid());
    exception when others then v_msg := sqlerrm;
    end;
    assert v_msg = 'SHIFT_TOO_LONG',
      format('a 33-hour shift was accepted — expected SHIFT_TOO_LONG, got "%s"', v_msg);

    -- but a genuine NIGHT SHIFT crossing midnight still works:
    -- 22:00 on the 19th → 06:00 on the 20th is 8 hours.
    perform attendance_time_in(a, timestamptz '2026-08-19 22:00:00+08',
              'p/n-i.jpg', gen_random_uuid());
    r := attendance_time_out(a, timestamptz '2026-08-20 06:00:00+08',
           'p/n-o.jpg', gen_random_uuid());
    assert r.total_minutes = 480,
      format('night shift 22:00 to 06:00 must be 480 minutes, got %s', r.total_minutes);
    assert r.work_date = date '2026-08-19',
      format('night shift must stay on its Time In date, got %s', r.work_date);

    raise notice 'BLOCK 10b OK — 33h rejected, night shift preserved';
  end $$;
rollback;
```

- [ ] **Step 2: Run it to verify it fails**

**Expected:** `function attendance_time_out(...) does not exist`.

- [ ] **Step 3: Append the RPC to the migration**

Append to `supabase/migrations/0050_attendance.sql`:

```sql
-- ── 9. attendance_time_out ──────────────────────────────────────────
-- Closes the day's open record and computes total_minutes ONCE,
-- server-side, so the worker's history and the admin's report can never
-- disagree. Idempotent on p_event_id, exactly like Time In.
--
-- The Time Out project is stored INDEPENDENTLY of the Time In project
-- (MVP §13): a worker may be moved between sites during the day, and the
-- record must say what they actually selected at each action.
create or replace function attendance_time_out(
  p_project_id  bigint,
  p_captured_at timestamptz,
  p_photo_path  text,
  p_event_id    uuid,
  p_description text             default null,
  p_lat         double precision default null,
  p_lng         double precision default null,
  p_accuracy_m  double precision default null,
  p_was_offline boolean          default false
) returns attendance_records
language plpgsql security definer set search_path = public as $$
declare
  v_uid   uuid := auth.uid();
  v_prof  record;
  v_owner uuid;
  v_date  date;
  v_name  text;
  v_row   attendance_records;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'P0001';
  end if;
  if p_event_id is null then
    raise exception 'EVENT_ID_REQUIRED' using errcode = 'P0001';
  end if;

  -- ── Idempotent replay.
  select * into v_row from attendance_records where timeout_event_id = p_event_id;
  if found then
    if v_row.worker_id <> v_uid then
      raise exception 'EVENT_ID_CONFLICT' using errcode = 'P0001';
    end if;
    return v_row;
  end if;

  select p.id, p.role, p.owner_id, coalesce(p.status,'active') as status
    into v_prof
    from profiles p where p.id = v_uid;

  if not found or coalesce(v_prof.role,'') not in ('worker','teamLeader') then
    raise exception 'NOT_A_WORKER' using errcode = 'P0001';
  end if;
  if v_prof.status <> 'active' then
    raise exception 'ACCOUNT_INACTIVE' using errcode = 'P0001';
  end if;
  v_owner := coalesce(v_prof.owner_id, v_uid);

  if p_captured_at > now() + interval '2 minutes' then
    raise exception 'CAPTURED_IN_FUTURE' using errcode = 'P0001';
  end if;

  select name into v_name
    from attendance_projects
   where id = p_project_id and owner_id = v_owner and is_active;
  if not found then
    raise exception 'PROJECT_UNAVAILABLE' using errcode = 'P0001';
  end if;

  -- The Time Out belongs to the day its TIME IN was recorded on, so a
  -- shift ending after local midnight still closes the right record.
  v_date := (p_captured_at at time zone 'Asia/Manila')::date;

  select * into v_row
    from attendance_records
   where worker_id = v_uid
     and session_seq = 1
     and work_date in (v_date, v_date - 1)
     and status = 'working'
   order by work_date desc
   limit 1
     for update;

  if not found then
    -- Distinguish "nothing to close" from "already closed today".
    if exists (
      select 1 from attendance_records
       where worker_id = v_uid and work_date = v_date
         and session_seq = 1 and status = 'complete'
    ) then
      raise exception 'ALREADY_COMPLETE' using errcode = 'P0001';
    end if;
    raise exception 'NOT_TIMED_IN' using errcode = 'P0001';
  end if;

  if p_captured_at < v_row.timein_at then
    raise exception 'TIMEOUT_BEFORE_TIMEIN' using errcode = 'P0001';
  end if;

  -- The (v_date, v_date - 1) window above exists so a shift ending after
  -- local midnight closes the right record. Without a cap it also lets a
  -- forgotten Time Out be closed a day late, producing an absurd ~33h
  -- total that would flow straight into the admin's report. 18h is beyond
  -- any real construction shift but comfortably past a legitimate night
  -- one. A record that trips this needs the admin's 'abandoned' action,
  -- not a silent 33-hour day.
  if p_captured_at - v_row.timein_at > interval '18 hours' then
    raise exception 'SHIFT_TOO_LONG' using errcode = 'P0001';
  end if;

  update attendance_records
     set status               = 'complete',
         timeout_project_id   = p_project_id,
         timeout_project_name = v_name,
         timeout_at           = p_captured_at,
         timeout_photo_path   = p_photo_path,
         timeout_description  = nullif(btrim(coalesce(p_description,'')), ''),
         timeout_lat          = p_lat,
         timeout_lng          = p_lng,
         timeout_accuracy_m   = p_accuracy_m,
         timeout_event_id     = p_event_id,
         timeout_was_offline  = coalesce(p_was_offline,false),
         timeout_received_at  = now(),
         total_minutes        = floor(extract(epoch from (p_captured_at - timein_at)) / 60)::int
   where id = v_row.id
  returning * into v_row;

  return v_row;
end $$;

revoke all on function attendance_time_out(bigint, timestamptz, text, uuid, text,
  double precision, double precision, double precision, boolean) from public;
grant execute on function attendance_time_out(bigint, timestamptz, text, uuid, text,
  double precision, double precision, double precision, boolean) to authenticated;
```

- [ ] **Step 4: Re-apply and run the test to verify it passes**

**Expected:** `BLOCK 9 OK`, `BLOCK 10 OK`. Re-run blocks 1–10 top to bottom; all ten must report OK.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0050_attendance.sql supabase/tests/attendance_checks.sql
git commit -m "feat(attendance): attendance_time_out RPC, server-computed total_minutes"
```

---

### Task 7: Deactivated worker and cross-tenant isolation

The two security properties the tests do not yet cover: a deactivated account cannot record attendance, and one owner's worker can never see or write another owner's data.

**Files:**
- Test: `supabase/tests/attendance_checks.sql` (append blocks 11–12)
- Modify: `supabase/tests/rls_checks.sql` (pointer comment only)

**Interfaces:**
- Consumes: everything from Tasks 2–6. No new production code — this task is pure verification, and it may reveal a defect in Tasks 5–6 that must be fixed there.

- [ ] **Step 1: Write the failing test**

Append to `supabase/tests/attendance_checks.sql`:

```sql
-- ╔══════════════════════════════════════════════════════════════════╗
-- ║ 11. A DEACTIVATED worker cannot record attendance.                ║
-- ║     MVP §20 — deactivate must block the action, not just the UI.  ║
-- ╚══════════════════════════════════════════════════════════════════╝
begin;
  insert into attendance_projects (owner_id, name, is_active)
  values ('<OWNER_UUID>'::uuid, 'ZZ Site A', true);

  update profiles set status = 'inactive' where id = '<WORKER_UUID>'::uuid;

  set local role authenticated;
  set local request.jwt.claims =
    '{"sub":"<WORKER_UUID>","email":"worker@example.com","role":"authenticated"}';

  do $$
  declare a bigint; v_msg text := '';
  begin
    select id into a from attendance_projects where name = 'ZZ Site A';
    begin
      perform attendance_time_in(a, timestamptz '2026-08-17 07:45:00+08',
                'p/i.jpg', gen_random_uuid());
    exception when others then v_msg := sqlerrm;
    end;
    assert v_msg = 'ACCOUNT_INACTIVE',
      format('deactivated worker was not blocked — got "%s"', v_msg);
    raise notice 'BLOCK 11 OK — deactivated worker blocked';
  end $$;
rollback;  -- the status change is rolled back with everything else

-- ╔══════════════════════════════════════════════════════════════════╗
-- ║ 12. CROSS-TENANT — a worker cannot use another owner's project    ║
-- ║     and cannot see another owner's records.                       ║
-- ╚══════════════════════════════════════════════════════════════════╝
begin;
  -- A project belonging to a DIFFERENT owner.
  insert into attendance_projects (owner_id, name, is_active)
  values ('<OTHER_UUID>'::uuid, 'ZZ Foreign Project', true);

  insert into attendance_records
    (owner_id, worker_id, work_date, timein_project_name, timein_at,
     timein_photo_path, timein_event_id)
  values ('<OTHER_UUID>'::uuid, '<OTHER_UUID>'::uuid, current_date,
          'ZZ Foreign Project', now(), 'zz/foreign.jpg', gen_random_uuid());

  set local role authenticated;
  set local request.jwt.claims =
    '{"sub":"<WORKER_UUID>","email":"worker@example.com","role":"authenticated"}';

  do $$
  declare f bigint; v_msg text := ''; n int;
  begin
    -- Read through the worker's own RLS view. A non-STRICT `select into`
    -- with no visible row leaves f NULL rather than raising — so f being
    -- NULL is exactly the proof we want: the project is invisible.
    select id into f from attendance_projects where name = 'ZZ Foreign Project';
    assert f is null, 'worker can SEE another owner''s project in the picker';

    -- and cannot read the foreign record
    select count(*) into n from attendance_records
     where timein_project_name = 'ZZ Foreign Project';
    assert n = 0, format('worker can read %s of another owner''s records', n);

    raise notice 'BLOCK 12 OK — cross-tenant isolation';
  end $$;
rollback;
```

- [ ] **Step 2: Run blocks 11–12**

**Expected on a correct implementation:** both report OK. If block 11 fails with a different message, the `status` gate in Tasks 5/6 is wrong — fix it in the migration and re-run.

- [ ] **Step 3: Add the pointer to `rls_checks.sql`**

Append to the end of `supabase/tests/rls_checks.sql`:

```sql
-- ── Attendance (0050) ────────────────────────────────────────────────
-- Attendance is a deliberately isolated module; its RLS, RPC and
-- tenant-isolation checks live in supabase/tests/attendance_checks.sql.
-- Run that file too.
```

- [ ] **Step 4: Run the whole suite top to bottom**

Run all thirteen blocks of `attendance_checks.sql` in one paste.

**Expected:** thirteen `BLOCK n OK` notices (1–10, 10b, 11, 12), no assertion failures. Then confirm the file left nothing behind:

```sql
select count(*) as leftover_projects from attendance_projects where name like 'ZZ %';
select count(*) as leftover_records  from attendance_records  where timein_photo_path like 'zz/%' or timein_photo_path like 'p/%';
```

**Expected:** both `0` — every block is wrapped in `begin/rollback`.

- [ ] **Step 5: Commit**

```bash
git add supabase/tests/attendance_checks.sql supabase/tests/rls_checks.sql
git commit -m "test(attendance): deactivated-worker and cross-tenant isolation checks"
```

---

### Task 8: Wire `position` into the employee forms

`worker_no` needs no form work — the Task 2 trigger assigns it. Only `position` is admin-entered.

The `admin-create-user` Edge Function builds its `profileRow` from an explicit field whitelist, so `position` cannot be passed through it without a function deploy. Instead this follows the pattern already in the file: create the account, then `db.collection('users').doc(uid).update({...})` — exactly how the agreement state is seeded at `js/user-navigator.js:748-763`. **No Edge Function change and no deploy.**

**Files:**
- Modify: `admin.html:3220` (add-employee modal, after the Role block) and `admin.html:3514` (edit modal, after the Role block)
- Modify: `js/user-navigator.js` — 4 sites: the reset list (~line 668), `unSubmitAddEmployee` (~705, ~750), the edit prefill (~272), `unSubmitEdit` (~308)

**Interfaces:**
- Consumes: `profiles.position` from Task 2; the shim's camelCase→snake_case mapping means the JS field name is literally `position`.
- Produces: new DOM ids `emp-create-position` and `un-edit-position`.

- [ ] **Step 1: Add the field to the add-employee modal**

In `admin.html`, immediately after the Role `</div>` that closes at line 3220, insert:

```html
            <div style="margin-bottom:14px;">
                <label style="font-size:12px;font-weight:600;color:#374151;display:block;margin-bottom:5px;">Position / Trade</label>
                <input type="text" id="emp-create-position" placeholder="e.g. Mason, Carpenter, Foreman"
                    style="width:100%;box-sizing:border-box;padding:9px 12px;border:1.5px solid #d1d5db;border-radius:8px;font-size:13px;outline:none;font-family:inherit;">
                <div style="font-size:11px;color:#6b7280;margin-top:4px;">Shown on the worker's profile and on every attendance record.</div>
            </div>
```

- [ ] **Step 2: Add the field to the edit modal**

In `admin.html`, immediately after the `err-un-edit-role` `</div>` that closes at line 3514, insert:

```html
                <div style="margin-bottom:14px;">
                    <label style="font-size:12px;font-weight:600;color:#374151;display:block;margin-bottom:5px;">Position / Trade</label>
                    <input type="text" id="un-edit-position" placeholder="e.g. Mason, Carpenter, Foreman"
                        style="width:100%;box-sizing:border-box;padding:9px 12px;border:1.5px solid #d1d5db;border-radius:8px;font-size:13px;outline:none;font-family:inherit;">
                </div>
```

- [ ] **Step 3: Clear the new input when the add modal opens**

In `js/user-navigator.js`, in `unOpenAddEmployeeModal`, add the new id to the reset list (currently lines 668-672):

```js
        ['emp-create-firstname','emp-create-lastname','emp-create-email',
         'emp-create-password','emp-create-confirm','emp-create-position'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.value = '';
        });
```

- [ ] **Step 4: Read and save `position` on create**

In `unSubmitAddEmployee`, after the `termsAgreed` line (~713), add:

```js
        const position  = (document.getElementById('emp-create-position')?.value  || '').trim();
```

Then extend the post-create profile update. Replace the `if (termsAgreed) { … } else { … }` block (lines 749-760) so `position` is written on **both** branches:

```js
                if (termsAgreed) {
                    await db.collection('users').doc(uid).update({
                        position,
                        agreementAccepted   : true,
                        agreementAcceptedAt : acceptedAt,
                        agreementSignature  : firstName + ' ' + lastName
                    });
                } else {
                    await db.collection('users').doc(uid).update({
                        position,
                        agreementAccepted   : false,
                        agreementAcceptedAt : null
                    });
                }
```

`position` is deliberately **not** validated as required: MVP §3 lists it, but an admin creating a `staff` or `engineer` account has no trade to enter, and a blocking validation would make those accounts uncreatable.

- [ ] **Step 5: Prefill `position` when the edit modal opens**

In the edit-modal opener, alongside the `dnEl` / `roleEl` prefill (lines 272-275):

```js
        const dnEl   = document.getElementById('un-edit-displayname');
        const roleEl = document.getElementById('un-edit-role');
        const posEl  = document.getElementById('un-edit-position');
        if (dnEl)   dnEl.value   = user.name || '';
        if (roleEl) roleEl.value = user.role || '';
        if (posEl)  posEl.value  = user.position || '';
```

- [ ] **Step 6: Save `position` on edit**

In `unSubmitEdit`, replace line 308:

```js
        const position    = (document.getElementById('un-edit-position')?.value || '').trim();
        const updates = { displayName, role, position };
```

and after `user.role = role;` (line 317) add:

```js
            user.position = position;
```

- [ ] **Step 7: Confirm `position` is loaded into `_allUsers`**

The edit prefill in Step 5 reads `user.position`, so the list loader must carry it. Check the mapper around `js/user-navigator.js:82` (where `role: d.role || 'owner'` is built) and add `position: d.position || ''` if it is absent. Without this, opening the edit modal would blank a saved position on the next save — a silent data-loss bug.

- [ ] **Step 8: Verify**

```bash
node --check js/user-navigator.js
npm test
```

**Expected:** `node --check` silent (exit 0). `npm test` passes — attendance touches no money code, so a failure here means something crossed the isolation line.

Then in the browser: open `admin.html`, log in as owner, User Navigator → Employees. Create a worker with position `Mason`, reopen the edit modal and confirm `Mason` is still there. Then confirm it reached the database:

```sql
select display_name, role, position, worker_no
from profiles where role in ('worker','teamLeader')
order by worker_no desc limit 5;
```

**Expected:** the new worker has `position = 'Mason'` and a non-null `worker_no`. A null `position` here means the shim silently dropped it — re-check the column exists.

- [ ] **Step 9: Commit**

```bash
git add admin.html js/user-navigator.js
git commit -m "feat(attendance): capture worker Position on employee create and edit"
```

---

### Task 9: Documentation and close-out

**Files:**
- Modify: `docs/DATABASE_SCHEMA.md`
- Modify: `supabase/migrations/README.md`
- Modify: `docs/ARCHITECTURE.md`
- Delete: `docs/superpowers/plans/2026-08-18-attendance-preflight-results.md`

- [ ] **Step 1: Document the schema**

First, add the two new fields to the existing `users/{uid}` table in `docs/DATABASE_SCHEMA.md` §1 (the shim exposes them camelCased):

```markdown
| `position` | string | worker's trade ("Mason") — **(0050)** shown on the worker's profile and snapshotted onto each attendance record |
| `workerNo` | number | **(0050)** assigned by the `profiles_worker_no_trg` trigger for `worker`/`teamLeader` rows; displayed `W-0042`. Never set by the client |
```

Then add this new numbered section (renumber the "Defined in rules but UNUSED" section that currently follows §10):

```markdown
## 11. Attendance (`0050`) — worker Time In / Time Out

> **Deliberately isolated**, like `reimbursements` (0041), the warranty fund (0043) and
> `quotations` (0045). No money math reads these tables; attendance hours are **not** the basis of
> pay (labour is pakyaw, capped by `labor_contracts.agreed_amount`). There is no peso column here,
> so the staff amount-hiding rule does not apply. Written only by the native Android worker app
> (via RPC) and read by `js/attendance-admin.js`.

**All writes go through `attendance_time_in()` / `attendance_time_out()`.** Workers hold
`select` on their own rows and have no `insert`/`update` policy at all.

### `attendance_projects/{id}` — the picker list
| Field | Type | Notes |
|---|---|---|
| `id` | bigint identity | displayed `P-0004` |
| `ownerId` | uuid | tenant |
| `name` | string | unique per owner, case-insensitive |
| `isActive` | boolean | `false` hides it from the worker's picker only — past records keep their snapshot |
| `createdAt`, `updatedAt` | ts | |

### `attendance_records/{id}` — one row per worker per work date
| Field | Type | Notes |
|---|---|---|
| `id` | uuid | |
| `ownerId`, `workerId` | uuid | |
| `workerName`, `workerPosition` | string | **snapshot** at Time In — a rename must not rewrite history |
| `workDate` | date | `(captured_at at time zone 'Asia/Manila')::date`, computed **server-side**. PH is UTC+8; a UTC date key rolls back a day |
| `sessionSeq` | number | always `1` in the MVP; reserved so split shifts need no data migration |
| `status` | string | `working` \| `complete` \| `abandoned`. **`no_record` is the absence of a row**, never stored |
| `timeinProjectId` / `timeinProjectName` | bigint / string | id + snapshot |
| `timeinAt` | ts | the worker's captured instant |
| `timeinPhotoPath` | string | `attendance` bucket object path, **not** a URL |
| `timeinDescription` | string | optional |
| `timeinLat`, `timeinLng`, `timeinAccuracyM` | number | nullable, **admin-only** — never shown to the worker |
| `timeinEventId` | uuid | client-generated at tap; **unique**. The idempotency key |
| `timeinWasOffline` | boolean | captured with no signal |
| `timeinReceivedAt` | ts | server clock. Skew vs `timeinAt` is only meaningful when `wasOffline` is false |
| `timeout*` | — | same shape, all nullable. **Stored independently** — MVP §13, the worker may change site mid-day |
| `totalMinutes` | number | computed **server-side** on Time Out, so worker and admin cannot disagree |

`unique (worker_id, work_date, session_seq)` is the one-record-per-day guarantee.

### `attendance_terms_acceptances/{id}` — versioned T&C acceptance
| Field | Type | Notes |
|---|---|---|
| `workerId` | uuid | |
| `termsVersion` | string | unique with `workerId`; changing the Terms forces re-acceptance |
| `acceptedAt` | ts | the Profile screen shows the newest |

**Not** the `profiles.terms_*` columns — those belong to the partner/client sign-gate (0016–0020).

### Storage
Private bucket `attendance`, path `{worker_id}/{work_date}/{in|out}-{event_id}.jpg`. Worker
policies are scoped to their own uuid prefix; there is no `update` or `delete` policy, so a photo is
**write-once**. Photos are files, never base64.
```

- [ ] **Step 2: Correct the stale migration README**

`supabase/migrations/README.md` line 9 says next = 0045 with highest on disk 0044. Update it to next = **0051**, highest on disk `0050_attendance.sql`. Add to the status ledger whether `0050` is applied, with the date.

- [ ] **Step 3: Register the module**

Add attendance to the module map in `docs/ARCHITECTURE.md` §4, noting that the worker client is the separate native Android app and the admin UI arrives in phase C.

- [ ] **Step 4: Remove the scratch pre-flight file**

```bash
git rm docs/superpowers/plans/2026-08-18-attendance-preflight-results.md
```

Its findings belong in the README status ledger from Step 2, not in a loose file.

- [ ] **Step 5: Final verification**

```bash
node --check js/user-navigator.js
npm test
```

Re-run all thirteen blocks of `supabase/tests/attendance_checks.sql` one final time against the migrated database.

**Expected:** thirteen `BLOCK n OK`, `npm test` green, `node --check` silent.

- [ ] **Step 6: Commit**

```bash
git add docs/DATABASE_SCHEMA.md supabase/migrations/README.md docs/ARCHITECTURE.md
git commit -m "docs(attendance): schema, migration ledger and module map for 0050"
```

---

## Phase A done — what phase B can rely on

- `attendance_time_in(...)` and `attendance_time_out(...)`, idempotent on a client-generated `event_id`, returning the full `attendance_records` row.
- The twelve error tokens in Global Constraints, which the Kotlin layer maps to bilingual copy.
- `attendance_projects` filtered to `is_active` as the picker source, with `id` (`bigint`) and `name`.
- Storage bucket `attendance`, path `{worker_id}/{work_date}/{in|out}-{event_id}.jpg`, worker-prefix-scoped, write-once.
- `profiles.worker_no` (display `W-0042`) and `profiles.position` for the Profile screen.
- `attendance_terms_acceptances` for the first-login Terms gate.
