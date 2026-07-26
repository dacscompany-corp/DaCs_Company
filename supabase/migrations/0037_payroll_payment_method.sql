-- ============================================================
-- 0037_payroll_payment_method.sql
-- Payroll: how the worker was paid (Cash / GCash / Bank Transfer).
-- ============================================================
--
-- WHY
-- Project Control → Payroll records the amount and the worker, but not the
-- channel the money moved through. Reconciling a bank statement or a GCash
-- log against payroll meant guessing from the notes field.
--
-- payment_date also becomes genuinely optional in the UI (it was already
-- nullable here): payments are often logged before the voucher date is
-- known. The app now attributes a dateless row to the billing period it was
-- charged to (project_id) rather than dropping it out of every period view.
--
-- The supabase-config.js shim maps camelCase → snake_case, so the client
-- writes `paymentMethod` and it lands in `payment_method`. Without the
-- column, every payroll save fails.

alter table payroll
  add column if not exists payment_method text;

-- Free-text is not wanted here: the three values are the ones the form
-- offers, and reports group on them. NULL stays legal — every pre-existing
-- row has no method recorded, and the field is optional on new rows too.
alter table payroll
  drop constraint if exists payroll_payment_method_chk;

alter table payroll
  add constraint payroll_payment_method_chk
  check (payment_method is null or payment_method in ('cash', 'gcash', 'bank_transfer'));

comment on column payroll.payment_method is
  'How this payment was released: cash | gcash | bank_transfer. NULL = not recorded.';
