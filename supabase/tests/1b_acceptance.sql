-- ════════════════════════════════════════════════════════════════════
-- Stage 1b-1 acceptance — item history server (migration 0090).
--
-- Wraps itself in begin / rollback: nothing persists. Builds its own
-- throwaway projects, items, requests, references and gallery rows (names
-- start "ZZ 1b") and checks only what it built. Editor-safe: context lives
-- in transaction-local settings (set_config 'v1b.*'), never a temp table.
-- Dry run with 0090:  begin;  <0090>  <this file>  (its own begin only
-- warns; its rollback undoes the migration too).
--
-- Accounts: W-0007 and W-0019 (active workers of one owner), an active
-- staff account of that owner, and another owner account.
-- A failed check stops the script with its message (in the SQL editor the whole transaction is then aborted — expected; nothing is kept); success ends with the row
-- '1b acceptance: all checks passed'.
-- ════════════════════════════════════════════════════════════════════

begin;

-- ── 0. Throwaway data (as the database owner) ──
do $$
declare
  v_w7 uuid; v_w19 uuid; v_owner uuid; v_staff uuid; v_other uuid;
  v_on uuid; v_aw uuid; v_off uuid; v_done uuid; v_oth_p uuid;
  v_item uuid; v_item2 uuid; v_bare uuid; v_old uuid; v_oth_item uuid;
  v_batch uuid; v_r_on uuid; v_r_off uuid; v_r_mine uuid;
  v_l_on uuid; v_l_cx uuid; v_l_free uuid; v_l_off uuid; v_l_mine uuid;
  v_ref_on uuid; v_ref_off uuid; v_ref_ret uuid; v_ref_done uuid; v_ref_oth uuid;
  v_ph1 uuid; v_ph2 uuid; v_g_appr uuid; v_g_ret uuid;
  v_p_appr text; v_p_ret text; v_p_oth text; v_p_unrec text; v_p_new text; v_p_bare text; v_g_bare uuid; v_p_rq1 text; v_p_rq2 text;
