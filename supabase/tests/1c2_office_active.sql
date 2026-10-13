-- ════════════════════════════════════════════════════════════════════
-- Stage 1c-2 — the active-only office check (migration 0094) across EVERY
-- function that calls pr_is_office(): Requests (0085–0088), Item History
-- (0090–0092) and Work Plan (0093/0094) — 43 on 13 October 2026.
--
-- Self-wrapped in begin / rollback: nothing persists. Editor-safe (no temp
-- objects). Every outcome is checked explicitly: an unexpected answer or
-- error is a FAILURE, never a pass.
--   0. Inventory: the live functions that call pr_is_office() must be
--      exactly the list below — kind (read / write / internal), how it
--      refuses a non-office account (raises OFFICE_ONLY / filters to
--      nothing) and the regression script that proves its behaviour for
--      active accounts. A new or changed function fails here until listed.
--      tests/workmate-office-server.test.js checks each "covered by" claim.
--   1. The internal helper (wp_office_task_row) is callable by neither
--      signed-in users nor anon, and pr_is_office() itself stays internal
--      (0086) — this script never calls it as a user; office access is
--      shown only through the callable functions.
--   2. Controlled records (a ZZ project, team, item, request, photo,
--      reference, meeting and task): every read function, as the active
--      owner and as the active staff account, returns them.
--   3. The same staff account made inactive inside this transaction:
--      raising reads (called with the real record ids) and every write
--      (called with NULL arguments) → exactly OFFICE_ONLY; filtering reads
--      → exactly '[]'.
-- Active-account WRITE behaviour is proven by the scripts named in the
-- inventory (0086_verify, 1a, 1b and 1c acceptance), re-run with 0094.
-- A read check that fails because a function's output has a different
-- shape is fixed against that function's real output — never loosened.
-- Success ends with '1c2 office check: all passed (42 callable, 1 internal)'.
-- ════════════════════════════════════════════════════════════════════

begin;
set local statement_timeout = '120s';
set local lock_timeout = '5s';

-- ═══ 0. Inventory, and 1. the internal helper ═══
do $$
declare
  v_inv jsonb;
  v_bad text;
