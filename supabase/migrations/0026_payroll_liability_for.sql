-- ════════════════════════════════════════════════════════════════════
-- 0026_payroll_liability_for.sql
--
-- LABOR BURDEN FOLLOWS THE WORKER IT WAS PAID FOR.
--
-- payroll.labor_type is 'direct' | 'indirect' | 'liability'. But a statutory
-- contribution (SSS / PhilHealth / Pag-IBIG / withholding) is *burden* — it belongs
-- with the worker class it was paid for:
--
--   a mason's SSS        -> Labor Cost
--   a coordinator's SSS  -> Project Overhead (with the coordinator)
--
-- Without this column every liability row fell into Labor Cost, which inflated Labor
-- and understated Overhead on projects that pay coordinators / site supervision /
-- procurement staff.
--
-- Values: 'direct' | 'indirect'. Only meaningful when labor_type = 'liability'.
-- NULL on existing rows, which the app reads as 'direct' — i.e. the current behaviour
-- is preserved exactly for historical data, and nothing is silently reclassified.
-- Re-tag an old contribution through Expenses -> Payroll to move it to Overhead.
--
-- REQUIRED: js/expenses-module.js writes `liabilityFor`, which the Firestore-compat
-- shim maps to this snake_case column. Without the column, every payroll save fails.
--
-- Idempotent — safe to re-run.
-- ════════════════════════════════════════════════════════════════════

alter table payroll
  add column if not exists liability_for text;

alter table payroll
  drop constraint if exists payroll_liability_for_chk;

alter table payroll
  add constraint payroll_liability_for_chk
  check (liability_for is null or liability_for in ('direct', 'indirect'));
