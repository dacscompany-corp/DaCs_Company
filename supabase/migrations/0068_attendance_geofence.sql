-- ════════════════════════════════════════════════════════════════════
-- 0068_attendance_geofence.sql
--
-- WHERE A PROJECT IS, and the evidence of where a worker was when they
-- recorded attendance against it. The verification itself lands in 0069;
-- this migration builds what it verifies against.
--
-- ── WHY A HISTORY TABLE AND NOT THREE COLUMNS. §33 requires that
--    changing a project's geofence must never rewrite or invalidate
--    attendance already recorded. Mutable lat/lng/radius columns cannot
--    honour that: an offline record synced on Wednesday would be checked
--    against a fence edited on Tuesday, and the record the worker was
--    shown as saved would fail for a reason that did not exist when they
--    stood there.
--
--    So a geofence is EFFECTIVE-DATED. Editing appends a row; verifying
--    resolves the row in force at captured_at. The guarantee then holds
--    by construction rather than by everyone remembering it.
--
-- ── THE ROLLOUT HAZARD, and why require_geofence exists.
--    Decision 20 says a project without a valid geofence is not
--    attendance-enabled, so it never reaches the worker's picker. Read
--    literally that is a production outage: the moment this migration
--    lands, NO project has a geofence, every picker empties, and nobody
--    can clock in at all.
--
--    attendance_config.require_geofence is that rule's switch. It ships
--    OFF. Configure your sites, confirm they look right in the picker,
--    then turn it on. Off, a project with no geofence still appears and
--    0069 records its attendance flagged rather than verified.
--
-- ── NO PostGIS, NO map service. Rule 20 of the MVP terms. Haversine on
--    two doubles is arithmetic, and the earth is round enough at 150 m.
--
-- ── STILL OUTSIDE THE MONEY MODEL. No peso column, nothing feeds
--    Spent / Earned / Profit.
--
-- Idempotent -- safe to re-run.
-- ════════════════════════════════════════════════════════════════════


-- ── 1. Company-level location settings ──────────────────────────────
--
-- min_accuracy_m is the worst GPS accuracy still accepted as a usable
-- fix. 50 m tolerates a poor reading without accepting a meaningless
-- one: an outdoor phone fix is typically 5-15 m, while a failed fix
-- reports hundreds.
--
-- It is deliberately NOT a per-project value. Accuracy is a property of
-- the phone and the sky, not of the site.
alter table attendance_config
  add column if not exists min_accuracy_m  numeric(8,2) not null default 50,
  add column if not exists require_geofence boolean     not null default false;

comment on column attendance_config.require_geofence is
  'When true, a project with no valid enabled geofence is hidden from the '
  'worker picker and refused at Time In (decision 20). Ships false so that '
  'applying 0068 cannot empty every picker before any site is configured.';


-- ── 2. The geofence, effective-dated ────────────────────────────────
--
-- Project shape copied from 0059/0065: a system discriminator plus one
-- nullable FK per system. Cascade on delete, like 0065 and unlike the
-- attendance records themselves -- configuration for a project that no
-- longer exists is litter, while a person's work history is not.
--
-- Rows are APPEND-ONLY in practice. Editing a fence inserts a new row
-- with a later effective_from; the old row stays because old attendance
-- still has to be readable against it.
create table if not exists attendance_project_geofence (
  id             uuid primary key default gen_random_uuid(),
  owner_id       uuid not null references auth.users(id) on delete cascade,

  project_system text not null,
  folder_id      uuid references folders(id)               on delete cascade,
  pm_project_id  uuid references construction_projects(id) on delete cascade,

  effective_from timestamptz not null default now(),

  latitude       double precision not null,
  longitude      double precision not null,
  radius_m       numeric(8,2)     not null default 150,

  -- A fence can be switched off without being deleted, which is how a
  -- site stops being location-checked while keeping its history.
  enabled        boolean not null default true,

  created_at     timestamptz not null default now(),
  created_by     uuid references auth.users(id) on delete set null,

  constraint attendance_geofence_system_ck
    check (project_system in ('pc','pm')),

  constraint attendance_geofence_target_ck check (
    (project_system = 'pc' and folder_id is not null and pm_project_id is null)
    or
    (project_system = 'pm' and pm_project_id is not null and folder_id is null)
  ),

  constraint attendance_geofence_lat_ck check (latitude  between -90  and 90),
  constraint attendance_geofence_lng_ck check (longitude between -180 and 180),

  -- An upper bound as well as a lower one. A 50 km "site" is a typo, not
  -- a policy, and it would silently accept a worker three towns away.
  constraint attendance_geofence_radius_ck check (radius_m between 10 and 5000)
);

