-- 0093 — WorkMate Stage 1c-1: My Work (Meetings & Work Plan) — the server.
--
-- ── WHAT. The office turns meeting notes into tasks (drafted by AI or by
--    hand — the AI call is Dacs Web's job, plan 1c-2; here a draft is just a
--    task in status 'draft'), publishes them with shared notes, and checks
--    the work. Workers see their tasks in WorkMate's My Work, acknowledge
--    them, report progress, blockers and done; a team leader checks.
--    Spec: docs/superpowers/specs/2026-09-30-workmate-meetings-work-plan-design.md
--    (§15 decisions, 12 October 2026).
--
-- ── WORKERS NEVER TOUCH wp_* TABLES. RLS is on everywhere; the only
--    policies are office reads. Every worker read/write is a SECURITY
--    DEFINER RPC that re-checks, when it runs, that the caller is still the
--    responsible person / helper / current team leader of that task — a
--    stale offline action cannot bypass a change made meanwhile.
--
-- ── WORKERS NEVER SEE the office's original meeting notes, the AI source
--    passage, office flags, who proposed a task, or anyone's
--    acknowledgements; only tasks they have a role on; only the shared
--    notes of a version they were chosen to receive.
--
-- ── RETRY-SAFE. Every worker write carries a client-made operation id; the
--    first result is stored in wp_ops and returned verbatim on retry.
--
-- ── BLOCKED IS DERIVED, never stored: a task is blocked while it has an
--    open blocker or an earlier task (dependency) that is not Completed.
--    Start work, Report done and office approval are refused while blocked.
--    Only the office clears a blocker, with a note.
--
-- ── NO MONEY. Outside the money model: nothing here feeds Spent / Earned /
--    Profit, Attendance or payroll. No penalties follow from any status.

set local lock_timeout = '5s';

-- ════ §1 Tables ════════════════════════════════════════════════════════

-- A meeting. original_notes are the office's own typed/pasted notes and
-- never reach a worker; workers read a published VERSION's shared notes.
create table if not exists wp_meetings (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references profiles(id),
  title text not null check (btrim(title) <> ''),
  held_on date not null,
  original_notes text not null default '',
  current_version int not null default 0 check (current_version >= 0),
  created_by uuid not null references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists wp_meetings_owner on wp_meetings (owner_id, held_on desc);
alter table wp_meetings enable row level security;

-- Each publish of a meeting's shared notes is a new version; older ones stay.
create table if not exists wp_meeting_versions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references profiles(id),
  meeting_id uuid not null references wp_meetings(id),
  version int not null check (version > 0),
  shared_notes text not null default '',
  change_note text not null default '',
  published_by uuid not null references profiles(id),
  published_at timestamptz not null default now(),
  unique (meeting_id, version)
);
alter table wp_meeting_versions enable row level security;

-- Who may read a version's shared notes (chosen by staff at publish).
create table if not exists wp_note_recipients (
  owner_id uuid not null references profiles(id),
  version_id uuid not null references wp_meeting_versions(id),
  person_id uuid not null references profiles(id),
  primary key (version_id, person_id)
);
alter table wp_note_recipients enable row level security;

-- A task: one Project Control project + Main Contract (work = project) or
-- one of its Additional Works. meeting_id null = a standalone task.
-- version 0 = draft; publishing makes it 1; an important revision raises it
-- and every assigned person must acknowledge the new version.
create table if not exists wp_tasks (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references profiles(id),
  meeting_id uuid references wp_meetings(id),
  folder_id uuid not null references folders(id),
  work_folder_id uuid not null references folders(id),
  team_id uuid references pr_teams(id),
  title text not null check (btrim(title) <> ''),
  instructions text not null default '',
  planned_start date,
  planned_end date,
  status text not null default 'draft'
    check (status in ('draft', 'not_started', 'in_progress', 'reported_done', 'leader_checked', 'completed', 'cancelled')),
  sent_back boolean not null default false,
  version int not null default 0,
  version_at timestamptz,
  source_passage text not null default '',
  office_flags jsonb not null default '[]'::jsonb,
  proposed_by uuid references profiles(id),
  created_by uuid not null references profiles(id),
  created_at timestamptz not null default now(),
  published_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  check (planned_start is null or planned_end is null or planned_end >= planned_start),
  check (status <> 'draft' or version = 0),
  check (status in ('draft', 'cancelled') or version > 0),
  check ((status = 'completed') = (completed_at is not null)),
  check (jsonb_typeof(office_flags) = 'array')
);
create index if not exists wp_tasks_owner_folder on wp_tasks (owner_id, folder_id);
create index if not exists wp_tasks_meeting on wp_tasks (meeting_id) where meeting_id is not null;
alter table wp_tasks enable row level security;

-- Responsible person and helpers. Removing someone sets removed_at, so the
-- history still shows who was on the task.
create table if not exists wp_task_people (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references profiles(id),
  task_id uuid not null references wp_tasks(id),
  person_id uuid not null references profiles(id),
  role text not null check (role in ('responsible', 'helper')),
  added_at timestamptz not null default now(),
  removed_at timestamptz,
  check (removed_at is null or removed_at >= added_at)
);
create unique index if not exists wp_task_people_current on wp_task_people (task_id, person_id) where removed_at is null;
create unique index if not exists wp_task_one_responsible on wp_task_people (task_id) where role = 'responsible' and removed_at is null;
create index if not exists wp_task_people_person on wp_task_people (person_id) where removed_at is null;
alter table wp_task_people enable row level security;

-- "I've read this" — per person, per task VERSION actually read.
create table if not exists wp_acks (
  owner_id uuid not null references profiles(id),
  task_id uuid not null references wp_tasks(id),
  person_id uuid not null references profiles(id),
  version int not null check (version > 0),
  acked_at timestamptz not null default now(),
  primary key (task_id, person_id, version)
);
alter table wp_acks enable row level security;

-- A reported problem. Never creates a purchase or moves a date; only the
-- office clears it, with a note. A material blocker may point at a request.
create table if not exists wp_blockers (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references profiles(id),
  task_id uuid not null references wp_tasks(id),
  kind text not null check (kind in ('materials', 'tool', 'preparation', 'other')),
  description text not null check (btrim(description) <> ''),
  request_id uuid references pr_requests(id),
  reported_by uuid not null references profiles(id),
  reported_at timestamptz not null default now(),
  cleared_by uuid references profiles(id),
  cleared_at timestamptz,
  clear_note text,
  check ((cleared_at is null) = (cleared_by is null)),
  check (cleared_at is null or btrim(coalesce(clear_note, '')) <> '')
);
create index if not exists wp_blockers_open on wp_blockers (task_id) where cleared_at is null;
alter table wp_blockers enable row level security;

-- "This task waits for that one" — same project only, no cycles (checked
-- by wp_office_save_task under a per-project lock).
create table if not exists wp_dependencies (
  owner_id uuid not null references profiles(id),
  task_id uuid not null references wp_tasks(id),
  depends_on uuid not null references wp_tasks(id),
  primary key (task_id, depends_on),
  check (task_id <> depends_on)
);
create index if not exists wp_dependencies_target on wp_dependencies (depends_on);
alter table wp_dependencies enable row level security;

