-- 0024_additional_works.sql
-- Additional Works: extra scope added to a project after the original contract
-- (a contract extension). Modeled as a real CHILD FOLDER nested under the
-- parent project (parent_folder_id) so it gets its own contract amount
-- (folder_budgets) and its own Labor/Material/Billing Periods tracking for
-- free via the existing folder machinery. `additional_works` below is just the
-- priced BOQ breakdown detail (categories/line items/discount) backing that
-- child folder's contract amount — one row per child folder.

alter table folders add column if not exists parent_folder_id uuid references folders(id) on delete cascade;
create index if not exists folders_parent_idx on folders(parent_folder_id);

create table if not exists additional_works (
  id           uuid primary key default gen_random_uuid(),
  owner_id     uuid not null references auth.users(id) on delete cascade,
  folder_id    uuid references folders(id) on delete cascade,   -- the CHILD folder this breakdown prices
  title        text,                            -- e.g. "Additional Works Rev. 1"
  work_date    date,
  categories   jsonb default '[]'::jsonb,        -- [{ label, items:[{description,qty,unit,materialCost,laborCost,total}] }]
  discount     numeric default 0,
  notes        text,
  created_at   timestamptz default now(),
  updated_at   timestamptz default now()
);
create index if not exists additional_works_owner_idx  on additional_works(owner_id);
create index if not exists additional_works_folder_idx on additional_works(folder_id);

alter table additional_works enable row level security;

-- Owner/staff full access; no client policy (admin-only feature), matching labor_contracts.
drop policy if exists aw_admin on additional_works;
create policy aw_admin on additional_works for all
  using (is_owner() or is_staff()) with check (is_owner() or is_staff());
