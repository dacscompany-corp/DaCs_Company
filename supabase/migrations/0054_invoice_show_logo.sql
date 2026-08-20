-- ════════════════════════════════════════════════════════════════════
-- 0054_invoice_show_logo.sql
--
-- PER-INVOICE TOGGLE: print the company logo in the invoice header, or
-- leave the header mark off.
--
-- Which logos exist, their order, and whether each one is in play at all
-- already live in settings/invoiceDefaults.logos — that is a global
-- letterhead setting, and it stays global. What was missing is the
-- per-document choice: this invoice goes out on pre-printed company
-- letterhead that already carries the mark, so printing it again stacks
-- two logos on one page; the next one is emailed as a bare PDF and needs
-- it. That is a property of the document, so it lives on the row.
--
--   true  (default) → the logo strip prints in the header, as before
--   false           → the strip is omitted; the business name block, the
--                     "SALES INVOICE" title and everything below are
--                     untouched
--
-- Defaults to TRUE so every invoice that already exists keeps printing
-- exactly as it does today — no backfill.
--
-- Same shape as quotations.show_logo (0048), deliberately: two documents
-- with the same letterhead problem should not grow two different
-- switches.
--
-- PRESENTATION ONLY. No total changes, and nothing in the money model
-- reads this column.
--
-- Idempotent — safe on the live DB and on a fresh database.
-- ════════════════════════════════════════════════════════════════════

alter table invoices
  add column if not exists show_logo boolean not null default true;

comment on column invoices.show_logo is
  'Presentation only. true = print the company logo strip in the invoice header; false = omit it (letterhead paper already carries it). WHICH logos print, and their order, stays in settings/invoiceDefaults.logos. Never affects subtotal, total_amount or any calculation.';
