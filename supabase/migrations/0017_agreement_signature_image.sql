-- ════════════════════════════════════════════════════════════════════
-- DRAWN SIGNATURE IMAGE
-- The first-login agreement now also captures a hand-drawn signature (canvas
-- pad), uploaded to the 'uploads' storage bucket. Store its public URL.
-- Idempotent — safe to re-run.
-- ════════════════════════════════════════════════════════════════════

alter table profiles
  add column if not exists agreement_signature_image text;
