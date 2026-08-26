-- 0058_quotation_area.sql
-- AREA on the quotation header, replacing TIN on the printed sheet.
--
-- Every quotation DAC's issues is a construction estimate, and the header block
-- a client reads wants the floor area, not a tax number — the source BOQs carry
-- "AREA: 4 SQM" right under the project name. A client TIN belongs on an INVOICE
-- (invoices already have their own `clientTin`, see 0053–0056); on a proposal it
-- was an empty cell on every sheet.
--
-- Free-form text, NOT numeric: real headers read "4 SQM", "120 sqm (2 floors)",
-- "38 sqm GFA". Nothing computes with it — no rate is ever derived from area, and
-- the money model does not read this column. Quotations stay OUTSIDE the money
-- model entirely (0045): a quotation is a proposal, not revenue.
--
-- `client_tin` is deliberately NOT dropped. Some existing rows may carry a TIN,
-- and dropping the column would destroy it with no way back. The column simply
-- stops being written and stops being printed — js/quotation-module.js no longer
-- puts it in the save payload, the revision snapshot or the client preset, and
-- js/quotation-print.js prints Area in the cell it used to occupy. Re-adding TIN
-- later is a UI change, not a migration.
--
-- Owner-only, same as the base table's RLS — no new policy needed.

alter table quotations
  add column if not exists area text;
