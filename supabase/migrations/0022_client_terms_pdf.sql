-- ════════════════════════════════════════════════════════════════════
-- PER-CLIENT TERMS & POLICY PDF (Client Management)
-- An admin can attach a Terms & Policy PDF to an individual construction-client
-- account. On login the client must open the PDF and e-sign before entering.
-- The acceptance reuses profiles.terms_accepted / terms_accepted_at (0020).
-- Stores the PDF's public URL (uploads bucket, clientTerms/{uid}/…) + name.
-- Idempotent — safe to re-run.
-- ════════════════════════════════════════════════════════════════════

alter table profiles
  add column if not exists terms_pdf_url         text,
  add column if not exists terms_pdf_name        text,
  add column if not exists terms_signature       text,
  add column if not exists terms_signature_image text,
  add column if not exists terms_ip              text;
