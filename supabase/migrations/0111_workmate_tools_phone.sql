-- 0111 — WorkMate Stage 3b-a: tools on the phone (server side), the Team Leader
-- switch, and the records behind a temporary password.
--
-- Answers: docs/superpowers/specs/2026-10-28-workmate-stage3-tools-questions.md
-- (all A); plan: docs/superpowers/plans/2026-11-04-workmate-stage3b-a-server-web.md.
--
-- A. A worker's own tools (tl_my_tools, tl_my_tool), and reporting a problem
--    (tl_report_problem), which changes no tool, holder or record (Q12). The
--    office sees reports and closes each with a note (tl_problems,
--    tl_close_problem).
--
-- B. A team leader acts only for the current members of the teams they lead
--    now (Q11, Q15, Q21). The server checks the team on every call, never the
--    role alone. tl_team_issue / handover / return / reverse check that, then
--    call 0107's own functions, so every existing rule applies unchanged: the
--    tool's state, one tool issued once, fill-once request lines, conditions,
--    Retire requests, the operation id. tl_actor is the one 0107 function
--    redefined: inside that checked call it answers for the leader's company,
--    and otherwise it is the office rule it always was. A client cannot set
--    that flag: PostgREST exposes no set_config, and tl_as_leader is internal.
--
-- C. A leader finds a tool to issue by its number (tl_team_find). It answers
--    only for an Available tool of this company, with its name and details,
--    and gives the same refusal for everything else, so it reveals nobody's
--    custody or history. A phone issue may name a request line the leader can
--    already see; any other line sends them to the office. No photos on the
--    phone: the tools folder stays office-only.
--
-- D. The Team Leader switch (wk_set_team_leader): main owner only, logged,
--    refused while the person leads an active team. It never joins, removes or
--    names anyone, and reads no labor contract or payroll. profiles_guard opens
--    for this function alone. A named leader who lost the role or the account
--    now counts as no leader for the office (pr_office_teams), and the office
--    can clear a leader mark on a turned-off team (pr_office_set_leader).
--
-- E. A temporary password: the Edge Function admin-set-worker-password sets it
--    and writes wk_password_events. No password is ever stored here. Building
--    this authorizes no reset: each worker's needs the owner's approval.
--    profiles gets no new column, and attendance-signin does not change: the
--    old Attendance app reads both and cannot be updated.
--
-- No money: nothing here reads or writes a peso, an expense or payroll.

set local lock_timeout = '5s';

-- ════ 1. Tables ════════════════════════════════════════════════════

-- "I don't have this" / "It's broken", from the person holding the tool (Q12).
create table if not exists tl_problems (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references profiles(id),
  tool_id uuid not null references tl_tools(id),
  kind text not null check (kind in ('dont_have', 'broken')),
  note text not null default '' check (char_length(note) <= 500),
  reported_by uuid not null references profiles(id),
  reported_at timestamptz not null default clock_timestamp(),
  closed_by uuid references profiles(id),
  closed_at timestamptz,
  close_note text not null default '' check (char_length(close_note) <= 500),
  check ((closed_at is null) = (closed_by is null))
);
create unique index if not exists tl_problems_one_open on tl_problems (tool_id, reported_by, kind) where closed_at is null;
create index if not exists tl_problems_open on tl_problems (owner_id, reported_at desc) where closed_at is null;

-- A report is never edited or deleted: the office closes it once.
create or replace function tl_problems_guard() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' or old.closed_at is not null or new.closed_at is null
     or (new.id, new.owner_id, new.tool_id, new.kind, new.note, new.reported_by, new.reported_at)
        is distinct from (old.id, old.owner_id, old.tool_id, old.kind, old.note, old.reported_by, old.reported_at) then
    raise exception 'HISTORY_IMMUTABLE' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
drop trigger if exists tl_problems_no_change on tl_problems;
create trigger tl_problems_no_change before update or delete on tl_problems
  for each row execute function tl_problems_guard();

-- Who changed whom, when, and from what to what. Append-only.
create table if not exists wk_role_events (
  id bigint generated always as identity primary key,
  owner_id uuid not null references profiles(id),
  worker_id uuid not null references profiles(id),
  from_role text not null check (from_role in ('worker', 'teamLeader')),
  to_role text not null check (to_role in ('worker', 'teamLeader')),
  actor_id uuid not null references profiles(id),
  at timestamptz not null default clock_timestamp()
);
create index if not exists wk_role_events_worker on wk_role_events (worker_id, id desc);

