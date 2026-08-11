-- ════════════════════════════════════════════════════════════════════
-- 0048_quotation_show_logo.sql
--
-- PER-QUOTATION TOGGLE: print the DAC'S logo in the sheet header, or
-- leave the header mark off.
--
-- Some quotations go out on pre-printed company letterhead, which
-- already carries the mark — printing it again stacks two logos on the
-- same page. Others are emailed as a bare PDF and need it. That is a
-- per-document choice, so it lives on the row rather than in a global
-- setting.
--
--   true  (default) → the logo image prints in the header, as before
--   false           → the logo image is omitted; the "PROJECT QUOTATION"
--                     label, the contact line and everything below the
--                     header are untouched
--
-- Defaults to TRUE so every quotation that already exists keeps printing
-- exactly as it does today. This is a PRESENTATION flag only — no total
-- changes, and qtGrandTotal never reads it.
--
-- Isolation rule from 0045 still stands: a quotation is a PROPOSAL, not
-- revenue. Nothing in the money model reads this table.
--
-- Idempotent — safe on the live DB and on a fresh database.
-- ════════════════════════════════════════════════════════════════════

alter table quotations
  add column if not exists show_logo boolean not null default true;

comment on column quotations.show_logo is
  'Presentation only. true = print the company logo in the sheet/PDF header; false = omit it (letterhead paper already carries it). Never affects totalAmount or any calculation.';
