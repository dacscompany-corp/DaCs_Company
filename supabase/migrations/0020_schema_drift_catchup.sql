-- ════════════════════════════════════════════════════════════════════
-- 0020_schema_drift_catchup.sql
--
-- The live database (hqbgduyonlbbsvjuapre) was patched by hand in the
-- Supabase SQL editor beyond the checked-in migrations, so 0001–0019
-- could no longer rebuild a working database from scratch. This
-- migration captures that drift, verified 2026-07-03 against the live
-- schema via PostgREST introspection.
--
-- Everything here is idempotent (IF NOT EXISTS / OR REPLACE / DROP
-- POLICY IF EXISTS), so it is safe to run on the live database (no-ops
-- where things already exist) AND on a fresh database after 0019.
--
-- Drift captured:
--   1. profiles           — 12 columns (client terms e-sign, agreement
--                           signature capture, is_partner flag)
--   2. construction_projects — management_fee_pct + partner terms text/PDF
--   3. weekly_bills       — entries jsonb (daily expense lines incl.
--                           contractId drawdown links), combined,
--                           direct_cost_total
--   4. partner_agreements — whole table (jsonbData subcollection
--                           constructionProjects/partnerAgreements)
--   5. partner RLS        — 0018 added partner_email but no policy let a
--                           partner's login read the project or its
--                           subtables; read-only partner policies added
--                           here (kept separate from cproj_client_can_read,
--                           which also gates procurement UPDATEs)
--   6. realtime           — add any missing tables to the publication
-- ════════════════════════════════════════════════════════════════════

-- ── 1. profiles: client terms e-sign + agreement signature capture ──
alter table profiles
  add column if not exists agreement_signature       text,
  add column if not exists agreement_signature_image text,
  add column if not exists agreement_ip              text,
  add column if not exists is_partner                boolean,
  add column if not exists terms_accepted            boolean,
  add column if not exists terms_accepted_at         timestamptz,
  add column if not exists terms_snapshot            text,
  add column if not exists terms_pdf_url             text,
  add column if not exists terms_pdf_name            text,
  add column if not exists terms_signature           text,
  add column if not exists terms_signature_image     text,
  add column if not exists terms_ip                  text;

-- ── 2. construction_projects: per-project fee + partner terms ───────
alter table construction_projects
  add column if not exists management_fee_pct     numeric,  -- editable per-project rate; app defaults to 15 when null
  add column if not exists partner_terms          text,
  add column if not exists partner_terms_pdf_url  text,
  add column if not exists partner_terms_pdf_name text;

-- ── 3. weekly_bills: daily-expense lines + combined category ────────
alter table weekly_bills
  add column if not exists entries           jsonb,    -- [{type, details, amount, days?, qty?, unit?, contractId?, receipts?}]
  add column if not exists combined          numeric,  -- "Materials+Labor (supply & install)" portion (materials col includes it)
  add column if not exists direct_cost_total numeric;  -- labor + materials; client portal prefers this field

-- ── 4. partner_agreements (constructionProjects/partnerAgreements) ──
-- jsonbData subcollection: all doc fields live in `data`, like milestones.
create table if not exists partner_agreements (
  id         uuid primary key default gen_random_uuid(),
  legacy_id  text unique,
  project_id uuid not null references construction_projects(id) on delete cascade,
  data       jsonb default '{}'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index if not exists partner_agreements_project_idx on partner_agreements(project_id);

drop trigger if exists partner_agreements_set_updated on partner_agreements;
create trigger partner_agreements_set_updated before update on partner_agreements
  for each row execute function set_updated_at();

alter table partner_agreements enable row level security;

-- ── 5. Partner RLS (read-only mirror of the client's read access) ───
-- Separate function on purpose: cproj_client_can_read() also backs
-- procurement_client_update (an UPDATE policy), and partners must stay
-- read-only. Legacy projects where the partner logs in as client_email
-- keep working through the existing *_client_read policies.
create or replace function cproj_partner_can_read(p uuid)
returns boolean language sql stable as $$
  select exists (select 1 from construction_projects cp
                 where cp.id = p and lower(cp.partner_email) = auth_email())
$$;

drop policy if exists cproj_partner_read on construction_projects;
create policy cproj_partner_read on construction_projects for select
  using (lower(partner_email) = auth_email());

-- partner_agreements: admin full; client + partner read; project member insert
-- (the partner signs via col.add — legacy partners authenticate as client_email,
-- so insert accepts either link)
drop policy if exists pa_admin on partner_agreements;
create policy pa_admin on partner_agreements for all
  using (is_owner() or is_staff()) with check (is_owner() or is_staff());
drop policy if exists pa_client_read on partner_agreements;
create policy pa_client_read on partner_agreements for select
  using (cproj_client_can_read(project_id));
drop policy if exists pa_member_insert on partner_agreements;
create policy pa_member_insert on partner_agreements for insert
  with check (cproj_client_can_read(project_id) or cproj_partner_can_read(project_id));

-- partner SELECT on the construction subtables the portal renders
do $$
declare t text;
begin
  foreach t in array array[
    'weekly_bills','procurement_items','revolving_fund_expenses','revolving_fund_replenishments',
    'revolving_fund_requests','revolving_funds','daily_logs','milestones',
    'accomplishment_reports','walkthroughs','partner_agreements'
  ]
  loop
    execute format($f$
      drop policy if exists %1$s_partner_read on %1$I;
      create policy %1$s_partner_read on %1$I for select
        using (cproj_partner_can_read(project_id));
    $f$, t);
  end loop;
end $$;

-- ── 6. Realtime: broadcast any table not yet in the publication ─────
do $$
declare t text;
begin
  for t in
    select tablename from pg_tables
    where schemaname = 'public'
      and tablename not in (
        select tablename from pg_publication_tables where pubname = 'supabase_realtime'
      )
  loop
    execute format('alter publication supabase_realtime add table public.%I', t);
  end loop;
end $$;

-- refresh PostgREST's schema cache so new columns are usable immediately
notify pgrst, 'reload schema';