begin
  select id into v_w7  from profiles where worker_no = 7  and role = 'worker' and coalesce(status, 'active') = 'active';
  select id into v_w19 from profiles where worker_no = 19 and role = 'worker' and coalesce(status, 'active') = 'active';
  assert v_w7 is not null and v_w19 is not null, 'W-0007 and W-0019 must exist as active workers';
  v_owner := (select coalesce(owner_id, id) from profiles where id = v_w7);
  assert (select coalesce(owner_id, id) from profiles where id = v_w19) = v_owner, 'W-0007 and W-0019 must share one owner';
  select id into v_staff from profiles where role = 'staff' and owner_id = v_owner and coalesce(status, 'active') = 'active' limit 1;
  select id into v_other from profiles where role = 'owner' and id <> v_owner limit 1;
  assert v_staff is not null and v_other is not null, 'need an active staff account of that owner and another owner';

  insert into folders (owner_id, name) values (v_owner, 'ZZ 1b history on') returning id into v_on;
  insert into folders (owner_id, name, parent_folder_id) values (v_owner, 'ZZ 1b AW', v_on) returning id into v_aw;
  insert into folders (owner_id, name) values (v_owner, 'ZZ 1b history off') returning id into v_off;
  insert into folders (owner_id, name, completed_at) values (v_owner, 'ZZ 1b done', now()) returning id into v_done;
  insert into folders (owner_id, name) values (v_other, 'ZZ 1b other company') returning id into v_oth_p;
  insert into pr_project_settings (folder_id, owner_id, allow_requests, allow_history) values
    (v_on, v_owner, true, true), (v_off, v_owner, true, false), (v_done, v_owner, false, true), (v_oth_p, v_other, true, true);

  insert into pr_catalog_items (owner_id, kind, name, spec, unit, category, aliases, brand)
  values (v_owner, 'material', 'ZZ 1b outlet', '2-gang', 'pc', 'electrical', '{saksakan}', 'ZZBrand') returning id into v_item;
  insert into pr_catalog_items (owner_id, kind, name, spec, unit, category)
  values (v_owner, 'material', 'ZZ 1b elbow', '1/2 in', 'pc', 'plumbing') returning id into v_item2;
  insert into pr_catalog_items (owner_id, kind, name, spec, unit, category)
  values (v_owner, 'material', 'ZZ 1b bare', '', 'pc', 'misc') returning id into v_bare;
  insert into pr_catalog_items (owner_id, kind, name, spec, unit, category, active)
  values (v_owner, 'material', 'ZZ 1b old pipe', '3 in', 'length', 'plumbing', false) returning id into v_old;
  insert into pr_catalog_items (owner_id, kind, name, spec, unit, category)
  values (v_other, 'material', 'ZZ 1b outlet', '2-gang', 'pc', 'electrical') returning id into v_oth_item;

  v_batch := pr_batch_for(v_owner, now());
  -- W-0019 on the history-on project's Additional Works: live, cancelled and unmatched lines.
  insert into pr_requests (owner_id, requester_id, folder_id, work_folder_id, client_op_id)
  values (v_owner, v_w19, v_on, v_aw, gen_random_uuid()) returning id into v_r_on;
  insert into pr_lines (owner_id, request_id, position, kind, catalog_item_id, description, unit, notes)
  values (v_owner, v_r_on, 0, 'material', v_item, 'outlet po', 'pc', 'ZZPRIVATENOTE') returning id into v_l_on;
  insert into pr_lines (owner_id, request_id, position, kind, catalog_item_id, description, unit, status)
  values (v_owner, v_r_on, 1, 'material', v_item, 'outlet ulit', 'pc', 'cancelled') returning id into v_l_cx;
  insert into pr_lines (owner_id, request_id, position, kind, description, unit)
  values (v_owner, v_r_on, 2, 'material', 'yung malaking pako', 'pc') returning id into v_l_free;
  -- W-0019 on the history-off project.
  insert into pr_requests (owner_id, requester_id, folder_id, work_folder_id, client_op_id)
  values (v_owner, v_w19, v_off, v_off, gen_random_uuid()) returning id into v_r_off;
  insert into pr_lines (owner_id, request_id, position, kind, catalog_item_id, description, unit)
  values (v_owner, v_r_off, 0, 'material', v_item, 'outlet', 'pc') returning id into v_l_off;
  -- W-0007's own line on the history-off project, for an item no longer listed.
  insert into pr_requests (owner_id, requester_id, folder_id, work_folder_id, client_op_id)
  values (v_owner, v_w7, v_off, v_off, gen_random_uuid()) returning id into v_r_mine;
  insert into pr_lines (owner_id, request_id, position, kind, catalog_item_id, description, unit)
  values (v_owner, v_r_mine, 0, 'material', v_old, 'old pipe', 'length') returning id into v_l_mine;
  insert into pr_line_portions (owner_id, line_id, batch_id, quantity) values
    (v_owner, v_l_on, v_batch, 6), (v_owner, v_l_cx, v_batch, 2), (v_owner, v_l_free, v_batch, 1),
    (v_owner, v_l_off, v_batch, 3), (v_owner, v_l_mine, v_batch, 1);

  insert into pr_item_refs (owner_id, catalog_item_id, folder_id, work_folder_id, description, ref_date, date_precision, source_note, created_by)
  values (v_owner, v_item, v_on, v_aw, 'Outlet used in the AW kitchen', '2026-08-01', 'approximate', 'from an old Messenger photo', v_owner)
  returning id into v_ref_on;
  insert into pr_item_refs (owner_id, catalog_item_id, folder_id, work_folder_id, description, ref_date, date_precision, created_by)
  values (v_owner, v_item, v_off, v_off, 'Outlet on the history-off site', '2026-07-15', 'exact', v_owner) returning id into v_ref_off;
  insert into pr_item_refs (owner_id, catalog_item_id, folder_id, work_folder_id, description, date_precision, created_by,
                            retired_at, retired_by, retire_reason)
  values (v_owner, v_item, v_on, v_on, 'Wrongly entered', 'unknown', v_owner, now(), v_owner, 'wrong item') returning id into v_ref_ret;
  insert into pr_item_refs (owner_id, catalog_item_id, folder_id, work_folder_id, description, date_precision, created_by, created_at)
  values (v_owner, v_item, v_done, v_done, 'Outlet on the finished job', 'unknown', v_owner, now() - interval '1 day') returning id into v_ref_done;
  insert into pr_item_refs (owner_id, catalog_item_id, folder_id, work_folder_id, description, ref_date, date_precision, created_by)
  values (v_other, v_oth_item, v_oth_p, v_oth_p, 'Other company outlet', '2026-06-01', 'exact', v_other) returning id into v_ref_oth;

  v_p_appr  := v_owner || '/' || v_item || '/' || gen_random_uuid() || '.jpg';
  v_p_ret   := v_owner || '/' || v_item || '/' || gen_random_uuid() || '.jpg';
  v_p_unrec := v_owner || '/' || v_item || '/' || gen_random_uuid() || '.jpg';
  v_p_new   := v_owner || '/' || v_item || '/' || gen_random_uuid() || '.jpg';
  v_p_bare  := v_owner || '/' || v_bare || '/' || gen_random_uuid() || '.jpg';
  v_p_oth   := v_other || '/' || v_oth_item || '/' || gen_random_uuid() || '.jpg';
  insert into storage.objects (bucket_id, name, owner) values
    ('item-gallery', v_p_appr, v_owner), ('item-gallery', v_p_ret, v_owner),
    ('item-gallery', v_p_unrec, v_owner), ('item-gallery', v_p_oth, v_other), ('item-gallery', v_p_bare, v_owner);
  insert into pr_gallery_photos (owner_id, catalog_item_id, storage_path, source, is_cover, checklist_confirmed, approved_by)
  values (v_owner, v_item, v_p_appr, 'upload', true, true, v_owner) returning id into v_g_appr;
  insert into pr_gallery_photos (owner_id, catalog_item_id, storage_path, source, is_cover, status, checklist_confirmed, approved_by,
                                 retired_at, retired_by, retire_reason)
  values (v_owner, v_item, v_p_ret, 'upload', false, 'retired', true, v_owner, now(), v_owner, 'shows a price') returning id into v_g_ret;
  insert into pr_gallery_photos (owner_id, catalog_item_id, storage_path, source, is_cover, checklist_confirmed, approved_by)
  values (v_owner, v_bare, v_p_bare, 'upload', true, true, v_owner) returning id into v_g_bare;
  insert into pr_gallery_photos (owner_id, catalog_item_id, storage_path, source, is_cover, checklist_confirmed, approved_by)
  values (v_other, v_oth_item, v_p_oth, 'upload', true, true, v_other);

  v_p_rq1 := v_w19 || '/' || v_r_on || '/' || gen_random_uuid() || '.jpg';
  v_p_rq2 := v_w19 || '/' || v_r_on || '/' || gen_random_uuid() || '.jpg';
  insert into storage.objects (bucket_id, name, owner) values ('request-photos', v_p_rq1, v_w19), ('request-photos', v_p_rq2, v_w19);
  insert into pr_photos (owner_id, request_id, line_id, storage_path, uploaded_by) values (v_owner, v_r_on, v_l_on, v_p_rq1, v_w19)
  returning id into v_ph1;
  insert into pr_photos (owner_id, request_id, line_id, storage_path, uploaded_by) values (v_owner, v_r_on, v_l_on, v_p_rq2, v_w19)
  returning id into v_ph2;

  perform set_config('v1b.w7', v_w7::text, true);       perform set_config('v1b.w19', v_w19::text, true);
  perform set_config('v1b.owner', v_owner::text, true); perform set_config('v1b.staff', v_staff::text, true);
  perform set_config('v1b.other', v_other::text, true);
  perform set_config('v1b.on', v_on::text, true);       perform set_config('v1b.aw', v_aw::text, true);
  perform set_config('v1b.off', v_off::text, true);     perform set_config('v1b.done', v_done::text, true);
  perform set_config('v1b.oth_p', v_oth_p::text, true);
  perform set_config('v1b.item', v_item::text, true);   perform set_config('v1b.item2', v_item2::text, true);
  perform set_config('v1b.bare', v_bare::text, true);   perform set_config('v1b.old', v_old::text, true);
  perform set_config('v1b.oth_item', v_oth_item::text, true);
  perform set_config('v1b.l_on', v_l_on::text, true);   perform set_config('v1b.l_cx', v_l_cx::text, true);
  perform set_config('v1b.l_off', v_l_off::text, true); perform set_config('v1b.l_mine', v_l_mine::text, true);
  perform set_config('v1b.ref_on', v_ref_on::text, true);     perform set_config('v1b.ref_off', v_ref_off::text, true);
  perform set_config('v1b.ref_ret', v_ref_ret::text, true);   perform set_config('v1b.ref_done', v_ref_done::text, true);
  perform set_config('v1b.ref_oth', v_ref_oth::text, true);
  perform set_config('v1b.ph1', v_ph1::text, true);     perform set_config('v1b.ph2', v_ph2::text, true);
  perform set_config('v1b.g_appr', v_g_appr::text, true); perform set_config('v1b.g_ret', v_g_ret::text, true);
  perform set_config('v1b.p_appr', v_p_appr, true);     perform set_config('v1b.p_ret', v_p_ret, true);
  perform set_config('v1b.p_unrec', v_p_unrec, true);   perform set_config('v1b.p_new', v_p_new, true);
  perform set_config('v1b.p_oth', v_p_oth, true);       perform set_config('v1b.p_bare', v_p_bare, true);
