-- ════════════════════════════════════════════════════════════════════
-- PER-PROJECT TERMS & CONDITIONS PDF
-- A project's partner agreement can now be a PDF document (uploaded by the
-- admin). The partner must scroll through the PDF before they can sign.
-- Stores the public URL of the PDF in the `uploads` bucket + its display name.
-- The existing `partner_terms` text (0018) remains the fallback when no PDF.
-- Idempotent — safe to re-run.
-- ════════════════════════════════════════════════════════════════════

alter table construction_projects
  add column if not exists partner_terms_pdf_url  text,
  add column if not exists partner_terms_pdf_name text;
