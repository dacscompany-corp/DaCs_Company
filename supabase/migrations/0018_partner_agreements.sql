-- ════════════════════════════════════════════════════════════════════
-- PER-PROJECT PARTNER AGREEMENTS
-- A partner must read + sign each project's Terms & Conditions before viewing
-- that project's information. Acceptance (signature, image URL, date, IP) is
-- stored per project + partner. jsonb-blob subtable (like milestones): all doc
-- fields live in `data`; only id / project_id / timestamps are real columns.
-- Doc id = the partner's uid, so one row per partner per project.
-- Idempotent — safe to re-run.
-- ════════════════════════════════════════════════════════════════════

-- The admin-authored Terms & Conditions text shown to the partner for a project.
alter table construction_projects
  add column if not exists partner_terms text;

create table if not exists partner_agreements (
  id         uuid primary key default gen_random_uuid(),
  legacy_id  text unique,
  project_id uuid not null references construction_projects(id) on delete cascade,
  data       jsonb default '{}'::jsonb,   -- includes partnerUid, signature, image url, ip, etc.
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index if not exists partner_agreements_project_idx on partner_agreements(project_id);

alter table partner_agreements enable row level security;

drop policy if exists partner_agreements_admin on partner_agreements;
create policy partner_agreements_admin on partner_agreements for all
  using (is_owner() or is_staff()) with check (is_owner() or is_staff());

-- The partner/client may read + write their own project's agreement rows.
drop policy if exists partner_agreements_client on partner_agreements;
create policy partner_agreements_client on partner_agreements for all
  using (cproj_client_can_read(project_id))
  with check (cproj_client_can_read(project_id));

-- Realtime
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'partner_agreements'
  ) then
    alter publication supabase_realtime add table public.partner_agreements;
  end if;
end $$;
