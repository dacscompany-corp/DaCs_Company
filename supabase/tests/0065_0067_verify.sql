-- ════════════════════════════════════════════════════════════════════
-- 0065 / 0066 / 0067 verify — READ ONLY. Changes nothing.
--
-- Run AFTER 0065, 0066 and 0067. Answers "did they actually land?"
--
-- Follows 0059_verify.sql: nothing here NAMES one of the new functions
-- or tables in a FROM clause. If the migrations had not run, doing so
-- would fail the whole query at parse time and tell you nothing.
-- Existence is checked through the catalogs instead, so this returns a
-- useful answer in BOTH states.
--
-- Single statement on purpose — the SQL editor shows only the last
-- result set.
-- ════════════════════════════════════════════════════════════════════

with

expected_tables (name) as (
  values ('attendance_config'),
         ('attendance_project_config'),
         ('attendance_project_closure'),
         ('attendance_weekly_rewards')
),

expected_functions (name) as (
  values ('attendance_start_time'),
         ('attendance_is_required_day'),
         ('attendance_week_days'),
         ('attendance_reward_progress'),
         ('attendance_evaluate_week'),
         ('attendance_reward_mark_paid')
),

expected_constraints (name) as (
  values ('attendance_config_grace_ck'),
         ('attendance_config_amount_ck'),
         ('attendance_project_config_system_ck'),
         ('attendance_project_config_target_ck'),
         ('attendance_project_config_days_ck'),
         ('attendance_project_closure_system_ck'),
         ('attendance_project_closure_target_ck'),
         ('attendance_weekly_rewards_status_ck'),
         ('attendance_weekly_rewards_monday_ck'),
         ('attendance_weekly_rewards_span_ck'),
         ('attendance_weekly_rewards_amount_ck'),
         ('attendance_weekly_rewards_paid_ck')
),

expected_indexes (name) as (
  values ('attendance_project_config_folder_uniq'),
         ('attendance_project_config_pm_uniq'),
         ('attendance_project_closure_folder_uniq'),
         ('attendance_project_closure_pm_uniq'),
         ('attendance_weekly_rewards_worker_week_uniq')
),

state as (

  select 1 as ord, 'tables' as item,
         (select count(*)::text from information_schema.tables t
           where t.table_schema = 'public'
             and t.table_name in (select name from expected_tables))
         || ' of 4' as state

  union all
  select 2, 'functions',
         (select count(distinct p.proname)::text
            from pg_proc p
            join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public'
             and p.proname in (select name from expected_functions))
         || ' of 6'

  union all
  select 3, 'check constraints',
         (select count(*)::text from pg_constraint
           where conname in (select name from expected_constraints))
         || ' of 12'

  union all
  select 4, 'unique indexes',
         (select count(*)::text from pg_indexes
           where schemaname = 'public'
             and indexname in (select name from expected_indexes))
         || ' of 5'

  union all
  select 5, 'row level security enabled',
         (select count(*)::text from pg_class c
            join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public'
             and c.relname in (select name from expected_tables)
             and c.relrowsecurity)
         || ' of 4'

  union all
  select 6, 'policies',
         (select count(*)::text from pg_policies
           where schemaname = 'public'
             and tablename in (select name from expected_tables))
         || ' of 8 (admin + worker on each)'

  -- ── The security property, not a cosmetic one ──────────────────────
  -- attendance_week_days is security definer and takes a worker id. A
  -- grant lets any signed-in worker read any OTHER worker's week just by
  -- passing their uuid. Its callers are themselves security definer and
  -- reach it as the function owner, so it needs no grant at all.
  --
  -- This is checked against the ROLES, not against PUBLIC. Supabase's
  -- default privileges on schema public grant execute on every new
  -- function directly to anon and authenticated, so `revoke ... from
  -- public` never removes them -- which is exactly how 0066 shipped
  -- this function wide open. 0067 is the fix.
  union all
  select 7, 'attendance_week_days NOT granted to anon / authenticated',
         case
           when not exists (
             select 1 from pg_proc p
              join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.proname = 'attendance_week_days'
           ) then 'function missing  <-- 0066 did not finish'
           when exists (
             select 1 from pg_proc p
              join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public'
                and p.proname = 'attendance_week_days'
                and (coalesce(array_to_string(p.proacl, ','), '') like '%authenticated=X%'
                  or coalesce(array_to_string(p.proacl, ','), '') like '%anon=X%')
           ) then 'GRANTED  <-- SECURITY HOLE, apply 0067'
           else 'not granted (correct)'
         end

  -- Nothing in this feature is for signed-out callers. The RPCs raise
  -- AUTH_REQUIRED on their own, but a grant to anon means one dropped
  -- auth check is the whole distance between private and public.
  union all
  select 9, 'no anon execute on any reward function',
         coalesce((
           select string_agg(p.proname, ', ' order by p.proname)
             from pg_proc p
             join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public'
              and p.proname in ('attendance_start_time','attendance_is_required_day',
                                'attendance_week_days','attendance_reward_progress',
                                'attendance_evaluate_week','attendance_reward_mark_paid')
              and coalesce(array_to_string(p.proacl, ','), '') like '%anon=X%'
         ) || '  <-- still granted to anon, apply 0067', 'none (correct)')

  -- ── Isolation, restated as a test ──────────────────────────────────
  -- 0065/0066 must not have introduced a foreign key from an attendance
  -- table into the money model. attendance_weekly_rewards.amount is a
  -- reported figure; nothing may wire it to payroll or expenses.
  union all
  select 8, 'no FK from reward table into money tables',
         case
           when exists (
             select 1
               from pg_constraint c
               join pg_class ch on ch.oid = c.conrelid
               join pg_class pa on pa.oid = c.confrelid
              where c.contype = 'f'
                and ch.relname = 'attendance_weekly_rewards'
                and pa.relname in ('payroll','expenses','invoices','payment_requests')
           ) then 'FOUND  <-- isolation broken'
           else 'none (correct)'
         end
)

select ord, item, state from state order by ord;
