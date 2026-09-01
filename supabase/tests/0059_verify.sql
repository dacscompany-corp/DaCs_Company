-- ════════════════════════════════════════════════════════════════════
-- 0059 verify — READ ONLY. Changes nothing.
--
-- Run AFTER 0059. Answers "did it actually land, and what happened to
-- the rows that were already there?"
--
-- Deliberately does NOT call attendance_projects_for_worker(): if 0059
-- had not run, naming a missing function in FROM fails the whole query
-- at parse time and tells you nothing. Existence is checked in pg_proc
-- instead, so this query returns a useful answer in BOTH states.
--
-- Single statement on purpose — the SQL editor shows only the last
-- result set.
-- ════════════════════════════════════════════════════════════════════

with

acols as (
  select column_name
    from information_schema.columns
   where table_schema = 'public' and table_name = 'attendance_records'
),

schema_state as (
  select 1 as ord, 'old bigint project columns' as item,
         case when exists (select 1 from acols
                            where column_name in ('timein_project_id','timeout_project_id'))
              then 'STILL PRESENT  <-- 0059 did not finish'
              else 'gone (correct)' end as state
  union all
  select 2, 'new dual-system columns',
         (select count(*)::text from acols
           where column_name in ('timein_project_system','timein_folder_id','timein_pm_project_id',
                                 'timeout_project_system','timeout_folder_id','timeout_pm_project_id'))
         || ' of 6'
  union all
  select 3, 'attendance_projects table',
         case when exists (select 1 from information_schema.tables
                            where table_schema='public' and table_name='attendance_projects')
              then 'STILL PRESENT  <-- 0059 did not finish'
              else 'dropped (correct)' end
  union all
  select 4, 'check constraints',
         (select count(*)::text from pg_constraint
           where conname in ('attendance_timein_project_ck','attendance_timeout_project_ck'))
         || ' of 2'
  union all
  select 5, 'helper functions',
         (select count(*)::text from pg_proc
           where proname in ('attendance_projects_for_worker','attendance_project_name'))
         || ' of 2'
  union all
  select 6, 'attendance_time_in overloads',
         (select count(*)::text from pg_proc where proname = 'attendance_time_in')
         || '  (must be 1 — two means the old bigint version survived)'
  union all
  select 7, 'attendance_time_in signature',
         coalesce((select left(pg_get_function_arguments(p.oid), 60)
                     from pg_proc p where p.proname = 'attendance_time_in'
                    order by p.oid limit 1), 'MISSING')
  union all
  select 8, 'attendance_time_out overloads',
         (select count(*)::text from pg_proc where proname = 'attendance_time_out')
),

-- What became of the rows that were already in the table.
record_state as (
  select 20 as ord, 'attendance rows total' as item, count(*)::text as state
    from attendance_records
  union all
  select 21, 'rows LINKED to a real project',
         (count(*) filter (where timein_project_system is not null))::text
         || ' of ' || count(*)::text
    from attendance_records
  union all
  select 22, 'rows still name-only (unlinked)',
         (count(*) filter (where timein_project_system is null))::text
    from attendance_records
),

-- Row-by-row, so an unlinked record can be chased by name.
per_row as (
  select 30 as ord,
         'row: ' || coalesce(timein_project_name,'(null)')
                 || '  [' || work_date::text || ']' as item,
         coalesce(timein_project_system, 'unlinked - name snapshot only') as state
    from attendance_records
),

-- How many projects the picker has to offer, counted directly so this
-- works whether or not the function exists yet.
pool as (
  select 40 as ord, 'folders (PC, excl. Additional Works)' as item,
         (select count(*)::text from folders where parent_folder_id is null) as state
  union all
  select 41, 'construction_projects (PM, active)',
         (select count(*)::text from construction_projects
           where coalesce(status,'active') = 'active')
)

select item, state
  from (
    select * from schema_state
    union all select * from record_state
    union all select * from per_row
    union all select * from pool
  ) all_rows
 order by ord, item;
