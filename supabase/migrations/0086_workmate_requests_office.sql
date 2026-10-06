-- 0086 — WorkMate Requests, Stage 1a-2: the office side (Dacs Web).
--
-- ── WHAT. Admin/staff read the request queue and act on it: mark portions
--    arranged, resolve a worker's reduction of arranged quantity, resolve
--    an offline edit conflict, change or cancel a line (with a reason),
--    match an unlisted item to the catalogue, move a portion between
--    weekly batches and change a batch's purchasing/delivery dates. They
--    also manage teams, the catalogue and "Allow requests" per project.
--    Spec: docs/superpowers/specs/2026-09-29-unified-worker-app-design.md.
--
-- ── EVERY OFFICE WRITE IS AN RPC. Each one checks pr_is_office() and
--    can_access(owner) on the server, locks the pr_lines row before its
--    portions (the 0085 worker RPCs lock the same row, so a worker's edit
--    and an office action can never interleave), and writes pr_events.
--
-- ── BATCH ROWS: created only by pr_batch_for (0085). The office changes
--    only purchase_on / delivery_on through pr_office_set_batch_dates, so
--    the direct insert/update policies 0085 left on pr_batches are dropped.
--    The setup tables' (teams, members, catalogue, project settings) direct
--    insert/update policies are dropped too; they change only via the RPCs.
--
-- ── NO MONEY. Purchasing amounts arrive with Stage 2/4.

-- ════ §1 Who is "the office" ════════════════════════════════════════════

create or replace function pr_is_office() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(is_owner() or is_staff(), false)
$$;

drop policy if exists pr_batches_admin_insert on pr_batches;
drop policy if exists pr_batches_admin_update on pr_batches;

-- 0085 also left direct insert/update policies on the setup tables. They
-- check only the new row's owner_id, not what it points at (another
-- company's team or folder), so every setup write now goes through the
-- office RPCs below. The read policies stay.
drop policy if exists pr_teams_admin_insert on pr_teams;
drop policy if exists pr_teams_admin_update on pr_teams;
drop policy if exists pr_team_members_admin_insert on pr_team_members;
drop policy if exists pr_team_members_admin_update on pr_team_members;
drop policy if exists pr_catalog_items_admin_insert on pr_catalog_items;
drop policy if exists pr_catalog_items_admin_update on pr_catalog_items;
drop policy if exists pr_project_settings_admin_insert on pr_project_settings;
drop policy if exists pr_project_settings_admin_update on pr_project_settings;

-- ════ §2 Reading requests ══════════════════════════════════════════════

-- One request as the office sees it. Names only — never contact details.
create or replace function pr_request_doc(p_request uuid, p_full boolean) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', r.id, 'status', r.status, 'received_at', r.received_at, 'drafted_at', r.drafted_at,
    'note', r.note, 'cancelled_at', r.cancelled_at,
    'requester_id', r.requester_id, 'requester_name', pr_person_name(r.requester_id),
    'project_id', r.folder_id, 'project_name', f.name,
    'work_id', r.work_folder_id,
    'work_name', case when r.work_folder_id = r.folder_id then 'Main Contract' else w.name end,
    'team_id', r.team_id, 'team_name', t.name,
    'lines', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', l.id, 'position', l.position, 'kind', l.kind, 'description', l.description,
               'spec', l.spec, 'unit', l.unit, 'category', l.category,
               'catalog_item_id', l.catalog_item_id, 'catalog_name', c.name, 'catalog_spec', c.spec, 'catalog_unit', c.unit,
               'intended_member_id', l.intended_member_id,
               'intended_member_name', case when l.intended_member_id is null then null else pr_person_name(l.intended_member_id) end,
               'urgent', l.urgent, 'urgent_reason', l.urgent_reason, 'needed_by', l.needed_by, 'notes', l.notes,
               'status', l.status, 'version', l.version, 'has_conflict', l.has_conflict,
               'needed', (select coalesce(sum(p.quantity - p.pending_reduction), 0) from pr_line_portions p where p.line_id = l.id),
               'portions', (
                 select coalesce(jsonb_agg(jsonb_build_object(
                          'id', p.id, 'batch_id', p.batch_id, 'quantity', p.quantity,
                          'pending_reduction', p.pending_reduction,
                          'arranged', p.arranged_at is not null, 'arranged_at', p.arranged_at,
                          'arranged_by_name', case when p.arranged_by is null then null else pr_person_name(p.arranged_by) end,
                          'cutoff_at', b.cutoff_at, 'purchase_on', b.purchase_on, 'delivery_on', b.delivery_on)
                        order by b.cutoff_at, p.created_at), '[]'::jsonb)
                   from pr_line_portions p join pr_batches b on b.id = p.batch_id
                  where p.line_id = l.id),
               'open_conflicts', (
                 select coalesce(jsonb_agg(jsonb_build_object(
                          'id', k.id, 'proposed_quantity', k.proposed_quantity, 'current_quantity', k.current_quantity,
                          'base_version', k.base_version, 'current_version', k.current_version,
                          'created_at', k.created_at, 'proposed_by_name', pr_person_name(k.proposed_by))
                        order by k.created_at), '[]'::jsonb)
                   from pr_line_conflicts k
                  where k.line_id = l.id and k.resolved_at is null))
             order by l.position), '[]'::jsonb)
        from pr_lines l
        left join pr_catalog_items c on c.id = l.catalog_item_id
       where l.request_id = r.id),
    'photos', (
      select coalesce(jsonb_agg(jsonb_build_object('id', ph.id, 'line_id', ph.line_id, 'path', ph.storage_path)
                       order by ph.created_at), '[]'::jsonb)
        from pr_photos ph where ph.request_id = r.id),
    'events', case when p_full then (
      select coalesce(jsonb_agg(jsonb_build_object(
               'kind', e.kind, 'detail', e.detail, 'line_id', e.line_id,
               'actor_name', pr_person_name(e.actor_id), 'created_at', e.created_at)
             order by e.created_at, e.id), '[]'::jsonb)
        from pr_events e where e.request_id = r.id) end)
  from pr_requests r
  join folders f on f.id = r.folder_id
  join folders w on w.id = r.work_folder_id
  left join pr_teams t on t.id = r.team_id
  where r.id = p_request
