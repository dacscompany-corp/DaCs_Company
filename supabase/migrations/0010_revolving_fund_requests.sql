-- 0010_revolving_fund_requests.sql
-- Repurposes the "Revolving Fund" feature into a weekly fund-collection tracker:
-- one row per week for the fund the admin collects from the partner, with a
-- received flag. Admin-only (owner/staff); not exposed to clients.

create table if not exists revolving_fund_requests (
  id          uuid primary key default gen_random_uuid(),
  legacy_id   text unique,
  project_id  uuid not null references construction_projects(id) on delete cascade,
  week_start  text,                 -- Sunday of the week, YYYY-MM-DD
  amount      numeric,              -- amount to collect from the partner
  received    boolean default false,
  received_at timestamptz,          -- set when the admin marks it received
  notes       text,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);
create index if not exists rf_requests_project_idx on revolving_fund_requests(project_id);

alter table revolving_fund_requests enable row level security;

-- Owner/staff full access; no client policy (admin-only feature).
create policy rf_requests_admin on revolving_fund_requests for all
  using (is_owner() or is_staff()) with check (is_owner() or is_staff());
