-- 0085 — WorkMate Requests, Stage 1a-1: the server for material/tool requests.
--
-- ── WHAT. Workers and team leaders request materials and tools from DAC'S
--    WorkMate; admin/staff process them in Dacs Web (plan 1a-2). This file
--    adds the data, the rules and the worker RPCs. Spec:
--    docs/superpowers/specs/2026-09-29-unified-worker-app-design.md §4A/§4B/§4E.
--
-- ── WORKERS NEVER TOUCH pr_* TABLES DIRECTLY. RLS is on everywhere and no
--    pr_* policy grants a worker anything: every worker read/write is a
--    SECURITY DEFINER RPC that checks the destination, the team and the
--    owner on the server. Hiding a button in the app is not a permission.
--
-- ── NO MONEY. No pr_* column holds a price, amount or cost (spec §2:
--    workers and leaders never see procurement amounts). Purchasing and
--    costs arrive with Stage 2/4 in their own tables.
--
-- ── RETRY-SAFE. Every worker write carries a client-made operation id; the
--    first result is stored in pr_ops and returned verbatim on retry, so an
--    offline phone re-sending never doubles a request or re-batches it.
--
-- ── PROJECT CONTROL ONLY. Destinations are folders: Main Contract = the
--    project folder, Additional Works = a child folder. PM is never one.
--
-- Outside the money model: nothing here feeds Spent / Earned / Profit.

-- ════ §1 Who may request ═══════════════════════════════════════════════

create or replace function pr_is_requester() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles p
     where p.id = auth.uid()
       and p.role in ('worker', 'teamLeader')
       and coalesce(p.status, 'active') = 'active')
$$;

-- "Juan dela Cruz", or "W-0042" when no name was entered. Never an email or
-- phone number: colleagues' contact details are not shared (spec §4G).
create or replace function pr_person_name(p_id uuid) returns text
language sql stable security definer set search_path = public as $$
  select coalesce(nullif(btrim(p.display_name), ''),
                  case when p.worker_no is null then null else 'W-' || lpad(p.worker_no::text, 4, '0') end,
                  'Worker')
    from profiles p where p.id = p_id
$$;

-- ════ §2 Teams ═════════════════════════════════════════════════════════

create table if not exists pr_teams (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references profiles(id),
  name text not null check (btrim(name) <> ''),
  active boolean not null default true,
  created_by uuid references profiles(id) default auth.uid(),
  created_at timestamptz not null default now()
);
create unique index if not exists pr_teams_owner_name on pr_teams (owner_id, lower(btrim(name))) where active;
alter table pr_teams enable row level security;

-- Membership history is kept: removing someone sets removed_at, so an old
-- request still shows who was on the team when it was made.
create table if not exists pr_team_members (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references profiles(id),
  team_id uuid not null references pr_teams(id),
  worker_id uuid not null references profiles(id),
  is_leader boolean not null default false,
  added_at timestamptz not null default now(),
  removed_at timestamptz,
  check (removed_at is null or removed_at >= added_at)
);
create unique index if not exists pr_team_members_current on pr_team_members (team_id, worker_id) where removed_at is null;
create unique index if not exists pr_team_one_leader on pr_team_members (team_id) where is_leader and removed_at is null;
alter table pr_team_members enable row level security;

create or replace function pr_is_current_member(p_team uuid, p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from pr_team_members m join pr_teams t on t.id = m.team_id
     where m.team_id = p_team and m.worker_id = p_user
       and m.removed_at is null and t.active)
$$;

-- Acting for a team needs BOTH the teamLeader role and the current leader
-- assignment to THAT team (spec §3). The role alone grants nothing.
create or replace function pr_is_current_leader(p_team uuid, p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
      from pr_team_members m
      join pr_teams t on t.id = m.team_id
      join profiles p on p.id = m.worker_id
     where m.team_id = p_team and m.worker_id = p_user
       and m.is_leader and m.removed_at is null and t.active
       and p.role = 'teamLeader' and coalesce(p.status, 'active') = 'active')
$$;

-- ════ §3 The item catalogue ════════════════════════════════════════════

