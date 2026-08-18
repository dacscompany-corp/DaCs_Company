-- ════════════════════════════════════════════════════════════════════
-- 0050_attendance.sql
--
-- CONSTRUCTION WORKER ATTENDANCE — worker-recorded Time In / Time Out
-- with project, photo and description. Backs the native Android worker
-- app; the admin views live in admin.html (phase C).
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
-- different id spaces in the money model (folders.id <>
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
-- MVP section 3 collects Position at account creation; the Profile
-- screen and the attendance record both display it. profiles has
-- neither column (the `position int default 0` columns elsewhere in
-- 0001_init.sql are list-ordering fields on unrelated tables).
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

-- The one-record-per-day guarantee.
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
-- A NEW table. The profiles.terms_* cluster that 0020_employee_terms.sql
-- added was DROPPED by 0022_drop_terms_columns.sql (verified against live
-- 2026-07-03: the gate never fired and terms_accepted was false on every
-- row). There is nothing left to reuse.
--
-- This table is the fast "has this worker accepted the CURRENT version?"
-- flag the app's first-login gate reads — the same division of labour
-- 0021_agreement_events.sql sets out in its own header: the flag lives
-- next to the feature, the EVIDENCE lives in agreement_events.
--
-- Phase B should therefore ALSO append an immutable agreement_events row
-- on acceptance, with audience = 'worker' and doc_type =
-- 'attendance_terms', carrying doc_text/doc_sha256, ip and user_agent.
-- That table already grants insert-self and is guarded against UPDATE and
-- DELETE for everyone including service_role, so it is the right home for
-- the audit trail and this table must not try to duplicate it.
create table if not exists attendance_terms_acceptances (
  id            uuid primary key default gen_random_uuid(),
  worker_id     uuid not null references auth.users(id) on delete cascade,
  terms_version text not null,
  accepted_at   timestamptz not null default now()
);

create unique index if not exists attendance_terms_worker_version_uniq
  on attendance_terms_acceptances (worker_id, terms_version);


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


-- ── 7. Photo storage — private bucket, prefix-scoped ───────────────
-- Photos are FILES, never base64. The repo stores cost-item and
-- quotation images as base64 in jsonb, which is fine for four renders
-- per quote and fatal here: 20 workers x 2 photos x 250 workdays is
-- roughly 10,000 photos a year.
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

  -- ── Idempotent replay: same event id -> same row, unchanged.
  select * into v_row from attendance_records where timein_event_id = p_event_id;
  if found then
    if v_row.worker_id <> v_uid then
      raise exception 'EVENT_ID_CONFLICT' using errcode = 'P0001';
    end if;
    return v_row;
  end if;

  -- ── Who is calling. `position` is a Postgres col_name_keyword, so it
  --    is table-qualified and aliased rather than referenced bare.
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

  -- ── One record per worker per day (MVP section 14).
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


-- ── 9. attendance_time_out ──────────────────────────────────────────
-- Closes the day's open record and computes total_minutes ONCE,
-- server-side, so the worker's history and the admin's report can never
-- disagree. Idempotent on p_event_id, exactly like Time In.
--
-- The Time Out project is stored INDEPENDENTLY of the Time In project
-- (MVP section 13): a worker may be moved between sites during the day,
-- and the record must say what they actually selected at each action.
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