begin
  with inventory(fn, kind, gate, covered_by) as (values
    ('pr_folder_request_count',      'read',      'raises',  '0086_verify'),
    ('pr_office_add_gallery_photo',  'write',     'raises',  '1b_acceptance'),
    ('pr_office_add_member',         'write',     'raises',  '0086_verify'),
    ('pr_office_add_ref',            'write',     'raises',  '1b_acceptance'),
    ('pr_office_batches',            'read',      'raises',  '0086_verify'),
    ('pr_office_cancel_line',        'write',     'raises',  '1a_acceptance'),
    ('pr_office_catalog',            'read',      'filters', '1b_acceptance'),
    ('pr_office_change_quantity',    'write',     'raises',  '0086_verify'),
    ('pr_office_history_item',       'read',      'raises',  '1b_acceptance'),
    ('pr_office_history_search',     'read',      'raises',  '1b_acceptance'),
    ('pr_office_keep_private',       'write',     'raises',  '1b_acceptance'),
    ('pr_office_match_item',         'write',     'raises',  '1a_acceptance'),
    ('pr_office_move_portion',       'write',     'raises',  '0086_verify'),
    ('pr_office_people',             'read',      'filters', '0086_verify'),
    ('pr_office_photo_queue',        'read',      'filters', '1b_acceptance'),
    ('pr_office_projects',           'read',      'filters', '1b_acceptance'),
    ('pr_office_publish_photo',      'write',     'raises',  '1b_acceptance'),
    ('pr_office_queue',              'read',      'filters', '1a_acceptance'),
    ('pr_office_remove_member',      'write',     'raises',  '0086_verify'),
    ('pr_office_request',            'read',      'raises',  '0086_verify'),
    ('pr_office_resolve_conflict',   'write',     'raises',  '0086_verify'),
    ('pr_office_resolve_reduction',  'write',     'raises',  '0086_verify'),
    ('pr_office_retire_photo',       'write',     'raises',  '1b_acceptance'),
    ('pr_office_retire_ref',         'write',     'raises',  '1b_acceptance'),
    ('pr_office_save_item',          'write',     'raises',  '1b_acceptance'),
    ('pr_office_save_team',          'write',     'raises',  '0086_verify'),
    ('pr_office_set_allow_history',  'write',     'raises',  '1b_acceptance'),
    ('pr_office_set_allow_requests', 'write',     'raises',  '0086_verify'),
    ('pr_office_set_arranged',       'write',     'raises',  '1a_acceptance'),
    ('pr_office_set_batch_dates',    'write',     'raises',  '1a_acceptance'),
    ('pr_office_set_cover',          'write',     'raises',  '1b_acceptance'),
    ('pr_office_set_leader',         'write',     'raises',  '0086_verify'),
    ('pr_office_teams',              'read',      'filters', '0086_verify'),
    ('wp_office_board',              'read',      'raises',  '1c_acceptance'),
    ('wp_office_clear_blocker',      'write',     'raises',  '1c_acceptance'),
    ('wp_office_destinations',       'read',      'filters', '1c_acceptance'),
    ('wp_office_meeting',            'read',      'raises',  '1c_acceptance'),
    ('wp_office_meetings',           'read',      'filters', '1c_acceptance'),
    ('wp_office_publish',            'write',     'raises',  '1c_acceptance'),
    ('wp_office_save_meeting',       'write',     'raises',  '1c_acceptance'),
    ('wp_office_save_task',          'write',     'raises',  '1c_acceptance'),
    ('wp_office_task',               'read',      'raises',  '1c_acceptance'),
    ('wp_office_task_row',           'internal',  'raises',  '1c_acceptance')
  )
  select jsonb_agg(jsonb_build_object('fn', fn, 'kind', kind, 'gate', gate, 'covered_by', covered_by)) into v_inv from inventory;

  select string_agg(coalesce(i.fn, l.fn) || ': ' ||
           case when i.fn is null then 'calls pr_is_office() but is not in the inventory'
                when l.fn is null then 'listed but not found'
                when l.anon then 'callable by anon'
                when (i.kind = 'internal') = l.callable then 'callable = ' || l.callable || ' for a ' || i.kind || ' function'
                else 'refuses by ' || l.gate || ', listed as ' || i.gate end, '; ')
    into v_bad
    from jsonb_to_recordset(v_inv) as i(fn text, kind text, gate text, covered_by text)
    full join (select p.proname::text as fn,
                      has_function_privilege('authenticated', p.oid, 'execute') as callable,
                      has_function_privilege('anon', p.oid, 'execute') as anon,
                      case when p.prosrc ~* 'if\s+not\s+pr_is_office\(\)\s+then\s+raise\s+exception\s+''OFFICE_ONLY'''
                           then 'raises' else 'filters' end as gate
                 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                where n.nspname = 'public' and p.prosrc ilike '%pr_is_office()%' and p.proname <> 'pr_is_office') l
      on l.fn = i.fn
   where i.fn is null or l.fn is null or l.anon or (i.kind = 'internal') = l.callable or i.gate <> l.gate;
  assert v_bad is null, '0/1 inventory mismatch: ' || v_bad;
  -- The office check itself stays internal (0086): no client may call it.
  assert not has_function_privilege('authenticated', 'public.pr_is_office()', 'execute')
     and not has_function_privilege('anon', 'public.pr_is_office()', 'execute')
     and not has_function_privilege('public', 'public.pr_is_office()', 'execute'), '1 pr_is_office() must stay internal';
  perform set_config('voa.inventory', v_inv::text, true);
end $$;

-- ═══ Controlled records (as the database owner) ═══
do $$
declare
  v_w7 uuid; v_owner uuid; v_staff uuid; v_p uuid; v_team uuid; v_item uuid; v_batch uuid;
  v_req uuid; v_line uuid; v_path text; v_photo uuid; v_ref uuid;
begin
  select id into v_w7 from profiles where worker_no = 7 and role = 'worker' and coalesce(status, 'active') = 'active';
  assert v_w7 is not null, 'W-0007 must exist and be active';
  v_owner := (select coalesce(owner_id, id) from profiles where id = v_w7);
  assert (select role from profiles where id = v_owner) = 'owner'
     and coalesce((select status from profiles where id = v_owner), 'active') = 'active', 'W-0007''s owner must be an active owner';
  select id into v_staff from profiles where role = 'staff' and owner_id = v_owner and coalesce(status, 'active') = 'active' limit 1;
  assert v_staff is not null, 'need an active staff account of that owner';

  insert into folders (owner_id, name) values (v_owner, 'ZZ 1c2 oa project') returning id into v_p;
  insert into pr_project_settings (folder_id, owner_id, allow_requests, allow_history) values (v_p, v_owner, true, true);
  insert into pr_teams (owner_id, name) values (v_owner, 'ZZ 1c2 oa team') returning id into v_team;
  insert into pr_team_members (owner_id, team_id, worker_id, is_leader) values (v_owner, v_team, v_w7, false);
  insert into pr_catalog_items (owner_id, kind, name, spec, unit, category)
  values (v_owner, 'material', 'ZZ 1c2 oa outlet', '2-gang', 'pc', 'electrical') returning id into v_item;
  v_batch := pr_batch_for(v_owner, now());
  insert into pr_requests (owner_id, requester_id, folder_id, work_folder_id, client_op_id)
  values (v_owner, v_w7, v_p, v_p, gen_random_uuid()) returning id into v_req;
  insert into pr_lines (owner_id, request_id, position, kind, catalog_item_id, description, unit)
  values (v_owner, v_req, 0, 'material', v_item, 'ZZ 1c2 oa outlet line', 'pc') returning id into v_line;
  insert into pr_line_portions (owner_id, line_id, batch_id, quantity) values (v_owner, v_line, v_batch, 2);
  v_path := v_w7 || '/' || v_req || '/' || gen_random_uuid() || '.jpg';
  insert into storage.objects (bucket_id, name, owner) values ('request-photos', v_path, v_w7);
  insert into pr_photos (owner_id, request_id, line_id, storage_path, uploaded_by)
  values (v_owner, v_req, v_line, v_path, v_w7) returning id into v_photo;
  insert into pr_item_refs (owner_id, catalog_item_id, folder_id, work_folder_id, description, ref_date, date_precision, created_by)
  values (v_owner, v_item, v_p, v_p, 'ZZ 1c2 oa reference', '2026-10-01', 'exact', v_owner) returning id into v_ref;

  perform set_config('voa.w7', v_w7::text, true);       perform set_config('voa.owner', v_owner::text, true);
  perform set_config('voa.staff', v_staff::text, true); perform set_config('voa.p', v_p::text, true);
  perform set_config('voa.team', v_team::text, true);   perform set_config('voa.item', v_item::text, true);
  perform set_config('voa.batch', v_batch::text, true); perform set_config('voa.req', v_req::text, true);
  perform set_config('voa.photo', v_photo::text, true); perform set_config('voa.ref', v_ref::text, true);