-- One row = one defined item: "PVC pipe | 1/2 in, 3 m | piece". Different
-- sizes or units are different rows; the same identity cannot be added twice.
create table if not exists pr_catalog_items (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references profiles(id),
  kind text not null check (kind in ('material', 'tool')),
  name text not null check (btrim(name) <> ''),
  spec text not null default '',
  unit text not null check (btrim(unit) <> ''),
  category text not null default '',
  active boolean not null default true,
  created_by uuid references profiles(id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists pr_catalog_identity
  on pr_catalog_items (owner_id, kind, lower(btrim(name)), lower(btrim(spec)), lower(btrim(unit))) where active;
alter table pr_catalog_items enable row level security;

-- ════ §4 Which projects accept requests ════════════════════════════════

-- "Allow requests": admin/staff open an upcoming Project Control project to
-- requests before it has a geofence or Time In (spec §3). Separate from the
-- Attendance "Hide from workers" switch on purpose.
create table if not exists pr_project_settings (
  folder_id uuid primary key references folders(id) on delete cascade,
  owner_id uuid not null references profiles(id),
  allow_requests boolean not null default false,
  updated_by uuid references profiles(id) default auth.uid(),
  updated_at timestamptz not null default now()
);
alter table pr_project_settings enable row level security;

-- A top-level Project Control project the caller's company may request for
-- now: named, not completed, and either explicitly allowed (Allow requests,
-- which also opens an upcoming site with no geofence) or on today's
-- Attendance picker list: geofence rule met AND not hidden from Time In.
-- A site hidden from Time In is NOT requestable unless Allow requests is on.
create or replace function pr_project_open(p_folder uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from folders f
     where f.id = p_folder
       and f.owner_id = attendance_data_owner()
       and f.parent_folder_id is null
       and f.completed_at is null
       and coalesce(btrim(f.name), '') <> ''
       and (
         exists (select 1 from pr_project_settings s where s.folder_id = f.id and s.allow_requests)
         or (
           (not coalesce((select a.require_geofence from attendance_config a where a.owner_id = f.owner_id), false)
            or exists (select 1 from attendance_project_geofence g
                        where g.project_system = 'pc' and g.folder_id = f.id and g.owner_id = f.owner_id and g.enabled))
           and not exists (select 1 from attendance_project_config h
                            where h.project_system = 'pc' and h.folder_id = f.id and h.owner_id = f.owner_id and not h.attendance_enabled))))
$$;

-- The work a request is for: the project itself (Main Contract) or one of
-- its own open Additional Works children. Both records are checked: an open
-- child never rescues a completed parent, and vice versa (spec §3).
create or replace function pr_work_open(p_folder uuid, p_work uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select pr_project_open(p_folder)
     and (p_work = p_folder
          or exists (select 1 from folders c
                      where c.id = p_work and c.parent_folder_id = p_folder
                        and c.completed_at is null and coalesce(btrim(c.name), '') <> ''))
$$;

-- ════ §5 Weekly batches ════════════════════════════════════════════════

-- One row per weekly cutoff. Admin/staff may move purchase_on / delivery_on
-- (holidays, supplier delays); workers see the updated dates.
create table if not exists pr_batches (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references profiles(id),
  cutoff_at timestamptz not null,
  purchase_on date not null,
  delivery_on date not null,
  updated_by uuid references profiles(id),
  updated_at timestamptz not null default now(),
  unique (owner_id, cutoff_at)
);
alter table pr_batches enable row level security;

-- The first Saturday 12:00 noon (Asia/Manila) strictly AFTER p_at. A request
-- received at exactly 12:00 Saturday has missed that week's cutoff.
create or replace function pr_cutoff_after(p_at timestamptz) returns timestamptz
language sql stable set search_path = public as $$
  with l as (select (p_at at time zone 'Asia/Manila') as t),
       c as (select t, (t::date + ((6 - extract(isodow from t)::int + 7) % 7)) + time '12:00' as cand from l)
  select (case when cand > t then cand else cand + interval '7 days' end) at time zone 'Asia/Manila' from c
$$;

-- The batch for something received at p_at, created on first use with the
-- default Monday purchasing / Wednesday delivery.
create or replace function pr_batch_for(p_owner uuid, p_at timestamptz) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_cut timestamptz := pr_cutoff_after(p_at);
  v_day date := (pr_cutoff_after(p_at) at time zone 'Asia/Manila')::date;  -- the Saturday
  v_id uuid;
begin
  insert into pr_batches (owner_id, cutoff_at, purchase_on, delivery_on)
  values (p_owner, v_cut, v_day + 2, v_day + 4)
  on conflict (owner_id, cutoff_at) do nothing;
  select id into v_id from pr_batches where owner_id = p_owner and cutoff_at = v_cut;
  return v_id;
end;
$$;

-- ════ Setup-table policies: owner/staff read, insert, update; workers have none ═══
-- Separate per-command policies, not FOR ALL: tests/storage-access.test.js bans
-- "for all" policies in later migrations. Rows are deactivated, never deleted.

drop policy if exists pr_teams_admin on pr_teams;
drop policy if exists pr_teams_admin_read on pr_teams;
create policy pr_teams_admin_read on pr_teams for select to authenticated using ((is_owner() or is_staff()) and can_access(owner_id));
drop policy if exists pr_teams_admin_insert on pr_teams;
create policy pr_teams_admin_insert on pr_teams for insert to authenticated with check ((is_owner() or is_staff()) and can_access(owner_id));
drop policy if exists pr_teams_admin_update on pr_teams;
create policy pr_teams_admin_update on pr_teams for update to authenticated using ((is_owner() or is_staff()) and can_access(owner_id)) with check ((is_owner() or is_staff()) and can_access(owner_id));
drop policy if exists pr_team_members_admin on pr_team_members;
drop policy if exists pr_team_members_admin_read on pr_team_members;
create policy pr_team_members_admin_read on pr_team_members for select to authenticated using ((is_owner() or is_staff()) and can_access(owner_id));
drop policy if exists pr_team_members_admin_insert on pr_team_members;
create policy pr_team_members_admin_insert on pr_team_members for insert to authenticated with check ((is_owner() or is_staff()) and can_access(owner_id));
drop policy if exists pr_team_members_admin_update on pr_team_members;
create policy pr_team_members_admin_update on pr_team_members for update to authenticated using ((is_owner() or is_staff()) and can_access(owner_id)) with check ((is_owner() or is_staff()) and can_access(owner_id));
drop policy if exists pr_catalog_items_admin on pr_catalog_items;
drop policy if exists pr_catalog_items_admin_read on pr_catalog_items;
create policy pr_catalog_items_admin_read on pr_catalog_items for select to authenticated using ((is_owner() or is_staff()) and can_access(owner_id));
drop policy if exists pr_catalog_items_admin_insert on pr_catalog_items;
create policy pr_catalog_items_admin_insert on pr_catalog_items for insert to authenticated with check ((is_owner() or is_staff()) and can_access(owner_id));
drop policy if exists pr_catalog_items_admin_update on pr_catalog_items;
create policy pr_catalog_items_admin_update on pr_catalog_items for update to authenticated using ((is_owner() or is_staff()) and can_access(owner_id)) with check ((is_owner() or is_staff()) and can_access(owner_id));
drop policy if exists pr_project_settings_admin on pr_project_settings;
drop policy if exists pr_project_settings_admin_read on pr_project_settings;
create policy pr_project_settings_admin_read on pr_project_settings for select to authenticated using ((is_owner() or is_staff()) and can_access(owner_id));
drop policy if exists pr_project_settings_admin_insert on pr_project_settings;
create policy pr_project_settings_admin_insert on pr_project_settings for insert to authenticated with check ((is_owner() or is_staff()) and can_access(owner_id));
drop policy if exists pr_project_settings_admin_update on pr_project_settings;
create policy pr_project_settings_admin_update on pr_project_settings for update to authenticated using ((is_owner() or is_staff()) and can_access(owner_id)) with check ((is_owner() or is_staff()) and can_access(owner_id));
drop policy if exists pr_batches_admin on pr_batches;
drop policy if exists pr_batches_admin_read on pr_batches;
create policy pr_batches_admin_read on pr_batches for select to authenticated using ((is_owner() or is_staff()) and can_access(owner_id));
drop policy if exists pr_batches_admin_insert on pr_batches;
create policy pr_batches_admin_insert on pr_batches for insert to authenticated with check ((is_owner() or is_staff()) and can_access(owner_id));
drop policy if exists pr_batches_admin_update on pr_batches;
create policy pr_batches_admin_update on pr_batches for update to authenticated using ((is_owner() or is_staff()) and can_access(owner_id)) with check ((is_owner() or is_staff()) and can_access(owner_id));

-- ════ §6 Requests, lines, portions, history ═══════════════════════════

-- One request = one destination (project + Main Contract or one Additional
-- Works job) and at most one team. Items are its lines.
create table if not exists pr_requests (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references profiles(id),
  requester_id uuid not null references profiles(id),
  team_id uuid references pr_teams(id),
  folder_id uuid not null references folders(id),
  work_folder_id uuid not null references folders(id),
  client_op_id uuid not null,
  drafted_at timestamptz,
  received_at timestamptz not null default now(),
  note text not null default '',
  status text not null default 'submitted' check (status in ('submitted', 'cancelled')),
  cancelled_at timestamptz,
  unique (requester_id, client_op_id)
);
create index if not exists pr_requests_owner_received on pr_requests (owner_id, received_at desc);
create index if not exists pr_requests_team on pr_requests (team_id) where team_id is not null;
alter table pr_requests enable row level security;

-- A line keeps its id forever (never delete-and-reinsert, spec §10). Its
-- quantity lives in pr_line_portions; `version` rises on every change and
-- is how an offline edit made against an old version is caught.
create table if not exists pr_lines (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references profiles(id),
  request_id uuid not null references pr_requests(id),
  position int not null check (position >= 0),
  kind text not null check (kind in ('material', 'tool')),
  catalog_item_id uuid references pr_catalog_items(id),
  description text not null check (btrim(description) <> ''),
  spec text not null default '',
  unit text not null check (btrim(unit) <> ''),
  category text not null default '',
  intended_member_id uuid references profiles(id),
  urgent boolean not null default false,
  urgent_reason text,
  needed_by date,
  notes text not null default '',
  status text not null default 'open' check (status in ('open', 'cancelled')),
  version int not null default 1,
  has_conflict boolean not null default false,
  created_at timestamptz not null default now(),
  check (not urgent or (btrim(coalesce(urgent_reason, '')) <> '' and needed_by is not null)),
  unique (request_id, position)
);
create index if not exists pr_lines_request on pr_lines (request_id);
alter table pr_lines enable row level security;

-- A line's quantity, split by weekly batch. Arranged quantity (the office
-- has arranged it for purchase, plan 1a-2) is never shrunk by a worker:
-- a reduction that reaches it is recorded as pending_reduction for the
-- office to act on. Still needed = sum(quantity - pending_reduction).
create table if not exists pr_line_portions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references profiles(id),
  line_id uuid not null references pr_lines(id),
  batch_id uuid not null references pr_batches(id),
  quantity numeric(12,3) not null check (quantity > 0),
  arranged_at timestamptz,
  arranged_by uuid references profiles(id),
  pending_reduction numeric(12,3) not null default 0 check (pending_reduction >= 0 and pending_reduction <= quantity),
  created_at timestamptz not null default now()
);
create index if not exists pr_line_portions_line on pr_line_portions (line_id);
create index if not exists pr_line_portions_batch on pr_line_portions (batch_id);
alter table pr_line_portions enable row level security;

-- An edit made against an outdated version. Both values are kept; the
-- office resolves it (plan 1a-2). Nothing is silently overwritten.
create table if not exists pr_line_conflicts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references profiles(id),
  line_id uuid not null references pr_lines(id),
  proposed_by uuid not null references profiles(id),
  base_version int not null,
  current_version int not null,
  proposed_quantity numeric(12,3) not null check (proposed_quantity >= 0),
  current_quantity numeric(12,3) not null,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references profiles(id),
  resolution text
);
create index if not exists pr_line_conflicts_open on pr_line_conflicts (line_id) where resolved_at is null;
alter table pr_line_conflicts enable row level security;