create index if not exists attendance_geofence_folder_idx
  on attendance_project_geofence (folder_id, effective_from desc)
  where folder_id is not null;
create index if not exists attendance_geofence_pm_idx
  on attendance_project_geofence (pm_project_id, effective_from desc)
  where pm_project_id is not null;

alter table attendance_project_geofence enable row level security;

drop policy if exists attendance_geofence_admin_all on attendance_project_geofence;
create policy attendance_geofence_admin_all on attendance_project_geofence
  for all using ((is_owner() or is_staff()) and can_access(owner_id))
  with check ((is_owner() or is_staff()) and can_access(owner_id));

-- Workers must read it: the device pre-checks its own position against
-- the cached fence so an offline worker gets an immediate, honest answer
-- instead of being told "saved" and refused days later.
drop policy if exists attendance_geofence_worker_select on attendance_project_geofence;
create policy attendance_geofence_worker_select on attendance_project_geofence
  for select using (is_worker() and owner_id = attendance_data_owner());


-- ── 3. The fence in force at a given moment ─────────────────────────
--
-- The whole point of the history table. `p_at` is the CAPTURE time, not
-- now(): a record synced days late is judged against the fence that
-- existed when the worker was standing there.
create or replace function attendance_geofence_at(
  p_system text,
  p_id     uuid,
  p_owner  uuid,
  p_at     timestamptz
) returns attendance_project_geofence
language sql stable security definer set search_path = public as $$
  select g.*
    from attendance_project_geofence g
   where g.owner_id = p_owner
     and g.project_system = p_system
     and ((p_system = 'pc' and g.folder_id     = p_id)
       or (p_system = 'pm' and g.pm_project_id = p_id))
     and g.effective_from <= p_at
   order by g.effective_from desc
   limit 1;
$$;

-- Internal. Its callers in 0069 are security definer and reach it as the
-- function owner, so it needs no client grant at all.
--
-- The roles are named EXPLICITLY, and `from public` alone would not do
-- it: this project carries Supabase's default privileges on schema
-- public, which grant execute on every new function directly to anon and
-- authenticated. Revoking from PUBLIC removes an entry those defaults
-- never created. That is exactly how 0066 shipped attendance_week_days
-- callable by every signed-in worker, and 0067 had to clean it up.
revoke all on function attendance_geofence_at(text, uuid, uuid, timestamptz) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke execute on function '
         || 'attendance_geofence_at(text, uuid, uuid, timestamptz) from authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke execute on function '
         || 'attendance_geofence_at(text, uuid, uuid, timestamptz) from anon';
  end if;
end $$;


-- ── 4. Distance, in metres ──────────────────────────────────────────
--
-- Haversine. Immutable and cheap; no extension, no network, no map
-- provider (rule 20). The mean earth radius is good to a few parts per
-- thousand, which at a 150 m fence is well under a metre.
create or replace function attendance_distance_m(
  p_lat1 double precision, p_lng1 double precision,
  p_lat2 double precision, p_lng2 double precision
) returns double precision
language sql immutable parallel safe as $$
  select 2 * 6371000 * asin(
    sqrt(
      power(sin(radians(p_lat2 - p_lat1) / 2), 2) +
      cos(radians(p_lat1)) * cos(radians(p_lat2)) *
      power(sin(radians(p_lng2 - p_lng1) / 2), 2)
    )
  );
$$;

revoke all on function attendance_distance_m(
  double precision, double precision, double precision, double precision) from public;
grant execute on function attendance_distance_m(
  double precision, double precision, double precision, double precision) to authenticated;