end $$;

-- A meeting and a task, made through the office functions by the active staff account.
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('voa.staff'), 'role', 'authenticated')::text, true);
do $$
declare
  v_m uuid; v_t uuid;
begin
  v_m := (wp_office_save_meeting(null, 'ZZ 1c2 oa meeting', current_date, 'office notes') ->> 'meeting_id')::uuid;
  v_t := (wp_office_save_task(null, jsonb_build_object('meeting_id', v_m, 'folder_id', current_setting('voa.p'),
           'work_id', current_setting('voa.p'), 'title', 'ZZ 1c2 oa task', 'helper_ids', '[]'::jsonb, 'depends_on', '[]'::jsonb))
          -> 'task' ->> 'id')::uuid;
  perform set_config('voa.m', v_m::text, true);
  perform set_config('voa.t', v_t::text, true);
end $$;

-- ═══ 2. Active owner and active staff: every read returns the controlled records ═══
do $$
declare
  who text;
  p uuid := current_setting('voa.p')::uuid;
  has text;
begin
  assert (select count(*) from jsonb_to_recordset(current_setting('voa.inventory')::jsonb) as x(fn text, kind text)
           where kind = 'read') = 16, '2 this section checks 16 reads; the inventory now lists a different number — add the check';
  foreach who in array array[current_setting('voa.owner'), current_setting('voa.staff')] loop
    perform set_config('request.jwt.claims', json_build_object('sub', who, 'role', 'authenticated')::text, true);
    has := ' must return it for ' || who;
    assert pr_office_people()::text        like '%' || current_setting('voa.w7')    || '%', '2 pr_office_people: W-0007' || has;
    assert pr_office_teams()::text         like '%' || current_setting('voa.team')  || '%', '2 pr_office_teams: the team' || has;
    assert pr_office_catalog()::text       like '%' || current_setting('voa.item')  || '%', '2 pr_office_catalog: the item' || has;
    assert pr_office_projects()::text      like '%' || current_setting('voa.p')     || '%', '2 pr_office_projects: the project' || has;
    assert pr_office_queue('open')::text   like '%' || current_setting('voa.req')   || '%', '2 pr_office_queue: the request' || has;
    assert pr_office_photo_queue()::text   like '%' || current_setting('voa.photo') || '%', '2 pr_office_photo_queue: the photo' || has;
    assert wp_office_destinations()::text  like '%' || current_setting('voa.p')     || '%', '2 wp_office_destinations: the project' || has;
    assert wp_office_meetings()::text      like '%' || current_setting('voa.m')     || '%', '2 wp_office_meetings: the meeting' || has;
    assert pr_folder_request_count(p) = 1, '2 pr_folder_request_count: exactly the one request' || has;
    assert pr_office_batches()::text       like '%' || current_setting('voa.batch') || '%', '2 pr_office_batches: the batch' || has;
    assert pr_office_history_item(current_setting('voa.item')::uuid, null)::text like '%' || current_setting('voa.item') || '%',
      '2 pr_office_history_item: the item' || has;
    assert pr_office_history_search('ZZ 1c2 oa outlet', null, null, null, null, null, 50, 0)::text like '%' || current_setting('voa.item') || '%',
      '2 pr_office_history_search: the item' || has;
    assert pr_office_request(current_setting('voa.req')::uuid)::text like '%' || current_setting('voa.req') || '%',
      '2 pr_office_request: the request' || has;
    assert wp_office_board(p)::text        like '%' || current_setting('voa.t')     || '%', '2 wp_office_board: the task' || has;
    assert wp_office_meeting(current_setting('voa.m')::uuid)::text like '%' || current_setting('voa.m') || '%', '2 wp_office_meeting' || has;
    assert wp_office_task(current_setting('voa.t')::uuid)::text    like '%' || current_setting('voa.t') || '%', '2 wp_office_task' || has;
  end loop;
