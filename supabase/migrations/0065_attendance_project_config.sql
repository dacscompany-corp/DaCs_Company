-- ════════════════════════════════════════════════════════════════════
-- 0065_attendance_project_config.sql
--
-- PER-PROJECT ATTENDANCE SETTINGS. The weekly reward (0066) needs to
-- know two things this database has never recorded: which days a given
-- site actually works, and what time its workers are due.
--
-- ── WHY A SIDE TABLE, not columns on folders / construction_projects.
--    Those two tables are owned by Project Control and Project
--    Management. Attendance is deliberately isolated from both (0050,
--    0059, 0061) and hanging attendance settings off them would be the
--    first place that isolation leaks. A side table also gives 0067
--    somewhere to put the geofence without touching either module.
--
-- ── WHY THE 0059 PROJECT SHAPE, copied exactly. system + a nullable FK
--    per system, not a generic (system, id) pair. 0059's header says why
--    and it applies unchanged here: a second, different answer to
--    "how do we point at one of two project systems" is how folders.id
--    vs construction_projects.id confusion spreads. Copying it also buys
--    real referential integrity, which a bare uuid cannot have.
--
-- ── ON DELETE CASCADE HERE, and that is the OPPOSITE of 0059. An
--    attendance RECORD must survive its project being deleted -- it is a
--    person's work history, and 0059 chose `set null` for exactly that
--    reason. Configuration for a project that no longer exists is just
--    litter. Delete it with the project.
--
-- ── STILL OUTSIDE THE MONEY MODEL. No peso column in this migration.
--    The reward amount arrives in 0066 as a reported figure that creates
--    no accounting entry -- see MVP-DECISIONS.md decisions 14 and 15.
--
-- Idempotent -- safe to re-run.
-- ════════════════════════════════════════════════════════════════════


-- ── 1. Company-wide defaults ────────────────────────────────────────
--
-- One row per owner. Staff read their owner's row through can_access().
--
-- default_start_time is 09:00 because §36 of the MVP terms fixes that as
-- the MVP default, and it stays configurable because that section says
-- it must.
--
-- evaluation_grace_hours is measured from the END OF THE WEEK, meaning
-- Saturday 00:00 Manila. 60 hours lands on Monday noon. The grace exists
-- because the app is built for sites with no signal: a Time In captured
-- offline on Friday afternoon may not reach the server until the worker
-- passes through coverage on Monday, and freezing the week before it
-- arrives would cost that worker ₱500 for a day they worked on time.
create table if not exists attendance_config (
  owner_id               uuid primary key references auth.users(id) on delete cascade,
  default_start_time     time        not null default '09:00',
  reward_amount          numeric(12,2) not null default 500,
  evaluation_grace_hours integer     not null default 60,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),

  constraint attendance_config_grace_ck  check (evaluation_grace_hours between 0 and 336),
  constraint attendance_config_amount_ck check (reward_amount >= 0)
);

drop trigger if exists attendance_config_touch on attendance_config;
create trigger attendance_config_touch before update on attendance_config
  for each row execute function attendance_touch_updated_at();


-- ── 2. Per-project settings ─────────────────────────────────────────
--
-- working_days is the STANDING pattern, as ISO weekday numbers
-- (1 = Monday … 7 = Sunday). Default {1,2,3,4,5}.
--
-- It exists so that a site with a permanently different week -- a condo
-- whose building bans weekend fit-out work, say -- is configured ONCE
-- rather than having the same closure re-entered every week for the life
-- of the project. Exception dates (section 3) sit on top of it.
--
-- NOTE the reward only ever considers Monday–Friday (MVP-DECISIONS.md
-- decision 1). Putting 6 or 7 in working_days does not extend the reward
-- week; it only records that the site works those days.
create table if not exists attendance_project_config (
  id             uuid primary key default gen_random_uuid(),
  owner_id       uuid not null references auth.users(id) on delete cascade,

  project_system text not null,
  folder_id      uuid references folders(id)               on delete cascade,
  pm_project_id  uuid references construction_projects(id) on delete cascade,

  working_days   smallint[] not null default '{1,2,3,4,5}'::smallint[],

  -- Null means "use attendance_config.default_start_time". Per project
  -- because building management, not the contractor, often dictates the
  -- hours fit-out work may happen.
  start_time_override time,

  -- Attendance may be recorded against this project at all. 0067 makes a
  -- valid geofence a further precondition (decision 20); until then this
  -- flag is the only gate.
  attendance_enabled  boolean not null default true,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint attendance_project_config_system_ck
    check (project_system in ('pc','pm')),

  -- Exactly one FK set, and it must match the discriminator. Without
  -- this a row can name 'pc' while pointing at a construction project.
  constraint attendance_project_config_target_ck check (
    (project_system = 'pc' and folder_id is not null and pm_project_id is null)
    or
    (project_system = 'pm' and pm_project_id is not null and folder_id is null)
  ),

  constraint attendance_project_config_days_ck check (
    working_days <@ array[1,2,3,4,5,6,7]::smallint[]
    and array_length(working_days, 1) between 1 and 7
  )
);

