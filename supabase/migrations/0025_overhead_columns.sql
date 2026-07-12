-- ════════════════════════════════════════════════════════════════════
-- 0025_overhead_columns.sql
--
-- OVERHEAD EXPENSES — capture the columns the app has been writing that
-- were never in a migration.
--
-- 0001_init created overhead_expenses with only:
--     id, legacy_id, owner_id, category, amount, date, description, created_at
-- 0006_overhead_folder added folder_id.
--
-- But js/overhead-module.js writes a much wider row (scope, expense_name,
-- supplier, invoice_number, receipt_url, status, notes, history, deleted_at,
-- updated_at, created_by) through the Firestore-compat shim, which maps camel
-- fields straight to snake_case columns (js/supabase-config.js REG.overheadExpenses
-- has no jsonbData blob mode). Those columns exist only in the live database,
-- added by hand — 0020_schema_drift_catchup.sql did NOT cover this table.
--
-- Consequence without this file: a database rebuilt from migrations 0001–0024
-- gets a PostgREST error on every Overhead save. This closes that gap.
--
-- Idempotent — safe to run on the live DB (no-ops where the column already
-- exists) and on a fresh database.
-- ════════════════════════════════════════════════════════════════════

alter table overhead_expenses
  -- 'company' (cost of running the business) | 'project' (cost of running one job).
  -- Rows written before this column existed have no scope; the app infers it from
  -- folder_id (set => project), so leaving these NULL is correct — do not backfill
  -- blindly to 'company' or every legacy per-project expense would change scope.
  add column if not exists scope          text,
  add column if not exists expense_name   text,
  add column if not exists supplier       text,
  add column if not exists invoice_number text,
  add column if not exists receipt_url    text,
  -- 'paid' | 'pending'. NULL is read as 'pending' by the app.
  add column if not exists status         text,
  add column if not exists notes          text,
  -- Append-only audit trail ([{ fields, at, note }]), same convention as
  -- labor_contracts.cap_history.
  add column if not exists history        jsonb default '[]'::jsonb,
  -- Soft delete. EVERY read filters `deleted_at is null` — the admin Overhead page
  -- and the Project Control overhead drill both do this in JS.
  add column if not exists deleted_at     timestamptz,
  add column if not exists updated_at     timestamptz,
  add column if not exists created_by     uuid;

-- Live queries are "all rows for this owner, minus the deleted ones".
create index if not exists overhead_owner_live_idx
  on overhead_expenses(owner_id)
  where deleted_at is null;

-- The month pickers / reports all filter on the date string.
create index if not exists overhead_date_idx on overhead_expenses(date);