end $$;

-- ── 1. W-0007: search, detail, cleanup, storage and direct access ──
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('v1b.w7'), 'role', 'authenticated')::text, true);
do $$
declare
  v jsonb; v_keys text[]; v_e jsonb;
  v_item uuid := current_setting('v1b.item')::uuid;
  v_old uuid := current_setting('v1b.old')::uuid;
begin
  v := pr_history_search('ZZ 1b');
  assert (select array_agg((i ->> 'id')::uuid order by i ->> 'name') from jsonb_array_elements(v -> 'items') i
           where i ->> 'name' like 'ZZ 1b%') = array[v_old, v_item],
    'W-0007 finds only the old pipe (own request) and the outlet: ' || v::text;
  assert (select i -> 'latest' ->> 'project_name' from jsonb_array_elements(v -> 'items') i where (i ->> 'id')::uuid = v_item) = 'ZZ 1b history on'
     and (select i ->> 'cover_path' from jsonb_array_elements(v -> 'items') i where (i ->> 'id')::uuid = v_item) = current_setting('v1b.p_appr'),
    'the outlet''s latest entry is on the history-on project and its card carries the approved cover: ' || v::text;
  assert (select count(*) from jsonb_array_elements(pr_history_search('saksakan') -> 'items') i where (i ->> 'id')::uuid = v_item) = 1, 'alias search';
  assert (select count(*) from jsonb_array_elements(pr_history_search('zzbrand') -> 'items') i where (i ->> 'id')::uuid = v_item) = 1, 'brand search';
  assert not exists (select 1 from jsonb_array_elements(pr_history_search('ZZ%1b') -> 'items') i where i ->> 'name' like 'ZZ 1b%'),
    '% is matched literally, not as a wildcard';
  assert not exists (select 1 from jsonb_array_elements(pr_history_search('ZZ 1b', 'tool') -> 'items') i where i ->> 'name' like 'ZZ 1b%'),
    'kind filter';
  v := pr_history_search('ZZ 1b', null, null, current_setting('v1b.off')::uuid);
  assert (select array_agg((i ->> 'id')::uuid) from jsonb_array_elements(v -> 'items') i where i ->> 'name' like 'ZZ 1b%') = array[v_old],
    'project filter on the history-off project: only the own line';
  v := pr_history_search('ZZ 1b', null, null, null, '2026-07-31', '2026-08-02');
  assert (select array_agg((i ->> 'id')::uuid) from jsonb_array_elements(v -> 'items') i where i ->> 'name' like 'ZZ 1b%') = array[v_item]
     and (select i -> 'latest' ->> 'date_precision' from jsonb_array_elements(v -> 'items') i where (i ->> 'id')::uuid = v_item) = 'approximate',
    'date filter finds the approximate August reference';
  v := pr_history_search('ZZ 1b', null, null, null, null, null, 1, 0);
  assert jsonb_array_length(v -> 'items') = 1 and (v ->> 'has_more')::boolean, 'pagination: one item and more to come';

  v := pr_history_item(v_item);
  v_keys := array(select (e ->> 'entry_kind') || ':' || (e ->> 'entry_id') from jsonb_array_elements(v -> 'entries') e order by 1);
  assert v_keys = array(select unnest(array['request_line:' || current_setting('v1b.l_on'), 'request_line:' || current_setting('v1b.l_cx'),
                                            'reference:' || current_setting('v1b.ref_on'), 'reference:' || current_setting('v1b.ref_done')]) order by 1),
    'W-0007 sees exactly the history-on lines and the live references on switched-on projects: ' || array_to_string(v_keys, ', ');
  select e into v_e from jsonb_array_elements(v -> 'entries') e where e ->> 'entry_id' = current_setting('v1b.l_on');
  assert v_e ->> 'label' = 'Requested' and (v_e ->> 'quantity')::numeric = 6 and v_e ->> 'work_name' = 'ZZ 1b AW'
     and v_e ->> 'project_name' = 'ZZ 1b history on', 'live line: ' || v_e::text;
  select e into v_e from jsonb_array_elements(v -> 'entries') e where e ->> 'entry_id' = current_setting('v1b.l_cx');
  assert v_e ->> 'label' = 'Requested — cancelled' and v_e -> 'quantity' = 'null'::jsonb, 'cancelled line: ' || v_e::text;
  select e into v_e from jsonb_array_elements(v -> 'entries') e where e ->> 'entry_id' = current_setting('v1b.ref_on');
  assert v_e ->> 'label' = 'Historical reference' and v_e ->> 'date_precision' = 'approximate'
     and v_e ->> 'note' = 'from an old Messenger photo', 'reference: ' || v_e::text;
  select e into v_e from jsonb_array_elements(v -> 'entries') e where e ->> 'entry_id' = current_setting('v1b.ref_done');
  assert v_e ->> 'date_precision' = 'unknown' and v_e -> 'date' = 'null'::jsonb and v_e ->> 'project_name' = 'ZZ 1b done',
    'a completed project keeps its history: ' || v_e::text;
  assert v::text not like '%ZZPRIVATENOTE%', 'line notes never reach a worker';
  assert not exists (select 1 from jsonb_array_elements(v -> 'entries') e where e ->> 'requester_name' is not null), 'no requester names';
  assert (select array_agg((p ->> 'id')::uuid) from jsonb_array_elements(v -> 'photos') p) = array[current_setting('v1b.g_appr')::uuid],
    'only the approved photo, never the retired one';
  assert v::text !~* '"[a-z_]*(price|amount|cost|peso)[a-z_]*"\s*:', 'no money keys';

  begin perform pr_history_item(current_setting('v1b.oth_item')::uuid); assert false, 'saw another company''s item';
  exception when others then assert sqlerrm = 'HISTORY_NOT_AVAILABLE', 'other company: ' || sqlerrm; end;
  begin perform pr_history_item(current_setting('v1b.item2')::uuid); assert false, 'saw an item with no visible history';
  exception when others then assert sqlerrm = 'HISTORY_NOT_AVAILABLE', 'no history: ' || sqlerrm; end;
  v := pr_history_item(v_old);
  assert (v ->> 'active')::boolean = false and jsonb_array_length(v -> 'entries') = 1
     and v -> 'entries' -> 0 ->> 'entry_id' = current_setting('v1b.l_mine'), 'own request on a history-off project: ' || v::text;

  v := pr_history_visible(array[v_item, v_old, current_setting('v1b.oth_item')::uuid, current_setting('v1b.item2')::uuid]);
  assert jsonb_array_length(v) = 2, 'cleanup keeps exactly two items: ' || v::text;
  select x into v_e from jsonb_array_elements(v) x where (x ->> 'item_id')::uuid = v_item;
  assert jsonb_array_length(v_e -> 'entries') = 4 and v_e -> 'photo_ids' = jsonb_build_array(current_setting('v1b.g_appr')), 'cleanup detail: ' || v_e::text;
  begin perform pr_history_visible(array(select gen_random_uuid() from generate_series(1, 501))); assert false, '501 items accepted';
  exception when others then assert sqlerrm = 'TOO_MANY_ITEMS', 'cap: ' || sqlerrm; end;

  assert (select count(*) from storage.objects where bucket_id = 'item-gallery'
           and name = current_setting('v1b.p_appr')) = 1,
    'a worker reads the approved photo';
  assert (select count(*) from storage.objects where bucket_id = 'item-gallery'
           and name in (current_setting('v1b.p_ret'), current_setting('v1b.p_unrec'), current_setting('v1b.p_oth'), current_setting('v1b.p_bare'))) = 0,
    'a worker never reads a retired, unrecorded, other-company, or no-history item''s photo';
  assert (select count(*) from pr_item_refs) = 0 and (select count(*) from pr_gallery_photos) = 0, 'no direct reads of the new tables';
  begin
    insert into pr_item_refs (owner_id, catalog_item_id, folder_id, work_folder_id, description, date_precision, created_by)
    values (current_setting('v1b.owner')::uuid, v_item, current_setting('v1b.on')::uuid, current_setting('v1b.on')::uuid, 'x', 'unknown', auth.uid());
    assert false, 'a worker inserted a reference';
  exception when insufficient_privilege then null; end;
  begin
    insert into storage.objects (bucket_id, name, owner)
    values ('item-gallery', current_setting('v1b.owner') || '/' || v_item || '/' || gen_random_uuid() || '.jpg', auth.uid());
    assert false, 'a worker uploaded to the gallery';
  exception when insufficient_privilege then null; end;
  begin perform pr_office_history_search('ZZ'); assert false, 'a worker used an office RPC';
  exception when others then assert sqlerrm = 'OFFICE_ONLY', 'office RPC: ' || sqlerrm; end;
