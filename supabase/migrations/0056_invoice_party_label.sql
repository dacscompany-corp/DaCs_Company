-- ════════════════════════════════════════════════════════════════════
-- 0056_invoice_party_label.sql
--
-- WHAT THE CLIENT BLOCK IS CALLED — "Bill To" or "Received From".
--
-- The block under the letterhead that carries the client's name, TIN and
-- address was headed by the hardcoded string 'Bill To' in the editor, the
-- print sheet and the PDF export. That heading is right for a sales
-- invoice and wrong for the other document this same layout now prints:
-- 0055 made the title editable, so the sheet can go out as an
-- ACKNOWLEDGEMENT RECEIPT — and a receipt does not bill anybody, it
-- records money RECEIVED FROM someone.
--
--   ''                (default) → prints 'Bill To', exactly as before
--   'Received From'             → prints 'Received From'
--   'X'                         → prints X
--
-- Empty-means-default for the same reason as doc_title (0055): the house
-- default lives in one place in the code, and no historical row is pinned
-- to wording it never explicitly chose. No backfill.
--
-- Free-form text rather than an enum or a check constraint even though
-- the editor offers a two-item dropdown today. The stored value is a
-- heading that gets printed verbatim, not a state anything branches on —
-- adding a third choice should be a one-line change in the module, not a
-- migration. Nothing filters or aggregates on this column.
--
-- Printed in the sheet's own case (the print CSS and the PDF both set
-- their own casing for this heading); the stored value keeps what was
-- picked.
--
-- PRESENTATION ONLY. It changes two words on the page, never a figure and
-- never who the invoice is actually for — client_name / client_tin /
-- client_address are untouched, and so are invoice_no, status and every
-- total. Nothing in the money model reads this column.
--
-- Idempotent — safe on the live DB and on a fresh database.
-- ════════════════════════════════════════════════════════════════════

alter table invoices
  add column if not exists party_label text not null default '';

comment on column invoices.party_label is
  'Presentation only. The heading printed above the client name/TIN/address block (e.g. "Received From" on an acknowledgement receipt). Empty means the house default, ''Bill To'' — pre-0056 rows are empty and print unchanged. Free-form on purpose: it is printed verbatim and nothing branches on it. Never affects client_name, invoice_no, status, subtotal or total_amount.';