-- Append-only history of tasks and meetings.
create table if not exists wp_events (
  id bigserial primary key,
  owner_id uuid not null references profiles(id),
  task_id uuid references wp_tasks(id),
  meeting_id uuid references wp_meetings(id),
  actor_id uuid not null references profiles(id),
  kind text not null,
  note text not null default '',
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check (task_id is not null or meeting_id is not null)
);
create index if not exists wp_events_task on wp_events (task_id, id);
alter table wp_events enable row level security;

-- The first answer to each worker operation, returned verbatim on retry.
create table if not exists wp_ops (
  owner_id uuid not null references profiles(id),
  op_id uuid not null,
  actor_id uuid not null references profiles(id),
  kind text not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key (actor_id, op_id)
);
alter table wp_ops enable row level security;

-- Private task photos (bucket task-photos, §3), on a blocker or a report.
create table if not exists wp_photos (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references profiles(id),
  task_id uuid not null references wp_tasks(id),
  blocker_id uuid references wp_blockers(id),
  event_id bigint references wp_events(id),
  storage_path text not null unique,
  uploaded_by uuid not null references profiles(id),
  created_at timestamptz not null default now()
);
create index if not exists wp_photos_task on wp_photos (task_id);
alter table wp_photos enable row level security;

-- The office reads; every change goes through an RPC. No anon access and no
-- direct writes for anyone.
do $$
declare v_table text;
begin
  foreach v_table in array array['wp_meetings', 'wp_meeting_versions', 'wp_note_recipients', 'wp_tasks', 'wp_task_people', 'wp_acks',
                                  'wp_blockers', 'wp_dependencies', 'wp_events', 'wp_ops', 'wp_photos'] loop
    execute format('drop policy if exists %I on %I', v_table || '_office_read', v_table);
    execute format('create policy %I on %I for select to authenticated using ((is_owner() or is_staff()) and can_access(owner_id))',
                   v_table || '_office_read', v_table);
    execute format('revoke all on %I from anon', v_table);
    execute format('revoke insert, update, delete, truncate, references, trigger on %I from authenticated', v_table);
  end loop;
end $$;

-- ════ §2 Shared helpers ═══════════════════════════════════════════════

-- An active worker or team leader of this company (names only ever shown).
create or replace function wp_person_ok(p_person uuid, p_owner uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles p
                  where p.id = p_person and p.role in ('worker', 'teamLeader')
                    and coalesce(p.status, 'active') = 'active'
                    and coalesce(p.owner_id, p.id) = p_owner)
$$;

-- An open top-level Project Control project of this company, and the work:
-- the project itself (Main Contract) or one of its own open Additional
-- Works. Unlike requests, a task does not need Allow requests or Time In.
create or replace function wp_work_valid(p_owner uuid, p_folder uuid, p_work uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from folders f
                  where f.id = p_folder and f.owner_id = p_owner and f.parent_folder_id is null
                    and f.completed_at is null and coalesce(btrim(f.name), '') <> '')
     and (p_work = p_folder
          or exists (select 1 from folders c
                      where c.id = p_work and c.parent_folder_id = p_folder
                        and c.completed_at is null and coalesce(btrim(c.name), '') <> ''))
$$;

-- THE blocked rule: an open blocker, or an earlier task not yet Completed.
create or replace function wp_task_blocked(p_task uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from wp_blockers b where b.task_id = p_task and b.cleared_at is null)
      or exists (select 1 from wp_dependencies x join wp_tasks d on d.id = x.depends_on
                  where x.task_id = p_task and d.status <> 'completed')
$$;

-- The caller's role on a task: assigned (responsible/helper), else the
-- current leader of its team, else null.
create or replace function wp_role_on(p_task uuid, p_user uuid) returns text
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select p.role from wp_task_people p
      where p.task_id = p_task and p.person_id = p_user and p.removed_at is null),
    (select 'leader'::text from wp_tasks t
      where t.id = p_task and t.team_id is not null and pr_is_current_leader(t.team_id, p_user)))
$$;

-- A leader may check reported work of their team — never work they are assigned to (responsible or helper).
create or replace function wp_can_check(p_task uuid, p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from wp_tasks t
     where t.id = p_task and t.status = 'reported_done' and t.team_id is not null
       and pr_is_current_leader(t.team_id, p_user)
       and not exists (select 1 from wp_task_people p
                        where p.task_id = t.id and p.person_id = p_user
                          and p.removed_at is null))
$$;

-- Does p_from (directly or through others) wait for p_target?
create or replace function wp_depends_on(p_from uuid, p_target uuid) returns boolean
language sql stable security definer set search_path = public as $$
  with recursive up(id) as (
    select x.depends_on from wp_dependencies x where x.task_id = p_from
    union
    select x.depends_on from wp_dependencies x join up on x.task_id = up.id)
  select exists (select 1 from up where up.id = p_target)
$$;

