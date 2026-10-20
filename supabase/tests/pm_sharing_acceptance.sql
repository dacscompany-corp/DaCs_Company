-- ════════════════════════════════════════════════════════════════════
-- 0098 PM profit sharing — live acceptance (RLS, grants, roles).
-- Self-wrapped in begin / rollback: nothing persists. Run through the
-- Supabase MCP execute_sql (not the SQL editor — see memory note on its
-- RLS step). Needs one active main owner, one owner-role account whose
-- owner_id points to it, and one active staff account of that owner.
-- Success ends with the row 'pm sharing acceptance: all checks passed'.
-- ════════════════════════════════════════════════════════════════════
begin;
set local statement_timeout = '60s';

select set_config('vpm.owner', (select id::text from profiles
  where role = 'owner' and owner_id is null and coalesce(status, 'active') = 'active' order by created_at limit 1), true);
select set_config('vpm.pmowner', (select id::text from profiles
  where role = 'owner' and owner_id::text = current_setting('vpm.owner') and coalesce(status, 'active') = 'active' order by created_at limit 1), true);
select set_config('vpm.staff', (select id::text from profiles
  where role = 'staff' and owner_id::text = current_setting('vpm.owner') and coalesce(status, 'active') = 'active'
  order by created_at limit 1), true);
do $$ begin
  assert current_setting('vpm.owner', true) <> '' and current_setting('vpm.pmowner', true) <> ''
     and current_setting('vpm.staff', true) <> '', 'need a main owner, a focused owner and a staff account';
end $$;

-- 1. The owner creates a project: the trigger maps it.
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('vpm.owner'), 'role', 'authenticated')::text, true);
with ins as (insert into construction_projects (project_name, client_name, status)
             values ('ZZ pm sharing acceptance', 'ZZ client', 'active') returning id)
select set_config('vpm.proj', (select id::text from ins), true);
do $$ declare r jsonb; begin
  r := pm_sharing_read(array[current_setting('vpm.proj')::uuid]);
  assert jsonb_array_length(r->'projects') = 1, 'ACC-1 mapped on create';
  assert (r->>'can_edit')::boolean, 'ACC-1 owner can edit';
  r := pm_set_sharing(current_setting('vpm.proj')::uuid, 40, 0, 'acceptance');
  assert (r->>'changed')::boolean and (r->>'version')::int = 1, 'ACC-2 first save';
  r := pm_set_sharing(current_setting('vpm.proj')::uuid, 40, 1, '');
  assert not (r->>'changed')::boolean, 'ACC-3 same % no-op';
  begin perform pm_set_sharing(current_setting('vpm.proj')::uuid, 40.123, 1, 'x');
        raise exception 'ACC-4 40.123 accepted';
  exception when others then assert sqlerrm like '%BAD_PCT%', 'ACC-4 ' || sqlerrm; end;
  begin perform pm_set_sharing(current_setting('vpm.proj')::uuid, 30, 0, 'x');
        raise exception 'ACC-5 stale accepted';
  exception when others then assert sqlerrm like '%STALE%', 'ACC-5 ' || sqlerrm; end;
end $$;

-- 2. Direct table access is denied for signed-in users (even the owner).
do $$ begin
  begin perform 1 from pm_sharing_agreements limit 1; raise exception 'ACC-6 direct read allowed';
  exception when insufficient_privilege then null; end;
  begin update pm_sharing_changes set reason = 'x'; raise exception 'ACC-7 history update allowed';
  exception when insufficient_privilege then null; end;
  begin insert into pm_project_companies (project_id, company_owner_id, source)
        values (current_setting('vpm.proj')::uuid, auth.uid(), 'created'); raise exception 'ACC-8 mapping insert allowed';
  exception when insufficient_privilege then null; end;
end $$;

-- 3. Focused owner: reads, cannot write.
select set_config('request.jwt.claims', json_build_object('sub', current_setting('vpm.pmowner'), 'role', 'authenticated')::text, true);
do $$ declare r jsonb; begin
  r := pm_sharing_read(array[current_setting('vpm.proj')::uuid]);
  assert jsonb_array_length(r->'projects') = 1 and not (r->>'can_edit')::boolean, 'ACC-9 focused owner reads, view only';
  assert jsonb_array_length(r->'history') = 1, 'ACC-9 history visible';
  begin perform pm_set_sharing(current_setting('vpm.proj')::uuid, 30, 1, 'x'); raise exception 'ACC-10 focused write allowed';
  exception when others then assert sqlerrm like '%OWNER_ONLY%', 'ACC-10 ' || sqlerrm; end;
  perform wf_reserves_for(array[current_setting('vpm.proj')::uuid]);
end $$;

-- 4. Staff: no reads, no writes.
select set_config('request.jwt.claims', json_build_object('sub', current_setting('vpm.staff'), 'role', 'authenticated')::text, true);
do $$ begin
  begin perform pm_sharing_read(null); raise exception 'ACC-11 staff read allowed';
  exception when others then assert sqlerrm like '%OWNER_ONLY%', 'ACC-11 ' || sqlerrm; end;
  begin perform wf_reserves_for(array[current_setting('vpm.proj')::uuid]); raise exception 'ACC-12 staff reserve read allowed';
  exception when others then assert sqlerrm like '%OWNER_ONLY%', 'ACC-12 ' || sqlerrm; end;
  begin perform pm_set_sharing(current_setting('vpm.proj')::uuid, 30, 1, 'x'); raise exception 'ACC-13 staff write allowed';
  exception when others then assert sqlerrm like '%OWNER_ONLY%', 'ACC-13 ' || sqlerrm; end;
end $$;

-- 4b. Trust gate: nobody can promote themselves or cut their own company link.
select set_config('request.jwt.claims', json_build_object('sub', current_setting('vpm.staff'), 'role', 'authenticated')::text, true);
do $$ declare ok boolean := false; begin
  begin update profiles set owner_id = null where id = auth.uid();
  exception when others then ok := true; end;
  assert ok, 'ACC-T1 staff changed own owner_id';
  ok := false;
  begin update profiles set role = 'owner' where id = auth.uid();
  exception when others then ok := true; end;
  assert ok, 'ACC-T2 staff changed own role';
end $$;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('vpm.pmowner'), 'role', 'authenticated')::text, true);
do $$ declare ok boolean := false; begin
  begin update profiles set owner_id = null where id = auth.uid();
  exception when others then ok := true; end;
  assert ok, 'ACC-T3 focused owner changed own owner_id';
end $$;

-- 5. Owner reads the recorded reserves of real completed projects (if any).
select set_config('request.jwt.claims', json_build_object('sub', current_setting('vpm.owner'), 'role', 'authenticated')::text, true);
do $$ declare n int; m int; begin
  select count(*) into m from pm_sharing_read(null) x, jsonb_array_elements(x->'projects') e;
  select jsonb_array_length(wf_reserves_for(array(select (e->>'project_id')::uuid
           from jsonb_array_elements(pm_sharing_read(null)->'projects') e))) into n;
  raise notice 'mapped projects: %, reserves readable: %', m, n;
end $$;

rollback;
select 'pm sharing acceptance: all checks passed' as result;
