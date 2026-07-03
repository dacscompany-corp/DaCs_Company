-- ════════════════════════════════════════════════════════════════════
-- 0022_drop_terms_columns.sql
--
-- Remove the profiles.terms_* column cluster. Verified 2026-07-03 against
-- the live database before writing this:
--   • settings/constructionClientTerms and settings/clientPortalTerms were
--     NEVER created — the global Terms & Conditions feature that wrote these
--     columns was never configured or used in production.
--   • terms_accepted = false for EVERY profile row (the gate never fired).
--   • terms_pdf_url / terms_pdf_name were never written by any code path.
--   • terms_snapshot only ever held a copy of the hardcoded employee
--     fallback text, read by nothing.
-- The feature itself (config modal, portal gates, ceremony fold-in) was
-- removed from the JS the same day. Acceptance evidence now lives in the
-- append-only agreement_events table (0021) instead.
-- ════════════════════════════════════════════════════════════════════

alter table profiles
  drop column if exists terms_accepted,
  drop column if exists terms_accepted_at,
  drop column if exists terms_snapshot,
  drop column if exists terms_pdf_url,
  drop column if exists terms_pdf_name,
  drop column if exists terms_signature,
  drop column if exists terms_signature_image,
  drop column if exists terms_ip;

notify pgrst, 'reload schema';
