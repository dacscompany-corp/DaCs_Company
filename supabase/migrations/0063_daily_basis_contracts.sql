-- 0063_daily_basis_contracts.sql
-- DAILY BASIS contracts for BOTH contract systems: Project Control's
-- `labor_contracts` (folder-scoped, migration 0014) and Project Management's
-- `pm_labor_contracts` (project-scoped, migration 0015).
--
-- Every contract until now has been a CAPPED agreement: `agreed_amount` is the
-- ceiling, payments draw it down, and the card counts backwards to zero. That
-- is wrong for a worker hired by the DAY — there is no total agreed up front,
-- only "keep paying them per day until the work is done". Forcing such a hire
-- into a cap meant inventing a number, then raising it every time it was hit.
--
-- A daily-basis contract is the SAME contract row with NO ceiling:
--
--     pay_basis = 'daily'   ->  uncapped; agreed_amount is meaningless (0)
--     pay_basis = 'fixed'   ->  capped, exactly as before (the default)
--
-- MONEY MODEL: unchanged, and deliberately so. A daily contract is still drawn
-- down by `payroll` rows carrying `contract_id` (PC) or by weeklyBills labor
-- entries carrying `contractId` (PM) — the same paths, so no drawdown or
-- payroll schema change is needed. Its pesos land in the Labor bucket as before:
--
--     Labor = direct + (liability - liabilityIndirect)      <- untouched
--
-- `pay_basis` carries NO pesos: it is a flag saying whether a ceiling exists, so
-- it can never add, move or double-count one. What it DOES change is what the
-- card may claim: with no cap there is no "remaining", no percentage and no
-- "over agreed" — a paid-to-date total is the only honest figure, and §O of
-- tests/money-math.test.js fences that a daily contract never reports one.
--
-- NOT A THIRD CATEGORY, and not a pay type. `category` stays
-- 'labor' | 'outsource' (migrations 0016 / 0057) and `pay_type` stays
-- 'pakyaw' | 'inhouse'. Daily is a SHAPE, the same way a lumpsum is — it sits
-- alongside `works` (migration 0062) rather than inside either of those
-- columns, so every existing list filter, segment tab and `.find(x => x.id ===
-- id)` lookup keeps working untouched.
--
-- The three shapes the contract modal offers are read as:
--     works non-empty        -> Lumpsum   (one cap, many works)
--     pay_basis = 'daily'    -> Daily     (no cap)
--     otherwise              -> Single job (one cap, one work)
-- They are mutually exclusive in the UI; a daily contract saves an empty works
-- list, and a lumpsum saves pay_basis 'fixed'.
--
-- An unapplied migration reads as undefined -> 'fixed' -> the old capped
-- behaviour, exactly as before.
--
-- Owner/staff only, same as both base tables' RLS — no new policy needed.

alter table labor_contracts
  add column if not exists pay_basis text not null default 'fixed';

alter table pm_labor_contracts
  add column if not exists pay_basis text not null default 'fixed';

-- Only the two shapes exist. A typo'd value would otherwise read as "not
-- daily" and silently give an uncapped hire a cap of zero.
alter table labor_contracts
  drop constraint if exists labor_contracts_pay_basis_chk;
alter table labor_contracts
  add constraint labor_contracts_pay_basis_chk check (pay_basis in ('fixed', 'daily'));

alter table pm_labor_contracts
  drop constraint if exists pm_labor_contracts_pay_basis_chk;
alter table pm_labor_contracts
  add constraint pm_labor_contracts_pay_basis_chk check (pay_basis in ('fixed', 'daily'));

-- Existing rows are all capped agreements; backfill any nulls so the readers
-- never have to tell null from 'fixed'.
update labor_contracts    set pay_basis = 'fixed' where pay_basis is null;
update pm_labor_contracts set pay_basis = 'fixed' where pay_basis is null;
