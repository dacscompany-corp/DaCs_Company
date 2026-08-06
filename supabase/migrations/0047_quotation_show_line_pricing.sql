-- ════════════════════════════════════════════════════════════════════
-- 0047_quotation_show_line_pricing.sql
--
-- PER-QUOTATION TOGGLE: print the line-level pricing, or only the
-- section totals.
--
-- Some quotations are sold as a package: the client should see WHAT is
-- included and how much the section costs, but not the unit price or the
-- amount behind every individual line. Others are bid documents where
-- the client expects the full rate breakdown. That is a per-document
-- choice, so it lives on the row rather than in a global setting.
--
--   true  (default) → UNIT PRICE and per-line AMOUNT print, as before
--   false           → the UNIT PRICE column is dropped and line AMOUNT
--                     cells print blank; the section row still carries
--                     its total, and the summary is untouched
--
-- Defaults to TRUE so every quotation that already exists keeps printing
-- exactly as it does today. This is a PRESENTATION flag only — no total
-- changes, and qtGrandTotal never reads it. The money is the same either
-- way; this only decides how much of the arithmetic the client is shown.
--
-- Isolation rule from 0045 still stands: a quotation is a PROPOSAL, not
-- revenue. Nothing in the money model reads this table.
--
-- Idempotent — safe on the live DB and on a fresh database.
-- ════════════════════════════════════════════════════════════════════

alter table quotations
  add column if not exists show_line_pricing boolean not null default true;

comment on column quotations.show_line_pricing is
  'Presentation only. true = print UNIT PRICE and per-line AMOUNT; false = print section totals only. Never affects totalAmount or any calculation.';