$$;

-- 'open' = the office still has something to do: an open line, an arranged
-- quantity a worker reduced or cancelled (pending_reduction), or an offline
-- edit conflict. A cancelled request with an order still to undo stays open.
-- 'closed' = none of these.
create or replace function pr_office_queue(p_scope text default 'open') returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(pr_request_doc(x.id, false) order by x.received_at desc), '[]'::jsonb)
    from (
      select r.id, r.received_at
        from pr_requests r
       where pr_is_office() and can_access(r.owner_id)
         and (exists (select 1 from pr_lines l where l.request_id = r.id and l.status = 'open')
              or exists (select 1 from pr_line_portions p join pr_lines l on l.id = p.line_id
                          where l.request_id = r.id and p.pending_reduction > 0)
              or exists (select 1 from pr_line_conflicts k join pr_lines l on l.id = k.line_id
                          where l.request_id = r.id and k.resolved_at is null))
             = (coalesce(p_scope, 'open') <> 'closed')
       -- Work the office must still resolve (a reduction or an offline-edit
       -- conflict) is never cut off by the cap; the rest is newest first.
       order by (exists (select 1 from pr_line_portions p join pr_lines l on l.id = p.line_id
                          where l.request_id = r.id and p.pending_reduction > 0)
                 or exists (select 1 from pr_line_conflicts k join pr_lines l on l.id = k.line_id
                             where l.request_id = r.id and k.resolved_at is null)) desc,
                r.received_at desc
       limit 300) x
$$;