end $$;

-- ── 2. Switching history off: per-entry cleanup; own requests stay ──
select set_config('request.jwt.claims', json_build_object('sub', current_setting('v1b.owner'), 'role', 'authenticated')::text, true);
do $$
declare p jsonb;
begin
  perform pr_office_set_allow_history(current_setting('v1b.on')::uuid, false);
  select x into p from jsonb_array_elements(pr_office_projects()) x where (x ->> 'folder_id') = current_setting('v1b.on');
  assert (p ->> 'allow_history')::boolean = false and (p ->> 'allow_requests')::boolean = true,
    'the history switch never touches Allow requests: ' || p::text;
end $$;

select set_config('request.jwt.claims', json_build_object('sub', current_setting('v1b.w7'), 'role', 'authenticated')::text, true);
do $$
declare v jsonb;
begin
  v := pr_history_visible(array[current_setting('v1b.item')::uuid]);
  assert jsonb_array_length(v) = 1 and v -> 0 -> 'entries' = jsonb_build_array('reference:' || current_setting('v1b.ref_done')),
    'only the finished project''s entry stays; the switched-off project''s entries go: ' || v::text;
  assert (select count(*) from storage.objects where bucket_id = 'item-gallery' and name = current_setting('v1b.p_appr')) = 1,
    'the photo stays readable while the item is visible through another project';
end $$;

select set_config('request.jwt.claims', json_build_object('sub', current_setting('v1b.w19'), 'role', 'authenticated')::text, true);
do $$
declare v_keys text[];
begin
  v_keys := array(select (e ->> 'entry_kind') || ':' || (e ->> 'entry_id')
                    from jsonb_array_elements(pr_history_item(current_setting('v1b.item')::uuid) -> 'entries') e order by 1);
  assert v_keys = array(select unnest(array['request_line:' || current_setting('v1b.l_on'), 'request_line:' || current_setting('v1b.l_cx'),
                                            'request_line:' || current_setting('v1b.l_off'), 'reference:' || current_setting('v1b.ref_done')]) order by 1),
    'W-0019 keeps their own lines on switched-off projects, and only those: ' || array_to_string(v_keys, ', ');
