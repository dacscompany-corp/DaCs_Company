-- ════════════════════════════════════════════════════════════════════
-- 0055_invoice_doc_title.sql
--
-- EDITABLE DOCUMENT TITLE — the words printed in the top-right of the
-- sheet, opposite the letterhead.
--
-- That title was the hardcoded string 'SALES INVOICE' in both the print
-- template and the PDF export. Not every document that comes out of this
-- module is a sales invoice: the same layout is used for a progress
-- billing, a billing statement, a service invoice, a proforma. Renaming
-- it meant editing the source, so in practice it never got renamed and
-- the wrong word went to the client.
--
--   ''      (default) → prints 'SALES INVOICE', exactly as before
--   'X'               → prints X
--
-- Empty-means-default rather than backfilling every row with the literal
-- 'SALES INVOICE': the fallback lives in one place in the code, so if the
-- house default ever changes it changes once, and no historical row is
-- pinned to wording it never explicitly chose.
--
-- Rendered uppercase by the sheet (text-transform) and by the PDF export
-- (toUpperCase), because the letterhead's type is set in caps. The stored
-- value keeps whatever case was typed — the transform is presentation.
--
-- PRESENTATION ONLY. It changes the words on the page, never a figure.
-- Nothing in the money model reads this column, and it has no bearing on
-- invoice_no, status or any total.
--
-- Idempotent — safe on the live DB and on a fresh database.
-- ════════════════════════════════════════════════════════════════════

alter table invoices
  add column if not exists doc_title text not null default '';

comment on column invoices.doc_title is
  'Presentation only. The heading printed opposite the letterhead (e.g. "PROGRESS BILLING"). Empty means the house default, ''SALES INVOICE'' — pre-0055 rows are empty and print unchanged. Displayed uppercase by both the print sheet and the PDF export. Never affects invoice_no, status, subtotal or total_amount.';
