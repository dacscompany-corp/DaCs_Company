-- 0015_pm_labor_contracts.sql
-- Labor contracts (pakyaw / in-house capped pay) for the PROJECT MANAGEMENT module.
-- Separate from the Project-Control labor_contracts (folder-scoped) because PM uses
-- a different data model: contracts are scoped to a constructionProject and draw down
-- from the Daily Expenses "Labor" line items stored in weeklyBills.entries[]
-- (each labor line carries an optional contractId — no schema change needed there,
-- since weeklyBills.entries is JSON). Admin-only (owner/staff).

create table if not exists pm_labor_contracts (
  id            uuid primary key default gen_random_uuid(),
  legacy_id     text unique,
  project_id    uuid not null references construction_projects(id) on delete cascade,
  worker_name   text,
  scope         text,                                 -- the job, e.g. "Tiling & masonry"
  agreed_amount numeric default 0,                    -- the cap
  pay_type      text default 'pakyaw',                -- pakyaw | inhouse (label only)
  status        text default 'ongoing',               -- ongoing | completed
  cap_history   jsonb default '[]'::jsonb,            -- [{amount, at, note}] when the cap is raised
  notes         text,
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);
create index if not exists pm_labor_contracts_project_idx on pm_labor_contracts(project_id);

alter table pm_labor_contracts enable row level security;

-- Owner/staff full access; no client policy (admin-only feature), matching the other
-- construction PM subtables (e.g. revolving_fund_requests).
drop policy if exists pm_lc_admin on pm_labor_contracts;
create policy pm_lc_admin on pm_labor_contracts for all
  using (is_owner() or is_staff()) with check (is_owner() or is_staff());
