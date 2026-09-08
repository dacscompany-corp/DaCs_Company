-- ════════════════════════════════════════════════════════════════════
-- 0069 verify — READ ONLY. Changes nothing.
--
-- TWO parts. The first is structural and parse-safe in both states, like
-- 0059_verify.sql. The second is a behavioural truth table for the
-- refusal policy, and it NAMES the new function, so it can only run
-- after 0069 has landed.
--
-- Supabase's editor shows only the LAST result set, so run them
-- separately: select part one and run it, then select part two and run
-- that. Part two is the one that matters most.
-- ════════════════════════════════════════════════════════════════════


-- ─────────────────────────── PART ONE ───────────────────────────────
with

state as (

  select 1 as ord, 'new functions' as item,
         (select count(distinct p.proname)::text
            from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public'
             and p.proname in ('attendance_location_refuses','attendance_check_location'))
         || ' of 2' as state

  -- ── The overloading trap ───────────────────────────────────────────
  -- `create or replace` with a different parameter list makes a SECOND
  -- function rather than replacing the first. If the old 10-argument
  -- signature survived, the shipped app would keep calling it and skip
  -- location verification entirely, forever, with nothing on screen to
  -- say so. 0059 records the same hazard.
  union all
  select 2, 'exactly ONE attendance_time_in (old signature dropped)',
         case (select count(*) from pg_proc p
                 join pg_namespace n on n.oid = p.pronamespace
                where n.nspname = 'public' and p.proname = 'attendance_time_in')
           when 0 then 'MISSING  <-- 0069 did not finish'
           when 1 then 'one (correct)'
           else 'MORE THAN ONE  <-- old signature survived, app is unverified'
         end

  union all
  select 3, 'exactly ONE attendance_time_out (old signature dropped)',
         case (select count(*) from pg_proc p
                 join pg_namespace n on n.oid = p.pronamespace
                where n.nspname = 'public' and p.proname = 'attendance_time_out')
           when 0 then 'MISSING  <-- 0069 did not finish'
           when 1 then 'one (correct)'
           else 'MORE THAN ONE  <-- old signature survived, app is unverified'
         end

  -- 12 arguments: the original 10 plus p_is_mock and p_permission_denied.
  -- Both defaulted, so a client built against the 10-argument call still
  -- resolves here.
  union all
  select 4, 'RPCs take 12 arguments',
         (select string_agg(p.proname || '=' || p.pronargs, ', ' order by p.proname)
            from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public'
             and p.proname in ('attendance_time_in','attendance_time_out'))

  union all
  select 5, 'attendance_check_location NOT granted to anon / authenticated',
         case
           when not exists (
             select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.proname = 'attendance_check_location'
           ) then 'function missing  <-- 0069 did not finish'
           when exists (
             select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.proname = 'attendance_check_location'
                and (coalesce(array_to_string(p.proacl, ','), '') like '%authenticated=X%'
                  or coalesce(array_to_string(p.proacl, ','), '') like '%anon=X%')
           ) then 'GRANTED  <-- internal only, revoke by role'
           else 'not granted (correct)'
         end

  union all
  select 6, 'RPCs granted to authenticated, not to anon',
         coalesce((
           select string_agg(p.proname, ', ' order by p.proname)
             from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public'
              and p.proname in ('attendance_time_in','attendance_time_out')
              and (coalesce(array_to_string(p.proacl, ','), '') like '%anon=X%'
                or coalesce(array_to_string(p.proacl, ','), '') not like '%authenticated=X%')
         ) || '  <-- wrong grants', 'correct')

  union all
  select 7, 'require_geofence still OFF',
         case when exists (select 1 from attendance_config where require_geofence)
              then 'ON for at least one owner — pickers are geofence-gated'
              else 'off (nothing is refused for a missing fence yet)' end
)

select ord, item, state from state order by ord;


-- ─────────────────────────── PART TWO ───────────────────────────────
-- The refusal policy, as a truth table. Select from here down and run.
--
-- Every row must read PASS. The one that matters most is the
-- outside_radius pair: refused live, KEPT when the device already told
-- the worker it saved. A naive implementation refuses both and silently
-- destroys days of recorded work.
--
with cases (status, was_offline, require_geofence, expected, why) as (values
  ('verified',                     false, true,  false, 'a good fix is never refused'),
  ('low_accuracy',                 false, true,  false, 'the phone could not tell, and that is not the worker''s fault'),
  ('location_unavailable',         false, true,  false, 'no fix at all is uncertainty, not proof'),
  ('mock_location',                false, false, true,  'never accidental'),
  ('mock_location',                true,  false, true,  'and being offline does not launder it'),
  ('permission_denied',            false, false, true,  'a choice, not a limitation'),
  ('permission_denied',            true,  false, true,  'still a choice when queued'),
  ('outside_radius',               false, false, true,  'LIVE: demonstrably somewhere else'),
  ('outside_radius',               true,  false, false, 'QUEUED: already shown as saved, so keep and flag'),
  ('project_geofence_unavailable', false, false, false, 'geofences not required yet'),
  ('project_geofence_unavailable', false, true,  true,  'required, and live'),
  ('project_geofence_unavailable', true,  true,  false, 'required, but the fence may have moved since capture')
)
select c.status,
       c.was_offline,
       c.require_geofence,
       c.expected,
       attendance_location_refuses(c.status, c.was_offline, c.require_geofence) as actual,
       case when attendance_location_refuses(c.status, c.was_offline, c.require_geofence)
                 is not distinct from c.expected
            then 'PASS' else 'FAIL  <--' end as result,
       c.why
  from cases c
 -- FAILURES FIRST. Ordering by `result` alphabetically sorts PASS above
 -- FAIL, which buries the only rows anybody needs to see under a screen
 -- of green ones. A test report that hides its failures below the fold
 -- is worse than no report.
 order by case when attendance_location_refuses(c.status, c.was_offline, c.require_geofence)
                    is not distinct from c.expected
               then 1 else 0 end,
          status, was_offline;


-- ── Or just this: anything it returns is a failure ──────────────────
-- Zero rows means the whole table passed, with nothing to scroll.
--
-- with cases (status, was_offline, require_geofence, expected) as (values
--   ('verified', false, true, false), ('low_accuracy', false, true, false),
--   ('location_unavailable', false, true, false), ('mock_location', false, false, true),
--   ('mock_location', true, false, true), ('permission_denied', false, false, true),
--   ('permission_denied', true, false, true), ('outside_radius', false, false, true),
--   ('outside_radius', true, false, false), ('project_geofence_unavailable', false, false, false),
--   ('project_geofence_unavailable', false, true, true), ('project_geofence_unavailable', true, true, false)
-- )
-- select c.*, attendance_location_refuses(c.status, c.was_offline, c.require_geofence) as actual
--   from cases c
--  where attendance_location_refuses(c.status, c.was_offline, c.require_geofence)
--        is distinct from c.expected;
