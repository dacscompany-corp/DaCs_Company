-- 0106 — WorkMate Stage 2B-b: stock on the phone.
--
-- Spec: docs/superpowers/specs/2026-09-30-workmate-mobile-purchasing-design.md
-- (§3.8); answers: docs/superpowers/specs/2026-10-24-workmate-stage2bc-questions.md
-- (all A); plan: docs/superpowers/plans/2026-10-27-workmate-stage2b-b-phone.md.
--
-- A. "From stock" on the workers' requests (Q26). Workers and team leaders
--    see, on their own requests in WorkMate, how much the office issued from
--    stock for each line ("From stock: 6 bags") — and nothing else of stock:
--    no place, lot, record, value or cost (Q26, Q28). 0085's pr_my_requests,
--    unchanged but for two keys: `from_stock` on each line and on each
--    weekly portion (0104's pr_line_from_stock / pr_portion_from_stock; 0 while
--    stock is off).
--
-- B. Settling a stock submission whose answer was lost (R101–R103). The
--    phone sends each stock record once under its own operation id, saved
--    with its exact payload. When the answer is lost it may only send that
--    again, unchanged, or ask the server to SETTLE the id before the person
--    may change or drop it:
--      pur_op_cancel(id) — under the operation's own lock (the one every
--        write takes first, pur_op_begin), it either finds the operation
--        recorded and says so, changing nothing, or marks the id cancelled
--        for good. A recording still running holds that lock, so the cancel
--        waits for it and then sees it.
--      pur_op_begin — 0096's, copied, refusing a cancelled id (OP_CANCELLED):
--        a request that arrives after the cancel, however late, records
--        nothing. Every other answer is unchanged.
--      pur_op_state(id) — read only: recorded / cancelled / none.
--    The cancel mark is a pur_ops row of kind 'cancelled' for that account
--    and id. Only the phone's stock submissions are ever cancelled.
--
-- No table or column changes. Buyer and office stock screens need no other
-- server change: the phone calls 0104/0105's stk_* functions as the web does.

set local lock_timeout = '5s';

-- A. 0085's pr_my_requests, with `from_stock` per line and per portion.
create or replace function pr_my_requests(p_limit int default 50) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(x.doc order by x.received_at desc), '[]'::jsonb)
  from (
    select r.received_at,
           jsonb_build_object(
             'id', r.id, 'status', r.status, 'received_at', r.received_at, 'drafted_at', r.drafted_at, 'note', r.note,
             'mine', r.requester_id = auth.uid(),
             'requester_name', pr_person_name(r.requester_id),
             'project_id', r.folder_id, 'project_name', f.name,
             'work_id', r.work_folder_id,
             'work_name', case when r.work_folder_id = r.folder_id then 'Main Contract' else w.name end,
             'team_id', r.team_id, 'team_name', t.name,
             'lines', (
               select coalesce(jsonb_agg(jsonb_build_object(
                        'id', l.id, 'position', l.position, 'kind', l.kind, 'catalog_item_id', l.catalog_item_id,
                        'description', l.description, 'spec', l.spec, 'unit', l.unit, 'category', l.category,
                        'intended_member_id', l.intended_member_id,
                        'intended_member_name', case when l.intended_member_id is null then null else pr_person_name(l.intended_member_id) end,
                        'urgent', l.urgent, 'urgent_reason', l.urgent_reason, 'needed_by', l.needed_by, 'notes', l.notes,
                        'status', l.status, 'version', l.version, 'has_conflict', l.has_conflict,
                        'needed', (select coalesce(sum(p.quantity - p.pending_reduction), 0) from pr_line_portions p where p.line_id = l.id),
                        -- 2B-b (Q26): what the office issued from stock for this line (0 while stock is off).
                        'from_stock', pr_line_from_stock(l.id),
                        'portions', (
                          select coalesce(jsonb_agg(jsonb_build_object(
                                   'quantity', p.quantity, 'pending_reduction', p.pending_reduction,
                                   'arranged', p.arranged_at is not null,
                                   'from_stock', pr_portion_from_stock(p.id),
                                   'cutoff_at', b.cutoff_at, 'purchase_on', b.purchase_on, 'delivery_on', b.delivery_on)
                                 order by b.cutoff_at, p.created_at), '[]'::jsonb)
                            from pr_line_portions p join pr_batches b on b.id = p.batch_id
                           where p.line_id = l.id))
                      order by l.position), '[]'::jsonb)
                 from pr_lines l where l.request_id = r.id),
             'photos', (
               select coalesce(jsonb_agg(jsonb_build_object('id', ph.id, 'line_id', ph.line_id, 'path', ph.storage_path)
                                order by ph.created_at), '[]'::jsonb)
                 from pr_photos ph where ph.request_id = r.id)
           ) as doc
      from pr_requests r
      join folders f on f.id = r.folder_id
      join folders w on w.id = r.work_folder_id
      left join pr_teams t on t.id = r.team_id
     where pr_is_requester()
       and r.owner_id = attendance_data_owner()
       and (r.requester_id = auth.uid()
            or (r.team_id is not null and pr_is_current_leader(r.team_id, auth.uid())))
     order by r.received_at desc
     limit greatest(1, least(coalesce(p_limit, 50), 200))
  ) x
