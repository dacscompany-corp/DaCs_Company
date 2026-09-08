-- ════════════════════════════════════════════════════════════════════
-- 0068 verify — READ ONLY. Changes nothing.
--
-- Run AFTER 0068. Same rules as 0065_0067_verify.sql: nothing here names
-- a new function or table in a FROM clause, so it returns a useful
-- answer whether or not the migration has run.
--
-- Single statement on purpose — the SQL editor shows only the last
-- result set.
-- ════════════════════════════════════════════════════════════════════

with

state as (

  select 1 as ord, 'attendance_project_geofence table' as item,
         case when exists (
           select 1 from information_schema.tables
            where table_schema = 'public' and table_name = 'attendance_project_geofence'
         ) then 'present (correct)' else 'MISSING  <-- 0068 did not finish' end as state

  union all
  select 2, 'geofence functions',
         (select count(distinct p.proname)::text
            from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public'
             and p.proname in ('attendance_geofence_at','attendance_distance_m'))
         || ' of 2'

  union all
  select 3, 'evidence columns on attendance_records',
         (select count(*)::text from information_schema.columns
           where table_schema = 'public' and table_name = 'attendance_records'
             and column_name in (
               'timein_location_status','timein_distance_m','timein_is_mock',
               'timein_geofence_lat','timein_geofence_lng','timein_geofence_radius_m',
               'timeout_location_status','timeout_distance_m','timeout_is_mock',
               'timeout_geofence_lat','timeout_geofence_lng','timeout_geofence_radius_m'))
         || ' of 12'

  union all
  select 4, 'location settings on attendance_config',
         (select count(*)::text from information_schema.columns
           where table_schema = 'public' and table_name = 'attendance_config'
             and column_name in ('min_accuracy_m','require_geofence'))
         || ' of 2'

  -- ── The rollout switch, and why it matters ─────────────────────────
  -- Decision 20 hides a project with no geofence from the worker picker.
  -- With no site configured yet that empties EVERY picker and nobody can
  -- clock in. It must ship off and be turned on deliberately.
  union all
  select 5, 'require_geofence is still OFF',
         case
           when not exists (
             select 1 from information_schema.columns
              where table_schema='public' and table_name='attendance_config'
                and column_name='require_geofence'
           ) then 'column missing  <-- 0068 did not finish'
           when exists (
             select 1 from attendance_config where require_geofence
           ) then 'ON for at least one owner  <-- pickers are now geofence-gated'
           else 'off (correct until sites are configured)'
         end

  union all
  select 6, 'RLS on the geofence table',
         case when exists (
           select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public' and c.relname = 'attendance_project_geofence'
              and c.relrowsecurity
         ) then 'enabled (correct)' else 'DISABLED  <-- fix before use' end

  union all
  select 7, 'geofence policies',
         (select count(*)::text from pg_policies
           where schemaname = 'public' and tablename = 'attendance_project_geofence')
         || ' of 2 (admin + worker)'

  -- ── The grant lesson from 0067, applied here ───────────────────────
  -- attendance_geofence_at is internal; its callers are security definer
  -- and reach it as the owner. Supabase's default privileges grant every
  -- new function to anon and authenticated directly, so `revoke from
  -- public` is not enough and the roles must be named.
  union all
  select 8, 'attendance_geofence_at NOT granted to anon / authenticated',
         case
           when not exists (
             select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.proname = 'attendance_geofence_at'
           ) then 'function missing  <-- 0068 did not finish'
           when exists (
             select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.proname = 'attendance_geofence_at'
                and (coalesce(array_to_string(p.proacl, ','), '') like '%authenticated=X%'
                  or coalesce(array_to_string(p.proacl, ','), '') like '%anon=X%')
           ) then 'GRANTED  <-- same hole as 0066, revoke by role'
           else 'not granted (correct)'
         end

  union all
  select 9, 'no anon execute on the picker or distance helper',
         coalesce((
           select string_agg(p.proname, ', ' order by p.proname)
             from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public'
              and p.proname in ('attendance_projects_for_worker','attendance_distance_m')
              and coalesce(array_to_string(p.proacl, ','), '') like '%anon=X%'
         ) || '  <-- still granted to anon', 'none (correct)')

)

select ord, item, state from state order by ord;


-- ── Haversine sanity, as a SEPARATE query ───────────────────────────
--
-- Deliberately not folded into the statement above. Naming
-- attendance_distance_m in a FROM or subquery makes the WHOLE query fail
-- at parse time when the function does not exist yet -- CASE does not
-- protect against that, because resolution happens before evaluation.
-- The check above has to stay useful in both states; this one only
-- makes sense once 0068 has landed.
--
-- One degree of latitude is ~111.2 km anywhere on earth. Run this after
-- the migration and expect roughly 111195 m:
--
--   select round(attendance_distance_m(
--            14.0::double precision, 121.0::double precision,
--            15.0::double precision, 121.0::double precision)) as one_degree_m;
--
-- Anything far from that means the haversine did not land as written.
