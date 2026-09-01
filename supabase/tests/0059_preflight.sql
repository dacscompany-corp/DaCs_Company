-- ════════════════════════════════════════════════════════════════════
-- 0059 preflight — READ ONLY. Changes nothing.
--
-- ONE query on purpose. The Supabase SQL editor shows only the LAST
-- statement's result set, so a file of separate selects silently hides
-- everything above the last one. Every row below arrives in a single
-- table instead.
--
-- Run this BEFORE re-running 0059. It answers:
--   A. did an earlier failed run already change the schema?
--   B. what is actually in attendance_records?
--   C. can each record's snapshotted project name be matched to a real
--      project, so section 1b of 0059 can reconnect it?
-- ════════════════════════════════════════════════════════════════════

with

-- ── A. schema state ─────────────────────────────────────────────────
cols as (
  select column_name, data_type
    from information_schema.columns
   where table_schema = 'public'
     and table_name   = 'attendance_records'
     and column_name like '%project%'
),
schema_rows as (
  select 1 as ord, 'A. schema' as section,
         'project column' as detail,
         column_name || '  (' || data_type || ')' as value
    from cols
  union all
  select 1, 'A. schema', 'old bigint columns still present',
         case when exists (select 1 from cols where column_name in ('timein_project_id','timeout_project_id'))
              then 'YES - 0059 has not finished' else 'no' end
  union all
  select 1, 'A. schema', 'new dual-system columns present',
         (select count(*)::text from cols
           where column_name in ('timein_project_system','timein_folder_id','timein_pm_project_id',
                                 'timeout_project_system','timeout_folder_id','timeout_pm_project_id'))
         || ' of 6'
  union all
  select 1, 'A. schema', 'attendance_projects table',
         case when exists (select 1 from information_schema.tables
                            where table_schema='public' and table_name='attendance_projects')
              then 'still there' else 'dropped' end
),

-- ── B. what is in attendance_records ────────────────────────────────
rec_rows as (
  select 2 as ord, 'B. records' as section, d as detail, v as value
    from (
      select 'total rows' as d, count(*)::text as v from attendance_records
      union all
      select 'rows dated today',
             (count(*) filter (where work_date = (now() at time zone 'Asia/Manila')::date))::text
        from attendance_records
      union all
      select 'earliest work_date', coalesce(min(work_date)::text,'(none)') from attendance_records
      union all
      select 'latest work_date',   coalesce(max(work_date)::text,'(none)') from attendance_records
      union all
      select 'distinct workers',   count(distinct worker_id)::text from attendance_records
      union all
      select 'distinct owners',    count(distinct owner_id)::text  from attendance_records
      union all
      select 'owner is tenant root',
             (count(*) filter (where p.role = 'owner'))::text || ' of ' || count(*)::text
        from attendance_records r left join profiles p on p.id = r.owner_id
    ) x
),

-- ── C. can the snapshotted names be matched ─────────────────────────
-- Exactly the candidate set section 1b of 0059 uses, so this previews
-- the backfill rather than approximating it.
candidates as (
  select lower(btrim(f.name)) as nm, 'pc'::text as system
    from folders f
   where f.parent_folder_id is null and coalesce(btrim(f.name),'') <> ''
  union all
  select lower(btrim(coalesce(nullif(btrim(c.project_name),''), c.client_name))), 'pm'::text
    from construction_projects c
   where coalesce(nullif(btrim(c.project_name),''), c.client_name) is not null
),
names as (
  select timein_project_name as nm, count(*) as n_rows
    from attendance_records group by timein_project_name
),
match_rows as (
  select 3 as ord, 'C. name -> project' as section,
         coalesce(n.nm,'(null)') || '   [' || n.n_rows || ' row(s)]' as detail,
         case count(c.nm)
           when 0 then 'NO MATCH - row keeps the name only, stays unlinked'
           when 1 then 'match in ' || min(c.system) || ' - backfill will link it'
           else 'AMBIGUOUS (' || count(c.nm) || ' matches) - left unlinked on purpose'
         end as value
    from names n
    left join candidates c on c.nm = lower(btrim(n.nm))
   group by n.nm, n.n_rows
),

-- ── D. how many real projects exist to match against ────────────────
pool_rows as (
  select 4 as ord, 'D. project pool' as section, d as detail, v as value
    from (
      select 'folders (Project Control, excl. Additional Works)' as d,
             count(*)::text as v
        from folders where parent_folder_id is null
      union all
      select 'construction_projects (Project Management, active)',
             count(*)::text
        from construction_projects where coalesce(status,'active') = 'active'
      union all
      select 'names shared by BOTH systems (ambiguous)',
             coalesce((select count(*)::text from (
                select nm from candidates group by nm having count(*) > 1
             ) a), '0')
    ) y
)

select section, detail, value
  from (
    select * from schema_rows
    union all select * from rec_rows
    union all select * from match_rows
    union all select * from pool_rows
  ) all_rows
 order by ord, detail;
