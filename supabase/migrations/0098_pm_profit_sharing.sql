-- ════════════════════════════════════════════════════════════════════
-- 0098 — PM profit sharing (Release 1).
-- Spec: docs/superpowers/specs/2026-10-18-pm-profit-sharing-mvp-terms.md
--
-- An INTERNAL allocation of a PM project's remaining cash (paid − direct
-- cost − warranty reserve) between the owner and the project's partner.
-- Never a payout, amount owed, invoice or accounting entry.
--
-- • Three private tables. RLS on, NO policies, privileges revoked: no
--   client role reads or writes them directly. Everything goes through the
--   security-definer functions below, which check the caller's company.
-- • Main owner = role 'owner', owner_id null, active. allowed_modules is
--   NEVER read — any account can edit its own list (spec finding F5).
-- • role and owner_id are trusted because profiles_guard (BEFORE UPDATE)
--   refuses any change to them from a signed-in caller (re-verified 18 Oct).
-- Idempotent where practical.
-- ════════════════════════════════════════════════════════════════════

-- ── 1. Who is calling, and which company is theirs ────────────────────
-- Company = the main owner's account id. Owner-role or staff accounts with
-- an owner_id belong to that owner's company, but only when the target is a
-- real, active main owner. Anything else is BAD_COMPANY_LINK.
create or replace function pm_caller_company() returns uuid
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_me record; v_main record;
begin
  if auth.uid() is null then raise exception 'NOT_SIGNED_IN' using errcode = 'P0001'; end if;
  select id, role, owner_id, status into v_me from profiles where id = auth.uid();
  if not found then raise exception 'PROFILE_MISSING' using errcode = 'P0001'; end if;
  if coalesce(v_me.status, 'active') <> 'active' then raise exception 'INACTIVE' using errcode = 'P0001'; end if;
  if v_me.role is null or v_me.role not in ('owner', 'staff') then
    raise exception 'NOT_OFFICE' using errcode = 'P0001';
  end if;
  if v_me.owner_id is null then
    if v_me.role <> 'owner' then raise exception 'BAD_COMPANY_LINK' using errcode = 'P0001'; end if;
    return v_me.id;
  end if;
  select id, role, owner_id, status into v_main from profiles where id = v_me.owner_id;
  if not found or v_main.role is distinct from 'owner' or v_main.owner_id is not null
     or coalesce(v_main.status, 'active') <> 'active' then
    raise exception 'BAD_COMPANY_LINK' using errcode = 'P0001';
  end if;
  return v_main.id;
end;
$$;

-- Owner-role readers (main owner and focused owners such as admin-pm@).
create or replace function pm_owner_company() returns uuid
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_role text; v_status text;
begin
  if auth.uid() is null then raise exception 'NOT_SIGNED_IN' using errcode = 'P0001'; end if;
  select role, status into v_role, v_status from profiles where id = auth.uid();
  if not found then raise exception 'PROFILE_MISSING' using errcode = 'P0001'; end if;
  if coalesce(v_status, 'active') <> 'active' then raise exception 'INACTIVE' using errcode = 'P0001'; end if;
  if v_role is distinct from 'owner' then raise exception 'OWNER_ONLY' using errcode = 'P0001'; end if;
  return pm_caller_company();
end;
$$;

-- The one account that may change a split.
create or replace function pm_main_owner_id() returns uuid
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_role text; v_owner uuid; v_status text;
begin
  if auth.uid() is null then raise exception 'NOT_SIGNED_IN' using errcode = 'P0001'; end if;
  select role, owner_id, status into v_role, v_owner, v_status from profiles where id = auth.uid();
  if not found then raise exception 'PROFILE_MISSING' using errcode = 'P0001'; end if;
  if coalesce(v_status, 'active') <> 'active' then raise exception 'INACTIVE' using errcode = 'P0001'; end if;
  if v_role is distinct from 'owner' or v_owner is not null then
    raise exception 'OWNER_ONLY' using errcode = 'P0001';
  end if;
  return auth.uid();
end;
$$;

-- ── 2. Tables ─────────────────────────────────────────────────────────
-- Trusted project → company map. Rows come ONLY from the creation trigger
-- (source 'created') or an explicit owner-verified migration (0099,
-- source 'owner_verified'). pm_set_sharing never creates one.
create table if not exists pm_project_companies (
  project_id       uuid primary key references construction_projects(id) on delete cascade,
  company_owner_id uuid not null,
  mapped_by        uuid,
  mapped_at        timestamptz not null default now(),
  source           text not null check (source in ('owner_verified', 'created'))
);
create index if not exists pm_project_companies_company_idx on pm_project_companies(company_owner_id);

-- The current split. No row = 50/50 (computed on read, never back-filled).
create table if not exists pm_sharing_agreements (
  project_id       uuid primary key references construction_projects(id) on delete cascade,
  company_owner_id uuid not null,
  partner_pct      numeric(5,2) not null check (partner_pct >= 0 and partner_pct <= 100),
  version          int not null check (version >= 1),
  updated_by       uuid not null,
  updated_at       timestamptz not null default now()
);