-- Pure arithmetic over four numbers a caller already holds, so an anon
-- grant leaks nothing -- but it is reachable without a session, and
-- nothing in this feature is for signed-out callers.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke execute on function attendance_distance_m('
         || 'double precision, double precision, double precision, double precision) from anon';
  end if;
end $$;


-- ── 5. Evidence columns ─────────────────────────────────────────────
--
-- The geofence is SNAPSHOTTED onto the record, exactly as worker_name
-- and timein_project_name already are. §33 requires historical
-- attendance to keep the fence it was judged against, and a snapshot
-- means reading an old record needs no join and no time travel.
--
-- location_status carries the §33 result codes:
--   verified | outside_radius | low_accuracy | location_unavailable
--   | mock_location | project_geofence_unavailable
alter table attendance_records
  add column if not exists timein_location_status   text,
  add column if not exists timein_distance_m        double precision,
  add column if not exists timein_is_mock           boolean,
  add column if not exists timein_geofence_lat      double precision,
  add column if not exists timein_geofence_lng      double precision,
  add column if not exists timein_geofence_radius_m numeric(8,2),

  add column if not exists timeout_location_status   text,
  add column if not exists timeout_distance_m        double precision,
  add column if not exists timeout_is_mock           boolean,
  add column if not exists timeout_geofence_lat      double precision,
  add column if not exists timeout_geofence_lng      double precision,
  add column if not exists timeout_geofence_radius_m numeric(8,2);

-- Deliberately NOT a check constraint on the status values. Rows written
-- before 0069 carry null, and a future migration adding a seventh code
-- must not have to rewrite history to do it. The app maps what it knows
-- and shows the rest as unrecognised -- the same choice AttendanceStatus
-- makes for 'abandoned'.
create index if not exists attendance_records_timein_flagged_idx
  on attendance_records (owner_id, work_date desc)
  where timein_location_status is not null
    and timein_location_status <> 'verified';


-- ── 6. The picker, once geofences are required ──────────────────────
--
-- Decision 20: a project with no valid enabled geofence is not
-- attendance-enabled, so a worker never sees a project they would only
-- be refused at. The failure surfaces to the ADMIN as "not ready"
-- instead of to the worker as a locked door.
--
-- Gated on require_geofence so that applying this migration does not
-- empty every picker in production before a single site is configured.
-- Turn it on when the sites are set up.
--
-- Everything else about this function is unchanged from 0059 -- the
-- three-column shape, the tenant scoping, the Additional Works
-- exclusion, the ordering. Only the geofence clause is new.
create or replace function attendance_projects_for_worker()
returns table (project_system text, project_id uuid, project_name text)
language sql stable security definer set search_path = public as $$
  with cfg as (
    select coalesce(
      (select a.require_geofence from attendance_config a
        where a.owner_id = attendance_data_owner()),
      false
    ) as require_geofence
  )
  select 'pc'::text, f.id, f.name
    from folders f, cfg
   where f.owner_id = attendance_data_owner()
     and f.parent_folder_id is null
     and coalesce(btrim(f.name), '') <> ''
     and (not cfg.require_geofence or exists (
       select 1 from attendance_project_geofence g
        where g.project_system = 'pc' and g.folder_id = f.id
          and g.owner_id = f.owner_id and g.enabled
     ))
  union all
  select 'pm'::text, c.id, coalesce(nullif(btrim(c.project_name), ''), c.client_name)
    from construction_projects c, cfg
   where (c.owner_id is null or c.owner_id = attendance_data_owner())
     and coalesce(c.status, 'active') = 'active'
     and coalesce(nullif(btrim(c.project_name), ''), c.client_name) is not null
     and (not cfg.require_geofence or exists (
       select 1 from attendance_project_geofence g
        where g.project_system = 'pm' and g.pm_project_id = c.id
          and g.owner_id = attendance_data_owner() and g.enabled
     ))
  order by 3;
$$;

revoke all on function attendance_projects_for_worker() from public;
grant execute on function attendance_projects_for_worker() to authenticated;
revoke execute on function attendance_projects_for_worker() from anon;