end $$;

select set_config('request.jwt.claims', json_build_object('sub', current_setting('v1b.owner'), 'role', 'authenticated')::text, true);
select pr_office_set_allow_history(current_setting('v1b.on')::uuid, true);

-- ── 3. Request Again (W-0007) ──
select set_config('request.jwt.claims', json_build_object('sub', current_setting('v1b.w7'), 'role', 'authenticated')::text, true);
do $$
declare
  v_on uuid := current_setting('v1b.on')::uuid;
  v_item uuid := current_setting('v1b.item')::uuid;
  v jsonb; v2 jsonb;
  bad jsonb;
begin
  -- a: a visible entry is kept as the link; the retry returns the first answer
  v := pr_submit_request('00000000-0000-4000-8000-00000001b301', jsonb_build_object('folder_id', v_on, 'lines', jsonb_build_array(
         jsonb_build_object('kind', 'material', 'description', 'ZZ 1b outlet', 'unit', 'pc', 'quantity', 2,
                            'catalog_item_id', v_item, 'ref_kind', 'request_line', 'ref_id', current_setting('v1b.l_on')))));
  v2 := pr_submit_request('00000000-0000-4000-8000-00000001b301', jsonb_build_object('folder_id', v_on, 'lines', jsonb_build_array(
         jsonb_build_object('kind', 'material', 'description', 'ZZ 1b outlet', 'unit', 'pc', 'quantity', 2,
                            'catalog_item_id', v_item, 'ref_kind', 'request_line', 'ref_id', current_setting('v1b.l_on')))));
  assert v = v2, 'a retried Request Again returns the first answer';
  perform set_config('v1b.req_a', v ->> 'request_id', true);
  perform set_config('v1b.line_a', v -> 'line_ids' ->> 0, true);
  -- b: a real entry W-0007 cannot see (W-0019's line on the history-off project) → saved, link dropped
  v := pr_submit_request(gen_random_uuid(), jsonb_build_object('folder_id', v_on, 'lines', jsonb_build_array(
         jsonb_build_object('kind', 'material', 'description', 'ZZ 1b outlet', 'unit', 'pc', 'quantity', 1,
                            'catalog_item_id', v_item, 'ref_kind', 'request_line', 'ref_id', current_setting('v1b.l_off')))));
  perform set_config('v1b.line_b', v -> 'line_ids' ->> 0, true);
  -- c: a real entry of ANOTHER item (re-matched case) → saved, link dropped
  v := pr_submit_request(gen_random_uuid(), jsonb_build_object('folder_id', v_on, 'lines', jsonb_build_array(
         jsonb_build_object('kind', 'material', 'description', 'ZZ 1b elbow', 'unit', 'pc', 'quantity', 1,
                            'catalog_item_id', current_setting('v1b.item2'), 'ref_kind', 'reference', 'ref_id', current_setting('v1b.ref_on')))));
  perform set_config('v1b.line_c', v -> 'line_ids' ->> 0, true);
  -- e: no link at all (Stage 1a behaviour)
  v := pr_submit_request(gen_random_uuid(), jsonb_build_object('folder_id', v_on, 'lines', jsonb_build_array(
         jsonb_build_object('kind', 'material', 'description', 'ZZ 1b outlet', 'unit', 'pc', 'quantity', 1, 'catalog_item_id', v_item))));
  perform set_config('v1b.line_e', v -> 'line_ids' ->> 0, true);
  -- f: two lines in ONE request: line 1 keeps its link, line 2 (no link) must not inherit it
  v := pr_submit_request(gen_random_uuid(), jsonb_build_object('folder_id', v_on, 'lines', jsonb_build_array(
         jsonb_build_object('kind', 'material', 'description', 'ZZ 1b outlet', 'unit', 'pc', 'quantity', 1,
                            'catalog_item_id', v_item, 'ref_kind', 'request_line', 'ref_id', current_setting('v1b.l_on')),
         jsonb_build_object('kind', 'material', 'description', 'ZZ 1b outlet', 'unit', 'pc', 'quantity', 1, 'catalog_item_id', v_item))));
  perform set_config('v1b.line_f1', v -> 'line_ids' ->> 0, true);
  perform set_config('v1b.line_f2', v -> 'line_ids' ->> 1, true);
  -- d: malformed or unknown links are refused
  foreach bad in array array[
      jsonb_build_object('catalog_item_id', v_item, 'ref_kind', 'bogus', 'ref_id', current_setting('v1b.l_on')),
      jsonb_build_object('catalog_item_id', v_item, 'ref_kind', 'request_line', 'ref_id', 'not-a-uuid'),
      jsonb_build_object('catalog_item_id', v_item, 'ref_kind', 'request_line', 'ref_id', gen_random_uuid()),
      jsonb_build_object('ref_kind', 'request_line', 'ref_id', current_setting('v1b.l_on')),
      jsonb_build_object('catalog_item_id', v_item, 'ref_id', current_setting('v1b.l_on')),
      jsonb_build_object('catalog_item_id', v_item, 'ref_kind', 'reference', 'ref_id', current_setting('v1b.ref_oth'))] loop
    begin
      perform pr_submit_request(gen_random_uuid(), jsonb_build_object('folder_id', v_on, 'lines', jsonb_build_array(
                jsonb_build_object('kind', 'material', 'description', 'ZZ 1b bad link', 'unit', 'pc', 'quantity', 1) || bad)));
      assert false, 'a bad link was accepted: ' || bad::text;
    exception when others then assert sqlerrm = 'BAD_REFERENCE', 'bad link ' || bad::text || ': ' || sqlerrm; end;
  end loop;
end $$;

reset role;
do $$
begin
  assert (select ref_kind = 'request_line' and ref_id = current_setting('v1b.l_on')::uuid from pr_lines where id = current_setting('v1b.line_a')::uuid),
    'a: the link is stored';
  assert (select ref_kind is null and ref_id is null from pr_lines where id = current_setting('v1b.line_b')::uuid), 'b: invisible entry dropped';
  assert (select ref_kind is null and ref_id is null from pr_lines where id = current_setting('v1b.line_c')::uuid), 'c: other item''s entry dropped';
  assert (select ref_kind is null from pr_lines where id = current_setting('v1b.line_e')::uuid), 'e: plain line';
  assert (select ref_kind = 'request_line' and ref_id = current_setting('v1b.l_on')::uuid from pr_lines where id = current_setting('v1b.line_f1')::uuid),
    'f: line 1 keeps its link';
  assert (select ref_kind is null and ref_id is null from pr_lines where id = current_setting('v1b.line_f2')::uuid),
    'f: line 2 of the same request has no link (the per-line reset)';
  assert (select count(*) from pr_requests where client_op_id = '00000000-0000-4000-8000-00000001b301') = 1, 'one request for the retried op';
  assert (select l ->> 'ref_label' from jsonb_array_elements(pr_request_doc(current_setting('v1b.req_a')::uuid, false) -> 'lines') l)
           = 'ZZ 1b history on · ZZ 1b AW · ' || to_char(now() at time zone 'Asia/Manila', 'FMMon FMDD, YYYY') || ' · Requested',
    'the office sees the source as a readable label';
end $$;

-- ── 4. The office (owner, then staff, then another company) ──
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('v1b.owner'), 'role', 'authenticated')::text, true);
do $$
declare
  v jsonb; v_e jsonb; v_id uuid; v_new uuid;
  v_item uuid := current_setting('v1b.item')::uuid;
