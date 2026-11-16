-- Linked Labor (0113) — the after-check on live. READ ONLY: it changes nothing.
-- Run after 0113 is applied. Every row must say ok = true; the counts are
-- compared with the snapshot taken (read-only) just before 0113 was applied.
with
fns(sig, public_fn) as (values
  ('lc_link_candidates()', true), ('lc_link(uuid,uuid,integer,text)', true), ('lc_edit(uuid,jsonb,text)', true),
  ('lc_end(uuid,text)', true), ('lc_reopen(uuid,text)', true), ('lc_delete(uuid,text)', true),
  ('lc_merge(uuid[],uuid,text,text)', true), ('ll_my_agreements()', true),
  ('lc_terms(labor_contracts)', false), ('lc_blank_free(jsonb)', false), ('lc_established(uuid,boolean)', false), ('lc_history_appended(jsonb,jsonb)', false),
  ('lc_person_name(uuid)', false), ('lc_who(uuid)', false), ('lc_eligible_worker(uuid,uuid)', false),
  ('lc_office_company()', false), ('lc_owner_company()', false), ('lc_check_link(uuid,uuid,text)', false),
  ('lc_works_list(jsonb)', false), ('lc_draws_down(payroll)', false), ('lc_guard()', false), ('lc_log()', false),
  ('ll_num(jsonb)', false), ('ll_truthy(jsonb)', false), ('ll_folder_progress(uuid)', false), ('lc_events_no_change()', false)),
checks(name, ok, detail) as (
  select 'columns worker_id, ended_at, ended_by',
         (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'labor_contracts'
             and column_name in ('worker_id', 'ended_at', 'ended_by')) = 3, null::text
  union all
  select 'lc_events exists with row security on',
         coalesce((select relrowsecurity from pg_class where oid = 'public.lc_events'::regclass), false), null
  union all
  select 'lc_events: owner read policy only',
         (select count(*) from pg_policy where polrelid = 'public.lc_events'::regclass) = 1
         and exists (select 1 from pg_policy where polrelid = 'public.lc_events'::regclass and polname = 'lc_events_owner_read' and polcmd = 'r'), null
  union all
  select 'lc_events: authenticated may only select',
         has_table_privilege('authenticated', 'public.lc_events', 'select')
         and not has_table_privilege('authenticated', 'public.lc_events', 'insert')
         and not has_table_privilege('authenticated', 'public.lc_events', 'update')
         and not has_table_privilege('authenticated', 'public.lc_events', 'delete')
         and not has_table_privilege('anon', 'public.lc_events', 'select'), null
  union all
  select 'triggers on labor_contracts and lc_events',
         (select count(*) from pg_trigger where not tgisinternal and
            ((tgrelid = 'public.labor_contracts'::regclass and tgname in ('lc_guard', 'lc_log')) or
             (tgrelid = 'public.lc_events'::regclass and tgname in ('lc_events_no_change', 'lc_events_no_truncate')))) = 4,
         (select string_agg(tgname, ', ') from pg_trigger where not tgisinternal and tgrelid in ('public.labor_contracts'::regclass, 'public.lc_events'::regclass))
  union all
  select 'function grants: ' || sig,
         has_function_privilege('authenticated', 'public.' || sig, 'execute') = public_fn
         and not has_function_privilege('anon', 'public.' || sig, 'execute'), null
    from fns
  union all
  select 'no contract is linked or ended yet',
         not exists (select 1 from public.labor_contracts where worker_id is not null or ended_at is not null or ended_by is not null), null
  union all
  select 'labor_contracts policy unchanged (lc_admin only)',
         (select string_agg(polname, ',' order by polname) from pg_policy where polrelid = 'public.labor_contracts'::regclass) = 'lc_admin', null
)
select name, ok, detail from checks order by ok, name;

-- The counts, to compare with the snapshot taken before 0113 (nothing may move):
select (select count(*) from public.labor_contracts) contracts,
       (select count(*) from public.payroll) payroll_rows,
       (select coalesce(sum(total_salary), 0) from public.payroll) payroll_total,
       (select count(*) from public.payroll where contract_id is not null) contract_payroll_rows,
       (select count(*) from public.lc_events) history_rows,
       (select md5(string_agg(id::text || coalesce(worker_name, '') || coalesce(agreed_amount::text, '') || coalesce(scope, ''), '|' order by id))
          from public.labor_contracts) contracts_fingerprint;
