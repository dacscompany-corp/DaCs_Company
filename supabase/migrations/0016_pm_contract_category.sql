-- 0016_pm_contract_category.sql
-- Outsource contracts reuse the SAME pm_labor_contracts table as labor contracts,
-- distinguished by a `category` column ('labor' | 'outsource'). An outsource
-- contract draws down from the Daily Expenses "Out Source" line items (entry
-- type 'both') instead of the "Labor" lines, but is otherwise identical
-- (worker/vendor name, scope, agreed cap, pay_type, cap_history, notes).
-- See migration 0015 for the base table. Admin-only (owner/staff).

alter table pm_labor_contracts
  add column if not exists category text default 'labor';   -- 'labor' | 'outsource'

-- Existing rows are all labor contracts; backfill any nulls just in case.
update pm_labor_contracts set category = 'labor' where category is null;

create index if not exists pm_labor_contracts_category_idx
  on pm_labor_contracts(project_id, category);
