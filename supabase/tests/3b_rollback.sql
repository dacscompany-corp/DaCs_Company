-- ═══════════════════════════════════════
-- Stage 3b-a rollback. Run only if 0111 must be undone on live.
-- Restores, exactly as they were, the four functions 0111 redefined:
--   tl_actor (0107), profiles_guard (0019), pr_office_teams and
--   pr_office_set_leader (0086).
-- After this no leader can record tools and the Team Leader switch is refused
-- by the guard. Nothing is deleted: the tables, their rows and the new functions
-- stay, unused. Any role already changed stays changed, and any password already
-- set stays set.
-- ═══════════════════════════════════════

create or replace function tl_actor() returns uuid
language plpgsql stable security definer set search_path = public as $$
declare v_owner uuid := pur_actor_owner('expenses_form');
begin
  if not tl_on(v_owner) then
    raise exception 'TOOLS_OFF' using errcode = 'P0001';
  end if;
  return v_owner;
end;
$$;

create or replace function profiles_guard()
returns trigger language plpgsql as $$
begin
  if auth.uid() is not null then
    if new.role is distinct from old.role or new.owner_id is distinct from old.owner_id then
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

revoke all on function pr_office_teams() from public, anon;
grant execute on function pr_office_teams() to authenticated;
revoke all on function pr_office_set_leader(uuid, uuid) from public, anon;
grant execute on function pr_office_set_leader(uuid, uuid) to authenticated;
revoke all on function tl_actor() from public, anon, authenticated;