-- One task as JSON. The worker part never carries office-only fields; the
-- office part is appended only when p_office.
create or replace function wp_task_doc(p_task uuid, p_viewer uuid, p_office boolean) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
           'id', t.id, 'meeting_id', t.meeting_id, 'title', t.title, 'instructions', t.instructions,
           'folder_id', t.folder_id, 'project_name', f.name, 'work_id', t.work_folder_id,
           'work_name', case when t.work_folder_id = t.folder_id then 'Main Contract' else w.name end,
           'team_id', t.team_id, 'team_name', tm.name,
           'status', t.status, 'sent_back', t.sent_back, 'blocked', wp_task_blocked(t.id),
           'planned_start', t.planned_start, 'planned_end', t.planned_end,
           'version', t.version, 'version_at', t.version_at, 'published_at', t.published_at,
           'completed_at', t.completed_at, 'updated_at', t.updated_at,
           'responsible', (select jsonb_build_object('id', p.person_id, 'name', pr_person_name(p.person_id))
                             from wp_task_people p
                            where p.task_id = t.id and p.role = 'responsible' and p.removed_at is null),
           'helpers', (select coalesce(jsonb_agg(jsonb_build_object('id', p.person_id, 'name', pr_person_name(p.person_id))
                                       order by lower(pr_person_name(p.person_id))), '[]'::jsonb)
                         from wp_task_people p
                        where p.task_id = t.id and p.role = 'helper' and p.removed_at is null),
           'blockers', (select coalesce(jsonb_agg(jsonb_build_object('id', b.id, 'kind', b.kind, 'description', b.description,
                                         'request_id', b.request_id, 'reported_at', b.reported_at,
                                         'reported_by', pr_person_name(b.reported_by)) order by b.reported_at), '[]'::jsonb)
                          from wp_blockers b where b.task_id = t.id and b.cleared_at is null),
           'waiting_for', (select coalesce(jsonb_agg(jsonb_build_object('task_id', d.id, 'title', d.title, 'status', d.status)
                                           order by d.title), '[]'::jsonb)
                             from wp_dependencies x join wp_tasks d on d.id = x.depends_on
                            where x.task_id = t.id and d.status <> 'completed'),
           'photos', (select coalesce(jsonb_agg(jsonb_build_object('id', ph.id, 'path', ph.storage_path, 'blocker_id', ph.blocker_id,
                                       'event_id', ph.event_id, 'created_at', ph.created_at) order by ph.created_at), '[]'::jsonb)
                        from wp_photos ph
                       where ph.task_id = t.id
                         and (p_office or ph.uploaded_by = p_viewer
                              or exists (select 1 from wp_task_people r
                                          where r.task_id = t.id and r.person_id = p_viewer
                                            and r.role = 'responsible' and r.removed_at is null)
                              or (t.team_id is not null and pr_is_current_leader(t.team_id, p_viewer)))),
           'history', (select coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'kind', e.kind, 'note', e.note,
                                        'by', pr_person_name(e.actor_id), 'at', e.created_at) order by e.id), '[]'::jsonb)
                         from wp_events e
                        where e.task_id = t.id and (p_office or e.kind not in ('acknowledged', 'proposed'))))
         || case when p_office then jsonb_build_object(
              'source_passage', t.source_passage, 'office_flags', t.office_flags,
              'proposed_by', case when t.proposed_by is null then null else pr_person_name(t.proposed_by) end,
              'acks', (select coalesce(jsonb_agg(jsonb_build_object('person_id', p.person_id, 'name', pr_person_name(p.person_id),
                         'role', p.role,
                         'acked', exists (select 1 from wp_acks a where a.task_id = t.id
                                            and a.person_id = p.person_id and a.version = t.version))
                         order by p.role desc, lower(pr_person_name(p.person_id))), '[]'::jsonb)
                         from wp_task_people p where p.task_id = t.id and p.removed_at is null),
              'not_acknowledged_24h', t.status not in ('draft', 'completed', 'cancelled')
                   and t.version_at < now() - interval '24 hours'
                   and exists (select 1 from wp_task_people p
                                where p.task_id = t.id and p.removed_at is null
                                  and not exists (select 1 from wp_acks a where a.task_id = t.id
                                                    and a.person_id = p.person_id and a.version = t.version)),
              'overdue', t.status in ('not_started', 'in_progress')
                   and t.planned_end < (now() at time zone 'Asia/Manila')::date,
              'depends_on', (select coalesce(jsonb_agg(x.depends_on), '[]'::jsonb) from wp_dependencies x where x.task_id = t.id))
            else jsonb_build_object(
              'my_role', wp_role_on(t.id, p_viewer),
              'my_ack_version', (select max(a.version) from wp_acks a where a.task_id = t.id and a.person_id = p_viewer),
              'can_check', wp_can_check(t.id, p_viewer)) end
    from wp_tasks t
    join folders f on f.id = t.folder_id
    join folders w on w.id = t.work_folder_id
    left join pr_teams tm on tm.id = t.team_id
   where t.id = p_task
$$;