-- Who changed what, when (spec §4B). Append-only: no update/delete path.
create table if not exists pr_events (
  id bigserial primary key,
  owner_id uuid not null references profiles(id),
  request_id uuid not null references pr_requests(id),
  line_id uuid references pr_lines(id),
  actor_id uuid not null references profiles(id),
  kind text not null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists pr_events_request on pr_events (request_id, created_at);
alter table pr_events enable row level security;

-- The first answer to each client operation, returned verbatim on retry.
create table if not exists pr_ops (
  op_id uuid not null,
  actor_id uuid not null references profiles(id),
  kind text not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key (actor_id, op_id)
);
alter table pr_ops enable row level security;

-- Private request photos (bucket request-photos, §10). Never the gallery.
create table if not exists pr_photos (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references profiles(id),
  request_id uuid not null references pr_requests(id),
  line_id uuid references pr_lines(id),
  storage_path text not null unique,
  uploaded_by uuid not null references profiles(id),
  created_at timestamptz not null default now()
);
create index if not exists pr_photos_request on pr_photos (request_id);
alter table pr_photos enable row level security;

-- The office reads request data; every change goes through an RPC.
drop policy if exists pr_requests_office_read on pr_requests;
create policy pr_requests_office_read on pr_requests for select to authenticated using ((is_owner() or is_staff()) and can_access(owner_id));
drop policy if exists pr_lines_office_read on pr_lines;
create policy pr_lines_office_read on pr_lines for select to authenticated using ((is_owner() or is_staff()) and can_access(owner_id));
drop policy if exists pr_line_portions_office_read on pr_line_portions;
create policy pr_line_portions_office_read on pr_line_portions for select to authenticated using ((is_owner() or is_staff()) and can_access(owner_id));
drop policy if exists pr_line_conflicts_office_read on pr_line_conflicts;
create policy pr_line_conflicts_office_read on pr_line_conflicts for select to authenticated using ((is_owner() or is_staff()) and can_access(owner_id));
drop policy if exists pr_events_office_read on pr_events;
create policy pr_events_office_read on pr_events for select to authenticated using ((is_owner() or is_staff()) and can_access(owner_id));
drop policy if exists pr_ops_office_read on pr_ops;
create policy pr_ops_office_read on pr_ops for select to authenticated
  using ((is_owner() or is_staff()) and can_access((select coalesce(p.owner_id, p.id) from profiles p where p.id = pr_ops.actor_id)));
drop policy if exists pr_photos_office_read on pr_photos;
create policy pr_photos_office_read on pr_photos for select to authenticated using ((is_owner() or is_staff()) and can_access(owner_id));

-- ════ §7 What a worker may choose from ════════════════════════════════

-- Projects open to requests, each with its Main Contract and its own open
-- Additional Works jobs. Request-only projects appear here and never in the
-- Time In picker (that list is attendance_projects_for_worker, unchanged).
create or replace function pr_destinations()
returns table (project_id uuid, project_name text, work_id uuid, work_name text, is_main boolean)
language sql stable security definer set search_path = public as $$
  select f.id, f.name, f.id, 'Main Contract'::text, true
    from folders f
   where pr_is_requester() and pr_project_open(f.id)
  union all
  select f.id, f.name, c.id, c.name, false
    from folders f
    join folders c on c.parent_folder_id = f.id
   where pr_is_requester() and pr_project_open(f.id)
     and c.completed_at is null and coalesce(btrim(c.name), '') <> ''
  order by 2, 5 desc, 4
$$;

-- The caller's current teams, whether they lead each, and its current
-- members (names only — never contact details).
create or replace function pr_my_teams()
returns table (team_id uuid, team_name text, i_lead boolean, members jsonb)
language sql stable security definer set search_path = public as $$
  select t.id, t.name, pr_is_current_leader(t.id, auth.uid()),
         (select coalesce(jsonb_agg(jsonb_build_object('id', m2.worker_id, 'name', pr_person_name(m2.worker_id))
                                    order by pr_person_name(m2.worker_id)), '[]'::jsonb)
            from pr_team_members m2
           where m2.team_id = t.id and m2.removed_at is null)
    from pr_teams t
    join pr_team_members m on m.team_id = t.id
   where pr_is_requester()
     and t.active and t.owner_id = attendance_data_owner()
     and m.worker_id = auth.uid() and m.removed_at is null
   order by t.name
$$;

-- The official item list. Workers pick from it, or describe a missing item.
create or replace function pr_catalog()
returns table (id uuid, kind text, name text, spec text, unit text, category text)
language sql stable security definer set search_path = public as $$
  select c.id, c.kind, c.name, c.spec, c.unit, c.category
    from pr_catalog_items c
   where pr_is_requester() and c.active and c.owner_id = attendance_data_owner()
   order by c.kind, lower(c.name), lower(c.spec)
$$;

-- ════ §8 Submitting a request ═════════════════════════════════════════

-- One call per request, retry-safe. The batch is chosen by the SERVER's
-- received time (spec §4A): a draft made Friday but first received Saturday
-- 12:00 joins next week. A retried p_op returns the first answer and writes
-- nothing. Every rule is checked here, whatever the app showed.
create or replace function pr_submit_request(p_op uuid, p_request jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_now timestamptz := now();
  v_prev jsonb;
  v_owner uuid;
  v_folder uuid;
  v_work uuid;
  v_team uuid;
  v_batch uuid;
  v_req uuid;
  v_line jsonb;
  v_line_id uuid;
  v_pos int := 0;
  v_kind text;
  v_qty numeric;
  v_urgent boolean;
  v_item uuid;
  v_member uuid;
  v_needed_by date;
  v_drafted timestamptz;
  v_result jsonb;
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

  v_owner := attendance_data_owner();

  begin
    v_folder := (p_request ->> 'folder_id')::uuid;
    v_work := coalesce(nullif(p_request ->> 'work_id', '')::uuid, v_folder);
  exception when invalid_text_representation then
    raise exception 'DESTINATION_CLOSED' using errcode = 'P0001';
  end;
  if v_folder is null or not pr_work_open(v_folder, v_work) then
    raise exception 'DESTINATION_CLOSED' using errcode = 'P0001';
  end if;

  begin
    v_team := nullif(p_request ->> 'team_id', '')::uuid;
  exception when invalid_text_representation then
    raise exception 'NOT_IN_TEAM' using errcode = 'P0001';
  end;
  if v_team is not null and not (
       pr_is_current_member(v_team, v_uid)
       and exists (select 1 from pr_teams t where t.id = v_team and t.owner_id = v_owner)) then
    raise exception 'NOT_IN_TEAM' using errcode = 'P0001';
  end if;

  if jsonb_typeof(p_request -> 'lines') is distinct from 'array' or jsonb_array_length(p_request -> 'lines') = 0 then
    raise exception 'NO_LINES' using errcode = 'P0001';
  end if;
  if jsonb_array_length(p_request -> 'lines') > 100 then
    raise exception 'TOO_MANY_LINES' using errcode = 'P0001';
  end if;

  begin
    v_drafted := nullif(p_request ->> 'drafted_at', '')::timestamptz;
  exception when others then
    v_drafted := null;  -- the phone's draft time is information only; never fail a request on it
  end;

  v_batch := pr_batch_for(v_owner, v_now);

  insert into pr_requests (owner_id, requester_id, team_id, folder_id, work_folder_id, client_op_id, drafted_at, received_at, note)
  values (v_owner, v_uid, v_team, v_folder, v_work, p_op, v_drafted, v_now, coalesce(p_request ->> 'note', ''))
  returning id into v_req;

  for v_line in select value from jsonb_array_elements(p_request -> 'lines') loop
    v_kind := v_line ->> 'kind';
    if v_kind is null or v_kind not in ('material', 'tool')
       or coalesce(btrim(v_line ->> 'description'), '') = ''
       or coalesce(btrim(v_line ->> 'unit'), '') = '' then
      raise exception 'BAD_LINE' using errcode = 'P0001';
    end if;

    begin
      v_qty := (v_line ->> 'quantity')::numeric;
    exception when others then
      v_qty := null;
    end;
    if v_qty is null or v_qty <= 0 or v_qty > 1000000 or v_qty <> round(v_qty, 3) then
      raise exception 'BAD_QUANTITY' using errcode = 'P0001';
    end if;

    begin
      v_urgent := coalesce((v_line ->> 'urgent')::boolean, false);
      v_needed_by := nullif(v_line ->> 'needed_by', '')::date;
      v_item := nullif(v_line ->> 'catalog_item_id', '')::uuid;
      v_member := case when v_kind = 'material' then nullif(v_line ->> 'intended_member_id', '')::uuid end;
    exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow then
      raise exception 'BAD_LINE' using errcode = 'P0001';
    end;

    if v_urgent and (coalesce(btrim(v_line ->> 'urgent_reason'), '') = '' or v_needed_by is null) then
      raise exception 'URGENT_NEEDS_REASON' using errcode = 'P0001';
    end if;
    if v_item is not null and not exists (
         select 1 from pr_catalog_items c
          where c.id = v_item and c.owner_id = v_owner and c.active and c.kind = v_kind) then
      raise exception 'BAD_CATALOG_ITEM' using errcode = 'P0001';
    end if;
    -- "Optional intended member from the request's team" (spec §4A). Naming
    -- someone other than yourself is acting for the team: leader only.
    if v_member is not null then
      if v_team is null or not pr_is_current_member(v_team, v_member) then
        raise exception 'BAD_MEMBER' using errcode = 'P0001';
      end if;
      if v_member <> v_uid and not pr_is_current_leader(v_team, v_uid) then
        raise exception 'NOT_TEAM_LEADER' using errcode = 'P0001';
      end if;
    end if;

    insert into pr_lines (owner_id, request_id, position, kind, catalog_item_id, description, spec, unit, category,
                          intended_member_id, urgent, urgent_reason, needed_by, notes)
    values (v_owner, v_req, v_pos, v_kind, v_item, btrim(v_line ->> 'description'), coalesce(btrim(v_line ->> 'spec'), ''),
            btrim(v_line ->> 'unit'), coalesce(btrim(v_line ->> 'category'), ''), v_member, v_urgent,
            case when v_urgent then btrim(v_line ->> 'urgent_reason') end, v_needed_by, coalesce(v_line ->> 'notes', ''))
    returning id into v_line_id;

    insert into pr_line_portions (owner_id, line_id, batch_id, quantity) values (v_owner, v_line_id, v_batch, v_qty);
    v_pos := v_pos + 1;
  end loop;

  insert into pr_events (owner_id, request_id, actor_id, kind, detail)
  values (v_owner, v_req, v_uid, 'submitted', jsonb_build_object('lines', v_pos, 'batch_id', v_batch));

  select jsonb_build_object(
           'request_id', v_req, 'received_at', v_now, 'batch_id', b.id,
           'cutoff_at', b.cutoff_at, 'purchase_on', b.purchase_on, 'delivery_on', b.delivery_on,
           'line_ids', (select jsonb_agg(l.id order by l.position) from pr_lines l where l.request_id = v_req))
    into v_result
    from pr_batches b where b.id = v_batch;

  insert into pr_ops (op_id, actor_id, kind, result) values (p_op, v_uid, 'submit', v_result);
  return v_result;
end;
$$;

-- ════ §9 Changing quantities and cancelling ═══════════════════════════

-- Moves a line's still-needed total to p_new (spec §4B):
--   increase → first take back quantity already flagged for reduction
--              (newest arranged first); the rest is new demand in the batch
--              for NOW, merged only into that batch's UNARRANGED portion —
--              10 arranged this week + 2 added after cutoff stay separate.
--   decrease → remove the newest UNARRANGED quantity first; whatever is
--              left is FLAGGED on arranged portions (pending_reduction) for
--              the office — a placed order or purchase is never erased.
create or replace function pr_apply_quantity(p_line uuid, p_new numeric, p_owner uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_total numeric;
  v_delta numeric;
  v_take numeric;
  v_batch uuid;
  v_target uuid;
  p record;
begin
  select coalesce(sum(quantity - pending_reduction), 0) into v_total
    from pr_line_portions where line_id = p_line;

  if p_new > v_total then
    v_delta := p_new - v_total;
    for p in select * from pr_line_portions
              where line_id = p_line and arranged_at is not null and pending_reduction > 0
              order by created_at desc, id desc for update loop
      exit when v_delta <= 0;
      v_take := least(v_delta, p.pending_reduction);
      update pr_line_portions set pending_reduction = pending_reduction - v_take where id = p.id;
      v_delta := v_delta - v_take;
    end loop;
    if v_delta > 0 then
      v_batch := pr_batch_for(p_owner, now());
      select id into v_target from pr_line_portions
       where line_id = p_line and batch_id = v_batch and arranged_at is null
       order by created_at desc, id desc limit 1 for update;
      if v_target is not null then
        update pr_line_portions set quantity = quantity + v_delta where id = v_target and arranged_at is null;
      end if;
      if v_target is null or not found then
        insert into pr_line_portions (owner_id, line_id, batch_id, quantity) values (p_owner, p_line, v_batch, v_delta);
      end if;
    end if;

  elsif p_new < v_total then
    v_delta := v_total - p_new;
    for p in select * from pr_line_portions
              where line_id = p_line and arranged_at is null
              order by created_at desc, id desc for update loop
      exit when v_delta <= 0;
      v_take := least(v_delta, p.quantity);
      if v_take >= p.quantity then
        delete from pr_line_portions where id = p.id;
      else
        update pr_line_portions set quantity = quantity - v_take where id = p.id;
      end if;
      v_delta := v_delta - v_take;
    end loop;
    for p in select * from pr_line_portions
              where line_id = p_line and arranged_at is not null
              order by created_at desc, id desc for update loop
      exit when v_delta <= 0;
      v_take := least(v_delta, p.quantity - p.pending_reduction);
      if v_take > 0 then
        update pr_line_portions set pending_reduction = pending_reduction + v_take where id = p.id;
        v_delta := v_delta - v_take;
      end if;
    end loop;
  end if;
end;
$$;

-- The requester changes a line's quantity. p_base_version is the version the
-- phone last saw: if the office changed the line since, BOTH values are kept
-- as a conflict for the office to resolve (spec §4E) and nothing is applied.
create or replace function pr_change_quantity(p_op uuid, p_line uuid, p_base_version int, p_quantity numeric) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_prev jsonb;
  v_current numeric;
  v_result jsonb;
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

  select ln.id, ln.owner_id, ln.request_id, ln.status, ln.version,
         r.requester_id, r.status as request_status, r.folder_id, r.work_folder_id
    into l
    from pr_lines ln join pr_requests r on r.id = ln.request_id
   where ln.id = p_line
     for update of ln;
  if not found or l.requester_id <> v_uid then
    raise exception 'NOT_YOUR_LINE' using errcode = 'P0001';
  end if;
  if l.status <> 'open' or l.request_status <> 'submitted' then
    raise exception 'LINE_CLOSED' using errcode = 'P0001';
  end if;
  if p_quantity is null or p_quantity <= 0 or p_quantity > 1000000 or p_quantity <> round(p_quantity, 3) then
    raise exception 'BAD_QUANTITY' using errcode = 'P0001';
  end if;

  select coalesce(sum(quantity - pending_reduction), 0) into v_current
    from pr_line_portions where line_id = p_line;

  if p_base_version is distinct from l.version then
    insert into pr_line_conflicts (owner_id, line_id, proposed_by, base_version, current_version, proposed_quantity, current_quantity)
    values (l.owner_id, p_line, v_uid, coalesce(p_base_version, 0), l.version, p_quantity, v_current);
    update pr_lines set has_conflict = true where id = p_line;
    insert into pr_events (owner_id, request_id, line_id, actor_id, kind, detail)
    values (l.owner_id, l.request_id, p_line, v_uid, 'quantity_conflict',
            jsonb_build_object('proposed', p_quantity, 'current', v_current, 'base_version', p_base_version, 'version', l.version));
    v_result := jsonb_build_object('status', 'conflict', 'version', l.version, 'needed', v_current);
  else
    if p_quantity > v_current and not pr_work_open(l.folder_id, l.work_folder_id) then
      raise exception 'DESTINATION_CLOSED' using errcode = 'P0001';
    end if;
    if p_quantity = v_current then
      -- Nothing to change: no new version, no event, no portion work.
      v_result := jsonb_build_object('status', 'applied', 'version', l.version, 'needed', v_current);
    else
      perform pr_apply_quantity(p_line, p_quantity, l.owner_id);
      update pr_lines set version = version + 1 where id = p_line;
      insert into pr_events (owner_id, request_id, line_id, actor_id, kind, detail)
      values (l.owner_id, l.request_id, p_line, v_uid, 'quantity_changed', jsonb_build_object('from', v_current, 'to', p_quantity));
      v_result := jsonb_build_object('status', 'applied', 'version', l.version + 1, 'needed', p_quantity);
    end if;
  end if;

  insert into pr_ops (op_id, actor_id, kind, result) values (p_op, v_uid, 'change_quantity', v_result);
  return v_result;
end;
$$;

-- The requester cancels one line. Its unarranged quantity goes; arranged
-- quantity is flagged for the office. History stays.
create or replace function pr_cancel_line(p_op uuid, p_line uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_prev jsonb;
  v_result jsonb;
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

  select ln.id, ln.owner_id, ln.request_id, ln.status, ln.version, r.requester_id, r.status as request_status
    into l
    from pr_lines ln join pr_requests r on r.id = ln.request_id
   where ln.id = p_line
     for update of ln;
  if not found or l.requester_id <> v_uid then
    raise exception 'NOT_YOUR_LINE' using errcode = 'P0001';
  end if;
  if l.status <> 'open' or l.request_status <> 'submitted' then
    raise exception 'LINE_CLOSED' using errcode = 'P0001';
  end if;

  perform pr_apply_quantity(p_line, 0, l.owner_id);
  update pr_lines set status = 'cancelled', version = version + 1 where id = p_line;
  insert into pr_events (owner_id, request_id, line_id, actor_id, kind, detail)
  values (l.owner_id, l.request_id, p_line, v_uid, 'line_cancelled', '{}'::jsonb);

  v_result := jsonb_build_object('status', 'cancelled', 'version', l.version + 1);
  insert into pr_ops (op_id, actor_id, kind, result) values (p_op, v_uid, 'cancel_line', v_result);
  return v_result;
end;
$$;

-- The requester cancels the whole request: every open line as above.
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

  select id, owner_id, requester_id, status into r from pr_requests where id = p_request for update;
  if not found or r.requester_id <> v_uid then
    raise exception 'NOT_YOUR_REQUEST' using errcode = 'P0001';
  end if;
  if r.status <> 'submitted' then
    raise exception 'LINE_CLOSED' using errcode = 'P0001';
  end if;

  for ln in select id from pr_lines where request_id = p_request and status = 'open' order by position for update loop
    perform pr_apply_quantity(ln.id, 0, r.owner_id);
    update pr_lines set status = 'cancelled', version = version + 1 where id = ln.id;
    v_count := v_count + 1;
  end loop;
  update pr_requests set status = 'cancelled', cancelled_at = now() where id = p_request;
  insert into pr_events (owner_id, request_id, actor_id, kind, detail)
  values (r.owner_id, p_request, v_uid, 'request_cancelled', jsonb_build_object('lines', v_count));

  v_result := jsonb_build_object('status', 'cancelled', 'lines', v_count);
  insert into pr_ops (op_id, actor_id, kind, result) values (p_op, v_uid, 'cancel_request', v_result);
  return v_result;
end;
$$;

-- ════ §10 Reading requests, and private photos ════════════════════════

-- What the app's Requests tab shows: the caller's own requests, plus their
-- teams' requests while they are the current leader. Quantities only —
-- no money exists in these tables. Names, never contact details.
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
                        'portions', (
                          select coalesce(jsonb_agg(jsonb_build_object(
                                   'quantity', p.quantity, 'pending_reduction', p.pending_reduction,
                                   'arranged', p.arranged_at is not null,
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

-- Raw request photos: never the legacy shared `uploads` bucket (spec §4A).
-- Path {requester_uid}/{request_id}/{photo_id}.jpg.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('request-photos', 'request-photos', false, 5242880, array['image/jpeg'])
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- The object path names the caller and one of the caller's own requests.
-- SECURITY DEFINER because it reads pr_requests, which workers cannot.
create or replace function pr_owns_request_path(p_name text) returns boolean
language sql stable security definer set search_path = public as $$
  select pr_is_requester()
     and (storage.foldername(p_name))[1] = auth.uid()::text
     and exists (select 1 from pr_requests r
                  where r.id::text = (storage.foldername(p_name))[2]
                    and r.requester_id = auth.uid())
$$;

-- The caller may see a photo of this request: its requester, or the current
-- leader of the request's team (spec §4G: never the whole crew).
create or replace function pr_can_read_request_photo(p_name text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from pr_requests r
     where r.id::text = (storage.foldername(p_name))[2]
       and r.requester_id::text = (storage.foldername(p_name))[1]
       and (r.requester_id = auth.uid()
            or (r.team_id is not null and pr_is_current_leader(r.team_id, auth.uid()))))
$$;

drop policy if exists "request-photos: requester uploads own" on storage.objects;
create policy "request-photos: requester uploads own" on storage.objects for insert to authenticated
  with check (bucket_id = 'request-photos' and pr_owns_request_path(name));

drop policy if exists "request-photos: requester and leader read" on storage.objects;
create policy "request-photos: requester and leader read" on storage.objects for select to authenticated
  using (bucket_id = 'request-photos' and pr_can_read_request_photo(name));

drop policy if exists "request-photos: office reads" on storage.objects;
create policy "request-photos: office reads" on storage.objects for select to authenticated
  using (bucket_id = 'request-photos' and (is_owner() or is_staff())
         and exists (select 1 from pr_requests r where r.id::text = (storage.foldername(name))[2] and can_access(r.owner_id)));

-- Links an uploaded photo to the request (and optionally one line).
-- Upload first, then attach: the row only ever points at a real object.
create or replace function pr_attach_photo(p_op uuid, p_request uuid, p_line uuid, p_path text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_prev jsonb;
  v_result jsonb;
  v_id uuid;
  r record;
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

  select id, owner_id, requester_id into r from pr_requests where id = p_request;
  if not found or r.requester_id <> v_uid then
    raise exception 'NOT_YOUR_REQUEST' using errcode = 'P0001';
  end if;
  if p_line is not null and not exists (select 1 from pr_lines l where l.id = p_line and l.request_id = p_request) then
    raise exception 'BAD_LINE' using errcode = 'P0001';
  end if;
  if p_path is null or left(p_path, length(v_uid::text || '/' || p_request::text || '/')) <> v_uid::text || '/' || p_request::text || '/' then
    raise exception 'BAD_PATH' using errcode = 'P0001';
  end if;
  if not exists (select 1 from storage.objects o where o.bucket_id = 'request-photos' and o.name = p_path) then
    raise exception 'PHOTO_NOT_UPLOADED' using errcode = 'P0001';
  end if;

  insert into pr_photos (owner_id, request_id, line_id, storage_path, uploaded_by)
  values (r.owner_id, p_request, p_line, p_path, v_uid)
  on conflict (storage_path) do nothing;
  select id into v_id from pr_photos where storage_path = p_path;

  insert into pr_events (owner_id, request_id, line_id, actor_id, kind, detail)
  values (r.owner_id, p_request, p_line, v_uid, 'photo_attached', jsonb_build_object('photo_id', v_id));

  v_result := jsonb_build_object('photo_id', v_id);
  insert into pr_ops (op_id, actor_id, kind, result) values (p_op, v_uid, 'attach_photo', v_result);
  return v_result;
end;
$$;

-- ════ §11 Legacy requests: read-only history ═══════════════════════════

-- Spec §6/§10: at Stage 1a, workers lose broad access to colleagues'
-- requests through the legacy tables — on the SERVER, not just the screen.
-- Before this, any worker could read every request (requests_read) and
-- request_items_rw let any worker update or DELETE any item. The rows
-- (2 requests, 3 items, last March 2026) stay as history: owner/staff keep
-- full access; a worker may read only their own and write nothing.
-- No `for all` policy (repo rule since 0081): owner/staff get one policy per command.
drop policy if exists requests_read on requests;
create policy requests_read on requests for select to authenticated
  using (is_owner() or is_staff() or (is_worker() and requested_by = auth.uid()));
drop policy if exists requests_worker_create on requests;
drop policy if exists requests_worker_update on requests;

drop policy if exists request_items_rw on request_items;
drop policy if exists request_items_admin on request_items;
drop policy if exists request_items_admin_select on request_items;
drop policy if exists request_items_admin_insert on request_items;
drop policy if exists request_items_admin_update on request_items;
drop policy if exists request_items_admin_delete on request_items;
create policy request_items_admin_select on request_items for select to authenticated
  using (is_owner() or is_staff());
create policy request_items_admin_insert on request_items for insert to authenticated
  with check (is_owner() or is_staff());
create policy request_items_admin_update on request_items for update to authenticated
  using (is_owner() or is_staff()) with check (is_owner() or is_staff());
create policy request_items_admin_delete on request_items for delete to authenticated
  using (is_owner() or is_staff());
drop policy if exists request_items_worker_read on request_items;
create policy request_items_worker_read on request_items for select to authenticated
  using (is_worker() and exists (select 1 from requests r where r.id = request_items.request_id and r.requested_by = auth.uid()));

-- ════ §12 Who may call what ═══════════════════════════════════════════

-- Internal helpers: only other SECURITY DEFINER functions call them.
revoke all on function pr_person_name(uuid) from public, anon, authenticated;
revoke all on function pr_is_current_member(uuid, uuid) from public, anon, authenticated;
revoke all on function pr_is_current_leader(uuid, uuid) from public, anon, authenticated;
revoke all on function pr_project_open(uuid) from public, anon, authenticated;
revoke all on function pr_work_open(uuid, uuid) from public, anon, authenticated;
revoke all on function pr_cutoff_after(timestamptz) from public, anon, authenticated;
revoke all on function pr_batch_for(uuid, timestamptz) from public, anon, authenticated;
revoke all on function pr_apply_quantity(uuid, numeric, uuid) from public, anon, authenticated;

-- Evaluated inside storage policies, so the signed-in caller needs EXECUTE.
revoke all on function pr_is_requester() from public, anon;
grant execute on function pr_is_requester() to authenticated;
revoke all on function pr_owns_request_path(text) from public, anon;
grant execute on function pr_owns_request_path(text) to authenticated;
revoke all on function pr_can_read_request_photo(text) from public, anon;
grant execute on function pr_can_read_request_photo(text) to authenticated;

-- The worker RPCs (each checks pr_is_requester() itself).
revoke all on function pr_destinations() from public, anon;
grant execute on function pr_destinations() to authenticated;
revoke all on function pr_my_teams() from public, anon;
grant execute on function pr_my_teams() to authenticated;
revoke all on function pr_catalog() from public, anon;
grant execute on function pr_catalog() to authenticated;
revoke all on function pr_submit_request(uuid, jsonb) from public, anon;
grant execute on function pr_submit_request(uuid, jsonb) to authenticated;
revoke all on function pr_change_quantity(uuid, uuid, integer, numeric) from public, anon;
grant execute on function pr_change_quantity(uuid, uuid, integer, numeric) to authenticated;
revoke all on function pr_cancel_line(uuid, uuid) from public, anon;
grant execute on function pr_cancel_line(uuid, uuid) to authenticated;
revoke all on function pr_cancel_request(uuid, uuid) from public, anon;
grant execute on function pr_cancel_request(uuid, uuid) to authenticated;
revoke all on function pr_my_requests(integer) from public, anon;
grant execute on function pr_my_requests(integer) to authenticated;
revoke all on function pr_attach_photo(uuid, uuid, uuid, text) from public, anon;
grant execute on function pr_attach_photo(uuid, uuid, uuid, text) to authenticated;