begin
  v := pr_office_history_search('ZZ 1b');
  assert (select count(*) from jsonb_array_elements(v -> 'items') i
           where (i ->> 'id')::uuid in (v_item, current_setting('v1b.item2')::uuid, current_setting('v1b.bare')::uuid, current_setting('v1b.old')::uuid)) = 4
     and not exists (select 1 from jsonb_array_elements(v -> 'items') i where (i ->> 'id')::uuid = current_setting('v1b.oth_item')::uuid),
    'the office finds all its own items, even with no history, and never another company''s';
  assert not exists (select 1 from jsonb_array_elements(pr_office_history_search('ZZ 1b', null, null, current_setting('v1b.off')::uuid) -> 'items') i
                      where (i ->> 'id')::uuid = current_setting('v1b.bare')::uuid), 'a project filter drops items with no history';

  v := pr_office_history_item(v_item);
  assert (select count(*) from jsonb_array_elements(v -> 'entries') e
           where e ->> 'entry_id' in (current_setting('v1b.l_off'), current_setting('v1b.ref_off'), current_setting('v1b.ref_ret'))) = 3,
    'the office sees switched-off and retired entries';
  assert (select (e ->> 'retired')::boolean from jsonb_array_elements(v -> 'entries') e where e ->> 'entry_id' = current_setting('v1b.ref_ret')),
    'a retired reference is flagged';
  assert (select e ->> 'requester_name' from jsonb_array_elements(v -> 'entries') e where e ->> 'entry_id' = current_setting('v1b.l_on')) is not null,
    'the office sees who requested';
  assert (select p ->> 'retire_reason' from jsonb_array_elements(v -> 'photos') p where (p ->> 'id') = current_setting('v1b.g_ret')) = 'shows a price',
    'retired photos stay visible to the office with the reason';
  begin perform pr_office_history_item(current_setting('v1b.oth_item')::uuid); assert false, 'office saw another company''s item';
  exception when others then assert sqlerrm = 'NOT_FOUND', 'other company item: ' || sqlerrm; end;

  -- historical references
  begin perform pr_office_add_ref(v_item, current_setting('v1b.on')::uuid, null, 'x', '2026-08-01', 'unknown', ''); assert false, 'unknown with a date';
  exception when others then assert sqlerrm = 'BAD_REFERENCE', 'unknown+date: ' || sqlerrm; end;
  begin perform pr_office_add_ref(v_item, current_setting('v1b.on')::uuid, null, 'x', null, 'approximate', ''); assert false, 'approximate without a date';
  exception when others then assert sqlerrm = 'BAD_REFERENCE', 'approx no date: ' || sqlerrm; end;
  begin perform pr_office_add_ref(v_item, current_setting('v1b.on')::uuid, null, '  ', null, 'unknown', ''); assert false, 'blank description';
  exception when others then assert sqlerrm = 'BAD_REFERENCE', 'blank: ' || sqlerrm; end;
  begin perform pr_office_add_ref(v_item, current_setting('v1b.off')::uuid, current_setting('v1b.aw')::uuid, 'x', null, 'unknown', ''); assert false, 'AW of another project';
  exception when others then assert sqlerrm = 'BAD_DESTINATION', 'wrong parent: ' || sqlerrm; end;
  begin perform pr_office_add_ref(v_item, current_setting('v1b.aw')::uuid, null, 'x', null, 'unknown', ''); assert false, 'an AW as the project';
  exception when others then assert sqlerrm = 'BAD_DESTINATION', 'AW as project: ' || sqlerrm; end;
  begin perform pr_office_add_ref(v_item, current_setting('v1b.oth_p')::uuid, null, 'x', null, 'unknown', ''); assert false, 'another company''s project';
  exception when others then assert sqlerrm = 'BAD_DESTINATION', 'other company project: ' || sqlerrm; end;
  v_id := (pr_office_add_ref(v_item, current_setting('v1b.done')::uuid, null, 'Seeded after the job', '2026-05-10', 'exact', 'site diary') ->> 'id')::uuid;
  begin perform pr_office_retire_ref(v_id, ' '); assert false, 'retired without a reason';
  exception when others then assert sqlerrm = 'REASON_REQUIRED', 'retire reason: ' || sqlerrm; end;
  perform pr_office_retire_ref(v_id, 'test');
  perform pr_office_retire_ref(v_id, 'again');
  assert (select retire_reason from pr_item_refs where id = v_id) = 'test', 'retiring twice keeps the first record';

  -- photo review queue
  v := pr_office_photo_queue();
  assert (select count(*) from jsonb_array_elements(v) q where q ->> 'photo_id' in (current_setting('v1b.ph1'), current_setting('v1b.ph2'))) = 2
     and (select q -> 'item' ->> 'id' from jsonb_array_elements(v) q where q ->> 'photo_id' = current_setting('v1b.ph1')) = v_item::text,
    'both private photos wait for review, with their item';

  -- office upload policy: own item path yes, another company's path no
  insert into storage.objects (bucket_id, name, owner) values ('item-gallery', current_setting('v1b.p_new'), auth.uid());
  begin
    insert into storage.objects (bucket_id, name, owner)
    values ('item-gallery', current_setting('v1b.other') || '/' || current_setting('v1b.oth_item') || '/' || gen_random_uuid() || '.jpg', auth.uid());
    assert false, 'office uploaded under another company';
  exception when insufficient_privilege then null; end;
  assert (select count(*) from storage.objects where bucket_id = 'item-gallery' and name = current_setting('v1b.p_ret')) = 1,
    'the office can still open a retired photo';

  -- publish a reviewed copy
  begin perform pr_office_publish_photo(current_setting('v1b.ph1')::uuid, current_setting('v1b.p_new'), false); assert false, 'no checklist';
  exception when others then assert sqlerrm = 'CHECKLIST_REQUIRED', 'checklist: ' || sqlerrm; end;
  begin perform pr_office_publish_photo(current_setting('v1b.ph1')::uuid,
          current_setting('v1b.owner') || '/' || current_setting('v1b.item2') || '/' || gen_random_uuid() || '.jpg', true); assert false, 'wrong item path';
  exception when others then assert sqlerrm = 'BAD_PATH', 'wrong path: ' || sqlerrm; end;
  begin perform pr_office_publish_photo(current_setting('v1b.ph1')::uuid,
          current_setting('v1b.owner') || '/' || v_item || '/' || gen_random_uuid() || '.jpg', true); assert false, 'no file';
  exception when others then assert sqlerrm = 'FILE_MISSING', 'missing file: ' || sqlerrm; end;
  v := pr_office_publish_photo(current_setting('v1b.ph1')::uuid, current_setting('v1b.p_new'), true);
  v_new := (v ->> 'id')::uuid;
  assert (v ->> 'is_cover')::boolean = false, 'publishing does not steal the cover unless asked';
  assert (select gallery_review from pr_photos where id = current_setting('v1b.ph1')::uuid) = 'published', 'the photo leaves the queue as published';
  begin perform pr_office_publish_photo(current_setting('v1b.ph1')::uuid, current_setting('v1b.p_unrec'), true); assert false, 'published twice';
  exception when others then assert sqlerrm = 'ALREADY_REVIEWED', 'twice: ' || sqlerrm; end;
  assert (pr_office_keep_private(current_setting('v1b.ph2')::uuid) ->> 'gallery_review') = 'kept_private', 'kept private';
  assert not exists (select 1 from jsonb_array_elements(pr_office_photo_queue()) q
                      where q ->> 'photo_id' in (current_setting('v1b.ph1'), current_setting('v1b.ph2'))), 'reviewed photos leave the queue';

  -- cover and retire
  perform pr_office_set_cover(v_new);
  assert (select cover_set_by from pr_gallery_photos where id = v_new) = auth.uid()
     and (select cover_set_at from pr_gallery_photos where id = v_new) is not null, 'the cover records who and when';
  assert (select array_agg(id) from pr_gallery_photos where catalog_item_id = v_item and is_cover) = array[v_new], 'exactly one cover, the new one';
  begin perform pr_office_retire_photo(v_new, ''); assert false, 'retired without a reason';
  exception when others then assert sqlerrm = 'REASON_REQUIRED', 'photo reason: ' || sqlerrm; end;
  perform pr_office_retire_photo(v_new, 'shows a face');
  assert (select status from pr_gallery_photos where id = v_new) = 'retired'
     and (select array_agg(id) from pr_gallery_photos where catalog_item_id = v_item and is_cover) = array[current_setting('v1b.g_appr')::uuid],
    'retiring the cover hands it to the remaining approved photo';
  begin perform pr_office_set_cover(current_setting('v1b.g_ret')::uuid); assert false, 'a retired photo became cover';
  exception when others then assert sqlerrm = 'PHOTO_RETIRED', 'retired cover: ' || sqlerrm; end;

  -- direct upload, for a reference
  begin perform pr_office_add_gallery_photo(v_item, current_setting('v1b.p_unrec'), false); assert false, 'no checklist';
  exception when others then assert sqlerrm = 'CHECKLIST_REQUIRED', 'upload checklist: ' || sqlerrm; end;
  begin perform pr_office_add_gallery_photo(v_item, current_setting('v1b.p_appr'), true); assert false, 'same file twice';
  exception when others then assert sqlerrm = 'ALREADY_IN_GALLERY', 'twice in gallery: ' || sqlerrm; end;
  v := pr_office_add_gallery_photo(v_item, current_setting('v1b.p_unrec'), true, false, current_setting('v1b.ref_on')::uuid);
  assert (select source from pr_gallery_photos where id = (v ->> 'id')::uuid) = 'reference', 'a photo for a reference';

  -- catalogue: the old 7-argument call still saves and leaves aliases/brand alone
  perform pr_office_save_item(p_item => v_item, p_kind => 'material', p_name => 'ZZ 1b outlet', p_spec => '2-gang',
                              p_unit => 'pc', p_category => 'electrical', p_active => true);
  assert (select aliases = '{saksakan}' and brand = 'ZZBrand' from pr_catalog_items where id = v_item), 'old call shape keeps aliases and brand';
  perform pr_office_save_item(p_item => v_item, p_kind => 'material', p_name => 'ZZ 1b outlet', p_spec => '2-gang',
                              p_unit => 'pc', p_category => 'electrical', p_active => true,
                              p_aliases => array[' Plug ', 'plug', '', 'SAKSAKAN'], p_brand => ' Omni ');
  assert (select array(select lower(a) from unnest(aliases) a order by 1) = array['plug', 'saksakan'] and brand = 'Omni'
            from pr_catalog_items where id = v_item), 'aliases cleaned, brand trimmed';
  begin
    perform pr_office_save_item(p_item => v_item, p_kind => 'material', p_name => 'ZZ 1b outlet', p_spec => '2-gang',
                                p_unit => 'pc', p_category => 'electrical', p_active => true,
                                p_aliases => array(select 'alias ' || g from generate_series(1, 21) g));
    assert false, '21 aliases accepted';
  exception when others then assert sqlerrm = 'BAD_ITEM', 'alias cap: ' || sqlerrm; end;
  assert (select c ->> 'brand' from jsonb_array_elements(pr_office_catalog()) c where (c ->> 'id')::uuid = v_item) = 'Omni', 'catalogue shows the brand';