-- Retry safety: serialise one operation id per caller and return its first
-- answer, if any.
create or replace function wp_op_prev(p_op uuid, p_uid uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if p_op is null then
    raise exception 'BAD_OPERATION' using errcode = 'P0001';
  end if;
  perform pg_advisory_xact_lock(hashtext('wp_op:' || p_uid::text || ':' || p_op::text));
  return (select o.result from wp_ops o where o.actor_id = p_uid and o.op_id = p_op);
end;
$$;

create or replace function wp_op_save(p_op uuid, p_uid uuid, p_kind text, p_result jsonb) returns jsonb
language sql security definer set search_path = public as $$
  insert into wp_ops (owner_id, op_id, actor_id, kind, result)
  values (attendance_data_owner(), p_op, p_uid, p_kind, p_result)
  returning result
$$;

create or replace function wp_log(p_owner uuid, p_task uuid, p_meeting uuid, p_kind text, p_note text, p_detail jsonb) returns bigint
language sql security definer set search_path = public as $$
  insert into wp_events (owner_id, task_id, meeting_id, actor_id, kind, note, detail)
  values (p_owner, p_task, p_meeting, auth.uid(), p_kind, coalesce(p_note, ''), coalesce(p_detail, '{}'::jsonb))
  returning id
$$;

-- A worker's task, locked, re-checked NOW: published, not cancelled, of the
-- caller's company, and the caller has a role on it.
create or replace function wp_worker_task(p_task uuid) returns wp_tasks
language plpgsql security definer set search_path = public as $$
declare
  t wp_tasks;
begin
  if not pr_is_requester() then
    raise exception 'NOT_A_REQUESTER' using errcode = 'P0001';
  end if;
  select * into t from wp_tasks where id = p_task and owner_id = attendance_data_owner() for no key update;
  if not found or t.status in ('draft', 'cancelled') or wp_role_on(t.id, auth.uid()) is null then
    raise exception 'NOT_ASSIGNED' using errcode = 'P0001';
  end if;
  return t;
end;
$$;

-- An office caller's task of its own company, locked.
create or replace function wp_office_task_row(p_task uuid) returns wp_tasks
language plpgsql security definer set search_path = public as $$
declare
  t wp_tasks;
begin
  if not pr_is_office() then
    raise exception 'OFFICE_ONLY' using errcode = 'P0001';
  end if;
  select * into t from wp_tasks where id = p_task and owner_id = data_owner_id() for no key update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  return t;
end;
$$;

revoke all on function wp_person_ok(uuid, uuid) from public, anon, authenticated;
revoke all on function wp_work_valid(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function wp_task_blocked(uuid) from public, anon, authenticated;
revoke all on function wp_role_on(uuid, uuid) from public, anon, authenticated;
revoke all on function wp_can_check(uuid, uuid) from public, anon, authenticated;
revoke all on function wp_depends_on(uuid, uuid) from public, anon, authenticated;
revoke all on function wp_task_doc(uuid, uuid, boolean) from public, anon, authenticated;
revoke all on function wp_op_prev(uuid, uuid) from public, anon, authenticated;
revoke all on function wp_op_save(uuid, uuid, text, jsonb) from public, anon, authenticated;
revoke all on function wp_log(uuid, uuid, uuid, text, text, jsonb) from public, anon, authenticated;
revoke all on function wp_worker_task(uuid) from public, anon, authenticated;
revoke all on function wp_office_task_row(uuid) from public, anon, authenticated;

-- ════ §3 Task photos ═══════════════════════════════════════════════════

-- Private bucket: <uploader_id>/<task_id>/<uuid>.jpg. A NEW bucket like
-- request-photos — not an uploads top folder.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('task-photos', 'task-photos', false, 5242880, array['image/jpeg'])
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- Upload: a worker, under their own id, for a published task they have a
-- role on. SECURITY DEFINER because it reads wp_tasks, which workers cannot.
create or replace function wp_can_upload_task_path(p_name text) returns boolean
language sql stable security definer set search_path = public as $$
  select pr_is_requester()
     and (storage.foldername(p_name))[1] = auth.uid()::text
     and exists (select 1 from wp_tasks t
                  where t.id::text = (storage.foldername(p_name))[2]
                    and t.owner_id = attendance_data_owner()
                    and t.status not in ('draft', 'cancelled')
                    and wp_role_on(t.id, auth.uid()) is not null)
$$;

-- Read: an attached photo, by its uploader, the task's responsible person
-- or the current leader of the task's team (spec §15: never the whole crew).
create or replace function wp_can_read_task_photo(p_name text) returns boolean
language sql stable security definer set search_path = public as $$
  select pr_is_requester() and exists (
    select 1 from wp_photos ph join wp_tasks t on t.id = ph.task_id
     where ph.storage_path = p_name
       and t.owner_id = attendance_data_owner()
       and (ph.uploaded_by = auth.uid()
            or exists (select 1 from wp_task_people p
                        where p.task_id = t.id and p.person_id = auth.uid()
                          and p.role = 'responsible' and p.removed_at is null)
            or (t.team_id is not null and pr_is_current_leader(t.team_id, auth.uid()))))
$$;

-- The office of the task's company reads every photo of it.
create or replace function wp_office_task_path_ok(p_name text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(is_owner() or is_staff(), false)
     and exists (select 1 from wp_tasks t
                  where t.id::text = (storage.foldername(p_name))[2] and t.owner_id = data_owner_id())
$$;

drop policy if exists "task-photos: assigned uploads own" on storage.objects;
create policy "task-photos: assigned uploads own" on storage.objects for insert to authenticated
  with check (bucket_id = 'task-photos' and wp_can_upload_task_path(name));

drop policy if exists "task-photos: worker reads" on storage.objects;
create policy "task-photos: worker reads" on storage.objects for select to authenticated
  using (bucket_id = 'task-photos' and wp_can_read_task_photo(name));

drop policy if exists "task-photos: office reads" on storage.objects;
create policy "task-photos: office reads" on storage.objects for select to authenticated
  using (bucket_id = 'task-photos' and wp_office_task_path_ok(name));

revoke all on function wp_can_upload_task_path(text) from public, anon;
grant execute on function wp_can_upload_task_path(text) to authenticated;
revoke all on function wp_can_read_task_photo(text) from public, anon;
grant execute on function wp_can_read_task_photo(text) to authenticated;
revoke all on function wp_office_task_path_ok(text) from public, anon;
grant execute on function wp_office_task_path_ok(text) to authenticated;

-- ════ §4 Worker reads ═══════════════════════════════════════════════════

-- My Work: every published task the caller has a role on (responsible,
-- helper, or current leader of its team). Completed ones stay 14 days.
create or replace function wp_my_work() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null or not pr_is_requester() then
    raise exception 'NOT_A_REQUESTER' using errcode = 'P0001';
  end if;
  return (select coalesce(jsonb_agg(wp_task_doc(t.id, auth.uid(), false)
                                    order by t.planned_start nulls last, t.created_at), '[]'::jsonb)
            from wp_tasks t
           where t.owner_id = attendance_data_owner()
             and t.status not in ('draft', 'cancelled')
             and (t.status <> 'completed' or t.completed_at > now() - interval '14 days')
             and wp_role_on(t.id, auth.uid()) is not null);
end;
$$;

-- Shared meeting notes: the LATEST published version of each meeting the
-- caller was chosen to receive. Never the office's original notes.
create or replace function wp_my_notes() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null or not pr_is_requester() then
    raise exception 'NOT_A_REQUESTER' using errcode = 'P0001';
  end if;
  return (select coalesce(jsonb_agg(jsonb_build_object(
                   'meeting_id', m.id, 'title', m.title, 'held_on', m.held_on, 'version', v.version,
                   'shared_notes', v.shared_notes, 'change_note', v.change_note, 'published_at', v.published_at)
                   order by m.held_on desc, v.published_at desc), '[]'::jsonb)
            from wp_meetings m
            join wp_meeting_versions v on v.meeting_id = m.id and v.version = m.current_version
            join wp_note_recipients r on r.version_id = v.id and r.person_id = auth.uid()
           where m.owner_id = attendance_data_owner()
             and m.held_on > (now() at time zone 'Asia/Manila')::date - 90);
end;
$$;

-- ════ §5 Worker writes (each retry-safe through wp_ops) ═══════════════

-- "I've read this" for the version the phone showed. An outdated version is
-- answered with the current task (stale = true) and recorded nowhere.
create or replace function wp_acknowledge(p_op uuid, p_task uuid, p_version integer) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_prev jsonb;
  t wp_tasks;
  v_result jsonb;
begin
  if v_uid is null or not pr_is_requester() then
    raise exception 'NOT_A_REQUESTER' using errcode = 'P0001';
  end if;
  v_prev := wp_op_prev(p_op, v_uid);
  if v_prev is not null then
    return v_prev;
  end if;
  t := wp_worker_task(p_task);
  if wp_role_on(t.id, v_uid) not in ('responsible', 'helper') then
    raise exception 'NOT_ASSIGNED' using errcode = 'P0001';
  end if;
  if p_version is distinct from t.version then
    v_result := jsonb_build_object('stale', true, 'task', wp_task_doc(t.id, v_uid, false));
  else
    insert into wp_acks (owner_id, task_id, person_id, version)
    values (t.owner_id, t.id, v_uid, t.version)
    on conflict do nothing;
    if found then
      perform wp_log(t.owner_id, t.id, null, 'acknowledged', '', jsonb_build_object('version', t.version));
    end if;
    v_result := jsonb_build_object('stale', false, 'task', wp_task_doc(t.id, v_uid, false));
  end if;
  return wp_op_save(p_op, v_uid, 'acknowledge', v_result);
end;
$$;

-- Responsible person only; refused while blocked, and until they have acknowledged the CURRENT version (an offline Start after a revision must show the new instructions first).
create or replace function wp_start_work(p_op uuid, p_task uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_prev jsonb;
  t wp_tasks;
  v_result jsonb;
begin
  if v_uid is null or not pr_is_requester() then
    raise exception 'NOT_A_REQUESTER' using errcode = 'P0001';
  end if;
  v_prev := wp_op_prev(p_op, v_uid);
  if v_prev is not null then
    return v_prev;
  end if;
  t := wp_worker_task(p_task);
  if wp_role_on(t.id, v_uid) is distinct from 'responsible' then
    raise exception 'NOT_RESPONSIBLE' using errcode = 'P0001';
  end if;
  if t.status <> 'not_started' then
    raise exception 'BAD_STATE' using errcode = 'P0001';
  end if;
  if wp_task_blocked(t.id) then
    raise exception 'TASK_BLOCKED' using errcode = 'P0001';
  end if;
  if not exists (select 1 from wp_acks a where a.task_id = t.id and a.person_id = v_uid and a.version = t.version) then
    raise exception 'NOT_ACKNOWLEDGED' using errcode = 'P0001';
  end if;
  update wp_tasks set status = 'in_progress', updated_at = now() where id = t.id;
  perform wp_log(t.owner_id, t.id, null, 'started', '', '{}'::jsonb);
  v_result := jsonb_build_object('task', wp_task_doc(t.id, v_uid, false));
  return wp_op_save(p_op, v_uid, 'start_work', v_result);
end;
$$;

-- A progress note from the responsible person (photos attach to it).
create or replace function wp_report_progress(p_op uuid, p_task uuid, p_note text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_prev jsonb;
  t wp_tasks;
  v_event bigint;
  v_result jsonb;
begin
  if v_uid is null or not pr_is_requester() then
    raise exception 'NOT_A_REQUESTER' using errcode = 'P0001';
  end if;
  v_prev := wp_op_prev(p_op, v_uid);
  if v_prev is not null then
    return v_prev;
  end if;
  t := wp_worker_task(p_task);
  if wp_role_on(t.id, v_uid) is distinct from 'responsible' then
    raise exception 'NOT_RESPONSIBLE' using errcode = 'P0001';
  end if;
  if t.status not in ('not_started', 'in_progress') then
    raise exception 'BAD_STATE' using errcode = 'P0001';
  end if;
  if btrim(coalesce(p_note, '')) = '' then
    raise exception 'NOTE_REQUIRED' using errcode = 'P0001';
  end if;
  v_event := wp_log(t.owner_id, t.id, null, 'progress', btrim(p_note), '{}'::jsonb);
  v_result := jsonb_build_object('event_id', v_event, 'task', wp_task_doc(t.id, v_uid, false));
  return wp_op_save(p_op, v_uid, 'report_progress', v_result);
end;
$$;

-- Anyone with a role may report a problem. It blocks the task until the
-- office clears it; it never creates a purchase or moves a date.
create or replace function wp_report_blocker(p_op uuid, p_task uuid, p_kind text, p_description text, p_request uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_prev jsonb;
  t wp_tasks;
  v_blocker uuid;
  v_result jsonb;
begin
  if v_uid is null or not pr_is_requester() then
    raise exception 'NOT_A_REQUESTER' using errcode = 'P0001';
  end if;
  v_prev := wp_op_prev(p_op, v_uid);
  if v_prev is not null then
    return v_prev;
  end if;
  t := wp_worker_task(p_task);
  if t.status not in ('not_started', 'in_progress', 'reported_done', 'leader_checked') then
    raise exception 'BAD_STATE' using errcode = 'P0001';
  end if;
  if p_kind is null or p_kind not in ('materials', 'tool', 'preparation', 'other') then
    raise exception 'BAD_KIND' using errcode = 'P0001';
  end if;
  if btrim(coalesce(p_description, '')) = '' then
    raise exception 'NOTE_REQUIRED' using errcode = 'P0001';
  end if;
  if p_request is not null and not exists (select 1 from pr_requests r
                                            where r.id = p_request and r.owner_id = t.owner_id and r.folder_id = t.folder_id) then
    raise exception 'BAD_REQUEST' using errcode = 'P0001';
  end if;
  insert into wp_blockers (owner_id, task_id, kind, description, request_id, reported_by)
  values (t.owner_id, t.id, p_kind, btrim(p_description), p_request, v_uid)
  returning id into v_blocker;
  perform wp_log(t.owner_id, t.id, null, 'blocker_reported', btrim(p_description),
                 jsonb_build_object('blocker_id', v_blocker, 'kind', p_kind));
  v_result := jsonb_build_object('blocker_id', v_blocker, 'task', wp_task_doc(t.id, v_uid, false));
  return wp_op_save(p_op, v_uid, 'report_blocker', v_result);
end;
$$;

-- Responsible person, from In progress, refused while blocked. Clears the
-- Sent back mark.
create or replace function wp_report_done(p_op uuid, p_task uuid, p_note text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_prev jsonb;
  t wp_tasks;
  v_event bigint;
  v_result jsonb;
begin
  if v_uid is null or not pr_is_requester() then
    raise exception 'NOT_A_REQUESTER' using errcode = 'P0001';
  end if;
  v_prev := wp_op_prev(p_op, v_uid);
  if v_prev is not null then
    return v_prev;
  end if;
  t := wp_worker_task(p_task);
  if wp_role_on(t.id, v_uid) is distinct from 'responsible' then
    raise exception 'NOT_RESPONSIBLE' using errcode = 'P0001';
  end if;
  if t.status <> 'in_progress' then
    raise exception 'BAD_STATE' using errcode = 'P0001';
  end if;
  if wp_task_blocked(t.id) then
    raise exception 'TASK_BLOCKED' using errcode = 'P0001';
  end if;
  update wp_tasks set status = 'reported_done', sent_back = false, updated_at = now() where id = t.id;
  v_event := wp_log(t.owner_id, t.id, null, 'reported_done', btrim(coalesce(p_note, '')), '{}'::jsonb);
  v_result := jsonb_build_object('event_id', v_event, 'task', wp_task_doc(t.id, v_uid, false));
  return wp_op_save(p_op, v_uid, 'report_done', v_result);
end;
$$;

-- The current leader of the task's team checks reported work — never their
-- own. Recorded; the office still gives the final approval.
create or replace function wp_leader_check(p_op uuid, p_task uuid, p_note text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_prev jsonb;
  t wp_tasks;
  v_result jsonb;
begin
  if v_uid is null or not pr_is_requester() then
    raise exception 'NOT_A_REQUESTER' using errcode = 'P0001';
  end if;
  v_prev := wp_op_prev(p_op, v_uid);
  if v_prev is not null then
    return v_prev;
  end if;
  t := wp_worker_task(p_task);
  if wp_role_on(t.id, v_uid) in ('responsible', 'helper') then
    raise exception 'OWN_WORK' using errcode = 'P0001';
  end if;
  if t.team_id is null or not pr_is_current_leader(t.team_id, v_uid) then
    raise exception 'NOT_LEADER' using errcode = 'P0001';
  end if;
  if t.status <> 'reported_done' then
    raise exception 'BAD_STATE' using errcode = 'P0001';
  end if;
  update wp_tasks set status = 'leader_checked', updated_at = now() where id = t.id;
  perform wp_log(t.owner_id, t.id, null, 'leader_checked', btrim(coalesce(p_note, '')), '{}'::jsonb);
  v_result := jsonb_build_object('task', wp_task_doc(t.id, v_uid, false));
  return wp_op_save(p_op, v_uid, 'leader_check', v_result);
end;
$$;

-- A current team leader proposes a task: it arrives as a DRAFT for the
-- office, which edits, publishes or cancels it. Never live by itself.
create or replace function wp_propose_task(p_op uuid, p_team uuid, p_folder uuid, p_work uuid, p_title text, p_details text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_prev jsonb;
  v_owner uuid;
  v_id uuid;
  v_result jsonb;
begin
  if v_uid is null or not pr_is_requester() then
    raise exception 'NOT_A_REQUESTER' using errcode = 'P0001';
  end if;
  v_prev := wp_op_prev(p_op, v_uid);
  if v_prev is not null then
    return v_prev;
  end if;
  v_owner := attendance_data_owner();
  if p_team is null or not pr_is_current_leader(p_team, v_uid)
     or not exists (select 1 from pr_teams tm where tm.id = p_team and tm.owner_id = v_owner) then
    raise exception 'NOT_LEADER' using errcode = 'P0001';
  end if;
  if p_folder is null or not wp_work_valid(v_owner, p_folder, coalesce(p_work, p_folder)) then
    raise exception 'BAD_DESTINATION' using errcode = 'P0001';
  end if;
  if btrim(coalesce(p_title, '')) = '' then
    raise exception 'TITLE_REQUIRED' using errcode = 'P0001';
  end if;
  insert into wp_tasks (owner_id, folder_id, work_folder_id, team_id, title, instructions, proposed_by, created_by)
  values (v_owner, p_folder, coalesce(p_work, p_folder), p_team, btrim(p_title), coalesce(p_details, ''), v_uid, v_uid)
  returning id into v_id;
  perform wp_log(v_owner, v_id, null, 'proposed', '', '{}'::jsonb);
  v_result := jsonb_build_object('task_id', v_id);
  return wp_op_save(p_op, v_uid, 'propose_task', v_result);
end;
$$;

-- Links an uploaded photo to the task (and optionally a blocker or a
-- report). Upload first, then attach: the row only ever points at a real object.
create or replace function wp_attach_photo(p_op uuid, p_task uuid, p_blocker uuid, p_event bigint, p_path text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_prev jsonb;
  t wp_tasks;
  v_id uuid;
  v_result jsonb;
begin
  if v_uid is null or not pr_is_requester() then
    raise exception 'NOT_A_REQUESTER' using errcode = 'P0001';
  end if;
  v_prev := wp_op_prev(p_op, v_uid);
  if v_prev is not null then
    return v_prev;
  end if;
  t := wp_worker_task(p_task);
  if (p_blocker is not null and not exists (select 1 from wp_blockers b where b.id = p_blocker and b.task_id = t.id))
     or (p_event is not null and not exists (select 1 from wp_events e where e.id = p_event and e.task_id = t.id)) then
    raise exception 'BAD_LINK' using errcode = 'P0001';
  end if;
  if p_path is null or left(p_path, length(v_uid::text || '/' || t.id::text || '/')) <> v_uid::text || '/' || t.id::text || '/' then
    raise exception 'BAD_PATH' using errcode = 'P0001';
  end if;
  if not exists (select 1 from storage.objects o where o.bucket_id = 'task-photos' and o.name = p_path) then
    raise exception 'PHOTO_NOT_UPLOADED' using errcode = 'P0001';
  end if;
  insert into wp_photos (owner_id, task_id, blocker_id, event_id, storage_path, uploaded_by)
  values (t.owner_id, t.id, p_blocker, p_event, p_path, v_uid)
  on conflict (storage_path) do nothing;
  select id into v_id from wp_photos where storage_path = p_path;
  perform wp_log(t.owner_id, t.id, null, 'photo_attached', '', jsonb_build_object('photo_id', v_id));
  v_result := jsonb_build_object('photo_id', v_id);
  return wp_op_save(p_op, v_uid, 'attach_photo', v_result);
end;
$$;

revoke all on function wp_my_work() from public, anon;
grant execute on function wp_my_work() to authenticated;
revoke all on function wp_my_notes() from public, anon;
grant execute on function wp_my_notes() to authenticated;
revoke all on function wp_acknowledge(uuid, uuid, integer) from public, anon;
grant execute on function wp_acknowledge(uuid, uuid, integer) to authenticated;
revoke all on function wp_start_work(uuid, uuid) from public, anon;
grant execute on function wp_start_work(uuid, uuid) to authenticated;
revoke all on function wp_report_progress(uuid, uuid, text) from public, anon;
grant execute on function wp_report_progress(uuid, uuid, text) to authenticated;
revoke all on function wp_report_blocker(uuid, uuid, text, text, uuid) from public, anon;
grant execute on function wp_report_blocker(uuid, uuid, text, text, uuid) to authenticated;
revoke all on function wp_report_done(uuid, uuid, text) from public, anon;
grant execute on function wp_report_done(uuid, uuid, text) to authenticated;
revoke all on function wp_leader_check(uuid, uuid, text) from public, anon;
grant execute on function wp_leader_check(uuid, uuid, text) to authenticated;
revoke all on function wp_propose_task(uuid, uuid, uuid, uuid, text, text) from public, anon;
grant execute on function wp_propose_task(uuid, uuid, uuid, uuid, text, text) to authenticated;
revoke all on function wp_attach_photo(uuid, uuid, uuid, bigint, text) from public, anon;
grant execute on function wp_attach_photo(uuid, uuid, uuid, bigint, text) to authenticated;

-- ════ §6 Office: planning ═════════════════════════════════════════════

-- Where a task can go: open top-level projects and their open Additional Works.
create or replace function wp_office_destinations() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'folder_id', f.id, 'name', f.name,
           'works', (select coalesce(jsonb_agg(jsonb_build_object('work_id', c.id, 'name', c.name) order by lower(c.name)), '[]'::jsonb)
                       from folders c
                      where c.parent_folder_id = f.id and c.completed_at is null and coalesce(btrim(c.name), '') <> ''))
         order by lower(f.name)), '[]'::jsonb)
    from folders f
   where pr_is_office() and f.owner_id = data_owner_id() and f.parent_folder_id is null
     and f.completed_at is null and coalesce(btrim(f.name), '') <> ''
$$;

create or replace function wp_office_meetings() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', m.id, 'title', m.title, 'held_on', m.held_on, 'current_version', m.current_version,
           'draft_count', (select count(*) from wp_tasks t where t.meeting_id = m.id and t.status = 'draft'),
           'task_count', (select count(*) from wp_tasks t where t.meeting_id = m.id and t.status <> 'cancelled'),
           'updated_at', m.updated_at)
         order by m.held_on desc, m.created_at desc), '[]'::jsonb)
    from wp_meetings m
   where pr_is_office() and m.owner_id = data_owner_id()
$$;

create or replace function wp_office_meeting(p_meeting uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_doc jsonb;
begin
  if not pr_is_office() then
    raise exception 'OFFICE_ONLY' using errcode = 'P0001';
  end if;
  select jsonb_build_object(
           'id', m.id, 'title', m.title, 'held_on', m.held_on, 'original_notes', m.original_notes,
           'current_version', m.current_version,
           'versions', (select coalesce(jsonb_agg(jsonb_build_object(
                          'version', v.version, 'shared_notes', v.shared_notes, 'change_note', v.change_note,
                          'published_at', v.published_at, 'published_by', pr_person_name(v.published_by),
                          'recipients', (select coalesce(jsonb_agg(jsonb_build_object('id', r.person_id, 'name', pr_person_name(r.person_id))
                                                                   order by lower(pr_person_name(r.person_id))), '[]'::jsonb)
                                           from wp_note_recipients r where r.version_id = v.id))
                          order by v.version desc), '[]'::jsonb)
                          from wp_meeting_versions v where v.meeting_id = m.id),
           'tasks', (select coalesce(jsonb_agg(wp_task_doc(t.id, auth.uid(), true) order by t.created_at), '[]'::jsonb)
                       from wp_tasks t where t.meeting_id = m.id))
    into v_doc
    from wp_meetings m
   where m.id = p_meeting and m.owner_id = data_owner_id();
  if v_doc is null then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  return v_doc;
end;
$$;

-- Create (null id) or edit a meeting. The original notes stay office-only.
create or replace function wp_office_save_meeting(p_meeting uuid, p_title text, p_held_on date, p_original_notes text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid := data_owner_id();
  v_id uuid;
begin
  if not pr_is_office() then
    raise exception 'OFFICE_ONLY' using errcode = 'P0001';
  end if;
  if btrim(coalesce(p_title, '')) = '' then
    raise exception 'TITLE_REQUIRED' using errcode = 'P0001';
  end if;
  if p_held_on is null then
    raise exception 'BAD_DATES' using errcode = 'P0001';
  end if;
  if p_meeting is null then
    insert into wp_meetings (owner_id, title, held_on, original_notes, created_by)
    values (v_owner, btrim(p_title), p_held_on, coalesce(p_original_notes, ''), auth.uid())
    returning id into v_id;
    perform wp_log(v_owner, null, v_id, 'meeting_created', '', '{}'::jsonb);
  else
    update wp_meetings
       set title = btrim(p_title), held_on = p_held_on, original_notes = coalesce(p_original_notes, ''), updated_at = now()
     where id = p_meeting and owner_id = v_owner
    returning id into v_id;
    if v_id is null then
      raise exception 'NOT_FOUND' using errcode = 'P0001';
    end if;
  end if;
  return jsonb_build_object('meeting_id', v_id);
end;
$$;

-- Create (null id = a draft) or edit a task — a FULL save of every field.
-- A published task keeps its project/work and a responsible person; marking
-- the change important raises its version (everyone must acknowledge again).
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
  v_flags jsonb;
  v_important boolean;
  v_revised boolean;
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
  exception when others then
    raise exception 'BAD_OPERATION' using errcode = 'P0001';
  end;
  v_title := btrim(coalesce(p_data ->> 'title', ''));
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
    values (v_owner, v_meeting, v_folder, v_work, v_team, v_title, coalesce(p_data ->> 'instructions', ''),
            v_start, v_end, coalesce(p_data ->> 'source_passage', ''), v_flags, v_uid)
    returning id into v_id;
    perform wp_log(v_owner, v_id, v_meeting, 'drafted', '', '{}'::jsonb);
  else
    v_id := t.id;
    v_revised := t.status <> 'draft' and v_important;
    update wp_tasks
       set meeting_id = v_meeting, folder_id = v_folder, work_folder_id = v_work, team_id = v_team, title = v_title,
           instructions = coalesce(p_data ->> 'instructions', ''), planned_start = v_start, planned_end = v_end,
           source_passage = coalesce(p_data ->> 'source_passage', ''), office_flags = v_flags,
           version = case when v_revised then t.version + 1 else t.version end,
           version_at = case when v_revised then now() else t.version_at end,
           updated_at = now()
     where id = v_id;
    perform wp_log(v_owner, v_id, v_meeting, case when v_revised then 'revised' else 'edited' end,
                   btrim(coalesce(p_data ->> 'change_note', '')), '{}'::jsonb);
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

-- Publish: the listed draft tasks (or every draft of the meeting) become
-- Not started at version 1, and — for a meeting — a new shared-notes
-- version goes to the chosen recipients (default: everyone assigned a
-- published task of that meeting). Already-published tasks are skipped.
create or replace function wp_office_publish(p_meeting uuid, p_tasks uuid[], p_shared_notes text, p_recipients uuid[], p_change_note text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid := data_owner_id();
  m wp_meetings;
  t wp_tasks;
  v_ids uuid[];
  v_id uuid;
  v_count int := 0;
  v_version int;
  v_version_id uuid;
begin
  if not pr_is_office() then
    raise exception 'OFFICE_ONLY' using errcode = 'P0001';
  end if;
  if p_meeting is null and coalesce(cardinality(p_tasks), 0) = 0 then
    raise exception 'BAD_OPERATION' using errcode = 'P0001';
  end if;
  if p_meeting is not null then
    select * into m from wp_meetings where id = p_meeting and owner_id = v_owner for no key update;
    if not found then
      raise exception 'NOT_FOUND' using errcode = 'P0001';
    end if;
  end if;
  if p_recipients is not null then
    foreach v_id in array p_recipients loop
      if not wp_person_ok(v_id, v_owner) then
        raise exception 'BAD_PERSON' using errcode = 'P0001';
      end if;
    end loop;
  end if;

  -- Explicit lists are locked in id order, so two publishes cannot deadlock.
  v_ids := case when p_tasks is null
                then array(select x.id from wp_tasks x
                            where x.meeting_id = p_meeting and x.owner_id = v_owner and x.status = 'draft'
                            order by x.created_at)
                else array(select distinct u from unnest(p_tasks) u order by u) end;
  foreach v_id in array v_ids loop
    select * into t from wp_tasks where id = v_id and owner_id = v_owner for no key update;
    if not found then
      raise exception 'NOT_FOUND' using errcode = 'P0001';
    end if;
    if p_meeting is not null and t.meeting_id is distinct from p_meeting then
      raise exception 'BAD_OPERATION' using errcode = 'P0001';
    end if;
    continue when t.status <> 'draft';
    if not exists (select 1 from wp_task_people p
                    where p.task_id = t.id and p.role = 'responsible' and p.removed_at is null) then
      raise exception 'NO_RESPONSIBLE' using errcode = 'P0001';
    end if;
    if not wp_work_valid(v_owner, t.folder_id, t.work_folder_id) then
      raise exception 'BAD_DESTINATION' using errcode = 'P0001';
    end if;
    update wp_tasks
       set status = 'not_started', version = 1, version_at = now(), published_at = now(), updated_at = now()
     where id = t.id;
    perform wp_log(v_owner, t.id, t.meeting_id, 'published', '', '{}'::jsonb);
    v_count := v_count + 1;
  end loop;

  if p_meeting is not null then
    v_version := m.current_version + 1;
    insert into wp_meeting_versions (owner_id, meeting_id, version, shared_notes, change_note, published_by)
    values (v_owner, p_meeting, v_version, coalesce(p_shared_notes, ''), btrim(coalesce(p_change_note, '')), auth.uid())
    returning id into v_version_id;
    insert into wp_note_recipients (owner_id, version_id, person_id)
    select distinct v_owner, v_version_id, x.person_id
      from (select unnest(p_recipients) as person_id
             where p_recipients is not null
            union
            select p.person_id
              from wp_task_people p join wp_tasks k on k.id = p.task_id
             where p_recipients is null and k.meeting_id = p_meeting
               and k.status not in ('draft', 'cancelled') and p.removed_at is null) x;
    update wp_meetings set current_version = v_version, updated_at = now() where id = p_meeting;
    perform wp_log(v_owner, null, p_meeting, 'notes_published', btrim(coalesce(p_change_note, '')),
                   jsonb_build_object('version', v_version));
  end if;
  return jsonb_build_object('published_tasks', v_count, 'meeting_version', v_version);
end;
$$;

-- The board: every task of the company (or one project), drafts included,
-- each flagged blocked / not_acknowledged_24h / overdue for the office lists.
create or replace function wp_office_board(p_folder uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not pr_is_office() then
    raise exception 'OFFICE_ONLY' using errcode = 'P0001';
  end if;
  return (select coalesce(jsonb_agg(wp_task_doc(t.id, auth.uid(), true)
                                    order by t.planned_end nulls last, t.created_at), '[]'::jsonb)
            from wp_tasks t
           where t.owner_id = data_owner_id()
             and (p_folder is null or t.folder_id = p_folder)
             and t.status <> 'cancelled'
             and (t.status <> 'completed' or t.completed_at > now() - interval '30 days'));
end;
$$;

create or replace function wp_office_task(p_task uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not pr_is_office() then
    raise exception 'OFFICE_ONLY' using errcode = 'P0001';
  end if;
  if not exists (select 1 from wp_tasks t where t.id = p_task and t.owner_id = data_owner_id()) then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  return wp_task_doc(p_task, auth.uid(), true);
end;
$$;

revoke all on function wp_office_destinations() from public, anon;
grant execute on function wp_office_destinations() to authenticated;
revoke all on function wp_office_meetings() from public, anon;
grant execute on function wp_office_meetings() to authenticated;
revoke all on function wp_office_meeting(uuid) from public, anon;
grant execute on function wp_office_meeting(uuid) to authenticated;
revoke all on function wp_office_save_meeting(uuid, text, date, text) from public, anon;
grant execute on function wp_office_save_meeting(uuid, text, date, text) to authenticated;
revoke all on function wp_office_save_task(uuid, jsonb) from public, anon;
grant execute on function wp_office_save_task(uuid, jsonb) to authenticated;
revoke all on function wp_office_publish(uuid, uuid[], text, uuid[], text) from public, anon;
grant execute on function wp_office_publish(uuid, uuid[], text, uuid[], text) to authenticated;
revoke all on function wp_office_board(uuid) from public, anon;
grant execute on function wp_office_board(uuid) to authenticated;
revoke all on function wp_office_task(uuid) from public, anon;
grant execute on function wp_office_task(uuid) to authenticated;

-- ════ §7 Office: decisions (online only) ══════════════════════════════

-- Only the office clears a blocker — after checking the materials, tool or
-- preparation really are ready for THIS task (spec §8). A note is required.
create or replace function wp_office_clear_blocker(p_blocker uuid, p_note text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  b wp_blockers;
begin
  if not pr_is_office() then
    raise exception 'OFFICE_ONLY' using errcode = 'P0001';
  end if;
  if btrim(coalesce(p_note, '')) = '' then
    raise exception 'NOTE_REQUIRED' using errcode = 'P0001';
  end if;
  select * into b from wp_blockers where id = p_blocker and owner_id = data_owner_id() for no key update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  if b.cleared_at is not null then
    raise exception 'BAD_STATE' using errcode = 'P0001';
  end if;
  update wp_blockers set cleared_by = auth.uid(), cleared_at = now(), clear_note = btrim(p_note) where id = b.id;
  perform wp_log(b.owner_id, b.task_id, null, 'blocker_cleared', btrim(p_note), jsonb_build_object('blocker_id', b.id));
  return jsonb_build_object('task', wp_task_doc(b.task_id, auth.uid(), true));
end;
$$;

-- Final approval: from Reported done or Leader checked, never while blocked.
create or replace function wp_office_approve(p_task uuid, p_note text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  t wp_tasks;
begin
  t := wp_office_task_row(p_task);
  if t.status not in ('reported_done', 'leader_checked') then
    raise exception 'BAD_STATE' using errcode = 'P0001';
  end if;
  if wp_task_blocked(t.id) then
    raise exception 'TASK_BLOCKED' using errcode = 'P0001';
  end if;
  update wp_tasks set status = 'completed', completed_at = now(), sent_back = false, updated_at = now() where id = t.id;
  perform wp_log(t.owner_id, t.id, null, 'approved', btrim(coalesce(p_note, '')), '{}'::jsonb);
  return jsonb_build_object('task', wp_task_doc(t.id, auth.uid(), true));
end;
$$;

-- Reject a done report: back to In progress, marked Sent back; the leader's
-- check is cleared (it was for the rejected report). History keeps both.
create or replace function wp_office_send_back(p_task uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  t wp_tasks;
begin
  t := wp_office_task_row(p_task);
  if btrim(coalesce(p_reason, '')) = '' then
    raise exception 'REASON_REQUIRED' using errcode = 'P0001';
  end if;
  if t.status not in ('reported_done', 'leader_checked') then
    raise exception 'BAD_STATE' using errcode = 'P0001';
  end if;
  update wp_tasks set status = 'in_progress', sent_back = true, updated_at = now() where id = t.id;
  perform wp_log(t.owner_id, t.id, null, 'sent_back', btrim(p_reason), '{}'::jsonb);
  return jsonb_build_object('task', wp_task_doc(t.id, auth.uid(), true));
end;
$$;

-- Reopen a Completed task: same effect as Send back. Tasks that wait for it
-- become Blocked again automatically (Blocked is derived).
create or replace function wp_office_reopen(p_task uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  t wp_tasks;
begin
  t := wp_office_task_row(p_task);
  if btrim(coalesce(p_reason, '')) = '' then
    raise exception 'REASON_REQUIRED' using errcode = 'P0001';
  end if;
  if t.status <> 'completed' then
    raise exception 'BAD_STATE' using errcode = 'P0001';
  end if;
  update wp_tasks set status = 'in_progress', sent_back = true, completed_at = null, updated_at = now() where id = t.id;
  perform wp_log(t.owner_id, t.id, null, 'reopened', btrim(p_reason), '{}'::jsonb);
  return jsonb_build_object('task', wp_task_doc(t.id, auth.uid(), true));
end;
$$;

-- Cancel a draft (e.g. a declined proposal) or a live task, with a reason.
-- Refused while another task still waits for it — unlink that first.
create or replace function wp_office_cancel(p_task uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  t wp_tasks;
begin
  t := wp_office_task_row(p_task);
  if btrim(coalesce(p_reason, '')) = '' then
    raise exception 'REASON_REQUIRED' using errcode = 'P0001';
  end if;
  if t.status in ('completed', 'cancelled') then
    raise exception 'BAD_STATE' using errcode = 'P0001';
  end if;
  -- Same per-project key wp_office_save_task takes before linking tasks.
  perform pg_advisory_xact_lock(hashtext('wp_deps:' || t.folder_id::text));
  if exists (select 1 from wp_dependencies x join wp_tasks d on d.id = x.task_id
              where x.depends_on = t.id and d.status <> 'cancelled') then
    raise exception 'HAS_DEPENDENTS' using errcode = 'P0001';
  end if;
  update wp_tasks set status = 'cancelled', updated_at = now() where id = t.id;
  perform wp_log(t.owner_id, t.id, null, 'cancelled', btrim(p_reason), '{}'::jsonb);
  return jsonb_build_object('task', wp_task_doc(t.id, auth.uid(), true));
end;
$$;

revoke all on function wp_office_clear_blocker(uuid, text) from public, anon;
grant execute on function wp_office_clear_blocker(uuid, text) to authenticated;
revoke all on function wp_office_approve(uuid, text) from public, anon;
grant execute on function wp_office_approve(uuid, text) to authenticated;
revoke all on function wp_office_send_back(uuid, text) from public, anon;
grant execute on function wp_office_send_back(uuid, text) to authenticated;
revoke all on function wp_office_reopen(uuid, text) from public, anon;
grant execute on function wp_office_reopen(uuid, text) to authenticated;
revoke all on function wp_office_cancel(uuid, text) from public, anon;
grant execute on function wp_office_cancel(uuid, text) to authenticated;