create or replace function pr_office_request(p_request uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_owner uuid;
begin
  if not pr_is_office() then
    raise exception 'OFFICE_ONLY' using errcode = 'P0001';
  end if;
  select owner_id into v_owner from pr_requests where id = p_request;
  if v_owner is null or not can_access(v_owner) then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  return pr_request_doc(p_request, true);
end;
$$;

-- ════ §3 Acting on lines and portions ══════════════════════════════════

-- Arranged = the office has arranged this quantity for purchase. A worker
-- can then only FLAG a reduction on it (0085). Undo is refused while a
-- reduction is pending: resolve it first.
create or replace function pr_office_set_arranged(p_portion uuid, p_arranged boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_line uuid;
  l record;
  p record;
begin
  if not pr_is_office() then
    raise exception 'OFFICE_ONLY' using errcode = 'P0001';
  end if;
  select line_id into v_line from pr_line_portions where id = p_portion;
  if v_line is null then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  select ln.id, ln.owner_id, ln.request_id, ln.status into l from pr_lines ln where ln.id = v_line for update;
  if not can_access(l.owner_id) then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  select * into p from pr_line_portions where id = p_portion for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;

  if coalesce(p_arranged, false) then
    if l.status <> 'open' then
      raise exception 'LINE_CLOSED' using errcode = 'P0001';
    end if;
    if p.arranged_at is null then
      update pr_line_portions set arranged_at = now(), arranged_by = v_uid where id = p_portion;
      insert into pr_events (owner_id, request_id, line_id, actor_id, kind, detail)
      values (l.owner_id, l.request_id, l.id, v_uid, 'portion_arranged',
              jsonb_build_object('portion_id', p_portion, 'quantity', p.quantity));
    end if;
  else
    if p.pending_reduction > 0 then
      raise exception 'REDUCTION_PENDING' using errcode = 'P0001';
    end if;
    if p.arranged_at is not null then
      update pr_line_portions set arranged_at = null, arranged_by = null where id = p_portion;
      insert into pr_events (owner_id, request_id, line_id, actor_id, kind, detail)
      values (l.owner_id, l.request_id, l.id, v_uid, 'portion_unarranged',
              jsonb_build_object('portion_id', p_portion, 'quantity', p.quantity));
    end if;
  end if;
  return jsonb_build_object('portion_id', p_portion, 'arranged', coalesce(p_arranged, false));
end;
$$;

-- A worker reduced arranged quantity (pending_reduction). The office says
-- what happened to the order: reduced with the supplier, or kept (the extra
-- becomes surplus — tracked as stock from Stage 2). Either way the portion
-- now holds only what is still needed; the outcome is in pr_events.
create or replace function pr_office_resolve_reduction(p_portion uuid, p_outcome text, p_note text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_line uuid;
  v_removed boolean := false;
  l record;
  p record;
begin
  if not pr_is_office() then
    raise exception 'OFFICE_ONLY' using errcode = 'P0001';
  end if;
  if p_outcome is null or p_outcome not in ('order_reduced', 'kept_as_surplus') then
    raise exception 'BAD_OUTCOME' using errcode = 'P0001';
  end if;
  select line_id into v_line from pr_line_portions where id = p_portion;
  if v_line is null then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  select ln.id, ln.owner_id, ln.request_id into l from pr_lines ln where ln.id = v_line for update;
  if not can_access(l.owner_id) then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  select * into p from pr_line_portions where id = p_portion for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  if p.pending_reduction <= 0 then
    raise exception 'NOTHING_PENDING' using errcode = 'P0001';
  end if;

  if p.quantity - p.pending_reduction <= 0 then
    delete from pr_line_portions where id = p_portion;
    v_removed := true;
  else
    update pr_line_portions set quantity = quantity - pending_reduction, pending_reduction = 0 where id = p_portion;
  end if;
  insert into pr_events (owner_id, request_id, line_id, actor_id, kind, detail)
  values (l.owner_id, l.request_id, l.id, v_uid, 'reduction_resolved',
          jsonb_build_object('portion_id', p_portion, 'quantity', p.pending_reduction, 'outcome', p_outcome,
                             'note', nullif(btrim(coalesce(p_note, '')), '')));
  return jsonb_build_object('portion_id', p_portion, 'removed', v_removed);
end;
$$;

-- The office changes a line's quantity (spec §4B). Same portion rules as the
-- worker's change (pr_apply_quantity); the version rises so a worker's
-- offline edit made before this becomes a conflict, not an overwrite.
create or replace function pr_office_change_quantity(p_line uuid, p_quantity numeric, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_current numeric;
  l record;
begin
  if not pr_is_office() then
    raise exception 'OFFICE_ONLY' using errcode = 'P0001';
  end if;
  if btrim(coalesce(p_reason, '')) = '' then
    raise exception 'REASON_REQUIRED' using errcode = 'P0001';
  end if;
  if p_quantity is null or p_quantity <= 0 or p_quantity > 1000000 or p_quantity <> round(p_quantity, 3) then
    raise exception 'BAD_QUANTITY' using errcode = 'P0001';
  end if;
  select ln.id, ln.owner_id, ln.request_id, ln.status, ln.version into l from pr_lines ln where ln.id = p_line for update;
  if not found or not can_access(l.owner_id) then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  if l.status <> 'open' then
    raise exception 'LINE_CLOSED' using errcode = 'P0001';
  end if;

  select coalesce(sum(quantity - pending_reduction), 0) into v_current from pr_line_portions where line_id = p_line;
  if p_quantity = v_current then
    return jsonb_build_object('status', 'unchanged', 'version', l.version, 'needed', v_current);
  end if;
  perform pr_apply_quantity(p_line, p_quantity, l.owner_id);
  update pr_lines set version = version + 1 where id = p_line;
  insert into pr_events (owner_id, request_id, line_id, actor_id, kind, detail)
  values (l.owner_id, l.request_id, l.id, v_uid, 'office_quantity_changed',
          jsonb_build_object('from', v_current, 'to', p_quantity, 'reason', btrim(p_reason)));
  return jsonb_build_object('status', 'applied', 'version', l.version + 1, 'needed', p_quantity);
end;
$$;

-- The office cancels a line (with a reason). Unarranged quantity goes;
-- arranged quantity is flagged for the office to resolve, like a worker's
-- cancel. When no open line is left, the request is marked cancelled.
create or replace function pr_office_cancel_line(p_line uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_closed boolean := false;
  l record;
begin
  if not pr_is_office() then
    raise exception 'OFFICE_ONLY' using errcode = 'P0001';
  end if;
  if btrim(coalesce(p_reason, '')) = '' then
    raise exception 'REASON_REQUIRED' using errcode = 'P0001';
  end if;
  -- Same lock order as the worker's pr_cancel_request (0085): request, then line.
  perform 1 from pr_requests r where r.id = (select x.request_id from pr_lines x where x.id = p_line) for update;
  select ln.id, ln.owner_id, ln.request_id, ln.status into l from pr_lines ln where ln.id = p_line for update;
  if not found or not can_access(l.owner_id) then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  if l.status <> 'open' then
    raise exception 'LINE_CLOSED' using errcode = 'P0001';
  end if;

  perform pr_apply_quantity(p_line, 0, l.owner_id);
  update pr_lines set status = 'cancelled', version = version + 1 where id = p_line;
  insert into pr_events (owner_id, request_id, line_id, actor_id, kind, detail)
  values (l.owner_id, l.request_id, l.id, v_uid, 'office_line_cancelled', jsonb_build_object('reason', btrim(p_reason)));

  if not exists (select 1 from pr_lines x where x.request_id = l.request_id and x.status = 'open') then
    update pr_requests set status = 'cancelled', cancelled_at = now() where id = l.request_id and status = 'submitted';
    insert into pr_events (owner_id, request_id, line_id, actor_id, kind, detail)
    values (l.owner_id, l.request_id, null, v_uid, 'request_cancelled', jsonb_build_object('by', 'office'));
    v_closed := true;
  end if;
  return jsonb_build_object('status', 'cancelled', 'request_closed', v_closed);
end;
$$;

-- A worker's offline edit arrived against an outdated version (0085 kept
-- both values). The office either applies the worker's number or keeps the
-- current one; either way the conflict is closed with who and why.
create or replace function pr_office_resolve_conflict(p_conflict uuid, p_apply boolean, p_note text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_line uuid;
  v_current numeric;
  l record;
  k record;
begin
  if not pr_is_office() then
    raise exception 'OFFICE_ONLY' using errcode = 'P0001';
  end if;
  select line_id into v_line from pr_line_conflicts where id = p_conflict;
  if v_line is null then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  select ln.id, ln.owner_id, ln.request_id, ln.status, ln.version into l from pr_lines ln where ln.id = v_line for update;
  if not can_access(l.owner_id) then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  select * into k from pr_line_conflicts where id = p_conflict for update;
  if k.resolved_at is not null then
    raise exception 'ALREADY_RESOLVED' using errcode = 'P0001';
  end if;

  if coalesce(p_apply, false) then
    if l.status <> 'open' then
      raise exception 'LINE_CLOSED' using errcode = 'P0001';
    end if;
    if k.proposed_quantity <= 0 then
      raise exception 'BAD_QUANTITY' using errcode = 'P0001';
    end if;
    select coalesce(sum(quantity - pending_reduction), 0) into v_current from pr_line_portions where line_id = v_line;
    if k.proposed_quantity <> v_current then
      perform pr_apply_quantity(v_line, k.proposed_quantity, l.owner_id);
      update pr_lines set version = version + 1 where id = v_line;
    end if;
  end if;

  update pr_line_conflicts
     set resolved_at = now(), resolved_by = v_uid,
         resolution = case when coalesce(p_apply, false) then 'applied' else 'kept' end
                      || coalesce(': ' || nullif(btrim(coalesce(p_note, '')), ''), '')
   where id = p_conflict;
  update pr_lines
     set has_conflict = exists (select 1 from pr_line_conflicts x where x.line_id = v_line and x.resolved_at is null)
   where id = v_line;
  insert into pr_events (owner_id, request_id, line_id, actor_id, kind, detail)
  values (l.owner_id, l.request_id, l.id, v_uid, 'conflict_resolved',
          jsonb_build_object('conflict_id', p_conflict, 'applied', coalesce(p_apply, false),
                             'proposed', k.proposed_quantity, 'note', nullif(btrim(coalesce(p_note, '')), '')));
  return jsonb_build_object('conflict_id', p_conflict, 'applied', coalesce(p_apply, false));
end;
$$;

-- An unlisted item described by a worker is matched to the official
-- catalogue entry (spec §4A). Null unmatches.
create or replace function pr_office_match_item(p_line uuid, p_item uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  l record;
begin
  if not pr_is_office() then
    raise exception 'OFFICE_ONLY' using errcode = 'P0001';
  end if;
  select ln.id, ln.owner_id, ln.request_id, ln.kind into l from pr_lines ln where ln.id = p_line for update;
  if not found or not can_access(l.owner_id) then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  if p_item is not null and not exists (
       select 1 from pr_catalog_items c
        where c.id = p_item and c.owner_id = l.owner_id and c.active and c.kind = l.kind) then
    raise exception 'BAD_CATALOG_ITEM' using errcode = 'P0001';
  end if;
  update pr_lines set catalog_item_id = p_item where id = p_line;
  insert into pr_events (owner_id, request_id, line_id, actor_id, kind, detail)
  values (l.owner_id, l.request_id, l.id, v_uid, 'item_matched', jsonb_build_object('catalog_item_id', p_item));
  return jsonb_build_object('line_id', p_line, 'catalog_item_id', p_item);
end;
$$;

-- Move an UNARRANGED portion to another weekly batch (spec §4A: "move a late
-- item into an earlier batch when feasible, recording the change"). If the
-- line already has an unarranged portion in that batch, the two merge.
create or replace function pr_office_move_portion(p_portion uuid, p_batch uuid, p_note text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_line uuid;
  v_target uuid;
  v_merged boolean := false;
  l record;
  p record;
begin
  if not pr_is_office() then
    raise exception 'OFFICE_ONLY' using errcode = 'P0001';
  end if;
  select line_id into v_line from pr_line_portions where id = p_portion;
  if v_line is null then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  select ln.id, ln.owner_id, ln.request_id, ln.status into l from pr_lines ln where ln.id = v_line for update;
  if not can_access(l.owner_id) then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  if l.status <> 'open' then
    raise exception 'LINE_CLOSED' using errcode = 'P0001';
  end if;
  select * into p from pr_line_portions where id = p_portion for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  if p.arranged_at is not null then
    raise exception 'ARRANGED' using errcode = 'P0001';
  end if;
  if not exists (select 1 from pr_batches b where b.id = p_batch and b.owner_id = l.owner_id) then
    raise exception 'BAD_BATCH' using errcode = 'P0001';
  end if;
  if p.batch_id = p_batch then
    return jsonb_build_object('moved', false, 'merged', false);
  end if;

  select id into v_target from pr_line_portions
   where line_id = v_line and batch_id = p_batch and arranged_at is null and id <> p_portion
   order by created_at desc, id desc limit 1 for update;
  if v_target is not null then
    update pr_line_portions set quantity = quantity + p.quantity where id = v_target;
    delete from pr_line_portions where id = p_portion;
    v_merged := true;
  else
    update pr_line_portions set batch_id = p_batch where id = p_portion;
  end if;
  insert into pr_events (owner_id, request_id, line_id, actor_id, kind, detail)
  values (l.owner_id, l.request_id, l.id, v_uid, 'portion_moved',
          jsonb_build_object('from_batch', p.batch_id, 'to_batch', p_batch, 'quantity', p.quantity,
                             'note', nullif(btrim(coalesce(p_note, '')), '')));
  return jsonb_build_object('moved', true, 'merged', v_merged);
end;
$$;

-- ════ §4 Weekly batches ════════════════════════════════════════════════

-- This week's and the next two weeks' batches always exist, so the office
-- can move a portion into next week before anything was requested for it.
create or replace function pr_office_batches() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid := data_owner_id();
begin
  if not pr_is_office() then
    raise exception 'OFFICE_ONLY' using errcode = 'P0001';
  end if;
  perform pr_batch_for(v_owner, now());
  perform pr_batch_for(v_owner, now() + interval '7 days');
  perform pr_batch_for(v_owner, now() + interval '14 days');
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
             'id', b.id, 'cutoff_at', b.cutoff_at, 'purchase_on', b.purchase_on, 'delivery_on', b.delivery_on,
             'updated_at', b.updated_at,
             'updated_by_name', case when b.updated_by is null then null else pr_person_name(b.updated_by) end,
             'open_portions', (select count(*) from pr_line_portions p join pr_lines l on l.id = p.line_id
                                where p.batch_id = b.id and l.status = 'open'))
           order by b.cutoff_at), '[]'::jsonb)
      from pr_batches b
     where b.owner_id = v_owner and b.cutoff_at >= now() - interval '35 days');
end;
$$;

-- Holidays and supplier delays move a batch's dates (spec §4A); workers see
-- the new dates. The cutoff itself never changes.
create or replace function pr_office_set_batch_dates(p_batch uuid, p_purchase_on date, p_delivery_on date) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid;
  b record;
begin
  if not pr_is_office() then
    raise exception 'OFFICE_ONLY' using errcode = 'P0001';
  end if;
  select owner_id into v_owner from pr_batches where id = p_batch;
  if v_owner is null or not can_access(v_owner) then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  if p_purchase_on is null or p_delivery_on is null or p_delivery_on < p_purchase_on then
    raise exception 'BAD_DATES' using errcode = 'P0001';
  end if;
  update pr_batches
     set purchase_on = p_purchase_on, delivery_on = p_delivery_on, updated_by = auth.uid(), updated_at = now()
   where id = p_batch
  returning * into b;
  return jsonb_build_object('id', b.id, 'cutoff_at', b.cutoff_at, 'purchase_on', b.purchase_on, 'delivery_on', b.delivery_on);
end;
$$;

-- ════ §5 Teams ═════════════════════════════════════════════════════════

-- Active workers and team leaders of the caller's company. Names only.
create or replace function pr_office_people() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'name', pr_person_name(p.id), 'worker_no', p.worker_no, 'role', p.role)
                  order by lower(pr_person_name(p.id))), '[]'::jsonb)
    from profiles p
   where pr_is_office()
     and p.role in ('worker', 'teamLeader')
     and coalesce(p.status, 'active') = 'active'
     and coalesce(p.owner_id, p.id) = data_owner_id()
$$;

create or replace function pr_office_teams() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', t.id, 'name', t.name, 'active', t.active,
           'members', (select coalesce(jsonb_agg(jsonb_build_object(
                                'worker_id', m.worker_id, 'name', pr_person_name(m.worker_id), 'role', p.role,
                                'is_leader', m.is_leader, 'added_at', m.added_at)
                              order by m.is_leader desc, lower(pr_person_name(m.worker_id))), '[]'::jsonb)
                         from pr_team_members m join profiles p on p.id = m.worker_id
                        where m.team_id = t.id and m.removed_at is null))
         order by t.active desc, lower(t.name)), '[]'::jsonb)
    from pr_teams t
   where pr_is_office() and t.owner_id = data_owner_id()