end $$;

select set_config('request.jwt.claims', json_build_object('sub', current_setting('v1b.staff'), 'role', 'authenticated')::text, true);
do $$
begin
  assert (pr_office_history_item(current_setting('v1b.item')::uuid) ->> 'id') = current_setting('v1b.item'), 'staff use the office RPCs';
end $$;

select set_config('request.jwt.claims', json_build_object('sub', current_setting('v1b.other'), 'role', 'authenticated')::text, true);
do $$
begin
  begin perform pr_office_history_item(current_setting('v1b.item')::uuid); assert false, 'another company read the item';
  exception when others then assert sqlerrm = 'NOT_FOUND', 'other owner item: ' || sqlerrm; end;
  begin perform pr_office_add_ref(current_setting('v1b.item')::uuid, current_setting('v1b.on')::uuid, null, 'x', null, 'unknown', ''); assert false, 'another company added a reference';
  exception when others then assert sqlerrm = 'NOT_FOUND', 'other owner ref: ' || sqlerrm; end;
  assert (select count(*) from storage.objects where bucket_id = 'item-gallery' and name = current_setting('v1b.p_appr')) = 0,
    'another company cannot open the photo';
end $$;

-- ── 5. Signed out ──
reset role;
set local role anon;
select set_config('request.jwt.claims', '{"role": "anon"}', true);
do $$
begin
  begin perform pr_history_search('x'); assert false, 'anon searched';
  exception when insufficient_privilege then null; end;
  begin perform pr_office_history_search('x'); assert false, 'anon used an office RPC';
  exception when insufficient_privilege then null; end;
  begin perform count(*) from pr_item_refs; assert false, 'anon read references';
  exception when insufficient_privilege then null; end;