-- Who reset whom, and when. Never the password. Append-only.
create table if not exists wk_password_events (
  id bigint generated always as identity primary key,
  owner_id uuid not null references profiles(id),
  worker_id uuid not null references profiles(id),
  kind text not null check (kind in ('requested', 'temporary_set', 'failed', 'changed')),
  actor_id uuid not null references profiles(id),
  at timestamptz not null default clock_timestamp()
);
create index if not exists wk_password_events_worker on wk_password_events (worker_id, id desc);

drop trigger if exists wk_role_events_no_change on wk_role_events;
create trigger wk_role_events_no_change before update or delete on wk_role_events
  for each row execute function tl_history_immutable();
drop trigger if exists wk_password_events_no_change on wk_password_events;
create trigger wk_password_events_no_change before update or delete on wk_password_events
  for each row execute function tl_history_immutable();

-- Every read and write goes through the functions below: no table policy.
alter table tl_problems enable row level security;
alter table wk_role_events enable row level security;
alter table wk_password_events enable row level security;

-- ════ 2. Who may act ═══════════════════════════════════════════════

-- 0107's tl_actor, plus one opening: inside tl_as_leader, after the caller's
-- team has been checked, the leader's own company. Everyone else: the office rule.
create or replace function tl_actor() returns uuid
language plpgsql stable security definer set search_path = public as $$
declare v_owner uuid;
begin
  if current_setting('dacs.tl_leader_actor', true) = auth.uid()::text then
    v_owner := attendance_data_owner();
  else
    v_owner := pur_actor_owner('expenses_form');
  end if;
  if not tl_on(v_owner) then
    raise exception 'TOOLS_OFF' using errcode = 'P0001';
  end if;
  return v_owner;
end;
$$;

-- The caller's company, for a worker or team leader, while tools are on.
create or replace function tl_crew_owner() returns uuid
language plpgsql stable security definer set search_path = public as $$
declare v_owner uuid;
begin
  if auth.uid() is null or not pr_is_requester() then
    raise exception 'NOT_A_REQUESTER' using errcode = 'P0001';
  end if;
  v_owner := attendance_data_owner();
  if v_owner is null then
    raise exception 'NOT_A_REQUESTER' using errcode = 'P0001';
  end if;
  if not tl_on(v_owner) then
    raise exception 'TOOLS_OFF' using errcode = 'P0001';
  end if;
  return v_owner;
end;
$$;

-- The same, for someone who leads at least one active team now.
create or replace function tl_leader_owner() returns uuid
language plpgsql stable security definer set search_path = public as $$
declare v_owner uuid := tl_crew_owner();
begin
  if not exists (select 1 from pr_teams t where t.owner_id = v_owner and pr_is_current_leader(t.id, auth.uid())) then
    raise exception 'NOT_LEADER' using errcode = 'P0001';
  end if;
  return v_owner;
end;
$$;

-- Is this person a current member of a team the caller leads now? A leader is
-- a member of their own team.
create or replace function tl_i_lead(p_person uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select p_person is not null and exists (
    select 1 from pr_team_members m join pr_teams t on t.id = m.team_id
     where m.worker_id = p_person and m.removed_at is null and t.active
       and t.owner_id = attendance_data_owner()
       and pr_is_current_leader(t.id, auth.uid()))
$$;

-- Call 0107's own function as this leader. The flag lives only for that call.
create or replace function tl_as_leader(p_fn text, p_op uuid, p_body jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  perform set_config('dacs.tl_leader_actor', auth.uid()::text, true);
  v := case p_fn
         when 'issue' then tl_issue(p_op, p_body)
         when 'handover' then tl_handover(p_op, p_body)
         when 'return' then tl_return(p_op, p_body)
         when 'reverse' then tl_reverse(p_op, (p_body ->> 'record_id')::uuid, p_body ->> 'reason')
       end;
  perform set_config('dacs.tl_leader_actor', '', true);
  return v;
end;
$$;

-- ════ 3. What the phone reads: no money, purchase, note or photo ═══

create or replace function tl_phone_tool_json(p_tool uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', t.id, 'number', t.number, 'label', tl_label(t.number),
    'item_name', c.name, 'item_spec', c.spec, 'details', t.details,
    'state', t.state, 'condition', t.condition,
    'holder_id', t.holder_id, 'holder_name', case when t.holder_id is null then null else tl_person_name(t.holder_id) end,
    'folder_id', t.folder_id, 'folder_name', case when t.folder_id is null then null else tl_folder_name(t.folder_id) end,
    'since', t.since, 'days', tl_days(t.since))
  from tl_tools t join pr_catalog_items c on c.id = t.item_id
  where t.id = p_tool
$$;

-- A tool's records while this person had it, newest first (Q21).
create or replace function tl_person_records(p_tool uuid, p_person uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'kind', r.kind, 'status', r.status, 'at', r.recorded_at,
           'folder_name', case when r.folder_id is null then null else tl_folder_name(r.folder_id) end,
           'condition', r.condition, 'reversed', r.reversed_at is not null,
           'from_name', case when r.kind = 'handover' and r.before ->> 'holder_id' <> p_person::text
                             then tl_person_name((r.before ->> 'holder_id')::uuid) end,
           'to_name', case when r.kind = 'handover' and r.holder_id <> p_person
                           then tl_person_name(r.holder_id) end)
         order by r.recorded_at desc, r.id desc), '[]'::jsonb)
    from tl_records r
   where r.tool_id = p_tool
     and (r.holder_id = p_person or r.before ->> 'holder_id' = p_person::text)