-- One config row per project. Partial uniques rather than a composite
-- key because only one of the two columns is ever populated.
create unique index if not exists attendance_project_config_folder_uniq
  on attendance_project_config (folder_id) where folder_id is not null;
create unique index if not exists attendance_project_config_pm_uniq
  on attendance_project_config (pm_project_id) where pm_project_id is not null;

create index if not exists attendance_project_config_owner_idx
  on attendance_project_config (owner_id);

drop trigger if exists attendance_project_config_touch on attendance_project_config;
create trigger attendance_project_config_touch before update on attendance_project_config
  for each row execute function attendance_touch_updated_at();


-- ── 3. Closure dates ────────────────────────────────────────────────
--
-- The exceptions on top of working_days: a holiday the site did not
-- work, a shutdown, a typhoon day.
--
-- A closure makes the day NOT REQUIRED, which shrinks the reward week
-- rather than failing it -- four on-time Time Ins in a four-day week
-- still earn the full ₱500 (decision 6). Workers are never penalised for
-- a day the company chose not to open.
--
-- Per project, NOT company-wide, because that is how the business
-- actually runs: sites work regular holidays on premium pay while others
-- shut, and local charter days close one city and not another
-- (decision 7).
create table if not exists attendance_project_closure (
  id             uuid primary key default gen_random_uuid(),
  owner_id       uuid not null references auth.users(id) on delete cascade,

  project_system text not null,
  folder_id      uuid references folders(id)               on delete cascade,
  pm_project_id  uuid references construction_projects(id) on delete cascade,

  closed_on      date not null,
  reason         text,

  created_at     timestamptz not null default now(),
  created_by     uuid references auth.users(id) on delete set null,

  constraint attendance_project_closure_system_ck
    check (project_system in ('pc','pm')),

  constraint attendance_project_closure_target_ck check (
    (project_system = 'pc' and folder_id is not null and pm_project_id is null)
    or
    (project_system = 'pm' and pm_project_id is not null and folder_id is null)
  )
);

create unique index if not exists attendance_project_closure_folder_uniq
  on attendance_project_closure (folder_id, closed_on) where folder_id is not null;
create unique index if not exists attendance_project_closure_pm_uniq
  on attendance_project_closure (pm_project_id, closed_on) where pm_project_id is not null;

create index if not exists attendance_project_closure_owner_date_idx
  on attendance_project_closure (owner_id, closed_on desc);


-- ── 4. RLS ──────────────────────────────────────────────────────────
--
-- Admins (owner + the staff acting for them) manage all three tables.
-- Workers get SELECT only, scoped to their own owner via
-- attendance_data_owner() -- the attendance-local helper from 0051, NOT
-- data_owner_id(), which would hand a worker the owner's whole tenancy.
--
-- Workers need to read these at all so the app can show the cutoff time
-- and grey out a day the site is closed. None of it is secret; all of it
-- is their own employer's schedule.
alter table attendance_config          enable row level security;
alter table attendance_project_config  enable row level security;
alter table attendance_project_closure enable row level security;

drop policy if exists attendance_config_admin_all on attendance_config;
create policy attendance_config_admin_all on attendance_config
  for all using ((is_owner() or is_staff()) and can_access(owner_id))
  with check ((is_owner() or is_staff()) and can_access(owner_id));