end $$;

-- ── 6. Permissions and shape (database owner) ──
reset role;
do $$
declare f text;
begin
  foreach f in array array['pr_history_open(uuid,uuid)', 'pr_history_entries(uuid,uuid,boolean,uuid)', 'pr_entry_label(text,boolean)',
      'pr_history_search_doc(uuid,uuid,boolean,text,text,text,uuid,date,date,integer,integer)', 'pr_history_item_doc(uuid,uuid,boolean,uuid,uuid)',
      'pr_clean_aliases(text[])', 'pr_gallery_check_path(uuid,uuid,text)', 'pr_gallery_ensure_cover(uuid,uuid)', 'pr_ref_label(text,uuid)',
      'pr_request_doc(uuid,boolean)'] loop
    assert not has_function_privilege('authenticated', 'public.' || f, 'execute'), f || ' must be internal';
    assert not has_function_privilege('anon', 'public.' || f, 'execute'), f || ' must not be callable by anon';
  end loop;
  foreach f in array array['pr_history_search(text,text,text,uuid,date,date,integer,integer)', 'pr_history_item(uuid,uuid)',
      'pr_history_visible(uuid[])', 'pr_submit_request(uuid,jsonb)', 'pr_can_read_gallery_path(text)', 'pr_office_gallery_path_ok(text)',
      'pr_office_save_item(uuid,text,text,text,text,text,boolean,text[],text)', 'pr_office_set_allow_history(uuid,boolean)',
      'pr_office_history_search(text,text,text,uuid,date,date,integer,integer)', 'pr_office_history_item(uuid,uuid)',
      'pr_office_add_ref(uuid,uuid,uuid,text,date,text,text)', 'pr_office_retire_ref(uuid,text)', 'pr_office_photo_queue()',
      'pr_office_publish_photo(uuid,text,boolean,boolean)', 'pr_office_keep_private(uuid)',
      'pr_office_add_gallery_photo(uuid,text,boolean,boolean,uuid)', 'pr_office_set_cover(uuid)', 'pr_office_retire_photo(uuid,text)',
      'pr_office_catalog()', 'pr_office_projects()'] loop
    assert has_function_privilege('authenticated', 'public.' || f, 'execute'), f || ' must be callable when signed in';
    assert not has_function_privilege('anon', 'public.' || f, 'execute'), f || ' must not be callable by anon';
  end loop;
  assert to_regprocedure('public.pr_office_save_item(uuid,text,text,text,text,text,boolean)') is null, 'the 7-argument save_item is gone';
  assert not has_table_privilege('anon', 'public.pr_item_refs', 'select') and not has_table_privilege('anon', 'public.pr_gallery_photos', 'select'),
    'anon reads neither new table';
  assert not has_table_privilege('authenticated', 'public.pr_item_refs', 'insert')
     and not has_table_privilege('authenticated', 'public.pr_item_refs', 'update')
     and not has_table_privilege('authenticated', 'public.pr_item_refs', 'delete')
     and not has_table_privilege('authenticated', 'public.pr_gallery_photos', 'insert')
     and not has_table_privilege('authenticated', 'public.pr_gallery_photos', 'update')
     and not has_table_privilege('authenticated', 'public.pr_gallery_photos', 'delete'), 'no direct writes to the new tables';
  assert (select public = false from storage.buckets where id = 'item-gallery'), 'item-gallery is private';
  assert not exists (select 1 from information_schema.columns
                      where table_schema = 'public' and table_name like 'pr\_%' and column_name ~* '(price|amount|cost|peso)'),
    'no pr_ table has a money column';
end $$;

select '1b acceptance: all checks passed' as result;

rollback;
