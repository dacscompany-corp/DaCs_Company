-- 0057_labor_contract_category.sql
-- OUT SOURCE contracts for PROJECT CONTROL. They reuse the SAME `labor_contracts`
-- table as in-house labor contracts, distinguished by a `category` column
-- ('labor' | 'outsource'). This mirrors migration 0016, which did exactly the
-- same thing to `pm_labor_contracts` for the Project Management module.
--
-- An outsource contract is a capped agreement with an OUTSIDE VENDOR (supply &
-- install: aluminum windows, steel fabrication, vendor tiling crew). It is drawn
-- down the same way a labor contract is — by `payroll` rows carrying
-- `contract_id` — so NO payroll schema change is needed here.
--
-- MONEY MODEL: unchanged. Those payroll pesos land in the Labor bucket exactly as
-- before; `Labor = direct + (liability - liabilityIndirect)` is untouched, and
-- Out Source is NOT a fourth bucket. The in-house vs outsourced split shown in the
-- Worker Tracker is DERIVED at read time (a payroll row is outsourced when its
-- contract's category is 'outsource') — deliberately not stamped on the payroll
-- row, so recategorising a contract reclassifies its history with no backfill.
--
-- See migration 0014 for the base table, 0016 for the PM twin.
-- Owner/staff only, same as the base table's RLS — no new policy needed.

alter table labor_contracts
  add column if not exists category text default 'labor';   -- 'labor' | 'outsource'

-- Existing rows are all in-house labor contracts; backfill any nulls just in case.
update labor_contracts set category = 'labor' where category is null;

create index if not exists labor_contracts_category_idx
  on labor_contracts(folder_id, category);
