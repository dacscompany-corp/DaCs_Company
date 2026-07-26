-- ============================================================
-- 0038_payroll_payment_method_cheque.sql
-- Payroll: add Cheque to the allowed modes of payment.
-- ============================================================
--
-- 0037 introduced payroll.payment_method with three values. Cheque was already
-- printed as a fourth option on the Acknowledge Invoice voucher (it ticks the
-- mode the entry used), so the form now offers it too and the constraint has
-- to allow it.
--
-- Written as a separate migration rather than an edit to 0037 so it applies
-- correctly whether or not 0037 has already run against the live DB.

alter table payroll
  drop constraint if exists payroll_payment_method_chk;

alter table payroll
  add constraint payroll_payment_method_chk
  check (payment_method is null or payment_method in ('cash', 'gcash', 'bank_transfer', 'cheque'));

comment on column payroll.payment_method is
  'How this payment was released: cash | gcash | bank_transfer | cheque. NULL = recorded before the field existed.';