$$;

-- (create or replace keeps a function's permissions; restated so they can never drift.)
revoke all on function pr_my_requests(integer) from public, anon;
grant execute on function pr_my_requests(integer) to authenticated;

-- B. 0096's pur_op_begin, refusing a cancelled operation id.
create or replace function pur_op_begin(p_op uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_prev jsonb;
  v_kind text;
begin
  if p_op is null then
    raise exception 'BAD_OP' using errcode = 'P0001';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('pur_op:' || auth.uid() || ':' || p_op, 0));
  select o.result, o.kind into v_prev, v_kind from pur_ops o where o.actor_id = auth.uid() and o.op_id = p_op;
  if v_prev is null then
    return null;
  end if;
  -- 2B-b (R102): an id the phone cancelled (pur_op_cancel) is never
  -- recorded — not even by its own first request arriving late.
  if v_kind = 'cancelled' then
    raise exception 'OP_CANCELLED' using errcode = 'P0001';
  end if;
  -- Marked, so the caller can tell the user that a form edited before the
  -- retry was NOT saved — this is the first press's answer.
  return v_prev || jsonb_build_object('replayed', true);
end;
$$;

revoke all on function pur_op_begin(uuid) from public, anon, authenticated;

-- The phone's "Cancel it": the server confirms the operation was recorded, or
-- cancels its id for good — atomically, under the lock recording takes.
create or replace function pur_op_cancel(p_op uuid) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid := data_owner_id();
  v_kind text;
begin
  if auth.uid() is null or v_owner is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'P0001';
  end if;
  if p_op is null then
    raise exception 'BAD_OP' using errcode = 'P0001';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('pur_op:' || auth.uid() || ':' || p_op, 0));
  select o.kind into v_kind from pur_ops o where o.actor_id = auth.uid() and o.op_id = p_op;
  if v_kind = 'cancelled' then
    return 'cancelled';
  elsif v_kind is not null then
    return 'recorded';
  end if;
  insert into pur_ops (owner_id, op_id, actor_id, kind, result)
  values (v_owner, p_op, auth.uid(), 'cancelled', jsonb_build_object('cancelled', true));
  return 'cancelled';
end;
$$;

-- The phone's "Check": read only, the caller's own operation id.
create or replace function pur_op_state(p_op uuid) returns text
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'P0001';
  end if;
  return coalesce((select case when o.kind = 'cancelled' then 'cancelled' else 'recorded' end
                     from pur_ops o where o.actor_id = auth.uid() and o.op_id = p_op), 'none');
end;
$$;

revoke all on function pur_op_cancel(uuid) from public, anon;
grant execute on function pur_op_cancel(uuid) to authenticated;
revoke all on function pur_op_state(uuid) from public, anon;
grant execute on function pur_op_state(uuid) to authenticated;