$$;

create or replace function tl_my_tools() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_owner uuid := tl_crew_owner();
begin
  return (select coalesce(jsonb_agg(tl_phone_tool_json(t.id) || jsonb_build_object(
                   'my_open_problems', (select coalesce(jsonb_agg(p.kind order by p.kind), '[]'::jsonb)
                                          from tl_problems p
                                         where p.tool_id = t.id and p.reported_by = auth.uid() and p.closed_at is null))
                 order by t.number), '[]'::jsonb)
            from tl_tools t
           where t.owner_id = v_owner and t.holder_id = auth.uid() and t.state in ('issued', 'lost_pending'));
end;
$$;

-- One tool's history while the caller had it. Who has it now is shown only if
-- that is still the caller.
create or replace function tl_my_tool(p_tool uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_owner uuid := tl_crew_owner();
  t tl_tools;
  v_records jsonb;
begin
  select * into t from tl_tools where id = p_tool and owner_id = v_owner;
  v_records := tl_person_records(p_tool, auth.uid());
  if t.id is null or jsonb_array_length(v_records) = 0 then
    raise exception 'NOT_YOUR_TOOL' using errcode = 'P0001';
  end if;
  if t.holder_id = auth.uid() and t.state in ('issued', 'lost_pending') then
    return tl_phone_tool_json(p_tool) || jsonb_build_object('records', v_records);
  end if;
  return (select jsonb_build_object('id', t.id, 'number', t.number, 'label', tl_label(t.number),
                                    'item_name', c.name, 'item_spec', c.spec, 'records', v_records)
            from pr_catalog_items c where c.id = t.item_id);
end;
$$;

-- The tools of the current members of the teams the caller leads now (Q21).
create or replace function tl_team_tools() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_owner uuid := tl_leader_owner();
begin
  return (select coalesce(jsonb_agg(tl_phone_tool_json(t.id) order by t.number), '[]'::jsonb)
            from tl_tools t
           where t.owner_id = v_owner and t.state in ('issued', 'lost_pending') and tl_i_lead(t.holder_id));
end;
$$;

create or replace function tl_team_tool(p_tool uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_owner uuid := tl_leader_owner();
  t tl_tools;
begin
  select * into t from tl_tools where id = p_tool and owner_id = v_owner;
  if t.id is null or not tl_i_lead(t.holder_id) then
    raise exception 'NOT_YOUR_TEAM' using errcode = 'P0001';
  end if;
  return tl_phone_tool_json(p_tool) || jsonb_build_object('records', tl_person_records(p_tool, t.holder_id));
end;
$$;

-- The tool a leader typed the number of: Available, in this company. Every
-- other answer is the same refusal, whoever holds it or whatever it is.
create or replace function tl_team_find(p_number text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_owner uuid := tl_leader_owner();
  v_match text[] := regexp_match(coalesce(p_number, ''), '^\s*(?:tool-)?0*([0-9]{1,9})\s*$', 'i');
  v jsonb;
begin
  if v_match is not null then
    select jsonb_build_object('id', t.id, 'number', t.number, 'label', tl_label(t.number),
                              'item_name', c.name, 'item_spec', c.spec, 'details', t.details)
      into v
      from tl_tools t join pr_catalog_items c on c.id = t.item_id
     where t.owner_id = v_owner and t.number = v_match[1]::int and t.state = 'available';
  end if;
  if v is null then
    raise exception 'TOOL_NOT_AVAILABLE' using errcode = 'P0001';
  end if;
  return v;
end;
$$;

-- Who a leader may record for, and the open projects: names only.
create or replace function tl_team_choices() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_owner uuid := tl_leader_owner();
begin
  return jsonb_build_object(
    'members', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'name', tl_person_name(p.id))
                                          order by lower(tl_person_name(p.id))), '[]'::jsonb)
                  from profiles p
                 where coalesce(p.status, 'active') = 'active' and tl_i_lead(p.id)),
    'projects', (select coalesce(jsonb_agg(jsonb_build_object('folder_id', f.id, 'name', tl_folder_name(f.id),
                                                              'main', f.parent_folder_id is null)
                                           order by coalesce(par.name, f.name), f.parent_folder_id is not null, f.name), '[]'::jsonb)
                   from folders f left join folders par on par.id = f.parent_folder_id
                  where f.owner_id = v_owner and f.completed_at is null and par.completed_at is null));
