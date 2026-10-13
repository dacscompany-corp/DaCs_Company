-- 0094 — WorkMate Stage 1c-2: the office Work Plan server changes.
--
-- Three changes, all outside the money model (no money anywhere):
--
-- ── 1. Only ACTIVE office accounts pass the office check. pr_is_office()
--    (0086) looked only at the role, so a deactivated owner or staff account
--    still passed every office RPC that calls it (Requests, Item History,
--    Work Plan). It now also requires profiles.status = 'active' (null
--    counts as active, as everywhere). NOT covered here (recorded
--    follow-up): the role-only storage helpers pr_office_gallery_path_ok
--    (0090) and wp_office_task_path_ok (0093) and the 0085 direct-read
--    policies still check the role only.
--
-- ── 2. A team leader's own proposals. wp_my_proposals() lists the
--    caller's proposals with Sent (still an office draft), Published,
--    Declined (cancelled before publishing) or Cancelled (after
--    publishing) and the office's reason. Spec §15 "Leader's own
--    proposals" (13 October 2026). Never office-only fields, never another
--    person's proposals.
--
-- ── 3. Automatic task versions. wp_office_save_task (0093) raised the
--    version only when the office ticked "important". Spec §6: important
--    changes to instructions, assignments or dates need everyone to read
--    the task again; minor spelling corrections do not. Now, on a published
--    task, a change of the responsible person, helpers, team or planned
--    dates ALWAYS raises the version; a change of title or instructions
--    raises it unless the office marks it minor_text_only — a mark that
--    never covers people, team or dates. Acknowledgements are per version,
--    so earlier ones stay as history and no longer count. 0093 is not
--    edited; only this function is replaced.

set local lock_timeout = '5s';

-- ════ 1. Active office accounts only ═════════════════════════════════

create or replace function pr_is_office() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((is_owner() or is_staff())
                  and exists (select 1 from profiles p
                               where p.id = auth.uid() and coalesce(p.status, 'active') = 'active'), false)
$$;

-- Internal, as in 0086: only SECURITY DEFINER office functions call it.
-- (create or replace keeps its permissions; restated so it can never drift.)
revoke all on function pr_is_office() from public, anon, authenticated;

-- ════ 2. A leader's own proposals ════════════════════════════════════

create index if not exists wp_tasks_proposed_by on wp_tasks (proposed_by) where proposed_by is not null;

create or replace function wp_my_proposals() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null or not pr_is_requester() then
    raise exception 'NOT_A_REQUESTER' using errcode = 'P0001';
  end if;
  return (select coalesce(jsonb_agg(jsonb_build_object(
                   'id', t.id, 'title', t.title, 'project_name', f.name,
                   'work_name', case when t.work_folder_id = t.folder_id then 'Main Contract' else w.name end,
                   'proposed_at', t.created_at,
                   'status', case when t.status = 'draft' then 'sent'
                                  when t.status = 'cancelled' and t.published_at is null then 'declined'
                                  when t.status = 'cancelled' then 'cancelled'
                                  else 'published' end,
                   'reason', case when t.status = 'cancelled' then
                               (select e.note from wp_events e
                                 where e.task_id = t.id and e.kind = 'cancelled' order by e.id desc limit 1) end,
                   'decided_at', case when t.status = 'draft' then null
                                      when t.status = 'cancelled' then
                                        (select max(e.created_at) from wp_events e where e.task_id = t.id and e.kind = 'cancelled')
                                      else t.published_at end)
                   order by t.created_at desc), '[]'::jsonb)
            from wp_tasks t
            join folders f on f.id = t.folder_id
            join folders w on w.id = t.work_folder_id
           where t.proposed_by = auth.uid()
             and t.owner_id = attendance_data_owner()
             and t.created_at > now() - interval '90 days');
end;
$$;

revoke all on function wp_my_proposals() from public, anon;
grant execute on function wp_my_proposals() to authenticated;

-- ════ 3. Task save with automatic versions ═══════════════════════════

