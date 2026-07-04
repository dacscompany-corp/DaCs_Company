-- ════════════════════════════════════════════════════════════════════
-- EMPLOYEE TERMS & CONDITIONS — acceptance audit fields
-- When an admin creates an employee/staff account, they must confirm the
-- employee agreed to the current Terms & Conditions. Record that acceptance
-- (flag, timestamp, and a snapshot of the exact text agreed to) on the
-- profile. The editable T&C text itself lives in settings/employeeTerms.
-- Idempotent — safe to re-run.
-- ════════════════════════════════════════════════════════════════════

alter table profiles
  add column if not exists terms_accepted    boolean not null default false,
  add column if not exists terms_accepted_at timestamptz,
  add column if not exists terms_snapshot    text;