end $$;

-- ═══ 3. The same staff account, inactive: refused by every callable function ═══
reset role;
update profiles set status = 'inactive' where id = current_setting('voa.staff')::uuid;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('voa.staff'), 'role', 'authenticated')::text, true);
do $$
declare
  f record;
  v_out text;
  v_bad text := '';
  v_seen text[] := '{}';
  v_expected text[];
begin
  -- 3a. Filtering reads: exactly '[]' — none of the controlled records.
  for f in select * from (values
      ('pr_office_people',       pr_office_people()::text),
      ('pr_office_teams',        pr_office_teams()::text),
      ('pr_office_catalog',      pr_office_catalog()::text),
      ('pr_office_projects',     pr_office_projects()::text),
      ('pr_office_queue',        pr_office_queue('open')::text),
      ('pr_office_photo_queue',  pr_office_photo_queue()::text),
      ('wp_office_destinations', wp_office_destinations()::text),
      ('wp_office_meetings',     wp_office_meetings()::text)) as x(fn, out) loop
    v_seen := v_seen || f.fn;
    if f.out is distinct from '[]' then v_bad := v_bad || ' ' || f.fn || ' returned ' || left(coalesce(f.out, 'null'), 60); end if;
  end loop;

  -- 3b. Raising reads, called with the real record ids: exactly OFFICE_ONLY.
  for f in select * from (values
      ('pr_folder_request_count',  format('select pr_folder_request_count(%L::uuid)::text', current_setting('voa.p'))),
      ('pr_office_batches',        'select pr_office_batches()::text'),
      ('pr_office_history_item',   format('select pr_office_history_item(%L::uuid, null)::text', current_setting('voa.item'))),
      ('pr_office_history_search', 'select pr_office_history_search(''ZZ 1c2 oa outlet'', null, null, null, null, null, 50, 0)::text'),
      ('pr_office_request',        format('select pr_office_request(%L::uuid)::text', current_setting('voa.req'))),
      ('wp_office_board',          format('select wp_office_board(%L::uuid)::text', current_setting('voa.p'))),
      ('wp_office_meeting',        format('select wp_office_meeting(%L::uuid)::text', current_setting('voa.m'))),
      ('wp_office_task',           format('select wp_office_task(%L::uuid)::text', current_setting('voa.t')))) as x(fn, sql) loop
    v_seen := v_seen || f.fn;
    begin
      execute f.sql into v_out;
      v_bad := v_bad || ' ' || f.fn || ' answered';
    exception when others then
      if sqlerrm <> 'OFFICE_ONLY' then v_bad := v_bad || ' ' || f.fn || ' (' || sqlerrm || ')'; end if;
    end;
  end loop;

  -- 3c. Every write, called with NULL arguments: exactly OFFICE_ONLY (the
  --     office check comes first; any other outcome is a failure).
  for f in select x.fn,
                  (select string_agg('null::' || format_type(t, null), ', ' order by i)
                     from unnest(p.proargtypes::oid[]) with ordinality as a(t, i)) as nulls
             from jsonb_to_recordset(current_setting('voa.inventory')::jsonb) as x(fn text, kind text)
             join pg_proc p on p.proname = x.fn
             join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public'
            where x.kind = 'write'
            order by x.fn loop
    v_seen := v_seen || f.fn;
    begin
      execute format('select public.%I(%s)::text', f.fn, coalesce(f.nulls, '')) into v_out;
      v_bad := v_bad || ' ' || f.fn || ' answered';
    exception when others then
      if sqlerrm <> 'OFFICE_ONLY' then v_bad := v_bad || ' ' || f.fn || ' (' || sqlerrm || ')'; end if;
    end;
  end loop;

  assert v_bad = '', '3 an inactive office account got through:' || v_bad;
  select array_agg(fn order by fn) into v_expected
    from jsonb_to_recordset(current_setting('voa.inventory')::jsonb) as x(fn text, kind text) where kind <> 'internal';
  assert (select array_agg(x order by x) from unnest(v_seen) x) = v_expected,
    '3 every callable office function was checked exactly once; checked: ' || array_to_string(v_seen, ', ');
end $$;

reset role;
select '1c2 office check: all passed (42 callable, 1 internal)' as result;

rollback;