$$;

create or replace function pr_office_save_team(p_team uuid, p_name text, p_active boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid;
  v_id uuid;
begin
  if not pr_is_office() then
    raise exception 'OFFICE_ONLY' using errcode = 'P0001';
  end if;
  if btrim(coalesce(p_name, '')) = '' then
    raise exception 'BAD_TEAM' using errcode = 'P0001';
  end if;
  begin
    if p_team is null then
      insert into pr_teams (owner_id, name, active) values (data_owner_id(), btrim(p_name), coalesce(p_active, true))
      returning id into v_id;
    else
      select owner_id into v_owner from pr_teams where id = p_team;
      if v_owner is null or not can_access(v_owner) then
        raise exception 'NOT_FOUND' using errcode = 'P0001';
      end if;
      update pr_teams set name = btrim(p_name), active = coalesce(p_active, active) where id = p_team returning id into v_id;
    end if;
  exception when unique_violation then
    raise exception 'DUPLICATE_TEAM' using errcode = 'P0001';
  end;
  return jsonb_build_object('id', v_id);
end;
$$;

create or replace function pr_office_add_member(p_team uuid, p_worker uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid;
begin
  if not pr_is_office() then
    raise exception 'OFFICE_ONLY' using errcode = 'P0001';
  end if;
  select owner_id into v_owner from pr_teams where id = p_team and active;
  if v_owner is null or not can_access(v_owner) then
    raise exception 'BAD_TEAM' using errcode = 'P0001';
  end if;
  if not exists (select 1 from profiles p
                  where p.id = p_worker and p.role in ('worker', 'teamLeader')
                    and coalesce(p.status, 'active') = 'active' and coalesce(p.owner_id, p.id) = v_owner) then
    raise exception 'BAD_WORKER' using errcode = 'P0001';
  end if;
  if not exists (select 1 from pr_team_members m where m.team_id = p_team and m.worker_id = p_worker and m.removed_at is null) then
    insert into pr_team_members (owner_id, team_id, worker_id) values (v_owner, p_team, p_worker);
  end if;
  return jsonb_build_object('team_id', p_team, 'worker_id', p_worker);
end;
$$;

-- Removing keeps the history row (removed_at). A removed leader is no longer leader.
create or replace function pr_office_remove_member(p_team uuid, p_worker uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid;
begin
  if not pr_is_office() then
    raise exception 'OFFICE_ONLY' using errcode = 'P0001';
  end if;
  select owner_id into v_owner from pr_teams where id = p_team;
  if v_owner is null or not can_access(v_owner) then
    raise exception 'BAD_TEAM' using errcode = 'P0001';
  end if;
  update pr_team_members set removed_at = now(), is_leader = false
   where team_id = p_team and worker_id = p_worker and removed_at is null;
  return jsonb_build_object('team_id', p_team, 'worker_id', p_worker);
end;
$$;

-- Spec §3: acting for a team needs the Team Leader role AND this explicit
-- assignment. One leader per team (0085 index): clear first, then set.
create or replace function pr_office_set_leader(p_team uuid, p_worker uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid;
begin
  if not pr_is_office() then
    raise exception 'OFFICE_ONLY' using errcode = 'P0001';
  end if;
  select owner_id into v_owner from pr_teams where id = p_team and active;
  if v_owner is null or not can_access(v_owner) then
    raise exception 'BAD_TEAM' using errcode = 'P0001';
  end if;
  if p_worker is not null then
    if not exists (select 1 from pr_team_members m where m.team_id = p_team and m.worker_id = p_worker and m.removed_at is null) then
      raise exception 'NOT_IN_TEAM' using errcode = 'P0001';
    end if;
    if not exists (select 1 from profiles p
                    where p.id = p_worker and p.role = 'teamLeader' and coalesce(p.status, 'active') = 'active') then
      raise exception 'NOT_A_TEAM_LEADER' using errcode = 'P0001';
    end if;
  end if;
  update pr_team_members set is_leader = false where team_id = p_team and is_leader and removed_at is null;
  if p_worker is not null then
    update pr_team_members set is_leader = true where team_id = p_team and worker_id = p_worker and removed_at is null;
  end if;
  return jsonb_build_object('team_id', p_team, 'leader_id', p_worker);
end;
$$;

-- ════ §6 The catalogue ═════════════════════════════════════════════════

create or replace function pr_office_catalog() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', c.id, 'kind', c.kind, 'name', c.name, 'spec', c.spec, 'unit', c.unit,
           'category', c.category, 'active', c.active)
         order by c.active desc, c.kind, lower(c.name), lower(c.spec)), '[]'::jsonb)
    from pr_catalog_items c
   where pr_is_office() and c.owner_id = data_owner_id()
$$;

-- One row = one defined item (name + spec + unit). The same identity twice
-- is refused (0085 index) so alternate wording never splits stock.
create or replace function pr_office_save_item(p_item uuid, p_kind text, p_name text, p_spec text, p_unit text,
                                               p_category text, p_active boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid;
  v_id uuid;
begin
  if not pr_is_office() then
    raise exception 'OFFICE_ONLY' using errcode = 'P0001';
  end if;
  if p_kind is null or p_kind not in ('material', 'tool')
     or btrim(coalesce(p_name, '')) = '' or btrim(coalesce(p_unit, '')) = '' then
    raise exception 'BAD_ITEM' using errcode = 'P0001';
  end if;
  begin
    if p_item is null then
      insert into pr_catalog_items (owner_id, kind, name, spec, unit, category, active)
      values (data_owner_id(), p_kind, btrim(p_name), btrim(coalesce(p_spec, '')), btrim(p_unit),
              btrim(coalesce(p_category, '')), coalesce(p_active, true))
      returning id into v_id;
    else
      select owner_id into v_owner from pr_catalog_items where id = p_item;
      if v_owner is null or not can_access(v_owner) then
        raise exception 'NOT_FOUND' using errcode = 'P0001';
      end if;
      update pr_catalog_items
         set kind = p_kind, name = btrim(p_name), spec = btrim(coalesce(p_spec, '')), unit = btrim(p_unit),
             category = btrim(coalesce(p_category, '')), active = coalesce(p_active, active), updated_at = now()
       where id = p_item
      returning id into v_id;
    end if;
  exception when unique_violation then
    raise exception 'DUPLICATE_ITEM' using errcode = 'P0001';
  end;
  return jsonb_build_object('id', v_id);
end;
$$;

-- ════ §7 Which projects accept requests ════════════════════════════════

create or replace function pr_office_projects() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'folder_id', f.id, 'name', f.name, 'completed', f.completed_at is not null,
           'allow_requests', coalesce(s.allow_requests, false),
           'hidden_from_time_in', exists (select 1 from attendance_project_config h
                                           where h.project_system = 'pc' and h.folder_id = f.id
                                             and h.owner_id = f.owner_id and not h.attendance_enabled),
           'requestable', pr_project_open(f.id),
           'additional_works', (select count(*) from folders c where c.parent_folder_id = f.id and c.completed_at is null))
         order by (f.completed_at is not null), lower(f.name)), '[]'::jsonb)
    from folders f
    left join pr_project_settings s on s.folder_id = f.id
   where pr_is_office() and f.owner_id = data_owner_id()
     and f.parent_folder_id is null and coalesce(btrim(f.name), '') <> ''
