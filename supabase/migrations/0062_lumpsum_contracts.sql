-- 0062_lumpsum_contracts.sql
-- LUMPSUM contracts for BOTH contract systems: Project Control's
-- `labor_contracts` (folder-scoped, migration 0014) and Project Management's
-- `pm_labor_contracts` (project-scoped, migration 0015).
--
-- A lumpsum contract is ONE capped agreement covering SEVERAL works. Today a
-- worker hired for five jobs holds FIVE contract rows, so every payment must be
-- tagged to one specific job and a single 23,000 handover has to be split five
-- ways. A lumpsum is one row at 200,000 that simply LISTS its five works, paid
-- by a single payment stream — one tag, no splitting.
--
-- `works` is a jsonb ARRAY OF STRINGS — work names only, no amounts:
--     ["Plumbing Works", "Owner Supply", "Carpentry Works"]
--
-- MONEY MODEL: unchanged, and deliberately so. A lumpsum is still one capped
-- contract drawn down by `payroll` rows carrying `contract_id` (PC) or by
-- weeklyBills labor entries carrying `contractId` (PM) — the exact same paths,
-- so NO drawdown or payroll schema change is needed here. Its pesos land in the
-- Labor bucket as before:
--
--     Labor = direct + (liability - liabilityIndirect)      <- untouched
--
-- `works` carries NO pesos: it is a list of names, so it can never add, move or
-- double-count a peso. Five jobs totalling 200,000 and one lumpsum of 200,000
-- must produce the IDENTICAL agreed / paid / remaining — §M of
-- tests/money-math.test.js fences that.
--
-- NOT A THIRD CATEGORY. `category` stays 'labor' | 'outsource' (migrations
-- 0016 / 0057). A lumpsum is a SHAPE a contract of either category can take,
-- and a NON-EMPTY `works` array is the whole discriminator — no second flag to
-- drift out of sync with it. Keeping it out of `category` is what lets every
-- existing list filter, segment tab and `.find(x => x.id === id)` lookup keep
-- working untouched.
--
-- An unapplied migration reads as undefined → an empty works list → the old
-- single-job behaviour, exactly as before.
--
-- Owner/staff only, same as both base tables' RLS — no new policy needed.

alter table labor_contracts
  add column if not exists works jsonb default '[]'::jsonb;

alter table pm_labor_contracts
  add column if not exists works jsonb default '[]'::jsonb;

-- Existing rows are all single-job contracts; backfill any nulls so the readers
-- never have to tell null from "no works".
update labor_contracts    set works = '[]'::jsonb where works is null;
update pm_labor_contracts set works = '[]'::jsonb where works is null;
