-- 0014_labor_contracts.sql
-- Labor Contracts (pakyaw & in-house capped pay): an agreed capped amount for a
-- worker's job on a project (folder), paid out over time via payroll rows that
-- draw down against the cap. Admin-only; rides on the existing payroll pipeline.
-- A contract is folder-scoped (spans every monthly billing period inside it);
-- payroll rows link to it via payroll.contract_id, so periods don't matter.

create table if not exists labor_contracts (
  id            uuid primary key default gen_random_uuid(),
  legacy_id     text unique,
  owner_id      uuid not null references auth.users(id) on delete cascade,
  folder_id     uuid references folders(id) on delete cascade,   -- the project the contract belongs to
  worker_name   text,
  scope         text,                                            -- the job, e.g. "Tiling & masonry"
  agreed_amount numeric default 0,                               -- the cap
  pay_type      text default 'pakyaw',                           -- pakyaw | inhouse (label only)
  status        text default 'ongoing',                          -- ongoing | completed
  cap_history   jsonb default '[]'::jsonb,                       -- [{amount, at, note}] when the cap is raised
  notes         text,
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);
create index if not exists labor_contracts_owner_idx  on labor_contracts(owner_id);
create index if not exists labor_contracts_folder_idx on labor_contracts(folder_id);

-- Drawdowns: payroll rows optionally tied to a contract.
alter table payroll add column if not exists contract_id   uuid references labor_contracts(id) on delete set null;
alter table payroll add column if not exists pay_milestone text;   -- advance | progress | final (optional)
create index if not exists payroll_contract_idx on payroll(contract_id);

alter table labor_contracts enable row level security;

-- Owner/staff full access; no client policy (admin-only feature), matching payroll/expenses.
drop policy if exists lc_admin on labor_contracts;
create policy lc_admin on labor_contracts for all
  using (is_owner() or is_staff()) with check (is_owner() or is_staff());
