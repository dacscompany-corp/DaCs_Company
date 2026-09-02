-- 0060_pm_categories.sql
-- Material categories for PROJECT MANAGEMENT's Daily Expenses.
--
-- WHY A SECOND TABLE, and not the existing `categories`:
-- Project Control and Project Management are two parallel systems in this
-- codebase — two id spaces (folders.id vs construction_projects.id), two
-- flows, two audiences. `categories` (0001) is Project Control's list, and
-- it has grown Project Control's habits: payment methods, one-off items,
-- worker names ("Mark Frias (CEILING MATERIALS AND DRYWALL)"), logistics
-- lines like "Lalamove". Serving that list to PM was tried and rejected —
-- it puts another module's vocabulary in front of a PM admin and makes one
-- team's cleanup break the other team's dropdown. Separate tables keep the
-- two lists free to diverge, which is what actually happens in practice.
--
-- SCOPE: owner, not project. One list for the whole PM module, so a
-- category typed on one job is offered on the next. Deliberately NOT keyed
-- on construction_projects — a per-project list means retyping "Tiling
-- Works" on every new job, and nothing here is project-specific.
--
-- MONEY MODEL: untouched. A category is a LABEL on a materials line, never
-- an amount. Nothing here is summed, allocated or billed, and no bucket in
-- Labor / Material / Overhead changes shape. The category rides inside the
-- existing weekly_bills.entries jsonb (0020) — no column is added there.
--
-- The stored value on an entry is the category's NAME, not this row's id,
-- matching how Project Control stores its own. An id would go stale the
-- moment a category is renamed or deleted, and the string is what the eye
-- reads on a saved bill.

create table if not exists pm_categories (
  id         uuid primary key default gen_random_uuid(),
  legacy_id  text unique,                                    -- shim compat, as elsewhere
  owner_id   uuid not null references auth.users(id) on delete cascade,
  name       text not null,
  created_at timestamptz default now()
);

create index if not exists pm_categories_owner_idx on pm_categories(owner_id);

-- One name per owner. The UI checks for duplicates too, but two admins
-- adding "Tiling Works" at the same moment would both pass that check —
-- only the database can actually make it true.
create unique index if not exists pm_categories_owner_name_idx
  on pm_categories(owner_id, lower(name));

-- Same rule as `categories` (0002): the owner, plus their staff.
-- A category name is not money, so staff are not locked out the way
-- *_budgets locks them out.
alter table pm_categories enable row level security;

drop policy if exists pm_categories_rw on pm_categories;
create policy pm_categories_rw on pm_categories for all
  using (can_access(owner_id)) with check (can_access(owner_id));