create or replace function wp_office_save_task(p_task uuid, p_data jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_owner uuid := data_owner_id();
  v_new boolean := p_task is null;
  t wp_tasks;
  v_id uuid;
  v_meeting uuid;
  v_folder uuid;
  v_work uuid;
  v_team uuid;
  v_resp uuid;
  v_start date;
  v_end date;
  v_helpers uuid[];
  v_deps uuid[];
  v_one uuid;
  v_title text;
  v_instructions text;
  v_flags jsonb;
  v_important boolean;
  v_minor boolean;
  v_revised boolean;
  v_text boolean := false;
  v_changes text[] := '{}';
  v_old_resp uuid;
  v_old_helpers uuid[];
  v_note text;
begin
  if not pr_is_office() then
    raise exception 'OFFICE_ONLY' using errcode = 'P0001';
  end if;
  if p_data is null or jsonb_typeof(p_data) <> 'object' then
    raise exception 'BAD_OPERATION' using errcode = 'P0001';
  end if;
  v_flags := coalesce(p_data -> 'office_flags', '[]'::jsonb);
  if jsonb_typeof(v_flags) <> 'array' then
    raise exception 'BAD_OPERATION' using errcode = 'P0001';
  end if;
  begin
    v_meeting := nullif(p_data ->> 'meeting_id', '')::uuid;
    v_folder := nullif(p_data ->> 'folder_id', '')::uuid;
    v_work := coalesce(nullif(p_data ->> 'work_id', '')::uuid, v_folder);
    v_team := nullif(p_data ->> 'team_id', '')::uuid;
    v_resp := nullif(p_data ->> 'responsible_id', '')::uuid;
    v_start := nullif(p_data ->> 'planned_start', '')::date;
    v_end := nullif(p_data ->> 'planned_end', '')::date;
    v_helpers := array(select distinct x::uuid from jsonb_array_elements_text(coalesce(p_data -> 'helper_ids', '[]'::jsonb)) x);
    v_deps := array(select distinct x::uuid from jsonb_array_elements_text(coalesce(p_data -> 'depends_on', '[]'::jsonb)) x);
    v_important := coalesce((p_data ->> 'important')::boolean, false);
    v_minor := coalesce((p_data ->> 'minor_text_only')::boolean, false);
  exception when others then
    raise exception 'BAD_OPERATION' using errcode = 'P0001';
  end;
  v_title := btrim(coalesce(p_data ->> 'title', ''));
  v_instructions := coalesce(p_data ->> 'instructions', '');
  if v_title = '' then
    raise exception 'TITLE_REQUIRED' using errcode = 'P0001';
  end if;
  if v_start is not null and v_end is not null and v_end < v_start then
    raise exception 'BAD_DATES' using errcode = 'P0001';
  end if;

  if not v_new then
    select * into t from wp_tasks where id = p_task and owner_id = v_owner for no key update;
    if not found then
      raise exception 'NOT_FOUND' using errcode = 'P0001';
    end if;
    if t.status in ('completed', 'cancelled') then
      raise exception 'TASK_CLOSED' using errcode = 'P0001';
    end if;
    if t.status <> 'draft' and (v_folder is distinct from t.folder_id or v_work is distinct from t.work_folder_id) then
      raise exception 'BAD_DESTINATION' using errcode = 'P0001';
    end if;
    if v_folder is distinct from t.folder_id then
      -- Same per-project key the dependency path uses, old and new project
      -- in a fixed order, so a concurrent link to this task cannot slip in.
      foreach v_one in array (select array_agg(f order by f) from unnest(array[t.folder_id, v_folder]) f where f is not null) loop
        perform pg_advisory_xact_lock(hashtext('wp_deps:' || v_one::text));
      end loop;
      if exists (select 1 from wp_dependencies x join wp_tasks d on d.id = x.task_id
                  where x.depends_on = t.id and d.status <> 'cancelled') then
        raise exception 'BAD_DEPENDENCY' using errcode = 'P0001';
      end if;
    end if;
  end if;
  if (v_new or t.status = 'draft') and (v_folder is null or not wp_work_valid(v_owner, v_folder, v_work)) then
    raise exception 'BAD_DESTINATION' using errcode = 'P0001';
  end if;
  if v_meeting is not null and not exists (select 1 from wp_meetings m where m.id = v_meeting and m.owner_id = v_owner) then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_team is not null and not exists (select 1 from pr_teams tm where tm.id = v_team and tm.owner_id = v_owner and tm.active) then
    raise exception 'BAD_TEAM' using errcode = 'P0001';
  end if;
  if v_resp is not null and (not wp_person_ok(v_resp, v_owner)
                              or (v_team is not null and not pr_is_current_member(v_team, v_resp))) then
    raise exception 'BAD_PERSON' using errcode = 'P0001';
  end if;
  foreach v_one in array v_helpers loop
    if v_one = v_resp or not wp_person_ok(v_one, v_owner)
       or (v_team is not null and not pr_is_current_member(v_team, v_one)) then
      raise exception 'BAD_PERSON' using errcode = 'P0001';
    end if;
  end loop;
  if not v_new and t.status <> 'draft' and v_resp is null then
    raise exception 'NO_RESPONSIBLE' using errcode = 'P0001';
  end if;

  if v_new then
    insert into wp_tasks (owner_id, meeting_id, folder_id, work_folder_id, team_id, title, instructions,
                          planned_start, planned_end, source_passage, office_flags, created_by)
    values (v_owner, v_meeting, v_folder, v_work, v_team, v_title, v_instructions,
            v_start, v_end, coalesce(p_data ->> 'source_passage', ''), v_flags, v_uid)
    returning id into v_id;
    perform wp_log(v_owner, v_id, v_meeting, 'drafted', '', '{}'::jsonb);
  else
    v_id := t.id;
    v_note := btrim(coalesce(p_data ->> 'change_note', ''));
    if t.status <> 'draft' then
      -- What changed since the version people read (spec §6). People, team
      -- and dates always need a new reading; wording does unless minor.
      select p.person_id into v_old_resp from wp_task_people p
       where p.task_id = t.id and p.role = 'responsible' and p.removed_at is null;
      v_old_helpers := array(select p.person_id from wp_task_people p
                              where p.task_id = t.id and p.role = 'helper' and p.removed_at is null);
      v_text := v_title is distinct from t.title or v_instructions is distinct from t.instructions;
      if v_resp is distinct from v_old_resp or not (v_helpers @> v_old_helpers and v_old_helpers @> v_helpers) then
        v_changes := v_changes || 'people'::text;
      end if;
      if v_team is distinct from t.team_id then
        v_changes := v_changes || 'team'::text;
      end if;
      if v_start is distinct from t.planned_start or v_end is distinct from t.planned_end then
        v_changes := v_changes || 'planned dates'::text;
      end if;
    end if;
    v_revised := t.status <> 'draft'
                 and (v_important or cardinality(v_changes) > 0 or (v_text and not v_minor));
    if v_revised and v_text then
      v_changes := array['instructions'::text] || v_changes;
    end if;
    if v_revised then
      v_note := case when cardinality(v_changes) > 0 then 'Changed: ' || array_to_string(v_changes, ', ')
                     else 'Important change' end
                || case when v_note <> '' then ' — ' || v_note else '' end;
    elsif t.status <> 'draft' and v_text then
      v_note := 'Minor spelling correction' || case when v_note <> '' then ' — ' || v_note else '' end;
    end if;
    update wp_tasks
       set meeting_id = v_meeting, folder_id = v_folder, work_folder_id = v_work, team_id = v_team, title = v_title,
           instructions = v_instructions, planned_start = v_start, planned_end = v_end,
           source_passage = coalesce(p_data ->> 'source_passage', ''), office_flags = v_flags,
           version = case when v_revised then t.version + 1 else t.version end,
           version_at = case when v_revised then now() else t.version_at end,
           updated_at = now()
     where id = v_id;
    perform wp_log(v_owner, v_id, v_meeting, case when v_revised then 'revised' else 'edited' end,
                   v_note, jsonb_build_object('changes', to_jsonb(v_changes)));
  end if;

  -- People: end rows no longer wanted, add new ones; history is kept.
  update wp_task_people
     set removed_at = now()
   where task_id = v_id and removed_at is null
     and not ((role = 'responsible' and person_id is not distinct from v_resp)
              or (role = 'helper' and person_id = any (v_helpers)));
  if v_resp is not null then
    insert into wp_task_people (owner_id, task_id, person_id, role)
    select v_owner, v_id, v_resp, 'responsible'
     where not exists (select 1 from wp_task_people p
                        where p.task_id = v_id and p.person_id = v_resp and p.role = 'responsible' and p.removed_at is null);
  end if;
  insert into wp_task_people (owner_id, task_id, person_id, role)
  select v_owner, v_id, h, 'helper'
    from unnest(v_helpers) h
   where not exists (select 1 from wp_task_people p
                      where p.task_id = v_id and p.person_id = h and p.role = 'helper' and p.removed_at is null);

  -- Dependencies: same project, no cycles. One project at a time, so two
  -- staff linking A→B and B→A at once cannot both succeed.
  perform pg_advisory_xact_lock(hashtext('wp_deps:' || v_folder::text));
  foreach v_one in array v_deps loop
    if not exists (select 1 from wp_tasks d
                    where d.id = v_one and d.owner_id = v_owner and d.folder_id = v_folder and d.status <> 'cancelled') then
      raise exception 'BAD_DEPENDENCY' using errcode = 'P0001';
    end if;
    if v_one = v_id or wp_depends_on(v_one, v_id) then
      raise exception 'DEPENDENCY_CYCLE' using errcode = 'P0001';
    end if;
  end loop;
  delete from wp_dependencies where task_id = v_id and not (depends_on = any (v_deps));
  insert into wp_dependencies (owner_id, task_id, depends_on)
  select v_owner, v_id, d from unnest(v_deps) d
  on conflict do nothing;

  return jsonb_build_object('task', wp_task_doc(v_id, v_uid, true));
end;
$$;

revoke all on function wp_office_save_task(uuid, jsonb) from public, anon;
grant execute on function wp_office_save_task(uuid, jsonb) to authenticated;