-- Append-only history. project_id is a PLAIN value (no foreign key) so a
-- deleted project can neither cascade nor blank its history.
create table if not exists pm_sharing_changes (
  id                    uuid primary key default gen_random_uuid(),
  project_id            uuid not null,
  project_name_snapshot text,
  client_name_snapshot  text,
  company_owner_id      uuid not null,
  old_pct               numeric(5,2) not null,
  new_pct               numeric(5,2) not null,
  old_was_default       boolean not null,
  reason                text not null check (length(btrim(reason)) > 0),
  actor_id              uuid not null,
  actor_email           text,
  changed_at            timestamptz not null default now()
);
create index if not exists pm_sharing_changes_project_idx on pm_sharing_changes(project_id, changed_at);
create index if not exists pm_sharing_changes_company_idx on pm_sharing_changes(company_owner_id);

create or replace function pm_sharing_changes_immutable() returns trigger
language plpgsql as $$
begin
  raise exception 'HISTORY_IMMUTABLE' using errcode = 'P0001';
end;
$$;
drop trigger if exists pm_sharing_changes_immutable_trg on pm_sharing_changes;
create trigger pm_sharing_changes_immutable_trg
  before update or delete on pm_sharing_changes
  for each row execute function pm_sharing_changes_immutable();

-- ── 3. New projects map to the creator's company ──────────────────────
-- A signed-in creator with no valid company link is REJECTED (the insert
-- fails). An insert with no signed-in account (service role / SQL editor)
-- is left unmapped: sharing stays locked for it (plan decision D3).
create or replace function pm_map_new_project() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_company uuid;
begin
  if auth.uid() is null then return null; end if;
  v_company := pm_caller_company();
  insert into pm_project_companies (project_id, company_owner_id, mapped_by, source)
  values (new.id, v_company, auth.uid(), 'created');
  return null;
end;
$$;
drop trigger if exists pm_map_new_project_trg on construction_projects;
create trigger pm_map_new_project_trg
  after insert on construction_projects
  for each row execute function pm_map_new_project();

-- ── 4. Change a split — main owner only, atomically, with history ─────
-- Order matters:
--   1. main owner (profile, active, role owner, no owner_id)
--   2. LOCK THE PROJECT ROW so two first saves (no agreement row yet)
--      serialise; then lock the agreement row if it exists
--   3. project mapped to the caller's company
--   4. validate the RAW %: numeric(5,2) would round 40.123 → 40.12
--   5. optimistic version check (0 when no row)
--   6. same value → no-op, no history
--   7. reason required (also when leaving the implicit 50/50)
--   8. upsert agreement (version + 1) and insert history together
create or replace function pm_set_sharing(p_project uuid, p_partner_pct numeric,
                                          p_expected_version int, p_reason text)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_company uuid;
  v_proj    record;
  v_map     record;
  v_cur     record;
  v_has     boolean;
  v_ver     int;
  v_old     numeric;
  v_email   text;
begin
  v_company := pm_main_owner_id();

  select id, project_name, client_name into v_proj
    from construction_projects where id = p_project for update;
  if not found then raise exception 'PROJECT_NOT_FOUND' using errcode = 'P0001'; end if;

  select company_owner_id into v_map from pm_project_companies where project_id = p_project;
  if not found then raise exception 'PROJECT_UNMAPPED' using errcode = 'P0001'; end if;
  if v_map.company_owner_id is distinct from v_company then
    raise exception 'WRONG_COMPANY' using errcode = 'P0001';
  end if;

  if p_partner_pct is null or p_partner_pct = 'NaN'::numeric
     or p_partner_pct < 0 or p_partner_pct > 100
     or p_partner_pct <> round(p_partner_pct, 2) then
    raise exception 'BAD_PCT' using errcode = 'P0001';
  end if;

  select partner_pct, version into v_cur from pm_sharing_agreements where project_id = p_project for update;
  v_has := found;
  v_ver := case when v_has then v_cur.version else 0 end;
  if p_expected_version is null or p_expected_version <> v_ver then
    raise exception 'STALE' using errcode = 'P0001';
  end if;

  v_old := case when v_has then v_cur.partner_pct else 50 end;
  if p_partner_pct = v_old then
    return jsonb_build_object('changed', false, 'version', v_ver, 'partner_pct', v_old);
  end if;

  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'REASON_REQUIRED' using errcode = 'P0001';
  end if;

  insert into pm_sharing_agreements (project_id, company_owner_id, partner_pct, version, updated_by, updated_at)
  values (p_project, v_company, p_partner_pct, v_ver + 1, v_company, now())
  on conflict (project_id) do update
     set partner_pct = excluded.partner_pct, version = excluded.version,
         updated_by = excluded.updated_by, updated_at = excluded.updated_at;

  select email into v_email from profiles where id = v_company;
  insert into pm_sharing_changes (project_id, project_name_snapshot, client_name_snapshot, company_owner_id,
                                  old_pct, new_pct, old_was_default, reason, actor_id, actor_email)
  values (p_project, v_proj.project_name, v_proj.client_name, v_company,
          v_old, p_partner_pct, not v_has, btrim(p_reason), v_company, v_email);

  return jsonb_build_object('changed', true, 'version', v_ver + 1, 'partner_pct', p_partner_pct);
