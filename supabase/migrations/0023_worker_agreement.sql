-- ════════════════════════════════════════════════════════════════════
-- WORKER AGREEMENT ON LABOR CONTRACTS (Project Control · Worker Tracker)
-- A pakyaw/in-house labor contract can now carry the worker's signed
-- agreement: signed flag, timestamp, printed name, drawn-signature image,
-- and a snapshot of the terms (text + PDF url) they agreed to.
-- The agreement TEMPLATE (text + optional PDF) lives in settings/workerAgreement.
-- Idempotent — safe to re-run.
-- ════════════════════════════════════════════════════════════════════

alter table labor_contracts
  add column if not exists agreement_signed          boolean not null default false,
  add column if not exists agreement_signed_at       timestamptz,
  add column if not exists agreement_signature       text,
  add column if not exists agreement_signature_image text,
  add column if not exists agreement_terms_snapshot  text,
  add column if not exists agreement_pdf_url         text,
  add column if not exists agreement_pdf_name        text;
