-- ════════════════════════════════════════════════════════════════════
-- 0036_pm_worker_agreement.sql
--
-- WORKER AGREEMENT ON PROJECT-MANAGEMENT LABOR CONTRACTS.
--
-- Mirrors 0023_worker_agreement.sql (which added the same feature to Project
-- Control's `labor_contracts`) onto the Project Management table
-- `pm_labor_contracts`. A pakyaw / in-house contract can now carry the worker's
-- signed agreement PDF: a signed flag, when it was attached, the printed name,
-- and the stored PDF's url + filename.
--
-- Only the fields the PDF-upload flow writes are added here — the on-screen
-- e-signature columns (signature_image, terms_snapshot) from 0023 are omitted
-- because PM uses the upload-the-signed-PDF path, same as Project Control's.
--
-- Idempotent — safe to re-run.
-- ════════════════════════════════════════════════════════════════════

alter table pm_labor_contracts
  add column if not exists agreement_signed    boolean not null default false,
  add column if not exists agreement_signed_at timestamptz,
  add column if not exists agreement_signature text,
  add column if not exists agreement_pdf_url   text,
  add column if not exists agreement_pdf_name  text;