end;
$$;

-- May this leader name this request line? Only what they can already see on
-- the phone (pr_my_requests): their own requests, and their teams'.
create or replace function tl_leader_sees_line(p_line uuid, p_owner uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from pr_lines l join pr_requests r on r.id = l.request_id
     where l.id = p_line and l.owner_id = p_owner
       and (r.requester_id = auth.uid()
            or (r.team_id is not null and pr_is_current_leader(r.team_id, auth.uid()))))
$$;

-- The tool request lines this tool can fill on this project, for this leader.
-- The same tests as tl_request_line, so nothing is offered that tl_issue refuses.
create or replace function tl_team_request_lines(p_tool uuid, p_folder uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_owner uuid := tl_leader_owner();
  t tl_tools;
  v_unit text;
begin
  select * into t from tl_tools where id = p_tool and owner_id = v_owner and state = 'available';
  if t.id is null then
    raise exception 'TOOL_NOT_AVAILABLE' using errcode = 'P0001';
  end if;
  select unit into v_unit from pr_catalog_items where id = t.item_id;
  return (select coalesce(jsonb_agg(jsonb_build_object(
            'line_id', x.id, 'description', x.description, 'spec', x.spec, 'unit', x.unit,
            'requester_name', pr_person_name(x.requester_id), 'still_to_fill', x.still,
            'bought_for_this_tool', x.bought_for)
          order by x.bought_for desc, x.received_at, x.position), '[]'::jsonb)
            from (select l.id, l.description, l.spec, l.unit, l.position, r.requester_id, r.received_at,
                         (select coalesce(sum(greatest(0, p.quantity - p.pending_reduction - pr_portion_bought(p.id))), 0)
                            from pr_line_portions p where p.line_id = l.id) as still,
                         tl_bought_for(t, l.id) as bought_for
                    from pr_lines l join pr_requests r on r.id = l.request_id
                   where l.owner_id = v_owner and r.work_folder_id = p_folder and l.kind = 'tool'
                     and l.status = 'open' and r.status = 'submitted'
                     and (l.catalog_item_id is null or l.catalog_item_id = t.item_id)
                     and lower(btrim(l.unit)) = lower(btrim(v_unit))
                     and tl_leader_sees_line(l.id, v_owner)) x
           where x.still > 0 or x.bought_for);
end;
$$;

-- A leader's own recent records, and which they can still reverse.
create or replace function tl_team_my_records(p_limit integer default 30) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_owner uuid := tl_leader_owner();
begin
  return (select coalesce(jsonb_agg(jsonb_build_object(
            'id', x.id, 'tool_id', x.tool_id, 'label', tl_label(x.number), 'item_name', x.item_name, 'kind', x.kind,
            'at', x.recorded_at, 'reversed', x.reversed_at is not null,
            'holder_name', case when x.holder_id is null then null else tl_person_name(x.holder_id) end,
            'folder_name', case when x.folder_id is null then null else tl_folder_name(x.folder_id) end,
            'can_reverse', x.reversed_at is null and tl_latest(x.tool_id) = x.id and tl_i_lead(x.holder_id)
                           and (x.kind <> 'handover' or tl_i_lead((x.before ->> 'holder_id')::uuid)))
          order by x.recorded_at desc, x.id desc), '[]'::jsonb)
            from (select r.id, r.tool_id, t.number, c.name as item_name, r.kind, r.recorded_at, r.reversed_at,
                         r.holder_id, r.folder_id, r.before
                    from tl_records r join tl_tools t on t.id = r.tool_id
                    join pr_catalog_items c on c.id = t.item_id
                   where r.owner_id = v_owner and r.recorded_by = auth.uid() and r.status = 'done'
                     and r.kind in ('issue', 'handover', 'return')
                   order by r.recorded_at desc, r.id desc
                   limit greatest(1, least(coalesce(p_limit, 30), 100))) x);
end;
$$;

-- ════ 4. What a leader records ═════════════════════════════════════
-- Each: a retry answers first (their own earlier answer), then the team check,
-- then 0107's own function under the same operation id. Photos are not passed.

create or replace function tl_team_issue(p_op uuid, p_body jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid := tl_crew_owner();
  v_prev jsonb;
  v_line_text text := nullif(btrim(coalesce(p_body ->> 'request_line_id', '')), '');
  v_line uuid := pur_uuid(p_body ->> 'request_line_id');
begin
  v_prev := pur_op_begin(p_op);
  if v_prev is not null then
    return v_prev;
  end if;
  if not tl_i_lead(pur_uuid(p_body ->> 'holder_id')) then
    raise exception 'NOT_YOUR_TEAM' using errcode = 'P0001';
  end if;
  if v_line_text is not null then
    if v_line is null then
      raise exception 'BAD_REQUEST_LINK' using errcode = 'P0001';
    end if;
    if not tl_leader_sees_line(v_line, v_owner) then
      raise exception 'REQUEST_NEEDS_OFFICE' using errcode = 'P0001';
    end if;
  end if;
  return tl_as_leader('issue', p_op, jsonb_build_object(
    'tool_id', p_body ->> 'tool_id', 'holder_id', p_body ->> 'holder_id', 'folder_id', p_body ->> 'folder_id',
    'request_line_id', p_body ->> 'request_line_id', 'note', p_body ->> 'note'));
end;
$$;

create or replace function tl_team_handover(p_op uuid, p_body jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid := tl_crew_owner();
  v_prev jsonb;
  t tl_tools;
begin
  v_prev := pur_op_begin(p_op);
  if v_prev is not null then
    return v_prev;
  end if;
  t := tl_tool_lock(v_owner, pur_uuid(p_body ->> 'tool_id'));
  if not tl_i_lead(t.holder_id) or not tl_i_lead(pur_uuid(p_body ->> 'holder_id')) then
    raise exception 'NOT_YOUR_TEAM' using errcode = 'P0001';
  end if;
  return tl_as_leader('handover', p_op, jsonb_build_object(
    'tool_id', p_body ->> 'tool_id', 'holder_id', p_body ->> 'holder_id', 'folder_id', p_body ->> 'folder_id',
    'note', p_body ->> 'note'));
end;
$$;

create or replace function tl_team_return(p_op uuid, p_body jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid := tl_crew_owner();
  v_prev jsonb;
  t tl_tools;
begin
  v_prev := pur_op_begin(p_op);
  if v_prev is not null then
    return v_prev;
  end if;
  t := tl_tool_lock(v_owner, pur_uuid(p_body ->> 'tool_id'));
  if not tl_i_lead(t.holder_id) then
    raise exception 'NOT_YOUR_TEAM' using errcode = 'P0001';
  end if;
  return tl_as_leader('return', p_op, jsonb_build_object(
    'tool_id', p_body ->> 'tool_id', 'condition', p_body ->> 'condition', 'note', p_body ->> 'note'));
end;
$$;

-- Their own latest issue, handover or return, with a reason (Q18), while
-- everyone in it is still in their teams. What waits for the owner is not theirs.
create or replace function tl_team_reverse(p_op uuid, p_record uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid := tl_crew_owner();
  v_prev jsonb;
  r tl_records;
begin
  v_prev := pur_op_begin(p_op);
  if v_prev is not null then
    return v_prev;
  end if;
  select * into r from tl_records where id = p_record and owner_id = v_owner;
  if r.id is null then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  if r.recorded_by <> auth.uid() then
    raise exception 'NOT_YOURS' using errcode = 'P0001';
  end if;
  if r.status <> 'done' or r.reversed_at is not null or r.kind not in ('issue', 'handover', 'return') then
    raise exception 'BAD_STATE' using errcode = 'P0001';
  end if;
  if not tl_i_lead(r.holder_id)
     or (r.kind = 'handover' and not tl_i_lead((r.before ->> 'holder_id')::uuid)) then
    raise exception 'NOT_YOUR_TEAM' using errcode = 'P0001';
  end if;
  return tl_as_leader('reverse', p_op, jsonb_build_object('record_id', p_record, 'reason', p_reason));
end;
$$;

-- ════ 5. Report a problem, and the office's view ═══════════════════

create or replace function tl_report_problem(p_op uuid, p_tool uuid, p_kind text, p_note text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid := tl_crew_owner();
  v_prev jsonb;
  t tl_tools;
  v_id uuid;
begin
  v_prev := pur_op_begin(p_op);
  if v_prev is not null then
    return v_prev;
  end if;
  if p_kind is null or p_kind not in ('dont_have', 'broken') then
    raise exception 'BAD_KIND' using errcode = 'P0001';
  end if;
  t := tl_tool_lock(v_owner, p_tool);
  if t.holder_id is distinct from auth.uid() or t.state <> 'issued' then
    raise exception 'NOT_YOUR_TOOL' using errcode = 'P0001';
  end if;
  begin
    insert into tl_problems (owner_id, tool_id, kind, note, reported_by)
    values (v_owner, t.id, p_kind, pur_note(p_note), auth.uid())
    returning id into v_id;
  exception when unique_violation then
    raise exception 'ALREADY_REPORTED' using errcode = 'P0001';
  end;
  return pur_op_done(v_owner, p_op, 'tl_report_problem', jsonb_build_object('problem_id', v_id, 'tool_id', t.id));
end;
$$;

create or replace function tl_problems(p_open_only boolean default true) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_owner uuid := tl_reader();
begin
  return (select coalesce(jsonb_agg(jsonb_build_object(
            'id', p.id, 'tool_id', p.tool_id, 'label', tl_label(t.number), 'item_name', c.name,
            'kind', p.kind, 'note', p.note, 'reported_by_name', tl_person_name(p.reported_by), 'reported_at', p.reported_at,
            'state', t.state,
            'holder_name', case when t.holder_id is null then null else tl_person_name(t.holder_id) end,
            'folder_name', case when t.folder_id is null then null else tl_folder_name(t.folder_id) end,
            'closed_at', p.closed_at, 'close_note', p.close_note,
            'closed_by_name', case when p.closed_by is null then null else pur_person_name(p.closed_by) end)
          order by p.closed_at is not null, p.reported_at desc), '[]'::jsonb)
            from tl_problems p join tl_tools t on t.id = p.tool_id join pr_catalog_items c on c.id = t.item_id
           where p.owner_id = v_owner and (not coalesce(p_open_only, true) or p.closed_at is null));
end;
$$;

create or replace function tl_close_problem(p_op uuid, p_problem uuid, p_note text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid := tl_actor();
  v_prev jsonb;
  v_note text := pur_reason(p_note);
  p tl_problems;
begin
  v_prev := pur_op_begin(p_op);
  if v_prev is not null then
    return v_prev;
  end if;
  select * into p from tl_problems where id = p_problem and owner_id = v_owner for update;
  if p.id is null then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  if p.closed_at is not null then
    raise exception 'ALREADY_CLOSED' using errcode = 'P0001';
  end if;
  update tl_problems set closed_by = auth.uid(), closed_at = clock_timestamp(), close_note = v_note where id = p.id;
  return pur_op_done(v_owner, p_op, 'tl_close_problem', jsonb_build_object('problem_id', p.id));
end;
$$;

-- ════ 6. The Team Leader switch ════════════════════════════════════

-- 0019's guard, unchanged but for one opening: wk_set_team_leader's own change
-- of a worker to or from Team Leader, by the main owner, flagged inside that
-- function. Direct updates and the Users form stay refused.
create or replace function profiles_guard()
returns trigger language plpgsql as $$
begin
  if auth.uid() is not null then
    if new.role is distinct from old.role or new.owner_id is distinct from old.owner_id then
      if new.owner_id is not distinct from old.owner_id
         and coalesce(old.role, '') in ('worker', 'teamLeader') and coalesce(new.role, '') in ('worker', 'teamLeader')
         and old.id <> auth.uid()
         and current_setting('dacs.wk_role_change', true) = auth.uid()::text
         and exists (select 1 from profiles me where me.id = auth.uid() and me.role = 'owner' and me.owner_id is null
                       and coalesce(me.status, 'active') = 'active') then
        return new;
      end if;
      if not (is_owner() or is_staff()) then
        raise exception 'not allowed to change role/owner_id';
      end if;
      if old.id = auth.uid() then
        raise exception 'not allowed to change your own role';
      end if;
      if new.owner_id is distinct from old.owner_id then
        raise exception 'not allowed to change owner_id';
      end if;
      if coalesce(old.role, 'client') not in ('client', 'partner')
         or coalesce(new.role, 'client') not in ('client', 'partner') then
        raise exception 'role may only be changed between client and partner';
      end if;
    end if;
  end if;
  return new;
end $$;

-- Is the caller the main owner? For showing the buttons; the server decides.
create or replace function wk_me() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('is_main_owner', coalesce((
    select p.role = 'owner' and p.owner_id is null and coalesce(p.status, 'active') = 'active'
      from profiles p where p.id = auth.uid()), false))
$$;

create or replace function wk_set_team_leader(p_worker uuid, p_on boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid := pm_main_owner_id();
  p profiles;
  v_to text;
  v_teams text;
begin
  if p_on is null then
    raise exception 'BAD_SWITCH' using errcode = 'P0001';
  end if;
  select * into p from profiles where id = p_worker and owner_id = v_owner and role in ('worker', 'teamLeader') for update;
  if p.id is null then
    raise exception 'NOT_A_WORKER' using errcode = 'P0001';
  end if;
  v_to := case when p_on then 'teamLeader' else 'worker' end;
  if p.role = v_to then
    return jsonb_build_object('worker_id', p.id, 'role', p.role, 'changed', false);
  end if;
  if p_on and coalesce(p.status, 'active') <> 'active' then
    raise exception 'ACCOUNT_INACTIVE' using errcode = 'P0001';
  end if;
  if not p_on then
    select string_agg(t.name, ', ' order by lower(t.name)) into v_teams
      from pr_team_members m join pr_teams t on t.id = m.team_id
     where m.worker_id = p.id and m.is_leader and m.removed_at is null and t.active;
    if v_teams is not null then
      raise exception 'LEADS_A_TEAM' using errcode = 'P0001', detail = v_teams;
    end if;
    -- A mark left on a turned-off team must not come back with the team.
    update pr_team_members set is_leader = false where worker_id = p.id and is_leader and removed_at is null;
  end if;
  perform set_config('dacs.wk_role_change', auth.uid()::text, true);
  update profiles set role = v_to where id = p.id;
  perform set_config('dacs.wk_role_change', '', true);
  insert into wk_role_events (owner_id, worker_id, from_role, to_role, actor_id)
  values (v_owner, p.id, p.role, v_to, auth.uid());
  return jsonb_build_object('worker_id', p.id, 'role', v_to, 'changed', true);
end;
$$;

-- 0086's list, plus why a named leader cannot lead: a mark without the role or
-- with a switched-off account gives no powers (pr_is_current_leader), so the
-- office must not read it as a leader.
create or replace function pr_office_teams() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', t.id, 'name', t.name, 'active', t.active,
           'members', (select coalesce(jsonb_agg(jsonb_build_object(
                                'worker_id', m.worker_id, 'name', pr_person_name(m.worker_id), 'role', p.role,
                                'is_leader', m.is_leader, 'added_at', m.added_at,
                                'leader_problem', case when not m.is_leader then null
                                                       when p.role is distinct from 'teamLeader' then 'no_role'
                                                       when coalesce(p.status, 'active') <> 'active' then 'inactive' end)
                              order by m.is_leader desc, lower(pr_person_name(m.worker_id))), '[]'::jsonb)
                         from pr_team_members m join profiles p on p.id = m.worker_id
                        where m.team_id = t.id and m.removed_at is null))
         order by t.active desc, lower(t.name)), '[]'::jsonb)
    from pr_teams t
   where pr_is_office() and t.owner_id = data_owner_id()
$$;

-- 0086's function, with two changes: the office can CLEAR a mark on a turned-off
-- team (naming a leader still needs an active team), and the role is read under
-- a lock so it cannot pass while the switch is turning it off.
create or replace function pr_office_set_leader(p_team uuid, p_worker uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid;
  v_active boolean;
begin
  if not pr_is_office() then
    raise exception 'OFFICE_ONLY' using errcode = 'P0001';
  end if;
  select owner_id, active into v_owner, v_active from pr_teams where id = p_team;
  if v_owner is null or not can_access(v_owner) or (p_worker is not null and not v_active) then
    raise exception 'BAD_TEAM' using errcode = 'P0001';
  end if;
  if p_worker is not null then
    if not exists (select 1 from pr_team_members m where m.team_id = p_team and m.worker_id = p_worker and m.removed_at is null) then
      raise exception 'NOT_IN_TEAM' using errcode = 'P0001';
    end if;
    perform 1 from profiles p where p.id = p_worker for share;
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

-- ════ 7. A temporary password's records ════════════════════════════
-- The Edge Function writes 'requested', 'temporary_set' and 'failed' with the
-- service role. The worker's phone reads and clears "must change" here.

create or replace function wk_password_state() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('must_change', coalesce((
    select e.kind = 'temporary_set' from wk_password_events e
     where e.worker_id = auth.uid() and e.kind in ('temporary_set', 'changed')
     order by e.id desc limit 1), false))
$$;

create or replace function wk_password_changed() returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_owner uuid;
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'P0001';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('wk_password:' || auth.uid(), 0));
  if not (wk_password_state() ->> 'must_change')::boolean then
    return jsonb_build_object('recorded', false);
  end if;
  select coalesce(owner_id, id) into v_owner from profiles where id = auth.uid();
  insert into wk_password_events (owner_id, worker_id, kind, actor_id) values (v_owner, auth.uid(), 'changed', auth.uid());
  return jsonb_build_object('recorded', true);
end;
$$;

-- The main owner's view of one worker's role and password changes.
create or replace function wk_worker_log(p_worker uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_owner uuid := pm_main_owner_id();
begin
  return (select coalesce(jsonb_agg(jsonb_build_object('kind', x.kind, 'detail', x.detail, 'at', x.at, 'by_name', pur_person_name(x.actor_id))
                                    order by x.at desc), '[]'::jsonb)
            from (select 'role' as kind, e.from_role || ' → ' || e.to_role as detail, e.at, e.actor_id
                    from wk_role_events e where e.worker_id = p_worker and e.owner_id = v_owner
                  union all
                  select 'password', e.kind, e.at, e.actor_id
                    from wk_password_events e where e.worker_id = p_worker and e.owner_id = v_owner) x);
end;
$$;

-- ════ 8. Who may call what ═════════════════════════════════════════

revoke all on function tl_my_tools() from public, anon;
grant execute on function tl_my_tools() to authenticated;
revoke all on function tl_my_tool(uuid) from public, anon;
grant execute on function tl_my_tool(uuid) to authenticated;
revoke all on function tl_team_tools() from public, anon;
grant execute on function tl_team_tools() to authenticated;
revoke all on function tl_team_tool(uuid) from public, anon;
grant execute on function tl_team_tool(uuid) to authenticated;
revoke all on function tl_team_find(text) from public, anon;
grant execute on function tl_team_find(text) to authenticated;
revoke all on function tl_team_choices() from public, anon;
grant execute on function tl_team_choices() to authenticated;
revoke all on function tl_team_request_lines(uuid, uuid) from public, anon;
grant execute on function tl_team_request_lines(uuid, uuid) to authenticated;
revoke all on function tl_team_my_records(integer) from public, anon;
grant execute on function tl_team_my_records(integer) to authenticated;
revoke all on function tl_team_issue(uuid, jsonb) from public, anon;
grant execute on function tl_team_issue(uuid, jsonb) to authenticated;
revoke all on function tl_team_handover(uuid, jsonb) from public, anon;
grant execute on function tl_team_handover(uuid, jsonb) to authenticated;
revoke all on function tl_team_return(uuid, jsonb) from public, anon;
grant execute on function tl_team_return(uuid, jsonb) to authenticated;
revoke all on function tl_team_reverse(uuid, uuid, text) from public, anon;
grant execute on function tl_team_reverse(uuid, uuid, text) to authenticated;
revoke all on function tl_report_problem(uuid, uuid, text, text) from public, anon;
grant execute on function tl_report_problem(uuid, uuid, text, text) to authenticated;
revoke all on function tl_problems(boolean) from public, anon;
grant execute on function tl_problems(boolean) to authenticated;
revoke all on function tl_close_problem(uuid, uuid, text) from public, anon;
grant execute on function tl_close_problem(uuid, uuid, text) to authenticated;
revoke all on function wk_me() from public, anon;
grant execute on function wk_me() to authenticated;
revoke all on function wk_set_team_leader(uuid, boolean) from public, anon;
grant execute on function wk_set_team_leader(uuid, boolean) to authenticated;
revoke all on function wk_worker_log(uuid) from public, anon;
grant execute on function wk_worker_log(uuid) to authenticated;
revoke all on function wk_password_state() from public, anon;
grant execute on function wk_password_state() to authenticated;
revoke all on function wk_password_changed() from public, anon;
grant execute on function wk_password_changed() to authenticated;
-- (create or replace keeps a function's permissions; restated so they can never drift.)
revoke all on function pr_office_teams() from public, anon;
grant execute on function pr_office_teams() to authenticated;
revoke all on function pr_office_set_leader(uuid, uuid) from public, anon;
grant execute on function pr_office_set_leader(uuid, uuid) to authenticated;

-- Internal helpers: only the functions above call them.
revoke all on function tl_actor() from public, anon, authenticated;
revoke all on function tl_crew_owner() from public, anon, authenticated;
revoke all on function tl_leader_owner() from public, anon, authenticated;
revoke all on function tl_i_lead(uuid) from public, anon, authenticated;
revoke all on function tl_as_leader(text, uuid, jsonb) from public, anon, authenticated;
revoke all on function tl_leader_sees_line(uuid, uuid) from public, anon, authenticated;
revoke all on function tl_phone_tool_json(uuid) from public, anon, authenticated;
revoke all on function tl_person_records(uuid, uuid) from public, anon, authenticated;
revoke all on function tl_problems_guard() from public, anon, authenticated;
