-- 0110 PRE-APPLY drift check — READ-ONLY.
-- Run BEFORE applying 0110, via the Supabase MCP execute_sql (not the SQL editor).
-- 0110 restates uploads_can_read, uploads_can_write and the policy uploads_admin_update
-- wholesale; if live has drifted from 0102 the restatement would silently revert it.
-- Compare the two md5 rows with the expected values printed by:
--   node supabase/tests/pm_sharing_items_preapply.mjs
-- STOP and report if the md5s differ, a helper is missing, or pm_sharing_items already exists.
select 'uploads_can_read md5' as chk,
       md5(btrim(regexp_replace(prosrc, '\s+', ' ', 'g'))) as value
  from pg_proc where oid = 'public.uploads_can_read(text,text)'::regprocedure
union all
select 'uploads_can_write md5',
       md5(btrim(regexp_replace(prosrc, '\s+', ' ', 'g')))
  from pg_proc where oid = 'public.uploads_can_write(text)'::regprocedure
union all
select 'helper exists: pur_petty_reader(text)', (to_regprocedure('public.pur_petty_reader(text)') is not null)::text
union all
select 'helper exists: pm_main_owner_id()', (to_regprocedure('public.pm_main_owner_id()') is not null)::text
union all
select 'helper exists: pm_owner_company()', (to_regprocedure('public.pm_owner_company()') is not null)::text
union all
select 'helper exists: dacs_try_uuid(text)', (to_regprocedure('public.dacs_try_uuid(text)') is not null)::text
union all
select 'uploads_admin_update qual', coalesce(qual, 'MISSING')
  from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'uploads_admin_update'
union all
select 'uploads_admin_update with_check', coalesce(with_check, 'MISSING')
  from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'uploads_admin_update'
union all
select 'pm_sharing_items absent (expect true)',
       (not exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'pm_sharing_items'))::text;
