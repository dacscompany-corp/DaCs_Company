-- 0110 live acceptance — READ-ONLY. Run after the owner applies 0110, via MCP execute_sql.
-- Each row must say ok = true.
select 'tables exist' chk, count(*) = 3 ok from information_schema.tables
 where table_schema = 'public' and table_name in ('pm_sharing_items', 'pm_sharing_item_events', 'pm_sharing_item_ops')
union all
select 'rls on, no policies', bool_and(c.relrowsecurity) and not exists (
         select 1 from pg_policies where tablename in ('pm_sharing_items', 'pm_sharing_item_events', 'pm_sharing_item_ops'))
  from pg_class c where c.relname in ('pm_sharing_items', 'pm_sharing_item_events', 'pm_sharing_item_ops')
union all
select 'tables hidden from clients', not (has_table_privilege('authenticated', 'pm_sharing_items', 'select')
                                       or has_table_privilege('anon', 'pm_sharing_items', 'select'))
union all
select 'write fns: authenticated yes, anon no',
       has_function_privilege('authenticated', 'pm_si_record(uuid, uuid, text, text, numeric, date, text, text)', 'execute')
   and not has_function_privilege('anon', 'pm_si_record(uuid, uuid, text, text, numeric, date, text, text)', 'execute')
   and has_function_privilege('authenticated', 'pm_si_void(uuid, uuid, int, text)', 'execute')
union all
select 'helpers hidden', not has_function_privilege('authenticated', 'pm_si_json(uuid)', 'execute')
union all
select 'more helpers hidden from authenticated',
       not has_function_privilege('authenticated', 'pm_si_op_begin(uuid, uuid, text)', 'execute')
   and not has_function_privilege('authenticated', 'pm_si_op_end(uuid, jsonb)', 'execute')
   and not has_function_privilege('authenticated', 'pm_si_event(uuid, uuid, text, jsonb, text)', 'execute')
   and not has_function_privilege('authenticated', 'pm_si_lock(uuid, uuid, int)', 'execute')
   and not has_function_privilege('authenticated', 'pm_si_check(uuid, text, text, numeric, date, text)', 'execute')
   and not has_function_privilege('authenticated', 'pm_si_text(text, int, text)', 'execute')
   and not has_function_privilege('authenticated', 'pm_si_project_ok(uuid, uuid)', 'execute')
union all
select 'events sequence unusable by clients',
       not has_sequence_privilege('authenticated', 'pm_sharing_item_events_id_seq', 'usage')
   and not has_sequence_privilege('anon', 'pm_sharing_item_events_id_seq', 'usage')
union all
select 'pm_si_file_ok: anon no, authenticated yes',
       not has_function_privilege('anon', 'pm_si_file_ok(text, boolean)', 'execute')
   and has_function_privilege('authenticated', 'pm_si_file_ok(text, boolean)', 'execute')
union all
select 'history trigger', exists (select 1 from pg_trigger where tgname = 'pm_si_events_immutable_trg')
union all
select 'read has items', pg_get_functiondef('pm_sharing_read(uuid[])'::regprocedure) like '%''items''%'
union all
select 'storage read rule', pg_get_functiondef('uploads_can_read(text, text)'::regprocedure) like '%pm_si_file_ok(p_name, false)%'
union all
select 'storage write rule', pg_get_functiondef('uploads_can_write(text)'::regprocedure) like '%pm_si_file_ok(p_name, true)%'
union all
select 'no overwrite', exists (select 1 from pg_policies where policyname = 'uploads_admin_update'
                                and qual like '%pmSharing%')
union all
select 'starts empty', (select count(*) from pm_sharing_items) = 0;