end;
$$;
-- ── 5. Reads (owner-role accounts of the company) ─────────────────────
create or replace function pm_sharing_read(p_projects uuid[] default null) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_company  uuid := pm_owner_company();
  v_can_edit boolean;
begin
  v_can_edit := exists (select 1 from profiles where id = auth.uid() and role = 'owner'
                          and owner_id is null and coalesce(status, 'active') = 'active');
  return jsonb_build_object(
    'can_edit', v_can_edit,
    'projects', coalesce((
      select jsonb_agg(jsonb_build_object(
               'project_id', m.project_id,
               'partner_pct', coalesce(a.partner_pct, 50),
               'is_default', a.project_id is null,
               'version', coalesce(a.version, 0)) order by m.project_id)
        from pm_project_companies m
        left join pm_sharing_agreements a on a.project_id = m.project_id
       where m.company_owner_id = v_company
         and (p_projects is null or m.project_id = any(p_projects))), '[]'::jsonb),
    'history', coalesce((
      select jsonb_agg(jsonb_build_object(
               'project_id', h.project_id, 'old_pct', h.old_pct, 'new_pct', h.new_pct,
               'old_was_default', h.old_was_default, 'reason', h.reason,
               'actor_email', h.actor_email, 'changed_at', h.changed_at,
               'project_name', h.project_name_snapshot) order by h.changed_at desc, h.id)
        from pm_sharing_changes h
       where h.company_owner_id = v_company
         and (p_projects is null or h.project_id = any(p_projects))), '[]'::jsonb),
    'partners', coalesce((
      select jsonb_agg(s.x) from (
        select distinct on (lower(pr.email)) jsonb_build_object(
                 'email', lower(pr.email),
                 'accepted', coalesce(pr.partner_agreement_accepted, false),
                 'accepted_at', pr.partner_agreement_accepted_at,
                 'doc_version', pr.partner_agreement_doc_version) as x
          from pm_project_companies m
          join construction_projects cp on cp.id = m.project_id
          join profiles pr on lower(pr.email) = lower(btrim(cp.partner_email)) and pr.role = 'partner'
         where m.company_owner_id = v_company
           and (p_projects is null or m.project_id = any(p_projects))
           and coalesce(btrim(cp.partner_email), '') <> ''
         order by lower(pr.email), pr.partner_agreement_accepted_at desc nulls last) s), '[]'::jsonb)
  );
end;
$$;

-- Recorded warranty reserves for the caller's company. warranty_retentions
-- RLS is owner_id = auth.uid(), which hides the main owner's rows from
-- admin-pm@ (plan D2). Called ONLY by WF.reserveFor in js/warranty-fund.js.
create or replace function wf_reserves_for(p_projects uuid[]) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_company uuid := pm_owner_company();
begin
  return coalesce((
    select jsonb_agg(s.x) from (
      select distinct on (w.project_id) jsonb_build_object(
               'project_id', w.project_id, 'ref_no', w.ref_no, 'status', w.status,
               'deleted', w.deleted_at is not null,
               'contributed_amount', w.contributed_amount,
               'total_paid', w.total_paid, 'direct_cost', w.direct_cost,
               'completed_at', w.completed_at) as x
        from warranty_retentions w
        join pm_project_companies m on m.project_id = w.project_id and m.company_owner_id = v_company
        join profiles wp on wp.id = w.owner_id
                        and (wp.id = v_company or (wp.role = 'owner' and wp.owner_id = v_company))
       where w.project_id = any(coalesce(p_projects, '{}'::uuid[]))
       order by w.project_id, (w.deleted_at is null) desc, w.updated_at desc nulls last, w.id) s), '[]'::jsonb);
end;
$$;

-- ── 6. Privileges ─────────────────────────────────────────────────────
alter table pm_project_companies  enable row level security;
alter table pm_sharing_agreements enable row level security;
alter table pm_sharing_changes    enable row level security;
revoke all on table pm_project_companies, pm_sharing_agreements, pm_sharing_changes
  from public, anon, authenticated;
revoke all on function pm_caller_company(), pm_owner_company(), pm_main_owner_id(),
                       pm_map_new_project(), pm_sharing_changes_immutable()
  from public, anon, authenticated;
revoke all on function pm_set_sharing(uuid, numeric, int, text), pm_sharing_read(uuid[]), wf_reserves_for(uuid[])
  from public, anon;
grant execute on function pm_set_sharing(uuid, numeric, int, text), pm_sharing_read(uuid[]), wf_reserves_for(uuid[])
  to authenticated;
