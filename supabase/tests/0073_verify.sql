-- ════════════════════════════════════════════════════════════════════
-- 0073 verify — READ ONLY. Changes nothing.
--
-- Structural, and parse-safe in BOTH states: it never names the new
-- tables, columns or function as identifiers, only as text compared
-- against the catalogs. So it runs whether or not 0073 has landed, and
-- tells you which.
--
-- One result set. Every row should read PASS.
-- ════════════════════════════════════════════════════════════════════

with

tables as (
  select count(*) as n
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r'
     and c.relname in ('project_control_allocation_policies',
                       'project_control_billing_allocations',
                       'billing_allocation_adjustments')
),

rls as (
  select count(*) as n
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relrowsecurity
     and c.relname in ('project_control_allocation_policies',
                       'project_control_billing_allocations',
                       'billing_allocation_adjustments')
),

fn as (
  select count(*) as n
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname = 'update_project_control_billing_allocation'
     and p.prosecdef                      -- must be security definer
),

col as (
  select count(*) as n, bool_or(not a.attnotnull) as nullable
    from pg_attribute a
    join pg_class c on c.oid = a.attrelid
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname = 'overhead_expenses'
     and a.attname = 'billing_period_id' and a.attnum > 0 and not a.attisdropped
),

-- The audit table must have NO write policy at all. That isolation IS
-- the feature: adjustments are append-only, written only by the RPC.
audit_writes as (
  select count(*) as n
    from pg_policies
   where schemaname = 'public' and tablename = 'billing_allocation_adjustments'
     and cmd in ('UPDATE','DELETE','INSERT','ALL')
),

-- Snapshots take SELECT + INSERT only; never UPDATE or DELETE.
snapshot_writes as (
  select count(*) as n
    from pg_policies
   where schemaname = 'public' and tablename = 'project_control_billing_allocations'
     and cmd in ('UPDATE','DELETE','ALL')
),

grants as (
  select
    count(*) filter (where table_name = 'billing_allocation_adjustments'
                       and privilege_type <> 'SELECT') as audit_extra,
    count(*) filter (where table_name = 'project_control_billing_allocations'
                       and privilege_type in ('UPDATE','DELETE'))      as snap_extra
    from information_schema.role_table_grants
   where table_schema = 'public' and grantee = 'authenticated'
     and table_name in ('billing_allocation_adjustments',
                        'project_control_billing_allocations')
),

pubs as (
  select count(*) as n
    from pg_publication_tables
   where pubname = 'supabase_realtime' and schemaname = 'public'
     and tablename in ('project_control_allocation_policies',
                       'project_control_billing_allocations',
                       'billing_allocation_adjustments')
),

-- Existing overhead must survive untouched, with a null attribution.
legacy as (
  select count(*) as n from overhead_expenses
)

select * from (
  select 1 as ord, 'three tables exist' as item,
         (select n from tables) || ' of 3' as found,
         case when (select n from tables) = 3 then 'PASS' else 'FAIL' end as verdict
  union all
  select 2, 'RLS enabled on all three',
         (select n from rls) || ' of 3',
         case when (select n from rls) = 3 then 'PASS' else 'FAIL' end
  union all
  select 3, 'adjustment RPC exists and is SECURITY DEFINER',
         (select n from fn) || ' of 1',
         case when (select n from fn) = 1 then 'PASS' else 'FAIL' end
  union all
  select 4, 'overhead_expenses.billing_period_id exists and is NULLABLE',
         case when (select n from col) = 1
              then case when (select nullable from col) then 'nullable' else 'NOT NULL' end
              else 'missing' end,
         case when (select n from col) = 1 and (select nullable from col) then 'PASS' else 'FAIL' end
  union all
  select 5, 'audit table has NO write policy (append-only)',
         (select n from audit_writes) || ' write policies',
         case when (select n from audit_writes) = 0 then 'PASS' else 'FAIL' end
  union all
  select 6, 'snapshots have no UPDATE/DELETE policy',
         (select n from snapshot_writes) || ' write policies',
         case when (select n from snapshot_writes) = 0 then 'PASS' else 'FAIL' end
  union all
  select 7, 'audit grant is SELECT only',
         (select audit_extra from grants) || ' extra grants',
         case when (select audit_extra from grants) = 0 then 'PASS' else 'FAIL' end
  union all
  select 8, 'snapshot grants exclude UPDATE/DELETE',
         (select snap_extra from grants) || ' extra grants',
         case when (select snap_extra from grants) = 0 then 'PASS' else 'FAIL' end
  union all
  select 9, 'all three in supabase_realtime publication',
         (select n from pubs) || ' of 3',
         case when (select n from pubs) = 3 then 'PASS' else 'FAIL' end
  union all
  select 10, 'existing overhead rows (should be unchanged)',
         (select n from legacy) || ' rows',
         'INFO'
) t order by ord;
