-- ════════════════════════════════════════════════════════════════════
-- 0049_quotation_submitted_by.sql
--
-- SEPARATE THE SIGNER FROM THE AUTHOR.
--
-- `prepared_by` (0045) has been doing two jobs: the internal record of
-- who built the quotation, AND the name printed on the "Submitted By"
-- signature line. Those are not always the same person — an estimator
-- prices the job, a manager signs it out.
--
-- So `submitted_by` now owns the signature line, and `prepared_by` goes
-- back to being the internal author.
--
-- FALLBACK, and why it matters: the print sheet reads
--     submitted_by  ||  prepared_by  ||  COMPANY.name
-- Every existing quotation has an empty submitted_by, so it falls
-- through to prepared_by and prints EXACTLY as it does today. Nothing
-- already sent changes appearance, and no backfill is needed.
--
-- There is deliberately NO new visibility column. Whether that block
-- prints is already stored in terms->signOff->preparedBy (0045); the new
-- checkbox in Document Info writes that same flag, so the two switches
-- can never disagree. Adding a second boolean would create exactly the
-- drift it looks like it prevents.
--
-- Isolation rule from 0045 still stands: a quotation is a PROPOSAL, not
-- revenue. Nothing in the money model reads this table.
--
-- Idempotent — safe on the live DB and on a fresh database.
-- ════════════════════════════════════════════════════════════════════

alter table quotations
  add column if not exists submitted_by text not null default '';

comment on column quotations.submitted_by is
  'Name printed on the "Submitted By" signature line. Falls back to prepared_by, then to the company name, so rows written before 0049 print unchanged. prepared_by is the internal author and no longer prints on its own.';
