-- 0088 — WorkMate Requests: a worker's cancels line up with the office's.
--
-- ── WHY. Found while planning the Stage 1a pilot (2026-10-06):
--    1. pr_cancel_line (0085) left a request 'submitted' after the worker
--       cancelled its last open line, while the office cancel (0086
--       pr_office_cancel_line) closes it. The phone then showed "Received" on
--       a request with nothing left, and Dacs Web disagreed with the phone.
--    2. Cancelling something already cancelled raised LINE_CLOSED. A cancel
--       queued offline that reaches the server after the office (or the
--       worker's own last-line cancel) closed the request then showed as
--       Failed on the phone, though the worker got exactly what they asked.
--
-- ── WHAT.
--    • pr_cancel_line: when no open line is left, the request is cancelled
--      too (request_cancelled event, detail.by = 'worker'), like the office.
--    • pr_cancel_line on a line already cancelled, and pr_cancel_request on a
--      request already cancelled, answer success and change nothing (no
--      event); the op is still recorded, so a retry gets the same answer.
--    • Same checks, errors and result keys as before; pr_cancel_line adds
--      'request_closed'.
--    • All three request-first cancels (pr_cancel_line, pr_cancel_request,
--      pr_office_cancel_line) lock the request FOR NO KEY UPDATE: they still
--      wait for each other, but no longer block the KEY SHARE lock a
--      line-first RPC (quantity changes, office line actions) takes on the
--      request when it records an event, so neither side can deadlock.
--
-- ── SAFE. CREATE OR REPLACE keeps the grants. No table, policy or data
--    changes; pr_office_cancel_line keeps 0086's behaviour exactly.

create or replace function pr_cancel_line(p_op uuid, p_line uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_prev jsonb;
  v_result jsonb;
  v_closed boolean := false;
  l record;
begin
  if v_uid is null or not pr_is_requester() then
    raise exception 'NOT_A_REQUESTER' using errcode = 'P0001';
  end if;
  if p_op is null or p_line is null then
    raise exception 'BAD_OPERATION' using errcode = 'P0001';
  end if;

  perform pg_advisory_xact_lock(hashtext('pr_op:' || v_uid::text || ':' || p_op::text));
  select o.result into v_prev from pr_ops o where o.actor_id = v_uid and o.op_id = p_op;
  if found then
    return v_prev;
  end if;

  -- Request first, then line: the order of pr_cancel_request and
  -- pr_office_cancel_line. NO KEY UPDATE still serialises the cancels, but
  -- does not block the KEY SHARE lock a line-first RPC takes on the request
  -- when it records a pr_events row, so the two cannot deadlock.
  perform 1 from pr_requests r where r.id = (select x.request_id from pr_lines x where x.id = p_line) for no key update;
  select ln.id, ln.owner_id, ln.request_id, ln.status, ln.version, r.requester_id, r.status as request_status
    into l
    from pr_lines ln join pr_requests r on r.id = ln.request_id
   where ln.id = p_line
     for update of ln;
  if not found or l.requester_id <> v_uid then
    raise exception 'NOT_YOUR_LINE' using errcode = 'P0001';
  end if;

  if l.status = 'cancelled' then
    -- Already what the worker asked for (the office, or an earlier cancel).
    v_result := jsonb_build_object('status', 'cancelled', 'version', l.version,
                                   'request_closed', l.request_status = 'cancelled');
  else
    if l.request_status <> 'submitted' then
      raise exception 'LINE_CLOSED' using errcode = 'P0001';
    end if;
    perform pr_apply_quantity(p_line, 0, l.owner_id);
    update pr_lines set status = 'cancelled', version = version + 1 where id = p_line;
    insert into pr_events (owner_id, request_id, line_id, actor_id, kind, detail)
    values (l.owner_id, l.request_id, p_line, v_uid, 'line_cancelled', '{}'::jsonb);

    if not exists (select 1 from pr_lines x where x.request_id = l.request_id and x.status = 'open') then
      update pr_requests set status = 'cancelled', cancelled_at = now() where id = l.request_id and status = 'submitted';
      insert into pr_events (owner_id, request_id, line_id, actor_id, kind, detail)
      values (l.owner_id, l.request_id, null, v_uid, 'request_cancelled', jsonb_build_object('by', 'worker'));
      v_closed := true;
    end if;
    v_result := jsonb_build_object('status', 'cancelled', 'version', l.version + 1, 'request_closed', v_closed);
  end if;

  insert into pr_ops (op_id, actor_id, kind, result) values (p_op, v_uid, 'cancel_line', v_result);
  return v_result;
end;
$$;

create or replace function pr_cancel_request(p_op uuid, p_request uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_prev jsonb;
  v_result jsonb;
  v_count int := 0;
  r record;
  ln record;
begin
  if v_uid is null or not pr_is_requester() then
    raise exception 'NOT_A_REQUESTER' using errcode = 'P0001';
  end if;
  if p_op is null or p_request is null then
    raise exception 'BAD_OPERATION' using errcode = 'P0001';
  end if;

  perform pg_advisory_xact_lock(hashtext('pr_op:' || v_uid::text || ':' || p_op::text));
  select o.result into v_prev from pr_ops o where o.actor_id = v_uid and o.op_id = p_op;
  if found then
    return v_prev;
  end if;

  select id, owner_id, requester_id, status into r from pr_requests where id = p_request for no key update;
  if not found or r.requester_id <> v_uid then
    raise exception 'NOT_YOUR_REQUEST' using errcode = 'P0001';
  end if;

  if r.status = 'cancelled' then
    -- Already what the worker asked for: nothing to change, no event.
    v_result := jsonb_build_object('status', 'cancelled', 'lines', 0);
  else
    for ln in select id from pr_lines where request_id = p_request and status = 'open' order by position for update loop
      perform pr_apply_quantity(ln.id, 0, r.owner_id);
      update pr_lines set status = 'cancelled', version = version + 1 where id = ln.id;
      v_count := v_count + 1;
    end loop;
    update pr_requests set status = 'cancelled', cancelled_at = now() where id = p_request;
    insert into pr_events (owner_id, request_id, actor_id, kind, detail)
    values (r.owner_id, p_request, v_uid, 'request_cancelled', jsonb_build_object('lines', v_count));
    v_result := jsonb_build_object('status', 'cancelled', 'lines', v_count);
  end if;

  insert into pr_ops (op_id, actor_id, kind, result) values (p_op, v_uid, 'cancel_request', v_result);
  return v_result;
end;
$$;

-- Same lock change for the office cancel (0086): request lock FOR NO KEY UPDATE; nothing else changes.
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
  perform 1 from pr_requests r where r.id = (select x.request_id from pr_lines x where x.id = p_line) for no key update;
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