drop policy if exists attendance_config_worker_select on attendance_config;
create policy attendance_config_worker_select on attendance_config
  for select using (is_worker() and owner_id = attendance_data_owner());

drop policy if exists attendance_project_config_admin_all on attendance_project_config;
create policy attendance_project_config_admin_all on attendance_project_config
  for all using ((is_owner() or is_staff()) and can_access(owner_id))
  with check ((is_owner() or is_staff()) and can_access(owner_id));

drop policy if exists attendance_project_config_worker_select on attendance_project_config;
create policy attendance_project_config_worker_select on attendance_project_config
  for select using (is_worker() and owner_id = attendance_data_owner());

drop policy if exists attendance_project_closure_admin_all on attendance_project_closure;
create policy attendance_project_closure_admin_all on attendance_project_closure
  for all using ((is_owner() or is_staff()) and can_access(owner_id))
  with check ((is_owner() or is_staff()) and can_access(owner_id));

drop policy if exists attendance_project_closure_worker_select on attendance_project_closure;
create policy attendance_project_closure_worker_select on attendance_project_closure
  for select using (is_worker() and owner_id = attendance_data_owner());


-- ── 5. Effective start time ─────────────────────────────────────────
--
-- The one place lateness is defined, so Time In, the reward evaluation
-- and the admin screens cannot drift into disagreeing about it.
--
-- THE FINAL FALLBACK IS NOT OPTIONAL. If this returned null for an owner
-- with no attendance_config row, every `timein_at > start_time`
-- comparison would evaluate to null and NOBODY would ever be late --
-- a silent, total failure of the rule that nothing on screen would
-- explain. 09:00 is the documented MVP default (§36); return it rather
-- than nothing.
create or replace function attendance_start_time(
  p_system text,
  p_id     uuid,
  p_owner  uuid
) returns time language sql stable security definer set search_path = public as $$
  select coalesce(
    (
      select c.start_time_override
        from attendance_project_config c
       where c.owner_id = p_owner
         and c.project_system = p_system
         and ((p_system = 'pc' and c.folder_id     = p_id)
           or (p_system = 'pm' and c.pm_project_id = p_id))
    ),
    (select a.default_start_time from attendance_config a where a.owner_id = p_owner),
    '09:00'::time
  );
$$;

revoke all on function attendance_start_time(text, uuid, uuid) from public;
grant execute on function attendance_start_time(text, uuid, uuid) to authenticated;


-- ── 6. Is a given date a required day for a given project? ──────────
--
-- Monday–Friday only, because the reward week is Mon–Fri (decision 1).
-- A site that works Saturday still gets no reward credit for it, and a
-- Saturday closure is not a question this function needs to answer.
--
-- Returns false when the day is outside the site's standing pattern, or
-- carries a closure row. Both mean "not required", which SHRINKS the
-- week rather than failing it.
create or replace function attendance_is_required_day(
  p_system text,
  p_id     uuid,
  p_owner  uuid,
  p_date   date
) returns boolean language sql stable security definer set search_path = public as $$
  select
    -- Mon–Fri only.
    extract(isodow from p_date) between 1 and 5
    -- Within the site's standing working pattern. No config row means
    -- the default Mon–Fri, so an unconfigured project behaves sensibly
    -- rather than making every day non-required.
    and coalesce(
      (
        select extract(isodow from p_date)::smallint = any (c.working_days)
          from attendance_project_config c
         where c.owner_id = p_owner
           and c.project_system = p_system
           and ((p_system = 'pc' and c.folder_id     = p_id)
             or (p_system = 'pm' and c.pm_project_id = p_id))
      ),
      true
    )
    -- And not explicitly closed.
    and not exists (
      select 1
        from attendance_project_closure x
       where x.owner_id = p_owner
         and x.project_system = p_system
         and ((p_system = 'pc' and x.folder_id     = p_id)
           or (p_system = 'pm' and x.pm_project_id = p_id))
         and x.closed_on = p_date
    );
$$;

revoke all on function attendance_is_required_day(text, uuid, uuid, date) from public;
grant execute on function attendance_is_required_day(text, uuid, uuid, date) to authenticated;