$$;

create or replace function pr_office_set_allow_requests(p_folder uuid, p_allow boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid;
begin
  if not pr_is_office() then
    raise exception 'OFFICE_ONLY' using errcode = 'P0001';
  end if;
  select owner_id into v_owner from folders where id = p_folder and parent_folder_id is null;
  if v_owner is null or not can_access(v_owner) then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  insert into pr_project_settings (folder_id, owner_id, allow_requests, updated_by, updated_at)
  values (p_folder, v_owner, coalesce(p_allow, false), auth.uid(), now())
  on conflict (folder_id) do update
    set allow_requests = excluded.allow_requests, updated_by = excluded.updated_by, updated_at = excluded.updated_at;
  return jsonb_build_object('folder_id', p_folder, 'allow_requests', coalesce(p_allow, false));
end;
$$;

-- Dacs Web asks this BEFORE deleting a project or an Additional Works job:
-- pr_requests keeps history (no-action foreign keys), so a project with
-- requests must be completed, not deleted — and the delete path removes
-- expenses and payroll first, so it must refuse before touching anything.
create or replace function pr_folder_request_count(p_folder uuid) returns integer
language plpgsql stable security definer set search_path = public as $$
declare
  v_owner uuid;
begin
  if not pr_is_office() then
    raise exception 'OFFICE_ONLY' using errcode = 'P0001';
  end if;
  select owner_id into v_owner from folders where id = p_folder;
  if v_owner is null or not can_access(v_owner) then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  return (
    select count(*)::int from pr_requests r
     where r.folder_id = p_folder or r.work_folder_id = p_folder
        or r.folder_id in (select c.id from folders c where c.parent_folder_id = p_folder)
        or r.work_folder_id in (select c.id from folders c where c.parent_folder_id = p_folder));
end;
$$;

-- ════ §8 Who may call what ═════════════════════════════════════════════

revoke all on function pr_is_office() from public, anon, authenticated;
revoke all on function pr_request_doc(uuid, boolean) from public, anon, authenticated;

revoke all on function pr_office_queue(text) from public, anon;
grant execute on function pr_office_queue(text) to authenticated;
revoke all on function pr_office_request(uuid) from public, anon;
grant execute on function pr_office_request(uuid) to authenticated;
revoke all on function pr_office_set_arranged(uuid, boolean) from public, anon;
grant execute on function pr_office_set_arranged(uuid, boolean) to authenticated;
revoke all on function pr_office_resolve_reduction(uuid, text, text) from public, anon;
grant execute on function pr_office_resolve_reduction(uuid, text, text) to authenticated;
revoke all on function pr_office_change_quantity(uuid, numeric, text) from public, anon;
grant execute on function pr_office_change_quantity(uuid, numeric, text) to authenticated;
revoke all on function pr_office_cancel_line(uuid, text) from public, anon;
grant execute on function pr_office_cancel_line(uuid, text) to authenticated;
revoke all on function pr_office_resolve_conflict(uuid, boolean, text) from public, anon;
grant execute on function pr_office_resolve_conflict(uuid, boolean, text) to authenticated;
revoke all on function pr_office_match_item(uuid, uuid) from public, anon;
grant execute on function pr_office_match_item(uuid, uuid) to authenticated;
revoke all on function pr_office_move_portion(uuid, uuid, text) from public, anon;
grant execute on function pr_office_move_portion(uuid, uuid, text) to authenticated;
revoke all on function pr_office_batches() from public, anon;
grant execute on function pr_office_batches() to authenticated;
revoke all on function pr_office_set_batch_dates(uuid, date, date) from public, anon;
grant execute on function pr_office_set_batch_dates(uuid, date, date) to authenticated;
revoke all on function pr_office_people() from public, anon;
grant execute on function pr_office_people() to authenticated;
revoke all on function pr_office_teams() from public, anon;
grant execute on function pr_office_teams() to authenticated;
revoke all on function pr_office_save_team(uuid, text, boolean) from public, anon;
grant execute on function pr_office_save_team(uuid, text, boolean) to authenticated;
revoke all on function pr_office_add_member(uuid, uuid) from public, anon;
grant execute on function pr_office_add_member(uuid, uuid) to authenticated;
revoke all on function pr_office_remove_member(uuid, uuid) from public, anon;
grant execute on function pr_office_remove_member(uuid, uuid) to authenticated;
revoke all on function pr_office_set_leader(uuid, uuid) from public, anon;
grant execute on function pr_office_set_leader(uuid, uuid) to authenticated;
revoke all on function pr_office_catalog() from public, anon;
grant execute on function pr_office_catalog() to authenticated;
revoke all on function pr_office_save_item(uuid, text, text, text, text, text, boolean) from public, anon;
grant execute on function pr_office_save_item(uuid, text, text, text, text, text, boolean) to authenticated;
revoke all on function pr_office_projects() from public, anon;
grant execute on function pr_office_projects() to authenticated;
revoke all on function pr_office_set_allow_requests(uuid, boolean) from public, anon;
grant execute on function pr_office_set_allow_requests(uuid, boolean) to authenticated;
revoke all on function pr_folder_request_count(uuid) from public, anon;
grant execute on function pr_folder_request_count(uuid) to authenticated;
